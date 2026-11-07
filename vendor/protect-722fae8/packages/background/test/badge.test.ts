// S12 / E13-03: per-tab toolbar badge — colours, coalescing, bounds, forget, API failure without retry, no action,
// and the runtime integration (canvas positive -> '1', ui-clear -> '', scope off).

import type { Ack, PageBatch, PageObservation, ReportProjection, ScopeMode, UiResponse } from '@detect-expert/contracts';
import { coverageRef, runRules } from '@detect-expert/engine';
import { describe, expect, it } from 'vitest';
import { BADGE_COLOR, BADGE_FLUSH_MS, BADGE_MAX_TABS_PER_FLUSH, BADGE_TEXT_COLOR, BadgeController, createBackground } from '../src/index';
import { BADGE_FIREWALL_COLOR, BADGE_SETTLE_MS } from '../src/badge';
import type { Background, BadgeInput, EnginePort, MessageSenderLike } from '../src/index';
import { FakeAction, committed, createFakeChrome, createFakeI18n, pageSender, settle, uiSender } from './fake-chrome';
import { MemoryProtectDb } from './protect/memory-db';
import { ALL_SITES, DNR_PERMISSION, defaultServices, optionsSender, recordingService } from './protect/support';

const D1 = 'DOC000000000000000000000000000001';
const KEY1 = '7:0:' + D1;

function fpProjection(tabId: number, over: Partial<ReportProjection> = {}): ReportProjection {
  const base: ReportProjection = {
    reportRevision: 1, documentKey: String(tabId) + ':0:DOC', host: null, coverageState: 'active', coverageFlags: [], techniques: [],
    findings: [{ findingId: 'f', ruleId: 'r', ruleVersion: '1', techniqueId: 'DET-002', interpretation: 'possible-fingerprinting', interpretationConfidence: 'low',
      evidenceIds: ['e'], counterEvidenceCodes: [], limitationCodes: [], vendorMatchIds: [] }],
    vendors: [], hosts: [], catalogVersion: null, scopeMode: 'site',
    dropped: { observations: 0, batches: 0, findings: 0, hosts: 0, counters: 0, transport: 0 },
    observedSince: null,
  };
  return { ...base, ...over };
}

function controller(action: FakeAction | undefined, read: (tabId: number) => BadgeInput, tabs: number[] = []) {
  const i18n = createFakeI18n('en');
  const api = action === undefined ? { i18n } : { action, i18n };
  return { badge: new BadgeController(api, read, async () => tabs), i18n };
}

describe('BadgeController (E13-03)', () => {
  it('start sets the neutral colours once, then marks every open tab; setBadgeTextColor only when present', async () => {
    const action = new FakeAction();
    const { badge } = controller(action, (tabId) => ({ report: fpProjection(tabId), scopeMode: 'site' }), [3, 4]);
    badge.start();
    await settle();
    expect(action.backgroundColor).toBe(BADGE_COLOR);
    expect(action.textColor).toBe(BADGE_TEXT_COLOR);
    await badge.flush();
    expect(action.text.get(3)).toBe('1');
    expect(action.text.get(4)).toBe('1');
    expect(action.title.get(3)).toBe('Categories with findings: 1');
    badge.stop();

    const old = new FakeAction(false);
    const second = controller(old, () => ({ report: null, scopeMode: 'off' }));
    second.badge.start();
    await settle();
    expect(old.backgroundColor).toBe(BADGE_COLOR);
    expect(old.count('setBadgeTextColor')).toBe(0);
    second.badge.stop();
  });

  it('coalesces repeated marks, skips unchanged state and applies at most 64 tabs per pass', async () => {
    const action = new FakeAction();
    const { badge } = controller(action, (tabId) => ({ report: fpProjection(tabId), scopeMode: 'all-sites' }));
    for (let i = 0; i < 5; i++) badge.markTab(1);
    badge.markDocument('1:0:DOC');
    await badge.flush();
    expect(action.count('setBadgeText')).toBe(1);
    expect(action.count('setTitle')).toBe(1);
    badge.markTab(1);
    await badge.flush();
    expect(action.count('setBadgeText')).toBe(1); // same text + title: no API call

    for (let tab = 100; tab < 200; tab++) badge.markTab(tab);
    await badge.flush();
    expect(action.count('setBadgeText')).toBe(1 + BADGE_MAX_TABS_PER_FLUSH);
    await badge.flush();
    expect(action.count('setBadgeText')).toBe(1 + 100);
    // Untrusted keys and negative ids are ignored.
    badge.markDocument('x:0:DOC');
    badge.markDocument('-1:0:DOC');
    badge.markDocument('nokey');
    badge.markTab(-1);
    badge.markTab(1.5);
    await badge.flush();
    expect(action.count('setBadgeText')).toBe(101);
    badge.stop();
  });

  it('forget drops the applied state; an API failure is not retried and the next change applies again', async () => {
    const action = new FakeAction();
    let scopeMode: ScopeMode = 'site';
    const { badge } = controller(action, (tabId) => ({ report: fpProjection(tabId, { coverageState: 'paused' }), scopeMode }));
    badge.markTab(9);
    await badge.flush();
    expect(action.text.get(9)).toBe('1');
    expect(action.title.get(9)).toBe('Categories with findings before the pause: 1. Observation is paused.');
    badge.forget(9);
    badge.markTab(9);
    await badge.flush();
    expect(action.count('setBadgeText')).toBe(2); // forgotten -> applied again

    scopeMode = 'off';
    action.failNext = 2;
    badge.markTab(9);
    await badge.flush();
    expect(action.count('setBadgeText')).toBe(3);
    await badge.flush();
    await settle(300);
    expect(action.count('setBadgeText')).toBe(3); // no retry
    badge.markTab(9);
    await badge.flush();
    expect(action.count('setBadgeText')).toBe(4);
    expect(action.text.get(9)).toBe('');
    expect(action.title.get(9)).toBe('Observation is off.');
    badge.stop();
  });

  it('without chrome.action every method is a no-op; without i18n the key is the tooltip', async () => {
    const reads: number[] = [];
    const { badge } = controller(undefined, (tabId) => { reads.push(tabId); return { report: null, scopeMode: 'site' }; }, [1]);
    badge.start();
    badge.markTab(1);
    badge.markDocument('1:0:D');
    badge.markAll();
    await badge.flush();
    badge.forget(1);
    badge.stop();
    expect(reads).toEqual([]);

    const action = new FakeAction();
    const bare = new BadgeController({ action }, () => ({ report: null, scopeMode: 'site' }), async () => []);
    bare.markTab(2);
    await bare.flush();
    expect(action.title.get(2)).toBe('actionTitle');
    expect(action.text.get(2)).toBe('');
    bare.stop();
  });

  it('nested status keys are resolved through chrome.i18n; an unknown message falls back to its key', async () => {
    const action = new FakeAction();
    const { badge } = controller(action, (tabId) => ({ report: fpProjection(tabId, { coverageState: 'late-start', coverageFlags: ['late-start'] }), scopeMode: 'active-tab' }));
    badge.markTab(4);
    await badge.flush();
    expect(action.text.get(4)).toBe('1');
    expect(action.title.get(4)).toBe('Categories with findings: 1 (observation: late start; some calls may have been missed)');
    badge.stop();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Runtime integration (same engine wiring as apps/extension/entrypoints/background.ts).
// ---------------------------------------------------------------------------------------------------------------

const engine: EnginePort = {
  deriveFindings(report) {
    return runRules({
      counters: report.counters,
      coverageFlags: report.coverageFlags,
      coverageRef: coverageRef(report.coverageState, report.coverageFlags),
      network: { counters: report.networkCounters, patterns: report.networkPatterns },
    }).findings;
  },
};

function obs(over: Partial<PageObservation>): PageObservation {
  return { techniqueId: 'DET-002', count: 1, countQuality: 'exact', phase: 'returned-sync', signalCodes: ['api-use'], intervalBucket: 1, ...over };
}

const FP_OBSERVATIONS: PageObservation[] = [
  obs({ techniqueId: 'DET-003', count: 6, signalCodes: ['api-use', 'text-drawn'] }),
  obs({ techniqueId: 'DET-002', count: 2, signalCodes: ['api-use', 'readback-after-text'] }),
];

function batchOf(batchSeq: number, observations: PageObservation[], bridgeSessionId = 'bridge-1'): PageBatch {
  return { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'boot-1', bridgeSessionId, batchSeq, observations, coverageDelta: [] };
}

function send(bg: Background, message: unknown, sender: MessageSenderLike): Promise<Ack | UiResponse> {
  return new Promise((resolve) => {
    bg.onMessage(message, sender, resolve);
  });
}

describe('runtime badge integration (E13-03)', () => {
  it('canvas positive -> "1"; ui-clear -> ""; scope off -> "" with the off tooltip; closed tab forgotten', async () => {
    const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*'], action: true });
    fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
    fake.tabList = [{ id: 7 }, { id: 8 }];
    fake.framesByTab.set(7, [{ frameId: 0, url: 'https://example.com/path', documentId: D1, frameType: 'outermost_frame', documentLifecycle: 'active' }]);
    fake.framesByTab.set(8, []);
    const bg = createBackground(fake, { engine, ttlIntervalMs: 0, persistDebounceMs: 1, clock: { now: () => 1_000_000 } });
    fake.events.onCommitted.addListener(bg.navigation.onCommitted);
    fake.events.tabRemoved.addListener(bg.navigation.onTabRemoved);
    await bg.start();
    const action = fake.badgeAction!;
    await settle();
    expect(action.backgroundColor).toBe(BADGE_COLOR);
    fake.events.onCommitted.emit(committed());

    expect(await send(bg, batchOf(1, FP_OBSERVATIONS), pageSender())).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 1 });
    await bg.runtime.badge.flush();
    expect(action.text.get(7)).toBe('1');
    // Site mode is network-limited (ADR-018 variant A): partial, so the tooltip names the limitation.
    expect(action.title.get(7)).toBe('Categories with findings: 1 (observation: partial; some calls may have been missed)');
    expect(action.title.get(7)).not.toMatch(/danger|threat|risk|unsafe|malicious/i);

    const revision = bg.runtime.getProjection(7)!.reportRevision;
    expect(await send(bg, { schemaVersion: 1, type: 'ui-clear', tabId: 7, documentKey: KEY1, reportRevision: revision }, uiSender())).toMatchObject({ type: 'ok' });
    await bg.runtime.badge.flush();
    expect(action.text.get(7)).toBe('');
    expect(action.title.get(7)).toBe('Checks on this page — detect.expert');

    expect(await send(bg, batchOf(2, FP_OBSERVATIONS, 'bridge-2'), pageSender())).toMatchObject({ type: 'ack' });
    await bg.runtime.badge.flush();
    expect(action.text.get(7)).toBe('1');

    expect(await send(bg, { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'off' }, uiSender())).toMatchObject({ type: 'scope' });
    await settle();
    await bg.runtime.badge.flush();
    expect(action.text.get(7)).toBe('');
    expect(action.title.get(7)).toBe('Access to this page was revoked: no new data is collected.');
    expect(action.text.get(8)).toBe('');
    expect(action.title.get(8)).toBe('Observation is off.');
    expect([...action.text.values()]).not.toContain('0');

    const before = action.count('setBadgeText');
    fake.events.tabRemoved.emit(7);
    await bg.runtime.badge.flush();
    expect(action.count('setBadgeText')).toBe(before);
    bg.runtime.stop();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// ADR-020 §D (S09): firewall prompts of the module «Защита» on the badge. Without prompts the calls are exactly the
// previous ones (no per-tab colour); with prompts '1'…'9' / '9+' on BADGE_FIREWALL_COLOR, reset once afterwards.
// ---------------------------------------------------------------------------------------------------------------

function perTabColours(action: FakeAction, tabId: number): string[] {
  return action.calls.filter((c) => c.method === 'setBadgeBackgroundColor' && c.details['tabId'] === tabId).map((c) => String(c.details['color']));
}

describe('BadgeController with firewall prompts (S09)', () => {
  it('protectPending absent or 0: the same calls as without the module, no per-tab colour', async () => {
    for (const pending of [undefined, 0] as const) {
      const action = new FakeAction();
      const { badge } = controller(action, (tabId) => ({ report: fpProjection(tabId), scopeMode: 'site', ...(pending === undefined ? {} : { protectPending: pending }) }));
      badge.markTab(5);
      await badge.flush();
      expect(action.calls.map((c) => c.method).sort()).toEqual(['setBadgeText', 'setTitle']);
      expect(action.text.get(5)).toBe('1');
      expect(action.title.get(5)).toBe('Categories with findings: 1');
      badge.stop();
    }
  });

  it('pending > 0: count on the firewall colour (once), 9+ above nine, reset to the neutral colour once afterwards', async () => {
    expect(BADGE_FIREWALL_COLOR).toBe('#2456B3');
    const action = new FakeAction();
    let pending = 2;
    const { badge } = controller(action, (tabId) => ({ report: fpProjection(tabId), scopeMode: 'site', protectPending: pending }));
    badge.markTab(5);
    await badge.flush();
    expect(action.text.get(5)).toBe('2');
    expect(action.title.get(5)).toBe('Firewall: destinations awaiting a decision — 2. Open the extension window to decide.');
    expect(perTabColours(action, 5)).toEqual([BADGE_FIREWALL_COLOR]);

    badge.markTab(5);
    await badge.flush();
    expect(action.count('setBadgeText')).toBe(1); // unchanged: no call

    pending = 12;
    badge.markTab(5);
    await badge.flush();
    expect(action.text.get(5)).toBe('9+');
    expect(action.title.get(5)).toBe('Firewall: destinations awaiting a decision — 12. Open the extension window to decide.');
    expect(perTabColours(action, 5)).toEqual([BADGE_FIREWALL_COLOR]); // colour already set

    pending = 0;
    badge.markTab(5);
    await badge.flush();
    expect(action.text.get(5)).toBe('1'); // the observation badge again
    expect(action.title.get(5)).toBe('Categories with findings: 1');
    expect(perTabColours(action, 5)).toEqual([BADGE_FIREWALL_COLOR, BADGE_COLOR]);

    badge.markTab(5);
    await badge.flush();
    expect(perTabColours(action, 5)).toEqual([BADGE_FIREWALL_COLOR, BADGE_COLOR]); // reset only once
    expect([...action.text.values()]).not.toContain('0');
    badge.stop();
  });

  it('a failed call is not claimed applied (applied again on the next mark); a closed tab is forgotten with its colour', async () => {
    const action = new FakeAction();
    const { badge } = controller(action, () => ({ report: null, scopeMode: 'off', protectPending: 1 }));
    action.failNext = 1;
    badge.markTab(6);
    await badge.flush();
    badge.markTab(6);
    await badge.flush();
    expect(action.text.get(6)).toBe('1');
    expect(perTabColours(action, 6)).toEqual([BADGE_FIREWALL_COLOR, BADGE_FIREWALL_COLOR]);
    badge.forget(6);
    badge.markTab(6);
    await badge.flush();
    expect(perTabColours(action, 6)).toHaveLength(3);
    badge.stop();
  });
});

describe('BadgeController.markTabSettled (S09)', () => {
  it('marks now and once more after BADGE_SETTLE_MS (a prompt added after an asynchronous step still shows)', async () => {
    const action = new FakeAction();
    let pending = 0;
    const { badge } = controller(action, () => ({ report: null, scopeMode: 'site', protectPending: pending }));
    badge.markTabSettled(3);
    badge.markTabSettled(3);
    await badge.flush();
    expect(action.text.get(3)).toBe('');
    pending = 1; // the lane settles later (strict preset: rule written first)
    await settle(BADGE_SETTLE_MS + BADGE_FLUSH_MS + 100);
    expect(action.text.get(3)).toBe('1');
    expect(action.count('setBadgeText')).toBe(2);
    badge.markTabSettled(4);
    badge.stop(); // no timer survives stop
    await settle(BADGE_SETTLE_MS + 100);
    expect(action.text.has(4)).toBe(false);
  });
});

describe('runtime firewall badge integration (S09)', () => {
  it('evidence opens a prompt -> "1" on the firewall colour; snooze -> previous badge; dismiss -> "" (colour reset once)', async () => {
    const fake = createFakeChrome({ grantedOrigins: ALL_SITES, permissions: [DNR_PERMISSION], action: true });
    fake.tabList = [{ id: 7 }, { id: 8 }];
    const pending = new Map<number, number>();
    const log: string[] = [];
    const firewall = recordingService('firewall', ['firewall'], log, {
      onEvent(event) {
        if (event.kind === 'evidence') pending.set(event.tabId, (pending.get(event.tabId) ?? 0) + 1);
      },
      handleUi(type) {
        if (type !== 'ui-protect-dismiss') return undefined;
        pending.delete(7);
        return { schemaVersion: 1, type: 'protect-decision', applied: [], undoId: null, report: null };
      },
    });
    const start = firewall.start.bind(firewall);
    firewall.start = (ctx) => {
      void start(ctx);
      ctx.ports.pendingCount = (tabId) => pending.get(tabId) ?? 0;
    };
    const services = defaultServices(log).map((s) => (s.name === 'firewall' ? firewall : s));
    const bg = createBackground(fake, { ttlIntervalMs: 0, persistDebounceMs: 1, protect: { dbFactory: () => new MemoryProtectDb(), services, dnrTimeoutMs: 50, docStore: { flushMs: 1 } } });
    fake.events.onCommitted.addListener(bg.navigation.onCommitted);
    await bg.start();
    await bg.runtime.protect.idle();
    const action = fake.badgeAction!;
    expect(await send(bg, { schemaVersion: 1, type: 'ui-protect-enable', consentVersion: 1, features: ['value-match', 'firewall'], preset: 'normal' }, optionsSender())).toMatchObject({ type: 'protect-state', state: { state: 'active' } });
    bg.navigation.onCommitted(committed({ url: 'https://www.shop-site.com/a' }));
    await settle(BADGE_FLUSH_MS + 50);
    expect(perTabColours(action, 7)).toEqual([]);

    bg.runtime.protect.eventBus.publish({ kind: 'evidence', documentKey: KEY1, tabId: 7, site: 'shop-site.com', evidence: {} as never });
    await settle(BADGE_FLUSH_MS + 50);
    expect(action.text.get(7)).toBe('1');
    expect(action.title.get(7)).toBe('Firewall: destinations awaiting a decision — 1. Open the extension window to decide.');
    expect(perTabColours(action, 7)).toEqual([BADGE_FIREWALL_COLOR]);
    expect(perTabColours(action, 8)).toEqual([]);

    expect(await send(bg, { schemaVersion: 1, type: 'ui-protect-snooze', minutes: 60 }, uiSender())).toMatchObject({ type: 'protect-state' });
    await settle(BADGE_FLUSH_MS + 50);
    expect(action.text.get(7)).toBe('');
    expect(perTabColours(action, 7)).toEqual([BADGE_FIREWALL_COLOR, BADGE_COLOR]);

    expect(await send(bg, { schemaVersion: 1, type: 'ui-protect-snooze', minutes: 0 }, uiSender())).toMatchObject({ type: 'protect-state' });
    await settle(BADGE_FLUSH_MS + 50);
    expect(action.text.get(7)).toBe('1');

    const dismiss = { schemaVersion: 1, type: 'ui-protect-dismiss', tabId: 7, documentKey: KEY1, protectRevision: 0, promptId: '0123456789abcdef' };
    expect(await send(bg, dismiss, uiSender())).toMatchObject({ type: 'protect-decision' });
    await settle(BADGE_FLUSH_MS + 50);
    expect(action.text.get(7)).toBe('');
    expect(perTabColours(action, 7)).toEqual([BADGE_FIREWALL_COLOR, BADGE_COLOR, BADGE_FIREWALL_COLOR, BADGE_COLOR]);
    expect([...action.text.values()]).not.toContain('0');
    bg.runtime.stop();
  });
});
