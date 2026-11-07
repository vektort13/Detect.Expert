// ADR-075: bounded Options-only client; timed-out mutations are never replayed.
import { AUTOSURF_PORT, AUTOSURF_LIMITS, AUTOSURF_STATUSES, AUTOSURF_PHASES, AUTOSURF_CODES, AutosurfError, autosurfRecord, autosurfSafeCode, validateAutosurfConfiguration, validateAutosurfCommand, isOwnAutosurfOptions } from './autosurf-shared.js';

const integer = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const code = value => AUTOSURF_CODES.includes(value) ? value : null;
const time = value => integer(value, 8640000000000000) ? value : null;
const origin = value => { try { if (typeof value !== 'string' || value.length > AUTOSURF_LIMITS.urlLength) return ''; const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.origin : ''; } catch { return ''; } };
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;

/** Only numeric aggregates, origins and fixed codes may enter reports. */
export function autosurfReportProjection(value) {
  if (!autosurfRecord(value)) throw new AutosurfError('invalid-input');
  const visits = Array.isArray(value.visits) ? value.visits : [], events = Array.isArray(value.events) ? value.events : [], samples = Array.isArray(value.samples) ? value.samples : [];
  if (visits.length > AUTOSURF_LIMITS.visits || events.length > AUTOSURF_LIMITS.events || samples.length > AUTOSURF_LIMITS.samples) throw new AutosurfError('invalid-input');
  const project = (rows, fields) => rows.map(row => { if (!autosurfRecord(row)) throw new AutosurfError('invalid-input'); return Object.fromEntries(fields.map(([name, read]) => [name, read(row)])); });
  return {
    format: 'detect.expert.autosurf', formatVersion: 1, generatedAt: time(value.generatedAt), runId: typeof value.runId === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value.runId) ? value.runId : null,
    status: AUTOSURF_STATUSES.includes(value.status) ? value.status : 'idle', reason: code(value.reason), startedAt: time(value.startedAt), endedAt: time(value.endedAt),
    seed: integer(value.seed ?? value.configuration?.seed, 0xffffffff) ? value.seed ?? value.configuration.seed : null,
    configuration: autosurfRecord(value.configuration) ? { ...validateAutosurfConfiguration({ ...value.configuration, urls: [] }), urls: Array.isArray(value.configuration.urls) && value.configuration.urls.length <= AUTOSURF_LIMITS.urls ? value.configuration.urls.map(origin).filter(Boolean) : [] } : null,
    truncated: value.truncated === true,
    progress: { completed: integer(value.progress?.completed, 1000) ? value.progress.completed : 0, total: integer(value.progress?.total, 1000) ? value.progress.total : 0 },
    visits: project(visits, [['index', row => integer(row.index, 1000) ? row.index : null], ['origin', row => origin(row.origin ?? row.url)], ['depth', row => integer(row.depth, 3) ? row.depth : null], ['startedAt', row => time(row.startedAt)], ['endedAt', row => time(row.endedAt)], ['durationMs', row => finite(row.durationMs)], ['status', row => code(row.status) ?? code(row.reason) ?? (['ok', 'complete', 'completed', 'skipped', 'interrupted'].includes(row.status) ? row.status : null)], ['httpStatus', row => integer(row.httpStatus, 599) && row.httpStatus >= 100 ? row.httpStatus : null], ['scrolls', row => integer(row.scrolls) ? row.scrolls : null], ['hovers', row => integer(row.hovers) ? row.hovers : null]]),
    events: project(events, [['at', row => time(row.at)], ['type', row => ['start', 'resume', 'pause', 'stop', 'visit', 'complete', 'error', 'restore'].includes(row.type) ? row.type : null], ['position', row => integer(row.position, 1000) ? row.position : null], ['reason', row => code(row.reason)]]),
    samples: project(samples, [['at', row => time(row.at)], ['systemCpuPercent', row => finite(row.systemCpuPercent) !== null && row.systemCpuPercent <= 100 ? row.systemCpuPercent : null], ['systemMemoryUsedBytes', row => finite(row.systemMemoryUsedBytes)], ['systemMemoryTotalBytes', row => finite(row.systemMemoryTotalBytes)], ['rendererJsHeapBytes', row => finite(row.rendererJsHeapBytes)], ['rendererTaskDurationMs', row => finite(row.rendererTaskDurationMs)], ['gpuPercent', () => null], ['scope', () => 'system-and-renderer'], ['status', row => ['available', 'partial', 'unsupported'].includes(row.status) ? row.status : 'unsupported']]),
  };
}

export function checkedAutosurfSnapshot(value) {
  if (!autosurfRecord(value) || value.version !== 1 || !integer(value.revision) || !AUTOSURF_STATUSES.includes(value.status)) throw new AutosurfError('invalid-input');
  const configuration = validateAutosurfConfiguration(value.configuration), report = autosurfReportProjection(value), caps = value.capabilities;
  if (!autosurfRecord(caps) || typeof caps.supported !== 'boolean') throw new AutosurfError('invalid-input');
  const metrics = autosurfRecord(caps.metrics) ? caps.metrics : {};
  return { ...report, version: 1, revision: value.revision, configuration, phase: AUTOSURF_PHASES.includes(value.phase) ? value.phase : null,
    deadlineAt: time(value.deadlineAt), remainingMs: finite(value.remainingMs),
    current: autosurfRecord(value.current) ? { index: integer(value.current.index, 1000) ? value.current.index : 0, origin: origin(value.current.origin ?? value.current.url), depth: integer(value.current.depth, 3) ? value.current.depth : 0 } : null,
    capabilities: { supported: caps.supported, reason: code(caps.reason), metrics: { systemCpu: metrics.systemCpu === true, systemMemory: metrics.systemMemory === true, renderer: metrics.renderer === true, gpu: false } },
  };
}

export function createAutosurfClient(browserApi = globalThis.chrome, { env = globalThis, onChange = () => {}, onBusyChange = () => {}, onIdleDisconnect = () => {}, deadline = 15000 } = {}) {
  const api = env.browser?.runtime?.id === browserApi?.runtime?.id ? env.browser : browserApi;
  let port = null, disposed = false, sequence = 0, connectionEpoch = 0, pending = null, active = true, accessPending = false, reconciliationRequired = false;
  const busy = () => { try { onBusyChange(Boolean(pending || accessPending), !reconciliationRequired); } catch { /* Render callbacks are not authority. */ } };
  const check = () => { if (disposed) throw new AutosurfError('inactive'); if (!isOwnAutosurfOptions(api, env)) throw new AutosurfError('unauthorized'); };
  const notify = (snapshot, epoch) => { if (active) try { onChange(snapshot, epoch); } catch { /* Ignore rendering failures. */ } };
  function disconnectPort() { const current = port; port = null; try { current?.disconnect(); } catch { /* An invalidated extension port is already unusable. */ } }
  function open() {
    check(); if (port) return port;
    const current = api.runtime.connect({ name: AUTOSURF_PORT }), epoch = ++connectionEpoch; port = current;
    current.onDisconnect.addListener(() => {
      if (port !== current) return;
      // Normal MV3 idle shutdown is recoverable by one authoritative read. A lost
      // request, permission prompt or already failed connection needs explicit recovery.
      const idle = !pending && !accessPending && !reconciliationRequired;
      void api.runtime.lastError; port = null; reconciliationRequired = true;
      if (pending) { clearTimeout(pending.timer); pending.reject(new AutosurfError('native-error')); pending = null; }
      busy();
      if (idle) try { onIdleDisconnect(); } catch { /* Rendering cannot reopen a native request. */ }
    });
    current.onMessage.addListener(message => {
      if (port !== current || !autosurfRecord(message) || message.v !== 1) return;
      if (message.type === 'snapshot') { try { notify(checkedAutosurfSnapshot(message.snapshot), epoch); } catch { /* Reject malformed projections. */ } return; }
      const item = pending; if (!item || message.id !== item.id || typeof message.ok !== 'boolean') return;
      clearTimeout(item.timer); pending = null;
      try {
        const snapshot = message.snapshot ? checkedAutosurfSnapshot(message.snapshot) : null;
        if (snapshot) { reconciliationRequired = false; busy(); notify(snapshot, epoch); }
        if (!message.ok) throw new AutosurfError(message.error?.code);
        if (item.op === 'export' && (message.result?.format !== 'detect.expert.autosurf' || message.result?.formatVersion !== 1)) throw new AutosurfError('invalid-input');
        item.resolve(item.op === 'export' ? autosurfReportProjection(message.result) : snapshot ?? checkedAutosurfSnapshot(message.snapshot));
      } catch (error) { if (autosurfSafeCode(error) === 'invalid-input') reconciliationRequired = true; item.reject(new AutosurfError(autosurfSafeCode(error))); }
      finally { busy(); }
    });
    return current;
  }
  function request(op, payload) {
    try {
      check(); if (pending || accessPending) throw new AutosurfError('busy');
      if (reconciliationRequired && !['load', 'export'].includes(op)) throw new AutosurfError('inactive');
      const id = 'autosurf-' + (++sequence), command = validateAutosurfCommand({ v: 1, id, op, ...(payload === undefined ? {} : { payload }) }), current = open();
      return new Promise((resolve, reject) => {
        const item = { id, op, resolve, reject, timer: null, expired: false }; pending = item; busy();
        item.timer = setTimeout(() => {
          if (pending !== item) return;
          item.expired = true; reconciliationRequired = true;
          // Reading state has no browser side effect to retain. Release an orphaned
          // read port so Refresh remains usable; old-port messages are ignored.
          if (op === 'load') { pending = null; disconnectPort(); }
          busy(); reject(new AutosurfError('timeout'));
        }, deadline);
        try { current.postMessage(command); } catch { clearTimeout(item.timer); pending = null; reconciliationRequired = true; disconnectPort(); busy(); reject(new AutosurfError('native-error')); }
      });
    } catch (error) { return Promise.reject(new AutosurfError(autosurfSafeCode(error))); }
  }
  function recover() {
    try {
      check(); if (accessPending || pending && !pending.expired) throw new AutosurfError('busy');
      // Explicit recovery only reads authoritative state on a new port. The
      // controller still owns any old mutation and its native/serial/CAS limits.
      if (pending) { clearTimeout(pending.timer); pending = null; }
      reconciliationRequired = true;
      disconnectPort(); busy(); return request('load');
    } catch (error) { return Promise.reject(new AutosurfError(autosurfSafeCode(error))); }
  }
  function requestMetricsAccess() {
    try {
      check(); if (pending || accessPending) throw new AutosurfError('busy');
      if (typeof api.permissions?.request !== 'function') throw new AutosurfError('unsupported');
      accessPending = true; busy();
      // Keep the optional permission call in the original click stack.
      const action = api.permissions.request({ permissions: ['system.cpu', 'system.memory'] });
      return Promise.resolve(action).then(granted => { check(); if (granted !== true) throw new AutosurfError('permission-required'); return true; }, () => { throw new AutosurfError('permission-required'); }).finally(() => { accessPending = false; busy(); });
    } catch (error) { accessPending = false; busy(); return Promise.reject(new AutosurfError(autosurfSafeCode(error))); }
  }
  return { load: () => request('load'), save: (revision, configuration) => request('save', { revision, configuration }), start: revision => request('start', { revision }), pause: revision => request('pause', { revision }), resume: revision => request('resume', { revision }), stop: revision => request('stop', { revision }), clear: revision => request('clear', { revision }), export: () => request('export'), requestMetricsAccess, recover,
    setActive(value) { active = value === true; }, isBusy: () => Boolean(pending || accessPending), canRecover: () => !disposed && !accessPending && pending?.expired === true,
    dispose() { disposed = true; if (pending) { clearTimeout(pending.timer); pending.reject(new AutosurfError('inactive')); pending = null; } disconnectPort(); busy(); },
  };
}
