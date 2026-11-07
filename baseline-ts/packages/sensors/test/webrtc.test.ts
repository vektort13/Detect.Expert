// DET-056/057, REQ-001/002/005/011, ADR-006: passive API use, privacy and lifecycle regressions.
import { describe, expect, it, vi } from 'vitest';
import { SensorRuntime } from '../src/runtime';
import { installWebRTCSensor } from '../src/webrtc';
import { bridgeHello, deliver, makeEnv } from './helpers';

const METHODS = ['createOffer', 'createDataChannel', 'setLocalDescription', 'getStats'] as const;
const CANDIDATE_PROPERTIES = ['candidate', 'sdpMid', 'sdpMLineIndex', 'foundation', 'component', 'priority',
  'address', 'protocol', 'port', 'type', 'tcpType', 'relatedAddress', 'relatedPort', 'usernameFragment'] as const;
const PRIVATE = 'PRIVATE_SDP_IP_STUN_CREDENTIAL_CHANNEL_537f';

function setup() {
  const env = makeEnv();
  const runtime = new SensorRuntime(env.env);
  runtime.start(); deliver(env, bridgeHello(runtime));
  const calls: Array<{ method: string; receiver: unknown; args: unknown[] }> = [];
  let result: unknown = {};
  let failure: unknown;
  let fails = false;
  const record = (method: string, receiver: unknown, args: unknown[]): unknown => {
    calls.push({ method, receiver, args });
    if (fails) throw failure;
    return result;
  };
  class PeerConnection {
    static marker = {};
    constructor(...args: unknown[]) { record('constructor', this, args); }
    createOffer(...args: unknown[]) { return record('createOffer', this, args); }
    createDataChannel(...args: unknown[]) { return record('createDataChannel', this, args); }
    setLocalDescription(...args: unknown[]) { return record('setLocalDescription', this, args); }
    getStats(...args: unknown[]) { return record('getStats', this, args); }
    get localDescription() { return record('localDescription', this, []); }
    get currentLocalDescription() { return record('currentLocalDescription', this, []); }
    get pendingLocalDescription() { return record('pendingLocalDescription', this, []); }
    addEventListener(...args: unknown[]) { return record('addEventListener', this, args); }
    close() { return record('close', this, []); }
  }
  class IceEvent { get candidate() { return record('event.candidate', this, []); } }
  class Candidate {}
  for (const key of CANDIDATE_PROPERTIES) Object.defineProperty(Candidate.prototype, key, {
    configurable: true, enumerable: true, get() { return record('candidate.' + key, this, []); },
  });
  const realm = { RTCPeerConnection: PeerConnection, webkitRTCPeerConnection: PeerConnection,
    RTCPeerConnectionIceEvent: IceEvent, RTCIceCandidate: Candidate };
  return { env, runtime, calls, realm, PeerConnection, IceEvent, Candidate,
    returns(value: unknown) { result = value; fails = false; },
    throws(value: unknown) { failure = value; fails = true; },
    install: () => installWebRTCSensor(runtime, realm) };
}

function count(f: ReturnType<typeof setup>, id: string): number {
  return f.runtime.snapshot().counters.filter((entry) => entry.techniqueId === id).reduce((sum, entry) => sum + entry.count, 0);
}

describe('passive WebRTC sensor', () => {
  it.each(['localDescription', 'currentLocalDescription', 'pendingLocalDescription', 'remoteDescription', 'currentRemoteDescription', 'pendingRemoteDescription'])(
    '%s never previews raw strings from a page-replaced getter', member => {
      const state = setup();
      const read = vi.fn(() => 'v=0\na=ice-pwd:PRIVATE_DESCRIPTION_CANARY');
      Object.defineProperty(state.PeerConnection.prototype, member, { configurable: true, get: read });
      state.install();
      const receiver = new state.realm.RTCPeerConnection();
      expect(Reflect.get(receiver, member)).toBe('v=0\na=ice-pwd:PRIVATE_DESCRIPTION_CANARY');
      expect(read).toHaveBeenCalledTimes(1);
      const snapshot = state.runtime.apiResults.snapshot();
      expect(snapshot.rows.find(row => row.operation === 'RTCPeerConnection.' + member)?.value).toEqual({ kind: 'unobserved', reason: 'unsupported' });
      expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_DESCRIPTION_CANARY');
    });

  it('does not consult inherited descriptor values for accessor-replaced methods', () => {
    const state = setup();
    const read = vi.fn(() => undefined);
    Object.defineProperty(state.PeerConnection.prototype, 'getConfiguration', { configurable: true, get: read });
    const inherited = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
    try {
      Object.defineProperty(Object.prototype, 'value', { configurable: true, get: read });
      state.install();
    } finally {
      if (inherited) Object.defineProperty(Object.prototype, 'value', inherited); else Reflect.deleteProperty(Object.prototype, 'value');
    }
    expect(read).not.toHaveBeenCalled();
    expect(state.calls).toEqual([]);
  });
  it.each(['RTCRtpSender', 'RTCRtpReceiver'] as const)('%s static capabilities preserve identity without connection or codec inspection', name => {
    const state = setup();
    let reads = 0;
    const opaque = new Proxy({}, { get() { reads++; throw new Error('codec or input read'); },
      ownKeys() { reads++; throw new Error('codec enumeration'); } });
    const native = vi.fn(function (this: unknown, ...args: unknown[]) {
      state.calls.push({ method: 'capabilities', receiver: this, args }); return opaque;
    });
    class Endpoint { static getCapabilities = native; }
    installWebRTCSensor(state.runtime, { ...state.realm, [name]: Endpoint });
    expect(state.calls).toEqual([]);
    expect(Reflect.apply(Endpoint.getCapabilities, opaque, [opaque]) === opaque).toBe(true);
    expect(native).toHaveBeenCalledTimes(1);
    expect(state.calls[0]!.receiver === opaque).toBe(true);
    expect(state.calls[0]!.args[0] === opaque).toBe(true);
    expect(reads).toBe(0);
    expect(count(state, 'DET-020')).toBe(1);
    expect(count(state, 'DET-056')).toBe(0);
    expect(count(state, 'DET-057')).toBe(0);
    expect(state.runtime.snapshot().counters).toEqual([expect.objectContaining({ techniqueId: 'DET-020', signalCodes: ['api-use'], phase: 'returned-sync' })]);
    state.runtime.stop('local');
    expect(Endpoint.getCapabilities).toBe(native);
  });

  it('installs bounded hooks without creating connections, inspecting candidates or adding listeners', () => {
    const f = setup();
    const listeners = f.env.listenerCount('message');
    const installed = f.install();
    expect(installed.results).toHaveLength(25);
    expect(installed.results.every((entry) => entry.status === 'installed')).toBe(true);
    expect(f.calls).toEqual([]);
    expect(f.runtime.snapshot().counters).toEqual([]);
    expect(f.env.listenerCount('message')).toBe(listeners);
    // Constructing an ICE event/candidate does not claim that the page read or sent candidate data.
    new f.realm.RTCIceCandidate(); new f.realm.RTCPeerConnectionIceEvent();
    expect(f.runtime.snapshot().counters).toEqual([]);
  });

  it('reports ordinary connection and information calls only as aggregate api-use facts', () => {
    const f = setup(); f.install();
    const pc = new f.realm.RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('ordinary app'); pc.createOffer(); pc.setLocalDescription(); pc.getStats();
    void pc.localDescription; void new f.IceEvent().candidate;
    Reflect.get(new f.Candidate(), 'candidate');
    expect(f.runtime.snapshot().counters).toEqual(expect.arrayContaining([
      expect.objectContaining({ techniqueId: 'DET-056', apiOperation: 'RTCPeerConnection', phase: 'returned-sync', count: 1, signalCodes: ['api-use'] }),
      expect.objectContaining({ techniqueId: 'DET-056', apiOperation: 'RTCPeerConnection.createOffer', phase: 'settlement-unobserved', count: 1, signalCodes: ['api-use'] }),
      expect.objectContaining({ techniqueId: 'DET-057', apiOperation: 'RTCPeerConnection.localDescription', phase: 'returned-sync', count: 1, signalCodes: ['api-use'] }),
      expect.objectContaining({ techniqueId: 'DET-057', phase: 'returned-sync', count: 2, signalCodes: ['api-use'] }),
      expect.objectContaining({ techniqueId: 'DET-057', phase: 'settlement-unobserved', count: 1, signalCodes: ['api-use'] }),
    ]));
    expect(f.runtime.snapshot().counters).toHaveLength(7);
    expect(f.calls.some((entry) => entry.method === 'addEventListener')).toBe(false);
  });

  it('supports the legacy alias without duplicate method counts; construction and subclass identity survive', () => {
    const f = setup(); const original = f.PeerConnection;
    const handles = f.install();
    expect(f.install().results).toEqual(handles.results);
    const first = new f.realm.RTCPeerConnection(PRIVATE, 2);
    const second = new f.realm.webkitRTCPeerConnection(PRIVATE, 3);
    class Sub extends f.realm.RTCPeerConnection {}
    const sub = new Sub(PRIVATE, 4);
    expect(first).toBeInstanceOf(original); expect(second).toBeInstanceOf(original); expect(sub).toBeInstanceOf(Sub);
    expect(first.constructor).toBe(original); // Known detectable shared native prototype.constructor (ADR-006).
    expect(f.realm.RTCPeerConnection.marker).toBe(original.marker);
    expect(f.calls.map((entry) => entry.args)).toEqual([[PRIVATE, 2], [PRIVATE, 3], [PRIVATE, 4]]);
    expect(count(f, 'DET-056')).toBe(3);
    first.createDataChannel('one'); second.createDataChannel('two');
    expect(count(f, 'DET-056')).toBe(5);
    expect(f.calls.filter((entry) => entry.method === 'createDataChannel')).toHaveLength(2);
  });

  it.each(METHODS)('%s preserves original receiver, every argument, callback and returned identity without inspection', (method) => {
    const f = setup();
    let reads = 0;
    const hostile = new Proxy({}, { get() { reads++; throw new Error('private get'); }, ownKeys() { reads++; return []; } });
    const callback = () => undefined;
    const args = [hostile, callback, undefined, PRIVATE, 17];
    f.returns(hostile); f.install();
    const actual = Reflect.apply(f.PeerConnection.prototype[method], hostile, args);
    expect(actual === hostile).toBe(true);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.receiver === hostile).toBe(true);
    expect(f.calls[0]!.args[0] === hostile).toBe(true);
    expect(f.calls[0]!.args.slice(1)).toEqual(args.slice(1));
    expect(reads).toBe(0);
    expect(f.runtime.snapshot().observerErrors).toBe(0);
  });

  it.each(METHODS)('%s propagates the same synchronous exception, including a falsy thrown value', (method) => {
    const f = setup(); f.install();
    for (const failure of [undefined, 0, new TypeError(PRIVATE)]) {
      f.throws(failure);
      let caught = false;
      try { Reflect.apply(f.PeerConnection.prototype[method], {}, [PRIVATE]); }
      catch (error) { caught = true; expect(error).toBe(failure); }
      expect(caught).toBe(true);
    }
    expect(f.calls).toHaveLength(3);
    expect(f.runtime.snapshot().counters).toEqual([expect.objectContaining({
      techniqueId: method === 'getStats' ? 'DET-057' : 'DET-056', phase: 'threw-sync', count: 3, signalCodes: ['api-use'],
    })]);
  });

  it('forwards native configuration coercion once, without constructor-side inspection', () => {
    const f = setup();
    let reads = 0;
    const config = { get iceServers() { reads++; return []; } };
    class Configured {
      constructor(options: typeof config) { void options.iceServers; }
    }
    const realm = { RTCPeerConnection: Configured };
    installWebRTCSensor(f.runtime, realm);
    new realm.RTCPeerConnection(config);
    expect(reads).toBe(1);
    expect(count(f, 'DET-056')).toBe(1);
  });

  it('never reads then/catch or adds Promise handlers to offer, localDescription or stats', () => {
    const f = setup(); f.install();
    const promise = Promise.resolve(PRIVATE);
    let reads = 0;
    for (const key of ['then', 'catch']) Object.defineProperty(promise, key, { get() { reads++; throw new Error('handler attached'); } });
    f.returns(promise);
    const receiver = new f.realm.RTCPeerConnection();
    expect(receiver.createOffer()).toBe(promise);
    expect(receiver.setLocalDescription()).toBe(promise);
    expect(receiver.getStats()).toBe(promise);
    expect(reads).toBe(0);
    expect(f.runtime.snapshot().counters.filter((entry) => entry.phase === 'settlement-unobserved').reduce((sum, entry) => sum + entry.count, 0)).toBe(3);
  });

  it.each(CANDIDATE_PROPERTIES)('candidate.%s records only an actual getter call and preserves the private result/exception', (key) => {
    const f = setup(); f.install();
    const candidate = new f.Candidate();
    expect(count(f, 'DET-057')).toBe(0);
    const privateResult = { sensitive: PRIVATE };
    f.returns(privateResult);
    expect(Reflect.get(candidate, key)).toBe(privateResult);
    const error = new Error(PRIVATE); f.throws(error);
    let caught: unknown;
    try { Reflect.get(candidate, key); } catch (failure) { caught = failure; }
    expect(caught).toBe(error);
    expect(f.calls).toHaveLength(2);
    expect(f.calls.every((entry) => entry.receiver === candidate && entry.args.length === 0)).toBe(true);
    expect(count(f, 'DET-057')).toBe(2);
    expect(JSON.stringify(f.runtime.snapshot())).not.toContain(PRIVATE);
  });

  it('emits only canonical metadata: no SDP, IP, credentials, channel label, candidate values or stats', () => {
    const f = setup(); f.install(); f.returns(PRIVATE);
    const pc = new f.realm.RTCPeerConnection({ iceServers: [{ urls: PRIVATE, username: PRIVATE, credential: PRIVATE }] });
    pc.createOffer({ PRIVATE }); pc.createDataChannel(PRIVATE); pc.setLocalDescription({ sdp: PRIVATE }); pc.getStats();
    void pc.localDescription; Reflect.get(new f.Candidate(), 'address'); void new f.IceEvent().candidate;
    f.env.advance(500);
    const messages = f.env.messages(); // Validates every actual MAIN payload with the canonical validator.
    expect(f.env.batches().length).toBeGreaterThan(0);
    expect(JSON.stringify(messages)).not.toContain(PRIVATE);
    expect(f.runtime.snapshot().counters.every((entry) => entry.signalCodes.join() === 'api-use')).toBe(true);
  });

  it('pauses observation and prevents paused installation; owned cleanup restores constructors and methods', () => {
    const f = setup();
    const original = f.realm.RTCPeerConnection;
    const offer = original.prototype.createOffer;
    f.runtime.pause(); expect(f.install().results).toEqual([]);
    f.runtime.resume(); f.install();
    const pc = new f.realm.RTCPeerConnection(); pc.createOffer();
    expect(count(f, 'DET-056')).toBe(2);
    f.runtime.pause(); pc.createDataChannel(PRIVATE); void pc.localDescription;
    new f.realm.RTCPeerConnection();
    expect(count(f, 'DET-056')).toBe(2); expect(count(f, 'DET-057')).toBe(0);
    f.runtime.resume(); pc.createDataChannel(PRIVATE);
    expect(count(f, 'DET-056')).toBe(3);
    expect(f.runtime.stop('local').cleanup).toBe('complete');
    expect(f.realm.RTCPeerConnection).toBe(original);
    expect(f.realm.webkitRTCPeerConnection).toBe(original);
    expect(original.prototype.createOffer).toBe(offer);
    expect(f.install().results).toEqual([]);
  });

  it('leaves a foreign replacement in place during stop', () => {
    const f = setup(); f.install();
    const ours = f.PeerConnection.prototype.createOffer;
    const foreign = function (this: unknown, ...args: unknown[]) { return Reflect.apply(ours, this, args); };
    f.PeerConnection.prototype.createOffer = foreign;
    expect(f.runtime.stop('local').cleanup).toBe('partial');
    expect(f.PeerConnection.prototype.createOffer).toBe(foreign);
  });

  it('does not invoke constructor accessors; missing/frozen methods report limitations while available hooks work', () => {
    const f = setup();
    let reads = 0;
    const accessorRealm = { get RTCPeerConnection() { reads++; return f.PeerConnection; } };
    expect(installWebRTCSensor(f.runtime, accessorRealm).results).toEqual([]);
    expect(reads).toBe(0);
    Object.defineProperty(f.PeerConnection.prototype, 'createOffer', { configurable: false });
    const sensor = f.install();
    expect(sensor.results.some((entry) => entry.status === 'unsupported' && entry.reason === 'non-configurable')).toBe(true);
    expect(f.runtime.snapshot().flags).toContain('descriptor-nonconfigurable');
    new f.realm.RTCPeerConnection().createDataChannel(PRIVATE);
    expect(count(f, 'DET-056')).toBe(2);
  });

  it('isolates observer failure from native results and errors', () => {
    const f = setup(); f.install();
    const spy = vi.spyOn(f.runtime, 'record').mockImplementation(() => { throw new Error('observer failure'); });
    const result = {}; f.returns(result);
    expect(Reflect.apply(f.PeerConnection.prototype.createOffer, {}, [])).toBe(result);
    f.throws(undefined);
    let caught = false;
    try { Reflect.apply(f.PeerConnection.prototype.getStats, {}, []); } catch (error) { caught = true; expect(error).toBeUndefined(); }
    expect(caught).toBe(true);
    expect(f.runtime.snapshot().observerErrors).toBe(2);
    spy.mockRestore();
  });
});
