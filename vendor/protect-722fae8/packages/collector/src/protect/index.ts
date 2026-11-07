// ISOLATED part of the opt-in module «Защита» (ADR-020 §A; S05): the field session and the MAIN relay of one document.
// protect.js runs only while the user has the module on (detector-protect-isolated-v1); nothing is read before the SW
// answers active. The relay starts only when the document has MAIN hook groups (ack.groups !== 0) and follows the
// session: pause / resume / stop. Review W1: when the module stops here before a relay bound MAIN (inactive or failed
// first hello), the MAIN boots of this document still get protect-relay-stop (bounded unbound sweep), so an excluded or
// inactive document keeps no MAIN wrapper. Not re-exported from the package index (bridge.js is unchanged).

import { createBrowserProtectEnv } from './env';
import type { ProtectEnv } from './env';
import { ProtectRelay, postRelayMessageToPage, stopUnboundMain } from './relay';
import type { ProtectRelaySnapshot } from './relay';
import { ProtectSession } from './session';
import type { ProtectSessionSnapshot } from './session';

export interface ProtectIsolatedHandle {
  stop(): void;
  snapshot(): { session: ProtectSessionSnapshot; relay: ProtectRelaySnapshot | null };
}

/** Starts the module in this document: session (lifecycle, fields) + relay (MAIN samples). */
export function startProtectIsolated(env: ProtectEnv = createBrowserProtectEnv(), post = postRelayMessageToPage): ProtectIsolatedHandle {
  let relay: ProtectRelay | null = null;
  let session: ProtectSession | null = null;
  let mainSwept = false;
  session = new ProtectSession(env, {
    onActive(groups) {
      if (groups === 0 || relay !== null) return;
      relay = new ProtectRelay(env, post, { onInactive: () => session?.stop() });
      relay.start();
    },
    onPause(paused) {
      if (paused) relay?.pause();
      else relay?.resume();
    },
    onStop() {
      const bound = relay?.snapshot().boots ?? 0;
      relay?.stop('revoked');
      // Review W1: no relay (inactive or failed first hello) or no MAIN boot bound yet: MAIN hooks installed at
      // document_start are stopped through a bounded unbound sweep, so an excluded or inactive document keeps none.
      if (bound === 0 && !mainSwept) {
        mainSwept = true;
        stopUnboundMain(env, post, 'revoked');
      }
    },
  });
  session.start();
  return {
    stop: () => session?.stop(),
    snapshot: () => ({ session: session!.snapshot(), relay: relay?.snapshot() ?? null }),
  };
}
