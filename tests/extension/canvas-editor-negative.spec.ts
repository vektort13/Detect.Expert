// Editor negative control (vertical slice §4): 300 brush-like fillText calls and one PNG export on click.
// Expected under rule v2: api-use/unassessed with no inferred counter-evidence, including one export.

import { expect, test } from './harness';
import { DET, brief, findingsWith, fixtureResult, interpretationsOf, observed, technique, techniqueCount, waitForReport } from './helpers';

interface EditorResult {
  fillTextCalls: number;
  readbackAtLoad: boolean;
}

interface ExportResult {
  type: string | null;
  size: number | null;
  exports: number;
}

test('editor fixture: strokes and a PNG export are not reported as fingerprinting-pattern', async ({ ext, fixtures }) => {
  const url = fixtures.origins[0] + '/canvas-editor-negative.html';
  const { ui, page, tabId } = await observed(ext, url);
  const result = await fixtureResult<EditorResult>(page);
  expect(result.fillTextCalls).toBe(300);
  expect(result.readbackAtLoad).toBe(false);

  const afterStrokes = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.text) >= 300, { describe: 'DET-003 counted 300 strokes' });
  expect(technique(afterStrokes, DET.canvasExport)).toBeUndefined();
  expect(technique(afterStrokes, DET.pixelReadback)).toBeUndefined();
  expect(findingsWith(afterStrokes, ['fingerprinting-pattern', 'possible-fingerprinting'])).toEqual([]);
  expect(interpretationsOf(afterStrokes)).toEqual(['api-use']);

  // The user exports the drawing: one toBlob (callback API; settlement is not observed, ADR-006 §4).
  await page.click('#export');
  await page.waitForFunction(() => (window as unknown as { __exportResult?: unknown }).__exportResult !== undefined);
  const exported = await page.evaluate(() => (window as unknown as { __exportResult: ExportResult }).__exportResult);
  expect(exported.type).toBe('image/png');
  expect(exported.size).toBeGreaterThan(0);

  const afterExport = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.canvasExport) >= 1, { describe: 'DET-001 observed after export' });
  expect(techniqueCount(afterExport, DET.canvasExport)).toBe(1);
  expect(technique(afterExport, DET.canvasExport)?.phases).toContain('attempted');
  expect(findingsWith(afterExport, ['fingerprinting-pattern']), 'editor must never yield fingerprinting-pattern: ' + brief(afterExport.findings)).toEqual([]);
  expect(findingsWith(afterExport, ['possible-fingerprinting'])).toEqual([]);
  expect(interpretationsOf(afterExport)).toEqual(['api-use']);
  expect(afterExport.findings.every((f) => f.interpretationConfidence === 'unassessed')).toBe(true);
  // DET-003 also includes measureText: volume cannot establish ordinary rendering (F122).
  expect(afterExport.findings.map((f) => f.counterEvidenceCodes)).toEqual(afterExport.findings.map(() => []));
  const badge = await ext.context.serviceWorkers()[0]!.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  expect(['', '0']).toContain(badge);
  expect(afterExport.documentKey).toBe(afterStrokes.documentKey);
});
