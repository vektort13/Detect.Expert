# Маячки, фоновая работа и восстановление cookies

2026-10-09. Реализация по явному решению владельца продукта в порядке ADR-030 → ADR-031 → ADR-032. Общая production-база Chrome/Firefox, версия 1.1.0. Permissions, CSP, зависимости и DBSC debugger allowlist не расширены.

## Декодер маячков

11 отдельных transport profiles: GA4 browser/Measurement Protocol, Google Ads browser, Meta browser/Conversions API, TikTok browser/Events API, Яндекс watch/Measurement Protocol, LinkedIn image/Conversions API. GA4 MP и server API профили работают только для наблюдаемого браузером запроса; серверные пересылки недоступны.

Поля: фиксированное событие, стоимость/ценность цели/выручка с назначением, ISO currency, наличие Client ID/browser ID/session ID/user ID/hashed email/hashed phone, наличие gcs/gcd, документированные consent states. Полные значения идентификаторов, хэши, secrets, произвольные параметры и тела не сохраняются. Неподдерживаемый, неоднозначный, некорректный или сокращённый разбор имеет отдельный decodeStatus. Browser SDK wire profiles, подтверждённые примерами, остаются transport-candidate; TikTok browser и Яндекс watch имеют endpoint-only профиль. Наличие gcd не считается включённым Consent Mode.

Native network request имеет authoritative document identity, destination/initiator access, раздельные request/completed/failed/redirect counts и HTTP statuses. Source-attributed page calls показаны отдельно: currentScript либо sampled-stack, page-controlled. Они не прибавляются к network requestCount. GTM loader edges сохраняются существующим отдельным разделом; тайминг не связывает GTM с конкретным hit. В Firefox 138 native network identity отключена существующим adapter: query-проекция берётся из текущего ISOLATED Resource Timing, метод неизвестен, POST body и native outcome отсутствуют.

Лимиты: URL/body 32 KiB, 64 полей, 16 событий, 64 network rows и 32 script-call rows на документ, 32 документа, 512 pending requests/30 секунд, 10 минут TTL. Pro сохраняет максимум 24 документа/256 суммарных строк и проходит канонический guard. Измерения decoder: JSON. Provenance: [ledger](../../scripts/production/beacon-source-ledger.mjs).

## Фоновая работа

Пассивные вызовы 12 методов ServiceWorkerContainer/PushManager/SyncManager/PeriodicSyncManager/Notification. Native original вызывается один раз, Promise identity и sync exceptions сохраняются. Наблюдается возврат Promise, его результат не перехватывается.

Явная кнопка проверяет current-origin Service Worker registrations, Push subscription presence, количества Sync/Periodic Sync tags и фактические permissions. Pro выполняет такую проверку один раз на документ в рамках включённой записи, затем сохраняет обновляемые пассивные вызовы. checkedAt показывает время inventory. Диагностика не запускает registration/subscription/prompt/sync и не отменяет их. Внутренние worker callbacks и фактические фоновые отправки после закрытия вкладки этим разделом не записываются.

Не сохраняются push endpoint, auth/p256dh, subscription JSON, task tags, private scope/script paths. Максимум 16 registrations, 64 operation groups/12 KiB bridge, 32 документа/10 минут. Ошибки и неполная инвентаризация не превращаются в точный ноль. Periodic Sync поддержка и permission определяются текущим браузером.

Firefox 138 не предоставляет ServiceWorkerContainer и связанные интерфейсы trusted ISOLATED content-script, хотя регистрация на самой странице работает. Это подтверждено нативными descriptors и соответствует [Mozilla ServiceWorkersEnabled](https://github.com/mozilla/gecko-dev/blob/master/dom/serviceworkers/ServiceWorkerUtils.cpp). Поэтому inventory metadata сохраняет unsupported/null, UI показывает «Данные недоступны» и сохраняет наблюдаемые MAIN вызовы. Отсутствие интерфейса проверки не выдаётся за отсутствие Service Worker у сайта. Privileged MAIN fallback и расширение Firefox permissions не добавлены; native constructor lookup поддерживает inherited data descriptors и проверенные native getters.

## Проверка восстановления cookie

Кнопка запускает опыт с одной выбранной persistent documented tracking-cookie главного документа. HttpOnly, session, auth/token/CSRF и неоднозначный target не допускаются. Listener установлен до удаления; сравнение прежнего и нового значения выполняется в оперативной памяти backend. Watching длится 10 секунд. Результат и cleanup outcome сохраняются metadata в Pro; handles/values/hashes не сохраняются.

Read-only корреляция выбранной non-HttpOnly cookie: до 64 localStorage entries, 4 IndexedDB databases × 4 stores × 16 records/16 собственных scalar fields, до 4 cache root responses × 32 KiB, 700 ms. CacheStorage.match не создаёт кэши; произвольные cache URLs не перечисляются. Имена/ключи/records/body/values не пересекают bridge. matchedStores означает совпадение, источник восстановления остаётся unknown.

При отсутствии восстановленной cookie backend возвращает исходную только при прежнем разрешённом document/store/partition scope. Уже наблюдаемое новое значение не перезаписывается. cookies API не имеет atomic compare-and-set: между последней проверкой отсутствия и фактическим native write остаётся короткое окно гонки. При revoke/navigation cleanup write пропускается. Browser shutdown/аварийное завершение backend может прервать cleanup; резервные значения не сохраняются на диск. Действие меняет только выбранную tracking-cookie, а не сессию входа.

## Артефакты и проверка

Канонические контракты: [beacons.mjs](../../packages/contracts/src/beacons.mjs), [background-activity.mjs](../../packages/contracts/src/background-activity.mjs), [cookie-probe.mjs](../../packages/contracts/src/cookie-probe.mjs), [advanced-inspection.mjs](../../packages/contracts/src/advanced-inspection.mjs). Shared UI/Pro: [advanced-ui.js](../../apps/production-extension/advanced-ui.js), [pro-advanced-capture.js](../../apps/production-extension/pro-advanced-capture.js).

Semantic/privacy/negative/race tests расположены в scripts/test; native стенды используют только синтетические данные и собственные loopback ресурсы. Native Chromium: 17 advanced + 29 regression groups; установленный Firefox: 44 groups; layout: 387 cases / 6 checks на 21 языке; unit: 2159, fail/skip 0. Актуальные source/package hashes и пределы нативной приёмки: отчёт реализации, release freeze. Независимый review.
