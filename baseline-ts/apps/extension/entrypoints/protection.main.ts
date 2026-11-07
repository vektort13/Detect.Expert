import { PROTECTION_CHANNEL } from '@detect-expert/contracts';
import type { ProtectionFeature } from '@detect-expert/contracts';
import { installProtection } from '../../../packages/sensors/src/protection';

declare const __PROTECTION_FEATURE__: ProtectionFeature;

(() => {
  try {
    const apply = Reflect.apply;
    const own = Object.getOwnPropertyDescriptor;
    const hasOwn = Object.hasOwn;
    const mark = Symbol.for(PROTECTION_CHANNEL + '/' + __PROTECTION_FEATURE__);
    if (own(globalThis, mark) !== undefined) return;
    Object.defineProperty(globalThis, mark, { __proto__: null, value: true, configurable: false } as PropertyDescriptor);
    const installation = installProtection(globalThis, __PROTECTION_FEATURE__);
    const post = window.postMessage;
    const dataGetter = own(MessageEvent.prototype, 'data')?.get;
    const sourceGetter = own(MessageEvent.prototype, 'source')?.get;
    const clock = Date.now;
    let lastReply = -Infinity;
    const field = (value: object, key: string): unknown => {
      const descriptor = own(value, key);
      return descriptor && hasOwn(descriptor, 'value') ? descriptor.value : undefined;
    };
    window.addEventListener('message', event => {
      try {
        if (!dataGetter || !sourceGetter || apply(sourceGetter, event, []) !== window) return;
        const data: unknown = apply(dataGetter, event, []);
        if (typeof data !== 'object' || data === null || field(data, 'channel') !== PROTECTION_CHANNEL) return;
        const type = field(data, 'type');
        if (type === 'protection-stop') installation.stop();
        else if (type === 'protection-query') {
          const now = clock();
          if (now - lastReply < 250) return;
          lastReply = now;
          apply(post, window, [{ channel: PROTECTION_CHANNEL, type: 'protection-observation', observation: installation.snapshot() }, '*']);
        }
      } catch { /* MAIN can suppress its own observations, never extension policy. */ }
    });
  } catch { /* Unavailable installation is reported as missing coverage, not protection. */ }
})();