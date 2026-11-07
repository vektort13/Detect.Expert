// E07-02 / DET-005..009 / REQ-001/002/005. No text, pointer coordinates or font lists.
// ADR-036 separately previews returned dimensions, lengths and check results without rereading objects.
// CSSOM View, SVG2, CSS Font Loading and Local Font Access; docs/detectors/geometry-fonts.md.
import { PHASE_INDEX, SIGNAL_BIT, TECHNIQUE_INDEX } from './codes';
import { arrayPush } from './intrinsics';
import type { SensorRuntime } from './runtime';
import { wrapGetter, wrapMethod } from './wrap';
import type { MethodObserver, WrapResult } from './wrap';
import type { TechniqueId } from '@detect-expert/contracts';

const descriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (object: object, key: string) => boolean;
const FONT_ITERATOR = Symbol.iterator;

export interface GeometrySensor { results: WrapResult[]; skipped: string[] }

function prototype(realm: object, name: string): object | null {
  const value = descriptor(realm, name);
  if (!value || !hasOwn(value, 'value') || typeof value.value !== 'function') return null;
  const proto = descriptor(value.value, 'prototype');
  return proto && hasOwn(proto, 'value') && typeof proto.value === 'object' && proto.value !== null ? proto.value : null;
}

export function installGeometrySensor(runtime: SensorRuntime, realm: object = globalThis): GeometrySensor {
  const results: WrapResult[] = [];
  const skipped: string[] = [];
  if (!runtime.hooks.enabled) return { results, skipped };
  const options = { context: runtime.hooks };
  const method = (target: object, key: PropertyKey, id: TechniqueId, label: string, asynchronous = false): void => {
    if (!descriptor(target, key)) { arrayPush(skipped, key === FONT_ITERATOR ? 'Symbol.iterator' : key as string); return; }
    const technique = TECHNIQUE_INDEX[id];
    const observe: MethodObserver = (_this, _args, threw, _error, result) => {
      const phase = threw ? PHASE_INDEX['threw-sync'] : asynchronous ? PHASE_INDEX['settlement-unobserved'] : PHASE_INDEX['returned-sync'];
      runtime.record(technique, phase, SIGNAL_BIT['api-use']);
      runtime.recordResult(label, phase, result);
    };
    arrayPush(results, wrapMethod(target, key, observe, options));
  };
  const family = (name: string, id: TechniqueId, methods: readonly string[], getters: readonly string[] = []): void => {
    try {
      const target = prototype(realm, name);
      if (!target) { arrayPush(skipped, name); return; }
      for (const key of methods) method(target, key, id, name + '.' + key);
      const technique = TECHNIQUE_INDEX[id];
      for (const key of getters) {
        if (!descriptor(target, key)) { arrayPush(skipped, name + '.' + key); continue; }
        const label = name + '.' + key;
        arrayPush(results, wrapGetter(target, key, (_this, threw, _error, result) => {
          const phase = threw ? PHASE_INDEX['threw-sync'] : PHASE_INDEX['returned-sync'];
          runtime.record(technique, phase, SIGNAL_BIT['api-use']);
          runtime.recordResult(label, phase, result);
        }, options));
      }
    } catch { runtime.addFlag('hook-failed'); }
  };
  family('Element', 'DET-005', ['getClientRects', 'getBoundingClientRect']);
  family('HTMLElement', 'DET-005', [], ['offsetWidth', 'offsetHeight']);
  family('Range', 'DET-006', ['getClientRects', 'getBoundingClientRect']);
  family('SVGGraphicsElement', 'DET-007', ['getBBox']);
  family('SVGTextContentElement', 'DET-007', ['getComputedTextLength', 'getSubStringLength']);
  try {
    const fontSet = prototype(realm, 'FontFaceSet');
    if (fontSet) {
      method(fontSet, 'check', 'DET-008', 'FontFaceSet.check');
      method(fontSet, 'load', 'DET-008', 'FontFaceSet.load', true);
      // These enumerate page-loaded FontFaces, not all fonts installed in the operating system.
      for (const key of ['values', 'keys', 'entries', 'forEach', FONT_ITERATOR]) method(fontSet, key, 'DET-008',
        'FontFaceSet.' + (key === FONT_ITERATOR ? 'iterator' : key as string));
    } else arrayPush(skipped, 'FontFaceSet');
  } catch { runtime.addFlag('hook-failed'); }
  try { method(realm, 'queryLocalFonts', 'DET-009', 'Window.queryLocalFonts', true); } catch { runtime.addFlag('hook-failed'); }
  // DET-010 global computed-style interception remains disabled pending its separate performance gate.
  runtime.attach(results);
  return { results, skipped };
}
