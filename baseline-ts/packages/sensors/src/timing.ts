// DET-066 / REQ-001/002/005/011 / ADR-019: owner-requested passive timing API observations.
// No duration, timestamp, mark name, entries or benchmark result is inspected or retained.
import { PHASE_INDEX, SIGNAL_BIT, TECHNIQUE_INDEX } from './codes';
import { arrayPush } from './intrinsics';
import type { SensorRuntime } from './runtime';
import { wrapOutcomeMethod } from './wrap';
import type { WrapResult } from './wrap';

const descriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (value: object, key: string) => boolean;
const TECHNIQUE = TECHNIQUE_INDEX['DET-066'];
const API = SIGNAL_BIT['api-use'];
const RETURNED = PHASE_INDEX['returned-sync'];
const THREW = PHASE_INDEX['threw-sync'];

function dataObject(owner: object, key: string): object | null {
  const d = descriptor(owner, key);
  if (!d || !hasOwn(d, 'value')) return null;
  const value: unknown = d.value;
  return (typeof value === 'object' && value !== null) || typeof value === 'function' ? value : null;
}

export function installTimingSensor(runtime: SensorRuntime, realm: object = globalThis): { results: WrapResult[]; skipped: string[] } {
  const results: WrapResult[] = [];
  const skipped: string[] = [];
  if (!runtime.hooks.enabled) return { results, skipped };
  const method = (target: object, name: string, sampled: boolean): void => {
    try {
      if (!descriptor(target, name)) { arrayPush(skipped, name); return; }
      // Two 6-bit counters per sampled API, no clock reads or allocation in the sampling decision.
      // First outcome of each phase is visible; after that, one in every 64 is counted.
      let returned = 0;
      let thrown = 0;
      const result = wrapOutcomeMethod(target, name, (threw) => {
        if (sampled) {
          if (threw) { const take = thrown === 0; thrown = (thrown + 1) & 63; if (!take) return; }
          else { const take = returned === 0; returned = (returned + 1) & 63; if (!take) return; }
          runtime.recordSampled(TECHNIQUE, threw ? THREW : RETURNED, API);
        } else runtime.record(TECHNIQUE, threw ? THREW : RETURNED, API);
      }, { context: runtime.hooks });
      arrayPush(results, result);
      runtime.attach([result]);
    } catch { runtime.addFlag('hook-failed'); }
  };
  try {
    const constructor = dataObject(realm, 'Performance');
    const prototype = constructor && dataObject(constructor, 'prototype');
    if (prototype) {
      method(prototype, 'now', true);
      for (const name of ['mark', 'measure', 'getEntries', 'getEntriesByName', 'getEntriesByType']) method(prototype, name, false);
    } else arrayPush(skipped, 'Performance');
  } catch { runtime.addFlag('hook-failed'); }
  try {
    const constructor = dataObject(realm, 'Date');
    if (constructor) method(constructor, 'now', true);
    else arrayPush(skipped, 'Date');
  } catch { runtime.addFlag('hook-failed'); }
  return { results, skipped };
}
