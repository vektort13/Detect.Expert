# Проверка внешнего отзыва: 10 октября 2026

Реализовано в `apps/production-extension`; общая база Chrome/Firefox 1.1.0.
Изменения контракта и датчиков описаны в [ADR-038](../decisions/ADR-038.md).
Полный список операций: [инвентаризация](fingerprinting-inventory-1.1.0.md).

## Реализованные изменения

| Область | Что наблюдаем | Что попадает в результат |
|---|---|---|
| DET-064 | Worker, SharedWorker, Worklet.addModule | Операция, фаза, счётчик; worker-not-observed после возврата создания |
| DET-022/023 | 7 точных Math-сигнатур в Pro | api-use и known-numeric-pattern; без чисел, результата и стека |
| DET-049 | Чтение и запись document.cookie | Раздельные операции; имя записываемой cookie, скрипт, exact/sampled attribution, фаза и число вызовов |
| DET-042 | 7 Generic Sensor constructors, 3 motion/orientation events и setters | Тип обращения и фаза; без показаний |
| DET-069 | CredentialsContainer.create; Clipboard.read/readText/write/writeText | Вызов и фаза; без credential/clipboard content |
| DET-058 | WebTransport constructor | Попытка создания; без QUIC packet inspection |
| DET-014 | GPUBuffer.mapAsync/getMappedRange/unmap | Обращения к GPU buffer; содержимое buffer и Promise settlement не читаются |
| DET-074 | Set-Login, CSP, HSTS, COOP, COEP, X-Frame-Options | Присутствие заголовка и локализованное описание |
| ThreatMetrix RTC | Exact host aa.online-metrix.net после срока review | Явная stale-метка; weak-signal и исходная provenance сохраняются |
| Pro | ≤32 вариантов параметров на операцию | Одна шумная операция не занимает весь budget координатными вариантами; truncated отражает пропуски |
| Lifecycle | 16 bounded cleanup slots; writer reset/permission guards | Очистка новых наблюдений вместе с документом, pause/revoke и stop |
| Pro start/stop | Отдельный учёт адресатов start/read и epoch-проверки | Потерянный ответ больше не теряет адресата stop; поздняя команда не возобновляет остановленную запись, повторный запуск получает новый токен |
| Firefox COOP | Точная generation/URL/ISOLATED identity при смене процесса | Исправлена потеря onCommitted и присоединение к старому about:blank pending job; bounded retry без ослабления привязки документа |

Cookie attribution показывается таблицей в Cookie-панели и Pro preview/PDF.
Пустая таблица не выводится. Каждая строка сохраняет имя, скрипт, фазу и
счётчик; разные варианты не сливаются. Существующие сводные трёхколоночные
таблицы значений остаются отдельными, с 12 pt и началом с новой печатной страницы.

## Разбор остальных утверждений отзыва

| Замечание | Проверка и решение |
|---|---|
| «Любой iframe обходит все hooks» | Не подтверждено: startChildRealmManager уже перехватывает contentWindow/contentDocument, создаёт отдельный runtime и проверяет текущий документ. Покрытие поздних/недоступных реалмов остаётся ограниченным. |
| Подменить Worker URL на blob + import | Не применено: меняются CSP, Trusted Types, base URL, module/import semantics и идентичность SharedWorker. Создание наблюдается без подмены. Внутренние Worker/Worklet hooks требуют отдельной архитектуры. |
| Burst 6 Math-функций за 50 ms | Не включён как fingerprinting classifier: обычные численные задачи также дают такой burst; нет размеченного holdout-корпуса. Добавлены только точные локальные маркеры. |
| Cookie setter доказывает источник восстановления | Исправлена предпосылка: теперь виден записывающий скрипт. Это не доказывает, из какого storage пришло значение, и не исключает отказ браузера сохранить cookie. |
| WebAuthn direct/enterprise означает уникальный TPM ID | Не подтверждено. Добавлен create; параметры не перечитываются через потенциальные getters/Proxy. Attestation policy и формат не доказывают уникальный аппаратный идентификатор. |
| Clipboard отсутствует | Подтверждено частично: definitions были, installer не был подключён. Теперь четыре API реально установлены. Copy/clipboardData.setData отдельно не классифицируются как подмена. |
| Autofill traps | Не включены: положение/тип input не доказывает фишинг, нужны отдельный bounded DOM observer и отрицательные fixtures. Значения форм не читаются. |
| Speculation Rules/preconnect/dns-prefetch | Новые DOM intention detectors в этом изменении не добавлены; фактические доступные сетевые обращения остаются в сетевом отчёте. Намерение загрузки и выполненный запрос различаются. |
| Canvas readback/text/emoji → medium | Текущие Canvas operations и visual markers сохранены. Предложенные размер/цвет/временные пороги не включены без проверки false positives на редакторах, диаграммах и играх. |
| WebGL debug renderer | Уже есть отдельные именованные getParameter варианты UNMASKED_VENDOR_WEBGL/UNMASKED_RENDERER_WEBGL и getExtension. Значения отображаются через существующий Pro allowlist. |
| Audio chain → medium | Составные API уже наблюдаются. Новый intent classifier не включён: OfflineAudio rendering также используется обычным аудиокодом. |
| ≥30 font families/sec | Не включено произвольным порогом. FontFaceSet и текстовые/геометрические операции уже есть; текст и имена из произвольных font setter не добавлены в сбор. |
| ≥12 DET из одного скрипта за 2 sec | Новый sweep classifier требует script-level attribution и размеченных негативов. Одна временная корреляция не объединяет независимые скрипты. |
| ETag ≥16 символов — tracking | Не включено: длинные ETag обычны для cache validation. Хэш/повтор не доказывает пользовательский идентификатор. |
| 15 коротких font/image response — Pure CSS fingerprint | Не включено как подтверждённый detector. CDN, sprites, шрифты и ошибки загрузки дают подобные следы; webRequest не предоставляет универсальную достоверную длину body. |
| Усилить DNS-rule по NXDOMAIN/маленьким ответам | Порог не менялся. NXDOMAIN и HTTP 4xx — разные уровни; короткий CDN ответ или отсутствие имени в DOM не является размеченным negative/positive. |
| Добавить Akamai/Kasada/Castle/Imperva/F5/Riskified/Sardine/Cloudflare BM | Не активированы по одному названию, cookie или общему challenge path. В runtime остаются 32 проверенных продукта; research catalog не выдается за активные детекторы. Turnstile и Bot Management не объединены. |
| Clarity/UET/Criteo/Snap/Pinterest/Mail.ru beacon fields | Текущие Social resource profiles сохранены. Новые field decoders без отдельной документированной схемы и fixtures не добавлены. |
| iframe allow= | Presence-only security headers добавлены; анализ делегирования permission через iframe attribute остаётся отдельной задачей. |
| Event listeners + POST = keylogger | Не включено: регистрация событий и размер/частота POST не доказывают передачу нажатий. Existing interaction evidence сохраняется. |
| Leaky Forms email hash matching | Не включено: это новый сбор пользовательского ввода и анализ тела запроса, а не metadata-only расширение существующего датчика. |
| CMP + euconsent-v2 + marketing mismatch | Не включён новый юридический/consent verdict. CMP cookie catalog и Consent Mode fields не равнозначны полной реализации consent semantics. |
| Взвешенный intent score / A–F / вероятность уникальности | Не включено без калибровки. Точные признаки показываются отдельно; неизвестная вероятность не заменяется придуманным числом. |
| 200 обычных сайтов как negatives | Не являются автоматически отрицательно размеченными примерами. Precision/recall по такому набору не публикуются. Реальные library/page корпус и сайтный overhead остаются отдельной работой. |
| Периодическая проверка hooks = антидетект | Проверка владения уже используется для restore; замена JS библиотеки сама по себе не доказательство антидетекта. Постоянный timer/polling не добавлен. |
| Sampling 1/64 для всех hot getters | Не применён механически: изменил бы точность счётчиков и нуждался в контракте countQuality. Новый motion filter отсеивает чужие event types до работы наблюдателя. |
| Временно менять Error.stackTraceLimit/prepareStackTrace | Не применено: это глобальное observable состояние страницы; page formatter может выполнять произвольный код. Ограниченный существующий stack collector сохранён. |
| Pro memory explosion | Общие лимиты уже были: 256 rows/64 KiB. Улучшена справедливость бюджета: 32 parameter tuples/operation, а не заявлено исправление несуществующей неограниченной памяти. |
| Firefox TLS certificate chain доказывает MITM | Не подтверждено: getSecurityInfo требует blocking onHeadersReceived и webRequestBlocking; chain не сообщает, является ли установленный root нежелательным перехватом. Permissions не расширены. |
| Firefox originUrl/documentUrl/frameAncestors заменяют documentId | Полезны для attribution, но не равнозначны подтверждённой lifecycle identity. Не ослаблен native document binding сырого Cookie канала. |
| moz-extension probing | Автоматический перебор не добавлен. Случайный installation UUID не является стабильным публичным extension ID. |
| getComputedStyle/history | Новый горячий hook не добавлен; CSSOM/:visited classifier не объявлен реализованным. |
| Uptime | JS clocks не дают uptime ОС. Наблюдение времени не называется uptime detector. |
| Wrappers видны fingerprint-библиотекам | Подтверждено и сохранено в техническом coverage. Function.prototype.toString не маскируется. |
| Nonce аутентифицирует MAIN | Неверно: страница контролирует MAIN. Сохранены page-controlled, строгий shape/size, native sender/document identity и privileged UI separation. |

## Проверка и измерения

- Semantic/unit suites проверяют ровно один native call, receiver/new.target,
  object/Promise/ArrayBuffer identity, исходное исключение, отсутствие лишнего
  coercion/accessor read, observer faults, pause/clear/stop, ownership restoration.
- Cookie suites проверяют границы документа, bytes/rows, saturation, timeout,
  два физических слота, reset-required, посторонние window messages,
  currentScript/stack attribution, отсутствие cookie values и query.
- Chromium native fixture: classic/module/blob Worker, SharedWorker, motion,
  cookie setter/read, Math Pro install/restore, child frame, обычная form
  navigation, Pro capture, HTML preview/PDF. Проверены также reload панели
  во время записи, локализованные API-группы и Cookie writer cards при 420 px.
- Существующий native Chrome report suite проверяет реальные локальные logos,
  Social/GTM/beacons/cookies, сохранение Pro сводок и PDF.
- Firefox native fixture с прежней ошибкой COOP:same-origin после исправления
  проходит: новый HTTP document, workers, Math, writer attribution, Pro UI/PDF
  и форма. До/после: test-results/review-surfaces-2026-10-10/
  native-firefox-strict-fixture-before.json и native-firefox-coop.json.
- Точные версии браузеров, полные команды, число тестов и SHA-256 сборок:
  release evidence. Установленный Firefox проверяется
  отдельно; новая версия Firefox/Chromium не устанавливалась.

Math microbenchmark: Chromium 153.0.8010.12, 11 samples после 5 warmups,
реальные production wrappers. Pro overhead медианы: sin +84.57%, mixed seven
+150.00%, physics +231.91%. При неактивном Pro методы остаются исходными;
после снятия возможна сохранённая JIT deoptimization (+7.80…10.49% в этом
измерении). Это не замер overhead целой страницы; 5% gate не пройден и не
перенастраивался. Данные.

Независимое ревью выявило и помогло исправить поздний захват intrinsics,
расход cookie bridge admission на посторонние сообщения, повторную выдачу
после неуспешной очистки и взаимное перемещение generated blocks. Native
проверка выявила потерю Pro stop после неуспешного ответа; исправлены ledger
адресатов, поздний start, повторное использование токена и lookup binding
по фактическому ключу документа. 24 lifecycle regression tests и повторный
Chrome native сценарий с открытой панелью прошли.
Результат ревью.

## Первичные источники

- [MDN: Worker constructor](https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker)
- [Chrome: content scripts и execution worlds](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [FingerprintJS: math.ts](https://github.com/fingerprintjs/fingerprintjs/blob/27126b84755e0fe935255c9a94e1e1e8ad1ae919/src/sources/math.ts)
- [W3C WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)
- [MDN: webRequest.getSecurityInfo](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/getSecurityInfo)
- [Castle: текущая схема Browser SDK](https://docs.castle.io/docs/sdk-browser)
