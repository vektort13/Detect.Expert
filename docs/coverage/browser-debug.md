# Browser Debug — покрытие

ADR-063 / E22-16. Снимки читаются только по команде пользователя из собственного Options; отдельное разрешение на каждый набор. Недоступные API показываются недоступными.

По решению E22-26 Browser Debug находится внутри «Настроек» и отсутствует среди основных вкладок. Прямой #browser-debug сохранён; верхняя вкладка «Настройки» остаётся активной, кнопка возврата открывает #settings. Навигация использует прежний controller active/visibility lifecycle и не загружает снимки автоматически.

| Раздел | Чтение | Изменение |
|---|---|---|
| Обзор | navigator собственного UI, native platform, manifest/собственный storage usage | нет |
| История | последние нативные посещения, поиск | добавить URL текущим временем, удалить точный URL |
| Закладки | последние записи, поиск | создать, title/URL, отдельный move, удалить bookmark |
| Загрузки | metadata; basename без полного локального пути | pause/resume/cancel, удалить запись списка; файлы не удаляются |
| Cookies | metadata только явно указанного origin, store/partition identity | удалить выбранный cookie после native winner check |
| Вкладки | открытые, исключая incognito | pinned/muted/activate |
| Сеансы | recently closed и доступные synced devices | native restore закрытого сеанса |
| Популярные сайты | topSites native | нет |
| Список чтения | Chrome readingList | создать, title/read, удалить |
| Расширения | management metadata | enabled при разрешении браузером; Firefox только themes |
| Privacy | статический allowlist ChromeSetting | boolean set/свой clear; WebRTC policy только переход в API Guard |
| Разрешения сайта | точечный contentSettings lookup указанного origin | точечный set; широкого clear нет |
| Система | доступные system.cpu/memory/storage/display | нет |
| Account | Chrome getProfileUserInfo при явном grant | нет; OAuth не используется |
| Внутренние страницы | статический browser-specific список ссылок | открыть штатную страницу |

Firefox не получает readingList/contentSettings/identity.email/system.* permissions. Privacy и management дополнительно ограничены реально доступными setting/method. Cookies не содержат времени создания/последнего доступа, поскольку native API его не возвращает. Настройки сайтов не являются полным списком всех browser exceptions. Системные идентификаторы и browser account не подменяются редактированием строки в таблице.

200 строк, 2000 scanned, 256 КиБ/снимок, 5 секунд/операция; усечение отмечается. Экспорт одного снимка имеет предварительный просмотр, убирает URL query/fragment/userinfo и account identity; импорт и редактирование бинарных databases не реализованы. Снимки не сохраняются после закрытия Options.

Приёмка: 3519 units, Browser Debug native Chrome 153 — 11 и Firefox 138 — 10 PASS; loaded Firefox 304px/dark/AR и Chrome light/dark/RTL/forced colors проверены. Обычный Chrome 153/155 возвращает display info; headless native system.display.getInfo завершает браузер даже без кода продукта, его headless поддержка не заявляется. Cookie partitionKey:null в Firefox обрабатывается как unpartitioned; store/partition identity видима в Details. Source/native/dist/ZIP proof и границы проверок — в итоговом отчёте.
