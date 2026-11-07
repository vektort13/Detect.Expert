# WebAssembly — наблюдение и API Guard

Каталог определён [ADR-059](../decisions/ADR-059.md) и `packages/contracts/src/webassembly-apis.mjs`. Всего 37 условных операций: 36 присутствуют в Chrome 153/155 и Firefox 153 testbuild, 31 — в Firefox 138. `Tag.type` документирован, но отсутствует во всех четырёх проверенных версиях. Отсутствующие методы расширение не создаёт.

| Семейство | Поверхности |
| --- | --- |
| Компиляция | compile, instantiate, compileStreaming, instantiateStreaming, validate |
| Module | конструктор; imports, exports, customSections |
| Instance | конструктор; exports getter |
| Memory | конструктор; grow, buffer, toFixedLengthBuffer, toResizableBuffer |
| Table | конструктор; grow, get, set, length getter |
| Global | конструктор; valueOf, value getter и setter отдельно |
| Исключения | Tag и Exception; is/getArg/stack; CompileError, LinkError, RuntimeError |
| JSPI | Suspending, promising, SuspendError |
| Условный reflection | Tag.type, только если предоставлен браузером |

Наблюдающие hooks сохраняют оригинальные значения, функции/ресурсы/Promise, аргументы и исключения. Дополнительные операции дают только operation/phase/count. Значения Global/Table, аргументы Exception, module bytes, имена imports/exports/custom sections и stack не передаются и не сохраняются. Прежний Pro allowlist десяти старых операций не расширяется на эти данные.

У `new WebAssembly.Exception(...,{traceStack:true})` Chrome/Firefox могут создавать собственный stack getter поверх прототипа. Успешное наблюдаемое JS-конструирование добавляет обёртку собственного getter по дескриптору, без его вызова; native setter остаётся прежним. Сохраняется одна weak cleanup ring до 128 объектов на runtime; при вытеснении обёртка продолжает считать обращения, а после disable прозрачно вызывает native. Полное снятие вытеснённых обёрток требует нового документа. Граница не распространяется на исключения, созданные до hooks или внутри Wasm без наблюдаемого JS-конструктора.

API Guard сохраняет общий `webassembly` и добавляет 37 независимых ON/BYPASS/OFF правил. ON общего правила скрывает namespace целиком и имеет практический приоритет над child OFF. Новые правила по умолчанию BYPASS и не включаются пресетом самостоятельно. ON отдельного синхронного метода/конструктора/accessor выдаёт SecurityError, асинхронного namespace метода — rejected Promise. Getter/setter Global.value не снимают правила друг друга. Для stack учитывается собственный getter JS-созданного Exception, а cleanup ограничен слабым кольцом до 128 объектов; остальные сохранённые обёртки после stop пропускают оригинал. Custom для native исполняемых ресурсов не предлагается.

Каталог JSON v2 (формат по-прежнему v1): 142 записи, исходные 105 ID/order/metadata сохраняются. Сначала целиком проверяется исторический v1, затем добавляются 37 BYPASS/unset строк во всех scopes. Пользовательские библиотеки, выбранные значения и исключённые сайты сохраняются. Storage failure не заменяет данные legacy fallback. Валидный v1 у предела 4 МиБ может не вместить дополнительные metadata; такая миграция отклоняется с сохранением исходных данных, её нельзя считать успешным применением нового профиля.

Область — доступные JavaScript document realms. Не заявляются worker/worklet, сохранённые до установки native-ссылки, инструкции/SIMD/JIT/GC внутри движка, произвольные функции exports/imports и неперехваченные внутренние исключения. Обёртки не делают таких выводов по факту compile/instantiate. Ограниченная стартовая очередь наблюдения (32 события до handshake) сохраняется; ранний burst сверх лимита не доказывает полное наблюдение всех вызовов. API Guard использует отдельную document_start регистрацию и проверяется отдельно от этой очереди.

Native descriptor inventory: `test-results/production-1.1.0/wasm-inventory/`. Приёмка установленных сборок — `scripts/test/webassembly-native.mjs`, UI — `scripts/test/webassembly-ui-native.mjs`; окончательные результаты — внутренний отчёт. Используются только собственные fixtures.
