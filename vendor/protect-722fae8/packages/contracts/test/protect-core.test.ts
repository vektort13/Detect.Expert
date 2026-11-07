// ADR-020 «Защита» (S02): invariants of the module's names, budgets and DNR ranges.
import { describe, expect, it } from 'vitest';
import {
  COVERAGE_FLAGS,
  DNR_PRIORITIES,
  DNR_RANGE_NAMES,
  DNR_RULE_IDS,
  FIELD_KINDS,
  FINGERPRINT_ENCODINGS,
  HISTORY_FAMILIES,
  HISTORY_RETENTION_DAYS,
  NEVER_READ_CLASSES,
  PROTECT_BUDGETS,
  PROTECT_CONSENT_VERSION,
  PROTECT_DNR_FEATURES,
  PROTECT_FEATURES,
  PROTECT_MAIN_GROUPS,
  PROTECT_OPTIONS_ONLY_TYPES,
  PROTECT_UI_PREFIX,
  PROTECT_UI_REQUEST_TYPES,
  SENSOR_IDS,
  UI_ERROR_CODES,
  VALUE_ENCODINGS,
  dnrRangeOf,
  isDomainName,
  isSiteName,
  protectGroupBit,
} from '../src/index';

describe('ADR-020 core enums', () => {
  it('FIELD_KINDS never contains a password kind; never-read classes cover passwords, payment and one-time codes', () => {
    expect([...FIELD_KINDS]).toEqual(['email', 'phone', 'name']);
    for (const kind of FIELD_KINDS) expect(kind).not.toMatch(/pass|pwd|card|otp|code/i);
    expect([...NEVER_READ_CLASSES]).toEqual(['password', 'was-password', 'payment', 'one-time-code', 'credential-hint']);
  });

  it('UI_ERROR_CODES are only appended: the observation codes keep their indices', () => {
    expect(UI_ERROR_CODES.slice(0, 7)).toEqual([
      'invalid-request',
      'unauthorized-sender',
      'not-found',
      'stale-revision',
      'document-mismatch',
      'no-access',
      'not-implemented',
    ]);
    expect(UI_ERROR_CODES.slice(7)).toEqual([
      'module-disabled',
      'feature-disabled',
      'consent-required',
      'permission-required',
      'disabled-by-organization',
      'limit-reached',
      'storage-unavailable',
      'unsafe-receiver',
    ]);
    expect(new Set(UI_ERROR_CODES).size).toBe(UI_ERROR_CODES.length);
  });

  it('COVERAGE_FLAGS are unchanged: firewall-blocked is not introduced (SP-2), sensor-disabled stays bit 17', () => {
    expect(COVERAGE_FLAGS).toHaveLength(18);
    expect(COVERAGE_FLAGS.indexOf('sensor-disabled')).toBe(17);
    expect(COVERAGE_FLAGS as readonly string[]).not.toContain('firewall-blocked');
  });

  it('fingerprint encodings are VALUE_ENCODINGS without in-base64-container, same order', () => {
    expect([...FINGERPRINT_ENCODINGS]).toEqual(VALUE_ENCODINGS.filter((e) => e !== 'in-base64-container'));
  });

  it('features, DNR features and MAIN groups', () => {
    expect([...PROTECT_FEATURES]).toEqual(['value-match', 'firewall', 'session-replay', 'history', 'gpc']);
    expect([...PROTECT_DNR_FEATURES]).toEqual(['firewall', 'gpc']);
    expect(PROTECT_MAIN_GROUPS.map(protectGroupBit)).toEqual([1, 2]);
    expect(PROTECT_CONSENT_VERSION).toBe(1);
  });

  it('history families are the sensor families plus network-patterns; retention 7/30/90 (default 30)', () => {
    expect([...HISTORY_FAMILIES]).toEqual([...SENSOR_IDS, 'network-patterns']);
    expect([...HISTORY_RETENTION_DAYS]).toEqual([7, 30, 90]);
    expect(PROTECT_BUDGETS.defaultHistoryRetentionDays).toBe(30);
  });

  it('22 ui-protect-* types share one prefix; widening types are Options-only', () => {
    expect(PROTECT_UI_REQUEST_TYPES).toHaveLength(22);
    expect(new Set(PROTECT_UI_REQUEST_TYPES).size).toBe(22);
    for (const type of PROTECT_UI_REQUEST_TYPES) {
      expect(type.startsWith(PROTECT_UI_PREFIX)).toBe(true);
      expect(type.length).toBeLessThanOrEqual(32);
    }
    expect([...PROTECT_OPTIONS_ONLY_TYPES]).toEqual(['ui-protect-enable', 'ui-protect-set-settings']);
  });
});

describe('ADR-020 DNR ranges and priorities', () => {
  it('Sec-GPC (modifyHeaders) outranks every allow rule', () => {
    const allow = Math.max(DNR_PRIORITIES.receiverAllow, DNR_PRIORITIES.siteAllow, DNR_PRIORITIES.once);
    expect(DNR_PRIORITIES.gpc).toBeGreaterThan(allow);
    expect(DNR_PRIORITIES).toEqual({ receiverBlock: 10, presetBlock: 10, receiverAllow: 20, siteBlock: 30, siteAllow: 40, once: 50, gpc: 100 });
  });

  it('ranges are disjoint, ordered and sized to the module budgets', () => {
    expect(DNR_RULE_IDS).toEqual({ gpc: [1, 99], decisions: [100000, 100999], preset: [101000, 101023], session: [200000, 200127] });
    const size = (name: keyof typeof DNR_RULE_IDS): number => DNR_RULE_IDS[name][1] - DNR_RULE_IDS[name][0] + 1;
    expect(size('decisions')).toBe(PROTECT_BUDGETS.maxDecisions);
    expect(size('preset')).toBe(PROTECT_BUDGETS.maxPresetEntries);
    expect(size('session')).toBe(PROTECT_BUDGETS.maxSessionRules);
    expect(PROTECT_BUDGETS.maxDecisions + PROTECT_BUDGETS.maxPresetEntries).toBeLessThanOrEqual(PROTECT_BUDGETS.maxDynamicRules);
    for (let i = 1; i < DNR_RANGE_NAMES.length; i++) {
      expect(DNR_RULE_IDS[DNR_RANGE_NAMES[i - 1]!][1]).toBeLessThan(DNR_RULE_IDS[DNR_RANGE_NAMES[i]!][0]);
    }
  });

  it('dnrRangeOf finds our range or null', () => {
    expect(dnrRangeOf(1)).toBe('gpc');
    expect(dnrRangeOf(99)).toBe('gpc');
    expect(dnrRangeOf(100)).toBeNull();
    expect(dnrRangeOf(100000)).toBe('decisions');
    expect(dnrRangeOf(100999)).toBe('decisions');
    expect(dnrRangeOf(101023)).toBe('preset');
    expect(dnrRangeOf(101024)).toBeNull();
    expect(dnrRangeOf(200127)).toBe('session');
    expect(dnrRangeOf(200128)).toBeNull();
    expect(dnrRangeOf(0)).toBeNull();
  });
});

describe('ADR-020 budgets (a changed number = a revision of ADR-020)', () => {
  it('pins the numbers other steps depend on', () => {
    expect(PROTECT_BUDGETS.maxTrackedFieldsPerDocument).toBe(8);
    expect(PROTECT_BUDGETS.maxVariantsPerField).toBe(64);
    expect(PROTECT_BUDGETS.maxFieldsPerInputMessage).toBe(4);
    expect(PROTECT_BUDGETS.maxInputMessageBytes).toBe(16384);
    expect(PROTECT_BUDGETS.maxValueChars).toEqual({ email: 254, phone: 32, name: 128 });
    expect(PROTECT_BUDGETS.maxScannedBodyBytes).toBe(65536);
    expect(PROTECT_BUDGETS.ringWindowMs).toBe(10000);
    expect(PROTECT_BUDGETS.fingerprintIdleTtlMs).toBe(900000);
    expect(PROTECT_BUDGETS.maxEvidencePerDocument).toBe(64);
    expect(PROTECT_BUDGETS.maxProtectSessionBytes).toBe(1048576);
    expect(PROTECT_BUDGETS.ruleActivationSlackMs).toBe(50);
    expect(PROTECT_BUDGETS.protectMessagesPerSecond).toEqual({ document: 8, tab: 32, global: 100 });
    expect(PROTECT_BUDGETS.maxItemsPerBatch).toBe(32);
    expect(PROTECT_BUDGETS.maxSampleAgeMs).toBe(5000);
    expect(PROTECT_BUDGETS.maxRecordChars).toBe(8192);
    expect(PROTECT_BUDGETS.maxJournalChars).toBe(524288);
    expect(PROTECT_BUDGETS.maxGpcHeaderScan).toBe(128);
  });
});

describe('ADR-020 host formats', () => {
  it('isDomainName: >= 2 labels, last label with a letter, never an IP', () => {
    for (const ok of ['example.com', 'a.b.example.co.uk', 'xn--e1afmkfd.xn--p1ai', 'x1.io']) expect(isDomainName(ok)).toBe(true);
    for (const bad of ['localhost', '127.0.0.1', '[::1]', 'Example.com', 'a..b', '-a.com', 'a-.com', 'example.com:443', 'https://example.com', '*.example.com', '']) {
      expect(isDomainName(bad)).toBe(false);
    }
  });

  it('isSiteName: DNS name or IPv4, one label allowed, never IPv6, port or path', () => {
    for (const ok of ['example.com', 'localhost', '127.0.0.1']) expect(isSiteName(ok)).toBe(true);
    for (const bad of ['[::1]', 'example.com/a', 'example.com:80', 'Example.com', '', 'a b']) expect(isSiteName(bad)).toBe(false);
  });
});
