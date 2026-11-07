// DET-025..038/040/041, REQ-001/002/005/011, ADR-006: passive browser API facts.
// Installation reads descriptors only. ADR-036 previews already-returned technical primitives separately;
// no repeated page getter calls, argument inspection or foreign Promise handlers.
import type { ApiOperation, TechniqueId } from '@detect-expert/contracts';
import { API_OPERATION_INDEX, PHASE_INDEX, SIGNAL_BIT, TECHNIQUE_INDEX } from './codes';
import { arrayPush } from './intrinsics';
import type { SensorRuntime } from './runtime';
import { wrapConstructor, wrapGetter, wrapResultMethod, wrapSetter } from './wrap';
import type { WrapResult } from './wrap';
import { rememberScreenTarget } from './screen-events';

const descriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (object: object, key: string) => boolean;
const RETURNED = PHASE_INDEX['returned-sync'];
const THREW = PHASE_INDEX['threw-sync'];
const UNSETTLED = PHASE_INDEX['settlement-unobserved'];
const API_USE = SIGNAL_BIT['api-use'];

export interface EnvironmentSensor {
  results: WrapResult[];
  /** Fixed interface/property labels only; unsupported data properties remain untouched. */
  skipped: string[];
}

/** Uses only a fixed own data descriptor, never a page-defined namespace/constructor getter. */
function dataObject(owner: object, name: string): object | null {
  const value = descriptor(owner, name);
  if (!value || !hasOwn(value, 'value')) return null;
  return value.value !== null && (typeof value.value === 'object' || typeof value.value === 'function')
    ? value.value as object : null;
}

export function installEnvironmentSensor(runtime: SensorRuntime, realm: object = globalThis): EnvironmentSensor {
  const results: WrapResult[] = [];
  const skipped: string[] = [];
  if (!runtime.hooks.enabled) return { results, skipped };
  const options = { context: runtime.hooks };
  const object = (owner: object, name: string): object | null => {
    try {
      const result = dataObject(owner, name);
      if (result === null) {
        arrayPush(skipped, name);
        // Missing optional API is ordinary; a present accessor is not executed to discover its target.
        const d = descriptor(owner, name);
        if (d && !hasOwn(d, 'value')) runtime.addFlag('hook-failed');
      }
      return result;
    } catch { runtime.addFlag('hook-failed'); return null; }
  };
  const prototype = (owner: object, name: string): object | null => {
    const constructor = object(owner, name);
    return constructor === null ? null : object(constructor, 'prototype');
  };
  const getters = (target: object | null, name: string, keys: readonly string[], id: TechniqueId): void => {
    if (target === null) return;
    const technique = TECHNIQUE_INDEX[id];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      try {
        const d = descriptor(target, key);
        if (!d) { arrayPush(skipped, name + '.' + key); continue; }
        // Ordinary data reads cannot be observed without changing their JavaScript semantics.
        if (hasOwn(d, 'value')) {
          arrayPush(skipped, name + '.' + key);
          if (!d.configurable) runtime.addFlag('descriptor-nonconfigurable');
          continue;
        }
        const label = name + '.' + key;
        const operation = API_OPERATION_INDEX[label as ApiOperation];
        const handle = wrapGetter(target, key, (receiver, threw, _error, result) => {
          if (operation === undefined) runtime.record(technique, threw ? THREW : RETURNED, API_USE);
          else runtime.recordOperation(operation, threw ? THREW : RETURNED);
          runtime.recordResult(label, threw ? THREW : RETURNED, result);
          if (!threw) {
            if (name === 'Screen' || name === 'ScreenDetailed') rememberScreenTarget(runtime, receiver, 'Screen');
            if (name === 'ScreenDetails') {
              rememberScreenTarget(runtime, receiver, 'ScreenDetails');
              if (key === 'currentScreen') rememberScreenTarget(runtime, result, 'Screen');
            }
          }
        }, options);
        arrayPush(results, handle); runtime.attach([handle]);
      } catch { runtime.addFlag('hook-failed'); }
    }
  };
  const method = (target: object | null, name: string, key: string, id: TechniqueId, asynchronous = false): void => {
    if (target === null) return;
    const technique = TECHNIQUE_INDEX[id];
    try {
      if (!descriptor(target, key)) { arrayPush(skipped, name + '.' + key); return; }
      const label = name + '.' + key;
      const operation = API_OPERATION_INDEX[label as ApiOperation];
      const handle = wrapResultMethod(target, key, (threw, result) => {
        const phase = threw ? THREW : asynchronous ? UNSETTLED : RETURNED;
        if (operation === undefined) runtime.record(technique, phase, API_USE);
        else runtime.recordOperation(operation, phase);
        runtime.recordResult(label, phase, result);
      }, options);
      arrayPush(results, handle); runtime.attach([handle]);
    } catch { runtime.addFlag('hook-failed'); }
  };

  const navigator = prototype(realm, 'Navigator');
  getters(navigator, 'Navigator', ['userAgent', 'platform', 'vendor', 'language', 'languages',
    'appVersion', 'appName', 'appCodeName', 'product', 'productSub', 'vendorSub'], 'DET-025');
  getters(navigator, 'Navigator', ['userAgentData'], 'DET-026');
  const ua = prototype(realm, 'NavigatorUAData');
  getters(ua, 'NavigatorUAData', ['brands', 'mobile', 'platform'], 'DET-026');
  method(ua, 'NavigatorUAData', 'getHighEntropyValues', 'DET-026', true);
  getters(navigator, 'Navigator', ['plugins', 'mimeTypes', 'pdfViewerEnabled'], 'DET-027');
  getters(navigator, 'Navigator', ['webdriver'], 'DET-028');
  const screen = prototype(realm, 'Screen');
  try {
    const screenDescriptor = descriptor(realm, 'screen');
    if (screenDescriptor && hasOwn(screenDescriptor, 'get') && typeof screenDescriptor.get === 'function') {
      const handle = wrapGetter(realm, 'screen', (_receiver, threw, _error, result) => {
        if (!threw) rememberScreenTarget(runtime, result, 'Screen');
      }, options);
      arrayPush(results, handle); runtime.attach([handle]);
    }
  } catch { runtime.addFlag('hook-failed'); }
  getters(screen, 'Screen', ['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth', 'orientation'], 'DET-029');
  getters(prototype(realm, 'ScreenOrientation'), 'ScreenOrientation', ['angle', 'type'], 'DET-029');
  getters(realm, 'Window', ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'screenX', 'screenY', 'screenLeft', 'screenTop', 'devicePixelRatio', 'visualViewport'], 'DET-030');
  getters(prototype(realm, 'VisualViewport'), 'VisualViewport', ['offsetLeft', 'offsetTop', 'pageLeft', 'pageTop', 'width', 'height', 'scale'], 'DET-030');
  getters(screen, 'Screen', ['isExtended', 'availLeft', 'availTop'], 'DET-031');
  method(realm, 'Window', 'getScreenDetails', 'DET-031', true);
  const screenDetails = prototype(realm, 'ScreenDetails');
  getters(screenDetails, 'ScreenDetails', ['screens', 'currentScreen'], 'DET-031');
  getters(prototype(realm, 'ScreenDetailed'), 'ScreenDetailed', ['left', 'top',
    'devicePixelRatio', 'label', 'isPrimary', 'isInternal'], 'DET-031');
  for (const key of ['open', 'moveTo', 'moveBy', 'resizeTo', 'resizeBy']) method(realm, 'Window', key, 'DET-031');
  method(prototype(realm, 'Element'), 'Element', 'requestFullscreen', 'DET-031', true);
  method(prototype(realm, 'Document'), 'Document', 'exitFullscreen', 'DET-031', true);
  for (const [target, name, keys] of [[screen, 'Screen', ['onchange']],
    [screenDetails, 'ScreenDetails', ['onscreenschange', 'oncurrentscreenchange']]] as const) {
    if (!target) continue;
    for (const key of keys) {
      try {
        if (!descriptor(target, key)) { arrayPush(skipped, name + '.' + key); continue; }
        const operation = API_OPERATION_INDEX[(name + '.' + key) as ApiOperation];
        const handle = wrapSetter(target, key, (receiver, _args, threw, _error, result) => {
          runtime.recordOperation(operation, threw ? THREW : RETURNED);
          runtime.recordResult(name + '.' + key, threw ? THREW : RETURNED, result);
          if (!threw) rememberScreenTarget(runtime, receiver, name);
        }, options);
        arrayPush(results, handle); runtime.attach([handle]);
      } catch { runtime.addFlag('hook-failed'); }
    }
  }
  getters(navigator, 'Navigator', ['hardwareConcurrency'], 'DET-032');
  getters(navigator, 'Navigator', ['deviceMemory'], 'DET-033');
  getters(navigator, 'Navigator', ['maxTouchPoints'], 'DET-034');
  method(prototype(realm, 'Date'), 'Date', 'getTimezoneOffset', 'DET-035');
  const intl = object(realm, 'Intl');
  if (intl !== null) {
    const names = ['Collator', 'DateTimeFormat', 'NumberFormat', 'PluralRules', 'RelativeTimeFormat', 'ListFormat', 'Segmenter', 'DisplayNames'] as const;
    for (let i = 0; i < names.length; i++) method(prototype(intl, names[i]!), 'Intl.' + names[i]!, 'resolvedOptions', 'DET-036');
  }
  method(realm, 'Window', 'matchMedia', 'DET-037');
  method(object(realm, 'CSS'), 'CSS', 'supports', 'DET-038');
  method(navigator, 'Navigator', 'getBattery', 'DET-040', true);
  getters(prototype(realm, 'BatteryManager'), 'BatteryManager', ['charging', 'chargingTime', 'dischargingTime', 'level'], 'DET-040');
  getters(navigator, 'Navigator', ['connection'], 'DET-041');
  getters(prototype(realm, 'NetworkInformation'), 'NetworkInformation', ['type', 'effectiveType', 'rtt', 'downlink', 'downlinkMax', 'saveData'], 'DET-041');
  for (const name of ['PressureObserver', 'IdleDetector'] as const) {
    try {
      if (object(realm, name) !== null) {
        const handle = wrapConstructor(realm, name, (_args, _newTarget, threw, _error, result) => {
          runtime.recordOperation(API_OPERATION_INDEX[name], threw ? THREW : RETURNED);
          runtime.recordResult(name, threw ? THREW : RETURNED, result);
        }, options);
        arrayPush(results, handle); runtime.attach([handle]);
      }
    } catch { runtime.addFlag('hook-failed'); }
  }
  getters(object(realm, 'PressureObserver'), 'PressureObserver', ['knownSources'], 'DET-042');
  const pressure = prototype(realm, 'PressureObserver');
  method(pressure, 'PressureObserver', 'observe', 'DET-042', true);
  for (const key of ['unobserve', 'disconnect', 'takeRecords']) method(pressure, 'PressureObserver', key, 'DET-042');
  getters(prototype(realm, 'PressureRecord'), 'PressureRecord', ['source', 'state', 'time'], 'DET-042');
  method(prototype(realm, 'PressureRecord'), 'PressureRecord', 'toJSON', 'DET-042');
  method(object(realm, 'IdleDetector'), 'IdleDetector', 'requestPermission', 'DET-043', true);
  const idle = prototype(realm, 'IdleDetector');
  method(idle, 'IdleDetector', 'start', 'DET-043', true);
  getters(idle, 'IdleDetector', ['userState', 'screenState'], 'DET-043');
  runtime.attach(results);
  return { results, skipped };
}
