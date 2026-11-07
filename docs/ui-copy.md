# Словарь и утверждения UI (E01-01)

Справочник требований и фактических строк `apps/extension/_locales/ru/messages.json` (default) и `apps/extension/_locales/en/messages.json`, сверка 2026-09-12 (F089). Таблицы §2–§6 воспроизводят текущие локали; наличие ключа не доказывает доступность функции. Дополнения интеграции описаны в §6.1. Изменение публичных утверждений требует review в PR. Каждая строка различает **API-use / FP-гипотезу / vendor** (ТЗ VI I3, E01-01). Типы evidence по `PRD.md` §6.

## 1. Принципы формулировок

1. Наблюдение, интерпретация и назначение в целом — три разных уровня в карточке: «вызвано чтение canvas» → «последовательность похожа на построение отпечатка» → «может использоваться для распознавания браузера».
2. Coverage всегда рядом с выводом; пустой список без coverage не показывается.
3. Цвет никогда не единственный носитель смысла. Янтарный — наблюдение, требующее объяснения; красный — ошибка продукта/сбора, не обвинение сайта. Вендор не получает зелёной печати доверия.
4. Формулировка зависит от реально доступных evidence: `page-controlled` данные помечены как потенциально подделываемые; `browser-observed` — как зарегистрированные Chrome.
5. Запрещённые слова: см. §8.

## 2. Состояния coverage

| Ключ | RU | EN | Когда |
| --- | --- | --- | --- |
| `coverage_active_title` | Наблюдение ведётся | Observing | `coverageState=active` |
| `coverage_active_desc` | Датчики установлены с начала загрузки документа. Workers, WebAssembly, CSS и серверные проверки не наблюдаются. | Sensors were installed at document start. Workers, WebAssembly, CSS and server-side checks are not observed. | |
| `coverage_partial_title` | Частичное наблюдение | Partial observation | `coverageState=partial` |
| `coverage_partial_desc` | Наблюдается часть документа: $DETAIL$. Отсутствие находок в недоступных областях ничего не означает. | Only part of the document is observed: $DETAIL$. No findings in inaccessible areas means nothing. | `$DETAIL$` — например «2 фрейма недоступны», «сеть ограничена разрешениями» |
| `coverage_late_start_title` | Наблюдение начато поздно | Observation started late | `coverageState=late-start` |
| `coverage_late_start_desc` | Датчики установлены после начала работы страницы. Ранние вызовы могли быть пропущены. Перезагрузите страницу для анализа с начала. | Sensors were installed after the page started running. Early calls may have been missed. Reload the page to analyse from the start. | |
| `coverage_paused_title` | Наблюдение приостановлено | Observation paused | `coverageState=paused` |
| `coverage_paused_desc` | Наблюдение приостановлено. Страница продолжает работу. | Observation is paused. The page keeps working. | Обязательная формулировка ТЗ VI I5 |
| `coverage_paused_reload` | Чтобы убрать датчики полностью, перезагрузите страницу. | To remove the sensors completely, reload the page. | Показывается, если ownership-check не позволил восстановить оригиналы |
| `coverage_unsupported_title` | На этой странице наблюдение недоступно | Observation is not available on this page | `coverageState=unsupported` |
| `coverage_unsupported_desc` | Встроенные страницы Chrome, Web Store, другие расширения и некоторые специальные фреймы не поддерживают наблюдение. | Built-in Chrome pages, the Web Store, other extensions and some special frames do not support observation. | |
| `coverage_unsupported_chrome_desc` | Эта версия Chrome не поддерживается ($VERSION$). Наблюдение недоступно. | This Chrome version is not supported ($VERSION$). Observation is unavailable. | Несовместимая версия Chrome |
| `coverage_no_access_title` | Нет доступа к этой странице | No access to this page | `coverageState=no-access` |
| `coverage_no_access_desc` | Нет доступа к $HOST$. Отсутствие наблюдений ничего не означает. Выберите уровень наблюдения, чтобы начать. | No access to $HOST$. The absence of observations means nothing. Choose an observation level to start. | Ещё нет разрешения |
| `coverage_revoked_desc` | Доступ к $HOST$ отозван. Новые данные не собираются. Чтобы убрать датчики полностью, перезагрузите страницу. | Access to $HOST$ was revoked. No new data is collected. Reload the page to remove the sensors completely. | Разрешение отозвано |
| `coverage_degraded_title` | Наблюдение ограничено | Observation is limited | `coverageState=degraded` |
| `coverage_degraded_desc` | Превышен лимит событий: часть данных отброшена ($DROPPED$). Этот период нельзя считать полностью наблюдаемым. | The event limit was exceeded: some data was dropped ($DROPPED$). This period cannot be treated as fully observed. | Лимит событий / quota / gap |
| `coverage_context_changed` | Контекст сменился: показан отчёт для $HOST$. | Context changed: showing the report for $HOST$. | Смена документа при открытой панели |
| `coverage_managed_desc` | Часть настроек задана вашей организацией. | Some settings are managed by your organisation. | `storage.managed` |
| `coverage_blind_spots_title` | Известные слепые зоны | Known blind spots | Вкладка «Ограничения» |
| `coverage_blind_spots_desc` | Workers, WebAssembly, декларативный CSS, DNS-резолвер, TLS и серверный антифрод не наблюдаются этим расширением. Расширение может быть замечено сайтом. | Workers, WebAssembly, declarative CSS, the DNS resolver, TLS and server-side anti-fraud are not observed by this extension. The extension can be noticed by the site. | |
| `coverage_flag_no_host_permission` | сеть ограничена разрешениями | network limited by permissions | |
| `coverage_flag_channel_gap` | пробел или конфликт в канале страницы; данные контролируются страницей | page channel gap or conflict; data is page-controlled | |
| `coverage_flag_throttled` | поток событий ограничен | event stream throttled | |
| `coverage_flag_truncated` | подробности сокращены из-за лимита памяти | details truncated due to the memory limit | |
| `coverage_flag_hook_failed` | датчики сообщили об ограничении установки; диагностика контролируется страницей | sensors reported an installation limitation; diagnostics are page-controlled | |
| `coverage_flag_budget_exceeded` | превышен лимит данных наблюдения документа, часть сведений не сохранена | document observation data limit exceeded; some details were not retained | |
| `coverage_flag_protocol_mismatch` | версия датчиков устарела, перезагрузите страницу | sensor version is outdated, reload the page | После обновления расширения |
| `coverage_flag_late_start` | датчики установлены поздно | sensors installed late | `coverageFlags` |
| `coverage_flag_unsupported_realm` | часть контекстов выполнения не поддерживается | some execution contexts are unsupported | `coverageFlags` |
| `coverage_flag_paused` | наблюдение приостановлено | observation paused | `coverageFlags` |
| `coverage_flag_revoked` | доступ отозван | access revoked | `coverageFlags` |
| `coverage_flag_descriptor_nonconfigurable` | часть API нельзя наблюдать: защищённые дескрипторы | some APIs cannot be observed: protected descriptors | `coverageFlags` |
| `coverage_flag_bridge_ring_overflow` | переполнен буфер передачи, часть данных потеряна | transfer buffer overflowed, some data was lost | `coverageFlags` |
| `coverage_flag_restricted_page` | служебная страница браузера | restricted browser page | `coverageFlags` |
| `coverage_flag_worker_not_observed` | workers не наблюдаются | workers are not observed | `coverageFlags` |

## 3. Пустое состояние

Канонические флаги сопоставляются через `packages/ui/src/view-models/coverage.ts`; `network-limited` и `frames-inaccessible` назначает SW по доверенным данным. Число недоступных фреймов не передаётся.

| Ключ | RU | EN |
| --- | --- | --- |
| `empty_no_findings` | За этот период в доступной области находок нет | No findings in the observed area for this period |
| `empty_no_findings_hint` | Это не оценка безопасности сайта. Проверьте область наблюдения выше. | This is not a site safety assessment. Check the observed area above. |

## 4. Карточки

### 4.1 `api-use` — «Использован API» (observed)

| Ключ | RU | EN |
| --- | --- | --- |
| `card_api_use_label` | Использован API | API used |
| `card_api_use_canvas_export` | Вызван экспорт canvas ($API$) — $COUNT$ | Canvas export called ($API$) — $COUNT$ |
| `card_api_use_canvas_readback` | Вызвано чтение пикселей canvas ($API$) — $COUNT$ | Canvas pixel read called ($API$) — $COUNT$ |
| `card_api_use_canvas_text` | Вызовы измерения или отрисовки текста на canvas — $COUNT$ | Canvas text measurement or drawing calls — $COUNT$ |
| `card_api_use_offscreen` | Использован OffscreenCanvas в документе — $COUNT$ | OffscreenCanvas used in the document — $COUNT$ |
| `card_api_use_attempt_only` | Попытка: вызов завершился исключением, результат странице не передан | Attempt only: the call threw, no result was returned to the page |
| `card_api_use_generic_note` | Само по себе обращение к API — обычное дело и не доказывает слежку. | An API call by itself is ordinary and does not prove tracking. |
| `card_api_use_purpose` | В целом этот механизм может использоваться для распознавания браузера. | In general this mechanism can be used to recognise a browser. |

### 4.2 `possible-fingerprinting` — «Есть признаки вычисления отпечатка» (inferred)

| Ключ | RU | EN |
| --- | --- | --- |
| `card_fp_label` | Есть признаки вычисления отпечатка | Signs of fingerprint computation |
| `card_fp_canvas_sequence` | Серия чтений после отрисовки текста похожа на построение отпечатка | A series of reads after drawing text looks like fingerprint construction |
| `card_fp_math_sequence` | Серия численных проверок похожа на известный шаблон | A series of numeric checks looks like a known pattern |
| `card_fp_local_probe` | Серия попыток соединений с локальными адресами похожа на пробу локальной сети | A series of connection attempts to local addresses looks like a local-network probe |
| `card_fp_dns_pattern` | Наблюдается серия запросов к уникальным поддоменам; это бывает при DNS-тестах. Использованный резолвер расширению неизвестен. | A series of requests to unique subdomains was observed; this happens in DNS tests. The resolver used is unknown to the extension. |
| `card_fp_webrtc` | Страница использовала WebRTC. Этот механизм может обращаться к сетевой информации. | The page used WebRTC. This mechanism can access network information. |
| `card_fp_not_proven` | Назначение, уникальность и передача результата этим наблюдением не установлены. | Purpose, uniqueness and transmission of the result are not established by this observation. |
| `card_fp_alternatives` | Обычные объяснения: $ALTERNATIVES$ | Ordinary explanations: $ALTERNATIVES$ |
| `card_fp_insufficient` | Недостаточно данных для вывода | Not enough data for a conclusion |
| `confidence_low` | Низкая уверенность интерпретации | Low interpretation confidence |
| `confidence_medium` | Средняя уверенность интерпретации | Medium interpretation confidence |
| `confidence_high` | Высокая уверенность интерпретации | High interpretation confidence |
| `confidence_unassessed` | Уверенность не оценивалась | Confidence not assessed |

### 4.3 `vendor` — «Распознанные сервисы защиты и идентификации» (catalog + observed)

| Ключ | RU | EN |
| --- | --- | --- |
| `vendorsSectionTitle` | Распознанные сервисы защиты и идентификации | Recognized protection and identification services |
| `card_vendor_found` | Найдены признаки интеграции $VENDOR$ | Signs of $VENDOR$ integration found |
| `card_vendor_purpose` | Назначение сервиса — $PURPOSE$. Это не оценка безопасности сайта. | Service purpose: $PURPOSE$. This is not a site safety assessment. |
| `card_vendor_threatmetrix_purpose` | оценка риска и цифровой идентичности | risk assessment and digital identity |
| `card_vendor_rules` | Правила: $RULES$; источник совпадения: $SOURCE$ | Rules: $RULES$; match source: $SOURCE$ |
| `card_vendor_match_documented_resource` | совпадение с документированным ресурсом | match with a documented resource |
| `card_vendor_match_multi_signal` | несколько независимых признаков | several independent signals |
| `card_vendor_match_weak_signal` | найден элемент интеграции (слабый признак, может быть подделан страницей) | integration element found (weak signal, may be spoofed by the page) |
| `card_vendor_not_linked` | Связь этого сервиса с другими наблюдениями на странице не установлена. | A link between this service and other observations on the page is not established. |
| `card_vendor_unknown` | Поставщик неизвестен | Vendor unknown |
| `card_vendor_no_trust` | Распознанный сервис не является оценкой безопасности сайта и не означает, что все проверки выполняет этот сервис. | A recognised service is not a site safety assessment and does not mean this service performs all checks. |

## 5. Оси доверия (бейджи)

| Ключ | RU | EN |
| --- | --- | --- |
| `integrity_browser_observed` | Наблюдалось браузером | Observed by the browser |
| `integrity_page_controlled` | Данные из контекста страницы, могут быть подделаны | Data from the page context, may be spoofed |
| `integrity_derived` | Вычислено расширением | Derived by the extension |
| `attribution_exact_resource` | Источник вызова: точный ресурс | Call source: exact resource |
| `attribution_sampled_stack` | Источник вызова по выборке стека (может вводить в заблуждение) | Call source from a stack sample (may be misleading) |
| `attribution_frame_only` | Известен только фрейм | Only the frame is known |
| `attribution_unknown` | Источник вызова неизвестен | Call source unknown |
| `count_exact` | точный счётчик | exact count |
| `count_sampled` | выборочный счётчик | sampled count |
| `count_lower_bound` | не менее, были потери | at least, data was lost |

## 6. Действия, onboarding, экспорт

| Ключ | RU | EN |
| --- | --- | --- |
| `actionTitle` | Проверки на странице — detect.expert | Checks on this page — detect.expert |
| `mode_off` | Выключено | Off |
| `mode_active_tab` | Проверять с этого момента | Check from now on |
| `mode_active_tab_desc` | Наблюдения после включения; ранние вызовы могли быть пропущены. | Observations after activation; early calls may have been missed. |
| `mode_site` | Всегда на этом сайте | Always on this site |
| `mode_site_desc` | Перезагрузите страницу для анализа с начала. Ранние вызовы в разрешённых документах при следующей загрузке; сторонняя сеть может быть видна частично. | Reload the page to analyse from the start. Early calls in permitted documents on the next load; third-party network may be partially visible. |
| `mode_all` | На всех сайтах | On all sites |
| `mode_all_desc` | Наиболее широкий доступ, без обещания полного покрытия workers, DNS и серверной логики. | Broadest access, without promising full coverage of workers, DNS or server-side logic. |
| `action_pause` | Приостановить наблюдение в текущем документе | Pause observation in the current document |
| `action_resume` | Возобновить наблюдение | Resume observation |
| `action_reload` | Перезагрузить для анализа с начала | Reload to analyse from the start |
| `action_clear` | Удалить отчёт этого документа | Delete this document's report |
| `action_export` | Экспорт (предпросмотр) | Export (preview) |
| `export_preview_title` | Предпросмотр экспорта | Export preview |
| `export_preview_desc` | В файл попадут только поля ниже (с удалёнными чувствительными данными). Полные URL, значения cookie, результаты API и содержимое ввода отсутствуют. | Only the fields below are included (redacted). Full URLs, cookie values, API results and input contents are absent. |
| `export_save` | Сохранить файл | Save file |
| `export_document_changed` | Документ сменился. Откройте предпросмотр заново. | The document changed. Open the preview again. |
| `onboarding_limits` | Расширение наблюдает уже выполняемые вызовы, не изменяет их результаты и ничего не блокирует. Для этого оно заменяет часть функций браузера обёртками: это может быть замечено сайтом и добавляет время выполнения. Полное покрытие не обещается. | The extension observes calls already being made without changing their results or blocking anything. It replaces some browser functions with wrappers: the site can notice this, and it adds execution time. Full coverage is not promised. |
| `onboarding_no_server` | Расширение не отправляет результаты анализа и не обращается к серверам разработчика. | The extension does not send analysis results and does not contact the developer's servers. |
| `badge_tooltip` | Категорий с находками: $N$ | Categories with findings: $N$ |
| `tab_overview` | Обзор | Overview |
| `tab_techniques` | Техники | Techniques |
| `tab_sources` | Источники | Sources |
| `tab_limits` | Ограничения | Limitations |
| `group_techniques` | Техники | Techniques |
| `group_services` | Сервисы | Services |
| `group_third_party` | Сторонние источники | Third-party sources |
| `aria_live_update` | Отчёт обновлён. Находок: $N$; состояние наблюдения — $STATE$ | Report updated. Findings: $N$; observation state — $STATE$ |

## 6.1 Интеграция локалей 2026-09-12 (F080–F082/F088/F089)

Пропущенные 15 ключей восстановлены area-fixer; таблица ниже синхронизирована с поставляемыми локалями. Пауза адресует текущий документ, DET-003 включает измерение и рисование. Диагностика page hooks контролируется страницей. `coverage_sensor_disabled_desc` и `card_vendor_first_party` зарезервированы для будущих функций; наличие ключа не включает датчики или каталог. Managed export не реализован.

| Ключ | RU | EN |
| --- | --- | --- |
| `scope_active_tab_toolbar` | Чтобы начать наблюдение в текущей вкладке, откройте расширение кнопкой на панели инструментов Chrome и выберите «Проверять с этого момента». | To start observing the current tab, open the extension using its Chrome toolbar button and select “Check from now on”. |
| `export_include_host` | Включить в экспорт хост страницы: | Include the page host in the export: |
| `vendors_catalog_unavailable` | Каталог сервисов отключён: распознавание сервисов не выполнялось. | The service catalog is disabled: service recognition was not performed. |
| `limitation_page_controlled_evidence` | Эти наблюдения получены из контекста страницы и могут быть подделаны ею. | These observations come from the page context and can be forged by the page. |
| `limitation_purpose_unknown` | Цель вызовов API неизвестна. | The purpose of the API calls is unknown. |
| `limitation_uniqueness_not_established` | Уникальность и стабильность результатов не проверялись. | The uniqueness and stability of the results were not tested. |
| `limitation_readback_attempted_failed` | Как минимум одна попытка чтения завершилась исключением; это не подтверждает успешное чтение. | At least one read attempt threw an exception; this does not establish a successful read. |
| `limitation_uncalibrated_threshold` | Пороговые значения правил пока не откалиброваны на корпусе примеров. | Rule thresholds have not yet been calibrated against a corpus of examples. |
| `limitation_coverage_incomplete` | Покрытие наблюдения неполное; часть вызовов могла быть пропущена. | Observation coverage is incomplete; some calls may have been missed. |
| `limitation_catalog_disabled` | Каталог сервисов отключён; связь наблюдений с поставщиками не проверялась. | The service catalog is disabled; links between observations and vendors were not checked. |
| `limitation_text_ops_undifferentiated` | Измерение и рисование текста учитываются вместе; их отдельные количества неизвестны. | Text measurement and drawing are counted together; their separate counts are unknown. |
| `limitation_no_time_window` | Счётчики охватывают время жизни документа и не показывают активность за отдельный короткий интервал. | Counters cover the document lifetime and do not show activity within a separate short interval. |
| `alternative_high_volume_rendering` | Большое число операций с текстом также возможно при обычной работе редактора или построении графиков. | A large number of text operations can also occur during ordinary editing or chart rendering. |
| `coverage_flag_network_limited` | сетевые наблюдения ограничены доступными разрешениями | network observations are limited by available permissions |
| `coverage_flag_frames_inaccessible` | часть фреймов недоступна для наблюдения | some frames are inaccessible for observation |
| `action_pause` | Приостановить наблюдение в текущем документе | Pause observation in the current document |
| `card_api_use_canvas_text` | Вызовы измерения или отрисовки текста на canvas — $COUNT$ | Canvas text measurement or drawing calls — $COUNT$ |
| `coverage_flag_hook_failed` | датчики сообщили об ограничении установки; диагностика контролируется страницей | sensors reported an installation limitation; diagnostics are page-controlled |
| `coverage_flag_channel_gap` | пробел или конфликт в канале страницы; данные контролируются страницей | page channel gap or conflict; data is page-controlled |
| `coverage_sensor_disabled_desc` | Датчик $SENSOR$ отключён ($REASON$). Обращения к этим API не наблюдаются. | Sensor $SENSOR$ is disabled ($REASON$). Calls to these APIs are not observed. |
| `card_vendor_first_party` | Сигнатура поставщика обнаружена на endpoint домена сайта | Vendor signature observed on an endpoint of the site's own domain |
| `options_diagnostics_title` | Диагностика расширения | Extension diagnostics |
| `options_diagnostics_desc` | Только версии и доступность фонового процесса. Адреса страниц и данные отчётов не включаются. | Versions and background availability only. Page addresses and report data are excluded. |
| `options_diagnostics_preview` | Показать диагностический отчёт | Preview diagnostic report |

## 6.2 P11 — первое включение из popup (2026-09-13)

ТЗ V §7, VI I5, ADR-003, REQ-006/014: при `scopeMode: off` или `coverageState: no-access` выбор области открыт сразу после coverage, перед счётчиками и находками. Три радиокнопки выбирают режим; primary-кнопка с названием выбранного режима применяет его. В открытом блоке primary находится сразу под заголовком, перед вариантами и их пояснениями, чтобы длинный перевод не скрывал действие за нижним краем popup. По умолчанию при `off` выбран «Проверять с этого момента». Автоматического запроса разрешений или включения нет. В остальных состояниях настройка находится в свёрнутой секции после действий отчёта. Отсутствие отчёта само по себе не означает отсутствие разрешения.

| Ключ | RU | EN |
| --- | --- | --- |
| `scope_start_title` | Что проверять? | What should be observed? |
| `scope_start_hint` | Выберите область ниже | Choose a scope below |
| `host_access_needed` | Адрес сайта пока недоступен | Site address is not available yet |
| `scope_permission_granted_reload` | Доступ выдан. Перезагрузите страницу, чтобы анализ начался с начала | Access granted. Reload the page to analyse from the start. |
| `action_reload_short` | Перезагрузить | Reload |

Подсказка дополняет прежнее объяснение выключенного состояния. В состоянии активации заголовок использует доступный нормализованный host отчёта или текущей вкладки; если Chrome не раскрыл адрес, показывает `host_access_needed`. В остальных состояниях сохраняется host проекции, включая `host_unknown` после redaction. Host не угадывается, дополнительные разрешения для его чтения не запрашиваются. Выбор «Всегда на этом сайте» при неизвестном host недоступен с существующим объяснением `scope_site_host_unknown`.

После успешного optional-гранта notice переиспользует `scope_permission_granted_reload` и содержит явную кнопку перезагрузки. Отказ оставляет три варианта и полезное объяснение `scope_permission_denied`, без автоматического повторного запроса. Для уже выданного постоянного доступа сохраняется `scope_applied_reload`. В режиме activeTab показывается `late-start`: ранние вызовы могли быть пропущены; перезагрузка не предлагается как способ наблюдать новый документ, поскольку app-grant истекает при cross-document навигации (ADR-003).

Проверки: `packages/ui/test/popup.test.ts`, `packages/ui/test/browser.test.ts`, `tests/extension/popup/activation.spec.ts`; PNG 360×600 свежего профиля без static host grants и 44 снимка состояний — `tests/extension/popup/__screenshots__/`. Первый тест использует настоящий toolbar activeTab через CDP и канал SW без подмены ответов. Popup загружается как страница расширения с test-only `tabId`; это свидетельство headless Chromium, не ручной проверки нативного popup или первого optional-permission диалога Chrome.

## 7. Обязательные формулировки из ТЗ (не менять без ADR)

| Формулировка | Источник |
| --- | --- |
| «Распознанные сервисы защиты и идентификации» | ТЗ V §7, REQ-007 |
| «Найдены признаки интеграции LexisNexis ThreatMetrix. Назначение сервиса — оценка риска и цифровой идентичности. Это не оценка безопасности сайта» | ТЗ V §7 |
| «Наблюдение приостановлено. Страница продолжает работу» | ТЗ VI I5 |
| «Серия численных проверок похожа на известный шаблон» | ТЗ VI I5 |
| «За этот период в доступной области находок нет» + coverage | ТЗ VI I5 |
| «Наблюдается серия запросов к уникальным поддоменам; это бывает при DNS-тестах. Использованный резолвер расширению неизвестен» | ТЗ III §4.3 |
| «Страница использовала WebRTC. Этот механизм может обращаться к сетевой информации» | ТЗ III §4.1 |
| «Сигнатура поставщика обнаружена на endpoint домена сайта» | ТЗ III §4.3; ключ card_vendor_first_party зарезервирован в локалях, каталог не включён (§6.1) |
| «На этой странице наблюдение недоступно» | ТЗ II A8 |
| «Перезагрузить для анализа с начала» | ТЗ V §7 |
| «Расширение не отправляет результаты анализа и не обращается к серверам разработчика» | ТЗ V §1 |

## 8. Запрещённые формулировки

«сайт безопасен», «сайт чист», «всё хорошо» (как единственное состояние), «легитимные антифрод-системы», «утечка доказана», «утечки нет», «сайт украл отпечаток», «аудио прослушивается», «DNS утёк», «ваш процессор определён», «защищает от утечек», «определяет все трекеры», «доказывает мошенничество», «невидимо для сайта», «проверено 100 %», «зашифровано», «анонимизировано», «подтверждено» для правил со статусом candidate/stale.

## 9. Проверка

`pnpm test:unit` запускает `packages/ui/test/locales.test.ts`: паритет ключей RU/EN и placeholder, наличие используемых UI ключей/семейств, ряд обязательных формулировок и регистронезависимый список запрещённых подстрок. `pnpm lint` эти проверки не выполняет (F090). В release обязательны обе команды.

Открытые проверки F089 (E13-01): автоматическая сверка реализованных ключей/текстов этого документа с RU/EN; наличие обязательных `card_vendor_first_party` и `coverage_sensor_disabled_desc` после реализации; контекстные negative cases для «всё хорошо» / «all good» как единственного состояния и «подтверждено» / «confirmed» для candidate/stale. Текущий FORBIDDEN_RU/EN этих контекстных случаев не покрывает. Нельзя глобально запрещать `confirmed`: допустимые контекстные употребления должны иметь положительные тесты. Проверки рендеринга всех требуемых состояний E13-01 остаются приёмкой, а не следствием паритета локалей.
