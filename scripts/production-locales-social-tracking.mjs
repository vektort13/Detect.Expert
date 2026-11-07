// ADR-028: functional Social UI copy. Counts retain their observation source.
export const SOCIAL_TRACKING_KEYS = Object.freeze([
  'social_kind_tracking_sdk', 'social_tracking_services',
  'social_browser_request_count', 'social_page_action_count',
  'social_pro_documents', 'social_pro_rows', 'social_document',
  'social_service_column', 'social_count_column', 'social_method',
  'social_endpoint', 'social_resource_type', 'social_method_unknown',
  'social_endpoint_service', 'social_endpoint_sdk', 'social_endpoint_pixel',
  'social_endpoint_embed', 'social_endpoint_login', 'social_endpoint_oauth',
  'social_endpoint_fedcm', 'social_endpoint_login_status',
  'social_resource_main_frame', 'social_resource_sub_frame',
  'social_resource_stylesheet', 'social_resource_script', 'social_resource_image',
  'social_resource_font', 'social_resource_object', 'social_resource_xmlhttprequest',
  'social_resource_ping', 'social_resource_csp_report', 'social_resource_media',
  'social_resource_websocket', 'social_resource_webtransport', 'social_resource_webbundle',
  'social_resource_other', 'social_script_unknown', 'social_title',
  'social_report_title', 'social_empty'
]);
const COPY = {
  en: [
    'Tracking SDK', 'Observed tracking services: $COUNT$', 'Prepared requests: $COUNT$', 'Page actions: $COUNT$',
    'Documents: $COUNT$', 'Report entries: $COUNT$', 'Document $NUMBER$', 'Service / activity', 'Count / source', 'Method', 'Endpoint', 'Resource type', 'Not reported',
    'Service', 'SDK', 'Tracking pixel', 'Embedded content', 'Login', 'OAuth', 'FedCM', 'Login status',
    'Main document', 'Child document', 'Stylesheet', 'Script', 'Image', 'Font', 'Object', 'Fetch / XHR',
    'Beacon / ping', 'CSP report', 'Media', 'WebSocket', 'WebTransport', 'Web bundle', 'Other',
    'Script not captured', 'Social services and tracking', 'Social services and tracking', 'No social service activity observed.'
  ],
  ru: [
    'SDK трекинга', 'Наблюдаемые сервисы трекинга: $COUNT$', 'Подготовленные запросы: $COUNT$', 'Действия страницы: $COUNT$',
    'Документы: $COUNT$', 'Строки отчёта: $COUNT$', 'Документ $NUMBER$', 'Сервис / действие', 'Количество / источник', 'Метод', 'Конечная точка', 'Тип ресурса', 'Не сообщён',
    'Сервис', 'SDK', 'Пиксель трекинга', 'Встроенный контент', 'Вход', 'OAuth', 'FedCM', 'Статус входа',
    'Основной документ', 'Дочерний документ', 'Таблица стилей', 'Скрипт', 'Изображение', 'Шрифт', 'Объект', 'Fetch / XHR',
    'Маячок / ping', 'Отчёт CSP', 'Медиа', 'WebSocket', 'WebTransport', 'Веб-пакет', 'Другое',
    'Скрипт не зафиксирован', 'Социальные сервисы и трекинг', 'Социальные сервисы и трекинг', 'Действий социальных сервисов не наблюдалось.'
  ],
  zh_CN: [
    '跟踪 SDK', '观察到的跟踪服务：$COUNT$', '已准备的请求：$COUNT$', '页面操作：$COUNT$',
    '文档数：$COUNT$', '报告条目：$COUNT$', '文档 $NUMBER$', '服务 / 操作', '数量 / 来源', '方法', '端点', '资源类型', '未报告',
    '服务', 'SDK', '跟踪像素', '嵌入内容', '登录', 'OAuth', 'FedCM', '登录状态',
    '主文档', '子文档', '样式表', '脚本', '图片', '字体', '对象', 'Fetch / XHR',
    '信标 / ping', 'CSP 报告', '媒体', 'WebSocket', 'WebTransport', '网页资源包', '其他',
    '未捕获脚本', '社交服务与跟踪', '社交服务与跟踪', '未观察到社交服务活动。'
  ],
  vi: [
    'SDK theo dõi', 'Dịch vụ theo dõi quan sát được: $COUNT$', 'Yêu cầu đã chuẩn bị: $COUNT$', 'Hoạt động của trang: $COUNT$',
    'Tài liệu: $COUNT$', 'Mục báo cáo: $COUNT$', 'Tài liệu $NUMBER$', 'Dịch vụ / hoạt động', 'Số lượng / nguồn', 'Phương thức', 'Điểm cuối', 'Loại tài nguyên', 'Không được báo cáo',
    'Dịch vụ', 'SDK', 'Pixel theo dõi', 'Nội dung nhúng', 'Đăng nhập', 'OAuth', 'FedCM', 'Trạng thái đăng nhập',
    'Tài liệu chính', 'Tài liệu con', 'Biểu định kiểu', 'Tập lệnh', 'Hình ảnh', 'Phông chữ', 'Đối tượng', 'Fetch / XHR',
    'Beacon / ping', 'Báo cáo CSP', 'Nội dung đa phương tiện', 'WebSocket', 'WebTransport', 'Gói web', 'Khác',
    'Không ghi nhận tập lệnh', 'Dịch vụ xã hội và theo dõi', 'Dịch vụ xã hội và theo dõi', 'Không quan sát thấy hoạt động dịch vụ xã hội.'
  ],
  es: [
    'SDK de seguimiento', 'Servicios de seguimiento observados: $COUNT$', 'Solicitudes preparadas: $COUNT$', 'Acciones de la página: $COUNT$',
    'Documentos: $COUNT$', 'Entradas del informe: $COUNT$', 'Documento $NUMBER$', 'Servicio / actividad', 'Cantidad / fuente', 'Método', 'Punto de conexión', 'Tipo de recurso', 'No comunicado',
    'Servicio', 'SDK', 'Píxel de seguimiento', 'Contenido integrado', 'Inicio de sesión', 'OAuth', 'FedCM', 'Estado de inicio de sesión',
    'Documento principal', 'Documento secundario', 'Hoja de estilos', 'Script', 'Imagen', 'Fuente', 'Objeto', 'Fetch / XHR',
    'Baliza / ping', 'Informe CSP', 'Contenido multimedia', 'WebSocket', 'WebTransport', 'Paquete web', 'Otro',
    'Script no capturado', 'Servicios sociales y seguimiento', 'Servicios sociales y seguimiento', 'No se observó actividad de servicios sociales.'
  ],
  ar: [
    'حزمة SDK للتتبع', 'خدمات التتبع المرصودة: $COUNT$', 'الطلبات المُعَدّة: $COUNT$', 'إجراءات الصفحة: $COUNT$',
    'المستندات: $COUNT$', 'إدخالات التقرير: $COUNT$', 'المستند $NUMBER$', 'الخدمة / النشاط', 'العدد / المصدر', 'الطريقة', 'نقطة النهاية', 'نوع المورد', 'لم يُبلّغ عنه',
    'خدمة', 'SDK', 'بكسل تتبع', 'محتوى مضمّن', 'تسجيل الدخول', 'OAuth', 'FedCM', 'حالة تسجيل الدخول',
    'المستند الرئيسي', 'المستند الفرعي', 'ورقة أنماط', 'نص برمجي', 'صورة', 'خط', 'كائن', 'Fetch / XHR',
    'إشارة / ping', 'تقرير CSP', 'وسائط', 'WebSocket', 'WebTransport', 'حزمة ويب', 'أخرى',
    'لم يُلتقط النص البرمجي', 'الخدمات الاجتماعية والتتبع', 'الخدمات الاجتماعية والتتبع', 'لم يُرصد نشاط للخدمات الاجتماعية.'
  ],
  uk: [
    'SDK відстеження', 'Спостережені сервіси відстеження: $COUNT$', 'Підготовлені запити: $COUNT$', 'Дії сторінки: $COUNT$',
    'Документи: $COUNT$', 'Рядки звіту: $COUNT$', 'Документ $NUMBER$', 'Сервіс / дія', 'Кількість / джерело', 'Метод', 'Кінцева точка', 'Тип ресурсу', 'Не повідомлено',
    'Сервіс', 'SDK', 'Піксель відстеження', 'Вбудований вміст', 'Вхід', 'OAuth', 'FedCM', 'Стан входу',
    'Основний документ', 'Дочірній документ', 'Таблиця стилів', 'Скрипт', 'Зображення', 'Шрифт', "Об’єкт", 'Fetch / XHR',
    'Маячок / ping', 'Звіт CSP', 'Медіа', 'WebSocket', 'WebTransport', 'Вебпакет', 'Інше',
    'Скрипт не зафіксовано', 'Соціальні сервіси та відстеження', 'Соціальні сервіси та відстеження', 'Дій соціальних сервісів не спостерігалося.'
  ],
  fr: [
    'SDK de suivi', 'Services de suivi observés : $COUNT$', 'Requêtes préparées : $COUNT$', 'Actions de la page : $COUNT$',
    'Documents : $COUNT$', 'Entrées du rapport : $COUNT$', 'Document $NUMBER$', 'Service / activité', 'Nombre / source', 'Méthode', 'Point de terminaison', 'Type de ressource', 'Non indiqué',
    'Service', 'SDK', 'Pixel de suivi', 'Contenu intégré', 'Connexion', 'OAuth', 'FedCM', 'État de connexion',
    'Document principal', 'Document enfant', 'Feuille de style', 'Script', 'Image', 'Police', 'Objet', 'Fetch / XHR',
    'Balise / ping', 'Rapport CSP', 'Média', 'WebSocket', 'WebTransport', 'Paquet web', 'Autre',
    'Script non capturé', 'Services sociaux et suivi', 'Services sociaux et suivi', 'Aucune activité de service social observée.'
  ],
  pt_BR: [
    'SDK de rastreamento', 'Serviços de rastreamento observados: $COUNT$', 'Solicitações preparadas: $COUNT$', 'Ações da página: $COUNT$',
    'Documentos: $COUNT$', 'Entradas do relatório: $COUNT$', 'Documento $NUMBER$', 'Serviço / atividade', 'Quantidade / origem', 'Método', 'Endpoint', 'Tipo de recurso', 'Não informado',
    'Serviço', 'SDK', 'Pixel de rastreamento', 'Conteúdo incorporado', 'Login', 'OAuth', 'FedCM', 'Estado do login',
    'Documento principal', 'Documento filho', 'Folha de estilo', 'Script', 'Imagem', 'Fonte', 'Objeto', 'Fetch / XHR',
    'Sinalizador / ping', 'Relatório CSP', 'Mídia', 'WebSocket', 'WebTransport', 'Pacote web', 'Outro',
    'Script não capturado', 'Serviços sociais e rastreamento', 'Serviços sociais e rastreamento', 'Nenhuma atividade de serviços sociais foi observada.'
  ],
  hi: [
    'ट्रैकिंग SDK', 'देखी गई ट्रैकिंग सेवाएँ: $COUNT$', 'तैयार अनुरोध: $COUNT$', 'पेज की कार्रवाइयाँ: $COUNT$',
    'दस्तावेज़: $COUNT$', 'रिपोर्ट प्रविष्टियाँ: $COUNT$', 'दस्तावेज़ $NUMBER$', 'सेवा / गतिविधि', 'संख्या / स्रोत', 'विधि', 'एंडपॉइंट', 'संसाधन प्रकार', 'सूचना नहीं दी गई',
    'सेवा', 'SDK', 'ट्रैकिंग पिक्सेल', 'एम्बेड की गई सामग्री', 'लॉगिन', 'OAuth', 'FedCM', 'लॉगिन स्थिति',
    'मुख्य दस्तावेज़', 'चाइल्ड दस्तावेज़', 'स्टाइलशीट', 'स्क्रिप्ट', 'छवि', 'फ़ॉन्ट', 'ऑब्जेक्ट', 'Fetch / XHR',
    'बीकन / ping', 'CSP रिपोर्ट', 'मीडिया', 'WebSocket', 'WebTransport', 'वेब बंडल', 'अन्य',
    'स्क्रिप्ट दर्ज नहीं हुई', 'सोशल सेवाएँ और ट्रैकिंग', 'सोशल सेवाएँ और ट्रैकिंग', 'सोशल सेवाओं की कोई गतिविधि नहीं देखी गई।'
  ],
  ur: [
    'ٹریکنگ SDK', 'مشاہدہ شدہ ٹریکنگ خدمات: $COUNT$', 'تیار کردہ درخواستیں: $COUNT$', 'صفحے کی کارروائیاں: $COUNT$',
    'دستاویزات: $COUNT$', 'رپورٹ کے اندراجات: $COUNT$', 'دستاویز $NUMBER$', 'خدمت / سرگرمی', 'تعداد / ماخذ', 'طریقہ', 'اینڈ پوائنٹ', 'وسیلے کی قسم', 'اطلاع نہیں دی گئی',
    'خدمت', 'SDK', 'ٹریکنگ پکسل', 'شامل کردہ مواد', 'لاگ اِن', 'OAuth', 'FedCM', 'لاگ اِن کی حالت',
    'مرکزی دستاویز', 'ذیلی دستاویز', 'اسٹائل شیٹ', 'اسکرپٹ', 'تصویر', 'فونٹ', 'آبجیکٹ', 'Fetch / XHR',
    'بیکن / ping', 'CSP رپورٹ', 'میڈیا', 'WebSocket', 'WebTransport', 'ویب بنڈل', 'دیگر',
    'اسکرپٹ ریکارڈ نہیں ہوا', 'سوشل خدمات اور ٹریکنگ', 'سوشل خدمات اور ٹریکنگ', 'سوشل خدمات کی کوئی سرگرمی مشاہدے میں نہیں آئی۔'
  ],
  ja: [
    '追跡 SDK', '観測された追跡サービス：$COUNT$', '準備されたリクエスト：$COUNT$', 'ページの操作：$COUNT$',
    'ドキュメント数：$COUNT$', 'レポート項目数：$COUNT$', 'ドキュメント $NUMBER$', 'サービス / 操作', '件数 / 情報源', 'メソッド', 'エンドポイント', 'リソース種別', '報告なし',
    'サービス', 'SDK', '追跡ピクセル', '埋め込みコンテンツ', 'ログイン', 'OAuth', 'FedCM', 'ログイン状態',
    'メインドキュメント', '子ドキュメント', 'スタイルシート', 'スクリプト', '画像', 'フォント', 'オブジェクト', 'Fetch / XHR',
    'ビーコン / ping', 'CSP レポート', 'メディア', 'WebSocket', 'WebTransport', 'ウェブバンドル', 'その他',
    'スクリプト未取得', 'ソーシャルサービスと追跡', 'ソーシャルサービスと追跡', 'ソーシャルサービスの動作は観測されていません。'
  ],
  de: [
    'Tracking-SDK', 'Beobachtete Trackingdienste: $COUNT$', 'Vorbereitete Anfragen: $COUNT$', 'Seitenaktionen: $COUNT$',
    'Dokumente: $COUNT$', 'Berichtseinträge: $COUNT$', 'Dokument $NUMBER$', 'Dienst / Aktivität', 'Anzahl / Quelle', 'Methode', 'Endpunkt', 'Ressourcentyp', 'Nicht gemeldet',
    'Dienst', 'SDK', 'Trackingpixel', 'Eingebetteter Inhalt', 'Anmeldung', 'OAuth', 'FedCM', 'Anmeldestatus',
    'Hauptdokument', 'Untergeordnetes Dokument', 'Stylesheet', 'Skript', 'Bild', 'Schrift', 'Objekt', 'Fetch / XHR',
    'Beacon / Ping', 'CSP-Bericht', 'Medien', 'WebSocket', 'WebTransport', 'Webpaket', 'Sonstiges',
    'Skript nicht erfasst', 'Soziale Dienste und Tracking', 'Soziale Dienste und Tracking', 'Keine Aktivität sozialer Dienste beobachtet.'
  ],
  pl: [
    'SDK śledzący', 'Zaobserwowane usługi śledzące: $COUNT$', 'Przygotowane żądania: $COUNT$', 'Działania strony: $COUNT$',
    'Dokumenty: $COUNT$', 'Wpisy raportu: $COUNT$', 'Dokument $NUMBER$', 'Usługa / działanie', 'Liczba / źródło', 'Metoda', 'Punkt końcowy', 'Typ zasobu', 'Nie zgłoszono',
    'Usługa', 'SDK', 'Piksel śledzący', 'Treść osadzona', 'Logowanie', 'OAuth', 'FedCM', 'Stan logowania',
    'Dokument główny', 'Dokument podrzędny', 'Arkusz stylów', 'Skrypt', 'Obraz', 'Czcionka', 'Obiekt', 'Fetch / XHR',
    'Sygnał beacon / ping', 'Raport CSP', 'Multimedia', 'WebSocket', 'WebTransport', 'Pakiet internetowy', 'Inny',
    'Skrypt nie został zarejestrowany', 'Usługi społecznościowe i śledzenie', 'Usługi społecznościowe i śledzenie', 'Nie zaobserwowano aktywności usług społecznościowych.'
  ],
  id: [
    'SDK pelacakan', 'Layanan pelacakan yang diamati: $COUNT$', 'Permintaan yang disiapkan: $COUNT$', 'Tindakan halaman: $COUNT$',
    'Dokumen: $COUNT$', 'Entri laporan: $COUNT$', 'Dokumen $NUMBER$', 'Layanan / aktivitas', 'Jumlah / sumber', 'Metode', 'Titik akhir', 'Jenis sumber daya', 'Tidak dilaporkan',
    'Layanan', 'SDK', 'Piksel pelacakan', 'Konten tersemat', 'Masuk', 'OAuth', 'FedCM', 'Status masuk',
    'Dokumen utama', 'Dokumen anak', 'Lembar gaya', 'Skrip', 'Gambar', 'Font', 'Objek', 'Fetch / XHR',
    'Beacon / ping', 'Laporan CSP', 'Media', 'WebSocket', 'WebTransport', 'Bundel web', 'Lainnya',
    'Skrip tidak terekam', 'Layanan sosial dan pelacakan', 'Layanan sosial dan pelacakan', 'Tidak ada aktivitas layanan sosial yang diamati.'
  ],
  mr: [
    'ट्रॅकिंग SDK', 'निरीक्षणात दिसलेल्या ट्रॅकिंग सेवा: $COUNT$', 'तयार केलेल्या विनंत्या: $COUNT$', 'पृष्ठावरील कृती: $COUNT$',
    'दस्तऐवज: $COUNT$', 'अहवालातील नोंदी: $COUNT$', 'दस्तऐवज $NUMBER$', 'सेवा / कृती', 'संख्या / स्रोत', 'पद्धत', 'अंतिम बिंदू', 'संसाधन प्रकार', 'माहिती दिलेली नाही',
    'सेवा', 'SDK', 'ट्रॅकिंग पिक्सेल', 'एम्बेड केलेला मजकूर', 'लॉगिन', 'OAuth', 'FedCM', 'लॉगिन स्थिती',
    'मुख्य दस्तऐवज', 'उपदस्तऐवज', 'शैलीपत्रक', 'स्क्रिप्ट', 'प्रतिमा', 'फॉन्ट', 'ऑब्जेक्ट', 'Fetch / XHR',
    'बीकन / ping', 'CSP अहवाल', 'मीडिया', 'WebSocket', 'WebTransport', 'वेब बंडल', 'इतर',
    'स्क्रिप्ट नोंदवली नाही', 'सोशल सेवा आणि ट्रॅकिंग', 'सोशल सेवा आणि ट्रॅकिंग', 'सोशल सेवांची कोणतीही कृती दिसली नाही.'
  ],
  te: [
    'ట్రాకింగ్ SDK', 'గమనించిన ట్రాకింగ్ సేవలు: $COUNT$', 'సిద్ధం చేసిన అభ్యర్థనలు: $COUNT$', 'పేజీ చర్యలు: $COUNT$',
    'పత్రాలు: $COUNT$', 'నివేదిక నమోదులు: $COUNT$', 'పత్రం $NUMBER$', 'సేవ / చర్య', 'సంఖ్య / మూలం', 'పద్ధతి', 'ఎండ్‌పాయింట్', 'వనరు రకం', 'నివేదించలేదు',
    'సేవ', 'SDK', 'ట్రాకింగ్ పిక్సెల్', 'పొందుపరిచిన కంటెంట్', 'లాగిన్', 'OAuth', 'FedCM', 'లాగిన్ స్థితి',
    'ప్రధాన పత్రం', 'ఉపపత్రం', 'స్టైల్‌షీట్', 'స్క్రిప్ట్', 'చిత్రం', 'ఫాంట్', 'ఆబ్జెక్ట్', 'Fetch / XHR',
    'బీకన్ / ping', 'CSP నివేదిక', 'మీడియా', 'WebSocket', 'WebTransport', 'వెబ్ బండిల్', 'ఇతర',
    'స్క్రిప్ట్ నమోదు కాలేదు', 'సామాజిక సేవలు మరియు ట్రాకింగ్', 'సామాజిక సేవలు మరియు ట్రాకింగ్', 'సామాజిక సేవల చర్యలు గమనించబడలేదు.'
  ],
  ko: [
    '추적 SDK', '관측된 추적 서비스: $COUNT$', '준비된 요청: $COUNT$', '페이지 작업: $COUNT$',
    '문서: $COUNT$', '보고서 항목: $COUNT$', '문서 $NUMBER$', '서비스 / 작업', '횟수 / 출처', '메서드', '엔드포인트', '리소스 유형', '보고되지 않음',
    '서비스', 'SDK', '추적 픽셀', '삽입된 콘텐츠', '로그인', 'OAuth', 'FedCM', '로그인 상태',
    '기본 문서', '하위 문서', '스타일시트', '스크립트', '이미지', '글꼴', '객체', 'Fetch / XHR',
    '비콘 / ping', 'CSP 보고서', '미디어', 'WebSocket', 'WebTransport', '웹 번들', '기타',
    '스크립트가 기록되지 않음', '소셜 서비스와 추적', '소셜 서비스와 추적', '소셜 서비스 활동이 관측되지 않았습니다.'
  ],
  ta: [
    'கண்காணிப்பு SDK', 'கவனிக்கப்பட்ட கண்காணிப்பு சேவைகள்: $COUNT$', 'தயாரிக்கப்பட்ட கோரிக்கைகள்: $COUNT$', 'பக்கச் செயல்கள்: $COUNT$',
    'ஆவணங்கள்: $COUNT$', 'அறிக்கைப் பதிவுகள்: $COUNT$', 'ஆவணம் $NUMBER$', 'சேவை / செயல்', 'எண்ணிக்கை / மூலம்', 'முறை', 'இறுதிப்புள்ளி', 'வள வகை', 'தெரிவிக்கப்படவில்லை',
    'சேவை', 'SDK', 'கண்காணிப்பு பிக்சல்', 'உட்பொதிக்கப்பட்ட உள்ளடக்கம்', 'உள்நுழைவு', 'OAuth', 'FedCM', 'உள்நுழைவு நிலை',
    'முதன்மை ஆவணம்', 'துணை ஆவணம்', 'நடைத் தாள்', 'ஸ்கிரிப்ட்', 'படம்', 'எழுத்துரு', 'பொருள்', 'Fetch / XHR',
    'பீக்கன் / ping', 'CSP அறிக்கை', 'ஊடகம்', 'WebSocket', 'WebTransport', 'வலைத் தொகுப்பு', 'மற்றவை',
    'ஸ்கிரிப்ட் பதிவாகவில்லை', 'சமூக சேவைகளும் கண்காணிப்பும்', 'சமூக சேவைகளும் கண்காணிப்பும்', 'சமூக சேவைச் செயல்பாடு எதுவும் கவனிக்கப்படவில்லை.'
  ],
  yue: [
    '追踪 SDK', '观察到嘅追踪服务：$COUNT$', '准备好嘅请求：$COUNT$', '网页动作：$COUNT$',
    '文件数：$COUNT$', '报告记录：$COUNT$', '文件 $NUMBER$', '服务 / 动作', '数量 / 来源', '方法', '端点', '资源类型', '冇提供',
    '服务', 'SDK', '追踪像素', '嵌入内容', '登入', 'OAuth', 'FedCM', '登入状态',
    '主文件', '子文件', '样式表', '脚本', '图片', '字型', '对象', 'Fetch / XHR',
    '信标 / ping', 'CSP 报告', '媒体', 'WebSocket', 'WebTransport', '网页资源包', '其他',
    '冇记录到脚本', '社交服务同追踪', '社交服务同追踪', '冇观察到社交服务嘅活动。'
  ],
  wuu: [
    '跟踪 SDK', '观察到个跟踪服务：$COUNT$', '准备好个请求：$COUNT$', '网页动作：$COUNT$',
    '文档数：$COUNT$', '报告记录：$COUNT$', '文档 $NUMBER$', '服务 / 动作', '数量 / 来源', '方法', '端点', '资源类型', '呒没提供',
    '服务', 'SDK', '跟踪像素', '嵌入内容', '登录', 'OAuth', 'FedCM', '登录状态',
    '主文档', '子文档', '样式表', '脚本', '图片', '字体', '对象', 'Fetch / XHR',
    '信标 / ping', 'CSP 报告', '媒体', 'WebSocket', 'WebTransport', '网页资源包', '其他',
    '呒没记录到脚本', '社交服务搭跟踪', '社交服务搭跟踪', '呒没观察到社交服务个活动。'
  ]
};
const COUNT_KEYS = new Set(['social_tracking_services', 'social_browser_request_count', 'social_page_action_count', 'social_pro_documents', 'social_pro_rows']);
export function applySocialTrackingCopy(table, locale) {
  if (typeof locale !== 'string' || !Object.hasOwn(COPY, locale)) throw new Error('Social tracking copy: unknown locale ' + String(locale));
  if (!table || typeof table !== 'object' || Array.isArray(table)) throw new TypeError('Social tracking copy: expected a message table');
  const copy = COPY[locale];
  if (copy.length !== SOCIAL_TRACKING_KEYS.length || copy.some(message => typeof message !== 'string' || !message.trim())) throw new Error('Social tracking copy: incomplete translations for ' + locale);
  for (let index = 0; index < SOCIAL_TRACKING_KEYS.length; index++) {
    const key = SOCIAL_TRACKING_KEYS[index], message = copy[index];
    const actual = [...message.matchAll(/\$([A-Z][A-Z0-9_]*)\$/g)].map(match => match[1]);
    const expected = COUNT_KEYS.has(key) ? ['COUNT'] : key === 'social_document' ? ['NUMBER'] : [];
    if (actual.length !== expected.length || actual.some((name, i) => name !== expected[i])) throw new Error('Social tracking copy: invalid placeholders for ' + locale + '/' + key);
    table[key] = { message };
    if (COUNT_KEYS.has(key)) table[key].placeholders = { count: { content: '$1' } };
    if (key === 'social_document') table[key].placeholders = { number: { content: '$1' } };
  }
  return table;
}
