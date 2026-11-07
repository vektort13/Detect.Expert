// UI pause / resume end to end (ADR-004 changelog «bridge-control», F030; REQ-012 semantics of pause): after
// `ui-pause` the page keeps working but new canvas calls are not counted; after `ui-resume` counting continues.
// Resume must reach a bridge that is not sending anything (a paused bridge never sees an Ack), so the SW pushes
// `bridge-control` through chrome.tabs.sendMessage to the exact document; the bridge relays bridge-resume to the
// sensor. Revisions are re-read before each action (ui-resume requires the current reportRevision, F039).

import { expect, test } from './harness';
import { DET, brief, fixtureResult, getReport, observed, sendUi, techniqueCount, waitForReport } from './helpers';

test('pause stops counting, resume restarts it through the SW -> bridge control channel', async ({ ext, fixtures }) => {
  const url = fixtures.origins[0] + '/reinstall.html';
  const { ui, page, tabId } = await observed(ext, url);
  await fixtureResult(page);
  expect(await page.evaluate(() => (window as unknown as { __readback: (n: number) => number }).__readback(2))).toBe(2);
  const active = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) >= 2, { describe: 'two readbacks before pause' });
  const countBefore = techniqueCount(active, DET.pixelReadback);

  const paused = await sendUi(ui, { schemaVersion: 1, type: 'ui-pause', tabId, documentKey: active.documentKey, reportRevision: active.reportRevision });
  expect(paused.type, 'ui-pause: ' + brief(paused)).toBe('ok');
  const pausedReport = await waitForReport(ui, tabId, (r) => r.coverageState === 'paused', { describe: 'coverageState paused' });
  expect(pausedReport.coverageFlags).toContain('paused');

  // Page keeps working; nothing new is counted while paused.
  expect(await page.evaluate(() => (window as unknown as { __readback: (n: number) => number }).__readback(3))).toBe(3);
  await page.waitForTimeout(1500);
  const whilePaused = await getReport(ui, tabId);
  expect(whilePaused?.coverageState).toBe('paused');
  expect(techniqueCount(whilePaused as NonNullable<typeof whilePaused>, DET.pixelReadback), 'no counting while paused: ' + brief(whilePaused)).toBe(countBefore);

  // Resume with a stale revision is refused; with the current one it is accepted and reaches the bridge.
  const stale = await sendUi(ui, { schemaVersion: 1, type: 'ui-resume', tabId, documentKey: pausedReport.documentKey, reportRevision: pausedReport.reportRevision + 1000 });
  expect(stale).toEqual({ schemaVersion: 1, type: 'error', code: 'stale-revision' });
  const current = await getReport(ui, tabId);
  if (current === null) throw new Error('report vanished while paused');
  const resumed = await sendUi(ui, { schemaVersion: 1, type: 'ui-resume', tabId, documentKey: current.documentKey, reportRevision: current.reportRevision });
  expect(resumed.type, 'ui-resume: ' + brief(resumed)).toBe('ok');
  await waitForReport(ui, tabId, (r) => r.coverageState !== 'paused', { describe: 'coverageState leaves paused' });

  // The bridge and the sensor observe again: exactly the post-resume calls are added.
  expect(await page.evaluate(() => (window as unknown as { __readback: (n: number) => number }).__readback(4))).toBe(4);
  const after = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) >= countBefore + 4, { describe: 'four readbacks counted after resume' });
  expect(techniqueCount(after, DET.pixelReadback)).toBe(countBefore + 4);
  expect(after.documentKey).toBe(active.documentKey);
  // The paused interval stays visible in coverage after resume (E06-02 #2).
  expect(after.coverageFlags).toContain('paused');
});

// F088: pause belongs to one document, never the entire site.
test('same-host cross-document navigation does not inherit pause', async ({ ext, fixtures }) => {
  const { ui, page, tabId } = await observed(ext, fixtures.origins[0] + '/reinstall.html');
  await fixtureResult(page);
  await page.evaluate(() => (window as unknown as { __readback: (n: number) => number }).__readback(2));
  const before = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) === 2);
  expect((await sendUi(ui, { schemaVersion: 1, type: 'ui-pause', tabId, documentKey: before.documentKey, reportRevision: before.reportRevision })).type).toBe('ok');
  await waitForReport(ui, tabId, (r) => r.coverageState === 'paused');
  await page.goto(fixtures.origins[0] + '/reinstall.html?next-document=1');
  await fixtureResult(page);
  await page.evaluate(() => (window as unknown as { __readback: (n: number) => number }).__readback(3));
  const after = await waitForReport(ui, tabId, (r) => r.documentKey !== before.documentKey && techniqueCount(r, DET.pixelReadback) === 3);
  expect(after.host).toBe(before.host);
  expect(after.coverageState).toBe('active');
  expect(after.coverageFlags).not.toContain('paused');
});
