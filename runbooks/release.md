# Runbook: релиз

Владелец: Vektor T13, контакт — репозиторий · Последняя репетиция: не проводилась · Основание: ТЗ V §10, ADR-002, ADR-016.

## Предусловия

- [ ] Подготовка зависимостей выполнена в чистом checkout проверенного commit, Node 24 LTS и pnpm 10.17.1: `pnpm install --frozen-lockfile --offline` завершился с exit 0. Несоответствие manifest/lockfile или отсутствие пакета в локальном store останавливает подготовку; обычный `pnpm install` не заменяет этот gate (F147).
- [ ] Все обязательные проверки прошли с фактическим выводом: `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:extension`, `pnpm test:privacy`, `pnpm test:perf`, `pnpm catalog:lint`, `pnpm build`, `pnpm release:verify`.
- [ ] `pnpm test:unit` включает gate локалей (`packages/ui/test/locales.test.ts`); отдельный `pnpm lint` его не заменяет (F090). Открытые контекстные случаи F089 требуют review.
- [ ] `browser-support.json` обновлён: build ID Stable/Beta/Extended Stable, ОС, дата последнего успешного прогона; `minimum_chrome_version` соответствует самой старой реально поддерживаемой версии.
- [ ] Permissions diff относительно предыдущего релиза проверен независимым reviewer; новые permissions/зависимости объяснены.
- [ ] Rollback-репетиция N→N+1→rollback выполнена (см. `runbooks/rollback.md`), дата записана.
- [ ] Каталог: ни одно правило с `productionEnabled=true` без evidence/fixtures/2 reviewer (`pnpm catalog:lint`).
- [ ] `pnpm sbom` выполнен, diff SBOM/лицензий проверен; release gate сверяет их с lockfile. Материалы — `docs/release/README.md`, `PRIVACY.md`, `docs/release/STORE_LISTING.md`.
- [ ] Store copy, privacy policy и onboarding согласованы с `PRD.md` §6 и `docs/ui-copy.md` §8 (нет запрещённых утверждений).

## Артефакт (release dossier)

| Поле | Значение |
| --- | --- |
| Версия / проверенный commit / SHA-256 пакета / SHA-256 `pnpm-lock.yaml` | |
| Node / pnpm / вывод frozen offline install и проверки чистоты дерева | |
| Версии контрактов (`schemaVersion`), правил (`catalogVersion`), PSL snapshot | |
| Chrome builds, на которых проверено | |
| Permissions (полный список) и diff | |
| SBOM, license inventory, NOTICE | |
| Результаты positive/negative/hostile/privacy/perf тестов (ссылки на отчёты) | |
| Измеренные накладные расходы (машины, p50/p95) | |
| Известные ограничения (ссылка на `docs/coverage/matrix.md`) | |
| Текст обработки данных (privacy policy версия) | |
| Changelog пользовательского поведения | |
| Исключено: remote SDK, dev servers, source maps с секретами, тестовые endpoints, `eval`, dynamic loaders — подтверждено `release:verify` | |

## Шаги

1. Подготовить чистый checkout проверенного commit; выполнить процедуру зависимостей ниже и затем все обязательные проверки. CI в репозитории отсутствует: выполнение и сохранение вывода — ответственность release owner; автоматизацию нельзя считать существующей.
2. Собрать dossier (таблица выше); reviewer подписывает permission diff и влияние на сбор данных.
3. Установить release candidate из production artifact в чистый профиль; вручную проверить: onboarding, три уровня доступа, popup/side panel, все состояния coverage, экспорт-preview, отзыв разрешения, обновление N→N+1.
4. Раскатка (ADR-016): локальные стенды → тестовая публикация (если доступен test item) → пилотная организационная группа → production. Процентная раскатка недоступна новому расширению (<10 000 7-day users) — не обещать.
5. Публикация: publisher-аккаунт с аппаратными ключами; разделение полномочий код/подпись/публикация; reviewer notes для CWS: обоснование permissions, перечень исходящих соединений (Local: 0), отсутствие remote code, демонстрация удаления данных, скриншоты с реальным покрытием.
6. После публикации: зафиксировать в dossier дату, item ID, версию; открыть окно наблюдения по `runbooks/support.md` (синтетические проверки, CWS-обращения).

## Условия остановки

Любой из блокеров: грязный/непроверенный checkout; ошибка frozen offline install; изменение manifest/lockfile после подготовки; отсутствующий hash lockfile; утечка канарейки в privacy-тесте; критическая регрессия совместимости в differential suite; неисполненный rollback-drill; неподтверждённая сигнатура с `productionEnabled=true`; запрещённое утверждение в локали/Store copy; permissions diff без объяснения.

## Подготовка зависимостей и фиксация хешей (F147)

В корне отдельного чистого checkout проверенного commit выполнить PowerShell-последовательность. Использовать Node 24 LTS и pnpm 10.17.1, сохранить версии и вывод в dossier. Ошибка останавливает процедуру; недостающий offline store подготавливается отдельным контролируемым шагом, затем процедура запускается заново.

```powershell
node --version
if ($LASTEXITCODE -ne 0) { throw 'Node version check failed' }
pnpm --version
if ($LASTEXITCODE -ne 0) { throw 'pnpm version check failed' }
$releaseTreeStatus = git status --porcelain
if ($LASTEXITCODE -ne 0 -or $releaseTreeStatus) { throw 'Release requires a clean reviewed checkout' }
git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify release commit' }
pnpm install --frozen-lockfile --offline
if ($LASTEXITCODE -ne 0) { throw 'Frozen offline install failed' }
git diff --exit-code HEAD -- pnpm-lock.yaml package.json ':(glob)**/package.json' pnpm-workspace.yaml .npmrc
if ($LASTEXITCODE -ne 0) { throw 'Dependency inputs changed' }
```

После всех проверок из предусловий выполнить `pnpm release:verify` с exit 0 и повторить `git diff --exit-code HEAD -- pnpm-lock.yaml package.json ':(glob)**/package.json' pnpm-workspace.yaml .npmrc`. Рядом с SHA-256 конкретного zip записать SHA-256 lockfile:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath pnpm-lock.yaml
```

`scripts/release-verify.mjs` выполняет frozen offline install с `--ignore-scripts`, проверяет неизменность и выводит SHA-256 lockfile, сверяет SBOM/NOTICE/лицензии и собирает ZIP. Проверка чистого reviewed checkout остаётся ручным предусловием. Preflight не заменяет owner review и rollback-репетицию.
