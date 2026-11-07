// ADR-107 round 5: the machine-local link between a library profile and a saved proxy (identity-bundles.js): strict validation on read, the
// cap of 128 links, lazy pruning and the serialized store.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUNDLES_KEY, BUNDLES_MAX_LINKS, BundleError, validProfileId, validProxyId, readBundles, linkProfile, unlinkProfile, profilesOfProxy, pruneLinks, createBundleStore } from '../../apps/production-extension/identity-bundles.js';
import { fakeStorage, clone } from './fingerprint-identity-fixtures.mjs';

const pid = number => 'fp-' + number.toString(16).padStart(32, '0');
const raw = links => ({ version: 1, links });

test('constants and the two id rules (the proxy id rule is the one of proxy-shared.js)', () => {
  assert.equal(BUNDLES_KEY, 'identity-bundles:v1'); assert.equal(BUNDLES_MAX_LINKS, 128);
  assert.equal(validProfileId(pid(1)), true);
  for (const bad of ['', 'fp-1', 'FP-' + '0'.repeat(32), 'fp-' + 'g'.repeat(32), 'fp-' + '0'.repeat(33), pid(1) + ' ', null, undefined, 5, {}]) assert.equal(validProfileId(bad), false, String(bad));
  for (const good of ['a', 'proxy-1', 'A_b-9', 'x'.repeat(64), '0abc']) assert.equal(validProxyId(good), true, good);
  for (const bad of ['', '-a', '_a', 'a b', 'a/b', 'é', 'x'.repeat(65), null, undefined, 5, {}]) assert.equal(validProxyId(bad), false, String(bad));
});

test('reading: nothing stored is no links; anything that is not the exact version-1 record is discarded; bad pairs are dropped one by one', () => {
  assert.deepEqual({ ...readBundles(undefined).links }, {}); assert.equal(readBundles(undefined).changed, false);
  for (const junk of [null, 0, 'x', [], {}, { version: 1 }, { links: {} }, { version: 2, links: {} }, { version: 1, links: [] }, { version: 1, links: null }, { version: 1, links: {}, extra: 1 }]) {
    const read = readBundles(junk); assert.deepEqual({ ...read.links }, {}, JSON.stringify(junk)); assert.equal(read.changed, true, JSON.stringify(junk));
  }
  const mixed = readBundles(raw({ [pid(1)]: 'proxy-a', 'not-a-profile': 'proxy-b', [pid(2)]: 'bad id', [pid(3)]: 5, [pid(4)]: '', [pid(5)]: 'ok_5' }));
  assert.deepEqual({ ...mixed.links }, { [pid(1)]: 'proxy-a', [pid(5)]: 'ok_5' }); assert.equal(mixed.changed, true);
  assert.equal(readBundles(raw({ [pid(1)]: 'proxy-a' })).changed, false);
  // Names that exist on every object, or that would reach the prototype, are never keys of the result.
  const hostile = readBundles(JSON.parse('{"version":1,"links":{"__proto__":"x","constructor":"y","toString":"z","' + pid(1) + '":"p1"}}'));
  assert.deepEqual(Object.keys(hostile.links), [pid(1)]); assert.equal(Object.getPrototypeOf(hostile.links), null);
  let ran = false; const accessor = { version: 1 }; Object.defineProperty(accessor, 'links', { enumerable: true, get() { ran = true; return {}; } });
  assert.equal(readBundles(accessor).changed, true); assert.equal(ran, false, 'an accessor is never invoked');
  const links = {}; Object.defineProperty(links, pid(1), { enumerable: true, get() { ran = true; return 'p'; } });
  assert.deepEqual(Object.keys(readBundles(raw(links)).links), []); assert.equal(ran, false);
});

test('at most 128 links are kept (the first ones in profile id order); a huge stored object is walked only up to a bound', () => {
  const many = Object.fromEntries(Array.from({ length: 200 }, (_, number) => [pid(number + 1), 'proxy-' + number])), read = readBundles(raw(many));
  assert.equal(Object.keys(read.links).length, 128); assert.equal(read.changed, true); assert.deepEqual(Object.keys(read.links), Object.keys(many).sort().slice(0, 128));
  const absurd = Object.fromEntries(Array.from({ length: 2000 }, (_, number) => [pid(number + 1), 'p'])); assert.equal(Object.keys(readBundles(raw(absurd)).links).length, 128);
});

test('link, unlink and the reverse lookup never mutate their input; the cap and the id rules throw BundleError', () => {
  const none = readBundles(undefined).links, one = linkProfile(none, pid(1), 'proxy-a'), two = linkProfile(one, pid(2), 'proxy-a');
  assert.deepEqual({ ...none }, {}); assert.deepEqual({ ...one }, { [pid(1)]: 'proxy-a' }); assert.deepEqual(profilesOfProxy(two, 'proxy-a'), [pid(1), pid(2)]); assert.deepEqual(profilesOfProxy(two, 'other'), []);
  assert.deepEqual({ ...linkProfile(two, pid(1), 'proxy-b') }, { [pid(1)]: 'proxy-b', [pid(2)]: 'proxy-a' }, 're-linking replaces');
  assert.deepEqual({ ...unlinkProfile(two, pid(1)) }, { [pid(2)]: 'proxy-a' }); assert.deepEqual({ ...unlinkProfile(two, pid(9)) }, { ...two });
  assert.equal(Object.getPrototypeOf(one), null);
  const full = Object.fromEntries(Array.from({ length: 128 }, (_, number) => [pid(number + 1), 'p' + number]));
  assert.throws(() => linkProfile(full, pid(500), 'x'), error => error instanceof BundleError && error.code === 'limit');
  assert.equal(Object.keys(linkProfile(full, pid(1), 'changed')).length, 128, 'an existing link can still be changed at the cap');
  for (const [profile, proxy] of [['bad', 'x'], [pid(1), 'bad id'], [pid(1), ''], [null, 'x'], [pid(1), 5]]) assert.throws(() => linkProfile(none, profile, proxy), error => error.code === 'invalid');
});

test('pruning: links of unknown profiles go; links of unknown proxies go only when the proxy list is known', () => {
  const links = linkProfile(linkProfile(linkProfile(readBundles(undefined).links, pid(1), 'a'), pid(2), 'b'), pid(3), 'c');
  assert.deepEqual({ ...pruneLinks(links) }, { ...links }, 'no context, nothing to prune');
  assert.deepEqual({ ...pruneLinks(links, { profileIds: new Set([pid(1), pid(3)]) }) }, { [pid(1)]: 'a', [pid(3)]: 'c' });
  assert.deepEqual({ ...pruneLinks(links, { proxyIds: new Set(['a', 'b']) }) }, { [pid(1)]: 'a', [pid(2)]: 'b' });
  assert.deepEqual({ ...pruneLinks(links, { profileIds: new Set([pid(1)]), proxyIds: new Set(['b']) }) }, {});
  assert.deepEqual({ ...links }, { [pid(1)]: 'a', [pid(2)]: 'b', [pid(3)]: 'c' }, 'the input is untouched');
});

test('the store: a read never writes unless the stored value was malformed; link and unlink prune dead links in the same write; an empty set removes the key', async () => {
  const storage = fakeStorage({ local: { [BUNDLES_KEY]: raw({ [pid(1)]: 'a', [pid(2)]: 'b' }) } }), store = createBundleStore(storage);
  assert.deepEqual({ ...await store.read() }, { [pid(1)]: 'a', [pid(2)]: 'b' }); assert.deepEqual(storage.log, [], 'a clean read writes nothing');
  assert.deepEqual({ ...await store.read({ profileIds: new Set([pid(1)]) }) }, { [pid(1)]: 'a' }, 'a read that is told the library can prune'); assert.deepEqual(clone(storage.data.local[BUNDLES_KEY]), raw({ [pid(1)]: 'a' }));
  const linked = await store.link(pid(3), 'c', { profileIds: new Set([pid(1), pid(3)]), proxyIds: new Set(['a', 'c']) }); assert.deepEqual({ ...linked }, { [pid(1)]: 'a', [pid(3)]: 'c' });
  const dead = await store.link(pid(4), 'gone', { profileIds: new Set([pid(1), pid(3), pid(4)]), proxyIds: new Set(['a', 'c', 'gone']) }); assert.deepEqual(Object.keys(dead).sort(), [pid(1), pid(3), pid(4)]);
  const pruned = await store.unlink(pid(1), { proxyIds: new Set(['c']) }); assert.deepEqual({ ...pruned }, { [pid(3)]: 'c' }, 'the link to the vanished proxy "gone" went with the write');
  await store.unlink(pid(3)); assert.equal(Object.hasOwn(storage.data.local, BUNDLES_KEY), false, 'no links, no key');
  storage.data.local[BUNDLES_KEY] = { junk: 1 }; assert.deepEqual({ ...await store.read() }, {}); assert.equal(Object.hasOwn(storage.data.local, BUNDLES_KEY), false, 'a malformed value is discarded and the key cleaned');
});

test('store operations run in the order asked, the stored form is exactly {version, links}, and watch reports only this key', async () => {
  const storage = fakeStorage(), store = createBundleStore(storage); let seen = 0;
  const stop = store.watch(() => { seen++; });
  await Promise.all([store.link(pid(1), 'a'), store.link(pid(2), 'b'), store.unlink(pid(1)), store.link(pid(3), 'c')]);
  assert.deepEqual(clone(storage.data.local[BUNDLES_KEY]), raw({ [pid(2)]: 'b', [pid(3)]: 'c' })); assert.deepEqual(Object.keys(storage.data.local), [BUNDLES_KEY]);
  assert.equal(seen, 4); await storage.local.set({ other: 1 }); assert.equal(seen, 4); stop(); await store.link(pid(4), 'd'); assert.equal(seen, 4);
  await assert.rejects(store.link('bad', 'x'), error => error.code === 'invalid'); assert.deepEqual((await store.read())[pid(2)], 'b', 'a refused link does not poison the chain');
});
