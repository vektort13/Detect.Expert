// ADR-078: deterministic offline projection into the one shared site catalogue.
import assert from 'node:assert/strict';
import { validateAutosurfSitesData } from '../apps/production-extension/autosurf-sites.js';

function plainJson(value, budget = { nodes: 0 }) {
  assert.ok(++budget.nodes <= 5000000, 'Tracking input exceeds node budget');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { assert.ok(Number.isFinite(value)); return; }
  assert.equal(typeof value, 'object', 'Tracking inputs must be JSON data');
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  assert.ok(array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null, 'Tracking input prototype');
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  assert.ok(keys.every(key => typeof key === 'string' && Object.hasOwn(descriptors[key], 'value')), 'Tracking input accessors');
  if (array) {
    assert.ok(keys.length === descriptors.length.value + 1 && descriptors.length.value <= 50000, 'Tracking input array');
    for (let i = 0; i < descriptors.length.value; i++) assert.ok(Object.hasOwn(descriptors, String(i)), 'Tracking input sparse array');
  }
  for (const key of keys) {
    assert.ok(!['__proto__', 'prototype', 'constructor'].includes(key), 'Tracking input reserved key');
    if (array && key === 'length') continue;
    assert.ok(descriptors[key].enumerable, 'Tracking input descriptor');
    plainJson(descriptors[key].value, budget);
  }
}

export function mergeAutosurfTrackingSites(base, input) {
  if (input === null) return base;
  plainJson(input);
  assert.deepEqual(Object.keys(input).sort(), ['sites', 'snapshotAt', 'source', 'systems', 'version']);
  assert.equal(input.version, 1);
  assert.ok(Array.isArray(input.systems) && input.systems.length <= 500);
  assert.ok(Array.isArray(input.sites) && input.sites.length <= 50000);
  assert.match(input.snapshotAt, /^\d{4}-\d{2}-\d{2}$/);
  const sites = new Map(base.sites.map(site => [site.id, { ...site }]));
  const systemIds = new Set(input.systems.map(system => system.id));
  const seen = new Set();
  for (const association of input.sites) {
    assert.deepEqual(Object.keys(association).sort(), ['host', 'systems']);
    assert.equal(typeof association.host, 'string');
    assert.ok(!seen.has(association.host)); seen.add(association.host);
    assert.ok(Array.isArray(association.systems) && association.systems.length > 0 && association.systems.length <= 64);
    assert.equal(new Set(association.systems).size, association.systems.length);
    assert.ok(association.systems.every(id => systemIds.has(id)));
    const old = sites.get(association.host);
    const site = old ?? { id: association.host, name: association.host, origin: 'https://' + association.host, countries: [], categories: [], rankBuckets: {} };
    sites.set(association.host, { ...site, trackingSystems: [...association.systems].sort() });
  }
  const data = { ...base, revision: 'crux-202609-tracking-' + input.snapshotAt,
    sources: [...base.sources, input.source], trackingSourceId: input.source.id,
    trackingSnapshotAt: input.snapshotAt, trackingSystems: input.systems,
    sites: [...sites.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
  // Validate a copied, immutable projection before writing any deliverable.
  validateAutosurfSitesData(data);
  return data;
}
