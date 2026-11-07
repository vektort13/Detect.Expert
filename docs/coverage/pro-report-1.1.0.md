# Pro-отчёт 1.1.0: данные, покрытие и проверка

2026-10-10. REQ-004/005/007/011/012/013/015;
[ADR-036](../decisions/ADR-036.md), [ADR-037](../decisions/ADR-037.md),
[ADR-039](../decisions/ADR-039.md).

## Представление сохранённой записи

Preview и PDF используют один документ из проверенной Pro-сессии. После
титульной страницы показаны две сводные таблицы: значения браузера и Cookie.
Каждая начинается с новой страницы; подробные данные следуют после них
с отдельной страницы. В подробностях показаны обнаруженные компании
с локальными логотипами и заполненные таблицы каждого посещения.
Пустые документы не создают блоки «ничего не обнаружено», нулевые сводки,
пустые карточки или пустые таблицы. Интерактивная карта связей находится
после печатного документа и сохраняет собственные фильтры.

[`recordedValueRows`](../../apps/production-extension/pro-report-tables.js)
читает все сохранённые `page.apiValues[].rows` непосредственно. Наличие
`report`, finding card или результата распознавания для вывода не требуется.
Несколько findings одной техники не дублируют её значения. Отдельная таблица
содержит операцию, записанные параметры, результат, фазу, документ и счётчик
каждого варианта. Числовые массивы, структурированные технические результаты
и все сохранённые поля RTC не теряются. В popup/sidepanel те же apiValues
показываются отдельным разделом, независимо от карточек техник и findings.
Для отсутствующего результата сохраняется причина; фиктивное значение не
создаётся. Здесь показывается то, что скрипт прочитал через API; передача
этого результата на сервер отдельным запросом из этого факта не следует.

Таблицы Cookie metadata, Social, Beacon, Background, GTM и Third Party
показывают все допущенные в snapshot строки без дополнительного усечения
на уровне отображения. Сохранены инициирующие скрипты, источник наблюдения,
документ и различие между native request и вызовом страницы. Aggregate
счётчики техник остаются рядом с operation counters и не складываются с
ними. Permissions, header hints, проверки расширений, локальные порты,
request outcomes, HTTP-коды и времена представлены отдельными таблицами.

CompanyLabel выбирает упакованные изображения, SiteLabel использует
локально сохранённый favicon. Print gates ждут декодирования логотипов и
иконок сайта. Новые подписи и статусы доступны на 21 языке. Существующие
ограничения, обрезания и сведения о записи сведены в компактные детали;
недоступность Cookie values отображается один раз для записи.

## Две сводные таблицы

[`summaryValueRows`](../../apps/production-extension/pro-report-tables.js)
обходит все посещения и документы одной записанной сессии. Одна таблица
содержит значения браузерных API, фактически отправленные технические HTTP
заголовки и декодированные поля сетевых маячков,
другая — отправленные Cookie. В каждой
ровно три колонки: **№ / имя / значение**; строки отсортированы по имени
и затем по значению с учётом выбранного языка.

Одинаковые пары имя/тип/значение объединяются по всей сессии. Разные значения
одного имени сохраняются; строка `"1"` не сливается с числом `1`. Параметры
API входят в имя, числовые массивы, technical и RTC fields раскрываются в отдельные
индексированные строки. `NaN`, `Infinity` и `-0` представлены как числовые
варианты. Исключения и `unobserved` остаются в подробной таблице и не
превращаются в полученные значения в сводке. Управляющие и bidi-символы
видимы как escape-последовательности; содержимое остаётся текстом.

Поля маячков берутся из `browser-network` строк всех посещений и имеют
имена вида `meta.beacon.Purchase.value`: событие, сумма, валюта и конкретные
состояния consent. Признаки наличия идентификаторов и gcs/gcd, неизвестные
поля и page-hook попытки в эту сводку не попадают. Событие `conversion`,
выведенное только из endpoint Google Ads/LinkedIn, не считается значением
переданного параметра. Подробная таблица маячков сохраняет весь snapshot.

В [`report.css`](../../apps/production-extension/report.css) каждая непустая
сводка начинает новую страницу печати; таблица, заголовки колонок и значения
имеют размер 12 pt. Native Chrome проверяет три колонки, непрерывную
нумерацию, сортировку, варианты значений, вычисленный размер 16 CSS px
(12 pt) и `break-before: page`. PDF-артефакты перечислены ниже.
Отдельная проверка текстовых координат и матриц шрифта в самих PDF
подтверждает первую строку содержимого на новой странице и размер 12 pt.
Результат: проверка пагинации.

## Фактически отправленные Cookie

[`ProCookieValuesObserver`](../../apps/production-extension/pro-cookie-values.js)
читает только `Cookie` из native `webRequest.onSendHeaders` с
`requestHeaders`/`extraHeaders`. Capture действует после явного старта Pro,
при согласии и разрешённой области наблюдения. Существующая cookie jar
не копируется: в таблицу попадают пары из наблюдённого исходящего заголовка.
Отдельные значения `Authorization`, тела запросов и ввод форм этот канал
не читает. Новых permissions, внешних соединений и зависимостей нет.

Данные сохраняются в отдельной необязательной `page.cookieValues`:
source document, destination host, имя, точное значение, счётчик и native
временные метки. Повторные имена, пустые значения и `=` внутри значения
поддерживаются; URL/base64/JWT-декодирование не подменяет исходную строку.
Разные варианты не перезаписывают друг друга. MAIN/ISOLATED, PageBatch,
Light и metadata-only Cookie snapshot этот канал не принимают. Проверку
схемы выполняет [общий canonical reader](../../packages/contracts/src/pro-cookie-values.mjs).

Привязка требует действующего native documentId, документа текущего
посещения, tracked tab, доступного source/destination и допустимой временной
метки. Для навигации очередь ожидает совпадающий authoritative commit
того же request object и documentId. Cancel, смена сессии, отзыв доступа,
pause и устаревшие события не могут приписать значения новому документу.
Если привязка не подтверждена до истечения срока или request уже удалён,
фиксируется неполное покрытие; документ не выбирается по одному домену или
соседству событий. Store/partition определяет браузер при отправке запроса.

| Проверенная среда | Значения исходящих Cookie | Остальной отчёт |
| --- | --- | --- |
| Chrome/Chromium 153.0.8010.12 | Подтверждены first-party и реальный HTTPS third-party запрос к локальному тестовому серверу | API values, metadata, Social, Beacon, GTM, логотипы, favicon, preview и PDF |
| Установленный Firefox 138.0.4 | `supported=false`: текущий adapter не предоставляет необходимую authoritative network document identity | Cookie metadata, page-observed Social/Beacon/GTM, API values и сводка, логотипы, favicon и PDF работают |

Отсутствие raw Cookie сводки в Firefox не обозначает отсутствие cookies у
сайта. Ограничение принадлежит этому native каналу текущего adapter;
обновление Firefox само по себе не включает его поддержку. По Cookie
header не назначается TPM/DBSC membership или аппаратная защита.

## Пределы и старые записи

ADR-039 добавляет фиксированные технические профили `technical`: языки,
параметры восьми Intl API, геометрию Element/Range/SVG, Canvas/OffscreenCanvas
TextMetrics, список расширений WebGL/WebGL2, plugins/mimeTypes, UAData,
результат matchMedia. Сохраняются именно результаты вызова сайта;
расширение не выполняет собственный тест fingerprinting. Параметры
CSS.supports, matchMedia, codec и font queries дополняют имя результата;
измеряемый текст и аргумент текста FontFaceSet не сохраняются.
Проекция ограничена 128 полями / 8 KiB, API values — 256 вариантами / 64 KiB
на документ. Обычный Light режим технический projector не вызывает.

Новый `page.requestValues` использует native onSendHeaders и точный
allowlist из 38 технических заголовков, включая 27 Client Hints. Разные
варианты одного заголовка и main/third-party source documents сохраняются.
Лимит — 256 строк / 256 KiB на посещение, 4096 символов на значение.
Неподтверждённые Firefox network document identities не подменяются
совпадением доменов; текущий Firefox adapter возвращает supported=false.
Таблицы интерфейса не добавляют собственного ограничения числа строк.

Pro сохраняет прежние общие пределы: 10 минут, 100 посещений, 16 вкладок,
до 5 000 ресурсов и 3 MiB на сессию. Новый Cookie канал ограничен 256
вариантами / 256 KiB на посещение; имя — 256 символов, значение — 16 384.
На событие допускается 128 заголовков, суммарно 65 536 символов Cookie
headers и 512 пар; обычные события ограничены 200/с. Навигационная очередь:
32 записи / 128 KiB / 10 секунд, с учётом общего Pro budget.

При превышении выставляются `truncated` и ограничение записи. Слишком
длинное значение пропускается целиком. Presenter не отменяет capture limits
и не восстанавливает пропущенные события. Старые записи без `cookieValues`
остаются совместимыми; Cookie values и ранее не сохранённые результаты
API задним числом в них не добавляются. Для этих данных нужна новая запись.

## Исходная проверка ADR-036/037

Ниже сохранены результаты исходной реализации. Текущая проверка ADR-039,
расширенные native fixtures и актуальные hashes находятся в
отчёте о полноте Pro
и разделе `proValuesCompleteness` release JSON.

- `pnpm typecheck` — PASS; `pnpm lint` — PASS, 434 файла / 7 правил.
- `pnpm test:unit` — **1 157 Vitest (54 файла) + 1 215 Node = 2 372**,
  failures 0, skipped 0. Лог полного запуска.
- [Таблицы](../../scripts/test/pro-report-tables.test.mjs) проверяют orphan
  documents, отсутствие дублей, все фазы/варианты, 512 сохранённых строк,
  RTC fields, qualified counters, данные permissions/headers/extensions,
  inert XSS и локализации. [Сводки](../../scripts/test/pro-report-summary.test.mjs)
  проверяют сортировку, typed deduplication и специальные числа.
- [Cookie unit](../../scripts/test/pro-cookie-values.test.mjs) и
  [независимое security review](../../scripts/test/pro-cookie-values-review.test.mjs)
  проверяют native identity, consent/permissions/pause, временные границы,
  navigation commit/cancel, subdomains, TTL/rearm, budgets, variants,
  canonical wire и изоляцию Light.
- `node scripts/test-company-native.mjs` — PASS. В
  native-chrome.json
  `thirdPartyCookie.prepared/sent/recorded` равны `true`,
  `receivedRequests=1`. Отправку подтвердил реально полученный локальным
  HTTPS сервером запрос; presence в browser cookie jar или перехваченном
  тестовом response не используется как доказательство отправки.
  В reportTables: 0 пустых tables/sections/cards и 0 GTM-разделов вне документа;
  обе сводки имеют по три колонки. Errors и unexpectedRequests пусты.
- `node scripts/test-company-firefox-native.mjs` — PASS. В
  native-firefox.json
  подтверждены отсутствие raw Cookie сводки, браузерная сводка, metadata,
  Social, локальные логотипы, favicon и успешные print gates. Errors и
  unexpectedRequests пусты. Проверены установленные Firefox 138.0.4 и
  неизменённая собранная extension; native antifraud attribution остаётся
  `unsupported-on-Firefox138`.

Созданы Chrome PDF
и Firefox PDF.
Версии и hashes выпускных архивов фиксируются в
release-1.1.0.json; native JSON сохраняют hashes
проверенных файлов. Настоящий документ не подменяет эти артефакты пересказом
окончательных hash-значений.

## Стоимость наблюдателя

Node microbenchmark, Node v25.2.1,
Windows; это время вызова observer, не задержка браузера или сайта:

| Сценарий | Итераций | Median, ms | p95, ms |
| --- | ---: | ---: | ---: |
| Capture выключен, 20 cookies | 10 000 | 0,0001 | 0,0002 |
| Capture включён, 20 cookies | 1 000 | 0,0865 | 0,1347 |
| Capture включён, 256 cookies | 1 000 | 0,9379 | 1,1964 |

## API references

[Chrome webRequest](https://developer.chrome.com/docs/extensions/reference/api/webRequest)
описывает lifecycle, `onSendHeaders`, `extraHeaders`, permissions и native
document fields. [MDN webRequest](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest)
и [MDN onSendHeaders](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onSendHeaders)
служат первичными API references для Firefox. Наличие поля в общей
документации не заменяет указанную выше проверку adapter и конкретной
установленной версии.
