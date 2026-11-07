import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import {
  RTC_REVIEW_POLICY as policy, RTC_STALE_LABEL_KEY, createReviewAwareRtcVendorMatcher,
  applyRtcReviewCopy, patchRtcReviewMatcher, patchRtcOccurrenceIdentity, patchRtcReviewUi,
} from '../production/rtc-review-plan.mjs';

const read = name => readFileSync(new URL('../../apps/production-extension/' + name, import.meta.url), 'utf8');
const background = read('background.js');
const registryStart = background.indexOf('var vendors_rtc_runtime_default = ');
const registryEnd = background.indexOf('// packages/catalog/src/rtc-matcher.ts', registryStart);
const rules = JSON.parse(JSON.stringify(vm.runInNewContext(background.slice(registryStart, registryEnd) + '\nvendors_rtc_runtime_default.rules;')));
const due = Date.parse(policy.reviewDueAt), start = Date.parse(policy.sourceAccessedAt);
const plain = value => JSON.parse(JSON.stringify(value));

test('exact expiry boundary changes only the explicit stale rule ID and preserves weak source quality', () => {
  const matcher = createReviewAwareRtcVendorMatcher(rules), before = structuredClone(rules);
  for (const scheme of ['stun', 'turn', 'turns']) {
    const fresh = matcher.matchVendorRtcServer(policy.hostExact, scheme, due - 1)[0];
    const stale = matcher.matchVendorRtcServer(policy.hostExact, scheme, due)[0];
    assert.equal(fresh.ruleId, policy.ruleId);
    assert.deepEqual(stale, { ...fresh, ruleId: policy.staleRuleId });
    assert.equal(stale.vendorConfidence, 'weak-signal'); assert.equal(stale.evidenceSource, 'page-hook'); assert.equal(stale.integrity, 'page-controlled');
    assert.equal(matcher.matchVendorRtcServer(policy.hostExact, scheme, due + 86400000 * 365)[0].ruleId, policy.staleRuleId);
  }
  assert.deepEqual(rules, before);
  assert.equal(rules[0].sourceAccessedAt, '2026-09-13'); assert.equal(rules[0].reviewDueAt, '2026-10-12T00:00:00.000Z');
});

test('clock bounds, unrecognized aliases, similar hostnames and unrelated schemes remain rejected', () => {
  const matcher = createReviewAwareRtcVendorMatcher(rules);
  for (const now of [start - 1, NaN, Infinity, -Infinity]) assert.deepEqual(matcher.matchVendorRtcServer(policy.hostExact, 'turn', now), []);
  for (const host of ['online-metrix.net', 'aa.online-metrix.net.example.test', 'evilaa.online-metrix.net', 'AA.online-metrix.net', 'aa.online-metrix.net.', 'turn:aa.online-metrix.net', 'x'.repeat(254)]) assert.deepEqual(matcher.matchVendorRtcServer(host, 'turn', due + 1), []);
  for (const scheme of ['https', 'wss', 'TURN', '']) assert.deepEqual(matcher.matchVendorRtcServer(policy.hostExact, scheme, due + 1), []);
  for (const id of ['threatmetrix-aa-turn-v1-expired', policy.staleRuleId + '-fake', policy.ruleId + '-future', 'unknown']) assert.equal(matcher.lookupVendorRtcRule(id, due + 1), null);
  assert.equal(matcher.lookupVendorRtcRule(policy.staleRuleId, due - 1), null);
  assert.equal(matcher.lookupVendorRtcRule(policy.staleRuleId, due).ruleId, policy.staleRuleId);
  assert.equal(matcher.lookupVendorRtcRule(policy.ruleId, due).ruleId, policy.staleRuleId);
  const hostile = new Proxy({}, { get() { throw Error('Coercion'); } });
  assert.deepEqual(matcher.matchVendorRtcServer(hostile, 'turn', due), []);
  assert.deepEqual(matcher.matchVendorRtcServer(policy.hostExact, hostile, due), []);
  assert.equal(matcher.lookupVendorRtcRule(hostile, due), null);
});

test('stale continuation does not apply to changed provenance, broader hosts, altered schemes or other rules', () => {
  for (const change of [
    { sourceAccessedAt: '2026-09-14' }, { reviewDueAt: '2026-10-11T00:00:00.000Z' },
    { vendorId: 'another-vendor' }, { id: 'new-rule' },
    { matcher: { hostExact: 'another.test', schemes: ['stun', 'turn', 'turns'] } },
    { matcher: { hostExact: policy.hostExact, schemes: ['turn'] } },
  ]) {
    const row = { ...rules[0], ...change };
    assert.deepEqual(createReviewAwareRtcVendorMatcher([row]).matchVendorRtcServer(row.matcher.hostExact, 'turn', due), []);
  }
  const matcher = createReviewAwareRtcVendorMatcher(rules), fingerprintDue = Date.parse(rules[1].reviewDueAt);
  assert.equal(matcher.matchVendorRtcServer('us-turn.fpjs.io', 'turn', fingerprintDue - 1)[0].ruleId, 'fingerprint-turn-family-v1');
  assert.deepEqual(matcher.matchVendorRtcServer('us-turn.fpjs.io', 'turn', fingerprintDue), []);
  assert.deepEqual(matcher.matchVendorRtcServer('x.y-turn.fpjs.io', 'turn', due), []);
});

test('pure background patch preserves the reviewed registry and is self-contained and idempotent', () => {
  const patched = patchRtcReviewMatcher(background);
  assert.equal(patchRtcReviewMatcher(patched), patched);
  const definition = patched.match(/^function createRtcVendorMatcher\(approvedRules\) \{[\s\S]*?^\}/m)[0];
  const create = vm.runInNewContext(definition + '\ncreateRtcVendorMatcher;');
  assert.deepEqual(plain(create(rules).matchVendorRtcServer(policy.hostExact, 'turn', due)), createReviewAwareRtcVendorMatcher(rules).matchVendorRtcServer(policy.hostExact, 'turn', due));
  assert.equal(patched.slice(registryStart, registryEnd), background.slice(registryStart, registryEnd));
  assert.throws(() => patchRtcReviewMatcher(''), /Expected one/);
});

test('fresh and stale vendor evidence merges once without increasing company count', () => {
  const definition = background.match(/^function mergeVendorSummaries\(\.\.\.groups\) \{[\s\S]*?^\}/m)[0];
  const merge = vm.runInNewContext(definition + '\nmergeVendorSummaries;');
  const matcher = createReviewAwareRtcVendorMatcher(rules);
  const vendor = at => { const { ruleId, ...rest } = matcher.matchVendorRtcServer(policy.hostExact, 'turn', at)[0]; return { ...rest, ruleIds: [ruleId] }; };
  const fresh = vendor(due - 1), stale = vendor(due), frozen = structuredClone(fresh);
  const result = merge([fresh], [stale], [stale]);
  assert.equal(result.length, 1); assert.equal(result[0].vendorConfidence, 'weak-signal');
  assert.deepEqual(plain(result[0].ruleIds), [policy.ruleId, policy.staleRuleId]);
  assert.deepEqual(fresh, frozen);
});

test('review rollover preserves occurrence ID and therefore Pro baseline deduplication', () => {
  const patched = patchRtcOccurrenceIdentity(background);
  assert.equal(patchRtcOccurrenceIdentity(patched), patched);
  const expression = patched.match(/let occurrenceRuleId = [^\n]+\n\s+let occurrenceId = [^\n]+/)[0];
  const identity = ruleId => vm.runInNewContext(expression + '\noccurrenceId;', { match: { ruleId }, connection: { id: 7, configurationChanges: 2 } });
  assert.equal(identity(policy.ruleId), identity(policy.staleRuleId));
  assert.notEqual(identity(policy.ruleId), identity('fingerprint-turn-family-v1'));
  assert.throws(() => patchRtcOccurrenceIdentity(''), /Expected one/);
});

for (const filename of ['popup.js', 'sidepanel.js', 'report.js']) test(filename + ': stale label is selected from saved rule ID, without current-clock reinterpretation', () => {
  const patched = patchRtcReviewUi(read(filename));
  assert.equal(patchRtcReviewUi(patched), patched);
  const ids = JSON.parse(patched.match(/RTC_RULE_IDS = (\[[^\n]+\]);/)[1]);
  assert.deepEqual(ids, [policy.ruleId, 'fingerprint-turn-family-v1', policy.staleRuleId]);
  const definition = patched.match(/^function buildVendorCards\(report2\) \{[\s\S]*?^\}/m)[0];
  const build = vm.runInNewContext(definition + '\nbuildVendorCards;', {
    getVendorLabel: () => 'ThreatMetrix', isRtcVendorRule: id => ids.includes(id), msg: key => key,
    VENDOR_PURPOSE_KEYS: {}, vendorMatchKey: value => 'card_vendor_match_' + value.replaceAll('-', '_'),
  });
  const entry = id => ({ vendorId: 'threatmetrix', vendorConfidence: 'weak-signal', ruleIds: [id], evidenceSource: 'page-hook', integrity: 'page-controlled' });
  assert.equal(build({ vendors: [entry(policy.ruleId)] })[0].matchLabel, 'vendor_match_rtc_server');
  assert.equal(build({ vendors: [entry(policy.staleRuleId)] })[0].matchLabel, RTC_STALE_LABEL_KEY);
  assert.equal(build({ vendors: [entry(policy.staleRuleId + '-fake')] })[0].rtcServer, false);
});

test('all 21 localized stale notes exist and overlay is idempotent', () => {
  for (const language of PRODUCTION_LANGUAGES) {
    const dictionary = applyRtcReviewCopy({ vendor_match_rtc_server: { message: 'existing' } }, language.id);
    assert.ok(dictionary[RTC_STALE_LABEL_KEY].message.length > 15, language.id);
    const prior = JSON.stringify(dictionary); applyRtcReviewCopy(dictionary, language.id);
    assert.equal(JSON.stringify(dictionary), prior); assert.equal(dictionary.vendor_match_rtc_server.message, 'existing');
  }
  assert.throws(() => applyRtcReviewCopy({}, 'missing'), /Unknown/);
});
