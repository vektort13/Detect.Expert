// Owned page calls only. Expected values come from the actual browser return values.
import assert from 'node:assert/strict';

export function readOwnedTechnicalValues(width) {
  const expected = [];
  const field = (operation, name, value, index = 0) => {
    // Preserve the page engine's display before WebDriver's JSON transport can
    // round a binary64 number by one ULP on its way to the Node test process.
    if (['string', 'number', 'boolean'].includes(typeof value)) expected.push({ operation, name, value, index,
      display: typeof value === 'string' ? JSON.stringify(value) : Object.is(value, -0) ? '-0' : String(value) });
  };
  navigator.languages.forEach((value, index) => field('Navigator.languages', 'language', value, index));
  const options = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dubai', hour: 'numeric', minute: 'numeric' }).resolvedOptions();
  Object.entries(options).forEach(([name, value]) => field('Intl.DateTimeFormat.resolvedOptions', name, value));
  const node = document.createElement('div'); node.style.cssText = `width:${width}px;height:43px;position:absolute;left:17px;top:31px`;
  document.body.append(node);
  const rect = node.getBoundingClientRect();
  for (const name of ['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left']) field('Element.getBoundingClientRect', name, rect[name]);
  node.remove();
  const metrics = document.createElement('canvas').getContext('2d').measureText('Owned fixture');
  for (const name of ['width', 'actualBoundingBoxLeft', 'actualBoundingBoxRight', 'fontBoundingBoxAscent', 'fontBoundingBoxDescent', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent', 'emHeightAscent', 'emHeightDescent', 'hangingBaseline', 'alphabeticBaseline', 'ideographicBaseline']) field('CanvasRenderingContext2D.measureText', name, metrics[name]);
  const plugins = navigator.plugins;
  if (plugins.length) for (const name of ['name', 'description', 'filename', 'length']) field('Navigator.plugins', name, plugins[0][name]);
  const mimeTypes = navigator.mimeTypes;
  if (mimeTypes.length) for (const name of ['type', 'description', 'suffixes']) field('Navigator.mimeTypes', name, mimeTypes[0][name]);
  if (navigator.userAgentData) {
    const data = navigator.userAgentData.toJSON();
    field('NavigatorUAData.toJSON', 'mobile', data.mobile); field('NavigatorUAData.toJSON', 'platform', data.platform);
    data.brands.forEach((item, index) => { field('NavigatorUAData.toJSON', 'brand', item.brand, index); field('NavigatorUAData.toJSON', 'version', item.version, index); });
  }
  const media = matchMedia('(min-width: 1px)');
  field('Window.matchMedia', 'media', media.media); field('Window.matchMedia', 'matches', media.matches);
  void navigator.userAgent; void navigator.hardwareConcurrency; void window.innerWidth;
  return expected;
}

export function assertTechnicalValues(session, samples, summary) {
  const saved = session.pages.flatMap(page => (page.apiValues ?? []).flatMap(document => document.rows));
  let checked = 0;
  for (const sample of samples) for (const expected of sample) {
    const canonical = Object.is(expected.value, -0) ? '-0' : expected.value;
    assert.ok(saved.some(row => row.operation === expected.operation && row.value.kind === 'technical' && row.value.fields.some(field => field.name === expected.name && field.index === expected.index && Object.is(field.value, canonical))), 'actual browser result retained: ' + JSON.stringify(expected));
    const display = expected.display ?? (typeof expected.value === 'string' ? JSON.stringify(expected.value) : String(canonical));
    assert.ok(summary.some(row => row[1].startsWith(expected.operation) && row[1].endsWith('.' + expected.name + '[' + expected.index + ']') && row[2] === display), 'actual browser result appears in the three-column summary: ' + JSON.stringify(expected));
    checked++;
  }
  return { checked, operations: [...new Set(samples.flat().map(item => item.operation))], visits: session.pages.length, documents: session.pages.flatMap(page => page.apiValues ?? []).length };
}
