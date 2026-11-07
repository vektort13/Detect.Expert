// Shared fixtures of the round-5 profile library tests (tags and notes, trash, temporary profiles, profile-to-proxy link).
import { createApiConfiguration, updateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice, snapshotFingerprintProfile, storeFingerprintProfile } from '../../apps/production-extension/fingerprint-profiles.js';

export const clone = value => structuredClone(value);
export const turn = () => new Promise(resolve => setImmediate(resolve));
export const ENVIRONMENT = Object.freeze({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', uaMajor: 153, brand: 'chrome', platform: 'windows', platformVersion: '19.0.0', hardwareConcurrency: 8 });
// Characters the contract refuses, built from code points (never typed).
export const UNSAFE = Object.freeze({ bell: String.fromCharCode(7), tab: String.fromCharCode(9), rlo: String.fromCodePoint(0x202e), lrm: String.fromCodePoint(0x200e), alm: String.fromCodePoint(0x61c), isolate: String.fromCodePoint(0x2066), c1: String.fromCodePoint(0x85) });
export const LF = String.fromCharCode(10), CR = String.fromCharCode(13);

let counter = 0;
// A realistic profile record from the real generator; `id` and `label` make it distinct. The rows are generated once per seed and cached.
const rowsCache = new Map();
export function device(label, { seed = 7, id = undefined, tags = [], note = '', input = {}, rows = {} } = {}) {
  const key = JSON.stringify([seed, input, rows]);
  let configuration = rowsCache.get(key);
  if (!configuration) {
    configuration = generateConsistentDevice(createApiConfiguration(), { deviceType: 'desktop', os: 'windows-11', browser: 'chrome', version: 153, protection: 'balanced', seed, ...input }, ENVIRONMENT).configuration;
    for (const [rowId, value] of Object.entries(rows)) configuration = updateApiConfiguration(configuration, rowId, { mode: 'custom', selected: { kind: 'value', value } }).value;
    rowsCache.set(key, configuration);
  }
  const profile = snapshotFingerprintProfile(configuration, label, id ?? 'fp-' + (++counter).toString(16).padStart(32, '0'));
  return { ...profile, tags: [...tags].sort(), note };
}
export function library(profiles, base = createApiConfiguration()) {
  let configuration = base;
  for (const profile of profiles) configuration = storeFingerprintProfile(configuration, profile);
  return configuration;
}

// A fake browser storage: local (and optionally session) areas with call logs and change events.
export function fakeStorage({ local = {}, session = null, failSet = null } = {}) {
  const data = { local: clone(local), session: clone(session ?? {}) }, log = [], listeners = new Set();
  const area = name => ({
    async get(key) { return Object.hasOwn(data[name], key) ? { [key]: clone(data[name][key]) } : {}; },
    async set(items) {
      if (failSet && failSet(name, items)) throw new Error('write refused');
      log.push([name, 'set', Object.keys(items)]);
      const changes = {}; for (const [key, value] of Object.entries(items)) { changes[key] = { newValue: clone(value) }; data[name][key] = clone(value); }
      for (const listener of listeners) listener(changes, name);
    },
    async remove(key) {
      log.push([name, 'remove', [key]]);
      const changes = {}; if (Object.hasOwn(data[name], key)) changes[key] = {};
      delete data[name][key];
      for (const listener of listeners) listener(changes, name);
    }
  });
  return { data, log, local: area('local'), ...(session === null ? {} : { session: area('session') }), onChanged: { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) } };
}
