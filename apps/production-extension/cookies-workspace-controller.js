// ADR-069: explicit cookie management stays in the exact owned Options document.
import { COOKIE_TRANSFER_LIMITS, cookieIdentity, cookieSignature, normalizeNativeCookie, validateCookieRecord, parseCookieImport, exportCookieRecords, cookieSetDetails } from './cookie-transfer-core.js';

const MAX_RECORDS = COOKIE_TRANSFER_LIMITS.cookies, MAX_BYTES = COOKIE_TRANSFER_LIMITS.bytes, MAX_STORES = COOKIE_TRANSFER_LIMITS.stores;
const SAFE_CODES = new Set(['unauthorized', 'inactive', 'busy', 'timeout', 'unsupported', 'permission-required', 'permission-denied', 'invalid-input', 'invalid-json', 'invalid-format', 'unsupported-version', 'invalid-cookie', 'duplicate-key', 'duplicate-cookie', 'duplicate-store', 'duplicate-target', 'target-required', 'unknown-store', 'stale', 'conflict', 'ambiguous', 'not-applied', 'capacity', 'unsupported-partition', 'unsupported-first-party-domain', 'unsupported-samesite', 'unsupported-format', 'lossy-export', 'identity-change', 'expired', 'operation-failed', 'invalid-domain', 'invalid-path', 'invalid-expiration', 'invalid-samesite', 'invalid-prefix', 'limit-exceeded', 'invalid-store', 'unsupported-field']);
export class CookiesWorkspaceError extends Error {
  constructor(code) { const safe = SAFE_CODES.has(code) ? code : 'operation-failed'; super(safe); this.name = 'CookiesWorkspaceError'; this.code = safe; }
}
const fail = code => { throw new CookiesWorkspaceError(code); };
const data = (value, key) => { const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key) : undefined; return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined; };
const safeError = error => { const code = data(error, 'code'), result = new CookiesWorkspaceError(SAFE_CODES.has(code) ? code : 'operation-failed'); if (data(error, 'outcome') === 'unknown') result.outcome = 'unknown'; return result; };
const clone = value => value === null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(clone) : Object.fromEntries(Object.keys(value).map(key => [key, clone(value[key])]));
const metadata = record => Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'value').map(([key, value]) => [key, clone(value)]));
const bytes = record => new TextEncoder().encode(JSON.stringify(record)).byteLength;
function plain(value, allowed = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid-input');
  const result = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key) || allowed && !allowed.includes(key) || !descriptor || !Object.hasOwn(descriptor, 'value')) fail('invalid-input');
    result[key] = descriptor.value;
  }
  return result;
}
function domainFilter(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > 253 || value !== value.trim()) fail('invalid-input');
  const host = value.replace(/^\./, '');
  let parsed; try { parsed = new URL('https://' + host + '/'); } catch { fail('invalid-input'); }
  if (parsed.hostname !== host.toLowerCase() || parsed.port || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) fail('invalid-input');
  return parsed.hostname;
}
function ownOptions(api, env) {
  try {
    const expected = new URL(api.runtime.getURL('options.html')), actual = new URL(env.location.href), win = env.window ?? env;
    return win.top === win && ['chrome-extension:', 'moz-extension:'].includes(expected.protocol) && expected.host !== '' && actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname && !actual.username && !actual.password;
  } catch { return false; }
}
const isExpired = (record, now) => !record.session && record.expirationDate <= now / 1000;
function selectedRows(rows, ids) {
  if (ids === null || ids === undefined) return [...rows];
  if (!Array.isArray(ids) || ids.length > MAX_RECORDS || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) fail('invalid-input');
  const byId = new Map(rows.map(row => [row.id, row]));
  return ids.map(id => { const row = byId.get(id); if (!row) fail('stale'); return row; });
}
const sameExceptExpiry = (expected, actual) => cookieSignature({ ...expected, expirationDate: actual.expirationDate }) === cookieSignature(actual);

export function createCookiesWorkspaceController(browserApi = globalThis.chrome, { env = globalThis, onInvalidate = () => {}, deadlineMs = 5000, now = () => Date.now() } = {}) {
  const nativeBrowser = env.browser;
  const api = nativeBrowser?.runtime?.id && nativeBrowser.runtime.id === browserApi?.runtime?.id ? nativeBrowser : browserApi;
  const browser = typeof api?.runtime?.getBrowserInfo === 'function' ? 'firefox' : 'chrome';
  let capabilities = Object.freeze({ partitionKey: true, hasCrossSiteAncestor: browser === 'chrome', firstPartyDomain: browser === 'firefox', unspecifiedSameSite: browser === 'chrome' }), firefoxCapabilitiesChecked = false;
  let active = true, disposed = false, pageHidden = env.document?.visibilityState === 'hidden', epoch = 0, sequence = 0, lock = null, snapshot = null, preview = null, undoRecords = [], knownStores = [];
  const notify = reason => { try { onInvalidate({ reason }); } catch { /* UI callbacks do not authorize native calls. */ } };
  function check(task = null) {
    if (!ownOptions(api, env)) fail('unauthorized');
    if (!active || disposed || pageHidden || env.document?.visibilityState === 'hidden') fail('inactive');
    if (task && (task.epoch !== epoch || task.cancelled)) fail(task.reason ?? 'stale');
  }
  function erase(reason) { ++epoch; snapshot = null; preview = null; undoRecords = []; knownStores = []; notify(reason); }
  async function call(task, target, method, args = []) {
    check(task); if (typeof target?.[method] !== 'function') fail('unsupported');
    let physical;
    try { physical = Promise.resolve(Reflect.apply(target[method], target, args)); } catch (error) { throw safeError(error); }
    task.pending.add(physical);
    physical.then(() => task.pending.delete(physical), () => task.pending.delete(physical));
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { task.cancelled = true; task.reason = 'timeout'; reject(new CookiesWorkspaceError('timeout')); }, deadlineMs); });
    try { const result = await Promise.race([physical, timeout]); check(task); return result; }
    catch (error) { throw safeError(error); }
    finally { clearTimeout(timer); }
  }
  function run(execute) {
    try { check(); if (lock) fail('busy'); } catch (error) { return Promise.reject(safeError(error)); }
    let releasePhysical;
    const task = { epoch, pending: new Set(), cancelled: false, reason: null, released: new Promise(resolve => { releasePhysical = resolve; }) }; lock = task;
    // Execute synchronously until the first await, retaining a native permission user gesture.
    let physical; try { physical = Promise.resolve(execute(task)); } catch (error) { physical = Promise.reject(error); }
    return physical.catch(error => { throw safeError(error); }).finally(() => {
      const release = () => { if (lock === task) lock = null; releasePhysical(); };
      if (task.pending.size) Promise.allSettled([...task.pending]).then(release); else release();
    });
  }
  function mutate(execute) {
    try { check(); if (lock) fail('busy'); } catch (error) { return Promise.reject(safeError(error)); }
    const manager = env.navigator?.locks;
    if (typeof manager?.request !== 'function') return run(execute);
    let deliver, reject;
    const result = new Promise((resolve, failure) => { deliver = resolve; reject = failure; });
    try {
      // Share the write mutex across our Options documents. Browser/network
      // writers remain external and are handled by the fresh signature checks.
      const native = Reflect.apply(manager.request, manager, ['detect.expert/cookies-write/v1', { mode: 'exclusive', ifAvailable: true }, async granted => {
        if (!granted) { reject(new CookiesWorkspaceError('busy')); return; }
        const operation = run(execute), owner = lock;
        try { deliver(await operation); } catch (error) { reject(safeError(error)); }
        // A timeout reaches the UI immediately; the shared native lock stays
        // held until the unabortable physical cookie call has actually settled.
        if (owner) await owner.released;
      }]);
      Promise.resolve(native).catch(error => reject(safeError(error)));
    } catch (error) { reject(safeError(error)); }
    return result;
  }
  async function nativeAccess(task) {
    check(task);
    let manifest; try { manifest = api.runtime.getManifest(); } catch { fail('unsupported'); }
    if (![...(manifest.permissions ?? []), ...(manifest.optional_permissions ?? [])].includes('cookies') || typeof api.permissions?.contains !== 'function') return { status: 'unsupported', stores: [], capabilities, browser };
    if (!await call(task, api.permissions, 'contains', [{ permissions: ['cookies'] }])) return { status: 'permission-required', stores: [], capabilities, browser };
    // Optional APIs can be absent from the namespace until their permission is granted.
    if (!['getAll', 'getAllCookieStores', 'set'].every(method => typeof api.cookies?.[method] === 'function')) return { status: 'unsupported', stores: [], capabilities, browser };
    if (browser === 'firefox' && !firefoxCapabilitiesChecked) {
      const info = await call(task, api.runtime, 'getBrowserInfo'), version = data(info, 'version');
      // Native Firefox 138.0.4 fixtures verify both ancestor identities. Older
      // versions remain conservative; this check reads no cookies or devices.
      const major = typeof version === 'string' && /^\d+(?:\.|$)/u.test(version) ? Number(version.split('.')[0]) : 0;
      capabilities = Object.freeze({ ...capabilities, hasCrossSiteAncestor: Number.isSafeInteger(major) && major >= 138, unspecifiedSameSite: Number.isSafeInteger(major) && major >= 140 });
      firefoxCapabilitiesChecked = true;
    }
    const native = await call(task, api.cookies, 'getAllCookieStores');
    if (!Array.isArray(native) || native.length > MAX_STORES) fail('capacity');
    const stores = [], seen = new Set();
    for (const store of native) {
      const id = data(store, 'id');
      if (typeof id !== 'string' || !id || id.length > 256 || seen.has(id)) fail('operation-failed');
      // Incognito is disabled by the production manifest; private stores are never admitted.
      if (/incognito|private/i.test(id) || browser === 'chrome' && id === '1') continue;
      seen.add(id); stores.push({ id });
    }
    knownStores = stores.map(store => store.id);
    return { status: 'ready', stores, capabilities, browser };
  }
  async function requireAccess(task, storeIds = []) {
    const access = await nativeAccess(task); if (access.status !== 'ready') fail(access.status);
    if (storeIds.some(id => typeof id !== 'string' || !knownStores.includes(id))) fail('unknown-store');
    return access;
  }
  const permissionOrigin = record => new URL(cookieSetDetails(record, { storeId: record.storeId, browser, capabilities }).url).origin + '/*';
  async function requireHosts(task, records) {
    const origins = [...new Set(records.map(permissionOrigin))];
    for (let index = 0; index < origins.length; index += 128) if (!await call(task, api.permissions, 'contains', [{ origins: origins.slice(index, index + 128) }])) fail('permission-required');
  }
  const query = record => ({ storeId: record.storeId, domain: record.domain.replace(/^\./, ''), name: record.name, path: record.path,
    ...(record.partitionKey ? { partitionKey: { topLevelSite: record.partitionKey.topLevelSite, ...(record.partitionKey.hasCrossSiteAncestor === null ? {} : { hasCrossSiteAncestor: record.partitionKey.hasCrossSiteAncestor }) } } : {}),
    ...(browser === 'firefox' ? { firstPartyDomain: record.firstPartyDomain ?? '' } : {}) });
  function normalized(source, storeId) {
    if (!Array.isArray(source) || source.length > MAX_RECORDS) fail('capacity');
    return source.map(raw => { if (data(raw, 'storeId') !== undefined && data(raw, 'storeId') !== storeId) fail('ambiguous'); return normalizeNativeCookie(raw, { browser, storeId }); });
  }
  function targetRecord(input) {
    const record = validateCookieRecord(input);
    if (capabilities.hasCrossSiteAncestor && record.partitionKey?.hasCrossSiteAncestor === null) fail('unsupported-partition');
    if (browser === 'firefox' && record.firstPartyDomain === null) record.firstPartyDomain = '';
    if (browser === 'chrome' && record.firstPartyDomain === '') record.firstPartyDomain = null;
    cookieSetDetails(record, { storeId: record.storeId, browser, capabilities });
    return record;
  }
  async function matches(task, record) {
    const source = await call(task, api.cookies, 'getAll', [query(record)]), identity = cookieIdentity(record);
    const candidates = normalized(source, record.storeId).filter(item => cookieIdentity(item) === identity);
    if (candidates.length > 1) fail('ambiguous');
    return candidates[0] ?? null;
  }
  async function fresh(task, record, { absent = false } = {}) {
    const current = await matches(task, record);
    if (absent ? current !== null : !current || cookieSignature(current) !== cookieSignature(record)) fail('conflict');
    return current;
  }
  function rowFor(id) { check(); const row = snapshot?.records.find(row => row.id === id); if (!row) fail('stale'); return row; }
  function expire(record) { return { ...record, session: false, expirationDate: 1 }; }
  async function write(task, record, before) {
    targetRecord(record);
    await fresh(task, before ?? record, { absent: before === null });
    try {
      await call(task, api.cookies, 'set', [cookieSetDetails(record, { storeId: record.storeId, browser, capabilities })]);
      const actual = await matches(task, record);
      if (!actual) fail('not-applied');
      const exact = cookieSignature(record) === cookieSignature(actual), adjusted = !exact && !record.session && sameExceptExpiry(record, actual);
      return { before, after: actual, adjusted, mismatch: !exact && !adjusted };
    } catch (error) { const failure = safeError(error); failure.outcome = 'unknown'; throw failure; }
  }
  async function deleteRecord(task, record) {
    await fresh(task, record);
    try {
      await call(task, api.cookies, 'set', [cookieSetDetails(expire(record), { storeId: record.storeId, browser, capabilities })]);
      const actual = await matches(task, record);
      return { before: record, after: actual, adjusted: false, mismatch: actual !== null };
    } catch (error) { const failure = safeError(error); failure.outcome = 'unknown'; throw failure; }
  }
  const result = () => ({ changed: false, applied: 0, succeeded: 0, adjusted: 0, skipped: 0, failed: 0, unknown: 0, conflicts: 0, results: [], undoAvailable: false });
  function success(output, id, change) { output.changed = true; if (change.mismatch) { ++output.failed; output.results.push({ id, status: 'failed', code: 'not-applied', metadata: metadata(change.after) }); return; } ++output.applied; ++output.succeeded; if (change.adjusted) ++output.adjusted; output.results.push({ id, status: change.adjusted ? 'adjusted' : 'applied', code: null, ...(change.after ? { metadata: metadata(change.after) } : {}) }); }
  function failure(output, id, error) { const safe = safeError(error), code = safe.code; ++output.failed; if (safe.outcome === 'unknown') ++output.unknown; if (['conflict', 'ambiguous'].includes(code)) ++output.conflicts; output.results.push({ id, status: safe.outcome === 'unknown' ? 'unknown' : 'failed', code }); return safe.outcome === 'unknown'; }
  function skippedRemainder(output, rows, index) { for (const row of rows.slice(index + 1)) { ++output.skipped; output.results.push({ id: row.id, status: 'skipped', code: 'not-attempted' }); } }
  function commitChanges(changes) { snapshot = null; preview = null; undoRecords = changes; }

  function access() { return run(nativeAccess); }
  function grant() {
    return run(async task => {
      const manifest = api.runtime.getManifest();
      if (![...(manifest.permissions ?? []), ...(manifest.optional_permissions ?? [])].includes('cookies') || typeof api.permissions?.request !== 'function') fail('unsupported');
      const granted = await call(task, api.permissions, 'request', [{ permissions: ['cookies'] }]);
      if (granted !== true) fail('permission-denied');
      return nativeAccess(task);
    });
  }
  function load(options = {}) {
    return run(async task => {
      const input = plain(options, ['storeId', 'domain']), domain = domainFilter(input.domain ?? '');
      const allowed = await requireAccess(task, input.storeId === '*' ? [] : [input.storeId]), stores = input.storeId === '*' ? allowed.stores.map(store => store.id) : [input.storeId];
      const records = [], seen = new Set(); let consumed = 0, unsupportedCount = 0, truncated = false;
      let scanned = 0;
      storesLoop: for (const storeId of stores) {
        const source = await call(task, api.cookies, 'getAll', [{ storeId, ...(domain ? { domain } : {}), partitionKey: {}, ...(browser === 'firefox' ? { firstPartyDomain: null } : {}) }]);
        if (!Array.isArray(source)) fail('operation-failed');
        for (const raw of source) {
          if (++scanned > MAX_RECORDS) { truncated = true; break storesLoop; }
          let record; try { if (data(raw, 'storeId') !== undefined && data(raw, 'storeId') !== storeId) fail('ambiguous'); record = normalizeNativeCookie(raw, { browser, storeId }); } catch { ++unsupportedCount; truncated = true; continue; }
          const identity = cookieIdentity(record); if (seen.has(identity)) fail('ambiguous'); seen.add(identity);
          consumed += bytes(record); if (consumed > MAX_BYTES) { truncated = true; break storesLoop; }
          records.push({ id: 'c' + (++sequence), record });
        }
      }
      const token = 's' + (++sequence); snapshot = { token, records }; preview = null;
      return { token, rows: records.map(({ id, record }) => ({ id, ...metadata(record) })), count: records.length, truncated, unsupportedCount };
    });
  }
  function reveal(id) { return run(async task => { const { record } = rowFor(id); await requireAccess(task, [record.storeId]); return (await fresh(task, record)).value; }); }
  function describe(id = null) {
    return run(async task => {
      const access = await requireAccess(task);
      if (id === null) return { name: '', value: '', domain: '', path: '/', hostOnly: true, secure: true, httpOnly: false, sameSite: 'lax', session: true, expirationDate: null, storeId: access.stores[0]?.id ?? '', partitionKey: null, firstPartyDomain: browser === 'firefox' ? '' : null };
      const { record } = rowFor(id); if (!knownStores.includes(record.storeId)) fail('unknown-store'); return clone(await fresh(task, record));
    });
  }
  function save(id, cookie) {
    return mutate(async task => {
      const input = validateCookieRecord(cookie), before = id === null ? null : rowFor(id).record;
      if (browser !== 'firefox') targetRecord(input);
      await requireAccess(task, [input.storeId]);
      const record = targetRecord(input);
      if (before && cookieIdentity(before) !== cookieIdentity(record)) fail('identity-change');
      if (isExpired(record, now())) fail('expired');
      cookieSetDetails(record, { storeId: record.storeId, browser, capabilities });
      await requireHosts(task, [record]);
      const change = await write(task, record, before), output = result(); commitChanges([change]); success(output, id ?? 'new', change); output.undoAvailable = true; return output;
    });
  }
  function remove(ids) {
    return mutate(async task => {
      if (!snapshot) fail('stale');
      const rows = selectedRows(snapshot.records, ids); if (!rows.length) fail('invalid-input');
      await requireAccess(task, [...new Set(rows.map(row => row.record.storeId))]);
      await requireHosts(task, rows.map(row => row.record));
      for (const row of rows) { cookieSetDetails(expire(row.record), { storeId: row.record.storeId, browser, capabilities }); await fresh(task, row.record); }
      const changes = [], output = result(); commitChanges(changes);
      for (let index = 0; index < rows.length; index++) { const row = rows[index];
        try { const change = await deleteRecord(task, row.record); changes.push(change); success(output, row.id, change); }
        catch (error) { const unknown = failure(output, row.id, error); if (unknown || task.cancelled || task.epoch !== epoch) { skippedRemainder(output, rows, index); break; } }
      }
      output.undoAvailable = changes.length > 0; return output;
    });
  }
  function publicPreview(value) { return { token: value.token, format: value.source.format, sourceStores: clone(value.source.stores), rows: value.rows.map(row => ({ id: row.id, ...metadata(row.record), sourceStore: row.sourceStore, action: row.action, code: row.code })), counts: clone(value.counts), errors: clone(value.errors), warnings: clone(value.warnings) }; }
  async function plan(task, source, options, token) {
    const input = plain(options, ['storeMap', 'policy']), policy = input.policy ?? 'skip';
    if (!['skip', 'overwrite'].includes(policy)) fail('invalid-input');
    const storeMap = plain(input.storeMap ?? {}), sourceStores = new Set(source.stores.map(store => store.id));
    if (Object.keys(storeMap).some(id => !sourceStores.has(id) || typeof storeMap[id] !== 'string')) fail('invalid-input');
    await requireAccess(task);
    const rows = [], errors = [], warnings = [], counts = { total: source.cookies.length, create: 0, overwrite: 0, skip: 0, error: 0, expired: 0 }, mapped = new Map();
    for (let index = 0; index < source.cookies.length; ++index) {
      const original = source.cookies[index], destination = storeMap[original.storeId]; let record = { ...original, storeId: typeof destination === 'string' ? destination : original.storeId };
      const row = { id: 'i' + index, record, sourceStore: original.storeId, before: null, action: 'create', code: null };
      if (!destination) { row.action = 'error'; row.code = 'target-required'; }
      else if (!knownStores.includes(destination)) { row.action = 'error'; row.code = 'unknown-store'; }
      else {
        try { record = targetRecord(record); row.record = record; }
        catch (error) { row.action = 'error'; row.code = safeError(error).code; }
      }
      if (row.action !== 'error' && isExpired(record, now())) { row.action = 'skip'; row.code = 'expired'; ++counts.expired; }
      if (row.action !== 'error') {
        const identity = cookieIdentity(record);
        if (mapped.has(identity)) { row.action = 'error'; row.code = 'duplicate-target'; const previous = mapped.get(identity); previous.action = 'error'; previous.code = 'duplicate-target'; }
        else mapped.set(identity, row);
      }
      rows.push(row);
    }
    // Build all target comparisons before accepting any write-capable preview.
    const hostAccess = new Map();
    for (const row of rows) if (row.action === 'create') {
      const origin = permissionOrigin(row.record);
      if (!hostAccess.has(origin)) hostAccess.set(origin, await call(task, api.permissions, 'contains', [{ origins: [origin] }]));
      if (!hostAccess.get(origin)) { row.action = 'error'; row.code = 'permission-required'; continue; }
      try { row.before = await matches(task, row.record); if (row.before) { row.action = policy === 'overwrite' ? 'overwrite' : 'skip'; row.code = policy === 'overwrite' ? null : 'existing'; } }
      catch (error) { check(task); row.action = 'error'; row.code = safeError(error).code; }
    }
    for (const row of rows) { ++counts[row.action]; if (row.action === 'error') errors.push({ id: row.id, code: row.code }); }
    return { token, source, rows, counts, errors, warnings, storeMap, policy };
  }
  function prepareImport(text, options = {}) { return run(async task => { preview = null; const source = parseCookieImport(text, { format: 'auto' }); const value = await plan(task, source, options, 'p' + (++sequence)); preview = value; return publicPreview(value); }); }
  function updateImport(token, options = {}) { return run(async task => { if (!preview || preview.token !== token) fail('stale'); const previous = preview, source = previous.source, supplied = plain(options, ['storeMap', 'policy']); preview = null; const value = await plan(task, source, { storeMap: supplied.storeMap ?? previous.storeMap, policy: supplied.policy ?? previous.policy }, 'p' + (++sequence)); preview = value; return publicPreview(value); }); }
  function applyImport(token, ids = null) {
    return mutate(async task => {
      const value = preview; if (!value || value.token !== token) fail('stale'); if (value.errors.length) fail('invalid-input');
      const rows = selectedRows(value.rows, ids); if (!rows.length) fail('invalid-input');
      await requireAccess(task, [...new Set(rows.map(row => row.record.storeId))]);
      await requireHosts(task, rows.filter(row => row.action !== 'skip').map(row => row.record));
      for (const row of rows) if (row.action !== 'skip') { if (isExpired(row.record, now())) fail('stale'); await fresh(task, row.before ?? row.record, { absent: row.before === null }); }
      const changes = [], output = result(); commitChanges(changes);
      for (let index = 0; index < rows.length; index++) { const row = rows[index];
        if (row.action === 'skip') { ++output.skipped; output.results.push({ id: row.id, status: 'skipped', code: row.code }); continue; }
        try { const change = await write(task, row.record, row.before); changes.push(change); success(output, row.id, change); }
        catch (error) { const unknown = failure(output, row.id, error); if (unknown || task.cancelled || task.epoch !== epoch) { skippedRemainder(output, rows, index); break; } }
      }
      output.undoAvailable = changes.length > 0; return output;
    });
  }
  function cancelImport(token) { check(); if (lock) fail('busy'); if (preview?.token === token) preview = null; }
  function prepareExport(token, ids = null, options = {}) {
    return run(async task => {
      const input = plain(options, ['format', 'allowLossy']);
      if (!snapshot || snapshot.token !== token) fail('stale');
      const rows = selectedRows(snapshot.records, ids);
      await requireAccess(task, [...new Set(rows.map(row => row.record.storeId))]);
      const records = []; for (const row of rows) records.push(await fresh(task, row.record));
      const exported = exportCookieRecords(records, { format: input.format ?? 'json', browser, allowLossy: input.allowLossy === true });
      return { text: exported.text, filename: exported.format === 'netscape' ? 'detect-expert-cookies.txt' : 'detect-expert-cookies.json', warnings: exported.warnings ?? [] };
    });
  }
  function undo() {
    return mutate(async task => {
      if (!undoRecords.length) fail('stale');
      const previous = [...undoRecords].reverse();
      await requireAccess(task, [...new Set(previous.map(change => (change.before ?? change.after).storeId))]);
      await requireHosts(task, previous.map(change => change.before ?? change.after));
      for (const change of previous) {
        const reference = change.after ?? change.before;
        await fresh(task, reference, { absent: change.after === null });
        if (change.before && isExpired(change.before, now())) fail('expired');
      }
      const output = result(); commitChanges([]);
      for (let index = 0; index < previous.length; index++) {
        const change = previous[index], id = 'u' + index;
        try { const restored = change.before ? await write(task, change.before, change.after) : await deleteRecord(task, change.after); success(output, id, restored); }
        catch (error) { const unknown = failure(output, id, error); if (unknown || task.cancelled || task.epoch !== epoch) { skippedRemainder(output, previous.map((_, index) => ({ id: 'u' + index })), index); break; } }
      }
      return output;
    });
  }
  const removed = () => erase('permissions'); api?.permissions?.onRemoved?.addListener(removed);
  const visibility = () => { const next = env.document?.visibilityState === 'hidden'; if (next !== pageHidden) { pageHidden = next; erase('inactive'); } };
  const pagehide = () => { pageHidden = true; erase('inactive'); };
  const pageshow = () => { pageHidden = env.document?.visibilityState === 'hidden'; erase('inactive'); };
  env.document?.addEventListener?.('visibilitychange', visibility); env.addEventListener?.('pagehide', pagehide); env.addEventListener?.('pageshow', pageshow);
  return { access, grant, load, reveal, describe, save, remove, prepareImport, updateImport, applyImport, cancelImport, prepareExport, undo,
    setActive(value) { const next = value === true; if (next === active) return; active = next; erase('inactive'); },
    dispose() { if (disposed) return; disposed = true; erase('disposed'); api?.permissions?.onRemoved?.removeListener(removed); env.document?.removeEventListener?.('visibilitychange', visibility); env.removeEventListener?.('pagehide', pagehide); env.removeEventListener?.('pageshow', pageshow); } };
}
