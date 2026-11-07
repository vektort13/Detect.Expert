// REQ-004/005/011/012: untrusted MAIN names/script metadata, requested by the SW.
export function startCookieWriterBridge(env, readRows) {
  const descriptor = Object.getOwnPropertyDescriptor, ownKeys = Reflect.ownKeys, hasOwn = Object.hasOwn;
  const field = (value, key) => value && typeof value === 'object' ? descriptor(value, key)?.value : undefined;
  const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && ownKeys(value).length === names.length && names.every(name => hasOwn(descriptor(value, name) ?? {}, 'value'));
  let pending = null, sequence = 0, nextReadAt = -Infinity;
  const empty = () => ({ schemaVersion: 1, type: 'cookie-writers-cache', available: false, rows: [], truncated: true });
  const finish = (available, rows = [], truncated = true) => {
    if (!pending) return;
    const current = pending; pending = null; env.cancel(current.timer); nextReadAt = env.now() + 500;
    current.respond(available ? { schemaVersion: 1, type: 'cookie-writers-cache', available: true, rows, truncated } : empty());
  };
  env.onPage((sameWindow, data) => {
    if (!sameWindow || !pending || !pending.posted || field(data, 'channel') !== 'detect.expert/cookie-writers/v1' || field(data, 'type') !== 'cookie-writers-batch' || field(data, 'requestId') !== pending.requestId) return;
    if (pending.admitted++ >= 8 || !exact(data, ['channel', 'type', 'requestId', 'enabled', 'rows', 'truncated']) || typeof field(data, 'enabled') !== 'boolean' || typeof field(data, 'truncated') !== 'boolean') return;
    const rows = readRows(field(data, 'rows'));
    if (!rows || JSON.stringify(rows).length * 2 > 24576) return;
    finish(field(data, 'enabled'), rows, field(data, 'truncated'));
  });
  env.onCommand((trusted, data, respond) => {
    if (!trusted || !exact(data, ['schemaVersion', 'type']) || field(data, 'schemaVersion') !== 1 || field(data, 'type') !== 'cookie-writers-query') return false;
    if (pending || sequence >= 2147483647) { respond(empty()); return false; }
    const current = { requestId: 'cookie-writers-' + ++sequence, respond, admitted: 0, timer: null, posted: false }; pending = current;
    const post = () => {
      if (pending !== current) return;
      current.posted = true; current.timer = env.later(() => finish(false), 400);
      env.post({ channel: 'detect.expert/cookie-writers/v1', type: 'cookie-writers-read', requestId: current.requestId });
    };
    const delay = Math.max(0, nextReadAt - env.now());
    if (delay) current.timer = env.later(post, delay); else post();
    return true;
  });
  env.onHide(() => finish(false));
}

export const cookieWriterBridgeRuntimeSource = '  // packages/collector/src/cookie-writers.ts\n  var startCookieWriterBridge = (' + startCookieWriterBridge.toString() + ');\n  function startBrowserCookieWriterBridge() {\n    startCookieWriterBridge({\n      onPage: listener => window.addEventListener("message", event => listener(event.source === window, event.data)),\n      onCommand: listener => chrome.runtime.onMessage.addListener((message, sender, respond) => listener(isOwnServiceWorker(sender), message, respond)),\n      onHide: listener => window.addEventListener("pagehide", listener),\n      post: message => window.postMessage(message, "*"),\n      later: (callback, delay) => setTimeout(callback, delay), cancel: timer => clearTimeout(timer), now: () => performance.now(),\n    }, readCookieWriterRows);\n  }\n\n';
