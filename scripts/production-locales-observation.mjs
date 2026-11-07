// ADR-041: compact observation controls replace the former first-run consent screen.
const COPY = {
  ru: ['Наблюдение', 'Включить наблюдение', 'Выключить и очистить', 'Не удалось изменить настройки наблюдения. Повторите попытку.'],
  en: ['Observation', 'Enable observation', 'Turn off and clear', 'Could not update observation settings. Try again.'],
  zh_CN: ['监测', '启用监测', '关闭并清除', '无法更新监测设置，请重试。'],
  vi: ['Theo dõi', 'Bật theo dõi', 'Tắt và xóa', 'Không thể cập nhật cài đặt theo dõi. Hãy thử lại.'],
  es: ['Observación', 'Activar observación', 'Desactivar y borrar', 'No se pudo actualizar la configuración de observación. Inténtalo de nuevo.'],
  ar: ['المراقبة', 'تشغيل المراقبة', 'إيقاف ومسح', 'تعذّر تحديث إعدادات المراقبة. حاول مرة أخرى.'],
  uk: ['Спостереження', 'Увімкнути спостереження', 'Вимкнути й очистити', 'Не вдалося змінити налаштування спостереження. Спробуйте ще раз.'],
  fr: ['Observation', 'Activer l’observation', 'Désactiver et effacer', 'Impossible de modifier les paramètres d’observation. Réessayez.'],
  pt_BR: ['Observação', 'Ativar observação', 'Desativar e limpar', 'Não foi possível atualizar as configurações de observação. Tente novamente.'],
  hi: ['निगरानी', 'निगरानी चालू करें', 'बंद करें और साफ़ करें', 'निगरानी की सेटिंग अपडेट नहीं हो सकी। फिर से कोशिश करें।'],
  ur: ['نگرانی', 'نگرانی شروع کریں', 'بند کریں اور صاف کریں', 'نگرانی کی ترتیبات تبدیل نہیں ہو سکیں۔ دوبارہ کوشش کریں۔'],
  ja: ['監視', '監視を有効にする', '無効にして消去', '監視設定を更新できませんでした。もう一度お試しください。'],
  de: ['Beobachtung', 'Beobachtung aktivieren', 'Deaktivieren und löschen', 'Die Beobachtungseinstellungen konnten nicht aktualisiert werden. Erneut versuchen.'],
  pl: ['Obserwacja', 'Włącz obserwację', 'Wyłącz i wyczyść', 'Nie udało się zaktualizować ustawień obserwacji. Spróbuj ponownie.'],
  id: ['Pemantauan', 'Aktifkan pemantauan', 'Nonaktifkan dan hapus', 'Pengaturan pemantauan tidak dapat diperbarui. Coba lagi.'],
  mr: ['निरीक्षण', 'निरीक्षण सुरू करा', 'बंद करा आणि साफ करा', 'निरीक्षण सेटिंग्ज बदलता आल्या नाहीत. पुन्हा प्रयत्न करा.'],
  te: ['పర్యవేక్షణ', 'పర్యవేక్షణను ప్రారంభించండి', 'ఆపి తొలగించండి', 'పర్యవేక్షణ సెట్టింగ్‌లను మార్చలేకపోయాము. మళ్లీ ప్రయత్నించండి.'],
  ko: ['관찰', '관찰 활성화', '끄고 삭제', '관찰 설정을 업데이트하지 못했습니다. 다시 시도하세요.'],
  ta: ['கண்காணிப்பு', 'கண்காணிப்பை இயக்கு', 'அணைத்து அழி', 'கண்காணிப்பு அமைப்புகளை மாற்ற முடியவில்லை. மீண்டும் முயற்சிக்கவும்.'],
  yue: ['监测', '开启监测', '关闭并清除', '更新唔到监测设定，请再试一次。'],
  wuu: ['监测', '开启监测', '关闭并清除', '监测设置更新勿成功，请再试一趟。']
};
const MASTER = {
  ru: ['Расширение', 'Выключить расширение'], en: ['Extension', 'Turn off extension'],
  zh_CN: ['扩展', '关闭扩展'], vi: ['Tiện ích', 'Tắt tiện ích'],
  es: ['Extensión', 'Desactivar extensión'], ar: ['الإضافة', 'إيقاف الإضافة'],
  pt_BR: ['Extensão', 'Desativar extensão'], fr: ['Extension', 'Désactiver l’extension'],
  hi: ['एक्सटेंशन', 'एक्सटेंशन बंद करें'], ur: ['ایکسٹینشن', 'ایکسٹینشن بند کریں'],
  ja: ['拡張機能', '拡張機能をオフにする'], de: ['Erweiterung', 'Erweiterung ausschalten'],
  pl: ['Rozszerzenie', 'Wyłącz rozszerzenie'], id: ['Ekstensi', 'Nonaktifkan ekstensi'],
  mr: ['विस्तार', 'विस्तार बंद करा'], te: ['పొడిగింపు', 'పొడిగింపును ఆపండి'],
  ko: ['확장 프로그램', '확장 프로그램 끄기'], ta: ['நீட்டிப்பு', 'நீட்டிப்பை அணை'],
  yue: ['扩展', '关闭扩展'], wuu: ['扩展', '关闭扩展'],
  uk: ['Розширення', 'Вимкнути розширення']
};
export function applyObservationCopy(table, locale) {
  if (!Object.hasOwn(COPY, locale)) throw new Error('unknown locale ' + locale);
  ['consent_title', 'consent_enable', 'consent_revoke', 'consent_error'].forEach((key, index) => {
    table[key] = { message: COPY[locale][index] };
  });
  if (!Object.hasOwn(MASTER, locale)) throw new Error('missing observation master locale ' + locale);
  table.observation_master_label = { message: MASTER[locale][0] };
  table.observation_master_disable = { message: MASTER[locale][1] };
  return table;
}
