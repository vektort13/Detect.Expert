// ADR-064: Antidetect controls use the same local catalogs as the management shell.
import { applyFingerprintCustomCopy } from './production-locales-fingerprint-custom.mjs';
const FIELDS = Object.freeze([
  'description', 'navigation', 'category_hardware', 'category_os', 'category_network', 'category_all', 'category_browser',
  'master', 'mode', 'allow', 'block', 'spoof', 'save', 'cancel', 'refresh', 'loading', 'unsaved', 'saved', 'stale', 'invalid', 'failed', 'denied', 'inactive', 'reload_required', 'changed_external',
  'addresses_enabled', 'mapped', 'family_empty', 'media_mode', 'original', 'random', 'custom', 'device_kind', 'device_label', 'device_id', 'group_id', 'add_device', 'remove_device', 'microphone', 'camera', 'speaker', 'no_devices', 'device_metadata', 'native_certificates',
  'leak_title', 'udp_note', 'quic_note', 'ipv6_note', 'websocket_note', 'webtransport_note', 'unavailable', 'early_required', 'grant_early', 'early_settings', 'network_scope', 'effective', 'block_active', 'spoof_active', 'allow_active', 'api_active', 'refresh_dirty', 'conflict_devices'
]);
const EXTRA_FIELDS = Object.freeze(['inherited', 'scope_inactive', 'scope_browser', 'scope_page', 'status_error', 'status_reload']);
const MASTER_FIELDS = Object.freeze(['master', 'inactive', 'api_active', 'api_inactive', 'block_owner']);
export const ANTIDETECT_UI_KEYS = Object.freeze(['management_tab_antidetect', ...FIELDS.map(key => 'antidetect_' + key), ...EXTRA_FIELDS.map(key => 'antidetect_' + key), 'antidetect_api_inactive', 'antidetect_block_owner']);
// E22-22: Antidetect gates Custom; API Guard gates blocking. Historic field names remain stable.
const MASTER_COPY = {
  ru: 'Antidetect|Antidetect выключен: подмена не применяется.|Antidetect включён|API Guard выключен: блокировка не применяется.|Блокировками управляет API Guard.',
  en: 'Antidetect|Antidetect is off: spoofing is inactive.|Antidetect is on|API Guard is off: blocking is inactive.|Blocking is controlled by API Guard.',
  zh_CN: 'Antidetect|Antidetect 已关闭：替换未生效。|Antidetect 已开启|API Guard 已关闭：阻止未生效。|阻止由 API Guard 控制。',
  vi: 'Antidetect|Antidetect đang tắt: thay thế chưa hoạt động.|Antidetect đang bật|API Guard đang tắt: chặn chưa hoạt động.|Việc chặn do API Guard điều khiển.',
  es: 'Antidetect|Antidetect está desactivado: la sustitución no se aplica.|Antidetect está activado|API Guard está desactivado: el bloqueo no se aplica.|API Guard controla el bloqueo.',
  ar: 'Antidetect|Antidetect متوقف: التبديل غير نشط.|Antidetect قيد التشغيل|API Guard متوقف: الحظر غير نشط.|يتحكم API Guard في الحظر.',
  uk: 'Antidetect|Antidetect вимкнено: підміна не застосовується.|Antidetect увімкнено|API Guard вимкнено: блокування не застосовується.|Блокуванням керує API Guard.',
  fr: 'Antidetect|Antidetect est désactivé : la substitution est inactive.|Antidetect est activé|API Guard est désactivé : le blocage est inactif.|Le blocage est contrôlé par API Guard.',
  pt_BR: 'Antidetect|Antidetect está desativado: a substituição está inativa.|Antidetect está ativado|API Guard está desativado: o bloqueio está inativo.|O bloqueio é controlado pelo API Guard.',
  hi: 'Antidetect|Antidetect बंद है: प्रतिस्थापन निष्क्रिय है।|Antidetect चालू है|API Guard बंद है: ब्लॉक करना निष्क्रिय है।|ब्लॉक करना API Guard नियंत्रित करता है।',
  ur: 'Antidetect|Antidetect بند ہے: تبدیلی غیر فعال ہے۔|Antidetect آن ہے|API Guard بند ہے: بلاک کرنا غیر فعال ہے۔|بلاک کرنے کو API Guard کنٹرول کرتا ہے۔',
  ja: 'Antidetect|Antidetect はオフです。置換は無効です。|Antidetect はオンです|API Guard はオフです。ブロックは無効です。|ブロックは API Guard が制御します。',
  de: 'Antidetect|Antidetect ist aus: Ersetzungen sind inaktiv.|Antidetect ist an|API Guard ist aus: Blockierungen sind inaktiv.|Blockierungen werden von API Guard gesteuert.',
  pl: 'Antidetect|Antidetect jest wyłączony: podmiana jest nieaktywna.|Antidetect jest włączony|API Guard jest wyłączony: blokowanie jest nieaktywne.|Blokowaniem steruje API Guard.',
  id: 'Antidetect|Antidetect nonaktif: penggantian tidak aktif.|Antidetect aktif|API Guard nonaktif: pemblokiran tidak aktif.|Pemblokiran dikendalikan oleh API Guard.',
  mr: 'Antidetect|Antidetect बंद आहे: बदल निष्क्रिय आहे.|Antidetect चालू आहे|API Guard बंद आहे: अवरोधन निष्क्रिय आहे.|अवरोधन API Guard नियंत्रित करते.',
  te: 'Antidetect|Antidetect ఆఫ్‌లో ఉంది: మార్పిడి క్రియారహితం.|Antidetect ఆన్‌లో ఉంది|API Guard ఆఫ్‌లో ఉంది: నిరోధం క్రియారహితం.|నిరోధాన్ని API Guard నియంత్రిస్తుంది.',
  ko: 'Antidetect|Antidetect가 꺼져 있어 대체가 비활성입니다.|Antidetect가 켜져 있습니다|API Guard가 꺼져 있어 차단이 비활성입니다.|차단은 API Guard에서 제어합니다.',
  ta: 'Antidetect|Antidetect அணைக்கப்பட்டுள்ளது: மாற்றீடு செயலற்றது.|Antidetect இயக்கப்பட்டுள்ளது|API Guard அணைக்கப்பட்டுள்ளது: தடுப்பு செயலற்றது.|தடுப்பை API Guard கட்டுப்படுத்துகிறது.',
  yue: 'Antidetect|Antidetect 已关闭：替换未生效。|Antidetect 已开启|API Guard 已关闭：阻止未生效。|阻止由 API Guard 控制。',
  wuu: 'Antidetect|Antidetect 关闭了：替换弗生效。|Antidetect 开启了|API Guard 关闭了：阻止弗生效。|阻止由 API Guard 控制。'
};
const COPY = {
  en: [
    'Hardware, operating system and network settings.|Antidetect categories|Hardware|OS|Network|All|Browser',
    'API management|WebRTC mode|Allow|Block|Spoof|Save|Cancel|Refresh|Loading settings…|Unsaved changes|Settings saved|Settings changed in another window. Refresh before saving.|Check the entered values.|Could not save the settings.|Permission was not granted.|API Guard is off: page settings are inactive.|Reload existing pages to apply the saved changes.|Settings changed elsewhere. Your draft has been kept.',
    'Use custom ICE addresses|Create IPv4-mapped IPv6|Empty fields suppress addresses of that family and candidate type.|Media device mode|Original|Randomized identifiers|Custom list|Device type|Displayed name|Device ID|Group ID|Add device|Remove device|Microphone|Camera|Audio output|The custom list is empty. Sites will see no devices.|Changes enumeration metadata; no camera, microphone or media stream is created.|Browser certificates',
    'Leak Prevention|A browser extension cannot block all UDP traffic. The WebRTC policy below controls only UDP outside a proxy for WebRTC.|Chrome and Firefox provide no extension API to switch QUIC off separately.|A browser extension cannot disable IPv6 for all browser connections.|Blocks WebSocket connection creation without blocking ordinary HTTP/HTTPS requests.|Blocks WebTransport connection creation without blocking WebSocket.|Unavailable|Enable user script access to apply page settings before site scripts.|Enable Custom access|Open browser settings|Network settings apply to all sites.|Effective state|WebRTC blocked|WebRTC spoofing active|WebRTC allowed|API Guard is active|Cancel the draft before refreshing.|Choose a custom device list or randomized identifiers.'
  ],
  ru: [
    'Параметры оборудования, операционной системы и сети.|Категории Antidetect|Устройство|ОС|Сеть|Все|Браузер',
    'Управление API|Режим WebRTC|Разрешить|Блокировать|Подмена|Сохранить|Отмена|Обновить|Загрузка настроек…|Есть несохранённые изменения|Настройки сохранены|Настройки изменились в другом окне. Обновите их перед сохранением.|Проверьте введённые значения.|Не удалось сохранить настройки.|Разрешение не предоставлено.|API Guard выключен: настройки страниц не применяются.|Перезагрузите открытые страницы, чтобы применить сохранённые изменения.|Настройки изменились в другом окне. Ваш черновик сохранён.',
    'Использовать пользовательские адреса ICE|Создать IPv4-mapped IPv6|Пустые поля скрывают адреса соответствующего семейства и типа кандидата.|Режим устройств|Исходные|Случайные идентификаторы|Свой список|Тип устройства|Отображаемое название|Device ID|Group ID|Добавить устройство|Удалить устройство|Микрофон|Камера|Аудиовыход|Список пуст. Сайты не увидят устройств.|Изменяет данные списка устройств; камера, микрофон и медиапоток не создаются.|Сертификаты браузера',
    'Сетевые каналы|Расширение не может блокировать весь UDP-трафик. Сетевая политика WebRTC управляет только UDP вне прокси для WebRTC.|В Chrome и Firefox нет API расширения для отдельного выключения QUIC.|Расширение не может отключить IPv6 для всех соединений браузера.|Блокирует новые соединения WebSocket, сохраняя обычные запросы HTTP/HTTPS.|Блокирует новые соединения WebTransport независимо от WebSocket.|Недоступно|Разрешите пользовательские скрипты для применения настроек до скриптов сайта.|Разрешить Custom|Открыть настройки браузера|Сетевые настройки применяются ко всем сайтам.|Фактическое состояние|WebRTC заблокирован|Подмена WebRTC активна|WebRTC разрешён|API Guard включён|Отмените черновик перед обновлением.|Выберите свой список устройств либо случайные идентификаторы.'
  ],
  zh_CN: [
    '硬件、操作系统和网络设置。|Antidetect 分类|硬件|操作系统|网络|全部|浏览器',
    'API 管理|WebRTC 模式|允许|阻止|替换|保存|取消|刷新|正在加载设置…|有未保存的更改|设置已保存|设置已在其他窗口更改。请刷新后再保存。|请检查输入的值。|无法保存设置。|未授予权限。|API Guard 已关闭：页面设置未生效。|重新加载已打开的页面以应用保存的更改。|设置已在其他位置更改。草稿已保留。',
    '使用自定义 ICE 地址|生成 IPv4 映射的 IPv6|空字段将隐藏相应地址族和候选类型的地址。|媒体设备模式|原始|随机标识符|自定义列表|设备类型|显示名称|设备 ID|组 ID|添加设备|删除设备|麦克风|摄像头|音频输出|自定义列表为空。网站将看不到设备。|仅更改设备枚举数据；不会创建摄像头、麦克风或媒体流。|浏览器证书',
    '泄漏防护|扩展无法阻止所有 UDP 流量。WebRTC 策略仅控制 WebRTC 在代理之外使用的 UDP。|Chrome 和 Firefox 不提供单独关闭 QUIC 的扩展 API。|扩展无法对浏览器的所有连接禁用 IPv6。|阻止新的 WebSocket 连接，不影响普通 HTTP/HTTPS 请求。|阻止新的 WebTransport 连接，不影响 WebSocket。|不可用|请允许用户脚本，以在网站脚本之前应用页面设置。|允许 Custom|打开浏览器设置|网络设置适用于所有网站。|实际状态|WebRTC 已阻止|WebRTC 替换已生效|WebRTC 已允许|API Guard 已开启|请先取消草稿再刷新。|请选择自定义设备列表或随机标识符之一。'
  ],
  vi: [
    'Cài đặt phần cứng, hệ điều hành và mạng.|Danh mục Antidetect|Phần cứng|Hệ điều hành|Mạng|Tất cả|Trình duyệt',
    'Quản lý API|Chế độ WebRTC|Cho phép|Chặn|Thay thế|Lưu|Hủy|Làm mới|Đang tải cài đặt…|Có thay đổi chưa lưu|Đã lưu cài đặt|Cài đặt đã đổi ở cửa sổ khác. Hãy làm mới trước khi lưu.|Kiểm tra các giá trị đã nhập.|Không thể lưu cài đặt.|Chưa được cấp quyền.|API Guard đang tắt: cài đặt trang chưa hoạt động.|Tải lại các trang đang mở để áp dụng thay đổi đã lưu.|Cài đặt đã đổi ở nơi khác. Bản nháp được giữ lại.',
    'Dùng địa chỉ ICE tùy chỉnh|Tạo IPv6 ánh xạ từ IPv4|Ô trống ẩn địa chỉ của họ địa chỉ và loại ứng viên tương ứng.|Chế độ thiết bị đa phương tiện|Gốc|Mã định danh ngẫu nhiên|Danh sách tùy chỉnh|Loại thiết bị|Tên hiển thị|ID thiết bị|ID nhóm|Thêm thiết bị|Xóa thiết bị|Micrô|Camera|Đầu ra âm thanh|Danh sách trống. Trang web sẽ không thấy thiết bị.|Chỉ đổi dữ liệu danh sách; không tạo camera, micrô hay luồng đa phương tiện.|Chứng chỉ trình duyệt',
    'Ngăn rò rỉ|Tiện ích không thể chặn toàn bộ UDP. Chính sách WebRTC chỉ điều khiển UDP ngoài proxy của WebRTC.|Chrome và Firefox không có API tiện ích để tắt riêng QUIC.|Tiện ích không thể tắt IPv6 cho mọi kết nối trình duyệt.|Chặn kết nối WebSocket mới mà không chặn HTTP/HTTPS thông thường.|Chặn kết nối WebTransport mới độc lập với WebSocket.|Không khả dụng|Cho phép tập lệnh người dùng để áp dụng cài đặt trước mã của trang.|Cho phép Custom|Mở cài đặt trình duyệt|Cài đặt mạng áp dụng cho mọi trang web.|Trạng thái thực tế|WebRTC bị chặn|Thay thế WebRTC đang hoạt động|WebRTC được cho phép|API Guard đang bật|Hủy bản nháp trước khi làm mới.|Chọn danh sách tùy chỉnh hoặc mã định danh ngẫu nhiên.'
  ],
  es: [
    'Ajustes de hardware, sistema operativo y red.|Categorías de Antidetect|Hardware|SO|Red|Todo|Navegador',
    'Gestión de API|Modo WebRTC|Permitir|Bloquear|Sustituir|Guardar|Cancelar|Actualizar|Cargando ajustes…|Cambios sin guardar|Ajustes guardados|Los ajustes cambiaron en otra ventana. Actualiza antes de guardar.|Revisa los valores introducidos.|No se pudieron guardar los ajustes.|No se concedió el permiso.|API Guard está desactivado: los ajustes de página no se aplican.|Recarga las páginas abiertas para aplicar los cambios guardados.|Los ajustes cambiaron en otra ventana. Se conservó el borrador.',
    'Usar direcciones ICE personalizadas|Crear IPv6 mapeada desde IPv4|Los campos vacíos ocultan las direcciones de esa familia y tipo de candidato.|Modo de dispositivos multimedia|Originales|Identificadores aleatorios|Lista personalizada|Tipo de dispositivo|Nombre mostrado|ID del dispositivo|ID del grupo|Añadir dispositivo|Eliminar dispositivo|Micrófono|Cámara|Salida de audio|La lista está vacía. Los sitios no verán dispositivos.|Cambia los metadatos de enumeración; no crea cámaras, micrófonos ni flujos multimedia.|Certificados del navegador',
    'Prevención de fugas|Una extensión no puede bloquear todo el tráfico UDP. La política WebRTC solo controla UDP fuera del proxy para WebRTC.|Chrome y Firefox no ofrecen una API de extensión para desactivar QUIC por separado.|Una extensión no puede desactivar IPv6 para todas las conexiones del navegador.|Bloquea nuevas conexiones WebSocket sin bloquear solicitudes HTTP/HTTPS normales.|Bloquea nuevas conexiones WebTransport independientemente de WebSocket.|No disponible|Permite scripts de usuario para aplicar los ajustes antes de los scripts del sitio.|Permitir Custom|Abrir ajustes del navegador|Los ajustes de red se aplican a todos los sitios.|Estado efectivo|WebRTC bloqueado|Sustitución WebRTC activa|WebRTC permitido|API Guard está activo|Cancela el borrador antes de actualizar.|Elige una lista personalizada o identificadores aleatorios.'
  ],
  ar: [
    'إعدادات الأجهزة ونظام التشغيل والشبكة.|فئات Antidetect|الأجهزة|النظام|الشبكة|الكل|المتصفح',
    'إدارة API|وضع WebRTC|سماح|حظر|تبديل|حفظ|إلغاء|تحديث|جارٍ تحميل الإعدادات…|تغييرات غير محفوظة|تم حفظ الإعدادات|تغيرت الإعدادات في نافذة أخرى. حدّث قبل الحفظ.|تحقق من القيم المدخلة.|تعذر حفظ الإعدادات.|لم يُمنح الإذن.|API Guard متوقف: إعدادات الصفحات غير مطبقة.|أعد تحميل الصفحات المفتوحة لتطبيق التغييرات المحفوظة.|تغيرت الإعدادات في مكان آخر. تم الاحتفاظ بالمسودة.',
    'استخدام عناوين ICE مخصصة|إنشاء IPv6 مرتبط بعنوان IPv4|الحقول الفارغة تخفي عناوين العائلة ونوع المرشح المقابلين.|وضع أجهزة الوسائط|الأصلية|معرّفات عشوائية|قائمة مخصصة|نوع الجهاز|الاسم المعروض|معرّف الجهاز|معرّف المجموعة|إضافة جهاز|إزالة الجهاز|ميكروفون|كاميرا|مخرج صوت|القائمة فارغة. لن ترى المواقع أي أجهزة.|يغير بيانات تعداد الأجهزة؛ ولا ينشئ كاميرا أو ميكروفونًا أو تدفق وسائط.|شهادات المتصفح',
    'منع التسرب|لا تستطيع الإضافة حظر كل حركة UDP. تتحكم سياسة WebRTC فقط في UDP خارج الوكيل لاتصالات WebRTC.|لا يوفر Chrome وFirefox واجهة إضافات لتعطيل QUIC بشكل مستقل.|لا تستطيع الإضافة تعطيل IPv6 لجميع اتصالات المتصفح.|يحظر اتصالات WebSocket الجديدة دون حظر طلبات HTTP/HTTPS العادية.|يحظر اتصالات WebTransport الجديدة بشكل مستقل عن WebSocket.|غير متاح|اسمح ببرامج المستخدم النصية لتطبيق الإعدادات قبل برامج الموقع.|السماح بـ Custom|فتح إعدادات المتصفح|تُطبق إعدادات الشبكة على جميع المواقع.|الحالة الفعلية|WebRTC محظور|تبديل WebRTC نشط|WebRTC مسموح|API Guard نشط|ألغِ المسودة قبل التحديث.|اختر قائمة أجهزة مخصصة أو معرّفات عشوائية.'
  ],
  uk: [
    'Параметри обладнання, операційної системи та мережі.|Категорії Antidetect|Обладнання|ОС|Мережа|Усе|Браузер',
    'Керування API|Режим WebRTC|Дозволити|Блокувати|Підміна|Зберегти|Скасувати|Оновити|Завантаження налаштувань…|Є незбережені зміни|Налаштування збережено|Налаштування змінилися в іншому вікні. Оновіть перед збереженням.|Перевірте введені значення.|Не вдалося зберегти налаштування.|Дозвіл не надано.|API Guard вимкнено: налаштування сторінок не застосовуються.|Перезавантажте відкриті сторінки, щоб застосувати збережені зміни.|Налаштування змінилися в іншому вікні. Чернетку збережено.',
    'Використовувати власні адреси ICE|Створити IPv4-mapped IPv6|Порожні поля приховують адреси відповідного сімейства й типу кандидата.|Режим медіапристроїв|Початкові|Випадкові ідентифікатори|Власний список|Тип пристрою|Відображувана назва|Device ID|Group ID|Додати пристрій|Видалити пристрій|Мікрофон|Камера|Аудіовихід|Список порожній. Сайти не бачитимуть пристроїв.|Змінює дані переліку; камеру, мікрофон і медіапотік не створено.|Сертифікати браузера',
    'Запобігання витокам|Розширення не може блокувати весь UDP-трафік. Політика WebRTC керує лише UDP поза проксі для WebRTC.|Chrome і Firefox не мають API розширення для окремого вимкнення QUIC.|Розширення не може вимкнути IPv6 для всіх з’єднань браузера.|Блокує нові з’єднання WebSocket, зберігаючи звичайні HTTP/HTTPS-запити.|Блокує нові з’єднання WebTransport незалежно від WebSocket.|Недоступно|Дозвольте користувацькі скрипти для застосування налаштувань до скриптів сайту.|Дозволити Custom|Відкрити налаштування браузера|Мережеві налаштування застосовуються до всіх сайтів.|Фактичний стан|WebRTC заблоковано|Підміна WebRTC активна|WebRTC дозволено|API Guard увімкнено|Скасуйте чернетку перед оновленням.|Виберіть власний список або випадкові ідентифікатори.'
  ],
  fr: [
    'Réglages du matériel, du système et du réseau.|Catégories Antidetect|Matériel|Système|Réseau|Tout|Navigateur',
    'Gestion des API|Mode WebRTC|Autoriser|Bloquer|Substituer|Enregistrer|Annuler|Actualiser|Chargement des réglages…|Modifications non enregistrées|Réglages enregistrés|Les réglages ont changé dans une autre fenêtre. Actualisez avant d’enregistrer.|Vérifiez les valeurs saisies.|Impossible d’enregistrer les réglages.|L’autorisation n’a pas été accordée.|API Guard est désactivé : les réglages des pages sont inactifs.|Rechargez les pages ouvertes pour appliquer les modifications enregistrées.|Les réglages ont changé ailleurs. Le brouillon a été conservé.',
    'Utiliser des adresses ICE personnalisées|Créer une IPv6 mappée depuis IPv4|Les champs vides masquent les adresses de cette famille et de ce type de candidat.|Mode des périphériques multimédias|D’origine|Identifiants aléatoires|Liste personnalisée|Type de périphérique|Nom affiché|ID du périphérique|ID du groupe|Ajouter un périphérique|Supprimer le périphérique|Microphone|Caméra|Sortie audio|La liste est vide. Les sites ne verront aucun périphérique.|Modifie les métadonnées d’énumération ; ne crée ni caméra, ni microphone, ni flux multimédia.|Certificats du navigateur',
    'Prévention des fuites|Une extension ne peut pas bloquer tout le trafic UDP. La politique WebRTC contrôle uniquement l’UDP hors proxy pour WebRTC.|Chrome et Firefox ne proposent aucune API d’extension pour désactiver QUIC séparément.|Une extension ne peut pas désactiver IPv6 pour toutes les connexions du navigateur.|Bloque les nouvelles connexions WebSocket sans bloquer les requêtes HTTP/HTTPS ordinaires.|Bloque les nouvelles connexions WebTransport indépendamment de WebSocket.|Indisponible|Autorisez les scripts utilisateur pour appliquer les réglages avant les scripts du site.|Autoriser Custom|Ouvrir les réglages du navigateur|Les réglages réseau s’appliquent à tous les sites.|État effectif|WebRTC bloqué|Substitution WebRTC active|WebRTC autorisé|API Guard est actif|Annulez le brouillon avant d’actualiser.|Choisissez une liste personnalisée ou des identifiants aléatoires.'
  ],
  pt_BR: [
    'Configurações de hardware, sistema operacional e rede.|Categorias do Antidetect|Hardware|SO|Rede|Todos|Navegador',
    'Gerenciamento de APIs|Modo WebRTC|Permitir|Bloquear|Substituir|Salvar|Cancelar|Atualizar|Carregando configurações…|Alterações não salvas|Configurações salvas|As configurações mudaram em outra janela. Atualize antes de salvar.|Verifique os valores inseridos.|Não foi possível salvar as configurações.|A permissão não foi concedida.|O API Guard está desativado: as configurações das páginas estão inativas.|Recarregue as páginas abertas para aplicar as alterações salvas.|As configurações mudaram em outro lugar. O rascunho foi mantido.',
    'Usar endereços ICE personalizados|Criar IPv6 mapeado a partir de IPv4|Campos vazios ocultam endereços dessa família e tipo de candidato.|Modo dos dispositivos de mídia|Originais|Identificadores aleatórios|Lista personalizada|Tipo de dispositivo|Nome exibido|ID do dispositivo|ID do grupo|Adicionar dispositivo|Remover dispositivo|Microfone|Câmera|Saída de áudio|A lista está vazia. Os sites não verão dispositivos.|Altera os metadados da lista; não cria câmera, microfone ou fluxo de mídia.|Certificados do navegador',
    'Prevenção de vazamentos|Uma extensão não pode bloquear todo o tráfego UDP. A política WebRTC controla apenas UDP fora do proxy para WebRTC.|Chrome e Firefox não oferecem API de extensão para desativar QUIC separadamente.|Uma extensão não pode desativar IPv6 para todas as conexões do navegador.|Bloqueia novas conexões WebSocket sem bloquear solicitações HTTP/HTTPS comuns.|Bloqueia novas conexões WebTransport independentemente de WebSocket.|Indisponível|Permita scripts de usuário para aplicar configurações antes dos scripts do site.|Permitir Custom|Abrir configurações do navegador|As configurações de rede se aplicam a todos os sites.|Estado efetivo|WebRTC bloqueado|Substituição WebRTC ativa|WebRTC permitido|API Guard está ativo|Cancele o rascunho antes de atualizar.|Escolha uma lista personalizada ou identificadores aleatórios.'
  ],
  hi: [
    'हार्डवेयर, ऑपरेटिंग सिस्टम और नेटवर्क सेटिंग्स।|Antidetect श्रेणियाँ|हार्डवेयर|ऑपरेटिंग सिस्टम|नेटवर्क|सभी|ब्राउज़र',
    'API प्रबंधन|WebRTC मोड|अनुमति दें|ब्लॉक करें|बदलें|सहेजें|रद्द करें|रीफ़्रेश करें|सेटिंग्स लोड हो रही हैं…|बिना सहेजे बदलाव|सेटिंग्स सहेजी गईं|सेटिंग्स दूसरी विंडो में बदल गई हैं। सहेजने से पहले रीफ़्रेश करें।|दर्ज मान जाँचें।|सेटिंग्स सहेजी नहीं जा सकीं।|अनुमति नहीं दी गई।|API Guard बंद है: पेज सेटिंग्स लागू नहीं हैं।|सहेजे गए बदलाव लागू करने के लिए खुले पेज दोबारा लोड करें।|सेटिंग्स दूसरी जगह बदल गई हैं। ड्राफ़्ट रखा गया है।',
    'कस्टम ICE पते इस्तेमाल करें|IPv4 से मैप किया गया IPv6 बनाएँ|खाली फ़ील्ड उस परिवार और कैंडिडेट प्रकार के पते छिपाते हैं।|मीडिया डिवाइस मोड|मूल|रैंडम पहचानकर्ता|कस्टम सूची|डिवाइस प्रकार|दिखाया गया नाम|डिवाइस ID|समूह ID|डिवाइस जोड़ें|डिवाइस हटाएँ|माइक्रोफ़ोन|कैमरा|ऑडियो आउटपुट|सूची खाली है। साइटों को कोई डिवाइस नहीं दिखेगा।|केवल सूची की जानकारी बदलती है; कैमरा, माइक्रोफ़ोन या मीडिया स्ट्रीम नहीं बनता।|ब्राउज़र प्रमाणपत्र',
    'लीक रोकथाम|एक्सटेंशन पूरा UDP ट्रैफ़िक ब्लॉक नहीं कर सकता। WebRTC नीति केवल WebRTC के लिए प्रॉक्सी से बाहर UDP नियंत्रित करती है।|Chrome और Firefox में QUIC अलग से बंद करने का एक्सटेंशन API नहीं है।|एक्सटेंशन ब्राउज़र के सभी कनेक्शन के लिए IPv6 बंद नहीं कर सकता।|सामान्य HTTP/HTTPS अनुरोध रोके बिना नए WebSocket कनेक्शन ब्लॉक करता है।|WebSocket से अलग नए WebTransport कनेक्शन ब्लॉक करता है।|उपलब्ध नहीं|साइट स्क्रिप्ट से पहले सेटिंग्स लागू करने के लिए यूज़र स्क्रिप्ट की अनुमति दें।|Custom की अनुमति दें|ब्राउज़र सेटिंग्स खोलें|नेटवर्क सेटिंग्स सभी साइटों पर लागू होती हैं।|वास्तविक स्थिति|WebRTC ब्लॉक है|WebRTC बदलाव सक्रिय है|WebRTC की अनुमति है|API Guard सक्रिय है|रीफ़्रेश करने से पहले ड्राफ़्ट रद्द करें।|कस्टम डिवाइस सूची या रैंडम पहचानकर्ता चुनें।'
  ],
  ur: [
    'ہارڈویئر، آپریٹنگ سسٹم اور نیٹ ورک کی ترتیبات۔|Antidetect زمرے|ہارڈویئر|نظام|نیٹ ورک|سب|براؤزر',
    'API انتظام|WebRTC موڈ|اجازت دیں|بلاک کریں|تبدیل کریں|محفوظ کریں|منسوخ کریں|تازہ کریں|ترتیبات لوڈ ہو رہی ہیں…|غیر محفوظ تبدیلیاں|ترتیبات محفوظ ہو گئیں|ترتیبات دوسری ونڈو میں بدل گئی ہیں۔ محفوظ کرنے سے پہلے تازہ کریں۔|درج کردہ قدریں جانچیں۔|ترتیبات محفوظ نہیں ہو سکیں۔|اجازت نہیں دی گئی۔|API Guard بند ہے: صفحات کی ترتیبات لاگو نہیں ہیں۔|محفوظ تبدیلیاں لاگو کرنے کے لیے کھلے صفحات دوبارہ لوڈ کریں۔|ترتیبات دوسری جگہ بدل گئی ہیں۔ مسودہ محفوظ رکھا گیا ہے۔',
    'حسبِ ضرورت ICE پتے استعمال کریں|IPv4 سے منسلک IPv6 بنائیں|خالی خانے متعلقہ خاندان اور امیدوار کی قسم کے پتے چھپاتے ہیں۔|میڈیا آلات کا موڈ|اصل|بے ترتیب شناخت کنندے|حسبِ ضرورت فہرست|آلے کی قسم|دکھایا گیا نام|آلے کی ID|گروپ ID|آلہ شامل کریں|آلہ ہٹائیں|مائیکروفون|کیمرہ|آڈیو آؤٹ پٹ|فہرست خالی ہے۔ سائٹس کو کوئی آلہ نظر نہیں آئے گا۔|صرف آلات کی فہرست کا ڈیٹا بدلتا ہے؛ کیمرہ، مائیکروفون یا میڈیا اسٹریم نہیں بنتا۔|براؤزر کے سرٹیفکیٹس',
    'لیکس کی روک تھام|ایکسٹینشن تمام UDP ٹریفک بلاک نہیں کر سکتی۔ WebRTC پالیسی صرف WebRTC کے لیے پراکسی سے باہر UDP کو کنٹرول کرتی ہے۔|Chrome اور Firefox میں QUIC کو الگ بند کرنے کا ایکسٹینشن API نہیں ہے۔|ایکسٹینشن براؤزر کے تمام کنکشنز کے لیے IPv6 بند نہیں کر سکتی۔|عام HTTP/HTTPS درخواستوں کو روکے بغیر نئے WebSocket کنکشنز بلاک کرتا ہے۔|WebSocket سے الگ نئے WebTransport کنکشنز بلاک کرتا ہے۔|دستیاب نہیں|سائٹ کے اسکرپٹس سے پہلے ترتیبات لاگو کرنے کے لیے صارف اسکرپٹس کی اجازت دیں۔|Custom کی اجازت دیں|براؤزر کی ترتیبات کھولیں|نیٹ ورک ترتیبات تمام سائٹس پر لاگو ہوتی ہیں۔|اصل حالت|WebRTC بلاک ہے|WebRTC کی تبدیلی فعال ہے|WebRTC کی اجازت ہے|API Guard فعال ہے|تازہ کرنے سے پہلے مسودہ منسوخ کریں۔|حسبِ ضرورت آلات کی فہرست یا بے ترتیب شناخت کنندے منتخب کریں۔'
  ],
  ja: [
    'ハードウェア、OS、ネットワークの設定。|Antidetect のカテゴリ|ハードウェア|OS|ネットワーク|すべて|ブラウザー',
    'API 管理|WebRTC モード|許可|ブロック|置換|保存|キャンセル|更新|設定を読み込み中…|未保存の変更|設定を保存しました|別のウィンドウで設定が変更されました。更新してから保存してください。|入力値を確認してください。|設定を保存できませんでした。|権限が許可されませんでした。|API Guard はオフです。ページ設定は適用されません。|保存した変更を適用するには、開いているページを再読み込みしてください。|設定が別の場所で変更されました。下書きは保持されています。',
    'カスタム ICE アドレスを使用|IPv4 射影 IPv6 を作成|空欄は、そのアドレスファミリーと候補タイプのアドレスを非表示にします。|メディアデバイスのモード|元の値|ランダムな識別子|カスタム一覧|デバイスの種類|表示名|デバイス ID|グループ ID|デバイスを追加|デバイスを削除|マイク|カメラ|音声出力|一覧は空です。サイトにはデバイスが表示されません。|列挙データのみを変更します。カメラ、マイク、メディアストリームは作成されません。|ブラウザーの証明書',
    '漏洩防止|拡張機能はすべての UDP 通信をブロックできません。WebRTC ポリシーは、WebRTC のプロキシ外 UDP のみを制御します。|Chrome と Firefox には、QUIC だけを無効にする拡張機能 API がありません。|拡張機能はブラウザーの全接続で IPv6 を無効にできません。|通常の HTTP/HTTPS リクエストに影響せず、新しい WebSocket 接続をブロックします。|WebSocket とは独立して、新しい WebTransport 接続をブロックします。|利用不可|サイトのスクリプトより前に設定を適用するには、ユーザースクリプトを許可してください。|Custom を許可|ブラウザー設定を開く|ネットワーク設定はすべてのサイトに適用されます。|実際の状態|WebRTC はブロックされています|WebRTC の置換は有効です|WebRTC は許可されています|API Guard は有効です|更新する前に下書きをキャンセルしてください。|カスタム一覧またはランダムな識別子を選択してください。'
  ],
  de: [
    'Einstellungen für Hardware, Betriebssystem und Netzwerk.|Antidetect-Kategorien|Hardware|Betriebssystem|Netzwerk|Alle|Browser',
    'API-Verwaltung|WebRTC-Modus|Erlauben|Blockieren|Ersetzen|Speichern|Abbrechen|Aktualisieren|Einstellungen werden geladen…|Ungespeicherte Änderungen|Einstellungen gespeichert|Die Einstellungen wurden in einem anderen Fenster geändert. Vor dem Speichern aktualisieren.|Prüfe die eingegebenen Werte.|Die Einstellungen konnten nicht gespeichert werden.|Die Berechtigung wurde nicht erteilt.|API Guard ist aus: Seiteneinstellungen sind inaktiv.|Offene Seiten neu laden, um gespeicherte Änderungen anzuwenden.|Einstellungen wurden andernorts geändert. Dein Entwurf bleibt erhalten.',
    'Eigene ICE-Adressen verwenden|IPv4-gemappte IPv6 erzeugen|Leere Felder verbergen Adressen dieser Familie und dieses Kandidatentyps.|Modus für Mediengeräte|Original|Zufällige Kennungen|Eigene Liste|Gerätetyp|Angezeigter Name|Geräte-ID|Gruppen-ID|Gerät hinzufügen|Gerät entfernen|Mikrofon|Kamera|Audioausgabe|Die Liste ist leer. Websites sehen keine Geräte.|Ändert nur die Auflistungsdaten; Kamera, Mikrofon oder Medienstream werden nicht erzeugt.|Browserzertifikate',
    'Leckvermeidung|Eine Erweiterung kann nicht den gesamten UDP-Verkehr blockieren. Die WebRTC-Richtlinie steuert nur WebRTC-UDP außerhalb eines Proxys.|Chrome und Firefox bieten keine Erweiterungs-API zum separaten Abschalten von QUIC.|Eine Erweiterung kann IPv6 nicht für alle Browserverbindungen abschalten.|Blockiert neue WebSocket-Verbindungen, ohne normale HTTP/HTTPS-Anfragen zu blockieren.|Blockiert neue WebTransport-Verbindungen unabhängig von WebSocket.|Nicht verfügbar|Erlaube Benutzerskripte, damit Seiteneinstellungen vor Website-Skripten greifen.|Custom erlauben|Browsereinstellungen öffnen|Netzwerkeinstellungen gelten für alle Websites.|Tatsächlicher Zustand|WebRTC blockiert|WebRTC-Ersetzung aktiv|WebRTC erlaubt|API Guard ist aktiv|Entwurf vor dem Aktualisieren abbrechen.|Wähle eine eigene Geräteliste oder zufällige Kennungen.'
  ],
  pl: [
    'Ustawienia sprzętu, systemu operacyjnego i sieci.|Kategorie Antidetect|Sprzęt|System|Sieć|Wszystkie|Przeglądarka',
    'Zarządzanie API|Tryb WebRTC|Zezwól|Blokuj|Podmień|Zapisz|Anuluj|Odśwież|Wczytywanie ustawień…|Niezapisane zmiany|Ustawienia zapisane|Ustawienia zmieniono w innym oknie. Odśwież przed zapisem.|Sprawdź wpisane wartości.|Nie udało się zapisać ustawień.|Nie udzielono uprawnienia.|API Guard jest wyłączony: ustawienia stron nie działają.|Wczytaj ponownie otwarte strony, aby zastosować zapisane zmiany.|Ustawienia zmieniono w innym miejscu. Szkic zachowano.',
    'Użyj własnych adresów ICE|Utwórz IPv6 mapowany z IPv4|Puste pola ukrywają adresy danej rodziny i typu kandydata.|Tryb urządzeń multimedialnych|Oryginalne|Losowe identyfikatory|Własna lista|Typ urządzenia|Wyświetlana nazwa|ID urządzenia|ID grupy|Dodaj urządzenie|Usuń urządzenie|Mikrofon|Kamera|Wyjście audio|Lista jest pusta. Witryny nie zobaczą urządzeń.|Zmienia dane listy; nie tworzy kamery, mikrofonu ani strumienia multimediów.|Certyfikaty przeglądarki',
    'Zapobieganie wyciekom|Rozszerzenie nie może zablokować całego ruchu UDP. Zasada WebRTC kontroluje tylko UDP poza serwerem proxy dla WebRTC.|Chrome i Firefox nie udostępniają API rozszerzenia do oddzielnego wyłączenia QUIC.|Rozszerzenie nie może wyłączyć IPv6 dla wszystkich połączeń przeglądarki.|Blokuje nowe połączenia WebSocket bez blokowania zwykłych żądań HTTP/HTTPS.|Blokuje nowe połączenia WebTransport niezależnie od WebSocket.|Niedostępne|Zezwól na skrypty użytkownika, aby zastosować ustawienia przed skryptami witryny.|Zezwól na Custom|Otwórz ustawienia przeglądarki|Ustawienia sieci dotyczą wszystkich witryn.|Stan rzeczywisty|WebRTC zablokowany|Podmiana WebRTC aktywna|WebRTC dozwolony|API Guard jest aktywny|Anuluj szkic przed odświeżeniem.|Wybierz własną listę lub losowe identyfikatory.'
  ],
  id: [
    'Setelan perangkat keras, sistem operasi, dan jaringan.|Kategori Antidetect|Perangkat keras|OS|Jaringan|Semua|Browser',
    'Pengelolaan API|Mode WebRTC|Izinkan|Blokir|Ganti|Simpan|Batal|Muat ulang|Memuat setelan…|Perubahan belum disimpan|Setelan disimpan|Setelan berubah di jendela lain. Muat ulang sebelum menyimpan.|Periksa nilai yang dimasukkan.|Tidak dapat menyimpan setelan.|Izin tidak diberikan.|API Guard nonaktif: setelan halaman tidak diterapkan.|Muat ulang halaman terbuka untuk menerapkan perubahan tersimpan.|Setelan berubah di tempat lain. Draf dipertahankan.',
    'Gunakan alamat ICE kustom|Buat IPv6 yang dipetakan dari IPv4|Kolom kosong menyembunyikan alamat dari keluarga dan jenis kandidat tersebut.|Mode perangkat media|Asli|Pengenal acak|Daftar kustom|Jenis perangkat|Nama tampilan|ID perangkat|ID grup|Tambah perangkat|Hapus perangkat|Mikrofon|Kamera|Keluaran audio|Daftar kosong. Situs tidak akan melihat perangkat.|Hanya mengubah metadata daftar; tidak membuat kamera, mikrofon, atau aliran media.|Sertifikat browser',
    'Pencegahan kebocoran|Ekstensi tidak dapat memblokir semua lalu lintas UDP. Kebijakan WebRTC hanya mengontrol UDP di luar proxy untuk WebRTC.|Chrome dan Firefox tidak menyediakan API ekstensi untuk menonaktifkan QUIC secara terpisah.|Ekstensi tidak dapat menonaktifkan IPv6 untuk semua koneksi browser.|Memblokir koneksi WebSocket baru tanpa memblokir permintaan HTTP/HTTPS biasa.|Memblokir koneksi WebTransport baru secara terpisah dari WebSocket.|Tidak tersedia|Izinkan skrip pengguna untuk menerapkan setelan sebelum skrip situs.|Izinkan Custom|Buka setelan browser|Setelan jaringan berlaku untuk semua situs.|Status sebenarnya|WebRTC diblokir|Penggantian WebRTC aktif|WebRTC diizinkan|API Guard aktif|Batalkan draf sebelum memuat ulang.|Pilih daftar kustom atau pengenal acak.'
  ],
  mr: [
    'हार्डवेअर, ऑपरेटिंग सिस्टीम आणि नेटवर्क सेटिंग्ज.|Antidetect श्रेणी|हार्डवेअर|ऑपरेटिंग सिस्टीम|नेटवर्क|सर्व|ब्राउझर',
    'API व्यवस्थापन|WebRTC मोड|परवानगी द्या|ब्लॉक करा|बदला|जतन करा|रद्द करा|रिफ्रेश करा|सेटिंग्ज लोड होत आहेत…|जतन न केलेले बदल|सेटिंग्ज जतन केल्या|दुसऱ्या विंडोमध्ये सेटिंग्ज बदलल्या आहेत. जतन करण्यापूर्वी रिफ्रेश करा.|प्रविष्ट मूल्ये तपासा.|सेटिंग्ज जतन करता आल्या नाहीत.|परवानगी दिलेली नाही.|API Guard बंद आहे: पृष्ठ सेटिंग्ज लागू नाहीत.|जतन केलेले बदल लागू करण्यासाठी उघडी पृष्ठे पुन्हा लोड करा.|सेटिंग्ज दुसरीकडे बदलल्या आहेत. मसुदा कायम आहे.',
    'सानुकूल ICE पत्ते वापरा|IPv4-मॅप केलेला IPv6 तयार करा|रिकामी क्षेत्रे त्या कुटुंबाचे आणि उमेदवार प्रकाराचे पत्ते लपवतात.|मीडिया उपकरण मोड|मूळ|यादृच्छिक ओळखचिन्हे|सानुकूल सूची|उपकरण प्रकार|दिसणारे नाव|उपकरण ID|गट ID|उपकरण जोडा|उपकरण काढा|मायक्रोफोन|कॅमेरा|ऑडिओ आउटपुट|सूची रिकामी आहे. साइट्सना उपकरणे दिसणार नाहीत.|फक्त सूचीचा डेटा बदलतो; कॅमेरा, मायक्रोफोन किंवा मीडिया प्रवाह तयार होत नाही.|ब्राउझर प्रमाणपत्रे',
    'गळती प्रतिबंध|विस्तार सर्व UDP वाहतूक ब्लॉक करू शकत नाही. WebRTC धोरण फक्त WebRTC साठी प्रॉक्सीबाहेरील UDP नियंत्रित करते.|Chrome आणि Firefox मध्ये QUIC स्वतंत्रपणे बंद करणारा विस्तार API नाही.|विस्तार सर्व ब्राउझर कनेक्शनसाठी IPv6 बंद करू शकत नाही.|सामान्य HTTP/HTTPS विनंत्या न रोखता नवीन WebSocket जोडण्या ब्लॉक करते.|WebSocket पासून स्वतंत्र नवीन WebTransport जोडण्या ब्लॉक करते.|उपलब्ध नाही|साइट स्क्रिप्टपूर्वी सेटिंग्ज लागू करण्यासाठी वापरकर्ता स्क्रिप्टना परवानगी द्या.|Custom ला परवानगी द्या|ब्राउझर सेटिंग्ज उघडा|नेटवर्क सेटिंग्ज सर्व साइट्सना लागू होतात.|प्रत्यक्ष स्थिती|WebRTC ब्लॉक आहे|WebRTC बदल सक्रिय आहे|WebRTC ला परवानगी आहे|API Guard सक्रिय आहे|रिफ्रेश करण्यापूर्वी मसुदा रद्द करा.|सानुकूल उपकरण सूची किंवा यादृच्छिक ओळखचिन्हे निवडा.'
  ],
  te: [
    'హార్డ్‌వేర్, ఆపరేటింగ్ సిస్టమ్, నెట్‌వర్క్ సెట్టింగ్‌లు.|Antidetect వర్గాలు|హార్డ్‌వేర్|ఆపరేటింగ్ సిస్టమ్|నెట్‌వర్క్|అన్నీ|బ్రౌజర్',
    'API నిర్వహణ|WebRTC విధానం|అనుమతించు|నిరోధించు|మార్చు|సేవ్ చేయి|రద్దు చేయి|రిఫ్రెష్ చేయి|సెట్టింగ్‌లు లోడ్ అవుతున్నాయి…|సేవ్ చేయని మార్పులు|సెట్టింగ్‌లు సేవ్ అయ్యాయి|మరో విండోలో సెట్టింగ్‌లు మారాయి. సేవ్ చేసే ముందు రిఫ్రెష్ చేయండి.|నమోదు చేసిన విలువలను తనిఖీ చేయండి.|సెట్టింగ్‌లను సేవ్ చేయలేకపోయాం.|అనుమతి ఇవ్వలేదు.|API Guard ఆఫ్‌లో ఉంది: పేజీ సెట్టింగ్‌లు వర్తించవు.|సేవ్ చేసిన మార్పులను వర్తింపజేయడానికి తెరిచిన పేజీలను మళ్లీ లోడ్ చేయండి.|వేరే చోట సెట్టింగ్‌లు మారాయి. ముసాయిదా అలాగే ఉంది.',
    'అనుకూల ICE చిరునామాలు వాడు|IPv4 నుంచి మ్యాప్ చేసిన IPv6 సృష్టించు|ఖాళీ ఫీల్డ్‌లు ఆ కుటుంబం, అభ్యర్థి రకం చిరునామాలను దాచుతాయి.|మీడియా పరికరాల విధానం|అసలు|యాదృచ్ఛిక గుర్తింపులు|అనుకూల జాబితా|పరికరం రకం|చూపించే పేరు|పరికరం ID|సమూహం ID|పరికరం జోడించు|పరికరం తొలగించు|మైక్రోఫోన్|కెమెరా|ఆడియో అవుట్‌పుట్|జాబితా ఖాళీగా ఉంది. సైట్‌లకు పరికరాలు కనిపించవు.|జాబితా సమాచారాన్ని మాత్రమే మారుస్తుంది; కెమెరా, మైక్రోఫోన్, మీడియా స్ట్రీమ్ సృష్టించదు.|బ్రౌజర్ సర్టిఫికేట్‌లు',
    'లీక్ నివారణ|పొడిగింపు మొత్తం UDP ట్రాఫిక్‌ను నిరోధించలేదు. WebRTC విధానం WebRTC కోసం ప్రాక్సీ బయట UDPని మాత్రమే నియంత్రిస్తుంది.|Chrome, Firefoxలో QUICని విడిగా ఆఫ్ చేసే పొడిగింపు API లేదు.|బ్రౌజర్ కనెక్షన్‌లన్నింటికీ IPv6ని పొడిగింపు ఆఫ్ చేయలేదు.|సాధారణ HTTP/HTTPS అభ్యర్థులను నిరోధించకుండా కొత్త WebSocket కనెక్షన్‌లను నిరోధిస్తుంది.|WebSocketతో సంబంధం లేకుండా కొత్త WebTransport కనెక్షన్‌లను నిరోధిస్తుంది.|అందుబాటులో లేదు|సైట్ స్క్రిప్ట్‌లకు ముందే సెట్టింగ్‌లు వర్తించడానికి యూజర్ స్క్రిప్ట్‌లను అనుమతించండి.|Custom అనుమతించు|బ్రౌజర్ సెట్టింగ్‌లు తెరువు|నెట్‌వర్క్ సెట్టింగ్‌లు అన్ని సైట్‌లకు వర్తిస్తాయి.|వాస్తవ స్థితి|WebRTC నిరోధించబడింది|WebRTC మార్పు అమల్లో ఉంది|WebRTC అనుమతించబడింది|API Guard అమల్లో ఉంది|రిఫ్రెష్ చేసే ముందు ముసాయిదా రద్దు చేయండి.|అనుకూల జాబితా లేదా యాదృచ్ఛిక గుర్తింపులు ఎంచుకోండి.'
  ],
  ko: [
    '하드웨어, 운영체제 및 네트워크 설정.|Antidetect 카테고리|하드웨어|운영체제|네트워크|전체|브라우저',
    'API 관리|WebRTC 모드|허용|차단|변경|저장|취소|새로고침|설정 불러오는 중…|저장하지 않은 변경 사항|설정을 저장했습니다|다른 창에서 설정이 변경되었습니다. 저장하기 전에 새로고침하세요.|입력한 값을 확인하세요.|설정을 저장할 수 없습니다.|권한이 허용되지 않았습니다.|API Guard가 꺼져 있어 페이지 설정이 적용되지 않습니다.|저장한 변경 사항을 적용하려면 열린 페이지를 새로고침하세요.|다른 곳에서 설정이 변경되었습니다. 초안을 유지했습니다.',
    '사용자 지정 ICE 주소 사용|IPv4 매핑 IPv6 생성|빈 필드는 해당 주소 계열과 후보 유형의 주소를 숨깁니다.|미디어 기기 모드|원래 값|무작위 식별자|사용자 지정 목록|기기 유형|표시 이름|기기 ID|그룹 ID|기기 추가|기기 삭제|마이크|카메라|오디오 출력|목록이 비어 있습니다. 사이트에 기기가 표시되지 않습니다.|목록 정보만 변경하며 카메라, 마이크, 미디어 스트림을 생성하지 않습니다.|브라우저 인증서',
    '유출 방지|확장 프로그램은 모든 UDP 트래픽을 차단할 수 없습니다. WebRTC 정책은 WebRTC의 프록시 외부 UDP만 제어합니다.|Chrome과 Firefox는 QUIC만 끄는 확장 프로그램 API를 제공하지 않습니다.|확장 프로그램은 브라우저의 모든 연결에서 IPv6를 끌 수 없습니다.|일반 HTTP/HTTPS 요청을 차단하지 않고 새 WebSocket 연결을 차단합니다.|WebSocket과 별도로 새 WebTransport 연결을 차단합니다.|사용할 수 없음|사이트 스크립트보다 먼저 설정을 적용하려면 사용자 스크립트를 허용하세요.|Custom 허용|브라우저 설정 열기|네트워크 설정은 모든 사이트에 적용됩니다.|실제 상태|WebRTC 차단됨|WebRTC 변경 활성|WebRTC 허용됨|API Guard가 활성화되었습니다|새로고침 전에 초안을 취소하세요.|사용자 지정 목록 또는 무작위 식별자를 선택하세요.'
  ],
  ta: [
    'வன்பொருள், இயங்குதளம், நெட்வொர்க் அமைப்புகள்.|Antidetect வகைகள்|வன்பொருள்|இயங்குதளம்|நெட்வொர்க்|அனைத்தும்|உலாவி',
    'API நிர்வாகம்|WebRTC முறை|அனுமதி|தடு|மாற்று|சேமி|ரத்துசெய்|புதுப்பி|அமைப்புகள் ஏற்றப்படுகின்றன…|சேமிக்காத மாற்றங்கள்|அமைப்புகள் சேமிக்கப்பட்டன|வேறு சாளரத்தில் அமைப்புகள் மாறிவிட்டன. சேமிப்பதற்கு முன் புதுப்பிக்கவும்.|உள்ளிட்ட மதிப்புகளைச் சரிபார்க்கவும்.|அமைப்புகளைச் சேமிக்க முடியவில்லை.|அனுமதி வழங்கப்படவில்லை.|API Guard முடக்கப்பட்டுள்ளது: பக்க அமைப்புகள் செயல்படவில்லை.|சேமித்த மாற்றங்களைப் பயன்படுத்த திறந்த பக்கங்களை மீண்டும் ஏற்றவும்.|வேறு இடத்தில் அமைப்புகள் மாறிவிட்டன. வரைவு தக்கவைக்கப்பட்டுள்ளது.',
    'தனிப்பயன் ICE முகவரிகளைப் பயன்படுத்து|IPv4-இலிருந்து இணைக்கப்பட்ட IPv6 உருவாக்கு|வெற்று புலங்கள் அந்தக் குடும்பம் மற்றும் வேட்பாளர் வகையின் முகவரிகளை மறைக்கும்.|ஊடகச் சாதன முறை|அசல்|சீரற்ற அடையாளங்கள்|தனிப்பயன் பட்டியல்|சாதன வகை|காட்டப்படும் பெயர்|சாதன ID|குழு ID|சாதனத்தைச் சேர்|சாதனத்தை அகற்று|ஒலிவாங்கி|கேமரா|ஒலி வெளியீடு|பட்டியல் காலியாக உள்ளது. தளங்கள் சாதனங்களைக் காணாது.|பட்டியல் தகவலை மட்டும் மாற்றும்; கேமரா, ஒலிவாங்கி அல்லது ஊடக ஓட்டத்தை உருவாக்காது.|உலாவிச் சான்றிதழ்கள்',
    'கசிவு தடுப்பு|நீட்டிப்பால் அனைத்து UDP போக்குவரத்தையும் தடுக்க முடியாது. WebRTC கொள்கை WebRTC-க்கான ப்ராக்ஸிக்கு வெளியேயான UDP-ஐ மட்டும் கட்டுப்படுத்தும்.|QUIC-ஐ மட்டும் முடக்க Chrome மற்றும் Firefox நீட்டிப்பு API வழங்கவில்லை.|உலாவியின் அனைத்து இணைப்புகளுக்கும் IPv6-ஐ நீட்டிப்பால் முடக்க முடியாது.|வழக்கமான HTTP/HTTPS கோரிக்கைகளைத் தடுக்காமல் புதிய WebSocket இணைப்புகளைத் தடுக்கும்.|WebSocket-ஐச் சாராமல் புதிய WebTransport இணைப்புகளைத் தடுக்கும்.|கிடைக்கவில்லை|தள ஸ்கிரிப்டுகளுக்கு முன் அமைப்புகளைப் பயன்படுத்த பயனர் ஸ்கிரிப்டுகளை அனுமதிக்கவும்.|Custom அனுமதி|உலாவி அமைப்புகளைத் திற|நெட்வொர்க் அமைப்புகள் அனைத்துத் தளங்களுக்கும் பொருந்தும்.|உண்மையான நிலை|WebRTC தடுக்கப்பட்டது|WebRTC மாற்றம் செயலில் உள்ளது|WebRTC அனுமதிக்கப்பட்டது|API Guard செயலில் உள்ளது|புதுப்பிக்கும் முன் வரைவை ரத்துசெய்யவும்.|தனிப்பயன் பட்டியல் அல்லது சீரற்ற அடையாளங்களைத் தேர்ந்தெடுக்கவும்.'
  ],
  yue: [
    '硬件、作业系统同网络设定。|Antidetect 分类|硬件|系统|网络|全部|浏览器',
    'API 管理|WebRTC 模式|允许|封锁|替换|储存|取消|更新|载入设定中…|有未储存嘅更改|设定已储存|设定喺另一个视窗改咗。请更新后再储存。|请检查输入值。|未能储存设定。|未获授权。|API Guard 已关：网页设定未生效。|重新载入开咗嘅网页，套用已储存嘅更改。|设定喺其他地方改咗。草稿已保留。',
    '用自订 ICE 地址|由 IPv4 产生映射 IPv6|空栏会隐藏对应地址族同候选类型嘅地址。|媒体装置模式|原本|随机识别码|自订列表|装置类型|显示名称|装置 ID|群组 ID|加入装置|移除装置|咪高峰|相机|音讯输出|列表系空嘅。网站会睇唔到装置。|只改装置列表资料；唔会建立相机、咪高峰或者媒体串流。|浏览器证书',
    '防止泄漏|扩展唔可以封锁所有 UDP 流量。WebRTC 策略只控制 WebRTC 喺代理以外用嘅 UDP。|Chrome 同 Firefox 冇提供单独关闭 QUIC 嘅扩展 API。|扩展唔可以停用浏览器所有连接嘅 IPv6。|封锁新 WebSocket 连接，唔影响普通 HTTP/HTTPS 请求。|独立封锁新 WebTransport 连接，唔影响 WebSocket。|用唔到|请允许用户脚本，喺网站脚本之前套用设定。|允许 Custom|打开浏览器设定|网络设定适用于所有网站。|实际状态|WebRTC 已封锁|WebRTC 替换已生效|WebRTC 已允许|API Guard 已开启|请先取消草稿再更新。|请揀自订装置列表或者随机识别码其中一种。'
  ],
  wuu: [
    '硬件、操作系统搭网络设置。|Antidetect 分类|硬件|系统|网络|全部|浏览器',
    'API 管理|WebRTC 模式|允许|阻止|替换|保存|取消|刷新|设置载入当中…|有呒没保存个改动|设置已保存|设置勒别个窗口改过了。请刷新后再保存。|请检查输入个值。|设置呒没保存成功。|呒没授予权限。|API Guard 已关闭：页面设置弗生效。|重新载入开着个页面来应用保存个改动。|设置勒别个地方改过了。草稿已保留。',
    '使用自定义 ICE 地址|从 IPv4 生成映射 IPv6|空字段会隐藏对应地址族搭候选类型个地址。|媒体设备模式|原来|随机标识符|自定义列表|设备类型|显示名称|设备 ID|组 ID|添加设备|移除设备|麦克风|摄像头|音频输出|列表是空个。网站会看弗到设备。|只改设备列表信息；弗会创建摄像头、麦克风或者媒体流。|浏览器证书',
    '防止泄漏|扩展弗能阻止所有 UDP 流量。WebRTC 策略只控制 WebRTC 代理外头个 UDP。|Chrome 搭 Firefox 呒没单独关闭 QUIC 个扩展 API。|扩展弗能禁用浏览器所有连接个 IPv6。|阻止新 WebSocket 连接，弗影响普通 HTTP/HTTPS 请求。|独立阻止新 WebTransport 连接，弗影响 WebSocket。|弗可用|请允许用户脚本，勒网站脚本前头应用页面设置。|允许 Custom|打开浏览器设置|网络设置适用所有网站。|实际状态|WebRTC 已阻止|WebRTC 替换已生效|WebRTC 已允许|API Guard 已开启|刷新前头请先取消草稿。|请选择自定义设备列表或者随机标识符其中一种。'
  ]
};
const EXTRA = {
  en: 'Inherited from API Guard|Inactive in the current access scope|Browser-wide|Covered pages|Not applied|Waiting for page reload',
  ru: 'Наследуется из API Guard|Не применяется в текущей области доступа|Во всём браузере|На охваченных страницах|Не применено|Ожидается перезагрузка страницы',
  zh_CN: '继承自 API Guard|在当前访问范围内未生效|整个浏览器|已覆盖页面|未应用|等待页面重新加载',
  vi: 'Kế thừa từ API Guard|Không hoạt động trong phạm vi truy cập hiện tại|Toàn bộ trình duyệt|Các trang được hỗ trợ|Chưa áp dụng|Đang chờ tải lại trang',
  es: 'Heredado de API Guard|Inactivo en el ámbito de acceso actual|Todo el navegador|Páginas cubiertas|No aplicado|Esperando recarga de la página',
  ar: 'موروث من API Guard|غير نشط في نطاق الوصول الحالي|المتصفح بأكمله|الصفحات المشمولة|لم يُطبق|بانتظار إعادة تحميل الصفحة',
  uk: 'Успадковується з API Guard|Не застосовується в поточній області доступу|Весь браузер|Охоплені сторінки|Не застосовано|Очікується перезавантаження сторінки',
  fr: 'Hérité d’API Guard|Inactif dans le périmètre d’accès actuel|Tout le navigateur|Pages couvertes|Non appliqué|En attente du rechargement',
  pt_BR: 'Herdado do API Guard|Inativo no escopo de acesso atual|Todo o navegador|Páginas cobertas|Não aplicado|Aguardando recarregar a página',
  hi: 'API Guard से लिया गया|मौजूदा एक्सेस दायरे में निष्क्रिय|पूरा ब्राउज़र|कवर किए गए पेज|लागू नहीं हुआ|पेज दोबारा लोड होने की प्रतीक्षा',
  ur: 'API Guard سے وراثت|موجودہ رسائی کے دائرے میں غیر فعال|پورا براؤزر|شامل صفحات|لاگو نہیں ہوا|صفحہ دوبارہ لوڈ ہونے کا انتظار',
  ja: 'API Guard から継承|現在のアクセス範囲では無効|ブラウザー全体|対象ページ|未適用|ページの再読み込み待ち',
  de: 'Von API Guard übernommen|Im aktuellen Zugriffsbereich inaktiv|Gesamter Browser|Abgedeckte Seiten|Nicht angewendet|Wartet auf Neuladen der Seite',
  pl: 'Dziedziczone z API Guard|Nieaktywne w bieżącym zakresie dostępu|Cała przeglądarka|Objęte strony|Nie zastosowano|Oczekiwanie na ponowne wczytanie strony',
  id: 'Diwarisi dari API Guard|Tidak aktif dalam cakupan akses saat ini|Seluruh browser|Halaman yang tercakup|Tidak diterapkan|Menunggu halaman dimuat ulang',
  mr: 'API Guard कडून वारसा|सध्याच्या प्रवेश क्षेत्रात निष्क्रिय|संपूर्ण ब्राउझर|समाविष्ट पृष्ठे|लागू झाले नाही|पृष्ठ पुन्हा लोड होण्याची प्रतीक्षा',
  te: 'API Guard నుంచి వారసత్వం|ప్రస్తుత ప్రవేశ పరిధిలో క్రియారహితం|బ్రౌజర్ అంతటా|కవర్ చేసిన పేజీలు|వర్తించలేదు|పేజీ మళ్లీ లోడ్ కోసం వేచి ఉంది',
  ko: 'API Guard에서 상속|현재 접근 범위에서 비활성|브라우저 전체|대상 페이지|적용되지 않음|페이지 새로고침 대기',
  ta: 'API Guard-இலிருந்து பெறப்பட்டது|தற்போதைய அணுகல் வரம்பில் செயலற்றது|முழு உலாவி|உள்ளடங்கிய பக்கங்கள்|பயன்படுத்தப்படவில்லை|பக்க மறுஏற்றத்துக்காகக் காத்திருக்கிறது',
  yue: '由 API Guard 继承|喺目前存取范围未生效|成个浏览器|涵盖嘅网页|未套用|等紧重新载入网页',
  wuu: '从 API Guard 继承|当前访问范围内弗生效|整个浏览器|覆盖个页面|呒没应用|等待页面重新载入'
};
export const ANTIDETECT_UI_MESSAGES = Object.freeze(Object.fromEntries(Object.entries(COPY).map(([locale, sections]) => {
  const values = sections.join('|').split('|');
  if (values.length !== FIELDS.length || values.some(value => !value || value !== value.trim())) throw new Error('Antidetect copy: invalid locale ' + locale + ' (' + values.length + '/' + FIELDS.length + ')');
  const extras = EXTRA[locale]?.split('|');
  if (!extras || extras.length !== EXTRA_FIELDS.length || extras.some(value => !value || value !== value.trim())) throw new Error('Antidetect copy: invalid extra locale ' + locale);
  const masters = MASTER_COPY[locale]?.split('|');
  if (!masters || masters.length !== MASTER_FIELDS.length || masters.some(value => !value || value !== value.trim())) throw new Error('Antidetect copy: invalid master locale ' + locale);
  return [locale, Object.freeze({ management_tab_antidetect: 'Antidetect', ...Object.fromEntries(FIELDS.map((key, index) => ['antidetect_' + key, values[index]])), ...Object.fromEntries(EXTRA_FIELDS.map((key, index) => ['antidetect_' + key, extras[index]])), ...Object.fromEntries(MASTER_FIELDS.map((key, index) => ['antidetect_' + key, masters[index]])) })];
})));
// Existing translations are reused only where their meaning is also correct in the API editor.
export const ANTIDETECT_EDITOR_ALIASES = Object.freeze({
  edit: 'browser_debug_action_edit', delete: 'browser_debug_action_remove', label: 'browser_debug_field_name', value: 'browser_debug_field_value',
  save: 'antidetect_save', cancel: 'antidetect_cancel', actual: 'browser_debug_field_value', export: 'browser_debug_export',
  previewExport: 'browser_debug_export_preview', download: 'browser_debug_download', error: 'antidetect_failed', stale: 'antidetect_stale',
  invalidValue: 'antidetect_invalid', confirm: 'browser_debug_action_remove', master: 'antidetect_master', loading: 'antidetect_loading',
  saveConfig: 'antidetect_save', saveReload: 'protection_save_reload', refresh: 'antidetect_refresh', discard: 'antidetect_cancel',
  reset: 'protection_reset', scope: 'protection_scope', site: 'protection_webrtc_site', addSite: 'protection_add_site',
  removeSite: 'protection_remove_site', siteOff: 'protection_site_off', searchApis: 'protection_search', draft: 'antidetect_unsaved',
  configSaved: 'antidetect_saved', inactive: 'antidetect_inactive', active: 'antidetect_api_active', reload: 'antidetect_reload_required',
  preset: 'protection_preset', limited: 'protection_limited', strict: 'protection_strict', noApis: 'protection_no_rows', inherited: 'protection_inherit',
  earlyPermission: 'antidetect_early_required', earlyUnsupported: 'protection_webrtc_unsupported', earlyGrant: 'antidetect_grant_early',
  earlySettings: 'antidetect_early_settings', earlyRefresh: 'antidetect_refresh', earlyDenied: 'antidetect_denied',
  groups_graphics: 'protection_group_graphics', groups_media: 'protection_group_media', groups_device: 'protection_group_device',
  groups_hardware: 'protection_group_hardware', groups_background: 'protection_group_background', groups_browser: 'protection_group_browser',
  groups_system: 'protection_group_system', groups_ai: 'protection_group_ai', groups_storage: 'protection_group_storage',
  groups_network: 'protection_group_network', groups_identity: 'protection_group_identity'
});
const EDITOR_FIELDS = Object.freeze([
  'choose', 'search', 'create', 'presets', 'own', 'noMatches', 'valueType', 'unset', 'empty', 'saved', 'deleted',
  'import', 'previewImport', 'apply', 'undo', 'imported', 'undone', 'changed', 'changedSites', 'all', 'noChanges', 'migrated',
  'tooLarge', 'invalidJson', 'nameRequired', 'invalidNumber', 'unsupported', 'confirmDelete', 'format', 'selected', 'showValue',
  'hints_string', 'hints_integer', 'hints_number', 'hints_boolean', 'hints_object', 'hints_array', 'title', 'global', 'noHost', 'hostError',
  'configured', 'allGroups', 'customOnly', 'activationFailed', 'earlyToggle'
]);
const EDITOR_COPY = {
  en: [
    'Choose a value|Search values|Create New Value|Preset values|Your values|No matching values|Value type|Not selected|Empty string ("")|Value saved|Value deleted',
    'Import JSON|Import preview|Apply import|Undo import|Configuration imported|Import undone|Changed APIs|Changed sites|All APIs|No changes|Previous configuration format converted',
    'The configuration file is too large.|Invalid JSON file.|Enter a value name.|Enter a finite number.|Custom values are unavailable for this API.|Delete this saved value?|Format version|Value selected|Current value',
    'Text; an empty string is a separate value.|Whole number.|Finite number.|Boolean: true or false.|JSON object.|JSON array.|Browser API configuration|All sites|Choose a site|Enter a valid exact host, for example example.com.|Configured only|All categories|Custom supported|Settings saved, but API overrides were not applied. Check Custom access and refresh before reloading the site.|Enable Allow User Scripts in the extension’s browser settings, then restart the browser and reopen this editor.'
  ],
  ru: [
    'Выберите значение|Поиск значений|Создать значение|Предустановленные значения|Ваши значения|Нет подходящих значений|Тип значения|Не выбрано|Пустая строка ("")|Значение сохранено|Значение удалено',
    'Импорт JSON|Предпросмотр импорта|Применить импорт|Отменить импорт|Конфигурация импортирована|Импорт отменён|Изменённых API|Изменённых сайтов|Всего API|Изменений нет|Предыдущий формат конфигурации преобразован',
    'Файл конфигурации слишком большой.|Некорректный JSON-файл.|Введите название значения.|Введите конечное число.|Для этого API пользовательские значения недоступны.|Удалить сохранённое значение?|Версия формата|Значение выбрано|Текущее значение',
    'Текст; пустая строка — отдельное значение.|Целое число.|Конечное число.|Логическое значение: true или false.|JSON-объект.|JSON-массив.|Конфигурация браузерных API|Все сайты|Выберите сайт|Введите корректный хост, например example.com.|Только настроенные|Все категории|Поддерживают Custom|Настройки сохранены, но переопределения API не применены. Проверьте доступ Custom и обновите настройки перед перезагрузкой сайта.|Включите «Разрешить пользовательские скрипты» в настройках расширения в браузере, затем перезапустите браузер и снова откройте редактор.'
  ],
  zh_CN: [
    '选择值|搜索值|创建新值|预设值|您的值|没有匹配值|值类型|未选择|空字符串 ("")|值已保存|值已删除',
    '导入 JSON|导入预览|应用导入|撤销导入|配置已导入|已撤销导入|已更改的 API|已更改的网站|全部 API|没有更改|已转换旧版配置格式',
    '配置文件过大。|JSON 文件无效。|请输入值名称。|请输入有限数值。|此 API 不支持自定义值。|删除此已保存的值？|格式版本|已选择值|当前值',
    '文本；空字符串是单独的值。|整数。|有限数值。|布尔值：true 或 false。|JSON 对象。|JSON 数组。|浏览器 API 配置|所有网站|选择网站|请输入有效的确切主机名，例如 example.com。|仅已配置|全部分类|支持 Custom|设置已保存，但 API 覆盖未应用。请检查 Custom 权限并刷新设置，然后重新加载网站。|在浏览器的扩展设置中启用“允许用户脚本”，然后重启浏览器并重新打开此编辑器。'
  ],
  vi: [
    'Chọn giá trị|Tìm giá trị|Tạo giá trị mới|Giá trị có sẵn|Giá trị của bạn|Không có giá trị phù hợp|Loại giá trị|Chưa chọn|Chuỗi rỗng ("")|Đã lưu giá trị|Đã xóa giá trị',
    'Nhập JSON|Xem trước nhập|Áp dụng nhập|Hoàn tác nhập|Đã nhập cấu hình|Đã hoàn tác nhập|API đã thay đổi|Trang đã thay đổi|Tất cả API|Không có thay đổi|Đã chuyển đổi định dạng cấu hình cũ',
    'Tệp cấu hình quá lớn.|Tệp JSON không hợp lệ.|Nhập tên giá trị.|Nhập số hữu hạn.|API này không hỗ trợ giá trị tùy chỉnh.|Xóa giá trị đã lưu này?|Phiên bản định dạng|Đã chọn giá trị|Giá trị hiện tại',
    'Văn bản; chuỗi rỗng là một giá trị riêng.|Số nguyên.|Số hữu hạn.|Boolean: true hoặc false.|Đối tượng JSON.|Mảng JSON.|Cấu hình API trình duyệt|Mọi trang web|Chọn trang web|Nhập tên máy chủ chính xác hợp lệ, ví dụ example.com.|Chỉ đã cấu hình|Mọi danh mục|Hỗ trợ Custom|Đã lưu nhưng chưa áp dụng ghi đè API. Kiểm tra quyền Custom và làm mới trước khi tải lại trang.|Bật Cho phép tập lệnh người dùng trong cài đặt tiện ích của trình duyệt, rồi khởi động lại trình duyệt và mở lại trình chỉnh sửa.'
  ],
  es: [
    'Elegir valor|Buscar valores|Crear nuevo valor|Valores predefinidos|Tus valores|No hay valores coincidentes|Tipo de valor|Sin seleccionar|Cadena vacía ("")|Valor guardado|Valor eliminado',
    'Importar JSON|Vista previa de importación|Aplicar importación|Deshacer importación|Configuración importada|Importación deshecha|API modificadas|Sitios modificados|Todas las API|Sin cambios|Formato de configuración anterior convertido',
    'El archivo de configuración es demasiado grande.|Archivo JSON no válido.|Introduce un nombre para el valor.|Introduce un número finito.|Esta API no admite valores personalizados.|¿Eliminar este valor guardado?|Versión del formato|Valor seleccionado|Valor actual',
    'Texto; una cadena vacía es un valor independiente.|Número entero.|Número finito.|Booleano: true o false.|Objeto JSON.|Matriz JSON.|Configuración de API del navegador|Todos los sitios|Elegir sitio|Introduce un host exacto válido, por ejemplo example.com.|Solo configuradas|Todas las categorías|Compatible con Custom|Ajustes guardados, pero las sustituciones de API no se aplicaron. Revisa el acceso Custom y actualiza antes de recargar el sitio.|Activa Permitir scripts de usuario en los ajustes de la extensión del navegador, reinicia el navegador y vuelve a abrir este editor.'
  ],
  ar: [
    'اختر قيمة|البحث في القيم|إنشاء قيمة جديدة|قيم مسبقة|قيمك|لا توجد قيم مطابقة|نوع القيمة|غير محدد|سلسلة فارغة ("")|تم حفظ القيمة|تم حذف القيمة',
    'استيراد JSON|معاينة الاستيراد|تطبيق الاستيراد|التراجع عن الاستيراد|تم استيراد الإعدادات|تم التراجع عن الاستيراد|واجهات API المعدلة|المواقع المعدلة|كل واجهات API|لا توجد تغييرات|تم تحويل تنسيق الإعدادات السابق',
    'ملف الإعدادات كبير جدًا.|ملف JSON غير صالح.|أدخل اسمًا للقيمة.|أدخل رقمًا محدودًا.|القيم المخصصة غير متاحة لواجهة API هذه.|هل تريد حذف هذه القيمة المحفوظة؟|إصدار التنسيق|تم اختيار القيمة|القيمة الحالية',
    'نص؛ السلسلة الفارغة قيمة مستقلة.|عدد صحيح.|رقم محدود.|قيمة منطقية: true أو false.|كائن JSON.|مصفوفة JSON.|إعدادات واجهات API للمتصفح|كل المواقع|اختر موقعًا|أدخل اسم مضيف دقيقًا صالحًا، مثل example.com.|المعدة فقط|كل الفئات|يدعم Custom|تم حفظ الإعدادات لكن لم تُطبق تغييرات API. تحقق من إذن Custom وحدّث قبل إعادة تحميل الموقع.|فعّل السماح ببرامج المستخدم النصية في إعدادات الإضافة بالمتصفح، ثم أعد تشغيل المتصفح وافتح هذا المحرر مجددًا.'
  ],
  uk: [
    'Виберіть значення|Пошук значень|Створити значення|Попередні значення|Ваші значення|Немає відповідних значень|Тип значення|Не вибрано|Порожній рядок ("")|Значення збережено|Значення видалено',
    'Імпорт JSON|Перегляд імпорту|Застосувати імпорт|Скасувати імпорт|Конфігурацію імпортовано|Імпорт скасовано|Змінених API|Змінених сайтів|Усього API|Змін немає|Попередній формат конфігурації перетворено',
    'Файл конфігурації завеликий.|Некоректний JSON-файл.|Введіть назву значення.|Введіть скінченне число.|Цей API не підтримує власні значення.|Видалити збережене значення?|Версія формату|Значення вибрано|Поточне значення',
    'Текст; порожній рядок — окреме значення.|Ціле число.|Скінченне число.|Логічне значення: true або false.|JSON-об’єкт.|JSON-масив.|Конфігурація браузерних API|Усі сайти|Виберіть сайт|Введіть коректний точний хост, наприклад example.com.|Лише налаштовані|Усі категорії|Підтримують Custom|Налаштування збережено, але перевизначення API не застосовано. Перевірте доступ Custom і оновіть перед перезавантаженням сайту.|Увімкніть дозвіл користувацьких скриптів у налаштуваннях розширення браузера, перезапустіть браузер і знову відкрийте редактор.'
  ],
  fr: [
    'Choisir une valeur|Rechercher des valeurs|Créer une valeur|Valeurs prédéfinies|Vos valeurs|Aucune valeur correspondante|Type de valeur|Non sélectionné|Chaîne vide ("")|Valeur enregistrée|Valeur supprimée',
    'Importer JSON|Aperçu de l’importation|Appliquer l’importation|Annuler l’importation|Configuration importée|Importation annulée|API modifiées|Sites modifiés|Toutes les API|Aucune modification|Ancien format de configuration converti',
    'Le fichier de configuration est trop volumineux.|Fichier JSON non valide.|Saisissez un nom de valeur.|Saisissez un nombre fini.|Cette API ne prend pas en charge les valeurs personnalisées.|Supprimer cette valeur enregistrée ?|Version du format|Valeur sélectionnée|Valeur actuelle',
    'Texte ; une chaîne vide est une valeur distincte.|Nombre entier.|Nombre fini.|Booléen : true ou false.|Objet JSON.|Tableau JSON.|Configuration des API du navigateur|Tous les sites|Choisir un site|Saisissez un hôte exact valide, par exemple example.com.|Configurées uniquement|Toutes les catégories|Compatible Custom|Réglages enregistrés, mais les substitutions d’API n’ont pas été appliquées. Vérifiez l’accès Custom et actualisez avant de recharger le site.|Activez l’autorisation des scripts utilisateur dans les réglages de l’extension du navigateur, puis redémarrez le navigateur et rouvrez cet éditeur.'
  ],
  pt_BR: [
    'Escolher um valor|Pesquisar valores|Criar novo valor|Valores predefinidos|Seus valores|Nenhum valor correspondente|Tipo de valor|Não selecionado|Texto vazio ("")|Valor salvo|Valor removido',
    'Importar JSON|Prévia da importação|Aplicar importação|Desfazer importação|Configuração importada|Importação desfeita|APIs alteradas|Sites alterados|Todas as APIs|Sem alterações|Formato anterior da configuração convertido',
    'O arquivo de configuração é muito grande.|Arquivo JSON inválido.|Digite um nome para o valor.|Digite um número finito.|Esta API não aceita valores personalizados.|Remover este valor salvo?|Versão do formato|Valor selecionado|Valor atual',
    'Texto; uma string vazia é um valor separado.|Número inteiro.|Número finito.|Booleano: true ou false.|Objeto JSON.|Array JSON.|Configuração de APIs do navegador|Todos os sites|Escolher site|Digite um host exato válido, por exemplo example.com.|Apenas configuradas|Todas as categorias|Compatível com Custom|Configurações salvas, mas as substituições de API não foram aplicadas. Verifique o acesso Custom e atualize antes de recarregar o site.|Ative Permitir scripts de usuário nas configurações da extensão no navegador, reinicie o navegador e abra este editor novamente.'
  ],
  hi: [
    'मान चुनें|मान खोजें|नया मान बनाएँ|प्रीसेट मान|आपके मान|कोई मेल खाता मान नहीं|मान का प्रकार|चुना नहीं गया|खाली स्ट्रिंग ("")|मान सहेजा गया|मान हटाया गया',
    'JSON आयात करें|आयात का पूर्वावलोकन|आयात लागू करें|आयात वापस लें|कॉन्फ़िगरेशन आयात किया गया|आयात वापस लिया गया|बदले गए API|बदली गई साइटें|सभी API|कोई बदलाव नहीं|पुराना कॉन्फ़िगरेशन प्रारूप बदला गया',
    'कॉन्फ़िगरेशन फ़ाइल बहुत बड़ी है।|अमान्य JSON फ़ाइल।|मान का नाम दर्ज करें।|सीमित संख्या दर्ज करें।|इस API के लिए कस्टम मान उपलब्ध नहीं हैं।|यह सहेजा गया मान हटाएँ?|प्रारूप संस्करण|मान चुना गया|मौजूदा मान',
    'टेक्स्ट; खाली स्ट्रिंग एक अलग मान है।|पूर्णांक।|सीमित संख्या।|बूलियन: true या false।|JSON ऑब्जेक्ट।|JSON ऐरे।|ब्राउज़र API कॉन्फ़िगरेशन|सभी साइटें|साइट चुनें|सही और सटीक होस्ट दर्ज करें, जैसे example.com।|केवल कॉन्फ़िगर किए गए|सभी श्रेणियाँ|Custom समर्थित|सेटिंग्स सहेजी गईं, पर API बदलाव लागू नहीं हुए। Custom एक्सेस जाँचें और साइट दोबारा लोड करने से पहले रीफ़्रेश करें।|ब्राउज़र की एक्सटेंशन सेटिंग्स में यूज़र स्क्रिप्ट की अनुमति चालू करें, फिर ब्राउज़र दोबारा शुरू करके यह संपादक खोलें।'
  ],
  ur: [
    'قدر منتخب کریں|قدریں تلاش کریں|نئی قدر بنائیں|پہلے سے طے شدہ قدریں|آپ کی قدریں|کوئی مماثل قدر نہیں|قدر کی قسم|منتخب نہیں|خالی متن ("")|قدر محفوظ ہو گئی|قدر حذف ہو گئی',
    'JSON درآمد کریں|درآمد کا پیش نظارہ|درآمد لاگو کریں|درآمد واپس لیں|ترتیب درآمد ہو گئی|درآمد واپس لے لی گئی|تبدیل شدہ API|تبدیل شدہ سائٹس|تمام API|کوئی تبدیلی نہیں|پرانا ترتیبی فارمیٹ تبدیل ہو گیا',
    'ترتیب کی فائل بہت بڑی ہے۔|غلط JSON فائل۔|قدر کا نام درج کریں۔|محدود عدد درج کریں۔|اس API کے لیے حسبِ ضرورت قدریں دستیاب نہیں۔|یہ محفوظ قدر حذف کریں؟|فارمیٹ کا ورژن|قدر منتخب ہو گئی|موجودہ قدر',
    'متن؛ خالی متن ایک الگ قدر ہے۔|صحیح عدد۔|محدود عدد۔|بولین: true یا false۔|JSON آبجیکٹ۔|JSON صف۔|براؤزر API کی ترتیب|تمام سائٹس|سائٹ منتخب کریں|درست عین میزبان درج کریں، مثلاً example.com۔|صرف ترتیب دیے گئے|تمام زمرے|Custom معاونت|ترتیبات محفوظ ہوئیں مگر API تبدیلیاں لاگو نہیں ہوئیں۔ Custom رسائی جانچیں اور سائٹ دوبارہ لوڈ کرنے سے پہلے تازہ کریں۔|براؤزر کی ایکسٹینشن ترتیبات میں صارف اسکرپٹس کی اجازت فعال کریں، پھر براؤزر دوبارہ شروع کر کے یہ ایڈیٹر کھولیں۔'
  ],
  ja: [
    '値を選択|値を検索|新しい値を作成|プリセット値|自分の値|一致する値がありません|値の種類|未選択|空文字列 ("")|値を保存しました|値を削除しました',
    'JSON をインポート|インポートのプレビュー|インポートを適用|インポートを元に戻す|設定をインポートしました|インポートを元に戻しました|変更された API|変更されたサイト|すべての API|変更なし|以前の設定形式を変換しました',
    '設定ファイルが大きすぎます。|無効な JSON ファイルです。|値の名前を入力してください。|有限の数値を入力してください。|この API ではカスタム値を利用できません。|この保存済みの値を削除しますか？|形式のバージョン|値を選択しました|現在の値',
    'テキスト。空文字列は独立した値です。|整数。|有限の数値。|真偽値：true または false。|JSON オブジェクト。|JSON 配列。|ブラウザー API の設定|すべてのサイト|サイトを選択|example.com などの正確なホスト名を入力してください。|設定済みのみ|すべてのカテゴリ|Custom 対応|設定は保存されましたが API の変更は適用されていません。Custom 権限を確認し、サイト再読み込み前に設定を更新してください。|ブラウザーの拡張機能設定でユーザースクリプトを許可し、ブラウザーを再起動してこのエディターを開き直してください。'
  ],
  de: [
    'Wert auswählen|Werte suchen|Neuen Wert erstellen|Vorgabewerte|Deine Werte|Keine passenden Werte|Werttyp|Nicht ausgewählt|Leere Zeichenfolge ("")|Wert gespeichert|Wert gelöscht',
    'JSON importieren|Importvorschau|Import anwenden|Import rückgängig machen|Konfiguration importiert|Import rückgängig gemacht|Geänderte APIs|Geänderte Websites|Alle APIs|Keine Änderungen|Früheres Konfigurationsformat konvertiert',
    'Die Konfigurationsdatei ist zu groß.|Ungültige JSON-Datei.|Gib einen Namen für den Wert ein.|Gib eine endliche Zahl ein.|Für diese API sind keine eigenen Werte verfügbar.|Diesen gespeicherten Wert löschen?|Formatversion|Wert ausgewählt|Aktueller Wert',
    'Text; eine leere Zeichenfolge ist ein eigener Wert.|Ganze Zahl.|Endliche Zahl.|Boolesch: true oder false.|JSON-Objekt.|JSON-Array.|Browser-API-Konfiguration|Alle Websites|Website auswählen|Gib einen gültigen genauen Host ein, etwa example.com.|Nur konfigurierte|Alle Kategorien|Custom unterstützt|Einstellungen gespeichert, aber API-Änderungen wurden nicht angewendet. Prüfe den Custom-Zugriff und aktualisiere vor dem Neuladen der Website.|Erlaube Benutzerskripte in den Erweiterungseinstellungen des Browsers. Starte den Browser neu und öffne diesen Editor erneut.'
  ],
  pl: [
    'Wybierz wartość|Szukaj wartości|Utwórz nową wartość|Wartości domyślne|Twoje wartości|Brak pasujących wartości|Typ wartości|Nie wybrano|Pusty tekst ("")|Wartość zapisana|Wartość usunięta',
    'Importuj JSON|Podgląd importu|Zastosuj import|Cofnij import|Konfiguracja zaimportowana|Import cofnięty|Zmienione API|Zmienione witryny|Wszystkie API|Brak zmian|Poprzedni format konfiguracji przekonwertowany',
    'Plik konfiguracji jest za duży.|Nieprawidłowy plik JSON.|Wpisz nazwę wartości.|Wpisz liczbę skończoną.|Ta API nie obsługuje własnych wartości.|Usunąć zapisaną wartość?|Wersja formatu|Wartość wybrana|Bieżąca wartość',
    'Tekst; pusty tekst jest osobną wartością.|Liczba całkowita.|Liczba skończona.|Wartość logiczna: true albo false.|Obiekt JSON.|Tablica JSON.|Konfiguracja API przeglądarki|Wszystkie witryny|Wybierz witrynę|Wpisz prawidłowy dokładny host, np. example.com.|Tylko skonfigurowane|Wszystkie kategorie|Obsługuje Custom|Zapisano ustawienia, ale zmiany API nie zostały zastosowane. Sprawdź dostęp Custom i odśwież przed ponownym wczytaniem witryny.|Włącz skrypty użytkownika w ustawieniach rozszerzenia w przeglądarce, uruchom przeglądarkę ponownie i otwórz edytor.'
  ],
  id: [
    'Pilih nilai|Cari nilai|Buat nilai baru|Nilai prasetel|Nilai Anda|Tidak ada nilai yang cocok|Jenis nilai|Belum dipilih|Teks kosong ("")|Nilai disimpan|Nilai dihapus',
    'Impor JSON|Pratinjau impor|Terapkan impor|Urungkan impor|Konfigurasi diimpor|Impor diurungkan|API yang berubah|Situs yang berubah|Semua API|Tidak ada perubahan|Format konfigurasi lama dikonversi',
    'File konfigurasi terlalu besar.|File JSON tidak valid.|Masukkan nama nilai.|Masukkan angka berhingga.|Nilai kustom tidak tersedia untuk API ini.|Hapus nilai tersimpan ini?|Versi format|Nilai dipilih|Nilai saat ini',
    'Teks; teks kosong adalah nilai tersendiri.|Bilangan bulat.|Angka berhingga.|Boolean: true atau false.|Objek JSON.|Larik JSON.|Konfigurasi API browser|Semua situs|Pilih situs|Masukkan host persis yang valid, misalnya example.com.|Hanya yang dikonfigurasi|Semua kategori|Mendukung Custom|Setelan disimpan, tetapi perubahan API tidak diterapkan. Periksa akses Custom dan muat ulang setelan sebelum memuat ulang situs.|Aktifkan Izinkan skrip pengguna di setelan ekstensi browser, lalu mulai ulang browser dan buka kembali editor ini.'
  ],
  mr: [
    'मूल्य निवडा|मूल्ये शोधा|नवीन मूल्य तयार करा|पूर्वनिर्धारित मूल्ये|तुमची मूल्ये|जुळणारी मूल्ये नाहीत|मूल्याचा प्रकार|निवडलेले नाही|रिकामी स्ट्रिंग ("")|मूल्य जतन केले|मूल्य काढले',
    'JSON आयात करा|आयात पूर्वावलोकन|आयात लागू करा|आयात मागे घ्या|कॉन्फिगरेशन आयात केले|आयात मागे घेतली|बदललेले API|बदललेल्या साइट्स|सर्व API|बदल नाहीत|पूर्वीचे कॉन्फिगरेशन स्वरूप रूपांतरित केले',
    'कॉन्फिगरेशन फाइल खूप मोठी आहे.|अवैध JSON फाइल.|मूल्याचे नाव प्रविष्ट करा.|सान्त संख्या प्रविष्ट करा.|या API साठी सानुकूल मूल्ये उपलब्ध नाहीत.|हे जतन केलेले मूल्य काढायचे?|स्वरूप आवृत्ती|मूल्य निवडले|सध्याचे मूल्य',
    'मजकूर; रिकामी स्ट्रिंग हे स्वतंत्र मूल्य आहे.|पूर्णांक.|सान्त संख्या.|बूलियन: true किंवा false.|JSON ऑब्जेक्ट.|JSON अ‍ॅरे.|ब्राउझर API कॉन्फिगरेशन|सर्व साइट्स|साइट निवडा|योग्य अचूक होस्ट प्रविष्ट करा, जसे example.com.|फक्त कॉन्फिगर केलेले|सर्व श्रेणी|Custom समर्थित|सेटिंग्ज जतन केल्या, पण API बदल लागू झाले नाहीत. Custom प्रवेश तपासा आणि साइट पुन्हा लोड करण्यापूर्वी रिफ्रेश करा.|ब्राउझरमधील विस्तार सेटिंग्जमध्ये वापरकर्ता स्क्रिप्टना परवानगी द्या, नंतर ब्राउझर पुन्हा सुरू करून हा संपादक उघडा.'
  ],
  te: [
    'విలువ ఎంచుకోండి|విలువలు వెతకండి|కొత్త విలువ సృష్టించు|ముందుగా ఇచ్చిన విలువలు|మీ విలువలు|సరిపోలే విలువలు లేవు|విలువ రకం|ఎంచుకోలేదు|ఖాళీ స్ట్రింగ్ ("")|విలువ సేవ్ అయింది|విలువ తొలగించబడింది',
    'JSON దిగుమతి|దిగుమతి ముందస్తు వీక్షణ|దిగుమతి వర్తింపజేయి|దిగుమతి రద్దు చేయి|కాన్ఫిగరేషన్ దిగుమతి అయింది|దిగుమతి రద్దు అయింది|మారిన APIలు|మారిన సైట్‌లు|అన్ని APIలు|మార్పులు లేవు|పాత కాన్ఫిగరేషన్ ఫార్మాట్ మార్చబడింది',
    'కాన్ఫిగరేషన్ ఫైల్ చాలా పెద్దది.|చెల్లని JSON ఫైల్.|విలువకు పేరు నమోదు చేయండి.|పరిమిత సంఖ్యను నమోదు చేయండి.|ఈ APIకి అనుకూల విలువలు అందుబాటులో లేవు.|ఈ సేవ్ చేసిన విలువను తొలగించాలా?|ఫార్మాట్ సంస్కరణ|విలువ ఎంచుకోబడింది|ప్రస్తుత విలువ',
    'టెక్స్ట్; ఖాళీ స్ట్రింగ్ ప్రత్యేక విలువ.|పూర్ణ సంఖ్య.|పరిమిత సంఖ్య.|బూలియన్: true లేదా false.|JSON ఆబ్జెక్ట్.|JSON అరే.|బ్రౌజర్ API కాన్ఫిగరేషన్|అన్ని సైట్‌లు|సైట్ ఎంచుకోండి|example.com వంటి చెల్లుబాటు అయ్యే ఖచ్చిత హోస్ట్ నమోదు చేయండి.|కాన్ఫిగర్ చేసినవి మాత్రమే|అన్ని వర్గాలు|Custom మద్దతు|సెట్టింగ్‌లు సేవ్ అయ్యాయి, కానీ API మార్పులు వర్తించలేదు. Custom ప్రవేశాన్ని తనిఖీ చేసి, సైట్ మళ్లీ లోడ్ చేసే ముందు రిఫ్రెష్ చేయండి.|బ్రౌజర్ పొడిగింపు సెట్టింగ్‌లలో యూజర్ స్క్రిప్ట్‌లను అనుమతించి, బ్రౌజర్ పునఃప్రారంభించి ఈ ఎడిటర్ మళ్లీ తెరవండి.'
  ],
  ko: [
    '값 선택|값 검색|새 값 만들기|기본값|내 값|일치하는 값 없음|값 유형|선택하지 않음|빈 문자열 ("")|값 저장됨|값 삭제됨',
    'JSON 가져오기|가져오기 미리보기|가져오기 적용|가져오기 취소|설정을 가져왔습니다|가져오기를 취소했습니다|변경된 API|변경된 사이트|모든 API|변경 없음|이전 설정 형식이 변환되었습니다',
    '설정 파일이 너무 큽니다.|유효하지 않은 JSON 파일입니다.|값 이름을 입력하세요.|유한한 숫자를 입력하세요.|이 API에서는 사용자 지정 값을 사용할 수 없습니다.|이 저장된 값을 삭제할까요?|형식 버전|값 선택됨|현재 값',
    '텍스트입니다. 빈 문자열은 별도의 값입니다.|정수.|유한한 숫자.|불리언: true 또는 false.|JSON 객체.|JSON 배열.|브라우저 API 설정|모든 사이트|사이트 선택|example.com과 같은 유효한 정확한 호스트를 입력하세요.|설정된 항목만|모든 카테고리|Custom 지원|설정은 저장되었지만 API 변경이 적용되지 않았습니다. Custom 접근을 확인하고 사이트를 다시 로드하기 전에 새로고침하세요.|브라우저 확장 프로그램 설정에서 사용자 스크립트를 허용한 다음 브라우저를 다시 시작하고 이 편집기를 여세요.'
  ],
  ta: [
    'மதிப்பைத் தேர்ந்தெடு|மதிப்புகளைத் தேடு|புதிய மதிப்பை உருவாக்கு|முன்னமைவு மதிப்புகள்|உங்கள் மதிப்புகள்|பொருந்தும் மதிப்புகள் இல்லை|மதிப்பு வகை|தேர்ந்தெடுக்கப்படவில்லை|வெற்று உரை ("")|மதிப்பு சேமிக்கப்பட்டது|மதிப்பு நீக்கப்பட்டது',
    'JSON இறக்குமதி|இறக்குமதி முன்னோட்டம்|இறக்குமதியைப் பயன்படுத்து|இறக்குமதியை மீட்டமை|உள்ளமைவு இறக்குமதி செய்யப்பட்டது|இறக்குமதி மீட்டமைக்கப்பட்டது|மாற்றிய API-கள்|மாற்றிய தளங்கள்|அனைத்து API-கள்|மாற்றங்கள் இல்லை|முந்தைய உள்ளமைவு வடிவம் மாற்றப்பட்டது',
    'உள்ளமைவுக் கோப்பு மிகப் பெரியது.|தவறான JSON கோப்பு.|மதிப்புக்குப் பெயர் உள்ளிடவும்.|வரையறுக்கப்பட்ட எண்ணை உள்ளிடவும்.|இந்த API-க்கு தனிப்பயன் மதிப்புகள் கிடைக்காது.|சேமித்த இந்த மதிப்பை நீக்கவா?|வடிவப் பதிப்பு|மதிப்பு தேர்ந்தெடுக்கப்பட்டது|தற்போதைய மதிப்பு',
    'உரை; வெற்று உரை ஒரு தனி மதிப்பு.|முழு எண்.|வரையறுக்கப்பட்ட எண்.|பூலியன்: true அல்லது false.|JSON பொருள்.|JSON வரிசை.|உலாவி API உள்ளமைவு|அனைத்துத் தளங்கள்|தளத்தைத் தேர்ந்தெடு|example.com போன்ற செல்லுபடியான துல்லிய ஹோஸ்டை உள்ளிடவும்.|அமைத்தவை மட்டும்|அனைத்து வகைகள்|Custom ஆதரவு|அமைப்புகள் சேமிக்கப்பட்டன, ஆனால் API மாற்றங்கள் பயன்படவில்லை. Custom அணுகலைச் சரிபார்த்து தளத்தை மீண்டும் ஏற்றும் முன் புதுப்பிக்கவும்.|உலாவி நீட்டிப்பு அமைப்புகளில் பயனர் ஸ்கிரிப்டுகளை அனுமதித்து, உலாவியை மறுதொடக்கம் செய்து இந்தத் திருத்தியை மீண்டும் திறக்கவும்.'
  ],
  yue: [
    '揀一个值|搜寻值|建立新值|预设值|你嘅值|冇符合嘅值|值类型|未拣|空字串 ("")|值已储存|值已删除',
    '汇入 JSON|汇入预览|套用汇入|还原汇入|设定已汇入|汇入已还原|改咗嘅 API|改咗嘅网站|全部 API|冇更改|旧版设定格式已转换',
    '设定档太大。|JSON 档案无效。|请输入值名称。|请输入有限数字。|呢个 API 唔支持自订值。|删除呢个储存值？|格式版本|值已拣|目前值',
    '文字；空字串系独立值。|整数。|有限数字。|布林值：true 或 false。|JSON 物件。|JSON 阵列。|浏览器 API 设定|所有网站|揀网站|请输入有效嘅确切主机名，例如 example.com。|只显示已设定|全部分类|支持 Custom|设定已储存，但 API 替换未套用。请检查 Custom 权限同更新设定，再载入网站。|喺浏览器扩展设定允许用户脚本，再重新启动浏览器同打开编辑器。'
  ],
  wuu: [
    '选一个值|搜索值|创建新值|预设值|侬个值|呒没匹配个值|值类型|呒没选|空字符串 ("")|值已保存|值已删除',
    '导入 JSON|导入预览|应用导入|撤销导入|配置已导入|导入已撤销|改过个 API|改过个网站|全部 API|呒没改动|旧版配置格式已转换',
    '配置文件忒大了。|JSON 文件无效。|请输入值个名称。|请输入有限数值。|搿个 API 弗支持自定义值。|删除搿个保存值？|格式版本|值已选好|当前值',
    '文本；空字符串是单独个值。|整数。|有限数值。|布尔值：true 或 false。|JSON 对象。|JSON 数组。|浏览器 API 配置|所有网站|选择网站|请输入有效个准确主机名，比方 example.com。|只显示已配置|全部分类|支持 Custom|设置已保存，但 API 替换呒没应用。请检查 Custom 权限搭刷新设置，再重新载入网站。|勒浏览器扩展设置里允许用户脚本，然后重新启动浏览器，再打开编辑器。'
  ]
};
export const ANTIDETECT_EDITOR_MESSAGES = Object.freeze(Object.fromEntries(Object.entries(EDITOR_COPY).map(([locale, sections]) => {
  const values = sections.join('|').split('|');
  if (values.length !== EDITOR_FIELDS.length || values.some(value => !value || value !== value.trim())) throw new Error('Antidetect editor copy: invalid locale ' + locale + ' (' + values.length + '/' + EDITOR_FIELDS.length + ')');
  return [locale, Object.freeze(Object.fromEntries(EDITOR_FIELDS.map((key, index) => ['antidetect_editor_' + key, values[index]])))];
})));
export const ANTIDETECT_EDITOR_FIELDS = Object.freeze([...Object.keys(ANTIDETECT_EDITOR_ALIASES), ...EDITOR_FIELDS, 'null', 'undefined', 'custom']);
export const ANTIDETECT_EDITOR_KEYS = Object.freeze(ANTIDETECT_EDITOR_FIELDS.map(key => 'antidetect_editor_' + key));
export function applyAntidetectCopy(table, locale) {
  if (!Object.hasOwn(ANTIDETECT_UI_MESSAGES, locale)) throw new Error('Antidetect copy: unknown locale ' + String(locale));
  if (!table || typeof table !== 'object' || Array.isArray(table)) throw new TypeError('Antidetect copy: expected a message table');
  for (const key of ANTIDETECT_UI_KEYS) table[key] = { message: ANTIDETECT_UI_MESSAGES[locale][key] };
  for (const [field, source] of Object.entries(ANTIDETECT_EDITOR_ALIASES)) {
    if (!table[source]?.message) throw new Error('Antidetect editor copy: missing source ' + locale + '/' + source);
    table['antidetect_editor_' + field] = { message: table[source].message };
  }
  for (const [key, message] of Object.entries(ANTIDETECT_EDITOR_MESSAGES[locale])) table[key] = { message };
  for (const value of ['null', 'undefined', 'custom']) table['antidetect_editor_' + value] = { message: value === 'custom' ? 'Custom' : value };
  return applyFingerprintCustomCopy(table, locale);
}
