// E22-08: typed profile edits and native-policy permission gestures are independent.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWebRtcConfigurationUi, formatWebRtcProfile, readWebRtcNetworkState, webRtcFirefoxBuild, webRtcPolicyChoices, webRtcPolicyLabelKey, WEBRTC_HOST_MDNS, WEBRTC_NETWORK_POLICIES, WEBRTC_PROFILE_DEFAULT } from '../../apps/production-extension/webrtc-configuration-ui.js';
import { WEBRTC_UI_MESSAGES, WEBRTC_UI_KEYS, applyWebRtcCopy } from '../production-locales-webrtc.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { parseApiValueInput } from '../../apps/production-extension/api-configuration-ui.js';
import { API_CONFIG_CATALOG, createApiConfiguration, exportApiConfiguration, importApiConfiguration, updateApiConfiguration } from '../../apps/production-extension/api-configuration.js';

const clone = value => structuredClone(value), turn = () => new Promise(resolve => setImmediate(resolve));
function harness(component, initialProps, locale = 'en') {
  const slots = [], effects = []; let cursor = 0, dirty = true, tree, props = initialProps;
  const hooks = {
    h: (type, props) => ({ type, props }),
    useState(initial) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; dirty = true; }]; },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } }
  };
  const ui = createWebRtcConfigurationUi({ ...hooks, translate: key => WEBRTC_UI_MESSAGES[locale][key] ?? key });
  function render() { cursor = 0; dirty = false; tree = ui[component](props); while (effects.length) effects.shift()(); }
  function nodes(predicate) { const found = []; const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!node?.props) return; if (predicate(node)) found.push(node); visit(node.props.children); }; visit(tree); return found; }
  const attr = (key, value = true) => nodes(node => node.props[key] === value)[0];
  return { render, nodes, attr, update(next) { props = { ...props, ...next }; render(); }, async settle() { for (let count = 0; count < 5; count++) { if (dirty) render(); await turn(); } if (dirty) render(); }, unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}
const network = (status, desired = 'system', value = null) => ({ desired, status, value, levelOfControl: value === null ? null : 'controlled_by_this_extension' });

test('typed RTC fields edit the complete profile without introducing server credentials or a certificate fingerprint', () => {
  let value = clone(WEBRTC_PROFILE_DEFAULT); const original = clone(value), changes = [];
  const h = harness('WebRtcProfileFields', { value, onChange: next => changes.push(next) }); h.render();
  assert.equal(h.nodes(node => node.type === 'input' && node.props.type === 'text').length, 6);
  assert.deepEqual(h.nodes(node => node.props['data-webrtc-family']).map(node => node.props['data-webrtc-family']), ['ipv4', 'ipv6']);
  assert.equal(changes.length, 0, 'opening the default profile does not activate address replacement');
  assert.equal(h.attr('data-webrtc-field', 'addresses').props.checked, false);
  for (const [key, text] of Object.entries({ 'ipv4:host': '192.0.2.1', 'ipv6:stun': '2001:db8::2', 'ipv4:turn': 'not-a-valid-address' })) {
    const field = h.attr('data-webrtc-field', key); assert.equal(field.props.dir, 'ltr'); assert.equal(field.props.disabled, false); assert.equal(field.props.maxLength, key.startsWith('ipv4:') ? 15 : 45);
    field.props.onInput({ currentTarget: { value: text } }); value = changes.at(-1); h.update({ value });
    assert.equal(h.attr('data-webrtc-field', 'addresses').props.checked, true, 'typing activates only the local profile');
  }
  assert.equal(value.addresses.ipv4.turn, 'not-a-valid-address', 'an incomplete typed draft remains editable until the modal validates Save');
  h.attr('data-webrtc-field', 'iceTransportPolicy').props.onChange({ currentTarget: { value: 'relay' } }); value = changes.at(-1); h.update({ value });
  h.attr('data-webrtc-field', 'devices').props.onChange({ currentTarget: { checked: true } }); value = changes.at(-1); h.update({ value });
  assert.equal(h.attr('data-webrtc-field', 'deviceLifetime').props.value, 'session');
  h.attr('data-webrtc-field', 'deviceLifetime').props.onChange({ currentTarget: { value: 'site' } }); value = changes.at(-1); h.update({ value });
  h.attr('data-webrtc-field', 'certificates').props.onChange({ currentTarget: { checked: true } }); value = changes.at(-1); h.update({ value });
  assert.deepEqual(value, { addresses: { ipv4: { host: '192.0.2.1', stun: null, turn: 'not-a-valid-address' }, ipv6: { host: null, stun: '2001:db8::2', turn: null } }, iceTransportPolicy: 'relay', randomizeDevices: true, deviceLifetime: 'site', freshCertificates: true });
  h.attr('data-webrtc-field', 'addresses').props.onChange({ currentTarget: { checked: false } }); value = changes.at(-1); h.update({ value }); assert.equal(value.addresses, null);
  assert.equal(h.nodes(node => node.type === 'input' && node.props.type === 'text').length, 6, 'disabling replacement never hides the inputs');
  assert.equal(h.attr('data-webrtc-field', 'ipv6:stun').props.value, '2001:db8::2');
  h.attr('data-webrtc-field', 'addresses').props.onChange({ currentTarget: { checked: true } }); assert.equal(changes.at(-1).addresses.ipv4.host, '192.0.2.1', 'the modal remembers its unsaved address edits');
  assert.deepEqual(original, WEBRTC_PROFILE_DEFAULT); assert.equal(h.nodes(node => node.props.type === 'password' || /credential|fingerprint|privatekey/i.test(node.props['data-webrtc-field'] ?? '')).length, 0); h.unmount();
});

test('both families allow direct manual entry from an inactive profile and retain edits across address toggles', () => {
  let value = clone(WEBRTC_PROFILE_DEFAULT); const changes = [], h = harness('WebRtcProfileFields', { value, onChange: next => changes.push(next) }); h.render();
  const edit = (key, text) => { h.attr('data-webrtc-field', key).props.onInput({ currentTarget: { value: text } }); value = changes.at(-1); h.update({ value }); };
  edit('ipv6:turn', '2001:db8:85a3::7334');
  assert.deepEqual(value.addresses, { ipv4: { host: null, stun: null, turn: null }, ipv6: { host: null, stun: null, turn: '2001:db8:85a3::7334' } });
  h.attr('data-webrtc-field', 'addresses').props.onChange({ currentTarget: { checked: false } }); value = changes.at(-1); h.update({ value });
  edit('ipv4:stun', '198.51.100.99');
  assert.equal(value.addresses.ipv6.turn, '2001:db8:85a3::7334'); assert.equal(value.addresses.ipv4.stun, '198.51.100.99');
  edit('ipv6:turn', ''); assert.equal(value.addresses.ipv6.turn, null, 'an empty role remains an intentional withheld address');
  assert.equal(parseApiValueInput(API_CONFIG_CATALOG.find(entry => entry.id === 'webrtc'), 'value', JSON.stringify(value)).ok, true);
  edit('ipv6:host', '198.51.100.88');
  assert.equal(parseApiValueInput(API_CONFIG_CATALOG.find(entry => entry.id === 'webrtc'), 'value', JSON.stringify(value)).ok, false, 'the parent Save validator rejects a literal in the wrong family');
  edit('ipv6:host', '2001:db8::88');
  assert.equal(parseApiValueInput(API_CONFIG_CATALOG.find(entry => entry.id === 'webrtc'), 'value', JSON.stringify(value)).ok, true);
  h.unmount();
});

test('the outer disabled state disables every profile control and ignores queued edit events', () => {
  const value = { ...clone(WEBRTC_PROFILE_DEFAULT), randomizeDevices: true }, original = clone(value), changes = [];
  const h = harness('WebRtcProfileFields', { value, disabled: true, onChange: next => changes.push(next) }); h.render();
  const controls = h.nodes(node => ['input', 'select'].includes(node.type)); assert.equal(controls.length, 13, '6 address fields, 2 mDNS choices, 5 profile controls');
  for (const control of controls) {
    assert.equal(control.props.disabled, true, control.props['data-webrtc-field']);
    control.props.onInput?.({ currentTarget: { value: '198.51.100.25' } });
    control.props.onChange?.({ currentTarget: { value: 'relay', checked: true } });
  }
  assert.deepEqual(changes, []); assert.deepEqual(value, original); h.unmount();
});

test('native policy selection only drafts; permission is requested exclusively by the explicit grant button and double clicks are bounded', async () => {
  let grantCalls = 0, refreshCalls = 0, release; const selected = [], pending = new Promise(resolve => { release = resolve; });
  const h = harness('WebRtcNetworkPolicyPanel', { value: 'system', network: network('inactive'), onChange: value => selected.push(value), onGrant: () => { grantCalls++; return pending; }, onRefresh: async () => { refreshCalls++; } }); h.render();
  assert.equal(grantCalls, 0); assert.equal(h.attr('data-webrtc-network-grant'), undefined);
  h.attr('data-webrtc-network-policy-picker').props.onChange({ currentTarget: { value: 'disable_non_proxied_udp' } });
  assert.deepEqual(selected, ['disable_non_proxied_udp']); assert.equal(grantCalls, 0);
  h.update({ value: 'disable_non_proxied_udp' }); const first = h.attr('data-webrtc-network-grant').props.onClick(); await h.attr('data-webrtc-network-grant').props.onClick(); await h.settle(); assert.equal(grantCalls, 1);
  assert.equal(h.attr('data-webrtc-network-policy-picker').props.disabled, true); release(); await first; await h.settle();
  assert.equal(h.attr('data-webrtc-network-status', 'inactive').props.role, 'status', 'a grant itself never claims that the draft policy has been applied');
  await h.attr('data-webrtc-network-refresh').props.onClick(); await h.settle(); assert.equal(refreshCalls, 1); h.unmount();
});

test('permission refusal and native non-controllable states remain factual and localized', async () => {
  const model = network('permission-required', 'disable_non_proxied_udp'), h = harness('WebRtcNetworkPolicyPanel', { value: model.desired, network: model, onChange() {}, onRefresh() {}, onGrant: async () => { throw Object.assign(Error(), { code: 'permission-denied' }); } }, 'ru'); h.render();
  await h.attr('data-webrtc-network-grant').props.onClick(); await h.settle();
  assert.ok(h.nodes(node => node.props.role === 'alert' && node.props.children === WEBRTC_UI_MESSAGES.ru.protection_webrtc_denied).length);
  assert.equal(model.status, 'permission-required'); assert.equal(h.attr('data-webrtc-network-policy-picker').props.value, 'disable_non_proxied_udp');
  h.update({ network: network('not-controllable', 'disable_non_proxied_udp', 'default') });
  assert.equal(h.attr('data-webrtc-network-status', 'not-controllable').props.role, 'alert'); h.unmount();
});

test('native policy status validates bounded enums and profile summaries identify the selected behavior', () => {
  assert.equal(readWebRtcNetworkState({ status: 'applied' }).status, 'unsupported');
  assert.equal(readWebRtcNetworkState({ ...network('applied'), levelOfControl: 'pretend' }).status, 'unsupported');
  assert.deepEqual(readWebRtcNetworkState(network('applied', 'disable_non_proxied_udp', 'disable_non_proxied_udp')), network('applied', 'disable_non_proxied_udp', 'disable_non_proxied_udp'));
  const value = { ...WEBRTC_PROFILE_DEFAULT, randomizeDevices: true, freshCertificates: true };
  const text = formatWebRtcProfile(value, key => WEBRTC_UI_MESSAGES.ru[key]); assert.match(text, /Сеанс браузера/); assert.match(text, /DTLS/); assert.doesNotMatch(text, /HTTPS|fingerprint|password/i);
});

test('all 21 RTC locale catalogs expose the exact field/status keys with no placeholder or empty values', () => {
  assert.deepEqual(Object.keys(WEBRTC_UI_MESSAGES).sort(), PRODUCTION_LANGUAGES.map(language => language.id).sort()); assert.equal(WEBRTC_UI_KEYS.length, 38);
  for (const locale of Object.keys(WEBRTC_UI_MESSAGES)) {
    const table = applyWebRtcCopy({}, locale); assert.deepEqual(Object.keys(table), [...WEBRTC_UI_KEYS]);
    for (const key of WEBRTC_UI_KEYS) { assert.ok(table[key].message.trim(), locale + ':' + key); assert.equal(table[key].message, WEBRTC_UI_MESSAGES[locale][key]); }
    assert.match(table.protection_webrtc_certificates.message, /DTLS/); assert.match(table.protection_webrtc_stun.message, /STUN/); assert.match(table.protection_webrtc_turn.message, /TURN/);
  }
});

// ---- Catalog 8: the Host field of each family can hold the mDNS (.local) choice instead of a literal address.
const rtcEntry = API_CONFIG_CATALOG.find(entry => entry.id === 'webrtc'), accepts = value => parseApiValueInput(rtcEntry, 'value', JSON.stringify(value)).ok;

test('each family offers an mDNS (.local) choice under its Host field: it replaces only that Host slot, keeps the typed literal and re-enables it when cleared', () => {
  let value = clone(WEBRTC_PROFILE_DEFAULT); const changes = [], h = harness('WebRtcProfileFields', { value, onChange: next => changes.push(next) }); h.render();
  const edit = (key, text) => { h.attr('data-webrtc-field', key).props.onInput({ currentTarget: { value: text } }); value = changes.at(-1); h.update({ value }); };
  const toggle = (family, checked) => { h.attr('data-webrtc-field', family + '-mdns').props.onChange({ currentTarget: { checked } }); value = changes.at(-1); h.update({ value }); };
  // ADR-107: one note explains the choice for both families (it was repeated under each Host field); each checkbox points at it.
  const notes = h.nodes(node => node.props['data-webrtc-mdns-note']); assert.equal(notes.length, 1, 'the note is shown once');
  const note = notes[0]; assert.equal(note.props.id, 'webrtc-mdns-note');
  assert.equal(note.props.children, WEBRTC_UI_MESSAGES.en.protection_webrtc_host_mdns_note); assert.match(note.props.children, /\.local/);
  for (const family of ['ipv4', 'ipv6']) {
    const box = h.attr('data-webrtc-field', family + '-mdns'); assert.equal(box.props.type, 'checkbox'); assert.equal(box.props.checked, false); assert.equal(box.props.disabled, false);
    assert.equal(box.props['aria-describedby'], note.props.id, family + ' checkbox describes itself with the one note');
  }
  assert.equal(changes.length, 0, 'opening the profile never activates the mDNS choice');
  edit('ipv4:host', '192.0.2.1'); assert.equal(h.attr('data-webrtc-field', 'ipv4:host').props.disabled, false);
  toggle('ipv4', true);
  assert.equal(value.addresses.ipv4.host, WEBRTC_HOST_MDNS); assert.equal(WEBRTC_HOST_MDNS, 'mdns'); assert.equal(value.addresses.ipv6.host, null, 'the other family is independent');
  assert.equal(h.attr('data-webrtc-field', 'ipv4-mdns').props.checked, true); assert.equal(h.attr('data-webrtc-field', 'addresses').props.checked, true, 'choosing it activates only the local profile, like typing');
  const host = h.attr('data-webrtc-field', 'ipv4:host'); assert.equal(host.props.disabled, true); assert.equal(host.props.value, ''); assert.equal(host.props.placeholder, WEBRTC_UI_MESSAGES.en.protection_webrtc_host_mdns);
  for (const key of ['ipv4:stun', 'ipv4:turn', 'ipv6:host', 'ipv6:stun', 'ipv6:turn']) assert.equal(h.attr('data-webrtc-field', key).props.disabled, false, key + ' stays editable');
  assert.equal(accepts(value), true, 'the contract accepts the literal mdns in a host slot');
  toggle('ipv6', true); assert.deepEqual([value.addresses.ipv4.host, value.addresses.ipv6.host], ['mdns', 'mdns']); assert.equal(accepts(value), true);
  toggle('ipv4', false); assert.equal(value.addresses.ipv4.host, '192.0.2.1', 'unchecking restores the literal typed before'); assert.equal(h.attr('data-webrtc-field', 'ipv4:host').props.value, '192.0.2.1');
  assert.equal(value.addresses.ipv6.host, 'mdns'); toggle('ipv6', false); assert.equal(value.addresses.ipv6.host, null, 'nothing was typed in the IPv6 host, so nothing returns');
  h.unmount();
});

test('mDNS is only a Host mode: typing the word never switches the mode, and no other slot or family accepts it', () => {
  let value = clone(WEBRTC_PROFILE_DEFAULT); const changes = [], h = harness('WebRtcProfileFields', { value, onChange: next => changes.push(next) }); h.render();
  const edit = (key, text) => { h.attr('data-webrtc-field', key).props.onInput({ currentTarget: { value: text } }); value = changes.at(-1); h.update({ value }); };
  edit('ipv4:host', 'mdns'); assert.notEqual(value.addresses.ipv4.host, 'mdns', 'the typed word stays a literal draft'); assert.equal(h.attr('data-webrtc-field', 'ipv4-mdns').props.checked, false);
  assert.equal(h.attr('data-webrtc-field', 'ipv4:host').props.disabled, false); assert.equal(accepts(value), false, 'Save rejects the typed word; the checkbox is the way to choose the mode');
  edit('ipv4:host', ''); edit('ipv4:stun', 'mdns'); assert.equal(accepts(value), false, 'stun never accepts mdns'); edit('ipv4:stun', ''); edit('ipv4:turn', 'mdns'); assert.equal(accepts(value), false, 'turn never accepts mdns'); edit('ipv4:turn', '');
  edit('ipv6:host', 'mdns'); assert.equal(accepts(value), false); edit('ipv6:host', '');
  h.attr('data-webrtc-field', 'ipv6-mdns').props.onChange({ currentTarget: { checked: true } }); value = changes.at(-1); h.update({ value });
  assert.equal(accepts(value), true); h.unmount();
});

test('the outer disabled state ignores a queued mDNS toggle and disables both choices', () => {
  const value = { ...clone(WEBRTC_PROFILE_DEFAULT), addresses: { ipv4: { host: null, stun: null, turn: null }, ipv6: { host: 'mdns', stun: null, turn: null } } }, original = clone(value), changes = [];
  const h = harness('WebRtcProfileFields', { value, disabled: true, onChange: next => changes.push(next) }); h.render();
  for (const family of ['ipv4', 'ipv6']) { const box = h.attr('data-webrtc-field', family + '-mdns'); assert.equal(box.props.disabled, true); box.props.onChange({ currentTarget: { checked: !box.props.checked } }); }
  assert.deepEqual(changes, []); assert.deepEqual(value, original); assert.equal(h.attr('data-webrtc-field', 'ipv6-mdns').props.checked, true, 'a saved mDNS host shows as chosen even when disabled'); h.unmount();
});

test('a profile with an mDNS host reads as such in summaries and survives draft validation, export and import through the existing contract', () => {
  const value = { addresses: { ipv4: { host: 'mdns', stun: '198.51.100.20', turn: null }, ipv6: { host: null, stun: null, turn: null } }, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session' };
  const english = formatWebRtcProfile(value, key => WEBRTC_UI_MESSAGES.en[key]), russian = formatWebRtcProfile(value, key => WEBRTC_UI_MESSAGES.ru[key]);
  assert.match(english, /IPV4 HOST: mDNS name \(\.local\)/); assert.doesNotMatch(english, /: mdns/); assert.match(russian, /IPV4 HOST: Имя mDNS \(\.local\)/); assert.match(english, /IPV4 STUN: 198\.51\.100\.20/);
  assert.equal(accepts(value), true);
  const base = createApiConfiguration(), saved = updateApiConfiguration(base, 'webrtc', { mode: 'custom', selected: { kind: 'value', value } }); assert.equal(saved.ok, true, saved.error?.message);
  const text = exportApiConfiguration(saved.value), restored = importApiConfiguration(text); assert.equal(restored.ok, true, restored.error?.message);
  assert.equal(restored.value.apis.find(row => row.id === 'webrtc').selected.value.addresses.ipv4.host, 'mdns');
  assert.equal(exportApiConfiguration(restored.value), text, 'export/import is byte-stable');
  const forged = JSON.parse(text); forged.apis.find(row => row.id === 'webrtc').selected.value.addresses.ipv4.stun = 'mdns';
  assert.equal(importApiConfiguration(JSON.stringify(forged)).ok, false, 'an imported file cannot smuggle mdns into stun');
});

test('every locale has a localized mDNS label and a one-line note that names the .local shape, and none promises name resolution or a route change', () => {
  for (const [locale, messages] of Object.entries(WEBRTC_UI_MESSAGES)) {
    const label = messages.protection_webrtc_host_mdns, note = messages.protection_webrtc_host_mdns_note;
    assert.match(label, /mDNS/, locale); assert.match(label, /\.local/, locale); assert.match(note, /\.local/, locale); assert.match(note, /Chrome/, locale);
    assert.ok(note.length >= 40 && note.length <= 260 && !note.includes('\n'), locale + ' note is one line of sensible length');
    if (locale !== 'en') { assert.notEqual(label, WEBRTC_UI_MESSAGES.en.protection_webrtc_host_mdns, locale); assert.notEqual(note, WEBRTC_UI_MESSAGES.en.protection_webrtc_host_mdns_note, locale); }
  }
});

// ---- ADR-107: one address check shared by the Antidetect Network level and the API Guard dialog.
import { webRtcAddressProblem, webRtcAddressMessage, WEBRTC_ADDRESS_ERROR_KEYS } from '../../apps/production-extension/webrtc-configuration-ui.js';
import { antidetectEditorLabels } from '../../apps/production-extension/antidetect-editor-labels.js';

test('ADR-107 address check: the contract validator decides and the problem is named by family, mDNS word or wrong family', () => {
  const cases = [
    ['ipv4', 'host', null, null], ['ipv4', 'stun', '', null], ['ipv4', 'host', '192.0.2.10', null], ['ipv6', 'turn', '2001:db8::30', null], ['ipv6', 'stun', '::ffff:c633:6414', null],
    ['ipv4', 'host', 'mdns', null], ['ipv6', 'host', 'mdns', null],
    ['ipv4', 'host', '999.1.1.1', 'ipv4'], ['ipv4', 'stun', '192.0.2', 'ipv4'], ['ipv4', 'turn', ' 192.0.2.10', 'ipv4'], ['ipv6', 'host', '2001:db8::zz', 'ipv6'], ['ipv6', 'host', 'mdns.local', 'ipv6'],
    ['ipv4', 'host', '2001:db8::10', 'family'], ['ipv6', 'stun', '198.51.100.20', 'family'],
    ['ipv4', 'host', 'mdns ', 'mdns'], ['ipv4', 'host', 'MDNS', 'mdns'], ['ipv4', 'stun', 'mdns', 'mdns'], ['ipv6', 'turn', ' mdns', 'mdns'],
    ['ipv4', 'host', 7, 'ipv4'], ['ipv5', 'host', '192.0.2.10', 'ipv4'], ['ipv6', 'gateway', '2001:db8::1', 'ipv6'],
  ];
  for (const [family, role, value, expected] of cases) assert.equal(webRtcAddressProblem(family, role, value), expected, family + ' ' + role + ' ' + JSON.stringify(value));
  let coerced = 0; assert.equal(webRtcAddressProblem('ipv4', 'host', { toString() { coerced++; return '192.0.2.10'; } }), 'ipv4'); assert.equal(coerced, 0, 'no coercion of a non-string');
  assert.deepEqual(Object.keys(WEBRTC_ADDRESS_ERROR_KEYS).sort(), ['family', 'ipv4', 'ipv6', 'mdns']);
  for (const language of PRODUCTION_LANGUAGES) for (const [problem, key] of Object.entries(WEBRTC_ADDRESS_ERROR_KEYS)) {
    const text = webRtcAddressMessage(problem, language.id, null); assert.equal(text, antidetectEditorLabels(language.id)[key]); assert.ok(text.length > 10, language.id + ' ' + problem);
    if (problem === 'ipv4') assert.match(text, /198\.51\.100\.10/u); if (problem === 'ipv6') assert.match(text, /2001:db8::10/u);
  }
  assert.equal(webRtcAddressMessage('ipv4', null, key => WEBRTC_UI_MESSAGES.ru[key] ?? key), WEBRTC_UI_MESSAGES.ru.protection_webrtc_invalid, 'without a locale: the localized generic profile message');
  assert.equal(webRtcAddressMessage(null, 'ru', null), '');
});

test('ADR-107 dialog fields: a wrong address is marked when the field is left, in words and aria-invalid, and the mark follows the fix', async () => {
  let value = clone(WEBRTC_PROFILE_DEFAULT); const changes = [], h = harness('WebRtcProfileFields', { value, onChange: next => changes.push(next), locale: 'ru' }); h.render();
  const field = key => h.attr('data-webrtc-field', key), error = key => h.attr('data-webrtc-field-error', key);
  const edit = (key, text) => { field(key).props.onInput({ currentTarget: { value: text } }); value = changes.at(-1); h.update({ value }); };
  const leave = async key => { field(key).props.onBlur(); await h.settle(); };
  try {
    edit('ipv4:host', '999.1.1.1');
    assert.equal(field('ipv4:host').props['aria-invalid'], undefined, 'never while typing'); assert.equal(error('ipv4:host'), undefined);
    await leave('ipv4:host');
    const marked = field('ipv4:host').props; assert.equal(marked['aria-invalid'], 'true'); assert.equal(marked['aria-describedby'], 'webrtc-address-ipv4-host-error');
    assert.equal(error('ipv4:host').props.id, 'webrtc-address-ipv4-host-error'); assert.equal(error('ipv4:host').props.children, antidetectEditorLabels('ru').errorIpv4);
    assert.equal(h.nodes(node => node.type === 'label' && node.props.for === 'webrtc-address-ipv4-host')[0].props.children, WEBRTC_UI_MESSAGES.en.protection_webrtc_host, 'the label names the field; the error is a description, not part of the name');
    edit('ipv4:host', '2001:db8::10'); assert.equal(error('ipv4:host').props.children, antidetectEditorLabels('ru').errorFamily, 'the message follows each edit after the first leave');
    edit('ipv4:host', '192.0.2.10'); assert.equal(field('ipv4:host').props['aria-invalid'], undefined); assert.equal(error('ipv4:host'), undefined, 'a fix clears it at once');
    edit('ipv6:stun', 'mdns'); await leave('ipv6:stun'); assert.equal(error('ipv6:stun').props.children, antidetectEditorLabels('ru').errorMdns);
    h.attr('data-webrtc-field', 'ipv4-mdns').props.onChange({ currentTarget: { checked: true } }); value = changes.at(-1); h.update({ value }); await leave('ipv4:host');
    assert.equal(error('ipv4:host'), undefined, 'a host switched to mDNS is never marked');
    assert.ok(changes.every(next => Object.keys(next).sort().join() === Object.keys(WEBRTC_PROFILE_DEFAULT).sort().join()), 'the blur state stays in the view and never reaches the profile');
  } finally { h.unmount(); }
});

test('ADR-107 dialog fields: group headings and their checkboxes say different things; without a locale the texts stay localized', () => {
  const text = node => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : node === null || node === undefined || node === false ? '' : String(node);
  const groups = h => h.nodes(node => node.type === 'fieldset' && node.props.class === 'webrtc-config-section');
  const h = harness('WebRtcProfileFields', { value: clone(WEBRTC_PROFILE_DEFAULT), onChange: () => {}, locale: 'en' }); h.render();
  assert.equal(groups(h).length, 2, 'addresses and devices');
  for (const group of groups(h)) {
    const legend = group.props.children.find(child => child?.type === 'legend'), box = group.props.children.find(child => child?.type === 'label' && String(child.props.class).includes('webrtc-config-check'));
    assert.ok(legend && box, 'heading and checkbox'); assert.notEqual(text(box).trim(), text(legend).trim(), text(legend));
  }
  assert.equal(text(groups(h)[0].props.children[1]).trim(), antidetectEditorLabels('en').addressesUse);
  const bare = harness('WebRtcProfileFields', { value: clone(WEBRTC_PROFILE_DEFAULT), onChange: () => {} }, 'ru'); bare.render();
  assert.doesNotMatch(text(groups(bare)[0].props.children[1]), /antidetect_|protection_webrtc_/u, 'never a raw key');
});

import { watchPointer, afterPointerRelease } from '../../apps/production-extension/webrtc-configuration-ui.js';

function pointerDocument() {
  const listeners = new Map();
  return { listeners,
    addEventListener(type, listener, capture) { assert.equal(capture, true, type + ' is watched in the capture phase'); if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
    fire(type) { for (const listener of listeners.get(type) ?? []) listener({ type }); } };
}
const nextTask = () => new Promise(resolve => setTimeout(resolve, 5));

test('ADR-107 pointer watch: one capture-phase watch per document; a pressed pointer holds a blur mark until one task after the release, bounded and isolated', async () => {
  const doc = pointerDocument(), target = { ownerDocument: doc }, ran = [];
  afterPointerRelease(undefined, () => ran.push('no-target')); afterPointerRelease({ ownerDocument: null }, () => ran.push('no-document'));
  watchPointer(undefined); watchPointer({ ownerDocument: {} }); watchPointer(target); watchPointer({ ownerDocument: doc });
  assert.deepEqual([...doc.listeners.keys()].sort(), ['keydown', 'pointercancel', 'pointerdown', 'pointerup']);
  assert.ok([...doc.listeners.values()].every(list => list.length === 1), 'one watch per document');
  afterPointerRelease(target, () => ran.push('idle'));
  doc.fire('pointerdown');
  for (let index = 0; index < 17; index++) afterPointerRelease(target, () => ran.push('held-' + index));
  assert.deepEqual(ran, ['no-target', 'no-document', 'idle', 'held-16'], 'at most sixteen marks wait; the next one runs at once');
  doc.fire('pointerup'); assert.equal(ran.length, 4, 'not inside the release, so the click still reaches its control');
  await nextTask(); assert.deepEqual(ran.slice(4), Array.from({ length: 16 }, (_, index) => 'held-' + index));
  for (const end of ['pointercancel', 'keydown']) {
    doc.fire('pointerdown'); afterPointerRelease(target, () => { throw Error('one failing mark'); }); afterPointerRelease(target, () => ran.push(end));
    doc.fire(end); await nextTask(); assert.equal(ran.at(-1), end, end + ' ends the press; a failing mark never blocks the next one');
  }
  afterPointerRelease(target, () => ran.push('released')); assert.equal(ran.at(-1), 'released', 'after the release a mark runs at once');
});

test('ADR-107 dialog fields: a press on another control (Save, a checkbox) shows the mark only after its click; leaving by keyboard marks at once', async () => {
  let value = clone(WEBRTC_PROFILE_DEFAULT); const changes = [], h = harness('WebRtcProfileFields', { value, onChange: next => changes.push(next), locale: 'en' }); h.render();
  const doc = pointerDocument(), target = { ownerDocument: doc }, field = key => h.attr('data-webrtc-field', key), error = key => h.attr('data-webrtc-field-error', key);
  const edit = (key, text) => { field(key).props.onInput({ currentTarget: { value: text } }); value = changes.at(-1); h.update({ value }); };
  try {
    edit('ipv4:host', '999.1.1.1'); field('ipv4:host').props.onFocus({ currentTarget: target });
    doc.fire('pointerdown'); field('ipv4:host').props.onBlur({ currentTarget: target }); await h.settle();
    assert.equal(error('ipv4:host'), undefined, 'nothing moves under a pressed pointer'); assert.equal(field('ipv4:host').props['aria-invalid'], undefined);
    doc.fire('pointerup'); h.render(); assert.equal(error('ipv4:host'), undefined, 'the click of that release comes first');
    await nextTask(); await h.settle();
    assert.equal(field('ipv4:host').props['aria-invalid'], 'true'); assert.equal(error('ipv4:host').props.children, antidetectEditorLabels('en').errorIpv4);
    edit('ipv6:stun', '192.0.2.10'); field('ipv6:stun').props.onFocus({ currentTarget: target }); field('ipv6:stun').props.onBlur({ currentTarget: target }); h.render();
    assert.equal(error('ipv6:stun').props.children, antidetectEditorLabels('en').errorFamily, 'leaving by keyboard marks at once');
  } finally { h.unmount(); }
});

// ---- Firefox-only proxy_only (round 5) ---------------------------------------------------------------------------------------
test('Firefox-only proxy_only is offered by a Firefox build only, or while it is the saved choice; the helpers never throw', () => {
  assert.deepEqual([...WEBRTC_NETWORK_POLICIES], ['system', 'default_public_interface_only', 'disable_non_proxied_udp', 'proxy_only']); assert.equal(Object.isFrozen(WEBRTC_NETWORK_POLICIES), true);
  assert.deepEqual(webRtcPolicyChoices(), ['system', 'default_public_interface_only', 'disable_non_proxied_udp']);
  assert.deepEqual(webRtcPolicyChoices({ firefox: false, current: 'disable_non_proxied_udp' }), ['system', 'default_public_interface_only', 'disable_non_proxied_udp']);
  assert.deepEqual(webRtcPolicyChoices({ firefox: true }), [...WEBRTC_NETWORK_POLICIES]);
  assert.deepEqual(webRtcPolicyChoices({ firefox: false, current: 'proxy_only' }), [...WEBRTC_NETWORK_POLICIES], 'a saved proxy_only stays visible so the select never shows another value');
  for (const firefox of ['true', 1, null, undefined, {}]) if (firefox !== undefined) assert.equal(webRtcPolicyChoices({ firefox }).includes('proxy_only'), false, 'only the boolean true counts: ' + String(firefox));
  const page = url => ({ runtime: { getURL: () => url } });
  assert.equal(webRtcFirefoxBuild(page('moz-extension://abc/')), true); assert.equal(webRtcFirefoxBuild(page('chrome-extension://abc/')), false);
  assert.equal(webRtcFirefoxBuild({ runtime: { getURL() { throw Error('no'); } } }), false); assert.equal(webRtcFirefoxBuild(null), false); assert.equal(webRtcFirefoxBuild({}), false);
  assert.equal(webRtcFirefoxBuild(), false, 'without an extension API (plain Node) nothing is Firefox');
  assert.equal(webRtcPolicyLabelKey('proxy_only'), 'policy_proxy_only'); assert.equal(webRtcPolicyLabelKey('default'), 'policy_system'); assert.equal(webRtcPolicyLabelKey('disable_non_proxied_udp'), 'policy_udp');
  for (const unknown of ['toString', '__proto__', 'constructor', 'Proxy_Only', '', null, 7, undefined]) assert.equal(webRtcPolicyLabelKey(unknown), null, String(unknown));
});

test('the policy picker hides proxy_only in Chrome, lists it in Firefox, and a saved proxy_only in Chrome is shown locked as not available', async () => {
  const options = h => h.attr('data-webrtc-network-policy-picker').props.children.map(option => option.props.value);
  const chrome = harness('WebRtcNetworkPolicyPanel', { value: 'system', network: network('inactive'), firefox: false, onChange() {}, onGrant() {}, onRefresh() {} }); chrome.render();
  assert.deepEqual(options(chrome), ['system', 'default_public_interface_only', 'disable_non_proxied_udp']); assert.equal(chrome.attr('data-webrtc-proxy-only-note'), undefined); chrome.unmount();
  // Without the prop the panel asks the page's own extension API: no API or a chrome-extension:// page is not Firefox, a moz-extension:// page is.
  const implicit = harness('WebRtcNetworkPolicyPanel', { value: 'system', network: network('inactive'), onChange() {}, onGrant() {}, onRefresh() {} }); implicit.render();
  assert.deepEqual(options(implicit), ['system', 'default_public_interface_only', 'disable_non_proxied_udp']); implicit.unmount();
  const previous = globalThis.browser; globalThis.browser = { runtime: { getURL: () => 'moz-extension://owned/' } };
  try { const inFirefox = harness('WebRtcNetworkPolicyPanel', { value: 'system', network: network('inactive'), onChange() {}, onGrant() {}, onRefresh() {} }); inFirefox.render(); assert.deepEqual(options(inFirefox), [...WEBRTC_NETWORK_POLICIES]); inFirefox.unmount(); }
  finally { if (previous === undefined) delete globalThis.browser; else globalThis.browser = previous; }
  const selected = [], firefox = harness('WebRtcNetworkPolicyPanel', { value: 'system', network: network('inactive'), firefox: true, onChange: value => selected.push(value), onGrant() {}, onRefresh() {} }); firefox.render();
  assert.deepEqual(options(firefox), [...WEBRTC_NETWORK_POLICIES]);
  const proxyOption = firefox.attr('data-webrtc-network-policy-picker').props.children.find(option => option.props.value === 'proxy_only');
  assert.equal(proxyOption.props.children, WEBRTC_UI_MESSAGES.en.protection_webrtc_policy_proxy_only);
  firefox.attr('data-webrtc-network-policy-picker').props.onChange({ currentTarget: { value: 'proxy_only' } }); assert.deepEqual(selected, ['proxy_only']);
  firefox.update({ value: 'proxy_only', network: network('permission-required', 'proxy_only') });
  const note = firefox.attr('data-webrtc-proxy-only-note'); assert.equal(note.props.children, WEBRTC_UI_MESSAGES.en.protection_webrtc_proxy_only_note); assert.match(note.props.children, /UDP/); assert.match(note.props.children, /fail/); assert.match(note.props.children, /Firefox only/);
  assert.ok(firefox.attr('data-webrtc-network-grant'), 'the permission is still requested only by the explicit grant button'); firefox.unmount();
  // Chrome with a stored proxy_only (hand-edited or imported): the existing unsupported state, the value stays visible, the picker is locked.
  const stored = harness('WebRtcNetworkPolicyPanel', { value: 'proxy_only', network: network('unsupported', 'proxy_only'), firefox: false, onChange() {}, onGrant() {}, onRefresh() {} }); stored.render();
  assert.deepEqual(options(stored), [...WEBRTC_NETWORK_POLICIES]); assert.equal(stored.attr('data-webrtc-network-policy-picker').props.value, 'proxy_only'); assert.equal(stored.attr('data-webrtc-network-policy-picker').props.disabled, true);
  assert.equal(stored.attr('data-webrtc-network-status', 'unsupported').props.children, WEBRTC_UI_MESSAGES.en.protection_webrtc_unsupported); assert.ok(stored.attr('data-webrtc-proxy-only-note')); stored.unmount();
});

test('the native-policy state accepts proxy_only as a desired value and the effective value shows its own label', () => {
  assert.deepEqual(readWebRtcNetworkState(network('applied', 'proxy_only', 'proxy_only')), network('applied', 'proxy_only', 'proxy_only'));
  assert.equal(readWebRtcNetworkState({ ...network('applied', 'proxy_only', 'proxy_only'), desired: 'proxy-only' }).status, 'unsupported', 'a misspelled policy is still rejected');
  const h = harness('WebRtcNetworkPolicyPanel', { value: 'proxy_only', network: network('applied', 'proxy_only', 'proxy_only'), firefox: true, onChange() {}, onGrant() {}, onRefresh() {} }); h.render();
  const effective = h.attr('data-webrtc-network-effective'); assert.equal(effective.props.children[1].props.children, WEBRTC_UI_MESSAGES.en.protection_webrtc_policy_proxy_only); h.unmount();
});

test('every locale explains proxy_only in its own language: what it does, that calls fail without a UDP-capable proxy, and that it is Firefox only', () => {
  const english = WEBRTC_UI_MESSAGES.en;
  for (const [locale, messages] of Object.entries(WEBRTC_UI_MESSAGES)) {
    const label = messages.protection_webrtc_policy_proxy_only, note = messages.protection_webrtc_proxy_only_note;
    assert.ok(label.length >= 8 && label.length <= 60, locale + ' label length'); assert.ok(note.length >= 40 && note.length <= 400, locale + ' note length');
    assert.match(label, /Firefox/); assert.match(note, /Firefox/); assert.match(note, /UDP/); assert.match(note, /WebRTC/);
    assert.equal(note.includes('|'), false); assert.equal(label !== label.trim() || note !== note.trim(), false);
    if (locale !== 'en') { assert.notEqual(label, english.protection_webrtc_policy_proxy_only, locale); assert.notEqual(note, english.protection_webrtc_proxy_only_note, locale); }
    const table = applyWebRtcCopy({}, locale); assert.equal(table.protection_webrtc_policy_proxy_only.message, label); assert.equal(table.protection_webrtc_proxy_only_note.message, note);
  }
  assert.equal(new Set(Object.values(WEBRTC_UI_MESSAGES).map(messages => messages.protection_webrtc_proxy_only_note)).size, Object.keys(WEBRTC_UI_MESSAGES).length, 'no two locales share a note');
});
