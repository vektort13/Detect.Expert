<div align="center">

<img src="assets/banner.svg" alt="Detect.Expert — Fingerprint Protection + Forensics &amp; Antidetect" width="100%">

# Detect.Expert — Fingerprint Protection + Forensics & Antidetect

[English](README.md) · **Русский** · [繁體中文](README.zh-Hant.md) · [Tiếng Việt](README.vi.md)

Сайты постоянно ковыряются в вашем браузере и ничего об этом не говорят. Мне надоело гадать, что именно они спрашивают, поэтому я сделал расширение для Chrome и Firefox: оно показывает эти проверки, позволяет менять ответы и проверить, что получилось. Всё работает на вашем компьютере.

<!-- Chrome Web Store: карточка на проверке; плашка ниже ведёт на неё и честно об этом говорит. -->
[![Chrome Web Store: на проверке](https://img.shields.io/badge/Chrome%20Web%20Store-%D0%BD%D0%B0%20%D0%BF%D1%80%D0%BE%D0%B2%D0%B5%D1%80%D0%BA%D0%B5-F9AB00?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/obbkkjmpgaajcggbhajpdeeadkkchbeo)
[![Скачать](https://img.shields.io/badge/%D0%A1%D0%BA%D0%B0%D1%87%D0%B0%D1%82%D1%8C-Releases-2D66D2?style=for-the-badge&logo=github&logoColor=white)](https://github.com/vektort13/Detect.Expert/releases)

![Версия 2.0.0](https://img.shields.io/badge/%D0%B2%D0%B5%D1%80%D1%81%D0%B8%D1%8F-2.0.0-2D66D2?style=for-the-badge)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-1A73E8?style=for-the-badge&logo=googlechrome&logoColor=white)
![Chrome 153+](https://img.shields.io/badge/Chrome-153%2B-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![Firefox 128+](https://img.shields.io/badge/Firefox-128%2B-FF7139?style=for-the-badge&logo=firefoxbrowser&logoColor=white)
![Windows 10/11 x64: помощник прокси](https://img.shields.io/badge/Windows%2010%2F11-%D0%BF%D0%BE%D0%BC%D0%BE%D1%89%D0%BD%D0%B8%D0%BA%20%D0%BF%D1%80%D0%BE%D0%BA%D1%81%D0%B8-0078D4?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTAgMGgxMS41djExLjVIMHptMTIuNSAwSDI0djExLjVIMTIuNXpNMCAxMi41aDExLjVWMjRIMHptMTIuNSAwSDI0VjI0SDEyLjV6Ii8+PC9zdmc+)
![21 язык интерфейса](https://img.shields.io/badge/%D0%B8%D0%BD%D1%82%D0%B5%D1%80%D1%84%D0%B5%D0%B9%D1%81-21%20%D1%8F%D0%B7%D1%8B%D0%BA-6F42C1?style=for-the-badge)
![Без телеметрии, local-first](https://img.shields.io/badge/%D0%B1%D0%B5%D0%B7%20%D1%82%D0%B5%D0%BB%D0%B5%D0%BC%D0%B5%D1%82%D1%80%D0%B8%D0%B8-local--first-2EA44F?style=for-the-badge)

[![GitHub stars](https://img.shields.io/github/stars/vektort13/Detect.Expert?style=flat-square&logo=github)](https://github.com/vektort13/Detect.Expert/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/vektort13/Detect.Expert?style=flat-square&logo=github)](https://github.com/vektort13/Detect.Expert/network/members)
[![GitHub issues](https://img.shields.io/github/issues/vektort13/Detect.Expert?style=flat-square&logo=github)](https://github.com/vektort13/Detect.Expert/issues)
[![Последний релиз](https://img.shields.io/github/v/release/vektort13/Detect.Expert?style=flat-square&logo=github&include_prereleases)](https://github.com/vektort13/Detect.Expert/releases)
[![Последний коммит](https://img.shields.io/github/last-commit/vektort13/Detect.Expert?style=flat-square&logo=github)](https://github.com/vektort13/Detect.Expert/commits)
[![Размер репозитория](https://img.shields.io/github/repo-size/vektort13/Detect.Expert?style=flat-square&logo=github)](https://github.com/vektort13/Detect.Expert)
[![Основной язык](https://img.shields.io/github/languages/top/vektort13/Detect.Expert?style=flat-square&logo=javascript&logoColor=white)](https://github.com/vektort13/Detect.Expert)
[![Лицензия: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Preact](https://img.shields.io/badge/Preact-673AB8?style=flat-square&logo=preact&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat-square&logo=go&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white)
![esbuild](https://img.shields.io/badge/esbuild-FFCF00?style=flat-square&logo=esbuild&logoColor=black)
![pnpm](https://img.shields.io/badge/pnpm-F69220?style=flat-square&logo=pnpm&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat-square)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white)

[![anti.bot](https://img.shields.io/badge/anti.bot-%D0%BE%D1%82%D0%BA%D1%80%D1%8B%D1%82%D1%8C-2D66D2?style=for-the-badge&labelColor=061028)](https://anti.bot)
[![antidetect.com](https://img.shields.io/badge/antidetect.com-%D0%BE%D1%82%D0%BA%D1%80%D1%8B%D1%82%D1%8C-2D66D2?style=for-the-badge&labelColor=061028)](https://antidetect.com)
[![detect.expert](https://img.shields.io/badge/detect.expert-%D0%BE%D1%82%D0%BA%D1%80%D1%8B%D1%82%D1%8C-2D66D2?style=for-the-badge&labelColor=061028)](https://detect.expert)

<sub>Карточка в Chrome Web Store пока на проверке. Пока её нет в магазине, берите расширение на странице <a href="https://github.com/vektort13/Detect.Expert/releases">Releases</a>.</sub>

</div>

---

## Коротко

- **Detector** только наблюдает. Он записывает, какие API браузера дёргает страница, собирает вызовы в техники и всегда показывает, чего он не увидел, рядом с тем, что увидел. Результаты API он не меняет и своих проверок не запускает.
- **Всё остальное выключено, пока вы сами это не включите.** API Guard разрешает, блокирует или подменяет то, что выбранные API отдают странице. Antidetect собирает одно согласованное виртуальное устройство из значений, которые вы выбрали. Плюс менеджер прокси, работа с cookies, автосерфер и отладчик браузера.
- **Чего тут нет, скажу прямо.** Распознанный сервис ещё не значит ничего плохого или хорошего про сайт. «Не обнаружено» значит «не увидел в той части, которую вижу, за этот период». Workers, WebAssembly, CSS и серверные проверки для Detector слепая зона. Страница, кроме того, может заметить обёртки расширения. Интерфейс говорит об этом там, где это важно, но лучше вы узнаете это от меня заранее.

## Что внутри

| | Модуль | Что делает | Браузеры |
|---|---|---|---|
| 🔎 | **Detector / Forensics** | Смотрит, какие API браузера вызывает страница (Canvas, WebGL, звук, WebRTC, экран, процессор, голоса, браузер и устройство и так далее), и собирает вызовы в техники. Покрытие всегда стоит рядом с результатом, так что «ничего не нашёл» не выдаёт себя за «там ничего нет». Заодно показывает распознанные сервисы защиты и идентификации, сторонние запросы, cookies, соцсети, маячки (GA4, Google Ads, Meta, TikTok, Яндекс, LinkedIn), цепочки Tag Manager и фоновую активность. Запись Pro строит карту запросов и печатный отчёт. Сохранённые отчёты лежат у вас на диске. | Chrome, Firefox |
| 🧱 | **API Guard** | 158 API браузера в 12 группах. Для каждого: как в пресете, разрешить, блокировать или своё значение (свои значения принимают 56 API). Общие пресеты, правила для отдельных сайтов, импорт и экспорт JSON. | Chrome, Firefox |
| 🔥 | **Firewall** | Необязательный, включается только после экрана согласия. Сравнивает то, что вы набираете, с исходящими запросами, и только в памяти. Умеет остановить следующие запросы по вашим решениям, замечает признаки записи сеанса, может отправлять сигнал Global Privacy Control и по желанию ведёт локальную историю «Кто вас узнаёт». | Chrome |
| 🎭 | **Antidetect** | Быстрые настройки с тремя пресетами и вкладки «Устройство», «ОС», «Браузер», «Сеть». Собирает одно согласованное виртуальное устройство, добавляет шум с ключом профиля к результатам Canvas, звука, WebGL и Math, держит в порядке заголовки запросов (User-Agent, Accept-Language, Client Hints) и управляет метаданными WebRTC. До 128 профилей в библиотеке, корзина на 7 дней. IP-адрес, TLS-отпечаток и движок браузера он не трогает. | Chrome, Firefox (заголовки: только Chrome) |
| 🧭 | **Автосерфер** | Проходит по вашей очереди из до 200 адресов в отдельном окне: перемешивание, циклы, внутренние ссылки, паузы на страницах, настоящая прокрутка и движение указателя, локальные измерения ресурсов. Есть каталог из 8 329 сайтов с фильтрами по стране, категории и системе трекинга. Никогда не кликает, не вводит текст и не трогает CAPTCHA. Пока он работает, Chrome показывает свою плашку отладки. | Chrome |
| 🍪 | **Cookies** | Просмотр, создание, правка и удаление cookies во всех хранилищах. Импорт и экспорт JSON, Netscape и файлов Cookie-Editor, а также экспорт с шифрованием паролем (AES-256-GCM). Перед записью предпросмотр, после записи можно откатить. Значения скрыты, пока вы сами их не откроете. | Chrome, Firefox |
| 🌐 | **Менеджер прокси + помощник** | Профили SOCKS5, HTTP, HTTPS, VLESS и OpenVPN, Kill Switch, маршрутизация всего трафика или только выбранных доменов, ручные проверки с историей, массовый импорт, необязательная геолокация. Помощник для Windows добавляет вход по паролю, VLESS и OpenVPN в пользовательском пространстве. | Chrome, Firefox (помощник: Windows x64) |
| 🧰 | **Browser Debug** | Просмотр 15 наборов данных вашего же браузера, только чтение: история, закладки, загрузки, метаданные cookies, вкладки, сеансы, настройки приватности, разрешения сайтов и так далее. Каждый набор просит своё разрешение. | Chrome, Firefox (наборов меньше) |
| ☁️ | **Интеграции** | Чтение режима Precursor вашей зоны Cloudflare по вашему токену. Необязательная геолокация выходных IP прокси (MaxMind, ipgeolocation.io, ipdata, ip-api.com) по вашему ключу. | Chrome, Firefox |
| 🗺️ | **Экскурсии и палитра команд** | У каждого из 12 разделов настроек своя короткая экскурсия (всего 49 шагов), а по `Ctrl K` открывается палитра команд. Экскурсии ничего не меняют в настройках. | Chrome, Firefox |
| 🌍 | **21 язык, 6 тем** | Английский, русский, арабский, немецкий, испанский, французский, хинди, индонезийский, японский, корейский, маратхи, польский, португальский (Бразилия), тамильский, телугу, украинский, урду, вьетнамский, китайский (упрощённый), кантонский и у (шанхайский вариант). | Chrome, Firefox |

Английский и русский тексты я писал руками. Остальные 19 языков пока черновики: носители их ещё не проверяли, а места, в которых я сомневаюсь больше всего, собраны в [docs/translations.md](docs/translations.md). Если где-то звучит криво, [напишите в Issues](https://github.com/vektort13/Detect.Expert/issues), я поправлю.

## Скриншоты

Чистый профиль браузера, только демо-данные: адреса из диапазонов для документации, выдуманные имена и cookies. Сначала светлая тема, тёмные в конце.

<table>
  <tr>
    <td width="50%"><img src="assets/screens/01-control-center.png" alt="Пульт"><br><sub><b>Пульт.</b> Все модули и их состояние на одном экране.</sub></td>
    <td width="50%"><img src="assets/screens/02-detector.png" alt="Detector"><br><sub><b>Detector.</b> Техники, которые нашлись на демо-странице, и покрытие.</sub></td>
  </tr>
  <tr>
    <td><img src="assets/screens/03-api-guard.png" alt="API Guard"><br><sub><b>API Guard.</b> Разрешить, заблокировать или подменить ответ API.</sub></td>
    <td><img src="assets/screens/04-antidetect.png" alt="Быстрые настройки Antidetect"><br><sub><b>Antidetect.</b> Быстрые настройки и виртуальное устройство, которое видят сайты.</sub></td>
  </tr>
  <tr>
    <td><img src="assets/screens/05-proxy-manager.png" alt="Менеджер прокси"><br><sub><b>Менеджер прокси.</b> Профили, ручные проверки, выходные IP (адреса демо).</sub></td>
    <td><img src="assets/screens/06-cookies.png" alt="Рабочее место Cookies"><br><sub><b>Cookies.</b> Атрибуты на виду, значения по умолчанию скрыты.</sub></td>
  </tr>
  <tr>
    <td><img src="assets/screens/07-autosurfer.png" alt="Автосерфер"><br><sub><b>Автосерфер.</b> Каталог сайтов с фильтрами по категории и системе трекинга.</sub></td>
    <td><img src="assets/screens/08-browser-debug.png" alt="Browser Debug"><br><sub><b>Browser Debug.</b> Данные вашего браузера, только чтение.</sub></td>
  </tr>
  <tr>
    <td><img src="assets/screens/09-popup.png" alt="Всплывающее окно" width="300"><br><sub><b>Popup.</b> Тот же отчёт рядом со страницей, на которой вы сидите.</sub></td>
    <td><img src="assets/screens/10-control-center-dark.png" alt="Пульт, тёмная тема"><br><sub><b>Тёмная тема:</b> Пульт.</sub></td>
  </tr>
  <tr>
    <td><img src="assets/screens/11-detector-dark.png" alt="Detector, тёмная тема"><br><sub><b>Тёмная тема:</b> Detector.</sub></td>
    <td><img src="assets/screens/12-proxy-dark.png" alt="Менеджер прокси, тёмная тема"><br><sub><b>Тёмная тема:</b> менеджер прокси.</sub></td>
  </tr>
</table>

## Установка

Нужен **Chrome 153+** или **Firefox 128+**. Пакеты лежат на странице [Releases](https://github.com/vektort13/Detect.Expert/releases).

| Файл | Что это | SHA-256 |
|---|---|---|
| `Detect.Expert-2.0.0-chrome.zip` | Пакет для Chrome | — <!-- SHA256 --> |
| `Detect.Expert-2.0.0-firefox.zip` | Пакет для Firefox | — <!-- SHA256 --> |
| `Detect.Expert-Proxy-Companion-windows-x64.zip` | Необязательный помощник прокси (Windows 10/11 x64) | — <!-- SHA256 --> |

Проверить скачанный файл в PowerShell: `Get-FileHash .\Detect.Expert-2.0.0-chrome.zip -Algorithm SHA256`.

### Chrome

1. Распакуйте `Detect.Expert-2.0.0-chrome.zip` в папку, которую не удалите. Chrome грузит расширение прямо из неё, так что потом её трогать нельзя.
2. Откройте `chrome://extensions` и включите **Режим разработчика**.
3. Нажмите **Загрузить распакованное расширение** и выберите распакованную папку (ту, где лежит `manifest.json`).
4. На странице **Сведения** расширения включите **Разрешить пользовательские скрипты** (Allow user scripts). Он нужен Antidetect и своим значениям в API Guard. Detector, Cookies и остальное работают и без него.
5. Закрепите значок, откройте popup и перейдите на Пульт.

Когда карточка в Web Store заработает, установка оттуда заодно будет обновлять расширение сама.

### Firefox

1. Откройте `about:debugging#/runtime/this-firefox` и нажмите **Загрузить временное дополнение**.
2. Выберите `Detect.Expert-2.0.0-firefox.zip` (или `manifest.json` из распакованной папки).
3. Для своих значений нажмите **Разрешить Custom** в настройках расширения (Firefox 137+).

Грабли тут одни: временное дополнение пропадает после перезапуска Firefox. Для постоянной установки нужна подпись Mozilla, у этого выпуска её пока нет. Firewall и Автосерфер есть только в Chrome.

### Помощник прокси (необязательно, Windows)

Он нужен для SOCKS5 с паролем, HTTP/HTTPS-прокси с логином, VLESS и OpenVPN. Обычные профили SOCKS5, HTTP и HTTPS без логина прекрасно работают и без него. Исполняемые файлы подписаны **Vektor T13 Technologies B.V.** Ставится только на текущего пользователя Windows: без прав администратора, без служб, без автозапуска.

```powershell
# в папке, куда вы распаковали ZIP помощника
powershell -ExecutionPolicy Bypass -File .\Install.ps1 -ChromeExtensionId obbkkjmpgaajcggbhajpdeeadkkchbeo
```

Этот ID относится к версии из Chrome Web Store. У распакованной сборки ID другой, его видно на вкладке Proxy в расширении и на `chrome://extensions`. Все шаги, проверка подписи, удаление и лицензии: [companion/README.ru.md](companion/README.ru.md) и [руководство по помощнику](docs/guides/proxy-companion.ru.md).

## Что с вашими данными

Короче: они остаются у вас.

- Моего сервера в схеме нет. Нет аккаунта, аналитики, отчётов о сбоях, удалённого кода и удалённых правил. Все правила распознавания лежат внутри пакета, мне ничего не отправляется.
- Сеть используется только тогда, когда вы что-то просите. Content Security Policy страниц расширения пускает всего на семь адресов, для двух необязательных функций: `api.cloudflare.com` (Cloudflare Precursor, с вашим токеном) и провайдеры геолокации `geolite.info`, `geoip.maxmind.com`, `api.ipgeolocation.io`, `api.ipdata.co`, `ip-api.com` и `pro.ip-api.com` (с вашим ключом). Единственный запрос, который расширение делает само: повторно просит уже сообщённый браузером значок сайта для страницы из области наблюдения, без referrer. Прокси, запуск автосерфера и проверка прокси ходят только туда, что вы сами настроили.
- Отчёты Detector живут в session storage браузера, по одному на документ, с лимитами по размеру и времени. То, что вы сохраняете сами (отчёты Pro, профили Antidetect, метаданные прокси, настройки), лежит локально. Полный перечень: [docs/data-inventory.md](docs/data-inventory.md).
- Чего Detector не хранит никогда: пиксели, сэмплы звука, ввод в формах, значения cookies, токены, тела запросов и ответов, полные URL, сырые стеки. Логины, пароли и ключи прокси есть только в файле помощника, который защищён DPAPI.
- Экспорт делается только по вашему действию. JSON сохраняется после предпросмотра и содержит ровно то, что вы там увидели. Имя хоста по умолчанию выключено.

Полный текст: [PRIVACY.md](PRIVACY.md) (на русском и английском).

## Как это устроено

```mermaid
flowchart LR
  subgraph Page["Веб-страница (недоверенная зона)"]
    S["Сенсоры в MAIN world<br/>обёртки вызывают оригинал один раз"]
  end
  subgraph Ext["Расширение"]
    B["Мост ISOLATED<br/>фильтрует, собирает пакеты, ждёт ACK"]
    W["Service worker<br/>отчёты по документам, движок, session storage"]
    U["Интерфейс: popup · боковая панель · Options"]
  end
  O["Наблюдатели браузера<br/>webRequest · webNavigation"]
  S -- "postMessage (данные под контролем страницы)" --> B
  B -- "runtime.sendMessage, отправитель проверяется" --> W
  O --> W
  W -- "запросы ui-*, проекция отчёта" --> U
```

Всё, что приходит со страницы, считается недоверенным: страница может это подделать. Идентификаторы вкладки, кадра и документа берутся из браузера, а не со страницы. У каждого документа свой отчёт, а потерянные данные показываются явным пропуском, а не пропадают молча. Подробнее: [docs/architecture/overview.md](docs/architecture/overview.md).

## Сборка из исходников

Нужны Node.js 24 или 25 и pnpm 10.17.1.

```powershell
pnpm install
pnpm build:chrome      # dist/chrome
pnpm build:firefox     # dist/firefox
pnpm release:verify    # проверки, затем оба ZIP выпуска в release/
```

Другие проверки: `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:production`, `pnpm test:firefox`, `pnpm test:inspection`. Тесты на Playwright запускают настоящие Chromium и Firefox, поставьте их заранее. Помощник для Windows собирается так: `node scripts/build-proxy-engines.mjs`, потом `node scripts/build-proxy-companion.mjs` (только Windows x64; скрипт скачивает закреплённый Go и исходники движков и сверяет их с `native/proxy/engines/pins.json`). Подробнее в [runbooks/](runbooks/).

## Структура проекта

```text
.
├── apps/
│   ├── production-extension/   расширение для Chrome/Firefox (то, что выпускается)
│   ├── production-protect/     адаптер модуля Firewall (Chrome)
│   └── extension/              манифест и точки входа типизированной базы
├── packages/                   contracts, sensors, collector, background, engine,
│                               attribution, catalog, ui, export
├── native/proxy/               помощник прокси для Windows (Go) и файлы сборки движков
├── scripts/                    сборка, упаковка и тесты
├── docs/                       архитектура, заметки о покрытии, решения (ADR), файлы выпуска
├── fixtures/  tests/           локальные тестовые страницы и автотесты
├── rules/  runbooks/  vendor/  источники правил, инструкции, вендоренный код модуля
├── assets/                     баннер, превью для соцсетей, скриншоты
├── PRIVACY.md  SECURITY.md  CHANGELOG.md  NOTICE  LICENSE  logo.svg
└── companion/                  документация помощника прокси
```

## Документация

Руководства: [Быстрый старт](docs/guides/getting-started.ru.md), [помощник прокси](docs/guides/proxy-companion.ru.md), [FAQ](docs/guides/faq.ru.md). Те же тексты есть по-английски, файлы без `.ru`.

Технические заметки (в основном по-русски): [API Guard](docs/coverage/api-blocking.md), [свои значения](docs/coverage/api-custom.md), [Antidetect](docs/coverage/antidetect.md), [Proxy](docs/coverage/proxy.md), [Geolocation API](docs/coverage/proxy-geolocation.md), [Cookies](docs/coverage/cookies-workspace.md), [Автосерфер](docs/coverage/autosurf.md), [Browser Debug](docs/coverage/browser-debug.md), [Cloudflare Precursor](docs/coverage/cloudflare-precursor.md), [журнал решений](docs/decisions/README.md), [перечень данных](docs/data-inventory.md), [файлы выпуска](docs/release/README.md), [Firefox](runbooks/firefox.md).

## Автор и контакты

<div align="center">

<a href="https://github.com/vektort13"><img src="https://github.com/vektort13.png?size=200" width="96" height="96" alt="Vektor T13"></a>

Я **Vektor T13**, проект живёт под организацией **Vektor T13 Technologies [Detect Expert]**. Вопросы, идеи и сообщения об ошибках приветствуются, выбирайте любой удобный канал.

<h3 align="center">🌐 Сайты</h3>

| Сайт | Что это |
|:---:|:---|
| <a href="https://detect.expert"><img src="https://img.shields.io/badge/detect.expert-visit-2D66D2?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCI%2BPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48cGF0aCBkPSJNMiAxMmgyME0xMiAyYTE1LjMgMTUuMyAwIDAgMSA0IDEwIDE1LjMgMTUuMyAwIDAgMS00IDEwIDE1LjMgMTUuMyAwIDAgMS00LTEwIDE1LjMgMTUuMyAwIDAgMSA0LTEweiIvPjwvc3ZnPg%3D%3D&logoColor=white&labelColor=061028" alt="detect.expert"></a> | сайт проекта |
| <a href="https://anti.bot"><img src="https://img.shields.io/badge/anti.bot-visit-7C3AED?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCI%2BPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48cGF0aCBkPSJNMiAxMmgyME0xMiAyYTE1LjMgMTUuMyAwIDAgMSA0IDEwIDE1LjMgMTUuMyAwIDAgMS00IDEwIDE1LjMgMTUuMyAwIDAgMS00LTEwIDE1LjMgMTUuMyAwIDAgMSA0LTEweiIvPjwvc3ZnPg%3D%3D&logoColor=white&labelColor=061028" alt="anti.bot"></a> | ИИ-идентификатор пользователя |
| <a href="https://antidetect.com"><img src="https://img.shields.io/badge/antidetect.com-visit-4F46E5?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCI%2BPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48cGF0aCBkPSJNMiAxMmgyME0xMiAyYTE1LjMgMTUuMyAwIDAgMSA0IDEwIDE1LjMgMTUuMyAwIDAgMS00IDEwIDE1LjMgMTUuMyAwIDAgMS00LTEwIDE1LjMgMTUuMyAwIDAgMSA0LTEweiIvPjwvc3ZnPg%3D%3D&logoColor=white&labelColor=061028" alt="antidetect.com"></a> | Антидетект |
| <a href="https://grid.training"><img src="https://img.shields.io/badge/grid.training-visit-D97706?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCI%2BPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48cGF0aCBkPSJNMiAxMmgyME0xMiAyYTE1LjMgMTUuMyAwIDAgMSA0IDEwIDE1LjMgMTUuMyAwIDAgMS00IDEwIDE1LjMgMTUuMyAwIDAgMS00LTEwIDE1LjMgMTUuMyAwIDAgMSA0LTEweiIvPjwvc3ZnPg%3D%3D&logoColor=white&labelColor=061028" alt="grid.training"></a> | Вебинары и курсы |
| <a href="https://euqlid.space"><img src="https://img.shields.io/badge/euqlid.space-visit-0D9488?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCI%2BPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48cGF0aCBkPSJNMiAxMmgyME0xMiAyYTE1LjMgMTUuMyAwIDAgMSA0IDEwIDE1LjMgMTUuMyAwIDAgMS00IDEwIDE1LjMgMTUuMyAwIDAgMS00LTEwIDE1LjMgMTUuMyAwIDAgMSA0LTEweiIvPjwvc3ZnPg%3D%3D&logoColor=white&labelColor=061028" alt="euqlid.space"></a> | Карта Wi-Fi сетей мира |

<h3 align="center">💬 Сообщество</h3>

<p align="center">
<a href="https://t.me/antidetect"><img src="https://img.shields.io/badge/Telegram-%D0%9E%D1%81%D0%BD%D0%BE%D0%B2%D0%BD%D0%B0%D1%8F%20%D0%B3%D1%80%D1%83%D0%BF%D0%BF%D0%B0-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram"></a>
<a href="https://t.me/multiacceng"><img src="https://img.shields.io/badge/Telegram-%D0%A7%D0%B0%D1%82%20(%D0%B0%D0%BD%D0%B3%D0%BB%D0%B8%D0%B9%D1%81%D0%BA%D0%B8%D0%B9)-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram"></a>
<a href="https://t.me/antidetectchat"><img src="https://img.shields.io/badge/Telegram-%D0%A7%D0%B0%D1%82%20(%D1%80%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9)-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram"></a>
<a href="https://discord.gg/6pENTcY7Zc"><img src="https://img.shields.io/badge/Discord-%D0%A7%D0%B0%D1%82-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
</p>

<h3 align="center">▶️ YouTube</h3>

<p align="center">
<a href="https://www.youtube.com/@VektorT13ENG"><img src="https://img.shields.io/badge/YouTube-English-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube English"></a>
<a href="https://www.youtube.com/@VektorT13"><img src="https://img.shields.io/badge/YouTube-%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube Русский"></a>
<a href="https://www.youtube.com/@VektorT13VN"><img src="https://img.shields.io/badge/YouTube-Ti%E1%BA%BFng%20Vi%E1%BB%87t-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube Tiếng Việt"></a>
<a href="https://www.youtube.com/@VektorT13CN"><img src="https://img.shields.io/badge/YouTube-%E4%B8%AD%E6%96%87-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube 中文"></a>
<a href="https://www.youtube.com/@VektorT13ES"><img src="https://img.shields.io/badge/YouTube-Espa%C3%B1ol-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube Español"></a>
</p>

<h3 align="center">🧰 Код и поддержка</h3>

<p align="center">
<a href="https://github.com/vektort13"><img src="https://img.shields.io/badge/GitHub-%40vektort13-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub"></a>
<a href="https://github.com/vektort13/Detect.Expert/issues"><img src="https://img.shields.io/badge/Issues-%D0%BE%D1%88%D0%B8%D0%B1%D0%BA%D0%B8%2C%20%D0%B2%D0%BE%D0%BF%D1%80%D0%BE%D1%81%D1%8B%2C%20%D0%B8%D0%B4%D0%B5%D0%B8-2D66D2?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmZiI%2BPHBhdGggZD0iTTEyIDJhMTAgMTAgMCAxIDAgMCAyMCAxMCAxMCAwIDAgMCAwLTIwem0xIDE1aC0ydi0yaDJ2MnptMC00aC0yVjdoMnY2eiIvPjwvc3ZnPg%3D%3D&logoColor=white" alt="Issues"></a>
<a href="https://github.com/vektort13/Detect.Expert/security/advisories/new"><img src="https://img.shields.io/badge/Security-%D1%81%D0%BE%D0%BE%D0%B1%D1%89%D0%B8%D1%82%D1%8C%20%D0%BF%D1%80%D0%B8%D0%B2%D0%B0%D1%82%D0%BD%D0%BE-B91C1C?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmZiI%2BPHBhdGggZD0iTTEyIDEgMyA1djZjMCA1LjUgMy44IDEwLjcgOSAxMiA1LjItMS4zIDktNi41IDktMTJWNWwtOS00em0tMSAxNS00LTQgMS40LTEuNEwxMSAxMy4ybDQuNi00LjZMMTcgMTBsLTYgNnoiLz48L3N2Zz4%3D&logoColor=white" alt="Security"></a>
<a href="https://github.com/vektort13/Detect.Expert/releases"><img src="https://img.shields.io/badge/Releases-%D0%B7%D0%B0%D0%B3%D1%80%D1%83%D0%B7%D0%BA%D0%B8-2EA44F?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmZiI%2BPHBhdGggZD0iTTE5IDloLTRWM0g5djZINWw3IDcgNy03ek01IDE4djJoMTR2LTJINXoiLz48L3N2Zz4%3D&logoColor=white" alt="Releases"></a>
</p>

<sub>Нашли уязвимость? Пожалуйста, не в публичный issue, используйте приватный advisory, подробности в [SECURITY.md](SECURITY.md). На странице «Контакты» в расширении собраны те же сайты и каналы.</sub>

</div>

## Пользуйтесь с умом

Это инструмент для исследований, тестов и приватности. Применяйте его в своём браузере, на своих сайтах и в тестовых стендах, в рамках закона и правил сервисов, которые вы посещаете. Невидимости, анонимности и гарантии, что проверки конкретного сайта пройдутся, я обещать не могу: сайты могут заметить расширение, а серверные сигналы ему недоступны. Не используйте его для мошенничества и не пытайтесь с его помощью обойти защиту, которую вы не уполномочены проверять.

## Лицензия

MIT, см. [LICENSE](LICENSE). Copyright (c) 2026 Vektor T13.

Помощник прокси поставляет два движка отдельными исполняемыми файлами: Xray-core (MPL-2.0) и пропатченный go-openvpn (AGPL-3.0-or-later). Их исходники, патчи и тексты лицензий лежат в папке `engines/source` пакета помощника. Компоненты, встроенные в расширение, сохраняют свои лицензии, см. [NOTICE](NOTICE) и [docs/release/licenses.md](docs/release/licenses.md).
