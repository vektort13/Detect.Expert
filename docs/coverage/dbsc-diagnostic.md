Актуализация 2026-10-10: DBSC удалён по решению владельца продукта. См. [ADR-044](../decisions/ADR-044.md). Старые проверки DBSC ниже относятся к предыдущей реализации.

# DBSC в единственной сборке Chrome

Дата обновления поставки: 2026-10-10. REQ-004/005/007/010/011/012/015; [ADR-027](../decisions/ADR-027.md), [ADR-040](../decisions/ADR-040.md). Реализация: `apps/production-extension/dbsc-inspector.js`, trusted UI routes в `background.js`, canonical readers в `packages/contracts/src/inspection.mjs`.

## Сборка и управление

```powershell
node scripts/build-production.mjs --browser all --release
```

Команда создаёт `dist/chrome`, `dist/firefox` и два соответствующих архива. Chrome включает DBSC: обязательный `debugger`, minimum Chrome 153. Firefox использует свою sidebar/background реализацию; Chrome debugger/CDP ему недоступен. Отдельной DBSC-сборки нет. Optional cookies permission и CSP остаются прежними. Manifest validator отклоняет перенос debugger в optional, изменение diagnostic minimum и расширение разрешений/внешних соединений.

Пользователь открывает Cookie panel, разрешает cookies и нажимает запуск проверки DBSC. До клика controller inactive и не подключает debugger. Требуются collection consent, доступ к текущему сайту, текущий top-level document и единственный выбранный native cookie store. Stop, навигация, pause, revocation и detach отменяют наблюдение. Команды `ui-dbsc-start`, `ui-dbsc-stop`, `ui-dbsc-state` доступны только отправителю с ID и origin собственного расширения; для UI во вкладке дополнительно проверяется URL. Child-frame start и caller overrides domain/store/session не принимаются.

В production controller разрешены только `Network.fetchSchemefulSite` и `Network.enableDeviceBoundSessions`; `Network.enable` не вызывается. Подписка устанавливается до enable. Публичный state содержит documentKey, fixed status, sessionCount, inScopeSessionCount и truncated. Canonical egress не допускает raw identity, TPM flag или дополнительные поля; некорректный controller result превращается в fixed no-access error.

## Что означает результат

`boundSessionStatus` cookie принимает только:

- `matched`: точная существующая native cookie соответствует craving активной browser-reported DBSC session;
- `not-observed`: полная актуальная подписка завершена, совпадения этой cookie нет;
- `unknown`: недостаточный/устаревший контекст, неполные данные, неподдержанный native identity или потерянный lifecycle update.

Tuple сохраняет name, domain с исходной ведущей точкой, path, Secure, HttpOnly и SameSite; отдельно проверяются выбранный store, hostOnly и срок существующей cookie. Partition/FPI и неоднозначные identity остаются unknown. Scope сессии анализируется отдельно: membership cookie не доказывает защиту текущего запроса. Session ID и полная identity нужны только в ограниченной transient background memory; UI, Pro, storage и export их не получают. Cookie values, keys, challenges, proof, refresh URL/body не читаются controller.

CDP не возвращает сведения о backing ключа конкретным TPM. Cookie panel сохраняет «TPM: браузер не сообщает». Membership не присваивает подтверждающий TPM-замок, «зашифрована TPM» или «не экспортируется».

Native DBSC subscription относится к NetworkContext, а не только к выбранной странице. Перед чтением ID/cravings проверяется schemeful site: валидный чужой site отбрасывается сразу; отсутствующий/accessor/некорректный site делает inventory incomplete. Непоместившийся refresh, потерянное termination или другой непроверяемый same-site lifecycle update сразу очищают retained и queued membership. Более старый queued/initial payload не может восстановить stale positive; восстановление требует нового запуска инспектирования. Частичный initial inventory сохраняет только проверенные положительные совпадения.

## Бюджеты

| Данные/операция | Предел |
| --- | --- |
| Sessions | 32 |
| Cravings, включая очередь | 256 |
| Retained metadata и queue | 128 KiB |
| URL rules на session | 128 |
| Queued / admitted events | 32 / 256 |
| Inspection TTL | 60 секунд |
| Native await / initial event | 1 / 3 секунды |
| Unsettled physical jobs | 8 |

Timeout не освобождает незавершённую физическую операцию. Неуспешный detach блокирует новый attach до cleanup. При stop identities и pending payload стираются синхронно, до async disable/detach.

## Источники

Transport: [Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger), [Chrome permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions). Семантика проверена по установленному для tests Chromium 153.0.8010.12 и закреплённым исходникам: [Network PDL](https://raw.githubusercontent.com/chromium/chromium/153.0.8010.12/third_party/blink/public/devtools_protocol/domains/Network.pdl), [Network handler](https://raw.githubusercontent.com/chromium/chromium/153.0.8010.12/content/browser/devtools/protocol/network_handler.cc), [CookieCraving](https://raw.githubusercontent.com/chromium/chromium/153.0.8010.12/net/device_bound_sessions/cookie_craving.cc), [inclusion rules](https://raw.githubusercontent.com/chromium/chromium/153.0.8010.12/net/device_bound_sessions/session_inclusion_rules.cc). Подробности и отличие draft от текущего browser: проверка приложения пользователя.

## Проверки

```powershell
node --test scripts/test/dbsc-inspector.test.mjs scripts/test/dbsc-independent-review.test.mjs scripts/test/dbsc-routes.test.mjs
node scripts/test-dbsc-diagnostic.mjs
```

Первая команда выполнена независимо: **113 tests, 113 pass, 0 fail**, 8 219.46 ms. Включает 65 controller fixtures, 9 cases независимого reviewer и 39 trusted-route regressions. Проверены точные cookie identities, scope, getters/coercion, foreign-site early drop, lifecycle replacement/termination, pre-initial ordering, stale positive, queue caps, timeout/cleanup, permission/document/store races, sender/consent/child/override rejection и canonical egress.

Native harness source и фактический artifact проверены read-only: **8 checks PASS**, Chromium **153.0.8010.12**, `channel: chromium`. Harness собирает единственный Chrome package, включая DBSC, создаёт собственный пустой profile под project `.tmp`, запускает localhost HTTP fixture с синтетической HttpOnly cookie, управляет реальными Cookie/DBSC кнопками и удаляет свой проверенный profile. Renderer routing допускает только localhost fixture и extension/about URLs; remote page requests отклоняются. Cookie value canary отсутствует в metadata/state. Проверены inactive до клика, active после клика, нулевой initial inventory, отсутствие совпавшей session, отсутствие TPM-замка, stop/detach, запрет child-frame start и отмена при navigation.

Нативный тест получил **0 DBSC sessions**. Он подтверждает работоспособность CDP transport/UI на этом Chromium channel, а положительное membership/lifecycle — unit fixtures. Настоящая HTTPS DBSC registration и TPM hardware attestation этим тестом не проверены. Реальные пользовательские профили, accounts, certificates и keys не используются. Artifact содержит hashes реально проверенных delivered modules; после source изменений он обновляется повторным запуском native harness.

## Локальное сравнительное измерение

```powershell
node scripts/production/performance.mjs
```

Последний запуск после оптимизации social insertion hooks: exit 0, Chromium 153.0.8010.12. Один warmup и шесть измеряемых rounds; artifact с samples.

| Режим | Медиана всего workload, ms | Медиана 5000 node insertions, ms |
| --- | ---: | ---: |
| Без sensor | 43.15 | 1.35 |
| 1.0.0 passive | 54.70 | 1.35 |
| 1.1.0 passive | 54.05 | 1.70 |
| 1.1.0 active Pro | 100.30 | 14.50 |

До исправления insertion hooks passive/Pro total составляли 90.80/145.70 ms, insertion — 38.45/54.95 ms. После native nodeName early rejection passive workload близок к 1.0.0. Active Pro дополнительно собирает историю значений и стоит около 1.86× текущего passive на этом workload.

Benchmark загружает тот же MAIN sensor через `addInitScript`, сравнивая архив 1.0.0 с текущим source. Он подтверждает вызовы hooks и активные Pro rows, но не измеряет весь extension background, Cookie/Social capture, DBSC attach или произвольные сайты. Threshold не задан; результат является измерением конкретного workload.
