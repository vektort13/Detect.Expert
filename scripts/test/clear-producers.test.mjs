// ADR-073: exercise the actual patched production producers in memory, without profiles or build writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import ts, { parse, forEachChild } from '../production/clear-reset-ast.mjs';
import { patchProducer } from '../production/clear-producer-patches.mjs';

const read = file => readFileSync(new URL('../../apps/production-extension/' + file, import.meta.url), 'utf8');
const sources = Object.fromEntries(['bridge.js', 'hook.early.js', 'hook.main.js'].map(file => [file, read(file)]));
const patched = Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, patchProducer(source, file)]));
// These complete untouched tails were proved byte-identical against the pre-port delivered files.
const UNCHANGED_TAIL_HASHES = {
  'bridge.js': 'be98514ef5c81f51d5f5198d8a4484f4453c9c000e08efe0411594c30e89fd5d',
  'hook.early.js': 'bb95ab5e294ba51a8c7f57d3e54a5f40f4938aeca1744610642fb311d024f134',
  'hook.main.js': '0aab7454d30e5ecce393742ff61e0163a0905ca99a5217f290791c53bfd71942',
};
const hash = text => createHash('sha256').update(text).digest('hex');
function section(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start + ' boundary');
  return source.slice(from, to);
}
function find(source, predicate) {
  const tree = parse(source, 'test-source.js'), nodes = [];
  function visit(node) { if (predicate(node)) nodes.push(node); forEachChild(node, visit); }
  visit(tree); return { tree, nodes };
}
function memberText(source, className, name) {
  const { tree, nodes } = find(source, node => ts.isClassExpression(node) && node.parent.name?.text === className);
  assert.equal(nodes.length, 1);
  const member = nodes[0].members.find(node => name === 'constructor' ? ts.isConstructorDeclaration(node) : node.name?.text === name);
  assert.ok(member, className + '.' + name); return member.getText(tree);
}
function scheduler() {
  let now = 0, next = 0;
  const timers = new Map();
  return { now: () => now, set(fn, delay) { const id = ++next; timers.set(id, { at: now + delay, fn }); return id; }, clear(id) { timers.delete(id); }, advance(delay) {
    const until = now + delay;
    for (let count = 0; count < 10000; count++) {
      const found = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!found) { now = until; return; }
      now = found[1].at; timers.delete(found[0]); found[1].fn();
    }
    throw Error('unbounded producer timers');
  }, get size() { return timers.size; } };
}
const settle = async () => { for (let turn = 0; turn < 6; turn++) await Promise.resolve(); };
function fixture(hook = 'hook.main.js') {
  const clock = scheduler(), page = {}, sent = [], posted = [], sensorMessages = [];
  let bridgeWindow, control, sensor, mainListener, random = 0, responder = batch => Promise.resolve({ schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: batch.batchSeq, paused: false, protocolOk: true });
  const bridgeContext = vm.createContext({ console });
  const bridgeCode = section(patched['bridge.js'], '  // packages/contracts/src/technique-ids.ts', '  // packages/contracts/src/visual-preview.ts') +
    section(patched['bridge.js'], '  // packages/collector/src/rate-limit.ts', '  // packages/collector/src/visual.ts');
  vm.runInContext(bridgeCode, bridgeContext);
  const isolated = {
    onWindowMessage(fn) { bridgeWindow = fn; }, onPageShow() {}, onPageHide() {}, onControlMessage(fn) { control = fn; },
    postToPage(message) { posted.push(message); if (mainListener) mainListener({ source: page, data: message }); },
    sendToBackground(batch) { sent.push(batch); return responder(batch); }, isContextAlive: () => true,
    now: clock.now, setTimer: clock.set, clearTimer: clock.clear,
    randomHex(bytes) { return (++random).toString(16).padStart(bytes * 2, '0'); },
  };
  const collector = bridgeContext.startCollector(isolated);
  const main = vm.createContext({
    console, API_RESULTS_CHANNEL: 'detect.expert/api-results/v1', createHookContext: () => ({ enabled: true, observerErrors: 0 }),
    ApiResultRecorder: class { clear() {} record() {} recordPro() {} },
    bindValueCapturePolicy() {}, onValueCaptureDenied() {}, registerValueCaptureRealm() {},
  });
  const hookCode = section(patched[hook], '  // packages/contracts/src/technique-ids.ts', '  // packages/contracts/src/visual-preview.ts') +
    section(patched[hook], '  // packages/sensors/src/intrinsics.ts', '  // packages/sensors/src/social-network.ts') +
    section(patched[hook], '  // packages/sensors/src/runtime.ts', '  // packages/sensors/src/visual-activity.ts');
  vm.runInContext(hookCode, main);
  sensor = new main.SensorRuntime({ self: page, now: clock.now, startedLate: false, earlyCaptureGuaranteed: true,
    randomBytes: bytes => new Uint8Array(bytes).fill(++random),
    postMessage(message) { let exception; try { bridgeContext.sensorMessage(message); } catch (error) { exception = error.stack; } sensorMessages.push({ message, validation: bridgeContext.validateSensorMessage(message), exception }); bridgeWindow(true, message); }, addEventListener(type, fn) { if (type === 'message') mainListener = fn; }, removeEventListener() {},
    readMessage: event => event, setTimeout: clock.set, clearTimeout: clock.clear,
  });
  sensor.start();
  assert.equal(sensor.snapshot().handshake, true, JSON.stringify({ sensor: sensor.snapshot(), collector: collector.snapshot(), posted, sensorMessages }));
  const record = (id, count = 1) => { for (let i = 0; i < count; i++) sensor.record(main.TECHNIQUE_INDEX[id], main.PHASE_INDEX.attempted, main.SIGNAL_BIT['api-use']); };
  return { sensor, collector, clock, sent, posted, main, bridgeContext, record,
    reset: id => control(true, { schemaVersion: 1, type: 'bridge-control', command: 'reset', resetId: id }),
    emit: message => bridgeWindow(true, message), setResponder(fn) { responder = fn; },
    close() { collector.stop('unload'); sensor.stop('local'); },
  };
}

test('patches all three actual files, is idempotent, and keeps unrelated production modules exact', () => {
  for (const file of Object.keys(sources)) {
    assert.ok(patched[file].includes(file === 'bridge.js' ? 'physicalPending' : 'clear-reset:sensor-intrinsics:start'));
    assert.equal(patchProducer(patched[file], file), patched[file]);
    parse(patched[file], file);
  }
  for (const file of ['hook.early.js', 'hook.main.js']) {
    const tail = '  // packages/sensors/src/visual-activity.ts';
    assert.equal(patched[file].slice(patched[file].indexOf(tail)), sources[file].slice(sources[file].indexOf(tail)));
    assert.equal(hash(patched[file].slice(patched[file].indexOf(tail))), UNCHANGED_TAIL_HASHES[file], file + ': immutable pre-port tail');
    for (const name of ['constructor', 'record', 'recordResult', 'recordRtcValue', 'recordExtensionResource', 'pause', 'resume', 'stop']) assert.equal(memberText(patched[file], 'SensorRuntime', name), memberText(sources[file], 'SensorRuntime', name), file + ':' + name);
  }
  const tail = '  // packages/collector/src/visual.ts';
  assert.equal(patched['bridge.js'].slice(patched['bridge.js'].indexOf(tail)), sources['bridge.js'].slice(sources['bridge.js'].indexOf(tail)));
  // ADR-076 adds a separately reviewed passive collector. Strip only its named
  // additive block and exact installer; keep the original immutable hash intact.
  let legacyTail = patched['bridge.js'].slice(patched['bridge.js'].indexOf(tail));
  const start = '  // ADR-076 Precursor native timing bridge start\n', end = '  // ADR-076 Precursor native timing bridge end\n\n';
  assert.equal(legacyTail.split(start).length, 2); assert.equal(legacyTail.split(end).length, 2);
  const from = legacyTail.indexOf(start), to = legacyTail.indexOf(end, from); assert.ok(to > from);
  legacyTail = legacyTail.slice(0, from) + legacyTail.slice(to + end.length);
  const install = '\n      installPrecursorTimingBridge(startPrecursorTimingBridge, classifyPrecursorTimingResource, isOwnServiceWorker, chrome);';
  assert.equal(legacyTail.split(install).length, 2); legacyTail = legacyTail.replace(install, '');
  assert.equal(hash(legacyTail), UNCHANGED_TAIL_HASHES['bridge.js'], 'immutable pre-port inspector/capture bridges');
  const ownSender = source => { const { tree, nodes } = find(source, node => ts.isFunctionDeclaration(node) && node.name?.text === 'isOwnServiceWorker'); return nodes[0].getText(tree); };
  assert.equal(ownSender(patched['bridge.js']), ownSender(sources['bridge.js']));
});

test('source drift is rejected inside a replaced boundary; unrelated modules remain editable', () => {
  const changed = sources['bridge.js'].includes('var Deliverer = class {')
    ? sources['bridge.js'].replace('var Deliverer = class {', 'var Deliverer = class /* review drift */ {')
    : sources['bridge.js'].replace('physicalPending = 0;', 'physicalPending = 99;');
  assert.notEqual(changed, sources['bridge.js']);
  assert.throws(() => patchProducer(changed, 'bridge.js'), /source drift/);
  const unrelated = sources['hook.main.js'] + '\n// unrelated-review-marker\n';
  assert.ok(patchProducer(unrelated, 'hook.main.js').endsWith('// unrelated-review-marker\n'));
});

for (const hook of ['hook.early.js', 'hook.main.js']) test(hook + ' excludes old pending known/unseen keys, rejects late ACK effects and clears its hot cache', async () => {
  const f = fixture(hook);
  try {
    let release;
    f.setResponder(() => new Promise(resolve => { release = resolve; }));
    f.record('DET-002', 100); f.clock.advance(500); await settle(); assert.equal(f.sent.length, 1);
    f.record('DET-002', 10); f.record('DET-001', 77); f.clock.advance(250); await settle();
    assert.equal(f.collector.snapshot().ringSize, 2, 'known/unseen old keys are buffered behind the native slot');
    f.record('DET-003', 31); // A separate old key remains inside MAIN and has never reached ISOLATED.
    const oldBoot = f.sensor.sensorBootId, oldEpoch = f.collector.snapshot().bridgeSessionId;
    const ack = await f.reset('owned-clear');
    assert.equal(ack.type, 'bridge-reset-ack'); assert.notEqual(ack.bridgeSessionId, oldEpoch); assert.notEqual(f.sensor.sensorBootId, oldBoot);
    assert.equal(f.sensor.lastCounterKey, -1); assert.equal(f.sensor.lastCounter, undefined);
    assert.equal(f.sensor.snapshot().size, 0); assert.equal(f.collector.snapshot().ringSize, 0);
    f.record('DET-001'); f.record('DET-002'); f.clock.advance(500); await settle(); assert.equal(f.sent.length, 1);
    f.setResponder(batch => Promise.resolve({ schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: batch.batchSeq, paused: false, protocolOk: true }));
    release({ schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: 999, paused: true, protocolOk: false }); await settle(); f.clock.advance(500); await settle();
    assert.equal(f.sent.length, 2); assert.equal(f.collector.snapshot().state, 'active');
    assert.equal(f.sent[1].bridgeSessionId, ack.bridgeSessionId);
    assert.deepEqual(Array.from(f.sent[1].observations, row => [row.techniqueId, row.count]), [['DET-001', 1], ['DET-002', 1]]);
    assert.equal(f.collector.snapshot().ringDirty, 0);
  } finally { f.close(); }
});

test('physical native capacity survives repeated clears with an ACK that never settles', async () => {
  const f = fixture();
  try {
    f.setResponder(() => new Promise(() => {})); f.record('DET-001'); f.clock.advance(500); await settle();
    for (let i = 0; i < 24; i++) { await f.reset('reset-' + i); f.record('DET-002'); f.clock.advance(500); await settle(); assert.equal(f.sent.length, 1); }
    f.clock.advance(600000); await settle(); assert.equal(f.sent.length, 1); assert.equal(f.clock.size, 0);
  } finally { f.close(); }
});

test('reset clears 128 saturated keys and preserves production API-operation dimensions', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 128; i++) f.sensor.record(i % 69, Math.floor(i / 69), 1);
    assert.equal(f.sensor.snapshot().size, 128); for (const value of f.sensor.counters.values()) value.count = 2147483647;
    await f.reset('saturated-reset'); assert.equal(f.sensor.snapshot().size, 0);
    f.sensor.recordOperation(0, f.main.PHASE_INDEX['settlement-unobserved']); f.clock.advance(500); await settle();
    assert.equal(f.sent[0].observations[0].count, 1); assert.equal(typeof f.sent[0].observations[0].apiOperation, 'string');
  } finally { f.close(); }
});

test('native reset control rejects accessors and foreign senders without invoking a getter', () => {
  const f = fixture();
  try {
    let reads = 0;
    const control = { schemaVersion: 1, type: 'bridge-control', command: 'reset', resetId: 'owned' };
    Object.defineProperty(control, 'command', { enumerable: true, get() { reads++; return 'reset'; } });
    assert.equal(f.bridgeContext.validateBridgeControl(control).ok, false); assert.equal(reads, 0);
    let callback, fromExtension;
    f.bridgeContext.window = { addEventListener() {} };
    f.bridgeContext.chrome = { runtime: { id: 'owned', onMessage: { addListener(fn) { callback = fn; } } } };
    f.bridgeContext.createBrowserCollectorEnv().onControlMessage(own => { fromExtension = own; });
    callback({}, { id: 'foreign', origin: 'chrome-extension://owned' }, () => {}); assert.equal(fromExtension, false);
    callback({}, { id: 'owned', origin: 'chrome-extension://owned', tab: { id: 7 } }, () => {}); assert.equal(fromExtension, false);
    callback({}, { id: 'owned', origin: 'chrome-extension://owned' }, () => {}); assert.equal(fromExtension, true);
  } finally { f.close(); }
});

test('native env keeps the reset response channel open until its own Promise settles', async () => {
  const f = fixture();
  try {
    let callback, response;
    f.bridgeContext.window = { addEventListener() {} };
    f.bridgeContext.chrome = { runtime: { id: 'owned', onMessage: { addListener(fn) { callback = fn; } } } };
    const value = vm.runInContext('Promise.resolve({schemaVersion:1,type:"bridge-reset-ack",resetId:"owned",bridgeSessionId:"fresh",sensorBootIds:["new"]})', f.bridgeContext);
    f.bridgeContext.createBrowserCollectorEnv().onControlMessage(() => value);
    assert.equal(callback({}, { id: 'owned', origin: 'chrome-extension://owned' }, reply => { response = reply; }), true);
    assert.equal(response, undefined); await settle(); assert.equal(response.type, 'bridge-reset-ack');
    f.bridgeContext.createBrowserCollectorEnv().onControlMessage(() => vm.runInContext('Promise.reject(Error("failed reset"))', f.bridgeContext));
    assert.equal(callback({}, { id: 'owned', origin: 'chrome-extension://owned' }, reply => { response = reply; }), true);
    await settle(); assert.equal(response, null);
  } finally { f.close(); }
});

test('reset reply coverage cannot claim Chrome policy and paused reset preserves Resume', async () => {
  const f = fixture();
  try {
    f.sensor.addFlag('paused'); await f.reset('coverage-reset');
    assert.equal(f.collector.snapshot().pendingCoverage.includes('paused'), false);
    f.collector.pause(); const ack = await f.reset('paused-reset');
    assert.equal(ack.type, 'bridge-reset-ack'); assert.equal(f.collector.snapshot().state, 'paused');
    f.record('DET-001'); assert.equal(f.sensor.snapshot().size, 0);
    f.collector.resume(); f.record('DET-001'); assert.equal(f.sensor.snapshot().counters[0].count, 1);
  } finally { f.close(); }
});
