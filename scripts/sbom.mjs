// P10 / ADR-002 / ADR-016: offline inventory; no package execution or registry queries.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (base, path) => readFileSync(join(base, path), 'utf8');

// Deliberately support only the registry-integrity package records in our pinned pnpm v9 format.
// Fail closed on a new format/resolution instead of silently dropping a dependency.
export function parseLockedPackages(text) {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  if (!lines.includes("lockfileVersion: '9.0'")) throw new Error('Unsupported lockfile version');
  const start = lines.indexOf('packages:');
  const end = lines.indexOf('snapshots:');
  if (start < 0 || end <= start) throw new Error('Missing lockfile sections');
  const packages = [];
  for (const line of lines.slice(start + 1, end)) {
    if (/^  \S/.test(line)) {
      const key = /^  (?:'([^']+)'|([^'\s]+)):$/.exec(line);
      const id = key?.[1] ?? key?.[2];
      const match = id && /^(@?[^@]+)@([^@]+)$/.exec(id);
      if (!match || packages.some((p) => p.name === match[1] && p.version === match[2])) throw new Error('Invalid/duplicate package: ' + line);
      packages.push({ name: match[1], version: match[2] });
    } else if (/^    resolution:/.test(line)) {
      const match = /^    resolution: \{integrity: (sha512-[A-Za-z0-9+/]+={0,2})\}$/.exec(line);
      const current = packages.at(-1);
      if (!match || !current || current.integrity) throw new Error('Unsupported package resolution: ' + line);
      current.integrity = match[1];
    }
  }
  if (!packages.length || packages.some((p) => !p.integrity)) throw new Error('Missing package integrity');
  return packages.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1);
}

export function assertBundledDependencies(inputs) {
  for (const input of Object.keys(inputs)) {
    const normalized = input.replaceAll('\\', '/');
    if (!normalized.includes('node_modules/')) continue;
    const packagePath = normalized.slice(normalized.lastIndexOf('node_modules/') + 13);
    if (!packagePath.startsWith('preact/')) throw new Error('Dependency missing from release inventory: ' + input);
  }
}

function installedPackages(base) {
  const installed = new Map();
  const store = join(base, 'node_modules/.pnpm');
  for (const folder of readdirSync(store).sort()) {
    const modules = join(store, folder, 'node_modules');
    if (!existsSync(modules)) continue;
    for (const name of readdirSync(modules).sort()) {
      const names = name.startsWith('@') ? readdirSync(join(modules, name)).map((child) => name + '/' + child) : [name];
      for (const packageName of names) {
        const manifest = join(modules, packageName, 'package.json');
        if (!existsSync(manifest)) continue;
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type;
        installed.set(pkg.name + '@' + pkg.version, { license: license || 'NOASSERTION' });
      }
    }
  }
  return installed;
}

export function generateArtifacts(base = root) {
  const lock = readFileSync(join(base, 'pnpm-lock.yaml'));
  const installed = installedPackages(base);
  const components = parseLockedPackages(lock.toString('utf8')).map((pkg) => {
    const metadata = installed.get(pkg.name + '@' + pkg.version);
    return { type: 'library', name: pkg.name, version: pkg.version,
      scope: pkg.name === 'preact' ? 'bundled' : 'development',
      license: metadata?.license ?? 'NOASSERTION',
      licenseEvidence: metadata ? 'installed-package.json' : 'not-installed-on-this-platform',
      resolved: { integrity: pkg.integrity } };
  });
  const preact = components.filter((p) => p.scope === 'bundled');
  if (preact.length !== 1 || preact[0].license !== 'MIT') throw new Error('Expected one installed MIT Preact version');
  const preactManifest = JSON.parse(read(base, 'node_modules/preact/package.json'));
  if (preactManifest.version !== preact[0].version) throw new Error('Installed Preact differs from lockfile');
  const psl = readFileSync(join(base, 'packages/attribution/data/public_suffix_list.dat'));
  const logo = readFileSync(join(base, 'logo.svg'));
  components.push({ type: 'data', name: 'Public Suffix List', version: /\/\/ VERSION: (.+)/.exec(psl.toString())?.[1]?.trim() ?? 'unknown',
    scope: 'bundled', license: 'MPL-2.0', licenseEvidence: 'packages/attribution/data/PSL-LICENSE.txt',
    resolved: { integrity: 'sha256-' + sha256(psl) }, source: 'packages/attribution/data/public_suffix_list.dat' },
  { type: 'file', name: 'detect.expert logo', version: 'sha256:' + sha256(logo), scope: 'bundled', license: 'NOASSERTION',
    licenseEvidence: 'Название и логотип остаются за автором; MIT распространяется на исходный код',
    resolved: { integrity: 'sha256-' + sha256(logo) }, source: 'logo.svg' });
  const sbom = { format: 'detect.expert-cyclonedx-like', specVersion: '1',
    metadata: { lockfileSha256: sha256(lock),
      licenseFiles: ['node_modules/preact/LICENSE', 'packages/attribution/data/PSL-LICENSE.txt'].map((path) => ({ path, sha256: sha256(readFileSync(join(base, path))) })),
      licenseSource: 'Локальные package.json; отсутствующие platform optional packages — NOASSERTION; сеть не используется.' }, components };
  const table = (items) => '| Компонент | Версия | Лицензия | Источник лицензии |\n| --- | --- | --- | --- |\n' + items.map((p) => `| ${p.name} | ${p.version} | ${p.license.replaceAll('|', '\\|')} | ${p.licenseEvidence} |`).join('\n');
  const licenses = '# Лицензии релиза\n\nP10 · ADR-002 · ADR-016. Генератор: `pnpm sbom`. Полные integrity — в `sbom.json`.\n\n' +
    '## Встроенные компоненты\n\nPreact — основная внешняя JS-библиотека в бандлах (объявлена в devDependencies); protobuf-es вшит дополнительно, см. ниже. PSL встроен как данные; PNG-иконки получены из logo.svg. NOTICE и исходный PSL с лицензией включаются в пакет.\n\n' +
    table(components.filter((p) => p.scope === 'bundled')) + '\n\n' + '## Дополнительные компоненты и данные\n\nЭти компоненты не входят в таблицу выше и не имеют записи в sbom.json; тексты лицензий лежат рядом с данными.\n\n- protobuf-es (@bufbuild/protobuf 2.15.0), Apache-2.0 и BSD-3-Clause; вшит в popup.js и sidepanel.js. Тексты: apps/production-extension/NOTICE.\n- Open Cookie Database, Apache-2.0. Тексты: apps/production-extension/COOKIE-CATALOG-LICENSE.txt, COOKIE-CATALOG-NOTICE.txt, packages/catalog/research/cookies-2026-10/LICENSE.\n- cookie-audit и CookieBlock, MIT. Тексты: packages/catalog/research/cookies-2026-10/cookie-audit-LICENSE, cookieblock-LICENSE, cookieblock-src-LICENSE.\n- Декларации cookie из публичного списка IAB Europe (GVL): отдельная открытая лицензия на список не заявлена. В репозитории хранятся только производные правила каталога (packages/catalog/data/cookies.v1.json); исходные снимки не публикуются, их хеши записаны в packages/catalog/research/cookies-2026-10/PUBLIC-SNAPSHOTS.json.\n- flag-icons, MIT. Тексты: apps/production-extension/icons/countries/LICENSE.txt, NOTICE.txt.\n- Font Awesome Free 6.7.2, CC BY 4.0. Текст: apps/production-extension/icons/brands/FONT-AWESOME-LICENSE.txt.\n- Simple Icons, CC0-1.0. Тексты: apps/production-extension/icons/brands/SIMPLE-ICONS-7cdc8ac6-LICENSE.txt, SIMPLE-ICONS-ac1bf3df-LICENSE.txt.\n- Chrome UX Report (Google) через Internet Health Report: списки популярных сайтов по странам, CC BY 4.0. Текст: apps/production-extension/autosurf-sites-LICENSE.txt.\n- tzdata (общественное достояние) и региональные данные CLDR. Описание: apps/production-extension/REGION-DATA-NOTICE.txt, packages/catalog/data/tzdata/SOURCE.md.\n- Логотипы и значки сторонних компаний (icons/brands, icons/systems): права принадлежат их владельцам. Происхождение: apps/production-extension/icons/brands/COMPANY-ARTWORK-NOTICE.txt, COMPANY-PROVENANCE.json, icons/systems/PROVENANCE.json.\n\nAutosurfer site catalogue: apps/production-extension/autosurf-sites-data.js and packages/catalog/data/autosurf-sites.* are data, not code. The MIT license covers the source code; the catalogue data keeps its own status (the source record marks it as "Proprietary") and is included in this repository with the permission of the rights holder.' + '\n\n## Зависимости разработки (включая транзитивные и platform optional)\n\nНе входят в расширение. NOASSERTION означает отсутствие локального подтверждения лицензии; лицензии не выводятся по аналогии с соседней платформой. Состав этой таблицы определяется всем lockfile, сведения о лицензиях — установленными node_modules.\n\n' + table(components.filter((p) => p.scope === 'development')) + '\n';
  const notice = 'detect.expert — уведомления о встроенных компонентах (P10, ADR-002/016)\n\n' +
    'Собственный код detect.expert распространяется по лицензии MIT (файл LICENSE). Ниже — лицензии сторонних компонентов.\n\n' +
    'Preact ' + preact[0].version + ' — MIT\n\n' + read(base, 'node_modules/preact/LICENSE').trim() + '\n\n' +
    'Public Suffix List — MPL-2.0. Исходный снимок без изменений: third-party/public_suffix_list.dat в пакете; в репозитории: packages/attribution/data/public_suffix_list.dat. Источник и дата: packages/attribution/data/SOURCE.md. Полный текст лицензии: third-party/PSL-LICENSE.txt в пакете.\n\n' +
    'Detect.Expert logo: logo.svg and the derived icons/*.png. Logos and marks of third-party companies belong to their owners and are used only to identify services; the MIT license covers the source code, while the Detect.Expert name and logo remain with the author. The Preact and PSL licenses do not extend to the logo or to the project code.\n\nAutosurfer site catalogue: apps/production-extension/autosurf-sites-data.js and packages/catalog/data/autosurf-sites.* are data, not code. The MIT license covers the source code; the catalogue data keeps its own status (the source record marks it as "Proprietary") and is included in this repository with the permission of the rights holder.\n\nДополнительные компоненты и данные (тексты лицензий лежат рядом с данными):\n- protobuf-es (@bufbuild/protobuf 2.15.0), Apache-2.0 и BSD-3-Clause; вшит в popup.js и sidepanel.js. Тексты: apps/production-extension/NOTICE.\n- Open Cookie Database, Apache-2.0. Тексты: apps/production-extension/COOKIE-CATALOG-LICENSE.txt, COOKIE-CATALOG-NOTICE.txt, packages/catalog/research/cookies-2026-10/LICENSE.\n- cookie-audit и CookieBlock, MIT. Тексты: packages/catalog/research/cookies-2026-10/cookie-audit-LICENSE, cookieblock-LICENSE, cookieblock-src-LICENSE.\n- Декларации cookie из публичного списка IAB Europe (GVL): отдельная открытая лицензия на список не заявлена. В репозитории хранятся только производные правила каталога (packages/catalog/data/cookies.v1.json); исходные снимки не публикуются, их хеши записаны в packages/catalog/research/cookies-2026-10/PUBLIC-SNAPSHOTS.json.\n- flag-icons, MIT. Тексты: apps/production-extension/icons/countries/LICENSE.txt, NOTICE.txt.\n- Font Awesome Free 6.7.2, CC BY 4.0. Текст: apps/production-extension/icons/brands/FONT-AWESOME-LICENSE.txt.\n- Simple Icons, CC0-1.0. Тексты: apps/production-extension/icons/brands/SIMPLE-ICONS-7cdc8ac6-LICENSE.txt, SIMPLE-ICONS-ac1bf3df-LICENSE.txt.\n- Chrome UX Report (Google) через Internet Health Report: списки популярных сайтов по странам, CC BY 4.0. Текст: apps/production-extension/autosurf-sites-LICENSE.txt.\n- tzdata (общественное достояние) и региональные данные CLDR. Описание: apps/production-extension/REGION-DATA-NOTICE.txt, packages/catalog/data/tzdata/SOURCE.md.\n- Логотипы и значки сторонних компаний (icons/brands, icons/systems): права принадлежат их владельцам. Происхождение: apps/production-extension/icons/brands/COMPANY-ARTWORK-NOTICE.txt, COMPANY-PROVENANCE.json, icons/systems/PROVENANCE.json.\n';
  return { 'docs/release/sbom.json': JSON.stringify(sbom, null, 2) + '\n', 'docs/release/licenses.md': licenses, NOTICE: notice };
}

export function verifySbom(base = root) {
  const current = JSON.parse(read(base, 'docs/release/sbom.json'));
  if (current.metadata?.lockfileSha256 !== sha256(readFileSync(join(base, 'pnpm-lock.yaml')))) throw new Error('SBOM lockfile hash mismatch; run pnpm sbom');
  for (const [path, expected] of Object.entries(generateArtifacts(base))) {
    if (!existsSync(join(base, path)) || read(base, path) !== expected) throw new Error('Stale release inventory: ' + path + '; run pnpm sbom');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Usage: node scripts/sbom.mjs [--check]');
    if (process.argv.includes('--check')) verifySbom();
    else for (const [path, content] of Object.entries(generateArtifacts())) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    console.log('sbom: OK (' + (process.argv.includes('--check') ? 'verified' : 'generated') + ')');
  } catch (error) { console.error('sbom: ' + error.message); process.exitCode = 1; }
}
