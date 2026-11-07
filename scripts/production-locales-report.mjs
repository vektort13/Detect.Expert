// REQ-002/013: plain-language headings for the recorded Pro data tables.
export const PRO_REPORT_KEYS = Object.freeze([
  'report_data_title', 'report_data_parameters', 'report_data_value',
  'report_data_document', 'report_data_operation', 'report_data_samples',
  'report_data_no_values', 'report_data_checks', 'report_data_details',
  'report_data_companies', 'report_summary_values_title', 'report_summary_cookies_title', 'report_summary_name',
  'report_cookie_values_unavailable', 'report_cookie_values_limited', 'report_data_limited',
]);

const COPY = {
  en: [
    'Data read by the site', 'Arguments', 'Value', 'Document', 'Site action', 'Recorded calls',
    'No technical values were recorded during this session.', 'Checks and API calls', 'Recording details', 'Detected companies and services',
  ],
  ru: [
    'Данные, прочитанные сайтом', 'Параметры', 'Значение', 'Документ', 'Действие сайта', 'Записанные обращения',
    'За время записи технические значения не сохранены.', 'Проверки и обращения к API', 'Сведения о записи', 'Обнаруженные компании и сервисы',
  ],
  zh_CN: [
    '网站读取的数据', '参数', '值', '文档', '网站操作', '已记录的调用',
    '本次记录期间未保存技术值。', '检查与 API 调用', '记录详情', '检测到的公司和服务',
  ],
  vi: [
    'Dữ liệu trang web đã đọc', 'Tham số', 'Giá trị', 'Tài liệu', 'Thao tác của trang web', 'Lời gọi đã ghi lại',
    'Không ghi lại giá trị kỹ thuật nào trong phiên này.', 'Kiểm tra và lời gọi API', 'Chi tiết bản ghi', 'Công ty và dịch vụ được phát hiện',
  ],
  es: [
    'Datos leídos por el sitio', 'Argumentos', 'Valor', 'Documento', 'Acción del sitio', 'Llamadas registradas',
    'No se registraron valores técnicos durante esta sesión.', 'Comprobaciones y llamadas a API', 'Detalles de la grabación', 'Empresas y servicios detectados',
  ],
  ar: [
    'البيانات التي قرأها الموقع', 'المعاملات', 'القيمة', 'المستند', 'إجراء الموقع', 'الاستدعاءات المسجّلة',
    'لم تُسجّل قيم تقنية خلال هذه الجلسة.', 'الفحوصات واستدعاءات API', 'تفاصيل التسجيل', 'الشركات والخدمات المكتشفة',
  ],
  uk: [
    'Дані, прочитані сайтом', 'Параметри', 'Значення', 'Документ', 'Дія сайту', 'Записані звернення',
    'За час запису технічні значення не збережено.', 'Перевірки та звернення до API', 'Відомості про запис', 'Виявлені компанії та сервіси',
  ],
  fr: [
    'Données lues par le site', 'Arguments', 'Valeur', 'Document', 'Action du site', 'Appels enregistrés',
    'Aucune valeur technique n’a été enregistrée pendant cette session.', 'Vérifications et appels API', 'Détails de l’enregistrement', 'Entreprises et services détectés',
  ],
  pt_BR: [
    'Dados lidos pelo site', 'Argumentos', 'Valor', 'Documento', 'Ação do site', 'Chamadas registradas',
    'Nenhum valor técnico foi registrado durante esta sessão.', 'Verificações e chamadas de API', 'Detalhes da gravação', 'Empresas e serviços detectados',
  ],
  hi: [
    'साइट द्वारा पढ़ा गया डेटा', 'पैरामीटर', 'मान', 'दस्तावेज़', 'साइट की कार्रवाई', 'दर्ज किए गए कॉल',
    'इस सत्र के दौरान कोई तकनीकी मान दर्ज नहीं किया गया।', 'जाँच और API कॉल', 'रिकॉर्डिंग का विवरण', 'पता चली कंपनियाँ और सेवाएँ',
  ],
  ur: [
    'سائٹ کا پڑھا ہوا ڈیٹا', 'پیرامیٹرز', 'قدر', 'دستاویز', 'سائٹ کی کارروائی', 'ریکارڈ کی گئی کالز',
    'اس سیشن کے دوران کوئی تکنیکی قدر ریکارڈ نہیں کی گئی۔', 'جانچ اور API کالز', 'ریکارڈنگ کی تفصیلات', 'دریافت شدہ کمپنیاں اور خدمات',
  ],
  ja: [
    'サイトが読み取ったデータ', '引数', '値', 'ドキュメント', 'サイトの操作', '記録された呼び出し',
    'このセッションでは技術的な値は記録されていません。', 'チェックと API 呼び出し', '記録の詳細', '検出された企業とサービス',
  ],
  de: [
    'Von der Website gelesene Daten', 'Argumente', 'Wert', 'Dokument', 'Aktion der Website', 'Aufgezeichnete Aufrufe',
    'Während dieser Sitzung wurden keine technischen Werte aufgezeichnet.', 'Prüfungen und API-Aufrufe', 'Details der Aufzeichnung', 'Erkannte Unternehmen und Dienste',
  ],
  pl: [
    'Dane odczytane przez witrynę', 'Argumenty', 'Wartość', 'Dokument', 'Działanie witryny', 'Zarejestrowane wywołania',
    'Podczas tej sesji nie zarejestrowano wartości technicznych.', 'Sprawdzenia i wywołania API', 'Szczegóły zapisu', 'Wykryte firmy i usługi',
  ],
  id: [
    'Data yang dibaca situs', 'Argumen', 'Nilai', 'Dokumen', 'Tindakan situs', 'Panggilan yang direkam',
    'Tidak ada nilai teknis yang direkam selama sesi ini.', 'Pemeriksaan dan panggilan API', 'Detail rekaman', 'Perusahaan dan layanan yang terdeteksi',
  ],
  mr: [
    'साइटने वाचलेला डेटा', 'पॅरामीटर्स', 'मूल्य', 'दस्तऐवज', 'साइटची कृती', 'नोंदवलेले कॉल',
    'या सत्रादरम्यान कोणतीही तांत्रिक मूल्ये नोंदवली गेली नाहीत.', 'तपासण्या आणि API कॉल', 'नोंदीचे तपशील', 'आढळलेल्या कंपन्या आणि सेवा',
  ],
  te: [
    'సైట్ చదివిన డేటా', 'పారామీటర్లు', 'విలువ', 'పత్రం', 'సైట్ చర్య', 'నమోదైన కాల్‌లు',
    'ఈ సెషన్‌లో సాంకేతిక విలువలు నమోదు కాలేదు.', 'తనిఖీలు మరియు API కాల్‌లు', 'రికార్డింగ్ వివరాలు', 'గుర్తించిన కంపెనీలు మరియు సేవలు',
  ],
  ko: [
    '사이트가 읽은 데이터', '인수', '값', '문서', '사이트 동작', '기록된 호출',
    '이 세션 동안 기록된 기술 값이 없습니다.', '검사 및 API 호출', '기록 세부 정보', '감지된 회사 및 서비스',
  ],
  ta: [
    'தளம் படித்த தரவு', 'அளவுருக்கள்', 'மதிப்பு', 'ஆவணம்', 'தளத்தின் செயல்', 'பதிவுசெய்யப்பட்ட அழைப்புகள்',
    'இந்த அமர்வில் தொழில்நுட்ப மதிப்புகள் எதுவும் பதிவுசெய்யப்படவில்லை.', 'சோதனைகள் மற்றும் API அழைப்புகள்', 'பதிவின் விவரங்கள்', 'கண்டறியப்பட்ட நிறுவனங்கள் மற்றும் சேவைகள்',
  ],
  yue: [
    '网站读取咗嘅数据', '参数', '数值', '文件', '网站操作', '记录咗嘅调用',
    '今次记录期间冇保存技术数值。', '检查同 API 调用', '记录详情', '检测到嘅公司同服务',
  ],
  wuu: [
    '网站读取个数据', '参数', '数值', '文档', '网站操作', '记录下来个调用',
    '搿趟记录期间呒没保存技术数值。', '检查搭 API 调用', '记录详情', '检测着个公司搭服务',
  ],
};

const SUMMARY_COPY = {
  en: ['Browser values — summary', 'Sent cookies — summary', 'Name'],
  ru: ['Сводная таблица значений браузера', 'Сводная таблица переданных cookies', 'Имя'],
  zh_CN: ['浏览器值汇总', '已发送 Cookie 汇总', '名称'],
  yue: ['浏览器数值汇总', '已传送 Cookie 汇总', '名称'],
  wuu: ['浏览器数值汇总表', '已发送 Cookie 汇总表', '名称'],
  vi: ['Bảng tổng hợp giá trị trình duyệt', 'Bảng tổng hợp cookie đã gửi', 'Tên'],
  es: ['Resumen de valores del navegador', 'Resumen de cookies enviadas', 'Nombre'],
  ar: ['ملخص قيم المتصفح', 'ملخص ملفات تعريف الارتباط المُرسلة', 'الاسم'],
  uk: ['Зведена таблиця значень браузера', 'Зведена таблиця переданих cookies', 'Назва'],
  fr: ['Récapitulatif des valeurs du navigateur', 'Récapitulatif des cookies envoyés', 'Nom'],
  pt_BR: ['Resumo dos valores do navegador', 'Resumo dos cookies enviados', 'Nome'],
  hi: ['ब्राउज़र मानों का सारांश', 'भेजी गई कुकी का सारांश', 'नाम'],
  ur: ['براؤزر کی قدروں کا خلاصہ', 'بھیجی گئی کوکیز کا خلاصہ', 'نام'],
  ja: ['ブラウザー値の一覧', '送信された Cookie の一覧', '名前'],
  de: ['Übersicht der Browserwerte', 'Übersicht der gesendeten Cookies', 'Name'],
  pl: ['Zestawienie wartości przeglądarki', 'Zestawienie wysłanych plików cookie', 'Nazwa'],
  id: ['Ringkasan nilai browser', 'Ringkasan cookie yang dikirim', 'Nama'],
  mr: ['ब्राउझर मूल्यांचा सारांश', 'पाठवलेल्या कुकीजचा सारांश', 'नाव'],
  te: ['బ్రౌజర్ విలువల సారాంశం', 'పంపిన కుకీల సారాంశం', 'పేరు'],
  ko: ['브라우저 값 요약', '전송된 쿠키 요약', '이름'],
  ta: ['உலாவி மதிப்புகளின் சுருக்கம்', 'அனுப்பப்பட்ட குக்கீகளின் சுருக்கம்', 'பெயர்']
};

// Final factual overlay for the explicitly started Pro outgoing-cookie recording.
const COOKIE_RECORDING_COPY = {
  en: ['Outgoing cookie values are unavailable in this browser.', 'Some outgoing cookie values were not recorded.', 'During a Pro recording, outgoing cookie names and values and the values of a fixed list of technical request headers are stored locally for the report.', 'cookie values, '],
  ru: ['Значения отправленных cookies недоступны в этом браузере.', 'Часть значений отправленных cookies не сохранена.', 'Во время записи Pro имена и значения отправленных cookies, а также значения фиксированного списка технических заголовков запросов сохраняются локально для отчёта.', 'значения cookie, '],
  zh_CN: ['此浏览器无法提供已发送 Cookie 的值。', '部分已发送 Cookie 的值未被记录。', '在 Pro 记录期间，已发送 Cookie 的名称和值，以及固定列表中技术性请求头的值，会保存在本地，用于生成报告。', 'Cookie 值、'],
  yue: ['呢个浏览器提供唔到已传送 Cookie 嘅值。', '部分已传送 Cookie 嘅值冇记录低。', 'Pro 记录期间，已传送 Cookie 嘅名称同数值，以及固定列表入面技术性请求头嘅数值，会储存喺本地，用嚟生成报告。', 'Cookie 值、'],
  wuu: ['搿个浏览器提供勿了已发送 Cookie 个值。', '一部分已发送 Cookie 个值呒没记录下来。', 'Pro 记录期间，已发送 Cookie 个名称搭数值，还有固定列表里向技术性请求头个数值，会保存在本地，用来生成报告。', 'Cookie 值、'],
  vi: ['Giá trị cookie gửi đi không có sẵn trong trình duyệt này.', 'Một số giá trị cookie gửi đi chưa được ghi lại.', 'Trong khi ghi Pro, tên và giá trị cookie gửi đi, cùng giá trị của một danh sách cố định các tiêu đề yêu cầu kỹ thuật, được lưu cục bộ cho báo cáo.', 'giá trị cookie, '],
  es: ['Los valores de las cookies enviadas no están disponibles en este navegador.', 'Algunos valores de las cookies enviadas no se registraron.', 'Durante una grabación Pro, los nombres y valores de las cookies enviadas y los valores de una lista fija de cabeceras técnicas de solicitud se guardan localmente para el informe.', 'valores de cookies, '],
  ar: ['قيم ملفات تعريف الارتباط المُرسلة غير متاحة في هذا المتصفح.', 'لم تُسجّل بعض قيم ملفات تعريف الارتباط المُرسلة.', 'أثناء تسجيل Pro، تُحفظ أسماء ملفات تعريف الارتباط المُرسلة وقيمها، إضافةً إلى قيم قائمة ثابتة من ترويسات الطلبات التقنية، محليًا للتقرير.', ' أو قيم ملفات تعريف الارتباط'],
  uk: ['Значення надісланих cookies недоступні в цьому браузері.', 'Частину значень надісланих cookies не збережено.', 'Під час запису Pro імена та значення надісланих cookies, а також значення технічних заголовків запитів із фіксованого списку зберігаються локально для звіту.', 'значення cookies, '],
  fr: ['Les valeurs des cookies envoyés ne sont pas disponibles dans ce navigateur.', 'Certaines valeurs des cookies envoyés n’ont pas été enregistrées.', 'Pendant un enregistrement Pro, les noms et valeurs des cookies envoyés ainsi que les valeurs d’une liste fixe d’en-têtes techniques de requêtes sont stockés localement pour le rapport.', 'valeurs de cookies, '],
  pt_BR: ['Os valores dos cookies enviados não estão disponíveis neste navegador.', 'Alguns valores dos cookies enviados não foram registrados.', 'Durante uma gravação Pro, os nomes e valores dos cookies enviados e os valores de uma lista fixa de cabeçalhos técnicos de requisição são armazenados localmente para o relatório.', 'valores de cookies, '],
  hi: ['इस ब्राउज़र में भेजी गई कुकी के मान उपलब्ध नहीं हैं।', 'भेजी गई कुछ कुकी के मान रिकॉर्ड नहीं हुए।', 'Pro रिकॉर्डिंग के दौरान, भेजी गई कुकी के नाम और मान, साथ ही अनुरोध के तकनीकी हेडर की एक निश्चित सूची के मान, रिपोर्ट के लिए स्थानीय रूप से सहेजे जाते हैं।', 'cookie के मान, '],
  ur: ['اس براؤزر میں بھیجی گئی کوکیز کی قدریں دستیاب نہیں ہیں۔', 'بھیجی گئی کچھ کوکیز کی قدریں ریکارڈ نہیں ہوئیں۔', 'Pro ریکارڈنگ کے دوران، بھیجی گئی کوکیز کے نام اور قدریں، نیز درخواستوں کے تکنیکی ہیڈرز کی ایک مقررہ فہرست کی قدریں، رپورٹ کے لیے مقامی طور پر محفوظ کی جاتی ہیں۔', 'cookie کی قدریں، '],
  ja: ['このブラウザーでは送信された Cookie の値を取得できません。', '送信された Cookie の値の一部は記録されませんでした。', 'Pro 記録中は、送信された Cookie の名前と値、および固定リストの技術的なリクエストヘッダーの値がレポート用にローカル保存されます。', 'cookie の値、'],
  de: ['Werte gesendeter Cookies sind in diesem Browser nicht verfügbar.', 'Einige Werte gesendeter Cookies wurden nicht aufgezeichnet.', 'Während einer Pro-Aufzeichnung werden die Namen und Werte gesendeter Cookies sowie die Werte einer festgelegten Liste technischer Anfrageheader lokal für den Bericht gespeichert.', 'Cookie-Werte, '],
  pl: ['Wartości wysłanych plików cookie są niedostępne w tej przeglądarce.', 'Niektóre wartości wysłanych plików cookie nie zostały zapisane.', 'Podczas nagrywania Pro nazwy i wartości wysłanych plików cookie oraz wartości technicznych nagłówków żądań ze stałej listy są zapisywane lokalnie na potrzeby raportu.', 'wartości cookies, '],
  id: ['Nilai cookie yang dikirim tidak tersedia di browser ini.', 'Sebagian nilai cookie yang dikirim tidak direkam.', 'Selama perekaman Pro, nama dan nilai cookie yang dikirim, serta nilai dari daftar tetap header permintaan teknis, disimpan secara lokal untuk laporan.', 'nilai cookie, '],
  mr: ['या ब्राउझरमध्ये पाठवलेल्या कुकीजची मूल्ये उपलब्ध नाहीत.', 'पाठवलेल्या काही कुकीजची मूल्ये नोंदवली गेली नाहीत.', 'Pro रेकॉर्डिंगदरम्यान, पाठवलेल्या कुकीजची नावे आणि मूल्ये, तसेच तांत्रिक विनंती हेडरच्या एका निश्चित यादीची मूल्ये अहवालासाठी स्थानिकरीत्या जतन केली जातात.', 'कुकी मूल्ये, '],
  te: ['ఈ బ్రౌజర్‌లో పంపిన కుకీల విలువలు అందుబాటులో లేవు.', 'పంపిన కొన్ని కుకీల విలువలు నమోదు కాలేదు.', 'Pro రికార్డింగ్ సమయంలో, పంపిన కుకీల పేర్లు మరియు విలువలు, అలాగే స్థిర జాబితాలోని సాంకేతిక అభ్యర్థన హెడర్\u200cల విలువలు నివేదిక కోసం స్థానికంగా నిల్వ చేయబడతాయి.', 'కుకీ విలువలు, '],
  ko: ['이 브라우저에서는 전송된 쿠키 값을 사용할 수 없습니다.', '전송된 쿠키 값 중 일부가 기록되지 않았습니다.', 'Pro 기록 중에는 전송된 쿠키의 이름과 값, 그리고 고정된 목록의 기술적 요청 헤더 값이 보고서를 위해 로컬에 저장됩니다.', '쿠키 값, '],
  ta: ['இந்த உலாவியில் அனுப்பப்பட்ட குக்கீகளின் மதிப்புகள் கிடைக்கவில்லை.', 'அனுப்பப்பட்ட சில குக்கீகளின் மதிப்புகள் பதிவுசெய்யப்படவில்லை.', 'Pro பதிவின்போது, அனுப்பப்பட்ட குக்கீகளின் பெயர்களும் மதிப்புகளும், நிலையான பட்டியலில் உள்ள தொழில்நுட்பக் கோரிக்கைத் தலைப்புகளின் மதிப்புகளும் அறிக்கைக்காக உள்ளூரில் சேமிக்கப்படுகின்றன.', 'குக்கி மதிப்புகள், ']
};

const CAPTURE_GAP_COPY = {
  en: 'Some observations could not be recorded.',
  ru: 'Часть наблюдений не удалось записать.',
  zh_CN: '部分观测结果未能记录。',
  yue: '部分观察结果未能记录低。',
  wuu: '一部分观察结果呒没能记录下来。',
  vi: 'Không thể ghi lại một số quan sát.',
  es: 'No se pudieron registrar algunas observaciones.',
  ar: 'تعذّر تسجيل بعض الملاحظات.',
  uk: 'Частину спостережень не вдалося записати.',
  fr: 'Certaines observations n’ont pas pu être enregistrées.',
  pt_BR: 'Não foi possível registrar algumas observações.',
  hi: 'कुछ अवलोकन रिकॉर्ड नहीं किए जा सके।',
  ur: 'کچھ مشاہدات ریکارڈ نہیں کیے جا سکے۔',
  ja: '一部の観測結果を記録できませんでした。',
  de: 'Einige Beobachtungen konnten nicht aufgezeichnet werden.',
  pl: 'Nie udało się zapisać niektórych obserwacji.',
  id: 'Sebagian pengamatan tidak dapat direkam.',
  mr: 'काही निरीक्षणे नोंदवता आली नाहीत.',
  te: 'కొన్ని పరిశీలనలను నమోదు చేయలేకపోయాము.',
  ko: '일부 관측 결과를 기록하지 못했습니다.',
  ta: 'சில கவனிப்புகளைப் பதிவுசெய்ய முடியவில்லை.'
};

export function applyProReportCopy(table, locale) {
  if (typeof locale !== 'string' || !Object.hasOwn(COPY, locale)) throw new Error('Pro report copy: unknown locale ' + String(locale));
  if (!table || typeof table !== 'object' || Array.isArray(table)) throw new TypeError('Pro report copy: expected a message table');
  const cookieCopy = COOKIE_RECORDING_COPY[locale];
  const copy = [...COPY[locale], ...SUMMARY_COPY[locale], ...cookieCopy.slice(0, 2), CAPTURE_GAP_COPY[locale]];
  if (copy.length !== PRO_REPORT_KEYS.length || copy.some(message => typeof message !== 'string' || !message.trim() || /\$[A-Z]+\$/.test(message))) {
    throw new Error('Pro report copy: incomplete translations for ' + locale);
  }
  for (let index = 0; index < PRO_REPORT_KEYS.length; index++) table[PRO_REPORT_KEYS[index]] = { message: copy[index] };
  for (const key of ['inventory_never', 'pro_start_note']) {
    if (typeof table[key]?.message !== 'string') continue;
    const message = key === 'inventory_never' ? table[key].message.replace(cookieCopy[3], '') : table[key].message;
    table[key] = { ...table[key], message: message.endsWith(cookieCopy[2]) ? message : message + ' ' + cookieCopy[2] };
  }
  return table;
}
