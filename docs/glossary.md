# Глоссарий detect.expert

Термины и канонические enum. Единственный источник wire-имён — `packages/contracts`; этот документ обязан совпадать с ним (ТЗ VI I1.1, `docs/PROJECT_RULES.md` «Канонические поля»). Параллельные имена (`observationSource`, `techniqueConfidence`, `page_observed`, `page-reported`) не вводятся.

## 1. Базовые понятия

| Термин | Определение |
| --- | --- |
| **Наблюдение (observation)** | Факт, доступный инструменту: Chrome сообщил о запросе к ресурсу; MAIN-хук прислал сообщение о вызове `getImageData`. Наблюдение не содержит намерения, результата или адресата. |
| **Интерпретация (interpretation)** | Гипотеза о том, похоже ли сочетание наблюдений на получение отпечатка или иной шаблон. Не доказывает назначение, уникальность, стабильность или передачу результата. Всегда сопровождается `interpretationConfidence`. |
| **Атрибуция (attribution)** | Связь факта со скриптом, frame, host и продуктом. Реалм выполнения, URL ресурса и владелец сервиса — разные сущности. `unknown` допустим и предпочтителен перед подстановкой origin основной страницы. |
| **Coverage (покрытие)** | Описание того, что инструмент мог наблюдать в данном документе за период: состояние (`coverageState`), причины ограничений (`coverageFlags`), потери (`dropped`). «Не обнаружено» = «не наблюдалось в доступной области за период». |
| **Утверждение (claim)** | Любая формулировка UI/Store, адресованная человеку. Каждое утверждение имеет тип evidence: observed / inferred / catalog (см. `PRD.md` §6). |
| **Техника (technique)** | Семейство наблюдения из каталога ТЗ III, `techniqueId = DET-001…DET-069`. Один DET может порождать несколько типов карточек. |
| **Находка (finding)** | Результат правила движка: `findingId`, `ruleId`, `ruleVersion`, `techniqueId`, `interpretation`, `interpretationConfidence`, `evidenceIds`, `counterEvidenceCodes`, `limitationCodes`, `coverageRef`, `vendorMatchIds`. |
| **Карточка (card)** | Элемент UI одного из трёх типов: `api-use` («Использован API»), `possible-fingerprinting` («Есть признаки вычисления отпечатка»), `vendor` («Обнаружена сигнатура известной технологии»). |
| **Документ (document)** | Единица отчёта, идентифицируемая `documentId` Chrome. Вкладка может содержать несколько документов (активный, prerender, BFCache). `frameId` документ не идентифицирует. |
| **documentKey** | Доверенный ключ документа, назначаемый SW из `MessageSender`/`webNavigation`. Page payload не может его задать. |
| **Realm** | JS-окружение (Window документа, Worker, iframe). MAIN-хуки покрывают только realm, в который выполнена инъекция. |
| **MAIN world** | Контекст выполнения content script, общий с JavaScript страницы. Всё, что там доступно, находится по одну сторону границы доверия со страницей. |
| **ISOLATED world** | Контекст content script с отдельным пространством переменных и общим DOM. Мост (bridge) фильтрует и батчит page events. |
| **Сенсор (sensor)** | Обёртка API в MAIN, которая наблюдает уже выполняемый вызов, вызывает оригинал ровно один раз и не читает результат. |
| **Мост (bridge / collector)** | ISOLATED-скрипт: валидация формы, нормализация разрешённых полей, батчинг, ring buffer, ограничение нагрузки, повторная доставка до ACK. |
| **Reducer** | Часть SW, которая по browser events и батчам обновляет `DocumentReport(documentId)`; единственный writer отчётов. |
| **Engine** | Чистые функции интерпретации/корреляции без `chrome.*` и сети (`packages/engine`). |
| **Snapshot / watermark** | Сохранённое в `storage.session` состояние документа и `lastCommittedBatchSeq`; ACK выдаётся только после их согласованного сохранения. |
| **Gap** | Явно зафиксированная потеря данных (ring overflow, канал разорван, SW перезапущен до ACK). Отражается в `coverageFlags`, не скрывается. |
| **Integrity** | Степень независимости наблюдения от содержимого страницы. Не оценка безопасности и не «истинность». |
| **page-controlled** | Значение `integrity` для всего, что пришло из MAIN: страница может подделать, подавить или изменить эти сообщения. `event.source === window`, nonce, `sensorBootId` — маршрутизация, не аутентификация. |
| **browser-observed** | Событие получено через браузерный API в привилегированной части расширения (`webRequest`, `webNavigation`). Доказательство события, не истинности страницы или владельца ресурса. |
| **Redaction** | Приведение данных к разрешённому представлению до моста/storage/логов (ТЗ I §4.4, ADR-007). |
| **Retention** | Срок жизни данных: `storage.session` до закрытия вкладки/TTL/перезапуска; предпочтения в `storage.local`; отчёты никогда в `storage.sync`. |
| **Coverage matrix** | `docs/coverage/matrix.md`: техника × контекст × режим разрешений × статус проверки. |
| **Evidence registry** | Реестр сигнатур вендоров с источниками, fixtures, reviewer и сроком пересмотра (`rules/sources/README.md`). |
| **documented candidate** | Правило, признак которого описан официальным источником, но не проверен fixtures. ≠ `fixture-validated`. |
| **Differential test** | Один сценарий без и с расширением; сравниваются результат, тип, порядок событий, исключения, identity возвращённых объектов. |
| **Ownership-safe cleanup** | Восстановление оригинала только если текущий дескриптор принадлежит нашей обёртке; иначе — сообщение «перезагрузите страницу». |
| **Late injection** | Инъекция в уже открытый документ по `activeTab` — даёт `late-start`. |
| **Три режима продукта** | Local / Managed local / Managed connected (`PRD.md` §3). |
| **Три уровня наблюдения (permission modes)** | «Проверять с этого момента» (`activeTab`), «Всегда на этом сайте» (optional host для origin), «Наблюдать на всех сайтах» (широкий optional host access). Плюс состояние «выключено» (`off`). |

## 2. Канонические enum (единственные wire-имена)

### `evidenceSource` — откуда поступили сведения
| Значение | Определение |
| --- | --- |
| `browser-network` | Событие `webRequest` (запрос, завершение, ошибка; заголовки только из allowlist) |
| `browser-navigation` | Событие `webNavigation`/`tabs` о жизненном цикле документа |
| `page-hook` | Сообщение MAIN-сенсора об обращении к обёрнутому API |
| `page-dom` | Наблюдение разрешённого DOM-признака из ISOLATED (например, фиксированный атрибут; содержимое не читается) |
| `derived` | Вычислено движком из других наблюдений (находка, корреляция) |

### `integrity` — степень независимости от страницы
| Значение | Определение |
| --- | --- |
| `browser-observed` | Получено привилегированной частью через browser API |
| `page-controlled` | Получено из контекста, который страница контролирует (MAIN, DOM) |
| `derived` | Производное; наследует наименьшую integrity исходных evidence |

### `interpretation` — гипотеза, объясняющая последовательность
| Значение | Определение |
| --- | --- |
| `api-use` | Зафиксировано обращение к API; признаков шаблона нет |
| `possible-fingerprinting` | Сочетание наблюдений похоже на получение отпечатка; альтернативные обычные сценарии не исключены |
| `fingerprinting-pattern` | Совпадение с конкретным валидированным шаблоном (fixture-verified) в пределах наблюдаемости |
| `local-probe-pattern` | Серия попыток соединений с локальными адресами/портами похожа на пробу локальной сети |
| `dns-test-pattern` | Серия запросов к уникальным поддоменам похожа на DNS-тест; резолвер расширению неизвестен |
| `unknown` | Данных недостаточно для гипотезы |

### `interpretationConfidence` — калиброванная сила конкретного вывода
`low | medium | high | unassessed`. Не вероятность «преступления». `unassessed` — правило не калибровано (ADR-010) или бюджет исчерпан.

### `attributionConfidence` — что известно об инициаторе
| Значение | Определение |
| --- | --- |
| `exact-resource` | Инициатор — конкретный ресурс, подтверждённый browser event (например, initiator + URL запроса) |
| `sampled-stack` | Подсказка из ограниченной выборки `Error().stack`; page-controlled, может вводить в заблуждение (inline/eval/bundler/sourceURL) |
| `frame-only` | Известен только frame/документ выполнения |
| `unknown` | Атрибуция невозможна; origin основной страницы не подставляется |

### `vendorConfidence` (в тексте ТЗ — ось `vendorMatch`) — сила распознавания интеграции
| Значение | Определение |
| --- | --- |
| `documented-resource` | Точное совпадение нормализованного host/path с документированным ресурсом production-enabled правила |
| `multi-signal` | Несколько независимых разрешённых признаков в одном document/frame/окне и одной deployment-гипотезе |
| `weak-signal` | Один page-controlled признак (global, DOM-атрибут, имя cookie); в UI — «найден элемент интеграции» |
| `none` | Совпадений нет; не означает отсутствия вендора |

### `coverageState` — почему отсутствие событий может быть неинформативным
| Значение | Определение |
| --- | --- |
| `active` | Хуки установлены с `document_start`, канал жив, лимиты не превышены |
| `partial` | Наблюдается часть контекстов (недоступные frames, отключённый сенсор, сеть ограничена разрешениями) |
| `late-start` | Инъекция после начала выполнения скриптов страницы; ранние вызовы могли быть пропущены |
| `paused` | Пользователь/политика приостановили наблюдение; страница работает |
| `unsupported` | Страница/контекст не поддерживают инъекцию (chrome://, Web Store, другие расширения, несовместимый дескриптор, несовместимый Chrome) |
| `no-access` | Нет host permission / activeTab для этого документа |
| `degraded` | Превышены бюджеты (quota, flood, ring overflow, SW restart с потерей) — часть данных отброшена |

### `coverageFlags` — причины (множество, enum контрактов)
Начальный набор: `late-start`, `hook-failed`, `throttled`, `unsupported-realm`, `channel-gap`, `truncated`, `sample-budget-exceeded`, `frames-inaccessible`, `network-limited`, `paused`, `revoked`, `protocol-mismatch`. Точный список — `packages/contracts`.

### `countQuality`
| Значение | Определение |
| --- | --- |
| `exact` | Принятый счётчик без известных потерь (для page events — точность принятого, не доверенность сообщения) |
| `sampled` | Семплирование включено; счётчик экстраполяции не содержит |
| `lower-bound` | Были потери до агрегации; истинное значение не меньше |

### `phase`
| Значение | Определение |
| --- | --- |
| `attempted` | Вызов начат; исход не наблюдался |
| `returned-sync` | Оригинал вернул значение синхронно |
| `threw-sync` | Оригинал бросил синхронное исключение (например, tainted canvas → SecurityError); исключение доставлено странице |
| `async-returned` | Оригинал вернул Promise/асинхронный объект; settlement не наблюдается |
| `settlement-unobserved` | Исход асинхронной операции не наблюдался намеренно (нет `.then/.catch`) |

### `signalCodes` — перечислимые признаки (не пользовательские строки)
Начальный набор из `page-batch.schema.json`: `api-use`, `readback-after-text`, `offline-render`, `numeric-diversity`, `known-numeric-pattern`, `local-multi-port`, `unique-subdomains`, `early-observation`, `late-start`, `hook-failed`, `sample-budget-exceeded`. Максимум 8 на наблюдение.

## 3. Идентификаторы

| Имя | Кто назначает | Назначение |
| --- | --- | --- |
| `sensorBootId` | MAIN-сенсор | Локальный ID загрузки сенсора; namespace кумулятивных счётчиков; не аутентификация |
| `bridgeSessionId`, `batchSeq` | ISOLATED bridge | Последовательность для повторной доставки и дедупликации |
| `documentKey` | SW из `MessageSender.documentId` | Доверенный ключ отчёта |
| `tabId`, `frameId`, `documentId` | Chrome (`MessageSender`, `webNavigation`) | Никогда из payload страницы |
| `reportRevision` | SW | Версия проекции; UI-действия сверяют `documentKey` и revision |
| `ruleId`, `ruleVersion` | Каталог/движок | Трассировка находки до правила |
| `observationId`, `findingId` | SW/engine | Внутренние ссылки; не экспортируются как стабильные ID пользователя |

## 4. Термины каталога вендоров

`catalog only (C)`, `official index only (I)`, `documented candidate (D)`, `legacy candidate (L)` — стадии зрелости записи (ТЗ IV). Lifecycle правила: catalog → documented candidate → lab fixture verified → security/privacy reviewed → release candidate → production approved → deprecated/revoked. `productionEnabled=false` — по умолчанию везде.
