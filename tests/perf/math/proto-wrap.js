// P09 / E02-02 / ADR-011/012 / REQ-002/005/011. Lab prototype only, never an entrypoint.
(() => {
  'use strict';
  const apply = Reflect.apply;
  const StackError = Error;
  const names = Object.freeze(['sin', 'cos', 'asin', 'sinh', 'asinh', 'exp', 'log', 'pow', 'sqrt']);
  const maxCount = 2147483647;

  globalThis.__installMathPrototype = (mode, target = Math) => {
    if (!['fast', 'naive'].includes(mode)) throw new TypeError('Unknown prototype mode');
    const counts = new Uint32Array(names.length);
    let enabled = true;
    let entered = false;
    let mask = 0;
    let degraded = false;
    let stackReads = 0;
    const installed = [];
    for (let code = 0; code < names.length; code++) {
      const name = names[code];
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      if (!descriptor || typeof descriptor.value !== 'function' || !descriptor.configurable) continue;
      const original = descriptor.value;
      // No rest/spread, arrays, objects, stack, IPC or clock reads in the fast observer.
      // V8 may materialize `arguments` for forwarding; zero engine allocations is not claimed.
      const wrapped = { wrapped() {
        if (!enabled || entered) return apply(original, this, arguments);
        entered = true;
        try {
          try {
            if (counts[code] < maxCount) counts[code]++;
            mask |= 1 << code;
            if (mode === 'naive') {
              // Deliberately forbidden-cost control. Read but never retain/export the raw stack.
              void new StackError().stack;
              if (stackReads < maxCount) stackReads++;
            }
          } catch {
            enabled = false;
            degraded = true;
          }
          return apply(original, this, arguments);
        } finally {
          entered = false;
        }
      } }.wrapped;
      Object.defineProperty(target, name, { ...descriptor, value: wrapped });
      installed.push({ name, descriptor, wrapped });
    }
    return {
      setEnabled(value) { enabled = value === true; },
      reset() { counts.fill(0); mask = 0; stackReads = 0; },
      snapshot() { return { counts: Array.from(counts), mask, stackReads, degraded, installed: installed.length }; },
      restore() {
        enabled = false;
        for (const item of installed) {
          if (Object.getOwnPropertyDescriptor(target, item.name)?.value === item.wrapped) {
            Object.defineProperty(target, item.name, item.descriptor);
          }
        }
      },
      // Test-only saturation seam; not used by timed fixtures.
      seedCount(code, value) {
        if (!Number.isInteger(code) || code < 0 || code >= names.length ||
            !Number.isInteger(value) || value < 0 || value > maxCount) throw new RangeError('Invalid counter');
        counts[code] = value;
      },
    };
  };
})();
