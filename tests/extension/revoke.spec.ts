// Scope-off regression under the static test grant (REQ-012, ADR-003). Retained browser permissions must
// never override app scope. Actual optional permission removal is covered by permissions/matrix.spec.ts (P05).

import { expect, test } from './harness';
import { DET, assertAccepted, brief, fixtureResult, getReport, observed, registeredScripts, setScope, techniqueCount, waitForReport } from './helpers';

test('scope revoke stops new observations and reports no-access', async ({ ext, fixtures }) => {
  const url = fixtures.origins[0] + '/reinstall.html';
  const { sw, ui, page, tabId, observedBy } = await observed(ext, url);
  await fixtureResult(page);
  const staticGrant = await sw.evaluate(() => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }));
  expect(staticGrant).toBe(true);
  const removable = await sw.evaluate(async () => {
    try {
      return await chrome.permissions.remove({ origins: ['http://127.0.0.1/*'] });
    } catch {
      return false;
    }
  });
  test.info().annotations.push({ type: 'permissions.remove', description: removable ? 'static host permission was removable (unexpected)' : 'static host permission of the test profile cannot be removed' });

  const done = await page.evaluate(() => (window as unknown as { __readback: (n: number) => number }).__readback(2));
  expect(done).toBe(2);
  const active = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) >= 2, { describe: 'two readbacks observed before revoke' });
  const countBefore = techniqueCount(active, DET.pixelReadback);

  const off = await setScope(ui, 'off');
  assertAccepted(off, 'ui-set-scope off');
  const registered = (await registeredScripts(sw)).map((s) => s.id);
  test.info().annotations.push({ type: 'after-scope-off', description: 'observedBy=' + observedBy + ', still registered: ' + brief(registered) });
  expect(registered, 'content scripts must be unregistered on revoke').toEqual([]);

  // Page keeps working; new calls are no longer observed.
  const later = await page.evaluate(() => (window as unknown as { __readback: (n: number) => number }).__readback(3));
  expect(later).toBe(3);
  await page.waitForTimeout(1500);
  const after = await getReport(ui, tabId);
  if (after === null) {
    test.info().annotations.push({ type: 'revoke', description: 'report removed on revoke (data deleted by policy, ADR-003 §5)' });
    await page.waitForTimeout(1000);
    expect(await getReport(ui, tabId), 'no report must reappear after revoke').toBeNull();
  } else {
    expect(techniqueCount(after, DET.pixelReadback), 'revocation purges observed data: ' + brief(after)).toBe(0);
    expect(after.techniques).toEqual([]);
    expect(after.host).toBeNull();
    expect(after.observedSince).toBeNull();
    expect(after.coverageState).toBe('no-access');
    test.info().annotations.push({ type: 'revoke', description: 'coverageFlags=' + brief(after.coverageFlags) });
    expect(after.coverageFlags).toContain('revoked');
  }
});
