// Service worker entry (spec A10, ADR-005 §6). Every listener is registered synchronously at the top level;
// hydration starts afterwards and handlers wait on the runtime's readiness promise (bounded pending buffer).
// The logic lives in @detect-expert/background; this file only wires chrome.* events to it.
//
// Engine port: the pure rules of @detect-expert/engine (canvas readback-after-text + generic api-use), fed with
// the document's counters and coverage flags only (spec Part VI I2: no chrome.*, no network, deterministic).
// The reducer bounds the result to BUDGETS.maxFindingsPerDocument and counts an exception as a degraded run.

import { createBackground, GOOGLE_IDS_FILTER, PRO_NETWORK_FILTER } from '@detect-expert/background';
import type { EnginePort } from '@detect-expert/background';
import { coverageRef, runRules } from '@detect-expert/engine';

const engine: EnginePort = {
  deriveFindings(report) {
    return runRules({
      counters: report.counters,
      coverageFlags: report.coverageFlags,
      coverageRef: coverageRef(report.coverageState, report.coverageFlags),
    }).findings;
  },
};

declare const __BUILD_PROFILE__: 'local' | 'test';
let testTimeOffset = 0;
const background = createBackground(chrome, { engine, testBootstrap: __BUILD_PROFILE__ === 'test',
  ...(__BUILD_PROFILE__ === 'test' ? { clock: { now: () => Date.now() + testTimeOffset } } : {}),
});

// Content channel (PageBatch -> Ack) and privileged UI channel (ui-* -> UiResponse), split by MessageSender.
// Portable contract (Chrome 119..148+): synchronous listener, literal `return true`, then sendResponse.
chrome.runtime.onMessage.addListener(background.onMessage);

// Document model (A7): every document separately; pending/committed navigation, BFCache, prerender, SPA, iframes.
chrome.webNavigation.onBeforeNavigate.addListener(background.navigation.onBeforeNavigate);
chrome.webNavigation.onCommitted.addListener(background.navigation.onCommitted);
chrome.webNavigation.onErrorOccurred.addListener(background.navigation.onErrorOccurred);
chrome.webNavigation.onHistoryStateUpdated.addListener(background.navigation.onHistoryStateUpdated);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(background.navigation.onReferenceFragmentUpdated);
chrome.webNavigation.onCompleted.addListener(background.navigation.onCompleted);
chrome.tabs.onRemoved.addListener(background.navigation.onTabRemoved);
chrome.tabs.onReplaced.addListener(background.navigation.onTabReplaced);

// Minimal network observer (A9): host only, script/xmlhttprequest/sub_frame/other on http(s).
chrome.webRequest.onCompleted.addListener(background.network.onCompleted, background.network.filter);
chrome.webRequest.onCompleted.addListener(background.network.onResponseCompleted, background.network.responseHeadersFilter, ['responseHeaders']);
chrome.webRequest.onBeforeRequest.addListener(details => {
  background.runtime.responseHeaders.onBeforeRequest(details);
  background.runtime.googleIds.onBeforeRequest(details);
},
  { urls: ['http://*/*', 'https://*/*'], types: ['main_frame', 'sub_frame'] });
try {
  chrome.webRequest.onSendHeaders.addListener(background.runtime.googleIds.onSendHeaders, GOOGLE_IDS_FILTER, ['requestHeaders', 'extraHeaders']);
  background.runtime.googleIds.setSupported(true);
} catch { background.runtime.googleIds.setSupported(false); }
// ADR-025: record browser attempts before handshake success/failure, including blob-worker requests.
chrome.webRequest.onBeforeRequest.addListener(background.network.onBeforeRequest, background.network.attemptFilter);
// Pro records only after the explicit UI action. Browser lifecycle events capture even brief requests.
chrome.webRequest.onBeforeRequest.addListener(details => { background.runtime.pro.onRequest(details, 'before'); }, PRO_NETWORK_FILTER);
chrome.webRequest.onCompleted.addListener(details => background.runtime.pro.onRequest(details, 'completed'), PRO_NETWORK_FILTER);
chrome.webRequest.onBeforeRedirect.addListener(details => background.runtime.pro.onRequest(details, 'redirect'), PRO_NETWORK_FILTER);
chrome.webRequest.onErrorOccurred.addListener(details => background.runtime.pro.onRequest(details, 'error'), PRO_NETWORK_FILTER);
chrome.tabs.onCreated.addListener(tab => background.runtime.pro.onTabCreated(tab));
chrome.tabs.onUpdated.addListener((tabId, _change, tab) => background.runtime.pro.onTabUpdated(tabId, tab));
chrome.alarms.onAlarm.addListener(alarm => background.runtime.pro.onAlarm(alarm.name));

// Scope changes on the fly (A3, REQ-012): grant -> register, revoke -> unregister + stop + purge.
chrome.permissions.onAdded.addListener(background.navigation.onPermissionsAdded);
chrome.permissions.onRemoved.addListener(background.navigation.onPermissionsRemoved);

chrome.runtime.onInstalled.addListener(() => {
  // Observation stays off until the user picks a scope (A3). Nothing is registered or requested here.
});

// Hydration after registration: restores snapshots/bindings/watermarks, reconciles with live frames,
// then reconciles content-script registrations with the persisted scope and granted permissions.
if (__BUILD_PROFILE__ === 'test') {
  // P02: privileged test harness only; eliminated from local builds. No message/wire API.
  const key = 'test:p02:time-offset';
  const startKey = 'test:p07:hold-start';
  let releaseStart: () => void = () => undefined;
  const startBarrier = new Promise<void>((resolve) => { releaseStart = resolve; });
  Object.assign(globalThis, { __p07: {
    releaseStart,
    consentLoaded: () => background.runtime.scope.dataConsentLoaded,
    diagnostics: () => background.runtime.diagnostics(),
  } });
  Object.assign(globalThis, { __p02: {
    advanceTime(ms: number) {
      if (!Number.isSafeInteger(ms) || ms < 0 || ms > 86_400_000) throw new Error('invalid-test-offset');
      testTimeOffset += ms;
    },
    diagnostics: () => background.runtime.diagnostics(),
  } });
  void chrome.storage.local.get([key, startKey]).then(async (stored) => {
    await background.runtime.scope.load();
    const offset: unknown = stored[key];
    if (typeof offset === 'number' && Number.isSafeInteger(offset) && offset >= 0 && offset <= 86_400_000) testTimeOffset = offset;
    if (stored[startKey] === true) {
      // Bound a forgotten test latch; ordinary builds cannot load this branch or key.
      const timeout = setTimeout(releaseStart, 30_000);
      await startBarrier;
      clearTimeout(timeout);
    }
  }).finally(() => background.start());
} else {
  void background.start();
}
