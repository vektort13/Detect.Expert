// ADR-041: exercise the shipped controller, including storage/grant failure paths.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { setObservationControl } from '../../apps/production-extension/observation-control.js';

const source = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
const start = source.indexOf('// packages/contracts/src/data-consent.ts');
const end = source.indexOf('// packages/background/src/visual-preview.ts', start);
assert.ok(start >= 0 && end > start);
const C = 'data-consent:v1', P = 'data-consent:pending-v1', F = 'scope:full-access-default-v1';
const accepted = { version: 1, accepted: true };
const scope = mode => ({ v: 1, scopeMode: mode, hosts: mode === 'site' ? ['example.com'] : [] });
const plain = value => structuredClone(value);

function fixture({ local = {}, session = {}, origins = ['<all_urls>'], failRead, failWrite, failOnce, beforeWrite } = {}) {
  const events = [], scripts = new Map();
  let failed = false;
  function transient(kind, operation) {
    if (!failed && failOnce === kind + ':' + operation) { failed = true; throw new Error('transient storage failure'); }
  }
  const area = (store, kind) => ({
    get: async keys => {
      transient(kind, 'get');
      if (failRead === kind) throw new Error('read unavailable');
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => Object.hasOwn(store, key)).map(key => [key, store[key]]));
    },
    set: async value => {
      transient(kind, 'set');
      if (kind === 'local') await beforeWrite?.(value);
      if (failWrite === kind) throw new Error('write unavailable');
      Object.assign(store, plain(value)); events.push({ kind, value: plain(value) });
    },
    remove: async key => { delete store[key]; },
  });
  const api = {
    storage: { local: area(local, 'local'), session: area(session, 'session') },
    runtime: { getManifest: () => ({ host_permissions: ['http://*/*', 'https://*/*'] }) },
    permissions: { getAll: async () => ({ origins }), contains: async () => origins.includes('<all_urls>') },
    scripting: {
      getRegisteredContentScripts: async () => [...scripts.values()],
      registerContentScripts: async entries => { for (const entry of entries) scripts.set(entry.id, plain(entry)); events.push({ kind: 'register' }); },
      updateContentScripts: async entries => { for (const entry of entries) scripts.set(entry.id, plain(entry)); },
      unregisterContentScripts: async ({ ids }) => { for (const id of ids) scripts.delete(id); },
    },
  };
  const realm = vm.createContext({ api, SCOPE_MODES: ['off', 'all-sites', 'site', 'active-tab'],
    BUDGETS: { maxHostsPerDocument: 32 }, isSanitizedHost: value => typeof value === 'string' && /^[a-z0-9.-]+$/.test(value),
    clock: { now: () => 10000 },
  });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.controller = new ScopeController(api, clock);', realm);
  return { controller: realm.controller, api, local, session, events, scripts, origins };
}

test('fresh installation persists the enabled default and registers both document_start worlds without a UI action', async () => {
  const f = fixture(); await f.controller.startup();
  assert.deepEqual(f.local[C], accepted);
  assert.deepEqual(f.local.scope, scope('all-sites'));
  assert.equal(f.controller.accessReady, true);
  assert.equal(f.scripts.size, 2);
  assert.deepEqual([...f.scripts.values()].map(item => [item.world, item.js[0], item.runAt, item.allFrames]),
    [['ISOLATED', 'bridge.js', 'document_start', true], ['MAIN', 'hook.early.js', 'document_start', true]]);
  assert.ok(f.events.findIndex(event => event.value?.[C]) < f.events.findIndex(event => event.kind === 'register'));
});

for (const value of [{ version: 1, accepted: false }, null, undefined, false, {}, { version: 2, accepted: true }, { version: 1, accepted: 'true' }]) {
  test('saved refusal or malformed value is never replaced: ' + JSON.stringify(value), async () => {
    const local = { [C]: value }; const f = fixture({ local }); await f.controller.startup();
    assert.equal(f.controller.hasDataConsent, false); assert.equal(f.scripts.size, 0);
    assert.deepEqual(local[C], value);
    assert.equal(f.events.some(event => event.value?.[C]?.accepted === true), false);
  });
}

for (const value of [true, false, null, undefined]) {
  test('any own pending marker blocks first-install bootstrap: ' + String(value), async () => {
    const f = fixture({ session: { [P]: value } }); await f.controller.startup();
    assert.equal(Object.hasOwn(f.local, C), false);
    assert.equal(f.controller.accessReady, false); assert.equal(f.scripts.size, 0);
  });
}

for (const consent of [undefined, accepted]) for (const mode of ['off', 'site', 'active-tab']) {
  test('saved ' + mode + ' scope survives absent default marker and ' + (consent ? 'accepted' : 'missing') + ' observation state', async () => {
    const local = { scope: scope(mode), ...(consent ? { [C]: consent } : {}) };
    const f = fixture({ local }); await f.controller.startup();
    assert.deepEqual(local.scope, scope(mode)); assert.equal(local[F], true);
    assert.equal(f.controller.getScopeMode(), mode);
    assert.equal(f.scripts.size, mode === 'site' ? 2 : 0);
  });
}

for (const value of [null, undefined, { v: 9, scopeMode: 'all-sites' }]) {
  test('saved malformed scope projects to off instead of broadening: ' + JSON.stringify(value), async () => {
    const f = fixture({ local: { scope: value } }); await f.controller.startup();
    assert.equal(f.controller.getScopeMode(), 'off'); assert.equal(f.scripts.size, 0);
    assert.equal(f.local[F], true);
  });
}

test('persistence must finish before observation or registration can start', async () => {
  let release, entered;
  const reached = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture({ beforeWrite: async value => { if (value[C]) { entered(); await pending; } } });
  const startup = f.controller.startup(); await reached;
  assert.equal(f.controller.hasDataConsent, false); assert.equal(f.controller.accessReady, false);
  assert.equal(f.scripts.size, 0); release(); await startup;
  assert.equal(f.controller.accessReady, true); assert.equal(f.scripts.size, 2);
});

for (const kind of ['local', 'session']) for (const operation of ['failRead', 'failWrite']) {
  test(kind + ' ' + operation + ' keeps observation off', async () => {
    const f = fixture({ [operation]: kind }); await f.controller.startup().catch(() => {});
    assert.equal(f.controller.accessReady, false); assert.equal(f.scripts.size, 0);
  });
}

for (const failOnce of ['local:get', 'session:get', 'local:set']) for (const saved of [false, true]) {
  test('one ' + failOnce + ' failure preserves ' + (saved ? 'saved site' : 'fresh install') + ' on restart', async () => {
    const local = saved ? { [C]: accepted, scope: scope('site') } : {};
    const f = fixture({ local, failOnce }); await assert.rejects(f.controller.startup());
    assert.equal(f.controller.accessReady, false); assert.equal(f.scripts.size, 0);
    assert.deepEqual(local.scope, saved ? scope('site') : undefined);
    const retry = fixture({ local, session: f.session }); await retry.controller.startup();
    assert.equal(retry.controller.accessReady, true); assert.equal(retry.scripts.size, 2);
    assert.deepEqual(local.scope, scope(saved ? 'site' : 'all-sites'));
  });
}

test('withheld host access stays unregistered; granting it later activates the fresh-install default', async () => {
  const f = fixture({ origins: [] }); await f.controller.startup();
  assert.equal(f.scripts.size, 0); assert.equal(Object.hasOwn(f.local, 'scope'), false);
  f.origins.push('<all_urls>'); await f.controller.onPermissionsChanged();
  assert.equal(f.controller.getScopeMode(), 'all-sites'); assert.equal(f.scripts.size, 2);
});

test('explicit off during withheld access is preserved after permissions are granted', async () => {
  const f = fixture({ origins: [] }); await f.controller.startup();
  await f.controller.setScope({ scopeMode: 'off' });
  f.origins.push('<all_urls>'); await f.controller.onPermissionsChanged();
  assert.equal(f.controller.getScopeMode(), 'off'); assert.equal(f.scripts.size, 0);
});

test('revocation and pending revocation survive startup and never reenable observation', async () => {
  const f = fixture(); await f.controller.startup();
  await f.controller.beginDataConsentChange(); assert.equal(f.scripts.size, 0);
  const interrupted = fixture({ local: f.local, session: f.session }); await interrupted.controller.startup();
  assert.equal(interrupted.controller.accessReady, false); assert.equal(interrupted.scripts.size, 0);
  assert.equal(await f.controller.setDataConsent(false), true);
  const restarted = fixture({ local: f.local, session: f.session }); await restarted.controller.startup();
  assert.equal(restarted.controller.accessReady, false); assert.equal(restarted.scripts.size, 0);
});

test('header OFF/ON in active-tab mode restores real controller access through document-bound injection', async () => {
  const f = fixture({ local: { [C]: accepted, scope: scope('active-tab') }, session: { 'active-tabs': [{ tabId: 7, documentId: 'current-doc' }] } });
  const injected = [];
  f.api.webNavigation = { getAllFrames: async () => [{ frameId: 0, documentId: 'current-doc' }] };
  f.api.scripting.executeScript = async entry => { injected.push(plain(entry)); };
  f.api.runtime.sendMessage = async message => {
    if (message.type === 'ui-data-consent-get') return { type: 'data-consent-state', accepted: f.controller.hasDataConsent };
    if (message.type === 'ui-get-scope') return { type: 'scope', scope: plain(f.controller.getState()) };
    if (message.type === 'ui-set-scope') {
      const result = await f.controller.setScope(message); await f.controller.onPermissionsChanged();
      return { type: result.ok ? 'scope' : 'error', scope: plain(f.controller.getState()) };
    }
    if (message.type === 'ui-inject-now') return { type: await f.controller.injectNow(message.tabId, 'example.com', 'current-doc') ? 'ok' : 'error' };
    throw Error('unexpected route');
  };
  await f.controller.startup(); assert.equal(f.controller.hasAnyHostAccess(), true);
  await setObservationControl(f.api, false, 7); assert.equal(f.controller.hasAnyHostAccess(), false);
  assert.equal((await setObservationControl(f.api, true, 7)).enabled, true);
  assert.equal(f.controller.hasAnyHostAccess(), true); assert.equal(f.controller.activeTabs.get(7).documentId, 'current-doc');
  assert.deepEqual(injected.map(item => [item.world, item.target]), [['ISOLATED', { tabId: 7, documentIds: ['current-doc'] }], ['MAIN', { tabId: 7, documentIds: ['current-doc'] }]]);
});

for (const bundle of ['popup', 'sidepanel', 'options', 'report']) {
  test(bundle + ' renders compact off/loading/error controls without the disclosure wall', () => {
    const code = readFileSync(new URL('../../apps/production-extension/' + bundle + '.js', import.meta.url), 'utf8');
    const from = code.indexOf('function DataConsent({ consent })');
    const to = code.indexOf('\nfunction ', from + 20);
    assert.ok(from >= 0 && to > from);
    const realm = vm.createContext({ useLocale() {}, t3: key => key, u3: (type, props) => ({ type, props }) });
    vm.runInContext(code.slice(from, to) + '\nglobalThis.render = DataConsent;', realm);
    const state = value => realm.render({ consent: value });
    const loading = state({ state: null, error: null });
    assert.equal(loading.props.role, 'status'); assert.equal(loading.props.children, 'statusLoading');
    let chosen;
    const off = state({ state: { accepted: false }, busy: false, error: null, choose: value => { chosen = value; } });
    const button = off.props.children[1].props.children[1];
    assert.equal(button.props['data-action'], 'accept-data-consent'); button.props.onClick(); assert.equal(chosen, true);
    assert.equal(JSON.stringify(off).includes('consent_data'), false);
    const on = state({ state: { accepted: true }, busy: true, error: true, choose: value => { chosen = value; } });
    assert.equal(on.props.children[0].props.role, 'alert');
    const revoke = on.props.children[1].props.children[1];
    assert.equal(revoke.props.disabled, true); revoke.props.onClick(); assert.equal(chosen, false);
  });
}
