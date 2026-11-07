// ADR-109: the one network file of the Proxy Manager Geolocation API. Fake fetch, fake timers and fake providers only: no real network,
// no real timer, and nothing here depends on proxy-geo-providers.js.
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate as tick } from 'node:timers/promises';
import { createGeoClient } from '../../apps/production-extension/proxy-geo-client.js';
import { GEO_LIMITS, GEO_ERRORS, defaultGeoSettings } from '../../apps/production-extension/proxy-geo-shared.js';

// A promise that never settles fails its own test after 15 s instead of hanging the whole run.
const test = (name, body) => nodeTest(name, { timeout: 15000 }, body);

const NOW = 1_800_000_000_000, KEY = 'CANARY_KEY_0123456789', BASIC = 'Basic CANARY_BASIC_HEADER_VALUE';
const ORIGIN = 'https://api.ipdata.co', URL_OK = ORIGIN + '/8.8.8.8?api-key=' + KEY, CAP = GEO_LIMITS.responseBytes;
const SECRETS = [URL_OK, KEY, BASIC, 'CANARY_BODY_TEXT', 'CANARY_ERROR_TEXT'];
const encode = text => new TextEncoder().encode(text);
const cp = (...codes) => String.fromCodePoint(...codes);
const shape = (error, retryAfterMs = null, quota = null) => ({ ok: false, error, retryAfterMs, quota });

function fakeProviders({ build, parse } = {}) {
  const calls = { build: [], parse: [] };
  return {
    calls,
    geoBuildRequest(...args) { calls.build.push(args); return build ? build(...args) : { ok: true, url: URL_OK, headers: { Accept: 'application/json', Authorization: BASIC }, origin: ORIGIN, bucket: 'ipdata' }; },
    geoParseResponse(...args) { calls.parse.push(args); return parse ? parse(...args) : { ok: true, record: { marker: 'record' }, quota: { remaining: 7, pausedMs: null } }; },
  };
}
function fakeTimers() {
  let next = 0;
  const timers = new Map(), cleared = [];
  return {
    cleared, created: () => next, get pending() { return timers.size; }, ms: () => [...timers.values()].map(timer => timer.ms),
    setTimeoutImpl(fn, ms) { timers.set(++next, { fn, ms }); return next; },
    clearTimeoutImpl(id) { cleared.push(id); timers.delete(id); },
    fire() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); } },
  };
}
function fakeFetch(handler) {
  const calls = [];
  const fn = (url, options) => { calls.push({ url, options }); return handler(url, options, calls.length); };
  fn.calls = calls;
  return fn;
}
const jsonHeaders = { 'content-type': 'application/json' };
const reply = (body, init = {}) => new Response(body, { status: 200, headers: jsonHeaders, ...init });
// A body made of the given chunks; the hooks tell the test what the client did to the stream. With hooks.open the stream stays open after
// the last chunk (a closed stream cannot be cancelled, so that is the way to see a cancel).
function chunked(chunks, init = {}, hooks = {}) {
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) { hooks.pulls = (hooks.pulls ?? 0) + 1; if (index < chunks.length) controller.enqueue(chunks[index++]); else if (!hooks.open) controller.close(); },
    cancel() { hooks.cancelled = true; },
  });
  return reply(stream, init);
}
// A body that never ends.
function endless(chunk, init = {}, hooks = {}) {
  const stream = new ReadableStream({ pull(controller) { hooks.pulls = (hooks.pulls ?? 0) + 1; controller.enqueue(chunk); }, cancel() { hooks.cancelled = true; } });
  return reply(stream, init);
}
function setup({ fetchImpl, providers = fakeProviders(), timers = fakeTimers() } = {}) {
  const client = createGeoClient({ fetchImpl, now: () => NOW, setTimeoutImpl: timers.setTimeoutImpl, clearTimeoutImpl: timers.clearTimeoutImpl, providers });
  return { client, providers, timers };
}
const ask = (client, extra = {}) => client.request({ providerId: 'ipdata', ip: '8.8.8.8', credential: { apiKey: KEY }, settings: defaultGeoSettings(), ...extra });
const assertClean = (value, ...more) => { const text = JSON.stringify(value); for (const secret of [...SECRETS, ...more]) assert.ok(!text.includes(secret), 'leaked: ' + secret); };
const never = () => new Promise(() => {});

test('one hardened GET, then the parser, then a clean result; the timer is armed with the deadline and cleared', async () => {
  const fetchImpl = fakeFetch(() => reply('{"a":1}', { headers: { ...jsonHeaders, 'X-RL': '44', 'x-ttl': '12' } }));
  const { client, providers, timers } = setup({ fetchImpl });
  const result = await ask(client);
  assert.deepEqual(result, { ok: true, record: { marker: 'record' }, quota: { remaining: 7, pausedMs: null } });
  assert.equal(fetchImpl.calls.length, 1, 'exactly one HTTP request');
  const { url, options } = fetchImpl.calls[0];
  assert.equal(url, URL_OK);
  assert.deepEqual(Object.keys(options).sort(), ['cache', 'credentials', 'headers', 'method', 'mode', 'redirect', 'referrerPolicy', 'signal'], 'no cookie, referrer or other option');
  assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
  assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.mode, 'cors');
  assert.deepEqual(options.headers, { Accept: 'application/json', Authorization: BASIC });
  assert.ok(options.signal instanceof AbortSignal && options.signal.aborted === false);
  assert.equal(providers.calls.build.length, 1);
  assert.deepEqual(providers.calls.build[0], ['ipdata', '8.8.8.8', { credential: { apiKey: KEY }, settings: defaultGeoSettings() }]);
  assert.equal(providers.calls.parse.length, 1);
  const [providerId, answer, extra] = providers.calls.parse[0];
  assert.equal(providerId, 'ipdata');
  assert.deepEqual(answer, { status: 200, headers: { 'content-type': 'application/json', 'x-rl': '44', 'x-ttl': '12' }, text: '{"a":1}' });
  assert.deepEqual(Object.keys(extra).sort(), ['ip', 'now', 'settings'], 'the parser never sees the credential');
  assert.equal(extra.ip, '8.8.8.8'); assert.equal(extra.now, NOW);
  assert.equal(timers.created(), 1); assert.equal(timers.cleared.length, 1); assert.equal(timers.pending, 0);
});

test('the deadline timer is armed with GEO_LIMITS.requestMs', async () => {
  const timers = fakeTimers();
  const { client } = setup({ timers, fetchImpl: fakeFetch(() => never()) });
  const pending = ask(client);
  await tick();
  assert.deepEqual(timers.ms(), [GEO_LIMITS.requestMs]);
  assert.equal(GEO_LIMITS.requestMs, 12000);
  timers.fire();
  assert.equal((await pending).error, 'timeout');
});

test('a refusal to build is returned as it is, without any request and without a timer', async () => {
  for (const error of ['not-public', 'no-key', 'http-not-allowed', 'no-provider']) {
    const fetchImpl = fakeFetch(() => reply('{}'));
    const { client, providers, timers } = setup({ fetchImpl, providers: fakeProviders({ build: () => ({ ok: false, error }) }) });
    assert.deepEqual(await ask(client), shape(error));
    assert.equal(fetchImpl.calls.length, 0, error); assert.equal(providers.calls.parse.length, 0); assert.equal(timers.created(), 0);
  }
  for (const build of [() => { throw new Error('CANARY_ERROR_TEXT ' + URL_OK); }, () => null, () => 'x', () => ({ ok: false, error: 'CANARY_ERROR_TEXT' }), () => ({ ok: false }), () => ({ ok: 1 })]) {
    const fetchImpl = fakeFetch(() => reply('{}'));
    const { client } = setup({ fetchImpl, providers: fakeProviders({ build }) });
    const result = await ask(client);
    assert.deepEqual(result, shape('bad-response')); assertClean(result);
    assert.equal(fetchImpl.calls.length, 0);
  }
});

test('the request must stay on the hosts of its own provider; anything else is refused before the network', async () => {
  const wrong = [
    { url: 'https://evil.example/8.8.8.8?api-key=' + KEY, origin: 'https://evil.example' },            // not a provider host at all
    { url: 'https://api.ipgeolocation.io/x?apiKey=' + KEY, origin: 'https://api.ipgeolocation.io' },   // another provider's host
    { url: 'https://api.ipdata.co.evil.example/x', origin: ORIGIN },                                    // prefix trick
    { url: 'https://api.ipdata.co@evil.example/x', origin: ORIGIN },                                    // userinfo trick
    { url: ORIGIN, origin: ORIGIN },                                                                     // no path
    { url: new URL(URL_OK), origin: ORIGIN },                                                            // not a string
    { url: URL_OK, origin: undefined },
  ];
  for (const part of wrong) {
    const fetchImpl = fakeFetch(() => reply('{}'));
    const { client } = setup({ fetchImpl, providers: fakeProviders({ build: () => ({ ok: true, headers: {}, bucket: 'ipdata', ...part }) }) });
    const result = await ask(client);
    assert.deepEqual(result, shape('bad-response')); assertClean(result, 'evil.example');
    assert.equal(fetchImpl.calls.length, 0, JSON.stringify(part.origin));
  }
  for (const providerId of ['constructor', '__proto__', 'toString', 'nope', '', 5, null, undefined]) {
    const fetchImpl = fakeFetch(() => reply('{}'));
    const { client } = setup({ fetchImpl });
    assert.deepEqual(await ask(client, { providerId }), shape('bad-response'));
    assert.equal(fetchImpl.calls.length, 0);
  }
  // Every catalogue host is allowed for its own provider only.
  const fetchImpl = fakeFetch(() => reply('{}'));
  const { client } = setup({ fetchImpl, providers: fakeProviders({ build: (id) => ({ ok: true, url: 'http://ip-api.com/json/8.8.8.8', headers: {}, origin: 'http://ip-api.com', bucket: id }) }) });
  assert.equal((await ask(client, { providerId: 'ipapi' })).ok, true);
  assert.equal((await ask(client, { providerId: 'ipdata' })).error, 'bad-response', 'the ip-api host is not an ipdata host');
});

test('a rejected fetch is network, with no message or URL in the result; a synchronous throw too', async () => {
  const failures = [
    () => Promise.reject(new TypeError('Failed to fetch CANARY_ERROR_TEXT ' + URL_OK + ' ' + KEY)),
    () => { throw new TypeError('CANARY_ERROR_TEXT ' + URL_OK); },
    () => Promise.reject(new DOMException('CANARY_ERROR_TEXT', 'AbortError')),   // an abort that is not ours is not a timeout
    () => Promise.reject('CANARY_ERROR_TEXT'),
    () => Promise.reject(undefined),
  ];
  for (const handler of failures) {
    const fetchImpl = fakeFetch(handler);
    const { client, timers } = setup({ fetchImpl });
    const result = await ask(client);
    assert.deepEqual(result, shape('network')); assertClean(result);
    assert.equal(fetchImpl.calls.length, 1, 'no retry'); assert.equal(timers.pending, 0); assert.equal(timers.cleared.length, 1);
  }
});

test('a redirect is never followed: the option is error, so the browser rejects and that is network', async () => {
  let followed = 0;
  const fetchImpl = fakeFetch((url, options) => {
    if (options.redirect === 'error') return Promise.reject(new TypeError('redirect mode is set to error'));
    followed++; return Promise.resolve(reply('{"followed":true}'));
  });
  const { client, providers } = setup({ fetchImpl });
  assert.deepEqual(await ask(client), shape('network'));
  assert.equal(followed, 0); assert.equal(fetchImpl.calls.length, 1); assert.equal(providers.calls.parse.length, 0);
});

test('timeout: when our timer fires the request is aborted and the answer is timeout', async () => {
  let signal;
  const fetchImpl = fakeFetch((url, options) => new Promise((resolve, reject) => {
    signal = options.signal;
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  const { client, timers } = setup({ fetchImpl });
  const pending = ask(client);
  await tick();
  assert.equal(signal.aborted, false); assert.equal(timers.pending, 1);
  timers.fire();
  const result = await pending;
  assert.deepEqual(result, shape('timeout'));
  assert.equal(signal.aborted, true); assert.equal(timers.pending, 0); assert.equal(fetchImpl.calls.length, 1);
});

test('timeout: even a fetch that ignores the abort cannot hold the caller past the deadline', async () => {
  const fetchImpl = fakeFetch(() => never());
  const { client, timers } = setup({ fetchImpl });
  const pending = ask(client);
  await tick();
  timers.fire();
  assert.deepEqual(await pending, shape('timeout'));
  assert.equal(timers.pending, 0);
});

test('timeout while the body is being read: the answer is timeout and the stalled read is aborted with the request', async () => {
  let signal;
  const fetchImpl = fakeFetch((url, options) => {
    signal = options.signal;
    const stream = new ReadableStream({ pull() { return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))); } });
    return Promise.resolve(reply(stream));
  });
  const { client, providers, timers } = setup({ fetchImpl });
  const pending = ask(client);
  await tick();
  timers.fire();
  assert.deepEqual(await pending, shape('timeout'));
  await tick();
  assert.equal(signal.aborted, true); assert.equal(providers.calls.parse.length, 0); assert.equal(timers.pending, 0);
});

test('size cap: exactly the cap is read, one byte more is bad-response and the stream is cancelled', async () => {
  const edge = new Uint8Array(CAP).fill(97);
  let { client, providers } = setup({ fetchImpl: fakeFetch(() => reply(edge)) });
  assert.equal((await ask(client)).ok, true);
  assert.equal(providers.calls.parse[0][1].text.length, CAP);
  const hooks = { open: true };
  ({ client, providers } = setup({ fetchImpl: fakeFetch(() => chunked([new Uint8Array(CAP).fill(97), new Uint8Array([98])], {}, hooks)) }));
  assert.deepEqual(await ask(client), shape('bad-response'));
  assert.equal(hooks.cancelled, true, 'the rest of the stream is not downloaded'); assert.equal(providers.calls.parse.length, 0);
});

test('size cap: several chunks that add up past the cap stop at the chunk that crosses it', async () => {
  const hooks = {};
  const chunks = Array.from({ length: 20 }, () => new Uint8Array(4096).fill(97));
  const { client, providers } = setup({ fetchImpl: fakeFetch(() => chunked(chunks, {}, hooks)) });
  assert.deepEqual(await ask(client), shape('bad-response'));
  assert.equal(hooks.cancelled, true); assert.ok(hooks.pulls <= 20, 'pulls: ' + hooks.pulls); assert.equal(providers.calls.parse.length, 0);
});

test('size cap: a declared length above the cap is refused and the body is cancelled; a junk or smaller length is ignored', async () => {
  const hooks = { open: true };
  let { client, providers } = setup({ fetchImpl: fakeFetch(() => chunked([encode('{"a":1}')], { headers: { ...jsonHeaders, 'content-length': String(CAP + 1) } }, hooks)) });
  assert.deepEqual(await ask(client), shape('bad-response'));
  assert.equal(hooks.cancelled, true); assert.equal(providers.calls.parse.length, 0);
  ({ client, providers } = setup({ fetchImpl: fakeFetch(() => reply('{"a":1}', { headers: { ...jsonHeaders, 'content-length': String(CAP) } })) }));
  assert.equal((await ask(client)).ok, true, 'a length equal to the cap is allowed');
  for (const value of ['abc', '1e9', '-5', '12, 12', '']) {
    ({ client, providers } = setup({ fetchImpl: fakeFetch(() => reply('{"a":1}', { headers: { ...jsonHeaders, 'content-length': value } })) }));
    assert.equal((await ask(client)).ok, true, 'content-length ' + JSON.stringify(value) + ' is not a number, the stream cap decides');
  }
  // A lie about the length is caught by the stream cap anyway.
  const lie = { open: true };
  ({ client } = setup({ fetchImpl: fakeFetch(() => chunked([new Uint8Array(CAP + 10).fill(97)], { headers: { ...jsonHeaders, 'content-length': '10' } }, lie)) }));
  assert.deepEqual(await ask(client), shape('bad-response')); assert.equal(lie.cancelled, true);
});

test('size cap: a body that never ends is cancelled at the cap and the call returns', async () => {
  const hooks = {};
  const { client, providers, timers } = setup({ fetchImpl: fakeFetch(() => endless(new Uint8Array(1024).fill(97), {}, hooks)) });
  assert.deepEqual(await ask(client), shape('bad-response'));
  assert.equal(hooks.cancelled, true); assert.ok(hooks.pulls <= CAP / 1024 + 4, 'pulls: ' + hooks.pulls);
  assert.equal(providers.calls.parse.length, 0); assert.equal(timers.pending, 0);
});

test('size cap: an endless run of empty chunks is bounded too (it cannot starve the deadline)', async () => {
  const hooks = {};
  const { client } = setup({ fetchImpl: fakeFetch(() => endless(new Uint8Array(0), {}, hooks)) });
  assert.deepEqual(await ask(client), shape('bad-response'));
  assert.equal(hooks.cancelled, true); assert.ok(hooks.pulls < 5000, 'pulls: ' + hooks.pulls);
});

test('a stream that fails half way is network, with nothing of the failure in the result', async () => {
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) { if (index++ === 0) controller.enqueue(encode('{"par')); else controller.error(new TypeError('CANARY_ERROR_TEXT ' + URL_OK)); },
  });
  const { client, providers } = setup({ fetchImpl: fakeFetch(() => reply(stream)) });
  const result = await ask(client);
  assert.deepEqual(result, shape('network')); assertClean(result); assert.equal(providers.calls.parse.length, 0);
});

test('chunks that are not bytes are refused', async () => {
  const stream = new ReadableStream({ pull(controller) { controller.enqueue('text instead of bytes'); controller.close(); } });
  const { client } = setup({ fetchImpl: fakeFetch(() => reply(stream)) });
  assert.deepEqual(await ask(client), shape('bad-response'));
});

test('content type: a successful answer must say json (any case); anything else is bad-response before the parser', async () => {
  for (const type of ['application/json', 'Application/JSON; charset=UTF-8', 'application/vnd.maxmind.com-error+json', 'text/json', 'APPLICATION/X-JSON']) {
    const { client, providers } = setup({ fetchImpl: fakeFetch(() => reply('{"a":1}', { headers: { 'content-type': type } })) });
    assert.equal((await ask(client)).ok, true, type); assert.equal(providers.calls.parse.length, 1);
  }
  for (const headers of [{ 'content-type': 'text/html' }, { 'content-type': 'text/plain; charset=utf-8' }, { 'content-type': 'application/octet-stream' }, {}]) {
    const hooks = {};
    const { client, providers } = setup({ fetchImpl: fakeFetch(() => chunked([encode('{"a":1}')], { headers }, hooks)) });
    // A Response made from a stream has no implicit content type; the plain headers above are what the server "sent".
    assert.deepEqual(await ask(client), shape('bad-response'), JSON.stringify(headers));
    assert.equal(providers.calls.parse.length, 0); assert.equal(hooks.cancelled, true, 'an unread body is cancelled');
  }
});

test('other statuses go to the parser with their body whatever the type, when the body is within the cap', async () => {
  const cases = [[404, 'text/html', '<html>CANARY_BODY_TEXT</html>'], [429, 'application/json', '{"error":"slow"}'], [500, '', ''], [403, 'application/vnd.maxmind.com-error+json', '{"code":"X"}'], [401, 'text/plain', 'nope']];
  for (const [status, type, body] of cases) {
    const { client, providers } = setup({ fetchImpl: fakeFetch(() => new Response(body === '' ? null : body, { status, headers: type ? { 'content-type': type } : {} })),
      providers: fakeProviders({ parse: () => ({ ok: false, error: 'rate-limited', retryAfterMs: 1500, quota: { remaining: 0, pausedMs: 1500 } }) }) });
    const result = await ask(client);
    assert.deepEqual(result, shape('rate-limited', 1500, { remaining: 0, pausedMs: 1500 }), String(status));
    assert.equal(providers.calls.parse[0][1].status, status); assert.equal(providers.calls.parse[0][1].text, body); assertClean(result);
  }
  const hooks = { open: true };
  const { client, providers } = setup({ fetchImpl: fakeFetch(() => chunked([new Uint8Array(CAP + 1).fill(97)], { status: 500 }, hooks)) });
  assert.deepEqual(await ask(client), shape('bad-response'), 'an oversized error body is not passed on');
  assert.equal(providers.calls.parse.length, 0); assert.equal(hooks.cancelled, true);
});

test('empty bodies: a successful answer with nothing in it is bad-response; an empty error body still reaches the parser', async () => {
  for (const body of ['', null]) {
    const { client, providers } = setup({ fetchImpl: fakeFetch(() => new Response(body, { status: 200, headers: jsonHeaders })) });
    assert.deepEqual(await ask(client), shape('bad-response')); assert.equal(providers.calls.parse.length, 0);
  }
  const { client, providers } = setup({ fetchImpl: fakeFetch(() => new Response(null, { status: 204, headers: jsonHeaders })) });
  assert.deepEqual(await ask(client), shape('bad-response')); assert.equal(providers.calls.parse.length, 0);
  const second = setup({ fetchImpl: fakeFetch(() => new Response(null, { status: 429 })), providers: fakeProviders({ parse: (id, { status, text }) => ({ ok: false, error: status === 429 && text === '' ? 'rate-limited' : 'bad-response', retryAfterMs: null, quota: null }) }) });
  assert.deepEqual(await ask(second.client), shape('rate-limited'));
});

test('a status the browser would never report is bad-response; the body is cancelled', async () => {
  const hooks = {};
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(encode('{}')); }, cancel() { hooks.cancelled = true; } });
  for (const status of [0, 99, 600, 1000, 200.5, '200', null, undefined]) {
    const { client, providers } = setup({ fetchImpl: fakeFetch(() => ({ status, headers: new Headers(jsonHeaders), body: status === 0 ? stream : null })) });
    assert.deepEqual(await ask(client), shape('bad-response'), String(status)); assert.equal(providers.calls.parse.length, 0);
  }
  assert.equal(hooks.cancelled, true);
});

test('response headers reach the parser as a plain object: lower-case names, bounded count and length', async () => {
  const headers = new Headers({ 'Content-Type': 'application/json', 'X-RL': '0', 'X-Ttl': '30', 'Retry-After': '5', 'X-Long': 'v'.repeat(2000) });
  for (let index = 0; index < 100; index++) headers.set('x-many-' + String(index).padStart(3, '0'), 'v');
  const { client, providers } = setup({ fetchImpl: fakeFetch(() => new Response('{"a":1}', { status: 200, headers })) });
  await ask(client);
  const seen = providers.calls.parse[0][1].headers;
  assert.equal(Object.getPrototypeOf(seen), Object.prototype);
  assert.ok(Object.keys(seen).length <= 64, String(Object.keys(seen).length));
  assert.ok(Object.keys(seen).every(name => name === name.toLowerCase()));
  assert.ok(Object.values(seen).every(value => typeof value === 'string' && value.length <= 512));
  const small = new Headers({ 'Content-Type': 'application/json', 'X-RL': '0', 'X-Ttl': '30', 'Retry-After': '5' });
  const second = setup({ fetchImpl: fakeFetch(() => new Response('{"a":1}', { status: 200, headers: small })) });
  await ask(second.client);
  assert.deepEqual(second.providers.calls.parse[0][1].headers, { 'content-type': 'application/json', 'retry-after': '5', 'x-rl': '0', 'x-ttl': '30' });
});

test('the body is decoded as UTF-8: characters split between chunks survive, a BOM is dropped, bad bytes do not throw', async () => {
  const text = '{"city":"Z' + cp(0xfc) + 'rich ' + cp(0x2713) + ' ' + cp(0x1f600) + '"}', all = encode(text);
  const cut = [all.slice(0, 11), all.slice(11, 12), all.slice(12, 22), all.slice(22)];
  let { client, providers } = setup({ fetchImpl: fakeFetch(() => chunked(cut)) });
  assert.equal((await ask(client)).ok, true); assert.equal(providers.calls.parse[0][1].text, text);
  ({ client, providers } = setup({ fetchImpl: fakeFetch(() => reply(new Uint8Array([0xef, 0xbb, 0xbf, ...encode('{"a":1}')]))) }));
  await ask(client); assert.equal(providers.calls.parse[0][1].text, '{"a":1}');
  ({ client, providers } = setup({ fetchImpl: fakeFetch(() => reply(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]))) }));
  assert.equal((await ask(client)).ok, true); assert.equal(providers.calls.parse[0][1].text, '{' + cp(0xfffd, 0xfffd) + '}');
});

test('what the parser returns is reshaped: known fields only, numbers sanitised, codes checked; a throwing parser is bad-response', async () => {
  const run = parse => setup({ fetchImpl: fakeFetch(() => reply('{"a":1}')), providers: fakeProviders({ parse }) }).client;
  let result = await ask(run(() => ({ ok: true, record: { marker: 'r' }, quota: { remaining: 3, pausedMs: 40, key: KEY }, url: URL_OK, headers: { a: 1 } })));
  assert.deepEqual(result, { ok: true, record: { marker: 'r' }, quota: { remaining: 3, pausedMs: 40 } }); assertClean(result);
  result = await ask(run(() => ({ ok: false, error: 'quota', retryAfterMs: 5000, quota: { remaining: 0, pausedMs: null }, url: URL_OK, message: 'CANARY_ERROR_TEXT' })));
  assert.deepEqual(result, shape('quota', 5000, { remaining: 0, pausedMs: null })); assertClean(result);
  for (const quota of [{ remaining: -1, pausedMs: Infinity }, { remaining: NaN, pausedMs: '5' }, { remaining: null }, {}]) {
    assert.deepEqual((await ask(run(() => ({ ok: true, record: { m: 1 }, quota })))).quota, { remaining: null, pausedMs: null });
  }
  for (const quota of [undefined, null, 'x', 5, false]) assert.equal((await ask(run(() => ({ ok: true, record: { m: 1 }, quota })))).quota, null);
  for (const retryAfterMs of [-1, NaN, Infinity, '5', undefined, null, {}]) assert.equal((await ask(run(() => ({ ok: false, error: 'rate-limited', retryAfterMs })))).retryAfterMs, null);
  for (const parse of [() => null, () => undefined, () => 'ok', () => 5, () => ({}), () => ({ ok: true }), () => ({ ok: true, record: null }), () => ({ ok: true, record: 'x' }),
    () => ({ ok: false, error: 'not-a-code' }), () => ({ ok: false, error: 'CANARY_ERROR_TEXT' }), () => ({ ok: false }), () => { throw new Error('CANARY_ERROR_TEXT ' + KEY); }]) {
    result = await ask(run(parse));
    assert.deepEqual(result, shape('bad-response')); assertClean(result);
  }
  for (const error of GEO_ERRORS) assert.equal((await ask(run(() => ({ ok: false, error })))).error, error, 'every catalogue code passes');
});

test('exactly one request per call; no failure is retried, and two calls are two requests', async () => {
  const scenarios = [
    () => Promise.reject(new TypeError('x')), () => reply('{}', { status: 500 }), () => reply('<html>', { headers: { 'content-type': 'text/html' } }),
    () => reply(new Uint8Array(CAP + 1)), () => reply(''), () => never(),
  ];
  for (const handler of scenarios) {
    const fetchImpl = fakeFetch(handler);
    const { client, timers } = setup({ fetchImpl });
    const pending = ask(client);
    await tick(); timers.fire();
    await pending;
    assert.equal(fetchImpl.calls.length, 1);
  }
  const fetchImpl = fakeFetch(() => reply('{"a":1}'));
  const { client } = setup({ fetchImpl });
  await ask(client); await ask(client);
  assert.equal(fetchImpl.calls.length, 2);
});

test('every path clears its timer and leaves none behind', async () => {
  const hooks = {};
  const paths = [
    ['success', () => reply('{"a":1}')],
    ['reject', () => Promise.reject(new TypeError('x'))],
    ['http 500', () => reply('{"a":1}', { status: 500 })],
    ['too large', () => reply(new Uint8Array(CAP + 1))],
    ['content length', () => reply('{}', { headers: { ...jsonHeaders, 'content-length': String(CAP + 1) } })],
    ['wrong type', () => reply('x', { headers: { 'content-type': 'text/html' } })],
    ['empty', () => reply('')],
    ['endless', () => endless(new Uint8Array(512), {}, hooks)],
    ['sync throw', () => { throw new Error('x'); }],
  ];
  for (const [name, handler] of paths) {
    const timers = fakeTimers();
    const { client } = setup({ fetchImpl: fakeFetch(handler), timers });
    await ask(client);
    assert.equal(timers.created(), 1, name); assert.equal(timers.cleared.length, 1, name); assert.equal(timers.pending, 0, name);
  }
  // A parser that throws, and a timeout that fires.
  let timers = fakeTimers();
  await ask(setup({ fetchImpl: fakeFetch(() => reply('{"a":1}')), providers: fakeProviders({ parse: () => { throw new Error('x'); } }), timers }).client);
  assert.equal(timers.pending, 0); assert.equal(timers.cleared.length, 1);
  timers = fakeTimers();
  const pending = ask(setup({ fetchImpl: fakeFetch(() => never()), timers }).client);
  await tick(); timers.fire(); await pending;
  assert.equal(timers.pending, 0);
});

test('it never throws or rejects, whatever it is given; a deadline that cannot be armed means no request at all', async () => {
  const fetchImpl = fakeFetch(() => reply('{"a":1}'));
  const { client } = setup({ fetchImpl });
  const hostile = { get providerId() { throw new Error('CANARY_ERROR_TEXT'); } };
  for (const input of [undefined, null, {}, 5, 'x', [], { providerId: 5 }, hostile]) {
    const result = await client.request(input);
    assert.equal(result.ok, false); assert.ok(GEO_ERRORS.includes(result.error)); assertClean(result);
  }
  assert.equal(fetchImpl.calls.length, 0);
  const idleFetch = fakeFetch(() => reply('{"a":1}'));
  const broken = createGeoClient({ fetchImpl: idleFetch, now: () => NOW, setTimeoutImpl: () => { throw new Error('no timers'); }, clearTimeoutImpl: () => {}, providers: fakeProviders() });
  assert.deepEqual(await ask(broken), shape('bad-response'));
  assert.equal(idleFetch.calls.length, 0, 'no deadline, no request');
  const noFetch = createGeoClient({ fetchImpl: 'nope', now: () => NOW, setTimeoutImpl: fakeTimers().setTimeoutImpl, clearTimeoutImpl: () => {}, providers: fakeProviders() });
  assert.deepEqual(await ask(noFetch), shape('network'));
  const loose = createGeoClient({ fetchImpl: fakeFetch(() => reply('{"a":1}')), now: () => NOW, setTimeoutImpl: fakeTimers().setTimeoutImpl, clearTimeoutImpl: () => { throw new Error('clear failed'); }, providers: fakeProviders() });
  assert.equal((await ask(loose)).ok, true, 'a failing clearTimeout does not turn a result into an error');
});

test('defaults: the global fetch is the transport and is called once with the same options; nothing is called at creation', async () => {
  const original = globalThis.fetch, seen = [];
  globalThis.fetch = (url, options) => { seen.push({ url, options }); return Promise.resolve(reply('{"a":1}')); };
  try {
    const client = createGeoClient({ providers: fakeProviders(), setTimeoutImpl: fakeTimers().setTimeoutImpl, clearTimeoutImpl: () => {} });
    assert.equal(seen.length, 0);
    assert.equal((await ask(client)).ok, true);
    assert.equal(seen.length, 1); assert.equal(seen[0].url, URL_OK);
    assert.equal(seen[0].options.credentials, 'omit'); assert.equal(seen[0].options.redirect, 'error'); assert.equal(seen[0].options.referrerPolicy, 'no-referrer');
  } finally { globalThis.fetch = original; }
});

test('source guard: one request site, the hardened options spelled out, no other network, timer or storage use', () => {
  const source = readFileSync(new URL('../../apps/production-extension/proxy-geo-client.js', import.meta.url), 'utf8');
  assert.equal(source.match(/\bfetchImpl\s*\(/g).length, 1, 'a single call site');
  assert.equal(source.match(/\bfetch\b/g).length, 1, 'the only mention of fetch is the default transport');
  for (const required of ["method: 'GET'", "credentials: 'omit'", "redirect: 'error'", "cache: 'no-store'", "referrerPolicy: 'no-referrer'", "mode: 'cors'"]) assert.ok(source.includes(required), required);
  for (const forbidden of [/XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts|\bimport\(/, /setInterval/, /redirect: 'follow'|redirect: 'manual'/, /credentials: 'include'|credentials: 'same-origin'/, /\bstorage\b|localStorage|indexedDB|chrome\./, /https?:\/\//, /\bkeepalive\b|\breferrer\s*:/]) {
    assert.ok(!forbidden.test(source), String(forbidden));
  }
});
