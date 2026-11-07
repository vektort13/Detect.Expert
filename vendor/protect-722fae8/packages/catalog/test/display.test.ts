import { describe, expect, it } from 'vitest';
import { ruleDisplay, vendorDisplay } from '../src/display';
import { PRODUCTION_CATALOG } from '../src/production';
import { SYNTHETIC_TEST_CATALOG } from '../src/synthetic';
import { candidateIndex } from './helpers';

describe('vendorDisplay', () => {
  it('uses the compiled name and category purpose key', () => {
    expect(vendorDisplay(SYNTHETIC_TEST_CATALOG, 'test-synthetic')).toEqual({ displayName: 'Synthetic test vendor', purposeKey: 'card_vendor_category_bot' });
  });

  it('keeps the spec purpose override for ThreatMetrix', () => {
    expect(vendorDisplay(candidateIndex(), 'threatmetrix')).toEqual({ displayName: 'LexisNexis ThreatMetrix', purposeKey: 'card_vendor_threatmetrix_purpose' });
  });

  it('falls back to the id and the generic purpose for an unknown vendor', () => {
    expect(vendorDisplay(PRODUCTION_CATALOG, 'datadome')).toEqual({ displayName: 'datadome', purposeKey: 'card_vendor_purpose_generic' });
  });
});

describe('ruleDisplay', () => {
  it('returns localized meaning and limitations with the rule version', () => {
    const ru = ruleDisplay(SYNTHETIC_TEST_CATALOG, 'test-synthetic-loader', 'ru');
    const en = ruleDisplay(SYNTHETIC_TEST_CATALOG, 'test-synthetic-loader', 'en-US');
    expect(ru?.ruleVersion).toBe('1');
    expect(ru?.meaning).toContain('Только тестовая сборка');
    expect(en?.meaning).toContain('Test build only');
    expect(en?.limitations).toContain('Test build only');
    expect(ruleDisplay(SYNTHETIC_TEST_CATALOG, 'test-synthetic-loader', 'de')?.meaning).toBe(ru?.meaning);
  });

  it('returns null for a rule outside the catalog', () => {
    expect(ruleDisplay(PRODUCTION_CATALOG, 'hcaptcha-loader', 'ru')).toBeNull();
  });
});
