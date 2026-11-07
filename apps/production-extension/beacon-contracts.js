// ADR-030 / REQ-004/005/011: a bounded, identifier-free beacon projection.
export const BEACON_SERVICES = Object.freeze(['google-analytics', 'google-ads', 'meta', 'tiktok', 'yandex', 'linkedin']);
export const BEACON_PROFILES = Object.freeze(['ga4-browser-v1', 'ga4-mp-v1', 'google-ads-browser-v1', 'meta-browser-v1', 'meta-capi-v1', 'tiktok-browser-v1', 'tiktok-events-v1', 'yandex-watch-v1', 'yandex-mp-v1', 'linkedin-image-v1', 'linkedin-capi-v1']);
export const BEACON_EVENTS = Object.freeze(('unknown page_view session_start first_visit user_engagement click scroll file_download form_start form_submit view_search_results video_start video_progress video_complete add_payment_info add_shipping_info add_to_cart add_to_wishlist begin_checkout earn_virtual_currency generate_lead join_group level_end level_start login post_score purchase refund remove_from_cart search select_content select_item select_promotion share sign_up spend_virtual_currency tutorial_begin tutorial_complete unlock_achievement view_cart view_item view_item_list view_promotion PageView AddPaymentInfo AddToCart AddToWishlist CompleteRegistration Contact CustomizeProduct Donate FindLocation InitiateCheckout Lead Purchase Schedule Search StartTrial SubmitApplication Subscribe ViewContent ViewContentBrowse ClickButton Download CompletePayment PlaceAnOrder InitiateOrder AddContact CompleteTutorial pageview event ecommerce conversion').split(' '));
export const BEACON_PRESENCE = Object.freeze(['present', 'absent', 'unknown', 'invalid', 'ambiguous']);
export const BEACON_PARAMETERS = Object.freeze(['event', 'value', 'currency', 'client-id', 'browser-id', 'session-id', 'user-id', 'hashed-email', 'hashed-phone', 'consent', 'conversion-id']);
export const BEACON_HOSTS = Object.freeze(['www.google-analytics.com', 'region1.google-analytics.com', 'analytics.google-analytics.com', 'www.googleadservices.com', 'www.google.com', 'googleads.g.doubleclick.net', 'www.facebook.com', 'graph.facebook.com', 'analytics.tiktok.com', 'business-api.tiktok.com', 'mc.yandex.ru', 'mc.yandex.com', 'mc.yandex.com.tr', 'mc.yandex.kz', 'mc.yandex.by', 'mc.webvisor.org', 'px.ads.linkedin.com', 'api.linkedin.com']);
export const BEACON_CURRENCIES = Object.freeze(('AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VED VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWL').split(' '));
export const BEACON_PROFILE_SERVICES = Object.freeze(Object.fromEntries(BEACON_PROFILES.map(profile => [profile, profile.startsWith('ga4-') ? 'google-analytics' : profile.startsWith('google-ads-') ? 'google-ads' : profile.split('-')[0]])));
const own = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
const array = (value, max) => Array.isArray(value) && value.length <= max && Reflect.ownKeys(value).length === value.length + 1 && Array.from({ length: value.length }, (_, index) => Object.hasOwn(Object.getOwnPropertyDescriptor(value, index) ?? {}, 'value')).every(Boolean);
const document = value => typeof value === 'string' && /^[0-9]+:[0-9]+:[A-Za-z0-9_-]{1,64}$/.test(value) && value.length <= 160;
const host = value => typeof value === 'string' && value.length <= 253 && value.includes('.') && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
export function beaconDecimal(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > 999999999.999999) return null;
    value = Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value !== 'string' || !/^-?(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,6})?$/.test(value)) return null;
  value = value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
  return value === '-0' ? '0' : value;
}
export function readBeaconRequest(value) {
  try {
    const keys = ['schemaVersion', 'type', 'tabId', 'frameId', 'documentKey'];
    if (!exact(value, keys) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'ui-get-beacons' || !Number.isSafeInteger(own(value, 'tabId')) || own(value, 'tabId') < 0 || !Number.isSafeInteger(own(value, 'frameId')) || own(value, 'frameId') < 0 || !document(own(value, 'documentKey')) || !own(value, 'documentKey').startsWith(own(value, 'tabId') + ':' + own(value, 'frameId') + ':')) return null;
    return Object.fromEntries(keys.map(key => [key, own(value, key)]));
  } catch { return null; }
}
export function readBeaconRows(value, max = 64, allowScripts = false) {
  try {
    if (!array(value, max)) return null;
    const keys = ['service', 'profile', 'destinationHost', 'schemaConfidence', 'method', 'requestType', 'events', 'money', 'identifiers', 'consent', 'parameterNames', 'decodeStatus', 'count', 'completedCount', 'failedCount', 'redirectCount', 'statusCodes', 'evidenceSource', 'integrity', 'attributionConfidence', 'initiatorHost', 'script'];
    const identifierKeys = ['clientId', 'browserId', 'sessionId', 'userId', 'hashedEmail', 'hashedPhone'];
    const consentKeys = ['gcs', 'gcd', 'adUserData', 'adPersonalization'];
    const output = [], seen = new Set(); let bytes = 256;
    for (let index = 0; index < value.length; ++index) {
      const row = own(value, index);
      if (!exact(row, keys) || !BEACON_PROFILES.includes(own(row, 'profile')) || own(row, 'service') !== BEACON_PROFILE_SERVICES[own(row, 'profile')] || !BEACON_HOSTS.includes(own(row, 'destinationHost')) || !['documented', 'transport-candidate', 'endpoint-only'].includes(own(row, 'schemaConfidence')) || !['GET', 'POST', 'PUT', 'other', 'unknown'].includes(own(row, 'method')) || !['image', 'xmlhttprequest', 'ping', 'script', 'other'].includes(own(row, 'requestType')) || !['complete', 'partial', 'invalid', 'truncated', 'ambiguous', 'endpoint-only'].includes(own(row, 'decodeStatus')) || !['count', 'completedCount', 'failedCount', 'redirectCount'].every(key => count(own(row, key))) || own(row, 'count') < 1 || own(row, 'completedCount') + own(row, 'failedCount') > own(row, 'count') || own(row, 'redirectCount') > own(row, 'count') || own(row, 'initiatorHost') !== null && !host(own(row, 'initiatorHost'))) return null;
      const source = own(row, 'evidenceSource'), browser = source === 'browser-network';
      const pageCall = allowScripts && source === 'page-hook';
      if (!(browser && own(row, 'integrity') === 'browser-observed' || (source === 'page-dom' || pageCall) && own(row, 'integrity') === 'page-controlled') || !browser && (own(row, 'completedCount') || own(row, 'failedCount') || own(row, 'redirectCount')) || source === 'page-dom' && own(row, 'method') !== 'unknown') return null;
      const script = own(row, 'script'), confidence = own(row, 'attributionConfidence');
      if (pageCall ? !['exact-resource', 'sampled-stack', 'unknown'].includes(confidence) : !['frame-only', 'unknown'].includes(confidence) || script !== null) return null;
      if (pageCall && (script !== null && (!exact(script, ['host', 'pathTemplate']) || !host(own(script, 'host')) || typeof own(script, 'pathTemplate') !== 'string' || !/^\/(?:<script>|(?:main|client|script|sdk|gtm|fbevents|widgets|tracker|analytics)\.(?:js|mjs))$/.test(own(script, 'pathTemplate'))) || (script === null) !== (confidence === 'unknown'))) return null;
      const events = own(row, 'events'), money = own(row, 'money'), identifiers = own(row, 'identifiers'), consent = own(row, 'consent'), parameters = own(row, 'parameterNames'), statuses = own(row, 'statusCodes');
      if (!array(events, 16) || events.some(event => !BEACON_EVENTS.includes(event)) || !array(money, 16) || !exact(identifiers, identifierKeys) || identifierKeys.some(key => !BEACON_PRESENCE.includes(own(identifiers, key))) || !exact(consent, consentKeys) || ['gcs', 'gcd'].some(key => !BEACON_PRESENCE.includes(own(consent, key))) || ['adUserData', 'adPersonalization'].some(key => !['granted', 'denied', 'absent', 'unknown', 'invalid', 'ambiguous'].includes(own(consent, key))) || !array(parameters, BEACON_PARAMETERS.length) || parameters.some(parameter => !BEACON_PARAMETERS.includes(parameter)) || new Set(parameters).size !== parameters.length || !array(statuses, 16) || statuses.some(status => !Number.isSafeInteger(status) || status < 100 || status > 599) || new Set(statuses).size !== statuses.length || !browser && statuses.length) return null;
      const projectedMoney = [];
      for (const item of money) {
        if (!exact(item, ['purpose', 'value', 'currency', 'event']) || !['value', 'goal-value', 'revenue'].includes(own(item, 'purpose')) || beaconDecimal(own(item, 'value')) !== own(item, 'value') || own(item, 'value') === null || own(item, 'currency') !== null && !BEACON_CURRENCIES.includes(own(item, 'currency')) || !BEACON_EVENTS.includes(own(item, 'event'))) return null;
        projectedMoney.push(Object.fromEntries(['purpose', 'value', 'currency', 'event'].map(key => [key, own(item, key)])));
      }
      const projected = { ...Object.fromEntries(keys.map(key => [key, own(row, key)])), events: events.slice(), money: projectedMoney, identifiers: { ...identifiers }, consent: { ...consent }, parameterNames: parameters.slice(), statusCodes: statuses.slice(), script: script ? { host: own(script, 'host'), pathTemplate: own(script, 'pathTemplate') } : null };
      const signature = JSON.stringify({ ...projected, count: 0, completedCount: 0, failedCount: 0, redirectCount: 0, statusCodes: [] });
      if (seen.has(signature)) return null;
      seen.add(signature); bytes += 256 + JSON.stringify(projected).length * 2;
      if (bytes > 65536) return null;
      output.push(projected);
    }
    return output;
  } catch { return null; }
}
export function readBeaconSnapshot(value) {
  try {
    const keys = ['schemaVersion', 'type', 'documentKey', 'coverageState', 'requestCount', 'rows', 'scriptCalls', 'truncated'];
    if (!exact(value, keys) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'beacons-state' || !document(own(value, 'documentKey')) || !['active', 'partial', 'late-start', 'paused', 'unsupported', 'no-access', 'degraded'].includes(own(value, 'coverageState')) || !count(own(value, 'requestCount')) || typeof own(value, 'truncated') !== 'boolean') return null;
    const rows = readBeaconRows(own(value, 'rows')), scriptCalls = readBeaconScriptRows(own(value, 'scriptCalls'));
    if (!rows || !scriptCalls || Math.min(2147483647, rows.reduce((total, row) => total + row.count, 0)) !== own(value, 'requestCount') || ['no-access', 'unsupported', 'paused'].includes(own(value, 'coverageState')) && (rows.length || scriptCalls.length)) return null;
    return { ...Object.fromEntries(keys.map(key => [key, own(value, key)])), rows, scriptCalls };
  } catch { return null; }
}
export function readBeaconTiming(value) {
  try {
    const keys = ['schemaVersion', 'type', 'available', 'rows', 'truncated'];
    if (!exact(value, keys) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'beacon-timing-cache' || typeof own(value, 'available') !== 'boolean' || typeof own(value, 'truncated') !== 'boolean') return null;
    const rows = readBeaconRows(own(value, 'rows'));
    if (!rows || rows.some(row => row.evidenceSource !== 'page-dom') || !own(value, 'available') && rows.length) return null;
    return { ...Object.fromEntries(keys.map(key => [key, own(value, key)])), rows };
  } catch { return null; }
}
export function readBeaconDocuments(value) {
  try {
    if (!array(value, 24)) return null;
    const output = [], seen = new Set(); let rows = 0, bytes = 256;
    for (let index = 0; index < value.length; ++index) {
      const snapshot = readBeaconSnapshot(own(value, index));
      if (!snapshot || seen.has(snapshot.documentKey) || (rows += snapshot.rows.length + snapshot.scriptCalls.length) > 256) return null;
      seen.add(snapshot.documentKey); bytes += 256 + JSON.stringify(snapshot).length * 2;
      if (bytes > 262144) return null;
      output.push(snapshot);
    }
    return output;
  } catch { return null; }
}
export function readBeaconScriptRows(value) {
  const rows = readBeaconRows(value, 32, true);
  return rows && rows.every(row => row.evidenceSource === 'page-hook') && JSON.stringify(rows).length <= 12000 ? rows : null;
}
