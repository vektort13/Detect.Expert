// Coverage / state message view model (REQ-006: coverage always next to conclusions; spec V §7 state list,
// docs/ui-copy.md §2). Pure: no chrome.*, returns message keys.

import { MAX_COUNT } from '@detect-expert/contracts';
import type { CoverageFlag, CoverageState, ReportProjection, ScopeMode } from '@detect-expert/contracts';
import { joinMessages, msg } from './message';
import type { Message } from './message';
import { sensorNameKey, sensorReasonKey } from './sensors';

/** Amber = needs explanation, red = product/collection error only, never a site verdict (spec VI I5). */
export type Tone = 'neutral' | 'muted' | 'attention' | 'error';

export type TabUrlClass = 'web' | 'restricted' | 'unknown';

export type ViewState = CoverageState | 'loading' | 'off' | 'no-report' | 'restricted' | 'unsupported-chrome' | 'unavailable';

export interface CoverageInput {
  loaded: boolean;
  report: ReportProjection | null;
  /** null while the scope is still unknown. */
  scopeMode: ScopeMode | null;
  tabUrlClass: TabUrlClass;
  chromeSupported: boolean;
  chromeVersion: string | null;
  swAvailable: boolean;
  managed: boolean;
  /** Host access was granted during this session; the current document still runs without sensors. */
  justGranted: boolean;
}

export interface CoverageFlagVM {
  flag: CoverageFlag;
  label: Message;
}

export interface CoverageVM {
  state: ViewState;
  tone: Tone;
  /** Short status pill text. */
  status: Message;
  title: Message;
  lines: Message[];
  flags: CoverageFlagVM[];
  /** Show «Перезагрузить для анализа с начала». */
  showReload: boolean;
  droppedTotal: number;
}

export const STATUS_KEYS: Readonly<Record<CoverageState, string>> = {
  active: 'status_active',
  partial: 'status_partial',
  'late-start': 'status_late_start',
  paused: 'status_paused',
  unsupported: 'status_unsupported',
  'no-access': 'status_no_access',
  degraded: 'status_degraded',
};

export const COVERAGE_TITLE_KEYS: Readonly<Record<CoverageState, string>> = {
  active: 'coverage_active_title',
  partial: 'coverage_partial_title',
  'late-start': 'coverage_late_start_title',
  paused: 'coverage_paused_title',
  unsupported: 'coverage_unsupported_title',
  'no-access': 'coverage_no_access_title',
  degraded: 'coverage_degraded_title',
};

/** Flags that mean the product or the collection pipeline failed (red), not a statement about the site. */
export const COLLECTION_ERROR_FLAGS: ReadonlySet<CoverageFlag> = new Set<CoverageFlag>([
  'hook-failed',
  'protocol-mismatch',
  'bridge-ring-overflow',
  'channel-gap',
]);

export function coverageFlagKey(flag: CoverageFlag): string {
  return 'coverage_flag_' + flag.replace(/-/g, '_');
}

export function flagsView(flags: ReadonlyArray<CoverageFlag>): CoverageFlagVM[] {
  const seen = new Set<CoverageFlag>();
  const out: CoverageFlagVM[] = [];
  for (const flag of flags) {
    if (seen.has(flag)) continue;
    seen.add(flag);
    out.push({ flag, label: msg(coverageFlagKey(flag)) });
  }
  return out;
}

export function droppedTotal(report: ReportProjection | null): number {
  if (report === null) return 0;
  const d = report.dropped;
  const sum = d.observations + d.batches + d.findings + d.hosts + d.counters + d.transport + (d.ring ?? 0);
  return sum > MAX_COUNT ? MAX_COUNT : sum;
}

function hostOrUnknown(report: ReportProjection): Message | string {
  return report.host ?? msg('host_unknown');
}

/**
 * ADR-019 (S11): one line per family not observed in this document: disabled now (with the current reason), or
 * enabled again after the document loaded (observes again only after a reload). One extra line when hooks installed
 * before the change may still be on the page.
 */
export function disabledSensorLines(report: ReportProjection): { lines: Message[]; reload: boolean } {
  const list = Array.isArray(report.disabledSensors) ? report.disabledSensors : [];
  const lines: Message[] = [];
  let hooksMayRemain = false;
  for (const entry of list) {
    const name = msg(sensorNameKey(entry.sensorId));
    if (entry.disabledBy.length > 0) lines.push(msg('coverage_sensor_disabled_desc', name, msg(sensorReasonKey(entry.disabledBy))));
    else lines.push(msg('coverage_sensor_reenabled_reload', name));
    if (entry.hooksMayRemain) hooksMayRemain = true;
  }
  if (hooksMayRemain) lines.push(msg('coverage_sensor_disabled_reload'));
  return { lines, reload: list.length > 0 };
}

export function coverageView(input: CoverageInput): CoverageVM {
  const managedLine = input.managed ? [msg('coverage_managed_desc')] : [];

  // REQ-006 / F063: missing data must never fabricate an explicit off response.
  if (!input.loaded) {
    return {
      state: 'loading', tone: 'muted', status: msg('statusLoading'), title: msg('statusLoading'),
      lines: [], flags: [], showReload: false, droppedTotal: 0,
    };
  }

  if (!input.swAvailable || input.scopeMode === null) {
    return {
      state: 'unavailable',
      tone: 'error',
      status: msg('status_error'),
      title: msg('state_sw_unavailable_title'),
      lines: [msg('state_sw_unavailable_desc')],
      flags: [],
      showReload: false,
      droppedTotal: 0,
    };
  }

  if (!input.chromeSupported) {
    return {
      state: 'unsupported-chrome',
      tone: 'muted',
      status: msg('status_unsupported'),
      title: msg('state_unsupported_chrome_title'),
      lines: [msg('coverage_unsupported_chrome_desc', input.chromeVersion ?? '?'), ...managedLine],
      flags: [],
      showReload: false,
      droppedTotal: 0,
    };
  }

  if (input.tabUrlClass === 'restricted') {
    return {
      state: 'restricted',
      tone: 'muted',
      status: msg('status_unsupported'),
      title: msg('coverage_unsupported_title'),
      lines: [msg('coverage_unsupported_desc'), ...managedLine],
      flags: [],
      showReload: false,
      droppedTotal: 0,
    };
  }

  const report = input.report;
  if (input.scopeMode === 'off' && !report?.coverageFlags.includes('revoked')) {
    return { state: 'off', tone: 'muted', status: msg('status_off'), title: msg('state_scope_off_title'),
      lines: [msg('coverageOff'), ...(report?.coverageState === 'no-access' ? [msg('coverage_no_access_title')] : []), msg('scope_start_hint'), ...managedLine], flags: report === null ? [] : flagsView(report.coverageFlags),
      showReload: false, droppedTotal: droppedTotal(report) };
  }
  if (report === null) {
    return {
      state: 'no-report',
      tone: 'muted',
      status: msg('status_no_report'),
      title: msg('state_no_report_title'),
      lines: [
        msg('state_no_report_desc'),
        ...(input.justGranted ? [msg('scope_permission_granted_reload')] : []),
        ...managedLine,
      ],
      flags: [],
      showReload: input.justGranted || input.scopeMode === 'site' || input.scopeMode === 'all-sites',
      droppedTotal: 0,
    };
  }

  const flags = flagsView(report.coverageFlags);
  const collectionError = report.coverageFlags.some((flag) => COLLECTION_ERROR_FLAGS.has(flag));
  const dropped = droppedTotal(report);
  const state = report.coverageState;
  const persistentScope = input.scopeMode === 'site' || input.scopeMode === 'all-sites';
  const lateStartMessage = persistentScope ? 'coverage_late_start_desc' : 'coverage_late_start_active_tab_desc';
  const lines: Message[] = [];
  let tone: Tone = 'neutral';
  let showReload = input.justGranted;

  switch (state) {
    case 'active':
      lines.push(msg('coverage_active_desc'));
      break;
    case 'partial':
      tone = 'attention';
      lines.push(
        msg(
          'coverage_partial_desc',
          flags.length > 0 ? joinMessages(flags.map((f) => f.label)) : msg('coverage_partial_detail_unknown'),
        ),
      );
      break;
    case 'late-start':
      tone = 'attention';
      showReload = persistentScope;
      lines.push(msg(lateStartMessage));
      break;
    case 'paused':
      tone = 'muted';
      lines.push(msg('coverage_paused_desc'), msg('coverage_paused_reload'));
      break;
    case 'unsupported':
      tone = 'muted';
      lines.push(msg('coverage_unsupported_desc'));
      break;
    case 'no-access':
      tone = 'muted';
      lines.push(
        report.coverageFlags.includes('revoked')
          ? msg('coverage_revoked_desc', hostOrUnknown(report))
          : msg('coverage_no_access_desc', hostOrUnknown(report)),
      );
      break;
    case 'degraded':
      tone = 'attention';
      lines.push(msg('coverage_degraded_desc', dropped));
      break;
  }

  if (state !== 'degraded' && dropped > 0) lines.push(msg('coverage_degraded_desc', dropped));
  if (state !== 'late-start' && report.coverageFlags.includes('late-start')) {
    showReload = persistentScope;
    lines.push(msg(lateStartMessage));
  }
  if (report.coverageFlags.includes('protocol-mismatch') && persistentScope) showReload = true;
  const sensors = disabledSensorLines(report);
  if (sensors.lines.length > 0) {
    lines.push(...sensors.lines);
    // A reload installs the current setting; site/all-sites register the prelude for the next load (ADR-019).
    if (persistentScope) showReload = true;
    if (tone === 'neutral') tone = 'attention';
  }
  if (input.justGranted) lines.push(msg('scope_permission_granted_reload'));
  lines.push(...managedLine);
  if (collectionError) tone = 'error';

  return {
    state,
    tone,
    status: msg(STATUS_KEYS[state]),
    title: msg(COVERAGE_TITLE_KEYS[state]),
    lines,
    flags,
    showReload,
    droppedTotal: dropped,
  };
}
