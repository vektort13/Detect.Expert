// ADR-104/105/106/107: a generated device must tell ONE story on every surface a page can read.
// For 8 fixed claims x 3 presets (compatibility/balanced/strict) the configuration is generated in Node with the same
// generateConsistentDevice the Options UI uses (with this browser's environment snapshot), applied through the real
// ui-api-config-set message, and read by an owned loopback fixture in the top document, a same-origin iframe, a srcdoc
// iframe, a script-created about:blank, a popup (its initial about:blank and its loaded document) and a dedicated worker.
// Chrome serves the fixture over https (ephemeral certificate pinned by SPKI, as antidetect-headers-native does) because
// the ADR-105 client-hint rule is https-only; Firefox uses loopback http (it has no header rules at all).
// What is compared: UA <-> platform <-> userAgentData.platform <-> appVersion; UA major <-> brands <-> fullVersionList;
// language <-> languages[0] <-> Intl <-> server-seen Accept-Language/User-Agent/Sec-CH-UA; Intl zone <-> Date offset;
// screen <-> avail <-> matchMedia <-> DPR; WebGL vendor <-> WebGPU adapter; identical values in every realm; workers
// stay native; deviceMemory bucket; fingerprintProfileIssues(applied) without warnings. No automation/anti-bot probes.
// Known limits: antidetect-consistency-limits.json (a limit that no longer occurs fails the complete run: ratchet).
//
// node scripts/test/antidetect-consistency-native.mjs [--firefox] [--from-source] [--cases <n>] [--presets a,b]
//   --from-source  assemble the package from apps/production-extension instead of copying dist/<browser>
//   --cases/--presets  debugging subsets; such a run never reports stale limits and never writes PASS evidence
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';
import { ROOT, fileHashes, sourceMismatches, stageExtension, writeEvidence } from './native-evidence.mjs';
import { CONSISTENCY_CASES, CONSISTENCY_PRESETS, applyLimits, childHtml, consistencyFindings, customValue, limitsProblems, topHtml, workerJs } from './antidetect-consistency-fixture.mjs';
import { generateConsistentDevice } from '../../apps/production-extension/fingerprint-profiles.js';
import { browserVersions } from '../../apps/production-extension/fingerprint-device-presets.js';

const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome', fromSource = process.argv.includes('--from-source');
const caseLimit = argument('--cases') === null ? CONSISTENCY_CASES.length : Number(argument('--cases'));
const presets = argument('--presets') === null ? CONSISTENCY_PRESETS : argument('--presets').split(',');
assert.ok(Number.isInteger(caseLimit) && caseLimit >= 1 && caseLimit <= CONSISTENCY_CASES.length, '--cases 1..' + CONSISTENCY_CASES.length);
assert.ok(presets.length && presets.every(preset => CONSISTENCY_PRESETS.includes(preset)), '--presets ' + CONSISTENCY_PRESETS.join(','));
const complete = caseLimit === CONSISTENCY_CASES.length && presets.length === CONSISTENCY_PRESETS.length;
const limits = JSON.parse(readFileSync(join(import.meta.dirname, 'antidetect-consistency-limits.json'), 'utf8')).limits;
assert.deepEqual(limitsProblems(limits), [], 'antidetect-consistency-limits.json');

mkdirSync(join(ROOT, '.tmp'), { recursive: true });
const run = mkdtempSync(join(ROOT, '.tmp/antidetect-consistency-')), extension = join(run, 'extension');
const staged = await stageExtension({ browser, target: extension, from: fromSource ? 'source' : 'dist' });
// Deliberate-breakage hook: CONSISTENCY_NATIVE_MUTATION='{"file":...,"from":...,"to":...}' edits the staged temporary copy only
// (never the project sources); such a run writes its evidence under a -mutation name.
const mutation = process.env.CONSISTENCY_NATIVE_MUTATION ? JSON.parse(process.env.CONSISTENCY_NATIVE_MUTATION) : null;
if (mutation) {
  const target = join(extension, mutation.file), text = readFileSync(target, 'utf8');
  assert.equal(text.split(mutation.from).length - 1, 1, 'mutation anchor must occur exactly once in ' + mutation.file);
  writeFileSync(target, text.replace(mutation.from, () => mutation.to));
}
const FILES = ['manifest.json', 'api-configuration.js', 'api-configuration-controller.js', 'api-custom-registration.js', 'api-custom-runtime.js', 'api-custom-document-runtime.js', 'api-custom-inherit.main.js',
  'hook.early.js', 'hook.main.js', 'antidetect-header-controller.js', 'fingerprint-profiles.js', 'fingerprint-device-presets.js', 'fingerprint-profiles-controller.js', 'profile-noise-seed.js'].filter(file => existsSync(join(extension, file)));
const evidence = { browser, run, at: new Date().toISOString(), result: 'RUNNING', packaging: staged.packaging, complete, mutation, hashes: fileHashes(extension, FILES), checks: [], runs: [], notes: [] };
// The generator runs from apps/production-extension; a stale package would validate a different contract.
evidence.staleAgainstSource = sourceMismatches(extension, FILES.filter(file => file !== 'manifest.json'), browser);
const check = text => { evidence.checks.push(text); console.log('  ok ' + text); };

// ---- owned fixture servers ---------------------------------------------------------------------------------------------
const HOST = 'consistency.example.com', HEADERS = ['user-agent', 'accept-language', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'], log = [], sockets = new Set();
function handler(scheme) {
  return (request, response) => {
    const url = new URL(request.url, 'http://fixture'), runId = url.searchParams.get('run') ?? '', path = url.pathname;
    const type = path === '/page' ? 'main_frame' : path === '/frame' ? 'sub_frame' : path === '/popup' ? 'popup' : path === '/echo' ? 'fetch' : path === '/worker.js' ? 'worker' : 'other';
    if (log.length < 20000) log.push({ run: runId, type, scheme, headers: Object.fromEntries(HEADERS.map(name => [name, typeof request.headers[name] === 'string' ? request.headers[name].slice(0, 512) : undefined])) });
    const send = (contentType, body) => { response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }); response.end(body); };
    request.resume();
    if (type === 'main_frame') return send('text/html; charset=utf-8', topHtml(runId));
    if (type === 'sub_frame' || type === 'popup') return send('text/html; charset=utf-8', childHtml(runId));
    if (type === 'fetch') return send('text/plain', 'ok');
    if (type === 'worker') return send('text/javascript', workerJs());
    response.writeHead(404); response.end();
  };
}
const listen = server => new Promise(done => { server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); }); server.listen(0, '127.0.0.1', () => done(server.address().port)); });
const servers = [];
let origin, spki = null;
if (browser === 'chrome') {
  const made = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ["$ErrorActionPreference = 'Stop'", '$rsa = [System.Security.Cryptography.RSA]::Create(2048)',
    "$request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=" + HOST + "', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)",
    '$certificate = $request.CreateSelfSigned([System.DateTimeOffset]::UtcNow.AddDays(-1), [System.DateTimeOffset]::UtcNow.AddDays(1))',
    "[Convert]::ToBase64String($certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, ''))", '[Convert]::ToBase64String($certificate.RawData)', '$certificate.Dispose()', '$rsa.Dispose()'].join('\n')], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(made.status, 0, 'owned ephemeral HTTPS certificate: ' + made.stderr);
  const [pfx, der] = made.stdout.trim().split(/\s+/u);
  spki = createHash('sha256').update(new X509Certificate(Buffer.from(der, 'base64')).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  const server = createHttpsServer({ pfx: Buffer.from(pfx, 'base64'), passphrase: '' }, handler('https')); servers.push(server);
  origin = 'https://' + HOST + ':' + await listen(server);
} else {
  const server = createServer(handler('http')); servers.push(server);
  origin = 'http://127.0.0.1:' + await listen(server);
}

// ---- browser driver: one Options page for messages, owned fixture pages for probes --------------------------------
let opened = null, context = null, ui = null, base, phase = 'startup';
async function launch() {
  if (browser === 'firefox') {
    opened = await launchOwnedManagement({ root: ROOT, run, extension, browser, evidence });
    await opened.viewport(1000, 560); base = opened.base; evidence.version = opened.version;
    return;
  }
  context = await chromium.launchPersistentContext(join(run, 'chrome-profile'), { channel: 'chromium', headless: false, viewport: null,
    args: ['--window-position=-10000,-10000', '--window-size=1000,640', '--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-first-run', '--no-proxy-server',
      '--host-resolver-rules=MAP ' + HOST + ' 127.0.0.1', '--ignore-certificate-errors-spki-list=' + spki] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  base = new URL('.', worker.url()).href; evidence.version = context.browser().version();
  ui = await context.newPage(); await ui.goto(base + 'options.html#settings');
  ui = await enableChromeUserScripts(context, ui, new URL(base).host, evidence);
}
async function onOptions(hash = 'settings') {
  if (browser === 'chrome') return;
  await opened.goto(base + 'options.html?consistency=' + Date.now() + '#' + hash);
  await until(() => opened.evaluate(() => document.readyState === 'complete' && Boolean((globalThis.browser ?? globalThis.chrome)?.runtime?.id)), 'Options page');
}
const evaluate = (fn, value) => browser === 'chrome' ? ui.evaluate(fn, value) : opened.evaluate(fn, value);
const send = message => evaluate(message => (globalThis.browser ?? globalThis.chrome).runtime.sendMessage({ schemaVersion: 1, ...message }), message);
const state = () => send({ type: 'ui-api-config-get', tabId: null });

// The same environment snapshot the profile panel hands the generator; a fallback keeps the core facts if the controller
// module cannot be loaded in this page.
async function captureEnvironment() {
  return evaluate(async () => {
    const api = globalThis.browser ?? globalThis.chrome;
    let reason = 'no snapshot';
    try {
      const module = await import(new URL('fingerprint-profiles-controller.js', location.href).href);
      let latest = null;
      const controller = module.createFingerprintProfilesController(api, { onEnvironment: value => { latest = value; } });
      await controller.load();
      const deadline = Date.now() + 6000;
      while (!latest && Date.now() < deadline) await new Promise(done => setTimeout(done, 100));
      const value = latest ?? controller.environment?.();
      try { controller.dispose?.(); } catch { /* best effort */ }
      if (value && typeof value === 'object') return { source: latest ? 'controller (with slow facts)' : 'controller', value: JSON.parse(JSON.stringify(value)) };
    } catch (error) { reason = String(error?.message ?? error).slice(0, 200); }
    const hints = navigator.userAgentData, high = hints ? await hints.getHighEntropyValues(['platformVersion', 'uaFullVersion', 'fullVersionList']).catch(() => ({})) : {};
    const agent = navigator.userAgent, major = Number(/Chrome\/(\d+)/.exec(agent)?.[1]) || undefined;
    return { source: 'fallback (' + reason + ')', value: JSON.parse(JSON.stringify({ userAgent: agent, language: navigator.language, uaData: hints ? { brands: hints.brands, mobile: hints.mobile, platform: hints.platform } : null,
      hardwareConcurrency: navigator.hardwareConcurrency, devicePixelRatio: devicePixelRatio, screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight, colorDepth: screen.colorDepth },
      outer: { width: outerWidth, height: outerHeight }, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, uaMajor: major, brand: /Edg\//.test(agent) ? 'edge' : major ? 'chrome' : undefined,
      platform: /^Win/.test(hints?.platform ?? navigator.platform) ? 'windows' : undefined, platformVersion: high.platformVersion, uaFullVersion: high.uaFullVersion, fullVersionList: high.fullVersionList })) };
  });
}

async function probe(runId) {
  const url = origin + '/page?run=' + encodeURIComponent(runId), started = log.length;
  let page = null;
  try {
    if (browser === 'chrome') { page = await context.newPage(); await page.goto(url); } else await opened.goto(url);
    const read = fn => browser === 'chrome' ? page.evaluate(fn) : opened.evaluate(fn);
    await until(() => read(() => Boolean(globalThis.__consistency?.asyncDone && globalThis.__consistency.realms.srcdoc && globalThis.__consistency.realms.same)), 'fixture ' + runId, 20000);
    if (browser === 'chrome') await page.locator('#open-popup').click(); else await opened.click('#open-popup');
    await until(() => read(() => ['loaded', 'blocked'].includes(globalThis.__consistency?.popupState)), 'popup ' + runId, 15000).catch(() => null);
    const result = await read(() => JSON.parse(JSON.stringify(globalThis.__consistency)));
    return { result, headers: log.slice(started).filter(row => row.run === runId) };
  } finally {
    if (page) await page.close();
    if (browser === 'chrome') for (const extra of context.pages()) if (extra !== ui) await extra.close().catch(() => {});
  }
}

const CLAIM_ROWS = ['navigator-user-agent', 'navigator-platform', 'navigator-languages', 'timezone', 'hardware-concurrency', 'device-memory', 'screen-width', 'screen-height', 'window-device-pixel-ratio', 'webgl'];
const claimOf = configuration => Object.fromEntries(CLAIM_ROWS.map(id => [id, customValue(configuration, id)]).filter(([, value]) => value !== undefined).map(([id, value]) => [id, id === 'webgl' ? value.unmaskedRenderer : id === 'timezone' ? value.timeZone : value]));
const findings = [];
try {
  await launch();
  phase = 'setup'; await onOptions();
  await send({ type: 'ui-data-consent-set', version: 1, accepted: true }); await send({ type: 'ui-set-scope', scopeMode: 'all-sites' });
  if (browser === 'firefox') {
    await onOptions('antidetect');
    await until(() => opened.evaluate(() => document.querySelector('[data-antidetect-app]')?.getAttribute('aria-busy') === 'false'), 'Antidetect ready');
    if ((await state()).earlyAccess !== 'ready') await opened.click('[data-antidetect-grant-early]');
    await until(async () => (await state()).earlyAccess === 'ready', 'Firefox early access');
  }
  const initial = await state(); assert.equal(initial.earlyAccess, 'ready'); assert.equal(initial.configuration.antidetectEnabled, false);
  const environment = await captureEnvironment(); evidence.environment = { source: environment.source, fields: Object.keys(environment.value ?? {}).sort(), uaMajor: environment.value?.uaMajor ?? null };
  check('setup: consent, all-sites scope, early registration ready; environment snapshot from ' + environment.source);

  phase = 'native baseline'; const baseline = await probe('native-' + browser);
  assert.ok(baseline.result?.top && baseline.result.worker && !baseline.result.worker.timeout, 'native baseline probe');
  evidence.native = { ua: baseline.result.top.ua, platform: baseline.result.top.platform, language: baseline.result.top.language, timeZone: baseline.result.top.intl?.timeZone, gpu: baseline.result.gpu, webgl: baseline.result.top.webgl?.unmaskedRenderer ?? null, popup: baseline.result.popupState };
  check('native baseline read in every realm with Antidetect OFF (popup ' + baseline.result.popupState + ')');

  let revision = initial.revision, configuration = initial.configuration;
  for (const preset of presets) for (const item of CONSISTENCY_CASES.slice(0, caseLimit)) {
    phase = preset + ' seed ' + item.seed; const started = Date.now();
    const version = browserVersions(environment.value)[item.version] ?? browserVersions()[0];
    const generated = generateConsistentDevice(configuration, { seed: item.seed, protection: preset, deviceType: item.deviceType, os: item.os, browser: item.browser, version, region: item.region, environment: environment.value }, environment.value);
    await onOptions();
    const saved = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: revision, configuration: { ...generated.configuration, antidetectEnabled: true } });
    assert.equal(saved.type, 'api-config-state', phase + ': ' + JSON.stringify(saved).slice(0, 400));
    assert.equal(saved.registration, 'ready', phase + ': registration ' + saved.registration);
    revision = saved.revision; configuration = saved.configuration;
    const { result, headers } = await probe(preset + '-' + item.seed + '-' + browser);
    const outcome = consistencyFindings({ browser, configuration, environment: environment.value, result, headers, nativeWorker: baseline.result.worker, now: Date.now() });
    for (const failure of outcome.failures) findings.push({ ...failure, browser, preset, seed: item.seed });
    evidence.runs.push({ preset, seed: item.seed, region: item.region, claim: claimOf(configuration), popup: result?.popupState, gpu: result?.gpu?.info?.vendor ?? (result?.gpu?.absent ? 'absent' : result?.gpu?.adapter === null ? 'no adapter' : null),
      failures: outcome.failures.map(failure => failure.check + ': ' + failure.detail), notes: outcome.notes, durationMs: Date.now() - started });
    for (const note of outcome.notes) if (!evidence.notes.includes(note)) evidence.notes.push(note);
    console.log('  ' + preset + ' seed ' + item.seed + ' (' + item.region + '): ' + (outcome.failures.length ? [...new Set(outcome.failures.map(failure => failure.check))].join(', ') : 'consistent'));
  }
  phase = 'limits';
  const verdict = applyLimits(findings, limits, { browsers: [browser], complete });
  evidence.knownLimits = [...new Set(verdict.known.map(item => item.check))].map(check => ({ check, reason: limits.find(limit => limit.check === check && limit.browsers.includes(browser))?.reason, runs: verdict.known.filter(item => item.check === check).length }));
  evidence.unexpected = verdict.unexpected; evidence.staleLimits = verdict.stale;
  if (verdict.unexpected.length) throw new Error(verdict.unexpected.length + ' unexpected inconsistencies, first: ' + verdict.unexpected.slice(0, 5).map(item => item.preset + '/' + item.seed + ' ' + item.check + ': ' + item.detail).join(' | '));
  if (verdict.stale.length) throw new Error('stale known limits (they no longer occur; remove them from antidetect-consistency-limits.json): ' + JSON.stringify(verdict.stale));
  check(evidence.runs.length + ' applied profiles (' + presets.join('/') + ' x ' + caseLimit + ' claims) consistent across top/iframe/srcdoc/about:blank/popup; workers native; ' + evidence.knownLimits.length + ' known limit kinds');
  evidence.result = complete && !mutation ? 'PASS' : 'PARTIAL';
  console.log('Antidetect consistency ' + browser + ': ' + evidence.result + ' (' + evidence.runs.length + ' profiles, known limits: ' + evidence.knownLimits.map(item => item.check).join(', ') + ')');
} catch (error) { evidence.result = 'FAIL'; evidence.phase = phase; evidence.error = String(error?.stack ?? error); console.error(evidence.error); process.exitCode = 1; }
finally {
  writeEvidence('antidetect-consistency/' + browser + (mutation ? '-mutation' : !complete ? '-partial' : fromSource ? '-from-source' : '') + '.json', evidence);
  try { if (browser === 'chrome') await context?.close(); else await opened?.close(); } catch { /* the disposable profile is gone with the run folder */ }
  for (const socket of sockets) socket.destroy();
  for (const server of servers) await new Promise(done => server.close(done));
  await pause(10);
  // The disposable profile and package copy (~150 MB) are kept only when the run did not pass, for inspection.
  if (evidence.result === 'PASS' || evidence.result === 'PARTIAL') try { rmSync(run, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* a locked file only leaves the folder behind */ }
}
