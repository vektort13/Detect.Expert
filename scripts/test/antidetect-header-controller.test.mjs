// ADR-105: HTTP request headers follow the selected Custom JavaScript identity (pure builders + DNR controller with a fake native API).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiConfiguration, updateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { ApiConfigurationController } from '../../apps/production-extension/api-configuration-controller.js';
import {
  ANTIDETECT_HEADER_PRIORITY, ANTIDETECT_HEADER_REQUEST_TYPES, ANTIDETECT_HEADER_RULE_IDS, ANTIDETECT_HEADER_RULE_RANGE,
  ANTIDETECT_HIGH_ENTROPY_HINTS, ANTIDETECT_HINT_GROUPS, ANTIDETECT_LOW_ENTROPY_HINTS, AntidetectHeaderController,
  buildAntidetectHeaderRules, claimedBrand, claimedFamily, describeAntidetectHeaders,
} from '../../apps/production-extension/antidetect-header-controller.js';

const full = ['http://*/*', 'https://*/*'];
const copy = value => structuredClone(value);
const EXT = 'owned-header-extension';
const AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const HINTS = { brands: [{ brand: 'Chromium', version: '156' }, { brand: 'Not.A/Brand', version: '24' }, { brand: 'Google Chrome', version: '156' }], mobile: false, platform: 'Windows' };
const LOW = ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'];
const HIGH = ['sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-full-version', 'sec-ch-ua-full-version-list', 'sec-ch-ua-model', 'sec-ch-ua-platform-version', 'sec-ch-ua-wow64', 'sec-ch-ua-form-factors'];

function change(config, id, patch, host = null) {
  const next = updateApiConfiguration(config, id, patch, host);
  assert.equal(next.ok, true, next.error?.message); return next.value;
}
const custom = (config, id, raw, host = null) => change(config, id, { mode: 'custom', selected: { kind: 'value', value: raw } }, host);
function configuration(rows = {}, { master = true } = {}) {
  let value = { ...createApiConfiguration(), antidetectEnabled: master };
  for (const [id, raw] of Object.entries(rows)) value = custom(value, id, raw);
  return value;
}
const identity = () => configuration({ 'navigator-user-agent': AGENT, 'navigator-languages': ['de-DE', 'de', 'en-US', 'en'], 'client-hints': HINTS });
const describe = (config, matches = full, active = true, chrome = true) => describeAntidetectHeaders(config, matches, active, { chrome });
const build = (config, matches = full, active = true, chrome = true) => buildAntidetectHeaderRules(config, matches, active, { chrome, extensionId: EXT });
const headersOf = rule => rule.action.requestHeaders;
const valueOf = (built, name) => built.rules.flatMap(headersOf).find(item => item.header.toLowerCase() === name)?.value;
const NONE = { status: 'inactive', set: [], removed: [], reason: null };
// Independent literal copy of the measured remove-only groups (Chromium 153 + Chrome 156): row -> [rule id, names Chrome really sends].
const GROUPS = {
  'device-memory': [300104, ['device-memory', 'sec-ch-device-memory']],
  'window-device-pixel-ratio': [300105, ['dpr', 'sec-ch-dpr']],
  'screen-geometry': [300106, ['viewport-width', 'sec-ch-viewport-width', 'sec-ch-viewport-height']],
  'network-information': [300107, ['ect', 'rtt', 'downlink']],
  'css-media': [300108, ['sec-ch-prefers-color-scheme', 'sec-ch-prefers-reduced-motion', 'sec-ch-prefers-reduced-transparency']],
};
const EXTRA = { 'device-memory': 4, 'window-device-pixel-ratio': 2, 'screen-geometry': { innerWidth: 1234, innerHeight: 777 },
  'network-information': { downlink: 10, effectiveType: '4g', rtt: 50, saveData: false }, 'css-media': { colorScheme: 'dark', reducedMotion: 'reduce' } };
const OTHER_NAMES = Object.values(GROUPS).flatMap(([, names]) => names);
// Names Chrome never sent in any tried configuration, or sent but have no matching row: never touched.
const UNTOUCHED = ['viewport-height', 'save-data', 'sec-ch-save-data', 'sec-ch-prefers-contrast', 'sec-ch-prefers-reduced-data', 'sec-ch-forced-colors', 'width', 'sec-ch-width'];

test('rule IDs form one disjoint reserved range next to the protocol guard and never touch Firewall ranges', () => {
  assert.deepEqual(ANTIDETECT_HEADER_RULE_IDS, { userAgent: 300100, acceptLanguage: 300101, clientHints: 300102, highEntropy: 300103, deviceMemory: 300104, pixelRatio: 300105, viewport: 300106, network: 300107, preferences: 300108, clientData: 300109 });
  assert.deepEqual(ANTIDETECT_HEADER_RULE_RANGE, [300100, 300119]);
  for (const value of [ANTIDETECT_HEADER_RULE_IDS, ANTIDETECT_HEADER_RULE_RANGE, ANTIDETECT_HEADER_REQUEST_TYPES, ANTIDETECT_LOW_ENTROPY_HINTS, ANTIDETECT_HIGH_ENTROPY_HINTS]) assert.equal(Object.isFrozen(value), true);
  const ids = Object.values(ANTIDETECT_HEADER_RULE_IDS);
  assert.equal(new Set(ids).size, 10);
  for (const id of ids) {
    assert.ok(id >= 300100 && id <= 300119);
    assert.ok(!(id >= 1 && id <= 99) && !(id >= 100000 && id <= 100999) && !(id >= 101000 && id <= 101023) && !(id >= 200000 && id <= 200127) && id !== 300000 && id !== 300001);
  }
  assert.equal(ANTIDETECT_HEADER_PRIORITY, 1000);
  assert.deepEqual(LOW, [...ANTIDETECT_LOW_ENTROPY_HINTS]); assert.deepEqual(HIGH, [...ANTIDETECT_HIGH_ENTROPY_HINTS]);
  // The remove-only groups equal the independent measured table, deeply frozen.
  assert.deepEqual(Object.fromEntries(Object.values(ANTIDETECT_HINT_GROUPS).map(group => [group.row, [...group.headers]])), Object.fromEntries(Object.entries(GROUPS).map(([row, [, names]]) => [row, names])));
  assert.deepEqual(Object.values(ANTIDETECT_HINT_GROUPS).map(group => ANTIDETECT_HEADER_RULE_IDS[Object.keys(ANTIDETECT_HINT_GROUPS).find(key => ANTIDETECT_HINT_GROUPS[key] === group)]), Object.values(GROUPS).map(([id]) => id));
  for (const group of Object.values(ANTIDETECT_HINT_GROUPS)) { assert.equal(Object.isFrozen(group), true); assert.equal(Object.isFrozen(group.headers), true); }
  assert.equal(Object.isFrozen(ANTIDETECT_HINT_GROUPS), true);
});

test('a complete Custom identity produces exactly the five set headers and the eight removals, equal to the JavaScript values', () => {
  const config = identity(), result = describe(config);
  assert.deepEqual(result, { status: 'applied', set: ['user-agent', 'accept-language', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'], removed: HIGH, reason: null });
  const built = build(config);
  assert.equal(built.status, 'applied'); assert.equal(built.rules.length, 4);
  assert.deepEqual(built.rules.map(rule => rule.id), [300100, 300101, 300102, 300103]);
  assert.equal(valueOf(built, 'user-agent'), AGENT, 'identical string to navigator.userAgent');
  assert.equal(valueOf(built, 'accept-language'), 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7');
  assert.equal(valueOf(built, 'sec-ch-ua'), '"Chromium";v="156", "Not.A/Brand";v="24", "Google Chrome";v="156"', 'same list and order as userAgentData.brands');
  assert.equal(valueOf(built, 'sec-ch-ua-mobile'), '?0'); assert.equal(valueOf(built, 'sec-ch-ua-platform'), '"Windows"');
});

test('every generated rule is a bounded modifyHeaders rule with explicit types, the extension initiator exclusion and no other behaviour', () => {
  const built = build(identity());
  for (const rule of built.rules) {
    assert.deepEqual(Object.keys(rule), ['id', 'priority', 'action', 'condition']); assert.equal(rule.priority, 1000);
    assert.deepEqual(Object.keys(rule.action), ['type', 'requestHeaders']); assert.equal(rule.action.type, 'modifyHeaders');
    assert.deepEqual(rule.condition.excludedInitiatorDomains, [EXT]);
    assert.ok(rule.condition.resourceTypes.includes('main_frame'), 'main_frame is excluded by default and must be listed');
    assert.ok(Array.isArray(rule.condition.resourceTypes) && rule.condition.resourceTypes.every(type => ANTIDETECT_HEADER_REQUEST_TYPES.includes(type)));
    assert.equal(rule.condition.resourceTypes.includes('webtransport') || rule.condition.resourceTypes.includes('webbundle'), false);
    for (const item of rule.action.requestHeaders) assert.deepEqual(Object.keys(item), item.operation === 'set' ? ['header', 'operation', 'value'] : ['header', 'operation']);
  }
  const [agent, language, hints, high] = built.rules;
  assert.deepEqual(agent.condition.resourceTypes, [...ANTIDETECT_HEADER_REQUEST_TYPES]); assert.equal(agent.condition.resourceTypes.includes('websocket'), true);
  assert.deepEqual(language.condition.resourceTypes, [...ANTIDETECT_HEADER_REQUEST_TYPES]);
  assert.equal(hints.condition.urlFilter, '|https://', 'Chrome sends no client hints to non-trustworthy http, so none may be added there');
  assert.equal(hints.condition.resourceTypes.includes('websocket'), false, 'a WebSocket handshake carries no client hints natively');
  assert.deepEqual(Object.keys(hints.condition), ['resourceTypes', 'excludedInitiatorDomains', 'urlFilter']);
  assert.equal(agent.condition.urlFilter, undefined); assert.deepEqual(Object.keys(high.condition), ['resourceTypes', 'excludedInitiatorDomains']);
  assert.deepEqual(headersOf(high).map(item => item.header.toLowerCase()), HIGH); assert.ok(headersOf(high).every(item => item.operation === 'remove'));
});

test('only the documented operations on the documented headers can ever be generated, over every Custom row combination', () => {
  const rows = [['navigator-user-agent', [AGENT, FIREFOX, SAFARI]], ['navigator-languages', [['de-DE'], ['de-DE', 'de', 'en']]], ['navigator-language', ['fr-FR']], ['client-hints', [HINTS, { ...HINTS, brands: [] }, { ...HINTS, mobile: true, platform: '' }]]];
  const allowedSet = ['User-Agent', 'Accept-Language', 'Sec-CH-UA', 'Sec-CH-UA-Mobile', 'Sec-CH-UA-Platform'], allowedRemove = [...LOW, ...HIGH, ...OTHER_NAMES, 'x-client-data'];
  const extras = Object.entries(EXTRA);
  let checked = 0;
  // 16 identity combinations x 3 value picks, then every subset of the five remove-only rows (alone and on top of a full identity).
  const cases = [];
  for (let mask = 0; mask < 16; mask++) for (const pick of [0, 1, 2]) { const chosen = {}; rows.forEach(([id, values], index) => { if (mask & (1 << index)) chosen[id] = values[pick % values.length]; }); cases.push(chosen); }
  for (let mask = 1; mask < 32; mask++) { const chosen = {}; extras.forEach(([id, raw], index) => { if (mask & (1 << index)) chosen[id] = raw; }); cases.push(chosen, { 'navigator-user-agent': AGENT, 'client-hints': HINTS, ...chosen }); }
  for (const chosen of cases) {
    const built = build(configuration(chosen)); checked++;
    for (const rule of built.rules) {
      assert.equal(rule.action.type, 'modifyHeaders');
      for (const item of rule.action.requestHeaders) {
        if (item.operation === 'set') assert.ok(allowedSet.includes(item.header), item.header);
        else { assert.equal(item.operation, 'remove'); assert.ok(allowedRemove.includes(item.header.toLowerCase()), item.header); }
      }
    }
    const text = JSON.stringify(built.rules).toLowerCase();
    for (const forbidden of ['append', 'redirect', 'upgradescheme', 'allowallrequests', 'cookie', 'sec-gpc', 'authorization', 'referer', 'origin', 'responseheaders']) assert.equal(text.includes(forbidden), false, forbidden);
    const touched = built.rules.flatMap(headersOf).map(item => item.header.toLowerCase());
    for (const name of UNTOUCHED) assert.equal(touched.includes(name), false, name);
    for (const item of built.rules.flatMap(headersOf)) if ([...OTHER_NAMES, 'x-client-data'].includes(item.header.toLowerCase())) assert.equal(item.operation, 'remove', 'a non-identity hint is never set');
  }
  assert.equal(checked, 48 + 62);
});

test('Accept-Language uses the browser q-value format with a 0.1 floor and keeps the exact JavaScript tags', () => {
  const header = tags => valueOf(build(configuration({ 'navigator-languages': tags })), 'accept-language');
  assert.equal(header(['en-US']), 'en-US');
  assert.equal(header(['en-US', 'en']), 'en-US,en;q=0.9');
  assert.equal(header(['de-DE', 'de', 'en-US', 'en']), 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7');
  const ten = ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh', 'ii', 'jj'];
  assert.equal(header(ten), 'aa,bb;q=0.9,cc;q=0.8,dd;q=0.7,ee;q=0.6,ff;q=0.5,gg;q=0.4,hh;q=0.3,ii;q=0.2,jj;q=0.1');
  assert.equal(header([...ten, 'kk', 'll']).endsWith(',jj;q=0.1,kk;q=0.1,ll;q=0.1'), true);
  assert.equal(header(['EN-us', 'De']), 'EN-us,De;q=0.9', 'tags are not rewritten');
});

test('navigator-language is the fallback, navigator-languages wins, and each row alone touches only its own header', () => {
  let built = build(configuration({ 'navigator-language': 'ja-JP' }));
  assert.deepEqual(describe(configuration({ 'navigator-language': 'ja-JP' })), { status: 'applied', set: ['accept-language'], removed: [], reason: null });
  assert.equal(valueOf(built, 'accept-language'), 'ja-JP');
  built = build(configuration({ 'navigator-language': 'ja-JP', 'navigator-languages': ['fr-FR', 'fr'] }));
  assert.equal(valueOf(built, 'accept-language'), 'fr-FR,fr;q=0.9');
  assert.deepEqual(describe(configuration({ 'navigator-user-agent': AGENT })), { status: 'applied', set: ['user-agent'], removed: [], reason: null });
  assert.deepEqual(describe(configuration({ 'client-hints': HINTS })), { status: 'applied', set: LOW, removed: HIGH, reason: null });
});

test('Sec-CH-UA follows brand order, escapes quotes and backslashes, and encodes mobile and an empty platform', () => {
  const header = hints => build(configuration({ 'client-hints': hints }));
  let built = header({ brands: [{ brand: 'Not;A=Brand', version: '99' }, { brand: 'Chromium', version: '156' }], mobile: true, platform: 'Android' });
  assert.equal(valueOf(built, 'sec-ch-ua'), '"Not;A=Brand";v="99", "Chromium";v="156"'); assert.equal(valueOf(built, 'sec-ch-ua-mobile'), '?1'); assert.equal(valueOf(built, 'sec-ch-ua-platform'), '"Android"');
  built = header({ brands: [{ brand: 'Say "hi" \\ there', version: '1' }], mobile: false, platform: '' });
  assert.equal(valueOf(built, 'sec-ch-ua'), '"Say \\"hi\\" \\\\ there";v="1"'); assert.equal(valueOf(built, 'sec-ch-ua-platform'), '""');
  for (const bad of [{ brand: 'Café', version: '1' }, { brand: 'tab\there', version: '1' }, { brand: 'ok', version: 'line\nbreak' }, { brand: 'ok', version: '\u0001' }]) {
    const result = describe(configuration({ 'client-hints': { brands: [bad], mobile: false, platform: 'Windows' } }));
    assert.deepEqual(result, { status: 'unsupported', set: [], removed: [], reason: 'invalid' });
  }
  assert.deepEqual(describe(configuration({ 'client-hints': { brands: HINTS.brands, mobile: false, platform: 'Windöws' } })), { status: 'unsupported', set: [], removed: [], reason: 'invalid' });
});

test('unrepresentable values never reach a rule: control characters, non-ASCII, edge spaces and empty strings are refused as invalid', () => {
  for (const agent of ['', ' leading', 'trailing ', 'a\tb', 'a\u0001b', 'a\u007fb', 'café', 'Пр', 'line\r\nbreak', 'x'.repeat(1025)]) {
    let config;
    try { config = configuration({ 'navigator-user-agent': agent }); } catch { continue; } // the strict contract may already refuse it
    const built = build(config);
    assert.deepEqual({ status: built.status, reason: built.reason, rules: built.rules }, { status: 'unsupported', reason: 'invalid', rules: [] }, JSON.stringify(agent));
  }
  assert.equal(build(configuration({ 'navigator-user-agent': 'single' })).status, 'applied');
  assert.equal(build(configuration({ 'navigator-user-agent': 'two words' })).status, 'applied');
  const mixed = build(configuration({ 'navigator-user-agent': 'café', 'navigator-languages': ['de-DE'] }));
  assert.deepEqual({ status: mixed.status, rules: mixed.rules }, { status: 'unsupported', rules: [] }, 'identity is applied as a whole or not at all');
});

test('only rows in Custom mode contribute; stored Custom values under Off, On or Bypass are ignored and never modified', () => {
  for (const mode of ['off', 'on', 'bypass']) {
    let config = identity(); const retained = copy(config);
    for (const id of ['navigator-user-agent', 'navigator-languages', 'client-hints']) config = change(config, id, { mode });
    assert.deepEqual(describe(config), NONE, mode);
    assert.deepEqual(build(config).rules, []);
    assert.equal(config.apis.find(row => row.id === 'navigator-user-agent').selected.value, AGENT, 'dormant Custom value is kept');
    assert.notDeepEqual(config, retained);
  }
  const one = change(identity(), 'client-hints', { mode: 'off' });
  assert.deepEqual(describe(one), { status: 'applied', set: ['user-agent', 'accept-language'], removed: [], reason: null }, 'a header is touched only when its own row is Custom');
});

test('the Custom master and the active flag gate everything and the configuration is never changed or enabled', () => {
  const config = identity(), retained = copy(config);
  assert.deepEqual(describe(config, full, false), NONE);
  assert.deepEqual(describe({ ...config, antidetectEnabled: false }), NONE);
  assert.deepEqual(describe({ ...config, antidetectEnabled: false, enabled: true }), NONE, 'the API master alone never enables header rewriting');
  assert.deepEqual(build({ ...config, antidetectEnabled: false }).rules, []);
  assert.deepEqual(config, retained);
  assert.equal(describe({ ...config, enabled: true }).status, 'applied', 'Custom master decides, not the API master');
});

test('a non-Chromium User-Agent claim removes the low-entropy hints instead of setting them; high-entropy hints go too', () => {
  for (const [agent, family] of [[FIREFOX, 'firefox'], [SAFARI, 'safari'], ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1', 'safari']]) {
    assert.equal(claimedFamily(agent), family);
    const config = configuration({ 'navigator-user-agent': agent }), result = describe(config), chromeForIos = agent.includes('CriOS/');
    assert.deepEqual(result, { status: 'applied', set: ['user-agent'], removed: [...LOW, ...HIGH, ...(chromeForIos ? [] : ['x-client-data'])], reason: null }, family);
    const built = build(config);
    assert.deepEqual(built.rules.map(rule => rule.id), chromeForIos ? [300100, 300102, 300103] : [300100, 300102, 300103, 300109]);
    assert.ok(headersOf(built.rules[1]).every(item => item.operation === 'remove')); assert.equal(built.rules[1].condition.urlFilter, undefined, 'removal also covers plain-http loopback');
  }
  for (const agent of [AGENT, AGENT + ' Edg/156.0.0.0', 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36', 'HeadlessChrome/153.0.0.0']) {
    assert.equal(claimedFamily(agent), 'chromium');
    assert.deepEqual(describe(configuration({ 'navigator-user-agent': agent })), { status: 'applied', set: ['user-agent'], removed: agent.includes(' Edg/') ? ['x-client-data'] : [], reason: null }, 'a Chromium engine claim keeps the hints; only a named other product drops X-Client-Data');
  }
  assert.equal(claimedFamily('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'unknown'); assert.equal(claimedFamily(7), 'unknown');
  assert.deepEqual(describe(configuration({ 'navigator-user-agent': 'Mozilla/5.0 (X11; Linux x86_64)' })), { status: 'applied', set: ['user-agent'], removed: [], reason: null }, 'unknown claim: nothing extra is guessed');
});

test('an explicit client-hints row wins over the UA family; an empty brand list claims no client hints at all', () => {
  assert.deepEqual(describe(configuration({ 'navigator-user-agent': FIREFOX, 'client-hints': HINTS })), { status: 'applied', set: ['user-agent', ...LOW], removed: [...HIGH, 'x-client-data'], reason: null }, 'the UA still names Firefox, so X-Client-Data goes even though the hints say Google Chrome');
  const none = describe(configuration({ 'client-hints': { ...HINTS, brands: [] } }));
  assert.deepEqual(none, { status: 'applied', set: [], removed: [...LOW, ...HIGH, 'x-client-data'], reason: null });
  const built = build(configuration({ 'client-hints': { ...HINTS, brands: [] } }));
  assert.equal(JSON.stringify(built.rules).includes('"set"'), false, 'no header value is ever invented for an empty brand list');
});

test('scope other than all HTTP and HTTPS is unsupported with no rules, but only when there is something to apply', () => {
  for (const matches of [[], ['http://exact.fixture.invalid/*', 'https://exact.fixture.invalid/*'], ['http://*/*'], ['https://*/*'], ['*://*/*'], ['<all_urls>']]) {
    assert.deepEqual(describe(identity(), matches), { status: 'unsupported', set: [], removed: [], reason: 'scope' }, JSON.stringify(matches));
    assert.deepEqual(build(identity(), matches).rules, []);
    assert.deepEqual(describe(configuration(), matches), NONE, 'nothing Custom: no scope complaint');
  }
  assert.equal(describe(identity(), [...full, 'ws://*/*', 'https://extra.invalid/*']).status, 'applied');
});

test('exact-site entries never widen into browser rules: any differing site view makes the whole header identity unsupported', () => {
  const base = identity();
  const expectNo = (config, reason = 'site-overrides') => { assert.deepEqual(describe(config), { status: 'unsupported', set: [], removed: [], reason }); assert.deepEqual(build(config).rules, []); };
  expectNo(custom(base, 'navigator-user-agent', FIREFOX, 'exact.fixture.invalid'));
  expectNo(change(base, 'navigator-languages', { mode: 'off' }, 'exact.fixture.invalid'));
  expectNo(change(base, 'client-hints', { mode: 'on' }, 'exact.fixture.invalid'));
  let disabled = change(base, 'hardware-concurrency', { mode: 'on' }, 'exact.fixture.invalid'); disabled.sites[0].disabled = true; expectNo(disabled);
  expectNo(custom(configuration(), 'navigator-user-agent', AGENT, 'exact.fixture.invalid'));
  // Irrelevant, equal or inherited site entries keep the global rules.
  assert.equal(describe(change(base, 'hardware-concurrency', { mode: 'on' }, 'exact.fixture.invalid')).status, 'applied');
  assert.equal(describe(custom(base, 'navigator-user-agent', AGENT, 'exact.fixture.invalid')).status, 'applied', 'an equal explicit site value resolves to the global one');
  assert.equal(describe(change(base, 'navigator-user-agent', { mode: 'bypass' }, 'exact.fixture.invalid')).status, 'applied');
  assert.equal(describe(change(configuration(), 'hardware-concurrency', { mode: 'on' }, 'exact.fixture.invalid')).status, 'inactive');
  let empty = configuration(); empty = change(empty, 'hardware-concurrency', { mode: 'on' }, 'exact.fixture.invalid'); empty.sites[0].disabled = true;
  assert.deepEqual(describe(empty), NONE, 'a disabled site without any header identity changes nothing');
  assert.equal(JSON.stringify(build(custom(base, 'navigator-user-agent', FIREFOX, 'x.invalid'))).includes('InitiatorDomains":["x'), false);
});

test('all 128 exact-host sites resolve without revalidating each whole configuration', () => {
  const value = identity();
  const inherited = value.apis.map(({ id }) => ({ id, mode: 'bypass', selected: { kind: 'unset' }, settings: {} }));
  value.sites = Array.from({ length: 128 }, (_, index) => ({ host: 'site' + index + '.fixture.invalid', disabled: false, apis: copy(inherited) }));
  assert.equal(describe(value).status, 'applied');
  value.sites[127].apis.find(row => row.id === 'client-hints').mode = 'off';
  assert.deepEqual(describe(value), { status: 'unsupported', set: [], removed: [], reason: 'site-overrides' });
});

test('only a Chrome build is supported: anything but chrome === true is unsupported engine, even with a Custom identity', () => {
  for (const options of [undefined, {}, { chrome: false }, { chrome: 'true' }, { chrome: 1 }, null]) {
    assert.deepEqual(describeAntidetectHeaders(identity(), full, true, options), { status: 'unsupported', set: [], removed: [], reason: 'engine' });
  }
  assert.equal(describeAntidetectHeaders(identity(), full, true, { chrome: true }).status, 'applied');
  assert.equal(describeAntidetectHeaders(identity(), full, true).reason, 'engine');
  assert.deepEqual(buildAntidetectHeaderRules(identity(), full, true, { chrome: false, extensionId: EXT }).rules, []);
});

test('invalid configuration or arguments never throw and never produce rules', () => {
  const good = identity();
  for (const config of [null, undefined, {}, [], 'x', { ...good, antidetectEnabled: 'true' }, { ...good, apis: [] }, { ...good, sites: 'none' }, { ...good, formatVersion: 99 }]) {
    assert.deepEqual(describe(config), { status: 'error', set: [], removed: [], reason: 'invalid' });
    assert.deepEqual(build(config).rules, []);
  }
  // Call the exported function directly: the local helper above fills in defaults for undefined.
  for (const matches of [null, undefined, 'x', [1], [null], {}]) assert.deepEqual(describeAntidetectHeaders(good, matches, true, { chrome: true }), { status: 'error', set: [], removed: [], reason: 'invalid' });
  for (const active of [1, 'true', null, undefined]) assert.deepEqual(describeAntidetectHeaders(good, full, active, { chrome: true }), { status: 'error', set: [], removed: [], reason: 'invalid' });
  assert.deepEqual(describeAntidetectHeaders(null, full, true, { chrome: false }), { status: 'error', set: [], removed: [], reason: 'invalid' }, 'validation precedes the engine check');
});

test('rule construction needs a plausible extension id only when there is a rule to write', () => {
  for (const id of [undefined, '', 'Upper', 'a b', 7, 'x'.repeat(300)]) {
    const built = buildAntidetectHeaderRules(identity(), full, true, { chrome: true, extensionId: id });
    assert.deepEqual({ status: built.status, reason: built.reason, rules: built.rules }, { status: 'error', reason: 'invalid', rules: [] });
  }
  assert.equal(buildAntidetectHeaderRules(configuration(), full, true, { chrome: true }).status, 'inactive');
  assert.equal(buildAntidetectHeaderRules(identity(), [], true, { chrome: true }).status, 'unsupported');
});

test('the description is pure, deterministic and returns fresh arrays', () => {
  const config = identity(), retained = copy(config);
  const first = describe(config), second = describe(config);
  assert.deepEqual(first, second); assert.notEqual(first.set, second.set); first.set.push('x'); assert.equal(describe(config).set.length, 5);
  assert.deepEqual(config, retained);
  assert.deepEqual(Object.keys(first), ['status', 'set', 'removed', 'reason']);
  for (const name of [...first.set, ...first.removed]) assert.equal(name, name.toLowerCase());
});

test('each matching Custom row alone yields exactly its measured removals as one remove-only rule', () => {
  for (const [row, [id, names]] of Object.entries(GROUPS)) {
    const config = configuration({ [row]: EXTRA[row] });
    assert.deepEqual(describe(config), { status: 'applied', set: [], removed: names, reason: null }, row);
    const built = build(config);
    assert.deepEqual(built.rules.map(rule => rule.id), [id], row);
    const [rule] = built.rules;
    assert.deepEqual(Object.keys(rule), ['id', 'priority', 'action', 'condition']); assert.equal(rule.priority, 1000);
    assert.deepEqual(Object.keys(rule.action), ['type', 'requestHeaders']); assert.equal(rule.action.type, 'modifyHeaders');
    assert.deepEqual(headersOf(rule).map(item => item.header.toLowerCase()), names);
    assert.ok(headersOf(rule).every(item => item.operation === 'remove' && Object.keys(item).join() === 'header,operation'), 'never a value: ' + row);
    assert.deepEqual(rule.condition.resourceTypes, [...ANTIDETECT_HEADER_REQUEST_TYPES]); assert.deepEqual(rule.condition.excludedInitiatorDomains, [EXT]);
    assert.deepEqual(Object.keys(rule.condition), ['resourceTypes', 'excludedInitiatorDomains'], 'removal covers every scheme: no https-only filter');
  }
});

test('remove-only groups are independent of each other and of the identity rows; order is stable; unmeasured names stay native', () => {
  const all = configuration({ 'navigator-user-agent': AGENT, 'navigator-languages': ['de-DE', 'de'], 'client-hints': HINTS, ...EXTRA });
  const result = describe(all);
  assert.deepEqual(result, { status: 'applied', set: ['user-agent', 'accept-language', ...LOW], removed: [...HIGH, ...OTHER_NAMES], reason: null });
  assert.deepEqual(build(all).rules.map(rule => rule.id), [300100, 300101, 300102, 300103, 300104, 300105, 300106, 300107, 300108]);
  for (const name of UNTOUCHED) assert.equal(result.removed.includes(name), false, name + ' stays native');
  for (const [row, [, names]] of Object.entries(GROUPS)) {
    const alone = describe(configuration({ [row]: EXTRA[row] }));
    for (const [other, [, theirs]] of Object.entries(GROUPS)) if (other !== row) for (const name of theirs) assert.equal(alone.removed.includes(name), false, row + ' must not remove ' + name);
    assert.deepEqual(alone.removed, names);
  }
  assert.deepEqual(describe(identity()).removed, HIGH, 'identity rows never activate a device/network/preference group');
  const withGroup = describe(custom(identity(), 'device-memory', 4));
  assert.deepEqual(withGroup.set, ['user-agent', 'accept-language', ...LOW]); assert.deepEqual(withGroup.removed, [...HIGH, 'device-memory', 'sec-ch-device-memory']);
});

test('a remove-only group needs its own row in Custom mode and the Custom master; stored values under other modes do nothing', () => {
  for (const mode of ['off', 'on', 'bypass']) for (const row of Object.keys(GROUPS)) {
    const result = updateApiConfiguration(configuration({ [row]: EXTRA[row] }), row, { mode });
    if (!result.ok) { assert.equal(mode, 'on'); continue; } // some Custom-only rows have no Block mode
    assert.deepEqual(describe(result.value), NONE, row + ' ' + mode); assert.deepEqual(build(result.value).rules, []);
    assert.equal(result.value.apis.find(item => item.id === row).selected.kind, 'value', 'the dormant Custom value is kept');
  }
  const config = configuration(EXTRA);
  assert.equal(describe(config).removed.length, OTHER_NAMES.length);
  assert.deepEqual(describe({ ...config, antidetectEnabled: false }), NONE); assert.deepEqual(describe(config, full, false), NONE);
  assert.deepEqual(describe({ ...configuration(), enabled: true }), NONE, 'the API-Guard master alone never creates a header rule');
});

test('remove-only rows follow the same all-or-nothing scope and site rules: only Custom-ness is compared, never the value', () => {
  const base = configuration({ ...EXTRA, 'navigator-user-agent': AGENT });
  const expectNo = (config, reason = 'site-overrides') => { assert.deepEqual(describe(config), { status: 'unsupported', set: [], removed: [], reason }); assert.deepEqual(build(config).rules, []); };
  // A different Custom value at one site leaves the same removal in force: nothing is widened or narrowed.
  assert.equal(describe(custom(base, 'device-memory', 8, 'exact.fixture.invalid')).status, 'applied');
  assert.equal(describe(custom(base, 'css-media', { colorScheme: 'light' }, 'exact.fixture.invalid')).status, 'applied');
  // Off at one site, or Custom only at one site, cannot be expressed for one exact host: the whole header identity is refused.
  for (const row of Object.keys(GROUPS)) expectNo(change(base, row, { mode: 'off' }, 'exact.fixture.invalid'));
  for (const row of Object.keys(GROUPS)) expectNo(custom(configuration({ 'navigator-user-agent': AGENT }), row, EXTRA[row], 'exact.fixture.invalid'));
  const disabled = change(base, 'hardware-concurrency', { mode: 'on' }, 'exact.fixture.invalid'); disabled.sites[0].disabled = true; expectNo(disabled);
  // Scope: a partial scope refuses a remove-only rule too, but only when something is configured.
  for (const matches of [[], ['https://*/*'], ['http://*/*'], ['https://exact.fixture.invalid/*']]) {
    assert.deepEqual(describe(configuration({ 'device-memory': 4 }), matches), { status: 'unsupported', set: [], removed: [], reason: 'scope' });
    assert.deepEqual(describe(configuration(), matches), NONE);
  }
  assert.equal(describe(change(configuration({ 'device-memory': 4 }), 'hardware-concurrency', { mode: 'on' }, 'exact.fixture.invalid')).status, 'applied', 'an unrelated site entry changes nothing');
});

// ---- controller with a fake declarativeNetRequest -------------------------------------------------------------------
function fixture(options = {}) {
  const calls = [], foreign = [
    { id: 1, priority: 100, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-GPC', operation: 'set', value: '1' }] }, condition: { resourceTypes: ['xmlhttprequest'] } },
    { id: 100000, priority: 20, action: { type: 'allow' }, condition: { requestDomains: ['fixture.invalid'] } },
    { id: 101023, priority: 10, action: { type: 'block' }, condition: { requestDomains: ['fixture.invalid'] } },
    { id: 200000, priority: 50, action: { type: 'allow' }, condition: { tabIds: [7], requestDomains: ['fixture.invalid'] } },
    { id: 300000, priority: 1000, action: { type: 'block' }, condition: { resourceTypes: ['websocket'] } },
    { id: 300001, priority: 1000, action: { type: 'block' }, condition: { resourceTypes: ['webtransport'] } },
    { id: 300099, priority: 5, action: { type: 'block' }, condition: { resourceTypes: ['image'] } },
    { id: 300120, priority: 5, action: { type: 'block' }, condition: { resourceTypes: ['font'] } },
  ];
  let current = copy(foreign), fail = '', ignore = false, result, hold, readsHold, runningWrites = 0, maximumWrites = 0, echo = rule => rule;
  const dnr = {
    async getDynamicRules() {
      calls.push(['read']);
      if (readsHold) await readsHold;
      if (fail === 'read') throw Error('private native failure with https://do-not-expose.invalid');
      return copy(current).map(echo);
    },
    async updateDynamicRules(payload) {
      calls.push(['write', copy(payload)]); runningWrites++; maximumWrites = Math.max(maximumWrites, runningWrites);
      try {
        if (hold) await hold;
        if (fail === 'write') throw Error('private native failure');
        if (!ignore) current = [...current.filter(rule => !payload.removeRuleIds.includes(rule.id)), ...copy(payload.addRules)];
        return result;
      } finally { runningWrites--; }
    },
  };
  const api = { runtime: { id: EXT, getURL: path => (options.firefox ? 'moz-extension://owned/' : 'chrome-extension://owned/') + path }, declarativeNetRequest: dnr };
  return { api, dnr, calls, foreign, current: () => copy(current), set: value => { current = copy(value); }, fail: value => { fail = value; }, echo: value => { echo = value; },
    ignore: () => { ignore = true; }, result: value => { result = value; }, hold: promise => { hold = promise; }, readsHold: promise => { readsHold = promise; }, maximumWrites: () => maximumWrites };
}
const writes = f => f.calls.filter(row => row[0] === 'write');
const own = rules => rules.filter(rule => rule.id >= 300100 && rule.id <= 300119);
const others = f => f.current().filter(rule => !(rule.id >= 300100 && rule.id <= 300119));

test('apply is one native atomic write and readback that preserves every Firewall, protocol and adjacent foreign rule', async () => {
  const f = fixture(), c = new AntidetectHeaderController(f.api), config = identity();
  const result = await c.reconcile(config, full, true);
  assert.deepEqual(result, { status: 'applied', set: ['user-agent', 'accept-language', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'], removed: HIGH, reason: null });
  assert.deepEqual(f.calls.map(row => row[0]), ['read', 'write', 'read']);
  assert.deepEqual(others(f), f.foreign); assert.deepEqual(writes(f)[0][1].removeRuleIds, []);
  assert.deepEqual(own(f.current()), build(config).rules);
  assert.equal((await c.reconcile(config, full, true)).status, 'applied'); assert.equal(writes(f).length, 1, 'matching actual native rules are not written again');
  assert.equal((await c.reconcile({ ...config, antidetectEnabled: false }, full, true)).status, 'inactive');
  assert.deepEqual(writes(f)[1][1], { removeRuleIds: [300100, 300101, 300102, 300103], addRules: [] });
  assert.deepEqual(f.current(), f.foreign);
});

test('changing the Custom identity rewrites only our range in one write; Firefox claims switch the hint rule from set to remove', async () => {
  const f = fixture(), c = new AntidetectHeaderController(f.api);
  await c.reconcile(identity(), full, true);
  assert.equal((await c.reconcile(configuration({ 'navigator-user-agent': FIREFOX }), full, true)).status, 'applied');
  assert.equal(writes(f).length, 2); assert.deepEqual(writes(f)[1][1].removeRuleIds.sort(), [300100, 300101, 300102, 300103]);
  assert.deepEqual(own(f.current()).map(rule => rule.id), [300100, 300102, 300103, 300109]);
  assert.ok(headersOf(own(f.current()).find(rule => rule.id === 300102)).every(item => item.operation === 'remove'));
  assert.deepEqual(others(f), f.foreign);
});

test('unsupported scope or a differing exact-site entry removes previously applied rules and never widens', async () => {
  const f = fixture(), c = new AntidetectHeaderController(f.api), config = identity();
  await c.reconcile(config, full, true); assert.equal(own(f.current()).length, 4);
  assert.deepEqual(await c.reconcile(config, ['https://example.com/*'], true), { status: 'unsupported', set: [], removed: [], reason: 'scope' });
  assert.equal(own(f.current()).length, 0); assert.deepEqual(others(f), f.foreign);
  await c.reconcile(config, full, true);
  const result = await c.reconcile(custom(config, 'navigator-user-agent', FIREFOX, 'exact.fixture.invalid'), full, true);
  assert.deepEqual(result, { status: 'unsupported', set: [], removed: [], reason: 'site-overrides' }); assert.equal(own(f.current()).length, 0);
  assert.deepEqual(c.inspect(), result);
});

test('stale, broadened or unknown rules inside the reserved range are replaced; neighbours 300099 and 300120 are untouched', async () => {
  const f = fixture(), c = new AntidetectHeaderController(f.api);
  f.set([...f.foreign, { id: 300100, priority: 1, action: { type: 'allow' }, condition: { resourceTypes: ['main_frame'] } },
    { id: 300110, priority: 5, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Cookie', operation: 'remove' }] }, condition: {} }, { id: 300119, priority: 5, action: { type: 'block' }, condition: {} }]);
  assert.equal((await c.reconcile(identity(), full, true)).status, 'applied');
  assert.deepEqual(writes(f)[0][1].removeRuleIds.sort(), [300100, 300110, 300119]);
  assert.deepEqual(own(f.current()), build(identity()).rules); assert.deepEqual(others(f), f.foreign);
  const stale = fixture(), d = new AntidetectHeaderController(stale.api);
  stale.set([...stale.foreign, ...build(identity()).rules]);
  assert.equal((await d.reconcile(configuration(), full, true)).status, 'inactive', 'rules left by a previous run are removed when nothing is configured');
  assert.deepEqual(stale.current(), stale.foreign);
});

test('Chrome echo variations (header case, list order, inert defaults) are identical; any real difference is rewritten', async () => {
  const f = fixture(), c = new AntidetectHeaderController(f.api), config = identity();
  await c.reconcile(config, full, true);
  f.echo(rule => ({ ...rule, action: { ...rule.action, requestHeaders: rule.action.requestHeaders.map(item => ({ ...item, header: item.header.toLowerCase() })) },
    condition: { ...rule.condition, resourceTypes: [...rule.condition.resourceTypes].reverse(), isUrlFilterCaseSensitive: false, excludedResponseHeaders: [] } }));
  await c.reconcile(config, full, true); assert.equal(writes(f).length, 1, 'normalized echo must not cause a rewrite loop');
  for (const [name, mutate] of Object.entries({
    'different value': rule => { if (rule.id === 300100) rule.action.requestHeaders[0].value += 'x'; },
    'missing https filter': rule => { delete rule.condition.urlFilter; },
    'widened initiator': rule => { rule.condition.excludedInitiatorDomains = []; },
    'extra effective condition': rule => { rule.condition.requestDomains = ['example.com']; },
    'another action key': rule => { rule.action.redirect = { url: 'https://example.com' }; },
    'wrong priority': rule => { rule.priority = 2; },
    'removed header dropped': rule => { if (rule.id === 300103) rule.action.requestHeaders.pop(); },
  })) {
    const g = fixture(), d = new AntidetectHeaderController(g.api);
    await d.reconcile(config, full, true); const before = writes(g).length;
    g.set(g.current().map(rule => { const next = copy(rule); mutate(next); return next; }));
    await d.reconcile(config, full, true);
    assert.equal(writes(g).length, before + 1, name); assert.deepEqual(own(g.current()), build(config).rules, name);
  }
});

test('Firefox or absent native DNR report unsupported without touching native rules', async () => {
  const firefox = fixture({ firefox: true }), a = new AntidetectHeaderController(firefox.api);
  assert.deepEqual(await a.reconcile(identity(), full, true), { status: 'unsupported', set: [], removed: [], reason: 'engine' }); assert.deepEqual(firefox.calls, []);
  const missing = fixture(), b = new AntidetectHeaderController(missing.api); delete missing.api.declarativeNetRequest;
  assert.deepEqual(await b.reconcile(identity(), full, true), { status: 'unsupported', set: [], removed: [], reason: 'engine' }); assert.deepEqual(missing.calls, []);
  const partial = fixture(); partial.api.declarativeNetRequest = { getDynamicRules: async () => [] };
  assert.equal((await new AntidetectHeaderController(partial.api).reconcile(identity(), full, true)).status, 'unsupported');
});

test('invalid configuration is rejected before any native read or write and keeps previously applied rules', async () => {
  const f = fixture(), c = new AntidetectHeaderController(f.api);
  await c.reconcile(identity(), full, true); const before = f.calls.length, rules = f.current();
  for (const value of [null, {}, { ...identity(), antidetectEnabled: 'true' }, { ...identity(), apis: [] }]) assert.deepEqual(await c.reconcile(value, full, true), { status: 'error', set: [], removed: [], reason: null });
  assert.equal((await c.reconcile(identity(), null, true)).status, 'error'); assert.equal((await c.reconcile(identity(), full, 1)).status, 'error');
  assert.equal(f.calls.length, before); assert.deepEqual(f.current(), rules);
});

test('native errors, ignored writes and false returns never claim applied or expose native exception text', async () => {
  for (const failure of ['read', 'write', 'ignored', 'false']) {
    const f = fixture(), c = new AntidetectHeaderController(f.api);
    if (failure === 'ignored') f.ignore(); else if (failure === 'false') f.result(false); else f.fail(failure);
    const result = await c.reconcile(identity(), full, true);
    assert.deepEqual(result, { status: 'error', set: [], removed: [], reason: null }); assert.equal(JSON.stringify(c.inspect()).includes('private'), false);
    assert.ok(writes(f).length <= 1, 'a native failure never triggers an implicit write retry');
  }
});

test('timed-out native write retains the physical mutex and does not overlap queued retries or cleanup', async () => {
  const f = fixture(), c = new AntidetectHeaderController(f.api, { timeoutMs: 15 }); let release;
  f.hold(new Promise(resolve => { release = resolve; }));
  const config = identity(), first = c.reconcile(config, full, true), second = c.reconcile({ ...config, antidetectEnabled: false }, full, false);
  assert.equal((await first).status, 'error'); assert.equal((await second).status, 'error');
  assert.equal(writes(f).length, 1); assert.equal(f.maximumWrites(), 1);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(own(f.current()).length, 4, 'a late physical write may settle, but was never reported applied after timeout');
  assert.equal((await c.reconcile({ ...config, antidetectEnabled: false }, full, false)).status, 'inactive');
  assert.equal(writes(f).length, 2); assert.equal(f.maximumWrites(), 1); assert.deepEqual(f.current(), f.foreign);
});

test('timed-out native read cannot later dispatch a write and blocks repeats until physically settled', async () => {
  const f = fixture(), c = new AntidetectHeaderController(f.api, { timeoutMs: 15 }); let release;
  f.readsHold(new Promise(resolve => { release = resolve; }));
  assert.equal((await c.reconcile(identity(), full, true)).status, 'error'); assert.equal((await c.reconcile(identity(), full, true)).status, 'error');
  assert.deepEqual(f.calls.map(row => row[0]), ['read']);
  release(); await new Promise(resolve => setImmediate(resolve)); assert.equal(writes(f).length, 0);
  assert.equal((await c.reconcile(identity(), full, true)).status, 'applied');
});

test('concurrent reconciles are serialized and the final state always matches the last request', async () => {
  const f = fixture(), c = new AntidetectHeaderController(f.api), config = identity();
  const runs = await Promise.all([c.reconcile(config, full, true), c.reconcile({ ...config, antidetectEnabled: false }, full, true), c.reconcile(config, full, true), c.reconcile(configuration({ 'navigator-user-agent': FIREFOX }), full, true)]);
  assert.deepEqual(runs.map(item => item.status), ['applied', 'inactive', 'applied', 'applied']); assert.equal(f.maximumWrites(), 1);
  assert.deepEqual(own(f.current()).map(rule => rule.id), [300100, 300102, 300103, 300109]);
});

test('snapshot inspection is detached and holds only safe lowercase names, statuses and reasons', async () => {
  const f = fixture(), c = new AntidetectHeaderController(f.api);
  assert.deepEqual(c.inspect(), NONE);
  await c.reconcile(identity(), full, true);
  const snapshot = c.inspect(); snapshot.status = 'inactive'; snapshot.set.length = 0;
  assert.equal(c.inspect().status, 'applied'); assert.equal(c.inspect().set.length, 5);
  assert.equal(/[A-Z]/.test(JSON.stringify(c.inspect().set)), false);
  assert.equal(JSON.stringify(c.inspect()).includes('Mozilla'), false, 'no header value is exposed through the snapshot');
});

test('nine rules are one atomic write; turning one row off drops only its rule; an unchanged repeat writes nothing', async () => {
  const f = fixture(), c = new AntidetectHeaderController(f.api), config = configuration({ 'navigator-user-agent': AGENT, 'client-hints': HINTS, ...EXTRA });
  assert.equal((await c.reconcile(config, full, true)).status, 'applied');
  assert.deepEqual(f.calls.map(row => row[0]), ['read', 'write', 'read']);
  assert.deepEqual(own(f.current()).map(rule => rule.id).sort(), [300100, 300102, 300103, 300104, 300105, 300106, 300107, 300108]); assert.deepEqual(others(f), f.foreign);
  const next = change(config, 'network-information', { mode: 'off' });
  const result = await c.reconcile(next, full, true);
  assert.deepEqual(result.removed, [...HIGH, ...OTHER_NAMES.filter(name => !GROUPS['network-information'][1].includes(name))]);
  assert.deepEqual(own(f.current()).map(rule => rule.id).sort(), [300100, 300102, 300103, 300104, 300105, 300106, 300108]); assert.deepEqual(others(f), f.foreign);
  const before = writes(f).length; await c.reconcile(next, full, true); assert.equal(writes(f).length, before);
  // Rules left in the reserved range (300110..300119) by an earlier version are cleaned; 300120 is not ours.
  f.set([...f.current(), { id: 300110, priority: 1, action: { type: 'block' }, condition: {} }, { id: 300119, priority: 1, action: { type: 'block' }, condition: {} }]);
  await c.reconcile(next, full, true); assert.deepEqual(own(f.current()).map(rule => rule.id).sort(), [300100, 300102, 300103, 300104, 300105, 300106, 300108]);
  assert.equal(f.current().some(rule => rule.id === 300120), true);
});

// ---- wiring through the real ApiConfigurationController ---------------------------------------------------------------
function controllerFixture({ firefox = false, early = true } = {}) {
  const stored = {}, scripts = new Map(), content = new Map(); let earlyAvailable = early;
  const dnr = fixture({ firefox });
  const api = {
    runtime: { id: EXT, getURL: path => (firefox ? 'moz-extension://owned/' : 'chrome-extension://owned/') + path, getManifest: () => ({ manifest_version: 3 }) },
    storage: { local: { async get(key) { return Object.hasOwn(stored, key) ? { [key]: copy(stored[key]) } : {}; }, async set(items) { Object.assign(stored, copy(items)); } } },
    scripting: {
      async getRegisteredContentScripts({ ids } = {}) { return [...content.values()].filter(row => !ids || ids.includes(row.id)).map(copy); },
      async registerContentScripts(rows) { for (const row of rows) content.set(row.id, copy(row)); }, async updateContentScripts(rows) { for (const row of rows) content.set(row.id, copy(row)); },
      async unregisterContentScripts({ ids }) { for (const id of ids) content.delete(id); },
    },
    userScripts: {
      async getScripts() { if (!earlyAvailable) throw new Error('browser userScripts access disabled'); return [...scripts.values()].map(copy); },
      async register(rows) { for (const row of rows) scripts.set(row.id, copy(row)); }, async update(rows) { for (const row of rows) scripts.set(row.id, copy(row)); },
      async unregister({ ids }) { for (const id of ids) scripts.delete(id); },
    },
    tabs: { async query() { return []; } }, webNavigation: { async getAllFrames() { return []; } },
    declarativeNetRequest: dnr.api.declarativeNetRequest,
  };
  const scope = { accessReady: true, hasDataConsent: true, accessGeneration: 1, desiredMatches: () => full, isGranted: async () => true };
  const legacy = { settings: { schemaVersion: 1, revision: 0, enabled: false, preset: 'limited', global: [], sites: [] }, chain: Promise.resolve(), registration: 'inactive', accessUnavailable: false, cleanupIncomplete: false,
    async start() {}, serialize(operation) { const next = this.chain.then(operation, operation); this.chain = next.catch(() => {}); return next; },
    async reconcile() { this.registration = 'inactive'; }, async stopOpenDocuments() {}, async finishApplication() {} };
  const ui = { id: EXT, origin: 'chrome-extension://owned', url: 'chrome-extension://owned/options.html' };
  const controller = new ApiConfigurationController({ api, legacy, scope, whenReady: async () => {}, verifyUiSender: sender => sender.id === EXT && sender.tab === undefined && sender.origin === ui.origin, readPageSender: () => ({ ok: false }) });
  return { controller, dnr, api, scope, ui, setEarly: flag => { earlyAvailable = flag; }, stored };
}
async function save(f, config) {
  const before = await f.controller.state(null);
  const response = await f.controller.set(config, before.revision, null);
  assert.equal(response.type, 'api-config-state', JSON.stringify(response)); return response;
}

test('wiring: saving a Custom identity installs the header rules; master Off removes them; header unsupported is not an application error', async () => {
  const f = controllerFixture(); await f.controller.start();
  const base = f.controller.configuration;
  let config = { ...base, antidetectEnabled: true, preset: 'custom' };
  for (const [id, raw] of Object.entries({ 'navigator-user-agent': AGENT, 'navigator-languages': ['de-DE', 'de'], 'client-hints': HINTS })) config = custom(config, id, raw);
  const state = await save(f, config);
  assert.equal(state.registration, 'ready'); assert.deepEqual(own(f.dnr.current()).map(rule => rule.id), [300100, 300101, 300102, 300103]);
  assert.equal(f.controller.antidetectHeaders.inspect().status, 'applied');
  // The real protocol guard legitimately removes its own two stale IDs; every other foreign rule must survive.
  const survivors = f.dnr.foreign.filter(rule => ![300000, 300001].includes(rule.id));
  assert.deepEqual(others({ current: f.dnr.current }), survivors);
  // Unsupported scope: no rule, and still not an error.
  f.scope.desiredMatches = () => ['https://example.com/*'];
  const scoped = await save(f, { ...f.controller.configuration, preset: 'limited' });
  assert.notEqual(scoped.registration, 'error'); assert.equal(own(f.dnr.current()).length, 0); assert.equal(f.controller.antidetectHeaders.inspect().reason, 'scope');
  f.scope.desiredMatches = () => full;
  await save(f, { ...f.controller.configuration, preset: 'custom' }); assert.equal(own(f.dnr.current()).length, 4);
  const off = await save(f, { ...f.controller.configuration, antidetectEnabled: false });
  assert.equal(own(f.dnr.current()).length, 0); assert.notEqual(off.registration, 'error'); assert.deepEqual(others({ current: f.dnr.current }), survivors);
});

test('wiring: headers follow the early registration - without native userScripts access no header rule is installed', async () => {
  const f = controllerFixture(); await f.controller.start();
  let config = { ...f.controller.configuration, antidetectEnabled: true, preset: 'custom' };
  config = custom(config, 'navigator-user-agent', AGENT);
  await save(f, config); assert.equal(own(f.dnr.current()).length, 1);
  f.setEarly(false);
  await f.controller.reconcile(); assert.equal(own(f.dnr.current()).length, 0, 'JavaScript identity is not applied, so the header identity must not be either');
  f.setEarly(true); await f.controller.reconcile(); assert.equal(own(f.dnr.current()).length, 1);
});

test('wiring: a native header failure raises the application error exactly like the protocol guard', async () => {
  const f = controllerFixture(); await f.controller.start();
  let config = { ...f.controller.configuration, antidetectEnabled: true, preset: 'custom' };
  config = custom(config, 'navigator-user-agent', AGENT);
  f.dnr.fail('write');
  const state = await save(f, config);
  assert.equal(state.registration, 'error'); assert.equal(f.controller.recoveryPending, true);
  f.dnr.fail('');
  await f.controller.reconcile(); assert.equal(f.controller.registration, 'ready'); assert.equal(own(f.dnr.current()).length, 1);
});

test('wiring: Firefox keeps working with the header controller reporting unsupported', async () => {
  const f = controllerFixture({ firefox: true }); f.api.runtime.getBrowserInfo = async () => ({ name: 'Firefox', version: '140' });
  await f.controller.start();
  let config = { ...f.controller.configuration, antidetectEnabled: true, preset: 'custom' };
  config = custom(config, 'navigator-user-agent', AGENT);
  const state = await save(f, config);
  assert.notEqual(state.registration, 'error'); assert.equal(f.controller.antidetectHeaders.inspect().reason, 'engine'); assert.deepEqual(f.dnr.calls, []);
});

test('wiring: a matching Custom hardware row alone installs its remove-only rule and obeys the early-access gate', async () => {
  const f = controllerFixture(); await f.controller.start();
  let config = { ...f.controller.configuration, antidetectEnabled: true, preset: 'custom' };
  config = custom(config, 'device-memory', 4);
  const state = await save(f, config);
  assert.equal(state.registration, 'ready'); assert.deepEqual(own(f.dnr.current()).map(rule => rule.id), [300104]);
  assert.deepEqual(f.controller.antidetectHeaders.inspect(), { status: 'applied', set: [], removed: ['device-memory', 'sec-ch-device-memory'], reason: null });
  f.setEarly(false); await f.controller.reconcile(); assert.equal(own(f.dnr.current()).length, 0);
  f.setEarly(true); await f.controller.reconcile(); assert.deepEqual(own(f.dnr.current()).map(rule => rule.id), [300104]);
});

// ---- X-Client-Data (ADR-105 amendment, measured Chrome 156 / Chromium 153) -------------------------------------------------------
// Remove-only, one rule (300109), active only while the applied Custom identity claims a browser other than Google Chrome.
const EDGE = AGENT + ' Edg/156.0.0.0';
const OPERA = AGENT + ' OPR/112.0.0.0';
const SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
const YANDEX = AGENT + ' YaBrowser/24.1.0 Yowser/2.5';
const VIVALDI = AGENT + ' Vivaldi/6.5';
const CHROME_FOR_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1';
const EDGE_HINTS = { brands: [{ brand: 'Not.A/Brand', version: '24' }, { brand: 'Chromium', version: '156' }, { brand: 'Microsoft Edge', version: '156' }], mobile: false, platform: 'Windows' };
const CHROMIUM_HINTS = { brands: [{ brand: 'Chromium', version: '156' }, { brand: 'Not.A/Brand', version: '24' }], mobile: false, platform: 'Windows' };
const CLIENT_DATA_RULE = { id: 300109, priority: 1000, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'X-Client-Data', operation: 'remove' }] },
  condition: { resourceTypes: [...ANTIDETECT_HEADER_REQUEST_TYPES], excludedInitiatorDomains: [EXT] } };
const clientDataRule = built => built.rules.find(rule => rule.id === 300109);

test('claimedBrand names a product only from an explicit token; a bare Chrome token stays Chrome and an unrecognisable claim is not guessed', () => {
  const table = [[AGENT, 'chrome'], [EDGE, 'edge'], [AGENT + ' EdgA/156.0.0.0', 'edge'], ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/131.0 Version/17.0 Mobile/15E148 Safari/604.1', 'edge'],
    ['Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.102 Safari/537.36 Edge/18.19041', 'edge'],
    [OPERA, 'opera'], ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) OPiOS/16.0.15 Mobile/15E148 Safari/9537.53', 'opera'],
    [FIREFOX, 'firefox'], ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15', 'firefox'],
    [SAMSUNG, 'samsung'], [YANDEX, 'yandex'], [VIVALDI, 'vivaldi'], [SAFARI, 'safari'], [CHROME_FOR_IOS, 'chrome'], ['HeadlessChrome/153.0.0.0', 'chrome'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Ubuntu Chromium/80.0.3987.87 Chrome/80.0.3987.87 Safari/537.36', 'chromium'],
    ['KnowledgeEdge/1.0 Chrome/156.0.0.0', 'chrome'], ['Mozilla/5.0 (X11; Linux x86_64)', 'unknown'], ['', 'unknown'], [7, 'unknown'], [null, 'unknown']];
  for (const [agent, brand] of table) assert.equal(claimedBrand(agent), brand, String(agent));
});

test('X-Client-Data is removed, and only removed, while the applied identity claims a browser other than Google Chrome', () => {
  const claimsOther = [
    ['Edge user agent', { 'navigator-user-agent': EDGE }], ['Firefox user agent', { 'navigator-user-agent': FIREFOX }], ['Safari user agent', { 'navigator-user-agent': SAFARI }],
    ['plain Chromium user agent (explicit Chromium/ token)', { 'navigator-user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Ubuntu Chromium/80.0.3987.87 Chrome/80.0.3987.87 Safari/537.36' }],
    ['Opera user agent', { 'navigator-user-agent': OPERA }], ['Samsung user agent', { 'navigator-user-agent': SAMSUNG }], ['Yandex user agent', { 'navigator-user-agent': YANDEX }], ['Vivaldi user agent', { 'navigator-user-agent': VIVALDI }],
    ['Edge brand list', { 'client-hints': EDGE_HINTS }], ['plain Chromium brand list', { 'client-hints': CHROMIUM_HINTS }], ['empty brand list (no UA-CH browser)', { 'client-hints': { ...HINTS, brands: [] } }],
    ['Chrome user agent but Edge brands', { 'navigator-user-agent': AGENT, 'client-hints': EDGE_HINTS }], ['Edge user agent but Google Chrome brands', { 'navigator-user-agent': EDGE, 'client-hints': HINTS }],
    ['full Edge identity', { 'navigator-user-agent': EDGE, 'navigator-languages': ['de-DE', 'de'], 'client-hints': EDGE_HINTS }],
  ];
  for (const [name, rows] of claimsOther) {
    const config = configuration(rows), built = build(config), result = describe(config);
    assert.deepEqual(clientDataRule(built), CLIENT_DATA_RULE, name);
    assert.equal(result.removed.includes('x-client-data'), true, name); assert.equal(result.set.includes('x-client-data'), false, name);
    assert.equal(JSON.stringify(built.rules.filter(rule => rule.id === 300109)).includes('"value"'), false, 'a value is never written: ' + name);
  }
  const claimsChrome = [
    ['nothing Custom', {}], ['Chrome user agent', { 'navigator-user-agent': AGENT }], ['Google Chrome brand list', { 'client-hints': HINTS }], ['full Chrome identity', { 'navigator-user-agent': AGENT, 'navigator-languages': ['de-DE'], 'client-hints': HINTS }],
    ['Chrome for iOS user agent', { 'navigator-user-agent': CHROME_FOR_IOS }], ['unrecognisable user agent (not guessed)', { 'navigator-user-agent': 'Mozilla/5.0 (X11; Linux x86_64)' }], ['languages alone', { 'navigator-languages': ['de-DE'] }],
    ['device rows alone', EXTRA],
  ];
  for (const [name, rows] of claimsChrome) {
    const config = configuration(rows);
    assert.equal(clientDataRule(build(config)), undefined, name); assert.equal(describe(config).removed.includes('x-client-data'), false, name);
  }
});

test('the X-Client-Data rule is one exact remove-only rule: the thirteen measured types, the extension initiator excluded, no URL filter and no value', () => {
  const built = build(configuration({ 'navigator-user-agent': EDGE })), rule = clientDataRule(built);
  assert.deepEqual(rule, CLIENT_DATA_RULE);
  assert.deepEqual(Object.keys(rule), ['id', 'priority', 'action', 'condition']); assert.deepEqual(Object.keys(rule.action), ['type', 'requestHeaders']);
  assert.deepEqual(Object.keys(rule.action.requestHeaders[0]), ['header', 'operation']); assert.deepEqual(Object.keys(rule.condition), ['resourceTypes', 'excludedInitiatorDomains']);
  assert.equal(rule.condition.resourceTypes.includes('main_frame'), true, 'main_frame is excluded by default and must be listed');
  assert.deepEqual(built.rules.map(item => item.id), [300100, 300109]);
  assert.deepEqual(describe(configuration({ 'navigator-user-agent': EDGE })), { status: 'applied', set: ['user-agent'], removed: ['x-client-data'], reason: null });
  // Alone, without a User-Agent row: the brand list is the whole claim.
  assert.deepEqual(describe(configuration({ 'client-hints': EDGE_HINTS })), { status: 'applied', set: LOW, removed: [...HIGH, 'x-client-data'], reason: null });
  // The full set is ten rules; X-Client-Data is last, after the five measured hint groups, and the order is stable.
  const everything = configuration({ 'navigator-user-agent': EDGE, 'navigator-languages': ['de-DE', 'de'], 'client-hints': EDGE_HINTS, ...EXTRA });
  assert.deepEqual(build(everything).rules.map(item => item.id), [300100, 300101, 300102, 300103, 300104, 300105, 300106, 300107, 300108, 300109]);
  assert.deepEqual(describe(everything), { status: 'applied', set: ['user-agent', 'accept-language', ...LOW], removed: [...HIGH, ...OTHER_NAMES, 'x-client-data'], reason: null });
});

test('the X-Client-Data rule obeys every gate of the other header rules: master, active flag, modes, scope, sites, invalid values and engine', () => {
  const edge = configuration({ 'navigator-user-agent': EDGE });
  assert.equal(describe(edge).removed.includes('x-client-data'), true);
  assert.deepEqual(describe(edge, full, false), NONE); assert.deepEqual(describe({ ...edge, antidetectEnabled: false }), NONE); assert.deepEqual(describe({ ...edge, antidetectEnabled: false, enabled: true }), NONE);
  for (const mode of ['off', 'on', 'bypass']) assert.deepEqual(describe(change(edge, 'navigator-user-agent', { mode })), NONE, 'dormant Custom value under ' + mode + ' creates no rule');
  for (const matches of [[], ['https://*/*'], ['http://*/*'], ['https://example.com/*']]) { assert.deepEqual(describe(edge, matches), { status: 'unsupported', set: [], removed: [], reason: 'scope' }); assert.deepEqual(build(edge, matches).rules, []); }
  assert.deepEqual(describe(custom(edge, 'navigator-user-agent', AGENT, 'exact.fixture.invalid')), { status: 'unsupported', set: [], removed: [], reason: 'site-overrides' }, 'one exact site that claims Chrome cannot be expressed: nothing is applied');
  assert.deepEqual(describe(configuration({ 'navigator-user-agent': 'café' })), { status: 'unsupported', set: [], removed: [], reason: 'invalid' });
  assert.deepEqual(build(configuration({ 'navigator-user-agent': 'café', 'client-hints': EDGE_HINTS })).rules, [], 'identity is applied as a whole or not at all');
  for (const options of [undefined, { chrome: false }]) assert.deepEqual(describeAntidetectHeaders(edge, full, true, options), { status: 'unsupported', set: [], removed: [], reason: 'engine' });
});

test('the X-Client-Data rule follows the identity: it appears with an Edge claim, leaves with a Chrome claim or the master, and nothing else moves', async () => {
  const f = fixture(), c = new AntidetectHeaderController(f.api);
  const chrome = identity(), edge = configuration({ 'navigator-user-agent': EDGE, 'navigator-languages': ['de-DE', 'de', 'en-US', 'en'], 'client-hints': EDGE_HINTS });
  await c.reconcile(chrome, full, true);
  assert.deepEqual(own(f.current()).map(rule => rule.id), [300100, 300101, 300102, 300103], 'a Chrome claim leaves X-Client-Data alone');
  const applied = await c.reconcile(edge, full, true);
  assert.deepEqual(applied.removed, [...HIGH, 'x-client-data']); assert.equal(applied.status, 'applied');
  assert.deepEqual(own(f.current()).map(rule => rule.id), [300100, 300101, 300102, 300103, 300109]); assert.deepEqual(own(f.current()), build(edge).rules); assert.deepEqual(others(f), f.foreign);
  const before = writes(f).length; await c.reconcile(edge, full, true); assert.equal(writes(f).length, before, 'an unchanged repeat writes nothing');
  await c.reconcile(chrome, full, true);
  assert.deepEqual(own(f.current()).map(rule => rule.id), [300100, 300101, 300102, 300103], 'back to a Chrome claim: the rule is gone'); assert.deepEqual(others(f), f.foreign);
  await c.reconcile(edge, full, true);
  assert.equal((await c.reconcile({ ...edge, antidetectEnabled: false }, full, true)).status, 'inactive');
  assert.deepEqual(own(f.current()), []); assert.deepEqual(f.current(), f.foreign, 'disabling Antidetect removes the rule together with the others');
  await c.reconcile(edge, full, true); assert.equal(own(f.current()).some(rule => rule.id === 300109), true);
  assert.deepEqual(await c.reconcile(edge, full, false), NONE); assert.deepEqual(f.current(), f.foreign, 'an inactive extension removes it too');
});

test('a tampered or broadened X-Client-Data rule is rewritten to the exact remove-only rule', async () => {
  const config = configuration({ 'navigator-user-agent': EDGE });
  for (const [name, mutate] of Object.entries({
    'set instead of remove': rule => { rule.action.requestHeaders[0] = { header: 'X-Client-Data', operation: 'set', value: 'x' }; },
    append: rule => { rule.action.requestHeaders[0].operation = 'append'; },
    'another header': rule => { rule.action.requestHeaders[0].header = 'Cookie'; },
    'extra header': rule => { rule.action.requestHeaders.push({ header: 'Referer', operation: 'remove' }); },
    'widened initiator': rule => { rule.condition.excludedInitiatorDomains = []; },
    'url filter added': rule => { rule.condition.urlFilter = '|https://'; },
    'fewer types': rule => { rule.condition.resourceTypes = ['main_frame']; },
    'wrong priority': rule => { rule.priority = 1; },
  })) {
    const f = fixture(), c = new AntidetectHeaderController(f.api);
    await c.reconcile(config, full, true); const before = writes(f).length;
    f.set(f.current().map(rule => { const next = copy(rule); if (rule.id === 300109) mutate(next); return next; }));
    await c.reconcile(config, full, true);
    assert.equal(writes(f).length, before + 1, name); assert.deepEqual(own(f.current()), build(config).rules, name);
  }
  // A leftover of an older run at 300109 (when the claim is Chrome) is cleaned like any other stale rule of the range.
  const stale = fixture(), d = new AntidetectHeaderController(stale.api);
  stale.set([...stale.foreign, CLIENT_DATA_RULE]);
  assert.equal((await d.reconcile(identity(), full, true)).status, 'applied'); assert.deepEqual(own(stale.current()).map(rule => rule.id), [300100, 300101, 300102, 300103]);
});

test('wiring: saving an Edge identity installs the X-Client-Data rule through the real controller and the early-access gate removes it', async () => {
  const f = controllerFixture(); await f.controller.start();
  let config = { ...f.controller.configuration, antidetectEnabled: true, preset: 'custom' };
  for (const [id, raw] of Object.entries({ 'navigator-user-agent': EDGE, 'client-hints': EDGE_HINTS })) config = custom(config, id, raw);
  const state = await save(f, config);
  assert.equal(state.registration, 'ready'); assert.deepEqual(own(f.dnr.current()).map(rule => rule.id), [300100, 300102, 300103, 300109]);
  assert.deepEqual(f.controller.antidetectHeaders.inspect().removed.slice(-1), ['x-client-data']);
  f.setEarly(false); await f.controller.reconcile(); assert.equal(own(f.dnr.current()).length, 0, 'without the early registration the JavaScript identity is not applied, so neither is the header identity');
  f.setEarly(true); await f.controller.reconcile(); assert.equal(own(f.dnr.current()).some(rule => rule.id === 300109), true);
  await save(f, { ...f.controller.configuration, antidetectEnabled: false }); assert.equal(own(f.dnr.current()).length, 0);
});
