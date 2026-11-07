import { PROTECT_BUDGETS, PROTECT_CONSENT_VERSION } from '@detect-expert/contracts';
import { DEFAULT_PROTECT_SETTINGS, canonicalFeatures, effectiveProtectState, needsDnr, parseProtectSettings } from '@detect-expert/engine';
import type { ProtectSettings, ProtectStateInput } from '@detect-expert/engine';
import { describe, expect, it } from 'vitest';
import { ENABLED_SETTINGS } from './support';

const NOW = 1_000_000;

describe('parseProtectSettings (ADR-020 §3, fail-closed)', () => {
  it('absent or non-object → defaults, off', () => {
    for (const raw of [undefined, null, 'x', 1, [], true]) {
      expect(parseProtectSettings(raw, NOW)).toEqual({ ...DEFAULT_PROTECT_SETTINGS, features: [] });
    }
  });

  it('a valid record is read as is, features in canonical order', () => {
    const s = parseProtectSettings({ ...ENABLED_SETTINGS, features: ['session-replay', 'value-match', 'firewall', 'value-match'] }, NOW);
    expect(s).toEqual({ v: 1, enabled: true, consentVersion: 1, features: ['value-match', 'firewall', 'session-replay'], preset: 'normal', snoozeUntil: null, historyRetentionDays: 30 });
  });

  it.each([
    ['unknown key', { ...ENABLED_SETTINGS, extra: 1 }],
    ['wrong version', { ...ENABLED_SETTINGS, v: 2 }],
    ['unknown feature', { ...ENABLED_SETTINGS, features: ['value-match', 'keylogger'] }],
    ['features not an array', { ...ENABLED_SETTINGS, features: 'value-match' }],
    ['empty features while enabled', { ...ENABLED_SETTINGS, features: [] }],
    ['unknown preset', { ...ENABLED_SETTINGS, preset: 'paranoid' }],
    ['bad retention', { ...ENABLED_SETTINGS, historyRetentionDays: 31 }],
    ['bad consent', { ...ENABLED_SETTINGS, consentVersion: 'v1' }],
    ['enabled not boolean', { ...ENABLED_SETTINGS, enabled: 'true' }],
    ['snooze not a number', { ...ENABLED_SETTINGS, snoozeUntil: '1' }],
  ])('%s → enabled:false (other valid fields kept)', (_name, raw) => {
    const s = parseProtectSettings(raw, NOW);
    expect(s.enabled).toBe(false);
    expect(s.v).toBe(1);
  });

  it('snoozeUntil is bounded by now + snoozeMs; an expired snooze reads as null', () => {
    expect(parseProtectSettings({ ...ENABLED_SETTINGS, snoozeUntil: NOW + 10 * PROTECT_BUDGETS.snoozeMs }, NOW).snoozeUntil).toBe(NOW + PROTECT_BUDGETS.snoozeMs);
    expect(parseProtectSettings({ ...ENABLED_SETTINGS, snoozeUntil: NOW + 1000 }, NOW).snoozeUntil).toBe(NOW + 1000);
    expect(parseProtectSettings({ ...ENABLED_SETTINGS, snoozeUntil: NOW - 1 }, NOW).snoozeUntil).toBeNull();
    expect(parseProtectSettings({ ...ENABLED_SETTINGS, snoozeUntil: NOW + 1000 }, NOW).enabled).toBe(true);
  });

  it('canonicalFeatures rejects unknown entries and orders the rest', () => {
    expect(canonicalFeatures(['gpc', 'history', 'gpc'])).toEqual(['history', 'gpc']);
    expect(canonicalFeatures(['gpc', 'x'])).toBeNull();
    expect(canonicalFeatures('gpc')).toBeNull();
  });

  it('needsDnr only for firewall or gpc', () => {
    expect(needsDnr(['value-match', 'session-replay', 'history'])).toBe(false);
    expect(needsDnr(['firewall'])).toBe(true);
    expect(needsDnr(['gpc'])).toBe(true);
  });
});

describe('effectiveProtectState (priority organization-disabled > off > needs-consent > needs-permission > degraded > active)', () => {
  const settings = parseProtectSettings(ENABLED_SETTINGS, NOW) as ProtectSettings;
  const base: ProtectStateInput = { settings, consentRequired: false, orgDisabled: false, broadHosts: true, dnr: true, degraded: false };

  it('walks the priority order', () => {
    expect(effectiveProtectState({ ...base, orgDisabled: true, consentRequired: true, broadHosts: false, degraded: true }).state).toBe('organization-disabled');
    expect(effectiveProtectState({ ...base, settings: { ...settings, enabled: false }, consentRequired: true }).state).toBe('off');
    expect(effectiveProtectState({ ...base, consentRequired: true, broadHosts: false }).state).toBe('needs-consent');
    expect(effectiveProtectState({ ...base, broadHosts: false, degraded: true }).state).toBe('needs-permission');
    expect(effectiveProtectState({ ...base, degraded: true }).state).toBe('degraded');
    expect(effectiveProtectState(base).state).toBe('active');
  });

  it('firewall/gpc without DNR: needs-permission (required) or enforcement no-permission (F2)', () => {
    expect(effectiveProtectState({ ...base, dnr: false }).state).toBe('needs-permission');
    const f2 = effectiveProtectState({ ...base, dnr: false, dnrPolicy: 'enforcement-only' });
    expect(f2).toEqual({ state: 'active', enforcement: 'no-permission' });
    const noDnrFeatures = { ...settings, features: ['value-match', 'session-replay'] as ProtectSettings['features'] };
    expect(effectiveProtectState({ ...base, settings: noDnrFeatures, dnr: false })).toEqual({ state: 'active', enforcement: 'off' });
  });

  it('enforcement follows the preset and the DNR port', () => {
    expect(effectiveProtectState(base).enforcement).toBe('active');
    expect(effectiveProtectState({ ...base, settings: { ...settings, preset: 'warn-only' } }).enforcement).toBe('warn-only');
    expect(effectiveProtectState({ ...base, enforcementDegraded: true }).enforcement).toBe('degraded');
    expect(effectiveProtectState({ ...base, orgDisabled: true }).enforcement).toBe('off');
  });

  it('PROTECT_CONSENT_VERSION is 1 (a change moves the module to needs-consent)', () => {
    expect(PROTECT_CONSENT_VERSION).toBe(1);
  });
});
