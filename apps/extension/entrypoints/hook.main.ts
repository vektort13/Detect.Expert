// MAIN-world sensor bootstrap. Built as an IIFE with no runtime imports and no chrome.* (REQ-004: nothing in
// this realm is trusted; the bridge and the SW re-validate everything). Installs the canvas sensor
// (DET-001..DET-004) and starts the runtime that batches counters to the ISOLATED bridge.
// Hooks call the original exactly once (REQ-002), are never masked (REQ-003) and never ship raw values (REQ-005).

import { SensorRuntime, browserEnv, installCanvasSensor } from '@detect-expert/sensors';

declare const __EARLY_CAPTURE__: boolean;

(() => {
  // Double-install guard (ADR-006 §9): a second copy of this bundle in the same realm (re-injection after
  // activeTab + registerContentScripts, extension update) must not wrap the wrappers and double the counters.
  // Symbol.for() is realm-global, so any bundle instance finds it; the page can discover it through
  // Object.getOwnPropertySymbols(window). That is a known, documented detectability (REQ-003, REQ-014) —
  // the extension is not hidden. Read through the descriptor so a page-planted getter is never invoked.
  const MARK = Symbol.for('detect.expert/sensor/v1');
  if (Object.getOwnPropertyDescriptor(window, MARK) !== undefined) return;
  try {
    Object.defineProperty(window, MARK, { value: true, writable: false, enumerable: false, configurable: false });
  } catch {
    return; // the page sealed its global: install nothing rather than risk a second set of wrappers later
  }
  try {
    const runtime = new SensorRuntime(browserEnv(window, typeof __EARLY_CAPTURE__ !== 'undefined' && __EARLY_CAPTURE__));
    installCanvasSensor(runtime, window);
    runtime.start();
  } catch {
    // The sensor must never throw into the page (REQ-002); a failed bootstrap is simply not observed.
  }
})();
