# Cloudflare — проверенная область совместимости

Проверка различает наблюдение, намеренное изменение API и решения Firewall. Наличие расширения, Light, Pro, общий OFF, BYPASS/OFF правил API, выбранный Custom и пресеты Firewall проверяются отдельно. Отсутствие DNR-правил подтверждается native API, а не только состоянием кнопки.

Официальные dummy sitekeys Turnstile проверяют загрузку SDK, iframe и success/error callbacks на собственной fixture. Они не проверяют production-антибот-решение. Автоматизация остаётся видимой; настоящий challenge не решается и токены не сохраняются. SDK загружается обычной страницей только при явном запуске тестов, не кодом расширения.

Cloudflare указывает, что блокировка необходимых скриптов и изменение браузерных API могут нарушать проверки. Намеренный ON-запрет API, несовместимый Custom или сохранённое пользовательское правило, блокирующее Cloudflare, нельзя объявить совместимыми по результату dummy виджета. Полные результаты, браузеры и режимы фиксируются во внутреннем отчёте.

Исправление ADR-056 завершает оставшийся pending cleanup после временного отказа native userScripts. Оно не вводит исключений Cloudflare, не подменяет verdict и не раскрывает native внутри работающего Custom-документа. Дополнительная задержка Pro и синхронной установки наблюдения в новых iframe измерена отдельно; причинная связь с пользовательским циклом пока не установлена.

ADR-057 исправляет потерю распознавания SDK после настоящего canonical → versioned redirect в Chrome. Evidence переносится только после успешной конечной загрузки с тем же HTTPS origin и native source-document identity. Ответ 302 без успешной загрузки не считается распознанным сервисом. Firefox 138 сохраняет network-limited: source-document identity webRequest отсутствует в поддерживаемом адаптере, поэтому точная атрибуция такого сетевого evidence к документу не заявляется.

Страница пользователя `https://2captcha.com/demo/cloudflare-turnstile` использует тестовый ключ `3x00000000000000000000FF`, который намеренно показывает интерактивный виджет. Готовая кнопка «Verify you are human» соответствует этому сценарию; она не означает завершение серверной проверки. Результаты её загрузки и визуального состояния фиксируются отдельно от success/error официальных dummy fixtures.

Chrome renderer memory cache может не выдавать webRequest script при повторной загрузке: работающий SDK тогда не получает documented browser-network vendor. Cold redirect fix этот пропуск не устраняет. Firefox post-click проверка остаётся UNKNOWN. После уточнений владельца задачи Cloudflare после нажатия и Gmail после подтверждения → возврат на вход оставлены открытыми во внутреннем отчёте; пользователь отложил повтор. Проверки demo, SDK и локального login не объявляются исправлением Google sign-in или любого production challenge.

Источники: [Cloudflare Challenge solve issues](https://developers.cloudflare.com/cloudflare-challenges/troubleshooting/challenge-solve-issues/), [официальное тестирование Turnstile](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
