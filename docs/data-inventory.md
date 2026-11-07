# Data inventory и retention (E01-02)

ADR-080: локальные иконки систем — статические декоративные ресурсы. Runtime
использует точные id/name и packaged asset paths; сайты/вендоры не выбирают URL
изображения. Из сети расширение их не получает. Первичные источники и лицензии
хранятся как build-time provenance отдельно от runtime resolver. История посещений,
системные сигналы, отчёты и личные данные в изображения/реестр не добавляются.

ADR-078: общая статическая база дополнена публичными hostname ↔ technology
связями каталога и отдельной датой/источником. Это не история пользовательских
посещений. Входы сборки содержат только нормализованные домены, справочник
систем и проверенные CrUX memberships; ключей, контактов, полных URL, query и тел
ответов в них нет. Inspector читает те же связи локально, отдельно от runtime
findings и экспорта; новых runtime API, permissions или CSP не добавлено.

ADR-077: поставляемый каталог сайтов содержит публичные HTTPS origins, имена,
проектные категории, страны аудитории и coarse CrUX buckets закреплённого
месячного snapshot. Он не содержит пользовательских посещений или настроек.
Поиск, фильтры и выбор живут только в памяти Options, не отправляются в сеть
и не сохраняются отдельно. Добавленные origins переходят в существующий
несохранённый план ADR-075; его сохранение требует явного Save.
SVG-флаги поставляются локально с MIT notice, каталог — с атрибуцией CC BY 4.0.
Иных хранилищ, фоновых команд и сетевых каналов не добавлено.

ADR-076: Precursor API token — память собственной страницы ввода/background и
TRUSTED `storage.session['precursor-credential:v1']`, до Disconnect, consent revoke
или закрытия браузерной сессии; никогда storage.local/IndexedDB/export/log.
`storage.local['precursor-modes:v1']` — проверенные ID/имя одной зоны, последнее
значение режима/время, флаг monitoring, настройка notifications и максимум 128 событий from/to/at/id.
Хранится до общего Clear/revoke; Disconnect сохраняет последнее известное и историю,
но не текущий режим. Остановка worker восстанавливает сессионный источник и повторно
проверяет режим; закрытие браузера требует повторного подключения. Общий report
repository перечисляет getKeys и читает только doc/index/fences, без vault value.
На Firefox без getKeys привилегированный helper получает native raw map только
для Object.keys, не обращается к значениям и не передаёт map репозиторию; после
этого repository отдельно читает allowlist. При ошибке существующего getKeys
fallback запрещён. `precursor-transport:v1` хранит только retryAt/lastAttempt/failures/resetBaseline
для соблюдения backoff при idle restart; общий Clear/revoke удаляет его. Фиксированные
GET только к api.cloudflare.com после явного Connect, без посещённых URL или telemetry.
Firefox presence Resource Timing — bounded metadata в памяти, rule IDs/availability,
без передачи URL/MIME/status raw или сохранения ресурсов. Снимок использует
`evidenceSource: browser-resource-timing`, `integrity: browser-observed` и только
`coverageState: partial`; это отдельный Precursor sidecar, не расширение основного
enum `DocumentReport`. Подробности [ADR-076](decisions/ADR-076.md).

Перечень данных, которые расширение обрабатывает, хранит или экспортирует. Всё, чего нет в таблицах §2–§5 и §4–§4c, не хранится и не передаётся. Основание: ТЗ I §4.3–§4.4, §5.1, II A9–A10, V §3, VI I1.3; ADR-007. Изменение таблиц — только через ADR и обновление `packages/contracts` + privacy policy.

**Какое расширение описано.** Таблицы §2, §3, §6 и §9 описывают детекторный контур (TS-база Local v0.1.0 и тот же сенсорный контур в production). §1, §4, §4a, §4b и §4c — полный перечень **production-расширения 2.0.0** (`apps/production-extension`), сверенный с исходным кодом 2026-11-06: в колонках «Источник» указаны файл и строка, `background.js` — собранный service worker. TS-база хранит только ключ `scope` (§4.1); остальные ключи, базы IndexedDB, вызовы сети и изменения настроек браузера, перечисленные в §4–§4c, есть только в production. Публичные тексты — [PRIVACY.md](../PRIVACY.md) и `apps/production-extension/privacy.html` — обязаны совпадать с этими таблицами.

Обозначения доступа: **SW** — service worker; **UI** — extension pages (popup/sidepanel/options), только через проекции SW; **ISO** — ISOLATED bridge (только текущий документ, до ACK); **MAIN** — сенсор (только собственные счётчики realm); **Adm** — администратор через `storage.managed` (запись политик, чтение отчётов невозможно).

Export policy: **redacted** — входит в экспорт по умолчанию после preview; **detailed** — только отдельным действием (E14, локальный диагностический режим); **never** — не покидает своего слоя.

## 1. Хранилища и сроки

Колонка «Срок» для production-расширения 2.0.0 дополнена ссылками на §4–§4c: там перечислены все ключи, базы и внешние эффекты. Строки про диск и `storage.local` относятся к двум сборкам по-разному, это указано в тексте.

| Хранилище | Что | Срок | Очистка |
| --- | --- | --- | --- |
| Память MAIN-сенсора | Насыщаемые счётчики realm, bitmask, ring номеров функций, bounded startup queue | Жизнь realm | Навигация, pause/stop |
| Память ISOLATED bridge | Ring ≤512 нормализованных агрегатов текущего документа до ACK | До ACK или переполнения (gap) | Навигация, `bridge-stop` |
| `chrome.storage.session` | `DocumentReport`, `FrameBinding`, `TabProjection`, dedup watermark и служебное состояние (§2, §9). В production там же ключи функций: Pro-запись, токен Cloudflare, чекпойнт Автосерфера, сиды WebRTC, доказательства модуля «Защита» (§4a.1) | После 10 мин неактивности — при следующем событии расширения с амортизацией 30 с, не ровно через 10 минут; закрытие вкладки; перезапуск браузера; disable/reload/update расширения; общий бюджет 4 MiB с LRU-вытеснением | SW по retention policy; `ui-clear` |
| `chrome.storage.local` | TS-база: предпочтения `scope` (§4.1). Production: настройки и данные функций — 27 ключей на момент сверки, 28 при включённой памяти ключей Geolocation API (§4.1–§4.5) | До удаления пользователем/расширения; у отдельных ключей есть свой срок и лимит (§4) | Options UI и интерфейс каждой функции; столбец «Очистка» §4 |
| `chrome.storage.managed` | TS-база: не используется, план §5. Production (Chrome): читается единственная политика `ProtectModuleDisabled` (запрет модуля «Защита»); включить модуль политикой нельзя | — | — |
| `chrome.storage.sync` | **Не используется** ни в одной сборке | — | — |
| Диск (IndexedDB, история) | TS-база: **не используется**. Production: **три базы** — архив Pro-отчётов, данные модуля «Защита», очередь и отчёт Автосерфера (§4a.2). Базы не шифруются средствами расширения | Пока пользователь не удалит; лимиты в §4a.2 | UI каждой функции; общая очистка и «Выключить и очистить» удаляют архив Pro; purge модуля «Защита» |
| Файл экспорта | Redacted-проекция, показанная в preview | Управляется пользователем; host исключён по умолчанию; включается отдельным checkbox в preview | Пользователь |
| Файлы других функций, буфер обмена, companion | Экспорт библиотеки Antidetect, профилей Proxy, cookies, Browser Debug, Автосерфера и модуля «Защита» — только по команде и после предпросмотра; «Copy JSON» в Proxy кладёт полный набор профилей с логинами в системный буфер обмена; companion хранит профили в файле DPAPI (§4a.4–§4a.5) | Файлы и буфер обмена расширение не удаляет и не очищает; vault companion остаётся после его деинсталляции | Пользователь, ОС |

## 2. Отчёт документа (`DocumentReport`, `storage.session`)

P02, ADR-005: sweep выполняется при hydration, `webNavigation.onCommitted`, `tabs.onRemoved`, приёме батча и UI-запросе, не чаще раза в 30 секунд. Таймер живого SW — только best-effort. Остановленный SW сам не просыпается: данные неактивного документа удаляются при следующем событии расширения, не ровно через 10 минут. Закрытие вкладки инициирует немедленную очистку её отчётов; прерванная остановкой SW операция может оставить snapshot до следующей очистки. Срок отсчитывается по SW receipt time. Бюджет session включает индекс и прочие ключи и использует оценку памяти Chrome `getBytesInUse`; при недоступности API остаётся структурная оценка snapshot. Сериализованный предел 100 KiB/report проверяется отдельно.

Только test-профиль: локальный ключ `test:p02:time-offset` задаёт сдвиг часов следующего старта SW (целые 0…86400000 мс); глобальный тестовый hook позволяет сдвигать часы текущего SW и читать агрегированную диагностику. Local-сборка не содержит ни hook, ни чтения этого ключа, поэтому ключ в ней не влияет на TTL. Данные страниц, wire и экспорт этим механизмом не расширяются.

Фактические поля после P01/P02/P04/P07 (сверка P10, 2026-09-13): `packages/contracts/src/messages.ts`, `packages/background/src/{documents,repository,projection}.ts`, `packages/export/src/index.ts`. Таблица описывает snapshot, а не план ТЗ. Срок всех полей — session/TTL из §1.

| Поле | Источник и цель | Доступ | Export |
| --- | --- | --- | --- |
| `schemaVersion` | SW: версия структуры | SW | Экспорт имеет свою schemaVersion |
| `documentKey`, `tabId`, `frameId`, `documentId` | MessageSender / webNavigation: идентичность документа | SW; documentKey в UI | never; вместо ID — documentOrdinal=1 |
| `host` | browser URL → PSL ICANN+PRIVATE: регистрируемый домен; IP/local/unknown → null | SW, UI | Только явный includeHost |
| `lifecycle` | SW по навигации: жизненный цикл | SW | never |
| `createdAt`, `updatedAt` | SW receipt time, snapshot округлён до секунд | SW | never |
| `revision` | SW: согласованность действий | SW; UI как reportRevision | reportRevision — только оболочка preview |
| `coverageState`, `coverageFlags[]` | SW/bridge/сенсор: область и пробелы | SW, UI | redacted |
| `counters[]`: `techniqueId`, `phase`, `signalCodes[]`, `count`, `countQuality`, `firstBucket`, `lastBucket` | PageObservation → SW: насыщаемые агрегаты, merge=max по boot; исходные observations не хранятся | SW; UI как techniques | redacted через techniques; buckets относительно первого bucket отчёта |
| `findings[]`: `findingId`, `ruleId`, `ruleVersion`, `techniqueId`, `interpretation`, `interpretationConfidence`, `evidenceIds`, `counterEvidenceCodes`, `limitationCodes`, `vendorMatchIds`, необязательный `coverageRef` | engine: интерпретации с ограничениями | SW, UI | redacted |
| `hosts[]` (≤128): ровно одно из `registrableDomain`/`category`, `relation`, `requestCount`, `firstSeenBucket`, `lastSeenBucket`, `evidenceSource`, `integrity`, `ruleIds[]` | webRequest после проверки target/initiator permissions и PSL: направления; buckets — секунды от создания документа; ruleIds пока пусты | SW; UI список не включает | never |
| `watermark`: `bridgeSessionId`, `lastCommittedBatchSeq` или null | SW: дедупликация и ACK | SW | never |
| `dropped`: `observations`, `batches`, `findings`, `hosts`, `counters`, `transport`, необязательный `ring` | SW: насыщаемые потери; ring — нижняя граница | SW, UI | redacted |

Рядом с report в snapshot сохраняется `DocumentMeta`: `documentKey`, `paused`, `revoked`, необязательные `scheme`, `accessGranted`, `findingsCap`; `bound`, `lastActivityAt`, `firstObservationAt`, `routeSegments`, `lateInjection`, `sensorSeen`, `degraded`; `folded`, `boots` (sensorBootId и максимумы счётчиков), `sessions` (bridgeSessionId и watermark). Это служебные данные SW, не экспорт. firstObservationAt проецируется в observedSince, экспорт содержит только насыщенный observationAgeMinutes. routeSegments — внутренний счётчик SPA, не экспортируемый routeSegment.

Индекс session хранит `FrameBinding` (`tabId`, `frameId`, `documentId`, `documentKey`, `parentDocumentId`, `frameType`, `documentLifecycle`, редактированный `host`, `boundAt`, необязательные `accessGranted`/`scheme`) и `TabProjection` (`tabId`, `activeTopDocumentKey`); оболочка индекса — `v`, `savedAt`, необязательные `evictedKeys`. Snapshot имеет оболочку `v`, `report`, `meta`. Это маршрутизация и восстановление, не экспорт. Дополнительные scope-записи и reset markers — §9.

**Не порождаются как поля DocumentReport:** `safePathTemplate`, `sensorStatus[]`, `observations[]`, `attributionRef`, `scriptOriginHint`, `vendors[]`, `mathAggregate`, `evictedCounts`. `evidenceSource`, `integrity`, `attributionConfidence` назначаются сводке техники в проекции (page-hook/page-controlled/unknown), а не сохраняются в CounterEntry. Сводка vendors в UI/экспорте пустая; production-правила каталога выключены. Prototype Math P09 существует только в тестах.

## 3. Транспорт (не хранится, проходит через мост)

| Поле | Источник | Цель | Срок | Доступ | Export |
| --- | --- | --- | --- | --- | --- |
| `channel`, `schemaVersion`, `type` | MAIN/ISO | Маршрутизация, discriminated union | transient | MAIN, ISO, SW | never |
| `sensorBootId` | MAIN | Namespace счётчиков, обнаружение переустановки; не аутентификация | transient (в snapshot — только последний) | ISO, SW | never |
| `bridgeSessionId`, `batchSeq` | ISO | Дедупликация `(documentKey, bridgeSessionId, batchSeq)`, повторная доставка | до ACK; watermark в session | ISO, SW | never |
| `coverageDelta[]` | MAIN/ISO | Изменения coverage | transient | ISO, SW | never (результат — в `coverageFlags`) |
| Precursor timing cache: `ruleIds[]` (≤1), `available`, `revision`, `truncated` | Native Resource Timing getters в ISO; status/MIME/origin проверяются и отбрасываются внутри realm | Подтверждение пассивного ресурса точного документа по ADR-076 | Память ISO/SW, TTL ≤10 мин; clear/pause/navigation/revoke | ISO → SW по собственному exact-document query; MAIN не участвует | never |
| Precursor sidecar `evidenceSource: browser-resource-timing`, `integrity: browser-observed`, `coverageState: partial` | SW после проверки native document identity и timing cache | Отдельная карточка присутствия ресурса; конфигурацию Off/Monitor/Armed не определяет | Память SW, TTL ≤10 мин | SW → собственный UI | never; не добавляется в основной `DocumentReport` |
| `senderContext` (`tabId`, `frameId`, `documentId`, `origin`, `frameType`) | Chrome `MessageSender` | Доверенная привязка | transient | SW | never |
| Ack (`lastCommittedBatchSeq`, `paused`, `protocolOk`, optional `stopReason: revoked`) | SW | Подтверждение, пауза, остановка несовместимого сенсора | transient | ISO | never |

## 4. Настройки и данные функций (`storage.local`)

Production-расширение хранит в `chrome.storage.local` существенно больше, чем TS-база. Ниже — полный перечень ключей, найденных поиском по `storage.local` и `storage.session` во всех модулях `apps/production-extension` и в service worker (27 ключей `storage.local` на момент сверки 2026-11-06; 28 при включённой памяти ключей Geolocation API). Общие свойства всех ключей: хранятся в профиле браузера, не синхронизируются (`storage.sync` не используется нигде), не шифруются средствами расширения, удаляются Chrome вместе с расширением, пишутся только service worker или собственной страницей Options (если не указано иное); при чтении проверяются форма или перечисление, а непригодное значение отбрасывается либо заменяется значением по умолчанию. Колонка «Экспорт»: «никогда» — значение не попадает ни в один файл экспорта, отчёт или лог.

### 4.1 Наблюдение и запреты API (detector)

TS-база (срез 1, F088) пишет единственный ключ `scope` (`SCOPE_PREFS_KEY`, `ScopePrefs` в `packages/background/src/scope.ts`). Production пишет тот же `scope` и ключи ниже. Канонические значения режима — `SCOPE_MODES` из `packages/contracts/src/enums.ts`; `activeTab` остаётся названием Chrome permission, а не wire-значением режима.

| Поле `scope` | Источник | Цель | Срок | Доступ | Export |
| --- | --- | --- | --- | --- | --- |
| `scope.v` (`1`) | SW | Версия структуры предпочтений | до замены записи/удаления расширения | SW | never |
| `scope.scopeMode` (`off` / `active-tab` / `site` / `all-sites`) | Пользователь (options/popup), проверяется SW | Уровень наблюдения. TS-база: по умолчанию `off`. Production: после установки `all-sites`, если Chrome выдал доступ ко всем сайтам (ADR-041), иначе `off` | до изменения/удаления расширения | SW, UI (проекция) | never |
| `scope.hosts[]` (нормализованные hosts, не origin patterns; ≤128) | Пользователь через `ui-set-scope` | Выбранная область `site`; SW строит patterns и сверяет гранты Chrome | до изменения записи/удаления расширения | SW, UI (проекция) | never |

`scope.hosts` — постоянные данные о выбранных сайтах, заданные пользователем; это не история посещений и не источник выданных Chrome разрешений. Очистка отчётов сессии не очищает предпочтения. Privacy policy описывает `scope: { v, scopeMode, hosts }` как часть детекторных настроек; остальные ключи описаны в разделах функций.

Пауза хранится отдельно: `DocumentMeta.paused` (boolean) в snapshot документа в `storage.session`, срок — жизнь snapshot/session/TTL. Источник — `ui-pause`/`ui-resume`, цель — остановить приём данных конкретного `documentKey`; SW меняет флаг, UI получает состояние через проекцию, внутренний флаг не экспортируется. Новый документ на том же host не наследует паузу. Надпись `action_pause` относится к документу (`docs/ui-copy.md`).

**Не реализованные предпочтения TS-базы:** `observationMode`, `sitePatterns`, `pausedSites`, `disabledSensorIds`, `locale`, `onboardingAcknowledgedVersion`, отдельный `schemaVersion` предпочтений там не записываются. В production язык интерфейса хранится ключом `ui-language-v1` (§4.5), остальные перечисленные имена не используются.

| Ключ (`storage.local`) | Что хранится | Срок и лимиты | Очистка | Export | Источник |
| --- | --- | --- | --- | --- | --- |
| `scope` | `{ v: 1, scopeMode, hosts[] }`, см. таблицу выше | до изменения/удаления расширения | Options, popup; «Выключить и очистить» ставит `off`, запись не удаляет | never | background.js:16326, 16414–16421, 16445–16453, 16630 |
| `scope:full-access-default-v1` | boolean: умолчание «все сайты» уже применено (ADR-041) | до удаления расширения | нет | never | background.js:16326, 16453 |
| `scope:resume-mode-v1` | `{ version: 1, scopeMode }` — режим, к которому возвращает переключатель «Включить» | до перезаписи | нет | never | observation-control.js:4, 23 |
| `data-consent:v1` | `{ version: 1, accepted }` — включено ли наблюдение. При установке без записи сохраняется `accepted: true` без экрана согласия (ADR-041) | до изменения | переключатель наблюдения; «Выключить и очистить» ставит `accepted: false` | never | background.js:16295, 16414–16421, 16487, 16504 |
| `protection:v1`, `protection:pending:v1`, `protection:compatibility:1.1.0` | Настройки запретов API (API Guard): включены ли, пресет, правила по API, правила для ≤128 точных имён сайтов; флаги незавершённого применения и миграции | до изменения пользователем; выключены по умолчанию | Options → запреты API | как часть конфигурации API (§4.2) по команде пользователя | background.js:1920, 19004, 19038–19048, 19099, 19160; api-configuration-controller.js:15, 328 |
| `site-icons:v1` | `{ version: 1, entries: [{ host, png, at }] }` — зарегистрированный домен посещённого сайта из области наблюдения, значок 32×32 PNG, время. Записывается автоматически (ADR-035) | ≤64 сайтов, ≤512 KiB, 7 суток; устаревшее отбрасывается при чтении и в `refresh()` | «Выключить и очистить», смена разрешений, срок | never | site-favicon.js:2–3, 123–141; background.js:20032, 20945, 20964, 21650 |

### 4.2 Antidetect

| Ключ (`storage.local`) | Что хранится | Срок и лимиты | Очистка | Export | Источник |
| --- | --- | --- | --- | --- | --- |
| `api-configuration:v1` | `{ revision, configuration }`: главные выключатели Antidetect и API Guard, режим и выбранное пользователем значение каждой строки (в том числе строки User-Agent, языки, часовой пояс, координаты геолокации, адреса WebRTC), исключения для ≤128 точных имён сайтов, библиотека ≤128 профилей (метка, ≤8 тегов по ≤24 знака, заметка ≤500 знаков, значения) | ≤4 MiB в сериализованном виде; до изменения пользователем | Правка в Options: удаление профилей (сначала в корзину, `fingerprint-trash:v1`), импорт другого файла, выключатели | Файл `detect-expert-api-configuration-v1.json` и экспорт библиотеки — только по команде после preview; приватные ключи шума не входят | api-configuration-controller.js:14, 96, 113, 176, 328; api-configuration.js:21–23, 30, 672; api-configuration-ui.js:308–309 |
| `profile-noise-root:v1` | Случайные 256 бит (64 hex). Из них HMAC выводит приватные ключи для Canvas, Math, звука, WebGL и Network Information применённого профиля (ADR-106/107); сам корень и ключи не передаются и не показываются | Создаётся при первом применении строки с шумом; остаётся до удаления расширения | Действия в интерфейсе нет | never; тест `scripts/test/canvas-readback-native.mjs:290–296` проверяет, что значение нигде в `storage.local`, кроме своего ключа, и в состоянии не встречается | profile-noise-seed.js:7, 30–36, 53–75 |
| `webrtc-device-site-seed:v1` | Случайные 64 hex для устойчивых случайных идентификаторов устройств WebRTC в режиме «на сайт» (режим «на сессию» — в `storage.session`, §4a.1) | до удаления расширения | Действия в интерфейсе нет | never | webrtc-network-controller.js:104–120 |
| `fingerprint-trash:v1` | `{ version: 1, items: [{ profile, deletedAt, index }] }` — корзина: полная копия удалённого профиля библиотеки (метка, теги, заметка, значения) для «Отменить» и «Восстановить» | 7 суток от `deletedAt`; ≤32 записей и ≤1 572 864 символов JSON (вытесняются старейшие, интерфейс сообщает); чистится при каждом чтении и записи; ключ удаляется, когда корзина пуста | «Удалить навсегда», «Очистить корзину» | never | fingerprint-trash.js:10–15, 120–121, 138 |
| `fingerprint-temporary:v1` | `{ version: 1, startedAt, label, previous }` — прежнее состояние применённых строк (`previous` — валидный снимок профиля) для возврата после временного профиля | ≤262 144 символов; до «Завершить временный профиль» или до возврата service worker при запуске после перезапуска браузера | «Завершить временный профиль» | never | fingerprint-temporary.js:4–6, 13–18; api-configuration-controller.js:126–133 |
| `identity-bundles:v1` | `{ version: 1, links: { "fp-<32 hex>": "<id прокси>" } }` — связь профиля библиотеки с сохранённым прокси раздела Proxy. Конфигурацию прокси не меняет, секретов нет | ≤128 связей; мёртвые связи чистятся при следующей записи | «Убрать связь» | never | identity-bundles.js:1–12, 72–75 |
| `antidetect-quiet-sensors:v1` | `{ version: 1, enabled: true }` — настройка «не запускать датчики наблюдения, пока включён Antidetect» (ADR-113). Только точная запись включает режим, любая другая форма читается как «выключено»; по умолчанию ключа нет. Булев флаг, без URL, значений и идентификаторов | одна запись, пока не выключена | выключатель в карточке уровня «Сеть» (запись `enabled: false`) или удаление данных расширения | never | sensor-quiet.js:10, 27, 136 |

### 4.3 Proxy

| Ключ (`storage.local`) | Что хранится | Срок и лимиты | Очистка | Export | Источник |
| --- | --- | --- | --- | --- | --- |
| `proxy-configuration:v1` | Метаданные: `enabled`, `selectedId`, профили `{ id, name, type, host, port, native, country? }`, маршрутизация (режим `all`/`include`, ≤256 доменов в списках, обход локальных адресов), флаги `protectWebRTC`, `disablePrediction`, `killSwitch`, `autoConnect`. **Логин, пароль, URI VLESS и конфигурация OpenVPN в ключ не попадают**; адрес сервера (`host`, `port`) хранится открыто и у профилей через companion: companion возвращает его из профиля (для VLESS из URI, для OpenVPN единственный `remote`; `null`, если определить не удалось). Поле `country` — собственная заметка пользователя, не определяется по IP и не уходит в companion | ≤100 профилей, имя ≤96 знаков, ≤1 MiB; до изменения пользователем | Удаление профилей, выключатель Proxy | Файл `Detect.Expert-proxy-profiles.json` (без логинов и ключей) — только по команде | proxy-shared.js:7, 10, 74–99; proxy-service.js:137, 500–512; proxy-ui.js:614–615 |
| `proxy-vault-state:v1` | `{ version: 1, configuration, nativeIds, cleanup }` — копия метаданных, соответствие id профилей и записей vault companion, список записей vault, ожидающих удаления. Секретов нет | ≤100 записей в каждом списке; до изменения | Удаление профиля добавляет запись в `cleanup`; после `delete` у companion она снимается | never | proxy-service.js:10–28, 137, 144, 170–179, 328–330 |
| `proxy-native-restart:v1` | `{ version: 1, at }` — маркер явного однократного перезапуска после первого разрешения `nativeMessaging` | Потребляется новым service worker при возрасте 0–60 с, затем удаляется | Сам удаляется | never | proxy-service.js:192–203, 463 |
| `proxy-privacy-owner:v1` | `{ version: 1, previous, released? }` — прежнее значение настройки браузера «предсказание сети» (`true`, `false` или `null`), чтобы вернуть его после отключения Proxy | Пока Proxy держит настройку | Снимается при отключении Proxy после восстановления | never | proxy-privacy.js:5–6, 26, 42, 50, 64 |
| `proxy-check-history:v1` | `{ version: 1, enabled, items }` — по профилю список «стоянок»: время первой и последней проверки, число проверок, результат, код, время ответа, признаки DNS/TLS, HTTP-статус и внешний IP (адрес самого прокси, каким его увидел сайт проверки; не адрес пользователя). Не хранятся проверяемый адрес, хост, порт и логин прокси и ответы | ≤30 записей на профиль, ≤100 профилей, 30 суток от последней проверки; переключатель «Сохранять историю проверок» (по умолчанию включён) | Очистка одного профиля или всех; запись профиля удаляется вместе с ним | never | proxy-history.js:1–14, 21, 134–137 |

### 4.4 Cloudflare (Precursor) и модуль «Защита»

| Ключ (`storage.local`) | Что хранится | Срок и лимиты | Очистка | Export | Источник |
| --- | --- | --- | --- | --- | --- |
| `precursor-modes:v1` | `{ version: 1, zone: { id, name }, lastKnownMode, lastKnownAt, history, notifications, monitoring }` — проверенная зона (ID и имя), последнее прочитанное значение режима и время, флаги, история переходов `{ id, from, to, at }`. Токена нет (он в `storage.session`, §4a.1) | history ≤128; до общей очистки или отзыва согласия; Disconnect сохраняет последнее известное значение и историю | Disconnect (частично), «Выключить и очистить»/общая очистка | never | precursor-modes-service.js:5, 33–42, 90–101, 189–192 |
| `precursor-transport:v1` | `{ version: 1, lastAttempt, retryAt, failures, resetBaseline? }` — только данные для паузы между запросами после сбоев | `failures` ≤6; пауза ≤1 часа | Общая очистка | never | precursor-modes-service.js:7, 50–56, 115–124 |
| `protect` | `{ v, enabled, consentVersion, features, preset, snoozeUntil, historyRetentionDays }` — только настройки модуля «Защита». Модуль выключен по умолчанию | до выключения с purge | Выключение с purge; удаление расширения | never | protect-sw.js:12333–12341, 21219–21245, 21469–21482 |

### 4.4a Proxy Manager Geolocation API (ADR-109)

Модули `proxy-geo-*.js`. Функция выключена по умолчанию; значения ключей провайдеров в настройки, кэш, отчёты, экспорт, журналы и сообщения не попадают.

| Ключ (`storage.local`) | Что хранится | Срок и лимиты | Очистка | Export | Источник |
| --- | --- | --- | --- | --- | --- |
| `proxy-geo-settings:v1` | `{ version: 1, enabled, auto, failover, remember, columns, providers }` — переключатели, видимые столбцы геолокации, по провайдеру: включён ли он и его параметр (сервис MaxMind, запрос данных безопасности ipgeolocation.io, подтверждение HTTP для ip-api). Ключей нет | Пока пользователь не изменит; строгое чтение, неверная форма = функция выключена | Выключение не стирает; «Удалить все ключи» ключей не касается настроек | never | proxy-geo-shared.js; proxy-geo-store.js |
| `proxy-geo-cache:v1` | `{ version: 1, items: { <IP>: запись } }` — нормализованный ответ провайдера для внешнего IP прокси пользователя: провайдер и сервис, время, IP, страна, регион, город, часовой пояс, номер и название AS, организация, провайдер связи, тип использования и восемь признаков (`true`/`false`/не сообщено). Координат, почтового индекса, ключей и сырых ответов нет | ≤200 записей, не старше 30 суток; строки ≤80 символов без управляющих и bidi-символов | Кнопка «Очистить кэш»; устаревшие записи отбрасываются при чтении | never | proxy-geo-shared.js; proxy-geo-controller.js |
| `proxy-geo-credentials:v1` | `{ version: 1, items: { <провайдер>: { apiKey } или { accountId, licenseKey } } }` — **только при включённой галочке «Запомнить ключи на этом компьютере»**; без неё ключи лежат в `storage.session` (§4a.1), а этот ключ из `storage.local` удаляется | Пока пользователь не удалит ключ | «Удалить ключ», «Удалить все ключи»; снятие галочки переносит ключи в `storage.session` | never | proxy-geo-store.js |

### 4.5 Интерфейс

| Ключ (`storage.local`) | Что хранится | Срок и лимиты | Очистка | Export | Источник |
| --- | --- | --- | --- | --- | --- |
| `ui-language-v1` | Код выбранного языка интерфейса | до изменения | Выбор языка | never | options.js:147964, 148021; background.js:17423, 17512; precursor-settings.js:5, 178 |
| `ui-theme-v1` | Одно из 6 значений темы (`system`, `pearl`, `aurora`, `graphite`, `orchid`, `glass`); зеркало в `localStorage` страницы (§4a.3) | до изменения | Выбор темы | never | theme-controller.js:3, 74; theme-bootstrap.js:9, 26 |
| `ui-mode-v1` | Выбранный вид Light или Pro | до изменения | Переключатель вида | never | popup.js:153091, 153140; sidepanel.js:153085, 153134 |

Прочее состояние интерфейса лежит в `localStorage` страниц расширения (§4a.3). Отчёты документов, Pro-запись и ключи функций в `storage.local` не лежат: они в `storage.session` (§4a.1) и IndexedDB (§4a.2).

## 4a. Остальные хранилища production-расширения

Этот раздел дополняет §4: `storage.session`, три базы IndexedDB, `localStorage` страниц расширения, vault companion, файлы и буфер обмена, данные только в памяти. Из-за ADR-108 (раунд 5) в него вошли и ключи Antidetect/Proxy, ранее описанные отдельно: они перенесены в §4.2–§4.3 без изменения смысла.

### 4a.1 `chrome.storage.session` (память браузера, на диск не пишется)

Очищается при перезапуске браузера и при disable/reload/update расширения. Общий бюджет отчётов 4 MiB (§1); ключи функций ниже имеют свои лимиты. Расширение выставляет области `storage.session` уровень доступа `TRUSTED_CONTEXTS` (service worker и страницы расширения, не скрипты страниц) при подключении Cloudflare.

| Ключ | Что хранится | Срок и лимиты | Источник |
| --- | --- | --- | --- |
| `doc:<documentKey>`, `index`, `clear-epochs:v1` | Отчёты документов (§2), индекс привязок (§2), метки очистки | §1: TTL 10 мин при следующем событии, 100 KiB на отчёт | background.js:15887, 15912 |
| `antidetect-quiet-periods:v1` | `[{ from, to }]` — до 8 пар меток времени (`to: null` у открытого периода), когда датчики наблюдения удерживались вне страниц (ADR-113); по ним Детектор отличает «приостановлено» от пробела. Адресов, страниц и значений нет | сессия; ≤8 пар; очищается при перезапуске браузера и общей очистке | sensor-quiet.js:11, 32, 107, 119 |
| `active-tabs` | tabId и documentId (≤128) для режима «текущая вкладка» | сессия | background.js:16326, 16408 |
| `data-consent:pending-v1` | Маркер незавершённой смены включения наблюдения | до окончания смены | background.js:16295, 16503 |
| `visual-owners-v1` | Реестр владельцев предпросмотров изображений (без пикселей); сами изображения только в памяти worker | сессия | background.js:16727, 16758 |
| `rtc-details-v1` | История настроенных ICE-серверов: hostname или IP сервера, порт, состояния соединений | ≤8 документов, ≤32 KiB на документ, 10 мин без обновления | background.js:1415, 17064, 17136 |
| `pro-recording-v1` | Запись Pro, запущенная пользователем (посещения, очищенные заголовки и URL-шаблоны, сетевые метаданные, результаты, при записи — значения исходящих Cookie и технических заголовков) | запись ≤10 минут, ≤3 MiB; остановленная остаётся до замены, очистки или конца сессии браузера | background.js:1663, 17819, 18592 |
| `proxy-geo-credentials:v1` | `{ version: 1, items }` — ключи провайдеров геолокации (API-ключ или номер аккаунта и лицензионный ключ MaxMind), пока галочка «Запомнить ключи» выключена. Уровень доступа `TRUSTED_CONTEXTS` | До закрытия браузера, «Удалить ключ(и)» или включения галочки «Запомнить» (тогда ключи переносятся в `storage.local`, §4.4a) | proxy-geo-store.js |
| `precursor-credential:v1` | `{ version, zoneId, token }` — токен Cloudflare API. Записывается после первого успешного ответа API | до Disconnect, отзыва согласия, общей очистки или закрытия браузера; уровень `TRUSTED_CONTEXTS` | precursor-modes-service.js:6, 44–49, 108–109, 140 |
| `autosurf-session:v1` | Чекпойнт текущего запуска Автосерфера: конфигурация (адреса пользователя), состояние запуска, собственные tabId/windowId | ≤1 MiB; сессия браузера | autosurf-service.js:49–51; autosurf-shared.js:3, 5 |
| `fingerprint-engine:owned-window:v1` | `{ v, windowId, tabId }` собственного окна нативной сессии профиля. Профиль, посещённые адреса и токены не хранятся | пока окно открыто | fingerprint-engine-checkpoint.js:2, 22 |
| `fingerprint-temporary-live:v1` | `{ version: 1, startedAt }` — отметка «временный профиль начат в этой сессии браузера» (отсутствие при записи в `storage.local` означает перезапуск) | сессия браузера | fingerprint-temporary.js:6, 14 |
| `webrtc-device-session-seed:v1` | Случайные 64 hex для идентификаторов устройств WebRTC в режиме «на сессию» | сессия браузера | webrtc-network-controller.js:104–120 |
| `protect-doc:<documentKey>`, `protect-tabs`, `protect-runtime` | Доказательства модуля «Защита» без значений полей, хэш правил, undo ≤16 | TTL документа 10 мин, ≤1 MiB на модуль | protect-sw.js:14725; ADR-020-protect §8 |

### 4a.2 IndexedDB (диск профиля браузера, не шифруется средствами расширения)

| База | Что хранится | Срок и лимиты | Удаление | Export | Источник |
| --- | --- | --- | --- | --- | --- |
| `detect-expert-pro-report-history` (хранилища `state`, `reports`, `summaries`) | Архив Pro-отчётов: пользователь явно нажимает Save у остановленного сеанса, и проверенный `session` целиком сохраняется на диск — страницы, очищенные заголовки и URL-шаблоны, сетевые метаданные, результаты и, если они были записаны, значения исходящих Cookie и технических заголовков запроса; сводка: id, домен, времена, число страниц, размер | ≤20 записей, ≤8 MiB JSON; пока пользователь не удалит | «Удалить» в истории; общая очистка (`ui-clear-session`) и «Выключить и очистить» удаляют архив фоном даже при закрытых окнах | Только как Pro-отчёт по команде и preview | pro-report-history.js:2–3, 39, 85–110; background.js:20809–20813, 20914–20915; ADR-097 |
| `detect-expert-protect` (`meta`, `exclusions`, `decisions`, `sightings`, `receivers`, `sites`, `requests`) | Данные модуля «Защита»: исключённые сайты, решения фаервола, история «Кто вас узнаёт» (домены, дни, enum, счётчики; отдельная галочка), журнал запросов о данных (записи о письмах, которые готовит пользователь: факты, статус, даты; введённое на сайте значение в письмо не подставляется). Значения полей, их отпечатки и хэши не хранятся | История 7/30/90 дней (по умолчанию 30); журнал ≤100 записей и ≤512 KiB, сроки 30/365/730 дней по статусу; сроки соблюдаются при следующем событии | purge модуля (выключение с удалением), сроки | История и журнал — по команде и preview | protect-sw.js:397, 497–510, 14482–14487, 15011, 21469–21482; ADR-020-protect §8 |
| `detect-expert-autosurf` (хранилище `workspace`) | `configuration` — список адресов, введённых пользователем (полные HTTP(S) URL без логина и пароля); `last-report` — origin, коды, времена и агрегаты CPU/RAM последнего запуска; координаты и найденные ссылки не сохраняются | ≤200 адресов, ≤2048 знаков, ≤256 KiB конфигурации; до изменения или «Очистить» | Правка списка; «Очистить» заменяет отчёт пустым | JSON/CSV — по команде и preview | autosurf-service.js:16, 45–48; autosurf-shared.js:5; autosurf-controller.js:32–34, 66, 311, 332 |

### 4a.3 `localStorage` страниц расширения

| Ключ | Что хранится | Срок | Источник |
| --- | --- | --- | --- |
| `ui-theme-v1` | Значение темы — зеркало `storage.local` для первой отрисовки; недоступное хранилище допустимо | пока не очищены данные расширения | theme-bootstrap.js:9, 19; theme-controller.js:31 |
| `proxy-view:v1` | `{ version: 1, density, columns, sort, dir }` — вид списка прокси: плотность, столбцы, сортировка; без данных профилей; не более 1024 символов, любое отклонение формы = значения по умолчанию | До «Сбросить вид», очистки данных расширения или удаления | proxy-ui-model.js:10, 41–54 |
| `proxy-geo-banner:v1` | Признак «уведомление о Geolocation API скрыто» в менеджере прокси; без данных профилей; недоступное хранилище допустимо | До очистки данных расширения | proxy-ui.js |
| `ui-tour:v2` | `{ version: 2, tours: { <раздел>: { completed, lastStep } } }` — по одной записи на экскурсию (12 разделов Options): номер шага (0…число шагов − 1) и признак завершения; без данных страниц, настроек, URL и отчётов; не более 1024 символов, только известные экскурсии, любая другая форма удаляется при чтении (ADR-111) | До очистки данных расширения или удаления; запись раздела заменяется при «Начать сначала» | ui-tour.js:13, 73, 119, 129, 135 |
| `ui-tour:v1` | Прежнее значение раунда 5 `{ version: 1, completed, lastStep }` (одна экскурсия, 8 шагов): читается один раз как экскурсия Antidetect (шаг после удалённого шага «Proxy» сдвигается на единицу) и удаляется при первой записи `ui-tour:v2`; не более 64 символов | До первой записи `ui-tour:v2` | ui-tour.js:14, 101 |

### 4a.4 Companion прокси (отдельная программа на компьютере пользователя)

Расширение не хранит секреты прокси. Их хранит необязательный companion `com.detect_expert.proxy` (Windows x64, пользовательская установка без прав администратора), когда профиль требует логина, VLESS или OpenVPN. Расширение запускает его через Native Messaging только при явных действиях в Proxy (разрешение `nativeMessaging` запрашивается при сохранении защищённого профиля).

| Что | Где | Срок и удаление | Источник |
| --- | --- | --- | --- |
| Профили целиком в JSON ≤8 MiB: host, port, логин, пароль, URI VLESS, конфигурация OpenVPN с сертификатами и ключами | Файл `Detect.Expert/Proxy/<sha256 вызывающего>.dpapi` в каталоге `os.UserConfigDir()` (Windows: `%AppData%`). Шифрование Windows DPAPI текущего пользователя; запись через временный файл и переименование | Пока профиль не удалён в Proxy (расширение просит companion выполнить `delete`, а при недоступности повторяет по списку `cleanup`) или файл не удалён вручную. **`Uninstall.ps1` снимает только регистрации Native Messaging и оставляет vault**; удаление расширения vault не удаляет | native/proxy/host/main.go:252–317, 495–517; vault_windows.go; profiles.go:100–118; Uninstall.ps1; proxy-service.js:170–179, 328–330 |
| Регистрация Native Messaging, установочный каталог | Реестр текущего пользователя (`HKCU`, ключи `NativeMessagingHosts` для Chrome, Chromium, Edge и Mozilla); каталог `%LocalAppData%/Detect.Expert/ProxyCompanion/…` | Создаёт установщик companion, а не расширение; снимает `Uninstall.ps1` | native/proxy/Install.ps1; Uninstall.ps1 |
| Вне Windows | `vaultAvailable()` возвращает `false`: постоянное хранилище секретов отключено, companion для таких профилей не поставляется | — | native/proxy/host/vault_other.go |

Companion не возвращает расширению строк серверных логов (ответы содержат фиксированные коды и фазы; из вывода движков берётся только класс диагностики, байты не сохраняются, а на диск host пишет только файл vault (tunnel.go:18–30)), не скачивает и не обновляет движки Xray и openvpn2socks при работе (они поставляются в пакете), слушает только `127.0.0.1` на случайном порту (ADR-070; `relay.go:70`, `tunnel.go:123`). Сетевые соединения companion — §4b.

### 4a.5 Только в памяти, файлы и буфер обмена

| Данные | Где живут | Как исчезают | Источник |
| --- | --- | --- | --- |
| Значения cookies (Cookies: автоматическое чтение списка по выданному доступу и «Обновить», Reveal/Edit, Import, Export) | Память собственной страницы Options | Уход со вкладки, скрытие или закрытие страницы (`visibilitychange`, `pagehide`), отзыв разрешения, dispose; в `storage`, IndexedDB, логи и отчёты не пишутся (ADR-069) | cookies-workspace-controller.js:352–357; cookies-ui.js:109–125 |
| Значение одной cookie в живой панели; значение выбранной tracking-cookie при тесте восстановления | Память service worker и панели на время операции; opaque handles ≤60 с | Закрытие панели, refresh, очистка, навигация, 10 секунд теста (ADR-023/032) | cookie-values.js; cookie-probe.js |
| Логин, пароль, URI, конфигурация во время ввода и при «Copy JSON» | Память страницы Options до Save/Cancel/ухода; для копирования — до записи в буфер | Сохранение, отмена, уход со страницы, `releaseExport` | proxy-ui.js:436–452; ADR-071 |
| Ключи Geolocation API в полях ввода; результаты и ошибки поиска в контроллере | Память страницы Options и страницы настроек Geolocation API; поле очищается после «Сохранить», ключ после сохранения не показывается | Закрытие страницы; ошибки поиска — только до закрытия страницы; результаты — в кэше `storage.local` (§4.4a) | proxy-geo-settings.js; proxy-geo-controller.js |
| Токен Cloudflare в поле ввода | Память страницы до передачи; затем память worker и `storage.session` | Очистка поля после передачи; Disconnect | precursor-settings.js; precursor-modes-service.js:108–109 |
| Снимки Browser Debug (история, закладки, загрузки, метаданные cookies без значений, вкладки, сеансы, топ-сайты, список чтения, расширения, настройки privacy, разрешения сайтов, системные сведения, имя и e-mail профиля) | Память вкладки Options, ≤200 строк | Закрытие вкладки, скрытие, отзыв разрешения | browser-debug-shared.js:3, 17–32; browser-debug-controller.js:178–199 |
| Ключевые отпечатки вариантов введённых значений (e-mail, телефон, имя); тела исходящих запросов вкладок с активным вводом (скан ≤64 KiB на запрос) и найденные в них токены | Память service worker | Отпечатки — TTL 15 мин; токены ≤10 с; значения паролей, платёжных полей и одноразовых кодов не читаются | protect-sw.js:408, 416, 19786; ADR-020-protect §8 |
| Предпросмотры Canvas/WebGL, значения API, заголовки Google, X-Client-Data | Память service worker | Лимиты и TTL (§1, privacy policy) | background.js:1232–1245, 2204, 19680 |
| Адреса и тела запросов к точным endpoint маячков известных сервисов (Google Analytics и Ads, Meta, TikTok, Яндекс, LinkedIn) | Память service worker на время разбора (webRequest `onBeforeRequest` с `requestBody`, без блокировки) | После разбора остаётся только проекция: enum события, ограниченное значение, валюта, признаки наличия идентификаторов и согласия; в памяти, TTL 10 мин, ≤32 документов, ≤64 строк, ≤64 KiB. Исходный адрес, тело, идентификаторы, e-mail, телефон, хэши и поля заказа не сохраняются | background.js:21642; beacon-observer.js:5; beacon-decoder.js:1–13; ADR-030 |
| Параметры этого браузера для подсказок Antidetect (память, строки GPU через один временный контекст WebGL, сведения адаптера WebGPU, состояние прокси) | Память страницы Options | Закрытие страницы; в хранилище, сообщения, экспорт и логи не попадают | fingerprint-profiles-controller.js:61–95 |
| Координаты наведения и ссылки-кандидаты Автосерфера | Память фиксированного ISOLATED-адаптера и service worker | Конец текущего перехода | ADR-075 |
| Файлы экспорта: `detect-expert-api-configuration-v1.json`, `detect-expert-fingerprint-configuration.json`, `Detect.Expert-proxy-profiles.json`, JSON/CSV Автосерфера, `browser-debug-<набор>.json`, файлы cookies (JSON, Netscape, зашифрованный JSON), экспорт модуля «Защита», Pro-отчёт, Light JSON | Папка загрузок, куда пользователь сохранил файл | Расширение файлы не удаляет. Создаются через локальный Blob и ссылку `download`; разрешение `downloads` для этого не используется | api-configuration-ui.js:308–309; fingerprint-profile-ui.js:384; proxy-ui.js:614–615; autosurf-ui.js:164; browser-debug-ui.js:180–181; cookies-ui.js:254–255; protect-ui.js:6154–6155 |
| Буфер обмена: полный набор профилей Proxy с логинами («Copy JSON»), адрес прокси, ссылки «Контакты», текст писем модуля «Защита» | Системный буфер обмена | Расширение буфер не очищает и не читает (`clipboardRead` не используется); другие программы могут прочитать содержимое | proxy-ui.js:436–452, 457; contacts-ui.js; protect-ui.js:7872 |

## 4b. Сетевые соединения, которые инициирует расширение

Проверено поиском сетевых примитивов (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `Image`, `connectNative`) по всем модулям и по service worker, а также `scripts/production/lint-inventory.json`: runtime-обращения к сети разрешены ровно трём файлам — `precursor-modes-service.js` (fetch), `proxy-geo-client.js` (fetch, ADR-109) и `site-favicon.js` (Image). Остальное — навигация вкладок, Native Messaging и настройки прокси браузера. Аналитики, телеметрии, учётной записи, удалённого кода, удалённых списков и автоматической выгрузки отчётов нет; CSP страниц расширения разрешает только `connect-src https://api.cloudflare.com https://geolite.info https://geoip.maxmind.com https://api.ipgeolocation.io https://api.ipdata.co http://ip-api.com https://pro.ip-api.com`.

| Что | Когда | Куда | Какие данные | Источник |
| --- | --- | --- | --- | --- |
| Чтение зоны Cloudflare (Precursor) | После «Connect» с токеном, который ввёл пользователь; далее не чаще раза в минуту (alarm с периодом 1 мин, пауза после ошибок и 429), пока соединение активно; до подключения запросов нет | `GET https://api.cloudflare.com/client/v4/zones/{zone_id}` (проверка зоны) и `.../precursor` (режим) | `Authorization: Bearer <токен>`, `Cloudflare-Version`, `Accept`; без cookies (`credentials: 'omit'`), без referrer, без перенаправлений; ответ ≤64 KiB | precursor-modes-service.js:147, 227, 269, 279; manifest.json (CSP) |
| Определение геолокации внешнего IP прокси (Proxy Manager Geolocation API) | Только при включении функции пользователем и наличии ключа (или подтверждённой бесплатной точки ip-api.com): сразу после завершённой *ручной* проверки прокси (можно выключить), по кнопке «Определить» и при «Проверить ключ». Таймера нет, при открытии списка запросов нет; свежий результат берётся из кэша без сети | `GET` к одному из шести хостов: `geolite.info` или `geoip.maxmind.com` (MaxMind), `api.ipgeolocation.io`, `api.ipdata.co`, `http://ip-api.com` (бесплатная точка, только HTTP, по отдельному подтверждению) или `pro.ip-api.com`. Резерв: при ошибке тот же IP может уйти следующему включённому провайдеру | Публичный внешний IP прокси (частные и зарезервированные адреса не отправляются) и ключ (MaxMind — HTTP Basic с номером аккаунта; остальные — параметр запроса); без cookies, referrer, перенаправлений, посещённых адресов, адреса и порта прокси и логина. Провайдер видит и адрес отправителя запроса | proxy-geo-client.js; ADR-109 |
| Трафик браузера через прокси | После включения Proxy пользователем. Сохранённое включённое состояние восстанавливается при запуске браузера; профиль через companion подключается сам только при включённом `autoConnect`, иначе трафик блокируется до нажатия Connect. При сбое трафик блокируется (kill switch), а не идёт напрямую | Сервер прокси или VPN, заданный пользователем | Весь трафик браузера или только домены из списка; оператор сервера видит адреса назначения и незашифрованное содержимое | proxy-service.js:127, 232–236, 497–520; ADR-070 |
| Подключение companion к серверам профилей | При Connect и при проверке сохранённого профиля, пока companion запущен | Серверы SOCKS5/HTTP/HTTPS/VLESS/OpenVPN из профилей | Трафик маршрута и учётные данные профиля (логин, пароль) серверу этого профиля; автоматических проверок IP, подписок и обновлений нет | native/proxy/host/relay.go:48; tunnel.go:196; README.md |
| Проверка прокси | Только по нажатию кнопки проверки (одиночной или пакетной), не при загрузке, Connect или status | Адрес проверки (по умолчанию `https://api.ipify.org/?format=json`, пользователь может изменить) — запрос выполняет companion через выбранный прокси | HTTP(S) GET без cookies браузера и перенаправлений; наружу возвращаются статус, признаки DNS/TLS, IP, время | proxy-ui.js:25; proxy-shared.js:272–295; ADR-070/071 |
| Автосерфер | После Start пользователя (Chrome) | Адреса из списка пользователя и ссылки того же origin, найденные на этих страницах | Обычная навигация вкладки (запросы идут от браузера); отладчик Chrome подключён к собственной вкладке | autosurf-controller.js:153; ADR-075 |
| Нативная сессия профиля Antidetect | После явного действия в Options (Chrome) | Начальный HTTP(S)-адрес, введённый пользователем, в новом окне | Обычная навигация; отладчик подключён к этому окну | fingerprint-engine-service.js:108; ADR-101 |
| Значки сайтов | Автоматически для страниц в области наблюдения при загрузке вкладки (ADR-035) | Адрес значка вкладки, который Chrome сообщает как `favIconUrl` (обычно сам сайт или его CDN); значки `data:` запроса не делают | Загрузка `Image` в изолированном контексте страницы с `crossOrigin=anonymous` и `referrerPolicy=no-referrer`; результат уменьшается до PNG 32×32 | site-favicon.js:47–77, 128; background.js:21650 |
| Ссылки и письма | Только по нажатию | Страницы из раздела «Контакты», шапка, `mailto:` | Отчёты и данные расширения не добавляются; `noopener noreferrer` | contacts-data.js; ADR-093 |
| Ссылка на загрузку companion (Proxy) | Только по нажатию пользователем ссылки «Скачать с GitHub» в карточке Proxy или в разделе «Компаньон». Карточка видна, пока companion не известен как доступный; сама она запросов не делает | `https://github.com/vektort13/Detect.Expert/releases/latest` в новой вкладке (запрос выполняет браузер после нажатия) | Данные расширения не передаются; `noopener noreferrer` — нет opener и referrer; расширение само GitHub не запрашивает и ничего не скачивает и не устанавливает; карточка ничего не хранит | proxy-shared.js (`PROXY_COMPANION_DOWNLOAD_URL`); proxy-route-ui.js; ADR-070 |

## 4c. Что расширение меняет вне своего хранилища

| Что | Когда | Источник |
| --- | --- | --- |
| Динамические правила `declarativeNetRequest`: Antidetect — блок `websocket`/`webtransport` (id 300000/300001) и `modifyHeaders` запросов (id 300100–300119, `set` User-Agent, Accept-Language, Sec-CH-UA, Sec-CH-UA-Mobile, Sec-CH-UA-Platform; `remove` высокоэнтропийных подсказок и некоторых заголовков устройства, окна и сети, `X-Client-Data` при не-Chrome идентичности); запросы самого расширения исключены | Только при включённом Antidetect и выбранных строках (ADR-064/105/108) | antidetect-protocol-controller.js:7, 86; antidetect-header-controller.js:6–12, 247–254 |
| Правила `declarativeNetRequest` модуля «Защита»: `block`/`allow` и заголовок `Sec-GPC: 1` (id 1–99, 100000–100999, 101000–101023, session 200000–200127) | Только при включённом модуле и функциях, выбранных пользователем | protect-sw.js:14645, 14694; ADR-020-protect |
| Пользовательские скрипты `userScripts` с префиксом `detector-api-custom-`, MAIN world, document_start; код собирается на устройстве из упакованных функций и выбранных значений, ничего не скачивается. Текст скрипта содержит выбранные значения и производные приватные ключи шума; в экспорт и отчёты он не попадает. Где и как долго Chrome хранит зарегистрированный текст, не измерялось | Только при включённой подмене значений и включённом переключателе «Разрешить пользовательские скрипты» | api-custom-registration.js:154; api-configuration-controller.js:226–228 |
| Настройка прокси браузера (`proxy.settings`, PAC; в Firefox `proxy.onRequest`) | Только при включённом Proxy | proxy-service.js:127, 255 |
| Настройки приватности браузера: `webRTCIPHandlingPolicy` (по выбору в Antidetect и при активном Proxy), `networkPredictionEnabled` (Proxy) | Только после optional-разрешения `privacy`; прежнее значение сохраняется и возвращается | webrtc-network-controller.js:45, 63; proxy-privacy.js:5–60 |
| Данные браузера: Browser Debug (запись истории, правка закладок, стирание записей списка загрузок, удаление cookie, вкладки, расширения, булевы настройки приватности, разрешения сайта для точного origin), Cookies (импорт, правка, удаление), «Очистить cookies сайта», тест восстановления tracking-cookie | Только после явной команды пользователя и выданного optional-разрешения | browser-debug-data.js; cookies-workspace-controller.js; cookie-inspector.js:173; cookie-probe.js:156, 224 |
| Размер и положение окна («Подогнать окно») | Только по нажатию | ADR-107 |
| Регистрации Native Messaging в реестре | Выполняет установщик companion, не расширение | native/proxy/Install.ps1 |

## 5. Планируемые политики (`storage.managed`, read-only, Managed local)

Production (Chrome): `chrome.storage.managed` читается для единственной политики `ProtectModuleDisabled` (запрет модуля «Защита», схема `protect-managed-schema.json`); политики, которая включает модуль, нет. Всё остальное в этом разделе — план, а не фактическая обработка.

В текущей Local-сборке не читаются и не применяются; ниже требования будущего профиля, не фактическая обработка.

`ObservationEnabled`, `ObservationScope`, `AllowedSitePatterns`, `ExcludedSitePatterns`, `DisabledSensorIds`, `RemoteRuleUpdatesEnabled`, `PinnedRulePackVersion`, `FleetHealthEnabled`, `ReportUploadMode`, `ExportMode`, `LocalRetentionHours`, `TenantId`, `ServiceOrigin` (ТЗ V §4, ADR-013). Срок — управляется Chrome; доступ — SW читает, UI показывает «задано организацией»; экспорт — never (в экспорт попадает только факт `managed: true` и `exportMode`). Секреты и токены в managed storage не хранятся. Некорректная политика не стирает последнюю корректную; отклонённые ключи фиксируются в диагностике.

## 6. Диагностика (`storage.session`, ring ≤1 MiB, TTL 24 ч)

Реализованный минимальный диагностический preview в Options содержит только schemaVersion, проверенную числовую extensionVersion (иначе unknown), chromeMajor (целое 1…9999 либо null) и swAvailable. Он строится локально, не сохраняется в session, скачивается только отдельным действием и не содержит host/ID/epoch. Нижеследующий расширенный ring — требования будущего E14, ещё не реализованные поля не выдаются за доступные.

| Поле | Цель | Export |
| --- | --- | --- |
| Версии расширения, схем, правил, PSL; major Chrome | Воспроизводимость | redacted (по отдельному действию «диагностический отчёт») |
| Коды ошибок датчиков/reducer, счётчики отклонённых батчей и причин | Поддержка | redacted |
| Capability flags (доступные API) | Совместимость | redacted |
| Отклонённые ключи managed policy (имена) | Admin guide | redacted |

Без hosts, paths, содержимого страницы, payload отклонённых сообщений. Перезапуск браузера очищает.

## 7. Что не хранить и не передавать через мост (ТЗ I §4.4, REQ-005)

Таблица описывает наблюдающие сенсоры и мост (REQ-005). Узкие исключения production для отдельных функций, которые работают только по явной команде пользователя в собственных страницах расширения, сенсоры и мост не расширяют: значения cookies (ADR-023/037/069), токен Cloudflare в `storage.session` (ADR-076), учётные данные прокси в vault companion (ADR-070/071), ввод в модуле «Защита» (ADR-020-protect), параметры собственного браузера для подсказок Antidetect (ADR-107). Где они хранятся и как удаляются — §4–§4c.

| Данные | Допустимое представление |
| --- | --- |
| Canvas pixels, data URL, WebGL `readPixels`, аудио-семплы, результаты Math | Только тип операции, счётчик, pattern ID |
| Аргументы Math и строки измеряемого текста | Только локальное сравнение с разрешённым маркером без coercion → enum/bitset; аргумент удаляется |
| Точные hardware/screen/font/codec результаты | «Запрашивались сведения» и категория; не device profile |
| Нажатия, координаты, траектории, текст форм, clipboard | Не читаются и не сохраняются |
| Cookie values, токены, `Authorization`, тела запросов/ответов | Не читаются; для одобренных сигнатур — имя без значения с минимальным transient parse (cookie-name sensor выключен по умолчанию) |
| Полный URL, path с ID, query, fragment, username/password | Host/site relation, safe known path template или rule ID; произвольный path не экспортируется |
| Сырой stack, имена функций с данными, sourceURL | Краткая оценка происхождения; очищенные sample locations только в локальном диагностическом режиме |
| Полные ICE-кандидаты, локальные IP, SDP, STUN credentials | Тип кандидата/класс адреса; IP не сохраняются |
| Случайные DNS-поддомены (left labels) | Registrable domain, количество, класс паттерна |
| `tabId/frameId/documentId` из page payload | Игнорируются; берутся из `MessageSender` |
| HTML, исполняемые строки, произвольные объекты, вложенные коллекции в payload | Отклоняются валидатором; payload не логируется |
| Visitor ID, device fingerprint, инвентарный ID установки в telemetry | Не создаются (Local); enrollment ID — только corporate profile, ADR-013 |

Диагностический режим не является лазейкой: запрещённые payloads остаются запрещёнными.

## 8. Проверка (privacy assertions)

Отдельное последующее исключение — встроенный Автосерфер по [ADR-075](decisions/ADR-075.md), 2026-10-30. Его пользовательская очередь полных HTTP(S) URL хранится в IndexedDB `detect-expert-autosurf/workspace` (ключ `configuration`), последний отчёт — `last-report`; credential-bearing URLs запрещены. `autosurf-session:v1` в trusted storage.session содержит ограниченный checkpoint текущей сессии, runConfig и собственные native tab/window ID. Наблюдавшиеся внутренние URL не сохраняются на диск; восстановление возвращается к введённому пользователем адресу. Фиксированный ISOLATED adapter временно возвращает geometry и до32 ссылок; координаты и ссылки не входят в report/MAIN/логи/хранилища детекторов. JSON/CSV и последний отчёт содержат только origins, фиксированные коды, UTC timeline и числовые агрегаты CPU/RAM системы и renderer. GPU — null. Экспорт скачивает ровно preview. Область этого исключения не меняет обычные detector reports и запрет чтения паролей. Фактические тесты — внутренний отчёт.

`pnpm test:privacy`: для каждого fixture с «секретами-канарейками» (уникальная строка текста на canvas, значение cookie, query-параметр, локальный IP, аргумент `Math.sin`) проверяется, что канарейка отсутствует в `storage.session`, `storage.local`, UI-логах, экспорте и сообщениях моста; в изолированном профиле нет исходящих запросов расширения (initiator = extension). Реестр канареек ведётся в `fixtures/privacy/`.

## 9. Фактическая граница после P01/P02/P07 (сверка P10, 2026-09-13)

§2 перечисляет фактический snapshot. §5 и расширенный ring §6 — планы, не текущее хранение. Экспорт использует отдельный allowlist packages/export: documentOrdinal=1; host=null по умолчанию; coverage, техники, находки, вендоры и dropped; observationAgeMinutes — насыщенный возраст первого наблюдения. Bucket техники отсчитывается от первого bucket отчёта. documentKey, tabId/frameId/documentId, createdAt/lastActivityAt/observedSince и абсолютный exportedAt не экспортируются. UI сверяет свежую reportRevision и внутреннюю привязку документа перед скачиванием ровно показанного JSON. Включение host — явный includeHost в привилегированном запросе.

Внутренние session snapshots округляют epoch до секунд для retention. Scope provenance хранится отдельно: ограниченные active-tabs записи (не более 128) с tabId, documentId нужны только для проверки scope, не экспортируются; scheme metadata определяет доступ к origin, reset markers предотвращают восстановление очищенных данных. Предпочтения scope живут в local; scope off не должен сохранять новый browsing host/observedSince. Внутренний ReportProjection.observedSince — время первого наблюдения либо null, scopeMode — фактическая область. ScopeState передаётся только UI для управления разрешениями.

P01 добавил pinned offline PSL (`packages/attribution/data/SOURCE.md`), редактирование report-host/network destinations до storage ingress и миграцию старых snapshot. Network hosts теперь порождаются (§2). sanitizeHost в scope остаётся маршрутизацией разрешений, не заменяет reportHost. Сессионные active-tabs содержат только tabId/documentId. Точные нормализованные hosts выбранных сайтов сохраняются только в постоянных scope.hosts для сверки доступа, без path/query; в экспорт настройки не входят. Evidence/ограничения — внутренний отчёт; это не автоматический reverify каждого audit ID.

Прогон privacy 2026-09-12: 22 unit assertions, 3 document reports/20 session keys, 17 local JS/HTML файлов; storage/export/console/wire без заданных canaries, extension-attributed egress отсутствует. Наблюдение включено при старте; readiness markers подтверждают захват UI/SW console; wire проверяется до прикладной валидации. Это контролируемое измерение, не доказательство для произвольных hosts. Это исторический прогон до P01; более поздние observer-to-storage canaries и границы проверки описаны во внутреннем отчёте.
