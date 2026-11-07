// ADR-020 §E (S11): view model of «Запись сессии». Every key exists in ru and en with the same placeholders and the
// brief's exact wording; the tone is attention for «похоже» / «записывает» and muted otherwise — never green or red;
// the popup shows ≤ 2 receivers; masking is «не подтверждено» unless a typed value was seen in a request to a periodic
// receiver; coverage and limitations are next to the level; no forbidden wording (docs/ui-copy.md §6.14.E).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProtectProjection, ProtectTransferEvidence, ReplaySummary } from '@detect-expert/contracts';
import { resolveMessage } from '../src/view-models/message';
import type { Message } from '../src/view-models/message';
import {
  REPLAY_BODY_KEYS,
  REPLAY_CONFIDENCE_KEYS,
  REPLAY_LEVEL_KEYS,
  REPLAY_LIMITATION_KEYS,
  REPLAY_POPUP_RECEIVERS,
  REPLAY_SIGNAL_KEYS,
  REPLAY_TONES,
  isShowableReplay,
  replayDetailsView,
  replayRowView,
} from '../src/view-models/protect-replay';

type Table = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;
const ru = JSON.parse(readFileSync(resolve('apps/extension/_locales/ru/messages.json'), 'utf8')) as Table;
const en = JSON.parse(readFileSync(resolve('apps/extension/_locales/en/messages.json'), 'utf8')) as Table;

function render(table: Table, m: Message): string {
  return resolveMessage((key, subs = []) => {
    const entry = table[key];
    if (entry === undefined) throw new Error('missing locale key ' + key);
    return entry.message.replace(/\$([A-Z_]+)\$/g, (_, name: string) => {
      const ph = entry.placeholders?.[name.toLowerCase()];
      if (ph === undefined) throw new Error(key + ': no placeholder ' + name);
      return subs[Number(ph.content.slice(1)) - 1] ?? '';
    });
  }, m);
}

function summary(over: Partial<ReplaySummary> = {}): ReplaySummary {
  return {
    ruleId: 'session-replay-behavior',
    ruleVersion: '1',
    level: 'replay-like',
    interpretationConfidence: 'low',
    attributionConfidence: 'unknown',
    signals: [
      { code: 'root-input-listeners', techniqueId: 'DET-043', evidenceSource: 'page-hook', integrity: 'page-controlled', count: 4, countQuality: 'exact', linkedSite: 'example.com' },
      { code: 'root-mutation-observe', evidenceSource: 'page-hook', integrity: 'page-controlled', count: 1, countQuality: 'exact' },
      { code: 'periodic-third-party-send', evidenceSource: 'browser-network', integrity: 'browser-observed', count: 6, countQuality: 'exact', linkedSite: 'example.net' },
    ],
    periodicHosts: [
      { registrableDomain: 'example.net', runMax: 6, sends: 6, largeInRunMax: 6, bodySize: '1k-16k' },
      { registrableDomain: 'second.org', runMax: 4, sends: 4, largeInRunMax: 0, bodySize: 'not-observed' },
      { registrableDomain: 'third.org', runMax: 3, sends: 3, largeInRunMax: 3, bodySize: 'over-16k' },
    ],
    vendors: [],
    inputMasking: 'unconfirmed',
    limitationCodes: ['element-listeners-not-observed', 'mo-options-not-read', 'websocket-not-observed', 'vendor-rules-disabled', 'masking-not-verifiable', 'uncalibrated-threshold'],
    ...over,
  };
}

function report(replay: ReplaySummary | null, over: Partial<ProtectProjection> = {}): ProtectProjection {
  return {
    protectRevision: 3,
    documentKey: '7:0:DOC',
    site: 'example.com',
    moduleState: 'active',
    features: ['session-replay'],
    coverageState: 'active',
    limitations: [],
    evidence: [],
    previousDocumentEvidence: 0,
    firewall: { enforcement: 'off', preset: 'normal', topDomainsSupported: false, stoppedToday: { count: 0, countQuality: 'lower-bound' }, snoozedUntil: null, prompt: null, receivers: [], notices: [], onceRules: [] },
    replay,
    gpc: null,
    dropped: { evidence: 0, fingerprints: 0, bodies: 0, events: 0 },
    ...over,
  } as ProtectProjection;
}

const replayKeys = (table: Table) => Object.keys(table).filter((k) => k.startsWith('replay_'));

describe('locales of «Запись сессии»', () => {
  it('ru and en have the same replay_* keys and placeholders; every key of the view model exists', () => {
    expect(replayKeys(en).sort()).toEqual(replayKeys(ru).sort());
    for (const key of replayKeys(ru)) expect(Object.keys(en[key]?.placeholders ?? {}).sort(), key).toEqual(Object.keys(ru[key]?.placeholders ?? {}).sort());
    const used = [...Object.values(REPLAY_LEVEL_KEYS), ...Object.values(REPLAY_SIGNAL_KEYS), ...Object.values(REPLAY_BODY_KEYS), ...Object.values(REPLAY_CONFIDENCE_KEYS), ...Object.values(REPLAY_LIMITATION_KEYS)];
    for (const key of used) {
      expect(ru[key]?.message, key).toBeTruthy();
      expect(en[key]?.message, key).toBeTruthy();
    }
  });

  it('exact wording of the brief', () => {
    expect(ru['replay_section_title']!.message).toBe('Запись сессии');
    expect(ru['replay_level_like']!.message).toBe('Похоже на запись сессии');
    expect(ru['replay_level_recording']!.message).toBe('Записывает сессию');
    expect(en['replay_level_like']!.message).toBe('Looks like session recording');
    expect(en['replay_level_recording']!.message).toBe('Records the session');
    expect(ru['replay_level_none']!.message).toBe('Признаков записи сессии в доступной области за этот период не наблюдалось');
    expect(ru['replay_masking_unconfirmed']!.message).toBe('Маскирование ввода: не подтверждено. Расширение не видит настроек записи и не разбирает отправленные данные');
    expect(ru['replay_signal_periodic']!.placeholders).toEqual({ site: { content: '$1' }, run: { content: '$2' } });
    expect(ru['replay_masking_value_seen']!.placeholders).toEqual({ site: { content: '$1' } });
    expect(ru['replay_disclaimer']!.message).toBe('Это не оценка безопасности сайта. Запись сессий используют для аналитики и поддержки; распознанный сервис не означает доверия');
  });

  it('forbidden wording never appears (no absence of masking, no vendor verdict, no «следит», no safety claim)', () => {
    const forbidden = [
      /маскирование отсутствует/i, /не маскирует/i, /следит за вами/i, /сайт следит/i, /легитим/i, /гарантир/i, /100\s?%/, /невидим/i, /придерж/i,
      /(?<!без)опасн/i, /вредонос/i, /зашифрован/i, /пытается отправить/i, /вы защищены/i,
      /masking is (?:absent|off)/i, /watches you/i, /spies/i, /legitimate/i, /guarantee/i, /\bsafe\b/i, /trusted/i, /\bencrypted\b/i,
    ];
    for (const table of [ru, en]) {
      for (const key of replayKeys(table)) for (const pattern of forbidden) expect(pattern.test(table[key]!.message), key + ' ' + String(pattern)).toBe(false);
    }
  });
});

describe('popup row', () => {
  it('replay-like: attention pill, low confidence, basis, autocapture note, two receivers, masking not confirmed, coverage, disclaimer', () => {
    const vm = replayRowView(report(summary()))!;
    expect(vm.tone).toBe('attention');
    expect(render(ru, vm.title)).toBe('Похоже на запись сессии');
    expect(render(ru, vm.confidence)).toBe(ru['confidence_low']!.message);
    expect(vm.basis).not.toBeNull();
    expect(vm.likeNote).not.toBeNull();
    expect(vm.receivers.map((r) => r.site)).toEqual(['example.net', 'second.org']);
    expect(REPLAY_POPUP_RECEIVERS).toBe(2);
    expect(vm.hiddenReceivers).toBe(1);
    expect(render(ru, vm.receivers[0]!.text)).toBe('Периодические отправки на example.net: до 6 подряд с интервалом 1–15 с');
    expect(render(en, vm.receivers[1]!.body)).toBe('body size not observed');
    expect(render(ru, vm.masking)).toBe(ru['replay_masking_unconfirmed']!.message);
    expect(vm.vendorRulesDisabled).not.toBeNull();
    expect(vm.coverage).not.toBeNull();
    expect(render(ru, vm.disclaimer)).toContain('не оценка безопасности');
  });

  it('tones are attention or muted only — never green or red, whatever the level', () => {
    for (const level of ['none', 'signals-only', 'replay-like', 'replay-recording'] as const) {
      const vm = replayRowView(report(summary({ level, interpretationConfidence: level === 'replay-recording' ? 'medium' : level === 'replay-like' ? 'low' : 'unassessed' })))!;
      expect(['attention', 'muted']).toContain(vm.tone);
      expect(vm.tone).toBe(REPLAY_TONES[level]);
    }
    expect(REPLAY_TONES['replay-recording']).toBe('attention');
    expect(REPLAY_TONES['signals-only']).toBe('muted');
    const css = readFileSync(resolve('packages/ui/src/styles/protect/replay.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/--error|green|#0[0-9a-f]{2}0|success/i);
    for (const file of ['ReplayRow.tsx', 'ReplayDetails.tsx']) {
      const src = readFileSync(resolve('packages/ui/src/components/protect/replay/' + file), 'utf8');
      expect(src, file).not.toMatch(/pill--error|--error|success/);
    }
  });

  it('none: muted, no basis and no autocapture note; recording: medium confidence', () => {
    const none = replayRowView(report(summary({ level: 'none', interpretationConfidence: 'unassessed', signals: [], periodicHosts: [] })))!;
    expect(none).toMatchObject({ tone: 'muted', basis: null, likeNote: null, receivers: [] });
    expect(render(en, none.title)).toBe('No signs of session recording were observed in the covered area during this period');
    const rec = replayRowView(report(summary({ level: 'replay-recording', interpretationConfidence: 'medium', attributionConfidence: 'sampled-stack' })))!;
    expect(render(ru, rec.title)).toBe('Записывает сессию');
    expect(render(ru, rec.confidence)).toBe(ru['confidence_medium']!.message);
    expect(rec.likeNote).toBeNull();
  });

  it('masking: «value seen» only for a value-match receiver among the periodic receivers', () => {
    const ev = { protectKind: 'value-match', receiver: 'example.net' } as ProtectTransferEvidence;
    const vm = replayRowView(report(summary({ inputMasking: 'value-seen-in-traffic' }), { evidence: [ev] }))!;
    expect(render(ru, vm.masking)).toBe('Введённое значение найдено в запросе к example.net — см. «Передача введённых данных»');
    const other = replayRowView(report(summary({ inputMasking: 'value-seen-in-traffic' }), { evidence: [{ ...ev, receiver: 'elsewhere.org' }] }))!;
    expect(render(ru, other.masking)).toBe(ru['replay_masking_unconfirmed']!.message);
  });

  it('nothing to show: no projection, no summary, a malformed summary', () => {
    expect(replayRowView(null)).toBeNull();
    expect(replayRowView(report(null))).toBeNull();
    expect(replayRowView(report({ ...summary(), level: 'high' } as unknown as ReplaySummary))).toBeNull();
    expect(isShowableReplay({ ...summary(), signals: 'x' })).toBe(false);
  });
});

describe('side panel details', () => {
  it('signals with their trust axes, every receiver, limitations with text and the level help', () => {
    const vm = replayDetailsView(report(summary({ vendors: [{ vendorId: 'test-replay', vendorConfidence: 'documented-resource', ruleIds: ['test-replay-loader'], evidenceSource: 'browser-network', integrity: 'browser-observed' }], signals: [...summary().signals, { code: 'replay-vendor-resource', evidenceSource: 'browser-network', integrity: 'browser-observed', count: 1, countQuality: 'exact' }] })))!;
    expect(vm.signals.map((s) => [s.code, s.integrity, s.evidenceSource])).toEqual([
      ['root-input-listeners', 'page-controlled', 'page-hook'],
      ['root-mutation-observe', 'page-controlled', 'page-hook'],
      ['periodic-third-party-send', 'browser-observed', 'browser-network'],
      ['replay-vendor-resource', 'browser-observed', 'browser-network'],
    ]);
    expect(render(ru, vm.signals[0]!.script!)).toContain('example.com');
    expect(vm.signals[1]!.script).toBeNull();
    expect(render(en, vm.signals[3]!.text)).toBe('A resource matched an enabled rule of a session recording service: test-replay');
    expect(vm.row.receivers).toHaveLength(3);
    const limits = vm.limitations.map((m) => render(ru, m));
    expect(limits).toContain(ru['replay_limit_element_listeners']!.message);
    expect(limits).toContain(ru['replay_limit_websocket']!.message);
    expect(limits).toContain(ru['replay_limit_uncalibrated']!.message);
    expect(limits).not.toContain(ru['replay_vendor_rules_disabled']!.message); // shown once, as its own line
    expect(vm.levels.map((m) => render(ru, m))).toHaveLength(4);
    expect(render(ru, vm.levels[2]!)).toMatch(/^Похоже на запись сессии — /);
  });

  it('every rendered text is free of URLs and values (the data has none)', () => {
    const vm = replayDetailsView(report(summary()))!;
    const all = [vm.row.title, vm.row.confidence, vm.row.masking, vm.row.disclaimer, ...vm.row.receivers.flatMap((r) => [r.text, r.body]), ...vm.signals.map((s) => s.text), ...vm.limitations, ...vm.levels].map((m) => render(en, m)).join('\n');
    expect(all).not.toMatch(/https?:|\?|@/);
  });
});
