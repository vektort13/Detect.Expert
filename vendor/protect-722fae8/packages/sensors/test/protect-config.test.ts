// ADR-020 §13, E21-10 (S10): configuration of the module's MAIN hooks and the pre-registered decision rule.
// The release profile carries the perf-gate decision of 2026-10-18 (strong class, provisional: listen off, send off,
// observe wrap, imgSrc off); the test profiles run the candidate configuration; the rule maps measurements to
// prototype / shadow / off and wrap / off.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROTECT_HOOK_CANDIDATE, PROTECT_HOOK_CONFIG, PROTECT_HOOK_DECISION, protectGroupHasHooks, protectHookConfigFor } from '../src/protect/config';
import { REGISTRATION_TARGETS, SEND_TARGETS } from '../src/protect/targets';

interface Ci {
  median: number;
  lo: number;
  hi: number;
  width: number;
}
type Decide = (group: string, m: unknown) => { decision: string; mode: string };

async function perfLib(): Promise<{ decideProtectGroup: Decide; PROTECT_THRESHOLDS: Record<string, number> }> {
  // @ts-expect-error -- a plain ESM script without type declarations (scripts/perf-lib.mjs)
  return (await import('../../../scripts/perf-lib.mjs')) as { decideProtectGroup: Decide; PROTECT_THRESHOLDS: Record<string, number> };
}

const ci = (hi: number, width = 0.04): Ci => ({ median: hi - width / 2, lo: hi - width, hi, width });

describe('review ADR-01: the binding docs/PROJECT_RULES.md wrapper list', () => {
  it('the HTMLImageElement src setter stays off in every profile while docs/PROJECT_RULES.md (REQ-001 of the module) does not list it', () => {
    // A go of the img-src gate needs a dated ADR-020 revision and the owner-confirmed docs/PROJECT_RULES.md amendment first.
    const rules = readFileSync(fileURLToPath(new URL('../../../docs/PROJECT_RULES.md', import.meta.url)), 'utf8');
    const listed = rules.includes('HTMLImageElement.prototype.src');
    if (!listed) {
      expect(PROTECT_HOOK_DECISION.imgSrc).toBe('off');
      expect(PROTECT_HOOK_CANDIDATE.imgSrc).toBe('off');
      for (const profile of ['local', 'test', 'test-optional', 'release', null]) expect(protectHookConfigFor(profile).imgSrc, String(profile)).toBe('off');
    }
  });
});

describe('PROTECT_HOOK_CONFIG', () => {
  it('decided gate: the release profile carries the archived decision; test profiles run the candidate; unknown profiles get the decision', () => {
    expect(PROTECT_HOOK_DECISION).toEqual({
      status: 'decided',
      decidedAt: '2026-10-18T06:56:35.241Z',
      archive: 'docs/coverage/perf/protect-hooks-spike-strong-2026-10-18T06-56-35.241Z.json',
      listen: 'off',
      send: 'off',
      observe: 'wrap',
      imgSrc: 'off',
    });
    // A decision names its archive: the file exists in the repository.
    expect(existsSync(fileURLToPath(new URL('../../../' + String(PROTECT_HOOK_DECISION.archive), import.meta.url)))).toBe(true);
    expect(protectHookConfigFor('local')).toBe(PROTECT_HOOK_DECISION);
    expect(protectHookConfigFor(null)).toBe(PROTECT_HOOK_DECISION);
    expect(protectHookConfigFor('test')).toBe(PROTECT_HOOK_CANDIDATE);
    expect(protectHookConfigFor('test-optional')).toBe(PROTECT_HOOK_CANDIDATE);
    expect(PROTECT_HOOK_CANDIDATE).toEqual({ listen: 'prototype', send: 'wrap', observe: 'wrap', imgSrc: 'off' });
    // vitest has no __BUILD_PROFILE__: the release decision applies.
    expect(PROTECT_HOOK_CONFIG).toBe(PROTECT_HOOK_DECISION);
    expect(Object.isFrozen(PROTECT_HOOK_DECISION) && Object.isFrozen(PROTECT_HOOK_CANDIDATE)).toBe(true);
  });

  it('group gate: a group without any hook is not registered by the SW', () => {
    // Release decision: no send hook (send off, imgSrc off); the listen group carries only MutationObserver.observe.
    expect(protectGroupHasHooks('send', PROTECT_HOOK_DECISION)).toBe(false);
    expect(protectGroupHasHooks('listen', PROTECT_HOOK_DECISION)).toBe(true);
    expect(protectGroupHasHooks('send', { listen: 'off', send: 'off', observe: 'off', imgSrc: 'off' })).toBe(false);
    expect(protectGroupHasHooks('listen', { listen: 'off', send: 'off', observe: 'off', imgSrc: 'off' })).toBe(false);
    expect(protectGroupHasHooks('send', PROTECT_HOOK_CANDIDATE)).toBe(true);
    expect(protectGroupHasHooks('listen', PROTECT_HOOK_CANDIDATE)).toBe(true);
    expect(protectGroupHasHooks('send', { listen: 'off', send: 'off', observe: 'off', imgSrc: 'wrap' })).toBe(true);
    expect(protectGroupHasHooks('listen', { listen: 'off', send: 'off', observe: 'wrap', imgSrc: 'off' })).toBe(true);
  });

  it('hook table: frozen, one entry per hooked member', () => {
    expect(Object.isFrozen(SEND_TARGETS) && Object.isFrozen(REGISTRATION_TARGETS)).toBe(true);
    expect(Object.values(SEND_TARGETS).map((t) => (t.iface ?? 'window') + '.' + t.key)).toEqual([
      'window.fetch',
      'XMLHttpRequest.open',
      'XMLHttpRequest.send',
      'Navigator.sendBeacon',
      'HTMLImageElement.src',
    ]);
    expect(Object.values(REGISTRATION_TARGETS).map((t) => t.iface + '.' + t.key)).toEqual(['EventTarget.addEventListener', 'MutationObserver.observe']);
  });
});

describe('decideProtectGroup (scripts/perf-lib.mjs, E21-10 rule)', () => {
  const listen = (over: Record<string, unknown> = {}) => ({
    realistic: { V1: ci(1.03), V2: ci(1.01) },
    untrackedNs: { V1: 30, V2: 1 },
    trackedNoStackNs: { V1: 200 },
    stackP95Us: { V1: 30 },
    ...over,
  });

  it('thresholds as recorded in the card', async () => {
    const { PROTECT_THRESHOLDS } = await perfLib();
    expect(PROTECT_THRESHOLDS).toEqual({ ratioUpper: 1.05, ciWidth: 0.1, untrackedNs: 50, trackedNoStackNs: 300, stackP95Us: 50, sendNoSampleUs: 2, sendSampleP95Us: 60, shadowElementNs: 5 });
  });

  it('listen: prototype -> shadow -> off; a wide CI is inconclusive (off)', async () => {
    const { decideProtectGroup } = await perfLib();
    expect(decideProtectGroup('listen', listen())).toEqual({ decision: 'go', mode: 'prototype' });
    expect(decideProtectGroup('listen', listen({ untrackedNs: { V1: 51, V2: 1 } }))).toEqual({ decision: 'go-shadow', mode: 'shadow' });
    expect(decideProtectGroup('listen', listen({ trackedNoStackNs: { V1: 301 } }))).toEqual({ decision: 'go-shadow', mode: 'shadow' });
    expect(decideProtectGroup('listen', listen({ stackP95Us: { V1: 51 }, untrackedNs: { V1: 30, V2: 6 } }))).toEqual({ decision: 'no-go', mode: 'off' });
    expect(decideProtectGroup('listen', listen({ realistic: { V1: ci(1.06), V2: ci(1.06) } }))).toEqual({ decision: 'no-go', mode: 'off' });
    expect(decideProtectGroup('listen', listen({ realistic: { V1: ci(1.03, 0.11), V2: ci(1.01) } }))).toEqual({ decision: 'inconclusive', mode: 'off' });
  });

  it('send / observe / img-src: wrap only on a go; invalid input throws', async () => {
    const { decideProtectGroup } = await perfLib();
    expect(decideProtectGroup('send', { realistic: { V1: ci(1.02) }, sendNoSampleUs: { V1: 1.5 }, sendSampleP95Us: { V1: 40 } })).toEqual({ decision: 'go', mode: 'wrap' });
    expect(decideProtectGroup('send', { realistic: { V1: ci(1.02) }, sendNoSampleUs: { V1: 2.5 }, sendSampleP95Us: { V1: 40 } })).toEqual({ decision: 'no-go', mode: 'off' });
    expect(decideProtectGroup('send', { realistic: { V1: ci(1.02) }, sendNoSampleUs: { V1: 1 }, sendSampleP95Us: { V1: 61 } })).toEqual({ decision: 'no-go', mode: 'off' });
    expect(decideProtectGroup('observe', { realistic: { V1: ci(1.049) } })).toEqual({ decision: 'go', mode: 'wrap' });
    expect(decideProtectGroup('img-src', { realistic: { V1: ci(1.051) } })).toEqual({ decision: 'no-go', mode: 'off' });
    expect(() => decideProtectGroup('send', { realistic: { V1: ci(1.02) } })).toThrow();
    expect(() => decideProtectGroup('other', {})).toThrow();
  });
});
