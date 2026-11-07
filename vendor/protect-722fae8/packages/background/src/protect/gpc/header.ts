// ADR-020 §H, §4 (S13): the only reader of request headers in the module. Of every header only `name` is read; the
// value is read only for a header named Sec-GPC (case-insensitive). Other values are never read, copied or kept
// (cookies, authorization, referer stay untouched). At most PROTECT_BUDGETS.maxGpcHeaderScan entries are looked at.

import { PROTECT_BUDGETS } from '@detect-expert/contracts';

/** What Chrome reported for the outgoing request: `Sec-GPC: 1`, Sec-GPC with another value, or no Sec-GPC. */
export type GpcHeaderState = 'present' | 'other-value' | 'absent';

const NAME = 'sec-gpc';

export function gpcHeaderOf(headers: ReadonlyArray<{ name: string; value?: string | undefined }> | null | undefined): GpcHeaderState {
  if (headers === null || headers === undefined || !Array.isArray(headers)) return 'absent';
  const n = Math.min(headers.length, PROTECT_BUDGETS.maxGpcHeaderScan);
  for (let i = 0; i < n; i++) {
    const header: unknown = headers[i];
    if (typeof header !== 'object' || header === null) continue;
    const name: unknown = (header as { name?: unknown }).name;
    // Cheap length check first: only a 7-character name can be Sec-GPC.
    if (typeof name !== 'string' || name.length !== NAME.length || name.toLowerCase() !== NAME) continue;
    return (header as { value?: unknown }).value === '1' ? 'present' : 'other-value';
  }
  return 'absent';
}
