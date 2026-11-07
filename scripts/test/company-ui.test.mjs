// REQ-002/010/013, ADR-034: identity attribution and the actual print readiness boundary.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCompanyUi, waitForCompanyImages } from '../../apps/production-extension/company-ui.js';
import { companyBrand, COMPANY_BRANDS } from '../../apps/production-extension/company-branding.js';
import { cookieCompanyMark } from '../../apps/production-extension/cookie-branding.js';

const h = (type, props) => ({ type, props });
const { CompanyLabel } = createCompanyUi({ h });
const imagesOf = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(imagesOf)
  : [...(node.type === 'img' ? [node] : []), ...imagesOf(node.props.children)];
const documentWith = images => ({ querySelectorAll: () => images });
const image = changes => ({ complete: true, naturalWidth: 32, naturalHeight: 32, ...changes });

test('unregistered, generic and deceptive labels cannot select a company image', () => {
  for (const label of ['', '__proto__', 'Google impostor', 'Google Analytics fake', 'https://google.com/private', 'Site consent manager (Cookiebot convention)', 'Catalogue name match: Google — description', 'Vendor declaration: Unregistered company']) {
    assert.equal(companyBrand(label), null, label);
    assert.equal(imagesOf(CompanyLabel({ name: label })).length, 0, label);
  }
  let reads = 0;
  const hostile = { get toString() { reads++; throw Error('coercion'); } };
  assert.equal(companyBrand(hostile), null); assert.equal(reads, 0);
});
test('known company image is decorative and preserves the supplied accessible label', () => {
  const label = 'Google Analytics 4', rendered = CompanyLabel({ name: label, identity: 'google-analytics' });
  const images = imagesOf(rendered); assert.equal(images.length, 1); assert.equal(images[0].props.alt, '');
  assert.equal(images[0].props.loading, 'eager'); assert.equal(rendered.props.children[1].props.children, label);
  assert.equal(rendered.props['data-company-role'], 'company');
});
test('exact declaration aliases keep declarant identity separate from manufacturer marks', () => {
  const brand = COMPANY_BRANDS.find(brand => brand.declarantAliases?.length);
  assert.ok(brand); const label = brand.declarantAliases[0], resolved = companyBrand(label);
  assert.equal(resolved.id, brand.id); assert.equal(resolved.role, 'declarant'); assert.equal(cookieCompanyMark(label).src, null);
  assert.equal(companyBrand(label + ' unrelated'), null);
  const rendered = CompanyLabel({ name: label, identity: label }); assert.equal(rendered.props['data-company-role'], 'declarant');
  assert.equal(rendered.props.children[1].props.children, label); assert.equal(imagesOf(rendered).length, 1);
});
test('print readiness accepts an empty report and already decoded logo images', async () => {
  assert.equal(await waitForCompanyImages(documentWith([])), true);
  assert.equal(await waitForCompanyImages(documentWith([image()])), true);
});
test('print waits for cold images to decode', async () => {
  let finish; const cold = image({ complete: false, naturalWidth: 0, naturalHeight: 0 });
  cold.decode = () => new Promise(resolve => { finish = () => { Object.assign(cold, image()); resolve(); }; });
  let settled = false; const result = waitForCompanyImages(documentWith([cold]), 1000).then(value => { settled = true; return value; });
  await Promise.resolve(); assert.equal(settled, false); finish(); assert.equal(await result, true);
});
test('a corrupt logo prevents printing a silently incomplete report', async () => {
  const broken = image({ complete: false, decode: () => Promise.reject(Error('decode')) });
  assert.equal(await waitForCompanyImages(documentWith([image(), broken])), false);
});

test('print readiness includes neutral system marks without company identity attributes', async () => {
  const documentForSystem = mark => ({ querySelectorAll: selector => selector.split(',').map(part => part.trim()).includes('img[data-system-logo]') ? [mark] : [] });
  const neutral = image({ dataset: { systemLogo: 'owned-neutral-system', systemIconKind: 'generic' } });
  assert.equal(await waitForCompanyImages(documentForSystem(neutral)), true);
  let finish;
  const pending = image({ ...neutral, complete: false, naturalWidth: 0, naturalHeight: 0,
    decode: () => new Promise(resolve => { finish = () => { Object.assign(pending, image()); resolve(); }; }) });
  let settled = false;
  const waiting = waitForCompanyImages(documentForSystem(pending), 1000).then(value => { settled = true; return value; });
  await Promise.resolve(); assert.equal(settled, false); finish(); assert.equal(await waiting, true);
  const broken = image({ ...neutral, complete: false, decode: async () => { throw Error('corrupt-neutral-mark'); } });
  assert.equal(await waitForCompanyImages(documentForSystem(broken)), false);
});
test('decoded but empty logo is not printable', async () => {
  const empty = image({ naturalWidth: 0, naturalHeight: 0, decode: () => Promise.resolve() });
  assert.equal(await waitForCompanyImages(documentWith([empty])), false);
});

test('decoded packaged SVG remains printable when Firefox reports zero intrinsic dimensions', async () => {
  const vector = image({ naturalWidth: 0, naturalHeight: 0, currentSrc: companyBrand('Google').src,
    decode: async () => {}, getBoundingClientRect: () => ({ width: 20, height: 20 }) });
  assert.equal(await waitForCompanyImages(documentWith([vector])), true);
});

test('zero-intrinsic SVG exception excludes unknown sources, failed decode, hidden vectors and empty PNGs', async () => {
  const svg = companyBrand('Google').src;
  const png = new URL('../../apps/production-extension/icons/brands/' + COMPANY_BRANDS.find(brand => brand.file.endsWith('.png')).file, import.meta.url).href;
  const base = { naturalWidth: 0, naturalHeight: 0, currentSrc: svg, decode: async () => {}, getBoundingClientRect: () => ({ width: 20, height: 20 }) };
  for (const changes of [
    { currentSrc: svg + '?changed' }, { currentSrc: svg + '#changed' }, { currentSrc: 'https://example.com/logo.svg' },
    { currentSrc: svg.replace('google.svg', 'unknown.svg') }, { currentSrc: png }, { currentSrc: 'data:image/svg+xml,<svg/>' },
    { decode: async () => { throw Error('corrupt'); } }, { getBoundingClientRect: () => ({ width: 0, height: 20 }) },
    { complete: false }, { decode: undefined, addEventListener() {}, removeEventListener() {} }
  ]) assert.equal(await waitForCompanyImages(documentWith([image({ ...base, ...changes })]), 5), false);
});
test('print readiness has a deadline even when the native decoder never resolves', async () => {
  assert.equal(await waitForCompanyImages(documentWith([image({ complete: false, decode: () => new Promise(() => {}) })]), 5), false);
});
test('load-event fallback removes listeners after completion', async () => {
  const listeners = new Map(), cold = image({ complete: false, naturalWidth: 0, naturalHeight: 0,
    addEventListener(type, handler) { listeners.set(type, handler); }, removeEventListener(type) { listeners.delete(type); } });
  const result = waitForCompanyImages(documentWith([cold]), 1000); Object.assign(cold, image()); listeners.get('load')();
  assert.equal(await result, true); assert.equal(listeners.size, 0);
});
test('load-event fallback removes listeners after timeout', async () => {
  const listeners = new Map(), cold = image({ complete: false, addEventListener(type, handler) { listeners.set(type, handler); }, removeEventListener(type) { listeners.delete(type); } });
  assert.equal(await waitForCompanyImages(documentWith([cold]), 5), false); assert.equal(listeners.size, 0);
});
test('over-budget or faulty trusted UI image list cannot leave print pending', async () => {
  assert.equal(await waitForCompanyImages(documentWith(Array(32769).fill(image()))), false);
  assert.equal(await waitForCompanyImages({ querySelectorAll() { throw Error('DOM'); } }), false);
});
