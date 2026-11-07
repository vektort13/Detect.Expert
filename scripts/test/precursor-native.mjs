// DET-CF-PRECURSOR-001 / ADR-074: unchanged packaged code, owned fresh profiles.
// Ordinary Luma navigation only: no challenge interaction, token/cookie/body reads,
// request interception, observer replacement, or installed-user-profile access.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';

const root = resolve(import.meta.dirname, '../..');
const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const browser = argument('--browser') ?? 'chrome';
assert.ok(['chrome', 'firefox'].includes(browser), '--browser must be chrome or firefox');
const input = resolve(argument('--dist') ?? join(root, 'dist', browser));
const output = resolve(argument('--output') ?? join(root, 'test-results/production-1.1.0/precursor', browser + '.json'));
mkdirSync(join(root, '.tmp'), { recursive: true });
mkdirSync(dirname(output), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/precursor-native-' + browser + '-'));
const extension = join(run, 'extension');
cpSync(input, extension, { recursive: true });
const files = ['manifest.json', 'background.js', 'bridge.js', 'precursor-contracts.js', 'precursor-observer.js', 'precursor-timing.js', 'precursor-ui.js', 'precursor-ui.css', 'precursor-zone-ui.js', 'precursor-modes-contracts.js', 'popup.js', 'sidepanel.js'];
const evidence = { at: new Date().toISOString(), browser, input, run, result: 'RUNNING',
  scope: 'public ordinary navigation and privileged extension UI in owned profiles',
  rawDataPersisted: false, checks: [], limitations: [], states: [], layouts: [], screenshots: [],
  hashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
const { readPrecursorSnapshot } = await import(pathToFileURL(join(extension, 'precursor-contracts.js')).href);
let opened, sourceTabId = null, phase = 'startup';
const evaluate = (fn, value) => opened.evaluate(fn, value);
const send = message => evaluate(message => (globalThis.browser ?? globalThis.chrome).runtime.sendMessage({ schemaVersion: 1, ...message }), message);
const check = label => { evidence.checks.push(label); console.log('  ok ' + label); };
const limit = label => { if (!evidence.limitations.includes(label)) evidence.limitations.push(label); console.log('  limited ' + label); };
const requestFor = report => ({ type: 'ui-get-precursor', tabId: sourceTabId, frameId: 0, documentKey: report.documentKey });
const getReport = async () => {
  const reply = await send({ type: 'ui-get-report', tabId: sourceTabId, frameId: 0 });
  assert.equal(reply.type, 'report', 'native report route');
  return reply.report;
};
function validateState(reply, request, label) {
  const state = readPrecursorSnapshot(reply);
  assert.ok(state, label + ': strict delivered snapshot contract');
  assert.equal(state.documentKey, request.documentKey, label + ': exact document');
  assert.equal(state.mode, 'unknown', label + ': no inferred mode');
  assert.equal(state.capabilities.modeDetection, false, label + ': unavailable mode capability');
  return state;
}
const stateFor = async (report, label) => { const request = requestFor(report); return validateState(await send(request), request, label); };
function recordState(label, state) {
  evidence.states.push({ label, coverageState: state.coverageState, presence: state.presence, mode: state.mode,
    capabilities: state.capabilities, evidenceSource: state.evidenceSource, integrity: state.integrity,
    ruleIds: state.ruleIds, hasObservationTime: state.lastObservedAt !== null, truncated: state.truncated });
}
async function unavailable(request, label) {
  const reply = await send(request);
  if (reply?.type === 'error') {
    assert.equal(reply.code, 'no-access', label + ': access error');
    evidence.states.push({ label, type: 'error', code: 'no-access' });
    return;
  }
  const state = validateState(reply, request, label);
  assert.equal(state.presence, 'not-observed', label + ': no stale positive');
  assert.equal(state.capabilities.presenceDetection, false, label + ': capability unavailable');
  recordState(label, state);
}
async function consent(accepted) {
  const current = await send({ type: 'ui-data-consent-get' });
  assert.equal(current.type, 'data-consent-state', 'existing consent state is readable');
  // Current production initializes a fresh owned profile with consent accepted.
  // Do not wait for an enable button when the actual UI is already enabled.
  if (current.accepted === accepted) return;
  const selector = '[data-action="' + (accepted ? 'accept-data-consent' : 'revoke-data-consent') + '"]';
  await until(() => evaluate(selector => Boolean(document.querySelector(selector)), selector), 'consent control');
  const collapsed = await evaluate(selector => document.querySelector(selector)?.closest('details')?.open === false, selector);
  if (collapsed) await opened.click('details:has(' + selector + ') > summary');
  await opened.click(selector);
  await until(async () => (await send({ type: 'ui-data-consent-get' })).accepted === accepted, 'consent saved through UI');
}
async function scope(mode) {
  await opened.click('#options-scope-' + mode);
  await opened.click('form.scope:has(#options-scope-' + mode + ') button[type="submit"]');
  await until(async () => (await send({ type: 'ui-get-scope' })).scope?.scopeMode === mode, 'scope saved through UI');
}
async function command(type) {
  const current = await getReport();
  assert.ok(current, type + ': current report');
  const response = await send({ type, tabId: sourceTabId, documentKey: current.documentKey, reportRevision: current.reportRevision });
  assert.equal(response.type, 'ok', type + ': native control acknowledged');
  return current;
}
async function observePublic(label, previousKey = null, navigationRetries = 0) {
  assert.ok(navigationRetries < 3, label + ': bounded public navigation changes');
  const report = await until(async () => { const current = await getReport(); return current && current.documentKey !== previousKey ? current : null; }, label + ': source report', 30000);
  let state = await stateFor(report, label);
  const deadline = Date.now() + 18000;
  while (Date.now() < deadline && state.presence !== 'observed' && state.capabilities.presenceDetection) {
    await pause(400);
    const current = await getReport();
    if (current?.documentKey !== report.documentKey) return observePublic(label, report.documentKey, navigationRetries + 1);
    state = await stateFor(report, label);
  }
  const diagnostics = await evaluate(documentId => {
    const audit = globalThis.__precursorNativeAudit;
    const rows = audit?.completions ?? [];
    return { matchingCompletions: rows.length, matchingDocumentCompletions: rows.filter(row => row.documentId === documentId && row.frameId === 0).length,
      nativeIdentityCompletions: rows.filter(row => row.nativeIdentity).length,
      matchingDocumentEligibleCompletions: rows.filter(row => row.documentId === documentId && row.frameId === 0 && row.eligible).length,
      dropped: audit?.dropped ?? 0, subscriptionAvailable: audit?.subscribed === true };
  }, report.documentKey.split(':')[2]);
  evidence.states.push({ label: label + '-independent-native-metadata', ...diagnostics });
  if (browser === 'firefox') {
    assert.equal(state.capabilities.presenceDetection, true, 'Firefox exact-document timing support');
    assert.equal(state.coverageState, 'partial', 'Firefox explicit timing coverage');
    if (state.presence === 'observed') { assert.equal(state.evidenceSource, 'browser-resource-timing'); assert.equal(state.integrity, 'browser-observed'); }
  } else if (state.presence === 'observed') {
    assert.equal(state.evidenceSource, 'browser-network');
    assert.equal(state.integrity, 'browser-observed');
    assert.ok(state.ruleIds.length > 0);
  } else limit(label + (diagnostics.matchingDocumentEligibleCompletions > 0 ? ': native-resource-not-reflected-review-required' : ': live-resource-not-observed-in-window'));
  recordState(label, state);
  return { report, state };
}
async function uiLayout(surface, locale, width, expectedPresence) {
  phase = 'localized UI: ' + surface + ' ' + locale + ' viewport';
  await evaluate(locale => (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-language-v1': locale }), locale);
  // Gecko may defer viewport metrics for an inactive tab. Resize the actual
  // owned UI tab while visible, then restore the source before mounting a UI.
  await evaluate(async () => {
    const api = globalThis.browser ?? globalThis.chrome;
    const tab = await api.tabs.getCurrent();
    await api.tabs.update(tab.id, { active: true });
  });
  await until(() => evaluate(() => document.visibilityState === 'visible'), surface + ': owned UI visible for resize');
  await opened.viewport(width, 900);
  // A real popup opens over an already selected web tab. Match that ordering:
  // popup does not watch tab activation and stops polling while its test tab is
  // hidden, so changing the active tab after mounting can strand an own-UI state.
  await evaluate(tabId => (globalThis.browser ?? globalThis.chrome).tabs.update(tabId, { active: true }), sourceTabId);
  await opened.goto(opened.base + surface + '.html');
  phase = 'localized UI: ' + surface + ' ' + locale + ' exact source';
  await until(() => evaluate(async ({ tabId, firefox, expectedPresence }) => {
    const api = globalThis.browser ?? globalThis.chrome;
    const active = (await api.tabs.query({ active: true, currentWindow: true }))[0];
    const panel = document.querySelector('[data-precursor-panel]');
    return active?.id === tabId && document.querySelector('.inspector-site')?.textContent.includes('luma.com') &&
      panel?.getAttribute('data-precursor-status') === 'ready' &&
      (firefox || expectedPresence !== 'observed' || panel.getAttribute('data-precursor-presence') === 'observed');
  }, { tabId: sourceTabId, firefox: browser === 'firefox', expectedPresence }), surface + ': exact selected source state', 25000);
  const layout = await evaluate(() => {
    const panels = [...document.querySelectorAll('[data-precursor-panel]')], panel = panels[0];
    return { panelCount: panels.length, status: panel?.getAttribute('data-precursor-status'), presence: panel?.getAttribute('data-precursor-presence'),
      mode: panel?.getAttribute('data-precursor-mode'), coverage: panel?.querySelector('[data-precursor-coverage]')?.getAttribute('data-precursor-coverage'), visible: Boolean(panel?.getClientRects().length), dir: document.documentElement.dir,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      untranslated: /precursor_[a-z_]+/.test(panel?.textContent ?? ''),
      labelsPresent: Boolean(panel?.querySelector('[data-precursor-presence-label]')?.textContent.trim() && panel?.querySelector('[data-precursor-mode-label]')?.textContent.trim()),
      width: innerWidth };
  });
  assert.equal(layout.panelCount, 1, surface + ': one selected-document panel');
  assert.equal(layout.mode, 'unknown');
  assert.equal(layout.untranslated, false);
  assert.equal(layout.labelsPresent, true);
  assert.equal(layout.visible, true);
  assert.equal(layout.overflow, false);
  if (locale === 'ar') assert.equal(layout.dir, 'rtl');
  if (browser === 'chrome' && expectedPresence === 'observed') assert.equal(layout.presence, 'observed', surface + ': selected source evidence');
  if (browser === 'firefox') { assert.equal(layout.status, 'ready'); assert.equal(layout.coverage, 'partial'); if (expectedPresence === 'observed') assert.equal(layout.presence, 'observed'); }
  evidence.layouts.push({ surface, locale, ...layout });
  await evaluate(() => document.querySelector('[data-precursor-panel]').scrollIntoView({ block: 'center' }));
  const screenshot = join(dirname(output), browser + '-' + surface + '-' + locale + '.png');
  await opened.screenshot(screenshot);
  evidence.screenshots.push({ file: screenshot, sha256: createHash('sha256').update(readFileSync(screenshot)).digest('hex') });
}

try {
  phase = 'startup: launch owned browser';
  opened = await launchOwnedManagement({ root, run, extension, browser, evidence, dark: browser === 'firefox' });
  evidence.version = opened.version;
  phase = 'startup: Options shell';
  await opened.goto(opened.base + 'options.html#settings');
  await until(() => evaluate(() => Boolean(document.querySelector('[data-management-shell]'))), 'owned Options ready');
  phase = 'startup: consent control';
  await consent(true);
  phase = 'startup: scope control';
  await scope('all-sites');
  check('existing consent and scope controls enable observation in the owned profile');

  // Independent native observation in the test's privileged UI context, not a
  // replacement for production callbacks. Only bounded enum/count diagnostics
  // leave this context; request URLs and header values never enter artifacts.
  await evaluate(() => {
    const api = globalThis.browser ?? globalThis.chrome;
    const audit = globalThis.__precursorNativeAudit = { completions: [], dropped: 0, subscribed: false };
    try {
      api.webRequest.onCompleted.addListener(details => {
        let url;
        try { url = new URL(details.url); } catch { return; }
        if (url.origin !== 'https://luma.com' || !/^\/cdn-cgi\/challenge-platform\/h\/g\/scripts\/precursor\/[0-9a-f]{12}\/main\.js$/.test(url.pathname)) return;
        if (audit.completions.length >= 16) { audit.dropped++; return; }
        let javascript = false, sameOrigin = false;
        for (const header of details.responseHeaders ?? []) if (header.name.toLowerCase() === 'content-type') javascript = /^(?:application|text)\/javascript(?:\s*;|$)/i.test(header.value ?? '');
        try { sameOrigin = new URL(details.initiator).origin === url.origin; } catch {}
        const nativeIdentity = typeof details.documentId === 'string';
        audit.completions.push({ documentId: nativeIdentity ? details.documentId : null, frameId: details.frameId,
          nativeIdentity, eligible: nativeIdentity && details.documentLifecycle === 'active' && sameOrigin && javascript && (details.statusCode >= 200 && details.statusCode <= 299 || details.statusCode === 304) });
      }, { urls: ['https://luma.com/*'], types: ['script'] }, ['responseHeaders']);
      audit.subscribed = true;
    } catch {}
  });
  phase = 'live public document';
  sourceTabId = await evaluate(async () => (await (globalThis.browser ?? globalThis.chrome).tabs.create({ url: 'https://luma.com/', active: false })).id);
  const initial = await observePublic('initial');
  check(browser === 'chrome' ? 'live result retains exact-document network provenance and unknown mode' : 'Firefox reports exact-document timing coverage and unknown mode');

  phase = 'privileged channel validation';
  const valid = requestFor(initial.report);
  for (const malformed of [{ ...valid, mode: 'arm' }, { ...valid, frameId: 1 }, { ...valid, documentKey: 'invalid' }]) {
    const rejected = await send(malformed);
    assert.equal(rejected.type, 'error');
    assert.equal(rejected.code, 'invalid-request');
  }
  const pageReply = await evaluate(async ({ tabId, request }) => {
    const api = globalThis.browser ?? globalThis.chrome;
    const result = await api.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', args: [{ schemaVersion: 1, ...request }],
      func: async request => { const answer = await (globalThis.browser ?? globalThis.chrome).runtime.sendMessage(request); return { type: answer?.type ?? null, code: answer?.code ?? null }; } });
    return result[0]?.result;
  }, { tabId: sourceTabId, request: valid });
  assert.deepEqual(pageReply, { type: 'error', code: 'unauthorized-sender' });
  await evaluate(async ({ tabId, request }) => {
    await (globalThis.browser ?? globalThis.chrome).scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'MAIN', args: [request],
      func: request => { window.postMessage({ ...request, type: 'ui-set-precursor', mode: 'arm' }, location.origin); } });
  }, { tabId: sourceTabId, request: valid });
  assert.equal((await stateFor(initial.report, 'after page message')).mode, 'unknown');
  check('malformed mode writes and native page senders are rejected; MAIN messages cannot set a mode');

  phase = 'pause clear scope and consent';
  await command('ui-pause');
  const pausedReport = await getReport();
  const paused = await stateFor(pausedReport, 'paused');
  assert.equal(paused.coverageState, 'paused'); assert.equal(paused.presence, 'not-observed');
  recordState('paused', paused);
  await command('ui-clear');
  const cleared = await stateFor(await getReport(), 'cleared while paused');
  assert.equal(cleared.presence, 'not-observed'); assert.equal(cleared.coverageState, 'paused');
  recordState('cleared while paused', cleared);
  await command('ui-resume');
  await scope('off');
  await unavailable(valid, 'scope-off');
  await consent(false);
  await unavailable(valid, 'consent-revoked');
  check('pause, clear, scope OFF and consent revocation remove evidence without inferring Precursor Off');

  phase = 'restore and navigation';
  await consent(true);
  await scope('all-sites');
  await evaluate(tabId => (globalThis.browser ?? globalThis.chrome).tabs.reload(tabId), sourceTabId);
  const restored = await observePublic('restored-after-reload', initial.report.documentKey);
  await unavailable(valid, 'old-document-after-navigation');
  check('restoring access reloads into a new exact document; stale document queries cannot revive old evidence');

  phase = 'localized selected-document UI';
  await uiLayout('popup', 'ru', 580, restored.state.presence);
  await uiLayout('sidepanel', 'ar', 340, restored.state.presence);
  check('popup and sidebar show one selected-document Precursor panel with localized unknown mode and bounded layout');

  phase = 'source closed';
  const finalRequest = requestFor(restored.report);
  await evaluate(tabId => (globalThis.browser ?? globalThis.chrome).tabs.remove(tabId), sourceTabId);
  sourceTabId = null;
  await unavailable(finalRequest, 'source-closed');
  check('closed source has no stale presence or invented mode');
  evidence.result = evidence.limitations.length ? 'LIMITED' : 'PASS';
} catch (error) {
  evidence.result = 'FAIL'; evidence.phase = phase; evidence.errorName = error.name;
  evidence.errorMessage = String(error.message ?? '').replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/gi, '[url]')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[identifier]').slice(0, 500);
  if (error.name === 'AssertionError') evidence.assertion = error.message.split('\n')[0].slice(0, 160);
  if (opened) try {
    evidence.uiDiagnostic = await evaluate(async () => {
      const api = globalThis.browser ?? globalThis.chrome;
      const consent = await api.runtime.sendMessage({ schemaVersion: 1, type: 'ui-data-consent-get' });
      const scope = await api.runtime.sendMessage({ schemaVersion: 1, type: 'ui-get-scope' });
      return { readyState: document.readyState, managementShell: Boolean(document.querySelector('[data-management-shell]')),
        consentAccepted: consent?.accepted === true, scopeMode: scope?.scope?.scopeMode ?? null,
        acceptButtons: document.querySelectorAll('[data-action="accept-data-consent"]').length,
        revokeButtons: document.querySelectorAll('[data-action="revoke-data-consent"]').length,
        precursorPanels: document.querySelectorAll('[data-precursor-panel]').length };
    });
  } catch {}
  console.error('Precursor native failure in ' + phase + ': ' + error.name + ': ' + evidence.errorMessage);
  process.exitCode = 1;
} finally {
  if (opened) await opened.close();
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
}
console.log('Precursor native ' + browser + ': ' + evidence.result + ', ' + evidence.checks.length + ' checks, ' + evidence.limitations.length + ' limitations');
