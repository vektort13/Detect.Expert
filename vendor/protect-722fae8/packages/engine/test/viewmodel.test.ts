import { describe, expect, it } from 'vitest';
import type { CoverageFlag, CoverageState, ReportProjection } from '@detect-expert/contracts';
import {
  POPUP_MAX_CARDS,
  TECHNIQUE_API_NAMES,
  countViewModel,
  interpretReport,
  projectReport,
  summarizeSources,
  toPopupViewModel,
  type CoverageContext,
  type MessageParam,
  type MessageRef,
} from '../src/index';
import { CHART, EDITOR, FP_POSITIVE, TAINTED_ONLY, counter, hostEntry, report } from './fixtures';

const granted: CoverageContext = { scopeMode: 'site', accessGranted: true, restricted: false, paused: false, inaccessibleFrames: 0 };
// S10: vendorsSectionTitle is the one camelCase key the view model uses (it is the existing locale key).
const KEY_RE = /^(?:[a-z0-9_]+|vendorsSectionTitle)$/;

function projection(counters = FP_POSITIVE, flags: CoverageFlag[] = [], ctx: Partial<CoverageContext> = {}, over: Partial<ReportProjection> = {}): ReportProjection {
  const r = interpretReport(report({ counters, coverageFlags: flags, hosts: [hostEntry('example.com'), hostEntry('tracker.net')] }), { ...granted, ...ctx }).report;
  return { ...projectReport(r, { scopeMode: 'site' }), ...over };
}

/** Every MessageRef key must be a locale key; params are strings or refs (never objects with page data). */
function walkRefs(value: unknown, out: MessageRef[]): void {
  if (Array.isArray(value)) {
    for (const v of value) walkRefs(v, out);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const rec = value as Record<string, unknown>;
  if (typeof rec['key'] === 'string' && (rec['params'] === undefined || typeof rec['params'] === 'object')) {
    out.push(rec as unknown as MessageRef);
    const params = rec['params'] as Record<string, MessageParam> | undefined;
    if (params !== undefined) for (const p of Object.values(params)) walkRefs(p, out);
    return;
  }
  for (const v of Object.values(rec)) walkRefs(v, out);
}

describe('toPopupViewModel (E13-01, spec V §7)', () => {
  it('puts coverage first, three numbers, cards with type labels, and only message keys', () => {
    const p = projection();
    const vm = toPopupViewModel(p, 'en', { sources: summarizeSources(interpretReport(report({ counters: FP_POSITIVE, hosts: [hostEntry('example.com'), hostEntry('tracker.net')] }), granted).report) });
    expect(vm.documentKey).toBe(p.documentKey);
    expect(vm.reportRevision).toBe(p.reportRevision);
    expect(vm.host).toBe('example.com');
    expect(vm.coverage.state).toBe('active');
    expect(vm.coverage.title).toEqual({ key: 'coverage_active_title' });
    expect(vm.coverage.description).toEqual({ key: 'coverage_active_desc' });
    expect(vm.counts.techniques).toEqual({ value: 2, formatted: '2', quality: null });
    expect(vm.counts.services.value).toBe(0);
    expect(vm.counts.thirdParty.value).toBe(1);
    expect(vm.empty).toBeNull();

    const first = vm.cards[0];
    expect(first?.type).toBe('possible-fingerprinting');
    expect(first?.label).toEqual({ key: 'card_fp_label' });
    expect(first?.headline).toEqual({ key: 'card_fp_insufficient' });
    expect(first?.confidence).toEqual({ key: 'confidence_low' });
    expect(first?.integrity).toEqual({ key: 'integrity_page_controlled' });
    expect(first?.purpose).toEqual({ key: 'card_api_use_purpose' });
    expect(first?.notes.map((n) => n.key)).toContain('card_fp_not_proven');
    expect(first?.limitations.map((n) => n.key)).toEqual(expect.arrayContaining(['limitation_page_controlled_evidence', 'limitation_purpose_unknown', 'limitation_uniqueness_not_established', 'limitation_catalog_disabled', 'limitation_no_time_window']));
    expect(first?.rule).toEqual({ ruleId: 'canvas-readback-after-text', ruleVersion: '2' });
    expect(vm.cards.map((c) => c.type)).toEqual(['possible-fingerprinting', 'api-use', 'api-use']);
    expect(vm.cards[1]?.headline).toEqual({ key: 'card_api_use_canvas_text', params: { COUNT: '6' } });
    expect(vm.cards[2]?.headline).toEqual({ key: 'card_api_use_canvas_readback', params: { COUNT: '2', API: 'getImageData' } });

    expect(vm.badge).toEqual({ count: 1, tooltip: { key: 'badge_tooltip', params: { N: '1' } } });
    expect(vm.ariaLive).toEqual({ key: 'aria_live_update', params: { N: '3', STATE: { key: 'coverage_active_title' } } });
    expect(vm.sections.vendorsTitle).toEqual({ key: 'vendorsSectionTitle' });

    const refs: MessageRef[] = [];
    walkRefs(vm, refs);
    expect(refs.length).toBeGreaterThan(10);
    for (const r of refs) expect(r.key).toMatch(KEY_RE);
    // no prose leaks: every param is a number string, an API name, a host or a nested ref
    const text = JSON.stringify(vm);
    expect(text).not.toMatch(/[Ѐ-ӿ]/);
    expect(text).not.toContain('tracker.net');
  });

  it('third-party count is n/a (never a false zero) when sources are not supplied', () => {
    const vm = toPopupViewModel(projection(), 'en');
    expect(vm.counts.thirdParty).toEqual({ value: null, formatted: 'n/a', quality: null });
  });

  it('uses the current contract vendorConfidence field for a supplied vendor summary', () => {
    const p = projection([], [], {}, { vendors: [{
      vendorId: 'test-vendor', vendorConfidence: 'documented-resource', ruleIds: [],
      evidenceSource: 'browser-network', integrity: 'browser-observed',
    }] });
    const vm = toPopupViewModel(p, 'en');
    expect(vm.cards.find((c) => c.type === 'vendor')?.notes).toContainEqual({ key: 'card_vendor_match_documented_resource' });
    // S12 / E13-03: a recognized vendor is not a finding; the badge counts finding categories only.
    expect(vm.badge.count).toBe(0);
  });

  it('S12: badge count ignores api-use and unknown findings (same count as the toolbar badge)', () => {
    const base = projection([]);
    const findings: ReportProjection['findings'] = [
      { findingId: 'a', ruleId: 'r', ruleVersion: '1', techniqueId: 'DET-002', interpretation: 'api-use', interpretationConfidence: 'unassessed', evidenceIds: ['e'], counterEvidenceCodes: [], limitationCodes: [], vendorMatchIds: [] },
      { findingId: 'b', ruleId: 'r', ruleVersion: '1', techniqueId: 'DET-039', interpretation: 'unknown', interpretationConfidence: 'unassessed', evidenceIds: ['e'], counterEvidenceCodes: [], limitationCodes: [], vendorMatchIds: [] },
      { findingId: 'c', ruleId: 'r', ruleVersion: '1', techniqueId: 'DET-060', interpretation: 'local-probe-pattern', interpretationConfidence: 'low', evidenceIds: ['e'], counterEvidenceCodes: [], limitationCodes: [], vendorMatchIds: [] },
    ];
    const vm = toPopupViewModel({ ...base, findings }, 'en');
    expect(vm.badge).toEqual({ count: 1, tooltip: { key: 'badge_tooltip', params: { N: '1' } } });
  });

  it('empty state next to coverage when nothing was observed; badge 0', () => {
    const vm = toPopupViewModel(projection([]), 'ru');
    expect(vm.cards).toEqual([]);
    expect(vm.empty).toEqual({ title: { key: 'empty_no_findings' }, hint: { key: 'empty_no_findings_hint' } });
    expect(vm.coverage.title.key).toBe('coverage_active_title');
    expect(vm.badge.count).toBe(0);
  });

  it('editor shows only observations with badge zero; tainted shows attempt-only (F043)', () => {
    const editor = toPopupViewModel(projection(EDITOR), 'en');
    expect(editor.cards.map((c) => c.type)).toEqual(['api-use', 'api-use']);
    expect(editor.cards.every((c) => c.confidence === null)).toBe(true);
    expect(editor.cards.flatMap((c) => c.notes).some((n) => n.key === 'card_fp_alternatives')).toBe(false);
    expect(editor.badge.count).toBe(0);

    const tainted = toPopupViewModel(projection(TAINTED_ONLY), 'en');
    expect(tainted.cards).toHaveLength(1);
    expect(tainted.cards[0]?.type).toBe('api-use');
    expect(tainted.cards[0]?.notes.map((n) => n.key)).toContain('card_api_use_attempt_only');
    expect(tainted.badge.count).toBe(0);

    const chart = toPopupViewModel(projection(CHART), 'en');
    expect(chart.cards.map((c) => c.type)).toEqual(['api-use']);
  });

  const coverageRows: Array<{ state: CoverageState; flags: CoverageFlag[]; ctx: Partial<CoverageContext>; desc: string; reload: boolean }> = [
    { state: 'partial', flags: ['hook-failed'], ctx: {}, desc: 'coverage_partial_desc', reload: false },
    { state: 'partial', flags: ['network-limited'], ctx: {}, desc: 'coverage_partial_desc', reload: false },
    { state: 'partial', flags: ['frames-inaccessible'], ctx: {}, desc: 'coverage_partial_desc', reload: false },
    { state: 'late-start', flags: ['late-start'], ctx: {}, desc: 'coverage_late_start_desc', reload: true },
    { state: 'paused', flags: [], ctx: { paused: true }, desc: 'coverage_paused_desc', reload: false },
    { state: 'unsupported', flags: [], ctx: { restricted: true }, desc: 'coverage_unsupported_desc', reload: false },
    { state: 'no-access', flags: [], ctx: { accessGranted: false }, desc: 'coverage_no_access_desc', reload: false },
    { state: 'no-access', flags: ['revoked'], ctx: {}, desc: 'coverage_revoked_desc', reload: false },
    { state: 'degraded', flags: ['truncated'], ctx: {}, desc: 'coverage_degraded_desc', reload: false },
    { state: 'degraded', flags: ['protocol-mismatch'], ctx: {}, desc: 'coverage_degraded_desc', reload: true },
  ];
  for (const row of coverageRows) {
    it('coverage ' + row.state + ' [' + row.flags.join(',') + '] -> ' + row.desc, () => {
      const vm = toPopupViewModel(projection(FP_POSITIVE, row.flags, row.ctx), 'en');
      expect(vm.coverage.state).toBe(row.state);
      expect(vm.coverage.description.key).toBe(row.desc);
      expect(vm.coverage.reloadSuggested).toBe(row.reload);
      expect(vm.actions.reload).toBe(row.reload);
      expect(vm.coverage.flags.map((f) => f.key)).toHaveLength(row.flags.length);
    });
  }

  it('partial detail lists the flag messages; no-access carries the host or host_unknown', () => {
    const partial = toPopupViewModel(projection(FP_POSITIVE, ['hook-failed', 'worker-not-observed']), 'en');
    expect(partial.coverage.description).toEqual({ key: 'coverage_partial_desc', params: { DETAIL: [{ key: 'coverage_flag_hook_failed' }, { key: 'coverage_flag_worker_not_observed' }] } });
    const noAccess = toPopupViewModel(projection(FP_POSITIVE, [], { accessGranted: false }), 'en');
    expect(noAccess.coverage.description).toEqual({ key: 'coverage_no_access_desc', params: { HOST: 'example.com' } });
    const noHost = toPopupViewModel(projection(FP_POSITIVE, [], { accessGranted: false }, { host: null }), 'en');
    expect(noHost.coverage.description).toEqual({ key: 'coverage_no_access_desc', params: { HOST: { key: 'host_unknown' } } });
  });

  it('actions follow the state: pause while collecting, resume when paused, none without access', () => {
    expect(toPopupViewModel(projection(), 'en').actions).toEqual({ pause: true, resume: false, reload: false, clear: true, export: true });
    expect(toPopupViewModel(projection(FP_POSITIVE, [], { paused: true }), 'en').actions).toMatchObject({ pause: false, resume: true });
    expect(toPopupViewModel(projection(FP_POSITIVE, [], { accessGranted: false }), 'en').actions).toMatchObject({ pause: false, resume: false });
  });

  it('degraded: dropped total is formatted into $DROPPED$ and mirrored in dropped.message', () => {
    const base = projection(FP_POSITIVE, ['truncated']);
    const vm = toPopupViewModel({ ...base, dropped: { ...base.dropped, observations: 1200, transport: 34 } }, 'en');
    expect(vm.coverage.description).toEqual({ key: 'coverage_degraded_desc', params: { DROPPED: '1,234' } });
    expect(vm.dropped).toEqual({ total: 1234, message: { key: 'coverage_degraded_desc', params: { DROPPED: '1,234' } } });
  });

  it('formats counts per locale with quality prefixes and survives an invalid locale', () => {
    expect(countViewModel(1234, 'exact', 'en')).toEqual({ value: 1234, formatted: '1,234', quality: { key: 'count_exact' } });
    expect(countViewModel(1234, 'lower-bound', 'ru').formatted).toMatch(/^≥ 1.234$/);
    expect(countViewModel(7, 'sampled', 'en').formatted).toBe('≈ 7');
    expect(countViewModel(5, null, 'not a locale!').formatted).toBe('5');
  });

  it('limits the popup to five cards and reports the hidden rest', () => {
    const many = [
      ...FP_POSITIVE,
      counter({ techniqueId: 'DET-011', count: 3 }),
      counter({ techniqueId: 'DET-025', count: 30 }),
      counter({ techniqueId: 'DET-032', count: 1 }),
      counter({ techniqueId: 'DET-039', count: 2 }),
    ];
    const vm = toPopupViewModel(projection(many), 'en');
    expect(vm.cards).toHaveLength(POPUP_MAX_CARDS);
    expect(vm.hiddenCards).toBe(2);
    expect(vm.cards[0]?.type).toBe('possible-fingerprinting');
    // I1: S04–S06 techniques get the same label keys as packages/ui cards.ts (sorted by count)
    expect(vm.cards[1]?.headline).toEqual({ key: 'card_api_use_navigator', params: { COUNT: '30' } });
  });

  it('I1: S04–S06 labels: $API$ for WebGL parameters and geometry (no getParameter in this build), $COUNT$ for the rest', () => {
    const ids = ['DET-005', 'DET-011', 'DET-012', 'DET-015', 'DET-016', 'DET-025', 'DET-026', 'DET-029', 'DET-032', 'DET-033', 'DET-039'] as const;
    const byId = new Map<string, unknown>();
    for (const techniqueId of ids) {
      const vm = toPopupViewModel(projection([counter({ techniqueId, count: 2 })]), 'en');
      byId.set(techniqueId, vm.cards.find((c) => c.techniqueId === techniqueId)?.headline);
    }
    expect(Object.fromEntries(byId)).toEqual({
      'DET-005': { key: 'card_api_use_geometry', params: { COUNT: '2', API: 'Element.getBoundingClientRect / getClientRects / HTMLElement.offsetWidth / offsetHeight' } },
      'DET-011': { key: 'card_api_use_webgl_params', params: { COUNT: '2', API: 'WebGL getExtension / getSupportedExtensions / getShaderPrecisionFormat' } },
      'DET-012': { key: 'card_api_use_webgl_readback', params: { COUNT: '2' } },
      'DET-015': { key: 'card_api_use_audio_graph', params: { COUNT: '2' } },
      'DET-016': { key: 'card_api_use_audio_readout', params: { COUNT: '2' } },
      'DET-025': { key: 'card_api_use_navigator', params: { COUNT: '2' } },
      'DET-026': { key: 'card_api_use_ua_hints', params: { COUNT: '2' } },
      'DET-029': { key: 'card_api_use_screen', params: { COUNT: '2' } },
      'DET-032': { key: 'card_api_use_hardware_concurrency', params: { COUNT: '2' } },
      'DET-033': { key: 'card_api_use_device_memory', params: { COUNT: '2' } },
      'DET-039': { key: 'card_api_use_permissions', params: { COUNT: '2' } },
    });
    expect(JSON.stringify(Object.fromEntries(byId))).not.toContain('getParameter');
    expect(TECHNIQUE_API_NAMES['DET-011']).toBe('WebGL getExtension / getSupportedExtensions / getShaderPrecisionFormat');
    expect(TECHNIQUE_API_NAMES['DET-058']).toBe('WebSocket handshake (webRequest)');
    expect(TECHNIQUE_API_NAMES['DET-059']).toBe('fetch / XMLHttpRequest / sendBeacon' + ' (webRequest)');
  });
});
