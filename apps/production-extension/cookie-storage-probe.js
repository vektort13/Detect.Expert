// ADR-032: self-contained ISOLATED diagnostic. No values, keys, DB names or URLs leave it.
export async function selectedCookieStorageProbe(name) {
  const output = { matchedStores: [], storageCoverage: 'active' };
  if (typeof name !== 'string' || name.length > 128 || !/^[!#$%&'*+\-.^_`|~0-9a-zA-Z]+$/.test(name)) return { matchedStores: [], storageCoverage: 'unsupported' };
  const deadline = Date.now() + 700, databases = new Set();
  let stopped = false, selected = null, partial = false;
  const current = () => !stopped && Date.now() < deadline;
  const timer = setTimeout(() => { stopped = true; for (const database of databases) try { database.close(); } catch {} }, 700);
  const wait = async job => {
    let timeout;
    try { return await Promise.race([job, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('probe-timeout')), Math.max(1, deadline - Date.now())); })]); }
    finally { clearTimeout(timeout); }
  };
  const scalarMatches = value => {
    if (typeof value === 'string') return value.length <= 16384 && value === selected ? 1 : 0;
    if (!value || typeof value !== 'object') return 0;
    let count = 0, fields = 0;
    // Native structured clones have no accessors. Still read own data descriptors only.
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      if (++fields > 16) { partial = true; break; }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string' && descriptor.value.length <= 16384 && descriptor.value === selected) count++;
    }
    return count;
  };
  try {
    let prototype = Document.prototype, descriptor;
    for (let depth = 0; prototype && depth < 5; depth++, prototype = Object.getPrototypeOf(prototype)) {
      descriptor = Object.getOwnPropertyDescriptor(prototype, 'cookie');
      if (descriptor?.get) break;
    }
    if (typeof descriptor?.get !== 'function') return { matchedStores: [], storageCoverage: 'unsupported' };
    const cookies = Reflect.apply(descriptor.get, document, []);
    if (typeof cookies !== 'string' || cookies.length > 65536) return { matchedStores: [], storageCoverage: 'partial' };
    for (const pair of cookies.split(';')) {
      const trimmed = pair.trimStart(), equal = trimmed.indexOf('=');
      if (equal < 0 || trimmed.slice(0, equal) !== name) continue;
      if (selected !== null) return { matchedStores: [], storageCoverage: 'partial' };
      selected = trimmed.slice(equal + 1);
    }
    if (selected === null || selected.length < 8 || selected.length > 16384) return { matchedStores: [], storageCoverage: 'partial' };
    let count = 0;
    try {
      const storage = window.localStorage, limit = Math.min(storage.length, 64);
      if (storage.length > 64) partial = true;
      const get = Storage.prototype.getItem, key = Storage.prototype.key;
      for (let index = 0; index < limit && current(); index++) {
        const storedKey = Reflect.apply(key, storage, [index]);
        if (typeof storedKey !== 'string') continue;
        const value = Reflect.apply(get, storage, [storedKey]);
        if (typeof value === 'string' && value.length <= 16384 && value === selected) count++;
      }
      if (count) output.matchedStores.push({ storage: 'localStorage', count });
    } catch { partial = true; }
    count = 0;
    try {
      if (typeof indexedDB?.databases !== 'function') partial = true;
      else {
        const names = await wait(indexedDB.databases());
        if (!Array.isArray(names)) throw new Error('probe-databases');
        if (names.length > 4) partial = true;
        for (const entry of names.slice(0, 4)) {
          if (!current()) break;
          const databaseName = Object.getOwnPropertyDescriptor(entry, 'name')?.value;
          if (typeof databaseName !== 'string' || databaseName.length > 256) { partial = true; continue; }
          const database = await wait(new Promise((resolve, reject) => {
            const request = indexedDB.open(databaseName);
            let rejected = false;
            request.onupgradeneeded = () => { try { request.transaction.abort(); } catch {} };
            request.onerror = () => { rejected = true; reject(new Error('probe-open')); };
            request.onblocked = () => { rejected = true; reject(new Error('probe-blocked')); };
            request.onsuccess = () => { if (rejected || !current()) { request.result.close(); reject(new Error('probe-stale')); } else resolve(request.result); };
          }));
          databases.add(database);
          try {
            if (database.objectStoreNames.length > 4) partial = true;
            for (const storeName of Array.from(database.objectStoreNames).slice(0, 4)) {
              if (!current()) break;
              const matches = await wait(new Promise((resolve, reject) => {
                const transaction = database.transaction(storeName, 'readonly'), request = transaction.objectStore(storeName).openCursor();
                let records = 0, matches = 0;
                request.onerror = () => reject(new Error('probe-cursor'));
                request.onsuccess = () => {
                  if (!current()) { try { transaction.abort(); } catch {} resolve(matches); return; }
                  const cursor = request.result;
                  if (!cursor) { resolve(matches); return; }
                  if (++records > 16) { partial = true; resolve(matches); return; }
                  matches = Math.min(64, matches + scalarMatches(cursor.value));
                  cursor.continue();
                };
              }));
              count = Math.min(64, count + matches);
            }
          } finally { database.close(); databases.delete(database); }
        }
        if (count) output.matchedStores.push({ storage: 'indexedDB', count });
      }
    } catch { partial = true; }
    count = 0;
    try {
      if (!window.caches || typeof caches.keys !== 'function') partial = true;
      else {
        const names = await wait(caches.keys());
        if (!Array.isArray(names)) throw new Error('probe-caches');
        // CacheStorage has no read-only API that enumerates an existing cache's entries.
        // Only root responses are checked, so a nonempty cache inventory is partial.
        if (names.length) partial = true;
        for (const cacheName of names.slice(0, 4)) {
          if (!current()) break;
          if (typeof cacheName !== 'string' || cacheName.length > 256) { partial = true; continue; }
          // match() reads existing entries; unlike open(), it cannot create a deleted cache.
          const keys = await wait(caches.match(new Request(location.origin + '/'), { cacheName }));
          // Root response only: never enumerate every URL or read arbitrary response collections.
          if (!keys || !keys.body || keys.type === 'opaque') continue;
          const reader = keys.body.getReader(), chunks = [], decoder = new TextDecoder('utf-8', { fatal: true });
          let bytes = 0, oversized = false;
          try {
            while (current()) {
              const item = await wait(reader.read());
              if (item.done) break;
              bytes += item.value.byteLength;
              if (bytes > 32768) { oversized = true; partial = true; break; }
              chunks.push(item.value);
            }
            if (!oversized && current()) {
              const buffer = new Uint8Array(bytes); let offset = 0;
              for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
              const value = decoder.decode(buffer);
              if (value.length <= 16384 && value === selected) count++;
            }
          // Cancellation belongs to this diagnostic, but native cancellation may never settle.
          // Release the selected value in the outer finally without awaiting it.
          } finally { void reader.cancel().catch(() => {}); }
        }
        if (count) output.matchedStores.push({ storage: 'cacheStorage', count });
      }
    } catch { partial = true; }
    output.storageCoverage = partial || !current() ? 'partial' : 'active';
    return output;
  } finally {
    selected = null; stopped = true; clearTimeout(timer);
    for (const database of databases) try { database.close(); } catch {}
  }
}
