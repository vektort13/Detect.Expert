// ADR-019 (S11): sensor family settings in the SW — managed policy parsing, user/organization union, last-known-good,
// MAIN prelude registration, reducer stamps, data drop for disabled families, projection and export.

import { readFileSync } from 'node:fs';
import type { Ack, PageBatch, PageObservation, ReportProjection, ScopeState, UiResponse } from '@detect-expert/contracts';
import { describe, expect, it } from 'vitest';
import { PROTECT_MANAGED_POLICY } from '../src/protect/controller';
import { OTHER_MANAGED_POLICY_NAMES } from '../src/sensors';
import {
  MAIN_SCRIPT_ID,
  MANAGED_POLICY_NAME,
  POLICY_LKG_KEY,
  SENSOR_PREFS_KEY,
  SensorPolicyController,
  createBackground,
  createInitialState,
  mainFiles,
  parseMainFiles,
  parseManagedPolicy,
  reduce,
} from '../src/index';
import type { Background, DocumentsState, MessageSenderLike } from '../src/index';
import { committed, createFakeChrome, pageSender, settle, uiSender } from './fake-chrome';
import type { FakeChrome, FakeChromeOptions } from './fake-chrome';

const D1 = 'DOC000000000000000000000000000001';
const D2 = 'DOC000000000000000000000000000002';
const KEY1 = '7:0:' + D1;
const ALL = ['canvas', 'webgl', 'audio', 'permissions', 'environment', 'geometry'] as const;

function obs(over: Partial<PageObservation> = {}): PageObservation {
  return { techniqueId: 'DET-001', count: 1, countQuality: 'exact', phase: 'attempted', signalCodes: ['api-use'], intervalBucket: 1, ...over };
}

function batchOf(batchSeq: number, observations: PageObservation[] = [obs()], over: Partial<PageBatch> = {}): PageBatch {
  return { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'boot-1', bridgeSessionId: 'bridge-1', batchSeq, observations, coverageDelta: [], ...over };
}

function send(bg: Background, message: unknown, sender: MessageSenderLike): Promise<Ack | UiResponse> {
  return new Promise((resolve) => {
    expect(bg.onMessage(message, sender, resolve)).toBe(true);
  });
}

async function setup(options: FakeChromeOptions & { site?: boolean; testOverride?: boolean } = {}): Promise<{ fake: FakeChrome; bg: Background }> {
  const fake = createFakeChrome(options.site === false ? options : { grantedOrigins: ['https://example.com/*'], ...options });
  if (options.site !== false) fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
  const clock = { t: 1_000_000, now() { return this.t; } };
  const bg = createBackground(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1, ...(options.testOverride === true ? { sensorPolicyTestOverride: true } : {}) });
  fake.events.onCommitted.addListener(bg.navigation.onCommitted);
  fake.events.tabRemoved.addListener(bg.navigation.onTabRemoved);
  fake.events.onAdded.addListener(bg.navigation.onPermissionsAdded);
  fake.events.onRemoved.addListener(bg.navigation.onPermissionsRemoved);
  await bg.start();
  return { fake, bg };
}

async function setSensor(bg: Background, sensorId: string, enabled: boolean): Promise<ScopeState> {
  const r = await send(bg, { schemaVersion: 1, type: 'ui-set-sensor', sensorId, enabled }, uiSender());
  if (r.type !== 'scope') throw new Error('ui-set-sensor answered ' + JSON.stringify(r));
  return r.scope;
}

async function projection(bg: Background, tabId = 7): Promise<ReportProjection> {
  const r = await send(bg, { schemaVersion: 1, type: 'ui-get-report', tabId }, uiSender());
  if (r.type !== 'report' || r.report === null) throw new Error('no report: ' + JSON.stringify(r));
  return r.report;
}

function mainJs(fake: FakeChrome): string[] | undefined {
  return fake.registered.get(MAIN_SCRIPT_ID)?.js;
}

describe('parseManagedPolicy (ADR-019)', () => {
  it('valid: registry ids in registry order, duplicates collapse, rejected entries counted', () => {
    expect(parseManagedPolicy({ DisabledSensorIds: ['webgl', 'canvas', 'canvas'] })).toEqual({ status: 'valid', disabled: ['canvas', 'webgl'], rejected: 0 });
    expect(parseManagedPolicy({ DisabledSensorIds: ['canvas', 'nope'] })).toEqual({ status: 'valid', disabled: ['canvas'], rejected: 1 });
    expect(parseManagedPolicy({ DisabledSensorIds: ['', 'Canvas', 1, null, {}, 'a'.repeat(65), 'canvas'] })).toEqual({ status: 'valid', disabled: ['canvas'], rejected: 6 });
    expect(parseManagedPolicy({ DisabledSensorIds: [] })).toEqual({ status: 'valid', disabled: [], rejected: 0 });
    expect(parseManagedPolicy({ DisabledSensorIds: Array.from({ length: 32 }, () => 'audio') })).toEqual({ status: 'valid', disabled: ['audio'], rejected: 0 });
  });

  it('absent, invalid and foreign keys', () => {
    expect(parseManagedPolicy({})).toEqual({ status: 'absent', disabled: [], rejected: 0 });
    expect(parseManagedPolicy({ Other: 1 })).toEqual({ status: 'absent', disabled: [], rejected: 1 });
    expect(parseManagedPolicy({ DisabledSensorIds: ['canvas'], Other: 1 })).toEqual({ status: 'valid', disabled: ['canvas'], rejected: 1 });
    for (const items of [null, undefined, 'canvas', ['canvas'], 1]) expect(parseManagedPolicy(items)).toEqual({ status: 'invalid', disabled: [], rejected: 0 });
    for (const value of ['canvas', { 0: 'canvas' }, 1, null, Array.from({ length: 33 }, () => 'canvas')]) {
      expect(parseManagedPolicy({ DisabledSensorIds: value }).status).toBe('invalid');
    }
  });

  it('ADR-020: the approved module policy ProtectModuleDisabled is not a rejected entry', () => {
    expect(OTHER_MANAGED_POLICY_NAMES).toEqual([PROTECT_MANAGED_POLICY]);
    const schema = JSON.parse(readFileSync('apps/extension/managed_schema.json', 'utf8')) as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties).sort()).toEqual([MANAGED_POLICY_NAME, ...OTHER_MANAGED_POLICY_NAMES].sort());
    expect(parseManagedPolicy({ ProtectModuleDisabled: true })).toEqual({ status: 'absent', disabled: [], rejected: 0 });
    expect(parseManagedPolicy({ ProtectModuleDisabled: 'yes' })).toEqual({ status: 'absent', disabled: [], rejected: 0 });
    expect(parseManagedPolicy({ DisabledSensorIds: ['canvas', 'nope'], ProtectModuleDisabled: true })).toEqual({ status: 'valid', disabled: ['canvas'], rejected: 1 });
    expect(parseManagedPolicy({ DisabledSensorIds: ['canvas'], ProtectModuleDisabled: false, Other: 1 })).toEqual({ status: 'valid', disabled: ['canvas'], rejected: 1 });
  });
});

describe('MAIN prelude file lists (ADR-019)', () => {
  it('mainFiles puts the record first, off files in registry order, the sensor bundle last', () => {
    expect(mainFiles(true, [])).toEqual(['sensor-policy.js', 'hook.early.js']);
    expect(mainFiles(false, ['geometry', 'canvas', 'canvas'])).toEqual(['sensor-policy.js', 'sensor-off.canvas.js', 'sensor-off.geometry.js', 'hook.main.js']);
  });

  it('parseMainFiles reads the off set back; anything else is null', () => {
    expect(parseMainFiles(mainFiles(true, ['webgl', 'audio']))).toEqual(['webgl', 'audio']);
    expect(parseMainFiles(['sensor-policy.js', 'hook.early.js'])).toEqual([]);
    for (const js of [undefined, ['hook.early.js'], ['sensor-policy.js'], ['sensor-policy.js', 'sensor-off.nope.js', 'hook.early.js'],
      ['sensor-policy.js', 'sensor-off.canvas.js', 'sensor-off.canvas.js', 'hook.early.js'], ['sensor-policy.js', 'other.js']]) {
      expect(parseMainFiles(js)).toBeNull();
    }
  });
});

describe('SensorPolicyController (ADR-019)', () => {
  it('loads user prefs and the managed policy; effective off = user ∪ organization; the user cannot enable an organization family', async () => {
    const fake = createFakeChrome({ managed: { DisabledSensorIds: ['webgl'] } });
    fake.local.data.set(SENSOR_PREFS_KEY, { v: 1, disabled: ['geometry', 'bogus', 'canvas'] });
    const c = new SensorPolicyController(fake);
    await c.load();
    expect(c.userDisabled()).toEqual(['canvas', 'geometry']);
    expect(c.organizationDisabled()).toEqual(['webgl']);
    expect(c.effectiveOff()).toEqual(['canvas', 'webgl', 'geometry']);
    expect(c.organizationPolicy).toBe('applied');
    expect(fake.local.data.get(POLICY_LKG_KEY)).toEqual({ v: 1, disabledSensorIds: ['webgl'] });
    const changes: Array<{ before: readonly string[]; after: readonly string[] }> = [];
    await c.setUser('webgl', true, (change) => { changes.push(change); });
    expect(c.effectiveOff()).toContain('webgl');
    expect(c.sourcesOf('webgl')).toEqual(['organization']);
    await c.setUser('webgl', false, (change) => { changes.push(change); });
    expect(c.sourcesOf('webgl')).toEqual(['user', 'organization']);
    expect(c.settings().sensors.find((s) => s.sensorId === 'webgl')).toEqual({ sensorId: 'webgl', enabled: false, disabledBy: ['user', 'organization'] });
    expect(fake.local.data.get(SENSOR_PREFS_KEY)).toEqual({ v: 1, disabled: ['canvas', 'webgl', 'geometry'] });
    expect(changes).toHaveLength(2);
  });

  it('invalid or unreadable managed value keeps the last-known-good copy; absent removes it', async () => {
    const fake = createFakeChrome({ managed: { DisabledSensorIds: ['canvas', 'webgl'] } });
    const c = new SensorPolicyController(fake);
    await c.load();
    expect(c.organizationDisabled()).toEqual(['canvas', 'webgl']);
    fake.managed.data.set('DisabledSensorIds', 'canvas');
    await c.refreshManaged(() => undefined);
    expect(c.organizationPolicy).toBe('last-known-good');
    expect(c.organizationDisabled()).toEqual(['canvas', 'webgl']);
    expect(fake.local.data.get(POLICY_LKG_KEY)).toEqual({ v: 1, disabledSensorIds: ['canvas', 'webgl'] });
    fake.failManagedGets = 1;
    await c.refreshManaged(() => undefined);
    expect(c.organizationPolicy).toBe('last-known-good');
    expect(c.organizationDisabled()).toEqual(['canvas', 'webgl']);
    fake.managed.data.clear();
    await c.refreshManaged(() => undefined);
    expect(c.organizationPolicy).toBe('absent');
    expect(c.organizationDisabled()).toEqual([]);
    expect(fake.local.data.has(POLICY_LKG_KEY)).toBe(false);
    // After an SW restart the stored copy alone (with an invalid current value) still applies.
    fake.local.data.set(POLICY_LKG_KEY, { v: 1, disabledSensorIds: ['audio'] });
    fake.managed.data.set('DisabledSensorIds', 1);
    const restarted = new SensorPolicyController(fake);
    await restarted.load();
    expect(restarted.organizationDisabled()).toEqual(['audio']);
    expect(restarted.settings().organizationPolicy).toBe('last-known-good');
  });

  it('the test override exists only with the option', async () => {
    const fake = createFakeChrome();
    expect(() => new SensorPolicyController(fake).setManagedOverrideForTest({})).toThrow('sensor-policy-override-disabled');
    const c = new SensorPolicyController(fake, { testOverride: true });
    await c.load();
    c.setManagedOverrideForTest({ DisabledSensorIds: ['canvas', 'nope'] });
    await c.refreshManaged(() => undefined);
    expect(c.settings()).toMatchObject({ organizationPolicy: 'applied', rejectedPolicyEntries: 1 });
    c.setManagedOverrideForTest(undefined);
    await c.refreshManaged(() => undefined);
    expect(c.settings()).toMatchObject({ organizationPolicy: 'absent', rejectedPolicyEntries: 0 });
  });

  it('mutations are serialized in arrival order', async () => {
    const fake = createFakeChrome();
    const c = new SensorPolicyController(fake);
    await c.load();
    const order: string[] = [];
    const slow = c.setUser('canvas', false, async () => { await settle(5); order.push('canvas'); });
    const fast = c.setUser('webgl', false, () => { order.push('webgl'); });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['canvas', 'webgl']);
    expect(c.userDisabled()).toEqual(['canvas', 'webgl']);
  });
});

describe('SW: ui-set-sensor, registration and live documents (ADR-019)', () => {
  it('scope responses carry sensorSettings; a page sender cannot send ui-set-sensor', async () => {
    const { bg } = await setup();
    const scope = await send(bg, { schemaVersion: 1, type: 'ui-get-scope' }, uiSender());
    expect(scope).toMatchObject({ type: 'scope', scope: { managed: false, sensorSettings: { organizationPolicy: 'absent', rejectedPolicyEntries: 0 } } });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-set-sensor', sensorId: 'canvas', enabled: false }, pageSender())).toEqual({ schemaVersion: 1, type: 'error', code: 'unauthorized-sender' });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-set-sensor', sensorId: 'math', enabled: false }, uiSender())).toEqual({ schemaVersion: 1, type: 'error', code: 'invalid-request' });
  });

  it('disabling canvas: registration gets the off file, the live document drops canvas data without counting loss, ACK advances', async () => {
    const { fake, bg } = await setup();
    expect(mainJs(fake)).toEqual(['sensor-policy.js', 'hook.early.js']);
    bg.navigation.onCommitted(committed());
    expect(await send(bg, batchOf(1, [obs(), obs({ techniqueId: 'DET-005', phase: 'returned-sync' })]), pageSender())).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 1 });
    const scope = await setSensor(bg, 'canvas', false);
    expect(scope.sensorSettings.sensors[0]).toEqual({ sensorId: 'canvas', enabled: false, disabledBy: ['user'] });
    expect(mainJs(fake)).toEqual(['sensor-policy.js', 'sensor-off.canvas.js', 'hook.early.js']);
    expect(fake.local.data.get(SENSOR_PREFS_KEY)).toEqual({ v: 1, disabled: ['canvas'] });
    const before = await projection(bg);
    expect(before.coverageFlags).toContain('sensor-disabled');
    expect(before.coverageState).toBe('partial');
    expect(before.disabledSensors).toEqual([{ sensorId: 'canvas', disabledBy: ['user'], hooksMayRemain: true }]);
    const canvasBefore = before.techniques.find((t) => t.techniqueId === 'DET-001')?.count;
    // The page (hooks still installed) keeps sending canvas data: dropped by design, not counted as loss.
    const ack = await send(bg, batchOf(2, [obs({ count: 50 }), obs({ techniqueId: 'DET-005', phase: 'returned-sync', count: 3 })]), pageSender());
    expect(ack).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 2, protocolOk: true });
    const after = await projection(bg);
    expect(after.techniques.find((t) => t.techniqueId === 'DET-001')?.count).toBe(canvasBefore);
    expect(after.techniques.find((t) => t.techniqueId === 'DET-005')?.count).toBe(3);
    expect(after.dropped).toEqual(before.dropped);
    // A batch of only disabled-family observations still advances the watermark (no redelivery loop).
    expect(await send(bg, batchOf(3, [obs({ count: 60 })]), pageSender())).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 3 });
    expect(bg.runtime.state.reports.get(KEY1)?.watermark).toEqual({ bridgeSessionId: 'bridge-1', lastCommittedBatchSeq: 3 });
  });

  it('a page cannot assert sensor-disabled; with nothing disabled the flag never appears', async () => {
    const { bg } = await setup();
    bg.navigation.onCommitted(committed());
    await send(bg, batchOf(1, [obs()], { coverageDelta: ['sensor-disabled'] }), pageSender());
    const p = await projection(bg);
    expect(p.coverageFlags).not.toContain('sensor-disabled');
    expect(p).not.toHaveProperty('disabledSensors');
  });

  it('a document loaded after the registration update gets no hooksMayRemain; enabling again is sticky until a new document', async () => {
    const { fake, bg } = await setup();
    await setSensor(bg, 'canvas', false);
    bg.navigation.onCommitted(committed());
    await send(bg, batchOf(1, [obs(), obs({ techniqueId: 'DET-005' })]), pageSender());
    const p = await projection(bg);
    expect(p.disabledSensors).toEqual([{ sensorId: 'canvas', disabledBy: ['user'], hooksMayRemain: false }]);
    expect(p.techniques.map((t) => t.techniqueId)).toEqual(['DET-005']);
    await setSensor(bg, 'canvas', true);
    expect(mainJs(fake)).toEqual(['sensor-policy.js', 'hook.early.js']);
    const reenabled = await projection(bg);
    expect(reenabled.disabledSensors).toEqual([{ sensorId: 'canvas', disabledBy: [], hooksMayRemain: false }]);
    await send(bg, batchOf(2, [obs({ count: 5 })]), pageSender());
    expect((await projection(bg)).techniques.map((t) => t.techniqueId)).toEqual(['DET-005']);
    // The next document observes canvas again.
    bg.navigation.onCommitted(committed({ documentId: D2 }));
    await send(bg, batchOf(1, [obs()]), pageSender({ docId: D2 }));
    const next = await projection(bg);
    expect(next.documentKey).toBe('7:0:' + D2);
    expect(next).not.toHaveProperty('disabledSensors');
    expect(next.coverageFlags).not.toContain('sensor-disabled');
    expect(next.techniques.map((t) => t.techniqueId)).toEqual(['DET-001']);
  });

  it('managed policy: organization reason, user cannot enable, on-the-fly change through storage.managed', async () => {
    const { fake, bg } = await setup({ managed: { DisabledSensorIds: ['webgl'] } });
    expect(mainJs(fake)).toEqual(['sensor-policy.js', 'sensor-off.webgl.js', 'hook.early.js']);
    const scope = await setSensor(bg, 'webgl', true);
    expect(scope.sensorSettings.sensors[1]).toEqual({ sensorId: 'webgl', enabled: false, disabledBy: ['organization'] });
    expect(scope.sensorSettings.organizationPolicy).toBe('applied');
    expect(scope.managed).toBe(false);
    fake.managed.data.set('DisabledSensorIds', ['webgl', 'audio', 'nope']);
    bg.policy.onManagedChanged();
    await settle(10);
    await bg.runtime.onManagedPolicyChanged();
    expect(mainJs(fake)).toEqual(['sensor-policy.js', 'sensor-off.webgl.js', 'sensor-off.audio.js', 'hook.early.js']);
    expect(bg.runtime.scopeState().sensorSettings).toMatchObject({ organizationPolicy: 'applied', rejectedPolicyEntries: 1 });
    fake.managed.data.set('DisabledSensorIds', 'audio');
    await bg.runtime.onManagedPolicyChanged();
    expect(bg.runtime.scopeState().sensorSettings.organizationPolicy).toBe('last-known-good');
    expect(mainJs(fake)).toEqual(['sensor-policy.js', 'sensor-off.webgl.js', 'sensor-off.audio.js', 'hook.early.js']);
    fake.managed.data.clear();
    await bg.runtime.onManagedPolicyChanged();
    expect(bg.runtime.scopeState().sensorSettings.organizationPolicy).toBe('absent');
    expect(mainJs(fake)).toEqual(['sensor-policy.js', 'hook.early.js']);
    expect(fake.local.data.has(POLICY_LKG_KEY)).toBe(false);
    expect([...fake.local.data.keys()].sort()).toEqual(['scope', 'sensors']);
  });

  it('F162 exception: every family disabled and no sensor batch -> partial, not no-access', async () => {
    const { bg } = await setup();
    for (const id of ALL) await setSensor(bg, id, false);
    bg.navigation.onCommitted(committed());
    const p = await projection(bg);
    expect(p.coverageState).toBe('partial');
    expect(p.coverageFlags).toContain('sensor-disabled');
    expect(p.coverageFlags).not.toContain('no-host-permission');
    expect(p.disabledSensors?.map((d) => d.sensorId)).toEqual([...ALL]);
    // One family enabled again for the next document: F162 applies again (nothing injected yet).
    await setSensor(bg, 'canvas', true);
    bg.navigation.onCommitted(committed({ documentId: D2 }));
    expect((await projection(bg)).coverageState).toBe('no-access');
  });

  it('ui-inject-now injects the prelude with the disabled families; injection:late is exact', async () => {
    const { fake, bg } = await setup({ site: false });
    await setSensor(bg, 'geometry', false);
    bg.navigation.onCommitted(committed());
    fake.framesByTab.set(7, [committed()]);
    expect(await send(bg, { schemaVersion: 1, type: 'ui-inject-now', tabId: 7 }, uiSender())).toMatchObject({ type: 'ok' });
    expect(fake.executeScriptCalls.find((c) => c.world === 'MAIN')?.files).toEqual(['sensor-policy.js', 'sensor-off.geometry.js', 'hook.main.js']);
    const p = await projection(bg);
    expect(p.disabledSensors).toEqual([{ sensorId: 'geometry', disabledBy: ['user'], hooksMayRemain: false }]);
    expect(p.coverageFlags).toEqual(expect.arrayContaining(['late-start', 'sensor-disabled']));
  });

  it('export carries the disabled ids only', async () => {
    const { bg } = await setup();
    bg.navigation.onCommitted(committed());
    await send(bg, batchOf(1), pageSender());
    await setSensor(bg, 'canvas', false);
    const p = await projection(bg);
    const r = await send(bg, { schemaVersion: 1, type: 'ui-export-preview', tabId: 7, documentKey: p.documentKey, reportRevision: p.reportRevision }, uiSender());
    expect(r.type === 'export-preview' && r.preview.report.disabledSensors).toEqual(['canvas']);
    expect(JSON.stringify(r)).not.toContain('organization');
    expect(JSON.stringify(r)).not.toContain('hooksMayRemain');
  });

  it('restart: stored choice registers the prelude at startup and reaches hydrated documents; stored lists are sanitized', async () => {
    const { fake, bg } = await setup();
    bg.navigation.onCommitted(committed());
    await send(bg, batchOf(1), pageSender());
    await settle(10);
    bg.runtime.stop();
    // Tamper with the stored meta: unknown ids and a hooksMayRemain entry outside sensorsOff.
    const stored = fake.session.data.get('doc:' + KEY1) as { meta: Record<string, unknown> };
    stored.meta['sensorsOff'] = ['webgl', 'bogus', 'webgl'];
    stored.meta['sensorsHooksMayRemain'] = ['audio', 'webgl'];
    fake.local.data.set(SENSOR_PREFS_KEY, { v: 1, disabled: ['canvas'] });
    fake.tabList = [{ id: 7 }];
    fake.framesByTab.set(7, [committed()]);
    const clock = { t: 1_000_500, now() { return this.t; } };
    const restarted = createBackground(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
    await restarted.start();
    expect(fake.registered.get(MAIN_SCRIPT_ID)?.js).toEqual(['sensor-policy.js', 'sensor-off.canvas.js', 'hook.early.js']);
    const meta = restarted.runtime.state.metas.get(KEY1);
    expect(meta?.sensorsOff).toEqual(['canvas', 'webgl']);
    expect(meta?.sensorsHooksMayRemain).toEqual(['canvas', 'webgl']);
    const p = await projection(restarted);
    expect(p.disabledSensors).toEqual([
      { sensorId: 'canvas', disabledBy: ['user'], hooksMayRemain: true },
      { sensorId: 'webgl', disabledBy: [], hooksMayRemain: true },
    ]);
  });
});

describe('PT-1: a family disabled while the document had no access is not stored once access returns (ADR-019)', () => {
  const EXAMPLE = ['http://example.com/*', 'https://example.com/*'];

  /** Site mode on example.com, document D1 open with every family hooked, no sensor batch yet (sensorSeen=false). */
  async function openQuiet(liveFrames: boolean): Promise<{ fake: FakeChrome; bg: Background }> {
    const s = await setup({ grantedOrigins: EXAMPLE });
    if (liveFrames) {
      s.fake.tabList = [{ id: 7 }];
      s.fake.framesByTab.set(7, [committed()]);
    }
    s.bg.navigation.onCommitted(committed());
    expect(s.bg.runtime.state.metas.get(KEY1)?.sensorSeen).toBe(false);
    return s;
  }

  async function removeDisableReadd(s: { fake: FakeChrome; bg: Background }): Promise<void> {
    expect(await send(s.bg, { schemaVersion: 1, type: 'ui-remove-site', host: 'example.com' }, uiSender())).toMatchObject({ type: 'scope', scope: { scopeMode: 'off' } });
    // Nothing to purge (no batch, no network data): no-host-permission only, not revoked.
    expect(s.bg.runtime.state.metas.get(KEY1)).toMatchObject({ accessGranted: false, revoked: false });
    await setSensor(s.bg, 'canvas', false);
    expect(s.bg.runtime.state.metas.get(KEY1)?.sensorsOff).toBeUndefined(); // skipped: no access at that moment
    expect(await send(s.bg, { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: 'example.com' }, uiSender())).toMatchObject({ type: 'scope', scope: { scopeMode: 'site' } });
  }

  async function expectCanvasDropped(s: { fake: FakeChrome; bg: Background }): Promise<void> {
    // The page calls canvas through the hooks installed at load; the still-running bridge delivers DET-001.
    const ack = await send(s.bg, batchOf(1, [obs({ count: 3 }), obs({ techniqueId: 'DET-005', phase: 'returned-sync', count: 2 })]), pageSender());
    expect(ack).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 1, protocolOk: true });
    const meta = s.bg.runtime.state.metas.get(KEY1);
    expect(meta?.sensorsOff).toEqual(['canvas']);
    expect(meta?.sensorsHooksMayRemain).toEqual(['canvas']);
    expect(s.bg.runtime.state.reports.get(KEY1)?.counters.some((c) => c.techniqueId === 'DET-001')).toBe(false);
    // By key: without a live frame the tab projection was dropped by reconcile, the report itself remains.
    const p = s.bg.runtime.projectionByKey(KEY1)!;
    expect(p.techniques.map((t) => t.techniqueId)).toEqual(['DET-005']);
    expect(p.coverageFlags).toContain('sensor-disabled');
    expect(p.coverageFlags).not.toContain('no-host-permission');
    expect(p.disabledSensors).toEqual([{ sensorId: 'canvas', disabledBy: ['user'], hooksMayRemain: true }]);
    await settle(10);
    const stored = s.fake.session.data.get('doc:' + KEY1) as { report: { counters: Array<{ techniqueId: string }>; coverageFlags: string[] } };
    expect(stored.report.counters.map((c) => c.techniqueId)).toEqual(['DET-005']);
    expect(stored.report.coverageFlags).not.toContain('no-host-permission');
    s.bg.runtime.stop();
  }

  it('remove-site -> disable canvas -> re-add -> batch: re-commit through reconcile applies the off set', async () => {
    const s = await openQuiet(true);
    await removeDisableReadd(s);
    expect(s.bg.runtime.state.metas.get(KEY1)?.accessGranted).toBe(true);
    expect(s.bg.runtime.state.reports.get(KEY1)?.coverageFlags).not.toContain('no-host-permission');
    await expectCanvasDropped(s);
  });

  it('same sequence when the frame is not re-committed: the scope:access re-grant in handleBatch applies the off set', async () => {
    const s = await openQuiet(false);
    await removeDisableReadd(s);
    // No live frame refreshed the document: it is still recorded without access until its next batch.
    expect(s.bg.runtime.state.metas.get(KEY1)?.accessGranted).toBe(false);
    await expectCanvasDropped(s);
  });
});

describe('reducer: sensors:disabled and stamps (ADR-019)', () => {
  function commit(state: DocumentsState, over: Partial<{ documentId: string; frameId: number; lifecycle: 'active' | 'prerender' | 'cached'; access: boolean; off: string[]; may: string[] }> = {}) {
    return reduce(state, {
      type: 'navigation:committed', tabId: 7, frameId: over.frameId ?? 0, documentId: over.documentId ?? D1, parentDocumentId: null,
      frameType: over.frameId ? 'sub_frame' : 'outermost_frame', documentLifecycle: over.lifecycle ?? 'active', host: 'example.com', scheme: 'https',
      accessGranted: over.access ?? true, at: 1,
      ...(over.off === undefined ? {} : { sensors: { off: over.off as never, hooksMayRemain: (over.may ?? []) as never } }),
    }, { deriveFindings: () => [] }).state;
  }

  it('new documents take the stamp; ungranted documents never get sensor state', () => {
    let s = commit(createInitialState(), { off: ['webgl', 'canvas'], may: ['canvas', 'audio'] });
    expect(s.metas.get(KEY1)?.sensorsOff).toEqual(['canvas', 'webgl']);
    expect(s.metas.get(KEY1)?.sensorsHooksMayRemain).toEqual(['canvas']);
    expect(s.reports.get(KEY1)?.coverageFlags).toContain('sensor-disabled');
    s = commit(createInitialState(), { off: ['canvas'], access: false });
    expect(s.metas.get(KEY1)?.sensorsOff).toBeUndefined();
    expect(s.reports.get(KEY1)?.coverageFlags).not.toContain('sensor-disabled');
  });

  it('applies to bound, BFCache and prerender documents with access; idempotent (no revision bump)', () => {
    let s = commit(createInitialState());
    s = commit(s, { documentId: D2, lifecycle: 'prerender' });
    const r1 = reduce(s, { type: 'sensors:disabled', ids: ['audio'], at: 2 }, { deriveFindings: () => [] });
    expect(r1.state.metas.get(KEY1)?.sensorsOff).toEqual(['audio']);
    expect(r1.state.metas.get(KEY1)?.sensorsHooksMayRemain).toEqual(['audio']);
    expect(r1.state.metas.get('7:0:' + D2)?.sensorsOff).toEqual(['audio']);
    const revision = r1.state.reports.get(KEY1)?.revision;
    const r2 = reduce(r1.state, { type: 'sensors:disabled', ids: ['audio'], at: 3 }, { deriveFindings: () => [] });
    expect(r2.state.reports.get(KEY1)?.revision).toBe(revision);
    expect(r2.effects).toEqual([]);
    // An unbound (navigated away) document is left alone.
    const navigated = commit(r2.state, { documentId: 'DOC000000000000000000000000000003' });
    const r3 = reduce(navigated, { type: 'sensors:disabled', ids: ['audio', 'webgl'], at: 4 }, { deriveFindings: () => [] });
    expect(r3.state.metas.get(KEY1)?.sensorsOff).toEqual(['audio']);
  });

  it('PT-1: access regained (scope:access or re-commit) adds only the missing families and drops no-host-permission', () => {
    const deps = { deriveFindings: () => [] };
    let s = commit(createInitialState(), { off: ['audio'], may: [] });
    s = reduce(s, { type: 'scope:access', documentKey: KEY1, host: null, accessGranted: false, at: 2 }, deps).state;
    expect(s.reports.get(KEY1)?.coverageFlags).toContain('no-host-permission');
    // Disabled while the document has no access: skipped.
    s = reduce(s, { type: 'sensors:disabled', ids: ['canvas', 'audio'], at: 3 }, deps).state;
    expect(s.metas.get(KEY1)?.sensorsOff).toEqual(['audio']);
    const regained = reduce(s, { type: 'scope:access', documentKey: KEY1, host: 'example.com', accessGranted: true, sensors: { off: ['canvas', 'audio'], hooksMayRemain: ['canvas', 'audio'] }, at: 4 }, deps).state;
    expect(regained.metas.get(KEY1)?.sensorsOff).toEqual(['canvas', 'audio']);
    // audio was already known not to have hooks; only the added canvas may.
    expect(regained.metas.get(KEY1)?.sensorsHooksMayRemain).toEqual(['canvas']);
    expect(regained.reports.get(KEY1)?.coverageFlags).not.toContain('no-host-permission');
    // Re-commit of the same document with access (existing-report branch): same result, conservative hooks.
    const recommitted = commit(s, { off: ['canvas', 'audio'], may: [] });
    expect(recommitted.metas.get(KEY1)?.sensorsOff).toEqual(['canvas', 'audio']);
    expect(recommitted.metas.get(KEY1)?.sensorsHooksMayRemain).toEqual(['canvas']);
    expect(recommitted.reports.get(KEY1)?.coverageFlags).not.toContain('no-host-permission');
    // A re-commit without access leaves the record alone.
    const stillDenied = commit(s, { off: ['canvas', 'audio'], access: false });
    expect(stillDenied.metas.get(KEY1)?.sensorsOff).toEqual(['audio']);
  });
});
