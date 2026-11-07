// ADR-034: independently enumerate the identities that the shipped classifiers can present.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { resolve } from 'node:path';
import { COMPANY_BRANDS, companyBrand } from '../../apps/production-extension/company-branding.js';
import { cookieCatalog, classifyCookie, createCookieClassifier } from '../../apps/production-extension/cookie-catalog.js';
import { LOADER_SERVICES, SOCIAL_SERVICES } from '../../apps/production-extension/inspection-contracts.js';
const root = resolve(import.meta.dirname, '../..');
const read = file => readFileSync(resolve(root, 'apps/production-extension', file), 'utf8');
function literal(source, marker, end) {
  const start = source.indexOf(marker), stop = source.indexOf(end, start + marker.length);
  if (start < 0 || stop < 0) throw new Error('Missing catalogue literal: ' + marker);
  return vm.runInNewContext('(' + source.slice(start + marker.length, stop) + ')', Object.create(null), { timeout: 1000 });
}
const background = read('background.js'), identification = read('identification-ui.js');
const labels = literal(read('popup.js'), 'var LABELS = ', ', VENDOR_CATALOG_PRODUCT_COUNT');
const resourceRules = literal(background, 'var vendors_runtime_default = ', ';\n').rules;
const rtcRules = literal(background, 'var vendors_rtc_runtime_default = ', ';\n').rules;
const socialNames = literal(identification, 'const SOCIAL_NAMES = Object.freeze(', ');');
const loaderNames = literal(identification, 'const SERVICE_NAMES = Object.freeze(', ');');
const beaconNames = literal(read('advanced-ui.js'), 'const serviceNames = ', ';');
const named = (id, name) => ({ id, name, brand: companyBrand(id)?.id ?? null });
const groups = {
  antifraud: Object.entries(labels).map(([id, name]) => named(id, name)),
  social: SOCIAL_SERVICES.filter(id => id !== 'unknown').map(id => named(id, socialNames[id])),
  tagManager: LOADER_SERVICES.map(id => named(id, loaderNames[id])),
  beacons: Object.entries(beaconNames).map(([id, name]) => named(id, name))
};
const conventions = new Set(['ASP.NET', 'PHP', 'Java', 'JSESSIONID', 'Java/JSP', 'Express', 'CSRF protection', 'PHP session', 'Site', 'First party', 'First-party', 'Session', 'Web application', 'Load balancer', 'HTTP', 'JWT', 'Web framework', 'Consent', 'IAB TCF', 'IAB Europe']);
const convention = name => name.startsWith('Site application (') || name.startsWith('Site consent manager (') || conventions.has(name);
const ownerLabels = new Set(cookieCatalog.entries.map(entry => entry.owner)), witnessed = new Set();
for (const entry of cookieCatalog.entries) {
  if (entry.domainContext === 'unassessed' || entry.confidence !== 'documented' && entry.domainContext !== 'domain') continue;
  const name = entry.match === 'exact' ? entry.name : entry.name + (entry.nameSuffix === 'hex' ? 'a' : '1').repeat(Math.max(1, (entry.nameLength ?? entry.name.length + 1) - entry.name.length));
  for (const domain of entry.domains.length ? entry.domains : ['sample.example.com']) {
    const result = classifyCookie({ name, domain });
    if (result.owner && result.owner === entry.owner && result.confidence !== 'ambiguous') { witnessed.add(result.owner); break; }
  }
}
const cookies = [...witnessed].sort().map(name => {
  const brand = companyBrand(name);
  return { name, type: convention(name) ? 'convention' : name.startsWith('Vendor declaration: ') ? 'declarant' : 'company', brand: brand?.id ?? null, role: brand?.role ?? null };
});
const cookieCompanies = cookies.filter(row => row.type !== 'convention');
const gaps = { ...Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.filter(row => !row.brand).map(row => row.name)])), cookies: cookieCompanies.filter(row => !row.brand).map(row => row.name) };
const evidence = { schemaVersion: 1, date: '2026-10-10', requirement: 'ADR-034 / REQ-010/013',
  counts: { packagedBrands: COMPANY_BRANDS.length, exactAliases: COMPANY_BRANDS.reduce((count, brand) => count + brand.aliases.length + brand.declarantAliases.length, 0), antifraud: groups.antifraud.length, activeAntifraud: new Set([...resourceRules, ...rtcRules].filter(rule => Date.parse(rule.reviewDueAt) > Date.now()).map(rule => rule.vendorId)).size, social: groups.social.length, tagManager: groups.tagManager.length, beacons: groups.beacons.length, cookieRules: cookieCatalog.entries.length, cookieCompiledRules: createCookieClassifier(cookieCatalog).ruleCount, catalogOwnerLabels: ownerLabels.size, witnessedCookieOwners: cookies.length, witnessedCookieCompanies: cookieCompanies.length, witnessedNeutralConventions: cookies.length - cookieCompanies.length, cookieCompaniesWithLogo: cookieCompanies.filter(row => row.brand).length, totalGaps: Object.values(gaps).reduce((count, rows) => count + rows.length, 0) },
  sourceHashes: Object.fromEntries(['company-branding.js', 'cookie-catalog.js', 'identification-ui.js', 'advanced-ui.js', 'background.js', 'popup.js'].map(file => [file, createHash('sha256').update(read(file)).digest('hex')])),
  method: 'The full shipped classifier is exercised on every admitted static selector and a valid synthetic suffix for every admitted prefix across all declared domains. Counts describe witnessed distinct owner labels, not website detection accuracy. Exact catalogue identities only; inactive research seeds and ownerless name hints excluded.',
  groups, cookies, gaps };
if (process.argv.includes('--write')) writeFileSync(resolve(root, 'docs/coverage/company-logos.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ counts: evidence.counts, gaps }, null, 2));
if (process.argv.includes('--check') && evidence.counts.totalGaps) process.exitCode = 1;
