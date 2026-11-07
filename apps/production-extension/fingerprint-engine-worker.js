// ADR-101: packaged, private bootstrap for newly paused dedicated Worker targets.
import { validateApiConfiguration } from './api-configuration.js';
import { installApiCustom } from './api-custom-runtime.js';
import { installIntlCustom } from './api-custom-intl-runtime.js';
import { installMathCustom } from './api-custom-math-runtime.js';
import { installCanvasCustom } from './api-custom-canvas-runtime.js';
import { installSurfaceCustom } from './api-custom-surfaces-runtime.js';

const sources = new WeakMap();
const BASE = new Set(['hardware-concurrency', 'device-memory', 'navigator-user-agent', 'navigator-platform', 'navigator-app-version', 'navigator-vendor', 'navigator-oscpu', 'navigator-language', 'navigator-languages', 'client-hints', 'network-information', 'storage-estimate', 'media-capabilities', 'webgl', 'webgpu', 'timezone']);
const SURFACES = new Set(['webgl-capabilities', 'webgpu-capabilities', 'canvas-text-metrics', 'audio-fingerprint', 'audio-metadata', 'clock-precision', 'canvas-font-policy', 'browser-surface', 'webgl-readback']);
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const literal = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
function hostValid(host) { try { return typeof host === 'string' && host.length <= 253 && /^[a-z0-9.:[\]-]+$/.test(host) && !host.includes('..') && !host.endsWith('.') && new URL('https://' + host + '/').hostname === host; } catch { return false; } }

// Legacy Math/Canvas installers intentionally expose no stop handle. The managed
// Worker alone retains a private, ownership-checked descriptor ledger around them.
function installPrivateWorkerPatches(realm, entries, mathInstaller, canvasInstaller) {
  const getOwn = Object.getOwnPropertyDescriptor, getPrototype = Object.getPrototypeOf, define = Object.defineProperty, create = Object.create, freeze = Object.freeze;
  const handles = [], fields = ['value', 'writable', 'get', 'set', 'enumerable', 'configurable'];
  const own = (object, key) => { if (object === null || typeof object !== 'object' && typeof object !== 'function') return undefined; const field = getOwn(object, key); return field && getOwn(field, 'value') ? field.value : undefined; };
  function copy(descriptor) { const result = create(null); for (let index = 0; index < fields.length; index++) { const field = getOwn(descriptor, fields[index]); if (field) result[fields[index]] = field.value; } return freeze(result); }
  function same(left, right) { if (!left || !right) return false; for (let index = 0; index < fields.length; index++) { const a = getOwn(left, fields[index]), b = getOwn(right, fields[index]); if (!!a !== !!b || a && a.value !== b.value) return false; } return true; }
  function remember(target, key) {
    for (let depth = 0; target && depth < 16; depth++, target = getPrototype(target)) {
      const descriptor = getOwn(target, key); if (!descriptor) continue;
      for (let index = 0; index < handles.length; index++) if (handles[index].target === target && handles[index].key === key) return;
      handles.push({ target, key, original: copy(descriptor), installed: null }); return;
    }
  }
  let math = false, canvas = false, stopped = false;
  for (let index = 0; index < entries.length; index++) {
    const row = entries[index];
    if (row.id === 'math-transcendentals') { math = true; for (let item = 0; item < row.value.functions.length; item++) remember(own(realm, 'Math'), row.value.functions[item]); }
    if (row.id === 'canvas-readback') canvas = true;
  }
  if (canvas) for (const [name, keys] of [['OffscreenCanvas', ['getContext', 'convertToBlob']], ['OffscreenCanvasRenderingContext2D', ['getImageData']], ['HTMLCanvasElement', ['getContext', 'toDataURL', 'toBlob']], ['CanvasRenderingContext2D', ['getImageData']]]) {
    const prototype = own(own(realm, name), 'prototype'); for (let index = 0; index < keys.length; index++) remember(prototype, keys[index]);
  }
  function seal() { for (let index = 0; index < handles.length; index++) { const field = getOwn(handles[index].target, handles[index].key); handles[index].installed = field ? copy(field) : null; } }
  function stop() { if (stopped) return; stopped = true; for (let index = handles.length - 1; index >= 0; index--) { const handle = handles[index]; try { if (same(getOwn(handle.target, handle.key), handle.installed)) define(handle.target, handle.key, handle.original); } catch { /* A later Worker program owns its changed/frozen descriptor. */ } } }
  try { if (math) mathInstaller(realm, entries); if (canvas) canvasInstaller(realm, entries); }
  catch (error) { seal(); stop(); throw error; }
  seal(); return freeze({ stop });
}

/** Returns an opaque local capability, never source accepted from a UI message. */
export function prepareFingerprintWorkerSource(input, options = {}) {
  const checked = validateApiConfiguration(input);
  if (!checked.ok) throw new TypeError('Invalid fingerprint Worker configuration');
  if (!options || typeof options !== 'object' || Array.isArray(options) || Reflect.ownKeys(options).some(key => !['host', 'mathSeed', 'canvasSeed'].includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key), 'value'))) throw new TypeError('Invalid fingerprint Worker options');
  const host = own(options, 'host') ?? null;
  if (host !== null && !hostValid(host)) throw new TypeError('Invalid fingerprint Worker host');
  const config = checked.value, site = host === null ? null : config.sites.find(row => row.host === host), entries = [];
  if (config.antidetectEnabled && !site?.disabled) for (const global of config.apis) {
    const local = site?.apis.find(row => row.id === global.id), row = local && local.mode !== 'bypass' ? local : global;
    if (row.mode !== 'custom' || !BASE.has(row.id) && !SURFACES.has(row.id) && !['intl-formatting', 'math-transcendentals', 'canvas-readback'].includes(row.id)) continue;
    const value = row.selected.kind === 'value' ? row.selected.value : row.selected.kind === 'null' ? null : undefined;
    if (row.id === 'math-transcendentals' && !value.functions.length) continue;
    const entry = { id: row.id, mode: 'custom', value };
    if (row.id === 'math-transcendentals' || row.id === 'canvas-readback') {
      const key = row.id === 'math-transcendentals' ? 'mathSeed' : 'canvasSeed', seed = own(options, key);
      if (typeof seed !== 'string' || !/^[a-f0-9]{64}$/.test(seed)) throw new TypeError('Fingerprint Worker profile requires a persisted seed');
      entry[key] = seed;
    }
    entries.push(entry);
  }
  const zone = entries.find(row => row.id === 'timezone')?.value?.timeZone;
  const intl = entries.find(row => row.id === 'intl-formatting');
  if (intl && intl.value.timeZone === undefined && typeof zone === 'string') intl.value = { ...intl.value, timeZone: zone };
  const extended = [...SURFACES, 'intl-formatting', 'math-transcendentals', 'canvas-readback'];
  const source = '(() => { "use strict";\n' +
    'const entries=' + literal(entries) + ', guards=[];\n' +
    'const extended=' + literal(extended) + ';\n' +
    'const baseEntries=entries.filter(row=>!extended.includes(row.id)).map(row=>row.id==="timezone"&&entries.some(item=>item.id==="intl-formatting")?{...row,dateOffsetOnly:true}:row);\n' +
    'const stop=()=>{for(let index=guards.length-1;index>=0;index--){try{guards[index].stop();}catch{}}};\n' +
    'let intlGuard=null; try {\n' +
    (entries.some(row => SURFACES.has(row.id)) ? 'guards.push((' + installSurfaceCustom.toString() + ')(globalThis,entries));\n' : '') +
    (intl || typeof zone === 'string' ? 'intlGuard=(' + installIntlCustom.toString() + ')(globalThis,entries);guards.push(intlGuard);\n' : '') +
    (entries.some(row => BASE.has(row.id)) ? 'guards.push((' + installApiCustom.toString() + ')(globalThis,baseEntries,intlGuard?.nativeContext));\n' : '') +
    (entries.some(row => row.id === 'math-transcendentals' || row.id === 'canvas-readback') ? 'guards.push((' + installPrivateWorkerPatches.toString() + ')(globalThis,entries,' + (entries.some(row => row.id === 'math-transcendentals') ? '(' + installMathCustom.toString() + ')' : 'null') + ',' + (entries.some(row => row.id === 'canvas-readback') ? '(' + installCanvasCustom.toString() + ')' : 'null') + '));\n' : '') +
    '} catch { stop(); throw new Error("Fingerprint Worker bootstrap failed"); }\n' +
    'return Object.freeze({stop});\n})()';
  const capability = Object.freeze({ kind: 'fingerprint-worker-bootstrap', entryCount: entries.length });
  sources.set(capability, source);
  return capability;
}

// Only the background driver imports this reader. Public data cannot recreate a capability.
export function readFingerprintWorkerSource(capability) { return sources.get(capability) ?? null; }
