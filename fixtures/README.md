# fixtures

Синтетические страницы для extension-тестов (ТЗ VI, I2: отдельный тестовый профиль, не production bundle).

- Раздаются сервером `tests/fixture-server.mjs` (его же использует harness `tests/extension/harness.ts`) на двух loopback-origin: `http://127.0.0.1:4173` и `http://127.0.0.1:4174` (разные origin для сценариев third-party/iframe/tainted canvas). Эндпоинт `/slow` отвечает через 5 с (сценарий отменённой навигации). Никаких `/_dump`-эндпоинтов: расширение не имеет сети, отчёты читаются только через SW.
- Только статические файлы; никаких внешних ресурсов и никаких реальных vendor-скриптов без разрешения и provenance (ТЗ IV). Общий helper — `fixture-lib.js`.
- Каждая страница публикует машиночитаемый результат в `<pre id="result">` и `window.__fixtureResult`; тесты и дифференциальные прогоны (с расширением / без) сравнивают один и тот же объект. В результате нет пикселей и data URL — только факты (типы, имена ошибок, счётчики, хэши для сравнения прогонов).

| Страница | Сценарий (ТЗ II A11, IMPLEMENTATION_START «Первое задание») | Тест |
| --- | --- | --- |
| `canvas-fp-positive.html` | Текст в нескольких шрифтах + emoji, затем getImageData + toDataURL дважды | `tests/extension/canvas-positive.spec.ts` |
| `canvas-editor-negative.html` | 300 fillText «мазков», один toBlob по кнопке (`window.exportImage()`) | `canvas-editor-negative.spec.ts` |
| `canvas-chart-negative.html` | measureText/fillText без чтения | `canvas-chart-negative.spec.ts` |
| `canvas-tainted.html` | Изображение со второго origin → getImageData/toDataURL/toBlob → SecurityError | `canvas-tainted.spec.ts` |
| `canvas-original-throws.html` | Неверные аргументы/receiver → имя и текст исключения; типы результатов | `differential.spec.ts` |
| `hook-replaced.html` | Страница заново оборачивает toDataURL после загрузки; `Function.prototype.toString` не тронут | `hook-replaced.spec.ts` |
| `hostile-bridge.html` | 10⁵ поддельных сообщений (spoofed batch, 100 KB строки, вложенность, `__proto__`, forged id, fake `ui-export-preview`/`ui-clear`) | `hostile-bridge.spec.ts` |
| `spa-navigation.html` | pushState/replaceState/hash + readback; один documentKey | `spa-navigation.spec.ts` |
| `bfcache-a.html`, `bfcache-b.html` | A → B → back; `pageshow.persisted` | `bfcache.spec.ts` |
| `iframe-parent.html`, `iframe-child.html` | Parent (origin 1) встраивает child (origin 2), readback только в child | `iframe.spec.ts` |
| `late-start.html` | Readback в `<head>` при парсинге; поздняя инъекция его не видит | `late-start.spec.ts` |
| `abort-nav.html` | Ссылка на `/slow`; навигация отменяется | `abort-nav.spec.ts` |
| `reinstall.html` | Повторная инъекция `hook.main.js`; счётчики не дублируются | `reinstall.spec.ts` |
| `perf-canvas-hot.html` | 10⁵ measureText + 10⁴ getImageData | `scripts/perf.mjs` (`pnpm test:perf`) |
| `privacy/canary-page.html` + `privacy/canaries.json` | Реестр канареек (текст canvas, cookie, query, fragment, path id, локальный IP, аргумент Math, имя кадра стека, форма, localStorage, title) | `scripts/privacy-scan.mjs` (`pnpm test:privacy`) |
| `assets/dot.png` | Изображение для tainted canvas (копия иконки проекта), отдаётся без CORS-заголовков | — |

Положительные/отрицательные fixtures для детекторов добавляются вместе с DET ID и записью в `docs/coverage`.
