// Tainted canvas (vertical slice §4, docs/coverage/matrix.md §3): a cross-origin image from the second stand
// origin taints the canvas; getImageData / toDataURL / toBlob throw SecurityError. The original exception must
// reach the page unchanged (REQ-002) and the report must count the attempt as phase threw-sync.

import { expect, test } from './harness';
import { DET, fixtureResult, observed, phasesOf, signalCodesOf, technique, waitForReport } from './helpers';

interface Attempt {
  threw: boolean;
  error?: { name: string; message: string; isDOMException: boolean };
}

interface TaintedResult {
  imageOrigin: string;
  imageLoaded: boolean;
  error?: string;
  getImageData?: Attempt;
  toDataURL?: Attempt;
  toBlob?: Attempt;
}

test('tainted canvas: SecurityError reaches the page and the attempt is counted as threw-sync', async ({ ext, fixtures }) => {
  const url = fixtures.origins[0] + '/canvas-tainted.html';
  const { ui, page, tabId } = await observed(ext, url);
  const result = await fixtureResult<TaintedResult>(page);
  expect(result.imageOrigin).toBe(fixtures.origins[1]);
  expect(result.imageLoaded, result.error ?? '').toBe(true);

  for (const name of ['getImageData', 'toDataURL', 'toBlob'] as const) {
    const attempt = result[name];
    expect(attempt?.threw, name + ' must throw on a tainted canvas').toBe(true);
    expect(attempt?.error?.name, name).toBe('SecurityError');
    expect(attempt?.error?.isDOMException, name).toBe(true);
  }

  const report = await waitForReport(
    ui,
    tabId,
    (r) => phasesOf(r, DET.pixelReadback).includes('threw-sync') && phasesOf(r, DET.canvasExport).includes('threw-sync'),
    { describe: 'DET-002 and DET-001 with phase threw-sync' },
  );
  expect(technique(report, DET.pixelReadback)?.integrity).toBe('page-controlled');
  // Attempt, not success: no returned-sync for the readback on this page.
  expect(phasesOf(report, DET.pixelReadback)).not.toContain('returned-sync');
  test.info().annotations.push({
    type: 'signal-codes',
    description: 'DET-002: ' + signalCodesOf(report, DET.pixelReadback).join(',') + '; DET-001: ' + signalCodesOf(report, DET.canvasExport).join(','),
  });
});
