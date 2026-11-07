// REQ-005/010/011, F070/F071: test-harness observers, never bundled into the extension.
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
  const capture = { messages: [], bytes: 0, overflow: false };
  Object.defineProperty(window, '__privacyWire', { value: capture });
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.channel !== 'detect.expert/v1' || capture.overflow) return;
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
    capture.messages.push(JSON.parse(text));
  });
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
