# Security policy

[English](#english) · [Русский](#русский)

## English

### Supported versions

| Version | Supported |
|---|---|
| 2.0.x | Yes |
| 1.x and older | No, please update |

Fixes go into the latest 2.0.x release. I don't backport to older versions.

### Report a vulnerability

Please **don't open a public issue** for a security problem. Use GitHub's private reporting instead:

**[Report a vulnerability](https://github.com/vektort13/Detect.Expert/security/advisories/new)** (GitHub Security Advisories, under the repository's **Security** tab).

What helps most:

- The extension version and the browser and OS version (Chrome or Firefox, Windows for the companion).
- What you did, what you expected and what happened, with the smallest reproduction you can manage.
- The impact as you see it: what an attacker gains and what they need first (a malicious page, a local program, physical access).
- No real credentials, tokens or personal data in the report, please. Made-up ones are fine.

I'll answer in the advisory thread, tell you whether I can reproduce it and keep you posted until it's fixed. If you'd like to be credited in the release notes, say so, and if you'd rather stay anonymous, that works too. Please give me a reasonable window to ship a fix before you publish details.

### What counts

In scope:

- **The extension.** Anything that lets a web page do what only the extension's own pages may do (the page-to-extension message channel is meant to be untrusted), leaks data that [PRIVACY.md](PRIVACY.md) says stays local, stores secrets where it shouldn't, widens permissions or the Content Security Policy, or runs remote code.
- **The proxy companion.** The native messaging host, the local SOCKS5 relay, how engines are started, the DPAPI-protected profile file, and the install and uninstall scripts. Anything that lets another program or another extension talk to the host, read the saved profiles or escape the loopback relay is a good find.
- **Packaging.** Release packages whose contents or signatures don't match what the repository builds.

Not a security problem for this policy, though still welcome as an [issue](https://github.com/vektort13/Detect.Expert/issues):

- Sites noticing the extension's wrappers, and the coverage gaps (Workers, WebAssembly, CSS, server-side checks). These are documented limits.
- Antidetect not changing your IP address, TLS fingerprint or browser engine. Same, documented.
- Bugs in Xray-core or go-openvpn themselves. Please report those upstream. If my patches or the way I package them make something worse, that one is mine, tell me.
- Anything that needs an already compromised machine or browser profile.

### Checking your download

The companion's executables are signed by Vektor T13 Technologies B.V. How to verify the signature and the SHA-256 is in the [companion README](companion/README.md#is-it-really-from-me).

## Русский

### Поддерживаемые версии

| Версия | Поддерживается |
|---|---|
| 2.0.x | Да |
| 1.x и старше | Нет, обновитесь |

Исправления выходят в последнем релизе 2.0.x. В старые версии я их не переношу.

### Как сообщить об уязвимости

Пожалуйста, **не создавайте публичный issue**, если речь о безопасности. Используйте приватный канал GitHub:

**[Сообщить об уязвимости](https://github.com/vektort13/Detect.Expert/security/advisories/new)** (GitHub Security Advisories, вкладка **Security** репозитория).

Что больше всего помогает:

- Версия расширения, версия браузера и ОС (Chrome или Firefox, для помощника ещё и Windows).
- Что вы делали, что ожидали и что получилось, с самым коротким воспроизведением, какое сможете.
- Влияние, как вы его видите: что получает атакующий и что ему нужно заранее (вредоносная страница, локальная программа, физический доступ).
- В отчёте не должно быть настоящих учётных данных, токенов и личных данных. Выдуманные подойдут.

Я отвечу в обсуждении advisory, скажу, получилось ли воспроизвести, и буду держать вас в курсе до исправления. Если хотите, чтобы вас упомянули в заметках к релизу, скажите, а если предпочитаете остаться анонимным, так тоже можно. Пожалуйста, дайте мне разумное время выпустить исправление до публикации подробностей.

### Что считается проблемой

В области действия:

- **Расширение.** Всё, что позволяет веб-странице делать то, что разрешено только страницам самого расширения (канал сообщений со страницы считается недоверенным), утечка данных, которые по [PRIVACY.md](PRIVACY.md) остаются локальными, хранение секретов не там, где нужно, расширение разрешений или Content Security Policy, а также выполнение удалённого кода.
- **Помощник прокси.** Хост native messaging, локальное реле SOCKS5, запуск движков, файл профилей под защитой DPAPI, скрипты установки и удаления. Если другая программа или другое расширение может говорить с хостом, читать сохранённые профили или выйти за пределы loopback-реле, это хорошая находка.
- **Упаковка.** Пакеты выпуска, содержимое или подписи которых не совпадают с тем, что собирает репозиторий.

Не уязвимость в рамках этой политики, но всё равно ждём как [issue](https://github.com/vektort13/Detect.Expert/issues):

- Сайты, замечающие обёртки расширения, и пробелы покрытия (Workers, WebAssembly, CSS, серверные проверки). Это задокументированные ограничения.
- Antidetect не меняет ваш IP-адрес, TLS-отпечаток и движок браузера. Тоже задокументировано.
- Ошибки в самих Xray-core и go-openvpn. О них лучше сообщать авторам. Если мои патчи или моя упаковка что-то ухудшают, это уже моё, скажите мне.
- Всё, что требует уже скомпрометированного компьютера или профиля браузера.

### Проверка скачанного

Исполняемые файлы помощника подписаны Vektor T13 Technologies B.V. Как проверить подпись и SHA-256, написано в [README помощника](companion/README.ru.md#точно-ли-это-от-меня).
