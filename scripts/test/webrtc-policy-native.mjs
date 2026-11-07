// Round 5: the Firefox-only WebRTC policy `proxy_only` through the real product path in a real browser.
//   Firefox  (--firefox)         installed Firefox through geckodriver: the policy is saved, applied, read back through the browser's own privacy API and the
//                                underlying preference, changes what an owned page can gather, and System restores the baseline.
//   Chrome   (default)           Playwright Chromium; `--installed-chrome` runs the branded Chrome instead. Chrome's own API rejects the value, the controller
//                                refuses it without a single set/clear, and the saved choice never reaches the browser setting.
// Default: the package is assembled from apps/production-extension (never stale); `--dist` tests the packaged dist/<browser> instead.
// `privacy` is optional in production; ONLY this disposable copy requires it so the real API can be exercised headlessly (production is unchanged).
// WEBRTC_POLICY_NATIVE_PATCH='{"file":...,"from":...,"to":...}' edits the staged temporary copy only (deliberate-breakage checks).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { archiveProduction, FIREFOX_ID } from '../build-production.mjs';
import { ROOT, fileHashes, stageExtension, writeEvidence } from './native-evidence.mjs';
import { installPersistentChromeExtension } from './api-custom-early-native.mjs';

const firefox = process.argv.includes('--firefox'), installed = process.argv.includes('--installed-chrome'), useDist = process.argv.includes('--dist');
const label = firefox ? 'firefox' : installed ? 'installed-chrome' : 'chrome';
mkdirSync(join(ROOT, '.tmp'), { recursive: true });
const run = mkdtempSync(join(ROOT, '.tmp/webrtc-policy-native-')), extension = join(run, 'extension');
const check = text => { evidence.checks.push(text); console.log('  ok ' + text); };
const evidence = { at: new Date().toISOString(), browser: null, label, result: 'RUNNING', mode: useDist ? 'dist/' + (firefox ? 'firefox' : 'chrome') : 'source assembly', checks: [], facts: {}, hashes: {}, limits: [
  'Only the browser-wide native setting is exercised; WebRTC Custom profiles, devices and addresses are covered by the other WebRTC natives.',
  firefox ? 'The candidate counts are the behaviour of this Firefox build with no proxy configured; a proxy that carries UDP is not exercised.' : 'The Chrome privacy API is measured, not assumed: the value is rejected by the browser itself and never written by the controller.'] };
let phase = 'staging';

// ---- the package under test ----------------------------------------------------------------------------------------
const staged = await stageExtension({ browser: firefox ? 'firefox' : 'chrome', target: extension, from: useDist ? 'dist' : 'source' });
evidence.packaging = staged.packaging;
const manifestPath = join(extension, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.ok(manifest.optional_permissions.includes('privacy') && !manifest.permissions.includes('privacy'), 'production keeps privacy optional');
manifest.optional_permissions = manifest.optional_permissions.filter(permission => permission !== 'privacy'); manifest.permissions.push('privacy');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
if (process.env.WEBRTC_POLICY_NATIVE_PATCH) {
  const { file, from, to } = JSON.parse(process.env.WEBRTC_POLICY_NATIVE_PATCH), target = join(extension, file), text = readFileSync(target, 'utf8');
  assert.equal(text.split(from).length - 1, 1, 'patch anchor must occur exactly once'); writeFileSync(target, text.replace(from, () => to));
}
evidence.hashes = fileHashes(extension, ['webrtc-network-controller.js', 'webrtc-configuration-ui.js', 'api-configuration-controller.js', 'api-configuration.js']);

const consent = { type: 'ui-data-consent-set', version: 1, accepted: true };
const configure = (state, policy, antidetectEnabled = true) => ({ type: 'ui-api-config-set', tabId: null, expectedRevision: state.revision, configuration: { ...state.configuration, enabled: false, antidetectEnabled, webrtcNetworkPolicy: policy } });

// ---- Chrome ----------------------------------------------------------------------------------------------------------
async function runChrome() {
  let context;
  try {
    const common = ['--no-proxy-server'];
    context = await chromium.launchPersistentContext(join(run, 'profile'), installed
      ? { executablePath: process.env.CHROME_BINARY ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 1100, height: 900 }, args: [...common, '--enable-unsafe-extension-debugging', '--disable-popup-blocking', '--window-position=-32000,-32000', '--window-size=1100,900', '--no-first-run'] }
      : { channel: 'chromium', headless: true, viewport: { width: 1100, height: 900 }, args: [...common, '--disable-extensions-except=' + extension, '--load-extension=' + extension] });
    evidence.browser = context.browser().version();
    const id = installed ? await installPersistentChromeExtension(context, extension, evidence) : new URL((context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')).url()).host;
    const ui = await context.newPage(); await ui.goto('chrome-extension://' + id + '/options.html');
    const send = message => ui.evaluate(message => chrome.runtime.sendMessage({ schemaVersion: 1, ...message }), message);
    const native = () => ui.evaluate(() => chrome.privacy.network.webRTCIPHandlingPolicy.get({}));
    const state = () => send({ type: 'ui-api-config-get', tabId: null });
    phase = 'baseline'; await send(consent);
    const baseline = await native(); assert.equal(baseline.levelOfControl, 'controllable_by_this_extension', 'nothing controls the setting before the test'); evidence.facts.baseline = baseline;

    phase = 'the browser itself rejects the value';
    const raw = await ui.evaluate(async () => {
      try { await chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: 'proxy_only', scope: 'regular' }); return { accepted: true }; }
      catch (error) { return { accepted: false, message: String(error?.message ?? error).slice(0, 300) }; }
    });
    assert.equal(raw.accepted, false, "Chrome's privacy API has no proxy_only value"); assert.deepEqual(await native(), baseline, 'a rejected write leaves the setting alone');
    evidence.facts.chromeRejection = raw.message;
    check("Chrome's own privacy API rejects proxy_only and the setting stays at its baseline (" + baseline.value + ')');

    phase = 'the controller refuses without writing';
    const controller = await ui.evaluate(async () => {
      const { WebRtcNetworkController } = await import(chrome.runtime.getURL('webrtc-network-controller.js'));
      const setting = chrome.privacy.network.webRTCIPHandlingPolicy, calls = [], originals = {};
      for (const name of ['set', 'clear']) { originals[name] = setting[name]; setting[name] = function (...args) { calls.push(name); return originals[name].apply(setting, args); }; }
      try {
        // The spy is proven before it is trusted: one System release goes through it.
        await new WebRtcNetworkController(chrome).reconcile('system'); const spyWorks = calls.length > 0; calls.length = 0;
        const fresh = new WebRtcNetworkController(chrome), state = await fresh.reconcile('proxy_only'), again = await fresh.inspect();
        return { spyWorks, state, again, calls: [...calls], supports: fresh.supports('proxy_only'), refusal: fresh.refusal('proxy_only'), shared: ['system', 'default_public_interface_only', 'disable_non_proxied_udp'].map(policy => fresh.refusal(policy)) };
      } finally { for (const name of ['set', 'clear']) setting[name] = originals[name]; }
    });
    assert.equal(controller.spyWorks, true, 'the call spy sees native calls'); assert.equal(controller.supports, false); assert.equal(controller.refusal, 'webrtc-policy-unsupported'); assert.deepEqual(controller.shared, [null, null, null]);
    assert.deepEqual(controller.calls, [], 'not a single set or clear reaches the browser'); assert.equal(controller.state.status, 'unsupported'); assert.equal(controller.again.status, 'unsupported'); assert.equal(controller.state.desired, 'proxy_only');
    assert.deepEqual(await native(), baseline);
    check('the real controller in real Chrome reports unsupported with the fixed refusal code and makes no set or clear call; the shared policies have no refusal');

    phase = 'saving the choice through the product path';
    const before = await state(); assert.equal(before.type, 'api-config-state');
    const saved = await send(configure(before, 'proxy_only'));
    let outcome;
    if (saved.type === 'api-config-error') { assert.equal(saved.code, 'webrtc-policy-unsupported', 'the save is refused with the fixed code'); outcome = 'refused:' + saved.code; }
    else { assert.equal(saved.type, 'api-config-state'); assert.equal(saved.webrtcNetwork.status, 'unsupported', 'a saved choice shows the unsupported state'); assert.equal(saved.webrtcNetwork.desired, 'proxy_only'); outcome = 'saved:unsupported'; }
    assert.deepEqual(await native(), baseline, 'whatever the save answers, the browser setting is untouched'); evidence.facts.saveOutcome = outcome;
    // Positive control on the same path: a shared policy is applied, read back and released.
    const base = await state(); const applied = await send(configure(base, 'disable_non_proxied_udp'));
    assert.equal(applied.type, 'api-config-state', JSON.stringify(applied)); assert.deepEqual([applied.webrtcNetwork.status, applied.webrtcNetwork.value], ['applied', 'disable_non_proxied_udp']);
    const owned = await native(); assert.deepEqual([owned.value, owned.levelOfControl], ['disable_non_proxied_udp', 'controlled_by_this_extension']);
    const released = await send(configure(await state(), 'system')); assert.equal(released.webrtcNetwork.status, 'inactive');
    const after = await native(); assert.equal(after.value, baseline.value); assert.notEqual(after.levelOfControl, 'controlled_by_this_extension');
    check('through ui-api-config-set the choice never reaches the browser (' + outcome + '), while disable_non_proxied_udp on the same path is applied, read back and released');
    evidence.result = 'PASS';
  } finally { await context?.close(); }
}

// ---- Firefox ---------------------------------------------------------------------------------------------------------
async function runFirefox() {
  const driverPath = process.env.GECKODRIVER_BINARY ?? join(ROOT, '.tmp/firefox/tools/geckodriver.exe'); assert.ok(existsSync(driverPath), 'geckodriver is cached under .tmp/firefox/tools');
  let binary = process.env.FIREFOX_BINARY;
  if (!binary && process.platform === 'win32') binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  assert.ok(binary && existsSync(binary), 'an installed Firefox is required; this test downloads nothing');
  const profile = join(run, 'profile'); mkdirSync(profile, { recursive: true });
  const uuid = randomUUID();
  const prefs = { 'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: uuid }), 'browser.shell.checkDefaultBrowser': false, 'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0, 'browser.newtabpage.enabled': false,
    'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.auto': false, 'network.proxy.type': 0, 'extensions.webextOptionalPermissionPrompts': false, 'media.peerconnection.ice.loopback': true };
  writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ', ' + JSON.stringify(value) + ');').join('\n'));
  const log = createWriteStream(join(run, 'geckodriver.log')), pause = ms => new Promise(done => setTimeout(done, ms));
  let endpoint, session, driver, driverError, page;
  const command = async (path, body, method = 'POST') => { const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(30000) }); const value = (await response.json()).value; if (!response.ok || value?.error) throw Error(JSON.stringify(value)); return value; };
  const wd = (path, body, method) => command('/session/' + session + path, body, method), script = (source, args = []) => wd('/execute/sync', { script: source, args }), asyncScript = (source, args = []) => wd('/execute/async', { script: source, args });
  const send = message => asyncScript('const done=arguments[arguments.length-1];browser.runtime.sendMessage(arguments[0]).then(done,e=>done({error:String(e)}));', [{ schemaVersion: 1, ...message }]);
  const state = () => send({ type: 'ui-api-config-get', tabId: null });
  const native = () => asyncScript('const done=arguments[arguments.length-1];browser.privacy.network.webRTCIPHandlingPolicy.get({}).then(done,e=>done({error:String(e)}));');
  // The preference behind the policy, read in the privileged context so the extension API is not the only witness.
  const preference = async name => { await wd('/moz/context', { context: 'chrome' }); try { return await script('return Services.prefs.getBoolPref(arguments[0], false);', [name]); } finally { await wd('/moz/context', { context: 'content' }); } };
  const readPrefs = async () => ({ proxyOnly: await preference('media.peerconnection.ice.proxy_only'), proxyOnlyIfBehindProxy: await preference('media.peerconnection.ice.proxy_only_if_behind_proxy'), noHost: await preference('media.peerconnection.ice.no_host') });
  let origin, probeServer;
  async function startProbePage() {
    probeServer = createServer((request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      // Runs in the page itself; the result is read back by WebDriver. No external server is configured, so only local candidates can appear.
      response.end('<!doctype html><meta charset="utf-8"><title>Owned gather probe</title><script>(async()=>{const pc=new RTCPeerConnection({iceServers:[]}),found=[];pc.createDataChannel("probe");const done=new Promise(resolve=>{const timer=setTimeout(resolve,6000);pc.onicecandidate=event=>{if(event.candidate){if(event.candidate.candidate)found.push(event.candidate.type||"unknown");}else{clearTimeout(timer);resolve();}};});await pc.setLocalDescription(await pc.createOffer());await done;window.__gather={candidates:found.length,types:[...new Set(found)],gathering:pc.iceGatheringState};pc.close();})().catch(error=>{window.__gather={error:String(error)};});</script>');
    });
    await new Promise(done => probeServer.listen(0, '127.0.0.1', done)); origin = 'http://127.0.0.1:' + probeServer.address().port;
  }
  async function gather(handleUi) {
    const tab = (await wd('/window/new', { type: 'tab' })).handle; await wd('/window', { handle: tab }); await wd('/url', { url: origin + '/probe?' + Date.now() });
    for (let n = 0; n < 150; n++) { const value = await script('return window.__gather||null;'); if (value) { await wd('/window', undefined, 'DELETE'); await wd('/window', { handle: handleUi }); return value; } await pause(100); }
    throw Error('the gather probe did not finish');
  }
  try {
    const reservation = createServer(); await new Promise(done => reservation.listen(0, '127.0.0.1', done)); const port = reservation.address().port; await new Promise(done => reservation.close(done)); endpoint = 'http://127.0.0.1:' + port;
    const bidiReservation = createServer(); await new Promise(done => bidiReservation.listen(0, '127.0.0.1', done)); const bidiPort = bidiReservation.address().port; await new Promise(done => bidiReservation.close(done));
    driver = spawn(driverPath, ['--host', '127.0.0.1', '--port', String(port), '--websocket-port', String(bidiPort), '--profile-root', run, '--log', 'error', '--allow-system-access'], { cwd: ROOT, windowsHide: true }); driver.once('error', error => { driverError = error; }); driver.stdout.pipe(log); driver.stderr.pipe(log);
    for (let n = 0; n < 80; n++) { if (driverError) throw driverError; try { await command('/status', undefined, 'GET'); break; } catch { await pause(100); } }
    const opened = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } }); session = opened.sessionId; evidence.browser = opened.capabilities.browserVersion;
    await startProbePage();
    const archive = join(run, 'webrtc-policy.xpi'); writeFileSync(archive, archiveProduction(extension)); assert.equal(await wd('/moz/addon/install', { path: archive, temporary: true }), FIREFOX_ID);
    await wd('/url', { url: 'moz-extension://' + uuid + '/options.html' }); page = await wd('/window', undefined, 'GET');
    await until(async () => (await state())?.type === 'api-config-state');
    async function until(test, attempts = 100) { for (let n = 0; n < attempts; n++) { if (await test()) return; await pause(60); } throw Error('Firefox condition timed out'); }
    phase = 'baseline'; assert.equal((await send(consent))?.error, undefined);
    const baseline = await native(); assert.equal(baseline.error, undefined); assert.equal(baseline.levelOfControl, 'controllable_by_this_extension', 'nothing controls the setting before the test'); evidence.facts.baseline = baseline;
    const basePrefs = await readPrefs(); assert.equal(basePrefs.proxyOnly, false); evidence.facts.baselinePreferences = basePrefs;
    const baseGather = await gather(page); assert.equal(baseGather.error, undefined); assert.ok(baseGather.candidates > 0, 'the owned page gathers local candidates at the baseline'); evidence.facts.baselineGather = baseGather;

    phase = 'proxy_only saved and applied';
    const before = await state(); assert.equal(before.type, 'api-config-state');
    const saved = await send(configure(before, 'proxy_only'));
    assert.equal(saved.type, 'api-config-state', JSON.stringify(saved)); assert.equal(saved.configuration.webrtcNetworkPolicy, 'proxy_only');
    assert.deepEqual(saved.webrtcNetwork, { desired: 'proxy_only', status: 'applied', value: 'proxy_only', levelOfControl: 'controlled_by_this_extension' });
    const read = await native(); assert.deepEqual([read.value, read.levelOfControl], ['proxy_only', 'controlled_by_this_extension'], "Firefox's own privacy API reports the exact value and our ownership");
    const appliedPrefs = await readPrefs(); assert.equal(appliedPrefs.proxyOnly, true, 'the underlying preference is set'); evidence.facts.appliedPreferences = appliedPrefs;
    check('the choice is saved through ui-api-config-set, applied by the real controller and read back from Firefox as proxy_only controlled by this extension; media.peerconnection.ice.proxy_only is true');

    phase = 'behaviour';
    const proxied = await gather(page); assert.equal(proxied.error, undefined); evidence.facts.proxyOnlyGather = proxied;
    assert.equal(proxied.candidates, 0, 'with no proxy configured, proxy_only leaves the page without a single ICE candidate (WebRTC calls cannot connect)');
    check('the honest warning is real: with proxy_only and no proxy, an owned page gathers ' + proxied.candidates + ' ICE candidates instead of ' + baseGather.candidates);

    phase = 'restart of the application state';
    const again = await send(configure(await state(), 'proxy_only')); assert.equal(again.webrtcNetwork.status, 'applied');
    assert.deepEqual(await native(), read, 'saving the same choice again leaves the owned setting as it is');

    phase = 'released';
    const released = await send(configure(await state(), 'system'));
    assert.equal(released.type, 'api-config-state'); assert.equal(released.webrtcNetwork.status, 'inactive');
    const after = await native(); assert.equal(after.value, baseline.value); assert.notEqual(after.levelOfControl, 'controlled_by_this_extension');
    const releasedPrefs = await readPrefs(); assert.deepEqual(releasedPrefs, basePrefs, 'every preference is back to its baseline');
    const restored = await gather(page); assert.ok(restored.candidates > 0, 'WebRTC works again after System'); evidence.facts.restoredGather = restored;
    check('System releases only our layer: the browser value, ownership and the preferences return to the baseline and the page gathers ' + restored.candidates + ' candidates again');

    phase = 'neighbouring policies';
    for (const policy of ['default_public_interface_only', 'disable_non_proxied_udp', 'proxy_only', 'disable_non_proxied_udp', 'system']) {
      const result = await send(configure(await state(), policy)); assert.equal(result.type, 'api-config-state', policy);
      const now = await native();
      if (policy === 'system') { assert.equal(now.value, baseline.value); assert.notEqual(now.levelOfControl, 'controlled_by_this_extension'); }
      else { assert.deepEqual([result.webrtcNetwork.status, now.value, now.levelOfControl], ['applied', policy, 'controlled_by_this_extension'], policy); assert.equal((await preference('media.peerconnection.ice.proxy_only')), policy === 'proxy_only', policy); }
    }
    assert.deepEqual(await readPrefs(), basePrefs);
    check('moving between the shared policies and proxy_only rewrites one layer each time and the last System restores every preference');
    evidence.result = 'PASS';
  } finally {
    if (session) try { await command('/session/' + session, undefined, 'DELETE'); } catch { /* the session may already be gone */ }
    driver?.kill(); log.end(); probeServer?.closeAllConnections(); if (probeServer?.listening) await new Promise(done => probeServer.close(done));
  }
}

try {
  if (firefox) await runFirefox(); else await runChrome();
  console.log('PASS: ' + label + ' ' + evidence.browser);
} catch (error) {
  evidence.result = 'FAIL'; evidence.failure = { phase, message: String(error.stack ?? error).replace(/https?:\/\/\S+/g, '[owned URL]').slice(0, 2400) }; console.error(evidence.failure); process.exitCode = 1;
} finally {
  const path = writeEvidence('webrtc-policy/webrtc-policy-' + label + '.json', evidence); console.log(evidence.result + ': ' + path);
  if (evidence.result === 'PASS') rmSync(run, { recursive: true, force: true });
}
