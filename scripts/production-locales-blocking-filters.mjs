// ADR-046: filter chips, live count, reset and the "Partial" rule badge; values follow BLOCKING_FILTER_KEYS.
// Owner decision: en and ru chips use the owner's Latin labels; en and ru are authored, the other 19 catalogs
// are candidate translations pending native review.
export const BLOCKING_FILTER_KEYS = Object.freeze([
  'protection_filter_label', 'protection_filter_all', 'protection_filter_hardware', 'protection_filter_os',
  'protection_filter_network', 'protection_filter_browser', 'protection_filter_social', 'protection_filter_shown',
  'protection_filter_clear', 'protection_rule_partial', 'protection_rule_partial_hint'
]);
const SHOWN_KEY = 'protection_filter_shown';
const SHOWN_PLACEHOLDERS = Object.freeze({ shown: Object.freeze({ content: '$1' }), total: Object.freeze({ content: '$2' }) });
const CHIPS = ['protection_filter_all', 'protection_filter_hardware', 'protection_filter_os', 'protection_filter_network', 'protection_filter_browser', 'protection_filter_social'];

// Values identical to English on purpose: ru keeps the owner's Latin chip labels; the rest are the
// established native terms in those languages (loanwords "Hardware", "Browser", "Social", "OS").
export const ENGLISH_EQUAL_ALLOWED = Object.freeze({
  // ADR-103: Russian chips are translated; the Latin exception of ADR-046 is retired.
  ru: Object.freeze([]),
  de: Object.freeze(['protection_filter_hardware', 'protection_filter_browser']),
  es: Object.freeze(['protection_filter_hardware', 'protection_filter_social']),
  pt_BR: Object.freeze(['protection_filter_hardware', 'protection_filter_social']),
  fr: Object.freeze(['protection_filter_social']),
  id: Object.freeze(['protection_filter_browser']),
  ja: Object.freeze(['protection_filter_os'])
});

const COPY = {
  en: 'Filter APIs by category|All|Hardware|OS|Network|Browser|Social|Rules shown: $SHOWN$ of $TOTAL$|Show all rules|Partial|Other standard APIs can still reach the same data or action',
  ru: 'Фильтр API по категориям|Все|Устройство|ОС|Сеть|Браузер|Соцсети|Показано правил: $SHOWN$ из $TOTAL$|Показать все правила|Частично|Те же данные или действие остаются доступны через другие стандартные API',
  uk: 'Фільтр API за категоріями|Усі|Обладнання|ОС|Мережа|Браузер|Соціальні|Показано правил: $SHOWN$ з $TOTAL$|Показати всі правила|Частково|Ті самі дані чи дію досі можна отримати через інші стандартні API',
  de: 'APIs nach Kategorie filtern|Alle|Hardware|Betriebssystem|Netzwerk|Browser|Soziales|Angezeigte Regeln: $SHOWN$ von $TOTAL$|Alle Regeln anzeigen|Teilweise|Dieselben Daten oder Aktionen bleiben über andere Standard-APIs erreichbar',
  es: 'Filtrar API por categoría|Todas|Hardware|Sistema|Red|Navegador|Social|Reglas mostradas: $SHOWN$ de $TOTAL$|Mostrar todas las reglas|Parcial|Otras API estándar aún pueden acceder a los mismos datos o acciones',
  fr: 'Filtrer les API par catégorie|Toutes|Matériel|Système|Réseau|Navigateur|Social|Règles affichées : $SHOWN$ sur $TOTAL$|Afficher toutes les règles|Partiel|D’autres API standard peuvent encore accéder aux mêmes données ou actions',
  pt_BR: 'Filtrar APIs por categoria|Todas|Hardware|Sistema|Rede|Navegador|Social|Regras exibidas: $SHOWN$ de $TOTAL$|Mostrar todas as regras|Parcial|Outras APIs padrão ainda podem acessar os mesmos dados ou ações',
  pl: 'Filtruj API według kategorii|Wszystkie|Sprzęt|System|Sieć|Przeglądarka|Społecznościowe|Wyświetlane reguły: $SHOWN$ z $TOTAL$|Pokaż wszystkie reguły|Częściowo|Te same dane lub działania pozostają dostępne przez inne standardowe API',
  id: 'Filter API menurut kategori|Semua|Perangkat keras|Sistem operasi|Jaringan|Browser|Sosial|Aturan ditampilkan: $SHOWN$ dari $TOTAL$|Tampilkan semua aturan|Sebagian|Data atau tindakan yang sama tetap dapat dijangkau melalui API standar lain',
  vi: 'Lọc API theo danh mục|Tất cả|Phần cứng|Hệ điều hành|Mạng|Trình duyệt|Mạng xã hội|Quy tắc đang hiển thị: $SHOWN$/$TOTAL$|Hiện tất cả quy tắc|Một phần|Các API tiêu chuẩn khác vẫn có thể truy cập cùng dữ liệu hoặc thao tác',
  ar: 'تصفية واجهات API حسب الفئة|الكل|العتاد|نظام التشغيل|الشبكة|المتصفح|التواصل الاجتماعي|القواعد المعروضة: $SHOWN$ من $TOTAL$|عرض كل القواعد|جزئي|لا تزال واجهات API قياسية أخرى قادرة على الوصول إلى البيانات أو الإجراء نفسه',
  ur: 'زمرے کے لحاظ سے API فلٹر کریں|سب|ہارڈویئر|آپریٹنگ سسٹم|نیٹ ورک|براؤزر|سماجی|دکھائے گئے قواعد: $TOTAL$ میں سے $SHOWN$|تمام قواعد دکھائیں|جزوی|وہی ڈیٹا یا عمل دیگر معیاری API کے ذریعے اب بھی قابل رسائی ہے',
  hi: 'श्रेणी के अनुसार API फ़िल्टर करें|सभी|हार्डवेयर|ऑपरेटिंग सिस्टम|नेटवर्क|ब्राउज़र|सामाजिक|दिखाए गए नियम: $TOTAL$ में से $SHOWN$|सभी नियम दिखाएँ|आंशिक|वही डेटा या कार्रवाई अन्य मानक API से अब भी उपलब्ध है',
  mr: 'श्रेणीनुसार API फिल्टर करा|सर्व|हार्डवेअर|ऑपरेटिंग सिस्टम|नेटवर्क|ब्राउझर|सामाजिक|दाखवलेले नियम: $TOTAL$ पैकी $SHOWN$|सर्व नियम दाखवा|अंशतः|तोच डेटा किंवा क्रिया इतर मानक API द्वारे अजूनही उपलब्ध आहे',
  ta: 'வகைப்படி APIகளை வடிகட்டு|அனைத்தும்|வன்பொருள்|இயக்க முறைமை|பிணையம்|உலாவி|சமூகம்|காட்டப்படும் விதிகள்: $TOTAL$ இல் $SHOWN$|அனைத்து விதிகளையும் காட்டு|பகுதியளவு|அதே தரவு அல்லது செயலை மற்ற நிலையான APIகள் மூலம் இன்னும் அணுகலாம்',
  te: 'వర్గం వారీగా APIలను ఫిల్టర్ చేయండి|అన్నీ|హార్డ్‌వేర్|ఆపరేటింగ్ సిస్టమ్|నెట్‌వర్క్|బ్రౌజర్|సామాజిక|చూపిన నియమాలు: $TOTAL$లో $SHOWN$|అన్ని నియమాలను చూపించు|పాక్షికం|అదే డేటా లేదా చర్య ఇతర ప్రామాణిక APIల ద్వారా ఇంకా అందుబాటులో ఉంటుంది',
  ja: 'カテゴリで API を絞り込む|すべて|ハードウェア|OS|ネットワーク|ブラウザー|ソーシャル|表示中のルール: $SHOWN$ / $TOTAL$|すべてのルールを表示|一部のみ|同じデータや操作には他の標準 API から引き続きアクセスできます',
  ko: '카테고리별 API 필터|전체|하드웨어|운영체제|네트워크|브라우저|소셜|표시된 규칙: $SHOWN$/$TOTAL$|모든 규칙 표시|부분적|같은 데이터나 동작은 다른 표준 API로 여전히 접근할 수 있습니다',
  zh_CN: '按类别筛选 API|全部|硬件|操作系统|网络|浏览器|社交|显示的规则：$SHOWN$ / $TOTAL$|显示全部规则|部分|其他标准 API 仍可获取相同数据或执行相同操作',
  yue: '按类别筛选 API|全部|硬件|作业系统|网络|浏览器|社交|显示紧嘅规则：$SHOWN$ / $TOTAL$|显示全部规则|部分|其他标准 API 仲可以攞到同样嘅数据或者做同样嘅操作',
  wuu: '按类别筛选 API|全部|硬件|操作系统|网络|浏览器|社交|显示个规则：$SHOWN$ / $TOTAL$|显示全部规则|部分|其他标准 API 还是好拿到同样个数据或者做同样个操作'
};

function count(text, token) {
  return text.split(token).length - 1;
}

export function applyBlockingFilterCopy(table, locale) {
  if (typeof locale !== 'string' || !Object.hasOwn(COPY, locale)) throw new Error('Blocking filter copy: unknown locale ' + String(locale));
  if (!table || typeof table !== 'object' || Array.isArray(table)) throw new TypeError('Blocking filter copy: expected a message table');
  const values = COPY[locale].split('|');
  const invalid = values.length !== BLOCKING_FILTER_KEYS.length || values.some((value, index) => !value.trim() || value !== value.trim() ||
    (BLOCKING_FILTER_KEYS[index] === SHOWN_KEY
      ? count(value, '$') !== 4 || count(value, '$SHOWN$') !== 1 || count(value, '$TOTAL$') !== 1
      : value.includes('$')));
  if (invalid) throw new Error('Blocking filter copy: incomplete translations for ' + locale);
  BLOCKING_FILTER_KEYS.forEach((key, index) => {
    table[key] = key === SHOWN_KEY
      ? { message: values[index], placeholders: { shown: { ...SHOWN_PLACEHOLDERS.shown }, total: { ...SHOWN_PLACEHOLDERS.total } } }
      : { message: values[index] };
  });
  return table;
}
