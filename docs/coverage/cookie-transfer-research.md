# Cookie transfer — исследование native API

Дата проверки: 2026-10-21. Основание: решение владельца продукта добавить вкладку Cookies рядом с Browser Debug и приложенное техническое руководство о переносе cookie.

Это материалы для проектирования. Поддержка в текущей сборке определяется отдельно кодом и результатами нативных проверок. Исследование не читало cookie пользовательских профилей.

## Вывод для реализации

Перенос строится на `cookies.getAll` и `cookies.set` после явного действия пользователя в доверенной странице расширения. JSON хранит доступные native API поля; импорт восстанавливает их с явным выбором целевого cookie store. Копирование SQLite, чтение ключей ОС, CDP и `debugger` для этого не требуются. Существующее optional-разрешение `cookies` и действующие разрешения хостов определяют доступную область. Наличие `activeTab` само по себе не даёт полного доступа к profile-wide cookie API: это прямо отражено в проверке Chromium, использующей неизвестный tab ID. [Chromium Cookies API](https://raw.githubusercontent.com/chromium/chromium/main/extensions/browser/api/cookies/cookies_api.cc)

## Исправления приложенного руководства

1. `storeId` разрешён в `cookies.set`; read-only здесь только `hostOnly` и `session`. Store ID не переносим между установками как идентификатор одной и той же учётной среды. Нужен явный mapping к существующему целевому store.
2. `set` действительно записывает partitioned cookie при переданном `partitionKey`. Утверждение, что метод всегда записывает в default partition, неверно. У Chrome начиная с 130 ключ также содержит `hasCrossSiteAncestor`; это доступное поле API, а не только колонка SQLite.
3. `getAll({})` не означает все cookie всех stores и partitions. Вызов относится к одному store и по умолчанию к unpartitioned cookie. Для полного доступного перечня требуется обход выбранных stores с `partitionKey: {}`. Chromium специально включает при таком фильтре partitioned и unpartitioned записи. [Chrome API](https://developer.chrome.com/docs/extensions/reference/api/cookies), [Chromium helpers](https://raw.githubusercontent.com/chromium/chromium/main/extensions/browser/api/cookies/cookies_helpers.cc)
4. Нельзя исправлять `SameSite=None` или partitioned запись автоматическим переключением `secure` в `true`: это скрыто меняет сохранённые атрибуты. Следует показать несовместимость до записи.
5. Firefox **140+** допускает `sameSite: "unspecified"`, а его default также `unspecified`. В Firefox 138 native setter отвергает этот enum; до 140 default был `no_restriction`. Простое исключение `sameSite` из set меняет смысл и недопустимо. Controller учитывает version capability; старый target получает ошибку до записи, сохраняя исходное значение в JSON. Firefox до 145 мог создавать некорректные cookie; одного resolved Promise для проверки недостаточно. [Firefox 140 release notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/140), [Firefox set](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/cookies/set)
6. Автоматически удалять исходный `storeId` и записывать всё в текущий store нельзя: так смешиваются контейнеры и аккаунты. Сначала выбирается mapping; конфликты после mapping проверяются заново.
7. Из значений cookie нельзя определить DBSC, аппаратный ключ или успешность будущей авторизации. ABE защищает хранилище Chrome, а DBSC — обновление серверной сессии; это разные уровни. Нельзя считать все cookie «app-bound» и поэтому непереносимыми. [Google ABE](https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html), [W3C DBSC](https://www.w3.org/TR/dbsc/)

## Чтение и области хранения

Вызов `getAllCookieStores` даёт доступные хранилища; результат не является обещанием доступа ко всем профилям установленного браузера. Incognito/private store зависит от доступности и пользовательского разрешения. Для Firefox в список могут входить контейнеры; имена и цвета контейнеров потребовали бы отдельного `contextualIdentities`, поэтому не следует расширять разрешения только ради оформления списка. [Firefox cookie stores](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/cookies/getAllCookieStores)

Для Firefox запрос `getAll({ storeId, partitionKey: {}, firstPartyDomain: null })` охватывает доступные partitioned/unpartitioned и FPI-области. `null` в фильтре `firstPartyDomain` означает отсутствие фильтра; в `set` это не допустимый способ стереть FPI-изоляцию. Пустая строка `""` обозначает известную не-FPI область. [Firefox getAll](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/cookies/getAll)

Текущий upstream Firefox уже определяет `hasCrossSiteAncestor` в схеме и конвертирует его в Origin Attributes. MDN-таблица версий не даёт отдельной подтверждённой границы этого подполя. Поддержку целевой версии требуется проверять в disposable native-профиле. Снятие неподдерживаемого бита при импорте меняет identity, поэтому должно завершаться явной несовместимостью, а не fallback в другую partition. [Gecko schema](https://raw.githubusercontent.com/mozilla/gecko-dev/master/toolkit/components/extensions/schemas/cookies.json), [Gecko implementation](https://raw.githubusercontent.com/mozilla/gecko-dev/master/toolkit/components/extensions/parent/ext-cookies.js)

Собственная проверка Firefox 138.0.4 подтвердила оба отдельных ancestor states и возврат бита в native `Cookie.partitionKey`. Controller включает эту capability после чтения версии Firefox 138 или новее; старые/неопределённые версии остаются conservative. Firefox также допускает `false` для совпадающего registrable host при разной HTTP/HTTPS схеме top-level site; Chrome требует совпадения полной schemeful site. Проверенные Firefox native-результаты

## Рекомендуемое каноническое представление

Это пример структуры для согласования, а не новый wire-контракт:

```json
{
  "format": "detect.expert.cookies",
  "formatVersion": 1,
  "source": { "browser": "chrome" },
  "stores": [{ "id": "0" }],
  "cookies": [{
    "storeId": "0",
    "domain": "example.com",
    "hostOnly": true,
    "path": "/",
    "name": "example",
    "value": "",
    "secure": true,
    "httpOnly": true,
    "sameSite": "lax",
    "session": true,
    "expirationDate": null,
    "partitionKey": null,
    "firstPartyDomain": null
  }]
}
```

Порядок полей фиксируется writer. Массивы сортируются по полному переносимому ключу; время экспорта не включается в канонический набор данных. Пустое `value: ""` сохраняется без преобразований, URI decoding, trimming или повторного encoding. `expirationDate` хранит секунды Unix, включая предоставленную браузером дробную часть. `session: true` соответствует `expirationDate: null`; persistent требует конечного числа. Современный Firefox возвращает дробные секунды, но старые версии округляли их. [Firefox Cookie](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/cookies/Cookie), [Mozilla compatibility data](https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/cookies.json)

`partitionKey: null` явно означает unpartitioned. У partitioned записи должны быть непустой `topLevelSite` и сохранённый ancestor bit, если он предоставлен. Неизвестный бит старого внешнего формата не превращается молча в `false`. `firstPartyDomain: null` означает отсутствие соответствующего поля у браузера-источника; `""` — предоставленное пустое значение. Непустой FPI-ключ нельзя при переносе в Chrome заменять на unpartitioned cookie.

Полный переносимый ключ включает целевой store, canonical domain и host-only семантику, path, name, partition key с ancestor bit, first-party domain. В частности, одноимённые cookie разных paths, partitions или контейнеров — разные записи. Нужно проверять коллизии и до, и после store mapping.

Перед записью `topLevelSite` должен уже совпадать с каноническим schemeful site. Например, `https://sub.example.com:123` браузер может свести к `https://example.com`; иначе предварительное сравнение отсутствия записи относится к другой identity, чем последующая запись. Реализация проверяет это по существующему закреплённому offline PSL с ICANN и PRIVATE sections; неканонические/неизвестные partition keys остаются экспортируемыми данными, но не записываются с потерей identity.

`hasCrossSiteAncestor: false` дополнительно требует совпадения schemeful site URL устанавливаемой cookie и `topLevelSite`. Нельзя задать `false` для cookie `https://owned-cookie.example.com/` с ключом `https://example.net` или `http://example.com`. Chrome 153 отвергает такие сочетания; same-site `https://example.com` допускает обе отдельные identities с `false` и `true`. Проверка выполняется до записи; браузер не используется для автоматического исправления бита. Native-проверка

В новых конфигурациях Chromium внутренний уникальный ключ может учитывать source scheme и source port, которых extension Cookie API не возвращает. Поэтому видимые API записи не всегда дают побайтовую копию базы. Если native результат содержит несколько записей с одинаковой переносимой identity, их нельзя тихо склеивать. [Chromium cookie keys](https://raw.githubusercontent.com/chromium/chromium/main/net/cookies/unique_cookie_key.h), [Chromium cookie base](https://raw.githubusercontent.com/chromium/chromium/main/net/cookies/cookie_base.cc)

## Native set, readback и удаление

Для `hostOnly: true` поле `domain` в set опускается; иначе передаётся domain. Для session опускается `expirationDate`. Остальные переносимые атрибуты передаются явно, включая выбранный целевой store и поддерживаемые isolation-ключи. Ни `hostOnly`, ни `session` не копируются как поля `set`.

URL конструируется из отдельно проверенного host с HTTPS и путём `/`. HTTPS является контекстом native setter; флаг `secure` передаётся независимо и не меняется автоматически. Это позволяет Chrome корректно изменить существующий Secure cookie на `secure: false`: HTTP-контекст такого setter Chrome отвергает. Host permission проверяется для фактически используемого HTTPS URL. Оригинальный `cookie.path` всегда передаётся отдельным свойством. Нельзя просто приклеивать path к URL: `?`, `#`, backslash, dot segments и URL encoding могут изменить request URI. Host не должен содержать userinfo, path, query или неявный port; для IPv6 требуется корректная bracket-форма. Никакого запроса по этому URL расширение не отправляет. Проверка setter context

Нативная проверка Chrome 153.0.8010.12 выявила дополнительную нормализацию уже отдельного свойства `path`: `/a b` становится `/a%20b`, `/a/../b` — `/b`, `/a?b#c` — `/a%3Fb%23c`, backslash — slash, Unicode — percent-encoded UTF-8. Firefox 138.0.4 сохраняет эти пути буквально. Перед записью Chrome такие входы отклоняются, чтобы не перезаписать другую, заранее не проверенную identity. Уже encoded пути, включая `%20`, `%2F`, а также literal `%` и безопасная пунктуация сохраняются. Read-only просмотр и JSON не меняют исходные paths. Собственные native-артефакты

Та же проверка подтвердила: Chrome принимает Domain `.com`, `.co.uk` и `.localhost` с URL того же хоста, но создаёт **host-only** cookie. Firefox эти записи отвергает. Поэтому до записи domain-scoped cookie проверяется наличие известного registrable domain по pinned offline PSL. Публичные суффиксы, локальные и неизвестные suffix contexts не записываются с изменением host-only семантики. Host-only cookie для локальных хостов этим ограничением не запрещаются.

Chrome 153 принял name+value ровно 4096 UTF-8 bytes и path ровно 1024 bytes, отверг 4097/1025. Он также отверг semicolon в value, начальный/конечный ASCII space и сочетание пустых name и value; кавычка, backslash, Unicode name и value сохранились. Эти доказанные ограничения проверяются перед Chrome write. Firefox 138.0.4 допустил проверенные 4097/1025 и эти value-сочетания, поэтому из Chrome-ограничений не сделан неподтверждённый общий запрет Firefox. Канонический JSON сохраняет более длинные legacy/native записи в пределах собственного лимита. [Chromium size definitions](https://raw.githubusercontent.com/chromium/chromium/main/net/cookies/parsed_cookie.h), Chrome native, Firefox native

Результат `set` не является достаточной проверкой конкретной записи. При совпадении имени браузер может вернуть cookie по правилам URL/path ordering. После мутации выполняется `getAll` в точной области и own-property сравнение полного ключа, значения и атрибутов. Отдельно отмечается разрешённая браузерная нормализация даты, а не произвольное расхождение. Chrome может сократить срок до 400 дней; неизменяемой датой в файле нельзя заставить браузер превысить его политику. [Chrome expiration limit](https://developer.chrome.com/blog/cookie-max-age-expires/)

`cookies.remove({url, name, ...})` не идентифицирует cookie по точному domain/path: при нескольких совпадениях выбирается один. Для точного удаления можно установить истёкшую cookie с той же полной identity и затем проверить отсутствие через `getAll`. Такой путь требует native-тестов в обоих браузерах, в том числе host-only/domain коллизий и prefixes. Нельзя удалить другую одноимённую cookie и назвать действие успешным. [Firefox remove](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/cookies/remove)

Валидация prefixes учитывает `__Secure-`, `__Host-`, `__Http-`, `__Host-Http-`. В частности, Host требует host-only, Secure и path `/`; Http-варианты дополнительно требуют HttpOnly. Эти ограничения проверяются до native mutation; браузер остаётся окончательным источником допустимости. [Set-Cookie prefixes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)

## Импорт и восстановление после ошибки

Рекомендуемый протокол:

1. Ограничить размер файла, число записей и длины полей до JSON parsing/построения UI; запретить getters, опасные object keys и неявную coercion в программных входах.
2. Распознать поддерживаемую версию собственного JSON, явно поддерживаемый внешний Cookie-Editor array или Netscape. Не объявлять любую похожую JSON-структуру «совместимой».
3. Полностью проверить структуру, типы, isolation, prefixes, host permissions и все дубликаты. Невалидный файл не вызывает ни одного set/remove.
4. Отобразить preview именно применяемого набора и store mapping. Режим по умолчанию — merge: не удалять cookie, которых нет в файле. Истёкшие записи показывать как пропуск; импорт не использует их как команду удаления.
5. Прочитать текущие значения затрагиваемых identities в память, построить неизменяемый план. При изменении файла, mapping или target сбросить план.
6. Непосредственно перед каждым write проверить, что исходное состояние соответствует preview. Писать последовательно и проверять фактический readback. При неизвестном исходе записи прекратить дальнейшие записи, пометить остаток как `not-attempted` и сохранить Undo подтверждённых изменений. Подтверждённый отказ отдельной записи отражать в результате, продолжая пакет; отмена операции или смена её epoch прекращает дальнейшие записи.
7. Восстанавливать выполненные записи в обратном порядке, только если текущая запись всё ещё соответствует собственному последнему write. Если сайт или другое окно успели изменить cookie, не перезаписывать такое изменение; показать конфликт и конкретный итог. Новые собственные записи удалять точно, ранее существовавшие восстанавливать.
8. Не обещать транзакционность cookie API: атомарного multi-cookie transaction и compare-and-swap нет. После закрытия страницы/выгрузки контекста нельзя обещать сохранившийся in-memory Undo. При отзыве разрешения прекращать новые операции.

Пункты о плане, конфликтах и rollback — инженерные выводы из отдельной асинхронной природы методов, а не возможность browser transaction API. Сохранять содержимое cookie или rollback snapshots в storage, telemetry, обычный отчёт либо логи не требуется. Ошибки пользователю выдаются структурированными кодами без необработанного browser exception, который может содержать данные cookie.

## Netscape и внешние JSON

Netscape содержит семь tab-separated полей и расширение `#HttpOnly_`; не хранит SameSite, partition, FPI, store mapping и дробную точность expiry. Строки с tabs/CR/LF в полях нельзя экспортировать под видом корректного файла. `0` в поле expiry трактуется как session, а не native `expirationDate: 0`. Partition/FPI записи нельзя автоматически уплощать в unpartitioned; их экспорт в этот формат следует отклонять либо требовать явно выбранный преобразованный набор. [curl cookie format](https://curl.se/docs/http-cookies.html)

Отсутствующий в Netscape SameSite представлен в canonical import как `unspecified`. Поэтому Firefox до 140 не может применить такой файл без семантической потери: preview явно отклоняет запись, а не превращает её в `SameSite=None`. В Firefox 140+ поддержка этого enum документирована Mozilla; нативная проверка установленного 138 подтверждает отказ, а не поддержку новой версии. [Mozilla compatibility data](https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/cookies.json)

Внешний JSON array может быть полезен для Cookie-Editor совместимости, но не имеет одной обязательной универсальной версии. Следует перечислить принимаемые поля и алиасы SameSite; неизвестные существенные isolation-поля не терять. Отсутствие hostOnly/session допустимо только в явно выбранном legacy-reader с определёнными правилами, отражёнными в preview.

## Перенос cookie и перенос авторизации

Проверка readback подтверждает сохранение native cookie, а не вход в серверный аккаунт. Сервер может отклонить сессию по собственным правилам, сроку или привязке; приватный DBSC-ключ не является полем Cookie API. Расширение не определяет аппаратную привязку по названию, длине, JWT-подобию либо Secure/HttpOnly. Это не основание возвращать удалённый ADR-044 CDP-модуль. [Chrome DBSC](https://developer.chrome.com/docs/web-platform/device-bound-session-credentials)

Отдельное шифрование экспортируемого файла возможно в доверенной UI-странице WebCrypto: версионированный envelope, случайные salt/IV, фиксированный допустимый KDF-профиль и authenticated encryption. Это выбор реализации, не обязательное условие native API. Нельзя принимать произвольные KDF-параметры из файла без верхних границ или записывать пароль/ключ в storage. В любом формате экспорт формируется локально из просмотренного пользователем набора, без внешней отправки.

## Минимальная native-матрица перед выпуском

- Chrome и Firefox: empty value/name, session/persistent, host-only/domain, HttpOnly, все SameSite, несколько одинаковых names с разными paths, Secure/prefixes, явный store mapping.
- CHIPS: два top-level sites и оба представимых ancestor states; сохранение isolation после export/import и отсутствие unpartitioned копии.
- Firefox: FPI с явным firstPartyDomain, контейнеры, unsupported ancestor/fractional expiry на старой версии.
- Whole-file validation: обрезанный/неверный JSON, неизвестная версия, массив огромного размера, дубли до/после mapping, чужие object keys, невалидный URL/domain, истёкшая cookie.
- Поведение при rejected set, изменённом readback, отзыве permissions, закрытом UI и конфликтующем изменении сайта; проверка точного rollback и удаления.
- Только disposable profiles и собственные fixture cookie. Артефакты проверки содержат коды и счётчики, а не активные cookie пользовательских профилей.
