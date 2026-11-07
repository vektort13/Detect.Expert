// ADR-020 §C, REQ-008 (S08): the firewall preset table (known receiver endpoints of the strict preset). Seed entries
// live in packages/catalog/data/firewall-preset.seed.json; scripts/protect-tables/firewall-preset.mjs lints them with
// lintPresetEntries() and generates the production table (only entries that passed the gate — none today) and the
// synthetic test table. parsePresetEntries() reads a generated table at runtime (shape only; never a regex, never a
// remote rule). A preset never targets a protection service (no overlap with the vendor catalog hosts).

import { isLocalDay, PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { LocalDay } from '@detect-expert/contracts';
import { domainMatches } from '../../../../attribution/src/dnr-domains';
import { isPresetReceiverHost } from './receiver';
import type { FirewallPresetEntry } from './rules';

export const PRESET_LIFECYCLES = ['candidate', 'active', 'retired'] as const;
export type PresetLifecycle = (typeof PRESET_LIFECYCLES)[number];

export const PRESET_ENTRY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/;
/** Literal path prefix: 1..4 segments of [A-Za-z0-9._~-], optional trailing slash; no query, fragment or wildcard. */
export const PRESET_PATH_PREFIX_PATTERN = /^\/[A-Za-z0-9._~-]{1,40}(?:\/[A-Za-z0-9._~-]{1,40}){0,3}\/?$/;
/** A source link: https, ≤ 300 chars, no whitespace, query or fragment (string checks: no regex literal with `//`). */
function isSourceUrl(v: string): boolean {
  if (!v.startsWith('https' + ':' + '//') || v.length > 300 || v.length < 12) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c <= 32 || c === 35 || c === 63 || c === 127) return false;
  }
  return true;
}
const REVIEWER_RE = /^[A-Za-z0-9 ._@-]{2,80}$/;
const FIXTURE_ID_RE = /^[a-z0-9][a-z0-9/._-]{1,120}$/;

/** One seed entry (catalog data; never shipped as such: the generator keeps entryId, host and pathPrefix only). */
export interface FirewallPresetSeedEntry {
  entryId: string;
  receiverDomain: string;
  pathPrefix?: string;
  lifecycle: PresetLifecycle;
  fixtureVerified: boolean;
  productionEnabled: boolean;
  source: string | null;
  reviewer: string | null;
  positiveFixtures: string[];
  negativeFixtures: string[];
  expiresAt: LocalDay | null;
}

/** A path segment that looks like an identifier (≥ 4 digits in a row, or ≥ 8 hex characters with a digit). */
function idLikeSegment(segment: string): boolean {
  if (/[0-9]{4,}/.test(segment)) return true;
  return /^[0-9a-f]{8,}$/i.test(segment) && /[0-9]/.test(segment);
}

/** Safe literal path prefix (lint and runtime). */
export function isSafePathPrefix(value: unknown): value is string {
  if (typeof value !== 'string' || !PRESET_PATH_PREFIX_PATTERN.test(value)) return false;
  for (const segment of value.split('/')) if (segment.length > 0 && idLikeSegment(segment)) return false;
  return true;
}

/** Gate of REQ-008: active, verified on fixtures (positive and negative), sourced and reviewed. */
export function presetGatePassed(e: FirewallPresetSeedEntry): boolean {
  return (
    e.lifecycle === 'active' &&
    e.productionEnabled === true &&
    e.fixtureVerified === true &&
    typeof e.source === 'string' &&
    typeof e.reviewer === 'string' &&
    e.positiveFixtures.length > 0 &&
    e.negativeFixtures.length > 0 &&
    e.expiresAt !== null
  );
}

export interface PresetLintOptions {
  /** Local day of the lint run (expiry of production entries). */
  today: LocalDay;
  /** Hosts of the vendor catalog (protection services): a preset entry must never cover one of them. */
  vendorHosts: readonly string[];
}

export interface PresetLintResult {
  errors: string[];
  warnings: string[];
  /** Entries that passed the gate (what the production table may contain), in seed order. */
  production: FirewallPresetEntry[];
}

const SEED_KEYS = new Set(['entryId', 'receiverDomain', 'pathPrefix', 'lifecycle', 'fixtureVerified', 'productionEnabled', 'source', 'reviewer', 'positiveFixtures', 'negativeFixtures', 'expiresAt']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringList(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > 32) return null;
  for (const s of v) if (typeof s !== 'string' || !FIXTURE_ID_RE.test(s)) return null;
  return [...(v as string[])];
}

/** Lints the seed `{ schemaVersion: 1, entries: [...] }`. Errors block generation (scripts/protect-tables.mjs). */
export function lintPresetEntries(seed: unknown, options: PresetLintOptions): PresetLintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const production: FirewallPresetEntry[] = [];
  if (!isRecord(seed) || seed['schemaVersion'] !== 1 || !Array.isArray(seed['entries'])) {
    return { errors: ['seed must be { schemaVersion: 1, entries: [] }'], warnings, production };
  }
  for (const key of Object.keys(seed)) if (key !== 'schemaVersion' && key !== 'entries' && key !== 'notes') errors.push('seed: unknown key ' + key);
  const entries = seed['entries'] as unknown[];
  if (entries.length > 256) errors.push('seed: more than 256 entries');
  const ids = new Set<string>();
  for (let i = 0; i < Math.min(entries.length, 256); i++) {
    const raw = entries[i];
    const where = 'entries[' + String(i) + ']';
    if (!isRecord(raw)) {
      errors.push(where + ': not an object');
      continue;
    }
    for (const key of Object.keys(raw)) if (!SEED_KEYS.has(key)) errors.push(where + ': unknown key ' + key);
    const entryId = raw['entryId'];
    if (typeof entryId !== 'string' || !PRESET_ENTRY_ID_PATTERN.test(entryId)) {
      errors.push(where + ': entryId must match ' + PRESET_ENTRY_ID_PATTERN.source);
      continue;
    }
    const at = where + ' (' + entryId + ')';
    if (ids.has(entryId)) errors.push(at + ': duplicate entryId');
    ids.add(entryId);
    const host = raw['receiverDomain'];
    if (!isPresetReceiverHost(host)) errors.push(at + ': receiverDomain must be a registrable domain or a host below one, never a public suffix or its parent, an IP or a local name');
    const pathPrefix = raw['pathPrefix'];
    if (pathPrefix !== undefined && !isSafePathPrefix(pathPrefix)) errors.push(at + ': pathPrefix must be a literal path without a query, a fragment, a wildcard or an ID-like segment');
    const lifecycle = raw['lifecycle'];
    if (typeof lifecycle !== 'string' || !(PRESET_LIFECYCLES as readonly string[]).includes(lifecycle)) errors.push(at + ': lifecycle must be one of ' + PRESET_LIFECYCLES.join(', '));
    for (const flag of ['fixtureVerified', 'productionEnabled'] as const) if (typeof raw[flag] !== 'boolean') errors.push(at + ': ' + flag + ' must be a boolean');
    for (const field of ['source', 'reviewer'] as const) {
      const v = raw[field];
      if (v !== null && (typeof v !== 'string' || !(field === 'source' ? isSourceUrl(v) : REVIEWER_RE.test(v)))) errors.push(at + ': ' + field + ' must be null or a valid ' + (field === 'source' ? 'https URL without query' : 'name'));
    }
    const positive = stringList(raw['positiveFixtures']);
    const negative = stringList(raw['negativeFixtures']);
    if (positive === null || negative === null) errors.push(at + ': positiveFixtures / negativeFixtures must be lists of fixture ids');
    const expiresAt = raw['expiresAt'];
    if (expiresAt !== null && !isLocalDay(expiresAt)) errors.push(at + ': expiresAt must be null or YYYY-MM-DD');
    if (typeof host === 'string') {
      // A preset host covering a vendor host (or lying below one) would block a protection service.
      for (const vendorHost of options.vendorHosts) {
        if (domainMatches(vendorHost, host) || domainMatches(host, vendorHost)) {
          errors.push(at + ': covers the protection-service host ' + vendorHost + ' of the vendor catalog (presets never target protection services)');
        }
      }
    }
    if (errors.some((e) => e.startsWith(at))) continue;
    const entry = raw as unknown as FirewallPresetSeedEntry;
    const fullEntry: FirewallPresetSeedEntry = { ...entry, positiveFixtures: positive!, negativeFixtures: negative! };
    if (fullEntry.productionEnabled && !presetGatePassed(fullEntry)) {
      errors.push(at + ': productionEnabled requires lifecycle active, fixtureVerified, source, reviewer, positive and negative fixtures and expiresAt');
      continue;
    }
    if (presetGatePassed(fullEntry)) {
      if (fullEntry.expiresAt !== null && fullEntry.expiresAt < options.today) {
        errors.push(at + ': expired on ' + fullEntry.expiresAt + ' (review again or retire)');
        continue;
      }
      production.push({ entryId, host: host as string, ...(typeof pathPrefix === 'string' ? { pathPrefix } : {}) });
    } else if (fullEntry.lifecycle === 'candidate') warnings.push(at + ': candidate (not shipped: the REQ-008 gate is not passed)');
  }
  if (production.length > PROTECT_BUDGETS.maxPresetEntries) errors.push('more than ' + String(PROTECT_BUDGETS.maxPresetEntries) + ' production entries (PROTECT_BUDGETS.maxPresetEntries)');
  return { errors, warnings, production };
}

/**
 * Runtime reading of a generated table (`FIREWALL_PRESET_ENTRIES`): `{ entryId, host, pathPrefix?, synthetic? }`.
 * Entries marked synthetic (test-profile data) are accepted only with `allowSynthetic`. At most maxPresetEntries,
 * unique ids; anything malformed is skipped.
 */
export function parsePresetEntries(raw: readonly unknown[], options: { allowSynthetic: boolean }): FirewallPresetEntry[] {
  const out: FirewallPresetEntry[] = [];
  const ids = new Set<string>();
  for (const e of raw) {
    if (out.length >= PROTECT_BUDGETS.maxPresetEntries) break;
    if (!isRecord(e)) continue;
    const entryId = e['entryId'];
    const host = e['host'];
    const pathPrefix = e['pathPrefix'];
    if (typeof entryId !== 'string' || !PRESET_ENTRY_ID_PATTERN.test(entryId) || ids.has(entryId)) continue;
    if (!isPresetReceiverHost(host)) continue;
    if (pathPrefix !== undefined && !isSafePathPrefix(pathPrefix)) continue;
    if (e['synthetic'] !== undefined && (e['synthetic'] !== true || !options.allowSynthetic)) continue;
    ids.add(entryId);
    out.push({ entryId, host, ...(typeof pathPrefix === 'string' ? { pathPrefix } : {}) });
  }
  return out;
}
