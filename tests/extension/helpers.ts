// Shared helpers for the extension specs: privileged UI channel, report polling, storage dumps, fixture results.
// Trusted ids (tabId, frameId, documentId) are read back from Chrome (tabs.query, webNavigation.getAllFrames),
// never from a page (REQ-004). Scope is enabled through the documented ui-set-scope request (ADR-003).

import { expect, type BrowserContext, type Frame, type Page, type Worker } from '@playwright/test';
import type {
  Finding,
  Interpretation,
  ReportProjection,
  ScopeState,
  TechniqueId,
  TechniqueSummary,
  UiGetReportRequest,
  UiRequest,
  UiResponse,
} from '@detect-expert/contracts';
import { extensionIdOf, getServiceWorker, type ExtensionSession } from './harness';

/** Sanitized host of the fixture stand; the test profile carries a static host permission for it. */
export const FIXTURE_HOST = '127.0.0.1';

/** Canvas techniques of slice 1 (spec Part III §2.1, docs/coverage/matrix.md). */
export const DET = {
  canvasExport: 'DET-001',
  pixelReadback: 'DET-002',
  text: 'DET-003',
  offscreen: 'DET-004',
} as const satisfies Record<string, TechniqueId>;

export type ScopeChoice = 'site' | 'all-sites' | 'active-tab' | 'off';

export interface FrameInfo {
  frameId: number;
  parentFrameId: number;
  documentId: string;
  frameType: string;
}

/** Registered content-script ids of the stand (ADR-003 §1 site mode; test profile registers them at startup). */
export const STAND_SCRIPT_IDS = ['detector-isolated-v1', 'detector-main-v1'] as const;

export interface Observed {
  sw: Worker;
  ui: Page;
  page: Page;
  tabId: number;
  /** How the stand became observed: the static test grant registered at startup, or an accepted ui-set-scope. */
  observedBy: 'static-test-grant' | 'ui-set-scope site';
  scope: ScopeState;
}

export function brief(value: unknown, max = 1500): string {
  const s = JSON.stringify(value);
  if (s === undefined) return 'undefined';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export async function openExtensionPage(context: BrowserContext, sw: Worker, file = 'popup.html'): Promise<Page> {
  const page = await context.newPage();
  await page.goto('chrome-extension://' + extensionIdOf(sw) + '/' + file);
  return page;
}

/** Sends a UI request from an extension page (sender.origin === chrome-extension://<id>). */
export async function sendUi(ui: Page, request: UiRequest | Record<string, unknown>): Promise<UiResponse> {
  return ui.evaluate((r) => chrome.runtime.sendMessage<unknown, UiResponse>(r), request);
}

export function scopeRequest(mode: ScopeChoice): UiRequest {
  if (mode === 'site') return { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: FIXTURE_HOST };
  return { schemaVersion: 1, type: 'ui-set-scope', scopeMode: mode };
}

export async function setScope(ui: Page, mode: ScopeChoice): Promise<UiResponse> {
  return sendUi(ui, scopeRequest(mode));
}

/** The SW may answer ui-set-scope with `ok` or with the resulting `scope`; anything else is a failure. */
export function assertAccepted(response: UiResponse, what: string): void {
  expect(response.type === 'ok' || response.type === 'scope', what + ' must be accepted by the SW; got ' + brief(response)).toBe(true);
}

export async function swAlive(ui: Page): Promise<boolean> {
  const response = await sendUi(ui, { schemaVersion: 1, type: 'ui-get-scope' });
  return response.type === 'scope';
}

export async function getScope(ui: Page): Promise<ScopeState> {
  const response = await sendUi(ui, { schemaVersion: 1, type: 'ui-get-scope' });
  if (response.type !== 'scope') throw new Error('ui-get-scope answered ' + brief(response));
  return response.scope;
}

/** `ui-inject-now` (background runtime, active-tab mode): late injection of both worlds into one tab. */
export async function injectNow(ui: Page, tabId: number): Promise<UiResponse> {
  return sendUi(ui, { schemaVersion: 1, type: 'ui-inject-now', tabId });
}

export async function registeredScripts(sw: Worker): Promise<Array<{ id: string; matches: string[] }>> {
  return sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => ({ id: s.id, matches: [...(s.matches ?? [])] })));
}

/** Removes every registered content script (test-only: simulates "no early injection" for the late-start scenario). */
export async function unregisterStandScripts(sw: Worker): Promise<string[]> {
  return sw.evaluate(async () => {
    const ids = (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id);
    if (ids.length > 0) await chrome.scripting.unregisterContentScripts({ ids });
    return ids;
  });
}

function coversStand(matches: readonly string[]): boolean {
  return matches.some((m) => m === 'http://' + FIXTURE_HOST + '/*' || m === '*://' + FIXTURE_HOST + '/*' || m === '<all_urls>' || m === 'http://*/*' || m === '*://*/*');
}

/**
 * Makes sure the stand host is observed. In the test profile the background registers detector-*-v1 for the
 * static 127.0.0.1 grant at startup (ADR-003 §3, docs/coverage/matrix.md §2 "Test build"); registration is
 * asynchronous, so it is polled briefly. Otherwise the documented ui-set-scope site request is sent and must
 * be accepted — the failure message carries the SW's real answer.
 */
export async function ensureObserved(sw: Worker, ui: Page): Promise<Observed['observedBy']> {
  await getScope(ui); // ui-get-scope awaits SW readiness; registration reconciliation follows it
  const deadline = Date.now() + 10_000;
  let scripts: Array<{ id: string; matches: string[] }> = [];
  for (;;) {
    scripts = await registeredScripts(sw);
    const ids = scripts.filter((s) => coversStand(s.matches)).map((s) => s.id);
    if (STAND_SCRIPT_IDS.every((id) => ids.includes(id))) return 'static-test-grant';
    if (Date.now() >= deadline) break;
    await ui.waitForTimeout(200);
  }
  const response = await setScope(ui, 'site');
  assertAccepted(response, 'ui-set-scope site (stand scripts registered at startup: ' + brief(scripts) + ')');
  return 'ui-set-scope site';
}

export async function tabIdOf(sw: Worker, url: string): Promise<number> {
  const prefix = url.replace(/#.*$/, '');
  const id = await sw.evaluate(async (p) => {
    const tabs = await chrome.tabs.query({});
    const hit = tabs.filter((t) => typeof t.url === 'string' && t.url.startsWith(p)).pop();
    return hit !== undefined && typeof hit.id === 'number' ? hit.id : -1;
  }, prefix);
  if (id < 0) throw new Error('no tab found for ' + prefix);
  return id;
}

export async function framesOf(sw: Worker, tabId: number): Promise<FrameInfo[]> {
  const frames = await sw.evaluate(async (id) => {
    const all = await chrome.webNavigation.getAllFrames({ tabId: id });
    return (all ?? []).map((f) => ({
      frameId: f.frameId,
      parentFrameId: f.parentFrameId,
      documentId: f.documentId,
      frameType: String(f.frameType),
    }));
  }, tabId);
  return frames;
}

export async function topFrame(sw: Worker, tabId: number): Promise<FrameInfo> {
  const frames = await framesOf(sw, tabId);
  const top = frames.find((f) => f.frameId === 0);
  if (top === undefined) throw new Error('no top frame for tab ' + String(tabId) + ': ' + brief(frames));
  return top;
}

export async function getReport(ui: Page, tabId: number, frameId?: number): Promise<ReportProjection | null> {
  const request: UiGetReportRequest =
    frameId === undefined
      ? { schemaVersion: 1, type: 'ui-get-report', tabId }
      : { schemaVersion: 1, type: 'ui-get-report', tabId, frameId };
  const response = await sendUi(ui, request);
  if (response.type === 'report') return response.report;
  throw new Error('ui-get-report answered ' + brief(response));
}

export interface WaitOptions {
  frameId?: number;
  timeoutMs?: number;
  intervalMs?: number;
  describe?: string;
}

/** Polls ui-get-report until `predicate` holds. Short default timeout: a failing scenario must fail fast. */
export async function waitForReport(
  ui: Page,
  tabId: number,
  predicate: (report: ReportProjection) => boolean,
  options: WaitOptions = {},
): Promise<ReportProjection> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const intervalMs = options.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let last: ReportProjection | null = null;
  for (;;) {
    last = await getReport(ui, tabId, options.frameId);
    if (last !== null && predicate(last)) return last;
    if (Date.now() >= deadline) break;
    await ui.waitForTimeout(intervalMs);
  }
  throw new Error(
    (options.describe ?? 'report condition') + ' not met within ' + String(timeoutMs) + ' ms; last report: ' + brief(last),
  );
}

export function techniques(report: ReportProjection, id: TechniqueId): TechniqueSummary[] {
  return report.techniques.filter((t) => t.techniqueId === id);
}

export function technique(report: ReportProjection, id: TechniqueId): TechniqueSummary | undefined {
  return techniques(report, id)[0];
}

/** Sum over all summaries of a technique (robust to one-per-phase or one-per-technique projections). */
export function techniqueCount(report: ReportProjection, id: TechniqueId): number {
  return techniques(report, id).reduce((sum, t) => sum + t.count, 0);
}

export function phasesOf(report: ReportProjection, id: TechniqueId): string[] {
  return [...new Set(techniques(report, id).flatMap((t) => t.phases))];
}

export function signalCodesOf(report: ReportProjection, id: TechniqueId): string[] {
  return [...new Set(techniques(report, id).flatMap((t) => t.signalCodes))];
}

export function findingsWith(report: ReportProjection, interpretations: readonly Interpretation[]): Finding[] {
  return report.findings.filter((f) => interpretations.includes(f.interpretation));
}

/** Interpretations present anywhere in the projection (technique summaries and findings). */
export function interpretationsOf(report: ReportProjection): Interpretation[] {
  return [...new Set([...report.techniques.map((t) => t.interpretation), ...report.findings.map((f) => f.interpretation)])];
}

export async function dumpSession(sw: Worker): Promise<Record<string, unknown>> {
  return sw.evaluate(() => chrome.storage.session.get(null));
}

export async function dumpLocal(sw: Worker): Promise<Record<string, unknown>> {
  return sw.evaluate(() => chrome.storage.local.get(null));
}

/**
 * Stored DocumentReports of the given tab (schemaVersion 1 + documentKey + tabId), found at any nesting depth so
 * the check does not depend on the repository's record layout (currently 'doc:<key>' -> { v, report, meta }).
 */
export function storedReportsForTab(dump: Record<string, unknown>, tabId: number): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const visit = (node: unknown, depth: number): void => {
    if (depth > 6 || typeof node !== 'object' || node === null) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    if (record['schemaVersion'] === 1 && typeof record['documentKey'] === 'string' && record['tabId'] === tabId) {
      out.push(record);
      return;
    }
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(dump, 0);
  return out;
}

export async function fixtureResult<T = Record<string, unknown>>(target: Page | Frame, timeoutMs = 10_000): Promise<T> {
  await target.waitForFunction(() => (window as unknown as { __fixtureResult?: unknown }).__fixtureResult !== undefined, undefined, {
    timeout: timeoutMs,
  });
  return target.evaluate(() => (window as unknown as { __fixtureResult: unknown }).__fixtureResult) as Promise<T>;
}

/**
 * Opens an extension page (privileged channel), makes sure the stand is observed (ensureObserved), then opens
 * the fixture URL in a new tab and resolves its trusted tabId from chrome.tabs (never from the page).
 */
export async function observed(ext: ExtensionSession, url: string, stage?: (stage: string) => void): Promise<Observed> {
  stage?.('get service worker');
  const sw = await getServiceWorker(ext.context);
  stage?.('open extension UI');
  const ui = await openExtensionPage(ext.context, sw);
  stage?.('ensure stand registration');
  const observedBy = await ensureObserved(sw, ui);
  stage?.('get scope');
  const scope = await getScope(ui);
  stage?.('open fixture tab');
  const page = await ext.context.newPage();
  stage?.('navigate fixture');
  await page.goto(url);
  stage?.('resolve trusted tab id');
  const tabId = await tabIdOf(sw, url);
  stage?.('ready');
  return { sw, ui, page, tabId, observedBy, scope };
}
