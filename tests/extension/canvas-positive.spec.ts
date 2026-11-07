// Controlled positive canvas fixture (vertical slice §4, spec V §9 "Canvas/fonts/rects"): text in several fonts,
// then getImageData + toDataURL twice. Expected: DET-003/DET-002/DET-001 observed as page-hook evidence and a
// finding interpreted as possible-fingerprinting or fingerprinting-pattern. Never a site verdict (REQ-007).

import { expect, test } from './harness';
import { DET, brief, fixtureResult, findingsWith, observed, signalCodesOf, technique, techniqueCount, waitForReport } from './helpers';

interface PositiveResult {
  fillTextCalls: number;
  getImageData: Array<{ isImageData: boolean; byteLength: number; hash: string }>;
  toDataURL: Array<{ isString: boolean; prefixOk: boolean; length: number; hash: string }>;
  stableAcrossReads: boolean;
}

test('positive canvas fixture: readback after text is reported as a fingerprinting finding', async ({ ext, fixtures }) => {
  const url = fixtures.origins[0] + '/canvas-fp-positive.html';
  const { ui, page, tabId } = await observed(ext, url);

  // The page itself still gets the original results (REQ-002).
  const result = await fixtureResult<PositiveResult>(page);
  expect(result.getImageData.map((g) => g.isImageData)).toEqual([true, true]);
  expect(result.toDataURL.map((t) => t.isString && t.prefixOk)).toEqual([true, true]);
  // Two consecutive readbacks of one canvas can differ in Chromium itself (re-rasterization after the first
  // readback); the extension-independent equality is proven by differential.spec.ts, so this is only recorded.
  test.info().annotations.push({ type: 'readback-stability', description: 'stableAcrossReads=' + String(result.stableAcrossReads) });

  const report = await waitForReport(
    ui,
    tabId,
    (r) => technique(r, DET.pixelReadback) !== undefined && technique(r, DET.canvasExport) !== undefined,
    { describe: 'DET-001 and DET-002 observed' },
  );
  expect(report.host).toBeNull();
  expect(['active', 'partial', 'late-start']).toContain(report.coverageState);
  expect(techniqueCount(report, DET.text)).toBeGreaterThanOrEqual(result.fillTextCalls);
  expect(techniqueCount(report, DET.pixelReadback)).toBeGreaterThanOrEqual(2);
  expect(techniqueCount(report, DET.canvasExport)).toBeGreaterThanOrEqual(2);

  const readback = technique(report, DET.pixelReadback);
  expect(readback?.evidenceSource).toBe('page-hook');
  expect(readback?.integrity).toBe('page-controlled');
  expect(readback?.phases).toContain('returned-sync');
  expect(signalCodesOf(report, DET.pixelReadback)).toContain('readback-after-text');

  const fingerprinting = findingsWith(report, ['fingerprinting-pattern', 'possible-fingerprinting']);
  expect(fingerprinting.length, 'expected a possible-fingerprinting / fingerprinting-pattern finding; findings: ' + brief(report.findings)).toBeGreaterThan(0);
  for (const f of fingerprinting) {
    expect(f.interpretation).toBe('possible-fingerprinting');
    expect(f.interpretationConfidence).toBe('low');
    expect(f.techniqueId).toMatch(/^DET-00[1-4]$/);
    expect(f.evidenceIds.length).toBeGreaterThan(0);
  }
  test.info().annotations.push({
    type: 'interpretations',
    description: fingerprinting.map((f) => f.ruleId + '@' + f.ruleVersion + ' ' + f.interpretation + '/' + f.interpretationConfidence).join('; '),
  });

  // Vendor recognition never comes from page hooks alone and the stand has no catalog match (REQ-007/008).
  expect(report.vendors).toEqual([]);
});
