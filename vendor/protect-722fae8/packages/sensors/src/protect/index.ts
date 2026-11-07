// ADR-020 §F (S10): MAIN hooks of the module «Защита» (protect.main.js). Entry: apps/extension/entrypoints/
// protect.main.ts takes the prelude group mask (takeProtectPolicy) and calls installProtectMain(window, boot).
// Order at document_start: the environment and the stack intrinsics are captured first (before any wrapper exists and
// before page scripts run), then the hooks of the enabled groups are installed under PROTECT_HOOK_CONFIG, then the
// runtime announces itself to the ISOLATED relay. A document that is no longer loading (late injection) gets nothing:
// page scripts may already have patched the builtins the hooks rely on (`late-start` comes from protect.js's own
// hello). toString is never masked (REQ-003); hooks are detectable and the consent screen says so (REQ-014).
// Not re-exported from packages/sensors/src/index.ts: hook.main.js does not change.

import { PROTECT_MAIN_GROUPS } from '@detect-expert/contracts';
import { browserEnv } from '../runtime';
import type { RuntimeEnv } from '../runtime';
import { PROTECT_HOOK_CONFIG } from './config';
import type { ProtectHookConfig } from './config';
import { installRegistrationHooks } from './registration-hooks';
import { ProtectMainRuntime } from './runtime';
import type { ProtectMainSnapshot, ProtectStopResult } from './runtime';
import { installSendHooks } from './send-hooks';
import { captureStackIntrinsics, createStackSampler } from './stack';
import type { StackSamplerSnapshot } from './stack';

const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const NO_ARGS: readonly unknown[] = Object.freeze([]);

/** What apps/extension/entrypoints/protect.main.ts hands over: the group mask from the prelude and early capture. */
export interface ProtectMainBoot {
  /** Mask of PROTECT_MAIN_GROUPS taken from the prelude record (never 0 here: the entry returns early on 0). */
  readonly groups: number;
  /** True when the bundle runs at document_start (protect.main.js is built with __EARLY_CAPTURE__ = true). */
  readonly earlyCapture: boolean;
}

export interface ProtectMainOptions {
  /** Hook configuration (tests and the perf probe); default PROTECT_HOOK_CONFIG of this build. */
  config?: Readonly<ProtectHookConfig>;
  /** Environment seam (tests); default browserEnv(realm). */
  env?: RuntimeEnv;
  /** Document host seam (tests); default location.hostname of the realm. */
  docHost?: string;
  /** Stack budgets per window (the perf probe); default PROTECT_BUDGETS. */
  stackBudgets?: { send: number; registration: number };
  /** Do not start the runtime (the perf probe measures the hooks alone). */
  noStart?: boolean;
}

export interface ProtectMainHandle {
  readonly runtime: ProtectMainRuntime;
  stop(): ProtectStopResult;
  snapshot(): ProtectMainSnapshot & { sampler: StackSamplerSnapshot };
}

function groupBit(name: (typeof PROTECT_MAIN_GROUPS)[number]): number {
  for (let i = 0; i < PROTECT_MAIN_GROUPS.length; i++) if (PROTECT_MAIN_GROUPS[i] === name) return 1 << i;
  return 0;
}

/** location.hostname of the realm through the unforgeable native accessors (no page code), or ''. */
function readDocHost(realm: object): string {
  try {
    const locGetter = getOwnPropertyDescriptor(realm, 'location')?.get;
    if (typeof locGetter !== 'function') return '';
    const loc: unknown = apply(locGetter, realm, NO_ARGS);
    if (typeof loc !== 'object' || loc === null) return '';
    const hostGetter = getOwnPropertyDescriptor(loc, 'hostname')?.get;
    if (typeof hostGetter !== 'function') return '';
    const host: unknown = apply(hostGetter, loc, NO_ARGS);
    return typeof host === 'string' ? host : '';
  } catch {
    return '';
  }
}

/**
 * Installs the module hooks of the enabled groups (`send`: fetch / XHR / sendBeacon / image src; `listen`:
 * addEventListener / MutationObserver.observe) and starts the runtime. Null when nothing is installed (no group,
 * a late start, every hook of the groups off, or the environment cannot be captured). Never throws.
 */
export function installProtectMain(realm: Window & typeof globalThis, boot: ProtectMainBoot, options: ProtectMainOptions = {}): ProtectMainHandle | null {
  try {
    if (boot.groups === 0) return null;
    // Captured before any wrapper: our own listeners never go through our addEventListener hook.
    const env = options.env ?? browserEnv(realm, boot.earlyCapture);
    if (env.startedLate || !boot.earlyCapture) return null;
    const config = options.config ?? PROTECT_HOOK_CONFIG;
    const docHost = options.docHost ?? readDocHost(realm);
    const intrinsics = captureStackIntrinsics(realm);
    const runtime = new ProtectMainRuntime(env, { groups: boot.groups, startedLate: false });
    const sampler = createStackSampler(intrinsics, { now: env.now, docHost, earlyCapture: true, ...(options.stackBudgets === undefined ? {} : { budgets: options.stackBudgets }) });
    if (intrinsics === null) runtime.addLimitation('stack-unavailable');
    if ((boot.groups & groupBit('send')) !== 0) {
      runtime.attach(installSendHooks({ realm, runtime, sampler, context: runtime.hooks, docHost, config }));
    }
    if ((boot.groups & groupBit('listen')) !== 0) {
      runtime.attach(installRegistrationHooks({ realm, runtime, sampler, context: runtime.hooks, config }));
    }
    if (runtime.hookCount === 0) {
      runtime.stop('local');
      return null;
    }
    if (options.noStart !== true) runtime.start();
    return {
      runtime,
      stop: () => runtime.stop('local'),
      snapshot: () => ({ ...runtime.snapshot(), sampler: sampler.snapshot() }),
    };
  } catch {
    // The module must never throw into the page (REQ-002); a failed install is simply not observed.
    return null;
  }
}
