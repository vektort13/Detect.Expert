// ADR-105: the production extension (real Custom early registration + real DNR header rules) against local echo servers.
// Everything the servers see is compared with what the page itself reports. No external endpoints.
// HTTPS uses an ephemeral local certificate trusted through its SPKI hash (not --ignore-certificate-errors): Chrome then treats the
// connection as valid and honours Accept-CH over https, which is what the client-hint removal checks need.
// Default: assemble the extension from apps/production-extension (never stale). `--dist` tests the packaged dist/chrome instead.
// `--installed-chrome` runs the real branded Chrome (headed, off-screen, isolated profile) instead of Playwright Chromium.
// X-Client-Data (ADR-105 amendment): Chrome sends it only to Google hosts over https and only with variation ids, so the browser gets two through its own
// --force-variation-ids switch and the Google host name is mapped to the local https server with its port; Chrome and Chromium then send it, which the baseline proves.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createSecureServer } from 'node:http2';
import { createHash, X509Certificate } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { productionManifest } from '../build-production.mjs';
import { enableChromeUserScripts, installPersistentChromeExtension } from './api-custom-early-native.mjs';
import { updateApiConfiguration } from '../../apps/production-extension/api-configuration.js';

const root = resolve(import.meta.dirname, '../..'), temporary = join(root, '.tmp');
mkdirSync(temporary, { recursive: true });
const run = mkdtempSync(join(temporary, 'antidetect-headers-native-')), extension = join(run, 'extension');
const artifacts = join(root, 'test-results/production-2.0.0/antidetect'); mkdirSync(artifacts, { recursive: true });
const useDist = process.argv.includes('--dist'), installed = process.argv.includes('--installed-chrome');
if (useDist) cpSync(join(root, 'dist/chrome'), extension, { recursive: true });
else {
  const source = join(root, 'apps/production-extension'); mkdirSync(extension);
  for (const entry of readdirSync(source)) if (!['manifest.json', 'browser-adapter.js', 'PROVENANCE.json'].includes(entry) && !entry.endsWith('.md')) cpSync(join(source, entry), join(extension, entry), { recursive: true });
  writeFileSync(join(extension, 'manifest.json'), JSON.stringify(productionManifest('chrome', JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version), null, 2));
}
// Deliberate-breakage check: HEADERS_NATIVE_MUTATION='{"file":...,"from":...,"to":...}' edits the assembled temporary copy only, never the project sources.
if (process.env.HEADERS_NATIVE_MUTATION) {
  const { file, from, to } = JSON.parse(process.env.HEADERS_NATIVE_MUTATION), target = join(extension, file), text = readFileSync(target, 'utf8');
  assert.equal(text.split(from).length - 1, 1, 'mutation anchor must occur exactly once'); writeFileSync(target, text.replace(from, () => to));
}
const ID_RANGE = [300100, 300119];
// X-Client-Data (ADR-105 amendment). Chrome appends its field-trial ids only to Google-owned hosts, only over https, and only when the profile has variation
// ids; a fresh profile has none, so Chrome's own switch assigns two (measured: Chrome 156 and Chromium 153 then send it, Edge 156 does not). The Google host name
// is mapped to the local https server WITH its port, so the request URL keeps the standard port Chrome requires for a Google domain.
const VARIATION_IDS = '3300118,3300132';
const XCD_TYPES = ['main_frame', 'sub_frame', 'fetch', 'xhr', 'script', 'image', 'worker-script', 'worker-fetch'];

// ---- measured client-hint names (Chromium 153.0.8010.12 and Chrome 156.0.8078.80, https and loopback http, after Accept-CH) ----------
// Accept-CH tokens are sent in their canonical spelling; detection compares lowercase wire names.
const HIGH_ASKED = ['Sec-CH-UA-Arch', 'Sec-CH-UA-Bitness', 'Sec-CH-UA-Full-Version', 'Sec-CH-UA-Full-Version-List', 'Sec-CH-UA-Model', 'Sec-CH-UA-Platform-Version', 'Sec-CH-UA-WoW64', 'Sec-CH-UA-Form-Factors'];
const FULL_ASKED = [...HIGH_ASKED, 'Device-Memory', 'Sec-CH-Device-Memory', 'DPR', 'Sec-CH-DPR', 'Viewport-Width', 'Sec-CH-Viewport-Width', 'Viewport-Height', 'Sec-CH-Viewport-Height', 'Width', 'Sec-CH-Width', 'ECT', 'RTT', 'Downlink', 'Save-Data', 'Sec-CH-Save-Data',
  'Sec-CH-Prefers-Color-Scheme', 'Sec-CH-Prefers-Reduced-Motion', 'Sec-CH-Prefers-Reduced-Transparency', 'Sec-CH-Prefers-Contrast', 'Sec-CH-Prefers-Reduced-Data', 'Sec-CH-Forced-Colors'];
const HIGH = HIGH_ASKED.map(name => name.toLowerCase());
const OTHER = {
  'device-memory': ['device-memory', 'sec-ch-device-memory'],
  'window-device-pixel-ratio': ['dpr', 'sec-ch-dpr'],
  'screen-geometry': ['viewport-width', 'sec-ch-viewport-width', 'sec-ch-viewport-height'],
  'network-information': ['ect', 'rtt', 'downlink'],
  'css-media': ['sec-ch-prefers-color-scheme', 'sec-ch-prefers-reduced-motion', 'sec-ch-prefers-reduced-transparency'],
};
const OTHER_ALL = Object.values(OTHER).flat();
const UNMAPPED = ['width', 'sec-ch-width']; // sent for <img sizes>; no matching Custom row, so they stay native
const NEVER = ['viewport-height', 'save-data', 'sec-ch-save-data', 'sec-ch-prefers-contrast', 'sec-ch-prefers-reduced-data', 'sec-ch-forced-colors']; // never sent in any tried configuration
const FULL_REQUEST = [...HIGH, ...OTHER_ALL, ...UNMAPPED, ...NEVER];
assert.deepEqual([...FULL_ASKED.map(name => name.toLowerCase())].sort(), [...FULL_REQUEST].sort(), 'the asked and the detected name lists must agree');
const EXTRA = { 'device-memory': 0.5, 'window-device-pixel-ratio': 2.5, 'screen-geometry': { innerWidth: 1234, innerHeight: 777 },
  'network-information': { downlink: 10, effectiveType: '4g', rtt: 100, saveData: false }, 'css-media': { colorScheme: 'dark', reducedMotion: 'reduce' } };

// ---- local servers -------------------------------------------------------------------------------------------------
const PAGE = `<!doctype html><meta charset=utf-8><title>headers</title><script>
const wait = ms => new Promise(r => setTimeout(r, ms));
window.probe = async tag => {
  const q = type => '/echo?tag=' + tag + '&type=' + type, data = navigator.userAgentData, connection = navigator.connection;
  const page = { ua: navigator.userAgent, languages: [...navigator.languages], brands: data ? data.brands.map(b => ({ brand: b.brand, version: b.version })) : null, mobile: data ? data.mobile : null, platform: data ? data.platform : null,
    extra: { deviceMemory: navigator.deviceMemory, dpr: window.devicePixelRatio, innerWidth: window.innerWidth, rtt: connection ? connection.rtt : null, dark: matchMedia('(prefers-color-scheme: dark)').matches } };
  await fetch(q('fetch')).then(r => r.text());
  await new Promise(done => { const x = new XMLHttpRequest(); x.open('GET', q('xhr')); x.onloadend = done; x.send(); });
  await new Promise(done => { const s = document.createElement('script'); s.src = '/s.js?tag=' + tag + '&type=script'; s.onload = s.onerror = done; document.head.append(s); });
  await new Promise(done => { const i = new Image(); i.onload = i.onerror = done; i.src = '/i.png?tag=' + tag + '&type=image&r=' + Math.random(); });
  await new Promise(done => { const i = document.createElement('img'); i.sizes = '100px'; i.srcset = '/i.png?tag=' + tag + '&type=img-sizes 100w'; i.onload = i.onerror = done; document.body.append(i); });
  await new Promise(done => { const f = document.createElement('iframe'); f.src = '/frame?tag=' + tag + '&type=sub_frame'; f.onload = done; document.body.append(f); });
  await new Promise(done => { try { const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?tag=' + tag + '&type=websocket'); ws.onopen = () => ws.send('x'); ws.onmessage = ws.onerror = () => { try { ws.close(); } catch {} done(); }; ws.onclose = done; setTimeout(done, 2000); } catch { done(); } });
  const worker = await new Promise(done => { const w = new Worker('/worker.js?tag=' + tag + '&type=worker-script'); w.onmessage = e => { w.terminate(); done(e.data); }; w.onerror = () => done(null); setTimeout(() => done(null), 3000); });
  await wait(250);
  return { page, worker };
};</script><body>probe`;
const WORKER = tag => `(async () => { await fetch('/echo?type=worker-fetch&tag=${tag}').then(r => r.text()).catch(() => {}); postMessage({ ua: navigator.userAgent, languages: [...navigator.languages] }); })();`;
const log = [], sockets = new Set();
function handler(scheme) {
  return (request, response) => {
    const url = new URL(request.url, scheme + '://x'), tag = url.searchParams.get('tag') ?? 'none';
    log.push({ scheme, version: request.httpVersion, path: url.pathname, tag, type: url.searchParams.get('type') ?? (url.pathname === '/page' ? 'main_frame' : url.pathname), rawHeaders: [...request.rawHeaders] });
    const send = (type, body, extra = {}) => { response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra }); response.end(body); };
    const ach = url.searchParams.get('ach'), asked = ach === 'all' ? HIGH_ASKED : ach === 'full' ? FULL_ASKED : null;
    const accept = asked ? { 'Accept-CH': asked.join(', '), 'Permissions-Policy': HIGH.map(name => name.slice(4) + '=*').join(', ') } : {};
    switch (url.pathname) {
      case '/page': return send('text/html; charset=utf-8', PAGE, accept);
      case '/frame': return send('text/html; charset=utf-8', '<!doctype html><title>frame</title>frame');
      case '/echo': return send('text/plain', 'ok');
      case '/s.js': return send('application/javascript', 'void 0;');
      case '/i.png': return send('image/png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
      case '/worker.js': return send('application/javascript', WORKER(tag));
      default: response.writeHead(404); return response.end('nope');
    }
  };
}
function upgrade(scheme) {
  return (request, socket) => {
    log.push({ scheme, version: request.httpVersion, path: '/ws', tag: new URL(request.url, 'x://x').searchParams.get('tag'), type: 'websocket', rawHeaders: [...request.rawHeaders] });
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket.on('data', data => { if ((data[0] & 15) === 8) socket.end(Buffer.from([0x88, 0])); else socket.write(Buffer.from([0x81, 2, 0x6f, 0x6b])); });
  };
}
const certificate = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
  "$ErrorActionPreference = 'Stop'", '$rsa = [System.Security.Cryptography.RSA]::Create(2048)',
  "$request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=hdr-secure.example.com', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)",
  '$certificate = $request.CreateSelfSigned([System.DateTimeOffset]::UtcNow.AddDays(-1), [System.DateTimeOffset]::UtcNow.AddDays(1))',
  "[Convert]::ToBase64String($certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, ''))", '[Convert]::ToBase64String($certificate.RawData)',
  '$certificate.Dispose()', '$rsa.Dispose()',
].join('\n')], { cwd: root, encoding: 'utf8', windowsHide: true });
assert.equal(certificate.status, 0, 'owned ephemeral HTTPS certificate: ' + certificate.stderr);
const [pfxText, derText] = certificate.stdout.trim().split(/\s+/);
const spki = createHash('sha256').update(new X509Certificate(Buffer.from(derText, 'base64')).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
const httpServer = createServer(handler('http')); httpServer.on('upgrade', upgrade('http'));
const httpsServer = createSecureServer({ pfx: Buffer.from(pfxText, 'base64'), passphrase: '', allowHTTP1: true }, handler('https')); httpsServer.on('upgrade', upgrade('https'));
for (const server of [httpServer, httpsServer]) server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); });
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const ports = { http: await listen(httpServer), https: await listen(httpsServer) };
const origins = { https: 'https://hdr-secure.example.com:' + ports.https, plain: 'http://hdr-plain.example.com:' + ports.http, loopback: 'http://127.0.0.1:' + ports.http, google: 'https://www.google.com' };

// ---- helpers -------------------------------------------------------------------------------------------------------
const header = (entry, name) => { const found = []; for (let index = 0; index < entry.rawHeaders.length; index += 2) if (entry.rawHeaders[index].toLowerCase() === name) found.push(entry.rawHeaders[index + 1]); return found.length ? found.join(', ') : undefined; };
const namesIn = rows => new Set(rows.flatMap(entry => FULL_REQUEST.filter(name => header(entry, name) !== undefined)));
const HINT_NAMES = ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'];
// Independent re-implementation of the wire format: what a browser would send for exactly these page-side values.
const wire = page => ({
  'user-agent': page.ua,
  'accept-language': page.languages.map((tag, index) => index === 0 ? tag : tag + ';q=0.' + Math.max(1, 10 - index)).join(','),
  'sec-ch-ua': page.brands ? page.brands.map(item => '"' + item.brand + '";v="' + item.version + '"').join(', ') : undefined,
  'sec-ch-ua-mobile': page.brands ? (page.mobile ? '?1' : '?0') : undefined,
  'sec-ch-ua-platform': page.brands ? '"' + page.platform + '"' : undefined,
});
// The exact bytes under test, so a package check can pin them to the final source/dist (as the other native evidence files do).
const hashes = Object.fromEntries(['antidetect-header-controller.js', 'api-configuration-controller.js', 'api-configuration.js'].map(name => [name, createHash('sha256').update(readFileSync(join(extension, name))).digest('hex')]));
const evidence = { at: new Date().toISOString(), run, mode: useDist ? 'dist/chrome' : 'source assembly', hashes, checks: [], phases: {},
  limits: ['Dedicated-worker requests: DNR cannot tell a worker request from a page request, so low-entropy client hints are also added there over https (Chrome sends none natively).',
    'Plain-http loopback origins keep their native (real) low-entropy client hints: the hint rule is https-only because Chrome sends none to non-trustworthy http.',
    'Width/Sec-CH-Width (image slot width) have no matching Custom row and stay native; Save-Data, Viewport-Height and Sec-CH-Prefers-Contrast were never sent by this Chrome.',
    'X-Client-Data: removed only while the applied identity claims a browser other than Google Chrome; the variation ids come from the --force-variation-ids switch (a fresh profile has none), and real Edge/Firefox profiles are not exercised (Edge 156 sent none with the same switch, measured outside this test).',
    'Not exercised: WebTransport/HTTP3, prerender/prefetch, withheld site access, Firefox.'] };
let context, ui, phase = 'startup';
const check = message => { evidence.checks.push(message); console.log('  ok ' + message); };
const send = message => ui.evaluate(message => chrome.runtime.sendMessage(message), message);
const ours = async () => (await ui.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).filter(rule => rule.id >= ID_RANGE[0] && rule.id <= ID_RANGE[1]);
async function probe(originKey, tag) {
  const page = await context.newPage(), start = log.length;
  const ach = tag.startsWith('ach') ? '&ach=all' : tag.startsWith('full') ? '&ach=full' : '';
  try {
    await page.goto(origins[originKey] + '/page?tag=' + tag + ach, { waitUntil: 'load' });
    const result = await page.evaluate(tag => probe(tag), tag);
    const rows = log.slice(start).filter(entry => entry.tag === tag);
    return { ...result, rows, byType: Object.fromEntries(rows.map(entry => [entry.type, entry])) };
  } finally { await page.close(); }
}
// Every call rewrites all eight rows: a row without a raw value goes Off, so no earlier phase leaks into the next.
async function saveIdentity({ agent, languages, hints, extras = {}, enabled = true }) {
  const before = await send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }); assert.equal(before.type, 'api-config-state');
  let configuration = { ...before.configuration, enabled: false, antidetectEnabled: enabled, preset: 'custom' };
  const rows = [['navigator-user-agent', agent], ['navigator-languages', languages], ['client-hints', hints], ...Object.keys(EXTRA).map(id => [id, extras[id]])];
  for (const [id, raw] of rows) {
    const mode = raw === undefined ? 'off' : 'custom', selected = raw === undefined ? { kind: 'unset' } : { kind: 'value', value: raw };
    const next = updateApiConfiguration(configuration, id, { mode, selected }); assert.equal(next.ok, true, id + ': ' + next.error?.message); configuration = next.value;
  }
  const saved = await send({ schemaVersion: 1, type: 'ui-api-config-set', tabId: null, expectedRevision: before.revision, configuration });
  assert.equal(saved.type, 'api-config-state', JSON.stringify(saved)); return saved;
}
const MOBILE = { agent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', languages: ['de-DE', 'de', 'en-US', 'en'],
  hints: { brands: [{ brand: 'Not_A Brand', version: '24' }, { brand: 'Chromium', version: '131' }, { brand: 'Google Chrome', version: '131' }], mobile: true, platform: 'Android' } };
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
const EDGE = { agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0', languages: ['en-GB', 'en'],
  hints: { brands: [{ brand: 'Not_A Brand', version: '24' }, { brand: 'Chromium', version: '131' }, { brand: 'Microsoft Edge', version: '131' }], mobile: false, platform: 'Windows' } };
const hasClientData = (probeResult, type) => header(probeResult.byType[type], 'x-client-data') !== undefined;
const ids = rules => rules.map(rule => rule.id).sort();

try {
  const common = { ignoreHTTPSErrors: false, ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 1100, height: 900 },
    args: ['--enable-unsafe-extension-debugging', '--disable-popup-blocking', '--no-proxy-server', '--ignore-certificate-errors-spki-list=' + spki, '--force-variation-ids=' + VARIATION_IDS, '--host-resolver-rules=MAP hdr-secure.example.com 127.0.0.1,MAP hdr-plain.example.com 127.0.0.1,MAP www.google.com 127.0.0.1:' + ports.https] };
  context = await chromium.launchPersistentContext(join(run, 'profile'), installed
    ? { ...common, executablePath: process.env.CHROME_BINARY ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, args: [...common.args, '--window-position=-32000,-32000', '--window-size=1100,900', '--no-first-run'] }
    : { ...common, channel: 'chromium', headless: true });
  evidence.browser = context.browser().version();
  const id = await installPersistentChromeExtension(context, extension, evidence);
  ui = await context.newPage(); await ui.goto('chrome-extension://' + id + '/options.html');
  ui = await enableChromeUserScripts(context, ui, id, evidence);
  await send({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true }); await send({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' });
  const initial = await send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }); assert.equal(initial.earlyAccess, 'ready');

  phase = 'baseline'; assert.deepEqual(await ours(), []);
  const real = {};
  for (const key of ['https', 'loopback', 'plain']) {
    const result = await probe(key, 'base' + key); real[key] = result;
    for (const entry of result.rows.filter(row => ['main_frame', 'fetch', 'sub_frame'].includes(row.type))) {
      const expected = wire(result.page);
      assert.equal(header(entry, 'user-agent'), expected['user-agent']); assert.equal(header(entry, 'accept-language'), expected['accept-language']);
    }
  }
  assert.ok(real.https.page.ua.includes('HeadlessChrome') || real.https.page.ua.includes('Chrome/'));
  for (const type of ['main_frame', 'fetch', 'sub_frame']) assert.ok(header(real.https.byType[type], 'sec-ch-ua') !== undefined, 'baseline Chrome sends client hints over https: ' + type);
  assert.equal(header(real.plain.byType.main_frame, 'sec-ch-ua'), undefined, 'baseline Chrome sends no client hints to non-trustworthy http');
  for (const type of ['worker-script', 'worker-fetch', 'websocket']) assert.equal(header(real.https.byType[type], 'sec-ch-ua'), undefined, 'baseline Chrome sends no client hints on ' + type);
  check('baseline: no 3001xx rule; server-seen User-Agent/Accept-Language equal the page values; hints exist only for https/loopback documents and subresources');
  evidence.phases.baseline = { ua: real.https.page.ua, languages: real.https.page.languages, extra: real.https.page.extra };

  phase = 'X-Client-Data baseline';
  const googleNative = await probe('google', 'xcdbase');
  for (const type of XCD_TYPES) assert.ok(hasClientData(googleNative, type), 'precondition: this Chrome sends X-Client-Data to a Google host on ' + type + ' (otherwise a removal proves nothing)');
  assert.equal(hasClientData(googleNative, 'websocket'), false, 'a WebSocket handshake never carries X-Client-Data');
  for (const entry of real.https.rows) assert.equal(header(entry, 'x-client-data'), undefined, 'a non-Google host never receives it: ' + entry.type);
  evidence.phases.clientData = { baseline: XCD_TYPES.filter(type => hasClientData(googleNative, type)), websocket: hasClientData(googleNative, 'websocket') };
  check('baseline: with variation ids Chrome sends X-Client-Data to a Google host on main_frame, iframe, fetch, XHR, script, image and dedicated-worker script/fetch (not on WebSocket, never to other hosts)');

  phase = 'mobile Chromium identity';
  const saved = await saveIdentity(MOBILE); assert.equal(saved.registration, 'ready');
  const rules = await ours(); assert.deepEqual(ids(rules), [300100, 300101, 300102, 300103]);
  assert.ok(rules.every(rule => rule.action.type === 'modifyHeaders' && rule.priority === 1000 && rule.condition.excludedInitiatorDomains?.[0] === id && rule.condition.resourceTypes.includes('main_frame')));
  check('the production controller installs exactly rules 300100..300103 (modifyHeaders, priority 1000, main_frame listed, extension initiator excluded) and registration is ready');
  const types = ['main_frame', 'sub_frame', 'fetch', 'xhr', 'script', 'image'];
  const https = await probe('https', 'idhttps'), expectedHttps = wire(https.page);
  assert.equal(https.page.ua, MOBILE.agent); assert.deepEqual(https.page.languages, MOBILE.languages); assert.deepEqual(https.page.brands, MOBILE.hints.brands); assert.equal(https.page.mobile, true); assert.equal(https.page.platform, 'Android');
  for (const type of types) {
    const entry = https.byType[type]; assert.ok(entry, 'request ' + type);
    for (const name of ['user-agent', 'accept-language', ...HINT_NAMES]) assert.equal(header(entry, name), expectedHttps[name], 'https ' + type + ' ' + name);
  }
  for (const type of ['websocket', 'worker-script', 'worker-fetch']) {
    assert.equal(header(https.byType[type], 'user-agent'), MOBILE.agent, type); assert.equal(header(https.byType[type], 'accept-language'), expectedHttps['accept-language'], type);
  }
  assert.equal(header(https.byType.websocket, 'sec-ch-ua'), undefined, 'a WebSocket handshake never gets client hints');
  evidence.phases.https = { page: https.page, seen: Object.fromEntries(Object.entries(https.byType).map(([type, entry]) => [type, { ua: header(entry, 'user-agent'), al: header(entry, 'accept-language'), ch: header(entry, 'sec-ch-ua'), mobile: header(entry, 'sec-ch-ua-mobile'), platform: header(entry, 'sec-ch-ua-platform') }])), worker: https.worker };
  check('https: User-Agent, Accept-Language and Sec-CH-UA/-Mobile/-Platform seen by the server equal the page values for main_frame, iframe, fetch, XHR, script and image');
  check('https: dedicated-worker script/fetch and the WebSocket handshake carry the same User-Agent/Accept-Language; the handshake carries no client hints');
  const workerHints = HINT_NAMES.map(name => header(https.byType['worker-fetch'], name));
  assert.deepEqual(workerHints, HINT_NAMES.map(name => expectedHttps[name]), 'documented limit: hints are also added to worker-initiated https requests');
  check('documented limit confirmed: worker-initiated https requests also carry the Custom low-entropy hints (Chrome sends none natively)');
  for (const key of ['loopback', 'plain']) {
    const result = await probe(key, 'id' + key), expected = wire(result.page);
    for (const type of [...types, 'websocket', 'worker-script', 'worker-fetch']) {
      assert.equal(header(result.byType[type], 'user-agent'), MOBILE.agent, key + ' ' + type); assert.equal(header(result.byType[type], 'accept-language'), expected['accept-language'], key + ' ' + type);
    }
    if (key === 'plain') for (const entry of result.rows) assert.equal(header(entry, 'sec-ch-ua'), undefined, 'no client hints are added to non-trustworthy http');
    else {
      for (const type of ['main_frame', 'fetch']) for (const name of HINT_NAMES) assert.equal(header(result.byType[type], name), header(real.loopback.byType[type], name), 'plain-http loopback keeps its native hints: ' + name);
    }
  }
  check('plain http: User-Agent/Accept-Language follow the Custom values everywhere; a non-trustworthy origin receives no hints; loopback keeps its native hints (https-only rule)');

  const googleChrome = await probe('google', 'xcdchrome');
  for (const type of XCD_TYPES) { assert.ok(hasClientData(googleChrome, type), 'a Google Chrome claim leaves X-Client-Data alone: ' + type); assert.equal(header(googleChrome.byType[type], 'user-agent'), MOBILE.agent, type); }
  assert.equal(ids(await ours()).includes(300109), false, 'no X-Client-Data rule for a Google Chrome claim');
  check('a Google Chrome identity (brand list with "Google Chrome") installs no X-Client-Data rule: the header still reaches the Google host on every type');

  phase = 'high-entropy hints removed';
  for (const key of ['loopback', 'https']) {
    const learned = await probe(key, 'ach-on-' + key);
    for (const entry of learned.rows) for (const name of HIGH) assert.equal(header(entry, name), undefined, key + ' removed: ' + entry.type + ' ' + name);
    const second = await probe(key, 'ach-on2-' + key);
    assert.equal(second.rows.flatMap(entry => HIGH.filter(name => header(entry, name) !== undefined)).length, 0, key);
  }
  check('Accept-CH from the server never produces a high-entropy hint (arch, bitness, full version(+list), model, platform version, WoW64, form factors) over https or loopback http while the Custom client-hints row is active');

  phase = 'device, viewport, network and preference hints removed (all five rows Custom)';
  const savedAll = await saveIdentity({ ...MOBILE, extras: EXTRA }); assert.equal(savedAll.registration, 'ready');
  assert.deepEqual(ids(await ours()), [300100, 300101, 300102, 300103, 300104, 300105, 300106, 300107, 300108]);
  evidence.phases.otherHints = {};
  for (const key of ['loopback', 'https']) {
    const result = await probe(key, 'full-on-' + key), seen = namesIn(result.rows), extra = result.page.extra, native = real[key].page.extra;
    assert.deepEqual([extra.deviceMemory, extra.dpr, extra.innerWidth, extra.rtt, extra.dark], [0.5, 2.5, 1234, 100, true], key + ': the page-side values are the Custom ones (ADR-107: rtt is Chrome-shaped, 100 stays 100 for every per-site factor)');
    assert.notDeepEqual([extra.deviceMemory, extra.dpr, extra.innerWidth, extra.rtt, extra.dark], [native.deviceMemory, native.dpr, native.innerWidth, native.rtt, native.dark], key + ': ... and differ from the native ones');
    for (const name of [...HIGH, ...OTHER_ALL]) assert.equal(seen.has(name), false, key + ' must not carry ' + name);
    for (const name of UNMAPPED) assert.equal(seen.has(name), true, key + ' keeps ' + name + ' (no matching Custom row)');
    for (const name of NEVER) assert.equal(seen.has(name), false, key + ' never sees ' + name + ' from this Chrome');
    for (const name of ['user-agent', 'accept-language']) assert.equal(header(result.byType.fetch, name), wire(result.page)[name], key + ' ' + name);
    evidence.phases.otherHints[key] = { page: extra, native, seenAfterRemoval: [...seen].sort() };
  }
  const httpsAll = await probe('https', 'full-hint-https');
  for (const name of HINT_NAMES) assert.equal(header(httpsAll.byType.fetch, name), wire(httpsAll.page)[name], 'the identity hints stay Custom next to the removal: ' + name);
  check('with the five matching Custom rows active the server sees none of device-memory, dpr, viewport-width/-height, ect, rtt, downlink or sec-ch-prefers-* (Sec-CH-* forms included) over https and loopback http, while the page reports the Custom values');

  phase = 'one row only';
  await saveIdentity({ extras: { 'device-memory': 0.5 } });
  assert.deepEqual(ids(await ours()), [300104]);
  for (const key of ['loopback', 'https']) {
    const result = await probe(key, 'full-one-' + key), seen = namesIn(result.rows);
    assert.deepEqual([result.page.extra.deviceMemory], [0.5]);
    for (const name of OTHER['device-memory']) assert.equal(seen.has(name), false, key + ' must not carry ' + name);
    for (const name of [...HIGH, ...OTHER_ALL.filter(name => !OTHER['device-memory'].includes(name))]) assert.equal(seen.has(name), true, key + ' keeps the native ' + name);
    assert.equal(header(result.byType.main_frame ?? result.byType.fetch, 'user-agent'), real[key].page.ua, 'identity rows off: real User-Agent');
  }
  check('with only the device-memory row Custom just Device-Memory and Sec-CH-Device-Memory disappear; every other hint (including the eight high-entropy ones) stays native');

  phase = 'Edge claim removes X-Client-Data';
  await saveIdentity(EDGE);
  assert.deepEqual(ids(await ours()), [300100, 300101, 300102, 300103, 300109]);
  const clientDataRule = (await ours()).find(rule => rule.id === 300109);
  assert.deepEqual(clientDataRule.action.requestHeaders.map(item => [item.header.toLowerCase(), item.operation, item.value]), [['x-client-data', 'remove', undefined]]);
  assert.ok(clientDataRule.priority === 1000 && clientDataRule.action.type === 'modifyHeaders' && clientDataRule.condition.excludedInitiatorDomains?.[0] === id && clientDataRule.condition.resourceTypes.includes('main_frame'));
  const googleEdge = await probe('google', 'xcdedge');
  assert.ok(googleEdge.page.brands.some(item => item.brand === 'Microsoft Edge') && googleEdge.page.ua === EDGE.agent, 'the page itself reports the Edge identity');
  for (const type of XCD_TYPES) { assert.ok(googleEdge.byType[type], 'request ' + type); assert.equal(hasClientData(googleEdge, type), false, 'Edge claim: no X-Client-Data on ' + type); assert.equal(header(googleEdge.byType[type], 'user-agent'), EDGE.agent, type); }
  const edgeWire = wire(googleEdge.page);
  for (const type of ['main_frame', 'fetch']) for (const name of HINT_NAMES) assert.equal(header(googleEdge.byType[type], name), edgeWire[name], 'the identity hints stay Custom next to the removal: ' + name);
  // The user agent alone is enough of a claim: the client-hints row stays Off, only the User-Agent names Edge.
  await saveIdentity({ agent: EDGE.agent });
  assert.deepEqual(ids(await ours()), [300100, 300109]);
  const googleEdgeAgent = await probe('google', 'xcdedgeua');
  for (const type of XCD_TYPES) { assert.equal(hasClientData(googleEdgeAgent, type), false, 'Edge user agent only: no X-Client-Data on ' + type); assert.equal(header(googleEdgeAgent.byType[type], 'user-agent'), EDGE.agent, type); }
  // ...and the brand list alone: the User-Agent row stays Off (the real Chrome User-Agent), only the client-hints brands name Microsoft Edge.
  await saveIdentity({ hints: EDGE.hints });
  assert.deepEqual(ids(await ours()), [300102, 300103, 300109]);
  const googleEdgeBrands = await probe('google', 'xcdedgebrands');
  for (const type of XCD_TYPES) assert.equal(hasClientData(googleEdgeBrands, type), false, 'Edge brand list only: no X-Client-Data on ' + type);
  evidence.phases.clientData.edge = { removedOn: XCD_TYPES, rules: [300100, 300101, 300102, 300103, 300109], userAgentOnlyRules: [300100, 300109], brandListOnlyRules: [300102, 300103, 300109] };
  check('an Edge identity (brand list "Microsoft Edge" with or without the Edg/ User-Agent, or just the Edg/ User-Agent) installs the remove-only X-Client-Data rule 300109 and the Google host sees none on main_frame, iframe, fetch, XHR, script, image and worker script/fetch');

  phase = 'Firefox claim';
  await saveIdentity({ agent: FIREFOX, languages: ['en-GB', 'en'], hints: undefined });
  assert.deepEqual(ids(await ours()), [300100, 300101, 300102, 300103, 300109]);
  const googleFirefox = await probe('google', 'xcdff');
  for (const type of XCD_TYPES) assert.equal(hasClientData(googleFirefox, type), false, 'Firefox claim: no X-Client-Data on ' + type);
  const firefox = await probe('https', 'ffhttps');
  for (const entry of firefox.rows.filter(row => ['main_frame', 'fetch', 'sub_frame', 'script'].includes(row.type))) {
    assert.equal(header(entry, 'user-agent'), FIREFOX); assert.equal(header(entry, 'accept-language'), 'en-GB,en;q=0.9');
    for (const name of HINT_NAMES) assert.equal(header(entry, name), undefined, 'a Firefox claim sends no ' + name);
  }
  check('a Firefox User-Agent claim removes Sec-CH-UA, Sec-CH-UA-Mobile, Sec-CH-UA-Platform and X-Client-Data that real Chrome would send');

  phase = 'service worker restart';
  const cdp = await context.newCDPSession(ui);
  try { await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers'); } finally { await cdp.detach(); }
  const restarted = await send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }); assert.equal(restarted.registration, 'ready');
  assert.deepEqual(ids(await ours()), [300100, 300101, 300102, 300103, 300109]);
  check('dynamic rules and registration survive a service-worker restart and are verified identical at the next reconcile');

  phase = 'master off';
  await saveIdentity({ ...MOBILE, extras: EXTRA, enabled: false });
  assert.deepEqual(await ours(), []);
  const off = await probe('https', 'offhttps');
  for (const entry of off.rows.filter(row => ['main_frame', 'fetch', 'sub_frame'].includes(row.type))) {
    assert.equal(header(entry, 'user-agent'), real.https.page.ua, 'real User-Agent again'); assert.equal(header(entry, 'accept-language'), header(real.https.byType.main_frame, 'accept-language'));
    assert.equal(header(entry, 'sec-ch-ua'), header(real.https.byType[entry.type], 'sec-ch-ua'));
  }
  for (const key of ['loopback', 'https']) {
    const control = await probe(key, 'full-off-' + key), seen = namesIn(control.rows);
    for (const name of [...HIGH, ...OTHER_ALL, ...UNMAPPED]) assert.equal(seen.has(name), true, 'control ' + key + ': the origin had learned the hints, so ' + name + ' returns once the rules are gone');
    assert.deepEqual([control.page.extra.deviceMemory, control.page.extra.dpr, control.page.extra.innerWidth], [real[key].page.extra.deviceMemory, real[key].page.extra.dpr, real[key].page.extra.innerWidth]);
  }
  check('disabling Antidetect removes every 3001xx rule: the server sees the real headers again, and every Accept-CH hint (learned all along, all ' + (HIGH.length + OTHER_ALL.length + UNMAPPED.length) + ' names) comes back');
  const googleOff = await probe('google', 'xcdoff');
  for (const type of XCD_TYPES) assert.ok(hasClientData(googleOff, type), 'Antidetect off: X-Client-Data returns on ' + type);
  evidence.phases.clientData.afterDisable = XCD_TYPES.filter(type => hasClientData(googleOff, type));
  check('disabling Antidetect also brings X-Client-Data back on every request type');

  phase = 'master on again';
  await saveIdentity(MOBILE); assert.equal((await ours()).length, 4);
  const again = await probe('https', 'againhttps'); assert.equal(header(again.byType.main_frame, 'user-agent'), MOBILE.agent);
  check('re-enabling restores the same four rules and the Custom headers'); evidence.result = 'PASS';
} catch (error) { evidence.result = 'FAIL'; evidence.failure = { phase, message: String(error.stack ?? error).replace(/https?:\/\/\S+/g, '[owned URL]').slice(0, 2000) }; console.error(evidence.failure); process.exitCode = 1; }
finally {
  await context?.close(); for (const socket of sockets) socket.destroy();
  await Promise.all([httpServer, httpsServer].map(server => new Promise(resolveClose => server.close(resolveClose))));
  const path = join(artifacts, installed ? 'headers-native-installed-chrome.json' : 'headers-native-chrome.json'); writeFileSync(path, JSON.stringify(evidence, null, 2) + '\n'); console.log(evidence.result + ': ' + path);
  if (evidence.result === 'PASS') rmSync(run, { recursive: true, force: true });
}
