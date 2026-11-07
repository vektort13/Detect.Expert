// ADR-107 round 5: tags and notes in the saved-profiles library: chips on the rows, editing in the Peek (explicit Save), tag filters with counts and
// search over label, tags and note.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIBRARY_TAG_GROUP, LIBRARY_TAG_FILTER_MAX, attributeValue, searchProfiles } from '../../apps/production-extension/fingerprint-library-ui.js';
import { fingerprintIdentityLabels } from '../../apps/production-extension/fingerprint-identity-labels.js';
import { device, clone, UNSAFE, LF } from './fingerprint-identity-fixtures.mjs';
import { libraryHarness, rowOf, inRow, rowIds, peek, text, descend, within, byData, allByData, typeInto, press, click, captureAnnouncements } from './fingerprint-library-harness.mjs';

const iw = fingerprintIdentityLabels('en');
const open = async (h, id) => { inRow(h, id, 'pick').props.onClick(); await h.settle(); };
const metaOf = (h, id) => h.nodes(node => node.props['data-profile-meta'] === id)[0];
const chips = h => h.nodes(node => node.props['data-profile-tag-chip'] !== undefined).map(node => node.props['data-profile-tag-chip']);
const savedTags = (h, id) => h.env.saved.configuration.fingerprintProfiles.find(profile => profile.id === id).tags;
const savedNote = (h, id) => h.env.saved.configuration.fingerprintProfiles.find(profile => profile.id === id).note;
const rowTags = (h, id) => h.nodes(node => node.props['data-profile-tags'] === id)[0];

test('rows show at most three tag chips and "+N" for the rest, with the full list for screen readers and in the title; a profile without tags has no tag line', async () => {
  const many = device('Many', { tags: ['e', 'd', 'c', 'b', 'a'] }), few = device('Few', { tags: ['solo'] }), none = device('None'), h = libraryHarness({ profiles: [many, few, none] });
  try {
    h.render(); await h.settle();
    const line = rowTags(h, many.id), shown = descend(line, node => node.props['data-profile-tag'] === 'a');
    assert.deepEqual(within(rowOf(h, many.id), node => node.props['data-profile-tag'] !== undefined).map(node => node.props['data-profile-tag']), ['a', 'b', 'c'], 'the first three in stored (code unit) order');
    assert.ok(shown && shown.type === 'bdi', 'a tag is isolated in <bdi>'); assert.equal(shown.props['aria-hidden'], true, 'the visible chips are decorative; the hidden text carries the names');
    const more = descend(line, node => node.props['data-profile-tags-more'] !== undefined); assert.equal(more.props['data-profile-tags-more'], 2); assert.equal(text(more), '+2'); assert.equal(more.props.title, 'More tags: d, e'); assert.equal(more.props.dir, 'ltr', 'the "+2" is isolated so a right-to-left page does not show it as "2+"');
    assert.match(text(descend(line, node => node.props.class === 'fingerprint-visually-hidden')), /Tags: a, b, c, d, e/u);
    assert.equal(descend(rowTags(h, few.id), node => node.props['data-profile-tags-more'] !== undefined), undefined, 'no "+N" when all fit');
    assert.equal(rowTags(h, none.id), undefined);
    assert.equal(descend(rowOf(h, many.id), node => node.props.class === 'fingerprint-row__text').props.children.at(-1).props['data-profile-tags'], many.id, 'the line sits under the facts, inside the row button');
  } finally { h.unmount(); }
});

test('editing in the Peek: Enter and comma add, a pasted list adds several, nothing is written until Save, Save is one commit with the canonical tags and note', async () => {
  const profile = device('Editable', { tags: ['kept'] }), h = libraryHarness({ profiles: [profile] }), heard = captureAnnouncements();
  try {
    h.render(); await h.settle(); await open(h, profile.id);
    assert.deepEqual(chips(h), ['kept']); assert.equal(h.attr('meta-save').props.disabled, true, 'nothing to save yet'); assert.equal(h.attr('meta-unsaved'), undefined);
    await typeInto(h, h.attr('tag-input'), 'work'); await press(h, h.attr('tag-input'), 'Enter');
    assert.deepEqual(chips(h), ['kept', 'work']); assert.equal(h.attr('tag-input').props.value, '', 'the field is cleared');
    await typeInto(h, h.attr('tag-input'), 'Eu,'); assert.deepEqual(chips(h), ['Eu', 'kept', 'work'], 'a comma adds the tag at once, in code unit order');
    await typeInto(h, h.attr('tag-input'), 'a, b ,c,d'); assert.deepEqual(chips(h), ['Eu', 'a', 'b', 'c', 'kept', 'work'], 'a pasted list adds all but the last, which stays in the field'); assert.equal(h.attr('tag-input').props.value, 'd');
    await press(h, h.attr('tag-input'), ','); assert.equal(chips(h).length, 7);
    assert.equal(h.log.commits.length, 0, 'editing never writes'); assert.deepEqual(savedTags(h, profile.id), ['kept']);
    assert.ok(h.attr('meta-unsaved')); assert.equal(h.attr('meta-save').props.disabled, false);
    await typeInto(h, h.attr('note-input'), 'first  ' + LF + 'second '); assert.equal(h.attr('meta-save').props.disabled, false);
    await click(h, h.attr('meta-save'));
    assert.equal(h.log.commits.length, 1, 'one CAS commit'); assert.deepEqual(savedTags(h, profile.id), ['Eu', 'a', 'b', 'c', 'd', 'kept', 'work']); assert.equal(savedNote(h, profile.id), 'first  ' + LF + 'second', 'the ends are trimmed');
    assert.deepEqual({ ...h.log.commits[0].fingerprintProfiles[0], tags: 0, note: 0 }, { ...profile, tags: 0, note: 0 }, 'only tags and note changed');
    assert.equal(h.attr('meta-unsaved'), undefined, 'the draft is gone after the save'); assert.deepEqual(chips(h), savedTags(h, profile.id)); assert.equal(h.attr('meta-save').props.disabled, true);
    await heard.flush(); assert.match(heard.all(), /Tag added: Eu\. 3 of 8\./u); assert.match(heard.all(), /Tags and note saved for “Editable”\./u);
  } finally { heard.stop(); h.unmount(); }
});

test('Backspace on the empty field removes the last chip, Escape clears the field before it can close the Peek, chip buttons remove, Discard returns to the saved tags', async () => {
  const profile = device('Keys', { tags: ['a', 'b', 'c'] }), h = libraryHarness({ profiles: [profile] });
  try {
    h.render(); await h.settle(); await open(h, profile.id);
    const empty = await press(h, h.attr('tag-input'), 'Backspace'); assert.equal(empty.defaultPrevented, true); assert.deepEqual(chips(h), ['a', 'b']);
    await typeInto(h, h.attr('tag-input'), 'typed'); const kept = await press(h, h.attr('tag-input'), 'Backspace'); assert.equal(kept.defaultPrevented, false, 'with text in the field Backspace edits the text'); assert.deepEqual(chips(h), ['a', 'b']);
    const first = await press(h, h.attr('tag-input'), 'Escape'); assert.equal(first.defaultPrevented, true); assert.equal(h.attr('tag-input').props.value, ''); assert.ok(peek(h), 'the Peek stays open');
    const second = await press(h, h.attr('tag-input'), 'Escape'); assert.equal(second.defaultPrevented, false, 'with an empty field Escape is left to the Peek');
    const remove = h.nodes(node => node.props['data-profile-tag-remove'] === 'a')[0]; assert.equal(remove.props['aria-label'], 'Remove tag: a'); await click(h, remove); assert.deepEqual(chips(h), ['b']);
    assert.equal(h.log.commits.length, 0); await click(h, h.attr('meta-discard')); assert.deepEqual(chips(h), ['a', 'b', 'c']); assert.equal(h.attr('meta-unsaved'), undefined);
    assert.equal((await press(h, h.attr('tag-input'), 'Enter')).defaultPrevented, true, 'Enter in an empty field adds nothing and does not submit anything'); assert.equal(h.log.commits.length, 0);
    for (const composing of ['Enter', ',']) { await typeInto(h, h.attr('tag-input'), 'ime'); await press(h, h.attr('tag-input'), composing, { isComposing: true }); assert.deepEqual(chips(h), ['a', 'b', 'c'], 'a key during IME composition never adds'); await typeInto(h, h.attr('tag-input'), ''); }
  } finally { h.unmount(); }
});

test('limits and messages: duplicates (ignoring case) are not added twice, the ninth tag and refused characters show an inline message, counters follow', async () => {
  const profile = device('Limits', { tags: ['x'] }), h = libraryHarness({ profiles: [profile] }), heard = captureAnnouncements();
  try {
    h.render(); await h.settle(); await open(h, profile.id);
    await typeInto(h, h.attr('tag-input'), 'X'); await press(h, h.attr('tag-input'), 'Enter'); assert.deepEqual(chips(h), ['x'], 'X is the same tag as x'); assert.equal(h.attr('tag-input').props.value, '');
    for (const tag of ['t1', 't2', 't3', 't4', 't5', 't6', 't7']) { await typeInto(h, h.attr('tag-input'), tag); await press(h, h.attr('tag-input'), 'Enter'); }
    assert.equal(chips(h).length, 8); assert.equal(text(allByData(h, 'tag-count')[0]), '8 of 8 tags'); assert.equal(allByData(h, 'tag-count')[0].props['data-profile-tag-count'], 8);
    await typeInto(h, h.attr('tag-input'), 'ninth'); await press(h, h.attr('tag-input'), 'Enter');
    assert.equal(chips(h).length, 8); assert.equal(byData(h, 'meta-error', 'tagLimit').props.children, 'A profile can have up to 8 tags.'); assert.equal(h.attr('tag-input').props['aria-invalid'], true);
    assert.equal(h.attr('tag-input').props.value, 'ninth', 'the typed text is kept so the user can fix it');
    assert.equal(h.nodes(node => node.props['data-profile-tag-suggestion'] !== undefined).length, 0, 'no suggestions once the limit is reached');
    await typeInto(h, h.attr('tag-input'), 'bad' + UNSAFE.rlo); await press(h, h.attr('tag-input'), 'Enter'); assert.equal(byData(h, 'meta-error', 'tagUnsafe').props.children, iw.tagUnsafe); assert.equal(chips(h).length, 8);
    await typeInto(h, h.attr('tag-input'), 'ok'); assert.equal(byData(h, 'meta-error', 'tagUnsafe'), undefined, 'typing clears the message');
    assert.equal(h.attr('tag-input').props.maxLength, 24, 'the field itself stops at 24 units'); assert.equal(h.nodes(node => node.props['data-profile-tag-length'] !== undefined)[0].props['data-profile-tag-length'], 2);
    await heard.flush(); assert.match(heard.all(), /The tag “X” is already added\./u); assert.match(heard.all(), /A profile can have up to 8 tags\./u);
  } finally { heard.stop(); h.unmount(); }
});

test('suggestions list the tags already used elsewhere (most used first), narrow while typing, exclude the tags already on the draft and add with one press', async () => {
  const a = device('A', { tags: ['eu', 'work'] }), b = device('B', { tags: ['work', 'travel'] }), c = device('C', { tags: ['work'] }), h = libraryHarness({ profiles: [a, b, c] });
  try {
    h.render(); await h.settle(); await open(h, c.id);
    const suggestions = () => h.nodes(node => node.props['data-profile-tag-suggestion'] !== undefined).map(node => node.props['data-profile-tag-suggestion']);
    assert.deepEqual(suggestions(), ['eu', 'travel'], 'work is already on this profile; ties by code unit order');
    await typeInto(h, h.attr('tag-input'), 'TRA'); assert.deepEqual(suggestions(), ['travel'], 'narrowed case- and accent-insensitively');
    const button = h.nodes(node => node.props['data-profile-tag-suggestion'] === 'travel')[0]; assert.equal(button.props['aria-label'], 'Add tag: travel');
    await click(h, button); assert.deepEqual(chips(h), ['travel', 'work']); assert.equal(h.attr('tag-input').props.value, 'TRA', 'the typed text stays');
    assert.equal(h.log.commits.length, 0);
  } finally { h.unmount(); }
});

test('two events handled before the next paint never start from a stale draft: fast typing, and a pasted list followed by Enter', async () => {
  const profile = device('Fast', { tags: ['kept'] }), h = libraryHarness({ profiles: [profile] });
  try {
    h.render(); await h.settle(); await open(h, profile.id);
    // The handlers of one rendered tree are called twice with no render in between, as a fast typist or a browser automation does.
    const field = h.attr('tag-input').props; field.onInput({ currentTarget: { value: 'one,' } }); field.onInput({ currentTarget: { value: 'two,' } });
    await h.settle(); assert.deepEqual(chips(h), ['kept', 'one', 'two'], 'the second tag did not overwrite the first');
    const again = h.attr('tag-input').props; again.onInput({ currentTarget: { value: 'three,four' } }); again.onKeyDown({ key: 'Enter', isComposing: false, preventDefault() {}, stopPropagation() {} });
    await h.settle(); assert.deepEqual(chips(h), ['four', 'kept', 'one', 'three', 'two'], 'Enter added the text the paste left in the field'); assert.equal(h.attr('tag-input').props.value, '');
    await press(h, h.attr('tag-input'), 'Enter'); assert.equal(h.log.commits.length, 0);
    // Save right after an edit sees that edit too.
    const save = h.attr('meta-save').props, note = h.attr('note-input').props; note.onInput({ currentTarget: { value: 'typed just now' } }); save.onClick(); await h.settle();
    assert.equal(savedNote(h, profile.id), 'typed just now', 'the note typed before the save'); assert.deepEqual(savedTags(h, profile.id), ['four', 'kept', 'one', 'three', 'two']);
  } finally { h.unmount(); }
});

test('the note: a counter against 500, line breaks allowed, refused characters block Save with a message, Save writes it once', async () => {
  const profile = device('Notes'), h = libraryHarness({ profiles: [profile] });
  try {
    h.render(); await h.settle(); await open(h, profile.id);
    const field = h.attr('note-input'); assert.equal(field.props.maxLength, 500); assert.equal(allByData(h, 'note-length')[0].props['data-profile-note-length'], 0);
    await typeInto(h, field, 'one' + LF + 'two'); assert.equal(allByData(h, 'note-length')[0].props['data-profile-note-length'], 7); assert.equal(byData(h, 'meta-error', 'noteUnsafe'), undefined);
    await typeInto(h, h.attr('note-input'), 'bell' + UNSAFE.bell); assert.ok(byData(h, 'meta-error', 'noteUnsafe')); assert.equal(h.attr('meta-save').props.disabled, true, 'a refused character blocks Save'); assert.equal(h.attr('note-input').props['aria-invalid'], true);
    await typeInto(h, h.attr('note-input'), 'bidi' + UNSAFE.rlo); assert.ok(byData(h, 'meta-error', 'noteUnsafe'));
    await typeInto(h, h.attr('note-input'), 'fine' + LF + 'note'); assert.equal(byData(h, 'meta-error', 'noteUnsafe'), undefined); await click(h, h.attr('meta-save'));
    assert.equal(savedNote(h, profile.id), 'fine' + LF + 'note'); assert.equal(h.log.commits.length, 1);
    assert.match(text(h.nodes(node => node.props['data-profile-meta'] === profile.id)[0]), /included when you export the library/u, 'the note is said to travel with an export');
  } finally { h.unmount(); }
});

test('a failed commit keeps the draft; the text still in the tag field is added by Save; a stored unsafe tag does not block saving the note', async () => {
  const profile = device('Failing', { tags: ['kept'] }), h = libraryHarness({ profiles: [profile] });
  try {
    h.render(); await h.settle(); await open(h, profile.id);
    await typeInto(h, h.attr('tag-input'), 'pending'); h.state.failNext = true; await click(h, h.attr('meta-save'));
    assert.equal(h.log.commits.length, 1); assert.deepEqual(savedTags(h, profile.id), ['kept'], 'nothing was stored'); assert.ok(h.attr('meta-unsaved'), 'the draft is still there'); assert.equal(h.attr('tag-input').props.value, 'pending');
    await click(h, h.attr('meta-save')); assert.deepEqual(savedTags(h, profile.id), ['kept', 'pending'], 'the retry saved the pending text as a tag too'); assert.equal(h.attr('tag-input').props.value, '');
  } finally { h.unmount(); }
  const old = { ...device('Old', {}), tags: ['old' + UNSAFE.lrm] }, g = libraryHarness({ profiles: [], base: null });
  try {
    g.env.saved = { ...g.env.saved, configuration: { ...g.env.saved.configuration, fingerprintProfiles: [old] } }; g.env.draft = clone(g.env.saved.configuration); g.render(); await g.settle(); await open(g, old.id);
    await typeInto(g, g.attr('note-input'), 'a note'); await click(g, g.attr('meta-save'));
    assert.deepEqual(savedTags(g, old.id), ['old' + UNSAFE.lrm], 'the stored tag is kept as it was'); assert.equal(savedNote(g, old.id), 'a note');
  } finally { g.unmount(); }
});

test('while the library is locked the section cannot be changed, a removed profile takes its draft away and a profile switch keeps each draft', async () => {
  const one = device('One', { tags: ['a'] }), two = device('Two', { tags: ['b'] }), h = libraryHarness({ profiles: [one, two] });
  try {
    h.render(); await h.settle(); await open(h, one.id); await typeInto(h, h.attr('tag-input'), 'draft1'); await press(h, h.attr('tag-input'), 'Enter');
    await open(h, two.id); assert.equal(metaOf(h, two.id) !== undefined && metaOf(h, one.id) === undefined, true); assert.deepEqual(chips(h), ['b'], 'the other profile shows its own tags');
    await open(h, one.id); assert.deepEqual(chips(h), ['a', 'draft1'], 'the first draft was kept for the first profile');
    h.state.locked = true; h.render(); await h.settle();
    assert.equal(h.attr('tag-input').props.disabled, true); assert.equal(h.attr('meta-save').props.disabled, true); assert.equal(h.nodes(node => node.props['data-profile-tag-remove'] !== undefined).every(node => node.props.disabled === true), true);
    h.state.locked = false; h.external(next => { next.fingerprintProfiles = next.fingerprintProfiles.filter(profile => profile.id !== one.id); }); await h.settle();
    assert.equal(peek(h), undefined, 'the Peek of a removed profile closes'); await open(h, two.id); assert.deepEqual(chips(h), ['b']);
  } finally { h.unmount(); }
});

test('leaving the page with unsaved tags or a note asks first; Ctrl/Cmd+S inside the section saves; elsewhere it is not taken', async () => {
  const listeners = [], add = globalThis.addEventListener, remove = globalThis.removeEventListener;
  globalThis.addEventListener = (type, listener) => listeners.push([type, listener]); globalThis.removeEventListener = (type, listener) => { const index = listeners.findIndex(entry => entry[1] === listener); if (index >= 0) listeners.splice(index, 1); };
  const profile = device('Guard'), h = libraryHarness({ profiles: [profile] });
  try {
    h.render(); await h.settle(); await open(h, profile.id);
    const guard = listeners.find(([type]) => type === 'beforeunload')?.[1], leave = () => { const event = { prevented: false, preventDefault() { this.prevented = true; } }; guard(event); return event.prevented; };
    assert.equal(leave(), false); await typeInto(h, h.attr('note-input'), 'unsaved'); assert.equal(leave(), true, 'unsaved note'); await click(h, h.attr('meta-discard')); assert.equal(leave(), false);
    await typeInto(h, h.attr('tag-input'), 'half'); assert.equal(leave(), true, 'text left in the tag field counts');
    // Ctrl+S with focus inside the section.
    const inside = { closest: selector => selector === '[data-profile-meta]' ? { getAttribute: () => profile.id } : null }, outside = { closest: () => null };
    const stroke = target => { const event = { key: 's', code: 'KeyS', ctrlKey: true, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; h.keydown(event); return event.defaultPrevented; };
    assert.equal(stroke(outside), false, 'not taken outside the section'); assert.equal(h.log.commits.length, 0);
    assert.equal(stroke(inside), true); await h.settle(); assert.equal(h.log.commits.length, 1); assert.deepEqual(savedTags(h, profile.id), ['half']);
    assert.equal(stroke(inside), false, 'nothing left to save, so the browser keeps the keystroke'); assert.equal(leave(), false);
  } finally { h.unmount(); globalThis.addEventListener = add; globalThis.removeEventListener = remove; }
});

test('tag filters: one group with counts, OR inside the group, AND with the other groups, a removable chip, and tags with quotes cannot break the focus selector', async () => {
  const a = device('A', { tags: ['work', 'eu'] }), b = device('B', { tags: ['work', 'say "hi"'] }), c = device('C', { tags: ['eu'], seed: 9, input: { browser: 'edge' } }), d = device('D'), h = libraryHarness({ profiles: [a, b, c, d] });
  try {
    h.render(); await h.settle(); h.attr('filters-toggle').props.onClick(); await h.settle();
    const group = h.nodes(node => node.props['data-profile-filter-group'] === LIBRARY_TAG_GROUP)[0]; assert.ok(group, 'a tag group exists once any profile has tags'); assert.equal(text(descend(group, node => node.type === 'legend')), 'Tag');
    const option = value => h.nodes(node => node.props['data-profile-filter'] === LIBRARY_TAG_GROUP + ':' + value)[0], count = value => text(descend(option(value), node => node.props.class === 'fingerprint-filter__count'));
    assert.equal(count('work'), '2'); assert.equal(count('eu'), '2'); assert.equal(count('say "hi"'), '1'); assert.equal(h.nodes(node => typeof node.props['data-profile-filter'] === 'string' && node.props['data-profile-filter'].startsWith('tag:')).length, 3);
    option('work').props.onClick(); await h.settle(); assert.deepEqual(rowIds(h).sort(), [a.id, b.id].sort());
    option('eu').props.onClick(); await h.settle(); assert.deepEqual(rowIds(h).sort(), [a.id, b.id, c.id].sort(), 'two tags of one group are an OR');
    // AND with another group: only the Edge profile of the three.
    h.nodes(node => node.props['data-profile-filter'] === 'browser:edge')[0].props.onClick(); await h.settle(); assert.deepEqual(rowIds(h), [c.id], 'another group narrows the result');
    assert.equal(count('work'), '0', 'the counts follow the other filters'); assert.ok(option('work'), 'a tag that is switched on stays listed');
    const chip = h.nodes(node => node.props['data-profile-filter-chip'] === 'tag:work')[0]; assert.equal(chip.props['aria-label'], 'Remove filter: Tag: work');
    chip.props.onClick(); await h.settle(); assert.equal(h.nodes(node => node.props['data-profile-filter-chip'] === 'tag:work').length, 0);
    // A tag with quotes: switching it on and removing the chip moves the focus through a selector that must be escaped.
    h.attr('clear-filters').props.onClick(); await h.settle();
    option('say "hi"').props.onClick(); await h.settle(); const quoted = h.nodes(node => node.props['data-profile-filter-chip'] === 'tag:say "hi"')[0]; assert.ok(quoted);
    quoted.props.onClick(); await h.settle(); assert.equal(h.nodes(node => node.props['data-profile-filter-chip'] === 'tag:say "hi"').length, 0);
    const quote = String.fromCharCode(34), slash = String.fromCharCode(92);
    // Removing a chip focuses the NEXT chip through an attribute selector: its value is escaped, so a quote in a tag cannot end the selector early.
    option('work').props.onClick(); await h.settle(); option('say ' + quote + 'hi' + quote).props.onClick(); await h.settle();
    h.nodes(node => node.props['data-profile-filter-chip'] === 'tag:work')[0].props.onClick(); await h.settle();
    assert.equal(h.root.selectors.at(-1), '[data-profile-filter-chip=' + quote + 'tag:say ' + slash + quote + 'hi' + slash + quote + quote + ']', 'the quote inside the tag is escaped');
    h.nodes(node => node.props['data-profile-filter-chip'] === 'tag:say ' + quote + 'hi' + quote)[0].props.onClick(); await h.settle();
    assert.equal(attributeValue('say ' + quote + 'hi' + quote + slash), 'say ' + slash + quote + 'hi' + slash + quote + slash + slash);
  } finally { h.unmount(); }
  const none = libraryHarness({ profiles: [device('Plain')] });
  try { none.render(); await none.settle(); none.attr('filters-toggle').props.onClick(); await none.settle(); assert.equal(none.nodes(node => node.props['data-profile-filter-group'] === LIBRARY_TAG_GROUP).length, 0, 'no tags, no group'); } finally { none.unmount(); }
});

test('the tag filter lists the 64 most used tags (and every tag that is switched on) so a library of 128 profiles keeps the panel small', async () => {
  const profiles = Array.from({ length: 20 }, (_, index) => device('P' + index, { tags: Array.from({ length: 8 }, (_, tag) => 't' + String(index * 8 + tag).padStart(3, '0')) })), h = libraryHarness({ profiles });
  try {
    h.render(); await h.settle(); h.attr('filters-toggle').props.onClick(); await h.settle();
    const listed = () => h.nodes(node => typeof node.props['data-profile-filter'] === 'string' && node.props['data-profile-filter'].startsWith('tag:')).map(node => node.props['data-profile-filter'].slice(4));
    assert.equal(listed().length, LIBRARY_TAG_FILTER_MAX); assert.equal(LIBRARY_TAG_FILTER_MAX, 64);
  } finally { h.unmount(); }
});

test('search finds a profile by its tags and by its note, case-insensitively, next to the label and the facts', async () => {
  const a = device('Office desk', { tags: ['Work'], note: 'Used for the Berlin invoices' }), b = device('Travel laptop', { tags: ['trip', 'EU'] }), c = device('Spare'), h = libraryHarness({ profiles: [a, b, c] });
  try {
    h.render(); await h.settle();
    const search = async query => { h.attr('search').props.onInput({ currentTarget: { value: query } }); await h.settle(); return rowIds(h).sort(); };
    assert.deepEqual(await search('work'), [a.id], 'a tag, any case'); assert.deepEqual(await search('WORK'), [a.id]); assert.deepEqual(await search('eu'), [b.id]);
    assert.deepEqual(await search('invoices'), [a.id], 'a word of the note'); assert.deepEqual(await search('berlin invoices'), [a.id], 'several words, all must match'); assert.deepEqual(await search('inv'), [a.id], 'a word start');
    assert.deepEqual(await search('office'), [a.id], 'the label still matches'); assert.deepEqual(await search('trip eu'), [b.id]); assert.deepEqual(await search('nothing-like-this'), []);
  } finally { h.unmount(); }
  const entries = [{ profile: 'p', text: 'office work used for the berlin invoices', words: ['office', 'work', 'used', 'for', 'the', 'berlin', 'invoices'] }];
  assert.deepEqual(searchProfiles(entries, 'Work Inv'), ['p']);
});

test('the Undo line goes stale when only the tags of another profile changed meanwhile, because a change of tags or note is a change of the library', async () => {
  const a = device('A'), b = device('B', { tags: ['x'] }), h = libraryHarness({ profiles: [a, b] });
  try {
    h.render(); await h.settle(); inRow(h, a.id, 'delete').props.onClick(); await h.settle();
    h.external(next => { next.fingerprintProfiles.find(profile => profile.id === b.id).tags = ['x', 'y']; }); await h.settle();
    h.attr('undo-button').props.onClick(); await h.settle();
    assert.equal(h.nodes(node => node.props['data-profile-library-notice'] === 'stale').length, 1, 'newer changes are never overwritten'); assert.deepEqual(rowIds(h), [b.id]);
  } finally { h.unmount(); }
});
