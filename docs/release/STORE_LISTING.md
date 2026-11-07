# Материалы Chrome Web Store / Chrome Web Store listing

P10 · ТЗ I §5.2, REQ-001/005/006/007/010/013 · ADR-002/016.
Редакция: 2026-09-13. Проект текста для review владельцем перед публикацией; публикация не выполнена.

## Русский

**Название:** detect.expert

**Краткое описание:** Наблюдение за браузерными проверками на странице: вызовы API, признаки и ограничения покрытия.

**Полное описание:** detect.expert — локальный информационный анализатор браузерных проверок. После включения наблюдения он показывает обращения к поддерживаемым API, счётчики и осторожные интерпретации с указанием уверенности и покрытия. Текущая реализация наблюдает Canvas/OffscreenCanvas в Window realm и редактирует сведения о сетевых направлениях; список сетевых направлений пока не отображается и не экспортируется. Production-распознавание вендоров выключено.

Вы выбираете область: текущая вкладка, выбранный сайт или все разрешённые HTTP/HTTPS-сайты. По умолчанию наблюдение выключено. Можно приостановить наблюдение документа, очистить отчёт или скачать JSON после preview; включение домена в экспорт — отдельный флажок.

Это не оценка безопасности сайта. Отсутствие находок означает отсутствие наблюдений в доступной области за период. Workers, WASM, CSS и серверные проверки имеют пробелы покрытия. Страница может заметить обёртки, возможны эффекты совместимости. После отзыва доступа для полного удаления обёрток нужна перезагрузка страницы. Расширение не блокирует запросы и не меняет результаты API. Аккаунт и сервер не требуются.

### Обоснование разрешений

| Permission | Назначение |
| --- | --- |
| `activeTab` | Временный доступ к текущей вкладке после явного действия пользователя; режим текущей вкладки без постоянного доступа ко всем сайтам |
| `scripting` | Установка MAIN-сенсора и ISOLATED-моста в разрешённых документах; регистрация/снятие ранних content scripts |
| `storage` | Сессионные отчёты, состояние доставки и постоянные настройки выбранной области; без синхронизации отчётов |
| `webRequest` | Пассивное наблюдение метаданных запросов в разрешённой области, без блокировки, чтения тел или значений заголовков |
| `webNavigation` | Привязка к документам и кадрам, навигация, история SPA и жизненный цикл отчёта |
| `sidePanel` | Отображение отчёта рядом с текущей страницей |
| Optional hosts: `http://*/*`, `https://*/*` | Запрашиваются при выборе сайта или всех сайтов; дают наблюдение только в выданной области. Наличие patterns в manifest не означает выданный доступ. Доступ к файлам и incognito не поддерживается |

### Limited Use / Disclosure

Использование данных ограничено заявленной функцией локального наблюдения и показом отчёта. Продажа, реклама, профилирование для рекламы, передача разработчику или третьим лицам отсутствуют. Отправка организации не реализована. Экспорт файла выполняется только по действию пользователя; дальнейшая передача файла — его самостоятельное действие. Политика: [PRIVACY.md](../../PRIVACY.md). Эти заявления описывают поведение текущей Local-сборки; решение CWS о соответствии не получено.

**Перечень исходящих соединений расширения: нет.** Запросы тестовой/посещаемой страницы и служебный трафик Chrome не относятся к исходящим соединениям расширения.

### Инструкции reviewer

1. Использовать release-пакет `release/detect.expert-0.1.0.zip` или распакованный `dist/local` после `pnpm sbom` и `pnpm release:verify`. В `chrome://extensions` включить Developer mode и загрузить распакованную сборку. Для проверки не нужны аккаунт, секрет или сервер разработчика. API-floor 119 — не утверждение о проверке всех версий; фактические сборки указаны в `browser-support.json`.
2. Сервировать каталог `fixtures` локально по HTTP (например, при установленном Python: `python -m http.server 4173 --bind 127.0.0.1 --directory fixtures`). Открыть `http://127.0.0.1:4173/index.html` — это `fixtures/index.html`, синтетическая страница без скриптов; находки на ней не ожидаются. Не открывать её через `file://`.
3. Нажать значок расширения на тестовой вкладке и включить режим текущей вкладки. Для ранней инъекции выбрать режим сайта и подтвердить optional host request, затем перезагрузить страницу. Режим всех сайтов требует отдельного разрешения. Для проверки его отзыва использовать настройки доступа к сайтам Chrome/Options и перезагрузить тестовую страницу.
4. Открыть `http://127.0.0.1:4173/canvas-fp-positive.html` и `http://127.0.0.1:4173/canvas-editor-negative.html`, включить нужную область, перезагрузить. На странице редактора нажать кнопку экспорта PNG один раз. Сравнить Canvas-карточки, confidence и coverage; одиночный экспорт редактора не должен давать гипотезу fingerprinting. Поздний запуск отмечается как `late-start`. Для полного автоматического стенда двух origins: `pnpm test:extension` (headless Chromium, отдельные test-профили с fixture grants; это не store-пакет).
5. Проверить popup/side panel, паузу и очистку текущего документа; preview и скачивание одного и того же JSON (host выключен по умолчанию). В Options доступен отдельный диагностический preview без host/ID. Отзыв доступа прекращает новые данные; полное удаление hooks проверить после reload.

### Что удаляется при удалении расширения

Chrome удаляет session-отчёты, внутреннее состояние, настройки `scope` в local и разрешения расширения. Ранее скачанные JSON-файлы остаются у пользователя; удалить их можно отдельно. Для удаления обёрток из уже открытых страниц перезагрузить страницы. Данных на сервере разработчика нет.

## English

**Name:** detect.expert

**Short description:** Observe browser checks on a page: API calls, signals and coverage limitations.

**Full description:** detect.expert is a local informational browser-check analyzer. Once enabled, it shows supported API operations, counts and cautious interpretations alongside confidence and coverage. The current implementation observes Canvas/OffscreenCanvas in the Window realm and redacts network destination metadata; the destination list is not yet displayed or exported. Production vendor recognition is disabled.

Choose the current tab, a selected site or all granted HTTP/HTTPS sites. Observation is off by default. Pause a document, clear its report, or download JSON after a preview; including the domain requires a separate checkbox.

This is not a site safety assessment. No findings means nothing was observed in the available scope during the observation period. Workers, WASM, CSS and server-side checks have coverage gaps. Pages may detect wrappers and compatibility may be affected. Reload the page after revoking access to remove wrappers completely. The extension does not block requests or change API results. No account or server is required.

### Permission justification

| Permission | Purpose |
| --- | --- |
| `activeTab` | Temporary current-tab access after an explicit user action, without persistent access to every site |
| `scripting` | Install the MAIN sensor and ISOLATED bridge in permitted documents; register/remove early content scripts |
| `storage` | Session reports, delivery state and persistent access-scope preferences; no report synchronization |
| `webRequest` | Passively observe permitted request metadata, without blocking or reading bodies/header values |
| `webNavigation` | Bind reports to documents/frames and follow navigation, SPA history and document lifecycle |
| `sidePanel` | Display the report alongside the page |
| Optional hosts: `http://*/*`, `https://*/*` | Requested for selected-site/all-sites modes; observation remains within granted access. Declared patterns do not mean access is granted. File URLs and incognito are unsupported |

### Limited Use / Disclosure

Data use is limited to the stated local observation and reporting function. There is no sale, advertising use, advertising profiling or transfer to the developer or third parties. Organization upload is not implemented. File export requires user action; subsequent sharing is the user's separate action. See [PRIVACY.md](../../PRIVACY.md). These statements describe the current Local build; no CWS compliance decision has been received.

**Outgoing extension connections: none.** Test/visited-page requests and Chrome service traffic are outside this statement.

### Reviewer instructions

1. Use `release/detect.expert-0.1.0.zip` or unpacked `dist/local` after `pnpm sbom` and `pnpm release:verify`. Enable Developer mode at `chrome://extensions` and load unpacked. No account, secret or developer server is needed. API-floor 119 does not imply every version was tested; see actual evidence in `browser-support.json`.
2. Serve `fixtures` over local HTTP, for example with an existing Python installation: `python -m http.server 4173 --bind 127.0.0.1 --directory fixtures`. Open `http://127.0.0.1:4173/index.html` (`fixtures/index.html`), a synthetic script-free page where no findings are expected. Do not use `file://`.
3. Click the extension toolbar icon on that tab and enable current-tab mode. For early injection, choose site mode, approve the optional host request and reload. All-sites mode requires separate permission. Revoke site access through Chrome site-access settings/Options, then reload the fixture.
4. Visit `http://127.0.0.1:4173/canvas-fp-positive.html` and `http://127.0.0.1:4173/canvas-editor-negative.html`, enable the appropriate scope and reload. On the editor page, click the PNG export button once. Compare Canvas cards, confidence and coverage; a single editor export should not produce a fingerprinting hypothesis. Late injection shows `late-start`. `pnpm test:extension` runs the complete two-origin automated harness using headless Chromium and separate test profiles with fixture grants, distinct from the store package.
5. Check popup/side panel, document pause/clear, preview and download of identical JSON with host off by default. Options has a separate diagnostic preview without hosts/IDs. Revocation stops new data; verify complete wrapper removal after reload.

### What uninstalling deletes

Chrome removes session reports, internal state, local `scope` preferences and extension permissions. Previously downloaded JSON files remain under user control and can be deleted separately. Reload open pages to remove their wrappers. No developer-side server data exists.
