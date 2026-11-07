// ADR-020 §E (S11): session recording levels (truth table R1–R5, `high` never, no replay-recording without sampled-stack
// attribution or an enabled vendor rule), cadence (glue, series, reset, body buckets), hook availability, limitations,
// the replay table (closed shape, no regex, synthetic only when allowed) and the summary shape (JSON Schema).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { PROTECT_BUDGETS, PROTECT_LIMITATIONS } from '@detect-expert/contracts';
import type { ReplaySummary } from '@detect-expert/contracts';
import {
  REPLAY_ALWAYS_LIMITATIONS,
  REPLAY_THRESHOLDS,
  createCadence,
  createReplayFacts,
  deriveReplay,
  deriveReplayDetailed,
  higherReplay,
  matchReplayEntry,
  noteReplayRegistration,
  parseReplayEntries,
  readReplayThresholds,
  replayBodySize,
  replayEventGroup,
  sameReplaySummary,
  stepCadence,
} from '../src/protect/replay';
import type { ReplayCadence, ReplayDeriveOptions, ReplayFacts, ReplayRequestView } from '../src/protect/replay';

const schemasDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'contracts', 'schemas');
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(JSON.parse(readFileSync(join(schemasDir, 'common.v1.schema.json'), 'utf8')) as Record<string, unknown>);
const validateSummary = ajv.compile({ $ref: 'urn:detect-expert:contracts:common:v1#/$defs/replaySummary' });

const ON: ReplayDeriveOptions = { hooks: { listen: true, observe: true }, vendorRulesEnabled: true };

/** A cadence with `run` bursts 1.5 s apart, each with `bytes` (null = not observed). */
function cadence(run: number, bytes: number | null): ReplayCadence {
  const c = createCadence();
  for (let i = 0; i < run; i++) stepCadence(c, 10_000 + i * 1500, bytes);
  return c;
}

interface Case {
  s1: boolean;
  s2: boolean;
  s3: boolean;
  s5: boolean;
  /** Sampled sites of S1 / S2: 'none' (unattributed), 'receiver' (= periodic receiver), 'other'. */
  attribution: 'none' | 'receiver' | 'other';
  /** The vendor's endpoint rule matched the periodic receiver. */
  vendorEndpoint: boolean;
}

function facts(c: Case): ReplayFacts {
  const f = createReplayFacts();
  const site = c.attribution === 'none' ? null : c.attribution === 'receiver' ? 'rec.test-net.org' : 'shop.test-com.org';
  if (c.s1) {
    noteReplayRegistration(f, { hookPoint: 'listen', eventCode: 'keydown', targetKind: 'document', count: 1, site });
    noteReplayRegistration(f, { hookPoint: 'listen', eventCode: 'mousemove', targetKind: 'window', count: 1, site });
  }
  if (c.s2) noteReplayRegistration(f, { hookPoint: 'observe-document', targetKind: 'document', count: 1, site });
  if (c.s3) f.periodic.push({ registrableDomain: 'rec.test-net.org', cadence: cadence(4, 2048), vendorIds: c.vendorEndpoint ? ['acme-replay'] : [] });
  if (c.s5) f.vendorResources.push({ vendorId: 'acme-replay', ruleIds: ['acme-replay-loader'], count: 1 });
  return f;
}

/** Independent oracle of ADR-020 §E / the S11 brief. */
function oracle(c: Case): ReplaySummary['level'] {
  const r4 = c.s1 && c.s2 && c.s3 && c.attribution === 'receiver';
  const r5 = c.s5 && c.s3 && c.vendorEndpoint && (c.s1 || c.s2);
  if (r4 || r5) return 'replay-recording';
  if ((c.s1 && c.s2 && c.s3) || (c.s5 && (c.s1 || c.s2))) return 'replay-like';
  return c.s1 || c.s2 || c.s3 || c.s5 ? 'signals-only' : 'none';
}

function allCases(): Case[] {
  const out: Case[] = [];
  for (let m = 0; m < 16; m++) {
    for (const attribution of ['none', 'receiver', 'other'] as const) {
      for (const vendorEndpoint of [false, true]) out.push({ s1: (m & 1) !== 0, s2: (m & 2) !== 0, s3: (m & 4) !== 0, s5: (m & 8) !== 0, attribution, vendorEndpoint });
    }
  }
  return out;
}

describe('thresholds', () => {
  it('the rule file is calibrated:false with the brief values', () => {
    expect(REPLAY_THRESHOLDS).toEqual({ ruleId: 'session-replay-behavior', ruleVersion: '1', calibrated: false, coalesceMs: 1000, maxGapMs: 15000, minPeriodicRun: 3, largeBodyBytes: 1024, minLargeSendsInRun: 2 });
  });

  it('a broken thresholds file never loads', () => {
    expect(() => readReplayThresholds({ ...REPLAY_THRESHOLDS, calibrated: true })).toThrow();
    expect(() => readReplayThresholds({ ...REPLAY_THRESHOLDS, coalesceMs: 20000 })).toThrow();
    expect(() => readReplayThresholds(null)).toThrow();
  });
});

describe('levels: truth table R1–R5', () => {
  it('every combination matches the oracle; high is never set; confidence follows the level', () => {
    for (const c of allCases()) {
      const s = deriveReplay(facts(c), ON);
      expect(s.level, JSON.stringify(c)).toBe(oracle(c));
      expect(['unassessed', 'low', 'medium']).toContain(s.interpretationConfidence);
      expect(s.interpretationConfidence, JSON.stringify(c)).toBe(s.level === 'replay-recording' ? 'medium' : s.level === 'replay-like' ? 'low' : 'unassessed');
      expect(JSON.stringify(s)).not.toContain('"high"');
      expect(validateSummary(s), JSON.stringify(validateSummary.errors)).toBe(true);
    }
  });

  it('replay-recording is unreachable without sampled-stack attribution or an enabled vendor rule', () => {
    for (const c of allCases()) {
      if (c.attribution === 'receiver') continue;
      const noVendor = deriveReplay(facts(c), { ...ON, vendorRulesEnabled: false });
      expect(noVendor.level, JSON.stringify(c)).not.toBe('replay-recording');
      if (!c.s5) expect(deriveReplay(facts(c), ON).level, JSON.stringify(c)).not.toBe('replay-recording');
    }
  });

  it('R4: sampled-stack attribution of S1 and S2 to the receiver site', () => {
    const d = deriveReplayDetailed(facts({ s1: true, s2: true, s3: true, s5: false, attribution: 'receiver', vendorEndpoint: false }), { ...ON, vendorRulesEnabled: false });
    expect(d.rules).toEqual(['R1', 'R4']);
    expect(d.summary).toMatchObject({ level: 'replay-recording', interpretationConfidence: 'medium', attributionConfidence: 'sampled-stack' });
    expect(d.linkedReceivers).toEqual(['rec.test-net.org']);
    expect(d.summary.signals.map((s) => s.linkedSite)).toEqual(['rec.test-net.org', 'rec.test-net.org', 'rec.test-net.org']);
    expect(d.summary.limitationCodes).not.toContain('no-script-attribution');
  });

  it('R1 without attribution: replay-like, no-script-attribution, attribution unknown, receivers linked', () => {
    const d = deriveReplayDetailed(facts({ s1: true, s2: true, s3: true, s5: false, attribution: 'none', vendorEndpoint: false }), { ...ON, vendorRulesEnabled: false });
    expect(d.summary).toMatchObject({ level: 'replay-like', interpretationConfidence: 'low', attributionConfidence: 'unknown' });
    expect(d.summary.limitationCodes).toContain('no-script-attribution');
    expect(d.summary.limitationCodes).toContain('vendor-rules-disabled');
    expect(d.linkedReceivers).toEqual(['rec.test-net.org']);
    expect(d.summary.signals.map((s) => s.code)).toEqual(['root-input-listeners', 'root-mutation-observe', 'periodic-third-party-send']);
    expect(d.summary.signals[0]).toMatchObject({ techniqueId: 'DET-043', evidenceSource: 'page-hook', integrity: 'page-controlled' });
    expect(d.summary.signals[2]).toMatchObject({ evidenceSource: 'browser-network', integrity: 'browser-observed', linkedSite: 'rec.test-net.org' });
  });

  it('R1 with scripts of another site: replay-like without the no-attribution code (the sites differ)', () => {
    const s = deriveReplay(facts({ s1: true, s2: true, s3: true, s5: false, attribution: 'other', vendorEndpoint: false }), ON);
    expect(s.level).toBe('replay-like');
    expect(s.attributionConfidence).toBe('unknown');
    expect(s.limitationCodes).not.toContain('no-script-attribution');
    expect(s.signals[0]!.linkedSite).toBe('shop.test-com.org');
  });

  it('R3 / R5: an enabled vendor rule; vendors listed as documented resources', () => {
    const r3 = deriveReplayDetailed(facts({ s1: false, s2: true, s3: false, s5: true, attribution: 'none', vendorEndpoint: false }), ON);
    expect(r3.rules).toEqual(['R3']);
    expect(r3.summary.level).toBe('replay-like');
    expect(r3.linkedReceivers).toEqual([]);
    expect(r3.summary.vendors).toEqual([{ vendorId: 'acme-replay', vendorConfidence: 'documented-resource', ruleIds: ['acme-replay-loader'], evidenceSource: 'browser-network', integrity: 'browser-observed' }]);
    const r5 = deriveReplayDetailed(facts({ s1: true, s2: false, s3: true, s5: true, attribution: 'none', vendorEndpoint: true }), ON);
    expect(r5.rules).toEqual(['R3', 'R5']);
    expect(r5.summary).toMatchObject({ level: 'replay-recording', interpretationConfidence: 'medium', attributionConfidence: 'unknown' });
    expect(r5.linkedReceivers).toEqual(['rec.test-net.org']);
  });

  it('vendor resources are ignored while no rule of the table is enabled (production)', () => {
    const s = deriveReplay(facts({ s1: true, s2: true, s3: false, s5: true, attribution: 'none', vendorEndpoint: true }), { ...ON, vendorRulesEnabled: false });
    expect(s.level).toBe('signals-only');
    expect(s.vendors).toEqual([]);
    expect(s.limitationCodes).toContain('vendor-rules-disabled');
  });

  it('no signal: level none with the coverage limitations only', () => {
    const s = deriveReplay(createReplayFacts(), { ...ON, vendorRulesEnabled: false });
    expect(s).toMatchObject({ level: 'none', interpretationConfidence: 'unassessed', attributionConfidence: 'unknown', signals: [], periodicHosts: [], vendors: [], inputMasking: 'unconfirmed' });
    for (const code of REPLAY_ALWAYS_LIMITATIONS) expect(s.limitationCodes).toContain(code);
    expect(s.limitationCodes).toEqual(PROTECT_LIMITATIONS.filter((l) => s.limitationCodes.includes(l)));
  });
});

describe('S1 / S2: registrations', () => {
  it('only window / document listeners of both groups make S1; element and field listeners never count', () => {
    const f = createReplayFacts();
    expect(noteReplayRegistration(f, { hookPoint: 'listen', eventCode: 'keydown', targetKind: 'field', count: 3, site: null })).toBe(false);
    expect(noteReplayRegistration(f, { hookPoint: 'listen', eventCode: 'mousemove', targetKind: 'other', count: 3, site: null })).toBe(false);
    expect(noteReplayRegistration(f, { hookPoint: 'listen', eventCode: 'scroll', targetKind: 'root', count: 3, site: null })).toBe(false);
    expect(noteReplayRegistration(f, { hookPoint: 'listen', eventCode: 'focusin', targetKind: 'window', count: 3, site: null })).toBe(false);
    expect(deriveReplay(f, ON).level).toBe('none');
    noteReplayRegistration(f, { hookPoint: 'listen', eventCode: 'keyup', targetKind: 'window', count: 1, site: null });
    expect(deriveReplay(f, ON).level).toBe('none'); // keyboard only: no pointer group
    noteReplayRegistration(f, { hookPoint: 'listen', eventCode: 'wheel', targetKind: 'document', count: 2, site: null });
    const s = deriveReplay(f, ON);
    expect(s.level).toBe('signals-only');
    expect(s.signals).toEqual([{ code: 'root-input-listeners', techniqueId: 'DET-043', evidenceSource: 'page-hook', integrity: 'page-controlled', count: 3, countQuality: 'exact' }]);
  });

  it('event groups', () => {
    for (const code of ['input', 'beforeinput', 'change', 'keydown', 'keyup', 'keypress'] as const) expect(replayEventGroup(code)).toBe('input');
    for (const code of ['mousemove', 'pointermove', 'touchmove', 'scroll', 'wheel'] as const) expect(replayEventGroup(code)).toBe('pointer');
    for (const code of ['paste', 'copy', 'cut', 'focusin', 'focusout', 'blur', 'selectionchange'] as const) expect(replayEventGroup(code)).toBeNull();
    expect(replayEventGroup(undefined)).toBeNull();
  });

  it('hooks off: S1 / S2 unavailable with listener-hook-off / mo-hook-off; the level falls to signals-only', () => {
    const f = facts({ s1: true, s2: true, s3: true, s5: false, attribution: 'receiver', vendorEndpoint: false });
    const s = deriveReplay(f, { hooks: { listen: false, observe: false }, vendorRulesEnabled: false });
    expect(s.level).toBe('signals-only');
    expect(s.signals.map((x) => x.code)).toEqual(['periodic-third-party-send']);
    expect(s.limitationCodes).toEqual(expect.arrayContaining(['listener-hook-off', 'mo-hook-off']));
    const listenOnly = deriveReplay(f, { hooks: { listen: true, observe: false }, vendorRulesEnabled: false });
    expect(listenOnly.signals.map((x) => x.code)).toEqual(['root-input-listeners', 'periodic-third-party-send']);
    expect(listenOnly.limitationCodes).toContain('mo-hook-off');
    expect(listenOnly.limitationCodes).not.toContain('listener-hook-off');
  });

  it('attributed sites are bounded', () => {
    const f = createReplayFacts();
    for (let i = 0; i < 20; i++) noteReplayRegistration(f, { hookPoint: 'observe-document', targetKind: 'document', count: 1, site: 's' + String(i) + '.example.org' });
    expect(f.observeDocument.sites).toHaveLength(8);
    expect(f.observeDocument.count).toBe(20);
  });
});

describe('S3: cadence', () => {
  it('glues sends under 1 s into one burst; a series continues up to 15 s; a longer pause starts a new series', () => {
    const c = createCadence();
    stepCadence(c, 0, 2000);
    stepCadence(c, 400, 2000); // glued
    stepCadence(c, 900, 2000); // glued (900 - 400 < 1000)
    expect(c).toMatchObject({ run: 1, runMax: 1, sends: 3, large: 1 });
    stepCadence(c, 2000, 2000);
    stepCadence(c, 16_999, 2000); // 14 999 ms pause: same series
    expect(c).toMatchObject({ run: 3, runMax: 3, qualified: true });
    stepCadence(c, 40_000, 2000); // > 15 s: a new series
    expect(c).toMatchObject({ run: 1, runMax: 3, large: 1, largeInRunMax: 3, qualified: true });
  });

  it('periodic but small bodies (heartbeat) never qualify; unknown bodies do (not observed)', () => {
    const small = cadence(10, 100);
    expect(small).toMatchObject({ runMax: 10, qualified: false, largeInRunMax: 0 });
    const unknown = cadence(3, null);
    expect(unknown).toMatchObject({ runMax: 3, qualified: true, unknownSends: 3 });
    const two = cadence(2, 5000);
    expect(two.qualified).toBe(false);
  });

  it('a burst counts once and upgrades from unknown to large; one large burst is not enough', () => {
    const c = createCadence();
    stepCadence(c, 0, null);
    stepCadence(c, 100, 4096); // same burst: unknown -> large
    expect(c).toMatchObject({ large: 1, unknown: 0 });
    stepCadence(c, 1500, 10);
    stepCadence(c, 3000, 10);
    expect(c).toMatchObject({ run: 3, qualified: false });
    stepCadence(c, 4500, 2048);
    expect(c.qualified).toBe(true);
  });

  it('bounded counters (run ceiling) and out-of-order times', () => {
    const c = createCadence();
    for (let i = 0; i < 1200; i++) stepCadence(c, i * 2000, 2048);
    expect(c.runMax).toBe(PROTECT_BUDGETS.replayRunMaxCeiling);
    expect(c.largeInRunMax).toBe(PROTECT_BUDGETS.replayRunMaxCeiling);
    const back = createCadence();
    stepCadence(back, 5000, 10);
    stepCadence(back, 4000, 10); // earlier timestamp: glued, lastAt kept
    expect(back).toMatchObject({ run: 1, lastAt: 5000, sends: 2 });
  });

  it('body buckets (never the number)', () => {
    expect(replayBodySize(null)).toBe('not-observed');
    expect(replayBodySize(0)).toBe('empty');
    expect(replayBodySize(1023)).toBe('under-1k');
    expect(replayBodySize(1024)).toBe('1k-16k');
    expect(replayBodySize(16384)).toBe('1k-16k');
    expect(replayBodySize(16385)).toBe('over-16k');
  });

  it('periodic hosts: top 8 by runMax, truncation, body-size-not-observed, masking from value-match receivers', () => {
    const f = createReplayFacts();
    for (let i = 0; i < 10; i++) f.periodic.push({ registrableDomain: 'r' + String(i) + '.example.org', cadence: cadence(3 + i, i === 9 ? null : 2048), vendorIds: [] });
    f.periodic.push({ registrableDomain: '10.0.0.1', cadence: cadence(20, 2048), vendorIds: [] });
    const s = deriveReplay(f, { ...ON, valueSeenReceivers: ['r5.example.org'] });
    expect(s.periodicHosts.map((h) => h.registrableDomain)).toEqual(['r9', 'r8', 'r7', 'r6', 'r5', 'r4', 'r3', 'r2'].map((x) => x + '.example.org'));
    expect(s.periodicHosts[0]).toEqual({ registrableDomain: 'r9.example.org', runMax: 12, sends: 12, largeInRunMax: 0, bodySize: 'not-observed' });
    expect(s.periodicHosts[1]!.bodySize).toBe('1k-16k');
    expect(s.limitationCodes).toEqual(expect.arrayContaining(['periodic-hosts-truncated', 'body-size-not-observed']));
    expect(s.inputMasking).toBe('value-seen-in-traffic');
    expect(s.signals[0]).toMatchObject({ code: 'periodic-third-party-send', countQuality: 'lower-bound' });
    expect(deriveReplay(f, { ...ON, valueSeenReceivers: ['r0.example.org'] }).inputMasking).toBe('unconfirmed');
  });

  it('loaded-before-enable and cadence-reset are reported', () => {
    const s = deriveReplay(createReplayFacts(), { ...ON, loadedBeforeEnable: true, cadenceReset: true });
    expect(s.limitationCodes).toEqual(expect.arrayContaining(['loaded-before-enable', 'cadence-reset']));
  });
});

describe('replay table', () => {
  const view = (over: Partial<ReplayRequestView>): ReplayRequestView => ({ scheme: 'https', host: 'cdn.example.org', port: null, path: '/r.js', kind: 'script', ...over });

  it('closed shape: unknown keys, regex conditions, URLs and synthetic data outside the test profile are dropped', () => {
    const raw = [
      { ruleId: 'a-loader', vendorId: 'a', role: 'resource', conditions: { hostExact: 'cdn.example.org', pathExact: '/r.js' } },
      { ruleId: 'b', vendorId: 'b', role: 'resource', conditions: { hostSuffixLabels: 'example.org', leftmostLabelRegex: '^[a-z]$' } },
      { ruleId: 'c', vendorId: 'c', role: 'resource', conditions: { url: 'https://x.example.org/' } },
      { ruleId: 'd', vendorId: 'd', role: 'endpoint', conditions: { hostExact: 'x.example.org', portExact: 4174 } },
      { ruleId: 'e', vendorId: 'e', role: 'endpoint', conditions: { hostExact: 'x.example.org', portExact: 4174 }, synthetic: true },
      { ruleId: 'f', vendorId: 'f', role: 'resource', conditions: { hostExact: 'a.example.org', hostOneOf: ['b.example.org'] } },
      { ruleId: 'g', vendorId: 'g', role: 'other', conditions: { hostExact: 'a.example.org' } },
      { ruleId: 'h', vendorId: 'h', role: 'resource', conditions: { hostExact: 'a.example.org' }, extra: 1 },
    ];
    expect(parseReplayEntries(raw, { allowSynthetic: false }).map((e) => e.ruleId)).toEqual(['a-loader']);
    expect(parseReplayEntries(raw, { allowSynthetic: true }).map((e) => e.ruleId)).toEqual(['a-loader', 'e']);
  });

  it('matching: resources only for scripts, endpoints only for xhr / beacon; default port unless portExact', () => {
    const [res, end, suf] = parseReplayEntries(
      [
        { ruleId: 'r', vendorId: 'v', role: 'resource', conditions: { scheme: 'https', hostExact: 'cdn.example.org', pathExact: '/r.js' } },
        { ruleId: 'e', vendorId: 'v', role: 'endpoint', conditions: { hostOneOf: ['in.example.org'] } },
        { ruleId: 's', vendorId: 'v', role: 'endpoint', conditions: { hostSuffixLabels: 'example.net' } },
      ],
      { allowSynthetic: false },
    );
    expect(matchReplayEntry(res!, view({}))).toBe(true);
    expect(matchReplayEntry(res!, view({ kind: 'xhr' }))).toBe(false);
    expect(matchReplayEntry(res!, view({ scheme: 'http' }))).toBe(false);
    expect(matchReplayEntry(res!, view({ port: 8443 }))).toBe(false);
    expect(matchReplayEntry(res!, view({ path: '/r.js2' }))).toBe(false);
    expect(matchReplayEntry(end!, view({ host: 'in.example.org', kind: 'beacon', path: '/any' }))).toBe(true);
    expect(matchReplayEntry(end!, view({ host: 'in.example.org', kind: 'script' }))).toBe(false);
    expect(matchReplayEntry(suf!, view({ host: 'example.net', kind: 'xhr' }))).toBe(true);
    expect(matchReplayEntry(suf!, view({ host: 'a.example.net', kind: 'xhr' }))).toBe(true);
    expect(matchReplayEntry(suf!, view({ host: 'a.b.example.net', kind: 'xhr' }))).toBe(false);
    expect(matchReplayEntry(suf!, view({ host: 'badexample.net', kind: 'xhr' }))).toBe(false);
    const [port] = parseReplayEntries([{ ruleId: 'p', vendorId: 'v', role: 'resource', conditions: { hostExact: '127.0.0.1', portExact: 4174, pathExact: '/replay/loader.js' }, synthetic: true }], { allowSynthetic: true });
    expect(matchReplayEntry(port!, view({ scheme: 'http', host: '127.0.0.1', port: 4174, path: '/replay/loader.js' }))).toBe(true);
    expect(matchReplayEntry(port!, view({ scheme: 'http', host: '127.0.0.1', port: null, path: '/replay/loader.js' }))).toBe(false);
  });
});

describe('summary helpers', () => {
  it('higherReplay keeps the higher level; sameReplaySummary compares fields', () => {
    const like = deriveReplay(facts({ s1: true, s2: true, s3: true, s5: false, attribution: 'none', vendorEndpoint: false }), ON);
    const none = deriveReplay(createReplayFacts(), ON);
    expect(higherReplay(none, like)).toBe(like);
    expect(higherReplay(like, none)).toBe(like);
    expect(sameReplaySummary(like, deriveReplay(facts({ s1: true, s2: true, s3: true, s5: false, attribution: 'none', vendorEndpoint: false }), ON))).toBe(true);
    expect(sameReplaySummary(like, none)).toBe(false);
    expect(sameReplaySummary(null, none)).toBe(false);
  });

  it('a summary never carries a URL, a query, a body size number or a value', () => {
    const f = facts({ s1: true, s2: true, s3: true, s5: true, attribution: 'receiver', vendorEndpoint: true });
    const text = JSON.stringify(deriveReplay(f, ON));
    expect(text).not.toMatch(/https?:|\?|2048/);
  });
});
