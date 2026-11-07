// Immediate API mode changes: factual progress and inherited global Custom.
export const MODE_ACTION_KEYS = Object.freeze(['protection_api_mode_saving', 'protection_api_mode_saved_reload', 'protection_api_inherited_custom']);
const COPY = {
  ru: ['Сохраняем режим API…', 'Режим сохранён. Перезагрузите уже открытые страницы, чтобы применить его.', 'Наследуется Custom из «Все сайты»'],
  en: ['Saving API mode…', 'Mode saved. Reload already open pages to apply it.', 'Inherited Custom from All sites'],
  zh_CN: ['正在保存 API 模式…', '模式已保存。请重新加载已打开的页面以应用。', '继承自“所有网站”的 Custom'],
  vi: ['Đang lưu chế độ API…', 'Đã lưu chế độ. Tải lại các trang đang mở để áp dụng.', 'Kế thừa Custom từ Tất cả trang web'],
  es: ['Guardando el modo de API…', 'Modo guardado. Recarga las páginas ya abiertas para aplicarlo.', 'Custom heredado de Todos los sitios'],
  ar: ['جارٍ حفظ وضع API…', 'تم حفظ الوضع. أعد تحميل الصفحات المفتوحة لتطبيقه.', 'Custom موروث من جميع المواقع'],
  uk: ['Зберігаємо режим API…', 'Режим збережено. Перезавантажте вже відкриті сторінки, щоб застосувати його.', 'Успадковано Custom з «Усі сайти»'],
  fr: ['Enregistrement du mode API…', 'Mode enregistré. Rechargez les pages déjà ouvertes pour l’appliquer.', 'Custom hérité de Tous les sites'],
  pt_BR: ['Salvando o modo da API…', 'Modo salvo. Recarregue as páginas já abertas para aplicá-lo.', 'Custom herdado de Todos os sites'],
  hi: ['API मोड सहेजा जा रहा है…', 'मोड सहेजा गया। इसे लागू करने के लिए पहले से खुले पेज फिर लोड करें।', 'सभी साइटों से मिला Custom'],
  ur: ['API موڈ محفوظ کیا جا رہا ہے…', 'موڈ محفوظ ہو گیا۔ اسے لاگو کرنے کے لیے پہلے سے کھلے صفحات دوبارہ لوڈ کریں۔', 'تمام سائٹس سے وراثت میں ملا Custom'],
  ja: ['APIモードを保存中…', 'モードを保存しました。開いているページを再読み込みして適用してください。', 'すべてのサイトから継承したCustom'],
  de: ['API-Modus wird gespeichert…', 'Modus gespeichert. Lade bereits geöffnete Seiten neu, um ihn anzuwenden.', 'Custom von Alle Websites übernommen'],
  pl: ['Zapisywanie trybu API…', 'Tryb zapisany. Odśwież już otwarte strony, aby go zastosować.', 'Custom odziedziczony z Wszystkie witryny'],
  id: ['Menyimpan mode API…', 'Mode disimpan. Muat ulang halaman yang sudah terbuka untuk menerapkannya.', 'Custom diwarisi dari Semua situs'],
  mr: ['API मोड जतन करत आहे…', 'मोड जतन झाला. लागू करण्यासाठी आधीच उघडलेली पाने पुन्हा लोड करा.', 'सर्व साइट्समधून मिळालेला Custom'],
  te: ['API మోడ్‌ను సేవ్ చేస్తోంది…', 'మోడ్ సేవ్ అయింది. అమలు చేయడానికి ఇప్పటికే తెరిచిన పేజీలను మళ్లీ లోడ్ చేయండి.', 'అన్ని సైట్ల నుండి వారసత్వంగా వచ్చిన Custom'],
  ko: ['API 모드 저장 중…', '모드가 저장되었습니다. 이미 열린 페이지를 새로고침하여 적용하세요.', '모든 사이트에서 상속한 Custom'],
  ta: ['API பயன்முறையைச் சேமிக்கிறது…', 'பயன்முறை சேமிக்கப்பட்டது. பயன்படுத்த ஏற்கனவே திறந்த பக்கங்களை மீண்டும் ஏற்றவும்.', 'எல்லா தளங்களிலிருந்தும் பெறப்பட்ட Custom'],
  yue: ['正在儲存 API 模式…', '模式已儲存。請重新載入已開啟的頁面以套用。', '從「所有網站」繼承嘅 Custom'],
  wuu: ['API 模式保存当中…', '模式已保存。请重新载入已经打开个页面来应用。', '从“所有网站”继承个 Custom'],
};
export const MODE_ACTION_MESSAGES = Object.freeze(Object.fromEntries(Object.entries(COPY).map(([locale, values]) => [locale, Object.freeze(Object.fromEntries(MODE_ACTION_KEYS.map((key, index) => [key, values[index]])))])));
export function applyModeActionCopy(table, locale) {
  if (!Object.hasOwn(MODE_ACTION_MESSAGES, locale)) throw new Error('API mode action copy: unknown locale ' + String(locale));
  for (const key of MODE_ACTION_KEYS) table[key] = { message: MODE_ACTION_MESSAGES[locale][key] };
  return table;
}
