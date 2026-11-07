// REQ-002/004/005/011: operation evidence and read-only origin capability inventory.
export function createBackgroundActivityContracts() {
  const operations = Object.freeze(['ServiceWorkerContainer.register', 'ServiceWorkerContainer.getRegistration', 'ServiceWorkerContainer.getRegistrations', 'PushManager.subscribe', 'PushManager.getSubscription', 'PushManager.permissionState', 'SyncManager.register', 'SyncManager.getTags', 'PeriodicSyncManager.register', 'PeriodicSyncManager.getTags', 'PeriodicSyncManager.unregister', 'Notification.requestPermission']);
  const field = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
  const document = value => typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,160}$/.test(value);
  const count = (value, max = 2147483647) => Number.isSafeInteger(value) && value >= 0 && value <= max;
  const host = value => typeof value === 'string' && value.length <= 253 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && !value.includes('..');
  const paths = Object.freeze(['/', '/<scope>', '/<worker>', '/<script>', '/sw.js', '/service-worker.js', '/worker.js', '/firebase-messaging-sw.js', '/main.js', '/app.js', '/bundle.js', '/sdk.js', '/gtm.js', '/fbevents.js', '/bat.js']);
  const resource = value => value === null ? null : exact(value, ['host', 'pathTemplate']) && host(field(value, 'host')) && paths.includes(field(value, 'pathTemplate')) ? { host: field(value, 'host'), pathTemplate: field(value, 'pathTemplate') } : false;
  const list = (value, max, read) => {
    if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) return null;
    const output = [];
    for (let index = 0; index < value.length; index++) { const descriptor = Object.getOwnPropertyDescriptor(value, index); if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null; const item = read(descriptor.value); if (item === null) return null; output.push(item); }
    return output;
  };
  function readRows(value) {
    try {
      const seen = new Set();
      return list(value, 64, item => {
        const keys = ['operation', 'phase', 'count', 'evidenceSource', 'integrity', 'attributionConfidence', 'script', 'worker'];
        if (!exact(item, keys) || !operations.includes(field(item, 'operation')) || !['async-returned', 'threw-sync'].includes(field(item, 'phase')) || !count(field(item, 'count')) || field(item, 'count') < 1 || field(item, 'evidenceSource') !== 'page-hook' || field(item, 'integrity') !== 'page-controlled' || !['exact-resource', 'sampled-stack', 'unknown'].includes(field(item, 'attributionConfidence'))) return null;
        const script = resource(field(item, 'script')), worker = resource(field(item, 'worker'));
        if (script === false || worker === false || (script === null) !== (field(item, 'attributionConfidence') === 'unknown') || field(item, 'operation') !== 'ServiceWorkerContainer.register' && worker !== null) return null;
        const key = [field(item, 'operation'), field(item, 'phase'), field(item, 'attributionConfidence'), script?.host ?? '', script?.pathTemplate ?? '', worker?.host ?? '', worker?.pathTemplate ?? ''].join('|');
        if (seen.has(key)) return null; seen.add(key);
        return Object.fromEntries(keys.map(key => [key, key === 'script' ? script : key === 'worker' ? worker : field(item, key)]));
      });
    } catch { return null; }
  }
  function readInventory(value) {
    try {
      const keys = ['status', 'secureContext', 'supported', 'permissions', 'registrationCount', 'pushSubscriptionCount', 'syncTagCount', 'periodicTagCount', 'registrations', 'truncated', 'checkedAt'];
      if (!exact(value, keys) || !['available', 'unsupported', 'unavailable'].includes(field(value, 'status')) || typeof field(value, 'secureContext') !== 'boolean' || typeof field(value, 'truncated') !== 'boolean' || !count(field(value, 'checkedAt'), Number.MAX_SAFE_INTEGER)) return null;
      const supported = field(value, 'supported'), permissions = field(value, 'permissions'), supportKeys = ['serviceWorker', 'push', 'sync', 'periodicSync'], permissionKeys = ['notifications', 'push', 'sync', 'periodicSync'];
      if (!exact(supported, supportKeys) || !supportKeys.every(key => typeof field(supported, key) === 'boolean') || !exact(permissions, permissionKeys) || !permissionKeys.every(key => ['granted', 'denied', 'prompt', 'unsupported', 'unknown'].includes(field(permissions, key)))) return null;
      for (const key of ['registrationCount', 'pushSubscriptionCount', 'syncTagCount', 'periodicTagCount']) if (field(value, key) !== null && !count(field(value, key), key === 'registrationCount' || key === 'pushSubscriptionCount' ? 4096 : 65536)) return null;
      const registrations = list(field(value, 'registrations'), 16, item => {
        if (!exact(item, ['scope', 'script', 'state', 'pushSubscribed', 'syncTagCount', 'periodicTagCount'])) return null;
        const scope = resource(field(item, 'scope')), script = resource(field(item, 'script'));
        if (!scope || scope === false || script === false || !['activated', 'installing', 'installed', 'activating', 'redundant', 'unknown'].includes(field(item, 'state')) || field(item, 'pushSubscribed') !== null && typeof field(item, 'pushSubscribed') !== 'boolean' || !['syncTagCount', 'periodicTagCount'].every(key => field(item, key) === null || count(field(item, key), 4096))) return null;
        return { scope, script, state: field(item, 'state'), pushSubscribed: field(item, 'pushSubscribed'), syncTagCount: field(item, 'syncTagCount'), periodicTagCount: field(item, 'periodicTagCount') };
      });
      if (!registrations || field(value, 'registrationCount') !== null && field(value, 'registrationCount') < registrations.length || field(value, 'status') !== 'available' && registrations.length || field(value, 'status') === 'unsupported' && field(supported, 'serviceWorker')) return null;
      return { ...Object.fromEntries(keys.map(key => [key, field(value, key)])), supported: Object.fromEntries(supportKeys.map(key => [key, field(supported, key)])), permissions: Object.fromEntries(permissionKeys.map(key => [key, field(permissions, key)])), registrations };
    } catch { return null; }
  }
  function readCache(value) {
    try {
      if (!exact(value, ['schemaVersion', 'type', 'available', 'rows', 'truncated', 'inventory']) || field(value, 'schemaVersion') !== 1 || field(value, 'type') !== 'background-values-cache' || typeof field(value, 'available') !== 'boolean' || typeof field(value, 'truncated') !== 'boolean') return null;
      const rows = readRows(field(value, 'rows')), inventory = readInventory(field(value, 'inventory'));
      return rows && inventory && (field(value, 'available') || !rows.length) ? { schemaVersion: 1, type: 'background-values-cache', available: field(value, 'available'), rows, truncated: field(value, 'truncated'), inventory } : null;
    } catch { return null; }
  }
  function readSnapshot(value) {
    try {
      const keys = ['schemaVersion', 'type', 'documentKey', 'coverageState', 'observedAt', 'rows', 'truncated', 'inventory'];
      if (!exact(value, keys) || field(value, 'schemaVersion') !== 1 || field(value, 'type') !== 'background-activity-state' || !document(field(value, 'documentKey')) || !['active', 'partial', 'degraded', 'no-access', 'paused', 'unsupported'].includes(field(value, 'coverageState')) || !count(field(value, 'observedAt'), Number.MAX_SAFE_INTEGER) || typeof field(value, 'truncated') !== 'boolean') return null;
      const rows = readRows(field(value, 'rows')), inventory = readInventory(field(value, 'inventory'));
      if (!rows || !inventory || ['no-access', 'paused', 'unsupported'].includes(field(value, 'coverageState')) && (rows.length || inventory.registrations.length || inventory.status === 'available')) return null;
      return { ...Object.fromEntries(keys.map(key => [key, field(value, key)])), rows, inventory };
    } catch { return null; }
  }
  function readRequest(value) {
    try {
      const keys = ['schemaVersion', 'type', 'tabId', 'frameId', 'documentKey'];
      if (!exact(value, keys) || field(value, 'schemaVersion') !== 1 || !['ui-get-background-activity', 'ui-refresh-background-activity'].includes(field(value, 'type')) || !count(field(value, 'tabId')) || !count(field(value, 'frameId')) || !document(field(value, 'documentKey')) || !field(value, 'documentKey').startsWith(`${field(value, 'tabId')}:${field(value, 'frameId')}:`)) return null;
      return Object.fromEntries(keys.map(key => [key, field(value, key)]));
    } catch { return null; }
  }
  function readDocuments(value) {
    try {
      const seen = new Set(); let rows = 0;
      return list(value, 24, item => { const snapshot = readSnapshot(item); if (!snapshot || seen.has(snapshot.documentKey) || (rows += snapshot.rows.length) > 256) return null; seen.add(snapshot.documentKey); return snapshot; });
    } catch { return null; }
  }
  return { operations, readRows, readInventory, readCache, readSnapshot, readRequest, readDocuments };
}
export const backgroundActivityContracts = createBackgroundActivityContracts();
export const BACKGROUND_OPERATIONS = backgroundActivityContracts.operations;
export const readBackgroundRows = backgroundActivityContracts.readRows;
export const readBackgroundInventory = backgroundActivityContracts.readInventory;
export const readBackgroundCache = backgroundActivityContracts.readCache;
export const readBackgroundSnapshot = backgroundActivityContracts.readSnapshot;
export const readBackgroundRequest = backgroundActivityContracts.readRequest;
export const readBackgroundDocuments = backgroundActivityContracts.readDocuments;
