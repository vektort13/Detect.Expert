// ADR-047 (S4b, owner requirement «фаерволл должен быть попапом при обнаружении слежки и утечки»): the state machine
// that surfaces the module's firewall as its own action popup (apps/production-protect/src/surface.ts), bundled in
// memory and driven with a fake clock and fake browser calls: trigger, grouping, the one popup per (site, receiver),
// the 10 s window limit, snooze / module off (muted), site exclusion, the default popup restored after a decision or a
// dismissal, a navigation re-setting the per-tab popup, a rejected openPopup (no retry, popup and badge stay), the
// service-worker restart adoption and the bounds. Also checks that the shipped protect-sw.js wires the surfacer.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../../..');

async function loadSurface() {
  const result = await build({ entryPoints: [join(root, 'apps/production-protect/src/surface.ts')], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

const S = await loadSurface();
const SITE = 'shop.example';
const DEFAULT = 'popup.html';

/** A fake browser: tabs with windows and focus, the per-tab popup, popup contexts, a manual clock and timers. */
function harness({ openFails = null } = {}) {
  let now = 1_000_000;
  const timers = [];
  const calls = [];
  const popups = new Map();
  const tabs = new Map([[7, { windowId: 1, active: true }], [8, { windowId: 1, active: false }], [9, { windowId: 2, active: true }]]);
  const windows = new Map([[1, true], [2, true]]);
  const pending = new Map();
  let muted = false;
  let popupOpen = false;
  const deps = {
    now: () => now,
    pending: (tabId) => (muted ? { site: null, receivers: [], muted: true } : pending.get(tabId) ?? { site: SITE, receivers: [], muted: false }),
    setPopup: async (tabId, popup) => {
      calls.push(['setPopup', tabId, popup]);
      if (!tabs.has(tabId)) throw new Error('No tab with id: ' + tabId);
      popups.set(tabId, popup);
    },
    getPopup: async (tabId) => 'chrome-extension://id/' + (popups.get(tabId) ?? DEFAULT),
    openPopup: async (windowId) => {
      calls.push(['openPopup', windowId]);
      if (openFails !== null) throw new Error(openFails);
      popupOpen = true;
    },
    tab: async (tabId) => tabs.get(tabId) ?? null,
    windowFocused: async (windowId) => windows.get(windowId) === true,
    popupOpen: async () => popupOpen,
    defaultPopup: () => DEFAULT,
    setTimer: (fn, ms) => {
      const t = { fn, at: now + ms, done: false };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      t.done = true;
    },
  };
  const surfacer = new S.FirewallSurfacer(deps);
  const h = {
    surfacer, calls, popups, tabs, windows, pending, deps,
    get now() { return now; },
    setMuted(v) { muted = v; },
    closePopup() { popupOpen = false; },
    get popupIsOpen() { return popupOpen; },
    wait: (receivers, tabId = 7, site = SITE) => pending.set(tabId, { site, receivers, muted: false }),
    /** Moves the clock and runs the due timers, waiting for their evaluations. */
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = timers.filter((t) => !t.done).sort((a, b) => a.at - b.at)[0];
        if (next === undefined || next.at > until) break;
        now = Math.max(now, next.at);
        next.done = true;
        next.fn();
        await surfacer.settled();
      }
      now = until;
      await surfacer.settled();
    },
    opens: () => calls.filter(([c]) => c === 'openPopup').length,
    sets: (tabId) => calls.filter(([c, id]) => c === 'setPopup' && id === tabId).map(([, , p]) => p),
  };
  return h;
}

test('trigger: a waiting receiver sets firewall.html?tab=<id> on its tab, then opens the popup in its window', async () => {
  const h = harness();
  h.wait(['collect.example.net']);
  h.surfacer.schedule(7);
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.deepEqual(h.calls, [['setPopup', 7, 'firewall.html?tab=7'], ['openPopup', 1]]);
  assert.equal(h.surfacer.popupOf(7), 'firewall');
  assert.equal(h.surfacer.stats.opened, 1);
  assert.equal(h.surfacer.stats.lastOpen, 'opened');
  assert.equal(S.firewallPopupPath(12), 'firewall.html?tab=12');
  assert.equal(S.isFirewallPopup('chrome-extension://abc/firewall.html?tab=7'), true);
  assert.equal(S.isFirewallPopup('chrome-extension://abc/popup.html'), false);
  assert.equal(S.isFirewallPopup(''), false);
});

test('ADR-052: dedicated findings delivery keeps manual firewall access without opening a second action popup', async () => {
  const h = harness();
  h.deps.autoOpen = false;
  h.wait(['collect.example.net']);
  h.surfacer.schedule(7);
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.deepEqual(h.calls, [['setPopup', 7, 'firewall.html?tab=7']]);
  h.surfacer.activated(7);
  await h.advance(S.FIREWALL_OPEN_INTERVAL_MS);
  assert.equal(h.opens(), 0);
  h.wait([]);
  h.surfacer.schedule(7);
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.equal(h.popups.get(7), DEFAULT);
});

test('returning window focus resumes a waiting active tab without a tab activation or a changed badge count', async () => {
  const h = harness(); h.windows.set(1, false);
  h.wait(['collect.example.net']); h.surfacer.schedule(7);
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.equal(h.opens(), 0); assert.equal(h.surfacer.stats.notFocused, 1);
  h.windows.set(1, true); h.surfacer.observe(7, 1);
  const query = async id => [...h.tabs].filter(([, tab]) => tab.windowId === id && tab.active).map(([id, tab]) => ({ ...tab, id }));
  await S.resumeFocusedFirewall(1, query, id => h.surfacer.activated(id)); await h.advance(0);
  assert.equal(h.opens(), 1);
  h.closePopup();
  await S.resumeFocusedFirewall(1, query, id => h.surfacer.activated(id)); await h.advance(0);
  assert.equal(h.opens(), 1, 'repeated focus does not reopen an already surfaced receiver');
});

test('focus routing ignores no-window, closed windows and stale nonactive or foreign-window query results', async () => {
  const activated = []; let queries = 0;
  await S.resumeFocusedFirewall(-1, async () => { queries++; return []; }, id => activated.push(id));
  assert.equal(queries, 0);
  for (const tab of [{ id: 7, windowId: 2, active: true }, { id: 7, windowId: 1, active: false }, { windowId: 1, active: true }]) {
    await S.resumeFocusedFirewall(1, async () => [tab], id => activated.push(id));
  }
  await S.resumeFocusedFirewall(1, async () => { throw Error('closed'); }, id => activated.push(id));
  assert.deepEqual(activated, []);
});

test('async popup-context lookup cannot open or consume a prompt after module disable, tab deactivation or focus loss', async () => {
  for (const change of ['disable', 'inactive', 'unfocused']) {
    const h = harness(); h.wait(['collect.example.net']);
    h.deps.popupOpen = async () => {
      if (change === 'disable') h.setMuted(true);
      if (change === 'inactive') h.tabs.set(7, { windowId: 1, active: false });
      if (change === 'unfocused') h.windows.set(1, false);
      return false;
    };
    h.surfacer.schedule(7); await h.advance(S.FIREWALL_GROUP_MS);
    assert.equal(h.opens(), 0, change); assert.equal(h.surfacer.surfacedKeys, 0, change);
  }
});

test('stable duplicate receivers open once without an immediate retry loop', async () => {
  const h = harness(); h.wait(['collect.example.net', 'collect.example.net']);
  h.surfacer.schedule(7); await h.advance(S.FIREWALL_GROUP_MS);
  assert.equal(h.opens(), 1); assert.equal(h.surfacer.stats.evaluations, 1); assert.equal(h.surfacer.surfacedKeys, 1);
  await h.surfacer.idle(); assert.equal(h.surfacer.stats.evaluations, 1);
});

test('grouping: a burst of receivers opens one popup; a receiver arriving while it is open joins it (no second open)', async () => {
  const h = harness();
  h.wait(['a.example']);
  h.surfacer.schedule(7);
  h.wait(['a.example', 'b.example']);
  h.surfacer.schedule(7);
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.equal(h.opens(), 1, 'one popup for the burst');
  h.wait(['a.example', 'b.example', 'c.example']);
  h.surfacer.schedule(7);
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.equal(h.opens(), 1, 'the open popup shows c.example within its poll');
  assert.equal(h.surfacer.stats.popupAlreadyOpen, 1);
  // c.example counts as surfaced: closing the popup does not bring it back by itself.
  h.closePopup();
  h.surfacer.schedule(7);
  await h.advance(S.FIREWALL_OPEN_INTERVAL_MS);
  assert.equal(h.opens(), 1);
});

test('dedupe: one popup per (site, receiver) until decided; a same-site navigation re-sets the per-tab popup only', async () => {
  const h = harness();
  h.wait(['collect.example.net']);
  h.surfacer.schedule(7);
  await h.advance(S.FIREWALL_GROUP_MS);
  h.closePopup();
  h.surfacer.observe(7, 1);
  h.surfacer.schedule(7);
  await h.advance(S.FIREWALL_OPEN_INTERVAL_MS * 2);
  assert.equal(h.opens(), 1, 'ignored popup: no second popup for the same (site, receiver)');
  // Chromium resets the per-tab popup on a commit; the surfacer sets it again while the prompt waits.
  h.popups.set(7, DEFAULT);
  h.surfacer.navigated(7);
  await h.advance(S.FIREWALL_GROUP_MS + S.FIREWALL_SETTLE_MS);
  assert.deepEqual(h.sets(7), ['firewall.html?tab=7', 'firewall.html?tab=7']);
  assert.equal(h.popups.get(7), 'firewall.html?tab=7');
  assert.equal(h.opens(), 1);
  // Another tab of the same site, same receiver: no popup either.
  h.tabs.set(8, { windowId: 1, active: true });
  h.wait(['collect.example.net'], 8);
  h.surfacer.schedule(8);
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.equal(h.opens(), 1);
  assert.equal(h.popups.get(8), 'firewall.html?tab=8', 'its icon still opens the firewall');
});

test('decided or dismissed: the default popup comes back; a later prompt of that receiver may surface again', async () => {
  const h = harness();
  h.wait(['collect.example.net']);
  h.surfacer.schedule(7);
  await h.advance(S.FIREWALL_GROUP_MS);
  h.closePopup();
  h.wait([]);
  h.surfacer.observe(7, 0);
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.equal(h.popups.get(7), DEFAULT, 'setPopup with the manifest default, never the empty string');
  assert.equal(h.sets(7).includes(''), false);
  assert.equal(h.surfacer.popupOf(7), null, 'the tab is no longer followed');
  assert.equal(h.surfacer.surfacedKeys, 0);
  h.wait(['collect.example.net']);
  h.surfacer.observe(7, 1);
  await h.advance(S.FIREWALL_OPEN_INTERVAL_MS);
  assert.equal(h.opens(), 2, 'undecided again (undo, «эта вкладка» expired): one more popup');
});

test('at most one openPopup per window per 10 s: a new receiver waits for the window, then opens', async () => {
  const h = harness();
  h.wait(['a.example']);
  h.surfacer.schedule(7);
  await h.advance(S.FIREWALL_GROUP_MS);
  h.closePopup();
  h.wait(['a.example', 'b.example']);
  h.surfacer.schedule(7);
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.equal(h.opens(), 1, 'rate limited');
  assert.equal(h.surfacer.stats.rateLimited, 1);
  await h.advance(S.FIREWALL_OPEN_INTERVAL_MS);
  assert.equal(h.opens(), 2, 'opened once the 10 s window passed');
  // Another window has its own window.
  h.closePopup();
  h.wait(['z.example'], 9);
  h.surfacer.schedule(9);
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.deepEqual(h.calls.filter(([c]) => c === 'openPopup').map(([, w]) => w), [1, 1, 2]);
});

test('muted (snooze «Не беспокоить 1 час», module off, firewall feature off): popups restored, the memory ends', async () => {
  const h = harness();
  h.wait(['collect.example.net']);
  h.surfacer.schedule(7);
  await h.advance(S.FIREWALL_GROUP_MS);
  h.closePopup();
  h.setMuted(true);
  h.surfacer.scheduleAll(0);
  await h.advance(1);
  assert.equal(h.popups.get(7), DEFAULT);
  assert.equal(h.surfacer.size, 0);
  assert.equal(h.surfacer.surfacedKeys, 0);
  const opens = h.opens();
  h.surfacer.observe(7, 0);
  h.surfacer.schedule(7);
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.equal(h.opens(), opens, 'nothing opens while muted');
  assert.equal(h.sets(7).at(-1), DEFAULT);
  // Snooze over: the receiver that still waits surfaces again.
  h.setMuted(false);
  h.surfacer.observe(7, 1);
  await h.advance(S.FIREWALL_OPEN_INTERVAL_MS);
  assert.equal(h.opens(), opens + 1);
});

test('an excluded site or a tab without a prompt never gets the popup; the module off calls nothing', async () => {
  const h = harness();
  h.pending.set(7, { site: SITE, receivers: [], muted: false }); // excluded site: the module reports nothing waiting
  h.surfacer.observe(7, 0);
  h.surfacer.navigated(7);
  h.surfacer.activated(7);
  h.surfacer.forget(7);
  h.surfacer.scheduleAll(0);
  await h.advance(S.FIREWALL_SETTLE_MS * 3);
  assert.deepEqual(h.calls, [], 'untracked tabs: no browser call');
  h.surfacer.schedule(7);
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.deepEqual(h.calls, [], 'nothing waits: no setPopup');
  assert.equal(h.surfacer.size, 0);
});

test('a background tab or an unfocused window gets the per-tab popup only; activation opens it once', async () => {
  const h = harness();
  h.wait(['collect.example.net'], 8);
  h.surfacer.schedule(8);
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.deepEqual(h.calls, [['setPopup', 8, 'firewall.html?tab=8']]);
  assert.equal(h.surfacer.stats.notActive, 1);
  h.tabs.set(8, { windowId: 1, active: true });
  h.windows.set(1, false);
  h.surfacer.activated(8);
  await h.advance(1);
  assert.equal(h.opens(), 0, 'window not focused');
  assert.equal(h.surfacer.stats.notFocused, 1);
  h.windows.set(1, true);
  h.surfacer.activated(8);
  await h.advance(1);
  assert.deepEqual(h.calls.at(-1), ['openPopup', 1]);
  h.closePopup();
  h.surfacer.activated(8);
  await h.advance(S.FIREWALL_OPEN_INTERVAL_MS * 2);
  assert.equal(h.opens(), 1, 'surfaced: activation does not open it again');
});

test('openPopup rejected: not retried; the per-tab popup stays (the next click opens the firewall); restore works', async () => {
  const h = harness({ openFails: 'Failed to open popup.' });
  h.wait(['collect.example.net']);
  h.surfacer.schedule(7);
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.equal(h.surfacer.stats.openRejected, 1);
  assert.equal(h.surfacer.stats.lastOpen, 'rejected');
  assert.equal(h.surfacer.stats.lastOpenError, 'Failed to open popup.');
  assert.equal(h.popups.get(7), 'firewall.html?tab=7');
  h.surfacer.observe(7, 1);
  h.surfacer.schedule(7);
  await h.advance(S.FIREWALL_OPEN_INTERVAL_MS * 3);
  assert.equal(h.opens(), 1, 'no retry loop');
  h.wait([]);
  h.surfacer.observe(7, 0);
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.equal(h.popups.get(7), DEFAULT);
});

test('setPopup failure: no openPopup; a closed tab is forgotten', async () => {
  const h = harness();
  h.wait(['collect.example.net'], 42); // no such tab
  h.surfacer.schedule(42);
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.equal(h.opens(), 0);
  assert.equal(h.surfacer.stats.setFailures, 1);
  assert.equal(h.surfacer.popupOf(42), 'unknown');
  h.surfacer.forget(42);
  assert.equal(h.surfacer.popupOf(42), null);
});

test('service-worker restart: tabs that still show firewall.html are followed again without a new popup', async () => {
  const h = harness();
  h.popups.set(7, 'firewall.html?tab=7');
  h.wait(['collect.example.net']);
  await h.surfacer.adopt([7, 8, 9, -1, 1.5]);
  await h.advance(1);
  assert.equal(h.surfacer.stats.adopted, 1);
  assert.equal(h.opens(), 0, 'surfaced before the restart');
  assert.equal(h.surfacer.popupOf(7), 'firewall');
  assert.equal(h.surfacer.popupOf(8), null);
  h.wait([]);
  h.surfacer.observe(7, 0);
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.equal(h.popups.get(7), DEFAULT);
});

test('bounded state: followed tabs, surfaced keys and scheduled evaluations are capped', async () => {
  const h = harness();
  for (let id = 100; id < 100 + S.MAX_SURFACE_TABS + 40; id++) {
    h.tabs.set(id, { windowId: 3, active: false });
    h.wait(['r' + id + '.example', 's' + id + '.example', 't' + id + '.example'], id, 'site' + id + '.example');
    h.surfacer.schedule(id);
  }
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.ok(h.surfacer.size <= S.MAX_SURFACE_TABS, String(h.surfacer.size));
  assert.ok(h.surfacer.surfacedKeys <= S.MAX_SURFACED_KEYS);
  // Keys: many sites in a focused window, popup always open -> marked surfaced, capped.
  const g = harness();
  g.tabs.set(7, { windowId: 1, active: true });
  for (let i = 0; i < S.MAX_SURFACED_KEYS + 100; i++) {
    g.wait(['r' + i + '.example'], 7, 'site' + i + '.example');
    g.surfacer.schedule(7, 0);
    await g.advance(1);
  }
  assert.ok(g.surfacer.surfacedKeys <= S.MAX_SURFACED_KEYS, String(g.surfacer.surfacedKeys));
  // At most MAX_SURFACE_RECEIVERS receivers are read from one prompt.
  const k = harness();
  k.wait(Array.from({ length: 20 }, (_, i) => 'x' + i + '.example'));
  k.surfacer.schedule(7);
  await k.advance(S.FIREWALL_GROUP_MS);
  assert.equal(k.surfacer.surfacedKeys, S.MAX_SURFACE_RECEIVERS);
});

test('a throwing module answer is treated as nothing waiting', async () => {
  const h = harness();
  h.wait(['collect.example.net']);
  h.surfacer.schedule(7);
  await h.advance(S.FIREWALL_GROUP_MS);
  h.pending.set(7, { get site() { throw new Error('module failure'); } });
  h.surfacer.observe(7, 0);
  await h.advance(S.FIREWALL_GROUP_MS);
  assert.equal(h.popups.get(7), DEFAULT);
});

/** Text of `function <name>(` up to its closing brace at column 0. */
function fn(text, name) {
  const start = text.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' shipped');
  return text.slice(start, text.indexOf('\n}\n', start) + 2);
}

test('protect-ui.js: the main popup and the side panel carry no firewall card; firewall.html renders it', () => {
  const ui = readFileSync(join(root, 'apps/production-extension/protect-ui.js'), 'utf8');
  assert.equal(ui.includes('function ProtectPopupArea('), false, 'the vendored popup area with the card is not shipped');
  assert.ok(fn(ui, 'PopupIsland').includes('PopupProtectArea'));
  const area = fn(ui, 'PopupProtectArea');
  assert.equal(/\b(?:EvidenceList|ReplayRow)\b/.test(area), false, 'ADR-052: transfers/replay have a separate window');
  assert.ok(area.includes('FirewallLine'));
  assert.equal(/\bFirewallCard\b/.test(area), false, 'main popup: firewall line only');
  assert.equal(/\bFirewallCard\b/.test(fn(ui, 'SidepanelIsland')), false, 'side panel: no firewall card');
  assert.ok(/\bFirewallCard\b/.test(fn(ui, 'FirewallBody')), 'firewall.html renders the vendored card');
  assert.ok(fn(ui, 'FirewallLine').includes('openFirewallPage'));
  assert.ok(fn(ui, 'openFirewallPage').includes('location.href = firewallPageHref('));
  assert.ok(fn(ui, 'firewallPageHref').includes('"firewall.html?tab="'));
  const html = readFileSync(join(root, 'apps/production-extension/firewall.html'), 'utf8');
  for (const needle of ['href="ui.css"', 'href="button-surfaces.css"', 'href="protect.css"', 'class="protect-firewall-page"', '<script type="module" src="firewall.js"></script>']) assert.ok(html.includes(needle), 'firewall.html: ' + needle);
  assert.equal(/<script(?![^>]*src=)/.test(html), false, 'no inline script (CSP)');
  assert.match(readFileSync(join(root, 'apps/production-extension/firewall.js'), 'utf8'), /import \{ mountFirewallPage \} from "\.\/protect-ui\.js";/);
  const css = readFileSync(join(root, 'apps/production-extension/protect.css'), 'utf8');
  assert.match(css, /html:has\(> body\.protect-firewall-page\) \{\s*width: 400px;/);
});

test('shipped protect-sw.js wires the surfacer: badge count, evidence, decisions, navigation, tab removal, activation', () => {
  const sw = readFileSync(join(root, 'apps/production-extension/protect-sw.js'), 'utf8');
  for (const needle of [
    'surfacer.observe(tabId, pending)',
    'surfacer.schedule(event.tabId)',
    'surfacer.navigated(details.tabId)',
    'surfacer.forget(tabId)',
    'surfacer.activated(info.tabId)',
    'chrome.windows.onFocusChanged.addListener',
    'resumeFocusedFirewall(windowId',
    'chrome.action.openPopup({ windowId })',
    'chrome.action.setPopup({ tabId, popup })',
    'contextTypes: ["POPUP"]',
    'adoptFirewallPopups',
    'findingsSurfacer.schedule(event.tabId)',
    'chrome.windows.onRemoved.addListener',
  ]) assert.ok(sw.includes(needle), 'protect-sw.js: ' + needle);
  assert.match(sw, /autoOpen:\s*(?:false|!1)/, 'ADR-052: action surfacer is manual-only');
  // The default popup comes from the manifest (Chromium treats setPopup '' as no popup at all).
  assert.ok(sw.includes('chrome.runtime.getManifest().action?.default_popup'));
  assert.equal(JSON.parse(readFileSync(join(root, 'apps/production-extension/manifest.json'), 'utf8')).action.default_popup, 'popup.html');
});
