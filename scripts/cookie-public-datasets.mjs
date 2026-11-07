// Offline, metadata-only normalization; explicitly invoke --fetch for public
// first-party IAB device-storage disclosures. Never downloads cookie values,
// executes vendor code, sends credentials, or affects extension network behavior.
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { normalizeCookieDomain, createCookieClassifier } from '../packages/catalog/src/cookie-classifier.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(ROOT, 'packages/catalog/research/cookies-2026-10');
const MAX_BODY = 2 * 1024 * 1024;
const SPEC_COMMIT = '703fc2964ba8fe1086b18a3c509c46a48c1aee1c';
const SPEC_URL = 'https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework/blob/' + SPEC_COMMIT + '/TCFv2/Vendor%20Device%20Storage%20%26%20Operational%20Disclosures.md';
const NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,256}$/;
const PRIORITY = /google|microsoft|amazon|adobe|criteo|the trade desk|quantcast|index exchange|sovrn|appnexus|xandr|magnite|rubicon|openx|pubmatic|taboola|outbrain|teads|smart adserver|equativ|adform|yahoo|medi[a-z]*math|rtb house|inmobi|lotame|live[r ]amp|id5|zeotap|onetrust|didomi|usercentrics|adroll|nextroll|triplelift|medianet|media\.net|comscore|nielsen|content[s ]quare|emetriq|tapad|permutive|oracle|bombora|flashtalking|sizmek|a[d-z]*ition|sharethrough|casale|iponweb|beeswax|captify|roq\.ad|33across|gumgum|smaato|smartclip|stickyads|seedtag|bid[a-z]*x|adnami|schibsted|cognitiv|deepintent|tremor|unruly|stackadapt|verve|adsquare|eyeota|r[eé]f[iî]l[iî]ation|weborama|dentsu|kantar|doubleverify|integral ad|fifty|proximic|dailymotion|spotify|vivaldi|vimeo|yandex|baidu/i;
const PURPOSES = new Map([
  [1, 'device storage and access'], [2, 'basic advertising'],
  [3, 'advertising profile creation'], [4, 'personalised advertising'],
  [5, 'content profile creation'], [6, 'personalised content'],
  [7, 'advertising measurement'], [8, 'content measurement'],
  [9, 'audience research'], [10, 'service development'], [11, 'basic content selection']
]);
const SPECIAL = new Map([[1, 'security and fraud prevention'], [2, 'ad/content delivery'], [3, 'privacy choices']]);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const clean = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f\u200b\u00ad]/g, '').trim().slice(0, max) : '';
const numeric = value => Array.isArray(value) ? [...new Set(value.filter(n => Number.isSafeInteger(n) && n > 0 && n <= 64))].sort((a, b) => a - b) : [];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const PSL_BYTES = readFileSync(path.join(ROOT, 'packages/attribution/data/public_suffix_list.dat'));
const PSL_RULES = new Set(PSL_BYTES.toString('utf8').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('//')).map(rule => {
  const prefix = rule.startsWith('!') ? '!' : rule.startsWith('*.') ? '*.' : '';
  return prefix + new URL('https://' + rule.slice(prefix.length)).hostname;
}));

export function isPublicSuffix(domain) {
  const labels = domain.split('.');
  let length = 1;
  for (let index = 0; index < labels.length; index++) {
    const suffix = labels.slice(index).join('.');
    if (PSL_RULES.has('!' + suffix)) return false;
    if (PSL_RULES.has(suffix)) length = Math.max(length, labels.length - index);
    if (index > 0 && PSL_RULES.has('*.' + suffix)) length = Math.max(length, labels.length - index + 1);
  }
  return length === labels.length;
}

function safePublicUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || url.port && url.port !== '443') return null;
  if (!normalizeCookieDomain(url.hostname) || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)(?:\.|$)/i.test(url.hostname)) return null;
  return url;
}

function privateAddress(address) {
  if (address.includes(':')) return /^(?:\:\:|fe[89ab]|f[cd]|2001:db8)/i.test(address) || address.startsWith('::ffff:') && privateAddress(address.slice(7));
  const parts = address.split('.').map(Number);
  return parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255) ||
    parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] >= 224 ||
    parts[0] === 169 && parts[1] === 254 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 ||
    parts[0] === 192 && parts[1] === 168 || parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

export async function publicJson(value) {
  const signal = AbortSignal.timeout(10_000);
  let current = value;
  for (let redirects = 0; redirects <= 4; redirects++) {
    const url = safePublicUrl(current);
    if (!url) return { status: 'rejected-url' };
    const addresses = await dns.lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) return { status: 'rejected-address' };
    const response = await fetch(url.href, { signal, redirect: 'manual', credentials: 'omit', headers: { Accept: 'application/json', 'User-Agent': 'Detect.Expert public cookie metadata research' } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { status: 'invalid-redirect', httpStatus: response.status };
      current = new URL(location, url).href;
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); return { status: 'http-error', httpStatus: response.status }; }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY) { await response.body?.cancel(); return { status: 'oversized' }; }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body ?? []) {
      bytes += chunk.length;
      if (bytes > MAX_BODY) return { status: 'oversized' };
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks);
    let json;
    try { json = JSON.parse(raw.toString('utf8')); } catch { return { status: 'invalid-json', httpStatus: response.status, bytes }; }
    if (!json || typeof json !== 'object' || !Array.isArray(json.disclosures)) return { status: 'invalid-schema', bytes };
    // Retain a strict factual allowlist. Cookie values, token-bearing fields,
    // descriptions, raw bodies and response headers are never written or logged.
    const disclosures = json.disclosures.slice(0, 10_000).filter(row => row && typeof row === 'object').map(row => ({
      identifier: clean(row.identifier, 256), type: clean(row.type, 12),
      domain: clean(row.domain, 254), domains: Array.isArray(row.domains) ? row.domains.slice(0, 128).map(v => clean(v, 254)) : [],
      purposes: numeric(row.purposes), specialPurposes: numeric(row.specialPurposes),
      optOut: row.optOut === true,
      maxAgeSeconds: Number.isSafeInteger(row.maxAgeSeconds) && row.maxAgeSeconds >= 0 ? row.maxAgeSeconds : null,
      cookieRefresh: typeof row.cookieRefresh === 'boolean' ? row.cookieRefresh : null
    }));
    return { status: 'ok', finalUrl: url.href, sha256: sha(raw), bytes, disclosures };
  }
  return { status: 'redirect-limit' };
}

export async function fetchIabDisclosures({ limit = 400 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1226) throw new Error('Invalid bounded disclosure limit');
  const gvl = JSON.parse(await fs.readFile(path.join(DIR, 'iab-gvl-source.json'), 'utf8'));
  const sorted = [...gvl.vendors].sort((a, b) => Number(PRIORITY.test(b.name)) - Number(PRIORITY.test(a.name)) || a.id - b.id).slice(0, limit);
  const results = [];
  const requests = new Map();
  let cursor = 0;
  const deadline = Date.now() + 600_000;
  async function worker() {
    while (cursor < sorted.length) {
      const vendor = sorted[cursor++];
      if (Date.now() >= deadline) {
        results.push({ vendorId: vendor.id, owner: clean(vendor.name, 128), sourceUrl: vendor.deviceStorageDisclosureUrl, status: 'overall-deadline' });
        continue;
      }
      let pending = requests.get(vendor.deviceStorageDisclosureUrl);
      if (!pending) {
        pending = publicJson(vendor.deviceStorageDisclosureUrl).catch(error => ({ status: error.name === 'TimeoutError' || error.name === 'AbortError' ? 'timeout' : 'fetch-error' }));
        requests.set(vendor.deviceStorageDisclosureUrl, pending);
      }
      const result = await pending;
      results.push({ vendorId: vendor.id, owner: clean(vendor.name, 128), sourceUrl: vendor.deviceStorageDisclosureUrl, ...result });
      if (results.length % 25 === 0) console.log(JSON.stringify({ completed: results.length, requested: sorted.length, successful: results.filter(row => row.status === 'ok').length }));
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  results.sort((a, b) => a.vendorId - b.vendorId);
  const snapshot = {
    schemaVersion: 1, accessedAt: '2026-10-09', gvlSource: gvl.sourceUrl, gvlArchive: gvl.archiveUrl,
    gvlSha256: gvl.sha256, vendorListVersion: gvl.vendorListVersion, specification: SPEC_URL, specificationCommit: SPEC_COMMIT,
    licenseNote: 'Vendor-published factual device-storage declarations intended for public processing; no general open-data licence is asserted. Descriptions are independently composed from declared purpose IDs. No raw document bodies are retained.',
    limits: { vendors: limit, concurrency: 4, timeoutMs: 10_000, overallDeadlineMs: 600_000, maxBodyBytes: MAX_BODY, redirects: 4 },
    results
  };
  const baselineBytes = await fs.readFile(path.join(DIR, 'public-cookie-baseline.json'));
  snapshot.baseline = { file: 'public-cookie-baseline.json', records: JSON.parse(baselineBytes).entries.length, sha256: sha(baselineBytes) };
  await fs.writeFile(path.join(DIR, 'iab-cookie-disclosure-snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');
  return snapshot;
}

function disclosureScope(row) {
  const original = row.domains.length ? row.domains : row.domain ? [row.domain] : [];
  const normalized = original.map(value => normalizeCookieDomain(value.startsWith('*.') ? value.slice(2) : value));
  const domains = [...new Set(normalized.filter(Boolean))].sort();
  const rejectedPublicSuffix = domains.some(isPublicSuffix);
  return domains.length && normalized.every(Boolean) && !rejectedPublicSuffix ? { domainContext: 'domain', domains, rejectedPublicSuffix } : { domainContext: 'unassessed', domains: [], rejectedPublicSuffix };
}

function purposes(row) {
  if (row.optOut) return { category: 'consent', purpose: 'Vendor-declared cookie storing a choice to opt out of tracking.' };
  const declared = row.purposes.map(id => PURPOSES.get(id) ?? 'TCF purpose ' + id);
  const specials = row.specialPurposes.map(id => SPECIAL.get(id) ?? 'TCF special purpose ' + id);
  let category = 'unknown';
  if (row.purposes.some(id => [2, 3, 4, 7].includes(id))) category = 'advertising';
  else if (row.purposes.some(id => [5, 6, 8, 9].includes(id))) category = 'analytics';
  else if (row.purposes.includes(11)) category = 'functional';
  else if (row.specialPurposes.includes(1) && !row.specialPurposes.includes(2)) category = 'security';
  else if (row.specialPurposes.includes(2)) category = 'functional';
  return { category, purpose: (declared.length || specials.length ? 'Vendor-declared purposes: ' + [...declared, ...specials].join('; ') + '.' : 'The vendor declares this cookie and domain without TCF purpose IDs.').slice(0, 512) };
}

export function normalizeIabSnapshot(snapshot, existing = { entries: [] }) {
  const current = createCookieClassifier(existing);
  const entries = [];
  const quality = { vendorsAttempted: snapshot.results.length, successfulDocuments: 0, failedDocuments: 0, cookieDisclosures: 0, nonCookieDisclosures: 0, unsupportedPatterns: 0, unassessedDomains: 0, publicSuffixScopesRejected: 0, scopedRules: 0, unknownCategories: 0, coveredByExisting: 0 };
  for (const source of snapshot.results) {
    if (source.status !== 'ok') { quality.failedDocuments++; continue; }
    quality.successfulDocuments++;
    for (let index = 0; index < source.disclosures.length; index++) {
      const row = source.disclosures[index];
      if (row.type !== 'cookie') { quality.nonCookieDisclosures++; continue; }
      quality.cookieDisclosures++;
      const identifier = row.identifier;
      const stars = [...identifier.matchAll(/\*/g)].length;
      let name = identifier;
      let match = 'exact';
      if (stars === 1 && identifier.endsWith('*') && identifier.length > 3) { name = identifier.slice(0, -1); match = 'prefix'; }
      else if (stars || !NAME.test(name)) { quality.unsupportedPatterns++; continue; }
      const scope = disclosureScope(row);
      if (scope.rejectedPublicSuffix) quality.publicSuffixScopesRejected++;
      if (scope.domainContext === 'unassessed') quality.unassessedDomains++;
      else quality.scopedRules++;
      const purpose = purposes(row);
      if (purpose.category === 'unknown') quality.unknownCategories++;
      const urls = [...new Set([source.finalUrl, source.sourceUrl].filter(v => safePublicUrl(v)))];
      if (!urls.length) continue;
      // Split large finite scopes; the canonical classifier bounds 16 domains.
      const domainChunks = scope.domains.length ? Array.from({ length: Math.ceil(scope.domains.length / 16) }, (_, chunk) => scope.domains.slice(chunk * 16, chunk * 16 + 16)) : [[]];
      for (let chunk = 0; chunk < domainChunks.length; chunk++) {
        const domains = domainChunks[chunk];
        const representativeName = match === 'prefix' ? name + 'fixture' : name;
        const baseline = domains.length ? current.classifyCookie({ name: representativeName, domain: domains[0] }) : null;
        const covered = baseline && baseline.confidence !== 'unknown' && baseline.confidence !== 'ambiguous' && baseline.owner !== '';
        if (covered) quality.coveredByExisting++;
        const id = `iab:${source.vendorId}:${index}${domainChunks.length > 1 ? ':' + chunk : ''}`;
        entries.push({
          id, name, match, domainContext: scope.domainContext, domains,
          category: purpose.category, owner: source.owner, purpose: purpose.purpose,
          // Declaring a cookie does not independently establish its producer.
          // Community rank cannot displace reviewed first-party primary rules.
          confidence: 'community', sourceUrls: urls,
          sources: [{ url: urls[0], title: source.owner + ' public device-storage disclosure', claim: purpose.purpose, accessedAt: snapshot.accessedAt }],
          provenance: {
            kind: 'iab-device-storage-disclosure', vendorId: source.vendorId, vendorListVersion: snapshot.vendorListVersion,
            snapshotSha256: source.sha256, gvlSha256: snapshot.gvlSha256, originalIdentifier: identifier,
            declaredPurposes: row.purposes, specialPurposes: row.specialPurposes, optOut: row.optOut,
            maxAgeSeconds: row.maxAgeSeconds, cookieRefresh: row.cookieRefresh,
            coveredByExisting: Boolean(covered), existingRuleIds: covered ? baseline.ruleIds : [],
            reviewStatus: 'documented-candidate'
          }
        });
      }
    }
  }
  entries.sort((a, b) => compare(a.id, b.id));
  const identity = entry => [entry.name, entry.match, entry.domainContext, entry.domains.join(','), entry.owner, entry.category].join('|');
  const unique = new Map();
  for (const entry of entries) if (!unique.has(identity(entry))) unique.set(identity(entry), entry);
  const normalized = [...unique.values()];
  return {
    schemaVersion: 1, generatedAt: snapshot.accessedAt,
    source: { kind: 'iab-device-storage-disclosure', gvlArchive: snapshot.gvlArchive, gvlSha256: snapshot.gvlSha256, vendorListVersion: snapshot.vendorListVersion, specification: snapshot.specification, specificationCommit: snapshot.specificationCommit, licenseNote: snapshot.licenseNote, baseline: snapshot.baseline, publicSuffixListSha256: sha(PSL_BYTES) },
    quality: { ...quality, rawRules: entries.length, deduplicatedRules: normalized.length, newScopedRules: normalized.filter(entry => entry.domainContext === 'domain' && !entry.provenance.coveredByExisting).length, runtimeReadyCandidates: normalized.filter(entry => entry.domainContext === 'domain' && !entry.provenance.coveredByExisting && entry.category !== 'unknown').length },
    entries: normalized
  };
}

export async function normalizePublicDatasets({ write = true } = {}) {
  const snapshot = JSON.parse(await fs.readFile(path.join(DIR, 'iab-cookie-disclosure-snapshot.json'), 'utf8'));
  const baselineBytes = await fs.readFile(path.join(DIR, 'public-cookie-baseline.json'));
  if (snapshot.baseline?.sha256 && sha(baselineBytes) !== snapshot.baseline.sha256) throw new Error('Pinned cookie baseline checksum mismatch');
  const existing = JSON.parse(baselineBytes);
  const output = normalizeIabSnapshot(snapshot, existing);
  const content = JSON.stringify(output, null, 2) + '\n';
  const file = path.join(DIR, 'iab-cookie-disclosures.normalized.json');
  if (write) await fs.writeFile(file, content);
  else if (await fs.readFile(file, 'utf8') !== content) throw new Error('Stale public disclosure normalization');
  return output;
}

export function parseCookieAuditMetadata(source) {
  // A deliberately tiny literal reader, not JavaScript evaluation. Expressions,
  // calls, accessors, templates and spread syntax are rejected.
  if (typeof source !== 'string' || source.length > 256 * 1024) throw new Error('Invalid bounded public metadata');
  let cursor = 0;
  function whitespace() {
    for (;;) {
      while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor++;
      if (source.slice(cursor, cursor + 2) === '//') { const end = source.indexOf('\n', cursor + 2); cursor = end === -1 ? source.length : end + 1; }
      else if (source.slice(cursor, cursor + 2) === '/*') { const end = source.indexOf('*/', cursor + 2); if (end === -1) throw new Error('Unterminated metadata comment'); cursor = end + 2; }
      else return;
    }
  }
  function quoted() {
    const start = cursor;
    const quote = source[cursor++];
    let escaped = false;
    while (cursor < source.length) {
      const char = source[cursor++];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) {
        const raw = source.slice(start, cursor);
        if (quote === '"') return JSON.parse(raw);
        const text = raw.slice(1, -1);
        if (/\\[^\\']/.test(text)) throw new Error('Unsupported single-quote metadata escape');
        return text.replace(/\\([\\'])/g, '$1');
      }
    }
    throw new Error('Unterminated metadata string');
  }
  function bare() {
    const token = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(cursor));
    if (!token) throw new Error('Invalid metadata key');
    cursor += token[0].length;
    return token[0];
  }
  function value(depth = 0) {
    if (depth > 8) throw new Error('Metadata literal nesting exceeded');
    whitespace();
    const char = source[cursor];
    if (char === '"' || char === "'") return quoted();
    if (char === '{' || char === '[') {
      const object = char === '{';
      const result = object ? Object.create(null) : [];
      const close = object ? '}' : ']';
      cursor++;
      for (;;) {
        whitespace();
        if (source[cursor] === close) { cursor++; return result; }
        if (object) {
          const key = source[cursor] === '"' || source[cursor] === "'" ? quoted() : bare();
          whitespace();
          if (source[cursor++] !== ':' || Object.hasOwn(result, key)) throw new Error('Invalid or duplicate metadata property');
          result[key] = value(depth + 1);
        } else result.push(value(depth + 1));
        whitespace();
        if (source[cursor] === close) { cursor++; return result; }
        if (source[cursor++] !== ',') throw new Error('Executable public metadata is not permitted');
      }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?\b/.exec(source.slice(cursor));
    if (number) { cursor += number[0].length; return Number(number[0]); }
    throw new Error('Executable public metadata is not permitted');
  }
  const records = Object.create(null);
  for (const name of ['EXACT', 'PREFIXES', 'DOMAINS']) {
    const expression = new RegExp('\\bexport\\s+const\\s+' + name + '\\s*=\\s*', 'g');
    const marker = expression.exec(source);
    if (!marker) throw new Error('Incomplete cookie-audit metadata');
    cursor = expression.lastIndex;
    records[name] = value();
    whitespace();
    if (source[cursor] !== ';') throw new Error('Executable public metadata is not permitted');
  }
  if (!records.EXACT || !records.PREFIXES || !records.DOMAINS) throw new Error('Incomplete cookie-audit metadata');
  return records;
}

export async function normalizeMitCandidates({ write = true } = {}) {
  const manifest = JSON.parse(await fs.readFile(path.join(DIR, 'public-datasets-manifest.json'), 'utf8'));
  async function verified(file) {
    const entry = manifest.files.find(row => row.file === file);
    const bytes = await fs.readFile(path.join(DIR, file));
    if (!entry || sha(bytes) !== entry.sha256) throw new Error('Public cookie metadata snapshot checksum mismatch');
    return { entry, text: bytes.toString('utf8') };
  }
  const audit = await verified('cookie-audit-src-known-cookies.js');
  const values = parseCookieAuditMetadata(audit.text);
  const block = await verified('cookieblock-src-ext_data-known_cookies.json');
  const known = JSON.parse(block.text);
  const base = JSON.parse(await fs.readFile(path.join(DIR, 'public-cookie-baseline.json'), 'utf8'));
  const identity = entry => entry.match + ':' + entry.name;
  const current = new Set(base.entries.map(identity));
  const entries = [];
  const category = value => value === 'marketing' ? 'advertising' : ['necessary', 'functional', 'analytics'].includes(value) ? value : 'unknown';
  function addAudit(name, match, row) {
    if (!NAME.test(name) || name.includes('*') || match === 'prefix' && name.length < 2) return;
    entries.push({
      id: 'cookie-audit:' + sha(match + ':' + name).slice(0, 16), name, match,
      domainContext: 'unassessed', domains: [], category: category(row.category),
      owner: clean(row.provider, 128), purpose: clean(row.description, 512), confidence: 'community', sourceUrls: [audit.entry.url],
      provenance: { kind: 'cookie-audit', commit: audit.entry.commit, license: 'MIT', snapshotSha256: audit.entry.sha256, scopeVerified: false, knownNameInBaseline: current.has(match + ':' + name), reviewStatus: 'community-candidate' }
    });
  }
  for (const [name, row] of Object.entries(values.EXACT)) addAudit(name, 'exact', row);
  for (const row of values.PREFIXES) addAudit(row.prefix, 'prefix', row);
  let exceptionIndex = 0;
  function addException(name, domain) {
    if (!NAME.test(name) || name.includes('*')) return;
    const normalized = normalizeCookieDomain(domain);
    entries.push({
      id: 'cookieblock:exception:' + exceptionIndex++, name, match: 'exact', domainContext: 'unassessed', domains: normalized ? [normalized] : [],
      category: 'unknown', owner: '', purpose: 'CookieBlock lists this name as an exception to automated blocking; the exception does not establish its purpose or producer.',
      confidence: 'community', sourceUrls: [block.entry.url],
      provenance: { kind: 'cookieblock-curated-exception', commit: block.entry.commit, license: 'MIT', snapshotSha256: block.entry.sha256, exceptionDomain: normalized, knownNameInBaseline: current.has('exact:' + name), reviewStatus: 'community-candidate' }
    });
  }
  for (const name of Object.keys(known.name_match ?? {})) addException(name, '');
  for (const [domain, cookies] of Object.entries(known.domain_match ?? {})) for (const name of Object.keys(cookies)) addException(name, domain);
  entries.sort((a, b) => compare(a.id, b.id));
  const output = {
    schemaVersion: 1, generatedAt: '2026-10-09', sources: manifest,
    quality: { cookieAuditExact: Object.keys(values.EXACT).length, cookieAuditPrefixes: values.PREFIXES.length, cookieAuditDomainHints: Object.keys(values.DOMAINS).length, candidateRecords: entries.length, candidateNamesNewToBaseline: new Set(entries.filter(row => !row.provenance.knownNameInBaseline).map(identity)).size, runtimeAdmittedRules: 0, unsupportedCookieBlockDomainRegexGroups: Object.keys(known.domain_regex ?? {}).length },
    entries
  };
  const content = JSON.stringify(output, null, 2) + '\n';
  const file = path.join(DIR, 'public-cookie-candidates.normalized.json');
  if (write) await fs.writeFile(file, content);
  else if (await fs.readFile(file, 'utf8') !== content) throw new Error('Stale public cookie candidate normalization');
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fetchIndex = process.argv.indexOf('--fetch');
  if (fetchIndex !== -1) {
    const next = process.argv[fetchIndex + 1];
    await fetchIabDisclosures({ limit: next && /^[0-9]+$/.test(next) ? Number(next) : 400 });
  }
  const candidates = await normalizeMitCandidates({ write: !process.argv.includes('--check') });
  if (process.argv.includes('--candidates-only')) { console.log(JSON.stringify(candidates.quality, null, 2)); process.exit(0); }
  const output = await normalizePublicDatasets({ write: !process.argv.includes('--check') });
  console.log(JSON.stringify(output.quality, null, 2));
}
