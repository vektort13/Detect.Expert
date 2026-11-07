// ADR-059: technical API names stay canonical; only the group controls are localized.
export const WEBASSEMBLY_UI_KEYS = Object.freeze(['protection_group_webassembly', 'protection_webassembly_expand', 'protection_webassembly_collapse']);
const CONTROLS = {
  ru: ['Показать функции', 'Скрыть функции'],
  en: ['Show functions', 'Hide functions'],
  zh_CN: ['显示函数', '隐藏函数'],
  vi: ['Hiển thị hàm', 'Ẩn hàm'],
  es: ['Mostrar funciones', 'Ocultar funciones'],
  ar: ['إظهار الدوال', 'إخفاء الدوال'],
  uk: ['Показати функції', 'Приховати функції'],
  fr: ['Afficher les fonctions', 'Masquer les fonctions'],
  pt_BR: ['Mostrar funções', 'Ocultar funções'],
  hi: ['फ़ंक्शन दिखाएँ', 'फ़ंक्शन छिपाएँ'],
  ur: ['فنکشن دکھائیں', 'فنکشن چھپائیں'],
  ja: ['関数を表示', '関数を非表示'],
  de: ['Funktionen anzeigen', 'Funktionen ausblenden'],
  pl: ['Pokaż funkcje', 'Ukryj funkcje'],
  id: ['Tampilkan fungsi', 'Sembunyikan fungsi'],
  mr: ['फंक्शन्स दाखवा', 'फंक्शन्स लपवा'],
  te: ['ఫంక్షన్‌లను చూపించు', 'ఫంక్షన్‌లను దాచు'],
  ko: ['함수 표시', '함수 숨기기'],
  ta: ['செயல்பாடுகளைக் காட்டு', 'செயல்பாடுகளை மறை'],
  yue: ['显示函数', '隐藏函数'],
  wuu: ['显示函数', '收起函数'],
};
export const WEBASSEMBLY_UI_MESSAGES = Object.freeze(Object.fromEntries(Object.entries(CONTROLS).map(([locale, controls]) => [locale, Object.freeze(Object.fromEntries(WEBASSEMBLY_UI_KEYS.map((key, index) => [key, ['WebAssembly', ...controls][index]])))])));
export function applyWebAssemblyCopy(table, locale) {
  if (!Object.hasOwn(WEBASSEMBLY_UI_MESSAGES, locale)) throw new Error('WebAssembly copy: unknown locale ' + String(locale));
  if (!table || typeof table !== 'object' || Array.isArray(table)) throw new TypeError('WebAssembly copy: expected a message table');
  for (const key of WEBASSEMBLY_UI_KEYS) table[key] = { message: WEBASSEMBLY_UI_MESSAGES[locale][key] };
  return table;
}
