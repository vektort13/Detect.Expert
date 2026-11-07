# Стенд истории «Кто вас узнаёт» (ADR-020 §G, шаг S12)

Синтетические страницы для e2e истории модуля «Защита». Страницы ничего не вводят и не читают поля.

| Файл | Что делает |
| --- | --- |
| `site.html?receiver=<host>` | «Сайт». Подключает `tracker.js` и встраивает `widget.html` с хоста получателя (та же схема и порт). Хост — только имя, без схемы, порта и пути |
| `tracker.js` | «Получатель». Один запрос картинки и один XHR на `/history/collect` своего хоста. Данных страницы не отправляет |
| `widget.html` | Фрейм получателя: `fillText` и `toDataURL` на canvas. Наружу уходит только факт экспорта, без пикселей и dataURL |

Маршрут `/history/collect` отвечает 204 — плагин `tests/fixture-routes/history.mjs`. Тело не читается, в счётчики попадают только метод и хост.

Сценарий e2e (`tests/extension/protect/history-*.spec.ts`), разрешение имён через `--host-resolver-rules` (`*.example.{com,net,org}` → 127.0.0.1, без DNS):

- `http://www.example.com:<port>/protect/history/site.html?receiver=tracker.example.org`;
- `http://www.example.net:<port>/protect/history/site.html?receiver=tracker.example.org`.

Получатель `example.org` встречается на двух сайтах (`example.com`, `example.net`): запросы — механизм `requests-only`; canvas во фрейме получателя — `frame-techniques` (frame-only, page-controlled). Значения полей стенд не вводит; механизм `value-match` в e2e подаётся синтетическим событием через `__protectHarness.inject('history', …)` (тестовый профиль). Настоящее сопоставление ввода проверяет стенд форм S07.
