// ISOLATED-world bridge entry (E04-02). Built as an IIFE with no runtime imports: the collector is bundled in.
// Starts at document_start; the collector validates page-controlled window messages (REQ-004), aggregates them
// into a bounded ring (REQ-011) and delivers PageBatch -> Ack to the service worker. Nothing here reads page
// globals, DOM text, cookies or URLs (REQ-005): the SW derives every trusted id from MessageSender.

import { createBrowserCollectorEnv, startCollector } from '@detect-expert/collector';
declare const __BUILD_PROFILE__: 'local' | 'test' | 'test-optional';

(() => {
  try {
    // E04-02 #9 / F083 / F084: separate bundle evaluations share one ISOLATED collector.
    // Claim before construction: a partially failed start may already own listeners or timers.
    const mark = Symbol.for('detect.expert/bridge/v1');
    if (Object.getOwnPropertyDescriptor(globalThis, mark) !== undefined) return;
    Object.defineProperty(globalThis, mark, { value: true, writable: false, enumerable: false, configurable: false });
    const collector = startCollector(createBrowserCollectorEnv());
    if (__BUILD_PROFILE__ === 'test') Object.assign(globalThis, { __p07Collector: collector });
  } catch {
    // The bridge must never throw into the page; a failed start means no observation (coverage: no data).
  }
})();
