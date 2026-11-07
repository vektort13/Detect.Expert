// MAIN-world policy prelude of the module «Защита» (ADR-020 §10; S03 entry, S05 policy): one bundle per group of
// PROTECT_MAIN_GROUPS, built as protect-on.<group>.js with __PROTECT_GROUP_BIT__ = 1 << (index of the group).
// Registered between protect-policy.js and protect.main.js only for enabled groups. No chrome.*, no runtime imports
// beyond the dependency-free policy module (under 2 KiB).

import { markProtectGroupOn } from '../../../packages/sensors/src/protect-policy';

declare const __PROTECT_GROUP_BIT__: number;

markProtectGroupOn(window, __PROTECT_GROUP_BIT__);
