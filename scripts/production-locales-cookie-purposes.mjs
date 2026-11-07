// Translations of the fixed TCF vocabulary and three exact primary-source purpose descriptions.
import { COOKIE_PURPOSE_TRANSLATION_KEYS } from '../apps/production-extension/cookie-purpose-localization.js';

const COPY = {
  en: [
    'Vendor-declared purposes: $PURPOSES$.',
    'device storage and access', 'basic advertising', 'advertising profile creation', 'personalised advertising',
    'content profile creation', 'personalised content', 'advertising measurement', 'content measurement',
    'audience research', 'service development', 'basic content selection', 'security and fraud prevention',
    'ad/content delivery', 'privacy choices',
    'Vendor-declared cookie storing a choice to opt out of tracking.',
    'The vendor declares this cookie and domain without TCF purpose IDs.',
    'CookieBlock lists this name as an exception to automated blocking; the exception does not establish its purpose or producer.'
  ],
  ru: [
    'Заявленные поставщиком назначения: $PURPOSES$.',
    'хранение данных на устройстве и доступ к ним', 'базовая реклама', 'создание рекламного профиля', 'персонализированная реклама',
    'создание профиля интересов к контенту', 'персонализированный контент', 'измерение эффективности рекламы', 'измерение эффективности контента',
    'исследование аудитории', 'развитие сервисов', 'базовый выбор контента', 'безопасность и предотвращение мошенничества',
    'доставка рекламы и контента', 'настройки конфиденциальности',
    'Поставщик заявляет, что cookie сохраняет выбор отказа от отслеживания.',
    'Поставщик указал эту cookie и её домен без идентификаторов назначения TCF.',
    'CookieBlock включает это имя в исключения из автоматической блокировки; исключение не определяет назначение или производителя cookie.'
  ],
  zh_CN: [
    '供应商声明的用途：$PURPOSES$。',
    '在设备上存储和访问数据', '基础广告', '创建广告画像', '个性化广告',
    '创建内容偏好画像', '个性化内容', '广告效果衡量', '内容效果衡量',
    '受众研究', '服务开发', '基础内容选择', '安全与欺诈防范',
    '广告和内容投放', '隐私选项',
    '供应商声明此 Cookie 用于保存拒绝跟踪的选择。',
    '供应商声明了此 Cookie 及其域名，但未提供 TCF 用途标识符。',
    'CookieBlock 将此名称列为自动拦截的例外；这并不能确定其用途或提供商。'
  ],
  yue: [
    '供应商声明嘅用途：$PURPOSES$。',
    '喺设备储存同存取数据', '基本广告', '建立广告档案', '个人化广告',
    '建立内容兴趣档案', '个人化内容', '量度广告成效', '量度内容成效',
    '受众研究', '开发服务', '基本内容选择', '保安同防止欺诈',
    '派发广告同内容', '私隐选择',
    '供应商声明呢个 Cookie 用嚟储存拒绝追踪嘅选择。',
    '供应商声明咗呢个 Cookie 同佢嘅网域，但冇提供 TCF 用途编号。',
    'CookieBlock 将呢个名称列为自动封锁嘅例外；呢点唔能确定佢嘅用途或者提供者。'
  ],
  wuu: [
    '供应商声明个用途：$PURPOSES$。',
    '勒设备浪储存搭访问数据', '基本广告', '建立广告档案', '个人化广告',
    '建立内容兴趣档案', '个人化内容', '量度广告效果', '量度内容效果',
    '受众研究', '开发服务', '基本内容选择', '安全搭防范欺诈',
    '送达广告搭内容', '隐私选择',
    '供应商声明搿个 Cookie 用来保存拒绝跟踪个选择。',
    '供应商声明了搿个 Cookie 搭伊个域名，但是呒没提供 TCF 用途编号。',
    'CookieBlock 把搿个名称列为自动拦截个例外；搿点勿能确定伊个用途搭提供商。'
  ],
  vi: [
    'Mục đích do nhà cung cấp khai báo: $PURPOSES$.',
    'lưu trữ và truy cập dữ liệu trên thiết bị', 'quảng cáo cơ bản', 'tạo hồ sơ quảng cáo', 'quảng cáo cá nhân hóa',
    'tạo hồ sơ sở thích nội dung', 'nội dung cá nhân hóa', 'đo lường quảng cáo', 'đo lường nội dung',
    'nghiên cứu đối tượng', 'phát triển dịch vụ', 'lựa chọn nội dung cơ bản', 'bảo mật và phòng chống gian lận',
    'phân phối quảng cáo và nội dung', 'lựa chọn quyền riêng tư',
    'Nhà cung cấp khai báo cookie này lưu lựa chọn từ chối theo dõi.',
    'Nhà cung cấp khai báo cookie và tên miền này nhưng không cung cấp mã mục đích TCF.',
    'CookieBlock liệt kê tên này là ngoại lệ của tính năng chặn tự động; ngoại lệ không xác định mục đích hay nhà sản xuất cookie.'
  ],
  es: [
    'Finalidades declaradas por el proveedor: $PURPOSES$.',
    'almacenamiento y acceso a datos en el dispositivo', 'publicidad básica', 'creación de perfiles publicitarios', 'publicidad personalizada',
    'creación de perfiles de contenido', 'contenido personalizado', 'medición publicitaria', 'medición de contenido',
    'investigación de audiencias', 'desarrollo de servicios', 'selección básica de contenido', 'seguridad y prevención del fraude',
    'distribución de anuncios y contenido', 'opciones de privacidad',
    'El proveedor declara que esta cookie guarda la elección de rechazar el seguimiento.',
    'El proveedor declara esta cookie y su dominio sin identificadores de finalidad TCF.',
    'CookieBlock incluye este nombre como excepción al bloqueo automático; la excepción no determina su finalidad ni su proveedor.'
  ],
  ar: [
    'الأغراض التي أعلنها المورّد: $PURPOSES$.',
    'تخزين البيانات على الجهاز والوصول إليها', 'الإعلانات الأساسية', 'إنشاء ملف إعلاني', 'الإعلانات المخصصة',
    'إنشاء ملف تفضيلات المحتوى', 'المحتوى المخصص', 'قياس أداء الإعلانات', 'قياس أداء المحتوى',
    'دراسة الجمهور', 'تطوير الخدمات', 'الاختيار الأساسي للمحتوى', 'الأمان ومنع الاحتيال',
    'تقديم الإعلانات والمحتوى', 'خيارات الخصوصية',
    'يعلن المورّد أن ملف تعريف الارتباط هذا يحفظ خيار رفض التتبع.',
    'أعلن المورّد ملف تعريف الارتباط هذا ونطاقه دون معرّفات أغراض TCF.',
    'يدرج CookieBlock هذا الاسم ضمن استثناءات الحظر الآلي؛ ولا يحدد الاستثناء غرض الملف أو الجهة المنتجة له.'
  ],
  uk: [
    'Призначення, заявлені постачальником: $PURPOSES$.',
    'зберігання даних на пристрої та доступ до них', 'базова реклама', 'створення рекламного профілю', 'персоналізована реклама',
    'створення профілю інтересів до вмісту', 'персоналізований вміст', 'вимірювання ефективності реклами', 'вимірювання ефективності вмісту',
    'дослідження аудиторії', 'розвиток сервісів', 'базовий вибір вмісту', 'безпека та запобігання шахрайству',
    'доставка реклами й вмісту', 'налаштування конфіденційності',
    'Постачальник заявляє, що cookie зберігає вибір відмови від відстеження.',
    'Постачальник указав цю cookie та її домен без ідентифікаторів призначення TCF.',
    'CookieBlock включає це ім’я до винятків автоматичного блокування; виняток не визначає призначення або виробника cookie.'
  ],
  fr: [
    'Finalités déclarées par le fournisseur : $PURPOSES$.',
    'stockage de données sur l’appareil et accès à celles-ci', 'publicité de base', 'création de profils publicitaires', 'publicité personnalisée',
    'création de profils de contenu', 'contenu personnalisé', 'mesure publicitaire', 'mesure de contenu',
    'étude des audiences', 'développement des services', 'sélection de contenu de base', 'sécurité et prévention de la fraude',
    'diffusion de publicités et de contenu', 'choix de confidentialité',
    'Le fournisseur déclare que ce cookie conserve le choix de refuser le suivi.',
    'Le fournisseur déclare ce cookie et son domaine sans identifiants de finalité TCF.',
    'CookieBlock répertorie ce nom comme exception au blocage automatique ; cette exception ne détermine ni sa finalité ni son fournisseur.'
  ],
  pt_BR: [
    'Finalidades declaradas pelo fornecedor: $PURPOSES$.',
    'armazenamento e acesso a dados no dispositivo', 'publicidade básica', 'criação de perfis publicitários', 'publicidade personalizada',
    'criação de perfis de conteúdo', 'conteúdo personalizado', 'medição de publicidade', 'medição de conteúdo',
    'pesquisa de público', 'desenvolvimento de serviços', 'seleção básica de conteúdo', 'segurança e prevenção de fraudes',
    'entrega de publicidade e conteúdo', 'opções de privacidade',
    'O fornecedor declara que este cookie armazena a escolha de recusar o rastreamento.',
    'O fornecedor declara este cookie e seu domínio sem identificadores de finalidade TCF.',
    'O CookieBlock lista este nome como exceção ao bloqueio automático; a exceção não determina sua finalidade nem seu fornecedor.'
  ],
  hi: [
    'प्रदाता द्वारा बताए गए उद्देश्य: $PURPOSES$।',
    'डिवाइस पर डेटा संग्रह और उस तक पहुँच', 'सामान्य विज्ञापन', 'विज्ञापन प्रोफ़ाइल बनाना', 'व्यक्तिगत विज्ञापन',
    'सामग्री पसंद की प्रोफ़ाइल बनाना', 'व्यक्तिगत सामग्री', 'विज्ञापन प्रदर्शन का मापन', 'सामग्री प्रदर्शन का मापन',
    'दर्शकों का अध्ययन', 'सेवाओं का विकास', 'सामान्य सामग्री का चयन', 'सुरक्षा और धोखाधड़ी की रोकथाम',
    'विज्ञापन और सामग्री का वितरण', 'गोपनीयता विकल्प',
    'प्रदाता के अनुसार यह कुकी ट्रैकिंग से इनकार करने का विकल्प सहेजती है।',
    'प्रदाता ने यह कुकी और इसका डोमेन बताया है, लेकिन TCF उद्देश्य पहचानकर्ता नहीं दिए हैं।',
    'CookieBlock इस नाम को स्वचालित ब्लॉकिंग का अपवाद बताता है; यह अपवाद कुकी का उद्देश्य या निर्माता तय नहीं करता।'
  ],
  ur: [
    'فراہم کنندہ کے بیان کردہ مقاصد: $PURPOSES$۔',
    'ڈیوائس پر ڈیٹا ذخیرہ کرنا اور اس تک رسائی', 'بنیادی اشتہارات', 'اشتہاری پروفائل بنانا', 'ذاتی نوعیت کے اشتہارات',
    'مواد کی ترجیحات کا پروفائل بنانا', 'ذاتی نوعیت کا مواد', 'اشتہارات کی کارکردگی کی پیمائش', 'مواد کی کارکردگی کی پیمائش',
    'سامعین کی تحقیق', 'خدمات کی ترقی', 'مواد کا بنیادی انتخاب', 'سلامتی اور دھوکا دہی کی روک تھام',
    'اشتہارات اور مواد کی ترسیل', 'رازداری کے انتخاب',
    'فراہم کنندہ کے مطابق یہ کوکی ٹریکنگ سے انکار کا انتخاب محفوظ کرتی ہے۔',
    'فراہم کنندہ نے یہ کوکی اور اس کا ڈومین بتایا ہے، مگر TCF مقصد کے شناختی کوڈ نہیں دیے۔',
    'CookieBlock اس نام کو خودکار بلاکنگ کے استثنا میں شامل کرتا ہے؛ یہ استثنا کوکی کا مقصد یا بنانے والا طے نہیں کرتا۔'
  ],
  ja: [
    '提供者が申告した用途：$PURPOSES$。',
    '端末上のデータの保存とアクセス', '基本的な広告', '広告プロファイルの作成', 'パーソナライズ広告',
    'コンテンツの好みのプロファイル作成', 'パーソナライズされたコンテンツ', '広告効果の測定', 'コンテンツ効果の測定',
    'オーディエンス調査', 'サービス開発', '基本的なコンテンツ選択', 'セキュリティと不正防止',
    '広告とコンテンツの配信', 'プライバシー設定',
    '提供者は、この Cookie が追跡を拒否する選択を保存すると申告しています。',
    '提供者は、この Cookie とドメインを申告していますが、TCF の用途 ID は示していません。',
    'CookieBlock はこの名前を自動ブロックの例外として登録しています。例外であることから用途や提供者は特定できません。'
  ],
  de: [
    'Vom Anbieter angegebene Zwecke: $PURPOSES$.',
    'Datenspeicherung auf dem Gerät und Zugriff darauf', 'grundlegende Werbung', 'Erstellung von Werbeprofilen', 'personalisierte Werbung',
    'Erstellung von Inhaltsprofilen', 'personalisierte Inhalte', 'Messung der Werbeleistung', 'Messung der Inhaltsleistung',
    'Zielgruppenforschung', 'Entwicklung von Diensten', 'grundlegende Inhaltsauswahl', 'Sicherheit und Betrugsprävention',
    'Bereitstellung von Werbung und Inhalten', 'Datenschutzeinstellungen',
    'Der Anbieter gibt an, dass dieses Cookie die Entscheidung gegen Tracking speichert.',
    'Der Anbieter nennt dieses Cookie und seine Domain ohne TCF-Zweckkennungen.',
    'CookieBlock führt diesen Namen als Ausnahme von der automatischen Blockierung auf; daraus ergeben sich weder Zweck noch Anbieter des Cookies.'
  ],
  pl: [
    'Cele deklarowane przez dostawcę: $PURPOSES$.',
    'przechowywanie danych na urządzeniu i dostęp do nich', 'reklama podstawowa', 'tworzenie profili reklamowych', 'reklama spersonalizowana',
    'tworzenie profili zainteresowań treścią', 'treści spersonalizowane', 'pomiar skuteczności reklam', 'pomiar skuteczności treści',
    'badanie odbiorców', 'rozwój usług', 'podstawowy dobór treści', 'bezpieczeństwo i zapobieganie oszustwom',
    'dostarczanie reklam i treści', 'ustawienia prywatności',
    'Dostawca deklaruje, że ten plik cookie zapisuje wybór rezygnacji ze śledzenia.',
    'Dostawca wskazuje ten plik cookie i jego domenę bez identyfikatorów celów TCF.',
    'CookieBlock wymienia tę nazwę jako wyjątek od automatycznego blokowania; wyjątek nie określa celu ani dostawcy pliku cookie.'
  ],
  id: [
    'Tujuan yang dinyatakan penyedia: $PURPOSES$.',
    'penyimpanan dan akses data pada perangkat', 'iklan dasar', 'pembuatan profil iklan', 'iklan yang dipersonalisasi',
    'pembuatan profil minat konten', 'konten yang dipersonalisasi', 'pengukuran iklan', 'pengukuran konten',
    'riset audiens', 'pengembangan layanan', 'pemilihan konten dasar', 'keamanan dan pencegahan penipuan',
    'penayangan iklan dan konten', 'pilihan privasi',
    'Penyedia menyatakan bahwa cookie ini menyimpan pilihan untuk menolak pelacakan.',
    'Penyedia menyatakan cookie dan domain ini tanpa ID tujuan TCF.',
    'CookieBlock mencantumkan nama ini sebagai pengecualian pemblokiran otomatis; pengecualian tersebut tidak menentukan tujuan atau pembuat cookie.'
  ],
  mr: [
    'पुरवठादाराने जाहीर केलेले उद्देश: $PURPOSES$.',
    'उपकरणावर डेटा साठवणे आणि त्यात प्रवेश', 'मूलभूत जाहिराती', 'जाहिरात प्रोफाइल तयार करणे', 'वैयक्तिकृत जाहिराती',
    'सामग्रीच्या आवडीचे प्रोफाइल तयार करणे', 'वैयक्तिकृत सामग्री', 'जाहिरातींचे परिणाम मोजणे', 'सामग्रीचे परिणाम मोजणे',
    'प्रेक्षकांचा अभ्यास', 'सेवांचा विकास', 'मूलभूत सामग्रीची निवड', 'सुरक्षा आणि फसवणूक प्रतिबंध',
    'जाहिराती आणि सामग्री पोहोचवणे', 'गोपनीयता पर्याय',
    'पुरवठादारानुसार ही कुकी ट्रॅकिंग नाकारण्याची निवड साठवते.',
    'पुरवठादाराने ही कुकी आणि तिचे डोमेन जाहीर केले आहे, पण TCF उद्देश ओळख क्रमांक दिलेले नाहीत.',
    'CookieBlock हे नाव स्वयंचलित अवरोधाचे अपवाद म्हणून नोंदवते; या अपवादामुळे कुकीचा उद्देश किंवा निर्माता ठरत नाही.'
  ],
  te: [
    'ప్రదాత ప్రకటించిన ప్రయోజనాలు: $PURPOSES$.',
    'పరికరంలో డేటాను నిల్వ చేయడం మరియు యాక్సెస్ చేయడం', 'ప్రాథమిక ప్రకటనలు', 'ప్రకటనల ప్రొఫైల్ సృష్టించడం', 'వ్యక్తిగతీకరించిన ప్రకటనలు',
    'కంటెంట్ అభిరుచుల ప్రొఫైల్ సృష్టించడం', 'వ్యక్తిగతీకరించిన కంటెంట్', 'ప్రకటనల ప్రభావాన్ని కొలవడం', 'కంటెంట్ ప్రభావాన్ని కొలవడం',
    'ప్రేక్షకుల పరిశోధన', 'సేవల అభివృద్ధి', 'ప్రాథమిక కంటెంట్ ఎంపిక', 'భద్రత మరియు మోసాల నివారణ',
    'ప్రకటనలు మరియు కంటెంట్ పంపిణీ', 'గోప్యత ఎంపికలు',
    'ట్రాకింగ్‌ను నిరాకరించే ఎంపికను ఈ కుకీ నిల్వ చేస్తుందని ప్రదాత ప్రకటించారు.',
    'ప్రదాత ఈ కుకీ మరియు దాని డొమైన్‌ను ప్రకటించారు, కానీ TCF ప్రయోజన IDలను ఇవ్వలేదు.',
    'CookieBlock ఈ పేరును ఆటోమేటిక్ బ్లాకింగ్‌కు మినహాయింపుగా నమోదు చేసింది; ఈ మినహాయింపు కుకీ ప్రయోజనం లేదా తయారీదారును నిర్ధారించదు.'
  ],
  ko: [
    '제공업체가 신고한 목적: $PURPOSES$.',
    '기기 내 데이터 저장 및 접근', '기본 광고', '광고 프로필 생성', '맞춤형 광고',
    '콘텐츠 관심 프로필 생성', '맞춤형 콘텐츠', '광고 성과 측정', '콘텐츠 성과 측정',
    '잠재고객 조사', '서비스 개발', '기본 콘텐츠 선택', '보안 및 사기 방지',
    '광고 및 콘텐츠 제공', '개인정보 설정',
    '제공업체는 이 쿠키가 추적 거부 선택을 저장한다고 신고했습니다.',
    '제공업체는 이 쿠키와 도메인을 신고했지만 TCF 목적 ID는 제공하지 않았습니다.',
    'CookieBlock은 이 이름을 자동 차단 예외로 등록했습니다. 예외라는 사실만으로 쿠키의 목적이나 제공업체를 확인할 수 없습니다.'
  ],
  ta: [
    'வழங்குநர் அறிவித்த நோக்கங்கள்: $PURPOSES$.',
    'சாதனத்தில் தரவைச் சேமித்தல் மற்றும் அணுகுதல்', 'அடிப்படை விளம்பரங்கள்', 'விளம்பரச் சுயவிவரத்தை உருவாக்குதல்', 'தனிப்பயனாக்கப்பட்ட விளம்பரங்கள்',
    'உள்ளடக்க விருப்பச் சுயவிவரத்தை உருவாக்குதல்', 'தனிப்பயனாக்கப்பட்ட உள்ளடக்கம்', 'விளம்பர செயல்திறனை அளவிடுதல்', 'உள்ளடக்க செயல்திறனை அளவிடுதல்',
    'பார்வையாளர் ஆய்வு', 'சேவைகளை உருவாக்குதல்', 'அடிப்படை உள்ளடக்கத் தேர்வு', 'பாதுகாப்பு மற்றும் மோசடித் தடுப்பு',
    'விளம்பரங்கள் மற்றும் உள்ளடக்கத்தை வழங்குதல்', 'தனியுரிமைத் தேர்வுகள்',
    'கண்காணிப்பை மறுக்கும் தேர்வை இந்தக் குக்கீ சேமிப்பதாக வழங்குநர் அறிவித்துள்ளார்.',
    'வழங்குநர் இந்தக் குக்கீ மற்றும் அதன் டொமைனை அறிவித்துள்ளார்; ஆனால் TCF நோக்க IDகளை வழங்கவில்லை.',
    'CookieBlock இந்தப் பெயரைத் தானியங்கித் தடுப்பின் விலக்காகப் பட்டியலிடுகிறது; விலக்கு அதன் நோக்கத்தையோ தயாரிப்பாளரையோ உறுதிப்படுத்தாது.'
  ]
};

// Exact translations of three primary-source descriptions; no category or name-based inference.
const PRIMARY_COPY = {
  en: ["Visitor differentiation", "Meta advertising browser attribution", "Default PHP session identifier: associates requests with server-side session state, such as a login or shopping cart. Applications can configure a different session name."],
  ru: ["Различение посетителей", "Атрибуция браузера для рекламы Meta", "Стандартный идентификатор сессии PHP: связывает запросы с состоянием сессии на сервере, например входом в аккаунт или корзиной покупок. Приложение может настроить другое имя сессии."],
  zh_CN: ["区分访客", "Meta 广告浏览器归因", "默认 PHP 会话标识符：将请求与服务器端会话状态关联，例如登录状态或购物车。应用程序可以配置不同的会话名称。"],
  yue: ["区分访客", "Meta 广告嘅浏览器归因", "默认 PHP 会话识别码：将请求同服务器端嘅会话状态关联，例如登入状态或者购物车。应用程式可以设定唔同嘅会话名称。"],
  wuu: ["区分访问者", "Meta 广告个浏览器归因", "默认 PHP 会话标识符：拿请求搭服务器端个会话状态关联起来，比方登录状态或者购物车。应用程序可以设置另外个会话名称。"],
  vi: ["Phân biệt khách truy cập", "Phân bổ trình duyệt cho quảng cáo Meta", "Mã định danh phiên PHP mặc định: liên kết yêu cầu với trạng thái phiên trên máy chủ, chẳng hạn trạng thái đăng nhập hoặc giỏ hàng. Ứng dụng có thể cấu hình tên phiên khác."],
  es: ["Diferenciación de visitantes", "Atribución del navegador para publicidad de Meta", "Identificador de sesión PHP predeterminado: vincula las solicitudes con el estado de la sesión en el servidor, como el inicio de sesión o el carrito de compras. Las aplicaciones pueden configurar un nombre de sesión diferente."],
  ar: ["التمييز بين الزوار", "إسناد المتصفح لإعلانات Meta", "معرّف جلسة PHP الافتراضي: يربط الطلبات بحالة الجلسة على الخادم، مثل تسجيل الدخول أو سلة التسوق. يمكن للتطبيقات إعداد اسم مختلف للجلسة."],
  uk: ["Розрізнення відвідувачів", "Атрибуція браузера для реклами Meta", "Стандартний ідентифікатор сесії PHP: пов’язує запити зі станом сесії на сервері, наприклад входом в обліковий запис або кошиком покупок. Застосунок може налаштувати інше ім’я сесії."],
  fr: ["Différenciation des visiteurs", "Attribution du navigateur pour la publicité Meta", "Identifiant de session PHP par défaut : associe les requêtes à l’état de session côté serveur, comme une connexion ou un panier d’achat. Les applications peuvent configurer un autre nom de session."],
  pt_BR: ["Diferenciação de visitantes", "Atribuição do navegador para publicidade da Meta", "Identificador de sessão PHP padrão: associa solicitações ao estado da sessão no servidor, como login ou carrinho de compras. Os aplicativos podem configurar um nome de sessão diferente."],
  hi: ["आगंतुकों में अंतर करना", "Meta विज्ञापन के लिए ब्राउज़र एट्रिब्यूशन", "डिफ़ॉल्ट PHP सत्र पहचानकर्ता: अनुरोधों को सर्वर पर सत्र की स्थिति से जोड़ता है, जैसे लॉगिन या शॉपिंग कार्ट। अनुप्रयोग सत्र का दूसरा नाम निर्धारित कर सकते हैं।"],
  ur: ["زائرین میں امتیاز", "Meta اشتہارات کے لیے براؤزر کی نسبت", "طے شدہ PHP سیشن شناخت کنندہ: درخواستوں کو سرور پر سیشن کی حالت سے جوڑتا ہے، جیسے لاگ اِن یا خریداری کی ٹوکری۔ ایپلی کیشنز سیشن کا مختلف نام مقرر کر سکتی ہیں۔"],
  ja: ["訪問者の区別", "Meta 広告のブラウザーアトリビューション", "PHP の既定のセッション識別子：リクエストを、ログイン状態やショッピングカートなど、サーバー側のセッション状態に関連付けます。アプリケーションは別のセッション名を設定できます。"],
  de: ["Unterscheidung von Besuchern", "Browser-Zuordnung für Meta-Werbung", "Standardmäßige PHP-Sitzungskennung: verknüpft Anfragen mit dem serverseitigen Sitzungszustand, etwa einer Anmeldung oder einem Warenkorb. Anwendungen können einen anderen Sitzungsnamen festlegen."],
  pl: ["Rozróżnianie odwiedzających", "Atrybucja przeglądarki dla reklam Meta", "Domyślny identyfikator sesji PHP: wiąże żądania ze stanem sesji na serwerze, takim jak logowanie lub koszyk zakupów. Aplikacje mogą ustawić inną nazwę sesji."],
  id: ["Membedakan pengunjung", "Atribusi browser untuk iklan Meta", "Pengenal sesi PHP bawaan: menghubungkan permintaan dengan status sesi di server, seperti login atau keranjang belanja. Aplikasi dapat mengonfigurasi nama sesi yang berbeda."],
  mr: ["अभ्यागतांमध्ये फरक ओळखणे", "Meta जाहिरातींसाठी ब्राउझर अ‍ॅट्रिब्युशन", "डीफॉल्ट PHP सत्र ओळखकर्ता: विनंत्यांना सर्व्हरवरील सत्राच्या स्थितीशी जोडतो, जसे की लॉगिन किंवा खरेदीची कार्ट. अनुप्रयोग सत्राचे वेगळे नाव सेट करू शकतात."],
  te: ["సందర్శకులను వేరు చేయడం", "Meta ప్రకటనల కోసం బ్రౌజర్ అట్రిబ్యూషన్", "డిఫాల్ట్ PHP సెషన్ గుర్తింపుదారు: అభ్యర్థనలను సర్వర్‌లోని సెషన్ స్థితితో అనుసంధానిస్తుంది, ఉదాహరణకు లాగిన్ లేదా షాపింగ్ కార్ట్. అప్లికేషన్‌లు వేరే సెషన్ పేరును అమర్చవచ్చు."],
  ko: ["방문자 구분", "Meta 광고를 위한 브라우저 기여도 분석", "기본 PHP 세션 식별자: 요청을 로그인 상태나 장바구니와 같은 서버 측 세션 상태에 연결합니다. 애플리케이션은 다른 세션 이름을 설정할 수 있습니다."],
  ta: ["பார்வையாளர்களை வேறுபடுத்துதல்", "Meta விளம்பரங்களுக்கான உலாவி அட்ரிப்யூஷன்", "இயல்புநிலை PHP அமர்வு அடையாளங்காட்டி: கோரிக்கைகளை உள்நுழைவு அல்லது வாங்கும் கூடை போன்ற சேவையக அமர்வு நிலையுடன் இணைக்கிறது. பயன்பாடுகள் வேறு அமர்வுப் பெயரை அமைக்கலாம்."]
};

export function applyCookiePurposeCopy(table, locale) {
  if (typeof locale !== 'string' || !Object.hasOwn(COPY, locale)) throw new Error('Cookie purposes: unknown locale ' + String(locale));
  if (table === null || typeof table !== 'object' || Array.isArray(table)) throw new TypeError('Cookie purposes: expected a message table');
  const copy = [...COPY[locale], ...PRIMARY_COPY[locale]];
  if (copy.length !== COOKIE_PURPOSE_TRANSLATION_KEYS.length || copy.some(value => typeof value !== 'string' || !value)) {
    throw new Error('Cookie purposes: incomplete translations for ' + locale);
  }
  for (let index = 0; index < COOKIE_PURPOSE_TRANSLATION_KEYS.length; index++) {
    table[COOKIE_PURPOSE_TRANSLATION_KEYS[index]] = { message: copy[index] };
  }
  if (!table.cookie_purpose_declared.message.includes('$PURPOSES$')) throw new Error('Cookie purposes: missing template for ' + locale);
  table.cookie_purpose_declared.placeholders = { purposes: { content: '$1' } };
  return table;
}
