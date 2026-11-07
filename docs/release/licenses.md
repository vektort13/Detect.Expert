# Лицензии релиза

P10 · ADR-002 · ADR-016. Генератор: `pnpm sbom`. Полные integrity — в `sbom.json`.

## Встроенные компоненты

Preact — основная внешняя JS-библиотека в бандлах (объявлена в devDependencies); protobuf-es вшит дополнительно, см. ниже. PSL встроен как данные; PNG-иконки получены из logo.svg. NOTICE и исходный PSL с лицензией включаются в пакет.

| Компонент | Версия | Лицензия | Источник лицензии |
| --- | --- | --- | --- |
| preact | 10.29.8 | MIT | installed-package.json |
| Public Suffix List | 2026-09-08_12-18-37_UTC | MPL-2.0 | packages/attribution/data/PSL-LICENSE.txt |
| detect.expert logo | sha256:dc4c8743bd695838a866adcba8021b2d2f491f0b14e3da2e2f6293054da63a46 | NOASSERTION | Название и логотип остаются за автором; MIT распространяется на исходный код |

## Дополнительные компоненты и данные

Эти компоненты не входят в таблицу выше и не имеют записи в sbom.json; тексты лицензий лежат рядом с данными.

- protobuf-es (@bufbuild/protobuf 2.15.0), Apache-2.0 и BSD-3-Clause; вшит в popup.js и sidepanel.js. Тексты: apps/production-extension/NOTICE.
- Open Cookie Database, Apache-2.0. Тексты: apps/production-extension/COOKIE-CATALOG-LICENSE.txt, COOKIE-CATALOG-NOTICE.txt, packages/catalog/research/cookies-2026-10/LICENSE.
- cookie-audit и CookieBlock, MIT. Тексты: packages/catalog/research/cookies-2026-10/cookie-audit-LICENSE, cookieblock-LICENSE, cookieblock-src-LICENSE.
- Декларации cookie из публичного списка IAB Europe (GVL): отдельная открытая лицензия на список не заявлена. В репозитории хранятся только производные правила каталога (packages/catalog/data/cookies.v1.json); исходные снимки не публикуются, их хеши записаны в packages/catalog/research/cookies-2026-10/PUBLIC-SNAPSHOTS.json.
- flag-icons, MIT. Тексты: apps/production-extension/icons/countries/LICENSE.txt, NOTICE.txt.
- Font Awesome Free 6.7.2, CC BY 4.0. Текст: apps/production-extension/icons/brands/FONT-AWESOME-LICENSE.txt.
- Simple Icons, CC0-1.0. Тексты: apps/production-extension/icons/brands/SIMPLE-ICONS-7cdc8ac6-LICENSE.txt, SIMPLE-ICONS-ac1bf3df-LICENSE.txt.
- Chrome UX Report (Google) через Internet Health Report: списки популярных сайтов по странам, CC BY 4.0. Текст: apps/production-extension/autosurf-sites-LICENSE.txt.
- tzdata (общественное достояние) и региональные данные CLDR. Описание: apps/production-extension/REGION-DATA-NOTICE.txt, packages/catalog/data/tzdata/SOURCE.md.
- Логотипы и значки сторонних компаний (icons/brands, icons/systems): права принадлежат их владельцам. Происхождение: apps/production-extension/icons/brands/COMPANY-ARTWORK-NOTICE.txt, COMPANY-PROVENANCE.json, icons/systems/PROVENANCE.json.

Autosurfer site catalogue: apps/production-extension/autosurf-sites-data.js and packages/catalog/data/autosurf-sites.* are data, not code. The MIT license covers the source code; the catalogue data keeps its own status (the source record marks it as "Proprietary") and is included in this repository with the permission of the rights holder.

## Зависимости разработки (включая транзитивные и platform optional)

Не входят в расширение. NOASSERTION означает отсутствие локального подтверждения лицензии; лицензии не выводятся по аналогии с соседней платформой. Состав этой таблицы определяется всем lockfile, сведения о лицензиях — установленными node_modules.

| Компонент | Версия | Лицензия | Источник лицензии |
| --- | --- | --- | --- |
| @esbuild/aix-ppc64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/android-arm | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/android-arm64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/android-x64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/darwin-arm64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/darwin-x64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/freebsd-arm64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/freebsd-x64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/linux-arm | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/linux-arm64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/linux-ia32 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/linux-loong64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/linux-mips64el | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/linux-ppc64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/linux-riscv64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/linux-s390x | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/linux-x64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/netbsd-arm64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/netbsd-x64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/openbsd-arm64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/openbsd-x64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/openharmony-arm64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/sunos-x64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/win32-arm64 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/win32-ia32 | 0.28.2 | NOASSERTION | not-installed-on-this-platform |
| @esbuild/win32-x64 | 0.28.2 | MIT | installed-package.json |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | installed-package.json |
| @oxc-project/types | 0.149.0 | MIT | installed-package.json |
| @playwright/test | 1.63.0 | Apache-2.0 | installed-package.json |
| @resvg/resvg-js | 2.6.2 | MPL-2.0 | installed-package.json |
| @resvg/resvg-js-android-arm-eabi | 2.6.2 | NOASSERTION | not-installed-on-this-platform |
| @resvg/resvg-js-android-arm64 | 2.6.2 | NOASSERTION | not-installed-on-this-platform |
| @resvg/resvg-js-darwin-arm64 | 2.6.2 | NOASSERTION | not-installed-on-this-platform |
| @resvg/resvg-js-darwin-x64 | 2.6.2 | NOASSERTION | not-installed-on-this-platform |
| @resvg/resvg-js-linux-arm-gnueabihf | 2.6.2 | NOASSERTION | not-installed-on-this-platform |
| @resvg/resvg-js-linux-arm64-gnu | 2.6.2 | NOASSERTION | not-installed-on-this-platform |
| @resvg/resvg-js-linux-arm64-musl | 2.6.2 | NOASSERTION | not-installed-on-this-platform |
| @resvg/resvg-js-linux-x64-gnu | 2.6.2 | NOASSERTION | not-installed-on-this-platform |
| @resvg/resvg-js-linux-x64-musl | 2.6.2 | NOASSERTION | not-installed-on-this-platform |
| @resvg/resvg-js-win32-arm64-msvc | 2.6.2 | NOASSERTION | not-installed-on-this-platform |
| @resvg/resvg-js-win32-ia32-msvc | 2.6.2 | NOASSERTION | not-installed-on-this-platform |
| @resvg/resvg-js-win32-x64-msvc | 2.6.2 | MPL-2.0 | installed-package.json |
| @rolldown/binding-android-arm-eabi | 1.2.8 | NOASSERTION | not-installed-on-this-platform |
| @rolldown/binding-android-arm64 | 1.2.8 | NOASSERTION | not-installed-on-this-platform |
| @rolldown/binding-darwin-arm64 | 1.2.8 | NOASSERTION | not-installed-on-this-platform |
| @rolldown/binding-darwin-x64 | 1.2.8 | NOASSERTION | not-installed-on-this-platform |
| @rolldown/binding-freebsd-x64 | 1.2.8 | NOASSERTION | not-installed-on-this-platform |
| @rolldown/binding-linux-arm-gnueabihf | 1.2.8 | NOASSERTION | not-installed-on-this-platform |
| @rolldown/binding-linux-arm64-gnu | 1.2.8 | NOASSERTION | not-installed-on-this-platform |
| @rolldown/binding-linux-arm64-musl | 1.2.8 | NOASSERTION | not-installed-on-this-platform |
| @rolldown/binding-linux-ppc64-gnu | 1.2.8 | NOASSERTION | not-installed-on-this-platform |
| @rolldown/binding-linux-s390x-gnu | 1.2.8 | NOASSERTION | not-installed-on-this-platform |
| @rolldown/binding-linux-x64-gnu | 1.2.8 | NOASSERTION | not-installed-on-this-platform |
| @rolldown/binding-linux-x64-musl | 1.2.8 | NOASSERTION | not-installed-on-this-platform |
| @rolldown/binding-openharmony-arm64 | 1.2.8 | NOASSERTION | not-installed-on-this-platform |
| @rolldown/binding-win32-arm64-msvc | 1.2.8 | NOASSERTION | not-installed-on-this-platform |
| @rolldown/binding-win32-x64-msvc | 1.2.8 | MIT | installed-package.json |
| @rolldown/pluginutils | 1.0.1 | MIT | installed-package.json |
| @standard-schema/spec | 1.1.0 | MIT | installed-package.json |
| @types/chai | 5.2.3 | MIT | installed-package.json |
| @types/chrome | 0.2.9 | MIT | installed-package.json |
| @types/deep-eql | 4.0.2 | MIT | installed-package.json |
| @types/estree | 1.0.9 | MIT | installed-package.json |
| @types/filesystem | 0.0.36 | MIT | installed-package.json |
| @types/filewriter | 0.0.33 | MIT | installed-package.json |
| @types/har-format | 1.2.16 | MIT | installed-package.json |
| @types/node | 24.13.4 | MIT | installed-package.json |
| @typescript/typescript-aix-ppc64 | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-darwin-arm64 | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-darwin-x64 | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-freebsd-arm64 | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-freebsd-x64 | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-linux-arm | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-linux-arm64 | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-linux-loong64 | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-linux-mips64el | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-linux-ppc64 | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-linux-riscv64 | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-linux-s390x | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-linux-x64 | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-netbsd-arm64 | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-netbsd-x64 | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-openbsd-arm64 | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-openbsd-x64 | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-sunos-x64 | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-win32-arm64 | 7.0.2 | NOASSERTION | not-installed-on-this-platform |
| @typescript/typescript-win32-x64 | 7.0.2 | Apache-2.0 | installed-package.json |
| @vitest/expect | 4.1.11 | MIT | installed-package.json |
| @vitest/mocker | 4.1.11 | MIT | installed-package.json |
| @vitest/pretty-format | 4.1.11 | MIT | installed-package.json |
| @vitest/runner | 4.1.11 | MIT | installed-package.json |
| @vitest/snapshot | 4.1.11 | MIT | installed-package.json |
| @vitest/spy | 4.1.11 | MIT | installed-package.json |
| @vitest/utils | 4.1.11 | MIT | installed-package.json |
| ajv | 8.20.0 | MIT | installed-package.json |
| assertion-error | 2.0.1 | MIT | installed-package.json |
| chai | 6.2.2 | MIT | installed-package.json |
| convert-source-map | 2.0.0 | MIT | installed-package.json |
| detect-libc | 2.1.2 | Apache-2.0 | installed-package.json |
| es-module-lexer | 2.3.2 | MIT | installed-package.json |
| esbuild | 0.28.2 | MIT | installed-package.json |
| estree-walker | 3.0.3 | MIT | installed-package.json |
| expect-type | 1.4.0 | Apache-2.0 | installed-package.json |
| fast-deep-equal | 3.1.3 | MIT | installed-package.json |
| fast-uri | 3.1.7 | BSD-3-Clause | installed-package.json |
| fdir | 6.5.0 | MIT | installed-package.json |
| fsevents | 2.3.3 | NOASSERTION | not-installed-on-this-platform |
| json-schema-traverse | 1.0.0 | MIT | installed-package.json |
| lightningcss | 1.33.0 | MPL-2.0 | installed-package.json |
| lightningcss-android-arm64 | 1.33.0 | NOASSERTION | not-installed-on-this-platform |
| lightningcss-darwin-arm64 | 1.33.0 | NOASSERTION | not-installed-on-this-platform |
| lightningcss-darwin-x64 | 1.33.0 | NOASSERTION | not-installed-on-this-platform |
| lightningcss-freebsd-x64 | 1.33.0 | NOASSERTION | not-installed-on-this-platform |
| lightningcss-linux-arm-gnueabihf | 1.33.0 | NOASSERTION | not-installed-on-this-platform |
| lightningcss-linux-arm64-gnu | 1.33.0 | NOASSERTION | not-installed-on-this-platform |
| lightningcss-linux-arm64-musl | 1.33.0 | NOASSERTION | not-installed-on-this-platform |
| lightningcss-linux-x64-gnu | 1.33.0 | NOASSERTION | not-installed-on-this-platform |
| lightningcss-linux-x64-musl | 1.33.0 | NOASSERTION | not-installed-on-this-platform |
| lightningcss-win32-arm64-msvc | 1.33.0 | NOASSERTION | not-installed-on-this-platform |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 | installed-package.json |
| magic-string | 0.30.21 | MIT | installed-package.json |
| nanoid | 3.3.19 | MIT | installed-package.json |
| obug | 2.2.1 | MIT | installed-package.json |
| pathe | 2.0.3 | MIT | installed-package.json |
| picocolors | 1.1.1 | ISC | installed-package.json |
| picomatch | 4.0.7 | MIT | installed-package.json |
| playwright | 1.63.0 | Apache-2.0 | installed-package.json |
| playwright-core | 1.63.0 | Apache-2.0 | installed-package.json |
| postcss | 8.5.28 | MIT | installed-package.json |
| require-from-string | 2.0.2 | MIT | installed-package.json |
| rolldown | 1.2.8 | MIT | installed-package.json |
| siginfo | 2.0.0 | ISC | installed-package.json |
| source-map-js | 1.2.1 | BSD-3-Clause | installed-package.json |
| stackback | 0.0.2 | MIT | installed-package.json |
| std-env | 4.2.0 | MIT | installed-package.json |
| tinybench | 2.9.0 | MIT | installed-package.json |
| tinyexec | 1.3.1 | MIT | installed-package.json |
| tinyglobby | 0.2.17 | MIT | installed-package.json |
| tinyrainbow | 3.1.1 | MIT | installed-package.json |
| typescript | 7.0.2 | Apache-2.0 | installed-package.json |
| undici-types | 7.18.2 | MIT | installed-package.json |
| vite | 8.3.0 | MIT | installed-package.json |
| vitest | 4.1.11 | MIT | installed-package.json |
| why-is-node-running | 2.3.0 | MIT | installed-package.json |
