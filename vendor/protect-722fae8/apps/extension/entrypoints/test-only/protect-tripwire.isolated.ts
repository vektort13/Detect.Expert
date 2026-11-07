// Test-profile tripwire, ISOLATED world (ADR-020 §12, §15; S05). Built only by `--profile test` as
// protect-tripwire.isolated.js and registered first in detector-protect-isolated-v1 by the test branch of the SW entry,
// so it wraps the readers before protect.js runs. It catches any read of a password field by the module's own
// ISOLATED code (the audited reader included); counters: document.documentElement.dataset.pwTripwireIsolated.

import { installPasswordTripwire } from './protect-tripwire.core';

try {
  installPasswordTripwire('isolated');
} catch {
  // A failed install leaves selfCheck at 0: tests/extension/protect/password-never-read.spec.ts fails on it.
}
