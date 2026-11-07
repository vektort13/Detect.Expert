// Review W3 (ADR-020 §10, §13): observation keeps working when its MAIN registration is made AFTER the module's. The
// test profile runs the candidate hook configuration (listen 'prototype': the module replaces
// EventTarget.prototype.addEventListener), and observation's bootstrap refuses a non-native window.addEventListener.
// Here the module is active first; observation is then unregistered and registered again (scope off -> all sites),
// so its fresh detector-main-v1 would come after detector-protect-main-v1 (SP-7: registration order = execution
// order). The SW re-registers the module's MAIN script after it: in a new page observation installs first and
// reports the canvas fixture, and the module's wrappers are still installed after it.

import { expect, test } from '@playwright/test';
import { getServiceWorker, startFixtureServer } from '../harness';
import { DET, assertAccepted, brief, fixtureResult, openExtensionPage, setScope, tabIdOf, technique, waitForReport } from '../helpers';
import { PROTECT_SCRIPT_IDS, enableProtect, grantAllSites, harness, launchProtect, registeredIds, standUrl } from './support';

test('review W3: observation registered after the module still reports; the module re-registers its MAIN script after it', async () => {
  test.setTimeout(120_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const on = await enableProtect(sw, ['value-match', 'session-replay']);
    expect(on.state?.state, brief(on)).toBe('active');
    const ui = await openExtensionPage(ext.context, sw, 'popup.html');
    // Observation unregisters and registers afresh: its MAIN registration is now newer than the module's.
    assertAccepted(await setScope(ui, 'off'), 'scope off');
    await expect.poll(async () => (await registeredIds(sw)).filter((id) => !id.startsWith('detector-protect'))).toEqual([]);
    assertAccepted(await setScope(ui, 'all-sites'), 'scope all sites');
    await expect.poll(async () => (await registeredIds(sw)).length).toBe(4);
    // The module followed: its diagnostics count a re-registration after observation's fresh registration.
    await expect
      .poll(async () => (await harness<{ diagnostics: Record<string, number> }>(sw, 'state')).diagnostics['mainReordered'] ?? -1, { message: 'mainReordered' })
      .toBeGreaterThanOrEqual(1);
    expect((await registeredIds(sw)).filter((id) => id.startsWith('detector-protect')).sort()).toEqual([...PROTECT_SCRIPT_IDS].sort());

    const canvas = await ext.context.newPage();
    await canvas.goto(standUrl(server.origins[0]!, 'www.example.com', '/canvas-fp-positive.html'));
    await fixtureResult(canvas);
    const tabId = await tabIdOf(sw, canvas.url());
    // Observation installed (the page's report has the canvas techniques)...
    const report = await waitForReport(ui, tabId, (r) => technique(r, DET.pixelReadback) !== undefined && technique(r, DET.canvasExport) !== undefined, { describe: 'DET-001 and DET-002 with the module active', timeoutMs: 15_000 });
    expect(['active', 'partial', 'late-start']).toContain(report.coverageState);
    // ...and the module's MAIN wrappers are installed in the same page (candidate configuration of the test profile).
    const native = await canvas.evaluate(() => [EventTarget.prototype.addEventListener, MutationObserver.prototype.observe].map((fn) => Function.prototype.toString.call(fn).includes('[native code]')));
    expect(native, 'module wrappers installed after observation').toEqual([false, false]);
  } finally {
    await ext.close();
    await server.close();
  }
});
