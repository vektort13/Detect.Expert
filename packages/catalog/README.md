# Каталог антифрод-интеграций

`data/antifraud.v1.json` — 131 продуктовая запись, 168 уникальных первичных источников, 191 документированный кандидат признака, 73 точных браузерных домена. 65 продуктов имеют кандидатов, у 60 есть потенциально наблюдаемый браузерный маркер; ещё 66 подтверждены как продукты без установленного отличительного браузерного признака. Каталог не ранжирован по рыночной доле. Разные продукты одного поставщика и исторические названия не считаются разными независимыми внедрениями.

JSON содержит официальный сайт, поставщика, назначение, датированные источники с проверяемыми утверждениями, раздельные host/path, опубликованные шаблоны, имена SDK/global/DOM/cookie/header, область атрибуции, жизненный цикл, ограничения и индекс доменов. Имена перечисляются без значений cookie, токенов, заголовков, форм и параметров сессии. `document-context` обозначает опубликованную зависимость от протокола документа; `unknown` — отсутствие подтверждённой схемы. SDK package/file/описание SDK отделены от пассивно наблюдаемых маркеров.

CSV для просмотра в таблицах: `data/antifraud.vendors.csv`, `data/antifraud.signals.csv`, `data/antifraud.sources.csv`. Каноническим источником остаётся JSON: CSV экранирует возможные формулы. Первичные исследовательские записи A–D находятся в `research/antifraud-2026-10`; генератор объединяет пять повторяющихся продуктов и сохраняет источники.

```powershell
pnpm catalog:build
pnpm catalog:lint
pnpm catalog:test
pnpm catalog:shodan:plan
```

Все новые кандидаты имеют `productionEnabled=false`, `fixtureVerified=false`, `requiresCorroboration=true`. Точные ресурсы, shared CDN, общие SDK, имена на странице и серверные продукты имеют разную доказательность. Совпадение общего артефакта связано с несколькими записями через `artifactGroupId` и `relatedVendorIds`. Новых документально подтверждённых WebRTC endpoints нет: `webrtc.status=unknown` у всех продуктов. Существующие правила расширения не расширялись путём включения каталога.

Для production необходимы положительные/отрицательные браузерные fixtures, проверки семантики и privacy, два reviewer правила, browser compatibility, срок пересмотра и disable/rollback. Источник с названием продукта не заменяет проверенную сигнатуру. Этот каталог не импортируется в Chrome/Firefox runtime; `vendors.seed.json` сохраняет прежний отдельный gate. См. [ADR-009](../../docs/decisions/ADR-009.md) и [ADR-019](../../docs/decisions/ADR-019.md).

Shodan — отдельный CLI с `/shodan/host/count`, сводными количествами и привязкой к уже опубликованным точным доменам. Первоначальный план полного каталога находится в `research/antifraud-2026-10/shodan`; он был подготовлен без ключа и сетевого запуска. Ключ вводится через `--key-file` внутри проекта или `SHODAN_API_KEY`, не включается в базу и сборку. Отдельный фактический запуск по дополнительным CDN выполнен 2026-10-10 и описан ниже. Подробности первого инструмента: [docs/coverage/shodan-aggregate.md](../../docs/coverage/shodan-aggregate.md).

## Дополнительные CDN и браузерные ресурсы

[`data/antifraud-cdn.v1.json`](data/antifraud-cdn.v1.json) и [CSV](data/antifraud-cdn.csv) охватывают все 32 продукта текущего runtime: 152 записи, 104 точных hostname, 78 новых ресурсных кандидатов из 25 первичных источников. Найдено 45 ранее не покрытых точных hostname (36 current, 3 legacy, 6 retired), 23 namespace/template и 2 отдельно обозначенных доменных семейства. Дополнения найдены у 17 продуктов; у остальных сохранены существующие правила без выдуманных резервных CDN.

Роли CDN/loader, challenge iframe, collector/pixel и resolver различаются. Shared CDN требуют path, условия старых правил сохранены целиком. Новые записи остаются research-only и не активируют runtime. [Описание, таблица по компаниям и источники](research/cdn-2026-10/README.md).

Shodan фактически проверил **41 точный опубликованный browser hostname: 41 успешный ответ, 9 ненулевых count**. Результат [`shodan-counts.json`](research/cdn-2026-10/shodan-counts.json) присоединён к JSON/CSV как справочный индексный count. Этот count не подтверждает владельца, путь SDK или использование антифрода конкретным сайтом. CLI `scripts/shodan-cdn-counts.mjs` использует общий ограниченный транспорт, принимает ключ через stdin/environment и сохраняет только агрегаты. Проверка: `node scripts/antifraud-cdn-catalog.mjs --check`.

## Cookie: публичный справочник

Production Cookie использует отдельный offline каталог: 6 687 записей / 6 673 compiled / 443 primary. Источники: Apache-2.0 Open Cookie Database, MIT metadata cookie-audit/CookieBlock, публичные IAB GVL 180 vendor declarations и документация производителей. Владелец IAB — явно автор декларации; приоритет у первичных источников. Unscoped имена дают нейтральные name references без tracking/branding. Общие auth/session/id имена исключены; динамические суффиксы маскируются. Компилятор не читает значения cookie.

`node scripts/cookie-catalog.mjs --check` проверяет pinned hashes и byte-identical generated artifacts. `scripts/cookie-public-datasets.mjs` по умолчанию проверяет локальные данные; сетевой режим запускается отдельно. `scripts/shodan-cookie-counts.mjs` выполняет только агрегатные count-запросы по опубликованным именам: фактический cookie research run — 39/39 успешных, 30 ненулевых totals. Эти данные не являются vendor/purpose сигнатурами и не включают cookie values/IP/баннеры. Результаты выпуска и review, [ADR-024](../../docs/decisions/ADR-024.md).
