// Round 5 (ADR-101 amendment): authored copy for the typed controls of the Custom media-capabilities value (type media-codecs): the three
// answer flags, the hidden codec families and the honest explanation of what the list can and cannot do. Merged by production-locales.mjs
// into the same message tables as every other key (applyMediaCopy). The codec names themselves (H.264, AAC, ...) are not translated and
// live in the UI module. Honest-copy rules apply: no promise of invisibility or complete coverage; Workers and opaque documents are named
// as not covered. The UI module carries the English text as its fallback; a test keeps it equal to the `en` entry below.
// The translations were not reviewed by native speakers (like the other round-5 strings). {ZWNJ} is replaced by U+200C where Telugu needs it.
export const MEDIA_CODEC_FIELDS = Object.freeze(['flags', 'supported', 'smooth', 'power', 'families', 'note', 'all_off', 'json_invalid']);
export const MEDIA_CODEC_KEYS = Object.freeze(MEDIA_CODEC_FIELDS.map(field => 'media_codecs_' + field));
const COPY = {
  en: [
    'Answer given to the page', 'Supported', 'Smooth playback', 'Power efficient', 'Hide codec families',
    'A Custom value can only lower what this browser reports. Hidden families are reported as unsupported by MediaCapabilities, canPlayType and isTypeSupported in windows and same-origin frames; Workers and documents with an opaque origin (about:, blob:, data:) are not covered.',
    'Supported is off: every codec is reported as unsupported, whatever is ticked below.',
    'The JSON below is not a valid value. Fix it to use these controls.'
  ],
  ru: [
    'Ответ, который получает страница', 'Поддерживается', 'Плавное воспроизведение', 'Энергоэффективно', 'Скрыть семейства кодеков',
    'Значение Custom может только понизить то, что сообщает этот браузер. Скрытые семейства через MediaCapabilities, canPlayType и isTypeSupported сообщаются как не поддерживаемые в окнах и фреймах того же источника; Workers и документы с непрозрачным источником (about:, blob:, data:) не охватываются.',
    '«Поддерживается» выключено: все кодеки сообщаются как не поддерживаемые, что бы ни было отмечено ниже.',
    'JSON ниже не является допустимым значением. Исправьте его, чтобы пользоваться этими элементами.'
  ],
  zh_CN: [
    '提供给页面的回答', '支持', '流畅播放', '节能', '隐藏编解码器系列',
    'Custom 值只能降低此浏览器报告的内容。被隐藏的系列在窗口和同源框架中会被 MediaCapabilities、canPlayType 和 isTypeSupported 报告为不支持；不涵盖 Workers 以及不透明来源的文档（about:、blob:、data:）。',
    '“支持”已关闭：无论下方勾选了什么，所有编解码器都会被报告为不支持。',
    '下方的 JSON 不是有效值。修正后才能使用这些控件。'
  ],
  vi: [
    'Câu trả lời gửi cho trang', 'Được hỗ trợ', 'Phát mượt', 'Tiết kiệm điện', 'Ẩn các họ codec',
    'Giá trị Custom chỉ có thể hạ thấp những gì trình duyệt này báo cáo. Các họ bị ẩn được MediaCapabilities, canPlayType và isTypeSupported báo là không được hỗ trợ trong cửa sổ và khung cùng nguồn gốc; không bao gồm Workers và tài liệu có nguồn gốc opaque (about:, blob:, data:).',
    '“Được hỗ trợ” đang tắt: mọi codec đều được báo là không được hỗ trợ, bất kể mục nào được chọn bên dưới.',
    'JSON bên dưới không phải là giá trị hợp lệ. Hãy sửa để dùng các điều khiển này.'
  ],
  es: [
    'Respuesta que recibe la página', 'Compatible', 'Reproducción fluida', 'Eficiente en energía', 'Ocultar familias de códecs',
    'Un valor Custom solo puede reducir lo que informa este navegador. Las familias ocultas se informan como no compatibles en MediaCapabilities, canPlayType e isTypeSupported, en ventanas y marcos del mismo origen; no se cubren los Workers ni los documentos de origen opaco (about:, blob:, data:).',
    '«Compatible» está desactivado: todos los códecs se informan como no compatibles, independientemente de lo que esté marcado abajo.',
    'El JSON de abajo no es un valor válido. Corrígelo para usar estos controles.'
  ],
  ar: [
    'الإجابة التي تتلقاها الصفحة', 'مدعوم', 'تشغيل سلس', 'موفّر للطاقة', 'إخفاء عائلات الترميزات',
    'لا يمكن لقيمة Custom إلا خفض ما يُبلغ عنه هذا المتصفح. تُبلَّغ العائلات المخفية على أنها غير مدعومة عبر MediaCapabilities و canPlayType و isTypeSupported في النوافذ والإطارات ذات المصدر نفسه؛ ولا يشمل ذلك Workers والمستندات ذات المصدر المعتم (about: و blob: و data:).',
    '«مدعوم» متوقف: يُبلَّغ عن كل ترميز على أنه غير مدعوم، مهما كان المحدد أدناه.',
    'JSON أدناه ليس قيمة صالحة. أصلحه لاستخدام عناصر التحكم هذه.'
  ],
  uk: [
    'Відповідь, яку отримує сторінка', 'Підтримується', 'Плавне відтворення', 'Енергоефективно', 'Сховати сімейства кодеків',
    'Значення Custom може лише знизити те, що повідомляє цей браузер. MediaCapabilities, canPlayType та isTypeSupported повідомляють сховані сімейства як непідтримувані у вікнах і фреймах того самого джерела; Workers і документи з непрозорим джерелом (about:, blob:, data:) не охоплюються.',
    '«Підтримується» вимкнено: усі кодеки повідомляються як непідтримувані, що б не було позначено нижче.',
    'JSON нижче не є дійсним значенням. Виправте його, щоб користуватися цими елементами.'
  ],
  fr: [
    'Réponse donnée à la page', 'Pris en charge', 'Lecture fluide', 'Économe en énergie', 'Masquer des familles de codecs',
    'Une valeur Custom peut seulement abaisser ce que ce navigateur signale. Les familles masquées sont signalées comme non prises en charge par MediaCapabilities, canPlayType et isTypeSupported dans les fenêtres et les cadres de même origine ; les Workers et les documents à origine opaque (about:, blob:, data:) ne sont pas couverts.',
    '« Pris en charge » est désactivé : tous les codecs sont signalés comme non pris en charge, quelles que soient les cases cochées ci-dessous.',
    'Le JSON ci-dessous n’est pas une valeur valide. Corrigez-le pour utiliser ces commandes.'
  ],
  pt_BR: [
    'Resposta dada à página', 'Compatível', 'Reprodução fluida', 'Eficiente em energia', 'Ocultar famílias de codecs',
    'Um valor Custom só pode reduzir o que este navegador informa. As famílias ocultas são informadas como incompatíveis por MediaCapabilities, canPlayType e isTypeSupported em janelas e frames de mesma origem; Workers e documentos de origem opaca (about:, blob:, data:) não são abrangidos.',
    '“Compatível” está desativado: todos os codecs são informados como incompatíveis, seja qual for a seleção abaixo.',
    'O JSON abaixo não é um valor válido. Corrija-o para usar estes controles.'
  ],
  hi: [
    'पेज को दिया जाने वाला उत्तर', 'समर्थित', 'सुचारु प्लेबैक', 'ऊर्जा-कुशल', 'कोडेक परिवार छिपाएँ',
    'Custom मान केवल वही घटा सकता है जो यह ब्राउज़र रिपोर्ट करता है। छिपाए गए परिवार विंडो और समान-स्रोत फ़्रेम में MediaCapabilities, canPlayType और isTypeSupported द्वारा “समर्थित नहीं” रिपोर्ट किए जाते हैं; Workers और अपारदर्शी स्रोत वाले दस्तावेज़ (about:, blob:, data:) शामिल नहीं हैं।',
    '“समर्थित” बंद है: नीचे जो भी चुना हो, हर कोडेक “समर्थित नहीं” रिपोर्ट किया जाता है।',
    'नीचे का JSON मान्य मान नहीं है। इन नियंत्रणों का उपयोग करने के लिए इसे ठीक करें।'
  ],
  ur: [
    'صفحے کو دیا جانے والا جواب', 'تعاون موجود ہے', 'ہموار پلے بیک', 'توانائی کی بچت', 'کوڈیک فیملیز چھپائیں',
    'Custom قدر صرف وہی گھٹا سکتی ہے جو یہ براؤزر رپورٹ کرتا ہے۔ چھپائی گئی فیملیز کو ونڈو اور ایک ہی ماخذ کے فریمز میں MediaCapabilities، canPlayType اور isTypeSupported “تعاون موجود نہیں” کے طور پر رپورٹ کرتے ہیں؛ Workers اور مبہم ماخذ والے دستاویزات (about:، blob:، data:) شامل نہیں۔',
    '“تعاون موجود ہے” بند ہے: نیچے جو بھی منتخب ہو، ہر کوڈیک “تعاون موجود نہیں” کے طور پر رپورٹ ہوتا ہے۔',
    'نیچے دیا گیا JSON درست قدر نہیں ہے۔ ان کنٹرولز کو استعمال کرنے کے لیے اسے درست کریں۔'
  ],
  ja: [
    'ページに返す回答', '対応', 'スムーズな再生', '省電力', '非表示にするコーデックファミリー',
    'Custom の値は、このブラウザーが報告する内容を下げることしかできません。非表示のファミリーは、ウィンドウと同一オリジンのフレームで MediaCapabilities、canPlayType、isTypeSupported により非対応として報告されます。Workers と、不透明なオリジンを持つドキュメント（about:、blob:、data:）は対象外です。',
    '「対応」がオフです。下でどれを選んでも、すべてのコーデックが非対応として報告されます。',
    '下の JSON は有効な値ではありません。これらのコントロールを使うには修正してください。'
  ],
  de: [
    'Antwort an die Seite', 'Unterstützt', 'Flüssige Wiedergabe', 'Energieeffizient', 'Codec-Familien ausblenden',
    'Ein Custom-Wert kann nur senken, was dieser Browser meldet. Ausgeblendete Familien werden von MediaCapabilities, canPlayType und isTypeSupported in Fenstern und Frames desselben Ursprungs als nicht unterstützt gemeldet; Workers und Dokumente mit opakem Ursprung (about:, blob:, data:) sind nicht abgedeckt.',
    '„Unterstützt“ ist aus: Jeder Codec wird als nicht unterstützt gemeldet, egal was unten angekreuzt ist.',
    'Das JSON unten ist kein gültiger Wert. Korrigiere es, um diese Steuerelemente zu nutzen.'
  ],
  pl: [
    'Odpowiedź przekazywana stronie', 'Obsługiwane', 'Płynne odtwarzanie', 'Energooszczędne', 'Ukryj rodziny kodeków',
    'Wartość Custom może tylko obniżyć to, co zgłasza ta przeglądarka. Ukryte rodziny są zgłaszane jako nieobsługiwane przez MediaCapabilities, canPlayType i isTypeSupported w oknach i ramkach z tego samego źródła; Workers oraz dokumenty o nieprzezroczystym źródle (about:, blob:, data:) nie są objęte.',
    '„Obsługiwane” jest wyłączone: każdy kodek jest zgłaszany jako nieobsługiwany, niezależnie od zaznaczeń poniżej.',
    'JSON poniżej nie jest poprawną wartością. Popraw go, aby używać tych kontrolek.'
  ],
  id: [
    'Jawaban yang diterima halaman', 'Didukung', 'Pemutaran lancar', 'Hemat daya', 'Sembunyikan keluarga codec',
    'Nilai Custom hanya dapat menurunkan apa yang dilaporkan browser ini. Keluarga yang disembunyikan dilaporkan sebagai tidak didukung oleh MediaCapabilities, canPlayType, dan isTypeSupported di jendela dan frame dengan origin yang sama; Workers serta dokumen dengan origin opak (about:, blob:, data:) tidak tercakup.',
    '“Didukung” nonaktif: semua codec dilaporkan sebagai tidak didukung, apa pun yang dicentang di bawah.',
    'JSON di bawah bukan nilai yang valid. Perbaiki agar kontrol ini dapat dipakai.'
  ],
  mr: [
    'पृष्ठाला दिले जाणारे उत्तर', 'समर्थित', 'सुरळीत प्लेबॅक', 'ऊर्जा-कार्यक्षम', 'कोडेक कुटुंबे लपवा',
    'Custom मूल्य हा ब्राउझर जे कळवतो ते फक्त कमी करू शकते. लपवलेली कुटुंबे विंडो आणि समान-स्रोत फ्रेममध्ये MediaCapabilities, canPlayType आणि isTypeSupported द्वारे “समर्थित नाही” म्हणून कळवली जातात; Workers आणि अपारदर्शक स्रोत असलेले दस्तऐवज (about:, blob:, data:) समाविष्ट नाहीत.',
    '“समर्थित” बंद आहे: खाली काहीही निवडले असले तरी प्रत्येक कोडेक “समर्थित नाही” म्हणून कळवला जातो.',
    'खालील JSON वैध मूल्य नाही. ही नियंत्रणे वापरण्यासाठी ते दुरुस्त करा.'
  ],
  te: [
    'పేజీకి ఇచ్చే సమాధానం', 'మద్దతు ఉంది', 'సాఫీ ప్లేబ్యాక్', 'విద్యుత్ ఆదా', 'కోడెక్ కుటుంబాలను దాచు',
    'Custom విలువ ఈ బ్రౌజర్ నివేదించే దాన్ని తగ్గించడం మాత్రమే చేయగలదు. దాచిన కుటుంబాలను MediaCapabilities, canPlayType, isTypeSupported విండోలలో మరియు ఒకే మూలం ఉన్న ఫ్రేమ్{ZWNJ}లలో “మద్దతు లేదు” అని నివేదిస్తాయి; Workers మరియు అపారదర్శక మూలం ఉన్న డాక్యుమెంట్లు (about:, blob:, data:) కవర్ కావు.',
    '“మద్దతు ఉంది” ఆపివేయబడింది: కింద ఏమి టిక్ చేసినా, ప్రతి కోడెక్ “మద్దతు లేదు” అని నివేదించబడుతుంది.',
    'కింది JSON చెల్లుబాటు అయ్యే విలువ కాదు. ఈ నియంత్రణలను ఉపయోగించడానికి దాన్ని సరిదిద్దండి.'
  ],
  ko: [
    '페이지에 전달되는 응답', '지원됨', '부드러운 재생', '전력 효율', '코덱 계열 숨기기',
    'Custom 값은 이 브라우저가 보고하는 내용을 낮추기만 할 수 있습니다. 숨긴 계열은 창과 동일 출처 프레임에서 MediaCapabilities, canPlayType, isTypeSupported가 ‘지원되지 않음’으로 보고합니다. Workers와 불투명한 출처의 문서(about:, blob:, data:)는 적용 범위에 포함되지 않습니다.',
    '‘지원됨’이 꺼져 있습니다. 아래에서 무엇을 선택해도 모든 코덱이 ‘지원되지 않음’으로 보고됩니다.',
    '아래 JSON은 올바른 값이 아닙니다. 이 컨트롤을 사용하려면 수정하세요.'
  ],
  ta: [
    'பக்கத்திற்கு வழங்கப்படும் பதில்', 'ஆதரிக்கப்படுகிறது', 'சீரான இயக்கம்', 'ஆற்றல் சிக்கனம்', 'கோடெக் குடும்பங்களை மறை',
    'Custom மதிப்பு இந்த உலாவி தெரிவிப்பதைக் குறைக்க மட்டுமே முடியும். மறைக்கப்பட்ட குடும்பங்கள் சாளரங்களிலும் ஒரே மூலத்தின் ஃப்ரேம்களிலும் MediaCapabilities, canPlayType, isTypeSupported ஆகியவற்றால் “ஆதரிக்கப்படவில்லை” எனத் தெரிவிக்கப்படுகின்றன; Workers மற்றும் ஒளிபுகா மூலம் கொண்ட ஆவணங்கள் (about:, blob:, data:) இதில் அடங்காது.',
    '“ஆதரிக்கப்படுகிறது” அணைக்கப்பட்டுள்ளது: கீழே எதைத் தேர்ந்தெடுத்தாலும், ஒவ்வொரு கோடெக்கும் “ஆதரிக்கப்படவில்லை” எனத் தெரிவிக்கப்படும்.',
    'கீழே உள்ள JSON செல்லுபடியாகும் மதிப்பு அல்ல. இந்தக் கட்டுப்பாடுகளைப் பயன்படுத்த அதைச் சரிசெய்யவும்.'
  ],
  yue: [
    '畀页面嘅答复', '支持', '流畅播放', '节能', '隐藏编解码器系列',
    'Custom 值只可以调低呢个浏览器报告嘅内容。被隐藏嘅系列喺窗口同同源框架入面，会被 MediaCapabilities、canPlayType 同 isTypeSupported 报告为唔支持；唔涵盖 Workers 同不透明来源嘅文档（about:、blob:、data:）。',
    '「支持」已关闭：无论下面剔咗乜，所有编解码器都会报告为唔支持。',
    '下面嘅 JSON 唔系有效值。请先修正，先可以用呢啲控件。'
  ],
  wuu: [
    '拨页面个答复', '支持', '流畅播放', '节能', '隐藏编解码器系列',
    'Custom 值只能降低此浏览器报告个内容。被隐藏个系列，在窗口搭同源框架里，会被 MediaCapabilities、canPlayType 搭 isTypeSupported 报告成勿支持；弗涵盖 Workers 搭不透明来源个文档（about:、blob:、data:）。',
    '“支持”已关闭：不管下面勾了啥，所有编解码器都会报告成勿支持。',
    '下面个 JSON 弗是有效值。请先修正，再使用这些控件。'
  ]
};
const ZWNJ = String.fromCodePoint(0x200c);
export const MEDIA_CODEC_MESSAGES = Object.freeze(Object.fromEntries(Object.entries(COPY).map(([locale, values]) => {
  if (values.length !== MEDIA_CODEC_KEYS.length) throw new Error('Media codec copy: wrong number of strings for ' + locale);
  const texts = values.map(value => value.replaceAll('{ZWNJ}', ZWNJ));
  if (texts.some(value => !value || value !== value.trim() || value.includes('\n'))) throw new Error('Media codec copy: empty, untrimmed or multi-line text for ' + locale);
  return [locale, Object.freeze(Object.fromEntries(MEDIA_CODEC_KEYS.map((key, index) => [key, texts[index]])))];
})));
export function applyMediaCopy(table, locale) {
  if (!Object.hasOwn(MEDIA_CODEC_MESSAGES, locale)) throw new Error('Media codec copy: unknown locale ' + String(locale));
  if (!table || typeof table !== 'object' || Array.isArray(table)) throw new TypeError('Media codec copy: expected a message table');
  for (const key of MEDIA_CODEC_KEYS) table[key] = { message: MEDIA_CODEC_MESSAGES[locale][key] };
  return table;
}
