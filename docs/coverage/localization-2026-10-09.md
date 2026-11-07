# Покрытие локализаций 1.1.0

ADR-017, решение владельца продукта от 2026-10-09. Общая production-база `apps/production-extension`: **21 каталог × 762 ключа**, одинаковые substitutions/metadata, все четыре UI используют полные embedded dictionaries.

| Область | Фактическое покрытие |
| --- | --- |
| Store manifest | 19 поддерживаемых Chrome locale-кодов; Yue/Wu не объявляются store-каталогами. |
| Mandarin | Проверенный существующий `zh_CN`, UI `zh-Hans`, алиас `cmn`. |
| Новые языки | de/pl/id/mr/te/ko/ta + UI-only yue/wuu; локальные переводы, без английского fallback вместо новых человекочитаемых абзацев. |
| Yue / Wu | Упрощённые письменные адаптации; Wu — шанхайский вариант. Технические китайские термины разделяются с Mandarin. |
| UI переключение | Native Chromium 153.0.8010.12: 21 выбора через picker × options/popup/sidepanel/report; storage restore, lang/dir, SVG de/pl/id/ko. |
| Автоматические проверки | 10 passed: каталоги, placeholders/metadata, scripts, runtime tables, browser-code mapping, badge, генерация/idempotence, обновлённые существующие Pro disclosures. |
| Передача данных UI | В native проходе не наблюдалось HTTP-запросов; это область конкретного теста. |
| Review | Независимый `login_fix`: 10/10 tests, build/updater boundaries и JSON escaping, native evidence — без blockers. Полнота/скрипты проверены автоматически, выборочные UI-фразы просмотрены; сертификации носителями нет. |
| Не проверено этим отчётом | Все узкие popup layouts, screen readers и PDF шрифты на каждом языке; native Firefox указано отдельно в release/Firefox отчётах. |

Подробности, реальные команды, evidence и измерения: отчёт локализаций.
