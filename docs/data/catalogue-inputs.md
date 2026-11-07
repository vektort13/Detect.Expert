# Входы статического каталога

Сборка не обращается к источникам данных. Она читает проверенные
локальные JSON inputs и проверяет воспроизводимость `autosurf-sites-data.js`.

`autosurf-sites.tracking-inputs.json`: версия, дата, нейтральные метаданные набора,
справочник систем и exact-host associations. Публичные URL необязательны.
Отсутствие ссылки не превращает связь в наблюдение текущего посещения.

`autosurf-sites.tracking-country-inputs.json`: точные CrUX origin/country buckets,
закреплённые месяц/commit и SHA исходников. CrUX attribution сохраняется.
Страны не переносятся между HTTP/HTTPS, www, apex или поддоменами.

Во входах нет ключей, контактов, тел ответов и локальных путей.

Команды проверки: `node scripts/build-autosurf-sites.mjs --check`,
`pnpm test:unit`, `pnpm lint`, production build для обоих браузеров.
