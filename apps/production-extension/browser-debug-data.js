// ADR-063: native browser data is projected in own Options only; references contain whitelisted metadata, never native objects.
import { BROWSER_DEBUG_LIMITS as LIMIT, debugFail, debugText, debugNumber, debugHttpUrl, debugInputText, debugField, debugRecord, debugSame } from './browser-debug-shared.js';

const IDS = new Set(['history', 'bookmarks', 'downloads', 'cookies', 'tabs', 'sessions', 'top-sites', 'reading-list', 'extensions']);
function patchRecord(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) debugFail('invalid-input');
  const result = Object.create(null), keys = Reflect.ownKeys(value);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !required.includes(key) && !optional.includes(key) || !descriptor || !Object.hasOwn(descriptor, 'value')) debugFail('invalid-input');
    result[key] = descriptor.value;
  }
  if (required.some(key => !Object.hasOwn(result, key))) debugFail('invalid-input');
  return result;
}
function bool(value) { if (typeof value !== 'boolean') debugFail('invalid-input'); return value; }
function stringId(value) { return debugInputText(value, 256); }
function nativeId(value) { if (!Number.isInteger(value) || value < 0 || value > 2147483647) debugFail('invalid-input'); return value; }
function array(value) { if (!Array.isArray(value)) debugFail('operation-failed'); return value; }
function safeUrl(value) { try { return debugHttpUrl(value); } catch { return ''; } }
function optionalText(value) { return value === undefined ? '' : debugInputText(value, LIMIT.string, true); }
function finish(records, truncated = false) { return { records, truncated }; }
function rows(values, project) {
  const source = array(values), records = []; let truncated = source.length > LIMIT.scan;
  for (let index = 0; index < Math.min(source.length, LIMIT.scan); index++) {
    const record = project(source[index]); if (!record) continue;
    if (records.length >= LIMIT.rows) { truncated = true; break; } records.push(record);
  }
  return finish(records, truncated);
}
const feature = (target, method) => typeof target?.[method] === 'function';
const historyRef = item => ({ url: safeUrl(item.url), lastVisitTime: debugNumber(item.lastVisitTime), visitCount: debugNumber(item.visitCount) });
const bookmarkRef = item => ({ id: debugText(item.id, 256), title: debugText(item.title), url: safeUrl(item.url), parentId: debugText(item.parentId, 256), dateAdded: debugNumber(item.dateAdded), unmodifiable: debugText(item.unmodifiable, 64) });
const downloadRef = item => ({ id: item.id, url: safeUrl(item.finalUrl ?? item.url), state: debugText(item.state, 64), paused: item.paused === true, canResume: item.canResume === true });
const tabRef = item => ({ id: item.id, windowId: item.windowId, url: debugText(item.url), pendingUrl: typeof item.pendingUrl === 'string' ? debugText(item.pendingUrl) : null, pinned: item.pinned === true, muted: item.mutedInfo?.muted === true, incognito: item.incognito === true });
const readingRef = item => ({ url: safeUrl(item.url), title: debugText(item.title), hasBeenRead: item.hasBeenRead === true, creationTime: debugNumber(item.creationTime), lastUpdateTime: debugNumber(item.lastUpdateTime) });
const extensionRef = item => ({ id: debugText(item.id, 256), name: debugText(item.name), version: debugText(item.version, 128), enabled: item.enabled === true, type: debugText(item.type, 64), installType: debugText(item.installType, 64), mayDisable: item.mayDisable === true, mayEnable: item.mayEnable === undefined ? null : item.mayEnable === true });
function mutableBookmark(item) { return Boolean(item.id && item.parentId && item.url && !item.unmodifiable); }
function cookiePartition(value) {
  if (value === undefined || value === null) return null;
  const item = patchRecord(value, ['topLevelSite'], ['hasCrossSiteAncestor']);
  const topLevelSite = debugHttpUrl(item.topLevelSite, { origin: true });
  return { topLevelSite, ...(Object.hasOwn(item, 'hasCrossSiteAncestor') ? { hasCrossSiteAncestor: bool(item.hasCrossSiteAncestor) } : {}) };
}
function cookieRef(item, origin) {
  const path = debugText(item.path);
  if (!path.startsWith('/') || path.length !== item.path?.length) debugFail('unsupported');
  return { origin, name: debugInputText(item.name, LIMIT.string, true), domain: debugInputText(item.domain, 256), path, storeId: stringId(item.storeId), partitionKey: cookiePartition(item.partitionKey),
    firstPartyDomain: typeof item.firstPartyDomain === 'string' ? debugInputText(item.firstPartyDomain, 256, true) : null,
    secure: item.secure === true, httpOnly: item.httpOnly === true, hostOnly: item.hostOnly === true, session: item.session === true,
    sameSite: debugText(item.sameSite, 64), expirationDate: debugNumber(item.expirationDate) };
}
function cookieApplies(item, origin) {
  const parsed = new URL(origin), host = parsed.hostname.toLowerCase(), domain = String(item.domain ?? '').replace(/^\./, '').toLowerCase();
  return domain && (item.hostOnly ? host === domain : host === domain || host.endsWith('.' + domain)) && (!item.secure || parsed.protocol === 'https:');
}
function cookieDetails(reference, url) {
  return { url, name: reference.name, storeId: reference.storeId, ...(reference.partitionKey ? { partitionKey: reference.partitionKey } : {}),
    ...(reference.firstPartyDomain !== null ? { firstPartyDomain: reference.firstPartyDomain } : {}) };
}
function cookieDomains(host) {
  if (host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host) || !host.includes('.')) return { domains: [host], truncated: false };
  const labels = host.split('.'), domains = [];
  for (let index = 0; index < labels.length - 1 && domains.length < 8; index++) domains.push(labels.slice(index).join('.'));
  return { domains, truncated: labels.length - 1 > domains.length };
}
const cookieIdentity = ref => JSON.stringify([ref.origin, ref.name, ref.domain, ref.path, ref.storeId, ref.partitionKey, ref.firstPartyDomain]);
function cookieUrl(reference) {
  // Removal selects by URL, not by path identity. Reject normalization that could target another cookie.
  const url = new URL(reference.origin); url.pathname = reference.path;
  if (url.pathname !== reference.path || url.search || url.hash) debugFail('unsupported');
  return url.href;
}

export function createBrowserDebugDataDriver(ctx) {
  const { api, check } = ctx;
  async function call(target, method, args = []) { check(); if (!feature(target, method)) debugFail('unsupported'); const value = await ctx.call(target, method, args); check(); return value; }
  const methods = { history: [api.history, 'search'], bookmarks: [api.bookmarks, 'getRecent'], downloads: [api.downloads, 'search'], cookies: [api.cookies, 'getAll'], tabs: [api.tabs, 'query'], sessions: [api.sessions, 'getRecentlyClosed'], 'top-sites': [api.topSites, 'get'], 'reading-list': [api.readingList, 'query'], extensions: [api.management, 'getAll'] };
  const supports = id => IDS.has(id) && feature(...methods[id]);
  function editableExtension(item) { return Boolean(item.id && item.id !== api.runtime?.id && item.mayDisable && !['admin', 'component'].includes(item.installType) && (ctx.browser !== 'firefox' || item.type === 'theme')); }
  function downloadActions(item) { return [item.state === 'in_progress' && !item.paused && feature(api.downloads, 'pause') ? 'pause' : null, item.paused && item.canResume && feature(api.downloads, 'resume') ? 'resume' : null, item.state === 'in_progress' && feature(api.downloads, 'cancel') ? 'cancel' : null, feature(api.downloads, 'erase') ? 'erase' : null].filter(Boolean); }
  async function read(id, options = {}) {
    check(); if (!supports(id)) debugFail('unsupported');
    const query = typeof options.query === 'string' ? debugInputText(options.query, 512, true) : '';
    if (id === 'history') return rows(await call(api.history, 'search', [{ text: query, startTime: 0, maxResults: LIMIT.rows + 1 }]), item => {
      const ref = historyRef(item); return debugRecord({ title: debugText(item.title), url: ref.url, lastVisitTime: ref.lastVisitTime, visitCount: ref.visitCount }, ref, ref.url && feature(api.history, 'deleteUrl') ? ['remove'] : []);
    });
    if (id === 'bookmarks') return rows(await call(api.bookmarks, 'getRecent', [LIMIT.scan]), item => {
      const ref = bookmarkRef(item); if (query && !(ref.title + ' ' + ref.url).toLocaleLowerCase().includes(query.toLocaleLowerCase())) return null;
      const actions = mutableBookmark(ref) ? [feature(api.bookmarks, 'update') ? 'edit' : null, feature(api.bookmarks, 'move') ? 'move' : null, feature(api.bookmarks, 'remove') ? 'remove' : null].filter(Boolean) : [];
      return debugRecord({ title: ref.title, url: ref.url, parentId: ref.parentId, dateAdded: ref.dateAdded }, ref, actions);
    });
    if (id === 'downloads') return rows(await call(api.downloads, 'search', [{ limit: LIMIT.rows + 1, orderBy: ['-startTime'], ...(query ? { query: [query] } : {}) }]), item => {
      const ref = downloadRef(item), name = debugText(item.filename).split(/[\\/]/).at(-1);
      return debugRecord({ name, url: ref.url, state: ref.state, bytesReceived: debugNumber(item.bytesReceived), totalBytes: debugNumber(item.totalBytes) }, ref, downloadActions(ref));
    });
    if (id === 'cookies') {
      const origin = debugHttpUrl(options.origin, { origin: true }), scope = cookieDomains(new URL(origin).hostname), records = [], seen = new Set();
      let scanned = 0, truncated = scope.truncated;
      domainsLoop: for (const domain of scope.domains) {
        const source = array(await call(api.cookies, 'getAll', [{ domain, partitionKey: {}, ...(ctx.browser === 'firefox' ? { firstPartyDomain: null } : {}) }]));
        for (const item of source) {
          if (scanned >= LIMIT.scan) { truncated = true; break domainsLoop; } scanned++;
          if (!cookieApplies(item, origin)) continue;
          let ref; try { ref = cookieRef(item, origin); } catch { truncated = true; continue; }
          const identity = cookieIdentity(ref); if (seen.has(identity)) continue; seen.add(identity);
          if (records.length >= LIMIT.rows) { truncated = true; break domainsLoop; }
          records.push(debugRecord({ name: ref.name, domain: ref.domain, path: ref.path, expirationDate: ref.expirationDate, secure: ref.secure, httpOnly: ref.httpOnly,
            storeId: ref.storeId, partitionTopLevelSite: ref.partitionKey?.topLevelSite ?? null, hasCrossSiteAncestor: ref.partitionKey?.hasCrossSiteAncestor ?? null, firstPartyDomain: ref.firstPartyDomain }, ref, feature(api.cookies, 'get') && feature(api.cookies, 'remove') ? ['remove'] : []));
        }
      }
      return finish(records, truncated);
    }
    if (id === 'tabs') return rows(await call(api.tabs, 'query', [{}]), item => {
      const ref = tabRef(item); if (!Number.isInteger(ref.id) || ref.id < 0 || ref.incognito) return null;
      return debugRecord({ title: debugText(item.title), url: safeUrl(item.url), windowId: ref.windowId, pinned: ref.pinned, muted: ref.muted }, ref, feature(api.tabs, 'get') && feature(api.tabs, 'update') ? ['edit', 'activate'] : []);
    });
    if (id === 'sessions') {
      const recent = array(await call(api.sessions, 'getRecentlyClosed', [{ maxResults: 25 }])), records = []; let scanned = 0, truncated = false;
      const visit = () => { if (scanned >= LIMIT.scan || records.length >= LIMIT.rows) { truncated = true; return false; } scanned++; return true; };
      const add = record => { if (records.length >= LIMIT.rows) { truncated = true; return false; } records.push(record); return true; };
      for (const item of recent) {
        if (!visit()) break;
        const type = item.tab ? 'tab' : 'window', native = item.tab ?? item.window, sessionId = debugText(native?.sessionId, 256);
        const ref = { kind: 'recent', type, sessionId, lastModified: debugNumber(item.lastModified) };
        add(debugRecord({ name: 'recent-' + type, title: debugText(item.tab?.title), url: safeUrl(item.tab?.url), lastModified: ref.lastModified }, ref, sessionId && feature(api.sessions, 'restore') ? ['restore'] : []));
      }
      if (feature(api.sessions, 'getDevices') && records.length < LIMIT.rows && scanned < LIMIT.scan) {
        const devices = array(await call(api.sessions, 'getDevices', [{ maxResults: 10 }]));
        devicesLoop: for (const device of devices) {
          if (!visit()) break;
          let added = false;
          for (const session of array(device.sessions ?? [])) {
            if (!visit()) break devicesLoop;
            const tabs = session.tab ? [session.tab] : array(session.window?.tabs ?? []);
            for (const tab of tabs) {
              if (!visit() || !add(debugRecord({ name: debugText(device.deviceName, 256), title: debugText(tab.title), url: safeUrl(tab.url), lastModified: debugNumber(session.lastModified) }))) break devicesLoop;
              added = true;
            }
          }
          if (!added && records.length < LIMIT.rows) add(debugRecord({ name: debugText(device.deviceName, 256), title: '', url: '', lastModified: null }));
        }
      }
      return finish(records, truncated || recent.length > 25);
    }
    if (id === 'top-sites') return rows(await call(api.topSites, 'get'), item => debugRecord({ title: debugText(item.title), url: safeUrl(item.url) }));
    if (id === 'reading-list') return rows(await call(api.readingList, 'query', [{}]), item => {
      const ref = readingRef(item); return debugRecord({ title: ref.title, url: ref.url, hasBeenRead: ref.hasBeenRead, creationTime: ref.creationTime }, ref, ref.url ? [feature(api.readingList, 'updateEntry') ? 'edit' : null, feature(api.readingList, 'removeEntry') ? 'remove' : null].filter(Boolean) : []);
    });
    return rows(await call(api.management, 'getAll'), item => {
      const ref = extensionRef(item); return debugRecord({ name: ref.name, version: ref.version, enabled: ref.enabled, type: ref.type, installType: ref.installType }, ref,
        editableExtension(ref) && feature(api.management, 'get') && feature(api.management, 'setEnabled') ? ['edit'] : []);
    });
  }
  function describe(id, operation, reference) {
    check(); if (!supports(id)) debugFail('unsupported');
    const create = operation === 'create';
    if (create && reference !== null || !create && (!reference || typeof reference !== 'object')) debugFail('invalid-input');
    const fields = []; let destructive = false;
    if (id === 'history' && create && feature(api.history, 'addUrl')) fields.push(debugField('url', 'url', '', { required: true }));
    else if (id === 'history' && operation === 'remove' && reference.url) destructive = true;
    else if (id === 'bookmarks' && create && feature(api.bookmarks, 'create')) fields.push(debugField('title', 'text', ''), debugField('url', 'url', '', { required: true }), debugField('parentId', 'text', ''));
    else if (id === 'bookmarks' && mutableBookmark(reference) && operation === 'edit') fields.push(debugField('title', 'text', reference.title), debugField('url', 'url', reference.url, { required: true }));
    else if (id === 'bookmarks' && mutableBookmark(reference) && operation === 'move') fields.push(debugField('parentId', 'text', reference.parentId, { required: true }));
    else if (id === 'bookmarks' && mutableBookmark(reference) && operation === 'remove') destructive = true;
    else if (id === 'downloads' && downloadActions(reference).includes(operation)) destructive = ['cancel', 'erase'].includes(operation);
    else if (id === 'cookies' && operation === 'remove' && reference.origin) destructive = true;
    else if (id === 'tabs' && operation === 'edit' && !reference.incognito) fields.push(debugField('pinned', 'boolean', reference.pinned), debugField('muted', 'boolean', reference.muted));
    else if (id === 'tabs' && operation === 'activate' && !reference.incognito) { /* A user-selected existing tab only. */ }
    else if (id === 'sessions' && operation === 'restore' && reference.kind === 'recent' && reference.sessionId) { /* Remote device sessions are read-only. */ }
    else if (id === 'reading-list' && create && feature(api.readingList, 'addEntry')) fields.push(debugField('title', 'text', ''), debugField('url', 'url', '', { required: true }), debugField('hasBeenRead', 'boolean', false));
    else if (id === 'reading-list' && operation === 'edit' && reference.url) fields.push(debugField('title', 'text', reference.title), debugField('hasBeenRead', 'boolean', reference.hasBeenRead));
    else if (id === 'reading-list' && operation === 'remove' && reference.url) destructive = true;
    else if (id === 'extensions' && operation === 'edit' && editableExtension(reference)) fields.push(debugField('enabled', 'boolean', reference.enabled));
    else debugFail('unsupported');
    return { fields, destructive };
  }
  function sameReference(expected, actual) { if (!debugSame(expected, actual)) debugFail('stale-record'); }
  async function bookmarkParent(id) {
    stringId(id); const parent = array(await call(api.bookmarks, 'get', [id]))[0];
    if (!parent || parent.id !== id || parent.url !== undefined || parent.unmodifiable || typeof parent.parentId !== 'string') debugFail('invalid-input');
  }
  async function write(id, operation, reference, patch) {
    describe(id, operation, reference); check();
    if (id === 'history') {
      if (operation === 'create') { const input = patchRecord(patch, ['url']); await call(api.history, 'addUrl', [{ url: debugHttpUrl(input.url) }]); }
      else { patchRecord(patch, []); const url = debugHttpUrl(reference.url), found = array(await call(api.history, 'search', [{ text: url, startTime: 0, maxResults: LIMIT.scan }])).find(item => item.url === url); if (!found) debugFail('stale-record'); sameReference(reference, historyRef(found)); await call(api.history, 'deleteUrl', [{ url }]); }
      return { changed: true };
    }
    if (id === 'bookmarks') {
      if (operation === 'create') {
        const input = patchRecord(patch, ['url'], ['title', 'parentId']), title = optionalText(input.title), url = debugHttpUrl(input.url), parentId = optionalText(input.parentId);
        if (parentId) await bookmarkParent(parentId);
        const result = await call(api.bookmarks, 'create', [{ title, url, ...(parentId ? { parentId } : {}) }]);
        if (!result?.id || result.url !== url || result.title !== title) debugFail('operation-failed');
      } else {
        const input = patchRecord(patch, operation === 'edit' ? ['url'] : operation === 'move' ? ['parentId'] : [], operation === 'edit' ? ['title'] : []);
        const native = array(await call(api.bookmarks, 'get', [stringId(reference.id)]))[0]; if (!native) debugFail('stale-record'); const fresh = bookmarkRef(native); sameReference(reference, fresh); if (!mutableBookmark(fresh)) debugFail('unsupported');
        if (operation === 'edit') { const title = Object.hasOwn(input, 'title') ? optionalText(input.title) : native.title, url = debugHttpUrl(input.url); await call(api.bookmarks, 'update', [fresh.id, { title, url }]); const result = array(await call(api.bookmarks, 'get', [fresh.id]))[0]; if (!result || result.title !== title || result.url !== url) debugFail('operation-failed'); }
        else if (operation === 'move') { const parentId = stringId(input.parentId); await bookmarkParent(parentId); const latest = array(await call(api.bookmarks, 'get', [fresh.id]))[0]; if (!latest) debugFail('stale-record'); sameReference(reference, bookmarkRef(latest)); await call(api.bookmarks, 'move', [fresh.id, { parentId }]); const result = array(await call(api.bookmarks, 'get', [fresh.id]))[0]; if (result?.parentId !== parentId) debugFail('operation-failed'); }
        else await call(api.bookmarks, 'remove', [fresh.id]);
      }
      return { changed: true };
    }
    if (id === 'downloads') { patchRecord(patch, []); const native = array(await call(api.downloads, 'search', [{ id: nativeId(reference.id) }]))[0]; if (!native) debugFail('stale-record'); const fresh = downloadRef(native); sameReference(reference, fresh); if (!downloadActions(fresh).includes(operation)) debugFail('stale-record'); const result = await call(api.downloads, operation, operation === 'erase' ? [{ id: fresh.id }] : [fresh.id]); if (operation === 'erase' && (!Array.isArray(result) || !result.includes(fresh.id))) debugFail('operation-failed'); return { changed: true }; }
    if (id === 'cookies') {
      patchRecord(patch, []); const origin = debugHttpUrl(reference.origin, { origin: true }), details = { domain: reference.domain.replace(/^\./, ''), name: reference.name, storeId: reference.storeId,
        ...(reference.partitionKey ? { partitionKey: reference.partitionKey } : {}), ...(reference.firstPartyDomain !== null ? { firstPartyDomain: reference.firstPartyDomain } : {}) };
      const candidates = array(await call(api.cookies, 'getAll', [details]));
      if (candidates.length > LIMIT.scan) debugFail('stale-record');
      const found = candidates.find(item => { if (!cookieApplies(item, origin)) return false; try { return debugSame(reference, cookieRef(item, origin)); } catch { return false; } }); if (!found) debugFail('stale-record');
      const url = cookieUrl(reference), selected = await call(api.cookies, 'get', [cookieDetails(reference, url)]);
      if (!selected) debugFail('stale-record'); sameReference(reference, cookieRef(selected, origin));
      const removed = await call(api.cookies, 'remove', [cookieDetails(reference, url)]); if (!removed || removed.name !== reference.name || removed.storeId !== reference.storeId) debugFail('operation-failed'); return { changed: true };
    }
    if (id === 'tabs') {
      const input = patchRecord(patch, operation === 'edit' ? ['pinned', 'muted'] : []), before = await call(api.tabs, 'get', [nativeId(reference.id)]); sameReference(reference, tabRef(before)); if (before.incognito) debugFail('unsupported');
      const update = operation === 'edit' ? { pinned: bool(input.pinned), muted: bool(input.muted) } : { active: true };
      await call(api.tabs, 'update', [reference.id, update]); const after = await call(api.tabs, 'get', [reference.id]);
      if (after.id !== reference.id || after.windowId !== reference.windowId || (operation === 'edit' ? after.pinned !== update.pinned || after.mutedInfo?.muted !== update.muted : after.active !== true)) debugFail('operation-failed'); return { changed: true };
    }
    if (id === 'sessions') { patchRecord(patch, []); const recent = array(await call(api.sessions, 'getRecentlyClosed', [{ maxResults: 25 }])); const found = recent.find(item => (item.tab ?? item.window)?.sessionId === reference.sessionId && (item.tab ? 'tab' : 'window') === reference.type && debugNumber(item.lastModified) === reference.lastModified); if (!found) debugFail('stale-record'); await call(api.sessions, 'restore', [stringId(reference.sessionId)]); return { changed: true }; }
    if (id === 'reading-list') {
      const input = patchRecord(patch, operation === 'create' ? ['url', 'hasBeenRead'] : operation === 'edit' ? ['hasBeenRead'] : [], operation === 'remove' ? [] : ['title']);
      if (operation === 'create') { const record = { title: optionalText(input.title), url: debugHttpUrl(input.url), hasBeenRead: bool(input.hasBeenRead) }; if (array(await call(api.readingList, 'query', [{ url: record.url }])).length) debugFail('stale-record'); await call(api.readingList, 'addEntry', [record]); }
      else { const url = debugHttpUrl(reference.url), native = array(await call(api.readingList, 'query', [{ url }]))[0]; if (!native) debugFail('stale-record'); sameReference(reference, readingRef(native)); if (operation === 'edit') await call(api.readingList, 'updateEntry', [{ url, title: Object.hasOwn(input, 'title') ? optionalText(input.title) : native.title, hasBeenRead: bool(input.hasBeenRead) }]); else await call(api.readingList, 'removeEntry', [{ url }]); }
      return { changed: true };
    }
    if (id === 'extensions') { const input = patchRecord(patch, ['enabled']), enabled = bool(input.enabled), native = await call(api.management, 'get', [stringId(reference.id)]), fresh = extensionRef(native); sameReference(reference, fresh); if (!editableExtension(fresh) || enabled && fresh.mayEnable === false) debugFail('unsupported'); await call(api.management, 'setEnabled', [fresh.id, enabled]); const after = await call(api.management, 'get', [fresh.id]); if (after.enabled !== enabled) debugFail('operation-failed'); return { changed: true }; }
    debugFail('unsupported');
  }
  return { supports, read, describe, write };
}
