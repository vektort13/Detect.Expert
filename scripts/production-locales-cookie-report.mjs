// Complete cookie-report table labels, in the order of COOKIE_REPORT_KEYS.
export const COOKIE_REPORT_KEYS = Object.freeze([
  'cookie_report_identity', 'cookie_report_classification',
  'cookie_report_explanation', 'cookie_report_properties', 'cookie_report_rows',
  'cookie_vendor_declaration', 'cookie_report_source', 'cookie_report_saved_at',
  'cookie_yes', 'cookie_no', 'cookie_scope_host_only', 'cookie_scope_domain',
  'cookie_cross_site_ancestor', 'cookie_no_cross_site_ancestor',
  'cookie_ancestor_unreported',
]);

const COPY = {
  en: [
    'Cookie / company', 'Category / tracking / evidence',
    'Purpose / explanations / sources', 'Attributes / expiry', 'Shown cookies: $SHOWN$ of $TOTAL$',
    'Vendor declaration: $VENDOR$', 'Source $INDEX$', 'Snapshot: $TIME$',
    'Yes', 'No', 'Host only', 'Domain and subdomains',
    'Cross-site ancestor reported', 'No cross-site ancestor reported',
    'Ancestor status is not reported',
  ],
  ru: [
    'Cookie / компания', 'Категория / отслеживание / подтверждение',
    'Назначение / расшифровки / источники', 'Атрибуты / срок действия', 'Показано cookie: $SHOWN$ из $TOTAL$',
    'Декларация поставщика: $VENDOR$', 'Источник $INDEX$', 'Снимок: $TIME$',
    'Да', 'Нет', 'Только хост', 'Домен и поддомены',
    'Указан родительский контекст другого сайта', 'Родительский контекст другого сайта отсутствует',
    'Статус родительского контекста не указан',
  ],
  zh_CN: [
    'Cookie / 公司', '类别 / 跟踪 / 依据',
    '用途 / 说明 / 来源', '属性 / 有效期', '已显示 Cookie：$SHOWN$ / $TOTAL$',
    '供应商声明：$VENDOR$', '来源 $INDEX$', '快照：$TIME$',
    '是', '否', '仅限主机', '域名及子域名',
    '已报告跨站祖先上下文', '已报告无跨站祖先上下文',
    '未报告祖先上下文状态',
  ],
  vi: [
    'Cookie / công ty', 'Danh mục / theo dõi / bằng chứng',
    'Mục đích / giải thích / nguồn', 'Thuộc tính / thời hạn', 'Cookie hiển thị: $SHOWN$ trên $TOTAL$',
    'Khai báo của nhà cung cấp: $VENDOR$', 'Nguồn $INDEX$', 'Ảnh chụp: $TIME$',
    'Có', 'Không', 'Chỉ máy chủ', 'Tên miền và tên miền phụ',
    'Có báo cáo ngữ cảnh tổ tiên khác trang web', 'Có báo cáo không có ngữ cảnh tổ tiên khác trang web',
    'Không có báo cáo trạng thái ngữ cảnh tổ tiên',
  ],
  es: [
    'Cookie / empresa', 'Categoría / seguimiento / evidencia',
    'Finalidad / explicaciones / fuentes', 'Atributos / caducidad', 'Cookies mostradas: $SHOWN$ de $TOTAL$',
    'Declaración del proveedor: $VENDOR$', 'Fuente $INDEX$', 'Instantánea: $TIME$',
    'Sí', 'No', 'Solo el host', 'Dominio y subdominios',
    'Se indica un contexto ancestro de otro sitio', 'Se indica que no hay un contexto ancestro de otro sitio',
    'No se indica el estado del contexto ancestro',
  ],
  ar: [
    'ملف تعريف الارتباط / الشركة', 'الفئة / التتبع / الدليل',
    'الغرض / التفسيرات / المصادر', 'السمات / انتهاء الصلاحية', 'ملفات تعريف الارتباط المعروضة: $SHOWN$ من $TOTAL$',
    'إقرار المورّد: $VENDOR$', 'المصدر $INDEX$', 'اللقطة: $TIME$',
    'نعم', 'لا', 'المضيف فقط', 'النطاق والنطاقات الفرعية',
    'أُبلغ عن سياق أصل من موقع آخر', 'أُبلغ عن عدم وجود سياق أصل من موقع آخر',
    'لم تُبلّغ حالة سياق الأصل',
  ],
  uk: [
    'Cookie / компанія', 'Категорія / відстеження / підтвердження',
    'Призначення / пояснення / джерела', 'Атрибути / строк дії', 'Показано cookie: $SHOWN$ із $TOTAL$',
    'Декларація постачальника: $VENDOR$', 'Джерело $INDEX$', 'Знімок: $TIME$',
    'Так', 'Ні', 'Лише хост', 'Домен і піддомени',
    'Указано батьківський контекст іншого сайту', 'Батьківський контекст іншого сайту відсутній',
    'Статус батьківського контексту не вказано',
  ],
  fr: [
    'Cookie / entreprise', 'Catégorie / suivi / preuve',
    'Finalité / explications / sources', 'Attributs / expiration', 'Cookies affichés : $SHOWN$ sur $TOTAL$',
    'Déclaration du fournisseur : $VENDOR$', 'Source $INDEX$', 'Instantané : $TIME$',
    'Oui', 'Non', 'Hôte uniquement', 'Domaine et sous-domaines',
    'Un contexte ancêtre intersite est indiqué', 'L’absence de contexte ancêtre intersite est indiquée',
    'L’état du contexte ancêtre n’est pas indiqué',
  ],
  pt_BR: [
    'Cookie / empresa', 'Categoria / rastreamento / evidência',
    'Finalidade / explicações / fontes', 'Atributos / validade', 'Cookies exibidos: $SHOWN$ de $TOTAL$',
    'Declaração do fornecedor: $VENDOR$', 'Fonte $INDEX$', 'Registro: $TIME$',
    'Sim', 'Não', 'Somente o host', 'Domínio e subdomínios',
    'Foi informado um contexto ancestral de outro site', 'Foi informada a ausência de contexto ancestral de outro site',
    'O estado do contexto ancestral não foi informado',
  ],
  hi: [
    'कुकी / कंपनी', 'श्रेणी / ट्रैकिंग / साक्ष्य',
    'उद्देश्य / विवरण / स्रोत', 'विशेषताएँ / समाप्ति', 'दिखाई गई कुकी: $TOTAL$ में से $SHOWN$',
    'विक्रेता की घोषणा: $VENDOR$', 'स्रोत $INDEX$', 'स्नैपशॉट: $TIME$',
    'हाँ', 'नहीं', 'केवल होस्ट', 'डोमेन और उपडोमेन',
    'अन्य साइट का पूर्वज संदर्भ बताया गया है', 'अन्य साइट का पूर्वज संदर्भ नहीं होने की सूचना है',
    'पूर्वज संदर्भ की स्थिति नहीं बताई गई है',
  ],
  ur: [
    'کوکی / کمپنی', 'زمرہ / ٹریکنگ / ثبوت',
    'مقصد / وضاحتیں / ذرائع', 'خصوصیات / میعاد', 'دکھائی گئی کوکیز: $TOTAL$ میں سے $SHOWN$',
    'فراہم کنندہ کا اعلان: $VENDOR$', 'ماخذ $INDEX$', 'اسنیپ شاٹ: $TIME$',
    'ہاں', 'نہیں', 'صرف ہوسٹ', 'ڈومین اور ذیلی ڈومینز',
    'دوسری سائٹ کے آبائی سیاق کی اطلاع دی گئی ہے', 'دوسری سائٹ کے آبائی سیاق کی عدم موجودگی کی اطلاع دی گئی ہے',
    'آبائی سیاق کی حالت کی اطلاع نہیں دی گئی',
  ],
  ja: [
    'Cookie / 企業', '分類 / 追跡 / 根拠',
    '用途 / 説明 / 出典', '属性 / 有効期限', '表示中の Cookie：$TOTAL$ 件中 $SHOWN$ 件',
    '提供元の申告：$VENDOR$', '出典 $INDEX$', 'スナップショット：$TIME$',
    'はい', 'いいえ', 'ホストのみ', 'ドメインとサブドメイン',
    '別サイトの祖先コンテキストありと報告', '別サイトの祖先コンテキストなしと報告',
    '祖先コンテキストの状態は報告されていません',
  ],
  de: [
    'Cookie / Unternehmen', 'Kategorie / Tracking / Beleg',
    'Zweck / Erläuterungen / Quellen', 'Attribute / Ablauf', 'Angezeigte Cookies: $SHOWN$ von $TOTAL$',
    'Angabe des Anbieters: $VENDOR$', 'Quelle $INDEX$', 'Momentaufnahme: $TIME$',
    'Ja', 'Nein', 'Nur der Host', 'Domain und Subdomains',
    'Übergeordneter Kontext einer anderen Website gemeldet', 'Kein übergeordneter Kontext einer anderen Website gemeldet',
    'Status des übergeordneten Kontexts nicht gemeldet',
  ],
  pl: [
    'Cookie / firma', 'Kategoria / śledzenie / dowód',
    'Przeznaczenie / objaśnienia / źródła', 'Atrybuty / ważność', 'Wyświetlone cookies: $SHOWN$ z $TOTAL$',
    'Deklaracja dostawcy: $VENDOR$', 'Źródło $INDEX$', 'Migawka: $TIME$',
    'Tak', 'Nie', 'Tylko host', 'Domena i subdomeny',
    'Zgłoszono kontekst nadrzędny z innej witryny', 'Zgłoszono brak kontekstu nadrzędnego z innej witryny',
    'Nie zgłoszono stanu kontekstu nadrzędnego',
  ],
  id: [
    'Cookie / perusahaan', 'Kategori / pelacakan / bukti',
    'Tujuan / penjelasan / sumber', 'Atribut / kedaluwarsa', 'Cookie yang ditampilkan: $SHOWN$ dari $TOTAL$',
    'Pernyataan vendor: $VENDOR$', 'Sumber $INDEX$', 'Snapshot: $TIME$',
    'Ya', 'Tidak', 'Hanya host', 'Domain dan subdomain',
    'Dilaporkan ada konteks leluhur lintas situs', 'Dilaporkan tidak ada konteks leluhur lintas situs',
    'Status konteks leluhur tidak dilaporkan',
  ],
  mr: [
    'कुकी / कंपनी', 'वर्ग / ट्रॅकिंग / पुरावा',
    'उद्देश / स्पष्टीकरणे / स्रोत', 'गुणधर्म / मुदत', 'दाखवलेल्या कुकी: $TOTAL$ पैकी $SHOWN$',
    'विक्रेत्याची घोषणा: $VENDOR$', 'स्रोत $INDEX$', 'स्नॅपशॉट: $TIME$',
    'होय', 'नाही', 'फक्त होस्ट', 'डोमेन आणि उपडोमेन',
    'दुसऱ्या साइटचा पूर्वज संदर्भ नोंदवला आहे', 'दुसऱ्या साइटचा पूर्वज संदर्भ नसल्याचे नोंदवले आहे',
    'पूर्वज संदर्भाची स्थिती नोंदवलेली नाही',
  ],
  te: [
    'కుకీ / కంపెనీ', 'వర్గం / ట్రాకింగ్ / ఆధారం',
    'ప్రయోజనం / వివరణలు / మూలాలు', 'లక్షణాలు / గడువు', 'చూపిన కుకీలు: మొత్తం $TOTAL$లో $SHOWN$',
    'విక్రేత ప్రకటన: $VENDOR$', 'మూలం $INDEX$', 'స్నాప్‌షాట్: $TIME$',
    'అవును', 'కాదు', 'హోస్ట్ మాత్రమే', 'డొమైన్ మరియు ఉపడొమైన్‌లు',
    'వేరే సైట్‌కు చెందిన పూర్వీక సందర్భం ఉన్నట్లు నివేదించబడింది', 'వేరే సైట్‌కు చెందిన పూర్వీక సందర్భం లేదని నివేదించబడింది',
    'పూర్వీక సందర్భ స్థితి నివేదించబడలేదు',
  ],
  ko: [
    '쿠키 / 회사', '분류 / 추적 / 근거',
    '용도 / 설명 / 출처', '속성 / 만료', '표시된 쿠키: $TOTAL$개 중 $SHOWN$개',
    '공급업체 신고: $VENDOR$', '출처 $INDEX$', '스냅샷: $TIME$',
    '예', '아니요', '호스트만', '도메인 및 하위 도메인',
    '다른 사이트의 상위 컨텍스트가 보고됨', '다른 사이트의 상위 컨텍스트가 없다고 보고됨',
    '상위 컨텍스트 상태가 보고되지 않음',
  ],
  ta: [
    'குக்கீ / நிறுவனம்', 'வகை / கண்காணிப்பு / ஆதாரம்',
    'நோக்கம் / விளக்கங்கள் / மூலங்கள்', 'பண்புகள் / காலாவதி', 'காட்டப்பட்ட குக்கீகள்: $TOTAL$ இல் $SHOWN$',
    'விற்பனையாளர் அறிவிப்பு: $VENDOR$', 'மூலம் $INDEX$', 'பதிவு: $TIME$',
    'ஆம்', 'இல்லை', 'ஹோஸ்ட் மட்டும்', 'டொமைன் மற்றும் துணை டொமைன்கள்',
    'வேறு தளத்தின் முன்னோர் சூழல் இருப்பதாகத் தெரிவிக்கப்பட்டுள்ளது', 'வேறு தளத்தின் முன்னோர் சூழல் இல்லை எனத் தெரிவிக்கப்பட்டுள்ளது',
    'முன்னோர் சூழலின் நிலை தெரிவிக்கப்படவில்லை',
  ],
  yue: [
    'Cookie / 公司', '类别 / 追踪 / 依据',
    '用途 / 说明 / 来源', '属性 / 有效期', '显示咗嘅 Cookie：$SHOWN$ / $TOTAL$',
    '供应商声明：$VENDOR$', '来源 $INDEX$', '快照：$TIME$',
    '系', '唔系', '只限呢个主机', '域名同子域名',
    '有报告跨站上层语境', '有报告冇跨站上层语境',
    '冇报告上层语境嘅状态',
  ],
  wuu: [
    'Cookie / 公司', '类别 / 跟踪 / 依据',
    '用途 / 说明 / 来源', '属性 / 有效期', '显示个 Cookie：$SHOWN$ / $TOTAL$',
    '供应商声明：$VENDOR$', '来源 $INDEX$', '快照：$TIME$',
    '是', '勿是', '只限搿个主机', '域名搭子域名',
    '报告了跨站上层语境', '报告了呒没跨站上层语境',
    '呒没报告上层语境个状态',
  ],
};

const PLACEHOLDERS = Object.freeze({
  cookie_report_rows: ['SHOWN', 'TOTAL'],
  cookie_vendor_declaration: ['VENDOR'],
  cookie_report_source: ['INDEX'],
  cookie_report_saved_at: ['TIME'],
});

export function applyCookieReportCopy(table, locale) {
  if (typeof locale !== 'string' || !Object.hasOwn(COPY, locale)) {
    throw new Error('Cookie report copy: unknown locale ' + String(locale));
  }
  if (!table || typeof table !== 'object' || Array.isArray(table)) {
    throw new TypeError('Cookie report copy: expected a message table');
  }
  const copy = COPY[locale];
  if (copy.length !== COOKIE_REPORT_KEYS.length || copy.some(message => typeof message !== 'string' || !message)) {
    throw new Error('Cookie report copy: incomplete translations for ' + locale);
  }
  for (let index = 0; index < COOKIE_REPORT_KEYS.length; index++) {
    const key = COOKIE_REPORT_KEYS[index];
    const expected = Object.hasOwn(PLACEHOLDERS, key) ? PLACEHOLDERS[key] : [];
    const actual = [...copy[index].matchAll(/\$([A-Z][A-Z0-9_]*)\$/g)].map(match => match[1]);
    if (actual.length !== expected.length || expected.some(name => actual.filter(token => token === name).length !== 1)) {
      throw new Error('Cookie report copy: invalid placeholders for ' + locale + '/' + key);
    }
    const entry = { message: copy[index] };
    if (expected.length) {
      entry.placeholders = Object.fromEntries(expected.map((name, slot) => [name.toLowerCase(), { content: '$' + (slot + 1) }]));
    }
    table[key] = entry;
  }
  return table;
}
