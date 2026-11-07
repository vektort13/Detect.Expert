import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createApiConfiguration, updateApiConfiguration } from '../../packages/contracts/src/api-configuration.mjs';
import { API_CUSTOM_SCRIPT_PREFIX, apiCustomSiteScriptId, buildApiCustomScripts } from '../../apps/production-extension/api-custom-registration.js';

const tagged = value => ({ kind: 'value', value });
function change(config, id, patch, host = null) {
  const result = updateApiConfiguration(config, id, patch, host);
  assert.equal(result.ok, true, result.error?.message); return result.value;
}
function base() { return { ...createApiConfiguration(), enabled: true, antidetectEnabled: true }; }
function custom(config, id = 'hardware-concurrency', value = 16, host = null) { return change(config, id, { mode: 'custom', selected: tagged(value) }, host); }
function fixture() {
  const realm = vm.createContext({});
  vm.runInContext(`
    globalThis.Navigator = function Navigator() {};
    globalThis.navigator = new Navigator();
    globalThis.document = { querySelectorAll() { return []; } };
    globalThis.calls = 0;
    for (const [key, value] of [['hardwareConcurrency', 32], ['platform', 'Native platform'], ['userAgent', 'Native user agent'], ['vendor', 'Native vendor'], ['oscpu', 'Native OS']]) {
      Object.defineProperty(Navigator.prototype, key, { configurable: true, enumerable: true, get() { if (this !== navigator) throw new TypeError('Illegal invocation'); calls++; return value; } });
    }
    globalThis.GPU = function GPU() {};
    GPU.prototype.requestAdapter = function() { return Promise.resolve({ native: true }); };
    globalThis.gpu = new GPU();
  `, realm);
  return realm;
}

test('ADR-049: disabled/no-scope/no-Custom profiles register nothing and preserve old presets', () => {
  const config = createApiConfiguration();
  assert.deepEqual(buildApiCustomScripts(config, ['https://*/*']), []);
  config.enabled = true; config.antidetectEnabled = true;
  assert.deepEqual(buildApiCustomScripts(config, ['https://*/*']), []);
  const configured = custom(config);
  assert.deepEqual(buildApiCustomScripts(configured, []), []);
  assert.deepEqual(buildApiCustomScripts(configured, ['ws://*/*', 'file:///*', 'invalid']), []);
  assert.deepEqual(buildApiCustomScripts(change(config, 'hardware-concurrency', { mode: 'on' }), ['https://*/*']), []);
});

test('one early immutable MAIN source embeds selected data and no user libraries or restore channel', () => {
  let config = custom(base());
  config = change(config, 'hardware-concurrency', { userValues: [{ id: 'custom-1', label: 'Library label excluded from MAIN', value: tagged(16) }, { id: 'custom-2', label: 'Unused library entry', value: tagged(64) }] });
  const [script] = buildApiCustomScripts(config, ['https://*/*', 'http://*/*']);
  assert.equal(script.id, API_CUSTOM_SCRIPT_PREFIX + 'global');
  assert.deepEqual(script.matches, ['http://*/*', 'https://*/*']);
  assert.deepEqual(script.excludeMatches, []);
  assert.equal(script.world, 'MAIN'); assert.equal(script.runAt, 'document_start'); assert.equal(script.allFrames, true);
  assert.deepEqual(Object.keys(script.js[0]), ['code']);
  assert.equal(Object.hasOwn(script, 'matchOriginAsFallback'), false);
  assert.equal(Object.hasOwn(script, 'persistAcrossSessions'), false);
  assert.ok(!script.js[0].code.includes('Library label excluded from MAIN'));
  assert.ok(!script.js[0].code.includes('Unused library entry'));
  const realm = fixture(); vm.runInContext(script.js[0].code, realm);
  assert.equal(vm.runInContext('navigator.hardwareConcurrency', realm), 16);
  assert.equal(vm.runInContext('calls', realm), 1);
  assert.equal(vm.runInContext(`globalThis[Symbol.for('detect.expert/api-custom/document/v2')]`, realm), true);
  assert.equal(vm.runInContext(`typeof globalThis[Symbol.for('detect.expert/api-custom/document/v2')].stop`, realm), 'undefined');
  assert.equal(vm.runInContext(`Object.hasOwn(globalThis,Symbol.for('detect.expert/api-custom/installation/v1'))`, realm), false);
});

test('exact-host overrides exclude only the configured hosts and receive complete inherited profiles', () => {
  let config = custom(base());
  config = custom(config, 'navigator-platform', 'Linux x86_64');
  config = custom(config, 'hardware-concurrency', 8, 'a.example.com');
  config = change(config, 'hardware-concurrency', { mode: 'off' }, 'b.example.com');
  config = change(config, 'navigator-platform', { mode: 'off' }, 'b.example.com');
  const scripts = buildApiCustomScripts(config, ['http://*/*', 'https://*/*']);
  assert.equal(scripts.length, 2);
  assert.deepEqual(scripts[0].excludeMatches, ['http://a.example.com/*', 'http://b.example.com/*', 'https://a.example.com/*', 'https://b.example.com/*']);
  const site = scripts.find(script => script.id === apiCustomSiteScriptId('a.example.com'));
  assert.deepEqual(site.matches, ['http://a.example.com/*', 'https://a.example.com/*']);
  assert.ok(!site.matches.some(pattern => pattern.includes('*.')));
  const realm = fixture(); vm.runInContext(site.js[0].code, realm);
  assert.equal(vm.runInContext('navigator.hardwareConcurrency', realm), 8);
  assert.equal(vm.runInContext('navigator.platform', realm), 'Linux x86_64');
  assert.equal(scripts.some(script => script.id === apiCustomSiteScriptId('b.example.com')), false);
});

test('disabled site does not run Custom even with active global rules; BYPASS inherits selected value', () => {
  let config = custom(base());
  config = change(config, 'hardware-concurrency', { mode: 'bypass' }, 'inherit.example');
  config = change(config, 'hardware-concurrency', { mode: 'bypass' }, 'disabled.example');
  config.sites.find(site => site.host === 'disabled.example').disabled = true;
  const scripts = buildApiCustomScripts(config, ['https://*/*']);
  assert.equal(scripts.length, 2);
  assert.equal(scripts.some(script => script.id === apiCustomSiteScriptId('disabled.example')), false);
  assert.ok(scripts[0].excludeMatches.includes('https://disabled.example/*'));
  const realm = fixture(); vm.runInContext(scripts.find(script => script.id === apiCustomSiteScriptId('inherit.example')).js[0].code, realm);
  assert.equal(vm.runInContext('navigator.hardwareConcurrency', realm), 16);
});

test('site matching never widens a granted scheme, hostname, or path', () => {
  let config = custom(base(), 'hardware-concurrency', 16, 'example.com');
  config = custom(config, 'hardware-concurrency', 8, 'child.example.com');
  config = custom(config, 'hardware-concurrency', 4, 'unrelated.test');
  const https = buildApiCustomScripts(config, ['https://example.com/*']);
  assert.equal(https.length, 1); assert.deepEqual(https[0].matches, ['https://example.com/*']);
  const scoped = buildApiCustomScripts(config, ['https://*.example.com/restricted/*']);
  assert.equal(scoped.length, 2);
  assert.deepEqual(scoped.map(script => script.matches[0]).sort(), ['https://child.example.com/restricted/*', 'https://example.com/restricted/*']);
  const wildcardSchemes = buildApiCustomScripts(config, ['*://example.com/*']);
  assert.deepEqual(wildcardSchemes[0].matches, ['http://example.com/*', 'https://example.com/*']);
});

test('profiles and source remain deterministic under reordered API libraries, sites and scope entries', () => {
  let config = custom(base());
  config = custom(config, 'hardware-concurrency', 8, 'z.example');
  config = custom(config, 'hardware-concurrency', 4, 'a.example');
  const left = buildApiCustomScripts(config, ['https://*/*', 'http://*/*']);
  const right = structuredClone(config); right.apis.reverse(); right.sites.reverse(); for (const site of right.sites) site.apis.reverse();
  assert.deepEqual(buildApiCustomScripts(right, ['http://*/*', 'https://*/*', 'http://*/*']), left);
  assert.notEqual(apiCustomSiteScriptId('a.example'), apiCustomSiteScriptId('z.example'));
});

test('compiled data cannot inject code, markup, script terminators or Unicode line separators', () => {
  const hostile = `"});globalThis.pwned=true;// </script><script>globalThis.pwned=true</script> & \u2028 \u2029`;
  const [script] = buildApiCustomScripts(custom(base(), 'navigator-user-agent', hostile), ['https://*/*']);
  assert.ok(!script.js[0].code.includes('</script>'));
  const realm = fixture(); vm.runInContext(script.js[0].code, realm);
  assert.equal(vm.runInContext('navigator.userAgent', realm), hostile);
  assert.equal(vm.runInContext('globalThis.pwned', realm), undefined);
});

test('compiled selected states preserve explicit null, undefined and empty strings', async () => {
  let config = change(base(), 'webgpu', { mode: 'custom', selected: { kind: 'null' } });
  config = change(config, 'navigator-oscpu', { mode: 'custom', selected: { kind: 'undefined' } });
  config = custom(config, 'navigator-vendor', '');
  const [script] = buildApiCustomScripts(config, ['https://*/*']);
  const realm = fixture(); vm.runInContext(script.js[0].code, realm);
  assert.equal(vm.runInContext('navigator.oscpu', realm), undefined);
  assert.equal(vm.runInContext('navigator.vendor', realm), '');
  assert.equal(await vm.runInContext('gpu.requestAdapter()', realm), null);
});

test('added property ON uses the new installer without duplicating old denial registrations', () => {
  let config = change(base(), 'navigator-platform', { mode: 'on' });
  config = change(config, 'hardware-concurrency', { mode: 'on' });
  const [script] = buildApiCustomScripts(config, ['https://*/*']);
  const realm = fixture(); vm.runInContext(script.js[0].code, realm);
  assert.equal(vm.runInContext('navigator.platform', realm), undefined);
  assert.equal(vm.runInContext('navigator.hardwareConcurrency', realm), 32);
});

test('invalid configuration is rejected before any executable source is returned', () => {
  const config = custom(base()); config.apis.pop();
  assert.throws(() => buildApiCustomScripts(config, ['https://*/*']), /Missing API/);
  assert.throws(() => buildApiCustomScripts(custom(base()), 'https://*/*'), /Invalid API configuration scope/);
  assert.throws(() => apiCustomSiteScriptId('example.com/path'), /Invalid exact/);
  assert.throws(() => apiCustomSiteScriptId('Example.com'), /Invalid exact/);
  assert.throws(() => apiCustomSiteScriptId('*.example.com'), /Invalid exact/);
  assert.throws(() => apiCustomSiteScriptId('*'), /Invalid exact/);
});

test('expanded registered source composes genuine Intl formatting with legacy timezone and retains its fallback zone', () => {
  for (const selected of [{ locale: 'de-DE', timeZone: 'Pacific/Honolulu' }, { locale: 'de-DE' }]) {
    let config = custom(base(), 'timezone', { timeZone: 'UTC', offsetMinutes: 0 });
    config = custom(config, 'intl-formatting', selected);
    const [script] = buildApiCustomScripts(config, ['https://*/*']);
    const realm = fixture(); vm.runInContext(script.js[0].code, realm);
    const zone = selected.timeZone ?? 'UTC';
    assert.equal(vm.runInContext('new Intl.DateTimeFormat().resolvedOptions().timeZone', realm), zone);
    assert.equal(vm.runInContext('new Intl.NumberFormat().resolvedOptions().locale', realm), 'de-DE');
    assert.equal(vm.runInContext('new Intl.NumberFormat(undefined).resolvedOptions().locale', realm), 'de-DE');
    assert.equal(vm.runInContext('new Intl.NumberFormat("en-US").resolvedOptions().locale', realm), 'en-US', 'an explicit page locale wins over the selection');
    assert.equal(vm.runInContext('new Date(0).getTimezoneOffset()', realm), 0);
    assert.equal(vm.runInContext('new Intl.DateTimeFormat("en-US",{year:"numeric",month:"2-digit",day:"2-digit"}).format(0)', realm),
      new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(0));
  }
});

test('expanded registered installer includes only selected groups and leaves absent native interfaces absent', () => {
  const config = custom(base(), 'navigator-metadata', { webdriver: false });
  const [script] = buildApiCustomScripts(config, ['https://*/*']);
  assert.ok(script.js[0].code.includes('installApiCustomEnvironment'));
  assert.equal(script.js[0].code.includes('function installIntlCustom'), false);
  assert.equal(script.js[0].code.includes('function installSurfaceCustom'), false);
  const realm = fixture(); vm.runInContext(script.js[0].code, realm);
  assert.equal(vm.runInContext('Object.hasOwn(Navigator.prototype,"webdriver")', realm), false);
});

test('registered legacy timezone alone aligns Temporal and Intl default zones while explicit page zones stay native', () => {
  const config = custom(base(), 'timezone', { timeZone: 'Asia/Tokyo', offsetMinutes: -540 });
  const [script] = buildApiCustomScripts(config, ['https://*/*']);
  const realm = fixture();
  vm.runInContext(`globalThis.nativeFormat=new Intl.DateTimeFormat('en-US',{timeZone:'UTC'}).format(0);
    globalThis.Temporal={Now:{timeZoneId(){return 'UTC';},plainDateISO(zone){return zone===undefined?'UTC':zone;}}};`, realm);
  vm.runInContext(script.js[0].code, realm);
  assert.equal(vm.runInContext('Temporal.Now.timeZoneId()', realm), 'Asia/Tokyo');
  assert.equal(vm.runInContext('Temporal.Now.plainDateISO()', realm), 'Asia/Tokyo');
  assert.equal(vm.runInContext('Temporal.Now.plainDateISO(undefined)', realm), 'Asia/Tokyo');
  assert.equal(vm.runInContext('Temporal.Now.plainDateISO("UTC")', realm), 'UTC');
  assert.equal(vm.runInContext('new Intl.DateTimeFormat().resolvedOptions().timeZone', realm), 'Asia/Tokyo', 'the Intl default zone follows the selected zone');
  assert.equal(vm.runInContext('new Intl.DateTimeFormat("en-US",{timeZone:"UTC"}).format(0)===nativeFormat', realm), true, 'an explicit page zone is never overwritten');
  assert.equal(vm.runInContext('new Intl.DateTimeFormat("en-US",{timeZone:"UTC"}).resolvedOptions().timeZone', realm), 'UTC');
});

test('registered locale-only profile preserves native Temporal defaults when no timezone is selected', () => {
  const config = custom(base(), 'intl-formatting', { locale: 'de-DE' });
  const [script] = buildApiCustomScripts(config, ['https://*/*']);
  const realm = fixture();
  vm.runInContext(`globalThis.nativeZone=()=> 'UTC';globalThis.Temporal={Now:{timeZoneId:nativeZone}};`, realm);
  vm.runInContext(script.js[0].code, realm);
  assert.equal(vm.runInContext('Temporal.Now.timeZoneId===nativeZone', realm), true);
  assert.equal(vm.runInContext('new Intl.NumberFormat().resolvedOptions().locale', realm), 'de-DE');
});

test('registered legacy timezone validates canonical Temporal zone through the original Intl resolver', () => {
  const value = 'asia/tokyo', expected = new Intl.DateTimeFormat('en', {timeZone:value}).resolvedOptions().timeZone;
  const config = custom(base(), 'timezone', {timeZone:value,offsetMinutes:-540});
  const [script] = buildApiCustomScripts(config, ['https://*/*']);
  const realm = fixture();
  vm.runInContext(`globalThis.Temporal={Now:{timeZoneId(){return 'UTC';},plainDateISO(zone){return zone??'UTC';}}};`, realm);
  vm.runInContext(script.js[0].code, realm);
  assert.equal(vm.runInContext('Temporal.Now.timeZoneId()', realm), expected);
  assert.equal(vm.runInContext('Temporal.Now.plainDateISO()', realm), expected);
  assert.equal(vm.runInContext('new Intl.DateTimeFormat().resolvedOptions().timeZone', realm), expected, 'the genuine formatter reports the canonical selected zone');
});
