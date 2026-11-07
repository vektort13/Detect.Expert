# WebRTC Custom — E22-08 / ADR-060

Текущее уточнение [ADR-095](../decisions/ADR-095-fingerprint-audit-correctness.md):
private Promise pin защищает регистрацию реакции hook; отдельный preflight
отклоняет изменённую публичную Promise-инфраструктуру до native-вызова. Обычный
offer проверен в Chrome 156 и Firefox 159. Проверка после native-driven чтений
RTCOfferOptions удерживает мутацию из успешного options getter; это ограниченное
исключение для identity аргумента (приватный Proxy). Deferred backend assimilation
и borrowed cross-realm backend не объявляются закрытыми. [Актуальные проверки](fingerprint-production-audit.md).

Уточнение ADR-072: после попытки применения native policy отзыв optional `privacy` не позволяет подтвердить снятие слоя. Текущий controller показывает `permission-required`, включая выбор System, до возврата доступа и native readback. Новый controller без истории применения сохраняет прежний inactive для System. Автоматическое снятие слоя самим браузером при revoke не предполагается; оно зависит от нативного поведения и не выдаётся за проверенный результат.

Реализация: [ADR-060](../decisions/ADR-060.md), задача E22-08. Итоговый отчёт: Chrome153/155 и Firefox138 native gates, unit3429 и release:verify прошли. Область ниже не означает универсальную эмуляцию устройств или сетевого маршрута; DTLS session identity остаётся открытым требованием.

Существующая строка `webrtc` получила типизированный Custom-профиль. Текущий каталог содержит 158 API / 56 Custom, FormatVersion10 / CatalogVersion11 по ADR-112 (ADR-108: FormatVersion9 / CatalogVersion10; ADR-107: FormatVersion8 / CatalogVersion9; ADR-106: FormatVersion7 / CatalogVersion8; ADR-087: 55 Custom, FormatVersion6 / CatalogVersion7); прежний ADR-068 использовал 143 API / 40 Custom и FormatVersion5 / CatalogVersion6. Antidetect master управляет Custom и native WebRTC policy; API Guard master — On-блокировками. Предыдущие форматы проверяются по замороженным каталогам до миграции с сохранением режимов, selected, библиотек и сайтов. Root `webrtcNetworkPolicy` по умолчанию system. [Матрица независимых masters](guard-launchers.md).

## Управление

Выделенное управление WebRTC и native policy перенесено в Antidetect → Network по [ADR-064](../decisions/ADR-064.md). Полный каталог API Guard и Custom-библиотеки сохраняются. Текущие режимы, раздельные IP-семьи и области действия: [Antidetect coverage](antidetect.md).

E22-24 устраняет скрытый ручной ввод: Antidetect → Network → WebRTC всегда показывает IPv4 и IPv6, в каждой карточке Host/STUN/TURN. Ввод выбирает Custom в черновике, Save сохраняет его; для действия Custom нужен включённый master Antidetect. Checkbox не скрывает поля и не стирает адреса при временном выключении. В API Guard у WebRTC есть прямая кнопка настройки, открывающая те же шесть полей. Native проверка ввода, сохранения, повторного открытия и чтения новой страницей в Chrome/Firefox.

| Настройка | Действие | Граница |
| --- | --- | --- |
| Custom host / STUN / TURN IP | Выбранные буквальные IPv4/IPv6 в покрываемых JS metadata | Не меняет источник пакета STUN и адрес настоящего выделенного TURN relay |
| Relay | Нативный `iceTransportPolicy: relay` у нового PeerConnection | Нужен TURN, настроенный самим сайтом; без него ICE может не установить соединение |
| Случайные идентификаторы устройств | Псевдонимы фактически доступных устройств с обратным сопоставлением при выборе | Не создаёт устройства, разрешения, потоки и характеристики оборудования |
| Session | Собственный salt в storage.session, разделение псевдонимов по origin | Стабилен в сессии; обновление persistent userScripts с новым salt после запуска асинхронно |
| Site | Собственный salt в storage.local, разделение по origin | Сохраняется между запусками; пользовательский выбор помимо требуемого session default |
| Fresh DTLS | Нативная новая identity для каждого PeerConnection; переданные страницей certificates не переиспользуются | Реальные fingerprints остаются согласованными с сертификатом и handshake; это не стабильный общий сертификат на всю сессию |
| Нативная сетевая политика | system / default_public_interface_only / disable_non_proxied_udp / proxy_only (только Firefox) | Весь браузер, отдельно от API Guard и сайтов, под master Antidetect по ADR-068; optional privacy и проверка фактического управления. `proxy_only` отправляет весь WebRTC только через прокси и ломает звонки, если ни один прокси не передаёт UDP (Firefox 138.0.4: 0 ICE-кандидатов без прокси); Chrome его не предлагает и не применяет (код `webrtc-policy-unsupported`) |

Реальный сетевой IP определяется маршрутом VPN/прокси/настоящего TURN. Пользовательские relay-серверы и credentials в расширение не добавлялись. Custom-механизм не сохраняет и не экспортирует DTLS-сертификаты; закрытые ключи не читаются. Существующее наблюдение metadata в инспекторе этим не изменяется. HTTPS/TLS-сертификаты исключены владельцем из задачи.

Запрошенная стабильность DTLS-сертификата на всю сессию браузера остаётся невыполненным требованием. Fresh DTLS — отдельная опция на соединение; session/site в профиле управляет только устройствами. Нативная генерация сертификата асинхронна, а его использование ограничено origin создателя. Расширение не гарантирует один настоящий сертификат во всех новых документах до первого синхронного конструктора страницы. [Нативная модель сертификатов](https://w3c.github.io/webrtc-pc/#rtccertificate-interface).

## Покрываемые поверхности

| Область | Поверхности |
| --- | --- |
| ICE candidate | Native getters candidate/address/relatedAddress/foundation, toJSON; события icecandidate, локальные/удалённые кандидаты ICE transport и выбранная пара |
| SDP | createOffer/createAnswer, native RTCSessionDescription.sdp/toJSON, local/current/pending/remote descriptions; IP4/IP6 family и адреса согласованы |
| Stats | PC/Sender/Receiver getStats; candidate/pair/address поля, согласованные IDs/ссылки; get/values/entries/keys/forEach/iterator, включая native Map-форму report |
| Ошибки ICE | address/url/errorText на покрываемых native событиях; port остаётся нативным; пустые terminal candidates сохраняют своё нативное пустое представление |
| Media devices | MediaDeviceInfo/InputDeviceInfo ID/group/label/capabilities, MediaStreamTrack settings/capabilities/label, обратный выбор в getUserMedia/applyConstraints и sink IDs |
| Bluetooth | BluetoothDevice.id/name и BluetoothAdvertisingEvent.name |
| USB | serial/product/manufacturer strings, configuration/interface descriptor names |
| HID | productName |
| MIDI | MIDIPort id/manufacturer/name/version, согласованные ключи MIDIInputMap/MIDIOutputMap и lookup/iteration/forEach; возвращаются настоящие port handles |
| Gamepad / Speech | Gamepad.id; SpeechSynthesisVoice.name/voiceURI |

Служебные адреса не являются адресами и не переписываются: 0.0.0.0, `::`, 127.0.0.0/8 и `::1` остаются как есть в `o=`, `c=`, `a=rtcp`, `a=candidate`, `raddr`/`rport`, `a=remote-candidates`, `address`/`relatedAddress`, строках stats и событиях ошибок ICE (заголовок SDP остаётся в форме Chrome; точные значения Chrome записаны по памяти и проверяются живыми прогонами). Локальные loopback-фикстуры поэтому не получают пользовательский адрес на relay-кандидате. Адреса link-local (169.254.0.0/16, fe80::/10) служебными не считаются: это настоящие адреса интерфейсов, настоящий Chromium собирает их как host-кандидаты (измерено: `169.254.106.179`), и они переписываются, как любой другой настоящий адрес.

Число и виды реально доступных устройств, аппаратные capabilities, numeric vendor/product IDs, I/O bytes и разрешения остаются нативными. Зарезервированные media routing aliases `default` / `communications` сохраняются. Не утверждается рандомизация произвольных байтов, которые устройство передаёт приложению. Для отсутствующих Web API расширение не создаёт поддельные native handles. Физический Bluetooth/USB/HID/MIDI обмен не считается проверенным по одним descriptor/unit fixtures.

Фиксированный Custom `media-enumeration` и включённая рандомизация WebRTC не могут одновременно действовать в одной области: валидатор проверяет глобальный/унаследованный режимы и активные сайты до записи. Неактивные библиотеки и выключенный master не мешают хранить черновые сочетания.

## Раннее применение и границы

Прежняя закрытая document_start регистрация ADR-049 содержит и выбранные значения, и RTC installer до первого скрипта сайта. Доступные same-origin about:blank/srcdoc используют настоящий inherited Window.origin для тех же псевдонимов. В непрозрачных realms идентификаторы удерживаются пустыми и новые PeerConnection не создаются; это не эмуляция выбранного профиля.

Изменения относятся к новым документам. Старые страницы, сохранённые до включения ссылки и уже созданные соединения требуют перехода/перезагрузки. При холодном запуске ранее зарегистрированный script может использовать прежний случайный session salt до завершения startup reconciliation. Исходные идентификаторы этим не раскрываются, но мгновенная ротация до первого восстановленного документа не гарантируется. Нативная сетевая политика сохраняется механизмом браузера и проверяется по его API; другой владелец не перезаписывается, system освобождает только свой слой, включая скрытый другим расширением.

Полный SDP/candidate round-trip поддерживается по закрытой ограниченной карте оригиналов. Произвольное редактирование приложением уже подменённого SDP может нарушить соединение с внешним peer. Лимиты: 64 КиБ SDP, 4 КиБ candidate, 512 cached candidates, 32 SDP, 2048 device aliases, по 2048 stats IDs в каждой карте, 512 stats rows; обратный MIDI lookup рассматривает не более 256 портов. Превышение не выдаёт исходные значения как fallback. Workers и иные непокрытые интерфейсы не объявляются защищёнными этим JS механизмом.

В JSON входят только желаемые настройки и библиотеки. Собственные salts, реальные device IDs, сертификаты, ключи, соединения и наблюдаемые адреса туда не попадают.

## Режим host `mdns` (ADR-106)

В `addresses.ipv4.host` и `addresses.ipv6.host` (только там) допустима строка `'mdns'`: хост-кандидаты семьи показывают случайное имя `<uuid>.local` (UUID v4 из захваченного `crypto.getRandomValues`, одно имя на исходный адрес и документ, таблица ≤ 256 имён) даже при выданном доступе к камере или микрофону. Имя заменяет IP везде, где его заменяет режим IP (текст и свойства кандидата, SDP, статистика, ICE transport, события ошибок); `raddr` srflx становится `0.0.0.0` (IPv6 — `::`) с `rport 0`. Обратная карта сохраняет круговую передачу SDP и кандидатов; нативные и чужие `.local` не трогаются; служебные адреса (в том числе `[::]`, `[::1]`) остаются. Имена не объявляются и не разрешаются, сетевой маршрут не меняется.

Измерено (Chromium 153, Chrome 156): без выдачи Chrome сам даёт `candidate:<f> 1 udp 2113937151 <uuid>.local <port> typ host generation 0 ufrag <u> network-cost 999`, в статистике хост с `address ""`; после выдачи — настоящие IP, TCP active (порт 9), `network-id`. Отличия режима: имена получают и TCP-кандидаты, имён столько, сколько адресов интерфейсов (в Chrome одно на семью), хвост `network-id`/`network-cost` и `networkType` нативные, `c=` показывает адрес роли хоста. Проверки: Chromium 153 и Chrome 156 по 328 проверок (STUN, TURN, IPv6 srflx, три пути loopback), интерфейс на 21 языке; Firefox не проверялся. В Antidetect → Сеть выбор есть у Host каждой семьи.
