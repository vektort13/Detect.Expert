# Сборка и проверка Firefox

Трассировка: ADR-018, REQ-004/006/009/010. Общая production-база — `apps/production-extension`.

Команды из корня проекта:

```powershell
pnpm build:chrome
pnpm build:firefox
pnpm test:firefox
pnpm release:verify
```

Результаты: `dist/chrome`, `dist/firefox`; архивы `release/Detect.Expert-2.0.0-chrome.zip` и `release/Detect.Expert-2.0.0-firefox.zip`. Упаковка детерминированная: сортировка файлов, фиксированная ZIP-дата и SHA256 в выводе. Это проверка и локальная упаковка, без загрузки в CWS/AMO.

В Firefox открыть `about:debugging`, «Этот Firefox», «Загрузить временное дополнение», выбрать `dist/firefox/manifest.json` или Firefox ZIP. Временная установка действует до перезапуска. Для обычного распространения требуется подпись Mozilla через AMO, включая unlisted-поставку: [temporary installation](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/), [signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

Автоматический native smoke использует установленный Firefox и официальный geckodriver 0.37.1. На Windows путь Firefox берётся из registry App Paths metadata; для другого расположения задать `FIREFOX_BINARY`. Путь драйвера можно задать `GECKODRIVER_BINARY`; иначе Windows x64 driver загружается из официального Mozilla GitHub release в `.tmp/firefox/tools`. Профиль, test XPI, журнал и evidence создаются в `.tmp/firefox/runs/<run>`. Пользовательский профиль и внешние директории не исследуются и не меняются.

Smoke проверяет временную MV3-установку, popup/Promise API, привилегированный канал moz-extension, согласие и all-sites scope, MAIN/ISOLATED регистрации, локальную форму логина, счётчики API, network-limited/partial, отдельную identity при навигации, Pro с разными значениями/количествами/техническими аргументами, DOM общего отчёта и загрузку sidepanel UI. Это проверка локального fixture; авторизованный вход Gmail/bet365, Mozilla signing, install permission prompt, sidebar native gesture и Firefox BFCache/prerender acceptance не проверялись. PDF проверяется отдельно в Chrome.

Firefox 128+ использует приватную ISOLATED identity по ADR-018. На Firefox 138 доступен document_start выбранных сайтов/всех сайтов; поздняя точная activeTab-инъекция завершится no-access. Нет подтверждённой per-document attribution webRequest; обычный отчёт показывает network-limited. Для ручной проверки включить локальный анализ, выбрать область и перезагрузить проверяемую страницу.
