import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiConfiguration, updateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { ANTIDETECT_PROTOCOL_RULE_IDS, AntidetectProtocolController, buildAntidetectProtocolRules } from '../../apps/production-extension/antidetect-protocol-controller.js';

const full = ['http://*/*', 'https://*/*'];
const copy = value => structuredClone(value);
function change(config, id, mode, host = null) {
  const next = updateApiConfiguration(config, id, { mode }, host);
  assert.equal(next.ok, true, next.error?.message); return next.value;
}
function configuration(...ids) {
  let value = { ...createApiConfiguration(), enabled: true, preset: 'custom' };
  for (const id of ids) value = change(value, id, 'on');
  return value;
}
function fixture(options = {}) {
  const calls = [], foreign = [
    { id: 1, priority: 100, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-GPC', operation: 'set', value: '1' }] }, condition: { resourceTypes: ['xmlhttprequest'] } },
    { id: 100000, priority: 20, action: { type: 'allow' }, condition: { requestDomains: ['fixture.invalid'] } },
    { id: 101023, priority: 10, action: { type: 'block' }, condition: { requestDomains: ['fixture.invalid'] } },
    { id: 200000, priority: 50, action: { type: 'allow' }, condition: { tabIds: [7], requestDomains: ['fixture.invalid'] } },
    { id: 300002, priority: 5, action: { type: 'block' }, condition: { resourceTypes: ['image'] } },
  ];
  let current = copy(foreign), fail = '', ignore = false, result, hold, readsHold, runningWrites = 0, maximumWrites = 0;
  const dnr = {
    async getDynamicRules() {
      calls.push(['read']);
      if (readsHold) await readsHold;
      if (fail === 'read') throw Error('private native failure with https://do-not-expose.invalid');
      return copy(current);
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
  const api = { runtime: { id: 'antidetect-protocol-unit', getURL: path => (options.firefox ? 'moz-extension://owned/' : 'chrome-extension://owned/') + path }, declarativeNetRequest: dnr };
  return { api, dnr, calls, foreign, current: () => copy(current), set: value => { current = copy(value); }, fail: value => { fail = value; },
    ignore: () => { ignore = true; }, result: value => { result = value; }, hold: promise => { hold = promise; }, readsHold: promise => { readsHold = promise; }, maximumWrites: () => maximumWrites };
}
const writes = f => f.calls.filter(row => row[0] === 'write');
const own = rules => rules.filter(rule => Object.values(ANTIDETECT_PROTOCOL_RULE_IDS).includes(rule.id));

test('only two explicit native protocol IDs exist and generated rules can never affect HTTP or UDP', () => {
  assert.deepEqual(ANTIDETECT_PROTOCOL_RULE_IDS, { websocket: 300000, webtransport: 300001 });
  assert.equal(Object.isFrozen(ANTIDETECT_PROTOCOL_RULE_IDS), true);
  const value = buildAntidetectProtocolRules(configuration('websocket', 'webtransport', 'webrtc'), full, true);
  assert.equal(value.status, 'applied'); assert.equal(value.rules.length, 2);
  for (const rule of value.rules) {
    assert.deepEqual(Object.keys(rule), ['id', 'priority', 'action', 'condition']);
    assert.deepEqual(rule.action, { type: 'block' }); assert.equal(rule.priority, 1000);
    assert.deepEqual(Object.keys(rule.condition), ['resourceTypes']);
    assert.deepEqual(rule.condition.resourceTypes, [rule.id === 300000 ? 'websocket' : 'webtransport']);
  }
});

test('inactive API master or scope removes native requirements and never enables the master', () => {
  const value = configuration('websocket'), retained = copy(value);
  assert.deepEqual(buildAntidetectProtocolRules(value, full, false), { status: 'inactive', rules: [] });
  assert.deepEqual(buildAntidetectProtocolRules({ ...value, enabled: false }, full, true), { status: 'inactive', rules: [] });
  assert.deepEqual(value, retained);
});

test('OFF and BYPASS inherit normal native transport without consulting dormant Custom selections', () => {
  let value = configuration('websocket');
  for (const mode of ['off', 'bypass']) {
    value = change(value, 'websocket', mode);
    assert.deepEqual(buildAntidetectProtocolRules(value, full, true), { status: 'inactive', rules: [] });
  }
});

test('exact-host overrides disable only the affected native protocol and never widen to subdomains', () => {
  let value = configuration('websocket', 'webtransport');
  value = change(value, 'websocket', 'off', 'exact.fixture.invalid');
  const result = buildAntidetectProtocolRules(value, full, true);
  assert.equal(result.status, 'unsupported'); assert.deepEqual(result.rules.map(rule => rule.id), [300001]);
  assert.equal(JSON.stringify(result).includes('initiatorDomains'), false);
  value = change(value, 'webtransport', 'off', 'other.fixture.invalid');
  assert.deepEqual(buildAntidetectProtocolRules(value, full, true), { status: 'unsupported', rules: [] });
});

test('effective Bypass and equal explicit site states retain global native enforcement', () => {
  let value = configuration('websocket', 'webtransport');
  value = change(value, 'websocket', 'bypass', 'exact.fixture.invalid');
  value = change(value, 'webtransport', 'on', 'exact.fixture.invalid');
  const result = buildAntidetectProtocolRules(value, full, true);
  assert.equal(result.status, 'applied'); assert.equal(result.rules.length, 2);
});

test('site-only block and disabled sites remain page-scoped instead of broadening browser rules', () => {
  let value = change(configuration('webtransport'), 'websocket', 'on', 'exact.fixture.invalid');
  let result = buildAntidetectProtocolRules(value, full, true);
  assert.equal(result.status, 'unsupported'); assert.deepEqual(result.rules.map(rule => rule.id), [300001]);
  value.sites[0].disabled = true; result = buildAntidetectProtocolRules(value, full, true);
  assert.deepEqual(result, { status: 'unsupported', rules: [] });
});

test('site and active-tab matches never create browser-wide rules or accept partial global grants', () => {
  for (const matches of [[], ['http://exact.fixture.invalid/*', 'https://exact.fixture.invalid/*'], ['http://*/*'], ['https://*/*'], ['*://*/*'], ['<all_urls>']]) {
    assert.deepEqual(buildAntidetectProtocolRules(configuration('websocket'), matches, true), { status: 'unsupported', rules: [] });
  }
});

test('invalid configuration is rejected before any native metadata read or write', async () => {
  const f = fixture(), c = new AntidetectProtocolController(f.api);
  for (const value of [null, {}, { ...configuration(), enabled: 'true' }, { ...configuration(), apis: [] }]) {
    assert.equal((await c.reconcile(value, full, true)).status, 'error');
  }
  assert.equal((await c.reconcile(configuration(), null, true)).status, 'error');
  assert.equal((await c.reconcile(configuration(), full, 1)).status, 'error');
  assert.deepEqual(f.calls, []);
});

test('apply is one native atomic write and readback, preserves every Firewall and foreign ID', async () => {
  const f = fixture(), c = new AntidetectProtocolController(f.api), value = configuration('websocket', 'webtransport');
  assert.equal((await c.reconcile(value, full, true)).status, 'applied');
  assert.deepEqual(f.calls.map(row => row[0]), ['read', 'write', 'read']);
  assert.deepEqual(f.current().filter(rule => !own([rule]).length), f.foreign);
  assert.deepEqual(writes(f)[0][1].removeRuleIds, []);
  assert.equal((await c.reconcile(value, full, true)).status, 'applied'); assert.equal(writes(f).length, 1, 'matching actual native rules are not written again');
  assert.equal((await c.reconcile({ ...value, enabled: false }, full, false)).status, 'inactive');
  assert.deepEqual(writes(f)[1][1], { removeRuleIds: [300000, 300001], addRules: [] });
  assert.deepEqual(f.current(), f.foreign);
});

test('unrepresentable exact site exception clears only its old protocol and retains supported other guard', async () => {
  const f = fixture(), c = new AntidetectProtocolController(f.api); let value = configuration('websocket', 'webtransport');
  await c.reconcile(value, full, true);
  value = change(value, 'websocket', 'off', 'exact.fixture.invalid');
  assert.equal((await c.reconcile(value, full, true)).status, 'unsupported');
  assert.deepEqual(own(f.current()).map(rule => rule.id), [300001]); assert.deepEqual(f.current().filter(rule => !own([rule]).length), f.foreign);
});

test('stale or broadened rules on exactly our two IDs are replaced, adjacent 300002 is untouched', async () => {
  const f = fixture(), c = new AntidetectProtocolController(f.api);
  f.set([...f.foreign, { id: 300000, priority: 1, action: { type: 'allow' }, condition: { resourceTypes: ['main_frame'] } }]);
  assert.equal((await c.reconcile(configuration('websocket'), full, true)).status, 'applied');
  assert.deepEqual(writes(f)[0][1].removeRuleIds, [300000]);
  assert.deepEqual(f.current().find(rule => rule.id === 300002), f.foreign.find(rule => rule.id === 300002));
  assert.deepEqual(own(f.current()), buildAntidetectProtocolRules(configuration('websocket'), full, true).rules);
});

test('Firefox or absent native DNR reports unsupported without permissions changes or native calls', async () => {
  for (const kind of ['firefox', 'missing']) {
    const f = fixture({ firefox: kind === 'firefox' }), c = new AntidetectProtocolController(f.api);
    if (kind === 'missing') delete f.api.declarativeNetRequest;
    assert.equal((await c.reconcile(configuration('websocket'), full, true)).status, 'unsupported'); assert.deepEqual(f.calls, []);
  }
});

test('native errors, ignored writes and false returns never claim applied or expose native exception text', async () => {
  for (const failure of ['read', 'write', 'ignored', 'false']) {
    const f = fixture(), c = new AntidetectProtocolController(f.api);
    if (failure === 'ignored') f.ignore(); else if (failure === 'false') f.result(false); else f.fail(failure);
    const result = await c.reconcile(configuration('websocket'), full, true);
    assert.deepEqual(result, { status: 'error' }); assert.equal(JSON.stringify(c.inspect()).includes('private'), false);
    assert.ok(writes(f).length <= 1, 'a native failure never triggers an implicit write retry');
  }
});

test('timed-out native write retains the physical mutex and does not overlap queued retries or cleanup', async () => {
  const f = fixture(), c = new AntidetectProtocolController(f.api, { timeoutMs: 15 }); let release;
  f.hold(new Promise(resolve => { release = resolve; }));
  const value = configuration('websocket'), first = c.reconcile(value, full, true), second = c.reconcile({ ...value, enabled: false }, full, false);
  assert.equal((await first).status, 'error'); assert.equal((await second).status, 'error');
  assert.equal(writes(f).length, 1); assert.equal(f.maximumWrites(), 1);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(own(f.current()).length, 1, 'a late physical write may settle, but was never reported applied after timeout');
  assert.equal((await c.reconcile({ ...value, enabled: false }, full, false)).status, 'inactive');
  assert.equal(writes(f).length, 2); assert.equal(f.maximumWrites(), 1); assert.deepEqual(f.current(), f.foreign);
});

test('timed-out native read cannot later dispatch a write and blocks repeats until physically settled', async () => {
  const f = fixture(), c = new AntidetectProtocolController(f.api, { timeoutMs: 15 }); let release;
  f.readsHold(new Promise(resolve => { release = resolve; }));
  assert.equal((await c.reconcile(configuration('websocket'), full, true)).status, 'error');
  assert.equal((await c.reconcile(configuration('websocket'), full, true)).status, 'error');
  assert.deepEqual(f.calls.map(row => row[0]), ['read']);
  release(); await new Promise(resolve => setImmediate(resolve)); assert.equal(writes(f).length, 0);
  assert.equal((await c.reconcile(configuration('websocket'), full, true)).status, 'applied');
});

test('snapshot inspection is detached and contains only a safe status', async () => {
  const f = fixture(), c = new AntidetectProtocolController(f.api);
  await c.reconcile(configuration('websocket'), full, true);
  const snapshot = c.inspect(); snapshot.status = 'inactive';
  assert.deepEqual(c.inspect(), { status: 'applied' });
});

test('all 128 exact-host sites preserve protocol inheritance without revalidating each whole configuration', () => {
  const value = configuration('websocket', 'webtransport');
  const inherited = value.apis.map(({ id }) => ({ id, mode: 'bypass', selected: { kind: 'unset' }, settings: {} }));
  value.sites = Array.from({ length: 128 }, (_, index) => ({ host: 'site' + index + '.fixture.invalid', disabled: false, apis: copy(inherited) }));
  let result = buildAntidetectProtocolRules(value, full, true);
  assert.equal(result.status, 'applied'); assert.equal(result.rules.length, 2);
  value.sites[127].apis.find(row => row.id === 'websocket').mode = 'off';
  result = buildAntidetectProtocolRules(value, full, true);
  assert.equal(result.status, 'unsupported'); assert.deepEqual(result.rules.map(rule => rule.id), [300001]);
});
