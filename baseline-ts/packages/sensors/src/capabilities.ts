import { API_OPERATION_DEFINITIONS } from '@detect-expert/contracts';
import { API_OPERATION_INDEX, PHASE_INDEX } from './codes';
import { arrayPush } from './intrinsics';
import type { SensorRuntime } from './runtime';
import { wrapConstructor, wrapGetter, wrapResultMethod } from './wrap';
import type { WrapResult } from './wrap';
import { installRtcValueCapture, nativeRtcFunction } from './rtc-values';

const descriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;
const MECHANISMS = ['media-capabilities', 'media-devices', 'speech', 'drm', 'browser-capabilities', 'builtin-ai', 'recognition', 'app-integration'];
const STATIC = ['MediaSource.isTypeSupported', 'AudioDecoder.isConfigSupported', 'AudioEncoder.isConfigSupported',
  'VideoDecoder.isConfigSupported', 'VideoEncoder.isConfigSupported', 'ImageDecoder.isTypeSupported',
  'SpeechRecognition.available', 'SpeechRecognition.install', 'Intl.supportedValuesOf', 'PerformanceObserver.supportedEntryTypes', 'Notification.maxActions',
  'BarcodeDetector.getSupportedFormats'];
const SURFACES = API_OPERATION_DEFINITIONS.filter(definition => MECHANISMS.includes(definition[2]) && !definition[0].startsWith('RTCRtp') && definition[0] !== 'Permissions.query').map(definition => {
  const operation = definition[0];
  const separator = operation.indexOf('.');
  return { operation, kind: definition[3], owner: separator < 0 ? operation : operation.slice(0, separator),
    member: separator < 0 ? operation : operation.slice(separator + 1), static: STATIC.includes(operation) || definition[2] === 'builtin-ai' &&
      (operation.endsWith('.availability') || operation.endsWith('.params') || operation.endsWith('.create')) };
});

export interface CapabilitySensor { results: WrapResult[]; skipped: string[] }

function dataObject(owner: object, key: string): object | null {
  const field = descriptor(owner, key);
  if (!field || !hasOwn(field, 'value')) return null;
  const value: unknown = field.value;
  return value !== null && (typeof value === 'object' || typeof value === 'function') ? value : null;
}

export function installCapabilitySensor(runtime: SensorRuntime, realm: object = globalThis): CapabilitySensor {
  const results: WrapResult[] = [], skipped: string[] = [];
  if (!runtime.hooks.enabled) return { results, skipped };
  const rtcValues = installRtcValueCapture(runtime);
  for (let index = 0; index < SURFACES.length; index++) {
    const { operation, kind, owner, member, static: isStatic } = SURFACES[index]!;
    try {
      const namespace = owner === 'Window' ? realm : dataObject(realm, owner);
      const target = owner === 'Window' || isStatic ? namespace : namespace && dataObject(namespace, 'prototype');
      const selected = kind === 'construct' ? realm : target;
      if (!selected || !descriptor(selected, member)) { arrayPush(skipped, operation); continue; }
      const ordinal = API_OPERATION_INDEX[operation];
      const saved = operation === 'MediaStreamTrack.getSettings' ? descriptor(selected, member) : undefined;
      const returnedNative = !!saved && hasOwn(saved, 'value') && nativeRtcFunction(saved.value);
      const returned = PHASE_INDEX[kind === 'async-call' ? 'settlement-unobserved' : 'returned-sync'];
      const observe = (threw: boolean, value: unknown): void => {
        const phase = threw ? PHASE_INDEX['threw-sync'] : returned;
        runtime.recordOperation(ordinal, phase);
        if (operation !== 'MediaStreamTrack.getSettings' || threw || !returnedNative || !rtcValues?.returned(operation, value)) runtime.recordResult(operation, phase, value);
      };
      const options = { context: runtime.hooks };
      const result = kind === 'construct'
        ? wrapConstructor(selected, member, (_args, _newTarget, threw, _error, value) => observe(threw, value), options)
        : kind === 'get' ? wrapGetter(selected, member, (_receiver, threw, _error, value) => observe(threw, value), options)
          : wrapResultMethod(selected, member, observe, options);
      arrayPush(results, result); runtime.attach([result]);
    } catch { runtime.addFlag('hook-failed'); }
  }
  return { results, skipped };
}