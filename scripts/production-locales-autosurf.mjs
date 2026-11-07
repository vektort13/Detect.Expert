// ADR-075: authored Autosurfer UI copy for every production locale.
const GROUPS = [
  ['title','subtitle','settings','urls','urls_help','sample','cycles','depth','seed','order','sequential','shuffle','duration','dwell_min','dwell_max','gap_min','gap_max','scroll','hover','metrics','grant_metrics'],
  ['start','stop','discard','dirty','status','progress','current','phase','elapsed','remaining','results','no_results','preview','close','download','interrupted'],
  ['status_idle','status_running','status_paused','status_completed','status_stopped','status_error','phase_opening','phase_navigating','phase_settling','phase_interacting','phase_gap'],
  ['metrics_title','system_cpu','system_ram','renderer_heap','renderer_task','gpu','unavailable','sample_time','chrome_required','invalid_url','duplicate_url','invalid_range','line'],
  ['reason_challenge','reason_http403','reason_http429','reason_tab_closed','reason_foreground','reason_navigation','reason_debugger','reason_restored','reason_limit','reason_clock'],
];
const COPY = {
  en: [
    'Autosurfer|Scheduled site visits and local resource measurements|Visit plan|Website URLs|HTTP(S), one URL per line. Up to 200 addresses.|Sample size (0 = all)|Cycles|Internal navigation depth|Seed|Visit order|In list order|Shuffle|Run limit, minutes|Minimum page time, seconds|Maximum page time, seconds|Minimum gap, seconds|Maximum gap, seconds|Scroll pages|Move and hover the pointer|Record resource measurements|Allow system CPU and RAM measurements',
    'Start|Stop|Discard changes|Unsaved changes|Run status|Progress|Website|Phase|Elapsed|Step remaining|Visit results|No completed visits yet.|Preview|Close|Download|Interrupted',
    'Ready|Running|Paused|Completed|Stopped|Error|Opening a tab|Loading page|Settling|Browsing|Between visits',
    'Resource measurements|System CPU|System RAM used|Renderer JS heap|Renderer task time, cumulative|GPU utilisation|Unavailable|Sample time|Running the Autosurfer requires Chrome with debugger access.|Enter a valid HTTP(S) URL.|This URL is already in the list.|Check the value and minimum/maximum bounds.|Line',
    'The site presented a challenge. The run is paused.|The site returned HTTP 403. The run is paused.|The site returned HTTP 429. The run is paused.|The working tab is no longer available.|The working window lost focus.|Navigation changed or did not complete.|The browser debugger disconnected.|A previous run was restored in a paused state.|The configured run or result limit was reached.|The system clock changed. The run is paused.',
  ],
  ru: [
    'Автосерфер|Посещения сайтов по плану и локальные замеры нагрузки|План посещений|Адреса сайтов|HTTP(S), по одному адресу в строке. До 200 адресов.|Размер выборки (0 = все)|Количество циклов|Глубина внутренних переходов|Seed|Порядок посещений|По порядку списка|Перемешать|Лимит прогона, минуты|Минимум на странице, секунды|Максимум на странице, секунды|Минимальная пауза, секунды|Максимальная пауза, секунды|Прокручивать страницы|Перемещать и наводить курсор|Записывать замеры нагрузки|Разрешить замеры CPU и RAM системы',
    'Начать|Остановить|Отменить изменения|Есть несохранённые изменения|Состояние прогона|Прогресс|Сайт|Этап|Прошло времени|Осталось на этапе|Результаты посещений|Завершённых посещений пока нет.|Предпросмотр|Закрыть|Скачать|Прервано',
    'Готов|Выполняется|Приостановлен|Завершён|Остановлен|Ошибка|Открытие вкладки|Загрузка страницы|Ожидание страницы|Просмотр|Пауза между посещениями',
    'Замеры нагрузки|CPU системы|Занятая RAM системы|JS heap рендерера|Время задач рендерера, суммарно|Загрузка GPU|Недоступно|Время замера|Для запуска автосерфера нужен Chrome с доступом к отладчику.|Введите корректный HTTP(S)-адрес.|Такой адрес уже есть в списке.|Проверьте значение и границы минимума/максимума.|Строка',
    'Сайт показал проверку. Прогон приостановлен.|Сайт вернул HTTP 403. Прогон приостановлен.|Сайт вернул HTTP 429. Прогон приостановлен.|Рабочая вкладка больше недоступна.|Рабочее окно потеряло фокус.|Навигация изменилась или не завершилась.|Отладчик браузера отключён.|Предыдущий прогон восстановлен в состоянии паузы.|Достигнут заданный лимит прогона или результатов.|Системное время изменилось. Прогон приостановлен.',
  ],
  zh_CN: [
    '自动浏览|按计划访问网站并测量本机资源|访问计划|网站地址|HTTP(S)，每行一个地址。最多200个地址。|抽样数量（0＝全部）|循环次数|站内跳转深度|随机种子|访问顺序|按列表顺序|随机排序|运行上限，分钟|最短停留，秒|最长停留，秒|最短间隔，秒|最长间隔，秒|滚动页面|移动并悬停指针|记录资源测量|允许测量系统CPU和内存',
    '开始|停止|放弃修改|有未保存的修改|运行状态|进度|网站|阶段|已用时间|本阶段剩余|访问结果|尚无已完成的访问。|预览|关闭|下载|已中断',
    '就绪|运行中|已暂停|已完成|已停止|错误|打开标签页|加载页面|等待页面稳定|浏览中|访问间隔',
    '资源测量|系统CPU|系统已用内存|渲染进程JS堆|渲染任务累计时间|GPU利用率|不可用|采样时间|运行自动浏览需要具有调试权限的Chrome。|请输入有效的HTTP(S)地址。|此地址已在列表中。|请检查数值及最小、最大范围。|行',
    '网站显示了验证，运行已暂停。|网站返回HTTP 403，运行已暂停。|网站返回HTTP 429，运行已暂停。|工作标签页已不可用。|工作窗口失去焦点。|导航发生变化或未完成。|浏览器调试器已断开。|上次运行已恢复为暂停状态。|已达到配置的运行或结果上限。|系统时钟发生变化，运行已暂停。',
  ],
  vi: [
    'Lướt web tự động|Truy cập trang theo kế hoạch và đo tài nguyên cục bộ|Kế hoạch truy cập|Địa chỉ trang web|HTTP(S), mỗi dòng một địa chỉ. Tối đa 200 địa chỉ.|Cỡ mẫu (0 = tất cả)|Số vòng|Độ sâu chuyển trang nội bộ|Hạt giống|Thứ tự truy cập|Theo danh sách|Xáo trộn|Giới hạn chạy, phút|Thời gian trang tối thiểu, giây|Thời gian trang tối đa, giây|Khoảng nghỉ tối thiểu, giây|Khoảng nghỉ tối đa, giây|Cuộn trang|Di chuyển và rê con trỏ|Ghi số đo tài nguyên|Cho phép đo CPU và RAM hệ thống',
    'Bắt đầu|Dừng|Bỏ thay đổi|Có thay đổi chưa lưu|Trạng thái chạy|Tiến độ|Trang web|Giai đoạn|Đã trôi qua|Còn lại trong bước|Kết quả truy cập|Chưa có lượt truy cập hoàn tất.|Xem trước|Đóng|Tải xuống|Bị gián đoạn',
    'Sẵn sàng|Đang chạy|Đã tạm dừng|Hoàn tất|Đã dừng|Lỗi|Mở thẻ|Đang tải trang|Chờ trang ổn định|Đang duyệt|Giữa các lượt truy cập',
    'Số đo tài nguyên|CPU hệ thống|RAM hệ thống đã dùng|Heap JS của trình kết xuất|Thời gian tác vụ kết xuất tích lũy|Mức sử dụng GPU|Không khả dụng|Thời gian đo|Chạy lướt web tự động cần Chrome có quyền gỡ lỗi.|Nhập địa chỉ HTTP(S) hợp lệ.|Địa chỉ này đã có trong danh sách.|Kiểm tra giá trị và giới hạn tối thiểu/tối đa.|Dòng',
    'Trang hiển thị thử thách. Lượt chạy đã tạm dừng.|Trang trả HTTP 403. Lượt chạy đã tạm dừng.|Trang trả HTTP 429. Lượt chạy đã tạm dừng.|Thẻ làm việc không còn khả dụng.|Cửa sổ làm việc mất tiêu điểm.|Điều hướng thay đổi hoặc chưa hoàn tất.|Trình gỡ lỗi trình duyệt đã ngắt kết nối.|Lượt chạy trước được khôi phục ở trạng thái tạm dừng.|Đã đạt giới hạn lượt chạy hoặc kết quả đã đặt.|Đồng hồ hệ thống thay đổi. Lượt chạy đã tạm dừng.',
  ],
  es: [
    'Navegador automático|Visitas programadas y mediciones locales de recursos|Plan de visitas|Direcciones de sitios|HTTP(S), una dirección por línea. Hasta 200 direcciones.|Tamaño de muestra (0 = todas)|Ciclos|Profundidad de navegación interna|Semilla|Orden de visita|Orden de la lista|Aleatorio|Límite de ejecución, minutos|Tiempo mínimo por página, segundos|Tiempo máximo por página, segundos|Pausa mínima, segundos|Pausa máxima, segundos|Desplazar páginas|Mover y situar el puntero|Registrar mediciones de recursos|Permitir mediciones de CPU y RAM del sistema',
    'Iniciar|Detener|Descartar cambios|Cambios sin guardar|Estado de ejecución|Progreso|Sitio|Fase|Tiempo transcurrido|Tiempo restante del paso|Resultados de visitas|Aún no hay visitas completadas.|Vista previa|Cerrar|Descargar|Interrumpido',
    'Listo|En ejecución|En pausa|Completado|Detenido|Error|Abriendo pestaña|Cargando página|Esperando estabilización|Navegando|Entre visitas',
    'Mediciones de recursos|CPU del sistema|RAM del sistema utilizada|Heap JS del renderizador|Tiempo acumulado de tareas del renderizador|Uso de GPU|No disponible|Hora de medición|La navegación automática requiere Chrome con acceso al depurador.|Introduce una dirección HTTP(S) válida.|Esta dirección ya está en la lista.|Revisa el valor y los límites mínimo y máximo.|Línea',
    'El sitio mostró un desafío. La ejecución está en pausa.|El sitio respondió HTTP 403. La ejecución está en pausa.|El sitio respondió HTTP 429. La ejecución está en pausa.|La pestaña de trabajo ya no está disponible.|La ventana de trabajo perdió el foco.|La navegación cambió o no terminó.|El depurador del navegador se desconectó.|Se restauró la ejecución anterior en pausa.|Se alcanzó el límite configurado de ejecución o resultados.|Cambió el reloj del sistema. La ejecución está en pausa.',
  ],
  ar: [
    'التصفح التلقائي|زيارات مجدولة للمواقع وقياسات محلية للموارد|خطة الزيارات|عناوين المواقع|HTTP(S)، عنوان واحد في كل سطر. حتى 200 عنوان.|حجم العينة (0 = الكل)|الدورات|عمق التنقل الداخلي|البذرة|ترتيب الزيارات|حسب القائمة|ترتيب عشوائي|حد التشغيل بالدقائق|أقل وقت للصفحة بالثواني|أقصى وقت للصفحة بالثواني|أقل فاصل بالثواني|أقصى فاصل بالثواني|تمرير الصفحات|تحريك المؤشر والتحويم|تسجيل قياسات الموارد|السماح بقياس معالج النظام وذاكرته',
    'بدء|إيقاف|تجاهل التغييرات|تغييرات غير محفوظة|حالة التشغيل|التقدم|الموقع|المرحلة|الوقت المنقضي|المتبقي في الخطوة|نتائج الزيارات|لا توجد زيارات مكتملة بعد.|معاينة|إغلاق|تنزيل|تمت المقاطعة',
    'جاهز|قيد التشغيل|متوقف مؤقتًا|مكتمل|متوقف|خطأ|فتح علامة تبويب|تحميل الصفحة|انتظار استقرار الصفحة|تصفح|بين الزيارات',
    'قياسات الموارد|معالج النظام|ذاكرة النظام المستخدمة|كومة JavaScript لعملية العرض|الوقت التراكمي لمهام العرض|استخدام GPU|غير متاح|وقت القياس|يتطلب التصفح التلقائي Chrome مع صلاحية المصحح.|أدخل عنوان HTTP(S) صالحًا.|هذا العنوان موجود في القائمة.|تحقق من القيمة والحدين الأدنى والأقصى.|السطر',
    'عرض الموقع اختبارًا. تم إيقاف التشغيل مؤقتًا.|أعاد الموقع HTTP 403. تم إيقاف التشغيل مؤقتًا.|أعاد الموقع HTTP 429. تم إيقاف التشغيل مؤقتًا.|علامة تبويب العمل لم تعد متاحة.|فقدت نافذة العمل التركيز.|تغير التنقل أو لم يكتمل.|انقطع اتصال مصحح المتصفح.|استُعيد التشغيل السابق في وضع الإيقاف المؤقت.|تم بلوغ الحد المحدد للتشغيل أو النتائج.|تغيرت ساعة النظام. تم إيقاف التشغيل مؤقتًا.',
  ],
  uk: [
    'Автосерфер|Відвідування сайтів за планом і локальні вимірювання навантаження|План відвідувань|Адреси сайтів|HTTP(S), по одній адресі в рядку. До 200 адрес.|Розмір вибірки (0 = усі)|Кількість циклів|Глибина внутрішніх переходів|Seed|Порядок відвідувань|За списком|Перемішати|Ліміт прогону, хвилини|Мінімум на сторінці, секунди|Максимум на сторінці, секунди|Мінімальна пауза, секунди|Максимальна пауза, секунди|Прокручувати сторінки|Переміщати й наводити курсор|Записувати вимірювання|Дозволити вимірювання CPU та RAM системи',
    'Почати|Зупинити|Скасувати зміни|Є незбережені зміни|Стан прогону|Прогрес|Сайт|Етап|Минуло часу|Залишилося на етапі|Результати відвідувань|Завершених відвідувань поки немає.|Попередній перегляд|Закрити|Завантажити|Перервано',
    'Готовий|Виконується|Призупинений|Завершений|Зупинений|Помилка|Відкриття вкладки|Завантаження сторінки|Очікування сторінки|Перегляд|Пауза між відвідуваннями',
    'Вимірювання навантаження|CPU системи|Зайнята RAM системи|JS heap рендерера|Час завдань рендерера, сумарно|Завантаження GPU|Недоступно|Час вимірювання|Для запуску автосерфера потрібен Chrome із доступом до налагоджувача.|Введіть коректну HTTP(S)-адресу.|Така адреса вже є в списку.|Перевірте значення та межі мінімуму/максимуму.|Рядок',
    'Сайт показав перевірку. Прогін призупинено.|Сайт повернув HTTP 403. Прогін призупинено.|Сайт повернув HTTP 429. Прогін призупинено.|Робоча вкладка більше недоступна.|Робоче вікно втратило фокус.|Навігація змінилася або не завершилася.|Налагоджувач браузера відключено.|Попередній прогін відновлено в стані паузи.|Досягнуто заданого ліміту прогону або результатів.|Системний час змінився. Прогін призупинено.',
  ],
  fr: [
    'Navigation automatique|Visites planifiées et mesures locales des ressources|Plan de visite|Adresses des sites|HTTP(S), une adresse par ligne. Jusqu’à 200 adresses.|Taille de l’échantillon (0 = tout)|Cycles|Profondeur de navigation interne|Graine|Ordre des visites|Ordre de la liste|Aléatoire|Limite d’exécution, minutes|Temps minimal par page, secondes|Temps maximal par page, secondes|Pause minimale, secondes|Pause maximale, secondes|Faire défiler les pages|Déplacer et survoler avec le pointeur|Enregistrer les mesures|Autoriser les mesures CPU et RAM du système',
    'Démarrer|Arrêter|Annuler les modifications|Modifications non enregistrées|État de l’exécution|Progression|Site|Étape|Temps écoulé|Temps restant pour l’étape|Résultats des visites|Aucune visite terminée pour le moment.|Aperçu|Fermer|Télécharger|Interrompu',
    'Prêt|En cours|En pause|Terminé|Arrêté|Erreur|Ouverture d’un onglet|Chargement de la page|Stabilisation de la page|Navigation|Entre les visites',
    'Mesures des ressources|CPU du système|RAM système utilisée|Tas JS du moteur de rendu|Temps cumulé des tâches de rendu|Utilisation du GPU|Indisponible|Heure de mesure|La navigation automatique nécessite Chrome avec accès au débogueur.|Saisissez une adresse HTTP(S) valide.|Cette adresse figure déjà dans la liste.|Vérifiez la valeur et les limites minimale et maximale.|Ligne',
    'Le site a affiché une vérification. L’exécution est en pause.|Le site a renvoyé HTTP 403. L’exécution est en pause.|Le site a renvoyé HTTP 429. L’exécution est en pause.|L’onglet de travail n’est plus disponible.|La fenêtre de travail a perdu le focus.|La navigation a changé ou ne s’est pas terminée.|Le débogueur du navigateur s’est déconnecté.|L’exécution précédente a été restaurée en pause.|La limite configurée d’exécution ou de résultats a été atteinte.|L’horloge système a changé. L’exécution est en pause.',
  ],
  pt_BR: [
    'Navegador automático|Visitas programadas e medições locais de recursos|Plano de visitas|Endereços dos sites|HTTP(S), um endereço por linha. Até 200 endereços.|Tamanho da amostra (0 = todos)|Ciclos|Profundidade de navegação interna|Semente|Ordem das visitas|Ordem da lista|Aleatória|Limite de execução, minutos|Tempo mínimo por página, segundos|Tempo máximo por página, segundos|Pausa mínima, segundos|Pausa máxima, segundos|Rolar páginas|Mover e posicionar o ponteiro|Registrar medições de recursos|Permitir medições de CPU e RAM do sistema',
    'Iniciar|Parar|Descartar alterações|Alterações não salvas|Estado da execução|Progresso|Site|Etapa|Tempo decorrido|Tempo restante na etapa|Resultados das visitas|Ainda não há visitas concluídas.|Prévia|Fechar|Baixar|Interrompido',
    'Pronto|Em execução|Em pausa|Concluído|Parado|Erro|Abrindo aba|Carregando página|Aguardando estabilização|Navegando|Entre visitas',
    'Medições de recursos|CPU do sistema|RAM do sistema utilizada|Heap JS do renderizador|Tempo acumulado de tarefas do renderizador|Uso da GPU|Indisponível|Hora da medição|A navegação automática exige Chrome com acesso ao depurador.|Digite um endereço HTTP(S) válido.|Este endereço já está na lista.|Confira o valor e os limites mínimo e máximo.|Linha',
    'O site apresentou um desafio. A execução está em pausa.|O site retornou HTTP 403. A execução está em pausa.|O site retornou HTTP 429. A execução está em pausa.|A aba de trabalho não está mais disponível.|A janela de trabalho perdeu o foco.|A navegação mudou ou não terminou.|O depurador do navegador foi desconectado.|A execução anterior foi restaurada em pausa.|O limite configurado de execução ou resultados foi atingido.|O relógio do sistema mudou. A execução está em pausa.',
  ],
  hi: [
    'ऑटो सर्फर|नियोजित साइट विज़िट और स्थानीय संसाधन मापन|विज़िट योजना|वेबसाइट पते|HTTP(S), हर पंक्ति में एक पता। अधिकतम 200 पते।|नमूना आकार (0 = सभी)|चक्र|आंतरिक नेविगेशन गहराई|सीड|विज़िट क्रम|सूची के क्रम में|फेरबदल|रन सीमा, मिनट|पृष्ठ पर न्यूनतम समय, सेकंड|पृष्ठ पर अधिकतम समय, सेकंड|न्यूनतम अंतराल, सेकंड|अधिकतम अंतराल, सेकंड|पृष्ठ स्क्रॉल करें|पॉइंटर चलाएँ और होवर करें|संसाधन मापन दर्ज करें|सिस्टम CPU और RAM मापन की अनुमति दें',
    'शुरू करें|बंद करें|बदलाव छोड़ें|बदलाव सहेजे नहीं गए|रन की स्थिति|प्रगति|वेबसाइट|चरण|बीता समय|चरण का शेष समय|विज़िट परिणाम|अभी कोई विज़िट पूरी नहीं हुई।|पूर्वावलोकन|बंद करें|डाउनलोड|बाधित',
    'तैयार|चल रहा है|रुका हुआ|पूरा|बंद|त्रुटि|टैब खुल रहा है|पृष्ठ लोड हो रहा है|पृष्ठ स्थिर होने की प्रतीक्षा|ब्राउज़िंग|विज़िट के बीच',
    'संसाधन मापन|सिस्टम CPU|उपयोग हुई सिस्टम RAM|रेंडरर JS हीप|रेंडरर कार्य समय, संचयी|GPU उपयोग|अनुपलब्ध|मापन समय|ऑटो सर्फर चलाने के लिए डीबगर पहुँच वाला Chrome चाहिए।|मान्य HTTP(S) पता दर्ज करें।|यह पता सूची में पहले से है।|मान और न्यूनतम/अधिकतम सीमाएँ जाँचें।|पंक्ति',
    'साइट ने सत्यापन दिखाया। रन रोक दिया गया।|साइट ने HTTP 403 लौटाया। रन रोक दिया गया।|साइट ने HTTP 429 लौटाया। रन रोक दिया गया।|कार्य टैब अब उपलब्ध नहीं है।|कार्य विंडो का फोकस हट गया।|नेविगेशन बदल गया या पूरा नहीं हुआ।|ब्राउज़र डीबगर डिस्कनेक्ट हो गया।|पिछला रन रुकी हुई स्थिति में बहाल हुआ।|निर्धारित रन या परिणाम सीमा पूरी हो गई।|सिस्टम घड़ी बदली। रन रोक दिया गया।',
  ],
  ur: [
    'خودکار براؤزر|منصوبہ بند سائٹ وزٹ اور مقامی وسائل کی پیمائش|وزٹ کا منصوبہ|ویب سائٹ پتے|HTTP(S)، ہر سطر میں ایک پتہ۔ زیادہ سے زیادہ 200 پتے۔|نمونے کا حجم (0 = سب)|چکر|اندرونی نیویگیشن کی گہرائی|سیڈ|وزٹ کی ترتیب|فہرست کی ترتیب|بے ترتیب|رن کی حد، منٹ|صفحے کا کم از کم وقت، سیکنڈ|صفحے کا زیادہ سے زیادہ وقت، سیکنڈ|کم از کم وقفہ، سیکنڈ|زیادہ سے زیادہ وقفہ، سیکنڈ|صفحات اسکرول کریں|پوائنٹر حرکت دیں اور ہوور کریں|وسائل کی پیمائش ریکارڈ کریں|سسٹم CPU اور RAM کی پیمائش کی اجازت دیں',
    'شروع کریں|روکیں|تبدیلیاں رد کریں|تبدیلیاں محفوظ نہیں ہوئیں|رن کی حالت|پیش رفت|ویب سائٹ|مرحلہ|گزرا وقت|مرحلے کا باقی وقت|وزٹ کے نتائج|ابھی کوئی وزٹ مکمل نہیں ہوا۔|پیش منظر|بند کریں|ڈاؤن لوڈ|منقطع',
    'تیار|چل رہا ہے|موقوف|مکمل|روک دیا گیا|خرابی|ٹیب کھل رہا ہے|صفحہ لوڈ ہو رہا ہے|صفحے کے مستحکم ہونے کا انتظار|براؤزنگ|وزٹس کے درمیان',
    'وسائل کی پیمائش|سسٹم CPU|استعمال شدہ سسٹم RAM|رینڈرر JS ہیپ|رینڈرر کام کا مجموعی وقت|GPU کا استعمال|دستیاب نہیں|پیمائش کا وقت|خودکار براؤزر کے لیے ڈی بگر رسائی والا Chrome درکار ہے۔|درست HTTP(S) پتہ درج کریں۔|یہ پتہ پہلے سے فہرست میں ہے۔|قدر اور کم از کم/زیادہ سے زیادہ حدود دیکھیں۔|سطر',
    'سائٹ نے تصدیق دکھائی۔ رن موقوف ہے۔|سائٹ نے HTTP 403 دیا۔ رن موقوف ہے۔|سائٹ نے HTTP 429 دیا۔ رن موقوف ہے۔|کام کا ٹیب اب دستیاب نہیں۔|کام کی ونڈو کا فوکس ہٹ گیا۔|نیویگیشن بدل گئی یا مکمل نہیں ہوئی۔|براؤزر ڈی بگر منقطع ہو گیا۔|پچھلا رن موقوف حالت میں بحال ہوا۔|رن یا نتائج کی مقررہ حد پوری ہو گئی۔|سسٹم گھڑی بدل گئی۔ رن موقوف ہے۔',
  ],
  ja: [
    '自動巡回|計画したサイト訪問とローカルのリソース測定|訪問プラン|サイトのURL|HTTP(S)、1行に1件。最大200件。|抽出件数（0＝すべて）|繰り返し回数|サイト内移動の深さ|シード|訪問順序|一覧の順序|シャッフル|実行上限、分|ページ最短滞在、秒|ページ最長滞在、秒|最短間隔、秒|最長間隔、秒|ページをスクロール|ポインターを移動してホバー|リソース測定を記録|システムCPUとRAMの測定を許可',
    '開始|停止|変更を破棄|未保存の変更|実行状態|進捗|サイト|段階|経過時間|段階の残り時間|訪問結果|完了した訪問はまだありません。|プレビュー|閉じる|ダウンロード|中断',
    '準備完了|実行中|一時停止|完了|停止済み|エラー|タブを開いています|ページを読み込み中|ページの安定を待機|閲覧中|訪問間の待機',
    'リソース測定|システムCPU|システムRAM使用量|レンダラーのJSヒープ|レンダラーの累積タスク時間|GPU使用率|利用不可|測定時刻|自動巡回にはデバッガーアクセスがあるChromeが必要です。|有効なHTTP(S) URLを入力してください。|このURLは一覧にあります。|値と最小・最大の範囲を確認してください。|行',
    'サイトに認証画面が表示されたため一時停止しました。|サイトがHTTP 403を返したため一時停止しました。|サイトがHTTP 429を返したため一時停止しました。|作業用タブが利用できなくなりました。|作業ウィンドウがフォーカスを失いました。|ナビゲーションが変更されたか完了しませんでした。|ブラウザーのデバッガーが切断されました。|前回の実行を一時停止状態で復元しました。|設定された実行または結果の上限に達しました。|システム時刻が変更されたため一時停止しました。',
  ],
  de: [
    'Autosurfer|Geplante Websitebesuche und lokale Ressourcenmessungen|Besuchsplan|Website-Adressen|HTTP(S), eine Adresse pro Zeile. Bis zu 200 Adressen.|Stichprobengröße (0 = alle)|Durchläufe|Tiefe interner Navigation|Startwert|Besuchsreihenfolge|Listenreihenfolge|Zufällig|Laufzeitlimit, Minuten|Minimale Seitenzeit, Sekunden|Maximale Seitenzeit, Sekunden|Minimale Pause, Sekunden|Maximale Pause, Sekunden|Seiten scrollen|Zeiger bewegen und darüberführen|Ressourcenmessungen aufzeichnen|Messungen von System-CPU und RAM erlauben',
    'Starten|Stoppen|Änderungen verwerfen|Ungespeicherte Änderungen|Laufstatus|Fortschritt|Website|Phase|Vergangene Zeit|Verbleibende Schrittzeit|Besuchsergebnisse|Noch keine abgeschlossenen Besuche.|Vorschau|Schließen|Herunterladen|Unterbrochen',
    'Bereit|Läuft|Pausiert|Abgeschlossen|Gestoppt|Fehler|Tab wird geöffnet|Seite wird geladen|Seite stabilisiert sich|Surfen|Zwischen Besuchen',
    'Ressourcenmessungen|System-CPU|Genutzter System-RAM|JS-Heap des Renderers|Kumulierte Renderer-Aufgabenzeit|GPU-Auslastung|Nicht verfügbar|Messzeit|Der Autosurfer benötigt Chrome mit Debuggerzugriff.|Eine gültige HTTP(S)-Adresse eingeben.|Diese Adresse steht bereits in der Liste.|Wert sowie Mindest- und Höchstgrenzen prüfen.|Zeile',
    'Die Website zeigte eine Prüfung. Der Lauf ist pausiert.|Die Website antwortete mit HTTP 403. Der Lauf ist pausiert.|Die Website antwortete mit HTTP 429. Der Lauf ist pausiert.|Der Arbeitstab ist nicht mehr verfügbar.|Das Arbeitsfenster hat den Fokus verloren.|Die Navigation wurde geändert oder nicht abgeschlossen.|Der Browser-Debugger wurde getrennt.|Der vorherige Lauf wurde pausiert wiederhergestellt.|Das eingestellte Lauf- oder Ergebnislimit wurde erreicht.|Die Systemzeit hat sich geändert. Der Lauf ist pausiert.',
  ],
  pl: [
    'Autosurfer|Zaplanowane wizyty i lokalne pomiary zasobów|Plan wizyt|Adresy witryn|HTTP(S), jeden adres w wierszu. Do 200 adresów.|Wielkość próbki (0 = wszystkie)|Cykle|Głębokość nawigacji wewnętrznej|Ziarno|Kolejność wizyt|Według listy|Losowo|Limit przebiegu, minuty|Minimalny czas strony, sekundy|Maksymalny czas strony, sekundy|Minimalna przerwa, sekundy|Maksymalna przerwa, sekundy|Przewijaj strony|Przesuwaj i zatrzymuj wskaźnik|Zapisuj pomiary zasobów|Zezwól na pomiary CPU i RAM systemu',
    'Rozpocznij|Zatrzymaj|Odrzuć zmiany|Niezapisane zmiany|Stan przebiegu|Postęp|Witryna|Etap|Upłynęło|Pozostało w kroku|Wyniki wizyt|Brak zakończonych wizyt.|Podgląd|Zamknij|Pobierz|Przerwano',
    'Gotowy|Działa|Wstrzymany|Zakończony|Zatrzymany|Błąd|Otwieranie karty|Ładowanie strony|Stabilizacja strony|Przeglądanie|Między wizytami',
    'Pomiary zasobów|CPU systemu|Używany RAM systemu|Sterta JS renderera|Łączny czas zadań renderera|Wykorzystanie GPU|Niedostępne|Czas pomiaru|Autosurfer wymaga Chrome z dostępem do debugera.|Wpisz prawidłowy adres HTTP(S).|Ten adres jest już na liście.|Sprawdź wartość oraz granice minimum i maksimum.|Wiersz',
    'Witryna pokazała weryfikację. Przebieg wstrzymano.|Witryna zwróciła HTTP 403. Przebieg wstrzymano.|Witryna zwróciła HTTP 429. Przebieg wstrzymano.|Karta robocza jest niedostępna.|Okno robocze utraciło fokus.|Nawigacja zmieniła się lub nie zakończyła.|Debuger przeglądarki został odłączony.|Poprzedni przebieg przywrócono jako wstrzymany.|Osiągnięto ustawiony limit przebiegu lub wyników.|Zegar systemowy zmienił się. Przebieg wstrzymano.',
  ],
  id: [
    'Penjelajah otomatis|Kunjungan situs terjadwal dan pengukuran sumber daya lokal|Rencana kunjungan|Alamat situs|HTTP(S), satu alamat per baris. Maksimal 200 alamat.|Ukuran sampel (0 = semua)|Siklus|Kedalaman navigasi internal|Seed|Urutan kunjungan|Urutan daftar|Acak|Batas proses, menit|Waktu halaman minimum, detik|Waktu halaman maksimum, detik|Jeda minimum, detik|Jeda maksimum, detik|Gulir halaman|Gerakkan dan arahkan penunjuk|Catat pengukuran sumber daya|Izinkan pengukuran CPU dan RAM sistem',
    'Mulai|Hentikan|Buang perubahan|Perubahan belum disimpan|Status proses|Kemajuan|Situs|Tahap|Waktu berlalu|Sisa waktu langkah|Hasil kunjungan|Belum ada kunjungan selesai.|Pratinjau|Tutup|Unduh|Terputus',
    'Siap|Berjalan|Dijeda|Selesai|Dihentikan|Kesalahan|Membuka tab|Memuat halaman|Menunggu halaman stabil|Menjelajah|Antarkunjungan',
    'Pengukuran sumber daya|CPU sistem|RAM sistem terpakai|Heap JS perender|Waktu tugas perender kumulatif|Penggunaan GPU|Tidak tersedia|Waktu pengukuran|Penjelajah otomatis memerlukan Chrome dengan akses debugger.|Masukkan alamat HTTP(S) yang valid.|Alamat ini sudah ada dalam daftar.|Periksa nilai serta batas minimum dan maksimum.|Baris',
    'Situs menampilkan tantangan. Proses dijeda.|Situs mengembalikan HTTP 403. Proses dijeda.|Situs mengembalikan HTTP 429. Proses dijeda.|Tab kerja tidak tersedia lagi.|Jendela kerja kehilangan fokus.|Navigasi berubah atau tidak selesai.|Debugger browser terputus.|Proses sebelumnya dipulihkan dalam keadaan dijeda.|Batas proses atau hasil yang dikonfigurasi tercapai.|Jam sistem berubah. Proses dijeda.',
  ],
  mr: [
    'ऑटो सर्फर|नियोजित साइट भेटी आणि स्थानिक संसाधन मोजमाप|भेटींची योजना|वेबसाइट पत्ते|HTTP(S), प्रत्येक ओळीत एक पत्ता. कमाल 200 पत्ते.|नमुना आकार (0 = सर्व)|फेऱ्या|अंतर्गत नेव्हिगेशन खोली|सीड|भेटींचा क्रम|यादीतील क्रम|यादृच्छिक|रन मर्यादा, मिनिटे|पृष्ठावरील किमान वेळ, सेकंद|पृष्ठावरील कमाल वेळ, सेकंद|किमान अंतर, सेकंद|कमाल अंतर, सेकंद|पृष्ठे स्क्रोल करा|पॉइंटर हलवा आणि होव्हर करा|संसाधन मोजमाप नोंदवा|सिस्टम CPU आणि RAM मोजण्यास परवानगी द्या',
    'सुरू करा|थांबवा|बदल टाकून द्या|न जतन केलेले बदल|रनची स्थिती|प्रगती|वेबसाइट|टप्पा|गेलेला वेळ|टप्प्यातील उरलेला वेळ|भेटींचे निकाल|अद्याप पूर्ण भेटी नाहीत.|पूर्वावलोकन|बंद करा|डाउनलोड|व्यत्यय आला',
    'तयार|चालू आहे|विराम दिला|पूर्ण|थांबवले|त्रुटी|टॅब उघडत आहे|पृष्ठ लोड होत आहे|पृष्ठ स्थिर होण्याची प्रतीक्षा|ब्राउझिंग|भेटींमधील अंतर',
    'संसाधन मोजमाप|सिस्टम CPU|वापरलेली सिस्टम RAM|रेंडरर JS हीप|रेंडरर कार्यांचा एकत्रित वेळ|GPU वापर|अनुपलब्ध|मोजमापाची वेळ|ऑटो सर्फरसाठी डीबगर प्रवेश असलेले Chrome आवश्यक आहे.|वैध HTTP(S) पत्ता द्या.|हा पत्ता यादीत आधीच आहे.|मूल्य आणि किमान/कमाल मर्यादा तपासा.|ओळ',
    'साइटने पडताळणी दाखवली. रनला विराम दिला.|साइटने HTTP 403 दिला. रनला विराम दिला.|साइटने HTTP 429 दिला. रनला विराम दिला.|कामाचा टॅब उपलब्ध नाही.|कामाच्या विंडोचा फोकस गेला.|नेव्हिगेशन बदलले किंवा पूर्ण झाले नाही.|ब्राउझर डीबगर डिस्कनेक्ट झाला.|मागील रन विराम स्थितीत पुनर्स्थापित झाला.|ठरवलेली रन किंवा निकाल मर्यादा गाठली.|सिस्टम घड्याळ बदलले. रनला विराम दिला.',
  ],
  te: [
    'ఆటో సర్ఫర్|ప్రణాళిక ప్రకారం సైట్ సందర్శనలు మరియు స్థానిక వనరుల కొలతలు|సందర్శన ప్రణాళిక|వెబ్‌సైట్ చిరునామాలు|HTTP(S), ప్రతి పంక్తికి ఒక చిరునామా. గరిష్ఠంగా 200 చిరునామాలు.|నమూనా పరిమాణం (0 = అన్నీ)|చక్రాలు|అంతర్గత నావిగేషన్ లోతు|సీడ్|సందర్శన క్రమం|జాబితా క్రమంలో|యాదృచ్ఛికం|రన్ పరిమితి, నిమిషాలు|పేజీ కనిష్ఠ సమయం, సెకన్లు|పేజీ గరిష్ఠ సమయం, సెకన్లు|కనిష్ఠ విరామం, సెకన్లు|గరిష్ఠ విరామం, సెకన్లు|పేజీలను స్క్రోల్ చేయి|పాయింటర్‌ను కదిలించి హోవర్ చేయి|వనరుల కొలతలను నమోదు చేయి|సిస్టమ్ CPU మరియు RAM కొలతలను అనుమతించు',
    'ప్రారంభించు|ఆపు|మార్పులను విస్మరించు|సేవ్ చేయని మార్పులు|రన్ స్థితి|పురోగతి|వెబ్‌సైట్|దశ|గడిచిన సమయం|దశలో మిగిలిన సమయం|సందర్శన ఫలితాలు|ఇంకా పూర్తయిన సందర్శనలు లేవు.|ముందస్తు వీక్షణ|మూసివేయి|డౌన్‌లోడ్|అంతరాయం',
    'సిద్ధం|నడుస్తోంది|పాజ్ చేయబడింది|పూర్తయింది|ఆపబడింది|లోపం|ట్యాబ్ తెరుస్తోంది|పేజీ లోడ్ అవుతోంది|పేజీ స్థిరపడే వరకు వేచి ఉంది|బ్రౌజింగ్|సందర్శనల మధ్య',
    'వనరుల కొలతలు|సిస్టమ్ CPU|వాడిన సిస్టమ్ RAM|రెండరర్ JS హీప్|రెండరర్ పనుల సంచిత సమయం|GPU వినియోగం|అందుబాటులో లేదు|కొలత సమయం|ఆటో సర్ఫర్‌కు డీబగ్గర్ యాక్సెస్ ఉన్న Chrome అవసరం.|చెల్లుబాటు అయ్యే HTTP(S) చిరునామా ఇవ్వండి.|ఈ చిరునామా ఇప్పటికే జాబితాలో ఉంది.|విలువ మరియు కనిష్ఠ/గరిష్ఠ హద్దులను తనిఖీ చేయండి.|పంక్తి',
    'సైట్ ధృవీకరణ చూపింది. రన్ పాజ్ అయింది.|సైట్ HTTP 403 ఇచ్చింది. రన్ పాజ్ అయింది.|సైట్ HTTP 429 ఇచ్చింది. రన్ పాజ్ అయింది.|పని ట్యాబ్ ఇక అందుబాటులో లేదు.|పని విండో ఫోకస్ కోల్పోయింది.|నావిగేషన్ మారింది లేదా పూర్తి కాలేదు.|బ్రౌజర్ డీబగ్గర్ డిస్‌కనెక్ట్ అయింది.|మునుపటి రన్ పాజ్ స్థితిలో పునరుద్ధరించబడింది.|నిర్దేశించిన రన్ లేదా ఫలితాల పరిమితి చేరింది.|సిస్టమ్ గడియారం మారింది. రన్ పాజ్ అయింది.',
  ],
  ko: [
    '자동 탐색|계획된 사이트 방문과 로컬 리소스 측정|방문 계획|웹사이트 주소|HTTP(S), 한 줄에 주소 하나. 최대 200개.|표본 크기 (0 = 전체)|반복 횟수|내부 탐색 깊이|시드|방문 순서|목록 순서|무작위|실행 제한, 분|최소 페이지 시간, 초|최대 페이지 시간, 초|최소 간격, 초|최대 간격, 초|페이지 스크롤|포인터 이동 및 호버|리소스 측정 기록|시스템 CPU 및 RAM 측정 허용',
    '시작|중지|변경 취소|저장하지 않은 변경 사항|실행 상태|진행률|웹사이트|단계|경과 시간|단계 남은 시간|방문 결과|아직 완료된 방문이 없습니다.|미리 보기|닫기|다운로드|중단됨',
    '준비|실행 중|일시 중지|완료|중지됨|오류|탭 여는 중|페이지 로딩|페이지 안정 대기|탐색 중|방문 사이',
    '리소스 측정|시스템 CPU|시스템 RAM 사용량|렌더러 JS 힙|렌더러 누적 작업 시간|GPU 사용률|사용 불가|측정 시간|자동 탐색에는 디버거 접근이 가능한 Chrome이 필요합니다.|올바른 HTTP(S) 주소를 입력하세요.|목록에 이미 있는 주소입니다.|값과 최솟값·최댓값 범위를 확인하세요.|줄',
    '사이트에 확인 절차가 표시되어 일시 중지했습니다.|사이트가 HTTP 403을 반환하여 일시 중지했습니다.|사이트가 HTTP 429를 반환하여 일시 중지했습니다.|작업 탭을 더 이상 사용할 수 없습니다.|작업 창이 포커스를 잃었습니다.|탐색이 변경되었거나 완료되지 않았습니다.|브라우저 디버거 연결이 해제되었습니다.|이전 실행을 일시 중지 상태로 복원했습니다.|설정된 실행 또는 결과 제한에 도달했습니다.|시스템 시간이 변경되어 일시 중지했습니다.',
  ],
  ta: [
    'தானியங்கி உலாவி|திட்டமிட்ட தளப் பார்வைகளும் உள்ளூர் வள அளவீடுகளும்|பார்வைத் திட்டம்|இணையதள முகவரிகள்|HTTP(S), வரிக்கு ஒரு முகவரி. அதிகபட்சம் 200 முகவரிகள்.|மாதிரி அளவு (0 = அனைத்தும்)|சுழற்சிகள்|உள் வழிசெலுத்தல் ஆழம்|விதை|பார்வை வரிசை|பட்டியல் வரிசை|கலக்கு|இயக்க வரம்பு, நிமிடங்கள்|பக்கத்தின் குறைந்தபட்ச நேரம், வினாடிகள்|பக்கத்தின் அதிகபட்ச நேரம், வினாடிகள்|குறைந்தபட்ச இடைவெளி, வினாடிகள்|அதிகபட்ச இடைவெளி, வினாடிகள்|பக்கங்களை உருட்டு|சுட்டியை நகர்த்தி மேலே நிறுத்து|வள அளவீடுகளைப் பதிவு செய்|கணினி CPU மற்றும் RAM அளவீடுகளை அனுமதி',
    'தொடங்கு|நிறுத்து|மாற்றங்களைத் தவிர்|சேமிக்காத மாற்றங்கள்|இயக்க நிலை|முன்னேற்றம்|இணையதளம்|கட்டம்|கடந்த நேரம்|கட்டத்தின் மீதமுள்ள நேரம்|பார்வை முடிவுகள்|இன்னும் முடிந்த பார்வைகள் இல்லை.|முன்னோட்டம்|மூடு|பதிவிறக்கு|குறுக்கிடப்பட்டது',
    'தயார்|இயங்குகிறது|இடைநிறுத்தம்|முடிந்தது|நிறுத்தப்பட்டது|பிழை|தாவல் திறக்கிறது|பக்கம் ஏற்றுகிறது|பக்கம் நிலைபெறக் காத்திருக்கிறது|உலாவல்|பார்வைகளுக்கு இடையில்',
    'வள அளவீடுகள்|கணினி CPU|பயன்பட்ட கணினி RAM|ரெண்டரர் JS ஹீப்|ரெண்டரர் பணிகளின் மொத்த நேரம்|GPU பயன்பாடு|கிடைக்காது|அளவீட்டு நேரம்|தானியங்கி உலாவிக்கு பிழைத்திருத்தி அணுகலுள்ள Chrome தேவை.|சரியான HTTP(S) முகவரியை உள்ளிடவும்.|இந்த முகவரி பட்டியலில் ஏற்கனவே உள்ளது.|மதிப்பையும் குறைந்தபட்ச/அதிகபட்ச வரம்புகளையும் சரிபார்க்கவும்.|வரி',
    'தளம் சரிபார்ப்பைக் காட்டியது. இயக்கம் இடைநிறுத்தப்பட்டது.|தளம் HTTP 403 வழங்கியது. இயக்கம் இடைநிறுத்தப்பட்டது.|தளம் HTTP 429 வழங்கியது. இயக்கம் இடைநிறுத்தப்பட்டது.|பணித் தாவல் இனி கிடைக்காது.|பணிச் சாளரம் கவனத்தை இழந்தது.|வழிசெலுத்தல் மாறியது அல்லது முடியவில்லை.|உலாவி பிழைத்திருத்தி துண்டிக்கப்பட்டது.|முந்தைய இயக்கம் இடைநிறுத்த நிலையில் மீட்கப்பட்டது.|அமைத்த இயக்க அல்லது முடிவு வரம்பு எட்டப்பட்டது.|கணினிக் கடிகாரம் மாறியது. இயக்கம் இடைநிறுத்தப்பட்டது.',
  ],
  yue: [
    '自动浏览|按计划浏览网站同量度本机资源|浏览计划|网站地址|HTTP(S)，每行一个地址。最多200个地址。|抽样数量（0＝全部）|循环次数|站内跳转深度|随机种子|浏览次序|跟列表次序|随机排序|运行上限，分钟|最短停留，秒|最长停留，秒|最短间隔，秒|最长间隔，秒|卷动网页|移动同悬停指针|记录资源量度|允许量度系统CPU同记忆体',
    '开始|停止|放弃修改|有未储存嘅修改|运行状态|进度|网站|阶段|已用时间|呢个阶段剩余|浏览结果|暂时未有完成嘅浏览。|预览|关闭|下载|已中断',
    '准备好|运行中|已暂停|已完成|已停止|错误|开启分页|载入网页|等网页稳定|浏览中|浏览间隔',
    '资源量度|系统CPU|系统已用记忆体|渲染程序JS堆|渲染工作累计时间|GPU使用率|唔可用|量度时间|自动浏览要用有除错权限嘅Chrome。|请输入有效嘅HTTP(S)地址。|呢个地址已经喺列表入面。|请检查数值同最细、最大范围。|行',
    '网站显示咗验证，运行已暂停。|网站传回HTTP 403，运行已暂停。|网站传回HTTP 429，运行已暂停。|工作分页已经唔可用。|工作视窗失去焦点。|导航有变或者未完成。|浏览器除错器断开咗。|上次运行已恢复为暂停状态。|已经达到设定嘅运行或结果上限。|系统时钟有变，运行已暂停。',
  ],
  wuu: [
    '自动浏览|照计划浏览网站搭量本机资源|浏览计划|网站地址|HTTP(S)，一行一个地址。最多200个地址。|抽样数量（0＝全部）|循环趟数|站内跳转深度|随机种子|浏览顺序|照列表顺序|随机排|运行上限，分钟|最短停留，秒|最长停留，秒|最短间隔，秒|最长间隔，秒|滚动网页|移动搭悬停指针|记录资源测量|允许测量系统CPU搭内存',
    '开始|停止|放弃修改|有呒保存个修改|运行状态|进度|网站|阶段|已经用个时间|搿个阶段剩余|浏览结果|暂时呒完成个浏览。|预览|关闭|下载|中断了',
    '准备好了|运行中|暂停了|完成了|停止了|错误|打开标签页|加载网页|等网页稳定|浏览中|浏览间隔',
    '资源测量|系统CPU|系统用脱个内存|渲染进程JS堆|渲染任务累计时间|GPU使用率|弗可用|测量时间|自动浏览需要有调试权限个Chrome。|请输入有效个HTTP(S)地址。|搿个地址已经勒列表里向。|请检查数值搭最小、最大范围。|行',
    '网站显示了验证，运行暂停了。|网站返回HTTP 403，运行暂停了。|网站返回HTTP 429，运行暂停了。|工作标签页已经弗可用。|工作窗口失脱焦点。|导航变了或者呒完成。|浏览器调试器断开了。|上趟运行恢复成暂停状态了。|达到设定个运行或者结果上限了。|系统时钟变了，运行暂停了。',
  ],
};
const ACTION_FIELDS = ['clear_report', 'metrics_granted', 'stale'];
const ACTION_COPY = {
  "en": [
    "Clear report",
    "System CPU and RAM measurement access granted.",
    "The plan changed in another window. Select Discard changes to load the current version."
  ],
  "ru": [
    "Очистить отчёт",
    "Доступ к замерам CPU и RAM разрешён.",
    "План изменён в другом окне. Нажмите «Отменить изменения», чтобы загрузить текущую версию."
  ],
  "zh_CN": [
    "清除报告",
    "已允许测量系统CPU和内存。",
    "计划已在其他窗口修改。选择“放弃修改”以加载当前版本。"
  ],
  "vi": [
    "Xóa báo cáo",
    "Đã cấp quyền đo CPU và RAM hệ thống.",
    "Kế hoạch đã thay đổi trong cửa sổ khác. Chọn Bỏ thay đổi để tải phiên bản hiện tại."
  ],
  "es": [
    "Borrar informe",
    "Acceso a mediciones de CPU y RAM del sistema concedido.",
    "El plan cambió en otra ventana. Selecciona Descartar cambios para cargar la versión actual."
  ],
  "ar": [
    "مسح التقرير",
    "تم السماح بقياس معالج النظام وذاكرته.",
    "تغيرت الخطة في نافذة أخرى. اختر تجاهل التغييرات لتحميل النسخة الحالية."
  ],
  "uk": [
    "Очистити звіт",
    "Доступ до вимірювань CPU та RAM дозволено.",
    "План змінено в іншому вікні. Натисніть «Скасувати зміни», щоб завантажити поточну версію."
  ],
  "fr": [
    "Effacer le rapport",
    "Accès aux mesures CPU et RAM du système autorisé.",
    "Le plan a changé dans une autre fenêtre. Choisissez Annuler les modifications pour charger la version actuelle."
  ],
  "pt_BR": [
    "Limpar relatório",
    "Acesso às medições de CPU e RAM do sistema permitido.",
    "O plano mudou em outra janela. Selecione Descartar alterações para carregar a versão atual."
  ],
  "hi": [
    "रिपोर्ट मिटाएँ",
    "सिस्टम CPU और RAM मापन की अनुमति मिल गई।",
    "योजना दूसरी विंडो में बदल गई। वर्तमान संस्करण लोड करने के लिए बदलाव छोड़ें चुनें।"
  ],
  "ur": [
    "رپورٹ صاف کریں",
    "سسٹم CPU اور RAM کی پیمائش کی اجازت مل گئی۔",
    "منصوبہ دوسری ونڈو میں بدل گیا۔ موجودہ نسخہ لوڈ کرنے کے لیے تبدیلیاں رد کریں منتخب کریں۔"
  ],
  "ja": [
    "レポートを消去",
    "システムCPUとRAMの測定を許可しました。",
    "別のウィンドウでプランが変更されました。「変更を破棄」を選んで現在のバージョンを読み込んでください。"
  ],
  "de": [
    "Bericht löschen",
    "Zugriff auf Messungen von System-CPU und RAM erteilt.",
    "Der Plan wurde in einem anderen Fenster geändert. Wähle Änderungen verwerfen, um die aktuelle Version zu laden."
  ],
  "pl": [
    "Wyczyść raport",
    "Zezwolono na pomiary CPU i RAM systemu.",
    "Plan zmieniono w innym oknie. Wybierz Odrzuć zmiany, aby wczytać aktualną wersję."
  ],
  "id": [
    "Hapus laporan",
    "Akses pengukuran CPU dan RAM sistem diizinkan.",
    "Rencana berubah di jendela lain. Pilih Buang perubahan untuk memuat versi saat ini."
  ],
  "mr": [
    "अहवाल साफ करा",
    "सिस्टम CPU आणि RAM मोजण्याची परवानगी मिळाली.",
    "योजना दुसऱ्या विंडोमध्ये बदलली. सध्याची आवृत्ती लोड करण्यासाठी बदल टाकून द्या निवडा."
  ],
  "te": [
    "నివేదికను క్లియర్ చేయి",
    "సిస్టమ్ CPU మరియు RAM కొలతలకు అనుమతి లభించింది.",
    "ప్రణాళిక మరో విండోలో మారింది. ప్రస్తుత సంస్కరణను లోడ్ చేయడానికి మార్పులను విస్మరించు ఎంచుకోండి."
  ],
  "ko": [
    "보고서 지우기",
    "시스템 CPU 및 RAM 측정 접근이 허용되었습니다.",
    "다른 창에서 계획이 변경되었습니다. 변경 취소를 선택하여 현재 버전을 불러오세요."
  ],
  "ta": [
    "அறிக்கையை அழி",
    "கணினி CPU மற்றும் RAM அளவீடுகளுக்கான அணுகல் அனுமதிக்கப்பட்டது.",
    "திட்டம் மற்றொரு சாளரத்தில் மாறியது. தற்போதைய பதிப்பை ஏற்ற மாற்றங்களைத் தவிர் என்பதைத் தேர்ந்தெடுக்கவும்."
  ],
  "yue": [
    "清除报告",
    "已经允许量度系统CPU同记忆体。",
    "计划喺另一视窗改咗。选择“放弃修改”载入而家嘅版本。"
  ],
  "wuu": [
    "清除报告",
    "允许测量系统CPU搭内存了。",
    "计划勒别个窗口里改了。选“放弃修改”来加载现在个版本。"
  ]
};
const EMPTY_PLAN_COPY = {
  en: 'Add sites to start.',
  ru: 'Добавьте сайты для запуска.',
  zh_CN: '添加网站以开始。',
  vi: 'Thêm trang web để bắt đầu.',
  es: 'Añade sitios para iniciar.',
  ar: 'أضف مواقع للبدء.',
  uk: 'Додайте сайти для запуску.',
  fr: 'Ajoutez des sites pour démarrer.',
  pt_BR: 'Adicione sites para iniciar.',
  hi: 'शुरू करने के लिए साइटें जोड़ें।',
  ur: 'شروع کرنے کے لیے سائٹس شامل کریں۔',
  ja: '開始するにはサイトを追加してください。',
  de: 'Fügen Sie Websites hinzu, um zu starten.',
  pl: 'Dodaj witryny, aby rozpocząć.',
  id: 'Tambahkan situs untuk memulai.',
  mr: 'सुरू करण्यासाठी साइट्स जोडा.',
  te: 'ప్రారంభించడానికి సైట్‌లను జోడించండి.',
  ko: '시작하려면 사이트를 추가하세요.',
  ta: 'தொடங்க தளங்களைச் சேர்க்கவும்.',
  yue: '加啲网站先可以开始。',
  wuu: '加好网站再开始。',
};
export const AUTOSURF_UI_KEYS = Object.freeze(['management_tab_autosurf', ...[...GROUPS.flat(), ...ACTION_FIELDS, 'empty_plan'].map(key => 'autosurf_' + key)]);
export const AUTOSURF_UI_MESSAGES = Object.freeze(Object.fromEntries(Object.entries(COPY).map(([locale, groups]) => {
  if (groups.length !== GROUPS.length) throw Error('Autosurfer locale group count: ' + locale);
  const entries = groups.flatMap((source, group) => {
    const values = source.split('|');
    if (values.length !== GROUPS[group].length || values.some(value => !value || value.trim() !== value)) throw Error('Autosurfer locale: ' + locale + '/' + group + '/' + values.length);
    return GROUPS[group].map((key, index) => ['autosurf_' + key, values[index]]);
  });
  const actions = ACTION_COPY[locale];
  if (!Array.isArray(actions) || actions.length !== ACTION_FIELDS.length || actions.some(value => typeof value !== 'string' || !value || value.trim() !== value)) throw Error('Autosurfer action locale: ' + locale);
  const emptyPlan = EMPTY_PLAN_COPY[locale];
  if (typeof emptyPlan !== 'string' || !emptyPlan || emptyPlan.trim() !== emptyPlan) throw Error('Autosurfer empty plan locale: ' + locale);
  return [locale, Object.freeze({ management_tab_autosurf: groups[0].split('|')[0], ...Object.fromEntries([...entries, ...ACTION_FIELDS.map((key, index) => ['autosurf_' + key, actions[index]])]), autosurf_empty_plan: emptyPlan })];
})));
export function applyAutosurfCopy(table, locale) {
  const messages = AUTOSURF_UI_MESSAGES[locale];
  if (!messages) throw Error('Unknown Autosurfer locale ' + String(locale));
  for (const key of AUTOSURF_UI_KEYS) table[key] = { message: messages[key] };
  return table;
}

