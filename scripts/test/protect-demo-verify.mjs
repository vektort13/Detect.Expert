// Headless check of the demo stand scripts/test/protect-demo-server.mjs with the delivered Chrome build (port plan
// §5.4, §8). Spawns the stand CLI on a free port, parses what it prints (URLs, Chrome command, checklist), then runs
// Playwright Chromium (channel 'chromium') with a copy of dist/chrome and the PRINTED --host-resolver-rules:
//   - the stand pages load through the host rules; no request leaves for a non-demo host;
//   - the pixel request reaches the collector (the stand's own «[получатель]» log line), with the right SHA-256;
//   - the module is enabled through the real consent click in options.html#protect;
//   - typing an e-mail on shop-a (no blur, no submit) gives value-match evidence (ui-protect-get-report from an
//     extension page) and the module badge «1»; shop-b and history; GPC page; recorder; the password page gives none.
// Assertions use the SW report and the badge, never popup markup (the firewall UI is being reworked in parallel).
// --probe-chrome: also starts the installed Google Chrome (headless, temporary profile) with the printed flags and
// records whether it loads the extension and opens a stand page (facts for the checklist, not assertions).
// Evidence: .tmp/protect-demo-verify-*/evidence.json. Usage: node scripts/test/protect-demo-verify.mjs [--probe-chrome]

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..', '..');
const temporary = join(root, '.tmp');
mkdirSync(temporary, { recursive: true });
const run = mkdtempSync(join(temporary, 'protect-demo-verify-'));
const extension = join(run, 'extension');
cpSync(join(root, 'dist', 'chrome'), extension, { recursive: true });
const probeChrome = process.argv.includes('--probe-chrome');
const EMAIL = 'demo.owner+stand@example.com';
const PASSWORD = 'Demo-pass-0451';
const FEATURES = ['value-match', 'firewall', 'session-replay', 'history', 'gpc'];
const DEMO_HOST = /\.example\.(?:com|net|org)$/;
const evidence = { at: new Date().toISOString(), run, checks: [], facts: {}, pageErrors: [], unexpectedRequests: [] };
const check = (text) => { evidence.checks.push(text); console.log('  ok ' + text); };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function until(probe, message, timeout = 20_000, step = 200) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await probe();
    if (last) return last;
    await sleep(step);
  }
  throw new Error('timeout: ' + message);
}

// 1. The stand CLI, as the owner starts it (pnpm protect:demo = node scripts/test/protect-demo-server.mjs).
const child = spawn(process.execPath, [join(root, 'scripts', 'test', 'protect-demo-server.mjs'), '--port', '0'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
let err = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => { out += chunk; });
child.stderr.on('data', (chunk) => { err += chunk; });
const logLines = () => out.split(/\r?\n/).filter((line) => line.startsWith('[получатель] ') || line.startsWith('[GPC] '));
const hits = (re) => logLines().filter((line) => re.test(line));

let context;
let branded = null;
let id = null;
try {
  await until(() => out.includes('Жду запросы.'), 'stand start-up output\n' + out + err, 20_000);
  const banner = out.slice(0, out.indexOf('Жду запросы.'));
  const url = (host, path = '/') => {
    const m = banner.match(new RegExp('http://' + host.replace(/\./g, '\\.') + ':(\\d+)(' + path.replace(/[.?]/g, '\\$&') + '\\S*)'));
    assert.ok(m, 'printed URL for ' + host + path);
    return m[0];
  };
  const urls = {
    index: url('stand.example.com'),
    shopA: url('shop-a.example.com'),
    shopB: url('shop-b.example.org'),
    gpc: url('gpc.example.org'),
    recorder: url('recorder.example.org', '/protect/replay/recorder-positive.html'),
    password: url('login.example.com', '/protect/forms/password-negative.html?rp='),
    collector: url('px.collector.example.net', '/tr'),
  };
  const port = new URL(urls.shopA).port;
  assert.ok(Object.values(urls).every((u) => new URL(u).port === port), 'all printed URLs use the bound port');
  assert.match(urls.password, new RegExp('\\?rp=' + port + '$'));
  const commandLine = banner.split(/\r?\n/).find((line) => line.includes('PowerShell:') || line.includes('--host-resolver-rules'));
  assert.ok(commandLine, 'printed Chrome command');
  const flag = (name) => commandLine.match(new RegExp('"--' + name + '=([^"]+)"'))?.[1] ?? commandLine.match(new RegExp('(?:^| )--' + name + '=(\\S+)'))?.[1] ?? null;
  const rules = flag('host-resolver-rules'), loadExtension = flag('load-extension'), userDataDir = flag('user-data-dir');
  assert.equal(loadExtension, join(root, 'dist', 'chrome'), 'printed --load-extension is the absolute dist\\chrome');
  assert.equal(userDataDir, join(root, '.tmp', 'protect-demo-profile'), 'printed --user-data-dir');
  assert.ok(rules !== null && /MAP \*\.example\.com 127\.0\.0\.1/.test(rules) && /MAP \*\.example\.net 127\.0\.0\.1/.test(rules) && /MAP \*\.example\.org 127\.0\.0\.1/.test(rules), 'printed --host-resolver-rules: ' + rules);
  assert.ok(commandLine.includes('--no-proxy-server') && commandLine.endsWith(urls.index), 'command ends with the index page');
  const exe = commandLine.match(/& "([^"]+)"/)?.[1] ?? null;
  const steps = banner.split(/\r?\n/).filter((line) => /^ ?\d{1,2}\. /.test(line));
  assert.ok(banner.includes('Чек-лист:') && steps.length >= 8, 'printed checklist');
  evidence.facts.printed = { urls, rules, loadExtension, userDataDir, chromeExe: exe, chromeExeExists: exe !== null && existsSync(exe), checklistSteps: steps.length, chromiumAlternative: banner.includes('Chromium из Playwright') };
  check('stand CLI printed ' + Object.keys(urls).length + ' URLs on port ' + port + ', the Chrome command (' + (exe ?? 'placeholder') + ') with the profile, host rules and dist\\chrome, and a ' + steps.length + '-step checklist');

  // 2. Chromium with the delivered build and exactly the printed host rules.
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 1100, height: 900 },
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-proxy-server', '--host-resolver-rules=' + rules] });
  evidence.browser = context.browser()?.version() ?? null;
  context.on('request', (request) => {
    const u = new URL(request.url());
    if (['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol) && !(DEMO_HOST.test(u.hostname) && u.port === port)) evidence.unexpectedRequests.push(u.origin);
  });
  context.on('page', (p) => p.on('pageerror', (error) => evidence.pageErrors.push(error.message)));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  id = new URL(worker.url()).host;
  const ui = await context.newPage();
  await ui.goto('chrome-extension://' + id + '/options.html');
  const send = (message) => ui.evaluate((m) => chrome.runtime.sendMessage(m), { schemaVersion: 1, ...message });
  const tabOf = (pageUrl) => ui.evaluate((u) => chrome.tabs.query({}).then((tabs) => tabs.find((t) => t.url === u)?.id ?? null), pageUrl);
  const badge = (tabId) => ui.evaluate((t) => chrome.action.getBadgeText({ tabId: t }), tabId);
  const badgeInfo = (tabId) => ui.evaluate(async (t) => ({ text: await chrome.action.getBadgeText({ tabId: t }), color: (await chrome.action.getBadgeBackgroundColor({ tabId: t })).join(','), title: await chrome.action.getTitle({ tabId: t }) }), tabId);
  const MODULE_BADGE_COLOR = '36,86,179,255';
  const moduleBadge = async (tabId) => { const b = await badgeInfo(tabId); return b.color === MODULE_BADGE_COLOR ? b.text : ''; };
  const techniques = async (tabId) => ((await send({ type: 'ui-get-report', tabId }))?.report?.techniques ?? []).filter((t) => t.count > 0).map((t) => t.techniqueId);
  const report = async (tabId) => (await send({ type: 'ui-protect-get-report', tabId }))?.report ?? null;
  const transfers = async (tabId) => ((await report(tabId))?.evidence ?? []).filter((e) => e.protectKind === 'value-match' || e.protectKind === 'opaque-after-input');

  // 3. Every page loads through the host rules and is served by the stand.
  const titles = {};
  for (const [name, target] of Object.entries(urls)) {
    if (name === 'collector') continue;
    const p = await context.newPage();
    const response = await p.goto(target);
    assert.equal(response?.status(), 200, name + ' status');
    titles[name] = await p.title();
    await p.close();
  }
  assert.match(titles.index, /Стенд/); assert.match(titles.shopA, /Магазин A/); assert.match(titles.shopB, /Магазин B/);
  assert.match(titles.gpc, /GPC/); assert.match(titles.recorder, /session recorder/); assert.match(titles.password, /password negative/);
  evidence.facts.titles = titles;
  check('6 pages load through the printed host rules with HTTP 200: ' + Object.values(titles).join(' | '));

  // 4. Module off: the pixel works by itself; the module answers no report.
  const shopA = await context.newPage();
  await shopA.goto(urls.shopA);
  await until(() => hits(/px\.collector\.example\.net\/tr ev=PageView/).length >= 1, 'PageView at the collector');
  const leadUrls = [];
  shopA.on('request', (request) => { if (request.url().includes('ud[em]=') || request.url().includes('ud%5Bem%5D=')) leadUrls.push(request.url()); });
  const failedLeads = [];
  shopA.on('requestfailed', (request) => { if (request.url().includes('ev=Lead')) failedLeads.push(request.failure()?.errorText ?? 'unknown'); });
  await shopA.locator('#email').click();
  await shopA.keyboard.type(EMAIL, { delay: 15 });
  await until(() => hits(/px\.collector\.example\.net\/tr ev=Lead ключи=ev,ud\[em\]/).length >= 1, 'Lead pixel while typing (module off)');
  const expected = createHash('sha256').update(EMAIL.trim().toLowerCase()).digest('hex');
  assert.equal(new URL(leadUrls[0]).searchParams.get('ud[em]'), expected, 'ud[em] = sha256(trim+lower e-mail)');
  assert.equal(await shopA.locator('#email').evaluate((el) => el === document.activeElement), true, 'still typing: no blur, no submit');
  const offReport = await send({ type: 'ui-protect-get-report', tabId: await tabOf(urls.shopA) });
  evidence.facts.moduleOffReport = offReport;
  check('module off: PageView and the ud[em] pixel (SHA-256 verified) reach the collector while typing, before blur/submit; report = ' + JSON.stringify(offReport).slice(0, 80));

  // 5. Enable through the real consent click in options.html#protect (all five features, «Обычный»).
  const offState = await send({ type: 'ui-protect-get-state' });
  assert.equal(offState?.state?.state, 'off');
  const options = await context.newPage();
  await options.goto('chrome-extension://' + id + '/options.html#protect');
  await options.locator('[data-protect-enable]').click();
  await options.locator('#protect-consent').waitFor();
  for (const feature of FEATURES) await options.locator('#protect-consent-feature-' + feature).setChecked(true);
  await options.locator('#protect-consent-preset-normal').check();
  await options.locator('#protect-consent-ack').check();
  await options.locator('[data-consent-confirm]').click();
  await options.locator('#protect-consent').waitFor({ state: 'detached', timeout: 15_000 });
  const on = await send({ type: 'ui-protect-get-state' });
  evidence.facts.enabled = { state: on?.state?.state, features: on?.state?.features, degradedReasons: on?.state?.degradedReasons, permissions: on?.state?.permissions };
  assert.equal(on?.state?.state, 'active', JSON.stringify(on).slice(0, 300));
  assert.deepEqual([...on.state.features].sort(), [...FEATURES].sort());
  await options.close();
  check('consent click in options.html#protect: module active with ' + on.state.features.join(', '));

  // 6. shop-a with the module: trusted typing, no blur, no submit -> evidence and badge «1».
  await shopA.reload();
  const tabA = await tabOf(urls.shopA);
  const leadsBefore = hits(/px\.collector\.example\.net\/tr ev=Lead/).length;
  await shopA.locator('#email').click();
  await shopA.keyboard.type(EMAIL, { delay: 15 });
  await until(() => hits(/px\.collector\.example\.net\/tr ev=Lead/).length > leadsBefore, 'Lead pixel with the module on');
  const typed = await until(async () => (await transfers(tabA)).find((e) => e.receiver === 'example.net'), 'value-match evidence on shop-a', 25_000, 300);
  assert.equal(await shopA.locator('#email').evaluate((el) => el === document.activeElement), true, 'evidence while the field still has focus');
  assert.equal(typed.protectKind, 'value-match');
  assert.equal(typed.fieldKind, 'email');
  assert.equal(typed.transferClass, 'third-party-before-submit');
  const badgeA = await until(async () => { const text = await moduleBadge(tabA); return text === '1' ? text : null; }, 'module badge «1» (module colour) on shop-a', 10_000);
  const reportA = await report(tabA);
  evidence.facts.shopA = { evidence: reportA.evidence.map((e) => ({ protectKind: e.protectKind, receiver: e.receiver, fieldKind: e.fieldKind, transferClass: e.transferClass, submitTiming: e.submitTiming, deliveryState: e.deliveryState, interpretationConfidence: e.interpretationConfidence, encodings: e.encodings, location: e.location, parameterName: e.parameterName })),
    prompt: reportA.firewall?.prompt !== null && reportA.firewall?.prompt !== undefined, badge: await badgeInfo(tabA), coverageState: reportA.coverageState };
  check('shop-a, typing without blur/submit: value-match evidence to example.net (' + typed.transferClass + ', ' + typed.interpretationConfidence + ', ' + typed.deliveryState + '), badge «' + badgeA + '», firewall prompt ' + evidence.facts.shopA.prompt);

  // 6b. Checklist step 4 through the SW route the card uses (not its markup): «Этот сайт» + block -> the repeat on the
  // same page (focus + blur) is stopped (no new collector line, evidence «stopped», stoppedToday grows) -> undo -> sent.
  // The field still has focus from typing; leave it first (as opening the extension window does), so the repeat below is
  // a new focus + blur. The pixel sends once per value per focus, so this blur sends nothing new.
  await shopA.locator('#title').click();
  await sleep(300);
  const prompt = reportA.firewall.prompt;
  const stoppedBefore = reportA.firewall.stoppedToday?.count ?? 0;
  const decided = await send({ type: 'ui-protect-decide', tabId: tabA, documentKey: reportA.documentKey, protectRevision: reportA.protectRevision,
    promptId: prompt.promptId, receivers: ['example.net'], action: 'block', scope: 'site' });
  assert.equal(decided?.type, 'protect-decision', JSON.stringify(decided).slice(0, 300));
  assert.equal(decided.applied?.[0]?.ruleApplied, true, 'DNR rule applied: ' + JSON.stringify(decided.applied));
  await until(async () => (await moduleBadge(tabA)) === '', 'module badge cleared after the decision', 10_000);
  await sleep(300);
  const leadsBlocked = hits(/px\.collector\.example\.net\/tr ev=Lead/).length;
  await shopA.locator('#email').click();
  await shopA.locator('#title').click();
  const stopped = await until(async () => (await transfers(tabA)).find((e) => e.receiver === 'example.net' && e.deliveryState === 'stopped'), 'evidence «stopped» for the repeat', 20_000, 300);
  await sleep(1500);
  assert.equal(hits(/px\.collector\.example\.net\/tr ev=Lead/).length, leadsBlocked, 'the collector did not receive the repeat');
  const afterBlock = await report(tabA);
  assert.ok(afterBlock.firewall.stoppedToday.count > stoppedBefore, 'stoppedToday grew');
  assert.equal(afterBlock.firewall.prompt, null, 'no new card after the decision');
  const undone = await send({ type: 'ui-protect-undo', tabId: tabA, undoId: decided.undoId });
  assert.equal(undone?.type, 'protect-decision', JSON.stringify(undone).slice(0, 300));
  await sleep(300);
  await shopA.locator('#email').click();
  await shopA.locator('#title').click();
  await until(() => hits(/px\.collector\.example\.net\/tr ev=Lead/).length > leadsBlocked, 'the collector receives the send after undo', 10_000);
  evidence.facts.firewallFlow = { failedLeadRequests: failedLeads, ruleApplied: true, stopped: { deliveryState: stopped.deliveryState, transferClass: stopped.transferClass }, stoppedToday: { before: stoppedBefore, after: afterBlock.firewall.stoppedToday.count, countQuality: afterBlock.firewall.stoppedToday.countQuality }, undo: undone.applied };
  check('shop-a firewall (SW route of the card): «Этот сайт» + block -> repeat stopped (collector got nothing, stoppedToday ' + stoppedBefore + ' -> ' + afterBlock.firewall.stoppedToday.count + '), no new card -> undo -> next send reaches the collector');

  // 7. shop-b: the same e-mail -> evidence there, history row for example.net on two sites.
  const shopB = await context.newPage();
  await shopB.goto(urls.shopB);
  const tabB = await tabOf(urls.shopB);
  await shopB.locator('#email').click();
  await shopB.keyboard.type(EMAIL, { delay: 15 });
  await shopB.locator('#title').click();
  const typedB = await until(async () => (await transfers(tabB)).find((e) => e.receiver === 'example.net'), 'value-match evidence on shop-b', 25_000, 300);
  const badgeB = await until(async () => { const text = await moduleBadge(tabB); return text === '1' ? text : null; }, 'module badge «1» on shop-b', 10_000).catch(() => null);
  evidence.facts.shopB = { transferClass: typedB.transferClass, deliveryState: typedB.deliveryState, badge: await badgeInfo(tabB), moduleBadge: badgeB };
  assert.equal(badgeB, '1', 'module badge «1» on shop-b');
  // History rows carry the receiver and the number of sites, never the site names (ADR-020 §G).
  const row = await until(async () => {
    const answer = await send({ type: 'ui-protect-history-query', windowDays: 7, offset: 0, limit: 20 });
    return (answer?.history?.rows ?? []).find((r) => r.domains?.includes('example.net') && r.sites >= 2 && r.mechanisms?.some((m) => m.mechanism === 'value-match' && m.sites >= 2));
  }, 'history row: example.net on 2 sites by value-match', 20_000, 500);
  evidence.facts.history = row;
  check('shop-b: value-match evidence to example.net (' + typedB.transferClass + '), badge «1»; history «Кто узнаёт»: ' + row.rowKey + ' on ' + row.sites + ' sites (value-match)');

  // 8. GPC page: header of the navigation and of a fetch, and the property.
  const gpc = await context.newPage();
  await gpc.goto(urls.gpc);
  await gpc.waitForFunction(() => document.getElementById('fetch-header')?.dataset.value !== 'pending');
  const gpcValues = await gpc.evaluate(() => ({ nav: document.getElementById('nav-header').dataset.value, property: document.getElementById('property').dataset.value, fetch: document.getElementById('fetch-header').dataset.value }));
  evidence.facts.gpc = gpcValues;
  assert.deepEqual(gpcValues, { nav: '1', property: 'true', fetch: '1' });
  assert.ok(hits(/^\[GPC\] .* gpc\.example\.org\/ sec-gpc=1$/).length >= 1, 'stand log: navigation with Sec-GPC: 1');
  check('GPC page: navigation and fetch carried Sec-GPC: 1, navigator.globalPrivacyControl = true');

  // 9. Password page: the site sends the password itself; the module records nothing and shows no badge.
  const login = await context.newPage();
  await login.goto(urls.password);
  const tabP = await tabOf(urls.password);
  await login.locator('#password').click();
  await login.keyboard.type(PASSWORD, { delay: 15 });
  await login.locator('#title').click();
  await until(() => hits(/pw\.collect\.example\.org\/fsink\/pw/).length >= 1 && hits(/pw\.collect\.example\.org\/tr .*ключи=ph,pv/).length >= 1, 'password sent by the site');
  await sleep(2500);
  const pwEvidence = await transfers(tabP);
  const pwReport = await report(tabP);
  const pwBadge = await badgeInfo(tabP);
  evidence.facts.password = { evidence: pwEvidence.length, prompt: pwReport?.firewall?.prompt ?? null, badge: pwBadge, productionTechniques: await techniques(tabP) };
  assert.equal(pwEvidence.length, 0, 'no value-match evidence for a password');
  assert.equal(pwReport?.firewall?.prompt ?? null, null, 'no firewall prompt for a password');
  assert.notEqual(pwBadge.color, MODULE_BADGE_COLOR, 'no module badge on the password page');
  check('password page: the site sent the password and its hash (log), the module recorded no evidence and no prompt; badge ' + JSON.stringify(pwBadge) + ' is not the module badge (production techniques: ' + evidence.facts.password.productionTechniques.join(',') + ')');

  // 10. Recorder: the vendored recorder posts reach rec.example.net; the replay level is recorded as a fact.
  const recorder = await context.newPage();
  await recorder.goto(urls.recorder);
  const tabR = await tabOf(urls.recorder);
  await until(() => hits(/rec\.example\.net\/replay\/collect/).length >= 6, '6 recorder POSTs at rec.example.net', 20_000, 300);
  const replay = await until(async () => (await report(tabR))?.replay ?? null, 'replay summary in the report', 10_000, 300).catch(() => null);
  evidence.facts.replay = replay;
  check('recorder: 6 POSTs reached rec.example.net; replay level = ' + (replay?.level ?? 'none'));

  assert.deepEqual(evidence.unexpectedRequests, [], 'no request to a non-demo host');
  assert.deepEqual(evidence.pageErrors, []);
  check('no request left for a non-demo host; no page errors');
  await context.close();
  context = undefined;

  // 11. Optional: the installed Google Chrome started with the printed flags (headless, temporary profile, its own
  // DevTools port; not Playwright, whose default switches add --disable-extensions and turn HttpsUpgrades off).
  if (probeChrome && exe !== null && existsSync(exe)) {
    const profile = join(run, 'branded-profile');
    // The printed flags; only --load-extension points at the same copy as above, so the extension id can be compared.
    const flags = commandLine.slice(commandLine.indexOf(exe) + exe.length + 1).trim().split(/ (?=(?:[^"]*"[^"]*")*[^"]*$)/)
      .map((a) => a.replace(/^"|"$/g, '')).filter((a) => a.startsWith('--') && !a.startsWith('--user-data-dir='))
      .map((a) => (a.startsWith('--load-extension=') ? '--load-extension=' + extension : a));
    branded = spawn(exe, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, ...flags, 'about:blank'], { stdio: 'ignore' });
    const portFile = join(profile, 'DevToolsActivePort');
    const devPort = await until(() => existsSync(portFile) && readFileSync(portFile, 'utf8').split(/\r?\n/)[0].trim(), 'DevToolsActivePort of the installed Chrome', 20_000);
    const base = 'http://127.0.0.1:' + devPort;
    const json = async (path, init) => (await fetch(base + path, init)).json();
    const fact = { flags, version: (await json('/json/version')).Browser };
    await sleep(5000);
    fact.extensionTargets = (await json('/json/list')).filter((t) => String(t.url).startsWith('chrome-extension://')).map((t) => ({ type: t.type, ours: new URL(t.url).host === id, path: new URL(t.url).pathname }));
    fact.extensionLoaded = fact.extensionTargets.some((t) => t.ours && t.type === 'service_worker' && t.path === '/background.js');
    await json('/json/new?' + urls.shopA, { method: 'PUT' });
    await sleep(4000);
    const shop = (await json('/json/list')).find((t) => t.type === 'page' && String(t.url).includes('shop-a.example.com'));
    fact.shopA = shop === undefined ? null : { url: shop.url, title: shop.title };
    evidence.facts.brandedChrome = fact;
    console.log('  fact installed ' + fact.version + ' with the printed flags: extension loaded = ' + fact.extensionLoaded + '; shop-a = ' + JSON.stringify(fact.shopA));
  }
  evidence.result = 'PASS';
} catch (error) {
  evidence.result = 'FAIL';
  evidence.failure = String(error?.stack ?? error);
  evidence.standOutputTail = out.slice(-3000) + err.slice(-1000);
  process.exitCode = 1;
  console.error(evidence.failure);
} finally {
  await context?.close().catch(() => undefined);
  branded?.kill();
  evidence.standStillRunning = child.exitCode === null;
  child.kill();
  evidence.standLog = logLines().map((line) => line.replace(/^\[\S+\] \d\d:\d\d:\d\d /, ''));
  writeFileSync(join(run, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
}
console.log((evidence.result === 'PASS' ? 'PASS' : 'FAIL') + ': protect demo stand (' + evidence.checks.length + ' checks) -> ' + join(run, 'evidence.json'));
