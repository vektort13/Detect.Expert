// Runtime helpers of the generated module tables (scripts/protect-tables.mjs, ADR-020). Pure code: no chrome.*, no
// network, no regex compilation. The generated modules call these with plain JSON literals.

function deepFreeze(value: unknown, depth: number): void {
  if (depth > 32 || value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child, depth + 1);
}

/** Deep-freezes table data: generated tables are immutable at runtime. */
export function freezeTable<T>(value: T): T {
  deepFreeze(value, 0);
  return value;
}

/**
 * Test-profile table data. The generator passes 'SYNTHETIC_PROTECT_TABLES:<plugin>' as `_marker`; the literal stays in
 * any bundle that uses the data, so scripts/release-verify.mjs can prove that dist/local carries none.
 */
export function syntheticTable<T>(_marker: string, value: T): T {
  return freezeTable(value);
}
