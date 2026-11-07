// ADR-047 (S1): MAIN hook configuration of the production build of the module «Защита». scripts/production/
// build-protect.mjs resolves every import of vendor packages/sensors/src/protect/config.ts to this file (protect.main.js,
// protect-sw.js), so the hooks the page gets and the groups the SW registers come from one table.
// Owner decision of 2026-10-18 (port decisions, Q2 «Включить»): script attribution is on — the `send` group wraps
// fetch, XMLHttpRequest.prototype.open/send and Navigator.prototype.sendBeacon with the sampled stack of the vendored
// send hooks (cost about 6.5 % in the E21-10 measurement, accepted by the owner; ADR-047 edits ADR-020 §13). The other
// groups keep the vendored release decision: listen 'off' (W3: observation's bootstrap needs the native
// window.addEventListener), observe 'wrap', imgSrc 'off' (not in the module's REQ-001 list).
// The vendored decision (PROTECT_HOOK_DECISION of 722fae8, send 'off') stays unchanged in vendor/protect-722fae8.

import type { ProtectMainGroup } from '@detect-expert/contracts';
import type {
  ListenHookMode,
  ProtectHookConfig,
  ProtectHookDecision,
  WrapHookMode,
} from '../../../vendor/protect-722fae8/packages/sensors/src/protect/config';

export type { ListenHookMode, ProtectHookConfig, ProtectHookDecision, WrapHookMode };

/** Production decision (ADR-047): the vendored release decision with `send: 'wrap'` by the owner's choice. */
export const PROTECT_HOOK_DECISION: Readonly<ProtectHookDecision> = Object.freeze({
  status: 'decided',
  decidedAt: '2026-10-18',
  archive: null,
  listen: 'off',
  send: 'wrap',
  observe: 'wrap',
  imgSrc: 'off',
});

/** Same candidate as the vendored config (perf probe V1); production never selects it. */
export const PROTECT_HOOK_CANDIDATE: Readonly<ProtectHookConfig> = Object.freeze({
  listen: 'prototype',
  send: 'wrap',
  observe: 'wrap',
  imgSrc: 'off',
});

/** The production build has one profile: every caller gets the production decision. */
export function protectHookConfigFor(_profile: string | null): Readonly<ProtectHookConfig> {
  return PROTECT_HOOK_DECISION;
}

export const PROTECT_HOOK_CONFIG: Readonly<ProtectHookConfig> = PROTECT_HOOK_DECISION;

/** Same rule as the vendored protectGroupHasHooks: a group without hooks is not registered (groupGate). */
export function protectGroupHasHooks(group: ProtectMainGroup, config: Readonly<ProtectHookConfig> = PROTECT_HOOK_CONFIG): boolean {
  if (group === 'send') return config.send !== 'off' || config.imgSrc !== 'off';
  return config.listen !== 'off' || config.observe !== 'off';
}
