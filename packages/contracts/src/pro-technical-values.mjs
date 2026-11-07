// ADR-039: explicit Pro recording only. Fixed browser-result fields, never object dumps.
export const PRO_TECHNICAL_OPERATIONS = {
  'Navigator.languages': ['languages', 'DET-025'],
  'Navigator.plugins': ['plugins', 'DET-027'],
  'Navigator.mimeTypes': ['mime-types', 'DET-027'],
  'NavigatorUAData.brands': ['ua-data', 'DET-026'],
  'NavigatorUAData.toJSON': ['ua-data', 'DET-026'],
  'Window.matchMedia': ['media-query', 'DET-037'],
  'Element.getBoundingClientRect': ['geometry', 'DET-005'],
  'Element.getClientRects': ['geometry', 'DET-005'],
  'Range.getBoundingClientRect': ['geometry', 'DET-006'],
  'Range.getClientRects': ['geometry', 'DET-006'],
  'SVGGraphicsElement.getBBox': ['geometry', 'DET-007'],
  'CanvasRenderingContext2D.measureText': ['text-metrics', 'DET-003'],
  'OffscreenCanvasRenderingContext2D.measureText': ['text-metrics', 'DET-003'],
  'WebGLRenderingContext.getSupportedExtensions': ['webgl-extensions', 'DET-011'],
  'WebGL2RenderingContext.getSupportedExtensions': ['webgl-extensions', 'DET-011'],
  ...Object.fromEntries(['Collator', 'DateTimeFormat', 'NumberFormat', 'PluralRules', 'RelativeTimeFormat', 'ListFormat', 'Segmenter', 'DisplayNames'].map(name => ['Intl.' + name + '.resolvedOptions', ['intl', 'DET-036']]))
};
export const PRO_TECHNICAL_FIELDS = {
  languages: { language: 'string' },
  plugins: { name: 'string', description: 'string', filename: 'string', length: 'number' },
  'mime-types': { type: 'string', description: 'string', suffixes: 'string' },
  'ua-data': { brand: 'string', version: 'string', mobile: 'boolean', platform: 'string' },
  'media-query': { media: 'string', matches: 'boolean' },
  geometry: Object.fromEntries(['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left'].map(name => [name, 'number'])),
  'text-metrics': Object.fromEntries(['width', 'actualBoundingBoxLeft', 'actualBoundingBoxRight', 'fontBoundingBoxAscent', 'fontBoundingBoxDescent', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent', 'emHeightAscent', 'emHeightDescent', 'hangingBaseline', 'alphabeticBaseline', 'ideographicBaseline'].map(name => [name, 'number'])),
  'webgl-extensions': { extension: 'string' },
  intl: {
    ...Object.fromEntries(['locale', 'usage', 'sensitivity', 'collation', 'caseFirst', 'calendar', 'numberingSystem', 'timeZone', 'hourCycle', 'weekday', 'era', 'year', 'month', 'day', 'dayPeriod', 'hour', 'minute', 'second', 'timeZoneName', 'dateStyle', 'timeStyle', 'style', 'currency', 'currencyDisplay', 'currencySign', 'unit', 'unitDisplay', 'notation', 'compactDisplay', 'signDisplay', 'roundingMode', 'roundingPriority', 'trailingZeroDisplay', 'type', 'pluralCategory', 'numeric', 'granularity', 'fallback', 'languageDisplay'].map(name => [name, 'string'])),
    ...Object.fromEntries(['fractionalSecondDigits', 'minimumIntegerDigits', 'minimumFractionDigits', 'maximumFractionDigits', 'minimumSignificantDigits', 'maximumSignificantDigits', 'roundingIncrement'].map(name => [name, 'number'])),
    ignorePunctuation: 'boolean', hour12: 'boolean', numeric: 'string|boolean', useGrouping: 'string|boolean'
  }
};
function captureTechnicalContractIntrinsics() {
  const apply = Reflect.apply, includes = Array.prototype.includes, define = Object.defineProperty, exec = RegExp.prototype.exec, own = Object.getOwnPropertyDescriptor, has = Object.hasOwn;
  return { own, keys: Reflect.ownKeys, has, array: Array.isArray, integer: Number.isSafeInteger, finite: Number.isFinite, is: Object.is,
    data: (object, name) => { const d = own(object, name); return d && has(d, 'value') ? d.value : undefined; },
    includes: (a, v) => apply(includes, a, [v]), push: (a, v) => define(a, a.length, { __proto__: null, value: v, writable: true, configurable: true, enumerable: true }), test: (re, v) => apply(exec, re, [v]) !== null };
}
const proTechnicalContractNative = captureTechnicalContractIntrinsics();
export function readProTechnicalValue(value, operation) {
  const n = proTechnicalContractNative;
  try {
    const expected = n.has(PRO_TECHNICAL_OPERATIONS, operation) ? PRO_TECHNICAL_OPERATIONS[operation] : null;
    if (!expected || !value || typeof value !== 'object' || n.keys(value).length !== 4) return null;
    const kind = n.data(value, 'kind'), profile = n.data(value, 'profile'), fields = n.data(value, 'fields'), truncated = n.data(value, 'truncated');
    if (kind !== 'technical' || profile !== expected[0] || typeof truncated !== 'boolean' || !n.array(fields) || fields.length > 128 || n.keys(fields).length !== fields.length + 1) return null;
    const allowed = PRO_TECHNICAL_FIELDS[profile], output = [], identities = [];
    let bytes = 256;
    for (let i = 0; i < fields.length; i++) {
      const field = n.data(fields, i);
      if (!field || typeof field !== 'object' || n.keys(field).length !== 4) return null;
      const name = n.data(field, 'name'), index = n.data(field, 'index'), type = n.data(field, 'kind'), item = n.data(field, 'value');
      if (typeof name !== 'string' || !n.has(allowed, name) || !n.integer(index) || index < 0 || index > 127 || typeof type !== 'string') return null;
      const expectedType = allowed[name], identity = name + ':' + index;
      if (n.includes(identities, identity)) return null;
      if (type === 'special-number') {
        if (expectedType !== 'number' || !n.includes(['NaN', 'Infinity', '-Infinity', '-0'], item)) return null;
      } else {
        if (type !== expectedType && !(expectedType === 'string|boolean' && (type === 'string' || type === 'boolean'))) return null;
        if (typeof item !== type) return null;
        if (type === 'string' && (item.length > 256 || n.test(/[\u0000-\u001f\u007f]/, item))) return null;
        if (type === 'number' && (!n.finite(item) || n.is(item, -0))) return null;
      }
      bytes += 64 + name.length * 2 + (typeof item === 'string' ? item.length * 2 : 16);
      if (bytes > 8192) return null;
      n.push(identities, identity); n.push(output, { name, index, kind: type, value: item });
    }
    return { kind: 'technical', profile, fields: output, truncated };
  } catch { return null; }
}
export function readProTechnicalRow(row) {
  const n = proTechnicalContractNative;
  try {
    if (!row || typeof row !== 'object' || n.keys(row).length !== 4) return null;
    const operation = n.data(row, 'operation'), techniqueId = n.data(row, 'techniqueId'), phase = n.data(row, 'phase');
    if (typeof operation !== 'string' || !n.has(PRO_TECHNICAL_OPERATIONS, operation) || PRO_TECHNICAL_OPERATIONS[operation][1] !== techniqueId || phase !== 'returned-sync') return null;
    const value = readProTechnicalValue(n.data(row, 'value'), operation);
    return value ? [{ operation, techniqueId, phase, value }] : null;
  } catch { return null; }
}
export const proTechnicalContractSource = 'var PRO_TECHNICAL_OPERATIONS = ' + JSON.stringify(PRO_TECHNICAL_OPERATIONS) + ';\nvar PRO_TECHNICAL_FIELDS = ' + JSON.stringify(PRO_TECHNICAL_FIELDS) + ';\nvar proTechnicalContractNative = (' + captureTechnicalContractIntrinsics.toString() + ')();\n' + readProTechnicalValue.toString() + '\n' + readProTechnicalRow.toString() + '\n';
