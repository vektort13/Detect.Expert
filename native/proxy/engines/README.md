# Нативные движки прокси

`node scripts/build-proxy-engines.mjs` собирает Windows amd64 engines в
`release/proxy-native/windows-amd64/engines`. Версии и SHA-256 закреплены в
`pins.json`; при несовпадении хеша сборка останавливается. Загрузка выполняется
только явной командой сборки. Расширение не загружает исполняемый код.

* Xray-core v26.3.27: отдельный официальный бинарник, MPL-2.0.
* openvpn2socks: исходники go-openvpn commit
  `383af88a500ab8798e6ebd2746368cd0a158ad80`, AGPL-3.0-or-later.
  Пользовательский gVisor stack: без TUN, драйверов и изменения маршрутов ОС.
* Go 1.26.3: закреплённый официальный toolchain. Автозагрузка другой версии
  Go выключена (`GOTOOLCHAIN=local`).

Локальная модификация `openvpn-dns-fail-closed.patch`: когда DNS внутри туннеля
не отвечает, lookup завершается ошибкой. Системный DNS для доменов SOCKS5 не
вызывается. Начальное разрешение имени сервера VPN перед соединением остаётся
обычным системным разрешением. Тест проверяет ноль вызовов системного resolver
при timeout, SERVFAIL, authoritative negative и отмене запроса.

Локальная совместимость plain TLS control добавляет обычный OpenVPN framing
для профилей без tls-auth/tls-crypt. Внутренний TLS с проверкой CA и AEAD data
channel сохраняются; добавлен тест полного TLS handshake и data echo.

Вывод data keys учитывает согласованный сервером режим: TLS exporter только
при `key-derivation tls-ekm` либо `protocol-flags ... tls-ekm`; иначе стандартный
OpenVPN PRF с premaster/random1/random2/session IDs. Это применяется и при
rekey. Вектор всех 256 байт проверен независимо OpenSSL TLS1-PRF; отдельный
локальный TLS+AEAD echo проверяет сервер без exporter. DNS умеет повторять
неудачный/усечённый UDP ответ через TCP того же DNS сервера внутри туннеля.

Сборка включает `source/`: исходный upstream archive, полный изменённый код
OpenVPN с vendored зависимостями и лицензиями, patch, regression test,
инструкцию воспроизводимой сборки, исходники Xray и LICENSE из его архива.
При распространении бинарников распространять этот каталог целиком вместе
с `engines.json`, `pins.json` и этим README. Не выдавать source-only ссылки
за соответствующие исходники поставляемого изменённого OpenVPN.

## Запуск компаньоном

Xray: `xray.exe run -config stdin: -format json`; предварительная проверка:
`xray.exe run -test -config stdin: -format json`. Конфигурация передаётся в
stdin до EOF. Конфиг принимает только локальный
SOCKS inbound и проверенные поля профиля. Сырые сообщения stdout/stderr не
передаются в расширение.

OpenVPN: `openvpn2socks.exe -config - -listen 127.0.0.1:<port>
-timeout 30s`; профиль передаётся в stdin до EOF (лимит 256 KiB), без
временного файла. Учётные данные — только `OVPN_USER`/`OVPN_PASS` в окружении
дочернего процесса. SOCKS5 listener появляется после handshake VPN.
Готовность проверяется SOCKS5 greeting. Подключение к порту само по себе не
доказывает доступность внешнего сайта. IP-проверок на чужих серверах нет.

Root-компаньон валидирует директивы/inline CA до запуска. Для IP remote без
ожидаемого имени `-allow-no-server-identity` сохраняет проверку импортированной
CA chain и server EKU. Режим с отключённой проверкой CA не используется.

Все соединения автоматических тестов направлены на loopback. Тест реального
VPN сервера и совместимость коммерческих профилей в эти проверки не входят.
