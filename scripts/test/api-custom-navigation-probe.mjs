// Isolated userScripts experiment for first-inline srcdoc and synchronous parser-created realms.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createApiConfiguration, updateApiConfiguration } from '../../packages/contracts/src/api-configuration.mjs';
import { buildApiCustomScripts } from '../../apps/production-extension/api-custom-registration.js';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';

const root = resolve(import.meta.dirname, '../..'), temporary = join(root, '.tmp'); mkdirSync(temporary, { recursive: true });
const run = mkdtempSync(join(temporary, 'api-custom-navigation-')), extension = join(run, 'extension'); mkdirSync(extension);
writeFileSync(join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Owned Custom navigation probe', version: '1.0', permissions: ['scripting', 'userScripts'], host_permissions: ['http://127.0.0.1/*'], background: { service_worker: 'background.js' } }));
writeFileSync(join(extension, 'background.js'), 'chrome.runtime.onInstalled.addListener(()=>{});');
writeFileSync(join(extension, 'control.html'), '<!doctype html><title>Owned userScripts control</title>');
writeFileSync(join(extension, 'inherit.js'), readFileSync(join(root, 'apps/production-extension/api-custom-inherit.main.js')));
writeFileSync(join(extension, 'opaque-cpu.js'), readFileSync(join(root, 'apps/production-extension/api-custom-opaque.hardware-concurrency.js')));
const server = createServer((_req, response) => { response.writeHead(200, { 'content-type': 'text/html', 'Cache-Control': 'no-store' }); response.end('<!doctype html><script>window.probeSamples=[{label:"top-first-inline",cpu:navigator.hardwareConcurrency}];</script><body>owned fixture</body>'); });
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port, evidence = { run, samples: [] }; let context;
try {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true, args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
  evidence.browser = context.browser().version();
  let control = await context.newPage(); await control.goto('chrome-extension://' + id + '/control.html');
  control = await enableChromeUserScripts(context, control, id, evidence);
  let config = createApiConfiguration(); config.enabled = true; config.antidetectEnabled = true;
  config = updateApiConfiguration(config, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 257 } }).value;
  const profiles = buildApiCustomScripts(config, ['http://127.0.0.1/*']);
  await control.evaluate(async profiles => { await chrome.userScripts.register(profiles); }, profiles);
  await control.evaluate(async () => { await chrome.scripting.registerContentScripts([{ id: 'owned-custom-inherit', js: ['inherit.js', 'opaque-cpu.js'], matches: ['http://127.0.0.1/*'], world: 'MAIN', runAt: 'document_start', allFrames: true, persistAcrossSessions: true, matchOriginAsFallback: true }]); });
  const fixture = await context.newPage(); await fixture.goto(origin);
  evidence.samples = await fixture.evaluate(async () => {
    addEventListener('message', event => { if (event.data?.channel === 'owned-navigation-probe') window.probeSamples.push(event.data.sample); });
    const childSource = label => '<script>parent.probeSamples.push({label:' + JSON.stringify(label) + ',cpu:navigator.hardwareConcurrency});</script>';
    const waitLoad = frame => new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
    const frame = document.createElement('iframe'); frame.srcdoc = childSource('srcdoc-initial-first-inline');
    const first = waitLoad(frame); document.body.appendChild(frame); await first;
    const second = waitLoad(frame); frame.srcdoc = childSource('srcdoc-renavigation-first-inline'); await second;
    const opaque = document.createElement('iframe'); opaque.setAttribute('sandbox', 'allow-scripts');
    opaque.srcdoc = '<script>parent.postMessage({channel:"owned-navigation-probe",sample:{label:"sandbox-srcdoc-first-inline",cpu:navigator.hardwareConcurrency}},"*");</script>';
    const opaqueLoad = waitLoad(opaque); document.body.appendChild(opaque); await opaqueLoad;
    const third = waitLoad(frame); frame.removeAttribute('srcdoc'); frame.src = 'about:blank'; await third;
    const doc = frame.contentDocument; doc.open();
    doc.write('<!doctype html><body><iframe></iframe><script>parent.probeSamples.push({label:"nested-document-write-first-inline",cpu:window.frames[0].navigator.hardwareConcurrency});parent.probeSamples.push({label:"nested-document-write-borrowed-getter",cpu:Object.getOwnPropertyDescriptor(window.frames[0].Navigator.prototype,"hardwareConcurrency").get.call(parent.navigator)});</script>'); doc.close();
    await new Promise(resolve => setTimeout(resolve, 100));
    return window.probeSamples;
  });
  evidence.leaks = evidence.samples.filter(sample => sample.cpu !== (sample.label === 'sandbox-srcdoc-first-inline' ? 0 : 257));
  evidence.withheld = evidence.samples.filter(sample => sample.label === 'sandbox-srcdoc-first-inline' && sample.cpu === 0);
  if (evidence.samples.length !== 6 || evidence.leaks.length || evidence.withheld.length !== 1) throw new Error('Document-start Custom or opaque withholding mismatch.');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  writeFileSync(join(run, 'evidence.json'), JSON.stringify(evidence, null, 2));
  if (context) await context.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
  console.log('Navigation probe evidence: ' + join(run, 'evidence.json'));
}
