// REQ-008 / ADR-009/019: public integration evidence, not a runtime rule pack.
// Hosts below come from vendor/integrator documentation; no infrastructure discovery.
export const accessedAt = '2026-10-10';
export const reviewDueAt = '2027-01-10';
export const sourceGroups = [
  { vendorId: 'datadome', url: 'https://docs.datadome.co/docs/javascript-tag', title: 'DataDome JavaScript Tag: CSP and first-party setup', rows: [
    ['ct.captcha-delivery.com', 'challenge-script', null, ['script']],
    ['api-js.datadome.co', 'browser-collector', '/js/', ['xmlhttprequest', 'ping']],
    ['*.captcha-delivery.com', 'challenge-frame', null, ['sub_frame']],
  ] },
  { vendorId: 'datadome', url: 'https://docs.datadome.co/changelog/last-call-on-required-change-for-users-of-csp-directive-frame-src', title: 'DataDome frame-src migration, April 2026', rows: [
    ['geo.captcha-delivery.com', 'challenge-frame', null, ['sub_frame'], { lifecycle: 'legacy', note: 'Прежний точный адрес; с мая 2026 документация требует namespace *.captcha-delivery.com.' }],
  ] },
  { vendorId: 'google-recaptcha', url: 'https://developers.google.com/recaptcha/docs/faq', title: 'reCAPTCHA FAQ: Content Security Policy', rows: [
    ['www.gstatic.com', 'cdn-assets', '/recaptcha/', ['script'], { pathMatch: 'prefix', sharedHost: true }],
    ['recaptcha.google.com', 'challenge-frame', '/recaptcha/', ['sub_frame'], { pathMatch: 'prefix' }],
    ['www.google.com', 'challenge-frame', '/recaptcha/', ['sub_frame'], { pathMatch: 'prefix', sharedHost: true }],
    ['www.google.com', 'browser-collector', '/recaptcha/', ['xmlhttprequest'], { pathMatch: 'prefix', sharedHost: true }],
  ] },
  { vendorId: 'hcaptcha', url: 'https://docs.hcaptcha.com/', title: 'hCaptcha Developer Guide: CSP', rows: [
    ['newassets.hcaptcha.com', 'cdn-assets', null, ['script', 'sub_frame'], { note: 'Официальный пример имени asset-хоста; адреса меняются по региону и времени.' }],
    ['*.hcaptcha.com', 'published-namespace', null, ['script', 'sub_frame', 'xmlhttprequest'], { note: 'CSP namespace включает также обычные сайты производителя; нужен путь или второй признак.' }],
  ] },
  { vendorId: 'arkose', url: 'https://developer.arkoselabs.com/docs/domain-policy', title: 'Arkose Domain Policy: client and server domains', rows: [
    ['cdn.arkoselabs.com', 'cdn-assets', null, ['script', 'sub_frame', 'image']],
  ] },
  { vendorId: 'arkose', url: 'https://developer.arkoselabs.com/docs/standard-setup', title: 'Arkose Standard Setup: company API script path', rows: [
    ['{company}-api.arkoselabs.com', 'loader', '/v2/{public-key}/api.js', ['script'], { pathMatch: 'template' }],
  ] },
  { vendorId: 'human', url: 'https://docs.humansecurity.com/applications/sensor', title: 'HUMAN Sensor: CSP requirements', rows: [
    ['*.px-cloud.net', 'published-namespace', null, ['script', 'sub_frame', 'xmlhttprequest']],
    ['*.px-cdn.net', 'published-namespace', null, ['script', 'xmlhttprequest']],
    ['*.pxchk.net', 'published-namespace', null, ['xmlhttprequest']],
    ['*.px-client.net', 'published-namespace', null, ['xmlhttprequest']],
  ] },
  { vendorId: 'maxmind-minfraud', url: 'https://dev.maxmind.com/minfraud/track-devices/web/', title: 'MaxMind Web Device Tracking: CSP', rows: [
    ['d-ipv4.mmapiws.com', 'browser-collector', null, ['xmlhttprequest']],
    ['d-ipv6.mmapiws.com', 'browser-collector', null, ['xmlhttprequest']],
  ] },
  { vendorId: 'kount', url: 'https://github.com/Kount/kount-ris-java-sdk/wiki/Kount-Data-Collector', title: 'Kount Data Collector integration', rows: [
    ['tst.kaptcha.com', 'loader', '/collect/sdk', ['script'], { environment: 'test' }],
  ] },
  { vendorId: 'kount', url: 'https://developer.kount.com/hc/en-us/articles/14564335823764-Content-Security-Policies-CSP-and-the-Device-Data-Collector', title: 'Kount Device Data Collector CSP', rows: [
    ['*.kaptcha.com', 'published-namespace', null, ['script', 'sub_frame', 'xmlhttprequest']],
  ] },
  { vendorId: 'kount', url: 'https://support.kount.com/hc/en-us/articles/360045318632-FAQ-Can-You-Collect-Device-Data-from-Devices-Within-Our-Private-Network', title: 'Kount public data-collection domain families', rows: [
    ['kaxsdc.com', 'domain-family', null, [], { note: 'Документация называет доменное семейство; конкретный browser hostname и путь не опубликованы.' }],
    ['kount.net', 'domain-family', null, [], { note: 'Документация называет доменное семейство; конкретный browser hostname и путь не опубликованы.' }],
  ] },
  { vendorId: 'seon', url: 'https://docs.seon.io/api-reference/deprecated-versions', title: 'SEON deprecated JavaScript Agent versions', accessedAt: '2026-10-09', recheckStatus: 'unavailable-2026-10-10', rows: [
    ['cdn.getdeviceinf.com', 'loader', '/js/v4/agent.js', ['script'], { lifecycle: 'legacy' }],
    ['cdn.seondf.com', 'loader', '/js/v4/agent.js', ['script'], { lifecycle: 'legacy' }],
  ] },
  { vendorId: 'seon', url: 'https://docs.seon.io/api-reference/fraud-api', title: 'SEON JavaScript Agent v6: resolver domains', rows: [
    ['*.seondnsresolve.com', 'resolver-namespace', null, ['xmlhttprequest']],
    ['*.deviceinfresolver.com', 'resolver-namespace', null, ['xmlhttprequest']],
    ['*.seonintelligenceresolver.com', 'resolver-namespace', null, ['xmlhttprequest']],
  ] },
  { vendorId: 'seon', url: 'https://docs.seon.io/knowledge-base/shopify-2026/custom-headless-storefronts-and-device-intelligence-setup', title: 'SEON headless storefront: development SDK', rows: [
    ['cdn.seon.io', 'loader', '/js/v6/agent.dev.umd.js', ['script'], { environment: 'development' }],
  ] },
  { vendorId: 'socure', url: 'https://help.socure.com/riskos/docs/digital-intelligence-web-sdk', title: 'Socure Digital Intelligence Web SDK: CSP', rows: [
    ['ingestion.dv.socure.io', 'browser-collector', null, ['xmlhttprequest', 'ping']],
    ['analytics.dv.socure.io', 'browser-collector', null, ['xmlhttprequest', 'ping']],
    ['network.dv.socure.io', 'browser-collector', null, ['xmlhttprequest']],
  ] },
  { vendorId: 'paypal-fraudnet', url: 'https://developer.paypal.com/platforms/checkout/apm/pay-upon-invoice/fraudnet/', title: 'PayPal FraudNet: CSP tags', rows: [
    ['b.stats.paypal.com', 'browser-pixel', null, ['image']],
    ['c.paypal.com', 'browser-pixel', null, ['image'], { sharedHost: true, note: 'CSP разрешает хост; для нового pixel-правила нужно установить точный путь FraudNet.' }],
    ['c.paypal.com', 'challenge-frame', null, ['sub_frame'], { sharedHost: true, note: 'Для отдельного iframe-правила нужно установить путь FraudNet.' }],
  ] },
  { vendorId: 'geetest', url: 'https://docs.geetest.com/BehaviorVerification/BusinessDisasterRecovery', title: 'GeeTest CAPTCHA v4: primary and backup domains', rows: [
    ['static.geevisit.com', 'cdn-assets', null, ['script', 'image']],
    ['gcaptcha4.geetest.com', 'challenge-service', null, ['script', 'xmlhttprequest'], { note: 'Хост используется в CAPTCHA-процессе; browser path нужно отделить от server-side validate.' }],
    ['gcaptcha4.geevisit.com', 'challenge-service', null, ['script', 'xmlhttprequest'], { note: 'Резервный CAPTCHA-хост; browser path нужно отделить от server-side validate.' }],
    ['gcaptcha4.gsensebot.com', 'challenge-service', null, ['script', 'xmlhttprequest'], { note: 'Резервный CAPTCHA-хост; browser path нужно отделить от server-side validate.' }],
  ] },
  { vendorId: 'geetest', url: 'https://docs.geetest.com/gt4/bypass', title: 'GeeTest CAPTCHA v4: additional resource allowlist', rows: [
    ['dn-staticdown.qbox.me', 'cdn-assets', null, ['script', 'image'], { note: 'Точный опубликованный ресурсный hostname; остальные qbox.me не относятся к этому признаку.' }],
  ] },
  { vendorId: 'clearsale', url: 'https://api.clearsale.com.br/docs/behavior-analytics/sdk/browser', title: 'ClearSale SDK: script-block monitoring', rows: [
    ['web.fpcs-monitor.com.br', 'browser-pixel', '/p/fp.png', ['xmlhttprequest']],
    ['device.clearsale.com.br', 'browser-pixel', '/p/fp.png', ['image', 'xmlhttprequest']],
  ] },
  { vendorId: 'clearsale', url: 'https://api.clearsale.com.br/docs/behavior-analytics/api/device-check/modules/biometrics', title: 'ClearSale behavioral biometrics browser module', rows: [
    ['device.clearsale.com.br', 'loader', '/b/bio.js', ['script']],
  ] },
  { vendorId: 'alibaba-captcha', url: 'https://www.alibabacloud.com/help/en/captcha/captcha2-0/user-guide/captcha-2-0-client-access-faq', title: 'Alibaba Cloud Captcha 2.0 client integration FAQ: resource and interface domains', rows: [
    ...['g.alicdn.com', 'x.alicdn.com'].map(host => [host, 'cdn-assets', null, ['script', 'image'], { sharedHost: true, note: 'Общий CDN Alibaba: нужен отдельный CAPTCHA path; host-only правило недопустимо.' }]),
    ...['static-captcha.aliyuncs.com', 'static-captcha-sgp.aliyuncs.com'].map(host => [host, 'cdn-assets', null, ['script', 'image']]),
    ...['cloudauth-device.aliyuncs.com', 'cn-shanghai.device.saf.aliyuncs.com', 'cloudauth-device.ap-southeast-1.aliyuncs.com', 'ap-southeast-1.device.saf.aliyuncs.com', 'ap-southeast-1-ga.device.saf.aliyuncs.com', 'cloudauth-device-dualstack.cn-shanghai.aliyuncs.com', 'cloudauth-device-dualstack.ap-southeast-1.aliyuncs.com'].map(host => [host, 'browser-collector', null, ['xmlhttprequest'], { productRelation: 'documented-captcha-use', note: 'FAQ подтверждает использование в CAPTCHA, но не эксклюзивность этого hostname. Для атрибуции нужен её loader/path.' }]),
    ...['upload.captcha-open.aliyuncs.com', 'upload.captcha-open-b.aliyuncs.com', 'upload.captcha-open-southeast.aliyuncs.com', 'upload.captcha-open-southeast-b.aliyuncs.com', 'upload.captcha-open-ga-web.aliyuncs.com', 'upload.captcha-open-ga-web-b.aliyuncs.com'].map(host => [host, 'browser-collector', null, ['xmlhttprequest']]),
    ...['captcha-open.aliyuncs.com', 'captcha-open-b.aliyuncs.com', 'captcha-open-southeast.aliyuncs.com', 'captcha-open-southeast-b.aliyuncs.com', 'captcha-open-dual.aliyuncs.com', 'captcha-open-dual-b.aliyuncs.com', 'captcha-open-southeast-dual.aliyuncs.com', 'captcha-open-southeast-dual-b.aliyuncs.com', 'captcha-open-ga-web.aliyuncs.com', 'captcha-open-ga-web-b.aliyuncs.com'].map(host => ['{customer}.' + host, 'challenge-service', null, ['xmlhttprequest'], { note: 'Опубликованный шаблон клиентского API. Имена клиентов не собирались.' }]),
  ] },
  { vendorId: 'tencent-captcha', url: 'https://cloud.tencent.com/document/product/1110/104536', title: 'Tencent CAPTCHA completed CDN migration: previous URLs retired 2023-08-21', rows: [
    ...['ssl.captcha.qq.com', 't.captcha.qq.com', 't.captcha.qcloud.com', 'captcha.gtimg.com', 'captcha.myqcloud.com', 'captcha.cloudcachetci.com'].map(host => [host, 'loader', '/TCaptcha.js', ['script'], { lifecycle: 'retired', retiredAt: '2023-08-21', note: 'Производитель официально прекратил использование. Сохранён только для разбора старых отчётов.' }]),
  ] },
  { vendorId: 'trustdecision', url: 'https://en-doc.trustdecision.com/reference/fp-web', title: 'TrustDecision Fingerprint Web SDK: CSP', rows: [
    ['*.apitd.net', 'published-namespace', null, ['xmlhttprequest'], { productRelation: 'related-product', note: 'Fingerprint SDK того же производителя; текущая карточка runtime — Behavior Analytics.' }],
  ] },
  { vendorId: 'fingerprintjs', url: 'https://github.com/fingerprintjs/fingerprintjs/blob/master/docs/api.md', title: 'FingerprintJS OSS API: ES module CDN URL', rows: [
    ['openfpcdn.io', 'loader', '/fingerprintjs/v5/esm.min.js', ['script']],
  ] },
  { vendorId: 'friendly-captcha', url: 'https://developer.friendlycaptcha.com/docs/v2/guides/csp', title: 'Friendly Captcha v2: frame-src', rows: [
    ['*.frcapi.com', 'challenge-frame', null, ['sub_frame'], { note: 'Опубликованный CAPTCHA frame namespace; Risk Intelligence — отдельный продукт.' }],
  ] },
];

export const exclusions = [
  { value: '*.cloudfront.net', reason: 'Общий CDN Amazon; пригодны только документированные distributions конкретного поставщика.' },
  { value: '*.alicdn.com', reason: 'Общий CDN Alibaba; требуется конкретный CAPTCHA path или выделенный ресурсный hostname.' },
  { value: 'cdn.jsdelivr.net', reason: 'Host-only совпадение не отличает Friendly Captcha от других npm-пакетов.' },
  { value: '*.arkoselabs.com', reason: 'Общий суффикс включает corporate, documentation и server-side verification; используем отдельные client endpoints.' },
  { value: '{company}-verify.arkoselabs.com', reason: 'Server-side verification; не browser CDN.', sourceUrl: 'https://developer.arkoselabs.com/docs/domain-policy' },
  { value: 'api.fpjs.io / eu.api.fpjs.io / ap.api.fpjs.io', reason: 'Опубликованы также как Server API/proxy upstream; для browser resource matcher требуется отдельная квалификация пути.', sourceUrl: 'https://github.com/fingerprintjs/fastly-compute-proxy' },
  { value: 'Shodan hostname total', reason: 'Число записей в индексе не подтверждает владельца CDN, browser path или использование антифрода на посещённой странице.', sourceUrl: 'https://developer.shodan.io/api' },
];
