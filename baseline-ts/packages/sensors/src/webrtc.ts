// DET-056/057 / REQ-001/002/004/005 / ADR-006: passive WebRTC API facts, never an IP-leak verdict.
// ADR-020 adds native ICE URL/state listeners and current-configuration snapshots for local details.
// No PeerConnection creation, SDP/peer-address parsing, active probes, or Promise handlers.
import { API_OPERATION_INDEX, PHASE_INDEX, SIGNAL_BIT, TECHNIQUE_INDEX } from './codes';
import { API_OPERATION_DEFINITIONS } from '@detect-expert/contracts';
import type { ApiOperation } from '@detect-expert/contracts';
import { arrayPush, weakSetAdd, weakSetHas } from './intrinsics';
import type { SensorRuntime } from './runtime';
import { wrapConstructor, wrapGetter, wrapMethod, wrapResultMethod } from './wrap';
import { installRtcCapture } from './rtc-details';
import { installRtcValueCapture, nativeRtcFunction } from './rtc-values';
import type { ConstructorObserver, GetterObserver, WrapResult } from './wrap';

const descriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (object: object, key: string) => boolean;
const WeakSetCtor = WeakSet;
const T_INFORMATION = TECHNIQUE_INDEX['DET-057'];
const P_RETURNED = PHASE_INDEX['returned-sync'];
const P_THREW = PHASE_INDEX['threw-sync'];
const P_UNSETTLED = PHASE_INDEX['settlement-unobserved'];
const S_API = SIGNAL_BIT['api-use'];
const CONNECTION_NAMES = ['RTCPeerConnection', 'webkitRTCPeerConnection'] as const;
const CONSTRUCTOR_OPERATION = API_OPERATION_INDEX[CONNECTION_NAMES[0]];
const RTC_OPERATIONS = API_OPERATION_DEFINITIONS.filter(definition => definition[2] === 'webrtc' && definition[3] !== 'construct');
const CANDIDATE_GETTERS = ['candidate', 'sdpMid', 'sdpMLineIndex', 'foundation', 'component', 'priority',
  'address', 'protocol', 'port', 'type', 'tcpType', 'relatedAddress', 'relatedPort', 'usernameFragment'] as const;

export interface WebRTCSensor {
  results: WrapResult[];
  /** Missing optional interfaces/properties; no claim of observation for these entries. */
  skipped: string[];
}

/** Descriptor-only installation never invokes a realm's constructor getter. */
function prototypeOf(realm: object, name: string): object | null {
  const constructor = descriptor(realm, name);
  if (!constructor || !hasOwn(constructor, 'value') || typeof constructor.value !== 'function') return null;
  const prototype = descriptor(constructor.value, 'prototype');
  return prototype && hasOwn(prototype, 'value') && typeof prototype.value === 'object' && prototype.value !== null
    ? prototype.value as object : null;
}

export function installWebRTCSensor(runtime: SensorRuntime, realm: object = globalThis): WebRTCSensor {
  const results: WrapResult[] = [];
  const skipped: string[] = [];
  if (!runtime.hooks.enabled) return { results, skipped };
  const options = { context: runtime.hooks };
  const seenPrototypes = new WeakSetCtor<object>();
  const values = installRtcValueCapture(runtime);
  const details = installRtcCapture(runtime, values?.configuration);
  const constructed: ConstructorObserver = (_args, _newTarget, threw, _error, result) => {
    runtime.recordOperation(CONSTRUCTOR_OPERATION, threw ? P_THREW : P_RETURNED);
    runtime.recordResult('RTCPeerConnection', threw ? P_THREW : P_RETURNED, result);
    if (!threw) details?.seen(result, true);
  };
  const information: GetterObserver = (_receiver, threw) => runtime.record(T_INFORMATION, threw ? P_THREW : P_RETURNED, S_API);
  for (const name of ['RTCRtpSender', 'RTCRtpReceiver'] as const) {
    try {
      const field = descriptor(realm, name);
      if (!field || !hasOwn(field, 'value') || typeof field.value !== 'function' || !descriptor(field.value, 'getCapabilities')) {
        arrayPush(skipped, name + '.getCapabilities'); continue;
      }
      const operation = name === 'RTCRtpSender' ? 'RTCRtpSender.getCapabilities' : 'RTCRtpReceiver.getCapabilities';
      const saved = descriptor(field.value, 'getCapabilities');
      const returnedNative = !!saved && hasOwn(saved, 'value') && nativeRtcFunction(saved.value);
      const result = wrapResultMethod(field.value, 'getCapabilities', (threw, value) => {
        const phase = threw ? P_THREW : P_RETURNED;
        runtime.recordOperation(API_OPERATION_INDEX[operation], phase);
        if (threw || !returnedNative || !values?.returned(operation, value)) runtime.recordResult(operation, phase, value);
      }, options);
      arrayPush(results, result); runtime.attach([result]);
    } catch { runtime.addFlag('hook-failed'); }
  }

  const getters = (prototype: object, interfaceName: string, keys: readonly string[]): void => {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      try {
        if (descriptor(prototype, key) === undefined) arrayPush(skipped, interfaceName + '.' + key);
        else arrayPush(results, wrapGetter(prototype, key, information, options));
      } catch { runtime.addFlag('hook-failed'); }
    }
  };
  const operationHook = (target: object, member: string, operation: ApiOperation, kind: 'get' | 'call' | 'async-call'): void => {
    const saved = descriptor(target, member);
    if (!saved) { arrayPush(skipped, operation); return; }
    const original = hasOwn(saved, kind === 'get' ? 'get' : 'value') ? kind === 'get' ? saved.get : saved.value : undefined;
    const returnedNative = nativeRtcFunction(original);
    const storage = operation === 'IDBObjectStore.put' || operation === 'IDBObjectStore.add' || operation === 'IDBRequest.result';
    const connection = operation.startsWith('RTCPeerConnection.');
    const observe = (receiver: unknown, args: ArrayLike<unknown>, threw: boolean, result: unknown): void => {
      const phase = threw ? P_THREW : kind === 'async-call' ? P_UNSETTLED : P_RETURNED;
      if (storage) {
        if (returnedNative && values?.stored(operation, operation === 'IDBRequest.result' ? result : args.length > 0 ? args[0] : undefined, threw))
          runtime.recordOperation(API_OPERATION_INDEX[operation], phase);
        return;
      }
      runtime.recordOperation(API_OPERATION_INDEX[operation], phase);
      if (threw || kind === 'async-call' || !returnedNative || !values?.returned(operation, result)) runtime.recordResult(operation, phase, result);
      if (!threw && connection) {
        if (member === 'close') details?.closed(receiver);
        else if (member === 'setConfiguration') details?.configured(receiver);
        else if (member === 'getConfiguration' && returnedNative) details?.seen(receiver, false, result, original);
        else if (kind !== 'get') details?.seen(receiver);
      }
    };
    const result = kind === 'get' ? wrapGetter(target, member, (receiver, threw, _error, value) => observe(receiver, [], threw, value), options)
      : wrapMethod(target, member, (receiver, args, threw, _error, value) => observe(receiver, args, threw, value), options);
    arrayPush(results, result); runtime.attach([result]);
  };
  for (let i = 0; i < CONNECTION_NAMES.length; i++) {
    const name = CONNECTION_NAMES[i]!;
    try {
      const prototype = prototypeOf(realm, name);
      if (prototype === null) { arrayPush(skipped, name); continue; }
      const constructor = descriptor(realm, name)?.value as object;
      if (i === 0 && descriptor(constructor, 'generateCertificate')) operationHook(constructor, 'generateCertificate', 'RTCPeerConnection.generateCertificate', 'async-call');
      arrayPush(results, wrapConstructor(realm, name, constructed, options));
      // Chrome's legacy alias may share the same original prototype; install those methods only once.
      if (weakSetHas(seenPrototypes, prototype)) continue;
      weakSetAdd(seenPrototypes, prototype);
      for (let index = 0; index < RTC_OPERATIONS.length; index++) {
        const [operation, , , kind] = RTC_OPERATIONS[index]!;
        if (!operation.startsWith('RTCPeerConnection.') || operation === 'RTCPeerConnection.generateCertificate') continue;
        try { operationHook(prototype, operation.slice('RTCPeerConnection.'.length), operation, kind); }
        catch { runtime.addFlag('hook-failed'); }
      }
    } catch { runtime.addFlag('hook-failed'); }
  }
  for (let index = 0; index < RTC_OPERATIONS.length; index++) {
    const [operation, , , kind] = RTC_OPERATIONS[index]!;
    if (operation.startsWith('RTCPeerConnection.')) continue;
    const separator = operation.indexOf('.');
    try {
      const prototype = prototypeOf(realm, operation.slice(0, separator));
      if (prototype) operationHook(prototype, operation.slice(separator + 1), operation, kind);
      else arrayPush(skipped, operation);
    } catch { runtime.addFlag('hook-failed'); }
  }
  const informationNames = ['RTCPeerConnectionIceEvent', 'RTCIceCandidate'] as const;
  for (let i = 0; i < informationNames.length; i++) {
    const name = informationNames[i]!;
    try {
      const prototype = prototypeOf(realm, name);
      if (prototype === null) { arrayPush(skipped, name); continue; }
      getters(prototype, name, name === 'RTCPeerConnectionIceEvent' ? ['candidate'] : CANDIDATE_GETTERS);
    } catch { runtime.addFlag('hook-failed'); }
  }
  // No stage/candidate inference: canonical api-use counts do not identify a connection, candidate,
  // successful Promise settlement, address value, or transmission. Created ICE events are not readouts.
  runtime.attach(results);
  return { results, skipped };
}
