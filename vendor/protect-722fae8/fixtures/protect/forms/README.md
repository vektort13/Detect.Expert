# Стенд сопоставления ввода (ADR-020 §B, шаг S07)

Синтетические страницы для `tests/extension/protect/value-match-*.spec.ts`. Страницы играют роль сайта и его третьих сторон: они сами читают свои поля и отправляют значения так, как это делают пиксели, «сборщики ввода» и бэкенды форм. Расширение ничего из этого не читает: оно сравнивает свои ключевые отпечатки с запросами, о которых сообщает Chrome.

- Страница открывается на `http://www.example.com:<порт стенда>/protect/forms/<файл>`.
- Получатели — на других регистрируемых доменах: `example.net`, `example.org`. Имена ведут на loopback через `--host-resolver-rules` (`PROTECT_RESOLVER` в `tests/extension/protect/support.ts`).
- Порт получателя задаёт `?rp=` (по умолчанию 4174).
- Хэши страница считает своей библиотекой `lib.js` (собственный SHA-256): на http-страницах `crypto.subtle` нет (SP-13).
- Маршрут `tests/fixture-routes/forms.mjs` отвечает 204 на `/tr` и `/fsink/*`. Тело он не читает и считает запросы по методу, хосту и пути, без query.

| Файл | Что делает страница | Ожидание |
| --- | --- | --- |
| `pixel-hash-on-blur.html` | на `blur` — `GET px.tracker.example.net/tr?ev=Lead&ud[em]=<sha256(trim+lower)>` (картинка) | `third-party-before-submit`, получатель `example.net`, `['sha256-hex']`, параметр `ud[em]`, путь `/tr`, `high`, доставка `sent` |
| `keylogger-beacon.html` | на каждый `input` и `blur` — `sendBeacon` с телом text/plain JSON `{"v": …}` | `body-json` `v`, вид запроса `beacon`; часто через кольцо (`before-value`) |
| `esp-on-submit.html` | обычная форма POST (urlencoded `email`, `list`) на `esp.example.org/fsink/subscribe`; ответ 204, страница остаётся | `third-party-at-submit`, `body-form` `email` |
| `first-party-autosave.html` | автосохранение на свой origin: POST JSON `{"draft": {"email": …}}` | `first-party-before-submit`, поле JSON `draft.email`, сторонних записей нет |
| `thank-you-start.html` → `thank-you.html` | POST формы на свой сайт; следующая страница шлёт пиксель с `sha256` значения прошлой страницы (sessionStorage своего origin вместо серверного рендера) | `third-party-at-submit`, `value-from-previous-document` |
| `iframe-parent.html` + `iframe-form.html` | форма в стороннем кадре (`forms.example.org`, `?frameHost=`) на `blur` шлёт urlencoded `email` на свой origin | `cross-site-frame`, `receiver-hosts-form-frame` |
| `opaque-batcher.html` | на `change` — JSON, сжатый gzip (`CompressionStream`), text/plain, no-cors; `?plain=1` — тот же JSON без сжатия | `opaque-after-input` (`low`); с `?plain=1` — `value-match` `high` |
| `password-negative.html` | сам сайт шлёт пароль открытым текстом (JSON с ключом `password`) и `sha256` пароля (`?ph=`) третьей стороне | ни одной записи; число полей в памяти SW не растёт |
| `short-name.html` | имя «Анна»: пиксель с открытым `fn=` и `fn_h=<sha256(lower)>` | открытая форма короче `plaintextMinChars` не сравнивается; совпадает только хэш (`medium`) |
| `large-upload.html` | после ввода e-mail — POST text/plain 32 MiB (`?mib=` 1…64) | `body-truncated`; запись heap SW — только perf-запись (candidate) |

Страницы не используют сетевые API расширения и не обращаются к нему. Все запросы стенда делает сама страница.
