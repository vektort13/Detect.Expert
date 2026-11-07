// Rule 'audio-offline-graph' v1 (E08-01, S05; DET-015/016; spec III §2.2 rows DET-015/016, §3.3 rule style, I §4.1;
// REQ-001, REQ-007). Traceability: CLM-23/24 (api-use) and CLM-25 (possible-fingerprinting) in PRD §6.1.
//
// What it says and what it does not:
// - 'api-use' / unassessed per observed audio technique: an observation, never a verdict.
// - 'possible-fingerprinting' / low on DET-015 only when, over the document lifetime, the page did all of:
//   connected an oscillator to a dynamics compressor on an OfflineAudioContext (`connect-osc-compressor` with
//   `offline-render`, returned-sync), started offline rendering (`start-rendering`, settlement-unobserved) and read
//   audio buffer data (`get-channel-data` or `copy-from-channel`, returned-sync). Purpose, uniqueness, transmission
//   and "this is not an audio editor or synthesizer" are not established; that the buffer read is the rendered one is
//   not established either (buffer-origin-unknown): buffers are never inspected.
// - Without early capture (late start) the sensor never records the connect link, so the possible tier cannot be
//   reached on such documents (and coverage says so).
// - Counts cover the document lifetime; no time window is established (no-time-window).
// - ADR-001 §7: low/unassessed before calibration; the parameter file cannot raise the ceiling (capLow).
//
// THRESHOLDS ARE PROPOSED (calibrated === false). They were not fitted to fixtures and must not be tuned to make a
// test pass. Calibration corpus: ADR-010 / E15-01 (not available, E09-01 BLOCKED).

import type { CounterEntry, Finding, InterpretationConfidence, OperationCode } from '@detect-expert/contracts';
import { LIMITATION_CODES } from '../codes';
import { AUDIO_TECHNIQUE_IDS, isAudioTechnique, type AudioTechniqueId } from '../techniques';
import { capLow, isDegraded } from './shared';
import parameters from './thresholds/audio-offline-graph.v1.json';
import { evidenceIdsOf, makeFinding, type Rule, type RuleInput } from './types';

export const AUDIO_RULE_ID = 'audio-offline-graph';
export const AUDIO_RULE_VERSION = parameters.ruleVersion;

/** PROPOSED parameters — not calibrated. Changing a value = new ruleVersion + reviewer sign-off. */
export const AUDIO_RULE_PARAMS = Object.freeze({
  ...parameters,
  possibleConfidence: parameters.possibleConfidence as InterpretationConfidence,
  maxConfidence: parameters.maxConfidence as InterpretationConfidence,
});

const T_GRAPH: AudioTechniqueId = 'DET-015';
const T_READOUT: AudioTechniqueId = 'DET-016';
const BUFFER_READS: ReadonlySet<OperationCode> = new Set<OperationCode>(['get-channel-data', 'copy-from-channel']);

export interface AudioStats {
  /** returned-sync oscillator -> compressor link observed on an OfflineAudioContext. */
  offlineLink: boolean;
  /** startRendering called (settlement-unobserved, positive count). */
  rendering: boolean;
  /** returned-sync getChannelData / copyFromChannel. */
  bufferRead: boolean;
  /** Audio counters or document coverage were degraded. */
  degraded: boolean;
  /** Counters that make up the sequence (evidence of the possible-fingerprinting finding). */
  sequenceCounters: CounterEntry[];
}

function isOfflineLink(c: CounterEntry): boolean {
  return (
    c.techniqueId === T_GRAPH &&
    c.operationCode === 'connect-osc-compressor' &&
    c.phase === 'returned-sync' &&
    c.signalCodes.includes('offline-render') &&
    c.count > 0
  );
}

function isRendering(c: CounterEntry): boolean {
  return c.techniqueId === T_GRAPH && c.operationCode === 'start-rendering' && c.phase === 'settlement-unobserved' && c.count > 0;
}

function isBufferRead(c: CounterEntry): boolean {
  return (
    c.techniqueId === T_READOUT &&
    c.operationCode !== undefined &&
    BUFFER_READS.has(c.operationCode) &&
    c.phase === 'returned-sync' &&
    c.count > 0
  );
}

export function audioStats(counters: readonly CounterEntry[], coverageFlags: RuleInput['coverageFlags']): AudioStats {
  const own = counters.filter((c) => isAudioTechnique(c.techniqueId));
  return {
    offlineLink: own.some(isOfflineLink),
    rendering: own.some(isRendering),
    bufferRead: own.some(isBufferRead),
    degraded: isDegraded(own, coverageFlags),
    sequenceCounters: own.filter((c) => isOfflineLink(c) || isRendering(c) || isBufferRead(c)),
  };
}

/** The conjunction of the v1 condition (all three parts). */
export function audioSequenceMet(stats: AudioStats): boolean {
  return stats.offlineLink && stats.rendering && stats.bufferRead;
}

export function evaluateAudio(input: RuleInput): Finding[] {
  const byTechnique = new Map<AudioTechniqueId, CounterEntry[]>();
  for (const c of input.counters) {
    if (!isAudioTechnique(c.techniqueId)) continue;
    const list = byTechnique.get(c.techniqueId);
    if (list === undefined) byTechnique.set(c.techniqueId, [c]);
    else list.push(c);
  }
  if (byTechnique.size === 0) return [];

  const stats = audioStats(input.counters, input.coverageFlags);
  const base = {
    ruleId: AUDIO_RULE_ID,
    ruleVersion: AUDIO_RULE_VERSION,
    ...(input.coverageRef !== undefined ? { coverageRef: input.coverageRef } : {}),
  };
  const degraded = stats.degraded ? [LIMITATION_CODES.coverageIncomplete] : [];

  // Observation level (CLM-23 DET-015, CLM-24 DET-016).
  const findings: Finding[] = [];
  for (const id of AUDIO_TECHNIQUE_IDS) {
    const list = byTechnique.get(id);
    if (list === undefined) continue;
    findings.push(
      makeFinding({
        ...base,
        techniqueId: id,
        interpretation: 'api-use',
        interpretationConfidence: 'unassessed',
        evidenceIds: evidenceIdsOf(list),
        counterEvidenceCodes: [],
        limitationCodes: [LIMITATION_CODES.pageControlledEvidence, LIMITATION_CODES.purposeUnknown, ...degraded],
      }),
    );
  }

  // Interpretation level (CLM-25): the full v1 conjunction, never a single call.
  if (!audioSequenceMet(stats)) return findings;
  findings.push(
    makeFinding({
      ...base,
      techniqueId: T_GRAPH,
      interpretation: 'possible-fingerprinting',
      interpretationConfidence: capLow(stats.degraded ? 'low' : AUDIO_RULE_PARAMS.possibleConfidence, AUDIO_RULE_PARAMS.maxConfidence),
      evidenceIds: evidenceIdsOf(stats.sequenceCounters),
      counterEvidenceCodes: [],
      limitationCodes: [
        LIMITATION_CODES.pageControlledEvidence,
        LIMITATION_CODES.purposeUnknown,
        LIMITATION_CODES.uniquenessNotEstablished,
        LIMITATION_CODES.uncalibratedThreshold,
        LIMITATION_CODES.noTimeWindow,
        LIMITATION_CODES.bufferOriginUnknown,
        ...degraded,
      ],
    }),
  );
  return findings;
}

export const audioRule: Rule = Object.freeze({
  ruleId: AUDIO_RULE_ID,
  ruleVersion: AUDIO_RULE_VERSION,
  techniqueIds: AUDIO_TECHNIQUE_IDS,
  evaluate: evaluateAudio,
});
