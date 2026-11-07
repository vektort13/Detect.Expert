// ADR-020 §G (S12): pure logic of the «Кто вас узнаёт» history — UTC day masks, records and deltas, commutative merges,
// retention, linking mechanisms and ranking. No chrome.*, no clock, no storage. Names are history-prefixed where the
// underlying helper is generic (the engine root re-exports every lane with `export *`).

export {
  HISTORY_MASK_DAYS,
  HISTORY_MAX_DAY,
  HISTORY_MIN_DAY,
  alignDayMask as historyAlignMask,
  alignOrDayMask as historyAlignOr,
  dayCount as historyDayCount,
  daysIn as historyDaysIn,
  emptyDayMask as historyEmptyMask,
  firstDayOf as historyFirstDay,
  historyDayIndex,
  historyDayString,
  isDayMask as isHistoryDayMask,
  isEmptyDayMask as isHistoryMaskEmpty,
  lastDayOf as historyLastDay,
  setDay as historySetDay,
  trimRetention as historyTrimRetention,
} from './day-mask';
export type { HistoryDayMask } from './day-mask';
export {
  EMPTY_HISTORY_DROPPED,
  HISTORY_SIGNAL_ALL,
  HISTORY_SIGNAL_BITS,
  HISTORY_STATE_KEY,
  addDropped as addHistoryDropped,
  isHistoryFamily,
  isHistoryRuleId,
  newHistoryState,
  parseHistoryState,
  parseReceiverRecord as parseHistoryReceiverRecord,
  parseSightingRecord as parseHistorySightingRecord,
  parseSiteRecord as parseHistorySiteRecord,
} from './records';
export type {
  HistoryFamilyEntry,
  HistoryReceiverRecord,
  HistorySightingDelta,
  HistorySightingRecord,
  HistorySiteDelta,
  HistorySiteRecord,
  HistoryStateRecord,
  HistoryValueStrength,
} from './records';
export {
  applyReceiverDay as applyHistoryReceiverDay,
  applySightingDelta as applyHistorySightingDelta,
  applySiteDelta as applyHistorySiteDelta,
  maxInterpretation as historyMaxInterpretation,
  mergeSightingDeltas as mergeHistorySightingDeltas,
  mergeSightingRecords as mergeHistorySightingRecords,
  mergeSiteDeltas as mergeHistorySiteDeltas,
  mergeSiteRecords as mergeHistorySiteRecords,
  needsRetention as historyNeedsRetention,
  retainReceiver as retainHistoryReceiver,
  retainSighting as retainHistorySighting,
  retainSite as retainHistorySite,
  sightingDeltaKey as historySightingDeltaKey,
  siteDeltaKey as historySiteDeltaKey,
} from './merge';
export { VALUE_MATCH_MIN_SITES as HISTORY_VALUE_MATCH_MIN_SITES, hasLinkingMechanism as historyHasLinkingMechanism, historyMechanisms } from './mechanisms';
export type { HistoryDayWindow } from './mechanisms';
export { NO_HISTORY_VENDOR, groupHistoryRows, historyExportData, historyReceiverCard, historyRowKey, historyWindow, rankHistory } from './rank';
export type { HistoryExportData, HistoryRankOptions, HistoryRankResult, HistoryVendorOfRule } from './rank';
