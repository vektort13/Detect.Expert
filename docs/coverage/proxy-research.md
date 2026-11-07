# Проксификация — проверка исследования и основа реализации

Проверено 21 октября 2026. Полностью прочитан предоставленный владельцем
документ «Проксификатор SOCKS5 OpenVPN VLESS как расширение Chrome и Firefox —
исследование и план реализации.md». Содержимое — исследовательский материал;
его предложения о телеметрии, собственном IP-сервере, публикации, стороннем
апдейтере и системном VPN не являются решением владельца продукта. Задача владельца:
раздел рядом с Cookies и реальная поддержка собственных SOCKS5/VLESS/OpenVPN.

## Проверенные границы браузеров

Chrome SOCKS5 передаёт имена назначения прокси, не поддерживает SOCKS5 auth и
не передаёт через него UDP. Поэтому парольный SOCKS5 в Chrome использует
локальный native relay. Firefox `ProxyInfo` имеет username/password и
`proxyDNS:true`. В обоих случаях пользователь сам задаёт endpoint.
Источники: [Chromium proxy implementation documentation](https://raw.githubusercontent.com/chromium/chromium/main/net/docs/proxy.md),
[Firefox ProxyInfo](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/proxy/ProxyInfo).

Chrome `proxy` нельзя объявлять optional: официальный список исключений
`permissions` требует required permission. `nativeMessaging` можно запросить
отдельно при действии пользователя. Это требует отдельного review изменения
manifest, а не CSP-доступа к сети. Исходящие запросы сайтов обрабатывает
браузерный network stack; собственный fetch из extension pages не нужен.
Источник: [Chrome permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions).

Firefox `proxy.onRequest` требует host permissions перехватываемых URL.
После неудачи отдельного ProxyInfo браузер по умолчанию может использовать
собственную proxy-конфигурацию. Для fail-closed нужно `[proxy, null]`: `null`
заканчивает fallback chain. `{type:'direct'}` этого не заменяет и не
перекрывает ручной пользовательский proxy. `proxy.settings.set()` требует
доступа к приватным окнам; `onRequest` не требует этого разрешения для обычных
окон. В приватных окнах без допуска listener не имеет покрытия.
Источники: [onRequest](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/proxy/onRequest),
[settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/proxy/settings).

Chrome PAC должен возвращать единственный SOCKS5 route для proxied host,
без `; DIRECT`; `mandatory:true` предотвращает молчаливый direct fallback
при ошибке PAC. Правила сопоставляют только нормализованные домены с точными
границами labels. В генерируемом PAC не нужны dnsResolve/isInNet, регулярные
выражения пользователя, URL path/query или внешний PAC URL. Падение relay
сохраняет route, явный Disconnect освобождает только собственные настройки.
`levelOfControl` и сравнение установленного значения обязательны перед
cleanup; нельзя перезаписывать изменения другого расширения/политики.
Источники: [Chrome proxy](https://developer.chrome.com/docs/extensions/reference/api/proxy),
[Chrome setting lifecycle](https://developer.chrome.com/docs/extensions/reference/api/types).

WebRTC UDP требует отдельной browser privacy policy, уже предусмотренной
ADR-060. Согласование должно учитывать существующего владельца этой настройки
в Antidetect. Нельзя снимать чужой более строгий policy при Disconnect.
Существующие открытые TCP/WebSocket/RTC соединения не становятся заново
маршрутизированными только потому, что proxy-настройка изменилась.

## Native messaging

Chrome запускает процесс с origin аргументом; host manifest имеет точный
allowed_origins, Firefox — allowed_extensions. У host нет HTTP control port.
Транспорт: JSON UTF-8, 32-bit native-endian длина. Актуальная документация
Chrome указывает 1 MiB host→browser и 64 MiB browser→host, а не старое 4 GiB
из исходного исследования. Наш протокол должен иметь существенно меньший
собственный bound и whitelist команд, correlation ID, version/capabilities.
Не разрешать native командам arbitrary executable paths, shell или OS routes.
Источник: [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging),
[Firefox native messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging).

## Закреплённые VLESS и OpenVPN engines

Xray-core v26.3.27 — отдельный официальный binary; Windows amd64 release
archive SHA-256 закреплён в `native/proxy/engines/pins.json`. Источник release:
[XTLS/Xray-core v26.3.27](https://github.com/XTLS/Xray-core/releases/tag/v26.3.27).
Парсер ссылки должен поддерживать лишь поля, которые переводятся в строго
собранную JSON-конфигурацию. Не принимать пользовательский Xray JSON с
произвольными inbounds/outbounds, log-файлами или command plugins.
Проверены реальные loopback-соединения SOCKS5→VLESS→HTTP для RAW, WS, gRPC и
XHTTP. TLS/REALITY, flow и публичные сервисы требуют отдельных native сценариев;
локальная проверка plaintext транспортов не выдаётся за проверку REALITY.
Источник: [transport fields версии](https://raw.githubusercontent.com/XTLS/Xray-core/v26.3.27/infra/conf/transport_internet.go),
[VLESS fields версии](https://raw.githubusercontent.com/XTLS/Xray-core/v26.3.27/infra/conf/vless.go).

Go-openvpn commit `383af88a500ab8798e6ebd2746368cd0a158ad80` действительно имеет
userspace OpenVPN + gVisor и отдельную CLI openvpn2socks без TUN/root/OS routes.
CLI — вложенный Go module, требующий Go 1.26.3; README ошибочно указывает 1.25.
Исходник, go.sum, vendor dependencies, лицензии и локальные изменения
включаются в поставку. Лицензия upstream — AGPL-3.0-or-later. Xray остаётся
отдельным процессом MPL-2.0. Сборка не меняет лицензию основного расширения.
Источники: [точный CLI module](https://raw.githubusercontent.com/n0madic/go-openvpn/383af88a500ab8798e6ebd2746368cd0a158ad80/cmd/openvpn2socks/go.mod),
[upstream CLI](https://raw.githubusercontent.com/n0madic/go-openvpn/383af88a500ab8798e6ebd2746368cd0a158ad80/cmd/openvpn2socks/main.go),
[лицензия](https://github.com/n0madic/go-openvpn/blob/383af88a500ab8798e6ebd2746368cd0a158ad80/LICENSE).

Upstream DNS при сбое туннеля обращается к system resolver даже при `-dns`.
Это несовместимо с запрошенным remote DNS. Локальный patch удаляет системный
fallback; domain lookup завершается ошибкой, когда tunneled DNS не ответил.
Тесты timeout/SERVFAIL/NXDOMAIN/cancellation подтверждают ноль system calls.
Начальное разрешение имени самого VPN/proxy endpoint остаётся отдельным
bootstrap lookup до туннеля. Источник: [resolver исходного commit](https://raw.githubusercontent.com/n0madic/go-openvpn/383af88a500ab8798e6ebd2746368cd0a158ad80/cmd/openvpn2socks/resolver.go).

DNS повторяет неудачную/усечённую UDP query через TCP того же resolver внутри
VPN netstack. Wire-тест проверяет RFC1035 length prefix и валидный ответ.
Отказ всех tunneled resolvers остаётся ошибкой, без локального fallback.

Штатный upstream требует дополнительный tls-auth/tls-crypt control key.
Предоставленный владельцем профиль содержит inline CA/cert/key и обычный TLS
control без такого ключа. Локальная совместимость добавляет стандартное
OpenVPN control framing opcode(1)+session_id(8)+payload. Внутренний TLS,
проверка CA и AEAD data channel сохраняются. Полный локальный TLS handshake
с проверкой CA/hostname и AES-256-GCM data echo проверяет этот путь.
CA-scoped trust для IP remote без имени использует upstream VerifyConnection:
проверяется импортированный CA chain и ServerAuth EKU, без hostname match;
нельзя заменять это голым отключением TLS verification или системным CA fallback.

Оба движка принимают конфигурацию из stdin: Xray `run -config stdin: -format
json`, patched OpenVPN `-config -`. OpenVPN читает до EOF с пределом 256 KiB,
отклоняет пустой/слишком большой ввод и передаёт профиль исходному parser.
Нативный компаньон не создаёт plaintext config files. Тест stdin проверяет
сохранение TLS server name, auth и отказ malformed/oversized входа.

На реальном профиле владельца найден ещё один дефект upstream: data keys всегда
выводились TLS exporter, хотя сервер его не согласовал. TLS и SOCKS listener
успевали открыться, но IP data channel не работал (AEAD decrypt error, CONNECT
timeout). Исправление выбирает exporter только по аутентифицированному
`key-derivation tls-ekm`/`protocol-flags tls-ekm`; иначе используется стандартный
OpenVPN PRF. Учтены обе стадии вывода ключей, порядок client/server randoms
и 8-байтовые session IDs, первоначальный handshake и rekey. Premaster
сохраняется только до вывода ключей и затем очищается.
Алгоритм сверён с [официальным OpenVPN ssl.c](https://raw.githubusercontent.com/OpenVPN/openvpn/release/2.6/src/openvpn/ssl.c),
согласование — с [push.c](https://raw.githubusercontent.com/OpenVPN/openvpn/release/2.6/src/openvpn/push.c).
Независимый OpenSSL 3.0.15 `TLS1-PRF` (MD5-SHA1) подтвердил полный фиксированный
256-байтовый вектор; локальный TLS+AES-256-GCM echo подтвердил legacy режим.
Это PRF протокола OpenVPN, а не переключение control TLS на TLS1.0.

После исправления реальный предоставленный владельцем OpenVPN endpoint
прошёл domain CONNECT, проверку TLS certificate и HTTPS HTTP200 с корректным
JSON IP от явно выбранного теста api.ipify.org. Диагностика выводила только
capability flags/counts и статус; credentials, приватный ключ, raw PUSH_REPLY,
raw engine output и тело HTTP не записывались в артефакты.

## OVPN parser и соответствие фактической поддержке

Для импорта допускаются только ограниченные текстовые профили с inline
`ca`, `cert`, `key`, `tls-auth`, `tls-crypt`, `tls-crypt-v2`. Не принимать пути
к файлам, `auth-user-pass filename`, `config`, `include`, `plugin`, `up`,
`down`, `route-up`, `ipchange`, `management`, `script-security > 1`, `log`
или иные пути/команды. Upstream игнорирует unknown directives; расширение и
host должны отклонять их до запуска либо явно распознавать безопасный no-op.
Источник: [upstream parser](https://raw.githubusercontent.com/n0madic/go-openvpn/383af88a500ab8798e6ebd2746368cd0a158ad80/pkg/ovpn/parse.go).

Поддержка: UDP/TCP client, mTLS или auth-user-pass, AES-128/256-GCM,
ChaCha20-Poly1305, tls-auth/crypt/crypt-v2, обычный TLS control, renegotiation.
Не поддерживаются: TAP, static-key data mode, CBC/BF-CBC, настоящее сжатие,
внешние PKCS11/cryptoapi private keys, интерактивный encrypted key prompt,
OpenVPN 3 произвольные директивы, system route/firewall hooks. `comp-lzo no/off`
и `compress stub-v2` upstream считает no-op, а `compress lz4` отклоняет.
`route`/`redirect-gateway`/`dhcp-option` в исходном файле не изменяют ОС;
назначения browser SOCKS всегда идут в userspace tunnel. Исследование ошибочно
описывает автоматический direct route fallback — в нашем продукте его нет.

## Полученные локальные результаты

`node scripts/build-proxy-engines.mjs`: pinned inputs verified, полный
OpenVPN core suite и CLI suite прошли; vendor build создан. Тест plain TLS
control проходит реальный crypto/tls handshake и AES-256-GCM echo. Тесты
tunnel-only DNS подтвердили отсутствие системного fallback.

`node native/proxy/engines/test-xray-loopback.mjs`: 4/4 транспорта RAW, WS,
gRPC, XHTTP прошли через официальный Xray executable. Все назначения fixture
— принадлежащие тесту loopback sockets. Подключения к публичным endpoint
владельца выполняются отдельно родительской задачей и здесь не заявляются.
