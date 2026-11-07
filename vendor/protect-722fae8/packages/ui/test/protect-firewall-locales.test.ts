// ADR-020 §D, §11 (S09): the firewall locale keys — key families match the contract enums, ru/en parity of keys and
// placeholders, the brief's texts, the forbidden wording (a request is never «held», the receiver never «won't get»
// data, no «утечка», no «вы защищены»), and «остановлен» only where a rule in place before the request is meant.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DECISION_SCOPES, FIREWALL_INACTIVE_REASONS, FIREWALL_NOTICE_KINDS, PROTECT_REQUEST_KINDS, SUBMIT_TIMINGS } from '@detect-expert/contracts';
import {
  FIREWALL_NOTICE_KEYS,
  FIREWALL_SCOPE_KEYS,
  FIREWALL_STATE_KEYS,
  REQUEST_KIND_KEYS,
  SUBMIT_TIMING_KEYS,
} from '../src/view-models/protect-firewall';
import { INACTIVE_REASON_KEYS } from '../src/view-models/protect-firewall-rules';

type Table = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;
const ru = JSON.parse(readFileSync(resolve('apps/extension/_locales/ru/messages.json'), 'utf8')) as Table;
const en = JSON.parse(readFileSync(resolve('apps/extension/_locales/en/messages.json'), 'utf8')) as Table;

const fwKeys = (table: Table): string[] => Object.keys(table).filter((k) => k.startsWith('fw_') || k === 'badge_tooltip_firewall');

const FORBIDDEN_RU = ['придерж', 'пытается отправ', 'не получит', 'утечк', 'вы защищ', 'сервер получил', 'опасн', 'вредонос', 'зашифрован'];
const FORBIDDEN_EN = ['held', 'will not receive', 'won’t receive', "won't receive", 'leak', 'you are protected', 'trying to send', 'server received', 'dangerous', 'malicious', 'encrypted'];

/** RU keys allowed to say «остановлен…»: a rule that was in place before the request, or the lower-bound counter. */
const STOPPED_KEYS = ['fw_alert_stopped', 'fw_state_stopped', 'fw_resolved_blocked_title', 'fw_counter_today', 'fw_counter_note'];

describe('firewall locale keys (S09)', () => {
  it('key families match the contract enums', () => {
    expect(Object.keys(FIREWALL_SCOPE_KEYS).sort()).toEqual([...DECISION_SCOPES].sort());
    expect(Object.keys(SUBMIT_TIMING_KEYS).sort()).toEqual([...SUBMIT_TIMINGS].sort());
    expect(Object.keys(REQUEST_KIND_KEYS).sort()).toEqual([...PROTECT_REQUEST_KINDS].sort());
    expect(Object.keys(FIREWALL_NOTICE_KEYS).sort()).toEqual([...FIREWALL_NOTICE_KINDS].sort());
    expect(Object.keys(INACTIVE_REASON_KEYS).sort()).toEqual([...FIREWALL_INACTIVE_REASONS].sort());
    expect(Object.keys(FIREWALL_STATE_KEYS).sort()).toEqual(['sent', 'stopped', 'unknown']);
    const keys = [
      ...Object.values(FIREWALL_SCOPE_KEYS).flatMap((k) => [k.label, k.desc]),
      ...Object.values(SUBMIT_TIMING_KEYS),
      ...Object.values(REQUEST_KIND_KEYS),
      ...Object.values(FIREWALL_NOTICE_KEYS),
      ...Object.values(INACTIVE_REASON_KEYS),
      ...Object.values(FIREWALL_STATE_KEYS),
    ];
    for (const table of [ru, en]) expect(keys.filter((k) => table[k]?.message === undefined)).toEqual([]);
  });

  it('ru and en have the same firewall keys and placeholders; every placeholder is used', () => {
    expect(fwKeys(en).sort()).toEqual(fwKeys(ru).sort());
    expect(fwKeys(ru).length).toBeGreaterThanOrEqual(110);
    for (const key of fwKeys(ru)) {
      expect(Object.keys(en[key]!.placeholders ?? {}).sort(), key).toEqual(Object.keys(ru[key]!.placeholders ?? {}).sort());
      for (const table of [ru, en]) {
        const used = [...table[key]!.message.matchAll(/\$([A-Za-z_]+)\$/g)].map((m) => m[1]!.toLowerCase()).sort();
        expect([...new Set(used)], key).toEqual(Object.keys(table[key]!.placeholders ?? {}).sort());
      }
    }
  });

  it('the brief’s texts', () => {
    expect(ru['fw_card_title']!.message).toBe('Введённые вами данные в запросе к другому сайту');
    expect(ru['fw_alert_sent']!.message).toBe('Запрос к $RECEIVER$ уже отправлен. В нём найдено то, что вы ввели: $DATA$.');
    expect(ru['fw_alert_stopped']!.message).toBe('Запрос к $RECEIVER$ остановлен правилом фаервола, которое действовало до этого запроса.');
    expect(ru['fw_alert_unknown']!.message).toBe('В запросе к $RECEIVER$ найдено то, что вы ввели: $DATA$. Был ли запрос отправлен, расширение не наблюдало.');
    expect(ru['fw_sent_note']!.message).toContain('Отправленный запрос вернуть нельзя');
    expect(ru['fw_action_block_next']!.message).toBe('Блокировать следующие');
    expect(ru['fw_counter_today']!.message).toBe('Остановлено правилами сегодня: не менее $COUNT$');
    expect(ru['fw_rule_effect']!.message).toContain('а не только запросы с вашими данными');
    expect(ru['badge_tooltip_firewall']!.message).toBe('Фаервол: адресов ждут решения — $N$. Откройте окно расширения, чтобы решить.');
    expect(en['fw_alert_unknown']!.message).toBe('A request to $RECEIVER$ contained what you entered: $DATA$. Whether it was sent was not observed by the extension.');
  });

  it('no forbidden wording in any firewall key (ru and en)', () => {
    for (const key of fwKeys(ru)) {
      const text = ru[key]!.message.toLowerCase();
      for (const phrase of FORBIDDEN_RU) expect(text.includes(phrase), key + ' ru contains ' + phrase).toBe(false);
    }
    for (const key of fwKeys(en)) {
      const text = en[key]!.message.toLowerCase();
      for (const phrase of FORBIDDEN_EN) expect(text.includes(phrase), key + ' en contains ' + phrase).toBe(false);
    }
    // The whole extension table never uses the prototype's wording either.
    for (const table of [ru, en]) for (const [key, entry] of Object.entries(table)) {
      const text = entry.message.toLowerCase();
      for (const phrase of ['придерживается', 'пытается отправить', 'не получит ваш', 'is being held', 'will not receive your']) expect(text.includes(phrase), key).toBe(false);
    }
  });

  it('review round 2: no firewall or transfer-list key says the receiver got the data (only Chrome sent a request)', () => {
    const keys = (table: Table): string[] => Object.keys(table).filter((k) => k.startsWith('fw_') || k.startsWith('protect_leak_'));
    expect(keys(ru).filter((k) => k.startsWith('protect_leak_class_'))).toHaveLength(6);
    for (const key of keys(ru)) expect(/получал|получил/i.test(ru[key]!.message), key + ' ru').toBe(false);
    for (const key of keys(en)) expect(/received/i.test(en[key]!.message), key + ' en').toBe(false);
    // strict-escalate counts the sites with a block decision for the receiver (user or preset), and says only that.
    expect(ru['fw_strict_escalate']!.message).toBe('Для $RECEIVER$ уже есть решения о блокировке на $COUNT$ сайтах. Блокировать его везде?');
    expect(en['fw_strict_escalate']!.message).toBe('There are already block decisions for $RECEIVER$ on $COUNT$ sites. Block it everywhere?');
  });

  it('review round 3: the strict-auto notice makes no delivery claim about the request that triggered it', () => {
    // Made from the evidence event of onBeforeRequest: that request's delivery is not observed yet (ADR-020 §11).
    expect(ru['fw_strict_auto_notice']!.message).toBe('Строгий режим: следующие запросы к $RECEIVER$ на $SITE$ теперь останавливаются. Запрос, в котором найдено то, что вы ввели, начался до этого правила.');
    expect(en['fw_strict_auto_notice']!.message).toBe('Strict mode: further requests to $RECEIVER$ on $SITE$ are now stopped. The request that contained what you entered started before this rule.');
    expect(/отправ|получ|уже был/i.test(ru['fw_strict_auto_notice']!.message)).toBe(false);
    expect(/\bsent\b|already|received/i.test(en['fw_strict_auto_notice']!.message)).toBe(false);
  });

  it('«остановлен» only for a rule in place before the request (and the lower-bound counter)', () => {
    const saying = fwKeys(ru).filter((k) => /остановлен/i.test(ru[k]!.message));
    expect(saying.sort()).toEqual([...STOPPED_KEYS].sort());
    expect(ru['fw_counter_note']!.message).toContain('нижняя граница');
    const enSaying = fwKeys(en).filter((k) => /\bstopped\b/i.test(en[k]!.message));
    expect(enSaying.every((k) => [...STOPPED_KEYS, 'fw_resolved_error', 'fw_strict_auto_notice'].includes(k)), enSaying.join(',')).toBe(true);
  });
});
