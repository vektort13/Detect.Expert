// REQ-004 / REQ-009 / ADR-018: trust and cross-browser API behavior, beyond manifest snapshots.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { productionManifest, validateProductionManifest } from '../build-production.mjs';

const source = readFileSync(new URL('../../apps/production-extension/browser-adapter.js', import.meta.url), 'utf8');
const id = 'abababababababababababababababab';
function fixture(context = 'background', timers = { setTimeout, clearTimeout }) {
  const messages = [], listeners = [], sends = [], requests = [], frame = { frameId: 0, parentFrameId: -1, url: 'http://example.com/' };
  let currentId = id;
  const api = {
    runtime: { id: 'detect.expert@detect.expert', getURL: () => 'moz-extension://private-uuid/',
      onMessage: { addListener: (listener) => listeners.push(listener) },
      sendMessage: async (message) => { messages.push(message); return 'ack'; } },
    tabs: { sendMessage: async (...args) => { sends.push(args); } },
    webNavigation: { getAllFrames: async () => [frame], getFrame: async () => frame,
      onBeforeNavigate: { addListener: (listener) => { api.beforeCallback = listener; } },
      onErrorOccurred: { addListener: (listener) => { api.errorCallback = listener; } },
      onCommitted: { addListener: (listener) => { api.navigationCallback = listener; } } },
    scripting: { executeScript: async () => [{ frameId: 0, result: currentId }] },
    webRequest: { onCompleted: { addListener: (...args) => requests.push(args) } },
    sidebarAction: { open: async () => 'sidebar' },
  };
  const realm = vm.createContext({ Uint8Array, ...timers, crypto: { getRandomValues: (bytes) => bytes.fill(0xab) } });
  const adapter = vm.runInContext(source + '\ncreateFirefoxAdapter', realm)(api, context);
  return { adapter, api, messages, listeners, sends, requests, replace: () => { currentId = 'cd'.repeat(16); } };
}
const sender = { id: 'detect.expert@detect.expert', tab: { id: 7 }, frameId: 0, origin: 'http://example.com', url: 'http://example.com/' };
const turn = () => new Promise((done) => setImmediate(done));

test('ADR-076 single frame resolver proves exact private token and rejects replacements', async () => {
  const f=fixture(), query={tabId:7,frameId:0,documentId:id};
  const result=await f.adapter.__detectExpertResolveDocument(query);assert.equal(result.documentId,id);assert.equal(result.url,'http://example.com/');
  f.replace();await assert.rejects(f.adapter.__detectExpertResolveDocument(query),/stale-document/);
  await assert.rejects(f.adapter.__detectExpertResolveDocument({...query,tabId:-1}),/invalid-document/);
  assert.equal(fixture('bridge').adapter.__detectExpertResolveDocument,undefined);
});

test('ADR-076 single frame resolver holds four physical native slots after logical timeouts', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture('background',{setTimeout,clearTimeout});let calls=0;
  f.api.webNavigation.getFrame=()=>{calls++;return new Promise(()=>{});};
  const jobs=Array.from({length:4},(_,frameId)=>f.adapter.__detectExpertResolveDocument({tabId:7,frameId,documentId:id}).catch(error=>error.message));
  await Promise.resolve();assert.equal(calls,4);t.mock.timers.tick(1500);await Promise.all(jobs);
  for(let index=0;index<10;index++)await assert.rejects(f.adapter.__detectExpertResolveDocument({tabId:8,frameId:index,documentId:id}),/capacity/);
  assert.equal(calls,4);
});

test('ADR-076 timing messages share the four native resolver slots after timeouts',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=fixture('background',{setTimeout,clearTimeout});let calls=0;
  f.api.webNavigation.getFrame=()=>{calls++;return new Promise(()=>{});};
  const jobs=Array.from({length:4},(_,frameId)=>f.adapter.tabs.sendMessage(7,{schemaVersion:1,type:'precursor-timing-query',sessionId:'worker'},{frameId,documentId:id}).catch(error=>error.message));
  await Promise.resolve();t.mock.timers.tick(1500);await Promise.all(jobs);
  await assert.rejects(f.adapter.tabs.sendMessage(7,{schemaVersion:1,type:'precursor-timing-reset',resetId:'reset'},{frameId:5,documentId:id}),/capacity/);assert.equal(calls,4);assert.equal(f.sends.length,0);
});

test('browser manifests retain the inherited permission/CSP boundary and use native backgrounds', () => {
  for (const browser of ['chrome', 'firefox']) {
    const manifest = productionManifest(browser, '1.1.0');
    assert.deepEqual(validateProductionManifest(manifest, browser), []);
    manifest.permissions.push('cookies');
    assert.ok(validateProductionManifest(manifest, browser).length);
  }
  const firefox = productionManifest('firefox', '1.1.0');
  assert.deepEqual(firefox.background.scripts, ['background.js']);
  assert.equal(firefox.background.service_worker, undefined);
  assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, '128.0');
});
test('a narrow Firefox content context needs only runtime and stamps private ISOLATED identity', async () => {
  const f = fixture('bridge');
  const pageBatch = { type: 'sensor-events', observations: [] };
  assert.equal(await f.adapter.runtime.sendMessage(pageBatch), 'ack');
  assert.equal(f.messages[0].__detectExpertIsolatedMessageV1, id);
  assert.equal(f.messages[0].payload, pageBatch);
});
test('background rejects page messages without an isolated stamp and foreign extension senders', async () => {
  const f = fixture(); let admitted = 0; const responses = [];
  f.adapter.runtime.onMessage.addListener(() => { admitted++; });
  f.listeners[0]({ type: 'sensor-events', documentId: id }, sender, (response) => responses.push(response));
  f.listeners[0]({ __detectExpertIsolatedMessageV1: id, payload: {} }, { ...sender, id: 'foreign' }, (response) => responses.push(response));
  await turn(); assert.equal(admitted, 0); assert.equal(responses.length, 2);
  assert.ok(responses.every((value) => value.code === 'unauthorized-sender'));
});
test('background admits live isolated document metadata and rejects the same stamp after navigation', async () => {
  const f = fixture(), received = [], responses = [];
  f.adapter.runtime.onMessage.addListener((message, trusted) => received.push({ message, trusted }));
  const envelope = { __detectExpertIsolatedMessageV1: id, payload: { type: 'sensor-events' } };
  assert.equal(f.listeners[0](envelope, sender, (response) => responses.push(response)), true);
  await turn(); assert.equal(received.length, 1); assert.equal(received[0].trusted.documentId, id);
  assert.equal(received[0].trusted.tab.id, 7);
  f.replace(); f.listeners[0](envelope, sender, (response) => responses.push(response));
  await turn(); assert.equal(received.length, 1); assert.equal(responses[0].code, 'unauthorized-sender');
});
test('moz-extension UI messages remain privileged without page metadata', () => {
  const f = fixture(); let admitted = 0;
  f.adapter.runtime.onMessage.addListener(() => { admitted++; });
  f.listeners[0]({ type: 'ui-clear' }, { id: sender.id, origin: 'moz-extension://private-uuid', url: 'moz-extension://private-uuid/popup.html' }, () => {});
  assert.equal(admitted, 1);
});
test('recipient envelopes prevent controls from reaching the next document after an awaited frame check', async () => {
  const background = fixture(), bridge = fixture('bridge'); let deliveries = 0;
  bridge.adapter.runtime.onMessage.addListener(() => { deliveries++; });
  await background.adapter.tabs.sendMessage(7, { type: 'bridge-control' }, { frameId: 0, documentId: id });
  const sent = background.sends[0][1];
  const own = { id: sender.id, origin: 'moz-extension://private-uuid' };
  bridge.listeners[0](sent, own, () => {}); assert.equal(deliveries, 1);
  bridge.listeners[0]({ ...sent, __detectExpertIsolatedRecipientV1: 'cd'.repeat(16) }, own, () => {});
  bridge.listeners[0](sent, { ...own, tab: { id: 7 } }, () => {});
  assert.equal(deliveries, 1);
});
test('late file injections cannot silently downgrade exact document targeting to frame targeting', async () => {
  const f = fixture();
  await assert.rejects(f.adapter.scripting.executeScript({ target: { tabId: 7, documentIds: [id] }, files: ['hook.main.js'] }), /document-targeted-injection-unsupported/);
});
test('network callbacks keep source-document identity unavailable and remove unsupported extraHeaders only', () => {
  const f = fixture(); let observed;
  f.adapter.webRequest.onCompleted.addListener((value) => { observed = value; }, { urls: ['http://*/*'] }, ['responseHeaders', 'extraHeaders']);
  assert.deepEqual(Array.from(f.requests[0][2]), ['responseHeaders']);
  f.requests[0][0]({ tabId: 7, documentId: 'native-id', parentDocumentId: 'parent', requestId: 'r1' });
  assert.equal(observed.documentId, undefined); assert.equal(observed.requestId, 'r1');
});
test('an observer exception resolves with an error instead of leaking an unhandled rejection', async () => {
  const f = fixture(), responses = [];
  f.adapter.runtime.onMessage.addListener(() => { throw new Error('observer failure'); });
  f.listeners[0]({ __detectExpertIsolatedMessageV1: id, payload: {} }, sender, (response) => responses.push(response));
  await turn(); assert.equal(responses.length, 1); assert.equal(responses[0].code, 'unauthorized-sender');
});
test('navigation callback throws and Promise rejections are isolated after document normalization', async () => {
  for (const listener of [() => { throw new Error('navigation observer'); }, () => Promise.reject(new Error('navigation observer'))]) {
    const f = fixture(); let calls = 0;
    f.adapter.webNavigation.onCommitted.addListener((details) => { calls++; assert.equal(details.documentId, id); return listener(); });
    f.api.navigationCallback({ tabId: 7, frameId: 0, url: 'http://example.com/' });
    await turn(); await turn(); assert.equal(calls, 1);
  }
});
test('timed out IPC jobs retain the physical capacity until the native operation settles', async () => {
  const timers = [];
  const f = fixture('background', { setTimeout: (callback) => { timers.push(callback); return callback; }, clearTimeout: () => {} });
  let physical = 0;
  f.api.scripting.executeScript = () => { physical++; return new Promise(() => {}); };
  f.adapter.runtime.onMessage.addListener(() => { throw new Error('timed out request admitted'); });
  const message = { __detectExpertIsolatedMessageV1: id, payload: {} };
  for (let attempt = 0; attempt < 257; attempt++) {
    f.listeners[0](message, { ...sender, frameId: attempt }, () => {});
    await turn();
    for (const callback of timers.splice(0)) callback();
    await turn();
  }
  assert.equal(physical, 256);
});

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function retryTimers() {
  let next = 0; const jobs = new Map();
  return { jobs, setTimeout(callback, delay) { const id = ++next; jobs.set(id, { callback, delay }); return id; }, clearTimeout(id) { jobs.delete(id); },
    fire(delay) { for (const [id, job] of [...jobs]) if (job.delay === delay) { jobs.delete(id); job.callback(); } } };
}
test('new Firefox generation never joins an old identity IPC and old cleanup preserves the new pending job', async () => {
  const f = fixture(), gates = [deferred(), deferred()], admitted = [], rejected = []; let calls = 0;
  f.api.scripting.executeScript = () => gates[calls++].promise;
  f.adapter.webNavigation.onBeforeNavigate.addListener(() => {});
  f.adapter.runtime.onMessage.addListener((message, trusted) => admitted.push({ message, trusted }));
  f.listeners[0]({ __detectExpertIsolatedMessageV1: id, payload: { old: true } }, sender, response => rejected.push(response)); await turn();
  f.api.beforeCallback({ tabId: 7, frameId: 0, url: sender.url });
  const nextId = 'cd'.repeat(16), fresh = { __detectExpertIsolatedMessageV1: nextId, payload: { old: false } };
  f.listeners[0](fresh, sender, response => rejected.push(response)); await turn(); assert.equal(calls, 2);
  gates[0].resolve([{ frameId: 0, result: id }]); await turn();
  f.listeners[0](fresh, sender, response => rejected.push(response)); await turn(); assert.equal(calls, 2, 'old finally must not remove the new pending identity');
  gates[1].resolve([{ frameId: 0, result: nextId }]); await turn();
  assert.equal(admitted.length, 2); assert.ok(admitted.every(value => !value.message.old && value.trusted.documentId === nextId));
  assert.equal(rejected.length, 1); assert.equal(rejected[0].code, 'unauthorized-sender');
});
test('COOP native commit retries transient old frame URLs and delivers once with current private identity', async () => {
  const timers = retryTimers(), f = fixture('background', timers), commits = []; let reads = 0;
  f.api.webNavigation.getFrame = async () => ({ frameId: 0, parentFrameId: -1, url: ++reads === 1 ? 'about:blank' : sender.url });
  f.adapter.webNavigation.onCommitted.addListener(details => commits.push(details));
  f.api.navigationCallback({ tabId: 7, frameId: 0, url: sender.url }); await turn();
  assert.equal(commits.length, 0); assert.equal([...timers.jobs.values()].filter(job => job.delay === 50).length, 1);
  timers.fire(50); await turn();
  assert.equal(commits.length, 1); assert.equal(commits[0].url, sender.url); assert.equal(commits[0].documentId, id); assert.equal(reads, 2); assert.equal(timers.jobs.size, 0);
});
test('COOP retry is cancelled by replacement or failed navigation, including same URL reuse', async () => {
  for (const cancel of ['before', 'error']) {
    const timers = retryTimers(), f = fixture('background', timers), commits = []; let reads = 0, url = 'about:blank';
    f.api.webNavigation.getFrame = async () => { ++reads; return { frameId: 0, parentFrameId: -1, url }; };
    f.adapter.webNavigation.onBeforeNavigate.addListener(() => {}); f.adapter.webNavigation.onErrorOccurred.addListener(() => {});
    f.adapter.webNavigation.onCommitted.addListener(details => commits.push(details));
    f.api.navigationCallback({ tabId: 7, frameId: 0, url: sender.url }); await turn();
    f.api[cancel + 'Callback']({ tabId: 7, frameId: 0, url: sender.url }); url = sender.url; timers.fire(50); await turn();
    assert.equal(commits.length, 0, cancel); assert.equal(reads, 1, cancel);
  }
});
test('a permanent URL mismatch has exactly four attempts and never guesses by host', async () => {
  const timers = retryTimers(), f = fixture('background', timers); let reads = 0, commits = 0;
  f.api.webNavigation.getFrame = async () => { ++reads; return { frameId: 0, parentFrameId: -1, url: 'http://example.com/other' }; };
  f.adapter.webNavigation.onCommitted.addListener(() => ++commits);
  f.api.navigationCallback({ tabId: 7, frameId: 0, url: sender.url }); await turn();
  for (const delay of [50, 150, 300]) { timers.fire(delay); await turn(); }
  assert.equal(reads, 4); assert.equal(commits, 0); assert.equal(timers.jobs.size, 0);
});
test('independent native onCommitted subscribers each receive their own normalized event', async () => {
  const f = fixture(), callbacks = [], delivered = [];
  f.api.webNavigation.onCommitted.addListener = listener => callbacks.push(listener);
  f.adapter.webNavigation.onCommitted.addListener(() => delivered.push('first'));
  f.adapter.webNavigation.onCommitted.addListener(() => delivered.push('second'));
  for (const callback of callbacks) callback({ tabId: 7, frameId: 0, url: sender.url });
  await turn(); assert.deepEqual(delivered.sort(), ['first', 'second']);
});
test('cancelled COOP retry timers retain the 128-operation capacity until their wait settles', async () => {
  const timers = retryTimers(), f = fixture('background', timers); let reads = 0;
  f.api.webNavigation.getFrame = async () => { ++reads; return { frameId: 0, parentFrameId: -1, url: 'about:blank' }; };
  f.adapter.webNavigation.onBeforeNavigate.addListener(() => {}); f.adapter.webNavigation.onCommitted.addListener(() => { throw Error('wrong URL admitted'); });
  for (let tabId = 1; tabId <= 128; ++tabId) f.api.navigationCallback({ tabId, frameId: 0, url: sender.url });
  await turn(); assert.equal(reads, 128);
  for (let tabId = 1; tabId <= 128; ++tabId) f.api.beforeCallback({ tabId, frameId: 0, url: sender.url });
  f.api.navigationCallback({ tabId: 129, frameId: 0, url: sender.url }); await turn(); assert.equal(reads, 128);
  timers.fire(50); await turn(); f.api.navigationCallback({ tabId: 129, frameId: 0, url: sender.url }); await turn(); assert.equal(reads, 129);
  for (const delay of [50, 150, 300]) { timers.fire(delay); await turn(); }
  assert.equal(timers.jobs.size, 0);
});
test('wrapped navigation events support removeListener and hasListener like the native event', async () => {
  const f = fixture(), removed = [], delivered = [];
  f.api.webNavigation.onCommitted.removeListener = callback => removed.push(callback);
  const event = f.adapter.webNavigation.onCommitted, listener = details => delivered.push(details.documentId);
  assert.equal(event.hasListener(listener), false);
  event.addListener(listener); const native = f.api.navigationCallback;
  assert.equal(event.hasListener(listener), true); assert.equal(f.adapter.webNavigation.onCommitted.hasListener(listener), true, 'every read of the event sees the same registrations');
  event.addListener(listener); assert.equal(f.api.navigationCallback, native, 'the same function added twice is not registered twice, as in a native event');
  event.removeListener(listener);
  assert.deepEqual(removed, [native], 'removal hands the native event the very callback it registered'); assert.equal(event.hasListener(listener), false);
  event.removeListener(listener); event.removeListener(() => {}); assert.equal(removed.length, 1, 'removing twice or removing an unknown function does nothing');
  native({ tabId: 7, frameId: 0, url: sender.url }); await turn(); assert.deepEqual(delivered, [], 'an event already on its way is not delivered after the removal');
  event.addListener(listener); assert.notEqual(f.api.navigationCallback, native, 'a removed function can be added again'); assert.equal(event.hasListener(listener), true);
  f.api.navigationCallback({ tabId: 7, frameId: 0, url: sender.url }); await turn(); assert.deepEqual(delivered, [id]);
});
test('removing a navigation listener does not touch the listeners of other subscribers', async () => {
  const f = fixture(), callbacks = [], removed = [], delivered = [];
  f.api.webNavigation.onCommitted.addListener = callback => callbacks.push(callback); f.api.webNavigation.onCommitted.removeListener = callback => removed.push(callback);
  const first = () => delivered.push('first'), second = () => delivered.push('second');
  f.adapter.webNavigation.onCommitted.addListener(first); f.adapter.webNavigation.onCommitted.addListener(second);
  f.adapter.webNavigation.onCommitted.removeListener(first); assert.deepEqual(removed, [callbacks[0]]);
  for (const callback of callbacks) callback({ tabId: 7, frameId: 0, url: sender.url });
  await turn(); assert.deepEqual(delivered, ['second']);
  assert.equal(f.adapter.webNavigation.onCommitted.hasListener(first), false); assert.equal(f.adapter.webNavigation.onCommitted.hasListener(second), true);
  assert.equal(f.adapter.webNavigation.onBeforeNavigate.hasListener(second), false, 'registrations are kept per event');
});
test('removing a listener cancels the COOP retry it still waits for', async () => {
  const timers = retryTimers(), f = fixture('background', timers); let reads = 0, delivered = 0, url = 'about:blank';
  f.api.webNavigation.onCommitted.removeListener = () => {};
  f.api.webNavigation.getFrame = async () => { ++reads; return { frameId: 0, parentFrameId: -1, url }; };
  const listener = () => ++delivered;
  f.adapter.webNavigation.onCommitted.addListener(listener);
  f.api.navigationCallback({ tabId: 7, frameId: 0, url: sender.url }); await turn(); assert.equal(reads, 1);
  f.adapter.webNavigation.onCommitted.removeListener(listener); url = sender.url;
  for (const delay of [50, 150, 300]) { timers.fire(delay); await turn(); }
  assert.equal(delivered, 0); assert.equal(timers.jobs.size, 0);
});
test('a failing native addListener leaves no registration behind', () => {
  const f = fixture(); let attempts = 0; const listener = () => {};
  f.api.webNavigation.onCommitted.addListener = () => { if (++attempts === 1) throw Error('native refusal'); };
  assert.throws(() => f.adapter.webNavigation.onCommitted.addListener(listener), /native refusal/u);
  assert.equal(f.adapter.webNavigation.onCommitted.hasListener(listener), false);
  f.adapter.webNavigation.onCommitted.addListener(listener); assert.equal(attempts, 2); assert.equal(f.adapter.webNavigation.onCommitted.hasListener(listener), true);
});
test('wrapped network events and the missing tabs.onReplaced support removeListener too', () => {
  const f = fixture(), removed = [];
  f.api.webRequest.onCompleted.removeListener = callback => removed.push(callback);
  const event = f.adapter.webRequest.onCompleted, listener = () => {};
  event.addListener(listener, { urls: ['http://*/*'] }); event.addListener(listener, { urls: ['http://*/*'] });
  assert.equal(f.requests.length, 1, 'the same function is registered once'); assert.equal(event.hasListener(listener), true);
  event.removeListener(listener); assert.deepEqual(removed, [f.requests[0][0]]); assert.equal(event.hasListener(listener), false);
  event.removeListener(listener); assert.equal(removed.length, 1);
  const replaced = f.adapter.tabs.onReplaced, one = () => {};
  replaced.addListener(one); assert.doesNotThrow(() => replaced.removeListener(one)); assert.equal(replaced.hasListener(one), false);
});
test('a removed listener hears nothing more, on every navigation event kind', async () => {
  const f = fixture(), heard = []; let completed = null;
  f.api.webNavigation.onCompleted = { addListener: callback => { completed = callback; }, removeListener() {} };
  for (const name of ['onBeforeNavigate', 'onErrorOccurred', 'onCommitted']) f.api.webNavigation[name].removeListener = () => {};
  const navigation = f.adapter.webNavigation, listeners = {};
  for (const name of ['onBeforeNavigate', 'onErrorOccurred', 'onCommitted', 'onCompleted']) { listeners[name] = () => heard.push(name); navigation[name].addListener(listeners[name]); }
  const natives = { onBeforeNavigate: f.api.beforeCallback, onErrorOccurred: f.api.errorCallback, onCommitted: f.api.navigationCallback, onCompleted: completed };
  for (const name of Object.keys(natives)) navigation[name].removeListener(listeners[name]);
  for (const native of Object.values(natives)) native({ tabId: 7, frameId: 0, url: sender.url }); await turn();
  assert.deepEqual(heard, [], 'callbacks that arrive after removal are dropped');
  // An event that is already being normalized when the listener goes away is dropped as well.
  navigation.onCompleted.addListener(listeners.onCompleted); const again = completed;
  again({ tabId: 7, frameId: 0, url: sender.url }); navigation.onCompleted.removeListener(listeners.onCompleted); await turn();
  assert.deepEqual(heard, [], 'removal during the identity check drops the pending delivery');
  navigation.onCompleted.addListener(listeners.onCompleted); completed({ tabId: 7, frameId: 0, url: sender.url }); await turn();
  assert.deepEqual(heard, ['onCompleted'], 'a listener that stays still hears its events');
});
