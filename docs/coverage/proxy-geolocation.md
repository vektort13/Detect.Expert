# Proxy Manager Geolocation API — покрытие и интерфейсы (ADR-109)

Решение и границы — [ADR-109](../decisions/ADR-109-proxy-manager-geolocation-api.md). Этот документ — техническая спецификация модулей, привязка
полей четырёх провайдеров к одной нормализованной записи и честный список того, что проверено, а что нет.
Единый контракт форм данных — `apps/production-extension/proxy-geo-shared.js` (константы, каталог, строгие читатели); тесты — `scripts/test/proxy-geo-shared.test.mjs`.

## Модули (`apps/production-extension/`)

| Файл | Назначение | Сеть |
| --- | --- | --- |
| `proxy-geo-shared.js` | Каталог провайдеров, лимиты, коды ошибок, чистка внешнего текста, публичный IP, строгие читатели настроек, ключей, записи и кэша | нет |
| `proxy-geo-providers.js` | Чистые функции: `geoBuildRequest` (запрос провайдеру) и `geoParseResponse` (ответ → запись или код ошибки) | нет |
| `proxy-geo-client.js` | **Единственный файл с `fetch`.** Один HTTP-запрос с таймаутом, ограничением тела и жёсткими опциями | да, GET |
| `proxy-geo-store.js` | Чтение и запись `storage.local` / `storage.session`, перенос ключей при «Запомнить», подписка на `storage.onChanged` | нет |
| `proxy-geo-controller.js` | Состояние для интерфейса, очередь, темп, кэш, резерв провайдеров, память об ошибках, проверка ключа | через client |
| `proxy-geo-settings.html/.js/.css`, `proxy-geo-settings-labels.js` | Страница настроек «Proxy Manager Geolocation API» (как `precursor-settings.*`) | нет |
| `proxy-geo-manager-labels.js` и правки `proxy-ui*.js`, `proxy-list-ui.js`, `proxy-peek-ui.js`, `proxy-ui.css` | Уведомление, столбцы, детали, кнопки в менеджере прокси | нет |
| `proxy-geo-ui-model.js` | Чистые помощники интерфейса менеджера: состояние уведомления, выбор столбцов, внешний IP строки, модели ячеек, правило несовпадения со страной-меткой, часовой пояс через `Intl`, ключи подписей, цели «определить для всех» | нет |
| `proxy-geo-settings-i18n.js`, `proxy-geo-manager-i18n.js` | Переводы двух модулей подписей на 19 языков (только данные; английский и русский лежат в самих модулях подписей) | нет |
| `management-ui.js`, `management-hub.js` | Пункт «Proxy Manager Geolocation API» рядом с Cloudflare Precursor, запись командной палитры; плитка «Интеграции» в хабе открывает раздел с обоими пунктами | нет |

## Интерфейсы

### `proxy-geo-providers.js`

```js
geoBuildRequest(providerId, ip, { credential, settings })
//  ip: канонический публичный адрес (geoCanonicalIp + geoIsPublicIp), иначе { ok:false, error:'not-public' }
//  credential: результат geoCleanCredential или null; settings: normalizeGeoSettings(...)
//  → { ok: true, url, headers, origin, bucket } | { ok: false, error: 'not-public' | 'no-key' | 'http-not-allowed' }
//  origin — один из GEO_PROVIDER_INFO[id].origins (ровно хост запроса); bucket — 'ipapi-free' для бесплатной точки, иначе id провайдера.
geoParseResponse(providerId, { status, headers, text }, { ip, now, settings })
//  headers — объект с именами в нижнем регистре; text — тело ответа (≤ 64 КиБ).
//  → { ok: true, record, quota } | { ok: false, error, retryAfterMs, quota }
//  record — результат normalizeGeoRecord (или ошибка 'bad-response'); quota — { remaining: число|null, pausedMs: число|null } | null;
//  error — член GEO_ERRORS; retryAfterMs — число | null (подсказка паузы провайдеру).
```

Запрос: только `GET`, ключи только в URL-параметре / заголовке `Authorization`, никаких cookie и тела. Ошибки не содержат URL и ключей.

### `proxy-geo-client.js`

```js
createGeoClient({ fetchImpl, now, setTimeoutImpl, clearTimeoutImpl })
  .request({ providerId, ip, credential, settings }) // → Promise<{ ok:true, record, quota } | { ok:false, error, retryAfterMs, quota }>
```

Никогда не бросает. Опции `fetch`: `method:'GET'`, `credentials:'omit'`, `redirect:'error'`, `cache:'no-store'`, `referrerPolicy:'no-referrer'`, `signal`.
Таймаут `GEO_LIMITS.requestMs`; тело читается потоком и обрывается на `GEO_LIMITS.responseBytes`; для успешных ответов тип содержимого должен содержать `json`.

### `proxy-geo-store.js`

```js
createGeoStore({ api, now }) // api — chrome/browser; api.storage.session может отсутствовать
  .loadAll()                     // → { settings, credentials, cache } (все прошли normalize*)
  .saveSettings(settings)        // нормализует; пишет storage.local
  .saveCredentials(credentials)  // область по settings.remember: true → local (из session удаляется), false → session (из local удаляется)
  .moveCredentials(remember)     // перенос при смене «Запомнить», сначала запись в новую область, затем удаление из старой
  .saveCache(cache) / .clearCache()
  .watch(listener)               // storage.onChanged для трёх ключей в local/session → listener() ; возвращает отписку
```

### `proxy-geo-controller.js`

```js
createGeoController({ api, fetchImpl, now, sleep }) // по умолчанию клиент и хранилище создаются внутри
  .load(): Promise<GeoState>
  .getState(): GeoState                     // заморожено; новый объект на каждое изменение
  .subscribe(listener): () => void          // listener() после каждого изменения (склеивается в микрозадачу)
  .lookup(ip, { force = false }): Promise<{ ok:true, record, fromCache } | { ok:false, error }>
  .noteExitIp(ip): void                     // автоопределение после ручной проверки; ничего не делает, если выключено, не готово, не публичный IP, есть свежий кэш/ожидающий запрос/недавняя ошибка
  .testProvider(providerId): Promise<{ ok:true, record } | { ok:false, error }>  // один запрос к GEO_TEST_IP только этому провайдеру, без кэша, без резерва; работает при выключенном общем переключателе
  .setEnabled(bool) / .setOption('auto'|'failover'|'remember', bool) / .setColumns(list) / .setProvider(id, patch)
  .saveCredential(id, input): Promise<{ ok:true } | { ok:false, error:'invalid-key' }>
  .forgetCredential(id) / .forgetAllCredentials() / .clearCache()
  .dispose()

GeoState = {
  loaded, revision,
  settings,                 // normalizeGeoSettings
  enabled,                  // settings.enabled
  ready,                    // enabled && readyProviders.length > 0
  readyProviders,           // ids в порядке приоритета
  hasCredentials,           // { [id]: boolean } — никогда не сам ключ
  providers,                // { [id]: { enabled, ready, reason, status:'idle'|'ok'|'error', error, okAt, remaining, pausedUntil } }
  records,                  // объект без прототипа: { [ip]: GeoRecord } — содержимое кэша
  pending,                  // объект без прототипа: { [ip]: true }
  errors,                   // объект без прототипа: { [ip]: { code, at } } — только до закрытия страницы
  cacheCount,
}
```

Правила: все результаты `lookup` — через `normalizeGeoRecord`; канонизация адреса и проверка публичности до любого сетевого вызова; параллелизм `GEO_LIMITS.concurrency`;
темп для `ipapi-free` — не чаще 40 запросов в минуту (и пауза по `X-Rl`/`X-Ttl`), для остальных — интервал ≥ 200 мс; повторов в цикле нет;
ошибки, не являющиеся временными (`GEO_TRANSIENT_ERRORS`), запоминаются на 10 минут для этого адреса (без `force` запрос не повторяется);
резерв: при ошибке из `GEO_FAILOVER_ERRORS` и включённом `failover` тот же адрес идёт следующему готовому провайдеру (не более трёх попыток на адрес);
ключ не попадает ни в состояние, ни в кэш, ни в ошибки, ни в журналы.

## Привязка полей провайдеров к записи

Запись: `provider, service, at, ip, country, countryName, region, city, timezone, asn, org, isp, kind, flags` (см. `normalizeGeoRecord`).
Флаг `true/false` ставится только когда провайдер сообщил поле; иначе `null`. Все поля необязательны; неверный тип поля — пусто/`null`, а не ошибка.

| Поле | MaxMind (`city`/`insights`) | ipgeolocation.io (`/v3/ipgeo`) | ipdata (`/{ip}`) | ip-api.com (`/json/{ip}`) |
| --- | --- | --- | --- | --- |
| `ip` | `traits.ip_address` | `ip` | `ip` | `query` |
| `country` | `country.iso_code` | `location.country_code2` | `country_code` | `countryCode` |
| `countryName` | `country.names.en` (иначе первое значение `names`) | `location.country_name` | `country_name` | `country` |
| `region` | `subdivisions[0].names.en` | `location.state_prov` | `region` | `regionName` (иначе `region`) |
| `city` | `city.names.en` | `location.city` | `city` | `city` |
| `timezone` | `location.time_zone` | `time_zone.name` | `time_zone.name` | `timezone` |
| `asn` | `traits.autonomous_system_number` | число из `asn.as_number` (`AS1257`) | число из `asn.asn` (`AS15169`) | число из начала `as` (`AS15169 Google LLC`) |
| `org` | `traits.autonomous_system_organization` | `asn.organization` | `asn.name` | остаток `as` после номера (иначе `asname`) |
| `isp` | `traits.isp` (иначе `traits.organization`) | `company.name` (платный) | `company.name` (платный) | `isp` (иначе `org`) |
| `kind` | `traits.user_type`, иначе `traits.connection_type` | `asn.type` / `company.type` / `network.is_cdn` / `network.connection_type` | `asn.type` / `company.type`; объект `carrier` → `mobile` | `hosting` → `hosting`, `mobile` → `mobile` |
| `proxy` | `anonymizer.is_public_proxy` | `security.is_proxy` | `threat.is_proxy` | `proxy` (прокси, VPN или Tor) |
| `vpn` | `anonymizer.is_anonymous_vpn` | `security.is_vpn` | `threat.is_vpn` (Business) | — |
| `tor` | `anonymizer.is_tor_exit_node` | `security.is_tor` | `threat.is_tor` | — |
| `hosting` | `anonymizer.is_hosting_provider` | `security.is_cloud_provider` | `threat.is_datacenter` | `hosting` |
| `mobile` | `connection_type`/`user_type` = cellular | — | объект `carrier` с именем | `mobile` |
| `relay` | — | `security.is_relay` | `threat.is_icloud_relay` | — |
| `residentialProxy` | `anonymizer.is_residential_proxy` | `security.is_residential_proxy` | — | — |
| `threat` | — | `security.is_known_attacker` | `threat.is_known_attacker` или `is_known_abuser` или `is_threat` | — |

Признаки MaxMind (MaxMind не отдаёт ключи с пустым значением и ложные булевы, а `anonymizer` и устаревшие `traits.is_*` есть только в Insights): присутствующий булев ключ берётся как есть; `anonymizer.residential` (объект) даёт `residentialProxy: true`;
если в `anonymizer` стоит `is_anonymous: true` или непустое `provider_name`, отсутствующие ключи — `null` (VPN-провайдер может быть отмечен только флагом хостинга), иначе отсутствующий ключ — `false`; без объекта `anonymizer` пять флагов у Insights — `false`, у GeoLite и City Plus — `null`;
устаревшие `traits.is_*` тоже читаются, `true` из любого источника побеждает. Выбор `kind`: первый отображённый вид, не равный `other`; `other` — только если ничего не отображено. Словарь `kind`: `user_type` `residential`→residential, `hosting`→hosting, `cellular`→mobile,
`business`→business, `school`/`college`/`library`→education, `government`/`military`→government, `content_delivery_network`→cdn, остальное → other;
`connection_type` `Cellular`→mobile, `Corporate`→business, `Cable/DSL`/`Satellite`→isp. ipgeolocation.io `network.connection_type`: `Mobile`→mobile, `DSL`/`Cable`/`Fiber`/`Satellite`/`Dial-Up/ISDN`→isp, `Wireless` и `5G` — `other` (значение неоднозначно). Типы автономных систем и компаний (`ISP`, `HOSTING`, `BUSINESS`, `EDUCATION`, `GOVERNMENT`, `CDN`; у ipdata также `edu`, `gov`, `mil`, `unknown`→пусто) —
регистр не важен. Незнакомое непустое значение → `other`.

## Ошибки

Общая схема: коды HTTP и тела из таблицы ADR-109 → члены `GEO_ERRORS`. Если ответ 2xx не разбирается как JSON, не объект или не содержит ни одного ожидаемого поля — `bad-response`.
Ответ ip-api со `status:"fail"` приходит с HTTP 200. Ответы MaxMind-ошибок могут быть без тела (403 по HTTP, 429, 5xx): код берётся из статуса. Тексты ошибок провайдера в запись и состояние не попадают.

## Что проверено

| Что | Статус |
| --- | --- |
| Форма запроса и ответа бесплатной точки ip-api.com (успех и `private range`) | проверено живыми запросами 2026-11-06 (HTTP 200, `Access-Control-Allow-Origin: *`, `X-Rl`, `X-Ttl`) |
| Формат Pro ip-api (`https://pro.ip-api.com/json/{ip}?key=…`) | на неверном ключе проверено живьём (HTTP 403, «invalid/expired key»: сервер узнаёт хост и параметр); успех не проверялся |
| MaxMind, ipgeolocation.io, ipdata: адреса, авторизация, ответ на неверный ключ | проверено живьём 2026-11-06 (401 и тела ошибок совпали с документацией; MaxMind — на обоих хостах) |
| MaxMind, ipgeolocation.io, ipdata: успешные ответы, поля, лимиты | кандидат: по официальной документации и образцам ответов, без ключей; настоящую проверку делает пользователь кнопкой «Проверить ключ» |
| Поведение в Chrome: CSP, `http:` из страницы расширения, чтение ответов без CORS | проверено живьём (шесть хостов доступны, хост вне списка заблокирован CSP); отсутствие cookie и Referer проверяется нативными тестами (перехват запросов) |
| Firefox | нативные проверки страницы настроек и менеджера в Firefox 138 |

Не покрыто: точность данных провайдеров (они приблизительны и различаются), тарифы и лимиты на момент использования (в интерфейсе сказано «по документации»),
запросы из Worker и MAIN (их нет), IPv6-покрытие каждого провайдера.
