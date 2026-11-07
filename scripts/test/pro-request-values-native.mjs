// ADR-039: compare the extension's passive Pro values with an owned HTTPS receiver.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:https';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { PRO_REQUEST_HEADER_NAMES } from '../../packages/contracts/src/pro-request-values.mjs';

const root = resolve(import.meta.dirname, '../..'), output = join(root, 'dist/chrome');
const artifact = join(root, 'test-results/pro-request-values-ADR-039'); mkdirSync(artifact, { recursive: true });
const run = mkdtempSync(join(root, '.tmp/pro-request-values-native-'));
assert.ok(resolve(run).startsWith(join(root, '.tmp') + sep));
const evidence = { errors: [], checks: [], received: [], packagedHashes: Object.fromEntries([
  'manifest.json', 'background.js', 'pro-request-values.js', 'pro-request-values-contracts.js', 'advanced-contracts.js', 'pro-report-tables.js', 'report.js'
].map(file => [file, createHash('sha256').update(readFileSync(join(output, file))).digest('hex')])) };
const certificate = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
  "$ErrorActionPreference = 'Stop'", '$rsa = [System.Security.Cryptography.RSA]::Create(2048)',
  "$request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=main.values.example.com', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)",
  '$certificate = $request.CreateSelfSigned([System.DateTimeOffset]::UtcNow.AddDays(-1), [System.DateTimeOffset]::UtcNow.AddDays(1))',
  "[Convert]::ToBase64String($certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, ''))",
  '$certificate.Dispose()', '$rsa.Dispose()',
].join('\n')], { cwd: root, encoding: 'utf8', windowsHide: true });
assert.equal(certificate.status, 0, 'owned ephemeral HTTPS certificate: ' + certificate.stderr);

const server = createServer({ pfx: Buffer.from(certificate.stdout.trim(), 'base64'), passphrase: '' }, (request, response) => {
  response.setHeader('Cache-Control', 'no-store'); response.setHeader('Accept-CH', 'Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Full-Version-List, Sec-CH-UA-Model, Sec-CH-UA-Platform-Version, Sec-CH-UA-WoW64, Sec-CH-UA-Form-Factors');
  if (request.url?.startsWith('/observed-')) {
    evidence.received.push({ host: request.headers.host.split(':')[0], path: request.url,
      headers: PRO_REQUEST_HEADER_NAMES.flatMap(name => typeof request.headers[name.toLowerCase()] === 'string' ? [{ name, value: request.headers[name.toLowerCase()] }] : []) });
    response.setHeader('Content-Type', 'application/json'); response.end('{"owned":true}'); return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><title>Owned passive request values</title><h1>Owned passive request values</h1>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'https://main.values.example.com:' + server.address().port;
const childOrigin = 'https://child.values.example.net:' + server.address().port;
let context;
try {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true, ignoreHTTPSErrors: true,
    args: ['--disable-extensions-except=' + output, '--load-extension=' + output, '--no-proxy-server', '--host-resolver-rules=MAP main.values.example.com 127.0.0.1,MAP child.values.example.net 127.0.0.1'] });
  evidence.browser = context.browser().version();
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), extensionId = new URL(worker.url()).host;
  const ui = await context.newPage(); ui.on('pageerror', error => evidence.errors.push(error.message));
  await ui.goto('chrome-extension://' + extensionId + '/popup.html');
  const send = message => ui.evaluate(message => chrome.runtime.sendMessage(message), message);
  assert.equal((await send({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true })).accepted, true);
  await send({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' });
  const site = await context.newPage(); site.on('pageerror', error => evidence.errors.push(error.message)); await site.goto(origin);
  await site.evaluate(() => fetch('/observed-before', { headers: { Accept: 'application/before-pro' } }).then(response => response.text()));
  const tab = await ui.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)), origin + '/'); assert.ok(tab?.id);
  const started = await send({ schemaVersion: 1, type: 'ui-pro-start', tabId: tab.id }); assert.equal(started.type, 'pro-state');
  await site.waitForTimeout(900);
  await site.evaluate(async childOrigin => {
    await fetch('/observed-main-a', { headers: { Accept: 'application/main-a; q=0.42' } });
    await fetch('/observed-main-b', { headers: { Accept: 'application/main-b; q=0.84' } });
    await new Promise((resolve, reject) => { const frame = document.createElement('iframe'); frame.src = childOrigin; frame.onload = resolve; frame.onerror = reject; document.body.appendChild(frame); });
  }, childOrigin);
  const child = site.frames().find(frame => frame.url().startsWith(childOrigin)); assert.ok(child);
  await child.waitForTimeout(700);
  await child.evaluate(() => fetch('/observed-child', { headers: { Accept: 'application/child; q=0.21' } }).then(response => response.text()));
  await site.waitForTimeout(1200);
  const stopped = await send({ schemaVersion: 1, type: 'ui-pro-stop', sessionId: started.session.id }); assert.equal(stopped.session.status, 'stopped');
  const rows = stopped.session.pages.flatMap(page => page.requestValues?.rows ?? []);
  evidence.observed = rows;
  const requests = evidence.received.filter(request => request.path !== '/observed-before'); assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.ok(request.headers.some(header => header.name === 'User-Agent'));
    assert.ok(request.headers.some(header => header.name === 'Accept-Language'));
    assert.ok(request.headers.some(header => header.name === 'Accept-Encoding'));
    for (const header of request.headers) assert.ok(rows.some(row => row.destinationHost === request.host && row.name === header.name && row.value === header.value), request.host + ': exact received ' + header.name);
  }
  const main = rows.filter(row => row.destinationHost === 'main.values.example.com' && row.name === 'Accept');
  const third = rows.filter(row => row.destinationHost === 'child.values.example.net' && row.name === 'Accept');
  assert.ok(main.some(row => row.value === 'application/main-a; q=0.42'));
  assert.ok(main.some(row => row.value === 'application/main-b; q=0.84'));
  assert.ok(third.some(row => row.value === 'application/child; q=0.21' && row.documentKey.split(':')[1] !== '0'));
  assert.ok(!rows.some(row => row.value === 'application/before-pro'));
  assert.ok(rows.every(row => row.documentKey.startsWith(tab.id + ':') && PRO_REQUEST_HEADER_NAMES.includes(row.name)));
  const report = await context.newPage(); report.on('pageerror', error => evidence.errors.push(error.message));
  await report.goto('chrome-extension://' + extensionId + '/report.html?id=' + started.session.id);
  await report.locator('[data-pro-summary="browser"] tbody tr').first().waitFor();
  const summary = await report.locator('[data-pro-summary="browser"] tbody tr').evaluateAll(rows => rows.map(row => [...row.children].map(cell => cell.textContent)));
  evidence.summary = summary;
  for (const row of rows) assert.ok(summary.some(cells => cells.length === 3 && cells[1] === row.name && cells[2] === JSON.stringify(row.value)), 'summary retains ' + row.name);
  evidence.summaryCount = summary.length;
  evidence.checks.push('exact values compared with owned HTTPS receiver', 'two distinct main-site Accept values', 'cross-site iframe native document identity', '27 client-hint allowlist conditional on actual sending', 'before-Pro request excluded', 'every retained native header appears in the three-column summary');
  assert.deepEqual(evidence.errors, []); evidence.passed = true;
  console.log(JSON.stringify({ browser: evidence.browser, receivedRequests: requests.length, nativeRows: rows.length, summaryRows: summary.length, checks: evidence.checks, passed: true }));
} finally {
  await context?.close(); await new Promise(done => server.close(done));
  writeFileSync(join(artifact, 'native-chrome.json'), JSON.stringify(evidence, null, 2) + '\n');
  assert.ok(resolve(run).startsWith(join(root, '.tmp') + sep)); rmSync(run, { recursive: true, force: true });
}
