// ADR-020 §I (S14): the hash of requests.html that opens the composer: `#new=manual`, `#new=evidence.<evidenceId>`
// or `#new=history.<rowKey>`. Strict: anything else (encoded characters, extra parts, other sources) means "no
// composer". The id is only a lookup key for the SW; it never carries a value.

import { EVIDENCE_ID_PATTERN, HISTORY_ROW_KEY_PATTERN } from '@detect-expert/contracts';

export type RequestPageSource = { sourceKind: 'manual' } | { sourceKind: 'evidence'; recordId: string } | { sourceKind: 'history'; recordId: string };

const MAX_HASH_CHARS = 300;

export function parseRequestPageHash(hash: string): RequestPageSource | null {
  if (typeof hash !== 'string' || hash.length > MAX_HASH_CHARS) return null;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.startsWith('new=')) return null;
  const spec = raw.slice(4);
  if (spec === 'manual') return { sourceKind: 'manual' };
  const dot = spec.indexOf('.');
  if (dot < 0) return null;
  const kind = spec.slice(0, dot);
  const id = spec.slice(dot + 1);
  if (kind === 'evidence' && EVIDENCE_ID_PATTERN.test(id)) return { sourceKind: 'evidence', recordId: id };
  if (kind === 'history' && HISTORY_ROW_KEY_PATTERN.test(id)) return { sourceKind: 'history', recordId: id };
  return null;
}

/** Hash of a source (the inverse of parseRequestPageHash). */
export function requestPageHash(source: RequestPageSource): string {
  return source.sourceKind === 'manual' ? '#new=manual' : '#new=' + source.sourceKind + '.' + source.recordId;
}
