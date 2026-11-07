# Social Networks: наблюдение запросов

Дата проверки: 2026-10-09. ADR-026/028, DET-059, REQ-001/002/004/005/011/012.

Кнопка Social Networks показывает обращения текущего документа и доступных
дочерних документов к социальным и identity-сервисам. Красный счётчик — число
разных распознанных провайдеров; `unknown` не увеличивает его. Строки таблицы
содержат сервис, класс наблюдения, метод, тип ресурса, количество и доступный
источник обращения. Список доменов — классификатор наблюдённых ресурсов, а не
проверка наличия аккаунта пользователя.

## Провайдеры и совпадение доменов

Классификатор содержит 45 провайдеров. Совпадает указанный host либо его
поддомен с границей `.`; похожие посторонние домены не совпадают.
Для Google/Microsoft перечислены также подтверждённые hosts тегов и аналитики.
Для Apple/Spotify/Yahoo сохраняется ограничение указанными identity-hosts.
На общих CDN совпадает только опубликованный путь конкретного SDK.

| Провайдер | Домены/hosts классификатора |
| --- | --- |
| Facebook | facebook.com, facebook.net |
| Instagram | instagram.com |
| X | twitter.com, x.com, t.co, ads-twitter.com |
| LinkedIn | linkedin.com, licdn.com |
| TikTok | tiktok.com |
| Snapchat | snapchat.com, sc-static.net |
| Pinterest | pinterest.com, pinimg.com |
| Reddit | reddit.com, redditmedia.com, redditstatic.com |
| Discord | discord.com, discordapp.com |
| Twitch | twitch.tv |
| YouTube | youtube.com, youtube-nocookie.com |
| GitHub | github.com |
| GitLab | gitlab.com |
| VK | vk.com, vk.ru, vkuser.net |
| OK | ok.ru |
| Weibo | weibo.com |
| QQ | qq.com; WeChat hosts проверяются раньше общего правила QQ |
| Telegram | telegram.org |
| LINE | line.me, line-scdn.net |
| Google | accounts.google.com, apis.google.com, googletagmanager.com, google-analytics.com, analytics.google.com, googleadservices.com, googlesyndication.com, doubleclick.net |
| Microsoft | login.microsoftonline.com, login.live.com, bat.bing.com |
| Apple | appleid.apple.com |
| Spotify | accounts.spotify.com |
| Steam | steamcommunity.com |
| Yahoo | login.yahoo.com |
| Tumblr | tumblr.com |
| Quora | quora.com |
| Disqus | disqus.com |
| Yandex | yandex.ru, yandex.com |
| Mail.ru | mail.ru |
| Kakao | kakao.com, kakaocdn.net, bc.ad.daum.net; t1.daumcdn.net только /kas/static/kp.js |
| Naver | naver.com, naver.net |
| Baidu / Tieba | baidu.com |
| Bluesky | bsky.app |
| ShareThis | sharethis.com |
| Douyin | douyin.com; unpkg.byted-static.com только /bridge/douyin_open/{version}/lib/douyin_open.umd.js |
| WeChat | weixin.qq.com, wx.qq.com |
| Mastodon | mastodon.social, mastodon.online |
| AddThis | addthis.com; legacy service, прекращённый Oracle |
| WhatsApp | whatsapp.com, wa.me |
| Viber | viber.com |
| Threads | threads.com, threads.net |
| Vimeo | vimeo.com |
| Dailymotion | dailymotion.com |
| SoundCloud | soundcloud.com |

Общий запрос к известному домену остаётся `service-request`, пока фиксированный
путь и тип ресурса не соответствуют более конкретному классу. Поддерживаемые
классы: обычный SDK, tracking SDK, tracking pixel, embed, обычная авторизация
в навигации/фрейме/запросе, необычное обращение к login как image/script и
вызов Login Status API. `manual-redirect-request` и `fedcm-call` сохранены
в канонических enum для совместимости; новые MAIN observations не выводят
их из параметров fetch или CredentialsContainer.get. Имена вида `/loginfo`, favicon и профиль
не становятся login-probe по совпадению части строки. Обычная OAuth-навигация
остаётся `authentication-navigation`.

В production включены 57 семейств фиксированных SDK/pixel/embed правил:
19 tracking SDK, 15 обычных SDK, 14 tracking collector/pixel и 9 embed.
Это число семейств host/path/type правил, а не число соцсетей, запросов
или установленных способов проверки входа. Alias, версия и локализованный
SDK могут давать несколько примеров внутри одного семейства.

## Два источника доказательств

| Источник | Что видно | Атрибуция |
| --- | --- | --- |
| Browser network | Реально наблюдённый браузером запрос, метод/тип ресурса, разрешённый host инициатора | `frame-only` либо `unknown`; `script: null` |
| MAIN page hook | Наблюдённый вызов/присваивание страницы | Native `currentScript`: `exact-resource`; допустимый стек: `sampled-stack`; иначе `unknown` |

Эти счётчики не складываются в один точный сетевой итог. Browser-network
строки имеют `browser-observed`; MAIN строки — `page-controlled`. Факт вызова
API сам по себе не доказывает завершённую загрузку. Временное соседство с
другим скриптом не создаёт связь «этот скрипт инициировал запрос».

MAIN наблюдает fetch, XHR open/send, sendBeacon, src image/script/iframe,
Element.setAttribute('src', ...), вставку подключённого ресурса, window.open
и Login Status API. CredentialsContainer.get учитывается общим DET-059
с phase `settlement-unobserved`, без social/provider/FedCM строки из options.
Произвольные fetch init и credentials options полностью непрозрачны:
нет чтения значений, getters, descriptors или Proxy traps. Если fetch init
отличен от undefined/null, MAIN method — `UNKNOWN`; без init строковый URL даёт GET, а
настоящий Request читается только захваченными native url/method getters.
Браузерный сетевой канал независимо сообщает наблюдённый метод запроса.
Источником XHR считается скрипт при send. Неподключённый image может начать
запрос при src; script/iframe учитываются при подключении к документу.
setAttribute использует только примитивное имя SRC/src и native post-call src;
повторного преобразования аргумента значения нет. Присваивание/атрибут и
последующая вставка того же ресурса не увеличивают одну page action дважды.
Повторное присваивание остаётся отдельным действием страницы.
Дедупликация не увеличивает счётчик при повторном чтении snapshots.
Обёртка выполняет исходный native вызов ровно один раз и сохраняет this,
аргументы, результат, Promise и исключение. Ответ запроса не анализируется.
sendBeacon сохраняет исходный true/false и фиксирует попытку вызова POST/ping;
false не обозначается как поставленный в очередь или доставленный запрос.
Тело beacon не читается. Синхронное native исключение не создаёт social row.

`webRequest.initiator` — origin, а не URL вызывающего JavaScript.
См. [Chrome webRequest](https://developer.chrome.com/docs/extensions/reference/api/webRequest).
В проверенном Firefox 138.0.4 у сетевых событий нет необходимого documentId:
browser-network данные без надёжной привязки не присваиваются текущему
документу. MAIN наблюдения доступны и проверены в Firefox отдельно.
Если MAIN bridge отсутствует, отвечает malformed/unavailable или истекает
timeout, отдельно авторизованные browser observations сохраняются как partial
с `truncated: true`; старые page rows удаляются. Отказ повторной авторизации,
pause, навигация или отзыв доступа возвращают пустой no-access snapshot.

## Источник скрипта и redaction

Наружу выходит только PSL-redacted registrable host и фиксированный шаблон
basename: `main.js`, `client.js`, `script.js`, `sdk.js`, `gtm.js`,
`fbevents.js`, `widgets.js`, `tracker.js`, `analytics.js` и варианты `.mjs`.
Остальные имена заменяются на `/<script>`. Каталоги, произвольные
идентификаторы файла, query и fragment не сохраняются. Например,
`https://sub.example.com/private/account123/main.js?token=secret` отображается
как `example.com/main.js`.

Fallback стека ограничен 64 выборками за историю документа, 8 строками и
8192 transient символами. Стек не пересекает bridge и не сохраняется. При
native Error.stack accessor либо пользовательском formatter/getter источник
может остаться unknown. Cookies, тела и ответы запросов, OAuth codes,
токены, формы, профиль, переданное значение Login Status и состояние аккаунта
не читаются. Небезопасные getters options не вызываются повторно.

Наблюдения не устанавливают, залогинен ли пользователь, каким аккаунтом он
пользуется, его историю посещений или успешность проверки логина. Никаких
активных запросов для проверки аккаунта, истории или XS-Leak extension
не запускает. Image GET не является top-level navigation для SameSite=Lax:
см. [Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).
FedCM passive mode может стартовать без первоначальной активации пользователя;
active mode требует её: [режимы FedCM](https://developer.chrome.com/docs/identity/fedcm/overview).

## Pro и пределы захвата

MAIN counts накапливаются за жизнь наблюдаемого документа с момента включения
сенсора, включая обращения до запуска Pro. Они сбрасываются при очистке,
новом generation либо новом документе. Snapshots не означают только вызовы
после старта Pro и не позволяют восстановить точное время каждого обращения.

Pro автоматически снимает Cookie и Social Networks snapshots текущих
авторизованных документов примерно каждые 5 секунд, в том числе при закрытом
popup. При старте, навигации и остановке есть дополнительные попытки захвата.
Визит хранит до 24 текущих документов и до 256 social rows суммарно. История
визитов разделяется авторитетной document identity. Недоступные/устаревшие
дочерние документы пропускаются; отозванный доступ не возвращает прошлые
защищённые наблюдения как живые результаты.
Если доступных документов больше 24, первый сохранённый snapshot получает
`truncated: true`; если строк больше 256, переполнение отмечается у документа,
чьи строки ограничены. Недоступные и посторонние документы не расходуют квоту.
Ошибка Cookie inventory не отменяет независимо авторизованный Social capture.

Pro report показывает все сохранённые строки social таблицы по документам,
с классом, методом, типом ресурса, раздельным счётчиком источника, атрибуцией
и доступным script template. Динамические подписи UI/report, включая unknown,
coverage и классы наблюдений, локализованы во всех 21 существующих локалях.

Runtime observer: до 32 документов, 64 rows/документ, 64 KiB/документ, TTL
10 минут; сетевой захват до 20 событий/с/документ и 100/с глобально.
MAIN snapshot — до 12000 оценённых байт и 512 transient node/XHR identities.
Live bridge: один pending запрос; следующее чтение допускается через 500 мс
после завершения предыдущего. Более ранний trusted read занимает этот же
единственный слот и ждёт очереди. Он отправляет MAIN сообщение после интервала,
а 400 мс response timeout начинается лишь после отправки. Другой pending read
получает пустой unavailable результат; сообщения страницы до отправки queued
запроса игнорируются. До 8 admission attempts. Privileged reads: две физические операции с
deadline 1500 мс. Pro scheduler: две одновременные capture operations,
до 16 текущих визитов, ожидание вызова до 6000 мс; физический pending slot
сохраняется до завершения операции. Потеря при захвате/доставке отражается
`truncated`; scope/consent/navigation проверяются повторно после ожидания.

Pause и отзыв доступа отключают запись; clear удаляет наблюдения и снимки.
Не добавлены сетевые upload, telemetry, блокировка или маскировка запросов.

## Происхождение фиксированных SDK/pixel сигнатур

Базовый реестр: [social-network-sources-2026-10.json](../../packages/catalog/research/social-network-sources-2026-10.json),
22 primary-source ссылки предыдущей реализации.
Расширение: [social-network-expansion-2026-10.json](../../packages/catalog/research/social-network-expansion-2026-10.json),
42 primary-source ссылки, 78 positive expansion fixtures и результаты 12
ограниченных чтений публичных статических SDK (HTTP 200, предел 1 MiB).
Код не исполнялся и не сохранялся; retained facts — фиксированные публичные
host/path интеграций. Общие domain mappings не означают подтверждённый
tracking SDK или проверку логина.

| Интеграция | Основание фиксированных путей |
| --- | --- |
| Meta SDK / Pixel | [Официальный sdk.js](https://connect.facebook.net/en_US/sdk.js), [fbevents.js](https://connect.facebook.net/en_US/fbevents.js); проверены en_US/ru_RU ресурсы; `/tr` подтверждён в hosted source |
| X widgets | [Публикация X о widgets.js](https://blog.x.com/engineering/en_us/a/2016/how-twitter-deploys-its-widgets-javascript) |
| LinkedIn Insight / pixel | [Официальная документация](https://learn.microsoft.com/en-us/linkedin/marketing/conversions/deduplication); [dc.ads.linkedin.com/collect в публикации LinkedIn](https://business.linkedin.com/content/dam/lem/business/en/advertise/ads/brand-awareness/how-linkedin-turns-up-the-heat-on-their-own-marketing-campaigns.pdf) |
| Pinterest tag / pixel | [Pinterest Tag](https://developer.pinterest.com/docs/track-conversions/pinterest-tag/) |
| TikTok events.js | [Документация TikTok](https://ads.tiktok.com/gateway/docs/index?doc_id=1701890973258754&language=ENGLISH) |
| Snapchat tag / pixel | [Официальный GTM template](https://github.com/Snapchat/snapchat-google-tag-manager/blob/main/template.tpl), [hosted scevent.min.js](https://sc-static.net/scevent.min.js); `/p` подтверждён в hosted source |
| Telegram widget | [Telegram Login Widget](https://core.telegram.org/widgets/login/), [публичный ресурс](https://telegram.org/js/telegram-widget.js) |
| Google Identity / legacy loaders | [Google Identity Services](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [документация миграции](https://developers.google.com/identity/gsi/web/guides/migration) |
| X Ads | [Pixel troubleshooting](https://business.x.com/en/help/troubleshooting/faqs-about-pixels), [официальный uwt.js](https://static.ads-twitter.com/uwt.js) |
| Reddit / LINE / Quora | [Reddit Pixel](https://business.reddithelp.com/articles/Knowledge/reddit-pixel), [LINE hosted tag](https://d.line-scdn.net/n/line_tag/public/release/v1/lt.js), [Quora Pixel](https://business.quora.com/marketing-advertising-resources/quora-pixel-conversion-tracking-setup) и hosted qevents.js |
| Yandex / Mail.ru / Bing UET | [Metrica tag](https://yandex.ru/support/metrica/en/code/counter-initialize), [Mail.ru hosted tag](https://top-fwz1.mail.ru/js/code.js), [Bing hosted tag](https://bat.bing.com/bat.js) |
| Google measurement | [Google tag](https://developers.google.com/tag-platform/gtagjs), [CSP и продуктовые домены](https://developers.google.com/tag-platform/security/guides/csp); legacy hosted analytics.js/ga.js |
| Kakao / Naver / Baidu | [Kakao Pixel](https://kakaobusiness.gitbook.io/main/tool/pixel-sdk/install), [Naver conversion guide](https://naver.github.io/conversion-tracking/pages/01_script_guide_wcstrans/), [Baidu manual](https://tongji.baidu.com/static/tongji/Instruction.pdf) |
| Bluesky / Threads / Vimeo / Dailymotion / SoundCloud | [Bluesky repository](https://github.com/bluesky-social/social-app/blob/main/bskyweb/README.embed.md), [Meta embeds](https://github.com/facebook/meta-embeds-for-wordpress/blob/main/README.md), [Vimeo SDK](https://github.com/vimeo/player.js/blob/master/README.md), [Dailymotion library](https://developers.dailymotion.com/v0/docs/player-library-script), [SoundCloud Widget API](https://developers.soundcloud.com/docs/api/html5-widget) |

VK OpenAPI при исследовании вернул HTTP 418; его специфическая SDK-сигнатура
не активирована. Неподтверждённый `px4.ads.linkedin.com` не становится pixel
по аналогии с другими hosts. Такие обращения сохраняют общий класс сервиса.
Неподтверждённые collector paths Naver и текущих Google Ads также остаются
общими обращениями. AddThis завершён 31 мая 2023 года: legacy resource не
доказывает работающий трекинг. Произвольные федеративные Mastodon instances
не распознаются по форме пути. Загрузка ShareThis/widget/media SDK сама по
себе не становится tracking-pixel. Legacy Universal Analytics ресурсы не
означают продолжающуюся серверную обработку событий.

## Проверки

Предыдущий baseline: 27 unit cases охватывали semantic preservation, getters, нормальную OAuth
навигацию, отрицательные favicon/profile/path/host сценарии, source redaction,
bridge integrity, ограничение захвата и отзыв доступа. Вместе с прежними
GTM/Pro/geometry fixtures — 82 tests, 82 pass, 0 fail. Для вставок DOM
захваченный native Node.nodeName пропускает обычные узлы до чтения src и
выбирает один native src getter для IMG/SCRIPT/IFRAME. Fake prototypes и
собственные getters страницы не обходят native brand-проверку. Ограниченный fallback
из трёх src getters используется лишь при отсутствии проверенного nodeName.

Предыдущий performance baseline на Chromium 153.0.8010.12,
5000 append/remove, один warmup и шесть измерений:
медиана passive insertion 1.70 ms вместо 38.45 ms до оптимизации, active Pro
14.50 ms вместо 54.95 ms. Общий workload current passive 54.05 ms,
legacy passive 54.70 ms; это локальные измерения конкретных операций.
См. performance.json.

Предыдущий native baseline: Chrome 153.0.8010.12 — 24 checks;
Firefox 138.0.4 — 33 assertions.
SDK/pixel запросы в fixtures обслуживаются loopback/interception; настоящие
социальные сети и login endpoints не вызываются. Проверены пять вкладок,
currentScript внешнего `/main.js`, Pro retention, закрытый popup, полный
локализованный Cookie report table и очистка/отзыв доступа.
Итоговые ссылки на evidence и границы проверки —
native release report.

Текущее расширение: `node --test scripts/test/social-network-detector.test.mjs
scripts/test/social-network-observer.test.mjs scripts/test/social-sensor-runtime.test.mjs
scripts/test/social-expansion-independent-review.test.mjs` — 98 tests,
98 pass, 0 fail, 0 skip (exit 0). Проверены exact source equality обоих MAIN
bundles/bridge, 78 positive source-backed fixtures и отрицательные варианты,
opaque fetch/credentials Proxy, native Request getters, setAttribute/src/insertion
dedup, настоящий installer sendBeacon с true/false/throw и Promise identity.
Rate regression проверяет очередь на границе 499/500 мс, один pending slot
и полный 400 мс response deadline после отправки queued сообщения.
Независимые timer fixtures дополнительно проверяют pagehide до отправки,
32 предварительных сообщения без расходования admission budget, конкурирующие
trusted reads и начало cooldown после позднего ответа.
Независимый review: 63 cases и заключение.
Native текущего расширения: Chrome 153.0.8010.12 — 26 checks;
установленный Firefox 138.0.4 — 35 assertions. В обоих браузерах 13 запросов
к 11 providers обслужены только local stubs. Проверены tracking-sdk/обычный SDK/
pixel, native setAttribute/sendBeacon, exact-resource внешний main.js,
redaction, все admitted Pro rows, локализованные document/row totals и раздельные
browser/page counts. Chrome дополнительно воспроизводит немедленную остановку Pro
после живого чтения и сохраняет все 13 строк после исправления queued bridge.
21 язык проверен на четырёх native UI surfaces; 1157 Vitest + 777 Node проходят.

Новый измеренный hot path включает 30 000 ordinary setAttribute и 5000 src
data-image присваиваний. Passive 1.1 median ordinary/source — 2.45/22.50 ms;
legacy passive — 1.85/17.80 ms. Полный workload — 81.35/74.65 ms соответственно.
Один warmup, шесть измерений; pass-порога нет. Текущий performance.json выше
содержит именно этот расширенный workload; прежние цифры относятся к предыдущему
baseline. Итог, команды, native evidence и архивы.

Исправление верстки: screen container ≤640 px показывает одну строку таблицы
как карточку с четырьмя локализованными полями; ≤400 px подписи стоят над
значениями. Wide/print сохраняют таблицу, explicit roles и scope=col headers.
Независимая native matrix: 92 geometry cases/6 checks, все21языка, RTL,
280/380/560/760 px, safe host253/max count2147483647, 256rows/24docs и A4 print.
Горизонтальное переполнение Telugu/Tamil исправлено. Final package smoke проверяет
карточки и Pro-таблицу в Chrome и установленном Firefox. Актуальный итог верстки и архивы.
