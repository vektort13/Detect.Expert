// @detect-expert/contracts — the single source of wire schemas, canonical enums, types, budgets and validators.
// No browser or UI side effects (spec Part VI, I2). JSON Schemas live in ../schemas and are test-only.

export * from './enums';
export * from './budgets';
export * from './messages';
export { sanitizeHost, isSanitizedHost } from './host';
export {
  validatePageBatch,
  validateSensorMessage,
  validateBridgeMessage,
  validateBridgeControl,
  validateBridgeResetAck,
  validateUiRequest,
} from './validate';
export type { ValidationFailure, ValidationResult } from './validate';
