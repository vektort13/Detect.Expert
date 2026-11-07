import { test, expect, launch, getServiceWorker } from './harness';
import { openExtensionPage, ensureObserved, waitForReport, sendUi } from './helpers';

test('P01: random DNS labels and literal IP never reach session or export; inline attribution is unknown', async ({ fixtures }) => {
  const session = await launch({ hostResolverRules: 'MAP *.example.com 127.0.0.1' });
  try {
    const sw = await getServiceWorker(session.context);
    const ui = await openExtensionPage(session.context, sw);
    await ensureObserved(sw, ui);
    const page = await session.context.newPage();
    await page.goto(fixtures.origins[0] + '/privacy/network-canary.html');
    await page.waitForFunction(() => (window as unknown as { __fixtureResult?: unknown }).__fixtureResult !== undefined);
    const result = await page.evaluate(() => (window as unknown as { __fixtureResult?: unknown }).__fixtureResult) as { label: string; loaded: number };
    expect(result.loaded).toBe(2);
    const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)!.id!, page.url());
    await waitForReport(ui, tabId, (r) => r.techniques.some((t) => t.techniqueId === 'DET-001' && t.attributionConfidence === 'unknown'));
    await expect.poll(async () => {
      const stored = await sw.evaluate(() => chrome.storage.session.get(null));
      return Object.values(stored).some((v) => (v as { report?: { hosts?: Array<{ category?: string; requestCount: number }> } }).report?.hosts?.some((h) => h.category === 'loopback' && h.requestCount > 0));
    }).toBe(true);
    const storage = await sw.evaluate(() => chrome.storage.session.get(null));
    expect(JSON.stringify(storage)).not.toContain(result.label);
    expect(JSON.stringify(storage)).not.toContain('127.0.0.1');
    const response = await sendUi(ui, { schemaVersion: 1, type: 'ui-get-report', tabId });
    expect(response.type).toBe('report');
    if (response.type !== 'report' || !response.report) throw new Error('missing report');
    const preview = await sendUi(ui, { schemaVersion: 1, type: 'ui-export-preview', tabId, documentKey: response.report.documentKey, reportRevision: response.report.reportRevision, includeHost: true });
    expect(preview.type).toBe('export-preview');
    expect(JSON.stringify(preview)).not.toContain(result.label);
    expect(JSON.stringify(preview)).not.toContain('127.0.0.1');
    // Existing test grant covers only the literal origin. No new manifest permissions are allowed by P01.
    expect(await sw.evaluate(() => chrome.permissions.contains({ origins: ['http://example.com/*'] }))).toBe(false);
    test.info().annotations.push({ type: 'coverage', description: 'Random DNS resource completes via local resolver, but observer rejects its ungranted target. Granted PSL attribution is covered by unit tests; browser evidence here covers IP category and permission refusal.' });
  } finally { await session.close(); }
});
