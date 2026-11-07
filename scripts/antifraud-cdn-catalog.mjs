// REQ-008 / ADR-009/019: reproducible research inventory, separate from runtime.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accessedAt, reviewDueAt, sourceGroups, exclusions } from './research/antifraud-cdn-sources.mjs';

export const ROOT = resolve(import.meta.dirname, '..');
export const RESEARCH = 'packages/catalog/research/cdn-2026-10';
export const OUTPUT = 'packages/catalog/data/antifraud-cdn.v1.json';
const digest = value => createHash('sha256').update(value).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const clone = value => JSON.parse(JSON.stringify(value));
export const exactHostname = host => typeof host === 'string' && host.length <= 253 &&
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host) &&
  !/^[0-9.]+$/.test(host) && /\.[a-z]{2,63}$/.test(host);
const csv = value => '"' + String(value ?? '').replace(/^[=+@\-\t\r]/, s => "'" + s).replaceAll('"', '""') + '"';

export function buildCdnCatalog(baseline, researchCatalog) {
  const entries = [];
  const existingHosts = new Set();
  const researchSignals = researchCatalog.vendors.flatMap(vendor => vendor.browserSignals);
  for (const vendor of baseline.vendors) for (const rule of vendor.resourceRules) {
    const m = rule.matcher;
    const hosts = m.hostExact ? [m.hostExact] : m.hostGroup === 'forter-cloudfront-connect-v1' ? baseline.forterPolicy.connectHosts :
      m.hostGroup === 'forter-cloudfront-script-v1' ? baseline.forterPolicy.scriptHosts : ['{tenant?}.cdn{0-999?}.forter.com'];
    for (const host of hosts) {
      if (exactHostname(host)) existingHosts.add(host);
      const sourceUrls = m.hostGroup ? ['https://developer.computop.com/display/EN/Forter'] : [...new Set(researchSignals
        .filter(signal => signal.host === host && (signal.path === m.pathExact || (!m.pathExact && signal.pathMatch === 'template')))
        .flatMap(signal => signal.sourceUrls ?? []))].sort();
      entries.push({ id: 'existing-' + rule.id + '-' + digest(host).slice(0, 8), vendorId: vendor.id,
        host, hostMatch: exactHostname(host) ? 'exact' : 'template', path: m.pathExact ?? m.pathTemplate ?? null,
        pathMatch: m.pathExact ? 'exact' : m.pathTemplate ? 'runtime-template-id' : 'unspecified',
        role: m.resourceType === 'script' || m.hostGroup === 'forter-cloudfront-script-v1' ? 'loader' : 'browser-resource',
        resourceTypes: m.resourceTypes ?? [m.resourceType], lifecycle: 'current', environment: 'documented-deployment',
        sharedHost: ['www.google.com', 'www.recaptcha.net', 'cdn.jsdelivr.net', 'o.alicdn.com'].includes(host),
        productRelation: 'tracked-product', runtimeStatus: 'already-present', runtimeRuleId: rule.id,
        sourceUrls, sourceEvidence: sourceUrls.length ? 'existing-research-and-runtime' : 'runtime-baseline-only',
        sourceAccessedAt: rule.sourceAccessedAt, reviewDueAt: rule.reviewDueAt,
        requiresCorroboration: false, note: 'Существующее правило: условия полностью сохранены в runtimeMatcher.',
        runtimeMatcher: clone(m),
      });
    }
  }
  for (const group of sourceGroups) for (const [host, role, path, resourceTypes, options = {}] of group.rows) {
    const hostMatch = role === 'domain-family' ? 'domain-family' : host.startsWith('*.') ? 'namespace' : host.includes('{') ? 'template' : 'exact';
    const pathMatch = options.pathMatch ?? (path === null ? 'unspecified' : 'exact');
    const record = { vendorId: group.vendorId, host, hostMatch, path, pathMatch, role, resourceTypes,
      lifecycle: 'current', environment: 'documented-deployment', sharedHost: false, productRelation: 'tracked-product',
      runtimeStatus: 'candidate', productionEnabled: false, fixtureVerified: false, requiresCorroboration: true,
      resourceTypesStatus: 'proposed-from-documentation-not-browser-tested',
      sourceUrls: [group.url], sourceEvidence: 'primary-documentation', sourceAccessedAt: group.accessedAt ?? accessedAt, reviewDueAt,
      sourceCheckStatus: group.recheckStatus ?? 'checked-2026-10-10',
      note: '', ...options };
    record.id = 'cdn-' + group.vendorId + '-' + digest(JSON.stringify([host, role, path, resourceTypes])).slice(0, 12);
    record.newExactHost = hostMatch === 'exact' && !existingHosts.has(host);
    entries.push(record);
  }
  for (const row of entries) row.vendorName = baseline.vendors.find(v => v.id === row.vendorId)?.name;
  entries.sort((a, b) => compare(a.vendorId, b.vendorId) || compare(a.host, b.host) || compare(a.path ?? '', b.path ?? '') || compare(a.id, b.id));
  const candidates = entries.filter(row => row.runtimeStatus === 'candidate');
  const unique = (rows, predicate = () => true) => [...new Set(rows.filter(predicate).map(row => row.host))].sort();
  const sources = [...new Map(sourceGroups.map(group => [group.url, { url: group.url, title: group.title, accessedAt: group.accessedAt ?? accessedAt,
    recheckStatus: group.recheckStatus ?? 'checked-2026-10-10',
    vendorIds: [...new Set(sourceGroups.filter(other => other.url === group.url).map(other => other.vendorId))].sort() }])).values()];
  const totals = {
    trackedProducts: baseline.vendors.length, existingRuntimeRules: baseline.vendors.reduce((n, v) => n + v.resourceRules.length, 0),
    records: entries.length, existingRecords: entries.length - candidates.length, candidateRecords: candidates.length,
    exactHosts: unique(entries, row => row.hostMatch === 'exact').length,
    newExactHosts: unique(candidates, row => row.newExactHost).length,
    newCurrentExactHosts: unique(candidates, row => row.newExactHost && row.lifecycle === 'current').length,
    namespaceOrTemplateCandidates: candidates.filter(row => ['namespace', 'template'].includes(row.hostMatch)).length,
    domainFamilies: candidates.filter(row => row.hostMatch === 'domain-family').length,
    retiredRecords: candidates.filter(row => row.lifecycle === 'retired').length,
    productsWithCandidates: new Set(candidates.map(row => row.vendorId)).size,
    newPrimarySources: sources.length,
  };
  const vendors = baseline.vendors.map(v => ({ id: v.id, name: v.name,
    existingRules: v.resourceRules.length,
    candidateRecords: candidates.filter(row => row.vendorId === v.id).length,
    researchStatus: candidates.some(row => row.vendorId === v.id) ? 'additional-published-resources' : 'existing-resources-only',
  })).sort((a, b) => compare(a.name, b.name));
  return { schemaVersion: 1, catalogVersion: 'cdn-2026-10-10.1', generatedForVersion: '1.1.0',
    date: accessedAt, researchOnly: true, productionEnabled: false, fixtureVerified: false,
    scope: 'Public browser integration domains for the 32 products already present in the shipped resource matcher.',
    ownershipMeaning: 'Documented use by the integration; not a claim of legal ownership of CDN infrastructure.',
    runtimeBaseline: { path: RESEARCH + '/runtime-baseline.json', backgroundSha256: baseline.backgroundSha256, capturedAt: baseline.capturedAt },
    sources, totals, vendors, entries, exclusions,
  };
}

export function validateCdnCatalog(catalog) {
  const errors = [], seen = new Set();
  if (catalog.researchOnly !== true || catalog.productionEnabled !== false || catalog.fixtureVerified !== false) errors.push('research-gate');
  if (!Array.isArray(catalog.vendors) || catalog.vendors.length !== 32) errors.push('tracked-product-scope');
  const ids = new Set((catalog.vendors ?? []).map(v => v.id));
  const sourceUrls = new Set((catalog.sources ?? []).map(s => s.url));
  const candidateKey = row => JSON.stringify([row.vendorId, row.host, row.role, row.path, row.resourceTypes]);
  const published = new Map(sourceGroups.flatMap(group => group.rows.map(([host, role, path, resourceTypes, options = {}]) => [
    candidateKey({ vendorId: group.vendorId, host, role, path, resourceTypes }), { sourceUrl: group.url,
      lifecycle: options.lifecycle ?? 'current', productRelation: options.productRelation ?? 'tracked-product', sharedHost: options.sharedHost ?? false },
  ])));
  for (const row of catalog.entries ?? []) {
    if (seen.has(row.id)) errors.push('duplicate-id'); seen.add(row.id);
    if (!ids.has(row.vendorId)) errors.push('unknown-product');
    if (row.hostMatch === 'exact' && !exactHostname(row.host)) errors.push('invalid-exact-host');
    if (!['exact', 'namespace', 'template', 'domain-family'].includes(row.hostMatch)) errors.push('host-match');
    if (row.hostMatch === 'domain-family' && (row.role !== 'domain-family' || !exactHostname(row.host))) errors.push('invalid-domain-family');
    if (row.hostMatch === 'namespace' && (!row.host.startsWith('*.') || !exactHostname(row.host.slice(2)))) errors.push('invalid-namespace');
    if (row.path !== null && (typeof row.path !== 'string' || /[\r\n?#]/.test(row.path))) errors.push('path');
    if (!Array.isArray(row.resourceTypes) || row.resourceTypes.some(type => !['script', 'sub_frame', 'xmlhttprequest', 'image', 'ping', 'other'].includes(type))) errors.push('resource-type');
    if (row.runtimeStatus === 'candidate') {
      const definition = published.get(candidateKey(row));
      if (!definition || row.sourceUrls?.length !== 1 || row.sourceUrls[0] !== definition.sourceUrl ||
          row.lifecycle !== definition.lifecycle || row.productRelation !== definition.productRelation || row.sharedHost !== definition.sharedHost) errors.push('unpublished-candidate-binding');
      if (row.productionEnabled !== false || row.fixtureVerified !== false || row.requiresCorroboration !== true) errors.push('candidate-gate');
      if (row.sourceEvidence !== 'primary-documentation' || !row.sourceUrls.length || row.sourceUrls.some(url => !sourceUrls.has(url))) errors.push('missing-primary-source');
      if (!['current', 'legacy', 'retired'].includes(row.lifecycle)) errors.push('lifecycle');
      if (!Number.isFinite(Date.parse(row.sourceAccessedAt)) || !(Date.parse(row.reviewDueAt) > Date.parse(row.sourceAccessedAt))) errors.push('review-window');
    } else if (row.runtimeStatus !== 'already-present' || !row.runtimeMatcher || !row.runtimeRuleId) errors.push('baseline-rule');
  }
  for (const source of catalog.sources ?? []) {
    try { const url = new URL(source.url); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) errors.push('source-url'); }
    catch { errors.push('source-url'); }
  }
  return [...new Set(errors)];
}

export function attachShodanResults(catalog, report) {
  const eligible = new Set(toShodanCatalog(catalog).vendors.flatMap(v => v.browserSignals.map(s => s.host)));
  if (report.catalogVersion !== catalog.catalogVersion || report.source?.provider !== 'Shodan' || report.source?.operation !== 'host-count' ||
      !Array.isArray(report.entries) || report.entries.length > 100 || !Number.isFinite(Date.parse(report.generatedAt))) throw Error('invalid-cdn-count-report');
  const byHost = new Map();
  for (const row of report.entries) {
    if (!eligible.has(row.host) || byHost.has(row.host) || row.status === 'ok' && (!Number.isSafeInteger(row.count) || row.count < 0)) throw Error('invalid-cdn-count-report');
    byHost.set(row.host, row);
  }
  for (const row of catalog.entries) {
    const observed = row.hostMatch === 'exact' ? byHost.get(row.host) : undefined;
    row.shodanIndexStatus = !observed ? 'not-selected' : observed.status === 'ok' ? 'ok' : 'not-available';
    row.shodanIndexCount = observed?.status === 'ok' ? observed.count : null;
  }
  catalog.shodan = { reportPath: RESEARCH + '/shodan-counts.json', generatedAt: report.generatedAt,
    queries: report.entries.length, successful: report.entries.filter(row => row.status === 'ok').length,
    nonzero: report.entries.filter(row => row.status === 'ok' && row.count > 0).length,
    interpretation: 'Hostname index counts only. They do not change attribution, lifecycle or runtime status.' };
  return catalog;
}

// Count only published exact browser hosts. Root domain families, shared hosts
// without a qualified path, retired entries and tenant templates are not queries.
export function toShodanCatalog(catalog) {
  if (validateCdnCatalog(catalog).length) throw Error('invalid-cdn-catalog');
  const rows = catalog.entries.filter(row => row.runtimeStatus === 'candidate' && row.hostMatch === 'exact' &&
    row.lifecycle !== 'retired' && row.role !== 'domain-family' && (!row.sharedHost || row.path));
  return { schemaVersion: 1, catalogVersion: catalog.catalogVersion, researchOnly: true, productionEnabled: false, fixtureVerified: false,
    vendors: catalog.vendors.map(v => {
      const signals = rows.filter(row => row.vendorId === v.id);
      return { id: v.id, sources: [...new Set(signals.flatMap(row => row.sourceUrls))].map(url => ({ url })),
        browserSignals: signals.map(row => ({ id: row.id, host: row.host, kind: row.role, sourceUrls: row.sourceUrls,
          status: 'documented-candidate', productionEnabled: false, fixtureVerified: false })) };
    }),
  };
}

export function renderCsv(catalog) {
  const keys = ['vendorId', 'vendorName', 'host', 'hostMatch', 'path', 'pathMatch', 'role', 'resourceTypes', 'lifecycle', 'environment', 'runtimeStatus', 'newExactHost', 'sharedHost', 'productRelation', 'sourceEvidence', 'sourceUrls', 'sourceAccessedAt', 'sourceCheckStatus', 'reviewDueAt', 'runtimeRuleId', 'shodanIndexStatus', 'shodanIndexCount', 'note'];
  return '\uFEFF' + [keys, ...catalog.entries.map(row => keys.map(key => Array.isArray(row[key]) ? row[key].join(' | ') : row[key]))].map(row => row.map(csv).join(',')).join('\r\n') + '\r\n';
}

export function renderReadme(catalog) {
  const t = catalog.totals;
  const lines = ['# CDN и браузерные ресурсы антифрод-систем', '',
    'Дата: ' + catalog.date + '. Область: **' + t.trackedProducts + ' продукта, которые расширение уже распознаёт**.', '',
    `В базе ${t.records} записей: ${t.existingRecords} ресурсных записей из ${t.existingRuntimeRules} действующих правил и ${t.candidateRecords} новых кандидатов. Всего ${t.exactHosts} уникальных точных hostname. Добавлено ${t.newExactHosts} ранее не покрытых точных hostname, из них ${t.newCurrentExactHosts} отмечены как текущие, остальные относятся к legacy/retired. Дополнительно ${t.namespaceOrTemplateCandidates} опубликованных namespace/template, ${t.domainFamilies} доменных семейства без конкретного browser hostname и ${t.newPrimarySources} первичных источников.`, '',
    'Новые записи собраны для следующего расширения детектора. Они не активируют правила в Chrome/Firefox. Существующие правила перечислены как `already-present`; новые — `candidate`. Для включения кандидата нужны конкретные условия browser resource match и положительные/отрицательные fixtures. Данные Shodan не меняют статус правила.', '',
    '- [Полная база JSON](../../data/antifraud-cdn.v1.json)',
    '- [Таблица всех адресов CSV](../../data/antifraud-cdn.csv)',
    '- [Новые источники и записи](../../../../scripts/research/antifraud-cdn-sources.mjs)',
    '- [План Shodan](shodan-plan.json)',
    '- [Фактический результат Shodan](shodan-counts.json)', '',
    '## Продукты и дополнительные адреса', '', '| Система | Действующих правил | Новых записей | Новые точные hostname |', '|---|---:|---:|---|'];
  for (const v of catalog.vendors) {
    const hosts = [...new Set(catalog.entries.filter(e => e.vendorId === v.id && e.newExactHost).map(e => '`' + e.host + '`' + (e.lifecycle !== 'current' ? ' (' + e.lifecycle + ')' : '')))];
    lines.push(`| ${v.name} | ${v.existingRules} | ${v.candidateRecords} | ${hosts.join(', ') || '—'} |`);
  }
  lines.push('', '## Как использовать', '',
    'Для shared CDN проверять hostname вместе с путём: например, `www.gstatic.com` + `/recaptcha/`. Для Forter сохранён точный список 15 CloudFront distributions из предыдущего исправления. Wildcard `*.cloudfront.net` не используется. Поле `role` различает загрузчик/CDN, iframe CAPTCHA, pixel, collector и resolver; collector не называется CDN.', '',
    'Шаблоны с `{company}`/`{customer}` и `*.` — опубликованные форматы, а не найденные или проверенные развёртывания. `productRelation` отделяет связь с документируемым продуктом от соседнего продукта. У кандидатов `resourceTypes` — предлагаемые типы matcher из CSP/интеграций, а не наблюдённые browser requests. В шести retired-записях Tencent отражено официальное прекращение использования 2023-08-21. Их не включать как действующие CDN.', '',
    'Для baseline-записей исходные условия находятся в `runtimeMatcher`; идентификатор `pathTemplate` не является строкой URL. `sourceEvidence=runtime-baseline-only` означает, что правило перенесено из текущего кода без новой проверки его первичного источника. Даты прежних правил сохранены. Страница legacy SEON была недоступна при повторной проверке 2026-10-10: использованы проверенные записи каталога от 2026-10-09, дата и sourceCheckStatus это отражают.', '',
    '## Shodan', '',
    ...(catalog.shodan ? [`Фактический запуск ${catalog.shodan.generatedAt}: **${catalog.shodan.successful}/${catalog.shodan.queries} успешных запросов, ${catalog.shodan.nonzero} ненулевых count**. Значения присоединены к JSON/CSV по точному hostname в полях shodanIndexStatus и shodanIndexCount.`, ''] : []),
    'Выполняется только `/shodan/host/count` для точных опубликованных browser hostname из кандидатов. Сохраняется сводный count и HTTP-статус; IP, порты, баннеры, facets и ключ в файл не попадают. Нулевой count означает отсутствие совпадения в индексе, а не неработающий CDN. Ненулевой count не устанавливает владельца, путь ресурса или использование антифрода сайтом. [Документация Shodan](https://developer.shodan.io/api).', '',
    '```powershell', 'node scripts/antifraud-cdn-catalog.mjs --check', 'node scripts/shodan-cdn-counts.mjs --plan', '# --run читает SHODAN_API_KEY; --run --stdin-key принимает ключ через stdin.', '```', '',
    '## Первичные источники', '');
  for (const s of catalog.sources) lines.push('- [' + s.title + '](' + s.url + ') — проверено ' + s.accessedAt + (s.recheckStatus.startsWith('unavailable') ? '; повторная проверка 2026-10-10: страница недоступна' : '') + '.');
  return lines.join('\n') + '\n';
}

export function generate({ check = false } = {}) {
  const baseline = JSON.parse(readFileSync(resolve(ROOT, RESEARCH, 'runtime-baseline.json'), 'utf8'));
  const research = JSON.parse(readFileSync(resolve(ROOT, 'packages/catalog/data/antifraud.v1.json'), 'utf8'));
  const catalog = buildCdnCatalog(baseline, research), errors = validateCdnCatalog(catalog);
  if (errors.length) throw Error('invalid-cdn-catalog: ' + errors.join(', '));
  const countsPath = resolve(ROOT, RESEARCH, 'shodan-counts.json');
  if (existsSync(countsPath)) attachShodanResults(catalog, JSON.parse(readFileSync(countsPath, 'utf8')));
  const artifacts = new Map([[OUTPUT, JSON.stringify(catalog, null, 2) + '\n'],
    ['packages/catalog/data/antifraud-cdn.csv', renderCsv(catalog)], [RESEARCH + '/README.md', renderReadme(catalog)]]);
  for (const [file, content] of artifacts) {
    if (check) { if (!existsSync(resolve(ROOT, file)) || readFileSync(resolve(ROOT, file), 'utf8') !== content) throw Error('stale-cdn-artifact: ' + file); }
    else { mkdirSync(resolve(ROOT, file, '..'), { recursive: true }); writeFileSync(resolve(ROOT, file), content, 'utf8'); }
  }
  return catalog;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== '--check')) throw Error('invalid-options');
  const result = generate({ check: process.argv.includes('--check') });
  console.log('Antifraud CDN catalog: ' + JSON.stringify(result.totals));
}
