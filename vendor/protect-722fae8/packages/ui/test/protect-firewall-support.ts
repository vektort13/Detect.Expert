// S09 test support (not a test file, never bundled): builders of the module state and the firewall projection used by
// the unit tests (packages/ui/test/protect-firewall*.test.ts), the Playwright fixture (tests/extension/protect/
// ui-fixture.ts) and the perf harness (tests/perf/protect/firewall-ui.test.ts). Synthetic domains only; no value,
// hash, URL or query anywhere (the contract has none).

import type {
  FirewallNotice,
  FirewallReceiverView,
  FirewallRuleRow,
  FirewallTabView,
  ProtectProjection,
  ProtectState,
  ProtectTransferEvidence,
} from '@detect-expert/contracts';

export const FW_SITE = 'shop.example';
export const FW_RECEIVER = 'collect.example.net';
export const FW_PROMPT_ID = '0123456789abcdef';
export const FW_UNDO_ID = 'fedcba9876543210';
export const FW_DOC_KEY = '12:0:DOC0000000000000000000000000012';

export function fwState(over: Partial<ProtectState> = {}): ProtectState {
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
    decisions: 3,
    permissions: { broadHosts: true, dnr: true },
    organizationDisabled: false,
    organizationPolicyInvalid: false,
    degradedReasons: [],
    ...over,
  };
}

export function fwReceiver(receiver: string = FW_RECEIVER, over: Partial<FirewallReceiverView> = {}): FirewallReceiverView {
  return {
    receiver,
    relation: 'cross-site',
    effectiveRule: null,
    delivery: { sent: 1, stopped: 0, stoppedOther: 0, unknown: 0 },
    countQuality: 'lower-bound',
    lastDelivery: 'sent',
    fieldKinds: ['email'],
    encodings: ['sha256-hex'],
    submitTiming: 'before-submit',
    sinceInput: '1-5s',
    sender: { frame: 'top', initiatorSite: FW_SITE, attributionConfidence: 'frame-only' },
    vendorConfidence: 'none',
    ...over,
  };
}

export function fwEvidence(receiver: string = FW_RECEIVER, over: Partial<ProtectTransferEvidence> = {}): ProtectTransferEvidence {
  return {
    evidenceId: 'pe-' + receiver.replace(/[^a-z0-9]/g, '').slice(0, 10),
    frameContext: 'top',
    attributionConfidence: 'frame-only',
    count: 1,
    countQuality: 'lower-bound',
    firstSecond: 3,
    lastSecond: 4,
    evidenceSource: 'derived',
    integrity: 'derived',
    ruleVersion: '1',
    limitationCodes: [],
    protectKind: 'value-match',
    ruleId: 'form-leak',
    transferClass: 'third-party-before-submit',
    fieldKind: 'email',
    fieldRef: 1,
    encodings: ['sha256-hex'],
    location: 'query',
    paramName: 'ud[em]',
    receiver,
    relation: 'cross-site',
    method: 'GET',
    requestKind: 'image',
    endpointHost: 'px.' + receiver,
    endpointPathTemplate: '/tr',
    initiatorSite: FW_SITE,
    submitTiming: 'before-submit',
    sinceInput: '1-5s',
    deliveryState: 'sent',
    interpretationConfidence: 'high',
    ...over,
  };
}

/**
 * Transfer records behind a receiver view, as the SW keeps them: one per field kind, with the view's delivery and
 * timing (the card's alert follows the delivery of these records, not `lastDelivery`; review round 2).
 */
export function fwEvidenceFor(view: FirewallReceiverView): ProtectTransferEvidence[] {
  const kinds = view.fieldKinds.length > 0 ? view.fieldKinds : (['email'] as const);
  return kinds.map((fieldKind, i) =>
    fwEvidence(view.receiver, {
      ...(i === 0 ? {} : { evidenceId: 'pe-' + view.receiver.replace(/[^a-z0-9]/g, '').slice(0, 10) + fieldKind.slice(0, 1) }),
      fieldKind,
      deliveryState: view.lastDelivery,
      submitTiming: view.submitTiming,
      ...(view.sinceInput === undefined ? {} : { sinceInput: view.sinceInput }),
    }),
  );
}

export interface FwProjectionOptions {
  receivers?: FirewallReceiverView[];
  /** Receivers of the prompt (default: every receiver view); null = no prompt. */
  prompt?: string[] | null;
  hidden?: number;
  firewall?: Partial<FirewallTabView>;
  notices?: FirewallNotice[];
  evidence?: ProtectTransferEvidence[];
  over?: Partial<ProtectProjection>;
}

export function fwProjection(options: FwProjectionOptions = {}): ProtectProjection {
  const receivers = options.receivers ?? [fwReceiver()];
  const promptReceivers = options.prompt === undefined ? receivers.map((r) => r.receiver) : options.prompt;
  const firewall: FirewallTabView = {
    enforcement: 'active',
    preset: 'normal',
    topDomainsSupported: true,
    stoppedToday: { count: 0, countQuality: 'lower-bound' },
    snoozedUntil: null,
    prompt: promptReceivers === null ? null : { promptId: FW_PROMPT_ID, site: FW_SITE, receivers: promptReceivers, hidden: options.hidden ?? 0 },
    receivers,
    notices: options.notices ?? [],
    onceRules: [],
    ...options.firewall,
  };
  return {
    protectRevision: 5,
    documentKey: FW_DOC_KEY,
    site: FW_SITE,
    moduleState: 'active',
    features: ['value-match', 'firewall', 'session-replay'],
    coverageState: 'active',
    limitations: [],
    evidence: options.evidence ?? receivers.flatMap(fwEvidenceFor),
    previousDocumentEvidence: 0,
    firewall,
    replay: null,
    gpc: null,
    dropped: { evidence: 0, fingerprints: 0, bodies: 0, events: 0 },
    ...options.over,
  };
}

/** A receiver blocked by an earlier rule whose latest request Chrome reported stopped (ADR-020 §11). */
export function fwStoppedReceiver(receiver: string = FW_RECEIVER): FirewallReceiverView {
  return fwReceiver(receiver, {
    effectiveRule: { action: 'block', scope: 'site', origin: 'user' },
    delivery: { sent: 1, stopped: 3, stoppedOther: 0, unknown: 0 },
    lastDelivery: 'stopped',
  });
}

export const FW_MULTI = ['collect.example.net', 'pixel.example.org', 'beacon.example.com'] as const;

/** Scenario names of the popup screens (S09 brief). */
export const FW_SCREENS = [
  'sent',
  'stopped',
  'unknown',
  'multi',
  'evidence-open',
  'resolved-blocked',
  'resolved-allowed',
  'resolved-error',
  'warn-only',
  'snoozed',
] as const;
export type FwScreen = (typeof FW_SCREENS)[number];

export interface FwScenario {
  state: ProtectState;
  report: ProtectProjection;
  /** Answer of ui-protect-decide for the resolved screens. */
  decide: { applied: Array<{ receiver: string; ruleApplied: boolean }>; undoId: string | null } | null;
  /** The action the screen clicks to reach its outcome. */
  click: 'block' | 'allow' | null;
}

export function fwScenario(screen: FwScreen, now = Date.UTC(2026, 9, 18, 10, 0, 0)): FwScenario {
  const base = { state: fwState(), decide: null, click: null } as const;
  switch (screen) {
    case 'sent':
    case 'evidence-open':
      return { ...base, report: fwProjection({ firewall: { stoppedToday: { count: 3, countQuality: 'lower-bound' } } }) };
    case 'stopped':
      return { ...base, report: fwProjection({ receivers: [fwStoppedReceiver()], firewall: { stoppedToday: { count: 3, countQuality: 'lower-bound' } } }) };
    case 'unknown':
      return { ...base, report: fwProjection({ receivers: [fwReceiver(FW_RECEIVER, { lastDelivery: 'unknown', delivery: { sent: 0, stopped: 0, stoppedOther: 0, unknown: 1 }, submitTiming: 'unknown' })] }) };
    case 'multi':
      return {
        ...base,
        report: fwProjection({
          receivers: [fwReceiver(FW_MULTI[0]), fwStoppedReceiver(FW_MULTI[1]), fwReceiver(FW_MULTI[2], { lastDelivery: 'unknown', fieldKinds: ['email', 'phone'] })],
          hidden: 2,
        }),
      };
    case 'resolved-blocked':
      return { ...base, report: fwProjection(), decide: { applied: [{ receiver: FW_RECEIVER, ruleApplied: true }], undoId: FW_UNDO_ID }, click: 'block' };
    case 'resolved-allowed':
      return { ...base, report: fwProjection(), decide: { applied: [{ receiver: FW_RECEIVER, ruleApplied: true }], undoId: FW_UNDO_ID }, click: 'allow' };
    case 'resolved-error':
      return {
        state: fwState({ state: 'degraded', degradedReasons: ['blocking-unavailable'] }),
        report: fwProjection({ firewall: { enforcement: 'degraded', degradedCode: 'api-unavailable' }, over: { moduleState: 'degraded' } }),
        decide: { applied: [{ receiver: FW_RECEIVER, ruleApplied: false }], undoId: FW_UNDO_ID },
        click: 'block',
      };
    case 'warn-only':
      return { ...base, state: fwState({ preset: 'warn-only' }), report: fwProjection({ firewall: { enforcement: 'warn-only', preset: 'warn-only' } }) };
    case 'snoozed':
      return {
        ...base,
        state: fwState({ snoozedUntil: now + 3_600_000 }),
        report: fwProjection({ prompt: null, firewall: { snoozedUntil: now + 3_600_000 } }),
      };
  }
}

/** Stored rule rows of the Options list. */
export function fwRuleRows(n: number): FirewallRuleRow[] {
  return Array.from({ length: n }, (_, i) => {
    const everywhere = i % 3 === 2;
    const receiver = 'rcv' + String(i) + '.example.net';
    return {
      ruleKey: (everywhere ? 'everywhere:*>' : 'site:site' + String(i % 7) + '.example>') + receiver,
      receiver,
      site: everywhere ? null : 'site' + String(i % 7) + '.example',
      scope: everywhere ? 'everywhere' : 'site',
      action: i % 4 === 3 ? 'allow' : 'block',
      origin: i % 5 === 4 ? 'preset' : 'user',
      createdDay: '2026-10-' + String(10 + (i % 9)).padStart(2, '0'),
      active: i % 6 !== 5,
      ...(i % 6 === 5 ? { inactiveReason: 'rule-limit' as const } : {}),
      stopped: i,
      bypass: 0,
    };
  });
}
