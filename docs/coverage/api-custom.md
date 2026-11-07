# Custom API — покрытие

Актуальное дополнение 2026-11-01: [native CSS/layout, dedicated Worker и private
Promise backend](fingerprint-engine-boundaries.md),
[ADR-101](../decisions/ADR-101-fingerprint-engine-boundaries.md).
Режим «Нативная сессия» применяется явно в собственном окне Chrome; он не
приравнивает обычные вкладки или Firefox к полной эмуляции движка (с 2026-11-05 панель
запуска снята с вкладки Antidetect, [ADR-104](../decisions/ADR-104-antidetect-privacy-rework.md)). UAData и
Window MediaCapabilities имеют отдельные новые границы, описанные по ссылке.

Продолжение 2026-11-01: [Temporal defaults, JS media queries и ограниченные async guards](fingerprint-continuation.md), [ADR-100](../decisions/ADR-100-fingerprint-continuation.md). Это дополняет прежние границы; полная Worker/CSS-engine/native-Promise изоляция не заявляется.

Текущее уточнение по [ADR-095](../decisions/ADR-095-fingerprint-audit-correctness.md):
[исправления, шесть браузерных прогонов и границы доказательств](fingerprint-production-audit.md).
Закрыты post-return constructor/species-пути, три проверенных пути вставки iframe,
ошибки семантики Media/Intl/Date/Math/WebGL и генератора Block. RTC получил отдельный
preflight и проверку после native-driven чтений RTCOfferOptions. Исходная identity
объекта options заменяется приватным Proxy; deferred backend assimilation остаётся открытой.
Хронология ниже описывает и прежние состояния: актуальность каждого старого PASS
нужно сверять по SHA. Точные исходные 280 входов целиком не исполнялись;
полная подмена и статистическая естественность не подтверждены.

Расширение 07.11.2026 по [ADR-112](../decisions/ADR-112-canvas-sparse-v2.md) (формат 10 / каталог 11, 158 строк, 56 Custom; format9/catalog10 — состояние раунда 5, заморожен побайтно): Canvas `sparse-rgb-v2` (первый пресет; `sparse-rgb-v1` и `stable-rgb-v1` остаются допустимыми сохранёнными значениями), экспорт WebGL-холста по правилу 2D, `WEBGL_lose_context` не скрывается строкой `webgl-capabilities`, реалистичные первые пресеты `webgl-capabilities`, `webgpu` и `webgpu-capabilities`, запрет цикла прототипов у обёрток-Proxy и `name`/`length` оригинала у обёрток-функций.

Расширение 06.11.2026 по [ADR-107](../decisions/ADR-107-shardbrowser-ports.md) (состояние раунда 4: format8/catalog9 заморожен как опубликованный и строго мигрирует в текущий format10/catalog11, 158 строк, 56 Custom; каталог 8 раунда 3 и каталог 10 раунда 5 тоже заморожены). Новое: приватные ключи профиля для звука, WebGL readPixels и Network Information; значения в форме Chrome (MemoryInfo, шаг сети 50 мс / 50 кбит/с с различием по сайтам, usageDetails, согласованность уведомлений с Permissions и Push); фильтр настоящих голосов `{languages}`; AnalyserNode; Canvas `sparse-rgb-v1` помечает холсты до 512×512 целиком.

Расширение 05.11.2026 по [ADR-106](../decisions/ADR-106-antidetect-continuation.md): format7/catalog8, 56 Custom — добавлены Custom геолокации, алгоритм Canvas `sparse-rgb-v1`, режим WebRTC `host: 'mdns'` и охват `StorageBucket`/`webkitTemporaryStorage` в `storage-estimate`; ключи шума Canvas и Math живут весь срок профиля.

Расширение31.10.2026 по [ADR-087](../decisions/ADR-087.md): каталог158 rows,
55 Custom groups,23 Math functions. Добавлены supplementary Navigator и virtual
Plugin/MIME metadata, geometry, JS CSS/media, genuine Intl formatting, bounded
WebGL/WebGPU capabilities/readback, TextMetrics/Canvas fonts, Audio samples/
metadata и clock precision. Формат6/catalog7 сохраняет прежние значения и
добавляет новые строки BYPASS/unset. Результат и native проверки,
каждый из280 ключей.
Это не полная виртуализация всех280 наблюдений: Worker/engine/real performance,
native integrity, CSS/layout и прежние async/Canvas/iframe границы ниже остаются
открытыми. Selected literal и sampled PASS не означают universal naturalness.

Storage compatibility дополнена по [ADR-086](../decisions/ADR-086.md): manager,
сохранённый до установки getter или полученный из доступного same-origin
parent/child/popup, проверяется ленивым сравнением с pristine native identity.
Чужой profile не включается и не переписывается, native quota/backend не
вызываются. Cached identities остаются допустимыми после detach/navigation.
Fake/Proxy и ранее неизвестный manager без доступного источника по-прежнему
не становятся допустимыми по prototype/tag. Caps и точные native результаты:
отчёт исправления.

Повторный audit31.10.2026:
свежий отчёт.
Inheritance gap расширен на Chrome: immediate Window из body replacement
с srcdoc iframe и из object с локальным Blob SVG позволяет сохранить native
CPU getter до защиты дочернего Window. Полный commit SVG не проверен; возврат
исходного CPU защищённого parent через сохранённый getter подтверждён.
Firefox дополнительно подтверждает body replacement и execCommand insertion.
Наблюдавшийся порядок high-entropy UAData dictionaries исправлен по ADR-087:
projection следует порядку native own keys. Синхронный generic transform catch возвращает native при ошибке:
достижимость показана actual-installer stack fixtures, native Date probe не
подтвердил возврат в ограниченном поиске. Эти случаи остаются открыты.

Свежий полный аудит текущих bytes от31.10.2026:
отчёт,
40-family native matrix.
После Storage-исправления остаются подтверждённые способы получить исходный
результат в других async Custom API: page-controlled Promise hooks, включая
OffscreenCanvas.convertToBlob и WebRTC createOffer (Chrome/Firefox), WebGPU
null (Chrome).
В Firefox реальный Range.insertNode/surroundContents и Element.setHTMLUnsafe
оставляют синхронное окно до inheritance при indexed Window доступе. Совпадение
выбранного литерала и прежний fixture-validated статус не закрывают эти случаи.
Полная naturalness и подмена всех существующих fingerprint-поверхностей не
подтверждены; Worker/CSS/layout/fonts/audio/network границы остаются прежними.

Повторный аудит и исправления ADR-084:
внутренний отчёт. Public Custom arrays/dictionaries
в доступном inherited realm используют его прототипы; Document.open с Window
результатом получает прежнее bounded inheritance; Undo импорта восстанавливает
saved baseline. Это не расширяет список API или доступность браузерных интерфейсов.

ADR-106 (раздел 6) распространяет тот же снимок на `StorageBucket.prototype.estimate` и на `queryUsageAndQuota`/`requestQuota` у `navigator.webkitTemporaryStorage`/`webkitPersistentStorage` (в Chromium 153/156 — один объект, постоянное хранилище не 0/0; `requestQuota(x)` возвращает min(x, настоящая квота)). Распознанный получатель не вызывает original; callback приходит задачей (два шага приватного `MessageChannel`), `this` undefined, порядок `(usage, quota)`; `size` приводится по WebIDL один раз. Отдельные строки `storage-buckets` и `legacy-quota` по-прежнему блокируют эти API; `webkitRequestFileSystem` не затронут. Нативные проверки: `scripts/test/api-custom-storage-surfaces-native.mjs` (Chromium 153, Chrome 156, Firefox 153).

FP-12/13 StorageManager закрыты по ADR-085: в Custom выбранный async snapshot
создаётся без получения native quota и производного от неё Promise. Lazy native
Navigator.storage getter сохраняет возвращённую identity в private bounded
registry; неизвестный/Proxy/поддельный receiver получает native brand rejection
через private invalid sentinel. Старая quota не попадает в inherited then или
species constructor. Native Chrome/Firefox, negative и reentry cases:
внутренний отчёт.

Если настоящий storage getter нельзя обернуть, допускается ленивый captured
own Window.navigator + native storage getter lookup по вызову estimate для
exact identity известного Window. Установка ничего не запрашивает. Этот frozen
accessor случай проверен отдельно на настоящих Chrome/Firefox; missing/data-only
storage остаётся unavailable, не разрешая raw quota fallback.

Обычные обращения через зарегистрированный navigator.storage поддерживаются;
genuine manager из ранее открытого realm теперь поддерживается через bounded
pristine identity discovery ADR-086. Если его источник уже недоступен и manager
никогда не был аутентифицирован, безопасный brand oracle отсутствует.
Virtual Custom не предсказывает native backend/policy/I/O errors и timing.
После stop будущие вызовы retained wrapper используют original, а созданный
ранее выбранный snapshot сохраняется. Внутренний observer, установленный до
Custom, может не получить estimate counter; ради него native quota не читается.
Нет полного заключения о прочих async API или внутреннем allocation realm
Promise; проверены публичные prototypes и dictionaries target realm.

Canvas Custom стабилен при повторном чтении, но не идемпотентен при
putImageData(getImageData()) и PNG→Image→drawImage→getImageData в проверенном
32×16 sRGB fixture: уже изменённый bitmap получает проекцию снова. Это граница
readback-проекции, не полная модель виртуального графического устройства.

Исправления аудита 31.10.2026 описаны в ADR-083 и
внутренний отчёт: семантика UAData dictionaries и
конструкторов обёрток, Load saved-профиля, библиотечный CAS при отзыве доступа,
обновление главной панели Antidetect после возврата. Возврат вложенных редакторов
отдельным исправлением не объявляется. Это не расширяет перечисленное ниже покрытие.

Device aliases прогреваются при успешном page-requested enumerateDevices до
чтения ID. До первого перечисления в новом документе сохранённый необратимый alias
не восстанавливается. При конкурентных вызовах действует latest-invocation-wins:
отклонённый новый вызов может оставить поздний успех старого без прогрева карты;
чтение ID приложением её заполняет. Нет собственной enumeration, хранения raw ID
или дополнительного вызова getUserMedia.

Основание: ADR-048/049/059/060/064/065/066/068/087, E22-01/02/08/10/17/18/19/22. Канонический каталог — `packages/contracts/src/api-configuration.mjs`:158 API, 56 типизированных Custom. Прежние143 ID и порядок сохранены; добавлены15 bundles, последним — webgl-readback. Math содержит23 функции с отдельным выбором. WebRTC имеет расширенный профиль;37 WebAssembly операций сохраняют ON/BYPASS/OFF без Custom для native ресурсов. Текущий formatVersion10/catalogVersion11 (ADR-112; прежние 9/10 по ADR-108, 8/9 по ADR-107, 6/7 по ADR-087 и 7/8 по ADR-106 строго мигрируют); библиотеки и scopes строго мигрируют из format1/catalog1 и2, format2/catalog3, format3/catalog4 и5, format4/catalog6 и format5/catalog6 по замороженным metadata/value domains. Custom управляет `antidetectEnabled`, блокировками On — `enabled`; [матрица masters](guard-launchers.md). [Матрица WebAssembly](webassembly.md), [WebRTC](webrtc-custom.md), [профили](antidetect.md), [Math](math-transcendentals.md). Поддержка браузера проверяется по существующему descriptor; отсутствие/non-configurable учитываются как unavailable. Custom в каталоге не означает полной эмуляции всех связанных характеристик.

При переключении из Custom сохранённые selected/userValues остаются библиотекой и не применяются как Custom в другом эффективном режиме. По [ADR-061](../decisions/ADR-061.md) нажатие переключателя сразу сохраняет только выбранную строку; остальные черновики не записываются. После успешного применения регистраций привязанный исходный документ перезагружается через прежний доверенный reload route, если его tabId/documentId/host по-прежнему совпадают и нет незавершённой навигации. При обоих выключенных masters режим только сохраняется, автоматического reload нет. Для перехода из действующего режима в режим другого выключенного семейства reload может требоваться для удаления прежних immutable wrappers. Без source tab режим действует для новых посещений; уже открытые вкладки не перезагружаются автоматически, статус виден возле строки и над списком. Выбор другого значения в Custom picker и прочие настройки по-прежнему могут оставаться черновиками до Save.

Уже открытый Custom-документ и доступные ему новые same-origin дочерние realm сохраняют прежний профиль до перезагрузки родителя: иначе getter дочернего realm позволил бы прочитать native на родительском Navigator. Этот механизм не заменён публичным restore/stop каналом. Site BYPASS наследует глобальный режим и поэтому может получать глобальный Custom; это явно подписано как наследование из «Все сайты». OFF служит явным разрешением без Custom этой строки, ON — блокировкой. Само наличие dormant selected/userValues не включает подмену.

Фильтры редактора Spoofed / Blocked (E22-11) показывают явные режимы Custom / ON в черновике выбранной области. OFF означает разрешение API. Неактивные selected/userValues и глобальный Custom, унаследованный сайтом через BYPASS, не считаются собственным Custom сайта. Фильтры доступны и при выключенном master: это выбор редактируемых правил, а не подтверждение текущей активности подмены. Они не меняют конфигурацию и формат JSON; поиск и остальные категории применяются совместно.

| Поверхность | Изменяемое значение | Практическая граница |
| --- | --- | --- |
| Navigator | hardwareConcurrency, deviceMemory, maxTouchPoints, platform, UA/appVersion/vendor/languages/oscpu и supplementary metadata | JavaScript document realm; HTTP/backend policy не меняются, отсутствующие поля не создаются |
| Plugin/MIME collections | Выбранные counts/names/metadata, индексы/итерация/item/namedItem/enabledPlugin | Virtual metadata records; executable plugins не создаются, прямые saved native methods могут отвергнуть их |
| Client Hints | brands, mobile, platform, high-entropy metadata, toJSON | Только JS NavigatorUAData; отсутствующие выбранные high-entropy поля нейтральны, неизвестные поля результата не передаются. HTTP Client Hints и архитектура процесса не меняются |
| Screen / Window / JS CSS | Screen/DPR/orientation, выбранные inner/outer/position и matchMedia/CSS.supports metadata | Размер inner и признаки width/height/orientation в matchMedia выбираются только у окна верхнего уровня без opener: iframe и popup остаются native (popup с noopener неотличим от вкладки). Типы `all`/`screen` истинны, `print`/`speech` ложны; `only`, `not`, вложенные группы и `or`; device-width/height, orientation, `-webkit-device-pixel-ratio`, единица `x`. CSS.supports: регистр, внешняя пара скобок, пробелы вокруг `:` и `A and B`. Не поддержаны aspect-ratio, em/rem/in/pt/cm/mm/calc и префиксы `-moz-`/`-o-`: такие запросы остаются native. Реальные window resize, stylesheets/layout, raster, events и display topology не эмулируются |
| Intl / Date | Native formatter locale/zone/calendar/numberingSystem; отдельный прежний timezone/fixed offset | Явно заданные страницей locale, timeZone, calendar и numberingSystem побеждают; выбранные значения заполняют только пропущенное. Без аргумента locale выбранную локаль получают `toLocale*String` (Date, Number, BigInt, Array/TypedArray), `localeCompare`, `toLocaleUpperCase/LowerCase` и Intl.DurationFormat; `null`, `''` и `[]` остаются native (ADR-104, дополнение 2). Только Custom timezone выбирает зону и для genuine Intl; `getTimezoneOffset` следует переходам DST выбранной зоны. Local Date fields, `Date.prototype.toString` и constructor parsing остаются в зоне ОС; legacy chain-call identity сохраняется |
| WebGL | vendor/renderer, выбранные capability parameters/ranges/extensions, covered RGBA8 readPixels | Не создаёт GPU/driver/extensions. Private default-framebuffer readback bounded; FBO/PBO/shared/unsupported формы удерживаются. [ADR-087](../decisions/ADR-087.md) |
| WebGPU | сведения адаптера/null, capability limits и feature subset | Не повышает реальные возможности и не создаёт устройство; отсутствие API сохраняется |
| Canvas — fixture-validated | `stable-rgb-v1`: детерминированное изменение полностью непрозрачных RGB каналов на 1 при ImageData/URL/blob readback | Chromium 153/Chrome 155/Firefox 138: по 6 native сценариев, плюс по 12 production composition сценариев Chrome/Firefox. Drawing, alpha<255, WebGL readPixels и workers не меняются. Холст до 16 MiP (4096²), до 256 ожидающих toBlob/convertToBlob и 32 MiP приватных копий одновременно; плоские одноцветные холсты тоже сдвигаются на 1. VideoFrame(canvas).copyTo и captureStream + MediaStreamTrackProcessor читают сырые пиксели и не покрыты; точные ограничения ниже |
| Math | Выбранные23 функции, включая sqrt/cbrt/hypot, `deterministic-ulp-v1` | Не более1ULP для покрываемых inexact results; exact/special и worker Math сохраняются. [Матрица](math-transcendentals.md) |
| TextMetrics / Canvas fonts | Выбранный scale и Canvas family allowlist/fallback | Настоящее последующее Canvas measurement/drawing; DOM/system fonts не меняются |
| Audio | Bounded Float32 readback projection и `AudioContext.sampleRate` | До 2^26 (67 108 864) samples, около 25 минут при 44,1 кГц; больше — отказ до native вызова; copyFromChannel tail сохраняется. Шум зависит от origin документа (null/пустой origin даёт прежние значения). Выбранная `sampleRate` видна только у `AudioContext`/`webkitAudioContext`, созданных без аргументов; `OfflineAudioContext`, `AudioBuffer.sampleRate`/`duration` и явно заданная частота остаются native. Actual backend/синтез/потоки не эмулируются |
| Clocks / optional exposure | Precision Performance.now/Date.now/RAF, выбранные existing globals/Navigator features | Реальная скорость/scheduler/engine и неизменяемые свойства не эмулируются |
| Battery / Network Information | charging, времена, level; downlink, RTT, effectiveType, saveData | Невыбранный type и downlinkMax нейтральны. Физическое питание и соединение не меняются |
| Performance memory / storage estimate | heap metadata и quota/usage | Storage result содержит только quota/usage; usageDetails не проходит. Фактические лимиты и другие API измерения памяти не меняются |
| MediaDevices | список и метаданные audioinput/audiooutput/videoinput | Native prototype getters/toJSON/getCapabilities также санитизируются; IDs не проходят через обход собственных свойств. Capabilities выдаёт только выбранные deviceId/groupId, если эти ключи есть у native результата. Дополнительные строки — метаданные; физические потоки не создаются. Пока настоящий список состоит только из записей с пустыми label, deviceId и groupId (разрешения нет), `enumerateDevices` возвращает настоящий результат без замены: страница видит форму Chrome (по одной пустой записи на вид устройства, имеющийся на этом компьютере), а выбранный список включается после выдачи разрешения. Следствие: пустой Custom-список до разрешения не скрывает виды настоящих устройств |
| WebRTC | Custom host/STUN/TURN IP metadata, relay policy, случайные идентификаторы доступных устройств, новые настоящие DTLS identities | [Подробное покрытие](webrtc-custom.md). Нативные mDNS-кандидаты (`<uuid>.local`) сохраняют своё семейство IPv4/IPv6, правка страницей SDP не ломает обратное соответствие. Сетевой source IP не назначается; native browser-wide policy отдельная и optional. Устройства/I/O не создаются, numeric capabilities остаются нативными |
| Gamepads / Speech voices | пустое перечисление | Не синтезирует ввод геймпада, голос или speech engine |
| USB / HID / Serial | пустое перечисление ранее разрешённых устройств | Не создаёт порты, разрешения и дескрипторы устройств |
| Bluetooth | availability и пустое перечисление разрешённых устройств | Не создаёт Bluetooth-адаптер или соединение |
| Notifications / autoplay | permission getter / результат autoplay policy | Без выдачи реального разрешения, воспроизведения или изменения requestPermission |
| Media capabilities | supported/smooth/powerEfficient в результате проверки | Только три выбранных флага; дополнительные native объекты результата не выдаются. Реальные декодеры и ускорение не меняются |

Для процедур, возвращающих потоки, handles, пользовательские разрешения и сложные ресурсы, Custom выключен в каталоге. ON/BYPASS/OFF сохраняются. В каталоге отсутствуют выдуманные сведения о доступности API; один и тот же переносимый файл допускает unavailable на другом браузере.

## Применение и восстановление

Новый профиль выключен. Значения устанавливаются после включения общего выключателя и готовности native userScripts. В Chrome нужно один раз включить Allow User Scripts, в Firefox 137+ — отдельно разрешить userScripts кнопкой редактора. Для всех новых HTTP(S) посещений используется область «Все сайты»; выбранные пользователем более узкие области сохраняются. Конфигурация и регистрация остаются в браузере между запусками. Первый новый визит не требует повторной загрузки страницы.

Это относится к успешно проверенной регистрации профиля. Первая установка, смена настроек и восстановление после отзыва доступа выполняются асинхронно; до завершения возможны прежний профиль или промежуточное покрытие. Обновление самого расширения очищает userScripts, после чего controller регистрирует их заново. Навигация до завершения восстановления не объявляется защищённой. Обычный холодный запуск и восстановленная вкладка проверены в Chrome; холодный запуск постоянной установки Firefox пока требует подписанного XPI.

Профиль и собственный installer зарегистрированы одним MAIN-скриптом document_start. Установка не ждёт storage/SW/ISOLATED и не принимает команды страницы. Обёртки устанавливаются на владельцах дескрипторов в соответствующем realm. Для доступных пустых окон/фреймов используется синхронное наследование; дополнительный static origin-fallback bootstrap закрывает srcdoc/re-navigation. Native handles не публикуются.

Подмена уже исполняющегося документа неизменна до выхода из него. Новое значение, OFF, исключение или отзыв разрешения меняют будущие регистрации; уже открытая страница сохраняет прежнюю подмену до перехода/перезагрузки. Это закрывает восстановление native через сохранённый старый wrapper. Созданные до включения/обновления расширения ссылки и уже прочитанные значения невозможно отозвать задним числом. Публичного stop/restore и page-message apply больше нет.

В непрозрачных sandbox/data realms, где SOP запрещает прочитать capability родителя, покрываемые поля **удерживаются нейтральными** (например, CPU=0), а не выдаются как выбранный профиль. Это предотвращает проверенный обход получения native из opaque iframe, но не является полноценной эмуляцией такого realm. Предел наследования — 1024 доступных realm на установку; исчерпание предела не объявляется покрытым.

Для Math, Canvas, Audio samples и WebGL readback dedicated opaque guard отказывает в покрываемых вызовах вместо возврата исходного readback. Полный синхронно унаследованный профиль доступного same-origin документа сохраняется; недоступный opaque realm не получает закрытый session seed.

Workers/worklets, серверные UA/CH, настоящий CSS/layout, физические характеристики и косвенные измерения не эмулируются. JS media queries и formatter slots имеют отдельные Custom bundles; local Date fields остаются native. Проверка отдельных API не доказывает невозможность определить исходную среду другими способами.

Прежняя строка timezone задаёт fixed Date.getTimezoneOffset для валидной даты и сохраняет NaN для Invalid Date. Если включена только она, formatter с явным UTC продолжает форматировать по UTC, сообщая выбранную zone в resolvedOptions. При intl-formatting native formatter slots имеют приоритет, а отсутствующий в новой строке timeZone наследует выбранный timezone. Local Date fields не заменяются.

## Файлы и надёжность

JSON включает весь каталог и сохранённые значения, даже невыбранные. Пустая строка/unset/undefined/null различаются в рамках типа. До1000 значений на API,128 сайтов и128 fingerprint profiles делят бюджет4МиБ UTF-8. Каждый профиль хранит158 scope rows, preset и native WebRTC policy, не копируя secrets/master/sites/user libraries. Дубли/неизвестные версии/неверные значения отвергаются; rows следуют порядку каталога.

Импорт показывает preview; Cancel не сохраняет изменения. Apply пишет конфигурацию и прежнюю проекцию одним вызовом storage.local.set после проверки revision. Изменение только fingerprint library пишет единственный конфигурационный record и увеличивает его revision: открытые guards, legacy projection/pending, native policy и registrations остаются прежними. Undo не перезаписывает более новую конфигурацию. Ошибка storage оставляет прежнее подтверждённое состояние. Отчёты наблюдения, секреты и ввод страницы в конфигурацию не входят.

## Canvas E22-19 — подтверждённая область и ограничения

Профиль содержит `{algorithm}`: `sparse-rgb-v2` (по умолчанию с ADR-112 для новых профилей), `sparse-rgb-v1` (по умолчанию с ADR-106, сохранённые профили остаются на нём) или прежний `stable-rgb-v1`. Правила `sparse-rgb-v2` — в [ADR-112](../decisions/ADR-112-canvas-sparse-v2.md) и в заголовке `api-custom-canvas-runtime.js`: чётность вместо направления (идемпотентно), насыщенные каналы 0/1/254/255 не двигаются, холст до 262 144 пикселей и до 4 цветов возвращается как нарисован всеми путями чтения и экспорта; `readPixels` плоского WebGL-буфера — только при чтении всего буфера. Приватный ключ выводится из локального корня в `storage.local` и применённого профиля (ADR-106), переживает перезапуск service worker и браузера и не попадает в JSON/полные профили. Ключ включает сайт верхнего уровня (ADR-104, доп. 3). Установка использует прежний document_start bootstrap, без страницы команд или stop/restore handle.

Покрываемые readbacks: `CanvasRenderingContext2D.getImageData`, соответствующий доступный Window Offscreen2D метод, `HTMLCanvasElement.toDataURL/toBlob` (в том числе холста WebGL: экспорт берётся из 2D-копии и подчиняется тому же правилу, ADR-112) и доступный в Window `OffscreenCanvas.convertToBlob`. Изменение выполняется в возвращённом ImageData или на закрытой копии для encoder, исходный рисунок не меняется. Полностью непрозрачный RGB меняется на 1, полупрозрачный — на одно сохранённое состояние (ADR-108, раздел 5), alpha и полностью прозрачные значения сохраняются. Export использует native context/color metadata; неизвестные contexts, float16 и неподдерживаемая конверсия закрываются отказом.

Знак детерминированного сдвига зависит от координат, origin и ключа профиля, но не от colorSpace. Вне граничных RGB значений вычитание двух readbacks разных colorSpace может сократить одинаковый сдвиг и сохранить native-производную разность. Устойчивость к такому дифференциальному анализу не подтверждена; в аудите это ограничение алгоритма, а не подтверждённый обход запрета выдачи unsupported readbacks.

Максимум одной проекции — 4 × 1024² пикселей. Общий private budget ожидающих encoders — 4 операции и 8 × 1024² пикселей; превышение возвращает `null` для HTML `toBlob` либо отказ для Offscreen. Reservations освобождаются при завершении, native rejection, encoding failure и synchronous Promise species failure. Успешные исходные байты при неподдерживаемом случае не возвращаются. Объектные coordinates или quality с неоднозначной conversion также могут быть отклонены после единственного native coercion; native brand/taint/conversion errors имеют приоритет. Worker/worklet OffscreenCanvas, `WebGL.readPixels`, текстовые metrics и прочие способы измерения рисунка остаются вне этой подмены.

VM semantic fixtures и независимый SipHash oracle проходят. Исправление receiver-realm bindings/current Document подтверждено native fixtures Chromium 153, Chrome 155 и Firefox 138: по 6 сценариев. Chrome поддержал 8 проверенных WebGL1/2 × preserveDrawingBuffer × sRGB/P3 экспортов. Firefox поддержал 4 sRGB ветки;4 GL P3 ветки закрыты отказом после подтверждения, что native Canvas2D не поддерживает запрошенный P3. Это не незаметная конверсия в sRGB.

Независимая композиция production `hook.early.js` перед Custom выявила обходы через прежние MAIN visual preview и API-results: observer видел native результат раньше проекции. Добавлена общая однонаправленная политика: при любом активном Custom прекращается выдача raw API-results/Pro values, Canvas images и RTC endpoint snapshots; ожидающие snapshots очищаются, обычные счётчики наблюдений продолжают работать. Политика закрыта в module-private WeakMap и охватывает доступные дочерние realms. Публичный Symbol служит только запретом: любое присутствие, даже false/accessor, никогда не разрешает выдачу значений. Поддельные команды, reset и новый lease не снимают запрет. При невозможности закрепить Canvas veto покрываемая операция отказывает до original — это исключение из native-first правила, необходимое против внутреннего observer wrapper.

Source review, focused fixtures и финальные 12 production composition сценариев в Chrome 153/Firefox 138 проходят. Проверены оба порядка установки early/main observer, отдельный metadata-only Custom, очередь до Custom, доступный child и недоступный opaque frame. Positive controls при выключенном Custom подтверждают работу native API/Pro/visual channels. Артефакты закрепляют 13 hashes; package gate подтверждает совпадение финальных dist и полных ZIP. Chrome composition, Firefox composition.

Проекция имеет заметную стоимость CPU: на проверенном хосте readback1024² занимает около 183–192 мс в Chrome и 371 мс в Firefox вместо native около 1 мс. Это opt-in преобразование возвращаемых pixels, а не изменение самого raster engine. Точные замеры находятся в native Canvas evidence.
