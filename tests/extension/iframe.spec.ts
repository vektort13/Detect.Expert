// Cross-origin iframe (E02-01 case 3, ADR-003 §6, matrix §1): the parent on origin 1 embeds a child from origin 2
// (both covered by the stand's host permission). Only the child reads back. Expected: the child's observations
// land in the child's own documentKey (frameId !== 0, documentId from webNavigation); the parent report is
// either absent or free of canvas techniques.

import { expect, test } from './harness';
import { DET, brief, fixtureResult, framesOf, getReport, observed, technique, techniqueCount, waitForReport } from './helpers';

interface ParentResult {
  childOrigin: string;
  childLoaded: boolean;
  parentCanvasCalls: number;
}

interface ChildResult {
  isFramed: boolean;
  readbacks: number;
}

test('child frame observations are attributed to the child documentKey; parent unaffected', async ({ ext, fixtures }) => {
  const url = fixtures.origins[0] + '/iframe-parent.html';
  const { sw, ui, page, tabId } = await observed(ext, url);
  await page.waitForFunction(() => (window as unknown as { __fixtureResult?: { childLoaded?: boolean } }).__fixtureResult?.childLoaded === true);
  const parent = await fixtureResult<ParentResult>(page);
  expect(parent.childOrigin).toBe(fixtures.origins[1]);
  expect(parent.parentCanvasCalls).toBe(0);

  const childFrame = page.frames().find((f) => f.url().startsWith(fixtures.origins[1] + '/iframe-child.html'));
  expect(childFrame, 'child frame present').toBeDefined();
  const child = await fixtureResult<ChildResult>(childFrame!);
  expect(child.isFramed).toBe(true);
  expect(child.readbacks).toBe(2);

  const frames = await framesOf(sw, tabId);
  const childInfo = frames.find((f) => f.frameId !== 0 && f.parentFrameId === 0);
  expect(childInfo, 'webNavigation lists the child frame: ' + brief(frames)).toBeDefined();
  const childFrameId = childInfo!.frameId;
  expect(childFrameId).not.toBe(0);

  const childReport = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) >= 2, { frameId: childFrameId, describe: 'child DET-002 readbacks' });
  expect(childReport.documentKey).toBe(String(tabId) + ':' + String(childFrameId) + ':' + childInfo!.documentId);
  expect(childReport.host).toBeNull();

  const parentReport = await getReport(ui, tabId, 0);
  if (parentReport !== null) {
    expect(parentReport.documentKey).not.toBe(childReport.documentKey);
    expect(parentReport.documentKey).toBe(String(tabId) + ':0:' + frames.find((f) => f.frameId === 0)!.documentId);
    expect(technique(parentReport, DET.pixelReadback)).toBeUndefined();
    expect(technique(parentReport, DET.canvasExport)).toBeUndefined();
    expect(technique(parentReport, DET.text)).toBeUndefined();
  }
  test.info().annotations.push({ type: 'parent-report', description: parentReport === null ? 'absent' : 'present without canvas techniques (' + brief(parentReport.coverageFlags) + ')' });
});
