// ADR-020 §G (S12): history «Кто вас узнаёт» (sightings by UTC day in IndexedDB), the SW lane of the module «Защита».

export { HistoryService, createHistoryService } from './service';
export type { HistoryServiceOptions } from './service';
export { HistoryAccumulator } from './accumulator';
export type { HistoryDrained } from './accumulator';
export { HISTORY_TOP_SITE_STEPS, HistoryFoldMemo, asSent, awaitedRequestId, documentFamilies, foldEvent, foldReport, topHostOf } from './fold';
export { HistoryAwaitingSends, MAX_PARKED_PER_REQUEST } from './awaiting';
export type { HistoryEventResult, HistoryFoldResult, HistoryFoldSkip } from './fold';
export { HISTORY_EVICT_TARGET, HISTORY_LIMITS, HistoryStore } from './store';
export type { HistoryLimits, HistoryLoaded } from './store';
