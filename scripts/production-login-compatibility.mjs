// REQ-002/012, ADR-006: native local login A/B, using profiles and artifacts inside this project.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = path.join(root, '.tmp');
const artifact = path.join(root, 'test-results', 'login-compatibility-2026-10-09');
mkdirSync(temporary, { recursive: true });
mkdirSync(artifact, { recursive: true });
const findings = [];
const server = createServer(async (request, response) => {
  if (request.url === '/session') {
    let body = '';
    for await (const part of request) body += part;
    assert.equal(request.method, 'POST');
    assert.equal(body, 'fixture-login');
    assert.equal(request.headers['x-fixture-csrf'], 'fixture-csrf');
    response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'fixture_session=fixture-session; Path=/; SameSite=Lax' });
    response.end('{"authenticated":true}');
  } else if (request.url === '/redirect') {
    response.writeHead(302, { location: '/app' }); response.end();
  } else if (request.url === '/app') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ authenticated: (request.headers.cookie ?? '').includes('fixture_session=fixture-session') }));
  } else if (request.url === '/abort') {
    request.on('close', () => response.destroy());
  } else {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><html><head><title>Local login compatibility</title></head><body><main>login</main><iframe src="/frame"></iframe></body></html>');
  }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = 'http://127.0.0.1:' + server.address().port;
const oldDirectory = path.join(root, 'release', 'Detect.Expert-1.0.0-CWS-2026-09-16-r2');
const newDirectory = path.join(root, 'apps', 'production-extension');

async function run(name, directory, bundle = 'hook.early.js', protect = false) {
  const profile = mkdtempSync(path.join(temporary, 'login-profile-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true });
  const errors = [];
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.name + ': ' + error.message));
    if (directory) {
      // Exercise the actual parent-owned child installer instead of injecting a second child bundle.
      await page.addInitScript({ content: 'if (window.top === window) {\n' + readFileSync(path.join(directory, bundle), 'utf8') + '\n}' });
      if (protect) await page.addInitScript({ content: readFileSync(path.join(directory, 'protection.client-hints.js'), 'utf8') });
    }
    await page.goto(origin, { waitUntil: 'load' });
    const facts = await page.evaluate(async () => {
      // The application calls native APIs; the extension does not initiate these requests.
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      context.fillRect(0, 0, 1, 1);
      const canvasReadable = canvas.toDataURL().startsWith('data:image/png');
      const module = await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
      const wasmUsable = module instanceof WebAssembly.Module;
      const frame = document.querySelector('iframe');
      const child = frame.contentWindow;
      const childFunction = child.fetch instanceof child.Function;
      const childGetter = Object.getOwnPropertyDescriptor(child.Navigator.prototype, 'userAgent').get instanceof child.Function;
      const childSetter = Object.getOwnPropertyDescriptor(child.HTMLImageElement.prototype, 'src').set instanceof child.Function;
      let headerReads = 0, bodyReads = 0;
      const init = { method: 'POST', credentials: 'include',
        get headers() { headerReads++; return { 'x-fixture-csrf': 'fixture-csrf' }; },
        get body() { bodyReads++; return 'fixture-login'; } };
      const first = await (await fetch('/session', init)).json();
      const second = await (await fetch(new Request('/session', {
        method: 'POST', credentials: 'include', headers: { 'x-fixture-csrf': 'fixture-csrf' }, body: 'fixture-login',
      }))).json();
      const xhrResult = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/session'); xhr.withCredentials = true;
        xhr.setRequestHeader('x-fixture-csrf', 'fixture-csrf');
        xhr.onload = () => resolve(JSON.parse(xhr.responseText));
        xhr.onerror = reject; xhr.send('fixture-login');
      });
      const redirected = await (await fetch('/redirect', { credentials: 'include' })).json();
      const controller = new AbortController(), pending = fetch('/abort', { signal: controller.signal });
      controller.abort();
      let abortName = null;
      try { await pending; } catch (error) { abortName = error.name; }
      sessionStorage.setItem('fixture-session', 'present');
      const storageUsable = sessionStorage.getItem('fixture-session') === 'present';
      const loggedIn = first.authenticated && second.authenticated && xhrResult.authenticated && redirected.authenticated;
      if (loggedIn) document.querySelector('main').textContent = 'signed in';
      return { loggedIn, canvasReadable, wasmUsable, storageUsable, headerReads, bodyReads, abortName,
        childFunction, childGetter, childSetter, content: document.querySelector('main').textContent,
        userAgentDataPresent: 'userAgentData' in navigator };
    });
    let restored = null;
    if (protect) {
      await page.evaluate(() => window.postMessage({ channel: 'detect.expert/protection/v1', type: 'protection-stop' }, '*'));
      await page.waitForTimeout(25);
      restored = await page.evaluate(() => 'userAgentData' in navigator);
    }
    findings.push({ name, chromium: context.browser().version(), facts, errors, restored });
    assert.equal(facts.loggedIn, true, name);
    assert.equal(facts.canvasReadable && facts.wasmUsable && facts.storageUsable, true, name);
    assert.equal(facts.headerReads, 1, name);
    assert.equal(facts.bodyReads, 1, name);
    assert.equal(facts.abortName, 'AbortError', name);
    assert.deepEqual(errors, [], name);
    return { facts, restored };
  } finally {
    await context.close();
    assert.ok(profile.startsWith(temporary + path.sep));
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
try {
  const baseline = await run('baseline', null);
  const old = await run('1.0.0 early passive', oldDirectory);
  const early = await run('1.1.0 early passive', newDirectory);
  const late = await run('1.1.0 late passive', newDirectory, 'hook.main.js');
  assert.equal(baseline.facts.childFunction, true);
  assert.equal(old.facts.childFunction, false, 'reproduces child-realm Function prototype regression in 1.0.0');
  for (const fixed of [early, late]) {
    assert.equal(fixed.facts.childFunction, true);
    assert.equal(fixed.facts.childGetter, true);
    assert.equal(fixed.facts.childSetter, true);
    assert.deepEqual(fixed.facts, baseline.facts);
  }
  const oldRecovery = await run('1.0.0 hidden API recovery', oldDirectory, 'hook.early.js', true);
  const newRecovery = await run('1.1.0 hidden API recovery', newDirectory, 'hook.early.js', true);
  assert.equal(oldRecovery.restored, false, 'reproduces missing deleted-descriptor recovery');
  assert.equal(newRecovery.restored, true, 'restores the native API without reload when slot remains absent');
  console.log('PASS: 6 native local login scenarios, child-realm differential and deleted-API recovery');
} finally {
  writeFileSync(path.join(artifact, 'native.json'), JSON.stringify(findings, null, 2) + '\n');
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
