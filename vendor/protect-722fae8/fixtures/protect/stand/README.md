# Сквозной стенд модуля «Защита» (ADR-020, шаг S15)

Страницы для `tests/extension/protect/stand-*.spec.ts`. Остальные спеки стенда используют страницы дорожек: `../forms/pixel-hash-on-blur.html`, `../forms/first-party-autosave.html`, `../forms/password-negative.html`. Имена `*.example.{com,net,org}` (и `*.example.edu` в `stand-multi`) ведут на 127.0.0.1 через `--host-resolver-rules`, без DNS. Страницы сами читают свои поля и сами отправляют значения; расширение ничего не пишет в поля и ничего не отправляет.

| Файл | Что делает | Ожидание |
| --- | --- | --- |
| `multi-pixel.html` (`?rp=`) | на `blur` — `sha256(trim+lower e-mail)` картинками трём получателям: `px.tracker.example.net`, `px.ads.example.org`, `px.metrics.example.edu` | одна подсказка (вкладка, сайт) с тремя получателями → одна карточка фаервола, значок `3` |
| `recorder-attributed.html` (`?count`, `?every`, `?bytes`) | синтетический рекордер `../replay/replay-sim.js` с `cdn.rec.example.net`: обработчики уровня страницы, наблюдатель документа, POST 2 KiB на `rec.example.net` каждые 1,5 с × 6 | тестовый профиль (кандидат S10: хуки `listen` и `observe`): R4 → `replay-recording` / `medium`, атрибуция `sampled-stack`. В release-решении E21-10 (`listen off`) этот уровень недостижим |

Privacy-scan (второй прогон) использует `../../privacy/protect-canary-page.html`.
