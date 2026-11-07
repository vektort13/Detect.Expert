// ADR-034/078: system marks are exact presentation identities, never detector evidence.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUTOSURF_SITES_DATA } from '../../apps/production-extension/autosurf-sites-data.js';
import { SYSTEM_BRANDS, systemBrand } from '../../apps/production-extension/system-branding.js';
import { companyBrand } from '../../apps/production-extension/company-branding.js';
import { createSystemMarkUi } from '../../apps/production-extension/system-mark-ui.js';

const { SystemMark, SystemLabel } = createSystemMarkUi({ h: (type, props) => ({ type, props }) });
const nodes = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes)
  : [value, ...nodes(value.props?.children)];

test('every tracking system has an exact reusable packaged mark by id and display name', () => {
  assert.equal(SYSTEM_BRANDS.length, AUTOSURF_SITES_DATA.trackingSystems.length);
  assert.ok(SYSTEM_BRANDS.length > 200);
  const ids = new Set(), aliases = new Map();
  for (const system of AUTOSURF_SITES_DATA.trackingSystems) {
    const mark = systemBrand(system.id);
    assert.ok(mark, system.id); assert.equal(mark.id, system.id); assert.equal(mark.name, system.name);
    assert.strictEqual(systemBrand(system.name), mark); assert.ok(Object.isFrozen(mark));
    assert.equal(ids.has(mark.id), false, mark.id); ids.add(mark.id);
    assert.match(mark.asset, /^(?:brands|systems)\/[a-z0-9][a-z0-9.-]*\.(?:svg|png|ico|jpg|jpeg|webp|gif)$/);
    assert.equal(mark.src, new URL('../../apps/production-extension/icons/' + mark.asset, import.meta.url).href);
    assert.ok(['brand', 'generic'].includes(mark.kind));
  }
  for (const entry of SYSTEM_BRANDS) for (const label of [entry.id, entry.name, ...(entry.aliases ?? [])]) {
    const key = label.trim().toLowerCase();
    assert.ok(!aliases.has(key) || aliases.get(key) === entry.id, label); aliases.set(key, entry.id);
    assert.equal(systemBrand(' ' + label.toUpperCase() + ' ').id, entry.id);
  }
});

test('unknown, deceptive and untrusted identities cannot select a mark or run coercion', () => {
  for (const value of [null, undefined, {}, [], 7, new String('forter'), '', '__proto__', 'constructor',
    'forter.com', 'https://forter.com/', 'Forter fake', 'fake-forter', 'forter/../datadome',
    'Vendor declaration: Forter', 'x'.repeat(257)]) assert.equal(systemBrand(value), null);
  let reads = 0;
  const hostile = { get toString() { reads++; throw Error('coercion'); } };
  assert.equal(systemBrand(hostile), null); assert.equal(reads, 0);
});

test('product identities stay distinct when they display the same company artwork', () => {
  for (const ids of [['akamai-bot-manager', 'akamai-page-integrity-manager'],
    ['cloudflare-bot-manager', 'cloudflare-insights', 'cloudflare-turnstile']]) {
    const marks = ids.map(systemBrand);
    assert.ok(marks.every(Boolean)); assert.deepEqual(marks.map(mark => mark.id), ids);
    assert.equal(new Set(marks).size, ids.length);
  }
  assert.notEqual(systemBrand('transunion').src, companyBrand('iovation').src,
    'the parent company must not inherit its subsidiary artwork from an unrelated legacy alias');
});

test('shared system images are decorative, bounded and use the same asset in every surface', () => {
  const mark = systemBrand('forter'), icon = SystemMark({ identity: 'forter', className: 'owned-icon' });
  assert.equal(icon.type, 'img'); assert.equal(icon.props.src, mark.src); assert.equal(icon.props.alt, '');
  assert.equal(icon.props['aria-hidden'], true); assert.equal(icon.props.width, 20); assert.equal(icon.props.height, 20);
  assert.equal(icon.props.loading, 'lazy'); assert.equal(icon.props.decoding, 'async'); assert.equal(icon.props.draggable, false);
  assert.equal(icon.props['data-system-logo'], 'forter'); assert.equal(icon.props['data-company-logo'], 'forter');
  assert.equal(SystemMark({ identity: 'forter', size: 900 }).props.width, 20);
  const label = SystemLabel({ name: 'Supplied accessible name', identity: 'forter', size: 'large' });
  assert.equal(label.props.class, 'company-label company-label--large');
  const image = nodes(label).find(node => node.type === 'img');
  assert.equal(image.props.src, mark.src); assert.equal(image.props.width, 28); assert.equal(image.props.height, 28);
  assert.equal(image.props.loading, 'eager');
  assert.equal(nodes(label).find(node => node.type === 'bdi').props.children, 'Supplied accessible name');
});

test('unknown and generic systems receive a neutral mark without a fabricated company identity', () => {
  const icon = SystemMark({ identity: 'owned-unregistered-system', className: 'owned-icon' });
  assert.equal(icon.type, 'svg'); assert.equal(icon.props['data-system-fallback'], true);
  assert.equal(icon.props['aria-hidden'], true); assert.equal(icon.props.focusable, false);
  assert.equal(icon.props['data-company-logo'], undefined); assert.equal(nodes(icon).filter(node => node.type === 'text').length, 0);
  const label = SystemLabel({ name: 'Owned system', identity: 'owned-unregistered-system' });
  assert.equal(label.props['data-company-brand'], undefined);
  assert.equal(nodes(label).find(node => node.type === 'bdi').props.children, 'Owned system');
  const generic = SYSTEM_BRANDS.find(mark => mark.kind === 'generic');
  if (generic) {
    const neutral = SystemMark({ identity: generic.id });
    assert.equal(neutral.type, 'img'); assert.equal(neutral.props['data-system-icon-kind'], 'generic');
    assert.equal(neutral.props['data-company-logo'], undefined);
    assert.equal(SystemLabel({ name: generic.name, identity: generic.id }).props['data-company-brand'], undefined);
  }
});
