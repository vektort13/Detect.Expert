// REQ-001/005/011: names only; source confidence and conservative domain admission.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { createCookieClassifier, normalizeCookieDomain } from '../../packages/catalog/src/cookie-classifier.mjs';
import { buildCookieCatalog, parseUpstreamDomain } from '../cookie-catalog.mjs';
import { readCookieSnapshot } from '../../packages/contracts/src/inspection.mjs';

const { catalog } = await buildCookieCatalog({ write: false });
const builtIn = createCookieClassifier(catalog);
const classify = (name, domain = 'shop.example.com') => builtIn.classifyCookie({ name, domain });
const nativeCore = { hostOnly: true, secure: true, httpOnly: false, session: false, sameSite: 'lax' };
const project = cookie => builtIn.projectCookieMetadata({ ...nativeCore, ...cookie });
const rule = (extra = {}) => ({ id: 'fixture', name: 'fixture_cookie', match: 'exact', domainContext: 'domain', domains: ['example.com'], category: 'analytics', owner: 'Fixture', purpose: 'Own test fixture', confidence: 'community', sourceUrls: ['https://example.com/docs'], ...extra });

test('full licensed snapshot is retained, malformed candidates are not compiled', () => {
  assert.equal(catalog.quality.rawEntries, 2266);
  assert.equal(catalog.quality.platforms, 355);
  assert.equal(catalog.upstream.license, 'Apache-2.0');
  assert.equal(catalog.entries.filter(row => row.provenance?.kind === 'open-cookie-database').length, 2266);
  assert.ok(builtIn.ruleCount < catalog.entries.length);
  for (const row of catalog.entries.filter(row => row.confidence === 'documented')) {
    assert.equal(createCookieClassifier({ entries: [row] }).ruleCount, 1, row.name);
    assert.ok(row.provenance.sources.every(source => source.url.startsWith('https://') && source.claim && source.accessedAt === '2026-10-09'));
  }
});

test('documented first-party analytics and prefixes classify without identifier suffixes', () => {
  for (const name of ['_ga', '_ga_ABC123', '_gid', '__utma', '_clck', '_clsk', '__hstc', 'hubspotutk', 'ajs_anonymous_id', '_ym_uid', '_pk_id', '_pk_id.10.c0ffee']) {
    const result = classify(name);
    assert.equal(result.tracking, true, name); assert.equal(result.category, 'analytics', name); assert.equal(result.confidence, 'documented', name);
  }
  assert.equal(classify('_ga_ABC123').name, '_ga_*');
  assert.equal(classify('_pk_id.10.c0ffee').name, '_pk_id.*');
  assert.equal(classify('_ga_').tracking, false);
  assert.equal(classify('_pk_identifier').tracking, false);
});

test('security, authentication, load balancing and consent never imply tracking', () => {
  for (const [name, domain] of [
    ['__cf_bm', 'shop.example.com'], ['cf_clearance', 'shop.example.com'], ['_cfuvid', 'shop.example.com'],
    ['datadome', 'shop.example.com'], ['_pxvid', 'shop.example.com'], ['AWSALB', 'shop.example.com'], ['AWSALBAPP-3', 'shop.example.com'],
    ['wordpress_logged_in_IDENTIFIER_CANARY', 'shop.example.com'], ['wordpress_sec_IDENTIFIER_CANARY', 'shop.example.com'],
    ['SID', 'accounts.google.com'], ['HSID', 'google.com'], ['YSC', 'youtube.com'],
    ['matomo_sessid', 'shop.example.com'], ['matomo_ignore', 'shop.example.com'], ['mtm_consent_removed', 'shop.example.com'],
    ['__hs_do_not_track', 'shop.example.com'], ['__hsmem', 'shop.example.com'], ['__Host-hs-membership-csrf', 'shop.example.com'],
    ['GA_OPT_OUT', 'google-analytics.com']
  ]) {
    const result = classify(name, domain);
    assert.equal(result.tracking, false, name); assert.equal(result.confidence, 'documented', name);
    assert.notEqual(result.category, 'unknown', name);
  }
  assert.equal(classify('__gpi_optout').category, 'unknown');
  assert.equal(classify('__gpi_optout').tracking, false);
});

test('mixed purposes stay unknown; name, flags and short lifetime cannot prove TPM binding', () => {
  for (const name of ['NID', 'VISITOR_INFO1_LIVE', '__Secure-1PSIDTS', '__Secure-3PSIDTS', 'sessionid', 'SID']) {
    const result = project({ name, domain: 'google.com', secure: true, httpOnly: true, expirationDate: 1800000000 });
    assert.equal(Object.hasOwn(result, 'tpm'), false); assert.equal(Object.hasOwn(result, 'deviceBound'), false);
    if (name === 'NID' || name === 'VISITOR_INFO1_LIVE') assert.equal(result.category, 'unknown');
  }
});

test('community domain boundaries exclude lookalikes, userinfo, paths and malformed hosts', () => {
  const own = createCookieClassifier({ entries: [rule()] });
  for (const domain of ['example.com', '.EXAMPLE.COM', 'sub.example.com']) assert.equal(own.classifyCookie({ name: 'fixture_cookie', domain }).tracking, true);
  for (const domain of ['notexample.com', 'example.com.evil.test', 'example.com@evil.test', 'https://example.com', 'example.com/path', '..example.com', 'example.com.', '', 'x'.repeat(255), 'example.com\n']) assert.equal(own.classifyCookie({ name: 'fixture_cookie', domain }).tracking, false, domain);
  assert.equal(normalizeCookieDomain('.EXAMPLE.COM'), 'example.com');
});

test('unscoped community names, generic IDs and malformed domains remain ambiguous or unknown', () => {
  const own = createCookieClassifier({ entries: [rule({ name: 'id', domainContext: 'unassessed', domains: [] }), rule({ id: 'prefix', name: 'mp_', match: 'prefix', domainContext: 'unassessed', domains: [] })] });
  for (const name of ['id', 'mp_uniqueIdentifier']) {
    const result = own.classifyCookie({ name, domain: 'example.com' });
    assert.equal(result.tracking, false); assert.equal(result.category, 'unknown'); assert.equal(result.confidence, 'ambiguous');
  }
  for (const name of ['sessionid', 'PHPSESSID', 'uid', 'uuid', '_hjSessionUser_']) assert.equal(classify(name).tracking, false, name);
  assert.equal(classify('sessionid', 'instagram.com').category, 'unknown');
  assert.equal(classify('sessionid', 'instagram.com').tracking, false);
});

test('same name resolves from documented community domain context, preserving confidence', () => {
  assert.equal(classify('token', 'adform.net').category, 'advertising');
  assert.equal(classify('token', 'adform.net').confidence, 'community');
  assert.equal(classify('token', 'adnxs.com').category, 'functional');
  assert.equal(classify('token', 'adnxs.com').tracking, false);
  assert.equal(classify('token', 'shop.example.com').category, 'unknown');
});

test('documented application session and CSRF conventions are useful non-tracking classifications', () => {
  for (const [name, category] of [
    ['PHPSESSID', 'functional'], ['JSESSIONID', 'functional'], ['ASP.NET_SessionId', 'functional'],
    ['.AspNetCore.Session', 'functional'], ['connect.sid', 'functional'], ['django_language', 'functional'],
    ['csrftoken', 'security'], ['XSRF-TOKEN', 'security'], ['_csrf', 'security'], ['.ASPXAUTH', 'security'],
    ['.AspNetCore.Antiforgery.PRIVATE_SUFFIX', 'security'], ['.AspNetCore.Cookies', 'security'],
    ['.AspNetCore.Identity.Application', 'security'], ['Identity.External', 'security'],
    ['Identity.TwoFactorRememberMe', 'security'], ['Identity.TwoFactorUserId', 'security'],
    ['authjs.session-token', 'security'], ['__Secure-authjs.session-token.0', 'security'],
    ['__Host-authjs.csrf-token', 'security'], ['__Secure-authjs.pkce.code_verifier', 'security'],
    ['__Secure-authjs.challenge', 'security'], ['__Secure-next-auth.session-token.1', 'security'],
    ['__Host-next-auth.csrf-token', 'security'], ['next-auth.callback-url', 'functional']
  ]) {
    const result = classify(name);
    assert.equal(result.category, category, name); assert.equal(result.confidence, 'documented', name);
    assert.equal(result.tracking, false, name); assert.ok(result.purpose.length > 25, name);
    assert.match(result.owner, /^Site application \(/, name);
  }
  assert.equal(classify('.AspNetCore.Antiforgery.PRIVATE_SUFFIX').name, '.AspNetCore.Antiforgery.*');
  assert.equal(classify('__Secure-authjs.session-token.0').name, '__Secure-authjs.session-token.*');
  for (const name of ['session', 'sessionid', 'SESSIONID', 'sid', 'token', 'auth', 'access_token', 'uid', 'uuid', 'PHPSESSID_EXTRA', 'JSESSIONID_EXTRA', 'connect.sidx', 'authjs.custom']) {
    assert.equal(classify(name).category, 'unknown', name); assert.equal(classify(name).tracking, false, name);
  }
});

test('current Hotjar and Contentsquare cookie documentation distinguishes analytics, probes and consent', () => {
  for (const name of ['_hjSessionUser_123', '_hjSession_123', '_hjUserAttributesHash', '_hjHasCachedUserAttributes', '_cs_id', '_cs_s', '_cs_s_ctx', '_cs_i', '_cs_ep', '_cs_cvars', '_hp5_meta.123', '_hp5_let.123', '_hp5_event_props.123', '_cs_rl_adobe']) {
    const result = classify(name); assert.equal(result.category, 'analytics', name);
    assert.equal(result.tracking, true, name); assert.equal(result.confidence, 'documented', name);
  }
  for (const name of ['_hjCookieTest', '_hjLocalStorageTest', '_hjSessionStorageTest', '_hjTLDTest', '_hjClosedSurveyInvites', '_hjDonePolls', '_hjMinimizedPolls', '_cs_t', '_cs_same_site', '_cs_root-domain', '_cs_debug', '_cs_inc', '_hp2_hld1', '_cs_tld1670937307564']) {
    const result = classify(name); assert.equal(result.category, 'functional', name);
    assert.equal(result.tracking, false, name); assert.equal(result.confidence, 'documented', name);
  }
  for (const name of ['_cs_c', '_cs_ex', '_cs_optout']) {
    assert.equal(classify(name).category, 'consent', name); assert.equal(classify(name).tracking, false, name);
  }
  assert.equal(classify('_hjSessionUser_123').name, '_hjSessionUser_*');
  assert.equal(classify('_hp5_meta.123').name, '_hp5_meta.*');
  // Vendor documentation specifically rejects a blanket _cs_<number> convention.
  for (const name of ['_cs_1083746253643', '_cs_custom_secret', '_hjSessionUser_', '_hjSession_', '_hjUnknown', '_hp5_custom.123']) {
    assert.equal(classify(name).category, 'unknown', name); assert.equal(classify(name).tracking, false, name);
  }
});

test('documented CMP and traffic-validation cookies do not inflate the tracking badge', () => {
  for (const name of ['OptanonConsent', 'OptanonAlertBoxClosed', 'CookieConsent', 'CookieConsentBulkTicket', 'cookieyes-consent', 'cookieyesID', 'didomi_token', 'didomi_dcs', 'euconsent-v2', 'eupubconsent-v2', 'usprivacy', 'OTAdditionalConsentString', 'OTGPPConsent', 'OneTrustWPCCPAGoogleOptOut']) {
    const result = classify(name); assert.equal(result.category, 'consent', name);
    assert.equal(result.tracking, false, name); assert.equal(result.confidence, 'documented', name);
  }
  assert.match(classify('euconsent-v2').owner, /IAB TCF convention/);
  // A generic application may reuse this documented convention: consent is
  // useful metadata, but there is no maker/domain corroboration for a logo.
  for (const domain of ['custom-consent.example.com', 'other-cmp.example.net']) {
    const genericConsent = classify('CookieConsent', domain);
    assert.equal(genericConsent.owner, 'Site consent manager (Cookiebot convention)');
    assert.notEqual(genericConsent.owner, 'Cookiebot');
    assert.match(genericConsent.purpose, /name alone does not identify/);
    assert.equal(genericConsent.tracking, false);
  }
  for (const name of ['AWSELB', 'AWSELBCORS']) {
    assert.equal(classify(name).category, 'functional', name); assert.equal(classify(name).tracking, false, name);
  }
  assert.equal(classify('aws-waf-token').category, 'security'); assert.equal(classify('aws-waf-token').tracking, false);
  for (const domain of ['google.com', 'www.google.com', 'recaptcha.net', 'www.recaptcha.net']) assert.equal(classify('_GRECAPTCHA', domain).category, 'security');
  for (const domain of ['shop.example.com', 'google.com.evil.test', 'notrecaptcha.net']) assert.equal(classify('_GRECAPTCHA', domain).category, 'unknown');
  for (const name of ['consent', 'Consent', 'OptanonConsentPretend', 'didomi_custom', 'aws-waf-token-lookalike', '_GRECAPTCHA_EXTRA']) assert.equal(classify(name).category, 'unknown', name);
});

test('documented mixed-purpose matches retain an explanation while name references stay neutral', () => {
  const result = classify('NID', 'google.com');
  assert.equal(result.category, 'unknown'); assert.equal(result.tracking, false);
  assert.equal(result.confidence, 'documented'); assert.equal(result.owner, 'Google');
  assert.match(result.purpose, /Multiple documented purposes/); assert.ok(result.sourceUrls.length > 0);
  const conflicted = createCookieClassifier({ entries: [rule({ confidence: 'documented', category: 'unknown' }), rule({ id: 'other', confidence: 'documented', category: 'unknown', owner: 'Other' })] });
  const ambiguous = conflicted.classifyCookie({ name: 'fixture_cookie', domain: 'example.com' });
  assert.equal(ambiguous.confidence, 'ambiguous'); assert.equal(ambiguous.owner, ''); assert.equal(ambiguous.tracking, false);
  assert.match(ambiguous.purpose, /^Catalogue name match:/);
  const unscoped = createCookieClassifier({ entries: [rule({ domainContext: 'unassessed', domains: [] })] });
  const reference = unscoped.classifyCookie({ name: 'fixture_cookie', domain: 'example.com' });
  assert.match(reference.purpose, /^Catalogue name match:/); assert.equal(reference.owner, ''); assert.equal(reference.tracking, false);
});

test('equal-strength contradictory categories or owners are unknown; reviewed security wins', () => {
  const conflict = createCookieClassifier({ entries: [rule(), rule({ id: 'different', owner: 'Other', category: 'functional' })] });
  assert.equal(conflict.classifyCookie({ name: 'fixture_cookie', domain: 'example.com' }).confidence, 'ambiguous');
  const reviewed = createCookieClassifier({ entries: [rule(), rule({ id: 'primary', confidence: 'documented', domainContext: 'any', domains: [], category: 'security' })] });
  assert.equal(reviewed.classifyCookie({ name: 'fixture_cookie', domain: 'example.com' }).category, 'security');
});

test('cookie and partition getters, inherited fields and coercion are never invoked', () => {
  let reads = 0;
  const cookie = Object.create({ secure: true, session: true });
  Object.assign(cookie, nativeCore, { name: '_ga_PRIVATE_SUFFIX', domain: 'example.com', expirationDate: 1800000000 });
  for (const key of ['value', 'path', 'storeId', 'firstPartyDomain', 'toJSON', 'toString']) Object.defineProperty(cookie, key, { get() { reads++; throw new Error('secret getter'); } });
  const partition = { hasCrossSiteAncestor: true };
  for (const key of ['topLevelSite', 'nonce']) Object.defineProperty(partition, key, { get() { reads++; throw new Error('partition secret'); } });
  cookie.partitionKey = partition;
  const projected = builtIn.projectCookieMetadata(cookie);
  assert.equal(reads, 0); assert.equal(projected.name, '_ga_*'); assert.equal(projected.domain, 'example.com');
  assert.equal(projected.partitioned, true); assert.equal(projected.hasCrossSiteAncestor, true);
  assert.equal(projected.hostOnly, true); assert.equal(projected.httpOnly, false);
  assert.equal(projected.secure, true); assert.equal(projected.session, false);
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE_SUFFIX|topLevelSite|nonce|storeId|firstPartyDomain|"value"|"path"/);
  for (const key of ['name', 'domain', 'partitionKey']) {
    const hostile = {}; Object.defineProperty(hostile, key, { get() { reads++; throw new Error('forbidden'); } });
    builtIn.projectCookieMetadata(hostile);
  }
  const inherited = Object.create(nativeCore); inherited.name = '_ga'; inherited.domain = 'example.com';
  assert.equal(builtIn.projectCookieMetadata(inherited), null);
  assert.equal(reads, 0);
});

test('unknown names and malformed typed metadata have bounded conservative projection', () => {
  for (const name of ['<script>', 'a'.repeat(81), 'cookie:secret', 'cookie with spaces']) assert.equal(project({ name, domain: 'example.com' }).name, '<other>');
  const projected = project({ name: 'custom_cookie', domain: 'example.com', expirationDate: Infinity, partitionKey: [] });
  assert.equal(projected.name, 'custom_cookie'); assert.equal(projected.partitioned, false);
  assert.equal(Object.hasOwn(projected, 'expirationDate'), false);
  for (const extra of [{ secure: 1 }, { session: 'true' }, { sameSite: 'invalid' }, { domain: 'invalid/domain' }, { name: null }]) assert.equal(project({ name: 'custom_cookie', domain: 'example.com', ...extra }), null);
  assert.equal(project({ name: 'custom_cookie', domain: 'example.com', expirationDate: 253402300799 }).expirationDate, 253402300799);
  assert.equal(Object.hasOwn(project({ name: 'custom_cookie', domain: 'example.com', expirationDate: 253402300800 }), 'expirationDate'), false);
});

test('catalog arrays ignore accessors, duplicate IDs fail and the global bound is enforced', () => {
  let reads = 0;
  const domains = []; Object.defineProperty(domains, '0', { get() { reads++; return 'example.com'; } });
  const rows = []; Object.defineProperty(rows, '0', { get() { reads++; return rule(); } });
  assert.equal(createCookieClassifier({ entries: rows }).ruleCount, 0);
  assert.equal(createCookieClassifier({ entries: [rule({ domains })] }).ruleCount, 0);
  assert.equal(reads, 0);
  assert.throws(() => createCookieClassifier({ entries: [rule(), rule()] }), /Duplicate/);
  assert.throws(() => createCookieClassifier({ entries: new Array(8193) }), /bounded/);
});

test('equal-strength matching results respect the canonical eight-source and eight-rule bounds', () => {
  const entries = Array.from({ length: 12 }, (_, index) => rule({ id: 'fixture-' + String(index).padStart(2, '0'), sourceUrls: ['https://example.com/source-' + index] }));
  const own = createCookieClassifier({ entries });
  const result = own.projectCookieMetadata({ ...nativeCore, name: 'fixture_cookie', domain: 'example.com' });
  assert.equal(result.ruleIds.length, 8); assert.equal(result.sourceUrls.length, 8); assert.equal(result.tracking, true);
  entries.push(rule({ id: 'conflict', category: 'security' }));
  assert.equal(createCookieClassifier({ entries }).classifyCookie({ name: 'fixture_cookie', domain: 'example.com' }).category, 'unknown');
});

test('every retained catalog row projects into the canonical cookie inventory contract', () => {
  for (const row of catalog.entries) {
    const entry = project({ name: row.name + (row.match === 'prefix' ? 'TEST_SUFFIX' : ''), domain: row.domains[0] || 'fixture.example.com' });
    assert.ok(entry, row.id);
    const snapshot = readCookieSnapshot({ schemaVersion: 1, type: 'cookies-state', documentKey: '1:0:fixture', coverageState: 'active', permission: 'granted', trackingCount: Number(entry.tracking), entries: [entry], truncated: false, observedAt: 1000, sessionBinding: { status: 'not-observed', headers: [] } });
    assert.ok(snapshot, row.id + ':' + row.name);
  }
});

test('Map-based names and fresh results avoid prototype mutation', () => {
  const own = createCookieClassifier({ entries: [rule({ name: '__proto__' }), rule({ id: 'constructor', name: 'constructor', category: 'functional' })] });
  assert.equal(own.classifyCookie({ name: '__proto__', domain: 'example.com' }).tracking, true);
  const first = own.classifyCookie({ name: 'constructor', domain: 'example.com' }); first.sourceUrls.push('https://bad.example'); first.category = 'advertising';
  const second = own.classifyCookie({ name: 'constructor', domain: 'example.com' });
  assert.equal(second.category, 'functional'); assert.equal(second.sourceUrls.length, 1); assert.equal(Object.prototype.tracking, undefined);
});

test('upstream domain annotations are normalized conservatively and wildcard flags are not regex', () => {
  assert.deepEqual(parseUpstreamDomain('.bing.com (3rd party) or .microsoft.com (3rd party)'), { domains: ['bing.com', 'microsoft.com'], domainContext: 'domain' });
  for (const domain of ['', 'ads-[account].adhese.com', 'good.example or invalid/domain', 'google-analytics.com (3rd party) or ']) assert.equal(parseUpstreamDomain(domain).domainContext, 'unassessed');
  const row = catalog.entries.find(row => row.name === 'SSPR_*');
  assert.equal(row.match, 'exact'); assert.equal(classify('SSPR_id', 'adkernel.com').tracking, false);
});

test('offline generator checks byte-identical reviewed artifacts and browser module matches source', async () => {
  await buildCookieCatalog({ write: false, verify: true });
  const browser = await import('../../apps/production-extension/cookie-catalog.js');
  assert.equal(browser.cookieCatalog.entries.length, catalog.entries.length);
  const input = { ...nativeCore, name: '_ga_IDENTIFIER_CANARY', domain: 'example.com', partitionKey: { topLevelSite: 'SECRET_SITE', hasCrossSiteAncestor: false }, value: 'VALUE_CANARY' };
  assert.deepEqual(browser.projectCookieMetadata(input), builtIn.projectCookieMetadata(input));
  const code = await fs.readFile(new URL('../../apps/production-extension/cookie-catalog.js', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|chrome\.cookies|browser\.cookies|storage\.sync/);
});
