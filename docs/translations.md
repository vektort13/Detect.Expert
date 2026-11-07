# Translation notes

The interface has 21 languages. Russian and English are written by hand. The other 19 are drafts: they follow the wording the interface already uses for each language, but they have not been checked by native speakers yet.

If something reads wrong in your language, please open an issue or a pull request against the locale tables (`apps/production-extension/_locales`, `apps/production-extension/ui-locales` and the `scripts/production-locales-*.mjs` sources). Below are the spots I'm least sure about, per language. Anything else you spot is welcome too.

Text groups mentioned below: **tour** (guided tours), **cookie editor**, **sensor card** (the Antidetect card about observation sensors), **device panel** (Antidetect quick settings).

## Things that affect several languages

- **Cantonese (yue) is written in two scripts.** Most of the interface is Simplified, a few modules (Proxy, Autosurfer, parts of the Firewall and some Antidetect labels) are Traditional. Only the Antidetect device panel has been unified so far (Simplified). A single script would be better; for Hong Kong Traditional is the usual choice.
- **Wu (wuu)** uses different words for the same job in different places (for example the place preposition 勒 / 辣 / 拉, 迭个 / 搿个, 勿 / 弗). A native speaker should pick one.
- **The consent screen title** uses a "monitoring" word in many languages, while the rest of the interface says "observation". There is no single term yet.
- **Telugu, cookie editor:** the strings are written without ZWNJ because the editor's checks reject U+200B–U+200F. The text is readable, but the orthography is not the usual one.
- **Indonesian:** "browser" (99 uses) vs "peramban" (2) in the tables; the Antidetect editor says "peramban".

## Per language

### 简体中文 (zh_CN)

- tour, `step_settings-observation_title`: Заголовок «监测同意» против «观察» в теле того же шага. Заголовок повторяет consent_title UI («监测»), тело — consent_intro UI («观察»): в самом zh_CN UI оба слова. Единый термин выбирать на уровне UI; в туре не менял.
- tour, `step_autosurf-sites_body`: «分类» (category, как в EN/RU туре) против «主题» в фильтре подбора сайтов в UI (EN UI: Topics; vi следует UI — «chủ đề»). Расхождение исходное: EN/RU тур говорит category/категории, UI — Topics/Темы.
- tour, `step_hub-tools_body`: «设置和联系»: «联系» — ярлык вкладки Contacts в UI, но в перечислении читается как глагол; вариант «联系方式». Решать вместе с UI.
- sensor card, `title`: «Antidetect 旁的观察传感器» — калька с «рядом с», как заголовок карточки звучит неестественно; вариант для носителя: «与 Antidetect 并用的观察传感器» или «Antidetect 与观察传感器». Остальные строки карточки на заголовок не ссылаются.
- device panel, `font_noise_hint`: «档案» против «配置» для profile: в самой панели устройства (disclose_headers, headers_applied, headers_inactive) профиль зовётся «配置», в библиотеке и редакторе профилей — «档案» (48 вхождений, «已应用档案», «临时档案»). Подсказка говорит о профиле со своим случайным числом, то есть об объекте библиотеки, поэтому оставил «档案». Единый термин для zh_CN выбирается на уровне …

### Tiếng Việt (vi)

- tour, `eyebrow`: «Tham quan hướng dẫn» — буквально «экскурсия с гидом»; допустимо (Google использует «Tham quan»), но носитель может предпочесть «Hướng dẫn làm quen» / «Tour giới thiệu». tour_label «Tham quan» (9 знаков) укладывается в 12.
- tour, `step_api-transfer_body`: Предложение начинается с «Xuất lưu…» (существительное-ярлык «Xuất» + глагол) и «Nhập sẽ cho bạn xem…» — читается тяжело; то же в step_debug-export_body («Xuất hiển thị…»). Вариант для носителя: «Khi xuất, cấu hình của bạn được lưu thành tệp JSON. Khi nhập, bạn xem được những gì sẽ thay đổi trước khi bất cứ điều gì được áp dụng.»
- tour, `step_generator_title`: «Mẫu cài sẵn»/«ba mẫu» — третий вариант слова preset: UI использует «cấu hình sẵn» (подзаголовок Быстрых настроек) и «Cài đặt sẵn» (фильтр библиотеки), а глобальный пресет API Guard — «cấu hình chung» (так же в туре). Унифицировать лучше на уровне UI; в туре я ничего не менял.
- tour, `step_detector-source_body`: «thẻ» означает и вкладку (tab), и тег (step_library_body: «kèm thẻ và ghi chú»); в step_apply_body — «tab mới». UI смешивает так же («Trên tab này» / «Thẻ và cửa sổ» / «Thẻ: {names}»). Выбор термина — за носителем и владельцем.

### Español (es)

- tour, `step_generator_body`: «que se comunicarán» — без адресата; в UI «informados a los sitios». Допустимо; вариант «que se informarán a los sitios».

### العربية (ar)

- cookie editor, `problem_prefix`: Bidi (проверено в Chromium, dir=rtl): префиксы __Secure-, __Host-, __Http- рисуются зеркально («-Secure__»): ведущие «__» и замыкающий «-» стоят рядом с арабским словом и уходят на другую сторону токена. Текстом это не лечится без управляющих символов (U+200E, U+2066–2069 запрещены обоими валидаторами). Нужна обработка в UI (токен в bdi dir=ltr) либо принят…
- cookie editor, `converter_error_gap`: Пример «UTC+03:00» выбран ради порядка чтения (голое «+03:00» после арабского слова рисуется как «03:00+»), но парсер (cookie-time.js, DATE_TIME) принимает только Z или +hh[:mm] без префикса UTC: пользователь, который допишет «UTC+03:00» дословно, получит ошибку формата. То же в converter_error_ambiguous. Решение за владельцем: оставить, либо вернуть «+03:0…
- cookie editor, `datetime_hint`: Моя правка (в patch): скобочная запись YYYY-MM-DD HH:mm:ss[.fff][Z / ±hh:mm] вместо «.fff وZ أو ±hh:mm» — единственный текстовый способ, при котором .fff и ±hh:mm не зеркалятся (проверено в Chromium). Нужна проверка носителем на приемлемость такой технической записи; то же в converter_error_format. Если запись не нравится, лучше оставить старый текст и реша…
- tour, `step_library_body`: «ولا تفصل الملفات ملفات تعريف الارتباط ولا تخزين المواقع»: «الملف» = профиль (термин UI) стоит впритык к «ملفات تعريف الارتباط» и читается как повтор. Носителю решить: другой глагол («تعزل») или другое слово для cookie в этом предложении. Грамматически верно.
- tour, `step_detector-report_body`: «لم يُلاحَظ» (по EN «Not seen») против «لم يُكتشف» в UI (coverageOff, EN UI: «Not detected»). Расхождение уже в источнике: EN/RU тур («Not seen»/«Не замечено») говорит не так, как EN/RU UI («Not detected»/«Не обнаружено»); остальные языки в этом шаге следуют UI, ar — туру.
- device panel, `font_noise_hint`: Профиль в панели зовётся «الملف» (headers_applied), поэтому «الرقم العشوائي للملف» и «قوائم الملفات المختلفة» грамматически верны и согласованы с панелью, но рядом с «قائمة» читаются как «файл/файлы». Если у носителя есть лучшее слово для profile, менять надо во всей панели сразу. «أصالة» для genuine допустимо; вариант «واقعية».

### Українська (uk)

- tour, `step_autosurf-run_body`: «справжнє введення від вказівника» — неуклюже; вариант «справжнє введення вказівником» или «справжні події вказівника».
- tour, `step_autosurf-switch_body`: «прогін» — калька с ru «прогон»; UI-строки Autosurf используют то же слово (5 вхождений), поэтому тур согласован с UI. Носитель может предпочесть «запуск»/«виконання»; менять нужно вместе с UI.
- tour, `step_proxy-protect_body`: «аварійний вимикач» перефразирует ru-тур; ярлык опции в uk UI — «Kill Switch» (латиницей). В vi/es/ar/fr/zh тур называет опцию её UI-ярлыком.
- device panel, `fonts_hint`: Вне объёма раунда 3, для сведения: в соседней подсказке fonts_hint есть «яких немає у списку Windows» — нарушение милозвучності («немає в списку»). Это единственное, кроме исправленного «Лише в пресеті», нарушение во всей uk-панели устройства (старые строки без исключений).

### Français (fr)

- tour, `*`: Во всём fr (тур, редактор cookie и весь интерфейс) пробелы перед « : ; ? ! » и внутри « » — обычные U+0020, поэтому знак может переноситься на новую строку отдельно. Типографски верны U+00A0/U+202F (валидаторы их не запрещают). Менять только глобально и по всем таблицам fr, а не выборочно; я не менял.
- tour, `step_api-transfer_body`: «avant que quoi que ce soit soit appliqué» грамматически верно, но тяжело (двойное «soit»); вариант «avant d’appliquer quoi que ce soit».
- tour, `step_contacts-social_title`: «Discussions et chaînes»: «chaînes» подходит для видеоканалов, но не для чат-каналов («canaux»); группа в UI называется «Réseaux sociaux». Проверить носителем.
- device panel, `fonts_hint`: Вне объёма раунда 3, для сведения: fonts_hint и uncovered_fonts_metrics используют типографский апостроф ’, а font_noise_hint — прямой ' (как большинство строк панели: 50 прямых против 24 типографских). Панель fr по апострофам не едина; font_noise_hint не менял.

### Português do Brasil (pt_BR)

- tour, `step_hub-overview_body и ещё 10 строк со словом «chave»`: Переключатель назван «chave»: в интерфейсе pt_BR встречаются и «interruptor» (хаб: «Os interruptores funcionam…», редактор Antidetect: «Enquanto o interruptor…»), и «chave geral» (master switch). «Chave» допустимо, но омонимично «chave de API» (этот же текст, шаг Geolocation). Не менял; если решите унифицировать — «interruptor».
- tour, `step_label / tour_tip_resume / resume_hint / skipped`: «Passo» против интерфейса: «Etapa(s)» («Etapas de instalação», «Etapa»). В бразильском португальском «etapa» естественнее для шага мастера/тура. Допустимо оставить «passo».
- cookie editor, `converter_error_ambiguous`: «o relógio é atrasado» (часы «задерживаются») для «clocks go back»; понятно, но естественнее «o relógio volta uma hora» / «os relógios são atrasados».
- device panel, `font_noise_hint`: «as listas de perfis diferentes são diferentes» — дословно повторяет «lists of different profiles differ» и звучит тавтологично; естественнее «as listas de perfis distintos diferem entre si». То же у ur («مختلف پروفائلز کی فہرستیں مختلف»). Не менял: смысл верен, это стиль.

### हिन्दी (hi)

- tour, `step_detector-switch_title / step_detector-switch_body / step_firewall-switch_body / step_settings-observation_* / step_settings-scope_*`: Observation = «निगरानी» (наблюдение/надзор, оттенок surveillance). Так назван заголовок согласия consent_title в интерфейсе hi (и экскурсия на него ссылается), но остальной интерфейс (87 строк, redesign-labels, coverage) говорит «अवलोकन». Интерфейс сам непоследователен; решение — единый термин (рекомендую «अवलोकन» и в consent_title) — за владельцем/носителе…
- tour, `step_apply_body`: «टिप्पणी» (комментарий/примечание) для note рядом с переключателем; естественнее «सूचना» или «नोट» (в шаге library для note уже «नोट»). Не менял из-за неуверенности.
- tour, `done`: «पूरा हुआ» (завершено) для кнопки Done; в хинди-UI обычно «हो गया». Допустимо.
- tour, `step_label / tour_tip_resume`: «कुल {total} में से चरण {n}» — порядок слов необычен (привычнее «चरण {n} / {total}» или «{total} में से चरण {n}»), но грамматически верно и повторяет шаблон интерфейса «{total} में से {done}».
- device panel, `font_noise_hint`: Кавычки « » для названий (preset, строка): панель hi смешивает « » (gpu_hint, region_hint, fix_staged) и “ ” (early_blocked_steps, blocks_parked), у подсказки выбран преобладающий вариант. Не менял.

### اردو (ur)

- tour, `step_detector-switch_* / step_firewall-switch_body / step_settings-observation_* / step_settings-scope_*`: То же, что для hi: «نگرانی» (consent_title) против «مشاہدہ» (67 строк интерфейса, redesign-labels). Единый термин нужен в самом интерфейсе.
- tour, `eyebrow / skip / start / resume / tour_label`: «دورہ» для tour: слово верное (поездка/обход), но в быту скорее «визит»; для «guided tour» часто пишут «گائیڈڈ ٹور»/«ٹور». Рядом в тексте «visit» отдельно передан как «وزٹ», так что неоднозначности нет; решение носителя.
- tour, `entry_hint / step_finish_body`: «سیٹنگ» (разговорное) против интерфейса «ترتیب/ترتیبات» (0 против 92). Допустимо, но можно унифицировать.
- tour, `step_proxy-protect_body`: «کل سوئچ» (kill switch): буквы «کل» читаются как «вчера/завтра/всё», а не «kill». Так называет функцию и сам интерфейс (proxy_workspace_kill_switch), поэтому я не менял; лучше «کِل سوئچ» или «ہنگامی سوئچ», но это решение для всего интерфейса.
- tour, `step_api-scope_*, step_generator_*`: «پری سیٹ» в экскурсии против «پیش سیٹ» в метке Global preset в API Guard (protection_preset). Интерфейс ur сам пишет и так и так.
- cookie editor, `problem_prefix`: BiDi (проверено в Chrome 156, dir=rtl): названия префиксов «__Secure-», «__Host-», «__Http-» показываются как «-Secure__», «-Host__», «-Http__» (ведущие «__» и замыкающий «-» стоят рядом с урду-текстом и «перепрыгивают»). Текстом без невидимых символов это чинится только приведением токена к латинскому окружению, например: «سابقہ والے نام کے لیے موافق خصوصی…
- cookie editor, `converter_unapplied`: «مگر تبدیلی نہیں ہوئی» («но изменения не произошло») двусмысленно: речь о конвертации в Unix-секунды. Понятнее «مگر انہیں بدلا نہیں گیا». Контекст (следующее предложение про стрелки) спасает.
- device panel, `font_noise_label`: Составное «فونٹ فہرست» без изафета; грамматичнее «فونٹس کی فہرست میں شور». Не менял: панель допускает такие сочетания (براؤزر ورژن, براؤزر خاندان), а «شور» совпадает с панелью (شور کی کنجیاں).

### 日本語 (ja)

- tour, `step_settings-observation_title`: Observation в ja тройной: «観測» (183 строки интерфейса и 7 шагов экскурсии), «監視» (consent_title, и в этом заголовке шага), «観察» (redesign-labels/хаб). Экскурсия согласована с заголовком раздела на экране («監視»), но внутри самой экскурсии термины разные. Нужен единый выбор в интерфейсе.
- tour, `step_finish_body`: «あなたの構成» («構成»): в интерфейсе ja для configuration используется «設定» (91 раз), «構成» — 0. Допустимо, но «設定» точнее по терминологии.
- cookie editor, `converter_error_gap / converter_error_ambiguous`: «現地時刻» в сообщениях против подписи «ローカル時刻» у поля; оба верны, но термин разный.
- sensor card, `limit_own`: «外れるのは観測センサーだけです» (самопроизвольное «снимается») вместо активного «取り除くのは». Смысл «убирает только датчики» передан.

### Deutsch (de)

- tour, `tour_label / tour_tip / tour_tip_resume`: Кнопка и подсказки говорят «Rundgang», остальные строки — «Tour» («Geführte Tour», «Tour starten»). Заменить «Rundgang» на «Tour» нельзя: тест требует отличия от EN, а EN tour_label = «Tour» (совпадение). Либо принять смесь, либо менять все строки на «Rundgang»/«Geführter Rundgang».
- tour, `step_api-switch_body / step_api-rules_body`: В интерфейсе de блокировка названа двояко: «Sperren» (protection_block, «optionale API-Sperren», описание расширения) и «Blockieren/Blockierung» (режимы строк, Antidetect, «API-Blockierung»). В step_api-rules_body я поставил «blockieren» (так подписаны кнопки режимов строк), в step_api-switch_body оставил «Sperren» (так называется сама функция «API-Sperren»…
- tour, `step_api-switch_body`: «Gespräche» для calls (вход, звонки): точнее «Anrufe»; допустимо.
- sensor card, `title / paused_ended`: «neben Antidetect» — буквальный перевод «next to Antidetect» (рядом, пространственно); по-немецки естественнее «bei aktivem Antidetect»/«zusammen mit Antidetect». Исходные EN/RU тоже буквальны, поэтому оставлено для единства.

### Polski (pl)

- tour, `step_detector-switch_body / step_detector-report_body`: «kontrole» (проверки) против интерфейса «sprawdzenia» (detectorNote: «Obserwuje sprawdzenia»). Понятно в обоих вариантах.
- tour, `step_api-switch_body`: «rozmów» (разговоров) для calls; точнее «połączeń».
- sensor card, `limit_own`: «w zasadzie» двузначно («в принципе» и «по сути»). Смысл «может заметить» сохранён; точнее «co do zasady» / «teoretycznie».
- device panel, `font_noise_hint`: Знак процента без пробела (3%) в подсказке, а в соседней подсказке панели (issue_dpr_step) во всех языках кроме de стоит «300 %» с пробелом; тест допускает оба написания. Не менял.

### Bahasa Indonesia (id)

- sensor card, `limit_own`: "pada dasarnya" means "basically/essentially", not "in principle"; "secara prinsip" or "pada prinsipnya" is the usual hedge. The statement still says the page can notice, so it is honest, only a little firmer than the source. Not changed.
- tour, `step_settings-observation_title`: Title says "pemantauan" (the wording of the consent screen) while the body of the same card and 73 other places say "pengamatan". Left as is because it matches the consent heading in Settings.
- tour, `step_levels_body`: Antidetect steps say "peramban" (the Antidetect editor wording), other steps say "browser" (99 uses elsewhere in the interface). The product itself is split; the tour follows the section it describes.
- device panel, `font_noise_hint`: "sehingga daftar profil yang berbeda juga berbeda" is tautological ("different ... also different"); "sehingga profil yang berbeda memiliki daftar yang berbeda" reads more naturally. Not changed: it is correct, only clumsy.

### मराठी (mr)

- tour, `eyebrow`: "फेरफटका" means a stroll; for a guided tour of a screen the usual choices are "दौरा", "मार्गदर्शित सफर" or "ओळख". Same word is used in tour_label and in all texts.
- tour, `step_hub-tools_body`: "प्रत्येक आपला स्वतःचा विभाग किंवा आपले स्वतःचे पृष्ठ उघडतो" doubles the reflexive; "प्रत्येक स्वतःचा विभाग किंवा स्वतःचे पृष्ठ उघडतो" may read better.
- cookie editor, `converter_unapplied`: "फील्डमधील बाण" can read as "the arrow inside the field"; "between the fields" would be "फील्डच्या दरम्यानचा बाण".

### తెలుగు (te)

- tour, `entry_hint`: "ఇక్కడ కొత్తా?" is a calque of "New here?"; "ఇక్కడ మీరు కొత్తవారా?" may sound more natural.
- cookie editor, `converter_unapplied`: All Telugu cookie strings are written without the zero-width non-joiner (the cookie table forbids U+200C), so suffixed loanwords render as conjuncts ("ఫీల్డ్ల", "సైట్కు", "సబ్డొమైన్లు", "పోర్ట్ను", "ఫార్మాట్లో"). Readable, but not the usual Telugu orthography; a rewording that avoids suffixes after a virama would be needed to fix it inside this file.

### 한국어 (ko)

- tour, `step_apply_body`: "아무것도 효력이 없습니다" is understandable but stiff; "아무것도 적용되지 않습니다" may be more natural.
- device panel, `region_hint`: Other strings of this panel (region_hint "'자동'", gpu_hint "'이 그래픽 카드(실제)'") still use straight single quotes while early_blocked_steps and blocks_parked use ‘ ’; the whole panel could be normalised to ‘ ’. Outside this round (other keys).

### தமிழ் (ta)

- tour, `eyebrow`: "சுற்றுலா" means a pleasure trip/tourism; "சுற்றுப்பயணம்" or "அறிமுக வழிகாட்டி" may be closer to a guided tour of a screen. Used in tour_label too (8 characters, within the limit of 12).
- tour, `step_generator_body`: "பரிந்துரைக்கப்பட்ட நடுநிலை" for "a recommended middle": "நடுநிலை" can also mean neutrality; "நடுத்தர நிலை" is clearer.
- tour, `step_label`: "{total} இல் படி {n}" is a literal order; "படி {n} / {total}" or "{total} படிகளில் {n}-ஆம் படி" may be more usual.

### 粵語 (yue)

- cookie editor, `converter_error_ambiguous`: "时钟会拨返后" looks garbled (拨返 + 后). Cantonese usually says 时钟会拨慢 / 拨后. Not changed because the intended wording is not certain.
- tour, `step_settings-scope_body`: The tour quotes with 「」 while the Simplified messages table of yue uses “”; the product itself uses both (see report). Left as is.

### 吴语 (wuu)

- sensor card, `toggle`: "Antidetect 开辣个辰光" (also in what and in the quoted label of paused_now): a bare 辣 after the verb is not a usual durative; the card itself uses 辣浪 (加载辣浪, 生效辣浪, 等辣浪) and the interface uses 开着 / 关牢. Candidates: "开辣浪个辰光", "开着个辰光". If changed, change paused_now in the same way: it quotes the toggle label.
- tour, `step_hub-overview_body`: The locative "在" is written both 拉 (about 21 times) and 勒 (10 times) in this tour; the interface writes 勒 (55 uses) and uses 拉 only as the plural "伊拉". Both are attested Wu spellings, so not changed; a native should pick one and the tour could then be normalised.
- tour, `step_detector-switch_body`: "页面浪向" (on the page): "浪向" is not used anywhere else in the interface (it writes 里向 for "inside"); "页面浪" / "页面浪厢" may be the usual form.
- cookie editor, `converter_error_gap`: "搿个本地时间 ... 因为迭个辰光" uses both 搿 and 迭 for "this" in one sentence; the interface mixes the two as well. Meaning is fine ("at that moment" would be 伊个辰光).
- tour, `step_autosurf-plan_body`: "还好设置循环趟数..." uses 好 as the modal "can"; a reader used to Mandarin may take "还好" as "not bad". Probably intended dialect wording.
- device panel, `font_noise_hint`: The hint writes the locative as 辣 (排除辣清单外头, 辣 API 编辑器), the neighbouring fonts_hint writes 勒; both occur in this panel and in the interface (see the earlier unsure item about 辣/勒/拉). A native should pick one.
