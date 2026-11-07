// ADR-075: one explicitly started, owned browser window; all effects follow durable checkpoints.
import { AUTOSURF_LIMITS as LIMIT, AUTOSURF_ALARM, AUTOSURF_STATUSES, AUTOSURF_PHASES, AUTOSURF_CODES, autosurfFail, autosurfSafeCode, autosurfRecord, validateAutosurfConfiguration, createDefaultAutosurfConfiguration, createAutosurfPlan, createAutosurfVisitRandom, validateAutosurfUrl } from './autosurf-shared.js';

const clone = value => structuredClone(value);
const SKIPS_IN_A_ROW = 3;
const validId = value => Number.isInteger(value) && value >= 0 && value <= 2147483647;
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const documentId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const idleRun = () => ({ status: 'idle', phase: null, reason: null, runId: null, startedAt: null, runDeadlineAt: null, deadlineAt: null, position: 0, plan: [], depth: 0, currentUrl: null, tabId: null, windowId: null, completed: 0, visits: [], events: [], samples: [], truncated: false, runConfig: null });
function fixedKeys(value, keys) { return autosurfRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }

export function validateAutosurfCheckpoint(value) {
  if (!fixedKeys(value, ['version', 'revision', 'configuration', 'run']) || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || new TextEncoder().encode(JSON.stringify(value)).length > LIMIT.checkpointBytes) autosurfFail('invalid-input');
  const configuration = validateAutosurfConfiguration(value.configuration), run = value.run, template = idleRun();
  if (!fixedKeys(run, Object.keys(template)) || !AUTOSURF_STATUSES.includes(run.status) || run.phase !== null && !AUTOSURF_PHASES.includes(run.phase) || run.reason !== null && !AUTOSURF_CODES.includes(run.reason) || run.runId !== null && (typeof run.runId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(run.runId))) autosurfFail('invalid-input');
  for (const key of ['startedAt', 'runDeadlineAt', 'deadlineAt']) if (run[key] !== null && !finite(run[key])) autosurfFail('invalid-input');
  for (const key of ['tabId', 'windowId']) if (run[key] !== null && !validId(run[key])) autosurfFail('invalid-input');
  for (const key of ['position', 'depth', 'completed']) if (!Number.isSafeInteger(run[key]) || run[key] < 0) autosurfFail('invalid-input');
  if (run.depth > 3 || run.completed > 1000 || typeof run.truncated !== 'boolean' || !Array.isArray(run.plan) || run.plan.length > 1000 || run.position > run.plan.length) autosurfFail('invalid-input');
  const runConfig = run.runConfig === null ? null : validateAutosurfConfiguration(run.runConfig);
  if (run.plan.some(index => !Number.isSafeInteger(index) || index < 0 || index >= (runConfig?.urls.length ?? 0)) || run.currentUrl !== null && validateAutosurfUrl(run.currentUrl) !== run.currentUrl) autosurfFail('invalid-input');
  if (['running', 'paused'].includes(run.status) && (!runConfig || !run.plan.length || !run.runId || run.startedAt === null || run.runDeadlineAt === null)) autosurfFail('invalid-input');
  validateRows(run, runConfig?.urls.length ?? 0);
  return { version: 1, revision: value.revision, configuration, run: { ...clone(run), runConfig } };
}
function validateRows(run, maxIndex = 200) {
  const arrays = [['visits', LIMIT.visits], ['events', LIMIT.events], ['samples', LIMIT.samples]];
  for (const [key, max] of arrays) if (!Array.isArray(run[key]) || run[key].length > max || run[key].some(row => !autosurfRecord(row))) autosurfFail('invalid-input');
  for (const row of run.events) if (!fixedKeys(row, ['at', 'type', 'reason', 'position']) || !finite(row.at) || !['start', 'resume', 'pause', 'stop', 'visit', 'complete', 'error', 'restore'].includes(row.type) || row.reason !== null && !AUTOSURF_CODES.includes(row.reason) || !Number.isSafeInteger(row.position) || row.position < 0 || row.position > 1000) autosurfFail('invalid-input');
  for (const row of run.visits) if (!fixedKeys(row, ['index', 'origin', 'depth', 'startedAt', 'endedAt', 'durationMs', 'status', 'scrolls', 'hovers']) || !Number.isSafeInteger(row.index) || row.index < 0 || row.index >= maxIndex || typeof row.origin !== 'string' || new URL(validateAutosurfUrl(row.origin)).origin !== row.origin || !Number.isInteger(row.depth) || row.depth < 0 || row.depth > 3 || !['completed', 'interrupted'].includes(row.status) || ['startedAt', 'endedAt', 'durationMs', 'scrolls', 'hovers'].some(key => !finite(row[key]))) autosurfFail('invalid-input');
  for (const row of run.samples) validateSample(row);
}
export function validateAutosurfReport(value) {
  if (!fixedKeys(value, ['format', 'formatVersion', 'generatedAt', 'runId', 'status', 'reason', 'configuration', 'progress', 'visits', 'events', 'samples', 'truncated']) || value.format !== 'detect.expert.autosurf' || value.formatVersion !== 1 || !finite(value.generatedAt) || !AUTOSURF_STATUSES.includes(value.status) || value.reason !== null && !AUTOSURF_CODES.includes(value.reason) || typeof value.truncated !== 'boolean' || value.runId !== null && (typeof value.runId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.runId)) || new TextEncoder().encode(JSON.stringify(value)).length > LIMIT.checkpointBytes) autosurfFail('invalid-input');
  if (!autosurfRecord(value.configuration) || !Array.isArray(value.configuration.urls) || value.configuration.urls.length > LIMIT.urls) autosurfFail('invalid-input');
  for (const raw of value.configuration.urls) if (new URL(validateAutosurfUrl(raw)).origin !== raw) autosurfFail('invalid-input');
  validateAutosurfConfiguration({ ...value.configuration, urls: [...new Set(value.configuration.urls)] });
  if (!fixedKeys(value.progress, ['completed', 'total']) || !Number.isSafeInteger(value.progress.total) || value.progress.total < 0 || value.progress.total > 1000 || !Number.isSafeInteger(value.progress.completed) || value.progress.completed < 0 || value.progress.completed > value.progress.total) autosurfFail('invalid-input');
  validateRows(value); return clone(value);
}
function validateSample(row) {
  const keys = ['at', 'systemCpuPercent', 'systemMemoryUsedBytes', 'systemMemoryTotalBytes', 'rendererJsHeapBytes', 'rendererTaskDurationMs', 'gpuPercent', 'scope', 'status'];
  if (!fixedKeys(row, keys) || !finite(row.at) || row.scope !== 'system-and-renderer' || !['available', 'partial', 'unsupported'].includes(row.status) || row.gpuPercent !== null || keys.slice(1, 6).some(key => row[key] !== null && !finite(row[key])) || row.systemCpuPercent !== null && row.systemCpuPercent > 100) autosurfFail('invalid-input');
  return clone(row);
}

export function createAutosurfController(api, { driver, metrics = null, storage, now = Date.now, env = globalThis, onChange = () => {} } = {}) {
  if (!storage || !driver) throw new TypeError('Autosurfer dependencies required');
  const schedule = env.setTimeout?.bind(env) ?? setTimeout, cancel = env.clearTimeout?.bind(env) ?? clearTimeout;
  let configuration = createDefaultAutosurfConfiguration(), revision = 0, run = idleRun(), epoch = 0, disposed = false, unavailable = false, historicalReport = null;
  let tail = Promise.resolve(), queued = 0, runner = null, physical = null, committed = null, currentOrigin = null, navigationIntent = null, openingBlankTab = null, waitingLoad = null, actionTimer = null, wakeWait = null, lastSample = 0, lastClock = now(), activeVisit = null;
  let alarmJob = null, alarmClearRequested = false, initialization = null, initializationFailed = false;
  let cleaning = Promise.resolve(), navigationFailure = false;
  const listeners = [];
  function listen(event, callback, ...args) { if (typeof event?.addListener === 'function') { event.addListener(callback, ...args); listeners.push(() => { try { event.removeListener?.(callback); } catch {} }); } }
  function supported() { return typeof api.runtime?.getBrowserInfo !== 'function' && typeof api.debugger?.attach === 'function' && typeof api.windows?.create === 'function' && typeof api.scripting?.executeScript === 'function'; }
  function capabilities() { let measured = { systemCpu: false, systemMemory: false, renderer: supported(), gpu: false }; try { measured = { ...measured, ...metrics?.capabilities?.(), gpu: false }; } catch {} return { supported: supported(), reason: supported() ? null : 'unsupported', metrics: measured }; }
  function snapshot() {
    const current = run.currentUrl === null ? null : { index: run.plan[run.position] ?? null, url: run.currentUrl, origin: currentOrigin ?? new URL(run.currentUrl).origin, depth: run.depth };
    return clone({ version: 1, revision, configuration, status: historicalReport?.status ?? run.status, phase: run.phase, reason: unavailable ? 'storage-unavailable' : historicalReport?.reason ?? run.reason, runId: historicalReport?.runId ?? run.runId, current, progress: historicalReport?.progress ?? { completed: run.completed, total: run.plan.length }, startedAt: run.startedAt, deadlineAt: run.deadlineAt, remainingMs: run.deadlineAt === null ? 0 : Math.max(0, run.deadlineAt - now()), visits: historicalReport?.visits ?? run.visits, events: historicalReport?.events ?? run.events, samples: historicalReport?.samples ?? run.samples, truncated: historicalReport?.truncated ?? run.truncated, capabilities: capabilities() });
  }
  function notify() { try { onChange(snapshot()); } catch {} }
  function serial(action) { if (queued >= LIMIT.commands) return Promise.reject(Object.assign(new Error('busy'), { code: 'busy' })); queued++; const result = tail.then(action, action); tail = result.catch(() => {}); return result.finally(() => queued--); }
  function checkpoint() { const safe = clone(run); if (safe.depth > 0) { safe.currentUrl = safe.runConfig?.urls[safe.plan[safe.position]] ?? null; safe.depth = 0; } return { version: 1, revision, configuration: clone(configuration), run: safe }; }
  async function persist() {
    const value = checkpoint();
    if (new TextEncoder().encode(JSON.stringify(value)).length > LIMIT.checkpointBytes) autosurfFail('result-limit');
    try { await storage.saveCheckpoint(value); if (storage.saveLastReport) await storage.saveLastReport(exportReport()); unavailable = false; } catch { unavailable = true; invalidate(); run.status = run.runId ? 'paused' : 'error'; run.reason = 'storage-unavailable'; run.deadlineAt = null; void detach(); notify(); autosurfFail('storage-unavailable'); }
    notify();
  }
  function event(type, reason = null) {
    if (run.events.length >= LIMIT.events) { run.truncated = true; return false; }
    run.events.push({ at: now(), type, reason, position: run.position }); return true;
  }
  function invalidate() { epoch++; committed = null; navigationIntent = null; if (actionTimer !== null) cancel(actionTimer); actionTimer = null; const awake = wakeWait; wakeWait = null; awake?.(); const load = waitingLoad; waitingLoad = null; load?.resolve(false); }
  const current = token => !disposed && run.status === 'running' && epoch === token;
  // The window a run created is closed when the run ends (completion, Stop, Clear, a new Start); a paused run keeps it for Resume. Ownership is checked
  // again at the browser: the window must still hold the tab this run created. Tabs the user added keep their window (only our tab is closed); a tab or
  // window that is gone or moved is simply released. One cleanup at a time, bounded; a failed or late cleanup changes nothing else.
  function forget() { const owned = { tabId: run.tabId, windowId: run.windowId }; run.tabId = null; run.windowId = null; return owned; }
  async function closeOwned({ tabId, windowId }) {
    if (!validId(tabId) || !validId(windowId) || typeof api.windows?.get !== 'function') return false;
    const job = cleaning.then(async () => {
      try {
        const window = await api.windows.get(windowId, { populate: true }), tabs = Array.isArray(window?.tabs) ? window.tabs : [];
        if (window?.id !== windowId || window.type !== 'normal' || window.incognito || !tabs.some(tab => tab?.id === tabId)) return false;
        if (tabs.length === 1) await api.windows.remove(windowId); else await api.tabs.remove(tabId);
        return true;
      } catch { return false; }
    });
    cleaning = job.then(() => {}, () => {});
    let timer;
    try { return await Promise.race([job, new Promise(resolve => { timer = schedule(() => resolve(false), LIMIT.nativeMs); })]); } finally { if (timer !== undefined) cancel(timer); }
  }
  async function blank(tabId) {
    if (!validId(tabId)) return;
    let timer;
    try { await Promise.race([api.tabs.update(tabId, { url: 'about:blank' }), new Promise(resolve => { timer = schedule(resolve, LIMIT.nativeMs); })]); } catch { /* the tab is gone */ } finally { if (timer !== undefined) cancel(timer); }
  }
  // The browser's own error page (DNS failure, refused connection, a download) is a failed load of the site we asked for, not a navigation by someone else.
  const errorPage = url => typeof url === 'string' && url.startsWith('chrome-error:');
  function loadFailed() { navigationFailure = true; const load = waitingLoad; waitingLoad = null; load?.resolve(false); }
  function assertCurrent(token) { if (!current(token)) autosurfFail('inactive'); }
  async function detach() { const tabId = run.tabId; if (validId(tabId)) try { await driver.detach(tabId); } catch {} }
  function beginAlarm(kind) {
    if (alarmJob) return null;
    const job = { kind, epoch, expired: false, timer: null, result: null }; alarmJob = job;
    const native = Promise.resolve().then(() => {
      if (kind === 'clear') return api.alarms?.clear(AUTOSURF_ALARM);
      assertCurrent(job.epoch);
      return api.alarms.create(AUTOSURF_ALARM, { periodInMinutes: 0.5, ...(typeof api.runtime?.getBrowserInfo !== 'function' ? { persistAcrossSessions: false } : {}) });
    });
    const settle = () => {
      if (alarmJob !== job) return;
      alarmJob = null;
      if (kind === 'create' && (job.expired || !current(job.epoch))) alarmClearRequested = true;
      if (alarmClearRequested) { alarmClearRequested = false; beginAlarm('clear'); }
    };
    native.then(settle, settle);
    // Timeout releases callers, never the native slot. Repeated cleanup shares
    // one job, and a late create is cleared before any subsequent create.
    job.result = Promise.race([native.then(() => true, () => false), new Promise(resolve => {
      job.timer = schedule(() => { job.expired = true; resolve(false); }, LIMIT.nativeMs);
    })]).finally(() => cancel(job.timer));
    return job;
  }
  async function clearAlarm() {
    const pending = alarmJob;
    if (!pending) { await beginAlarm('clear').result; return; }
    if (pending.kind === 'create') alarmClearRequested = true;
    await pending.result;
  }
  async function watchdog() {
    const token = epoch;
    if (alarmJob) {
      if (alarmJob.kind !== 'clear' || !await alarmJob.result) autosurfFail('native-error');
      if (alarmJob) autosurfFail('native-error');
    }
    assertCurrent(token);
    const job = beginAlarm('create');
    if (!job || !await job.result || !current(token)) { void clearAlarm(); autosurfFail('native-error'); }
  }
  async function effect(operation, token, settled = null) {
    assertCurrent(token); if (physical) autosurfFail('busy');
    const promise = Promise.resolve().then(() => { assertCurrent(token); return operation(); }).then(async result => { if (settled) await settled(result); return result; }); physical = promise;
    promise.then(() => { if (physical === promise) physical = null; }, () => { if (physical === promise) physical = null; });
    let timeout;
    try { const result = await Promise.race([promise, new Promise((_, reject) => { timeout = schedule(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), LIMIT.nativeMs); })]); assertCurrent(token); return result; }
    finally { if (timeout !== undefined) cancel(timeout); }
  }
  async function change(token, action) { return serial(async () => { assertCurrent(token); action(); await persist(); assertCurrent(token); }); }
  function wait(ms, token) {
    if (!current(token)) return Promise.resolve();
    wakeWait?.();
    let done;
    const promise = new Promise(resolve => { let timer; done = () => { if (timer !== undefined) cancel(timer); if (actionTimer === timer) actionTimer = null; if (wakeWait === done) wakeWait = null; resolve(); }; wakeWait = done; timer = schedule(done, Math.max(0, Math.min(ms, LIMIT.watchdogMs))); actionTimer = timer; });
    promise.cancel = () => done(); return promise;
  }
  async function until(deadline, token) { while (current(token) && now() < deadline) { await wait(deadline - now(), token); checkClock(token); } assertCurrent(token); }
  function checkClock(token) { if (!current(token)) return; const time = now(); if (time + 1000 < lastClock) { void interrupt('clock-changed').catch(() => {}); return; } lastClock = time; if (time >= run.runDeadlineAt) void finish('run-limit').catch(() => {}); }
  function liveContext(token) { assertCurrent(token); if (!committed || !documentId(committed.documentId)) autosurfFail('navigation-error'); const frame = committed; return { tabId: run.tabId, documentId: frame.documentId, origin: frame.origin, url: frame.url, isCurrent: () => current(token) && committed === frame }; }
  function closeVisit(status) { if (!activeVisit) return; if (run.visits.length < LIMIT.visits) run.visits.push({ ...activeVisit, endedAt: now(), durationMs: Math.max(0, now() - activeVisit.startedAt), status }); else run.truncated = true; activeVisit = null; }
  // keep: the page itself caused the pause (its own script changed the history); the tab is still ours, so only a user's takeover releases it.
  async function interrupt(reason = 'user-paused', keep = false) {
    const release = !keep && ['tab-closed', 'tab-replaced', 'tab-discarded', 'manual-navigation'].includes(reason);
    if (disposed) return snapshot();
    if (run.status !== 'running') {
      if (run.status === 'paused' && release && run.tabId !== null) { void detach(); return serial(async () => { run.tabId = null; run.windowId = null; await persist(); return snapshot(); }); }
      return snapshot();
    }
    invalidate(); metrics?.reset?.();
    const detached = detach(); void clearAlarm();
    const result = await serial(async () => { if (run.status !== 'running') return snapshot(); closeVisit('interrupted'); run.status = 'paused'; run.reason = reason; run.deadlineAt = null; if (release) { run.tabId = null; run.windowId = null; } event('pause', reason); await persist(); return snapshot(); });
    // A redirect took the tab to someone else's site: the run stops there, and the tab (still ours) goes back to a blank page, so that no foreign site keeps
    // running in our window and Stop or Resume find it in a known state.
    if (reason === 'external-navigation') { const tabId = run.tabId; void detached.then(() => blank(tabId)); }
    void detached; return result;
  }
  async function finish(reason = 'complete') {
    if (run.status !== 'running') return snapshot(); invalidate(); metrics?.reset?.(); const detached = detach(); void clearAlarm();
    return serial(async () => { if (run.status !== 'running') return snapshot(); closeVisit(reason === 'complete' ? 'completed' : 'interrupted'); run.status = reason === 'complete' ? 'completed' : 'stopped'; run.phase = null; run.reason = reason; run.deadlineAt = null; if (reason === 'result-limit') run.truncated = true; event(reason === 'complete' ? 'complete' : 'stop', reason); const owned = forget(); try { await persist(); } finally { await detached; await closeOwned(owned); } return snapshot(); });
  }
  async function openWindow(token) {
    await change(token, () => { run.phase = 'opening'; run.deadlineAt = now() + LIMIT.nativeMs; });
    const window = await effect(() => api.windows.create({ url: 'about:blank', type: 'normal', focused: true }), token, async created => {
      if (current(token) || !validId(created?.id) || created.type !== 'normal' || !Array.isArray(created.tabs) || created.tabs.length !== 1 || !validId(created.tabs[0]?.id)) return;
      // Only a window returned by this exact create can be cleaned up, and only
      // while it remains the untouched one-tab blank window we created.
      try { const fresh = await api.windows.get(created.id, { populate: true }); if (fresh?.id === created.id && fresh.type === 'normal' && fresh.tabs?.length === 1 && fresh.tabs[0].id === created.tabs[0].id && fresh.tabs[0].url === 'about:blank' && (!fresh.tabs[0].pendingUrl || fresh.tabs[0].pendingUrl === 'about:blank')) await api.windows.remove(created.id); } catch { /* A changed/closed window is released; no unrelated tab is touched. */ }
    });
    if (!validId(window?.id) || window.type !== 'normal' || !Array.isArray(window.tabs) || window.tabs.length !== 1 || !validId(window.tabs[0]?.id)) autosurfFail('native-error');
    await change(token, () => { run.tabId = window.tabs[0].id; run.windowId = window.id; openingBlankTab = window.tabs[0].id; });
    await driver.attach(run.tabId, () => current(token)); assertCurrent(token);
    await verifyForeground(token);
  }
  async function verifyForeground(token) {
    const window = await effect(() => api.windows.get(run.windowId), token);
    const tab = await effect(() => api.tabs.get(run.tabId), token);
    if (window?.id !== run.windowId || window.focused !== true || tab.windowId !== run.windowId || tab.active !== true || tab.incognito || tab.discarded) autosurfFail('window-blurred');
  }
  // A paused or restored run takes its window back only when the tab is still the one it created and still shows one of the run's own sites (or the
  // blank/error page it was left on). Anything else was taken over while nothing was watching: it is released, never closed or overwritten.
  async function resumable(token) {
    const gone = error => { if (['inactive', 'timeout', 'busy'].includes(error?.code)) throw error; return false; };
    let tab, frame;
    try { tab = await effect(() => api.tabs.get(run.tabId), token); } catch (error) { return gone(error); }
    if (tab?.id !== run.tabId || tab.windowId !== run.windowId || tab.incognito || tab.discarded) return false;
    try { frame = await effect(() => api.webNavigation.getFrame({ tabId: run.tabId, frameId: 0 }), token); } catch (error) { return gone(error); }
    try {
      const url = typeof frame?.url === 'string' ? frame.url : '';
      return url === 'about:blank' || errorPage(url) || run.runConfig.urls.some(own => new URL(own).hostname === new URL(url).hostname);
    } catch { return false; }
  }
  async function ensureWindow(token) {
    if (run.tabId === null) return openWindow(token);
    if (!await resumable(token)) { await change(token, () => { forget(); }); return openWindow(token); }
    // A popup of the page may have taken the foreground of this window while the run was paused.
    await effect(() => api.tabs.update(run.tabId, { active: true }), token);
    await effect(() => api.windows.update(run.windowId, { focused: true }), token);
    await driver.attach(run.tabId, () => current(token)); assertCurrent(token);
    await verifyForeground(token);
  }
  async function navigate(url, token) {
    committed = null; currentOrigin = new URL(url).origin; openingBlankTab = null; navigationFailure = false;
    await change(token, () => { run.currentUrl = url; run.phase = 'navigating'; run.deadlineAt = now() + LIMIT.navigationMs; });
    const destination = new URL(url);
    navigationIntent = { token, allowed: new Set([url]), lastUrl: url, effectiveOrigin: destination.origin, requestId: null, startedAt: now(), upgradeHostname: run.depth === 0 && url === run.runConfig.urls[run.plan[run.position]] && destination.protocol === 'http:' && destination.port === '' ? destination.hostname : null };
    const loaded = new Promise(resolve => { waitingLoad = { resolve, token }; });
    await effect(() => api.tabs.update(run.tabId, { url, active: true }), token);
    while (current(token) && waitingLoad !== null && now() < run.deadlineAt) {
      const sleeping = wait(Math.min(1000, run.deadlineAt - now()), token);
      await Promise.race([loaded, sleeping]); sleeping.cancel?.();
      checkClock(token);
      // Native completion can occur before an event-page listener resumes.
      if (current(token) && waitingLoad && committed) {
        const tab = await effect(() => api.tabs.get(run.tabId), token);
        if (tab.status === 'complete') { const frame = await effect(() => api.webNavigation.getFrame({ tabId: run.tabId, frameId: 0 }), token); if (frame?.documentId === committed.documentId && frame.url === committed.url) { waitingLoad.resolve(true); waitingLoad = null; } }
      }
    }
    assertCurrent(token); if (navigationFailure) { navigationFailure = false; waitingLoad = null; autosurfFail('navigation-error'); }
    if (waitingLoad || !committed) { waitingLoad = null; autosurfFail('navigation-timeout'); }
    await change(token, () => { run.phase = 'settling'; run.deadlineAt = now() + 1000; });
    await until(run.deadlineAt, token);
  }
  async function visit(url, token) {
    await navigate(url, token); assertCurrent(token);
    const random = createAutosurfVisitRandom(run.runConfig.seed, run.position, run.depth), landed = liveContext(token);
    const start = now(); activeVisit = { index: run.plan[run.position], origin: landed.origin, depth: run.depth, startedAt: start, scrolls: 0, hovers: 0 };
    const dwell = (run.runConfig.dwellMinSec + random.schedule() * (run.runConfig.dwellMaxSec - run.runConfig.dwellMinSec)) * 1000;
    const gapMs = (run.runConfig.gapMinSec + random.schedule() * (run.runConfig.gapMaxSec - run.runConfig.gapMinSec)) * 1000;
    await change(token, () => { run.phase = 'interacting'; run.deadlineAt = Math.min(run.runDeadlineAt, start + dwell); });
    let links = [], nextStep = start;
    while (current(token) && now() < run.deadlineAt) {
      const inspection = await driver.inspect(liveContext(token)); assertCurrent(token);
      if (inspection.hidden) autosurfFail('window-blurred');
      if (inspection.challenge) { await interrupt('challenge'); return null; }
      links = Array.isArray(inspection.links) ? inspection.links.slice(0, 32) : [];
      if (now() >= nextStep && (run.runConfig.scroll || run.runConfig.hover)) {
        const kind = run.runConfig.scroll && run.runConfig.hover ? random.behavior() < 0.7 ? 'scroll' : 'hover' : run.runConfig.scroll ? 'scroll' : 'hover';
        const counts = await driver.step(liveContext(token), { kind, random: random.behavior() }); assertCurrent(token);
        if (activeVisit) { activeVisit.scrolls += Math.max(0, Math.min(20, Number.isFinite(counts?.wheels) ? counts.wheels : 0)); activeVisit.hovers += Math.max(0, Math.min(20, Number.isFinite(counts?.hovers) ? counts.hovers : 0)); }
        nextStep = now() + 1800 + random.behavior() * 3200;
      }
      if (run.runConfig.metrics && metrics && now() - lastSample >= 10000) {
        if (run.samples.length >= LIMIT.samples) { await finish('result-limit'); return null; }
        const sample = validateSample(await metrics.sample(liveContext(token), driver)); assertCurrent(token);
        lastSample = now(); await change(token, () => { run.samples.push(sample); });
      }
      await wait(Math.min(1500, Math.max(0, run.deadlineAt - now())), token); checkClock(token);
    }
    assertCurrent(token);
    await change(token, () => { closeVisit('completed'); event('visit'); });
    return { links, origin: landed.origin, url: landed.url, gapMs, linkChoice: random.links() };
  }
  async function execute(token) {
    let failures = 0; await ensureWindow(token);
    while (current(token) && run.position < run.plan.length) {
      if (run.visits.length >= LIMIT.visits || run.events.length >= LIMIT.events || run.samples.length >= LIMIT.samples) { await finish('result-limit'); return; }
      const url = run.currentUrl ?? run.runConfig.urls[run.plan[run.position]];
      const attempt = now(); let visited;
      try { visited = await visit(url, token); } catch (error) {
        const code = autosurfSafeCode(error);
        if (!current(token) || !['navigation-error', 'navigation-timeout'].includes(code) || ++failures >= SKIPS_IN_A_ROW) throw error;
        // The site cannot be loaded: it is recorded as interrupted and the run goes on after the usual gap.
        const random = createAutosurfVisitRandom(run.runConfig.seed, run.position, run.depth), gapMs = (run.runConfig.gapMinSec + random.schedule() * (run.runConfig.gapMaxSec - run.runConfig.gapMinSec)) * 1000;
        await change(token, () => {
          const origin = new URL(url).origin;
          if (run.visits.length < LIMIT.visits) run.visits.push({ index: run.plan[run.position], origin, depth: run.depth, startedAt: attempt, endedAt: now(), durationMs: Math.max(0, now() - attempt), status: 'interrupted', scrolls: 0, hovers: 0 }); else run.truncated = true;
          event('error', code); run.position++; run.completed++; run.depth = 0; run.currentUrl = null; run.phase = 'gap'; run.deadlineAt = now() + gapMs;
        });
        // The unreachable site is closed: the tab goes back to a blank page, so that the browser's error page does not keep reloading it while the run waits.
        try { await effect(() => api.tabs.update(run.tabId, { url: 'about:blank' }), token); } catch (blankError) { if (!current(token)) throw blankError; }
        if (run.position >= run.plan.length) break;
        await until(run.deadlineAt, token); continue;
      }
      failures = 0; if (!current(token)) return;
      let next = null;
      if (run.depth < run.runConfig.depth && visited.links.length) {
        const choices = [...new Set(visited.links.flatMap(value => { try { const checked = validateAutosurfUrl(value, { discovered: true, origin: visited.origin }); return checked !== visited.url ? [checked] : []; } catch { return []; } }))];
        if (choices.length) next = choices[Math.floor(visited.linkChoice * choices.length)];
      }
      await change(token, () => { if (next) { run.depth++; run.currentUrl = next; } else { run.position++; run.completed++; run.depth = 0; run.currentUrl = null; } run.phase = 'gap'; run.deadlineAt = now() + visited.gapMs; });
      if (run.position >= run.plan.length) break;
      await until(run.deadlineAt, token);
    }
    if (current(token)) await finish('complete');
  }
  function launch() {
    if (runner || disposed || run.status !== 'running') return;
    const token = epoch;
    const job = execute(token).catch(async error => { if (current(token)) { try { await interrupt(autosurfSafeCode(error)); } catch {} } }).finally(() => { if (runner === job) runner = null; });
    runner = job;
  }
  function initialize() {
    if (initialization) return initialization;
    const job = (async () => {
    try {
      run = idleRun(); historicalReport = null; revision = 0;
      const saved = await storage.loadConfiguration(); if (disposed) return;
      configuration = saved === undefined || saved === null ? createDefaultAutosurfConfiguration() : validateAutosurfConfiguration(saved);
      const raw = await storage.loadCheckpoint();
      if (disposed) return;
      if (raw !== undefined && raw !== null) {
        const checked = validateAutosurfCheckpoint(raw); revision = checked.revision; run = checked.run; if (saved === undefined || saved === null) configuration = checked.configuration;
        const oldTabId = run.tabId;
        // A restored run is paused: nothing acts on its tab or window until an explicit Resume has checked, at the browser, that the tab is still the one it
        // created (ensureWindow). The window is kept so that Resume does not open a second one next to it.
        if (['running', 'paused'].includes(run.status)) { run.status = 'paused'; run.reason = 'restored'; run.deadlineAt = null; event('restore', 'restored'); }
        if (validId(oldTabId) && typeof api.debugger?.detach === 'function') {
          // Chrome can retain this extension's CDP attachment across worker
          // restarts. Releasing that attachment never attaches to a new target.
          if (physical) autosurfFail('storage-unavailable');
          const pending = Promise.resolve().then(() => api.debugger.detach({ tabId: oldTabId })).catch(() => {}); physical = pending;
          pending.then(() => { if (physical === pending) physical = null; });
          let timer; try { await Promise.race([pending, new Promise((_, reject) => { timer = schedule(() => reject(new Error('storage-unavailable')), LIMIT.nativeMs); })]); } finally { if (timer !== undefined) cancel(timer); }
        }
        if (disposed) return;
        await persist();
      } else if (storage.loadLastReport) { const report = await storage.loadLastReport(); if (disposed) return; if (report !== undefined && report !== null) { historicalReport = validateAutosurfReport(report); if (['running', 'paused'].includes(historicalReport.status)) { historicalReport.status = 'stopped'; historicalReport.reason = 'restored'; } } }
      await clearAlarm(); if (disposed) return;
      unavailable = false; initializationFailed = false; notify();
    } catch { if (disposed) return; unavailable = true; initializationFailed = true; historicalReport = null; run = idleRun(); run.status = 'error'; run.reason = 'storage-unavailable'; notify(); }
    })();
    initialization = job;
    job.then(() => { if (initialization === job) initialization = null; });
    return job;
  }
  const ready = initialize();
  async function command(op, payload) {
    const enteredInitialization = initialization;
    await ready; if (disposed) autosurfFail('inactive');
    // A read may retry a failed startup; it never reloads a newer running state.
    // A caller already waiting for initialization observes that attempt once.
    if (enteredInitialization) await enteredInitialization;
    else if (initialization) await initialization;
    else if (op === 'load' && initializationFailed && queued === 0 && !runner) await initialize();
    if (disposed) autosurfFail('inactive');
    if (op === 'load') return snapshot();
    if (op === 'export') return exportReport();
    if (initializationFailed) autosurfFail('storage-unavailable');
    if (!payload || payload.revision !== revision) autosurfFail('stale-revision');
    if (revision >= Number.MAX_SAFE_INTEGER - 1) autosurfFail('stale-revision');
    // Invalidate synchronously, before waiting behind a slow storage commit.
    if (op === 'clear' && run.status === 'running') autosurfFail('busy');
    let detached = null;
    if (op === 'pause' || op === 'stop' || op === 'clear') { invalidate(); metrics?.reset?.(); detached = detach(); void clearAlarm(); }
    const value = await serial(async () => {
      if (payload.revision !== revision) autosurfFail('stale-revision');
      if (op === 'save') {
        if (run.status === 'running') autosurfFail('busy');
        const next = validateAutosurfConfiguration(payload.configuration);
        try { await storage.saveConfiguration(next); } catch { autosurfFail('storage-unavailable'); }
        configuration = next; revision++; await persist(); return snapshot();
      }
      if (op === 'clear') { if (run.status === 'running') autosurfFail('busy'); const owned = forget(); historicalReport = null; run = idleRun(); revision++; try { await persist(); } finally { await detached; await closeOwned(owned); } return snapshot(); }
      if (op === 'pause') { if (run.status !== 'running') autosurfFail('inactive'); closeVisit('interrupted'); run.status = 'paused'; run.reason = 'user-paused'; run.deadlineAt = null; revision++; event('pause', run.reason); await persist(); return snapshot(); }
      if (op === 'stop') { if (!['running', 'paused'].includes(run.status)) autosurfFail('inactive'); closeVisit('interrupted'); run.status = 'stopped'; run.reason = 'user-stopped'; run.phase = null; run.deadlineAt = null; const owned = forget(); revision++; event('stop', run.reason); try { await persist(); } finally { await detached; await closeOwned(owned); } return snapshot(); }
      if (!['start', 'resume'].includes(op)) autosurfFail('invalid-input');
      if (!supported()) autosurfFail('unsupported'); if (unavailable) autosurfFail('storage-unavailable'); if (physical || runner) autosurfFail('busy');
      if (op === 'start') {
        if (run.status === 'running') autosurfFail('busy'); if (!configuration.urls.length) autosurfFail('invalid-input');
        // A window a paused run left behind is closed before the new run opens its own: runs never share or stack windows.
        const previous = forget(); if (previous.tabId !== null) await closeOwned(previous);
        const start = now(), bytes = new Uint8Array(12); (env.crypto ?? globalThis.crypto).getRandomValues(bytes); historicalReport = null;
        run = { ...idleRun(), status: 'running', phase: 'opening', runId: Array.from(bytes, value => value.toString(16).padStart(2, '0')).join(''), startedAt: start, runDeadlineAt: start + configuration.maxRunMinutes * 60000, plan: createAutosurfPlan(configuration), runConfig: clone(configuration) }; event('start');
      } else {
        if (run.status !== 'paused' || run.position >= run.plan.length) autosurfFail('inactive');
        if (now() >= run.runDeadlineAt) autosurfFail('run-limit');
        run.status = 'running'; run.reason = null; run.phase = 'opening'; event('resume');
      }
      revision++; epoch++; metrics?.reset?.(); lastClock = now(); lastSample = now() - 10000;
      await persist();
      try { await watchdog(); } catch { invalidate(); run.status = 'paused'; run.reason = 'native-error'; run.deadlineAt = null; event('pause', 'native-error'); await persist(); autosurfFail('native-error'); }
      return snapshot();
    });
    if (['start', 'resume'].includes(op) && run.status === 'running') launch(); return value;
  }
  function exportReport() { if (historicalReport) return clone(historicalReport); const value = snapshot(), settings = run.runConfig ?? configuration; return { format: 'detect.expert.autosurf', formatVersion: 1, generatedAt: now(), runId: value.runId, status: value.status, reason: value.reason, configuration: { ...settings, urls: settings.urls.map(url => new URL(url).origin) }, progress: value.progress, visits: value.visits, events: value.events, samples: value.samples, truncated: value.truncated }; }
  function nativePause(reason, keep = false) { if (['running', 'paused'].includes(run.status)) void interrupt(reason, keep).catch(() => {}); }
  function ownFrame(details) { return run.status === 'running' && details.tabId === run.tabId && details.frameId === 0; }
  listen(api.webNavigation?.onBeforeNavigate, details => {
    if (!ownFrame(details) || run.phase === 'opening') return;
    if (run.phase === 'navigating' && navigationIntent && errorPage(details.url)) { loadFailed(); return; }
    if (run.phase === 'gap' && details.url === 'about:blank') return;
    if (run.phase !== 'navigating' || !navigationIntent || !navigationIntent.allowed.has(details.url)) nativePause('manual-navigation');
  });
  listen(api.webNavigation?.onCommitted, details => {
    if (!ownFrame(details)) return;
    if (run.phase === 'opening' && run.tabId === openingBlankTab && details.url === 'about:blank') return;
    if (run.phase === 'navigating' && navigationIntent && (navigationFailure || errorPage(details.url))) { loadFailed(); return; }
    if (run.phase === 'gap' && details.url === 'about:blank') return;
    if (run.phase !== 'navigating' || !run.currentUrl || !documentId(details.documentId)) { nativePause('manual-navigation'); return; }
    try { const url = validateAutosurfUrl(details.url), origin = new URL(url).origin; if (origin !== navigationIntent?.effectiveOrigin) { nativePause('external-navigation'); return; } if (url !== navigationIntent.lastUrl || !navigationIntent.allowed.has(url)) { nativePause('manual-navigation'); return; } committed = { documentId: details.documentId, origin, url }; currentOrigin = origin; } catch { nativePause('external-navigation'); }
  });
  listen(api.webNavigation?.onCompleted, details => { if (ownFrame(details) && waitingLoad && committed?.documentId === details.documentId) { const load = waitingLoad; waitingLoad = null; load.resolve(true); } });
  listen(api.webNavigation?.onErrorOccurred, details => {
    if (!ownFrame(details)) return;
    if (run.phase === 'navigating' && navigationIntent?.allowed.has(details.url)) { loadFailed(); return; }
    // A replaced navigation (the browser's own retry of the previous dead page, cancelled when ours started) and anything that arrives between two sites
    // belong to the previous site, not to this one.
    if (details.error === 'net::ERR_ABORTED' || run.phase === 'gap') return;
    nativePause('navigation-error');
  });
  listen(api.webNavigation?.onHistoryStateUpdated, details => { if (ownFrame(details) && run.phase !== 'navigating') nativePause('manual-navigation', true); });
  listen(api.webNavigation?.onReferenceFragmentUpdated, details => { if (ownFrame(details) && run.phase !== 'navigating') nativePause('manual-navigation', true); });
  listen(api.tabs?.onRemoved, tabId => { if (tabId === run.tabId) nativePause('tab-closed'); });
  listen(api.tabs?.onReplaced, (_added, removed) => { if (removed === run.tabId) nativePause('tab-replaced'); });
  listen(api.tabs?.onUpdated, (tabId, change) => { if (tabId === run.tabId && change.discarded === true) nativePause('tab-discarded'); });
  listen(api.tabs?.onActivated, details => { if (details.windowId === run.windowId && details.tabId !== run.tabId) nativePause('window-blurred'); });
  listen(api.windows?.onFocusChanged, windowId => { if (run.windowId !== null && windowId !== run.windowId && (run.phase !== 'opening' || windowId !== -1)) nativePause('window-blurred'); });
  listen(api.permissions?.onRemoved, removed => {
    if ((removed.permissions ?? []).some(value => ['debugger', 'scripting', 'tabs'].includes(value) || run.runConfig?.metrics === true && ['system.cpu', 'system.memory'].includes(value)) || (removed.origins ?? []).length > 0) nativePause('permission-revoked');
  });
  listen(api.alarms?.onAlarm, alarm => { if (alarm.name !== AUTOSURF_ALARM) return; void ready.then(() => { if (run.status !== 'running') { void clearAlarm(); return; } checkClock(epoch); wakeWait?.(); if (!runner) launch(); }); });
  listen(api.webRequest?.onBeforeRequest, details => {
    if (run.status !== 'running' || run.phase !== 'navigating' || details.tabId !== run.tabId || details.type !== 'main_frame' || !navigationIntent || finite(details.timeStamp) && details.timeStamp < navigationIntent.startedAt) return;
    if (details.url === navigationIntent.lastUrl && navigationIntent.allowed.has(details.url) && navigationIntent.requestId === null && typeof details.requestId === 'string') navigationIntent.requestId = details.requestId;
  }, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] });
  listen(api.webRequest?.onBeforeRedirect, details => {
    if (run.status !== 'running' || run.phase !== 'navigating' || details.tabId !== run.tabId || details.type !== 'main_frame' || !navigationIntent || typeof details.requestId !== 'string' || details.requestId !== navigationIntent.requestId || details.url !== navigationIntent.lastUrl) return;
    try {
      const url = validateAutosurfUrl(details.redirectUrl), target = new URL(url), source = new URL(navigationIntent.lastUrl);
      const upgrade = navigationIntent.upgradeHostname !== null && source.protocol === 'http:' && source.port === '' && target.protocol === 'https:' && target.port === '' && source.hostname === navigationIntent.upgradeHostname && target.hostname === navigationIntent.upgradeHostname;
      if (target.origin !== navigationIntent.effectiveOrigin && !upgrade || navigationIntent.allowed.size >= 8) { nativePause('external-navigation'); return; }
      if (upgrade) navigationIntent.upgradeHostname = null;
      navigationIntent.effectiveOrigin = target.origin; navigationIntent.lastUrl = url; navigationIntent.allowed.add(url);
    } catch { nativePause('external-navigation'); }
  }, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] });
  listen(api.webRequest?.onHeadersReceived, details => {
    if (run.status !== 'running' || details.tabId !== run.tabId || details.type !== 'main_frame') return;
    if (details.documentId && committed && details.documentId !== committed.documentId || details.requestId && navigationIntent?.requestId && details.requestId !== navigationIntent.requestId || finite(details.timeStamp) && navigationIntent && details.timeStamp < navigationIntent.startedAt) return;
    if (details.statusCode === 403) nativePause('http-403'); else if (details.statusCode === 429) nativePause('http-429');
    else if ((details.responseHeaders ?? []).slice(0, 256).some(header => typeof header.name === 'string' && header.name.toLowerCase() === 'cf-mitigated' && header.value === 'challenge')) nativePause('challenge');
  }, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] }, ['responseHeaders']);
  return { ready, command, snapshot, interrupt, exportReport, debuggerDetached: details => { if (details?.tabId === run.tabId) nativePause('debugger-detached'); }, async dispose() { if (disposed) return; disposed = true; invalidate(); for (const remove of listeners.splice(0)) remove(); await detach(); await clearAlarm(); } };
}
