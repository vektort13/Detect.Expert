// ADR-020 §B (S07): request views for value matching (SW callback only). formData, JSON, urlencoded text, Base64
// containers, gzip → opaque, file parts → opaque (never read), > 64 KiB → body-truncated with only a view of the
// first 64 KiB decoded, credential-named keys dropped before tokenization; the tokenizer keeps `@ . + - _ %` inside
// tokens and extracts hex / Base64 runs.

import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { RequestDetailsLike } from '../../src/chrome-api';
import { containerViews, decodeContainer, isCredentialKey, requestViews, scanTokens } from '../../src/protect/value-match/decode';

function details(over: Partial<RequestDetailsLike> = {}): RequestDetailsLike {
  return { tabId: 7, frameId: 0, url: 'https://collect.example.net/c', type: 'xmlhttprequest', timeStamp: 1, method: 'POST', requestId: 'r1', ...over };
}

function raw(text: string | Uint8Array): RequestDetailsLike['requestBody'] {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return { raw: [{ bytes: buf }] };
}

function tokens(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  scanTokens(text, (s, e, lowerHex, kind) => {
    out.push([kind, lowerHex ? text.slice(s, e).toLowerCase() : text.slice(s, e)]);
    return true;
  });
  return out;
}

describe('URL views', () => {
  it('path segments and query parameters, raw and percent-decoded; credential keys dropped', () => {
    const d = requestViews(details({ url: 'https://x.example.net/u/user%40example.com/p?ud%5Bem%5D=abc&email=a%2Bb%40c.d&password=secret1&q=+hi+' }));
    const v = d.views.map((x) => [x.location, x.paramName, x.pathSegment, x.text, x.urlDecoded]);
    expect(v).toContainEqual(['path', null, 1, 'user%40example.com', false]);
    expect(v).toContainEqual(['path', null, 1, 'user@example.com', true]);
    expect(v).toContainEqual(['query', 'ud[em]', null, 'abc', false]);
    expect(v).toContainEqual(['query', 'email', null, 'a+b@c.d', true]);
    expect(v).toContainEqual(['query', 'q', null, ' hi ', true]);
    expect(JSON.stringify(d.views)).not.toContain('secret1');
    expect(d.credentialDropped).toBe(true);
  });
});

describe('body views', () => {
  it('review PT-2 / PT-3: credential keys by component — common password names dropped, ordinary keys with a stem inside kept', () => {
    const credentials = ['password', 'newPassword', 'user_pwd', 'pw', 'psw', 'pswd', 'parol', 'kennwort', 'senha', 'contrasena', 'contraseña', 'mdp', 'haslo', 'hasło', 'wachtwoord', 'пароль', 'passwd', 'pass', 'cvv2', 'cc_num', 'cardNumber', 'card-number', 'cardholder', 'pan', 'iban', 'otp', 'otp_code', 'PIN1', 'access_token', 'client_secret', 'creditcard'];
    const ordinary = ['shipping_email', 'shipping_address[phone]', 'company_email', 'spanId', 'expand', 'opinion', 'footprint', 'discard', 'email', 'phone', 'first_name', 'passenger_name', 'otpravka', 'japan', 'pinterest', 'span', 'company'];
    expect(credentials.filter((k) => !isCredentialKey(k))).toEqual([]);
    expect(ordinary.filter((k) => isCredentialKey(k))).toEqual([]);
    // In a body: a pw field is dropped (never tokenized); shipping_email is decoded as usual.
    const d = requestViews(details({ requestBody: raw(JSON.stringify({ login: 'u', pw: 'Hunter2Secret', shipping_email: 'buyer@mail-example.com' })) }));
    expect(d.credentialDropped).toBe(true);
    const texts = d.views.map((v) => v.text).join(' ');
    expect(texts).not.toContain('Hunter2Secret');
    expect(texts).toContain('buyer@mail-example.com');
    const clean = requestViews(details({ requestBody: raw(JSON.stringify({ shipping_address: { phone: '+7 912 555-01-37' }, company: 'X' })) }));
    expect(clean.credentialDropped).toBe(false);
  });

  it('formData (≤ maxFormDataEntries) with credential keys dropped', () => {
    const d = requestViews(details({ requestBody: { formData: { email: ['u@example.com'], pass_word: ['hunter2'], list: ['news'] } } }));
    expect(d.views.filter((v) => v.location === 'body-form').map((v) => [v.paramName, v.text])).toEqual([['email', 'u@example.com'], ['list', 'news']]);
    expect(d.credentialDropped).toBe(true);
    expect(JSON.stringify(d)).not.toContain('hunter2');
  });

  it('JSON: leaves with the last two keys as the name; credential subtrees pruned; numbers kept', () => {
    const d = requestViews(details({ requestBody: raw(JSON.stringify({ draft: { email: 'u@example.com', phone: 79991234567 }, auth: { token: 'tkn-1' }, list: [{ name: 'Анна' }] })) }));
    const v = d.views.map((x) => [x.location, x.paramName, x.text]);
    expect(v).toContainEqual(['body-json', 'draft.email', 'u@example.com']);
    expect(v).toContainEqual(['body-json', 'draft.phone', '79991234567']);
    expect(v).toContainEqual(['body-json', 'list.name', 'Анна']);
    expect(JSON.stringify(v)).not.toContain('tkn-1');
    expect(d.credentialDropped).toBe(true);
  });

  it('urlencoded text and plain text', () => {
    expect(requestViews(details({ requestBody: raw('email=u%40example.com&src=w') })).views.map((v) => [v.location, v.paramName, v.text])).toContainEqual(['body-form', 'email', 'u@example.com']);
    expect(requestViews(details({ requestBody: raw('hello u@example.com world') })).views.map((v) => [v.location, v.text])).toContainEqual(['body-text', 'hello u@example.com world']);
  });

  it('gzip → opaque (body-opaque); a file part → opaque without reading it; Blob error → body-unavailable; PATCH', () => {
    const gz = requestViews(details({ requestBody: raw(new Uint8Array(gzipSync(Buffer.from(JSON.stringify({ email: 'u@example.com' }))))) }));
    expect(gz.opaque).toBe(true);
    expect([...gz.limitations]).toContain('body-opaque');
    const file = requestViews(details({ requestBody: { raw: [{ file: 'C:/secret/path.txt' }] } }));
    expect(file.opaque).toBe(true);
    expect(JSON.stringify(file)).not.toContain('secret');
    const blob = requestViews(details({ requestBody: { error: 'Unknown error.' } }));
    expect(blob.opaque).toBe(true);
    expect([...blob.limitations]).toEqual(['body-unavailable']);
    expect([...requestViews(details({ method: 'PATCH' })).limitations]).toEqual(['body-unavailable']);
    expect(requestViews(details({ method: 'GET' })).limitations.size).toBe(0);
  });

  it('> maxScannedBodyBytes: body-truncated, only the first 64 KiB decoded (a view, the rest never copied)', () => {
    const head = 'email=u%40example.com&blob=';
    const body = head + 'x'.repeat(PROTECT_BUDGETS.maxScannedBodyBytes * 4);
    const d = requestViews(details({ requestBody: raw(body) }));
    expect([...d.limitations]).toContain('body-truncated');
    expect(d.bodyChars).toBe(PROTECT_BUDGETS.maxScannedBodyBytes);
    expect(d.views.map((v) => [v.paramName, v.text])).toContainEqual(['email', 'u@example.com']);
  });
});

describe('tokens and containers', () => {
  it('keeps @ . + - _ % inside tokens; hex runs lowered; Base64 runs with padding', () => {
    const hex = 'B4C9A289323B21A01C3E940F150EB9B8C542587F1ABFD8F0E1CC1FFC5E475514';
    const b64 = 'dXNlckBleGFtcGxlLmNvbQ==';
    const t = tokens('{"e":"u@example.com","h":"' + hex + '","b":"' + b64 + '","p":"+7 999"}');
    expect(t).toContainEqual(['word', 'u@example.com']);
    expect(t).toContainEqual(['word', hex.toLowerCase()]);
    expect(t).toContainEqual(['b64', b64]);
    expect(t).toContainEqual(['word', '+7']);
    expect(t).toContainEqual(['word', '999']);
    expect(tokens('sha256:' + hex.toLowerCase()).map((x) => x[1])).toContain(hex.toLowerCase());
    expect(tokens('x' + hex.toLowerCase() + '.y')).toContainEqual(['hex', hex.toLowerCase()]);
  });

  it('decodes a Base64 container one level; credential keys inside are dropped; binary is refused', () => {
    const inner = Buffer.from(JSON.stringify({ email: 'u@example.com', password: 'p4ss' })).toString('base64');
    const text = decodeContainer(inner, 65536);
    expect(text).not.toBeNull();
    const sink = containerViews(text!, { location: 'query', paramName: 'd', pathSegment: null, text: inner, urlDecoded: false, container: false });
    expect(sink.credentialDropped).toBe(true);
    expect(sink.views.map((v) => [v.location, v.paramName, v.text, v.container])).toEqual([['query', 'd', 'u@example.com', true]]);
    expect(decodeContainer(Buffer.from(gzipSync(Buffer.from('x'.repeat(100)))).toString('base64'), 65536)).toBeNull();
  });
});
