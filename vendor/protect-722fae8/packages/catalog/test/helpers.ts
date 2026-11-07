// Shared test inputs: the seed, the synthetic catalog and the matcher fixtures, read from the repository.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { buildCatalogIndex } from '../src/build-index';
import { compileRule, compileVendor } from '../src/compile';
import type { CatalogIndex, CompiledRule, SourceRule, SourceVendor } from '../src/types';

export const repoRoot = new URL('../../../', import.meta.url);

export function readRepoText(rel: string): string {
  return readFileSync(new URL(rel, repoRoot), 'utf8');
}

export function readRepoJson<T>(rel: string): T {
  return JSON.parse(readRepoText(rel)) as T;
}

export interface SeedRule extends SourceRule {
  readonly status: string;
  readonly productionEnabled: boolean;
  readonly fixtureVerified: boolean;
}
export interface SeedVendor extends SourceVendor {
  readonly ruleIds: readonly string[];
}
export interface SeedJson {
  readonly catalogVersion: string;
  readonly sourceDate: string;
  readonly vendors: readonly SeedVendor[];
  readonly rules: readonly SeedRule[];
}
export interface SyntheticJson {
  readonly catalogVersion: string;
  readonly vendors: readonly SourceVendor[];
  readonly rules: readonly SourceRule[];
}

export const seed = readRepoJson<SeedJson>('packages/catalog/data/vendors.seed.json');
export const synthetic = readRepoJson<SyntheticJson>('fixtures/vendors/synthetic/catalog.json');
/** Matcher fixtures are evaluated at the catalog source date (expiry is a lint concern). */
export const SOURCE_DATE_MS = Date.parse(seed.sourceDate + 'T00:00:00Z');

export function seedRule(id: string): SeedRule {
  const rule = seed.rules.find((r) => r.id === id);
  if (!rule) throw new Error('no seed rule ' + id);
  return rule;
}

/** kind:'test' index of every seed candidate plus the synthetic rules (what the fixture harness builds). */
export function candidateIndex(extra: readonly CompiledRule[] = []): CatalogIndex {
  const rules = [...seed.rules.map((r) => compileRule(r)), ...synthetic.rules.map((r) => compileRule(r)), ...extra];
  const used = new Set(rules.map((r) => r.vendorId));
  const vendors = [...seed.vendors, ...synthetic.vendors].filter((v) => used.has(v.id)).map((v) => compileVendor(v));
  return buildCatalogIndex({ kind: 'test', catalogVersion: 'test-candidates', vendors, rules, candidateRuleCount: 0 });
}

export interface FixtureFile {
  readonly path: string;
  readonly vendorDir: string;
  readonly fileId: string;
  readonly json: unknown;
}

export function matcherFixtureFiles(): FixtureFile[] {
  const out: FixtureFile[] = [];
  const dir = new URL('fixtures/vendors/', repoRoot);
  for (const name of readdirSync(dir).sort()) {
    const sub = new URL(name + '/', dir);
    if (!statSync(sub).isDirectory()) continue;
    for (const file of readdirSync(sub).sort()) {
      if (!file.endsWith('.matcher.json')) continue;
      const path = 'fixtures/vendors/' + name + '/' + file;
      out.push({ path, vendorDir: name, fileId: file.slice(0, -'.matcher.json'.length), json: readRepoJson<unknown>(path) });
    }
  }
  return out;
}
