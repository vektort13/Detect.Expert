// E22-08: discoverable WebRTC configuration; technical feature names make no activation claim.
export const WEBRTC_DISCOVERY_KEYS = Object.freeze([
  'protection_webrtc_profile_title', 'protection_webrtc_profile_configure', 'protection_webrtc_profile_addresses',
  'protection_webrtc_profile_devices', 'protection_webrtc_profile_certificates', 'protection_webrtc_profile_save', 'protection_webrtc_search_terms',
]);
const COPY = {
  ru: ['Настроить WebRTC', 'Устройства', 'Сертификаты DTLS', 'Сохранить и включить Custom', 'вебртс устройства идентификаторы сертификаты'],
  en: ['Configure WebRTC', 'Devices', 'DTLS certificates', 'Save and use Custom', 'devices device identifiers certificates'],
  zh_CN: ['设置 WebRTC', '设备', 'DTLS 证书', '保存并使用 Custom', '设备 设备标识符 证书'],
  vi: ['Cấu hình WebRTC', 'Thiết bị', 'Chứng chỉ DTLS', 'Lưu và dùng Custom', 'thiết bị mã định danh thiết bị chứng chỉ'],
  es: ['Configurar WebRTC', 'Dispositivos', 'Certificados DTLS', 'Guardar y usar Custom', 'dispositivos identificadores certificados'],
  ar: ['إعداد WebRTC', 'الأجهزة', 'شهادات DTLS', 'حفظ واستخدام Custom', 'ويب آر تي سي أجهزة معرفات الأجهزة شهادات'],
  uk: ['Налаштувати WebRTC', 'Пристрої', 'Сертифікати DTLS', 'Зберегти й увімкнути Custom', 'вебртс пристрої ідентифікатори сертифікати'],
  fr: ['Configurer WebRTC', 'Appareils', 'Certificats DTLS', 'Enregistrer et utiliser Custom', 'appareils identifiants certificats'],
  pt_BR: ['Configurar WebRTC', 'Dispositivos', 'Certificados DTLS', 'Salvar e usar Custom', 'dispositivos identificadores certificados'],
  hi: ['WebRTC सेट करें', 'डिवाइस', 'DTLS प्रमाणपत्र', 'सहेजें और Custom इस्तेमाल करें', 'वेबआरटीसी डिवाइस उपकरण पहचानकर्ता प्रमाणपत्र'],
  ur: ['WebRTC ترتیب دیں', 'آلات', 'DTLS سرٹیفکیٹ', 'محفوظ کریں اور Custom استعمال کریں', 'ویب آر ٹی سی آلات شناخت کار سرٹیفکیٹ'],
  ja: ['WebRTCを設定', 'デバイス', 'DTLS証明書', '保存してCustomを使用', 'デバイス 機器 識別子 証明書'],
  de: ['WebRTC konfigurieren', 'Geräte', 'DTLS-Zertifikate', 'Speichern und Custom verwenden', 'Geräte Gerätekennungen Zertifikate'],
  pl: ['Skonfiguruj WebRTC', 'Urządzenia', 'Certyfikaty DTLS', 'Zapisz i użyj Custom', 'urządzenia identyfikatory certyfikaty'],
  id: ['Konfigurasi WebRTC', 'Perangkat', 'Sertifikat DTLS', 'Simpan dan gunakan Custom', 'perangkat pengenal identitas sertifikat'],
  mr: ['WebRTC सेट करा', 'डिव्हाइस', 'DTLS प्रमाणपत्रे', 'जतन करा आणि Custom वापरा', 'वेबआरटीसी डिव्हाइस उपकरणे ओळखचिन्हे प्रमाणपत्रे'],
  te: ['WebRTCని సెటప్ చేయండి', 'పరికరాలు', 'DTLS సర్టిఫికెట్లు', 'సేవ్ చేసి Custom వాడండి', 'వెబ్‌ఆర్‌టీసీ పరికరాలు గుర్తింపులు సర్టిఫికెట్లు'],
  ko: ['WebRTC 설정', '기기', 'DTLS 인증서', '저장하고 Custom 사용', '웹RTC 기기 장치 식별자 인증서'],
  ta: ['WebRTC அமைக்கவும்', 'சாதனங்கள்', 'DTLS சான்றிதழ்கள்', 'சேமித்து Custom பயன்படுத்தவும்', 'வெப்ஆர்டிசி சாதனங்கள் அடையாளங்கள் சான்றிதழ்கள்'],
  yue: ['设定 WebRTC', '装置', 'DTLS 证书', '储存并用 Custom', '装置 设备 识别码 标识符 证书'],
  wuu: ['设置 WebRTC', '设备', 'DTLS 证书', '保存并用 Custom', '设备 装置 标识符 证书'],
};
export const WEBRTC_DISCOVERY_MESSAGES = Object.freeze(Object.fromEntries(Object.entries(COPY).map(([locale, values]) => [locale, Object.freeze(Object.fromEntries(WEBRTC_DISCOVERY_KEYS.map((key, index) => [key, [
  'WebRTC', values[0], 'STUN / TURN · IPv4 / IPv6', values[1], values[2], values[3], 'WebRTC STUN TURN ICE IPv4 IPv6 IP DTLS ' + values[4],
][index]])))])));
export function applyWebRtcDiscoveryCopy(table, locale) {
  if (!Object.hasOwn(WEBRTC_DISCOVERY_MESSAGES, locale)) throw new Error('WebRTC discovery copy: unknown locale ' + String(locale));
  for (const key of WEBRTC_DISCOVERY_KEYS) table[key] = { message: WEBRTC_DISCOVERY_MESSAGES[locale][key] };
  return table;
}
