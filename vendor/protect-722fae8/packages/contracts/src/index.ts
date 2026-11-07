// @detect-expert/contracts — the single source of wire schemas, canonical enums, types, budgets and validators.
// No browser or UI side effects (spec Part VI, I2). JSON Schemas live in ../schemas and are test-only.

export * from './enums';
export * from './budgets';
export * from './messages';
export {
  OPERATION_CODES,
  PAGE_OPERATIONS,
  TECHNIQUE_SIGNALS,
  pageOperations,
  techniqueSignals,
  isPageOperation,
} from './operations';
export type { OperationCode } from './operations';
export { OPERATION_API_NAMES, operationApiName } from './operation-api';
export {
  MAX_POLICY_SENSOR_ENTRIES,
  MAX_POLICY_SENSOR_ID_CHARS,
  SENSOR_TECHNIQUES,
  sensorBit,
  sensorOfTechnique,
  sensorOffMask,
} from './sensors';
export { sanitizeHost, isSanitizedHost } from './host';
export {
  validatePageBatch,
  validateSensorMessage,
  validateBridgeMessage,
  validateBridgeControl,
  validateUiRequest,
} from './validate';
export type { ValidationFailure, ValidationResult } from './validate';
// ADR-020 «Защита» (opt-in module, OFF by default): names, budgets, wire types and validators of the module.
export * from './protect';
export * from './protect-main';
export * from './protect-firewall';
export * from './protect-history';
export * from './protect-requests';
export {
  validateProtectUiRequest,
  validateProtectPageMessage,
  validateProtectMainMessage,
  validateProtectRelayMessage,
  validateProtectControl,
  validateProtectAck,
  validateStoredRequestJournal,
  estimateRecordChars,
  jsonLengthUpTo,
} from './validate-protect';
export type { HydratedRequestJournal } from './validate-protect';
