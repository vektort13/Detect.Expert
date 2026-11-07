// @detect-expert/ui — Preact components, pure view models and localization helpers for popup / side panel /
// options (spec V §7, VI I5). Read-only view of ReportProjection; no page APIs, no network.

export { t, tm, tOptional, fallbackMessage, uiLocale, applyDocumentLanguage } from './i18n';
export type { UiLocale } from './i18n';
export { sendUiRequest, queryActiveTab, readTabIdOverride, isUiResponse, errorMessageKey, UI_CLEAR_SESSION_REQUEST, readGrantedAccess, removeOrigins, removeSiteRequest } from './messaging';
export type { ActiveTab, SendFailureCode, SendResult, UiClearSessionRequest } from './messaging';
export { triggerDownload } from './download';

export { msg, joinMessages, resolveMessage } from './view-models/message';
export type { Message, MessageJoin, MessagePart, Translate } from './view-models/message';
export {
  COLLECTION_ERROR_FLAGS,
  COVERAGE_TITLE_KEYS,
  STATUS_KEYS,
  coverageFlagKey,
  coverageView,
  droppedTotal,
  flagsView,
} from './view-models/coverage';
export type { CoverageFlagVM, CoverageInput, CoverageVM, TabUrlClass, Tone, ViewState } from './view-models/coverage';
export { activeVendors, categoriesWithFindings, countsView, hostsOf, hostsPresent, thirdPartyHosts } from './view-models/counts';
export type { CountsVM } from './view-models/counts';
export { CATEGORY_ORDER, TECHNIQUE_INFO, categoryKey } from './view-models/techniques';
export type { TechniqueCategory, TechniqueFamily, TechniqueInfo } from './view-models/techniques';
export {
  buildCards,
  buildVendorCards,
  confidenceKey,
  countLabel,
  filterCards,
  filterVendorCards,
  kindLabelKey,
  normalizeQuery,
  selectTopCards,
  vendorMatchKey,
} from './view-models/cards';
export type { CardKind, CardVM, VendorCardVM } from './view-models/cards';
// S13 / E13-02: side-panel filters, grouping and the approximate activity timeline (page-hook buckets only).
export { CONFIDENCE_ORDER, KIND_ORDER, NO_FILTER, applyCardFilter, filterOptions, filterSummary, groupCards, isFilterActive } from './view-models/filters';
export type { CardFilter, CardGroup, FilterOption, FilterOptionsVM, Grouping } from './view-models/filters';
export { MAX_TIMELINE_ROWS, activityMessage, bucketOffsetMessage, documentScopeKey, timelineRows, validBuckets } from './view-models/timeline';
export type { TimelineRow } from './view-models/timeline';
export { ALL_SITES_ORIGINS, SCOPE_MODE_LABEL_KEYS, SCOPE_OPTIONS, parseHostInput, permissionOriginsFor, scopeRequest } from './view-models/scope';
export type { ScopeOption } from './view-models/scope';
// S12 / E13-03: site access (Options) and «Выключено» with revoke.
export {
  ALL_SITES_PATTERNS,
  MAX_ACCESS_PATTERNS,
  MAX_SITE_ROWS,
  allSitesGranted,
  exactGrantHost,
  hostPatternsOf,
  offRevocableOf,
  revocableFor,
  siteAccessView,
  siteRemovedNoticeKey,
} from './view-models/site-access';
export type { GrantedAccess, SiteAccessVM, SiteRow, SiteStatusKey } from './view-models/site-access';
export { EXPORT_MIME, buildExportDownload, exportAvailability, exportFieldPaths, exportFileName, serializeExportPreview } from './view-models/export';
export type { ExportAvailability, ExportDownload } from './view-models/export';
export { ANNOUNCE_MIN_INTERVAL_MS, INITIAL_ANNOUNCER, announce, announcementFor, flushAnnouncer } from './view-models/announce';
export type { AnnounceStep, AnnouncerState } from './view-models/announce';
export { RESTRICTED_HOSTS, RESTRICTED_SCHEMES, classifyTabUrl, detectChrome, isChromeSupported, parseChromeMajor } from './view-models/environment';
export type { BrandEntry, ChromeSupport } from './view-models/environment';

export { useReportSession } from './app/useReportSession';
export type { ReportSession, ScopeApplyOptions, SessionNotice, SessionOptions } from './app/useReportSession';
export { screenView } from './app/viewModels';
export type { ScreenVM } from './app/viewModels';
export { coverageInputOf } from './app/coverageInput';
export { PopupApp, POPUP_CARD_LIMIT } from './app/PopupApp';
export { SidepanelApp } from './app/SidepanelApp';
export { OptionsApp } from './app/OptionsApp';

export { Header } from './components/Header';
export type { HeaderProps } from './components/Header';
export { StateMessage } from './components/StateMessage';
export type { StateMessageProps } from './components/StateMessage';
export { CoverageBox } from './components/CoverageBox';
export type { CoverageBoxProps } from './components/CoverageBox';
export { Counts } from './components/Counts';
export { FindingCard } from './components/FindingCard';
export type { FindingCardProps } from './components/FindingCard';
export { IntegrityBadge, evidenceKey, integrityKey } from './components/IntegrityBadge';
export { VendorsSection } from './components/VendorsSection';
export type { VendorsSectionProps } from './components/VendorsSection';
export { PauseButton } from './components/PauseButton';
export type { PauseButtonProps } from './components/PauseButton';
export { ScopePicker } from './components/ScopePicker';
export type { ScopePickerProps } from './components/ScopePicker';
export { SITE_ACCESS_ID, SITE_ACCESS_TITLE_ID, SiteAccessSection } from './components/SiteAccessSection';
export type { SiteAccessSectionProps } from './components/SiteAccessSection';
export { ExportPreviewDialog } from './components/ExportPreviewDialog';
export type { ExportPreviewDialogProps } from './components/ExportPreviewDialog';
export { LiveRegion, useThrottledAnnouncement } from './components/LiveRegion';
export { Tabs, panelId, tabId } from './components/Tabs';
export type { TabItem, TabsProps } from './components/Tabs';
export { SearchBox } from './components/SearchBox';
export type { SearchBoxProps } from './components/SearchBox';
export { Notice } from './components/Notice';
export { ScopeLine } from './components/ScopeLine';
export { ReportActions, exportAllowed } from './components/ReportActions';
export type { ReportActionsProps } from './components/ReportActions';
export { ConfirmDialog } from './components/ConfirmDialog';
export type { ConfirmDialogProps } from './components/ConfirmDialog';
export { TechniqueFilters } from './components/TechniqueFilters';
export type { TechniqueFiltersProps } from './components/TechniqueFilters';
export { ActivityTimeline } from './components/ActivityTimeline';
export type { ActivityTimelineProps } from './components/ActivityTimeline';
export { CardList } from './components/CardList';
export type { CardListProps } from './components/CardList';
