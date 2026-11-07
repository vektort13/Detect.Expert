// Local labels for the shared theme picker; no generated locale tables change.
const ids = ['system', 'pearl', 'aurora', 'graphite', 'orchid', 'glass'];
const rows = {
  ru: ['Тема', 'Не удалось сохранить тему', 'Не удалось загрузить тему', 'Системная', 'Жемчуг', 'Аврора', 'Графит', 'Орхидея', 'Стекло'],
  en: ['Theme', 'Could not save theme', 'Could not load theme', 'System', 'Pearl', 'Aurora', 'Graphite', 'Orchid', 'Glass'],
  zh_CN: ['主题', '无法保存主题', '无法加载主题', '跟随系统', '珍珠', '极光', '石墨', '兰花', '玻璃'],
  vi: ['Giao diện', 'Không thể lưu giao diện', 'Không thể tải giao diện', 'Hệ thống', 'Ngọc trai', 'Cực quang', 'Than chì', 'Phong lan', 'Kính'],
  es: ['Tema', 'No se pudo guardar el tema', 'No se pudo cargar el tema', 'Sistema', 'Perla', 'Aurora', 'Grafito', 'Orquídea', 'Cristal'],
  ar: ['السمة', 'تعذر حفظ السمة', 'تعذر تحميل السمة', 'النظام', 'لؤلؤي', 'الشفق', 'جرافيت', 'أوركيد', 'زجاجي'],
  uk: ['Тема', 'Не вдалося зберегти тему', 'Не вдалося завантажити тему', 'Системна', 'Перлина', 'Аврора', 'Графіт', 'Орхідея', 'Скло'],
  fr: ['Thème', 'Impossible d’enregistrer le thème', 'Impossible de charger le thème', 'Système', 'Perle', 'Aurore', 'Graphite', 'Orchidée', 'Verre'],
  pt_BR: ['Tema', 'Não foi possível salvar o tema', 'Não foi possível carregar o tema', 'Sistema', 'Pérola', 'Aurora', 'Grafite', 'Orquídea', 'Vidro'],
  hi: ['थीम', 'थीम सहेजी नहीं जा सकी', 'थीम लोड नहीं हो सकी', 'सिस्टम', 'मोती', 'ऑरोरा', 'ग्रेफाइट', 'ऑर्किड', 'काँच'],
  ur: ['تھیم', 'تھیم محفوظ نہیں ہو سکی', 'تھیم لوڈ نہیں ہو سکی', 'سسٹم', 'موتی', 'شفق', 'گریفائٹ', 'آرکڈ', 'شیشہ'],
  ja: ['テーマ', 'テーマを保存できませんでした', 'テーマを読み込めませんでした', 'システム', 'パール', 'オーロラ', 'グラファイト', 'オーキッド', 'グラス'],
  de: ['Design', 'Design konnte nicht gespeichert werden', 'Design konnte nicht geladen werden', 'System', 'Perle', 'Aurora', 'Graphit', 'Orchidee', 'Glas'],
  pl: ['Motyw', 'Nie udało się zapisać motywu', 'Nie udało się wczytać motywu', 'Systemowy', 'Perła', 'Zorza', 'Grafit', 'Orchidea', 'Szkło'],
  id: ['Tema', 'Tema tidak dapat disimpan', 'Tema tidak dapat dimuat', 'Sistem', 'Mutiara', 'Aurora', 'Grafit', 'Anggrek', 'Kaca'],
  mr: ['थीम', 'थीम जतन करता आली नाही', 'थीम लोड करता आली नाही', 'प्रणाली', 'मोती', 'ध्रुवप्रभा', 'ग्रॅफाइट', 'ऑर्किड', 'काच'],
  te: ['థీమ్', 'థీమ్‌ను సేవ్ చేయలేకపోయాం', 'థీమ్‌ను లోడ్ చేయలేకపోయాం', 'సిస్టమ్', 'ముత్యం', 'అరోరా', 'గ్రాఫైట్', 'ఆర్కిడ్', 'గాజు'],
  ko: ['테마', '테마를 저장할 수 없습니다', '테마를 불러올 수 없습니다', '시스템', '펄', '오로라', '그래파이트', '오키드', '글라스'],
  ta: ['தோற்றம்', 'தோற்றத்தைச் சேமிக்க முடியவில்லை', 'தோற்றத்தை ஏற்ற முடியவில்லை', 'கணினி அமைப்பு', 'முத்து', 'அரோரா', 'கிராஃபைட்', 'ஆர்க்கிட்', 'கண்ணாடி'],
  yue: ['主题', '储存唔到主题', '载入唔到主题', '跟系统', '珍珠', '极光', '石墨', '兰花', '玻璃'],
  wuu: ['主题', '主题保存勿成功', '主题载入勿成功', '跟随系统', '珍珠', '极光', '石墨', '兰花', '玻璃'],
};
export const THEME_LABELS = Object.freeze(Object.fromEntries(Object.entries(rows).map(([locale, values]) => [locale, Object.freeze(Object.fromEntries(['theme', 'saveFailed', 'loadFailed', ...ids].map((key, index) => [key, values[index]])))])));
export function getThemeLabels(locale) {
  const value = String(typeof locale === 'string' ? locale : locale?.id ?? 'en').replaceAll('-', '_').toLowerCase();
  const aliases = { zh_cn: 'zh_CN', zh_hans: 'zh_CN', pt_br: 'pt_BR', yue_hans: 'yue', wuu_hans: 'wuu' };
  return THEME_LABELS[aliases[value] ?? value] ?? THEME_LABELS[value.split('_')[0]] ?? THEME_LABELS.en;
}
