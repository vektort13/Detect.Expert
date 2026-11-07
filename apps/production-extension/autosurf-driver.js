// ADR-075: a bounded, owned-tab CDP driver. No arbitrary protocol/page command channel.
import { inspectAutosurfPage } from './autosurf-page.js';
import { validateAutosurfUrl } from './autosurf-shared.js';

export const AUTOSURF_DRIVER_LIMITS = Object.freeze({ timeoutMs: 4000, maxMoves: 24, maxWheels: 4, maxLinks: 32, maxHoverPoints: 8 });
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const failure = code => Object.assign(new Error(code), { code });
const current = check => { try { return typeof check === 'function' && check() === true; } catch { return false; } };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const unit = value => finite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
function urlValue(raw) { try { if (typeof raw !== 'string' || raw.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(raw)) return null; const url = new URL(raw); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null; } catch { return null; } }
function discoveredUrl(raw, origin) {
  try {
    const checked = validateAutosurfUrl(raw, { discovered: true, origin }), url = new URL(checked); let path = url.pathname;
    for (let decode = 0; decode < 3 && /%[\da-f]{2}/i.test(path); ++decode) path = decodeURIComponent(path);
    if (/[\u0000-\u0020\u007f-\u009f\u202a-\u202e\u2066-\u2069\\?#%]/u.test(path) || /(?:^|[\/_\-.])(?:log[-_]?(?:in|out|off)|sign[-_]?(?:in|out|up)|register|registration|delete|remove|destroy|unsubscribe|checkout|payment|pay|purchase|buy|order|cart|basket|admin|account|auth|oauth|authorize|confirm|activate|reset|download|export|import|api|выход|удалить|оплата|купить|заказ|корзина|вход|регистрация)(?:$|[\/_\-.\d])/i.test(path) || /\.(?:pdf|zip|rar|7z|exe|msi|dmg|pkg|apk|iso|tar|gz|mp[34]|webm|mov|avi|wav|ogg|png|jpe?g|gif|webp|svg|woff2?|ttf|csv|xlsx?|docx?|pptx?)(?:$|\/)/i.test(path)) return null;
    return checked;
  } catch { return null; }
}
function readInspection(value, origin) {
  const viewport = own(value, 'viewport'), scroll = own(value, 'scroll');
  const width = own(viewport, 'width'), height = own(viewport, 'height'), x = own(scroll, 'x'), y = own(scroll, 'y'), maxY = own(scroll, 'maxY');
  if (![width, height].every(n => finite(n) && n >= 0 && n <= 16384) || ![x, y, maxY].every(n => finite(n) && n >= 0 && n <= 10000000) || typeof own(value, 'hidden') !== 'boolean') return null;
  const sourcePoints = own(value, 'hoverPoints'), sourceLinks = own(value, 'links'), challenge = own(value, 'challenge');
  if (!Array.isArray(sourcePoints) || sourcePoints.length > 8 || !Array.isArray(sourceLinks) || sourceLinks.length > 32 || ![null, 'visible-challenge'].includes(challenge)) return null;
  const hoverPoints = [], links = [];
  for (const source of sourcePoints) { const px = own(source, 'x'), py = own(source, 'y'); if (!finite(px) || !finite(py) || px < 0 || py < 0 || px >= width || py >= height) return null; hoverPoints.push({ x: px, y: py }); }
  for (const raw of sourceLinks) { const url = discoveredUrl(raw, origin); if (!url) return null; if (!links.includes(url)) links.push(url); }
  return { viewport: { width, height }, scroll: { x, y, maxY }, hoverPoints, links, challenge, hidden: own(value, 'hidden') };
}

/** context={tabId,documentId,origin,url?,isCurrent}; every effect requires this current-document fence. */
export function createAutosurfDriver(api, { now = Date.now, onDetach = () => {} } = {}) {
  let owned = null, pendingAttach = null, physical = null, logical = null, disposed = false;
  const supported = () => !disposed && typeof api?.debugger?.attach === 'function' && typeof api?.debugger?.detach === 'function' && typeof api?.debugger?.sendCommand === 'function' && typeof api?.scripting?.executeScript === 'function' && typeof api?.webNavigation?.getFrame === 'function';
  const valid = (context, record = owned) => supported() && record !== null && record === owned && record.valid && context?.tabId === record.tabId && current(context?.isCurrent);
  function native(operation, check, onSettled = null) {
    if (physical) return Promise.reject(failure('autosurf-busy'));
    if (!current(check)) return Promise.reject(failure('autosurf-stale'));
    const slot = { expired: false };
    physical = slot;
    const job = Promise.resolve().then(() => { if (!current(check)) throw failure('autosurf-stale'); return operation(); });
    const settle = (success, result) => {
      if (physical === slot) physical = null;
      try { onSettled?.(success, result, slot.expired); } catch { /* cleanup must not alter browser completion */ }
      queueMicrotask(flushCleanup);
    };
    job.then(result => settle(true, result), error => settle(false, error));
    let timer;
    return Promise.race([job, new Promise((_, reject) => { timer = setTimeout(() => { slot.expired = true; reject(failure('autosurf-timeout')); }, AUTOSURF_DRIVER_LIMITS.timeoutMs); })])
      .catch(error => { throw error?.code?.startsWith('autosurf-') ? error : failure('autosurf-native-error'); }).finally(() => clearTimeout(timer));
  }
  function flushCleanup() {
    const record = owned;
    if (physical || !record || !record.cleanup || record.cleanupAttempted) return;
    record.cleanupAttempted = true;
    const job = native(() => api.debugger.detach({ tabId: record.tabId }), () => owned === record, success => {
      if (success && owned === record) owned = null;
    });
    record.cleanupPromise = job.then(() => true, () => false);
  }
  async function exclusive(kind, action) {
    if (logical) throw failure('autosurf-busy');
    const token = { kind }; logical = token;
    try { return await action(); } finally { if (logical === token) logical = null; }
  }
  async function fence(context, record = owned) {
    if (!valid(context, record) || typeof context.documentId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(context.documentId)) throw failure('autosurf-stale');
    const origin = urlValue(context.origin), expected = context.url === undefined ? null : urlValue(context.url);
    if (!origin || origin.origin !== context.origin || context.url !== undefined && (!expected || expected.origin !== context.origin)) throw failure('autosurf-stale');
    const frame = await native(() => api.webNavigation.getFrame({ tabId: context.tabId, frameId: 0, documentId: context.documentId }), () => valid(context, record));
    const url = urlValue(own(frame, 'url'));
    if (!valid(context, record) || own(frame, 'documentId') !== context.documentId || own(frame, 'documentLifecycle') !== 'active' || own(frame, 'errorOccurred') === true || !url || url.origin !== context.origin || expected && url.href !== expected.href) throw failure('autosurf-stale');
  }
  async function inspectInternal(context, record) {
    await fence(context, record);
    const result = await native(() => api.scripting.executeScript({ target: { tabId: context.tabId, documentIds: [context.documentId] }, world: 'ISOLATED', func: inspectAutosurfPage, args: [context.origin, context.url ?? null] }), () => valid(context, record));
    if (!valid(context, record) || !Array.isArray(result) || result.length !== 1 || own(result[0], 'documentId') !== context.documentId || own(result[0], 'frameId') !== 0) throw failure('autosurf-stale');
    const inspection = readInspection(own(result[0], 'result'), context.origin);
    if (!inspection) throw failure('autosurf-invalid-result');
    return inspection;
  }
  async function command(context, method, params, record) {
    if (!valid(context, record)) throw failure('autosurf-stale');
    const result = await native(() => api.debugger.sendCommand({ tabId: context.tabId }, method, params), () => valid(context, record));
    if (!valid(context, record)) throw failure('autosurf-stale');
    return result;
  }
  const detached = (source, reason) => {
    const tabId = own(source, 'tabId'), record = owned;
    if (!integer(tabId)) return;
    if (pendingAttach?.tabId === tabId) pendingAttach.cancelled = true;
    if (!record || record.tabId !== tabId) return;
    owned = null;
    if (!record.cleanup) { try { onDetach({ tabId, reason: reason === 'target_closed' ? 'target-closed' : 'debugger-detached' }); } catch {} }
  };
  api?.debugger?.onDetach?.addListener(detached);
  return {
    supported,
    attach(tabId, isCurrent) {
      return exclusive('attach', async () => {
        if (!supported()) throw failure('autosurf-unsupported');
        if (!integer(tabId) || !current(isCurrent)) throw failure('autosurf-stale');
        if (owned || pendingAttach) throw failure('autosurf-busy');
        const attempt = { tabId, cancelled: false }; pendingAttach = attempt;
        try {
          await native(() => api.debugger.attach({ tabId }, '1.3'), () => pendingAttach === attempt && !attempt.cancelled && current(isCurrent), (success, _, expired) => {
            if (pendingAttach === attempt) pendingAttach = null;
            if (!success) return;
            const invalid = expired || attempt.cancelled || !current(isCurrent) || disposed;
            owned = { tabId, valid: !invalid, cleanup: invalid, cleanupAttempted: false, pointer: null, performance: false };
          });
          if (!owned || owned.tabId !== tabId || !owned.valid || !current(isCurrent)) { await this.detach(tabId); throw failure('autosurf-stale'); }
          return { attached: true };
        } catch (error) { if (!physical && pendingAttach === attempt) pendingAttach = null; throw error; }
      });
    },
    async detach(tabId) {
      if (pendingAttach?.tabId === tabId) pendingAttach.cancelled = true;
      const record = owned;
      if (!record || record.tabId !== tabId) return false;
      record.valid = false; record.cleanup = true;
      if (!physical) { record.cleanupAttempted = false; flushCleanup(); }
      return record.cleanupPromise ?? false;
    },
    inspect(context) { return exclusive('inspect', () => inspectInternal(context, owned)); },
    step(context, { kind, random = 0.5 } = {}) {
      return exclusive('step', async () => {
        if (kind !== 'hover' && kind !== 'scroll') throw failure('autosurf-invalid-step');
        const record = owned, inspection = await inspectInternal(context, record);
        if (inspection.hidden) throw failure('autosurf-hidden');
        if (inspection.challenge) throw failure('autosurf-challenge');
        const counts = { moves: 0, wheels: 0, hovers: 0 }, u = unit(random), { width, height } = inspection.viewport;
        if (!width || !height) return counts;
        const target = kind === 'hover' ? inspection.hoverPoints[Math.floor(u * inspection.hoverPoints.length)] : { x: Math.min(width - 1, Math.max(1, width * (0.4 + u * 0.2))), y: Math.min(height - 1, Math.max(1, height * 0.55)) };
        if (!target) return counts;
        const from = record.pointer ?? { x: width / 2, y: height / 2 }, distance = Math.hypot(target.x - from.x, target.y - from.y);
        const count = Math.min(AUTOSURF_DRIVER_LIMITS.maxMoves, Math.max(2, Math.ceil(distance / 30))), bend = Math.min(80, distance * 0.15) * (u < 0.5 ? -1 : 1);
        const start = now();
        for (let i = 1; i <= count; ++i) {
          if (!valid(context, record) || !finite(now()) || now() < start || now() - start > 2500) throw failure('autosurf-stale');
          const t = i / count, s = 10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5, curve = 4 * s * (1 - s) * bend;
          const x = Math.min(width - 1, Math.max(1, from.x + (target.x - from.x) * s + (distance ? -(target.y - from.y) / distance * curve : 0)));
          const y = Math.min(height - 1, Math.max(1, from.y + (target.y - from.y) * s + (distance ? (target.x - from.x) / distance * curve : 0)));
          await command(context, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 }, record);
          record.pointer = { x, y }; ++counts.moves;
          if (i < count) await wait(12 + Math.floor(u * 8));
        }
        if (kind === 'hover') { counts.hovers = 1; return counts; }
        const remaining = inspection.scroll.maxY - inspection.scroll.y, upward = inspection.scroll.y > height && u < 0.12;
        const total = upward ? -Math.min(inspection.scroll.y, height * 0.35) : Math.max(0, Math.min(remaining, height * (0.35 + u * 0.4)));
        if (Math.abs(total) < 1) return counts;
        for (let i = 0; i < AUTOSURF_DRIVER_LIMITS.maxWheels; ++i) {
          await command(context, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: target.x, y: target.y, deltaX: 0, deltaY: total / AUTOSURF_DRIVER_LIMITS.maxWheels }, record);
          ++counts.wheels;
          if (i + 1 < AUTOSURF_DRIVER_LIMITS.maxWheels) await wait(25 + Math.floor(u * 20));
        }
        return counts;
      });
    },
    sample(context) {
      return exclusive('sample', async () => {
        const record = owned; await fence(context, record);
        if (!record.performance) { await command(context, 'Performance.enable', {}, record); record.performance = true; }
        const value = await command(context, 'Performance.getMetrics', {}, record), source = own(value, 'metrics');
        if (!Array.isArray(source) || source.length > 128) throw failure('autosurf-invalid-result');
        let jsHeapBytes = null, taskDurationMs = null;
        for (const entry of source) {
          const name = own(entry, 'name');
          if (name !== 'JSHeapUsedSize' && name !== 'TaskDuration') continue;
          const number = own(entry, 'value');
          if (!finite(number) || number < 0) continue;
          if (name === 'JSHeapUsedSize' && number <= 1099511627776) jsHeapBytes = Math.round(number);
          if (name === 'TaskDuration' && number <= 31536000) taskDurationMs = Math.round(number * 1000);
        }
        return { jsHeapBytes, taskDurationMs };
      });
    },
    async dispose() { disposed = true; api?.debugger?.onDetach?.removeListener(detached); if (pendingAttach) pendingAttach.cancelled = true; if (owned) await this.detach(owned.tabId); },
  };
}
