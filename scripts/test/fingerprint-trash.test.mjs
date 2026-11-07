// ADR-107 round 5: the 7-day trash of deleted library profiles (fingerprint-trash.js): strict shape validation on read, caps, TTL,
// ordering, restore plans and the serialized store.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { TRASH_KEY, TRASH_TTL_MS, TRASH_DAY_MS, TRASH_MAX_ITEMS, TRASH_MAX_BYTES, TRASH_LIMITS, TRASH_PRUNE_GRACE_MS, TrashError, readTrash, fitTrash, addTrashItem, removeTrashItem, trashDaysLeft, trashBytes, dropRestored, restorePlan, createTrashStore } from '../../apps/production-extension/fingerprint-trash.js';
import { device, clone, fakeStorage, turn, UNSAFE, LF } from './fingerprint-identity-fixtures.mjs';

const NOW = 1_800_000_000_000, id = number => 'fp-' + number.toString(16).padStart(32, '0');
const item = (number, age = 0, extra = {}) => ({ profile: device('P' + number, { id: id(number), seed: 7 }), deletedAt: NOW - age, index: number % 128, ...extra });
const raw = items => ({ version: 1, items });

test('constants: seven days, 32 items, 1.5 MiB; the limits object carries them', () => {
  assert.equal(TRASH_KEY, 'fingerprint-trash:v1'); assert.equal(TRASH_TTL_MS, 604800000); assert.equal(TRASH_DAY_MS * 7, TRASH_TTL_MS);
  assert.equal(TRASH_MAX_ITEMS, 32); assert.equal(TRASH_MAX_BYTES, 1.5 * 1024 * 1024); assert.deepEqual({ ...TRASH_LIMITS }, { items: 32, bytes: 1572864 });
});

test('a missing value is an empty trash; anything that is not exactly the version-1 record is discarded and marked changed', () => {
  assert.deepEqual(readTrash(undefined, NOW), { items: [], changed: false });
  for (const junk of [null, 0, 'x', [], {}, { version: 1 }, { items: [] }, { version: 2, items: [] }, { version: '1', items: [] }, { version: 1, items: {} }, { version: 1, items: [], extra: true }, { version: 1, items: 'no' }]) assert.deepEqual(readTrash(junk, NOW), { items: [], changed: true }, JSON.stringify(junk));
  assert.deepEqual(readTrash(raw([]), NOW), { items: [], changed: false });
  let ran = false; const accessor = { version: 1 }; Object.defineProperty(accessor, 'items', { enumerable: true, get() { ran = true; return []; } });
  assert.deepEqual(readTrash(accessor, NOW), { items: [], changed: true }); assert.equal(ran, false, 'an accessor is never invoked');
});

test('every item is re-validated: wrong keys, times, positions and profile records are dropped one by one, valid neighbours stay', () => {
  const good = item(1), valid = readTrash(raw([good]), NOW); assert.equal(valid.items.length, 1); assert.equal(valid.changed, false);
  assert.deepEqual(valid.items[0].profile, good.profile, 'a valid profile is returned in its canonical form');
  const base = item(2);
  const hostile = [
    { ...base, extra: 1 }, { profile: base.profile, deletedAt: base.deletedAt }, { ...base, deletedAt: '5' }, { ...base, deletedAt: 1.5 }, { ...base, deletedAt: 0 }, { ...base, deletedAt: -3 }, { ...base, deletedAt: NaN },
    { ...base, index: -1 }, { ...base, index: 128 }, { ...base, index: 0.5 }, { ...base, index: '3' }, { ...base, profile: null }, { ...base, profile: [] }, { ...base, profile: { ...base.profile, id: 'nope' } },
    { ...base, profile: { ...base.profile, apis: base.profile.apis.slice(1) } }, { ...base, profile: { ...base.profile, extra: true } }, { ...base, profile: { ...base.profile, tags: ['a', 'A'] } },
    { ...base, profile: { ...base.profile, tags: Array.from({ length: 9 }, (_, index) => 't' + index) } }, { ...base, profile: { ...base.profile, note: 'x'.repeat(501) } }, { ...base, profile: { ...base.profile, label: '' } },
    null, 'x', 7, []];
  const result = readTrash(raw([...hostile, good]), NOW);
  assert.deepEqual(result.items.map(entry => entry.profile.id), [good.profile.id]); assert.equal(result.changed, true);
});

test('items expire at exactly seven days; a deletion time from the future is read as now; the newest copy of an id wins', () => {
  assert.equal(readTrash(raw([item(1, TRASH_TTL_MS - 1)]), NOW).items.length, 1, 'one millisecond before the TTL it is kept');
  const expired = readTrash(raw([item(1, TRASH_TTL_MS)]), NOW); assert.deepEqual(expired, { items: [], changed: true }, 'at the TTL it is gone');
  assert.equal(readTrash(raw([item(1, TRASH_TTL_MS + 5000)]), NOW).items.length, 0);
  const future = readTrash(raw([item(1, -60001)]), NOW); assert.equal(future.items[0].deletedAt, NOW, 'a clock that moved backwards cannot keep an item for longer'); assert.equal(future.changed, true, 'the corrected time is written back');
  assert.equal(readTrash(raw([item(1, -60000)]), NOW).items[0].deletedAt, NOW + 60000, 'a minute of skew is tolerated as it is');
  const twin = readTrash(raw([item(3, 5000, { index: 1 }), item(3, 1000, { index: 2 }), item(3, 9000, { index: 3 })]), NOW);
  assert.equal(twin.items.length, 1); assert.equal(twin.items[0].index, 2, 'the newest of the three'); assert.equal(twin.changed, true);
});

test('the order is newest first (ties by id) and the count cap evicts the oldest', () => {
  const ordered = readTrash(raw([item(1, 3000), item(2, 1000), item(3, 2000), item(4, 1000)]), NOW).items.map(entry => entry.profile.id);
  assert.deepEqual(ordered, [id(2), id(4), id(3), id(1)]);
  const many = Array.from({ length: 40 }, (_, number) => item(number + 1, (number + 1) * 1000)), capped = readTrash(raw(many), NOW);
  assert.equal(capped.items.length, TRASH_MAX_ITEMS); assert.equal(capped.changed, true); assert.deepEqual(capped.items.map(entry => entry.profile.id), many.slice(0, 32).map(entry => entry.profile.id), 'the 32 newest stay');
  assert.equal(readTrash(raw(Array.from({ length: 200 }, (_, number) => item(number % 5 + 1, number))), NOW).items.length, 5, 'a huge stored list is walked only up to a bound');
});

test('the size cap evicts the oldest items first, with the same code at any limit', () => {
  const items = [item(1, 1000), item(2, 2000), item(3, 3000), item(4, 4000)], each = trashBytes([items[0]]) - trashBytes([]);
  const small = { items: 32, bytes: trashBytes([]) + each * 2 + 10 };
  const fitted = fitTrash(items, small); assert.deepEqual(fitted.items.map(entry => entry.profile.id), [id(1), id(2)]); assert.equal(fitted.evicted, 2);
  assert.deepEqual(fitTrash(items, TRASH_LIMITS), { items: items.slice().sort((a, b) => b.deletedAt - a.deletedAt), evicted: 0 });
  assert.equal(readTrash(raw(items), NOW, small).items.length, 2); assert.equal(readTrash(raw(items), NOW, small).changed, true);
  assert.ok(trashBytes([items[0]]) < TRASH_MAX_BYTES / 20, 'a real profile is a few tens of KiB, so 32 fit the real cap');
});

test('addTrashItem puts the newest first, replaces the same id, clamps the index, evicts by count and refuses a record that cannot fit', () => {
  const first = addTrashItem([], device('A', { id: id(1) }), 3, NOW); assert.equal(first.items.length, 1); assert.equal(first.items[0].deletedAt, NOW); assert.equal(first.items[0].index, 3); assert.equal(first.evicted, 0);
  const second = addTrashItem(first.items, device('B', { id: id(2) }), 900, NOW + 5); assert.deepEqual(second.items.map(entry => entry.profile.id), [id(2), id(1)]); assert.equal(second.items[0].index, 127, 'the index is clamped');
  assert.equal(addTrashItem(second.items, device('B', { id: id(3) }), -5, NOW).item.index, 0);
  const again = addTrashItem(second.items, device('A again', { id: id(1) }), 0, NOW + 9); assert.equal(again.items.length, 2); assert.equal(again.items[0].profile.label, 'A again', 'the same id is replaced, not duplicated');
  let list = []; for (let number = 1; number <= 40; number++) list = addTrashItem(list, device('N' + number, { id: id(number) }), 0, NOW + number).items;
  assert.equal(list.length, 32); assert.equal(list[0].profile.id, id(40)); assert.equal(list.at(-1).profile.id, id(9), 'the eight oldest were evicted');
  assert.equal(addTrashItem(list, device('N41', { id: id(41) }), 0, NOW + 41).evicted, 1);
  assert.throws(() => addTrashItem([], device('Big', { id: id(1) }), 0, NOW, { items: 32, bytes: 100 }), { name: 'TrashError', code: 'too-large' });
  for (const junk of [null, {}, { id: id(1) }, { ...device('X', { id: id(1) }), apis: [] }]) assert.throws(() => addTrashItem([], junk, 0, NOW), error => error instanceof TrashError && error.code === 'invalid');
  assert.deepEqual(removeTrashItem(second.items, id(1)).map(entry => entry.profile.id), [id(2)]);
});

test('days left are rounded up: seven right after the deletion (and for the whole first day), down to one in the last 24 hours', () => {
  const at = age => trashDaysLeft({ deletedAt: NOW - age }, NOW);
  assert.equal(at(0), 7); assert.equal(at(1), 7, 'a second after the deletion it is still the seven days that were promised'); assert.equal(at(TRASH_DAY_MS - 1), 7); assert.equal(at(TRASH_DAY_MS), 6); assert.equal(at(2 * TRASH_DAY_MS), 5);
  assert.equal(at(5 * TRASH_DAY_MS + 1), 2); assert.equal(at(6 * TRASH_DAY_MS - 1), 2); assert.equal(at(6 * TRASH_DAY_MS), 1, 'exactly 24 hours left is the last day'); assert.equal(at(TRASH_TTL_MS - 1), 1);
  assert.equal(at(-5000), 7, 'a future time is not more than seven days'); assert.equal(at(TRASH_TTL_MS + 99999), 1, 'an item past its time is never shown (it is pruned on read); the number stays in range');
});

test('dropRestored removes an OLD trash copy only when the very same profile is back; a young copy is a delete in progress; restorePlan names what Restore should do', () => {
  const trashed = item(1, TRASH_PRUNE_GRACE_MS), young = item(2, TRASH_PRUNE_GRACE_MS - 1), same = clone(trashed.profile), other = { ...clone(trashed.profile), label: 'Another profile with the same id' };
  assert.equal(dropRestored([trashed], [same], NOW).length, 0, 'the same id and content, past the grace: the copy is stale');
  assert.equal(dropRestored([young], [clone(young.profile)], NOW).length, 1, 'the profile is in the library AND the trash for a moment while it is being deleted: that copy is kept, whichever page reads');
  assert.equal(dropRestored([young], [clone(young.profile)], NOW + 1).length, 0, 'one millisecond later it counts as a leftover');
  assert.equal(TRASH_PRUNE_GRACE_MS, 60000);
  assert.equal(dropRestored([trashed], [other], NOW).length, 1, 'a different profile with the same id keeps the trash copy');
  assert.equal(dropRestored([trashed], [], NOW).length, 1); assert.equal(dropRestored([trashed], null, NOW).length, 1);
  assert.equal(dropRestored([trashed], [{ ...same, tags: ['edited'] }], NOW).length, 1, 'an edit after the failed delete makes it a different profile');
  assert.equal(restorePlan([], trashed), 'restore'); assert.equal(restorePlan([same], trashed), 'present'); assert.equal(restorePlan([other], trashed), 'fresh'); assert.equal(restorePlan(undefined, trashed), 'restore');
});

test('the store reads and prunes (writing the pruned list back), adds, removes and empties; operations run in the order they were asked', async () => {
  const storage = fakeStorage({ local: { [TRASH_KEY]: raw([item(1, TRASH_TTL_MS + 1), item(2, 1000), { junk: true }]) } }); let now = NOW;
  const store = createTrashStore(storage, { now: () => now });
  const read = await store.read(); assert.deepEqual(read.map(entry => entry.profile.id), [id(2)]);
  assert.deepEqual(storage.data.local[TRASH_KEY].items.map(entry => entry.profile.id), [id(2)], 'the pruned list was written back');
  const writes = storage.log.length; await store.read(); assert.equal(storage.log.length, writes, 'a clean read writes nothing');
  // Asked in one go, the operations still run one after the other.
  const results = await Promise.all([store.add(device('A', { id: id(10) }), 4, {}), store.add(device('B', { id: id(11) }), 5, {}), store.remove(id(2)), store.read()]);
  const ids = list => list.map(entry => entry.profile.id);
  assert.deepEqual(ids(results[0].items), [id(10), id(2)]); assert.deepEqual(ids(results[1].items), [id(10), id(11), id(2)], 'the second add saw the first'); assert.deepEqual(ids(results[2]), [id(10), id(11)], 'the remove saw both'); assert.deepEqual(ids(results[3]), [id(10), id(11)]);
  now += TRASH_TTL_MS; assert.deepEqual(await store.read(), [], 'everything expired by the clock of the store'); assert.equal(Object.hasOwn(storage.data.local, TRASH_KEY), false, 'an empty trash removes its key');
  await store.add(device('C', { id: id(12) }), 0, {}); assert.deepEqual(await store.empty(), []); assert.equal(Object.hasOwn(storage.data.local, TRASH_KEY), false);
});

test('a copy of a profile that is back unchanged is dropped by a later read or add, never while the delete is young (the trash copy left by a failed second step)', async () => {
  let now = NOW; const storage = fakeStorage(), store = createTrashStore(storage, { now: () => now }), profile = device('Came back', { id: id(5) });
  await store.add(profile, 0, {});
  assert.equal((await store.read({ library: [profile] })).length, 1, 'right after the copy was written the profile is in both places: a delete in progress, not a leftover');
  now += TRASH_PRUNE_GRACE_MS;
  assert.equal((await store.read({ library: [profile] })).length, 0, 'after the grace it is a leftover'); assert.equal(Object.hasOwn(storage.data.local, TRASH_KEY), false, 'and the key is cleaned');
  await store.add(profile, 0, {}); now += TRASH_PRUNE_GRACE_MS; assert.equal((await store.read({ library: [{ ...clone(profile), label: 'Different' }] })).length, 1, 'a different profile with that id does not drop it');
  const added = await store.add(device('Other', { id: id(6) }), 0, { library: [profile] }); assert.deepEqual(added.items.map(entry => entry.profile.id), [id(6)], 'the add also drops the old copies of profiles that are back in the library it is given');
});

test('a deletion time from the future is corrected and written back once, so the item then ages instead of staying young for ever', async () => {
  let now = NOW; const storage = fakeStorage({ local: { [TRASH_KEY]: raw([item(1, -3 * TRASH_DAY_MS)]) } }), store = createTrashStore(storage, { now: () => now });
  assert.equal((await store.read())[0].deletedAt, NOW); assert.equal(storage.data.local[TRASH_KEY].items[0].deletedAt, NOW, 'the corrected time is in storage');
  now += TRASH_TTL_MS; assert.deepEqual(await store.read(), [], 'seven days later it is gone');
});

test('a failing write rejects before anything changed and leaves the stored trash as it was', async () => {
  let refuse = false;
  const storage = fakeStorage({ failSet: () => refuse }), store = createTrashStore(storage, { now: () => NOW });
  await store.add(device('Kept', { id: id(1) }), 0, {}); const before = clone(storage.data.local[TRASH_KEY]);
  refuse = true; await assert.rejects(store.add(device('Lost', { id: id(2) }), 0, {}));
  assert.deepEqual(storage.data.local[TRASH_KEY], before);
  refuse = false; assert.deepEqual((await store.read()).map(entry => entry.profile.id), [id(1)], 'a refused write does not poison the chain');
});

test('watch reports changes of the trash key only and can be stopped', async () => {
  const storage = fakeStorage(), store = createTrashStore(storage, { now: () => NOW }); let seen = 0;
  const stop = store.watch(() => { seen++; });
  await store.add(device('A', { id: id(1) }), 0, {}); assert.equal(seen, 1);
  await storage.local.set({ other: 1 }); assert.equal(seen, 1, 'another key is not the trash');
  stop(); await store.add(device('B', { id: id(2) }), 0, {}); assert.equal(seen, 1, 'stopped');
  const throwing = createTrashStore(fakeStorage(), { now: () => NOW }); throwing.watch(() => { throw new Error('boom'); });
  await throwing.add(device('C', { id: id(3) }), 0, {});
});

test('the stored form is exactly {version, items:[{profile, deletedAt, index}]} and keeps no copy of anything else', async () => {
  const storage = fakeStorage(), store = createTrashStore(storage, { now: () => NOW });
  await store.add({ ...device('Tagged', { id: id(1), tags: ['b', 'a'], note: 'n' + LF + 'm' }), }, 7, {});
  const stored = storage.data.local[TRASH_KEY];
  assert.deepEqual(Object.keys(stored).sort(), ['items', 'version']); assert.equal(stored.version, 1);
  assert.deepEqual(Object.keys(stored.items[0]).sort(), ['deletedAt', 'index', 'profile']); assert.equal(stored.items[0].index, 7); assert.deepEqual(stored.items[0].profile.tags, ['a', 'b']); assert.equal(stored.items[0].profile.note, 'n' + LF + 'm');
  assert.deepEqual(Object.keys(storage.data.local), [TRASH_KEY]);
  // The unsafe texts of an old profile survive in the trash (they are cleaned only when it is restored).
  const old = { ...device('Old', { id: id(2) }), label: 'Old' + UNSAFE.rlo + 'name' };
  assert.equal((await store.add(old, 0, {})).items.find(entry => entry.profile.id === id(2)).profile.label, 'Old' + UNSAFE.rlo + 'name');
  void createApiConfiguration; void turn;
});
