# Модуль «Защита» в production-расширении (адаптер, ADR-047)

Каталог содержит production-адаптер необязательного модуля «Защита» ([ADR-047](../../docs/decisions/ADR-047.md), исходная спецификация [ADR-020-protect](../../docs/decisions/ADR-020-protect.md), коммит `722fae8`) для `apps/production-extension`. Модуль выключен по умолчанию. Включить его может только пользователь в Options после экрана согласия.

## Откуда код

- `vendor/protect-722fae8/**` — вендорная копия исходников модуля (коммит `722fae8`); в публичной редакции правились только комментарии и тексты документации, `VENDOR.json` пересчитан. sha256 и git blob id каждого файла записаны в `VENDOR.json`. Менять vendor следует только повторным вендорингом (`node scripts/production/vendor-protect.mjs`, для него нужен коммит `722fae8`).
- `src/**` — production-адаптер:
  - `sw-entry.ts` — `protect-sw.js`: верхнеуровневые слушатели модуля, маршрут только для типов модуля, `protectHost`;
  - `surface.ts` — фаервол как отдельный попап (S4b, требование владельца): пока на вкладке есть получатели, ждущие решения, у вкладки свой попап `firewall.html?tab=<id>` (`chrome.action.setPopup`), и он открывается сам (`chrome.action.openPopup`) — один раз на пару (сайт, получатель), только в активной вкладке окна в фокусе, не чаще раза в 10 с на окно; после решения возвращается `popup.html`;
  - `host-api.ts` — контракт между `background.js` и модулем;
  - `report-adapter.ts`, `badge-label.ts` — проверка формы production-отчёта и значок модуля;
  - `hook-config.ts` — конфигурация MAIN-хуков production-сборки (решение владельца продукта 2026-10-18: `send: wrap`);
  - `patches/**` — ограниченные исправления privacy и бюджетов по ADR-050, подключённые только через явные `REDIRECTS` сборщика; vendor остаётся вендорной копией (код не менялся);
  - `protect-managed-schema.json` — boolean-политика `ProtectModuleDisabled` для Chrome; false/отсутствие не включают модуль;
  - `ui-entry.ts`, `ui/**` — `protect-ui.js`: «острова» в popup, боковой панели и Options, своя копия Preact 10.29.8 (компонент страницы с её хуками внутри этой копии работать не может; поэтому остров `launcher` принимает необязательный `toolSlot` — изготовитель кнопки, который модуль вызывает с `h` и хуками своего Preact, и ставит её между заголовком и переключателем: так оболочка Options размещает кнопку «Экскурсия», [ADR-111](../../docs/decisions/ADR-111-guided-tours-and-header-actions.md));
  - `ui/i18n-shim.ts` — замена vendored `i18n.ts`: каталог модуля ru/en вместо `chrome.i18n`;
  - `requests-entry.ts`, `requests.html` — страница запросов о данных;
  - `firewall-entry.ts`, `firewall.html`, `ui/firewall-page.tsx` — попап фаервола (vendored карточка `FirewallCard` без изменений, полоса «Detect.Expert · Фаервол», «Все находки»); `ui/popup-area.tsx` — область модуля в основном popup: вместо карточки одна строка фаервола со ссылкой на попап;
  - `styles/*.css` — production-слой стилей модуля: `production.css` (контейнеры островов, лаунчер, страница), `firewall-popup.css` (попап фаервола, около 400 px) и `surfaces.css` (вид production: карточки, сгруппированные настройки, сегменты; светлая и тёмная темы; только токены `ui.css` и `button-surfaces.css`);
  - `locales/{ru,en}.json` — production-ключи модуля; `locales/overrides.json` — production-тексты вместо vendored для решения владельца продукта Q1 (DNR — обязательное разрешение, без требования перезапуска; ключи согласия не меняются); `locales/catalog.generated.json` — каталог, который генерирует сборка.
- `BUILD.json` — provenance сборки: коммит, хэш `VENDOR.json`, версия esbuild, параметры, sha256 каждого выхода.

## Команды

```powershell
node scripts/production/vendor-protect.mjs --check   # vendor совпадает с VENDOR.json (и с git 722fae8, если коммит доступен)
node scripts/production/build-protect.mjs            # пересобрать файлы модуля в apps/production-extension
node scripts/production/build-protect.mjs --check    # сборка в памяти совпадает с файлами на диске
node scripts/production/build-protect.mjs --overlay .tmp/protect-overlay   # тестовый tripwire-оверлей вне apps/
pnpm typecheck:protect
node scripts/production/sync-protect-ui.mjs --check  # острова в popup / боковой панели / Options, маршрут #protect, protect.css (S3)
node scripts/test/protect-ui-native.mjs             # нативный рендер островов из dist/chrome, светлая и тёмная темы (S3)
node scripts/test/protect-firewall-popup-native.mjs # нативно: утечка на стенде -> setPopup/openPopup -> попап фаервола, блокировка (S4b)
```

Список выходов — `scripts/production/protect-files.mjs`. Файлы модуля в `apps/production-extension` руками не правятся.

## Состояние порта

Модуль подключён к Chrome production SW, Options, popup и sidepanel. Firefox получает инертные stubs. Исправления аудита F1…F8 описаны в [ADR-050](../../docs/decisions/ADR-050.md); фактическая приёмка — во внутреннем отчёте. По [ADR-052](../../docs/decisions/ADR-052.md) передача данных и запись сессии удалены из основного popup: только положительные находки вызывают отдельное окно справа внизу экрана, с дедупликацией и проверкой актуальности документа. [Покрытие и ограничения](../../docs/coverage/protect-notifications.md).
