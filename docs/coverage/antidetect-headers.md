# Antidetect HTTP-заголовки — ADR-105

Решение: [ADR-105](../decisions/ADR-105-antidetect-http-headers.md). Реализация: `apps/production-extension/antidetect-header-controller.js`
(+ три строки в `api-configuration-controller.js`). Документ фиксирует **измеренное**; всё, что не измерено, помечено «не измерено».

## Среда измерений

- Playwright Chromium **153.0.8010.12** (новый headless, `--load-extension`) и установленный Chrome **156.0.8078.80** (с окном за экраном,
  изолированный профиль, распакованное расширение через `Extensions.loadUnpacked`), Windows 11.
- Локальные серверы Node: HTTP/1.1; HTTPS (`http2.createSecureServer`, `allowHTTP1`, временный самоподписанный сертификат) — страницы шли
  по h2, WebSocket по HTTP/1.1. Имена `*.test` / `*.example.com` отображены на 127.0.0.1 через `--host-resolver-rules`, `--no-proxy-server`,
  внешней сети нет. Сервер возвращает заголовки ровно в том виде и порядке, в каком их получил (`rawHeaders`).
- Доверие к сертификату. С `--ignore-certificate-errors` (то же, что `ignoreHTTPSErrors` Playwright) Chrome **не учитывает `Accept-CH` по https**
  (0 подсказок, нативно). С `--ignore-certificate-errors-spki-list=<SHA-256 SPKI сертификата>` сертификат считается действительным: `Accept-CH`
  по https работает, регистрация service worker по https проходит. Первые измерения высокоэнтропийных подсказок шли по loopback http; итоговая
  native-проверка идёт с SPKI-доверием и охватывает https.
- Для шагов измерения использовалось минимальное одноразовое расширение с теми же `declarativeNetRequestWithHostAccess` и
  `http(s)/ws(s)` host permissions, что у production (скрипты измерения в репозиторий не входят). Нативный набор подсказок мерили и без
  расширения. Итоговая проверка на настоящем production-расширении: `scripts/test/antidetect-headers-native.mjs`.

## Что `modifyHeaders` умеет в Chrome 153/156

| Вопрос | Результат |
| --- | --- |
| `set` для `User-Agent`, `Accept-Language`, `Sec-CH-UA`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform` | Работает для всех 13 перечисленных ниже типов, на http и https; значение заменяется **на месте** |
| `remove` высокоэнтропийных (8) и низкоэнтропийных (3) подсказок | Работает: после `Accept-CH` Chrome слал все 8 на 14 из 19 запросов (документы, подресурсы, favicon, повторная навигация); с правилом — 0 из 19 (Chromium 153 и Chrome 156) |
| `remove` подсказок устройства, окна, сети и предпочтений (раздел ниже) | Работает на всех запросах, где Chrome их слал, на https и loopback http (native: Chromium 153 и Chrome 156) |
| `remove` `X-Client-Data` | Работает на всех 13 типах: 0 из 34 и 0 из 30 запросов на хосты Google с заголовком против 32 из 35 и 27 из 30 без правила (Chrome 156.0.8078.80, Chromium 153.0.8010.12); раздел «X-Client-Data (только удаление)» ниже |
| `main_frame` без явного `resourceTypes` | **Не затрагивается** (измерено: fetch переписан, навигация нет) — тип нужно назвать |
| `excludedInitiatorDomains: [id расширения]` | Fetch из Options-страницы и из service worker расширения сохраняют настоящий `User-Agent`; без исключения оба переписаны; страничный fetch переписан в обоих случаях |
| Запросы к `chrome-extension://` | Это не сетевые запросы — на сервере следа нет, отдельное исключение не нужно (`testMatchOutcome` схему не проверяет и доказательством не служит) |
| Сосуществование с Protect `Sec-GPC` (id 1, priority 100) | Оба правила применяются к разным заголовкам; allow-правила Protect (priority ≤ 50) и block (≤ 30) наше правило (1000) не отключают |
| `allow` с priority выше нашего | Отключает `modifyHeaders` (поэтому приоритет 1000 выше любого allow Protect; Protect GPC по той же причине имеет 100) |
| Два правила одного priority, разные заголовки | Применяются оба. Один заголовок двумя правилами: побеждает больший priority; при равном — правило с большим id (одно измерение) |
| Лимит заголовков в правиле | 30 заголовков в одном правиле приняты; дубли имён внутри правила приняты (не используются) |

### Какой DNR `resourceType` получает запрос (Chromium 153, по одному маркер-правилу на тип)

| Запрос | Тип |
| --- | --- |
| навигация верхнего уровня | `main_frame` |
| `<iframe>` | `sub_frame` |
| `<object>` | `object` |
| `fetch`, XHR, EventSource, `fetch(keepalive)`, `Cache.add`, `fetch` из dedicated worker и из service worker | `xmlhttprequest` |
| `<script>`, `import()`, `preload as=script`, `importScripts`, скрипт dedicated worker, shared worker и service worker | `script` |
| `<img>`, favicon, `<link rel=icon>` | `image` |
| `<link rel=stylesheet>` / `FontFace` / `<audio>`, `<track>` | `stylesheet` / `font` / `media` |
| `sendBeacon`, `<a ping>` | `ping` |
| `new WebSocket` (ws и wss) | `websocket` |
| отчёт `report-uri` CSP | `csp_report` |
| `prefetch`, `preload as=fetch`, `<link rel=manifest>` | `other` |

Список правила — ровно эти 13: `main_frame, sub_frame, stylesheet, script, image, font, object, xmlhttprequest, ping, csp_report, media, websocket, other`.
`webtransport` и `webbundle` Chrome в списке принимает, но трафика для них здесь не было: **не измерено**, в правила не входят.
Воркеры и service worker не отличаются от страницы по типу; отдельного DNR-условия «запрос воркера» для динамических правил нет (`tabIds`/`excludedTabIds` по документации Chrome только для session-правил — не измерялось).

## Что Chrome шлёт без правил (низкоэнтропийные подсказки)

| Источник запроса | `Sec-CH-UA`, `-Mobile`, `-Platform` |
| --- | --- |
| документ и подресурсы по https | да: навигация, iframe и подресурсы fetch, XHR, script, image, stylesheet, font, media, ping, object — все три заголовка на каждом |
| документ и подресурсы по `http://127.0.0.1` (loopback — потенциально надёжный) | да, то же |
| `http://host.test` (небезопасный, не loopback) | **ни на одном запросе** (`navigator.userAgentData` там отсутствует) |
| WebSocket-рукопожатие, dedicated worker (скрипт, fetch, importScripts) | **нет** (Chrome 156 и Chromium 153) |
| shared worker (скрипт), service worker (скрипт, fetch из него) | **нет** (Chrome 156 по loopback http; Chromium 153 по https с доверенным сертификатом) |

Следствие, измеренное в обе стороны: безусловный `set` подсказок **добавил** бы их на небезопасный http, в WebSocket и в запросы воркеров.
Поэтому правило `set` подсказок ограничено `urlFilter: '|https://'` и без `websocket` (результат: небезопасный http — подсказок нет, loopback http —
настоящие подсказки сохраняются, https — подставлены). Остаётся одно измеренное расхождение: **запросы из воркеров (dedicated, shared, service worker) по https** получают Custom-подсказки,
которых Chrome сам не шлёт (DNR не отличает их от страничных). Для service worker это измерено по https с доверенным сертификатом (Chromium 153):
скрипт и fetch из SW получают `User-Agent`, `Accept-Language` и добавленные `Sec-CH-UA*`.

## Порядок и регистр заголовков

`set` для заголовка, который Chrome уже отправил, заменяет значение на месте: порядок и регистр имён не меняются ни в HTTP/1.1
(`Host, Connection, sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, Upgrade-Insecure-Requests, User-Agent, Accept, Sec-Fetch-*, Accept-Encoding, Accept-Language`
для навигации; другой порядок для fetch — тоже сохранён), ни в HTTP/2 (имена нижним регистром, `priority` последним). Заголовок, которого не было,
добавляется в конец списка (в рукопожатии WebSocket — перед `Sec-WebSocket-Key`) с именем в нижнем регистре; именно это и было бы заметно, и
поэтому добавлений на небезопасный http / в WebSocket нет. `remove` ничего не добавляет.

## Accept-Language

Chrome по умолчанию: `en-US,en;q=0.9`. При настройках браузера из 20 языков Chrome отправил **10**:
`de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7,fr-FR;q=0.6,fr;q=0.5,es-ES;q=0.4,es;q=0.3,it-IT;q=0.2,it;q=0.1`, `navigator.languages.length` тоже 10.
Формула: первый тег без q, далее q = 0.9, 0.8 … 0.1. Пол 0.1 для записей после десятой нативно **не наблюдался** (Chrome обрезает список);
для Custom-списка длиннее десяти реализован тот же пол 0.1, это не измерено.

## Что принимает и что делает DNR со значением

| Значение | `updateDynamicRules` | Что на проводе |
| --- | --- | --- |
| CR/LF | отклонено | — |
| пустая строка | принято | заголовок с пустым значением |
| `café`, кириллица | принято | байты UTF-8 |
| пробел в начале/конце | принято | обрезается |
| табуляция внутри | принято | остаётся |
| control-символ 0x01, DEL 0x7F | принято | **сервер ответил 400**, заголовок до приложения не дошёл |
| 4096 символов | принято | доставлено целиком |

Вывод: контроллер сам пропускает только видимый ASCII 0x20–0x7E без краевых пробелов, иначе — `unsupported/invalid` без единого правила.
`getDynamicRules()` возвращает правило в исходном виде (имена заголовков как заданы, `urlFilter` сохранён, лишних полей в Chrome 153/156 нет);
сверка терпима к регистру имён заголовков, порядку списков и инертным полям по умолчанию.

## Высокоэнтропийные подсказки по запросу сервера

Нативно после `Accept-CH` (с `Permissions-Policy`) уходят 8 заголовков: `Sec-CH-UA-Arch` (`"x86"`), `-Bitness` (`"64"`),
`-Full-Version`, `-Full-Version-List`, `-Model`, `-Platform-Version` (`"19.0.0"`), `-WoW64`, `-Form-Factors` (`"Desktop"`) — с настоящими версиями браузера.
Правило `remove` убирает все 8 с каждого запроса (0 из 19). `Critical-CH` (перезапуск навигации): без правила 2 запроса, подсказка на втором;
с правилом 2 запроса, подсказки нет ни на одном, цикла нет, при повторном визите 1 запрос.

## Подсказки устройства, окна, сети и предпочтений (только удаление)

Что Chrome 153 и Chrome 156 действительно отправляют после `Accept-CH` на том же источнике (запрошены 25 имён; одинаковый результат в обоих браузерах,
на https и на loopback http; на небезопасный http — ни одного). Отправлены на навигации, iframe и подресурсах (fetch, XHR, script, image, stylesheet, font,
media, ping, object), **не** отправлены на первой навигации (до обучения), в WebSocket-рукопожатии и в запросах воркеров:

| Имя | Нативное значение на этом хосте | Строка Custom в ADR-105 |
| --- | --- | --- |
| `Device-Memory`, `Sec-CH-Device-Memory` | `32` | `device-memory` |
| `DPR`, `Sec-CH-DPR` | `1` (Chromium) / `1.5` (Chrome 156, масштаб экрана) | `window-device-pixel-ratio` |
| `Viewport-Width`, `Sec-CH-Viewport-Width`, `Sec-CH-Viewport-Height` | размер окна (например 1100 / 800; 300 / 150 в iframe) | `screen-geometry` |
| `ECT`, `RTT`, `Downlink` | `4g`, 100–200, 1.4–1.7 (меняются от запроса к запросу) | `network-information` |
| `Sec-CH-Prefers-Color-Scheme`, `-Reduced-Motion`, `-Reduced-Transparency` | `light`, `no-preference`, `no-preference` (значение следует эмулированным media-настройкам) | `css-media` |
| `Width`, `Sec-CH-Width` | `100` — только для `<img sizes>` | нет подходящей строки, **не трогаются** |

**Не отправлены ни в одной проверенной конфигурации** (по умолчанию; с запросом через Accept-CH; при эмуляции `contrast: more` и `forcedColors: active`;
с `--blink-settings=dataSaverEnabled=true`, при этом `navigator.connection.saveData` остался `false`): `Viewport-Height`, `Save-Data`, `Sec-CH-Save-Data`,
`Sec-CH-Prefers-Contrast`, `Sec-CH-Prefers-Reduced-Data`, `Sec-CH-Forced-Colors`, `Sec-CH-ECT`, `Sec-CH-RTT`, `Sec-CH-Downlink`, `Sec-CH-Lang`.
Поэтому они не вошли в правила. Если пользователь включит платформенный режим экономии трафика, который эти конфигурации воспроизвести не смогли,
настоящий `Save-Data: on` останется — это **не измерено**.

Native-результат (production-расширение, обе строки Custom, Accept-CH с полным списком): страница сообщает Custom-значения (`deviceMemory 0.5`, `devicePixelRatio 2.5`,
`innerWidth 1234`, `connection.rtt 123`, `prefers-color-scheme: dark`), нативные были `32 / 1 / 1100 / 100–150 / light`; сервер не видел ни одного из 21 имени
(8 высокоэнтропийных + 13 из таблицы) ни по https, ни по loopback http, но видел `Width` и `Sec-CH-Width`. Когда Custom только `device-memory`, исчезают
`Device-Memory` и `Sec-CH-Device-Memory`, остальные 21 имя приходят. После выключения Antidetect вернулись все 23 имени (21 + `Width` + `Sec-CH-Width`).

## X-Client-Data (только удаление, раунд 5)

Правило 300109 по ADR-105 (дополнение раунда 5, [ADR-108](../decisions/ADR-108-shardbrowser-owner-decisions.md)): `remove` заголовка запроса `X-Client-Data`, никогда `set`, те же 13 типов и исключение инициатора-расширения.

Когда правило активно. Только пока применяется Custom-идентичность (мастер Antidetect, готовый ранний реестр, область all-sites, те же условия, что у остальных правил) и выполнено
любое из двух: список брендов строки `client-hints` не содержит «Google Chrome» (пустой список тоже) либо User-Agent строки `navigator-user-agent` называет другой продукт
(Edge `Edg/ EdgA/ EdgiOS/ Edge/`, Opera `OPR/ OPiOS/ Opera/`, Firefox `Firefox/ FxiOS/`, Samsung Internet, Yandex Browser, Vivaldi, явный токен `Chromium/`, Safari без токена Chrome).
Достаточно одного источника: отсутствие заголовка у заявки Chrome ничему не противоречит (чистый профиль без идентификаторов вариаций его не шлёт), присутствие у заявки Edge или
Firefox — противоречие. Голый токен `Chrome/` — это заявка Chrome (по User-Agent Chrome от Chromium не отличить), `CriOS/` — Chrome для iOS, заявка без узнаваемого продукта не угадывается.
Значение строки не важно, важно только её содержание; правило не зависит от остальных строк. Подсказки идентичности (`Sec-CH-UA*`) этим правилом не меняются.

Измерено (установленный Chrome 156.0.8078.80, Chromium 153.0.8010.12, Edge 156.0.4314.58, Windows 11; локальный сервер, имена `www.google.com`, `www.youtube.com`, `fonts.googleapis.com`
отображены на 127.0.0.1 вместе с портом, чтобы URL сохранил стандартный порт; доверие по SPKI сертификата; остальные имена не разрешались, внешней сети нет):
чистый профиль Chrome 156 без идентификаторов вариаций — 0 из 53 https-запросов на хосты Google; Chrome 156 и Chromium 153 с идентификаторами, заданными собственным ключом
`--force-variation-ids` — 52 из 52 и 34 из 34 с заголовком: навигация верхнего уровня, iframe, fetch (в том числе keepalive), XHR, script, image, stylesheet, sendBeacon, скрипт и fetch
выделенного воркера, favicon — со страницы Google и со страницы чужого сайта; рукопожатие WebSocket (0 из 5 и 0 из 3), plain http (0 из 4) и не-Google хосты (0) заголовка не получают;
Edge 156 с тем же ключом — 0 из 43; правило `remove` на 13 типах убрало заголовок со всех типов: 0 из 34 (страница Google) и 0 из 30 (чужая страница), после снятия правила 31 из 34.
`webRequest.onBeforeSendHeaders` видит заголовок до DNR, `onSendHeaders` — уже без него (на проводе 0 из 11), поэтому собственное наблюдение «Google IDs» при активном правиле сообщает
«заголовок отсутствует», то есть состояние провода. Не измерено: профиль с настоящим семенем вариаций (идентификаторы задавались ключом браузера), настоящие Opera, Samsung Internet,
Yandex Browser и Vivaldi (правило снимает заголовок у заявки любого из них по тому же принципу), Chrome для iOS, запросы из service worker чужого сайта.

## Устойчивость

Динамические правила пережили перезапуск браузера и применились к первой же навигации (Chromium 153; service worker фикстуры правил не добавлял); при перезапуске service worker расширения
правила и регистрация остаются, следующий reconcile подтверждает их идентичность чтением. Удаление при выключенном мастере Antidetect — один
атомарный `updateDynamicRules` с проверкой чтением.

## Остаются настоящими или не измерены

- Высокоэнтропийные значения в `getHighEntropyValues()` — Custom, на проводе — отсутствуют (сервер видит отказ). То же для пяти remove-only групп: JS — Custom, на проводе — ничего.
- `Width` / `Sec-CH-Width` (слот `<img sizes>`; позволяют вывести настоящий DPR), `Save-Data` в режиме экономии трафика; TLS/JA3/JA4, ALPN, HTTP/2 SETTINGS/приоритеты;
  HTTP/3, WebTransport — не покрыты или **не измерены**.
- prerender/prefetch по Speculation Rules; withheld site access Chrome (документированно правила `…WithHostAccess` не действуют там, где доступ отозван) — **не измерены**.
- Другое расширение, меняющее те же заголовки, — не проверялось.
- `X-Client-Data` у настоящих Opera, Samsung Internet, Yandex Browser, Vivaldi и Chrome для iOS не измерялся.
- Firefox — `unsupported/engine`. JS внутри Worker остаётся настоящим (Custom Worker не покрывает), хотя заголовки его запросов — выбранные.

## Проверки и фактические результаты

| Проверка | Результат |
| --- | --- |
| `node --test scripts/test/antidetect-header-controller.test.mjs` | 48 из 48 |
| Намеренные поломки модуля и обвязки (скрипт вне репозитория; 24 для идентичности + 10 для remove-only групп) | пойманы 34 из 34; файлы возвращены побайтно (sha256) |
| `node scripts/test/antidetect-headers-native.mjs` (Chromium 153.0.8010.12, настоящее production-расширение, ранняя регистрация, SPKI-доверие) | PASS |
| `node scripts/test/antidetect-headers-native.mjs --installed-chrome` (Chrome 156.0.8078.80) | PASS |
| Намеренные поломки в native (через `HEADERS_NATIVE_MUTATION` на временной копии; 5 для идентичности + 4 для remove-only групп) | пойманы 8 из 9; одна («тип websocket в правиле подсказок») на проводе неотличима — `wss://` и так не проходит `urlFilter` с якорем `https://`, её ловит юнит-тест формы правила |
