# Evidence registry сигнатур вендоров — формат и governance

Основание: ТЗ IV «Что означает запись в каталоге», «Схема записи и governance», «Fixtures, приёмка и метрики»; ADR-009, ADR-015; `docs/PROJECT_RULES.md` REQ-008.

**Seed `Doc/.../catalog/vendors.seed.json` (71 вендор, 20 правил-кандидатов) остаётся выключенным**: `productionEnabled=false`, `fixtureVerified=false` на корне и у каждой записи. Файл — исследовательская модель, не готовый детектор. Продукты со статусом C/I имеют пустой `ruleIds[]`; их не заполняют догадками. Включение правила переключением boolean запрещено — только через lifecycle ниже с evidence.

## 1. Что подтверждает запись (четыре независимых факта)

1. существование продукта (product page);
2. документированный интеграционный артефакт (официальная инструкция описывает URL/cookie/DOM);
3. реальное наблюдение артефакта расширением (fixture в Chrome);
4. поведенческий вывод (отдельная ось `interpretation`, не часть vendor-правила).

Ни один не подменяет другой. Vendor product page подтверждает продукт, не сигнатуру.

## 2. Статусы записи вендора

| Код | Статус | Смысл |
| --- | --- | --- |
| C | `product_catalog_only` | Официальный материал подтверждает продукт; сигнатуры не установлены; распознавание не обещается |
| I | `official_index_only` | Официальный поисковый результат подтверждает продукт; целевой материал не прочитан; backlog |
| D | `documented_candidate` | Официальный источник описывает браузерный артефакт; matcher не проверен |
| L | `documented_legacy_candidate` | То же, источник помечает версию устаревшей |

## 3. Lifecycle правила

```text
catalog → documented candidate → lab fixture verified → security/privacy reviewed → release candidate → production approved → deprecated/revoked
```

- **lab fixture verified** — проверена конкретная интеграция (SDK/версия/дата), не весь продукт.
- **production approved** требует production gate (§6). Число 50/100 не заменяет gate.
- **deprecated/revoked** — правило остаётся в реестре с датой и причиной; исторические отчёты не переписываются.
- Истечение `reviewDueAt` без ревизии → `expiryAction`: `downgrade_to_stale_hint` (UI: «устаревшая подсказка») или `disable`. Никогда не «подтверждено» молча.

## 4. Схема записи правила (`rules/sources/<vendorId>/<ruleId>.json`)

Поля seed + обязательные для promotion (ТЗ IV):

| Поле | Тип | Обязательно с этапа |
| --- | --- | --- |
| `id`, `vendorId`, `status`, `productionEnabled`, `fixtureVerified` | string/bool | catalog |
| `evidenceOrigin` | `network_request` / `cookie_name` / `global_name` / `dom_attribute` | documented candidate |
| `conditions` | объект из конечного набора matcher-ключей (`scheme`, `hostExact`, `hostOneOf`, `hostSuffixLabels`, `leftmostLabelRegex`*, `pathExact`, `pathOneOf`, `pathRegex`*, `resourceType`, `nameExact`, `nameOneOf`, `ownDataPropertyOneOf`, `neverReadValues`, `tagExact`, `attributeExact`, `attributeValueExact`, `neverReadElementContent`) | documented candidate |
| `source.url`, `source.accessedAt`, `sourceClaim` (`documented_browser_artifact` / `product_existence`), `sourcePublishedAt` или `"unknown"` | | documented candidate |
| `meaningRu`, `limitationsRu` (+ `en`) | string | documented candidate |
| `ownerTeam` | string | lab fixture verified |
| `scope` (first/third-party, consent, CSP условия) | object | lab fixture verified |
| `integrationVersion`, `browserVersions[]` | | lab fixture verified |
| `positiveFixtureIds[]` (≥1), `negativeFixtureIds[]` (обязательный набор §5) | | lab fixture verified |
| `reviewerIds[]` (≥2, отличны от автора) | | security/privacy reviewed |
| `validFrom`, `reviewDueAt`, `expiryAction`, `expiresAt` | date/enum | release candidate |
| `changelog[]`, `rollbackId` | | release candidate |
| `productSpecificity` (`family` / `product` / `deployment_unresolved`), `providerAttribution` (`exact_resource` / `cookie_name_hint` / `unknown`) | enum | documented candidate |

\* Regex — только локальные reviewed-шаблоны в релизе расширения: лимит длины входа, без backreferences/lookbehind/nested repetition, performance-тест. Удалённые data packs regex не привозят (ADR-015). `leftmostLabelRegex` в Arkose означает ровно одну метку `<company>-api` непосредственно перед `arkoselabs.com`.

Запись вендора (`rules/sources/<vendorId>/vendor.json`): `id`, `name`, `providerId`, `productId`, `aliases[]` с периодами (rebranding: PerimeterX/HUMAN, Shape/F5, ShieldSquare/Radware, Fingerprint/FingerprintJS, NuData/NuDetect — одна строка семейства), `category`, `evidenceStatus`, `sources[]`, `notesRu`, `ruleIds[]`, `browserRecognitionPromised=false`.

## 5. Fixtures

- **Synthetic matcher fixture** — проверяет parser/normalization/DoS budget; не доказывает существование сигнатуры в реальном SDK.
- **Authorized integration fixture** — собственная тестовая страница с разрешённым vendor sandbox/test SDK или официальным demo; фиксируются SDK/version/date, first/third-party, consent, CSP; без чужих аккаунтов, платежей, нагрузки.
- **Обязательные negatives** для каждого production rule: похожий hostname (`evil-online-metrix.net`, `online-metrix.net.evil.example`, `online-metrix.net@evil.example`), shared CDN, documentation page с текстом кода (`<script src=…>` в тексте ≠ загрузка), DOM без загрузки, aborted/blocked request, library loaded-but-unused, nested iframe другого origin, late consent, SPA навигация, self-hosted/bundled (`unknown`), отсутствие host permissions, page-origin подделка.
- Специфичные: Cloudflare — CDN-only, load-balancer cookie, rate-limiting cookie; AWS — challenge SDK без Bot Control; Stripe — платёжный SDK без risk endpoint; Google — hCaptcha с `grecaptcha` compatibility; HUMAN — точное имя cookie и коллизии generic `_px*`.
- **Golden artifact**: обезличенные browser event records, ожидаемое семейство, допустимая формулировка, provenance, coverage flags; абсолютные URL с ID, cookies, ответы SDK удалены. Mock collector помечается как mock и не повышает зрелость.
- Лицензии: не распространять proprietary SDK, ключи, HAR с пользовательскими данными; фиксировать лицензию версии fixture.

## 6. Production gate (`pnpm catalog:lint` + review)

`productionEnabled=true` допустим только если: источники доступны и подтверждают конкретный признак; свежий approved positive fixture; negatives прошли; лимиты CPU/memory соблюдены (regex performance); выводы ограничены наблюдаемым (`meaningRu`/`limitationsRu` без «подтверждает исполнение/серверное решение/безопасность»); исключена утечка идентификаторов (query/tenant key/visitorId не сохраняются); два reviewer; `rollbackId` проверен.

Фактические автоматические проверки различаются между базами. Корневой `scripts/catalog-lint.mjs` запрещает включение research seeds и не выполняет promotion из `rules/sources/**`. Исторический production gate `baseline-ts/scripts/curated-catalog-checks.mjs` проверяет обязательные поля, matcher/positive fixture, snapshot и browser version; наличие ID negatives и reviewers само по себе не подтверждает исполнение каждого негативного сценария и независимость reviewer. Соответствие внешнего источника конкретному browser artifact требует отдельного подтверждения. Синтетический candidate resource fixture не является доказательством загрузки настоящего vendor SDK. Пробелы происхождения inherited production-правил фиксируются как unknown; положительный результат общего lint не закрывает их.

## 7. Плановые ревизии

Каждые 30 дней — источники и upstream changelog; каждые 90 дней — документированные сигнатуры; критичная коллизия → немедленное отключение правила следующим доверенным обновлением. Это проектные SLA.

## 8. Метрики

Precision/recall **по rule и известному fixture corpus** с интервалами; false positives на documented negatives; доля unresolved deployments; drift по версиям; доля dropped observations. Не публиковать «обнаруживает 100 % антифрода»/«0 % false positives». Сайт без маркера — не отрицательная разметка (возможен server-side).

## 9. Очередность внедрения (E12-02)

Точные network host+path: DataDome, hCaptcha, Turnstile, reCAPTCHA, MaxMind, Sift, GeeTest → ThreatMetrix (два loader-правила, происхождение — Ping Identity/Medusa, не LexisNexis), Fingerprint v4, Arkose, Yandex → Stripe как risk telemetry → cookie/DOM/global после provenance+UX review → SEON/Ravelin legacy только с явной применимостью. Kount, Forter, Akamai, Imperva, Kasada и C/I — исследовательские задачи с причиной отсутствия matcher; не «не обнаружены».
