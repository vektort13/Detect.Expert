import type { ProtectionFeature, ProtectionObservation } from '@detect-expert/contracts';
import { arrayPush } from './intrinsics';

const apply = Reflect.apply;
const getOwn = Object.getOwnPropertyDescriptor;
const getPrototype = Object.getPrototypeOf;
const define = Object.defineProperty;
const remove = Reflect.deleteProperty;
const hasOwn = Object.hasOwn;
const NativePromise = Promise;
const resolve = Promise.resolve;
const reject = Promise.reject;
const NativeDOMException = DOMException;
const LIMIT = 65535;

export interface ProtectionInstallation {
  snapshot(): ProtectionObservation;
  stop(): void;
}

type Denial = 'not-allowed' | 'security-sync' | 'security-async' | 'denied' | 'adapter-null' | 'webgl-null' | 'offscreen-webgl-null';
interface OwnedMethod { target: object; key: string; original: PropertyDescriptor; wrapper: Function }

function ownValue(target: object | null, key: string): unknown {
  if (target === null) return undefined;
  const descriptor = getOwn(target, key);
  return descriptor && hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function prototype(realm: object, name: string): object | null {
  const constructor = ownValue(realm, name);
  if (typeof constructor !== 'function' && (typeof constructor !== 'object' || constructor === null)) return null;
  const value = ownValue(constructor, 'prototype');
  return typeof value === 'object' && value !== null ? value : null;
}

function owner(target: object | null, key: string): { target: object; descriptor: PropertyDescriptor } | null {
  for (let depth = 0; target !== null && depth < 8; depth++) {
    const descriptor = getOwn(target, key);
    if (descriptor) return { target, descriptor };
    target = getPrototype(target) as object | null;
  }
  return null;
}

export function installProtection(realm: object, feature: ProtectionFeature): ProtectionInstallation {
  const state: ProtectionObservation = { feature, installed: 0, unavailable: 0, removed: 0, blocked: 0, stopped: false };
  const handles: OwnedMethod[] = [];

  function method(target: object | null, key: string, denial: Denial): void {
    try {
      const found = owner(target, key);
      if (!found || !found.descriptor.configurable || !hasOwn(found.descriptor, 'value') || typeof found.descriptor.value !== 'function') {
        state.unavailable++;
        return;
      }
      const original: Function = found.descriptor.value;
      const { blockedApi } = {
        blockedApi(this: unknown): unknown {
          if (state.stopped) return apply(original, this, arguments);
          if (denial === 'webgl-null' || denial === 'offscreen-webgl-null') {
            if (arguments.length === 0) return apply(original, this, arguments);
            const contextType: unknown = arguments[0];
            if (contextType !== 'webgl' && contextType !== 'webgl2' && !(denial === 'webgl-null' && contextType === 'experimental-webgl')) {
              return apply(original, this, arguments);
            }
            if (state.blocked < LIMIT) state.blocked++;
            return null;
          }
          if (state.blocked < LIMIT) state.blocked++;
          if (denial === 'denied') return apply(resolve, NativePromise, ['denied']);
          if (denial === 'adapter-null') return apply(resolve, NativePromise, [null]);
          const error = new NativeDOMException('Blocked by detect.expert', denial === 'not-allowed' ? 'NotAllowedError' : 'SecurityError');
          if (denial === 'security-sync') throw error;
          return apply(reject, NativePromise, [error]);
        },
      };
      define(found.target, key, { __proto__: null, value: blockedApi, configurable: true,
        enumerable: found.descriptor.enumerable === true, writable: found.descriptor.writable === true } as PropertyDescriptor);
      arrayPush(handles, { target: found.target, key, original: found.descriptor, wrapper: blockedApi });
      state.installed++;
    } catch {
      state.unavailable++;
    }
  }

  function hide(target: object | null, key: string): void {
    try {
      const found = owner(target, key);
      if (!found || !found.descriptor.configurable || !remove(found.target, key)) {
        state.unavailable++;
        return;
      }
      state.removed++;
      state.installed++;
    } catch {
      state.unavailable++;
    }
  }

  const navigator = prototype(realm, 'Navigator');
  switch (feature) {
    case 'window-management': method(realm, 'getScreenDetails', 'not-allowed'); break;
    case 'compute-pressure': method(prototype(realm, 'PressureObserver'), 'observe', 'not-allowed'); break;
    case 'idle-detection': {
      const constructor = ownValue(realm, 'IdleDetector');
      method(typeof constructor === 'function' ? constructor : null, 'requestPermission', 'denied');
      method(prototype(realm, 'IdleDetector'), 'start', 'not-allowed');
      break;
    }
    case 'local-fonts': method(realm, 'queryLocalFonts', 'not-allowed'); break;
    case 'clipboard-read':
      method(prototype(realm, 'Clipboard'), 'read', 'not-allowed');
      method(prototype(realm, 'Clipboard'), 'readText', 'not-allowed');
      break;
    case 'canvas-readback':
      method(prototype(realm, 'HTMLCanvasElement'), 'toDataURL', 'security-sync');
      method(prototype(realm, 'HTMLCanvasElement'), 'toBlob', 'security-sync');
      method(prototype(realm, 'HTMLCanvasElement'), 'captureStream', 'security-sync');
      method(prototype(realm, 'CanvasRenderingContext2D'), 'getImageData', 'security-sync');
      method(prototype(realm, 'OffscreenCanvasRenderingContext2D'), 'getImageData', 'security-sync');
      method(prototype(realm, 'OffscreenCanvas'), 'convertToBlob', 'security-async');
      break;
    case 'webgl':
      method(prototype(realm, 'HTMLCanvasElement'), 'getContext', 'webgl-null');
      method(prototype(realm, 'OffscreenCanvas'), 'getContext', 'offscreen-webgl-null');
      break;
    case 'webgpu': method(prototype(realm, 'GPU'), 'requestAdapter', 'adapter-null'); break;
    case 'audio':
      hide(realm, 'AudioContext'); hide(realm, 'OfflineAudioContext');
      hide(realm, 'webkitAudioContext'); hide(realm, 'webkitOfflineAudioContext');
      break;
    case 'webrtc': hide(realm, 'RTCPeerConnection'); hide(realm, 'webkitRTCPeerConnection'); break;
    case 'webassembly': hide(realm, 'WebAssembly'); break;
    case 'battery': hide(navigator, 'getBattery'); break;
    case 'network-information': hide(navigator, 'connection'); break;
    case 'keyboard': hide(navigator, 'keyboard'); break;
    case 'client-hints': hide(navigator, 'userAgentData'); break;
  }

  return {
    snapshot: () => ({ ...state }),
    stop() {
      if (state.stopped) return;
      state.stopped = true;
      for (let index = handles.length - 1; index >= 0; index--) {
        const handle = handles[index]!;
        try {
          const current = getOwn(handle.target, handle.key);
          if (!current || !hasOwn(current, 'value') || current.value !== handle.wrapper) continue;
          const original = handle.original;
          define(handle.target, handle.key, { __proto__: null, value: original.value, configurable: original.configurable === true,
            enumerable: original.enumerable === true, writable: original.writable === true } as PropertyDescriptor);
        } catch { /* Reload is required when the descriptor is no longer owned. */ }
      }
    },
  };
}