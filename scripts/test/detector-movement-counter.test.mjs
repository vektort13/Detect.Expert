// ADR-097: serialized ISOLATED lease semantics; no browser or physical input fixture.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {detectorMovementLease} from '../../apps/production-extension/detector-movement-counter.js';

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const C = 'c0000000-0000-4000-8000-000000000003';
const SLOT = 'detect.expert/isolated-movement-leases/v1';
const MAX = 2147483647;
const TTL = 120000;
const ALL_SCOPE = {scopeMode: 'all-sites', hosts: [], grantedAllSites: true};

function fixture(seed = 1, distinctWindow = false) {
  const context = vm.createContext({});
  vm.runInContext(`
    const NativeMap = Map, nativeApply = Reflect.apply;
    globalThis.qa = {now: 0, seed: ${seed}, timerId: 0, timers: new NativeMap(), listeners: [], maps: [],
      addCalls: [], removeCalls: [], clearedTimers: [], eventReads: [], forbiddenReads: 0, randomCalls: 0,
      addFails: false, timerFails: false, clockCalls: 0};
    globalThis.window = ${distinctWindow ? 'Object.create(null)' : 'globalThis'};qa.nativeWindow = window;
    window.location = {protocol: 'https:', hostname: 'source.example.test'};globalThis.URL = qaURL;
    globalThis.Map = class CapturedLeaseMap extends NativeMap {constructor(...args) {super(...args);qa.maps.push(this);}};
    globalThis.EventTarget = class EventTarget {
      addEventListener(type, callback, options) {
        qa.addCalls.push({type, callback, options, correctReceiver: this === qa.nativeWindow});
        if (qa.addFails) throw new Error('NATIVE_ADD_FAILURE');
        if (this !== qa.nativeWindow || type !== 'mousemove' || typeof callback !== 'function') throw new Error('NATIVE_BRAND');
        qa.listeners.push({type, callback, capture: options.capture});
      }
      removeEventListener(type, callback, capture) {
        qa.removeCalls.push({type, callback, capture, correctReceiver: this === qa.nativeWindow});
        if (this !== qa.nativeWindow) throw new Error('NATIVE_BRAND');
        qa.listeners = qa.listeners.filter(row => row.type !== type || row.callback !== callback || row.capture !== capture);
      }
    };
    globalThis.performance = {now() {if (this !== performance) throw new Error('CLOCK_RECEIVER');qa.clockCalls++;return qa.now;}};
    globalThis.setTimeout = function(callback, delay) {
      if (this !== globalThis) throw new Error('TIMER_RECEIVER');
      if (qa.timerFails) throw new Error('NATIVE_TIMER_FAILURE');
      const id = ++qa.timerId;qa.timers.set(id, {callback, delay, due: qa.now + delay});return id;
    };
    globalThis.clearTimeout = function(id) {
      if (this !== globalThis) throw new Error('TIMER_RECEIVER');qa.clearedTimers.push(id);qa.timers.delete(id);
    };
    globalThis.crypto = {getRandomValues(words) {
      if (!(words instanceof Uint32Array) || words.length !== 4) throw new Error('RANDOM_BUFFER');
      qa.randomCalls++;for (let i = 0; i < words.length; i++) words[i] = qa.seed++;return words;
    }};
    const forbidden = new Proxy(Object.create(null), {get() {qa.forbiddenReads++;throw new Error('PAGE_VALUE_READ');}});
    globalThis.document = forbidden;globalThis.chrome = forbidden;globalThis.browser = forbidden;
    globalThis.fetch = () => {qa.forbiddenReads++;throw new Error('NETWORK_CALL');};
    qa.dispatch = trusted => {
      const event = new Proxy(Object.create(null), {get(_target, key) {
        qa.eventReads.push(key);if (key === 'isTrusted') return trusted;throw new Error('EVENT_VALUE_READ');
      }});
      for (const row of [...qa.listeners]) nativeApply(row.callback, globalThis, [event]);
    };
    qa.flushTimers = () => {
      const due = [...qa.timers].filter(([, row]) => row.due <= qa.now);
      for (const [id, row] of due) if (qa.timers.delete(id)) nativeApply(row.callback, globalThis, []);
    };
    globalThis.injectedLease = (${detectorMovementLease.toString()});
  `, Object.assign(context, {qaURL: URL}));
  const run = source => vm.runInContext(source, context);
  const json = source => JSON.parse(run(`JSON.stringify((${source}))`));
  function call(action, leaseId, policy = ALL_SCOPE) {
    context.qaAction = action;context.qaLeaseId = leaseId;context.qaPolicyJSON = JSON.stringify(policy);
    return json('injectedLease(qaAction, qaLeaseId, typeof qaPolicyJSON === "string" ? JSON.parse(qaPolicyJSON) : undefined)');
  }
  return {
    context, run, json, call, sample: (id = A, policy = ALL_SCOPE) => call('sample', id, policy), close: (id = A) => call('close', id),
    event: (...args) => {context.qaTrusted = args.length ? args[0] : true;run('qa.dispatch(qaTrusted)');},
    advance(milliseconds, flush = false) {context.qaDelta = milliseconds;run('qa.now += qaDelta');if (flush) run('qa.flushTimers()');},
    get listeners() {return run('qa.listeners.length');}, get timers() {return run('qa.timers.size');},
    get holderPresent() {return run(`Object.hasOwn(globalThis, Symbol.for('${SLOT}'))`);},
  };
}

test('the serialized lease starts at zero, attaches one passive capture listener and only returns bounded metadata', () => {
  const f = fixture(), first = f.sample();
  assert.deepEqual(Object.keys(first).sort(), ['count', 'documentToken', 'generation', 'saturated', 'state']);
  assert.deepEqual({...first, documentToken: 'token'}, {state: 'ready', documentToken: 'token', generation: 1, count: 0, saturated: false});
  assert.match(first.documentToken, /^[a-f0-9]{32}$/u);
  assert.equal(f.listeners, 1);assert.equal(f.timers, 1);
  assert.deepEqual(f.json('qa.addCalls.map(({type, options, correctReceiver}) => ({type, options, correctReceiver}))'), [{type: 'mousemove', options: {capture: true, passive: true}, correctReceiver: true}]);
  assert.deepEqual(f.json('[...qa.timers.values()].map(row => row.delay)'), [1000]);
  assert.equal(f.run('qa.forbiddenReads'), 0);assert.equal(f.run('qa.clockCalls'), 1);
  const next = f.sample();assert.deepEqual(next, first);assert.equal(f.run('qa.addCalls.length'), 1);assert.equal(f.timers, 1);
});

test('only exact isTrusted true events count and no coordinates, type, buttons or form properties are read', () => {
  const f = fixture();f.sample();
  for (const trusted of [false, undefined, null, 0, 1, 'true']) f.event(trusted);
  assert.equal(f.sample().count, 0);
  f.event(true);f.event(true);assert.equal(f.sample().count, 2);
  assert.deepEqual(f.json('qa.eventReads'), new Array(8).fill('isTrusted'));
  assert.equal(f.run('qa.forbiddenReads'), 0);
});

test('Firefox-like ISOLATED sandbox keeps private ownership on globalThis while native listeners require the distinct DOM Window', () => {
  const f = fixture(1, true);assert.equal(f.run('globalThis === window'), false);
  assert.equal(f.sample().state, 'ready');assert.equal(f.listeners, 1);assert.equal(f.holderPresent, true);
  assert.equal(f.run(`Object.hasOwn(window, Symbol.for('${SLOT}'))`), false);
  f.event(true);assert.equal(f.sample().count, 1);assert.deepEqual(f.json('qa.eventReads'), ['isTrusted']);
  assert.equal(f.close().state, 'closed');assert.equal(f.listeners, 0);assert.equal(f.timers, 0);assert.equal(f.holderPresent, false);
  assert.ok(f.json('qa.addCalls.every(row => row.correctReceiver) && qa.removeCalls.every(row => row.correctReceiver)'));
});

test('a retained broad grant never replaces exact site scope; the current native hostname is checked before attach and renewal', () => {
  const f = fixture(), policy = {scopeMode: 'site', hosts: ['source.example.test'], grantedAllSites: true};
  f.run('window.location.hostname = "foreign.example.test"');assert.deepEqual(f.sample(A, policy), {state: 'unavailable'});assert.equal(f.listeners, 0);assert.equal(f.run('qa.randomCalls'), 0);
  f.run('window.location.hostname = "source.example.test"');assert.equal(f.sample(A, policy).state, 'ready');f.event();
  f.run('window.location.hostname = "sub.source.example.test"');assert.deepEqual(f.sample(A, policy), {state: 'unavailable'});assert.equal(f.listeners, 0);assert.equal(f.timers, 0);
  assert.equal(f.close().state, 'closed');
});

test('missing, ungranted, opaque and accessor policy inputs cannot create a lease or read policy getters', () => {
  for(const policy of[null,true,{scopeMode:'all-sites',hosts:[],grantedAllSites:false},{scopeMode:'active-tab',hosts:[],grantedAllSites:true},{scopeMode:'site',hosts:['source.example.test/foreign'],grantedAllSites:true}]){
    const f = fixture();assert.equal(f.sample(A, policy).state, 'unavailable');assert.equal(f.listeners, 0);assert.equal(f.run('qa.randomCalls'), 0);
  }
  const f = fixture();f.run('window.location.protocol = "about:"');assert.equal(f.sample().state, 'unavailable');assert.equal(f.listeners, 0);
  f.run('qa.policyGetterReads=0;qa.hostilePolicy={scopeMode:"site",grantedAllSites:true};Object.defineProperty(qa.hostilePolicy,"hosts",{get(){qa.policyGetterReads++;throw Error("GETTER");}})');
  assert.equal(f.json(`injectedLease('sample', '${A}', qa.hostilePolicy)`).state, 'unavailable');assert.equal(f.run('qa.policyGetterReads'), 0);
});

test('cross-realm injected policy records use own bounded fields without requiring same-realm Object.prototype identity', () => {
  const f=fixture(1,true);f.context.qaForeignPolicy={scopeMode:'site',hosts:['source.example.test'],grantedAllSites:true};
  assert.equal(f.run('Object.getPrototypeOf(qaForeignPolicy) === Object.prototype'),false);
  assert.equal(f.json(`injectedLease('sample', '${A}', qaForeignPolicy)`).state,'ready');f.event();assert.equal(f.sample().count,1);f.close();assert.equal(f.listeners,0);
});

test('leases observe independent intervals without duplicate listeners or resetting a different view', () => {
  const f = fixture(), a = f.sample(A);f.event();f.event();
  const b = f.sample(B);assert.equal(b.count, 0);assert.equal(b.generation, 2);assert.equal(b.documentToken, a.documentToken);
  f.event();assert.equal(f.sample(A).count, 3);assert.equal(f.sample(B).count, 1);
  f.close(A);f.event();assert.equal(f.sample(B).count, 2);
  assert.equal(f.listeners, 1);assert.equal(f.timers, 1);assert.equal(f.run('qa.addCalls.length'), 1);
  const restarted = f.sample(A);assert.equal(restarted.count, 0);assert.equal(restarted.generation, 3);assert.equal(f.sample(B).count, 2);
});

test('at most eight leases are retained; a refused ninth cannot consume capacity or change existing counts', () => {
  const f = fixture(), ids = Array.from({length: 9}, (_, index) => '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'));
  for (const id of ids.slice(0, 8)) assert.equal(f.sample(id).state, 'ready');
  assert.deepEqual(f.sample(ids[8]), {state: 'unavailable'});assert.equal(f.run('qa.maps[0].size'), 8);
  f.event();for (const id of ids.slice(0, 8)) assert.equal(f.sample(id).count, 1);
  f.close(ids[0]);const admitted = f.sample(ids[8]);assert.equal(admitted.state, 'ready');assert.equal(admitted.count, 0);assert.equal(admitted.generation, 9);
  assert.equal(f.run('qa.maps[0].size'), 8);assert.equal(f.listeners, 1);assert.equal(f.timers, 1);
});

test('sampling renews only that lease and expiry uses an exact120-second monotonic deadline', () => {
  const f = fixture();f.sample(A);f.sample(B);f.event();f.advance(TTL - 1);assert.equal(f.sample(A).count, 1);
  f.advance(1);f.event();assert.equal(f.run(`qa.maps[0].has('${A}')`), true);assert.equal(f.run(`qa.maps[0].has('${B}')`), false);
  assert.equal(f.sample(A).count, 2);
  const expired = f.sample(B);assert.equal(expired.count, 0);assert.equal(expired.generation, 3);
  assert.equal(f.sample(A).generation, 1);assert.equal(f.listeners, 1);
});

test('an expired lease is removed by the next event even if its timer never runs; the event is not read or counted', () => {
  const f = fixture(), before = f.sample();f.event();f.advance(TTL);
  f.run('qa.eventReads = []');f.event();
  assert.equal(f.listeners, 0);assert.equal(f.timers, 0);assert.equal(f.holderPresent, false);assert.equal(f.run('qa.maps[0].size'), 0);
  assert.deepEqual(f.json('qa.eventReads'), []);assert.equal(f.run('qa.removeCalls.length'), 1);
  const after = f.sample();assert.equal(after.count, 0);assert.notEqual(after.documentToken, before.documentToken);assert.equal(f.listeners, 1);
});

test('a delayed timer expires the old lease without removing a separately renewed lease, then cleans all resources', () => {
  const f = fixture();f.sample(A);f.advance(TTL / 2);f.sample(B);f.advance(TTL / 2, true);
  assert.equal(f.run(`qa.maps[0].has('${A}')`), false);assert.equal(f.run(`qa.maps[0].has('${B}')`), true);
  assert.equal(f.listeners, 1);assert.equal(f.timers, 1);f.event();assert.equal(f.sample(B).count, 1);
  f.advance(TTL, true);assert.equal(f.listeners, 0);assert.equal(f.timers, 0);assert.equal(f.holderPresent, false);
});

test('closing only the caller lease preserves other views; final and repeated closes remove listener/timer exactly once', () => {
  const f = fixture();f.sample(A);f.sample(B);assert.deepEqual(f.close(C), {state: 'closed'});
  assert.equal(f.run('qa.maps[0].size'), 2);f.close(A);assert.equal(f.listeners, 1);assert.equal(f.timers, 1);
  f.event();assert.equal(f.sample(B).count, 1);f.close(B);
  assert.equal(f.listeners, 0);assert.equal(f.timers, 0);assert.equal(f.holderPresent, false);
  assert.equal(f.run('qa.removeCalls.length'), 1);assert.equal(f.run('qa.removeCalls[0].callback === qa.addCalls[0].callback'), true);
  assert.deepEqual(f.json('qa.removeCalls.map(({type, capture, correctReceiver}) => ({type, capture, correctReceiver}))'), [{type: 'mousemove', capture: true, correctReceiver: true}]);
  const created = f.run('qa.randomCalls');assert.deepEqual(f.close(B), {state: 'closed'});assert.equal(f.run('qa.randomCalls'), created);assert.equal(f.run('qa.removeCalls.length'), 1);
});

test('an unknown close does not renew another lease or create a listener in an untouched document', () => {
  const untouched = fixture();assert.deepEqual(untouched.close(), {state: 'closed'});assert.equal(untouched.listeners, 0);assert.equal(untouched.timers, 0);assert.equal(untouched.run('qa.randomCalls'), 0);
  const f = fixture();f.sample(A);f.advance(TTL - 1000);f.close(B);f.advance(1000);f.event();assert.equal(f.listeners, 0);assert.equal(f.holderPresent, false);
});

test('queued callbacks from a closed holder cannot read an event, detach or delete a newly started holder', () => {
  const f = fixture(), before = f.sample(A);
  f.run('qa.oldTimer = [...qa.timers.values()][0].callback;qa.oldListener = qa.listeners[0].callback');f.close(A);
  const after = f.sample(B);assert.notEqual(after.documentToken, before.documentToken);f.event();
  f.run(`nativeApply(qa.oldTimer, globalThis, []);nativeApply(qa.oldListener, globalThis, [new Proxy({}, {get() {qa.forbiddenReads++;throw Error('STALE_EVENT_READ');}})])`);
  assert.equal(f.run('qa.forbiddenReads'), 0);assert.equal(f.holderPresent, true);assert.equal(f.listeners, 1);assert.equal(f.timers, 1);
  assert.equal(f.sample(B).count, 1);assert.equal(f.run('qa.removeCalls.length'), 1);f.close(B);
});

test('counts saturate at the signed 31-bit limit without allocating or dispatching billions of events', () => {
  const f = fixture();f.sample(A);f.sample(B);
  f.run(`qa.maps[0].get('${A}').count = ${MAX - 1};qa.maps[0].get('${B}').count = 8`);
  f.event();assert.equal(f.sample(A).count, MAX);f.event();f.event();
  const capped = f.sample(A);assert.equal(capped.count, MAX);assert.equal(capped.saturated, true);
  assert.equal(f.sample(B).count, 11);assert.equal(f.sample(B).saturated, false);
});

test('the same lease ID in two documents has independent token, count, timer and cleanup', () => {
  const first = fixture(10), second = fixture(100), a = first.sample(A), b = second.sample(A);
  assert.notEqual(a.documentToken, b.documentToken);first.event();first.event();second.event();
  assert.equal(first.sample(A).count, 2);assert.equal(second.sample(A).count, 1);
  first.close(A);assert.equal(first.listeners, 0);assert.equal(second.listeners, 1);second.event();assert.equal(second.sample(A).count, 2);
});

test('invalid actions and bounded lease keys fail before touching events, timers, randomness or page values', () => {
  const f = fixture();let coercions = 0;const hostile = {toString() {coercions++;throw Error('COERCION');}};
  for (const action of [undefined, null, 0, {}, hostile, 'start', 'SAMPLE', 'sample ']) assert.deepEqual(f.call(action, A), {state: 'unavailable'});
  for (const id of [undefined, null, 7, {}, [], hostile, Symbol('lease'), '', 'a'.repeat(19), 'a'.repeat(65), A.toUpperCase(), A.slice(0, -1) + 'z', '../' + A]) assert.deepEqual(f.call('sample', id), {state: 'unavailable'});
  assert.equal(coercions, 0);assert.equal(f.listeners, 0);assert.equal(f.timers, 0);assert.equal(f.run('qa.randomCalls'), 0);assert.equal(f.holderPresent, false);assert.equal(f.run('qa.forbiddenReads'), 0);
});

test('foreign incompatible holder and accessor fields cannot execute getters or attach a listener', () => {
  for (const value of [`{}`, `{get operate() {qa.forbiddenReads++;throw Error('GETTER');}}`]) {
    const f = fixture();f.run(`Object.defineProperty(globalThis, Symbol.for('${SLOT}'), {value: ${value}, configurable: true})`);
    assert.deepEqual(f.sample(), {state: 'unavailable'});assert.equal(f.run('qa.forbiddenReads'), 0);assert.equal(f.listeners, 0);assert.equal(f.timers, 0);
  }
});

test('an existing foreign accessor or undefined own slot is neither evaluated nor overwritten', () => {
  for (const accessor of [false, true]) {
    const f = fixture();
    f.run(`qa.slotGetter = function() {qa.forbiddenReads++;throw Error('FOREIGN_SLOT_GETTER');};
      Object.defineProperty(globalThis, Symbol.for('${SLOT}'), ${accessor ? '{get: qa.slotGetter, configurable: true}' : '{value: undefined, writable: true, configurable: true}'});`);
    assert.deepEqual(f.sample(), {state: 'unavailable'});assert.equal(f.listeners, 0);assert.equal(f.timers, 0);assert.equal(f.run('qa.randomCalls'), 0);assert.equal(f.run('qa.forbiddenReads'), 0);
    assert.equal(f.run(`Object.getOwnPropertyDescriptor(globalThis, Symbol.for('${SLOT}')).${accessor ? 'get === qa.slotGetter' : 'value === undefined'}`), true);
    assert.equal(f.holderPresent, true);
  }
});

test('missing required native functions and failed randomness return unavailable without injecting page operations', () => {
  for (const setup of ['EventTarget.prototype.addEventListener = undefined', 'EventTarget.prototype.removeEventListener = undefined', 'globalThis.setTimeout = undefined', 'globalThis.clearTimeout = undefined', 'performance.now = undefined', 'crypto.getRandomValues = () => {throw Error("RANDOM_FAILURE")}']) {
    const f = fixture();f.run(setup);assert.deepEqual(f.sample(), {state: 'unavailable'});assert.equal(f.listeners, 0);assert.equal(f.timers, 0);assert.equal(f.run('qa.forbiddenReads'), 0);assert.equal(f.holderPresent, false);
  }
});

test('a native addEventListener failure is unavailable, starts no timer and does not execute a page operation', () => {
  const f = fixture();f.run('qa.addFails = true');assert.deepEqual(f.sample(), {state: 'unavailable'});
  assert.equal(f.run('qa.addCalls.length'), 1);assert.equal(f.listeners, 0);assert.equal(f.timers, 0);assert.equal(f.run('qa.forbiddenReads'), 0);
  assert.deepEqual(f.close(), {state: 'closed'});assert.equal(f.holderPresent, false);
  f.run('qa.addFails = false');assert.equal(f.sample().state, 'ready');assert.equal(f.listeners, 1);f.close();assert.equal(f.listeners, 0);
});

test('a native timer setup failure rolls back the installed listener instead of leaving an unexpired unavailable counter', () => {
  const f = fixture();f.run('qa.timerFails = true');assert.deepEqual(f.sample(), {state: 'unavailable'});
  assert.equal(f.listeners, 0);assert.equal(f.timers, 0);assert.equal(f.holderPresent, false);assert.equal(f.run('qa.forbiddenReads'), 0);
  f.run('qa.timerFails = false');assert.equal(f.sample().state, 'ready');f.close();assert.equal(f.listeners, 0);
});

test('a native timer reschedule failure also detaches live leases without an uncaught observer error', () => {
  const f = fixture();f.sample(A);f.event();f.run('qa.timerFails = true');
  assert.doesNotThrow(() => f.advance(1000, true));assert.equal(f.listeners, 0);assert.equal(f.timers, 0);assert.equal(f.holderPresent, false);
  f.run('qa.timerFails = false');assert.equal(f.sample(A).count, 0);f.close(A);
});

test('an immutable slot rejects publication before installing an event listener', () => {
  const f = fixture();f.run(`Object.defineProperty(globalThis, Symbol.for('${SLOT}'), {value: undefined, configurable: false})`);
  assert.deepEqual(f.sample(), {state: 'unavailable'});assert.equal(f.listeners, 0);assert.equal(f.timers, 0);assert.equal(f.run('qa.forbiddenReads'), 0);
});
