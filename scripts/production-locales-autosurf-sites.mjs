// ADR-077: authored site-picker copy; country names use native Intl.DisplayNames.
const CONTROLS = ['title','subtitle','search','search_placeholder','country','all_countries','country_search','countries_empty','categories','all_categories','results','select_page','clear_selection','selected','add','in_plan','available','empty','empty_hint','clear_filters','previous','next','page','catalog','sources','category','check_plan'];
const FEEDBACK = ['added','duplicates','error_capacity','error_existing','error_selection'];
const CATEGORIES = ['news','automotive','gaming','shopping','classifieds','finance','government','education','sports','travel','real-estate','jobs','video','music','health','food','technology','forums','weather','reference'].map(id => 'category_' + id.replaceAll('-', '_'));
const COPY = {
  en: [
    'Find sites|Build your visit plan by country and topic.|Search sites|Name or domain|Country|All countries|Find a country|No countries found|Topics|All topics|Sites found|Select this page|Clear selection|Selected|Add to plan|In your plan|Available places|No sites match these filters|Change the filters above or clear them.|Clear filters|Previous|Next|Page|Catalog|Sources|Topic|Check the addresses in your visit plan first.',
    'Added|Already in plan|The plan can contain up to 200 sites.|Fix the addresses in your visit plan first.|Select sites again.',
    'News|Cars|Gaming|Shopping|Classifieds|Finance|Government|Education|Sports|Travel|Real estate|Jobs|Video|Music|Health|Food|Technology|Forums|Weather and maps|Reference',
  ],
  ru: [
    'Подобрать сайты|Соберите план посещений по странам и темам.|Поиск сайтов|Название или домен|Страна|Все страны|Найти страну|Страны не найдены|Темы|Все темы|Найдено сайтов|Выбрать на странице|Снять выбор|Выбрано|Добавить в план|Уже в плане|Свободно мест|По этим фильтрам сайтов нет|Измените фильтры выше или сбросьте их.|Сбросить фильтры|Назад|Далее|Страница|Каталог|Источники|Тема|Сначала проверьте адреса в плане посещений.',
    'Добавлено|Уже в плане|В плане может быть до 200 сайтов.|Сначала исправьте адреса в плане посещений.|Выберите сайты заново.',
    'Новости|Автомобили|Игры|Покупки|Объявления|Финансы|Госуслуги|Образование|Спорт|Путешествия|Недвижимость|Работа|Видео|Музыка|Здоровье|Еда|Технологии|Форумы|Погода и карты|Справочники',
  ],
  zh_CN: [
    '查找网站|按国家和主题创建访问计划。|搜索网站|名称或域名|国家|所有国家|查找国家|未找到国家|主题|所有主题|找到的网站|选择本页|清除选择|已选择|添加到计划|已在计划中|剩余名额|没有符合筛选条件的网站|请更改上方的筛选条件或清除筛选。|清除筛选|上一页|下一页|页|目录|来源|主题|请先检查访问计划中的地址。',
    '已添加|已在计划中|计划最多可包含200个网站。|请先修正访问计划中的地址。|请重新选择网站。',
    '新闻|汽车|游戏|购物|分类信息|金融|政务|教育|体育|旅游|房产|招聘|视频|音乐|健康|美食|科技|论坛|天气与地图|参考资料',
  ],
  vi: [
    'Tìm trang web|Tạo kế hoạch truy cập theo quốc gia và chủ đề.|Tìm kiếm trang web|Tên hoặc tên miền|Quốc gia|Tất cả quốc gia|Tìm quốc gia|Không tìm thấy quốc gia|Chủ đề|Tất cả chủ đề|Trang web tìm thấy|Chọn trang này|Bỏ chọn tất cả|Đã chọn|Thêm vào kế hoạch|Đã có trong kế hoạch|Số chỗ còn lại|Không có trang web phù hợp|Thay đổi các bộ lọc ở trên hoặc xóa chúng.|Xóa bộ lọc|Trước|Tiếp|Trang|Danh mục|Nguồn|Chủ đề|Hãy kiểm tra địa chỉ trong kế hoạch trước.',
    'Đã thêm|Đã có trong kế hoạch|Kế hoạch chứa tối đa 200 trang web.|Hãy sửa địa chỉ trong kế hoạch trước.|Chọn lại trang web.',
    'Tin tức|Ô tô|Trò chơi|Mua sắm|Rao vặt|Tài chính|Chính phủ|Giáo dục|Thể thao|Du lịch|Bất động sản|Việc làm|Video|Âm nhạc|Sức khỏe|Ẩm thực|Công nghệ|Diễn đàn|Thời tiết và bản đồ|Tra cứu',
  ],
  es: [
    'Buscar sitios|Crea tu plan de visitas por país y tema.|Buscar sitios|Nombre o dominio|País|Todos los países|Buscar un país|No se encontraron países|Temas|Todos los temas|Sitios encontrados|Seleccionar esta página|Quitar selección|Seleccionados|Añadir al plan|Ya está en el plan|Plazas disponibles|No hay sitios con estos filtros|Cambia los filtros de arriba o bórralos.|Borrar filtros|Anterior|Siguiente|Página|Catálogo|Fuentes|Tema|Revisa primero las direcciones del plan.',
    'Añadidos|Ya está en el plan|El plan admite hasta 200 sitios.|Corrige primero las direcciones del plan.|Selecciona los sitios de nuevo.',
    'Noticias|Automóviles|Videojuegos|Compras|Anuncios|Finanzas|Gobierno|Educación|Deportes|Viajes|Inmuebles|Empleo|Vídeo|Música|Salud|Comida|Tecnología|Foros|Tiempo y mapas|Consulta',
  ],
  ar: [
    'العثور على مواقع|أنشئ خطة الزيارات حسب البلد والموضوع.|البحث عن مواقع|الاسم أو النطاق|البلد|كل البلدان|البحث عن بلد|لم يتم العثور على بلدان|المواضيع|كل المواضيع|المواقع المطابقة|تحديد هذه الصفحة|إلغاء التحديد|المحدد|إضافة إلى الخطة|ضمن خطتك|الأماكن المتاحة|لا توجد مواقع تطابق عوامل التصفية|غيّر عوامل التصفية أعلاه أو امسحها.|مسح عوامل التصفية|السابق|التالي|الصفحة|الدليل|المصادر|الموضوع|تحقق أولًا من العناوين في خطة الزيارات.',
    'تمت الإضافة|ضمن الخطة بالفعل|يمكن أن تضم الخطة حتى 200 موقع.|صحح أولًا العناوين في خطة الزيارات.|حدد المواقع من جديد.',
    'أخبار|سيارات|ألعاب|تسوق|إعلانات مبوبة|مالية|خدمات حكومية|تعليم|رياضة|سفر|عقارات|وظائف|فيديو|موسيقى|صحة|طعام|تقنية|منتديات|طقس وخرائط|مراجع',
  ],
  uk: [
    'Підібрати сайти|Складіть план відвідувань за країнами й темами.|Пошук сайтів|Назва або домен|Країна|Усі країни|Знайти країну|Країн не знайдено|Теми|Усі теми|Знайдено сайтів|Вибрати на сторінці|Зняти вибір|Вибрано|Додати до плану|Уже в плані|Вільно місць|За цими фільтрами сайтів немає|Змініть фільтри вище або скиньте їх.|Скинути фільтри|Назад|Далі|Сторінка|Каталог|Джерела|Тема|Спочатку перевірте адреси в плані відвідувань.',
    'Додано|Уже в плані|План може містити до 200 сайтів.|Спочатку виправте адреси в плані відвідувань.|Виберіть сайти знову.',
    'Новини|Автомобілі|Ігри|Покупки|Оголошення|Фінанси|Держпослуги|Освіта|Спорт|Подорожі|Нерухомість|Робота|Відео|Музика|Здоров’я|Їжа|Технології|Форуми|Погода й карти|Довідники',
  ],
  fr: [
    'Trouver des sites|Composez vos visites par pays et par thème.|Rechercher des sites|Nom ou domaine|Pays|Tous les pays|Rechercher un pays|Aucun pays trouvé|Thèmes|Tous les thèmes|Sites trouvés|Sélectionner cette page|Effacer la sélection|Sélectionnés|Ajouter au programme|Déjà au programme|Places disponibles|Aucun site ne correspond aux filtres|Modifiez les filtres ci-dessus ou effacez-les.|Effacer les filtres|Précédent|Suivant|Page|Catalogue|Sources|Thème|Vérifiez d’abord les adresses du programme.',
    'Ajoutés|Déjà au programme|Le programme peut contenir jusqu’à 200 sites.|Corrigez d’abord les adresses du programme.|Sélectionnez les sites à nouveau.',
    'Actualités|Automobile|Jeux vidéo|Shopping|Petites annonces|Finance|Services publics|Éducation|Sport|Voyages|Immobilier|Emploi|Vidéo|Musique|Santé|Cuisine|Technologie|Forums|Météo et cartes|Références',
  ],
  pt_BR: [
    'Encontrar sites|Monte seu plano de visitas por país e tema.|Pesquisar sites|Nome ou domínio|País|Todos os países|Encontrar um país|Nenhum país encontrado|Temas|Todos os temas|Sites encontrados|Selecionar esta página|Limpar seleção|Selecionados|Adicionar ao plano|Já está no plano|Vagas disponíveis|Nenhum site corresponde aos filtros|Altere os filtros acima ou limpe-os.|Limpar filtros|Anterior|Próxima|Página|Catálogo|Fontes|Tema|Verifique primeiro os endereços do plano.',
    'Adicionados|Já está no plano|O plano pode conter até 200 sites.|Corrija primeiro os endereços do plano.|Selecione os sites novamente.',
    'Notícias|Automóveis|Jogos|Compras|Classificados|Finanças|Governo|Educação|Esportes|Viagens|Imóveis|Empregos|Vídeos|Música|Saúde|Comida|Tecnologia|Fóruns|Clima e mapas|Referências',
  ],
  hi: [
    'साइटें खोजें|देश और विषय के अनुसार यात्रा योजना बनाएँ।|साइटें खोजें|नाम या डोमेन|देश|सभी देश|देश खोजें|कोई देश नहीं मिला|विषय|सभी विषय|मिली साइटें|इस पेज को चुनें|चयन हटाएँ|चुने गए|योजना में जोड़ें|योजना में मौजूद|खाली स्थान|इन फ़िल्टर से कोई साइट नहीं मिली|ऊपर दिए गए फ़िल्टर बदलें या हटाएँ।|फ़िल्टर हटाएँ|पिछला|अगला|पेज|सूची|स्रोत|विषय|पहले यात्रा योजना के पतों की जाँच करें।',
    'जोड़े गए|योजना में पहले से मौजूद|योजना में अधिकतम 200 साइटें हो सकती हैं।|पहले यात्रा योजना के पते ठीक करें।|साइटें फिर से चुनें।',
    'समाचार|कारें|गेमिंग|खरीदारी|विज्ञापन|वित्त|सरकारी सेवाएँ|शिक्षा|खेल|यात्रा|संपत्ति|नौकरियाँ|वीडियो|संगीत|स्वास्थ्य|भोजन|तकनीक|फ़ोरम|मौसम और नक्शे|संदर्भ',
  ],
  ur: [
    'سائٹس تلاش کریں|ملک اور موضوع کے لحاظ سے دوروں کا منصوبہ بنائیں۔|سائٹس تلاش کریں|نام یا ڈومین|ملک|تمام ممالک|ملک تلاش کریں|کوئی ملک نہیں ملا|موضوعات|تمام موضوعات|ملنے والی سائٹس|اس صفحے کو منتخب کریں|انتخاب صاف کریں|منتخب|منصوبے میں شامل کریں|منصوبے میں موجود|دستیاب جگہیں|ان فلٹرز سے کوئی سائٹ نہیں ملی|اوپر دیے گئے فلٹرز بدلیں یا صاف کریں۔|فلٹر صاف کریں|پچھلا|اگلا|صفحہ|فہرست|ذرائع|موضوع|پہلے دوروں کے منصوبے میں پتے جانچیں۔',
    'شامل کیے گئے|منصوبے میں پہلے سے موجود|منصوبے میں زیادہ سے زیادہ 200 سائٹس ہو سکتی ہیں۔|پہلے دوروں کے منصوبے میں پتے درست کریں۔|سائٹس دوبارہ منتخب کریں۔',
    'خبریں|گاڑیاں|گیمنگ|خریداری|اشتہارات|مالیات|سرکاری خدمات|تعلیم|کھیل|سفر|جائیداد|ملازمتیں|ویڈیو|موسیقی|صحت|کھانا|ٹیکنالوجی|فورمز|موسم اور نقشے|حوالہ جات',
  ],
  ja: [
    'サイトを探す|国とテーマから訪問プランを作成します。|サイトを検索|名前またはドメイン|国|すべての国|国を検索|国が見つかりません|テーマ|すべてのテーマ|見つかったサイト|このページを選択|選択を解除|選択済み|プランに追加|プランに追加済み|残りの枠|条件に一致するサイトはありません|上のフィルターを変更するか、解除してください。|条件をクリア|前へ|次へ|ページ|カタログ|出典|テーマ|先に訪問プランのアドレスを確認してください。',
    '追加済み|プランに追加済み|プランには最大200サイトまで追加できます。|先に訪問プランのアドレスを修正してください。|サイトを選び直してください。',
    'ニュース|自動車|ゲーム|ショッピング|掲示広告|金融|行政サービス|教育|スポーツ|旅行|不動産|求人|動画|音楽|健康|グルメ|テクノロジー|フォーラム|天気・地図|資料',
  ],
  de: [
    'Websites finden|Stelle deinen Besuchsplan nach Land und Thema zusammen.|Websites suchen|Name oder Domain|Land|Alle Länder|Land suchen|Keine Länder gefunden|Themen|Alle Themen|Gefundene Websites|Diese Seite auswählen|Auswahl aufheben|Ausgewählt|Zum Plan hinzufügen|Bereits im Plan|Freie Plätze|Keine Websites für diese Filter|Ändere die Filter oben oder setze sie zurück.|Filter zurücksetzen|Zurück|Weiter|Seite|Katalog|Quellen|Thema|Prüfe zuerst die Adressen im Besuchsplan.',
    'Hinzugefügt|Bereits im Plan|Der Plan kann bis zu 200 Websites enthalten.|Korrigiere zuerst die Adressen im Besuchsplan.|Wähle die Websites erneut aus.',
    'Nachrichten|Autos|Gaming|Shopping|Kleinanzeigen|Finanzen|Behörden|Bildung|Sport|Reisen|Immobilien|Jobs|Videos|Musik|Gesundheit|Essen|Technologie|Foren|Wetter und Karten|Nachschlagen',
  ],
  pl: [
    'Znajdź strony|Ułóż plan odwiedzin według kraju i tematu.|Szukaj stron|Nazwa lub domena|Kraj|Wszystkie kraje|Znajdź kraj|Nie znaleziono krajów|Tematy|Wszystkie tematy|Znalezione strony|Wybierz tę stronę|Wyczyść wybór|Wybrano|Dodaj do planu|Już w planie|Wolne miejsca|Brak stron pasujących do filtrów|Zmień powyższe filtry lub je wyczyść.|Wyczyść filtry|Wstecz|Dalej|Strona|Katalog|Źródła|Temat|Najpierw sprawdź adresy w planie odwiedzin.',
    'Dodano|Już w planie|Plan może zawierać do 200 stron.|Najpierw popraw adresy w planie odwiedzin.|Wybierz strony ponownie.',
    'Wiadomości|Samochody|Gry|Zakupy|Ogłoszenia|Finanse|Urząd|Edukacja|Sport|Podróże|Nieruchomości|Praca|Wideo|Muzyka|Zdrowie|Jedzenie|Technologia|Fora|Pogoda i mapy|Źródła wiedzy',
  ],
  id: [
    'Cari situs|Susun rencana kunjungan menurut negara dan topik.|Cari situs|Nama atau domain|Negara|Semua negara|Cari negara|Negara tidak ditemukan|Topik|Semua topik|Situs ditemukan|Pilih halaman ini|Hapus pilihan|Dipilih|Tambahkan ke rencana|Sudah dalam rencana|Tempat tersedia|Tidak ada situs yang cocok|Ubah filter di atas atau hapus semuanya.|Hapus filter|Sebelumnya|Berikutnya|Halaman|Katalog|Sumber|Topik|Periksa alamat dalam rencana kunjungan terlebih dahulu.',
    'Ditambahkan|Sudah dalam rencana|Rencana dapat berisi hingga 200 situs.|Perbaiki alamat dalam rencana kunjungan terlebih dahulu.|Pilih situs lagi.',
    'Berita|Otomotif|Gim|Belanja|Iklan baris|Keuangan|Pemerintahan|Pendidikan|Olahraga|Perjalanan|Properti|Lowongan kerja|Video|Musik|Kesehatan|Makanan|Teknologi|Forum|Cuaca dan peta|Referensi',
  ],
  mr: [
    'साइट शोधा|देश आणि विषयानुसार भेटींची योजना तयार करा.|साइट शोधा|नाव किंवा डोमेन|देश|सर्व देश|देश शोधा|कोणताही देश सापडला नाही|विषय|सर्व विषय|सापडलेल्या साइट|हे पृष्ठ निवडा|निवड साफ करा|निवडलेले|योजनेत जोडा|योजनेत आधीच आहे|उपलब्ध जागा|या फिल्टरनुसार साइट नाहीत|वरील फिल्टर बदला किंवा साफ करा.|फिल्टर साफ करा|मागील|पुढील|पृष्ठ|यादी|स्रोत|विषय|आधी भेटींच्या योजनेतील पत्ते तपासा.',
    'जोडलेले|योजनेत आधीच आहे|योजनेत जास्तीत जास्त 200 साइट असू शकतात.|आधी भेटींच्या योजनेतील पत्ते दुरुस्त करा.|साइट पुन्हा निवडा.',
    'बातम्या|गाड्या|गेमिंग|खरेदी|जाहिराती|वित्त|सरकारी सेवा|शिक्षण|क्रीडा|प्रवास|मालमत्ता|नोकऱ्या|व्हिडिओ|संगीत|आरोग्य|अन्न|तंत्रज्ञान|मंच|हवामान आणि नकाशे|संदर्भ',
  ],
  te: [
    'సైట్‌లను కనుగొనండి|దేశం మరియు అంశం ఆధారంగా సందర్శన ప్రణాళికను రూపొందించండి.|సైట్‌లను వెతకండి|పేరు లేదా డొమైన్|దేశం|అన్ని దేశాలు|దేశాన్ని వెతకండి|దేశాలు కనుగొనబడలేదు|అంశాలు|అన్ని అంశాలు|కనుగొన్న సైట్‌లు|ఈ పేజీని ఎంచుకోండి|ఎంపికను తీసివేయండి|ఎంచుకున్నవి|ప్రణాళికకు జోడించండి|ప్రణాళికలో ఉంది|ఖాళీ స్థానాలు|ఈ ఫిల్టర్‌లకు సరిపోయే సైట్‌లు లేవు|పై ఫిల్టర్‌లను మార్చండి లేదా తీసివేయండి.|ఫిల్టర్‌లను తొలగించండి|మునుపటి|తదుపరి|పేజీ|జాబితా|మూలాలు|అంశం|ముందుగా సందర్శన ప్రణాళికలో చిరునామాలను తనిఖీ చేయండి.',
    'జోడించినవి|ప్రణాళికలో ఇప్పటికే ఉంది|ప్రణాళికలో గరిష్ఠంగా 200 సైట్‌లు ఉండవచ్చు.|ముందుగా ప్రణాళికలో చిరునామాలను సరిచేయండి.|సైట్‌లను మళ్లీ ఎంచుకోండి.',
    'వార్తలు|కార్లు|గేమింగ్|షాపింగ్|ప్రకటనలు|ఆర్థికం|ప్రభుత్వ సేవలు|విద్య|క్రీడలు|ప్రయాణం|స్థిరాస్తి|ఉద్యోగాలు|వీడియో|సంగీతం|ఆరోగ్యం|ఆహారం|సాంకేతికత|ఫోరమ్‌లు|వాతావరణం మరియు మ్యాప్‌లు|సూచికలు',
  ],
  ko: [
    '사이트 찾기|국가와 주제별로 방문 계획을 만드세요.|사이트 검색|이름 또는 도메인|국가|모든 국가|국가 검색|국가를 찾을 수 없음|주제|모든 주제|검색된 사이트|이 페이지 선택|선택 해제|선택됨|계획에 추가|이미 계획에 있음|남은 자리|조건에 맞는 사이트가 없습니다|위의 필터를 변경하거나 지우세요.|필터 초기화|이전|다음|페이지|카탈로그|출처|주제|먼저 방문 계획의 주소를 확인하세요.',
    '추가됨|이미 계획에 있음|계획에는 최대200개 사이트를 담을 수 있습니다.|먼저 방문 계획의 주소를 수정하세요.|사이트를 다시 선택하세요.',
    '뉴스|자동차|게임|쇼핑|벼룩시장|금융|공공서비스|교육|스포츠|여행|부동산|채용|동영상|음악|건강|음식|기술|포럼|날씨와 지도|참고자료',
  ],
  ta: [
    'தளங்களைக் கண்டறியுங்கள்|நாடு மற்றும் தலைப்பின் அடிப்படையில் வருகைத் திட்டத்தை உருவாக்குங்கள்.|தளங்களைத் தேடுங்கள்|பெயர் அல்லது டொமைன்|நாடு|எல்லா நாடுகளும்|நாட்டைத் தேடுங்கள்|நாடுகள் எதுவும் இல்லை|தலைப்புகள்|எல்லா தலைப்புகளும்|கிடைத்த தளங்கள்|இந்தப் பக்கத்தைத் தேர்ந்தெடு|தேர்வை நீக்கு|தேர்ந்தெடுத்தவை|திட்டத்தில் சேர்|ஏற்கனவே திட்டத்தில் உள்ளது|மீதமுள்ள இடங்கள்|இந்த வடிப்பான்களுக்கு ஏற்ற தளங்கள் இல்லை|மேலுள்ள வடிகட்டிகளை மாற்றவும் அல்லது நீக்கவும்.|வடிப்பான்களை நீக்கு|முந்தையது|அடுத்தது|பக்கம்|பட்டியல்|ஆதாரங்கள்|தலைப்பு|முதலில் வருகைத் திட்டத்தில் உள்ள முகவரிகளைச் சரிபார்க்கவும்.',
    'சேர்க்கப்பட்டவை|ஏற்கனவே திட்டத்தில் உள்ளது|திட்டத்தில் அதிகபட்சம்200தளங்கள் இருக்கலாம்.|முதலில் திட்டத்தில் உள்ள முகவரிகளைச் சரிசெய்யவும்.|தளங்களை மீண்டும் தேர்ந்தெடுக்கவும்.',
    'செய்திகள்|கார்கள்|விளையாட்டுகள்|ஷாப்பிங்|வகை விளம்பரங்கள்|நிதி|அரசுச் சேவைகள்|கல்வி|விளையாட்டு|பயணம்|சொத்துகள்|வேலைவாய்ப்புகள்|வீடியோ|இசை|ஆரோக்கியம்|உணவு|தொழில்நுட்பம்|மன்றங்கள்|வானிலை மற்றும் வரைபடங்கள்|குறிப்புகள்',
  ],
  yue: [
    '搵网站|按国家同主题安排访问计划。|搵网站|名称或者域名|国家|所有国家|搵国家|搵唔到国家|主题|所有主题|搵到嘅网站|拣呢一页|取消选择|已拣|加到计划|已经喺计划入面|剩余名额|冇网站符合筛选条件|更改上面嘅篩選條件，或者清除篩選。|清除筛选|上一页|下一页|页|目录|来源|主题|请先检查访问计划入面嘅网址。',
    '已加入|已经喺计划入面|计划最多可以有200个网站。|请先改正访问计划入面嘅网址。|请重新拣网站。',
    '新闻|汽车|游戏|网上购物|分类广告|财经|政府服务|教育|体育|旅游|楼盘|搵工|影片|音乐|健康|饮食|科技|讨论区|天气同地图|参考资料',
  ],
  wuu: [
    '寻网站|照国家搭主题安排访问计划。|搜网站|名称或域名|国家|全部国家|寻国家|没寻着国家|主题|全部主题|寻着的网站|选这一页|清除选择|已选|加到计划里|已经在计划里|剩下名额|没网站符合筛选条件|改一改上头个筛选条件，或者清除筛选。|清除筛选|上一页|下一页|页|目录|来源|主题|请先检查访问计划里向的网址。',
    '已加好|已经在计划里|计划最多可以有200个网站。|请先改正访问计划里向的网址。|请重新选网站。',
    '新闻|汽车|游戏|购物|分类信息|金融|政务|教育|体育|旅游|房产|招聘|视频|音乐|健康|美食|科技|论坛|天气搭地图|参考资料',
  ],
};
const GROUPS = [CONTROLS, FEEDBACK, CATEGORIES];
const UNAVAILABLE = {
  en: 'Adding sites is unavailable right now.', ru: 'Добавление сайтов сейчас недоступно.',
  zh_CN: '目前无法添加网站。', vi: 'Hiện chưa thể thêm trang web.', es: 'Ahora no se pueden añadir sitios.',
  ar: 'إضافة المواقع غير متاحة حاليًا.', uk: 'Додавання сайтів зараз недоступне.', fr: 'L’ajout de sites est indisponible pour le moment.',
  pt_BR: 'Não é possível adicionar sites agora.', hi: 'अभी साइटें जोड़ना उपलब्ध नहीं है।', ur: 'ابھی سائٹس شامل کرنا دستیاب نہیں ہے۔',
  ja: '現在サイトを追加できません。', de: 'Websites können gerade nicht hinzugefügt werden.', pl: 'Dodawanie stron jest teraz niedostępne.',
  id: 'Penambahan situs belum tersedia saat ini.', mr: 'सध्या साइट जोडता येत नाहीत.', te: 'ప్రస్తుతం సైట్‌లను జోడించలేరు.',
  ko: '지금은 사이트를 추가할 수 없습니다.', ta: 'இப்போது தளங்களைச் சேர்க்க முடியாது.', yue: '而家未可以加网站。', wuu: '现在还弗能加网站。',
};
const SYSTEM_KEYS = ['tracking_systems', 'all_systems', 'system_search', 'systems_empty', 'show_all_systems', 'show_fewer_systems', 'uncategorized'];
const SYSTEM_COPY = {
  en: 'Categories|All categories|Tracking systems|All systems|Find a system|No systems found|Show all systems|Show fewer systems|Other sites',
  ru: 'Категории|Все категории|Трекинг-системы|Все системы|Найти систему|Системы не найдены|Показать все системы|Свернуть список|Другие сайты',
  zh_CN: '分类|所有分类|跟踪系统|所有系统|查找系统|未找到系统|显示所有系统|收起列表|其他网站',
  vi: 'Danh mục|Tất cả danh mục|Hệ thống theo dõi|Tất cả hệ thống|Tìm hệ thống|Không tìm thấy hệ thống|Hiện tất cả hệ thống|Thu gọn danh sách|Trang web khác',
  es: 'Categorías|Todas las categorías|Sistemas de seguimiento|Todos los sistemas|Buscar un sistema|No se encontraron sistemas|Mostrar todos los sistemas|Mostrar menos sistemas|Otros sitios',
  ar: 'الفئات|كل الفئات|أنظمة التتبع|كل الأنظمة|البحث عن نظام|لم يتم العثور على أنظمة|عرض كل الأنظمة|طي القائمة|مواقع أخرى',
  uk: 'Категорії|Усі категорії|Системи відстеження|Усі системи|Знайти систему|Систем не знайдено|Показати всі системи|Згорнути список|Інші сайти',
  fr: 'Catégories|Toutes les catégories|Systèmes de suivi|Tous les systèmes|Rechercher un système|Aucun système trouvé|Afficher tous les systèmes|Réduire la liste|Autres sites',
  pt_BR: 'Categorias|Todas as categorias|Sistemas de rastreamento|Todos os sistemas|Encontrar um sistema|Nenhum sistema encontrado|Mostrar todos os sistemas|Recolher lista|Outros sites',
  hi: 'श्रेणियाँ|सभी श्रेणियाँ|ट्रैकिंग सिस्टम|सभी सिस्टम|सिस्टम खोजें|कोई सिस्टम नहीं मिला|सभी सिस्टम दिखाएँ|सूची समेटें|अन्य साइटें',
  ur: 'زمرے|تمام زمرے|ٹریکنگ سسٹمز|تمام سسٹمز|سسٹم تلاش کریں|کوئی سسٹم نہیں ملا|تمام سسٹمز دکھائیں|فہرست سمیٹیں|دیگر سائٹس',
  ja: 'カテゴリー|すべてのカテゴリー|トラッキングシステム|すべてのシステム|システムを検索|システムが見つかりません|すべてのシステムを表示|一覧を折りたたむ|その他のサイト',
  de: 'Kategorien|Alle Kategorien|Tracking-Systeme|Alle Systeme|System suchen|Keine Systeme gefunden|Alle Systeme anzeigen|Liste einklappen|Weitere Websites',
  pl: 'Kategorie|Wszystkie kategorie|Systemy śledzenia|Wszystkie systemy|Znajdź system|Nie znaleziono systemów|Pokaż wszystkie systemy|Zwiń listę|Inne strony',
  id: 'Kategori|Semua kategori|Sistem pelacakan|Semua sistem|Cari sistem|Sistem tidak ditemukan|Tampilkan semua sistem|Ciutkan daftar|Situs lainnya',
  mr: 'वर्ग|सर्व वर्ग|ट्रॅकिंग प्रणाली|सर्व प्रणाली|प्रणाली शोधा|प्रणाली आढळल्या नाहीत|सर्व प्रणाली दाखवा|यादी संक्षिप्त करा|इतर साइट',
  te: 'వర్గాలు|అన్ని వర్గాలు|ట్రాకింగ్ వ్యవస్థలు|అన్ని వ్యవస్థలు|వ్యవస్థను వెతకండి|వ్యవస్థలు కనుగొనబడలేదు|అన్ని వ్యవస్థలను చూపండి|జాబితాను కుదించండి|ఇతర సైట్లు',
  ko: '카테고리|모든 카테고리|추적 시스템|모든 시스템|시스템 찾기|시스템을 찾을 수 없습니다|모든 시스템 표시|목록 접기|기타 사이트',
  ta: 'வகைகள்|அனைத்து வகைகள்|கண்காணிப்பு அமைப்புகள்|அனைத்து அமைப்புகள்|அமைப்பைத் தேடுக|அமைப்புகள் இல்லை|அனைத்து அமைப்புகளையும் காட்டு|பட்டியலைச் சுருக்கு|மற்ற தளங்கள்',
  yue: '分類|所有分類|追蹤系統|所有系統|搵系統|搵唔到系統|顯示所有系統|收起清單|其他網站',
  wuu: '分类|全部分类|跟踪系统|全部系统|寻系统|没寻着系统|显示全部系统|收起列表|其他网站',
};
const CATALOG_TITLE = {
  en: 'Systems in the catalog', ru: 'Системы из каталога', zh_CN: '目录中的系统', vi: 'Hệ thống trong danh mục', es: 'Sistemas del catálogo', ar: 'الأنظمة في الدليل', uk: 'Системи з каталогу', fr: 'Systèmes du catalogue', pt_BR: 'Sistemas do catálogo', hi: 'सूची में मौजूद सिस्टम', ur: 'فہرست میں موجود سسٹمز', ja: 'カタログのシステム', de: 'Systeme im Katalog', pl: 'Systemy w katalogu', id: 'Sistem dalam katalog', mr: 'सूचीतील प्रणाली', te: 'కేటలాగ్‌లోని వ్యవస్థలు', ko: '카탈로그의 시스템', ta: 'பட்டியலில் உள்ள அமைப்புகள்', yue: '目錄入面嘅系統', wuu: '目录里向个系统',
};
const SYSTEM_CATEGORY_KEYS = ['system_categories', 'all_system_categories', 'system_category_fraud_prevention', 'system_category_bot_management', 'system_category_ecommerce_intelligence', 'system_category_device_fingerprinting', 'system_category_bot_detection', 'system_category_captcha'];
const SYSTEM_CATEGORY_COPY = {
  en: 'System categories|All categories|Fraud prevention|Bot management|eCommerce analytics|Device fingerprinting|Bot detection|CAPTCHA',
  ru: 'Категории систем|Все категории|Антифрод|Управление ботами|eCommerce-аналитика|Отпечатки устройств|Обнаружение ботов|CAPTCHA',
  zh_CN: '系统分类|所有分类|欺诈防范|机器人管理|电商分析|设备指纹|机器人检测|验证码',
  vi: 'Danh mục hệ thống|Tất cả danh mục|Phòng chống gian lận|Quản lý bot|Phân tích thương mại điện tử|Dấu vân tay thiết bị|Phát hiện bot|CAPTCHA',
  es: 'Categorías de sistemas|Todas las categorías|Prevención del fraude|Gestión de bots|Analítica de comercio electrónico|Huella digital del dispositivo|Detección de bots|CAPTCHA',
  ar: 'فئات الأنظمة|كل الفئات|منع الاحتيال|إدارة الروبوتات|تحليلات التجارة الإلكترونية|بصمات الأجهزة|اكتشاف الروبوتات|CAPTCHA',
  uk: 'Категорії систем|Усі категорії|Протидія шахрайству|Керування ботами|Аналітика електронної комерції|Відбитки пристроїв|Виявлення ботів|CAPTCHA',
  fr: 'Catégories de systèmes|Toutes les catégories|Prévention de la fraude|Gestion des bots|Analyse du commerce électronique|Empreinte des appareils|Détection des bots|CAPTCHA',
  pt_BR: 'Categorias de sistemas|Todas as categorias|Prevenção de fraudes|Gerenciamento de bots|Análise de comércio eletrônico|Impressão digital do dispositivo|Detecção de bots|CAPTCHA',
  hi: 'सिस्टम श्रेणियाँ|सभी श्रेणियाँ|धोखाधड़ी की रोकथाम|बॉट प्रबंधन|ई-कॉमर्स विश्लेषण|डिवाइस फ़िंगरप्रिंटिंग|बॉट पहचान|कैप्चा',
  ur: 'سسٹمز کے زمرے|تمام زمرے|دھوکہ دہی کی روک تھام|بوٹس کا انتظام|ای کامرس تجزیات|ڈیوائس فنگرپرنٹنگ|بوٹس کی شناخت|کیپچا',
  ja: 'システムカテゴリー|すべてのカテゴリー|不正対策|ボット管理|EC分析|デバイスフィンガープリント|ボット検出|CAPTCHA',
  de: 'Systemkategorien|Alle Kategorien|Betrugsprävention|Bot-Verwaltung|E-Commerce-Analyse|Geräte-Fingerprinting|Bot-Erkennung|CAPTCHA',
  pl: 'Kategorie systemów|Wszystkie kategorie|Zapobieganie oszustwom|Zarządzanie botami|Analityka e-commerce|Odcisk urządzenia|Wykrywanie botów|CAPTCHA',
  id: 'Kategori sistem|Semua kategori|Pencegahan penipuan|Pengelolaan bot|Analisis perdagangan elektronik|Sidik jari perangkat|Deteksi bot|CAPTCHA',
  mr: 'प्रणालींचे वर्ग|सर्व वर्ग|फसवणूक प्रतिबंध|बॉट व्यवस्थापन|ई-कॉमर्स विश्लेषण|डिव्हाइस फिंगरप्रिंटिंग|बॉट शोध|कॅप्चा',
  te: 'వ్యవస్థల వర్గాలు|అన్ని వర్గాలు|మోసాల నివారణ|బాట్ నిర్వహణ|ఇ-కామర్స్ విశ్లేషణ|పరికర వేలిముద్ర|బాట్ గుర్తింపు|క్యాప్చా',
  ko: '시스템 카테고리|모든 카테고리|사기 방지|봇 관리|전자상거래 분석|기기 핑거프린팅|봇 탐지|CAPTCHA',
  ta: 'அமைப்பு வகைகள்|அனைத்து வகைகள்|மோசடி தடுப்பு|பாட் மேலாண்மை|மின்னணு வணிகப் பகுப்பாய்வு|சாதனக் கைரேகை|பாட் கண்டறிதல்|கேப்ட்சா',
  yue: '系統分類|所有分類|防範欺詐|機械人管理|電子商務分析|裝置指紋|機械人偵測|驗證碼',
  wuu: '系统分类|全部分类|防范欺诈|机器人管理|电子商务分析|设备指纹|机器人检测|验证码',
};
const ACTIVE_FILTER_KEYS = ['active_filters', 'clear_all_filters', 'remove_filter', 'any_selected_system', 'selected_systems'];
const ACTIVE_FILTER_COPY = {
  en: 'Active filters|Clear all|Remove filter|Sites with any selected system|Selected systems',
  ru: 'Активные фильтры|Сбросить все|Убрать фильтр|Сайты с любой выбранной системой|Выбрано систем',
  zh_CN: '当前筛选|全部清除|移除筛选|使用任一所选系统的网站|已选系统',
  vi: 'Bộ lọc đang áp dụng|Xóa tất cả|Xóa bộ lọc|Trang web có bất kỳ hệ thống đã chọn nào|Hệ thống đã chọn',
  es: 'Filtros activos|Borrar todo|Quitar filtro|Sitios con cualquiera de los sistemas seleccionados|Sistemas seleccionados',
  ar: 'عوامل التصفية النشطة|مسح الكل|إزالة عامل التصفية|مواقع تستخدم أي نظام محدد|الأنظمة المحددة',
  uk: 'Активні фільтри|Скинути всі|Прибрати фільтр|Сайти з будь-якою вибраною системою|Вибрано систем',
  fr: 'Filtres actifs|Tout effacer|Retirer le filtre|Sites utilisant au moins un système sélectionné|Systèmes sélectionnés',
  pt_BR: 'Filtros ativos|Limpar tudo|Remover filtro|Sites com qualquer sistema selecionado|Sistemas selecionados',
  hi: 'सक्रिय फ़िल्टर|सभी हटाएँ|फ़िल्टर हटाएँ|किसी भी चुने हुए सिस्टम वाली साइटें|चुने हुए सिस्टम',
  ur: 'فعال فلٹرز|سب صاف کریں|فلٹر ہٹائیں|کسی بھی منتخب سسٹم والی سائٹس|منتخب سسٹمز',
  ja: '適用中のフィルター|すべて解除|フィルターを解除|選択したいずれかのシステムを使用するサイト|選択中のシステム',
  de: 'Aktive Filter|Alle zurücksetzen|Filter entfernen|Websites mit mindestens einem ausgewählten System|Ausgewählte Systeme',
  pl: 'Aktywne filtry|Wyczyść wszystkie|Usuń filtr|Strony z dowolnym wybranym systemem|Wybrane systemy',
  id: 'Filter aktif|Hapus semua|Hapus filter|Situs dengan salah satu sistem yang dipilih|Sistem yang dipilih',
  mr: 'सक्रिय फिल्टर|सर्व साफ करा|फिल्टर काढा|निवडलेल्या कोणत्याही प्रणालीच्या साइट|निवडलेल्या प्रणाली',
  te: 'సక్రియ ఫిల్టర్‌లు|అన్నీ తీసివేయండి|ఫిల్టర్‌ను తీసివేయండి|ఎంచుకున్న వ్యవస్థల్లో ఏదైనా ఉన్న సైట్‌లు|ఎంచుకున్న వ్యవస్థలు',
  ko: '적용 중인 필터|모두 지우기|필터 제거|선택한 시스템 중 하나 이상을 사용하는 사이트|선택한 시스템',
  ta: 'செயலில் உள்ள வடிகட்டிகள்|அனைத்தையும் நீக்கு|வடிகட்டியை நீக்கு|தேர்ந்தெடுத்த அமைப்புகளில் ஏதேனும் ஒன்றுள்ள தளங்கள்|தேர்ந்தெடுத்த அமைப்புகள்',
  yue: '使用中嘅篩選|全部清除|移除篩選|使用任何已選系統嘅網站|已選系統',
  wuu: '使用中个筛选|全部清除|移除筛选|使用任意已选系统个网站|已选系统',
};
export const AUTOSURF_SITES_UI_KEYS = Object.freeze([...GROUPS.flat().map(key => 'autosurf_sites_' + key), ...SYSTEM_KEYS.map(key => 'autosurf_sites_' + key), ...SYSTEM_CATEGORY_KEYS.map(key => 'autosurf_sites_' + key), ...ACTIVE_FILTER_KEYS.map(key => 'autosurf_sites_' + key), 'autosurf_sites_systems_catalog_title', 'autosurf_sites_error_unavailable']);
export const AUTOSURF_SITES_UI_MESSAGES = Object.freeze(Object.fromEntries(Object.entries(COPY).map(([language, groups]) => {
  const entries = groups.flatMap((group, index) => {
    const values = group.split('|');
    if (values.length !== GROUPS[index].length) throw Error('Site picker locale mismatch: ' + language + '/' + index);
    return GROUPS[index].map((key, item) => ['autosurf_sites_' + key, values[item]]);
  });
  entries.push(['autosurf_sites_error_unavailable', UNAVAILABLE[language]]);
  entries.push(['autosurf_sites_systems_catalog_title', CATALOG_TITLE[language]]);
  const systemValues = SYSTEM_COPY[language]?.split('|');
  if (systemValues?.length !== SYSTEM_KEYS.length + 2) throw Error('Site picker system locale mismatch: ' + language);
  entries.push(['autosurf_sites_categories', systemValues[0]], ['autosurf_sites_all_categories', systemValues[1]], ...SYSTEM_KEYS.map((key, index) => ['autosurf_sites_' + key, systemValues[index + 2]]));
  const systemCategoryValues = SYSTEM_CATEGORY_COPY[language]?.split('|');
  if (systemCategoryValues?.length !== SYSTEM_CATEGORY_KEYS.length) throw Error('Site picker system category locale mismatch: ' + language);
  entries.push(...SYSTEM_CATEGORY_KEYS.map((key, index) => ['autosurf_sites_' + key, systemCategoryValues[index]]));
  const activeFilterValues = ACTIVE_FILTER_COPY[language]?.split('|');
  if (activeFilterValues?.length !== ACTIVE_FILTER_KEYS.length) throw Error('Site picker active filter locale mismatch: ' + language);
  entries.push(...ACTIVE_FILTER_KEYS.map((key, index) => ['autosurf_sites_' + key, activeFilterValues[index]]));
  return [language, Object.freeze(Object.fromEntries(entries))];
})));
export function applyAutosurfSitesCopy(table, language) {
  const copy = AUTOSURF_SITES_UI_MESSAGES[language];
  if (!copy) throw Error('Unknown site picker locale: ' + language);
  for (const [key, message] of Object.entries(copy)) table[key] = { message };
}
