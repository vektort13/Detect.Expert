// ADR-020 §C (S08): pure firewall logic — receiver checks (PSL parent, IP, punycode), rule compilation (priorities, id
// ranges, overlap-only allows, warn-only, limits), the local DNR evaluation (≥ 40 cases) and the dnr-guard boundary.

import { DNR_PRIORITIES, DNR_RULE_IDS, PROTECT_BUDGETS } from '@detect-expert/contracts';
import { describe, expect, it } from 'vitest';
import { domainMatches, isPslParentDomain } from '../../attribution/src/dnr-domains';
import {
  FirewallIndex,
  assertAllowedRule,
  checkReceiver,
  compileOnceRules,
  compileRules,
  decisionKeyOf,
  evaluateFirewall,
  isAllowedRule,
  parseDecisionKey,
  receiverOfRuleKey,
} from '../src/index';
import type { CompiledFirewallRule, FirewallDecision, FirewallPresetEntry, FirewallRequest, OnceRuleSpec } from '../src/index';

const TOP = { topDomains: true };
const INIT = { topDomains: false };

function decision(over: Partial<FirewallDecision> & Pick<FirewallDecision, 'receiver' | 'scope' | 'action' | 'slot'>): FirewallDecision {
  const site = over.scope === 'site' ? (over.site ?? 'shop.example') : null;
  return {
    decisionKey: decisionKeyOf(over.scope, site, over.receiver),
    site,
    origin: 'user',
    createdDay: '2026-10-18',
    stopped: 0,
    bypass: 0,
    ...over,
  } as FirewallDecision;
}

function req(over: Partial<FirewallRequest> = {}): FirewallRequest {
  return { receiverHost: 'collect.tracker.net', topDomain: 'shop.example', initiatorDomain: 'shop.example', tabId: 7, type: 'xmlhttprequest', ...over };
}

describe('dnr-domains (attribution)', () => {
  it('domainMatches uses whole labels', () => {
    expect(domainMatches('example.com', 'example.com')).toBe(true);
    expect(domainMatches('a.b.example.com', 'example.com')).toBe(true);
    expect(domainMatches('badexample.com', 'example.com')).toBe(false);
    expect(domainMatches('example.com', 'a.example.com')).toBe(false);
    expect(domainMatches('com', 'com')).toBe(true);
    expect(domainMatches('x.com', '')).toBe(false);
  });

  it('isPslParentDomain: public suffixes and their parents', () => {
    expect(isPslParentDomain('com')).toBe(true);
    expect(isPslParentDomain('co.uk')).toBe(true);
    expect(isPslParentDomain('github.io')).toBe(true);
    expect(isPslParentDomain('amazonaws.com')).toBe(true); // parent of s3.amazonaws.com etc.
    expect(isPslParentDomain('blogspot.com')).toBe(true);
    expect(isPslParentDomain('example.com')).toBe(false);
    expect(isPslParentDomain('tracker.net')).toBe(false);
    expect(isPslParentDomain('user.github.io')).toBe(false);
  });
});

describe('checkReceiver', () => {
  const cases: Array<[unknown, string | null, string]> = [
    ['tracker.net', 'shop.example', 'ok'],
    ['tracker.net', null, 'ok'],
    ['collect.tracker.net', 'shop.example', 'no-domain'], // not registrable itself
    ['127.0.0.1', 'shop.example', 'no-domain'],
    ['10.0.0.1', 'shop.example', 'no-domain'],
    ['[::1]', 'shop.example', 'no-domain'],
    ['localhost', 'shop.example', 'no-domain'],
    ['printer.local', 'shop.example', 'no-domain'],
    ['intranet', 'shop.example', 'no-domain'],
    ['Tracker.net', 'shop.example', 'no-domain'], // not normalized
    ['пример.рф', 'shop.example', 'no-domain'], // unicode: the browser gives punycode
    ['xn--e1afmkfd.xn--p1ai', 'shop.example', 'ok'], // punycode registrable
    ['shop.example.com', 'example.com', 'no-domain'],
    ['example.com', 'example.com', 'first-party'],
    ['github.io', 'example.com', 'no-domain'], // a public suffix is not registrable
    ['amazonaws.com', 'example.com', 'unsafe-receiver'],
    ['user.github.io', 'example.com', 'ok'],
    ['', 'example.com', 'no-domain'],
    [42, 'example.com', 'no-domain'],
    ['a'.repeat(250) + '.net', 'example.com', 'no-domain'],
  ];
  for (const [receiver, site, expected] of cases) {
    it(String(receiver) + ' on ' + String(site) + ' -> ' + expected, () => {
      expect(checkReceiver(receiver, site)).toBe(expected);
    });
  }
});

describe('decision keys', () => {
  it('round-trips site and everywhere keys; preset and once keys are not decision keys', () => {
    expect(decisionKeyOf('site', 'shop.example', 'tracker.net')).toBe('site:shop.example>tracker.net');
    expect(decisionKeyOf('everywhere', null, 'tracker.net')).toBe('everywhere:*>tracker.net');
    expect(parseDecisionKey('site:shop.example>tracker.net')).toEqual({ scope: 'site', site: 'shop.example', receiver: 'tracker.net' });
    expect(parseDecisionKey('everywhere:*>tracker.net')).toEqual({ scope: 'everywhere', site: null, receiver: 'tracker.net' });
    expect(parseDecisionKey('site:*>tracker.net')).toBeNull();
    expect(parseDecisionKey('everywhere:shop.example>tracker.net')).toBeNull();
    expect(parseDecisionKey('preset:synthetic-collect')).toBeNull();
    expect(receiverOfRuleKey('once:7:shop.example>tracker.net')).toBe('tracker.net');
    expect(receiverOfRuleKey('site:shop.example>tracker.net')).toBe('tracker.net');
  });
});

describe('compileRules', () => {
  const preset: FirewallPresetEntry[] = [{ entryId: 'synthetic-collect', host: 'collect.example.net' }];

  it('maps every decision kind to its priority, range and condition (topDomains supported)', () => {
    const { dynamic, dormant } = compileRules({
      decisions: [
        decision({ receiver: 'tracker.net', scope: 'everywhere', action: 'block', slot: 0 }),
        decision({ receiver: 'pixel.org', scope: 'site', action: 'block', slot: 1 }),
        decision({ receiver: 'tracker.net', scope: 'site', action: 'allow', slot: 2 }), // overlapped by receiver-block
        decision({ receiver: 'cdn.org', scope: 'site', action: 'allow', slot: 3 }), // nothing overlaps
        decision({ receiver: 'other.net', scope: 'everywhere', action: 'allow', slot: 4 }), // nothing overlaps
      ],
      presetEntries: preset,
      preset: 'normal',
      features: TOP,
    });
    expect(dynamic.map((r) => [r.rule.id, r.rule.priority, r.kind])).toEqual([
      [DNR_RULE_IDS.decisions[0], DNR_PRIORITIES.receiverBlock, 'receiver-block'],
      [DNR_RULE_IDS.decisions[0] + 1, DNR_PRIORITIES.siteBlock, 'site-block'],
      [DNR_RULE_IDS.decisions[0] + 2, DNR_PRIORITIES.siteAllow, 'site-allow'],
    ]);
    expect(dynamic[0]!.rule.condition).toEqual({ requestDomains: ['tracker.net'], excludedTopDomains: ['tracker.net'] });
    expect(dynamic[1]!.rule.condition).toEqual({ requestDomains: ['pixel.org'], topDomains: ['shop.example'] });
    expect(dormant).toEqual([
      { decisionKey: 'site:shop.example>cdn.org', reason: 'not-needed' },
      { decisionKey: 'everywhere:*>other.net', reason: 'not-needed' },
    ]);
    for (const r of dynamic) {
      expect(r.rule.condition.resourceTypes, 'main_frame is never targeted').toBeUndefined();
      expect(() => assertAllowedRule(r.rule)).not.toThrow();
    }
  });

  it('falls back to initiator conditions without topDomains (iframe-rule-gap)', () => {
    const { dynamic } = compileRules({
      decisions: [decision({ receiver: 'tracker.net', scope: 'everywhere', action: 'block', slot: 0 }), decision({ receiver: 'pixel.org', scope: 'site', action: 'block', slot: 1 })],
      presetEntries: [],
      preset: 'normal',
      features: INIT,
    });
    expect(dynamic[0]!.rule.condition).toEqual({ requestDomains: ['tracker.net'], excludedInitiatorDomains: ['tracker.net'] });
    expect(dynamic[1]!.rule.condition).toEqual({ requestDomains: ['pixel.org'], initiatorDomains: ['shop.example'] });
  });

  it('preset entries only with strict: p10 block in the preset range, never on the receiver site itself', () => {
    expect(compileRules({ decisions: [], presetEntries: preset, preset: 'normal', features: TOP }).dynamic).toEqual([]);
    const { dynamic } = compileRules({
      decisions: [decision({ receiver: 'example.net', scope: 'everywhere', action: 'allow', slot: 5 })],
      presetEntries: [...preset, { entryId: 'path-entry', host: 'beacon.tracker.net', pathPrefix: '/b/' }],
      preset: 'strict',
      features: TOP,
    });
    expect(dynamic.map((r) => [r.rule.id, r.kind])).toEqual([
      [DNR_RULE_IDS.decisions[0] + 5, 'receiver-allow'], // overlaps the preset host collect.example.net
      [DNR_RULE_IDS.preset[0], 'preset-block'],
      [DNR_RULE_IDS.preset[0] + 1, 'preset-block'],
    ]);
    expect(dynamic[1]!.rule.condition).toEqual({ requestDomains: ['collect.example.net'], excludedTopDomains: ['example.net'] });
    expect(dynamic[2]!.rule.condition).toEqual({ urlFilter: '||beacon.tracker.net/b/', excludedTopDomains: ['tracker.net'] });
    expect(dynamic[1]!.rule.priority).toBe(DNR_PRIORITIES.presetBlock);
  });

  it('review TRUTH-01: the module excluded sites are excluded top domains (fallback initiators) of «везде» and preset rules; site rules unchanged', () => {
    const decisions = [
      decision({ receiver: 'tracker.net', scope: 'everywhere', action: 'block', slot: 0 }),
      decision({ receiver: 'pixel.org', scope: 'site', site: 'bank.example', action: 'block', slot: 1 }),
    ];
    const excludedSites = ['bank.example', 'a-shop.example', 'bank.example'];
    const top = compileRules({ decisions, presetEntries: preset, preset: 'strict', features: TOP, excludedSites });
    const byKind = (kind: string) => top.dynamic.filter((r) => r.kind === kind).map((r) => r.rule.condition);
    expect(byKind('receiver-block')).toEqual([{ requestDomains: ['tracker.net'], excludedTopDomains: ['tracker.net', 'a-shop.example', 'bank.example'] }]);
    expect(byKind('preset-block')[0]).toEqual({ requestDomains: ['collect.example.net'], excludedTopDomains: ['example.net', 'a-shop.example', 'bank.example'] });
    expect(byKind('site-block')).toEqual([{ requestDomains: ['pixel.org'], topDomains: ['bank.example'] }]);
    for (const r of top.dynamic) expect(isAllowedRule(r.rule), r.ruleKey).toBe(true);
    // Local evaluation follows: the «везде» block does not act with an excluded top site, still acts elsewhere.
    const everywhere = top.dynamic.filter((r) => r.kind === 'receiver-block');
    expect(evaluateFirewall(everywhere, req({ topDomain: 'bank.example', initiatorDomain: 'bank.example' }))).toBeNull();
    expect(evaluateFirewall(everywhere, req({ topDomain: 'shop.example' }))).toMatchObject({ kind: 'receiver-block' });
    const init = compileRules({ decisions, presetEntries: [], preset: 'normal', features: INIT, excludedSites: ['bank.example'] });
    expect(init.dynamic[0]!.rule.condition).toEqual({ requestDomains: ['tracker.net'], excludedInitiatorDomains: ['tracker.net', 'bank.example'] });
    // No exclusions: the rules are exactly as before.
    expect(compileRules({ decisions, presetEntries: [], preset: 'normal', features: TOP, excludedSites: [] }).dynamic[0]!.rule.condition).toEqual({ requestDomains: ['tracker.net'], excludedTopDomains: ['tracker.net'] });
  });

  it('warn-only compiles to nothing (every decision dormant)', () => {
    const r = compileRules({ decisions: [decision({ receiver: 'tracker.net', scope: 'everywhere', action: 'block', slot: 0 })], presetEntries: preset, preset: 'warn-only', features: TOP });
    expect(r.dynamic).toEqual([]);
    expect(r.dormant).toEqual([{ decisionKey: 'everywhere:*>tracker.net', reason: 'warn-only' }]);
    expect(compileOnceRules({ once: [{ slot: 0, tabId: 1, site: 'a.com', receiver: 'b.net', action: 'block' }], decisions: [], presetEntries: [], preset: 'warn-only', features: TOP }).session).toEqual([]);
  });

  it('limits: 1000 decisions fill the range; beyond the dynamic limit decisions are dormant (rule-limit)', () => {
    const decisions = Array.from({ length: PROTECT_BUDGETS.maxDecisions }, (_, i) => decision({ receiver: 'r' + String(i) + '.net', scope: 'everywhere', action: 'block', slot: i }));
    const full = compileRules({ decisions, presetEntries: [], preset: 'normal', features: TOP });
    expect(full.dynamic).toHaveLength(PROTECT_BUDGETS.maxDecisions);
    expect(full.dynamic.at(-1)!.rule.id).toBe(DNR_RULE_IDS.decisions[1]);
    const limited = compileRules({ decisions, presetEntries: [], preset: 'normal', features: TOP, maxDynamic: 10 });
    expect(limited.dynamic).toHaveLength(10);
    expect(limited.dormant.filter((d) => d.reason === 'rule-limit')).toHaveLength(PROTECT_BUDGETS.maxDecisions - 10);
  });

  it('a stored decision with a slot outside the range is dormant (invalid), never written', () => {
    const r = compileRules({ decisions: [decision({ receiver: 'tracker.net', scope: 'everywhere', action: 'block', slot: PROTECT_BUDGETS.maxDecisions })], presetEntries: [], preset: 'normal', features: TOP });
    expect(r.dynamic).toEqual([]);
    expect(r.dormant[0]!.reason).toBe('invalid');
  });

  it('once rules: session range, p50, tabIds; an allow only where a block overlaps it', () => {
    const once: OnceRuleSpec[] = [
      { slot: 0, tabId: 7, site: 'shop.example', receiver: 'tracker.net', action: 'block' },
      { slot: 1, tabId: 7, site: 'shop.example', receiver: 'pixel.org', action: 'allow' }, // site-block overlaps
      { slot: 2, tabId: 7, site: 'shop.example', receiver: 'cdn.org', action: 'allow' }, // nothing overlaps
    ];
    const r = compileOnceRules({ once, decisions: [decision({ receiver: 'pixel.org', scope: 'site', action: 'block', slot: 0 })], presetEntries: [], preset: 'normal', features: TOP });
    expect(r.session.map((x) => [x.rule.id, x.rule.priority, x.kind])).toEqual([
      [DNR_RULE_IDS.session[0], DNR_PRIORITIES.once, 'once-block'],
      [DNR_RULE_IDS.session[0] + 1, DNR_PRIORITIES.once, 'once-allow'],
    ]);
    expect(r.session[0]!.rule.condition).toEqual({ requestDomains: ['tracker.net'], topDomains: ['shop.example'], tabIds: [7] });
    expect(r.dormant).toEqual([{ slot: 2, reason: 'not-needed' }]);
  });
});

describe('evaluateFirewall (DNR subset)', () => {
  const decisions = [
    decision({ receiver: 'tracker.net', scope: 'everywhere', action: 'block', slot: 0 }),
    decision({ receiver: 'tracker.net', scope: 'site', site: 'allowed.example', action: 'allow', slot: 1 }),
    decision({ receiver: 'pixel.org', scope: 'site', site: 'shop.example', action: 'block', slot: 2 }),
    decision({ receiver: 'ads.com', scope: 'site', site: 'shop.example', action: 'block', slot: 3 }),
  ];
  const once: OnceRuleSpec[] = [
    { slot: 0, tabId: 9, site: 'shop.example', receiver: 'pixel.org', action: 'allow' },
    { slot: 1, tabId: 9, site: 'shop.example', receiver: 'cdn.net', action: 'block' },
  ];
  const preset: FirewallPresetEntry[] = [
    { entryId: 'synthetic-collect', host: 'collect.example.net' },
    { entryId: 'path-entry', host: 'beacon.metrics.org', pathPrefix: '/b/' },
  ];
  const build = (features = TOP, p: 'strict' | 'normal' = 'strict'): CompiledFirewallRule[] => [
    ...compileRules({ decisions, presetEntries: preset, preset: p, features }).dynamic,
    ...compileOnceRules({ once, decisions, presetEntries: preset, preset: p, features }).session,
  ];
  const rules = build();
  const index = new FirewallIndex(rules);

  const table: Array<[string, Partial<FirewallRequest>, string | null]> = [
    // receiver-block «везде»
    ['receiver block: exact host', { receiverHost: 'tracker.net' }, 'block:everywhere:*>tracker.net'],
    ['receiver block: subdomain', { receiverHost: 'collect.tracker.net' }, 'block:everywhere:*>tracker.net'],
    ['receiver block: deep subdomain', { receiverHost: 'a.b.c.tracker.net' }, 'block:everywhere:*>tracker.net'],
    ['receiver block: suffix without a label boundary', { receiverHost: 'notracker.net' }, null],
    ['receiver block: another site', { topDomain: 'news.example', initiatorDomain: 'news.example' }, 'block:everywhere:*>tracker.net'],
    ['receiver block: not on the receiver site itself (excludedTopDomains)', { topDomain: 'tracker.net', initiatorDomain: 'tracker.net' }, null],
    ['receiver block: not under a subdomain top of the receiver', { topDomain: 'www.tracker.net', initiatorDomain: 'www.tracker.net' }, null],
    ['receiver block: unknown top still matches', { topDomain: null }, 'block:everywhere:*>tracker.net'],
    ['receiver block: main_frame never', { type: 'main_frame' }, null],
    ['receiver block: sub_frame', { type: 'sub_frame' }, 'block:everywhere:*>tracker.net'],
    ['receiver block: ping (sendBeacon)', { type: 'ping' }, 'block:everywhere:*>tracker.net'],
    ['receiver block: image', { type: 'image' }, 'block:everywhere:*>tracker.net'],
    ['receiver block: script', { type: 'script' }, 'block:everywhere:*>tracker.net'],
    ['receiver block: websocket type', { type: 'websocket' }, 'block:everywhere:*>tracker.net'],
    // site-allow p40 over receiver-block p10
    ['site allow overrides the receiver block on its site', { topDomain: 'allowed.example' }, 'allow:site:allowed.example>tracker.net'],
    ['site allow: subdomain top of the site', { topDomain: 'www.allowed.example' }, 'allow:site:allowed.example>tracker.net'],
    ['site allow: does not leak to another site', { topDomain: 'other.example' }, 'block:everywhere:*>tracker.net'],
    // site-block p30
    ['site block on its site', { receiverHost: 'px.pixel.org' }, 'block:site:shop.example>pixel.org'],
    ['site block: another site is not blocked', { receiverHost: 'px.pixel.org', topDomain: 'news.example' }, null],
    ['site block: iframe on the site (topDomains)', { receiverHost: 'px.pixel.org', initiatorDomain: 'frame.example' }, 'block:site:shop.example>pixel.org'],
    ['site block: unknown top never matches', { receiverHost: 'px.pixel.org', topDomain: null }, null],
    ['site block: other tab', { receiverHost: 'ads.com', tabId: 11 }, 'block:site:shop.example>ads.com'],
    // once p50
    ['once allow beats the site block in its tab', { receiverHost: 'pixel.org', tabId: 9 }, 'allow:once:9:shop.example>pixel.org'],
    ['once allow: not in another tab', { receiverHost: 'pixel.org', tabId: 10 }, 'block:site:shop.example>pixel.org'],
    ['once block in its tab', { receiverHost: 'cdn.net', tabId: 9 }, 'block:once:9:shop.example>cdn.net'],
    ['once block: not in another tab', { receiverHost: 'cdn.net', tabId: 10 }, null],
    ['once block: not on another site of the tab', { receiverHost: 'cdn.net', tabId: 9, topDomain: 'news.example' }, null],
    // preset (strict)
    ['preset host', { receiverHost: 'collect.example.net' }, 'block:preset:synthetic-collect'],
    ['preset host subdomain', { receiverHost: 'eu.collect.example.net' }, 'block:preset:synthetic-collect'],
    ['preset: sibling host not covered', { receiverHost: 'other.example.net' }, null],
    ['preset: not on its own site', { receiverHost: 'collect.example.net', topDomain: 'example.net' }, null],
    ['preset path prefix', { receiverHost: 'beacon.metrics.org', url: 'https://beacon.metrics.org/b/x?q=1' }, 'block:preset:path-entry'],
    ['preset path prefix: case-insensitive', { receiverHost: 'beacon.metrics.org', url: 'https://beacon.metrics.org/B/x' }, 'block:preset:path-entry'],
    ['preset path prefix: other path', { receiverHost: 'beacon.metrics.org', url: 'https://beacon.metrics.org/c/x' }, null],
    ['preset path prefix: explicit port does not match', { receiverHost: 'beacon.metrics.org', url: 'https://beacon.metrics.org:8443/b/x' }, null],
    ['preset path prefix: no URL, no match', { receiverHost: 'beacon.metrics.org' }, null],
    ['preset path prefix: userinfo is not the host', { receiverHost: 'beacon.metrics.org', url: 'https://u@beacon.metrics.org/b/' }, 'block:preset:path-entry'],
    // nothing
    ['unrelated receiver', { receiverHost: 'cdn.example.org' }, null],
    ['first party host of the shop', { receiverHost: 'www.shop.example' }, null],
    ['IP literal', { receiverHost: '127.0.0.1' }, null],
  ];
  for (const [name, over, expected] of table) {
    it(name, () => {
      const m = index.evaluate(req(over));
      expect(m === null ? null : m.action + ':' + m.ruleKey).toBe(expected);
      const oneShot = evaluateFirewall(rules, req(over));
      expect(oneShot === null ? null : oneShot.action + ':' + oneShot.ruleKey).toBe(expected);
    });
  }

  it('initiator fallback: a cross-site iframe on the site is not covered (iframe-rule-gap)', () => {
    const fallback = new FirewallIndex(build(INIT));
    expect(fallback.evaluate(req({ receiverHost: 'pixel.org', initiatorDomain: 'shop.example' }))?.ruleKey).toBe('site:shop.example>pixel.org');
    expect(fallback.evaluate(req({ receiverHost: 'pixel.org', initiatorDomain: 'frame.example' }))).toBeNull();
    expect(fallback.evaluate(req({ receiverHost: 'tracker.net', initiatorDomain: 'tracker.net' }))).toBeNull();
    expect(fallback.evaluate(req({ receiverHost: 'pixel.org', initiatorDomain: null }))).toBeNull();
  });

  it('equal priority: allow wins over block', () => {
    const a = compileRules({ decisions: [decision({ receiver: 'tracker.net', scope: 'everywhere', action: 'block', slot: 0 })], presetEntries: [], preset: 'normal', features: TOP }).dynamic[0]!;
    const allow: CompiledFirewallRule = { ...a, ruleKey: 'x', action: 'allow', rule: { ...a.rule, id: a.rule.id + 1, action: { type: 'allow' } } };
    expect(evaluateFirewall([a, allow], req({ receiverHost: 'tracker.net' }))?.action).toBe('allow');
    expect(evaluateFirewall([allow, a], req({ receiverHost: 'tracker.net' }))?.action).toBe('allow');
  });

  it('normal preset: no preset rule at all; targets() is a label-suffix pre-check', () => {
    const normal = new FirewallIndex(build(TOP, 'normal'));
    expect(normal.evaluate(req({ receiverHost: 'collect.example.net' }))).toBeNull();
    expect(normal.targets('x.tracker.net')).toBe(true);
    expect(normal.targets('example.org')).toBe(false);
    expect(new FirewallIndex([]).evaluate(req())).toBeNull();
    expect(new FirewallIndex([]).size).toBe(0);
  });
});

describe('dnr-guard boundary (S08 acceptance 4)', () => {
  const base = { id: DNR_RULE_IDS.decisions[0], priority: DNR_PRIORITIES.receiverBlock, condition: { requestDomains: ['tracker.net'] } };
  it('rejects every action except block / allow / Sec-GPC', () => {
    for (const type of ['redirect', 'upgradeScheme', 'allowAllRequests', 'modifyHeaders', 'removeHeaders', 'unknown']) {
      expect(isAllowedRule({ ...base, action: { type } }), type).toBe(false);
    }
    expect(isAllowedRule({ ...base, action: { type: 'block' } })).toBe(true);
    expect(isAllowedRule({ ...base, priority: DNR_PRIORITIES.receiverAllow, action: { type: 'allow' } })).toBe(true);
    expect(isAllowedRule({ ...base, action: { type: 'block', redirect: { url: 'https://x.example' } } })).toBe(false);
  });

  it('rejects ids outside our ranges, a wrong priority for the range, and a rule without a target', () => {
    expect(isAllowedRule({ ...base, id: 5000, action: { type: 'block' } })).toBe(false);
    expect(isAllowedRule({ ...base, id: DNR_RULE_IDS.decisions[1] + 1, action: { type: 'block' } })).toBe(true); // preset range, p10
    expect(isAllowedRule({ ...base, id: DNR_RULE_IDS.session[1] + 1, action: { type: 'block' } })).toBe(false);
    expect(isAllowedRule({ ...base, priority: DNR_PRIORITIES.gpc, action: { type: 'block' } })).toBe(false);
    expect(isAllowedRule({ ...base, condition: {}, action: { type: 'block' } })).toBe(false);
    expect(isAllowedRule({ ...base, id: DNR_RULE_IDS.session[0], priority: DNR_PRIORITIES.once, action: { type: 'block' } })).toBe(false); // session without tabIds
    expect(isAllowedRule({ ...base, condition: { requestDomains: ['tracker.net'], regexFilter: '.*' }, action: { type: 'block' } })).toBe(false);
    expect(isAllowedRule({ ...base, condition: { requestDomains: ['tracker.net'], urlFilter: '||tracker.net' }, action: { type: 'block' } })).toBe(false); // urlFilter only in the preset range
  });

  it('every compiled rule of a full rule set passes the guard and stays in its range', () => {
    const rules = [
      ...compileRules({ decisions: Array.from({ length: 50 }, (_, i) => decision({ receiver: 'r' + String(i) + '.net', scope: i % 2 === 0 ? 'everywhere' : 'site', action: i % 3 === 0 ? 'allow' : 'block', slot: i })), presetEntries: [{ entryId: 'p1', host: 'collect.example.net' }], preset: 'strict', features: TOP }).dynamic,
      ...compileOnceRules({ once: [{ slot: 3, tabId: 4, site: 'a.com', receiver: 'b.net', action: 'block' }], decisions: [], presetEntries: [], preset: 'strict', features: TOP }).session,
    ];
    for (const r of rules) {
      expect(() => assertAllowedRule(r.rule)).not.toThrow();
      const [lo, hi] = DNR_RULE_IDS[r.range];
      expect(r.rule.id).toBeGreaterThanOrEqual(lo);
      expect(r.rule.id).toBeLessThanOrEqual(hi);
    }
  });
});
