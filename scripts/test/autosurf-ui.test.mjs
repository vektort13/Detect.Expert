// ADR-075: actual UI state, protocol settlement, preview and privacy contracts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAutosurfUi, autosurfDraft, autosurfDraftResult, autosurfReportText, autosurfCsvCell } from '../../apps/production-extension/autosurf-ui.js';
import { createAutosurfClient, checkedAutosurfSnapshot, autosurfReportProjection } from '../../apps/production-extension/autosurf-client.js';
import { installAutosurfService } from '../../apps/production-extension/autosurf-service.js';
import { createDefaultAutosurfConfiguration, AUTOSURF_PORT, AUTOSURF_LIMITS } from '../../apps/production-extension/autosurf-shared.js';
import { AUTOSURF_UI_KEYS, AUTOSURF_UI_MESSAGES, applyAutosurfCopy } from '../production-locales-autosurf.mjs';
import { applyBrowserDebugCopy } from '../production-locales-browser-debug.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
const configuration = () => ({ ...createDefaultAutosurfConfiguration(), urls: ['https://example.test/article?PRIVATE_QUERY#PRIVATE_HASH'] });
const snapshot = () => ({ version: 1, revision: 2, configuration: configuration(), status: 'idle', phase: null, reason: null, runId: null, current: null, progress: { completed: 0, total: 0 }, startedAt: null, deadlineAt: null, remainingMs: 0, visits: [], events: [], samples: [], truncated: false, capabilities: { supported: true, reason: null, metrics: { systemCpu: true, systemMemory: true, renderer: true, gpu: false } } });
const report = () => ({ ...snapshot(), format: 'detect.expert.autosurf', formatVersion: 1, generatedAt: 1000, runId: 'run-1', status: 'completed', progress: { completed: 1, total: 1 }, visits: [{ index: 0, origin: 'https://example.test/path?PRIVATE_QUERY#PRIVATE_HASH', depth: 0, startedAt: 100, endedAt: 900, durationMs: 800, status: 'completed', scrolls: 3, hovers: 2, raw: 'PRIVATE_RAW' }], events: [{ at: 100, type: 'start', reason: null, position: 0 }], samples: [{ at: 200, systemCpuPercent: 18.2, systemMemoryUsedBytes: 1048576, systemMemoryTotalBytes: 4194304, rendererJsHeapBytes: 2048, rendererTaskDurationMs: 42, gpuPercent: 99, status: 'available', raw: 'PRIVATE_SAMPLE' }] });

function signal() { const listeners = new Set(); return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: value => { for (const fn of listeners) fn(value); } }; }
function native({ deadline = 15 } = {}) {
  const messages = [], changes = [], busy = [], calls = [], ports = [], state = {};
  const api = { runtime: { id: 'unit', getURL: path => 'chrome-extension://unit/' + path, connect: args => { calls.push(args); const onMessage = signal(), onDisconnect = signal(); const port = { onMessage, onDisconnect, postMessage: message => messages.push(message), disconnect: () => onDisconnect.emit() }; ports.push(port); return port; } }, permissions: { request: args => { calls.push(args); return Promise.resolve(true); } } };
  const env = { location: { href: 'chrome-extension://unit/options.html#autosurf' } }; env.window = { top: null }; env.window.top = env.window;
  const client = createAutosurfClient(api, { env, deadline, onChange: (value, epoch) => { changes.push(value); state.onChange?.(value, epoch); }, onBusyChange: (value, ready) => { busy.push(value); state.onBusyChange?.(value, ready); }, onIdleDisconnect: () => state.onIdleDisconnect?.() });
  return { client, api, env, messages, changes, busy, calls, ports, state, get port() { return ports.at(-1); }, response(value = snapshot(), ok = true) { ports.at(-1).onMessage.emit({ v: 1, id: messages.at(-1).id, ok, snapshot: value }); } };
}

test('all 21 Autosurfer catalogs have all 76 authored keys and no missing fallback', () => {
  assert.equal(AUTOSURF_UI_KEYS.length, 76);
  for (const language of PRODUCTION_LANGUAGES) {
    assert.deepEqual(Object.keys(AUTOSURF_UI_MESSAGES[language.id]).sort(), [...AUTOSURF_UI_KEYS].sort());
    if (language.id !== 'en') assert.notEqual(AUTOSURF_UI_MESSAGES[language.id].autosurf_subtitle, AUTOSURF_UI_MESSAGES.en.autosurf_subtitle);
  }
  assert.throws(() => applyAutosurfCopy({}, 'unknown'));
});
test('draft validation keeps configured URLs exact, rejects duplicate aliases, invalid schemes and range inversions', () => {
  const draft = autosurfDraft(configuration()); assert.deepEqual(autosurfDraftResult(draft).configuration, configuration());
  for (const value of ['javascript:alert(1)', 'file:///secret', 'https://user:pass@example.test/', 'https://example.test/\u0000']) assert.equal(autosurfDraftResult({ ...draft, urls: value }).error, 'invalid_url');
  assert.equal(autosurfDraftResult({ ...draft, urls: 'https://example.test\nhttps://example.test/' }).error, 'duplicate_url');
  assert.equal(autosurfDraftResult({ ...draft, urls: '\nhttps://example.test\nnot-url' }).line, 3);
  for (const value of ['', '-1', 'NaN', '1e3', '1.5', '4294967296']) assert.equal(autosurfDraftResult({ ...draft, seed: value }).field, 'seed');
  assert.equal(autosurfDraftResult({ ...draft, dwellMinSec: '100', dwellMaxSec: '20' }).field, 'dwellMinSec');
  assert.equal(autosurfDraftResult({ ...draft, gapMinSec: '20', gapMaxSec: '1' }).field, 'gapMinSec');
});
test('report export projects origins, bounded aggregates, null GPU and never full URL or unknown fields', () => {
  const safe = autosurfReportProjection(report()), text = autosurfReportText(report());
  assert.deepEqual(safe.configuration.urls, ['https://example.test']); assert.equal(safe.visits[0].origin, 'https://example.test'); assert.equal(safe.samples[0].gpuPercent, null);
  assert.doesNotMatch(text, /PRIVATE_QUERY|PRIVATE_HASH|PRIVATE_RAW|PRIVATE_SAMPLE/);
  assert.equal(JSON.parse(text).formatVersion, 1); assert.equal(safe.events[0].type, 'start');
  assert.throws(() => autosurfReportProjection({ ...report(), samples: Array(AUTOSURF_LIMITS.samples + 1).fill({}) }));
  assert.equal(autosurfReportProjection({ ...report(), samples: [{ at: Number.MAX_SAFE_INTEGER, systemCpuPercent: Infinity }] }).samples[0].at, null);
});
test('CSV exact preview quotes commas/newlines/quotes and neutralises spreadsheet formulas', () => {
  assert.equal(autosurfCsvCell('a,"b\nc'), '"a,""b\nc"');
  for (const text of ['=1+1', '+SUM(A1)', '-1+1', '@A1', '  =A1', '\t=1']) assert.ok(autosurfCsvCell(text).startsWith('"\''));
  const csv = autosurfReportText(report(), 'csv'); assert.match(csv, /"record","at_utc"/); assert.match(csv, /"18.2"/); assert.doesNotMatch(csv, /PRIVATE_/); assert.ok(csv.endsWith('\r\n'));
});
test('client enforces own top-level Options and rejects iframe/website commands without connecting', async () => {
  const n = native(); n.env.window.top = {};
  await assert.rejects(n.client.load(), { code: 'unauthorized' }); assert.equal(n.calls.length, 0); n.client.dispose();
  const other = native(); other.env.location.href = 'https://example.test/options.html'; await assert.rejects(other.client.start(2), { code: 'unauthorized' }); assert.equal(other.calls.length, 0); other.client.dispose();
});
test('client serialises CAS mutations and retains physical slot beyond visible timeout until late settlement', async () => {
  const n = native(); try {
    const pending = n.client.start(2); assert.deepEqual(n.calls[0], { name: AUTOSURF_PORT }); assert.deepEqual(n.messages[0].payload, { revision: 2 });
    await assert.rejects(n.client.load(), { code: 'busy' }); await assert.rejects(pending, { code: 'timeout' }); assert.equal(n.client.isBusy(), true);
    await assert.rejects(n.client.stop(2), { code: 'busy' }); n.response({ ...snapshot(), revision: 3, status: 'running' }); assert.equal(n.client.isBusy(), false); assert.equal(n.changes.at(-1).status, 'running');
    const next = n.client.stop(3); n.response({ ...snapshot(), revision: 4, status: 'stopped' }); assert.equal((await next).status, 'stopped');
  } finally { n.client.dispose(); }
});
test('client rejects malformed projections, hides pushes while inactive, and resumes after a real disconnect', async () => {
  const n = native(); try {
    const first = n.client.load(); n.port.onMessage.emit({ v: 1, id: n.messages[0].id, ok: true, snapshot: { ...snapshot(), revision: 'poison' } }); await assert.rejects(first, { code: 'invalid-input' });
    n.client.setActive(false); n.port.onMessage.emit({ v: 1, type: 'snapshot', snapshot: snapshot() }); assert.equal(n.changes.length, 0);
    const pending = n.client.load(); n.port.disconnect(); await assert.rejects(pending, { code: 'native-error' }); assert.equal(n.client.isBusy(), false);
    n.client.setActive(true); const next = n.client.load(); n.response(); await next; assert.equal(n.changes.length, 1);
  } finally { n.client.dispose(); }
});
test('metrics access invokes native permission API synchronously on the original gesture, not through SW', async () => {
  const n = native(); try { const promise = n.client.requestMetricsAccess(); assert.deepEqual(n.calls, [{ permissions: ['system.cpu', 'system.memory'] }]); assert.equal(n.messages.length, 0); await promise; assert.equal(n.client.isBusy(), false); } finally { n.client.dispose(); }
});
test('actual client and service agree on load/save/export envelopes and preserve report redaction', async () => {
  const onConnect = signal(), uiMessages = signal(), serviceMessages = signal(), disconnected = signal();
  const api = { runtime: { id: 'unit', getURL: path => 'chrome-extension://unit/' + path, onConnect, connect({ name }) { const ui = { onMessage: uiMessages, onDisconnect: disconnected, postMessage: value => serviceMessages.emit(structuredClone(value)), disconnect: () => disconnected.emit() }; onConnect.emit({ name, sender: { id: 'unit', url: 'chrome-extension://unit/options.html', frameId: 0 }, onMessage: serviceMessages, onDisconnect: disconnected, postMessage: value => uiMessages.emit(structuredClone(value)), disconnect: () => disconnected.emit() }); return ui; } }, debugger: { attach() {} }, windows: { create() {} }, scripting: { executeScript() {} } };
  let stored = configuration();
  const storage = { loadConfiguration: async () => stored, saveConfiguration: async value => { stored = structuredClone(value); }, loadCheckpoint: async () => undefined, saveCheckpoint: async () => {}, loadLastReport: async () => undefined, saveLastReport: async () => {}, dispose() {} };
  const service = installAutosurfService(api, { storage, driver: { detach: async () => {}, dispose() {} }, metrics: { capabilities: () => ({ systemCpu: false, systemMemory: false, renderer: false, gpu: false }) } });
  const env = { location: { href: 'chrome-extension://unit/options.html#autosurf' } }; env.window = { top: null }; env.window.top = env.window;
  const client = createAutosurfClient(api, { env, deadline: 1000 });
  try {
    await service.ready; const loaded = await client.load(); assert.equal(loaded.revision, 0); assert.equal(loaded.configuration.urls[0], configuration().urls[0]);
    const saved = await client.save(loaded.revision, { ...configuration(), seed: 7 }); assert.equal(saved.revision, 1); assert.equal(stored.seed, 7);
    const exported = await client.export(); assert.equal(exported.formatVersion, 1); assert.deepEqual(exported.configuration.urls, ['https://example.test']); assert.doesNotMatch(JSON.stringify(exported), /PRIVATE_QUERY|PRIVATE_HASH/);
  } finally { client.dispose(); await service.dispose(); }
});

function server() {
  const calls = [], state = { snapshot: snapshot(), onChange: null, onBusyChange: null, pending: null };
  const record = (name, payload) => { calls.push({ name, payload }); if (state.pending?.name === name) return state.pending.promise; return null; };
  const client = { isBusy: () => false, setActive: value => calls.push({ name: 'setActive', payload: value }), dispose: () => calls.push({ name: 'dispose' }),
    load: async () => { record('load'); return state.snapshot; },
    save: async (revision, config) => { const pending = record('save', { revision, configuration: structuredClone(config) }); if (pending) return pending; if (revision !== state.snapshot.revision) throw Object.assign(Error('RAW_SECRET_ERROR'), { code: 'stale-revision' }); state.snapshot = { ...state.snapshot, revision: revision + 1, configuration: config }; return state.snapshot; },
    requestMetricsAccess: () => { record('grant'); return Promise.resolve(true); }, export: async () => { record('export'); return report(); },
  };
  for (const name of ['start', 'pause', 'resume', 'stop', 'clear']) client[name] = async revision => { const pending = record(name, revision); if (pending) return pending; state.snapshot = { ...state.snapshot, revision: revision + 1, status: ({ start: 'running', pause: 'paused', resume: 'running', stop: 'stopped', clear: 'idle' })[name] }; return state.snapshot; };
  return { calls, state, client, count: name => calls.filter(call => call.name === name).length };
}
function harness(source = server(), initial = {}, locale = 'en') {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document'), listeners = new Map(), doc = { visibilityState: 'visible', addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  const slots = [], pickerSlots = [], effects = [], downloads = []; let hookSlots = slots, cursor = 0, dirty = true, tree, pickerTree, props = { active: true, ...initial };
  const hooks = { useState(initialValue) { const slot = hookSlots[cursor++] ??= { value: typeof initialValue === 'function' ? initialValue() : initialValue }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(slot.value, value)) { slot.value = value; dirty = true; } }]; }, useRef(value) { return (hookSlots[cursor++] ??= { ref: { current: value } }).ref; }, useEffect(callback, dependencies) { const slot = hookSlots[cursor++] ??= {}; if (!slot.dependencies || dependencies.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } } };
  const table = applyAutosurfCopy(applyBrowserDebugCopy({}, locale), locale);
  const { AutosurfApp } = createAutosurfUi({ ...hooks, h: (type, properties) => ({ type, props: properties }), useLocale: () => locale, translate: key => table[key]?.message ?? key, browserApi: {}, createClient: (_api, options) => { stateCallbacks(options); return source.client; }, downloadFile: (name, text) => downloads.push({ name, text }), monotonicNow: () => source.state.monotonicTime ?? performance.now() });
  function stateCallbacks(options) { source.state.onChange = options.onChange; source.state.onBusyChange = options.onBusyChange; source.state.onIdleDisconnect = options.onIdleDisconnect; }
  function render() {
    hookSlots = slots; cursor = 0; dirty = false; tree = AutosurfApp(props);
    if (initial.renderSites) { const picker = sitePicker({ nodes }); hookSlots = pickerSlots; cursor = 0; pickerTree = picker.type(picker.props); }
    while (effects.length) effects.shift()();
  }
  async function settle() { for (let i = 0; i < 8; i++) { if (dirty) render(); await turn(); } if (dirty) render(); }
  function nodes(predicate) { const out = []; const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (!node?.props) return; if (predicate(node)) out.push(node); walk(node.props.children); }; walk(tree); walk(pickerTree); return out; }
  const attr = (key, value = true) => nodes(node => node.props[key] === value)[0];
  function text(node) { if (arguments.length === 0) node = tree; return Array.isArray(node) ? node.map(value => text(value)).join(' ') : node?.props ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
  return { source, render, settle, attr, nodes, text, downloads, input(key, value) { attr('data-autosurf-field', key).props.onInput({ currentTarget: { value } }); }, click(key, value = true) { return attr(key, value).props.onClick(); }, update(next) { props = { ...props, ...next }; dirty = true; }, hide() { doc.visibilityState = 'hidden'; listeners.get('visibilitychange')?.(); }, show() { doc.visibilityState = 'visible'; listeners.get('visibilitychange')?.(); }, unmount() { for (const slot of [...slots, ...pickerSlots]) slot.cleanup?.(); if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else delete globalThis.document; } };
}
async function opened(source, props, locale) { const h = harness(source, props, locale); h.render(); await h.settle(); return h; }

test('Russian controls and permission notice name the actual Autosurfer actions', async () => {
  const source = server(); source.state.snapshot = { ...source.state.snapshot, runId: 'run-1', status: 'completed' };
  const h = await opened(source, {}, 'ru');
  try {
    assert.equal(h.attr('data-autosurf-action', 'clear').props.children, 'Очистить отчёт');
    assert.equal(h.attr('data-autosurf-action', 'pause').props['aria-label'], 'Приостановить');
    assert.equal(h.attr('data-autosurf-run-control', 'play').props['aria-label'], 'Начать');
    assert.equal(h.nodes(node => node.props['data-autosurf-run-control']).length, 3);
    assert.equal(h.attr('data-autosurf-save').props.children, 'Сохранить');
    // ADR-111: Refresh is an icon-only tool of the header cluster; its name and tooltip are the same word.
    assert.equal(h.attr('data-autosurf-refresh').props['aria-label'], 'Обновить'); assert.equal(h.attr('data-autosurf-refresh').props.title, 'Обновить'); assert.match(h.attr('data-autosurf-refresh').props.class, /workspace-tool--icon/);
    h.attr('data-autosurf-field', 'metrics').props.onChange({ currentTarget: { checked: true } }); await h.settle();
    await h.click('data-autosurf-grant'); await h.settle();
    assert.match(h.text(), /Доступ к замерам CPU и RAM разрешён\./);
    assert.doesNotMatch(h.text(), /Настройка браузера|Загрузить данные/);
  } finally { h.unmount(); }
});

test('mount loads only local state; dirty plans allow explicit Start and Save keeps its draft base CAS revision', async () => {
  const h = await opened(); try {
    assert.equal(h.source.count('load'), 1); assert.equal(h.source.count('start'), 0); assert.equal(h.source.count('grant'), 0);
    h.input('urls', 'https://next.test/'); await h.settle(); assert.equal(h.attr('data-autosurf-action', 'start').props.disabled, false);
    h.source.state.snapshot = { ...h.source.state.snapshot, revision: 9 }; h.source.state.onChange(h.source.state.snapshot); await h.settle();
    await h.click('data-autosurf-save'); await h.settle(); assert.equal(h.source.calls.find(call => call.name === 'save').payload.revision, 2); assert.ok(h.attr('data-autosurf-error')); assert.doesNotMatch(h.text(), /RAW_SECRET_ERROR/);
    h.click('data-autosurf-discard'); await h.settle(); assert.equal(h.attr('data-autosurf-field', 'urls').props.value, configuration().urls.join('\n'));
  } finally { h.unmount(); }
});
test('Save is separate from Start; run state locks configuration and exposes Pause, Resume and Stop', async () => {
  const h = await opened(); try {
    h.input('urls', 'https://next.test/'); await h.settle(); await h.click('data-autosurf-save'); await h.settle(); assert.equal(h.source.count('start'), 0);
    await h.click('data-autosurf-action', 'start'); await h.settle(); assert.equal(h.attr('data-autosurf-field', 'urls').props.disabled, true); assert.equal(h.attr('data-autosurf-action', 'pause').props.disabled, false);
    await h.click('data-autosurf-action', 'pause'); await h.settle(); assert.equal(h.attr('data-autosurf-action', 'resume').props.disabled, false); assert.equal(h.attr('data-autosurf-field', 'urls').props.disabled, true);
    await h.click('data-autosurf-action', 'stop'); await h.settle(); assert.equal(h.attr('data-autosurf-status', 'stopped').props.children, 'Stopped');
  } finally { h.unmount(); }
});

test('the top Autosurfer switch uses the existing Start/Stop endpoints and keeps a paused job ON', async () => {
  const source = server(), h = await opened(source);
  try {
    const workspace = h.nodes(node => node.props['data-autosurf-workspace'])[0];
    assert.equal(workspace.props.children[0], h.attr('data-workspace-master', 'autosurf'));
    assert.equal(h.nodes(node => node.props['data-autosurf-master']).length, 1);
    assert.equal(h.attr('data-autosurf-master').props['aria-checked'], false);
    assert.equal(h.attr('data-autosurf-action', 'stop').props.disabled, true);
    assert.equal(source.count('start'), 0); assert.equal(source.count('save'), 0);
    await h.click('data-autosurf-master'); await h.settle();
    assert.equal(h.attr('data-autosurf-action', 'start').props.disabled, true);
    assert.equal(h.attr('data-autosurf-action', 'stop').props.disabled, false);
    assert.equal(h.attr('data-autosurf-master').props['aria-checked'], true);
    await h.click('data-autosurf-action', 'pause'); await h.settle();
    assert.ok(h.attr('data-autosurf-status', 'paused')); assert.equal(h.attr('data-autosurf-master').props['aria-checked'], true);
    await h.click('data-autosurf-master'); await h.settle();
    assert.equal(source.count('start'), 1); assert.equal(source.count('stop'), 1); assert.equal(source.count('save'), 0);
    assert.equal(h.attr('data-autosurf-master').props['aria-checked'], false);
  } finally { h.unmount(); }
});

test('one explicit Play saves the entered plan then starts exactly the accepted revision', async () => {
  const h = await opened(); try {
    h.input('urls', 'https://next.test/'); await h.settle();
    await h.click('data-autosurf-run-control', 'play'); await h.settle();
    assert.deepEqual(h.source.calls.filter(call => ['save','start'].includes(call.name)).map(call => [call.name,call.name==='save'?call.payload.revision:call.payload]), [['save',2],['start',3]]);
    assert.deepEqual(h.source.state.snapshot.configuration.urls,['https://next.test/']);
    assert.equal(h.attr('data-autosurf-master').props['aria-checked'],true);
    assert.equal(h.attr('data-autosurf-save').props.disabled,true);
    assert.equal(h.source.count('grant'),0);
  } finally { h.unmount(); }
});

test('both Start controls validate an empty or invalid plan and focus its field without writing or browsing', async () => {
  for(const target of ['header','play'])for(const urls of ['', 'file:///private']){
    const source=server();source.state.snapshot={...snapshot(),configuration:{...configuration(),urls:[]}};
    const h=await opened(source);try{
      const focused=[];h.nodes(node=>node.type==='form')[0].props.ref.current={querySelector:selector=>({focus:()=>focused.push(selector),scrollIntoView(){}})};
      if(urls)h.input('urls',urls);await h.settle();
      assert.equal(h.attr('data-autosurf-master').props.disabled,false);
      if(target==='header')await h.click('data-autosurf-master');else await h.click('data-autosurf-run-control','play');await h.settle();
      assert.ok(h.attr('data-autosurf-error'));assert.equal(focused.at(-1),'[data-autosurf-field="urls"]');
      assert.equal(h.source.count('save'),0);assert.equal(h.source.count('start'),0);assert.equal(h.source.count('resume'),0);
      assert.match(h.text(),urls?/valid HTTP/:/Add sites to start/);
    }finally{h.unmount();}
  }
});

test('paused Play resumes the same run without a new Save or Start', async () => {
  const source=server();source.state.snapshot={...snapshot(),status:'paused',runId:'existing-run',progress:{completed:2,total:3},visits:[{index:0,origin:'https://example.test',status:'completed'}]};
  const h=await opened(source);try{
    assert.equal(h.attr('data-autosurf-run-control','play').props['aria-label'],'Resume');
    await h.click('data-autosurf-run-control','play');await h.settle();
    assert.equal(source.count('resume'),1);assert.equal(source.count('start'),0);assert.equal(source.count('save'),0);
    assert.equal(source.state.snapshot.runId,'existing-run');assert.equal(source.state.snapshot.progress.completed,2);assert.equal(source.state.snapshot.visits.length,1);
    assert.equal(h.attr('data-autosurf-run-control','play').props.disabled,true);
  }finally{h.unmount();}
});

test('the Save-to-Start lock prevents duplicate actions and stale input callbacks from changing the submitted plan', async () => {
  const source=server();let complete;source.state.pending={name:'save',promise:new Promise(resolve=>{complete=resolve;})};
  const h=await opened(source);try{
    h.input('urls','https://next.test/');await h.settle();const staleInput=h.attr('data-autosurf-field','urls').props.onInput;
    const pending=h.click('data-autosurf-run-control','play');
    staleInput({currentTarget:{value:'https://unexpected.test/'}});await h.click('data-autosurf-master');await h.click('data-autosurf-run-control','play');await h.settle();
    assert.equal(source.count('save'),1);assert.equal(source.count('start'),0);
    assert.equal(h.attr('data-autosurf-field','urls').props.value,'https://next.test/');
    const saved={...snapshot(),revision:3,configuration:{...configuration(),urls:['https://next.test/']}};source.state.snapshot=saved;source.state.pending=null;complete(saved);await pending;await h.settle();
    assert.equal(source.count('save'),1);assert.equal(source.count('start'),1);assert.equal(source.calls.find(call=>call.name==='start').payload,3);
  }finally{h.unmount();}
});

test('a failed Start leaves its successful Save clean and an explicit retry does not repeat that Save', async () => {
  const source=server();let reject;source.state.pending={name:'start',promise:new Promise((_,fail)=>{reject=fail;})};
  const h=await opened(source);try{
    h.input('urls','https://next.test/');await h.settle();const pending=h.click('data-autosurf-run-control','play');await h.settle();
    assert.equal(source.count('save'),1);assert.equal(source.count('start'),1);
    reject({code:'permission-required'});await pending;await h.settle();assert.ok(h.attr('data-autosurf-error'));
    assert.equal(h.attr('data-autosurf-save').props.disabled,true);assert.deepEqual(source.state.snapshot.configuration.urls,['https://next.test/']);
    source.state.pending=null;await h.click('data-autosurf-run-control','play');await h.settle();
    assert.equal(source.count('save'),1);assert.equal(source.count('start'),2);assert.equal(source.calls.filter(call=>call.name==='start').at(-1).payload,3);
  }finally{h.unmount();}
});

test('a stale draft Save cannot start or discard the entered URLs', async () => {
  const h=await opened();try{
    h.input('urls','https://next.test/');await h.settle();h.source.state.snapshot={...h.source.state.snapshot,revision:9};
    await h.click('data-autosurf-run-control','play');await h.settle();
    assert.equal(h.source.count('save'),1);assert.equal(h.source.count('start'),0);assert.ok(h.attr('data-autosurf-error'));
    assert.equal(h.attr('data-autosurf-field','urls').props.value,'https://next.test/');assert.equal(h.attr('data-autosurf-save').props.disabled,false);
  }finally{h.unmount();}
});

test('native hiding or unmount during Save prevents the dependent Start even before the visibility render', async () => {
  for(const mode of ['hide','unmount']){
    const source=server();let complete;source.state.pending={name:'save',promise:new Promise(resolve=>{complete=resolve;})};const h=await opened(source);let unmounted=false;
    try{
      h.input('urls','https://next.test/');await h.settle();const pending=h.click('data-autosurf-run-control','play');await h.settle();
      if(mode==='hide')h.hide();else{h.unmount();unmounted=true;}
      const saved={...snapshot(),revision:3,configuration:{...configuration(),urls:['https://next.test/']}};source.state.snapshot=saved;complete(saved);await pending;
      assert.equal(source.count('save'),1);assert.equal(source.count('start'),0);
      if(mode==='hide'){await h.settle();h.show();await h.settle();assert.equal(source.count('start'),0);assert.equal(h.attr('data-autosurf-field','urls').props.value,'https://next.test/');}
    }finally{if(!unmounted)h.unmount();}
  }
});

test('a newer broadcast during Save fences its old successful response before Start or draft cleanup', async () => {
  const source=server();let complete;source.state.pending={name:'save',promise:new Promise(resolve=>{complete=resolve;})};const h=await opened(source);
  try{
    h.input('urls','https://next.test/');await h.settle();const pending=h.click('data-autosurf-run-control','play');await h.settle();
    const newer={...snapshot(),revision:4,configuration:{...configuration(),urls:['https://other.test/']}};source.state.snapshot=newer;source.state.onChange(newer);await h.settle();
    complete({...snapshot(),revision:3,configuration:{...configuration(),urls:['https://next.test/']}});await pending;await h.settle();
    assert.equal(source.count('start'),0);assert.ok(h.attr('data-autosurf-error'));assert.equal(h.attr('data-autosurf-save').props.disabled,false);
    assert.equal(h.attr('data-autosurf-field','urls').props.value,'https://next.test/');assert.deepEqual(source.state.snapshot.configuration.urls,['https://other.test/']);
  }finally{h.unmount();}
});

test('an invalid retained draft cannot disable Stop for a known active run', async () => {
  const h=await opened();try{
    h.input('urls','file:///unfinished');await h.settle();const active={...snapshot(),revision:3,status:'running',runId:'existing-run'};h.source.state.snapshot=active;h.source.state.onChange(active);await h.settle();
    assert.equal(h.attr('data-autosurf-master').props['aria-checked'],true);assert.equal(h.attr('data-autosurf-run-control','stop').props.disabled,false);
    await h.click('data-autosurf-master');await h.settle();assert.equal(h.source.count('stop'),1);assert.equal(h.source.count('save'),0);assert.equal(h.source.count('start'),0);
    assert.equal(h.attr('data-autosurf-master').props['aria-checked'],false);assert.equal(h.attr('data-autosurf-field','urls').props.value,'file:///unfinished');
  }finally{h.unmount();}
});

test('visits table marks only the existing visit status with soft pills and keeps run controls typed outside the shared button skin', async () => {
  const source=server();source.state.snapshot={...snapshot(),status:'stopped',runId:'run-pills',progress:{completed:1,total:2},visits:[{index:0,origin:'https://done.test',status:'completed',durationMs:1000,depth:1,scrolls:2,hovers:1},{index:1,origin:'https://cut.test',status:'interrupted',durationMs:500,depth:0}]};
  const h=await opened(source);try{
    const pills=h.nodes(node=>typeof node.props.class==='string'&&node.props.class.startsWith('autosurf-visit-status '));assert.deepEqual(pills.map(node=>node.props.class.split('--')[1]),['completed','interrupted']);
    for(const control of h.nodes(node=>node.props['data-autosurf-run-control'])){assert.equal(control.type,'button');assert.equal(control.props.type,'button');assert.doesNotMatch(control.props.class,/(?:^| )button(?: |$)/);}
    assert.equal(h.nodes(node=>node.type==='th').length,6);
  }finally{h.unmount();}
});

test('all supported locales retain exactly three named icon controls in Play Pause Stop order', async () => {
  for(const locale of PRODUCTION_LANGUAGES){const h=await opened(undefined,undefined,locale.id);try{
    const controls=h.nodes(node=>node.props['data-autosurf-run-control']);assert.deepEqual(controls.map(node=>node.props['data-autosurf-run-control']),['play','pause','stop']);
    for(const control of controls){assert.equal(control.props.title,control.props['aria-label']);assert.ok(control.props.title&&!/^(?:autosurf_|browser_debug_)/.test(control.props.title));assert.equal(control.props.children.type,'svg');assert.equal(control.props.children.props['aria-hidden'],true);}
  }finally{h.unmount();}}
});
test('hidden sections do not load or act and do not stop a run; duplicate pending actions remain single flight', async () => {
  const source = server(); let complete; source.state.pending = { name: 'start', promise: new Promise(resolve => { complete = resolve; }) };
  const h = await opened(source); try {
    const pending = h.click('data-autosurf-action', 'start'); h.click('data-autosurf-action', 'start'); await h.settle(); assert.equal(source.count('start'), 1);
    h.update({ active: false }); await h.settle(); assert.equal(source.count('stop'), 0); assert.equal(source.calls.at(-1).name, 'setActive');
    complete({ ...source.state.snapshot, status: 'running' }); await pending; await h.settle(); assert.equal(h.attr('data-autosurf-status', 'idle').props.children, 'Ready');
    h.update({ active: true }); await h.settle(); assert.equal(source.count('load'), 2);
  } finally { h.unmount(); }
});
test('inactive initial mount and Firefox capability never start; GPU remains unavailable, not zero', async () => {
  const source = server(); source.state.snapshot.capabilities.supported = false; const h = await opened(source, { active: false });
  try { assert.equal(source.count('load'), 0); h.update({ active: true }); await h.settle(); assert.equal(h.attr('data-autosurf-action', 'start').props.disabled, true); assert.ok(h.attr('data-autosurf-unsupported')); assert.equal(h.attr('data-autosurf-metric', 'gpu').props.children, 'Unavailable'); } finally { h.unmount(); }
});
test('explicit metrics button invokes permission request immediately and export downloads frozen preview exactly', async () => {
  const source = server(); source.state.snapshot = { ...source.state.snapshot, runId: 'run-1', status: 'completed' }; const h = await opened(source);
  try {
    h.attr('data-autosurf-field', 'metrics').props.onChange({ currentTarget: { checked: true } }); await h.settle(); const grant = h.click('data-autosurf-grant'); assert.equal(source.count('grant'), 1); await grant; await h.settle();
    await h.click('data-autosurf-export', 'csv'); await h.settle(); assert.equal(h.downloads.length, 0); const preview = h.attr('data-autosurf-preview', 'csv'), textarea = h.nodes(node => node.type === 'textarea' && node.props.readOnly)[0]; assert.ok(preview); const exact = textarea.props.value;
    source.state.onChange({ ...source.state.snapshot, revision: 3 }); await h.settle(); h.click('data-autosurf-download'); assert.equal(h.downloads[0].text, exact); assert.doesNotMatch(exact, /PRIVATE_/);
    h.hide(); await h.settle(); assert.equal(h.attr('data-autosurf-preview', 'csv'), undefined); assert.equal(source.count('stop'), 0);
  } finally { h.unmount(); }
});

test('read timeout closes the orphaned port, permits one fresh load and ignores old replies', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const n = native(); t.after(() => n.client.dispose());
  const first = n.client.load(), rejected = assert.rejects(first, { code: 'timeout' }), oldPort = n.port, oldId = n.messages[0].id;
  t.mock.timers.tick(15); await rejected; assert.equal(n.client.isBusy(), false);
  await assert.rejects(n.client.start(2), { code: 'inactive' });
  const next = n.client.load(); assert.equal(n.ports.length, 2);
  await assert.rejects(n.client.recover(), { code: 'busy' }); await assert.rejects(n.client.load(), { code: 'busy' }); assert.equal(n.ports.length, 2);
  oldPort.onMessage.emit({ v: 1, id: oldId, ok: true, snapshot: { ...snapshot(), revision: 99, status: 'running' } });
  oldPort.onMessage.emit({ v: 1, type: 'snapshot', snapshot: { ...snapshot(), revision: 99 } });
  assert.equal(n.changes.length, 0); assert.equal(n.client.isBusy(), true);
  n.response(); await next; assert.equal(n.changes.at(-1).revision, 2); assert.equal(n.client.isBusy(), false);
});

test('explicit mutation recovery only loads, never replays, and must reconcile before later mutations', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const n = native(); t.after(() => n.client.dispose());
  const action = n.client.start(2), rejected = assert.rejects(action, { code: 'timeout' }), oldPort = n.port, oldId = n.messages[0].id;
  t.mock.timers.tick(15); await rejected; assert.equal(n.client.isBusy(), true); assert.equal(n.client.canRecover(), true);
  const recovery = n.client.recover(); assert.equal(n.ports.length, 2); assert.deepEqual(n.messages.map(value => value.op), ['start', 'load']);
  await assert.rejects(n.client.recover(), { code: 'busy' }); assert.equal(n.ports.length, 2);
  oldPort.onMessage.emit({ v: 1, id: oldId, ok: true, snapshot: { ...snapshot(), revision: 99, status: 'running' } }); assert.equal(n.changes.length, 0);
  const failed = assert.rejects(recovery, { code: 'timeout' }); t.mock.timers.tick(15); await failed;
  await assert.rejects(n.client.start(2), { code: 'inactive' }); assert.equal(n.messages.length, 2);
  const reconciled = n.client.load(); n.response({ ...snapshot(), revision: 3, status: 'running' }); await reconciled;
  const stop = n.client.stop(3); n.response({ ...snapshot(), revision: 4, status: 'stopped' }); await stop;
  assert.deepEqual(n.messages.map(value => value.op), ['start', 'load', 'load', 'stop']);
});

test('actual component recovers from initial load timeout with Refresh and never labels unloaded state Ready', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const source = native(), h = await opened(source, {}, 'ru'); t.after(h.unmount);
  assert.ok(h.attr('data-autosurf-status', 'not-loaded')); assert.equal(h.attr('data-autosurf-status', 'idle'), undefined);
  assert.equal(h.attr('data-autosurf-refresh').props.disabled, true);
  t.mock.timers.tick(15); await h.settle();
  assert.ok(h.attr('data-autosurf-error')); assert.equal(h.attr('data-autosurf-refresh').props.disabled, false);
  assert.equal(h.attr('data-autosurf-field', 'urls').props.disabled, true); assert.equal(source.messages.length, 1);
  const refresh = h.click('data-autosurf-refresh'); await h.settle(); assert.equal(source.messages.length, 2);
  assert.equal(h.attr('data-autosurf-refresh').props.disabled, true);
  source.response(); await refresh; await h.settle();
  assert.equal(h.attr('data-autosurf-error'), undefined); assert.equal(h.attr('data-autosurf-status', 'idle').props.children, 'Готов');
  assert.equal(h.attr('data-autosurf-field', 'urls').props.disabled, false); assert.equal(h.attr('data-autosurf-action', 'start').props.disabled, false);
});

test('actual component refresh reconciles a timed-out save without losing dirty draft or replaying it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const source = native(), h = await opened(source); t.after(h.unmount); source.response(); await h.settle();
  h.input('urls', 'https://draft.test/'); await h.settle(); const save = h.click('data-autosurf-save'); await h.settle();
  t.mock.timers.tick(15); await save; await h.settle();
  assert.equal(h.attr('data-autosurf-refresh').props.disabled, false); assert.equal(h.attr('data-autosurf-save').props.disabled, true);
  const refresh = h.click('data-autosurf-refresh'); await h.settle();
  assert.equal(h.attr('data-autosurf-field', 'urls').props.disabled, true); assert.deepEqual(source.messages.map(value => value.op), ['load', 'save', 'load']);
  source.response({ ...snapshot(), revision: 4 }); await refresh; await h.settle();
  assert.equal(h.attr('data-autosurf-field', 'urls').props.value, 'https://draft.test/'); assert.equal(h.attr('data-autosurf-error'), undefined);
  assert.equal(h.attr('data-autosurf-action', 'start').props.disabled, false, 'explicit Start will validate the preserved draft CAS');
  const retry = h.click('data-autosurf-save'); assert.equal(source.messages.at(-1).payload.revision, 2);
  source.response({ ...snapshot(), revision: 4 }); await retry; await h.settle();
});

test('actual component accepts a late mutation reply and clears only an obsolete transport error', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const source = native(), h = await opened(source); t.after(h.unmount); source.response(); await h.settle();
  const start = h.click('data-autosurf-action', 'start'); t.mock.timers.tick(15); await start; await h.settle(); assert.ok(h.attr('data-autosurf-error'));
  source.port.onMessage.emit({ v: 1, type: 'snapshot', snapshot: { ...snapshot(), revision: 3, status: 'running' } }); await h.settle(); assert.ok(h.attr('data-autosurf-error'));
  source.response({ ...snapshot(), revision: 3, status: 'running' }); await h.settle();
  assert.equal(h.attr('data-autosurf-error'), undefined); assert.equal(h.attr('data-autosurf-action', 'stop').props.disabled, false);
  const stop = h.click('data-autosurf-action', 'stop'); source.port.onMessage.emit({ v: 1, id: source.messages.at(-1).id, ok: false, error: { code: 'stale-revision' }, snapshot: { ...snapshot(), revision: 4 } }); await stop; await h.settle();
  assert.ok(h.attr('data-autosurf-error')); source.port.onMessage.emit({ v: 1, type: 'snapshot', snapshot: { ...snapshot(), revision: 5 } }); await h.settle(); assert.ok(h.attr('data-autosurf-error'));
});

test('unavailable storage cannot enable editing unread default configuration but leaves Refresh usable', async () => {
  const source = server(); source.state.snapshot = { ...snapshot(), status: 'error', reason: 'storage-unavailable', configuration: createDefaultAutosurfConfiguration() };
  const h = await opened(source); try {
    assert.equal(h.attr('data-autosurf-field', 'urls').props.disabled, true); assert.equal(h.attr('data-autosurf-refresh').props.disabled, false);
    h.input('urls', 'https://overwrite.test/'); await h.settle(); assert.equal(h.attr('data-autosurf-field', 'urls').props.value, '');
    source.state.snapshot = snapshot(); await h.click('data-autosurf-refresh'); await h.settle();
    assert.equal(h.attr('data-autosurf-field', 'urls').props.disabled, false); assert.equal(h.attr('data-autosurf-field', 'urls').props.value, configuration().urls.join('\n'));
  } finally { h.unmount(); }
});

test('known active runs retain Pause and Stop after storage failure, while unconfirmed transport gates them', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const status of ['running', 'paused']) {
    const source = native(), h = await opened(source);
    try {
      source.response({ ...snapshot(), status, reason: 'storage-unavailable', runId: 'known-run' }); await h.settle();
      assert.equal(h.attr('data-autosurf-action', 'stop').props.disabled, false);
      assert.equal(h.attr('data-autosurf-action', 'pause').props.disabled, status !== 'running');
      assert.equal(h.attr('data-autosurf-run-control', 'play').props.disabled, true);
      assert.equal(h.attr('data-autosurf-field', 'urls').props.disabled, true);
      source.port.disconnect(); await h.settle(); assert.equal(h.attr('data-autosurf-action', 'stop').props.disabled, true);
      assert.equal(h.attr('data-autosurf-action', 'pause').props.disabled, true); assert.deepEqual(source.messages.map(value => value.op), ['load', 'load']);
      source.response({ ...snapshot(), status, reason: 'storage-unavailable', runId: 'known-run' }); await h.settle();
      assert.equal(h.attr('data-autosurf-action', 'stop').props.disabled, false);
      const stop = h.click('data-autosurf-action', 'stop'); assert.equal(source.messages.at(-1).op, 'stop'); source.response({ ...snapshot(), status: 'stopped', reason: 'storage-unavailable', runId: 'known-run', revision: 3 }); await stop; await h.settle();
    } finally { h.unmount(); }
  }
});

test('actual component accepts a fresh lower revision after reconnect but rejects old-port and same-port regressions', async () => {
  const source = native(), h = await opened(source);
  try {
    source.response({ ...snapshot(), revision: 5 }); await h.settle(); const oldPort = source.port, oldId = source.messages[0].id;
    oldPort.disconnect(); await h.settle(); assert.equal(source.ports.length, 2);
    const reset = { ...snapshot(), revision: 0, configuration: { ...configuration(), urls: ['https://new-worker.test/'] } };
    source.response(reset); await h.settle(); assert.equal(h.attr('data-autosurf-field', 'urls').props.value, 'https://new-worker.test/'); assert.equal(h.attr('data-autosurf-field', 'urls').props.disabled, false);
    oldPort.onMessage.emit({ v: 1, id: oldId, ok: true, snapshot: { ...snapshot(), revision: 99 } });
    oldPort.onMessage.emit({ v: 1, type: 'snapshot', snapshot: { ...snapshot(), revision: 100 } }); await h.settle();
    assert.equal(h.attr('data-autosurf-field', 'urls').props.value, 'https://new-worker.test/');
    const newest = { ...reset, revision: 2, configuration: { ...configuration(), urls: ['https://newest.test/'] } };
    const reading = h.click('data-autosurf-refresh'); source.response({ ...reset, revision: 1 });
    source.port.onMessage.emit({ v: 1, type: 'snapshot', snapshot: newest }); await reading; await h.settle();
    assert.equal(h.attr('data-autosurf-field', 'urls').props.value, 'https://newest.test/');
    source.port.onMessage.emit({ v: 1, type: 'snapshot', snapshot: reset }); await h.settle(); assert.equal(h.attr('data-autosurf-field', 'urls').props.value, 'https://newest.test/');
  } finally { h.unmount(); }
});

test('Refresh after failed initialization uses a new read port and accepts a cleared checkpoint revision', async () => {
  const source = native(), h = await opened(source);
  try {
    source.response({ ...snapshot(), revision: 5, status: 'error', reason: 'storage-unavailable' }); await h.settle();
    assert.equal(h.attr('data-autosurf-field', 'urls').props.disabled, true); assert.equal(source.ports.length, 1);
    const refresh = h.click('data-autosurf-refresh'); await h.settle(); assert.equal(source.ports.length, 2);
    assert.deepEqual(source.messages.map(value => value.op), ['load', 'load']);
    source.response({ ...snapshot(), revision: 0, configuration: { ...configuration(), urls: ['https://stored-plan.test/'] } }); await refresh; await h.settle();
    assert.equal(h.attr('data-autosurf-field', 'urls').props.value, 'https://stored-plan.test/');
    assert.equal(h.attr('data-autosurf-field', 'urls').props.disabled, false); assert.equal(h.attr('data-autosurf-action', 'start').props.disabled, false);
  } finally { h.unmount(); }
});

const sitePicker = current => current.nodes(node => typeof node.type === 'function' && node.type.name === 'AutosurfSites')[0];

test('site picker appends to the latest manual draft without saving, starting or rebasing dirty CAS', async () => {
  const source = server(), current = await opened(source);
  try {
    const picker = sitePicker(current), manual = '  https://manual.test/article?PRIVATE_QUERY#PRIVATE_HASH  \n\n';
    // The parent receives a manual edit before its next render: the append must
    // still observe that current text, not the previous picker prop.
    current.input('urls', manual);
    const result = picker.props.onAdd(['https://catalog.test']);
    assert.equal(result.added, 1); assert.equal(result.error, null);
    await current.settle();
    assert.equal(current.attr('data-autosurf-field', 'urls').props.value, manual + 'https://catalog.test/');
    assert.equal(source.count('save'), 0); assert.equal(source.count('start'), 0);
    source.state.snapshot = { ...source.state.snapshot, revision: 9 }; source.state.onChange(source.state.snapshot); await current.settle();
    await current.click('data-autosurf-save'); await current.settle();
    assert.equal(source.calls.find(call => call.name === 'save').payload.revision, 2);
    assert.ok(current.attr('data-autosurf-error')); assert.equal(source.count('start'), 0);
    assert.equal(current.attr('data-autosurf-field', 'urls').props.value, manual + 'https://catalog.test/');
  } finally { current.unmount(); }
});

test('duplicate-only catalog addition does not dirty a saved plan', async () => {
  const source = server(); source.state.snapshot.configuration = { ...configuration(), urls: ['https://catalog.test/'] };
  const current = await opened(source);
  try {
    const result = sitePicker(current).props.onAdd(['https://catalog.test']);
    assert.equal(result.duplicates, 1); assert.equal(result.changed, false); await current.settle();
    assert.equal(current.attr('data-autosurf-save').props.disabled, true);
    assert.equal(current.attr('data-autosurf-action', 'start').props.disabled, false);
    assert.equal(source.count('save'), 0); assert.equal(source.count('start'), 0);
  } finally { current.unmount(); }
});

test('catalog overflow and invalid manual addresses leave the whole draft untouched', async () => {
  const current = await opened();
  try {
    const full = Array.from({ length: 199 }, (_, index) => 'https://manual.test/page-' + index).join('\n');
    current.input('urls', full); await current.settle();
    assert.equal(sitePicker(current).props.onAdd(['https://first.test', 'https://second.test']).error, 'limit');
    await current.settle(); assert.equal(current.attr('data-autosurf-field', 'urls').props.value, full);
    current.input('urls', 'not a web address'); await current.settle();
    assert.ok(sitePicker(current).props.onAdd(['https://first.test']).error);
    await current.settle(); assert.equal(current.attr('data-autosurf-field', 'urls').props.value, 'not a web address');
    assert.equal(current.source.count('save'), 0); assert.equal(current.source.count('start'), 0);
  } finally { current.unmount(); }
});

test('stale picker callbacks cannot add while a run, hidden UI or disconnected transport owns the plan', async () => {
  for (const mode of ['running', 'paused', 'disconnected', 'hidden', 'storage-unavailable']) {
    const source = server(), current = await opened(source);
    try {
      const callback = sitePicker(current).props.onAdd, before = current.attr('data-autosurf-field', 'urls').props.value;
      if (mode === 'disconnected') source.state.onBusyChange(false, false);
      else if (mode === 'hidden') current.hide();
      else source.state.onChange({ ...source.state.snapshot, status: mode === 'storage-unavailable' ? 'error' : mode, reason: mode === 'storage-unavailable' ? mode : null });
      await current.settle();
      assert.equal(callback(['https://stale.test']).error, 'inactive', mode);
      await current.settle(); assert.equal(current.attr('data-autosurf-field', 'urls').props.value, before, mode);
      assert.equal(sitePicker(current).props.disabled, true); assert.equal(source.count('save'), 0); assert.equal(source.count('start'), 0);
    } finally { current.unmount(); }
  }
});

test('only a healthy idle native port loss emits the reconciliation signal', async () => {
  for (const mode of ['idle', 'load', 'mutation', 'metrics', 'malformed']) {
    const source = native({ deadline: 1000 }); let losses = 0, finishMetrics;
    source.state.onIdleDisconnect = () => losses++;
    try {
      const initial = source.client.load(); source.response(); await initial;
      let pending;
      if (mode === 'load') pending = source.client.load();
      if (mode === 'mutation') pending = source.client.start(2);
      if (mode === 'metrics') { source.api.permissions.request = () => new Promise(resolve => { finishMetrics = resolve; }); pending = source.client.requestMetricsAccess(); }
      if (mode === 'malformed') { const reading = source.client.load(); source.response({ ...snapshot(), revision: 'invalid' }); await assert.rejects(reading, { code: 'invalid-input' }); }
      source.port.disconnect();
      assert.equal(losses, mode === 'idle' ? 1 : 0, mode);
      if (mode === 'metrics') { finishMetrics(false); await assert.rejects(pending, { code: 'permission-required' }); }
      else if (pending) await assert.rejects(pending, { code: 'native-error' });
      source.port.disconnect(); assert.equal(losses, mode === 'idle' ? 1 : 0, 'old port cannot emit twice');
    } finally { source.client.dispose(); }
  }
});

test('idle worker loss preserves twelve selected sites and adding them changes only the pristine draft', async () => {
  const source = native({ deadline: 1000 }), current = await opened(source, { renderSites: true });
  const empty = { ...snapshot(), configuration: { ...configuration(), urls: [] } };
  try {
    source.response(empty); await current.settle();
    current.click('data-autosurf-sites-select-page'); await current.settle();
    assert.ok(current.attr('data-autosurf-sites-selected', 12));
    source.port.disconnect(); await current.settle();
    assert.deepEqual(source.messages.map(value => value.op), ['load', 'load']);
    assert.ok(current.attr('data-autosurf-sites-selected', 12)); assert.equal(current.attr('data-autosurf-sites-add').props.disabled, true);
    source.response({ ...empty, revision: 0 }); await current.settle();
    assert.ok(current.attr('data-autosurf-sites-selected', 12)); assert.equal(current.attr('data-autosurf-sites-add').props.disabled, false);
    current.click('data-autosurf-sites-add'); await current.settle();
    assert.equal(current.attr('data-autosurf-field', 'urls').props.value.split('\n').length, 12);
    assert.ok(current.attr('data-autosurf-sites-selected', 0)); assert.equal(current.attr('data-autosurf-save').props.disabled, false);
    assert.deepEqual(source.changes.at(-1).configuration.urls, []);
    assert.deepEqual(source.messages.map(value => value.op), ['load', 'load']);
  } finally { current.unmount(); }
});

test('idle reconciliation preserves the manual draft and original CAS before an explicit catalog add and Save', async () => {
  const source = native({ deadline: 1000 }), current = await opened(source, { renderSites: true });
  const manual = '  https://manual.test/article?PRIVATE_QUERY#PRIVATE_HASH  \n\n';
  try {
    source.response(); await current.settle(); current.input('urls', manual); await current.settle();
    current.click('data-autosurf-sites-select-page'); await current.settle();
    source.port.disconnect(); await current.settle();
    const fresh = { ...snapshot(), revision: 0, configuration: { ...configuration(), urls: ['https://other-window.test/'] } };
    source.response(fresh); await current.settle();
    assert.equal(current.attr('data-autosurf-field', 'urls').props.value, manual); assert.ok(current.attr('data-autosurf-sites-selected', 12));
    current.click('data-autosurf-sites-add'); await current.settle();
    const combined = current.attr('data-autosurf-field', 'urls').props.value;
    assert.ok(combined.startsWith(manual)); assert.equal(combined.trim().split(/\n+/u).length, 13);
    assert.deepEqual(source.messages.map(value => value.op), ['load', 'load']);
    const saving = current.click('data-autosurf-save'); assert.equal(source.messages.at(-1).payload.revision, 2);
    source.port.onMessage.emit({ v: 1, id: source.messages.at(-1).id, ok: false, error: { code: 'stale-revision' }, snapshot: fresh }); await saving; await current.settle();
    assert.equal(current.attr('data-autosurf-field', 'urls').props.value, combined); assert.ok(current.attr('data-autosurf-error'));
    assert.equal(source.messages.filter(value => value.op === 'start').length, 0);
  } finally { current.unmount(); }
});

test('idle reconciliation refreshes running and restored paused state without performing any run action', async () => {
  for (const status of ['running', 'paused']) {
    const source = native({ deadline: 1000 }), current = await opened(source);
    try {
      source.response({ ...snapshot(), status: 'running', runId: 'owned-run' }); await current.settle();
      source.port.disconnect(); await current.settle();
      source.response({ ...snapshot(), revision: 0, status, reason: status === 'paused' ? 'restored' : null, runId: 'owned-run' }); await current.settle();
      assert.equal(current.attr('data-autosurf-field', 'urls').props.disabled, true);
      assert.equal(current.attr('data-autosurf-action', 'stop').props.disabled, false);
      assert.equal(current.attr('data-autosurf-action', 'pause').props.disabled, status !== 'running');
      assert.equal(current.attr('data-autosurf-run-control', 'play').props.disabled, status !== 'paused');
      assert.deepEqual(source.messages.map(value => value.op), ['load', 'load']);
    } finally { current.unmount(); }
  }
});

test('an unsuccessful automatic read stops once, keeps Refresh usable and never retries a mutation', async () => {
  for (const failure of ['timeout', 'malformed', 'disconnect', 'mutation']) {
    const source = native({ deadline: failure === 'timeout' ? 10 : 1000 }), current = await opened(source);
    try {
      source.response(); await current.settle();
      let changing;
      if (failure === 'mutation') changing = current.click('data-autosurf-action', 'start');
      source.port.disconnect(); await current.settle();
      if (failure === 'timeout') await new Promise(resolve => setTimeout(resolve, 25));
      else if (failure === 'malformed') { source.response({ ...snapshot(), revision: 'invalid' }); source.port.disconnect(); }
      else if (failure === 'disconnect') source.port.disconnect();
      await changing; await current.settle(); await current.settle();
      assert.deepEqual(source.messages.map(value => value.op), failure === 'mutation' ? ['load', 'start'] : ['load', 'load'], failure);
      assert.equal(current.attr('data-autosurf-refresh').props.disabled, false); assert.equal(sitePicker(current).props.disabled, true);
      assert.ok(current.attr('data-autosurf-error'), failure);
      const refreshing = current.click('data-autosurf-refresh'); source.response(); await refreshing; await current.settle();
      assert.equal(sitePicker(current).props.disabled, false);
    } finally { current.unmount(); }
  }
});

test('hidden loss and an explicit Refresh coalesce with the existing authoritative read', async () => {
  for (const recovery of ['visibility', 'refresh']) {
    const source = native({ deadline: 1000 }), current = await opened(source);
    try {
      source.response(); await current.settle();
      if (recovery === 'visibility') { current.hide(); await current.settle(); }
      source.port.disconnect();
      let reading;
      if (recovery === 'refresh') reading = current.click('data-autosurf-refresh');
      await current.settle();
      if (recovery === 'visibility') { assert.equal(source.messages.length, 1); current.show(); await current.settle(); }
      assert.deepEqual(source.messages.map(value => value.op), ['load', 'load']);
      source.response(); await reading; await current.settle(); await current.settle();
      assert.equal(source.messages.length, 2); assert.equal(sitePicker(current).props.disabled, false);
    } finally { current.unmount(); }
  }
});

test('rapid healthy-port losses are bounded to three automatic reads per monotonic minute', async () => {
  const source = native({ deadline: 1000 }); source.state.monotonicTime = 100;
  const current = await opened(source);
  try {
    source.response(); await current.settle();
    for (let index = 0; index < 3; index++) {
      source.port.disconnect(); await current.settle(); assert.equal(source.messages.length, index + 2);
      source.response(); await current.settle();
    }
    source.port.disconnect(); await current.settle(); assert.equal(source.messages.length, 4);
    assert.ok(current.attr('data-autosurf-error')); assert.equal(current.attr('data-autosurf-refresh').props.disabled, false);
    source.state.monotonicTime = 60100;
    const reading = current.click('data-autosurf-refresh'); source.response(); await reading; await current.settle();
    source.port.disconnect(); await current.settle(); assert.equal(source.messages.length, 6);
    source.response(); await current.settle(); assert.equal(sitePicker(current).props.disabled, false);
    assert.ok(source.messages.every(value => value.op === 'load'));
  } finally { current.unmount(); }
});

test('an idle loss between a valid mutation reply and its UI settlement waits for the existing lock', async () => {
  const source = native({ deadline: 1000 }), current = await opened(source);
  try {
    source.response(); await current.settle(); const starting = current.click('data-autosurf-action', 'start');
    source.response({ ...snapshot(), revision: 3, status: 'running' }); source.port.disconnect();
    await starting; await current.settle();
    assert.deepEqual(source.messages.map(value => value.op), ['load', 'start', 'load']);
    source.response({ ...snapshot(), revision: 0, status: 'paused', reason: 'restored' }); await current.settle();
    assert.equal(current.attr('data-autosurf-action', 'resume').props.disabled, false);
    assert.equal(source.messages.filter(value => value.op === 'start').length, 1);
  } finally { current.unmount(); }
});

test('unmounting after an idle loss never opens a replacement port', async () => {
  const source = native({ deadline: 1000 }), current = await opened(source);
  source.response(); await current.settle(); source.port.disconnect(); current.unmount(); await turn();
  assert.equal(source.ports.length, 1); assert.deepEqual(source.messages.map(value => value.op), ['load']);
});
