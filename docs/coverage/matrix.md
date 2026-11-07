# Матрица покрытия — срез 1 (canvas / offscreen)

Техники: DET-001 (экспорт canvas: `HTMLCanvasElement.toDataURL`, `toBlob`), DET-002 (чтение пикселей: `CanvasRenderingContext2D.getImageData`), DET-003 (`measureText` → `text-measured`, `fillText`/`strokeText` → `text-drawn`), DET-004 (`OffscreenCanvas.convertToBlob`, offscreen 2D `getImageData` — только realm Window; `getContext` не учитывается отдельно).
Основание: ТЗ II A3, A8, A11; III §2.1; `docs/PROJECT_RULES.md` REQ-006, REQ-014. Статус «не проверено» остаётся до появления результатов `pnpm test:extension` с указанием Chrome build; изменение статуса — только со ссылкой на прогон (E02-01, E07-01).

Обозначения: **J** — наблюдение через обёртку API в доступном MAIN realm (page-controlled); **L** — ограничение архитектуры, наблюдение отсутствует; «—» — не применимо.

## 1. Техника × контекст выполнения

| Контекст | DET-001 | DET-002 | DET-003 | DET-004 | Ожидаемый `coverageState` | Статус проверки |
| --- | --- | --- | --- | --- | --- | --- |
| Top document (`outermost_frame`, `active`) | J | J | J | J (объекты realm Window) | `active` при `document_start`; `late-start` при поздней инъекции | наблюдалось (прогон 2026-09-12, Chromium 153.0.0.0 (Playwright 1.63.0, chromium-1243), `pnpm test:extension`: canvas-positive, canvas-chart-negative, spa-navigation — `active`; late-start.spec — `late-start` после `ui-inject-now`) |
| Same-origin iframe | J (отдельная инъекция, `allFrames: true`) | J | J | J | `active`/`late-start`; при неудаче инъекции — `partial` + `frames-inaccessible` | P06, Chromium 153.0.8010.12, 2026-09-13: два DET-002 child в отдельном documentKey, parent DET-001 не смешивается с child. Остальные API отдельно не проверены. [Тест](../../tests/extension/stand/documents.spec.ts), [trace](traces/P06-frame-same.json) |
| Cross-origin iframe, разрешение на origin iframe есть | J | J | J | J | `active`; frame учитывается отдельно | P06, Chromium 153.0.8010.12, 2026-09-13: optional site grant охватывает 127.0.0.1:4173 ↔ :4174; два DET-002 child, отдельный documentKey. [Тест](../../tests/extension/stand/documents.spec.ts), [trace](traces/P06-frame-cross.json) |
| Cross-origin iframe, разрешения нет | L | L | L | L | `partial` + `frames-inaccessible: N` у родителя; для самого frame — `no-access` | P06, Chromium 153.0.8010.12, 2026-09-13: test-optional с грантом только 127.0.0.1; localhost:4174 не обёрнут и no-access, parent partial/frames-inaccessible без сообщения от child. [Тест](../../tests/extension/stand/documents.spec.ts), [trace](traces/P06-frame-ungranted.json) |
| `about:blank` / `data:` / `blob:` frame (fallback по origin инициатора, `matchOriginAsFallback`) | J при доступе инициатора | J | J | J | `active`/`partial`; opaque origin сохраняется | P06, Chromium 153.0.8010.12, 2026-09-13: blank/blob DET-002 в отдельном active отчёте, host:null, attribution unknown; parent без ложного gap. Blob отсутствует в getAllFrames, но имеет browser onCommitted/MessageSender. **data: и остальные API отдельно не проверены.** [Тест](../../tests/extension/stand/documents.spec.ts), [blank](traces/P06-inherited-blank.json), [blob](traces/P06-inherited-blob.json) |
| Dedicated/Shared/Service Worker | L | L | L | L (`transferControlToOffscreen` виден в Window как факт передачи, не как наблюдение worker) | Успешная передача → `partial` + `worker-not-observed`; локализованный пробел виден в UI | P04, 2026-09-12, Chromium 153.0.0.0: Dedicated Worker выполнил 7 циклов рисования/чтения/экспорта, счётчики DET-003/004 не увеличились; проверены отчёт и UI. Shared/Service Worker отдельно не запускались. `pnpm test:extension`: 42 passed, 0 skipped |
| WebAssembly | L (видны только JS-входы, если они вызывают обёрнутые API) | L | L | L | Без отдельного состояния; ограничение в «Ограничениях» | не проверено |
| CSS (декларативные media queries, layout) | — | — | — | — | Ограничение в «Ограничениях» | не проверено |
| Prerender document | J (хранится отдельно; не показывается до активации) | J | J | J | Отдельный `documentId`; проекция переключается при активации | не проверено |
| BFCache restore | J (тот же `documentId`, bootstrap подавлен) | J | J | J | Восстановление отчёта; истёкшие детали → `truncated` | P06, Chromium 153.0.8010.12, 2026-09-13: back/forward сохраняют documentId A/B; pageshow.persisted=true на A, DET-002 и отчёт сохранены. Playwright --disable-back-forward-cache снят. [Тест](../../tests/extension/stand/lifecycle.spec.ts), [trace](traces/bfcache.json) |
| Встроенные страницы Chrome, Web Store, другие расширения | — | — | — | — | `unsupported` | не проверено |
| Страница с frozen/non-configurable дескриптором canvas API | L (сенсор отказывается от установки) | L | L | L | `partial` + `hook-failed`; сенсор `unsupported` | не проверено |
| Страница, заменившая обёртку после установки | L (наблюдение может прекратиться без сигнала) | L | L | L | Не детектируется надёжно; известное ограничение (REQ-015) | проверено частично (прогон 2026-09-12, Chromium 153.0.0.0 (Playwright 1.63.0, chromium-1243), `pnpm test:extension`: hook-replaced.spec — страница работает, `Function.prototype.toString` не тронут; прекращение наблюдения не сигнализируется, как и ожидалось) |

P06, 2026-09-13: [маркер порядка](../../tests/extension/stand/permissions.spec.ts) подтвердил document_start до первого inline при optional site/all-sites и late-start при настоящем activeTab. [Сторонний скрипт](../../tests/extension/stand/documents.spec.ts) с origin 2 дал DET-001/002/003 в top document origin 1, hosts[] с loopback/same-site и attribution unknown; матрица target/initiator содержит четыре комбинации. Полный последовательный прогон: **71 passed, 2 fixme**, из них P06 **15 passed, 1 fixme**. Prerender остаётся «не проверено»: CDP вернул PrerenderingDisabledByDevTools, [trace](traces/prerender.json) не содержит выдуманной активации. Отчёт и ограничения.

## 2. Техника × режим разрешений (ADR-003)

| Режим | Инъекция | DET-001…DET-004 | `coverageState` для top document | Сеть (`webRequest`) | Статус проверки |
| --- | --- | --- | --- | --- | --- |
| `off` (после установки) | Нет | L | `no-access` | Нет | P05, 2026-09-13: case 01 — нет optional grants/регистрации/обёрток/наблюдений; popup показывает отсутствие доступа и выключенный scope |
| `active-tab` («Проверять с этого момента») | executeScript только в захваченный top documentId | J после инъекции | late-start; любая cross-document навигация, включая same-origin, завершает grant приложения | Только разрешённый origin; network-limited | P05 case 03: настоящее действие toolbar через browser CDP `Extensions.triggerAction`, затем клик popup; optional grants пусты; другая вкладка и reload — no-access |
| `site` («Всегда на этом сайте», optional host для origin) | `scripting.registerContentScripts` (`detector-main-v1`, `detector-isolated-v1`, `runAt: document_start`, `allFrames: true`, `matchOriginAsFallback: true`, `persistAcrossSessions: true`) | J с `document_start` при следующей загрузке | `active`; текущий документ до перезагрузки — `late-start` | Запросы, где и target, и initiator в разрешённом scope; иначе `network-limited` | P05 case 04: реальный optional grant; ранний fillText виден, `neighbour.test` без гранта — no-access. Матрица target/initiator отдельно не перепроверялась |
| `all-sites` («Наблюдать на всех сайтах», `http://*/*`, `https://*/*`) | То же, широкие matches | J | `active` | Наиболее широкий; `ws:`/`wss:` handshake требует отдельной проверки | P05 case 05: ранние вызовы видны на двух HTTP-hostname loopback-стенда; не доказательство HTTPS/WSS/всей сети |
| Отзыв разрешения во время работы | Unregister + немедленный адресный stop idle-мосту | Новые данные не принимаются | no-access/revoked | Приём данных scope прекращается | P05 cases 06/07: настоящий `permissions.remove`, contains=false, bridge-stop, очищенный session-отчёт, popup с reload; после reload четыре canvas-дескриптора совпадают с чистым Chromium; чужая обёртка сохранена |
| Сужение scope при сохранённом широком гранте | all-sites → site → active-tab → off | Батчи исключённых документов отклоняются | no-access/revoked для исключённых документов | В пределах оставшегося scope | P05 case 08: реальные ISOLATED senders получают терминальный ACK с watermark 0; разрешённый документ продолжает наблюдение до исключения; broad contains=true после off |
| Test build (Playwright) | Статический `host_permissions: ["http://127.0.0.1/*"]` только в `test`; в `test-optional` статических grants нет | J на fixture-стенде | По выбранному scope | По выбранному scope | P05: оба профиля собираются `test:extension`; `release:verify` принимает только `local`, unit/script проверки исключают оба тестовых профиля |

Свидетельство P05: 2026-09-13, 0.1.0/test-optional, headless Chromium 153.0.8010.12 (`browser.version()` и CDP; сокращённый userAgent — 153.0.0.0), Playwright 1.63.0/build 1243; целевая матрица **7 passed, 1 fixme**. Единственный fixme — первый нативный permission prompt, независимо подтверждённый browser accessibility tree (`ExtensionInstallDialogView`/`ExtensionPermissionsView` и целевой host). Резервный путь реально одобряет host в `chrome://extensions`, затем делает запрос через клик Options, проверяет `permissions.contains` и вызывает test-only reconciliation. Никаких fake grants. Подробности и результаты полного прогона с ограничениями общей рабочей копии: внутренний отчёт, ADR-003 «Проверено в браузере». Исторические непроверенные статусы ниже относятся к прежним прогонам; этот раздел обновлён только в границах P05.

## 3. Фазы и семантика для canvas

| Сценарий | Ожидаемая запись | Статус проверки |
| --- | --- | --- |
| Успешный `getImageData` | DET-002, `phase: returned-sync`, `signalCodes: [api-use]`; при предшествующем `fillText` — `readback-after-text` | наблюдалось (прогон 2026-09-12, Chromium 153.0.0.0 (Playwright 1.63.0, chromium-1243), `pnpm test:extension`: canvas-positive — DET-002 `returned-sync`, `readback-after-text`; DET-003 `api-use`) |
| Tainted canvas → `SecurityError` | DET-002/DET-001, `phase: threw-sync`; UI: «попытка, результат странице не передан»; исключение доставлено странице | наблюдалось (прогон 2026-09-12, Chromium 153.0.0.0 (Playwright 1.63.0, chromium-1243), `pnpm test:extension`: canvas-tainted.spec + differential.spec — исключение идентично без расширения, `threw-sync`) |
| `toBlob` (callback) | DET-001, `phase: attempted` (callback не оборачивается); settlement не наблюдается | наблюдалось (прогон 2026-09-12, Chromium 153.0.0.0 (Playwright 1.63.0, chromium-1243), `pnpm test:extension`: canvas-editor-negative.spec — экспорт PNG через `toBlob` даёт DET-001 `attempted`, blob доставлен странице; canvas-tainted.spec — `threw-sync`) |
| `OffscreenCanvas.convertToBlob` (Promise) | DET-004, `phase: settlement-unobserved`; сенсор не проверяет Promise и его завершение | P04, 2026-09-12, Chromium 153.0.0.0, `offscreen.spec.ts`: differential результатов/байтов Blob/цепочки свойств, 0 вызовов `.then/.catch` сенсором; rejected Promise приходит в `unhandledrejection` с исходной identity. Известный исходный Promise дополнительно проверен unit-тестом. 10 новых browser-тестов зелёные; полный набор 42/42 |
| DET-003: измерение и рисование | `text-measured` и `text-drawn` отдельно; measurement без readback → `api-use`; гипотеза требует успешного `text-drawn` и повторных синхронных readback | P04, 2026-09-12: sensors/engine unit и `offscreen.spec.ts`, `canvas-chart-negative.spec.ts`, `canvas-positive.spec.ts` зелёные. `calibrated:false`, максимум `possible-fingerprinting/low` (ADR-001 §7) |
| История DET-003 на HTMLCanvasElement/OffscreenCanvas | Полный `clearRect`, `context.reset()`, setter `width`/`height` → readback без нового текста не имеет `readback-after-text` | P04, 2026-09-12, Chromium 153.0.0.0: 8 browser-сценариев зелёные. Unit: обе размерности, прежнее/новое значение, исключения, новое рисование, разные canvas, frozen setter, пауза и late capture. Частичный clear сбрасывает консервативно; HTML-атрибуты и обход hooks остаются ограничением; frozen setter даёт coverage gap |
| Редактор изображений (negative) | Только api-use/unassessed после PNG export, counterEvidenceCodes=[], badge 0 | Проверено 2026-09-12: canvas-editor-negative.spec.ts, rule v2, Chromium 153.0.0.0; 32/32 extension tests |
| Повторная установка сенсора (второй `hook.main.js` в realm) | Один набор обёрток; повторный bootstrap подавлен по `sensorBootId`/маркеру владения | наблюдалось (прогон 2026-09-12, Chromium 153.0.0.0 (Playwright 1.63.0, chromium-1243), `pnpm test:extension`: reinstall.spec — обёртки и счётчики не удваиваются) |
| Flood (10⁶ вызовов) | Насыщение счётчиков, `countQuality: lower-bound`, `throttled`; страница не зависает | проверено частично (прогон 2026-09-12, Chromium 153.0.0.0 (Playwright 1.63.0, chromium-1243), `pnpm test:extension`: hostile-bridge.spec — 10⁵ сообщений моста → `throttled`, SW/UI живы; насыщение 10⁶ вызовов и `lower-bound` только в unit-тестах сенсора) |

## 4. Известные пробелы (не устраняются в срезе 1)

| Пробел | Почему | Отражение в UI |
| --- | --- | --- |
| Сетевой наблюдатель (P01) | Только разрешённые target + initiator и документ текущего scope; PSL ICANN+PRIVATE, ≤128 агрегатов; IP/unknown — категория | Browser canary: literal → loopback, ungranted random target отклонён, session/export без сырых значений. Разрешённый DNS target пока unit-only; новый test grant требует review. См. внутренний отчёт |
| Атрибуция (P01) | Inline/eval/blob/неизвестный script source → unknown; соседний сетевой скрипт не атрибутирует API | Engine различает exact-resource/frame-only/unknown по provenance; page-hook счётчики unknown. Inline проверен canary; реальные external-script API связи отсутствуют |
| Workers/worklets | `scripting` не предоставляет инъекцию в эти execution targets; переписывание Worker/Blob-bootstrap и `debugger` запрещены (ТЗ II A8) | Пробел workers; `worker-not-observed` после наблюдаемой передачи canvas. P04 проверяет Dedicated Worker; остальные targets отдельно не проверены |
| OffscreenCanvas в worker | Другой realm; создание canvas прямо в worker не вызывает Window hook | P04: DET-004 только Window; успешный `transferControlToOffscreen` добавляет `worker-not-observed`, не наблюдение worker. Отсутствие worker-readback в отчёте и пробел в UI подтверждены `offscreen.spec.ts`, 2026-09-12 |
| WebAssembly | Внутренние вычисления не становятся вызовами обёрнутых API | Раздел «Ограничения» |
| CSS media queries/layout | Декларативный CSS не проходит через JS-хуки | Раздел «Ограничения» |
| DNS-резолвер, DoH, серверные журналы | Недоступны стандартному расширению | «Использованный резолвер расширению неизвестен» |
| TLS/HTTP fingerprint, серверный антифрод | Механизм оценки на сервере не виден из Window API | Нет отрицательного заключения об отсутствии антифрода |
| Сообщения WebSocket/WebTransport после handshake | `webRequest` видит только handshake | Только факт соединения |
| Скрипты, сохранившие ссылки на оригиналы до инъекции | `late-start` | «Ранние вызовы могли быть пропущены» |
| Обнаружимость обёрток | Identity функций, дескрипторы и timing меняются; маскировка запрещена | Onboarding: «расширение может быть замечено сайтом» |
| Cross-origin iframe без разрешения | URL-ограничения `allFrames` не снимает | `frames-inaccessible` |
| `incognito` | `not_allowed` в v1 | `unsupported` |

## 5. Порядок обновления матрицы

Открытые пробелы: настоящий optional-grant revoke/toolbar activeTab, остальные SW restart cases, pinned offline PSL (F038), live hostname canaries (F181), idle-worker TTL (F171), constructor compatibility (F051/F176), полная resize/window semantics. Пройденный набор тестов не закрывает эти пункты.

1. Прогон `pnpm test:extension` на fixture-стенде E02-01 с указанием Chrome build (из `browser-support.json`).
2. Для каждой ячейки: «наблюдалось» / «не наблюдалось» / «unsupported» + ссылка на отчёт прогона и дату.
3. Расхождение с ожиданием — не правится в матрице «на глаз»: заводится задача, при неустранимом ограничении обновляются `coverageFlags` и строки UI.
4. Матрица расширяется на DET-005…DET-069 по мере эпиков E07–E10; каждая техника получает свою таблицу по этому шаблону.

## Свидетельства интеграции 2026-09-12

pnpm test:extension — exit 0, **32 passed, 0 skipped, 0 failed**; Chromium runtime 153.0.0.0, Playwright 1.63.0, headless channel chromium. Повторный прогон финального интегратора после коммита a6d6514 (2026-09-12 22:40): тот же результат — 32 passed, 0 failed, 0 skipped (1.1 min), условные fixme (bfcache, revoke) не сработали; строки таблиц выше не менялись. Metadata пакета Chromium 1243 / Chrome for Testing 153.0.8010.12 отличается от browser.version(); browser-support.json хранит оба значения отдельно, verifiedBuilds остаётся пустым. Исторические perf 12:45:52 и 18:20:33 сохранены отдельно; текущий — perf/2026-09-12T18-43-06.418Z-canvas.json (предупреждения measureText 5.83 %/total 5.72 % median, getImageData 2.78 %).

| Сценарий | Подтверждено passing extension test |
| --- | --- |
| Canvas positive / editor / chart | possible-fingerprinting/low точно; редактор только api-use/unassessed с пустыми counterEvidenceCodes и badge 0; chart без FP |
| Late-start / permitted but uninjected | late-start после адресной инъекции; регистрация/permission сами по себе не дают наблюдавшийся sensor |
| Повторная инъекция MAIN и ISOLATED | reinstall.spec.ts: счётчики не удваиваются, нет hook-failed |
| UI pause/resume | pause-resume.spec.ts: SW → bridge control останавливает и возобновляет счётчики |
| Poisoning/churn; frozen late install | hostile-bridge.spec.ts + late-start.spec.ts: genuine boot cases, ограничения доставки/диагностики; coverage page-controlled |
| Scope off | revoke.spec.ts очищает наблюдения, host и observedSince; прекращает приём |
| SW stop до save / после save до ACK | sw-restart/replay.spec.ts: один seq/session при повторе, итог count=4; детали в sw-restart.md |
| Error-page / renderer crash | abort-nav.spec.ts воспроизводит browser events; свидетельств недостаточно для изменения replacement transitions F023; сохранён 2026-09-12-navigation-traces.json (окно crash 1000 ms, не доказательство отсутствия будущих событий) |

Правило canvas v2 агрегирует lifetime документа, не устанавливает временную последовательность. Исторический readback-after-text и неполная resize история не повышают tier до pattern/medium. Constructor sensors не включены в production; поздний MAIN не доказывает чистоту realm (ADR-006). UI catalog-disabled честно означает отсутствие matching, не ноль вендоров.

Irreducible oversized dedup snapshots fail closed: сохраняется последний persisted ACK watermark, новые данные не подтверждаются. Это unit-verified ограничение, не новая browser coverage row. Брендированный Chrome, native sidepanel zoom, screen reader, реальные optional grants, nonzero-frame prerender и opaque-frame acceptance остаются непроверенными.
