# Совместимость входа: проверенная область 1.1.0

REQ-002/012, ADR-006. Исправлены прототипы parent-owned iframe wrappers и best-effort восстановление удалённых режимом защиты API. Полный отчёт: 2026-10-09-login-compatibility.

| Сценарий | Проверенная область |
| --- | --- |
| fetch(string/Request), POST, XHR withCredentials, cookie, redirect, abort | Локальная synthetic login fixture; Chromium 153.0.8010.12; early/late MAIN bundle совпадают с baseline. |
| iframe method/getter/setter Function prototype | Старый defect воспроизведён native; early/late correction проверена. Не проверка всех сторонних iframe библиотек. |
| protection-stop после API deletion | Native UA-CH restore; data/accessor и replacement cases unit. Дескрипторы, удалённые прежним runtime без сохранения handle, требуют reload. |
| legacy protection migration | Unit: reset один раз, сохранение rules, явное subsequent enable, отказ storage с retry. Не свидетельство того, что пользователь включал запреты. |
| Gmail/bet365, SSO, WebAuthn, CAPTCHA | Реальные аккаунты не использовались; успешный вход на этих сервисах не заявляется. |

Полный extension/background/bridge/consent/browser build smoke указывается отдельно в итоговом отчёте выпуска. Отсутствующий own-slot не позволяет доказать историю его повторного изменения страницей; restore best-effort сохраняет любой существующий replacement.
