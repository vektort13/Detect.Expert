// ADR-020 §D, §11 (S09): view model of the firewall card — truthful states («Остановлено» only for stopped with a
// basis; unknown never becomes sent), buttons per state (decide / warn-only / no DNR / SP-1 restart), multi receivers,
// scopes, rows, evidence, notices, outcome, defensive reading of the projection; foundation follow-ups (coverage text,
// Options tabs).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DELIVERY_STATES, ENFORCEMENT_STATES } from '@detect-expert/contracts';
import type { ProtectProjection } from '@detect-expert/contracts';
import { resolveMessage } from '../src/view-models/message';
import type { Message } from '../src/view-models/message';
import {
  EMPTY_FIREWALL_DRAFT,
  bestEvidenceFor,
  firewallCardView,
  firewallLiveText,
  firewallNeedsRestart,
  firewallNotices,
  firewallResolvedView,
  firewallSnoozedUntil,
  readDecisionAnswer,
  readFirewallView,
  receiverAlertState,
} from '../src/view-models/protect-firewall';
import type { FirewallCardVM, FirewallText } from '../src/view-models/protect-firewall';
import { optionsHasProtectTabs, protectCoverageMessage, protectStatusView } from '../src/view-models/protect';
import { evidenceListView } from '../src/view-models/protect-evidence';
import {
  FW_MULTI,
  FW_PROMPT_ID,
  FW_RECEIVER,
  FW_SCREENS,
  FW_SITE,
  FW_UNDO_ID,
  fwEvidence,
  fwProjection,
  fwReceiver,
  fwScenario,
  fwState,
  fwStoppedReceiver,
} from './protect-firewall-support';

type Table = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;
const ru = JSON.parse(readFileSync(resolve('apps/extension/_locales/ru/messages.json'), 'utf8')) as Table;

function tr(key: string, subs?: ReadonlyArray<string>): string {
  const entry = ru[key];
  if (entry === undefined) throw new Error('missing key ' + key);
  return entry.message.replace(/\$([A-Z_]+)\$/gi, (_, name: string) => subs?.[Number(entry.placeholders?.[name.toLowerCase()]?.content.slice(1)) - 1] ?? '');
}

function render(value: Message | FirewallText): string {
  if (typeof value === 'string') return value;
  if ('join' in value) return value.join.map((v) => (typeof v === 'string' ? v : resolveMessage(tr, v))).join(value.separator ?? ', ');
  return resolveMessage(tr, value);
}

/** Every text of the card a user can read (resolved, ru). */
function cardText(vm: FirewallCardVM): string {
  return [
    vm.title, vm.siteLine, vm.alert.message, vm.note, ...vm.chips, ...vm.rows.flatMap((r) => [r.label, r.value, r.extra]),
    ...(vm.evidence?.lines ?? []), vm.scriptNote, ...vm.receivers.map((r) => r.stateLabel), vm.hidden, ...vm.scopes.flatMap((s) => [s.label, s.desc]),
    vm.scopeNote, vm.ruleEffect, vm.blockLabel, vm.allowDesc, vm.blockingNotice?.message ?? null, vm.modeNote, ...vm.notices.map((n) => n.message),
  ].filter((m): m is Message => m !== null).map(render).join('\n');
}

const STATE = fwState();

describe('receiverAlertState (ADR-020 §11 guard)', () => {
  it('stopped needs a basis: the matched request was stopped, a stopped request was counted, an effective block rule, not warn-only', () => {
    expect(receiverAlertState(fwStoppedReceiver(), 'active', 'stopped')).toBe('stopped');
    expect(receiverAlertState(fwStoppedReceiver(), 'degraded', 'stopped')).toBe('stopped');
    expect(receiverAlertState({ ...fwStoppedReceiver(), effectiveRule: null }, 'active', 'stopped')).toBe('unknown');
    expect(receiverAlertState({ ...fwStoppedReceiver(), effectiveRule: { action: 'allow', scope: 'site', origin: 'user' } }, 'active', 'stopped')).toBe('unknown');
    expect(receiverAlertState({ ...fwStoppedReceiver(), delivery: { sent: 1, stopped: 0, stoppedOther: 0, unknown: 0 } }, 'active', 'stopped')).toBe('unknown');
    expect(receiverAlertState(fwStoppedReceiver(), 'warn-only', 'stopped')).toBe('unknown');
    expect(receiverAlertState(undefined, 'active', 'stopped')).toBe('unknown');
  });

  it('review round 2: the state follows the request that carried the value, never lastDelivery; unknown never becomes sent', () => {
    for (const enforcement of ENFORCEMENT_STATES) {
      for (const last of DELIVERY_STATES) {
        const view = fwReceiver(FW_RECEIVER, { lastDelivery: last, effectiveRule: { action: 'block', scope: 'site', origin: 'user' }, delivery: { sent: 1, stopped: 2, stoppedOther: 0, unknown: 0 } });
        expect(receiverAlertState(view, enforcement, 'unknown')).toBe('unknown');
        expect(receiverAlertState(view, enforcement, 'stopped-other')).toBe('unknown');
        expect(receiverAlertState(view, enforcement, null)).toBe('unknown');
        expect(receiverAlertState(view, enforcement, 'sent')).toBe('sent');
      }
      expect(receiverAlertState(undefined, enforcement, null)).toBe('unknown');
    }
  });
});

describe('firewallCardView: «Остановлено» only for stopped with a basis', () => {
  it('no state yields «остановлен» except stopped with an effective block rule; «отправлен» only for a sent data request', () => {
    const variants = [];
    for (const matched of DELIVERY_STATES) for (const last of DELIVERY_STATES) for (const rule of [null, { action: 'block' as const, scope: 'site' as const, origin: 'user' as const }]) for (const stopped of [0, 2]) {
      for (const enforcement of ['active', 'degraded', 'warn-only', 'no-permission'] as const) {
        variants.push({ matched, last, rule, stopped, enforcement });
      }
    }
    expect(variants).toHaveLength(256);
    for (const v of variants) {
      const report = fwProjection({
        receivers: [fwReceiver(FW_RECEIVER, { lastDelivery: v.last, effectiveRule: v.rule, delivery: { sent: 1, stopped: v.stopped, stoppedOther: 0, unknown: 0 } })],
        evidence: [fwEvidence(FW_RECEIVER, { deliveryState: v.matched })],
        firewall: { enforcement: v.enforcement },
      });
      const vm = firewallCardView(STATE, report)!;
      const basis = v.matched === 'stopped' && v.rule !== null && v.stopped > 0 && v.enforcement !== 'warn-only';
      const alert = render(vm.alert.message).toLowerCase();
      expect(alert.includes('остановлен'), JSON.stringify(v)).toBe(basis);
      expect(vm.alert.state).toBe(basis ? 'stopped' : v.matched === 'sent' ? 'sent' : 'unknown');
      // The receiver line of the list follows the same rule.
      expect(render(vm.receivers[0]!.stateLabel).toLowerCase().includes('остановлен')).toBe(basis);
      // No other text of the card says «остановлен» (the lower-bound counter of the footer is not a request state).
      expect(/остановлен/i.test(cardText(vm)), JSON.stringify(v)).toBe(basis);
      // «уже отправлен» and «Что ушло» only when Chrome sent the request that carried the value (not lastDelivery).
      expect(/уже отправлен/i.test(cardText(vm)), JSON.stringify(v)).toBe(v.matched === 'sent');
      expect(vm.rows.find((r) => r.id === 'data')!.label.key, JSON.stringify(v)).toBe(v.matched === 'sent' ? 'fw_row_data' : 'fw_row_data_found');
    }
  });

  it('review round 2 (probe B): the data request was stopped by another extension, then an unrelated request to the receiver was sent', () => {
    // The receiver view counts every request to the receiver's domain: a script from cdn.tracker.example.net made its
    // lastDelivery `sent`. The only request that carried the value is `stopped-other`.
    const view = fwReceiver('example.net', { lastDelivery: 'sent', delivery: { sent: 1, stopped: 0, stoppedOther: 0, unknown: 0 } });
    const vm = firewallCardView(STATE, fwProjection({ receivers: [view], evidence: [fwEvidence('example.net', { deliveryState: 'stopped-other' })] }))!;
    expect(vm.alert).toMatchObject({ state: 'unknown', tone: 'neutral' });
    expect(render(vm.alert.message)).toBe(tr('fw_alert_unknown', ['example.net', 'e-mail']));
    expect(render(vm.rows.find((r) => r.id === 'data')!.label)).toBe(tr('fw_row_data_found'));
    expect(render(vm.receivers[0]!.stateLabel)).toBe(tr('fw_state_unknown'));
    expect(cardText(vm)).not.toMatch(/уже отправлен|Что ушло/);
    // Without a transfer record in this page's report (e.g. after a same-site navigation) nothing is claimed either.
    const none = firewallCardView(STATE, fwProjection({ receivers: [view], evidence: [] }))!;
    expect(none.alert.state).toBe('unknown');
    expect(render(none.alert.message)).toBe(tr('fw_alert_unknown', ['example.net', 'e-mail']));
  });

  it('review round 2: «Что ушло» names only the field kinds found in sent requests; the moment is that of the shown record', () => {
    const view = fwReceiver(FW_RECEIVER, { fieldKinds: ['email', 'phone'], submitTiming: 'after-submit', sinceInput: 'gt-30s' });
    const evidence = [fwEvidence(FW_RECEIVER), fwEvidence(FW_RECEIVER, { evidenceId: 'pe-phone1', fieldKind: 'phone', deliveryState: 'stopped-other' })];
    const vm = firewallCardView(STATE, fwProjection({ receivers: [view], evidence }))!;
    expect(vm.alert.state).toBe('sent');
    expect(render(vm.alert.message)).toBe(tr('fw_alert_sent_before_submit', [FW_RECEIVER, 'e-mail']));
    expect(render(vm.rows.find((r) => r.id === 'data')!.value)).toBe(tr('fw_data_param', ['e-mail', 'ud[em]']));
    expect(render(vm.rows.find((r) => r.id === 'moment')!.value)).toBe(tr('fw_moment_before_submit') + ' · ' + tr('protect_since_1_5s'));
  });

  it('sent: attention alert, «уже отправлен — ещё до отправки формы», the note that a sent request cannot be recalled', () => {
    const vm = firewallCardView(STATE, fwProjection())!;
    expect(vm.alert).toMatchObject({ state: 'sent', tone: 'attention' });
    expect(render(vm.alert.message)).toBe(tr('fw_alert_sent_before_submit', [FW_RECEIVER, 'e-mail']));
    expect(render(vm.note!)).toBe(tr('fw_sent_note'));
    const after = firewallCardView(STATE, fwProjection({ receivers: [fwReceiver(FW_RECEIVER, { submitTiming: 'after-submit', fieldKinds: ['email', 'phone'] })] }))!;
    expect(render(after.alert.message)).toBe(tr('fw_alert_sent', [FW_RECEIVER, 'e-mail, телефон']));
    expect(render(after.rows.find((r) => r.id === 'data')!.label)).toBe(tr('fw_row_data'));
  });

  it('stopped and unknown are neutral; unknown says the outcome was not observed and never «Что ушло»', () => {
    const stopped = firewallCardView(STATE, fwProjection({ receivers: [fwStoppedReceiver()] }))!;
    expect(stopped.alert).toMatchObject({ state: 'stopped', tone: 'neutral' });
    expect(render(stopped.alert.message)).toBe(tr('fw_alert_stopped', [FW_RECEIVER]));
    expect(stopped.note).toBeNull();
    const unknown = firewallCardView(STATE, fwScenario('unknown').report)!;
    expect(unknown.alert).toMatchObject({ state: 'unknown', tone: 'neutral' });
    expect(render(unknown.alert.message)).toBe(tr('fw_alert_unknown', [FW_RECEIVER, 'e-mail']));
    for (const vm of [stopped, unknown]) expect(render(vm.rows.find((r) => r.id === 'data')!.label)).toBe(tr('fw_row_data_found'));
    expect(cardText(unknown)).not.toMatch(/уже отправлен/);
  });
});

describe('firewallCardView: buttons per state', () => {
  it('active / degraded: decide with block next and allow; keep blocking when every selected receiver is blocked', () => {
    const vm = firewallCardView(STATE, fwProjection())!;
    expect(vm.mode).toBe('decide');
    expect(vm.blockLabel.key).toBe('fw_action_block_next');
    expect(vm.allowDesc.key).toBe('fw_action_allow_desc');
    expect(vm.canDecide).toBe(true);
    expect(vm.blockingNotice).toBeNull();
    const blocked = firewallCardView(STATE, fwProjection({ receivers: [fwStoppedReceiver()] }))!;
    expect(blocked.blockLabel.key).toBe('fw_action_keep_blocked');
    const mixed = firewallCardView(STATE, fwScenario('multi').report)!;
    expect(mixed.blockLabel.key).toBe('fw_action_block_next');
    expect(firewallCardView(STATE, fwScenario('multi').report, { scope: 'site', unchecked: [FW_MULTI[0], FW_MULTI[2]] })!.blockLabel.key).toBe('fw_action_keep_blocked');
  });

  it('warn-only: «Понятно» only; no permission: «Понятно» and «Блокировка недоступна»', () => {
    const warn = firewallCardView(STATE, fwScenario('warn-only').report)!;
    expect(warn.mode).toBe('ack');
    expect(warn.blockingNotice).toBeNull();
    expect(warn.modeNote).toEqual({ key: 'protect_preset_warn_only' });
    expect(firewallCardView(STATE, fwProjection())!.modeNote).toBeNull();
    const none = firewallCardView(STATE, fwProjection({ firewall: { enforcement: 'no-permission' } }))!;
    expect(none.mode).toBe('unavailable');
    expect(none.blockingNotice!.message.key).toBe('fw_blocking_unavailable');
  });

  it('SP-1 (degraded, api-unavailable): decide, with the restart notice; other degraded codes: not fully applied', () => {
    const restart = fwScenario('resolved-error');
    const vm = firewallCardView(restart.state, restart.report)!;
    expect(vm.mode).toBe('decide');
    expect(vm.blockingNotice!.message.key).toBe('fw_blocking_restart');
    expect(firewallNeedsRestart(restart.report)).toBe(true);
    for (const code of ['rule-limit', 'update-rejected', 'cleanup-pending'] as const) {
      const other = firewallCardView(STATE, fwProjection({ firewall: { enforcement: 'degraded', degradedCode: code } }))!;
      expect(other.blockingNotice!.message.key).toBe('fw_blocking_degraded');
    }
    expect(firewallNeedsRestart(fwProjection())).toBe(false);
  });

  it('no receiver selected: the decision buttons do nothing (canDecide false)', () => {
    const vm = firewallCardView(STATE, fwProjection(), { scope: 'site', unchecked: [FW_RECEIVER] })!;
    expect(vm.selected).toEqual([]);
    expect(vm.canDecide).toBe(false);
  });
});

describe('firewallCardView: content', () => {
  it('head, chips, rows: sender page, company not checked, receiver, data with the parameter, moment', () => {
    const vm = firewallCardView(STATE, fwProjection())!;
    expect(render(vm.title)).toBe(tr('fw_card_title'));
    expect(render(vm.siteLine)).toBe(tr('fw_card_site', [FW_SITE]));
    expect(vm.chips.map(render)).toEqual(['e-mail', 'хэш SHA-256 (hex)']);
    const rows = Object.fromEntries(vm.rows.map((r) => [r.id, [render(r.label), render(r.value), r.extra === null ? null : render(r.extra)]]));
    expect(rows['sender']).toEqual([tr('fw_row_sender'), tr('fw_sender_top', [FW_SITE]), null]);
    expect(rows['company']).toEqual([tr('fw_row_company'), tr('fw_company_not_checked'), null]);
    expect(rows['receiver']).toEqual([tr('fw_row_receiver'), FW_RECEIVER, null]);
    expect(rows['data']).toEqual([tr('fw_row_data'), tr('fw_data_param', ['e-mail', 'ud[em]']), null]);
    expect(rows['moment']).toEqual([tr('fw_row_moment'), tr('fw_moment_before_submit') + ' · ' + tr('protect_since_1_5s'), null]);
    expect(vm.scriptNote!.key).toBe('fw_sender_script_unknown');
  });

  it('a script is named only from a sampled stack (and said to be forgeable); frames and unknown frames', () => {
    const sampled = firewallCardView(STATE, fwProjection({ receivers: [fwReceiver(FW_RECEIVER, { sender: { frame: 'subframe', initiatorSite: 'widget.example', attributionConfidence: 'sampled-stack', script: { kind: 'external', scheme: 'https', host: 'cdn.collect.example.net', pathTemplate: '/sdk.js' } } })] }))!;
    const sender = sampled.rows[0]!;
    expect(render(sender.value)).toBe(tr('fw_sender_frame', ['widget.example']));
    expect(render(sender.extra!)).toBe(tr('fw_sender_script_sampled', ['cdn.collect.example.net']));
    expect(sampled.scriptNote).toBeNull();
    // frame-only with a script field: not shown.
    const frameOnly = firewallCardView(STATE, fwProjection({ receivers: [fwReceiver(FW_RECEIVER, { sender: { frame: 'opaque', initiatorSite: null, attributionConfidence: 'frame-only', script: { kind: 'external', host: 'x.example.net' } } })] }))!;
    expect(render(frameOnly.rows[0]!.value)).toBe(tr('fw_sender_frame_unknown'));
    expect(frameOnly.rows[0]!.extra).toBeNull();
  });

  it('company only through an active catalog match (none in production), with «not an assessment»', () => {
    const vm = firewallCardView(STATE, fwProjection({ receivers: [fwReceiver(FW_RECEIVER, { vendorId: 'test-vendor', vendorConfidence: 'documented-resource' })] }))!;
    const company = vm.rows.find((r) => r.id === 'company')!;
    expect(company.value).toBe('test-vendor');
    expect(company.extra!.key).toBe('fw_company_no_trust');
    const none = firewallCardView(STATE, fwProjection({ receivers: [fwReceiver(FW_RECEIVER, { vendorId: 'test-vendor', vendorConfidence: 'none' })] }))!;
    expect(none.rows.find((r) => r.id === 'company')!.value).toEqual({ key: 'fw_company_not_checked' });
  });

  it('evidence: request template, request type, where, encoding, match by field type, hash note, confidence, integrity', () => {
    const vm = firewallCardView(STATE, fwProjection())!;
    expect(vm.evidence!.request).toBe('GET px.collect.example.net/tr');
    expect(vm.evidence!.lines.map((m) => m.key)).toEqual(['fw_ev_kind', 'protect_where_param', 'fw_ev_encoding', 'fw_ev_match', 'protect_hash_note', 'confidence_high', 'integrity_derived']);
    expect(render(vm.evidence!.lines[3]!)).toBe(tr('fw_ev_match', ['e-mail']));
    const none = firewallCardView(STATE, fwProjection({ evidence: [] }))!;
    expect(none.evidence).toBeNull();
    // No value, hash, mask, value length, URL or query in any text.
    expect(cardText(vm)).not.toMatch(/https?:|\?|@|[0-9a-f]{16}/i);
  });

  it('bestEvidenceFor prefers before-submit, then confidence, then the latest record of that receiver', () => {
    const a = fwEvidence(FW_RECEIVER, { evidenceId: 'pe-a', transferClass: 'third-party-at-submit', interpretationConfidence: 'high', lastSecond: 9 });
    const b = fwEvidence(FW_RECEIVER, { evidenceId: 'pe-b', interpretationConfidence: 'medium', lastSecond: 2 });
    const c = fwEvidence(FW_RECEIVER, { evidenceId: 'pe-c', interpretationConfidence: 'high', lastSecond: 1 });
    const d = fwEvidence(FW_RECEIVER, { evidenceId: 'pe-d', interpretationConfidence: 'high', lastSecond: 5 });
    const other = fwEvidence('other.example.org', { evidenceId: 'pe-o' });
    expect(bestEvidenceFor(fwProjection({ evidence: [a, b, c, d, other] }), FW_RECEIVER)!.evidenceId).toBe('pe-d');
    expect(bestEvidenceFor(fwProjection({ evidence: [other] }), FW_RECEIVER)).toBeNull();
  });

  it('scopes: «Эта вкладка», «Этот сайт» (default), «Везде» with their descriptions', () => {
    const vm = firewallCardView(STATE, fwProjection())!;
    expect(vm.scope).toBe('site');
    expect(EMPTY_FIREWALL_DRAFT.scope).toBe('site');
    expect(vm.scopes.map((s) => [s.scope, render(s.label), render(s.desc)])).toEqual([
      ['once', tr('fw_scope_once'), tr('fw_scope_once_desc')],
      ['site', tr('fw_scope_site'), tr('fw_scope_site_desc', [FW_SITE])],
      ['everywhere', tr('fw_scope_everywhere'), tr('fw_scope_everywhere_desc', [FW_RECEIVER])],
    ]);
    expect(vm.scopeNote.key).toBe('fw_scope_no_vendor');
    expect(vm.ruleEffect.key).toBe('fw_rule_effect');
    expect(firewallCardView(STATE, fwProjection(), { scope: 'everywhere', unchecked: [] })!.scope).toBe('everywhere');
  });

  it('multi: title with the count (named + hidden), receivers with their states, all checked, primary = first checked', () => {
    const vm = firewallCardView(STATE, fwScenario('multi').report)!;
    expect(render(vm.title)).toBe(tr('fw_card_title_multi', ['5']));
    expect(vm.receivers.map((r) => [r.receiver, r.state, r.checked, r.blocked])).toEqual([
      [FW_MULTI[0], 'sent', true, false],
      [FW_MULTI[1], 'stopped', true, true],
      [FW_MULTI[2], 'unknown', true, false],
    ]);
    expect(render(vm.hidden!)).toBe(tr('fw_receivers_hidden', ['2']));
    expect(vm.primary).toBe(FW_MULTI[0]);
    expect(vm.pending).toBe(2);
    expect(render(firewallLiveText(vm)!)).toBe(tr('fw_live_pending', ['2']));
    const second = firewallCardView(STATE, fwScenario('multi').report, { scope: 'site', unchecked: [FW_MULTI[0]] })!;
    expect(second.primary).toBe(FW_MULTI[1]);
    expect(second.selected).toEqual([FW_MULTI[1], FW_MULTI[2]]);
    expect(render(second.scopes[2]!.desc)).toBe(tr('fw_scope_everywhere_desc', [FW_MULTI[1] + ', ' + FW_MULTI[2]]));
  });

  it('counter: lower bound only when > 0; notices (strict-auto with undo, escalate, bypass, limit)', () => {
    expect(firewallCardView(STATE, fwProjection())!.counter).toBeNull();
    const vm = firewallCardView(STATE, fwProjection({
      // strict-auto made a site block of the preset: the receiver's effective rule blocks.
      receivers: [fwReceiver(FW_RECEIVER, { effectiveRule: { action: 'block', scope: 'site', origin: 'preset' } })],
      firewall: { stoppedToday: { count: 7, countQuality: 'lower-bound' } },
      notices: [
        { kind: 'strict-auto', receiver: FW_RECEIVER, site: FW_SITE, undoId: FW_UNDO_ID },
        { kind: 'strict-escalate', receiver: FW_RECEIVER, count: 3 },
        { kind: 'bypass', receiver: FW_RECEIVER, count: 2 },
        { kind: 'limit-reached', receiver: FW_RECEIVER },
      ],
    }))!;
    expect(render(vm.counter!)).toBe(tr('fw_counter_today', ['7']));
    expect(vm.counterNote!.key).toBe('fw_counter_note');
    expect(vm.notices.map((n) => [render(n.message), n.undoId])).toEqual([
      [tr('fw_strict_auto_notice', [FW_RECEIVER, FW_SITE]), FW_UNDO_ID],
      [tr('fw_strict_escalate', [FW_RECEIVER, '3']), null],
      [tr('fw_bypass', [FW_RECEIVER, '2']), null],
      [tr('fw_limit_reached', [FW_RECEIVER]), null],
    ]);
    // Without a prompt the notices are still shown (a bypass must not disappear).
    expect(firewallNotices(fwProjection({ prompt: null, notices: [{ kind: 'bypass', receiver: FW_RECEIVER, count: 1 }] })).length).toBe(1);
  });

  it('strict-auto «теперь останавливаются» only while enforcement is active and the receiver is blocked (review round 1)', () => {
    const blocked = fwReceiver(FW_RECEIVER, { effectiveRule: { action: 'block', scope: 'site', origin: 'preset' } });
    const notices = [
      { kind: 'strict-auto' as const, receiver: FW_RECEIVER, site: FW_SITE, undoId: FW_UNDO_ID },
      { kind: 'strict-escalate' as const, receiver: FW_RECEIVER, count: 2 },
    ];
    const kinds = (report: ProtectProjection): { card: string[] | null; alone: string[] } => ({
      card: firewallCardView(STATE, report)?.notices.map((n) => n.kind) ?? null,
      alone: firewallNotices({ ...report, firewall: { ...report.firewall, prompt: null } }).map((n) => n.kind),
    });
    expect(kinds(fwProjection({ receivers: [blocked], notices }))).toEqual({ card: ['strict-auto', 'strict-escalate'], alone: ['strict-auto', 'strict-escalate'] });
    // SP-1 (hung write), a rejected write, a cleanup in progress, no DNR: no «теперь останавливаются», with or without a card.
    for (const firewall of [
      { enforcement: 'degraded' as const, degradedCode: 'api-unavailable' as const },
      { enforcement: 'degraded' as const, degradedCode: 'update-rejected' as const },
      { enforcement: 'degraded' as const, degradedCode: 'cleanup-pending' as const },
      { enforcement: 'no-permission' as const },
      { enforcement: 'warn-only' as const, preset: 'warn-only' as const },
    ]) {
      const report = fwProjection({ receivers: [blocked], notices, firewall });
      const k = kinds(report);
      expect(k.alone, firewall.enforcement).toEqual(['strict-escalate']);
      if (k.card !== null) expect(k.card, firewall.enforcement).toEqual(['strict-escalate']);
      const card = firewallCardView(STATE, report);
      if (card !== null) expect(cardText(card)).not.toContain(tr('fw_strict_auto_notice', [FW_RECEIVER, FW_SITE]));
    }
    // Active, but the receiver's rule is gone (allowed or removed in Options): no claim either.
    expect(kinds(fwProjection({ receivers: [fwReceiver(FW_RECEIVER, { effectiveRule: { action: 'allow', scope: 'site', origin: 'user' } })], notices }))).toEqual({ card: ['strict-escalate'], alone: ['strict-escalate'] });
    expect(kinds(fwProjection({ receivers: [fwReceiver()], notices })).alone).toEqual(['strict-escalate']);
  });

  it('review round 3 (probe E): the strict-auto notice says nothing about the delivery of the request that triggered it', () => {
    // strict-auto is made from the evidence event of onBeforeRequest: the record's delivery is still unknown, and may
    // become stopped-other (another extension) or sent later. The notice must agree with every one of them.
    for (const lastDelivery of ['unknown', 'stopped-other', 'sent'] as const) {
      const receiver = fwReceiver(FW_RECEIVER, { effectiveRule: { action: 'block', scope: 'site', origin: 'preset' }, lastDelivery });
      const vm = firewallCardView(STATE, fwProjection({ receivers: [receiver], notices: [{ kind: 'strict-auto', receiver: FW_RECEIVER, site: FW_SITE, undoId: FW_UNDO_ID }] }))!;
      const notice = render(vm.notices.find((n) => n.kind === 'strict-auto')!.message);
      expect(notice, lastDelivery).toBe(tr('fw_strict_auto_notice', [FW_RECEIVER, FW_SITE]));
      expect(notice, lastDelivery).not.toMatch(/отправ|получ|уже был/i);
      expect(notice).toContain('начался до этого правила');
      // The delivery of that request is said by the card's state line only.
      expect(vm.alert.message.key, lastDelivery).toBe(lastDelivery === 'sent' ? 'fw_alert_sent_before_submit' : 'fw_alert_unknown');
    }
  });
});

describe('firewallCardView: when there is no card', () => {
  it('no prompt, snoozed, firewall feature off, module not running, malformed data -> null', () => {
    expect(firewallCardView(null, fwProjection())).toBeNull();
    expect(firewallCardView(STATE, null)).toBeNull();
    expect(firewallCardView(STATE, fwProjection({ prompt: null }))).toBeNull();
    expect(firewallCardView(STATE, fwScenario('snoozed').report)).toBeNull();
    expect(firewallCardView(fwState({ features: ['value-match'] }), fwProjection())).toBeNull();
    for (const state of ['off', 'needs-consent', 'needs-permission', 'organization-disabled'] as const) expect(firewallCardView(fwState({ state }), fwProjection())).toBeNull();
    const bad = (firewall: unknown): ProtectProjection => ({ ...fwProjection(), firewall } as ProtectProjection);
    expect(firewallCardView(STATE, bad(null))).toBeNull();
    expect(firewallCardView(STATE, bad({ ...fwProjection().firewall, enforcement: 'blocking' }))).toBeNull();
    expect(firewallCardView(STATE, bad({ ...fwProjection().firewall, prompt: { promptId: 'x', site: FW_SITE, receivers: [FW_RECEIVER], hidden: 0 } }))).toBeNull();
    expect(firewallCardView(STATE, bad({ ...fwProjection().firewall, prompt: { promptId: FW_PROMPT_ID, site: FW_SITE, receivers: ['https://x.example/?q=1'], hidden: 0 } }))).toBeNull();
  });

  it('readFirewallView skips malformed receivers and notices, keeps the rest', () => {
    const fw = { ...fwProjection().firewall, receivers: [fwReceiver(), { receiver: 'bad' }, { ...fwReceiver('b.example.org'), lastDelivery: 'held' }], notices: [{ kind: 'bypass', receiver: 'x.example.net' }, { kind: 'nonsense', receiver: 'x.example.net' }] };
    const view = readFirewallView(fw)!;
    expect(view.receivers.map((r) => r.receiver)).toEqual([FW_RECEIVER]);
    expect(view.notices.map((n) => n.kind)).toEqual(['bypass']);
  });

  it('snoozed line only while the firewall runs and the time is in the future', () => {
    const now = 1_000_000;
    expect(firewallSnoozedUntil(fwState({ snoozedUntil: now + 10 }), now)).toBe(now + 10);
    expect(firewallSnoozedUntil(fwState({ snoozedUntil: now - 10 }), now)).toBeNull();
    expect(firewallSnoozedUntil(fwState({ snoozedUntil: now + 10, features: ['value-match'] }), now)).toBeNull();
    expect(firewallSnoozedUntil(fwState({ snoozedUntil: now + 10, state: 'needs-permission' }), now)).toBeNull();
  });
});

describe('outcome of a decision', () => {
  it('readDecisionAnswer: domains and booleans only', () => {
    expect(readDecisionAnswer({ schemaVersion: 1, type: 'protect-decision', applied: [{ receiver: FW_RECEIVER, ruleApplied: true }], undoId: FW_UNDO_ID, report: null })).toEqual({ applied: [{ receiver: FW_RECEIVER, ruleApplied: true }], undoId: FW_UNDO_ID });
    expect(readDecisionAnswer({ type: 'protect-decision', applied: [{ receiver: 'https://x', ruleApplied: true }], undoId: null })).toBeNull();
    expect(readDecisionAnswer({ type: 'protect-decision', applied: [], undoId: 'nope' })).toBeNull();
    expect(readDecisionAnswer({ type: 'protect-report', applied: [] })).toBeNull();
  });

  it('blocked: «Следующие запросы будут остановлены» only for applied rules; otherwise the error (+ SP-1 restart)', () => {
    const base = { kind: 'decided' as const, action: 'block' as const, scope: 'site' as const, receivers: [FW_RECEIVER], undoId: FW_UNDO_ID, restart: false };
    const ok = firewallResolvedView({ ...base, applied: [{ receiver: FW_RECEIVER, ruleApplied: true }] });
    expect(ok).toMatchObject({ tone: 'neutral', undo: true });
    expect(render(ok.title)).toBe(tr('fw_resolved_blocked_title'));
    expect(render(ok.lines[0]!)).toBe(tr('fw_resolved_blocked_desc', [FW_RECEIVER]));
    const failed = firewallResolvedView({ ...base, applied: [{ receiver: FW_RECEIVER, ruleApplied: false }], restart: true });
    expect(failed.tone).toBe('error');
    expect(render(failed.title)).toBe(tr('fw_resolved_error', [FW_RECEIVER]));
    expect(failed.lines.map((m) => m.key)).toEqual(['fw_blocking_restart']);
    expect(render(failed.title).toLowerCase()).not.toContain('будут остановлены');
    const partial = firewallResolvedView({ ...base, receivers: [FW_MULTI[0], FW_MULTI[1]], applied: [{ receiver: FW_MULTI[0], ruleApplied: true }, { receiver: FW_MULTI[1], ruleApplied: false }] });
    expect(partial.tone).toBe('error');
    expect(partial.lines.map(render)).toEqual([tr('fw_resolved_blocked_desc', [FW_MULTI[0]]), tr('fw_resolved_error', [FW_MULTI[1]])]);
  });

  it('allowed and dismissed', () => {
    const allowed = firewallResolvedView({ kind: 'decided', action: 'allow', scope: 'site', receivers: [FW_RECEIVER], applied: [{ receiver: FW_RECEIVER, ruleApplied: true }], undoId: FW_UNDO_ID, restart: false });
    expect(render(allowed.title)).toBe(tr('fw_resolved_allowed_title'));
    expect(allowed.lines.map((m) => m.key)).toEqual(['fw_action_allow_desc']);
    const allowFailed = firewallResolvedView({ kind: 'decided', action: 'allow', scope: 'site', receivers: [FW_RECEIVER], applied: [{ receiver: FW_RECEIVER, ruleApplied: false }], undoId: null, restart: false });
    expect(allowFailed).toMatchObject({ tone: 'error', undo: false });
    expect(allowFailed.lines.map((m) => m.key)).toEqual(['fw_action_allow_desc', 'fw_blocking_degraded']);
    const dismissed = firewallResolvedView({ kind: 'dismissed', action: null, scope: null, receivers: [], applied: [], undoId: null, restart: false });
    expect(dismissed).toEqual({ title: { key: 'fw_resolved_dismissed' }, lines: [], tone: 'neutral', undo: false });
  });

  it('every screen scenario of the Playwright fixture builds (card or snoozed)', () => {
    for (const screen of FW_SCREENS) {
      const s = fwScenario(screen);
      const vm = firewallCardView(s.state, s.report);
      expect(vm === null, screen).toBe(screen === 'snoozed');
    }
  });
});

describe('foundation follow-ups (S09)', () => {
  it('coverage: paused says «сайт исключён» only with site-excluded; late-start before enable says «до перезагрузки»', () => {
    const p = (over: Partial<ProtectProjection>) => ({ ...fwProjection(), ...over });
    expect(protectCoverageMessage(p({ coverageState: 'paused', limitations: ['site-excluded'] })).key).toBe('protect_coverage_paused');
    expect(protectCoverageMessage(p({ coverageState: 'paused', limitations: [] })).key).toBe('protect_coverage_suspended');
    expect(protectCoverageMessage(p({ coverageState: 'late-start', limitations: ['late-start', 'loaded-before-enable'] })).key).toBe('protect_coverage_reload');
    expect(protectCoverageMessage(p({ coverageState: 'late-start', limitations: ['late-start'] })).key).toBe('protect_coverage_late_start');
    expect(protectCoverageMessage(p({ coverageState: 'active' })).key).toBe('protect_coverage_active');
    expect(tr('protect_coverage_reload')).toMatch(/не работает, пока страницу не перезагрузить/);
    expect(protectStatusView(STATE, p({ coverageState: 'paused' })).coverage).toEqual({ key: 'protect_coverage_line', subs: [{ key: 'protect_coverage_suspended' }] });
    expect(evidenceListView(p({ coverageState: 'paused' }), 5)!.coverage).toEqual({ key: 'protect_coverage_line', subs: [{ key: 'protect_coverage_suspended' }] });
  });

  it('Options tabs follow protectSurfaceVisible: an organization-disabled user who never enabled the module sees no tabs', () => {
    expect(optionsHasProtectTabs(fwState({ state: 'organization-disabled', organizationDisabled: true, consentVersion: null, features: [], decisions: 0 }))).toBe(false);
    expect(optionsHasProtectTabs(fwState({ state: 'organization-disabled', organizationDisabled: true, consentVersion: 1, features: ['value-match'], decisions: 0 }))).toBe(true);
    expect(optionsHasProtectTabs(fwState({ state: 'organization-disabled', organizationDisabled: true, consentVersion: null, features: [], decisions: 2 }))).toBe(true);
    expect(optionsHasProtectTabs(fwState({ state: 'off', consentVersion: null, features: [], decisions: 0 }))).toBe(false);
  });

  it('the blocking-unavailable reason carries the browser restart hint (SP-1, ADR-020 §7)', () => {
    expect(tr('protect_reason_blocking_unavailable')).toContain('после перезапуска браузера');
  });
});
