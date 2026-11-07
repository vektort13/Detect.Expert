// ADR-063: Browser Debug chrome and typed editors, authored for every production locale.
const UI = ['subtitle', 'datasets', 'export', 'refresh', 'load', 'search', 'origin', 'grant', 'records', 'details', 'actions', 'pages', 'previous', 'next', 'draft', 'changes', 'save', 'cancel', 'confirm', 'export_preview', 'download', 'yes', 'no', 'confirm_action', 'finish_edit', 'not_loaded', 'empty', 'limited', 'saved', 'access_granted', 'access_changed', 'permission_required', 'permission_denied', 'unsupported', 'invalid_input', 'not_controllable', 'stale', 'inactive', 'timeout', 'busy', 'operation_failed', 'invalid_origin'];
const DATASETS = ['overview', 'history', 'bookmarks', 'downloads', 'cookies', 'tabs', 'sessions', 'top_sites', 'reading_list', 'extensions', 'privacy', 'site_permissions', 'system', 'account', 'internals'];
const ACTIONS = ['create', 'edit', 'move', 'remove', 'pause', 'resume', 'cancel', 'erase', 'activate', 'restore', 'clear', 'open', 'api_guard'];
const FIELDS = ['name', 'value', 'title', 'url', 'lastVisitTime', 'visitCount', 'parentId', 'dateAdded', 'state', 'bytesReceived', 'totalBytes', 'domain', 'path', 'expirationDate', 'secure', 'httpOnly', 'windowId', 'pinned', 'muted', 'lastModified', 'hasBeenRead', 'creationTime', 'version', 'enabled', 'type', 'installType', 'levelOfControl', 'origin', 'setting', 'primaryPattern', 'secondaryPattern', 'scope'];
const COPY = {
  en: [
    'Browser data and settings|Data sections|Export JSON|Refresh|Load data|Search|Exact origin|Grant access|Records|Details|Actions|Pages|Previous|Next|Draft|Changes|Save|Cancel|Confirm|JSON export preview|Download JSON|Yes|No|Confirm this action for the selected record.|Save or cancel the edit before refreshing.|Select Load data to read this section.|No matching records.|Results limited to the loaded records|Saved|Access granted. Select Load data.|Access changed. Load the section again.|Access is required for this section.|Access was not granted.|Unavailable in this browser.|Check the entered values.|Controlled by another extension or administrator.|The record changed. Load fresh data.|Open this section to continue.|The operation timed out.|An operation is in progress.|Could not complete the operation.|Enter an HTTP or HTTPS origin without a path, query or fragment.',
    'Overview|History|Bookmarks|Downloads|Cookies|Tabs and windows|Sessions|Top sites|Reading list|Extensions|Privacy settings|Site permissions|System|Account|Browser internals',
    'Create|Edit|Move|Delete|Pause|Resume|Cancel|Erase record|Activate|Restore|Use browser setting|Open|Open API Guard',
    'Name|Value|Title|URL|Last visit|Visits|Parent folder ID|Added|State|Bytes received|Total bytes|Domain|Path|Expires|Secure|HTTP only|Window ID|Pinned|Muted|Last modified|Read|Created|Version|Enabled|Type|Installation type|Control level|Origin|Setting|Primary pattern|Secondary pattern|Scope',
  ],
  ru: [
    'Данные и настройки браузера|Разделы данных|Экспорт JSON|Обновить|Загрузить данные|Поиск|Точный origin|Разрешить доступ|Записи|Подробности|Действия|Страницы|Назад|Далее|Черновик|Изменения|Сохранить|Отмена|Подтвердить|Предпросмотр экспорта JSON|Скачать JSON|Да|Нет|Подтвердите действие для выбранной записи.|Сохраните или отмените правку перед обновлением.|Нажмите «Загрузить данные», чтобы прочитать раздел.|Подходящих записей нет.|Результаты ограничены загруженными записями|Сохранено|Доступ разрешён. Нажмите «Загрузить данные».|Доступ изменился. Загрузите раздел заново.|Для этого раздела нужен доступ.|Доступ не предоставлен.|Недоступно в этом браузере.|Проверьте введённые значения.|Управляется другим расширением или администратором.|Запись изменилась. Загрузите свежие данные.|Откройте этот раздел, чтобы продолжить.|Истекло время ожидания операции.|Выполняется операция.|Не удалось выполнить операцию.|Введите HTTP- или HTTPS-origin без пути, параметров и фрагмента.',
    'Обзор|История|Закладки|Загрузки|Cookies|Вкладки и окна|Сеансы|Популярные сайты|Список для чтения|Расширения|Приватность|Разрешения сайтов|Система|Аккаунт|Внутренние страницы',
    'Создать|Изменить|Переместить|Удалить|Приостановить|Продолжить|Отменить|Удалить запись|Активировать|Восстановить|Настройка браузера|Открыть|Открыть API Guard',
    'Название|Значение|Заголовок|URL|Последний визит|Посещения|ID родительской папки|Добавлено|Состояние|Получено байт|Всего байт|Домен|Путь|Срок действия|Secure|Только HTTP|ID окна|Закреплена|Звук выключен|Изменено|Прочитано|Создано|Версия|Включено|Тип|Тип установки|Уровень управления|Origin|Настройка|Основной шаблон|Дополнительный шаблон|Область',
  ],
  zh_CN: [
    '浏览器数据和设置|数据分类|导出 JSON|刷新|加载数据|搜索|精确来源|授予访问权限|记录|详情|操作|页码|上一页|下一页|草稿|更改|保存|取消|确认|JSON 导出预览|下载 JSON|是|否|确认对所选记录执行此操作。|刷新前请保存或取消编辑。|选择“加载数据”以读取此分类。|没有匹配的记录。|结果仅限已加载的记录|已保存|已授予访问权限。请选择“加载数据”。|访问权限已更改。请重新加载。|此分类需要访问权限。|未授予访问权限。|此浏览器不支持。|请检查输入值。|由其他扩展或管理员控制。|记录已更改。请加载最新数据。|请打开此分类以继续。|操作超时。|正在执行操作。|无法完成操作。|请输入不含路径、查询或片段的 HTTP 或 HTTPS 来源。',
    '概览|历史记录|书签|下载|Cookies|标签页和窗口|会话|常用网站|阅读清单|扩展|隐私设置|网站权限|系统|账号|浏览器内部页面',
    '创建|编辑|移动|删除|暂停|继续|取消|清除记录|激活|恢复|使用浏览器设置|打开|打开 API Guard',
    '名称|值|标题|URL|上次访问|访问次数|父文件夹 ID|添加时间|状态|已接收字节|总字节|域名|路径|到期时间|安全|仅 HTTP|窗口 ID|已固定|已静音|修改时间|已读|创建时间|版本|已启用|类型|安装类型|控制级别|来源|设置|主要模式|次要模式|范围',
  ],
  vi: [
    'Dữ liệu và cài đặt trình duyệt|Mục dữ liệu|Xuất JSON|Làm mới|Tải dữ liệu|Tìm kiếm|Nguồn gốc chính xác|Cấp quyền truy cập|Bản ghi|Chi tiết|Thao tác|Trang|Trước|Tiếp|Bản nháp|Thay đổi|Lưu|Hủy|Xác nhận|Xem trước JSON xuất|Tải JSON xuống|Có|Không|Xác nhận thao tác cho bản ghi đã chọn.|Lưu hoặc hủy chỉnh sửa trước khi làm mới.|Chọn Tải dữ liệu để đọc mục này.|Không có bản ghi phù hợp.|Kết quả chỉ gồm các bản ghi đã tải|Đã lưu|Đã cấp quyền. Chọn Tải dữ liệu.|Quyền đã thay đổi. Hãy tải lại mục này.|Mục này cần quyền truy cập.|Chưa được cấp quyền truy cập.|Không có trong trình duyệt này.|Kiểm tra các giá trị đã nhập.|Do tiện ích khác hoặc quản trị viên kiểm soát.|Bản ghi đã thay đổi. Hãy tải dữ liệu mới.|Mở mục này để tiếp tục.|Thao tác đã hết thời gian chờ.|Đang thực hiện thao tác.|Không thể hoàn tất thao tác.|Nhập nguồn gốc HTTP hoặc HTTPS không có đường dẫn, truy vấn hay phân đoạn.',
    'Tổng quan|Lịch sử|Dấu trang|Tải xuống|Cookies|Thẻ và cửa sổ|Phiên|Trang hàng đầu|Danh sách đọc|Tiện ích|Cài đặt riêng tư|Quyền trang web|Hệ thống|Tài khoản|Trang nội bộ',
    'Tạo|Sửa|Di chuyển|Xóa|Tạm dừng|Tiếp tục|Hủy|Xóa bản ghi|Kích hoạt|Khôi phục|Dùng cài đặt trình duyệt|Mở|Mở API Guard',
    'Tên|Giá trị|Tiêu đề|URL|Lần truy cập cuối|Lượt truy cập|ID thư mục cha|Đã thêm|Trạng thái|Byte đã nhận|Tổng byte|Miền|Đường dẫn|Hết hạn|Bảo mật|Chỉ HTTP|ID cửa sổ|Đã ghim|Đã tắt tiếng|Sửa lần cuối|Đã đọc|Đã tạo|Phiên bản|Đã bật|Loại|Kiểu cài đặt|Mức kiểm soát|Nguồn gốc|Cài đặt|Mẫu chính|Mẫu phụ|Phạm vi',
  ],
  es: [
    'Datos y ajustes del navegador|Secciones de datos|Exportar JSON|Actualizar|Cargar datos|Buscar|Origen exacto|Conceder acceso|Registros|Detalles|Acciones|Páginas|Anterior|Siguiente|Borrador|Cambios|Guardar|Cancelar|Confirmar|Vista previa del JSON|Descargar JSON|Sí|No|Confirma esta acción para el registro seleccionado.|Guarda o cancela la edición antes de actualizar.|Selecciona Cargar datos para leer esta sección.|No hay registros coincidentes.|Resultados limitados a los registros cargados|Guardado|Acceso concedido. Selecciona Cargar datos.|El acceso cambió. Vuelve a cargar la sección.|Esta sección requiere acceso.|No se concedió acceso.|No disponible en este navegador.|Revisa los valores introducidos.|Controlado por otra extensión o un administrador.|El registro cambió. Carga datos recientes.|Abre esta sección para continuar.|La operación agotó el tiempo de espera.|Hay una operación en curso.|No se pudo completar la operación.|Introduce un origen HTTP o HTTPS sin ruta, consulta ni fragmento.',
    'Resumen|Historial|Marcadores|Descargas|Cookies|Pestañas y ventanas|Sesiones|Sitios principales|Lista de lectura|Extensiones|Privacidad|Permisos de sitios|Sistema|Cuenta|Páginas internas',
    'Crear|Editar|Mover|Eliminar|Pausar|Reanudar|Cancelar|Borrar registro|Activar|Restaurar|Usar ajuste del navegador|Abrir|Abrir API Guard',
    'Nombre|Valor|Título|URL|Última visita|Visitas|ID de carpeta superior|Añadido|Estado|Bytes recibidos|Bytes totales|Dominio|Ruta|Caducidad|Seguro|Solo HTTP|ID de ventana|Fijada|Silenciada|Última modificación|Leído|Creado|Versión|Activado|Tipo|Tipo de instalación|Nivel de control|Origen|Ajuste|Patrón principal|Patrón secundario|Ámbito',
  ],
  ar: [
    'بيانات المتصفح وإعداداته|أقسام البيانات|تصدير JSON|تحديث|تحميل البيانات|بحث|الأصل الدقيق|منح الوصول|السجلات|التفاصيل|الإجراءات|الصفحات|السابق|التالي|مسودة|التغييرات|حفظ|إلغاء|تأكيد|معاينة تصدير JSON|تنزيل JSON|نعم|لا|أكد هذا الإجراء للسجل المحدد.|احفظ التعديل أو ألغِه قبل التحديث.|اختر تحميل البيانات لقراءة هذا القسم.|لا توجد سجلات مطابقة.|تقتصر النتائج على السجلات المحملة|تم الحفظ|تم منح الوصول. اختر تحميل البيانات.|تغير الوصول. حمّل القسم مجددًا.|يلزم الوصول لهذا القسم.|لم يُمنح الوصول.|غير متاح في هذا المتصفح.|تحقق من القيم المدخلة.|تتحكم فيه إضافة أخرى أو المشرف.|تغير السجل. حمّل بيانات حديثة.|افتح هذا القسم للمتابعة.|انتهت مهلة العملية.|توجد عملية قيد التنفيذ.|تعذر إكمال العملية.|أدخل أصل HTTP أو HTTPS دون مسار أو استعلام أو جزء.',
    'نظرة عامة|السجل|الإشارات المرجعية|التنزيلات|Cookies|علامات التبويب والنوافذ|الجلسات|المواقع الأكثر زيارة|قائمة القراءة|الإضافات|الخصوصية|أذونات المواقع|النظام|الحساب|صفحات المتصفح الداخلية',
    'إنشاء|تعديل|نقل|حذف|إيقاف مؤقت|استئناف|إلغاء|مسح السجل|تنشيط|استعادة|استخدام إعداد المتصفح|فتح|فتح API Guard',
    'الاسم|القيمة|العنوان|URL|آخر زيارة|الزيارات|معرف المجلد الأب|تاريخ الإضافة|الحالة|البايتات المستلمة|إجمالي البايتات|النطاق|المسار|انتهاء الصلاحية|آمن|HTTP فقط|معرف النافذة|مثبت|مكتوم|آخر تعديل|مقروء|تاريخ الإنشاء|الإصدار|مفعّل|النوع|نوع التثبيت|مستوى التحكم|الأصل|الإعداد|النمط الأساسي|النمط الثانوي|النطاق',
  ],
  uk: [
    'Дані та налаштування браузера|Розділи даних|Експорт JSON|Оновити|Завантажити дані|Пошук|Точний origin|Надати доступ|Записи|Подробиці|Дії|Сторінки|Назад|Далі|Чернетка|Зміни|Зберегти|Скасувати|Підтвердити|Перегляд експорту JSON|Завантажити JSON|Так|Ні|Підтвердьте дію для вибраного запису.|Збережіть або скасуйте редагування перед оновленням.|Натисніть «Завантажити дані», щоб прочитати розділ.|Відповідних записів немає.|Результати обмежено завантаженими записами|Збережено|Доступ надано. Натисніть «Завантажити дані».|Доступ змінився. Завантажте розділ повторно.|Для цього розділу потрібен доступ.|Доступ не надано.|Недоступно в цьому браузері.|Перевірте введені значення.|Керується іншим розширенням або адміністратором.|Запис змінився. Завантажте свіжі дані.|Відкрийте цей розділ, щоб продовжити.|Час очікування операції минув.|Виконується операція.|Не вдалося виконати операцію.|Введіть HTTP- або HTTPS-origin без шляху, параметрів і фрагмента.',
    'Огляд|Історія|Закладки|Завантаження|Cookies|Вкладки й вікна|Сеанси|Популярні сайти|Список читання|Розширення|Приватність|Дозволи сайтів|Система|Обліковий запис|Внутрішні сторінки',
    'Створити|Редагувати|Перемістити|Видалити|Призупинити|Продовжити|Скасувати|Видалити запис|Активувати|Відновити|Налаштування браузера|Відкрити|Відкрити API Guard',
    'Назва|Значення|Заголовок|URL|Останній візит|Відвідування|ID батьківської папки|Додано|Стан|Отримано байтів|Усього байтів|Домен|Шлях|Термін дії|Secure|Лише HTTP|ID вікна|Закріплена|Звук вимкнено|Змінено|Прочитано|Створено|Версія|Увімкнено|Тип|Тип установлення|Рівень керування|Origin|Налаштування|Основний шаблон|Додатковий шаблон|Область',
  ],
  fr: [
    'Données et paramètres du navigateur|Sections de données|Exporter JSON|Actualiser|Charger les données|Rechercher|Origine exacte|Autoriser l’accès|Entrées|Détails|Actions|Pages|Précédent|Suivant|Brouillon|Modifications|Enregistrer|Annuler|Confirmer|Aperçu du JSON exporté|Télécharger JSON|Oui|Non|Confirmez cette action pour l’entrée sélectionnée.|Enregistrez ou annulez la modification avant d’actualiser.|Sélectionnez Charger les données pour lire cette section.|Aucune entrée correspondante.|Résultats limités aux entrées chargées|Enregistré|Accès autorisé. Sélectionnez Charger les données.|L’accès a changé. Rechargez la section.|Cette section nécessite un accès.|L’accès n’a pas été autorisé.|Indisponible dans ce navigateur.|Vérifiez les valeurs saisies.|Contrôlé par une autre extension ou un administrateur.|L’entrée a changé. Chargez des données récentes.|Ouvrez cette section pour continuer.|Le délai de l’opération a expiré.|Une opération est en cours.|Impossible de terminer l’opération.|Saisissez une origine HTTP ou HTTPS sans chemin, requête ni fragment.',
    'Aperçu|Historique|Favoris|Téléchargements|Cookies|Onglets et fenêtres|Sessions|Sites fréquents|Liste de lecture|Extensions|Confidentialité|Autorisations des sites|Système|Compte|Pages internes',
    'Créer|Modifier|Déplacer|Supprimer|Suspendre|Reprendre|Annuler|Effacer l’entrée|Activer|Restaurer|Réglage du navigateur|Ouvrir|Ouvrir API Guard',
    'Nom|Valeur|Titre|URL|Dernière visite|Visites|ID du dossier parent|Ajouté|État|Octets reçus|Octets totaux|Domaine|Chemin|Expiration|Sécurisé|HTTP uniquement|ID de fenêtre|Épinglé|Muet|Dernière modification|Lu|Créé|Version|Activé|Type|Type d’installation|Niveau de contrôle|Origine|Paramètre|Motif principal|Motif secondaire|Portée',
  ],
  pt_BR: [
    'Dados e configurações do navegador|Seções de dados|Exportar JSON|Atualizar|Carregar dados|Pesquisar|Origem exata|Permitir acesso|Registros|Detalhes|Ações|Páginas|Anterior|Próxima|Rascunho|Alterações|Salvar|Cancelar|Confirmar|Prévia da exportação JSON|Baixar JSON|Sim|Não|Confirme esta ação para o registro selecionado.|Salve ou cancele a edição antes de atualizar.|Selecione Carregar dados para ler esta seção.|Nenhum registro correspondente.|Resultados limitados aos registros carregados|Salvo|Acesso permitido. Selecione Carregar dados.|O acesso mudou. Carregue a seção novamente.|Esta seção precisa de acesso.|O acesso não foi permitido.|Indisponível neste navegador.|Confira os valores inseridos.|Controlado por outra extensão ou administrador.|O registro mudou. Carregue dados recentes.|Abra esta seção para continuar.|A operação excedeu o tempo limite.|Há uma operação em andamento.|Não foi possível concluir a operação.|Insira uma origem HTTP ou HTTPS sem caminho, consulta ou fragmento.',
    'Visão geral|Histórico|Favoritos|Downloads|Cookies|Abas e janelas|Sessões|Sites principais|Lista de leitura|Extensões|Privacidade|Permissões de sites|Sistema|Conta|Páginas internas',
    'Criar|Editar|Mover|Excluir|Pausar|Retomar|Cancelar|Apagar registro|Ativar|Restaurar|Usar configuração do navegador|Abrir|Abrir API Guard',
    'Nome|Valor|Título|URL|Última visita|Visitas|ID da pasta superior|Adicionado|Estado|Bytes recebidos|Total de bytes|Domínio|Caminho|Expira em|Seguro|Somente HTTP|ID da janela|Fixada|Sem som|Última alteração|Lido|Criado|Versão|Ativado|Tipo|Tipo de instalação|Nível de controle|Origem|Configuração|Padrão principal|Padrão secundário|Escopo',
  ],
  hi: [
    'ब्राउज़र डेटा और सेटिंग्स|डेटा अनुभाग|JSON निर्यात करें|रिफ्रेश करें|डेटा लोड करें|खोजें|सटीक ओरिजिन|एक्सेस दें|रिकॉर्ड|विवरण|कार्रवाइयाँ|पृष्ठ|पिछला|अगला|ड्राफ़्ट|बदलाव|सहेजें|रद्द करें|पुष्टि करें|JSON निर्यात का पूर्वावलोकन|JSON डाउनलोड करें|हाँ|नहीं|चुने गए रिकॉर्ड के लिए इस कार्रवाई की पुष्टि करें।|रिफ्रेश करने से पहले संपादन सहेजें या रद्द करें।|यह अनुभाग पढ़ने के लिए डेटा लोड करें चुनें।|कोई मेल खाता रिकॉर्ड नहीं।|परिणाम केवल लोड किए गए रिकॉर्ड तक सीमित हैं|सहेजा गया|एक्सेस मिल गया। डेटा लोड करें चुनें।|एक्सेस बदल गया। अनुभाग फिर लोड करें।|इस अनुभाग के लिए एक्सेस ज़रूरी है।|एक्सेस नहीं मिला।|इस ब्राउज़र में उपलब्ध नहीं।|दर्ज मान जाँचें।|दूसरे एक्सटेंशन या व्यवस्थापक द्वारा नियंत्रित।|रिकॉर्ड बदल गया। नया डेटा लोड करें।|जारी रखने के लिए यह अनुभाग खोलें।|कार्रवाई का समय समाप्त हो गया।|एक कार्रवाई जारी है।|कार्रवाई पूरी नहीं हो सकी।|पथ, क्वेरी या फ़्रैगमेंट के बिना HTTP या HTTPS ओरिजिन दर्ज करें।',
    'अवलोकन|इतिहास|बुकमार्क|डाउनलोड|Cookies|टैब और विंडो|सत्र|प्रमुख साइटें|पठन सूची|एक्सटेंशन|निजता सेटिंग्स|साइट अनुमतियाँ|सिस्टम|खाता|आंतरिक पृष्ठ',
    'बनाएँ|संपादित करें|स्थान बदलें|हटाएँ|रोकें|फिर शुरू करें|रद्द करें|रिकॉर्ड मिटाएँ|सक्रिय करें|बहाल करें|ब्राउज़र सेटिंग इस्तेमाल करें|खोलें|API Guard खोलें',
    'नाम|मान|शीर्षक|URL|पिछली विज़िट|विज़िट|मूल फ़ोल्डर ID|जोड़ा गया|स्थिति|प्राप्त बाइट|कुल बाइट|डोमेन|पथ|समाप्ति|सुरक्षित|केवल HTTP|विंडो ID|पिन किया गया|म्यूट|पिछला बदलाव|पढ़ा गया|बनाया गया|संस्करण|सक्षम|प्रकार|इंस्टॉलेशन प्रकार|नियंत्रण स्तर|ओरिजिन|सेटिंग|प्राथमिक पैटर्न|द्वितीयक पैटर्न|दायरा',
  ],
  ur: [
    'براؤزر کا ڈیٹا اور ترتیبات|ڈیٹا کے حصے|JSON برآمد کریں|تازہ کریں|ڈیٹا لوڈ کریں|تلاش|درست اوریجن|رسائی دیں|ریکارڈ|تفصیلات|اعمال|صفحات|پچھلا|اگلا|مسودہ|تبدیلیاں|محفوظ کریں|منسوخ کریں|تصدیق کریں|JSON برآمد کا پیش منظر|JSON ڈاؤن لوڈ کریں|ہاں|نہیں|منتخب ریکارڈ کے لیے اس عمل کی تصدیق کریں۔|تازہ کرنے سے پہلے ترمیم محفوظ یا منسوخ کریں۔|یہ حصہ پڑھنے کے لیے ڈیٹا لوڈ کریں منتخب کریں۔|کوئی مماثل ریکارڈ نہیں۔|نتائج صرف لوڈ شدہ ریکارڈ تک محدود ہیں|محفوظ ہو گیا|رسائی مل گئی۔ ڈیٹا لوڈ کریں منتخب کریں۔|رسائی بدل گئی۔ حصہ دوبارہ لوڈ کریں۔|اس حصے کے لیے رسائی درکار ہے۔|رسائی نہیں ملی۔|اس براؤزر میں دستیاب نہیں۔|درج کردہ اقدار چیک کریں۔|دوسری ایکسٹینشن یا منتظم کے زیر کنٹرول۔|ریکارڈ بدل گیا۔ تازہ ڈیٹا لوڈ کریں۔|جاری رکھنے کے لیے یہ حصہ کھولیں۔|عمل کا وقت ختم ہو گیا۔|ایک عمل جاری ہے۔|عمل مکمل نہیں ہو سکا۔|راستے، کوئری یا فریگمنٹ کے بغیر HTTP یا HTTPS اوریجن درج کریں۔',
    'جائزہ|تاریخ|بک مارکس|ڈاؤن لوڈز|Cookies|ٹیب اور ونڈوز|سیشن|مقبول سائٹس|پڑھنے کی فہرست|ایکسٹینشنز|رازداری|سائٹ اجازتیں|سسٹم|اکاؤنٹ|اندرونی صفحات',
    'بنائیں|ترمیم کریں|منتقل کریں|حذف کریں|روکیں|دوبارہ شروع کریں|منسوخ کریں|ریکارڈ مٹائیں|فعال کریں|بحال کریں|براؤزر کی ترتیب استعمال کریں|کھولیں|API Guard کھولیں',
    'نام|قدر|عنوان|URL|آخری دورہ|دورے|بنیادی فولڈر ID|شامل کیا گیا|حالت|موصولہ بائٹس|کل بائٹس|ڈومین|راستہ|میعاد|محفوظ|صرف HTTP|ونڈو ID|پن کیا گیا|خاموش|آخری تبدیلی|پڑھا گیا|بنایا گیا|ورژن|فعال|قسم|انسٹالیشن کی قسم|کنٹرول کی سطح|اوریجن|ترتیب|بنیادی پیٹرن|ثانوی پیٹرن|دائرہ',
  ],
  ja: [
    'ブラウザーのデータと設定|データ分類|JSONをエクスポート|更新|データを読み込む|検索|正確なオリジン|アクセスを許可|レコード|詳細|操作|ページ|前へ|次へ|下書き|変更内容|保存|キャンセル|確認|JSONエクスポートのプレビュー|JSONをダウンロード|はい|いいえ|選択したレコードへの操作を確認してください。|更新する前に編集を保存またはキャンセルしてください。|この分類を読むには「データを読み込む」を選択してください。|一致するレコードはありません。|読み込んだレコードに限定した結果|保存しました|アクセスを許可しました。データを読み込んでください。|アクセスが変わりました。再読み込みしてください。|この分類にはアクセス許可が必要です。|アクセスは許可されませんでした。|このブラウザーでは利用できません。|入力した値を確認してください。|他の拡張機能または管理者が制御しています。|レコードが変わりました。最新データを読み込んでください。|続行するにはこの分類を開いてください。|操作がタイムアウトしました。|操作を実行中です。|操作を完了できませんでした。|パス、クエリー、フラグメントを含まないHTTPまたはHTTPSオリジンを入力してください。',
    '概要|履歴|ブックマーク|ダウンロード|Cookies|タブとウィンドウ|セッション|よく使うサイト|リーディングリスト|拡張機能|プライバシー設定|サイトの権限|システム|アカウント|内部ページ',
    '作成|編集|移動|削除|一時停止|再開|キャンセル|記録を消去|アクティブ化|復元|ブラウザー設定を使用|開く|API Guardを開く',
    '名前|値|タイトル|URL|最終訪問|訪問回数|親フォルダーID|追加日時|状態|受信バイト|合計バイト|ドメイン|パス|有効期限|セキュア|HTTPのみ|ウィンドウID|固定|ミュート|最終更新|既読|作成日時|バージョン|有効|種類|インストールの種類|制御レベル|オリジン|設定|主パターン|副パターン|範囲',
  ],
  de: [
    'Browserdaten und Einstellungen|Datenbereiche|JSON exportieren|Aktualisieren|Daten laden|Suchen|Exakter Ursprung|Zugriff erlauben|Einträge|Details|Aktionen|Seiten|Zurück|Weiter|Entwurf|Änderungen|Speichern|Abbrechen|Bestätigen|Vorschau des JSON-Exports|JSON herunterladen|Ja|Nein|Bestätige die Aktion für den ausgewählten Eintrag.|Vor dem Aktualisieren die Bearbeitung speichern oder abbrechen.|Zum Lesen dieses Bereichs Daten laden auswählen.|Keine passenden Einträge.|Ergebnisse auf geladene Einträge begrenzt|Gespeichert|Zugriff erlaubt. Daten laden auswählen.|Zugriff geändert. Bereich erneut laden.|Für diesen Bereich ist Zugriff erforderlich.|Zugriff wurde nicht erlaubt.|In diesem Browser nicht verfügbar.|Eingegebene Werte prüfen.|Von einer anderen Erweiterung oder einem Administrator gesteuert.|Eintrag geändert. Aktuelle Daten laden.|Diesen Bereich öffnen, um fortzufahren.|Zeitüberschreitung bei der Aktion.|Eine Aktion wird ausgeführt.|Aktion konnte nicht abgeschlossen werden.|Einen HTTP- oder HTTPS-Ursprung ohne Pfad, Abfrage oder Fragment eingeben.',
    'Übersicht|Verlauf|Lesezeichen|Downloads|Cookies|Tabs und Fenster|Sitzungen|Häufige Websites|Leseliste|Erweiterungen|Datenschutz|Websiteberechtigungen|System|Konto|Interne Seiten',
    'Erstellen|Bearbeiten|Verschieben|Löschen|Pausieren|Fortsetzen|Abbrechen|Eintrag entfernen|Aktivieren|Wiederherstellen|Browsereinstellung verwenden|Öffnen|API Guard öffnen',
    'Name|Wert|Titel|URL|Letzter Besuch|Besuche|ID des übergeordneten Ordners|Hinzugefügt|Status|Empfangene Bytes|Bytes insgesamt|Domain|Pfad|Ablaufdatum|Sicher|Nur HTTP|Fenster-ID|Angeheftet|Stumm|Zuletzt geändert|Gelesen|Erstellt|Version|Aktiviert|Typ|Installationstyp|Steuerungsebene|Ursprung|Einstellung|Primäres Muster|Sekundäres Muster|Bereich',
  ],
  pl: [
    'Dane i ustawienia przeglądarki|Sekcje danych|Eksportuj JSON|Odśwież|Wczytaj dane|Szukaj|Dokładne źródło|Zezwól na dostęp|Rekordy|Szczegóły|Działania|Strony|Poprzednia|Następna|Szkic|Zmiany|Zapisz|Anuluj|Potwierdź|Podgląd eksportu JSON|Pobierz JSON|Tak|Nie|Potwierdź działanie dla wybranego rekordu.|Zapisz lub anuluj edycję przed odświeżeniem.|Wybierz Wczytaj dane, aby odczytać tę sekcję.|Brak pasujących rekordów.|Wyniki ograniczone do wczytanych rekordów|Zapisano|Dostęp przyznany. Wybierz Wczytaj dane.|Dostęp się zmienił. Wczytaj sekcję ponownie.|Ta sekcja wymaga dostępu.|Nie przyznano dostępu.|Niedostępne w tej przeglądarce.|Sprawdź wprowadzone wartości.|Kontrolowane przez inne rozszerzenie lub administratora.|Rekord się zmienił. Wczytaj aktualne dane.|Otwórz tę sekcję, aby kontynuować.|Przekroczono czas operacji.|Trwa operacja.|Nie udało się ukończyć operacji.|Wpisz źródło HTTP lub HTTPS bez ścieżki, zapytania i fragmentu.',
    'Przegląd|Historia|Zakładki|Pobrane|Cookies|Karty i okna|Sesje|Popularne witryny|Lista czytelnicza|Rozszerzenia|Prywatność|Uprawnienia witryn|System|Konto|Strony wewnętrzne',
    'Utwórz|Edytuj|Przenieś|Usuń|Wstrzymaj|Wznów|Anuluj|Wymaż rekord|Aktywuj|Przywróć|Użyj ustawienia przeglądarki|Otwórz|Otwórz API Guard',
    'Nazwa|Wartość|Tytuł|URL|Ostatnia wizyta|Wizyty|ID folderu nadrzędnego|Dodano|Stan|Odebrane bajty|Wszystkie bajty|Domena|Ścieżka|Wygasa|Bezpieczne|Tylko HTTP|ID okna|Przypięta|Wyciszona|Ostatnia zmiana|Przeczytane|Utworzono|Wersja|Włączone|Typ|Typ instalacji|Poziom kontroli|Źródło|Ustawienie|Główny wzorzec|Dodatkowy wzorzec|Zakres',
  ],
  id: [
    'Data dan setelan browser|Bagian data|Ekspor JSON|Muat ulang|Muat data|Cari|Origin persis|Izinkan akses|Rekaman|Detail|Tindakan|Halaman|Sebelumnya|Berikutnya|Draf|Perubahan|Simpan|Batal|Konfirmasi|Pratinjau ekspor JSON|Unduh JSON|Ya|Tidak|Konfirmasi tindakan untuk rekaman terpilih.|Simpan atau batalkan edit sebelum memuat ulang.|Pilih Muat data untuk membaca bagian ini.|Tidak ada rekaman yang cocok.|Hasil terbatas pada rekaman yang dimuat|Disimpan|Akses diberikan. Pilih Muat data.|Akses berubah. Muat ulang bagian ini.|Bagian ini memerlukan akses.|Akses tidak diberikan.|Tidak tersedia di browser ini.|Periksa nilai yang dimasukkan.|Dikendalikan ekstensi lain atau administrator.|Rekaman berubah. Muat data terbaru.|Buka bagian ini untuk melanjutkan.|Waktu operasi habis.|Operasi sedang berlangsung.|Tidak dapat menyelesaikan operasi.|Masukkan origin HTTP atau HTTPS tanpa jalur, kueri, atau fragmen.',
    'Ringkasan|Histori|Bookmark|Download|Cookies|Tab dan jendela|Sesi|Situs teratas|Daftar bacaan|Ekstensi|Privasi|Izin situs|Sistem|Akun|Halaman internal',
    'Buat|Edit|Pindahkan|Hapus|Jeda|Lanjutkan|Batal|Hapus rekaman|Aktifkan|Pulihkan|Gunakan setelan browser|Buka|Buka API Guard',
    'Nama|Nilai|Judul|URL|Kunjungan terakhir|Kunjungan|ID folder induk|Ditambahkan|Status|Byte diterima|Total byte|Domain|Jalur|Kedaluwarsa|Aman|Hanya HTTP|ID jendela|Disematkan|Dibisukan|Terakhir diubah|Dibaca|Dibuat|Versi|Diaktifkan|Jenis|Jenis pemasangan|Tingkat kendali|Origin|Setelan|Pola utama|Pola sekunder|Cakupan',
  ],
  mr: [
    'ब्राउझर डेटा आणि सेटिंग्ज|डेटा विभाग|JSON निर्यात करा|रिफ्रेश करा|डेटा लोड करा|शोधा|अचूक ओरिजिन|प्रवेश द्या|नोंदी|तपशील|कृती|पृष्ठे|मागील|पुढील|मसुदा|बदल|जतन करा|रद्द करा|पुष्टी करा|JSON निर्यातीचे पूर्वावलोकन|JSON डाउनलोड करा|होय|नाही|निवडलेल्या नोंदीसाठी या कृतीची पुष्टी करा.|रिफ्रेश करण्यापूर्वी संपादन जतन किंवा रद्द करा.|हा विभाग वाचण्यासाठी डेटा लोड करा निवडा.|जुळणाऱ्या नोंदी नाहीत.|निकाल फक्त लोड केलेल्या नोंदींपुरते मर्यादित|जतन केले|प्रवेश दिला. डेटा लोड करा निवडा.|प्रवेश बदलला. विभाग पुन्हा लोड करा.|या विभागासाठी प्रवेश आवश्यक आहे.|प्रवेश दिला गेला नाही.|या ब्राउझरमध्ये उपलब्ध नाही.|दिलेली मूल्ये तपासा.|दुसरे विस्तार किंवा प्रशासक नियंत्रित करतो.|नोंद बदलली. नवीन डेटा लोड करा.|पुढे जाण्यासाठी हा विभाग उघडा.|कृतीची वेळ संपली.|एक कृती सुरू आहे.|कृती पूर्ण करता आली नाही.|पथ, क्वेरी किंवा फ्रॅगमेंट नसलेले HTTP किंवा HTTPS ओरिजिन द्या.',
    'आढावा|इतिहास|बुकमार्क|डाउनलोड|Cookies|टॅब आणि विंडो|सत्रे|लोकप्रिय साइट|वाचन सूची|विस्तार|गोपनीयता|साइट परवानग्या|सिस्टम|खाते|अंतर्गत पृष्ठे',
    'तयार करा|संपादित करा|हलवा|हटवा|थांबवा|पुन्हा सुरू करा|रद्द करा|नोंद पुसा|सक्रिय करा|पुनर्संचयित करा|ब्राउझर सेटिंग वापरा|उघडा|API Guard उघडा',
    'नाव|मूल्य|शीर्षक|URL|शेवटची भेट|भेटी|पालक फोल्डर ID|जोडले|स्थिती|मिळालेले बाइट|एकूण बाइट|डोमेन|पथ|मुदत|सुरक्षित|फक्त HTTP|विंडो ID|पिन केले|म्यूट|शेवटचा बदल|वाचले|तयार केले|आवृत्ती|सक्षम|प्रकार|स्थापना प्रकार|नियंत्रण स्तर|ओरिजिन|सेटिंग|प्राथमिक नमुना|दुय्यम नमुना|व्याप्ती',
  ],
  te: [
    'బ్రౌజర్ డేటా మరియు సెట్టింగ్‌లు|డేటా విభాగాలు|JSON ఎగుమతి|రిఫ్రెష్|డేటా లోడ్ చేయండి|వెతకండి|ఖచ్చితమైన ఆరిజిన్|యాక్సెస్ ఇవ్వండి|రికార్డులు|వివరాలు|చర్యలు|పేజీలు|మునుపటి|తదుపరి|డ్రాఫ్ట్|మార్పులు|సేవ్|రద్దు|నిర్ధారించండి|JSON ఎగుమతి ప్రివ్యూ|JSON డౌన్‌లోడ్|అవును|కాదు|ఎంచుకున్న రికార్డుపై ఈ చర్యను నిర్ధారించండి.|రిఫ్రెష్ చేసే ముందు మార్పును సేవ్ చేయండి లేదా రద్దు చేయండి.|ఈ విభాగాన్ని చదవడానికి డేటా లోడ్ చేయండి ఎంచుకోండి.|సరిపోలే రికార్డులు లేవు.|లోడ్ చేసిన రికార్డులకు మాత్రమే ఫలితాలు పరిమితం|సేవ్ అయింది|యాక్సెస్ ఇచ్చారు. డేటా లోడ్ చేయండి ఎంచుకోండి.|యాక్సెస్ మారింది. విభాగాన్ని మళ్లీ లోడ్ చేయండి.|ఈ విభాగానికి యాక్సెస్ అవసరం.|యాక్సెస్ ఇవ్వలేదు.|ఈ బ్రౌజర్‌లో అందుబాటులో లేదు.|నమోదు చేసిన విలువలను తనిఖీ చేయండి.|మరో పొడిగింపు లేదా అడ్మినిస్ట్రేటర్ నియంత్రిస్తున్నారు.|రికార్డు మారింది. తాజా డేటా లోడ్ చేయండి.|కొనసాగించడానికి ఈ విభాగాన్ని తెరవండి.|చర్య సమయం ముగిసింది.|చర్య జరుగుతోంది.|చర్యను పూర్తి చేయలేకపోయాం.|పాత్, క్వెరీ లేదా ఫ్రాగ్మెంట్ లేని HTTP లేదా HTTPS ఆరిజిన్ నమోదు చేయండి.',
    'అవలోకనం|చరిత్ర|బుక్‌మార్క్‌లు|డౌన్‌లోడ్‌లు|Cookies|ట్యాబ్‌లు మరియు విండోలు|సెషన్‌లు|అగ్ర సైట్‌లు|చదివే జాబితా|పొడిగింపులు|గోప్యత|సైట్ అనుమతులు|సిస్టమ్|ఖాతా|అంతర్గత పేజీలు',
    'సృష్టించండి|సవరించండి|తరలించండి|తొలగించండి|పాజ్|కొనసాగించండి|రద్దు|రికార్డు చెరపండి|యాక్టివేట్|పునరుద్ధరించండి|బ్రౌజర్ సెట్టింగ్ వాడండి|తెరవండి|API Guard తెరవండి',
    'పేరు|విలువ|శీర్షిక|URL|చివరి సందర్శన|సందర్శనలు|పేరెంట్ ఫోల్డర్ ID|జోడించారు|స్థితి|అందుకున్న బైట్లు|మొత్తం బైట్లు|డొమైన్|పాత్|గడువు|సురక్షితం|HTTP మాత్రమే|విండో ID|పిన్ అయింది|మ్యూట్|చివరి మార్పు|చదివారు|సృష్టించారు|వెర్షన్|ప్రారంభమైంది|రకం|ఇన్‌స్టాలేషన్ రకం|నియంత్రణ స్థాయి|ఆరిజిన్|సెట్టింగ్|ప్రధాన నమూనా|ద్వితీయ నమూనా|పరిధి',
  ],
  ko: [
    '브라우저 데이터 및 설정|데이터 섹션|JSON 내보내기|새로고침|데이터 불러오기|검색|정확한 출처|접근 허용|레코드|세부 정보|작업|페이지|이전|다음|초안|변경 사항|저장|취소|확인|JSON 내보내기 미리보기|JSON 다운로드|예|아니요|선택한 레코드에 대한 작업을 확인하세요.|새로고침 전에 편집을 저장하거나 취소하세요.|이 섹션을 읽으려면 데이터 불러오기를 선택하세요.|일치하는 레코드가 없습니다.|불러온 레코드에 한정된 결과|저장됨|접근이 허용되었습니다. 데이터를 불러오세요.|접근 권한이 변경되었습니다. 다시 불러오세요.|이 섹션에 접근 권한이 필요합니다.|접근이 허용되지 않았습니다.|이 브라우저에서 사용할 수 없습니다.|입력한 값을 확인하세요.|다른 확장 프로그램 또는 관리자가 제어합니다.|레코드가 변경되었습니다. 최신 데이터를 불러오세요.|계속하려면 이 섹션을 여세요.|작업 시간이 초과되었습니다.|작업이 진행 중입니다.|작업을 완료하지 못했습니다.|경로, 쿼리, 프래그먼트가 없는 HTTP 또는 HTTPS 출처를 입력하세요.',
    '개요|방문 기록|북마크|다운로드|Cookies|탭 및 창|세션|인기 사이트|읽기 목록|확장 프로그램|개인정보 설정|사이트 권한|시스템|계정|내부 페이지',
    '만들기|편집|이동|삭제|일시 중지|다시 시작|취소|레코드 지우기|활성화|복원|브라우저 설정 사용|열기|API Guard 열기',
    '이름|값|제목|URL|최근 방문|방문 수|상위 폴더 ID|추가됨|상태|받은 바이트|총 바이트|도메인|경로|만료|보안|HTTP 전용|창 ID|고정됨|음소거됨|최근 수정|읽음|생성됨|버전|사용|유형|설치 유형|제어 수준|출처|설정|기본 패턴|보조 패턴|범위',
  ],
  ta: [
    'உலாவித் தரவும் அமைப்புகளும்|தரவுப் பிரிவுகள்|JSON ஏற்றுமதி|புதுப்பி|தரவை ஏற்று|தேடு|துல்லியமான origin|அணுகல் வழங்கு|பதிவுகள்|விவரங்கள்|செயல்கள்|பக்கங்கள்|முந்தையது|அடுத்தது|வரைவு|மாற்றங்கள்|சேமி|ரத்துசெய்|உறுதிசெய்|JSON ஏற்றுமதி முன்னோட்டம்|JSON பதிவிறக்கு|ஆம்|இல்லை|தேர்ந்தெடுத்த பதிவுக்கான செயலை உறுதிசெய்யவும்.|புதுப்பிக்கும் முன் திருத்தத்தைச் சேமிக்கவும் அல்லது ரத்துசெய்யவும்.|இப்பிரிவைப் படிக்க தரவை ஏற்று என்பதைத் தேர்ந்தெடுக்கவும்.|பொருந்தும் பதிவுகள் இல்லை.|ஏற்றப்பட்ட பதிவுகளுக்கு மட்டுமே முடிவுகள்|சேமிக்கப்பட்டது|அணுகல் வழங்கப்பட்டது. தரவை ஏற்றவும்.|அணுகல் மாறியது. பிரிவை மீண்டும் ஏற்றவும்.|இப்பிரிவுக்கு அணுகல் தேவை.|அணுகல் வழங்கப்படவில்லை.|இந்த உலாவியில் கிடைக்கவில்லை.|உள்ளிட்ட மதிப்புகளைச் சரிபார்க்கவும்.|வேறு நீட்டிப்பு அல்லது நிர்வாகியால் கட்டுப்படுத்தப்படுகிறது.|பதிவு மாறியது. புதிய தரவை ஏற்றவும்.|தொடர இப்பிரிவைத் திறக்கவும்.|செயலின் நேரம் முடிந்தது.|செயல் நடைபெறுகிறது.|செயலை முடிக்க முடியவில்லை.|பாதை, வினவல் அல்லது துண்டு இல்லாத HTTP அல்லது HTTPS origin-ஐ உள்ளிடவும்.',
    'கண்ணோட்டம்|வரலாறு|புக்மார்க்குகள்|பதிவிறக்கங்கள்|Cookies|தாவல்களும் சாளரங்களும்|அமர்வுகள்|முதன்மைத் தளங்கள்|வாசிப்புப் பட்டியல்|நீட்டிப்புகள்|தனியுரிமை|தள அனுமதிகள்|கணினி|கணக்கு|உள் பக்கங்கள்',
    'உருவாக்கு|திருத்து|நகர்த்து|நீக்கு|இடைநிறுத்து|தொடர்|ரத்துசெய்|பதிவை அழி|செயல்படுத்து|மீட்டமை|உலாவி அமைப்பைப் பயன்படுத்து|திற|API Guard திற',
    'பெயர்|மதிப்பு|தலைப்பு|URL|கடைசி வருகை|வருகைகள்|தாய்க் கோப்புறை ID|சேர்க்கப்பட்டது|நிலை|பெற்ற பைட்டுகள்|மொத்த பைட்டுகள்|டொமைன்|பாதை|காலாவதி|பாதுகாப்பானது|HTTP மட்டும்|சாளர ID|பின் செய்யப்பட்டது|ஒலி முடக்கம்|கடைசி மாற்றம்|வாசித்தது|உருவாக்கப்பட்டது|பதிப்பு|இயக்கப்பட்டது|வகை|நிறுவல் வகை|கட்டுப்பாட்டு நிலை|Origin|அமைப்பு|முதன்மை முறை|இரண்டாம் முறை|வரம்பு',
  ],
  yue: [
    '浏览器数据同设定|数据分类|汇出 JSON|重新整理|载入数据|搜寻|准确来源|允许存取|记录|详情|操作|页数|上一页|下一页|草稿|改动|储存|取消|确认|JSON 汇出预览|下载 JSON|系|唔系|确认对拣咗嘅记录执行呢个操作。|重新整理之前请储存或者取消编辑。|拣「载入数据」嚟读取呢个分类。|冇符合嘅记录。|结果只限已载入嘅记录|已储存|已允许存取。请拣「载入数据」。|存取权限改咗。请重新载入。|呢个分类需要存取权限。|未获存取权限。|呢个浏览器唔支援。|请检查输入值。|由其他扩展或者管理员控制。|记录改咗。请载入最新数据。|请打开呢个分类继续。|操作等候逾时。|操作进行紧。|完成唔到操作。|请输入冇路径、查询或者片段嘅 HTTP 或 HTTPS 来源。',
    '概览|历史记录|书签|下载|Cookies|分页同视窗|工作阶段|常用网站|阅读清单|扩展|私隐设定|网站权限|系统|帐号|浏览器内部页面',
    '建立|编辑|移动|删除|暂停|继续|取消|清除记录|启用|还原|用浏览器设定|打开|打开 API Guard',
    '名称|值|标题|URL|上次到访|到访次数|上层资料夹 ID|加入时间|状态|已收字节|总字节|网域|路径|到期时间|安全|只限 HTTP|视窗 ID|已固定|已静音|修改时间|已读|建立时间|版本|已启用|类型|安装类型|控制级别|来源|设定|主要模式|次要模式|范围',
  ],
  wuu: [
    '浏览器数据搭设置|数据分类|导出 JSON|刷新|载入数据|搜索|准确来源|允许访问|记录|详情|操作|页数|上一页|下一页|草稿|改动|保存|取消|确认|JSON 导出预览|下载 JSON|是|勿是|确认对选中个记录执行搿个操作。|刷新以前请保存或者取消编辑。|选「载入数据」来读取搿个分类。|呒没符合个记录。|结果只限已经载入个记录|已经保存|已经允许访问。请选「载入数据」。|访问权限变脱了。请重新载入。|搿个分类需要访问权限。|呒没得到访问权限。|搿个浏览器勿支持。|请检查输入个值。|由别个扩展或者管理员控制。|记录变脱了。请载入最新数据。|请打开搿个分类继续。|操作等候超时。|操作进行当中。|操作完成勿了。|请输入呒没路径、查询或者片段个 HTTP 或 HTTPS 来源。',
    '概览|历史记录|书签|下载|Cookies|标签页搭窗口|会话|常用网站|阅读清单|扩展|隐私设置|网站权限|系统|账号|浏览器内部页面',
    '创建|编辑|移动|删除|暂停|继续|取消|清除记录|激活|恢复|用浏览器设置|打开|打开 API Guard',
    '名称|值|标题|URL|上趟访问|访问次数|上级文件夹 ID|加入辰光|状态|收到字节|总字节|域名|路径|到期辰光|安全|只限 HTTP|窗口 ID|已经固定|已经静音|修改辰光|已经读过|创建辰光|版本|已经启用|类型|安装类型|控制级别|来源|设置|主要模式|次要模式|范围',
  ],
};

const NOT_APPLIED = {
  ru: 'Настройка не была применена. Обновите данные.', en: 'The setting was not applied. Refresh the data.',
  zh_CN: '设置未生效。请刷新数据。', vi: 'Cài đặt chưa được áp dụng. Hãy làm mới dữ liệu.', es: 'El ajuste no se aplicó. Actualiza los datos.',
  ar: 'لم يُطبق الإعداد. حدّث البيانات.', uk: 'Налаштування не застосовано. Оновіть дані.', fr: 'Le paramètre n’a pas été appliqué. Actualisez les données.',
  pt_BR: 'A configuração não foi aplicada. Atualize os dados.', hi: 'सेटिंग लागू नहीं हुई। डेटा रिफ्रेश करें।', ur: 'ترتیب لاگو نہیں ہوئی۔ ڈیٹا تازہ کریں۔',
  ja: '設定は適用されませんでした。データを更新してください。', de: 'Die Einstellung wurde nicht angewendet. Daten aktualisieren.', pl: 'Ustawienie nie zostało zastosowane. Odśwież dane.',
  id: 'Setelan tidak diterapkan. Muat ulang data.', mr: 'सेटिंग लागू झाली नाही. डेटा रिफ्रेश करा.', te: 'సెట్టింగ్ వర్తించలేదు. డేటాను రిఫ్రెష్ చేయండి.',
  ko: '설정이 적용되지 않았습니다. 데이터를 새로고침하세요.', ta: 'அமைப்பு பயன்படுத்தப்படவில்லை. தரவைப் புதுப்பிக்கவும்.', yue: '设定未生效。请重新整理数据。', wuu: '设置呒没生效。请刷新数据。',
};
const COOKIE_FIELDS = ['storeId', 'partitionTopLevelSite', 'hasCrossSiteAncestor', 'firstPartyDomain'];
const COOKIE_COPY = {
  ru: 'ID хранилища|Сайт верхнего уровня раздела|Есть межсайтовый предок|Домен первой стороны',
  en: 'Store ID|Partition top-level site|Cross-site ancestor|First-party domain',
  zh_CN: '存储 ID|分区顶层网站|跨站祖先|第一方域名',
  vi: 'ID kho lưu trữ|Trang cấp cao nhất của phân vùng|Có trang tổ tiên khác site|Miền bên thứ nhất',
  es: 'ID de almacén|Sitio superior de la partición|Ancestro entre sitios|Dominio de primera parte',
  ar: 'معرف المخزن|الموقع الأعلى للتقسيم|سلف من موقع آخر|نطاق الطرف الأول',
  uk: 'ID сховища|Сайт верхнього рівня розділу|Є міжсайтовий предок|Домен першої сторони',
  fr: 'ID du magasin|Site principal de la partition|Ancêtre intersites|Domaine propriétaire',
  pt_BR: 'ID do armazenamento|Site principal da partição|Ancestral entre sites|Domínio de primeira parte',
  hi: 'स्टोर ID|पार्टिशन की शीर्ष-स्तरीय साइट|क्रॉस-साइट पूर्वज|फ़र्स्ट-पार्टी डोमेन',
  ur: 'اسٹور ID|پارٹیشن کی اعلیٰ سطحی سائٹ|دوسری سائٹ کا جد|فرسٹ پارٹی ڈومین',
  ja: 'ストアID|パーティションの最上位サイト|クロスサイトの祖先|ファーストパーティードメイン',
  de: 'Speicher-ID|Oberste Website der Partition|Websiteübergreifender Vorfahr|Erstanbieter-Domain',
  pl: 'ID magazynu|Witryna najwyższego poziomu partycji|Przodek z innej witryny|Domena pierwszej strony',
  id: 'ID penyimpanan|Situs tingkat teratas partisi|Induk lintas situs|Domain pihak pertama',
  mr: 'स्टोअर ID|विभागाची सर्वोच्च साइट|क्रॉस-साइट पूर्वज|प्रथम-पक्ष डोमेन',
  te: 'స్టోర్ ID|పార్టిషన్ అగ్రస్థాయి సైట్|క్రాస్-సైట్ పూర్వీకం|ఫస్ట్-పార్టీ డొమైన్',
  ko: '저장소 ID|파티션 최상위 사이트|교차 사이트 상위 항목|퍼스트 파티 도메인',
  ta: 'சேமிப்பக ID|பிரிவின் உயர்நிலைத் தளம்|வேறு தள முன்னோர்|முதல் தரப்பு டொமைன்',
  yue: '储存区 ID|分区最上层网站|跨网站上层|第一方网域',
  wuu: '存储区 ID|分区顶层网站|跨站上级|第一方域名',
};
export const BROWSER_DEBUG_KEYS = Object.freeze(['browser_debug_not_applied', 'browser_debug_origin_placeholder', ...UI.map(key => 'browser_debug_' + key), ...DATASETS.map(key => 'browser_debug_dataset_' + key), ...ACTIONS.map(key => 'browser_debug_action_' + key), ...[...FIELDS, ...COOKIE_FIELDS].map(key => 'browser_debug_field_' + key)]);
export const BROWSER_DEBUG_MESSAGES = Object.freeze(Object.fromEntries(Object.entries(COPY).map(([locale, rows]) => {
  const groups = [UI, DATASETS, ACTIONS, FIELDS], prefixes = ['', 'dataset_', 'action_', 'field_'];
  const messages = {};
  groups.forEach((keys, index) => {
    const values = rows[index].split('|');
    if (values.length !== keys.length) throw Error('Browser Debug ' + locale + ': group ' + index + ' has ' + values.length + '/' + keys.length + ' values');
    keys.forEach((key, valueIndex) => { messages['browser_debug_' + prefixes[index] + key] = values[valueIndex]; });
  });
  messages.browser_debug_not_applied = NOT_APPLIED[locale];
  messages.browser_debug_origin_placeholder = 'https://…';
  const cookieLabels = COOKIE_COPY[locale].split('|');
  if (cookieLabels.length !== COOKIE_FIELDS.length) throw Error('Browser Debug cookie fields: ' + locale);
  COOKIE_FIELDS.forEach((key, index) => { messages['browser_debug_field_' + key] = cookieLabels[index]; });
  return [locale, Object.freeze(messages)];
})));

export function applyBrowserDebugCopy(table, locale) {
  if (!Object.hasOwn(BROWSER_DEBUG_MESSAGES, locale)) throw Error('Browser Debug: unknown locale ' + String(locale));
  for (const key of BROWSER_DEBUG_KEYS) table[key] = { message: BROWSER_DEBUG_MESSAGES[locale][key] };
  return table;
}
