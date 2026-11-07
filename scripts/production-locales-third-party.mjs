// ADR-029: third-party resource inventory and owner-requested concise empty states.
export const THIRD_PARTY_KEYS = Object.freeze([
  'third_party_title', 'third_party_requests_total', 'third_party_domains_total',
  'third_party_resource', 'third_party_domain', 'third_party_type',
  'third_party_document', 'third_party_initiator', 'third_party_status',
  'third_party_completed', 'third_party_failed', 'third_party_redirects',
  'third_party_script_unknown', 'third_party_empty', 'third_party_unavailable',
  'third_party_limited', 'third_party_requests_badge', 'third_party_children',
  'third_party_filter', 'third_party_no_filter_match',
  'vendorsEmpty', 'frame_separate_hint', 'identification_third_empty'
]);

const COPY = {
  en: [
    'Third-party requests', 'Requests: $COUNT$', 'Domains: $COUNT$',
    'Resource', 'Domain', 'Request type', 'Document', 'Initiator', 'HTTP status',
    'Completed', 'Failed', 'Redirects', 'Initiating script unavailable',
    'No third-party requests recorded', 'Request data unavailable', 'Resource list truncated',
    'Third-party requests: $COUNT$', 'API activity in embedded documents',
    'Filter by domain or resource', 'No matching resources',
    'No anti-fraud systems identified.', 'Selected document',
    'No API activity recorded in embedded documents.'
  ],
  ru: [
    'Сторонние запросы', 'Запросы: $COUNT$', 'Домены: $COUNT$',
    'Ресурс', 'Домен', 'Тип запроса', 'Документ', 'Инициатор', 'HTTP-статус',
    'Завершено', 'Ошибки', 'Перенаправления', 'Скрипт-инициатор недоступен',
    'Сторонних запросов не зафиксировано', 'Данные запросов недоступны', 'Список ресурсов сокращён',
    'Сторонние запросы: $COUNT$', 'Обращения к API во встроенных документах',
    'Фильтр по домену или ресурсу', 'Подходящих ресурсов нет',
    'Антифрод-системы не обнаружены.', 'Выбранный документ',
    'Обращений к API во встроенных документах не зафиксировано.'
  ],
  zh_CN: [
    '第三方请求', '请求数：$COUNT$', '域名数：$COUNT$',
    '资源', '域名', '请求类型', '文档', '发起方', 'HTTP 状态',
    '已完成', '失败', '重定向', '发起请求的脚本不可用',
    '未记录第三方请求', '请求数据不可用', '资源列表已截断',
    '第三方请求：$COUNT$', '嵌入文档中的 API 活动',
    '按域名或资源筛选', '没有匹配的资源',
    '未识别到反欺诈系统。', '所选文档',
    '未记录嵌入文档中的 API 活动。'
  ],
  vi: [
    'Yêu cầu bên thứ ba', 'Yêu cầu: $COUNT$', 'Tên miền: $COUNT$',
    'Tài nguyên', 'Tên miền', 'Loại yêu cầu', 'Tài liệu', 'Bên khởi tạo', 'Trạng thái HTTP',
    'Hoàn tất', 'Thất bại', 'Chuyển hướng', 'Không có tập lệnh khởi tạo',
    'Không ghi nhận yêu cầu bên thứ ba', 'Không có dữ liệu yêu cầu', 'Danh sách tài nguyên bị cắt bớt',
    'Yêu cầu bên thứ ba: $COUNT$', 'Hoạt động API trong tài liệu nhúng',
    'Lọc theo tên miền hoặc tài nguyên', 'Không có tài nguyên phù hợp',
    'Không nhận diện được hệ thống chống gian lận.', 'Tài liệu đã chọn',
    'Không ghi nhận hoạt động API trong tài liệu nhúng.'
  ],
  es: [
    'Solicitudes a terceros', 'Solicitudes: $COUNT$', 'Dominios: $COUNT$',
    'Recurso', 'Dominio', 'Tipo de solicitud', 'Documento', 'Iniciador', 'Estado HTTP',
    'Completadas', 'Fallidas', 'Redirecciones', 'Script iniciador no disponible',
    'No se registraron solicitudes a terceros', 'Datos de solicitudes no disponibles', 'Lista de recursos truncada',
    'Solicitudes a terceros: $COUNT$', 'Actividad de API en documentos integrados',
    'Filtrar por dominio o recurso', 'No hay recursos coincidentes',
    'No se identificaron sistemas antifraude.', 'Documento seleccionado',
    'No se registró actividad de API en documentos integrados.'
  ],
  ar: [
    'طلبات الجهات الخارجية', 'الطلبات: $COUNT$', 'النطاقات: $COUNT$',
    'المورد', 'النطاق', 'نوع الطلب', 'المستند', 'الجهة المُبادِرة', 'حالة HTTP',
    'مكتملة', 'فاشلة', 'إعادات التوجيه', 'النص البرمجي المُبادِر غير متاح',
    'لم تُسجّل طلبات لجهات خارجية', 'بيانات الطلبات غير متاحة', 'قائمة الموارد مقتطعة',
    'طلبات الجهات الخارجية: $COUNT$', 'نشاط API في المستندات المضمّنة',
    'تصفية حسب النطاق أو المورد', 'لا توجد موارد مطابقة',
    'لم تُحدّد أنظمة مكافحة احتيال.', 'المستند المحدد',
    'لم يُسجّل نشاط API في المستندات المضمّنة.'
  ],
  uk: [
    'Сторонні запити', 'Запити: $COUNT$', 'Домени: $COUNT$',
    'Ресурс', 'Домен', 'Тип запиту', 'Документ', 'Ініціатор', 'HTTP-статус',
    'Завершено', 'Помилки', 'Перенаправлення', 'Скрипт-ініціатор недоступний',
    'Сторонніх запитів не зафіксовано', 'Дані запитів недоступні', 'Список ресурсів скорочено',
    'Сторонні запити: $COUNT$', 'Звернення до API у вбудованих документах',
    'Фільтр за доменом або ресурсом', 'Відповідних ресурсів немає',
    'Антифрод-системи не виявлено.', 'Вибраний документ',
    'Звернень до API у вбудованих документах не зафіксовано.'
  ],
  fr: [
    'Requêtes tierces', 'Requêtes : $COUNT$', 'Domaines : $COUNT$',
    'Ressource', 'Domaine', 'Type de requête', 'Document', 'Initiateur', 'Statut HTTP',
    'Terminées', 'Échecs', 'Redirections', 'Script initiateur indisponible',
    'Aucune requête tierce enregistrée', 'Données des requêtes indisponibles', 'Liste des ressources tronquée',
    'Requêtes tierces : $COUNT$', 'Activité API dans les documents intégrés',
    'Filtrer par domaine ou ressource', 'Aucune ressource correspondante',
    'Aucun système antifraude identifié.', 'Document sélectionné',
    'Aucune activité API enregistrée dans les documents intégrés.'
  ],
  pt_BR: [
    'Solicitações a terceiros', 'Solicitações: $COUNT$', 'Domínios: $COUNT$',
    'Recurso', 'Domínio', 'Tipo de solicitação', 'Documento', 'Iniciador', 'Status HTTP',
    'Concluídas', 'Falhas', 'Redirecionamentos', 'Script iniciador indisponível',
    'Nenhuma solicitação a terceiros registrada', 'Dados das solicitações indisponíveis', 'Lista de recursos truncada',
    'Solicitações a terceiros: $COUNT$', 'Atividade de API em documentos incorporados',
    'Filtrar por domínio ou recurso', 'Nenhum recurso correspondente',
    'Nenhum sistema antifraude identificado.', 'Documento selecionado',
    'Nenhuma atividade de API registrada em documentos incorporados.'
  ],
  hi: [
    'तृतीय-पक्ष अनुरोध', 'अनुरोध: $COUNT$', 'डोमेन: $COUNT$',
    'संसाधन', 'डोमेन', 'अनुरोध का प्रकार', 'दस्तावेज़', 'आरंभकर्ता', 'HTTP स्थिति',
    'पूर्ण', 'विफल', 'रीडायरेक्ट', 'अनुरोध शुरू करने वाली स्क्रिप्ट उपलब्ध नहीं है',
    'कोई तृतीय-पक्ष अनुरोध दर्ज नहीं हुआ', 'अनुरोध डेटा उपलब्ध नहीं है', 'संसाधनों की सूची सीमित की गई है',
    'तृतीय-पक्ष अनुरोध: $COUNT$', 'एम्बेड किए गए दस्तावेज़ों में API गतिविधि',
    'डोमेन या संसाधन के आधार पर फ़िल्टर करें', 'कोई मेल खाने वाला संसाधन नहीं है',
    'कोई धोखाधड़ी-रोधी सिस्टम पहचाना नहीं गया।', 'चुना गया दस्तावेज़',
    'एम्बेड किए गए दस्तावेज़ों में कोई API गतिविधि दर्ज नहीं हुई।'
  ],
  ur: [
    'تیسرے فریق کی درخواستیں', 'درخواستیں: $COUNT$', 'ڈومین: $COUNT$',
    'وسیلہ', 'ڈومین', 'درخواست کی قسم', 'دستاویز', 'درخواست شروع کرنے والا', 'HTTP کی حالت',
    'مکمل', 'ناکام', 'ری ڈائریکٹ', 'درخواست شروع کرنے والا اسکرپٹ دستیاب نہیں',
    'تیسرے فریق کی کوئی درخواست ریکارڈ نہیں ہوئی', 'درخواستوں کا ڈیٹا دستیاب نہیں', 'وسائل کی فہرست مختصر کر دی گئی ہے',
    'تیسرے فریق کی درخواستیں: $COUNT$', 'شامل کردہ دستاویزات میں API کی سرگرمی',
    'ڈومین یا وسیلے کے لحاظ سے فلٹر کریں', 'کوئی مطابقت رکھنے والا وسیلہ نہیں',
    'فراڈ سے بچاؤ کا کوئی نظام شناخت نہیں ہوا۔', 'منتخب دستاویز',
    'شامل کردہ دستاویزات میں API کی کوئی سرگرمی ریکارڈ نہیں ہوئی۔'
  ],
  ja: [
    'サードパーティのリクエスト', 'リクエスト数：$COUNT$', 'ドメイン数：$COUNT$',
    'リソース', 'ドメイン', 'リクエスト種別', 'ドキュメント', '開始元', 'HTTP ステータス',
    '完了', '失敗', 'リダイレクト', '開始元のスクリプトを取得できません',
    'サードパーティのリクエストは記録されていません', 'リクエストデータを取得できません', 'リソース一覧は一部省略されています',
    'サードパーティのリクエスト：$COUNT$', '埋め込みドキュメントの API 操作',
    'ドメインまたはリソースで絞り込む', '一致するリソースはありません',
    '不正対策システムは特定されていません。', '選択中のドキュメント',
    '埋め込みドキュメントの API 操作は記録されていません。'
  ],
  de: [
    'Anfragen an Drittanbieter', 'Anfragen: $COUNT$', 'Domains: $COUNT$',
    'Ressource', 'Domain', 'Anfragetyp', 'Dokument', 'Initiator', 'HTTP-Status',
    'Abgeschlossen', 'Fehlgeschlagen', 'Weiterleitungen', 'Auslösendes Skript nicht verfügbar',
    'Keine Anfragen an Drittanbieter erfasst', 'Anfragedaten nicht verfügbar', 'Ressourcenliste gekürzt',
    'Anfragen an Drittanbieter: $COUNT$', 'API-Aktivität in eingebetteten Dokumenten',
    'Nach Domain oder Ressource filtern', 'Keine passenden Ressourcen',
    'Keine Betrugsschutzsysteme identifiziert.', 'Ausgewähltes Dokument',
    'Keine API-Aktivität in eingebetteten Dokumenten erfasst.'
  ],
  pl: [
    'Żądania do stron trzecich', 'Żądania: $COUNT$', 'Domeny: $COUNT$',
    'Zasób', 'Domena', 'Typ żądania', 'Dokument', 'Inicjator', 'Status HTTP',
    'Zakończone', 'Nieudane', 'Przekierowania', 'Skrypt inicjujący niedostępny',
    'Nie zarejestrowano żądań do stron trzecich', 'Dane żądań niedostępne', 'Lista zasobów skrócona',
    'Żądania do stron trzecich: $COUNT$', 'Aktywność API w osadzonych dokumentach',
    'Filtruj według domeny lub zasobu', 'Brak pasujących zasobów',
    'Nie zidentyfikowano systemów antyfraudowych.', 'Wybrany dokument',
    'Nie zarejestrowano aktywności API w osadzonych dokumentach.'
  ],
  id: [
    'Permintaan pihak ketiga', 'Permintaan: $COUNT$', 'Domain: $COUNT$',
    'Sumber daya', 'Domain', 'Jenis permintaan', 'Dokumen', 'Pemrakarsa', 'Status HTTP',
    'Selesai', 'Gagal', 'Pengalihan', 'Skrip pemrakarsa tidak tersedia',
    'Tidak ada permintaan pihak ketiga yang tercatat', 'Data permintaan tidak tersedia', 'Daftar sumber daya terpotong',
    'Permintaan pihak ketiga: $COUNT$', 'Aktivitas API dalam dokumen tersemat',
    'Filter menurut domain atau sumber daya', 'Tidak ada sumber daya yang cocok',
    'Tidak ada sistem antifraud yang teridentifikasi.', 'Dokumen yang dipilih',
    'Tidak ada aktivitas API yang tercatat dalam dokumen tersemat.'
  ],
  mr: [
    'तृतीय-पक्ष विनंत्या', 'विनंत्या: $COUNT$', 'डोमेन: $COUNT$',
    'संसाधन', 'डोमेन', 'विनंतीचा प्रकार', 'दस्तऐवज', 'विनंती सुरू करणारा', 'HTTP स्थिती',
    'पूर्ण', 'अयशस्वी', 'पुनर्निर्देशने', 'विनंती सुरू करणारी स्क्रिप्ट उपलब्ध नाही',
    'तृतीय-पक्ष विनंत्या नोंदवलेल्या नाहीत', 'विनंत्यांचा डेटा उपलब्ध नाही', 'संसाधनांची यादी मर्यादित केली आहे',
    'तृतीय-पक्ष विनंत्या: $COUNT$', 'एम्बेड केलेल्या दस्तऐवजांतील API कृती',
    'डोमेन किंवा संसाधनानुसार फिल्टर करा', 'जुळणारी संसाधने नाहीत',
    'फसवणूक प्रतिबंधक प्रणाली आढळल्या नाहीत.', 'निवडलेला दस्तऐवज',
    'एम्बेड केलेल्या दस्तऐवजांतील API कृती नोंदवलेल्या नाहीत.'
  ],
  te: [
    'మూడవ పక్ష అభ్యర్థనలు', 'అభ్యర్థనలు: $COUNT$', 'డొమైన్‌లు: $COUNT$',
    'వనరు', 'డొమైన్', 'అభ్యర్థన రకం', 'పత్రం', 'అభ్యర్థన ప్రారంభించినది', 'HTTP స్థితి',
    'పూర్తయినవి', 'విఫలమైనవి', 'దారిమళ్లింపులు', 'అభ్యర్థన ప్రారంభించిన స్క్రిప్ట్ అందుబాటులో లేదు',
    'మూడవ పక్ష అభ్యర్థనలు నమోదు కాలేదు', 'అభ్యర్థనల డేటా అందుబాటులో లేదు', 'వనరుల జాబితా పరిమితం చేయబడింది',
    'మూడవ పక్ష అభ్యర్థనలు: $COUNT$', 'పొందుపరిచిన పత్రాల్లో API చర్యలు',
    'డొమైన్ లేదా వనరు ఆధారంగా ఫిల్టర్ చేయండి', 'సరిపోలే వనరులు లేవు',
    'మోస నిరోధక వ్యవస్థలు గుర్తించబడలేదు.', 'ఎంచుకున్న పత్రం',
    'పొందుపరిచిన పత్రాల్లో API చర్యలు నమోదు కాలేదు.'
  ],
  ko: [
    '제3자 요청', '요청: $COUNT$', '도메인: $COUNT$',
    '리소스', '도메인', '요청 유형', '문서', '시작자', 'HTTP 상태',
    '완료', '실패', '리디렉션', '요청을 시작한 스크립트를 확인할 수 없음',
    '기록된 제3자 요청 없음', '요청 데이터를 확인할 수 없음', '리소스 목록이 일부 생략됨',
    '제3자 요청: $COUNT$', '삽입된 문서의 API 활동',
    '도메인 또는 리소스로 필터링', '일치하는 리소스 없음',
    '식별된 사기 방지 시스템 없음.', '선택한 문서',
    '삽입된 문서에 기록된 API 활동 없음.'
  ],
  ta: [
    'மூன்றாம் தரப்பு கோரிக்கைகள்', 'கோரிக்கைகள்: $COUNT$', 'டொமைன்கள்: $COUNT$',
    'வளம்', 'டொமைன்', 'கோரிக்கை வகை', 'ஆவணம்', 'தொடங்கியவர்', 'HTTP நிலை',
    'நிறைவடைந்தவை', 'தோல்வியடைந்தவை', 'வழிமாற்றங்கள்', 'கோரிக்கையைத் தொடங்கிய ஸ்கிரிப்ட் கிடைக்கவில்லை',
    'மூன்றாம் தரப்பு கோரிக்கைகள் பதிவாகவில்லை', 'கோரிக்கைத் தரவு கிடைக்கவில்லை', 'வளங்களின் பட்டியல் சுருக்கப்பட்டது',
    'மூன்றாம் தரப்பு கோரிக்கைகள்: $COUNT$', 'உட்பொதிக்கப்பட்ட ஆவணங்களில் API செயல்பாடு',
    'டொமைன் அல்லது வளத்தின்படி வடிகட்டவும்', 'பொருந்தும் வளங்கள் இல்லை',
    'மோசடி தடுப்பு அமைப்புகள் கண்டறியப்படவில்லை.', 'தேர்ந்தெடுக்கப்பட்ட ஆவணம்',
    'உட்பொதிக்கப்பட்ட ஆவணங்களில் API செயல்பாடு பதிவாகவில்லை.'
  ],
  yue: [
    '第三方请求', '请求数：$COUNT$', '域名数：$COUNT$',
    '资源', '域名', '请求类型', '文件', '发起方', 'HTTP 状态',
    '已完成', '失败', '重新导向', '发起请求嘅脚本唔可用',
    '冇记录到第三方请求', '请求资料唔可用', '资源清单已截短',
    '第三方请求：$COUNT$', '嵌入文件入面嘅 API 活动',
    '按域名或资源筛选', '冇符合条件嘅资源',
    '冇识别到反欺诈系统。', '拣咗嘅文件',
    '冇记录到嵌入文件入面嘅 API 活动。'
  ],
  wuu: [
    '第三方请求', '请求数：$COUNT$', '域名数：$COUNT$',
    '资源', '域名', '请求类型', '文档', '发起方', 'HTTP 状态',
    '已完成', '失败', '重定向', '发起请求个脚本呒法用',
    '呒没记录到第三方请求', '请求数据呒法用', '资源清单已经截短',
    '第三方请求：$COUNT$', '嵌入文档里向个 API 活动',
    '按照域名或者资源筛选', '呒没符合条件个资源',
    '呒没识别到反欺诈系统。', '选好个文档',
    '呒没记录到嵌入文档里向个 API 活动。'
  ]
};

const COUNT_KEYS = new Set(['third_party_requests_total', 'third_party_domains_total', 'third_party_requests_badge']);

export function applyThirdPartyCopy(table, locale) {
  if (typeof locale !== 'string' || !Object.hasOwn(COPY, locale)) throw new Error('Third-party copy: unknown locale ' + String(locale));
  if (!table || typeof table !== 'object' || Array.isArray(table)) throw new TypeError('Third-party copy: expected a message table');
  const copy = COPY[locale];
  if (copy.length !== THIRD_PARTY_KEYS.length || copy.some(message => typeof message !== 'string' || !message.trim())) throw new Error('Third-party copy: incomplete translations for ' + locale);
  for (let index = 0; index < THIRD_PARTY_KEYS.length; index++) {
    const key = THIRD_PARTY_KEYS[index], message = copy[index];
    const actual = [...message.matchAll(/\$([A-Z][A-Z0-9_]*)\$/g)].map(match => match[1]);
    const expected = COUNT_KEYS.has(key) ? ['COUNT'] : [];
    if (actual.length !== expected.length || actual.some((name, i) => name !== expected[i])) throw new Error('Third-party copy: invalid placeholders for ' + locale + '/' + key);
    table[key] = { message };
    if (COUNT_KEYS.has(key)) table[key].placeholders = { count: { content: '$1' } };
  }
  return table;
}
