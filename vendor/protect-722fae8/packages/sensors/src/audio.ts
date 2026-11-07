// Web Audio sensor: DET-015 (offline audio graph: oscillator, compressor, offline rendering) and DET-016 (audio data
// readout). Task E08-01, S05; spec III §2.2 rows DET-015/016; REQ-001, REQ-002, REQ-003, REQ-005; ADR-006, ADR-017.
//
// Observed: which operation the page called (operation code), its phase and whether it ran on an OfflineAudioContext
// (signal `offline-render`). Never read or recorded: samples, buffers, hashes, frequencies, oscillator type,
// compressor parameters, buffer length, sampleRate, channel numbers or any other argument.
//
// Constructors are not wrapped (FOLLOWUPS item 10): nodes created with `new OscillatorNode(...)` etc. are seen only
// through the methods below. Hooks:
//   - OfflineAudioContext.prototype.startRendering -> `start-rendering`, phase settlement-unobserved, offline-render.
//     The original Promise is returned as is: no .then/.catch, settlement is not observed.
//   - BaseAudioContext.prototype.createOscillator / createDynamicsCompressor -> their code, returned-sync or
//     threw-sync; offline-render when the receiver passes the brand check of the captured native
//     OfflineAudioContext.prototype.length getter.
//   - AudioNode.prototype.connect -> `connect-osc-compressor` only for a successful call whose receiver passes the
//     OscillatorNode.prototype.frequency brand check and whose first argument passes the
//     DynamicsCompressorNode.prototype.threshold brand check; offline-render when the receiver's context (captured
//     native AudioNode.prototype.context getter) passes the OfflineAudioContext.length brand check. Every other
//     connect call is not recorded at all.
//   - AudioBuffer.prototype.getChannelData / copyFromChannel, AnalyserNode.prototype.get{Float,Byte}{Frequency,
//     TimeDomain}Data -> DET-016 fixed codes; arguments and returned arrays are never touched.
// The supplemental getters (length, frequency, threshold, context) are captured only with earlyCaptureGuaranteed
// (ADR-017 §2): a late install takes none of them, does not wrap connect, records no offline-render and adds the
// idempotent `hook-failed` flag (the observation is knowingly incomplete). Brand checks call only those captured
// native getters (realm.ts); no family wraps them (install-disjoint.test.ts). Keys are computed at install.

import type { OperationCode, Phase, TechniqueId } from '@detect-expert/contracts';
import { API_USE, compositeKey, operationIndex, PHASE_INDEX, signalBit, TECHNIQUE_INDEX } from './codes';
import { arrayPush } from './intrinsics';
import { brandCheck, getterOf, prototypeOf, readObject } from './realm';
import type { SensorRuntime } from './runtime';
import { wrapMethod } from './wrap';
import type { MethodObserver, WrapResult } from './wrap';

const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

const T_GRAPH: TechniqueId = 'DET-015';
const T_READOUT: TechniqueId = 'DET-016';

const OFFLINE_CONTEXT = 'OfflineAudioContext';
const BASE_CONTEXT = 'BaseAudioContext';
const AUDIO_NODE = 'AudioNode';
const OSCILLATOR = 'OscillatorNode';
const COMPRESSOR = 'DynamicsCompressorNode';
const AUDIO_BUFFER = 'AudioBuffer';
const ANALYSER = 'AnalyserNode';

export interface AudioSensor {
  /** One entry per attempted hook (installed or unsupported), in install order. */
  results: WrapResult[];
  /** Interfaces absent from the realm, or `Interface.member` that is not an own property (not a failure). */
  skipped: string[];
  /** True when the frequency and threshold getters were captured (early capture), i.e. connect is observed. */
  linkage: boolean;
}

interface KeyPair {
  readonly ok: number;
  readonly threw: number;
}

/**
 * Installs the Web Audio hooks on `realm` (the window) and registers them with the runtime. Repeated calls in the
 * same module instance return the same handles (wrap.ts registry) and add no observer.
 */
export function installAudioSensor(runtime: SensorRuntime, realm: object = globalThis): AudioSensor {
  const results: WrapResult[] = [];
  const skipped: string[] = [];
  const options = { context: runtime.hooks };

  // Keys (install time; an undeclared pair throws here and the registry isolates it as hook-failed).
  const S_OFFLINE = signalBit(T_GRAPH, 'offline-render');
  const key = (technique: TechniqueId, phase: Phase, op: OperationCode, mask: number): number =>
    compositeKey(TECHNIQUE_INDEX[technique], PHASE_INDEX[phase], mask, operationIndex(technique, op));
  const pair = (technique: TechniqueId, op: OperationCode, okPhase: Phase, mask: number): KeyPair => ({
    ok: key(technique, okPhase, op, mask),
    threw: key(technique, 'threw-sync', op, mask),
  });
  const OFFLINE = API_USE | S_OFFLINE;
  const K = {
    render: pair(T_GRAPH, 'start-rendering', 'settlement-unobserved', OFFLINE),
    oscillator: pair(T_GRAPH, 'create-oscillator', 'returned-sync', API_USE),
    oscillatorOffline: pair(T_GRAPH, 'create-oscillator', 'returned-sync', OFFLINE),
    compressor: pair(T_GRAPH, 'create-dynamics-compressor', 'returned-sync', API_USE),
    compressorOffline: pair(T_GRAPH, 'create-dynamics-compressor', 'returned-sync', OFFLINE),
    link: key(T_GRAPH, 'returned-sync', 'connect-osc-compressor', API_USE),
    linkOffline: key(T_GRAPH, 'returned-sync', 'connect-osc-compressor', OFFLINE),
    channelData: pair(T_READOUT, 'get-channel-data', 'returned-sync', API_USE),
    copyFromChannel: pair(T_READOUT, 'copy-from-channel', 'returned-sync', API_USE),
    floatFrequency: pair(T_READOUT, 'analyser-float-frequency', 'returned-sync', API_USE),
    byteFrequency: pair(T_READOUT, 'analyser-byte-frequency', 'returned-sync', API_USE),
    floatTimeDomain: pair(T_READOUT, 'analyser-float-time-domain', 'returned-sync', API_USE),
    byteTimeDomain: pair(T_READOUT, 'analyser-byte-time-domain', 'returned-sync', API_USE),
  };

  const offlineProto = prototypeOf(realm, OFFLINE_CONTEXT);
  const nodeProto = prototypeOf(realm, AUDIO_NODE);
  const early = runtime.earlyCaptureGuaranteed;
  // Supplemental native getters: early capture only (a late realm may already carry page replacements).
  const offlineLength = early ? getterOf(offlineProto, 'length') : null;
  const frequency = early ? getterOf(prototypeOf(realm, OSCILLATOR), 'frequency') : null;
  const threshold = early ? getterOf(prototypeOf(realm, COMPRESSOR), 'threshold') : null;
  const nodeContext = early ? getterOf(nodeProto, 'context') : null;
  const linkage = frequency !== null && threshold !== null;
  if (!early && (offlineProto !== null || nodeProto !== null)) runtime.addFlag('hook-failed');

  const fixed = (keys: KeyPair): MethodObserver => {
    return (_thisArg, _args, threw) => {
      runtime.recordKey(threw ? keys.threw : keys.ok);
    };
  };

  /** createOscillator / createDynamicsCompressor: offline-render only through the captured brand check. */
  const factory = (plain: KeyPair, offline: KeyPair): MethodObserver => {
    return (thisArg, _args, threw) => {
      const keys = brandCheck(offlineLength, thisArg) ? offline : plain;
      runtime.recordKey(threw ? keys.threw : keys.ok);
    };
  };

  // Only oscillator -> compressor links are recorded; args[0] is read only when the call passed one (an index read
  // of the wrapper's own arguments object), never through the prototype chain.
  const connect: MethodObserver = (thisArg, args, threw) => {
    if (threw || args.length === 0) return;
    if (!brandCheck(frequency, thisArg)) return;
    if (!brandCheck(threshold, args[0])) return;
    const context = readObject(nodeContext, thisArg);
    runtime.recordKey(context !== null && brandCheck(offlineLength, context) ? K.linkOffline : K.link);
  };

  const add = (proto: object | null, name: string, member: string, observe: MethodObserver): void => {
    if (proto === null) return;
    if (getOwnPropertyDescriptor(proto, member) === undefined) {
      arrayPush(skipped, name + '.' + member);
      return;
    }
    arrayPush(results, wrapMethod(proto, member, observe, options));
  };
  const lookup = (name: string): object | null => {
    const proto = prototypeOf(realm, name);
    if (proto === null) arrayPush(skipped, name);
    return proto;
  };

  try {
    if (offlineProto === null) arrayPush(skipped, OFFLINE_CONTEXT);
    add(offlineProto, OFFLINE_CONTEXT, 'startRendering', fixed(K.render));
    const baseProto = lookup(BASE_CONTEXT);
    add(baseProto, BASE_CONTEXT, 'createOscillator', factory(K.oscillator, K.oscillatorOffline));
    add(baseProto, BASE_CONTEXT, 'createDynamicsCompressor', factory(K.compressor, K.compressorOffline));
    if (nodeProto === null) arrayPush(skipped, AUDIO_NODE);
    // Without the linkage getters no connect call could ever be recorded: the hook is not installed at all.
    if (linkage) add(nodeProto, AUDIO_NODE, 'connect', connect);
    const bufferProto = lookup(AUDIO_BUFFER);
    add(bufferProto, AUDIO_BUFFER, 'getChannelData', fixed(K.channelData));
    add(bufferProto, AUDIO_BUFFER, 'copyFromChannel', fixed(K.copyFromChannel));
    const analyserProto = lookup(ANALYSER);
    add(analyserProto, ANALYSER, 'getFloatFrequencyData', fixed(K.floatFrequency));
    add(analyserProto, ANALYSER, 'getByteFrequencyData', fixed(K.byteFrequency));
    add(analyserProto, ANALYSER, 'getFloatTimeDomainData', fixed(K.floatTimeDomain));
    add(analyserProto, ANALYSER, 'getByteTimeDomainData', fixed(K.byteTimeDomain));
  } finally {
    // A throwing realm lookup must not strand installed hooks outside ownership-checked cleanup (ADR-006 §8).
    runtime.attach(results);
  }
  return { results, skipped, linkage };
}
