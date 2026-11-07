// ADR-020 §E (S11): session-recording lane of the module «Защита» (feature `session-replay`). The hook availability
// comes from the MAIN hook configuration of this build (S10 PROTECT_HOOK_CONFIG; release: every group `off` until the
// E21-10 perf gate decides, so S1 / S2 are reported unavailable there: listener-hook-off, mo-hook-off).

import { PROTECT_HOOK_CONFIG } from '../../../../sensors/src/protect/config';
import { ReplayService } from './service';
import type { ReplayServiceOptions } from './service';

export { ReplayCadenceTracker, REPLAY_TRACKER_DOCUMENTS, REPLAY_TRACKER_DOMAINS } from './cadence';
export { MAX_PENDING_BODIES, MAX_REPLAY_FRAMES, MAX_REPLAY_TOPS, REPLAY_FLUSH_MS, ReplayService, replayBodyBytes } from './service';
export type { ReplayHookAvailability, ReplayServiceOptions } from './service';

export function createReplayService(options: Partial<ReplayServiceOptions> = {}): ReplayService {
  return new ReplayService({
    ...options,
    hooks: options.hooks ?? { listen: PROTECT_HOOK_CONFIG.listen !== 'off', observe: PROTECT_HOOK_CONFIG.observe !== 'off' },
  });
}
