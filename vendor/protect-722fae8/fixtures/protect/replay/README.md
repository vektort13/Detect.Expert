# Стенд записи сессии (ADR-020 §E, шаг S11)

Синтетические страницы для e2e признаков записи сессии модуля «Защита». Рекордер — собственный (`replay-sim.js`): ставит обработчики, наблюдает за документом и отправляет тела из символов `x`. Значения полей, клавиши и координаты никто не читает.

Открывать на `http://shop.example.com:<порт стенда>/protect/replay/<файл>`. Имена `*.example.{com,net,org}` указывают на 127.0.0.1 через `--host-resolver-rules` (без DNS). Маршрут `tests/fixture-routes/replay.mjs`: `/replay/collect` → 204 (CORS открыт, тело не читается), `/replay/loader.js` → `vendor-loader.js`.

| Файл | Что делает | Ожидание (тестовый профиль, хуки S10 включены) |
| --- | --- | --- |
| `recorder-positive.html` (`?count`, `?every`, `?bytes`, `?delay`) | `replay-sim.js` с того же сайта: `keydown`/`input` на document, `mousemove`/`scroll` на window, `MutationObserver` документа; POST 2 KiB на `rec.example.net` каждые 1,5 с × 6 | `replay-like` / low, 3 сигнала, получатель `example.net` (`runMax ≥ 3`), маскирование `unconfirmed`. Скрипты — сайт `example.com`, получатель — `example.net`: R4 не выполняется |
| `late-recorder.html` (`?delay`) | Тот же рекордер через 3 с после загрузки; 4 POST | `replay-like` после серии |
| `iframe-recorder.html` | Верхняя страница встраивает себя же с `widget.example.org` (`?frame=1`); рекордер работает во фрейме, POST 2 KiB × 4 | `replay-like` по документу фрейма (сочетание признаков считается внутри одного документа) |
| `heartbeat-negative.html` (`?method=GET`) | После фокуса на поле e-mail (+1 с) — POST 100 B на `hb.example.net` каждые 1,5 с × 6; вариант GET. Обработчиков страницы и наблюдателя нет | Нет периодического признака: при включённом `value-match` вкладка вооружена, размеры тел наблюдаются и малы; GET не считается |
| `autosave-first-party-negative.html` | Обработчики, наблюдатель и POST 4 KiB на свой сайт `api.shop.example.com` × 5 | `signals-only`, получателей нет (`first-party-endpoints-not-assessed`) |
| `element-listeners-negative.html` | Обработчики только на полях и div, наблюдатель только на div; POST 2 KiB на `rec.example.net` × 5 | `signals-only`: только периодический признак |
| `spa-shortcuts-negative.html` | `keydown` на document, `scroll` на window, наблюдатель `body`, `pushState`, GET-загрузки с `api.example.org` | `signals-only`, получателей нет |
| `websocket-only.html` | Обработчики и наблюдатель; данные — только кадры WebSocket (`/ws` стенда, кадры не читаются) | `signals-only`, `websocket-not-observed` |
| `vendor-synthetic.html` (`?sends=N`) | Загрузчик синтетического вендора `test-replay` с `127.0.0.1:4174`: наблюдатель документа; при `sends` — POST 2 KiB на `collect.replay.example.org:4174/replay/collect` | без отправок — R3 (`replay-like`); с ≥ 3 отправками — R5 (`replay-recording`). Правило есть только в тестовом профиле; в production таблица пуста (`vendor-rules-disabled`) |

Спеки: `tests/extension/protect/replay-{positive,negatives,vendor,lifecycle}.spec.ts`.
