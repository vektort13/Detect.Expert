# Detect.Expert — исходники расширения

Общая база Chrome и Firefox: читаемый JavaScript без шага транспиляции; `manifest.json` и локали лежат рядом.

- `pnpm build:chrome` → `dist/chrome`, `pnpm build:firefox` → `dist/firefox`.
- `pnpm release:verify` → два проверенных ZIP в `release`.
- `pnpm test:production`, `pnpm test:firefox`, `pnpm test:inspection` — проверки и нативные сценарии.
- `pnpm typecheck`, `pnpm lint`, `pnpm test:unit` — общие проверки.

`browser-adapter.js` включается только в Firefox. `_locales` — языки магазинов и браузера, `ui-locales` — дополнительные языки собственного интерфейса; `scripts/production-locales.mjs` обновляет встроенные каталоги всех страниц. `scripts/production/sync-pro-runtime.mjs` синхронизирует общий Pro-валидатор. Архитектура и допущения: ADR-017, ADR-018.

Эта папка содержит код расширения, а не профиль пользователя. README и PROVENANCE.json в браузерные пакеты не входят.
