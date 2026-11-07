// ADR-047 (S2, port plan §2.1 B1–B8; S4: B9): links the service worker of the opt-in module «Защита» (protect-sw.js) into the
// production background.js. Idempotent; places are found by anchor strings, never by line numbers; every inserted
// block sits between `// ADR-047 … start/end` markers and is rewritten from this file on each run. `--check` changes
// nothing and exits 1 when background.js differs from what this script would write.
//   B1  one-line import of protect-sw.js before the first import (pro-values-stop-review strips `^import` lines);
//   B2  the production runtime.onMessage listener returns false and never calls sendResponse for the module's types;
//   B3  BadgeManager: per-tab firewall badge of the module, the tab colour/title restored afterwards (bounded);
//   B4  ScopeController: onMainRegistered after detector-main-v1 was registered or updated (W3);
//   B5  history source: onProtectReportPersisted after a successful report persist;
//   B6  ui-clear-session clears the module's session documents too;
//   B7  the module's storage.session keys are subtracted from the 4 MiB observation budget (as the Pro allowance);
//   B8  the injection fields, assigned once before background.start();
//   B9  discardUnconsentedData (production data consent declined or reset) keeps the module's storage.session keys:
//       the module has its own consent (port plan §4). SessionRepository.clearAll gets an optional keep predicate and
//       the runtime passes the injection field keepProtectSessionKey (B8 binds it to isProtectSessionKey).
// The header `function createMessageListener(runtime)` and the BadgeManager/ScopeController constructors stay as they
// are: vm tests cut the bundle at them.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BACKGROUND_FILE = resolve(import.meta.dirname, '../../apps/production-extension/background.js');
export const PROTECT_SW_IMPORT = 'import { protectHost, isProtectSessionKey } from "./protect-sw.js";\n';

const B8_BLOCK = `// ADR-047 protect integration start
// The opt-in module «Защита» (protect-sw.js, Chrome only; a no-op stub in Firefox) is linked only through these
// injection fields (port plan §2.1 B8). Its own runtime.onMessage listener (registered when protect-sw.js evaluated,
// before this body) answers its message types; the production listener answers everything else.
var protectBadgeLanguage = () => {
  try {
    return badgeBrowserLanguage(String(chrome.i18n.getUILanguage()));
  } catch {
    return "en";
  }
};
background.runtime.ownsMessage = (message) => {
  try {
    return protectHost.owns(message) === true;
  } catch {
    return false;
  }
};
background.runtime.badge.protect = (tabId, language) => protectHost.badgeFor(tabId, language ?? protectBadgeLanguage());
background.runtime.scope.onMainRegistered = () => protectHost.observationMainRegistered();
background.runtime.onProtectReportPersisted = (documentKey, report, meta) => {
  try {
    protectHost.reportPersisted(documentKey, report, meta, (tabId, documentId) => {
      for (const binding of background.runtime.state.bindings.values()) if (binding.tabId === tabId && binding.documentId === documentId) return binding;
      return null;
    });
  } catch {
  }
};
background.runtime.onProtectClearSession = () => {
  try {
    protectHost.clearSession();
  } catch {
  }
};
// Exact module keys of storage.session (getKeys reads no values); the in-memory list when getKeys is unavailable.
// B9: the production data-consent wipe keeps exactly the module's keys (isProtectSessionKey of protect-sw.js).
background.runtime.keepProtectSessionKey = (key) => typeof key == "string" && isProtectSessionKey(key) === true;
background.runtime.protectSessionKeys = async () => {
  const known = protectHost.sessionKeys();
  if (!Array.isArray(known) || known.length === 0) return [];
  try {
    const all = await chrome.storage.session.getKeys();
    return Array.isArray(all) ? all.filter((key) => typeof key == "string" && isProtectSessionKey(key)) : known;
  } catch {
    return known;
  }
};
protectHost.attach({
  hostGranted: (host, scheme) => background.runtime.scope.isHostGrantedSync(host, scheme),
  markBadge: (tabId) => background.runtime.badge.mark(tabId),
  markAllBadges: () => background.runtime.badge.markAll()
});
// ADR-047 protect integration end
`;

/**
 * kind 'pair': `before` (exactly once) becomes `after`; already applied when `after` occurs exactly once.
 * kind 'block': `before` (exactly once) becomes `block`; when the block's markers exist, the marked region is rewritten.
 */
export const EDITS = Object.freeze([
  {
    id: 'B2 production listener leaves module messages to protect-sw.js', kind: 'pair',
    before: 'function createMessageListener(runtime) {\n  return (message, sender, sendResponse) => (route(runtime, message, sender).then(sendResponse, () => {\n',
    after: 'function createMessageListener(runtime) {\n  // ADR-047: the module types (exact `type`, protect-sw.js) get false and no sendResponse here.\n  return (message, sender, sendResponse) => runtime.ownsMessage?.(message) ? !1 : (route(runtime, message, sender).then(sendResponse, () => {\n',
  },
  {
    id: 'B3 BadgeManager fields', kind: 'block',
    before: '  displayed = /* @__PURE__ */ new Map();\n  timer = null;\n',
    block: '  displayed = /* @__PURE__ */ new Map();\n  timer = null;\n'
      + '  // ADR-047 protect badge fields start\n'
      + '  /** Assigned by background.js (B8): firewall prompts of the module «Защита» in a tab ({ text, color, title }) or null. */\n'
      + '  protect = () => null;\n'
      + '  /** Tabs whose badge colour and title the module set: tabId -> "fw" or the restored "<colour>|<title>". */\n'
      + '  protectTabs = /* @__PURE__ */ new Map();\n'
      + '  // ADR-047 protect badge fields end\n',
    begin: '  // ADR-047 protect badge fields start\n', end: '  // ADR-047 protect badge fields end\n',
  },
  {
    id: 'B3 BadgeManager.stop', kind: 'pair',
    before: 'this.work.clear(), this.displayed.clear();\n',
    after: 'this.work.clear(), this.displayed.clear(), this.protectTabs.clear();\n',
  },
  {
    id: 'B3 BadgeManager.markAll', kind: 'pair',
    before: '    for (let tabId of this.state().tabs.keys()) this.mark(tabId);\n  }\n',
    after: '    for (let tabId of this.state().tabs.keys()) this.mark(tabId);\n    for (let tabId of this.protectTabs.keys()) this.mark(tabId);\n  }\n',
  },
  {
    id: 'B3 BadgeManager.afterEvent', kind: 'pair',
    before: '        this.displayed.delete(removed);\n',
    after: '        this.displayed.delete(removed), this.protectTabs.delete(removed);\n',
  },
  {
    id: 'B3 BadgeManager.update key', kind: 'block',
    before: '    let displayKey = appearance.mode + ":" + count3;\n'
      + '    if (this.displayed.get(tabId) === displayKey) return;\n'
      + '    if (tabId === null || count3 > 0 || this.displayed.has(tabId)) this.displayed.set(tabId, "pending");\n',
    block: '    // ADR-047 protect badge start\n'
      + '    // Firewall prompts of the module «Защита» win over the tab text in every mode: "1"…"9+" on the module colour\n'
      + '    // with its tooltip. A tab the module coloured gets the global colour and title back (again after a global\n'
      + '    // appearance change); the set of such tabs is bounded like the counters.\n'
      + '    let firewall = null, globalTitle = appearance.mode === "observing" ? "Detect Expert" : "Detect Expert — " + (appearance.mode === "off" ? "OFF" : "ON");\n'
      + '    if (tabId !== null) {\n'
      + '      try {\n'
      + '        firewall = this.protect(tabId, this.language);\n'
      + '      } catch {\n'
      + '        firewall = null;\n'
      + '      }\n'
      + '      if (typeof firewall != "object" || firewall === null || typeof firewall.text != "string" || firewall.text === "" || typeof firewall.color != "string" || typeof firewall.title != "string" || !this.protectTabs.has(tabId) && this.protectTabs.size >= MAX_DOCUMENTS_GLOBAL) firewall = null;\n'
      + '    }\n'
      + '    let restored = appearance.color + "|" + globalTitle, restore = tabId !== null && firewall === null && this.protectTabs.has(tabId) && this.protectTabs.get(tabId) !== restored;\n'
      + '    let displayKey = appearance.mode + ":" + count3 + (firewall === null ? "" : ":fw:" + firewall.text + ":" + firewall.color + ":" + firewall.title);\n'
      + '    if (this.displayed.get(tabId) === displayKey && !restore) return;\n'
      + '    if (tabId === null || count3 > 0 || firewall !== null || this.displayed.has(tabId)) this.displayed.set(tabId, "pending");\n'
      + '    // ADR-047 protect badge end\n',
    begin: '    // ADR-047 protect badge start\n', end: '    // ADR-047 protect badge end\n',
  },
  {
    id: 'B3 BadgeManager.update operations', kind: 'block',
    before: '    ] : [() => action.setBadgeText({ tabId, text: appearance.mode === "observing" && count3 > 0 ? String(count3) : null })], ok = !0;\n',
    block: '    // ADR-047 protect badge operations start\n'
      + '    ] : [() => action.setBadgeText({ tabId, text: firewall !== null ? firewall.text : appearance.mode === "observing" && count3 > 0 ? String(count3) : null })], ok = !0;\n'
      + '    if (firewall !== null) this.protectTabs.set(tabId, "fw"), operations.push(() => action.setBadgeBackgroundColor({ tabId, color: firewall.color }), () => action.setTitle({ tabId, title: firewall.title }));\n'
      + '    else if (restore) operations.push(() => action.setBadgeBackgroundColor({ tabId, color: appearance.color }), () => action.setTitle({ tabId, title: globalTitle }));\n'
      + '    // ADR-047 protect badge operations end\n',
    begin: '    // ADR-047 protect badge operations start\n', end: '    // ADR-047 protect badge operations end\n',
  },
  {
    id: 'B3 BadgeManager.update result', kind: 'pair',
    before: '      tabId === null || count3 > 0 ? this.displayed.set(tabId, displayKey) : this.displayed.delete(tabId);\n',
    after: '      tabId === null || count3 > 0 || firewall !== null ? this.displayed.set(tabId, displayKey) : this.displayed.delete(tabId);\n'
      + '      restore && this.protectTabs.has(tabId) && this.protectTabs.set(tabId, restored);\n',
  },
  {
    id: 'B4 ScopeController field', kind: 'pair',
    before: '  prefs = { v: 1, scopeMode: "off", hosts: [] };\n',
    after: '  prefs = { v: 1, scopeMode: "off", hosts: [] };\n  /** ADR-047 (W3): assigned by background.js; called after detector-main-v1 was registered or updated. */\n  onMainRegistered = null;\n',
  },
  {
    id: 'B4 ScopeController registration hook', kind: 'pair',
    before: '      this.registrationOk = !0, this.noteRegistered(matches);\n',
    after: '      this.registrationOk = !0, this.noteRegistered(matches);\n'
      + '      // ADR-047 (W3): the module re-registers its MAIN after detector-main-v1, so hook.early.js sees native APIs first.\n'
      + '      try {\n'
      + '        this.onMainRegistered?.();\n'
      + '      } catch {\n'
      + '      }\n',
  },
  {
    id: 'B5 persisted report to the module history', kind: 'pair',
    before: 'this.enforceTotalBudget(), !0;',
    after: 'this.enforceTotalBudget(), this.onProtectReportPersisted?.(documentKey3, current, currentMeta), !0;',
    variants: [{
      // ADR-073 keeps the same callback after the durable snapshot commit in the formatted runtime.
      before: '        void this.enforceTotalBudget();\n        return true;',
      after: '        void this.enforceTotalBudget();\n        this.onProtectReportPersisted?.(documentKey, current, currentMeta);\n        return true;',
    }],
  },
  {
    id: 'B6 clear session', kind: 'pair',
    before: '  async clearSession() {\n    await this.ready;\n',
    after: '  async clearSession() {\n    await this.ready;\n    this.onProtectClearSession?.(); // ADR-047: the module\'s session documents go too.\n',
    variants: [{
      // The authority guard must settle before the opt-in module clears its session documents.
      before: '  async clearSession() {\n    await this.ready;\n    await this.ensureHistory();\n',
      after: '  async clearSession() {\n    await this.ready;\n    await this.ensureHistory();\n    this.onProtectClearSession?.();\n',
    }],
    guardLegacyAuthority: true,
  },
  {
    id: 'B7 session budget without the module keys', kind: 'block',
    before: '    let total = await this.repository.bytesInUse();\n'
      + '    if (this.lastMeasuredBytes = total, total === null || !this.pro.hasSession()) return total;\n',
    block: '    let total = await this.repository.bytesInUse();\n'
      + '    // ADR-047 protect session budget start\n'
      + '    // The module\'s own storage.session data (bounded at 1 MiB, vendored maxProtectSessionBytes) never evicts reports.\n'
      + '    if (this.lastMeasuredBytes = total, total !== null && typeof this.protectSessionKeys == "function") {\n'
      + '      let protectKeys = null;\n'
      + '      try {\n'
      + '        protectKeys = await this.protectSessionKeys();\n'
      + '      } catch {\n'
      + '        protectKeys = null;\n'
      + '      }\n'
      + '      let protectBytes = Array.isArray(protectKeys) && protectKeys.length > 0 ? await this.repository.bytesInUse(protectKeys) : 0;\n'
      + '      protectBytes !== null && (total = Math.max(0, total - Math.min(protectBytes, 1048576)));\n'
      + '    }\n'
      + '    if (total === null || !this.pro.hasSession()) return total;\n'
      + '    // ADR-047 protect session budget end\n',
    begin: '    // ADR-047 protect session budget start\n', end: '    // ADR-047 protect session budget end\n',
  },
  {
    id: 'B8 injection fields before background.start()', kind: 'block',
    before: '\nbackground.start();\n',
    block: '\n' + B8_BLOCK + 'background.start();\n',
    begin: '// ADR-047 protect integration start\n', end: '// ADR-047 protect integration end\n',
  },
  {
    id: 'B9 SessionRepository.clearAll keep predicate', kind: 'pair',
    before: '  async clearAll(keepKeys = []) {\n    try {\n      return await Promise.all([...this.queues.values()]), await this.write(async () => {\n'
      + '        if (keepKeys.length === 0) await this.storage.clear();\n        else {\n'
      + '          let items = await this.storage.get(null), remove = Object.keys(items).filter((key2) => !keepKeys.includes(key2));\n',
    after: '  async clearAll(keepKeys = [], keepKey = null) {\n    try {\n      return await Promise.all([...this.queues.values()]), await this.write(async () => {\n'
      + '        // ADR-047 (B9): keepKey (optional) keeps more keys; only an exact `true` keeps, a throwing predicate removes.\n'
      + '        let kept = (key2) => {\n'
      + '          if (keepKeys.includes(key2)) return !0;\n'
      + '          if (typeof keepKey != "function") return !1;\n'
      + '          try {\n'
      + '            return keepKey(key2) === !0;\n'
      + '          } catch {\n'
      + '            return !1;\n'
      + '          }\n'
      + '        };\n'
      + '        if (keepKeys.length === 0 && typeof keepKey != "function") await this.storage.clear();\n        else {\n'
      + '          let items = await this.storage.get(null), remove = Object.keys(items).filter((key2) => !kept(key2));\n',
  },
  {
    id: 'B9 data-consent wipe keeps the module keys', kind: 'pair',
    before: 'cleared = await this.repository.clearAll([DATA_CONSENT_PENDING_KEY]);',
    after: 'cleared = await this.repository.clearAll([DATA_CONSENT_PENDING_KEY], this.keepProtectSessionKey);',
  },
]);

function occurrences(source, text) {
  let count = 0;
  for (let at = source.indexOf(text); at >= 0; at = source.indexOf(text, at + text.length)) count++;
  return count;
}

/** Reviewed equivalent source forms share one logical anchor; mixed or repeated forms are ambiguous. */
function patchPairVariants(source, edit) {
  const pairs = [{ before: edit.before, after: edit.after }, ...edit.variants];
  const hits = (text) => {
    const found = [];
    for (let at = source.indexOf(text); at >= 0; at = source.indexOf(text, at + text.length)) found.push(at);
    return found;
  };
  const applied = pairs.flatMap((pair, variant) => hits(pair.after).map(at => ({ at, text: pair.after, variant })));
  if (applied.length > 1) throw new Error(edit.id + ': anchor missing or ambiguous');
  const remaining = applied.length ? source.slice(0, applied[0].at) + ' '.repeat(applied[0].text.length) + source.slice(applied[0].at + applied[0].text.length) : source;
  const candidates = pairs.flatMap((pair, variant) => {
    const found = [];
    for (let at = remaining.indexOf(pair.before); at >= 0; at = remaining.indexOf(pair.before, at + pair.before.length)) found.push({ at, text: pair.before, variant });
    return found;
  });
  // A new B6 prefix contains the old ready-only prefix. Select its enclosing reviewed form, once.
  const originals = candidates.filter(item => !candidates.some(other => other !== item && other.at <= item.at && other.at + other.text.length >= item.at + item.text.length && other.text.length > item.text.length));
  if (applied.length + originals.length !== 1) throw new Error(edit.id + ': anchor missing or ambiguous');
  const selected = applied[0] ?? originals[0];
  if (edit.guardLegacyAuthority && selected.variant === 0) {
    const end = source.indexOf('\n  }', selected.at + selected.text.length);
    if (end < 0 || source.slice(selected.at, end).includes('this.ensureHistory(')) throw new Error(edit.id + ': module callback must follow the authority guard');
  }
  if (applied.length) return source;
  const pair = pairs[selected.variant];
  return source.slice(0, selected.at) + pair.after + source.slice(selected.at + pair.before.length);
}

/** The patched background.js for `source`; throws when an anchor is missing or ambiguous. */
export function patchBackground(source) {
  let out = source;
  // B1: one import line, first in the file.
  const imports = occurrences(out, PROTECT_SW_IMPORT);
  if (imports > 1 || (imports === 1 && !out.startsWith(PROTECT_SW_IMPORT))) throw new Error('B1: protect-sw.js import is not the single first line');
  if (imports === 0) {
    if (!out.startsWith('import ')) throw new Error('B1: background.js does not start with its imports');
    out = PROTECT_SW_IMPORT + out;
  }
  for (const edit of EDITS) {
    if (edit.kind === 'pair') {
      // ADR-076 preserves this exact keep predicate; only the reviewed key enumeration changes.
      if (edit.id === 'B9 SessionRepository.clearAll keep predicate') {
        const keyed = edit.after.replace('let items = await this.storage.get(null), remove = Object.keys(items).filter((key2) => !kept(key2));', 'let keys = await sessionStorageKeys(this.storage), remove = keys.filter((key2) => !kept(key2));');
        if (keyed !== edit.after && occurrences(out, keyed) === 1) continue;
      }
      if (edit.variants) { out = patchPairVariants(out, edit); continue; }
      const done = occurrences(out, edit.after);
      if (done === 1) continue;
      if (done > 1 || occurrences(out, edit.before) !== 1) throw new Error(edit.id + ': anchor missing or ambiguous');
      out = out.replace(edit.before, () => edit.after);
      continue;
    }
    const first = out.indexOf(edit.begin);
    if (first >= 0) {
      const last = out.indexOf(edit.end, first + edit.begin.length);
      if (last < 0 || occurrences(out, edit.begin) !== 1 || occurrences(out, edit.end) !== 1) throw new Error(edit.id + ': marker boundary broken');
      const marked = edit.block.slice(edit.block.indexOf(edit.begin), edit.block.indexOf(edit.end) + edit.end.length);
      out = out.slice(0, first) + marked + out.slice(last + edit.end.length);
      continue;
    }
    if (occurrences(out, edit.before) !== 1) throw new Error(edit.id + ': anchor missing or ambiguous');
    out = out.replace(edit.before, () => edit.block);
  }
  // Each replaced original must be gone exactly where it was replaced (the B3 key lines, the B7 early return).
  for (const edit of EDITS) {
    if (edit.kind === 'block' && !edit.block.startsWith(edit.before) && !edit.block.includes(edit.before) && occurrences(out, edit.before) !== 0) throw new Error(edit.id + ': original still present');
  }
  return out;
}

function main(argv) {
  const check = argv.includes('--check');
  const before = readFileSync(BACKGROUND_FILE, 'utf8');
  const after = patchBackground(before);
  if (patchBackground(after) !== after) throw new Error('patch is not idempotent');
  if (check) {
    if (before !== after) {
      console.error('sync-protect-sw: background.js differs from the ADR-047 integration; run node scripts/production/sync-protect-sw.mjs');
      process.exit(1);
    }
  } else if (before !== after) writeFileSync(BACKGROUND_FILE, after, 'utf8');
  console.log('protect service worker: B1–B9 synchronized' + (check ? ' (check)' : before === after ? ' (unchanged)' : ' (written)'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2));
