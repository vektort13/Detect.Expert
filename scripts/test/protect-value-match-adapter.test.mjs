// ADR-020 §15.4/8, REQ-005/011; audit F2/F3. Only synthetic canaries, no browser/user values.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { loadValueMatchAdapter, matcherFixture, request, SYNTHETIC_EMAIL } from './protect-value-match-adapter-support.mjs';

const module = await loadValueMatchAdapter();
const max = module.PROTECT_BUDGETS.maxScannedBodyBytes;
const bodyViews = result => result.views.filter(view => view.location.startsWith('body-'));
const bodyText = result => bodyViews(result).map(view => view.text).join(' ');

test('F2: valid oversized JSON is refused before plaintext tokenization and token-ring admission', () => {
  const text = JSON.stringify({ password: SYNTHETIC_EMAIL, notes: ' '.repeat(max + 100) });
  assert.doesNotThrow(() => JSON.parse(text));
  const result = module.requestViews(request(text));
  assert.equal(result.bodyBytes, max);
  assert.equal(result.bodyChars, max);
  assert.equal(result.ringSafe, false);
  assert.equal(result.credentialDropped, false, 'unknown structure must not claim detected credential fields');
  assert.equal(result.opaque, true);
  assert.deepEqual(bodyViews(result), []);
  assert.ok(result.limitations.has('body-truncated'));
  assert.ok(result.limitations.has('body-opaque'));
  const fixture = matcherFixture(module, { index: true });
  module.hashAudit.needle = SYNTHETIC_EMAIL;
  module.hashAudit.hits = 0;
  fixture.send(text);
  assert.equal(module.hashAudit.hits, 0, 'no keyed fingerprint was computed from the credential');
  assert.equal(fixture.stats.directMatches, 0);
  assert.equal(fixture.stats.ringPushed, 0);
  assert.equal(fixture.ring.tokens(), 0);
  assert.equal(fixture.matcher.bodiesDropped(7), 1);
});

test('F2: malformed object/array JSON fails closed with whitespace, credentials and valid-looking prefixes', () => {
  for (const text of [
    '{"password":"' + SYNTHETIC_EMAIL,
    ' \n\t[{"password":"' + SYNTHETIC_EMAIL + '"}',
    '{"email":"' + SYNTHETIC_EMAIL + '",}',
    '{"email":"' + SYNTHETIC_EMAIL + '"} garbage',
  ]) {
    const result = module.requestViews(request(text));
    assert.deepEqual(bodyViews(result), []);
    assert.equal(result.ringSafe, false);
    assert.equal(result.opaque, true);
    assert.ok(result.limitations.has('body-opaque'));
    const fixture = matcherFixture(module, { index: true });
    module.hashAudit.hits = 0;
    fixture.send(text);
    assert.equal(module.hashAudit.hits, 0);
    assert.equal(fixture.stats.directMatches, 0);
    assert.equal(fixture.ring.size, 0);
  }
});

test('F2: even a parseable JSON prefix followed by unobserved bytes is not treated as the complete body', () => {
  const text = '{"email":"' + SYNTHETIC_EMAIL + '"}' + ' '.repeat(max);
  const result = module.requestViews(request(text));
  assert.deepEqual(bodyViews(result), []);
  assert.equal(result.ringSafe, false);
});

test('F2: malformed Base64 JSON containers do not produce plaintext or enter the ring', () => {
  const text = '{"password":"' + SYNTHETIC_EMAIL;
  const encoded = Buffer.from(text).toString('base64');
  const parent = { location: 'query', paramName: 'payload', pathSegment: null, text: encoded, urlDecoded: false, container: false };
  const result = module.containerViews(text, parent);
  assert.deepEqual(result.views, []);
  assert.equal(result.ringSafe, false);
  const fixture = matcherFixture(module);
  fixture.send('payload=' + encoded);
  assert.equal(fixture.ring.size, 0);
  assert.equal(module.decodeContainer(encoded, 8), null, 'containers are never decoded from partial Base64');
});

test('F2 positives: valid structured JSON prunes credential subtrees and still matches ordinary values', () => {
  const result = module.requestViews(request(JSON.stringify({ password: SYNTHETIC_EMAIL, nested: { email: 'public@example.com' } })));
  assert.equal(result.credentialDropped, true);
  assert.equal(result.ringSafe, true);
  assert.equal(bodyText(result), 'public@example.com');
  const secretFixture = matcherFixture(module, { index: true });
  secretFixture.send(JSON.stringify({ password: SYNTHETIC_EMAIL }));
  assert.equal(secretFixture.stats.directMatches, 0);
  assert.equal(secretFixture.ring.size, 0);
  const ordinaryFixture = matcherFixture(module, { index: true });
  ordinaryFixture.send(JSON.stringify({ email: SYNTHETIC_EMAIL }));
  assert.equal(ordinaryFixture.stats.directMatches, 1);
  assert.equal(ordinaryFixture.ring.size, 1);
});

test('F3: a 4MiB form value consumes at most the shared 64KiB UTF-8 budget including its key', () => {
  const result = module.requestViews(request({ formData: { note: ['a'.repeat(4 * 1024 * 1024)] } }));
  assert.equal(result.bodyBytes, max);
  assert.equal(result.bodyChars, max);
  assert.equal(bodyViews(result)[0].text.length, max - 'note'.length);
  assert.equal(result.ringSafe, false);
  assert.ok(result.limitations.has('body-truncated'));
  const fixture = matcherFixture(module);
  fixture.send({ formData: { note: ['a'.repeat(4 * 1024 * 1024)] } });
  assert.equal(fixture.ring.size, 0);
  assert.equal(fixture.matcher.bodiesDropped(7), 1);
});

test('F3: one budget spans multiple keys/values, with faithful code-unit and UTF-8 byte accounting', () => {
  const values = { first: ['é😀', 'x'], second: ['z'.repeat(max)] };
  const result = module.requestViews(request({ formData: values }));
  assert.equal(result.bodyBytes, max);
  const inspected = 'first' + 'é😀' + 'x' + 'second' + bodyViews(result)[2].text;
  assert.equal(Buffer.byteLength(inspected), max);
  assert.equal(result.bodyChars, inspected.length);
  assert.ok(result.bodyChars < result.bodyBytes);
  assert.equal(result.ringSafe, false);
});

test('F3: UTF-8 cuts never split pairs or exceed bytes, including lone surrogate replacement width', () => {
  for (const [value, firstBytes, firstChars] of [['é', 2, 1], ['😀', 4, 2], ['\ud800', 3, 1], ['\udc00', 3, 1]]) {
    for (const remaining of [0, 1, 2, 3, 4, 5]) {
      const prefix = 'a'.repeat(max - 2 - remaining);
      const result = module.requestViews(request({ formData: { a: [prefix], b: [value.repeat(8)] } }));
      const tail = bodyViews(result)[1]?.text ?? '';
      assert.equal(Buffer.byteLength(tail), Math.floor(remaining / firstBytes) * firstBytes);
      assert.equal(tail.length, Math.floor(remaining / firstBytes) * firstChars);
      assert.ok(result.bodyBytes <= max);
      assert.equal(result.bodyBytes, Buffer.byteLength('a' + prefix + 'b' + tail));
    }
  }
});

test('F3: oversized keys are bounded before classification, and values behind those keys are never read', () => {
  const data = Object.create(null);
  let reads = 0;
  Object.defineProperty(data, 'a'.repeat(4 * 1024 * 1024), { enumerable: true, get() { reads++; throw new Error('must not read'); } });
  const result = module.requestViews(request({ formData: data }));
  assert.equal(reads, 0);
  assert.equal(result.bodyBytes, max);
  assert.equal(result.bodyChars, max);
  assert.equal(result.ringSafe, false);
  assert.deepEqual(bodyViews(result), []);
  assert.ok(result.limitations.has('body-truncated'));
});

test('F3: character inspection stays bounded when the supplied form value grows from 4 to 16 MiB', () => {
  const original = String.prototype.charCodeAt;
  const counts = [];
  for (const length of [4 * 1024 * 1024, 16 * 1024 * 1024]) {
    const value = 'x'.repeat(length);
    let calls = 0;
    String.prototype.charCodeAt = function (index) { calls++; return Reflect.apply(original, this, [index]); };
    try {
      module.requestViews(request({ formData: { note: [value] } }));
    } finally {
      String.prototype.charCodeAt = original;
    }
    counts.push(calls);
  }
  assert.equal(counts[0], counts[1]);
  assert.ok(counts[0] <= max + 128);
});

test('F3 privacy: credential form values and their lengths are never accessed, ordinary values still work', () => {
  const data = { email: ['public@example.com'] };
  Object.defineProperty(data, 'password', { enumerable: true, get() { throw new Error('credential value accessed'); } });
  const result = module.requestViews(request({ formData: data }));
  assert.equal(result.credentialDropped, true);
  assert.equal(bodyText(result), 'public@example.com');
  assert.equal(result.bodyBytes, Buffer.byteLength('emailpublic@example.compassword'));
  assert.equal(result.bodyChars, 'emailpublic@example.compassword'.length);
});

test('F3: empty arrays, credential-only keys and value counts obey bounded enumeration', () => {
  const limit = module.PROTECT_BUDGETS.maxFormDataEntries;
  for (const data of [
    Object.fromEntries(Array.from({ length: limit + 1 }, (_, i) => ['k' + i, []])),
    Object.fromEntries(Array.from({ length: limit + 1 }, (_, i) => ['password' + i, ['never inspected']])),
    { list: Array.from({ length: limit + 1 }, () => '') },
  ]) {
    const result = module.requestViews(request({ formData: data }));
    assert.ok(result.limitations.has('body-truncated'));
    assert.equal(result.ringSafe, false);
    assert.ok(result.bodyBytes <= max);
  }
});

test('F3 positives: exact byte budget is accepted, key-only fields count, inherited keys are ignored', () => {
  const exact = module.requestViews(request({ formData: { note: ['a'.repeat(max - 4)] } }));
  assert.equal(exact.bodyBytes, max);
  assert.equal(exact.ringSafe, true);
  assert.equal(exact.limitations.has('body-truncated'), false);
  const data = Object.assign(Object.create({ password: ['not ours'] }), { empty: [], email: ['é😀'] });
  const result = module.requestViews(request({ formData: data }));
  assert.equal(result.bodyBytes, Buffer.byteLength('emptyemailé😀'));
  assert.equal(result.bodyChars, 'emptyemailé😀'.length);
  assert.equal(result.credentialDropped, false);
});

test('token budget truncation also excludes the partial request from the reverse-match ring', () => {
  const fixture = matcherFixture(module);
  // Exactly 64 KiB of one-character tokens, plus the URL path token; raw truncation does not cause this case.
  fixture.send('x '.repeat(module.PROTECT_BUDGETS.maxTokensPerRequest));
  assert.equal(fixture.stats.tokenBudget, 1);
  assert.equal(fixture.matcher.bodiesDropped(7), 1);
  assert.equal(fixture.stats.ringPushed, 0);
  assert.equal(fixture.ring.size, 0);
});

test('unrelated decode semantics remain: URL/form/plain text, split UTF-8 buffers, files and compression', () => {
  const decoded = module.requestViews(request('email=public%40example.com&password=discard', { url: 'https://receiver.example.org/a%40b.com?email=public%40example.com' }));
  assert.ok(decoded.views.some(view => view.location === 'query' && view.text === 'public@example.com'));
  assert.equal(bodyText(decoded).includes('discard'), false);
  assert.ok(bodyText(decoded).includes('public@example.com'));
  assert.equal(bodyText(module.requestViews(request('ordinary public@example.com text'))), 'ordinary public@example.com text');
  const bytes = new TextEncoder().encode('é😀');
  const split = module.requestViews(request({ raw: [{ bytes: bytes.slice(0, 3).buffer }, { bytes: bytes.slice(3).buffer }] }));
  assert.equal(bodyText(split), 'é😀');
  assert.equal(split.bodyBytes, 6);
  assert.equal(split.bodyChars, 3);
  const file = module.requestViews(request({ raw: [{ file: 'C:/synthetic-file' }] }));
  assert.equal(file.opaque, true);
  assert.equal(file.bodyBytes, 0);
  const gzip = module.requestViews(request({ raw: [{ bytes: Uint8Array.from(gzipSync('synthetic')).buffer }] }));
  assert.equal(gzip.opaque, true);
  const skip = module.requestViews(request({ formData: { email: ['not inspected'] } }), { decodeBody: false });
  assert.equal(skip.bodyBytes, 0);
  assert.deepEqual(bodyViews(skip), []);
});
