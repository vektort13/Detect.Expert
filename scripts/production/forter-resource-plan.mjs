// ADR-043 / E12-02: local, reviewed resource identities; no remote rule updates.
export const FORTER_RESOURCE_POLICY = Object.freeze({
  sourceAccessedAt: '2026-10-10', reviewDueAt: '2027-01-10T00:00:00.000Z',
  connectHosts: [
    'd2o5idwacg3gyw.cloudfront.net', 'dz8rit8v72mig.cloudfront.net',
    'db7q4jg5rkhk8.cloudfront.net', 'd94qwxh6czci4.cloudfront.net',
    'dr6vcclmzwk74.cloudfront.net', 'd6wfl40rgh70w.cloudfront.net',
    'd6rak4b14t5gp.cloudfront.net', 'd3k4bt74u9esq1.cloudfront.net',
    'd1ezzflfzltk6e.cloudfront.net', 'd3nocrch4qti4v.cloudfront.net',
    'duuytoqss3gu4.cloudfront.net', 'df45ay5pw60dy.cloudfront.net',
  ],
  scriptHosts: ['dlthst9q2beh8.cloudfront.net', 'd2nww8zpyj5pk0.cloudfront.net', 'd2w2nqfk3z9hdt.cloudfront.net'],
});
export const FORTER_RESOURCE_RULES = [
  ['forter-cdn-resource-v1', 'forter-cdn-v1', ['script', 'xmlhttprequest', 'image', 'ping']],
  ['forter-cloudfront-connect-v1', 'forter-cloudfront-connect-v1', ['xmlhttprequest', 'image', 'ping']],
  ['forter-cloudfront-script-v1', 'forter-cloudfront-script-v1', ['script']],
].map(([id, hostGroup, resourceTypes]) => ({ id, vendorId: 'forter', matcher: {
  scheme: 'https', hostGroup, resourceTypes,
}, sourceAccessedAt: FORTER_RESOURCE_POLICY.sourceAccessedAt, reviewDueAt: FORTER_RESOURCE_POLICY.reviewDueAt }));

// This function is embedded verbatim in the shipped background bundle. The original
// exact host/path matcher still handles all pre-existing rules, including Forter 3DS.
export function createForterResourceMatcher(legacy, approvedRules, policy) {
  const groups = {
    'forter-cdn-resource-v1': ['forter-cdn-v1', ['script', 'xmlhttprequest', 'image', 'ping']],
    'forter-cloudfront-connect-v1': ['forter-cloudfront-connect-v1', ['xmlhttprequest', 'image', 'ping']],
    'forter-cloudfront-script-v1': ['forter-cloudfront-script-v1', ['script']],
  };
  const entries = approvedRules.slice(0, 64).flatMap(rule => {
    const definition = groups[rule.id], matcher = rule.matcher;
    if (!definition || rule.vendorId !== 'forter' || !matcher || matcher.scheme !== 'https' ||
        Object.keys(matcher).sort().join(',') !== 'hostGroup,resourceTypes,scheme' ||
        matcher.hostGroup !== definition[0] || !Array.isArray(matcher.resourceTypes) ||
        matcher.resourceTypes.join(',') !== definition[1].join(',') ||
        rule.sourceAccessedAt !== policy.sourceAccessedAt || rule.reviewDueAt !== policy.reviewDueAt) return [];
    return [{ rule, start: Date.parse(rule.sourceAccessedAt), end: Date.parse(rule.reviewDueAt) }];
  });
  const connect = new Set(policy.connectHosts), scripts = new Set(policy.scriptHosts);
  const current = (entry, now) => Number.isFinite(now) && entry.start <= now && now < entry.end;
  const match = entry => ({ vendorId: 'forter', ruleId: entry.rule.id,
    vendorConfidence: 'documented-resource', evidenceSource: 'browser-network', integrity: 'browser-observed' });
  const hostMatches = (group, host) => {
    if (group === 'forter-cloudfront-connect-v1') return connect.has(host);
    if (group === 'forter-cloudfront-script-v1') return scripts.has(host);
    // Dedicated CDN namespace only. A tenant/visitor label is matched transiently,
    // never returned or stored by this matcher. Corporate www/docs/portal excluded.
    return group === 'forter-cdn-v1' && host.length <= 253 &&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)?cdn[0-9]{0,3}\.forter\.com$/.test(host);
  };
  return {
    matchVendorResource(url, type, now) {
      const previous = legacy.matchVendorResource(url, type, now);
      if (typeof url !== 'string' || url.length > 4096 || !url.startsWith('https://') ||
          !['script', 'xmlhttprequest', 'image', 'ping'].includes(type) || !Number.isFinite(now) ||
          /[\u0000-\u0020\u007f\\]/.test(url)) return previous;
      let parsed;
      try { parsed = new URL(url); } catch { return previous; }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return previous;
      // CSP documents these dedicated endpoint hosts, not a stable request path.
      // No query, path, cookie, response body or customer ID enters a match result.
      for (const entry of entries) if (current(entry, now) && entry.rule.matcher.resourceTypes.includes(type) &&
          hostMatches(entry.rule.matcher.hostGroup, parsed.hostname)) return [...previous, match(entry)].slice(0, 4);
      return previous;
    },
    lookupVendorResourceRule(id, now) {
      const previous = legacy.lookupVendorResourceRule(id, now);
      if (previous) return previous;
      const entry = entries.find(entry => entry.rule.id === id && current(entry, now));
      return entry ? match(entry) : null;
    },
    hasEnabledVendorResourceRules(now) {
      return legacy.hasEnabledVendorResourceRules(now) || entries.some(entry => current(entry, now));
    },
  };
}

export function patchForterMatcher(source) {
  // Idempotent section replacement keeps one auditable implementation.
  const begin = '// ADR-043: Forter resource matcher\n', end = '// ADR-043: end Forter resource matcher\n';
  if (source.includes(begin)) {
    const start = source.indexOf(begin), stop = source.indexOf(end, start);
    if (stop < 0) throw Error('Missing Forter matcher boundary');
    source = source.slice(0, start) + source.slice(stop + end.length).replace(/^\n+/, '');
  }
  const anchor = '// packages/catalog/src/vendors.rtc.runtime.json';
  if (source.split(anchor).length !== 2) throw Error('Expected one resource matcher boundary');
  const addition = begin + 'var legacyVendorResourceMatcher = createVendorResourceMatcher;\n' +
    'createVendorResourceMatcher = function(approvedRules) {\n  return (' + createForterResourceMatcher.toString() +
    ')(legacyVendorResourceMatcher(approvedRules), approvedRules, ' + JSON.stringify(FORTER_RESOURCE_POLICY) + ');\n};\n' + end + '\n';
  return source.replace(anchor, addition + anchor);
}
