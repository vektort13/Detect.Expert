// Update existing factual statements that became obsolete when the user enabled Pro result retention.
// Ordinary samples/pixels/SDP are still excluded; this only changes claims about selected technical API values.
const CAPTURE_COPY = {
  en: 'Selected technical results are retained locally during Pro recording.',
  ru: 'Во время записи Pro выбранные технические результаты сохраняются локально.',
  de: 'Ausgewählte technische Ergebnisse werden bei laufender Pro-Aufzeichnung lokal gespeichert.',
  pl: 'Podczas nagrywania Pro wybrane wyniki techniczne są zachowywane lokalnie.',
  id: 'Hasil teknis terpilih disimpan secara lokal selama perekaman Pro.',
  zh_CN: 'Pro 录制期间，选定的技术结果会保存在本地。',
  vi: 'Khi ghi Pro, các kết quả kỹ thuật được chọn được lưu cục bộ.',
  es: 'Durante la grabación Pro, los resultados técnicos seleccionados se conservan localmente.',
  ar: 'تُحفظ النتائج التقنية المحددة محليًا أثناء تسجيل Pro.',
  uk: 'Під час запису Pro вибрані технічні результати зберігаються локально.',
  fr: 'Les résultats techniques sélectionnés sont conservés localement pendant l’enregistrement Pro.',
  pt_BR: 'Os resultados técnicos selecionados são mantidos localmente durante a gravação Pro.',
  hi: 'Pro रिकॉर्डिंग के दौरान चुने गए तकनीकी परिणाम स्थानीय रूप से रखे जाते हैं।',
  ur: 'Pro ریکارڈنگ کے دوران منتخب تکنیکی نتائج مقامی طور پر محفوظ رہتے ہیں۔',
  ja: 'Pro 記録中は、選択された技術的な結果がローカルに保存されます。',
  yue: 'Pro 录制紧嗰阵，拣咗嘅技术结果会储存喺本地。',
  wuu: 'Pro 勒浪录制个辰光，挑选个技术结果会存勒本地。',
};

const AUDIO_REMOVE = {
  en: ', parameter values', ru: ', значения параметров', de: ', Parameterwerte', pl: ', wartości parametrów',
  id: ', nilai parameter', zh_CN: '、参数值', vi: ', giá trị tham số', es: ', valores de parámetros',
  ar: ' أو قيم المعلمات', uk: ', значення параметрів', fr: ', valeurs des paramètres', pt_BR: ', valores de parâmetros',
  hi: ', पैरामीटर मान', ur: '، پیرامیٹر کی قدریں', ja: '、パラメーター値', yue: '、参数值', wuu: '、参数值',
};
const WASM_REMOVE = {
  en: ', results', ru: ', результаты', de: ', Ergebnisse', pl: ', wyniki', id: ', hasil', zh_CN: '、结果',
  vi: ', kết quả', es: ', resultados', ar: ' أو النتائج', uk: ', результати', fr: ', résultats', pt_BR: ', resultados',
  hi: ', परिणाम', ur: '، نتائج', ja: '、結果', yue: '、结果', wuu: '、结果',
};
const MEDIA_ONLY = {
  en: ['only in the local preview', 'in the result preview'], ru: ['только в локальном preview', 'в предпросмотре результатов'],
  de: ['nur lokal', 'in der Ergebnisvorschau'], pl: ['tylko lokalnie', 'w podglądzie wyników'],
  id: ['hanya dalam pratinjau lokal', 'dalam pratinjau hasil'], zh_CN: ['仅在本地预览中', '在结果预览中'],
  vi: ['chỉ hiện trong bản xem cục bộ', 'hiện trong bản xem kết quả'], es: ['solo aparecen en la vista local', 'aparecen en la vista de resultados'],
  ar: ['محلياً فقط', 'في معاينة النتائج'], uk: ['лише локально', 'у перегляді результатів'],
  fr: ['uniquement dans l’aperçu local', 'dans l’aperçu des résultats'], pt_BR: ['apenas na visualização local', 'na visualização dos resultados'],
  hi: ['केवल स्थानीय पूर्वावलोकन', 'परिणामों के पूर्वावलोकन'], ur: ['صرف مقامی پیش منظر', 'نتائج کے پیش منظر'],
  ja: ['ローカルでのみ表示', '結果プレビューで表示'], yue: ['净系在本地预览中', '喺结果预览中'], wuu: ['只在本地预览中', '勒结果预览里向'],
};
const CERTIFICATE_PREVIEW_PHRASE = {
  en: ' and certificate previews', ru: ' и предпросмотр сертификатов', de: ' und Zertifikatvorschauen',
  pl: ' i podglądy certyfikatów', id: ', dan pratinjau sertifikat', zh_CN: '和证书预览', vi: ' và bản xem trước chứng chỉ',
  es: ' y vistas previas de certificados', ar: ' ومعاينات الشهادات', uk: ' й попередній перегляд сертифікатів',
  fr: ' et aperçus de certificats', pt_BR: ' e prévias de certificados', hi: ' और प्रमाणपत्र पूर्वावलोकन', ur: ' اور سرٹیفکیٹ پیش نظارے',
  ja: '、証明書プレビュー', yue: '同证书预览', wuu: '搭证书预览',
};

const PRO_LIMITS_COPY = {
  en: 'Sensitive request contents and images are excluded from this report.',
  ru: 'Содержимое запросов и изображения в отчёт не включаются.',
  de: 'Sensible Anfrageinhalte und Bilder fehlen im Bericht.',
  pl: 'Wrażliwa treść żądań i obrazy są wyłączone z raportu.',
  id: 'Isi permintaan sensitif dan gambar dikecualikan dari laporan ini.',
  zh_CN: '敏感请求内容和图像不包含在此报告中。',
  vi: 'Nội dung yêu cầu nhạy cảm và hình ảnh không được đưa vào báo cáo này.',
  es: 'El contenido sensible de las solicitudes y las imágenes se excluyen de este informe.',
  ar: 'لا يتضمن هذا التقرير محتويات الطلبات الحساسة أو الصور.',
  uk: 'Вміст запитів і зображення до звіту не входять.',
  fr: 'Le contenu sensible des requêtes et les images sont exclus de ce rapport.',
  pt_BR: 'O conteúdo sensível das requisições e as imagens são excluídos deste relatório.',
  hi: 'संवेदनशील अनुरोध सामग्री और चित्र इस रिपोर्ट में शामिल नहीं हैं।',
  ur: 'حساس درخواست مواد اور تصاویر اس رپورٹ میں شامل نہیں۔',
  ja: 'リクエストの機微な内容と画像は、このレポートから除外されます。',
  yue: '敏感请求内容同图像唔包含喺呢个报告入面。',
  wuu: '敏感请求内容搭图像勿包含勒迭个报告里向。',
};

// The final sentence in these existing messages contains the obsolete blanket retention claim.
// Where a semicolon separates a valid interpretation statement, keep that statement verbatim.
const CLAIM_KEYS = [
  'rtc_values_certificate', 'rtc_values_scope', 'api_note_webgpu', 'api_note_window_management',
  'api_note_compute_pressure', 'api_note_idle_detection', 'inspector_display_desc', 'inspector_cpu_desc',
  'inspector_memory_desc', 'inspector_performance_desc',
];

const JA_COPY = {
  rtc_values_certificate: 'この指紋は機器ではなく証明書を識別します。再利用は接続を関連付ける可能性がありますが、追跡の証明ではありません。Pro 記録中は、選択された技術的な結果がローカルに保存されます。',
  rtc_values_scope: '選択した同期結果のみです。Promise の結果、統計の反復、完全な SDP、ICE パスワード、機器 ID、ネットワーク上の DTLS ハンドシェイクは調べません。追加スナップショットは区別して表示します。Pro 記録中は、選択された技術的な結果がローカルに保存されます。',
  api_note_webgpu: '一覧では、アダプター情報、機能や制限へのアクセス、シェーダーやパイプラインの作成を区別します。ブラウザーは GPU 情報を制限・一般化する場合があります。Pro 記録中は、選択された技術的な結果がローカルに保存されます。正確な GPU 型番、完全なプロファイル、シェーダー時間測定を示すものではありません。',
  api_note_window_management: 'getScreenDetails は画面情報を要求し、window-management 権限が必要な場合があります。screens、currentScreen、各属性へのアクセスは別に示します。Pro 記録中は、選択された技術的な結果がローカルに保存されます。要求だけでは権限の付与や作業場所を確認できません。',
  api_note_compute_pressure: 'Compute Pressure は大まかな CPU 負荷状態を提供する場合があります。実装によっては、このタブ以外の負荷も反映されます。観測器の作成、observe/takeRecords の呼び出し、記録の読み取りは別の事実です。Pro 記録中は、選択された技術的な結果がローカルに保存されます。他タブの動作、冷却特性、ユーザーの不在は確認しません。',
  api_note_idle_detection: 'Idle Detection は許可後に活動状態や画面のロック状態を提供する場合があります。検出器の作成や start の呼び出しだけでは、有効な監視の開始を証明できません。Pro 記録中は、選択された技術的な結果がローカルに保存されます。',
  inspector_display_desc: '画面、ウィンドウ、モニター情報へのリクエストです。Pro 記録中は、選択された技術的な結果がローカルに保存されます。リクエストだけではモニター一覧にアクセスできたとは判断できません。',
  inspector_cpu_desc: 'hardwareConcurrency は、利用可能な論理プロセッサー数のブラウザーによる推定値です。Pro 記録中は、選択された技術的な結果がローカルに保存されます。物理 CPU コア数を特定するものではありません。',
  inspector_memory_desc: 'Device Memory が示すのはメモリ容量の概算区分であり、実際に搭載された正確な RAM 容量ではありません。Pro 記録中は、選択された技術的な結果がローカルに保存されます。',
  inspector_performance_desc: 'タイマーと Performance API は、ベンチマーク、アニメーション、解析にも使われます。Pro 記録中は、選択された技術的な結果がローカルに保存されます。この観測から目的は確認できません。',
};

const COMPUTE_REMOVE = {
  ar: ['لا تُحفظ القيم ولا ', 'لا '], es: ['No se guardan valores ni se establece ', 'No se establece '],
  vi: ['Không lưu giá trị hay xác lập ', 'Không xác lập '], zh_CN: ['不保留具体值，', ''],
  yue: ['唔保留具体值，', ''], wuu: ['勿保留具体值，', ''],
};

function replaceFinalRetentionClaim(message, replacement, keepTail) {
  if (message.includes(replacement)) return message;
  const sentences = message.match(/[^.。।۔]*[.。।۔]+\s*/gu);
  if (!sentences || sentences.length < 2) throw new Error('Pro copy: expected existing sentence boundaries: ' + message);
  const last = sentences.pop();
  let tail = '';
  if (keepTail) {
    const separator = last.search(/[;；؛]/u);
    if (separator >= 0) {
      tail = last.slice(separator + 1).trim();
      if (/^[a-zа-яіїєґ]/u.test(tail)) tail = tail[0].toLocaleUpperCase() + tail.slice(1);
    }
  }
  return sentences.join('').trim() + ' ' + replacement + (tail ? ' ' + tail : '');
}

export function applyProDetailsCopy(table, locale) {
  const capture = CAPTURE_COPY[locale];
  if (!capture) return table;
  const compute = COMPUTE_REMOVE[locale];
  if (compute && table.api_note_compute_pressure.message.includes(compute[0])) {
    table.api_note_compute_pressure.message = table.api_note_compute_pressure.message.replace(compute[0], capture + ' ' + compute[1]);
  }
  for (const key of CLAIM_KEYS) {
    if (locale === 'ja') { table[key].message = JA_COPY[key]; continue; }
    table[key].message = replaceFinalRetentionClaim(table[key].message, capture, key !== 'rtc_values_certificate' && key !== 'rtc_values_scope' && key !== 'api_note_idle_detection' && key !== 'inspector_memory_desc');
  }
  for (const [key, phrase] of [['api_note_audio', AUDIO_REMOVE[locale]], ['api_note_wasm', WASM_REMOVE[locale]]]) {
    if (phrase) table[key].message = table[key].message.replace(phrase, '');
  }
  const only = MEDIA_ONLY[locale];
  if (only) table.api_note_media_capabilities.message = table.api_note_media_capabilities.message.replace(only[0], only[1]);
  const certificate = CERTIFICATE_PREVIEW_PHRASE[locale];
  if (certificate) table.consent_previews.message = table.consent_previews.message.replace(certificate, '');
  table.pro_limits_note.message = replaceFinalRetentionClaim(table.pro_limits_note.message, PRO_LIMITS_COPY[locale], false);
  return table;
}
