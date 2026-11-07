// ADR-053: exact launcher trust boundary and non-destructive, fail-closed OFF persistence.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { REDIRECTS, auditProtectSource } from '../build-protect.mjs';

const root = resolve(import.meta.dirname, '../../..');
const vendor = resolve(root, 'vendor/protect-722fae8');
const original = resolve(vendor, 'packages/background/src/protect/controller.ts');
const adapter = resolve(root, 'apps/production-protect/src/patches/protect-controller.ts');
const adapterName = relative(root, adapter).replaceAll('\\', '/');
const lf = source => source.replace(/\r\n/g, '\n');
const redirects = new Map(Object.entries(REDIRECTS).map(([from, to]) => [resolve(vendor, from), resolve(root, to)]));
const built = await build({
  stdin: { resolveDir: root, loader: 'ts', contents: `
    export * from './vendor/protect-722fae8/packages/background/test/protect/support.ts';
    export { ProtectController } from './apps/production-protect/src/patches/protect-controller.ts';
    export { isFirewallLauncherSender } from './apps/production-protect/src/firewall-launcher-sender.ts';
  ` },
  tsconfig: resolve(root, 'apps/production-protect/tsconfig.json'),
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'production-adapter-redirects', setup(builder) {
    builder.onResolve({ filter: /^\.{1,2}\// }, args => {
      const base = resolve(args.resolveDir, args.path);
      for (const candidate of [base, base + '.ts', base + '.tsx', join(base, 'index.ts')]) {
        const target = redirects.get(candidate);
        if (target !== undefined && args.importer !== target) return { path: target };
      }
      return undefined;
    });
  } }],
});
const M = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const GRANTED = { grantedOrigins: M.ALL_SITES, permissions: [M.DNR_PERMISSION] };
const enableRequest = changes => ({ schemaVersion: 1, type: 'ui-protect-enable', consentVersion: 1, features: ['value-match', 'firewall', 'session-replay'], preset: 'normal', ...changes });
const enable = (s, sender = M.popupSender(), changes) => s.controller.routeUi(enableRequest(changes), sender);
const disable = (s, sender = M.popupSender()) => s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-disable', purge: false }, sender);
const state = response => { assert.equal(response.type, 'protect-state', JSON.stringify(response)); return response.state; };
const stopped = s => {
  assert.equal(s.controller.enabled, false); assert.equal(s.controller.isActive, false);
  assert.equal(s.controller.getReport(7), null);
  assert.deepEqual([...s.fake.registered.keys()].filter(key => key.startsWith('detector-protect')), []);
  for (const event of Object.values(s.fake.webRequestEvents)) assert.equal(event.listeners.length, 0);
};
async function restart(s) {
  s.controller.stop();
  const controller = new M.ProtectController(s.fake, { clock: s.clock, dbFactory: () => s.db, services: [], dnrTimeoutMs: 50, docStore: { flushMs: 1 } });
  await controller.load();
  return controller;
}

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, 'reviewed vendor patch anchor must occur once');
  return source.replace(before, after);
}

test('controller adapter differs only by imports, reviewed launcher enable/resume and OFF/purge persistence blocks', () => {
  let expected = lf(readFileSync(original, 'utf8')).replace(/from '(\.{1,2}\/[^']+)'/g, (_, spec) => {
    let target = relative(dirname(adapter), resolve(dirname(original), spec)).replaceAll('\\', '/');
    if (!target.startsWith('.')) target = './' + target;
    assert.ok(existsSync(resolve(dirname(original), spec) + '.ts') || existsSync(resolve(dirname(original), spec) + '/index.ts'));
    return "from '" + target + "'";
  });
  expected = '// ADR-053 production adapter: exact launcher enable sender and fail-closed OFF persistence. Vendor stays byte-exact.\n' + expected;
  expected = replaceOnce(expected, '// Enable (Options only):', '// Enable (exact owned launcher UI):');
  expected = replaceOnce(expected,
    "import { isOptionsSender } from '../../../../vendor/protect-722fae8/packages/background/src/sender';",
    "import { isOptionsSender } from '../../../../vendor/protect-722fae8/packages/background/src/sender';\nimport { isFirewallLauncherSender } from '../firewall-launcher-sender';");
  expected = replaceOnce(expected, "case 'ui-protect-enable':\n        if (!isOptionsSender(sender, runtimeId))", "case 'ui-protect-enable':\n        if (!isFirewallLauncherSender(sender, runtimeId))");
  expected = replaceOnce(expected, 'return this.enable(request.consentVersion, request.features, request.preset);', 'return this.enable(request.consentVersion, request.features, request.preset, !isOptionsSender(sender, runtimeId));');
  expected = replaceOnce(expected, '  private enable(consentVersion: number, features: readonly ProtectFeature[], preset: ProtectPreset): Promise<UiResponse> {', '  private enable(consentVersion: number, features: readonly ProtectFeature[], preset: ProtectPreset, launcher = false): Promise<UiResponse> {');
  expected = replaceOnce(expected, '      const list = canonicalFeatures(features);', '      // A consented launcher resumes the current choices atomically; a stale UI cannot overwrite Options edits.\n      const resume = launcher && !this.consentRequired() && this.settings.features.length > 0;\n      const list = canonicalFeatures(resume ? this.settings.features : features);\n      const selectedPreset = resume ? this.settings.preset : preset;');
  expected = replaceOnce(expected, 'this.settings = { ...this.settings, v: 1, enabled: true, consentVersion, features: list, preset, snoozeUntil: null };', 'this.settings = { ...this.settings, v: 1, enabled: true, consentVersion, features: list, preset: selectedPreset, snoozeUntil: null };');
  expected = replaceOnce(expected, '      await this.disableNow(purge);\n      return this.stateResponse();', "      const saved = await this.disableNow(purge);\n      return saved ? this.stateResponse() : protectError('storage-unavailable');");
  expected = replaceOnce(expected, '  private async disableNow(purge: boolean): Promise<void> {', '  private async disableNow(purge: boolean): Promise<boolean> {');
  expected = replaceOnce(expected, '      await this.purgeEverything();\n      return;\n    }\n    if (!this.settingsPresent) return;\n    await this.persistSettings();',
    "      await this.purgeEverything();\n      return true;\n    }\n    if (!this.settingsPresent) return true;\n    // One bounded retry preserves the same consent and choices. Failed persistence never reactivates this SW.\n    const saved = await this.persistSettings() || await this.persistSettings();\n    if (!saved) this.degraded.add('storage-unavailable');");
  expected = replaceOnce(expected, '    this.dbInstance?.close();\n    this.degraded.delete(ACTIVATION_FAILED_REASON);\n  }', '    this.dbInstance?.close();\n    this.degraded.delete(ACTIVATION_FAILED_REASON);\n    return saved;\n  }');
  expected = replaceOnce(expected, '    if (purge) {\n      await this.purgeEverything();\n      return true;\n    }\n    if (!this.settingsPresent) return true;', '    if (!this.settingsPresent && !purge) return true;');
  expected = replaceOnce(expected,
    "    const saved = await this.persistSettings() || await this.persistSettings();\n    if (!saved) this.degraded.add('storage-unavailable');",
    "    // REQ-012 / PP-03: persist OFF before purge so a failed removal cannot retain a durable ON record.\n    const saved = !this.settingsPresent || await this.persistSettings() || await this.persistSettings();\n    if (!saved) this.degraded.add('storage-unavailable');\n    if (purge) return this.purgeEverything();");
  expected = replaceOnce(expected, '  private async clearSessionState(): Promise<void> {', '  private async clearSessionState(): Promise<boolean> {\n    let cleared = true;');
  expected = replaceOnce(expected, '      // storage.session is cleared by the browser at the end of the session anyway.\n    }\n    this.tabModel.clear();', '      // storage.session is cleared by the browser at the end of the session anyway.\n      cleared = false;\n    }\n    this.tabModel.clear();\n    return cleared;');
  expected = replaceOnce(expected, '  private async purgeEverything(): Promise<void> {', '  private async purgeEverything(): Promise<boolean> {\n    let cleared = true;');
  expected = replaceOnce(expected,
    "      await this.db().destroy();\n    } catch {\n      this.degraded.add('storage-unavailable');\n    }\n    await this.clearSessionState();",
    "      await this.db().destroy();\n    } catch {\n      cleared = false;\n    }\n    if (!(await this.clearSessionState())) cleared = false;\n    if (!cleared) {\n      this.degraded.add('storage-unavailable');\n      this.dbInstance?.close();\n      return false;\n    }");
  expected = replaceOnce(expected, '      // A stale settings record is fail-safe: it says enabled:false.', "      this.degraded.add('storage-unavailable');\n      return false;");
  expected = replaceOnce(expected, '    this.counts = { decisions: 0, history: 0 };\n    this.degraded.clear();', '    this.counts = { decisions: 0, history: 0 };\n    this.degraded.clear();\n    return true;');
  assert.equal(lf(readFileSync(adapter, 'utf8')), expected);
  assert.equal(REDIRECTS['packages/background/src/protect/controller.ts'], adapterName);
  assert.deepEqual(auditProtectSource(expected, adapterName), []);
});

test('enable sender accepts only exact own popup, sidepanel and Options documents with verified extension identity', () => {
  for (const path of ['popup.html', 'sidepanel.html', 'options.html', 'popup.html?source=launcher#state', 'options.html#protect']) {
    assert.equal(M.isFirewallLauncherSender(M.optionsSender(path), M.popupSender().id), true, path);
  }
  const sender = M.popupSender(), runtimeId = sender.id;
  for (const changed of [
    { id: 'another-extension' }, { id: undefined }, { origin: 'https://example.test' }, { url: undefined },
    { url: 'chrome-extension://' + runtimeId + '/findings.html' }, { url: 'chrome-extension://' + runtimeId + '/firewall.html' },
    { url: 'chrome-extension://' + runtimeId + '/popup.html.evil' }, { url: 'chrome-extension://' + runtimeId + '/nested/popup.html' },
    { url: 'chrome-extension://' + runtimeId + '/%70opup.html' }, { url: 'chrome-extension://' + runtimeId + '/options.html/child' },
    { url: 'chrome-extension://foreign-extension/popup.html' }, { url: 'https://' + runtimeId + '/popup.html' },
    { url: 'chrome-extension://user@' + runtimeId + '/popup.html' }, { tab: { id: 7 }, url: 'https://example.test/popup.html' },
  ]) assert.equal(M.isFirewallLauncherSender({ ...sender, ...changed }, runtimeId), false, JSON.stringify(changed));
});

test('all three launcher pages enable through the same backend activation sequence and saved configuration', async () => {
  for (const page of ['popup.html', 'sidepanel.html', 'options.html']) {
    const s = await M.setupController({ chrome: GRANTED });
    try {
      assert.equal(state(await enable(s, M.optionsSender(page))).state, 'active', page);
      assert.deepEqual(s.fake.local.data.get('protect'), M.ENABLED_SETTINGS);
      assert.equal(s.controller.isActive, true);
      const order = ['local.set:protect', 'db.create', 'scripting.register', 'webRequest.add:sendHeaders', 'service.start:value-match'].map(prefix => s.log.findIndex(line => line.startsWith(prefix)));
      assert.ok(order.every(index => index >= 0)); assert.deepEqual([...order].sort((a, b) => a - b), order);
      await disable(s);
    } finally { s.controller.stop(); }
  }
});

test('non-launcher UI and page spoofing cannot enable or write settings', async () => {
  const s = await M.setupController({ chrome: GRANTED });
  try {
    for (const sender of [M.optionsSender('findings.html'), M.optionsSender('firewall.html'), { ...M.popupSender(), origin: 'https://example.test', tab: { id: 7 } }, { ...M.popupSender(), id: 'other' }]) {
      assert.equal((await enable(s, sender)).code, 'unauthorized-sender');
    }
    assert.equal(s.fake.local.setCalls.length, 0); assert.equal(s.dbCreated(), 0); stopped(s);
  } finally { s.controller.stop(); }
});

test('consent, broad-host, DNR and fail-closed managed policy checks remain before activation', async () => {
  const s = await M.setupController({ chrome: { grantedOrigins: [] } });
  try {
    assert.equal((await enable(s, M.popupSender(), { consentVersion: 2 })).code, 'consent-required');
    assert.equal((await enable(s)).code, 'permission-required');
    s.fake.grant(M.ALL_SITES);
    assert.equal((await enable(s)).code, 'permission-required');
    s.fake.grantPermission(M.DNR_PERMISSION);
    for (const value of [true, 'invalid-policy']) {
      s.fake.managed.data.set('ProtectModuleDisabled', value);
      assert.equal((await enable(s)).code, 'disabled-by-organization');
    }
    assert.equal(s.fake.local.setCalls.length, 0); assert.equal(s.dbCreated(), 0); stopped(s);
  } finally { s.controller.stop(); }
});

test('set-settings and removing an exclusion remain Options-only after the enable exception', async () => {
  const s = await M.setupController({ chrome: GRANTED });
  try {
    await enable(s);
    for (const page of ['popup.html', 'sidepanel.html', 'findings.html']) {
      assert.equal((await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-settings', preset: 'strict' }, M.optionsSender(page))).code, 'unauthorized-sender');
      assert.equal((await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: 'example.com', excluded: false }, M.optionsSender(page))).code, 'unauthorized-sender');
    }
    assert.equal(state(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-settings', preset: 'warn-only' }, M.optionsSender())).preset, 'warn-only');
    await disable(s);
  } finally { s.controller.stop(); }
});

test('consented launcher resumes current serialized Options choices instead of stale or widened request values', async () => {
  const s = await M.setupController({ chrome: GRANTED });
  try {
    await enable(s);
    const edit = s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-settings', features: ['value-match'], preset: 'warn-only' }, M.optionsSender());
    const resumed = enable(s, M.popupSender(), { features: ['value-match', 'firewall', 'session-replay', 'history', 'gpc'], preset: 'strict' });
    const [, answer] = await Promise.all([edit, resumed]);
    assert.deepEqual(state(answer).features, ['value-match']); assert.equal(state(answer).preset, 'warn-only');
    await disable(s);
    const fromSidepanel = state(await enable(s, M.optionsSender('sidepanel.html'), { features: ['gpc'], preset: 'strict' }));
    assert.deepEqual(fromSidepanel.features, ['value-match']); assert.equal(fromSidepanel.preset, 'warn-only');
    await disable(s);
    const fromOptions = state(await enable(s, M.optionsSender(), { features: ['session-replay'], preset: 'normal' }));
    assert.deepEqual(fromOptions.features, ['session-replay']); assert.equal(fromOptions.preset, 'normal');
    await disable(s);
  } finally { s.controller.stop(); }
});

test('renewed consent from launcher accepts explicit activation choices instead of obsolete stored choices', async () => {
  const s = await M.setupController({ chrome: GRANTED, settings: { ...M.ENABLED_SETTINGS, enabled: false, consentVersion: 0 } });
  try {
    const answer = state(await enable(s, M.popupSender(), { features: ['session-replay'], preset: 'warn-only' }));
    assert.deepEqual(answer.features, ['session-replay']); assert.equal(answer.preset, 'warn-only');
    assert.equal(answer.consentVersion, answer.requiredConsentVersion);
    await disable(s);
  } finally { s.controller.stop(); }
});

test('an empty disabled record accepts the direct-click canonical defaults from every owned launcher page', async () => {
  for (const page of ['popup.html', 'sidepanel.html', 'options.html']) {
    const s = await M.setupController({ chrome: GRANTED, settings: { ...M.ENABLED_SETTINGS, enabled: false, features: [], preset: 'strict' } });
    try {
      assert.equal(s.controller.getState().consentVersion, 1); assert.deepEqual(s.controller.getState().features, []); stopped(s);
      const answer = state(await enable(s, M.optionsSender(page)));
      assert.deepEqual(answer.features, ['value-match', 'firewall', 'session-replay']); assert.equal(answer.preset, 'normal');
      assert.equal(answer.state, 'active'); assert.deepEqual(s.fake.local.data.get('protect'), M.ENABLED_SETTINGS);
      await disable(s);
    } finally { s.controller.stop(); }
  }
});

test('failed ON persistence rolls back and never starts registrations, listeners or services', async () => {
  const s = await M.setupController({ chrome: GRANTED });
  try {
    s.fake.local.failNextSets = 1;
    assert.equal((await enable(s)).code, 'storage-unavailable');
    stopped(s); assert.equal(s.dbCreated(), 0); assert.equal(s.fake.local.data.has('protect'), false);
    assert.equal(s.log.filter(line => line === 'local.set:protect').length, 1);
  } finally { s.controller.stop(); }
});

test('toggle OFF preserves consent, features, preset and persistent data; restart stays OFF', async () => {
  const s = await M.setupController({ chrome: GRANTED });
  try {
    await enable(s); const before = structuredClone(s.fake.local.data.get('protect'));
    assert.equal(state(await disable(s)).state, 'off'); stopped(s);
    assert.deepEqual(s.fake.local.data.get('protect'), { ...before, enabled: false });
    assert.equal(s.fake.local.removeCalls.length, 0); assert.equal(s.db.destroyed, 0);
    const after = await restart(s); assert.equal(after.enabled, false); assert.equal(after.isActive, false); after.stop();
  } finally { s.controller.stop(); }
});

test('one failed OFF write retries the same record once and acknowledges only durable OFF', async () => {
  const s = await M.setupController({ chrome: GRANTED });
  try {
    await enable(s); const before = structuredClone(s.fake.local.data.get('protect')); s.log.length = 0;
    const attempts = [], save = s.fake.local.set.bind(s.fake.local);
    s.fake.local.set = async items => { attempts.push(structuredClone(items)); return save(items); };
    s.fake.local.failNextSets = 1;
    assert.equal(state(await disable(s)).state, 'off'); stopped(s);
    assert.equal(s.log.filter(line => line === 'local.set:protect').length, 2);
    assert.deepEqual(attempts, [{ protect: { ...before, enabled: false } }, { protect: { ...before, enabled: false } }]);
    assert.deepEqual(s.fake.local.data.get('protect'), { ...before, enabled: false });
    assert.equal(s.fake.local.removeCalls.length, 0); assert.equal(s.db.destroyed, 0);
    const after = await restart(s); assert.equal(after.enabled, false); assert.equal(after.isActive, false); after.stop();
  } finally { s.controller.stop(); }
});

test('two failed OFF writes report storage error while runtime stays stopped; no hidden purge or automatic resume', async () => {
  const s = await M.setupController({ chrome: GRANTED });
  try {
    await enable(s); const before = structuredClone(s.fake.local.data.get('protect')); s.log.length = 0;
    s.fake.dnr.dynamic.set(100003, { id: 100003, priority: 10, action: { type: 'block' }, condition: { requestDomains: ['receiver.example'] } });
    s.fake.dnr.session.set(200001, { id: 200001, priority: 10, action: { type: 'block' }, condition: { requestDomains: ['receiver.example'], tabIds: [7] } });
    s.fake.dnr.dynamic.set(50000, { id: 50000, priority: 1, action: { type: 'block' }, condition: {} });
    s.fake.local.failNextSets = 2;
    assert.equal((await disable(s)).code, 'storage-unavailable'); stopped(s);
    assert.ok(s.controller.getState().degradedReasons.includes('storage-unavailable'));
    assert.equal(s.log.filter(line => line === 'local.set:protect').length, 2);
    assert.deepEqual(s.fake.local.data.get('protect'), before, 'outage cannot make an unchanged stored ON record durably OFF');
    assert.equal(s.fake.local.removeCalls.length, 0); assert.equal(s.db.destroyed, 0);
    assert.deepEqual([...s.fake.dnr.dynamic.keys()], [50000]); assert.equal(s.fake.dnr.session.size, 0);
    assert.ok(s.log.findIndex(line => line === 'dnr.updateDynamic') < s.log.findIndex(line => line === 'local.set:protect'));
    await s.controller.onPermissionsAdded({ origins: M.ALL_SITES }); await s.controller.onManagedChanged(); stopped(s);
    assert.equal(state(await disable(s)).state, 'off');
    assert.deepEqual(s.fake.local.data.get('protect'), { ...before, enabled: false });
    const after = await restart(s); assert.equal(after.enabled, false); assert.equal(after.isActive, false); after.stop();
  } finally { s.controller.stop(); }
});

test('queued enable followed by OFF is serialized and leaves no active module', async () => {
  const s = await M.setupController({ chrome: GRANTED });
  try {
    const [on, off] = await Promise.all([enable(s), disable(s)]);
    assert.equal(state(on).state, 'active'); assert.equal(state(off).state, 'off'); stopped(s);
    assert.equal(s.fake.local.data.get('protect').enabled, false);
  } finally { s.controller.stop(); }
});

test('PP-03: failed settings removal during purge reports failure and preserves durable OFF across restart', async () => {
  const s = await M.setupController({ chrome: GRANTED });
  try {
    await enable(s); const before = structuredClone(s.fake.local.data.get('protect'));
    const remove = s.fake.local.remove.bind(s.fake.local);
    s.fake.local.remove = async keys => { if ((Array.isArray(keys) ? keys : [keys]).includes('protect')) throw Error('owned removal failure'); return remove(keys); };
    assert.equal((await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-disable', purge: true }, M.popupSender())).code, 'storage-unavailable');
    stopped(s); assert.ok(s.controller.getState().degradedReasons.includes('storage-unavailable'));
    assert.deepEqual(s.fake.local.data.get('protect'), { ...before, enabled: false });
    const after = await restart(s); assert.equal(after.enabled, false); assert.equal(after.isActive, false); after.stop();
    s.fake.local.remove = remove;
  } finally { s.controller.stop(); }
});

test('PP-03: IDB or session purge failure retains consent and choices in durable OFF and can be retried', async () => {
  for (const failure of ['idb', 'session']) {
    const s = await M.setupController({ chrome: GRANTED });
    try {
      await enable(s); const before = structuredClone(s.fake.local.data.get('protect'));
      const restore = failure === 'idb' ? s.db.destroy.bind(s.db) : s.fake.session.remove.bind(s.fake.session);
      if (failure === 'idb') s.db.destroy = async () => { throw Error('owned IDB failure'); };
      else s.fake.session.remove = async () => { throw Error('owned session failure'); };
      const request = { schemaVersion: 1, type: 'ui-protect-disable', purge: true };
      assert.equal((await s.controller.routeUi(request, M.popupSender())).code, 'storage-unavailable', failure);
      stopped(s); assert.deepEqual(s.fake.local.data.get('protect'), { ...before, enabled: false }, failure);
      assert.equal(s.fake.local.removeCalls.length, 0, failure);
      if (failure === 'idb') s.db.destroy = restore; else s.fake.session.remove = restore;
      assert.equal(state(await s.controller.routeUi(request, M.popupSender())).state, 'off', failure);
      assert.equal(s.fake.local.data.has('protect'), false, failure);
      assert.deepEqual(s.controller.getState().features, [], failure);
      const after = await restart(s); assert.equal(after.enabled, false); assert.equal(after.isActive, false); after.stop();
    } finally { s.controller.stop(); }
  }
});

test('PP-03: purge retries an OFF write once before removal, and removal can recover an unavailable OFF write', async () => {
  for (const failedWrites of [1, 2]) {
    const s = await M.setupController({ chrome: GRANTED });
    try {
      await enable(s); s.log.length = 0; s.fake.local.failNextSets = failedWrites;
      assert.equal(state(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-disable', purge: true }, M.popupSender())).state, 'off');
      stopped(s); assert.equal(s.fake.local.data.has('protect'), false);
      assert.equal(s.log.filter(line => line === 'local.set:protect').length, 2);
      assert.ok(s.log.findIndex(line => line === 'local.set:protect') < s.log.findIndex(line => line === 'local.remove:protect'));
      const after = await restart(s); assert.equal(after.enabled, false); assert.equal(after.isActive, false); after.stop();
    } finally { s.controller.stop(); }
  }
});

test('PP-03: a complete local storage outage is reported instead of falsely acknowledging durable OFF', async () => {
  const s = await M.setupController({ chrome: GRANTED });
  try {
    await enable(s); const before = structuredClone(s.fake.local.data.get('protect'));
    const remove = s.fake.local.remove.bind(s.fake.local);
    s.fake.local.failNextSets = 2; s.fake.local.remove = async () => { throw Error('owned local outage'); };
    assert.equal((await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-disable', purge: true }, M.popupSender())).code, 'storage-unavailable');
    stopped(s); assert.deepEqual(s.fake.local.data.get('protect'), before);
    assert.ok(s.controller.getState().degradedReasons.includes('storage-unavailable'));
    s.fake.local.remove = remove;
    assert.equal(state(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-disable', purge: true }, M.popupSender())).state, 'off');
    assert.equal(s.fake.local.data.has('protect'), false);
    const after = await restart(s); assert.equal(after.enabled, false); assert.equal(after.isActive, false); after.stop();
  } finally { s.controller.stop(); }
});
