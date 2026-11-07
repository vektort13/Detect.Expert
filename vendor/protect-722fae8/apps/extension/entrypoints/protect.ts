// ISOLATED-world entry of the opt-in module «Защита» (ADR-020 §A, §10; S03 entry, S05 content). Built as protect.js,
// an IIFE with no runtime imports. Registered only by the module (detector-protect-isolated-v1) while the user has it
// on; with the module off no page receives this file and bridge.js is unchanged. The SW derives tabId/frameId/
// documentId from MessageSender only (REQ-004); field values never leave this world (ADR-020 §4, REQ-005).

import { startProtectIsolated } from '../../../packages/collector/src/protect/index';

(() => {
  try {
    // One module instance per ISOLATED world (re-injection after an update or a registration change). Claimed before
    // the start: a partially failed start may already own listeners. Symbol.for() is realm-global; the ISOLATED
    // world is not visible to the page.
    const mark = Symbol.for('detect.expert/protect/v1');
    if (Object.getOwnPropertyDescriptor(globalThis, mark) !== undefined) return;
    Object.defineProperty(globalThis, mark, { value: true, writable: false, enumerable: false, configurable: false });
    startProtectIsolated();
  } catch {
    // The module must never throw into the page; a failed start means the module is not active in this document.
  }
})();
