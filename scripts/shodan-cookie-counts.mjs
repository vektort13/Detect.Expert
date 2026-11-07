// REQ-001/005/010/011: optional public aggregate research, never extension runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { PROJECT_ROOT, containedExistingPath, loadCredential, parseCredential, sanitizedErrorCode } from './shodan-antifraud-counts.mjs';

const LIMIT = 65_536;
const NAMES = Object.freeze(['__cf_bm', 'cf_clearance', '__cflb', '_cfuvid', 'datadome', 'dd_testcookie', '_pxvid', '_pxhd', '_pxmd', '_abck', 'bm_sz', 'ak_bmsc', 'aws-waf-token', '__stripe_mid', '__stripe_sid', '_GRECAPTCHA', 'AWSELB', 'AWSELBCORS', 'AWSALB', 'AWSALBCORS', 'OptanonConsent', 'OptanonAlertBoxClosed', 'CookieConsent', 'cookieyes-consent', 'didomi_token', 'euconsent-v2', '_ga', '_gid', '__gads', '__gpi', '_clck', '_clsk', 'hubspotutk', '__hstc', '_fbp', '_fbc', '_cs_id', '_cs_s', '__hsmem', '_mkto_trk']);
const ERROR_CODES = new Set(['invalid-options', 'invalid-catalog', 'invalid-response', 'response-too-large', 'request-timeout', 'network-error', 'redirect-rejected', 'http-error', 'credential-invalid', 'credential-too-large', 'credential-missing']);
function fail(code) { throw new Error(code); }
function safeError(error) { return error instanceof Error && ERROR_CODES.has(error.message) ? error.message : sanitizedErrorCode(error); }
function sourceUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && /^[A-Za-z0-9.-]+$/.test(url.hostname) ? url.href : null; } catch { return null; }
}

export function buildCookieCountPlan(catalog) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.entries) || catalog.entries.length > 8192) fail('invalid-catalog');
  const entries = [];
  for (const name of NAMES) {
    const rows = catalog.entries.filter(row => row?.name === name && row.match === 'exact' && typeof row.owner === 'string' && row.owner.length <= 128);
    const sourceUrls = [...new Set(rows.flatMap(row => Array.isArray(row.sourceUrls) ? row.sourceUrls.map(sourceUrl).filter(Boolean) : []))].sort().slice(0, 8);
    if (!rows.length || !sourceUrls.length) continue;
    entries.push({ name, query: '"set-cookie" "' + name + '"', documentedOwners: [...new Set(rows.map(row => row.owner))].sort().slice(0, 8), sourceUrls, status: 'not-run', total: null });
  }
  return { schemaVersion: 1, researchOnly: true, mode: 'plan', status: 'not-run',
    source: { provider: 'Shodan', operation: 'public-term-count', documentationUrl: 'https://developer.shodan.io/api', endpoint: '/shodan/host/count' },
    interpretation: 'Counts indexed records matching two quoted text terms. These are not validated Set-Cookie occurrences, cookie-purpose evidence, owner attribution, unique site counts or real-time browser observations.',
    maximumRequests: 40, minimumRequestIntervalMs: 1000, requestTimeoutMs: 10000, maximumResponseBytes: LIMIT,
    requestCount: entries.length, entries };
}

function cancelBody(response) { try { void response.body?.cancel().catch(() => {}); } catch {} }
async function responseTotal(response) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > LIMIT)) fail('response-too-large');
  if (!response.body?.getReader) fail('invalid-response');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0, count = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) fail('invalid-response');
      if (++count > 4096 || (size += value.byteLength) > LIMIT) fail('response-too-large');
      if (value.byteLength) chunks.push(value);
    }
    let data;
    try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); } catch { fail('invalid-response'); }
    if (!data || Array.isArray(data) || !Number.isSafeInteger(data.total) || data.total < 0) fail('invalid-response');
    return data.total;
  } finally { try { await reader.cancel(); } catch {} reader.releaseLock(); }
}

async function countCookie(entry, credential, fetchImpl) {
  const controller = new AbortController();
  let timer, received;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('request-timeout')); }, 10_000); });
  try {
    return await Promise.race([deadline, (async () => {
      const url = new URL('https://api.shodan.io/shodan/host/count');
      url.searchParams.set('key', credential);
      url.searchParams.set('query', entry.query);
      const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', credentials: 'omit', signal: controller.signal, headers: { Accept: 'application/json' } });
      received = response;
      if (response.redirected || response.status >= 300 && response.status < 400) fail('redirect-rejected');
      if (response.url) { const actual = new URL(response.url); if (actual.origin !== url.origin || actual.pathname !== url.pathname) fail('redirect-rejected'); }
      if (response.status !== 200) return { status: 'http-error', total: null, httpStatus: Number.isInteger(response.status) ? response.status : 0 };
      return { status: 'ok', total: await responseTotal(response) };
    })()]);
  } catch (error) { return { status: safeError(error), total: null }; }
  finally { clearTimeout(timer); controller.abort(); if (received) cancelBody(received); }
}

export async function runCookieCounts({ catalog, credential, fetchImpl = globalThis.fetch, now = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const plan = buildCookieCountPlan(catalog);
  const key = parseCredential(credential);
  const entries = [];
  let lastStarted, stopped = false;
  for (const planned of plan.entries) {
    if (stopped) { entries.push({ ...planned, status: 'not-run-auth-stop', total: null }); continue; }
    if (lastStarted !== undefined) {
      let wait = 1000 - (now() - lastStarted);
      while (wait > 0) { await sleep(wait); wait = 1000 - (now() - lastStarted); }
    }
    lastStarted = now();
    const result = await countCookie(planned, key, fetchImpl);
    entries.push({ ...planned, ...result });
    stopped = result.httpStatus === 401 || result.httpStatus === 403;
  }
  return { ...plan, mode: 'run', status: stopped ? 'authentication-stopped' : entries.every(row => row.status === 'ok') ? 'complete' : 'partial', generatedAt: new Date().toISOString(), entries };
}

export function parseCookieCountOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--plan' || argument === '--run') { if (options.mode) fail('invalid-options'); options.mode = argument.slice(2); }
    else if (argument === '--stdin-key') { if (options.stdinKey || options.keyFile) fail('invalid-options'); options.stdinKey = true; }
    else if (argument === '--key-file') { const value = argv[++index]; if (!value || value.startsWith('--') || options.keyFile || options.stdinKey) fail('invalid-options'); options.keyFile = value; }
    else fail('invalid-options');
  }
  if (!options.mode) fail('invalid-options');
  return options;
}

export async function readStdinCredential(stream) {
  const chunks = [];
  let size = 0, chunkCount = 0;
  for await (const chunk of stream) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); if (++chunkCount > 4096 || (size += buffer.length) > LIMIT) fail('credential-too-large'); if (buffer.length) chunks.push(buffer); }
  return parseCredential(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
}

export async function mainCookieCounts({ argv = process.argv.slice(2), projectRoot = PROJECT_ROOT, env = process.env, stdin = process.stdin, fetchImpl = globalThis.fetch, output = text => console.log(text) } = {}) {
  const options = parseCookieCountOptions(argv);
  const filename = await containedExistingPath(projectRoot, 'packages/catalog/data/cookies.overrides.json');
  const handle = await fs.open(filename, 'r');
  let bytes;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 2 * 1024 * 1024) fail('invalid-catalog');
    const buffer = Buffer.alloc(2 * 1024 * 1024 + 1);
    let size = 0;
    for (;;) { const chunk = await handle.read(buffer, size, buffer.length - size, size); size += chunk.bytesRead; if (size > 2 * 1024 * 1024) fail('invalid-catalog'); if (!chunk.bytesRead) break; }
    bytes = buffer.subarray(0, size);
  } finally { await handle.close(); }
  let catalog;
  try { catalog = JSON.parse(bytes.toString('utf8')); } catch { fail('invalid-catalog'); }
  const plan = buildCookieCountPlan(catalog);
  const result = options.mode === 'plan' ? plan : await runCookieCounts({ catalog, credential: options.stdinKey ? await readStdinCredential(stdin) : await loadCredential({ projectRoot, keyFile: options.keyFile, env }), fetchImpl });
  output(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mainCookieCounts().catch(error => { console.error('Shodan cookie count: ' + safeError(error)); process.exitCode = 1; });
}
