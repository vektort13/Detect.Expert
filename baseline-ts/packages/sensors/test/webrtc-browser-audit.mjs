// DET-056/057, REQ-001/002/005 / ADR-006: independently compiled real browser semantics.
// Every RTCPeerConnection is created by this fixture with iceServers:[]; no remote SDP is used.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { startFixtureServer } from '../../../tests/fixture-server.mjs';

const built = await build({ stdin: { contents: "export { SensorRuntime, browserEnv } from './packages/sensors/src/runtime'; export { installWebRTCSensor } from './packages/sensors/src/webrtc'; export { interpretReport } from './packages/engine/src/interpret'; export { projectReport } from './packages/engine/src/projection';",
  resolveDir: process.cwd(), sourcefile: 'webrtc-native-audit.ts', loader: 'ts' }, bundle: true, write: false,
  format: 'iife', globalName: 'WebRTCAudit', platform: 'browser', target: 'es2022', logLevel: 'silent' });
const fixture = await startFixtureServer([5573]);
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const evidence = { measuredAt: new Date().toISOString(), chromium: browser.version(), extensionLoaded: false,
  connectionsCreatedBy: 'synthetic test page only', rawSdpOrCandidatesSaved: false, complete: false, cases: [] };
async function check(name, run) {
  const page = await browser.newPage();
  try {
    await page.goto(fixture.origins[0] + '/webrtc-native-audit.html');
    await page.addScriptTag({ content: built.outputFiles[0].text });
    const result = await run(page);
    evidence.cases.push({ name, result });
    console.log('PASS ' + name);
  } finally { await page.close(); }
}
try {
  await check('native constructor: original once, plain calls, subclass, statics, hostile newTarget', async page => {
    const result = await page.evaluate(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(window, 'RTCPeerConnection');
      const Native = descriptor.value;
      const nativeAlias = Object.getOwnPropertyDescriptor(window, 'webkitRTCPeerConnection')?.value;
      const aliasesInitiallyIdentical = nativeAlias === Native;
      let constructions = 0, plainCalls = 0, actual, thrown;
      const monitor = new Proxy(Native, {
        construct(target, args, newTarget) { constructions++; try { actual = Reflect.construct(target, args, newTarget === monitor ? Native : newTarget); return actual; } catch (error) { thrown = error; throw error; } },
        apply(target, receiver, args) { plainCalls++; try { actual = Reflect.apply(target, receiver, args); return actual; } catch (error) { thrown = error; throw error; } },
      });
      Object.defineProperty(window, 'RTCPeerConnection', { ...descriptor, value: monitor });
      const runtime = new WebRTCAudit.SensorRuntime(WebRTCAudit.browserEnv(window));
      WebRTCAudit.installWebRTCSensor(runtime, window);
      const Wrapped = RTCPeerConnection;
      const aliasesAfterInstallIdentical = window.webkitRTCPeerConnection === Wrapped;
      const installedWithoutConstructing = constructions === 0 && plainCalls === 0;
      const pc = new Wrapped({ iceServers: [] });
      const direct = { sameResult: pc === actual, nativeInstance: pc instanceof Native, wrappedInstance: pc instanceof Wrapped,
        prototypeSame: Wrapped.prototype === Native.prototype, retainedOriginalConstructor: pc.constructor === Native,
        constructorIdentityChanged: pc.constructor !== Wrapped, constructionCount: constructions };
      pc.close();
      class Derived extends Wrapped {}
      const child = new Derived({ iceServers: [] });
      const subclass = child instanceof Derived && child instanceof Wrapped && child instanceof Native && Object.getPrototypeOf(child) === Derived.prototype;
      child.close();
      let errorIdentity = false;
      try { Wrapped({ iceServers: [] }); } catch (error) { errorIdentity = error === thrown && error instanceof TypeError; }
      const configError = new Error('synthetic configuration failure');
      let configReads = 0, configIdentity = false;
      try { new Wrapped({ get iceServers() { configReads++; throw configError; } }); } catch (error) { configIdentity = error === configError && error === thrown; }
      let invalidNativeIdentity = false;
      try { new Wrapped({ iceServers: [], iceCandidatePoolSize: -1 }); } catch (error) { invalidNativeIdentity = error === thrown && error instanceof TypeError; }
      let aliasConfigReads = 0, aliasInstance = null;
      if (typeof nativeAlias === 'function') {
        const aliasPc = new window.webkitRTCPeerConnection({ get iceServers() { aliasConfigReads++; return []; } });
        aliasInstance = aliasPc instanceof Native && aliasPc instanceof window.webkitRTCPeerConnection;
        aliasPc.close();
      }
      function targetCheck(Constructor) {
        let reads = 0;
        const expected = Object.create(Native.prototype);
        const NewTarget = new Proxy(function () {}, { get(target, key, receiver) { if (key === 'prototype') { reads++; if (reads > 1) throw new Error('extra prototype read'); return expected; } return Reflect.get(target, key, receiver); } });
        const instance = Reflect.construct(Constructor, [{ iceServers: [] }], NewTarget);
        const correct = Object.getPrototypeOf(instance) === expected;
        Native.prototype.close.call(instance);
        return { reads, correct };
      }
      const targetBaseline = targetCheck(Native), targetWrapped = targetCheck(Wrapped);
      const staticIdentity = Wrapped.generateCertificate === Native.generateCertificate;
      const certificate = await Wrapped.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256' });
      const staticWorks = certificate instanceof RTCCertificate;
      const counts = { constructions, plainCalls, configReads };
      runtime.stop('local');
      return { installedWithoutConstructing, direct, subclass, errorIdentity, configIdentity, invalidNativeIdentity, targetBaseline, targetWrapped, staticIdentity, staticWorks, counts,
        aliasPresent: typeof nativeAlias === 'function', aliasesInitiallyIdentical, aliasesAfterInstallIdentical, aliasConfigReads, aliasInstance };
    });
    assert.equal(result.installedWithoutConstructing, true);
    for (const value of Object.values(result.direct)) assert.ok(value);
    assert.equal(result.direct.constructionCount, 1);
    for (const key of ['subclass', 'errorIdentity', 'configIdentity', 'invalidNativeIdentity', 'staticIdentity', 'staticWorks']) assert.equal(result[key], true);
    assert.deepEqual(result.targetWrapped, result.targetBaseline); assert.equal(result.targetWrapped.reads, 1);
    assert.deepEqual(result.counts, { constructions: 5, plainCalls: 1, configReads: 1 });
    if (result.aliasPresent) { assert.equal(result.aliasConfigReads, 1); assert.equal(result.aliasInstance, true); }
    return result;
  });

  await check('native methods: exact once, Promise identity, no then reads, brand and datachannel coercion', async page => {
    const result = await page.evaluate(async () => {
      const prototype = RTCPeerConnection.prototype;
      const names = ['createOffer', 'createDataChannel', 'setLocalDescription', 'getStats'];
      const states = {};
      for (const name of names) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        const state = states[name] = { calls: 0, actual: undefined, error: undefined, thenReads: 0 };
        Object.defineProperty(prototype, name, { ...descriptor, value: new Proxy(descriptor.value, { apply(target, receiver, args) {
          state.calls++;
          try { const result = Reflect.apply(target, receiver, args); state.actual = result;
            if (name !== 'createDataChannel') Object.defineProperty(result, 'then', { configurable: true, get() { state.thenReads++; return Promise.prototype.then; } });
            return result;
          } catch (error) { state.error = error; throw error; }
        } }) });
      }
      const runtime = new WebRTCAudit.SensorRuntime(WebRTCAudit.browserEnv(window));
      WebRTCAudit.installWebRTCSensor(runtime, window);
      const pc = new RTCPeerConnection({ iceServers: [] });
      let conversions = 0;
      const channel = pc.createDataChannel({ toString() { conversions++; return 'native-audit-channel'; } });
      const channelIdentity = channel === states.createDataChannel.actual;
      const promises = [];
      for (const [name, args] of [['createOffer', []], ['getStats', []], ['setLocalDescription', [{ type: 'rollback' }]]]) {
        const promise = Reflect.apply(pc[name], pc, args);
        promises.push({ name, same: promise === states[name].actual, thenReadsBeforeAwait: states[name].thenReads });
        try { await promise; } catch { /* page-owned rejection handling, no result/SDP inspection */ }
      }
      const wrongReceiver = {};
      for (const name of names) {
        let pending;
        try { pending = Reflect.apply(prototype[name], {}, name === 'createDataChannel' ? ['invalid'] : []); await pending; wrongReceiver[name] = { rejected: false }; }
        catch (error) { wrongReceiver[name] = { rejected: true, type: error.name,
          sameNativeException: pending === undefined ? error === states[name].error : null,
          sameNativePromise: pending === undefined ? null : pending === states[name].actual }; }
      }
      const calls = Object.fromEntries(names.map(name => [name, states[name].calls]));
      const observerErrors = runtime.snapshot().observerErrors;
      runtime.stop('local'); pc.close();
      return { channelIdentity, conversions, promises, wrongReceiver, calls, observerErrors };
    });
    assert.equal(result.channelIdentity, true); assert.equal(result.conversions, 1); assert.equal(result.observerErrors, 0);
    for (const item of result.promises) { assert.equal(item.same, true); assert.equal(item.thenReadsBeforeAwait, 0); }
    for (const value of Object.values(result.wrongReceiver)) {
      assert.equal(value.rejected, true); assert.equal(value.type, 'TypeError');
      assert.ok(value.sameNativeException === true || value.sameNativePromise === true);
    }
    assert.deepEqual(result.calls, { createOffer: 2, createDataChannel: 2, setLocalDescription: 2, getStats: 2 });
    return result;
  });

  await check('configuration and SDP conversion reads match native; private data absent from wire', async page => {
    const result = await page.evaluate(async () => {
      const Native = RTCPeerConnection;
      const nativeSet = Native.prototype.setLocalDescription;
      const canary = 'rtc-private-sdp-canary';
      async function exercise(Constructor, setter) {
        const reads = [], errors = [];
        const configuration = new Proxy({ iceServers: [] }, { get(target, key, receiver) { reads.push('config:' + String(key)); return Reflect.get(target, key, receiver); } });
        Object.defineProperty(configuration, 'unusedPrivateField', { get() { throw new Error('extra configuration getter'); } });
        const pc = new Constructor(configuration);
        const description = new Proxy({ type: 'invalid-enum', sdp: canary }, { get(target, key, receiver) { reads.push('sdp:' + String(key)); return Reflect.get(target, key, receiver); } });
        try { await Reflect.apply(setter, pc, [description]); } catch (error) { errors.push(error.name); }
        pc.close();
        return { reads, errors };
      }
      const before = await exercise(Native, nativeSet);
      const posted = [], env = WebRTCAudit.browserEnv(window);
      const runtime = new WebRTCAudit.SensorRuntime({ ...env, postMessage: message => posted.push(message) });
      WebRTCAudit.installWebRTCSensor(runtime, window); runtime.start();
      dispatchEvent(new MessageEvent('message', { source: window, data: { channel: 'detect.expert/v1', type: 'bridge-hello', sensorBootId: runtime.sensorBootId, protocolVersion: 1, bridgeSessionId: 'rtc-audit', paused: false } }));
      const after = await exercise(RTCPeerConnection, RTCPeerConnection.prototype.setLocalDescription);
      runtime.flush();
      const wire = JSON.stringify(posted);
      const clean = !wire.includes(canary) && !wire.includes('iceServers') && !wire.includes('unusedPrivateField') && !wire.includes('sdp:');
      const counters = runtime.snapshot().counters;
      runtime.stop('local');
      return { before, after, clean, counters };
    });
    assert.deepEqual(result.after, result.before); assert.equal(result.clean, true); assert.ok(result.counters.length > 0);
    return result;
  });

  await check('page-invoked ICE getters: original once and exact values without extra getters', async page => {
    const result = await page.evaluate(() => {
      const candidateNames = ['candidate', 'sdpMid', 'sdpMLineIndex', 'foundation', 'component', 'priority', 'address', 'protocol', 'port', 'type', 'tcpType', 'relatedAddress', 'relatedPort', 'usernameFragment'];
      const targets = [[RTCPeerConnection.prototype, ['localDescription', 'currentLocalDescription', 'pendingLocalDescription']],
        [RTCIceCandidate.prototype, candidateNames], [RTCPeerConnectionIceEvent.prototype, ['candidate']]];
      const states = [];
      for (let group = 0; group < targets.length; group++) {
        const [prototype, names] = targets[group];
        for (const name of names) {
          const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
          if (!descriptor?.get) continue;
          const state = { group, name, calls: 0, actual: undefined, error: undefined };
          states.push(state);
          Object.defineProperty(prototype, name, { ...descriptor, get: new Proxy(descriptor.get, { apply(target, receiver, args) {
            state.calls++; try { state.actual = Reflect.apply(target, receiver, args); return state.actual; } catch (error) { state.error = error; throw error; }
          } }) });
        }
      }
      const runtime = new WebRTCAudit.SensorRuntime(WebRTCAudit.browserEnv(window));
      WebRTCAudit.installWebRTCSensor(runtime, window);
      const pc = new RTCPeerConnection({ iceServers: [] });
      const candidate = new RTCIceCandidate({ candidate: '', sdpMid: 'private-mid-canary' });
      const event = new RTCPeerConnectionIceEvent('icecandidate', { candidate });
      const receivers = [pc, candidate, event];
      let extraReads = 0;
      const hostile = new Proxy({}, { get() { extraReads++; throw new Error('unexpected page getter'); } });
      const results = states.map(state => {
        const value = receivers[state.group][state.name];
        const same = Object.is(value, state.actual);
        let exactError = false;
        const getter = Object.getOwnPropertyDescriptor(targets[state.group][0], state.name).get;
        try { Reflect.apply(getter, hostile, []); } catch (error) { exactError = error === state.error && error instanceof TypeError; }
        return { api: state.group + ':' + state.name, same, exactError, calls: state.calls };
      });
      const counters = runtime.snapshot().counters;
      const clean = !JSON.stringify(counters).includes('private-mid-canary');
      runtime.stop('local'); pc.close();
      return { results, extraReads, clean, counters };
    });
    assert.equal(result.extraReads, 0); assert.equal(result.clean, true); assert.ok(result.results.length >= 10);
    for (const item of result.results) { assert.equal(item.same, true); assert.equal(item.exactError, true); assert.equal(item.calls, 2); }
    return result;
  });

  await check('pause, idempotent install and owned-only cleanup', async page => {
    const result = await page.evaluate(() => {
      const Native = RTCPeerConnection;
      const oldOffer = Native.prototype.createOffer, oldChannel = Native.prototype.createDataChannel;
      const oldAlias = Object.getOwnPropertyDescriptor(window, 'webkitRTCPeerConnection')?.value;
      const runtime = new WebRTCAudit.SensorRuntime(WebRTCAudit.browserEnv(window));
      WebRTCAudit.installWebRTCSensor(runtime, window);
      const wrapper = RTCPeerConnection, offerWrapper = Native.prototype.createOffer;
      WebRTCAudit.installWebRTCSensor(runtime, window);
      const stable = wrapper === RTCPeerConnection && offerWrapper === Native.prototype.createOffer;
      const pc = new RTCPeerConnection({ iceServers: [] }); pc.createDataChannel('first');
      const count = () => runtime.snapshot().counters.reduce((sum, item) => sum + item.count, 0);
      const beforePause = count(); runtime.pause(); pc.createDataChannel('paused'); const duringPause = count();
      runtime.resume(); pc.createDataChannel('resumed'); const afterResume = count();
      const replacement = function () { return Reflect.apply(offerWrapper, this, arguments); };
      Native.prototype.createOffer = replacement;
      const cleanup = runtime.stop('local');
      const restored = RTCPeerConnection === Native && Native.prototype.createDataChannel === oldChannel &&
        (oldAlias === undefined || window.webkitRTCPeerConnection === oldAlias);
      const foreignKept = Native.prototype.createOffer === replacement;
      Native.prototype.createOffer = oldOffer; pc.close();
      return { stable, beforePause, duringPause, afterResume, restored, foreignKept, cleanup };
    });
    assert.equal(result.stable, true); assert.equal(result.beforePause, result.duringPause);
    assert.equal(result.afterResume, result.duringPause + 1); assert.equal(result.restored, true); assert.equal(result.foreignKept, true);
    return result;
  });

  for (const wrapped of [false, true]) await check('native unhandledrejection unchanged, wrapped=' + wrapped, async page => {
    const result = await page.evaluate(async wrapped => {
      let runtime;
      if (wrapped) { runtime = new WebRTCAudit.SensorRuntime(WebRTCAudit.browserEnv(window)); WebRTCAudit.installWebRTCSensor(runtime, window); }
      let rejected;
      const events = [];
      addEventListener('unhandledrejection', event => { events.push({ samePromise: event.promise === rejected, type: event.reason.name }); event.preventDefault(); });
      const pc = new RTCPeerConnection({ iceServers: [] }); pc.close();
      rejected = pc.createOffer();
      await new Promise(resolve => setTimeout(resolve, 150));
      runtime?.stop('local');
      return { events };
    }, wrapped);
    assert.deepEqual(result.events, [{ samePromise: true, type: 'InvalidStateError' }]);
    return result;
  });

  await check('ordinary datachannel and information reads remain api-use/unassessed', async page => {
    const result = await page.evaluate(async () => {
      const runtime = new WebRTCAudit.SensorRuntime(WebRTCAudit.browserEnv(window));
      WebRTCAudit.installWebRTCSensor(runtime, window);
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('ordinary-collaboration'); await pc.createOffer(); await pc.getStats();
      void pc.localDescription;
      pc.close();
      const counters = runtime.snapshot().counters;
      const raw = { schemaVersion: 1, documentKey: '1:0:rtc-fixture', tabId: 1, frameId: 0, documentId: 'rtc-fixture', host: null,
        lifecycle: 'committed', coverageState: 'active', coverageFlags: [], observedSince: 1000, revision: 1, createdAt: 1000, updatedAt: 1000,
        counters: counters.map(item => ({ techniqueId: item.techniqueId, phase: item.phase, signalCodes: item.signalCodes, count: item.count, countQuality: item.countQuality, firstBucket: 0, lastBucket: 0 })),
        hosts: [], findings: [], dropped: { batches: 0, observations: 0, counters: 0, findings: 0, hosts: 0, transport: 0 }, watermark: null };
      const interpreted = WebRTCAudit.interpretReport(raw, { scopeMode: 'site', accessGranted: true, restricted: false, paused: false, inaccessibleFrames: 0 });
      const projection = WebRTCAudit.projectReport(interpreted.report, { scopeMode: 'site' });
      runtime.stop('local');
      return { counters, findings: projection.findings, techniques: projection.techniques };
    });
    for (const item of result.findings) { assert.equal(item.interpretation, 'api-use'); assert.equal(item.interpretationConfidence, 'unassessed'); }
    assert.deepEqual(result.techniques.map(item => item.techniqueId).sort(), ['DET-056', 'DET-057']);
    for (const item of result.techniques) { assert.equal(item.interpretation, 'api-use'); assert.equal(item.interpretationConfidence, 'unassessed'); }
    return result;
  });
  evidence.complete = true;
} finally {
  writeFileSync('test-results/prod/reports/webrtc-native-acceptance.json', JSON.stringify(evidence, null, 2) + '\n');
  await browser.close(); await fixture.close();
}
