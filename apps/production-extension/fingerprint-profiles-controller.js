// E22-19 / ADR-066: exact owned Options UI, using the existing configuration CAS writer.
import { validateApiConfiguration } from './api-configuration.js';
import { FingerprintProfileError, snapshotFingerprintProfile } from './fingerprint-profiles.js';
// ADR-107 round 5: the 7-day trash, the profile-to-proxy links and temporary profiles. Each owns one small machine-local storage key.
import { createTrashStore } from './fingerprint-trash.js';
import { createBundleStore } from './identity-bundles.js';
import { createTemporaryStore, temporaryLabel, revertTemporaryConfiguration } from './fingerprint-temporary.js';
// ADR-107: the proxy connection state is read through the Options-only proxy port, one request, then the port is closed again.
import { createProxyClient } from './proxy-client.js';
const FAILURES = new Set(['stale-revision', 'invalid-profile', 'invalid-value', 'inactive', 'busy', 'operation-failed', 'storage-error', 'early-access-required', 'privacy-permission-required', 'no-access']);
const fail = code => { throw new FingerprintProfileError(FAILURES.has(code) ? code : 'operation-failed'); };
const bounded = (value, max = 4096) => typeof value === 'string' && value.length <= max ? value : '';

// U1: the snapshot of this real browser lives in this page's memory only; this module never sends, stores or exports it.
// Every real-environment field is optional, bounded plain data and skipped when its read fails or looks hostile.
// Unverified heuristic: devicePixelRatio and the outer size follow browser zoom and docked panels, so they are hints, not facts.
const attempt = read => { try { return read(); } catch { return undefined; } };
const peek = (object, key) => attempt(() => object?.[key]);
const whole = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max ? value : undefined;
const ratio = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 16 ? Math.round(value * 1000) / 1000 : undefined;
// Version shapes as Chrome prints them (platformVersion 19.0.0, full version 156.0.8078.80); the digit counts bound the length.
const PLATFORM_VERSION = /^\d{1,4}\.\d{1,5}\.\d{1,5}$/u, BUILD_VERSION = /^\d{1,4}(?:\.\d{1,5}){1,3}$/u, LIST_VERSION = /^\d{1,4}(?:\.\d{1,5}){0,3}$/u;
const shaped = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : undefined;
const majorOf = value => { const number = Number.parseInt(value, 10); return number > 0 && number < 1000 ? number : undefined; };
const systemOf = value => typeof value !== 'string' ? undefined : /^win/iu.test(value) ? 'windows' : /^mac/iu.test(value) ? 'mac' : /^linux/iu.test(value) ? 'linux' : undefined;
const compact = object => { const result = {}; for (const [key, value] of Object.entries(object)) if (value !== undefined) result[key] = value; return Object.keys(result).length ? result : undefined; };
const HIGH_ENTROPY_TIMEOUT_MS = 500;
const FIRST_PARTY_BRANDS = new Set(['Chromium', 'Google Chrome', 'Microsoft Edge']), GREASE_BRAND = /^Not.{1,3}A.{1,3}Brand$/iu;
function realEnvironment(navigator, hints, high) {
  const agent = bounded(peek(navigator, 'userAgent')), brands = attempt(() => Array.from(hints?.brands ?? []).slice(0, 16)) ?? [];
  const has = name => brands.some(item => item?.brand === name), versionOf = name => majorOf(brands.find(item => item?.brand === name)?.version);
  // Build numbers and the full brand list are passed on only for plain Chrome or Edge (Chromium plus its own brand and the grease entry);
  // another Chromium vendor would otherwise leak its own brand into a Chrome claim.
  const plain = brands.length > 0 && brands.every(item => FIRST_PARTY_BRANDS.has(item?.brand) || GREASE_BRAND.test(item?.brand ?? ''));
  const edge = has('Microsoft Edge') || /\bEdg\/\d/u.test(agent), chromium = edge || has('Google Chrome') || has('Chromium') || /\bChrome\/\d/u.test(agent);
  const uaMajor = chromium ? (edge ? versionOf('Microsoft Edge') : versionOf('Google Chrome')) ?? versionOf('Chromium') ?? majorOf((edge ? /\bEdg\/(\d+)/u : /\bChrome\/(\d+)/u).exec(agent)?.[1]) : undefined;
  const display = peek(globalThis, 'screen'), side = (object, key) => whole(peek(object, key), 65535);
  const hintPlatform = peek(hints, 'platform');
  return compact({
    hardwareConcurrency: whole(peek(navigator, 'hardwareConcurrency'), 1024), devicePixelRatio: ratio(peek(globalThis, 'devicePixelRatio')),
    screen: side(display, 'width') && side(display, 'height') ? compact({ width: side(display, 'width'), height: side(display, 'height'), availWidth: side(display, 'availWidth'), availHeight: side(display, 'availHeight'), colorDepth: whole(peek(display, 'colorDepth'), 64) }) : undefined,
    outer: side(globalThis, 'outerWidth') && side(globalThis, 'outerHeight') ? { width: side(globalThis, 'outerWidth'), height: side(globalThis, 'outerHeight') } : undefined,
    timeZone: attempt(() => bounded(Intl.DateTimeFormat().resolvedOptions().timeZone, 128)) || undefined,
    uaMajor, brand: edge ? 'edge' : chromium ? 'chrome' : undefined,
    // userAgentData.platform decides; navigator.platform only stands in when the browser has no usable client-hint platform at all.
    platform: systemOf(typeof hintPlatform === 'string' && hintPlatform ? hintPlatform : peek(navigator, 'platform')),
    platformVersion: high.platformVersion, uaFullVersion: plain ? high.uaFullVersion : undefined, fullVersionList: plain ? high.fullVersionList : undefined });
}
// High-entropy client hints are asynchronous; a missing API, a failure or a slow answer simply leaves the fields out.
async function readHighEntropy() {
  const hints = peek(globalThis.navigator, 'userAgentData');
  if (typeof peek(hints, 'getHighEntropyValues') !== 'function') return {};
  let timer;
  try {
    const answer = await Promise.race([hints.getHighEntropyValues(['platformVersion', 'uaFullVersion', 'fullVersionList']), new Promise(resolve => { timer = setTimeout(resolve, HIGH_ENTROPY_TIMEOUT_MS); })]);
    if (!answer || typeof answer !== 'object') return {};
    const list = Array.isArray(answer.fullVersionList) ? answer.fullVersionList.slice(0, 16).map(item => ({ brand: bounded(item?.brand, 128), version: shaped(item?.version, LIST_VERSION) })).filter(item => item.brand && item.version) : [];
    return compact({ platformVersion: shaped(answer.platformVersion, PLATFORM_VERSION), uaFullVersion: shaped(answer.uaFullVersion, BUILD_VERSION), fullVersionList: list.length ? list : undefined }) ?? {};
  } catch { return {}; } finally { clearTimeout(timer); }
}
// ADR-107 (b): more facts about THIS browser, for hints only. They stay in this page's memory: never stored, sent, exported or logged.
// The GPU is read from one WebGL context (no draw call, no readPixels, no shader) that is released at once; WebGPU only asks for an
// adapter (no device). Every failure, timeout or hostile value leaves the field out, which the UI shows as «not checked».
export const GPU_CAPS = Object.freeze(['MAX_TEXTURE_SIZE', 'MAX_VIEWPORT_DIMS', 'MAX_RENDERBUFFER_SIZE', 'MAX_SAMPLES', 'MAX_COMBINED_TEXTURE_IMAGE_UNITS', 'MAX_VERTEX_UNIFORM_VECTORS']);
export const GPU_TEXT_MAX = 512, WEBGPU_TIMEOUT_MS = 4000, PROXY_TIMEOUT_MS = 4000;
const CAP_MAX = 1 << 20, gpuText = value => typeof value === 'string' && value.length > 0 && value.length <= GPU_TEXT_MAX ? value : undefined;
const shortText = value => typeof value === 'string' && value.length <= 128 ? value : undefined;
function memoryFacts(env) {
  const memory = peek(env.navigator, 'deviceMemory'), heap = peek(peek(env.performance, 'memory'), 'jsHeapSizeLimit');
  return { deviceMemory: typeof memory === 'number' && Number.isFinite(memory) && memory > 0 && memory <= 1024 ? memory : undefined, jsHeapSizeLimit: whole(heap, Number.MAX_SAFE_INTEGER) };
}
export function readWebGl(doc) {
  let canvas, gl;
  try {
    canvas = typeof peek(doc, 'createElement') === 'function' ? attempt(() => doc.createElement('canvas')) : undefined;
    if (!canvas || typeof peek(canvas, 'getContext') !== 'function') return undefined;
    gl = attempt(() => canvas.getContext('webgl2'));
    const webgl2 = Boolean(gl);
    if (!gl) gl = attempt(() => canvas.getContext('webgl'));
    if (!gl || typeof peek(gl, 'getParameter') !== 'function') return undefined;
    const debug = attempt(() => gl.getExtension('WEBGL_debug_renderer_info'));
    const unmasked = key => { const name = peek(debug, key); return Number.isInteger(name) ? gpuText(attempt(() => gl.getParameter(name))) : undefined; };
    const caps = {};
    for (const key of GPU_CAPS) {
      const name = peek(gl, key); if (!Number.isInteger(name)) continue;
      const value = attempt(() => gl.getParameter(name));
      if (key === 'MAX_VIEWPORT_DIMS') { const pair = attempt(() => value?.length === 2 ? [whole(value[0], CAP_MAX), whole(value[1], CAP_MAX)] : undefined); if (pair?.[0] && pair[1]) caps[key] = pair; }
      else { const number = whole(value, CAP_MAX); if (number) caps[key] = number; }
    }
    return compact({ vendor: unmasked('UNMASKED_VENDOR_WEBGL'), renderer: unmasked('UNMASKED_RENDERER_WEBGL'), caps: Object.keys(caps).length ? caps : undefined, webgl2 });
  } finally { attempt(() => gl?.getExtension('WEBGL_lose_context')?.loseContext()); }
}
// `null` is a fact (no WebGPU or no adapter); `undefined` means the answer did not come in time or failed.
export async function readWebGpu(navigator, timeoutMs = WEBGPU_TIMEOUT_MS) {
  const gpu = peek(navigator, 'gpu');
  if (gpu === undefined || gpu === null) return null;
  if (typeof peek(gpu, 'requestAdapter') !== 'function') return undefined;
  let timer;
  const late = Symbol('late'), deadline = new Promise(resolve => { timer = setTimeout(() => resolve(late), timeoutMs); });
  try {
    const adapter = await Promise.race([gpu.requestAdapter(), deadline]);
    if (adapter === late) return undefined;
    if (!adapter) return null;
    let info = peek(adapter, 'info');
    if ((!info || typeof info !== 'object') && typeof peek(adapter, 'requestAdapterInfo') === 'function') info = await Promise.race([adapter.requestAdapterInfo(), deadline]);
    if (!info || info === late || typeof info !== 'object') return undefined;
    const fallback = peek(info, 'isFallbackAdapter') ?? peek(adapter, 'isFallbackAdapter');
    return compact({ vendor: shortText(peek(info, 'vendor')), architecture: shortText(peek(info, 'architecture')), subgroupMinSize: whole(peek(info, 'subgroupMinSize'), 1024), subgroupMaxSize: whole(peek(info, 'subgroupMaxSize'), 1024), isFallbackAdapter: typeof fallback === 'boolean' ? fallback : undefined }) ?? undefined;
  } catch { return undefined; } finally { clearTimeout(timer); }
}
// One read-only `load` through the Options-only proxy port (the same validated snapshot the proxy workspace uses); the port is closed
// right after. undefined: the port refused, the answer was late or it was not a snapshot.
export async function loadProxySnapshot(api, factory, env, timeoutMs = PROXY_TIMEOUT_MS) {
  let client, timer;
  try {
    client = factory(api, { env });
    const snapshot = await Promise.race([client.load(), new Promise(resolve => { timer = setTimeout(() => resolve(undefined), timeoutMs); })]);
    return typeof snapshot?.status?.state === 'string' ? snapshot : undefined;
  } catch { return undefined; } finally { clearTimeout(timer); attempt(() => client?.dispose()); }
}
const COUNTRY = /^[A-Z]{2}$/u, safeText = (value, max) => typeof value === 'string' && value.length <= max ? value : '';
// The proxy snapshot is plain validated data: it is read as own data properties only, so no accessor can run.
const own = (object, key) => object !== null && typeof object === 'object' ? Object.getOwnPropertyDescriptor(object, key)?.value : undefined;
// ADR-107 round 5: the connected proxy's state for the hints, with the user's own country tag of that profile when it has one.
function describeProxyState(snapshot) {
  const state = snapshot?.status?.state;
  if (typeof state !== 'string') return undefined;
  const mapped = state === 'connected' ? 'connected' : state === 'off' ? 'disconnected' : state === 'conflict' ? 'conflict' : 'unknown';
  const profiles = own(own(snapshot, 'configuration'), 'profiles'), connected = mapped === 'connected' && Array.isArray(profiles) ? profiles.find(profile => own(profile, 'id') === own(own(snapshot, 'status'), 'profileId')) : undefined, country = own(connected, 'country');
  return typeof country === 'string' && COUNTRY.test(country) ? { state: mapped, country } : { state: mapped };
}
export async function readProxyState(api, factory, env, timeoutMs = PROXY_TIMEOUT_MS) { return describeProxyState(await loadProxySnapshot(api, factory, env, timeoutMs)); }
// ADR-107 round 5: the saved proxies as plain bounded data for the "Proxy of this profile" select: { profiles, privacy, connectedId }.
// The credentials never leave the Proxy workspace: a snapshot holds only id, name, type, host, port, the native flag and the country tag.
export const PROXY_LIST_MAX = 100;
export function describeProxyList(snapshot) {
  const source = own(own(snapshot, 'configuration'), 'profiles');
  if (!Array.isArray(source)) return undefined;
  const list = [];
  for (const profile of source.slice(0, PROXY_LIST_MAX)) {
    const id = safeText(own(profile, 'id'), 64);
    if (!id) continue;
    const country = own(profile, 'country');
    list.push({ id, name: safeText(own(profile, 'name'), 96), type: safeText(own(profile, 'type'), 16), host: safeText(own(profile, 'host'), 253) || null, port: whole(own(profile, 'port'), 65535) ?? null,
      native: own(profile, 'native') === true, ...(typeof country === 'string' && COUNTRY.test(country) ? { country } : {}) });
  }
  const status = own(snapshot, 'status'), connectedId = own(status, 'state') === 'connected' && list.some(profile => profile.id === own(status, 'profileId')) ? own(status, 'profileId') : null;
  const settings = own(snapshot, 'configuration');
  return { profiles: list, connectedId, privacy: own(settings, 'protectWebRTC') === true || own(settings, 'disablePrediction') === true };
}
// `platform` is now the OS family ('windows' | 'mac' | 'linux') the generator compares against; the raw navigator.platform string is kept as `navigatorPlatform`.
function environmentSnapshot(high = {}, extra = {}) {
  const navigator = globalThis.navigator;
  if (!navigator) return {};
  const hints = navigator.userAgentData;
  return { userAgent: bounded(navigator.userAgent), appVersion: bounded(navigator.appVersion), navigatorPlatform: bounded(navigator.platform), vendor: bounded(navigator.vendor),
    language: bounded(navigator.language, 64), languages: Array.from(navigator.languages ?? []).slice(0, 32).map(value => bounded(value, 64)),
    hasOscpu: 'oscpu' in navigator, oscpu: bounded(navigator.oscpu), uaData: hints ? { brands: Array.from(hints.brands ?? []).slice(0, 16).map(value => ({ brand: bounded(value.brand, 128), version: bounded(value.version, 128) })), mobile: hints.mobile === true, platform: bounded(hints.platform, 128) } : null,
    ...realEnvironment(navigator, hints, high), ...compact({ ...memoryFacts(globalThis), gpu: extra.gpu, proxy: extra.proxy }) };
}
export function createFingerprintProfilesController(browserApi = globalThis.chrome, { tabId = null, onInvalidate = () => {}, onEnvironment = () => {}, proxyFactory = createProxyClient, gpuTimeoutMs = WEBGPU_TIMEOUT_MS, proxyTimeoutMs = PROXY_TIMEOUT_MS } = {}) {
  const api = globalThis.browser?.runtime?.id === browserApi?.runtime?.id ? globalThis.browser : browserApi;
  let disposed = false, visible = true, busy = false, epoch = 0, reading = 0, saved = null, stale = false, high = {}, highRead = null, extra = {}, extraRead = null, proxyList = null;
  // The browser identity does not change while this view lives, so the asynchronous hints are read once.
  const readHints = () => highRead ??= readHighEntropy().then(value => { high = value; });
  // The slower facts (GPU, WebGPU adapter, proxy state) never delay a load: they arrive once, then `onEnvironment` repaints the hints.
  const readExtra = () => extraRead ??= (async () => {
    const webgl = readWebGl(globalThis.document);
    const [webgpu, snapshot] = await Promise.all([readWebGpu(globalThis.navigator, gpuTimeoutMs), loadProxySnapshot(api, proxyFactory, globalThis, proxyTimeoutMs)]);
    const gpu = webgl || webgpu !== undefined ? compact({ ...(webgl ?? {}), webgpu }) : undefined, proxy = describeProxyState(snapshot);
    // The same answer feeds the "Proxy of this profile" select, so opening a profile does not open the proxy port a second time.
    if (snapshot) proxyList = describeProxyList(snapshot) ?? null;
    extra = compact({ gpu, proxy }) ?? {};
    if (disposed) return;
    if (saved) saved = { ...saved, environment: environmentSnapshot(high, extra) };
    try { onEnvironment(environmentSnapshot(high, extra)); } catch { /* A repaint has no privileged effects. */ }
  })().catch(() => {});
  function check(token = epoch) {
    if (disposed || !visible || token !== epoch || !(tabId === null || Number.isSafeInteger(tabId) && tabId >= 0 && tabId <= 2147483647)) fail('inactive');
    try {
      const own = new URL(api.runtime.getURL('options.html')), actual = new URL(globalThis.location.href);
      if (globalThis.window !== globalThis.window.top || !['chrome-extension:', 'moz-extension:'].includes(own.protocol) || actual.protocol !== own.protocol || actual.host !== own.host || actual.pathname !== own.pathname) fail('inactive');
    } catch { fail('inactive'); }
  }
  function state(response) {
    if (!response || response.schemaVersion !== 1 || response.type !== 'api-config-state' || !Number.isSafeInteger(response.revision) || response.revision < 0 || !['ready', 'inactive', 'error'].includes(response.registration) || typeof response.reloadRequired !== 'boolean') fail(response?.code);
    const checked = validateApiConfiguration(response.configuration); if (!checked.ok) fail('operation-failed');
    return { configuration: checked.value, revision: response.revision, registration: response.registration, reloadRequired: response.reloadRequired,
      earlyAccess: response.earlyAccess ?? 'unsupported', environment: environmentSnapshot(high, extra) };
  }
  async function load() {
    check(); if (busy) fail('busy'); const token = epoch, sequence = ++reading, hints = readHints(); void readExtra();
    let response; try { response = await api.runtime.sendMessage({ schemaVersion: 1, type: 'ui-api-config-get', tabId }); } catch { fail('operation-failed'); }
    await hints; check(token); if (sequence !== reading) fail('inactive'); saved = state(response); stale = false; return saved;
  }
  async function commit(configuration, expectedRevision) {
    check(); if (busy) fail('busy'); if (!saved || stale || expectedRevision !== saved.revision) fail('stale-revision');
    const checked = validateApiConfiguration(configuration); if (!checked.ok) fail('invalid-profile');
    const token = epoch; busy = true; ++reading;
    try {
      let response; try { response = await api.runtime.sendMessage({ schemaVersion: 1, type: 'ui-api-config-set', tabId, expectedRevision, configuration: checked.value }); } catch { fail('operation-failed'); }
      check(token); const next = state(response); saved = next; stale = false; return next;
    } finally { busy = false; }
  }
  function invalidate(reason) { ++epoch; ++reading; stale = true; try { onInvalidate({ reason }); } catch { /* The view has no privileged effects. */ } }
  function changed(changes, area) {
    if (disposed || !visible || busy || area !== 'local' || !Object.hasOwn(changes, 'api-configuration:v1')) return;
    // Storage can deliver the echo of our own accepted write after the CAS reply; only another revision is external.
    const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
    const revision = own(own(own(changes, 'api-configuration:v1'), 'newValue'), 'revision');
    if (saved && Number.isSafeInteger(revision) && revision === saved.revision) return;
    invalidate('configuration');
  }
  function revoked() { if (!disposed) invalidate('permissions'); }
  api.storage?.onChanged?.addListener(changed); api.permissions?.onRemoved?.addListener(revoked);
  // ADR-107 (c): an explicit click resizes the window that shows this page to the claimed screen; nothing else is changed. The answer
  // is the size the browser actually kept (a window manager or Firefox may refuse or clamp it).
  async function fitWindow(target) {
    check();
    const width = whole(target?.width, 65535), height = whole(target?.height, 65535), windows = api.windows;
    if (!width || !height) fail('invalid-value');
    if (typeof windows?.getCurrent !== 'function' || typeof windows.update !== 'function') fail('operation-failed');
    let result;
    try { const current = await windows.getCurrent(); if (!Number.isSafeInteger(current?.id)) fail('operation-failed'); result = await windows.update(current.id, { state: 'normal', width, height }); }
    catch (failure) { if (failure instanceof FingerprintProfileError) throw failure; fail('operation-failed'); }
    return { requested: { width, height }, actual: { width: whole(result?.width, 65535) ?? null, height: whole(result?.height, 65535) ?? null } };
  }
  // --- ADR-107 round 5: trash, profile-to-proxy links, temporary profiles and the proxy list. The stores are created on first use;
  // every call re-checks that this view is still the live, exact Options page. Nothing here writes the API configuration except through
  // `commit` (the revision-checked write).
  const stores = {}, now = () => Date.now();
  const trashStore = () => stores.trash ??= createTrashStore(api.storage, { now }), bundleStore = () => stores.bundles ??= createBundleStore(api.storage), temporaryStore = () => stores.temporary ??= createTemporaryStore(api.storage);
  // Without a working storage.local (never in a real browser) the trash and the links are not offered, so a delete is never made unrecoverable by a missing store.
  const local = ['get', 'set', 'remove'].every(name => typeof api.storage?.local?.[name] === 'function');
  // A guarded call answers with a rejected promise (never a synchronous throw), so a caller can always `await` it.
  const guarded = task => (...args) => { try { check(); return task(...args); } catch (failure) { return Promise.reject(failure); } };
  const trash = !local ? null : {
    read: guarded(library => trashStore().read({ library })), add: guarded((profile, index, library) => trashStore().add(profile, index, { library })),
    remove: guarded(id => trashStore().remove(id)), empty: guarded(() => trashStore().empty()), watch: callback => trashStore().watch(callback)
  };
  const bundles = !local ? null : {
    read: guarded(profileIds => bundleStore().read({ profileIds })), link: guarded((profileId, proxy, context) => bundleStore().link(profileId, proxy, context)),
    unlink: guarded((profileId, context) => bundleStore().unlink(profileId, context)), watch: callback => bundleStore().watch(callback)
  };
  // The saved proxies: the answer read when the page opened (or the last refresh), unless a fresh read is asked for. null = the Proxy
  // workspace did not answer.
  const proxies = {
    async load({ fresh = false } = {}) {
      check();
      if (proxyList && !fresh) return proxyList;
      const snapshot = await loadProxySnapshot(api, proxyFactory, globalThis, proxyTimeoutMs);
      proxyList = snapshot ? describeProxyList(snapshot) ?? null : null;
      if (snapshot) { const proxy = describeProxyState(snapshot); extra = compact({ ...extra, proxy }) ?? {}; }
      return proxyList;
    },
    // The user's click is the explicit connect: the permissions are requested first (inside the click, so a prompt is allowed), the
    // caller applies its profile, and then finish() connects the chosen saved proxy. No setting of the Proxy workspace is changed and
    // no automatic connection is created. finish() never throws: { ok: true } or { ok: false, code }.
    begin(proxy) {
      check();
      const client = proxyFactory(api, { env: globalThis });
      let access;
      try { access = client.requestAccess({ native: proxy?.native === true, privacy: proxyList?.privacy === true }); } catch (failure) { access = Promise.reject(failure); }
      access.catch(() => {});
      const codeOf = failure => /^[a-z][a-z-]{0,47}$/u.test(failure?.code ?? '') ? failure.code : 'operation-failed';
      return {
        async finish() {
          try {
            await access;
            const snapshot = await client.connect(proxy.id);
            if (snapshot?.status?.state === 'connected' && snapshot.status.profileId === proxy.id) { proxyList = describeProxyList(snapshot) ?? proxyList; return { ok: true }; }
            return { ok: false, code: /^[a-z][a-z-]{0,47}$/u.test(snapshot?.status?.code ?? '') ? snapshot.status.code : 'operation-failed' };
          } catch (failure) { return { ok: false, code: codeOf(failure) }; } finally { attempt(() => client.dispose()); }
        },
        cancel() { attempt(() => client.dispose()); }
      };
    }
  };
  // Starts a temporary profile: `configuration` is the complete configuration to apply (a library profile laid over the saved rows, or a
  // generated identity). The state before is remembered as a profile snapshot of the SAVED rows, unless a temporary profile is already
  // active: then its original snapshot is kept (never stacked). The record is written before the configuration, so an interruption can
  // never leave an applied temporary state that nothing remembers.
  async function startTemporary(configuration, name) {
    check(); if (busy) fail('busy'); if (!saved || stale) fail('stale-revision');
    const store = temporaryStore(), label = temporaryLabel(name);
    if (!store.available()) fail('operation-failed');
    if (!label) fail('invalid-value');
    const next = validateApiConfiguration(configuration); if (!next.ok) fail('invalid-profile');
    let before; try { before = await store.read(); } catch { fail('storage-error'); }
    const previous = before.record?.previous ?? snapshotFingerprintProfile(saved.configuration, 'previous');
    const startedAt = now();
    try { await store.begin({ startedAt, label, previous }); } catch { fail('storage-error'); }
    try { const state = await commit(next.value, saved.revision); return { state, temporary: { active: true, label, startedAt } }; }
    catch (failure) {
      // The configuration was not changed: go back to what was recorded before this attempt.
      try { if (before.record) await store.begin({ startedAt: before.record.startedAt, label: before.record.label, previous: before.record.previous }); else await store.end(); } catch { /* A leftover record is reverted by the next start. */ }
      throw failure;
    }
  }
  // Ends the temporary profile: the remembered rows go back over the CURRENT saved configuration (the masters, the sites and the library
  // stay as they are), then the record goes. A failed write keeps the record, so ending can be tried again.
  async function endTemporary() {
    check(); if (busy) fail('busy'); if (!saved || stale) fail('stale-revision');
    const store = temporaryStore();
    let before; try { before = await store.read(); } catch { fail('storage-error'); }
    if (!before.record) { try { await store.end(); } catch { /* Nothing to restore. */ } return { state: saved, ended: false }; }
    const restored = revertTemporaryConfiguration(saved.configuration, before.record.previous);
    if (!restored) fail('invalid-profile');
    const state = restored.changed ? await commit(restored.configuration, saved.revision) : saved;
    try { await store.end(); } catch { fail('storage-error'); }
    return { state, ended: true };
  }
  const temporary = {
    available: () => temporaryStore().available(),
    async read() { check(); const { record, live } = await temporaryStore().read(); return { active: record !== null, label: record?.label ?? '', startedAt: record?.startedAt ?? null, live }; },
    start: startTemporary, end: endTemporary
  };
  return { load, commit, fitWindow, trash, bundles, proxies, temporary, environment: () => environmentSnapshot(high, extra),
    setVisible(active) { const next = active === true; if (visible !== next) { visible = next; ++epoch; ++reading; } },
    dispose() { if (disposed) return; disposed = true; ++epoch; ++reading; saved = null; api.storage?.onChanged?.removeListener(changed); api.permissions?.onRemoved?.removeListener(revoked); } };
}
