// Local Detector labels; the observation wire and generated catalog stay unchanged.
const rows = {
  ru: ['Указатель', 'Регистрация обработчиков сайтом', 'Обращения сайта к координатам', 'Наблюдалось', 'Загрузка…', 'Нет данных', 'Перемещения курсора', 'Пока открыт Detector', 'Частичное наблюдение'],
  en: ['Pointer', 'Site handler registration', 'Site coordinate access', 'Observed', 'Loading…', 'No data', 'Cursor movements', 'While Detector is open', 'Partial observation'],
  zh_CN: ['指针', '网站事件处理器注册', '网站坐标访问', '已观察到', '正在加载…', '暂无数据', '光标移动次数', 'Detector 打开期间', '部分观察'],
  vi: ['Con trỏ', 'Trang đăng ký trình xử lý', 'Trang truy cập tọa độ', 'Đã ghi nhận', 'Đang tải…', 'Chưa có dữ liệu', 'Di chuyển con trỏ', 'Khi Detector đang mở', 'Quan sát một phần'],
  es: ['Puntero', 'Registro de controladores del sitio', 'Acceso del sitio a coordenadas', 'Observado', 'Cargando…', 'Sin datos', 'Movimientos del cursor', 'Mientras Detector esté abierto', 'Observación parcial'],
  ar: ['المؤشر', 'تسجيل معالجات الموقع', 'وصول الموقع إلى الإحداثيات', 'تم الرصد', 'جارٍ التحميل…', 'لا توجد بيانات', 'حركات المؤشر', 'أثناء فتح Detector', 'رصد جزئي'],
  uk: ['Вказівник', 'Реєстрація обробників сайтом', 'Звернення сайту до координат', 'Спостерігалося', 'Завантаження…', 'Немає даних', 'Переміщення курсора', 'Поки відкрито Detector', 'Часткове спостереження'],
  fr: ['Pointeur', 'Enregistrement des gestionnaires du site', 'Accès du site aux coordonnées', 'Observé', 'Chargement…', 'Aucune donnée', 'Mouvements du curseur', 'Pendant l’ouverture de Detector', 'Observation partielle'],
  pt_BR: ['Ponteiro', 'Registro de manipuladores pelo site', 'Acessos do site às coordenadas', 'Observado', 'Carregando…', 'Sem dados', 'Movimentos do cursor', 'Enquanto o Detector está aberto', 'Observação parcial'],
  hi: ['पॉइंटर', 'साइट के हैंडलर पंजीकरण', 'साइट की निर्देशांक पहुँच', 'देखा गया', 'लोड हो रहा है…', 'कोई डेटा नहीं', 'कर्सर की गतिविधियाँ', 'जब तक Detector खुला है', 'आंशिक अवलोकन'],
  ur: ['پوائنٹر', 'سائٹ کے ہینڈلر کی رجسٹریشن', 'سائٹ کی نقاط تک رسائی', 'مشاہدہ ہوا', 'لوڈ ہو رہا ہے…', 'کوئی ڈیٹا نہیں', 'کرسر کی حرکتیں', 'جب تک Detector کھلا ہو', 'جزوی مشاہدہ'],
  ja: ['ポインター', 'サイトのハンドラー登録', 'サイトの座標アクセス', '観測済み', '読み込み中…', 'データなし', 'カーソルの移動回数', 'Detector を開いている間', '部分的な観測'],
  de: ['Zeiger', 'Handler-Registrierungen der Website', 'Koordinatenzugriffe der Website', 'Beobachtet', 'Wird geladen…', 'Keine Daten', 'Cursorbewegungen', 'Solange Detector geöffnet ist', 'Teilweise Beobachtung'],
  pl: ['Wskaźnik', 'Rejestracja procedur obsługi przez stronę', 'Dostęp strony do współrzędnych', 'Zaobserwowano', 'Wczytywanie…', 'Brak danych', 'Ruchy kursora', 'Gdy Detector jest otwarty', 'Częściowa obserwacja'],
  id: ['Penunjuk', 'Pendaftaran pengendali situs', 'Akses koordinat oleh situs', 'Teramati', 'Memuat…', 'Belum ada data', 'Gerakan kursor', 'Selama Detector terbuka', 'Pengamatan sebagian'],
  mr: ['पॉइंटर', 'साइटची हँडलर नोंदणी', 'साइटचा निर्देशांक प्रवेश', 'निरीक्षण झाले', 'लोड होत आहे…', 'डेटा नाही', 'कर्सरच्या हालचाली', 'Detector उघडा असेपर्यंत', 'अंशतः निरीक्षण'],
  te: ['పాయింటర్', 'సైట్ హ్యాండ్లర్ నమోదు', 'సైట్ కోఆర్డినేట్ యాక్సెస్', 'గమనించబడింది', 'లోడ్ అవుతోంది…', 'డేటా లేదు', 'కర్సర్ కదలికలు', 'Detector తెరిచి ఉన్నప్పుడు', 'పాక్షిక పరిశీలన'],
  ko: ['포인터', '사이트 이벤트 처리기 등록', '사이트의 좌표 접근', '관찰됨', '불러오는 중…', '데이터 없음', '커서 이동 횟수', 'Detector가 열려 있는 동안', '부분 관찰'],
  ta: ['சுட்டி', 'தளத்தின் நிகழ்வு கையாளி பதிவு', 'தளத்தின் ஆயத்தொலைவு அணுகல்', 'காணப்பட்டது', 'ஏற்றுகிறது…', 'தரவு இல்லை', 'சுட்டி நகர்வுகள்', 'Detector திறந்திருக்கும் போது', 'பகுதியளவு கண்காணிப்பு'],
  yue: ['指针', '网站事件处理器注册', '网站坐标访问', '已观察到', '载入紧…', '未有数据', '光标移动次数', 'Detector 开住期间', '部分观察'],
  wuu: ['指针', '网站事件处理器注册', '网站坐标访问', '已观察到', '载入中…', '呒没数据', '光标移动次数', 'Detector 开着期间', '部分观察'],
};
const keys = ['title', 'listeners', 'coordinates', 'observed', 'loading', 'noData', 'movement', 'period', 'partial'];
export const DETECTOR_POINTER_LABELS = Object.freeze(Object.fromEntries(Object.entries(rows).map(([locale, values]) => [locale, Object.freeze(Object.fromEntries(keys.map((key, index) => [key, values[index]])))])));
export function detectorPointerLabels(locale) {
  const key = typeof locale === 'string' ? locale : typeof locale?.id === 'string' ? locale.id : 'en';
  const normalized = key.replaceAll('-', '_').toLowerCase();
  const aliases = { zh_cn: 'zh_CN', zh_hans: 'zh_CN', pt_br: 'pt_BR', yue_hans: 'yue', wuu_hans: 'wuu' };
  return DETECTOR_POINTER_LABELS[aliases[normalized] ?? normalized] ?? DETECTOR_POINTER_LABELS[normalized.split('_')[0]] ?? DETECTOR_POINTER_LABELS.en;
}
