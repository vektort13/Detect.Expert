// ADR-020 §12 (S10, foundation follow-up): the one named helper allowed to read the `value` member of a contracts
// ValidationResult in the module's ISOLATED code. scripts/code-checks.mjs (scanFieldReads) rejects every other `value`
// read in packages/collector/src/protect/** and apps/extension/entrypoints/protect.ts — `.value`, `['value']`,
// destructuring `{ value }`, a 'value' name literal (Reflect.get, computed keys) — except in the audited field reader
// (field-value.ts) and here. This helper takes only a successful ValidationResult: never a page element.

import type { ValidationResult } from '@detect-expert/contracts';

/** The validated payload of a successful result (`r.ok === true` narrowed by the caller). */
export function validatedValue<T>(result: Extract<ValidationResult<T>, { ok: true }>): T {
  return result.value;
}
