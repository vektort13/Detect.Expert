// ADR-020 §I (S14): approximate response deadlines of a data request. Every rule is `unreviewed` (legal review pending)
// and counts from the sending day the user entered, while the laws count from receipt; public holidays are ignored.
// The UI says so next to every deadline. The extension never observes sending, delivery or an answer.
//   GDPR (EU/EEA, UK) Art. 12(3): one calendar month (clamped to the month end), extension to three months in total.
//   CCPA §1798.130(a)(2): access and erasure 45 days, extension by 45 more; opt-out of sale/sharing 15 business days
//   (CCPA regulations, candidate), no extension.
//   152-FZ Art. 20: 10 working days, extension by 5 more.
// A request with several kinds gets the earliest base deadline and the latest extended one.

import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { DeletionRequestRecord, LocalDay, RequestJurisdiction, RequestKind } from '@detect-expert/contracts';
import { addRequestBusinessDays, addRequestDays, addRequestMonths, requestDayNumber } from './days';

export const REQUEST_DEADLINE_RULE_IDS = ['gdpr-art-12-3', 'ccpa-1798-130', 'ccpa-opt-out-15-business-days', 'pdl-152-art-20'] as const;
export type RequestDeadlineRuleId = (typeof REQUEST_DEADLINE_RULE_IDS)[number];

export type RequestDeadlineUnit = 'month' | 'day' | 'business-day';

export interface RequestDeadlineSpan {
  unit: RequestDeadlineUnit;
  amount: number;
}

export interface RequestDeadlineRule {
  ruleId: RequestDeadlineRuleId;
  base: RequestDeadlineSpan;
  /** Total span from the sending day after an extension; null when the rule has none. */
  extended: RequestDeadlineSpan | null;
  legalReviewStatus: 'unreviewed';
  /** The rule itself is not confirmed from the primary source (candidate). */
  candidate: boolean;
}

export const REQUEST_DEADLINE_RULES: Readonly<Record<RequestDeadlineRuleId, RequestDeadlineRule>> = {
  'gdpr-art-12-3': { ruleId: 'gdpr-art-12-3', base: { unit: 'month', amount: 1 }, extended: { unit: 'month', amount: 3 }, legalReviewStatus: 'unreviewed', candidate: false },
  'ccpa-1798-130': { ruleId: 'ccpa-1798-130', base: { unit: 'day', amount: 45 }, extended: { unit: 'day', amount: 90 }, legalReviewStatus: 'unreviewed', candidate: false },
  'ccpa-opt-out-15-business-days': { ruleId: 'ccpa-opt-out-15-business-days', base: { unit: 'business-day', amount: 15 }, extended: null, legalReviewStatus: 'unreviewed', candidate: true },
  'pdl-152-art-20': { ruleId: 'pdl-152-art-20', base: { unit: 'business-day', amount: 10 }, extended: { unit: 'business-day', amount: 15 }, legalReviewStatus: 'unreviewed', candidate: false },
};

/** Deadline rule of one request kind under a law. */
export function requestDeadlineRuleOf(jurisdiction: RequestJurisdiction, kind: RequestKind): RequestDeadlineRule {
  switch (jurisdiction) {
    case 'gdpr-eu-eea':
    case 'gdpr-uk':
      return REQUEST_DEADLINE_RULES['gdpr-art-12-3'];
    case 'ccpa-ca':
      return kind === 'opt-out-sale-sharing' ? REQUEST_DEADLINE_RULES['ccpa-opt-out-15-business-days'] : REQUEST_DEADLINE_RULES['ccpa-1798-130'];
    case 'pdl-ru-152':
      return REQUEST_DEADLINE_RULES['pdl-152-art-20'];
  }
}

export function addRequestSpan(day: LocalDay, span: RequestDeadlineSpan): LocalDay | null {
  switch (span.unit) {
    case 'month':
      return addRequestMonths(day, span.amount);
    case 'day':
      return addRequestDays(day, span.amount);
    case 'business-day':
      return addRequestBusinessDays(day, span.amount);
  }
}

export interface RequestDeadline {
  deadlineDay: LocalDay;
  extendedDeadlineDay: LocalDay | null;
  /** Rule of the base deadline (the earliest one among the kinds). */
  ruleId: RequestDeadlineRuleId;
  /** Rule of the extended deadline, or null. */
  extendedRuleId: RequestDeadlineRuleId | null;
}

/** Deadlines of a request sent on `sentDay`; null when no day fits the journal range. */
export function computeRequestDeadline(jurisdiction: RequestJurisdiction, kinds: readonly RequestKind[], sentDay: LocalDay): RequestDeadline | null {
  let base: { day: LocalDay; ruleId: RequestDeadlineRuleId } | null = null;
  let extended: { day: LocalDay; ruleId: RequestDeadlineRuleId } | null = null;
  for (const kind of kinds) {
    const rule = requestDeadlineRuleOf(jurisdiction, kind);
    const day = addRequestSpan(sentDay, rule.base);
    if (day === null) return null;
    if (base === null || day < base.day) base = { day, ruleId: rule.ruleId };
    if (rule.extended !== null) {
      const ext = addRequestSpan(sentDay, rule.extended);
      if (ext !== null && (extended === null || ext > extended.day)) extended = { day: ext, ruleId: rule.ruleId };
    }
  }
  if (base === null) return null;
  return { deadlineDay: base.day, extendedDeadlineDay: extended?.day ?? null, ruleId: base.ruleId, extendedRuleId: extended?.ruleId ?? null };
}

export const REQUEST_DEADLINE_STATES = ['pending', 'due-soon', 'overdue'] as const;
export type RequestDeadlineState = (typeof REQUEST_DEADLINE_STATES)[number];

export interface RequestDueView {
  state: RequestDeadlineState;
  /** The day the answer is expected by (the extended deadline after `extended`). */
  dueDay: LocalDay;
  ruleId: RequestDeadlineRuleId;
  /** Days left (negative when overdue). */
  daysLeft: number;
}

/**
 * Deadline state of a request that waits for an answer (`sent` / `extended`); null for every other status or without
 * a deadline. due-soon = at most PROTECT_BUDGETS.dueSoonDays left; overdue = the due day has passed.
 */
export function requestDueView(
  record: Readonly<Pick<DeletionRequestRecord, 'status' | 'sentDay' | 'deadlineDay' | 'extendedDeadlineDay' | 'jurisdiction' | 'kinds'>>,
  today: LocalDay,
): RequestDueView | null {
  if (record.status !== 'sent' && record.status !== 'extended') return null;
  const useExtended = record.status === 'extended' && record.extendedDeadlineDay !== null;
  const dueDay = useExtended ? record.extendedDeadlineDay : record.deadlineDay;
  if (dueDay === null) return null;
  const computed = record.sentDay === null ? null : computeRequestDeadline(record.jurisdiction, record.kinds, record.sentDay);
  const ruleId: RequestDeadlineRuleId =
    (useExtended ? computed?.extendedRuleId : computed?.ruleId) ?? requestDeadlineRuleOf(record.jurisdiction, record.kinds[0] ?? 'access').ruleId;
  const daysLeft = requestDayNumber(dueDay) - requestDayNumber(today);
  const state: RequestDeadlineState = daysLeft < 0 ? 'overdue' : daysLeft <= PROTECT_BUDGETS.dueSoonDays ? 'due-soon' : 'pending';
  return { state, dueDay, ruleId, daysLeft };
}
