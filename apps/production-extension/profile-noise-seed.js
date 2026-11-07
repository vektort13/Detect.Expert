// ADR-106: Canvas and Math noise keys follow the profile, not the browser session.
// One random 256-bit root lives in chrome.storage.local; it is never exported, never part of a
// portable profile and never sent to a page. Each key is HMAC-SHA256(root, purpose NUL identity),
// where `identity` digests the applied Custom device rows. The same profile therefore keeps its
// noise across restarts and any change of the profile derives a new one. The Canvas and Math
// rows themselves are excluded so that tuning the noise does not rotate it.
export const PROFILE_NOISE_ROOT_KEY = 'profile-noise-root:v1';
export const NOISE_IDENTITY_EXCLUDED = Object.freeze(['canvas-readback', 'math-transcendentals']);
const HEX64 = /^[a-f0-9]{64}$/;
const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
const bytesOf = text => Uint8Array.from(text.match(/../g), pair => parseInt(pair, 16));
const text = new TextEncoder();
const pending = new WeakMap();

// Canonical JSON with sorted object keys: equal values always digest equally.
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}

// The identity of an applied profile: its DISTINCT Custom rows in canonical order, without the noise rows.
// Site scopes repeat the global rows they do not override, so duplicates must not count: adding or
// removing an exact-site exception that changes no Custom value keeps the key.
export function profileIdentity(entries) {
  const rows = entries.filter(entry => entry?.mode === 'custom' && !NOISE_IDENTITY_EXCLUDED.includes(entry.id)).map(entry => stable([entry.id, entry.selected]));
  return [...new Set(rows)].sort().join('\n');
}

async function loadRoot(storage) {
  const saved = (await storage.get(PROFILE_NOISE_ROOT_KEY))[PROFILE_NOISE_ROOT_KEY];
  if (typeof saved === 'string' && HEX64.test(saved)) return saved;
  const bytes = new Uint8Array(32); globalThis.crypto.getRandomValues(bytes);
  const root = hex(bytes);
  await storage.set({ [PROFILE_NOISE_ROOT_KEY]: root });
  return root;
}

// ADR-107: further private per-profile keys from the same root. The portable `seed` fields of
// audio-fingerprint / webgl-readback stay in the profile only as part of its identity; pages are
// keyed by these private values so a published profile JSON cannot be used to undo the noise.
export const AUDIO_NOISE_PURPOSE = 'audio-fingerprint:v1';
export const WEBGL_NOISE_PURPOSE = 'webgl-readback:v1';
export const NETWORK_NOISE_PURPOSE = 'network-information:v1';
export class RowNoiseSeed {
  constructor(api, rowId, purpose, noise = new ProfileNoiseSeeds(api)) { this.rowId = rowId; this.purpose = purpose; this.noise = noise; }
  async prepare(entries) {
    if (!entries.some(entry => entry.id === this.rowId && entry.mode === 'custom' && entry.selected?.kind === 'value')) return null;
    return this.noise.derive(this.purpose, entries);
  }
}

export class ProfileNoiseSeeds {
  constructor(api) { this.api = api; }
  // Concurrent requests (Canvas and Math at once, or a restarted worker) share one root.
  async root() {
    const storage = this.api.storage?.local;
    if (!storage) throw Error('Profile noise storage is unavailable.');
    if (!pending.has(storage)) {
      const operation = loadRoot(storage);
      pending.set(storage, operation);
      const forget = () => { if (pending.get(storage) === operation) pending.delete(storage); };
      operation.then(forget, forget);
    }
    return pending.get(storage);
  }
  async derive(purpose, entries) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw Error('Profile noise needs Web Crypto.');
    const root = await this.root();
    const key = await subtle.importKey('raw', bytesOf(root), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(new Uint8Array(await subtle.sign('HMAC', key, text.encode(purpose + '\0' + profileIdentity(entries)))));
  }
}
