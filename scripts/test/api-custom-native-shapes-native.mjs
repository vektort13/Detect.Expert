// ADR-107 native check: real Chromium/Chrome compares its own MemoryInfo, NetworkInformation, Permissions/Push, voices, media
// devices and StorageManager.estimate shapes with the Custom projections. The production installer is serialized like the page
// bootstrap does; no extension build is needed.
// Usage: node scripts/test/api-custom-native-shapes-native.mjs [--chrome] [--headed]   (--headed: real voices on Windows)
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright';
import { readFileSync } from 'node:fs';
import { createMediaCodecMatcher } from '../../apps/production-extension/api-custom-media-codecs.js';
import { installMediaTypeHooks } from '../../apps/production-extension/api-custom-media-types.js';
import { installMediaCapabilitiesBridge } from '../../apps/production-extension/api-custom-media-bridge.js';
import { createPrivateMediaCapabilitiesBackend } from '../../apps/production-extension/api-custom-media-private-runtime.js';
import { mediaProfileChannel } from '../../apps/production-extension/api-custom-media-profile.js';
import { CODEC_QUERIES, CODEC_PROFILES, absentFamilies, assertDrm, assertLowered, installKit, readKit } from './media-codecs-kit.mjs';
const { installApiCustom } = await import(process.env.NATIVE_SHAPES_RUNTIME_SOURCE ? pathToFileURL(process.env.NATIVE_SHAPES_RUNTIME_SOURCE).href : '../../apps/production-extension/api-custom-runtime.js');

const KEY = '0f1e2d3c4b5a69788796a5b4c3d2e1f000112233445566778899aabbccddeeff', headed = process.argv.includes('--headed');
const installer = installApiCustom.toString();
const useFirefox = process.argv.includes('--firefox');
// Playwright Firefox is pinned to one revision; an older installed revision still speaks the protocol (FIREFOX_BINARY overrides).
async function launchFirefox() {
  try { return await firefox.launch({ headless: true }); }
  catch { return await firefox.launch({ headless: true, executablePath: process.env.FIREFOX_BINARY || join(process.env.LOCALAPPDATA || '', 'ms-playwright/firefox-1538/firefox/firefox.exe') }); }
}
const browser = useFirefox ? await launchFirefox() : await chromium.launch({ headless: !headed, ...(process.argv.includes('--chrome') ? { channel: 'chrome' } : {}),
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', ...(headed ? ['--window-position=-10000,-10000'] : [])] });
const report = { browser: browser.version(), headed, checks: [] };
const ok = label => { report.checks.push(label); console.log('  ok ' + label); };

// Independent SipHash-2-4 (BigInt) for the expected per-host multiplier.
function sipHash(key, message) {
  const mask = (1n << 64n) - 1n, rotl = (x, b) => ((x << BigInt(b)) | (x >> BigInt(64 - b))) & mask;
  const word = (bytes, at) => bytes.slice(at, at + 8).reduce((acc, byte, index) => acc | BigInt(byte) << BigInt(8 * index), 0n);
  const k0 = word(key, 0), k1 = word(key, 8);
  let v0 = k0 ^ 0x736f6d6570736575n, v1 = k1 ^ 0x646f72616e646f6dn, v2 = k0 ^ 0x6c7967656e657261n, v3 = k1 ^ 0x7465646279746573n;
  const round = () => { v0 = (v0 + v1) & mask; v1 = rotl(v1, 13); v1 ^= v0; v0 = rotl(v0, 32); v2 = (v2 + v3) & mask; v3 = rotl(v3, 16); v3 ^= v2; v0 = (v0 + v3) & mask; v3 = rotl(v3, 21); v3 ^= v0; v2 = (v2 + v1) & mask; v1 = rotl(v1, 17); v1 ^= v2; v2 = rotl(v2, 32); };
  const full = message.length - message.length % 8;
  for (let offset = 0; offset < full; offset += 8) { const m = word(message, offset); v3 ^= m; round(); round(); v0 ^= m; }
  let last = BigInt(message.length & 255) << 56n;
  for (let index = 0; index < message.length % 8; index++) last |= BigInt(message[full + index]) << BigInt(8 * index);
  v3 ^= last; round(); round(); v0 ^= last; v2 ^= 0xffn; round(); round(); round(); round();
  return (v0 ^ v1 ^ v2 ^ v3) & mask;
}
function factor(host) {
  if (!host) return 1;
  const words = Array.from({ length: 8 }, (_, index) => Number.parseInt(KEY.slice(index * 8, index * 8 + 8), 16));
  const key = [0, 1, 2, 3].flatMap(index => { const folded = (words[index] ^ words[index + 4]) >>> 0; return [0, 1, 2, 3].map(shift => folded >>> 8 * shift & 255); });
  const message = [...Buffer.from('netinfo/v1', 'latin1'), 0, ...[...host].flatMap(character => [character.charCodeAt(0) & 255, character.charCodeAt(0) >>> 8])];
  return 0.9 + Number(sipHash(key, message) & 0xffffffffn) % 21 * 0.01;
}
const chromeRtt = (rtt, multiplier) => Math.round(Math.min(rtt * multiplier, 3000) / 50) * 50;
const chromeDownlink = (mbps, multiplier) => Math.round(Math.min(mbps * 1000 * multiplier, 10000) / 50) * 50 / 1000;

const context = await browser.newContext();
await context.route(/^https:\/\/[a-z0-9-]+\.invalid\//, route => new URL(route.request().url()).pathname === '/sw.js' ?
  route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }) : route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Native shapes</title>' }));
async function open(host) {
  const page = await context.newPage();
  await page.goto('https://' + host + '/');
  await page.evaluate(`globalThis.__installer = (${installer})`);
  return page;
}

async function memory() {
  const page = await open('memory.invalid');
  const out = await page.evaluate(() => {
    const proto = Object.getPrototypeOf(performance.memory), keys = ['jsHeapSizeLimit', 'totalJSHeapSize', 'usedJSHeapSize'];
    const native = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(proto, key).get]));
    const before = performance.memory, real = keys.map(key => before[key]);
    const limit = 2147483648, guard = globalThis.__installer(globalThis, [{ id: 'performance-memory', mode: 'custom', value: { jsHeapSizeLimit: limit, totalJSHeapSize: 1, usedJSHeapSize: 1 } }]);
    const info = performance.memory, custom = keys.map(key => info[key]), nativeOfSame = keys.map(key => Reflect.apply(native[key], info, []));
    const shape = { fresh: performance.memory !== performance.memory, own: Reflect.ownKeys(performance.memory).length, json: JSON.stringify(performance.memory), tag: Object.prototype.toString.call(performance.memory),
      protoKeys: Reflect.ownKeys(proto).map(String), enumerable: keys.every(key => Object.getOwnPropertyDescriptor(proto, key).enumerable) };
    let brand; try { Reflect.apply(Object.getOwnPropertyDescriptor(proto, 'jsHeapSizeLimit').get, {}, []); brand = 'no throw'; } catch (error) { brand = error.name + ': ' + error.message; }
    const tiny = globalThis.__installer(globalThis, [{ id: 'performance-memory', mode: 'custom', value: { jsHeapSizeLimit: 1000, totalJSHeapSize: 1, usedJSHeapSize: 1 } }]);
    const clamped = keys.map(key => performance.memory[key]);
    tiny.stop(); guard.stop();
    const restored = Object.getOwnPropertyDescriptor(proto, 'jsHeapSizeLimit').get === native.jsHeapSizeLimit && performance.memory.jsHeapSizeLimit === real[0];
    return { real, custom, nativeOfSame, shape, brand, clamped, restored };
  });
  assert.notEqual(out.real[0], 2147483648, 'control: the real limit differs from the selection');
  assert.equal(out.custom[0], 2147483648);
  assert.deepEqual(out.custom.slice(1), out.nativeOfSame.slice(1), 'used/total are the live native numbers of the same object (below the limit)');
  assert.deepEqual(out.shape, { fresh: true, own: 0, json: '{}', tag: '[object MemoryInfo]', protoKeys: ['totalJSHeapSize', 'usedJSHeapSize', 'jsHeapSizeLimit', 'Symbol(Symbol.toStringTag)'], enumerable: true });
  assert.equal(out.brand, 'TypeError: Illegal invocation');
  assert.deepEqual(out.clamped, [1000, 1000, 1000], 'an overlay with a tiny limit clamps the live numbers');
  assert.equal(out.restored, true);
  ok('MemoryInfo: real limit ' + out.real[0] + ' -> selected 2147483648; live used/total kept (' + out.custom.slice(1).join('/') + '); new object per read, no own keys, JSON {}, native brand error; stop restores');
  await page.close();
}

async function network() {
  const rows = [], hosts = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
  for (const name of hosts) {
    const page = await open(name + '.invalid');
    const values = await page.evaluate(([key, selected]) => {
      const real = [navigator.connection.rtt, navigator.connection.downlink, navigator.connection.effectiveType];
      globalThis.__installer(globalThis, [{ id: 'network-information', mode: 'custom', value: selected, networkKey: key }]);
      const frame = document.createElement('iframe'); document.body.append(frame);
      globalThis.__installer(frame.contentWindow, [{ id: 'network-information', mode: 'custom', value: selected, networkKey: key }]);
      const c = navigator.connection, child = frame.contentWindow.navigator.connection;
      return { real, custom: [c.rtt, c.downlink, c.effectiveType, c.saveData], child: [child.rtt, child.downlink], shape: { type: 'type' in c, max: 'downlinkMax' in c, json: JSON.stringify(c), same: c === navigator.connection, own: Reflect.ownKeys(c).length } };
    }, [KEY, { downlink: 1.234, effectiveType: '4g', rtt: 123, saveData: false }]);
    rows.push({ host: name + '.invalid', ...values });
    await page.close();
  }
  for (const row of rows) {
    const multiplier = factor(row.host);
    assert.deepEqual(row.custom, [chromeRtt(123, multiplier), chromeDownlink(1.234, multiplier), '4g', false], row.host);
    assert.deepEqual(row.child, [chromeRtt(123, 1), chromeDownlink(1.234, 1)], 'about:blank child: empty host, multiplier 1 (like Chrome)');
    assert.deepEqual(row.shape, { type: false, max: false, json: '{}', same: true, own: 0 });
  }
  assert.ok(new Set(rows.map(row => row.custom[1])).size >= 2, 'hosts draw different multipliers');
  const types = [];
  for (const [rtt, expected] of [[271, '4g'], [272, '3g'], [1420, '2g'], [2010, 'slow-2g']]) {
    const page = await open('thresholds.invalid');
    types.push([rtt, await page.evaluate(([key, value]) => { globalThis.__installer(globalThis, [{ id: 'network-information', mode: 'custom', value, networkKey: key }]); return navigator.connection.effectiveType; }, [KEY, { downlink: 1, effectiveType: '4g', rtt, saveData: false }]), expected]);
    await page.close();
  }
  for (const [rtt, actual, expected] of types) assert.equal(actual, expected, 'effectiveType for raw rtt ' + rtt);
  report.network = rows.map(row => row.host + ' real=' + row.real.join('/') + ' custom=' + row.custom.slice(0, 3).join('/'));
  ok('NetworkInformation: per-host keyed multiplier, 50 ms/50 kbps buckets, child about:blank multiplier 1, thresholds 272/1420/2010, no type/downlinkMax: ' + report.network.join('; '));
}

async function permissions() {
  const results = {};
  for (const [real, selected] of [['prompt', 'denied'], ['prompt', 'granted'], ['granted', 'default']]) {
    const page = await open('perm-' + real + '-' + selected + '.invalid');
    if (real === 'granted') await context.grantPermissions(['notifications'], { origin: page.url().replace(/\/$/, '') });
    results[real + '->' + selected] = await page.evaluate(async selected => {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const read = async () => [Notification.permission, (await navigator.permissions.query({ name: 'notifications' })).state, (await navigator.permissions.query({ name: 'push', userVisibleOnly: true })).state,
        await registration.pushManager.permissionState({ userVisibleOnly: true }), (await navigator.permissions.query({ name: 'geolocation' })).state];
      const before = await read();
      const guard = globalThis.__installer(globalThis, [{ id: 'notifications', mode: 'custom', value: selected }]);
      const after = await read();
      let rejection; try { await registration.pushManager.permissionState(); } catch (error) { rejection = error.name; }
      let brand; try { Reflect.apply(Object.getOwnPropertyDescriptor(PermissionStatus.prototype, 'state').get, {}, []); } catch (error) { brand = error.message; }
      guard.stop();
      return { before, after, rejection, brand, restored: await read() };
    }, selected);
    await page.close();
  }
  const expected = { default: 'prompt', denied: 'denied', granted: 'granted' };
  for (const [label, row] of Object.entries(results)) {
    const selected = label.split('->')[1], state = expected[selected];
    assert.deepEqual(row.after.slice(0, 4), [selected, state, state, state], label);
    assert.equal(row.after[4], row.before[4], 'geolocation stays native');
    assert.equal(row.rejection, 'NotSupportedError'); assert.equal(row.brand, 'Illegal invocation');
    assert.deepEqual(row.restored, row.before);
  }
  report.permissions = results;
  ok('Notifications: Notification.permission, permissions.query(notifications), query(push,userVisibleOnly) and PushManager.permissionState agree for default/denied/granted; native rejections kept; stop restores');
}

async function voices() {
  const page = await open('voices.invalid');
  const out = await page.evaluate(async () => {
    const native = await new Promise(resolve => { const now = speechSynthesis.getVoices(); if (now.length) return resolve(now); speechSynthesis.addEventListener('voiceschanged', () => resolve(speechSynthesis.getVoices()), { once: true }); setTimeout(() => resolve(speechSynthesis.getVoices()), 3000); });
    const list = native.map(voice => [voice.name, voice.lang, voice.default]);
    // The language of the last native voice: on Windows that is not the default voice's language, so the default must be kept first.
    const selected = native.length ? [native[native.length - 1].lang] : ['en-US'];
    const guard = globalThis.__installer(globalThis, [{ id: 'speech-voices', mode: 'custom', value: { languages: selected } }]);
    const custom = speechSynthesis.getVoices(), base = tag => tag.split(/[-_]/)[0].toLowerCase();
    const sameObjects = custom.every(voice => native.includes(voice));
    const expected = native.filter(voice => voice.default).slice(0, 1).concat(native.filter(voice => !voice.default && base(voice.lang) === base(selected[0])));
    guard.stop();
    return { list, selected, custom: custom.map(voice => voice.name), expected: expected.map(voice => voice.name), sameObjects, emptyStaysArray: Array.isArray(custom) };
  });
  assert.deepEqual(out.custom, out.expected); assert.equal(out.sameObjects, true);
  report.voices = out;
  ok('Speech voices: ' + (out.list.length ? out.list.length + ' native voices -> ' + out.custom.length + ' for ' + out.selected.join(',') + ' (default first, same objects)' : 'no native voices in this mode: the empty native list stays empty'));
  await page.close();
}

async function media() {
  const page = await open('media.invalid');
  const out = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); for (const track of stream.getTracks()) track.stop();
    const real = (await navigator.mediaDevices.enumerateDevices()).map(device => device.kind);
    const row = (kind, label) => ({ kind, deviceId: 'id-' + label, groupId: 'group-' + label, label });
    const rows = [row('videoinput', 'Camera'), row('audioinput', 'Mic 1'), row('audiooutput', 'Speaker'), row('audioinput', 'Mic 2'), row('audioinput', 'Mic 3'), row('audioinput', 'Mic 4'), row('videoinput', 'Camera 2')];
    const guard = globalThis.__installer(globalThis, [{ id: 'media-enumeration', mode: 'custom', value: rows }]);
    const devices = await navigator.mediaDevices.enumerateDevices();
    const custom = devices.map(device => [device.kind, device.label, Object.prototype.toString.call(device), device.toJSON().kind]);
    guard.stop();
    return { real, custom };
  });
  const realCounts = out.real.reduce((counts, kind) => ({ ...counts, [kind]: (counts[kind] || 0) + 1 }), {});
  assert.deepEqual(out.custom.map(device => device[0]), out.custom.map(device => device[3]));
  for (const device of out.custom) assert.ok(device[2] === '[object InputDeviceInfo]' || device[2] === '[object MediaDeviceInfo]', 'native objects only');
  for (const kind of Object.keys(realCounts)) assert.ok(out.custom.filter(device => device[0] === kind).length <= realCounts[kind], 'never more rows than real ' + kind);
  assert.deepEqual(out.custom.map(device => device[1]).filter(label => label.startsWith('Mic')), ['Mic 1', 'Mic 2', 'Mic 3'].slice(0, realCounts.audioinput));
  assert.equal(out.custom.some(device => device[1] === 'Camera 2') && realCounts.videoinput < 2, false);
  report.media = { real: realCounts, custom: out.custom.map(device => device[0] + ':' + device[1]) };
  ok('Media by kind: real ' + JSON.stringify(realCounts) + ' -> ' + report.media.custom.join(', '));
  await page.close();
}

async function storage() {
  const page = await open('storage.invalid');
  const out = await page.evaluate(async () => {
    const real = await navigator.storage.estimate();
    const shapeOf = value => ({ keys: Object.keys(value), details: value.usageDetails, proto: Object.getPrototypeOf(value.usageDetails) === Object.prototype, writable: Object.getOwnPropertyDescriptor(value, 'usageDetails').writable });
    const guard = globalThis.__installer(globalThis, [{ id: 'storage-estimate', mode: 'custom', value: { quota: 10737418240, usage: 0 } }]);
    const zero = shapeOf(await navigator.storage.estimate()), bucket = shapeOf(await (await navigator.storageBuckets.open('shape')).estimate());
    const second = globalThis.__installer(globalThis, [{ id: 'storage-estimate', mode: 'custom', value: { quota: 10738466816, usage: 1048576 } }]);
    const used = await navigator.storage.estimate();
    second.stop(); guard.stop();
    return { real: shapeOf(real), zero, bucket, used: { ...shapeOf(used), sum: Object.values(used.usageDetails).reduce((a, b) => a + b, 0), usage: used.usage, headroom: used.quota - used.usage } };
  });
  assert.deepEqual(out.zero, out.real, 'usage 0: same keys, {} details, plain object, writable');
  assert.deepEqual(out.bucket.keys, ['quota', 'usage', 'usageDetails']); assert.deepEqual(out.bucket.details, {});
  assert.equal(out.used.sum, out.used.usage); assert.deepEqual(out.used.details, { indexedDB: 1048576 });
  ok('StorageManager/StorageBucket estimate: Custom keys quota/usage/usageDetails like native ({} at 0; details sum to usage: ' + JSON.stringify(out.used.details) + ')');
  await page.close();
}

// Round 5 (ADR-101 amendment): a Custom media profile can only LOWER what this browser really reports. The real production pieces run in
// a real page: the codec matcher, the MAIN bridge for MediaCapabilities, the packaged ISOLATED relay, the private backend (its native
// MediaCapabilities is the page's own here) and the canPlayType / isTypeSupported hooks. Expected values come from an independent
// oracle over the NATIVE answers of the same browser (media-codecs-kit.mjs), so the check adapts to the codecs this machine really has.
// A configuration without a key system never leaves the page: the bridge lowers the page's own native answer. A key-system configuration
// keeps the private route (relay and backend, run here in the page). The packaged extension itself is api-custom-media-extension-native.mjs.
const CODEC_SOURCES = {
  codecs: createMediaCodecMatcher.toString(), types: installMediaTypeHooks.toString(), bridge: installMediaCapabilitiesBridge.toString(),
  backend: createPrivateMediaCapabilitiesBackend.toString(), relay: readFileSync(new URL('../../apps/production-extension/api-custom-media-relay.js', import.meta.url), 'utf8')
};

// Records the native answers, installs the real pieces for `profile` (null = native only), records again, stops them and records a third time.
async function codecPage(page, profile) {
  await installKit(page);
  const before = await readKit(page);
  before.stable = JSON.stringify((await readKit(page)).snapshot) === JSON.stringify(before.snapshot);
  if (!profile) return { before };
  const channel = mediaProfileChannel(profile), mask = createMediaCodecMatcher().mask(profile);
  await page.evaluate(async ({ sources, profile, channel, mask }) => {
    const evaluate = text => (0, eval)(text);
    const original = __codecKit.references();
    const codecs = evaluate('(' + sources.codecs + ')()');
    const backend = evaluate('(' + sources.backend + ')')(window, codecs);
    window.chrome = window.chrome || {};
    Object.defineProperty(window.chrome, 'runtime', { configurable: true, value: { sendMessage: message => backend.run(message.payload.serialized, profile, channel) } });
    evaluate(sources.relay);
    globalThis.__chain = { original, bridge: evaluate('(' + sources.bridge + ')')(window, profile, { channel, bitrateBits: 32 }, codecs), hooks: mask === 0 ? null : evaluate('(' + sources.types + ')')(window, mask, codecs) };
  }, { sources: CODEC_SOURCES, profile, channel, mask });
  const active = { ...await readKit(page), shape: await page.evaluate(queries => __codecKit.shape(queries), CODEC_QUERIES),
    changed: await page.evaluate(() => __codecKit.references().map((value, index) => value !== __chain.original[index])) };
  const counters = await page.evaluate(() => ({ bridge: __chain.bridge.snapshot(), hooks: __chain.hooks && __chain.hooks.snapshot() }));
  await page.evaluate(() => { if (__chain.hooks) __chain.hooks.stop(); __chain.bridge.stop(); });
  const restored = { snapshot: (await readKit(page)).snapshot, same: await page.evaluate(() => __codecKit.references().every((value, index) => value === __chain.original[index])) };
  return { before, active, restored, counters };
}

async function codecs() {
  // Native only: the answers must be stable, or no comparison below would mean anything.
  const baseline = await (async () => { const page = await open('codecs-native.invalid'); try { return (await codecPage(page, null)).before; } finally { await page.close(); } })();
  assert.equal(baseline.stable, true, 'native codec answers are stable between two reads');
  const absent = absentFamilies(baseline.snapshot);
  assert.ok(absent.length >= 1, 'this browser lacks at least one probed codec, so "never raised above native" is exercised');
  const summary = [];
  for (const [name, profile] of Object.entries(CODEC_PROFILES)) {
    const page = await open('codecs-' + name + '.invalid');
    let run;
    try { run = await codecPage(page, profile); } finally { await page.close(); }
    assert.deepEqual(run.before.edges, baseline.edges, name + ': native edge outcomes are stable across pages');
    const counts = assertLowered(name, profile, run.before.snapshot, run.active.snapshot);
    assertDrm(name, profile, run.before.snapshot, run.active.snapshot, { installed: true });
    // Calls the profile must not touch: the outcome (value, error name and message) is the native one.
    assert.deepEqual(run.active.edges, run.before.edges, name + ': wrong receivers, missing and odd arguments behave natively');
    assert.deepEqual(run.active.shape, { promise: true, plain: true, keys: 'powerEfficient,smooth,supported,keySystemAccess', access: null }, name + ': decodingInfo keeps the native Promise result shape');
    const mask = createMediaCodecMatcher().mask(profile);
    assert.deepEqual(run.active.changed.slice(0, 3), [mask !== 0, mask !== 0, mask !== 0], name + ': the type hooks exist only when a codec is hidden or supported is false');
    assert.equal(run.active.changed[3], true, name + ': the bridge replaces decodingInfo');
    // Off / Stop restores the exact native functions and answers.
    assert.equal(run.restored.same, true, name + ': Stop restores the native function objects');
    assert.deepEqual(run.restored.snapshot, run.before.snapshot, name + ': after Stop every answer is the native one again');
    summary.push(name + ' lowered ' + counts.lowered + ' kept ' + counts.kept + ' native-false ' + counts.neverRaised);
  }
  report.codecs = { absent, nativeDecode: Object.fromEntries(CODEC_QUERIES.map((query, index) => [query.family ?? 'container', baseline.snapshot.decode[index]])), summary };
  ok('Codecs only downward: ' + summary.join('; ') + '; natively absent here: ' + absent.join(','));
}

async function firefoxScenario() {
  // Firefox has no performance.memory and no navigator.connection: the rows install nothing and nothing throws; notifications map.
  const page = await open('firefox.invalid');
  const out = await page.evaluate(async () => {
    const result = { memory: typeof performance.memory, connection: typeof navigator.connection };
    const guard = globalThis.__installer(globalThis, [{ id: 'performance-memory', mode: 'custom', value: { jsHeapSizeLimit: 1, totalJSHeapSize: 1, usedJSHeapSize: 1 } },
      { id: 'network-information', mode: 'custom', value: { downlink: 1, effectiveType: '4g', rtt: 100, saveData: false } }, { id: 'notifications', mode: 'custom', value: 'denied' }]);
    result.rows = guard.snapshot().entries.map(entry => [entry.id, entry.installed, entry.unavailable]);
    const status = await navigator.permissions.query({ name: 'notifications' });
    result.notifications = [Notification.permission, status.name, status.state];
    let push; try { const value = await navigator.permissions.query({ name: 'push', userVisibleOnly: true }); push = [value.name, value.state]; } catch (error) { push = error.name; }
    result.push = push;
    guard.stop();
    result.restored = (await navigator.permissions.query({ name: 'notifications' })).state;
    return result;
  });
  assert.deepEqual([out.memory, out.connection], ['undefined', 'undefined']);
  assert.deepEqual(out.notifications, ['denied', 'notifications', 'denied']);
  assert.ok(out.push === 'TypeError' || out.push[1] === 'denied', 'a push status follows when Firefox supports the query: ' + JSON.stringify(out.push));
  assert.equal(out.rows.find(row => row[0] === 'performance-memory')[1], 0); assert.equal(out.rows.find(row => row[0] === 'network-information')[1], 0);
  report.firefox = out;
  ok('Firefox: memory/connection absent (nothing installed, rows unavailable), notifications/permissions agree (' + JSON.stringify(out.notifications) + ', push ' + JSON.stringify(out.push) + ')');
  await page.close();
}

// --only=codecs runs just the round 5 codec scenario (the other scenarios are unchanged and slower).
const only = process.argv.find(argument => argument.startsWith('--only='))?.slice('--only='.length);
try { if (only === 'codecs') await codecs(); else if (useFirefox) { await firefoxScenario(); await codecs(); } else { await memory(); await network(); await permissions(); await voices(); await media(); await storage(); await codecs(); } report.result = 'PASS'; }
catch (error) { report.result = 'FAIL'; console.error(error); process.exitCode = 1; }
finally { await browser.close(); console.log(JSON.stringify({ browser: report.browser, headed: report.headed, result: report.result, checks: report.checks.length, voices: report.voices && { list: report.voices.list, custom: report.voices.custom } }, null, 1)); }
