// ADR-087: names for the fifteen typed Custom editors in every shipped locale.
export const FINGERPRINT_CUSTOM_LOCALE_IDS = Object.freeze(['navigator-metadata', 'navigator-plugins', 'screen-geometry', 'css-media', 'css-supports', 'intl-formatting', 'webgl-capabilities', 'webgpu-capabilities', 'canvas-text-metrics', 'audio-fingerprint', 'audio-metadata', 'clock-precision', 'canvas-font-policy', 'browser-surface', 'webgl-readback']);
export const FINGERPRINT_CUSTOM_LOCALE_KEYS = Object.freeze(FINGERPRINT_CUSTOM_LOCALE_IDS.map(id => 'protection_feature_' + id.replaceAll('-', '_')));
const COPY = {
  ru: 'Метаданные Navigator|Плагины и MIME-типы|Геометрия окна|Медиазапросы CSS|Поддержка свойств CSS|Форматирование Intl|Возможности WebGL|Возможности WebGPU|Метрики текста Canvas|Отпечаток аудио|Параметры аудио|Точность времени|Шрифты|Интерфейсы браузера|Чтение пикселей WebGL',
  en: 'Navigator metadata|Plugin and MIME metadata|Window geometry|CSS media queries|CSS feature support|Intl formatting|WebGL capabilities|WebGPU capabilities|Canvas text metrics|Audio fingerprint|Audio metadata|Clock precision|Fonts|Browser interfaces|WebGL pixel readback',
  zh_CN: 'Navigator 元数据|插件与 MIME 元数据|窗口几何信息|CSS 媒体查询|CSS 功能支持|Intl 格式化|WebGL 能力|WebGPU 能力|Canvas 文本度量|音频指纹|音频元数据|时钟精度|字体|浏览器接口|WebGL 像素读取',
  vi: 'Siêu dữ liệu Navigator|Siêu dữ liệu plugin và MIME|Kích thước cửa sổ|Truy vấn phương tiện CSS|Hỗ trợ tính năng CSS|Định dạng Intl|Khả năng WebGL|Khả năng WebGPU|Số đo văn bản Canvas|Dấu vân tay âm thanh|Siêu dữ liệu âm thanh|Độ chính xác đồng hồ|Phông chữ|Giao diện trình duyệt|Đọc điểm ảnh WebGL',
  es: 'Metadatos de Navigator|Metadatos de complementos y MIME|Geometría de ventana|Consultas de medios CSS|Compatibilidad con funciones CSS|Formato Intl|Capacidades WebGL|Capacidades WebGPU|Métricas de texto Canvas|Huella de audio|Metadatos de audio|Precisión del reloj|Fuentes|Interfaces del navegador|Lectura de píxeles WebGL',
  ar: 'بيانات Navigator الوصفية|بيانات الإضافات وMIME الوصفية|أبعاد النافذة|استعلامات وسائط CSS|دعم ميزات CSS|تنسيق Intl|إمكانات WebGL|إمكانات WebGPU|مقاييس نص Canvas|بصمة الصوت|بيانات الصوت الوصفية|دقة الساعة|الخطوط|واجهات المتصفح|قراءة بكسلات WebGL',
  uk: 'Метадані Navigator|Плагіни та MIME-типи|Геометрія вікна|Медіазапити CSS|Підтримка властивостей CSS|Форматування Intl|Можливості WebGL|Можливості WebGPU|Метрики тексту Canvas|Відбиток аудіо|Параметри аудіо|Точність часу|Шрифти|Інтерфейси браузера|Читання пікселів WebGL',
  fr: 'Métadonnées Navigator|Métadonnées des plugins et MIME|Géométrie de la fenêtre|Requêtes média CSS|Prise en charge CSS|Formatage Intl|Capacités WebGL|Capacités WebGPU|Mesures de texte Canvas|Empreinte audio|Métadonnées audio|Précision de l’horloge|Polices|Interfaces du navigateur|Lecture des pixels WebGL',
  pt_BR: 'Metadados do Navigator|Metadados de plugins e MIME|Geometria da janela|Consultas de mídia CSS|Suporte a recursos CSS|Formatação Intl|Recursos WebGL|Recursos WebGPU|Métricas de texto Canvas|Impressão digital de áudio|Metadados de áudio|Precisão do relógio|Fontes|Interfaces do navegador|Leitura de pixels WebGL',
  hi: 'Navigator मेटाडेटा|प्लगइन और MIME मेटाडेटा|विंडो की ज्यामिति|CSS मीडिया क्वेरी|CSS सुविधा समर्थन|Intl स्वरूपण|WebGL क्षमताएँ|WebGPU क्षमताएँ|Canvas पाठ माप|ऑडियो फ़िंगरप्रिंट|ऑडियो मेटाडेटा|घड़ी की सटीकता|फ़ॉन्ट|ब्राउज़र इंटरफ़ेस|WebGL पिक्सेल पठन',
  ur: 'Navigator میٹا ڈیٹا|پلگ ان اور MIME میٹا ڈیٹا|ونڈو کی پیمائش|CSS میڈیا سوالات|CSS خصوصیات کی معاونت|Intl فارمیٹنگ|WebGL صلاحیتیں|WebGPU صلاحیتیں|Canvas متن کی پیمائش|آڈیو فنگرپرنٹ|آڈیو میٹا ڈیٹا|گھڑی کی درستگی|فونٹس|براؤزر انٹرفیس|WebGL پکسل پڑھنا',
  ja: 'Navigator メタデータ|プラグインと MIME メタデータ|ウィンドウの寸法|CSS メディアクエリー|CSS 機能対応|Intl 書式設定|WebGL 機能|WebGPU 機能|Canvas テキスト計測|音声フィンガープリント|音声メタデータ|時計の精度|フォント|ブラウザーのインターフェース|WebGL ピクセル読み取り',
  de: 'Navigator-Metadaten|Plugin- und MIME-Metadaten|Fenstergeometrie|CSS-Medienabfragen|CSS-Funktionsunterstützung|Intl-Formatierung|WebGL-Fähigkeiten|WebGPU-Fähigkeiten|Canvas-Textmetriken|Audio-Fingerabdruck|Audio-Metadaten|Uhrengenauigkeit|Schriften|Browser-Schnittstellen|WebGL-Pixelauslesung',
  pl: 'Metadane Navigator|Metadane wtyczek i MIME|Geometria okna|Zapytania medialne CSS|Obsługa funkcji CSS|Formatowanie Intl|Możliwości WebGL|Możliwości WebGPU|Metryki tekstu Canvas|Odcisk audio|Metadane audio|Precyzja zegara|Czcionki|Interfejsy przeglądarki|Odczyt pikseli WebGL',
  id: 'Metadata Navigator|Metadata plugin dan MIME|Geometri jendela|Kueri media CSS|Dukungan fitur CSS|Pemformatan Intl|Kemampuan WebGL|Kemampuan WebGPU|Metrik teks Canvas|Sidik jari audio|Metadata audio|Presisi jam|Font|Antarmuka browser|Pembacaan piksel WebGL',
  mr: 'Navigator मेटाडेटा|प्लगइन आणि MIME मेटाडेटा|विंडोची भूमिती|CSS मीडिया क्वेरी|CSS वैशिष्ट्य समर्थन|Intl स्वरूपण|WebGL क्षमता|WebGPU क्षमता|Canvas मजकूर मापन|ऑडिओ फिंगरप्रिंट|ऑडिओ मेटाडेटा|घड्याळाची अचूकता|फॉन्ट|ब्राउझर इंटरफेस|WebGL पिक्सेल वाचन',
  te: 'Navigator మెటాడేటా|ప్లగిన్ మరియు MIME మెటాడేటా|విండో కొలతలు|CSS మీడియా ప్రశ్నలు|CSS ఫీచర్ మద్దతు|Intl ఆకృతీకరణ|WebGL సామర్థ్యాలు|WebGPU సామర్థ్యాలు|Canvas వచన కొలతలు|ఆడియో వేలిముద్ర|ఆడియో మెటాడేటా|గడియార ఖచ్చితత్వం|ఫాంట్లు|బ్రౌజర్ ఇంటర్‌ఫేస్‌లు|WebGL పిక్సెల్ పఠనం',
  ko: 'Navigator 메타데이터|플러그인 및 MIME 메타데이터|창 크기와 위치|CSS 미디어 쿼리|CSS 기능 지원|Intl 서식 지정|WebGL 기능|WebGPU 기능|Canvas 텍스트 측정|오디오 지문|오디오 메타데이터|시계 정밀도|글꼴|브라우저 인터페이스|WebGL 픽셀 읽기',
  ta: 'Navigator மெட்டாடேட்டா|செருகுநிரல் மற்றும் MIME மெட்டாடேட்டா|சாளர அளவுகள்|CSS ஊடக வினவல்கள்|CSS அம்ச ஆதரவு|Intl வடிவமைப்பு|WebGL திறன்கள்|WebGPU திறன்கள்|Canvas உரை அளவீடுகள்|ஒலி கைரேகை|ஒலி மெட்டாடேட்டா|கடிகாரத் துல்லியம்|எழுத்துருக்கள்|உலாவி இடைமுகங்கள்|WebGL படப்புள்ளி வாசிப்பு',
  yue: 'Navigator 元資料|外掛同 MIME 元資料|視窗尺寸同位置|CSS 媒體查詢|CSS 功能支援|Intl 格式設定|WebGL 功能|WebGPU 功能|Canvas 文字量度|音訊指紋|音訊元資料|時鐘精度|字型|瀏覽器介面|WebGL 像素讀取',
  wuu: 'Navigator 元数据|插件搭 MIME 元数据|窗口尺寸搭位置|CSS 媒体查询|CSS 功能支持|Intl 格式设置|WebGL 功能|WebGPU 功能|Canvas 文字测量|音频指纹|音频元数据|时钟精度|字体|浏览器接口|WebGL 像素读取'
};
export function applyFingerprintCustomCopy(table, locale) {
  if (!Object.hasOwn(COPY, locale)) throw new Error('Unknown Custom editor locale: ' + locale);
  const labels = COPY[locale].split('|');
  if (labels.length !== FINGERPRINT_CUSTOM_LOCALE_KEYS.length || labels.some(value => !value || value !== value.trim())) throw new Error('Incomplete Custom editor locale: ' + locale);
  for (let index = 0; index < labels.length; index++) table[FINGERPRINT_CUSTOM_LOCALE_KEYS[index]] = { message: labels[index] };
  return table;
}
