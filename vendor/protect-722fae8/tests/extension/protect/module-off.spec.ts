// ADR-020 §10 invariant «module off» (S05, E21-05 case 3): while the module «Защита» is off, observation behaves exactly
// as without it. Observation all-sites, the module never enabled:
//   - registrations are exactly detector-isolated-v1 and detector-main-v1 (the page gets no module file);
//   - chrome.declarativeNetRequest is undefined in the SW (or, if granted, no rule of ours);
//   - no IndexedDB detect-expert-protect, no storage.local['protect'], no protect-* session keys;
//   - navigator.globalPrivacyControl is undefined; no module marker or channel message in the page;
//   - descriptors of window.fetch, EventTarget.prototype.addEventListener, MutationObserver.prototype.observe and
//     HTMLInputElement.prototype.value equal plain Chromium without the extension;
//   - __protectHarness.listeners() is empty;
//   - the canvas-fp-positive report and the network/sources report match the expectations of the existing specs.
// Then the module is enabled and disabled with purge, and every check is repeated (DNR: none of our id ranges).

import { expect, test } from '@playwright/test';
import type { Page, Worker } from '@playwright/test';
import type { ReportProjection } from '@detect-expert/contracts';
import { getServiceWorker, launchPlain, startFixtureServer } from '../harness';
import type { ExtensionSession, FixtureServer } from '../harness';
import { DET, brief, findingsWith, fixtureResult, openExtensionPage, signalCodesOf, tabIdOf, technique, techniqueCount, waitForReport } from '../helpers';
import {
  NO_LISTENERS,
  OBSERVATION_SCRIPT_IDS,
  PROTECT_DB,
  PROTECT_RESOLVER,
  PROTECT_SCRIPT_IDS,
  captureModuleChannel,
  databases,
  disableProtect,
  enableProtect,
  grantAllSites,
  launchProtect,
  moduleChannel,
  ourDnrRules,
  protectListeners,
  registeredIds,
  standUrl,
  tripwire,
} from './support';

interface Descriptor {
  key: string;
  kind: string;
  source: string | null;
  setSource: string | null;
  name: string | null;
  length: number | null;
  configurable: boolean;
  enumerable: boolean;
  writable: boolean | null;
}

/** Runs in the page's MAIN world: shape and native source of the four members the module could hook (never called). */
function pageFacts(): { descriptors: Descriptor[]; gpc: string; gpcOwn: boolean; markers: string[] } {
  const members: Array<[object, string]> = [
    [window, 'fetch'],
    [EventTarget.prototype, 'addEventListener'],
    [MutationObserver.prototype, 'observe'],
    [HTMLInputElement.prototype, 'value'],
  ];
  const toSource = (fn: unknown): string | null => (typeof fn === 'function' ? Function.prototype.toString.call(fn) : null);
  const descriptors = members.map(([owner, key]) => {
    const d = Object.getOwnPropertyDescriptor(owner, key);
    if (d === undefined) return { key, kind: 'missing', source: null, setSource: null, name: null, length: null, configurable: false, enumerable: false, writable: null };
    const fn = 'value' in d ? d.value : d.get;
    return {
      key,
      kind: 'value' in d ? 'data' : 'accessor',
      source: toSource(fn),
      setSource: toSource(d.set),
      name: typeof fn === 'function' ? (fn as { name: string }).name : null,
      length: typeof fn === 'function' ? (fn as { length: number }).length : null,
      configurable: d.configurable === true,
      enumerable: d.enumerable === true,
      writable: 'writable' in d ? d.writable === true : null,
    };
  });
  const markers = Object.getOwnPropertySymbols(window)
    .map((s) => s.description ?? '')
    .filter((d) => d.startsWith('detect.expert/protect'));
  return {
    descriptors,
    gpc: typeof (navigator as unknown as { globalPrivacyControl?: unknown }).globalPrivacyControl,
    gpcOwn: 'globalPrivacyControl' in Navigator.prototype,
    markers,
  };
}

async function plainFacts(server: FixtureServer): Promise<ReturnType<typeof pageFacts>> {
  const plain = await launchPlain({ hostResolverRules: PROTECT_RESOLVER });
  try {
    const page = await plain.context.newPage();
    await page.goto(standUrl(server.origins[0]!, 'www.example.com', '/canvas-fp-positive.html'));
    await fixtureResult(page);
    return await page.evaluate(pageFacts);
  } finally {
    await plain.close();
  }
}

/** canvas-positive.spec.ts expectations (all-sites): DET-001/002/003, readback-after-text, a low possible-fingerprinting finding. */
function expectCanvasReport(report: ReportProjection, fillTextCalls: number): void {
  expect(['active', 'partial', 'late-start']).toContain(report.coverageState);
  expect(techniqueCount(report, DET.text)).toBeGreaterThanOrEqual(fillTextCalls);
  expect(techniqueCount(report, DET.pixelReadback)).toBeGreaterThanOrEqual(2);
  expect(techniqueCount(report, DET.canvasExport)).toBeGreaterThanOrEqual(2);
  const readback = technique(report, DET.pixelReadback);
  expect(readback?.evidenceSource).toBe('page-hook');
  expect(readback?.integrity).toBe('page-controlled');
  expect(readback?.phases).toContain('returned-sync');
  expect(signalCodesOf(report, DET.pixelReadback)).toContain('readback-after-text');
  const findings = findingsWith(report, ['fingerprinting-pattern', 'possible-fingerprinting']);
  expect(findings.length, brief(report.findings)).toBeGreaterThan(0);
  for (const f of findings) {
    expect(f.interpretation).toBe('possible-fingerprinting');
    expect(f.interpretationConfidence).toBe('low');
  }
  expect(report.vendors).toEqual([]);
}

/** stand/network.spec.ts all-sites expectations: example.net cross-site, DET-059 ≥ 2, no network-limited, active. */
function expectNetworkReport(report: ReportProjection): void {
  expect(report.coverageState).toBe('active');
  expect(report.coverageFlags).not.toContain('network-limited');
  const net = report.hosts.find((h) => h.registrableDomain === 'example.net');
  expect(net).toMatchObject({ relation: 'cross-site', evidenceSource: 'browser-network', integrity: 'browser-observed' });
  expect(net!.requestCount).toBeGreaterThanOrEqual(2);
  expect(JSON.stringify(report.hosts)).not.toMatch(/cdn\.|4174|network-resource|dot\.png|127\.0\.0\.1/);
}

async function checkModuleOff(ext: ExtensionSession, sw: Worker, ui: Page, server: FixtureServer, plain: ReturnType<typeof pageFacts>, phase: string): Promise<void> {
  // Registrations, DNR, storage, listeners (SW side).
  expect(await registeredIds(sw), phase + ': registrations').toEqual([...OBSERVATION_SCRIPT_IDS]);
  const dnr = await ourDnrRules(sw);
  expect(dnr.ids, phase + ': no DNR rule in our ranges').toEqual([]);
  if (phase === 'never enabled') expect(dnr.api, 'chrome.declarativeNetRequest is undefined without the optional grant').toBe(false);
  expect(await databases(sw), phase + ': IndexedDB').not.toContain(PROTECT_DB);
  expect(Object.keys(await sw.evaluate(() => chrome.storage.local.get(null))), phase + ': storage.local').not.toContain('protect');
  expect(Object.keys(await sw.evaluate(() => chrome.storage.session.get(null))).filter((k) => k.startsWith('protect')), phase + ': protect-* session keys').toEqual([]);
  expect(await protectListeners(sw), phase + ': module listeners').toEqual(NO_LISTENERS);

  // The page: no module file, marker, property or channel message; descriptors as in plain Chromium.
  const canvas = await ext.context.newPage();
  await captureModuleChannel(canvas);
  await canvas.goto(standUrl(server.origins[0]!, 'www.example.com', '/canvas-fp-positive.html'));
  const result = await fixtureResult<{ fillTextCalls: number }>(canvas);
  const facts = await canvas.evaluate(pageFacts);
  expect(facts.gpc, phase + ': navigator.globalPrivacyControl').toBe('undefined');
  expect(facts.markers, phase + ': module markers on window').toEqual([]);
  expect(facts.descriptors, phase + ': descriptors equal plain Chromium').toEqual(plain.descriptors);
  expect(facts.gpcOwn).toBe(plain.gpcOwn);
  expect(await tripwire(canvas), phase + ': no tripwire (no module file)').toEqual({ isolated: null, main: null });
  const tabId = await tabIdOf(sw, canvas.url());
  const report = await waitForReport(ui, tabId, (r) => technique(r, DET.pixelReadback) !== undefined && technique(r, DET.canvasExport) !== undefined, { describe: phase + ': DET-001 and DET-002', timeoutMs: 15_000 });
  expectCanvasReport(report, result.fillTextCalls);
  expect(await moduleChannel(canvas), phase + ': module channel').toEqual([]);

  const sources = await ext.context.newPage();
  await sources.goto(standUrl(server.origins[0]!, 'www.example.com', '/network/sources.html?third=cdn.example.net'));
  await fixtureResult(sources);
  const sourcesTab = await tabIdOf(sw, sources.url());
  const net = await waitForReport(ui, sourcesTab, (r) => r.hosts.some((h) => h.registrableDomain === 'example.net') && techniqueCount(r, 'DET-059') >= 2 && techniqueCount(r, 'DET-001') >= 1, {
    describe: phase + ': network sources (example.net, DET-059 >= 2)',
    timeoutMs: 15_000,
  });
  expectNetworkReport(net);
  await canvas.close();
  await sources.close();
}

test('module off: observation unchanged and nothing of the module present, also after enable + disable with purge', async () => {
  test.setTimeout(180_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const plain = await plainFacts(server);
    expect(plain.gpc, 'plain Chromium: navigator.globalPrivacyControl').toBe('undefined');
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const ui = await openExtensionPage(ext.context, sw, 'popup.html');
    await checkModuleOff(ext, sw, ui, server, plain, 'never enabled');

    const on = await enableProtect(sw, ['value-match', 'session-replay']);
    expect(on.state?.state, brief(on)).toBe('active');
    expect(await registeredIds(sw)).toEqual([...OBSERVATION_SCRIPT_IDS, ...PROTECT_SCRIPT_IDS].sort());
    expect(await databases(sw)).toContain(PROTECT_DB);
    const off = await disableProtect(sw, true);
    expect(off.state?.state, brief(off)).toBe('off');
    await checkModuleOff(ext, sw, ui, server, plain, 'after enable + disable(purge)');
  } finally {
    await ext.close();
    await server.close();
  }
});
