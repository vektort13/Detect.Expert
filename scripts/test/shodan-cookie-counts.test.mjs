import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCookieCountPlan, runCookieCounts, parseCookieCountOptions, readStdinCredential, mainCookieCounts } from '../shodan-cookie-counts.mjs';
const secret = 'mock_shodan_key_123456789';
const catalog = { schemaVersion: 1, entries: ['__cf_bm', 'datadome', '_ga'].map(name => ({ name, match: 'exact', owner: 'Test vendor', sourceUrls: ['https://docs.vendor.org/cookies'] })) };
const one = { ...catalog, entries: catalog.entries.slice(0, 1) };
function clock() { let value = 0; return { now: () => value, sleep: async ms => { value += ms; } }; }

test('fixed documented plan excludes arbitrary names, prefix patterns and unsafe source URLs', () => {
  const result = buildCookieCountPlan({ ...catalog, entries: [...catalog.entries, { name: 'attacker" port:22', match: 'exact', owner: 'Attacker', sourceUrls: ['https://attacker.org/'] }, { name: '_pxhd', match: 'prefix', owner: 'Vendor', sourceUrls: ['https://vendor.org/'] }, { name: 'cf_clearance', match: 'exact', owner: 'Vendor', sourceUrls: ['https://user:password@vendor.org/'] }] });
  assert.equal(result.entries.length, 3);
  assert.equal(result.maximumRequests, 40);
  assert.ok(result.entries.every(row => row.query === '"set-cookie" "' + row.name + '"'));
});

test('only count endpoint receives credentials and only total leaves the response', async () => {
  const calls = []; const timer = clock();
  const result = await runCookieCounts({ catalog, credential: secret, ...timer, fetchImpl: async (url, options) => { calls.push({ url, options, at: timer.now() }); return new Response(JSON.stringify({ total: 19, matches: [{ ip_str: '192.0.2.123', data: 'secret cookie value' }], facets: { org: ['private-banner'] }, key: secret })); } });
  assert.equal(result.status, 'complete');
  assert.equal(calls[1].at - calls[0].at, 1000);
  for (const { url, options } of calls) { assert.equal(url.href.split('?')[0], 'https://api.shodan.io/shodan/host/count'); assert.deepEqual([...url.searchParams.keys()].sort(), ['key', 'query']); assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit'); }
  for (const sentinel of [secret, '192.0.2.123', 'secret cookie value', 'private-banner', 'matches', 'facets']) assert.ok(!JSON.stringify(result).includes(sentinel));
});

test('redirects, oversized bodies, malformed totals and raw exception text are sanitized', async () => {
  for (const fetchImpl of [async () => new Response(secret, { status: 302, headers: { location: 'https://leak.org/' + secret } }), async () => { throw Error(secret); }, async () => new Response('x'.repeat(65537)), async () => new Response('{"total":"19","key":"' + secret + '"}'), async () => new Response('{"total":-1}')]) {
    const result = await runCookieCounts({ catalog: one, credential: secret, fetchImpl }); assert.equal(result.status, 'partial'); assert.equal(result.entries[0].total, null); assert.ok(!JSON.stringify(result).includes(secret)); assert.ok(!JSON.stringify(result).includes('leak.org'));
  }
});

test('401 and 403 stop immediately without reading sensitive error bodies', async () => {
  for (const status of [401, 403]) { let calls = 0, reads = 0; const result = await runCookieCounts({ catalog, credential: secret, fetchImpl: async () => { calls++; return { status, redirected: false, url: '', body: { cancel: async () => {}, getReader: () => { reads++; throw Error(secret); } } }; } }); assert.equal(calls, 1); assert.equal(reads, 0); assert.equal(result.status, 'authentication-stopped'); assert.ok(result.entries.slice(1).every(row => row.status === 'not-run-auth-stop')); }
});

test('ten-second deadline aborts an unresponsive fetch', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let aborted = false; const pending = runCookieCounts({ catalog: one, credential: secret, fetchImpl: (_url, options) => { options.signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {}); } }); t.mock.timers.tick(10000); const result = await pending; assert.ok(aborted); assert.equal(result.entries[0].status, 'request-timeout');
});

test('stdin is bounded, JSON credential accepted, CLI rejects custom query/endpoint/output', async () => {
  async function* input(value) { yield Buffer.from(value); }
  assert.equal(await readStdinCredential(input(JSON.stringify({ SHODAN_API_KEY: secret }))), secret);
  await assert.rejects(readStdinCredential(input('x'.repeat(65537))), /credential-too-large/);
  for (const argv of [[], ['--run', '--query', 'port:22'], ['--run', '--url', 'https://leak.org/'], ['--run', '--output', '../leak'], ['--run', '--stdin-key', '--key-file', 'key'], ['--plan', '--run']]) assert.throws(() => parseCookieCountOptions(argv), /invalid-options/);
});

test('plan mode never reads key/stdin/environment and never calls network', async () => {
  const result = await mainCookieCounts({ argv: ['--plan', '--stdin-key'], env: new Proxy({}, { get() { throw Error('env read'); } }), stdin: { [Symbol.asyncIterator]() { throw Error('stdin read'); } }, fetchImpl: () => { throw Error('network called'); }, output: () => {} }); assert.equal(result.mode, 'plan'); assert.ok(result.requestCount <= 40);
});
