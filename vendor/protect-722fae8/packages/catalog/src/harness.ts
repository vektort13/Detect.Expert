// Synthetic matcher fixtures (ADR-009 v1.1, fixtures/vendors/README.md). A fixture lists URL records derived
// from a rule's documented conditions and checks parser/normalization only: it never proves that the real
// SDK uses the URL, and it never raises a rule's maturity ("a mock does not promote").

import { CATALOG_LIMITS, MATCHER_NEGATIVE_CLASSES, RULE_ID_PATTERN, SYNTHETIC_MATCHER_NOTE, VENDOR_ID_PATTERN } from './lifecycle';
import type { MatcherNegativeClass } from './lifecycle';
import { matchNetworkRequest } from './match';
import type { CatalogIndex } from './types';

export class MatcherFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MatcherFixtureError';
  }
}

export interface MatcherRecord {
  readonly id: string;
  readonly url: string;
  readonly resourceType: string;
  readonly statusCode: number | null;
  readonly note?: string;
}

export interface MatcherNegative extends MatcherRecord {
  readonly class: MatcherNegativeClass;
  /** A real request shape the rule knowingly misses (e.g. percent-encoded path); kept as a documented gap. */
  readonly documentedFalseNegative?: true;
}

export interface MatcherFixture {
  readonly schemaVersion: 1;
  readonly kind: 'synthetic-matcher';
  readonly fixtureId: string;
  readonly vendorId: string;
  readonly ruleId: string;
  readonly note: string;
  readonly positives: readonly MatcherRecord[];
  readonly negatives: readonly MatcherNegative[];
}

export interface MatcherFailure {
  readonly recordId: string;
  readonly expected: 'match' | 'no-match';
  readonly got: readonly string[];
}

export interface MatcherCollision {
  readonly recordId: string;
  readonly ruleIds: readonly string[];
}

export interface MatcherRunResult {
  readonly passed: boolean;
  readonly failures: readonly MatcherFailure[];
  readonly collisions: readonly MatcherCollision[];
}

const FIXTURE_KEYS = ['schemaVersion', 'kind', 'fixtureId', 'vendorId', 'ruleId', 'note', 'positives', 'negatives'];
const RECORD_KEYS = ['id', 'url', 'resourceType', 'statusCode', 'note'];
const NEGATIVE_KEYS = [...RECORD_KEYS, 'class', 'documentedFalseNegative'];
const FIXTURE_ID = /^[a-z0-9][a-z0-9.-]{0,95}$/;
const RECORD_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RESOURCE_TYPE = /^[a-z_]{1,32}$/;

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function closed(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new MatcherFixtureError(where + ': unknown key ' + key);
}

function parseRecord(raw: unknown, where: string, negative: boolean): MatcherRecord | MatcherNegative {
  if (!isObject(raw)) throw new MatcherFixtureError(where + ' must be an object');
  closed(raw, negative ? NEGATIVE_KEYS : RECORD_KEYS, where);
  const { id, url, resourceType, statusCode, note } = raw;
  if (typeof id !== 'string' || !RECORD_ID.test(id)) throw new MatcherFixtureError(where + '.id is invalid');
  if (typeof url !== 'string' || url.length === 0 || url.length > CATALOG_LIMITS.maxFixtureUrlChars) {
    throw new MatcherFixtureError(where + '.url must be 1..' + CATALOG_LIMITS.maxFixtureUrlChars + ' chars');
  }
  if (typeof resourceType !== 'string' || !RESOURCE_TYPE.test(resourceType)) throw new MatcherFixtureError(where + '.resourceType is invalid');
  if (statusCode !== null && !(typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 0 && statusCode <= 999)) {
    throw new MatcherFixtureError(where + '.statusCode must be an integer or null');
  }
  if (note !== undefined && (typeof note !== 'string' || note.length === 0 || note.length > CATALOG_LIMITS.maxTextChars)) {
    throw new MatcherFixtureError(where + '.note must be 1..512 chars');
  }
  const base = { id, url, resourceType, statusCode: statusCode as number | null, ...(note === undefined ? {} : { note: note as string }) };
  if (!negative) return Object.freeze(base);
  const cls = raw['class'];
  if (typeof cls !== 'string' || !(MATCHER_NEGATIVE_CLASSES as readonly string[]).includes(cls)) throw new MatcherFixtureError(where + '.class is unknown');
  const fn = raw['documentedFalseNegative'];
  if (fn !== undefined && fn !== true) throw new MatcherFixtureError(where + '.documentedFalseNegative must be true when present');
  if (fn === true && note === undefined) throw new MatcherFixtureError(where + ': a documented false negative needs a note');
  return Object.freeze({ ...base, class: cls as MatcherNegativeClass, ...(fn === true ? { documentedFalseNegative: true as const } : {}) });
}

/** Closed-schema parser; throws MatcherFixtureError on any unknown key or out-of-bounds value. */
export function parseMatcherFixture(raw: unknown): MatcherFixture {
  if (!isObject(raw)) throw new MatcherFixtureError('fixture must be an object');
  closed(raw, FIXTURE_KEYS, 'fixture');
  if (raw['schemaVersion'] !== 1) throw new MatcherFixtureError('schemaVersion must be 1');
  if (raw['kind'] !== 'synthetic-matcher') throw new MatcherFixtureError('kind must be synthetic-matcher');
  const { fixtureId, vendorId, ruleId, note, positives, negatives } = raw;
  if (typeof fixtureId !== 'string' || !FIXTURE_ID.test(fixtureId)) throw new MatcherFixtureError('fixtureId is invalid');
  if (typeof vendorId !== 'string' || !VENDOR_ID_PATTERN.test(vendorId)) throw new MatcherFixtureError('vendorId is invalid');
  if (typeof ruleId !== 'string' || !RULE_ID_PATTERN.test(ruleId)) throw new MatcherFixtureError('ruleId is invalid');
  if (note !== SYNTHETIC_MATCHER_NOTE) throw new MatcherFixtureError('note must be the standard synthetic-matcher disclaimer');
  if (!Array.isArray(positives) || positives.length === 0 || positives.length > CATALOG_LIMITS.maxFixturePositives) {
    throw new MatcherFixtureError('positives must contain 1..' + CATALOG_LIMITS.maxFixturePositives + ' records');
  }
  if (!Array.isArray(negatives) || negatives.length > CATALOG_LIMITS.maxFixtureNegatives) {
    throw new MatcherFixtureError('negatives must contain at most ' + CATALOG_LIMITS.maxFixtureNegatives + ' records');
  }
  const parsedPositives = positives.map((p, i) => parseRecord(p, 'positives[' + i + ']', false));
  const parsedNegatives = negatives.map((n, i) => parseRecord(n, 'negatives[' + i + ']', true) as MatcherNegative);
  const ids = [...parsedPositives, ...parsedNegatives].map((r) => r.id);
  if (new Set(ids).size !== ids.length) throw new MatcherFixtureError('record ids must be unique');
  return Object.freeze({
    schemaVersion: 1,
    kind: 'synthetic-matcher',
    fixtureId,
    vendorId,
    ruleId,
    note,
    positives: Object.freeze(parsedPositives),
    negatives: Object.freeze(parsedNegatives),
  });
}

/** Runs every record against the index. Any other rule matching any record is a collision. */
export function runMatcherFixture(index: CatalogIndex, fixture: MatcherFixture, nowMs: number): MatcherRunResult {
  const failures: MatcherFailure[] = [];
  const collisions: MatcherCollision[] = [];
  const run = (record: MatcherRecord, expected: 'match' | 'no-match'): void => {
    const got = matchNetworkRequest(index, { url: record.url, resourceType: record.resourceType, statusCode: record.statusCode }, nowMs);
    const hit = got.includes(fixture.ruleId);
    if (hit !== (expected === 'match')) failures.push({ recordId: record.id, expected, got });
    const others = got.filter((id) => id !== fixture.ruleId);
    if (others.length > 0) collisions.push({ recordId: record.id, ruleIds: others });
  };
  if (!index.rulesById.has(fixture.ruleId)) failures.push({ recordId: '(fixture)', expected: 'match', got: [] });
  for (const p of fixture.positives) run(p, 'match');
  for (const n of fixture.negatives) run(n, 'no-match');
  return Object.freeze({ passed: failures.length === 0 && collisions.length === 0, failures, collisions });
}

/** Number of negative records per class (used by catalog-lint for mandatory coverage). */
export function negativeClassCounts(fixture: MatcherFixture): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const n of fixture.negatives) counts[n.class] = (counts[n.class] ?? 0) + 1;
  return counts;
}
