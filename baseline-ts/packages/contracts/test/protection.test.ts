import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROTECTION_SETTINGS, MAX_PROTECTION_SITES, PROTECTION_FEATURES, effectiveProtection, readProtectionSettings,
  readProtectionObservations, readProtectionUiRequest } from '../src/protection';
import { compileSchema } from './helpers';

describe('ADR-035 explicit local protection policy', () => {
  it('is disabled by default, including saved per-site block overrides', () => {
    expect(DEFAULT_PROTECTION_SETTINGS.enabled).toBe(false);
    expect(effectiveProtection(DEFAULT_PROTECTION_SETTINGS, 'example.com')).toEqual([]);
    expect(effectiveProtection({ ...DEFAULT_PROTECTION_SETTINGS, sites: [
      { host: 'example.com', disabled: false, rules: [{ feature: 'canvas-readback', state: 'block' }] },
    ] }, 'example.com')).toEqual([]);
  });

  it('applies preset, global overrides, then exact-host overrides', () => {
    const settings = { ...DEFAULT_PROTECTION_SETTINGS, enabled: true,
      global: [{ feature: 'window-management', state: 'allow' }, { feature: 'canvas-readback', state: 'block' }],
      sites: [{ host: 'example.com', disabled: false, rules: [
        { feature: 'window-management', state: 'block' }, { feature: 'canvas-readback', state: 'allow' },
      ] }],
    } as const;
    const local = effectiveProtection(settings, 'example.com');
    expect(local).toContain('window-management');
    expect(local).not.toContain('canvas-readback');
    const other = effectiveProtection(settings, 'other.example.com');
    expect(other).not.toContain('window-management');
    expect(other).toContain('canvas-readback');
    expect(new Set(local).size).toBe(local.length);
  });

  it('lets a site exemption override every preset and explicit block', () => {
    const settings = { ...DEFAULT_PROTECTION_SETTINGS, enabled: true, preset: 'strict', sites: [
      { host: 'example.com', disabled: true, rules: [{ feature: 'canvas-readback', state: 'block' }] },
    ] } as const;
    expect(effectiveProtection(settings, 'example.com')).toEqual([]);
    expect(effectiveProtection(settings, 'other.example.com')).toContain('canvas-readback');
    expect(effectiveProtection(settings, null)).toEqual([]);
  });

  it('reads a versioned bounded settings snapshot without introducing network data', () => {
    expect(readProtectionSettings(DEFAULT_PROTECTION_SETTINGS)).toEqual(DEFAULT_PROTECTION_SETTINGS);
    const settings = { ...DEFAULT_PROTECTION_SETTINGS, enabled: true, revision: 2, global: [
      { feature: 'window-management', state: 'block' },
    ], sites: [{ host: 'example.com', disabled: false, rules: [] }] };
    expect(readProtectionSettings(settings)).toEqual(settings);
    expect(PROTECTION_FEATURES.length).toBeLessThanOrEqual(32);
    expect(MAX_PROTECTION_SITES).toBeLessThanOrEqual(128);
  });

  it('rejects malformed, duplicate, unknown and oversized settings rather than partially enabling them', () => {
    const site = { host: 'example.com', disabled: false, rules: [] };
    const rule = { feature: 'canvas-readback', state: 'block' };
    for (const input of [undefined, null, {}, { ...DEFAULT_PROTECTION_SETTINGS, schemaVersion: 2 },
      { ...DEFAULT_PROTECTION_SETTINGS, enabled: 'true' }, { ...DEFAULT_PROTECTION_SETTINGS, revision: -1 },
      { ...DEFAULT_PROTECTION_SETTINGS, preset: 'invisible' }, { ...DEFAULT_PROTECTION_SETTINGS, remote: true },
      { ...DEFAULT_PROTECTION_SETTINGS, global: [rule, rule] },
      { ...DEFAULT_PROTECTION_SETTINGS, global: [{ ...rule, feature: 'unknown' }] },
      { ...DEFAULT_PROTECTION_SETTINGS, global: [{ ...rule, state: 'spoof' }] },
      { ...DEFAULT_PROTECTION_SETTINGS, sites: [site, site] },
      { ...DEFAULT_PROTECTION_SETTINGS, sites: [{ ...site, host: 'https://example.com/path?token=secret' }] },
      { ...DEFAULT_PROTECTION_SETTINGS, sites: [{ ...site, host: '[aa]' }] },
      { ...DEFAULT_PROTECTION_SETTINGS, sites: [{ ...site, host: '[1:2]' }] },
      { ...DEFAULT_PROTECTION_SETTINGS, sites: [{ ...site, host: '127.1' }] },
      { ...DEFAULT_PROTECTION_SETTINGS, sites: new Array(MAX_PROTECTION_SITES + 1).fill(site) },
    ]) expect(readProtectionSettings(input)).toBeNull();
  });

  it('does not run accessors or accept inherited policy fields', () => {
    const getter = vi.fn(() => true);
    const poisoned = { ...DEFAULT_PROTECTION_SETTINGS };
    Object.defineProperty(poisoned, 'enabled', { get: getter, enumerable: true });
    expect(readProtectionSettings(poisoned)).toBeNull();
    expect(getter).not.toHaveBeenCalled();
    expect(readProtectionSettings(Object.create(DEFAULT_PROTECTION_SETTINGS))).toBeNull();
    const parsed = readProtectionSettings(DEFAULT_PROTECTION_SETTINGS);
    expect(parsed).not.toBe(DEFAULT_PROTECTION_SETTINGS);
    expect(parsed?.global).not.toBe(DEFAULT_PROTECTION_SETTINGS.global);
  });

  it('supports a single explicit per-site block without any global preset denial', () => {
    const settings = { ...DEFAULT_PROTECTION_SETTINGS, enabled: true, preset: 'custom', sites: [
      { host: 'example.com', disabled: false, rules: [{ feature: 'canvas-readback', state: 'block' }] },
    ] } as const;
    expect(readProtectionSettings(settings)).toEqual(settings);
    expect(effectiveProtection(settings, 'example.com')).toEqual(['canvas-readback']);
    expect(effectiveProtection(settings, 'other.example.com')).toEqual([]);
  });

  it('accepts only fixed bounded observation rows and never accepts data values', () => {
    const row = { feature: 'window-management', installed: 1, unavailable: 0, removed: 0, blocked: 10, stopped: false };
    expect(readProtectionObservations([row])).toEqual([row]);
    for (const invalid of [[row, row], [{ ...row, blocked: 65536 }], [{ ...row, feature: 'unknown' }],
      [{ ...row, installed: 17 }], [{ ...row, removed: 2 }], [{ ...row, result: 'PRIVATE_CANARY' }],
      [{ ...row, stopped: 'false' }], new Array(1), new Array(16).fill(row)]) expect(readProtectionObservations(invalid)).toBeNull();
    const touched = vi.fn();
    Object.defineProperty(row, 'blocked', { get: touched, enumerable: true });
    expect(readProtectionObservations([row])).toBeNull();
    expect(touched).not.toHaveBeenCalled();
  });

  it('cross-checks the dedicated structural schema and strict UI request reader', () => {
    const schema = compileSchema('protection.v1.schema.json');
    const get = { schemaVersion: 1, type: 'ui-protection-get', tabId: null };
    const set = { schemaVersion: 1, type: 'ui-protection-set', tabId: 7, settings: DEFAULT_PROTECTION_SETTINGS };
    const reload = { schemaVersion: 1, type: 'ui-protection-reload', tabId: 7, documentId: 'doc7' };
    for (const input of [get, set, reload]) {
      expect(schema(input)).toBe(true);
      expect(readProtectionUiRequest(input)).toEqual(input);
    }
    for (const input of [{ ...get, extra: true }, { ...get, schemaVersion: 2 }, { ...get, tabId: -1 },
      { ...reload, tabId: null }, { ...reload, documentId: '' }, { ...set, settings: { ...DEFAULT_PROTECTION_SETTINGS, enabled: 'true' } },
      { ...set, settings: { ...DEFAULT_PROTECTION_SETTINGS, global: [{ feature: 'canvas-readback', state: 'block' }, { feature: 'canvas-readback', state: 'allow' }] } }]) {
      expect(schema(input)).toBe(false);
      expect(readProtectionUiRequest(input)).toBeNull();
    }
  });
});