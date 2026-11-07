// ADR-078: a dated site association must never become observed detector evidence.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { lookupAutosurfSiteSystems, siteSystemsHostname } from '../../apps/production-extension/autosurf-site-systems.js';
import { createSiteSystemsUi } from '../../apps/production-extension/site-systems-ui.js';

const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  return { version: 1, revision: 'test-v1', publishedAt: '2026-10-13', countries: ['US'], categories: ['news'],
    trackingSourceId: 'publisher', trackingSnapshotAt: '2026-10-30',
    sources: [{ id: 'publisher', title: 'Publisher catalogue', url: 'https://publisher.example/catalog', license: 'Project-authored', asOf: '2026-10-30' }],
    trackingSystems: [{ id: 'forter', name: 'Forter', categories: ['fraud-prevention'], sourceUrl: 'https://publisher.example/forter' },
      { id: 'other-system', name: 'Other System', categories: ['bot-management'], sourceUrl: 'https://publisher.example/other' }],
    sites: [{ id: 'customer.example', name: 'Customer', origin: 'https://customer.example', countries: ['US'], categories: ['news'], rankBuckets: { US: 1000 }, trackingSystems: ['forter'] },
      { id: 'second.example', name: 'Second', origin: 'https://second.example', countries: [], categories: [], rankBuckets: {}, trackingSystems: ['other-system'] },
      { id: 'no-system.example', name: 'No system', origin: 'https://no-system.example', countries: ['US'], categories: ['news'], rankBuckets: { US: 1000 } }] };
}

function harness(loadCatalog) {
  const props = { host: 'customer.example', visible: true, locale: 'en' }, slots = [], effects = [];
  let cursor = 0, dirty = false, tree, disposed = false;
  const h = (type, attributes) => typeof type === 'function' ? type(attributes ?? {}) : { type, props: attributes ?? {} };
  const useState = initial => { const index = cursor++; if (!slots[index]) slots[index] = { value: initial }; return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; dirty = true; }]; };
  const useEffect = (effect, deps) => { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, offset) => value !== previous.deps[offset])) { previous?.cleanup?.(); const slot = slots[index] = { deps }; effects.push(() => { slot.cleanup = effect(); }); } };
  const { SiteSystemsCatalog } = createSiteSystemsUi({ h, useState, useEffect, useLocale: () => props.locale, translate: key => key === 'autosurf_sites_systems_catalog_title' ? 'Systems in the catalog' : key === 'autosurf_sites_catalog' ? props.locale === 'ru' ? 'Каталог' : 'Catalog' : key, loadCatalog });
  function render() { cursor = 0; dirty = false; tree = SiteSystemsCatalog(props); while (effects.length) effects.shift()(); }
  function nodes(predicate) { const found = []; const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!node?.props) return; if (predicate(node)) found.push(node); visit(node.props.children); }; visit(tree); return found; }
  async function settle() { for (let count = 0; count < 16; count++) { await Promise.resolve(); if (dirty && !disposed) render(); } }
  render();
  return { get tree() { return tree; }, nodes, settle, async update(value) { Object.assign(props, value); render(); await settle(); }, unmount() { disposed = true; for (const slot of slots) slot?.cleanup?.(); }, get dirty() { return dirty; } };
}

test('catalogue associations match only the exact selected hostname, with case and a terminal DNS dot normalized', () => {
  const data = fixture(), row = lookupAutosurfSiteSystems(data, 'CUSTOMER.EXAMPLE.');
  assert.equal(row.host, 'customer.example'); assert.equal(row.source.title, 'Publisher catalogue'); assert.equal(row.snapshotAt, '2026-10-30');
  assert.deepEqual(row.systems.map(system => system.id), ['forter']);
  for (const host of ['www.customer.example', 'nested.customer.example', 'customer.example.attacker.test', 'forter.com', 'customer-example.test', 'no-system.example']) assert.equal(lookupAutosurfSiteSystems(data, host), null, host);
});

test('hostname input excludes URLs, credentials, IPs, whitespace, ports and escaped or malformed names', () => {
  for (const value of [null, undefined, 1, {}, 'https://customer.example', 'user@customer.example', 'customer.example:443', 'customer.example/path', 'customer.example?q=x', ' customer.example', 'customer.example ', '127.0.0.1', '[::1]', 'customer..example', '-customer.example', 'customer.example..', 'customer%2eexample', 'a'.repeat(254) + '.com']) assert.equal(siteSystemsHostname(value), null, String(value));
  assert.equal(siteSystemsHostname('CUSTOMER.EXAMPLE.'), 'customer.example');
});

test('checked catalogue and exact-host index are immutable and do not change after caller mutation', () => {
  const data = fixture(), before = clone(data), row = lookupAutosurfSiteSystems(data, 'customer.example');
  assert.deepEqual(data, before); assert.ok(Object.isFrozen(row)); assert.ok(Object.isFrozen(row.systems)); assert.ok(Object.isFrozen(row.systems[0])); assert.ok(Object.isFrozen(row.source));
  data.sites[0].trackingSystems = ['other-system']; data.trackingSystems[0].name = 'Changed'; data.sources[0].title = 'Changed';
  data.trackingSystems = [];
  assert.equal(lookupAutosurfSiteSystems(data, 'customer.example'), row); assert.equal(row.systems[0].name, 'Forter'); assert.equal(row.source.title, 'Publisher catalogue');
  assert.throws(() => row.systems.push('other-system'), TypeError);
});

test('legacy data and missing provenance produce no external catalogue claim', () => {
  const old = fixture(); delete old.trackingSystems; delete old.trackingSourceId; delete old.trackingSnapshotAt;
  for (const site of old.sites) delete site.trackingSystems;
  assert.equal(lookupAutosurfSiteSystems(old, 'customer.example'), null);
  const noSource = fixture(); delete noSource.trackingSourceId; delete noSource.trackingSnapshotAt;
  assert.equal(lookupAutosurfSiteSystems(noSource, 'customer.example'), null);
});

test('invalid catalogue associations are rejected without building permissive partial results', () => {
  for (const mutate of [data => { data.sites[0].trackingSystems = ['missing']; }, data => { data.trackingSourceId = 'missing'; }, data => { data.trackingSnapshotAt = '2026-02-30'; }, data => { data.trackingSystems[0].sourceUrl = 'javascript:alert(1)'; }]) {
    const data = fixture(); mutate(data); assert.throws(() => lookupAutosurfSiteSystems(data, 'customer.example'), Error);
  }
});

test('ADR-103: catalogue systems are source-labelled cards in the recognized list, with local artwork and user-activated links', async () => {
  const h = harness(() => fixture()); await h.settle();
  assert.equal(h.tree.type, 'div'); assert.equal(h.tree.props['data-site-systems-catalog'], 'customer.example');
  assert.equal(h.nodes(node => node.props.children === 'Systems in the catalog').length, 0, 'no separate catalogue heading');
  for (const card of h.nodes(node => node.props['data-site-system-association'] !== undefined)) assert.equal(card.props.class, 'card--vendor card--catalog');
  assert.equal(h.nodes(node => node.type === 'time')[0].props.dateTime, '2026-10-30');
  assert.equal(h.nodes(node => node.props['data-site-system-association'] === 'forter').length, 1);
  assert.equal(h.nodes(node => node.type === 'img').length, 1); assert.match(h.nodes(node => node.type === 'img')[0].props.src, /\/icons\/brands\/forter\.png$/);
  assert.ok(h.nodes(node => node.type === 'a').every(node => node.props.rel === 'noopener noreferrer' && node.props.target === '_blank'));
  assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-vendor-id')).length, 0);
  h.unmount();
});

test('inspector preserves the dated exact-host catalogue and local artwork when publication links are absent', async () => {
  const data = fixture();
  data.sources = [{ id: 'publisher', title: 'Site catalogue', license: 'Proprietary', asOf: '2026-10-30' }];
  for (const system of data.trackingSystems) delete system.sourceUrl;
  const h = harness(() => data); await h.settle();
  assert.equal(h.tree.type, 'div'); assert.equal(h.tree.props['data-site-systems-catalog'], 'customer.example');
  assert.equal(h.nodes(node => node.type === 'time')[0].props.dateTime, '2026-10-30');
  assert.equal(h.nodes(node => node.type === 'span' && node.props.children === 'Site catalogue').length, h.nodes(node => node.props['data-site-system-association'] !== undefined).length, 'every card names its source');
  assert.equal(h.nodes(node => node.type === 'a').length, 0);
  assert.equal(h.nodes(node => Object.hasOwn(node.props, 'href')).length, 0);
  assert.equal(h.nodes(node => node.type === 'span' && node.props.class === 'site-systems-catalog__system').length, 1);
  assert.equal(h.nodes(node => node.type === 'img').length, 1);
  assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-vendor-id')).length, 0);
  h.unmount();
});

test('neutral dated inspector catalogue labels follow the active locale without adding source links', async () => {
  const data = fixture(); data.trackingSourceId = 'site-catalogue-20261030';
  data.sources = [{ id: data.trackingSourceId, title: 'Site catalogue', license: 'Proprietary', asOf: '2026-10-30' }];
  for (const system of data.trackingSystems) delete system.sourceUrl;
  const h = harness(() => data); await h.settle();
  assert.equal(h.nodes(node => node.type === 'span' && node.props.children === 'Catalog').length, 1);
  await h.update({ locale: 'ru' });
  assert.equal(h.nodes(node => node.type === 'span' && node.props.children === 'Каталог').length, 1);
  assert.equal(h.nodes(node => node.props.children === 'Site catalogue').length, 0);
  assert.equal(h.nodes(node => node.type === 'a').length, 0);
  assert.equal(h.nodes(node => node.type === 'time')[0].props.dateTime, '2026-10-30');
  h.unmount();
});

test('late catalogue completion cannot show a previous host after navigation or update an unmounted component', async () => {
  let resolve; const deferred = new Promise(done => { resolve = done; });
  const h = harness(() => deferred); await h.settle(); assert.equal(h.tree, null);
  await h.update({ host: 'second.example' }); resolve(fixture()); await h.settle();
  assert.equal(h.tree.props['data-site-systems-catalog'], 'second.example');
  assert.equal(h.nodes(node => node.props['data-site-system-association'] === 'forter').length, 0);
  await h.update({ host: 'no-system.example' }); assert.equal(h.tree, null); h.unmount();
  let finish; const pending = harness(() => new Promise(done => { finish = done; })); await pending.settle(); pending.unmount(); finish(fixture()); await pending.settle(); assert.equal(pending.dirty, false);
});

test('hidden, invalid-host, unmatched and failed catalogue states render no stale association', async () => {
  let calls = 0; const h = harness(() => { calls++; return fixture(); }); await h.settle();
  await h.update({ visible: false }); assert.equal(h.tree, null);
  await h.update({ host: 'https://customer.example' }); assert.equal(h.tree, null); assert.equal(calls, 1);
  await h.update({ visible: true }); assert.equal(h.tree, null); assert.equal(calls, 1);
  await h.update({ host: 'unknown.example' }); assert.equal(h.tree, null); assert.equal(calls, 2); h.unmount();
  const failed = harness(() => { throw new Error('unavailable'); }); await failed.settle(); assert.equal(failed.tree, null); failed.unmount();
});

test('additive shipped integration is reproducible and keeps associations outside observed vendor results and reports', () => {
  const checked = spawnSync(process.execPath, ['scripts/production/sync-site-systems-ui.mjs', '--check'], { cwd: new URL('../../', import.meta.url), encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  const precursor = spawnSync(process.execPath, ['scripts/production/sync-precursor-runtime.mjs', '--check'], { cwd: new URL('../../', import.meta.url), encoding: 'utf8' });
  assert.equal(precursor.status, 0, precursor.stderr || precursor.stdout);
  for (const file of ['popup', 'sidepanel']) {
    const source = readFileSync(new URL('../../apps/production-extension/' + file + '.js', import.meta.url), 'utf8');
    assert.equal(source.split('u3(SiteSystemsCatalog,').length - 1, 1);
    assert.ok(source.indexOf('u3(SiteSystemsCatalog,') > source.indexOf('function InspectorView('));
    assert.ok(source.includes('host: report2?.host ?? null, visible: mode.mode === "light" && session.loaded'));
  }
  const report = readFileSync(new URL('../../apps/production-extension/report.js', import.meta.url), 'utf8');
  assert.equal(report.includes('SiteSystemsCatalog'), false);
  const ui = readFileSync(new URL('../../apps/production-extension/site-systems-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /import\s*\{\s*AUTOSURF_SITES_DATA\s*\}\s*from\s*['"]\.\/autosurf-sites-data\.js['"]/); assert.doesNotMatch(ui, /\bimport\s*\(|\bfetch\s*\(|sendMessage|\.vendors\b/);
});
