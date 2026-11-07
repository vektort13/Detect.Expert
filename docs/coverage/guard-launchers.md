# Antidetect / API Guard / DPI Guard / Firewall

E22-22, [ADR-068](../decisions/ADR-068.md). Первая строка launcher: Antidetect / API Guard; вторая: DPI Guard / Firewall. Название Antidetect открывает вкладку общего управления с исходной вкладкой сайта; компактный ON/OFF меняет только master. DPI Guard пока disabled OFF. В Firefox Firewall disabled OFF согласно ADR-047; Chrome использует прежнее согласие и backend.

| API Guard | Antidetect | Новые документы |
| --- | --- | --- |
| OFF | OFF | Нет блокировок On и подмен Custom |
| OFF | ON | Custom/отпечатки активны, On-блокировки не применяются |
| ON | OFF | On и preset блокировки активны, Custom не применяется |
| ON | ON | Оба семейства согласно выбранным режимам |

Сначала разрешаются global/site/Bypass, затем режим проверяет свой master. Disabled site сохраняет прежнее исключение. Custom не превращается в preset On при выключении Antidetect. Block в Antidetect Network редактирует общий режим On, поэтому подчиняется API Guard. Native WebRTC policy подчиняется Antidetect и прежнему consent; OFF снимает только собственный policy layer, сохраняя выбор. Ранее установленные immutable подмены/handles остаются до новой загрузки документа, а UI сохраняет reloadRequired.

Format5/catalog6 (состояние E22-22) сохранял все143 IDs и весь каталог; текущий format10/catalog11 содержит 158 строк. `enabled` — API Guard; `antidetectEnabled` — Antidetect. Строго проверенные старые форматы мигрируют из прежнего `enabled` в оба masters без включения dormant Custom по одному наличию сохранённых значений. Профиль не включает masters; экспорт/импорт/diff сохраняют оба. Legacy API launcher не сбрасывает Antidetect и библиотеки.

Контроллер launcher использует прежние validated UI routes + fresh CAS, без прямой записи storage. Exact own top-level popup/sidepanel/options; одна физическая операция до settlement, без повторения stale/timeout записи, последующее подтверждение — только чтением. Новых permissions, зависимостей, сетевых соединений и MAIN hooks нет.

Общая CSS поставляется обоим браузерам отдельно от Chrome-only Firewall. При ширине от320 CSS px controls остаются компактными по40px; ниже320 заголовок и ON/OFF располагаются друг под другом внутри каждой карточки, сохраняя сетку2×2 и полный текст. Локализации21, dark/RTL. Firefox test harness учитывает различие между outer window и реальным content viewport; proof измеряет340/234 CSS px непосредственно.

Фактические результаты и границы проверок — в отчёте E22-22. Воспроизведение основных native/package проверок: `pnpm test:guard-launchers`; обязательные privacy/release проверки: `pnpm release:verify`.
