// Service worker entry (spec A10, ADR-005 §6). Every listener is registered synchronously at the top level;
// hydration starts afterwards and handlers wait on the runtime's readiness promise (bounded pending buffer).
// The logic lives in @detect-expert/background; this file only wires chrome.* events to it.
//
// Engine port: the pure rules of @detect-expert/engine (canvas readback-after-text + generic api-use), fed with
// the document's counters and coverage flags only (spec Part VI I2: no chrome.*, no network, deterministic).
// The reducer bounds the result to BUDGETS.maxFindingsPerDocument and counts an exception as a degraded run.

import { createBackground } from '@detect-expert/background';
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

declare const __BUILD_PROFILE__: 'local' | 'test' | 'test-optional';
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

// Scope changes on the fly (A3, REQ-012): grant -> register, revoke -> unregister + stop + purge.
chrome.permissions.onAdded.addListener(background.navigation.onPermissionsAdded);
chrome.permissions.onRemoved.addListener(background.navigation.onPermissionsRemoved);

if (__BUILD_PROFILE__ === 'test' || __BUILD_PROFILE__ === 'test-optional') {
  // P05 / ADR-003: DevTools-only fallback, no message API or permission emulation.
  Object.assign(globalThis, { __p05: {
    async reconcilePermissions(origins: string[]) {
      if (origins.length === 0 || !await chrome.permissions.contains({ origins })) return false;
      await background.runtime.onPermissionsChanged();
      return true;
    },
  } });
}

chrome.runtime.onInstalled.addListener(() => {
  // Observation stays off until the user picks a scope (A3). Nothing is registered or requested here.
});

// Hydration after registration: restores snapshots/bindings/watermarks, reconciles with live frames,
// then reconciles content-script registrations with the persisted scope and granted permissions.
if (__BUILD_PROFILE__ === 'test') {
  // P02: privileged test harness only; eliminated from local builds. No message/wire API.
  const key = 'test:p02:time-offset';
  Object.assign(globalThis, { __p02: {
    advanceTime(ms: number) {
      if (!Number.isSafeInteger(ms) || ms < 0 || ms > 86_400_000) throw new Error('invalid-test-offset');
      testTimeOffset += ms;
    },
    diagnostics: () => background.runtime.diagnostics(),
  } });
  void chrome.storage.local.get(key).then((stored) => {
    const offset: unknown = stored[key];
    if (typeof offset === 'number' && Number.isSafeInteger(offset) && offset >= 0 && offset <= 86_400_000) testTimeOffset = offset;
  }).finally(async () => {
    // P07: delay hydration through DevTools in the test profile; listeners are already registered.
    const held = await chrome.storage.local.get('test:p07:hold-readiness');
    if (held['test:p07:hold-readiness'] === true) {
      await new Promise<void>((resolve) => {
        Object.assign(globalThis, { __p07ReleaseReadiness: resolve });
      });
    }
    return background.start();
  });
} else {
  void background.start();
}
