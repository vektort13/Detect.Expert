# Снимок IANA tz database 2026f

- Источник: IANA, каталог `tzdb-2026f` (https://data.iana.org/time-zones/tzdb-2026f/). Лицензия: общественное достояние (так сказано в заголовке каждого файла); текст лицензии не требуется.
- Файлы: `zone.tab`, `zone1970.tab`, `iso3166.tab`, `version`. Побайтно совпадают с одноимёнными файлами официального архива `tzdata2026f.tar.gz` (sha256 архива `01b4a91cec5167ed48c11e8ab78f2048cead78ce94b0cafcad0ae8c5a3044d3d`; сверено 2026-11-05).
- sha256 файлов:
  - `zone.tab` `e2e8e31c4e10f44576c79345e76060591dbb3eef6ce14e006afc8a373caa9593`
  - `zone1970.tab` `5f23781702bf51408ff1581daa109ab3b9257fb433b1554e579d92172892c0cf`
  - `iso3166.tab` `837c80785080c8433fd9d4ea87e78f161ac7a40389301c5153d4f90198baeb2a`
  - `version` `9f9a9e6bfd18cd6a0a4d65764931072577edcbb731981a068ef52bba6615b1de`
- Использование: только при сборке. `scripts/production/gen-region-data.mjs` читает эти файлы и пишет `apps/production-extension/fingerprint-region-data.js`. В пакет расширения файлы не входят, сеть из расширения не используется.
- Уведомление и лицензия Unicode (CLDR/ICU, откуда берутся языки, названия стран и написание идентификаторов): `apps/production-extension/REGION-DATA-NOTICE.txt`.

## Как обновить снимок

1. Скачать четыре файла в пустую папку вне репозитория (пример для релиза 2026g):
   `for f in zone.tab zone1970.tab iso3166.tab version; do curl -fO https://data.iana.org/time-zones/tzdb-2026g/$f; done`
2. Сверить с официальным архивом: скачать `https://data.iana.org/time-zones/releases/tzdata2026g.tar.gz`, распаковать те же четыре файла и сравнить `cmp`.
3. Перезаписать файлы в этой папке и обновить номер релиза и sha256 в этом файле.
4. `node scripts/production/gen-region-data.mjs` — перегенерировать модуль. `REGION_DATA_VERSION` растёт сам, если изменилось содержимое. Прочитать отчёт (отклонённые и переименованные идентификаторы, переопределения языков, зоны по умолчанию) и diff.
5. Обновить версии и sha256 в `apps/production-extension/REGION-DATA-NOTICE.txt` и в записи `NOTICE`; тест `fingerprint-region-data.test.mjs` проверяет, что уведомление совпадает с заголовком модуля.
6. `node --test scripts/test/fingerprint-region-data.test.mjs` и `node scripts/production/gen-region-data.mjs --check`.

Языки, названия стран и каноническое написание идентификаторов зон берутся из ICU/CLDR того Node, которым запущен генератор. Если версии ICU/CLDR/Unicode/tz отличаются от записанных в заголовке модуля, `--check` отвечает кодом 3: перегенерируйте модуль под новой версией и просмотрите diff.
