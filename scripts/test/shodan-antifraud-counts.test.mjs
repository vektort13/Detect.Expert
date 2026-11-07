// REQ-001/005/010/011: aggregates only, bounded credentials and sanitized failures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import {
  PROJECT_ROOT, buildAggregatePlan, containedExistingPath, loadCredential,
  main, parseCredential, parseOptions, runAggregate, sanitizedErrorCode,
  validateAggregateConfig,
} from '../shodan-antifraud-counts.mjs';

const config = JSON.parse(await readFile(path.join(PROJECT_ROOT,
  'packages/catalog/data/shodan-aggregate.config.json'), 'utf8'));
const secret = 'shodan_test_key_1234567890';
const sourceUrl = 'https://docs.vendor.example.com/browser';
function vendor(id, officialHost = id + '.example.com', browserSignals = []) {
  return { id, officialWebsite: 'https://' + officialHost + '/', sources: [{ url: sourceUrl }], browserSignals };
}
function signal(host, extra = {}) {
  return { id: 'test-resource', kind: 'script-resource', host, path: '/sdk.js',
    sourceUrls: [sourceUrl], status: 'documented-candidate', productionEnabled: false,
    fixtureVerified: false, ...extra };
}
function catalog(vendors) {
  return { schemaVersion: 1, catalogVersion: 'test-1', researchOnly: true,
    productionEnabled: false, fixtureVerified: false, vendors };
}
function clock() {
  let timestamp = 0;
  return { now: () => timestamp, sleep: async ms => { timestamp += ms; } };
}
async function fixture(t) {
  const base = await mkdtemp(path.join(PROJECT_ROOT, 'scripts/test/.shodan-test-'));
  const projectRoot = path.join(base, 'project');
  await mkdir(projectRoot);
  t.after(async () => {
    const relative = path.relative(path.join(PROJECT_ROOT, 'scripts/test'), base);
    assert.ok(relative.startsWith('.shodan-test-') && !relative.includes(path.sep));
    await rm(base, { recursive: true, force: true });
  });
  return { base, projectRoot };
}

test('credentials accept only named formats and never include secret text in errors', () => {
  for (const text of [secret + '\n', 'SHODAN_API_KEY=' + secret,
    'OTHER=ignored\nexport SHODAN_KEY="' + secret + '" # note',
    JSON.stringify({ SHODAN_API_KEY: secret }), JSON.stringify({ shodan: { apiKey: secret } })]) {
    assert.equal(parseCredential(text), secret);
  }
  for (const text of ['{"SHODAN_API_KEY":"' + secret, 'SHODAN_API_KEY=' + secret + '\nSHODAN_KEY=different_key_12345',
    JSON.stringify({ SHODAN_KEY: secret }), secret + '\nextra', 'x'.repeat(65537)]) {
    assert.throws(() => parseCredential(text), error => {
      assert.ok(!error.message.includes(secret));
      assert.match(error.message, /^credential-(invalid|too-large)$/);
      return true;
    });
  }
});

test('explicit credential paths reject traversal and junction escapes inside the workspace', async t => {
  const { base, projectRoot } = await fixture(t);
  const outside = path.join(base, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'key.txt'), secret);
  await writeFile(path.join(projectRoot, 'key.txt'), secret);
  await symlink(outside, path.join(projectRoot, 'linked'), 'junction');
  assert.equal(await loadCredential({ projectRoot, keyFile: 'key.txt', env: {} }), secret);
  for (const keyFile of ['../outside/key.txt', path.join(outside, 'key.txt'), 'linked/key.txt']) {
    await assert.rejects(loadCredential({ projectRoot, keyFile, env: {} }), error => {
      assert.equal(sanitizedErrorCode(error), 'path-outside-project'); return true;
    });
  }
  await assert.rejects(containedExistingPath(projectRoot, '../missing-key.txt'), /path-outside-project/);
});

test('credential loading is bounded and explicit key files take precedence over env', async t => {
  const { projectRoot } = await fixture(t);
  await writeFile(path.join(projectRoot, 'large.key'), 'x'.repeat(65537));
  await assert.rejects(loadCredential({ projectRoot, keyFile: 'large.key', env: { SHODAN_API_KEY: secret } }),
    /credential-too-large/);
  await assert.rejects(loadCredential({ projectRoot, keyFile: 'missing.key', env: { SHODAN_API_KEY: secret } }),
    /credential-read-failed/);
  assert.equal(await loadCredential({ projectRoot, env: { SHODAN_API_KEY: secret } }), secret);
  await assert.rejects(loadCredential({ projectRoot, env: { SHODAN_KEY: secret } }), /credential-missing/);
});

test('plan selects deterministic exact documented hosts, excludes templates and unattested signals', () => {
  const vendors = [vendor('zeta', 'zeta.example.com', [signal('cdn.zeta.example.com'),
    signal('attacker.example.com', { sourceUrls: ['https://unlisted.example.com/'] }),
    signal('wildcard.example.com', { hostTemplate: '{customer}.example.com' }),
    signal('template.example.com', { kind: 'script-path-template', path: '/{key}/sdk.js' }),
    signal('192.0.2.10'), signal('*.example.com'), signal('bad.example.com OR port:22'),
    signal('unapproved.example.com', { status: 'unknown' })]), vendor('alpha')];
  const expected = ['cdn.zeta.example.com', 'alpha.example.com', 'zeta.example.com'];
  assert.deepEqual(buildAggregatePlan(catalog(vendors), config).entries.map(entry => entry.host), expected);
  assert.deepEqual(buildAggregatePlan(catalog(vendors.reverse()), config).entries.map(entry => entry.host), expected);
  assert.ok(buildAggregatePlan(catalog(vendors), config).entries.every(entry => entry.count === null && entry.status === 'not-run'));
  const many = catalog(Array.from({ length: 220 }, (_, index) => vendor('v' + index)));
  assert.equal(buildAggregatePlan(many, config, { maxRequests: 200 }).entries.length, 100);
  assert.throws(() => buildAggregatePlan(many, config, { maxRequests: 201 }), /invalid-options/);
  assert.equal(buildAggregatePlan(many, config, { maxRequests: 2 }).entries.length, 2);
});

test('published browser hosts take priority over marketing websites at the strict 100-host cap', () => {
  const marketing = Array.from({ length: 120 }, (_, index) => vendor('a' + index));
  const sdkHosts = Array.from({ length: 110 }, (_, index) => 'z' + index + '.sdk.example.com');
  const withSdk = vendor('vendor-sdk', 'vendor-sdk.example.com',
    sdkHosts.map((host, index) => signal(host, { id: 'sdk-' + index })));
  const result = buildAggregatePlan(catalog([...marketing, withSdk]), config, { maxRequests: 200 });
  assert.equal(result.entries.length, 100);
  assert.ok(result.entries.every(entry => entry.sources.some(source => source.kind === 'published-browser-host')));
  assert.deepEqual(result.entries.map(entry => entry.host), sdkHosts.sort().slice(0, 100));
});

test('CLI plan accesses neither env credentials nor key file and makes no network request', async t => {
  const { projectRoot } = await fixture(t);
  const directory = path.join(projectRoot, 'packages/catalog/data');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'shodan-aggregate.config.json'), JSON.stringify(config));
  await writeFile(path.join(directory, 'antifraud.v1.json'), JSON.stringify(catalog([vendor('alpha')])));
  const messages = [];
  const report = await main({ projectRoot, argv: ['--plan', '--key-file', '../outside.key'],
    env: new Proxy({}, { get() { throw new Error('credential accessed'); } }), validator: () => [],
    fetchImpl: () => { throw new Error('network accessed'); }, output: message => messages.push(message) });
  assert.equal(report.status, 'not-run');
  assert.equal(report.entries[0].count, null);
  assert.match(messages[0], /not-run/);
  const saved = await readFile(path.join(projectRoot, config.outputDirectory, 'aggregate-plan.json'), 'utf8');
  assert.ok(!saved.includes(secret));
});

test('a published exact hostname stays eligible when only its SDK path contains a documented token', () => {
  const data = catalog([vendor('alpha', 'alpha.example.com', [
    signal('cdn.alpha.example.com', { path: '/v4/{public-key}', pathMatch: 'template' }),
  ])]);
  const plan = buildAggregatePlan(data, config);
  assert.equal(plan.entries[0].host, 'cdn.alpha.example.com');
  assert.ok(plan.entries[0].sources.some(source => source.kind === 'published-browser-host'));
  assert.ok(plan.entries.every(entry => !entry.host.includes('{') && entry.count === null));
});

test('CLI output rejects a directory junction escaping the selected project root', async t => {
  const { base, projectRoot } = await fixture(t);
  const directory = path.join(projectRoot, 'packages/catalog/data');
  const outputParent = path.dirname(path.join(projectRoot, config.outputDirectory));
  const outside = path.join(base, 'outside-output');
  await mkdir(directory, { recursive: true });
  await mkdir(outputParent, { recursive: true });
  await mkdir(outside);
  await symlink(outside, path.join(projectRoot, config.outputDirectory), 'junction');
  await writeFile(path.join(directory, 'shodan-aggregate.config.json'), JSON.stringify(config));
  await writeFile(path.join(directory, 'antifraud.v1.json'), JSON.stringify(catalog([vendor('alpha')])));
  await assert.rejects(main({ projectRoot, argv: ['--plan'], validator: () => [], output: () => {} }),
    /path-outside-project/);
});

test('network requests use only manual-redirect count endpoint and output total only', async () => {
  const requests = [];
  const timer = clock();
  const report = await runAggregate({ catalog: catalog([vendor('alpha'), vendor('beta')]), config,
    credential: secret, ...timer, fetchImpl: async (url, options) => {
      requests.push({ url, options, timestamp: timer.now() });
      return new Response(JSON.stringify({ total: 27, matches: [{ ip_str: '192.0.2.10', port: 22 }],
        facets: { org: [{ value: 'not-output' }] }, error: secret }), { status: 200 });
    } });
  assert.equal(report.status, 'complete');
  assert.equal(requests[1].timestamp - requests[0].timestamp, 1000);
  for (const { url, options } of requests) {
    assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, 'api.shodan.io');
    assert.equal(url.pathname, '/shodan/host/count');
    assert.deepEqual([...url.searchParams.keys()].sort(), ['key', 'query']);
    assert.match(url.searchParams.get('query'), /^hostname:"(?:alpha|beta)\.example\.com"$/);
    assert.equal(options.redirect, 'manual'); assert.equal(options.method, 'GET');
    assert.ok(options.signal instanceof AbortSignal);
  }
  const serialized = JSON.stringify(report);
  for (const forbidden of [secret, '192.0.2.10', 'not-output', 'ip_str', 'facets', 'matches', 'api.shodan.io/shodan']) {
    assert.ok(!serialized.includes(forbidden));
  }
  assert.ok(report.entries.every(entry => entry.count === 27));
});

test('redirects and failure messages never expose key, raw URL, or response body', async () => {
  const one = catalog([vendor('alpha')]);
  for (const fetchImpl of [
    async () => new Response(secret, { status: 302, headers: { Location: 'https://attacker.example.com/' + secret } }),
    async url => { throw new Error('request ' + url.href + ' failed ' + secret); },
    async () => new Response(secret, { status: 500 }),
    async () => new Response('{"error":"' + secret + '"}', { status: 200 }),
  ]) {
    const report = await runAggregate({ catalog: one, config, credential: secret, fetchImpl });
    assert.equal(report.status, 'partial');
    assert.equal(report.entries[0].count, null);
    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes(secret)); assert.ok(!serialized.includes('attacker.example.com'));
    assert.ok(!serialized.includes('api.shodan.io/shodan'));
  }
});

test('401/403 stop the request sequence without reading error body', async () => {
  for (const status of [401, 403]) {
    let requests = 0, reads = 0;
    const report = await runAggregate({ catalog: catalog([vendor('alpha'), vendor('beta')]), config,
      credential: secret, fetchImpl: async () => { requests++;
        return { status, redirected: false, url: '', body: { cancel: () => Promise.resolve(),
          getReader: () => { reads++; throw new Error(secret); } } };
      } });
    assert.equal(requests, 1); assert.equal(reads, 0);
    assert.equal(report.status, 'authentication-stopped');
    assert.equal(report.entries[1].status, 'not-run-auth-stop');
  }
});

test('a request exceeding ten seconds aborts with a sanitized timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let aborted = false;
  const pending = runAggregate({ catalog: catalog([vendor('alpha')]), config, credential: secret,
    fetchImpl: (_url, options) => {
      options.signal.addEventListener('abort', () => { aborted = true; });
      return new Promise(() => {});
    } });
  t.mock.timers.tick(10000);
  const report = await pending;
  assert.equal(aborted, true);
  assert.equal(report.entries[0].status, 'request-timeout');
  assert.equal(report.entries[0].count, null);
  assert.ok(!JSON.stringify(report).includes(secret));
});

test('streamed and announced oversized responses are rejected, invalid totals are not coerced', async () => {
  const one = catalog([vendor('alpha')]);
  for (const response of [
    new Response('x'.repeat(65537)),
    new Response('{}', { headers: { 'content-length': '65537' } }),
    new Response('{"total":"12"}'), new Response('{"total":-1}'), new Response('{"total":9007199254740992}'),
  ]) {
    const report = await runAggregate({ catalog: one, config, credential: secret, fetchImpl: async () => response });
    assert.equal(report.entries[0].count, null);
    assert.ok(['response-too-large', 'invalid-response'].includes(report.entries[0].status));
  }
});

test('fragmented and empty hostile streams are bounded independently of the byte limit', async () => {
  for (const chunk of [new Uint8Array([32]), new Uint8Array(0)]) {
    let reads = 0, cancelled = 0;
    const body = {
      cancel: async () => {},
      getReader: () => ({
        read: async () => { reads++; return { done: false, value: chunk }; },
        cancel: async () => { cancelled++; }, releaseLock: () => {},
      }),
    };
    const report = await runAggregate({ catalog: catalog([vendor('alpha')]), config, credential: secret,
      fetchImpl: async () => ({ status: 200, redirected: false, url: '', headers: new Headers(), body }) });
    assert.equal(report.entries[0].status, 'response-too-large');
    assert.equal(report.entries[0].count, null);
    assert.equal(reads, config.maximumResponseChunks + 1);
    assert.equal(cancelled, 1);
  }
  const bytes = new TextEncoder().encode('{"total":7}');
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(0)); controller.enqueue(bytes); controller.enqueue(new Uint8Array(0));
    controller.close();
  } });
  const report = await runAggregate({ catalog: catalog([vendor('alpha')]), config, credential: secret,
    fetchImpl: async () => new Response(stream) });
  assert.equal(report.entries[0].status, 'ok');
  assert.equal(report.entries[0].count, 7);
});

test('configuration and CLI cannot introduce arbitrary endpoint, query, output path, or extra methods', () => {
  for (const argv of [[], ['--query', 'port:22'], ['--plan', '--run'], ['--run', '--output', '../x'],
    ['--run', '--max-requests', 'NaN'], ['--run', '--key-file']]) assert.throws(() => parseOptions(argv), /invalid-options/);
  for (const changed of [{ apiBaseUrl: 'https://attacker.example.com' }, { apiBaseUrl: 'http://api.shodan.io' },
    { apiBaseUrl: 'https://api.shodan.io:444' }, { countPath: '/shodan/host/search' },
    { outputDirectory: '../outside' }, { minimumRequestIntervalMs: 0 }, { requestTimeoutMs: 20000 },
    { maximumResponseChunks: 5000 }]) {
    assert.throws(() => validateAggregateConfig({ ...config, ...changed }), /invalid-config/);
  }
  assert.equal(sanitizedErrorCode(new Error(secret)), 'network-error');
});
