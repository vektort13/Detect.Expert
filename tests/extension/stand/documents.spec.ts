// P06 / E02-01 / ADR-003 / ADR-005: real document-start, script-origin and frame boundaries.
import type { DocumentReport } from '@detect-expert/contracts';
import { test, expect, evidence, captureNavigation, navigationTrace, captureSenders, senderTrace, captureVendorRequests, vendorRequests } from './harness';
import { getServiceWorker, launch } from '../harness';
import { grant } from '../permissions/support';
import { DET, ensureObserved, framesOf, getReport, injectNow, observed, openExtensionPage, registeredScripts,
  tabIdOf, techniqueCount, unregisterStandScripts, waitForReport } from '../helpers';

test('P06: document_start wraps before first inline; active-tab starts after its marker', async ({ ext, fixtures }) => {
  const sw = await getServiceWorker(ext.context);
  const ui = await openExtensionPage(ext.context, sw);
  await ensureObserved(sw, ui);
  const scripts = await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  expect(scripts).toHaveLength(2);
  expect(scripts.every((script) => script.runAt === 'document_start')).toBe(true);
  const early = await ext.context.newPage();
  await early.goto(fixtures.origins[0] + '/order-marker.html');
  const earlyMarker = await early.evaluate(() => (window as unknown as { __realm: { wrappedAtFirstInline: boolean } }).__realm.wrappedAtFirstInline);
  expect(earlyMarker).toBe(true);
  const earlyTab = await tabIdOf(sw, early.url());
  const earlyReport = await waitForReport(ui, earlyTab, (report) => techniqueCount(report, DET.canvasExport) === 1);
  expect(earlyReport.coverageFlags).not.toContain('late-start');
  await unregisterStandScripts(sw);
  expect(await registeredScripts(sw)).toEqual([]);
  const late = await ext.context.newPage();
  await late.goto(fixtures.origins[0] + '/order-marker.html?late=1');
  const lateTab = await tabIdOf(sw, late.url());
  const lateMarker = await late.evaluate(() => (window as unknown as { __realm: { wrappedAtFirstInline: boolean } }).__realm.wrappedAtFirstInline);
  expect(lateMarker).toBe(false);
  expect((await injectNow(ui, lateTab)).type).toBe('ok');
  await late.evaluate(() => (window as unknown as { __realm: { read(): void } }).__realm.read());
  const lateReport = await waitForReport(ui, lateTab, (report) => techniqueCount(report, DET.canvasExport) === 1);
  expect(lateReport.coverageFlags).toContain('late-start');
  await evidence(late, 'P06-inline-order', { scripts, earlyMarker, lateMarker, earlyReport, lateReport,
    grant: 'static loopback grant exercises injection ordering; actual toolbar activeTab is covered by P05' });
});

for (const targetGranted of [true, false]) {
  test('P06: external script executes in parent; network target permission ' + targetGranted, async ({ ext, fixtures }) => {
    await captureVendorRequests(await getServiceWorker(ext.context));
    const suffix = targetGranted ? '' : '?host=localhost';
    const { sw, ui, page, tabId } = await observed(ext, fixtures.origins[0] + '/third-party-script.html' + suffix);
    await page.waitForFunction(() => (window as unknown as { __realmVendor?: { completed: boolean } }).__realmVendor?.completed === true);
    const report = await waitForReport(ui, tabId, (value) => techniqueCount(value, DET.pixelReadback) === 1 && techniqueCount(value, DET.canvasExport) === 1);
    expect(report.findings.some((finding) => finding.interpretation === 'possible-fingerprinting' || finding.interpretation === 'fingerprinting-pattern')).toBe(true);
    expect(report.techniques.every((technique) => technique.attributionConfidence !== 'exact-resource')).toBe(true);
    expect(report.documentKey.startsWith(String(tabId) + ':0:')).toBe(true);
    expect(await sw.evaluate((host) => chrome.permissions.contains({ origins: ['http://' + host + '/*'] }), targetGranted ? '127.0.0.1' : 'localhost')).toBe(targetGranted);
    // Wait for the network-completed debounce, then inspect only this document's persisted allowlisted host summaries.
    await page.waitForTimeout(700);
    const stored = await sw.evaluate(async (key) => {
      const items = await chrome.storage.session.get('doc:' + key);
      return (items['doc:' + key] as { report: DocumentReport } | undefined)?.report;
    }, report.documentKey);
    expect(stored).toBeDefined();
    const requests = await vendorRequests(sw);
    if (targetGranted) expect(requests).toEqual([{ tabId, documentId: report.documentKey.split(':')[2], host: '127.0.0.1', port: '4174', initiatorHost: '127.0.0.1', type: 'script' }]);
    else expect(requests).toEqual([]);
    if (targetGranted) expect(stored!.hosts.some((host) => host.category === 'loopback' && host.relation === 'same-site' && host.evidenceSource === 'browser-network')).toBe(true);
    else expect(stored!.hosts).toEqual([]);
    await evidence(page, 'P06-third-party-' + targetGranted, { targetGranted, report, hosts: stored!.hosts, requests });
  });
}

const optionalTest = test.extend({
  ext: async ({}, use) => {
    const session = await launch({ profile: 'test-optional' });
    try { await use(session); } finally { await session.close(); }
  },
});

for (const mode of ['same', 'cross', 'ungranted'] as const) {
  optionalTest('P06: ' + mode + ' origin frame preserves document identity and coverage', async ({ ext, fixtures }) => {
    const worker = await getServiceWorker(ext.context);
    await grant(ext, worker, 'site');
    expect(await worker.evaluate(() => chrome.permissions.contains({ origins: ['http://localhost/*'] }))).toBe(false);
    const fixture = mode === 'same' ? '/iframe-same-origin.html' : mode === 'ungranted' ? '/iframe-cross-origin-no-permission.html' : '/realms/iframe-parent.html?mode=cross';
    const { sw, ui, page, tabId } = await observed(ext, fixtures.origins[0] + fixture);
    const child = page.frameLocator('#child');
    await expect(child.locator('h1')).toHaveText('Child readbacks');
    const frame = page.frames().find((entry) => entry.parentFrame() === page.mainFrame());
    expect(frame).toBeDefined();
    const wrapped = await frame!.evaluate(() => (window as unknown as { __realm: { wrappedAtFirstInline: boolean } }).__realm.wrappedAtFirstInline);
    expect(wrapped).toBe(mode !== 'ungranted');
    const frames = await framesOf(sw, tabId);
    const childInfo = frames.find((entry) => entry.parentFrameId === 0 && entry.frameId !== 0);
    expect(childInfo).toBeDefined();
    const childReport = await waitForReport(ui, tabId,
      (report) => mode === 'ungranted' ? report.coverageState === 'no-access' : techniqueCount(report, DET.pixelReadback) === 2,
      { frameId: childInfo!.frameId });
    expect(childReport.documentKey).toBe(String(tabId) + ':' + childInfo!.frameId + ':' + childInfo!.documentId);
    const parent = await waitForReport(ui, tabId, (report) => techniqueCount(report, DET.canvasExport) === 1 &&
      (mode !== 'ungranted' || report.coverageFlags.includes('frames-inaccessible')));
    expect(parent.documentKey).not.toBe(childReport.documentKey);
    expect(techniqueCount(parent, DET.pixelReadback)).toBe(0);
    await evidence(page, 'P06-frame-' + mode, { wrapped, frames, childReport, parent });
    if (mode === 'ungranted') {
      expect(childReport.techniques).toEqual([]);
      expect(parent.coverageFlags).toContain('frames-inaccessible');
      expect(parent.coverageState).toBe('partial');
    }
  });
}

for (const mode of ['blank', 'blob'] as const) {
  test('P06: ' + mode + ' inherited-origin frame has its own observed document', async ({ ext, fixtures }) => {
    const worker = await getServiceWorker(ext.context);
    await captureNavigation(worker);
    await captureSenders(worker);
    const { sw, ui, page, tabId } = await observed(ext, fixtures.origins[0] + (mode === 'blank' ? '/about-blank-frame.html' : '/blob-frame.html'));
    if (mode === 'blob') await page.waitForFunction(() => (window as unknown as { __blobLoaded: boolean }).__blobLoaded === true);
    const frame = page.frames().find((entry) => entry.parentFrame() === page.mainFrame());
    expect(frame).toBeDefined();
    expect(frame!.url()).toMatch(mode === 'blank' ? /^about:blank$/ : /^blob:http:\/\/127\.0\.0\.1:4173\//);
    await expect.poll(() => frame!.evaluate(() => !Function.prototype.toString.call(CanvasRenderingContext2D.prototype.getImageData).includes('[native code]'))).toBe(true);
    await frame!.evaluate(() => { document.createElement('canvas').getContext('2d')!.getImageData(0, 0, 1, 1); });
    await expect.poll(async () => (await senderTrace(sw)).some((entry) => entry.tabId === tabId && entry.frameId !== 0 && entry.scheme === (mode === 'blob' ? 'blob:' : 'about:'))).toBe(true);
    const senders = await senderTrace(sw);
    const frames = await framesOf(sw, tabId);
    const childSender = senders.find((entry) => entry.tabId === tabId && entry.scheme === (mode === 'blob' ? 'blob:' : 'about:'));
    expect(childSender?.inheritedOrigin).toBe(true);
    // Chromium getAllFrames can omit blob frames; the real onCommitted event still supplies their identity.
    const childInfo = (await navigationTrace(sw)).find((entry) => entry.kind === 'committed' && entry.documentId === childSender!.documentId);
    expect(childInfo).toBeDefined();
    const childReport = await waitForReport(ui, tabId, (report) => techniqueCount(report, DET.pixelReadback) === 1, { frameId: childInfo!.frameId });
    expect(childReport.host).toBeNull();
    expect(childReport.documentKey).toBe(String(tabId) + ':' + childInfo!.frameId + ':' + childInfo!.documentId);
    expect(childReport.techniques.every((technique) => technique.attributionConfidence === 'frame-only' || technique.attributionConfidence === 'unknown')).toBe(true);
    const parent = await getReport(ui, tabId);
    expect(parent?.documentKey).not.toBe(childReport.documentKey);
    expect(parent?.coverageFlags).not.toContain('frames-inaccessible');
    expect(parent && techniqueCount(parent, DET.pixelReadback)).toBe(0);
    await evidence(page, 'P06-inherited-' + mode, { frames, senders, navigation: await navigationTrace(sw), childReport, parent });
  });
}
