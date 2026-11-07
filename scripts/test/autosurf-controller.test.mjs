import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { createAutosurfController, validateAutosurfCheckpoint, validateAutosurfReport } from '../../apps/production-extension/autosurf-controller.js';
import { createAutosurfStorage, installAutosurfService } from '../../apps/production-extension/autosurf-service.js';
import { createAutosurfMetrics } from '../../apps/production-extension/autosurf-metrics.js';
import { AUTOSURF_DEFAULT_CONFIGURATION, AUTOSURF_PORT, AUTOSURF_SESSION_KEY, AUTOSURF_ALARM } from '../../apps/production-extension/autosurf-shared.js';

function event() { const handlers = new Set(); return { addListener: fn => handlers.add(fn), removeListener: fn => handlers.delete(fn), emit(...args) { for (const fn of handlers) fn(...args); } }; }
const flush = async () => { for (let index = 0; index < 60; index++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture({ configuration: patch = {}, checkpoint = null, lastReport = null, firefox = false, create = null, save = null, alarmError = false, alarmCreate = null, alarmClear = null, loadConfiguration = null, links = [], challenge = null, metrics = false, makeMetrics = null, shared = null, fail = [], hang = [] } = {}) {
  let time = 1000000, sequence = 0, frameNumber = 0, config = { ...AUTOSURF_DEFAULT_CONFIGURATION, urls: ['https://owned.example/start'], dwellMinSec: 5, dwellMaxSec: 5, gapMinSec: 1, gapMaxSec: 1, order: 'sequential', ...patch }, saved = checkpoint, report = lastReport;
  const timers = new Map(), effects = [], changes = [], windows = shared?.windows ?? new Map(), tabs = shared?.tabs ?? new Map(), frames = shared?.frames ?? new Map();
  const env = { crypto: webcrypto, setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { at: time + ms, fn }); return id; }, clearTimeout(id) { timers.delete(id); } };
  const api = { runtime: { id: 'own', getURL: path => 'chrome-extension://own/' + path, onConnect: event(), ...(firefox ? { getBrowserInfo() {} } : {}) }, debugger: { async attach() {}, async detach(target) { effects.push(['recover-detach', target]); } }, scripting: { async executeScript() {} },
    windows: { onFocusChanged: event(), async create(input) { effects.push(['create', input]); if (create) return create(); const tab = { id: 9, windowId: 8, active: true, url: 'about:blank', status: 'complete' }, win = { id: 8, type: 'normal', focused: true, tabs: [tab] }; tabs.set(9, tab); windows.set(8, win); return structuredClone(win); }, async get(id) { effects.push(['window-get', id]); return structuredClone(windows.get(id)); }, async remove(id) { effects.push(['window-remove', id]); const win = windows.get(id); windows.delete(id); for (const tab of win?.tabs ?? []) { tabs.delete(tab.id); api.tabs.onRemoved.emit(tab.id); } }, async update(id, input) { effects.push(['focus', id, input]); return { id }; } },
    tabs: { onRemoved: event(), onReplaced: event(), onUpdated: event(), onActivated: event(), async get(id) { if (!tabs.has(id)) throw Error('missing'); return structuredClone(tabs.get(id)); }, async remove(id) { effects.push(['tab-remove', id]); const tab = tabs.get(id); if (!tab) throw Error('missing'); tabs.delete(id); const win = windows.get(tab.windowId); if (win) win.tabs = win.tabs.filter(item => item.id !== id); api.tabs.onRemoved.emit(id); if (win && !win.tabs.length) windows.delete(win.id); },
    async update(id, input) {
      if (input.url === undefined) { effects.push(['activate', id]); const tab = tabs.get(id); if (!tab) throw Error('missing'); Object.assign(tab, input); return structuredClone(tab); }
      effects.push(['navigate', id, input.url]);
      if (hang.some(part => input.url.includes(part))) return structuredClone(tabs.get(id));
      if (fail.some(part => input.url.includes(part))) {
        const details = { tabId: id, frameId: 0, url: input.url }, page = { tabId: id, frameId: 0, url: 'chrome-error://chromewebdata/', documentId: 'error-' + (++frameNumber) };
        queueMicrotask(() => { api.webNavigation.onBeforeNavigate.emit(details); api.webNavigation.onErrorOccurred.emit({ ...details, error: 'net::ERR_NAME_NOT_RESOLVED' }); api.webNavigation.onBeforeNavigate.emit(page); api.webNavigation.onCommitted.emit(page); });
        return structuredClone(tabs.get(id));
      }
      const tab = tabs.get(id); Object.assign(tab, { url: input.url, status: 'complete' }); const details = { tabId: id, frameId: 0, documentId: 'document-' + (++frameNumber), url: input.url }; frames.set(id, details); queueMicrotask(() => { api.webNavigation.onBeforeNavigate.emit(details); api.webNavigation.onCommitted.emit(details); api.webNavigation.onCompleted.emit(details); }); return structuredClone(tab); } },
    webNavigation: { onBeforeNavigate: event(), onCommitted: event(), onCompleted: event(), onErrorOccurred: event(), onHistoryStateUpdated: event(), onReferenceFragmentUpdated: event(), async getFrame({ tabId }) { return structuredClone(frames.get(tabId)); } },
    webRequest: { onBeforeRequest: event(), onBeforeRedirect: event(), onHeadersReceived: event() }, permissions: { onRemoved: event() }, alarms: { onAlarm: event(), async create(name, details) { effects.push(['alarm', name, details]); if (alarmError) throw Error('alarm failure'); if (alarmCreate) return alarmCreate(name, details); }, async clear() { if (alarmClear) return alarmClear(); } }, storage: { session: { async get(key) { return { [key]: saved }; }, async set(value) { saved = value[AUTOSURF_SESSION_KEY]; }, async remove() { saved = null; } } },
  };
  const driver = { async attach(id, isCurrent) { effects.push(['attach', id]); assert.equal(isCurrent(), true); }, async detach(id) { effects.push(['detach', id]); return true; }, async inspect(context) { assert.equal(context.isCurrent(), true); return { hidden: false, challenge, links, viewport: { width: 1000, height: 800 }, scroll: { x: 0, y: 0, maxY: 1000 }, hoverPoints: [] }; }, async step(context, options) { assert.equal(context.isCurrent(), true); effects.push(['step', options.kind]); return { moves: 1, wheels: options.kind === 'scroll' ? 1 : 0, hovers: options.kind === 'hover' ? 1 : 0 }; }, async sample() { return {}; } };
  const measurements = makeMetrics ? makeMetrics(api, () => time) : { calls: 0, resets: 0, reset() { this.resets++; }, capabilities: () => ({ systemCpu: true, systemMemory: true, renderer: true, gpu: false }), async sample() { this.calls++; return { at: time, systemCpuPercent: 20, systemMemoryUsedBytes: 1000, systemMemoryTotalBytes: 2000, rendererJsHeapBytes: 50, rendererTaskDurationMs: 20, gpuPercent: null, scope: 'system-and-renderer', status: 'available' }; } };
  const storage = { async loadConfiguration() { return loadConfiguration ? loadConfiguration() : structuredClone(config); }, async saveConfiguration(value) { config = structuredClone(value); }, async loadCheckpoint() { return structuredClone(saved); }, async saveCheckpoint(value) { if (save) await save(value); saved = structuredClone(value); }, async loadLastReport() { return structuredClone(report); }, async saveLastReport(value) { report = structuredClone(value); } };
  const controller = createAutosurfController(api, { driver, metrics: measurements, storage, now: () => time, env, onChange: value => changes.push(value) });
  return { api, driver, controller, storage, env, effects, changes, tabs, windows, frames, measurements, get saved() { return saved; }, get report() { return report; }, async advance(ms) { const end = time + ms; await flush(); for (let iterations = 0; iterations < 10000; iterations++) { const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; time = next[1].at; timers.delete(next[0]); next[1].fn(); await flush(); if (iterations === 9999) throw Error('timer loop'); } time = end; await flush(); }, async start() { await controller.ready; const result = await controller.command('start', { revision: controller.snapshot().revision }); await flush(); return result; }, async dispose() { await controller.dispose(); } };
}

test('ordinary finite run visits only its new window and records bounded results', async () => {
  const f = fixture({ configuration: { urls: ['https://owned.example/one', 'https://owned.example/two'] } });
  try { await f.start(); await f.advance(16000); const value = f.controller.snapshot(); assert.equal(value.status, 'completed'); assert.equal(value.visits.length, 2); assert.equal(value.progress.completed, 2); assert.deepEqual(f.effects.filter(row => row[0] === 'navigate').map(row => row[2]), ['https://owned.example/one', 'https://owned.example/two']); assert.equal(f.effects.filter(row => row[0] === 'create').length, 1); assert.equal(f.measurements.calls, 0); validateAutosurfCheckpoint(f.saved); validateAutosurfReport(f.report); } finally { await f.dispose(); }
});
test('Stop invalidates pending window creation before attachment or page actions', async () => {
  const pending = deferred(), f = fixture({ create: () => pending.promise });
  try { await f.start(); const stopped = await f.controller.command('stop', { revision: f.controller.snapshot().revision }); assert.equal(stopped.status, 'stopped'); const tab = { id: 50, windowId: 40, url: 'about:blank' }; f.windows.set(40, { id: 40, type: 'normal', tabs: [tab] }); pending.resolve({ id: 40, type: 'normal', tabs: [tab] }); await flush(); assert.equal(f.effects.some(row => ['navigate', 'attach', 'step'].includes(row[0])), false); assert.deepEqual(f.effects.filter(row => row[0] === 'window-remove'), [['window-remove', 40]]); } finally { await f.dispose(); }
});
test('late created window changed by user is never closed', async () => {
  const pending = deferred(), f = fixture({ create: () => pending.promise });
  try { await f.start(); await f.controller.command('stop', { revision: f.controller.snapshot().revision }); const original = { id: 50, windowId: 40, url: 'about:blank' }; f.windows.set(40, { id: 40, type: 'normal', tabs: [{ ...original, url: 'https://user.example/' }] }); pending.resolve({ id: 40, type: 'normal', tabs: [original] }); await flush(); assert.equal(f.effects.some(row => row[0] === 'window-remove'), false); } finally { await f.dispose(); }
});
test('startup checkpoint becomes paused, releases previous debugger, and performs no navigation', async () => {
  const first = fixture(); await first.start(); const saved = structuredClone(first.saved); await first.dispose(); const restored = fixture({ checkpoint: saved });
  try { await restored.controller.ready; assert.equal(restored.controller.snapshot().status, 'paused'); assert.equal(restored.controller.snapshot().reason, 'restored'); assert.equal(restored.saved.run.tabId, 9, 'the window stays known so that Resume can take it back'); assert.equal(restored.saved.run.windowId, 8); assert.equal(restored.effects.some(row => row[0] === 'recover-detach'), true); assert.equal(restored.effects.some(row => ['navigate', 'create', 'attach', 'step'].includes(row[0])), false); } finally { await restored.dispose(); }
});
test('failed checkpoint prevents the first browser effect and exposes storage failure', async () => {
  const f = fixture({ save: () => { throw Error('quota SECRET'); } });
  try { await f.controller.ready; await assert.rejects(f.controller.command('start', { revision: 0 }), error => error.code === 'storage-unavailable'); assert.equal(f.effects.some(row => row[0] === 'create'), false); assert.equal(f.controller.snapshot().reason, 'storage-unavailable'); assert.doesNotMatch(JSON.stringify(f.controller.snapshot()), /SECRET/); } finally { await f.dispose(); }
});
test('failed alarm cannot leave a running session without an execution loop', async () => {
  const f = fixture({ alarmError: true }); try { await f.controller.ready; await assert.rejects(f.controller.command('start', { revision: 0 }), error => error.code === 'native-error'); assert.equal(f.controller.snapshot().status, 'paused'); assert.equal(f.effects.some(row => row[0] === 'create'), false); } finally { await f.dispose(); }
});
test('Firefox can read and save configurations but cannot start a debugger run', async () => {
  const f = fixture({ firefox: true }); try { await f.controller.ready; const saved = await f.controller.command('save', { revision: 0, configuration: { ...AUTOSURF_DEFAULT_CONFIGURATION, urls: ['https://owned.example/'] } }); assert.equal(saved.capabilities.supported, false); await assert.rejects(f.controller.command('start', { revision: 1 }), error => error.code === 'unsupported'); assert.equal(f.effects.some(row => row[0] === 'create'), false); } finally { await f.dispose(); }
});
test('CAS rejects concurrent old edits without changing the saved configuration', async () => {
  const f = fixture(); try { await f.controller.ready; await f.controller.command('save', { revision: 0, configuration: { ...AUTOSURF_DEFAULT_CONFIGURATION, urls: ['https://owned.example/new'] } }); await assert.rejects(f.controller.command('save', { revision: 0, configuration: { ...AUTOSURF_DEFAULT_CONFIGURATION, urls: ['https://other.example/'] } }), error => error.code === 'stale-revision'); assert.deepEqual(f.controller.snapshot().configuration.urls, ['https://owned.example/new']); } finally { await f.dispose(); }
});
test('manual same-origin navigation during interaction pauses before further page effects', async () => {
  const f = fixture(); try { await f.start(); await f.advance(1200); const before = f.effects.filter(row => row[0] === 'step').length; f.api.webNavigation.onBeforeNavigate.emit({ tabId: 9, frameId: 0, url: 'https://owned.example/account' }); await flush(); assert.equal(f.controller.snapshot().reason, 'manual-navigation'); await f.advance(10000); assert.equal(f.effects.filter(row => row[0] === 'step').length, before); } finally { await f.dispose(); }
});
test('unexpected same-origin commit during loading is not an authorized redirect', async () => {
  const f = fixture(); f.api.tabs.update = async (id, input) => { f.effects.push(['navigate', id, input.url]); f.api.webNavigation.onCommitted.emit({ tabId: id, frameId: 0, documentId: 'manual-doc', url: 'https://owned.example/account' }); return { id }; };
  try { await f.start(); await flush(); assert.equal(f.controller.snapshot().status, 'paused'); assert.equal(f.controller.snapshot().reason, 'manual-navigation'); assert.equal(f.effects.some(row => row[0] === 'step'), false); } finally { await f.dispose(); }
});
test('the expected opening about:blank commit is allowed before the first navigation', async () => {
  const f = fixture(); f.driver.attach = async id => { f.effects.push(['attach', id]); f.api.webNavigation.onCommitted.emit({ tabId: id, frameId: 0, documentId: 'blank-document', url: 'about:blank' }); };
  try { await f.start(); await f.advance(7000); assert.equal(f.controller.snapshot().status, 'completed'); } finally { await f.dispose(); }
});
test('blur during attach pauses before navigating the first page', async () => {
  const f = fixture(); f.driver.attach = async id => { f.effects.push(['attach', id]); f.api.windows.onFocusChanged.emit(500); };
  try { await f.start(); await flush(); assert.equal(f.controller.snapshot().reason, 'window-blurred'); assert.equal(f.effects.some(row => row[0] === 'navigate'), false); } finally { await f.dispose(); }
});
test('switching tabs in the owned window pauses immediately', async () => {
  const f = fixture(); try { await f.start(); await f.advance(1200); f.api.tabs.onActivated.emit({ windowId: 8, tabId: 123 }); await flush(); assert.equal(f.controller.snapshot().reason, 'window-blurred'); } finally { await f.dispose(); }
});
test('closed or manually taken-over tabs are released and Resume creates a fresh owned window', async () => {
  const f = fixture(); try { await f.start(); await f.advance(1200); f.api.tabs.onRemoved.emit(9); await flush(); assert.equal(f.saved.run.tabId, null); await f.controller.command('resume', { revision: f.controller.snapshot().revision }); await flush(); assert.equal(f.effects.filter(row => row[0] === 'create').length, 2); assert.equal(f.controller.snapshot().status, 'running'); } finally { await f.dispose(); }
});
test('only native-confirmed same-origin redirect chain may commit', async () => {
  const f = fixture(); f.api.tabs.update = async (id, input) => { f.effects.push(['navigate', id, input.url]); const common = { tabId: id, type: 'main_frame', requestId: 'r1', url: input.url }; f.api.webRequest.onBeforeRequest.emit(common); f.api.webRequest.onBeforeRedirect.emit({ ...common, redirectUrl: 'https://owned.example/article' }); const details = { tabId: id, frameId: 0, documentId: 'redirected', url: 'https://owned.example/article' }; f.frames.set(id, details); f.tabs.set(id, { id, windowId: 8, url: details.url, status: 'complete' }); f.api.webNavigation.onCommitted.emit(details); f.api.webNavigation.onCompleted.emit(details); return { id }; };
  try { await f.start(); await f.advance(7000); assert.equal(f.controller.snapshot().status, 'completed'); } finally { await f.dispose(); }
});
function redirectUpdate(f, targets, { requestId = 'root-request', redirectRequestId = requestId, sourceUrl = null, beforeRequest = true } = {}) {
  return async (id, input) => {
    f.effects.push(['navigate', id, input.url]);
    const common = { tabId: id, type: 'main_frame', requestId }; let url = input.url;
    if (beforeRequest) f.api.webRequest.onBeforeRequest.emit({ ...common, url });
    for (const target of targets) { const redirected = new URL(target).href; f.api.webRequest.onBeforeRedirect.emit({ ...common, requestId: redirectRequestId, url: sourceUrl ?? url, redirectUrl: target }); url = redirected; f.api.webRequest.onBeforeRequest.emit({ ...common, url }); }
    const details = { tabId: id, frameId: 0, documentId: 'redirected-document', url }; f.frames.set(id, details); Object.assign(f.tabs.get(id), { url, status: 'complete' });
    f.api.webNavigation.onCommitted.emit(details); f.api.webNavigation.onCompleted.emit(details); return { id };
  };
}
test('explicit default80 root upgrades only through its native default443 redirect and tracks final origin', async () => {
  const f = fixture({ configuration: { urls: ['http://owned.example:80/start?USER=1'], depth: 1, scroll: false, hover: false }, links: ['https://owned.example/read/internal', 'http://owned.example/read/old', 'https://other.example/read'] });
  const ordinary = f.api.tabs.update;
  f.api.tabs.update = (id, input) => input.url.startsWith('http:') ? redirectUpdate(f, ['http://owned.example/redirect', 'https://owned.example:443/final/OBSERVED_PATH?OBSERVED_QUERY=1', 'https://owned.example/final/OBSERVED_FINAL?OBSERVED_TOKEN=1'])(id, input) : ordinary(id, input);
  try {
    await f.start(); await f.advance(1200);
    assert.equal(f.controller.snapshot().current.origin, 'https://owned.example'); assert.equal(f.controller.snapshot().current.url, 'http://owned.example/start?USER=1');
    assert.equal(f.saved.run.currentUrl, 'http://owned.example/start?USER=1'); assert.doesNotMatch(JSON.stringify(f.saved), /OBSERVED_/);
    await f.advance(7000);
    assert.deepEqual(f.effects.filter(row => row[0] === 'navigate').map(row => row[2]), ['http://owned.example/start?USER=1', 'https://owned.example/read/internal']);
    assert.equal(f.controller.snapshot().visits[0].origin, 'https://owned.example'); assert.doesNotMatch(JSON.stringify(f.saved), /OBSERVED_|read\/internal/);
    await f.advance(7000); assert.equal(f.controller.snapshot().status, 'completed'); assert.equal(f.controller.snapshot().visits[1].origin, 'https://owned.example'); assert.doesNotMatch(JSON.stringify(f.report), /OBSERVED_|read\/internal|USER=1/);
  } finally { await f.dispose(); }
});
for (const [label, root, target] of [
  ['nondefault HTTP source port', 'http://owned.example:8080/start', 'https://owned.example/end'],
  ['nondefault HTTPS destination port', 'http://owned.example/start', 'https://owned.example:8443/end'],
  ['HTTPS downgrade', 'https://owned.example/start', 'http://owned.example/end'],
  ['www expansion', 'http://owned.example/start', 'https://www.owned.example/end'],
  ['different hostname', 'http://owned.example/start', 'https://other.example/end'],
  ['hostname trailing-dot change', 'http://owned.example./start', 'https://owned.example/end'],
  ['userinfo destination', 'http://owned.example/start', 'https://user:pass@owned.example/end'],
]) test('root redirect refuses ' + label, async () => {
  const f = fixture({ configuration: { urls: [root] } }); f.api.tabs.update = redirectUpdate(f, [target]);
  try { await f.start(); await flush(); assert.equal(f.controller.snapshot().status, 'paused'); assert.equal(f.controller.snapshot().reason, 'external-navigation'); assert.equal(f.effects.some(row => row[0] === 'step'), false); } finally { await f.dispose(); }
});
for (const [label, options] of [['missing native request', { beforeRequest: false }], ['different native request ID', { redirectRequestId: 'unrelated-request' }], ['different native source URL', { sourceUrl: 'http://owned.example/foreign-request' }]]) test('upgrade is not authorized by ' + label, async () => {
  const f = fixture({ configuration: { urls: ['http://owned.example/start'] } }); f.api.tabs.update = redirectUpdate(f, ['https://owned.example/end'], options);
  try { await f.start(); await flush(); assert.equal(f.controller.snapshot().status, 'paused'); assert.equal(f.controller.snapshot().reason, 'external-navigation'); assert.equal(f.effects.some(row => row[0] === 'step'), false); } finally { await f.dispose(); }
});
test('upgrade followed by a downgrade cannot reopen the HTTP origin', async () => {
  const f = fixture({ configuration: { urls: ['http://owned.example/start'] } }); f.api.tabs.update = redirectUpdate(f, ['https://owned.example/end', 'http://owned.example/back', 'https://owned.example/end']);
  try { await f.start(); await flush(); assert.equal(f.controller.snapshot().status, 'paused'); assert.equal(f.controller.snapshot().reason, 'external-navigation'); assert.equal(f.effects.some(row => row[0] === 'step'), false); } finally { await f.dispose(); }
});
test('the root upgrade exception does not expand the redirect scope of discovered HTTP links', async () => {
  const f = fixture({ configuration: { urls: ['http://owned.example/start'], depth: 1, scroll: false, hover: false }, links: ['http://owned.example/read/internal'] }); const ordinary = f.api.tabs.update;
  f.api.tabs.update = (id, input) => input.url.endsWith('/read/internal') ? redirectUpdate(f, ['https://owned.example/read/upgraded'])(id, input) : ordinary(id, input);
  try { await f.start(); await f.advance(9000); assert.equal(f.controller.snapshot().status, 'paused'); assert.equal(f.controller.snapshot().reason, 'external-navigation'); assert.equal(f.controller.snapshot().visits.length, 1); } finally { await f.dispose(); }
});
test('dwell/gap and selected links remain stable when pointer actions and their latency change', async () => {
  async function trace({ scroll, hover, latency }) {
    const f = fixture({ configuration: { urls: ['https://owned.example/start'], depth: 1, seed: 321, dwellMinSec: 8, dwellMaxSec: 12, gapMinSec: 2, gapMaxSec: 5, scroll, hover }, links: ['https://owned.example/read/a', 'https://owned.example/read/b', 'https://owned.example/read/c'] });
    const ordinary = f.driver.step; f.driver.step = async (...args) => { const result = await ordinary(...args); if (latency) await new Promise(resolve => f.env.setTimeout(resolve, latency)); return result; };
    try {
      await f.start(); await f.advance(45000); assert.equal(f.controller.snapshot().status, 'completed');
      const settings = []; let previous = null;
      for (const row of f.changes) {
        const key = row.phase + ':' + row.current?.depth + ':' + row.progress.completed;
        if (key === previous) continue; previous = key;
        if (row.phase === 'interacting' || row.phase === 'gap') settings.push([row.phase, row.remainingMs]);
      }
      return { settings, routes: f.effects.filter(row => row[0] === 'navigate').map(row => row[2]), actions: f.effects.filter(row => row[0] === 'step').length };
    } finally { await f.dispose(); }
  }
  const passive = await trace({ scroll: false, hover: false, latency: 0 }), active = await trace({ scroll: true, hover: true, latency: 0 }), delayed = await trace({ scroll: true, hover: false, latency: 1800 });
  assert.equal(passive.actions, 0); assert.ok(active.actions > 0); assert.ok(delayed.actions > 0);
  assert.deepEqual(active.settings, passive.settings); assert.deepEqual(delayed.settings, passive.settings); assert.deepEqual(active.routes, passive.routes); assert.deepEqual(delayed.routes, passive.routes);
});
for (const [label, invoke, reason] of [['403', f => f.api.webRequest.onHeadersReceived.emit({ tabId: 9, type: 'main_frame', statusCode: 403 }), 'http-403'], ['429', f => f.api.webRequest.onHeadersReceived.emit({ tabId: 9, type: 'main_frame', statusCode: 429 }), 'http-429'], ['native Cloudflare challenge', f => f.api.webRequest.onHeadersReceived.emit({ tabId: 9, type: 'main_frame', statusCode: 200, responseHeaders: [{ name: 'cf-mitigated', value: 'challenge' }] }), 'challenge'], ['closed tab', f => f.api.tabs.onRemoved.emit(9), 'tab-closed'], ['replaced tab', f => f.api.tabs.onReplaced.emit(19, 9), 'tab-replaced'], ['window blur', f => f.api.windows.onFocusChanged.emit(77), 'window-blurred'], ['permission revoke', f => f.api.permissions.onRemoved.emit({ permissions: ['debugger'] }), 'permission-revoked']]) test(label + ' pauses the active run', async () => { const f = fixture(); try { await f.start(); await f.advance(1200); invoke(f); await flush(); assert.equal(f.controller.snapshot().status, 'paused'); assert.equal(f.controller.snapshot().reason, reason); } finally { await f.dispose(); } });
test('a challenge-platform resource alone does not pause navigation', async () => { const f = fixture(); try { await f.start(); f.api.webRequest.onHeadersReceived.emit({ tabId: 9, type: 'script', statusCode: 200, url: 'https://owned.example/cdn-cgi/challenge-platform/h/g/scripts/precursor/0123456789ab/main.js' }); await f.advance(7000); assert.equal(f.controller.snapshot().status, 'completed'); } finally { await f.dispose(); } });
test('visible challenge stops interaction before dispatching a mouse or wheel event', async () => { const f = fixture({ challenge: 'visible-challenge' }); try { await f.start(); await f.advance(1200); assert.equal(f.controller.snapshot().reason, 'challenge'); assert.equal(f.effects.some(row => row[0] === 'step'), false); } finally { await f.dispose(); } });
test('discovered navigation is bounded, filtered and never persisted as a raw page-derived URL', async () => {
  const f = fixture({ configuration: { depth: 1 }, links: ['https://owned.example/read/private-article', 'https://owned.example/logout', 'https://owned.example/read?secret=x', 'https://other.example/'] });
  try { await f.start(); await f.advance(8000); assert.equal(f.effects.filter(row => row[0] === 'navigate')[1][2], 'https://owned.example/read/private-article'); assert.doesNotMatch(JSON.stringify(f.saved), /private-article/); assert.doesNotMatch(JSON.stringify(f.report), /private-article|secret=x/); await f.advance(7000); assert.equal(f.controller.snapshot().visits.length, 2); } finally { await f.dispose(); }
});
test('report retains the completed run configuration after editing the next run', async () => {
  const f = fixture({ configuration: { seed: 7, urls: ['https://owned.example/a?SECRET=1'] } });
  try { await f.start(); await f.advance(7000); const before = f.controller.exportReport(); await f.controller.command('save', { revision: f.controller.snapshot().revision, configuration: { ...AUTOSURF_DEFAULT_CONFIGURATION, urls: ['https://new.example/'], seed: 9 } }); const after = f.controller.exportReport(); assert.equal(after.configuration.seed, 7); assert.deepEqual(after.configuration, before.configuration); assert.doesNotMatch(JSON.stringify(after), /SECRET/); } finally { await f.dispose(); }
});
test('durable redacted report survives a new browser session without acquiring old tab authority', async () => {
  const first = fixture(); await first.start(); await first.advance(7000); const report = first.report; await first.dispose(); const fresh = fixture({ lastReport: report });
  try { await fresh.controller.ready; assert.equal(fresh.controller.snapshot().status, 'completed'); assert.equal(fresh.controller.snapshot().visits.length, 1); assert.equal(fresh.effects.some(row => ['navigate', 'create', 'attach'].includes(row[0])), false); await fresh.controller.command('clear', { revision: 0 }); assert.equal(fresh.controller.snapshot().visits.length, 0); assert.equal(fresh.report.visits.length, 0); } finally { await fresh.dispose(); }
});
test('metrics are opt-in, numeric, scoped and reset at run transitions', async () => { const f = fixture({ configuration: { metrics: true } }); try { await f.start(); await f.advance(7000); assert.equal(f.measurements.calls, 1); assert.equal(f.controller.snapshot().samples[0].scope, 'system-and-renderer'); assert.equal(f.controller.snapshot().samples[0].gpuPercent, null); assert.ok(f.measurements.resets >= 2); } finally { await f.dispose(); } });
for (const permission of ['system.cpu', 'system.memory']) test(permission + ' revocation invalidates the real pending metrics context before late CPU settlement', async () => {
  const pending = deferred(), cpuValue = { processors: [{ usage: { user: 20, kernel: 0, idle: 80, total: 100 } }] }; let cpuCalls = 0, memoryCalls = 0, rendererCalls = 0, captured;
  const f = fixture({ configuration: { metrics: true }, makeMetrics(api, now) {
    api.permissions.contains = async () => true;
    api.system = { cpu: { getInfo() { cpuCalls++; return pending.promise; } }, memory: { async getInfo() { memoryCalls++; return { capacity: 1000, availableCapacity: 400 }; } } };
    const real = createAutosurfMetrics(api, { now }), sample = real.sample;
    real.sample = (context, driver) => { captured = context; return sample(context, driver); }; return real;
  } });
  f.driver.sample = async () => { rendererCalls++; return { jsHeapBytes: 100, taskDurationMs: 5 }; };
  try {
    await f.start(); await f.advance(1200); assert.equal(cpuCalls, 1); assert.equal(captured.isCurrent(), true);
    const before = f.effects.filter(row => row[0] === 'step').length;
    f.api.permissions.onRemoved.emit({ permissions: [permission] });
    assert.equal(captured.isCurrent(), false, 'native permission event synchronously fences the actual metrics context');
    pending.resolve(cpuValue); await flush();
    assert.equal(f.controller.snapshot().status, 'paused'); assert.equal(f.controller.snapshot().reason, 'permission-revoked');
    assert.equal(f.controller.snapshot().samples.length, 0); assert.equal(f.saved.run.samples.length, 0); assert.equal(f.report.samples.length, 0);
    assert.equal(memoryCalls, 0); assert.equal(rendererCalls, 0);
    await f.advance(20000); assert.equal(f.effects.filter(row => row[0] === 'step').length, before); assert.equal(cpuCalls, 1);
  } finally { pending.resolve(cpuValue); await f.dispose(); }
});
test('hardware permission removal does not pause a run with metrics disabled', async () => {
  const f = fixture({ configuration: { metrics: false } });
  try { await f.start(); await f.advance(1200); f.api.permissions.onRemoved.emit({ permissions: ['system.cpu', 'system.memory'] }); await flush(); assert.equal(f.controller.snapshot().status, 'running'); await f.advance(7000); assert.equal(f.controller.snapshot().status, 'completed'); assert.equal(f.measurements.calls, 0); } finally { await f.dispose(); }
});
test('corrupted checkpoints fail closed without executing browser operations', async () => { const f = fixture({ checkpoint: { version: 1, run: { status: 'running', tabId: 123 } } }); try { await f.controller.ready; assert.equal(f.controller.snapshot().status, 'error'); assert.equal(f.effects.length, 0); } finally { await f.dispose(); } });
test('session storage timeout keeps its physical slot until actual settlement', async () => {
  const pending = deferred(), f = fixture(), storage = createAutosurfStorage({ storage: { session: { get: () => pending.promise } } }, { env: f.env });
  try { const first = storage.loadCheckpoint(); await flush(); await f.advance(10001); await assert.rejects(first, error => error.code === 'storage-unavailable'); await assert.rejects(storage.loadCheckpoint(), error => error.code === 'busy'); pending.resolve({}); await flush(); assert.equal(await storage.loadCheckpoint(), undefined); } finally { storage.dispose(); await f.dispose(); }
});
test('privileged port rejects website and non-Options extension senders', async () => {
  const f = fixture(), service = installAutosurfService(f.api, { env: f.env, storage: f.storage, driver: f.driver, metrics: f.measurements });
  try { await service.ready; for (const url of ['https://owned.example/', 'chrome-extension://own/popup.html']) { let disconnected = false; f.api.runtime.onConnect.emit({ name: AUTOSURF_PORT, sender: { id: 'own', url, frameId: 0 }, disconnect() { disconnected = true; } }); assert.equal(disconnected, true); } assert.equal(f.effects.some(row => row[0] === 'create'), false); } finally { await service.dispose(); await f.dispose(); }
});

test('a stalled startup alarm clear cannot hang load or repeat physical cleanup; settlement enables explicit Resume', async () => {
  const pending = deferred(); let clears = 0;
  const f = fixture({ alarmClear: () => { clears++; return pending.promise; } });
  try {
    const reading = f.controller.command('load'); await f.advance(10001);
    assert.equal((await reading).status, 'idle'); assert.equal(clears, 1);
    for (let index = 0; index < 5; index++) { f.api.alarms.onAlarm.emit({ name: AUTOSURF_ALARM }); await f.controller.command('load'); }
    assert.equal(clears, 1);
    await assert.rejects(f.controller.command('start', { revision: 0 }), error => error.code === 'native-error');
    assert.equal(f.controller.snapshot().status, 'paused'); assert.equal(f.effects.some(row => row[0] === 'create'), false);
    pending.resolve(true); await flush();
    const resumed = await f.controller.command('resume', { revision: f.controller.snapshot().revision }); assert.equal(resumed.status, 'running');
    await flush(); assert.equal(f.effects.filter(row => row[0] === 'create').length, 1);
  } finally { pending.resolve(true); await f.dispose(); }
});

test('watchdog create timeout holds its native slot and cleans late completion before another run', async () => {
  const pending = deferred(); let creates = 0, clears = 0;
  const f = fixture({ alarmCreate: () => { creates++; return creates === 1 ? pending.promise : undefined; }, alarmClear: () => { clears++; } });
  try {
    await f.controller.ready;
    const starting = f.controller.command('start', { revision: 0 }); const rejected = assert.rejects(starting, error => error.code === 'native-error');
    await f.advance(10001); await rejected;
    assert.equal(f.controller.snapshot().status, 'paused'); assert.equal(creates, 1); assert.equal(clears, 1);
    for (let index = 0; index < 3; index++) await assert.rejects(f.controller.command('resume', { revision: f.controller.snapshot().revision }), error => error.code === 'native-error');
    assert.equal(creates, 1); assert.equal(f.effects.some(row => row[0] === 'create'), false);
    pending.resolve(); await flush(); assert.equal(clears, 2);
    await f.controller.command('resume', { revision: f.controller.snapshot().revision }); await flush();
    assert.equal(creates, 2); assert.equal(f.effects.filter(row => row[0] === 'create').length, 1);
  } finally { pending.resolve(); await f.dispose(); }
});

test('dispose is bounded while native alarm clear remains unresolved', async () => {
  const pending = deferred(); let stalled = false, clears = 0;
  const f = fixture({ alarmClear: () => { clears++; return stalled ? pending.promise : undefined; } });
  await f.controller.ready; stalled = true;
  const disposing = f.dispose(); await f.advance(10001); await disposing;
  assert.equal(clears, 2); pending.resolve(); await flush(); assert.equal(clears, 2);
  await assert.rejects(f.controller.command('load'), error => error.code === 'inactive');
});

test('failed startup load retries once per shared read and preserves the stored plan before editing', async () => {
  const pending = deferred(), saved = { ...AUTOSURF_DEFAULT_CONFIGURATION, urls: ['https://saved.example/original'] }; let loads = 0;
  const f = fixture({ loadConfiguration: () => { loads++; if (loads === 1) throw Error('temporary storage failure'); return pending.promise; } });
  try {
    await f.controller.ready; assert.equal(f.controller.snapshot().reason, 'storage-unavailable');
    await assert.rejects(f.controller.command('save', { revision: 0, configuration: { ...saved, urls: ['https://overwrite.example/'] } }), error => error.code === 'storage-unavailable');
    const reads = Array.from({ length: 6 }, () => f.controller.command('load')); await flush(); assert.equal(loads, 2);
    pending.resolve(saved); const snapshots = await Promise.all(reads);
    for (const snapshot of snapshots) { assert.equal(snapshot.status, 'idle'); assert.equal(snapshot.reason, null); assert.deepEqual(snapshot.configuration.urls, saved.urls); }
    assert.equal(loads, 2); assert.equal(f.effects.some(row => ['create', 'attach', 'navigate'].includes(row[0])), false);
    await f.controller.command('save', { revision: 0, configuration: { ...saved, urls: ['https://saved.example/edited'] } });
    assert.deepEqual((await f.controller.command('load')).configuration.urls, ['https://saved.example/edited']); assert.equal(loads, 2);
  } finally { pending.resolve(saved); await f.dispose(); }
});

test('late initialization after dispose cannot install stored configuration or publish a recovered state', async () => {
  const pending = deferred(), f = fixture({ loadConfiguration: () => pending.promise });
  await f.dispose(); const before = f.controller.snapshot(), changes = f.changes.length;
  pending.resolve({ ...AUTOSURF_DEFAULT_CONFIGURATION, urls: ['https://late.example/'] }); await f.controller.ready;
  assert.deepEqual(f.controller.snapshot(), before); assert.equal(f.changes.length, changes); assert.equal(f.saved, null);
});

test('the first load observes one failed initialization; only a later load retries it', async () => {
  const pending = deferred(); let loads = 0;
  const saved = { ...AUTOSURF_DEFAULT_CONFIGURATION, urls: ['https://saved.example/'] };
  const f = fixture({ loadConfiguration: () => ++loads === 1 ? pending.promise : saved });
  try {
    const reading = f.controller.command('load'); pending.reject(Error('transient storage failure'));
    assert.equal((await reading).reason, 'storage-unavailable'); assert.equal(loads, 1);
    const retried = await f.controller.command('load'); assert.equal(loads, 2); assert.equal(retried.status, 'idle'); assert.deepEqual(retried.configuration.urls, saved.urls);
  } finally { pending.resolve(saved); await f.dispose(); }
});

test('a later runtime storage failure never reinitializes over the existing run', async () => {
  let loads = 0, failWrites = false;
  const f = fixture({ loadConfiguration: () => { loads++; return { ...AUTOSURF_DEFAULT_CONFIGURATION, urls: ['https://owned.example/start'] }; }, save: () => { if (failWrites) throw Error('quota'); } });
  try {
    await f.start(); const runId = f.controller.snapshot().runId; failWrites = true;
    await assert.rejects(f.controller.command('pause', { revision: f.controller.snapshot().revision }), error => error.code === 'storage-unavailable');
    const loaded = await f.controller.command('load'); assert.equal(loads, 1); assert.equal(loaded.runId, runId); assert.equal(loaded.reason, 'storage-unavailable');
  } finally { failWrites = false; await f.dispose(); }
});

const named = (f, name) => f.effects.filter(row => row[0] === name);
const revision = f => ({ revision: f.controller.snapshot().revision });
test('a finished run closes the window it created and forgets it', async () => {
  const f = fixture(); try {
    await f.start(); await f.advance(9000); const value = f.controller.snapshot(); assert.equal(value.status, 'completed');
    assert.deepEqual(named(f, 'window-remove'), [['window-remove', 8]]); assert.equal(f.windows.size, 0, 'no window is left behind');
    assert.equal(f.saved.run.tabId, null); assert.equal(f.saved.run.windowId, null); assert.equal(f.controller.snapshot().status, 'completed', 'closing the window does not read as a closed tab');
    assert.ok(f.effects.findIndex(row => row[0] === 'detach') < f.effects.findIndex(row => row[0] === 'window-remove'), 'the debugger lets go before the window closes');
  } finally { await f.dispose(); }
});
test('Pause keeps the window for Resume; Stop closes it, also from the paused state', async () => {
  const f = fixture(); try {
    await f.start(); await f.advance(1200); await f.controller.command('pause', revision(f)); await f.advance(10);
    assert.equal(named(f, 'window-remove').length, 0); assert.equal(f.saved.run.tabId, 9); assert.equal(f.windows.size, 1);
    const stopped = await f.controller.command('stop', revision(f)); assert.equal(stopped.status, 'stopped');
    assert.deepEqual(named(f, 'window-remove'), [['window-remove', 8]]); assert.equal(f.windows.size, 0); assert.equal(f.saved.run.tabId, null);
  } finally { await f.dispose(); }
});
test('Stop of a running run closes its window before reporting', async () => {
  const f = fixture(); try {
    await f.start(); await f.advance(1200); const stopped = await f.controller.command('stop', revision(f)); assert.equal(stopped.status, 'stopped');
    assert.deepEqual(named(f, 'window-remove'), [['window-remove', 8]]); assert.equal(f.windows.size, 0); assert.equal(f.saved.run.windowId, null);
  } finally { await f.dispose(); }
});
test('Clear closes the window a paused run left behind', async () => {
  const f = fixture(); try {
    await f.start(); await f.advance(1200); await f.controller.command('pause', revision(f)); await f.advance(10);
    const cleared = await f.controller.command('clear', revision(f)); assert.equal(cleared.status, 'idle');
    assert.deepEqual(named(f, 'window-remove'), [['window-remove', 8]]); assert.equal(f.windows.size, 0);
  } finally { await f.dispose(); }
});
test('a new Start closes the window a paused run left behind before it opens its own', async () => {
  const f = fixture(); try {
    await f.start(); await f.advance(1200); await f.controller.command('pause', revision(f)); await f.advance(10);
    await f.controller.command('start', revision(f)); await f.advance(1200);
    const closed = f.effects.findIndex(row => row[0] === 'window-remove'), creates = f.effects.map((row, index) => row[0] === 'create' ? index : -1).filter(index => index >= 0);
    assert.equal(creates.length, 2); assert.ok(closed > creates[0] && closed < creates[1], 'the old window closes first'); assert.equal(f.windows.size, 1, 'exactly one window stays open');
  } finally { await f.dispose(); }
});
test('tabs the user added keep their window: only the tab of the run is closed', async () => {
  const f = fixture(); try {
    await f.start(); await f.advance(1200); const extra = { id: 20, windowId: 8, active: false, url: 'https://user.example/' }; f.windows.get(8).tabs.push(extra); f.tabs.set(20, extra);
    await f.controller.command('stop', revision(f));
    assert.deepEqual(named(f, 'tab-remove'), [['tab-remove', 9]]); assert.equal(named(f, 'window-remove').length, 0); assert.equal(f.windows.get(8).tabs.length, 1); assert.equal(f.tabs.has(20), true);
  } finally { await f.dispose(); }
});
test('a window or tab the run no longer owns is released, never closed', async () => {
  const gone = fixture(); try {
    await gone.start(); await gone.advance(1200); gone.windows.delete(8); gone.tabs.delete(9);
    const stopped = await gone.controller.command('stop', revision(gone)); assert.equal(stopped.status, 'stopped'); assert.equal(named(gone, 'window-remove').length + named(gone, 'tab-remove').length, 0);
  } finally { await gone.dispose(); }
  const moved = fixture(); try {
    await moved.start(); await moved.advance(1200); moved.windows.get(8).tabs = [{ id: 30, windowId: 8, active: true }]; moved.tabs.set(30, moved.windows.get(8).tabs[0]);
    await moved.controller.command('stop', revision(moved)); assert.equal(named(moved, 'window-remove').length + named(moved, 'tab-remove').length, 0, 'a window that no longer holds our tab is left alone');
  } finally { await moved.dispose(); }
});
test('a restored run takes its own window back on Resume instead of opening a second one', async () => {
  const first = fixture(); await first.start(); await first.advance(1200);
  const saved = structuredClone(first.saved), shared = { windows: first.windows, tabs: first.tabs, frames: first.frames }; await first.dispose();
  const restored = fixture({ checkpoint: saved, shared });
  try {
    await restored.controller.ready; assert.equal(restored.controller.snapshot().reason, 'restored');
    await restored.controller.command('resume', revision(restored)); await restored.advance(1200);
    assert.equal(named(restored, 'create').length, 0, 'no second window'); assert.deepEqual(named(restored, 'activate'), [['activate', 9]], 'the tab is brought to the front (a popup may have taken it)');
    assert.equal(restored.controller.snapshot().status, 'running'); assert.equal(restored.windows.size, 1); assert.equal(restored.saved.run.windowId, 8);
  } finally { await restored.dispose(); }
});
test('a restored run whose tab is gone or was taken over opens a fresh window and closes nothing of the old one', async () => {
  for (const mode of ['gone', 'foreign site', 'moved']) {
    const first = fixture(); await first.start(); await first.advance(1200);
    const saved = structuredClone(first.saved), shared = { windows: first.windows, tabs: first.tabs, frames: first.frames }; await first.dispose();
    if (mode === 'gone') { shared.tabs.delete(9); shared.windows.delete(8); }
    else if (mode === 'foreign site') shared.frames.set(9, { tabId: 9, frameId: 0, documentId: 'user-page', url: 'https://elsewhere.example/page' });
    else shared.tabs.get(9).windowId = 77;
    const fresh = () => { const tab = { id: 90, windowId: 80, active: true, url: 'about:blank', status: 'complete' }, win = { id: 80, type: 'normal', focused: true, tabs: [tab] }; shared.tabs.set(90, tab); shared.windows.set(80, win); return structuredClone(win); };
    const restored = fixture({ checkpoint: saved, shared, create: fresh });
    try {
      await restored.controller.ready; await restored.controller.command('resume', revision(restored)); await restored.advance(1200);
      assert.equal(named(restored, 'create').length, 1, mode); assert.equal(named(restored, 'window-remove').length + named(restored, 'tab-remove').length, 0, mode + ': the old window is not ours to close any more');
      assert.equal(restored.saved.run.tabId, 90, mode); assert.equal(restored.controller.snapshot().status, 'running', mode);
      if (mode !== 'gone') assert.equal(shared.windows.has(8), true, mode + ': the taken-over window is left to its user');
    } finally { await restored.dispose(); }
  }
});
test('a site that cannot be loaded is skipped and recorded; the run goes on and completes', async () => {
  const f = fixture({ configuration: { urls: ['https://owned.example/bad-1', 'https://owned.example/ok-1', 'https://owned.example/bad-2', 'https://owned.example/ok-2'] }, fail: ['/bad-'] });
  try {
    await f.start(); await f.advance(40000); const value = f.controller.snapshot();
    assert.equal(value.status, 'completed'); assert.equal(value.progress.completed, 4); assert.deepEqual(value.visits.map(row => row.status), ['interrupted', 'completed', 'interrupted', 'completed']);
    assert.deepEqual(value.events.filter(row => row.type === 'error').map(row => row.reason), ['navigation-error', 'navigation-error']);
    assert.equal(named(f, 'window-remove').length, 1, 'the window closes once at the end'); assert.equal(f.windows.size, 0);
  } finally { await f.dispose(); }
});
test('the browser error page of a failed load is not a navigation by someone else', async () => {
  const f = fixture({ configuration: { urls: ['https://owned.example/bad-1', 'https://owned.example/ok-1'] }, fail: ['/bad-'] });
  try {
    await f.start(); await f.advance(3000); const value = f.controller.snapshot();
    assert.equal(value.status, 'running'); assert.notEqual(value.reason, 'external-navigation'); assert.notEqual(value.reason, 'manual-navigation');
    assert.equal(named(f, 'navigate').length >= 2, true, 'the next site is already being loaded');
  } finally { await f.dispose(); }
});
test('three failed loads in a row pause the run (the network is probably down) and keep its window', async () => {
  const f = fixture({ configuration: { urls: ['https://owned.example/bad-1', 'https://owned.example/bad-2', 'https://owned.example/bad-3', 'https://owned.example/ok-1'] }, fail: ['/bad-'] });
  try {
    await f.start(); await f.advance(20000); const value = f.controller.snapshot();
    assert.equal(value.status, 'paused'); assert.equal(value.reason, 'navigation-error'); assert.equal(value.progress.completed, 2); assert.equal(value.visits.length, 2);
    assert.equal(named(f, 'window-remove').length, 0); assert.equal(f.windows.size, 1);
  } finally { await f.dispose(); }
});
test('a site that never answers is skipped after the navigation timeout', async () => {
  const f = fixture({ configuration: { urls: ['https://owned.example/slow', 'https://owned.example/ok-1'] }, hang: ['/slow'] });
  try {
    await f.start(); await f.advance(80000); const value = f.controller.snapshot();
    assert.equal(value.status, 'completed'); assert.deepEqual(value.visits.map(row => row.status), ['interrupted', 'completed']); assert.deepEqual(value.events.filter(row => row.type === 'error').map(row => row.reason), ['navigation-timeout']);
  } finally { await f.dispose(); }
});
test('failed loads that are not in a row never pause the run', async () => {
  const f = fixture({ configuration: { urls: ['https://owned.example/bad-1', 'https://owned.example/ok-1', 'https://owned.example/bad-2', 'https://owned.example/ok-2', 'https://owned.example/bad-3', 'https://owned.example/ok-3'] }, fail: ['/bad-'] });
  try {
    await f.start(); await f.advance(80000); const value = f.controller.snapshot();
    assert.equal(value.status, 'completed'); assert.equal(value.progress.completed, 6); assert.equal(value.visits.filter(row => row.status === 'interrupted').length, 3, 'three skipped sites, never three in a row');
  } finally { await f.dispose(); }
});
function externalRedirect(f) {
  const original = f.api.tabs.update; let redirected = false;
  f.api.tabs.update = async (id, input) => {
    if (input.url === undefined || input.url === 'about:blank' || redirected) return original(id, input);
    redirected = true; f.effects.push(['navigate', id, input.url]);
    const common = { tabId: id, type: 'main_frame', requestId: 'r1', url: input.url };
    f.api.webRequest.onBeforeRequest.emit(common); f.api.webRequest.onBeforeRedirect.emit({ ...common, redirectUrl: 'https://elsewhere.example/landing' });
    return { id };
  };
}
test('a redirect to another site pauses the run, keeps its window and puts the tab back to a blank page', async () => {
  const f = fixture(); externalRedirect(f);
  try {
    await f.start(); await f.advance(1500); const value = f.controller.snapshot();
    assert.equal(value.status, 'paused'); assert.equal(value.reason, 'external-navigation'); assert.equal(f.saved.run.tabId, 9, 'the tab is still ours');
    assert.equal(named(f, 'navigate').at(-1)[2], 'about:blank', 'no foreign site keeps running in our window');
    const stopped = await f.controller.command('stop', revision(f)); assert.equal(stopped.status, 'stopped'); assert.deepEqual(named(f, 'window-remove'), [['window-remove', 8]]); assert.equal(f.windows.size, 0);
  } finally { await f.dispose(); }
});
test('Resume after a redirect to another site takes the same window back and finishes the run', async () => {
  const f = fixture(); externalRedirect(f);
  try {
    await f.start(); await f.advance(1500); assert.equal(f.controller.snapshot().reason, 'external-navigation');
    await f.controller.command('resume', revision(f)); for (let step = 0; step < 12; step++) await f.advance(1000); const value = f.controller.snapshot();
    assert.equal(named(f, 'create').length, 1, 'no second window'); assert.equal(value.status, 'completed'); assert.equal(f.windows.size, 0, 'closed at the end');
  } finally { await f.dispose(); }
});
test('a history change by the page itself pauses the run but does not release its window', async () => {
  const f = fixture();
  try {
    await f.start(); await f.advance(1500); f.api.webNavigation.onHistoryStateUpdated.emit({ tabId: 9, frameId: 0, url: 'https://owned.example/start#route' }); await f.advance(10);
    assert.equal(f.controller.snapshot().status, 'paused'); assert.equal(f.controller.snapshot().reason, 'manual-navigation'); assert.equal(f.saved.run.tabId, 9, 'a script of the page is not a user taking over the tab');
    await f.controller.command('stop', revision(f)); assert.deepEqual(named(f, 'window-remove'), [['window-remove', 8]]);
  } finally { await f.dispose(); }
});
test('a skipped site is closed: the tab goes back to a blank page before the next site, and that blank page is not a navigation by someone else', async () => {
  const f = fixture({ configuration: { urls: ['https://owned.example/bad-1', 'https://owned.example/ok-1'] }, fail: ['/bad-'] });
  try {
    await f.start(); for (let step = 0; step < 16; step++) await f.advance(1000); const value = f.controller.snapshot();
    assert.deepEqual(named(f, 'navigate').map(row => row[2]), ['https://owned.example/bad-1', 'about:blank', 'https://owned.example/ok-1']);
    assert.equal(value.status, 'completed'); assert.deepEqual(value.visits.map(row => row.status), ['interrupted', 'completed']);
  } finally { await f.dispose(); }
});
test('the stale end of the previous navigation (a replaced retry of a dead page) is not a failure of the site that is loading', async () => {
  const f = fixture({ configuration: { urls: ['https://owned.example/slow'] }, hang: ['/slow'] });
  try {
    await f.start(); await f.advance(1500); assert.equal(f.controller.snapshot().phase, 'navigating');
    f.api.webNavigation.onErrorOccurred.emit({ tabId: 9, frameId: 0, url: 'https://owned.example/old', error: 'net::ERR_ABORTED' }); await f.advance(10);
    assert.equal(f.controller.snapshot().status, 'running'); assert.equal(f.controller.snapshot().phase, 'navigating', 'an error of another URL does not end this load');
    f.api.webNavigation.onErrorOccurred.emit({ tabId: 9, frameId: 0, url: 'https://owned.example/slow', error: 'net::ERR_CONNECTION_REFUSED' }); await f.advance(10);
    assert.equal(f.controller.snapshot().status, 'completed'); assert.deepEqual(f.controller.snapshot().visits.map(row => row.status), ['interrupted']);
  } finally { await f.dispose(); }
});
test('an error that arrives between two sites belongs to the previous one and pauses nothing', async () => {
  const f = fixture({ configuration: { urls: ['https://owned.example/ok-1', 'https://owned.example/ok-2'] } });
  try {
    await f.start(); for (let step = 0; step < 13; step++) await f.advance(500); assert.equal(f.controller.snapshot().phase, 'gap');
    f.api.webNavigation.onErrorOccurred.emit({ tabId: 9, frameId: 0, url: 'https://owned.example/ok-1', error: 'net::ERR_CONNECTION_REFUSED' }); await f.advance(10);
    assert.equal(f.controller.snapshot().status, 'running');
  } finally { await f.dispose(); }
});
test('a navigation error while a page is being worked on still pauses the run', async () => {
  const f = fixture();
  try {
    await f.start(); await f.advance(1500); assert.equal(f.controller.snapshot().phase, 'interacting');
    f.api.webNavigation.onErrorOccurred.emit({ tabId: 9, frameId: 0, url: 'https://owned.example/unrelated', error: 'net::ERR_FAILED' }); await f.advance(10);
    assert.equal(f.controller.snapshot().status, 'paused'); assert.equal(f.controller.snapshot().reason, 'navigation-error');
  } finally { await f.dispose(); }
});
