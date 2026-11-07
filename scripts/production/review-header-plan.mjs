// DET-074 / ADR-038: reviewed response-header names and factual UI copy.
// Pure helpers only. Importing this module never reads or writes shared files.
export const REVIEW_HEADER_ADDITIONS = Object.freeze([
  'set-login', 'content-security-policy', 'strict-transport-security',
  'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'x-frame-options',
]);
export const REVIEW_RESPONSE_HEADER_NAMES = Object.freeze([
  'accept-ch', 'critical-ch', 'permissions-policy', 'feature-policy', 'nel',
  'report-to', 'reporting-endpoints', 'secure-session-registration',
  'sec-session-registration', 'secure-session-challenge', 'sec-session-challenge',
  'use-as-dictionary', ...REVIEW_HEADER_ADDITIONS,
]);
export const REVIEW_HEADER_KEYS = Object.freeze([
  'headers_login_status_note', 'headers_csp_note', 'headers_hsts_note',
  'headers_coop_note', 'headers_coep_note', 'headers_frame_note', 'headers_presence_note',
]);

// Describes the header's purpose; no policy value, login state or effectiveness is inferred.
const COPY = {
  en: ['Login status signal for FedCM.', 'Content loading and execution policy.', 'HTTPS connection policy.', 'Policy for separating top-level browsing contexts.', 'Policy for loading cross-origin resources.', 'Policy for embedding the page in frames.', 'Response header observed.'],
  ru: ['Сигнал состояния входа для FedCM.', 'Политика загрузки и выполнения содержимого.', 'Политика HTTPS-соединений.', 'Политика разделения контекстов вкладок и окон.', 'Политика загрузки ресурсов других источников.', 'Политика встраивания страницы во фреймы.', 'Обнаружен заголовок ответа.'],
  zh_CN: ['用于 FedCM 的登录状态信号。', '内容加载与执行策略。', 'HTTPS 连接策略。', '顶层浏览上下文的隔离策略。', '跨源资源加载策略。', '页面嵌入框架的策略。', '检测到响应标头。'],
  vi: ['Tín hiệu trạng thái đăng nhập cho FedCM.', 'Chính sách tải và thực thi nội dung.', 'Chính sách kết nối HTTPS.', 'Chính sách tách biệt các ngữ cảnh duyệt cấp cao nhất.', 'Chính sách tải tài nguyên khác nguồn.', 'Chính sách nhúng trang vào khung.', 'Đã quan sát thấy tiêu đề phản hồi.'],
  es: ['Señal del estado de inicio de sesión para FedCM.', 'Política de carga y ejecución de contenido.', 'Política de conexiones HTTPS.', 'Política de separación de contextos de navegación de nivel superior.', 'Política de carga de recursos de otros orígenes.', 'Política de inserción de la página en marcos.', 'Se observó la cabecera de respuesta.'],
  ar: ['إشارة حالة تسجيل الدخول لـ FedCM.', 'سياسة تحميل المحتوى وتنفيذه.', 'سياسة اتصالات HTTPS.', 'سياسة فصل سياقات التصفح ذات المستوى الأعلى.', 'سياسة تحميل الموارد من مصادر أخرى.', 'سياسة تضمين الصفحة داخل الإطارات.', 'تم رصد ترويسة استجابة.'],
  uk: ['Сигнал стану входу для FedCM.', 'Політика завантаження й виконання вмісту.', 'Політика HTTPS-з’єднань.', 'Політика розділення контекстів вкладок і вікон.', 'Політика завантаження ресурсів інших джерел.', 'Політика вбудовування сторінки у фрейми.', 'Виявлено заголовок відповіді.'],
  fr: ['Signal d’état de connexion pour FedCM.', 'Politique de chargement et d’exécution du contenu.', 'Politique de connexion HTTPS.', 'Politique de séparation des contextes de navigation de premier niveau.', 'Politique de chargement des ressources d’autres origines.', 'Politique d’intégration de la page dans des cadres.', 'En-tête de réponse observé.'],
  pt_BR: ['Sinal de estado de login para FedCM.', 'Política de carregamento e execução de conteúdo.', 'Política de conexões HTTPS.', 'Política de separação dos contextos de navegação de nível superior.', 'Política de carregamento de recursos de outras origens.', 'Política de incorporação da página em frames.', 'Cabeçalho de resposta observado.'],
  hi: ['FedCM के लिए लॉगिन स्थिति का संकेत।', 'सामग्री लोड करने और चलाने की नीति।', 'HTTPS कनेक्शन की नीति।', 'शीर्ष-स्तरीय ब्राउज़िंग संदर्भों को अलग करने की नीति।', 'अन्य मूलों से संसाधन लोड करने की नीति।', 'पेज को फ़्रेम में एम्बेड करने की नीति।', 'प्रतिक्रिया हेडर देखा गया।'],
  ur: ['FedCM کے لیے لاگ اِن کی حالت کا اشارہ۔', 'مواد لوڈ کرنے اور چلانے کی پالیسی۔', 'HTTPS کنکشن کی پالیسی۔', 'اعلیٰ سطح کے براؤزنگ سیاق الگ رکھنے کی پالیسی۔', 'دوسرے ماخذوں سے وسائل لوڈ کرنے کی پالیسی۔', 'صفحے کو فریم میں شامل کرنے کی پالیسی۔', 'جواب کا ہیڈر دیکھا گیا۔'],
  ja: ['FedCM のログイン状態シグナル。', 'コンテンツの読み込みと実行のポリシー。', 'HTTPS 接続のポリシー。', '最上位の閲覧コンテキストを分離するポリシー。', '異なるオリジンのリソースを読み込むポリシー。', 'ページをフレームに埋め込むポリシー。', 'レスポンスヘッダーを検出。'],
  de: ['Anmeldestatussignal für FedCM.', 'Richtlinie zum Laden und Ausführen von Inhalten.', 'Richtlinie für HTTPS-Verbindungen.', 'Richtlinie zur Trennung von Browsing-Kontexten der obersten Ebene.', 'Richtlinie zum Laden von Ressourcen anderer Ursprünge.', 'Richtlinie zur Einbettung der Seite in Frames.', 'Antwortheader beobachtet.'],
  pl: ['Sygnał stanu logowania dla FedCM.', 'Polityka ładowania i wykonywania treści.', 'Polityka połączeń HTTPS.', 'Polityka rozdzielania kontekstów przeglądania najwyższego poziomu.', 'Polityka ładowania zasobów z innych źródeł.', 'Polityka osadzania strony w ramkach.', 'Zaobserwowano nagłówek odpowiedzi.'],
  id: ['Sinyal status login untuk FedCM.', 'Kebijakan pemuatan dan eksekusi konten.', 'Kebijakan koneksi HTTPS.', 'Kebijakan pemisahan konteks penjelajahan tingkat teratas.', 'Kebijakan pemuatan sumber daya lintas asal.', 'Kebijakan penyematan halaman dalam bingkai.', 'Header respons teramati.'],
  mr: ['FedCM साठी लॉगिन स्थितीचा संकेत.', 'सामग्री लोड करणे आणि चालवण्याचे धोरण.', 'HTTPS जोडण्यांचे धोरण.', 'उच्च-स्तरीय ब्राउझिंग संदर्भ वेगळे ठेवण्याचे धोरण.', 'इतर उगमांमधून संसाधने लोड करण्याचे धोरण.', 'पान फ्रेममध्ये एम्बेड करण्याचे धोरण.', 'प्रतिसाद हेडर आढळला.'],
  te: ['FedCM కోసం లాగిన్ స్థితి సంకేతం.', 'కంటెంట్‌ను లోడ్ చేయడం మరియు అమలు చేయడం కోసం విధానం.', 'HTTPS కనెక్షన్ల విధానం.', 'అత్యున్నత స్థాయి బ్రౌజింగ్ సందర్భాలను వేరుచేసే విధానం.', 'ఇతర మూలాల నుండి వనరులను లోడ్ చేసే విధానం.', 'పేజీని ఫ్రేమ్‌లలో పొందుపరిచే విధానం.', 'ప్రతిస్పందన హెడర్ గమనించబడింది.'],
  ko: ['FedCM용 로그인 상태 신호.', '콘텐츠 로드 및 실행 정책.', 'HTTPS 연결 정책.', '최상위 탐색 컨텍스트 분리 정책.', '다른 출처의 리소스 로드 정책.', '페이지의 프레임 삽입 정책.', '응답 헤더가 관찰되었습니다.'],
  ta: ['FedCM உள்நுழைவு நிலைக்கான சமிக்ஞை.', 'உள்ளடக்கத்தை ஏற்றுவதற்கும் இயக்குவதற்குமான கொள்கை.', 'HTTPS இணைப்புகளுக்கான கொள்கை.', 'உயர்நிலை உலாவல் சூழல்களைப் பிரிப்பதற்கான கொள்கை.', 'பிற தோற்றங்களிலிருந்து வளங்களை ஏற்றுவதற்கான கொள்கை.', 'பக்கத்தைச் சட்டகங்களில் உட்பொதிப்பதற்கான கொள்கை.', 'பதில் தலைப்பு கண்டறியப்பட்டது.'],
  yue: ['畀 FedCM 用嘅登入狀態訊號。', '內容載入同執行政策。', 'HTTPS 連線政策。', '分隔頂層瀏覽情境嘅政策。', '載入跨來源資源嘅政策。', '將網頁嵌入框架嘅政策。', '觀察到回應標頭。'],
  wuu: ['供 FedCM 使用个登录状态信号。', '内容载入搭执行策略。', 'HTTPS 连接策略。', '分隔顶层浏览上下文个策略。', '载入跨来源资源个策略。', '拿网页嵌入框架个策略。', '观察到响应标头。'],
};

export function applyReviewHeaderCopy(table, locale) {
  const copy = COPY[locale];
  if (!copy || copy.length !== REVIEW_HEADER_KEYS.length) throw Error('Unknown header-copy locale: ' + locale);
  REVIEW_HEADER_KEYS.forEach((key, index) => { table[key] = { message: copy[index] }; });
  return table;
}

// Shared by live ResponseHeaders and Pro OtherChecks; unknown names never imply DBSC.
export function responseHeaderExplanation(name) {
  switch (name) {
    case 'accept-ch': case 'critical-ch': return 'headers_client_hints_note';
    case 'permissions-policy': case 'feature-policy': return 'headers_policy_note';
    case 'nel': case 'report-to': case 'reporting-endpoints': return 'headers_reporting_note';
    case 'use-as-dictionary': return 'headers_dictionary_note';
    case 'secure-session-registration': case 'sec-session-registration':
    case 'secure-session-challenge': case 'sec-session-challenge': return 'headers_session_note';
    case 'set-login': return 'headers_login_status_note';
    case 'content-security-policy': return 'headers_csp_note';
    case 'strict-transport-security': return 'headers_hsts_note';
    case 'cross-origin-opener-policy': return 'headers_coop_note';
    case 'cross-origin-embedder-policy': return 'headers_coep_note';
    case 'x-frame-options': return 'headers_frame_note';
    default: return 'headers_presence_note';
  }
}

// Called explicitly by the integration owner for each of the four production bundles.
export function patchResponseHeaderAllowlist(source, { expectedCount = 1 } = {}) {
  const expression = /var RESPONSE_HEADER_NAMES = (\[[\s\S]*?\])(?=, CLIENT_HINT_NAMES =)/g;
  let count = 0;
  const result = source.replace(expression, (_match, encoded) => {
    ++count;
    const previous = JSON.parse(encoded);
    if (!Array.isArray(previous) || previous.some(name => typeof name !== 'string') ||
        new Set(previous).size !== previous.length ||
        REVIEW_RESPONSE_HEADER_NAMES.slice(0, 12).some(name => !previous.includes(name))) throw Error('Unexpected response-header registry');
    const names = [...previous, ...REVIEW_HEADER_ADDITIONS.filter(name => !previous.includes(name))];
    return 'var RESPONSE_HEADER_NAMES = [\n' + names.map(name => '  ' + JSON.stringify(name)).join(',\n') + '\n]';
  });
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1 || count !== expectedCount) throw Error('Expected ' + expectedCount + ' response-header registry copies, found ' + count);
  return result;
}

// Applies to pro-report-tables.js and the live explanation function in UI bundles.
export function patchResponseHeaderExplanations(source) {
  const expression = /^function (explanation|explainHeader)\(name\) \{[\s\S]*?^\}/gm;
  let count = 0;
  const result = source.replace(expression, (previous, name) => {
    if (!previous.includes('headers_client_hints_note')) throw Error('Unexpected header explanation function');
    ++count;
    return responseHeaderExplanation.toString().replace('responseHeaderExplanation', name);
  });
  if (count !== 1) throw Error('Expected one header explanation, found ' + count);
  return result;
}
