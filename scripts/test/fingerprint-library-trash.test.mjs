// ADR-107 round 5: deleting a library profile keeps it in a 7-day trash. The trash copy is written FIRST, then the profile leaves the library through
// the panel's CAS commit; the 8-second Undo restores from it; the Trash view restores, deletes forever and empties (each delete asks first).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { API_CONFIGURATION_MAX_PROFILES } from '../../apps/production-extension/api-configuration.js';
import { fingerprintIdentityLabels } from '../../apps/production-extension/fingerprint-identity-labels.js';
import { TRASH_KEY, TRASH_TTL_MS, TRASH_DAY_MS, TRASH_MAX_ITEMS } from '../../apps/production-extension/fingerprint-trash.js';
import { device, clone, fakeStorage, UNSAFE } from './fingerprint-identity-fixtures.mjs';
import { libraryHarness, rowIds, inRow, text, descend, byData, allByData, click, press, cellKey, captureAnnouncements, BASE } from './fingerprint-library-harness.mjs';

const iw = fingerprintIdentityLabels('en');
const id = number => 'fp-' + number.toString(16).padStart(32, '0');
const trashed = (profile, age, index = 0) => ({ profile, deletedAt: BASE - age, index });
const stored = items => ({ [TRASH_KEY]: { version: 1, items } });
const toggle = h => h.attr('trash-toggle');
const trashIds = h => allByData(h, 'trash-row').map(node => node.props['data-profile-trash-row']);
const inTrash = storage => (storage.data.local[TRASH_KEY]?.items ?? []).map(entry => entry.profile.id);
const openTrash = async h => { toggle(h).props.onClick(); await h.settle(); };
const libraryIds = h => h.env.saved.configuration.fingerprintProfiles.map(profile => profile.id);

test('Delete writes the trash copy FIRST and then commits; the Undo line says the profile is kept for seven days, and the toggle counts the trash', async () => {
  const keep = device('Keep'), gone = device('Gone', { tags: ['x'], note: 'n' }), h = libraryHarness({ profiles: [keep, gone] });
  try {
    h.render(); await h.settle(); assert.equal(text(toggle(h)), 'Trash (0)');
    inRow(h, gone.id, 'delete').props.onClick(); await h.settle();
    assert.deepEqual(h.trace.filter(entry => entry === 'trash.add' || entry === 'commit'), ['trash.add', 'commit'], 'the copy is stored before the library changes');
    const record = h.storage.data.local[TRASH_KEY]; assert.equal(record.version, 1); assert.equal(record.items.length, 1);
    assert.deepEqual(record.items[0].profile, h.log.commits.length ? record.items[0].profile : null); assert.equal(record.items[0].profile.id, gone.id); assert.deepEqual(record.items[0].profile.tags, ['x']); assert.equal(record.items[0].profile.note, 'n');
    assert.equal(record.items[0].deletedAt, BASE); assert.ok(Number.isSafeInteger(record.items[0].index));
    assert.deepEqual(libraryIds(h), [keep.id]); assert.equal(text(toggle(h)), 'Trash (1)');
    const kept = h.attr('undo-kept') ?? allByData(h, 'undo-kept')[0]; assert.equal(text(kept), iw.trashKept);
  } finally { h.unmount(); }
});

test('Undo restores from the trash: one restore commit, then the trash copy goes', async () => {
  const keep = device('Keep'), gone = device('Gone', { tags: ['t'] }), h = libraryHarness({ profiles: [keep, gone] });
  try {
    h.render(); await h.settle(); inRow(h, gone.id, 'delete').props.onClick(); await h.settle(); h.trace.length = 0;
    h.attr('undo-button').props.onClick(); await h.settle();
    assert.deepEqual(h.trace.filter(entry => entry === 'trash.remove' || entry === 'commit'), ['commit', 'trash.remove'], 'restored first, the copy removed after');
    assert.deepEqual(libraryIds(h).sort(), [keep.id, gone.id].sort()); assert.deepEqual(h.env.saved.configuration.fingerprintProfiles.find(profile => profile.id === gone.id), gone);
    assert.deepEqual(inTrash(h.storage), []); assert.equal(Object.hasOwn(h.storage.data.local, TRASH_KEY), false); assert.equal(text(toggle(h)), 'Trash (0)');
  } finally { h.unmount(); }
});

test('if the trash copy cannot be written the profile is NOT deleted: no commit, a notice, no Undo line', async () => {
  const gone = device('Stays'), h = libraryHarness({ profiles: [gone] });
  try {
    h.render(); await h.settle(); h.state.failTrash = true; inRow(h, gone.id, 'delete').props.onClick(); await h.settle();
    assert.deepEqual(h.trace.filter(entry => entry === 'commit'), []); assert.deepEqual(libraryIds(h), [gone.id]); assert.equal(h.attr('undo-button'), undefined);
    assert.equal(byData(h, 'library-notice', 'trash').props.children, 'A copy could not be kept in the trash, so “Stays” was not deleted.');
  } finally { h.unmount(); }
});

test('if the commit fails the trash copy is taken back, so nothing is left in the trash for a profile that is still in the library', async () => {
  const gone = device('Refused'), h = libraryHarness({ profiles: [gone] });
  try {
    h.render(); await h.settle(); h.state.failNext = true; inRow(h, gone.id, 'delete').props.onClick(); await h.settle();
    assert.deepEqual(h.trace.filter(entry => ['trash.add', 'commit', 'trash.remove'].includes(entry)), ['trash.add', 'commit', 'trash.remove']);
    assert.deepEqual(libraryIds(h), [gone.id]); assert.deepEqual(inTrash(h.storage), []); assert.equal(text(toggle(h)), 'Trash (0)'); assert.equal(h.attr('undo-button'), undefined);
  } finally { h.unmount(); }
  // A leftover copy (the take-back itself failed) is dropped by the next read once it is older than the grace, because the very same profile is still in the library.
  const left = device('Leftover'), storage = fakeStorage({ local: stored([trashed(left, 120000)]) }), g = libraryHarness({ profiles: [left], storage });
  try { g.render(); await g.settle(); assert.equal(text(toggle(g)), 'Trash (0)'); assert.deepEqual(inTrash(storage), [], 'and the key is cleaned'); } finally { g.unmount(); }
});

test('the Trash view lists the items newest first with the deletion time and the days left; "Expires within a day" in the last 24 hours; honest note and empty state', async () => {
  const fresh = device('Fresh', { id: id(1) }), mid = device('Middle', { id: id(2) }), old = device('Almost gone', { id: id(3) }), storage = fakeStorage({ local: stored([trashed(old, TRASH_TTL_MS - 3600000), trashed(fresh, 1000), trashed(mid, 3 * TRASH_DAY_MS + 5000)]) });
  const h = libraryHarness({ profiles: [], storage });
  try {
    h.render(); await h.settle(); assert.equal(text(toggle(h)), 'Trash (3)'); assert.equal(toggle(h).props['aria-pressed'], false);
    await openTrash(h);
    assert.equal(h.nodes(node => node.props['data-profile-view'] === 'trash').length, 1); assert.equal(toggle(h).props['aria-pressed'], true); assert.deepEqual(trashIds(h), [id(1), id(2), id(3)], 'newest first');
    const left = rowId => text(byData(h, 'trash-row', rowId)).match(/(\d+) days left|Expires within a day/u)?.[0];
    assert.equal(left(id(1)), '7 days left'); assert.equal(left(id(2)), '4 days left'); assert.equal(left(id(3)), 'Expires within a day'); assert.match(byData(h, 'trash-row', id(3)).props.class, /is-expiring/u); assert.doesNotMatch(byData(h, 'trash-row', id(1)).props.class, /is-expiring/u);
    assert.equal(byData(h, 'trash-row', id(3)).props['data-profile-trash-days'], 1); assert.equal(byData(h, 'trash-row', id(1)).props['data-profile-trash-days'], 7);
    assert.match(text(allByData(h, 'trash-when')[0]), /^Deleted .+/u); assert.equal(descend(byData(h, 'trash-row', id(1)), node => node.type === 'bdi' && node.props.class === 'fingerprint-row__name').props.children, 'Fresh');
    assert.match(text(h.attr('trash')), /kept on this computer for 7 days|stay on this computer for 7 days/u); assert.match(text(h.attr('trash')), /not exported/u);
    assert.equal(byData(h, 'trash-restore', id(1)).props['aria-label'], 'Restore: Fresh'); assert.equal(byData(h, 'trash-delete', id(1)).props['aria-label'], 'Delete forever: Fresh');
    assert.equal(h.attr('library'), undefined, 'the list of profiles gives way to the trash'); await openTrash(h); assert.equal(h.nodes(node => node.props['data-profile-view'] === 'library').length, 1, 'the toggle goes back');
  } finally { h.unmount(); }
  const empty = libraryHarness({ profiles: [device('Only')] });
  try { empty.render(); await empty.settle(); await openTrash(empty); assert.equal(byData(empty, 'empty', 'trash') !== undefined, true); assert.equal(text(byData(empty, 'empty', 'trash')), iw.trashEmpty); assert.equal(empty.attr('trash-empty'), undefined, 'nothing to empty'); } finally { empty.unmount(); }
});

test('days left use the plural forms of the UI language (Russian one/few/many)', async () => {
  const profiles = [1, 2, 4, 5].map(number => device('P' + number, { id: id(number) })), ages = [0, 1, 3, 4].map(days => days * TRASH_DAY_MS + 5000), storage = fakeStorage({ local: stored(profiles.map((profile, index) => trashed(profile, ages[index]))) });
  const h = libraryHarness({ profiles: [], storage, locale: 'ru' });
  try {
    h.render(); await h.settle(); await openTrash(h);
    const left = rowId => text(byData(h, 'trash-row', rowId)).match(/остал\S*\s+\d+\s+\S+/u)?.[0];
    assert.equal(left(id(1)), 'осталось 7 дней'); assert.equal(left(id(2)), 'осталось 6 дней'); assert.equal(left(id(4)), 'осталось 4 дня'); assert.equal(left(id(5)), 'осталось 3 дня');
  } finally { h.unmount(); }
});

test('Restore puts the profile back as it was (same id), commits once, then drops the trash copy', async () => {
  const keep = device('Keep'), gone = device('Gone', { tags: ['b', 'a'], note: 'n' + String.fromCharCode(10) + 'm' }), h = libraryHarness({ profiles: [keep, gone] }), heard = captureAnnouncements();
  try {
    h.render(); await h.settle(); inRow(h, gone.id, 'delete').props.onClick(); await h.settle(); await openTrash(h); h.trace.length = 0;
    await click(h, byData(h, 'trash-restore', gone.id));
    assert.deepEqual(h.trace.filter(entry => entry === 'commit' || entry === 'trash.remove'), ['commit', 'trash.remove']); assert.equal(h.log.commits.length, 2, 'the delete and the restore');
    assert.deepEqual(h.env.saved.configuration.fingerprintProfiles.find(profile => profile.id === gone.id), gone, 'identical to the deleted one, tags and note included');
    assert.deepEqual(trashIds(h), []); assert.equal(Object.hasOwn(h.storage.data.local, TRASH_KEY), false); assert.equal(text(toggle(h)), 'Trash (0)');
    await heard.flush(); assert.match(heard.all(), /Restored from the trash: “Gone”\./u);
  } finally { heard.stop(); h.unmount(); }
});

test('Restore never replaces: another profile with the old id makes the restored one get a fresh id; the very same profile already back only drops the copy', async () => {
  const gone = device('Original', { id: id(7), tags: ['orig'] }), storage = fakeStorage({ local: stored([trashed(gone, 1000, 0)]) }), h = libraryHarness({ profiles: [], storage });
  try {
    h.render(); await h.settle(); await openTrash(h); assert.deepEqual(trashIds(h), [id(7)]);
    // After the list was read, a DIFFERENT profile arrives with the same id (for example an imported file).
    const impostor = { ...device('Impostor', { id: id(7) }) };
    h.external(next => { next.fingerprintProfiles.push(impostor); }); await h.settle();
    await click(h, byData(h, 'trash-restore', id(7)));
    const ids = libraryIds(h); assert.equal(ids.length, 2); assert.ok(ids.includes(id(7))); assert.equal(h.env.saved.configuration.fingerprintProfiles.find(profile => profile.id === id(7)).label, 'Impostor', 'the other profile is untouched');
    const restored = h.env.saved.configuration.fingerprintProfiles.find(profile => profile.id !== id(7)); assert.match(restored.id, /^fp-[a-f0-9]{32}$/u); assert.equal(restored.label, 'Original'); assert.deepEqual(restored.tags, ['orig']); assert.deepEqual(restored.apis, gone.apis);
    assert.deepEqual(trashIds(h), []);
  } finally { h.unmount(); }
  const back = device('Back', { id: id(8) }), storage2 = fakeStorage({ local: stored([trashed(back, 1000)]) }), g = libraryHarness({ profiles: [], storage: storage2 });
  try {
    g.render(); await g.settle(); await openTrash(g); g.external(next => { next.fingerprintProfiles.push(clone(back)); }); await g.settle(); g.log.commits.length = 0;
    await click(g, byData(g, 'trash-restore', id(8)));
    assert.equal(g.log.commits.length, 0, 'nothing to put back'); assert.deepEqual(libraryIds(g), [id(8)]); assert.deepEqual(trashIds(g), []);
  } finally { g.unmount(); }
});

test('restoring into a full library shows the usual profile-limit error and keeps the item in the trash', async () => {
  const template = device('Template'), full = Array.from({ length: API_CONFIGURATION_MAX_PROFILES }, (_, index) => ({ ...clone(template), id: id(index + 1000), label: 'F' + index })), gone = device('Waiting', { id: id(1) });
  const storage = fakeStorage({ local: stored([trashed(gone, 1000)]) }), h = libraryHarness({ profiles: [], storage });
  try {
    h.env.saved = { ...h.env.saved, configuration: { ...h.env.saved.configuration, fingerprintProfiles: full } }; h.render(); await h.settle(); await openTrash(h);
    await click(h, byData(h, 'trash-restore', id(1)));
    assert.deepEqual(h.log.errors, ['profile-limit']); assert.equal(h.log.commits.length, 0); assert.deepEqual(trashIds(h), [id(1)]); assert.deepEqual(inTrash(storage), [id(1)]);
  } finally { h.unmount(); }
});

test('Delete forever asks first: Cancel (also Escape) keeps the item, confirming removes only that one; Empty trash asks too and removes the key', async () => {
  const a = device('A', { id: id(1) }), b = device('B', { id: id(2) }), storage = fakeStorage({ local: stored([trashed(a, 1000), trashed(b, 2000)]) }), h = libraryHarness({ profiles: [], storage }), heard = captureAnnouncements();
  try {
    h.render(); await h.settle(); await openTrash(h);
    byData(h, 'trash-delete', id(1)).props.onClick(); await h.settle();
    const box = byData(h, 'trash-confirm', 'one'); assert.ok(box); assert.equal(box.props.role, 'group'); assert.equal(descend(box, node => node.type === 'bdi').props.children, 'A', 'the name sits in <bdi>'); assert.match(text(box), /forever\? This cannot be undone\./u); assert.equal(inTrash(storage).length, 2, 'asking changes nothing');
    const escape = await press(h, box, 'Escape'); void escape; assert.equal(byData(h, 'trash-confirm', 'one'), undefined, 'Escape cancels'); assert.deepEqual(trashIds(h), [id(1), id(2)]);
    byData(h, 'trash-delete', id(1)).props.onClick(); await h.settle(); await click(h, h.attr('trash-confirm-cancel')); assert.equal(byData(h, 'trash-confirm', 'one'), undefined); assert.equal(inTrash(storage).length, 2);
    byData(h, 'trash-delete', id(1)).props.onClick(); await h.settle(); await click(h, h.attr('trash-confirm-yes'));
    assert.deepEqual(inTrash(storage), [id(2)]); assert.deepEqual(trashIds(h), [id(2)]); assert.equal(h.log.commits.length, 0, 'the library is not touched');
    await heard.flush(); assert.match(heard.all(), /Deleted forever: “A”\./u);
    h.attr('trash-empty').props.onClick(); await h.settle(); assert.ok(byData(h, 'trash-confirm', 'all')); assert.match(text(byData(h, 'trash-confirm', 'all')), /Delete everything in the trash forever\?/u); assert.equal(inTrash(storage).length, 1);
    await click(h, h.attr('trash-confirm-yes')); assert.equal(Object.hasOwn(storage.data.local, TRASH_KEY), false); assert.deepEqual(trashIds(h), []); assert.equal(text(toggle(h)), 'Trash (0)'); assert.ok(byData(h, 'empty', 'trash'));
    await heard.flush(); assert.match(heard.all(), /The trash is empty now\./u);
  } finally { heard.stop(); h.unmount(); }
});

test('the trash is pruned when the library opens and follows another page: expired items go (and the key is rewritten), a change elsewhere refreshes the list', async () => {
  const live = device('Live', { id: id(1) }), dead = device('Dead', { id: id(2) }), storage = fakeStorage({ local: stored([trashed(live, 1000), trashed(dead, TRASH_TTL_MS)]) }), h = libraryHarness({ profiles: [], storage });
  try {
    h.render(); await h.settle(); assert.equal(text(toggle(h)), 'Trash (1)'); assert.deepEqual(inTrash(storage), [id(1)], 'the expired item was removed from storage on open');
    // Another Options page deletes a profile: the change event makes this page read again.
    const other = device('Other window', { id: id(3) }); await storage.local.set({ [TRASH_KEY]: { version: 1, items: [trashed(other, 10), trashed(live, 1000)] } }); await h.settle();
    assert.equal(text(toggle(h)), 'Trash (2)');
    // Time passes (the clock of the page): a read after the seven days drops the item.
    h.advance(TRASH_TTL_MS); await openTrash(h); await h.settle(); assert.equal(text(toggle(h)), 'Trash (0)');
  } finally { h.unmount(); }
  const broken = libraryHarness({ profiles: [], storage: fakeStorage({ local: { [TRASH_KEY]: { version: 1, items: 'nope' } } }) });
  try { broken.render(); await broken.settle(); assert.equal(text(toggle(broken)), 'Trash (0)', 'malformed storage is an empty trash, not a crash'); } finally { broken.unmount(); }
});

test('a full trash (32 items) evicts the oldest on the next delete and says so in the Undo line', async () => {
  const items = Array.from({ length: TRASH_MAX_ITEMS }, (_, index) => trashed(device('Old ' + index, { id: id(index + 1) }), (index + 1) * 60000)), gone = device('One more', { id: id(100) });
  const storage = fakeStorage({ local: stored(items) }), h = libraryHarness({ profiles: [gone], storage });
  try {
    h.render(); await h.settle(); assert.equal(text(toggle(h)), 'Trash (32)');
    inRow(h, gone.id, 'delete').props.onClick(); await h.settle();
    const ids = inTrash(storage); assert.equal(ids.length, 32); assert.equal(ids[0], gone.id); assert.ok(!ids.includes(id(32)), 'the oldest item made room');
    assert.equal(text(allByData(h, 'undo-kept')[0]), iw.trashKept + ' ' + iw.trashEvicted);
  } finally { h.unmount(); }
});

test('a profile that returns from the trash carries no character the contract refuses for new texts', async () => {
  const dirty = { ...device('Cleanme', { id: id(5), tags: ['ok'] }), label: 'Clean' + UNSAFE.rlo + 'me', tags: ['ok', 'bad' + UNSAFE.lrm] }, storage = fakeStorage({ local: stored([trashed(dirty, 1000)]) }), h = libraryHarness({ profiles: [], storage });
  try {
    h.render(); await h.settle(); await openTrash(h); await click(h, byData(h, 'trash-restore', id(5)));
    const restored = h.env.saved.configuration.fingerprintProfiles[0]; assert.equal(restored.label, 'Cleanme'); assert.deepEqual(restored.tags, ['ok']);
  } finally { h.unmount(); }
});

test('without a trash store the library deletes as before (8-second Undo from memory) and shows no Trash toggle', async () => {
  const gone = device('Plain'), h = libraryHarness({ profiles: [gone], trash: false });
  try {
    h.render(); await h.settle(); assert.equal(toggle(h), undefined);
    inRow(h, gone.id, 'delete').props.onClick(); await h.settle(); assert.deepEqual(libraryIds(h), []); assert.equal(allByData(h, 'undo-kept').length, 0, 'it does not claim a trash it does not have');
    h.attr('undo-button').props.onClick(); await h.settle(); assert.deepEqual(libraryIds(h), [gone.id]);
  } finally { h.unmount(); }
  void rowIds; void cellKey; void TRASH_DAY_MS;
});
