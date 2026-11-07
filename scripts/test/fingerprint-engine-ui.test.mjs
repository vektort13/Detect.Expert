import test from 'node:test';
import assert from 'node:assert/strict';
import { createFingerprintEngineUi } from '../../apps/production-extension/fingerprint-engine-ui.js';
import { FINGERPRINT_ENGINE_LABELS, fingerprintEngineLabels } from '../../apps/production-extension/fingerprint-engine-labels.js';
import { DETECTOR_LABELS } from '../../apps/production-extension/detector-workspace-labels.js';
const turn = () => new Promise(done => setImmediate(done));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const snapshot = patch => ({ supported: true, status: 'ready', sequence: 1, sessionOpen: false, revision: null, partial: false, error: null, native: { status: 'idle', attached: false, workerCount: 0, bootstrappedWorkers: 0, unsupported: ['shared-worker', 'service-worker', 'worklet'] }, unsupportedFields: [], ...patch });
function harness(options = {}) {
  let props = { active: true, revision: 7, enabled: true, blocked: false, ...options.props }, locale = 'en', cursor = 0, changed = true, tree = null, mounted = true, lateWrites = 0, remote = options.state ?? snapshot();
  const slots = [], effects = [], clients = [], calls = [];
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { if (!mounted) lateWrites++; slots[index] = typeof value === 'function' ? value(slots[index]) : value; changed = true; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(effect, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((item, i) => !Object.is(item, previous.deps[i]))) { slots[index] = { deps, cleanup: previous?.cleanup }; effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); }); } },
  };
  const createClient = (_, callbacks) => {
    const client = { callbacks, disposed: false, load() { calls.push(['load']); return Promise.resolve(remote); }, start(url, revision) { calls.push(['start', url, revision]); return options.start ? options.start(url, revision) : Promise.resolve(remote = snapshot({ status: 'running', sessionOpen: true, revision })); }, stop() { calls.push(['stop']); return Promise.resolve(remote = snapshot()); }, recover() { calls.push(['recover']); return options.recover ? options.recover() : Promise.resolve(remote); }, isCertain: () => true, dispose() { calls.push(['dispose']); this.disposed = true; } };
    clients.push(client); return client;
  };
  const { FingerprintEnginePanel } = createFingerprintEngineUi({ h: (type, props) => ({ type, props }), ...hooks, useLocale: () => locale, browserApi: options.unsupported ? {} : { debugger: { attach() {} } }, createClient });
  function render() { cursor = 0; changed = false; tree = FingerprintEnginePanel(props); while (effects.length) effects.shift()(); return tree; }
  async function settle() { for (let index = 0; index < 8; index++) { if (changed && mounted) render(); await turn(); } if (changed && mounted) render(); }
  function nodes(predicate) { const found = []; function visit(value) { if (Array.isArray(value)) { value.forEach(visit); return; } if (!value?.props) return; if (predicate(value)) found.push(value); visit(value.props.children); } visit(tree); return found; }
  const attr = key => nodes(node => node.props[key] === true || key === 'data-fingerprint-engine-status' && key in node.props)[0];
  return { calls, clients, render, settle, attr, nodes, update(value) { props = { ...props, ...value }; render(); }, locale(value) { locale = value; render(); }, remote(value) { remote = value; clients.at(-1).callbacks.onChange(value); }, unmount() { for (const slot of slots) slot?.cleanup?.(); mounted = false; }, lateWrites: () => lateWrites };
}

test('native panel reads once and only explicit form submission starts the saved profile; no second master exists', async () => {
  const h = harness(); h.render(); await h.settle(); assert.deepEqual(h.calls, [['load']]); assert.equal(h.nodes(node => node.props.role === 'switch').length, 0);
  h.attr('data-fingerprint-engine-url').props.onInput({ currentTarget: { value: 'https://qa.example/owned' } }); await h.settle();
  assert.equal(h.attr('data-fingerprint-engine-start').props.disabled, false);
  const form = h.nodes(node => node.type === 'form')[0], first = form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} }); await first; await h.settle();
  assert.deepEqual(h.calls.filter(row => row[0] === 'start'), [['start', 'https://qa.example/owned', 7]]); assert.equal(h.attr('data-fingerprint-engine-close').props.disabled, false); h.unmount();
});

test('unsaved/disabled profile blocks Start while Close remains available for an existing session', async () => {
  const h = harness({ props: { blocked: true, enabled: false, revision: null }, state: snapshot({ status: 'running', sessionOpen: true, revision: 7 }) }); h.render(); await h.settle();
  assert.equal(h.attr('data-fingerprint-engine-start').props.disabled, true); assert.ok(h.attr('data-fingerprint-engine-save'));
  assert.equal(h.attr('data-fingerprint-engine-close').props.disabled, false); await h.attr('data-fingerprint-engine-close').props.onClick(); await h.settle();
  assert.equal(h.calls.filter(row => row[0] === 'stop').length, 1); assert.equal(h.calls.some(row => row[0] === 'start'), false); h.unmount();
});

test('hidden/unmounted Start ignores late UI responses, does not replay or close user work, and re-entry reads fresh state', async () => {
  const pending = deferred(), h = harness({ start: () => pending.promise }); h.render(); await h.settle();
  h.attr('data-fingerprint-engine-url').props.onInput({ currentTarget: { value: 'https://qa.example/' } }); await h.settle();
  const starting = h.nodes(node => node.type === 'form')[0].props.onSubmit(); h.update({ active: false });
  const running = snapshot({ status: 'running', sessionOpen: true, revision: 7 }); pending.resolve(running); await starting; await h.settle();
  assert.equal(h.calls.some(row => row[0] === 'stop'), false); h.remote(running); h.update({ active: true }); await h.settle();
  assert.equal(h.calls.filter(row => row[0] === 'start').length, 1); assert.equal(h.calls.filter(row => row[0] === 'load').length, 2);
  h.unmount(); h.clients.at(-1).callbacks.onChange(snapshot( { status: 'error' } )); assert.equal(h.lateWrites(), 0);
});

test('retained old submit handler cannot start after the profile becomes blocked or hidden', async () => {
  const h = harness(); h.render(); await h.settle(); const submit = h.nodes(node => node.type === 'form')[0].props.onSubmit;
  h.update({ blocked: true }); await submit(); assert.equal(h.calls.some(row => row[0] === 'start'), false);
  h.update({ blocked: false, active: false }); await submit(); assert.equal(h.calls.some(row => row[0] === 'start'), false); h.unmount();
});

test('Firefox unsupported panel never connects, starts or requests a permission', async () => {
  const h = harness({ unsupported: true }); h.render(); await h.settle(); assert.deepEqual(h.calls, []);
  assert.equal(h.attr('data-fingerprint-engine-status').props.children, FINGERPRINT_ENGINE_LABELS.en.unsupported); assert.equal(h.attr('data-fingerprint-engine-start').props.disabled, true); h.unmount();
});

test('later native partial state is visible and locale changes preserve draft URL/session without reloading', async () => {
  const h = harness(); h.render(); await h.settle(); h.attr('data-fingerprint-engine-url').props.onInput({ currentTarget: { value: 'https://qa.example/' } }); await h.settle();
  h.remote(snapshot({ status: 'running', sessionOpen: true, native: { ...snapshot().native, status: 'partial', bootstrappedWorkers: 2 } })); await h.settle();
  assert.equal(h.attr('data-fingerprint-engine-status').props.children, FINGERPRINT_ENGINE_LABELS.en.partial); assert.equal(h.attr('data-fingerprint-engine-workers').props.children, '2');
  h.locale('ar'); await h.settle(); assert.equal(h.attr('data-fingerprint-engine-url').props.value, 'https://qa.example/'); assert.equal(h.attr('data-fingerprint-engine-status').props.children, FINGERPRINT_ENGINE_LABELS.ar.partial); assert.equal(h.calls.filter(row => row[0] === 'load').length, 1); h.unmount();
});

test('all21 locales contain the same17 frozen nonempty functional labels and aliases resolve without English fallback', () => {
  assert.deepEqual(Object.keys(FINGERPRINT_ENGINE_LABELS), Object.keys(DETECTOR_LABELS)); const keys = Object.keys(FINGERPRINT_ENGINE_LABELS.en); assert.equal(keys.length, 17);
  for (const [locale, labels] of Object.entries(FINGERPRINT_ENGINE_LABELS)) { assert.equal(Object.isFrozen(labels), true); assert.deepEqual(Object.keys(labels), keys); for (const value of Object.values(labels)) assert.ok(typeof value === 'string' && value.length > 0 && value.length < 128, locale); assert.equal(fingerprintEngineLabels({ id: locale }), labels); }
  assert.equal(fingerprintEngineLabels('zh-CN'), FINGERPRINT_ENGINE_LABELS.zh_CN); assert.equal(fingerprintEngineLabels('pt-BR'), FINGERPRINT_ENGINE_LABELS.pt_BR); assert.equal(fingerprintEngineLabels('de-DE'), FINGERPRINT_ENGINE_LABELS.de);
});

test('a user Start after idle disconnect reads once then starts exactly once without a separate Refresh', async () => {
  const h = harness(); h.render(); await h.settle(); h.attr('data-fingerprint-engine-url').props.onInput({ currentTarget: { value: 'https://qa.example/' } }); await h.settle();
  h.clients[0].callbacks.onDisconnect(); await h.settle(); assert.equal(h.attr('data-fingerprint-engine-start').props.disabled, false);
  const submit = h.nodes(node => node.type === 'form')[0].props.onSubmit, first = submit(); submit(); await first; await h.settle();
  assert.deepEqual(h.calls.filter(row => row[0] === 'recover' || row[0] === 'start'), [['recover'], ['start', 'https://qa.example/', 7]]); h.unmount();
});

test('read-first Start discovers an already-open/starting session and never repeats an unknown mutation', async () => {
  for (const fresh of [snapshot({ status: 'running', sessionOpen: true }), snapshot({ status: 'starting' }), snapshot({ status: 'stopping' })]) {
    const h = harness({ recover: () => Promise.resolve(fresh) }); h.render(); await h.settle(); h.clients[0].callbacks.onDisconnect(); await h.settle();
    await h.nodes(node => node.type === 'form')[0].props.onSubmit(); await h.settle();
    assert.equal(h.calls.filter(row => row[0] === 'recover').length, 1); assert.equal(h.calls.some(row => row[0] === 'start'), false); h.unmount();
  }
});

test('pending Start recovery is fenced by new dirty/revision/hidden state and cannot double-submit', async () => {
  for (const patch of [{ blocked: true }, { revision: 8 }, { active: false }]) {
    const read = deferred(), h = harness({ recover: () => read.promise }); h.render(); await h.settle(); h.clients[0].callbacks.onDisconnect(); await h.settle();
    const submit = h.nodes(node => node.type === 'form')[0].props.onSubmit, pending = submit(); submit(); h.update(patch); read.resolve(snapshot()); await pending; await h.settle();
    assert.equal(h.calls.filter(row => row[0] === 'recover').length, 1); assert.equal(h.calls.some(row => row[0] === 'start'), false); h.unmount();
  }
});

test('idle disconnect shows unknown status without a false action error; pending action disconnect still reports failure', async () => {
  const idle = harness(); idle.render(); await idle.settle();
  idle.clients[0].callbacks.onDisconnect(); await idle.settle();
  assert.equal(idle.attr('data-fingerprint-engine-status').props['data-fingerprint-engine-status'], 'unknown');
  assert.equal(idle.attr('data-fingerprint-engine-error'), undefined);
  assert.deepEqual(idle.calls, [['load']]); idle.unmount();

  const deferredStart = deferred(), busy = harness({ start: () => deferredStart.promise }); busy.render(); await busy.settle();
  busy.attr('data-fingerprint-engine-url').props.onInput({ currentTarget: { value: 'https://qa.example/' } }); await busy.settle();
  const pending = busy.nodes(node => node.type === 'form')[0].props.onSubmit();
  busy.clients[0].callbacks.onDisconnect(); await busy.settle();
  assert.equal(busy.attr('data-fingerprint-engine-error').props.children, FINGERPRINT_ENGINE_LABELS.en.failed);
  assert.equal(busy.calls.filter(row => row[0] === 'start').length, 1);
  assert.equal(busy.calls.some(row => row[0] === 'recover'), false);
  deferredStart.reject(Object.assign(new Error('lost transport'), { code: 'disconnected' })); await pending; await busy.settle(); busy.unmount();
});
