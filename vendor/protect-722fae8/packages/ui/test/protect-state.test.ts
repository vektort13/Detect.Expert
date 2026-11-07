// ADR-020 «Защита» (S06): view models of the module UI foundation, the protect-state parser and the typed senders.
import { afterEach, describe, expect, it } from 'vitest';
import { PROTECT_MODULE_STATES, PROTECT_UI_REQUEST_TYPES, UI_ERROR_CODES } from '@detect-expert/contracts';
import type { ProtectModuleState, ProtectProjection, ProtectState } from '@detect-expert/contracts';
import { PROTECT_RESPONSE_TYPES, parseProtectResponse, protectUi, requestProtectPermissions, sendProtectRequest } from '../src/messaging';
import { popupLayout } from '../src/view-models/popup';
import {
  PROTECT_COVERAGE_KEYS,
  PROTECT_DEFAULT_CONSENT_FEATURES,
  PROTECT_DISABLE_PURGE_DEFAULT,
  PROTECT_STATE_KEYS,
  consentView,
  featureChangePermissionRequest,
  initialConsentDraft,
  optionsHasProtectTabs,
  optionsHashForTab,
  optionsTabFromHash,
  parseProtectState,
  parseSiteInput,
  protectPermissionRequest,
  protectSectionView,
  protectStatusView,
  protectSurfaceVisible,
  toggleFeature,
} from '../src/view-models/protect';

function protectState(over: Partial<ProtectState> = {}): ProtectState {
  return {
    state: 'active',
    consentVersion: 1,
    requiredConsentVersion: 1,
    features: ['value-match', 'firewall', 'session-replay'],
    preset: 'normal',
    snoozedUntil: null,
    excludedSites: [],
    historyRetentionDays: 30,
    history: null,
    decisions: 0,
    permissions: { broadHosts: true, dnr: true },
    organizationDisabled: false,
    organizationPolicyInvalid: false,
    degradedReasons: [],
    ...over,
  };
}

const OFF: ProtectState = protectState({ state: 'off', consentVersion: null, features: [], permissions: { broadHosts: false, dnr: false } });
const NOW = 1_700_000_000_000;

function projection(over: Partial<ProtectProjection> = {}): ProtectProjection {
  return {
    protectRevision: 3,
    documentKey: '12:0:doc-a',
    site: 'example.com',
    moduleState: 'active',
    features: ['value-match'],
    coverageState: 'active',
    limitations: [],
    evidence: [],
    previousDocumentEvidence: 0,
    firewall: { enforcement: 'off' } as unknown as ProtectProjection['firewall'],
    replay: null,
    gpc: null,
    dropped: { evidence: 0, fingerprints: 0, bodies: 0, events: 0 },
    ...over,
  };
}

describe('protectSectionView: every module state', () => {
  const cases: Record<ProtectModuleState, { enable: boolean; controls: boolean; disable: boolean; tone: string }> = {
    off: { enable: true, controls: false, disable: false, tone: 'muted' },
    active: { enable: false, controls: true, disable: true, tone: 'neutral' },
    'needs-consent': { enable: true, controls: false, disable: true, tone: 'attention' },
    'needs-permission': { enable: true, controls: false, disable: true, tone: 'attention' },
    'organization-disabled': { enable: false, controls: false, disable: false, tone: 'muted' },
    degraded: { enable: false, controls: true, disable: true, tone: 'attention' },
  };
  for (const state of PROTECT_MODULE_STATES) {
    it(state, () => {
      const vm = protectSectionView(protectState({ state, degradedReasons: state === 'degraded' ? ['storage-unavailable', 'budget-exceeded'] : [] }), NOW);
      expect(vm.stateKey).toBe(PROTECT_STATE_KEYS[state]);
      expect({ enable: vm.enable, controls: vm.controls, disable: vm.disable, tone: vm.tone }).toEqual(cases[state]);
      if (state === 'degraded') {
        expect(vm.reasons).toEqual([{ key: 'protect_reason_storage_unavailable' }, { key: 'protect_reason_other', subs: ['budget-exceeded'] }]);
      } else expect(vm.reasons).toEqual([]);
    });
  }

  it('organization-disabled blocks enabling and explains the policy; purge stays available', () => {
    const vm = protectSectionView(protectState({ state: 'organization-disabled', organizationDisabled: true }), NOW);
    expect(vm.enable).toBe(false);
    expect(vm.notices).toEqual([{ key: 'protect_org_policy' }]);
    expect(vm.purge).toBe(true);
  });

  it('plain off without data: only enabling (no purge, no disable)', () => {
    const vm = protectSectionView(OFF, NOW);
    expect(vm).toMatchObject({ enable: true, controls: false, disable: false, purge: false, historyRecords: null });
  });

  it('snooze, history indicator, decisions and the excluded-site limit', () => {
    const sites = Array.from({ length: 256 }, (_, i) => 'site-' + String(i) + '.com');
    const vm = protectSectionView(protectState({ snoozedUntil: NOW + 60_000, history: { records: 12, truncated: false }, decisions: 4, excludedSites: sites }), NOW);
    expect(vm.snoozedUntil).toBe(NOW + 60_000);
    expect(vm.historyRecords).toBe(12);
    expect(vm.decisions).toBe(4);
    expect(vm.canAddSite).toBe(false);
    expect(protectSectionView(protectState({ snoozedUntil: NOW - 1 }), NOW).snoozedUntil).toBeNull();
  });

  it('purge is ticked by default on «Выключить»', () => {
    expect(PROTECT_DISABLE_PURGE_DEFAULT).toBe(true);
  });
});

describe('consent screen', () => {
  it('defaults: value-match, firewall, session-replay ticked; history and gpc not; normal; ack unticked', () => {
    expect(PROTECT_DEFAULT_CONSENT_FEATURES).toEqual(['value-match', 'firewall', 'session-replay']);
    expect(initialConsentDraft(null)).toEqual({ features: ['value-match', 'firewall', 'session-replay'], preset: 'normal', ack: false });
    expect(initialConsentDraft(OFF)).toEqual({ features: ['value-match', 'firewall', 'session-replay'], preset: 'normal', ack: false });
  });

  it('a renewed consent starts from the stored choice', () => {
    const state = protectState({ state: 'needs-consent', features: ['history', 'gpc'], preset: 'warn-only' });
    expect(initialConsentDraft(state)).toEqual({ features: ['history', 'gpc'], preset: 'warn-only', ack: false });
  });

  it('the confirm button is aria-disabled without ack and without a feature, with a visible reason', () => {
    expect(consentView({ features: ['value-match'], preset: 'normal', ack: false })).toMatchObject({ confirmDisabled: true, hintKey: 'protect_consent_ack_required' });
    expect(consentView({ features: [], preset: 'normal', ack: true })).toMatchObject({ confirmDisabled: true, hintKey: 'protect_consent_features_required' });
    expect(consentView({ features: ['value-match'], preset: 'normal', ack: true })).toMatchObject({ confirmDisabled: false, hintKey: null });
  });

  it('DNR is requested only with firewall or gpc; all sites always', () => {
    const all = ['http://*/*', 'https://*/*'];
    expect(protectPermissionRequest(['value-match', 'session-replay', 'history'])).toEqual({ origins: all, permissions: [] });
    expect(protectPermissionRequest(['firewall'])).toEqual({ origins: all, permissions: ['declarativeNetRequestWithHostAccess'] });
    expect(protectPermissionRequest(['gpc'])).toEqual({ origins: all, permissions: ['declarativeNetRequestWithHostAccess'] });
    expect(consentView({ features: ['value-match'], preset: 'normal', ack: true }).permissionRequest.permissions).toEqual([]);
  });

  it('turning on firewall or gpc later asks for DNR only when it is missing', () => {
    const noDnr = protectState({ features: ['value-match'], permissions: { broadHosts: true, dnr: false } });
    expect(featureChangePermissionRequest(noDnr, ['value-match', 'gpc'])?.permissions).toEqual(['declarativeNetRequestWithHostAccess']);
    expect(featureChangePermissionRequest(noDnr, ['value-match', 'history'])).toBeNull();
    expect(featureChangePermissionRequest(noDnr, [])).toBeNull();
    expect(featureChangePermissionRequest(protectState({ features: ['value-match'] }), ['value-match', 'firewall'])).toBeNull();
    expect(toggleFeature(['gpc', 'value-match'], 'firewall', true)).toEqual(['value-match', 'firewall', 'gpc']);
    expect(toggleFeature(['gpc', 'value-match'], 'gpc', false)).toEqual(['value-match']);
  });
});

describe('where the module UI appears', () => {
  it('popup / side panel: never while off; a policy-disabled module the user never accepted stays hidden', () => {
    expect(protectSurfaceVisible(null)).toBe(false);
    expect(protectSurfaceVisible(OFF)).toBe(false);
    for (const state of ['active', 'degraded', 'needs-consent', 'needs-permission'] as const) expect(protectSurfaceVisible(protectState({ state }))).toBe(true);
    expect(protectSurfaceVisible(protectState({ state: 'organization-disabled', consentVersion: null, features: [] }))).toBe(false);
    expect(protectSurfaceVisible(protectState({ state: 'organization-disabled' }))).toBe(true);
  });

  it('Options tabs: module not off, or stored decisions / history', () => {
    expect(optionsHasProtectTabs(null)).toBe(false);
    expect(optionsHasProtectTabs(OFF)).toBe(false);
    expect(optionsHasProtectTabs({ ...OFF, decisions: 1 })).toBe(true);
    expect(optionsHasProtectTabs({ ...OFF, history: { records: 2, truncated: false } })).toBe(true);
    expect(optionsHasProtectTabs({ ...OFF, history: { records: 0, truncated: false } })).toBe(false);
    expect(optionsHasProtectTabs(protectState({ state: 'organization-disabled' }))).toBe(true);
  });

  it('initial Options tab from the hash; switching rewrites it', () => {
    for (const hash of ['#protect', '#firewall', '#history', '#requests']) expect(optionsTabFromHash(hash)).toBe('protect');
    for (const hash of ['', '#', '#scope', '#protectx', 'protect-extra']) expect(optionsTabFromHash(hash)).toBe('observation');
    expect(optionsHashForTab('protect', '')).toBe('#protect');
    expect(optionsHashForTab('protect', '#firewall')).toBe('#firewall');
    expect(optionsHashForTab('observation', '#firewall')).toBe('');
  });

  it('popupLayout without the argument equals the previous layout; with the area it comes first', () => {
    expect(popupLayout('site', 'active', true)).toEqual({ sections: ['coverage', 'counts', 'findings', 'vendors', 'actions', 'scope'], scope: { open: false } });
    expect(popupLayout('site', 'active', true, null)).toEqual(popupLayout('site', 'active', true));
    expect(popupLayout('off', null, false, 'area')).toEqual({ sections: ['protect', 'coverage', 'scope'], scope: { open: true } });
    expect(popupLayout('site', 'active', true, 'area').sections[0]).toBe('protect');
  });

  it('status line: state always, coverage only while the module runs and a projection exists', () => {
    expect(protectStatusView(protectState(), null)).toEqual({ state: { key: 'protect_status_line', subs: [{ key: 'protect_state_active' }] }, coverage: null, tone: 'neutral' });
    // S09 follow-up: «сайт исключён» only with the site-excluded limitation; otherwise the module is suspended there.
    expect(protectStatusView(protectState(), projection({ coverageState: 'paused', limitations: ['site-excluded'] })).coverage).toEqual({ key: 'protect_coverage_line', subs: [{ key: 'protect_coverage_paused' }] });
    expect(protectStatusView(protectState(), projection({ coverageState: 'paused' })).coverage).toEqual({ key: 'protect_coverage_line', subs: [{ key: 'protect_coverage_suspended' }] });
    expect(protectStatusView(protectState({ state: 'needs-permission' }), projection()).coverage).toBeNull();
    expect(Object.keys(PROTECT_COVERAGE_KEYS).length).toBe(7);
  });

  it('excluded-site input → sanitized host', () => {
    expect(parseSiteInput('bank.example')).toBe('bank.example');
    expect(parseSiteInput('  https://Shop.Example.com/path?q=1 ')).toBe('shop.example.com');
    expect(parseSiteInput('')).toBeNull();
    expect(parseSiteInput('two words')).toBeNull();
    expect(parseSiteInput('*.example.com')).toBeNull();
    expect(parseSiteInput('x'.repeat(3000))).toBeNull();
  });
});

describe('parseProtectState', () => {
  it('accepts the contract shape and normalizes order', () => {
    // PROTECT_LIMITATIONS order: blocking-unavailable (firewall) precedes storage-unavailable (history).
    const parsed = parseProtectState({ ...protectState(), features: ['session-replay', 'value-match'], degradedReasons: ['storage-unavailable', 'blocking-unavailable'] });
    expect(parsed?.features).toEqual(['value-match', 'session-replay']);
    expect(parsed?.degradedReasons).toEqual(['blocking-unavailable', 'storage-unavailable']);
  });

  it('rejects unknown keys, enums, unbounded arrays and wrong types (null = unavailable, never «off»)', () => {
    const base = protectState() as unknown as Record<string, unknown>;
    const broken: Array<Record<string, unknown>> = [
      { ...base, extra: 1 },
      { ...base, state: 'on' },
      { ...base, features: ['value-match', 'canary'] },
      { ...base, preset: 'standard' },
      { ...base, excludedSites: ['https://example.com/'] },
      { ...base, excludedSites: Array.from({ length: 257 }, (_, i) => 's' + String(i) + '.com') },
      { ...base, history: { records: -1, truncated: false } },
      { ...base, decisions: 1.5 },
      { ...base, permissions: { broadHosts: 'yes', dnr: true } },
      { ...base, degradedReasons: ['not-a-limitation'] },
      { ...base, snoozedUntil: 'soon' },
      { ...base, historyRetentionDays: 14 },
    ];
    for (const value of broken) expect(parseProtectState(value)).toBeNull();
    expect(parseProtectState(null)).toBeNull();
    expect(parseProtectState([])).toBeNull();
  });
});

describe('typed senders (messaging)', () => {
  const g = globalThis as { chrome?: unknown };
  const before = g.chrome;
  afterEach(() => {
    g.chrome = before;
  });

  it('one sender per ui-protect-* type and an expected answer for each', () => {
    expect(Object.keys(protectUi)).toHaveLength(22);
    expect(Object.keys(PROTECT_RESPONSE_TYPES).sort()).toEqual([...PROTECT_UI_REQUEST_TYPES].sort());
  });

  it('answers are read defensively', () => {
    const state = protectState();
    expect(parseProtectResponse('ui-protect-get-state', { schemaVersion: 1, type: 'protect-state', state })).toEqual({ ok: true, response: { schemaVersion: 1, type: 'protect-state', state } });
    expect(parseProtectResponse('ui-protect-get-state', { schemaVersion: 1, type: 'ok', reportRevision: null })).toEqual({ ok: false, code: 'unavailable' });
    expect(parseProtectResponse('ui-protect-get-state', { schemaVersion: 1, type: 'protect-state', state: { ...state, state: 'x' } })).toEqual({ ok: false, code: 'unavailable' });
    expect(parseProtectResponse('ui-protect-get-state', { schemaVersion: 2, type: 'protect-state', state })).toEqual({ ok: false, code: 'unavailable' });
    for (const code of UI_ERROR_CODES) expect(parseProtectResponse('ui-protect-enable', { schemaVersion: 1, type: 'error', code })).toEqual({ ok: false, code });
    expect(parseProtectResponse('ui-protect-enable', { schemaVersion: 1, type: 'error', code: 'made-up' })).toEqual({ ok: false, code: 'unavailable' });
    expect(parseProtectResponse('ui-protect-get-report', { schemaVersion: 1, type: 'protect-report', report: null })).toMatchObject({ ok: true });
    expect(parseProtectResponse('ui-protect-get-report', { schemaVersion: 1, type: 'protect-report', report: projection() })).toMatchObject({ ok: true });
    expect(parseProtectResponse('ui-protect-get-report', { schemaVersion: 1, type: 'protect-report', report: { ...projection(), moduleState: 'x' } })).toEqual({ ok: false, code: 'unavailable' });
    expect(parseProtectResponse('ui-protect-get-report', { schemaVersion: 1, type: 'protect-state', state })).toEqual({ ok: false, code: 'unavailable' });
    expect(parseProtectResponse('ui-protect-list-rules', { schemaVersion: 1, type: 'protect-rules', total: 0, rows: [], preset: 'normal', stoppedDays: [] })).toMatchObject({ ok: true });
  });

  it('an invalid request never leaves the page; a thrown sendMessage is unavailable', async () => {
    const sent: unknown[] = [];
    g.chrome = { runtime: { sendMessage: async (m: unknown) => { sent.push(m); throw new Error('no receiver'); } } };
    expect(await protectUi.setSite('https://bad host', true)).toEqual({ ok: false, code: 'invalid-request' });
    expect(await sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-enable', consentVersion: 1, features: [], preset: 'normal' })).toEqual({ ok: false, code: 'invalid-request' });
    expect(sent).toEqual([]);
    expect(await protectUi.getState()).toEqual({ ok: false, code: 'unavailable' });
    expect(sent).toEqual([{ schemaVersion: 1, type: 'ui-protect-get-state' }]);
  });

  it('enable carries PROTECT_CONSENT_VERSION, the features and the mode', async () => {
    const sent: unknown[] = [];
    g.chrome = { runtime: { sendMessage: async (m: unknown) => { sent.push(m); return { schemaVersion: 1, type: 'protect-state', state: protectState() }; } } };
    expect(await protectUi.enable(['value-match', 'firewall'], 'normal')).toMatchObject({ ok: true });
    expect(sent).toEqual([{ schemaVersion: 1, type: 'ui-protect-enable', consentVersion: 1, features: ['value-match', 'firewall'], preset: 'normal' }]);
  });

  it('chrome.permissions.request is called synchronously (inside the gesture), before any await', async () => {
    const calls: unknown[] = [];
    g.chrome = { permissions: { request: (r: unknown) => { calls.push(r); return Promise.resolve(true); } } };
    const pending = requestProtectPermissions(protectPermissionRequest(['firewall']));
    expect(calls).toEqual([{ origins: ['http://*/*', 'https://*/*'], permissions: ['declarativeNetRequestWithHostAccess'] }]);
    expect(await pending).toBe(true);
    g.chrome = { permissions: { request: () => Promise.reject(new Error('not in gesture')) } };
    expect(await requestProtectPermissions(protectPermissionRequest(['value-match']))).toBe(false);
    g.chrome = {};
    expect(await requestProtectPermissions(protectPermissionRequest(['value-match']))).toBe(false);
  });
});
