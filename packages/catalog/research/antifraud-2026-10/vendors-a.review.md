# Проверка части A: браузерные интеграции

Дата: 2026-10-09. Связано с ADR-009 / REQ-008. Артефакт: `vendors-a.json`.

Собрано 35 продуктовых записей: 23 имеют документированные browser artifacts, 12 — подтверждённый продукт без установленного отличительного browser artifact. Всего 66 артефактов и 43 уникальных первичных публичных источника. Источники прочитаны через браузерный инструмент; для каждого сохранены URL, название, точное содержание подтверждаемого утверждения и дата доступа.

Это продуктовые записи, а не рейтинг 35 независимых поставщиков. Разные продукты HUMAN, Akamai, AWS, Cloudflare, Google, Kasada и Friendly Captcha перечислены отдельно, поскольку различаются назначение и допустимая атрибуция. Объединение в общий каталог должно сохранить связь с поставщиком и избегать двойного подсчёта альтернативных названий.

## Проверенные ограничения атрибуции

- ThreatMetrix: точные браузерные loader host/path подтверждены первичными интеграционными документациями Ping Identity и Cielo. Пользовательские profiling domains также документированы. `tmx_sdk_profiling.js` — файл SDK, а не npm-пакет и не универсальный сетевой маркер.
- HUMAN: имена cookie публикуются с таблицей использующих их продуктов. Общие `_px*`, `_pxvid`, `pxcts` не различают Sightline и прежние продукты. Признаки Account Defender из этой таблицы относятся к SDK/WebView.
- Cloudflare: `__cf_bm` и `cf_clearance` относятся к нескольким возможностям. Общий CDN или cookie не устанавливает Enterprise Bot Management. Turnstile имеет отдельный документированный точный loader.
- AWS WAF: `AwsWafIntegration` и `aws-waf-token` общие для нескольких интеграций. `AwsWafCaptcha` указывает на CAPTCHA API, однако общая интеграция не различает ATP, ACFP и Bot Control. `challenge.js`/`jsapi.js` без достоверного deployment origin недостаточны.
- F5: официальная документация требует выбираемый заказчиком путь JavaScript. Пример пути не превращён в сигнатуру.
- Kasada/Imperva/Akamai: существование и технология продукта подтверждены; неподтверждённые cookie/header/loader имена не добавлены.
- Fingerprint и Vercel: импортируемые package/module binding не объявлены универсальными browser globals.
- Shared CDN: для jsDelivr и Alibaba применяется документированный путь пакета/ресурса, а не общий hostname.
- First-party delivery: документировано для ThreatMetrix, DataDome, Fingerprint и Friendly Captcha; отсутствие стороннего домена не исключает продукт.
- WebRTC: все 35 записей имеют `unknown`. Старые runtime-правила расширения не использованы как первичная vendor-документация. Новые TURN/STUN endpoints не придуманы.

## Проверка файла

PowerShell `ConvertFrom-Json` с проверками уникальности ID, HTTPS source URLs, обязательных claims/titles/date, связности каждого signal с source внутри записи и выключенного production gate завершился:

```json
{"records":35,"signals":66,"uniqueSources":43,"withSignals":23,"catalogOnly":12,"webrtcUnknown":35,"validation":"PASS"}
```

Изменены только этот отчёт и `vendors-a.json`. Runtime, manifest и существующие seed/production правила не менялись. Переключение кандидатов в production не выполнялось; нужны отдельные positive/negative fixtures и независимый review согласно ADR-009.

Не выполнялись Shodan-запросы, чтение ключей, активное сканирование, перечисление IP/портов/CVE или серверных активов. Данные описывают только публичные browser integrations. Временные запросы к страницам документации были read-only; опубликованный JavaScript не запускался.
