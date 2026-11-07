// Isolated native experiment: can ordered, repeated packaged files convey data at document_start?
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '../..'), temporary = join(root, '.tmp');
mkdirSync(temporary, { recursive: true });
const run = mkdtempSync(join(temporary, 'api-bootstrap-probe-')), extension = join(run, 'extension'); mkdirSync(extension);
const manifest = { manifest_version: 3, name: 'Owned synchronous API bootstrap probe', version: '1.0', permissions: ['scripting'], host_permissions: ['http://127.0.0.1/*'], background: { service_worker: 'background.js' } };
writeFileSync(join(extension, 'manifest.json'), JSON.stringify(manifest));
writeFileSync(join(extension, 'background.js'), 'chrome.runtime.onInstalled.addListener(()=>{});');
writeFileSync(join(extension, 'control.html'), '<!doctype html><title>Bootstrap control</title>');
writeFileSync(join(extension, 'init.js'), 'globalThis.bootstrapStartedAt=performance.now();globalThis[Symbol.for("owned-bootstrap-probe")]=[];');
for (const nibble of '0123456789abcdef') writeFileSync(join(extension, 'token-' + nibble + '.js'), 'globalThis[Symbol.for("owned-bootstrap-probe")].push("' + nibble + '");');
writeFileSync(join(extension, 'finish.js'), `(() => { const key=Symbol.for('owned-bootstrap-probe'), hex=globalThis[key].join('');delete globalThis[key];globalThis.bootstrapProbeHex=hex;const bytes=new Uint8Array(hex.length/2);for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(hex.slice(i*2,i*2+2),16);const config=JSON.parse(new TextDecoder().decode(bytes));const value=config.value;Object.defineProperty(Navigator.prototype,'hardwareConcurrency',{configurable:true,get(){return value;}});globalThis.bootstrapFinishedAt=performance.now();})();`);
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html', 'Cache-Control': 'no-store' });
  response.end('<!doctype html><script>window.firstInline={cpu:navigator.hardwareConcurrency,temporaryPresent:Object.hasOwn(globalThis,Symbol.for("owned-bootstrap-probe")),at:performance.now(),start:window.bootstrapStartedAt??null,finish:window.bootstrapFinishedAt??null,hex:window.bootstrapProbeHex};</script><title>Owned first inline fixture</title>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
const evidence = { browser: null, samples: [], errors: [] };
let context;
try {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true, args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
  evidence.browser = context.browser().version();
  const control = await context.newPage(); await control.goto('chrome-extension://' + id + '/control.html');
  for (const payloadBytes of [128, 512, 2048]) {
    const payload = JSON.stringify({ value: 257, padding: 'x'.repeat(Math.max(0, payloadBytes - 26)) }), hex = Buffer.from(payload).toString('hex');
    const files = ['init.js', ...hex.split('').map((nibble, index) => {
      const file = 'token-' + index + '-' + nibble + '.js';
      writeFileSync(join(extension, file), 'globalThis[Symbol.for("owned-bootstrap-probe")].push("' + nibble + '");');
      return file;
    }), 'finish.js'];
    const registeredAt = performance.now();
    const registration = await control.evaluate(async ({ files, origin }) => {
      try { await chrome.scripting.unregisterContentScripts(); await chrome.scripting.registerContentScripts([{ id: 'owned-bootstrap', matches: [origin + '/*'], js: files, runAt: 'document_start', world: 'MAIN', allFrames: true, persistAcrossSessions: true }]); return { ok: true, count: (await chrome.scripting.getRegisteredContentScripts())[0].js.length }; }
      catch (error) { return { ok: false, error: String(error) }; }
    }, { files, origin });
    const sample = { payloadBytes: Buffer.byteLength(payload), fileReferences: files.length, registrationMs: performance.now() - registeredAt, registration };
    if (!registration.ok) { evidence.samples.push(sample); console.log(JSON.stringify(sample)); continue; }
    const fixture = await context.newPage(); fixture.on('pageerror', error => evidence.errors.push(error.message));
    const navigationAt = performance.now(); await fixture.goto(origin + '/?bytes=' + payloadBytes);
    sample.navigationMs = performance.now() - navigationAt; sample.firstInline = await fixture.evaluate(() => window.firstInline);
    evidence.samples.push(sample); console.log(JSON.stringify({ ...sample, firstInline: { ...sample.firstInline, hex: undefined, executionMs: sample.firstInline.finish - sample.firstInline.start } }));
    assert.equal(sample.firstInline.cpu, 257); assert.equal(sample.firstInline.temporaryPresent, false); assert.ok(sample.firstInline.finish <= sample.firstInline.at);
    await fixture.close();
  }
  assert.deepEqual(evidence.errors, []);
} finally {
  writeFileSync(join(run, 'evidence.json'), JSON.stringify(evidence, null, 2));
  if (context) await context.close(); await new Promise(done => server.close(done));
  console.log('Bootstrap probe evidence: ' + join(run, 'evidence.json'));
}
