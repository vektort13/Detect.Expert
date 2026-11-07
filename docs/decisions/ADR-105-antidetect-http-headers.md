# ADR-105 — HTTP-заголовки запросов следуют выбранной Custom-идентичности

Дата: 2026-11-05. Прямое решение владельца продукта («делаем ADR»): сетевые заголовки Chrome должны
совпадать с JavaScript-идентичностью выбранного Custom-профиля. До этого `navigator.userAgent`,
`navigator.languages` и `navigator.userAgentData` подменялись, а `User-Agent`, `Accept-Language` и
`Sec-CH-UA*` на проводе оставались настоящими — сервер и антифрод-скрипт видели явное противоречие
(ADR-104 прямо оговаривал: «HTTP-заголовки не меняются»). Продолжает ADR-048/049/060/064/087/101/104.
Дополнение того же дня (раздел «Подсказки устройства, окна, сети и предпочтений»): после измерения
выяснилось, что после `Accept-CH` Chrome шлёт ещё и настоящие значения памяти, DPR, размеров окна, качества сети и
предпочтений — они расходились с Custom-строками; добавлены правила только на удаление.
Новых permissions, host grants, CSP, зависимостей, исходящего трафика расширения и каналов сообщений нет.
Измерения: [antidetect-headers.md](../coverage/antidetect-headers.md).

## Что изменяется в границах

- **REQ-001.** Прежнее исключение Custom («намеренная подмена успешного результата выбранным пользователем
  значением») распространяется с JavaScript-результатов на исходящие заголовки запросов браузера — строго в
  объёме ниже. Запрет модуля «Защита» (`modifyHeaders` ровно `Sec-GPC: 1`, «любые другие заголовки»,
  `removeHeaders`) **остаётся** для Protect и его DNR-guard; диапазон правил этого ADR Protect не принадлежит
  и через его guard не проходит.
- **REQ-002/003.** Не затрагиваются: правило ничего не оборачивает и не маскирует, обнаружимость описана ниже.
- **REQ-005.** Значения заголовков расширение не читает и не логирует. Пишутся только значения, которые
  пользователь сам выбрал в Custom-строках; снимок состояния содержит имена, статус и причину, но не значения.
- **REQ-010.** Сетевых запросов расширения нет. Используются уже имеющиеся Chrome-only `declarativeNetRequestWithHostAccess`
  и обязательные `http(s)/ws(s)` host permissions (проверка набора — `validateProductionManifest`, он не менялся).

## Разрешённые операции — исчерпывающий список

Только Chrome, только динамические правила `declarativeNetRequest`, только `action.type = 'modifyHeaders'`,
только `requestHeaders`:

| Правило | ID | Операция | Заголовки | Включает |
| --- | --- | --- | --- | --- |
| user-agent | 300100 | `set` | `User-Agent` | Custom `navigator-user-agent` |
| accept-language | 300101 | `set` | `Accept-Language` | Custom `navigator-languages` (иначе `navigator-language`) |
| client-hints | 300102 | `set` (Chromium-заявка) либо `remove` (заявка без UA-CH) | `Sec-CH-UA`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform` | Custom `client-hints`, либо UA-заявка Firefox/Safari |
| high-entropy | 300103 | `remove` | `Sec-CH-UA-Arch`, `-Bitness`, `-Full-Version`, `-Full-Version-List`, `-Model`, `-Platform-Version`, `-WoW64`, `-Form-Factors` | вместе с правилом 300102 |
| device-memory | 300104 | `remove` | `Device-Memory`, `Sec-CH-Device-Memory` | Custom `device-memory` |
| pixel-ratio | 300105 | `remove` | `DPR`, `Sec-CH-DPR` | Custom `window-device-pixel-ratio` |
| viewport | 300106 | `remove` | `Viewport-Width`, `Sec-CH-Viewport-Width`, `Sec-CH-Viewport-Height` | Custom `screen-geometry` |
| network | 300107 | `remove` | `ECT`, `RTT`, `Downlink` | Custom `network-information` |
| preferences | 300108 | `remove` | `Sec-CH-Prefers-Color-Scheme`, `Sec-CH-Prefers-Reduced-Motion`, `Sec-CH-Prefers-Reduced-Transparency` | Custom `css-media` |

Диапазон **300100…300119** (priority 1000) отделён от Firewall (1…99, 100000…100999, 101000…101023, 200000…200127)
и защиты протоколов ADR-064 (300000/300001). Свободные 300109…300119 зарезервированы: reconcile удаляет любое правило
этого диапазона, которого нет в желаемом наборе (так уходят правила прежней сессии и прежней версии).
Запрещено и не реализуется: `append`; любые другие заголовки (cookie, `Referer`, `Origin`, `Authorization`, `Sec-GPC`,
`Width`/`Sec-CH-Width`, `Save-Data`, `Sec-Fetch-*`, `Host`…); `redirect`, `upgradeScheme`, `allowAllRequests`, `block`;
`responseHeaders`; `set` для любой подсказки, кроме трёх низкоэнтропийных из строки 300102.

Условие каждого правила: явный `resourceTypes` (в Chrome `main_frame` по умолчанию **исключён**, поэтому он назван),
`excludedInitiatorDomains: [chrome.runtime.id]` — запросы самого расширения остаются настоящими. Список типов — 13
измеренных: `main_frame, sub_frame, stylesheet, script, image, font, object, xmlhttprequest, ping, csp_report, media,
websocket, other`. `webtransport` и `webbundle` не перечисляются (не измерены). Для `set` подсказок: `urlFilter: '|https://'`
и без `websocket` — Chrome не отправляет `Sec-CH-UA*` на небезопасный http и в WebSocket-рукопожатии, а `set` ДОБАВИЛ
бы их там (измерено), что само стало бы признаком. Правила `remove` схемой не ограничены: удаление отсутствующего заголовка
ничего не меняет, а loopback http (`127.0.0.1`, `localhost`) Chrome считает надёжным и подсказки туда шлёт.

## Откуда берутся значения и правило равенства с JS

Значения строятся **только** из строк, находящихся в режиме Custom при включённом Custom-мастере (`antidetectEnabled`), и
из тех же сохранённых значений, что читает MAIN-runtime. Заголовок трогается только если его собственная строка Custom.

- `navigator-user-agent` → `User-Agent`, побайтно та же строка (только видимый ASCII 0x20–0x7E без краевых пробелов, ≤ 4096).
- `navigator-languages` (иначе `navigator-language`, один тег) → `Accept-Language` по формату Chrome:
  первый тег без q, далее `;q=0.9`, `0.8` … с полом `0.1`. Теги — как в JS, без пересчёта регистра.
- `client-hints` → `Sec-CH-UA` — тот же список и порядок брендов, что `navigator.userAgentData.brands`
  (`"Brand";v="major", …`, `\` и `"` экранируются); `Sec-CH-UA-Mobile` — `?0`/`?1`; `Sec-CH-UA-Platform` — `"Платформа"`.
  Пустой список брендов = «UA-CH не заявлен»: три низкоэнтропийные подсказки **удаляются**.
- Заявка User-Agent без UA-CH (Firefox, Safari, iOS-браузеры `CriOS/FxiOS/EdgiOS/OPiOS`) при НЕ Custom-строке `client-hints`
  → `remove` трёх низкоэнтропийных подсказок (настоящий Chrome иначе слал бы подсказки к Firefox-UA). Явная строка
  `client-hints` сильнее вывода из UA. Заявка без узнаваемого движка («unknown») не угадывается. Генераторы ADR-104
  (`fingerprint-device-presets.js`, `fingerprint-profiles.js`) создают только Chromium-заявки с согласованным `client-hints`;
  заявка без UA-CH возникает только при ручном вводе.
- Высокоэнтропийные подсказки **никогда не `set`**: правило не знает, просил ли сервер их через `Accept-CH`/`Critical-CH`, а
  безусловный `set` добавил бы заголовки, которых никто не запрашивал. Пока строка `client-hints` Custom, настоящие значения
  только удаляются. Остаточное расхождение: `getHighEntropyValues()` вернёт выбранное значение, сервер получит отказ.
- Любое значение, не представимое как заголовок (control-символы, non-ASCII, пустая строка, краевые пробелы), даёт
  `unsupported/invalid` и **ни одного** правила: идентичность заголовков применяется целиком или не применяется.
  Причина: DNR принимает такие значения (отвергает только CR/LF), а control-символ делает каждый запрос недействительным
  (измерено: HTTP 400).

## Подсказки устройства, окна, сети и предпочтений: только удаление

Измерено (Chromium 153.0.8010.12 и Chrome 156.0.8078.80, https и loopback http, после `Accept-CH` на том же источнике): Chrome шлёт
на навигации и подресурсы (fetch, XHR, script, image, stylesheet, font, media, ping, object, iframe) **настоящие** `Device-Memory`,
`DPR`, `Viewport-Width`, `ECT`, `RTT`, `Downlink` и их `Sec-CH-*`-формы, `Sec-CH-Viewport-Height`, `Sec-CH-Prefers-Color-Scheme`,
`Sec-CH-Prefers-Reduced-Motion`, `Sec-CH-Prefers-Reduced-Transparency` (на небезопасный http — ни одного). Значения расходились с
Custom-строками (хост: `Device-Memory: 32`, `DPR: 1.5`, настоящий размер окна, настоящий `rtt`).

Решение: для каждой из пяти строк — **отдельное правило только `remove`**, активное, лишь пока соответствующая строка в режиме Custom
в эффективной глобальной конфигурации (при включённом Custom-мастере, готовом раннем реестре и области all-sites):

- Включение определяется строкой целиком, не значением и не её полями: Custom `screen-geometry` с одним `availLeft` тоже убирает
  `Viewport-*` (отсутствие безопаснее настоящего значения). Режимы Off/On/Bypass и сохранённые «спящие» Custom-значения правил не создают;
  подсказки строк, не находящихся в Custom, остаются нативными.
- Значение не ставится и заголовок не добавляется никогда. Пустой набор активных строк — ни одного такого правила.
- Только измеренные имена. Не включены и намеренно не трогаются: `Viewport-Height`, `Save-Data`, `Sec-CH-Save-Data`,
  `Sec-CH-Prefers-Contrast`, `Sec-CH-Prefers-Reduced-Data`, `Sec-CH-Forced-Colors`, `Sec-CH-ECT/-RTT/-Downlink` — Chrome 153/156 их не отправил
  ни в одной проверенной конфигурации (по умолчанию, с запросом через Accept-CH, при эмуляции `contrast`/`forced-colors`, при
  `--blink-settings=dataSaverEnabled=true`). `Width`/`Sec-CH-Width` (ширина слота `<img sizes>`) Chrome шлёт, но подходящей Custom-строки нет —
  они остаются настоящими (через них сервер может вывести настоящий DPR; остаточное расхождение).
- Остальные условия те же: 13 типов, priority 1000, исключение инициатора расширения, без `urlFilter`, всё-или-ничего по области и сайтам.
  Для точных сайтов сравнивается только «Custom ли строка», не её значение: иное Custom-значение на одном сайте оставляет то же удаление.

## Статусы и отображение

`describeAntidetectHeaders(configuration, scopeMatches, active, { chrome })` — чистая функция (без `chrome.*`), возвращает
`{ status: 'applied'|'inactive'|'unsupported'|'error', set: string[], removed: string[], reason: null|'scope'|'site-overrides'|'engine'|'invalid' }`
(имена в нижнем регистре; `removed` включает и имена пяти групп выше, порядок стабильный). `chrome` должен быть строго `true`; иначе
`unsupported/engine`.

- `inactive` — нет живых Custom-строк (мастер Antidetect выключен, расширение неактивно, строки не Custom): правил нет, чужие не затрагиваются.
- `unsupported/scope` — область не ровно `http://*/*` + `https://*/*`. DNR-домены не выражают точный хост — правила снимаются, не расширяются.
- `unsupported/site-overrides` — любая точная запись сайта (в том числе «сайт выключен») даёт вид, отличный от глобального для
  девяти строк (`navigator-user-agent`, `navigator-languages`, `navigator-language`, `client-hints` и пять строк групп выше). Совпадающая запись
  допустима; для групп remove-only значение не сравнивается.
- `unsupported/invalid` — выбранное значение непредставимо как заголовок; `error/invalid` — сама конфигурация или аргументы неверны.
- `unsupported/engine` — не Chrome, либо нет `declarativeNetRequest`.
- `AntidetectHeaderController` тем же образом, что `AntidetectProtocolController` (ADR-064): один атомарный
  `updateDynamicRules`, затем readback и `identical()`-сверка; физический mutex до завершения нативного Promise, таймаут 5 с, без
  повторов; ошибка записи/чтения — `error` и `registration: 'error'`. `unsupported` ошибкой **не** считается.
  Правила включаются только при готовом раннем реестре (`userScripts` доступен): без него JS-идентичность не применена, а
  значит заголовки не должны её опережать.
- Динамические правила переживают перезапуск браузера и service worker и действуют с первого запроса (измерено); устаревшие
  правила снимаются при ближайшем reconcile.
- Стоимость вызова `describeAntidetectHeaders`: около 3 мс (52 мс при 128 сайтах) — одна строгая проверка конфигурации. Интерфейсу
  стоит запоминать результат по revision, области и флагу `active`.

## Дополнение 2026-11-06 (раунд 5): X-Client-Data — только удаление

Дополнение 2026-11-06 (раунд 5), принципиально одобрено владельцем 2026-11-06. Настоящий Google Chrome добавляет к запросам на хосты Google заголовок `X-Client-Data`
(идентификаторы вариаций). Custom-идентичность, которая называет не Google Chrome, не должна его нести. В закрытый список добавляется ровно одно действие: `remove`
заголовка запроса `X-Client-Data` — правило 300109, priority 1000, те же 13 типов и исключение инициатора-расширения, без `urlFilter`, никогда `set`; значение заголовка
расширение не читает. Строка таблицы правил: `client-data | 300109 | remove | X-Client-Data | Custom client-hints без бренда «Google Chrome» либо Custom navigator-user-agent, называющий другой продукт`.

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

Проверки: `scripts/test/antidetect-header-controller.test.mjs` — 48 тестов (было 41); намеренные поломки: 14 из 15 пойманы юнит-тестами с первого раза (15-я оказалась эквивалентной — правка комментария), вместо неё добавлена и поймана мутация порядка правил; ещё 2 из 2 для токена `Chromium/`; native — 5 из 5;
`scripts/test/antidetect-headers-native.mjs` — фазы «базовая линия (заголовок есть)», «заявка Chrome не трогает», «заявка Edge (бренды, Edg/ без брендов, бренды без Edg/)», «заявка Firefox»,
«выключение возвращает» — PASS в Chromium 153 и установленном Chrome 156.

## Пределы (не обещаем)

Это не маскировка: расширение остаётся обнаруживаемым. Не покрыто и не обещается: высокоэнтропийные значения при ответе
сервера (сервер видит отказ, JS — значение); `Width`/`Sec-CH-Width`; `Save-Data` (в проверенных конфигурациях не отправлялся — если
пользователь включит платформенный режим экономии трафика, настоящий `Save-Data: on` не снимается);
TLS/JA3/JA4, ALPN, HTTP/2 SETTINGS и приоритеты, порядок и регистр заголовков за пределами изменённых значений (они сохраняются:
`set` заменяет значение на месте); HTTP/3 и WebTransport; prerender/prefetch; точные хосты (см. site-overrides);
withheld site access Chrome (правила `…WithHostAccess` не действуют там, где доступ отозван — не измерено);
запросы из dedicated/shared worker и service worker — DNR не отличает их от страничных, поэтому **низкоэнтропийные подсказки добавляются и им
по https**, хотя Chrome сам их не шлёт (измерено, в том числе скрипт и fetch service worker по https), а JS воркера по-прежнему настоящий
(Custom его не покрывает);
http-loopback (`localhost`, `127.0.0.1`) сохраняет настоящие низкоэнтропийные подсказки — правило `set` только для https;
Firefox (`unsupported/engine`).

## Проверки

- `scripts/test/antidetect-header-controller.test.mjs` — чистые построители, контроллер с поддельным DNR, обвязка через настоящий
  `ApiConfigurationController`; 41 тест. Намеренные поломки: 34 из 34 ловятся юнит-тестами; в native — 8 из 9 (девятая, «`websocket` в типах правила
подсказок», на проводе неотличима: `wss://` и так не проходит `urlFilter` с якорем `https://`; её ловит юнит-тест формы правила).
- `scripts/test/antidetect-headers-native.mjs` — настоящее production-расширение, ранняя регистрация, локальные HTTP/HTTPS(h2)/WebSocket
  серверы (HTTPS доверен по SPKI-хешу сертификата, поэтому Chrome учитывает `Accept-CH` и по https): заголовки на стороне сервера равны
  значениям страницы для main_frame, iframe, fetch, XHR, script, image; воркер, WebSocket; Accept-CH не даёт ни высокоэнтропийных, ни
  device/viewport/network/preference-подсказок, пока их строки Custom, и возвращает их, когда строка выключена; подсказки не затронутых
  строк остаются; Firefox-заявка снимает подсказки; выключение Antidetect снимает все правила. Запуск: Playwright Chromium 153 и установленный
  Chrome 156 (`--installed-chrome`), `--dist` — по собранному `dist/chrome`.
- Фактические числа измерений и версии браузеров записаны в coverage-документе; эта запись сама не объявляет тесты пройденными.
