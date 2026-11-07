// Differential run (ADR-006 acceptance, spec A11 gate 5): the same fixtures in a context WITHOUT the extension
// and in one WITH it must produce identical page-visible facts — exception type + message, return types,
// object identity, brand checks, `new` behaviour — and the same canvas bytes (hash). Descriptor facts
// (name/length/writable/configurable) are compared separately: copying them is a compatibility measure (ADR-006 §5).

import { expect, launch, test } from './harness';
import { fixtureResult, observed } from './helpers';

interface ThrowsResult {
  cases: Record<string, unknown>;
  descriptors: Record<string, { name: string; length: number; writable: boolean; configurable: boolean; enumerable: boolean }>;
}

interface TaintedResult {
  imageLoaded: boolean;
  getImageData: unknown;
  toDataURL: unknown;
  toBlob: unknown;
}

interface PositiveResult {
  getImageData: Array<{ hash: string; byteLength: number }>;
  toDataURL: Array<{ hash: string; length: number }>;
}

test('original exceptions and return facts are identical with and without the extension', async ({ ext, fixtures }) => {
  const origin = fixtures.origins[0];
  const plain = await launch({ extension: false });
  try {
    const plainPage = await plain.context.newPage();
    await plainPage.goto(origin + '/canvas-original-throws.html');
    const without = await fixtureResult<ThrowsResult>(plainPage);
    // Sanity: the baseline itself behaves as expected in this Chromium build.
    expect(without.cases['zeroSize']).toMatchObject({ threw: true, error: { name: 'IndexSizeError', isDOMException: true } });
    expect(without.cases['missingArgs']).toMatchObject({ threw: true, error: { isTypeError: true } });
    expect(without.cases['wrongReceiver']).toMatchObject({ threw: true, error: { isTypeError: true } });
    expect(without.cases['constructNotAllowed']).toMatchObject({ threw: true, error: { isTypeError: true } });
    expect(without.cases['getImageDataInstance']).toMatchObject({ threw: false, value: { isImageData: true, byteLength: 16, ctorName: 'ImageData' } });
    expect(without.cases['contextIdentity']).toEqual({ threw: false, value: true });

    const { page } = await observed(ext, origin + '/canvas-original-throws.html');
    const withExt = await fixtureResult<ThrowsResult>(page);
    expect(withExt.cases).toEqual(without.cases);
    // Compatibility measure (allowed, not required by REQ-003): soft so a difference is reported, not hidden.
    expect.soft(withExt.descriptors, 'name/length/descriptor flags differ from native (ADR-006 §5 compatibility copy)').toEqual(without.descriptors);
  } finally {
    await plain.close();
  }
});

test('tainted-canvas errors are identical with and without the extension', async ({ ext, fixtures }) => {
  const origin = fixtures.origins[0];
  const plain = await launch({ extension: false });
  try {
    const plainPage = await plain.context.newPage();
    await plainPage.goto(origin + '/canvas-tainted.html');
    const without = await fixtureResult<TaintedResult>(plainPage);
    expect(without.imageLoaded).toBe(true);
    const { page } = await observed(ext, origin + '/canvas-tainted.html');
    const withExt = await fixtureResult<TaintedResult>(page);
    expect(withExt.getImageData).toEqual(without.getImageData);
    expect(withExt.toDataURL).toEqual(without.toDataURL);
    expect(withExt.toBlob).toEqual(without.toBlob);
  } finally {
    await plain.close();
  }
});

test('canvas readback bytes are identical with and without the extension (no result tampering)', async ({ ext, fixtures }) => {
  const origin = fixtures.origins[0];
  const plain = await launch({ extension: false });
  try {
    const plainPage = await plain.context.newPage();
    await plainPage.goto(origin + '/canvas-fp-positive.html');
    const without = await fixtureResult<PositiveResult>(plainPage);
    const { page } = await observed(ext, origin + '/canvas-fp-positive.html');
    const withExt = await fixtureResult<PositiveResult>(page);
    expect(withExt.getImageData.map((g) => g.hash)).toEqual(without.getImageData.map((g) => g.hash));
    expect(withExt.toDataURL.map((t) => t.hash)).toEqual(without.toDataURL.map((t) => t.hash));
  } finally {
    await plain.close();
  }
});
