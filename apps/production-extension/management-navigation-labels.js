// Local navigation labels; existing shared locale tables remain unchanged.
const rows = {
  ru:['Атака','Защита','Инструменты','Работает','Выключено','Статус недоступен','Приостановлен','Подключение'],
  en:['Attack','Defense','Tools','Active','Off','Status unavailable','Paused','Connecting'],
  zh_CN:['进攻','防护','工具','运行中','已关闭','状态不可用','已暂停','正在连接'],
  vi:['Tấn công','Bảo vệ','Công cụ','Đang hoạt động','Đã tắt','Không có trạng thái','Tạm dừng','Đang kết nối'],
  es:['Ataque','Protección','Herramientas','Activo','Desactivado','Estado no disponible','Pausado','Conectando'],
  ar:['الهجوم','الحماية','الأدوات','نشط','متوقف','الحالة غير متاحة','متوقف مؤقتًا','جارٍ الاتصال'],
  uk:['Атака','Захист','Інструменти','Працює','Вимкнено','Статус недоступний','Призупинено','Підключення'],
  fr:['Attaque','Protection','Outils','Actif','Désactivé','État indisponible','En pause','Connexion'],
  pt_BR:['Ataque','Proteção','Ferramentas','Ativo','Desativado','Estado indisponível','Pausado','Conectando'],
  hi:['आक्रमण','सुरक्षा','उपकरण','सक्रिय','बंद','स्थिति उपलब्ध नहीं','रोका गया','कनेक्ट हो रहा है'],
  ur:['حملہ','تحفظ','ٹولز','فعال','بند','حیثیت دستیاب نہیں','موقوف','منسلک ہو رہا ہے'],
  ja:['攻撃','保護','ツール','動作中','オフ','状態を取得できません','一時停止中','接続中'],
  de:['Angriff','Schutz','Werkzeuge','Aktiv','Aus','Status nicht verfügbar','Pausiert','Verbindungsaufbau'],
  pl:['Atak','Ochrona','Narzędzia','Aktywny','Wyłączony','Stan niedostępny','Wstrzymany','Łączenie'],
  id:['Serangan','Perlindungan','Alat','Aktif','Nonaktif','Status tidak tersedia','Dijeda','Menghubungkan'],
  mr:['आक्रमण','संरक्षण','साधने','सक्रिय','बंद','स्थिती उपलब्ध नाही','विराम दिला','जोडत आहे'],
  te:['దాడి','రక్షణ','సాధనాలు','సక్రియం','ఆఫ్','స్థితి అందుబాటులో లేదు','నిలిపివేయబడింది','కనెక్ట్ అవుతోంది'],
  ko:['공격','보호','도구','활성','꺼짐','상태를 확인할 수 없음','일시 중지','연결 중'],
  ta:['தாக்குதல்','பாதுகாப்பு','கருவிகள்','செயலில்','ஆஃப்','நிலை கிடைக்கவில்லை','இடைநிறுத்தம்','இணைக்கிறது'],
  yue:['進攻','防護','工具','運行中','已關閉','狀態不可用','已暫停','連線中'],
  wuu:['进攻','防护','工具','运行中','已关闭','状态不可用','已暂停','连接中'],
};
// ADR-107: the English names of the Options sections (as the en locale shows them) are extra palette keywords in every language.
export const MANAGEMENT_SECTION_ENGLISH = Object.freeze({ hub: 'Control center', detector: 'Detector', api: 'API Guard', firewall: 'Firewall', antidetect: 'Antidetect', autosurf: 'Autosurfer', cookies: 'Cookies', proxy: 'Proxy', integrations: 'Integrations', settings: 'Settings', contacts: 'Contacts', 'browser-debug': 'Browser Debug', precursor: 'Cloudflare Precursor' });
export function managementNavigationLabels(locale) {
  const key=typeof locale==='string'?locale.replace('-','_'):locale?.id;
  const row=rows[key]??rows.en;
  const inactive={ru:'Нет активных правил',en:'No active rules',zh_CN:'无生效规则',vi:'Không có quy tắc hoạt động',es:'Sin reglas activas',ar:'لا توجد قواعد نشطة',uk:'Немає активних правил',fr:'Aucune règle active',pt_BR:'Sem regras ativas',hi:'कोई सक्रिय नियम नहीं',ur:'کوئی فعال قواعد نہیں',ja:'有効なルールなし',de:'Keine aktiven Regeln',pl:'Brak aktywnych reguł',id:'Tidak ada aturan aktif',mr:'सक्रिय नियम नाहीत',te:'సక్రియ నియమాలు లేవు',ko:'활성 규칙 없음',ta:'செயலில் விதிகள் இல்லை',yue:'冇生效規則',wuu:'无生效规则'};
  return {attack:row[0],defense:row[1],tools:row[2],active:row[3],off:row[4],unknown:row[5],paused:row[6],connecting:row[7],error:row[5],inactive:inactive[key]??inactive.en};
}
