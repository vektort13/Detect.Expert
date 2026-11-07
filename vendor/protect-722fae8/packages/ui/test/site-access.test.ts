import { describe, expect, it } from 'vitest';
import {
  ALL_SITES_PATTERNS,
  MAX_ACCESS_PATTERNS,
  MAX_SITE_ROWS,
  allSitesGranted,
  exactGrantHost,
  offRevocableOf,
  revocableFor,
  siteAccessView,
  siteRemovedNoticeKey,
} from '../src/view-models/site-access';
import { scope } from './fixtures';

const EXAMPLE = ['http://example.com/*', 'https://example.com/*'];

describe('site access view model (S12 / E13-03, ADR-003 v3)', () => {
  it('rows = union of the site list and exact host grants; statuses in rule order', () => {
    const vm = siteAccessView(scope({ scopeMode: 'site', hosts: ['example.com', 'listed.example'] }), {
      origins: [...EXAMPLE, 'https://granted.example/*', 'http://127.0.0.1/*', '*://*.wild.example/*'],
      required: ['http://127.0.0.1/*'],
    });
    expect(vm.rows.map((r) => [r.host, r.statusKey, r.listed, r.revocable, r.required])).toEqual([
      ['example.com', 'site_status_observed', true, EXAMPLE, false],
      ['listed.example', 'site_status_listed_inactive', true, [], false],
      ['granted.example', 'site_status_granted_only', false, ['https://granted.example/*'], false],
      ['127.0.0.1', 'site_status_required', false, [], true],
    ]);
    expect(vm.hidden).toBe(0);
    expect(vm.otherGrants).toBe(1);
    expect(vm.allSites).toEqual({ granted: false, required: false, revocable: [], observed: false });
    // Off-revoke: optional http(s) grants only; the required one stays.
    expect(vm.offRevocable).toEqual([...EXAMPLE, 'https://granted.example/*', '*://*.wild.example/*']);
    expect(vm.managed).toBe(false);
  });

  it('a listed host outside site mode is "listed, not observed now"; all-sites access counts as a grant in site mode', () => {
    expect(siteAccessView(scope({ scopeMode: 'off', hosts: ['example.com'] }), { origins: EXAMPLE, required: [] }).rows[0]?.statusKey).toBe('site_status_listed_inactive');
    expect(siteAccessView(scope({ scopeMode: 'all-sites', hosts: ['example.com'] }), { origins: EXAMPLE, required: [] }).rows[0]?.statusKey).toBe('site_status_listed_inactive');
    expect(siteAccessView(scope({ scopeMode: 'site', hosts: ['example.com'] }), { origins: [...ALL_SITES_PATTERNS], required: [] }).rows[0]?.statusKey).toBe('site_status_observed');
  });

  it('CW-06: all-sites mode with the broad grant observes every row (listed or only granted); without it nothing changes', () => {
    const access = { origins: [...ALL_SITES_PATTERNS, ...EXAMPLE, 'https://granted.example/*', 'http://127.0.0.1/*'], required: ['http://127.0.0.1/*'] };
    const vm = siteAccessView(scope({ scopeMode: 'all-sites', hosts: ['example.com', 'listed.example'] }), access);
    expect(vm.rows.map((r) => [r.host, r.statusKey])).toEqual([
      ['example.com', 'site_status_observed'],
      ['listed.example', 'site_status_observed'],
      ['granted.example', 'site_status_observed'],
      ['127.0.0.1', 'site_status_required'],
    ]);
    expect(vm.allSites.observed).toBe(true);
    expect(siteAccessView(scope({ scopeMode: 'all-sites', hosts: [] }), { origins: ['<all_urls>'], required: [] }).allSites.observed).toBe(true);
    // The same grants in site mode: only the listed, granted hosts are observed; the broad grant row is not «observed».
    const site = siteAccessView(scope({ scopeMode: 'site', hosts: ['example.com'] }), access);
    expect(site.rows.map((r) => [r.host, r.statusKey])).toEqual([
      ['example.com', 'site_status_observed'],
      ['granted.example', 'site_status_granted_only'],
      ['127.0.0.1', 'site_status_required'],
    ]);
    expect(site.allSites.observed).toBe(false);
    // all-sites without the broad grant observes nothing (SW inScope = grantedAllSites).
    const partial = siteAccessView(scope({ scopeMode: 'all-sites', hosts: ['example.com'] }), { origins: ['http://*/*', ...EXAMPLE], required: [] });
    expect(partial.rows[0]?.statusKey).toBe('site_status_listed_inactive');
    expect(partial.allSites).toMatchObject({ granted: false, observed: false });
  });

  it('all-sites access: <all_urls> or both wildcards; revocable excludes required patterns', () => {
    expect(allSitesGranted(['<all_urls>'])).toBe(true);
    expect(allSitesGranted(['http://*/*'])).toBe(false);
    expect(allSitesGranted([...ALL_SITES_PATTERNS])).toBe(true);
    const vm = siteAccessView(scope({ scopeMode: 'all-sites', hosts: [] }), { origins: [...ALL_SITES_PATTERNS], required: [] });
    expect(vm.allSites).toEqual({ granted: true, required: false, revocable: [...ALL_SITES_PATTERNS], observed: true });
    expect(vm.rows).toEqual([]);
    expect(vm.otherGrants).toBe(0);
    const required = siteAccessView(scope(), { origins: [...ALL_SITES_PATTERNS], required: ['https://*/*'] });
    expect(required.allSites).toEqual({ granted: true, required: true, revocable: ['http://*/*'], observed: false });
    const allUrls = siteAccessView(scope(), { origins: ['<all_urls>'], required: [] });
    expect(allUrls.allSites.granted).toBe(true);
    expect(allUrls.offRevocable).toEqual([]);
  });

  it('bounded: at most 128 rows (the rest is a count), at most 512 revoke patterns', () => {
    const origins = Array.from({ length: 300 }, (_, i) => 'https://h' + i + '.example/*');
    const vm = siteAccessView(scope({ scopeMode: 'site', hosts: [] }), { origins, required: [] });
    expect(vm.rows).toHaveLength(MAX_SITE_ROWS);
    expect(vm.hidden).toBe(300 - MAX_SITE_ROWS);
    const many = Array.from({ length: 700 }, (_, i) => 'http://h' + i + '.example/*');
    expect(offRevocableOf({ origins: many, required: [] })).toHaveLength(MAX_ACCESS_PATTERNS);
    expect(offRevocableOf(null)).toEqual([]);
  });

  it('exact grants only: wildcards, paths, other schemes and unsanitized hosts are not rows', () => {
    expect(exactGrantHost('https://example.com/*')).toBe('example.com');
    expect(exactGrantHost('http://127.0.0.1/*')).toBe('127.0.0.1');
    for (const p of ['https://*.example.com/*', 'https://*/*', 'https://example.com/path/*', 'ftp://example.com/*', 'https://Example.com/*', '<all_urls>', 'file:///*']) {
      expect(exactGrantHost(p), p).toBeNull();
    }
    expect(revocableFor('example.com', { origins: ['https://example.com/*'], required: [] })).toEqual(['https://example.com/*']);
    expect(revocableFor('example.com', { origins: EXAMPLE, required: ['http://example.com/*'] })).toEqual(['https://example.com/*']);
  });

  it('no access data, managed scope, and the removal notice order', () => {
    const empty = siteAccessView(null, null);
    expect(empty).toEqual({ rows: [], hidden: 0, allSites: { granted: false, required: false, revocable: [], observed: false }, otherGrants: 0, offRevocable: [], managed: false });
    expect(siteAccessView(scope({ managed: true }), { origins: [], required: [] }).managed).toBe(true);
    expect(siteRemovedNoticeKey(true, true, false)).toBe('site_removed_all_sites_kept');
    expect(siteRemovedNoticeKey(false, false, true)).toBe('site_removed_access_kept');
    expect(siteRemovedNoticeKey(false, true, true)).toBe('site_removed_access_kept');
    expect(siteRemovedNoticeKey(false, true, false)).toBe('site_removed');
  });

  it('the view model carries hosts and patterns only (no URL paths, queries or page data)', () => {
    const vm = siteAccessView(scope({ scopeMode: 'site', hosts: ['example.com'] }), { origins: EXAMPLE, required: [] });
    expect(JSON.stringify(vm)).not.toMatch(/\?|#|@/);
  });
});
