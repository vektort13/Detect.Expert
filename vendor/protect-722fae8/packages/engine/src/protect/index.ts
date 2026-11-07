// ADR-020 «Защита» (opt-in module, OFF by default): pure logic of the module. No chrome.*, no DOM, no network, no clock.
// Lanes add their modules below (stubs from S04 are replaced by their owners).

export {
  DEFAULT_PROTECT_SETTINGS,
  PROTECT_SETTINGS_KEY,
  canonicalFeatures,
  effectiveProtectState,
  needsDnr,
  parseProtectSettings,
} from './state';
export type { DnrPermissionPolicy, EffectiveProtectState, ProtectSettings, ProtectStateInput } from './state';
export { classifyField, isPaymentField, isValueShapeOk } from './never-read';
export type { FieldClass, FieldView } from './never-read';
export { capConfidence, confidenceCeiling, evidenceKey, mergeEvidence, sanitizeParamName } from './evidence';
export type { MergeEvidenceResult, ProtectConfidence } from './evidence';
export { DnrGuardError, FORBIDDEN_DNR_ACTIONS, assertAllowedRule, dnrRangeBounds, isAllowedRule } from './dnr-guard';
export type { AllowedDnrActionType, AllowedDnrCondition, AllowedDnrRule, GpcHeaderInfo } from './dnr-guard';
export { PROTECT_CONSENT_DIGEST, PROTECT_CONSENT_KEYS } from './consent';
export type { ProtectConsentKey } from './consent';
// Lane modules (stubs until their steps land).
export * from './match/index';
export * from './form-leak';
export * from './firewall/index';
export * from './replay';
export * from './correlate';
export * from './history/index';
export * from './requests/index';
