// ADR-020 §E, REQ-008 (S11): lint of the session-recording service table (scripts/protect-tables/replay.mjs). The
// shipped seed has 14 session_replay vendors, every rule a candidate (productionEnabled=false, fixtureVerified=false),
// so the production table is empty; the lint refuses an open gate, rules on index-only vendors, regexes outside the
// strict dialect, failing matcher fixtures, id collisions with the vendor catalog, future access dates and synthetic
// hosts outside loopback / reserved example.* names.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const pluginUrl = pathToFileURL(join(repo, 'scripts', 'protect-tables', 'replay.mjs')).href;

interface LintResult {
  errors: string[];
  warnings: string[];
  production: unknown[];
  synthetic: unknown[];
}
interface Plugin {
  lintReplayTables(options?: Record<string, unknown>): Promise<LintResult>;
  stressInputs(source: string): string[];
  default: { name: string; generate(): Promise<{ production: { exports: Array<{ value: unknown[] }> }; synthetic: { exports: Array<{ value: unknown[] }> } }> };
}

async function plugin(): Promise<Plugin> {
  return (await import(/* @vite-ignore */ pluginUrl)) as Plugin;
}

type Json = Record<string, unknown> & { vendors: Array<Record<string, unknown>>; rules: Array<Record<string, unknown>> };
const seed = (): Json => JSON.parse(readFileSync(join(repo, 'packages/catalog/data/replay.seed.json'), 'utf8')) as Json;
const synthetic = (): Record<string, unknown> & { entries: Array<Record<string, unknown>> } =>
  JSON.parse(readFileSync(join(repo, 'fixtures/vendors/synthetic/replay-catalog.json'), 'utf8')) as Record<string, unknown> & { entries: Array<Record<string, unknown>> };
const TODAY = '2026-10-18';

describe('replay seed (catalog protect-table plugin)', () => {
  it('the shipped seed: 14 session_replay vendors, candidates only, an empty production table and the synthetic test-replay entries', async () => {
    const p = await plugin();
    const s = seed();
    expect(s.vendors).toHaveLength(14);
    expect(new Set(s.vendors.map((v) => v['category']))).toEqual(new Set(['session_replay']));
    for (const v of s.vendors) expect([v['productionEnabled'], v['fixtureVerified']]).toEqual([false, false]);
    for (const r of s.rules) expect([r['productionEnabled'], r['fixtureVerified'], r['expiresAt'], r['status']]).toEqual([false, false, '2027-01-15', 'documented_candidate']);
    const byStatus = (status: string) => s.vendors.filter((v) => v['evidenceStatus'] === status).map((v) => v['id']).sort();
    expect(byStatus('official_index_only')).toEqual(['hotjar', 'mouseflow', 'quantum_metric', 'smartlook']);
    expect(byStatus('product_catalog_only')).toEqual(['datadog_rum', 'posthog', 'sentry_replay']);
    expect(byStatus('documented_candidate')).toEqual(['contentsquare', 'fullstory', 'inspectlet', 'logrocket', 'lucky_orange', 'microsoft_clarity', 'yandex_metrica_webvisor']);
    const logrocket = s.rules.find((r) => r['id'] === 'replay-logrocket-cdn')!;
    expect((logrocket['conditions'] as { hostOneOf: string[] }).hostOneOf).toHaveLength(12);
    const result = await p.lintReplayTables({ today: TODAY });
    expect(result.errors).toEqual([]);
    expect(result.production).toEqual([]);
    expect(result.synthetic).toHaveLength(2);
    const generated = await p.default.generate();
    expect(generated.production.exports[0]!.value).toEqual([]);
    expect(generated.synthetic.exports[0]!.value.map((e) => (e as { ruleId: string }).ruleId)).toEqual(['test-replay-loader', 'test-replay-collect']);
  });

  it('refuses an open production gate (policy closed, no reviewer, no page fixtures, a regex rule)', async () => {
    const p = await plugin();
    const s = seed();
    const clarity = s.rules.find((r) => r['id'] === 'replay-clarity-letter')!;
    clarity['productionEnabled'] = true;
    clarity['fixtureVerified'] = true;
    const { errors, production } = await p.lintReplayTables({ seed: s, today: TODAY });
    const gate = errors.find((e) => e.includes('replay-clarity-letter') && e.includes('production gate'));
    expect(gate).toBeDefined();
    expect(gate).toMatch(/allowProductionRules/);
    expect(gate).toMatch(/reviewer/);
    expect(gate).toMatch(/regex/);
    expect(production).toEqual([]);
  });

  it('index-only and product-catalog vendors carry no rules; candidates need a documented artifact', async () => {
    const p = await plugin();
    const s = seed();
    const hotjar = s.vendors.find((v) => v['id'] === 'hotjar')!;
    hotjar['ruleIds'] = ['replay-fullstory-hosts'];
    const { errors } = await p.lintReplayTables({ seed: s, today: TODAY });
    expect(errors.some((e) => e.startsWith('vendor hotjar') && e.includes('carry no rules'))).toBe(true);
  });

  it('regexes outside the strict dialect and failing matcher fixtures are errors', async () => {
    const p = await plugin();
    for (const [regex, pattern] of [['^(?:a|aa){1,60}b$', /alternation inside a repeated group/], ['^[a-z]+$', /unbounded quantifier/], ['[a-z]', /anchored/]] as const) {
      const s = seed();
      ((s.rules.find((r) => r['id'] === 'replay-clarity-letter')!)['conditions'] as Record<string, unknown>)['leftmostLabelRegex'] = regex;
      const { errors } = await p.lintReplayTables({ seed: s, today: TODAY });
      expect(errors.some((e) => pattern.test(e)), regex + ': ' + errors.join(' | ')).toBe(true);
    }
    const s = seed();
    const lucky = s.rules.find((r) => r['id'] === 'replay-luckyorange-loader')!;
    (lucky['matcherFixtures'] as { negative: unknown[] }).negative.push({ scheme: 'https', host: 'tools.luckyorange.com', path: '/core/lo.js', kind: 'script' });
    const { errors } = await p.lintReplayTables({ seed: s, today: TODAY });
    expect(errors.some((e) => e.includes('replay-luckyorange-loader.matcherFixtures.negative') && e.includes('expected no match'))).toBe(true);
  });

  it('ids never collide with the vendor catalog; sources are https and read no later than today', async () => {
    const p = await plugin();
    const s = seed();
    s.vendors[0]!['id'] = 'cloudflare';
    const later = seed();
    ((later.vendors[1]!['sources'] as Array<Record<string, unknown>>)[0]!)['accessedAt'] = '2026-12-01';
    expect((await p.lintReplayTables({ seed: s, today: TODAY })).errors.some((e) => e.includes('collides with the vendor catalog'))).toBe(true);
    expect((await p.lintReplayTables({ seed: later, today: TODAY })).errors.some((e) => e.includes('in the future'))).toBe(true);
  });

  it('synthetic entries: loopback or reserved example.* hosts only, test- ids, refused outside the test profile', async () => {
    const p = await plugin();
    const syn = synthetic();
    (syn.entries[1]!['conditions'] as Record<string, unknown>)['hostExact'] = 'collect.realvendor.com';
    const { errors } = await p.lintReplayTables({ synthetic: syn, today: TODAY });
    expect(errors.some((e) => e.includes('only loopback or reserved example.* hosts'))).toBe(true);
  });

  it('stress inputs: at most 32 strings of 512 characters built from the atoms', async () => {
    const p = await plugin();
    const inputs = p.stressInputs('^[a-z0-9-]{1,63}$');
    expect(inputs.length).toBeLessThanOrEqual(32);
    expect(inputs.length).toBeGreaterThan(4);
    for (const s of inputs) expect(s).toHaveLength(512);
  });
});
