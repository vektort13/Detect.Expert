// ADR-107 round 5: the Peek's "Proxy of this profile" (a machine-local link to a saved proxy), "Apply with proxy" (the user's click is the explicit
// connect) and "Apply temporarily".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIBRARY_RESULT_MS } from '../../apps/production-extension/fingerprint-library-ui.js';
import { fingerprintIdentityLabels } from '../../apps/production-extension/fingerprint-identity-labels.js';
import { BUNDLES_KEY } from '../../apps/production-extension/identity-bundles.js';
import { device, fakeStorage } from './fingerprint-identity-fixtures.mjs';
import { libraryHarness, inRow, text, descend, byData, allByData, click, captureAnnouncements } from './fingerprint-library-harness.mjs';

const iw = fingerprintIdentityLabels('en');
const pid = number => 'fp-' + number.toString(16).padStart(32, '0');
const PROXIES = { profiles: [
  { id: 'proxy-de', name: 'Berlin exit', type: 'socks5', host: 'de.example', port: 1080, native: true, country: 'DE' },
  { id: 'proxy-us', name: 'Plain HTTP', type: 'http', host: 'us.example', port: 8080, native: false },
  { id: 'proxy-vl', name: 'Hidden endpoint', type: 'vless', host: null, port: null, native: true }], connectedId: null, privacy: false };
const open = async (h, id) => { inRow(h, id, 'pick').props.onClick(); await h.settle(); };
const section = (h, id) => h.nodes(node => node.props['data-profile-bundle'] === id)[0];
const select = h => h.attr('bundle-select');
const choose = async (h, value) => { select(h).props.onChange({ currentTarget: { value } }); await h.settle(); };
const stored = storage => storage.data.local[BUNDLES_KEY]?.links ?? {};
const states = h => allByData(h, 'bundle-state').map(node => node.props['data-profile-bundle-state']);

test('without the Proxy workspace API the section is not offered at all', async () => {
  const profile = device('P', { id: pid(1) }), h = libraryHarness({ profiles: [profile] });
  try { h.render(); await h.settle(); await open(h, profile.id); assert.equal(section(h, profile.id), undefined); } finally { h.unmount(); }
});

test('states: loading, unavailable (with Refresh), nothing saved (with a link to the workspace) and the select once the list is known', async () => {
  const profile = device('P', { id: pid(1) }), h = libraryHarness({ profiles: [profile], proxies: PROXIES });
  try {
    h.render(); await h.settle(); await open(h, profile.id);
    assert.equal(h.proxyState.loads, 1, 'one load per mount'); assert.ok(select(h)); const options = select(h).props.children;
    assert.deepEqual(options.map(option => option.props.value), ['', 'proxy-de', 'proxy-us', 'proxy-vl']); assert.equal(options[0].props.children, 'No proxy');
    assert.equal(options[1].props.children, 'Berlin exit · SOCKS5 de.example:1080 · Germany', 'name, protocol, endpoint and the user\'s own country tag'); assert.equal(options[2].props.children, 'Plain HTTP · HTTP us.example:8080');
    assert.equal(options[3].props.children, 'Hidden endpoint · VLESS', 'a profile whose endpoint is hidden shows none'); assert.equal(select(h).props.value, '');
    assert.match(text(section(h, profile.id)), /stays on this computer and is not exported/u);
  } finally { h.unmount(); }
  const loading = libraryHarness({ profiles: [profile], proxies: PROXIES });
  try {
    loading.render(); inRow(loading, profile.id, 'pick').props.onClick(); loading.render(); loading.render();
    assert.deepEqual(states(loading), ['bundleLoading'], 'until the list arrives the section says so'); assert.equal(select(loading), undefined);
    await loading.settle(); assert.deepEqual(states(loading), []); assert.ok(select(loading));
  } finally { loading.unmount(); }
  const down = libraryHarness({ profiles: [profile], proxies: false, storage: fakeStorage({ local: { [BUNDLES_KEY]: { version: 1, links: { [pid(1)]: 'proxy-de' } } } }) });
  try {
    down.render(); await down.settle(); await open(down, profile.id);
    assert.deepEqual(states(down), ['bundleUnavailable']); assert.equal(select(down), undefined, 'no list, no select'); assert.equal(text(byData(down, 'bundle-linked', 'proxy-de')), 'proxy-de', 'the stored link is still shown by its id');
    assert.ok(down.attr('bundle-refresh') && down.attr('bundle-unlink')); down.proxyState.list = PROXIES; await click(down, down.attr('bundle-refresh'));
    assert.ok(down.trace.includes('proxies.refresh')); assert.ok(select(down), 'Refresh found the workspace'); assert.equal(select(down).props.value, 'proxy-de');
  } finally { down.unmount(); }
  const empty = libraryHarness({ profiles: [profile], proxies: { profiles: [], connectedId: null, privacy: false } });
  try { empty.render(); await empty.settle(); await open(empty, profile.id); assert.deepEqual(states(empty), ['bundleNoProxies']); const link = empty.attr('bundle-open'); assert.equal(link.props.href, '#proxy'); assert.equal(text(link), iw.bundleOpen); } finally { empty.unmount(); }
});

test('choosing a proxy writes the link (one key, version 1), announces it and survives a new page; "No proxy" removes it', async () => {
  const one = device('One', { id: pid(1) }), two = device('Two', { id: pid(2) }), storage = fakeStorage(), h = libraryHarness({ profiles: [one, two], proxies: PROXIES, storage }), heard = captureAnnouncements();
  try {
    h.render(); await h.settle(); await open(h, one.id);
    await choose(h, 'proxy-de'); assert.deepEqual(stored(storage), { [one.id]: 'proxy-de' }); assert.equal(storage.data.local[BUNDLES_KEY].version, 1); assert.equal(select(h).props.value, 'proxy-de'); assert.equal(select(h).props.title, select(h).props.children.find(option => option.props.value === 'proxy-de').props.children, 'a clipped closed select keeps the whole text of the chosen proxy as its tooltip');
    assert.equal(h.log.commits.length, 0, 'the link is not part of the configuration'); assert.deepEqual(Object.keys(storage.data.local), [BUNDLES_KEY]);
    await heard.flush(); assert.match(heard.all(), /Proxy linked: Berlin exit\./u);
    await choose(h, ''); assert.deepEqual(stored(storage), {}); assert.equal(Object.hasOwn(storage.data.local, BUNDLES_KEY), false, 'no links, no key'); await heard.flush(); assert.match(heard.all(), /Proxy link removed\./u);
    await choose(h, 'proxy-us');
  } finally { heard.stop(); h.unmount(); }
  const again = libraryHarness({ profiles: [one, two], proxies: PROXIES, storage });
  try { again.render(); await again.settle(); await open(again, one.id); assert.equal(select(again).props.value, 'proxy-us', 'the link is machine-local storage, read again by a new page'); } finally { again.unmount(); }
});

test('a proxy that another profile already uses asks for an explicit "share on purpose" before it is linked again', async () => {
  const one = device('First profile', { id: pid(1) }), two = device('Second', { id: pid(2) }), storage = fakeStorage({ local: { [BUNDLES_KEY]: { version: 1, links: { [pid(1)]: 'proxy-de' } } } }), h = libraryHarness({ profiles: [one, two], proxies: PROXIES, storage });
  try {
    h.render(); await h.settle(); await open(h, two.id);
    await choose(h, 'proxy-de');
    const warning = byData(h, 'bundle-shared', 'proxy-de'); assert.ok(warning); assert.deepEqual(stored(storage), { [one.id]: 'proxy-de' }, 'nothing is written by the selection alone'); assert.equal(select(h).props.value, 'proxy-de', 'the select shows the pending choice');
    assert.equal(descend(warning, node => node.type === 'bdi').props.children, 'First profile', 'it names the profile that owns the exit'); assert.match(text(warning), /One exit per identity is the usual choice/u);
    assert.equal(h.attr('bundle-link').props.disabled, true, 'not before the box is ticked');
    h.attr('bundle-confirm').props.onChange({ currentTarget: { checked: true } }); await h.settle(); assert.equal(h.attr('bundle-link').props.disabled, false);
    await click(h, h.attr('bundle-link')); assert.deepEqual(stored(storage), { [one.id]: 'proxy-de', [two.id]: 'proxy-de' }); assert.equal(byData(h, 'bundle-shared', 'proxy-de'), undefined);
    // Cancel leaves everything as it was.
    await choose(h, 'proxy-de'); assert.equal(byData(h, 'bundle-shared', 'proxy-de'), undefined, 'choosing the proxy this profile already has is no change'); assert.equal(h.attr('bundle-link'), undefined);
    await open(h, one.id); await choose(h, 'proxy-us'); assert.deepEqual(stored(storage), { [one.id]: 'proxy-us', [two.id]: 'proxy-de' });
    await choose(h, 'proxy-de'); assert.ok(byData(h, 'bundle-shared', 'proxy-de')); await click(h, h.attr('bundle-cancel')); assert.equal(byData(h, 'bundle-shared', 'proxy-de'), undefined); assert.equal(stored(storage)[one.id], 'proxy-us');
  } finally { h.unmount(); }
});

test('a link to a proxy that is gone is shown as such and can be removed; writes prune links of deleted profiles and vanished proxies, never touching the proxy list', async () => {
  const one = device('One', { id: pid(1) }), two = device('Two', { id: pid(2) }), storage = fakeStorage({ local: { [BUNDLES_KEY]: { version: 1, links: { [pid(1)]: 'proxy-gone', [pid(9)]: 'proxy-de', [pid(2)]: 'proxy-us' } } } }), h = libraryHarness({ profiles: [one, two], proxies: PROXIES, storage });
  try {
    h.render(); await h.settle(); await open(h, one.id);
    assert.deepEqual(states(h), ['bundleMissing']); assert.equal(select(h).props.value, '', 'the select does not pretend');
    assert.deepEqual(stored(storage), { [pid(1)]: 'proxy-gone', [pid(9)]: 'proxy-de', [pid(2)]: 'proxy-us' }, 'a read prunes nothing');
    await click(h, h.attr('bundle-unlink'));
    assert.deepEqual(stored(storage), { [pid(2)]: 'proxy-us' }, 'the write dropped the link of the profile that no longer exists as well'); assert.equal(h.proxyState.loads, 1);
    await open(h, two.id); await choose(h, 'proxy-de'); assert.deepEqual(stored(storage), { [pid(2)]: 'proxy-de' });
  } finally { h.unmount(); }
  const stale = libraryHarness({ profiles: [one], proxies: PROXIES, storage: fakeStorage({ local: { [BUNDLES_KEY]: { version: 1, links: { [pid(1)]: 'proxy-us', [pid(3)]: 'proxy-lost' } } } }) });
  try { stale.render(); await stale.settle(); await open(stale, one.id); await choose(stale, 'proxy-de'); assert.deepEqual(stored(stale.storage), { [pid(1)]: 'proxy-de' }, 'a link to a vanished proxy of another profile goes with the write, because the list is known'); } finally { stale.unmount(); }
});

test('the hint about the proxy country uses the LINKED proxy of that profile: raised in the Peek and on the row, with the country in the text, silent for another or untagged proxy', async () => {
  const tokyo = device('Tokyo identity', { id: pid(1), rows: { timezone: { timeZone: 'Asia/Tokyo', offsetMinutes: -540 }, 'navigator-language': 'ja-JP' } }), storage = fakeStorage({ local: { [BUNDLES_KEY]: { version: 1, links: { [pid(1)]: 'proxy-de' } } } });
  const h = libraryHarness({ profiles: [tokyo], proxies: PROXIES, storage });
  try {
    h.render(); await h.settle(); h.flushIdle(); await h.settle(); await open(h, tokyo.id);
    const issue = h.nodes(node => node.props['data-profile-peek-issue'] === 'proxy-country-region')[0]; assert.ok(issue, 'the hint appears in the Peek'); assert.equal(issue.props['data-severity'], 'warning');
    assert.match(text(descend(issue, node => node.type === 'span')), /Germany \(DE\)/u, 'the country tag, in the UI language'); assert.doesNotMatch(text(issue), /\{country\}/u);
    assert.match(text(descend(rowFitPill(h, tokyo.id), () => true)), /conflict/u);
    await choose(h, 'proxy-us'); h.flushIdle(); await h.settle(); assert.equal(h.nodes(node => node.props['data-profile-peek-issue'] === 'proxy-country-region').length, 0, 'a proxy without a tag implies nothing');
    await choose(h, ''); h.flushIdle(); await h.settle(); assert.equal(h.nodes(node => node.props['data-profile-peek-issue'] === 'proxy-country-region').length, 0, 'no link, no hint');
  } finally { h.unmount(); }
  const japan = libraryHarness({ profiles: [tokyo], proxies: { ...PROXIES, profiles: [{ ...PROXIES.profiles[0], country: 'JP' }, ...PROXIES.profiles.slice(1)] }, storage: fakeStorage({ local: { [BUNDLES_KEY]: { version: 1, links: { [pid(1)]: 'proxy-de' } } } }) });
  try { japan.render(); await japan.settle(); japan.flushIdle(); await japan.settle(); await open(japan, tokyo.id); assert.equal(japan.nodes(node => node.props['data-profile-peek-issue'] === 'proxy-country-region').length, 0, 'a matching country'); } finally { japan.unmount(); }
  function rowFitPill(harness, id) { return descend(harness.nodes(node => node.props['data-profile-row'] === id)[0], node => node.props['data-profile-fit'] !== undefined); }
});

test('Apply with proxy: the permissions are asked inside the click (before the commit), the profile is applied through the normal commit, then the proxy is connected; the two results are reported separately', async () => {
  const profile = device('With exit', { id: pid(1), rows: { 'hardware-concurrency': 6 } }), storage = fakeStorage({ local: { [BUNDLES_KEY]: { version: 1, links: { [pid(1)]: 'proxy-de' } } } }), h = libraryHarness({ profiles: [profile], proxies: PROXIES, storage }), heard = captureAnnouncements();
  try {
    h.render(); await h.settle(); await open(h, profile.id); h.trace.length = 0;
    const button = h.attr('peek-apply-proxy'); assert.ok(button); assert.equal(button.props.title, iw.bundleApplyHint); assert.equal(text(button), iw.bundleApply);
    await click(h, button);
    assert.deepEqual(h.trace.filter(entry => ['proxies.begin:proxy-de', 'commit', 'proxies.finish'].includes(entry)), ['proxies.begin:proxy-de', 'commit', 'proxies.finish'], 'access first, the profile second, the connection last');
    const applied = h.env.saved.configuration.apis.find(row => row.id === 'hardware-concurrency'); assert.equal(applied.mode, 'custom'); assert.equal(applied.selected.value, 6, 'the profile is applied');
    assert.deepEqual(h.log.connects, [['proxy-de', { ok: true }]]);
    const result = h.attr('bundle-result'); assert.equal(text(descend(result, node => node['props']['data-profile-bundle-result-profile'] === 'ok')), 'Profile applied: “With exit”.'); assert.equal(text(descend(result, node => node.props['data-profile-bundle-result-proxy'] === 'ok')), 'Proxy connected: Berlin exit.');
    await heard.flush(); assert.match(heard.all(), /Profile applied: “With exit”\./u); assert.match(heard.all(), /Proxy connected: Berlin exit\./u);
    assert.equal(h.log.staged.length, 1);
  } finally { heard.stop(); h.unmount(); }
});

test('if the proxy cannot be connected the profile stays applied and the result says so plainly, with the code; if the profile cannot be applied no connection is made', async () => {
  const profile = device('With exit', { id: pid(1), rows: { 'hardware-concurrency': 6 } }), storage = () => fakeStorage({ local: { [BUNDLES_KEY]: { version: 1, links: { [pid(1)]: 'proxy-us' } } } });
  const h = libraryHarness({ profiles: [profile], proxies: PROXIES, storage: storage() }), heard = captureAnnouncements();
  try {
    h.render(); await h.settle(); await open(h, profile.id); h.proxyState.answers.push({ ok: false, code: 'permission-denied' });
    await click(h, h.attr('peek-apply-proxy'));
    assert.equal(h.env.saved.configuration.apis.find(row => row.id === 'hardware-concurrency').selected.value, 6, 'the profile stays applied');
    const proxyLine = descend(h.attr('bundle-result'), node => node.props['data-profile-bundle-result-proxy'] !== undefined); assert.equal(proxyLine.props['data-profile-bundle-result-proxy'], 'permission-denied'); assert.match(proxyLine.props.class, /is-failed/u);
    assert.equal(text(proxyLine), 'Proxy not connected (permission-denied). The profile stays applied; open the Proxy workspace to see why.');
    await heard.flush(); assert.match(heard.all(), /Proxy not connected \(permission-denied\)/u);
  } finally { heard.stop(); h.unmount(); }
  const refused = libraryHarness({ profiles: [profile], proxies: PROXIES, storage: storage() });
  try {
    refused.render(); await refused.settle(); await open(refused, profile.id); refused.trace.length = 0; refused.state.failNext = true;
    await click(refused, refused.attr('peek-apply-proxy'));
    assert.deepEqual(refused.trace.filter(entry => entry.startsWith('proxies.')), ['proxies.begin:proxy-us', 'proxies.cancel'], 'access was started inside the click, then given up'); assert.deepEqual(refused.log.connects, []);
    assert.equal(allByData(refused, 'bundle-result').length, 0, 'the panel shows the commit error itself');
  } finally { refused.unmount(); }
});

test('Apply with proxy and Apply temporarily wait for pending changes, busy and locked states with a reason; they are not offered without a link or a temporary API', async () => {
  const linked = device('Linked', { id: pid(1) }), plain = device('Plain', { id: pid(2) }), storage = fakeStorage({ local: { [BUNDLES_KEY]: { version: 1, links: { [pid(1)]: 'proxy-de' } } } });
  const h = libraryHarness({ profiles: [linked, plain], proxies: PROXIES, storage });
  try {
    h.render(); await h.settle(); await open(h, plain.id); assert.equal(h.attr('peek-apply-proxy'), undefined, 'no link, no button'); assert.ok(h.attr('peek-temporary'));
    await open(h, linked.id); assert.ok(h.attr('peek-apply-proxy'));
    for (const [key, label] of [['dirty', 'pending changes'], ['busy', 'busy'], ['locked', 'locked']]) {
      h.state[key] = true; h.render(); await h.settle(); h.trace.length = 0;
      for (const name of ['peek-temporary', 'peek-apply-proxy']) { const control = h.attr(name); assert.equal(control.props['aria-disabled'], true, label + ' ' + name); control.props.onClick(); await h.settle(); }
      assert.deepEqual(h.trace, [], label + ': neither action started anything'); assert.equal(h.log.temporary.length, 0);
      if (key === 'dirty') { assert.equal(text(h.attr('peek-reason')), iw.tempDirty); assert.equal(h.attr('peek-temporary').props['aria-describedby'], h.attr('peek-reason').props.id); } else assert.equal(h.attr('peek-reason'), undefined);
      h.state[key] = false; h.render(); await h.settle();
    }
    assert.equal(h.attr('peek-temporary').props['aria-disabled'], false);
  } finally { h.unmount(); }
  const without = libraryHarness({ profiles: [plain], temporary: false });
  try { without.render(); await without.settle(); await open(without, plain.id); assert.equal(without.attr('peek-temporary'), undefined, 'no temporary API, no button'); } finally { without.unmount(); }
});

test('Apply temporarily hands the profile to the panel; the outcome line of an earlier apply goes away with it', async () => {
  const profile = device('Trip', { id: pid(1) }), h = libraryHarness({ profiles: [profile], proxies: PROXIES, storage: fakeStorage({ local: { [BUNDLES_KEY]: { version: 1, links: { [pid(1)]: 'proxy-de' } } } }) });
  try {
    h.render(); await h.settle(); await open(h, profile.id);
    await click(h, h.attr('peek-apply-proxy')); assert.ok(h.attr('bundle-result'));
    await click(h, h.attr('peek-temporary')); assert.deepEqual(h.log.temporary, [profile.id]); assert.equal(h.attr('bundle-result'), undefined, 'a new action clears the old result');
    await click(h, h.attr('peek-apply-proxy')); assert.ok(h.attr('bundle-result')); h.advance(LIBRARY_RESULT_MS - 1); assert.ok(h.attr('bundle-result')); h.advance(2); assert.equal(h.attr('bundle-result'), undefined, 'the result leaves after twelve seconds');
  } finally { h.unmount(); }
});
