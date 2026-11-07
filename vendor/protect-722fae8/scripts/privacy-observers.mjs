// REQ-005/010/011, F070/F071: test-harness observers, never bundled into the extension.
// S15 (ADR-020 «Защита»): the window capture also records the module channel detect.expert/protect/v1; canaryNeedles
// expands a canary into the variants a careless layer could store (md5/sha1/sha256/sha512 hex and base64, URL
// encoding, Base64); installIsolatedCapture records the protect-* messages protect.js sends to the service worker.
import { createHash } from 'node:crypto';
export function belongsToExtension(url, id) {
  try { const parsed = new URL(url); return parsed.protocol === 'chrome-extension:' && parsed.host === id; }
  catch { return false; }
}

export function extensionEgress(request, id) {
  const worker = request.serviceWorker();
  let frameUrl = '';
  try { frameUrl = request.frame()?.url() ?? ''; } catch { /* Worker requests have no frame. */ }
  const fromExtension = belongsToExtension(worker?.url() ?? '', id) || belongsToExtension(frameUrl, id);
  return fromExtension && !belongsToExtension(request.url(), id) && /^(?:https?|wss?|ftp):/i.test(request.url());
}

// Retain startup events until CDP returns the installed extension's exact ID.
export function deferredExtensionEvents(consume, overflow) {
  let id = null;
  const pending = [];
  const push = (owner, event) => {
    if (id !== null) {
      if (belongsToExtension(owner, id)) consume(event);
    } else if (pending.length >= 2048) overflow();
    else pending.push({ owner, event });
  };
  return {
    push,
    setId(value) {
      if (id !== null || typeof value !== 'string' || !/^[a-p]{32}$/.test(value)) throw new Error('invalid extension observer identity');
      id = value;
      for (const entry of pending) push(entry.owner, entry.event);
      pending.length = 0;
    },
  };
}

// Serialized by Playwright into each fixture realm before fixture code executes.
export function installWireCapture() {
  // Both MAIN <-> ISOLATED channels: observation and the module «Защита» (literals: this function is serialized).
  const capture = { messages: [], bytes: 0, overflow: false, channels: { 'detect.expert/v1': 0, 'detect.expert/protect/v1': 0 } };
  Object.defineProperty(window, '__privacyWire', { value: capture });
  window.addEventListener('message', (event) => {
    const channel = event.data?.channel;
    if (event.source !== window || (channel !== 'detect.expert/v1' && channel !== 'detect.expert/protect/v1') || capture.overflow) return;
    // Check shape/cost before serialization; hostile traffic cannot allocate an unbounded capture.
    const pending = [{ value: event.data, depth: 0 }];
    let nodes = 0;
    let chars = 0;
    while (pending.length) {
      const { value, depth } = pending.pop();
      if (++nodes > 4096 || depth > 32 || (typeof value === 'string' && value.length > 16_384)) { capture.overflow = true; return; }
      if (typeof value === 'string') chars += value.length;
      if (chars > 16_384) { capture.overflow = true; return; }
      if (value && typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length > 4096 || pending.length + keys.length > 4096) { capture.overflow = true; return; }
        for (const key of keys) {
          chars += key.length;
          if (chars > 16_384) { capture.overflow = true; return; }
          pending.push({ value: value[key], depth: depth + 1 });
        }
      }
    }
    let text;
    try { text = JSON.stringify(event.data); } catch { capture.overflow = true; return; }
    if (text.length > 16_384 || capture.messages.length >= 2048 || capture.bytes + text.length * 2 > 1_048_576) { capture.overflow = true; return; }
    capture.bytes += text.length * 2;
    capture.channels[channel]++;
    capture.messages.push(JSON.parse(text));
  });
}

/**
 * Variants of a canary value that a careless layer could keep: the value and its trim+lower and digits-only forms,
 * each as is, URL-encoded, Base64 (standard and URL alphabets) and as MD5 / SHA-1 / SHA-256 / SHA-512 in hex (lower
 * and upper case) and Base64. Variants shorter than 8 characters are dropped (they would match by chance).
 */
export function canaryNeedles(canaries) {
  const needles = [];
  const seen = new Set();
  const add = (id, value) => {
    if (typeof value !== 'string' || value.length < 8 || seen.has(value)) return;
    seen.add(value);
    needles.push({ id, value });
  };
  for (const c of canaries) {
    const forms = new Set([c.value, c.value.trim().toLowerCase()]);
    const digits = c.value.replace(/\D+/g, '');
    if (digits.length >= 8) {
      forms.add(digits);
      forms.add('+' + digits);
    }
    for (const form of forms) {
      add(c.id, form);
      add(c.id + ':url', encodeURIComponent(form));
      const b64 = Buffer.from(form, 'utf8').toString('base64');
      add(c.id + ':base64', b64);
      add(c.id + ':base64url', b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
      for (const algo of ['md5', 'sha1', 'sha256', 'sha512']) {
        const digest = createHash(algo).update(form, 'utf8').digest();
        add(c.id + ':' + algo + '-hex', digest.toString('hex'));
        add(c.id + ':' + algo + '-HEX', digest.toString('hex').toUpperCase());
        add(c.id + ':' + algo + '-base64', digest.toString('base64'));
      }
    }
  }
  return needles;
}

/**
 * Records the protect-* messages of the extension's ISOLATED world of a page's top frame (chrome.runtime.sendMessage
 * wrapped through DevTools, as tests/extension/protect/support.ts isolatedWire). read() returns JSON strings.
 */
export async function installIsolatedCapture(page, extensionId) {
  const cdp = await page.context().newCDPSession(page);
  const extensionOrigin = 'chrome-extension://' + extensionId;
  let contextId = 0;
  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    const aux = context.auxData;
    if (context.origin === extensionOrigin && aux?.isDefault === false && contextId === 0) contextId = context.id;
  });
  await cdp.send('Runtime.enable');
  const deadline = Date.now() + 15_000;
  while (contextId === 0) {
    if (Date.now() > deadline) throw new Error('no ISOLATED world of the extension in the page');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { contextId, expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('isolated capture: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  await evaluate('(() => {'
    + ' if (globalThis.__privacyIsolated) return true;'
    + ' globalThis.__privacyIsolated = [];'
    + ' const original = chrome.runtime.sendMessage;'
    + ' chrome.runtime.sendMessage = function (...args) {'
    + '   try {'
    + '     const m = args[0];'
    + "     if (m && typeof m.type === 'string' && m.type.startsWith('protect-') && globalThis.__privacyIsolated.length < 2048) globalThis.__privacyIsolated.push(JSON.stringify(m));"
    + '   } catch {}'
    + '   return Reflect.apply(original, chrome.runtime, args);'
    + ' };'
    + ' return true;'
    + ' })()');
  return { read: () => evaluate('globalThis.__privacyIsolated.slice()'), detach: () => cdp.detach().catch(() => undefined) };
}

/** protect-input carries keyed fingerprints only ({enc, len, h}, h = 13 hex digits): the reasons, or [] when clean. */
export function protectInputErrors(message) {
  const errors = [];
  if (message?.type !== 'protect-input') return errors;
  const allowedTop = new Set(['schemaVersion', 'type', 'saltId', 'seq', 'fields', 'submit', 'neverReadFields', 'paymentSuspended']);
  for (const key of Object.keys(message)) if (!allowedTop.has(key)) errors.push('protect-input.' + key + ': unexpected key');
  for (const [i, field] of (Array.isArray(message.fields) ? message.fields : []).entries()) {
    for (const key of Object.keys(field ?? {})) if (!['fieldRef', 'fieldKind', 'trigger', 'entries'].includes(key)) errors.push('fields[' + i + '].' + key + ': unexpected key');
    if (!['email', 'phone', 'name'].includes(field?.fieldKind)) errors.push('fields[' + i + '].fieldKind: ' + String(field?.fieldKind));
    for (const [j, entry] of (Array.isArray(field?.entries) ? field.entries : []).entries()) {
      const keys = Object.keys(entry ?? {}).sort().join(',');
      if (keys !== 'enc,h,len') errors.push('fields[' + i + '].entries[' + j + ']: keys ' + keys);
      if (typeof entry?.h !== 'string' || !/^[0-9a-f]{13}$/.test(entry.h)) errors.push('fields[' + i + '].entries[' + j + '].h: not a 13-hex fingerprint');
      if (!Number.isInteger(entry?.len)) errors.push('fields[' + i + '].entries[' + j + '].len: not an integer');
    }
  }
  return errors;
}

export function exportErrors(response) {
  if (response?.type !== 'export-preview' || !response.preview || response.preview.redacted !== true || !response.preview.report) return ['missing or invalid redacted export preview'];
  return [];
}

// Inventory §2 permits rounded receipt times for session retention, never arbitrary epoch payloads.
export function timestampAllowed(at, value) {
  // The fresh scope-off run has the same retention schema as the observed session.
  if (at.startsWith('scope-off.storage.session.')) at = at.slice('scope-off.'.length);
  if (at === 'storage.session.index.savedAt') return value % 1000 === 0;
  if (at === 'ui-get-report(canary).observedSince') return true; // Live UI receipt time, not persisted/exported.
  return at.startsWith('storage.session.') && /\.(?:createdAt|updatedAt|lastActivityAt|firstObservationAt|firstSeenAt|lastSeenAt|boundAt)$/.test(at) && value % 1000 === 0;
}

export function exportIdentityErrors(preview) {
  const errors = [];
  const visit = (value, at, depth) => {
    if (!value || typeof value !== 'object' || depth > 32) return;
    for (const [key, child] of Object.entries(value)) {
      if (['documentKey', 'documentId', 'tabId', 'frameId', 'parentDocumentId'].includes(key)) errors.push(at + '.' + key + ': internal identity in export');
      visit(child, at + '.' + key, depth + 1);
    }
  };
  visit(preview, 'export', 0);
  return errors;
}

export function boundedConsoleValue(value) {
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  let chars = 0;
  while (pending.length) {
    const entry = pending.pop();
    if (++nodes > 4096 || entry.depth > 32) return { overflow: true };
    if (typeof entry.value === 'string') chars += entry.value.length;
    if (chars > 16_384) return { overflow: true };
    if (entry.value && typeof entry.value === 'object') {
      const keys = Object.keys(entry.value);
      if (pending.length + keys.length > 4096) return { overflow: true };
      for (const key of keys) {
        chars += key.length;
        if (chars > 16_384) return { overflow: true };
        pending.push({ value: entry.value[key], depth: entry.depth + 1 });
      }
    }
  }
  return { overflow: false, value };
}
