import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiConfiguration } from '../../packages/contracts/src/api-configuration.mjs';
import { prepareFingerprintWorkerSource } from '../../apps/production-extension/fingerprint-engine-worker.js';
import { createFingerprintEngineDriver as create, FINGERPRINT_ENGINE_DRIVER_LIMITS } from '../../apps/production-extension/fingerprint-engine-driver.js';

const capability = prepareFingerprintWorkerSource(createApiConfiguration());
const profile = { ok: true, status: 'ready', commands: [{ method: 'Emulation.setHardwareConcurrencyOverride', params: { hardwareConcurrency: 3 } }], resetCommands: [] };
const tick = async () => { for (let i = 0; i < 25; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(options = {}) {
  const calls = [], listeners = new Map(), changes = [], detaches = [], waiting = new Set(); let pendingNative = 0, maxNative = 0;
  const event = name => ({ addListener(listener) { listeners.set(name, listener); }, removeListener(listener) { if (listeners.get(name) === listener) listeners.delete(name); } });
  const api = { tabs: { onRemoved: event('removed') }, debugger: {
    onEvent: event('event'), onDetach: event('detach'),
    async attach(target, version) { calls.push({ method: 'attach', target, version }); return options.attach?.(target); },
    async detach(target) { calls.push({ method: 'detach', target }); return options.detach?.(target); },
    async sendCommand(target, method, params = {}) { calls.push({ target, method, params }); pendingNative++;maxNative=Math.max(maxNative,pendingNative);try{let result;if(options.send)result=options.send(target,method,params);if(result===undefined)result=method==='Runtime.evaluate'?{result:{objectId:'private-'+target.sessionId}}:{};result=await result;if(method==='Runtime.runIfWaitingForDebugger')waiting.delete(target.sessionId);return result;}finally{pendingNative--;} },
  } };
  const driver = create(api, { onChange: value => changes.push(value), onDetach: value => detaches.push(value), allowTarget: options.allow ?? (() => true) });
  const start = (extra = {}) => driver.start({ tabId: 7, profile, workerSource: capability, isCurrent: () => true, ...extra });
  const worker = (id = 'child', extra = {}, source = { tabId: 7 }) => {if(source.tabId===7&&extra.waitingForDebugger!==false)waiting.add(id);listeners.get('event')?.(source, 'Target.attachedToTarget', { sessionId: id, waitingForDebugger: true, targetInfo: { type: 'worker', url: 'https://qa.example/worker.js' }, ...extra });};
  return { calls, api, driver, start, worker, listeners, changes, detaches, waiting, maxNativePending:()=>maxNative };
}
test('closed command sequence attaches before Emulation and worker-only autoattach; private snapshot contains no handles', async () => {
  const f = fixture();
  assert.equal((await f.start()).status, 'ready');
  assert.deepEqual(f.calls.map(row => row.method), ['attach', 'Emulation.setHardwareConcurrencyOverride', 'Target.setAutoAttach']);
  assert.deepEqual(f.calls[2].params.filter, [{ type: 'worker', exclude: false }, { exclude: true }]);
  assert.equal(JSON.stringify(f.driver.snapshot()).includes('qa.example'), false);
  await f.driver.dispose(); assert.equal(f.listeners.size, 0);
});
test('dedicated Worker gets fixed packaged bootstrap and recursive autoattach before resume', async () => {
  const f = fixture(); await f.start(); f.worker(); await tick();
  const child = f.calls.filter(row => row.target?.sessionId === 'child');
  assert.deepEqual(child.map(row => row.method), ['Target.setAutoAttach', 'Runtime.enable', 'Runtime.evaluate', 'Runtime.runIfWaitingForDebugger']);
  assert.equal(child[2].params.returnByValue, false);
  assert.equal(typeof child[2].params.expression, 'string');
  assert.equal(f.driver.snapshot().bootstrappedWorkers, 1);
  f.worker('nested', {}, { tabId: 7, sessionId: 'child' }); await tick();
  assert.equal(f.driver.snapshot().bootstrappedWorkers, 2);
  await f.driver.stop();
  assert.ok(f.calls.some(row => row.method === 'Runtime.callFunctionOn' && row.params.objectId === 'private-child' && row.params.functionDeclaration === 'function(){this.stop();}'));
  assert.equal(f.calls.at(-1).method, 'detach');
});
test('out-of-scope Worker is resumed and an already-running Worker is marked partial without late injection', async () => {
  let allowed = 0; const f = fixture({ allow() { allowed++; return false; } }); await f.start();
  f.worker('denied'); f.worker('running', { waitingForDebugger: false });
  await tick(); assert.equal(allowed, 1);
  assert.equal(f.calls.filter(row => row.method === 'Runtime.evaluate').length, 0);
  assert.ok(f.calls.some(row => row.method === 'Runtime.runIfWaitingForDebugger' && row.target.sessionId === 'denied'));
  assert.equal(f.driver.snapshot().status, 'partial'); await f.driver.stop();
});
test('foreign tab events never issue a command or reach scope callback; forged parent aborts owned session', async () => {
  let allowed = 0; const f = fixture({ allow() { allowed++; return true; } }); await f.start();
  const count = f.calls.length; f.worker('foreign', {}, { tabId: 8 }); await tick(); assert.equal(f.calls.length, count);
  f.worker('forged', {}, { tabId: 7, sessionId: 'unknown-parent' }); await tick(); assert.equal(allowed, 0);
  assert.equal(f.calls.at(-1).method, 'detach'); assert.equal(f.detaches[0].reason, 'driver-failed'); await f.driver.stop();
});
test('bootstrap exception never leaves the target paused and records truthful partial state', async () => {
  const f = fixture({ send(_, method) { if (method === 'Runtime.evaluate') return { exceptionDetails: { text: 'private raw backend data' } }; } });
  await f.start(); f.worker(); await tick();
  assert.equal(f.driver.snapshot().status, 'partial'); assert.equal(f.driver.snapshot().bootstrappedWorkers, 0);
  assert.equal(JSON.stringify(f.driver.snapshot()).includes('backend'), false);
  assert.equal(f.calls.at(-1).method, 'Runtime.runIfWaitingForDebugger'); await f.driver.stop();
});
test('scope cancellation during native evaluation stops late private guard and never publishes success', async () => {
  let active = true; const evaluation = deferred();
  const f = fixture({ send(_, method) { if (method === 'Runtime.evaluate') return evaluation.promise; } });
  await f.start({ isCurrent: () => active }); f.worker(); await tick(); active = false;
  evaluation.resolve({ result: { objectId: 'late-private' } }); await tick();
  assert.equal(f.driver.snapshot().bootstrappedWorkers, 0);
  assert.ok(f.calls.some(row => row.method === 'Runtime.callFunctionOn' && row.params.objectId === 'late-private'));
  assert.ok(f.calls.some(row => row.method === 'Runtime.runIfWaitingForDebugger')); await f.driver.stop();
});
test('Stop racing pending attach fences late native ownership and detaches that exact tab', async () => {
  const pending = deferred(), f = fixture({ attach: () => pending.promise });
  const starting = f.start(); await tick(); await f.driver.stop(); pending.resolve(); await starting; await tick();
  assert.equal(f.driver.snapshot().attached, false);
  assert.equal(f.calls.filter(row => row.method === 'detach').length, 1);
  assert.equal(f.calls.some(row => row.method === 'Emulation.setHardwareConcurrencyOverride'), false);
});
test('late attach after Stop retains failed teardown ownership until native removal or explicit retry', async () => {
  const attach = deferred(); let failed = true;
  const f = fixture({ attach: () => attach.promise, detach() { if (failed) throw Error('native refused'); } });
  const starting = f.start(); await tick(); await f.driver.stop(); attach.resolve(); await starting; await tick();
  assert.equal(f.driver.snapshot().attached, true); assert.equal(f.driver.snapshot().error, 'detach-failed');
  await assert.rejects(f.start(), /session-busy/);
  failed = false; assert.equal((await f.driver.stop()).attached, false);
});
test('logical attach timeout then late attach/detach rejection cannot disappear from ownership', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const attach = deferred(), f = fixture({ attach: () => attach.promise, detach() { throw Error('native refused'); } });
  const starting = f.start(); await tick(); t.mock.timers.tick(FINGERPRINT_ENGINE_DRIVER_LIMITS.timeoutMs); await tick(); await starting;
  attach.resolve(); await tick(); assert.equal(f.driver.snapshot().attached, true); assert.equal(f.driver.snapshot().error, 'detach-failed');
  await assert.rejects(f.start(), /session-busy/); f.listeners.get('removed')(7); assert.equal(f.driver.snapshot().attached, false);
});
test('worker flood aborts transport once, without unbounded resume commands or bootstrap backlog', async () => {
  const waiting = deferred(), f = fixture({ allow: () => waiting.promise }); await f.start();
  for (let index = 0; index < 100; index++) f.worker('w' + index);
  waiting.resolve(false);
  await tick();
  assert.ok(f.driver.snapshot().workerCount <= FINGERPRINT_ENGINE_DRIVER_LIMITS.maxWorkers);
  assert.equal(f.calls.filter(row => row.method === 'detach').length, 1);
  assert.ok(f.maxNativePending() <= FINGERPRINT_ENGINE_DRIVER_LIMITS.maxPending, 'physical concurrency remains bounded independently of lifetime commands');
  assert.equal(f.waiting.size,0,'native detach alone does not clear the paused-state fixture');
  assert.equal(f.detaches[0].reason, 'driver-failed');
  await tick(); await f.driver.stop();
});
test('late stopping targets are resumed before final autoattach disable without destroying existing handles', async () => {
  let f,added=false;
  f=fixture({send(target,method,params){if(!target.sessionId&&method==='Target.setAutoAttach'&&params.autoAttach===true&&params.waitForDebuggerOnStart===false&&!added){added=true;f.worker('late-one');queueMicrotask(()=>f.worker('late-two'));}}});
  await f.start();f.worker('initial');await tick();await f.driver.stop();
  assert.equal(f.waiting.size,0);assert.equal(added,true);
  const disabled=f.calls.findIndex(row=>row.method==='Target.setAutoAttach'&&row.params.autoAttach===false);
  for(const id of ['late-one','late-two']){const resumed=f.calls.findIndex(row=>row.method==='Runtime.runIfWaitingForDebugger'&&row.target.sessionId===id);assert.ok(resumed>=0&&resumed<disabled);}
  const restored=f.calls.findIndex(row=>row.method==='Runtime.callFunctionOn'&&row.params.objectId==='private-initial');assert.ok(restored>=0&&restored<disabled);
  assert.ok(f.maxNativePending()<=FINGERPRINT_ENGINE_DRIVER_LIMITS.maxPending);
});
test('false attach hint during teardown still receives native resume before child transport is disabled',async()=>{
  let f,added=false;f=fixture({send(target,method,params){if(!target.sessionId&&method==='Target.setAutoAttach'&&params.autoAttach===true&&params.waitForDebuggerOnStart===false&&!added){added=true;f.worker('transition-false',{waitingForDebugger:false});f.waiting.add('transition-false');}}});
  await f.start();await f.driver.stop();assert.equal(f.waiting.size,0,'the false transport hint is not a native startup-release oracle');
  const resumed=f.calls.findIndex(row=>row.method==='Runtime.runIfWaitingForDebugger'&&row.target.sessionId==='transition-false'),disabled=f.calls.findIndex(row=>row.method==='Target.setAutoAttach'&&row.params.autoAttach===false);
  assert.ok(resumed>=0&&disabled>resumed);assert.equal(f.calls.some(row=>row.method==='Runtime.evaluate'&&row.target.sessionId==='transition-false'),false);
});
test('incomplete paused cleanup keeps attached ownership and disposal listeners until real native release', async t => {
  t.mock.timers.enable({apis:['setTimeout']});const pending=deferred();
  const f=fixture({send(_target,method){if(method==='Runtime.runIfWaitingForDebugger')return pending.promise;}});await f.start();f.worker();await tick();
  const stopping=f.driver.stop();await tick();t.mock.timers.tick(FINGERPRINT_ENGINE_DRIVER_LIMITS.timeoutMs);await tick();
  assert.equal((await stopping).attached,true);assert.equal(f.calls.some(row=>row.method==='detach'),false);await assert.rejects(f.start(),/session-busy/);
  await f.driver.dispose();assert.ok(f.listeners.has('event')&&f.listeners.has('removed'));
  f.listeners.get('removed')(7);pending.resolve({});await tick();assert.equal(f.driver.snapshot().attached,false);assert.equal(f.listeners.size,0);
});
test('late physical bootstrap result is privately restored before disabling child transport', async () => {
  const evaluation=deferred(),f=fixture({send(_target,method){if(method==='Runtime.evaluate')return evaluation.promise;}});
  await f.start();f.worker();await tick();const stopping=f.driver.stop();await tick();
  assert.equal(f.calls.some(row=>row.method==='Target.setAutoAttach'&&row.params.autoAttach===false),false);
  evaluation.resolve({result:{objectId:'late-cleanup-private'}});await stopping;
  const restored=f.calls.findIndex(row=>row.method==='Runtime.callFunctionOn'&&row.params.objectId==='late-cleanup-private'),disabled=f.calls.findIndex(row=>row.method==='Target.setAutoAttach'&&row.params.autoAttach===false);
  assert.ok(restored>=0&&disabled>restored);assert.equal(f.waiting.size,0);assert.equal(f.driver.snapshot().attached,false);
});
test('no arbitrary Runtime/Network command, accessor profile or forged source crosses driver', async () => {
  const f = fixture();
  await assert.rejects(f.start({ profile: { ...profile, commands: [{ method: 'Runtime.evaluate', params: { expression: 'leak' } }] } }), /invalid-profile/);
  let reads = 0; const params = Object.defineProperty({}, 'hardwareConcurrency', { get() { reads++; return 3; } });
  await assert.rejects(f.start({ profile: { ...profile, commands: [{ method: 'Emulation.setHardwareConcurrencyOverride', params }] } }), /invalid-profile/);
  await assert.rejects(f.start({ workerSource: { ...capability } }), /invalid-worker-source/);
  const rows = Object.defineProperty([], '0', { get() { reads++; return profile.commands[0]; }, configurable: true });
  await assert.rejects(f.start({ profile: { ...profile, commands: rows } }), /invalid-profile/);
  const method = { [Symbol.toPrimitive]() { reads++; return 'Runtime.evaluate'; } };
  await assert.rejects(f.start({ profile: { ...profile, commands: [{ method, params: {} }] } }), /invalid-profile/);
  assert.equal(reads, 0); assert.equal(f.calls.length, 0); await f.driver.dispose();
});
test('only the proven empty native UA reset is allowed, and executes before detach', async () => {
  const f=fixture();
  for(const params of [{userAgent:'other'},{userAgent:'',platform:'other'}])await assert.rejects(f.start({profile:{...profile,resetCommands:[{method:'Emulation.setUserAgentOverride',params}]}}),/invalid-profile/);
  await f.start({profile:{...profile,resetCommands:[{method:'Emulation.setUserAgentOverride',params:{userAgent:''}}]}});await f.driver.stop();
  const reset=f.calls.findIndex(row=>row.method==='Emulation.setUserAgentOverride');assert.ok(reset>=0&&reset<f.calls.findIndex(row=>row.method==='detach'));
});
test('native detach clears ownership and invokes bounded callback, without attempting to reattach', async () => {
  const f = fixture(); await f.start(); f.worker(); await tick();
  f.listeners.get('detach')({ tabId: 7 }, 'canceled_by_user');
  assert.equal(f.driver.snapshot().attached, false); assert.equal(f.driver.snapshot().error, 'debugger-detached');
  assert.deepEqual(f.detaches, [{ reason: 'debugger-detached' }]);
  await f.driver.stop(); assert.equal(f.calls.filter(row => row.method === 'attach').length, 1);
});
test('unsupported browser remains unavailable without opening tabs or attempting commands', async () => {
  const driver = create({}); assert.equal((await driver.start()).error, 'unsupported'); await driver.dispose();
});
test('four-second native bootstrap deadline releases paused target and restores a late guard', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const evaluation = deferred(), f = fixture({ send(_, method) { if (method === 'Runtime.evaluate') return evaluation.promise; } });
  await f.start(); f.worker(); await tick();
  assert.equal(f.calls.at(-1).method, 'Runtime.evaluate');
  t.mock.timers.tick(FINGERPRINT_ENGINE_DRIVER_LIMITS.timeoutMs); await tick();
  assert.equal(f.driver.snapshot().status, 'partial');
  assert.equal(f.calls.at(-1).method, 'Runtime.runIfWaitingForDebugger');
  evaluation.resolve({ result: { objectId: 'timed-out-private' } }); await tick();
  assert.ok(f.calls.some(row => row.method === 'Runtime.callFunctionOn' && row.params.objectId === 'timed-out-private'));
  await f.driver.stop();
});
test('slow scope authorization has its own four-second pause deadline; late approval never bootstraps', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const scope = deferred(), f = fixture({ allow: () => scope.promise }); await f.start(); f.worker(); await tick();
  t.mock.timers.tick(FINGERPRINT_ENGINE_DRIVER_LIMITS.timeoutMs); await tick();
  assert.equal(f.calls.at(-1).method, 'Runtime.runIfWaitingForDebugger');
  assert.equal(f.calls.some(row => row.method === 'Runtime.evaluate'), false);
  scope.resolve(true); await tick(); assert.equal(f.calls.some(row => row.method === 'Runtime.evaluate'), false);
  await f.driver.stop();
});
test('native attach timeout does not leak an attachment that physically completes after Stop', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const attach = deferred(), f = fixture({ attach: () => attach.promise });
  const starting = f.start(); await tick();
  t.mock.timers.tick(FINGERPRINT_ENGINE_DRIVER_LIMITS.timeoutMs); await tick();
  assert.equal((await starting).attached, false);
  assert.equal(f.calls.filter(row => row.method === 'detach').length, 0);
  await assert.rejects(f.start(), /session-busy/, 'logical timeout cannot release physical native-attach ownership');
  attach.resolve(); await tick();
  assert.equal(f.calls.filter(row => row.method === 'detach').length, 1);
  assert.equal(f.calls.some(row => row.method === 'Target.setAutoAttach'), false);
});
test('private restoration happens before autoattach disable can detach the child session', async () => {
  let childDetached = false, restored = false;
  const f = fixture({ send(_, method, params) {
    if (method === 'Target.setAutoAttach' && params.autoAttach === false) childDetached = true;
    if (method === 'Runtime.callFunctionOn') { assert.equal(childDetached, false); restored = true; }
  } });
  await f.start(); f.worker(); await tick(); await f.driver.stop(); assert.equal(restored, true);
});
test('unexpected unhandled target type aborts instead of pausing or modifying an unsupported worker', async () => {
  const f = fixture(); await f.start();
  f.worker('shared', { targetInfo: { type: 'shared_worker', url: 'https://qa.example/shared.js' } }); await tick();
  assert.equal(f.calls.filter(row => row.method === 'Runtime.evaluate').length, 0);
  assert.equal(f.calls.at(-1).method, 'detach'); assert.equal(f.detaches[0].reason, 'driver-failed');
});
test('unaddressable paused target retains uncertain ownership until native tab closure', async () => {
  const f = fixture(); await f.start(); f.worker('x'.repeat(257)); await tick();
  assert.equal(f.calls.filter(row => row.method === 'Runtime.evaluate').length, 0);
  assert.equal(f.calls.some(row=>row.method==='detach'),false); assert.equal(f.detaches[0].reason, 'driver-failed');assert.equal(f.driver.snapshot().attached,true);
  await f.driver.stop();assert.equal(f.calls.some(row=>row.method==='detach'),false);f.listeners.get('removed')(7);assert.equal(f.driver.snapshot().attached,false);
});
test('cleanup intake saturation stays uncertain across retries instead of dropping the unrecorded paused target',async()=>{
  const waiting=deferred(),f=fixture({allow:()=>waiting.promise});await f.start();for(let i=0;i<140;i++)f.worker('capacity'+i);waiting.resolve(false);await tick();await f.driver.stop();
  assert.equal(f.driver.snapshot().attached,true);assert.equal(f.calls.some(row=>row.method==='detach'),false);await f.driver.stop();assert.equal(f.driver.snapshot().attached,true);
  assert.ok(f.maxNativePending()<=FINGERPRINT_ENGINE_DRIVER_LIMITS.maxPending);f.listeners.get('removed')(7);
});
test('onChange may synchronously request Stop without recursion or duplicate native detach', async () => {
  const f = fixture(); await f.start();
  let requested = false;
  const original = f.changes.push;
  f.changes.push = function(value) { original.call(this, value); if (!requested && value.status === 'stopping') { requested = true; void f.driver.stop(); } };
  await f.driver.stop(); assert.equal(requested, true); assert.equal(f.calls.filter(row => row.method === 'detach').length, 1);
});
test('detach failure is visible instead of claiming native cleanup success', async () => {
  const f = fixture({ detach() { throw Error('native detail'); } }); await f.start();
  const result = await f.driver.stop();
  assert.equal(result.error, 'detach-failed');
  assert.equal(result.attached, true, 'failed teardown retains physical ownership');
  await assert.rejects(f.start(), /session-busy/);
  assert.equal(JSON.stringify(result).includes('native detail'), false);
  f.listeners.get('detach')({ tabId: 7 }, 'target_closed');
  assert.equal(f.driver.snapshot().attached, false);
});
test('successful explicit Stop retry releases failed detach ownership', async () => {
  let failures = 1; const f = fixture({ detach() { if (failures-- > 0) throw Error('native refused'); } }); await f.start();
  assert.equal((await f.driver.stop()).attached, true);
  const retried = await f.driver.stop(); assert.equal(retried.attached, false); assert.equal(retried.error, null);
  assert.equal(f.calls.filter(row => row.method === 'detach').length, 2);
});
test('native owned tab removal releases failed teardown; unrelated tab removal does not', async () => {
  const f = fixture({ detach() { throw Error('native refused'); } }); await f.start(); await f.driver.stop();
  f.listeners.get('removed')(8); assert.equal(f.driver.snapshot().attached, true);
  f.listeners.get('removed')(7); assert.equal(f.driver.snapshot().attached, false);
});
test('logical detach timeout keeps ownership until actual late native completion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred(), f = fixture({ detach: () => pending.promise }); await f.start();
  const stopping = f.driver.stop(); await tick(); t.mock.timers.tick(FINGERPRINT_ENGINE_DRIVER_LIMITS.timeoutMs); await tick();
  assert.equal((await stopping).attached, true); await assert.rejects(f.start(), /session-busy/);
  await f.driver.stop(); assert.equal(f.calls.filter(row => row.method === 'detach').length, 1, 'pending physical detach is not duplicated by retry');
  pending.resolve(); await tick(); assert.equal(f.driver.snapshot().attached, false);
});
test('failed emergency detach retains ownership and an event flood cannot retry native teardown', async () => {
  const f = fixture({ detach() { throw Error('native refused'); } }); await f.start();
  f.worker('bad', { targetInfo: { type: 'service_worker', url: 'https://qa.example/sw.js' } }); await tick();
  assert.equal(f.driver.snapshot().attached, true); assert.equal(f.driver.snapshot().error, 'detach-failed');
  for (let i = 0; i < 100; i++) f.worker('more' + i); await tick();
  assert.equal(f.calls.filter(row => row.method === 'detach').length, 1); await assert.rejects(f.start(), /session-busy/);
  f.listeners.get('removed')(7); assert.equal(f.driver.snapshot().attached, false);
});
test('concurrent start does not attach two owned debugger sessions and scope callback failure resumes safely', async () => {
  const f = fixture({ allow() { throw Error('secret site'); } }); await f.start();
  await assert.rejects(f.start(), /session-busy/);
  f.worker(); await tick();
  assert.equal(f.calls.filter(row => row.method === 'attach').length, 1);
  assert.equal(f.calls.filter(row => row.method === 'Runtime.evaluate').length, 0);
  assert.equal(f.calls.at(-1).method, 'Runtime.runIfWaitingForDebugger');
  assert.equal(JSON.stringify(f.driver.snapshot()).includes('secret site'), false); await f.driver.stop();
});
