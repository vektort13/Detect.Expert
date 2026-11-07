// E22-24: directly typed IPv4/IPv6 values, native Options controls and immutable first-inline RTC metadata.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';
import { WEBRTC_CUSTOM_INPUT_FILES, expectedWebRtcInputDelivery } from './webrtc-custom-input-delivery.mjs';

const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/webrtc-custom-input-' + browser + '-')), extension = join(run, 'extension');
cpSync(join(root, 'dist', browser), extension, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const evidence = { at: new Date().toISOString(), browser, run, result: 'RUNNING', disposableProfile: true,
  ownedLoopbackOnly: true, externalStunTurnCalls: false, rawUserDataRead: false, checks: [], hashes: {}, layouts: [] };
for (const file of WEBRTC_CUSTOM_INPUT_FILES) {
  const bytes = readFileSync(join(extension, file));
  assert.ok(bytes.equals(expectedWebRtcInputDelivery(root, file, browser)), 'stale delivered file: ' + file);
  evidence.hashes[file] = sha(bytes);
}

const entered = { ipv4: { host: '192.0.2.117', stun: '198.51.100.118', turn: '203.0.113.119' },
  ipv6: { host: '2001:db8:71::a17', stun: '2001:db8:82::b18', turn: '2001:db8:93::c19' } };
const rawAddress = { ipv4: '10.21.31.41', ipv6: 'fd12:3456:789a::41' };
const fields = Object.entries(entered).flatMap(([family, values]) => Object.entries(values).map(([role, value]) => [family + ':' + role, value]));

function firstInlineProbe() {
  const native = { ipv4: '10.21.31.41', ipv6: 'fd12:3456:789a::41' }, rows = [];
  for (const family of ['ipv4', 'ipv6']) for (const [role, type] of [['host', 'host'], ['stun', 'srflx'], ['turn', 'relay']]) {
    const object = new RTCIceCandidate({ candidate: 'candidate:owned 1 UDP 2122260223 ' + native[family] + ' 5000 typ ' + type + ' raddr ' + native[family] + ' rport 5001', sdpMid: '0' });
    rows.push({ family, role, nativeObject: object instanceof RTCIceCandidate, address: object.address,
      borrowed: Object.getOwnPropertyDescriptor(RTCIceCandidate.prototype, 'address').get.call(object), candidate: object.candidate,
      json: object.toJSON().candidate, prototypeJson: RTCIceCandidate.prototype.toJSON.call(object).candidate });
  }
  const object = new RTCSessionDescription({ type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP6 ' + native.ipv6 + '\r\ns=-\r\nc=IN IP4 ' + native.ipv4 + '\r\n' });
  globalThis.__ownedWebRtcInputFirst = { rows, description: object.sdp, descriptionJson: object.toJSON().sdp, ready: true };
}
const server = createServer((request, response) => {
  request.resume(); response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.setHeader('Cache-Control', 'no-store');
  response.end('<!doctype html><script>try{(' + firstInlineProbe.toString() + ')()}catch(e){globalThis.__ownedWebRtcInputFirst={error:e.name}}</script><h1>Owned Custom IP first-script fixture</h1>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

// Firefox WebDriver values belong to its sandbox. Native parsing keeps data
// dictionaries and scripting functions inside the real extension-page realm.
const bridgeSource = `const api=globalThis.browser??globalThis.chrome;
export function send(json){return api.runtime.sendMessage(JSON.parse(json));}
export async function probe(origin){const url=origin+'/first-inline?'+Math.random(),tab=await api.tabs.create({url,active:false});try{for(let i=0;i<150;i++){const current=await api.tabs.get(tab.id);if(current.status==='complete'&&current.url===url){const result=await api.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:()=>globalThis.__ownedWebRtcInputFirst??null});if(result[0]?.result)return result[0].result;}await new Promise(done=>setTimeout(done,30));}throw Error('owned-first-inline-timeout');}finally{await api.tabs.remove(tab.id);}}
`;
writeFileSync(join(extension, 'webrtc-input-native-bridge.js'), bridgeSource);
evidence.fixtureBridgeSHA256 = sha(Buffer.from(bridgeSource));
let opened, phase = 'startup';
const check = message => { evidence.checks.push(message); console.log('  ok ' + message); };
const evaluate = (fn, value) => opened.evaluate(fn, value);
const send = message => evaluate(async json => {
  const api = globalThis.browser ?? globalThis.chrome;
  return (await import(api.runtime.getURL('webrtc-input-native-bridge.js'))).send(json);
}, JSON.stringify({ schemaVersion: 1, ...message }));
const state = () => send({ type: 'ui-api-config-get', tabId: null });
const rtc = configuration => configuration.apis.find(row => row.id === 'webrtc');
const displayed = () => evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-antidetect-address]')].map(input => [input.dataset.antidetectAddress, input.value])));
const wantedFields = () => Object.fromEntries(fields);
const ready = () => until(() => evaluate(() => document.querySelector('[data-antidetect-app]')?.getAttribute('aria-busy') === 'false' && Boolean(document.querySelector('[data-antidetect-master]'))), 'Antidetect control readiness');
async function save() {
  const before = await state();
  await opened.click('[data-antidetect-save]');
  await until(async () => {
    const current = await state();
    return current.type === 'api-config-state' && current.revision > before.revision && await evaluate(() => document.querySelector('[data-antidetect-app]')?.getAttribute('aria-busy') === 'false' && document.querySelector('[data-antidetect-dirty]')?.dataset.antidetectDirty === 'false');
  }, 'completed revision and settled saved controls');
  assert.ok(!await evaluate(() => document.querySelector('[data-antidetect-error]')?.textContent), 'Save returned an error');
  return state();
}
// The master switch is its own immediate write (ADR-104): it leaves no draft to Save, so wait for that revision instead.
async function master(enabled) {
  const before = await state();
  await opened.click('[data-antidetect-master]');
  await until(async () => {
    const current = await state();
    return current.type === 'api-config-state' && current.revision > before.revision && await evaluate(() => document.querySelector('[data-antidetect-app]')?.getAttribute('aria-busy') === 'false' && document.querySelector('[data-antidetect-dirty]')?.dataset.antidetectDirty === 'false');
  }, 'completed master revision and settled controls');
  assert.ok(!await evaluate(() => document.querySelector('[data-antidetect-error]')?.textContent), 'the master switch returned an error');
  assert.equal(await evaluate(() => document.querySelector('[data-antidetect-master]')?.getAttribute('aria-checked')), String(enabled));
  assert.equal(await evaluate(() => document.querySelector('[data-antidetect-save]')?.disabled ?? true), true, 'the master switch leaves nothing to Save');
  return state();
}
const probe = () => evaluate(async origin => {
  const api = globalThis.browser ?? globalThis.chrome;
  return (await import(api.runtime.getURL('webrtc-input-native-bridge.js'))).probe(origin);
}, origin);
function verifyProbe(value, active) {
  assert.ok(value?.ready, value?.error ?? 'missing first-inline proof'); assert.equal(value.rows.length, 6);
  for (const row of value.rows) {
    const expected = active ? entered[row.family][row.role] : rawAddress[row.family];
    // Chromium exposes a bracketed IPv6 getter for a constructed native
    // candidate. Custom must still return the exact unbracketed selected value.
    const nativeGetter = !active && row.family === 'ipv6' && row.address === '[' + expected + ']' ? '[' + expected + ']' : expected;
    assert.equal(row.nativeObject, true); assert.equal(row.address, nativeGetter); assert.equal(row.borrowed, nativeGetter);
    assert.equal(row.json, row.candidate); assert.equal(row.prototypeJson, row.candidate);
    assert.ok(row.candidate.includes(' ' + expected + ' '));
    if (active) assert.equal(row.candidate.includes(rawAddress[row.family]), false);
  }
  assert.equal(value.description, value.descriptionJson);
  for (const family of ['ipv4', 'ipv6']) assert.ok(value.description.includes(active ? entered[family].host : rawAddress[family]));
}

try {
  opened = await launchOwnedManagement({ root, run, extension, browser, evidence }); evidence.version = opened.version;
  await opened.goto(opened.base + 'options.html#settings');
  await until(() => evaluate(() => Boolean(document.querySelector('[data-management-shell]'))), 'management mount');
  await send({ type: 'ui-data-consent-set', version: 1, accepted: true });
  await send({ type: 'ui-set-scope', scopeMode: 'all-sites' });
  await opened.goto(opened.base + 'options.html#antidetect'); await ready();
  if (browser === 'firefox') {
    await until(() => evaluate(() => Boolean(document.querySelector('[data-antidetect-grant-early]'))), 'Firefox userScripts grant');
    await opened.click('[data-antidetect-grant-early]'); await ready();
    await until(async () => (await state()).earlyAccess === 'ready', 'native Firefox early access');
  }
  const initial = await state();
  assert.equal(initial.configuration.enabled, false); assert.equal(initial.configuration.antidetectEnabled, false);
  assert.equal(rtc(initial.configuration).selected.kind, 'unset');
  const visible = await evaluate(() => [...document.querySelectorAll('[data-antidetect-address]')].map(input => ({ key: input.dataset.antidetectAddress, visible: input.getClientRects().length > 0, disabled: input.matches(':disabled'), value: input.value })));
  assert.equal(visible.length, 6); assert.deepEqual(visible.map(row => row.key).sort(), fields.map(([key]) => key).sort());
  assert.ok(visible.every(row => row.visible && !row.disabled && row.value === ''));
  assert.equal(await evaluate(() => document.querySelector('[data-antidetect-addresses-enabled]').checked), false);
  verifyProbe(await probe(), false);
  check('initial Network renders all six empty IPv4/IPv6 Host/STUN/TURN fields directly, with both masters OFF and native first-inline metadata');

  phase = 'direct custom input';
  await opened.click('[data-antidetect-mode="webrtc:allow"]');
  for (const [key, value] of fields) await opened.fill('[data-antidetect-address="' + key + '"]', value);
  await ready();
  assert.deepEqual(await displayed(), wantedFields());
  assert.equal(await evaluate(() => document.querySelector('[data-antidetect-mode="webrtc:spoof"]').getAttribute('aria-checked')), 'true');
  assert.equal(await evaluate(() => document.querySelector('[data-antidetect-addresses-enabled]').checked), true);
  assert.equal((await state()).revision, initial.revision);
  assert.equal(await evaluate(() => document.querySelector('[data-antidetect-master]').getAttribute('aria-checked')), 'false');
  await opened.click('[data-antidetect-addresses-enabled]');
  assert.equal(await evaluate(() => document.querySelectorAll('[data-antidetect-address]').length), 6);
  await opened.click('[data-antidetect-addresses-enabled]');
  assert.deepEqual(await displayed(), wantedFields()); assert.equal((await state()).revision, initial.revision);
  check('typing six independent nonpreset literal IPs selects a Custom draft without saving or enabling a master; disabling and re-enabling IP replacement retains every entered value');

  phase = 'save and new Options document';
  const saved = await save();
  assert.equal(saved.configuration.enabled, false); assert.equal(saved.configuration.antidetectEnabled, false);
  assert.equal(rtc(saved.configuration).mode, 'custom'); assert.deepEqual(rtc(saved.configuration).selected.value.addresses, entered);
  assert.ok(rtc(saved.configuration).userValues.some(row => JSON.stringify(row.value.value?.addresses) === JSON.stringify(entered)));
  verifyProbe(await probe(), false);
  await opened.goto(opened.base + 'options.html#antidetect'); await ready();
  assert.deepEqual(await displayed(), wantedFields()); assert.equal((await state()).revision, saved.revision);
  check('Save stores exactly the six manually entered addresses and a reusable Custom profile; a new Options document restores them while both masters remain OFF');

  phase = 'invalid family rejection';
  await opened.fill('[data-antidetect-address="ipv4:stun"]', '2001:db8::9');
  await opened.click('[data-antidetect-save]'); await ready();
  await until(() => evaluate(() => Boolean(document.querySelector('[data-antidetect-error]')?.textContent)), 'wrong-family validation error');
  assert.equal((await state()).revision, saved.revision); assert.deepEqual(rtc((await state()).configuration).selected.value.addresses, entered);
  await opened.click('[data-antidetect-cancel]'); await ready(); assert.deepEqual(await displayed(), wantedFields());
  check('an IPv6 literal in an IPv4 field is rejected before storage mutation; Cancel restores the complete saved profile');

  phase = 'actual early Custom application';
  const active = await master(true);
  assert.equal(active.configuration.antidetectEnabled, true); assert.equal(active.configuration.enabled, false); assert.equal(active.registration, 'ready');
  verifyProbe(await probe(), true);
  check('with Antidetect ON and API Guard OFF, the first inline script receives all six entered addresses from genuine native candidate getters, borrowed getters, candidate text/toJSON and IPv4/IPv6 SDP');

  phase = 'Allow removes Custom behavior';
  await opened.click('[data-antidetect-mode="webrtc:allow"]'); const allowed = await save();
  assert.equal(allowed.configuration.antidetectEnabled, true); assert.equal(allowed.configuration.enabled, false);
  assert.deepEqual(rtc(allowed.configuration).selected.value.addresses, entered); verifyProbe(await probe(), false);
  assert.deepEqual(await displayed(), wantedFields());
  await opened.click('[data-antidetect-mode="webrtc:spoof"]'); const restored = await save();
  assert.deepEqual(rtc(restored.configuration).selected.value.addresses, entered); verifyProbe(await probe(), true);
  check('Allow stops using dormant Custom addresses on new documents, and selecting Custom restores the exact saved values without enabling API Guard');

  phase = 'API Guard direct configuration';
  await opened.goto(opened.base + 'options.html#api');
  await until(() => evaluate(() => document.querySelector('[data-api-configuration-editor]')?.getAttribute('aria-busy') === 'false' && Boolean(document.querySelector('[data-webrtc-row-configure]'))), 'API Guard direct WebRTC control');
  await opened.click('[data-webrtc-row-configure]');
  await until(() => evaluate(() => document.querySelectorAll('[role="dialog"] [data-webrtc-field]').length >= 6), 'direct WebRTC editor');
  assert.deepEqual(await evaluate(() => Object.fromEntries([...document.querySelectorAll('[role="dialog"] [data-webrtc-field]')].filter(field => field.dataset.webrtcField.includes(':')).map(field => [field.dataset.webrtcField, field.value]))), wantedFields());
  assert.equal((await state()).revision, restored.revision);
  check('API Guard exposes a direct WebRTC configuration button whose editor shows the same six saved IPv4/IPv6 values without another write');

  phase = 'layout proof';
  await opened.goto(opened.base + 'options.html#antidetect'); await ready();
  await evaluate(() => (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-language-v1': 'ru' }));
  await until(() => evaluate(() => document.querySelector('[data-management-shell]')?.lang === 'ru'), 'Russian locale');
  for (const width of [1180, 580]) {
    await opened.viewport(width, 900); await pause(70);
    const layout = await evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, fields: [...document.querySelectorAll('[data-antidetect-address]')].map(field => ({ visible: field.getClientRects().length > 0, value: field.value, width: field.getBoundingClientRect().width })) }));
    assert.equal(layout.width, width); assert.equal(layout.overflow, false); assert.equal(layout.fields.length, 6); assert.ok(layout.fields.every(field => field.visible && field.width > 100));
    evidence.layouts.push(layout); await opened.screenshot(join(run, 'ru-' + width + '.png'));
  }
  check('all six explicit Custom IP inputs remain visible without horizontal overflow in Russian wide and narrow layouts');
  evidence.result = 'PASS';
} catch (error) {
  evidence.result = 'FAIL'; evidence.phase = phase; evidence.error = String(error.message).slice(0, 400);
  if (opened) try { await opened.screenshot(join(run, 'failure.png')); } catch {}
  throw error;
} finally {
  if (opened) await opened.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
  const output = join(root, 'test-results/production-1.1.0/webrtc-custom-input', browser + '.json');
  mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
}
console.log('WebRTC direct Custom input ' + browser + ': ' + evidence.checks.length + ' checks PASS');
