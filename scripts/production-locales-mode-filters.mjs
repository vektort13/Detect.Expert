// ADR-103: mode filter names follow the localized mode labels (Custom value, Blocked).
import { redesignLabels } from '../apps/production-extension/redesign-labels.js';
export const MODE_FILTER_KEYS = Object.freeze([
  'protection_mode_filter_label',
  'protection_mode_filter_spoofed',
  'protection_mode_filter_blocked',
  'protection_mode_filter_reset',
]);
const CONTROLS = {
  ru: ['Фильтр API по режиму', 'Показать все режимы'],
  en: ['Filter APIs by mode', 'Show all modes'],
  zh_CN: ['按模式筛选 API', '显示所有模式'],
  vi: ['Lọc API theo chế độ', 'Hiển thị tất cả chế độ'],
  es: ['Filtrar API por modo', 'Mostrar todos los modos'],
  ar: ['تصفية واجهات API حسب الوضع', 'عرض جميع الأوضاع'],
  uk: ['Фільтр API за режимом', 'Показати всі режими'],
  fr: ['Filtrer les API par mode', 'Afficher tous les modes'],
  pt_BR: ['Filtrar APIs por modo', 'Mostrar todos os modos'],
  hi: ['मोड के अनुसार API फ़िल्टर करें', 'सभी मोड दिखाएँ'],
  ur: ['موڈ کے لحاظ سے API فلٹر کریں', 'تمام موڈ دکھائیں'],
  ja: ['モードでAPIを絞り込む', 'すべてのモードを表示'],
  de: ['APIs nach Modus filtern', 'Alle Modi anzeigen'],
  pl: ['Filtruj API według trybu', 'Pokaż wszystkie tryby'],
  id: ['Filter API berdasarkan mode', 'Tampilkan semua mode'],
  mr: ['मोडनुसार API फिल्टर करा', 'सर्व मोड दाखवा'],
  te: ['మోడ్ ఆధారంగా APIలను ఫిల్టర్ చేయండి', 'అన్ని మోడ్‌లను చూపించు'],
  ko: ['모드별 API 필터링', '모든 모드 표시'],
  ta: ['முறையின்படி APIகளை வடிகட்டு', 'அனைத்து முறைகளையும் காட்டு'],
  yue: ['按模式筛选 API', '显示所有模式'],
  wuu: ['按模式筛选 API', '显示全部模式'],
};
export const MODE_FILTER_MESSAGES = Object.freeze(Object.fromEntries(Object.entries(CONTROLS).map(([locale, controls]) => [
  locale, Object.freeze(Object.fromEntries(MODE_FILTER_KEYS.map((key, index) => [key, [controls[0], redesignLabels(locale).modeCustom, redesignLabels(locale).filterBlocked, controls[1]][index]]))),
])));
export function applyModeFilterCopy(table, locale) {
  if (!Object.hasOwn(MODE_FILTER_MESSAGES, locale)) throw new Error('Mode filter copy: unknown locale ' + String(locale));
  if (!table || typeof table !== 'object' || Array.isArray(table)) throw new TypeError('Mode filter copy: expected a message table');
  for (const key of MODE_FILTER_KEYS) table[key] = { message: MODE_FILTER_MESSAGES[locale][key] };
  return table;
}
