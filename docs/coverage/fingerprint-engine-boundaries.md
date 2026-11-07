# Native профиль и отложенные результаты

Область: [ADR-101](../decisions/ADR-101-fingerprint-engine-boundaries.md).
Доказательства: внутренний отчёт.

| Область | Реализованный путь | Граница |
|---|---|---|
| Реальные CSS/layout | Явно открытая Chrome-сессия: native viewport/screen/DPR, пять media features, genuine stylesheet/MQL | Не весь CSS parser, не arbitrary hover/pointer/dynamic-range, не Firefox |
| Date/Intl/Temporal | Native IANA timezone/locale в сессии; private Date offset context сохраняет native DST | Legacy fixed offset вне native session не является полной моделью Date |
| Dedicated Worker | Ранний packaged bootstrap classic/module/nested/blob в собственном origin | Не SharedWorker/ServiceWorker/worklet, не уже работающие Worker, не Firefox native session |
| Storage quota | Выбранный snapshot, native quota operation отсутствует | Виртуальная metadata семантика ADR-085/086 |
| UAData | Native brand + bounded sequence conversion → selected/neutral snapshot без high-entropy backend | Не воспроизводит физические permission-dependent keys/timing |
| Window MediaCapabilities | Native WebIDL conversion abort до MAIN backend; private extension backend, selected reply | DRM true/opaque handles не фабрикуются; Worker private relay отсутствует |
| Другие native Promise chains | Существующие проверки/проекции сохраняются | RTC live handles и engine-wide isolation не доказаны |

Native session действует в отдельном окне после явного запуска из Antidetect.
С 2026-11-05 ([ADR-104](../decisions/ADR-104-antidetect-privacy-rework.md)) панель запуска
снята с вкладки по решению владельца продукта: код движка остаётся в пакете, пути запуска из
интерфейса нет, а ограничения ниже описывают прежнюю реализацию.
Обычные вкладки автоматически в неё не переводятся. Изменение применяемого
профиля/отзыв доступа останавливает native session; сохранённые JS handles могут
требовать нового документа. Принудительный отрыв Debugger не считается успешным
восстановлением Worker. Окно остаётся доступным для явного закрытия.

Stop восстанавливает текущие принадлежащие установщику дескрипторы Math/Canvas
и сбрасывает Window UA. Уже созданный Worker может сохранить creation-time native
UA, а сохранённые ранее immutable Math/Canvas функции — свою проекцию. Явное
закрытие окна сессии завершает эти Worker; остановка политикой сохраняет работу
пользователя и показывает необходимость закрыть окно. Полного восстановления
всех сохранённых handles без нового документа не заявляем.

Для дробного DPR native CDP может возвращать float-приближение выбранного числа
(в fixture 1.25 → 1.2499999701976776). Проверяется тот же float32 bin и настоящий
CSS/layout; строковое/побитовое равенство произвольного DPR не обещается.

Нет новых permissions/CSP/dependencies/телеметрии. Detector и Protect не меняются.
Списки unsupported fields и состояния runtime partial показываются отдельно от
состояния подключения; успешная компиляция не означает успешного native apply.
