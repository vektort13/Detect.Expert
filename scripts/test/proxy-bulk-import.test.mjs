// ADR-107: proxy list import, single-paste recognition and the editor session helper.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseProxyProfileList, parseProxyProfileText, inspectProxyText, proxyEndpointLabel, PROXY_LIMITS, PROXY_LIST_LIMITS, PROXY_LIST_REASONS, ProxyError } from '../../apps/production-extension/proxy-shared.js';
import { proxyApplySession, proxySessionFormatValid, proxySessionToken, proxyBulkInput, proxyCheckState, proxySortedProfiles, PROXY_SESSION_FORMAT } from '../../apps/production-extension/proxy-ui.js';

const ok = entry => assert.ok(entry?.profile, JSON.stringify(entry));
const reason = (text, expected, options) => { const { entries } = parseProxyProfileList(text, options); assert.equal(entries.length, 1, text); assert.equal(entries[0].reason, expected, text); assert.equal(entries[0].profile, undefined); };
const uuid = '5e7b5c1f-8b45-4e1f-9b9d-0eed6882f4cc';

test('list import: IPv6 brackets, @ and # inside passwords survive and a name needs whitespace before #', () => {
  const { entries } = parseProxyProfileList(['[::1]:1080', 'user:p@ss@h.example:1080', 'h.example:1081:user:pa#ss', 'h.example:1082:user:pa#ss #Office  A', 'socks5://user:pa#ss@h.example:1083 #URL form', 'socks5h://user:p%40ss@[2001:db8::1]:1084'].join('\n'));
  entries.forEach(ok);
  assert.deepEqual(entries.map(entry => [entry.line, entry.profile.host, entry.profile.port, entry.profile.username, entry.profile.password, entry.name]), [
    [1, '::1', 1080, '', '', '[::1]:1080'],
    [2, 'h.example', 1080, 'user', 'p@ss', 'h.example:1080'],
    [3, 'h.example', 1081, 'user', 'pa#ss', 'h.example:1081'],
    [4, 'h.example', 1082, 'user', 'pa#ss', 'Office  A'],
    [5, 'h.example', 1083, 'user', 'pa#ss', 'URL form'],
    [6, '2001:db8::1', 1084, 'user', 'p@ss', '[2001:db8::1]:1084'],
  ]);
  // Legacy four-field passwords are literal: '%41' stays three characters.
  assert.equal(parseProxyProfileList('h.example:1080:user:p%41ss').entries[0].profile.password, 'p%41ss');
});

test('list import: CRLF, CR, BOM, comments and blank lines keep physical 1-based line numbers', () => {
  const { entries } = parseProxyProfileList('\uFEFF# exported list\r\n\r\n203.0.113.1:1080\r203.0.113.2:1080\n   \n# note\r\n203.0.113.3:1080   #  Third  \r\n');
  assert.deepEqual(entries.map(entry => [entry.line, entry.endpoint.host, entry.name]), [[3, '203.0.113.1', '203.0.113.1:1080'], [4, '203.0.113.2', '203.0.113.2:1080'], [7, '203.0.113.3', 'Third']]);
});

test('list import: more than 100 lines parse, room follows the 100-profile limit and 1000 lines bound the work', () => {
  const lines = Array.from({ length: 150 }, (_, index) => '203.0.113.' + (index % 200) + ':' + (2000 + index)).join('\n');
  const empty = parseProxyProfileList(lines);
  assert.equal(empty.entries.length, 150); assert.ok(empty.entries.every(entry => entry.profile)); assert.equal(empty.room, PROXY_LIMITS.profiles);
  const existing = Array.from({ length: 98 }, (_, index) => ({ id: 'p' + index, name: 'n', type: 'socks5', host: '198.51.100.' + index, port: 1080, native: false }));
  assert.equal(parseProxyProfileList(lines, { existing }).room, 2);
  assert.equal(parseProxyProfileList(lines, { existing: [...existing, ...existing] }).room, 0);
  const huge = parseProxyProfileList(Array.from({ length: 1205 }, (_, index) => '203.0.113.' + (index % 250) + ':' + (1000 + index)).join('\n'));
  assert.equal(PROXY_LIST_LIMITS.lines, 1000); assert.equal(huge.entries.length, 1001); assert.deepEqual(huge.entries.at(-1), { line: 1001, reason: 'too-many-lines' });
  assert.throws(() => parseProxyProfileList('x'.repeat(PROXY_LIMITS.configBytes + 1)), error => error instanceof ProxyError && error.code === 'invalid-input');
  for (const options of [{ order: 'auto' }, { existing: 'none' }]) assert.throws(() => parseProxyProfileList('203.0.113.1:1080', options), ProxyError);
});

test('list import: exact duplicates inside the paste are skipped; saved host:port only warns', () => {
  const text = ['203.0.113.5:1080:user:one #A', '203.0.113.5:1080:user:one #B', '203.0.113.5:1080:user:two', 'user:one@203.0.113.5:1080', 'proxy.example:1080'].join('\n');
  const { entries } = parseProxyProfileList(text, { existing: [{ id: 'saved', name: 'Saved', type: 'socks5', host: 'proxy.example', port: 1080, native: false }] });
  assert.deepEqual(entries.map(entry => entry.reason ?? 'ok'), ['ok', 'duplicate', 'ok', 'duplicate', 'ok']);
  assert.equal(entries[1].duplicateOf, 1); assert.equal(entries[3].duplicateOf, 1);
  assert.equal(entries[4].warning, 'saved-endpoint'); assert.ok(entries[4].profile); assert.equal(entries[0].warning, undefined);
});

test('list import: VLESS lines name themselves from the fragment unless an explicit name follows', () => {
  const { entries } = parseProxyProfileList(['vless://' + uuid + '@relay.example:443?security=tls#First%20Relay', 'vless://' + uuid + '@relay.example:443?security=tls#Second', 'vless://' + uuid + '@relay.example:8443?security=tls #Explicit', 'vless://not-a-uuid@relay.example:443'].join('\n'));
  assert.deepEqual(entries.map(entry => entry.reason ?? entry.name), ['First Relay', 'duplicate', 'Explicit', 'invalid-vless']);
  assert.deepEqual(entries[0].endpoint, { host: 'relay.example', port: 443 }); assert.equal(entries[0].profile.type, 'vless'); assert.match(entries[0].profile.uri, /^vless:\/\//);
});

test('list import: each failure is a fixed reason with its line and never echoes the rejected text', () => {
  const cases = [['ftp://203.0.113.1:2121', 'unsupported-scheme'], ['socks4://203.0.113.1:1080', 'unsupported-scheme'], ['constructor://203.0.113.1:1080', 'unsupported-scheme'], ['203.0.113.1', 'invalid-port'], ['203.0.113.1:0', 'invalid-port'], ['203.0.113.1:65536', 'invalid-port'], ['bad_host!:1080', 'invalid-host'], ['127.1:1080', 'invalid-host'], ['user@203.0.113.1:1080', 'invalid-credentials'], ['u:p%zz@203.0.113.1:1080', 'invalid-credentials'], ['203.0.113.1:1080:' + 'u'.repeat(256) + ':p', 'invalid-credentials'], ['vless://' + uuid + '@relay.example:443?evil=1', 'invalid-vless'], ['203.0.113.1:1080 #' + 'n'.repeat(PROXY_LIMITS.name + 1), 'invalid-name'], ['bad line here', 'invalid-line'], ['user:pass:203.0.113.9:1080', 'wrong-order']];
  for (const [text, expected] of cases) reason(text, expected);
  reason('203.0.113.9:1080:user:pass', 'wrong-order', { order: 'login-first' });
  assert.deepEqual(parseProxyProfileList('client\ndev tun\nremote vpn.example 1194\n<ca>\nSECRET_CA_CANARY\n</ca>').entries, [{ line: 1, reason: 'openvpn-config' }]);
  const failures = parseProxyProfileList(['socks4://LOGIN_CANARY:PASSWORD_CANARY@203.0.113.1:1080', 'LOGIN_CANARY@203.0.113.1:1080', 'PASSWORD_CANARY line'].join('\n'));
  assert.doesNotMatch(JSON.stringify(failures), /LOGIN_CANARY|PASSWORD_CANARY/);
  for (const entry of failures.entries) assert.ok(PROXY_LIST_REASONS.includes(entry.reason));
});

test('list import: the chosen field order is explicit and never silently swapped', () => {
  const lines = ['user:pass:203.0.113.9:1080', 'user:pa:ss:[2001:db8::1]:1080 #V6', 'u@x:pw@d:203.0.113.10:1081'].join('\n');
  const loginFirst = parseProxyProfileList(lines, { order: 'login-first' }).entries;
  assert.deepEqual(loginFirst.map(entry => [entry.profile.username, entry.profile.password, entry.profile.host, entry.profile.port]), [['user', 'pass', '203.0.113.9', 1080], ['user', 'pa:ss', '2001:db8::1', 1080], ['u@x', 'pw@d', '203.0.113.10', 1081]]);
  assert.deepEqual(parseProxyProfileList(lines).entries.map(entry => entry.reason), ['wrong-order', 'wrong-order', 'wrong-order']);
  // Host-first stays the reading of an ambiguous line (port-shaped second field).
  assert.equal(parseProxyProfileList('alice:12345:bob.example:1080').entries[0].profile.host, 'alice');
});

test('single paste keeps every previously accepted form and adds raw # and login-first only as a fallback', () => {
  assert.deepEqual(parseProxyProfileText('socks5h://user:p%40ss@[2001:db8::1]:1080'), { type: 'socks5', host: '2001:db8::1', port: 1080, username: 'user', password: 'p@ss' });
  assert.equal(parseProxyProfileText('proxy.example:1080:user:pass').password, 'pass');
  assert.equal(parseProxyProfileText('SOCKS5://Proxy.Example:01080/').host, 'proxy.example');
  assert.equal(parseProxyProfileText('socks5://[::ffff:1.2.3.4]:1080').host, '::ffff:102:304');
  assert.equal(parseProxyProfileText('socks5://user:pa#ss@h.example:1080').password, 'pa#ss');
  assert.deepEqual(parseProxyProfileText('user:pass:203.0.113.9:1080'), { type: 'socks5', host: '203.0.113.9', port: 1080, username: 'user', password: 'pass' });
  for (const text of ['ftp://proxy.example:1080', 'socks5://h.example:1080?x', 'h.example', 'u@h.example:1080', 'socks5://h.example:1080/path', 'http://h.example:8080?x']) assert.throws(() => parseProxyProfileText(text), ProxyError, text);
  assert.equal(parseProxyProfileText('client\nremote vpn.example 1194\n').type, 'openvpn');
});

test('paste preview summary exposes type, endpoint and a login flag only', () => {
  assert.deepEqual(inspectProxyText('socks5://LOGIN_CANARY:PASSWORD_CANARY@proxy.example.test:2345'), { state: 'ok', type: 'socks5', host: 'proxy.example.test', port: 2345, credentials: true });
  assert.deepEqual(inspectProxyText('vless://' + uuid + '@relay.example:443?security=tls#Name'), { state: 'ok', type: 'vless', host: 'relay.example', port: 443, credentials: false });
  assert.deepEqual(inspectProxyText('client\nremote vpn.example 1194\n<key>\nKEY_CANARY\n</key>'), { state: 'ok', type: 'openvpn', host: null, port: null, credentials: false });
  assert.deepEqual(inspectProxyText('   '), { state: 'empty' });
  assert.deepEqual(inspectProxyText('ftp://PASSWORD_CANARY@x.example:1'), { state: 'invalid', reason: 'unsupported-scheme' });
  assert.equal(proxyEndpointLabel('2001:db8::1', 1080), '[2001:db8::1]:1080'); assert.equal(proxyEndpointLabel(null, null), '');
});

test('session helper: explicit format, end-anchored replacement, never the start of a login', () => {
  assert.equal(PROXY_SESSION_FORMAT, '-session-{session}');
  assert.equal(proxyApplySession('user', PROXY_SESSION_FORMAT, 'abc123xyz0'), 'user-session-abc123xyz0');
  assert.equal(proxyApplySession('user-session-abc123xyz0', PROXY_SESSION_FORMAT, 'zzzzzzzzzz'), 'user-session-zzzzzzzzzz');
  assert.equal(proxyApplySession('user-country-us', '-sessid-{session}-sesstime-10', 'abcdef1234'), 'user-country-us-sessid-abcdef1234-sesstime-10');
  assert.equal(proxyApplySession('user-country-us-sessid-OLD123-sesstime-10', '-sessid-{session}-sesstime-10', 'abcdef1234'), 'user-country-us-sessid-abcdef1234-sesstime-10');
  assert.equal(proxyApplySession('pass', '_session-{session}_lifetime-30m', 'abcdef1234'), 'pass_session-abcdef1234_lifetime-30m');
  // A literal part elsewhere in the login is not mistaken for the session.
  assert.equal(proxyApplySession('john-session-1-x', PROXY_SESSION_FORMAT, 'abcdef1234'), 'john-session-1-x-session-abcdef1234');
  assert.equal(proxyApplySession('a$&b', '-s-{session}', 'abcdef1234'), 'a$&b-s-abcdef1234');
  for (const format of ['{session}', '-session-', '-a-{session}-{session}', '- {session}', 'x'.repeat(60) + '{session}', '-s-{session}\n']) assert.equal(proxySessionFormatValid(format), false, format);
  assert.equal(proxyApplySession('user', '{session}', 'abcdef1234'), null); assert.equal(proxyApplySession('user', PROXY_SESSION_FORMAT, 'BAD!'), null);
  const bytes = [7, 255, 252, 251, 35, 36, 0, 71, 200, 100, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11];
  const random = { getRandomValues(array) { array.set(bytes.slice(0, array.length)); return array; } };
  // 255 and 252 are rejected (252 = 7 x 36) so every character is equally likely.
  assert.equal(proxySessionToken(10, random), 'h99aa9u2bc');
  const token = proxySessionToken(); assert.match(token, /^[a-z0-9]{10}$/); assert.notEqual(token, proxySessionToken());
});

test('bulk input mirrors the single editor contract and never adds empty secret keys', () => {
  assert.deepEqual(proxyBulkInput({ name: 'Direct', profile: { type: 'socks5', host: 'h.example', port: 1080, username: '', password: '' } }, 'p-1'), { id: 'p-1', name: 'Direct', type: 'socks5', host: 'h.example', port: 1080 });
  assert.deepEqual(proxyBulkInput({ name: 'Auth', profile: { type: 'socks5', host: 'h.example', port: 1080, username: 'u', password: 'p' } }, 'p-2'), { id: 'p-2', name: 'Auth', type: 'socks5', host: 'h.example', port: 1080, username: 'u', password: 'p' });
  assert.deepEqual(proxyBulkInput({ name: 'V', profile: { type: 'vless', uri: 'vless://x' } }, 'p-3'), { id: 'p-3', name: 'V', type: 'vless', uri: 'vless://x' });
  assert.equal(proxyBulkInput({ name: 'Erased', profile: { type: 'socks5', host: 'h.example', port: 1080 } }, 'p-4'), null);
  assert.equal(proxyBulkInput({ name: 'Bad', profile: { type: 'openvpn', config: 'client' } }, 'p-5'), null);
});

test('status filter uses only real last manual results and keeps the existing sort and search', () => {
  const rows = [{ id: 'a', name: 'A', type: 'socks5', host: 'a.example', port: 1080 }, { id: 'b', name: 'B', type: 'socks5', host: 'b.example', port: 1081 }, { id: 'c', name: 'C', type: 'vless', host: 'c.example', port: 443 }];
  const checks = { a: { diagnostic: { state: 'pass', elapsedMs: 5 }, checkedAt: 1 }, b: { diagnostic: { state: 'fail', code: 'auth-failed' }, checkedAt: 2 } };
  assert.deepEqual(['all', 'pass', 'fail', 'unchecked'].map(status => proxySortedProfiles(rows, '', 'all', 'name', checks, status).map(row => row.id)), [['a', 'b', 'c'], ['a'], ['b'], ['c']]);
  assert.equal(proxyCheckState(checks, rows[2]), 'unchecked'); assert.equal(proxyCheckState({ c: { diagnostic: { state: 'weird' } } }, rows[2]), 'unchecked');
  assert.deepEqual(proxySortedProfiles(rows, 'b.example:1081').map(row => row.id), ['b']);
});

// ---- Round 5: HTTP and HTTPS lines and the type chosen for lines without a scheme -----------------------------------------------
const NL = String.fromCharCode(10);
const parsed = (text, options) => parseProxyProfileList(text, options).entries;
const shape = entry => [entry.profile.type, entry.profile.host, entry.profile.port, entry.profile.username, entry.profile.password];

test('list import: http:// and https:// URLs carry userinfo, percent-escapes, IPv6 brackets, ports and names like socks5://', () => {
  const entries = parsed(['http://user:p%40ss%3Aword@h.example:8080', 'HTTPS://u:pa#ss@[2001:db8::1]:8443/ #TLS box', 'http://203.0.113.5:3128', 'https://p%C3%A4ss:x@203.0.113.6:443', 'http://u:p@w@h.example:80', 'socks5h://u:p@h.example:1080'].join(NL));
  entries.forEach(ok);
  assert.deepEqual(entries.map(shape), [['http', 'h.example', 8080, 'user', 'p@ss:word'], ['https', '2001:db8::1', 8443, 'u', 'pa#ss'], ['http', '203.0.113.5', 3128, '', ''], ['https', '203.0.113.6', 443, 'p' + String.fromCodePoint(0xe4) + 'ss', 'x'], ['http', 'h.example', 80, 'u', 'p@w'], ['socks5', 'h.example', 1080, 'u', 'p']]);
  assert.deepEqual(entries.map(entry => entry.name), ['h.example:8080', 'TLS box', '203.0.113.5:3128', '203.0.113.6:443', 'h.example:80', 'h.example:1080']);
  assert.deepEqual(entries.map(entry => entry.endpoint), [{ host: 'h.example', port: 8080 }, { host: '2001:db8::1', port: 8443 }, { host: '203.0.113.5', port: 3128 }, { host: '203.0.113.6', port: 443 }, { host: 'h.example', port: 80 }, { host: 'h.example', port: 1080 }]);
});

test('list import: an HTTP or HTTPS line fails with the same fixed reasons, never with its text, and a colon in the user name is a credentials error', () => {
  const cases = [['http://203.0.113.1', 'invalid-port'], ['https://203.0.113.1:0', 'invalid-port'], ['http://203.0.113.1:65536', 'invalid-port'], ['http://bad_host!:8080', 'invalid-host'], ['https://127.1:443', 'invalid-host'], ['http://:8080', 'invalid-host'], ['http://user@203.0.113.1:8080', 'invalid-credentials'], ['http://u:p%zz@203.0.113.1:8080', 'invalid-credentials'], ['http://a%3Ab:c@203.0.113.1:8080', 'invalid-credentials'], ['https://' + 'u'.repeat(256) + ':p@203.0.113.1:443', 'invalid-credentials'], ['http://203.0.113.1:8080 #' + 'n'.repeat(PROXY_LIMITS.name + 1), 'invalid-name'], ['http://203.0.113.1:8080?x=1', 'invalid-port'], ['http://203.0.113.1:8080/path', 'invalid-port']];
  for (const [text, expected] of cases) reason(text, expected);
  const failures = parseProxyProfileList(['http://LOGIN_CANARY@203.0.113.1:8080', 'https://LOGIN_CANARY:PASSWORD_CANARY@:443', 'http://a%3Alogin:PASSWORD_CANARY@203.0.113.2:80'].join(NL));
  assert.doesNotMatch(JSON.stringify(failures), /LOGIN_CANARY|PASSWORD_CANARY|login/); for (const entry of failures.entries) assert.ok(PROXY_LIST_REASONS.includes(entry.reason));
  // A colon is legal in a SOCKS5 user name (RFC 1929), so the same line is fine there.
  assert.equal(parsed('socks5://a%3Alogin:pw@203.0.113.2:1080')[0].profile.username, 'a:login');
});

test('list import: lines without a scheme take the chosen type, a scheme always wins, and mixed lists stay one list', () => {
  const text = ['203.0.113.1:8080', '203.0.113.2:8080:user:pass', 'user:pass@203.0.113.3:8080', '[2001:db8::1]:8080', 'socks5://203.0.113.4:1080', 'https://203.0.113.5:443', 'http://203.0.113.6:80'].join(NL);
  for (const [defaultType, kinds] of [['socks5', ['socks5', 'socks5', 'socks5', 'socks5', 'socks5', 'https', 'http']], ['http', ['http', 'http', 'http', 'http', 'socks5', 'https', 'http']], ['https', ['https', 'https', 'https', 'https', 'socks5', 'https', 'http']]]) {
    const entries = parsed(text, { defaultType }); entries.forEach(ok);
    assert.deepEqual(entries.map(entry => entry.profile.type), kinds, defaultType);
  }
  assert.equal(parsed(text)[0].profile.type, 'socks5', 'socks5 stays the default');
  const login = parsed('user:pass:203.0.113.9:8080', { defaultType: 'https', order: 'login-first' })[0]; assert.deepEqual(shape(login), ['https', '203.0.113.9', 8080, 'user', 'pass']);
  assert.equal(parsed('203.0.113.9:8080:user:pass', { defaultType: 'http', order: 'login-first' })[0].reason, 'wrong-order', 'the order hint still works for the other kinds');
  assert.equal(parsed('203.0.113.9:8080:a:b', { defaultType: 'http' })[0].profile.type, 'http');
  for (const defaultType of ['ftp', 'vless', 'openvpn', '', null, 5, 'toString']) assert.throws(() => parseProxyProfileList('203.0.113.1:8080', { defaultType }), error => error instanceof ProxyError && error.code === 'invalid-input', String(defaultType));
});

test('list import: the same address under different kinds or logins is not a duplicate, the same line twice is, and a saved address only warns', () => {
  const entries = parsed(['203.0.113.1:8080', 'http://203.0.113.1:8080', 'https://203.0.113.1:8080', 'socks5://203.0.113.1:8080', 'http://203.0.113.1:8080 #again', 'http://u:p@203.0.113.1:8080', 'http://u:p@203.0.113.1:8080 #again'].join(NL), { defaultType: 'http', existing: [{ id: 'saved', name: 'S', type: 'http', host: '203.0.113.1', port: 8080, native: false }] });
  assert.deepEqual(entries.map(entry => entry.reason ?? 'ok'), ['ok', 'duplicate', 'ok', 'ok', 'duplicate', 'ok', 'duplicate']);
  assert.deepEqual(entries.filter(entry => entry.reason).map(entry => entry.duplicateOf), [1, 1, 6]);
  assert.ok(entries.filter(entry => entry.profile).every(entry => entry.warning === 'saved-endpoint'));
});

test('single paste and the live preview read a line without a scheme in the chosen kind and never reveal a login', () => {
  assert.deepEqual(parseProxyProfileText('203.0.113.5:8080:LOGIN:SECRET', { defaultType: 'http' }), { type: 'http', host: '203.0.113.5', port: 8080, username: 'LOGIN', password: 'SECRET' });
  assert.deepEqual(parseProxyProfileText('https://u:p%40@203.0.113.5:8443', { defaultType: 'http' }), { type: 'https', host: '203.0.113.5', port: 8443, username: 'u', password: 'p@' });
  assert.equal(parseProxyProfileText('203.0.113.5:8080').type, 'socks5');
  assert.deepEqual(inspectProxyText('203.0.113.5:8080:LOGIN_CANARY:SECRET_CANARY', { defaultType: 'https' }), { state: 'ok', type: 'https', host: '203.0.113.5', port: 8080, credentials: true });
  assert.deepEqual(inspectProxyText('http://203.0.113.5:8080'), { state: 'ok', type: 'http', host: '203.0.113.5', port: 8080, credentials: false });
  assert.deepEqual(inspectProxyText('ftp://203.0.113.5:21', { defaultType: 'http' }), { state: 'invalid', reason: 'unsupported-scheme' });
  assert.equal(inspectProxyText('203.0.113.5:8080', { defaultType: 'bogus' }).type, 'socks5', 'an unknown kind never reaches the parser');
  assert.throws(() => parseProxyProfileText('203.0.113.5:8080', { defaultType: 'bogus' }), ProxyError);
  assert.doesNotMatch(JSON.stringify(inspectProxyText('http://LOGIN_CANARY:SECRET_CANARY@203.0.113.5:8080')), /CANARY/);
});
