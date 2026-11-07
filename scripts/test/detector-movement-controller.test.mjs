import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {createDetectorMovementController} from '../../apps/production-extension/detector-movement-controller.js';
import {detectorMovementLease} from '../../apps/production-extension/detector-movement-counter.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve;const promise = new Promise(done => {resolve = done;});return {promise, resolve};}
function fixture(useNativeFrames = false) {
  let time = 0, sequence = 0, lease = 0, current = true, allowed = true;
  const timers = new Map(), visibility = new Set(), calls = [], snapshots = [];
  const state = {tab: {id: 7, url: 'https://source.example.test/?PRIVATE'}, frames: [{frameId: 0, documentId: 'doc-0', url: 'https://source.example.test/'}, {frameId: 1, documentId: 'doc-1', url: 'https://child.example.test/'}], values: new Map([[0, 0], [1, 0]]), fail: false, held: null, authorize: null, tabRead: null, policy: {scopeMode:'all-sites',hosts:[],grantedAllSites:true}, nativeFrames: null, nativeResultDocuments: null};
  const root = {location: {href: 'chrome-extension://owned/options.html?tabId=7'}, performance: {now: () => time}, crypto: {randomUUID: () => 'aaaaaaaa-aaaa-4aaa-aaaa-' + (++lease).toString().padStart(12, '0')},
    document: {visibilityState: 'visible', addEventListener: (_, fn) => visibility.add(fn), removeEventListener: (_, fn) => visibility.delete(fn)},
    addEventListener: (_, fn) => visibility.add(fn), removeEventListener: (_, fn) => visibility.delete(fn),
    setTimeout(fn, delay) {const id = ++sequence;timers.set(id, {fn, at: time + delay});return id;}, clearTimeout: id => timers.delete(id)};
  root.window = root;root.top = root;
  const api = {runtime: {getURL: path => 'chrome-extension://owned/' + path},
    tabs: {async get(id) {calls.push(['tab', id]);return state.tabRead ? await state.tabRead : state.tab;}},
    webNavigation: {async getAllFrames(value) {calls.push(['frames', value]);return state.frames;}},
    scripting: {async executeScript(value) {
      calls.push(['execute', value]);if (value.args[0] === 'close') return [];
      if (state.fail) throw Error('native permission denied');if (state.held) return await state.held;
      const frameIds=value.target.frameIds??state.frames.filter(frame=>value.target.documentIds?.includes(frame.documentId)).map(frame=>frame.frameId);
      return frameIds.map(frameId => ({frameId, documentId: state.nativeResultDocuments?.get(frameId) ?? state.frames.find(frame => frame.frameId === frameId)?.documentId,
        result: {state: 'ready', documentToken: frameId.toString(16).padStart(32, '0'), generation: 1, count: state.values.get(frameId) ?? 0, saturated: false}}));
    }}};
  const controller = createDetectorMovementController({browserApi: api, root, tabId: 7, isCurrent: () => current, authorize: async () => {calls.push(['authorize']);return state.authorize ? await state.authorize : allowed ? state.policy : false;}, onChange: value => snapshots.push(value), pollMs: 1,...(useNativeFrames?{getNativeFrames:async request=>{calls.push(['native-frames',request]);return state.nativeFrames;}}:{})});
  async function advance(amount) {time += amount;for (let attempt = 0; attempt < 8; attempt++) {for (const [id, timer] of [...timers]) if (timer.at <= time) {timers.delete(id);timer.fn();}await turn();}}
  return {controller, root, api, calls, state, timers, snapshots, visibility, advance, current: value => {current = value;}, allowed: value => {allowed = value;}, hide(value) {root.document.visibilityState = value ? 'hidden' : 'visible';}, pagehide() {for (const fn of visibility) fn();}};
}
const executions = f => f.calls.filter(row => row[0] === 'execute').map(row => row[1]);

test('movement controller authorizes each bounded sample and uses only the fixed isolated function with legitimate initial zero', async () => {
  const f = fixture();await f.controller.start();
  assert.deepEqual(f.controller.getSnapshot(), {state: 'ready', count: 0, frameCount: 2, partial: false});
  const [operation] = executions(f);assert.equal(operation.func, detectorMovementLease);assert.equal(operation.world, 'ISOLATED');assert.deepEqual(operation.target, {tabId: 7, frameIds: [0, 1]});
  assert.equal(operation.args[0], 'sample');assert.equal(f.calls.filter(row => row[0] === 'authorize').length, 1);
  await f.advance(999);assert.equal(executions(f).length, 1);
  f.state.values.set(0, 2);f.state.values.set(1, 3);await f.advance(1);assert.equal(f.controller.getSnapshot().count, 5);assert.equal(f.calls.filter(row => row[0] === 'authorize').length, 2);
  assert.ok(f.snapshots.every(value => Object.isFrozen(value) && Object.keys(value).sort().join() === 'count,frameCount,partial,state'));
  assert.doesNotMatch(JSON.stringify(f.snapshots), /PRIVATE|source.example|doc-0|aaaaaaaa/u);await f.controller.stop();
});

test('movement controller is owned top Options only; popup/web/subframe/foreign-extension contexts cannot invoke authorization or scripting', async () => {
  for (const context of ['popup', 'web', 'subframe', 'foreign-extension', 'foreign-scheme']) {
    const f = fixture();
    if (context === 'popup') f.root.location.href = 'chrome-extension://owned/popup.html';
    if (context === 'web') f.root.location.href = 'https://source.example.test/options.html';
    if (context === 'subframe') f.root.top = {};
    if (context === 'foreign-extension') f.root.location.href = 'chrome-extension://foreign/options.html';
    if (context === 'foreign-scheme') f.root.location.href = 'moz-extension://owned/options.html';
    await f.controller.start();assert.equal(f.controller.getSnapshot().count, null);assert.deepEqual(f.calls, []);await f.controller.stop();
  }
});

test('movement controller explicitly limits native frame targets to64 and marks inaccessible/missing-document subsets partial', async () => {
  const f = fixture();f.state.frames = Array.from({length: 70}, (_, frameId) => ({frameId, documentId: 'doc-' + frameId, url: 'https://frame.example.test/'}));
  await f.controller.start();assert.equal(executions(f)[0].target.frameIds.length, 64);assert.equal(f.controller.getSnapshot().frameCount, 64);assert.equal(f.controller.getSnapshot().partial, true);await f.controller.stop();
  const g = fixture();delete g.state.frames[1].documentId;await g.controller.start();assert.equal(g.controller.getSnapshot().state, 'partial');assert.equal(g.controller.getSnapshot().frameCount, 2);await g.controller.stop();
});

test('native Firefox 64-bit child frame IDs are observed without widening tab IDs, counters or invalid frame targets', async () => {
  const f = fixture(), childId = 12884901889;
  f.state.frames[1].frameId = childId;f.state.values.delete(1);f.state.values.set(childId, 0);
  await f.controller.start();assert.deepEqual(executions(f)[0].target.frameIds, [0, childId]);
  assert.deepEqual(f.controller.getSnapshot(), {state: 'ready', count: 0, frameCount: 2, partial: false});
  f.state.values.set(childId, 3);await f.advance(1000);assert.equal(f.controller.getSnapshot().count, 3);await f.controller.stop();
  const g = fixture();for(const frameId of[-1,1.5,Number.MAX_SAFE_INTEGER+1,'12884901889'])g.state.frames.push({frameId,documentId:'invalid',url:'https://invalid.example.test/'});
  await g.controller.start();assert.deepEqual(executions(g)[0].target.frameIds,[0,1]);assert.equal(g.controller.getSnapshot().partial,true);await g.controller.stop();
});

test('a different wide result ID cannot supply a child count and a missing native top frame prevents injection', async () => {
  const f = fixture(), childId = 12884901889, execute = f.api.scripting.executeScript;
  f.state.frames[1].frameId = childId;f.state.values.set(childId, 0);
  f.api.scripting.executeScript = async value => {const rows = await execute(value);if(value.args[0] === 'sample')rows[1].frameId = childId + 1;return rows;};
  await f.controller.start();assert.equal(f.controller.getSnapshot().frameCount, 1);assert.equal(f.controller.getSnapshot().partial, true);
  f.state.values.set(childId, 99);f.state.values.set(0, 2);await f.advance(1000);assert.equal(f.controller.getSnapshot().count, 2);await f.controller.stop();
  const g = fixture();g.state.frames = [g.state.frames[1]];await g.controller.start();assert.equal(executions(g).length, 0);assert.equal(g.controller.getSnapshot().count, null);await g.controller.stop();
});

test('site scope with retained broad native grants targets only exact allowed hosts and skips opaque or unrelated children', async () => {
  const f = fixture();f.state.policy={scopeMode:'site',hosts:['source.example.test'],grantedAllSites:true};
  f.state.frames.push({frameId:2,documentId:'doc-subdomain',url:'https://sub.source.example.test/'},{frameId:3,documentId:'doc-opaque',url:'about:blank'},{frameId:4,documentId:'doc-same',url:'http://source.example.test/'});
  await f.controller.start();assert.deepEqual(executions(f)[0].target,{tabId:7,frameIds:[0,4]});assert.equal(f.controller.getSnapshot().state,'partial');assert.equal(f.controller.getSnapshot().frameCount,2);
  assert.deepEqual(executions(f)[0].args[2],{scopeMode:'site',hosts:['source.example.test'],grantedAllSites:true});await f.controller.stop();
});

test('active-tab uses only the exact granted top document target; missing, changed or absent native identity never falls back to frame IDs', async () => {
  const f=fixture();f.state.policy={scopeMode:'active-tab',hosts:[],grantedAllSites:true,activeDocumentId:'doc-0'};
  await f.controller.start();assert.deepEqual(executions(f)[0].target,{tabId:7,documentIds:['doc-0']});assert.equal(f.controller.getSnapshot().frameCount,1);await f.controller.stop();assert.deepEqual(executions(f).at(-1).target,{tabId:7,documentIds:['doc-0']});
  for(const kind of['missing-grant','stale-grant','missing-native']){const g=fixture();g.state.policy={scopeMode:'active-tab',hosts:[],grantedAllSites:true,...(kind==='missing-grant'?{}:{activeDocumentId:kind==='stale-grant'?'stale':'doc-0'})};if(kind==='missing-native')delete g.state.frames[0].documentId;await g.controller.start();assert.equal(executions(g).length,0);assert.equal(g.controller.getSnapshot().count,null);await g.controller.stop();}
});

test('boolean authorization, ungranted all-sites and malformed host lists fail closed; a changed scope closes existing leases', async () => {
  for(const policy of[true,{scopeMode:'all-sites',hosts:[],grantedAllSites:false},{scopeMode:'site',hosts:new Array(513).fill('source.example.test'),grantedAllSites:true},{scopeMode:'site',hosts:['source.example.test/foreign'],grantedAllSites:true}]){const f=fixture();f.state.policy=policy;await f.controller.start();assert.equal(executions(f).length,0);assert.equal(f.controller.getSnapshot().count,null);await f.controller.stop();}
  const f=fixture();await f.controller.start();f.state.policy={scopeMode:'site',hosts:['source.example.test'],grantedAllSites:true};await f.advance(1000);assert.equal(executions(f).filter(value=>value.args[0]==='sample').length,1);assert.equal(executions(f).at(-1).args[0],'close');assert.equal(f.controller.getSnapshot().count,null);await f.controller.stop();
});

test('cross-realm native authorization records retain own validated policy fields and exact host scope', async () => {
  const f=fixture();f.state.policy=vm.runInNewContext('({scopeMode:"site",hosts:["source.example.test"],grantedAllSites:true})');
  assert.notEqual(Object.getPrototypeOf(f.state.policy),Object.prototype);await f.controller.start();assert.deepEqual(executions(f)[0].target,{tabId:7,frameIds:[0]});assert.equal(f.controller.getSnapshot().frameCount,1);await f.controller.stop();
});

test('a separate native frame reader matches native result identities without relaxing an adapter private-identity mismatch', async () => {
  const configure=f=>{f.state.nativeFrames=f.state.frames.map(row=>({...row,documentId:'native-'+row.frameId}));f.state.nativeResultDocuments=new Map(f.state.nativeFrames.map(row=>[row.frameId,row.documentId]));f.state.frames=f.state.frames.map(row=>({...row,documentId:'adapter-private-'+row.frameId}));};
  const f=fixture();configure(f);await f.controller.start();assert.equal(f.controller.getSnapshot().count,null);assert.equal(f.controller.getSnapshot().state,'unavailable');await f.controller.stop();
  const g=fixture(true);configure(g);await g.controller.start();assert.equal(g.controller.getSnapshot().state,'ready');assert.equal(g.controller.getSnapshot().frameCount,2);assert.equal(g.calls.some(row=>row[0]==='frames'),false);assert.equal(g.calls.filter(row=>row[0]==='native-frames').length,1);assert.equal(executions(g)[0].func,detectorMovementLease);
  g.state.values.set(0,3);await g.advance(1000);assert.equal(g.controller.getSnapshot().count,3);
  g.state.nativeResultDocuments=new Map([[0,'wrong-native-0'],[1,'wrong-native-1']]);await g.advance(1000);assert.equal(g.controller.getSnapshot().count,null);assert.equal(g.controller.getSnapshot().state,'unavailable');await g.controller.stop();
});

test('native permission failure and a restricted source remain unavailable with null count rather than a successful zero', async () => {
  const f = fixture();f.state.fail = true;await f.controller.start();assert.deepEqual(f.controller.getSnapshot(), {state: 'unavailable', count: null, frameCount: 0, partial: false});await f.controller.stop();
  const g = fixture();g.state.tab = {id: 7, url: 'chrome://settings/'};await g.controller.start();assert.equal(executions(g).length, 0);assert.equal(g.controller.getSnapshot().count, null);await g.controller.stop();
});

test('authorization loss cancels the lease without reading source/frame metadata or rescheduling samples', async () => {
  const f = fixture();await f.controller.start();const before = f.calls.filter(row => row[0] === 'tab').length;f.allowed(false);await f.advance(1000);
  assert.equal(f.calls.filter(row => row[0] === 'tab').length, before);assert.equal(f.controller.getSnapshot().count, null);assert.equal(executions(f).at(-1).args[0], 'close');
  const samples = executions(f).filter(row => row.args[0] === 'sample').length;await f.advance(5000);assert.equal(executions(f).filter(row => row.args[0] === 'sample').length, samples);await f.controller.stop();
});

test('source generation changes during native tab validation prevent every subsequent operation', async () => {
  const f = fixture(), held = deferred();f.state.tabRead = held.promise;const starting = f.controller.start();await turn();f.current(false);held.resolve(f.state.tab);await starting;
  assert.equal(f.calls.some(row => row[0] === 'frames'), false);assert.equal(executions(f).length, 0);assert.equal(f.controller.getSnapshot().count, null);await f.controller.stop();
});

test('stop fences a pending script result, closes the late lease and cannot revive the last count', async () => {
  const f = fixture(), held = deferred();f.state.held = held.promise;const starting = f.controller.start();await turn();assert.equal(executions(f).filter(row => row.args[0] === 'sample').length, 1);
  await f.controller.stop();held.resolve([{frameId: 0, documentId: 'doc-0', result: {state: 'ready', count: 99, documentToken: 'a'.repeat(32), generation: 1, saturated: false}}]);await starting;await turn();
  assert.deepEqual(f.controller.getSnapshot(), {state: 'stopped', count: null, frameCount: 0, partial: false});assert.ok(executions(f).filter(row => row.args[0] === 'close').length >= 2);assert.equal(f.visibility.size, 0);assert.equal(f.timers.size, 0);
});

test('background Options continues authorized movement while the user views the source; actual pagehide stops its lease', async () => {
  const f = fixture();await f.controller.start();f.hide(true);f.state.values.set(0, 4);await f.advance(5000);
  assert.equal(f.controller.getSnapshot().count, 4);assert.equal(f.controller.getSnapshot().state, 'ready');assert.equal(executions(f).at(-1).args[0], 'sample');
  f.pagehide();await turn();assert.equal(f.controller.getSnapshot().state, 'stopped');assert.equal(f.controller.getSnapshot().count, null);assert.equal(executions(f).at(-1).args[0], 'close');assert.equal(f.visibility.size, 0);
  const samples = executions(f).filter(row => row.args[0] === 'sample').length;await f.advance(5000);assert.equal(executions(f).filter(row => row.args[0] === 'sample').length, samples);
});

test('a child navigation or removal keeps observed deltas in the view total while using a new document baseline', async () => {
  const f = fixture();await f.controller.start();f.state.values.set(1, 7);await f.advance(1000);assert.equal(f.controller.getSnapshot().count, 7);
  f.state.frames[1].documentId = 'doc-new';f.state.values.set(1, 0);await f.advance(1000);assert.equal(f.controller.getSnapshot().count, 7);assert.equal(f.controller.getSnapshot().state, 'partial','a vanished document can lose its final unpolled movements');
  f.state.values.set(1, 2);await f.advance(1000);assert.equal(f.controller.getSnapshot().count, 9);
  f.state.frames = [f.state.frames[0]];await f.advance(1000);assert.equal(f.controller.getSnapshot().count, 9);assert.equal(f.controller.getSnapshot().frameCount, 1);assert.equal(f.controller.getSnapshot().partial, true);await f.controller.stop();
});

test('a removed and returning frame cannot count its previously observed cumulative movements twice', async () => {
  const f = fixture();await f.controller.start();f.state.values.set(1, 7);await f.advance(1000);assert.equal(f.controller.getSnapshot().count, 7);
  const child = f.state.frames[1];f.state.frames = [f.state.frames[0]];await f.advance(1000);
  f.state.frames.push(child);await f.advance(1000);assert.equal(f.controller.getSnapshot().count, 7);assert.equal(f.controller.getSnapshot().partial, true);
  f.state.values.set(1, 9);await f.advance(1000);assert.equal(f.controller.getSnapshot().count, 9);assert.equal(f.controller.getSnapshot().partial, true);await f.controller.stop();
});

test('top-document navigation stops the old observation instead of installing a new lease under an obsolete source binding', async () => {
  const f = fixture();await f.controller.start();const samples = executions(f).filter(row => row.args[0] === 'sample').length;
  f.state.frames[0].documentId = 'top-new';await f.advance(1000);assert.equal(f.controller.getSnapshot().count, null);assert.equal(executions(f).filter(row => row.args[0] === 'sample').length, samples);
  await f.advance(5000);assert.equal(executions(f).filter(row => row.args[0] === 'sample').length, samples);await f.controller.stop();
});

test('a hung metadata authorization has a bounded failure and cannot build an unbounded polling queue', async () => {
  const f = fixture();f.state.authorize = new Promise(() => {});const starting = f.controller.start();await f.advance(1500);await starting;
  assert.equal(f.controller.getSnapshot().state, 'unavailable');assert.equal(f.controller.getSnapshot().count, null);assert.equal(executions(f).length, 0);const count = f.calls.length;await f.advance(10000);assert.equal(f.calls.length, count);await f.controller.stop();
});
