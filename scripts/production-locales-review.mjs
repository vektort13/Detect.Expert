// ADR-038: new review features, shared across the 21 UI languages.
import { applyReviewHeaderCopy } from './production/review-header-plan.mjs';
import { applyRtcReviewCopy } from './production/rtc-review-plan.mjs';
const COOKIE_WRITERS = {
  ru: 'Какие скрипты записывали cookies', en: 'Scripts writing cookies',
  zh_CN: '写入 Cookie 的脚本', vi: 'Tập lệnh ghi cookie', es: 'Scripts que escriben cookies',
  ar: 'البرامج النصية التي تكتب ملفات تعريف الارتباط', uk: 'Які скрипти записували cookies',
  fr: 'Scripts écrivant des cookies', pt_BR: 'Scripts que gravam cookies',
  hi: 'कुकी लिखने वाली स्क्रिप्ट', ur: 'کوکیز لکھنے والے اسکرپٹس', ja: 'Cookie を書き込むスクリプト',
  de: 'Skripte, die Cookies schreiben', pl: 'Skrypty zapisujące pliki cookie',
  id: 'Skrip yang menulis cookie', mr: 'कुकी लिहिणाऱ्या स्क्रिप्ट', te: 'కుకీలను రాసే స్క్రిప్ట్‌లు',
  ko: '쿠키를 기록하는 스크립트', ta: 'குக்கிகளை எழுதும் ஸ்கிரிப்ட்கள்',
  yue: '寫入 Cookie 嘅指令碼', wuu: '写入 Cookie 个脚本',
};

// Existing coverage status only: describe the implemented scope without obsolete gaps.
export const REVIEW_COVERAGE_COPY = {
  en: 'Math patterns: during Pro recording. Worker/Worklet, WebGPU buffers and sensors: selected API calls. Not observed: CSSOM, HTTP validators, CNAME, Wasm/worker/CSS internals, DNS, TLS and server-side checks.',
  ru: 'Шаблоны Math — во время записи Pro. Worker/Worklet, буферы WebGPU и датчики — отдельные вызовы API. Не наблюдаются: CSSOM, HTTP-валидаторы, CNAME, внутренние вычисления Wasm/worker/CSS, DNS, TLS и серверные проверки.',
  zh_CN: 'Math 模式：Pro 录制期间。Worker/Worklet、WebGPU 缓冲区和传感器：部分 API 调用。未观察：CSSOM、HTTP 验证器、CNAME、Wasm/worker/CSS 内部执行、DNS、TLS 和服务器端检查。',
  vi: 'Mẫu Math: trong khi ghi Pro. Worker/Worklet, bộ đệm WebGPU và cảm biến: một số lệnh gọi API. Chưa quan sát: CSSOM, bộ xác thực HTTP, CNAME, hoạt động nội bộ Wasm/worker/CSS, DNS, TLS và kiểm tra phía máy chủ.',
  es: 'Patrones Math: durante la grabación Pro. Worker/Worklet, búferes WebGPU y sensores: llamadas API seleccionadas. Sin observar: CSSOM, validadores HTTP, CNAME, operaciones internas de Wasm/worker/CSS, DNS, TLS y comprobaciones del servidor.',
  ar: 'أنماط Math: أثناء تسجيل Pro. Worker/Worklet ومخازن WebGPU والمستشعرات: استدعاءات API محددة. غير مرصود: CSSOM ومدققات HTTP وCNAME والعمليات الداخلية لـWasm/worker/CSS وDNS وTLS والفحوصات على الخادم.',
  uk: 'Шаблони Math — під час запису Pro. Worker/Worklet, буфери WebGPU та датчики — окремі виклики API. Не спостерігаються: CSSOM, HTTP-валідатори, CNAME, внутрішні обчислення Wasm/worker/CSS, DNS, TLS і серверні перевірки.',
  fr: 'Motifs Math : pendant l’enregistrement Pro. Worker/Worklet, tampons WebGPU et capteurs : certains appels API. Non observés : CSSOM, validateurs HTTP, CNAME, opérations internes de Wasm/worker/CSS, DNS, TLS et vérifications côté serveur.',
  pt_BR: 'Padrões Math: durante a gravação Pro. Worker/Worklet, buffers WebGPU e sensores: chamadas API selecionadas. Não observados: CSSOM, validadores HTTP, CNAME, operações internas de Wasm/worker/CSS, DNS, TLS e verificações no servidor.',
  hi: 'Math पैटर्न: Pro रिकॉर्डिंग के दौरान। Worker/Worklet, WebGPU बफ़र और सेंसर: चुनिंदा API कॉल। निरीक्षण के बाहर: CSSOM, HTTP वैलिडेटर, CNAME, Wasm/worker/CSS की आंतरिक क्रियाएँ, DNS, TLS और सर्वर की जाँच।',
  ur: 'Math پیٹرن: Pro ریکارڈنگ کے دوران۔ Worker/Worklet، WebGPU بفرز اور سینسرز: منتخب API کالز۔ مشاہدے سے باہر: CSSOM، HTTP ویلیڈیٹرز، CNAME، Wasm/worker/CSS کے اندرونی عمل، DNS، TLS اور سرور کی جانچ۔',
  ja: 'Math パターン：Pro 記録中。Worker/Worklet、WebGPU バッファー、センサー：一部の API 呼び出し。未観測：CSSOM、HTTP 検証子、CNAME、Wasm/worker/CSS 内部処理、DNS、TLS、サーバー側の検査。',
  de: 'Math-Muster: während der Pro-Aufzeichnung. Worker/Worklet, WebGPU-Puffer und Sensoren: ausgewählte API-Aufrufe. Nicht beobachtet: CSSOM, HTTP-Validatoren, CNAME, interne Wasm/worker/CSS-Abläufe, DNS, TLS und serverseitige Prüfungen.',
  pl: 'Wzorce Math: podczas nagrywania Pro. Worker/Worklet, bufory WebGPU i czujniki: wybrane wywołania API. Poza obserwacją: CSSOM, walidatory HTTP, CNAME, wewnętrzne operacje Wasm/worker/CSS, DNS, TLS i kontrole po stronie serwera.',
  id: 'Pola Math: selama perekaman Pro. Worker/Worklet, buffer WebGPU dan sensor: panggilan API tertentu. Tidak diamati: CSSOM, validator HTTP, CNAME, operasi internal Wasm/worker/CSS, DNS, TLS dan pemeriksaan di server.',
  mr: 'Math नमुने: Pro रेकॉर्डिंगदरम्यान. Worker/Worklet, WebGPU बफर आणि सेन्सर: निवडक API कॉल. निरीक्षणाबाहेर: CSSOM, HTTP पडताळणी घटक, CNAME, Wasm/worker/CSS मधील अंतर्गत क्रिया, DNS, TLS आणि सर्व्हरवरील तपासण्या.',
  te: 'Math నమూనాలు: Pro రికార్డింగ్ సమయంలో. Worker/Worklet, WebGPU బఫర్‌లు, సెన్సర్‌లు: కొన్ని API కాల్‌లు. గమనించనివి: CSSOM, HTTP ధృవీకరణకాలు, CNAME, Wasm/worker/CSS అంతర్గత ప్రక్రియలు, DNS, TLS, సర్వర్ తనిఖీలు.',
  ko: 'Math 패턴: Pro 기록 중. Worker/Worklet, WebGPU 버퍼 및 센서: 일부 API 호출. 관찰 범위 밖: CSSOM, HTTP 검증자, CNAME, Wasm/worker/CSS 내부 처리, DNS, TLS 및 서버 측 검사.',
  ta: 'Math வடிவங்கள்: Pro பதிவின்போது. Worker/Worklet, WebGPU இடையகங்கள் மற்றும் உணரிகள்: குறிப்பிட்ட API அழைப்புகள். கண்காணிக்கப்படாதவை: CSSOM, HTTP சரிபார்ப்பிகள், CNAME, Wasm/worker/CSS உள் செயல்பாடுகள், DNS, TLS மற்றும் சேவையகச் சோதனைகள்.',
  yue: 'Math 模式：Pro 录制期间。Worker/Worklet、WebGPU 缓冲区同感应器：部分 API 呼叫。未观察：CSSOM、HTTP 验证器、CNAME、Wasm/worker/CSS 内部执行、DNS、TLS 同服务器端检查。',
  wuu: 'Math 模式：Pro 录制辰光。Worker/Worklet、WebGPU 缓冲区搭传感器：部分 API 调用。观察范围外：CSSOM、HTTP 验证器、CNAME、Wasm/worker/CSS 内部执行、DNS、TLS 搭服务器端检查。',
};

export const REVIEW_MECHANISM_KEYS = Object.freeze(['api_mechanism_device_sensor', 'api_mechanism_webtransport', 'api_mechanism_webauthn', 'api_mechanism_clipboard', 'api_mechanism_worker', 'api_mechanism_storage']);
export const REVIEW_MECHANISM_COPY = {
  en: ['Device sensors', 'WebTransport', 'WebAuthn', 'Clipboard', 'Workers and worklets', 'Storage'],
  ru: ['Датчики устройства', 'WebTransport', 'WebAuthn', 'Буфер обмена', 'Worker и Worklet', 'Хранилища'],
  zh_CN: ['设备传感器', 'WebTransport', 'WebAuthn', '剪贴板', 'Worker 与 Worklet', '存储'],
  vi: ['Cảm biến thiết bị', 'WebTransport', 'WebAuthn', 'Bộ nhớ tạm', 'Worker và Worklet', 'Lưu trữ'],
  es: ['Sensores del dispositivo', 'WebTransport', 'WebAuthn', 'Portapapeles', 'Workers y worklets', 'Almacenamiento'],
  ar: ['مستشعرات الجهاز', 'WebTransport', 'WebAuthn', 'الحافظة', 'Worker وWorklet', 'التخزين'],
  uk: ['Датчики пристрою', 'WebTransport', 'WebAuthn', 'Буфер обміну', 'Worker і Worklet', 'Сховища'],
  fr: ['Capteurs de l’appareil', 'WebTransport', 'WebAuthn', 'Presse-papiers', 'Workers et worklets', 'Stockage'],
  pt_BR: ['Sensores do dispositivo', 'WebTransport', 'WebAuthn', 'Área de transferência', 'Workers e worklets', 'Armazenamento'],
  hi: ['डिवाइस सेंसर', 'WebTransport', 'WebAuthn', 'क्लिपबोर्ड', 'Worker और Worklet', 'स्टोरेज'],
  ur: ['ڈیوائس سینسرز', 'WebTransport', 'WebAuthn', 'کلپ بورڈ', 'Worker اور Worklet', 'اسٹوریج'],
  ja: ['デバイスセンサー', 'WebTransport', 'WebAuthn', 'クリップボード', 'Worker と Worklet', 'ストレージ'],
  de: ['Gerätesensoren', 'WebTransport', 'WebAuthn', 'Zwischenablage', 'Worker und Worklets', 'Speicher'],
  pl: ['Czujniki urządzenia', 'WebTransport', 'WebAuthn', 'Schowek', 'Workery i worklety', 'Pamięć'],
  id: ['Sensor perangkat', 'WebTransport', 'WebAuthn', 'Papan klip', 'Worker dan Worklet', 'Penyimpanan'],
  mr: ['उपकरणाचे सेन्सर', 'WebTransport', 'WebAuthn', 'क्लिपबोर्ड', 'Worker आणि Worklet', 'साठवण'],
  te: ['పరికర సెన్సర్‌లు', 'WebTransport', 'WebAuthn', 'క్లిప్‌బోర్డ్', 'Worker మరియు Worklet', 'నిల్వ'],
  ko: ['기기 센서', 'WebTransport', 'WebAuthn', '클립보드', 'Worker 및 Worklet', '저장소'],
  ta: ['சாதன உணரிகள்', 'WebTransport', 'WebAuthn', 'கிளிப்போர்டு', 'Worker மற்றும் Worklet', 'சேமிப்பகம்'],
  yue: ['装置感应器', 'WebTransport', 'WebAuthn', '剪贴簿', 'Worker 同 Worklet', '储存'],
  wuu: ['设备传感器', 'WebTransport', 'WebAuthn', '剪贴板', 'Worker 搭 Worklet', '存储'],
};

export function applyReviewCopy(table, locale) {
  if (!Object.hasOwn(COOKIE_WRITERS, locale) || !Object.hasOwn(REVIEW_COVERAGE_COPY, locale) || !Object.hasOwn(REVIEW_MECHANISM_COPY, locale)) throw Error('Missing review locale ' + locale);
  table.cookie_writers_title = { message: COOKIE_WRITERS[locale] };
  table.coverage_blind_spots_desc = { ...table.coverage_blind_spots_desc, message: REVIEW_COVERAGE_COPY[locale] };
  for (let index = 0; index < REVIEW_MECHANISM_KEYS.length; ++index) table[REVIEW_MECHANISM_KEYS[index]] = { message: REVIEW_MECHANISM_COPY[locale][index] };
  applyReviewHeaderCopy(table, locale);
  applyRtcReviewCopy(table, locale);
  return table;
}
