// ADR-059 / E22-10: fixed JavaScript surfaces, shared by observation and API Guard.
// Keep the original ten operation names first. Missing browser APIs stay missing.
const row = (feature, operation, target, owner, property, kind) => Object.freeze({
  feature: 'webassembly-' + feature, operation: 'WebAssembly.' + operation,
  target, ...(owner ? { owner } : {}), property, kind,
});
const namespace = (name, property, kind = 'call') => row(name, property, 'namespace', null, property, kind);
const constructor = name => namespace(name.toLowerCase().replace('error', '-error'), name, 'construct');
const member = (owner, property, kind = 'call', target = 'prototype') => row(
  owner.toLowerCase() + '-' + property.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()) + (kind === 'set' ? '-set' : ''),
  owner + '.' + property + (kind === 'set' ? '.set' : ''), target, owner, property, kind,
);
export const WASM_SURFACES = Object.freeze([
  namespace('compile', 'compile', 'async-call'),
  namespace('instantiate', 'instantiate', 'async-call'),
  namespace('compile-streaming', 'compileStreaming', 'async-call'),
  namespace('instantiate-streaming', 'instantiateStreaming', 'async-call'),
  namespace('validate', 'validate'),
  constructor('Module'), constructor('Instance'), constructor('Memory'),
  member('Memory', 'grow'), member('Memory', 'buffer', 'get'),
  member('Module', 'imports', 'call', 'static'),
  member('Module', 'exports', 'call', 'static'),
  member('Module', 'customSections', 'call', 'static'),
  member('Instance', 'exports', 'get'),
  constructor('Table'), member('Table', 'length', 'get'),
  member('Table', 'grow'), member('Table', 'get'), member('Table', 'set'),
  constructor('Global'), member('Global', 'valueOf'),
  member('Global', 'value', 'get'), member('Global', 'value', 'set'),
  constructor('Tag'), constructor('Exception'),
  member('Exception', 'is'), member('Exception', 'getArg'), member('Exception', 'stack', 'get'),
  constructor('CompileError'), constructor('LinkError'), constructor('RuntimeError'),
  constructor('Suspending'), namespace('promising', 'promising'), constructor('SuspendError'),
  member('Memory', 'toFixedLengthBuffer'), member('Memory', 'toResizableBuffer'),
  // Documented reflection API: conditional only; absent in the four audited browser versions.
  member('Tag', 'type'),
]);
export const WASM_OPERATION_DEFINITIONS = Object.freeze(WASM_SURFACES.map(({ operation, kind }) =>
  Object.freeze([operation, 'DET-065', 'wasm', kind])));
