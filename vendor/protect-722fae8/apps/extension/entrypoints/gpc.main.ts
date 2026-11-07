// MAIN-world prelude of the module «Защита», feature `gpc` (ADR-020 §H; S03 entry, S13 property). Registered first in
// detector-protect-main-v1 only when the user turned GPC on. Defines navigator.globalPrivacyControl as a plain getter
// (no masking, REQ-003). No chrome.*, no runtime imports beyond the dependency-free shim (kept under 2 KiB).

import { installGpcProperty } from '../../../packages/sensors/src/gpc-shim';

try {
  installGpcProperty(window);
} catch {
  // Never throw into the page; without the property the tab fact says the signal was not set.
}
