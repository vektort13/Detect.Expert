// ADR-103: local labels for the API Guard rule list; the shared locale tables stay unchanged.
export const API_GUARD_LABEL_KEYS = Object.freeze(['toolbar', 'collapse', 'expand', 'collapseAll', 'expandAll', 'effective', 'stateAllowed', 'stateBlocked']);

const zh = ['API 列表工具', '收起', '展开', '全部收起', '全部展开', '当前生效', '已允许', '已阻止'];

const rows = {
  ru: ['Инструменты списка API', 'Свернуть', 'Развернуть', 'Свернуть все', 'Развернуть все', 'Действует', 'Разрешено', 'Блокируется'],
  en: ['API list tools', 'Collapse', 'Expand', 'Collapse all', 'Expand all', 'In effect', 'Allowed', 'Blocked'],
  zh_CN: zh,
  vi: ['Công cụ danh sách API', 'Thu gọn', 'Mở rộng', 'Thu gọn tất cả', 'Mở rộng tất cả', 'Đang áp dụng', 'Được phép', 'Bị chặn'],
  es: ['Herramientas de la lista de API', 'Contraer', 'Expandir', 'Contraer todo', 'Expandir todo', 'En vigor', 'Permitida', 'Bloqueada'],
  ar: ['أدوات قائمة واجهات API', 'طيّ', 'توسيع', 'طيّ الكل', 'توسيع الكل', 'الساري حاليًا', 'مسموح', 'محظور'],
  uk: ['Інструменти списку API', 'Згорнути', 'Розгорнути', 'Згорнути все', 'Розгорнути все', 'Діє', 'Дозволено', 'Блокується'],
  fr: ['Outils de la liste des API', 'Réduire', 'Développer', 'Tout réduire', 'Tout développer', 'En vigueur', 'Autorisée', 'Bloquée'],
  pt_BR: ['Ferramentas da lista de APIs', 'Recolher', 'Expandir', 'Recolher tudo', 'Expandir tudo', 'Em vigor', 'Permitida', 'Bloqueada'],
  hi: ['API सूची के उपकरण', 'संक्षिप्त करें', 'विस्तार करें', 'सभी संक्षिप्त करें', 'सभी का विस्तार करें', 'लागू', 'अनुमत', 'अवरुद्ध'],
  ur: ['API فہرست کے اوزار', 'سمیٹیں', 'پھیلائیں', 'سب سمیٹیں', 'سب پھیلائیں', 'نافذ', 'اجازت ہے', 'بلاک ہے'],
  ja: ['API リストのツール', '折りたたむ', '展開', 'すべて折りたたむ', 'すべて展開', '適用中', '許可', 'ブロック中'],
  de: ['API-Listenwerkzeuge', 'Einklappen', 'Ausklappen', 'Alle einklappen', 'Alle ausklappen', 'Wirksam', 'Erlaubt', 'Blockiert'],
  pl: ['Narzędzia listy API', 'Zwiń', 'Rozwiń', 'Zwiń wszystko', 'Rozwiń wszystko', 'Obowiązuje', 'Dozwolone', 'Blokowane'],
  id: ['Alat daftar API', 'Ciutkan', 'Luaskan', 'Ciutkan semua', 'Luaskan semua', 'Berlaku', 'Diizinkan', 'Diblokir'],
  mr: ['API सूचीची साधने', 'संकुचित करा', 'विस्तारित करा', 'सर्व संकुचित करा', 'सर्व विस्तारित करा', 'लागू', 'परवानगी आहे', 'अडवले जाते'],
  te: ['API జాబితా సాధనాలు', 'కుదించు', 'విస్తరించు', 'అన్నీ కుదించు', 'అన్నీ విస్తరించు', 'అమలులో ఉంది', 'అనుమతించబడింది', 'నిరోధించబడింది'],
  ko: ['API 목록 도구', '접기', '펼치기', '모두 접기', '모두 펼치기', '적용 중', '허용됨', '차단됨'],
  ta: ['API பட்டியல் கருவிகள்', 'சுருக்கு', 'விரி', 'அனைத்தையும் சுருக்கு', 'அனைத்தையும் விரி', 'நடைமுறையில்', 'அனுமதிக்கப்பட்டது', 'தடுக்கப்படுகிறது'],
  yue: ['API 清單工具', '收埋', '展開', '全部收埋', '全部展開', '而家生效', '已允許', '已封鎖'],
  wuu: zh,
};

export function apiGuardLabels(locale) {
  const raw = typeof locale === 'string' ? locale.replace('-', '_') : locale?.id;
  const key = Object.hasOwn(rows, raw) ? raw : typeof raw === 'string' && Object.hasOwn(rows, raw.split('_')[0]) ? raw.split('_')[0] : 'en';
  const row = rows[key];
  return Object.freeze(Object.fromEntries(API_GUARD_LABEL_KEYS.map((name, index) => [name, row[index] ?? rows.en[index]])));
}

export const API_GUARD_LANGUAGES = Object.freeze(Object.keys(rows));
export function apiGuardRowLengths() { return Object.fromEntries(Object.entries(rows).map(([key, row]) => [key, row.length])); }
