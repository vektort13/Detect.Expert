// ADR-109: the texts of the Proxy Manager Geolocation API settings page. Local UI data only. English and Russian are complete; every other
// language falls back to English key by key until its translation is added (a pure data change). Placeholders are {name} words that
// proxyGeoFill replaces; no text carries logic. The product name is a proper name and is the same in every language. Provider facts are
// quoted from the decision record and always say "per the provider's documentation": no accuracy claim, no comparison of providers.

import { PROXY_GEO_SETTINGS_TRANSLATIONS } from './proxy-geo-settings-i18n.js';

// The 21 language ids of the product (scripts/production-languages.mjs); a test keeps this list equal to it.
export const PROXY_GEO_SETTINGS_LOCALES = Object.freeze(['ru', 'en', 'zh_CN', 'vi', 'es', 'ar', 'uk', 'fr', 'pt_BR', 'hi', 'ur', 'ja', 'de', 'pl', 'id', 'mr', 'te', 'ko', 'ta', 'yue', 'wuu']);

const EN = {
  title: 'Proxy Manager Geolocation API',
  eyebrow: 'Integrations',
  subtitle: 'Shows the country, city, network and flags of the exit IP of your proxies in the Proxy manager. It is off by default: nothing is sent until you turn it on and add a key.',
  entry_subtitle: 'Country, city and network of your proxies’ exit IP',
  back: 'Extension settings',
  language: 'Language',

  master_title: 'Look up where exit IPs are located',
  state_loading: 'Loading…',
  state_off: 'Off',
  state_ready: 'On — ready: {list}',
  state_no_key: 'On — no key',
  hint_off: 'While this is off nothing is sent. You can prepare keys below in advance.',
  hint_no_key: 'Turn on a provider and save its key. Until then nothing is sent.',
  hint_ready: 'Data is requested only for the IP found by a manual proxy check, by a lookup button in a profile’s details and by Test key below.',
  option_auto: 'Look up right after a manual proxy check',
  option_auto_help: 'When a manual check finishes, the exit IP goes to the providers you turned on. There are no timers and no background requests.',
  option_failover: 'If a provider fails, try the next one',
  option_failover_help: 'The same IP then goes to the next enabled provider that has a key, at most three attempts per address, so one more provider learns about it.',
  option_remember: 'Remember keys on this computer',
  option_remember_help: 'Keys are then stored unencrypted in the browser profile. Otherwise they live only until the browser is closed. Keys never go into exports, reports, logs or sync.',

  sent_title: 'What is sent to providers',
  sent_ip: 'The public exit IP of a proxy you checked by hand. Private and reserved addresses are never sent.',
  sent_key: 'Your key (for MaxMind, the account ID and the license key).',
  sent_usual: 'As with any request: your own IP address (or the exit address of the browser’s active route) and the usual browser headers.',
  sent_never: 'Nothing else: no page addresses, no cookies, no proxy host or port, no proxy login or password, no labels or notes.',
  sent_learn: 'A provider may learn over time which proxies you use.',
  sent_claim: 'The data is approximate and is the provider’s own claim. The extension draws no conclusion about a proxy from it.',

  providers_title: 'Providers',
  providers_help: 'Providers are tried from top to bottom. Turn on the ones you want and paste a key.',
  docs: 'Documentation',
  docs_aria: '{name} documentation (opens in a new tab)',
  use: 'Use',
  recommended: 'Recommended',
  fact_maxmind: 'GeoLite City works with a free MaxMind account and has a daily request limit. GeoIP City Plus and GeoIP Insights are paid and use the account balance. Per the provider’s documentation.',
  fact_ipgeolocation: 'The free plan gives 1,000 credits per day. A request costs 1 credit; security data costs 2 more and needs a paid plan. Per the provider’s documentation.',
  fact_ipdata: 'The daily quota depends on the plan. The free plan covers location, ASN and time zone; other data depends on the plan. Per the provider’s documentation.',
  fact_ipapi: 'The free endpoint allows 45 requests per minute, works only over HTTP and is for non-commercial use. A Pro key switches to the HTTPS Pro address. Per the provider’s documentation.',
  field_accountId: 'Account ID',
  field_licenseKey: 'License key',
  field_apiKey: 'API key',
  field_apiKey_optional: 'Pro key (optional)',
  reveal_show: 'Show key',
  reveal_hide: 'Hide key',
  key_saved: 'Key saved',
  key_none: 'No key',
  save: 'Save',
  forget: 'Remove key',
  test: 'Test key',
  test_help: 'The test asks the provider about the well-known public address {ip}, not about your data. A key you typed but did not save is saved before the test.',
  opt_service: 'Service',
  service_geolite_city: 'GeoLite City — free account',
  service_geoip_city: 'GeoIP City Plus — paid',
  service_geoip_insights: 'GeoIP Insights — paid',
  opt_security: 'Request security data (paid plans; costs extra credits)',
  opt_http: 'Allow the free ip-api.com endpoint — it works only over HTTP, without encryption',
  opt_http_help: 'Without a key the request goes over plain HTTP. With a key the HTTPS Pro address is used and this box is not needed.',
  status_idle_off: 'Off',
  status_idle_ready: 'Ready, no requests yet',
  status_ok: 'Last answer received: {time}',
  status_error: 'Last error: {error}',
  status_remaining: 'Left per the provider: {n}',
  status_paused: 'Paused until {time}',
  result_saved: 'Key saved.',
  result_saved_off: 'Key saved. This provider is off: turn it on to use it.',
  result_forgot: 'Key removed.',
  invalid_key: 'Check the key: it must be 8 to 256 printable ASCII characters without spaces.',
  invalid_maxmind: 'Check the account ID (digits only, up to 12) and the license key (8 to 256 printable ASCII characters without spaces).',
  test_running: 'Testing…',
  test_ok: 'The provider answered about {ip}: {summary}',
  test_ok_empty: 'The provider answered about {ip} but returned no location fields.',

  data_title: 'Data on this computer',
  data_help: 'The cache keeps up to 200 recent answers (proxy IP, country, city, network) for at most 30 days. It is not part of any export.',
  clear_cache: 'Clear cached results ({n})',
  clear_cache_armed: 'Press again to clear cached results ({n})',
  forget_all: 'Remove all keys',
  forget_all_armed: 'Press again to remove all keys',
  confirm_hint: 'Press the button again to confirm, or press Escape or Cancel.',
  cancel: 'Cancel',
  done_cache: 'Cached results cleared.',
  done_forget_all: 'All keys removed.',

  error_disabled: 'The feature is turned off.',
  error_no_provider: 'No provider is ready. Turn one on and save its key.',
  error_not_public: 'This is not a public IP address, so nothing was sent.',
  error_no_key: 'This provider needs a key. Enter it and press Save.',
  error_http_not_allowed: 'The free ip-api.com endpoint works only over unencrypted HTTP. Allow it in the ip-api.com section or add a Pro key.',
  error_unauthorized: 'The provider rejected the key. Check the key (for MaxMind, the account ID too).',
  error_forbidden: 'The provider refused access with this key (key restrictions, an allow-list or a missing permission).',
  error_plan: 'The key’s plan does not include a requested feature. Turn off security data or change the plan.',
  error_quota: 'The quota or credits of this key are used up.',
  error_rate_limited: 'Too many requests. Try again later.',
  error_not_found: 'The provider has no data for this address.',
  error_timeout: 'The provider did not answer in time.',
  error_network: 'No connection to the provider. Check the network and the browser’s route.',
  error_server: 'The provider’s server returned an error. Try again later.',
  error_bad_response: 'The answer could not be understood: it is not JSON, too large or of an unexpected shape.',
  error_unknown: 'The operation failed.',
  err_load: 'Could not load the settings.',
  err_save: 'Could not save the change.',
};

const RU = {
  title: 'Proxy Manager Geolocation API',
  eyebrow: 'Интеграции',
  subtitle: 'Показывает страну, город, сеть и признаки выходного IP ваших прокси в менеджере прокси. По умолчанию выключено: пока вы не включите функцию и не добавите ключ, ничего не отправляется.',
  entry_subtitle: 'Страна, город и сеть выходного IP ваших прокси',
  back: 'Настройки расширения',
  language: 'Язык',

  master_title: 'Определять, где находятся выходные IP',
  state_loading: 'Загрузка…',
  state_off: 'Выключено',
  state_ready: 'Включено — готов: {list}',
  state_no_key: 'Включено — нет ключа',
  hint_off: 'Пока выключено, ничего не отправляется. Ключи можно подготовить заранее ниже.',
  hint_no_key: 'Включите провайдера и сохраните его ключ. До этого ничего не отправляется.',
  hint_ready: 'Данные запрашиваются только для IP, найденного ручной проверкой прокси, по кнопке определения в деталях профиля и по кнопке «Проверить ключ» ниже.',
  option_auto: 'Определять сразу после ручной проверки прокси',
  option_auto_help: 'Когда ручная проверка завершена, выходной IP отправляется включённым провайдерам. Таймеров и фоновых запросов нет.',
  option_failover: 'Если провайдер не ответил — пробовать следующего',
  option_failover_help: 'Тот же IP отправится следующему включённому провайдеру с ключом, не более трёх попыток на адрес: о нём узнает ещё один провайдер.',
  option_remember: 'Запомнить ключи на этом компьютере',
  option_remember_help: 'Тогда ключи хранятся в профиле браузера без шифрования. Иначе они живут только до закрытия браузера. Ключи никогда не попадают в экспорт, отчёты, журналы и синхронизацию.',

  sent_title: 'Что отправляется провайдерам',
  sent_ip: 'Публичный выходной IP прокси, который вы проверили вручную. Частные и служебные адреса не отправляются вообще.',
  sent_key: 'Ваш ключ (для MaxMind — номер аккаунта и лицензионный ключ).',
  sent_usual: 'Как при любом запросе: ваш собственный IP-адрес (или выходной адрес активного маршрута браузера) и обычные заголовки браузера.',
  sent_never: 'Больше ничего: ни адресов посещённых страниц, ни cookie, ни адреса и порта прокси, ни логина и пароля прокси, ни ваших меток и заметок.',
  sent_learn: 'Провайдер может со временем узнать, какие прокси вы используете.',
  sent_claim: 'Данные приблизительны и остаются утверждением самого провайдера. Расширение не делает по ним выводов о прокси.',

  providers_title: 'Провайдеры',
  providers_help: 'Провайдеры опрашиваются сверху вниз. Включите нужных и вставьте ключ.',
  docs: 'Документация',
  docs_aria: 'Документация {name} (откроется в новой вкладке)',
  use: 'Использовать',
  recommended: 'Рекомендуем',
  fact_maxmind: 'GeoLite City работает с бесплатным аккаунтом MaxMind и имеет суточный лимит запросов. GeoIP City Plus и GeoIP Insights платные и расходуют баланс аккаунта. По документации провайдера.',
  fact_ipgeolocation: 'Бесплатный тариф даёт 1 000 кредитов в сутки. Запрос стоит 1 кредит; данные безопасности стоят ещё 2 и доступны на платных тарифах. По документации провайдера.',
  fact_ipdata: 'Суточная квота зависит от тарифа. Бесплатный тариф даёт геолокацию, ASN и часовой пояс; остальные данные зависят от тарифа. По документации провайдера.',
  fact_ipapi: 'Бесплатная точка: 45 запросов в минуту, только HTTP, только для некоммерческого использования. Ключ Pro переключает на адрес Pro по HTTPS. По документации провайдера.',
  field_accountId: 'Номер аккаунта',
  field_licenseKey: 'Лицензионный ключ',
  field_apiKey: 'Ключ API',
  field_apiKey_optional: 'Ключ Pro (необязательно)',
  reveal_show: 'Показать ключ',
  reveal_hide: 'Скрыть ключ',
  key_saved: 'Ключ сохранён',
  key_none: 'Ключ не задан',
  save: 'Сохранить',
  forget: 'Удалить ключ',
  test: 'Проверить ключ',
  test_help: 'Проверка запрашивает у провайдера общеизвестный публичный адрес {ip}, а не ваши данные. Ключ, который вы ввели, но не сохранили, будет сохранён перед проверкой.',
  opt_service: 'Сервис',
  service_geolite_city: 'GeoLite City — бесплатный аккаунт',
  service_geoip_city: 'GeoIP City Plus — платный',
  service_geoip_insights: 'GeoIP Insights — платный',
  opt_security: 'Запрашивать данные безопасности (платные тарифы; стоит дополнительные кредиты)',
  opt_http: 'Разрешить бесплатную точку ip-api.com — она работает только по HTTP, без шифрования',
  opt_http_help: 'Без ключа запрос уходит по обычному HTTP. С ключом используется адрес Pro по HTTPS, и эта галочка не нужна.',
  status_idle_off: 'Выключен',
  status_idle_ready: 'Готов, запросов ещё не было',
  status_ok: 'Последний ответ получен: {time}',
  status_error: 'Последняя ошибка: {error}',
  status_remaining: 'Осталось по данным провайдера: {n}',
  status_paused: 'Пауза до {time}',
  result_saved: 'Ключ сохранён.',
  result_saved_off: 'Ключ сохранён. Провайдер выключен — включите его, чтобы использовать.',
  result_forgot: 'Ключ удалён.',
  invalid_key: 'Проверьте ключ: нужно от 8 до 256 печатных символов ASCII без пробелов.',
  invalid_maxmind: 'Проверьте номер аккаунта (только цифры, до 12) и лицензионный ключ (от 8 до 256 печатных символов ASCII без пробелов).',
  test_running: 'Проверяю…',
  test_ok: 'Провайдер ответил по {ip}: {summary}',
  test_ok_empty: 'Провайдер ответил по {ip}, но не вернул полей местоположения.',

  data_title: 'Данные на этом компьютере',
  data_help: 'Кэш хранит до 200 последних ответов (IP прокси, страна, город, сеть) не дольше 30 суток. В экспорт он не входит.',
  clear_cache: 'Очистить кэш результатов ({n})',
  clear_cache_armed: 'Нажмите ещё раз, чтобы очистить кэш ({n})',
  forget_all: 'Удалить все ключи',
  forget_all_armed: 'Нажмите ещё раз, чтобы удалить все ключи',
  confirm_hint: 'Нажмите кнопку ещё раз для подтверждения либо нажмите Escape или «Отмена».',
  cancel: 'Отмена',
  done_cache: 'Кэш результатов очищен.',
  done_forget_all: 'Все ключи удалены.',

  error_disabled: 'Функция выключена.',
  error_no_provider: 'Нет готового провайдера. Включите одного и сохраните его ключ.',
  error_not_public: 'Это не публичный IP-адрес, поэтому ничего не отправлено.',
  error_no_key: 'Этому провайдеру нужен ключ. Введите его и нажмите «Сохранить».',
  error_http_not_allowed: 'Бесплатная точка ip-api.com работает только по незашифрованному HTTP. Разрешите её в разделе ip-api.com или укажите ключ Pro.',
  error_unauthorized: 'Провайдер отклонил ключ. Проверьте ключ (для MaxMind — и номер аккаунта).',
  error_forbidden: 'Провайдер отказал в доступе с этим ключом (ограничения ключа, список разрешённых адресов или нет прав).',
  error_plan: 'Тариф ключа не включает запрошенную возможность. Отключите данные безопасности или смените тариф.',
  error_quota: 'Квота или кредиты этого ключа исчерпаны.',
  error_rate_limited: 'Слишком много запросов. Повторите позже.',
  error_not_found: 'У провайдера нет данных об этом адресе.',
  error_timeout: 'Провайдер не ответил вовремя.',
  error_network: 'Нет связи с провайдером. Проверьте сеть и маршрут браузера.',
  error_server: 'Сервер провайдера вернул ошибку. Повторите позже.',
  error_bad_response: 'Ответ не удалось разобрать: это не JSON, он слишком большой или неожиданной формы.',
  error_unknown: 'Операция не выполнена.',
  err_load: 'Не удалось загрузить настройки.',
  err_save: 'Не удалось сохранить изменение.',
};

/** The raw tables, one frozen flat table per translated language (the other languages are not here yet). */
export const PROXY_GEO_SETTINGS_MESSAGES = Object.freeze({ en: Object.freeze(EN), ru: Object.freeze(RU), ...Object.fromEntries(Object.entries(PROXY_GEO_SETTINGS_TRANSLATIONS).map(([id, table]) => [id, Object.freeze(table)])) });

/** A supported language id for a locale value: an exact id, a variant of one (pt-PT, zh-TW) or English. */
export function proxyGeoSettingsLocale(value) {
  if (PROXY_GEO_SETTINGS_LOCALES.includes(value)) return value;
  const base = typeof value === 'string' ? value.toLowerCase().replaceAll('_', '-').split('-')[0] : '';
  return base === 'zh' || base === 'cmn' ? 'zh_CN' : base === 'pt' ? 'pt_BR' : PROXY_GEO_SETTINGS_LOCALES.includes(base) ? base : 'en';
}

const merged = new Map();
/** The labels of one language, complete: a language without its own table (or a key missing from it) shows the English text. */
export function proxyGeoSettingsLabels(locale) {
  const id = proxyGeoSettingsLocale(locale);
  if (id === 'en' || !Object.hasOwn(PROXY_GEO_SETTINGS_MESSAGES, id)) return PROXY_GEO_SETTINGS_MESSAGES.en;
  if (!merged.has(id)) merged.set(id, Object.freeze({ ...PROXY_GEO_SETTINGS_MESSAGES.en, ...PROXY_GEO_SETTINGS_MESSAGES[id] }));
  return merged.get(id);
}

/** A template with its {name} placeholders replaced. An unknown placeholder stays visible; a value is never read as a replacement pattern. */
export function proxyGeoFill(template, values) {
  if (typeof template !== 'string') return '';
  if (values === null || typeof values !== 'object') return template;
  return template.replace(/\{([A-Za-z]+)\}/g, (match, name) => (Object.hasOwn(values, name) ? String(values[name]) : match));
}
