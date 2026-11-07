// Rule audio-offline-graph v1 (E08-01, S05; DET-015/016). Counter scenarios mirror the fixtures
// (fixtures/audio-fp-positive.html, audio-synth-negative.html, audio-editor-negative.html) at counter level.

import { describe, expect, it } from 'vitest';
import type { CounterEntry, CoverageFlag, OperationCode, Phase, SignalCode, TechniqueId } from '@detect-expert/contracts';
import {
  AUDIO_RULE_ID,
  AUDIO_RULE_PARAMS,
  AUDIO_RULE_VERSION,
  LIMITATION_CODES,
  audioSequenceMet,
  audioStats,
  evaluateAudio,
  runRules,
} from '../src/index';
import { counter } from './fixtures';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const READOUT_OPS: ReadonlySet<OperationCode> = new Set<OperationCode>([
  'get-channel-data',
  'copy-from-channel',
  'analyser-float-frequency',
  'analyser-byte-frequency',
  'analyser-float-time-domain',
  'analyser-byte-time-domain',
]);

function op(
  operationCode: OperationCode,
  count: number,
  extra: { phase?: Phase; offline?: boolean; countQuality?: CounterEntry['countQuality'] } = {},
): CounterEntry {
  const techniqueId: TechniqueId = READOUT_OPS.has(operationCode) ? 'DET-016' : 'DET-015';
  const phase: Phase = extra.phase ?? (operationCode === 'start-rendering' ? 'settlement-unobserved' : 'returned-sync');
  const offline = extra.offline ?? (techniqueId === 'DET-015');
  const signalCodes: SignalCode[] = offline ? ['api-use', 'offline-render'] : ['api-use'];
  return {
    ...counter({ techniqueId, count, phase, signalCodes, ...(extra.countQuality !== undefined ? { countQuality: extra.countQuality } : {}) }),
    operationCode,
  };
}

/** fixtures/audio-fp-positive.html: triangle oscillator -> compressor -> destination offline, render, getChannelData. */
const POSITIVE: CounterEntry[] = [
  op('create-oscillator', 1),
  op('create-dynamics-compressor', 1),
  op('connect-osc-compressor', 1),
  op('start-rendering', 1),
  op('get-channel-data', 1),
];

/** fixtures/audio-synth-negative.html: realtime context, osc -> gain -> compressor, 60 analyser reads. */
const SYNTH: CounterEntry[] = [
  op('create-oscillator', 1, { offline: false }),
  op('create-dynamics-compressor', 1, { offline: false }),
  op('analyser-byte-frequency', 60),
];

/** fixtures/audio-editor-negative.html: buffer writes, bounce through a compressor offline, no oscillator. */
const EDITOR: CounterEntry[] = [
  op('create-dynamics-compressor', 1),
  op('start-rendering', 1),
  op('get-channel-data', 3),
];

function interpretations(counters: readonly CounterEntry[], flags: CoverageFlag[] = []): string[] {
  return evaluateAudio({ counters, coverageFlags: flags }).map((f) => f.techniqueId + ':' + f.interpretation + ':' + f.interpretationConfidence);
}

describe('audio-offline-graph v1', () => {
  it('parameters are proposed, not calibrated, with a low ceiling', () => {
    expect(AUDIO_RULE_ID).toBe('audio-offline-graph');
    expect(AUDIO_RULE_VERSION).toBe('1');
    expect(AUDIO_RULE_PARAMS).toEqual({ ruleVersion: '1', calibrated: false, possibleConfidence: 'low', maxConfidence: 'low' });
  });

  it('positive: api-use for DET-015 and DET-016, possible-fingerprinting/low on DET-015 with the sequence as evidence', () => {
    const findings = evaluateAudio({ counters: POSITIVE, coverageFlags: [], coverageRef: 'cov-1' });
    expect(findings.map((f) => f.findingId)).toEqual([
      'audio-offline-graph-v1-DET-015-api-use',
      'audio-offline-graph-v1-DET-016-api-use',
      'audio-offline-graph-v1-DET-015-possible-fingerprinting',
    ]);
    for (const f of findings) {
      expect(f.findingId).toMatch(ID_RE);
      expect(f.ruleId).toBe('audio-offline-graph');
      expect(f.coverageRef).toBe('cov-1');
      expect(f.vendorMatchIds).toEqual([]);
    }
    const fp = findings[2]!;
    expect(fp.interpretationConfidence).toBe('low');
    expect(fp.evidenceIds).toEqual([
      'DET-015|returned-sync|api-use,offline-render|connect-osc-compressor',
      'DET-015|settlement-unobserved|api-use,offline-render|start-rendering',
      'DET-016|returned-sync|api-use|get-channel-data',
    ]);
    expect(fp.limitationCodes).toEqual([
      LIMITATION_CODES.pageControlledEvidence,
      LIMITATION_CODES.purposeUnknown,
      LIMITATION_CODES.uniquenessNotEstablished,
      LIMITATION_CODES.uncalibratedThreshold,
      LIMITATION_CODES.noTimeWindow,
      LIMITATION_CODES.bufferOriginUnknown,
    ]);
    expect(findings[0]!.limitationCodes).toEqual([LIMITATION_CODES.pageControlledEvidence, LIMITATION_CODES.purposeUnknown]);
    expect(findings[1]!.limitationCodes).not.toContain(LIMITATION_CODES.bufferOriginUnknown);
  });

  it('synth and editor negatives stay api-use', () => {
    expect(interpretations(SYNTH)).toEqual(['DET-015:api-use:unassessed', 'DET-016:api-use:unassessed']);
    expect(interpretations(EDITOR)).toEqual(['DET-015:api-use:unassessed', 'DET-016:api-use:unassessed']);
  });

  it('every part of the conjunction is required', () => {
    const without = (code: OperationCode) => POSITIVE.filter((c) => c.operationCode !== code);
    expect(audioSequenceMet(audioStats(POSITIVE, []))).toBe(true);
    expect(audioSequenceMet(audioStats(without('connect-osc-compressor'), []))).toBe(false);
    expect(audioSequenceMet(audioStats(without('start-rendering'), []))).toBe(false);
    expect(audioSequenceMet(audioStats(without('get-channel-data'), []))).toBe(false);
    // copyFromChannel is an equivalent buffer read; analyser reads are not.
    expect(audioSequenceMet(audioStats([...without('get-channel-data'), op('copy-from-channel', 1)], []))).toBe(true);
    expect(audioSequenceMet(audioStats([...without('get-channel-data'), op('analyser-float-frequency', 30)], []))).toBe(false);
  });

  it('the link must be offline, successful and counted; rendering must not be a throw; the read must succeed', () => {
    const replace = (code: OperationCode, next: CounterEntry) => [...POSITIVE.filter((c) => c.operationCode !== code), next];
    expect(interpretations(replace('connect-osc-compressor', op('connect-osc-compressor', 1, { offline: false })))).not.toContain('DET-015:possible-fingerprinting:low');
    expect(interpretations(replace('connect-osc-compressor', op('connect-osc-compressor', 0)))).not.toContain('DET-015:possible-fingerprinting:low');
    expect(interpretations(replace('start-rendering', op('start-rendering', 1, { phase: 'threw-sync' })))).not.toContain('DET-015:possible-fingerprinting:low');
    expect(interpretations(replace('get-channel-data', op('get-channel-data', 2, { phase: 'threw-sync' })))).not.toContain('DET-015:possible-fingerprinting:low');
  });

  it('degraded coverage adds coverage-incomplete and keeps the ceiling at low', () => {
    for (const flags of [['late-start'], ['hook-failed'], ['budget-exceeded']] as CoverageFlag[][]) {
      const findings = evaluateAudio({ counters: POSITIVE, coverageFlags: flags });
      for (const f of findings) expect(f.limitationCodes).toContain(LIMITATION_CODES.coverageIncomplete);
      expect(findings.find((f) => f.interpretation === 'possible-fingerprinting')!.interpretationConfidence).toBe('low');
    }
    const lowerBound = [...POSITIVE.slice(0, 4), op('get-channel-data', 1, { countQuality: 'lower-bound' })];
    expect(evaluateAudio({ counters: lowerBound, coverageFlags: [] })[1]!.limitationCodes).toContain(LIMITATION_CODES.coverageIncomplete);
  });

  it('ignores other techniques; no audio counters -> no findings', () => {
    expect(evaluateAudio({ counters: [counter({ techniqueId: 'DET-002', count: 3 })], coverageFlags: [] })).toEqual([]);
    expect(evaluateAudio({ counters: [], coverageFlags: [] })).toEqual([]);
  });

  it('registered: runRules gives audio findings only from this rule; no value-like numbers leak into findings', () => {
    const { findings } = runRules({ counters: [...POSITIVE, counter({ techniqueId: 'DET-025', count: 1 })], coverageFlags: [] });
    const audio = findings.filter((f) => f.techniqueId === 'DET-015' || f.techniqueId === 'DET-016');
    expect(audio.map((f) => f.ruleId)).toEqual([AUDIO_RULE_ID, AUDIO_RULE_ID, AUDIO_RULE_ID]);
    expect(JSON.stringify(audio).replace(/DET-\d{3}/g, '')).not.toMatch(/\d{3,}/);
  });
});
