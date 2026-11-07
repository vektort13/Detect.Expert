// ADR-064: the production DNR controller in a minimal disposable Chrome extension.
// Actual HTTP and Window/worker WebSocket traffic; no external endpoints or profile data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '../..'), run = mkdtempSync(join(root, '.tmp/antidetect-protocol-native-'));
const extension = join(run, 'extension'), profile = join(run, 'profile'); mkdirSync(extension);
const source = join(root, 'apps/production-extension'), artifacts = join(root, 'test-results/production-1.1.0/antidetect'); mkdirSync(artifacts, { recursive: true });
// ADR-087: api-configuration.js imports the Custom bundle definitions, so the fixture needs them too.
const files = ['antidetect-protocol-controller.js', 'api-configuration.js', 'api-protection-features.js', 'webassembly-apis.js', 'math-functions.js', 'fingerprint-custom-values.js'];
for (const file of files) cpSync(join(source, file), join(extension, file));
const productionManifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));
assert.ok(productionManifest.permissions.includes('declarativeNetRequestWithHostAccess'));
const manifest = { manifest_version: 3, name: 'Owned Antidetect protocol fixture', version: '0.0.1',
  permissions: ['declarativeNetRequestWithHostAccess'], host_permissions: [...productionManifest.host_permissions],
  background: { service_worker: 'fixture-background.js', type: 'module' },
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; connect-src 'none'" } };
writeFileSync(join(extension, 'manifest.json'), JSON.stringify(manifest));
writeFileSync(join(extension, 'fixture-background.js'), 'chrome.runtime.onInstalled.addListener(()=>{});\n');
writeFileSync(join(extension, 'options.html'), '<!doctype html><meta charset="utf-8"><title>Owned protocol fixture</title><script type="module" src="fixture-ui.js"></script>');
writeFileSync(join(extension, 'fixture-ui.js'), `import { AntidetectProtocolController } from './antidetect-protocol-controller.js';
import { createApiConfiguration, updateApiConfiguration } from './api-configuration.js';
const controller = new AntidetectProtocolController(chrome);
globalThis.fixture = {
  async apply({ websocket = 'off', webtransport = 'off', enabled = true, matches = ['http://*/*','https://*/*'], exception = false } = {}) {
    let config = { ...createApiConfiguration(), enabled, preset: 'custom' };
    for (const [id, mode] of [['websocket',websocket],['webtransport',webtransport]]) { const next=updateApiConfiguration(config,id,{mode}); if(!next.ok)throw Error(next.error.code);config=next.value; }
    if(exception){const next=updateApiConfiguration(config,'websocket',{mode:'off'},'exact.fixture.invalid');if(!next.ok)throw Error(next.error.code);config=next.value;}
    return controller.reconcile(config,matches,enabled);
  },
  rules: () => chrome.declarativeNetRequest.getDynamicRules(),
  async seed() { await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [
    { id:100000,priority:20,action:{type:'allow'},condition:{resourceTypes:['image']} },
    { id:300002,priority:1,action:{type:'block'},condition:{resourceTypes:['font']} }
  ] }); },
};
`);

function socketProbe(url) {
  return new Promise(resolve => {
    let settled = false, socket;
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); try { socket?.close(); } catch {} resolve(value); };
    const timer = setTimeout(() => finish({ open: false, echo: false, result: 'timeout' }), 2500);
    try {
      socket = new WebSocket(url); socket.onopen = () => socket.send('owned-ping');
      socket.onmessage = event => finish({ open: true, echo: event.data === 'owned-pong', result: 'message' });
      socket.onerror = () => finish({ open: false, echo: false, result: 'error' });
    } catch { finish({ open: false, echo: false, result: 'exception' }); }
  });
}
const counts = { upgrades: 0, messages: 0, http: 0 }, sockets = new Set();
const server = createServer((request, response) => {
  request.resume(); response.setHeader('Cache-Control', 'no-store');
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  if (path === '/http') { counts.http++; response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end('owned-http-ok'); return; }
  if (path === '/worker.js') { response.setHeader('Content-Type', 'application/javascript'); response.end('const probe=' + socketProbe.toString() + ';onmessage=async event=>postMessage(await probe(event.data));'); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><title>Owned Antidetect protocol page</title><script>globalThis.socketProbe=' + socketProbe.toString() + '</script><body>Owned fixture');
});
server.on('upgrade', (request, socket) => {
  if (request.headers.upgrade?.toLowerCase() !== 'websocket' || typeof request.headers['sec-websocket-key'] !== 'string') { socket.destroy(); return; }
  counts.upgrades++; sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
  const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  let pending = Buffer.alloc(0);
  socket.on('data', data => {
    pending = Buffer.concat([pending, data]); if (pending.length > 4096) { socket.destroy(); return; }
    while (pending.length >= 2) {
      const length = pending[1] & 127, masked = Boolean(pending[1] & 128), offset = masked ? 6 : 2;
      if (length >= 126) { socket.destroy(); return; }
      if (pending.length < offset + length) return;
      const frame = pending.subarray(0, offset + length); pending = pending.subarray(offset + length);
      const opcode = frame[0] & 15; if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
      const payload = Buffer.from(frame.subarray(offset)); if (masked) for (let index = 0; index < payload.length; index++) payload[index] ^= frame[2 + index % 4];
      if (opcode === 1 && payload.toString('utf8') === 'owned-ping') { counts.messages++; const answer = Buffer.from('owned-pong'); socket.write(Buffer.concat([Buffer.from([0x81, answer.length]), answer])); }
    }
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = 'http://127.0.0.1:' + server.address().port;
const evidence = { at: new Date().toISOString(), run, result: 'RUNNING', checks: [], stages: [], hashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])),
  fixture: { productionController: true, productionDnrPermission: 'required', disposableMinimalExtension: true, externalEndpoints: false },
  limits: ['WebTransport evidence proves native Chrome acceptance/readback of its narrow resource type; no HTTP/3 server or actual WebTransport connection is claimed.', 'Full production UI/early-hook integration is exercised by separate fixtures.'] };
let context, ui, page, phase = 'startup';
const check = message => { evidence.checks.push(message); console.log('  ok ' + message); };
const apply = value => ui.evaluate(value => fixture.apply(value), value);
const native = () => ui.evaluate(() => fixture.rules());
async function traffic(blocked) {
  await page.goto(origin + '/page?stage=' + evidence.stages.length);
  const before = { ...counts };
  const result = await page.evaluate(async origin => {
    const http = await fetch(origin + '/http').then(async response => ({ status: response.status, body: await response.text() }));
    const main = await socketProbe(origin.replace('http:', 'ws:') + '/window');
    const worker = new Worker(origin + '/worker.js');
    try {
      const work = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('owned worker timed out')), 4000); worker.onmessage = event => { clearTimeout(timer); resolve(event.data); }; worker.onerror = () => { clearTimeout(timer); reject(Error('owned worker failed')); }; worker.postMessage(origin.replace('http:', 'ws:') + '/worker'); });
      return { http, main, worker: work, webTransportPresent: typeof WebTransport === 'function' };
    } finally { worker.terminate(); }
  }, origin);
  assert.deepEqual(result.http, { status: 200, body: 'owned-http-ok' }); assert.equal(result.main.echo, !blocked); assert.equal(result.worker.echo, !blocked);
  assert.equal(counts.upgrades - before.upgrades, blocked ? 0 : 2); assert.equal(counts.messages - before.messages, blocked ? 0 : 2);
  assert.equal(counts.http - before.http, 1);
  evidence.stages.push({ phase, blocked, ...result, delta: { upgrades: counts.upgrades - before.upgrades, messages: counts.messages - before.messages, http: counts.http - before.http } });
}
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension] });
  evidence.browser = context.browser().version();
  await context.route('**/*', route => { const url = new URL(route.request().url()); return ['http:', 'https:'].includes(url.protocol) && url.origin !== origin ? route.abort() : route.continue(); });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); const base = new URL('.', worker.url()).href;
  ui = await context.newPage(); await ui.goto(base + 'options.html'); await ui.waitForFunction(() => Boolean(globalThis.fixture));
  page = await context.newPage(); await ui.evaluate(() => fixture.seed()); const foreign = await native(); assert.deepEqual(foreign.map(rule => rule.id).sort(), [100000, 300002]);
  phase = 'native baseline'; assert.equal((await apply({})).status, 'inactive'); await traffic(false); check('baseline Window and worker exchange actual WebSocket messages and ordinary HTTP returns 200');
  phase = 'WebSocket block'; assert.equal((await apply({ websocket: 'on' })).status, 'applied'); await traffic(true);
  assert.deepEqual((await native()).find(rule => rule.id === 300000).condition.resourceTypes, ['websocket']);
  check('the production controller blocks Window and worker WebSocket handshakes before any upgrade while HTTP remains successful');
  phase = 'WebTransport only'; assert.equal((await apply({ webtransport: 'on' })).status, 'applied'); await traffic(false);
  assert.deepEqual((await native()).find(rule => rule.id === 300001).condition.resourceTypes, ['webtransport']);
  check('Chrome accepts and reads back the separate WebTransport resource type while Window/worker WebSocket and HTTP remain unaffected');
  phase = 'both protocols'; assert.equal((await apply({ websocket: 'on', webtransport: 'on' })).status, 'applied'); await traffic(true);
  check('both narrow native rules coexist without adding any HTTP resource type');
  phase = 'exact-host exception'; assert.equal((await apply({ websocket: 'on', webtransport: 'on', exception: true })).status, 'unsupported'); await traffic(false);
  assert.deepEqual((await native()).filter(rule => [300000, 300001].includes(rule.id)).map(rule => rule.id), [300001]);
  check('an unrepresentable exact-host WebSocket exception removes only that native rule and retains the independent WebTransport rule');
  phase = 'master off'; assert.equal((await apply({ websocket: 'on', webtransport: 'on', enabled: false })).status, 'inactive'); await traffic(false);
  assert.deepEqual(await native(), foreign);
  check('master OFF removes exactly the two owned IDs, restores actual worker/Window WebSocket and preserves Firewall-range and adjacent foreign rules');
  phase = 'scope fallback'; assert.equal((await apply({ websocket: 'on', matches: ['http://127.0.0.1/*', 'https://127.0.0.1/*'] })).status, 'unsupported'); await traffic(false); assert.deepEqual(await native(), foreign);
  check('site-only scope never broadens into a browser-wide protocol rule'); evidence.result = 'PASS';
} catch (error) { evidence.result = 'FAIL'; evidence.failure = { phase, message: String(error.stack ?? error).replace(/https?:\/\/\S+/g, '[owned URL]').slice(0, 1500) }; console.error(evidence.failure); process.exitCode = 1; }
finally {
  await context?.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));
  const path = join(artifacts, 'protocol-native-chrome.json'); writeFileSync(path, JSON.stringify(evidence, null, 2) + '\n'); console.log(evidence.result + ': ' + path);
}
