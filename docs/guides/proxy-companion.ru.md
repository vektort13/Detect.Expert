# Помощник прокси: коротко

[English](proxy-companion.md) · [Русский](proxy-companion.ru.md)

Помощник это небольшая программа для Windows, которая позволяет вкладке Proxy делать то, что браузер сам не умеет: SOCKS5 с паролем, HTTP/HTTPS-прокси с логином, VLESS и OpenVPN. Здесь быстрый путь. Все подробности (что в пакете, как он работает, лицензии, сборка) лежат в [README помощника](../../native/proxy/README.ru.md).

## Он мне нужен?

| Ваш прокси | Нужен помощник? |
|---|---|
| SOCKS5, HTTP или HTTPS **без** логина | Нет, справится браузер |
| SOCKS5 с паролем | Да |
| HTTP или HTTPS с логином | Да |
| VLESS | Да |
| OpenVPN (.ovpn) | Да |

Только Windows 10/11 x64. Ставится на вашего пользователя, без прав администратора, служб и автозапуска.

## Установка за пять шагов

1. Скачайте `Detect.Expert-Proxy-Companion-windows-x64.zip` со страницы [Releases](https://github.com/vektort13/Detect.Expert/releases).
2. Распакуйте в обычную папку, например «Загрузки».
3. Узнайте ID расширения (ниже).
4. Откройте PowerShell в этой папке и выполните:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\Install.ps1 -ChromeExtensionId obbkkjmpgaajcggbhajpdeeadkkchbeo
   ```

5. В расширении откройте **Proxy**, блок **Companion**, и нажмите **Check companion**.

Этот ID относится к версии расширения из Chrome Web Store (карточка пока на проверке). Только для Firefox: `powershell -ExecutionPolicy Bypass -File .\Install.ps1 -FirefoxExtensionId 'detect.expert@detect.expert'`.

### ID вашего расширения

- Версия из магазина: `obbkkjmpgaajcggbhajpdeeadkkchbeo`.
- Распакованная или локальная сборка: другой ID. Он виден на вкладке Proxy (Companion, «Setup steps») и на `chrome://extensions` при включённом режиме разработчика. Chrome считает его от папки, из которой вы загрузили расширение, так что если папку переместить, ID изменится.

ID должен совпасть до символа. Если расширение не находит помощника, первым делом проверьте ID.

## Настоящий ли это файл

Исполняемые файлы подписаны издателем **Vektor T13 Technologies B.V.** Проверьте:

```powershell
Get-ChildItem -Recurse -Filter *.exe | ForEach-Object { Get-AuthenticodeSignature $_.FullName } |
  Format-Table Path, Status, @{n='Signer'; e={$_.SignerCertificate.Subject}} -AutoSize -Wrap
```

Нужны `Valid` и подписант, который начинается с `CN=Vektor T13 Technologies B.V.`. Ещё можно сравнить SHA-256 архива (`Get-FileHash <файл> -Algorithm SHA256`) с тем, что указан в описании релиза.

## Про `-ExecutionPolicy Bypass`

Оба скрипта `.ps1` не подписаны, а в обычной настройке Windows скрипты вообще не запускаются. `-ExecutionPolicy Bypass` снимает это ограничение только для одного процесса PowerShell, политика системы остаётся прежней. Скрипты короткие и читаемые, так что при желании откройте `Install.ps1` в Блокноте до запуска.

## Как пользоваться

1. Добавьте или импортируйте профиль на вкладке **Proxy**. Когда вы сохраните первый защищённый профиль, расширение попросит необязательное разрешение `nativeMessaging`. Разрешите.
2. Нажмите **Check visible profiles**, чтобы проверить его. Это работает и при выключенном Proxy.
3. Выберите профиль и нажмите **Connect**.

Браузер говорит с локальным реле на `127.0.0.1`, а реле говорит с вашим сервером. Ваш логин лежит в файле, зашифрованном Windows DPAPI, в `%APPDATA%\Detect.Expert\Proxy\`. Само расширение хранит только имена, адреса и порты.

Грабли:

- **Профили привязаны к ID расширения.** У распакованной сборки и у сборки из магазина свои сохранённые профили.
- **Обычные `http`-прокси отправляют ваш логин в открытом виде**, и многие из них разрешают `CONNECT` только на порт 443. Лучше берите `https` или SOCKS5.
- **Kill Switch.** Если помощник упал при включённом Proxy, трафик через этот профиль блокируется, а не уходит напрямую. Выключите Proxy, чтобы вернуть обычное соединение.

## Как удалить

Сначала выключите **Proxy** в расширении, потом:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Detect.Expert\ProxyCompanion\<ваша папка>\Uninstall.ps1"
```

Это удаляет **только записи реестра**. Чтобы стереть ещё и файлы с сохранёнными профилями:

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Detect.Expert\ProxyCompanion"
Remove-Item -Recurse -Force "$env:APPDATA\Detect.Expert\Proxy"     # логины, пароли, ссылки VLESS, конфиги OpenVPN: удалятся насовсем
```

Подробнее: [README помощника](../../native/proxy/README.ru.md), [FAQ](faq.ru.md).
