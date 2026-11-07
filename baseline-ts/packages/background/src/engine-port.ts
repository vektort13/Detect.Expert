// Thin adapter to the pure interpretation engine (packages/engine). The background accepts this pure port; the integrator wires `deriveFindings` from @detect-expert/engine
// in apps/extension/entrypoints/background.ts. The port must stay pure: no chrome.*, no network (spec Part VI I2).

import type { DocumentReport, Finding } from '@detect-expert/contracts';

export interface EnginePort {
  /**
   * Derives findings for a document from its counters and browser-observed hosts. Called after every merge,
   * inside the document's serialized queue. Must be deterministic, must not mutate `report`, must not throw
   * (an exception is caught and counted as a degraded run). The result is bounded by the reducer to
   * BUDGETS.maxFindingsPerDocument.
   */
  deriveFindings(report: Readonly<DocumentReport>): readonly Finding[];
}

/** Explicit test adapter without interpretation rules. Reports still carry counters, hosts and coverage. */
export const noopEngine: EnginePort = {
  deriveFindings(): readonly Finding[] {
    return [];
  },
};
