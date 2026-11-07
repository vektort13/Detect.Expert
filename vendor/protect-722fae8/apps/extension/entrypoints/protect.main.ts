// MAIN-world bundle of the module «Защита» (ADR-020 §F, §10; S03 entry, S10 hooks). Registered last in
// detector-protect-main-v1, only while the user has the module on and at least one group is enabled. Built as an
// IIFE with no runtime imports and no chrome.*; everything it sends on the module channel is page-controlled
// (REQ-004). Hooks call the original exactly once (REQ-002), are never masked (REQ-003) and never read field values,
// request bodies or full URLs (REQ-005, ADR-020 §4). hook.*.js and bridge.js are not involved.

import { takeProtectPolicy } from '../../../packages/sensors/src/protect-policy';
import { installProtectMain } from '../../../packages/sensors/src/protect/index';

declare const __PROTECT_GROUP_COUNT__: number;
declare const __EARLY_CAPTURE__: boolean;

(() => {
  // The group record is taken (and removed) first, as in hook.main.ts: a re-injected prelude never stays on the page.
  // No valid record -> 0 -> nothing is installed (fail closed).
  let groups = 0;
  try {
    groups = takeProtectPolicy(window, __PROTECT_GROUP_COUNT__);
  } catch {
    groups = 0;
  }
  if (groups === 0) return;
  // Double-install guard (as hook.main.ts): Symbol.for() is realm-global, so the page can see it through
  // Object.getOwnPropertySymbols(window). A known, documented detectability (REQ-003, REQ-014). Read through the
  // descriptor so a page-planted getter is never invoked.
  const MARK = Symbol.for('detect.expert/protect-main/v1');
  if (Object.getOwnPropertyDescriptor(window, MARK) !== undefined) return;
  try {
    Object.defineProperty(window, MARK, { value: true, writable: false, enumerable: false, configurable: false });
  } catch {
    return; // sealed global: install nothing rather than risk a second set of wrappers later
  }
  try {
    installProtectMain(window, { groups, earlyCapture: typeof __EARLY_CAPTURE__ !== 'undefined' && __EARLY_CAPTURE__ });
  } catch {
    // The module must never throw into the page (REQ-002); a failed install is simply not observed.
  }
})();
