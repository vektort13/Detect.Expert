// ADR-020 §F, §13 (S10): configuration of the module's MAIN hooks, decided by the perf gate of E21-10 (criteria
// recorded 2026-10-17T19:01:11Z, before any measurement). Decision rules:
//   listen   'prototype' (EventTarget.prototype wrapper with the early type filter) -> if no-go 'shadow' (own wrappers on
//            window and document only; element registrations untouched) -> 'off';
//   send     'wrap' | 'off';   observe  'wrap' | 'off';   imgSrc  'off' by default, 'wrap' only on a go.
// Decided in the quiet perf phase (2026-10-18, hardware class strong only: provisional; medium / weak not measured):
// listen inconclusive -> off, send no-go -> off, observe go -> wrap, img-src inconclusive -> off (archive below and
// docs/coverage/perf/protect-hooks-spike.md). A group without a valid go stays 'off'.
// Test profiles run the CANDIDATE configuration (what the perf probe measures as V1) so the e2e specs cover the hooks;
// they are never shipped. Changing PROTECT_HOOK_DECISION = a dated entry in docs/coverage/perf/protect-hooks-spike.md
// with its archive (never a silent change).
// Constraints outside the perf gate (final review, 2026-10-18):
//   - W3: listen 'prototype' / 'shadow' replace window.addEventListener, which observation's bootstrap (hook.main.js,
//     browserEnv) requires to be native. The SW re-registers detector-protect-main-v1 after every registration or
//     update of detector-main-v1 (Chrome runs MAIN scripts in that order and moves updated ones last; e2e
//     tests/extension/protect/observation-order.spec.ts), so in new documents observation installs first. An
//     active-tab late injection of hook.main.js into a document where the module's listen wrapper is already installed
//     still fails there (no observation data in that document until reload). Keep listen 'off' outside the test
//     profiles until that is solved.
//   - ADR-01: imgSrc stays 'off' in every profile while docs/PROJECT_RULES.md (REQ-001 of the module) does not list the
//     HTMLImageElement.prototype.src setter (test: packages/sensors/test/protect-config.test.ts).

import type { ProtectMainGroup } from '@detect-expert/contracts';

export type ListenHookMode = 'prototype' | 'shadow' | 'off';
export type WrapHookMode = 'wrap' | 'off';

export interface ProtectHookConfig {
  listen: ListenHookMode;
  send: WrapHookMode;
  observe: WrapHookMode;
  imgSrc: WrapHookMode;
}

/** Status of the perf gate (strong class: provisional; medium / weak: not measured). */
export interface ProtectHookDecision extends ProtectHookConfig {
  status: 'pending' | 'decided';
  /** ISO time of the decision, or null while pending. */
  decidedAt: string | null;
  /** Archive of the deciding run (docs/coverage/perf/protect-hooks-spike-<class>-<ts>.json), or null. */
  archive: string | null;
}

/**
 * E21-10 decision by decideProtectGroup (scripts/perf-lib.mjs) on the archived run: listen V1 ratio 1.19 [1.17; 1.30]
 * (CI width 0.125 > 0.10: inconclusive -> off); send V1 1.065 [1.024; 1.079] (> 1.05: no-go -> off); observe V1 1.016
 * [0.990; 1.025] (go -> wrap); img-src V1 1.25 [1.15; 1.32] (CI width 0.17: inconclusive -> off).
 */
export const PROTECT_HOOK_DECISION: Readonly<ProtectHookDecision> = Object.freeze({
  status: 'decided',
  decidedAt: '2026-10-18T06:56:35.241Z',
  archive: 'docs/coverage/perf/protect-hooks-spike-strong-2026-10-18T06-56-35.241Z.json',
  listen: 'off',
  send: 'off',
  observe: 'wrap',
  imgSrc: 'off',
});

/** The configuration under measurement (perf probe V1) and of the test profiles. imgSrc stays off by default. */
export const PROTECT_HOOK_CANDIDATE: Readonly<ProtectHookConfig> = Object.freeze({
  listen: 'prototype',
  send: 'wrap',
  observe: 'wrap',
  imgSrc: 'off',
});

declare const __BUILD_PROFILE__: string | undefined;

function buildProfile(): string | null {
  return typeof __BUILD_PROFILE__ === 'string' ? __BUILD_PROFILE__ : null;
}

/** Configuration of this build: the gate decision in the release profile, the candidate in the test profiles. */
export function protectHookConfigFor(profile: string | null): Readonly<ProtectHookConfig> {
  return profile === 'test' || profile === 'test-optional' ? PROTECT_HOOK_CANDIDATE : PROTECT_HOOK_DECISION;
}

export const PROTECT_HOOK_CONFIG: Readonly<ProtectHookConfig> = protectHookConfigFor(buildProfile());

/**
 * Whether a MAIN group has any hook under `config` (the SW registers no prelude bit and no protect.main.js for a group
 * without hooks: ProtectControllerOptions.groupGate). `send` = send hooks (fetch, XHR, sendBeacon, image src);
 * `listen` = addEventListener or MutationObserver.observe.
 */
export function protectGroupHasHooks(group: ProtectMainGroup, config: Readonly<ProtectHookConfig> = PROTECT_HOOK_CONFIG): boolean {
  if (group === 'send') return config.send !== 'off' || config.imgSrc !== 'off';
  return config.listen !== 'off' || config.observe !== 'off';
}
