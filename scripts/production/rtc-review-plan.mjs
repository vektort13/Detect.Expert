// ADR-009 / DET-056: explicit stale hint for one previously reviewed weak RTC rule.
// Source/review dates are immutable evidence, not an expiry-extension mechanism.
export const RTC_REVIEW_POLICY = Object.freeze({
  ruleId: 'threatmetrix-aa-turn-v1', staleRuleId: 'threatmetrix-aa-turn-v1-stale',
  vendorId: 'threatmetrix', hostExact: 'aa.online-metrix.net',
  sourceAccessedAt: '2026-09-13', reviewDueAt: '2026-10-12T00:00:00.000Z',
  expiryAction: 'downgrade_to_stale_hint',
});

export function createReviewAwareRtcVendorMatcher(approvedRules, policy = RTC_REVIEW_POLICY) {
  const entries = approvedRules.slice(0, 16).flatMap(rule => {
    const matcher = rule.matcher;
    const exact = typeof matcher.hostExact === 'string' && matcher.hostTemplate === undefined;
    const family = matcher.hostTemplate === 'fingerprint-turn-region-v1' && matcher.hostExact === undefined;
    if ((!exact && !family) || typeof rule.sourceAccessedAt !== 'string' || typeof rule.reviewDueAt !== 'string') return [];
    const start = Date.parse(rule.sourceAccessedAt), end = Date.parse(rule.reviewDueAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const staleEligible = rule.id === policy.ruleId && rule.vendorId === policy.vendorId &&
      matcher.hostExact === policy.hostExact && matcher.hostTemplate === undefined &&
      rule.sourceAccessedAt === policy.sourceAccessedAt && rule.reviewDueAt === policy.reviewDueAt &&
      policy.expiryAction === 'downgrade_to_stale_hint' && Array.isArray(matcher.schemes) &&
      matcher.schemes.length === 3 && ['stun', 'turn', 'turns'].every(scheme => matcher.schemes.includes(scheme));
    return [{ rule, start, end, staleEligible }];
  });
  const eligible = (entry, now) => Number.isFinite(now) && entry.start <= now && (now < entry.end || entry.staleEligible);
  const match = (entry, now) => ({
    vendorId: entry.rule.vendorId,
    ruleId: now >= entry.end && entry.staleEligible ? policy.staleRuleId : entry.rule.id,
    vendorConfidence: 'weak-signal', evidenceSource: 'page-hook', integrity: 'page-controlled',
  });
  const matchesHost = (matcher, hostname) => {
    if (matcher.hostExact !== undefined) return matcher.hostExact === hostname;
    if (hostname === 'turn.fpjs.io') return true;
    const suffix = '-turn.fpjs.io';
    if (!hostname.endsWith(suffix)) return false;
    const region = hostname.slice(0, -suffix.length);
    return region.length >= 1 && region.length <= 16 && !/[^a-z0-9]/.test(region);
  };
  return {
    matchVendorRtcServer(hostname, scheme, nowMs) {
      if (typeof hostname !== 'string' || hostname.length > 253 ||
          (scheme !== 'stun' && scheme !== 'turn' && scheme !== 'turns') || !Number.isFinite(nowMs)) return [];
      for (const entry of entries) if (eligible(entry, nowMs) && matchesHost(entry.rule.matcher, hostname) && entry.rule.matcher.schemes.includes(scheme)) return [match(entry, nowMs)];
      return [];
    },
    lookupVendorRtcRule(ruleId, nowMs) {
      if (typeof ruleId !== 'string' || ruleId.length > 64 || !Number.isFinite(nowMs)) return null;
      const entry = entries.find(entry => entry.rule.id === ruleId || entry.staleEligible && ruleId === policy.staleRuleId && nowMs >= entry.end);
      return entry && eligible(entry, nowMs) ? match(entry, nowMs) : null;
    },
  };
}

export const RTC_STALE_LABEL_KEY = 'vendor_match_rtc_server_stale';
const COPY = {
  en: 'WebRTC server match · rule review overdue',
  ru: 'Совпадение сервера WebRTC · срок проверки правила истёк',
  zh_CN: 'WebRTC 服务器匹配 · 规则复核已逾期',
  vi: 'Khớp máy chủ WebRTC · quy tắc đã quá hạn rà soát',
  es: 'Coincidencia de servidor WebRTC · revisión de la regla pendiente',
  ar: 'تطابق خادم WebRTC · تجاوزت مراجعة القاعدة موعدها',
  uk: 'Збіг сервера WebRTC · строк перевірки правила минув',
  fr: 'Correspondance de serveur WebRTC · révision de la règle en retard',
  pt_BR: 'Correspondência de servidor WebRTC · revisão da regra atrasada',
  hi: 'WebRTC सर्वर मिलान · नियम की समीक्षा की समय-सीमा बीत चुकी है',
  ur: 'WebRTC سرور کی مطابقت · قاعدے کے جائزے کی مدت گزر چکی ہے',
  ja: 'WebRTC サーバーの一致 · ルールのレビュー期限切れ',
  de: 'WebRTC-Serverübereinstimmung · Regelprüfung überfällig',
  pl: 'Dopasowanie serwera WebRTC · termin przeglądu reguły minął',
  id: 'Kecocokan server WebRTC · peninjauan aturan terlambat',
  mr: 'WebRTC सर्व्हर जुळला · नियमाच्या पुनरावलोकनाची मुदत संपली',
  te: 'WebRTC సర్వర్ సరిపోలిక · నియమ సమీక్ష గడువు ముగిసింది',
  ko: 'WebRTC 서버 일치 · 규칙 검토 기한 경과',
  ta: 'WebRTC சேவையகம் பொருந்துகிறது · விதி மறுஆய்வுக்கான காலக்கெடு முடிந்தது',
  yue: 'WebRTC 伺服器吻合 · 規則覆核已經過期',
  wuu: 'WebRTC 服务器匹配 · 规则复核已经过期',
};
export function applyRtcReviewCopy(table, locale) {
  if (!Object.hasOwn(COPY, locale)) throw Error('Unknown RTC-review locale: ' + locale);
  table[RTC_STALE_LABEL_KEY] = { message: COPY[locale] };
  return table;
}

export function patchRtcReviewMatcher(source) {
  const expression = /^function createRtcVendorMatcher\(approvedRules\) \{[\s\S]*?^\}/gm;
  let count = 0;
  const result = source.replace(expression, () => {
    ++count;
    return 'function createRtcVendorMatcher(approvedRules) {\n  return (' + createReviewAwareRtcVendorMatcher.toString().replaceAll('\n', '\n  ') + ')(approvedRules, ' + JSON.stringify(RTC_REVIEW_POLICY) + ');\n}';
  });
  if (count !== 1) throw Error('Expected one RTC matcher, found ' + count);
  return result;
}

// A rule's review deadline must not make an old RTC occurrence look newly captured.
export function patchRtcOccurrenceIdentity(source) {
  const before = 'let occurrenceId = `${match.ruleId}:${connection.id}:${connection.configurationChanges}`;';
  const after = 'let occurrenceRuleId = match.ruleId === "' + RTC_REVIEW_POLICY.staleRuleId + '" ? "' + RTC_REVIEW_POLICY.ruleId + '" : match.ruleId;\n          let occurrenceId = `${occurrenceRuleId}:${connection.id}:${connection.configurationChanges}`;';
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2) throw Error('Expected one RTC occurrence identity');
  return source.replace(before, after);
}

export function patchRtcReviewUi(source) {
  let count = 0;
  let result = source.replace(/RTC_RULE_IDS = (\[[^\]\n]*\]);/g, (_match, encoded) => {
    ++count;
    const ids = JSON.parse(encoded);
    if (!ids.includes(RTC_REVIEW_POLICY.ruleId) || !ids.includes('fingerprint-turn-family-v1')) throw Error('Unexpected RTC rule IDs');
    if (!ids.includes(RTC_REVIEW_POLICY.staleRuleId)) ids.push(RTC_REVIEW_POLICY.staleRuleId);
    return 'RTC_RULE_IDS = ' + JSON.stringify(ids) + ';';
  });
  if (count !== 1) throw Error('Expected one RTC rule ID list, found ' + count);
  const before = 'matchLabel: msg(rtcServer ? "vendor_match_rtc_server" : vendorMatchKey(vendor2.vendorConfidence))';
  const after = 'matchLabel: msg(rtcServer ? vendor2.ruleIds.includes("' + RTC_REVIEW_POLICY.staleRuleId + '") ? "' + RTC_STALE_LABEL_KEY + '" : "vendor_match_rtc_server" : vendorMatchKey(vendor2.vendorConfidence))';
  if (result.includes(after)) return result;
  if (result.split(before).length !== 2) throw Error('Expected one RTC card label');
  return result.replace(before, after);
}
