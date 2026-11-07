// E22-22: visible brands and ON/OFF stay identical; descriptions and accessible names are localized.
const FIELDS = Object.freeze(['antidetect_open', 'antidetect_master', 'coming_soon', 'firewall_unavailable', 'error', 'open_error']);
export const GUARD_LAUNCHER_UI_KEYS = Object.freeze(FIELDS.map(key => 'guard_launcher_' + key));
const COPY = {
  ru: 'Открыть Antidetect|Включить или выключить Antidetect|Скоро появится|Недоступно в этом браузере|Не удалось изменить состояние Antidetect. Повторите попытку.|Не удалось открыть настройки Antidetect.',
  en: 'Open Antidetect|Turn Antidetect on or off|Coming soon|Unavailable in this browser|Unable to change Antidetect state. Try again.|Unable to open Antidetect settings.',
  zh_CN: '打开 Antidetect|开启或关闭 Antidetect|即将推出|此浏览器不支持|无法更改 Antidetect 状态。请重试。|无法打开 Antidetect 设置。',
  vi: 'Mở Antidetect|Bật hoặc tắt Antidetect|Sắp có|Không khả dụng trong trình duyệt này|Không thể đổi trạng thái Antidetect. Hãy thử lại.|Không thể mở cài đặt Antidetect.',
  es: 'Abrir Antidetect|Activar o desactivar Antidetect|Próximamente|No disponible en este navegador|No se pudo cambiar el estado de Antidetect. Inténtalo de nuevo.|No se pudieron abrir los ajustes de Antidetect.',
  ar: 'فتح Antidetect|تشغيل Antidetect أو إيقافه|قريبًا|غير متاح في هذا المتصفح|تعذر تغيير حالة Antidetect. حاول مجددًا.|تعذر فتح إعدادات Antidetect.',
  uk: 'Відкрити Antidetect|Увімкнути або вимкнути Antidetect|Незабаром|Недоступно в цьому браузері|Не вдалося змінити стан Antidetect. Повторіть спробу.|Не вдалося відкрити налаштування Antidetect.',
  fr: 'Ouvrir Antidetect|Activer ou désactiver Antidetect|Bientôt disponible|Indisponible dans ce navigateur|Impossible de modifier l’état d’Antidetect. Réessayez.|Impossible d’ouvrir les paramètres d’Antidetect.',
  pt_BR: 'Abrir Antidetect|Ativar ou desativar Antidetect|Em breve|Indisponível neste navegador|Não foi possível alterar o estado do Antidetect. Tente novamente.|Não foi possível abrir as configurações do Antidetect.',
  hi: 'Antidetect खोलें|Antidetect चालू या बंद करें|जल्द उपलब्ध होगा|इस ब्राउज़र में उपलब्ध नहीं|Antidetect की स्थिति बदली नहीं जा सकी। फिर प्रयास करें।|Antidetect की सेटिंग खोली नहीं जा सकीं।',
  ur: 'Antidetect کھولیں|Antidetect کو آن یا آف کریں|جلد دستیاب ہوگا|اس براؤزر میں دستیاب نہیں|Antidetect کی حالت تبدیل نہیں ہو سکی۔ دوبارہ کوشش کریں۔|Antidetect کی ترتیبات نہیں کھل سکیں۔',
  ja: 'Antidetect を開く|Antidetect をオンまたはオフにする|近日公開|このブラウザーでは利用できません|Antidetect の状態を変更できませんでした。もう一度お試しください。|Antidetect の設定を開けませんでした。',
  de: 'Antidetect öffnen|Antidetect ein- oder ausschalten|Demnächst verfügbar|In diesem Browser nicht verfügbar|Der Antidetect-Status konnte nicht geändert werden. Erneut versuchen.|Die Antidetect-Einstellungen konnten nicht geöffnet werden.',
  pl: 'Otwórz Antidetect|Włącz lub wyłącz Antidetect|Wkrótce|Niedostępne w tej przeglądarce|Nie udało się zmienić stanu Antidetect. Spróbuj ponownie.|Nie udało się otworzyć ustawień Antidetect.',
  id: 'Buka Antidetect|Aktifkan atau nonaktifkan Antidetect|Segera hadir|Tidak tersedia di browser ini|Tidak dapat mengubah status Antidetect. Coba lagi.|Tidak dapat membuka pengaturan Antidetect.',
  mr: 'Antidetect उघडा|Antidetect चालू किंवा बंद करा|लवकरच उपलब्ध|या ब्राउझरमध्ये उपलब्ध नाही|Antidetect ची स्थिती बदलता आली नाही. पुन्हा प्रयत्न करा.|Antidetect ची सेटिंग्ज उघडता आली नाहीत.',
  te: 'Antidetect తెరవండి|Antidetect ఆన్ లేదా ఆఫ్ చేయండి|త్వరలో అందుబాటులోకి|ఈ బ్రౌజర్‌లో అందుబాటులో లేదు|Antidetect స్థితిని మార్చలేకపోయింది. మళ్లీ ప్రయత్నించండి.|Antidetect సెట్టింగ్‌లను తెరవలేకపోయింది.',
  ko: 'Antidetect 열기|Antidetect 켜기 또는 끄기|출시 예정|이 브라우저에서는 사용할 수 없습니다|Antidetect 상태를 변경하지 못했습니다. 다시 시도하세요.|Antidetect 설정을 열지 못했습니다.',
  ta: 'Antidetect திறக்கவும்|Antidetect இயக்கவும் அல்லது அணைக்கவும்|விரைவில் கிடைக்கும்|இந்த உலாவியில் கிடைக்காது|Antidetect நிலையை மாற்ற முடியவில்லை. மீண்டும் முயலவும்.|Antidetect அமைப்புகளைத் திறக்க முடியவில்லை.',
  yue: '打开 Antidetect|开启或者关闭 Antidetect|即将推出|呢个浏览器唔支援|改唔到 Antidetect 状态。请再试一次。|打开唔到 Antidetect 设置。',
  wuu: '打开 Antidetect|开启或者关闭 Antidetect|马上就有|搿个浏览器弗支持|Antidetect 状态修改弗了。请再试一趟。|Antidetect 设置打开弗了。'
};
export const GUARD_LAUNCHER_UI_MESSAGES = Object.freeze(Object.fromEntries(Object.entries(COPY).map(([locale, source]) => {
  const values = source.split('|');
  if (values.length !== FIELDS.length || values.some(value => !value || value !== value.trim())) throw Error('Invalid guard launcher locale ' + locale);
  return [locale, Object.freeze(Object.fromEntries(FIELDS.map((key, index) => ['guard_launcher_' + key, values[index]])))];
})));
export function applyGuardLauncherCopy(table, locale) {
  const messages = GUARD_LAUNCHER_UI_MESSAGES[locale];
  if (!messages) throw Error('Unknown guard launcher locale ' + String(locale));
  for (const key of GUARD_LAUNCHER_UI_KEYS) table[key] = { message: messages[key] };
  return table;
}
