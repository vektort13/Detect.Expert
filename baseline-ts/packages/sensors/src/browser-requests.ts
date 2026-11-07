// REQ-001/002/005/011, ADR-006/036. Observe page requests without reading input or response contents.
// The separate result preview excludes sensitive storage, cookies and asynchronous settlement.
// Fixed browser interfaces only; docs/detectors/browser-requests.md lists partial surfaces.
import type { ApiOperation, TechniqueId } from '@detect-expert/contracts';
import { EXTENSION_RESOURCE_METHODS, extensionTargetIndex } from '@detect-expert/contracts';
import { API_OPERATION_INDEX, EXTENSION_METHOD_INDEX, PHASE_INDEX, SIGNAL_BIT, TECHNIQUE_INDEX } from './codes';
import { arrayPush } from './intrinsics';
import type { SensorRuntime } from './runtime';
import { wrapGetter, wrapMethod, wrapPreparedMethod, wrapResultMethod, wrapSetter } from './wrap';
import type { WrapResult } from './wrap';
import { extensionResourceId } from './extension-resource';
import { visualCaptureFor } from './visual';

const descriptor = Object.getOwnPropertyDescriptor;
const own = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (value: object, key: string) => boolean;
const FETCH_METHOD_INDEX = EXTENSION_RESOURCE_METHODS.indexOf('fetch');
const NativeWeakMap = WeakMap;
const weakGet = Function.prototype.call.bind(WeakMap.prototype.get) as (map: WeakMap<object, RequestTarget>, receiver: object) => RequestTarget | undefined;
const weakSet = Function.prototype.call.bind(WeakMap.prototype.set) as (map: WeakMap<object, RequestTarget>, receiver: object, value: RequestTarget) => void;
const weakDelete = Function.prototype.call.bind(WeakMap.prototype.delete) as (map: WeakMap<object, RequestTarget>, receiver: object) => boolean;
interface RequestTarget { epoch: object; candidate: number; target: number | null }
function objectReceiver(receiver: unknown): receiver is object { return receiver !== null && (typeof receiver === 'object' || typeof receiver === 'function'); }
function targetIndex(input: unknown): number | null {
  const id = extensionResourceId(input);
  return id === null ? null : extensionTargetIndex(id) ?? 0;
}

export interface BrowserRequestSensor { results: WrapResult[]; skipped: string[] }

function dataObject(target: object, key: string): object | null {
  const field = descriptor(target, key);
  if (!field || !own(field, 'value')) return null;
  const value: unknown = field.value;
  return (typeof value === 'object' && value !== null) || typeof value === 'function' ? value : null;
}

export function installBrowserRequestSensor(runtime: SensorRuntime, realm: object = globalThis): BrowserRequestSensor {
  const results: WrapResult[] = [];
  const skipped: string[] = [];
  if (!runtime.hooks.enabled) return { results, skipped };
  const options = { context: runtime.hooks };
  const visual = visualCaptureFor(runtime);
  const attach = (result: WrapResult): void => {
    arrayPush(results, result);
    // Attach immediately: a later hostile descriptor must not orphan an earlier installed hook.
    runtime.attach([result]);
  };
  const method = (target: object, key: string, id: TechniqueId, label: string, asynchronous = true): void => {
    if (!descriptor(target, key)) { arrayPush(skipped, key); return; }
    const technique = TECHNIQUE_INDEX[id];
    const phase = PHASE_INDEX[asynchronous ? 'settlement-unobserved' : 'returned-sync'];
    const operation = API_OPERATION_INDEX[label as ApiOperation];
    attach(wrapResultMethod(target, key, (threw, result) => {
      if (operation === undefined) runtime.record(technique, threw ? PHASE_INDEX['threw-sync'] : phase, SIGNAL_BIT['api-use']);
      else runtime.recordOperation(operation, threw ? PHASE_INDEX['threw-sync'] : phase);
      runtime.recordResult(label, threw ? PHASE_INDEX['threw-sync'] : phase, result);
    }, options));
  };
  const family = (name: string, id: TechniqueId, methods: readonly string[] | string, asynchronous = true, staticMethods = false): void => {
    try {
      const constructor = dataObject(realm, name);
      const target = constructor && (staticMethods ? constructor : dataObject(constructor, 'prototype'));
      if (!target) { arrayPush(skipped, name); return; }
      for (const key of typeof methods === 'string' ? [methods] : methods) {
        try { method(target, key, id, name + '.' + key, asynchronous); } catch { runtime.addFlag('hook-failed'); }
      }
    } catch { runtime.addFlag('hook-failed'); }
  };
  family('Geolocation', 'DET-044', ['getCurrentPosition', 'watchPosition']);
  family('Bluetooth', 'DET-045', ['getAvailability', 'getDevices', 'requestDevice']);
  family('USB', 'DET-046', ['getDevices', 'requestDevice']);
  family('HID', 'DET-046', ['getDevices', 'requestDevice']);
  family('Serial', 'DET-046', ['getPorts', 'requestPort']);
  family('Navigator', 'DET-047', ['getGamepads'], false);
  family('XRSystem', 'DET-048', ['isSessionSupported', 'requestSession']);
  family('CookieStore', 'DET-049', ['get', 'getAll', 'set', 'delete']);
  // Cookie reads only: the shared getter wrapper preserves the original setter unchanged.
  try {
    const constructor = dataObject(realm, 'Document');
    const target = constructor && dataObject(constructor, 'prototype');
    if (target && descriptor(target, 'cookie')) attach(wrapGetter(target, 'cookie', (_receiver, threw) => {
      runtime.record(TECHNIQUE_INDEX['DET-049'], PHASE_INDEX[threw ? 'threw-sync' : 'returned-sync'], SIGNAL_BIT['api-use']);
      runtime.recordResult('Document.cookie', PHASE_INDEX[threw ? 'threw-sync' : 'returned-sync'], undefined);
    }, options));
    else arrayPush(skipped, 'Document.cookie');
  } catch { runtime.addFlag('hook-failed'); }
  family('Storage', 'DET-050', ['getItem', 'setItem', 'removeItem', 'clear', 'key'], false);
  family('IDBFactory', 'DET-051', ['open', 'deleteDatabase', 'databases']);
  family('CacheStorage', 'DET-052', ['open', 'match', 'has', 'delete', 'keys']);
  family('Cache', 'DET-052', ['match', 'matchAll', 'add', 'addAll', 'put', 'delete', 'keys']);
  family('StorageManager', 'DET-053', ['estimate', 'persist', 'persisted']);
  family('Document', 'DET-054', ['hasStorageAccess', 'requestStorageAccess', 'hasUnpartitionedCookieAccess', 'requestStorageAccessFor']);
  const recordRequest = (target: number | null, methodIndex: number, threw: boolean, reference = false): void => {
    const phase = PHASE_INDEX[threw ? 'threw-sync' : reference ? 'returned-sync' : 'settlement-unobserved'];
    if (target === null) { if (!reference) runtime.record(TECHNIQUE_INDEX['DET-059'], phase, SIGNAL_BIT['api-use']); }
    else runtime.recordExtensionResource(target, methodIndex, phase);
  };
  try {
    if (descriptor(realm, 'fetch')) attach(wrapMethod(realm, 'fetch', (_receiver, args, threw) => {
      recordRequest(targetIndex(args.length > 0 ? args[0] : undefined), FETCH_METHOD_INDEX, threw);
      runtime.recordResult('Window.fetch', PHASE_INDEX[threw ? 'threw-sync' : 'settlement-unobserved'], undefined);
    }, options));
    else arrayPush(skipped, 'fetch');
  } catch { runtime.addFlag('hook-failed'); }
  let requests = new NativeWeakMap<object, RequestTarget>(), epoch = runtime.historyEpoch, admissions = 0;
  const reset = (): void => { requests = new NativeWeakMap(); epoch = runtime.historyEpoch; admissions = 0; };
  runtime.onStop(reset);
  try {
    const constructor = dataObject(realm, 'XMLHttpRequest');
    const target = constructor && dataObject(constructor, 'prototype');
    if (target) {
      if (descriptor(target, 'open')) attach(wrapPreparedMethod(target, 'open', (receiver, args): RequestTarget | null => {
        if (epoch !== runtime.historyEpoch) reset();
        if (!objectReceiver(receiver)) return null;
        const previous = weakGet(requests, receiver);
        weakDelete(requests, receiver);
        const candidate = targetIndex(args[1]);
        if (candidate === null) return null;
        if (previous === undefined && admissions >= 512) { runtime.addFlag('budget-exceeded'); return null; }
        if (previous === undefined) admissions++;
        const state: RequestTarget = { epoch, candidate, target: null };
        weakSet(requests, receiver, state);
        return state;
      }, (state, receiver, _args, threw) => {
        if (!state || !objectReceiver(receiver) || weakGet(requests, receiver) !== state) return;
        if (threw || state.epoch !== runtime.historyEpoch) weakDelete(requests, receiver);
        else state.target = state.candidate;
      }, options));
      else arrayPush(skipped, 'XMLHttpRequest.open');
      if (descriptor(target, 'send')) attach(wrapPreparedMethod(target, 'send', receiver =>
        objectReceiver(receiver) ? weakGet(requests, receiver) : undefined, (state, _receiver, _args, threw) => {
        recordRequest(state?.epoch === runtime.historyEpoch ? state.target : null, EXTENSION_METHOD_INDEX['xhr-send'], threw);
      }, options));
      else arrayPush(skipped, 'XMLHttpRequest.send');
    } else arrayPush(skipped, 'XMLHttpRequest');
  } catch { runtime.addFlag('hook-failed'); }
  for (const [name, methodIndex] of [['HTMLImageElement', EXTENSION_METHOD_INDEX['image-src']], ['HTMLScriptElement', EXTENSION_METHOD_INDEX['script-src']]] as const) {
    try {
      const constructor = dataObject(realm, name), target = constructor && dataObject(constructor, 'prototype');
      if (target && descriptor(target, 'src')) attach(wrapSetter(target, 'src', (receiver, args, threw) => {
        recordRequest(targetIndex(args[0]), methodIndex, threw, true);
        if (!threw && name === 'HTMLImageElement') visual?.imageSource(receiver, args[0]);
      }, options));
      else arrayPush(skipped, name + '.src');
    } catch { runtime.addFlag('hook-failed'); }
  }
  family('Navigator', 'DET-059', 'sendBeacon', false);
  family('ServiceWorkerContainer', 'DET-063', ['register', 'getRegistration', 'getRegistrations']);
  family('PublicKeyCredential', 'DET-069', ['isUserVerifyingPlatformAuthenticatorAvailable', 'isConditionalMediationAvailable', 'getClientCapabilities'], true, true);
  return { results, skipped };
}
