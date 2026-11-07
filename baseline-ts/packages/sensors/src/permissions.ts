// DET-039, ADR-006/026: page-requested queries and reads only. Never query, prompt, or handle a Promise.
import type { SignalCode } from '@detect-expert/contracts';
import { API_OPERATION_INDEX, PHASE_INDEX, SIGNAL_BIT, TECHNIQUE_INDEX, signalMaskOf } from './codes';
import { arrayPush } from './intrinsics';
import type { SensorRuntime } from './runtime';
import { wrapGetter, wrapMethod, wrapOutcomeMethod } from './wrap';
import type { WrapResult } from './wrap';

const descriptor = Object.getOwnPropertyDescriptor;
const create = Object.create;
const apply = Reflect.apply;
const own = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (value: object, key: string) => boolean;
const source = Function.prototype.call.bind(Function.prototype.toString) as (fn: Function) => string;
const includes = Function.prototype.call.bind(String.prototype.includes) as (text: string, part: string) => boolean;
const NO_ARGS: readonly unknown[] = [];
const TECHNIQUE = TECHNIQUE_INDEX['DET-039'];
const PERMISSIONS = ['camera', 'microphone', 'geolocation', 'notifications', 'clipboard-read', 'clipboard-write',
  'persistent-storage', 'background-sync', 'midi', 'sensors', 'payment-handler', 'screen-wake-lock',
  'window-management', 'local-fonts', 'display-capture', 'storage-access', 'unknown'] as const;
type Permission = typeof PERMISSIONS[number];
type PermissionState = 'granted' | 'denied' | 'prompt';
const POLICY_FAMILIES = ['FeaturePolicy', 'PermissionsPolicy'] as const;
const POLICY_METHODS = ['allowsFeature', 'features', 'allowedFeatures', 'getAllowlistForFeature'] as const;

/** Exact native aliases only. In Chrome several motion permissions share the single name `sensors`. */
export function permissionName(value: unknown): Permission {
  switch (value) {
    case 'camera': case 'video_capture': return 'camera';
    case 'microphone': case 'audio_capture': return 'microphone';
    case 'clipboard-read': case 'clipboard_read': return 'clipboard-read';
    case 'clipboard-write': case 'clipboard_write': return 'clipboard-write';
    case 'persistent-storage': case 'durable_storage': return 'persistent-storage';
    case 'background-sync': case 'background_sync': return 'background-sync';
    case 'payment-handler': case 'payment_handler': return 'payment-handler';
    case 'screen-wake-lock': case 'screen_wake_lock': return 'screen-wake-lock';
    case 'local-fonts': case 'local_fonts': return 'local-fonts';
    case 'display-capture': case 'display_capture': return 'display-capture';
    case 'geolocation': case 'notifications': case 'midi': case 'sensors':
    case 'window-management': case 'storage-access': return value;
    default: return 'unknown';
  }
}

function policyFeature(value: unknown): Permission {
  switch (value) {
    case 'camera': case 'microphone': case 'geolocation': case 'clipboard-read': case 'clipboard-write':
    case 'midi': case 'payment-handler': case 'screen-wake-lock': case 'window-management':
    case 'local-fonts': case 'display-capture': case 'storage-access': return value;
    case 'accelerometer': case 'gyroscope': case 'magnetometer': return 'sensors';
    default: return 'unknown';
  }
}

function dataObject(target: object, key: string): object | null {
  const field = descriptor(target, key);
  if (!field || !own(field, 'value')) return null;
  const value: unknown = field.value;
  return (typeof value === 'object' && value !== null) || typeof value === 'function' ? value : null;
}

export interface PermissionsSensor { results: WrapResult[]; skipped: string[] }

export function installPermissionsSensor(runtime: SensorRuntime, realm: object = globalThis): PermissionsSensor {
  const results: WrapResult[] = [];
  const skipped: string[] = [];
  if (!runtime.hooks.enabled) return { results, skipped };
  const options = { context: runtime.hooks };
  // Precompute fixed masks. Extended signals use arithmetic sums, never bitwise truncation.
  const stateMasks = create(null) as Record<Permission, Record<PermissionState, number>>;
  const policyMasks = create(null) as Record<Permission, { allowed: number; blocked: number }>;
  for (let index = 0; index < PERMISSIONS.length; index++) {
    const name = PERMISSIONS[index]!;
    const code: SignalCode = `permission-${name}`;
    stateMasks[name] = {
      granted: signalMaskOf(['api-use', code, 'permission-granted']),
      denied: signalMaskOf(['api-use', code, 'permission-denied']),
      prompt: signalMaskOf(['api-use', code, 'permission-prompt']),
    };
    policyMasks[name] = {
      allowed: signalMaskOf(['api-use', code, 'policy-allowed']),
      blocked: signalMaskOf(['api-use', code, 'policy-blocked']),
    };
  }
  const policyEnumeration = signalMaskOf(['api-use', 'policy-enumeration']);
  const attach = (result: WrapResult): void => { arrayPush(results, result); runtime.attach([result]); };
  const record = (threw: boolean, mask = SIGNAL_BIT['api-use']): void => {
    runtime.record(TECHNIQUE, PHASE_INDEX[threw ? 'threw-sync' : 'returned-sync'], mask);
  };
  const preview = (name: string, threw: boolean, value: unknown): void => runtime.recordResult(name,
    PHASE_INDEX[threw ? 'threw-sync' : 'returned-sync'], value);
  const prototype = (family: string): object | null => {
    const constructor = dataObject(realm, family);
    return constructor && dataObject(constructor, 'prototype');
  };
  try {
    const target = prototype('Permissions');
    if (target && descriptor(target, 'query')) attach(wrapOutcomeMethod(target, 'query', threw => {
      runtime.recordOperation(API_OPERATION_INDEX['Permissions.query'], PHASE_INDEX[threw ? 'threw-sync' : 'settlement-unobserved']);
      runtime.recordResult('Permissions.query', PHASE_INDEX[threw ? 'threw-sync' : 'settlement-unobserved'], undefined);
    }, options));
    else arrayPush(skipped, 'Permissions.query');
  } catch { runtime.addFlag('hook-failed'); }
  try {
    const target = prototype('PermissionStatus');
    if (target && descriptor(target, 'state')) {
      const nameField = descriptor(target, 'name');
      const getter = nameField && own(nameField, 'get') ? nameField.get : null;
      // The source check rejects JS replacements; early capture is required as it cannot authenticate a Proxy.
      const nameGetter = runtime.earlyCaptureGuaranteed && typeof getter === 'function' && includes(source(getter), '[native code]') ? getter : null;
      attach(wrapGetter(target, 'state', (receiver, threw, _error, value) => {
        if (threw || (value !== 'granted' && value !== 'denied' && value !== 'prompt')) { record(threw); preview('PermissionStatus.state', threw, value); return; }
        let name: Permission = 'unknown';
        // Native branding reads internal state only; own `name` accessors and Proxy traps are bypassed.
        if (nameGetter) { try { name = permissionName(apply(nameGetter, receiver, NO_ARGS)); } catch { /* unknown */ } }
        record(false, stateMasks[name][value]);
        preview('PermissionStatus.state.' + name, false, value);
      }, options));
    } else arrayPush(skipped, 'PermissionStatus.state');
  } catch { runtime.addFlag('hook-failed'); }
  try {
    const target = dataObject(realm, 'Notification');
    if (target && descriptor(target, 'permission')) attach(wrapGetter(target, 'permission', (_receiver, threw, _error, value) => {
      const state = value === 'default' ? 'prompt' : value;
      record(threw, !threw && (state === 'granted' || state === 'denied' || state === 'prompt')
        ? stateMasks.notifications[state] : SIGNAL_BIT['api-use']);
      preview('Notification.permission', threw, value);
    }, options));
    else arrayPush(skipped, 'Notification.permission');
  } catch { runtime.addFlag('hook-failed'); }
  let previousPolicyTarget: object | null = null;
  for (let index = 0; index < POLICY_FAMILIES.length; index++) {
    const family = POLICY_FAMILIES[index]!;
    try {
      const target = prototype(family);
      if (!target) { arrayPush(skipped, family); continue; }
      if (target === previousPolicyTarget) continue;
      previousPolicyTarget = target;
      for (let method = 0; method < POLICY_METHODS.length; method++) {
        const key = POLICY_METHODS[method]!;
        try {
          if (!descriptor(target, key)) { arrayPush(skipped, `${family}.${key}`); continue; }
          if (key === 'allowsFeature') attach(wrapMethod(target, key, (_receiver, args, threw, _error, value) => {
            // Optional origin asks about another context. Do not inspect or report it as this page's policy.
            const name = !threw && args.length === 1 ? policyFeature(args[0]) : 'unknown';
            const mask = name !== 'unknown' && typeof value === 'boolean'
              ? policyMasks[name][value ? 'allowed' : 'blocked'] : policyEnumeration;
            record(threw, mask);
            preview(family + '.' + key, threw, value);
          }, options));
          else attach(wrapOutcomeMethod(target, key, threw => {
            record(threw, policyEnumeration);
          }, options));
        } catch { runtime.addFlag('hook-failed'); }
      }
    } catch { runtime.addFlag('hook-failed'); }
  }
  return { results, skipped };
}
