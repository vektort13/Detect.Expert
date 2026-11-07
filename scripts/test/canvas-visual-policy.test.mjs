// ADR-066: canonical visual producer composition, not a hand-copied policy fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { visualCaptureRuntimeSource, syncVisualCapture } from '../production/sync-visual-capture.mjs';
const canonical = resolve(import.meta.dirname, '../../baseline-ts');
const built = await build({ stdin: { contents: `export { installVisualCapture } from './packages/sensors/src/visual'; export { installCanvasSensor } from './packages/sensors/src/canvas'; export { SensorRuntime } from './packages/sensors/src/runtime'; export { makeEnv, deliver } from './packages/sensors/test/helpers';`, resolveDir: canonical }, bundle: true, write: false, format: 'esm', platform: 'node', target: 'node24', logLevel: 'silent', plugins: [{ name: 'canonical-contracts', setup(builder) { builder.onResolve({ filter: /^@detect-expert\/contracts$/ }, () => ({ path: resolve(canonical, 'packages/contracts/src/index.ts') })); } }] });
const { installVisualCapture, installCanvasSensor, SensorRuntime, makeEnv, deliver } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const marker = Symbol.for('detect.expert/api-custom/value-capture-deny/v1'), channel = 'detect.expert/visual/v1';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
function setup(realm = {}, changeEnv) {
  const fake = makeEnv(), env = changeEnv ? changeEnv(fake.env) : fake.env, runtime = new SensorRuntime(env), capture = installVisualCapture(runtime, realm);
  const config = () => deliver(fake, { channel, type: 'visual-config', sensorBootId: runtime.sensorBootId, enabled: true, remainingMs: 60000 });
  const images = () => fake.posted.filter(message => message?.channel === channel && message.type === 'visual-image');
  return { fake, runtime, capture, config, images, realm };
}
const args = (...values) => (function () { return arguments; })(...values);

test('observer-only positive control still publishes bounded passive images', () => {
  const f = setup(); f.config(); f.capture.dataUrl(png); assert.equal(f.images().length, 1); f.runtime.stop('local');
});
test('marker presence suppresses all pixel-producing methods without evaluating false/accessor values', () => {
  for (const accessor of [false, true]) for (const configurable of [false, true]) {
    let gets = 0; const realm = {};
    Object.defineProperty(realm, marker, accessor ? { get() { gets++; throw Error('MARKER_GETTER'); }, configurable } : { value: false, configurable });
    const f = setup(realm); f.config(); f.capture.dataUrl(png);
    const raw = args(0, 0, 1, 1, 6408, 5121, new Uint8Array(4));
    Object.defineProperty(raw, '6', { get() { gets++; throw Error('PIXEL_ARGUMENT'); } });
    f.capture.readPixels({}, raw); f.capture.imageData(new Proxy({}, { get() { gets++; throw Error('RESULT_GETTER'); } }));
    assert.equal(gets, 0); assert.equal(f.images().length, 0); f.runtime.stop('local');
  }
});
test('a late Custom marker drops queued native images before a forged transport lease can drain them', () => {
  const f = setup(); f.capture.dataUrl(png, {}); assert.equal(f.images().length, 0);
  Object.defineProperty(f.realm, marker, { value: false, configurable: true });
  f.config(); assert.equal(f.images().length, 0);
  delete f.realm[marker]; f.runtime.policyDenied = false; f.runtime.visualCaptureDenied = false;
  f.config(); f.capture.dataUrl(png, {}); f.fake.advance(1000); f.config(); assert.equal(f.images().length, 0); f.runtime.stop('local');
});
test('a shared child/sibling realm registration can only latch the existing producer closed', () => {
  const f = setup(), child = {}; Object.defineProperty(child, marker, { value: false });
  assert.equal(installVisualCapture(f.runtime, child), f.capture);
  f.config(); f.capture.dataUrl(png, {}); assert.equal(f.images().length, 0); f.runtime.stop('local');
});
test('every delayed dispatch rechecks the veto, including a marker introduced during a drain', () => {
  const realm = {}; let dispatched = 0;
  const f = setup(realm, env => ({ ...env, postMessage(message) { env.postMessage(message); if (message?.type === 'visual-image' && ++dispatched === 1) Object.defineProperty(realm, marker, { value: true }); } }));
  f.capture.dataUrl(png, {}); f.capture.dataUrl(png, {}); f.config();
  assert.equal(f.images().length, 1, 'first image predates Custom; queued second image is vetoed');
  f.config(); f.fake.advance(1000); assert.equal(f.images().length, 1); f.runtime.stop('local');
});
test('unknown realm descriptors and bounded registry overflow suppress rather than authorize capture', () => {
  const denied = setup(new Proxy({}, { getOwnPropertyDescriptor() { throw Error('INACCESSIBLE_REALM'); } })); denied.config(); denied.capture.dataUrl(png); assert.equal(denied.images().length, 0); denied.runtime.stop('local');
  const full = setup(); full.capture.dataUrl(png, {});
  for (let index = 0; index < 1024; index++) installVisualCapture(full.runtime, {});
  full.config(); assert.equal(full.images().length, 0); full.runtime.stop('local');
});
test('ordinary Canvas observations and native call/result identity survive preview suppression', () => {
  let calls = 0; const image = {};
  class CanvasRenderingContext2D { getImageData() { calls++; return image; } }
  class HTMLCanvasElement { getContext() { return new CanvasRenderingContext2D(); } }
  const realm = { CanvasRenderingContext2D, HTMLCanvasElement }; Object.defineProperty(realm, marker, { value: true });
  const f = setup(realm); installCanvasSensor(f.runtime, realm); f.config();
  const context = new HTMLCanvasElement().getContext('2d'); assert.equal(context.getImageData(0, 0, 1, 1), image); assert.equal(calls, 1);
  assert.ok(f.runtime.snapshot().counters.length > 0); assert.equal(f.images().length, 0); f.runtime.stop('local');
});
test('delivered observer bundles contain the reproducible canonical producer', () => {
  const source = syncVisualCapture({ check: true }); assert.equal(source, visualCaptureRuntimeSource()); assert.ok(source.includes('valueCaptureDenied'));
});
