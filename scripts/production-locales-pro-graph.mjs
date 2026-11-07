// Pro resource graph labels; reuse existing translations and metadata for shared concepts.
const ALIASES = {
  third_party: 'report_third_party',
  type_filter: 'report_resource_type',
  pages: 'pro_pages_total',
  requests: 'pro_resource_requests',
  completed: 'report_completed',
  failed: 'report_failed',
  redirects: 'report_redirects',
  statuses: 'report_statuses',
  resource_groups: 'report_resources',
};

const INPUT_LIMITED = {
  en: 'The input exceeds the map limits; the view is incomplete.',
  ru: 'Входные данные превышают лимиты карты; показана неполная выборка.',
  zh_CN: '输入数据超过图的上限，显示结果不完整。',
  yue: '输入数据超出请求图嘅上限，显示结果唔完整。',
  wuu: '输入数据超过请求图个上限，显示结果勿完整。',
  vi: 'Dữ liệu đầu vào vượt giới hạn của sơ đồ; phần hiển thị không đầy đủ.',
  es: 'Los datos de entrada superan los límites del mapa; la vista está incompleta.',
  ar: 'تتجاوز البيانات المدخلة حدود الخريطة؛ العرض غير مكتمل.',
  uk: 'Вхідні дані перевищують ліміти карти; показано неповну вибірку.',
  fr: 'Les données dépassent les limites de la carte ; la vue est incomplète.',
  pt_BR: 'Os dados de entrada excedem os limites do mapa; a visualização está incompleta.',
  hi: 'इनपुट डेटा मानचित्र की सीमाओं से अधिक है; दृश्य अधूरा है।',
  ur: 'ان پٹ ڈیٹا نقشے کی حدود سے زیادہ ہے؛ منظر نامکمل ہے۔',
  ja: '入力データがマップの上限を超えているため、表示は不完全です。',
  de: 'Die Eingabedaten überschreiten die Kartenlimits; die Ansicht ist unvollständig.',
  pl: 'Dane wejściowe przekraczają limity mapy; widok jest niepełny.',
  id: 'Data masukan melebihi batas peta; tampilan tidak lengkap.',
  mr: 'इनपुट डेटा नकाशाच्या मर्यादेपेक्षा अधिक आहे; दृश्य अपूर्ण आहे.',
  te: 'ఇన్‌పుట్ డేటా పటం పరిమితులను మించింది; ప్రదర్శన అసంపూర్ణంగా ఉంది.',
  ko: '입력 데이터가 지도 한도를 초과하여 표시가 불완전합니다.',
  ta: 'உள்ளீட்டுத் தரவு வரைபட வரம்புகளை மீறுகிறது; காட்சி முழுமையற்றது.',
};

const COPY = {
  en: {
    title: 'Pro request map', domains: 'Domains', all_parties: 'All domains', all_types: 'All types',
    page: 'Page visit $NUMBER$',
    select_domain: 'Choose a domain to see its page visits and request counts.',
    selected_domain: 'Domain details', clear_selection: 'Clear selection',
    empty: 'No matching resource requests.',
    omitted: 'Hidden by view limits: $PAGES$ page visits, $DOMAINS$ domains, $EDGES$ links.',
    graph_label: 'Page visits linked to requested domains',
  },
  ru: {
    title: 'Карта запросов Pro', domains: 'Домены', all_parties: 'Все домены', all_types: 'Все типы',
    page: 'Посещение страницы $NUMBER$',
    select_domain: 'Выберите домен, чтобы увидеть связанные посещения страниц и количество запросов.',
    selected_domain: 'Сведения о домене', clear_selection: 'Снять выбор',
    empty: 'Нет подходящих запросов ресурсов.',
    omitted: 'Скрыто из-за ограничений отображения: посещений страниц — $PAGES$, доменов — $DOMAINS$, связей — $EDGES$.',
    graph_label: 'Посещения страниц, связанные с доменами запросов',
  },
  zh_CN: {
    title: 'Pro 请求图', domains: '域名', all_parties: '所有域名', all_types: '所有类型',
    page: '页面访问 $NUMBER$',
    select_domain: '选择一个域名，查看相关页面访问和请求次数。',
    selected_domain: '域名详情', clear_selection: '清除选择',
    empty: '没有匹配的资源请求。',
    omitted: '因显示上限而隐藏：$PAGES$ 次页面访问、$DOMAINS$ 个域名、$EDGES$ 条连线。',
    graph_label: '页面访问与请求域名之间的连线',
  },
  yue: {
    title: 'Pro 请求图', domains: '域名', all_parties: '所有域名', all_types: '所有类型',
    page: '页面访问 $NUMBER$',
    select_domain: '拣一个域名，睇相关嘅页面访问同请求次数。',
    selected_domain: '域名详情', clear_selection: '清除选择',
    empty: '冇符合条件嘅资源请求。',
    omitted: '因为显示上限而隐藏：$PAGES$ 次页面访问、$DOMAINS$ 个域名、$EDGES$ 条连线。',
    graph_label: '页面访问同请求域名嘅连线',
  },
  wuu: {
    title: 'Pro 请求图', domains: '域名', all_parties: '所有域名', all_types: '所有类型',
    page: '页面访问 $NUMBER$',
    select_domain: '挑一个域名，看看相关个页面访问搭请求次数。',
    selected_domain: '域名详情', clear_selection: '清除选择',
    empty: '呒没符合条件个资源请求。',
    omitted: '因为显示上限隐藏：$PAGES$ 次页面访问、$DOMAINS$ 个域名、$EDGES$ 条连线。',
    graph_label: '页面访问搭请求域名个连线',
  },
  vi: {
    title: 'Sơ đồ yêu cầu Pro', domains: 'Tên miền', all_parties: 'Tất cả tên miền', all_types: 'Tất cả loại',
    page: 'Lượt truy cập trang $NUMBER$',
    select_domain: 'Chọn một tên miền để xem các lượt truy cập trang và số yêu cầu liên quan.',
    selected_domain: 'Chi tiết tên miền', clear_selection: 'Bỏ chọn',
    empty: 'Không có yêu cầu tài nguyên phù hợp.',
    omitted: 'Ẩn do giới hạn hiển thị: $PAGES$ lượt truy cập trang, $DOMAINS$ tên miền, $EDGES$ liên kết.',
    graph_label: 'Các lượt truy cập trang liên kết với tên miền được yêu cầu',
  },
  es: {
    title: 'Mapa de solicitudes Pro', domains: 'Dominios', all_parties: 'Todos los dominios', all_types: 'Todos los tipos',
    page: 'Visita a página $NUMBER$',
    select_domain: 'Elige un dominio para ver sus visitas a páginas y recuentos de solicitudes.',
    selected_domain: 'Detalles del dominio', clear_selection: 'Borrar selección',
    empty: 'No hay solicitudes de recursos que coincidan.',
    omitted: 'Ocultos por los límites de visualización: $PAGES$ visitas a páginas, $DOMAINS$ dominios y $EDGES$ enlaces.',
    graph_label: 'Visitas a páginas vinculadas a los dominios solicitados',
  },
  ar: {
    title: 'خريطة طلبات Pro', domains: 'النطاقات', all_parties: 'جميع النطاقات', all_types: 'جميع الأنواع',
    page: 'زيارة الصفحة $NUMBER$',
    select_domain: 'اختر نطاقًا لعرض زيارات الصفحات وأعداد الطلبات المرتبطة به.',
    selected_domain: 'تفاصيل النطاق', clear_selection: 'مسح التحديد',
    empty: 'لا توجد طلبات موارد مطابقة.',
    omitted: 'مخفي بسبب حدود العرض: $PAGES$ زيارات صفحات، $DOMAINS$ نطاقات، $EDGES$ روابط.',
    graph_label: 'زيارات الصفحات المرتبطة بالنطاقات المطلوبة',
  },
  uk: {
    title: 'Карта запитів Pro', domains: 'Домени', all_parties: 'Усі домени', all_types: 'Усі типи',
    page: 'Відвідування сторінки $NUMBER$',
    select_domain: 'Виберіть домен, щоб побачити пов’язані відвідування сторінок і кількість запитів.',
    selected_domain: 'Деталі домену', clear_selection: 'Скасувати вибір',
    empty: 'Немає відповідних запитів ресурсів.',
    omitted: 'Приховано через обмеження відображення: відвідувань сторінок — $PAGES$, доменів — $DOMAINS$, зв’язків — $EDGES$.',
    graph_label: 'Відвідування сторінок, пов’язані з доменами запитів',
  },
  fr: {
    title: 'Carte des requêtes Pro', domains: 'Domaines', all_parties: 'Tous les domaines', all_types: 'Tous les types',
    page: 'Visite de page $NUMBER$',
    select_domain: 'Choisissez un domaine pour voir les visites de pages et le nombre de requêtes associés.',
    selected_domain: 'Détails du domaine', clear_selection: 'Effacer la sélection',
    empty: 'Aucune requête de ressource correspondante.',
    omitted: 'Masqués par les limites d’affichage : $PAGES$ visites de pages, $DOMAINS$ domaines, $EDGES$ liens.',
    graph_label: 'Visites de pages reliées aux domaines sollicités',
  },
  pt_BR: {
    title: 'Mapa de requisições Pro', domains: 'Domínios', all_parties: 'Todos os domínios', all_types: 'Todos os tipos',
    page: 'Visita à página $NUMBER$',
    select_domain: 'Escolha um domínio para ver as visitas às páginas e as contagens de requisições relacionadas.',
    selected_domain: 'Detalhes do domínio', clear_selection: 'Limpar seleção',
    empty: 'Nenhuma requisição de recurso correspondente.',
    omitted: 'Ocultos pelos limites de visualização: $PAGES$ visitas às páginas, $DOMAINS$ domínios, $EDGES$ links.',
    graph_label: 'Visitas às páginas vinculadas aos domínios solicitados',
  },
  hi: {
    title: 'Pro अनुरोध मानचित्र', domains: 'डोमेन', all_parties: 'सभी डोमेन', all_types: 'सभी प्रकार',
    page: 'पेज विज़िट $NUMBER$',
    select_domain: 'डोमेन चुनकर उससे जुड़ी पेज विज़िट और अनुरोधों की संख्या देखें।',
    selected_domain: 'डोमेन विवरण', clear_selection: 'चयन हटाएँ',
    empty: 'कोई मेल खाने वाला संसाधन अनुरोध नहीं है।',
    omitted: 'दृश्य की सीमाओं के कारण छिपाए गए: $PAGES$ पेज विज़िट, $DOMAINS$ डोमेन, $EDGES$ लिंक।',
    graph_label: 'अनुरोधित डोमेन से जुड़ी पेज विज़िट',
  },
  ur: {
    title: 'Pro درخواستوں کا نقشہ', domains: 'ڈومینز', all_parties: 'تمام ڈومینز', all_types: 'تمام اقسام',
    page: 'صفحے کا وزٹ $NUMBER$',
    select_domain: 'کسی ڈومین سے متعلق صفحے کے وزٹس اور درخواستوں کی تعداد دیکھنے کے لیے اسے منتخب کریں۔',
    selected_domain: 'ڈومین کی تفصیلات', clear_selection: 'انتخاب ختم کریں',
    empty: 'وسائل کی کوئی مماثل درخواست نہیں۔',
    omitted: 'منظر کی حدود کے باعث چھپائے گئے: $PAGES$ صفحے کے وزٹس، $DOMAINS$ ڈومینز، $EDGES$ روابط۔',
    graph_label: 'درخواست کیے گئے ڈومینز سے منسلک صفحے کے وزٹس',
  },
  ja: {
    title: 'Pro リクエストマップ', domains: 'ドメイン', all_parties: 'すべてのドメイン', all_types: 'すべての種類',
    page: 'ページ訪問 $NUMBER$',
    select_domain: 'ドメインを選択すると、関連するページ訪問とリクエスト数を確認できます。',
    selected_domain: 'ドメインの詳細', clear_selection: '選択を解除',
    empty: '条件に一致するリソースリクエストはありません。',
    omitted: '表示上限により非表示：ページ訪問 $PAGES$ 件、ドメイン $DOMAINS$ 件、リンク $EDGES$ 件。',
    graph_label: 'リクエスト先ドメインにつながるページ訪問',
  },
  de: {
    title: 'Anfragekarte für Pro', domains: 'Domains', all_parties: 'Alle Domains', all_types: 'Alle Typen',
    page: 'Seitenbesuch $NUMBER$',
    select_domain: 'Wähle eine Domain, um die zugehörigen Seitenbesuche und Anfragezahlen zu sehen.',
    selected_domain: 'Domain-Details', clear_selection: 'Auswahl aufheben',
    empty: 'Keine passenden Ressourcenanfragen.',
    omitted: 'Wegen Anzeigelimits ausgeblendet: $PAGES$ Seitenbesuche, $DOMAINS$ Domains, $EDGES$ Verbindungen.',
    graph_label: 'Seitenbesuche mit Verbindungen zu angefragten Domains',
  },
  pl: {
    title: 'Mapa żądań Pro', domains: 'Domeny', all_parties: 'Wszystkie domeny', all_types: 'Wszystkie typy',
    page: 'Wizyta na stronie $NUMBER$',
    select_domain: 'Wybierz domenę, aby zobaczyć powiązane wizyty na stronach i liczbę żądań.',
    selected_domain: 'Szczegóły domeny', clear_selection: 'Wyczyść wybór',
    empty: 'Brak pasujących żądań zasobów.',
    omitted: 'Ukryte z powodu limitów widoku: $PAGES$ wizyt na stronach, $DOMAINS$ domen, $EDGES$ połączeń.',
    graph_label: 'Wizyty na stronach połączone z domenami, do których wysłano żądania',
  },
  id: {
    title: 'Peta permintaan Pro', domains: 'Domain', all_parties: 'Semua domain', all_types: 'Semua jenis',
    page: 'Kunjungan halaman $NUMBER$',
    select_domain: 'Pilih domain untuk melihat kunjungan halaman dan jumlah permintaan yang terkait.',
    selected_domain: 'Detail domain', clear_selection: 'Hapus pilihan',
    empty: 'Tidak ada permintaan sumber daya yang cocok.',
    omitted: 'Disembunyikan oleh batas tampilan: $PAGES$ kunjungan halaman, $DOMAINS$ domain, $EDGES$ tautan.',
    graph_label: 'Kunjungan halaman yang terhubung ke domain tujuan permintaan',
  },
  mr: {
    title: 'Pro विनंती नकाशा', domains: 'डोमेन', all_parties: 'सर्व डोमेन', all_types: 'सर्व प्रकार',
    page: 'पृष्ठ भेट $NUMBER$',
    select_domain: 'संबंधित पृष्ठ भेटी आणि विनंत्यांची संख्या पाहण्यासाठी डोमेन निवडा.',
    selected_domain: 'डोमेनचे तपशील', clear_selection: 'निवड रद्द करा',
    empty: 'जुळणाऱ्या संसाधन विनंत्या नाहीत.',
    omitted: 'दृश्य मर्यादांमुळे लपवलेले: $PAGES$ पृष्ठ भेटी, $DOMAINS$ डोमेन, $EDGES$ दुवे.',
    graph_label: 'विनंती केलेल्या डोमेनशी जोडलेल्या पृष्ठ भेटी',
  },
  te: {
    title: 'Pro అభ్యర్థనల పటం', domains: 'డొమైన్‌లు', all_parties: 'అన్ని డొమైన్‌లు', all_types: 'అన్ని రకాలు',
    page: 'పేజీ సందర్శన $NUMBER$',
    select_domain: 'సంబంధిత పేజీ సందర్శనలు, అభ్యర్థనల సంఖ్యలను చూడటానికి డొమైన్‌ను ఎంచుకోండి.',
    selected_domain: 'డొమైన్ వివరాలు', clear_selection: 'ఎంపికను తొలగించు',
    empty: 'సరిపోలే వనరుల అభ్యర్థనలు లేవు.',
    omitted: 'ప్రదర్శన పరిమితుల వల్ల దాచినవి: $PAGES$ పేజీ సందర్శనలు, $DOMAINS$ డొమైన్‌లు, $EDGES$ లింకులు.',
    graph_label: 'అభ్యర్థనలు పంపిన డొమైన్‌లతో అనుసంధానమైన పేజీ సందర్శనలు',
  },
  ko: {
    title: 'Pro 요청 지도', domains: '도메인', all_parties: '모든 도메인', all_types: '모든 유형',
    page: '페이지 방문 $NUMBER$',
    select_domain: '도메인을 선택하면 관련 페이지 방문과 요청 수를 볼 수 있습니다.',
    selected_domain: '도메인 세부 정보', clear_selection: '선택 해제',
    empty: '조건에 맞는 리소스 요청이 없습니다.',
    omitted: '표시 제한으로 숨김: 페이지 방문 $PAGES$개, 도메인 $DOMAINS$개, 연결 $EDGES$개.',
    graph_label: '요청 대상 도메인에 연결된 페이지 방문',
  },
  ta: {
    title: 'Pro கோரிக்கை வரைபடம்', domains: 'டொமைன்கள்', all_parties: 'அனைத்து டொமைன்களும்', all_types: 'அனைத்து வகைகளும்',
    page: 'பக்க வருகை $NUMBER$',
    select_domain: 'தொடர்புடைய பக்க வருகைகளையும் கோரிக்கை எண்ணிக்கைகளையும் பார்க்க ஒரு டொமைனைத் தேர்ந்தெடுக்கவும்.',
    selected_domain: 'டொமைன் விவரங்கள்', clear_selection: 'தேர்வை நீக்கு',
    empty: 'பொருந்தும் வளக் கோரிக்கைகள் இல்லை.',
    omitted: 'காட்சி வரம்புகளால் மறைக்கப்பட்டவை: $PAGES$ பக்க வருகைகள், $DOMAINS$ டொமைன்கள், $EDGES$ இணைப்புகள்.',
    graph_label: 'கோரிக்கைகள் அனுப்பப்பட்ட டொமைன்களுடன் இணைக்கப்பட்ட பக்க வருகைகள்',
  },
};

export function applyProGraphCopy(table, locale) {
  const copy = Object.hasOwn(COPY, locale) ? COPY[locale] : null;
  if (!copy) throw new Error('Pro graph copy: unknown locale ' + locale);
  for (const source of Object.values(ALIASES)) {
    if (!table[source] || typeof table[source].message !== 'string') {
      throw new Error('Pro graph copy: missing translation ' + source);
    }
  }
  for (const [suffix, source] of Object.entries(ALIASES)) {
    table['pro_graph_' + suffix] = structuredClone(table[source]);
  }
  for (const [suffix, message] of Object.entries(copy)) {
    table['pro_graph_' + suffix] = { message };
  }
  table.pro_graph_parties = { message: copy.domains };
  table.pro_graph_input_limited = { message: INPUT_LIMITED[locale] };
  table.pro_graph_page.placeholders = { number: { content: '$1' } };
  table.pro_graph_omitted.placeholders = {
    pages: { content: '$1' }, domains: { content: '$2' }, edges: { content: '$3' },
  };
  return table;
}
