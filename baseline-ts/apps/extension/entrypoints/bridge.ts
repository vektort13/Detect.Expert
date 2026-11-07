// ISOLATED-world bridge entry (E04-02). Built as an IIFE with no runtime imports: the collector is bundled in.
// Starts at document_start; the collector validates page-controlled window messages (REQ-004), aggregates them
// into a bounded ring (REQ-011) and delivers PageBatch -> Ack to the service worker. Nothing here reads page
// globals, DOM text, cookies or URLs (REQ-005): the SW derives every trusted id from MessageSender.

import { createBrowserCollectorEnv, startCollector, startBrowserVisualBridge, startBrowserRtcBridge } from '@detect-expert/collector';
import { startBrowserProtectionBridge } from '../../../packages/collector/src/protection';
import { startBrowserApiResultsBridge } from '../../../packages/collector/src/api-results';
declare const __BUILD_PROFILE__: 'local' | 'test' | 'test-optional';

(() => {
  try {
    // E04-02 #9 / F083 / F084: separate bundle evaluations share one ISOLATED collector.
    // Claim before construction: a partially failed start may already own listeners or timers.
    const mark = Symbol.for('detect.expert/bridge/v1');
    if (Object.getOwnPropertyDescriptor(globalThis, mark) !== undefined) return;
    Object.defineProperty(globalThis, mark, { value: true, writable: false, enumerable: false, configurable: false });
    const collector = startCollector(createBrowserCollectorEnv());
    startBrowserVisualBridge();
    startBrowserRtcBridge();
    startBrowserProtectionBridge();
    startBrowserApiResultsBridge();
    // BrowserLeaks / REQ-004: Chrome can run this ISOLATED bridge in a same-origin sandbox where MAIN
    // script execution is disabled. Ask the accessible parent to install realm-local API wrappers.
    // This primitive announcement is routing only. Observations still leave through THIS child's sender.
    try {
      const frame = window.frameElement;
      // frameElement belongs to the parent's realm, so instanceof the CHILD's constructor is false.
      if (window !== window.parent && frame?.localName === 'iframe' && frame.hasAttribute('sandbox') &&
          !(frame as HTMLIFrameElement).sandbox.contains('allow-scripts')) window.parent.postMessage('detect.expert/child-realm/v1', '*');
    } catch { /* Opaque/cross-origin child: preserve the existing explicit coverage limitation. */ }
    // P07: ISOLATED privileged test inspection only; eliminated from production bundles.
    if (__BUILD_PROFILE__ === 'test') Object.assign(globalThis, { __p07Collector: { snapshot: collector.snapshot } });
  } catch {
    // The bridge must never throw into the page; a failed start means no observation (coverage: no data).
  }
})();
