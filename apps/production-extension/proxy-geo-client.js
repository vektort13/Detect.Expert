// ADR-109 (owner order, 2026-11-06): the ONLY network file of the Proxy Manager Geolocation API. One GET per call: no retry, no redirect,
// no cookie, no referrer, a hard deadline and a hard cap on the body. It builds no request and reads no answer itself (that is
// proxy-geo-providers.js). It never throws and returns only codes, numbers and the parsed record: never the URL, the headers, the key or
// the body text. Reviewed and hash-pinned by the repository lint: any change needs a fresh review.
import { GEO_ERRORS, GEO_LIMITS, GEO_PROVIDER_INFO } from './proxy-geo-shared.js';
import { geoBuildRequest, geoParseResponse } from './proxy-geo-providers.js';

const MAX_READS = 4096, MAX_HEADERS = 64, HEADER_CHARS = 512;
const BAD = Object.freeze({}); // thrown inside: the answer is unusable (too large, wrong type, empty)
const failure = (error, retryAfterMs = null, quota = null) => ({ ok: false, error: GEO_ERRORS.includes(error) ? error : 'bad-response', retryAfterMs, quota });
const amount = value => (Number.isFinite(value) && value >= 0 ? value : null);
const quotaOf = value => (value !== null && typeof value === 'object' ? { remaining: amount(value.remaining), pausedMs: amount(value.pausedMs) } : null);
// The request goes to a host of its own provider (the list the CSP names) and nowhere else.
const allowed = (providerId, built) => typeof providerId === 'string' && Object.hasOwn(GEO_PROVIDER_INFO, providerId) && GEO_PROVIDER_INFO[providerId].origins.includes(built.origin)
  && typeof built.url === 'string' && built.url.startsWith(built.origin + '/');

// The body as text, read as a stream and cut off at the cap. Whatever is not read to the end (refused, too large, failed) is cancelled.
async function readBody(response, refused) {
  const reader = response.body?.getReader?.();
  if (!reader) { if (refused) throw BAD; return ''; }
  const declared = response.headers.get('content-length'), bytes = new Uint8Array(GEO_LIMITS.responseBytes);
  let total = 0, reads = 0, complete = false;
  try {
    if (refused || (typeof declared === 'string' && /^\d+$/.test(declared.trim()) && Number(declared) > bytes.length)) throw BAD;
    while (!complete && reads++ < MAX_READS) {
      const { done, value } = await reader.read();
      if (done) complete = true;
      else if (!(value instanceof Uint8Array) || total + value.byteLength > bytes.length) throw BAD;
      else { bytes.set(value, total); total += value.byteLength; }
    }
    if (!complete) throw BAD;
  } finally {
    if (!complete) { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* best effort */ } }
    try { reader.releaseLock(); } catch { /* best effort */ }
  }
  return new TextDecoder().decode(bytes.subarray(0, total));
}

// Response headers as a plain object with lower-case names (bounded); the parser reads what it needs from it.
function collect(headers) {
  const entries = [];
  for (const [name, value] of headers) { if (entries.length >= MAX_HEADERS) break; entries.push([String(name).toLowerCase(), String(value).slice(0, HEADER_CHARS)]); }
  return Object.fromEntries(entries);
}

export function createGeoClient({
  fetchImpl = globalThis.fetch?.bind(globalThis), now = Date.now, providers = { geoBuildRequest, geoParseResponse },
  setTimeoutImpl = (callback, ms) => globalThis.setTimeout(callback, ms), clearTimeoutImpl = id => globalThis.clearTimeout(id),
} = {}) {
  // One exchange: the single request, then the parser. Throws BAD for an unusable answer; any other throw is a transport failure.
  async function exchange(providerId, ip, settings, built, signal) {
    const response = await fetchImpl(built.url, { method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', mode: 'cors', headers: built.headers, signal });
    const { status } = response, success = status >= 200 && status < 300, type = response.headers.get('content-type');
    const text = await readBody(response, !Number.isInteger(status) || status < 100 || status > 599 || (success && !(typeof type === 'string' && /json/i.test(type))));
    if (success && text === '') throw BAD;
    let parsed;
    try { parsed = providers.geoParseResponse(providerId, { status, headers: collect(response.headers), text }, { ip, now: now(), settings }); } catch { throw BAD; }
    if (parsed !== null && typeof parsed === 'object' && parsed.ok === true && parsed.record !== null && typeof parsed.record === 'object') return { ok: true, record: parsed.record, quota: quotaOf(parsed.quota) };
    return failure(parsed?.error, amount(parsed?.retryAfterMs), quotaOf(parsed?.quota));
  }

  async function request(input) {
    let timer, armed = false, expired = false;
    try {
      const { providerId, ip, credential, settings } = input ?? {};
      const built = providers.geoBuildRequest(providerId, ip, { credential, settings });
      if (built === null || typeof built !== 'object' || built.ok !== true) return failure(built?.error);
      if (!allowed(providerId, built)) return failure('bad-response');
      if (typeof fetchImpl !== 'function') return failure('network');
      const controller = new AbortController();
      let expire;
      const deadline = new Promise(resolve => { expire = resolve; });
      timer = setTimeoutImpl(() => { expired = true; controller.abort(); expire(failure('timeout')); }, GEO_LIMITS.requestMs);
      armed = true;
      const answer = exchange(providerId, ip, settings, built, controller.signal).catch(error => failure(error === BAD ? 'bad-response' : expired ? 'timeout' : 'network'));
      return await Promise.race([answer, deadline]);
    } catch {
      return failure('bad-response');
    } finally {
      if (armed) { try { clearTimeoutImpl(timer); } catch { /* best effort */ } }
    }
  }

  return Object.freeze({ request });
}
