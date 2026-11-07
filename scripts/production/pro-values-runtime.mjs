// ADR-017 / REQ-002, REQ-005, REQ-011: fixed, bounded technical parameters only.
// These functions are embedded in each execution world; no cross-world global is exposed.
import { readProTechnicalRow, proTechnicalContractSource } from '../../packages/contracts/src/pro-technical-values.mjs';
function captureProIntrinsics() {
  const apply = Reflect.apply, define = Object.defineProperty, includes = Array.prototype.includes, test = RegExp.prototype.exec;
  const hasOwn = Object.hasOwn;
  const MapCtor = Map, SetCtor = Set, get = Map.prototype.get, set = Map.prototype.set, clear = Map.prototype.clear;
  const setHas = Set.prototype.has, add = Set.prototype.add, size = Object.getOwnPropertyDescriptor(Set.prototype, 'size').get;
  return { MapCtor, SetCtor, mapGet: (map, key) => apply(get, map, [key]), mapSet: (map, key, value) => apply(set, map, [key, value]), mapClear: map => apply(clear, map, []), setHas: (set, key) => apply(setHas, set, [key]), setAdd: (set, key) => apply(add, set, [key]), setSize: set => apply(size, set, []), descriptor: Object.getOwnPropertyDescriptor, keys: Reflect.ownKeys, finite: Number.isFinite, abs: Math.abs, is: Object.is, hasOwn, push: (array, value) => define(array, array.length, { __proto__: null, value, writable: true, configurable: true, enumerable: true }), includes: (array, value) => apply(includes, array, [value]), test: (pattern, value) => apply(test, pattern, [value]) !== null };
}
const proValueIntrinsics = captureProIntrinsics();
export function proValueFallback(operation, techniqueId, phase, value) {
  const surfaces = { 'HTMLCanvasElement.toDataURL': 'DET-001', 'HTMLCanvasElement.toBlob': 'DET-001', 'CanvasRenderingContext2D.getImageData': 'DET-002', 'CanvasRenderingContext2D.measureText': 'DET-003', 'OffscreenCanvasRenderingContext2D.measureText': 'DET-003', 'OffscreenCanvasRenderingContext2D.getImageData': 'DET-004', 'OffscreenCanvas.convertToBlob': 'DET-004' };
  if (typeof operation !== 'string' || !proValueIntrinsics.hasOwn(surfaces, operation) || surfaces[operation] !== techniqueId || !proValueIntrinsics.includes(['attempted', 'returned-sync', 'threw-sync', 'settlement-unobserved'], phase)) return null;
  if (!value || typeof value !== 'object' || proValueIntrinsics.keys(value).length !== 2 || proValueIntrinsics.descriptor(value, 'kind')?.value !== 'unobserved' || proValueIntrinsics.descriptor(value, 'reason')?.value !== 'sensitive') return null;
  return [{ operation, techniqueId, phase, value: { kind: 'unobserved', reason: 'sensitive' } }];
}
export function proValueParameters(operation, args) {
  const result = [];
  if (!args) return result;
  let numeric = 0, allowed = null;
  if (proValueIntrinsics.test(/^(?:CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D)\.getImageData$/, operation)) numeric = 4;
  else if (proValueIntrinsics.test(/^(?:WebGLRenderingContext|WebGL2RenderingContext)\.getParameter\./, operation)) numeric = 1;
  else if (operation === 'WebAssembly.Memory.grow') numeric = 1;
  else if (proValueIntrinsics.test(/^(?:HTMLCanvasElement|OffscreenCanvas)\.getContext$/, operation)) allowed = ['2d', 'webgl', 'webgl2', 'experimental-webgl', 'webgpu', 'bitmaprenderer'];
  else if (proValueIntrinsics.test(/^(?:RTCRtpSender|RTCRtpReceiver)\.getCapabilities$/, operation)) allowed = ['audio', 'video'];
  for (let index = 0; index < numeric && index < args.length; index++) {
    const value = args[index];
    if (typeof value === 'number' && proValueIntrinsics.finite(value) && proValueIntrinsics.abs(value) <= 2147483647) proValueIntrinsics.push(result, { name: 'arg' + index, kind: 'number', value: proValueIntrinsics.is(value, -0) ? 0 : value });
  }
  if (allowed && typeof args[0] === 'string' && proValueIntrinsics.includes(allowed, args[0])) proValueIntrinsics.push(result, { name: 'arg0', kind: 'string', value: args[0] });
  // Only primitive technical queries. Never measureText text, font sample text,
  // request bodies, arbitrary option objects, or any argument coercion.
  let queries = 0;
  if (operation === 'CSS.supports') queries = 2;
  else if (operation === 'Window.matchMedia' || operation === 'FontFaceSet.check' || operation === 'FontFaceSet.load' || operation === 'HTMLMediaElement.canPlayType' || operation === 'MediaSource.isTypeSupported' || operation === 'MediaRecorder.isTypeSupported' || operation === 'ImageDecoder.isTypeSupported') queries = 1;
  for (let index = 0; index < queries && index < args.length; index++) {
    const query = args[index];
    if (typeof query === 'string' && query.length <= 256 && !proValueIntrinsics.test(/[\u0000-\u001f\u007f]|(?:url\s*\(|(?:https?|data|blob|file):)/i, query)) proValueIntrinsics.push(result, { name: 'arg' + index, kind: 'string', value: query });
  }
  return result;
}

export function proValueKey(row) {
  const value = row.value;
  // Length prefixes distinguish delimiters inside already validated technical strings.
  const part = item => { const text = typeof item + ':' + item; return text.length + ':' + text; };
  let key = part(row.operation) + part(row.phase) + part(value.kind);
  if (value.kind === 'unobserved') key += part(value.reason);
  else if (value.kind === 'number-array') for (let index = 0; index < value.values.length; index++) key += part(value.values[index]);
  else if (value.kind === 'webrtc') {
    key += part(value.profile) + part(value.source) + part(value.truncated);
    for (let index = 0; index < value.fields.length; index++) { const field = value.fields[index]; key += part(field.name) + part(field.index) + part(field.value); }
  } else if (value.kind === 'technical') {
    key += part(value.profile) + part(value.truncated);
    for (let index = 0; index < value.fields.length; index++) { const field = value.fields[index]; key += part(field.name) + part(field.index) + part(field.kind) + part(field.value); }
  } else if (proValueIntrinsics.hasOwn(value, 'value')) key += part(value.value);
  for (let index = 0; index < row.parameters.length; index++) { const parameter = row.parameters[index]; key += part(parameter.name) + part(parameter.kind) + part(parameter.value); }
  return key;
}

// ADR-038: one API cannot fill the document budget with coordinate variants.
// Inputs are internal canonical rows; the state is cleared with each Pro session.
export function createProParameterBudget() {
  const native = proValueIntrinsics, states = new native.MapCtor();
  return {
    admit(row) {
      if (!row.parameters.length) return true;
      let key = '';
      for (let i = 0; i < row.parameters.length; i++) {
        const p = row.parameters[i], part = p.name + ':' + p.kind + ':' + p.value;
        key += part.length + ':' + part;
      }
      let known = native.mapGet(states, row.operation);
      if (known && native.setHas(known, key)) return true;
      if (known && native.setSize(known) >= 32) return false;
      if (!known) { known = new native.SetCtor(); native.mapSet(states, row.operation, known); }
      native.setAdd(known, key);
      return true;
    },
    reset() { native.mapClear(states); }
  };
}

export function proValueRows(value, validate) {
  try {
    const own = Object.getOwnPropertyDescriptor;
    if (!Array.isArray(value) || value.length > 256 || Reflect.ownKeys(value).length !== value.length + 1) return null;
    const rows = [], seen = new Set();
    let bytes = 512;
    for (let index = 0; index < value.length; index++) {
      const item = own(value, index)?.value;
      const names = ['operation', 'techniqueId', 'phase', 'value', 'parameters', 'count'];
      if (!item || typeof item !== 'object' || Reflect.ownKeys(item).length !== names.length || names.some(name => !Object.hasOwn(own(item, name) ?? {}, 'value'))) return null;
      const inputRow = { operation: own(item, 'operation').value, techniqueId: own(item, 'techniqueId').value, phase: own(item, 'phase').value, value: own(item, 'value').value };
      const base = readProTechnicalRow(inputRow) ?? validate([inputRow]) ?? proValueFallback(inputRow.operation, inputRow.techniqueId, inputRow.phase, inputRow.value);
      if (!base || base.length !== 1) return null;
      const count = own(item, 'count').value, input = own(item, 'parameters').value;
      if (!Number.isSafeInteger(count) || count < 1 || count > 2147483647 || !Array.isArray(input) || input.length > 4 || Reflect.ownKeys(input).length !== input.length + 1) return null;
      const parameters = [];
      for (let position = 0; position < input.length; position++) {
        const parameter = own(input, position)?.value;
        if (!parameter || typeof parameter !== 'object' || Reflect.ownKeys(parameter).length !== 3 || ['name', 'kind', 'value'].some(name => !Object.hasOwn(own(parameter, name) ?? {}, 'value'))) return null;
        parameters.push({ name: own(parameter, 'name').value, kind: own(parameter, 'kind').value, value: own(parameter, 'value').value });
      }
      // Reconstruct a primitive argument vector and apply the same allowlist as MAIN.
      const args = [];
      for (const parameter of parameters) {
        if (typeof parameter.name !== 'string' || !/^arg[0-3]$/.test(parameter.name) || (parameter.kind !== 'number' && parameter.kind !== 'string') || typeof parameter.value !== parameter.kind) return null;
        const index = Number(parameter.name.slice(3));
        if (Object.hasOwn(args, index)) return null;
        args[index] = parameter.value;
      }
      const canonical = proValueParameters(base[0].operation, args);
      if (canonical.length !== parameters.length || canonical.some((parameter, index) => parameter.name !== parameters[index].name || parameter.kind !== parameters[index].kind || !Object.is(parameter.value, parameters[index].value))) return null;
      const row = { ...base[0], parameters, count }, key = proValueKey(row);
      if (seen.has(key)) return null;
      seen.add(key);
      bytes += 256 + key.length * 2;
      if (bytes > 65536) return null;
      rows.push(row);
    }
    return rows;
  } catch {
    return null;
  }
}

export function proValueDocuments(value, validate) {
  try {
    if (!Array.isArray(value) || value.length > 24 || Reflect.ownKeys(value).length !== value.length + 1) return null;
    const result = [], seen = new Set();
    for (let index = 0; index < value.length; index++) {
      const item = Object.getOwnPropertyDescriptor(value, index)?.value;
      if (!item || typeof item !== 'object' || Reflect.ownKeys(item).length !== 3) return null;
      const documentKey = Object.getOwnPropertyDescriptor(item, 'documentKey')?.value;
      const truncated = Object.getOwnPropertyDescriptor(item, 'truncated')?.value;
      const rows = proValueRows(Object.getOwnPropertyDescriptor(item, 'rows')?.value, validate);
      if (typeof documentKey !== 'string' || !/^[A-Za-z0-9_:.-]{1,160}$/.test(documentKey) || typeof truncated !== 'boolean' || !rows || seen.has(documentKey)) return null;
      seen.add(documentKey);
      result.push({ documentKey, rows, truncated });
    }
    return result;
  } catch {
    return null;
  }
}

export const runtimeSource = proTechnicalContractSource + '\nvar proValueIntrinsics = (' + captureProIntrinsics.toString() + ')();\n' + [proValueFallback, proValueParameters, proValueKey, createProParameterBudget, proValueRows, proValueDocuments].map(fn => fn.toString()).join('\n\n');
