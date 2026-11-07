# Наблюдаемые API в API Guard и Antidetect

E22-21 / ADR-067, 2026-10-21. Это read-only представление существующего отчёта текущих документов. Оно не устанавливает сенсоры, не выполняет API-тестов, не читает Pro/API-results/RTC snapshots и не меняет API-конфигурацию.

## Источник и смысл подсветки

`api-observed-usage.js` принимает до 32 `{report, relation}`. `report` — уже существующая `ReportProjection`: `apiOperations` содержит название операции, фазу, счётчик и его качество; `techniques` содержит агрегат техники и существующую интерпретацию. Источники контракта: [ApiOperationSummary](../../baseline-ts/packages/contracts/src/api-operations.ts), [ReportProjection](../../baseline-ts/packages/contracts/src/messages.ts), [дополнительные операции ADR-038](../../packages/contracts/src/review-operations.json), [37 WebAssembly surfaces](../../apps/production-extension/webassembly-apis.js).

Сначала используются точные известные operation counters. Семейный technique counter используется для строки API только при однозначном соответствии и отсутствии точных операций этой строки в том же документе. Operation и technique counters описывают одни наблюдения и не складываются друг с другом. Поле `basis` у источника различает эти основания; общее `basis: operation` означает наличие хотя бы одного источника с точными операциями.

Счётчик означает зарегистрированные наблюдения, включая попытки и синхронные ошибки. Он не является числом различных вызовов сторонних скриптов. В частности, необходимые приватные Canvas copies/encoders в режиме Custom могут проходить через уже установленные наблюдающие обёртки и добавлять наблюдения. Исходные пиксели, результаты API, аргументы Math, device IDs, SDP, ICE и адреса не нужны этому представлению.

Качество сохраняется: `exact`, `sampled`, `lower-bound`; насыщение на 2 147 483 647 даёт `lower-bound`. `attempted` отмечает наличие фазы `attempted` или `threw-sync`; отсутствие этой отметки не доказывает успех async-запроса: `settlement-unobserved` сохраняет неизвестный исход. `fingerprintPattern` копируется только из связанного существующего `interpretation: fingerprinting-pattern`. Обычный API-вызов, настройка Custom или загруженный SDK сами по себе его не включают. Семейная интерпретация не устанавливает вызывающий скрипт.

## Принадлежность источника

`sources[].host` — уже отредактированный host документа отчёта, а не host вызывающего JavaScript. `relation` передаётся контроллером из native document/frame identity и существующего registrable-domain представления с учётом PRIVATE PSL. Mapper не вычисляет отношение по неравенству строк host. `same-origin` / `same-site` попадают в `firstPartyCount`, `cross-site` — в `thirdPartyCount`, `opaque` / `unknown` — в `unknownCount`. Это принадлежность **документа выполнения**. Во всех случаях `callerRelation: unknown`.

Обычная `ReportProjection` не содержит привязки API-operation к скрипту или сетевому ресурсу. Загрузка стороннего скрипта в основном документе не позволяет приписать ему API-вызов. Список сторонних ресурсов, vendor matches и сетевые инициаторы не присоединяются к API counters по host. `about:blank` / `srcdoc` без подтверждённого native origin остаются непрозрачными для определения отношения.

## Покрытие и отрицательные результаты

Таблица ниже составлена для 143 строк catalog 6 (текущий каталог 11 содержит 158 строк; для 15 строк ADR-087 таблица здесь не обновлялась) и отдельный UI-facet сертификатов. Выделяются 107 каталожных строк по 380 точным операциям и 27 однозначным семейным соответствиям. Остальные 36 строк не получают подсветку без более подробной существующей metadata. Это не утверждение об отсутствии соответствующего API на сайте.

Например, DET-025 объединяет несколько Navigator getters; DET-030 — viewport и devicePixelRatio; DET-032 — hardwareConcurrency и cpuPerformance; DET-036 — несколько Intl API; DET-042 — generic sensors, motion и compute pressure; DET-058 — WebSocket и WebTransport. Один общий счётчик не включает все связанные строки. Точная `Navigator.cpuPerformance`, `WebTransport` или `Screen.width` включает только соответствующую строку. DET-003, измерение/рисование текста, не считается Canvas readback.

`webrtc-certificates` — только локальный facet UI, не новый API/wire ID. Он требует `RTCPeerConnection.generateCertificate`, `RTCCertificate.getFingerprints` или `RTCCertificate.expires`. Создание peer connection, SDP, getStats и IndexedDB activity не доказывают обращения к сертификату. Math-подсветка отражает только прежние узкие DET-022/023 сигнатуры, доступные при существующем Pro-наблюдении; названия всех 23 функций из настроек не выдаются за 20 наблюдавшихся операций.

Workers и недоступные iframe, потеря budget/transport, начало наблюдения после загрузки и отключённые сенсоры сохраняют прежние границы coverage. При смене документа, недоступности, паузе и загрузке нового состояния старые положительные строки не должны оставаться видимыми. Контроллер проверяет document identity до и после чтения. Mapper дополнительно дедуплицирует documentKey по reportRevision, не вызывает getters/coercion и ограничивает просмотр 128 operations и 128 techniques на документ. Превышение лимита явно отражается `truncated`.

Нативный Firefox-run выявил frame ID `12884901889`, превышающий 32-битный предел счётчиков. Для существующего `ui-get-report.frameId` исправлена только числовая граница: неотрицательный integer до `Number.MAX_SAFE_INTEGER`. `tabId`, revisions и counts сохраняют прежние границы; поля, действия и проверка привилегированного отправителя не меняются. Canonical validators и JSON Schema в обеих исходных базах согласованы. `scripts/production/sync-ui-frame-ids.mjs` воспроизводимо переносит единственную замену границы в обычные `background.js` и `report.js`; vendored Protect route, не обслуживающий `ui-get-report`, не изменяется.

## Матрица соответствий

В колонке операций приведены количество точных имён и первые примеры. Полный список — замороженный `API_OBSERVED_USAGE_OPERATION_MAP` в mapper, проверяемый против канонического registry; wildcard/prefix принятия произвольных operations нет. `—` означает, что по этому основанию строка не выделяется.

<!-- E22-21 mapping matrix below is derived from the checked-in mapper. -->

| Строка API | Точные операции | Семейная техника |
| --- | --- | --- |
| `window-management` | 18: `Window.getScreenDetails`, `ScreenDetails.screens`, `ScreenDetails.currentScreen` … | — |
| `compute-pressure` | 10: `PressureObserver`, `PressureObserver.knownSources`, `PressureRecord.source` … | — |
| `idle-detection` | 5: `IdleDetector`, `IdleDetector.requestPermission`, `IdleDetector.start` … | — |
| `local-fonts` | — | `DET-009` |
| `canvas-readback` | — | `DET-001`, `DET-002`, `DET-004` |
| `webgl` | — | `DET-011`, `DET-012` |
| `webgpu` | 59: `GPU.requestAdapter`, `GPUAdapter.requestDevice`, `GPUDevice.createComputePipelineAsync` … | `DET-013`, `DET-014` |
| `audio` | 26: `AudioContext`, `OfflineAudioContext`, `OscillatorNode` … | `DET-015`, `DET-016`, `DET-017` |
| `webrtc` | 41: `RTCPeerConnection`, `RTCPeerConnection.generateCertificate`, `RTCPeerConnection.createOffer` … | `DET-056`, `DET-057` |
| `webassembly` | 37: `WebAssembly.compile`, `WebAssembly.instantiate`, `WebAssembly.compileStreaming` … | `DET-065` |
| `battery` | — | `DET-040` |
| `network-information` | — | `DET-041` |
| `keyboard` | — | — |
| `client-hints` | 5: `Navigator.userAgentData`, `NavigatorUAData.brands`, `NavigatorUAData.mobile` … | `DET-026` |
| `clipboard-read` | 2: `Clipboard.read`, `Clipboard.readText` | — |
| `media-enumeration` | 1: `MediaDevices.enumerateDevices` | — |
| `media-capture` | 5: `MediaDevices.getSupportedConstraints`, `MediaStreamTrack.getCapabilities`, `MediaStreamTrack.getSettings` … | — |
| `geolocation` | — | `DET-044` |
| `generic-sensors` | 7: `Accelerometer`, `Gyroscope`, `LinearAccelerationSensor` … | — |
| `bluetooth` | 3: `Bluetooth.getAvailability`, `Bluetooth.getDevices`, `Bluetooth.requestDevice` | — |
| `usb` | 2: `USB.getDevices`, `USB.requestDevice` | — |
| `serial` | 2: `Serial.getPorts`, `Serial.requestPort` | — |
| `hid` | 2: `HID.getDevices`, `HID.requestDevice` | — |
| `midi` | — | — |
| `gamepads` | — | `DET-047` |
| `speech-voices` | 1: `SpeechSynthesis.getVoices` | — |
| `service-worker` | — | `DET-063` |
| `push` | 3: `PushManager.permissionState`, `PushManager.getSubscription`, `PushManager.subscribe` | — |
| `background-sync` | 2: `SyncManager.register`, `SyncManager.getTags` | — |
| `periodic-sync` | 3: `PeriodicSyncManager.register`, `PeriodicSyncManager.getTags`, `PeriodicSyncManager.unregister` | — |
| `notifications` | 1: `Notification.maxActions` | — |
| `storage-estimate` | — | — |
| `videoframe-readback` | — | — |
| `screen-extended` | 1: `Screen.isExtended` | — |
| `webcodecs-capabilities` | 5: `AudioDecoder.isConfigSupported`, `AudioEncoder.isConfigSupported`, `VideoDecoder.isConfigSupported` … | — |
| `media-capabilities` | 4: `HTMLMediaElement.canPlayType`, `MediaSource.isTypeSupported`, `MediaCapabilities.decodingInfo` … | — |
| `encrypted-media` | 3: `Navigator.requestMediaKeySystemAccess`, `MediaKeySystemAccess.createMediaKeys`, `MediaKeySystemAccess.getConfiguration` | — |
| `hdcp-policy` | 1: `MediaKeys.getStatusForPolicy` | — |
| `autoplay-policy` | — | — |
| `webrtc-codecs` | 4: `RTCRtpSender.getCapabilities`, `RTCRtpReceiver.getCapabilities`, `RTCRtpSender.getParameters` … | — |
| `device-motion` | 6: `Window.addEventListener.deviceorientation`, `Window.addEventListener.devicemotion`, `Window.addEventListener.deviceorientationabsolute` … | — |
| `hardware-concurrency` | — | — |
| `device-memory` | — | `DET-033` |
| `performance-memory` | — | — |
| `cpu-performance` | 1: `Navigator.cpuPerformance` | — |
| `touch-points` | — | `DET-034` |
| `webxr` | — | `DET-048` |
| `speech-recognition` | 2: `SpeechRecognition.available`, `SpeechRecognition.install` | — |
| `shape-detection` | 7: `BarcodeDetector`, `FaceDetector`, `TextDetector` … | — |
| `handwriting-recognition` | 2: `Navigator.queryHandwritingRecognizer`, `Navigator.createHandwritingRecognizer` | — |
| `webnn` | 44: `Navigator.ml`, `MLContext.lost`, `MLTensor.dataType` … | — |
| `builtin-ai-models` | 24: `LanguageModel.availability`, `LanguageModel.params`, `LanguageModel.create` … | — |
| `translation-ai` | 9: `Translator.availability`, `Translator.params`, `Translator.create` … | — |
| `screen-wake-lock` | — | — |
| `picture-in-picture` | — | — |
| `document-picture-in-picture` | — | — |
| `fullscreen` | 2: `Element.requestFullscreen`, `Document.exitFullscreen` | — |
| `pointer-lock` | — | — |
| `file-system-pickers` | 3: `Window.showOpenFilePicker`, `Window.showSaveFilePicker`, `Window.showDirectoryPicker` | — |
| `protocol-handlers` | 2: `Navigator.registerProtocolHandler`, `Navigator.unregisterProtocolHandler` | — |
| `installed-related-apps` | 1: `Navigator.getInstalledRelatedApps` | — |
| `media-session` | — | — |
| `opfs` | 1: `StorageManager.getDirectory` | — |
| `cookie-store` | — | — |
| `document-cookie` | 2: `Document.cookie.get`, `Document.cookie.set` | — |
| `storage-buckets` | — | — |
| `persistent-storage` | — | — |
| `indexeddb-enumeration` | — | — |
| `cache-storage` | — | `DET-052` |
| `legacy-quota` | — | — |
| `cast-discovery` | — | — |
| `send-beacon` | — | — |
| `fetch-later` | — | — |
| `websocket` | — | — |
| `webtransport` | 1: `WebTransport` | — |
| `platform-authenticator` | — | — |
| `web-share` | 2: `Navigator.canShare`, `Navigator.share` | — |
| `credential-management` | 1: `CredentialsContainer.create` | — |
| `fedcm-user-info` | — | — |
| `payment-probes` | — | — |
| `storage-access` | — | `DET-054` |
| `private-state-tokens` | — | — |
| `background-fetch` | 3: `BackgroundFetchManager.fetch`, `BackgroundFetchManager.get`, `BackgroundFetchManager.getIds` | — |
| `shared-worker` | 1: `SharedWorker` | — |
| `dedicated-worker` | 1: `Worker` | — |
| `clipboard-write` | 2: `Clipboard.write`, `Clipboard.writeText` | — |
| `permission-probes` | 1: `Permissions.query` | — |
| `reporting-observer` | — | — |
| `feature-policy` | — | — |
| `navigator-platform` | — | — |
| `navigator-user-agent` | — | — |
| `navigator-language` | — | — |
| `navigator-languages` | — | — |
| `navigator-vendor` | — | — |
| `navigator-app-version` | — | — |
| `navigator-oscpu` | — | — |
| `screen-width` | 1: `Screen.width` | — |
| `screen-height` | 1: `Screen.height` | — |
| `screen-avail-width` | 1: `Screen.availWidth` | — |
| `screen-avail-height` | 1: `Screen.availHeight` | — |
| `screen-color-depth` | 1: `Screen.colorDepth` | — |
| `screen-pixel-depth` | 1: `Screen.pixelDepth` | — |
| `window-device-pixel-ratio` | — | — |
| `screen-orientation` | 3: `Screen.orientation`, `ScreenOrientation.angle`, `ScreenOrientation.type` | — |
| `timezone` | — | — |
| `webassembly-compile` | 1: `WebAssembly.compile` | — |
| `webassembly-instantiate` | 1: `WebAssembly.instantiate` | — |
| `webassembly-compile-streaming` | 1: `WebAssembly.compileStreaming` | — |
| `webassembly-instantiate-streaming` | 1: `WebAssembly.instantiateStreaming` | — |
| `webassembly-validate` | 1: `WebAssembly.validate` | — |
| `webassembly-module` | 1: `WebAssembly.Module` | — |
| `webassembly-instance` | 1: `WebAssembly.Instance` | — |
| `webassembly-memory` | 1: `WebAssembly.Memory` | — |
| `webassembly-memory-grow` | 1: `WebAssembly.Memory.grow` | — |
| `webassembly-memory-buffer` | 1: `WebAssembly.Memory.buffer` | — |
| `webassembly-module-imports` | 1: `WebAssembly.Module.imports` | — |
| `webassembly-module-exports` | 1: `WebAssembly.Module.exports` | — |
| `webassembly-module-custom-sections` | 1: `WebAssembly.Module.customSections` | — |
| `webassembly-instance-exports` | 1: `WebAssembly.Instance.exports` | — |
| `webassembly-table` | 1: `WebAssembly.Table` | — |
| `webassembly-table-length` | 1: `WebAssembly.Table.length` | — |
| `webassembly-table-grow` | 1: `WebAssembly.Table.grow` | — |
| `webassembly-table-get` | 1: `WebAssembly.Table.get` | — |
| `webassembly-table-set` | 1: `WebAssembly.Table.set` | — |
| `webassembly-global` | 1: `WebAssembly.Global` | — |
| `webassembly-global-value-of` | 1: `WebAssembly.Global.valueOf` | — |
| `webassembly-global-value` | 1: `WebAssembly.Global.value` | — |
| `webassembly-global-value-set` | 1: `WebAssembly.Global.value.set` | — |
| `webassembly-tag` | 1: `WebAssembly.Tag` | — |
| `webassembly-exception` | 1: `WebAssembly.Exception` | — |
| `webassembly-exception-is` | 1: `WebAssembly.Exception.is` | — |
| `webassembly-exception-get-arg` | 1: `WebAssembly.Exception.getArg` | — |
| `webassembly-exception-stack` | 1: `WebAssembly.Exception.stack` | — |
| `webassembly-compile-error` | 1: `WebAssembly.CompileError` | — |
| `webassembly-link-error` | 1: `WebAssembly.LinkError` | — |
| `webassembly-runtime-error` | 1: `WebAssembly.RuntimeError` | — |
| `webassembly-suspending` | 1: `WebAssembly.Suspending` | — |
| `webassembly-promising` | 1: `WebAssembly.promising` | — |
| `webassembly-suspend-error` | 1: `WebAssembly.SuspendError` | — |
| `webassembly-memory-to-fixed-length-buffer` | 1: `WebAssembly.Memory.toFixedLengthBuffer` | — |
| `webassembly-memory-to-resizable-buffer` | 1: `WebAssembly.Memory.toResizableBuffer` | — |
| `webassembly-tag-type` | 1: `WebAssembly.Tag.type` | — |
| `math-transcendentals` | — | `DET-022`, `DET-023` |
| `webrtc-certificates` | 3: `RTCPeerConnection.generateCertificate`, `RTCCertificate.getFingerprints`, `RTCCertificate.expires` | — |

## Проверки

`node --test scripts/test/api-observed-usage.test.mjs`: 19/19 PASS. Проверены canonical registry drift, ложное расширение Screen/UA/RTC/worker families, неподтверждённый fingerprint pattern, одновременные operation/technique aggregates, DTLS facet, Wasm master/individual rows, source attribution, дедупликация, saturating/sampled counters, отсутствие raw-value/settings inference, пауза, getters/coercion и лимиты. Controller19/19; фактические native8/8 в Chromium153 и Firefox138, полный unit3826 и package proof22 файлов описаны в отчёте E22-21.

Compatibility regression: `node --test scripts/test/ui-frame-ids.test.mjs` — 10/10 PASS; `pnpm exec vitest run --config vitest.config.ts packages/contracts/test/ui-request.test.ts` — 69/69 PASS. Проверены сохранение большого native frame ID без округления, MAX_SAFE_INTEGER, отрицательные/дробные/NaN/unsafe значения, прежний no-coercion/never-throw parser boundary, 32-битные tab/revision границы и идемпотентный строго ограниченный generator. `node scripts/production/sync-ui-frame-ids.mjs --check` — PASS.

Измерение UI-проекции на текущей машине в Node: 32 документа × 128 operation rows + 27 techniques, 10 прогревочных и 50 измеренных прогонов. Результат — 108 строк API/facet, JSON 559 290 байт; медиана 2,54 мс, p95 3,79 мс. Это ограниченный тест проекции, не измерение MAIN hooks.
