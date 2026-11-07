import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { normalizeCookieDomain, createCookieClassifier } from '../packages/catalog/src/cookie-classifier.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RESEARCH = path.join(ROOT, 'packages/catalog/research/cookies-2026-10');
const DATA = path.join(ROOT, 'packages/catalog/data');
const MODULE = path.join(ROOT, 'apps/production-extension/cookie-catalog.js');
const CATEGORY = { Functional: 'functional', Personalization: 'functional', Analytics: 'analytics', Marketing: 'advertising', Security: 'security', Necessary: 'necessary' };

export function parseUpstreamDomain(value) {
  if (typeof value !== 'string' || !value.trim()) return { domains: [], domainContext: 'unassessed' };
  const cleaned = value.replace(/\(\s*(?:3rd party|third party|first party|1st party)\s*\)/gi, '').replace(/[\u200b\u00ad]/g, '').trim();
  const parts = cleaned.split(/\s+or\s+|[,;]\s*/).map(part => part.replace(/^or\s+/, '').trim()).filter(Boolean);
  const domains = [...new Set(parts.map(normalizeCookieDomain).filter(Boolean))].sort();
  return domains.length && domains.length === parts.length ? { domains, domainContext: 'domain' } : { domains: [], domainContext: 'unassessed' };
}

function text(value, max) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f\u200b\u00ad]/g, '').trim().slice(0, max) : '';
}

export async function buildCookieCatalog({ write = true, verify = false } = {}) {
  let snapshotsMissing = false; // true when the unpublished IAB snapshots are absent (see PUBLIC-SNAPSHOTS.json)
  const manifest = JSON.parse(await fs.readFile(path.join(RESEARCH, 'upstream-manifest.json'), 'utf8'));
  const bytes = await fs.readFile(path.join(RESEARCH, 'open-cookie-database.json'));
  const upstreamFile = manifest.files.find(file => file.file === 'open-cookie-database.json');
  if (!upstreamFile || crypto.createHash('sha256').update(bytes).digest('hex') !== upstreamFile.sha256) throw new Error('Cookie snapshot checksum mismatch');
  const upstream = JSON.parse(bytes.toString('utf8'));
  const overrides = JSON.parse(await fs.readFile(path.join(DATA, 'cookies.overrides.json'), 'utf8'));
  const additionalManifest = JSON.parse(await fs.readFile(path.join(RESEARCH, 'public-catalog-inputs.json'), 'utf8'));
  for (const file of additionalManifest.files) {
    if (!/^[A-Za-z0-9_.-]+$/.test(file.file)) throw new Error('Invalid public cookie source path');
    const sourceFile = path.join(RESEARCH, file.file);
    if (!await fs.access(sourceFile).then(() => true, () => false)) { snapshotsMissing = true; continue; } // unpublished third-party snapshot
    const content = await fs.readFile(sourceFile);
    if (crypto.createHash('sha256').update(content).digest('hex') !== file.sha256) throw new Error('Public cookie source checksum mismatch: ' + file.file);
  }
  const entries = [];
  const quality = { rawEntries: 0, platforms: Object.keys(upstream).length, unscoped: 0, invalidNames: 0, literalWildcardContradictions: 0, invalidDomains: 0, missingPrivacyUrls: 0 };
  for (const [platform, rows] of Object.entries(upstream)) {
    if (!Array.isArray(rows)) throw new Error('Invalid cookie platform rows');
    for (const row of rows) {
      quality.rawEntries++;
      const name = text(row.cookie, 256);
      const scope = parseUpstreamDomain(row.domain);
      const validName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,256}$/.test(name);
      if (!validName) quality.invalidNames++;
      if (!text(row.domain, 512)) quality.unscoped++;
      else if (scope.domainContext !== 'domain') quality.invalidDomains++;
      if (name.includes('*') && row.wildcardMatch !== '1') quality.literalWildcardContradictions++;
      const privacy = text(row.privacyLink, 512);
      if (!privacy) quality.missingPrivacyUrls++;
      // Retain every upstream row, including invalid/unscoped candidates; runtime
      // admits only valid names and documented domains or reviewed primary rules.
      entries.push({
        id: 'ocdb:' + text(row.id, 80), name, match: row.wildcardMatch === '1' ? 'prefix' : 'exact',
        ...scope, category: CATEGORY[row.category] ?? 'unknown', owner: text(row.dataController || platform, 128),
        purpose: text(row.description, 512), confidence: 'community',
        sourceUrls: [upstreamFile.url],
        provenance: { kind: 'open-cookie-database', platform: text(platform, 128), recordId: text(row.id, 80), commit: manifest.commit, license: 'Apache-2.0', privacyUrl: /^https:\/\//.test(privacy) ? privacy : '', originalDomain: text(row.domain, 512), originalCategory: text(row.category, 40) }
      });
    }
  }
  for (const entry of overrides.entries) {
    if (createCookieClassifier({ entries: [{ ...entry, confidence: 'documented' }] }).ruleCount !== 1 || !Array.isArray(entry.sources) || !entry.sources.length) throw new Error('Invalid primary cookie rule: ' + entry.id);
    entries.push({ ...entry, confidence: 'documented', provenance: { kind: 'primary-documentation', reviewedAt: '2026-10-09', sources: entry.sources ?? [] } });
  }
  const publicStats = {};
  for (const filename of ['public-cookie-candidates.normalized.json', 'iab-cookie-disclosures.normalized.json']) {
    const datasetFile = path.join(RESEARCH, filename);
    // the raw IAB declarations are not published; PUBLIC-SNAPSHOTS.json pins the derived artifacts instead
    if (filename.startsWith('iab-') && !await fs.access(datasetFile).then(() => true, () => false)) { snapshotsMissing = true; continue; }
    const dataset = JSON.parse(await fs.readFile(datasetFile, 'utf8'));
    publicStats[filename] = { records: dataset.entries.length, compiledRules: 0, unsupportedRules: 0, quality: dataset.quality };
    for (const raw of dataset.entries) {
      const iab = filename === 'iab-cookie-disclosures.normalized.json';
      const entry = { ...raw, confidence: 'community', owner: iab ? ('Vendor declaration: ' + raw.owner).slice(0, 128) : raw.owner,
        provenance: { ...raw.provenance, declaringVendor: iab ? raw.owner : undefined, producerConfirmed: false, reviewStatus: 'normalization-validated', reviewedAt: '2026-10-09' } };
      if (createCookieClassifier({ entries: [entry] }).ruleCount === 1) publicStats[filename].compiledRules++;
      else { publicStats[filename].unsupportedRules++; entry.provenance.reviewStatus = 'unsupported-metadata-rule'; }
      entries.push(entry);
    }
  }
  if (snapshotsMissing && !write) {
    const committed = JSON.parse(await fs.readFile(path.join(DATA, 'cookies.v1.json'), 'utf8'));
    entries.length = 0; entries.push(...committed.entries);
    Object.assign(publicStats, committed.quality.publicDatasets);
  }
  entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Duplicate cookie entry ID');
  const catalog = { schemaVersion: 1, version: '1.1.0', generatedAt: '2026-10-09', upstream: manifest, additionalSources: additionalManifest, quality: { ...quality, publicDatasets: publicStats }, entries };
  const classifier = createCookieClassifier(catalog);
  const stats = { records: entries.length, compiledRules: classifier.ruleCount, primaryRules: overrides.entries.length, scopedCommunity: entries.filter(entry => entry.confidence === 'community' && entry.domainContext === 'domain').length, ...quality, publicDatasets: publicStats };
  if (write || verify) {
    const source = await fs.readFile(path.join(ROOT, 'packages/catalog/src/cookie-classifier.mjs'), 'utf8');
    const runtimeEntries = entries.map(({ id, name, match, domains, domainContext, category, owner, purpose, confidence, sourceUrls, nameLength, nameSuffix }) => ({ id, name, match, domains, domainContext, category, owner, purpose, confidence, sourceUrls, nameLength, nameSuffix }));
    const runtimeCatalog = { schemaVersion: 1, version: catalog.version, generatedAt: catalog.generatedAt, entries: runtimeEntries };
    const banner = '// Generated by scripts/cookie-catalog.mjs. Offline cookie metadata: Open Cookie Database, MIT catalogues, vendor documentation and public IAB declarations.\n// Source attribution and applicable licences: COOKIE-CATALOG-NOTICE.txt and COOKIE-CATALOG-LICENSE.txt.\n';
    const suffix = '\nconst builtInCookieClassifier = createCookieClassifier(cookieCatalog);\nexport const classifyCookie = builtInCookieClassifier.classifyCookie;\nexport const projectCookieMetadata = builtInCookieClassifier.projectCookieMetadata;\n';
    const artifacts = [
      [path.join(DATA, 'cookies.v1.json'), JSON.stringify(catalog, null, 2) + '\n'],
      [MODULE, banner + 'export const cookieCatalog = ' + JSON.stringify(runtimeCatalog).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + ';\n' + source + suffix],
      [path.join(ROOT, 'apps/production-extension/COOKIE-CATALOG-LICENSE.txt'), [await fs.readFile(path.join(RESEARCH, 'LICENSE'), 'utf8'), ...await Promise.all(['cookie-audit-LICENSE', 'cookieblock-LICENSE', 'cookieblock-src-LICENSE'].map(file => fs.readFile(path.join(RESEARCH, file), 'utf8')))].join('\n\n')],
      [path.join(ROOT, 'apps/production-extension/COOKIE-CATALOG-NOTICE.txt'), 'Open Cookie Database\nhttps://github.com/jkwakman/Open-Cookie-Database\nApache License, Version 2.0\nUpstream commit: ' + manifest.commit + '\nSnapshot SHA-256: ' + upstreamFile.sha256 + '\n\ncookie-audit and CookieBlock: MIT; pinned commits and source SHA-256 values:\n' + JSON.stringify(additionalManifest.licensedSources, null, 2) + '\n\nIAB TCF GVL 180: vendor-published factual device-storage declarations, independently composed purpose descriptions. No blanket open-data licence is asserted for vendor documents. The declaring vendor does not establish the cookie manufacturer.\nSpecification: ' + additionalManifest.iabSpecification + '\n\nChanges: normalized metadata, bounded domain admission, community confidence, reviewed primary overrides and neutral catalogue-name references. No cookie values are included.\n']
    ];
    if (snapshotsMissing) {
      if (write) throw new Error('The raw IAB declarations are not published; fetch them with scripts/cookie-public-datasets.mjs before regenerating the catalogue');
      const pinned = JSON.parse(await fs.readFile(path.join(RESEARCH, 'PUBLIC-SNAPSHOTS.json'), 'utf8')).derivedArtifacts;
      for (const [file] of artifacts) {
        const key = path.relative(ROOT, file).split(path.sep).join('/');
        const digest = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
        if (pinned[key] !== digest) throw new Error('Cookie catalog artifact differs from PUBLIC-SNAPSHOTS.json: ' + key);
      }
    }
    for (const [file, content] of artifacts) {
      if (write) await fs.writeFile(file, content);
      else if (await fs.readFile(file, 'utf8') !== content) throw new Error('Stale cookie catalog artifact: ' + path.relative(ROOT, file));
    }
  }
  return { catalog, stats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildCookieCatalog({ write: !process.argv.includes('--check'), verify: process.argv.includes('--check') });
  console.log(JSON.stringify(result.stats, null, 2));
}
