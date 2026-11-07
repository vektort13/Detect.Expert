# detect.expert — правила проекта

Продукт: Chrome-расширение Manifest V3 «detect.expert» — информационный анализатор браузерных проверок.
Полное ТЗ: `Doc/Detector_Enterprise_Technical_Spec_RU.md` (части I–VI). Контракты и каталог-семена старта: `Doc/Detector_Implementation_Pack/Detector_Implementation_Pack/{contracts,catalog}`.
Эти правила — неизменяемые границы. Их нельзя «обойти в реализации»; изменение = новая версия ADR.

## Неизменяемые границы (REQ-001…REQ-015, ТЗ часть I §3.3)

Прямое решение владельца продукта ADR-076 разрешает явное подключение одной зоны Cloudflare для чтения Precursor: фиксированные GET к api.cloudflare.com, токен только в RAM собственного UI/background и TRUSTED storage.session (не на диске), без посещённых URL. Общий report repository получает только allowlisted report/index/fence значения. Ключи перечисляются через native getKeys; только в Firefox без этого API узкий привилегированный helper по ADR-076 временно получает native map через get(null), возвращает только Object.keys и не передаёт карту или значения репозиторию. Ошибка существующего getKeys не разрешает fallback. Токен не попадает в отчёты/экспорт/логи. Остановка worker восстанавливает соединение из памяти сессии с повторной проверкой API; закрытие браузера/Disconnect удаляют токен. CSP получает только этот API host, notifications — опциональное разрешение кнопкой пользователя. Режим зоны и пассивное обнаружение ресурса разделены; исключение не расширяет основной сенсор, Protect или сбор пользовательских заголовков.

По прямому решению владельца продукта от 2026-11-06 ADR-109 разрешает необязательный блок Proxy Manager Geolocation API: явное включение и ключ пользователя; фиксированные GET из собственных страниц расширения (Options и страница настроек блока) к шести хостам четырёх провайдеров (MaxMind GeoLite/GeoIP, ipgeolocation.io, ipdata, ip-api.com; CSP получает только эти хосты, ip-api.com без ключа — незашифрованный HTTP по отдельному подтверждению), единственный клиент — `proxy-geo-client.js`; отправляется только публичный внешний IP прокси, найденный ручной проверкой (частные адреса — никогда), и ключ, без cookie, referrer, redirect, посещённых URL и данных прокси. Запросы — после ручной проверки (опция), по кнопке и при проверке ключа; таймеров и запросов при открытии списка нет. Ключи — `storage.session` (TRUSTED_CONTEXTS), на диск в `storage.local` только по галочке «Запомнить ключи»; в отчёты, экспорт, логи, снимки и сообщения не попадают. Результат — нормализованная запись «по данным провайдера» (кэш ≤200, 30 суток) без вердиктов и без влияния на маршрут, Antidetect или Protect. Остальные границы, ADR-070 и ADR-076 не расширяются.

Прямое решение владельца продукта ADR-069 разрешает отдельный Cookies workspace: cookie values только в памяти собственного top-level Options и в явно подготовленном/подтверждённом пользователем локальном импорте/экспорте. Это не расширяет MAIN/ISOLATED/SW, отчёты, storage, логи или metadata-only Browser Debug по ADR-063. Cookies не расширяет permissions/CSP; DBSC по ADR-044 не возвращается. Отдельное применение Chrome Debugger в Автосерфере разрешено только последующим ADR-075.

1. **Только информирование.** Нет блокировки, подмены результатов, обхода антифрода, решения CAPTCHA, экспорта пригодного отпечатка, активного сканирования сети. Расширение не рендерит тестовый canvas, не измеряет шрифты, не запускает аудио/DNS/WebRTC/порт-тесты сам.
2. **Обёртка вызывает оригинал ровно один раз** с исходными `this` и аргументами, возвращает исходный результат (включая `NaN`, `-0`, идентичность объектов и Promise), пропускает исходное исключение. Ошибка наблюдателя подавляется отдельно и влияет только на статус сенсора. Никакого `String()`/`Number()`/JSON произвольного аргумента (coercion вызывает пользовательский код). Не добавлять `.then/.catch` к чужим Promise.
3. **Не маскировать обёртки.** Не патчить `Function.prototype.toString`, не подделывать `name/length` под «нативность» (допустимо только копирование дескрипторов как compatibility-мера). Обнаружимость инструмента — известное ограничение, оно описано в UI.
4. **MAIN-world сообщения недоверенные** (`integrity: page-controlled`). `event.source === window`, nonce, bootId — это маршрутизация, не аутентификация. Page payload не может: инициировать export/fetch/clear/pause, менять политики, читать чужие отчёты, задавать `tabId/frameId/documentId`. Эти ID берутся только из `MessageSender` и `webNavigation`.
5. **Не хранить и не передавать через мост:** пиксели/dataURL/readPixels/аудио-семплы/результаты Math/аргументы Math, строки измеряемого текста, точные значения hardware/screen/fonts/codec, нажатия/координаты/текст форм/clipboard, cookie values/токены/Authorization/тела запросов и ответов, полный URL (query/fragment/userinfo/ID в path), сырой stack, ICE-кандидаты/IP, случайные DNS-labels. Допустимы: тип операции, насыщаемый счётчик, enum signalCodes, нормализованный host, безопасный path template, rule ID.
6. **Coverage всегда рядом с выводами.** «Не обнаружено» = «не наблюдалось в доступной области за период». Состояния: `active | partial | late-start | paused | unsupported | no-access | degraded`.
7. **Нет вердикта безопасности сайта.** Распознанный вендор ≠ доверие. Заголовок раздела: «Распознанные сервисы защиты и идентификации», не «легитимные антифрод-системы». Не «сайт украл отпечаток» по одному `toDataURL`.
8. **Никаких непроверенных сигнатур в production.** Все правила из `catalog/vendors.seed.json` остаются `productionEnabled=false`, `fixtureVerified=false`, пока нет positive+negative fixtures, source, reviewer.
9. **Каждый документ отдельно** (`documentId`), включая pending/committed навигацию, BFCache, prerender, SPA, iframe reuse. Отменённая навигация не стирает текущий отчёт. Дедуп по `(documentKey, bridgeSessionId, batchSeq)`; ACK после сохранения snapshot+watermark; потеря буфера = явный gap, не тихая потеря.
10. **Без сервера и без исходящего трафика по умолчанию.** CSP extension pages: `script-src 'self'; object-src 'none'; connect-src 'none'; base-uri 'none'; frame-ancestors 'none'`. Нет remote code, нет интерпретатора удалённых команд (в т.ч. JSON-правил с regex/логикой), нет telemetry, нет внешних шрифтов/иконок, нет `storage.sync` для отчётов.
11. **Bounded everything.** Лимиты v1 (ТЗ часть VI, I1): 32 событий/batch, 16 KiB/batch, строки ≤512, 20 batch/s/document, 100/tab, 200/extension, bridge ring 512, flush 250–500 ms, ≤128 счётчиков/document/группа, ≤256 находок и ≤128 hosts/document, 100 KiB/report, 4 MiB session total, TTL неактивного документа 10 мин, out-of-order карантин 2 с/128 записей, Math ≤8 stack samples/2 s/realm. При превышении — деградация с явным `coverageFlags`, не зависание и не бесконечный retry.
12. **Отзыв разрешений/политик учитывается на лету:** stop new data, unregister, best-effort cleanup только при проверке владения дескриптором; полное удаление обёрток — после reload, UI об этом говорит.
13. **Экспорт только того, что показано в preview** (redacted по умолчанию); передача организации — отдельное действие.
14. **Не скрывать влияние hooks на страницу.** Никаких обещаний «невидимости» и «100 % покрытия». Workers/WASM/CSS/серверный fingerprint — явные пробелы coverage.
15. **Не выдумывать пройденные тесты, vendor-документацию или поддержку API.** Отсутствие подтверждения = `candidate/unknown`. Отчитываться о фактических результатах команд.

## Исключения для opt-in модуля «Защита» — только по ADR-020-protect и ADR-047

В production-расширении (`apps/production-extension`) модуль переносится по ADR-047 из коммита `722fae8`: исходники — вендорная копия `vendor/protect-722fae8/**`, production-адаптер — `apps/production-protect/**`; ниже пути vendored-кода указаны относительно `vendor/protect-722fae8/`. Модуль поставляется только в Chrome-сборке. Модуль «Защита» выключен по умолчанию. Включает его только пользователь после экрана согласия (`PROTECT_CONSENT_VERSION`): из Options либо, по ADR-053, из собственных launcher popup/sidepanel через тот же диалог. Изменение разрешает только enable для точного списка UI-страниц; остальные расширяющие настройки сохраняют Options-only. Организация может модуль только запретить политикой `ProtectModuleDisabled`; политики включения нет. Пока модуль выключен, REQ-001…015 действуют без исключений, а наблюдение работает так же, как без модуля (`tests/extension/protect/module-off.spec.ts` в 722fae8 и нативная проверка production по ADR-047). Для включённого модуля и только в объёме ADR-020-protect:

- **REQ-001.** Разрешены: правила `declarativeNetRequest` только `block`/`allow` (dynamic и session) по решению пользователя или выбранному им пресету; `modifyHeaders` ровно `Sec-GPC: 1`; свойство `navigator.globalPrivacyControl` (обычный getter, без маскировки), если пользователь включил GPC; наблюдающие MAIN-обёртки модуля `fetch`, `XMLHttpRequest.prototype.open/send`, `Navigator.prototype.sendBeacon`, `EventTarget.prototype.addEventListener`, `MutationObserver.prototype.observe` — по правилам REQ-002/003. По-прежнему запрещены: `redirect`, `upgradeScheme`, `allowAllRequests`, `removeHeaders` и любые другие заголовки; подмена результатов API; обход антифрода и CAPTCHA; пресеты против сервисов защиты; запись в поля страницы, клики и submit от расширения; вызов функций страницы (CMP); собственный отпечаток; активное сканирование; `/.well-known/gpc.json`.
- **REQ-005.** Разрешено: читать значения полей e-mail, телефона и имени в ISOLATED world после доверенного ввода — только через `packages/collector/src/protect/field-value.ts`; передавать в SW только ключевые отпечатки вариантов значения (память SW, TTL 15 мин); держать тела исходящих запросов вкладок с активным вводом в памяти SW (≤ 64 КиБ на запрос, токены ≤ 10 с); передавать через канал `detect.expert/protect/v1` только `ScriptRef` (маскированный host + безопасный шаблон пути), enum и счётчики. Никогда: значения паролей, полей, бывших паролем, платёжных полей и одноразовых кодов — ни одним слоем; обёртки getter `value` в MAIN; значение и производные от него (отпечаток, хэш, маска, длина) — в storage, IndexedDB, проекциях, экспорте, логах, диагностике и сообщениях MAIN↔ISOLATED; cookie, заголовки (кроме проверки `Sec-GPC`), тела ответов, полный URL, сырой stack.
- **REQ-010.** Разрешена IndexedDB расширения `detect-expert-protect` (пишет только SW) для сайтов-исключений, решений фаервола, истории «Кто вас узнаёт» (отдельная галочка, срок 7/30/90 дней, индикатор, очистка) и журнала запросов о данных. По-прежнему запрещены: собственный сетевой запрос (CSP `connect-src 'none'`), сервер-канарейка, telemetry, `storage.sync`, удалённые правила.

Остальные границы (REQ-002…004, 006…009, 011…015) действуют для модуля полностью. Вывод модуля показывается только с доказательством, `interpretationConfidence` и ограничениями покрытия; вердикта о безопасности сайта нет. «Остановлено» пишется, только если наше правило действовало до запроса и Chrome сообщил `net::ERR_BLOCKED_BY_CLIENT`; иначе — «отправлено» или «исход не наблюдался». Имена модуля — только из `packages/contracts/src/protect*.ts` (`ui-protect-*`, `protect-hello|arm|input|events|ack|control`, `protect-main-*`, `protect-relay-*`). Изменение раздела — только новой редакцией ADR-020-protect.

По прямому выбору владельца popup внутри страницы (ADR-058) разрешён отдельный внутренний канал `protect-overlay-*` между SW и exact-document ISOLATED UI. MAIN не пересылает команды. Строгий native MessageSender/frame 0/documentId/generation и текущий prompt/revision/receivers ограничивают inline решения режимом once и Undo собственных once-решений; постоянные правила и общая пауза требуют доверенной страницы расширения. Это не расширяет чтение ввода/тел, хранилища, сетевые возможности, consent или произвольный привилегированный UI channel.

## Явное исключение для Custom API — ADR-048

Прямое решение владельца продукта исправить реальные CSS/layout, Worker и отложенные
Promise уточнено ADR-101:
одна явно открытая собственная Chrome-сессия использует существующий debugger,
закрытый native Emulation allowlist и packaged dedicated-Worker bootstrap.
Отдельный локальный MediaCapabilities relay переносит только transient canonical
codec primitives в приватный backend расширения с native sender/document/scope
проверкой; raw capabilities и handles не выходят. С раунда 5 (ADR-108) relay и backend
обслуживают только конфигурации с ключевой системой, остальные конфигурации MediaCapabilities выполняют родной вызов страницы, а Custom может ответ только
понизить. UAData Custom использует
выбранный snapshot без high-entropy backend. Полные границы, исключения,
физические in-flight fence и неподдерживаемые контексты перечислены в ADR-101;
это не разрешает произвольные CDP-команды, маскировку, новые permissions,
телеметрию, изменение Protect или обещание универсального покрытия.

По прямому решению владельца продукта ADR-087 расширяет
Custom каталог15 bundles, native Intl formatting и Math sqrt/cbrt/hypot.
Формат6/catalog7 мигрирует прежние global/site/library значения без включения
новых строк. Узкие исключения original-call-once: private выбранный Intl formatter,
второй нормализованный Canvas font setter, WebGL private readback destination и
необходимые readonly PACK/framebuffer state queries. Virtual Plugin/MIME records
являются метаданными; capabilities и executable plugins не создаются. Полные
границы и проверки перечислены в ADR-087. Native masking, произвольная эмуляция
Worker/JIT/WASM/GC/TLS, новые permissions/каналы и изменение Protect не разрешены.

Продолжение по прямому решению владельца продукта — ADR-100:
существующие Temporal.Now default-zone методы используют выбранную Intl/legacy
timezone без второго чтения часов; только omitted/undefined zone заменяется
trusted primitive в том же native call. Один captured Intl formatter при установке
проверяет/канонизирует выбранную zone, не измеряя среду. Ограниченный JS media
evaluator покрывает дополнительные формы запросов и трёхзначную логику, не меняя
stylesheet/layout engine. Активные async Custom операции могут отказать до backend
при изменённых проверяемых Promise/inherited-then descriptors; ordinary clean
operations и OFF остаются native по прежним правилам. Отложенные native цепочки,
Worker injection и полная эмуляция движка этим не разрешаются и не объявляются
покрытыми. Подробные границы и проверки — в ADR-100.

Дополнение по запросу владельца проверить каждую функцию Антидетекта —
ADR-104, дополнение 2: при включённой
строке `intl-formatting` в Custom `Date`/`Number`/`BigInt` `toLocale*String` и
`String#localeCompare/toLocaleUpperCase/toLocaleLowerCase` подставляют выбранную
локаль только вместо отсутствующего или `undefined` аргумента `locales` тем же единственным
native-вызовом (без приведения аргументов; `null`, `''` и `[]` остаются native), а явные
`locales/timeZone/calendar/numberingSystem` страницы в Intl-конструкторах побеждают выбранные
значения. Отказ при изменённых Promise-описателях (ADR-100) приходит отклонённым Promise.
Подтверждено владельцем 2026-11-05.

По прямому решению владельца продукта от 2026-11-05 ADR-105 распространяет
Custom-подмену `navigator.userAgent`/`languages`/`userAgentData` на исходящие заголовки запросов Chrome. Разрешены только динамические
правила `declarativeNetRequest` `modifyHeaders` (только `requestHeaders`) в диапазоне 300100…300119, priority 1000, и только два действия.
`set`: `User-Agent`, `Accept-Language`, `Sec-CH-UA`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform` из тех же Custom-строк (подсказки — только https, без WebSocket).
`remove` (никогда `set`, ничего не добавляется): высокоэнтропийные `Sec-CH-UA-*`, а также `Device-Memory`, `DPR`, `Viewport-Width`, `Sec-CH-Viewport-Height`,
`ECT`/`RTT`/`Downlink`, `Sec-CH-Prefers-*` и их `Sec-CH-*`-формы — каждое лишь пока включена его собственная Custom-строка (`device-memory`,
`window-device-pixel-ratio`, `screen-geometry`, `network-information`, `css-media`); а также `X-Client-Data` (правило 300109) — лишь пока применённая Custom-идентичность называет не Google Chrome
(список брендов `client-hints` без «Google Chrome» либо User-Agent другого продукта). Запросы самого расширения исключены (`excludedInitiatorDomains`);
область — ровно all-sites HTTP+HTTPS и только при готовом раннем реестре, иначе `unsupported` без правил, идентичность применяется целиком; Firefox не
поддерживается. Это исключение из REQ-001 только для Antidetect: запрет модуля «Защита» (`modifyHeaders` ровно `Sec-GPC: 1`) не меняется. Значения заголовков
не читаются и не логируются; новых permissions, CSP, сети и каналов нет; маскировка, TLS/JA3/HTTP2, `Width`/`Save-Data` и воркеры не обещаются.

Продолжение по прямому решению владельца продукта — ADR-106: формат 7 / каталог 8; новых permissions, CSP,
сети, каналов и зависимостей нет. Приватные ключи шума Canvas и Math живут весь срок применённого профиля: локальный корень в `storage.local` и HMAC
от применённых Custom-строк; в экспорт, отчёты, логи и на страницу они не попадают. Canvas получает алгоритм `sparse-rgb-v1` (около 1% непрозрачных
пикселей на один уровень, PNG плоского холста не раздувается); пиксели и хеши по-прежнему не покидают страницу. Уровень «Максимальная защита» задаёт
нейтральные Custom-значения вместо блоков (блок остаётся только у строк без формы значения). Строка `geolocation` получает Custom: выбранные
latitude/longitude/accuracy видны только в УСПЕШНОМ нативном результате — заменяются атрибуты настоящих `GeolocationCoordinates` и `toJSON`, каждая замена
один раз вызывает нативный аксессор с исходным `this`; методы запроса, колбэки, разрешение, ошибки и `timestamp` не оборачиваются, позиция без нативного
успеха не создаётся (в непрозрачных realm запрос отклоняется SecurityError до нативного вызова). При активном `storage-estimate: Custom` тот же выбранный
снимок отдают `StorageBucket.prototype.estimate` и `queryUsageAndQuota`/`requestQuota` у `navigator.webkitTemporaryStorage`/`webkitPersistentStorage`: для
распознанного получателя original не вызывается (bucket — чистый native brand-геттер `name`, deprecated-объект — приватный реестр), чужой получатель и ошибки
аргументов уходят в original один раз; callback вызывается задачей, `size` приводится по WebIDL ровно один раз, quota-проб нет. WebRTC `host: 'mdns'`
показывает в метаданных случайное имя `<uuid>.local` вместо IP хоста (сетевой маршрут не меняется). Оффлайн-справочник «страна → язык, зона, координаты»
(tzdata, CLDR; без сети) лишь заполняет существующие Custom-строки. Workers, IP, TLS и серверная геолокация не затрагиваются.

По прямому решению владельца продукта сверить расширение с ShardBrowser и взять лучшее — ADR-107: формат 8 /
каталог 9 (каталог 8 раунда 3 заморожен и строго мигрирует); код и тексты ShardBrowser не копируются; новых permissions, CSP, сети, каналов и зависимостей нет.
Звук, WebGL readPixels и Network Information получают приватные ключи профиля из корня ADR-106; `readPixels` повторяет проекцию Canvas побайтно; холсты до
512×512 помечаются целиком; Custom-значения принимают форму Chrome (`MemoryInfo` с живыми used/total не выше выбранного лимита, шаг сети 50 мс / 50 кбит/с
с множителем по сайту, `usageDetails`, согласованность уведомлений с Permissions/Push); голоса и устройства только отбираются из настоящих, ничего не создаётся.
Собственная страница Options один раз на открытие читает в память параметры этого браузера (`deviceMemory`, лимит кучи, один контекст WebGL: строки
`WEBGL_debug_renderer_info` и шесть `getParameter`, `requestAdapter` без устройства, состояние прокси) — без рисования, `readPixels`, шейдеров, хранения,
сообщений, экспорта и логов; это не проба по решению сайта. «Подогнать окно» вызывает `chrome.windows.update` только по нажатию. Импорт и новые метки
конфигурации отклоняют управляющие и bidi-символы. Автоматическое определение страны по IP и автоматизация не разрешены; отметка полупрозрачных пикселей
Canvas разрешена позднее по ADR-108.

По прямому решению владельца продукта от 2026-11-06 закрыть открытые пункты ADR-107 и сделать красивый прокси-менеджер — ADR-108:
формат 9 / каталог 10 (каталог 9 раунда 4 заморожен побайтно и строго мигрирует); новых permissions, CSP, сети, каналов и зависимостей нет. Запись профиля библиотеки
получает `tags` и `note` (без управляющих и bidi-символов); политика WebRTC `proxy_only` существует только в Firefox, Chrome её отклоняет (`webrtc-policy-unsupported`).
Custom `media-capabilities` может только понизить ответ этого браузера: единый список скрытых семейств кодеков действует для MediaCapabilities, `canPlayType` и
`isTypeSupported` (оригинал один раз, читается только примитивная строка без приведения). Полупрозрачные пиксели Canvas помечаются одним сохранённым состоянием,
которое сам движок вернул бы для пикселя; движок без измеренной арифметики остаётся настоящим; production-код не рисует холсты (измерение только в тестах). Прокси:
профили HTTP и HTTPS (без логина браузер подключается сам, с логином — через loopback-реле companion и `CONNECT` с Basic), SOCKS5 по RFC 1928/1929, типизированный
`diagnose` без сохранения, метка страны — собственная заметка пользователя без определения по IP, история ручных проверок в `storage.local` (с переключателем; без URL,
хоста и логина; не экспортируется). Библиотека профилей: теги и заметки, корзина на 7 дней, временные профили на сеанс браузера (возврат при перезапуске), связка
профиль↔прокси только локально и «Применить вместе с прокси» как явное подключение; экскурсия по Options (`ui-tour:v1`, с ADR-111 — `ui-tour:v2`) — чисто интерфейсная функция. Не разрешены и не
делаются: подмена частоты кадров, список шрифтов для `FontFace local()` (разрешён позднее по ADR-110), расширение подмены масштаба текста; раскладка клавиатуры
отложена.

По прямому решению владельца продукта от 2026-11-07 реализовать опцию «Шрифты» для HTML/CSS — ADR-110 (реализации в ShardBrowser нет, это закрытый движок;
реализация собственная, код и тексты не копируются): при включённом мастере Antidetect и строке Custom `canvas-font-policy` (в интерфейсе «Шрифты») известные имена шрифтов из встроенного
ASCII-списка `font-probe-names.js` (716 имён), которых нет в списке профиля, измеряются страницей как отсутствующие через DOM, SVG, Canvas и `FontFace local()`. Механизм: одна принятая
документом таблица стилей (`adoptedStyleSheets`, MAIN, document_start) с гранью на каждое скрытое имя (источники только `local(Arial)` и т. п., `unicode-range: U+10FFFF`,
`font-stretch: 200%`) и один хук — Proxy над `FontFace`, заменяющий в строковом источнике `local("скрытое имя")` до единственного нативного вызова (узкое исключение original-call-once,
как второй нормализованный Canvas font setter ADR-087; у Proxy есть ловушка `setPrototypeOf`, `toString`, `name` и `length` не маскируются). Расширение ничего не измеряет и не рисует,
страницы не читает; новых permissions, CSP, сети, каналов, ключей хранилища и зависимостей нет; формат 10 / каталог 11 не менялись. Щит виден странице и не покрывает имена вне списка,
собственный `@font-face local()` страницы, Workers, изолированные sandbox-фреймы, точные метрики и шрифты, которых нет на хосте (они не создаются). Дополнение того же дня: псевдонимы
Windows `Courier`, `Helvetica`, `MS Sans Serif`, `MS Serif`, `Times` входят в список Windows; «Шум списка шрифтов» делается при генерации профиля («Строгий», детерминированно по seed
профиля, около 3 % необязательных семейств, 29 обязательных корней не убираются; включён по умолчанию, результат виден и редактируется); для заявленного региона (Japan; Korea; China и
Singapore; Taiwan, Hong Kong и Macao) список получает региональные CJK-шрифты Windows (33 английских ASCII-имени; регион берётся из часового пояса, не из IP), шум их не убирает;
строка переименована в «Шрифты».

По прямому решению владельца продукта от 2026-11-07 добавить экскурсию на каждую вкладку Options и убрать полосу под шапками — ADR-111:
12 экскурсий (49 шагов) и одна общая кнопка «Экскурсия» в строке шапки каждого раздела слева от главного переключателя (у раздела без него — последним элементом строки); «Обновить» и
«Экспорт» стали иконками шапки. Это чисто интерфейсная функция: экскурсия ничего не меняет, не читает страницы и отчёты, не вызывает `chrome.*`; новых permissions, CSP, сети, каналов
сообщений и зависимостей нет. Прогресс — `ui-tour:v2` в `localStorage` страницы Options (`ui-tour:v1` читается один раз как экскурсия Antidetect). Кнопку регистрирует оболочка Options
в `ui-tour-slot.js` (модуль без импортов), поэтому движок и тексты (~400 КБ) загружает только Options. В Firewall кнопку получает остров модуля «Защита» свойством `toolSlot`
как функцию-изготовитель (у страницы и модуля разные копии Preact); `vendor/protect-722fae8/**` не менялся, без свойства разметка launcher прежняя. В `browser-adapter.js` (Firefox)
события `webNavigation.on*` и `webRequest.on*` получили `removeListener` и `hasListener`. Тексты на 19 языках — машинный перевод; носители языка его не проверяли (`docs/translations.md`).

По прямому решению владельца продукта от 2026-11-07 проверить подмену Canvas и WebGL по 30 методам тестовой страницы анти-подделки — ADR-112:
формат 10 / каталог 11 (каталоги 1–10 заморожены побайтно и строго мигрируют); новых permissions, CSP, сети, каналов и зависимостей нет. Новый алгоритм Canvas `sparse-rgb-v2`
(чётностный идемпотентный шум; плоские холсты до 262 144 пикселей с не более чем четырьмя значениями RGBA остаются родными; насыщенные каналы 0/1/254/255 не двигаются); экспорт
WebGL-холста подчиняется тому же правилу, что 2D, `readPixels` повторяет ту же проекцию, `WEBGL_lose_context` не скрывается никогда. Алгоритмы `sparse-rgb-v1` и `stable-rgb-v1`
побайтно прежние, сохранённые профили остаются на v1 до пересоздания. Обёртки-Proxy Custom отказывают в замыкании цикла прототипов тем же `TypeError`, что движок (ловушка
`setPrototypeOf`); обёртки-функции копируют `name` и `length` с оригинала (копирование дескрипторов как мера совместимости, не маскировка). `Function.prototype.toString` не патчится,
пиксели и их хэши не покидают страницу, production-код не рисует холсты, оригинал вызывается ровно один раз (REQ-001…003); невидимость не обещается (REQ-014).

По тому же решению — ADR-113: необязательный режим «не запускать датчики наблюдения, пока включён Antidetect» (карточка
в Antidetect, уровень «Сеть»; ключ `storage.local['antidetect-quiet-sensors:v1']`, по умолчанию ВЫКЛЮЧЕН, не входит в `api-configuration:v1`, экспорт и отчёты). Когда режим включён
и включён мастер Antidetect, регистрация скриптов `detector-isolated-v1` и `detector-main-v1` снимается (на новые страницы датчики не ставятся), Детектор показывает такой документ как
`paused` с причиной (REQ-006). Custom-скрипты Antidetect, правила DNR, API Guard и модуль «Защита» не затрагиваются. Это не маскировка: датчики просто не запускаются, следы собственных
обёрток Antidetect остаются и названы в интерфейсе; новых permissions, CSP, сети и каналов нет. Владелец (2026-11-07) решил оставить режим как есть.

Прямое решение владельца продукта исправить FP-12/13 уточнено ADR-085:
только `storage-estimate: Custom` возвращает выбранный async snapshot без native
quota operation. Lazy native Navigator.storage getter регистрирует identity;
unknown receiver получает native brand rejection через приватный invalid sentinel,
не через исходный this. Это узкое исключение original-call-once для данного API;
OFF/Allow/Bypass и остальные API прежние. Нет quota probes, других storage calls,
global prototype changes, новых каналов, permissions или raw quota storage.

Продолжение по прямому решению владельца продукта — ADR-086:
ранее сохранённые StorageManager из доступных same-origin окон проверяются
ленивым сравнением identity через captured pristine Window.navigator/storage
getters. Bounded parent/child/opener обход и пассивные Window.open hints не
включают чужой Custom profile и не вызывают estimate или другие backend API.
Fake/Proxy и недоступные никогда не аутентифицированные объекты остаются
отклонёнными. Это не расширяет permissions/CSP, каналы или остальные API.

По техническому заданию владельца от 2026-10-20 разрешены выбранные пользователем тестовые значения для API, перечисленных в `packages/contracts/src/api-configuration.mjs`, их постоянное локальное хранение и переносимый JSON. Только при включённом общем выключателе и режиме Custom разрешена намеренная подмена соответствующего успешного результата и преобразование Promise. Это исключение из REQ-001/002/005/013 относится к пользовательским настройкам, не к наблюдаемым значениям страницы. Существующие наблюдающие hooks, правила чтения паролей и модуль «Защита» не меняются. Отсутствующие API и реальные устройства не создаются; нет маскировки, сети и интерпретации кода из JSON. Уточнение владельца о раннем применении без раскрытия native значений реализуется по ADR-049: необходимое native `userScripts` — required в Chrome, optional-only в Firefox; остальные permissions/CSP не расширяются. В inaccessible opaque realms допускается удержание покрываемых значений нейтральными без выдачи native, что отдельно обозначается в coverage. Контракт и ограничения определены ADR-048/049 и `docs/coverage/api-custom.md`.

Дополнение по прямому решению владельца продукта — ADR-060: WebRTC Custom IP/relay, случайные псевдонимы доступных идентификаторов устройств и настоящие DTLS identities. Разрешена отдельная browser-wide `privacy.network.webRTCIPHandlingPolicy` только после явного выбора и optional разрешения `privacy`; текущий эффективный статус проверяется нативным API. Это не назначение произвольного сетевого source IP и не внешнее реле. Закрытые ключи не читаются, fingerprints отдельно не подделываются; HTTPS/TLS-сертификаты исключены владельцем из задачи. Format2/catalog3 мигрирует прежние конфигурации без потери сохранённых данных.

Прямое решение владельца продукта о Math реализуется по ADR-065: только выбранные двадцать Math-функций в Opt-in Custom могут детерминированно сдвигать покрываемые успешные числовые результаты до1ULP. Нативный вызов остаётся единственным, this/arguments/coercion/throw сохраняются, точные и специальные случаи не меняются. Нет Function.toString masking, workers injection, подмены **, передачи фактических аргументов/результатов, нового privileged канала, permissions/CSP/сети. Private session key не входит в переносимый format3/catalog5 JSON. Подробная семантика, opaque fallback и границы перечислены в docs/coverage/math-transcendentals.md.

По новому прямому решению владельца продукта ADR-066 разрешает библиотеку полных API профилей в прежнем CAS/JSON format4/catalog6 и отдельный opt-in Canvas Custom. Только для запрошенного страницей readback разрешены временные локальные пиксели и приватные производные canvas copies/encoders с сохранением исходного bitmap; это не самостоятельный probe. Пиксели и их хеши не попадают в storage/bridge/логи/отчёты. Покрываемые полностью непрозрачные RGB меняются на один уровень, alpha сохраняется; unsupported/over-limit/opaque случаи удерживаются, не возвращают native изображение. Private session key не переносится с профилями. Наблюдающие сенсоры, Firewall, permissions/CSP/сеть/toString и непокрытые Workers/WebGL readPixels/WebAudio/font metrics не меняются.

По прямому ТЗ владельца ADR-064 разрешает раздел Antidetect: прежнюю единую API конфигурацию format3/catalog4, независимые IPv4/IPv6 RTC metadata, закрытые ранние запреты WebRTC/WebSocket/WebTransport и точечные Chrome DNR block resourceTypes websocket/webtransport с IDs 300000/300001. Это узкое продолжение ADR-048/049/060: без новых permissions/CSP, общего UDP/QUIC/IPv6 firewall, внешней сети или изменения Firewall ranges. Возможности и проверенные границы перечислены в docs/coverage/antidetect.md; исторические наблюдающие сенсоры и запрет чтения паролей не меняются.

## Явное исключение для встроенного Автосерфера — ADR-075

По прямому решению владельца продукта и явному выбору Chrome Debugger от 2026-10-30 ADR-075 разрешает встроенный Options workspace рядом с Cookie Doctor: пользовательская очередь URL, навигация в собственной созданной вкладке, настоящее наведение/прокрутка через фиксированный allowlist CDP Input и агрегаты Performance. Required `debugger` добавляется только Chrome; Firefox запуск не поддерживает. Исключение из ADR-044 относится только к Автосерферу, DBSC не возвращается. Конфигурация пользовательских URL хранится отдельно в IndexedDB; временные координаты/ссылки и trusted session checkpoint не входят в детекторы, MAIN, логи и redacted экспорт. Никаких кликов/клавиатуры/форм/CAPTCHA, скрытия debugger, подмены профиля, произвольных CDP-команд или новых внешних соединений расширения. Start/Resume — действия пользователя; Stop и потеря владения немедленно инвалидируют активность. Полные границы, лимиты и метрики определены ADR-075.

## Канонические поля (ТЗ VI, I1.1) — единственные wire-имена

По прямому решению владельца продукта ADR-070 разрешает самостоятельный Proxy workspace: required proxy, optional nativeMessaging, собственный Options-only port, локальный Go companion с DPAPI и pinned Xray/userspace OpenVPN. Явный connect/autoConnect обслуживает только настроенный пользователем сервер и браузерный SOCKS traffic; системные TUN/маршруты не меняются. Не разрешены автоматические IP checks/subscriptions/updates, MAIN-доступ к proxy API или экспорт credentials в отчёты/storage. Проверка конкретного предоставленного сервера разрешена отдельным решением владельца продукта в одноразовых профилях. Границы наблюдающих сенсоров и password privacy не меняются.

По следующему прямому решению владельца продукта ADR-071 разрешает проверку сохранённого proxy вручную без смены browser route и копирование одного/всех профилей в полный JSON, включая конфиг, логин, пароль и keys. Для этого optional clipboardWrite запрашивается только по кнопке Copy; clipboardRead не добавляется. Native export идёт исключительно в ответ собственного Options, не в broadcast/snapshot/log/report/storage. Секреты остаются RAM только до clipboard write и очищаются на уходе. Это отдельное пользовательское действие, не изменение metadata-only обычного экспорта.

`evidenceSource: browser-network | browser-navigation | page-hook | page-dom | derived`
`integrity: browser-observed | page-controlled | derived`
`interpretation: api-use | possible-fingerprinting | fingerprinting-pattern | local-probe-pattern | dns-test-pattern | unknown`
`interpretationConfidence: low | medium | high | unassessed`
`attributionConfidence: exact-resource | sampled-stack | frame-only | unknown`
`vendorConfidence / vendorMatch: documented-resource | multi-signal | weak-signal | none`
`coverageState: active | partial | late-start | paused | unsupported | no-access | degraded`
`countQuality: exact | sampled | lower-bound`
`phase: attempted | returned-sync | threw-sync | async-returned | settlement-unobserved`
Не вводить параллельные имена (`observationSource`, `techniqueConfidence`, `page_observed` и т. п.). `techniqueId` = `DET-001…DET-069`.

## Протокол v1 (имена сообщений, единый источник — `packages/contracts`)

- MAIN → ISOLATED (`window.postMessage`, `event.source === window`, поле `channel: 'detect.expert/v1'`, `sensorBootId`): `sensor-hello`, `sensor-batch`, `sensor-status`.
- ISOLATED → MAIN: `bridge-hello`, `bridge-pause`, `bridge-resume`, `bridge-stop` (protocol mismatch / revoke).
- ISOLATED → SW (`chrome.runtime.sendMessage`): `PageBatch { schemaVersion: 1, type: 'sensor-events', sensorBootId, bridgeSessionId, batchSeq, observations[≤32], coverageDelta[] }`. Ответ SW: `Ack { schemaVersion: 1, type: 'ack', lastCommittedBatchSeq, paused, protocolOk }`.
- UI (popup/sidepanel/options; sender.origin === chrome-extension://<id>) → SW: `ui-get-report`, `ui-pause`, `ui-resume`, `ui-clear`, `ui-set-scope`, `ui-export-preview`. Ответ: `ReportProjection { reportRevision, documentKey, host, coverageState, coverageFlags, techniques, findings, vendors, dropped }`.
- `runtime.onMessage` listener: синхронный, `return true` + `sendResponse` (переносимый контракт), регистрируется на верхнем уровне SW.
- Модуль «Защита» (ADR-020-protect, ADR-047): ISOLATED `protect.js` → SW `protect-hello|arm|input|events` (ответ `protect-ack`), SW → ISOLATED `protect-control`; MAIN↔ISOLATED канал `detect.expert/protect/v1` (`protect-main-hello|batch`, `protect-relay-hello|pause|resume|stop`); UI → SW `ui-protect-*` (расширяющие действия — только из Options). В production `protect-sw.js` имеет свой верхнеуровневый `runtime.onMessage`, отвечает только на типы модуля; production-слушатель на них возвращает `false`.

## Toolchain (ADR-002, зафиксировано)

- Node 24 LTS как target (`engines`), pnpm `10.17.1` (`packageManager`), TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ES2022, ESM.
- Сборка: `esbuild` через собственный `scripts/build.mjs`; `manifest.json` генерируется из типизированного `apps/extension/manifest.ts`. WXT не используется (ADR-002: нулевой runtime-код фреймворка в MAIN-сенсоре, прозрачный аудируемый output, строгая CSP).
- UI: Preact (jsxImportSource `preact`), обычный CSS с tokens, без внешних ресурсов. Строки — `_locales/ru` (default) и `_locales/en`.
- Тесты: `vitest` (unit, Node), Playwright `chromium.launchPersistentContext` + `channel: 'chromium'` (extension). `ajv` только в тестах для кросс-проверки JSON Schema; runtime-валидатор пишется вручную (Ajv компилирует через `new Function` — запрещено CSP MV3).
- Иконки: генерируются из `logo.svg` (`@resvg/resvg-js`) в `icons/16,32,48,128.png`.
- Команды (должны реально проверять, а не возвращать 0): `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:extension`, `pnpm test:privacy`, `pnpm test:perf`, `pnpm catalog:lint`, `pnpm build`, `pnpm release:verify`.
- Не добавлять зависимости без записи в результате задачи. Никаких `latest` в lockfile-воспроизводимой сборке.

## Структура и владение (ТЗ VI, I2)

`apps/extension/entrypoints` (background, hook.main, bridge, popup, sidepanel, options) · `packages/contracts` (единственные схемы + типы + валидатор) · `packages/sensors` (обёртки API) · `packages/collector` (ISOLATED bridge) · `packages/background` (observers, reducer, storage) · `packages/engine` (чистая интерпретация) · `packages/attribution` (URL/IP/PSL) · `packages/catalog` (вендоры, provenance) · `packages/ui` · `packages/export` · `fixtures` · `tests` · `docs/decisions` (ADR) · `docs/coverage` · `runbooks` · `tasks`.
Контракты, permissions, manifest, release-конфиг — один владелец; менять только через согласованный ADR. `packages/engine` — чистые функции без chrome.* и сети.
Код модуля «Защита»: в TS-базе — подкаталоги `src/protect/` пакетов (чистая логика — `packages/engine/src/protect`, без chrome.*); в production — `vendor/protect-722fae8/**` (не править вручную, только перевендоринг) и адаптер `apps/production-protect/**`, бандлы собирает `scripts/production/build-protect.mjs`.

## Стиль

- Код и идентификаторы — английский; комментарии — английский, краткие; документы (ADR, PRD, runbooks) и UI — русский (плюс `en` locale).
- Не сериализовать огромные объекты «чтобы измерить размер»: сначала дешёвые проверки формы.
