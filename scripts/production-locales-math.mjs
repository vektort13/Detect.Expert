// User-requested Math controls: localized UI, without browser probes or external resources.
const FIELDS = Object.freeze(['title', 'description', 'mode', 'allow', 'spoof', 'inherited', 'search', 'selected', 'all', 'clear', 'empty', 'group_trig', 'group_hyperbolic', 'group_exp_log', 'group_power', 'precision', 'stability', 'special_cases', 'coverage', 'method', 'status_active', 'status_allow', 'status_inactive', 'status_unknown', 'status_pending', 'status_error', 'functions', 'pow_note', 'status_empty', 'opaque', 'primitive_numbers']);
export const MATH_UI_KEYS = Object.freeze(FIELDS.map(key => 'antidetect_math_' + key));
export const MATH_UI_ALIAS_KEYS = Object.freeze(['protection_feature_math_transcendentals']);
const COPY = {
  en: [
    'Transcendental Math functions|23 JavaScript Math functions|Math mode|Allow|Stable spoofing|Inherited from API Guard|Search functions|Selected|Select all|Clear selection|No matching functions|Trigonometric|Hyperbolic|Exponential and logarithmic|Powers',
    'Eligible results change by at most 1 ULP.|Repeated calls are stable within one origin and browser session.|Exact and special results are preserved.|Workers, the ** operator, WebAssembly and CSS calculations are outside this control.|Method: deterministic result spoofing, without cross-engine normalization.|Stable spoofing active|Original Math results|Inactive|Effective state: —|Waiting for page reload|Not applied|Functions to modify|Math.pow and the ** operator use separate paths.'
  ],
  ru: [
    'Трансцендентные функции Math|23 функций JavaScript Math|Режим Math|Разрешить|Стабильная подмена|Наследуется из API Guard|Поиск функций|Выбрано|Выбрать все|Снять выбор|Подходящих функций нет|Тригонометрические|Гиперболические|Экспоненты и логарифмы|Степени',
    'Подходящие результаты изменяются не более чем на 1 ULP.|Повторные вызовы стабильны в пределах origin и сеанса браузера.|Точные и специальные результаты сохраняются.|Workers, оператор **, WebAssembly и вычисления CSS не охватываются.|Метод: детерминированная подмена результатов без нормализации между движками.|Стабильная подмена активна|Исходные результаты Math|Неактивно|Фактическое состояние: —|Ожидается перезагрузка страницы|Не применено|Функции для подмены|Math.pow и оператор ** используют разные пути вычисления.'
  ],
  zh_CN: [
    'Math 超越函数|23 个 JavaScript Math 函数|Math 模式|允许|稳定替换|继承自 API Guard|搜索函数|已选择|全选|清除选择|没有匹配函数|三角函数|双曲函数|指数与对数|幂函数',
    '符合条件的结果最多改变 1 ULP。|重复调用在同一来源和浏览器会话内保持稳定。|保留精确结果和特殊结果。|不涵盖 Workers、** 运算符、WebAssembly 和 CSS 计算。|方法：确定性结果替换，不进行跨引擎标准化。|稳定替换已生效|原始 Math 结果|未生效|实际状态：—|等待页面重新加载|未应用|需要替换的函数|Math.pow 和 ** 运算符使用独立的计算路径。'
  ],
  vi: [
    'Hàm Math siêu việt|23 hàm JavaScript Math|Chế độ Math|Cho phép|Thay thế ổn định|Kế thừa từ API Guard|Tìm hàm|Đã chọn|Chọn tất cả|Bỏ chọn|Không có hàm phù hợp|Lượng giác|Hyperbolic|Hàm mũ và logarit|Lũy thừa',
    'Kết quả phù hợp thay đổi tối đa 1 ULP.|Các lần gọi lặp lại ổn định trong cùng origin và phiên trình duyệt.|Giữ nguyên kết quả chính xác và đặc biệt.|Không bao gồm Workers, toán tử **, WebAssembly và phép tính CSS.|Phương pháp: thay thế kết quả xác định, không chuẩn hóa giữa các bộ máy.|Thay thế ổn định đang hoạt động|Kết quả Math gốc|Không hoạt động|Trạng thái thực tế: —|Đang chờ tải lại trang|Chưa áp dụng|Hàm cần thay thế|Math.pow và toán tử ** dùng các đường tính toán riêng.'
  ],
  es: [
    'Funciones trascendentes de Math|23 funciones de JavaScript Math|Modo Math|Permitir|Sustitución estable|Heredado de API Guard|Buscar funciones|Seleccionadas|Seleccionar todo|Quitar selección|No hay funciones coincidentes|Trigonométricas|Hiperbólicas|Exponenciales y logarítmicas|Potencias',
    'Los resultados aptos cambian como máximo 1 ULP.|Las llamadas repetidas son estables dentro del mismo origen y sesión del navegador.|Se conservan los resultados exactos y especiales.|No abarca Workers, el operador **, WebAssembly ni los cálculos CSS.|Método: sustitución determinista de resultados, sin normalización entre motores.|Sustitución estable activa|Resultados Math originales|Inactivo|Estado efectivo: —|Esperando recarga de la página|No aplicado|Funciones que sustituir|Math.pow y el operador ** usan rutas de cálculo distintas.'
  ],
  ar: [
    'دوال Math المتسامية|23 دالة JavaScript Math|وضع Math|سماح|تبديل ثابت|موروث من API Guard|البحث عن دوال|المحدد|تحديد الكل|إلغاء التحديد|لا توجد دوال مطابقة|مثلثية|زائدية|أسية ولوغاريتمية|القوى',
    'تتغير النتائج المؤهلة بما لا يزيد عن 1 ULP.|تظل الاستدعاءات المتكررة ثابتة ضمن الأصل وجلسة المتصفح نفسيهما.|تُحفظ النتائج الدقيقة والخاصة.|لا يشمل Workers أو العامل ** أو WebAssembly أو حسابات CSS.|الطريقة: تبديل حتمي للنتائج دون توحيد النتائج بين المحركات.|التبديل الثابت نشط|نتائج Math الأصلية|غير نشط|الحالة الفعلية: —|بانتظار إعادة تحميل الصفحة|لم يُطبق|الدوال المراد تعديلها|تستخدم Math.pow والعامل ** مسارين حسابيين منفصلين.'
  ],
  uk: [
    'Трансцендентні функції Math|23 функцій JavaScript Math|Режим Math|Дозволити|Стабільна підміна|Успадковується з API Guard|Пошук функцій|Вибрано|Вибрати всі|Зняти вибір|Відповідних функцій немає|Тригонометричні|Гіперболічні|Експоненти й логарифми|Степені',
    'Відповідні результати змінюються не більше ніж на 1 ULP.|Повторні виклики стабільні в межах origin і сеансу браузера.|Точні та спеціальні результати зберігаються.|Workers, оператор **, WebAssembly й обчислення CSS не охоплюються.|Метод: детермінована підміна результатів без нормалізації між рушіями.|Стабільна підміна активна|Початкові результати Math|Неактивно|Фактичний стан: —|Очікується перезавантаження сторінки|Не застосовано|Функції для підміни|Math.pow і оператор ** використовують різні шляхи обчислення.'
  ],
  fr: [
    'Fonctions transcendantes de Math|23 fonctions JavaScript Math|Mode Math|Autoriser|Substitution stable|Hérité d’API Guard|Rechercher des fonctions|Sélectionnées|Tout sélectionner|Tout désélectionner|Aucune fonction correspondante|Trigonométriques|Hyperboliques|Exponentielles et logarithmiques|Puissances',
    'Les résultats admissibles varient d’au plus 1 ULP.|Les appels répétés restent stables pour une même origine et session du navigateur.|Les résultats exacts et spéciaux sont conservés.|Les Workers, l’opérateur **, WebAssembly et les calculs CSS ne sont pas couverts.|Méthode : substitution déterministe des résultats, sans normalisation entre moteurs.|Substitution stable active|Résultats Math d’origine|Inactif|État effectif : —|En attente du rechargement|Non appliqué|Fonctions à modifier|Math.pow et l’opérateur ** utilisent des chemins de calcul distincts.'
  ],
  pt_BR: [
    'Funções transcendentes de Math|23 funções JavaScript Math|Modo Math|Permitir|Substituição estável|Herdado do API Guard|Pesquisar funções|Selecionadas|Selecionar todas|Limpar seleção|Nenhuma função correspondente|Trigonométricas|Hiperbólicas|Exponenciais e logarítmicas|Potências',
    'Os resultados elegíveis mudam no máximo 1 ULP.|Chamadas repetidas são estáveis na mesma origem e sessão do navegador.|Resultados exatos e especiais são preservados.|Não abrange Workers, o operador **, WebAssembly e cálculos CSS.|Método: substituição determinística de resultados, sem normalização entre motores.|Substituição estável ativa|Resultados Math originais|Inativo|Estado efetivo: —|Aguardando recarregar a página|Não aplicado|Funções a modificar|Math.pow e o operador ** usam caminhos de cálculo separados.'
  ],
  hi: [
    'Math के ट्रान्सेंडेंटल फ़ंक्शन|23 JavaScript Math फ़ंक्शन|Math मोड|अनुमति दें|स्थिर बदलाव|API Guard से लिया गया|फ़ंक्शन खोजें|चुने गए|सभी चुनें|चयन हटाएँ|कोई मेल खाता फ़ंक्शन नहीं|त्रिकोणमितीय|हाइपरबोलिक|घातीय और लघुगणकीय|घात',
    'योग्य परिणाम अधिकतम 1 ULP बदलते हैं।|एक ही origin और ब्राउज़र सत्र में बार-बार किए गए कॉल स्थिर रहते हैं।|सटीक और विशेष परिणाम बने रहते हैं।|Workers, ** ऑपरेटर, WebAssembly और CSS गणनाएँ शामिल नहीं हैं।|तरीका: परिणामों में नियतात्मक बदलाव, इंजन के बीच सामान्यीकरण नहीं।|स्थिर बदलाव सक्रिय है|मूल Math परिणाम|निष्क्रिय|वास्तविक स्थिति: —|पेज दोबारा लोड होने की प्रतीक्षा|लागू नहीं हुआ|बदलने वाले फ़ंक्शन|Math.pow और ** ऑपरेटर अलग गणना पथ इस्तेमाल करते हैं।'
  ],
  ur: [
    'Math کے ماورائی فنکشنز|23 JavaScript Math فنکشنز|Math موڈ|اجازت دیں|مستحکم تبدیلی|API Guard سے وراثت|فنکشنز تلاش کریں|منتخب|سب منتخب کریں|انتخاب ختم کریں|کوئی مماثل فنکشن نہیں|مثلثی|ہائپربولک|قوت نمائی اور لوگارتھمی|قوتیں',
    'اہل نتائج زیادہ سے زیادہ 1 ULP بدلتے ہیں۔|ایک ہی origin اور براؤزر سیشن میں بار بار کی کالز مستحکم رہتی ہیں۔|درست اور خصوصی نتائج برقرار رہتے ہیں۔|Workers، ** آپریٹر، WebAssembly اور CSS حساب شامل نہیں۔|طریقہ: نتائج کی متعین تبدیلی، انجنوں کے درمیان نارملائزیشن نہیں۔|مستحکم تبدیلی فعال ہے|اصل Math نتائج|غیر فعال|اصل حالت: —|صفحہ دوبارہ لوڈ ہونے کا انتظار|لاگو نہیں ہوا|تبدیل کیے جانے والے فنکشنز|Math.pow اور ** آپریٹر الگ حسابی راستے استعمال کرتے ہیں۔'
  ],
  ja: [
    'Math 超越関数|23 個の JavaScript Math 関数|Math モード|許可|安定した置換|API Guard から継承|関数を検索|選択済み|すべて選択|選択を解除|一致する関数がありません|三角関数|双曲線関数|指数・対数関数|べき乗',
    '対象の結果の変化は最大 1 ULP です。|同一オリジンとブラウザーセッション内では、繰り返し呼び出しの結果が安定します。|厳密な結果と特殊値は保持されます。|Workers、** 演算子、WebAssembly、CSS 計算は対象外です。|方式：結果の決定的な置換です。エンジン間の正規化は行いません。|安定した置換が有効|元の Math 結果|無効|実際の状態：—|ページの再読み込み待ち|未適用|変更する関数|Math.pow と ** 演算子は別の計算経路を使います。'
  ],
  de: [
    'Transzendente Math-Funktionen|23 JavaScript-Math-Funktionen|Math-Modus|Erlauben|Stabile Ersetzung|Von API Guard übernommen|Funktionen suchen|Ausgewählt|Alle auswählen|Auswahl aufheben|Keine passenden Funktionen|Trigonometrisch|Hyperbolisch|Exponential und logarithmisch|Potenzen',
    'Geeignete Ergebnisse ändern sich um höchstens 1 ULP.|Wiederholte Aufrufe bleiben innerhalb desselben Ursprungs und derselben Browsersitzung stabil.|Exakte und spezielle Ergebnisse bleiben erhalten.|Workers, der Operator **, WebAssembly und CSS-Berechnungen sind nicht abgedeckt.|Methode: deterministische Ergebnisersetzung ohne engineübergreifende Normalisierung.|Stabile Ersetzung aktiv|Ursprüngliche Math-Ergebnisse|Inaktiv|Tatsächlicher Zustand: —|Wartet auf Neuladen der Seite|Nicht angewendet|Zu ändernde Funktionen|Math.pow und der Operator ** nutzen getrennte Berechnungswege.'
  ],
  pl: [
    'Funkcje przestępne Math|23 funkcji JavaScript Math|Tryb Math|Zezwól|Stabilna podmiana|Dziedziczone z API Guard|Szukaj funkcji|Wybrano|Wybierz wszystkie|Wyczyść wybór|Brak pasujących funkcji|Trygonometryczne|Hiperboliczne|Wykładnicze i logarytmiczne|Potęgi',
    'Odpowiednie wyniki zmieniają się najwyżej o 1 ULP.|Powtarzane wywołania są stabilne w ramach tego samego origin i sesji przeglądarki.|Dokładne i specjalne wyniki są zachowane.|Nie obejmuje Workers, operatora **, WebAssembly i obliczeń CSS.|Metoda: deterministyczna podmiana wyników bez normalizacji między silnikami.|Stabilna podmiana aktywna|Oryginalne wyniki Math|Nieaktywne|Stan rzeczywisty: —|Oczekiwanie na ponowne wczytanie strony|Nie zastosowano|Funkcje do zmiany|Math.pow i operator ** używają oddzielnych ścieżek obliczeń.'
  ],
  id: [
    'Fungsi transendental Math|23 fungsi JavaScript Math|Mode Math|Izinkan|Penggantian stabil|Diwarisi dari API Guard|Cari fungsi|Dipilih|Pilih semua|Hapus pilihan|Tidak ada fungsi yang cocok|Trigonometri|Hiperbolik|Eksponensial dan logaritmik|Pangkat',
    'Hasil yang memenuhi syarat berubah paling banyak 1 ULP.|Pemanggilan berulang stabil dalam origin dan sesi browser yang sama.|Hasil tepat dan khusus dipertahankan.|Tidak mencakup Workers, operator **, WebAssembly, dan perhitungan CSS.|Metode: penggantian hasil deterministik tanpa normalisasi antarmesin.|Penggantian stabil aktif|Hasil Math asli|Tidak aktif|Status sebenarnya: —|Menunggu halaman dimuat ulang|Tidak diterapkan|Fungsi yang diubah|Math.pow dan operator ** memakai jalur perhitungan terpisah.'
  ],
  mr: [
    'Math ची ट्रान्सेंडेंटल फंक्शन्स|23 JavaScript Math फंक्शन्स|Math मोड|परवानगी द्या|स्थिर बदल|API Guard कडून वारसा|फंक्शन्स शोधा|निवडलेले|सर्व निवडा|निवड काढा|जुळणारी फंक्शन्स नाहीत|त्रिकोणमितीय|हायपरबोलिक|घातांकीय आणि लघुगणकीय|घात',
    'योग्य परिणाम जास्तीत जास्त 1 ULP बदलतात.|एकाच origin आणि ब्राउझर सत्रात पुन्हा केलेले कॉल स्थिर राहतात.|अचूक आणि विशेष परिणाम कायम राहतात.|Workers, ** ऑपरेटर, WebAssembly आणि CSS गणना समाविष्ट नाहीत.|पद्धत: परिणामांचा निर्धारक बदल; इंजिनदरम्यान सामान्यीकरण नाही.|स्थिर बदल सक्रिय आहे|मूळ Math परिणाम|निष्क्रिय|प्रत्यक्ष स्थिती: —|पृष्ठ पुन्हा लोड होण्याची प्रतीक्षा|लागू झाले नाही|बदलायची फंक्शन्स|Math.pow आणि ** ऑपरेटर वेगवेगळे गणना मार्ग वापरतात.'
  ],
  te: [
    'Math అతీంద్రియ ఫంక్షన్‌లు|23 JavaScript Math ఫంక్షన్‌లు|Math విధానం|అనుమతించు|స్థిరమైన మార్పు|API Guard నుంచి వారసత్వం|ఫంక్షన్‌లు వెతకండి|ఎంచుకున్నవి|అన్నీ ఎంచుకోండి|ఎంపిక తొలగించండి|సరిపోలే ఫంక్షన్‌లు లేవు|త్రికోణమితి|హైపర్‌బోలిక్|ఘాతాంక, సంవర్గమాన|ఘాతాలు',
    'అర్హమైన ఫలితాలు గరిష్ఠంగా 1 ULP మారతాయి.|ఒకే origin, బ్రౌజర్ సెషన్‌లో పునరావృత కాల్‌లు స్థిరంగా ఉంటాయి.|ఖచ్చితమైన, ప్రత్యేక ఫలితాలు అలాగే ఉంటాయి.|Workers, ** ఆపరేటర్, WebAssembly, CSS లెక్కింపులు కవర్ కావు.|పద్ధతి: ఫలితాల నిర్ణీత మార్పు; ఇంజిన్‌ల మధ్య సాధారణీకరణ కాదు.|స్థిరమైన మార్పు అమల్లో ఉంది|అసలు Math ఫలితాలు|క్రియారహితం|వాస్తవ స్థితి: —|పేజీ మళ్లీ లోడ్ కోసం వేచి ఉంది|వర్తించలేదు|మార్చాల్సిన ఫంక్షన్‌లు|Math.pow, ** ఆపరేటర్ వేర్వేరు గణన మార్గాలను వాడతాయి.'
  ],
  ko: [
    'Math 초월함수|23개 JavaScript Math 함수|Math 모드|허용|안정적 변경|API Guard에서 상속|함수 검색|선택됨|모두 선택|선택 해제|일치하는 함수 없음|삼각함수|쌍곡함수|지수와 로그|거듭제곱',
    '대상 결과는 최대 1 ULP 변경됩니다.|동일한 출처와 브라우저 세션에서는 반복 호출 결과가 안정적으로 유지됩니다.|정확한 결과와 특수 결과는 유지됩니다.|Workers, ** 연산자, WebAssembly, CSS 계산은 적용 범위에 포함되지 않습니다.|방식: 결과를 결정적으로 변경하며 엔진 간 정규화는 수행하지 않습니다.|안정적 변경 활성|원래 Math 결과|비활성|실제 상태: —|페이지 새로고침 대기|적용되지 않음|변경할 함수|Math.pow와 ** 연산자는 별도의 계산 경로를 사용합니다。'
  ],
  ta: [
    'Math விஞ்சிய சார்புகள்|23 JavaScript Math சார்புகள்|Math முறை|அனுமதி|நிலையான மாற்றம்|API Guard-இலிருந்து பெறப்பட்டது|சார்புகளைத் தேடு|தேர்ந்தெடுத்தவை|அனைத்தையும் தேர்ந்தெடு|தேர்வை நீக்கு|பொருந்தும் சார்புகள் இல்லை|முக்கோணவியல்|அதிபரவளைய|அடுக்குக்குறி மற்றும் மடக்கை|அடுக்குகள்',
    'தகுதியான முடிவுகள் அதிகபட்சம் 1 ULP மாறும்.|ஒரே origin மற்றும் உலாவி அமர்வில் மீண்டும் செய்யும் அழைப்புகள் நிலையாக இருக்கும்.|துல்லியமான மற்றும் சிறப்பு முடிவுகள் தக்கவைக்கப்படும்.|Workers, ** இயக்கி, WebAssembly, CSS கணக்கீடுகள் இதில் அடங்காது.|முறை: முடிவுகளின் நிர்ணய மாற்றம்; இயந்திரங்களுக்கு இடையிலான இயல்பாக்கம் அல்ல.|நிலையான மாற்றம் செயலில் உள்ளது|அசல் Math முடிவுகள்|செயலற்றது|உண்மையான நிலை: —|பக்க மறுஏற்றத்துக்காகக் காத்திருக்கிறது|பயன்படுத்தப்படவில்லை|மாற்ற வேண்டிய சார்புகள்|Math.pow மற்றும் ** இயக்கி தனித்தனி கணக்கீட்டுப் பாதைகளைப் பயன்படுத்துகின்றன.'
  ],
  yue: [
    'Math 超越函数|23 个 JavaScript Math 函数|Math 模式|允许|稳定替换|由 API Guard 继承|搜寻函数|已拣|全选|清除选择|冇符合嘅函数|三角函数|双曲函数|指数同对数|幂函数',
    '合适嘅结果最多改变 1 ULP。|同一来源同浏览器工作阶段嘅重复调用会保持稳定。|保留精确结果同特殊结果。|唔涵盖 Workers、** 运算符、WebAssembly 同 CSS 计算。|方法：确定性结果替换，唔会做跨引擎标准化。|稳定替换已生效|原本 Math 结果|未生效|实际状态：—|等紧重新载入网页|未套用|要替换嘅函数|Math.pow 同 ** 运算符用唔同嘅计算路径。'
  ],
  wuu: [
    'Math 超越函数|23 个 JavaScript Math 函数|Math 模式|允许|稳定替换|从 API Guard 继承|搜索函数|已选|全选|清除选择|呒没匹配个函数|三角函数|双曲函数|指数搭对数|幂函数',
    '合适个结果最多改变 1 ULP。|同一来源搭浏览器会话里个重复调用保持稳定。|保留精确结果搭特殊结果。|弗涵盖 Workers、** 运算符、WebAssembly 搭 CSS 计算。|方法：确定性结果替换，弗做跨引擎标准化。|稳定替换已生效|原来个 Math 结果|弗生效|实际状态：—|等待页面重新载入|呒没应用|要替换个函数|Math.pow 搭 ** 运算符使用单独个计算路径。'
  ]
};
const EMPTY = {
  en: 'No functions selected', ru: 'Функции не выбраны', zh_CN: '未选择函数', vi: 'Chưa chọn hàm', es: 'No hay funciones seleccionadas',
  ar: 'لم تُحدد أي دوال', uk: 'Функції не вибрано', fr: 'Aucune fonction sélectionnée', pt_BR: 'Nenhuma função selecionada',
  hi: 'कोई फ़ंक्शन नहीं चुना', ur: 'کوئی فنکشن منتخب نہیں', ja: '関数未選択', de: 'Keine Funktionen ausgewählt', pl: 'Nie wybrano funkcji',
  id: 'Belum ada fungsi dipilih', mr: 'फंक्शन्स निवडलेली नाहीत', te: 'ఫంక్షన్‌లు ఎంచుకోలేదు', ko: '선택한 함수 없음',
  ta: 'சார்புகள் தேர்ந்தெடுக்கப்படவில்லை', yue: '未拣函数', wuu: '呒没选函数'
};
const OPAQUE = {
  en: 'In inaccessible opaque frames, functions in this group are disabled.',
  ru: 'В недоступных непрозрачных фреймах функции этой группы отключены.',
  zh_CN: '在无法访问的不透明框架中，此组函数会被禁用。',
  vi: 'Trong khung opaque không thể truy cập, các hàm của nhóm này bị vô hiệu hóa.',
  es: 'En marcos opacos inaccesibles, las funciones de este grupo están deshabilitadas.',
  ar: 'في الإطارات المعتمة التي يتعذر الوصول إليها، تُعطل دوال هذه المجموعة.',
  uk: 'У недоступних непрозорих фреймах функції цієї групи вимкнено.',
  fr: 'Dans les cadres opaques inaccessibles, les fonctions de ce groupe sont désactivées.',
  pt_BR: 'Em frames opacos inacessíveis, as funções deste grupo são desativadas.',
  hi: 'जिन अपारदर्शी फ़्रेम तक पहुँच नहीं है, उनमें इस समूह के फ़ंक्शन बंद रहते हैं।',
  ur: 'ناقابلِ رسائی مبہم فریمز میں اس گروپ کے فنکشنز غیر فعال ہوتے ہیں۔',
  ja: 'アクセスできない不透明なフレームでは、このグループの関数は無効になります。',
  de: 'In nicht zugänglichen opaken Frames sind die Funktionen dieser Gruppe deaktiviert.',
  pl: 'W niedostępnych nieprzezroczystych ramkach funkcje tej grupy są wyłączone.',
  id: 'Dalam frame opak yang tidak dapat diakses, fungsi dalam grup ini dinonaktifkan.',
  mr: 'प्रवेश न करता येणाऱ्या अपारदर्शक फ्रेममध्ये या गटाची फंक्शन्स बंद असतात.',
  te: 'అందుబాటులో లేని అపారదర్శక ఫ్రేమ్‌లలో ఈ సమూహపు ఫంక్షన్‌లు నిలిపివేయబడతాయి.',
  ko: '접근할 수 없는 불투명 프레임에서는 이 그룹의 함수가 비활성화됩니다.',
  ta: 'அணுக முடியாத ஒளிபுகா ஃப்ரேம்களில் இந்தக் குழுவின் சார்புகள் முடக்கப்படும்.',
  yue: '喺存取唔到嘅不透明框架入面，呢组函数会停用。',
  wuu: '勒访问弗到个不透明框架里，搿组函数会停用。'
};
const REGISTERED = {
  en: 'Registered for new pages', ru: 'Зарегистрировано для новых страниц', zh_CN: '已为新页面注册', vi: 'Đã đăng ký cho trang mới',
  es: 'Registrado para páginas nuevas', ar: 'مسجل للصفحات الجديدة', uk: 'Зареєстровано для нових сторінок', fr: 'Enregistré pour les nouvelles pages',
  pt_BR: 'Registrado para novas páginas', hi: 'नए पेजों के लिए पंजीकृत', ur: 'نئے صفحات کے لیے رجسٹرڈ', ja: '新しいページ向けに登録済み',
  de: 'Für neue Seiten registriert', pl: 'Zarejestrowano dla nowych stron', id: 'Terdaftar untuk halaman baru', mr: 'नवीन पृष्ठांसाठी नोंदणीकृत',
  te: 'కొత్త పేజీల కోసం నమోదు అయింది', ko: '새 페이지에 적용하도록 등록됨', ta: 'புதிய பக்கங்களுக்குப் பதிவுசெய்யப்பட்டது', yue: '已为新网页注册', wuu: '已为新页面注册'
};
const PRIMITIVES = {
  en: 'Spoofing applies only to primitive Number arguments. The browser handles other argument types without spoofing.',
  ru: 'Подмена применяется только к примитивным аргументам Number. Остальные типы обрабатываются браузером без подмены.',
  zh_CN: '仅替换原始 Number 类型参数的结果。其他参数类型由浏览器按原始方式处理。',
  vi: 'Chỉ thay thế với đối số Number nguyên thủy. Trình duyệt xử lý các kiểu đối số khác mà không thay thế.',
  es: 'La sustitución solo se aplica a argumentos Number primitivos. El navegador procesa los demás tipos sin sustitución.',
  ar: 'يُطبق التبديل على وسائط Number الأولية فقط. يعالج المتصفح أنواع الوسائط الأخرى دون تبديل.',
  uk: 'Підміна застосовується лише до примітивних аргументів Number. Інші типи обробляє браузер без підміни.',
  fr: 'La substitution s’applique uniquement aux arguments primitifs Number. Le navigateur traite les autres types sans substitution.',
  pt_BR: 'A substituição se aplica apenas a argumentos Number primitivos. O navegador processa os outros tipos sem substituição.',
  hi: 'बदलाव केवल primitive Number तर्कों पर लागू होता है। अन्य प्रकार के तर्क ब्राउज़र बिना बदलाव के संभालता है।',
  ur: 'تبدیلی صرف primitive Number دلائل پر لاگو ہوتی ہے۔ دیگر اقسام کے دلائل براؤزر بغیر تبدیلی کے سنبھالتا ہے۔',
  ja: '置換はプリミティブの Number 引数にのみ適用されます。他の型の引数はブラウザーが置換せずに処理します。',
  de: 'Die Ersetzung gilt nur für primitive Number-Argumente. Andere Argumenttypen verarbeitet der Browser ohne Ersetzung.',
  pl: 'Podmiana dotyczy tylko pierwotnych argumentów Number. Pozostałe typy argumentów obsługuje przeglądarka bez podmiany.',
  id: 'Penggantian hanya berlaku untuk argumen Number primitif. Jenis argumen lain ditangani browser tanpa penggantian.',
  mr: 'बदल फक्त primitive Number वितर्कांना लागू होतो. इतर प्रकारचे वितर्क ब्राउझर बदल न करता हाताळतो.',
  te: 'మార్పు ప్రిమిటివ్ Number ఆర్గ్యుమెంట్‌లకు మాత్రమే వర్తిస్తుంది. ఇతర రకాల ఆర్గ్యుమెంట్‌లను బ్రౌజర్ మార్పు లేకుండా నిర్వహిస్తుంది.',
  ko: '변경은 원시 Number 인수에만 적용됩니다. 다른 유형의 인수는 브라우저가 변경 없이 처리합니다.',
  ta: 'மாற்றம் primitive Number மதிப்புருக்களுக்கு மட்டுமே பொருந்தும். பிற வகைகளை உலாவி மாற்றமின்றிக் கையாளும்.',
  yue: '替换只适用于原始 Number 参数。其他类型参数由浏览器照原本方式处理。',
  wuu: '替换只适用于原始 Number 参数。别个类型参数由浏览器照原来个方式处理。'
};
const POWER_GROUP_LABELS = Object.freeze({
  ru: 'Степени, корни и нормы', en: 'Powers, roots and norms', zh_CN: '幂、根与范数',
  vi: 'Lũy thừa, căn và chuẩn', es: 'Potencias, raíces y normas', ar: 'القوى والجذور والمعايير',
  uk: 'Степені, корені та норми', fr: 'Puissances, racines et normes', pt_BR: 'Potências, raízes e normas',
  hi: 'घात, मूल और नॉर्म', ur: 'قوتیں، جڑیں اور نارمز', ja: 'べき乗・根・ノルム',
  de: 'Potenzen, Wurzeln und Normen', pl: 'Potęgi, pierwiastki i normy', id: 'Pangkat, akar, dan norma',
  mr: 'घात, मुळे आणि नॉर्म', te: 'ఘాతాలు, మూలాలు మరియు నార్మ్‌లు', ko: '거듭제곱·근·노름',
  ta: 'அடுக்குகள், மூலங்கள் மற்றும் நார்ம்கள்', yue: '冪、根同範數', wuu: '幂、根搭范数'
});
export const MATH_UI_MESSAGES = Object.freeze(Object.fromEntries(Object.entries(COPY).map(([locale, sections]) => {
  const values = [...sections.join('|').split('|'), EMPTY[locale], OPAQUE[locale], PRIMITIVES[locale]];
  values[FIELDS.indexOf('status_active')] = REGISTERED[locale];
  values[FIELDS.indexOf('group_power')] = POWER_GROUP_LABELS[locale];
  if (values.length !== FIELDS.length || values.some(value => !value || value !== value.trim())) throw new Error('Math UI copy: invalid locale ' + locale);
  return [locale, Object.freeze(Object.fromEntries(FIELDS.map((key, index) => ['antidetect_math_' + key, values[index]])))];
})));
export function applyMathCopy(table, locale) {
  if (!Object.hasOwn(MATH_UI_MESSAGES, locale)) throw new Error('Math UI copy: unknown locale ' + String(locale));
  if (!table || typeof table !== 'object' || Array.isArray(table)) throw new TypeError('Math UI copy: expected a message table');
  for (const key of MATH_UI_KEYS) table[key] = { message: MATH_UI_MESSAGES[locale][key] };
  table.protection_feature_math_transcendentals = { message: MATH_UI_MESSAGES[locale].antidetect_math_title };
  return table;
}
