// MAIN-world policy prelude of the module «Защита» (ADR-020 §10; S03 entry, S05 policy): the first module file of
// detector-protect-main-v1 after gpc.main.js. Starts an empty group record for this document; the
// protect-on.<group>.js files that follow set the bits of enabled groups and protect.main.js takes the record.
// No chrome.*, no runtime imports beyond the dependency-free policy module (kept under 2 KiB).

import { beginProtectPolicy } from '../../../packages/sensors/src/protect-policy';

beginProtectPolicy(window);
