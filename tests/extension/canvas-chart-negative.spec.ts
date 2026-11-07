// Chart negative control (spec V §9 negative controls): measureText/fillText only, no readback of any kind.
// Expected: DET-003 as api-use and nothing else; no DET-001/DET-002; no non-api-use interpretation.

import { expect, test } from './harness';
import { DET, brief, fixtureResult, interpretationsOf, observed, technique, techniqueCount, waitForReport } from './helpers';

interface ChartResult {
  measureTextCalls: number;
  fillTextCalls: number;
  readback: boolean;
  widthsPositive: boolean;
}

test('chart fixture: text measurement and drawing are api-use only', async ({ ext, fixtures }) => {
  const url = fixtures.origins[0] + '/canvas-chart-negative.html';
  const { ui, page, tabId } = await observed(ext, url);
  const result = await fixtureResult<ChartResult>(page);
  expect(result.readback).toBe(false);
  expect(result.widthsPositive).toBe(true);
  const textCalls = result.measureTextCalls + result.fillTextCalls;

  const report = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.text) >= textCalls, { describe: 'DET-003 counted ' + String(textCalls) + ' text calls' });
  expect(technique(report, DET.canvasExport)).toBeUndefined();
  expect(technique(report, DET.pixelReadback)).toBeUndefined();
  expect(technique(report, DET.offscreen)).toBeUndefined();
  expect(interpretationsOf(report), 'only api-use expected: ' + brief(report)).toEqual(['api-use']);
  for (const f of report.findings) expect(f.interpretation).toBe('api-use');
  for (const t of report.techniques) {
    expect(t.evidenceSource).toBe('page-hook');
    expect(t.integrity).toBe('page-controlled');
  }
});
