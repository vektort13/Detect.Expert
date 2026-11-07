// ADR-055: management navigation only. Existing settings, API, consent and Pro catalogs remain intact.
export const MANAGEMENT_KEYS = Object.freeze(['management_tab_firewall', 'management_tab_api', 'management_tab_settings', 'management_tab_contacts', 'management_navigation', 'management_firewall_unavailable', 'management_tab_browser_debug', 'management_tab_antidetect', 'management_tab_cookies', 'management_tab_proxy']);
const ROWS = {
  ru: ['API Guard', 'Настройки', 'Контакты', 'Управление расширением', 'Firewall недоступен в этом браузере.'],
  en: ['API Guard', 'Settings', 'Contacts', 'Extension management', 'Firewall is unavailable in this browser.'],
  zh_CN: ['API Guard', '设置', '联系', '扩展管理', 'Firewall 在此浏览器中不可用。'],
  vi: ['API Guard', 'Cài đặt', 'Liên hệ', 'Quản lý tiện ích', 'Firewall không khả dụng trong trình duyệt này.'],
  es: ['API Guard', 'Ajustes', 'Contacto', 'Gestión de la extensión', 'Firewall no está disponible en este navegador.'],
  ar: ['API Guard', 'الإعدادات', 'جهات الاتصال', 'إدارة الإضافة', 'Firewall غير متاح في هذا المتصفح.'],
  uk: ['API Guard', 'Налаштування', 'Контакти', 'Керування розширенням', 'Firewall недоступний у цьому браузері.'],
  fr: ['API Guard', 'Paramètres', 'Contacts', 'Gestion de l’extension', 'Firewall n’est pas disponible dans ce navigateur.'],
  pt_BR: ['API Guard', 'Configurações', 'Contatos', 'Gerenciamento da extensão', 'Firewall não está disponível neste navegador.'],
  hi: ['API Guard', 'सेटिंग्स', 'संपर्क', 'एक्सटेंशन प्रबंधन', 'इस ब्राउज़र में Firewall उपलब्ध नहीं है।'],
  ur: ['API Guard', 'ترتیبات', 'رابطے', 'ایکسٹینشن کا انتظام', 'اس براؤزر میں Firewall دستیاب نہیں ہے۔'],
  ja: ['API Guard', '設定', '連絡先', '拡張機能の管理', 'このブラウザーでは Firewall を利用できません。'],
  de: ['API Guard', 'Einstellungen', 'Kontakt', 'Erweiterungsverwaltung', 'Firewall ist in diesem Browser nicht verfügbar.'],
  pl: ['API Guard', 'Ustawienia', 'Kontakt', 'Zarządzanie rozszerzeniem', 'Firewall jest niedostępny w tej przeglądarce.'],
  id: ['API Guard', 'Pengaturan', 'Kontak', 'Pengelolaan ekstensi', 'Firewall tidak tersedia di browser ini.'],
  mr: ['API Guard', 'सेटिंग्ज', 'संपर्क', 'विस्तार व्यवस्थापन', 'या ब्राउझरमध्ये Firewall उपलब्ध नाही.'],
  te: ['API Guard', 'సెట్టింగ్‌లు', 'సంప్రదింపులు', 'పొడిగింపు నిర్వహణ', 'ఈ బ్రౌజర్‌లో Firewall అందుబాటులో లేదు.'],
  ko: ['API Guard', '설정', '연락처', '확장 프로그램 관리', '이 브라우저에서는 Firewall을 사용할 수 없습니다.'],
  ta: ['API Guard', 'அமைப்புகள்', 'தொடர்புகள்', 'நீட்டிப்பு மேலாண்மை', 'இந்த உலாவியில் Firewall கிடைக்கவில்லை.'],
  yue: ['API Guard', '设定', '联络', '扩展管理', '呢个浏览器用唔到 Firewall。'],
  wuu: ['API Guard', '设置', '联系', '扩展管理', '搿个浏览器里 Firewall 用勿来。'],
};

export const MANAGEMENT_MESSAGES = Object.freeze(Object.fromEntries(Object.entries(ROWS).map(([locale, values]) => [locale, Object.freeze(Object.fromEntries(MANAGEMENT_KEYS.map((key, index) => [key, ['Firewall', ...values, 'Browser Debug', 'Antidetect', 'Cookies', 'Proxy'][index]])))])));

export function applyManagementCopy(table, locale) {
  if (!Object.hasOwn(MANAGEMENT_MESSAGES, locale)) throw new Error('unknown management locale ' + locale);
  for (const key of MANAGEMENT_KEYS) table[key] = { message: MANAGEMENT_MESSAGES[locale][key] };
  return table;
}
