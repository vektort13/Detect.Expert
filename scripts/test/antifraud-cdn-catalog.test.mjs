import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { ROOT, OUTPUT, generate, validateCdnCatalog, toShodanCatalog, exactHostname, renderCsv, attachShodanResults } from '../antifraud-cdn-catalog.mjs';
import { buildAggregatePlan, runAggregate } from '../shodan-antifraud-counts.mjs';
import { parseCdnOptions, loadCdnCatalog } from '../shodan-cdn-counts.mjs';

const catalog = JSON.parse(readFileSync(resolve(ROOT, OUTPUT), 'utf8'));
const config = JSON.parse(readFileSync(resolve(ROOT, 'packages/catalog/data/shodan-aggregate.config.json'), 'utf8'));
const copy = value => JSON.parse(JSON.stringify(value));
const byHost = host => catalog.entries.filter(e => e.host === host && e.runtimeStatus === 'candidate');

test('all 32 shipped products and 61 original rules survive in the research inventory', () => {
  assert.deepEqual(validateCdnCatalog(catalog), []);
  const baseline = JSON.parse(readFileSync(resolve(ROOT, 'packages/catalog/research/cdn-2026-10/runtime-baseline.json'), 'utf8'));
  assert.equal(catalog.vendors.length, 32);
  const rows = catalog.entries.filter(e => e.runtimeStatus === 'already-present');
  assert.equal(new Set(rows.map(r => r.runtimeRuleId)).size, 61);
  for (const v of baseline.vendors) for (const rule of v.resourceRules) {
    const matching = rows.filter(r => r.runtimeRuleId === rule.id);
    assert.ok(matching.length > 0, rule.id);
    for (const row of matching) assert.deepEqual(row.runtimeMatcher, rule.matcher);
  }
  assert.equal(rows.filter(r => r.host.endsWith('.cloudfront.net')).length, 15);
});

test('regeneration is byte identical and contains no automatic runtime activation', () => {
  assert.deepEqual(generate({ check: true }), catalog);
  const candidates = catalog.entries.filter(e => e.runtimeStatus === 'candidate');
  assert.equal(candidates.length, 78);
  assert.equal(new Set(candidates.filter(r => r.newExactHost).map(r => r.host)).size, 45);
  assert.equal(catalog.totals.domainFamilies, 2);
  assert.ok(candidates.every(r => !r.productionEnabled && !r.fixtureVerified && r.requiresCorroboration));
});

test('CDN, collectors, resolver families and related products remain distinguishable', () => {
  assert.equal(byHost('api-js.datadome.co')[0].role, 'browser-collector');
  assert.equal(byHost('ct.captcha-delivery.com')[0].role, 'challenge-script');
  assert.equal(byHost('*.seondnsresolve.com')[0].role, 'resolver-namespace');
  assert.equal(byHost('*.apitd.net')[0].productRelation, 'related-product');
  assert.equal(byHost('cloudauth-device.aliyuncs.com')[0].productRelation, 'documented-captcha-use');
  assert.equal(byHost('tst.kaptcha.com')[0].environment, 'test');
});

test('shared domains, namespaces and server-side endpoints are not promoted to host-only signatures', () => {
  const gstatic = byHost('www.gstatic.com')[0];
  assert.equal(gstatic.path, '/recaptcha/'); assert.equal(gstatic.pathMatch, 'prefix'); assert.equal(gstatic.sharedHost, true);
  for (const host of ['g.alicdn.com', 'x.alicdn.com']) {
    assert.equal(byHost(host)[0].sharedHost, true); assert.equal(byHost(host)[0].path, null);
  }
  assert.equal(catalog.entries.some(e => e.host === '*.cloudfront.net'), false);
  assert.equal(catalog.entries.some(e => e.host === '{company}-verify.arkoselabs.com'), false);
  assert.equal(catalog.entries.some(e => e.host === 'api.fpjs.io'), false);
});

test('retired Tencent hosts and legacy SEON resources have explicit lifecycle labels', () => {
  assert.equal(catalog.entries.filter(e => e.lifecycle === 'retired').length, 6);
  assert.ok(catalog.entries.filter(e => e.lifecycle === 'retired').every(e => e.retiredAt === '2023-08-21'));
  assert.equal(byHost('cdn.getdeviceinf.com')[0].lifecycle, 'legacy');
  assert.equal(byHost('cdn.seondf.com')[0].lifecycle, 'legacy');
});

test('Shodan plan deduplicates exact published hosts and excludes corporate/templates/retired/unqualified shared hosts', () => {
  const plan = buildAggregatePlan(toShodanCatalog(catalog), config);
  const hosts = plan.entries.map(row => row.host);
  assert.equal(new Set(hosts).size, hosts.length);
  assert.ok(hosts.length <= 100 && hosts.length > 30);
  assert.ok(hosts.every(exactHostname));
  assert.ok(hosts.includes('web.fpcs-monitor.com.br') && hosts.includes('static-captcha-sgp.aliyuncs.com'));
  for (const excluded of ['g.alicdn.com', 'x.alicdn.com', 'kaxsdc.com', 'kount.net', 'c.paypal.com', 'ssl.captcha.qq.com', '*.px-cdn.net', '{company}-api.arkoselabs.com']) assert.equal(hosts.includes(excluded), false, excluded);
  assert.ok(plan.entries.every(e => e.sources.every(s => s.kind === 'published-browser-host')));
});

test('invalid ownership/source/gate/host data fails catalog validation before query planning', () => {
  for (const [field, value] of [['productionEnabled', true], ['fixtureVerified', true], ['requiresCorroboration', false], ['host', '192.0.2.1'], ['vendorId', 'untracked'], ['sourceUrls', ['https://unrelated.example/']]]) {
    const altered = copy(catalog), row = altered.entries.find(e => e.runtimeStatus === 'candidate' && e.hostMatch === 'exact');
    row[field] = value;
    assert.ok(validateCdnCatalog(altered).length, field);
    assert.throws(() => toShodanCatalog(altered), /invalid-cdn-catalog/);
  }
  for (const host of ['*.example.com', 'https://example.com', 'example.com:443', 'example.com/path', 'example.com?key=x', '127.0.0.1', 'example.com\n', 'a..example.com']) assert.equal(exactHostname(host), false, host);
});

test('known vendors and known sources cannot be rebound to unrelated resource records', () => {
  for (const change of [row => { row.vendorId = 'forter'; },
    row => { row.sourceUrls = [byHost('b.stats.paypal.com')[0].sourceUrls[0]]; },
    row => { row.host = 'unpublished.example.com'; }, row => { row.sharedHost = !row.sharedHost; }]) {
    const altered = copy(catalog), row = altered.entries.find(e => e.runtimeStatus === 'candidate' && e.host === 'ct.captcha-delivery.com');
    change(row); assert.ok(validateCdnCatalog(altered).includes('unpublished-candidate-binding'));
  }
  const altered = copy(catalog); altered.entries.find(e => e.lifecycle === 'retired').lifecycle = 'current';
  assert.ok(validateCdnCatalog(altered).includes('unpublished-candidate-binding'));
});

test('Shodan enrichment preserves candidate gates and separates zero from not selected', () => {
  const report = {catalogVersion:catalog.catalogVersion, source:{provider:'Shodan', operation:'host-count'}, generatedAt:'2026-10-10T10:00:00Z', entries:[{host:'ct.captcha-delivery.com', status:'ok', count:0}]};
  const enriched = attachShodanResults(copy(catalog), report);
  assert.equal(enriched.entries.find(e=>e.host==='ct.captcha-delivery.com').shodanIndexCount, 0);
  assert.equal(enriched.entries.find(e=>e.host==='*.px-cdn.net').shodanIndexCount, null);
  assert.equal(enriched.entries.find(e=>e.host==='*.px-cdn.net').shodanIndexStatus, 'not-selected');
  assert.ok(enriched.entries.filter(e=>e.runtimeStatus==='candidate').every(e=>!e.productionEnabled && !e.fixtureVerified));
  for (const entry of [{host:'unpublished.example.com', status:'ok', count:10}, {host:'ct.captcha-delivery.com', status:'ok', count:-1}]) {
    assert.throws(()=>attachShodanResults(copy(catalog), {...report, entries:[entry]}), /invalid-cdn-count-report/);
  }
});

test('CSV escapes formula cells and retains paths, statuses and provenance columns', () => {
  const altered = copy(catalog); altered.entries[0].note = '=HYPERLINK("bad")';
  const csv = renderCsv(altered);
  assert.ok(csv.startsWith('\uFEFF"vendorId"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('"sourceEvidence"') && csv.includes('"runtimeStatus"'));
});

test('CLI offers only fixed aggregate plan/run with memory-only credential input', () => {
  assert.deepEqual(parseCdnOptions(['--run', '--stdin-key']), { mode: 'run', stdinKey: true });
  assert.deepEqual(parseCdnOptions(['--plan']), { mode: 'plan' });
  for (const args of [[], ['--plan', '--run'], ['--run', '--query', 'anything'], ['--endpoint', 'https://elsewhere.example'], ['--plan', '--stdin-key']]) assert.throws(() => parseCdnOptions(args), /invalid-options/);
});

test('catalog input is bounded, UTF-8 checked and validated before credential loading', async t => {
  const base = await mkdtemp(join(ROOT, 'scripts/test/.cdn-test-'));
  t.after(async () => {
    const target = relative(join(ROOT, 'scripts/test'), base);
    assert.ok(target.startsWith('.cdn-test-') && !target.includes(sep));
    await rm(base, { recursive: true, force: true });
  });
  await mkdir(join(base, 'packages/catalog/data'), { recursive: true });
  const file = join(base, OUTPUT);
  await writeFile(file, JSON.stringify(catalog));
  assert.deepEqual(await loadCdnCatalog(base), toShodanCatalog(catalog));
  for (const input of [Buffer.alloc(2 * 1024 * 1024 + 1), Buffer.from([0xff]), '{"secret":"fixture-canary', '{}']) {
    await writeFile(file, input);
    await assert.rejects(loadCdnCatalog(base), error => error.message === 'invalid-cdn-catalog');
  }
});

test('aggregate transport keeps only totals, sanitizes secrets and stops on authorization errors', async () => {
  const selected = toShodanCatalog(catalog); let requests = 0, time = 0;
  const key = 'cdn_fixture_key_1234567890';
  const report = await runAggregate({ catalog: selected, config, credential: key, now: () => time, sleep: async ms => { time += ms; },
    fetchImpl: async (input, options) => {
      const url = new URL(input); requests++;
      assert.equal(url.origin, 'https://api.shodan.io'); assert.equal(url.pathname, '/shodan/host/count');
      assert.equal(url.searchParams.get('key'), key); assert.match(url.searchParams.get('query'), /^hostname:"[a-z0-9.-]+"$/);
      assert.equal(url.searchParams.has('facets'), false); assert.equal(options.redirect, 'manual');
      return requests === 1 ? new Response(JSON.stringify({total:3, matches:[{ip_str:'192.0.2.1', data:key}]}), {status:200}) : new Response(key, {status:403});
    } });
  assert.equal(requests, 2); assert.equal(report.status, 'authentication-stopped'); assert.equal(report.entries[0].count, 3);
  assert.ok(report.entries.slice(2).every(row => row.status === 'not-run-auth-stop'));
  assert.equal(JSON.stringify(report).includes(key), false); assert.equal(JSON.stringify(report).includes('192.0.2.1'), false);
});
