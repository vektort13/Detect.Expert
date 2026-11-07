import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { readCookieSnapshot, normalizeProCookieMetadata, readLoaderRows, readTagManagerDocuments, readSocialRows, readSocialDocuments, mergeLoaderRows } from '../../packages/contracts/src/inspection.mjs';
import { readAdvancedPageFields } from '../../packages/contracts/src/advanced-inspection.mjs';
import { runtimeSource } from '../production/pro-values-runtime.mjs';

export function canonicalSessionValidator() {
  const source = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
  const contracts = source.slice(0, source.indexOf('// packages/attribution/src/psl-index.json')).replace(/^import[^\n]*\n/gmu, '');
  const valuesAt = source.indexOf(runtimeSource);
  if (valuesAt < 0 || source.indexOf(runtimeSource, valuesAt + runtimeSource.length) >= 0) throw Error('Exact production PRO value validators are missing or duplicated');
  const values = source.slice(valuesAt, valuesAt + runtimeSource.length);
  const context = vm.createContext({ Object, Array, Number, String, Boolean, Set, Map, JSON, URL, TextEncoder, structuredClone, atob, btoa, readCookieSnapshot, normalizeProCookieMetadata, readLoaderRows, readTagManagerDocuments, readSocialRows, readSocialDocuments, mergeLoaderRows, readAdvancedPageFields });
  vm.runInContext(values + '\n' + contracts, context);return input => context.validateProSession(input);
}
export function stoppedProSession(id = 'saved-1') {
  return { schemaVersion: 1, id, domain: 'example.test', siteKey: 'example.test', startTabId: 1, status: 'stopped', startedAt: 1000, deadlineAt: 601000, stoppedAt: 2000, stopReason: 'manual', pages: [{ id: 'page-1', tabId: 1, documentKey: '1:0:document-1', url: 'https://example.test/', title: 'PRIVATE_PAGE_TITLE', startedAt: 1000, endedAt: 2000, reports: [], resources: [] }], limitations: ['redacted-urls'], dropped: { pages: 0, resources: 0, documents: 0, events: 0 } };
}

// Independent serialized transaction model: scoped access, cloned records,
// atomic commit/rollback and FIFO writers. Native IDB is checked separately.
export function memoryHistoryBackend() {
  let data = new Map(['state', 'reports', 'summaries'].map(name => [name, new Map()])), tail = Promise.resolve(), fail = null;
  data.get('state').set('epoch', { key: 'epoch', value: 'initial-v1' });
  const calls = [];
  return {
    calls, failNext(store) { fail = store; }, dump(store) { return structuredClone([...data.get(store).values()]); },
    transaction(names, mode, operation) {
      const work = tail.then(async () => {
        calls.push({ names: [...names], mode });
        const snapshot = mode === 'readwrite' ? new Map([...data].map(([name, rows]) => [name, new Map([...rows].map(([key, value]) => [key, structuredClone(value)]))])) : data;
        function table(name) { if (!names.includes(name)) throw Error('Unscoped store access');return snapshot.get(name); }
        function writable(name) { if (mode !== 'readwrite') throw Error('Readonly write');if (fail === name) { fail = null;throw Error('STORAGE_WRITE_FAILED'); }return table(name); }
        const io = {
          get: async (name, key) => structuredClone(table(name).get(key)), all: async name => structuredClone([...table(name).values()]),
          put: async (name, value) => writable(name).set(name === 'state' ? value.key : value.id, structuredClone(value)),
          remove: async (name, key) => writable(name).delete(key), clear: async name => writable(name).clear(),
        };
        const result = await operation(io);if (mode === 'readwrite') data = snapshot;return result;
      });
      tail = work.catch(() => {});return work;
    },
  };
}
