import { MAX_COUNT, PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { ProtectDropped, ProtectEvidence, ProtectTransferEvidence } from '@detect-expert/contracts';
import { capConfidence, confidenceCeiling, evidenceKey, mergeEvidence, sanitizeParamName } from '@detect-expert/engine';
import { describe, expect, it } from 'vitest';

const DROPPED: ProtectDropped = { evidence: 0, fingerprints: 0, bodies: 0, events: 0 };

function transfer(over: Partial<ProtectTransferEvidence> = {}): ProtectTransferEvidence {
  return {
    evidenceId: 'pe-1',
    frameContext: 'top',
    attributionConfidence: 'unknown',
    count: 1,
    countQuality: 'exact',
    firstSecond: 5,
    lastSecond: 5,
    evidenceSource: 'derived',
    integrity: 'derived',
    ruleVersion: '1',
    limitationCodes: [],
    protectKind: 'value-match',
    ruleId: 'form-leak',
    transferClass: 'third-party-before-submit',
    fieldKind: 'email',
    encodings: ['sha256-hex'],
    location: 'body-json',
    paramName: 'em',
    receiver: 'collect.example',
    relation: 'cross-site',
    method: 'POST',
    requestKind: 'xhr',
    endpointHost: 'collect.example',
    endpointPathTemplate: '/v1/collect',
    submitTiming: 'before-submit',
    deliveryState: 'unknown',
    interpretationConfidence: 'high',
    ...over,
  };
}

describe('mergeEvidence (bounded, value-free)', () => {
  it('same key: counts saturate, span widens, encodings unite (≤ 4, canonical order)', () => {
    let list: ProtectEvidence[] = [];
    let dropped = DROPPED;
    for (const [i, enc] of (['sha256-hex', 'plain', 'md5-hex', 'base64', 'sha1-hex'] as const).entries()) {
      const r = mergeEvidence(list, transfer({ encodings: [enc], firstSecond: 10 - i, lastSecond: 10 + i, count: MAX_COUNT - 1 }), dropped);
      list = r.evidence;
      dropped = r.dropped;
    }
    expect(list).toHaveLength(1);
    const e = list[0] as ProtectTransferEvidence;
    expect(e.count).toBe(MAX_COUNT);
    expect(e.firstSecond).toBe(6);
    expect(e.lastSecond).toBe(14);
    expect(e.encodings).toEqual(['plain', 'base64', 'md5-hex', 'sha1-hex']);
  });

  it('different delivery state, receiver or param → separate records', () => {
    let list: ProtectEvidence[] = [transfer()];
    list = mergeEvidence(list, transfer({ deliveryState: 'sent' }), DROPPED).evidence;
    list = mergeEvidence(list, transfer({ receiver: 'other.example' }), DROPPED).evidence;
    list = mergeEvidence(list, transfer({ paramName: 'mail' }), DROPPED).evidence;
    expect(list).toHaveLength(4);
    expect(new Set(list.map(evidenceKey)).size).toBe(4);
  });

  it('beyond maxEvidencePerDocument: dropped.evidence + 1 and budgetExceeded', () => {
    let list: ProtectEvidence[] = [];
    for (let i = 0; i < PROTECT_BUDGETS.maxEvidencePerDocument; i++) list = mergeEvidence(list, transfer({ paramName: 'p' + String(i) }), DROPPED).evidence;
    const r = mergeEvidence(list, transfer({ paramName: 'overflow' }), DROPPED);
    expect(r.evidence).toHaveLength(PROTECT_BUDGETS.maxEvidencePerDocument);
    expect(r.budgetExceeded).toBe(true);
    expect(r.dropped.evidence).toBe(1);
    expect(r.index).toBe(-1);
  });

  it('merged confidence never exceeds the ceiling (name plain ≤ medium)', () => {
    const name = transfer({ fieldKind: 'name', encodings: ['plain'], interpretationConfidence: 'medium' });
    const r = mergeEvidence([name], { ...name, interpretationConfidence: 'high' } as ProtectEvidence, DROPPED);
    expect((r.evidence[0] as ProtectTransferEvidence).interpretationConfidence).toBe('medium');
  });

  it('inputs are not mutated', () => {
    const list: ProtectEvidence[] = [transfer()];
    const snapshot = JSON.stringify(list);
    mergeEvidence(list, transfer({ count: 3 }), DROPPED);
    expect(JSON.stringify(list)).toBe(snapshot);
  });
});

describe('confidenceCeiling', () => {
  it('per kind', () => {
    expect(confidenceCeiling('password-field-listener', null, [])).toBe('low');
    expect(confidenceCeiling('opaque-after-input', 'email', [])).toBe('low');
    expect(confidenceCeiling('replay-pattern', null, [])).toBe('medium');
    expect(confidenceCeiling('value-match', 'name', ['plain', 'url-encoded'])).toBe('medium');
    expect(confidenceCeiling('value-match', 'name', ['sha256-hex'])).toBe('high');
    expect(confidenceCeiling('value-match', 'email', ['plain'])).toBe('high');
    expect(capConfidence('high', 'low')).toBe('low');
    expect(capConfidence('low', 'high')).toBe('low');
  });
});

describe('sanitizeParamName', () => {
  it.each([
    ['email', 'email'],
    ['user[email]', 'user[email]'],
    ['a.b-c_d', 'a.b-c_d'],
    ['x'.repeat(49), null],
    ['has space', null],
    ['id123456', null],
    ['k_deadbeefcafe12', null],
    ['', null],
    ['e=mail', null],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeParamName(input)).toBe(expected);
  });

  it('non-strings → null', () => {
    expect(sanitizeParamName(42)).toBeNull();
    expect(sanitizeParamName(null)).toBeNull();
  });
});
