// Test-profile tripwire, MAIN world (ADR-020 §12, §15; S05). Built only by `--profile test` as protect-tripwire.main.js
// and registered first in detector-protect-main-v1 by the test branch of the SW entry (before gpc.main.js, the policy
// prelude and protect.main.js). It catches any read of a password field in the page's world: the module's MAIN code
// must cause none; the fixture's #positive-control causes exactly one. Counters:
// document.documentElement.dataset.pwTripwireMain.

import { installPasswordTripwire } from './protect-tripwire.core';

try {
  installPasswordTripwire('main');
} catch {
  // A failed install leaves selfCheck at 0: tests/extension/protect/password-never-read.spec.ts fails on it.
}
