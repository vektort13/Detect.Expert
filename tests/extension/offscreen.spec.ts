// P04 / ADR-006: page-visible differential facts and explicit worker coverage.
import { expect, launch, test } from './harness';
import { DET, fixtureResult, getReport, observed, phasesOf, signalCodesOf, techniqueCount, waitForReport } from './helpers';

interface OffscreenResult {
  samePromise: boolean;
  isPromise: boolean;
  ownNames: string[];
  chain: string[][];
  expectedChain: string[][];
  thenCalls: number;
  catchCalls: number;
  sameChainAfterAwait: boolean;
  pixels: { hash: string; length: number };
  blob: { isBlob: boolean; type: string; size: number; hash: string };
}

test('Window OffscreenCanvas preserves Promise/results; worker readbacks stay unobserved with visible coverage', async ({ ext, fixtures }) => {
  const plain = await launch({ extension: false });
  try {
    const url = fixtures.origins[0] + '/offscreen.html';
    const plainPage = await plain.context.newPage();
    await plainPage.goto(url);
    const without = await fixtureResult<OffscreenResult>(plainPage);
    const { page, ui, tabId } = await observed(ext, url);
    const withExt = await fixtureResult<OffscreenResult>(page);
    expect(withExt).toEqual(without);
    expect(withExt).toMatchObject({ samePromise: true, isPromise: true, ownNames: [], thenCalls: 0, catchCalls: 0, sameChainAfterAwait: true });
    expect(withExt.chain).toEqual(withExt.expectedChain);
    expect(withExt.pixels.length).toBe(96 * 32 * 4);
    expect(withExt.blob).toMatchObject({ isBlob: true, type: 'image/png' });
    expect(withExt.blob.size).toBeGreaterThan(0);
    const before = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.offscreen) === 2);
    expect(phasesOf(before, DET.offscreen).sort()).toEqual(['returned-sync', 'settlement-unobserved']);
    expect(signalCodesOf(before, DET.offscreen)).toContain('readback-after-text');
    expect(signalCodesOf(before, DET.text).sort()).toEqual(['api-use', 'text-drawn', 'text-measured']);
    expect(before.coverageFlags).not.toContain('worker-not-observed');
    const runWorker = () => (window as unknown as { __runWorker: () => Promise<{ readbacks: number; hashes: number[] }> }).__runWorker();
    const workerWithout = await plainPage.evaluate(runWorker);
    const workerWith = await page.evaluate(runWorker);
    expect(workerWith).toEqual(workerWithout);
    expect(workerWith.readbacks).toBe(7);
    // A later Window observation is a delivery barrier after all worker calls have finished.
    await page.evaluate(() => new OffscreenCanvas(1, 1).getContext('2d')!.measureText('P04-barrier-private-canary'));
    const after = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.text) === 3 && r.coverageFlags.includes('worker-not-observed'));
    expect(techniqueCount(after, DET.offscreen)).toBe(2);
    expect(after.coverageState).toBe('partial');
    expect(JSON.stringify(after)).not.toMatch(/P04-.*canary/);
    await ui.goto(ui.url().split('?')[0] + '?tabId=' + String(tabId));
    const coverageText = await ui.evaluate(() => chrome.i18n.getMessage('coverage_flag_worker_not_observed'));
    expect(coverageText.length).toBeGreaterThan(0);
    await expect(ui.getByText(coverageText, { exact: true }).first()).toBeVisible();
    expect(techniqueCount((await getReport(ui, tabId))!, DET.offscreen)).toBe(2);
    test.info().annotations.push({ type: 'browser', description: ext.context.browser()?.version() ?? 'unknown' });
  } finally { await plain.close(); }
});

test('rejected convertToBlob still reaches unhandledrejection with the original Promise', async ({ ext, fixtures }) => {
  const plain = await launch({ extension: false });
  try {
    const url = fixtures.origins[0] + '/index.html';
    const plainPage = await plain.context.newPage();
    await plainPage.goto(url);
    const { page, ui, tabId } = await observed(ext, url);
    const rejected = () => new Promise<{ samePromise: boolean; name: string; ownNames: string[] }>((resolve) => {
      let original: Promise<Blob>;
      window.addEventListener('unhandledrejection', (event) => {
        event.preventDefault();
        resolve({ samePromise: event.promise === original, name: (event.reason as DOMException).name, ownNames: Object.getOwnPropertyNames(original) });
      }, { once: true });
      const canvas = new OffscreenCanvas(0, 0);
      canvas.getContext('2d');
      original = canvas.convertToBlob();
    });
    const without = await plainPage.evaluate(rejected);
    const withExt = await page.evaluate(rejected);
    expect(withExt).toEqual(without);
    expect(withExt).toEqual({ samePromise: true, name: 'IndexSizeError', ownNames: [] });
    const report = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.offscreen) === 1);
    expect(phasesOf(report, DET.offscreen)).toEqual(['settlement-unobserved']);
    expect(report.findings.every((f) => f.interpretation === 'api-use')).toBe(true);
  } finally { await plain.close(); }
});

for (const offscreen of [false, true]) {
  for (const reset of ['width', 'height', 'clearRect', 'reset'] as const) {
    test((offscreen ? 'OffscreenCanvas' : 'HTMLCanvasElement') + ': ' + reset + ' disarms text association', async ({ ext, fixtures }) => {
      const { page, ui, tabId } = await observed(ext, fixtures.origins[0] + '/index.html');
      const facts = await page.evaluate(({ offscreen, reset }) => {
        const canvas = offscreen ? new OffscreenCanvas(32, 32) : document.createElement('canvas');
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
        ctx.fillText('P04-reset-private-canary', 0, 10);
        if (reset === 'width' || reset === 'height') canvas[reset] = canvas[reset];
        else if (reset === 'clearRect') ctx.clearRect(0, 0, canvas.width, canvas.height);
        else ctx.reset();
        const data = ctx.getImageData(0, 0, 1, 1).data;
        return { transparent: data.every((n) => n === 0) };
      }, { offscreen, reset });
      expect(facts.transparent).toBe(true);
      const id = offscreen ? DET.offscreen : DET.pixelReadback;
      const report = await waitForReport(ui, tabId, (r) => techniqueCount(r, id) === 1);
      expect(signalCodesOf(report, id)).toEqual(['api-use']);
      expect(signalCodesOf(report, DET.text)).toContain('text-drawn');
    });
  }
}
