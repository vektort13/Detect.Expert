// Owner-requested separate blocking page and compact controls; values follow BLOCKING_KEYS.
export const BLOCKING_KEYS = Object.freeze([
  'protection_title', 'protection_page_title', 'protection_open_settings',
  'protection_master', 'protection_back', 'protection_scope',
  'protection_reset', 'protection_saved', 'protection_current_site',
  'protection_error', 'protection_ready', 'protection_inactive',
  'protection_site_off', 'protection_restore_reload',
]);

export const REMOVED_BLOCKING_KEYS = Object.freeze([
  'protection_missing', 'protection_allow', 'protection_high_risk',
]);

const COPY = {
  en: [
    'API Guard', 'Blocking settings', 'Open blocking settings',
    'API Guard', 'Back', 'Rule scope',
    'Reset rules', 'Settings saved', 'Current site',
    'Settings unavailable. Retry.', 'Blocking is on', 'Blocking is off',
    'Bypass this site', 'Turn off for this site and reload',
  ],
  ru: [
    'API Guard', 'Настройки блокировки', 'Открыть настройки блокировки',
    'API Guard', 'Назад', 'Область правил',
    'Сбросить правила', 'Настройки сохранены', 'Текущий сайт',
    'Настройки недоступны. Повторите попытку.', 'Блокировка включена', 'Блокировка выключена',
    'Исключить сайт', 'Отключить для сайта и обновить',
  ],
  zh_CN: [
    'API Guard', '拦截设置', '打开拦截设置',
    'API Guard', '返回', '规则范围',
    '重置规则', '设置已保存', '当前网站',
    '设置不可用。请重试。', '拦截已开启', '拦截已关闭',
    '绕过此网站', '对此网站关闭拦截并重新加载',
  ],
  vi: [
    'API Guard', 'Cài đặt chặn', 'Mở cài đặt chặn',
    'API Guard', 'Quay lại', 'Phạm vi quy tắc',
    'Đặt lại quy tắc', 'Đã lưu cài đặt', 'Trang web hiện tại',
    'Không thể truy cập cài đặt. Hãy thử lại.', 'Đã bật chặn', 'Đã tắt chặn',
    'Bỏ qua trang web này', 'Tắt cho trang web này và tải lại',
  ],
  es: [
    'API Guard', 'Ajustes de bloqueo', 'Abrir ajustes de bloqueo',
    'API Guard', 'Volver', 'Ámbito de las reglas',
    'Restablecer reglas', 'Ajustes guardados', 'Sitio actual',
    'Ajustes no disponibles. Reinténtalo.', 'Bloqueo activado', 'Bloqueo desactivado',
    'Excluir este sitio', 'Desactivar para este sitio y recargar',
  ],
  ar: [
    'API Guard', 'إعدادات الحظر', 'فتح إعدادات الحظر',
    'API Guard', 'رجوع', 'نطاق القواعد',
    'إعادة ضبط القواعد', 'تم حفظ الإعدادات', 'الموقع الحالي',
    'الإعدادات غير متاحة. أعد المحاولة.', 'الحظر مفعّل', 'الحظر متوقف',
    'استثناء هذا الموقع', 'إيقاف الحظر لهذا الموقع وإعادة التحميل',
  ],
  uk: [
    'API Guard', 'Налаштування блокування', 'Відкрити налаштування блокування',
    'API Guard', 'Назад', 'Область правил',
    'Скинути правила', 'Налаштування збережено', 'Поточний сайт',
    'Налаштування недоступні. Повторіть спробу.', 'Блокування увімкнено', 'Блокування вимкнено',
    'Виключити сайт', 'Вимкнути для сайту й оновити',
  ],
  fr: [
    'API Guard', 'Réglages du blocage', 'Ouvrir les réglages du blocage',
    'API Guard', 'Retour', 'Portée des règles',
    'Réinitialiser les règles', 'Réglages enregistrés', 'Site actuel',
    'Réglages indisponibles. Réessayez.', 'Blocage activé', 'Blocage désactivé',
    'Exclure ce site', 'Désactiver pour ce site et recharger',
  ],
  pt_BR: [
    'API Guard', 'Configurações de bloqueio', 'Abrir configurações de bloqueio',
    'API Guard', 'Voltar', 'Escopo das regras',
    'Redefinir regras', 'Configurações salvas', 'Site atual',
    'Configurações indisponíveis. Tente novamente.', 'Bloqueio ativado', 'Bloqueio desativado',
    'Excluir este site', 'Desativar para este site e recarregar',
  ],
  hi: [
    'API Guard', 'ब्लॉकिंग सेटिंग', 'ब्लॉकिंग सेटिंग खोलें',
    'API Guard', 'वापस', 'नियमों का दायरा',
    'नियम रीसेट करें', 'सेटिंग सहेजी गई', 'मौजूदा साइट',
    'सेटिंग उपलब्ध नहीं है। फिर कोशिश करें।', 'ब्लॉकिंग चालू है', 'ब्लॉकिंग बंद है',
    'इस साइट को छोड़ें', 'इस साइट के लिए बंद करें और फिर लोड करें',
  ],
  ur: [
    'API Guard', 'بلاکنگ کی ترتیبات', 'بلاکنگ کی ترتیبات کھولیں',
    'API Guard', 'واپس', 'قواعد کا دائرہ',
    'قواعد ری سیٹ کریں', 'ترتیبات محفوظ ہو گئیں', 'موجودہ سائٹ',
    'ترتیبات دستیاب نہیں۔ دوبارہ کوشش کریں۔', 'بلاکنگ فعال ہے', 'بلاکنگ بند ہے',
    'اس سائٹ کو مستثنیٰ کریں', 'اس سائٹ کے لیے بند کریں اور دوبارہ لوڈ کریں',
  ],
  ja: [
    'API Guard', 'ブロック設定', 'ブロック設定を開く',
    'API Guard', '戻る', 'ルールの適用範囲',
    'ルールをリセット', '設定を保存しました', '現在のサイト',
    '設定を取得できません。再試行してください。', 'ブロックは有効です', 'ブロックは無効です',
    'このサイトを除外', 'このサイトで無効にして再読み込み',
  ],
  de: [
    'API Guard', 'Blockierungseinstellungen', 'Blockierungseinstellungen öffnen',
    'API Guard', 'Zurück', 'Geltungsbereich der Regeln',
    'Regeln zurücksetzen', 'Einstellungen gespeichert', 'Aktuelle Website',
    'Einstellungen nicht verfügbar. Erneut versuchen.', 'Blockierung eingeschaltet', 'Blockierung ausgeschaltet',
    'Diese Website ausnehmen', 'Für diese Website ausschalten und neu laden',
  ],
  pl: [
    'API Guard', 'Ustawienia blokowania', 'Otwórz ustawienia blokowania',
    'API Guard', 'Wstecz', 'Zakres reguł',
    'Resetuj reguły', 'Ustawienia zapisane', 'Bieżąca witryna',
    'Ustawienia niedostępne. Spróbuj ponownie.', 'Blokowanie włączone', 'Blokowanie wyłączone',
    'Wyklucz tę witrynę', 'Wyłącz dla tej witryny i odśwież',
  ],
  id: [
    'API Guard', 'Pengaturan pemblokiran', 'Buka pengaturan pemblokiran',
    'API Guard', 'Kembali', 'Cakupan aturan',
    'Atur ulang aturan', 'Pengaturan disimpan', 'Situs saat ini',
    'Pengaturan tidak tersedia. Coba lagi.', 'Pemblokiran aktif', 'Pemblokiran nonaktif',
    'Lewati situs ini', 'Nonaktifkan untuk situs ini dan muat ulang',
  ],
  mr: [
    'API Guard', 'ब्लॉकिंग सेटिंग्ज', 'ब्लॉकिंग सेटिंग्ज उघडा',
    'API Guard', 'मागे', 'नियमांची व्याप्ती',
    'नियम रीसेट करा', 'सेटिंग्ज जतन केल्या', 'सध्याची साइट',
    'सेटिंग्ज उपलब्ध नाहीत. पुन्हा प्रयत्न करा.', 'ब्लॉकिंग सुरू आहे', 'ब्लॉकिंग बंद आहे',
    'ही साइट वगळा', 'या साइटसाठी बंद करा आणि पुन्हा लोड करा',
  ],
  te: [
    'API Guard', 'నిరోధ సెట్టింగ్‌లు', 'నిరోధ సెట్టింగ్‌లను తెరవండి',
    'API Guard', 'వెనుకకు', 'నియమాల పరిధి',
    'నియమాలను రీసెట్ చేయండి', 'సెట్టింగ్‌లు సేవ్ అయ్యాయి', 'ప్రస్తుత సైట్',
    'సెట్టింగ్‌లు అందుబాటులో లేవు. మళ్లీ ప్రయత్నించండి.', 'నిరోధం ప్రారంభించబడింది', 'నిరోధం నిలిపివేయబడింది',
    'ఈ సైట్‌ను మినహాయించండి', 'ఈ సైట్‌కు నిలిపివేసి మళ్లీ లోడ్ చేయండి',
  ],
  ko: [
    'API Guard', '차단 설정', '차단 설정 열기',
    'API Guard', '뒤로', '규칙 적용 범위',
    '규칙 초기화', '설정을 저장했습니다', '현재 사이트',
    '설정을 사용할 수 없습니다. 다시 시도하세요.', '차단 켜짐', '차단 꺼짐',
    '이 사이트 제외', '이 사이트에서 끄고 새로고침',
  ],
  ta: [
    'API Guard', 'தடுப்பு அமைப்புகள்', 'தடுப்பு அமைப்புகளைத் திறக்கவும்',
    'API Guard', 'பின்செல்', 'விதிகளின் வரம்பு',
    'விதிகளை மீட்டமைக்கவும்', 'அமைப்புகள் சேமிக்கப்பட்டன', 'தற்போதைய தளம்',
    'அமைப்புகள் கிடைக்கவில்லை. மீண்டும் முயற்சிக்கவும்.', 'தடுப்பு இயக்கப்பட்டுள்ளது', 'தடுப்பு முடக்கப்பட்டுள்ளது',
    'இந்தத் தளத்தை விலக்கவும்', 'இந்தத் தளத்திற்கு முடக்கி மீண்டும் ஏற்றவும்',
  ],
  yue: [
    'API Guard', '拦截设定', '打开拦截设定',
    'API Guard', '返去', '规则范围',
    '重设规则', '设定已储存', '目前网站',
    '设定唔可用。请再试。', '拦截已开启', '拦截已关闭',
    '跳过呢个网站', '关闭呢个网站嘅拦截并重新载入',
  ],
  wuu: [
    'API Guard', '拦截设置', '打开拦截设置',
    'API Guard', '返回', '规则范围',
    '重设规则', '设置已经保存', '当前网站',
    '设置用勿来。请再试一趟。', '拦截已经开启', '拦截已经关闭',
    '跳过搿个网站', '关闭搿个网站个拦截并重新载入',
  ],
};

export function applyBlockingCopy(table, locale) {
  if (typeof locale !== 'string' || !Object.hasOwn(COPY, locale)) {
    throw new Error('Blocking copy: unknown locale ' + String(locale));
  }
  if (!table || typeof table !== 'object' || Array.isArray(table)) {
    throw new TypeError('Blocking copy: expected a message table');
  }
  const copy = COPY[locale];
  if (copy.length !== BLOCKING_KEYS.length || copy.some(message => typeof message !== 'string' || !message.trim() || /\$[A-Z]+\$/.test(message))) {
    throw new Error('Blocking copy: incomplete translations for ' + locale);
  }
  for (const key of REMOVED_BLOCKING_KEYS) delete table[key];
  for (let index = 0; index < BLOCKING_KEYS.length; index++) table[BLOCKING_KEYS[index]] = { message: copy[index] };
  return table;
}
