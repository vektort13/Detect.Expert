import { describe, expect, it } from 'vitest';
import { MAX_COUNT, TECHNIQUE_IDS } from '@detect-expert/contracts';
import { buildCards, buildVendorCards, countLabel, filterCards, filterVendorCards, selectTopCards } from '../src/view-models/cards';
import { categoriesWithFindings, countsView, hostsOf } from '../src/view-models/counts';
import { TECHNIQUE_INFO } from '../src/view-models/techniques';
import { fallbackMessage } from '../src/i18n';
import { resolveMessage } from '../src/view-models/message';
import { finding, report, technique, vendor } from './fixtures';

const r = (m: Parameters<typeof resolveMessage>[1]) => resolveMessage(fallbackMessage, m);

describe('technique table', () => {
  it('covers every DET id with a category and an API label', () => {
    for (const id of TECHNIQUE_IDS) {
      const info = TECHNIQUE_INFO[id];
      expect(info.api.length).toBeGreaterThan(0);
      expect(['graphics', 'audio', 'environment', 'permissions', 'storage', 'network']).toContain(info.category);
    }
    expect(Object.keys(TECHNIQUE_INFO)).toHaveLength(69);
  });
});

describe('buildCards: three levels per card', () => {
  it('canvas fingerprinting finding: observation / interpretation / purpose are distinct messages', () => {
    const rep = report({
      techniques: [technique({ techniqueId: 'DET-002', count: 4, phases: ['returned-sync'], signalCodes: ['readback-after-text'] })],
      findings: [finding({ findingId: 'f1', techniqueId: 'DET-002', interpretation: 'fingerprinting-pattern' })],
    });
    const [card] = buildCards(rep);
    expect(card).toBeDefined();
    expect(card!.kind).toBe('possible-fingerprinting');
    expect(r(card!.label)).toBe('card_fp_label');
    expect(r(card!.observation)).toBe('card_api_use_canvas_readback[CanvasRenderingContext2D.getImageData, 4]');
    expect(r(card!.interpretation)).toBe('card_fp_canvas_sequence');
    expect(card!.interpretationNote?.key).toBe('card_fp_not_proven');
    expect(r(card!.confidence)).toBe('confidence_medium');
    expect(r(card!.purpose)).toBe('card_api_use_purpose');
    expect(card!.ruleId).toBe('rule-canvas-sequence');
    expect(card!.ruleVersion).toBe('1');
    expect(card!.integrity).toBe('page-controlled');
    expect(card!.evidenceSource).toBe('page-hook');
    expect(card!.limitationCodes).toEqual(['page-controlled-data']);
    expect(card!.counterEvidenceCodes).toEqual(['image-editor']);
  });

  it('a technique without a finding becomes an api-use card with the ordinary-use note', () => {
    const rep = report({ techniques: [technique({ techniqueId: 'DET-032', count: 1 })] });
    const [card] = buildCards(rep);
    expect(card!.kind).toBe('api-use');
    expect(r(card!.label)).toBe('card_api_use_label');
    expect(r(card!.observation)).toBe('card_api_use_generic[navigator.hardwareConcurrency, 1]');
    expect(r(card!.interpretation)).toBe('card_api_use_generic_note');
    expect(card!.interpretationNote).toBeNull();
    expect(card!.ruleId).toBeNull();
  });

  it('math, webrtc, local probe and dns use their own observation and purpose wording', () => {
    const rep = report({
      techniques: [
        technique({ techniqueId: 'DET-022', count: 120, countQuality: 'sampled', interpretation: 'possible-fingerprinting', interpretationConfidence: 'low' }),
        technique({ techniqueId: 'DET-056', count: 2 }),
        technique({ techniqueId: 'DET-060', count: 9, interpretation: 'local-probe-pattern', interpretationConfidence: 'medium' }),
        technique({ techniqueId: 'DET-061', count: 30, interpretation: 'dns-test-pattern', interpretationConfidence: 'high' }),
      ],
    });
    const byId = Object.fromEntries(buildCards(rep).map((c) => [c.techniqueId, c]));
    expect(r(byId['DET-022']!.observation)).toBe('card_api_use_math[count_value_sampled[120]]');
    expect(r(byId['DET-022']!.interpretation)).toBe('card_fp_math_sequence');
    expect(r(byId['DET-056']!.observation)).toMatch(/^card_api_use_webrtc\[RTCPeerConnection/);
    expect(r(byId['DET-056']!.purpose)).toBe('card_fp_webrtc');
    expect(r(byId['DET-060']!.interpretation)).toBe('card_fp_local_probe');
    expect(r(byId['DET-060']!.purpose)).toBe('card_purpose_local_probe');
    expect(r(byId['DET-061']!.interpretation)).toBe('card_fp_dns_pattern');
    expect(r(byId['DET-061']!.purpose)).toBe('card_purpose_dns');
  });

  it('attempt-only (threw-sync) is flagged; unknown interpretation says not enough data', () => {
    const rep = report({
      techniques: [
        technique({ techniqueId: 'DET-001', count: 1, phases: ['threw-sync'], interpretation: 'unknown' }),
        technique({ techniqueId: 'DET-003', count: 2, phases: ['threw-sync', 'returned-sync'] }),
      ],
    });
    const byId = Object.fromEntries(buildCards(rep).map((c) => [c.techniqueId, c]));
    expect(byId['DET-001']!.attemptOnly).toBe(true);
    expect(byId['DET-001']!.kind).toBe('unknown');
    expect(r(byId['DET-001']!.interpretation)).toBe('card_fp_insufficient');
    expect(byId['DET-003']!.attemptOnly).toBe(false);
  });

  it('ranks fingerprinting patterns above possible above api-use, then by confidence', () => {
    const rep = report({
      techniques: [
        technique({ techniqueId: 'DET-025', count: 50 }),
        technique({ techniqueId: 'DET-002', count: 2 }),
        technique({ techniqueId: 'DET-022', count: 3 }),
        technique({ techniqueId: 'DET-011', count: 1 }),
      ],
      findings: [
        finding({ findingId: 'a', techniqueId: 'DET-002', interpretation: 'possible-fingerprinting', interpretationConfidence: 'low' }),
        finding({ findingId: 'b', techniqueId: 'DET-022', interpretation: 'fingerprinting-pattern', interpretationConfidence: 'medium' }),
        finding({ findingId: 'c', techniqueId: 'DET-011', interpretation: 'possible-fingerprinting', interpretationConfidence: 'high' }),
      ],
    });
    expect(buildCards(rep).map((c) => c.id)).toEqual(['f:b', 'f:c', 'f:a', 't:DET-025']);
  });

  it('popup shows at most five cards; the rest is counted', () => {
    const rep = report({
      techniques: TECHNIQUE_IDS.slice(0, 8).map((techniqueId) => technique({ techniqueId })),
    });
    const cards = buildCards(rep);
    expect(cards).toHaveLength(8);
    expect(selectTopCards(cards)).toHaveLength(5);
    expect(selectTopCards(cards, 2)).toHaveLength(2);
    expect(selectTopCards(cards, 0)).toHaveLength(0);
  });

  it('search filters by technique id, API, rule id and vendor id, case-insensitively', () => {
    const rep = report({
      techniques: [technique({ techniqueId: 'DET-002' }), technique({ techniqueId: 'DET-032' })],
      findings: [finding({ findingId: 'f1', techniqueId: 'DET-002', ruleId: 'Canvas-Seq', vendorMatchIds: ['threatmetrix'] })],
      vendors: [vendor({ vendorId: 'threatmetrix' })],
    });
    const cards = buildCards(rep);
    expect(filterCards(cards, '').map((c) => c.techniqueId)).toEqual(['DET-002', 'DET-032']);
    expect(filterCards(cards, 'getImageData').map((c) => c.techniqueId)).toEqual(['DET-002']);
    expect(filterCards(cards, 'canvas-seq').map((c) => c.techniqueId)).toEqual(['DET-002']);
    expect(filterCards(cards, 'hardware').map((c) => c.techniqueId)).toEqual(['DET-032']);
    expect(filterCards(cards, 'nothing-here')).toEqual([]);
    expect(filterVendorCards(buildVendorCards(rep), 'LexisNexis')).toHaveLength(1);
    expect(filterVendorCards(buildVendorCards(rep), 'akamai')).toHaveLength(0);
  });

  it('count labels respect countQuality and saturation', () => {
    expect(countLabel(3, 'exact')).toBe('3');
    expect(countLabel(3, 'sampled')).toEqual({ key: 'count_value_sampled', subs: [3] });
    expect(countLabel(3, 'lower-bound')).toEqual({ key: 'count_value_lower_bound', subs: [3] });
    expect(countLabel(MAX_COUNT, 'exact')).toEqual({ key: 'count_value_lower_bound', subs: [MAX_COUNT] });
  });
});

describe('vendor cards (REQ-007)', () => {
  it('uses the mandatory ThreatMetrix wording and never counts `none` matches', () => {
    const rep = report({
      vendors: [vendor({ vendorId: 'threatmetrix' }), vendor({ vendorId: 'akamai', vendorConfidence: 'none' }), vendor({ vendorId: 'datadome', vendorConfidence: 'weak-signal', ruleIds: [] })],
    });
    const cards = buildVendorCards(rep);
    expect(cards.map((c) => c.vendorId)).toEqual(['threatmetrix', 'datadome']);
    expect(r(cards[0]!.found)).toBe('card_vendor_found[LexisNexis ThreatMetrix]');
    expect(r(cards[0]!.purpose)).toBe('card_vendor_purpose[card_vendor_threatmetrix_purpose]');
    expect(r(cards[0]!.matchLabel)).toBe('card_vendor_match_documented_resource');
    expect(cards[1]!.name).toBe('datadome');
    expect(r(cards[1]!.purpose)).toBe('card_vendor_purpose[card_vendor_purpose_generic]');
    expect(r(cards[1]!.matchLabel)).toBe('card_vendor_match_weak_signal');
  });
});

describe('counts and badge', () => {
  it('counts distinct techniques, matched vendors and third-party hosts when present', () => {
    const rep = report({
      techniques: [technique({ techniqueId: 'DET-001' }), technique({ techniqueId: 'DET-001', count: 9 }), technique({ techniqueId: 'DET-002' })],
      vendors: [vendor({ vendorId: 'threatmetrix' }), vendor({ vendorId: 'akamai', vendorConfidence: 'none' })],
    });
    expect(countsView(rep, true)).toEqual({ techniques: 2, services: 1, thirdParty: null });
    expect(countsView(null)).toEqual({ techniques: 0, services: null, thirdParty: null });
    const withHosts = {
      ...rep,
      hosts: [
        { registrableDomain: 'example.com', requestCount: 3 },
        { registrableDomain: 'cdn.vendor.example', requestCount: 2 },
        { registrableDomain: 'not a host', requestCount: 1 },
        { registrableDomain: 'x.example' },
      ],
    } as unknown as typeof rep;
    expect(hostsOf(withHosts).map((h) => (h.registrableDomain ?? h.category ?? 'unknown'))).toEqual(['example.com', 'cdn.vendor.example']);
    expect(countsView(withHosts).thirdParty).toBe(1);
  });

  it('badge = categories with non-api-use findings', () => {
    const rep = report({
      findings: [
        finding({ findingId: 'a', techniqueId: 'DET-002' }),
        finding({ findingId: 'b', techniqueId: 'DET-001' }),
        finding({ findingId: 'c', techniqueId: 'DET-022' }),
        finding({ findingId: 'd', techniqueId: 'DET-032', interpretation: 'api-use' }),
      ],
    });
    expect(categoriesWithFindings(rep)).toBe(2);
    expect(categoriesWithFindings(null)).toBe(0);
  });
});

it('F059/F062 distinguishes an unavailable catalog from an evaluated empty result', () => {
  expect(countsView(report()).services).toBeNull();
  expect(countsView(report({ vendors: [vendor({ vendorId: 'fixture' })] })).services).toBeNull();
  expect(countsView(report(), true).services).toBe(0);
});

it('F061 single-read and editor findings cannot assert a series', () => {
  for (const techniqueId of ['DET-001', 'DET-002'] as const) {
    const [card] = buildCards(report({
      techniques: [technique({ techniqueId, count: 1 })],
      findings: [finding({ findingId: 'single', techniqueId, interpretation: 'possible-fingerprinting' })],
    }));
    expect(card!.interpretation.key).toBe('card_fp_insufficient');
  }
});

it('F142 DET-003 asserts API calls, including measureText, rather than drawing', () => {
  const [card] = buildCards(report({ techniques: [technique({ techniqueId: 'DET-003', count: 1 })] }));
  expect(card!.observation.key).toBe('card_api_use_generic');
  expect(card!.api).toContain('measureText');
});

it('F144 exception wording is reserved for nonempty all-threw phases', () => {
  const cases = [
    { phases: ['threw-sync'], threw: true, unknown: false },
    { phases: ['attempted'], threw: false, unknown: true },
    { phases: ['attempted', 'threw-sync'], threw: false, unknown: true },
    { phases: ['settlement-unobserved'], threw: false, unknown: true },
    { phases: ['returned-sync'], threw: false, unknown: false },
    { phases: [], threw: false, unknown: false },
  ] as const;
  for (const item of cases) {
    const [card] = buildCards(report({ techniques: [technique({ techniqueId: 'DET-001', phases: [...item.phases] })] }));
    expect(card!.attemptOnly, item.phases.join(',')).toBe(item.threw);
    expect(card!.completionUnobserved).toBe(item.unknown);
  }
});
