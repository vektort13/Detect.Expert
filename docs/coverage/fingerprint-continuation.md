# Подмены: продолжение Temporal/CSS/Promise — ADR-100

Текущая работа от 2026-11-01 описана в отчёте и [ADR-100](../decisions/ADR-100-fingerprint-continuation.md). Она уточняет [предыдущий аудит](fingerprint-production-audit.md); старые PASS относятся к своим версиям и исходникам.

Существующие Temporal.Now default-zone методы используют выбранную timezone из активного intl-formatting, иначе legacy timezone. Явная zone страницы остаётся native; один original operation создаёт настоящий Temporal результат без дополнительного чтения часов. Отсутствующий Temporal не создаётся. Новый API ID/значение схемы не добавлены. Intl optional-options и Temporal zero-arg пути не читают унаследованные отсутствующие индексы списка аргументов.

JavaScript MQL evaluator поддерживает boolean features, простое feature not и дополнительные width/height/resolution ranges с прежними выбранными полями. Смешанные query expressions сохраняют доминирующее выбранное true/false при неопределённой другой части. Media-type negation целиком остаётся native. Это не эмуляция stylesheet/layout или native change-event scheduling.

Generic asynchronous Custom и прежний RTC preflight проверяют ограниченные public Promise/function-static и Object/Array then descriptor chains до backend. Изменённое проверяемое состояние вызывает guard TypeError, иногда раньше native argument validation. Обычные clean operations и native rejection reasons сохраняются. Post-return private constructor/species pin не удалён. Storage сохраняет отдельную virtual-snapshot модель без native quota operation.

Deferred/native internal assimilation, непокрытая reentrancy, interface-specific prototypes, foreign receiver realm, initially hostile baseline и заранее сохранённые native handles не объявляются закрытыми. Worker/worklet injection, реальные CSS/engine/network свойства и статистическая натуральность не реализованы этим изменением. Private component marker/dedup candidate описан отдельно в отчёте, без заявления об исправлении.

Финальные source-bound проверки: Chrome 156 / Firefox 159 на owned localhost и Chrome 153 / Firefox 138 на настоящем BrowserLeaks. Все четыре scoped прогона PASS; 108 Temporal assertions в трёх поддерживающих браузерах, а Firefox 138 остаётся UNSUPPORTED без создания API. Проверены обычные/hostile Promise entry cases и legacy lowercase-zone canonicalization. Во всех четырёх браузерах отдельно измерены оставшиеся реальные stylesheet/JS MQ и classic/module Worker расхождения; они не считаются успешной подменой. Все 5 327 unit tests и native privacy gate проходят.

Точные версии, origin, отсутствие API, source/QA/dist/ZIP hashes и границы — в отчёте и сводной сверке. Нельзя переносить PASS старого BrowserLeaks или синтетического backend model на непроверенную новую версию браузера.
