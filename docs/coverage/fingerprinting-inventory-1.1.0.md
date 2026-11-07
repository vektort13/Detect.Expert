# Detect.Expert 1.1.0: полный список технологий для технической проверки

Обновление 2026-10-20: WebAssembly расширен по [ADR-059](../decisions/ADR-059.md) до 37 условных JavaScript surfaces, общий именованный runtime registry содержит 425 операций. Актуальная [матрица WebAssembly](webassembly.md) описывает доступность и ограничения. Ниже, а также в связанных JSON/CSV сохранён исторический снимок от 2026-10-10: 398 операций, из них 10 WebAssembly; эти файлы не являются полным текущим Wasm-каталогом.

Дата сверки: **10 октября 2026 года**. Предмет проверки — фактически поставляемая общая база `apps/production-extension` и два полных пакета: Chrome и Firefox без DBSC. Файл описывает существующий код; research-каталоги и предусмотренные taxonomy IDs отделены от работающих каналов наблюдения.

Машинная версия: [JSON](fingerprinting-inventory-1.1.0.json). Полный именованный API registry: [CSV для Excel, 398 строк](fingerprinting-api-operations-1.1.0.csv). Семь Math-сигнатур приведены отдельно. Трассировка: DET-001…DET-074, REQ-002/004/005/006/009/011/015; production ADR-017/018/021/022/023/027/030/031/032/036/037/038.

## Состав и смысл чисел

| Показатель | Фактическое количество |
| --- | --- |
| ID в taxonomy | 74 |
| Категории обычного наблюдения | 66 |
| Дополнительно только при записи Pro | 2: DET-022/023, семь Math-сигнатур |
| Категории с любым каналом наблюдения | 68: 65 page-hook + 4 browser-network, DET-058 входит в оба канала |
| Категории без production detector | 6 |
| Именованные операции в API_OPERATION_DEFINITIONS | 398 уникальных; Math-сигнатуры и часть прежних hooks приведены отдельно |
| Распознаваемые антифрод/CAPTCHA/identification продукты | 32; 61 resource rules + 2 WebRTC hints |
| Response header names / Client Hint names | 18 / 27 |
| Social providers / rule families | 45 / 57 |
| Прямые GTM destinations | 9 |
| Beacon services / transport profiles | 6 / 11 |
| Background operations | 12 |
| Cookie entries / compiled rules / primary-source rules | 6 687 / 6 673 / 443 |
| Именуемые Chrome extension probe targets | 128 |
| Вспомогательные visual activity markers | 35 |

Категории объединяют наблюдаемые вызовы, чтения API и сетевые события. Большинство выводов имеет `api-use`, confidence `unassessed`. Специальная интерпретация паттерна есть для Canvas readback after text, многопортовых обращений к локальной цели и серии случайных поддоменов. Семь Pro Math-сигнатур дают `known-numeric-pattern` на точных аргументных маркерах. Распознавание конкретного SDK/ресурса выполняется отдельными фиксированными правилами.

## Как работает наблюдение

В MAIN-контексте разрешённых документов устанавливаются обёртки методов, конструкторов, getters и отдельных setters. Сохраняются техника, операция, счётчик, качество счётчика и фаза: attempted / returned-sync / threw-sync / settlement-unobserved. Promise страницы возвращается как есть; его содержимое не раскрывается этим общим hook. Отдельные модули Social/GTM/background связывают действие с native currentScript либо ограниченной выборкой stack. Они помечаются page-hook / page-controlled. Сетевой инициатор-origin сам по себе не превращается в имя JavaScript-файла.

Browser-network события наблюдаются отдельно, с браузерной принадлежностью документу и проверкой разрешений. Синхронная ошибка/попытка обращения не равна успешной передаче данных. Анализ идёт по документам и посещениям; coverage и потери не превращаются в положительное подтверждение отсутствия техники. API, отсутствующие в браузере или имеющие недоступный descriptor, не становятся установленным сенсором.

Pro сохраняет разрешённые технические результаты и параметры с отдельным count для каждой комбинации operation/phase/value/parameters. Allowlist параметров: первые четыре числовых аргумента getImageData; числовой WebGL getParameter enum; WebAssembly.Memory.grow; известный context kind для getContext; audio/video для RTP.getCapabilities; технические строки CSS.supports, matchMedia, codec и font queries. Текст для measureText и второй аргумент текста FontFaceSet не сохраняются. Новые варианты ограничены отдельным бюджетом одной операции. Произвольные request bodies, form input и clipboard contents не читаются. Значения фактически отправленных cookies сохраняет отдельный native Pro-канал ADR-037; setter document.cookie сохраняет только имя и источник записи.

## Полная taxonomy и фактическая реализация

В таблицах: **API** — page hook при наличии браузерного интерфейса; **Сеть** — browser-network канал; **Частично** — работает перечисленная часть категории; **Только Pro** — узкие сигнатуры только во время записи; **Нет** — предусмотренный ID без production detector.

### Графика, Canvas, геометрия и шрифты

| DET ID / технология | Статус | Как детектируется | Границы / код |
| --- | --- | --- | --- |
| DET-001 — Экспорт Canvas | API | Обёртки HTMLCanvasElement.toDataURL и toBlob фиксируют обращение и фазу. | Результат callback toBlob не наблюдается; одиночный экспорт имеет интерпретацию api-use. [hook.main.js:3922](../../apps/production-extension/hook.main.js#L3922) |
| DET-002 — Чтение пикселей Canvas 2D | API | Обёртка CanvasRenderingContext2D.getImageData фиксирует чтение и ошибку. | Пиксели не входят в обычный счётчик; визуальное preview использует отдельный канал. [hook.main.js:3922](../../apps/production-extension/hook.main.js#L3922) |
| DET-003 — Canvas: измерение и рисование текста | API | measureText, fillText, strokeText; отдельные признаки text-measured и text-drawn. | Измеряемая строка не сохраняется; measureText сам по себе не подтверждает fingerprint. [hook.main.js:3922](../../apps/production-extension/hook.main.js#L3922) |
| DET-004 — OffscreenCanvas в Window | API | convertToBlob и OffscreenCanvasRenderingContext2D.getImageData; текстовые операции идут в DET-003. | Обработка после переноса в Worker недоступна; transferControlToOffscreen отмечает worker-not-observed. [hook.main.js:3922](../../apps/production-extension/hook.main.js#L3922) |
| DET-005 — DOM-геометрия и косвенные проверки шрифтов | API | Element.getClientRects/getBoundingClientRect и HTMLElement.offsetWidth/offsetHeight. | Фиксируются обращения; список установленных шрифтов по геометрии не вычисляется. [hook.main.js:4216](../../apps/production-extension/hook.main.js#L4216) |
| DET-006 — Range-геометрия | API | Range.getClientRects и getBoundingClientRect. | Нет отдельного алгоритма вывода шрифтов или идентичности пользователя. [hook.main.js:4216](../../apps/production-extension/hook.main.js#L4216) |
| DET-007 — SVG-метрики | API | SVGGraphicsElement.getBBox; SVGTextContentElement.getComputedTextLength/getSubStringLength. | Это наблюдение измерения геометрии/текста. [hook.main.js:4216](../../apps/production-extension/hook.main.js#L4216) |
| DET-008 — CSS Font Loading / FontFaceSet | API | check, load, values, keys, entries, forEach, Symbol.iterator. | Перечень возвращённых FontFace не читается; асинхронный результат load не перехватывается. [hook.main.js:4216](../../apps/production-extension/hook.main.js#L4216) |
| DET-009 — Local Font Access | API | window.queryLocalFonts. | Видна попытка запроса; содержимое Promise и полная установленная коллекция шрифтов недоступны. [hook.main.js:4216](../../apps/production-extension/hook.main.js#L4216) |
| DET-010 — CSSOM / computed styles | Нет | В taxonomy предусмотрены getComputedStyle и computedStyleMap. | Production hooks не установлены. — |
| DET-011 — WebGL 1/2: GPU, расширения, лимиты, точность shader | API | getParameter, getExtension, getSupportedExtensions, getShaderPrecisionFormat; поля WebGLShaderPrecisionFormat. | Видно чтение возможностей, включая GPU vendor/renderer при соответствующем запросе; аппаратный backend автоматически не классифицируется. [hook.main.js:4284](../../apps/production-extension/hook.main.js#L4284) |
| DET-012 — WebGL 1/2: чтение framebuffer | API | readPixels на обоих WebGL-контекстах. | Счётчик обращения; отдельное preview может показать уже прочитанное изображение. [hook.main.js:4284](../../apps/production-extension/hook.main.js#L4284) |
| DET-013 — WebGPU capabilities / GPUAdapterInfo / shader-pipeline | API | 56 фиксированных операций: adapter/device, features/limits/info, shader module и compute/render pipeline. | Условная установка при наличии API; benchmark GPU и отдельный классификатор модели не запускаются. [hook.main.js:4284](../../apps/production-extension/hook.main.js#L4284) |
| DET-014 — WebGPU buffer mapping / readback API | API | GPUBuffer.mapAsync, getMappedRange и unmap: попытка, синхронный результат или ошибка. | Байты ArrayBuffer и GPU-результаты не читаются; Promise mapAsync возвращается без подписки. Наблюдение API не подтверждает успешное чтение GPU данных. [hook.main.js:5973](../../apps/production-extension/hook.main.js#L5973) |

### Аудио, медиоустройства, кодеки и числовые вычисления

| DET ID / технология | Статус | Как детектируется | Границы / код |
| --- | --- | --- | --- |
| DET-015 — Web Audio: построение графа и OfflineAudioContext | API | OfflineAudioContext, startRendering, oscillator/compressor/analyser/gain, connect/start, buffer source и biquad. | Факт создания/запуска графа; fingerprint из результата рендеринга автоматически не вычисляется. [hook.main.js:5645](../../apps/production-extension/hook.main.js#L5645) |
| DET-016 — Web Audio: чтение sample/frequency/time-domain данных | API | AudioBuffer.getChannelData/copyFromChannel и четыре метода AnalyserNode. | Наблюдение чтения; audio samples и их fingerprint hash не записываются обычным детектором. [hook.main.js:5645](../../apps/production-extension/hook.main.js#L5645) |
| DET-017 — Аудиосреда | API | AudioContext, sampleRate, destination, baseLatency, outputLatency, maxChannelCount. | Видно обращение к характеристикам; создание аудиотеста расширением отсутствует. [hook.main.js:5645](../../apps/production-extension/hook.main.js#L5645) |
| DET-018 — Голоса и Speech Recognition capabilities | API | SpeechSynthesis.getVoices; SpeechRecognition.available/install. | Возвращённые списки голосов и языков не раскрываются. [hook.main.js:5762](../../apps/production-extension/hook.main.js#L5762) |
| DET-019 — Медиоустройства и параметры MediaStreamTrack | API | enumerateDevices/getSupportedConstraints/getUserMedia/getDisplayMedia; track.getCapabilities/getSettings. | Запрос списка/доступа отделён от результата; device IDs и labels не сохраняются. [hook.main.js:5762](../../apps/production-extension/hook.main.js#L5762) |
| DET-020 — Кодеки / RTP / MediaCapabilities / WebCodecs | API | canPlayType, isTypeSupported, RTP capabilities/parameters, decodingInfo/encodingInfo, isConfigSupported и ImageDecoder.isTypeSupported. | 13 именованных операций; факт проверки поддержки не означает полученный полный codec fingerprint. [hook.main.js:5762](../../apps/production-extension/hook.main.js#L5762) |
| DET-021 — DRM / EME / HDCP | API | requestMediaKeySystemAccess; getConfiguration/createMediaKeys; getStatusForPolicy. | Четыре операции; результаты Promise и лицензии не читаются. [hook.main.js:5762](../../apps/production-extension/hook.main.js#L5762) |
| DET-022 — Math: известные аргументные сигнатуры | Только Pro | Только во время Pro: sin/cos/tan/acos/acosh/asin при точном совпадении семи фиксированных числовых маркеров вместе с DET-023. | Не полный журнал Math calls, не универсальный classifier; аргументы и результаты не выходят из сенсора. Учитывается api-use + known-numeric-pattern. [hook.main.js:6052](../../apps/production-extension/hook.main.js#L6052) |
| DET-023 — Math.pow: известная аргументная сигнатура | Только Pro | Только во время Pro: Math.pow(Math.PI, -100) при двух primitive number аргументах. | sqrt/hypot/cbrt/fround и произвольные pow не наблюдаются этим сенсором. Результат не читается и не экспортируется. [hook.main.js:6052](../../apps/production-extension/hook.main.js#L6052) |
| DET-024 — CSS math | Нет | ID для вычислений CSS math. | CSS math classifier не реализован. — |

### Браузер, ОС, экран, CPU, память и locale

| DET ID / технология | Статус | Как детектируется | Границы / код |
| --- | --- | --- | --- |
| DET-025 — User Agent и базовые Navigator-поля | API | Getters userAgent/platform/vendor/language/languages и app/product/sub полей. | Факт чтения; не автоматический вывод об антидетект-браузере. [hook.main.js:4962](../../apps/production-extension/hook.main.js#L4962) |
| DET-026 — User-Agent Client Hints | API | userAgentData, brands/mobile/platform, getHighEntropyValues. | Пять операций; Promise с high-entropy данными не раскрывается. [hook.main.js:4962](../../apps/production-extension/hook.main.js#L4962) |
| DET-027 — Plugins / MIME / PDF capability | API | Navigator.plugins, mimeTypes, pdfViewerEnabled. | Нет чтения содержимого PluginArray и автоматического перечня plugins. [hook.main.js:4962](../../apps/production-extension/hook.main.js#L4962) |
| DET-028 — Automation flag | API | Navigator.webdriver getter. | Наблюдается проверка флага; собственный бот-/automation-classifier отсутствует. [hook.main.js:4962](../../apps/production-extension/hook.main.js#L4962) |
| DET-029 — Screen и ориентация | API | width/height/availWidth/availHeight/colorDepth/pixelDepth/orientation; ScreenOrientation.type/angle. | Девять именованных операций. [hook.main.js:4962](../../apps/production-extension/hook.main.js#L4962) |
| DET-030 — Window / VisualViewport | API | Размеры и координаты окна, devicePixelRatio, visualViewport и его offset/page/width/height/scale. | Показывается обращение к параметрам viewport; это не перечисление мониторов. [hook.main.js:4962](../../apps/production-extension/hook.main.js#L4962) |
| DET-031 — Несколько мониторов и управление окнами | API | isExtended/getScreenDetails/ScreenDetails/ScreenDetailed, fullscreen, move/resize/open и screen change handlers. | 26 операций; списки из Promise не раскрываются, события учитываются только на известных screen targets. [hook.main.js:4962](../../apps/production-extension/hook.main.js#L4962) |
| DET-032 — CPU capabilities | API | Navigator.hardwareConcurrency и условный cpuPerformance. | Не определяется модель CPU; cpuPerformance наблюдается только если существует. [hook.main.js:4962](../../apps/production-extension/hook.main.js#L4962) |
| DET-033 — Оперативная память | API | Navigator.deviceMemory getter. | Не собственное измерение фактической RAM. [hook.main.js:4962](../../apps/production-extension/hook.main.js#L4962) |
| DET-034 — Touch capabilities | API | Navigator.maxTouchPoints getter. | Факт чтения. [hook.main.js:4962](../../apps/production-extension/hook.main.js#L4962) |
| DET-035 — Часовой пояс | API | Date.prototype.getTimezoneOffset. | Факт чтения смещения; конструкторы Date и все возможные timezone probes не классифицируются. [hook.main.js:4962](../../apps/production-extension/hook.main.js#L4962) |
| DET-036 — Intl / locale capabilities | API | resolvedOptions у восьми Intl классов и Intl.supportedValuesOf. | Вызовы наблюдаются; все locale, календарные и timezone результаты не перечисляются автоматически. [hook.main.js:4962](../../apps/production-extension/hook.main.js#L4962) |
| DET-037 — JS media queries | API | window.matchMedia. | Чистые CSS @media без JS не наблюдаются; аргумент media query не сохраняется. [hook.main.js:4962](../../apps/production-extension/hook.main.js#L4962) |
| DET-038 — JS CSS feature detection | API | CSS.supports. | Нет сканирования всех CSS @supports/env/anchor правил и полного CSSOM. [hook.main.js:4962](../../apps/production-extension/hook.main.js#L4962) |

### Разрешения, устройства и взаимодействие

| DET ID / технология | Статус | Как детектируется | Границы / код |
| --- | --- | --- | --- |
| DET-039 — Permissions и policy capabilities | API | Permissions.query, PermissionStatus.state, Notification.permission/maxActions; FeaturePolicy/PermissionsPolicy. | Известные permission/policy enum states учитываются; это не keylogging и не выдача доступа расширением. [hook.main.js:5434](../../apps/production-extension/hook.main.js#L5434) |
| DET-040 — Battery status | API | getBattery и charging/chargingTime/dischargingTime/level. | Доступность зависит от браузера; расширение не запрашивает батарею самостоятельно. [hook.main.js:4962](../../apps/production-extension/hook.main.js#L4962) |
| DET-041 — Network Information | API | Navigator.connection; type/effectiveType/rtt/downlink/downlinkMax/saveData. | Характеристики API, не собственное сетевое измерение. [hook.main.js:4962](../../apps/production-extension/hook.main.js#L4962) |
| DET-042 — Compute Pressure / Generic Sensor / motion events | Частично | PressureObserver/PressureRecord; конструкторы Accelerometer, Gyroscope, LinearAccelerationSensor, GravitySensor, Magnetometer, AbsoluteOrientationSensor, RelativeOrientationSensor; три Window deviceorientation/devicemotion/deviceorientationabsolute listeners и on-handlers. | Generic Sensor start/stop, показания датчиков и данные событий не читаются; конструктор или подписка не доказывает наличие аппаратуры. [hook.main.js:5973](../../apps/production-extension/hook.main.js#L5973) |
| DET-043 — Движения указателя / чтение координат / Idle Detection | API | mousemove/pointermove/pointerrawupdate listeners и on-handlers, 12 MouseEvent getters; IdleDetector. | Координаты и ввод пользователя не записываются; keylogging и classifier поведенческой биометрии отсутствуют. [hook.main.js:5542](../../apps/production-extension/hook.main.js#L5542) |
| DET-044 — Geolocation | API | getCurrentPosition/watchPosition. | Попытка запроса; координаты callback не читаются. [hook.main.js:5131](../../apps/production-extension/hook.main.js#L5131) |
| DET-045 — Bluetooth | API | getAvailability/getDevices/requestDevice. | Не инвентаризация физических устройств; Promise со списком не читается. [hook.main.js:5131](../../apps/production-extension/hook.main.js#L5131) |
| DET-046 — USB / HID / Serial | API | USB/HID.getDevices/requestDevice; Serial.getPorts/requestPort. | Список уже разрешённых устройств и запрос нового доступа различаются по операции. [hook.main.js:5131](../../apps/production-extension/hook.main.js#L5131) |
| DET-047 — Gamepads | API | Navigator.getGamepads. | Содержимое массива controllers не классифицируется. [hook.main.js:5131](../../apps/production-extension/hook.main.js#L5131) |
| DET-048 — WebXR | API | XRSystem.isSessionSupported/requestSession. | Capabilities и запрос сессии; результат Promise не раскрывается. [hook.main.js:5131](../../apps/production-extension/hook.main.js#L5131) |

### Хранилища и persistent identifiers

| DET ID / технология | Статус | Как детектируется | Границы / код |
| --- | --- | --- | --- |
| DET-049 — Cookie API access и скрипт записи | API | Document.cookie.get/set; CookieStore.get/getAll/set/delete. Setter связывает cookie name с currentScript или ограниченной выборкой stack. | Значение из setter не читается и не сохраняется; имя только из primitive string. Metadata записи page-controlled не доказывает, что браузер принял cookie. [hook.main.js:5788](../../apps/production-extension/hook.main.js#L5788) |
| DET-050 — localStorage / sessionStorage | API | Storage.getItem/setItem/removeItem/clear/key. | Ключи и значения не сохраняются; прямой доступ storage.foo не охвачен. [hook.main.js:5131](../../apps/production-extension/hook.main.js#L5131) |
| DET-051 — IndexedDB / RTC certificate persistence | API | IDBFactory.open/deleteDatabase/databases; IDBObjectStore.put/add и IDBRequest.result при распознанном RTCCertificate. | Дополнительные три операции не означают универсальное чтение всех IDB records. [hook.main.js:5131](../../apps/production-extension/hook.main.js#L5131) |
| DET-052 — CacheStorage / Cache | API | open/match/has/delete/keys и match/matchAll/add/addAll/put/delete/keys. | Вызовы в документе; внутренние Service Worker операции не наблюдаются. [hook.main.js:5131](../../apps/production-extension/hook.main.js#L5131) |
| DET-053 — Storage quota / persistence | API | StorageManager.estimate/persist/persisted. | Факт запроса; Promise с quota/persistence не читается. [hook.main.js:5131](../../apps/production-extension/hook.main.js#L5131) |
| DET-054 — Storage Access API | API | hasStorageAccess/requestStorageAccess/hasUnpartitionedCookieAccess/requestStorageAccessFor. | Факт проверки/запроса; фактический доступ после Promise этим hook не подтверждается. [hook.main.js:5131](../../apps/production-extension/hook.main.js#L5131) |
| DET-055 — ETag / If-None-Match identification | Нет | Предусмотрен ID HTTP validator persistence. | Детектор ETag/If-None-Match не реализован, эти header names не входят в allowlist. — |

### WebRTC, сеть, workers, WebAssembly и timing

| DET ID / технология | Статус | Как детектируется | Границы / код |
| --- | --- | --- | --- |
| DET-056 — WebRTC connection и configuration | API | 23 операции PeerConnection: ctor, offer/answer, descriptions/configuration/certificate, ICE, tracks, channels, состояния. | Дополнительный RTC канал показывает разрешённую STUN/TURN metadata и lifecycle; не запускает соединения. [hook.main.js:4839](../../apps/production-extension/hook.main.js#L4839) |
| DET-057 — WebRTC SDP / certificates / ICE / stats | API | 18 registry операций descriptions/getStats/RTCSessionDescription/RTCCertificate/RTCStatsReport плюс ICE getters. | Технические поля ограничены allowlist; raw IP/SDP/ICE/credentials не являются обычной export metadata. [hook.main.js:4839](../../apps/production-extension/hook.main.js#L4839) |
| DET-058 — WebSocket handshake / WebTransport creation | Частично | Native webRequest type websocket и ws/wss; отдельно page-hook конструктора WebTransport. | Пакеты QUIC, WebTransport streams и WebSocket messages не читаются. Конструктор не подтверждает установку соединения. [background.js:18219](../../apps/production-extension/background.js#L18219) |
| DET-059 — Browser requests / beacon / extension probing | API | fetch, XHR context/send, sendBeacon, image/script src, CredentialsContainer.get; отдельный fixed extension target словарь. | Ссылка src не означает успешный запрос; результат probing не даёт список установленных extensions. [hook.main.js:5131](../../apps/production-extension/hook.main.js#L5131) |
| DET-060 — Local address / multi-port probing pattern | Сеть | Native network обращения к локальным адресам/именам; 4 разных порта одной цели за 10 секунд. | Пассивный pattern с confidence low; расширение не сканирует порты и не устанавливает, какой сервис отвечает. [background.js:18074](../../apps/production-extension/background.js#L18074) |
| DET-061 — Randomized subdomain / DNS-like pattern | Сеть | 8 разных qualifying subdomain requests за 10 секунд под одним registrable domain. | Нет DNS resolver/answer наблюдения; это DNS-like HTTP request pattern, confidence low. [background.js:18152](../../apps/production-extension/background.js#L18152) |
| DET-062 — CNAME cloaking / first-party proxy | Нет | ID предусмотрен для CNAME/first-party vendor delivery. | CNAME resolution и detector скрытого vendor не реализованы. — |
| DET-063 — Service Worker API | API | ServiceWorkerContainer.register/getRegistration/getRegistrations. | Внутренние worker callbacks и отправки после закрытия вкладки не наблюдаются; отдельный inventory описан ниже. [hook.main.js:5131](../../apps/production-extension/hook.main.js#L5131) |
| DET-064 — Worker / SharedWorker / Worklet creation | API | Конструкторы Worker/SharedWorker и Worklet.addModule, включая общий метод AudioWorklet/PaintWorklet при доступном native descriptor. | Наблюдается создание из документа; URL/options, внутренние worker/worklet callbacks, Math и сетевые отправки worker не читаются. Успешный вызов отмечает worker-not-observed. [hook.main.js:5904](../../apps/production-extension/hook.main.js#L5904) |
| DET-065 — WebAssembly API | API | compile/instantiate/streaming/validate; Module/Instance/Memory, grow/buffer. | Десять операций; инструкции, SIMD/threads и внутренний Wasm fingerprint не классифицируются. [hook.main.js:5281](../../apps/production-extension/hook.main.js#L5281) |
| DET-066 — Timing / Performance APIs | API | performance.now/Date.now sampled 1/64; mark/measure/getEntries; supportedEntryTypes. | Не полный счётчик sampled timers; classifier uptime/history/cache timing отсутствует. [hook.main.js:5235](../../apps/production-extension/hook.main.js#L5235) |
| DET-067 — Server-side TLS / HTTP / QUIC fingerprint | Нет | Архитектурная граница taxonomy. | Server-side fingerprint, JA3/JA4, DPI/MITM detector не реализованы. — |
| DET-068 — Pure CSS fingerprint без JavaScript | Нет | Архитектурная граница taxonomy. | Пассивное исполнение CSS без JS hooks не анализируется. — |
| DET-069 — WebAuthn / Credential creation / Clipboard API | API | PublicKeyCredential platform authenticator / conditional mediation / client capabilities; CredentialsContainer.create; Clipboard.read/readText/write/writeText. | Видно обращение к API. Credential options/attestation и clipboard contents не читаются; create не доказывает WebAuthn, TPM, аппаратный ID или успешную регистрацию. [hook.main.js:5973](../../apps/production-extension/hook.main.js#L5973) |

### WebNN, AI, recognition, app integration и headers

| DET ID / технология | Статус | Как детектируется | Границы / код |
| --- | --- | --- | --- |
| DET-070 — WebNN / ML capabilities | API | 44 операции ML/MLContext/MLGraphBuilder/MLTensor/MLOperand, включая builder math ops. | Не измерение NPU и не benchmark backend; model/tensor contents не исследуются. [hook.main.js:5699](../../apps/production-extension/hook.main.js#L5699) |
| DET-071 — Built-in AI capabilities | API | 33 операции LanguageModel/Translator/Summarizer/Writer/Rewriter/LanguageDetector/Proofreader. | Условные hooks; наличие в registry не гарантирует API в текущем browser; prompts/output не читаются. [hook.main.js:5762](../../apps/production-extension/hook.main.js#L5762) |
| DET-072 — Handwriting / Shape Detection | API | query/createHandwritingRecognizer, BarcodeDetector/FaceDetector/TextDetector и detect/getSupportedFormats. | Девять условных операций; successful native recognition каждого API не подтверждён. [hook.main.js:5762](../../apps/production-extension/hook.main.js#L5762) |
| DET-073 — Интеграция веб-приложений | API | 48 операций RelatedApps/protocols/DigitalGoods/locks/share/badges/files/Push/Sync/Navigation/CloseWatcher/Popover/Ink/TrustedTypes. | Это наблюдение capability/API использования; список приложений/файлов, фактические background sends и отдельный app fingerprint не выводятся. [hook.main.js:5762](../../apps/production-extension/hook.main.js#L5762) |
| DET-074 — Response headers / requested Client Hints | Сеть | 18 фиксированных имён headers, включая Set-Login, CSP, HSTS, COOP, COEP, X-Frame-Options; Accept-CH/Critical-CH разбираются в 27 известных hint names. | Считаются ответы с конкретным заголовком. Значения новых headers не читаются; Set-Login не раскрывает факт входа, наличие policy не доказывает её применение. [background.js:1483](../../apps/production-extension/background.js#L1483) |

## Специальные pattern detectors

| Паттерн | Условие текущего кода | Интерпретация |
| --- | --- | --- |
| Canvas readback after text | Успешное рисование текста + как минимум 2 успешных синхронных readout с readback-after-text/export-after-text. Связь text/readout отслеживается по контексту/Canvas; clear/reset/resize очищает историю. | possible-fingerprinting, confidence low. Правило без отдельного time window; порог не калиброван на оценку уникальности. toBlob callback и convertToBlob Promise не дают successful returned-sync readout. |
| Local multi-port | Один документ и локальная цель: ≥4 разных requested ports за 10 s. Native observer учитывает допустимые исходящие попытки. | local-probe-pattern, confidence low. Известен запрос порта, не результат port scan и не тип локального сервиса. |
| DNS-like subdomains | HTTP(S) XHR series: ≥8 qualifying unique hostnames под одним registrable domain за 10 s. Первый label 8–63 символа, буквы + цифры, ≥4 различных символа. | dns-test-pattern, confidence low. Наблюдается форма серии HTTP requests, DNS ответы/реальный resolver недоступны. |

Источники: [Canvas rule](../../apps/production-extension/background.js#L13130), [LocalProbeWindow](../../apps/production-extension/background.js#L18074), [DnsProbeWindow](../../apps/production-extension/background.js#L18152).

## Canvas/WebGL: дополнительные визуальные признаки

Это вспомогательные признаки последовательности операций и отдельное ограниченное preview, а не новые DET IDs или самостоятельные подтверждения уникальности. Наблюдаются уже выполняемые страницей действия; расширение не рендерит собственный fingerprint-тест.

| Группа | Наблюдаемые действия / marker |
| --- | --- |
| Canvas content | text; fill; gradient; pattern; path; pixel-write; image-copy; svg-source |
| Переносы/преобразования | cropped-copy; recombined-copy; flip-back-copy; transform; fractional; flip-x; flip-y; alpha; composite; canvas-reset |
| Readback | repeat-readback; multiple-readback-formats |
| GPU rendering | shader; gpu-draw; gpu-sync; gl-parameters; texture-upload |
| Cross-context | 2d-to-webgl; webgl-to-2d; webgl-to-webgl; bitmap-transfer; bitmap-create; offscreen-transfer |
| GPU timing/query API | timer-extension; timer-query; query-read; occlusion-query. Это факт использования query API, не рассчитанный GPU timing fingerprint. |

Hooks включают drawImage/putImageData/fillRect/gradients/pattern/path/transforms/composite, shader/texture/draw/finish/flush/pixelStorei, WebGL2 query операции и ImageBitmap transfers. Допустимое preview использует уже возвращённые getImageData/toDataURL/readPixels данные, отдельный visual channel и lease 60 s; лимиты: до 65 536 пикселей, размер ≤1 024, до 256 images/512 frames и 4 documents. Ограничения formats/dimensions/pack settings могут исключить изображение. Обычная metadata не содержит эти пиксели. [Код visual capture](../../apps/production-extension/hook.main.js#L3745).

## WebRTC: что именно доступно

PeerConnection lifecycle, обращения к offer/answer/descriptions, configuration, certificates, ICE candidate properties, RTP/stats API. Отдельный bounded RTC capture показывает разрешённые STUN/TURN server host/scheme/port/transport и configured/candidate/error flags; server host может быть hostname или IP. Allowlist технических RTC values охватывает codec/media capabilities, выбранные SDP/media поля, certificate fingerprints/expiry и выбранные stats fields; raw ICE candidate strings/addresses, полный SDP, credentials и user identifiers в эту value-проекцию не входят. Генерация соединений расширением не выполняется.

Две vendor hints: ThreatMetrix — aa.online-metrix.net; Fingerprint — turn.fpjs.io или {region}-turn.fpjs.io, где region 1–16 lowercase alphanumeric. Принимаются stun/turn/turns. Уровень — weak-signal / page-controlled. ThreatMetrix сохраняет sourceAccessedAt 2026-09-13 и reviewDueAt 2026-10-12: после срока используется отдельный rule ID threatmetrix-aa-turn-v1-stale с подписью о просроченной проверке. Это тот же точный matcher, не новое подтверждение источника. Fingerprint отключается после 2026-12-13. Alias не увеличивает число компаний и не меняет Pro occurrence identity.

## Антифрод, CAPTCHA и identification services

Production распознаёт следующие **32 продукта** по **61 fixed resource rules**: scheme + точный host/path или фиксированный path template + resource type; три правила Forter используют узкую CDN namespace и 15 точных CloudFront hosts. Правило также ограничено source/review датами. Все конкретные matchers, rule IDs и даты включены в JSON; resource-match не означает прочитанный внутренний алгоритм сервиса.

| Продукт | Resource rules | WebRTC hints |
| --- | --- | --- |
| Cloudflare Turnstile | 1 | 0 |
| Google reCAPTCHA | 4 | 0 |
| hCaptcha | 1 | 0 |
| DataDome | 1 | 0 |
| Sift | 1 | 0 |
| MaxMind minFraud | 2 | 0 |
| LexisNexis ThreatMetrix | 2 | 1 |
| Arkose Labs | 1 | 0 |
| Cybersource Device Fingerprint | 2 | 0 |
| SEON | 4 | 0 |
| HUMAN / PerimeterX | 2 | 0 |
| Signifyd | 1 | 0 |
| iovation | 1 | 0 |
| Fingerprint (FingerprintJS Pro) | 4 | 1 |
| FingerprintJS | 2 | 0 |
| GeeTest CAPTCHA | 2 | 0 |
| Yandex SmartCaptcha | 1 | 0 |
| Kount | 1 | 0 |
| FraudLabs Pro | 1 | 0 |
| Adyen Risk Data Collection | 2 | 0 |
| Forter | 4 | 0 |
| PayPal FraudNet | 1 | 0 |
| Alibaba Cloud CAPTCHA | 1 | 0 |
| Tencent Cloud CAPTCHA | 3 | 0 |
| MTCaptcha | 2 | 0 |
| Baidu Cloud WAF challenge components | 2 | 0 |
| Friendly Captcha | 4 | 0 |
| Sumsub WebSDK | 1 | 0 |
| TrustDecision Behavior SDK | 1 | 0 |
| NetEase Yidun CAPTCHA | 4 | 0 |
| ClearSale Behavior Analytics | 1 | 0 |
| Socure Digital Intelligence | 1 | 0 |

Расширенный research catalog содержит 131 продукт / 110 provider labels / 191 signal / 168 source, но имеет productionEnabled=false и fixtureVerified=false; новых WebRTC endpoints из этого исследования в runtime не включено. Его нельзя записывать в список 131 работающего detector. Фактическое состояние research.

## Social Networks: 45 providers и 57 семейств правил

Наблюдаются обращения к известных hosts и точным SDK/pixel/embed paths: tracking SDK (19 семейств), обычный SDK (15), tracking collector/pixel (14), embed (9). Host проверяется с границей точки; на shared CDN обязателен опубликованный путь. Для Mastodon перечислены только два конкретных hosts, а не все federated instances. AddThis сохранён как legacy signature.

| Provider ID | Hosts / domain boundaries |
| --- | --- |
| facebook | facebook.com, facebook.net |
| instagram | instagram.com |
| x | twitter.com, x.com, t.co, ads-twitter.com |
| linkedin | linkedin.com, licdn.com |
| tiktok | tiktok.com |
| snapchat | snapchat.com, sc-static.net |
| pinterest | pinterest.com, pinimg.com |
| reddit | reddit.com, redditmedia.com, redditstatic.com |
| discord | discord.com, discordapp.com |
| twitch | twitch.tv |
| youtube | youtube.com, youtube-nocookie.com |
| github | github.com |
| gitlab | gitlab.com |
| vk | vk.com, vk.ru, vkuser.net |
| ok | ok.ru |
| weibo | weibo.com |
| wechat | weixin.qq.com, wx.qq.com |
| qq | qq.com |
| telegram | telegram.org |
| line | line.me, line-scdn.net |
| google | accounts.google.com, apis.google.com, googletagmanager.com, google-analytics.com, analytics.google.com, googleadservices.com, googlesyndication.com, doubleclick.net |
| microsoft | login.microsoftonline.com, login.live.com, bat.bing.com |
| apple | appleid.apple.com |
| spotify | accounts.spotify.com |
| steam | steamcommunity.com |
| yahoo | login.yahoo.com |
| tumblr | tumblr.com |
| quora | quora.com |
| disqus | disqus.com |
| yandex | yandex.ru, yandex.com |
| mailru | mail.ru |
| kakao | kakao.com, kakaocdn.net, bc.ad.daum.net |
| naver | naver.com, naver.net |
| baidu | baidu.com |
| bluesky | bsky.app |
| sharethis | sharethis.com |
| douyin | douyin.com |
| mastodon | mastodon.social, mastodon.online |
| addthis | addthis.com |
| whatsapp | whatsapp.com, wa.me |
| viber | viber.com |
| threads | threads.com, threads.net |
| vimeo | vimeo.com |
| dailymotion | dailymotion.com |
| soundcloud | soundcloud.com |

Дополнительные shared CDN patterns: Kakao — t1.daumcdn.net /kas/static/kp.js; Douyin — unpkg.byted-static.com /bridge/douyin_open/{numeric.version}/lib/douyin_open.umd.js. Ordinary OAuth navigation/frame/request отделены от tracking pixels и необычного login endpoint как image/script. NavigatorLogin.setStatus фиксируется как login-status-api со service unknown; содержимое аргумента не извлекается. CredentialsContainer.get идёт в generic DET-059; из opaque options не выдумывается FedCM тип.

Page hooks: fetch/XHR.send/sendBeacon, image/script/iframe src, выбранный setAttribute/Node insertion/window.open; currentScript или bounded sampled stack дают вызывающий redacted script. Browser network даёт отдельный authoritative request count, но initiator-origin не определяет файл скрипта. Firefox fallback использует доступные page calls и trusted Resource Timing. Статус входа в аккаунт, список аккаунтов, история посещений и успешное считывание login-status не выводятся. [Полная coverage и источники](social-networks.md).

## Распаковка Google Tag Manager

Прямые связи GTM → Google Analytics, Google Ads, Facebook Pixel, Hotjar, Criteo OneTag, Microsoft Clarity, TikTok Pixel, LinkedIn Insight, Bing UET. В Pro наблюдаются appendChild/insertBefore/replaceChild со script и src setter на connected script. Parent определяется native currentScript ресурса gtm.js либо bounded stack frame, а не фактом загрузки «после GTM».

Counts отражают loading operations, не подтверждённое исполнение destination SDK. Нет полного container/dataLayer разбора, parser-inserted/document.write/innerHTML/module/import capture, transitive ancestry или inference по одному времени запроса. Native Firefox fixture подтверждает все девять currentScript chains; native Chrome fixture — Meta/Hotjar/Criteo. Sampled-stack branch не имеет такого же полного native подтверждения. [Детали](pro-loader.md).

## Декодер запросов-маячков

| Сервис | Transport profiles | Что интерпретируется |
| --- | --- | --- |
| Google Analytics 4 | ga4-browser-v1; ga4-mp-v1 | Документированные event fields, value/currency, identifier presence; browser wire profile transport-candidate. |
| Google Ads | google-ads-browser-v1 | Conversion metadata, value/currency и identifier/consent presence по разрешённым полям. |
| Meta | meta-browser-v1; meta-capi-v1 | Стандартные события, value/currency, присутствие browser/user identifiers и hashed email/phone. |
| TikTok | tiktok-browser-v1; tiktok-events-v1 | Browser SDK профиль endpoint-only; Events API поля разбираются для браузерно наблюдаемого запроса. |
| Яндекс | yandex-watch-v1; yandex-mp-v1 | Watch browser профиль endpoint-only; MP поля разбираются отдельно. |
| LinkedIn | linkedin-image-v1; linkedin-capi-v1 | Conversion/event metadata и разрешённые presence fields. |

Возможные результаты: fixed event enum, стоимость/ценность/выручка с назначением, ISO currency, наличие client ID/browser ID/session ID/user ID/hashed email/hashed phone, gcs/gcd presence и известные consent states. Не сохраняются сами ID/хэши, emails, secrets и произвольные bodies. gcs/gcd presence не равно доказательству включённого Consent Mode. Server API profiles работают лишь для запросов, видимых в браузере, а не для server-to-server traffic.

Chrome использует native network identity/outcomes и допустимый разбор запроса; source-attributed page calls учитываются отдельно. Firefox 138 fallback: Resource Timing query projection, неизвестный method, нет POST body/native outcome. Limits: URL/body 32 KiB, 64 fields, 16 events; 64 network rows и 32 script-call rows на document. [Coverage](advanced-inspection.md).

## Cookies, persistent tracking и восстановление идентификатора

Пассивная атрибуция JS-записи: Document.cookie setter получает имя из ограниченного префикса primitive string и фиксирует native currentScript либо bounded sampled stack. Передаются имя, source provenance, фаза и count; значение cookie и произвольные getter/Proxy параметры не исследуются. Один setter hook совместно обслуживает DET-049 и writer metadata. Эти строки попадают в Cookie writer UI и Pro; имя скрипта отсутствует, если источник не удалось определить.

Inventory через optional cookies API показывает name/domain/path, store/partition, Secure/HttpOnly/SameSite, hostOnly, expiry/session; count всех cookie identities отделён от tracking badge. Каталог: 2 266 Open Cookie Database entries + 443 primary-source rules + 492 MIT cookie-audit/CookieBlock metadata + 3 486 IAB declarations = 6 687 entries, 6 673 valid compiled rules. Exact/prefix cookie name, domain context, conflict handling и source priority определяют owner/category/purpose/confidence/sources.

Tracking=true только для применимых analytics/advertising правил. Necessary/functional/security/consent/unknown не увеличивают tracking badge. Общие auth/session names не становятся tracking по одному совпадению имени; IAB declarant не автоматически изготовитель cookie. Live значение показывается отдельным действием и не копируется из панели в Pro. Отдельный канал Chrome Pro записывает фактически наблюдавшиеся исходящие Cookie headers разрешённых запросов: имена и значения доступны в алфавитной сводке Pro/PDF. В текущем Firefox отсутствует нужная native document identity: исходящие cookie values не записываются и их сводная таблица не создаётся; metadata Cookie и доступные browser values сохраняются. Обычный Light/JSON остаётся без значений cookies. Это расшифровка назначения cookie по справочнику; универсального decrypt encrypted payload или декодера всех JWT/base64 структур нет. [Cookies coverage](cookies.md), [ADR-037](../decisions/ADR-037.md), [Pro report](pro-report-1.1.0.md).

Явный cookie restoration test: удалить одну выбранную persistent documented tracking-cookie non-HttpOnly и 10 секунд следить за native reappearance. Сравнение прежнего/нового значения выполняется только в RAM. Read-only корреляция с localStorage / IndexedDB / CacheStorage может показать совпадение ID, но не доказывает причинный источник восстановления. Pro сохраняет outcome/metadata. Auth/session/HttpOnly cookies не допускаются к тесту. Нет planting markers во всех stores или автоматического full evercookie тестирования. [ADR-032](../decisions/ADR-032.md), [реальная coverage](advanced-inspection.md).

## Удаление DBSC

DBSC inspector, debugger permission, UI controls и DBSC/TPM Cookie-поля удалены из обоих пакетов по прямому решению владельца продукта. Старые Pro-записи нормализуются с сохранением обычных данных Cookie. [ADR-044](../decisions/ADR-044.md).

## Service Worker, Web Push, Background Sync

12 пассивных методов: ServiceWorkerContainer.register/getRegistration/getRegistrations; PushManager.subscribe/getSubscription/permissionState; SyncManager.register/getTags; PeriodicSyncManager.register/getTags/unregister; Notification.requestPermission. Видны operation/phase/count и initiating script, когда доступен.

Отдельная readonly проверка current origin показывает registrations/states, Push subscription presence, Sync/Periodic tag counts и permissions. Pro проверяет один раз на document и сохраняет дальнейшие passive updates. Она не создаёт subscription/prompt/registration/sync. Работа callback внутри worker, реальное пробуждение сайта и его отправки после закрытия tab не фиксируются. В Firefox 138 trusted ISOLATED inventory API недоступен: status unsupported/null, при этом MAIN registration calls могут наблюдаться. [ADR-031](../decisions/ADR-031.md), [coverage](advanced-inspection.md).

## Third Party resources и карта связей

Показываются cross-site resources, запрошенные главным документом и доступными frames: domains, resource types, methods/counts, completion/failure/redirect и HTTP status при наличии источника. Это не только техники внутри iframe. Pro graph связывает посещение → third-party domains; explicit GTM edges объясняют direct parent там, где есть source evidence. Нативный initiator-origin не подменяется именем JS файла. First-party/CNAME vendor owner, скрытые proxies и server-to-server связи этой картой не раскрываются.

## Проверки наличия extensions / blocker probes

Существующий DET-059 sensor распознаёт primitive chrome-extension:// обращения через fetch/XHR.send/image.src/script.src. Именует 128 fixed targets, остальные валидные IDs сворачивает в unknown. Он наблюдает probing attempt/resource reference, а не факт установленного extension или успешного обнаружения ad blocker. Нет общей DOM bait/adblocking classifier; Firefox moz-extension probing здесь не реализован. Исходный отчёт detector.

## Response headers и Client Hints: полный перечень

ADR-039: отдельно от response-header presence при Pro сохраняются фактические значения исходящих технических заголовков: `User-Agent`, `Accept`, `Accept-Language`, `Accept-Encoding`, `DNT`, `Sec-GPC`, `Sec-CH-UA`, `Sec-CH-UA-Arch`, `Sec-CH-UA-Bitness`, `Sec-CH-UA-Full-Version`, `Sec-CH-UA-Full-Version-List`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Model`, `Sec-CH-UA-Platform`, `Sec-CH-UA-Platform-Version`, `Sec-CH-UA-WoW64`, `Sec-CH-UA-Form-Factors`, `Sec-CH-Prefers-Color-Scheme`, `Sec-CH-Prefers-Reduced-Motion`, `Sec-CH-Prefers-Reduced-Transparency`, `Sec-CH-Device-Memory`, `Sec-CH-DPR`, `Sec-CH-Viewport-Height`, `Sec-CH-Viewport-Width`, `Sec-CH-Width`, `Device-Memory`, `DPR`, `Viewport-Width`, `Width`, `Downlink`, `ECT`, `RTT`, `Save-Data`, `Sec-Fetch-Site`, `Sec-Fetch-Mode`, `Sec-Fetch-User`, `Sec-Fetch-Dest`, `Sec-Fetch-Storage-Access`. Всего 38 точных имён; main и third-party, только native document identity. Текущий Firefox adapter: unsupported. [Контракт](../../packages/contracts/src/pro-request-values.mjs).

Для 23 API Pro раскрывает поля составного результата в отдельные строки: `Navigator.languages`, `Navigator.plugins`, `Navigator.mimeTypes`, `NavigatorUAData.brands`, `NavigatorUAData.toJSON`, `Window.matchMedia`, `Element.getBoundingClientRect`, `Element.getClientRects`, `Range.getBoundingClientRect`, `Range.getClientRects`, `SVGGraphicsElement.getBBox`, `CanvasRenderingContext2D.measureText`, `OffscreenCanvasRenderingContext2D.measureText`, `WebGLRenderingContext.getSupportedExtensions`, `WebGL2RenderingContext.getSupportedExtensions`, `Intl.Collator.resolvedOptions`, `Intl.DateTimeFormat.resolvedOptions`, `Intl.NumberFormat.resolvedOptions`, `Intl.PluralRules.resolvedOptions`, `Intl.RelativeTimeFormat.resolvedOptions`, `Intl.ListFormat.resolvedOptions`, `Intl.Segmenter.resolvedOptions`, `Intl.DisplayNames.resolvedOptions`. Фиксированные native/own-data проекции без сериализации произвольных объектов; 128 полей / 8 KiB. Сводка объединяет все посещения и документы, включает все разные сохранённые варианты и имеет только № / имя / значение, 12 pt, новую страницу. [Контракт](../../packages/contracts/src/pro-technical-values.mjs), [ADR-039](../decisions/ADR-039.md), [проверка отчёта](pro-report-1.1.0.md).

Headers: `accept-ch`, `critical-ch`, `permissions-policy`, `feature-policy`, `nel`, `report-to`, `reporting-endpoints`, `secure-session-registration`, `sec-session-registration`, `secure-session-challenge`, `sec-session-challenge`, `use-as-dictionary`, `set-login`, `content-security-policy`, `strict-transport-security`, `cross-origin-opener-policy`, `cross-origin-embedder-policy`, `x-frame-options`.

Допустимые requested Client Hint names: `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`, `sec-ch-ua-arch`, `sec-ch-ua-bitness`, `sec-ch-ua-model`, `sec-ch-ua-platform-version`, `sec-ch-ua-full-version`, `sec-ch-ua-full-version-list`, `sec-ch-ua-wow64`, `sec-ch-ua-form-factors`, `device-memory`, `sec-ch-device-memory`, `dpr`, `sec-ch-dpr`, `width`, `sec-ch-width`, `viewport-width`, `sec-ch-viewport-width`, `sec-ch-viewport-height`, `rtt`, `downlink`, `ect`, `save-data`, `sec-ch-prefers-color-scheme`, `sec-ch-prefers-reduced-motion`, `sec-ch-prefers-reduced-transparency`.

Не-CH header values не раскрываются. Set-Login отражает наличие FedCM login-status заголовка без его состояния; CSP/HSTS/COOP/COEP/X-Frame-Options отражают наличие соответствующих политик. Наблюдение NEL/Reporting/DBSC/dictionary header не подтверждает исполнение механизма. DET-074 получает только browser-observed response evidence.

## Browser matrix и общие пробелы

| Контур | Chrome 153.0.8010.12 | Firefox 138.0.4 |
| --- | --- | --- |
| MAIN API hooks | Общая база; конкретный slot только при доступном interface/descriptor | Та же база; browser API support может отличаться |
| Native per-document network techniques/vendor headers | Browser document identity и grants | Network identity baseline unsupported; coverage network-limited/partial |
| Social/GTM/beacon | Page hooks + native network; GTM direct source | Page hooks / direct GTM currentScript / Resource Timing fallback; нет native body/outcome |
| Cookie metadata/explicit values | Optional cookies permission + выбранный store/partition | Optional cookies permission + browser partition semantics |
| Исходящие Cookie values в Pro | Native onSendHeaders + подтверждённый documentId; отдельная сводка при наличии строк | Unsupported в текущем adapter; сырой Cookie-сводки нет |
| Cookie restoration | Explicit native cookie test, owned positive/negative fixtures | Explicit native cookie test, owned fixtures; source attribution остаётся unknown |
| Background inventory | Readonly current-origin API при наличии поддержки | ISOLATED support отсутствует в проверенном FF 138, inventory unsupported/null |
| Pro/export/PDF projections | Metadata/value allowlist, localized report | Общая report база; network data зависит от источника |

Обе сборки зависят от предоставленного доступа к сайту/frames, времени установки hooks и сохранности wrappers. Retained originals, hooks заменённые страницей, недоступные sandbox/cross-origin documents, worker realms, поздние polyfills и budget overflow дают неполное покрытие. MAIN payload page-controlled; это не браузерная аттестация действительного результата. Полной гарантии наблюдения всех идентификационных механизмов нет.

Без production detector остаются DET-010 CSSOM/computed styles, DET-024 CSS math, DET-055 ETag persistence, DET-062 CNAME cloaking, DET-067 server TLS/HTTP/QUIC fingerprint, DET-068 pure CSS. В реализованных категориях не покрыты универсальная Math-классификация вне семи Pro-сигнатур, GPU buffer contents, Generic Sensor readings и данные motion events, QUIC/transport messages, внутренние Worker/SharedWorker/Worklet callbacks. Также отсутствуют DPI/MITM, browser history/login-state/uptime classifier, full DOM adblock detection, keylogging/session replay classifier, вероятность идентификации ~X / entropy score / итоговый A–F рейтинг. Известный Hotjar/Clarity/Pixel resource может быть распознан, но исполнение session replay или чтение клавиатуры из этого не выводится.

## Pro Math: семь точных сигнатур вне API registry

Во время активной Pro-записи hooks сравнивают только primitive number аргументы с фиксированными маркерами. В журнал поступают DET-022/023, фаза, count и api-use + known-numeric-pattern; аргументы и результаты не сохраняются. Другие Math вызовы отбрасываются. Вне Pro hooks снимаются с проверкой владения descriptor. Сигнатуры совпадают с конкретными числовыми вызовами и не определяют библиотеку или уникальность пользователя.

| DET | Операция | Фиксированные аргументы правила |
| --- | --- | --- |
| DET-022 | `Math.sin` | -1e+300 |
| DET-022 | `Math.cos` | 10.000000000123 |
| DET-022 | `Math.tan` | -1e+300 |
| DET-022 | `Math.acos` | 0.12312423423423424 |
| DET-022 | `Math.acosh` | 1e+308 |
| DET-022 | `Math.asin` | 0.12312423423423424 |
| DET-023 | `Math.pow` | 3.141592653589793, -100 |

## Приложение A: все 398 именованных API-операций

Это точный порядок API_OPERATION_DEFINITIONS в поставленном MAIN bundle. Вид get/call/async-call/construct/set описывает registry operation. Наличие slot не обещает существование интерфейса в каждом браузере; DET-051 put/add/result имеет описанный выше RTCCertificate admission.

| № registry (0-based) | DET | Operation | Mechanism | Kind |
| --- | --- | --- | --- | --- |
| 0 | DET-013 | `GPU.requestAdapter` | webgpu | async-call |
| 1 | DET-013 | `GPUAdapter.requestDevice` | webgpu | async-call |
| 2 | DET-013 | `GPUAdapter.info` | webgpu | get |
| 3 | DET-013 | `GPUAdapter.features` | webgpu | get |
| 4 | DET-013 | `GPUAdapter.limits` | webgpu | get |
| 5 | DET-013 | `GPUDevice.adapterInfo` | webgpu | get |
| 6 | DET-013 | `GPUDevice.features` | webgpu | get |
| 7 | DET-013 | `GPUDevice.limits` | webgpu | get |
| 8 | DET-013 | `GPUDevice.createShaderModule` | webgpu | call |
| 9 | DET-013 | `GPUDevice.createComputePipeline` | webgpu | call |
| 10 | DET-013 | `GPUDevice.createComputePipelineAsync` | webgpu | async-call |
| 11 | DET-013 | `GPUDevice.createRenderPipeline` | webgpu | call |
| 12 | DET-013 | `GPUDevice.createRenderPipelineAsync` | webgpu | async-call |
| 13 | DET-013 | `GPUShaderModule.getCompilationInfo` | webgpu | async-call |
| 14 | DET-013 | `GPUAdapterInfo.vendor` | webgpu | get |
| 15 | DET-013 | `GPUAdapterInfo.architecture` | webgpu | get |
| 16 | DET-013 | `GPUAdapterInfo.device` | webgpu | get |
| 17 | DET-013 | `GPUAdapterInfo.description` | webgpu | get |
| 18 | DET-013 | `GPUAdapterInfo.powerPreference` | webgpu | get |
| 19 | DET-013 | `GPUAdapterInfo.isFallbackAdapter` | webgpu | get |
| 20 | DET-013 | `GPUAdapterInfo.subgroupMinSize` | webgpu | get |
| 21 | DET-013 | `GPUAdapterInfo.subgroupMaxSize` | webgpu | get |
| 22 | DET-013 | `GPUAdapterInfo.type` | webgpu | get |
| 23 | DET-013 | `GPUAdapterInfo.backend` | webgpu | get |
| 24 | DET-013 | `GPUSupportedLimits.maxTextureDimension1D` | webgpu | get |
| 25 | DET-013 | `GPUSupportedLimits.maxTextureDimension2D` | webgpu | get |
| 26 | DET-013 | `GPUSupportedLimits.maxTextureDimension3D` | webgpu | get |
| 27 | DET-013 | `GPUSupportedLimits.maxTextureArrayLayers` | webgpu | get |
| 28 | DET-013 | `GPUSupportedLimits.maxBindGroups` | webgpu | get |
| 29 | DET-013 | `GPUSupportedLimits.maxBindGroupsPlusVertexBuffers` | webgpu | get |
| 30 | DET-013 | `GPUSupportedLimits.maxBindingsPerBindGroup` | webgpu | get |
| 31 | DET-013 | `GPUSupportedLimits.maxDynamicUniformBuffersPerPipelineLayout` | webgpu | get |
| 32 | DET-013 | `GPUSupportedLimits.maxDynamicStorageBuffersPerPipelineLayout` | webgpu | get |
| 33 | DET-013 | `GPUSupportedLimits.maxSampledTexturesPerShaderStage` | webgpu | get |
| 34 | DET-013 | `GPUSupportedLimits.maxSamplersPerShaderStage` | webgpu | get |
| 35 | DET-013 | `GPUSupportedLimits.maxStorageBuffersPerShaderStage` | webgpu | get |
| 36 | DET-013 | `GPUSupportedLimits.maxStorageTexturesPerShaderStage` | webgpu | get |
| 37 | DET-013 | `GPUSupportedLimits.maxUniformBuffersPerShaderStage` | webgpu | get |
| 38 | DET-013 | `GPUSupportedLimits.maxUniformBufferBindingSize` | webgpu | get |
| 39 | DET-013 | `GPUSupportedLimits.maxStorageBufferBindingSize` | webgpu | get |
| 40 | DET-013 | `GPUSupportedLimits.minUniformBufferOffsetAlignment` | webgpu | get |
| 41 | DET-013 | `GPUSupportedLimits.minStorageBufferOffsetAlignment` | webgpu | get |
| 42 | DET-013 | `GPUSupportedLimits.maxVertexBuffers` | webgpu | get |
| 43 | DET-013 | `GPUSupportedLimits.maxBufferSize` | webgpu | get |
| 44 | DET-013 | `GPUSupportedLimits.maxVertexAttributes` | webgpu | get |
| 45 | DET-013 | `GPUSupportedLimits.maxVertexBufferArrayStride` | webgpu | get |
| 46 | DET-013 | `GPUSupportedLimits.maxInterStageShaderComponents` | webgpu | get |
| 47 | DET-013 | `GPUSupportedLimits.maxInterStageShaderVariables` | webgpu | get |
| 48 | DET-013 | `GPUSupportedLimits.maxColorAttachments` | webgpu | get |
| 49 | DET-013 | `GPUSupportedLimits.maxColorAttachmentBytesPerSample` | webgpu | get |
| 50 | DET-013 | `GPUSupportedLimits.maxComputeWorkgroupStorageSize` | webgpu | get |
| 51 | DET-013 | `GPUSupportedLimits.maxComputeInvocationsPerWorkgroup` | webgpu | get |
| 52 | DET-013 | `GPUSupportedLimits.maxComputeWorkgroupSizeX` | webgpu | get |
| 53 | DET-013 | `GPUSupportedLimits.maxComputeWorkgroupSizeY` | webgpu | get |
| 54 | DET-013 | `GPUSupportedLimits.maxComputeWorkgroupSizeZ` | webgpu | get |
| 55 | DET-013 | `GPUSupportedLimits.maxComputeWorkgroupsPerDimension` | webgpu | get |
| 56 | DET-065 | `WebAssembly.compile` | wasm | async-call |
| 57 | DET-065 | `WebAssembly.instantiate` | wasm | async-call |
| 58 | DET-065 | `WebAssembly.compileStreaming` | wasm | async-call |
| 59 | DET-065 | `WebAssembly.instantiateStreaming` | wasm | async-call |
| 60 | DET-065 | `WebAssembly.validate` | wasm | call |
| 61 | DET-065 | `WebAssembly.Module` | wasm | construct |
| 62 | DET-065 | `WebAssembly.Instance` | wasm | construct |
| 63 | DET-065 | `WebAssembly.Memory` | wasm | construct |
| 64 | DET-065 | `WebAssembly.Memory.grow` | wasm | call |
| 65 | DET-065 | `WebAssembly.Memory.buffer` | wasm | get |
| 66 | DET-026 | `Navigator.userAgentData` | client-hints | get |
| 67 | DET-026 | `NavigatorUAData.brands` | client-hints | get |
| 68 | DET-026 | `NavigatorUAData.mobile` | client-hints | get |
| 69 | DET-026 | `NavigatorUAData.platform` | client-hints | get |
| 70 | DET-026 | `NavigatorUAData.getHighEntropyValues` | client-hints | async-call |
| 71 | DET-031 | `Screen.isExtended` | window-management | get |
| 72 | DET-031 | `Window.getScreenDetails` | window-management | async-call |
| 73 | DET-031 | `ScreenDetails.screens` | window-management | get |
| 74 | DET-031 | `ScreenDetails.currentScreen` | window-management | get |
| 75 | DET-031 | `ScreenDetailed.left` | window-management | get |
| 76 | DET-031 | `ScreenDetailed.top` | window-management | get |
| 77 | DET-031 | `Screen.availLeft` | window-management | get |
| 78 | DET-031 | `Screen.availTop` | window-management | get |
| 79 | DET-031 | `ScreenDetailed.devicePixelRatio` | window-management | get |
| 80 | DET-031 | `ScreenDetailed.label` | window-management | get |
| 81 | DET-031 | `ScreenDetailed.isPrimary` | window-management | get |
| 82 | DET-031 | `ScreenDetailed.isInternal` | window-management | get |
| 83 | DET-042 | `PressureObserver` | compute-pressure | construct |
| 84 | DET-042 | `PressureObserver.knownSources` | compute-pressure | get |
| 85 | DET-042 | `PressureObserver.observe` | compute-pressure | async-call |
| 86 | DET-042 | `PressureObserver.unobserve` | compute-pressure | call |
| 87 | DET-042 | `PressureObserver.disconnect` | compute-pressure | call |
| 88 | DET-042 | `PressureObserver.takeRecords` | compute-pressure | call |
| 89 | DET-042 | `PressureRecord.source` | compute-pressure | get |
| 90 | DET-042 | `PressureRecord.state` | compute-pressure | get |
| 91 | DET-042 | `PressureRecord.time` | compute-pressure | get |
| 92 | DET-043 | `IdleDetector` | idle-detection | construct |
| 93 | DET-043 | `IdleDetector.requestPermission` | idle-detection | async-call |
| 94 | DET-043 | `IdleDetector.start` | idle-detection | async-call |
| 95 | DET-043 | `IdleDetector.userState` | idle-detection | get |
| 96 | DET-043 | `IdleDetector.screenState` | idle-detection | get |
| 97 | DET-017 | `AudioContext` | audio | construct |
| 98 | DET-015 | `OfflineAudioContext` | audio | construct |
| 99 | DET-015 | `OfflineAudioContext.startRendering` | audio | async-call |
| 100 | DET-015 | `BaseAudioContext.createOscillator` | audio | call |
| 101 | DET-015 | `BaseAudioContext.createDynamicsCompressor` | audio | call |
| 102 | DET-015 | `BaseAudioContext.createAnalyser` | audio | call |
| 103 | DET-015 | `BaseAudioContext.createGain` | audio | call |
| 104 | DET-015 | `BaseAudioContext.createBiquadFilter` | audio | call |
| 105 | DET-015 | `BaseAudioContext.createBufferSource` | audio | call |
| 106 | DET-015 | `AudioNode.connect` | audio | call |
| 107 | DET-015 | `AudioScheduledSourceNode.start` | audio | call |
| 108 | DET-015 | `OscillatorNode` | audio | construct |
| 109 | DET-015 | `DynamicsCompressorNode` | audio | construct |
| 110 | DET-015 | `AnalyserNode` | audio | construct |
| 111 | DET-015 | `GainNode` | audio | construct |
| 112 | DET-016 | `AudioBuffer.getChannelData` | audio | call |
| 113 | DET-016 | `AudioBuffer.copyFromChannel` | audio | call |
| 114 | DET-016 | `AnalyserNode.getFloatFrequencyData` | audio | call |
| 115 | DET-016 | `AnalyserNode.getByteFrequencyData` | audio | call |
| 116 | DET-016 | `AnalyserNode.getFloatTimeDomainData` | audio | call |
| 117 | DET-016 | `AnalyserNode.getByteTimeDomainData` | audio | call |
| 118 | DET-017 | `BaseAudioContext.sampleRate` | audio | get |
| 119 | DET-017 | `BaseAudioContext.destination` | audio | get |
| 120 | DET-017 | `AudioContext.baseLatency` | audio | get |
| 121 | DET-017 | `AudioContext.outputLatency` | audio | get |
| 122 | DET-017 | `AudioDestinationNode.maxChannelCount` | audio | get |
| 123 | DET-029 | `Screen.width` | window-management | get |
| 124 | DET-029 | `Screen.height` | window-management | get |
| 125 | DET-029 | `Screen.availWidth` | window-management | get |
| 126 | DET-029 | `Screen.availHeight` | window-management | get |
| 127 | DET-029 | `Screen.colorDepth` | window-management | get |
| 128 | DET-029 | `Screen.pixelDepth` | window-management | get |
| 129 | DET-029 | `Screen.orientation` | window-management | get |
| 130 | DET-029 | `ScreenOrientation.angle` | window-management | get |
| 131 | DET-029 | `ScreenOrientation.type` | window-management | get |
| 132 | DET-030 | `Window.screenX` | window-management | get |
| 133 | DET-030 | `Window.screenY` | window-management | get |
| 134 | DET-030 | `Window.screenLeft` | window-management | get |
| 135 | DET-030 | `Window.screenTop` | window-management | get |
| 136 | DET-030 | `Window.outerWidth` | window-management | get |
| 137 | DET-030 | `Window.outerHeight` | window-management | get |
| 138 | DET-031 | `Element.requestFullscreen` | window-management | async-call |
| 139 | DET-031 | `Document.exitFullscreen` | window-management | async-call |
| 140 | DET-031 | `Window.open` | window-management | call |
| 141 | DET-031 | `Window.moveTo` | window-management | call |
| 142 | DET-031 | `Window.moveBy` | window-management | call |
| 143 | DET-031 | `Window.resizeTo` | window-management | call |
| 144 | DET-031 | `Window.resizeBy` | window-management | call |
| 145 | DET-031 | `Screen.onchange` | window-management | set |
| 146 | DET-031 | `ScreenDetails.onscreenschange` | window-management | set |
| 147 | DET-031 | `ScreenDetails.oncurrentscreenchange` | window-management | set |
| 148 | DET-031 | `Screen.addEventListener` | window-management | call |
| 149 | DET-031 | `Screen.removeEventListener` | window-management | call |
| 150 | DET-031 | `ScreenDetails.addEventListener` | window-management | call |
| 151 | DET-031 | `ScreenDetails.removeEventListener` | window-management | call |
| 152 | DET-042 | `PressureRecord.toJSON` | compute-pressure | call |
| 153 | DET-070 | `Navigator.ml` | webnn | get |
| 154 | DET-070 | `ML.createContext` | webnn | async-call |
| 155 | DET-070 | `MLContext.opSupportLimits` | webnn | call |
| 156 | DET-070 | `MLGraphBuilder` | webnn | construct |
| 157 | DET-070 | `MLGraphBuilder.input` | webnn | call |
| 158 | DET-070 | `MLGraphBuilder.constant` | webnn | call |
| 159 | DET-070 | `MLGraphBuilder.build` | webnn | async-call |
| 160 | DET-070 | `MLContext.createTensor` | webnn | async-call |
| 161 | DET-070 | `MLContext.readTensor` | webnn | async-call |
| 162 | DET-070 | `MLContext.writeTensor` | webnn | call |
| 163 | DET-070 | `MLContext.dispatch` | webnn | call |
| 164 | DET-070 | `MLContext.compute` | webnn | async-call |
| 165 | DET-070 | `MLContext.destroy` | webnn | call |
| 166 | DET-070 | `MLContext.lost` | webnn | get |
| 167 | DET-070 | `MLGraph.destroy` | webnn | call |
| 168 | DET-070 | `MLTensor.dataType` | webnn | get |
| 169 | DET-070 | `MLTensor.shape` | webnn | get |
| 170 | DET-070 | `MLTensor.readable` | webnn | get |
| 171 | DET-070 | `MLTensor.writable` | webnn | get |
| 172 | DET-070 | `MLTensor.constant` | webnn | get |
| 173 | DET-070 | `MLTensor.destroy` | webnn | call |
| 174 | DET-070 | `MLOperand.dataType` | webnn | get |
| 175 | DET-070 | `MLOperand.shape` | webnn | get |
| 176 | DET-070 | `MLGraphBuilder.add` | webnn | call |
| 177 | DET-070 | `MLGraphBuilder.sub` | webnn | call |
| 178 | DET-070 | `MLGraphBuilder.mul` | webnn | call |
| 179 | DET-070 | `MLGraphBuilder.div` | webnn | call |
| 180 | DET-070 | `MLGraphBuilder.matmul` | webnn | call |
| 181 | DET-070 | `MLGraphBuilder.gemm` | webnn | call |
| 182 | DET-070 | `MLGraphBuilder.conv2d` | webnn | call |
| 183 | DET-070 | `MLGraphBuilder.convTranspose2d` | webnn | call |
| 184 | DET-070 | `MLGraphBuilder.relu` | webnn | call |
| 185 | DET-070 | `MLGraphBuilder.sigmoid` | webnn | call |
| 186 | DET-070 | `MLGraphBuilder.softmax` | webnn | call |
| 187 | DET-070 | `MLGraphBuilder.reshape` | webnn | call |
| 188 | DET-070 | `MLGraphBuilder.transpose` | webnn | call |
| 189 | DET-070 | `MLGraphBuilder.concat` | webnn | call |
| 190 | DET-070 | `MLGraphBuilder.split` | webnn | call |
| 191 | DET-070 | `MLGraphBuilder.cast` | webnn | call |
| 192 | DET-070 | `MLGraphBuilder.reduceSum` | webnn | call |
| 193 | DET-070 | `MLGraphBuilder.reduceMean` | webnn | call |
| 194 | DET-070 | `MLGraphBuilder.gather` | webnn | call |
| 195 | DET-070 | `MLGraphBuilder.quantizeLinear` | webnn | call |
| 196 | DET-070 | `MLGraphBuilder.dequantizeLinear` | webnn | call |
| 197 | DET-020 | `RTCRtpSender.getCapabilities` | media-capabilities | call |
| 198 | DET-020 | `RTCRtpReceiver.getCapabilities` | media-capabilities | call |
| 199 | DET-020 | `HTMLMediaElement.canPlayType` | media-capabilities | call |
| 200 | DET-020 | `MediaSource.isTypeSupported` | media-capabilities | call |
| 201 | DET-020 | `MediaCapabilities.decodingInfo` | media-capabilities | async-call |
| 202 | DET-020 | `MediaCapabilities.encodingInfo` | media-capabilities | async-call |
| 203 | DET-020 | `AudioDecoder.isConfigSupported` | media-capabilities | async-call |
| 204 | DET-020 | `AudioEncoder.isConfigSupported` | media-capabilities | async-call |
| 205 | DET-020 | `VideoDecoder.isConfigSupported` | media-capabilities | async-call |
| 206 | DET-020 | `VideoEncoder.isConfigSupported` | media-capabilities | async-call |
| 207 | DET-020 | `ImageDecoder.isTypeSupported` | media-capabilities | async-call |
| 208 | DET-018 | `SpeechSynthesis.getVoices` | speech | call |
| 209 | DET-018 | `SpeechRecognition.available` | speech | async-call |
| 210 | DET-018 | `SpeechRecognition.install` | speech | async-call |
| 211 | DET-019 | `MediaDevices.enumerateDevices` | media-devices | async-call |
| 212 | DET-019 | `MediaDevices.getSupportedConstraints` | media-devices | call |
| 213 | DET-019 | `MediaDevices.getUserMedia` | media-devices | async-call |
| 214 | DET-019 | `MediaDevices.getDisplayMedia` | media-devices | async-call |
| 215 | DET-019 | `MediaStreamTrack.getCapabilities` | media-devices | call |
| 216 | DET-019 | `MediaStreamTrack.getSettings` | media-devices | call |
| 217 | DET-021 | `Navigator.requestMediaKeySystemAccess` | drm | async-call |
| 218 | DET-021 | `MediaKeySystemAccess.getConfiguration` | drm | call |
| 219 | DET-021 | `MediaKeySystemAccess.createMediaKeys` | drm | async-call |
| 220 | DET-021 | `MediaKeys.getStatusForPolicy` | drm | async-call |
| 221 | DET-045 | `Bluetooth.getAvailability` | device-access | async-call |
| 222 | DET-045 | `Bluetooth.getDevices` | device-access | async-call |
| 223 | DET-045 | `Bluetooth.requestDevice` | device-access | async-call |
| 224 | DET-046 | `USB.getDevices` | device-access | async-call |
| 225 | DET-046 | `USB.requestDevice` | device-access | async-call |
| 226 | DET-046 | `HID.getDevices` | device-access | async-call |
| 227 | DET-046 | `HID.requestDevice` | device-access | async-call |
| 228 | DET-046 | `Serial.getPorts` | device-access | async-call |
| 229 | DET-046 | `Serial.requestPort` | device-access | async-call |
| 230 | DET-032 | `Navigator.cpuPerformance` | browser-capabilities | get |
| 231 | DET-036 | `Intl.supportedValuesOf` | browser-capabilities | call |
| 232 | DET-066 | `PerformanceObserver.supportedEntryTypes` | browser-capabilities | get |
| 233 | DET-039 | `Notification.maxActions` | browser-capabilities | get |
| 234 | DET-071 | `LanguageModel.availability` | builtin-ai | async-call |
| 235 | DET-071 | `LanguageModel.params` | builtin-ai | async-call |
| 236 | DET-071 | `LanguageModel.create` | builtin-ai | async-call |
| 237 | DET-071 | `Translator.availability` | builtin-ai | async-call |
| 238 | DET-071 | `Translator.params` | builtin-ai | async-call |
| 239 | DET-071 | `Translator.create` | builtin-ai | async-call |
| 240 | DET-071 | `Summarizer.availability` | builtin-ai | async-call |
| 241 | DET-071 | `Summarizer.params` | builtin-ai | async-call |
| 242 | DET-071 | `Summarizer.create` | builtin-ai | async-call |
| 243 | DET-071 | `Writer.availability` | builtin-ai | async-call |
| 244 | DET-071 | `Writer.params` | builtin-ai | async-call |
| 245 | DET-071 | `Writer.create` | builtin-ai | async-call |
| 246 | DET-071 | `Rewriter.availability` | builtin-ai | async-call |
| 247 | DET-071 | `Rewriter.params` | builtin-ai | async-call |
| 248 | DET-071 | `Rewriter.create` | builtin-ai | async-call |
| 249 | DET-071 | `LanguageDetector.availability` | builtin-ai | async-call |
| 250 | DET-071 | `LanguageDetector.params` | builtin-ai | async-call |
| 251 | DET-071 | `LanguageDetector.create` | builtin-ai | async-call |
| 252 | DET-071 | `Proofreader.availability` | builtin-ai | async-call |
| 253 | DET-071 | `Proofreader.params` | builtin-ai | async-call |
| 254 | DET-071 | `Proofreader.create` | builtin-ai | async-call |
| 255 | DET-071 | `LanguageModel.prompt` | builtin-ai | async-call |
| 256 | DET-071 | `LanguageModel.promptStreaming` | builtin-ai | call |
| 257 | DET-071 | `Translator.translate` | builtin-ai | async-call |
| 258 | DET-071 | `Translator.translateStreaming` | builtin-ai | call |
| 259 | DET-071 | `Summarizer.summarize` | builtin-ai | async-call |
| 260 | DET-071 | `Summarizer.summarizeStreaming` | builtin-ai | call |
| 261 | DET-071 | `Writer.write` | builtin-ai | async-call |
| 262 | DET-071 | `Writer.writeStreaming` | builtin-ai | call |
| 263 | DET-071 | `Rewriter.rewrite` | builtin-ai | async-call |
| 264 | DET-071 | `Rewriter.rewriteStreaming` | builtin-ai | call |
| 265 | DET-071 | `LanguageDetector.detect` | builtin-ai | async-call |
| 266 | DET-071 | `Proofreader.proofread` | builtin-ai | async-call |
| 267 | DET-072 | `Navigator.queryHandwritingRecognizer` | recognition | async-call |
| 268 | DET-072 | `Navigator.createHandwritingRecognizer` | recognition | async-call |
| 269 | DET-072 | `BarcodeDetector` | recognition | construct |
| 270 | DET-072 | `BarcodeDetector.getSupportedFormats` | recognition | async-call |
| 271 | DET-072 | `BarcodeDetector.detect` | recognition | async-call |
| 272 | DET-072 | `FaceDetector` | recognition | construct |
| 273 | DET-072 | `FaceDetector.detect` | recognition | async-call |
| 274 | DET-072 | `TextDetector` | recognition | construct |
| 275 | DET-072 | `TextDetector.detect` | recognition | async-call |
| 276 | DET-073 | `Navigator.getInstalledRelatedApps` | app-integration | async-call |
| 277 | DET-073 | `Navigator.registerProtocolHandler` | app-integration | call |
| 278 | DET-073 | `Navigator.unregisterProtocolHandler` | app-integration | call |
| 279 | DET-073 | `Window.getDigitalGoodsService` | app-integration | async-call |
| 280 | DET-073 | `Navigator.locks` | app-integration | get |
| 281 | DET-073 | `LockManager.query` | app-integration | async-call |
| 282 | DET-073 | `LockManager.request` | app-integration | async-call |
| 283 | DET-073 | `Navigator.setAppBadge` | app-integration | async-call |
| 284 | DET-073 | `Navigator.clearAppBadge` | app-integration | async-call |
| 285 | DET-073 | `Navigator.canShare` | app-integration | call |
| 286 | DET-073 | `Navigator.share` | app-integration | async-call |
| 287 | DET-073 | `Window.showOpenFilePicker` | app-integration | async-call |
| 288 | DET-073 | `Window.showSaveFilePicker` | app-integration | async-call |
| 289 | DET-073 | `Window.showDirectoryPicker` | app-integration | async-call |
| 290 | DET-073 | `StorageManager.getDirectory` | app-integration | async-call |
| 291 | DET-073 | `FileSystemHandle.queryPermission` | app-integration | async-call |
| 292 | DET-073 | `FileSystemHandle.requestPermission` | app-integration | async-call |
| 293 | DET-073 | `PushManager.permissionState` | app-integration | async-call |
| 294 | DET-073 | `PushManager.getSubscription` | app-integration | async-call |
| 295 | DET-073 | `PushManager.subscribe` | app-integration | async-call |
| 296 | DET-073 | `SyncManager.register` | app-integration | async-call |
| 297 | DET-073 | `SyncManager.getTags` | app-integration | async-call |
| 298 | DET-073 | `PeriodicSyncManager.register` | app-integration | async-call |
| 299 | DET-073 | `PeriodicSyncManager.getTags` | app-integration | async-call |
| 300 | DET-073 | `PeriodicSyncManager.unregister` | app-integration | async-call |
| 301 | DET-073 | `BackgroundFetchManager.fetch` | app-integration | async-call |
| 302 | DET-073 | `BackgroundFetchManager.get` | app-integration | async-call |
| 303 | DET-073 | `BackgroundFetchManager.getIds` | app-integration | async-call |
| 304 | DET-073 | `Navigation.navigate` | app-integration | call |
| 305 | DET-073 | `Navigation.reload` | app-integration | call |
| 306 | DET-073 | `Navigation.back` | app-integration | call |
| 307 | DET-073 | `Navigation.forward` | app-integration | call |
| 308 | DET-073 | `Navigation.traverseTo` | app-integration | call |
| 309 | DET-073 | `CloseWatcher` | app-integration | construct |
| 310 | DET-073 | `CloseWatcher.requestClose` | app-integration | call |
| 311 | DET-073 | `CloseWatcher.close` | app-integration | call |
| 312 | DET-073 | `CloseWatcher.destroy` | app-integration | call |
| 313 | DET-073 | `HTMLElement.showPopover` | app-integration | call |
| 314 | DET-073 | `HTMLElement.hidePopover` | app-integration | call |
| 315 | DET-073 | `HTMLElement.togglePopover` | app-integration | call |
| 316 | DET-073 | `Navigator.ink` | app-integration | get |
| 317 | DET-073 | `Ink.requestPresenter` | app-integration | async-call |
| 318 | DET-073 | `TrustedTypePolicyFactory.createPolicy` | app-integration | call |
| 319 | DET-073 | `TrustedTypePolicyFactory.isHTML` | app-integration | call |
| 320 | DET-073 | `TrustedTypePolicyFactory.isScript` | app-integration | call |
| 321 | DET-073 | `TrustedTypePolicyFactory.isScriptURL` | app-integration | call |
| 322 | DET-073 | `TrustedTypePolicyFactory.getAttributeType` | app-integration | call |
| 323 | DET-073 | `TrustedTypePolicyFactory.getPropertyType` | app-integration | call |
| 324 | DET-039 | `Permissions.query` | browser-capabilities | async-call |
| 325 | DET-056 | `RTCPeerConnection` | webrtc | construct |
| 326 | DET-056 | `RTCPeerConnection.generateCertificate` | webrtc | async-call |
| 327 | DET-056 | `RTCPeerConnection.createOffer` | webrtc | async-call |
| 328 | DET-056 | `RTCPeerConnection.createAnswer` | webrtc | async-call |
| 329 | DET-056 | `RTCPeerConnection.setLocalDescription` | webrtc | async-call |
| 330 | DET-056 | `RTCPeerConnection.setRemoteDescription` | webrtc | async-call |
| 331 | DET-056 | `RTCPeerConnection.addIceCandidate` | webrtc | async-call |
| 332 | DET-056 | `RTCPeerConnection.createDataChannel` | webrtc | call |
| 333 | DET-056 | `RTCPeerConnection.addTrack` | webrtc | call |
| 334 | DET-056 | `RTCPeerConnection.removeTrack` | webrtc | call |
| 335 | DET-056 | `RTCPeerConnection.addTransceiver` | webrtc | call |
| 336 | DET-056 | `RTCPeerConnection.getConfiguration` | webrtc | call |
| 337 | DET-056 | `RTCPeerConnection.setConfiguration` | webrtc | call |
| 338 | DET-056 | `RTCPeerConnection.restartIce` | webrtc | call |
| 339 | DET-056 | `RTCPeerConnection.close` | webrtc | call |
| 340 | DET-056 | `RTCPeerConnection.getSenders` | webrtc | call |
| 341 | DET-056 | `RTCPeerConnection.getReceivers` | webrtc | call |
| 342 | DET-056 | `RTCPeerConnection.getTransceivers` | webrtc | call |
| 343 | DET-056 | `RTCPeerConnection.connectionState` | webrtc | get |
| 344 | DET-056 | `RTCPeerConnection.iceConnectionState` | webrtc | get |
| 345 | DET-056 | `RTCPeerConnection.iceGatheringState` | webrtc | get |
| 346 | DET-056 | `RTCPeerConnection.signalingState` | webrtc | get |
| 347 | DET-056 | `RTCPeerConnection.canTrickleIceCandidates` | webrtc | get |
| 348 | DET-057 | `RTCPeerConnection.localDescription` | webrtc | get |
| 349 | DET-057 | `RTCPeerConnection.currentLocalDescription` | webrtc | get |
| 350 | DET-057 | `RTCPeerConnection.pendingLocalDescription` | webrtc | get |
| 351 | DET-057 | `RTCPeerConnection.remoteDescription` | webrtc | get |
| 352 | DET-057 | `RTCPeerConnection.currentRemoteDescription` | webrtc | get |
| 353 | DET-057 | `RTCPeerConnection.pendingRemoteDescription` | webrtc | get |
| 354 | DET-057 | `RTCPeerConnection.getStats` | webrtc | async-call |
| 355 | DET-057 | `RTCSessionDescription.sdp` | webrtc | get |
| 356 | DET-057 | `RTCSessionDescription.type` | webrtc | get |
| 357 | DET-057 | `RTCSessionDescription.toJSON` | webrtc | call |
| 358 | DET-057 | `RTCCertificate.getFingerprints` | webrtc | call |
| 359 | DET-057 | `RTCCertificate.expires` | webrtc | get |
| 360 | DET-020 | `RTCRtpSender.getParameters` | webrtc | call |
| 361 | DET-020 | `RTCRtpReceiver.getParameters` | webrtc | call |
| 362 | DET-057 | `RTCRtpSender.getStats` | webrtc | async-call |
| 363 | DET-057 | `RTCRtpReceiver.getStats` | webrtc | async-call |
| 364 | DET-057 | `RTCStatsReport.get` | webrtc | call |
| 365 | DET-057 | `RTCStatsReport.values` | webrtc | call |
| 366 | DET-057 | `RTCStatsReport.entries` | webrtc | call |
| 367 | DET-057 | `RTCStatsReport.forEach` | webrtc | call |
| 368 | DET-051 | `IDBObjectStore.put` | webrtc | call |
| 369 | DET-051 | `IDBObjectStore.add` | webrtc | call |
| 370 | DET-051 | `IDBRequest.result` | webrtc | get |
| 371 | DET-042 | `Accelerometer` | device-sensor | construct |
| 372 | DET-042 | `Gyroscope` | device-sensor | construct |
| 373 | DET-042 | `LinearAccelerationSensor` | device-sensor | construct |
| 374 | DET-042 | `GravitySensor` | device-sensor | construct |
| 375 | DET-042 | `Magnetometer` | device-sensor | construct |
| 376 | DET-042 | `AbsoluteOrientationSensor` | device-sensor | construct |
| 377 | DET-042 | `RelativeOrientationSensor` | device-sensor | construct |
| 378 | DET-058 | `WebTransport` | webtransport | construct |
| 379 | DET-069 | `CredentialsContainer.create` | webauthn | async-call |
| 380 | DET-069 | `Clipboard.read` | clipboard | async-call |
| 381 | DET-069 | `Clipboard.readText` | clipboard | async-call |
| 382 | DET-069 | `Clipboard.write` | clipboard | async-call |
| 383 | DET-069 | `Clipboard.writeText` | clipboard | async-call |
| 384 | DET-014 | `GPUBuffer.mapAsync` | webgpu | async-call |
| 385 | DET-014 | `GPUBuffer.getMappedRange` | webgpu | call |
| 386 | DET-014 | `GPUBuffer.unmap` | webgpu | call |
| 387 | DET-042 | `Window.addEventListener.deviceorientation` | device-sensor | call |
| 388 | DET-042 | `Window.ondeviceorientation` | device-sensor | set |
| 389 | DET-042 | `Window.addEventListener.devicemotion` | device-sensor | call |
| 390 | DET-042 | `Window.ondevicemotion` | device-sensor | set |
| 391 | DET-042 | `Window.addEventListener.deviceorientationabsolute` | device-sensor | call |
| 392 | DET-042 | `Window.ondeviceorientationabsolute` | device-sensor | set |
| 393 | DET-064 | `Worker` | worker | construct |
| 394 | DET-064 | `SharedWorker` | worker | construct |
| 395 | DET-064 | `Worklet.addModule` | worker | async-call |
| 396 | DET-049 | `Document.cookie.get` | storage | get |
| 397 | DET-049 | `Document.cookie.set` | storage | set |

## Приложение B: прежние именованные поверхности вне registry

Эти hooks присутствуют в отдельных installers и дополняют таблицу 398 операций. Нижеприведённый перечень развёрнут из проверенных installers. Auxiliary getContext/clear/reset/dimensions/visual actions служат связыванию Canvas и описаны отдельно; XHR.open подготавливает контекст, не самостоятельный request count. Math здесь ограничен перечисленными Pro-сигнатурами.

| DET | Поверхности |
| --- | --- |
| DET-001 | `HTMLCanvasElement.toDataURL`; `HTMLCanvasElement.toBlob` |
| DET-002 | `CanvasRenderingContext2D.getImageData` |
| DET-003 | `CanvasRenderingContext2D.measureText`; `CanvasRenderingContext2D.fillText`; `CanvasRenderingContext2D.strokeText`; `OffscreenCanvasRenderingContext2D.measureText`; `OffscreenCanvasRenderingContext2D.fillText`; `OffscreenCanvasRenderingContext2D.strokeText` |
| DET-004 | `OffscreenCanvas.convertToBlob`; `OffscreenCanvasRenderingContext2D.getImageData` |
| DET-005 | `Element.getClientRects`; `Element.getBoundingClientRect`; `HTMLElement.offsetWidth`; `HTMLElement.offsetHeight` |
| DET-006 | `Range.getClientRects`; `Range.getBoundingClientRect` |
| DET-007 | `SVGGraphicsElement.getBBox`; `SVGTextContentElement.getComputedTextLength`; `SVGTextContentElement.getSubStringLength` |
| DET-008 | `FontFaceSet.check`; `FontFaceSet.load`; `FontFaceSet.values`; `FontFaceSet.keys`; `FontFaceSet.entries`; `FontFaceSet.forEach`; `FontFaceSet.[Symbol.iterator]` |
| DET-009 | `Window.queryLocalFonts` |
| DET-011 | `WebGLRenderingContext.getParameter`; `WebGLRenderingContext.getExtension`; `WebGLRenderingContext.getSupportedExtensions`; `WebGLRenderingContext.getShaderPrecisionFormat`; `WebGL2RenderingContext.getParameter`; `WebGL2RenderingContext.getExtension`; `WebGL2RenderingContext.getSupportedExtensions`; `WebGL2RenderingContext.getShaderPrecisionFormat`; `WebGLShaderPrecisionFormat.rangeMin`; `WebGLShaderPrecisionFormat.rangeMax`; `WebGLShaderPrecisionFormat.precision` |
| DET-012 | `WebGLRenderingContext.readPixels`; `WebGL2RenderingContext.readPixels` |
| DET-015 | `webkitOfflineAudioContext (OfflineAudioContext alias)` |
| DET-017 | `webkitAudioContext (AudioContext alias)` |
| DET-022 | `Math.sin (Pro signature only)`; `Math.cos (Pro signature only)`; `Math.tan (Pro signature only)`; `Math.acos (Pro signature only)`; `Math.acosh (Pro signature only)`; `Math.asin (Pro signature only)` |
| DET-023 | `Math.pow (Pro signature only)` |
| DET-025 | `Navigator.userAgent`; `Navigator.platform`; `Navigator.vendor`; `Navigator.language`; `Navigator.languages`; `Navigator.appVersion`; `Navigator.appName`; `Navigator.appCodeName`; `Navigator.product`; `Navigator.productSub`; `Navigator.vendorSub` |
| DET-027 | `Navigator.plugins`; `Navigator.mimeTypes`; `Navigator.pdfViewerEnabled` |
| DET-028 | `Navigator.webdriver` |
| DET-030 | `Window.innerWidth`; `Window.innerHeight`; `Window.devicePixelRatio`; `Window.visualViewport`; `VisualViewport.offsetLeft`; `VisualViewport.offsetTop`; `VisualViewport.pageLeft`; `VisualViewport.pageTop`; `VisualViewport.width`; `VisualViewport.height`; `VisualViewport.scale` |
| DET-032 | `Navigator.hardwareConcurrency` |
| DET-033 | `Navigator.deviceMemory` |
| DET-034 | `Navigator.maxTouchPoints` |
| DET-035 | `Date.prototype.getTimezoneOffset` |
| DET-036 | `Intl.Collator.resolvedOptions`; `Intl.DateTimeFormat.resolvedOptions`; `Intl.NumberFormat.resolvedOptions`; `Intl.PluralRules.resolvedOptions`; `Intl.RelativeTimeFormat.resolvedOptions`; `Intl.ListFormat.resolvedOptions`; `Intl.Segmenter.resolvedOptions`; `Intl.DisplayNames.resolvedOptions` |
| DET-037 | `Window.matchMedia` |
| DET-038 | `CSS.supports` |
| DET-039 | `PermissionStatus.state`; `Notification.permission`; `FeaturePolicy.allowsFeature`; `FeaturePolicy.features`; `FeaturePolicy.allowedFeatures`; `FeaturePolicy.getAllowlistForFeature`; `PermissionsPolicy.allowsFeature`; `PermissionsPolicy.features`; `PermissionsPolicy.allowedFeatures`; `PermissionsPolicy.getAllowlistForFeature` |
| DET-040 | `Navigator.getBattery`; `BatteryManager.charging`; `BatteryManager.chargingTime`; `BatteryManager.dischargingTime`; `BatteryManager.level` |
| DET-041 | `Navigator.connection`; `NetworkInformation.type`; `NetworkInformation.effectiveType`; `NetworkInformation.rtt`; `NetworkInformation.downlink`; `NetworkInformation.downlinkMax`; `NetworkInformation.saveData` |
| DET-043 | `EventTarget.addEventListener(mousemove/pointermove/pointerrawupdate)`; `Window.onmousemove`; `Window.onpointermove`; `Window.onpointerrawupdate`; `Document.onmousemove`; `Document.onpointermove`; `Document.onpointerrawupdate`; `HTMLElement.onmousemove`; `HTMLElement.onpointermove`; `HTMLElement.onpointerrawupdate`; `SVGElement.onmousemove`; `SVGElement.onpointermove`; `SVGElement.onpointerrawupdate`; `MathMLElement.onmousemove`; `MathMLElement.onpointermove`; `MathMLElement.onpointerrawupdate`; `MouseEvent.clientX`; `MouseEvent.clientY`; `MouseEvent.screenX`; `MouseEvent.screenY`; `MouseEvent.pageX`; `MouseEvent.pageY`; `MouseEvent.offsetX`; `MouseEvent.offsetY`; `MouseEvent.movementX`; `MouseEvent.movementY`; `MouseEvent.x`; `MouseEvent.y` |
| DET-044 | `Geolocation.getCurrentPosition`; `Geolocation.watchPosition` |
| DET-047 | `Navigator.getGamepads` |
| DET-048 | `XRSystem.isSessionSupported`; `XRSystem.requestSession` |
| DET-049 | `CookieStore.get`; `CookieStore.getAll`; `CookieStore.set`; `CookieStore.delete` |
| DET-050 | `Storage.getItem`; `Storage.setItem`; `Storage.removeItem`; `Storage.clear`; `Storage.key` |
| DET-051 | `IDBFactory.open`; `IDBFactory.deleteDatabase`; `IDBFactory.databases` |
| DET-052 | `CacheStorage.open`; `CacheStorage.match`; `CacheStorage.has`; `CacheStorage.delete`; `CacheStorage.keys`; `Cache.match`; `Cache.matchAll`; `Cache.add`; `Cache.addAll`; `Cache.put`; `Cache.delete`; `Cache.keys` |
| DET-053 | `StorageManager.estimate`; `StorageManager.persist`; `StorageManager.persisted` |
| DET-054 | `Document.hasStorageAccess`; `Document.requestStorageAccess`; `Document.hasUnpartitionedCookieAccess`; `Document.requestStorageAccessFor` |
| DET-056 | `webkitRTCPeerConnection (RTCPeerConnection alias)` |
| DET-057 | `RTCIceCandidate.candidate`; `RTCIceCandidate.sdpMid`; `RTCIceCandidate.sdpMLineIndex`; `RTCIceCandidate.foundation`; `RTCIceCandidate.component`; `RTCIceCandidate.priority`; `RTCIceCandidate.address`; `RTCIceCandidate.protocol`; `RTCIceCandidate.port`; `RTCIceCandidate.type`; `RTCIceCandidate.tcpType`; `RTCIceCandidate.relatedAddress`; `RTCIceCandidate.relatedPort`; `RTCIceCandidate.usernameFragment`; `RTCPeerConnectionIceEvent.candidate` |
| DET-059 | `Window.fetch`; `XMLHttpRequest.open (context preparation)`; `XMLHttpRequest.send`; `Navigator.sendBeacon`; `HTMLImageElement.src (extension-resource / social)`; `HTMLScriptElement.src (extension-resource / loader / social)`; `CredentialsContainer.get` |
| DET-063 | `ServiceWorkerContainer.register`; `ServiceWorkerContainer.getRegistration`; `ServiceWorkerContainer.getRegistrations` |
| DET-066 | `Performance.now (1/64)`; `Date.now (1/64)`; `Performance.mark`; `Performance.measure`; `Performance.getEntries`; `Performance.getEntriesByName`; `Performance.getEntriesByType` |
| DET-069 | `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable`; `PublicKeyCredential.isConditionalMediationAvailable`; `PublicKeyCredential.getClientCapabilities` |

## Приложение C: точная RTC values allowlist

Ниже перечислены фактически разрешённые поля и источники. getStats Promise не перехватывается: stats metadata берётся из возвращённого RTCStatsReport.get при наблюдаемом чтении. Certificate fingerprints SHA-256/384/512 и expiry — разрешённые технические значения; ключ и raw certificate не читаются. IDB certificate-storage показывает только распознанные native RTCCertificate operations.

| Операция / источник | Profile |
| --- | --- |
| `RTCPeerConnection.getConfiguration` | configuration |
| `RTCPeerConnection.configurationSnapshot` | configuration |
| `RTCCertificate.getFingerprints` | certificate |
| `RTCRtpSender.getCapabilities` | capabilities |
| `RTCRtpReceiver.getCapabilities` | capabilities |
| `RTCRtpSender.getParameters` | capabilities |
| `RTCRtpReceiver.getParameters` | capabilities |
| `RTCSessionDescription.sdp` | description |
| `RTCSessionDescription.toJSON` | description |
| `RTCStatsReport.get` | stats |
| `IDBObjectStore.put` | certificate-storage |
| `IDBObjectStore.add` | certificate-storage |
| `IDBRequest.result` | certificate-storage |
| `MediaStreamTrack.getSettings` | media-settings |

| Поле | Тип | Enum / maximum / pattern |
| --- | --- | --- |
| `codec.mimeType` | enum | audio/opus, audio/PCMU, audio/PCMA, audio/G722, audio/ISAC, audio/CN, audio/telephone-event, audio/red, video/VP8, video/VP9, video/H264, video/H265, video/AV1, video/rtx, video/red, video/ulpfec, video/flexfec-03 |
| `codec.clockRate` | integer | 384000 |
| `codec.channels` | integer | 32 |
| `codec.payloadType` | integer | 127 |
| `codec.mediaSection` | integer | 31 |
| `codec.parameters` | pattern | `^(?:(?:apt\|level-asymmetry-allowed\|packetization-mode\|profile-id\|level-id\|tier-flag\|minptime\|maxplaybackrate\|sprop-maxcapturerate\|stereo\|sprop-stereo\|useinbandfec\|usedtx\|maxaveragebitrate\|max-fr\|tx-mode\|L\|D\|repair-window)=[0-9]{1,9}\|profile-level-id=[A-Fa-f0-9]{6})(?:;(?:(?:apt\|level-asymmetry-allowed\|packetization-mode\|profile-id\|level-id\|tier-flag\|minptime\|maxplaybackrate\|sprop-maxcapturerate\|stereo\|sprop-stereo\|useinbandfec\|usedtx\|maxaveragebitrate\|max-fr\|tx-mode\|L\|D\|repair-window)=[0-9]{1,9}\|profile-level-id=[A-Fa-f0-9]{6})){0,15}$`; max 256 |
| `headerExtension.uri` | enum | urn:ietf:params:rtp-hdrext:ssrc-audio-level, urn:ietf:params:rtp-hdrext:csrc-audio-level, urn:ietf:params:rtp-hdrext:sdes:mid, urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id, urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id, urn:ietf:params:rtp-hdrext:toffset, urn:3gpp:video-orientation, http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time, http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01, http://www.webrtc.org/experiments/rtp-hdrext/playout-delay, http://www.webrtc.org/experiments/rtp-hdrext/video-content-type, http://www.webrtc.org/experiments/rtp-hdrext/video-timing, http://www.webrtc.org/experiments/rtp-hdrext/color-space, http://www.webrtc.org/experiments/rtp-hdrext/abs-capture-time, http://www.webrtc.org/experiments/rtp-hdrext/video-layers-allocation00, https://aomediacodec.github.io/av1-rtp-spec/#dependency-descriptor-rtp-header-extension |
| `headerExtension.id` | integer | 255 |
| `headerExtension.mediaSection` | integer | 31 |
| `description.type` | enum | offer, answer, pranswer, rollback |
| `media.kind` | enum | audio, video, application |
| `media.protocol` | enum | UDP/TLS/RTP/SAVPF, RTP/SAVPF, UDP/DTLS/SCTP, DTLS/SCTP |
| `media.payloadTypes` | pattern | `^(?:[0-9]\|[1-9][0-9]\|1[01][0-9]\|12[0-7])(?: (?:[0-9]\|[1-9][0-9]\|1[01][0-9]\|12[0-7])){0,31}$`; max 127 |
| `media.direction` | enum | sendrecv, sendonly, recvonly, inactive |
| `media.rtcpMux` | boolean | — |
| `dtls.setup` | enum | active, passive, actpass, holdconn |
| `certificate.sha-256` | pattern | `^[A-Fa-f0-9]{2}(?::[A-Fa-f0-9]{2}){31}$`; max 95 |
| `certificate.sha-384` | pattern | `^[A-Fa-f0-9]{2}(?::[A-Fa-f0-9]{2}){47}$`; max 143 |
| `certificate.sha-512` | pattern | `^[A-Fa-f0-9]{2}(?::[A-Fa-f0-9]{2}){63}$`; max 191 |
| `certificate.expires` | integer | 8640000000000000 |
| `configuration.bundlePolicy` | enum | balanced, max-compat, max-bundle |
| `configuration.iceTransportPolicy` | enum | all, relay |
| `configuration.rtcpMuxPolicy` | enum | require, negotiate |
| `configuration.iceCandidatePoolSize` | integer | 255 |
| `configuration.certificates` | integer | 32 |
| `storage.operation` | enum | put, add, result |
| `storage.completion` | enum | request-returned, value-returned |
| `stats.type` | enum | codec, inbound-rtp, outbound-rtp, certificate, transport, peer-connection, data-channel |
| `stats.encoderImplementation` | enum | libvpx, OpenH264, ExternalEncoder, ExternalEncoder (Unknown), VideoToolbox, MediaCodec |
| `stats.decoderImplementation` | enum | libvpx, OpenH264, ExternalDecoder, ExternalDecoder (Unknown), VideoToolbox, MediaCodec, FFmpeg, libaom, dav1d |
| `stats.powerEfficientEncoder` | boolean | — |
| `stats.powerEfficientDecoder` | boolean | — |
| `stats.dtlsState` | enum | new, connecting, connected, closed, failed |
| `media.width` | integer | 65535 |
| `media.height` | integer | 65535 |
| `media.frameRate` | number | 10000 |
| `media.aspectRatio` | number | 65535 |
| `media.sampleRate` | integer | 384000 |
| `media.sampleSize` | integer | 128 |
| `media.channelCount` | integer | 32 |
| `media.echoCancellation` | boolean | — |
| `media.noiseSuppression` | boolean | — |
| `media.autoGainControl` | boolean | — |

## Фиксация версии и проверка списка

| Архив | Bytes | SHA-256 |
| --- | --- | --- |
| release/Detect.Expert-1.1.0-chrome.zip | 8539428 | `c5e6acbc3ec62200c157be55800a3dc27d93af0a804b15985e83ef662c165dc9` |
| release/Detect.Expert-1.1.0-firefox.zip | 8561245 | `27050a0cc6ef7a98a7f4cc8a3c77f4733bfc06c948b084c3f3ed349a81667f39` |

Source hashes основных hooks/observers включены в JSON. Команда node .tmp/build-fingerprinting-inventory.mjs: PASS. Выполнены source-marker/cardinality assertions, сверка 74 ID / 398 unique operations / 7 Pro Math signatures / 18 header names / 32 products / 61 resource rules / 2 RTC hints / 45 Social providers / 128 extension targets / 35 visual markers, одинаковых MAIN/early hashes в обоих browser packages и фактических byte sizes/SHA-256 двух release ZIP. Эта проверка является инвентаризацией исходников; результаты исполнения API приводятся отдельно.

Последняя зафиксированная проверка release: 1157 Vitest + 1528 Node = 2685 unit tests, failures 0, skipped 0; native acceptance Chrome/Firefox и конкретные границы перечислены в release evidence. В ходе генерации этой документации runtime suite повторно не запускается; берутся результаты зафиксированного release.

Вопросы для внешнего review: полнота installed hooks против таблиц; API semantics/once-only original calls; false positives Canvas/DNS/local-port patterns; conditional API support; document identity/Firefox gaps; redaction и Pro value allowlist; vendor matcher scope/review dates; cookie source/conflict semantics; совместимость старых Pro-записей после удаления DBSC; causal attribution GTM/script и границы background/cookie restoration.
