// REQ-001/005/008/010/011, ADR-009: optional research tool, never extension runtime.
import { open, realpath, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONFIG_PATH = 'packages/catalog/data/shodan-aggregate.config.json';
const BYTE_LIMIT = 64 * 1024;
const CATALOG_BYTE_LIMIT = 8 * 1024 * 1024;
const ERROR_CODES = new Set([
  'invalid-options', 'invalid-config', 'invalid-catalog', 'catalog-read-failed',
  'path-outside-project', 'credential-read-failed', 'credential-too-large',
  'credential-invalid', 'credential-missing', 'output-write-failed',
  'request-timeout', 'network-error', 'redirect-rejected', 'http-error',
  'invalid-response', 'response-too-large',
]);

class AggregateError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function fail(code) { throw new AggregateError(code); }
export function sanitizedErrorCode(error, fallback = 'network-error') {
  return error instanceof AggregateError && ERROR_CODES.has(error.code) ? error.code : fallback;
}
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

export async function containedExistingPath(projectRoot, value) {
  const root = path.resolve(projectRoot);
  if (typeof value !== 'string' || !value || !inside(root, path.resolve(root, value))) fail('path-outside-project');
  try {
    const [resolvedRoot, resolved] = await Promise.all([realpath(root), realpath(path.resolve(root, value))]);
    if (!inside(resolvedRoot, resolved)) fail('path-outside-project');
    return resolved;
  } catch (error) {
    if (error instanceof AggregateError) throw error;
    fail('credential-read-failed');
  }
}

async function boundedFile(filename, maximumBytes, code) {
  let handle;
  try {
    handle = await open(filename, 'r');
    const info = await handle.stat();
    if (!info.isFile()) fail(code);
    if (info.size > maximumBytes) fail(code === 'credential-read-failed' ? 'credential-too-large' : code);
    const buffer = Buffer.alloc(maximumBytes + 1);
    let size = 0;
    while (size <= maximumBytes) {
      const result = await handle.read(buffer, size, buffer.length - size, size);
      if (result.bytesRead === 0) break;
      size += result.bytesRead;
    }
    if (size > maximumBytes) fail(code === 'credential-read-failed' ? 'credential-too-large' : code);
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
  } catch (error) {
    if (error instanceof AggregateError) throw error;
    fail(code);
  } finally { if (handle) await handle.close().catch(() => {}); }
}

function validCredential(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value.trim())) fail('credential-invalid');
  return value.trim();
}
export function parseCredential(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > BYTE_LIMIT) fail('credential-too-large');
  const clean = text.replace(/^\uFEFF/, '').trim();
  if (clean.startsWith('{')) {
    let data;
    try { data = JSON.parse(clean); } catch { fail('credential-invalid'); }
    const values = [data?.SHODAN_API_KEY, data?.shodan?.apiKey].filter(value => value !== undefined);
    if (!values.length || values.some(value => value !== values[0])) fail('credential-invalid');
    return validCredential(values[0]);
  }
  const values = [];
  for (const line of clean.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?(?:SHODAN_API_KEY|SHODAN_KEY)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[1];
    if (/^["']/.test(value)) {
      const quoted = /^(["'])([^"']*)\1\s*(?:#.*)?$/.exec(value);
      if (!quoted) fail('credential-invalid');
      value = quoted[2];
    } else value = value.replace(/\s+#.*$/, '').trim();
    values.push(value);
  }
  if (values.length) {
    if (values.some(value => value !== values[0])) fail('credential-invalid');
    return validCredential(values[0]);
  }
  return validCredential(clean);
}
export async function loadCredential({ projectRoot = PROJECT_ROOT, keyFile, env = process.env } = {}) {
  if (keyFile !== undefined) {
    const filename = await containedExistingPath(projectRoot, keyFile);
    return parseCredential(await boundedFile(filename, BYTE_LIMIT, 'credential-read-failed'));
  }
  if (!env.SHODAN_API_KEY) fail('credential-missing');
  return validCredential(env.SHODAN_API_KEY);
}

export function validateAggregateConfig(config) {
  let api, documentation;
  try { api = new URL(config?.apiBaseUrl); documentation = new URL(config?.documentationUrl); }
  catch { fail('invalid-config'); }
  if (!config || config.schemaVersion !== 1 || config.researchOnly !== true ||
      api.protocol !== 'https:' || api.hostname !== 'api.shodan.io' || api.port || api.pathname !== '/' ||
      api.username || api.password || api.search || api.hash || config.countPath !== '/shodan/host/count' ||
      documentation.protocol !== 'https:' || documentation.hostname !== 'developer.shodan.io' ||
      documentation.port || documentation.pathname !== '/api' || documentation.username ||
      documentation.password || documentation.search || documentation.hash ||
      config.catalogPath !== 'packages/catalog/data/antifraud.v1.json' ||
      config.outputDirectory !== 'packages/catalog/research/antifraud-2026-10/shodan' ||
      config.maximumSelectedHosts !== 100 || config.defaultRequestLimit !== 100 ||
      config.maximumRequestLimit !== 200 || config.minimumRequestIntervalMs !== 1000 ||
      config.requestTimeoutMs !== 10000 || config.maximumCredentialBytes !== BYTE_LIMIT ||
      config.maximumResponseBytes !== BYTE_LIMIT || config.maximumResponseChunks !== 4096) fail('invalid-config');
  return config;
}
export async function loadAggregateConfig(projectRoot = PROJECT_ROOT) {
  try {
    const filename = await containedExistingPath(projectRoot, CONFIG_PATH);
    return validateAggregateConfig(JSON.parse(await boundedFile(filename, BYTE_LIMIT, 'invalid-config')));
  } catch { fail('invalid-config'); }
}
function exactHost(host) {
  if (typeof host !== 'string' || host.length > 253 || host !== host.toLowerCase() || isIP(host)) return false;
  const labels = host.split('.');
  return labels.length >= 2 && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
function publicSourceUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !exactHost(url.hostname)) return undefined;
    url.search = ''; url.hash = '';
    return url.href;
  } catch { return undefined; }
}
function minimallyValidCatalog(catalog) {
  return catalog?.schemaVersion === 1 && catalog.researchOnly === true &&
    catalog.productionEnabled === false && catalog.fixtureVerified === false &&
    typeof catalog.catalogVersion === 'string' && Array.isArray(catalog.vendors) &&
    catalog.vendors.length <= 1000;
}
export async function loadCatalog(projectRoot = PROJECT_ROOT, validator) {
  try {
    const filename = await containedExistingPath(projectRoot, 'packages/catalog/data/antifraud.v1.json');
    const catalog = JSON.parse(await boundedFile(filename, CATALOG_BYTE_LIMIT, 'catalog-read-failed'));
    const validate = validator ?? (await import('./antifraud-catalog.mjs')).validateResearchCatalog;
    if (!minimallyValidCatalog(catalog) || typeof validate !== 'function' || validate(catalog).length) fail('invalid-catalog');
    return catalog;
  } catch (error) {
    if (error instanceof AggregateError && error.code === 'invalid-catalog') throw error;
    fail('catalog-read-failed');
  }
}

export function buildAggregatePlan(catalog, config, { maxRequests = config.defaultRequestLimit } = {}) {
  validateAggregateConfig(config);
  if (!minimallyValidCatalog(catalog)) fail('invalid-catalog');
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > config.maximumRequestLimit) fail('invalid-options');
  const hosts = new Map();
  const add = (host, vendorId, source) => {
    if (!exactHost(host)) return;
    const record = hosts.get(host) ?? { host, vendorIds: [], sources: [], status: 'not-run', count: null };
    if (!record.vendorIds.includes(vendorId)) record.vendorIds.push(vendorId);
    if (!record.sources.some(item => JSON.stringify(item) === JSON.stringify(source))) record.sources.push(source);
    hosts.set(host, record);
  };
  for (const vendor of catalog.vendors) {
    if (!vendor || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(vendor.id) ||
        !Array.isArray(vendor.sources) || !Array.isArray(vendor.browserSignals)) fail('invalid-catalog');
    const official = publicSourceUrl(vendor.officialWebsite);
    if (official) add(new URL(official).hostname, vendor.id, { kind: 'official-website', sourceUrls: [official] });
    const documented = new Set(vendor.sources.map(source => source.url));
    for (const signal of vendor.browserSignals) {
      if (!signal || signal.status !== 'documented-candidate' || signal.productionEnabled !== false ||
          signal.fixtureVerified !== false || signal.hostTemplate !== undefined ||
          typeof signal.kind !== 'string' || signal.kind.includes('template') ||
          !exactHost(signal.host) ||
          !Array.isArray(signal.sourceUrls) || !signal.sourceUrls.length ||
          signal.sourceUrls.some(url => !documented.has(url))) continue;
      const sourceUrls = signal.sourceUrls.map(publicSourceUrl).filter(Boolean).sort();
      if (sourceUrls.length !== signal.sourceUrls.length) continue;
      add(signal.host, vendor.id, { kind: 'published-browser-host', signalId: signal.id, sourceUrls });
    }
  }
  const priority = entry => entry.sources.some(source => source.kind === 'published-browser-host') ? 0 : 1;
  const entries = [...hosts.values()].sort((a, b) => priority(a) - priority(b) ||
    (a.host < b.host ? -1 : a.host > b.host ? 1 : 0))
    .slice(0, Math.min(maxRequests, config.maximumSelectedHosts));
  for (const entry of entries) {
    entry.vendorIds.sort();
    entry.sources.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
  }
  return {
    schemaVersion: 1, mode: 'plan', status: 'not-run', catalogVersion: catalog.catalogVersion,
    source: { provider: 'Shodan', operation: 'host-count', documentationUrl: config.documentationUrl },
    requestCount: entries.length, requestLimit: maxRequests,
    minimumRequestIntervalMs: config.minimumRequestIntervalMs,
    entries,
  };
}

function cancelBody(response) { try { void response.body?.cancel().catch(() => {}); } catch {} }
async function responseTotal(response, maximumBytes, maximumChunks) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) fail('response-too-large');
  if (!response.body?.getReader) fail('invalid-response');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0, chunkCount = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) fail('invalid-response');
      if (++chunkCount > maximumChunks) fail('response-too-large');
      if (value.byteLength === 0) continue;
      size += value.byteLength;
      if (size > maximumBytes) fail('response-too-large');
      chunks.push(value);
    }
    const buffer = Buffer.concat(chunks, size);
    let data;
    try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
    catch { fail('invalid-response'); }
    if (!data || Array.isArray(data) || !Number.isSafeInteger(data.total) || data.total < 0) fail('invalid-response');
    return data.total;
  } finally {
    try { await reader.cancel(); } catch {}
    reader.releaseLock();
  }
}

async function countHost(host, key, config, fetchImpl) {
  const controller = new AbortController();
  let timer, received;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new AggregateError('request-timeout')); }, config.requestTimeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const url = new URL(config.countPath, config.apiBaseUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'api.shodan.io' || url.port ||
          url.pathname !== '/shodan/host/count' || url.username || url.password) fail('invalid-config');
      url.searchParams.set('key', key);
      url.searchParams.set('query', 'hostname:"' + host + '"');
      const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { Accept: 'application/json' } });
      received = response;
      if (response.redirected || (response.status >= 300 && response.status < 400)) {
        cancelBody(response); fail('redirect-rejected');
      }
      if (response.url) {
        const actual = new URL(response.url);
        if (actual.origin !== url.origin || actual.pathname !== url.pathname) {
          cancelBody(response); fail('redirect-rejected');
        }
      }
      if (response.status !== 200) {
        cancelBody(response);
        return { status: 'http-error', count: null, httpStatus: Number.isInteger(response.status) ? response.status : 0 };
      }
      return { status: 'ok', count: await responseTotal(response,
        config.maximumResponseBytes, config.maximumResponseChunks) };
    })()]);
  } catch (error) {
    return { status: sanitizedErrorCode(error), count: null };
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (received) cancelBody(received);
  }
}

export async function runAggregate({ catalog, config, credential, maxRequests,
  fetchImpl = globalThis.fetch, now = () => performance.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const plan = buildAggregatePlan(catalog, config, { maxRequests: maxRequests ?? config.defaultRequestLimit });
  const key = validCredential(credential);
  const entries = [];
  let lastStarted;
  let authStopped = false;
  for (const planned of plan.entries) {
    if (authStopped) {
      entries.push({ ...planned, status: 'not-run-auth-stop', count: null }); continue;
    }
    if (lastStarted !== undefined) {
      let wait = config.minimumRequestIntervalMs - (now() - lastStarted);
      while (wait > 0) {
        await sleep(wait);
        wait = config.minimumRequestIntervalMs - (now() - lastStarted);
      }
    }
    lastStarted = now();
    const result = await countHost(planned.host, key, config, fetchImpl);
    entries.push({ ...planned, ...result });
    authStopped = result.httpStatus === 401 || result.httpStatus === 403;
  }
  return { ...plan, mode: 'run', status: authStopped ? 'authentication-stopped' :
    entries.every(entry => entry.status === 'ok') ? 'complete' : 'partial', entries };
}

async function writeOutput(projectRoot, config, mode, data) {
  const root = await realpath(projectRoot).catch(() => fail('output-write-failed'));
  const directory = path.resolve(projectRoot, config.outputDirectory);
  if (!inside(path.resolve(projectRoot), directory)) fail('path-outside-project');
  let ancestor = directory;
  try {
    let resolvedAncestor;
    while (!(resolvedAncestor = await realpath(ancestor).catch(() => undefined))) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor || !inside(path.resolve(projectRoot), parent)) fail('path-outside-project');
      ancestor = parent;
    }
    if (!inside(root, resolvedAncestor)) fail('path-outside-project');
    await mkdir(directory, { recursive: true });
    if (!inside(root, await realpath(directory))) fail('path-outside-project');
    const temporary = path.join(directory, '.aggregate-' + randomUUID() + '.tmp');
    const filename = 'aggregate-' + (mode === 'plan' ? 'plan' : 'counts') + '.json';
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(data, null, 2) + '\n', 'utf8'); }
      finally { await handle.close(); }
      await rename(temporary, path.join(directory, filename));
    } finally { await unlink(temporary).catch(() => {}); }
    return config.outputDirectory + '/' + filename;
  } catch (error) {
    if (error instanceof AggregateError) throw error;
    fail('output-write-failed');
  }
}
export function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--plan' || argument === '--run') {
      if (options.mode) fail('invalid-options');
      options.mode = argument.slice(2);
    } else if (argument === '--key-file' || argument === '--max-requests') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) fail('invalid-options');
      if (argument === '--key-file') {
        if (options.keyFile !== undefined) fail('invalid-options');
        options.keyFile = value;
      } else {
        if (options.maxRequests !== undefined || !/^\d+$/.test(value)) fail('invalid-options');
        options.maxRequests = Number(value);
      }
    } else fail('invalid-options');
  }
  if (!options.mode) fail('invalid-options');
  return options;
}
export async function main({ argv = process.argv.slice(2), projectRoot = PROJECT_ROOT,
  env = process.env, fetchImpl = globalThis.fetch, validator, output = line => console.log(line) } = {}) {
  const options = parseOptions(argv);
  const config = await loadAggregateConfig(projectRoot);
  const catalog = await loadCatalog(projectRoot, validator);
  const plan = buildAggregatePlan(catalog, config, options);
  let report = plan;
  if (options.mode === 'run') {
    const credential = await loadCredential({ projectRoot, keyFile: options.keyFile, env });
    report = await runAggregate({ catalog, config, credential, maxRequests: options.maxRequests, fetchImpl });
  }
  report.generatedAt = new Date().toISOString();
  const filename = await writeOutput(projectRoot, config, options.mode, report);
  output('Shodan aggregate: ' + report.status + '; ' + report.requestCount + ' planned requests; ' + filename);
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('Shodan aggregate: ' + sanitizedErrorCode(error, 'invalid-options'));
    process.exitCode = 1;
  });
}
