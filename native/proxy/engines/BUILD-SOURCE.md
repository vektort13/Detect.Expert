# Сборка соответствующих исходников OpenVPN

Поставляемый каталог `source/go-openvpn` уже содержит все локальные модификации,
тесты и `cmd/openvpn2socks/vendor` с точными версиями всех зависимостей. Исходный
неизменённый archive находится рядом (`openvpn-source.zip`). Изменённые файлы
сохраняют AGPL-3.0-or-later; LICENSE входит в корень исходников. Лицензии
зависимостей входят в соответствующие vendor directories.

На Windows amd64 с Go 1.26.3:

```powershell
$env:GOTOOLCHAIN = 'local'
$env:CGO_ENABLED = '0'
$env:GOOS = 'windows'
$env:GOARCH = 'amd64'
$env:GOWORK = 'off'
Set-Location source/go-openvpn/cmd/openvpn2socks
go test -mod=vendor ./...
go build -mod=vendor -trimpath -buildvcs=false '-ldflags=-s -w -buildid=' -o openvpn2socks.exe .
```

Полный core suite проверяется из `source/go-openvpn` командой `go test ./...`;
go.mod/go.sum фиксируют зависимости core. Указанная сборка не использует
автозагрузку другой версии компилятора, системный TUN или драйверы. Исходники
Xray, LICENSE и версия официального поставляемого бинарника входят отдельно.

`openvpn-dns-fail-closed.patch` меняет системный DNS fallback на ошибку,
`openvpn-plain-tls-control.patch` добавляет поддержку обычных OpenVPN TLS
control packets без tls-auth/tls-crypt (TLS и проверка CA остаются включены).
`openvpn-stdin-profile.patch` и `stdin_profile.go` принимают ограниченный
профиль через `-config -`, без временного файла.
`openvpn-tunnel-dns-tcp.patch` и `tunnel_dns_tcp.go` добавляют стандартный TCP
fallback DNS через тот же VPN netstack.
`openvpn-negotiated-keys.patch`, `legacy_keys.go` и `local_session.go` выбирают
согласованный TLS exporter либо стандартный OpenVPN PRF, включая rekey.
`detect_legacy_keys_test.go` содержит независимый OpenSSL вектор всех 256 байт,
`detect_legacy_session_test.go` — локальный полноценный TLS+AEAD echo без EKM.
Новые файлы `plain_control.go`, `detect_plain_control_test.go` и
`detect_dns_test.go` уже скопированы в соответствующие source directories.
