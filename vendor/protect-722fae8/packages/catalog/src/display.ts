// Display data for UI view models (S10). Names and purpose keys come from the compiled catalog only; an
// unknown vendor keeps its id and the generic purpose. No trust or safety wording is produced here (REQ-007).

import { GENERIC_PURPOSE_KEY } from './lifecycle';
import type { CatalogIndex } from './types';

export interface VendorDisplay {
  readonly displayName: string;
  readonly purposeKey: string;
}

export interface RuleDisplay {
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly meaning: string;
  readonly limitations: string;
}

export function vendorDisplay(index: CatalogIndex, vendorId: string): VendorDisplay {
  const vendor = index.vendorsById.get(vendorId);
  if (vendor === undefined) return { displayName: vendorId, purposeKey: GENERIC_PURPOSE_KEY };
  return { displayName: vendor.displayName, purposeKey: vendor.purposeKey };
}

/** English for 'en*' UI locales, Russian otherwise (the extension's default_locale is ru). */
export function ruleDisplay(index: CatalogIndex, ruleId: string, locale: string): RuleDisplay | null {
  const rule = index.rulesById.get(ruleId);
  if (rule === undefined) return null;
  const en = typeof locale === 'string' && locale.toLowerCase().startsWith('en');
  return {
    ruleId: rule.ruleId,
    ruleVersion: rule.ruleVersion,
    meaning: en ? rule.meaning.en : rule.meaning.ru,
    limitations: en ? rule.limitations.en : rule.limitations.ru,
  };
}
