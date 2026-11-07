# CDN и браузерные ресурсы антифрод-систем

Дата: 2026-10-10. Область: **32 продукта, которые расширение уже распознаёт**.

В базе 152 записей: 74 ресурсных записей из 61 действующих правил и 78 новых кандидатов. Всего 104 уникальных точных hostname. Добавлено 45 ранее не покрытых точных hostname, из них 36 отмечены как текущие, остальные относятся к legacy/retired. Дополнительно 23 опубликованных namespace/template, 2 доменных семейства без конкретного browser hostname и 25 первичных источников.

Новые записи собраны для следующего расширения детектора. Они не активируют правила в Chrome/Firefox. Существующие правила перечислены как `already-present`; новые — `candidate`. Для включения кандидата нужны конкретные условия browser resource match и положительные/отрицательные fixtures. Данные Shodan не меняют статус правила.

- [Полная база JSON](../../data/antifraud-cdn.v1.json)
- [Таблица всех адресов CSV](../../data/antifraud-cdn.csv)
- [Новые источники и записи](../../../../scripts/research/antifraud-cdn-sources.mjs)
- [План Shodan](shodan-plan.json)
- [Фактический результат Shodan](shodan-counts.json)

## Продукты и дополнительные адреса

| Система | Действующих правил | Новых записей | Новые точные hostname |
|---|---:|---:|---|
| Adyen Risk Data Collection | 2 | 0 | — |
| Alibaba Cloud CAPTCHA | 1 | 27 | `ap-southeast-1-ga.device.saf.aliyuncs.com`, `ap-southeast-1.device.saf.aliyuncs.com`, `cloudauth-device-dualstack.ap-southeast-1.aliyuncs.com`, `cloudauth-device-dualstack.cn-shanghai.aliyuncs.com`, `cloudauth-device.aliyuncs.com`, `cloudauth-device.ap-southeast-1.aliyuncs.com`, `cn-shanghai.device.saf.aliyuncs.com`, `g.alicdn.com`, `static-captcha-sgp.aliyuncs.com`, `static-captcha.aliyuncs.com`, `upload.captcha-open-b.aliyuncs.com`, `upload.captcha-open-ga-web-b.aliyuncs.com`, `upload.captcha-open-ga-web.aliyuncs.com`, `upload.captcha-open-southeast-b.aliyuncs.com`, `upload.captcha-open-southeast.aliyuncs.com`, `upload.captcha-open.aliyuncs.com`, `x.alicdn.com` |
| Arkose Labs | 1 | 2 | `cdn.arkoselabs.com` |
| Baidu Cloud WAF challenge components | 2 | 0 | — |
| ClearSale Behavior Analytics | 1 | 3 | `web.fpcs-monitor.com.br` |
| Cloudflare Turnstile | 1 | 0 | — |
| Cybersource Device Fingerprint | 2 | 0 | — |
| DataDome | 1 | 4 | `api-js.datadome.co`, `ct.captcha-delivery.com`, `geo.captcha-delivery.com` (legacy) |
| Fingerprint (FingerprintJS Pro) | 4 | 0 | — |
| FingerprintJS | 2 | 1 | — |
| Forter | 4 | 0 | — |
| FraudLabs Pro | 1 | 0 | — |
| Friendly Captcha | 4 | 1 | — |
| GeeTest CAPTCHA | 2 | 5 | `dn-staticdown.qbox.me`, `gcaptcha4.geetest.com`, `gcaptcha4.geevisit.com`, `gcaptcha4.gsensebot.com`, `static.geevisit.com` |
| Google reCAPTCHA | 4 | 4 | `recaptcha.google.com`, `www.gstatic.com` |
| HUMAN / PerimeterX | 2 | 4 | — |
| Kount | 1 | 4 | `tst.kaptcha.com` |
| LexisNexis ThreatMetrix | 2 | 0 | — |
| MTCaptcha | 2 | 0 | — |
| MaxMind minFraud | 2 | 2 | `d-ipv4.mmapiws.com`, `d-ipv6.mmapiws.com` |
| NetEase Yidun CAPTCHA | 4 | 0 | — |
| PayPal FraudNet | 1 | 3 | `b.stats.paypal.com` |
| SEON | 4 | 6 | `cdn.getdeviceinf.com` (legacy), `cdn.seondf.com` (legacy) |
| Sift | 1 | 0 | — |
| Signifyd | 1 | 0 | — |
| Socure Digital Intelligence | 1 | 3 | `analytics.dv.socure.io`, `ingestion.dv.socure.io`, `network.dv.socure.io` |
| Sumsub WebSDK | 1 | 0 | — |
| Tencent Cloud CAPTCHA | 3 | 6 | `captcha.cloudcachetci.com` (retired), `captcha.gtimg.com` (retired), `captcha.myqcloud.com` (retired), `ssl.captcha.qq.com` (retired), `t.captcha.qcloud.com` (retired), `t.captcha.qq.com` (retired) |
| TrustDecision Behavior SDK | 1 | 1 | — |
| Yandex SmartCaptcha | 1 | 0 | — |
| hCaptcha | 1 | 2 | `newassets.hcaptcha.com` |
| iovation | 1 | 0 | — |

## Как использовать

Для shared CDN проверять hostname вместе с путём: например, `www.gstatic.com` + `/recaptcha/`. Для Forter сохранён точный список 15 CloudFront distributions из предыдущего исправления. Wildcard `*.cloudfront.net` не используется. Поле `role` различает загрузчик/CDN, iframe CAPTCHA, pixel, collector и resolver; collector не называется CDN.

Шаблоны с `{company}`/`{customer}` и `*.` — опубликованные форматы, а не найденные или проверенные развёртывания. `productRelation` отделяет связь с документируемым продуктом от соседнего продукта. У кандидатов `resourceTypes` — предлагаемые типы matcher из CSP/интеграций, а не наблюдённые browser requests. В шести retired-записях Tencent отражено официальное прекращение использования 2023-08-21. Их не включать как действующие CDN.

Для baseline-записей исходные условия находятся в `runtimeMatcher`; идентификатор `pathTemplate` не является строкой URL. `sourceEvidence=runtime-baseline-only` означает, что правило перенесено из текущего кода без новой проверки его первичного источника. Даты прежних правил сохранены. Страница legacy SEON была недоступна при повторной проверке 2026-10-10: использованы проверенные записи каталога от 2026-10-09, дата и sourceCheckStatus это отражают.

## Shodan

Фактический запуск 2026-10-10T10:03:53.050Z: **41/41 успешных запросов, 9 ненулевых count**. Значения присоединены к JSON/CSV по точному hostname в полях shodanIndexStatus и shodanIndexCount.

Выполняется только `/shodan/host/count` для точных опубликованных browser hostname из кандидатов. Сохраняется сводный count и HTTP-статус; IP, порты, баннеры, facets и ключ в файл не попадают. Нулевой count означает отсутствие совпадения в индексе, а не неработающий CDN. Ненулевой count не устанавливает владельца, путь ресурса или использование антифрода сайтом. [Документация Shodan](https://developer.shodan.io/api).

```powershell
node scripts/antifraud-cdn-catalog.mjs --check
node scripts/shodan-cdn-counts.mjs --plan
# --run читает SHODAN_API_KEY; --run --stdin-key принимает ключ через stdin.
```

## Первичные источники

- [DataDome JavaScript Tag: CSP and first-party setup](https://docs.datadome.co/docs/javascript-tag) — проверено 2026-10-10.
- [DataDome frame-src migration, April 2026](https://docs.datadome.co/changelog/last-call-on-required-change-for-users-of-csp-directive-frame-src) — проверено 2026-10-10.
- [reCAPTCHA FAQ: Content Security Policy](https://developers.google.com/recaptcha/docs/faq) — проверено 2026-10-10.
- [hCaptcha Developer Guide: CSP](https://docs.hcaptcha.com/) — проверено 2026-10-10.
- [Arkose Domain Policy: client and server domains](https://developer.arkoselabs.com/docs/domain-policy) — проверено 2026-10-10.
- [Arkose Standard Setup: company API script path](https://developer.arkoselabs.com/docs/standard-setup) — проверено 2026-10-10.
- [HUMAN Sensor: CSP requirements](https://docs.humansecurity.com/applications/sensor) — проверено 2026-10-10.
- [MaxMind Web Device Tracking: CSP](https://dev.maxmind.com/minfraud/track-devices/web/) — проверено 2026-10-10.
- [Kount Data Collector integration](https://github.com/Kount/kount-ris-java-sdk/wiki/Kount-Data-Collector) — проверено 2026-10-10.
- [Kount Device Data Collector CSP](https://developer.kount.com/hc/en-us/articles/14564335823764-Content-Security-Policies-CSP-and-the-Device-Data-Collector) — проверено 2026-10-10.
- [Kount public data-collection domain families](https://support.kount.com/hc/en-us/articles/360045318632-FAQ-Can-You-Collect-Device-Data-from-Devices-Within-Our-Private-Network) — проверено 2026-10-10.
- [SEON deprecated JavaScript Agent versions](https://docs.seon.io/api-reference/deprecated-versions) — проверено 2026-10-09; повторная проверка 2026-10-10: страница недоступна.
- [SEON JavaScript Agent v6: resolver domains](https://docs.seon.io/api-reference/fraud-api) — проверено 2026-10-10.
- [SEON headless storefront: development SDK](https://docs.seon.io/knowledge-base/shopify-2026/custom-headless-storefronts-and-device-intelligence-setup) — проверено 2026-10-10.
- [Socure Digital Intelligence Web SDK: CSP](https://help.socure.com/riskos/docs/digital-intelligence-web-sdk) — проверено 2026-10-10.
- [PayPal FraudNet: CSP tags](https://developer.paypal.com/platforms/checkout/apm/pay-upon-invoice/fraudnet/) — проверено 2026-10-10.
- [GeeTest CAPTCHA v4: primary and backup domains](https://docs.geetest.com/BehaviorVerification/BusinessDisasterRecovery) — проверено 2026-10-10.
- [GeeTest CAPTCHA v4: additional resource allowlist](https://docs.geetest.com/gt4/bypass) — проверено 2026-10-10.
- [ClearSale SDK: script-block monitoring](https://api.clearsale.com.br/docs/behavior-analytics/sdk/browser) — проверено 2026-10-10.
- [ClearSale behavioral biometrics browser module](https://api.clearsale.com.br/docs/behavior-analytics/api/device-check/modules/biometrics) — проверено 2026-10-10.
- [Alibaba Cloud Captcha 2.0 client integration FAQ: resource and interface domains](https://www.alibabacloud.com/help/en/captcha/captcha2-0/user-guide/captcha-2-0-client-access-faq) — проверено 2026-10-10.
- [Tencent CAPTCHA completed CDN migration: previous URLs retired 2023-08-21](https://cloud.tencent.com/document/product/1110/104536) — проверено 2026-10-10.
- [TrustDecision Fingerprint Web SDK: CSP](https://en-doc.trustdecision.com/reference/fp-web) — проверено 2026-10-10.
- [FingerprintJS OSS API: ES module CDN URL](https://github.com/fingerprintjs/fingerprintjs/blob/master/docs/api.md) — проверено 2026-10-10.
- [Friendly Captcha v2: frame-src](https://developer.friendlycaptcha.com/docs/v2/guides/csp) — проверено 2026-10-10.
