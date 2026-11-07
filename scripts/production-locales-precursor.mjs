// DET-CF-PRECURSOR-001 / ADR-074: factual observation and availability copy only.
const FIELDS = Object.freeze(['observed', 'not_observed', 'mode', 'mode_unknown', 'loading', 'no_site', 'no_access', 'paused', 'unsupported', 'unavailable']);
export const PRECURSOR_UI_KEYS = Object.freeze(['precursor_title', ...FIELDS.map(key => 'precursor_' + key)]);
const COPY = {
  ru: 'Ресурс наблюдался|Ресурс не наблюдался|Режим|Не определён|Загрузка наблюдений…|Выберите страницу сайта|Нет доступа к наблюдениям|Наблюдение приостановлено|Наблюдение недоступно|Не удалось загрузить наблюдения',
  en: 'Resource observed|Resource not observed|Mode|Unknown|Loading observations…|Select a website page|Observations are not accessible|Observation paused|Observation unavailable|Unable to load observations',
  zh_CN: '已观察到资源|未观察到资源|模式|未知|正在加载观察结果…|请选择网站页面|无法访问观察结果|观察已暂停|观察不可用|无法加载观察结果',
  vi: 'Đã quan sát thấy tài nguyên|Chưa quan sát thấy tài nguyên|Chế độ|Chưa xác định|Đang tải quan sát…|Chọn một trang web|Không thể truy cập quan sát|Đã tạm dừng quan sát|Quan sát không khả dụng|Không thể tải quan sát',
  es: 'Recurso observado|Recurso no observado|Modo|Desconocido|Cargando observaciones…|Selecciona una página web|No se puede acceder a las observaciones|Observación en pausa|Observación no disponible|No se pudieron cargar las observaciones',
  ar: 'تمت ملاحظة المورد|لم يُلاحظ المورد|الوضع|غير معروف|جارٍ تحميل الملاحظات…|اختر صفحة موقع|لا يمكن الوصول إلى الملاحظات|الملاحظة متوقفة مؤقتًا|الملاحظة غير متاحة|تعذر تحميل الملاحظات',
  uk: 'Ресурс спостерігався|Ресурс не спостерігався|Режим|Не визначено|Завантаження спостережень…|Виберіть сторінку сайту|Немає доступу до спостережень|Спостереження призупинено|Спостереження недоступне|Не вдалося завантажити спостереження',
  fr: 'Ressource observée|Ressource non observée|Mode|Inconnu|Chargement des observations…|Choisissez une page web|Observations inaccessibles|Observation en pause|Observation indisponible|Impossible de charger les observations',
  pt_BR: 'Recurso observado|Recurso não observado|Modo|Desconhecido|Carregando observações…|Selecione uma página de site|Não há acesso às observações|Observação pausada|Observação indisponível|Não foi possível carregar as observações',
  hi: 'संसाधन देखा गया|संसाधन नहीं देखा गया|मोड|अज्ञात|अवलोकन लोड हो रहे हैं…|किसी वेबसाइट का पृष्ठ चुनें|अवलोकन उपलब्ध नहीं हैं|अवलोकन रोका गया है|अवलोकन उपलब्ध नहीं|अवलोकन लोड नहीं हो सके',
  ur: 'وسیلہ دیکھا گیا|وسیلہ نہیں دیکھا گیا|موڈ|نامعلوم|مشاہدات لوڈ ہو رہے ہیں…|ویب سائٹ کا صفحہ منتخب کریں|مشاہدات تک رسائی نہیں|مشاہدہ روک دیا گیا ہے|مشاہدہ دستیاب نہیں|مشاہدات لوڈ نہیں ہو سکے',
  ja: 'リソースを観測|リソースは未観測|モード|不明|観測結果を読み込み中…|ウェブサイトのページを選択|観測結果にアクセスできません|観測は一時停止中|観測できません|観測結果を読み込めませんでした',
  de: 'Ressource beobachtet|Ressource nicht beobachtet|Modus|Unbekannt|Beobachtungen werden geladen…|Website-Seite auswählen|Kein Zugriff auf Beobachtungen|Beobachtung pausiert|Beobachtung nicht verfügbar|Beobachtungen konnten nicht geladen werden',
  pl: 'Zaobserwowano zasób|Nie zaobserwowano zasobu|Tryb|Nieznany|Ładowanie obserwacji…|Wybierz stronę internetową|Brak dostępu do obserwacji|Obserwacja wstrzymana|Obserwacja niedostępna|Nie udało się wczytać obserwacji',
  id: 'Sumber daya teramati|Sumber daya tidak teramati|Mode|Tidak diketahui|Memuat pengamatan…|Pilih halaman situs|Pengamatan tidak dapat diakses|Pengamatan dijeda|Pengamatan tidak tersedia|Tidak dapat memuat pengamatan',
  mr: 'संसाधन आढळले|संसाधन आढळले नाही|मोड|अज्ञात|निरीक्षणे लोड होत आहेत…|वेबसाइटचे पृष्ठ निवडा|निरीक्षणांना प्रवेश नाही|निरीक्षण थांबवले आहे|निरीक्षण उपलब्ध नाही|निरीक्षणे लोड करता आली नाहीत',
  te: 'వనరు గమనించబడింది|వనరు గమనించబడలేదు|మోడ్|తెలియదు|పరిశీలనలు లోడ్ అవుతున్నాయి…|వెబ్‌సైట్ పేజీని ఎంచుకోండి|పరిశీలనలకు యాక్సెస్ లేదు|పరిశీలన పాజ్ చేయబడింది|పరిశీలన అందుబాటులో లేదు|పరిశీలనలను లోడ్ చేయలేకపోయింది',
  ko: '리소스 관측됨|리소스 관측되지 않음|모드|알 수 없음|관측을 불러오는 중…|웹사이트 페이지를 선택하세요|관측에 접근할 수 없습니다|관측이 일시 중지됨|관측할 수 없음|관측을 불러오지 못했습니다',
  ta: 'வளம் கவனிக்கப்பட்டது|வளம் கவனிக்கப்படவில்லை|பயன்முறை|தெரியவில்லை|கவனிப்புகள் ஏற்றப்படுகின்றன…|இணையதளப் பக்கத்தைத் தேர்ந்தெடுக்கவும்|கவனிப்புகளை அணுக முடியவில்லை|கவனிப்பு இடைநிறுத்தப்பட்டது|கவனிப்பு கிடைக்காது|கவனிப்புகளை ஏற்ற முடியவில்லை',
  yue: '观察到资源|未观察到资源|模式|未知|载入观察结果…|请选择网站页面|无法存取观察结果|观察已暂停|观察唔可用|无法载入观察结果',
  wuu: '观察到资源|资源呒观察到|模式|还呒晓得|加载观察结果…|请选网站页面|观察结果访问弗了|观察暂停了|观察弗可用|观察结果加载弗了'
};
export const PRECURSOR_UI_MESSAGES = Object.freeze(Object.fromEntries(Object.entries(COPY).map(([locale, source]) => {
  const values = source.split('|');
  if (values.length !== FIELDS.length || values.some(value => !value || value !== value.trim())) throw Error('Invalid Precursor locale ' + locale);
  return [locale, Object.freeze({ precursor_title: 'Cloudflare Precursor', ...Object.fromEntries(FIELDS.map((key, index) => ['precursor_' + key, values[index]])) })];
})));
export function applyPrecursorCopy(table, locale) {
  const messages = PRECURSOR_UI_MESSAGES[locale];
  if (!messages) throw Error('Unknown Precursor locale ' + String(locale));
  for (const key of PRECURSOR_UI_KEYS) table[key] = { message: messages[key] };
  return table;
}
