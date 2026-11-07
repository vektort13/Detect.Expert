import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createObservationControl, readObservationControl, setObservationControl } from '../../apps/production-extension/observation-control.js';

function fixture(mode = 'all-sites', accepted = true) {
  const calls = [], stored = {};
  const scope = { scopeMode: mode, hosts: mode === 'site' ? ['first.example.com', 'second.example.com'] : [], grantedAllSites: true };
  const api = {
    runtime: { sendMessage: async message => {
      calls.push(message);
      if (message.type === 'ui-data-consent-get') return { type: 'data-consent-state', accepted };
      if (message.type === 'ui-data-consent-set') { accepted = message.accepted; return { type: 'data-consent-state', accepted }; }
      if (message.type === 'ui-get-scope') return { type: 'scope', scope: { ...scope } };
      if (message.type === 'ui-set-scope') { scope.scopeMode = message.scopeMode; return { type: 'scope', scope: { ...scope } }; }
      if (message.type === 'ui-inject-now') { scope.scopeMode = 'active-tab'; return { type: 'ok' }; }
      throw Error('unexpected action');
    } },
    storage: { local: { get: async () => stored, set: async value => { Object.assign(stored, value); } } },
  };
  return { api, scope, calls, stored };
}

for (const mode of ['all-sites', 'site', 'active-tab']) {
  test('master off/on restores ' + mode + ' through the authorized scope route', async () => {
    const f = fixture(mode);
    assert.equal((await setObservationControl(f.api, false)).enabled, false);
    assert.equal(f.scope.scopeMode, 'off');
    assert.equal((await setObservationControl(f.api, true, 7)).enabled, true);
    assert.equal(f.scope.scopeMode, mode);
    if (mode === 'site') {
      assert.deepEqual(f.scope.hosts, ['first.example.com', 'second.example.com']);
      assert.equal(f.calls.find(item => item.type === 'ui-set-scope' && item.scopeMode === 'site').host, 'first.example.com');
    }
    assert.equal(f.calls.some(item => /clear|consent-set|pro-start|dbsc-start|protection-set/.test(item.type)), false);
  });
}

test('repeated requested state performs no mutation', async () => {
  const f = fixture(); await setObservationControl(f.api, true);
  assert.deepEqual(f.stored, {}); assert.equal(f.calls.some(item => item.type === 'ui-set-scope'), false);
});
test('previous explicit refusal can be reenabled through the existing trusted route', async () => {
  const f = fixture('off', false);
  assert.equal((await readObservationControl(f.api)).enabled, false);
  assert.equal((await setObservationControl(f.api, true)).enabled, true);
  assert.equal(f.calls.find(item => item.type === 'ui-data-consent-set').accepted, true);
});
test('remembering scope failure rejects before disabling or losing the previous selection', async () => {
  const f = fixture('site'); f.api.storage.local.set = async () => { throw Error('storage failed'); };
  await assert.rejects(setObservationControl(f.api, false));
  assert.equal(f.scope.scopeMode, 'site'); assert.equal(f.calls.some(item => item.type === 'ui-set-scope'), false);
});
test('rejected background action does not claim success', async () => {
  const f = fixture(), send = f.api.runtime.sendMessage;
  f.api.runtime.sendMessage = message => message.type === 'ui-set-scope' ? { type: 'error', code: 'unauthorized-sender' } : send(message);
  await assert.rejects(setObservationControl(f.api, false));
  assert.equal(f.scope.scopeMode, 'all-sites');
});
test('saved site with no remaining hosts does not broaden to all sites', async () => {
  const f = fixture('off'); f.stored['scope:resume-mode-v1'] = { version: 1, scopeMode: 'site' };
  await assert.rejects(setObservationControl(f.api, true)); assert.equal(f.scope.scopeMode, 'off');
});
test('unsupported saved mode is not forwarded to a privileged route', async () => {
  const f = fixture('off'); f.stored['scope:resume-mode-v1'] = { version: 1, scopeMode: '__proto__' };
  await setObservationControl(f.api, true);
  assert.equal(f.calls.find(item => item.type === 'ui-set-scope').scopeMode, 'all-sites');
});
test('no host grants uses the existing active-tab injection without requesting permissions', async () => {
  const f = fixture('off'); f.scope.grantedAllSites = false;
  await setObservationControl(f.api, true, 7); assert.equal(f.scope.scopeMode, 'active-tab');
  assert.equal(f.calls.some(call => call.type === 'ui-inject-now' && call.tabId === 7), true);
  assert.equal(f.calls.some(call => call.type === 'ui-set-scope' && call.scopeMode === 'active-tab'), false);
});
test('active-tab without a captured website or rejected injection stays off', async () => {
  const f = fixture('off'); f.scope.grantedAllSites = false;
  await assert.rejects(setObservationControl(f.api, true)); assert.equal(f.scope.scopeMode, 'off');
  const send = f.api.runtime.sendMessage;
  f.api.runtime.sendMessage = message => message.type === 'ui-inject-now' ? { type: 'error', code: 'no-access' } : send(message);
  await assert.rejects(setObservationControl(f.api, true, 7)); assert.equal(f.scope.scopeMode, 'off');
});

const tick = () => new Promise(done => setImmediate(done));
function componentFixture(f) {
  const states = [], refs = [], listeners = new Set(); let cursor = 0, refCursor = 0, mounted = false, cleanup;
  f.api.tabs = { query: async () => [{ id: 7, url: 'https://example.com' }] };
  f.api.storage.onChanged = { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) };
  const Component = createObservationControl({ h: (type, props) => ({ type, props }), useLocale() {}, translate: key => key, browserApi: f.api,
    useState: initial => { const slot = cursor++; if (!(slot in states)) states[slot] = initial; return [states[slot], value => { states[slot] = value; }]; },
    useRef: initial => refs[refCursor++] ?? (refs[refCursor - 1] = { current: initial }),
    useEffect: fn => { if (!mounted) { mounted = true; cleanup = fn(); } },
  });
  return { render: () => { cursor = refCursor = 0; return Component({ tabId: 7 }); }, changed: () => { for (const fn of listeners) fn({ scope: {} }, 'local'); }, cleanup: () => cleanup?.() };
}
test('a pending background read coalesces 100 storage notifications to one follow-up', async () => {
  const f = fixture(), original = f.api.runtime.sendMessage; let release, count = 0;
  f.api.runtime.sendMessage = message => {
    count++;
    if (count === 1) return new Promise(done => { release = () => done({ type: 'data-consent-state', accepted: true }); });
    return original(message);
  };
  const c = componentFixture(f); c.render();
  for (let i = 0; i < 100; i++) c.changed();
  assert.equal(count, 1); release(); await tick();
  assert.equal(count, 4, 'one initial two-message read and one final two-message read');
  assert.equal(c.render().props.children[0].props['aria-checked'], true); c.cleanup();
});
test('a late OFF result cannot overwrite a newer ON change from another extension surface', async () => {
  const f = fixture(), original = f.api.runtime.sendMessage; let release, hold = false;
  const c = componentFixture(f); c.render(); await tick();
  f.api.runtime.sendMessage = async message => {
    const result = await original(message);
    if (message.type === 'ui-set-scope') hold = true;
    else if (message.type === 'ui-get-scope' && hold) {
      hold = false;
      return new Promise(done => { release = () => done(result); });
    }
    return result;
  };
  const toggle = c.render().props.children[0].props.onClick(); await tick();
  assert.equal(f.scope.scopeMode, 'off'); assert.ok(release);
  f.scope.scopeMode = 'all-sites'; c.changed(); release(); await toggle; await tick();
  assert.equal(c.render().props.children[0].props['aria-checked'], true);
  assert.equal(c.render().props.children[0].props.disabled, false); c.cleanup();
});
