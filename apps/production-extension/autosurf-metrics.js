// ADR-075: aggregate local resource samples, never CPU/RAM/GPU attribution to a site.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const live = context => { try { return typeof context?.isCurrent === 'function' && context.isCurrent() === true; } catch { return false; } };
const failure = code => Object.assign(new Error(code), { code });

export function createAutosurfMetrics(api, { now = Date.now } = {}) {
  let busy = false, physical = null, previousCpu = null;
  const capabilities = () => ({ systemCpu: typeof api?.system?.cpu?.getInfo === 'function', systemMemory: typeof api?.system?.memory?.getInfo === 'function', renderer: typeof api?.debugger?.sendCommand === 'function', gpu: false });
  async function native(operation, context) {
    if (physical) throw failure('autosurf-busy');
    if (!live(context)) throw failure('autosurf-stale');
    const slot = {}; physical = slot;
    const job = Promise.resolve().then(() => { if (!live(context)) throw failure('autosurf-stale'); return operation(); });
    const release = () => { if (physical === slot) physical = null; }; job.then(release, release);
    let timer;
    try {
      const value = await Promise.race([job, new Promise((_, reject) => { timer = setTimeout(() => reject(failure('autosurf-timeout')), 2500); })]);
      if (!live(context)) throw failure('autosurf-stale');
      return value;
    } finally { clearTimeout(timer); }
  }
  async function granted(permission, context) {
    if (typeof api?.permissions?.contains !== 'function') return false;
    try { return await native(() => api.permissions.contains({ permissions: [permission] }), context) === true; }
    catch (error) { if (!live(context)) throw failure('autosurf-stale'); return false; }
  }
  function cpuSample(value, context, at) {
    const processors = own(value, 'processors');
    if (!Array.isArray(processors) || !processors.length || processors.length > 1024) { previousCpu = null; return null; }
    const rows = [];
    for (const processor of processors) {
      const usage = own(processor, 'usage'), total = own(usage, 'total'), user = own(usage, 'user'), kernel = own(usage, 'kernel'), idle = own(usage, 'idle');
      if (![total, user, kernel, idle].every(n => finite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER) || Math.abs(total - user - kernel - idle) > Math.max(1, total * 1e-9)) { previousCpu = null; return null; }
      rows.push({ total, user, kernel, idle });
    }
    const before = previousCpu;
    previousCpu = { rows, tabId: context.tabId, documentId: context.documentId, at };
    if (!before || before.tabId !== context.tabId || before.documentId !== context.documentId || at <= before.at || at - before.at > 60000 || before.rows.length !== rows.length) return null;
    let deltaTotal = 0, deltaUsed = 0;
    for (let i = 0; i < rows.length; ++i) {
      const a = before.rows[i], b = rows[i];
      if (b.total < a.total || b.user < a.user || b.kernel < a.kernel || b.idle < a.idle) return null;
      deltaTotal += b.total - a.total; deltaUsed += b.user - a.user + b.kernel - a.kernel;
    }
    return deltaTotal > 0 && deltaUsed >= 0 && deltaUsed <= deltaTotal ? Math.round(deltaUsed / deltaTotal * 10000) / 100 : null;
  }
  return {
    capabilities,
    reset() { previousCpu = null; },
    async sample(context, driver = null) {
      if (busy || physical) throw failure('autosurf-busy');
      if (!live(context)) throw failure('autosurf-stale');
      busy = true;
      try {
        const at = now();
        if (!Number.isSafeInteger(at) || at < 0) throw failure('autosurf-stale');
        const result = { at, systemCpuPercent: null, systemMemoryUsedBytes: null, systemMemoryTotalBytes: null, rendererJsHeapBytes: null, rendererTaskDurationMs: null, gpuPercent: null, scope: 'system-and-renderer', status: 'unsupported' }, available = capabilities();
        if (available.systemCpu && await granted('system.cpu', context)) {
          try { result.systemCpuPercent = cpuSample(await native(() => api.system.cpu.getInfo(), context), context, at); }
          catch { previousCpu = null; }
        } else previousCpu = null;
        if (!live(context)) throw failure('autosurf-stale');
        if (available.systemMemory && await granted('system.memory', context)) {
          try {
            const memory = await native(() => api.system.memory.getInfo(), context), capacity = own(memory, 'capacity'), free = own(memory, 'availableCapacity');
            if (finite(capacity) && capacity > 0 && capacity <= Number.MAX_SAFE_INTEGER && finite(free) && free >= 0 && free <= capacity) { result.systemMemoryTotalBytes = Math.round(capacity); result.systemMemoryUsedBytes = Math.round(capacity - free); }
          } catch { /* missing/failed samples stay null, never zero */ }
        }
        if (!live(context)) throw failure('autosurf-stale');
        if (driver && typeof driver.sample === 'function') {
          try {
            const renderer = await driver.sample(context), heap = own(renderer, 'jsHeapBytes'), duration = own(renderer, 'taskDurationMs');
            if (finite(heap) && heap >= 0 && heap <= 1099511627776) result.rendererJsHeapBytes = Math.round(heap);
            if (finite(duration) && duration >= 0 && duration <= 31536000000) result.rendererTaskDurationMs = Math.round(duration);
          } catch { /* renderer support is independently optional */ }
        }
        if (!live(context)) { previousCpu = null; throw failure('autosurf-stale'); }
        const fields = [result.systemCpuPercent, result.systemMemoryUsedBytes, result.rendererJsHeapBytes, result.rendererTaskDurationMs], count = fields.filter(value => value !== null).length;
        result.status = count === fields.length ? 'available' : count ? 'partial' : 'unsupported';
        return result;
      } finally { busy = false; }
    },
  };
}
