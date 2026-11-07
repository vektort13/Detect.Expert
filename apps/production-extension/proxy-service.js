// ADR-070: Options-only commands; browser policy remains closed when a native relay fails.
import { PROXY_PORT, PROXY_STORAGE_KEY, PROXY_NATIVE_RESTART_KEY, PROXY_NATIVE_HOST, PROXY_LIMITS, PROXY_DIRECT_TYPES, ProxyError, proxyFail, proxyRecord, proxyHost, proxyPort, proxyId, proxyCountry, proxyRoute, proxyNeedsNative, safeProxyError, createDefaultProxyConfiguration, validateProxyConfiguration, validateProxyProfileInput, validateProxyDiagnosticUrl, validateProxyDiagnosticResult, validateProxyProfileCheck, validateProxyConnection, validateProxyBundle, buildProxyPac, buildProxyInfo, isProxyUiSender, PROXY_SAFE_CODES } from './proxy-shared.js';
const clone = value => JSON.parse(JSON.stringify(value));
const safeCodes = new Set(PROXY_SAFE_CODES);
const blockedEndpoint = Object.freeze({ host: '127.0.0.1', port: 9 });
const own = (object, key) => Object.getOwnPropertyDescriptor(object ?? {}, key)?.value;
// Where the browser itself is pointed for a profile it can reach without the companion.
const routeOf = profile => ({ host: profile.host, port: profile.port, scheme: profile.type });
// PP-04/05: one authoritative item commits metadata and vault IDs together.
// Its configuration is the strict metadata schema, never a secret connection.
const VAULT_STATE_KEY = 'proxy-vault-state:v1';
const emptyVaultState = configuration => ({ version: 1, configuration: clone(configuration), nativeIds: {}, cleanup: [] });
function checkedVaultState(input, config) {
  if (input === undefined) return emptyVaultState(config);
  if (!proxyRecord(input) || Object.keys(input).length !== 4 || input.version !== 1 || !input.nativeIds || Object.getPrototypeOf(input.nativeIds) !== Object.prototype || !Array.isArray(input.cleanup) || input.cleanup.length > PROXY_LIMITS.profiles + 1 || Reflect.ownKeys(input.nativeIds).length > PROXY_LIMITS.profiles) proxyFail('invalid-config');
  const committed = validateProxyConfiguration(input.configuration);
  if (JSON.stringify(committed) !== JSON.stringify(config)) proxyFail('invalid-config');
  if (Reflect.ownKeys(input.nativeIds).some(key => { const descriptor = Object.getOwnPropertyDescriptor(input.nativeIds, key); return typeof key !== 'string' || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true; })) proxyFail('invalid-config');
  const nativeIds = {};
  for (const [id, vaultId] of Object.entries(input.nativeIds)) {
    proxyId(id); proxyId(vaultId);
    if (!config.profiles.some(profile => profile.id === id && profile.native)) proxyFail('invalid-config');
    nativeIds[id] = vaultId;
  }
  const live = config.profiles.filter(profile => profile.native).map(profile => own(nativeIds, profile.id) ?? profile.id);
  const cleanup = input.cleanup.map(id => proxyId(id));
  if (new Set(live).size !== live.length || new Set(cleanup).size !== cleanup.length || cleanup.some(id => live.includes(id))) proxyFail('invalid-config');
  return { version: 1, configuration: committed, nativeIds, cleanup };
}

function createNativeBroker(api, { timeout = PROXY_LIMITS.requestMs, onLost = () => {} } = {}) {
  let port = null, sequence = 0, hello = null;
  const pending = new Map();
  const lose = () => {
    port = null; hello = null;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new ProxyError('native-disconnected')); }
    pending.clear(); onLost();
  };
  function open() {
    if (port) return port;
    try { port = api.runtime.connectNative(PROXY_NATIVE_HOST); } catch { proxyFail('native-unavailable'); }
    const current = port;
    current.onDisconnect.addListener(() => { if (port === current) { void api.runtime.lastError; lose(); } });
    current.onMessage.addListener(message => {
      if (port !== current || !proxyRecord(message) || message.v !== 1 || typeof message.id !== 'string' || typeof message.ok !== 'boolean') { current.disconnect(); lose(); return; }
      const item = pending.get(message.id); if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer);
      if (!message.ok) { const code = own(message.error, 'code'); item.reject(new ProxyError(safeCodes.has(code) ? code : 'native-error', message.error)); return; }
      if (!proxyRecord(message.result)) { item.reject(new ProxyError('native-protocol')); return; }
      item.resolve(message.result);
    });
    return current;
  }
  function request(op, payload = {}) {
    const current = open(), id = 'proxy-' + (++sequence);
    return new Promise((resolve, reject) => {
      const item = { resolve, reject, timer: null };
      item.timer = setTimeout(() => { if (pending.get(id) !== item) return; current.disconnect(); if (port === current) lose(); }, timeout);
      pending.set(id, item);
      try { current.postMessage({ v: 1, id, op, ...payload }); } catch { pending.delete(id); clearTimeout(item.timer); reject(new ProxyError('native-unavailable')); }
    });
  }
  async function ensure() {
    if (hello) return hello;
    const result = await request('hello');
    const c = result.capabilities;
    if (result.version !== 1 || !proxyRecord(c) || ['socks5', 'vless', 'openvpn', 'vault'].some(key => typeof c[key] !== 'boolean') || ['http', 'https'].some(key => Object.hasOwn(c, key) && typeof c[key] !== 'boolean')) proxyFail('native-protocol');
    // An older companion has no http/https keys at all: that means "cannot dial an HTTP or HTTPS upstream".
    return hello = { available: true, version: 1, capabilities: { socks5: c.socks5, http: c.http === true, https: c.https === true, vless: c.vless, openvpn: c.openvpn, vault: c.vault } };
  }
  return { request, ensure, snapshot: () => hello ? clone(hello) : { available: false }, dispose() { if (port) { const current = port; current.disconnect(); if (port === current) lose(); } } };
}

export function installProxyService(browserApi = globalThis.chrome, { env = globalThis, privacyOverlay = null, nativeTimeout = PROXY_LIMITS.requestMs } = {}) {
  const api = env.browser?.runtime?.id === browserApi?.runtime?.id ? env.browser : browserApi;
  const firefox = typeof api?.runtime?.getBrowserInfo === 'function';
  const ports = new Set();
  let diagnostic = null;
  let restartPending = false, restartTimer = null, startupRetryTimer = null, startupReadAttempts = 0, storageUnavailable = false;
  const schedule = env.setTimeout ?? globalThis.setTimeout, cancelSchedule = env.clearTimeout ?? globalThis.clearTimeout;
  let configuration = createDefaultProxyConfiguration(), status = { state: 'off' }, endpoint = null, disposed = false, writing = false, loaded = false, expectedPac = null, revokePending = false, quarantine = false, firefoxConflict = false, releasedForSession = false;
  let vaultState = emptyVaultState(configuration);
  const nativeId = profile => own(vaultState.nativeIds, profile.id) ?? profile.id;
  const snapshot = () => ({ configuration: clone(configuration), status: clone(status), host: native.snapshot(), ...(diagnostic ? { diagnostic: clone(diagnostic) } : {}) });
  const notify = () => { const value = snapshot(); for (const port of ports) { try { port.postMessage({ v: 1, type: 'change', snapshot: value }); } catch { /* Disconnected UI. */ } } };
  const setStatus = (state, code, profileId = configuration.selectedId) => { if (state !== 'connected') diagnostic = null; const details = code instanceof ProxyError ? { code: code.code, ...(code.phase ? { phase: code.phase } : {}), ...(typeof code.retryable === 'boolean' ? { retryable: code.retryable } : {}) } : code ? { code } : {}; status = { state, ...details, ...(profileId ? { profileId } : {}), ...(endpoint && state === 'connected' ? { endpoint: { host: endpoint.host, port: endpoint.port } } : {}) }; notify(); };
  const native = createNativeBroker(api, { timeout: nativeTimeout, onLost() { if (!disposed && configuration.enabled && configuration.profiles.find(profile => profile.id === configuration.selectedId)?.native) { endpoint = blockedEndpoint; setStatus('blocked', 'native-disconnected'); /* Existing mandatory PAC points to the stopped local relay, without DIRECT. */ } } });
  async function contains(permissions) { try { return await api.permissions.contains({ permissions }) === true; } catch { return false; } }
  async function requireNativeAccess() {
    if (!await contains(['nativeMessaging'])) proxyFail('permission-required');
    // E22-27 / ADR-070: Chromium caches runtime methods in an existing context.
    // A granted optional permission does not recreate a missing native binding.
    if (typeof api.runtime.connectNative !== 'function') {
      if (!firefox) throw new ProxyError('reconnect-required', { phase: 'native', retryable: true });
      proxyFail('native-unavailable');
    }
  }
  async function requireAccess(config, nativeRequired = false) {
    if (!api.proxy || !await contains(['proxy'])) proxyFail('permission-required');
    if ((config.protectWebRTC || config.disablePrediction) && !await contains(['privacy'])) proxyFail('permission-required');
    if (nativeRequired) await requireNativeAccess();
  }
  async function overlay(active) {
    if (!privacyOverlay?.setActive) { if (active && (configuration.protectWebRTC || configuration.disablePrediction)) proxyFail('unsupported'); return; }
    const result = await privacyOverlay.setActive(active, { protectWebRTC: configuration.protectWebRTC, disablePrediction: configuration.disablePrediction });
    if (active && result?.status && !['applied', 'inactive'].includes(result.status)) proxyFail(result.status === 'permission-required' ? 'permission-required' : 'not-applied');
  }
  async function currentSetting() {
    if (!api.proxy?.settings?.get) proxyFail('unsupported');
    return await api.proxy.settings.get({ incognito: false });
  }
  async function ownership() {
    const current = await currentSetting();
    if (!['controllable_by_this_extension', 'controlled_by_this_extension'].includes(current?.levelOfControl)) { if (firefox) firefoxConflict = true; proxyFail('not-controllable'); }
    // Firefox get is read-only and has no private-window requirement. Its
    // native setting can identify static owners, but not competing onRequest listeners.
    if (firefox) { firefoxConflict = false; return; }
    if (current.levelOfControl === 'controlled_by_this_extension' && expectedPac !== null && current.value?.pacScript?.data !== expectedPac) proxyFail('not-controllable');
  }
  async function applyEndpoint(nextEndpoint) {
    const route = proxyRoute(nextEndpoint);
    if (firefox) { endpoint = route; return; }
    await ownership();
    const policy = quarantine ? { ...configuration, routing: { mode: 'all', proxyDomains: [], directDomains: [], bypassLocal: false } } : configuration;
    const pac = buildProxyPac(policy, route);
    // The browser evaluates only our literal generated PAC. No user-provided JavaScript.
    if (await api.proxy.settings.set({ value: { mode: 'pac_script', pacScript: { data: pac, mandatory: true } }, scope: 'regular' }) === false) proxyFail('not-applied');
    const actual = await currentSetting();
    if (actual?.levelOfControl !== 'controlled_by_this_extension' || actual.value?.mode !== 'pac_script' || actual.value?.pacScript?.data !== pac) proxyFail('not-applied');
    expectedPac = pac; endpoint = route;
  }
  async function persist(next, nextVaultState = null) {
    const checked = validateProxyConfiguration(next);
    if (checked.revision >= Number.MAX_SAFE_INTEGER) proxyFail('stale-revision');
    checked.revision = configuration.revision + 1;
    const checkedState = checkedVaultState({ ...(nextVaultState ?? vaultState), configuration: checked }, checked);
    try { await api.storage.local.set({ [PROXY_STORAGE_KEY]: checked, [VAULT_STATE_KEY]: checkedState }); }
    catch (error) { await unavailableStorage(error); throw error; }
    configuration = checked; vaultState = checkedState;
    return configuration;
  }
  async function persistVaultState(next) {
    const checked = checkedVaultState({ ...next, configuration }, configuration);
    try { await api.storage.local.set({ [VAULT_STATE_KEY]: checked }); }
    catch (error) { await unavailableStorage(error); throw error; }
    vaultState = checked;
  }
  function retryStorage() {
    if (disposed || releasedForSession || startupRetryTimer !== null || startupReadAttempts >= 3) return;
    const delay = [250, 1000, 4000][startupReadAttempts++];
    try {
      startupRetryTimer = schedule(() => {
        startupRetryTimer = null;
        if (disposed || releasedForSession || !storageUnavailable) return;
        if (writing || !loaded) { retryStorage(); return; }
        writing = true;
        initializeConfiguration().finally(() => { writing = false; if (revokePending) void reconcileRevocation(); });
      }, delay);
    } catch { startupRetryTimer = null; startupReadAttempts = 3; }
  }
  async function unavailableStorage(error) {
    storageUnavailable = true;
    if (disposed) return;
    if (releasedForSession) { setStatus('error', safeProxyError(error)); return; }
    quarantine = true; endpoint = blockedEndpoint;
    try { await applyEndpoint(blockedEndpoint); } catch { /* Never release an existing owned policy on an unreadable state. */ }
    setStatus(configuration.enabled ? 'blocked' : 'error', safeProxyError(error));
    retryStorage();
  }
  async function cleanupVault() {
    if (vaultState.cleanup.length === 0) return;
    const host = await inspectIndependentHost(); if (!host.capabilities.vault) proxyFail('vault-unavailable');
    for (const id of [...vaultState.cleanup]) {
      // The state validator excludes every committed ID, including the active one.
      const result = await native.request('delete', { profileId: id });
      if (result.deleted !== true) proxyFail('native-protocol');
      await persistVaultState({ ...vaultState, cleanup: vaultState.cleanup.filter(value => value !== id) });
    }
  }
  async function inspectHost() { await requireAccess(configuration, true); return await native.ensure(); }
  async function inspectIndependentHost() {
    await requireNativeAccess();
    return await native.ensure();
  }
  async function restartNative() {
    if (firefox || typeof api.runtime.reload !== 'function') proxyFail('unsupported');
    if (configuration.enabled || quarantine) proxyFail('busy');
    if (!await contains(['nativeMessaging'])) proxyFail('permission-required');
    if (typeof api.runtime.connectNative === 'function') return snapshot();
    // Only a bounded, nonsecret return marker survives the explicit reload.
    // Drafts/credentials remain in Options RAM and are never written here.
    await api.storage.local.set({ [PROXY_NATIVE_RESTART_KEY]: { version: 1, at: Date.now() } });
    if (disposed) { await api.storage.local.remove(PROXY_NATIVE_RESTART_KEY); proxyFail('inactive'); }
    restartPending = true;
    return snapshot();
  }
  async function reopenNativeOptions() {
    if (typeof api.runtime.reload !== 'function') return;
    try {
      const marker = (await api.storage.local.get(PROXY_NATIVE_RESTART_KEY))[PROXY_NATIVE_RESTART_KEY];
      if (marker === undefined) return;
      // Consume before opening: failure, malformed data or expiry never loops.
      await api.storage.local.remove(PROXY_NATIVE_RESTART_KEY);
      const age = Date.now() - marker?.at;
      if (firefox || configuration.enabled || quarantine || !proxyRecord(marker) || Object.keys(marker).length !== 2 || marker.version !== 1 || !Number.isSafeInteger(marker.at) || age < 0 || age > 60000 || typeof api.runtime.connectNative !== 'function' || !await contains(['nativeMessaging'])) return;
      await api.tabs.create({ url: api.runtime.getURL('options.html#proxy'), active: true });
    } catch { /* Failed cleanup never opens a page or changes the route. */ }
  }
  async function activate(id, { restoring = false } = {}) {
    const profile = configuration.profiles.find(item => item.id === id); if (!profile) proxyFail('profile-not-found');
    const next = { ...configuration, enabled: true, selectedId: id };
    await requireAccess(next, false);
    await ownership();
    setStatus('connecting', null, id);
    const wasEnabled = configuration.enabled;
    await persist(next);
    quarantine = false;
    releasedForSession = false;
    endpoint = blockedEndpoint;
    let policyApplied = false;
    try {
      // Close the old relay before switching engines; failure never falls back to DIRECT.
      await applyEndpoint(blockedEndpoint);
      policyApplied = true;
      if (!profile.native && native.snapshot().available) await native.request('disconnect');
      await overlay(true);
      if (!profile.native) await applyEndpoint(routeOf(profile));
    } catch (error) {
      if (!wasEnabled && !policyApplied) { try { await overlay(false); } catch { /* Preserve the original failure. */ } }
      setStatus(error.code === 'not-controllable' ? 'conflict' : 'error', safeProxyError(error).code);
      throw error;
    }
    if (profile.native) {
      if (restoring && !configuration.autoConnect) { setStatus('blocked', 'reconnect-required'); return snapshot(); }
      try {
        const host = await inspectHost(); if (!host.capabilities[profile.type]) proxyFail('native-unsupported');
        const vaultId = nativeId(profile), result = await native.request('connect', { profileId: vaultId });
        if (result.profileId !== vaultId || result.host !== '127.0.0.1') proxyFail('native-protocol');
        await applyEndpoint({ host: '127.0.0.1', port: proxyPort(result.port), scheme: 'socks5' });
      } catch (error) { endpoint = blockedEndpoint; try { await applyEndpoint(blockedEndpoint); } catch { /* Existing mandatory closed PAC retained. */ } setStatus('blocked', safeProxyError(error)); throw error; }
    }
    await requireAccess(configuration, profile.native);
    setStatus('connected'); return snapshot();
  }
  async function disconnect() {
    if (!configuration.enabled && !quarantine && status.state !== 'error') return snapshot();
    const wasNative = configuration.profiles.find(item => item.id === configuration.selectedId)?.native;
    let browserReleased = firefox, failure = null;
    if (firefox) releasedForSession = true;
    try {
    // Stop only our extension's setting. Never restore a snapshot over another owner.
    if (!firefox) {
      const current = await currentSetting();
      if (current.levelOfControl === 'controlled_by_this_extension' && (expectedPac === null || current.value?.pacScript?.data === expectedPac) || current.levelOfControl !== 'controlled_by_this_extension' && expectedPac !== null) {
        if (await api.proxy.settings.clear({ scope: 'regular' }) === false) proxyFail('not-applied');
        const actual = await currentSetting(); if (actual.levelOfControl === 'controlled_by_this_extension') proxyFail('not-applied');
      }
      browserReleased = true;
      releasedForSession = true;
    }
    // A corrupt saved configuration is preserved for recovery; explicit Off only
    // releases the temporary closed browser layer, without overwriting the file.
    if (!quarantine && configuration.enabled) await persist({ ...configuration, enabled: false });
    quarantine = false;
    } catch (error) { failure = safeProxyError(error); }
    if (browserReleased) {
      releasedForSession = true; endpoint = null; expectedPac = null; firefoxConflict = false;
      // Explicit Disconnect releases the current route even if persisting Off
      // fails. Retain that failed intent/revision and always retire the old worker.
      if (wasNative && native.snapshot().available) {
        try { await native.request('disconnect'); }
        catch (error) { failure ??= safeProxyError(error); native.dispose(); }
      }
      try { await overlay(false); } catch (error) { failure ??= safeProxyError(error); }
    }
    if (failure) { setStatus('error', failure); throw failure; }
    setStatus('off'); return snapshot();
  }
  async function saveProfile(input) {
    const existing = input?.id ? configuration.profiles.find(item => item.id === input.id) : null;
    // Renaming the same endpoint changes metadata only, including an active
    // direct profile, without retrieving secrets or reconnecting its route.
    const rename = existing && proxyRecord(input) && Object.keys(input).every(key => ['id', 'name', 'type', 'host', 'port', 'country'].includes(key)) && input.type === existing.type && (input.host === undefined || input.host === existing.host) && (input.port === undefined || input.port === existing.port);
    if (rename) {
      // The country tag is metadata too: a key present sets it (null clears it), an absent key keeps the saved one.
      const renamed = { ...existing, name: input.name };
      if (Object.hasOwn(input, 'country')) { const country = proxyCountry(input.country); if (country) renamed.country = country; else delete renamed.country; }
      const candidate = validateProxyConfiguration({ ...configuration, profiles: configuration.profiles.map(item => item.id === existing.id ? renamed : item) });
      await persist(candidate); notify(); return snapshot();
    }
    const profile = validateProxyProfileInput(input), id = profile.id ?? ('p-' + env.crypto.randomUUID());
    if (existing?.native && PROXY_DIRECT_TYPES.includes(profile.type) && !Object.hasOwn(input, 'username') && !Object.hasOwn(input, 'password')) proxyFail('invalid-input');
    if (!existing && configuration.profiles.length >= PROXY_LIMITS.profiles) proxyFail('invalid-input');
    if (existing && configuration.enabled && configuration.selectedId === existing.id) proxyFail('busy');
    const needsNative = proxyNeedsNative(profile), country = profile.country ? { country: profile.country } : {};
    await cleanupVault();
    const previousId = existing?.native ? nativeId(existing) : null;
    let metadata, stagedId = null;
    if (needsNative) {
      const host = await inspectIndependentHost(); if (!host.capabilities.vault) proxyFail('vault-unavailable'); if (!host.capabilities[profile.type]) proxyFail('native-unsupported');
      // The vault record is the connection only; the country tag stays metadata and never reaches the companion.
      const { name: ignoredName, id: ignoredId, country: ignoredCountry, ...secret } = profile; void ignoredName; void ignoredId; void ignoredCountry;
      // A replacement must never overwrite the committed record. A newly generated
      // public UUID is already fresh; explicit/reused IDs get a separate vault UUID.
      stagedId = existing || profile.id ? 'v-' + env.crypto.randomUUID() : id;
      if (configuration.profiles.some(item => item.native && nativeId(item) === stagedId)) proxyFail('duplicate-profile');
      await persistVaultState({ ...vaultState, cleanup: [...vaultState.cleanup, stagedId] });
      let result;
      try { result = await native.request('save', { profileId: stagedId, profile: secret }); }
      finally { for (const key of Object.keys(secret)) secret[key] = null; }
      if (result.profileId !== stagedId || !proxyRecord(result.summary) || result.summary.type !== profile.type) proxyFail('native-protocol');
      metadata = { id, name: profile.name, type: profile.type, host: result.summary.host === null ? null : proxyHost(result.summary.host), port: result.summary.port === null ? null : proxyPort(result.summary.port), native: true, ...country };
    } else metadata = { id, name: profile.name, type: profile.type, host: profile.host, port: profile.port, native: false, ...country };
    const nativeIds = { ...vaultState.nativeIds }; if (stagedId) nativeIds[id] = stagedId; else delete nativeIds[id];
    const cleanup = vaultState.cleanup.filter(value => value !== stagedId); if (previousId) cleanup.push(previousId);
    await persist({ ...configuration, profiles: [...configuration.profiles.filter(item => item.id !== id), metadata], selectedId: configuration.selectedId ?? id }, { version: 1, nativeIds, cleanup });
    // Committed metadata now names the exact saved record. Cleanup is recoverable
    // and idempotent if its reply or the following journal write is interrupted.
    notify(); await cleanupVault();
    notify(); return snapshot();
  }
  async function deleteProfile(id) {
    proxyId(id); const profile = configuration.profiles.find(item => item.id === id); if (!profile) proxyFail('profile-not-found');
    if (configuration.enabled && configuration.selectedId === id) proxyFail('busy');
    await cleanupVault();
    if (profile.native) { const host = await inspectIndependentHost(); if (!host.capabilities.vault) proxyFail('vault-unavailable'); }
    const nativeIds = { ...vaultState.nativeIds }; delete nativeIds[id];
    const cleanup = [...vaultState.cleanup, ...(profile.native ? [nativeId(profile)] : [])];
    await persist({ ...configuration, profiles: configuration.profiles.filter(item => item.id !== id), selectedId: configuration.selectedId === id ? null : configuration.selectedId }, { version: 1, nativeIds, cleanup });
    notify(); await cleanupVault();
    notify(); return snapshot();
  }
  async function saveSettings(input) {
    const next = validateProxyConfiguration(input);
    if (next.revision !== configuration.revision) proxyFail('stale-revision');
    if (JSON.stringify(next.profiles) !== JSON.stringify(configuration.profiles) || next.enabled !== configuration.enabled) proxyFail('invalid-config');
    const previous = configuration; await persist(next);
    if (configuration.enabled) {
      try { await requireAccess(configuration, configuration.profiles.find(item => item.id === configuration.selectedId)?.native); await overlay(true); if (previous.selectedId !== configuration.selectedId) return await activate(configuration.selectedId); await applyEndpoint(endpoint ?? blockedEndpoint); }
      catch (error) { await persist({ ...previous, revision: configuration.revision }); try { await overlay(true); await applyEndpoint(endpoint ?? blockedEndpoint); } catch { /* Closed existing policy retained. */ } setStatus('blocked', safeProxyError(error).code); throw error; }
    }
    notify(); return snapshot();
  }
  async function diagnose(input) {
    diagnostic = null;
    try {
      const url = validateProxyDiagnosticUrl(input);
      const profile = configuration.profiles.find(item => item.id === configuration.selectedId);
      if (!configuration.enabled || releasedForSession || !profile) proxyFail('inactive');
      await requireAccess(configuration, true);
      const companion = await native.ensure();
      if (!profile.native && profile.type !== 'socks5' && !companion.capabilities[profile.type]) proxyFail('native-unsupported');
      if (profile.native) {
        const active = await native.request('status');
        if (active.state !== 'connected' || active.profileId !== nativeId(profile)) {
          const details = proxyRecord(active.diagnostic) ? active.diagnostic : null;
          throw new ProxyError(details && safeCodes.has(details.code) ? details.code : 'tunnel-disconnected', details ?? { phase: 'tunnel', retryable: true });
        }
      }
      // An active direct profile: the browser itself talks to that proxy, so the companion probes the same address (see probeDirect).
      // A login profile is probed through the running relay.
      const result = profile.native ? await native.request('diagnose', { url }) : await probeDirect(profile, url);
      diagnostic = validateProxyDiagnosticResult(result, url);
      notify(); return snapshot();
    } catch (error) {
      const safe = safeProxyError(error);
      diagnostic = { state: 'fail', code: safe.code, ...(safe.phase ? { phase: safe.phase } : {}), ...(typeof safe.retryable === 'boolean' ? { retryable: safe.retryable } : {}) };
      notify(); throw safe;
    }
  }
  // A login-free profile is probed by the companion from its address alone: nothing is saved and the active route is untouched.
  // SOCKS5 keeps the original two-field endpoint. An HTTP or HTTPS proxy is named with its type, and the companion dials it directly
  // with the dialer of Check, so 407, 403 and 502 stay distinct and a missing login reads as auth-required. A companion built before
  // the typed endpoint decodes strictly and answers any unknown key with invalid-input at the parse phase; the URL and the profile were
  // validated here, so that answer to a typed request means the companion is outdated.
  async function probeDirect(profile, url) {
    if (profile.type === 'socks5') return await native.request('diagnose', { url, endpoint: { host: profile.host, port: profile.port } });
    try { return await native.request('diagnose', { url, endpoint: { type: profile.type, host: profile.host, port: profile.port } }); }
    catch (error) { if (error?.code === 'invalid-input' && error.phase === 'parse') proxyFail('native-unsupported'); throw error; }
  }
  async function checkProfile(input) {
    const { id, url } = validateProxyProfileCheck(input);
    const profile = configuration.profiles.find(item => item.id === id); if (!profile) proxyFail('profile-not-found');
    try {
      const host = await inspectIndependentHost();
      if (!host.capabilities[profile.type]) proxyFail('native-unsupported');
      const result = profile.native ? await native.request('check', { profileId: nativeId(profile), url }) : await probeDirect(profile, url);
      return { profileId: id, diagnostic: validateProxyDiagnosticResult(result, url) };
    } catch (error) {
      const safe = safeProxyError(error);
      return { profileId: id, diagnostic: { state: 'fail', code: safe.code, ...(safe.phase ? { phase: safe.phase } : {}), ...(typeof safe.retryable === 'boolean' ? { retryable: safe.retryable } : {}) } };
    }
  }
  async function exportProfiles(input) {
    const id = input === null ? null : proxyId(input);
    const profiles = id === null ? configuration.profiles : configuration.profiles.filter(profile => profile.id === id);
    if (id !== null && profiles.length === 0) proxyFail('profile-not-found');
    const connections = new Map();
    try {
      if (profiles.some(profile => profile.native)) { const host = await inspectIndependentHost(); if (!host.capabilities.vault) proxyFail('vault-unavailable'); }
      for (const profile of profiles) {
        if (!profile.native) connections.set(profile.id, { type: profile.type, host: profile.host, port: profile.port, username: '', password: '' });
        else {
          // One vault record per frame: a large all-profile reply cannot exceed native framing.
          const vaultId = nativeId(profile), result = await native.request('export', { profileIds: [vaultId] });
          if (!proxyRecord(result) || Object.keys(result).length !== 1 || !Array.isArray(result.profiles) || result.profiles.length !== 1 || !proxyRecord(result.profiles[0]) || Object.keys(result.profiles[0]).some(key => !['profileId', 'profile'].includes(key)) || result.profiles[0].profileId !== vaultId) proxyFail('native-protocol');
          try { connections.set(profile.id, validateProxyConnection(profile, result.profiles[0].profile)); }
          finally { result.profiles[0].profile = null; }
        }
      }
      const included = profiles.some(profile => profile.id === configuration.selectedId), selectedId = included ? configuration.selectedId : null;
      return validateProxyBundle({ format: 'detect.expert.proxy.bundle', version: 1, revision: configuration.revision, selectedId, enabled: configuration.enabled && included, routing: configuration.routing, protectWebRTC: configuration.protectWebRTC, disablePrediction: configuration.disablePrediction, autoConnect: configuration.autoConnect, killSwitch: true, profiles: profiles.map(profile => ({ ...profile, connection: connections.get(profile.id) })) });
    } finally { for (const value of connections.values()) for (const key of Object.keys(value)) value[key] = null; connections.clear(); }
  }
  async function dispatch(op, payload) {
    await ready; if (disposed) proxyFail('inactive');
    if (op === 'load' && !storageUnavailable && vaultState.cleanup.length === 0 && (!configuration.enabled || !native.snapshot().available || writing)) return snapshot();
    if (writing || restartPending) proxyFail('busy');
    writing = true;
    try {
      if (storageUnavailable) {
        if (op === 'load') { await initializeConfiguration(); if (!storageUnavailable) await cleanupVault(); return snapshot(); }
        if (op === 'restartNative') proxyFail('busy');
        if (op !== 'disconnect') proxyFail('operation-failed');
      }
      if (['saveProfile', 'deleteProfile', 'saveSettings', 'connect', 'disconnect'].includes(op)) diagnostic = null;
      if (op === 'load') {
        await cleanupVault();
        if (!configuration.enabled || !native.snapshot().available) return snapshot();
        try {
          const result = await native.request('status');
          if (configuration.profiles.find(profile => profile.id === configuration.selectedId)?.native && result.diagnostic && proxyRecord(result.diagnostic) && safeCodes.has(result.diagnostic.code)) {
            endpoint = blockedEndpoint; setStatus('blocked', new ProxyError(result.diagnostic.code, result.diagnostic));
          } else if (configuration.profiles.find(profile => profile.id === configuration.selectedId)?.native && (['off', 'blocked', 'error'].includes(result.state) || result.profileId !== nativeId(configuration.profiles.find(profile => profile.id === configuration.selectedId)))) { endpoint = blockedEndpoint; setStatus('blocked', 'tunnel-disconnected'); }
        } catch (error) { endpoint = blockedEndpoint; setStatus('blocked', safeProxyError(error)); }
        return snapshot();
      }
      if (op === 'saveProfile') return await saveProfile(payload);
      if (op === 'deleteProfile') return await deleteProfile(payload);
      if (op === 'saveSettings') return await saveSettings(payload);
      if (op === 'connect') return await activate(proxyId(payload));
      if (op === 'disconnect') return await disconnect();
      if (op === 'hostStatus') { await inspectIndependentHost(); notify(); return snapshot(); }
      if (op === 'restartNative') { if (payload !== undefined) proxyFail('invalid-input'); return await restartNative(); }
      if (op === 'diagnose') return await diagnose(payload);
      if (op === 'checkProfile') return await checkProfile(payload);
      if (op === 'exportProfiles') return await exportProfiles(payload);
      proxyFail('invalid-input');
    } finally { writing = false; if (revokePending) void reconcileRevocation(); }
  }
  const connectListener = port => {
    if (port.name !== PROXY_PORT) return;
    if (!isProxyUiSender(api, port.sender) || ports.size >= 8) { port.disconnect(); return; }
    ports.add(port); port.onDisconnect.addListener(() => ports.delete(port));
    port.onMessage.addListener(message => {
      if (!proxyRecord(message) || Object.keys(message).some(key => !['v', 'id', 'op', 'payload'].includes(key)) || message.v !== 1 || typeof message.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(message.id) || typeof message.op !== 'string') { port.disconnect(); return; }
      const responseOnly = ['checkProfile', 'exportProfiles'].includes(message.op);
      dispatch(message.op, message.payload).then(value => {
        try { port.postMessage({ v: 1, id: message.id, ok: true, ...(responseOnly ? { result: value } : { snapshot: value }) }); } catch { /* UI closed after command. */ }
        if (message.op === 'restartNative' && restartPending && !disposed) {
          const failed = () => {
            restartPending = false;
            void api.storage.local.remove(PROXY_NATIVE_RESTART_KEY).catch(() => {});
            setStatus('error', 'operation-failed');
          };
          try {
            restartTimer = schedule(() => {
              restartTimer = null;
              if (disposed || configuration.enabled) return;
              try { api.runtime.reload(); } catch { failed(); }
            }, 50);
          } catch { failed(); }
        }
      }, error => { try { const safe = safeProxyError(error); port.postMessage({ v: 1, id: message.id, ok: false, error: { code: safe.code, ...(safe.phase ? { phase: safe.phase } : {}), ...(typeof safe.retryable === 'boolean' ? { retryable: safe.retryable } : {}) }, ...(!responseOnly ? { snapshot: snapshot() } : {}) }); } catch { /* UI closed. */ } });
    });
  };
  const requestListener = async details => {
    await ready;
    if (disposed || releasedForSession || firefoxConflict || !configuration.enabled && !quarantine) return undefined;
    let host;
    try { host = new URL(details.url).hostname; } catch { return [{ type: 'socks', host: blockedEndpoint.host, port: blockedEndpoint.port, proxyDNS: true, failoverTimeout: 1 }, null]; }
    // Reuse exactly the same literal route predicates as Chrome without eval/PAC execution.
    const routing = quarantine ? { mode: 'all', proxyDomains: [], directDomains: [], bypassLocal: false } : configuration.routing, normalized = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    const match = values => values.some(domain => domain.startsWith('*.') ? normalized.length > domain.length - 1 && normalized.endsWith(domain.slice(1)) : normalized === domain);
    const local = routing.bypassLocal && (normalized === 'localhost' || /\.localhost$|\.local$/.test(normalized) || /^[^:.]+$/.test(normalized) || normalized === '::1' || /^(?:fc|fd)[0-9a-f]{2}:|^fe[89ab][0-9a-f]:/.test(normalized) || /^(?:127|10)\.|^192\.168\.|^169\.254\./.test(normalized) || /^172\.(?:1[6-9]|2[0-9]|3[01])\./.test(normalized));
    if (local || match(routing.directDomains) || routing.mode === 'include' && !match(routing.proxyDomains)) return { type: 'direct' };
    // A route that cannot be built stays closed: a throwing listener would let Firefox continue with a direct connection.
    try { return [buildProxyInfo(endpoint ?? blockedEndpoint), null]; } catch { return [buildProxyInfo(blockedEndpoint), null]; }
  };
  // Register before the first asynchronous storage read: Firefox requests await initialization.
  api.runtime.onConnect.addListener(connectListener);
  if (firefox && api.proxy?.onRequest) api.proxy.onRequest.addListener(requestListener, { urls: ['<all_urls>'] });
  const proxyErrorListener = () => { if (configuration.enabled) setStatus('blocked', 'proxy-error'); };
  api.proxy?.onProxyError?.addListener(proxyErrorListener);
  api.proxy?.onError?.addListener(proxyErrorListener);
  async function initializeConfiguration() {
    let readComplete = false;
    const wasQuarantined = quarantine;
    try {
      const raw = (await api.storage.local.get(PROXY_STORAGE_KEY))[PROXY_STORAGE_KEY];
      const rawState = (await api.storage.local.get(VAULT_STATE_KEY))[VAULT_STATE_KEY];
      const checked = rawState === undefined ? raw === undefined ? createDefaultProxyConfiguration() : validateProxyConfiguration(raw) : validateProxyConfiguration(own(rawState, 'configuration'));
      const checkedState = checkedVaultState(rawState, checked);
      if (disposed) return snapshot();
      configuration = checked; vaultState = checkedState;
      readComplete = true;
      storageUnavailable = false; quarantine = false;
      let repairProjection = rawState !== undefined;
      if (repairProjection) {
        try { repairProjection = JSON.stringify(validateProxyConfiguration(raw)) !== JSON.stringify(configuration); } catch { /* Only the validated authoritative item can repair this projection. */ }
        if (repairProjection) {
          try { await api.storage.local.set({ [PROXY_STORAGE_KEY]: configuration }); }
          catch (error) { await unavailableStorage(error); throw error; }
        }
      }
      // A user who explicitly released an unreadable route keeps that choice
      // after recovery; do not silently reconnect its formerly enabled profile.
      if (releasedForSession && configuration.enabled) await persist({ ...configuration, enabled: false });
      if (configuration.enabled) {
        const selected = configuration.profiles.find(profile => profile.id === configuration.selectedId);
        endpoint = selected?.native ? blockedEndpoint : selected ? routeOf(selected) : selected;
        await activate(configuration.selectedId, { restoring: true });
      } else if (wasQuarantined) { quarantine = true; await disconnect(); }
      else { await overlay(false); setStatus('off'); }
      await reopenNativeOptions();
      startupReadAttempts = 0;
      if (startupRetryTimer !== null) { cancelSchedule(startupRetryTimer); startupRetryTimer = null; }
      loaded = true;
    } catch (error) {
      loaded = true;
      if (!readComplete || storageUnavailable) await unavailableStorage(error);
      else { endpoint = blockedEndpoint; setStatus(configuration.enabled ? 'blocked' : 'error', safeProxyError(error)); }
    }
    return snapshot();
  }
  // The barrier also covers the private vault journal. A failed read has no
  // authority to infer OFF; Firefox stays closed until recovery or explicit Off.
  const ready = initializeConfiguration();
  const startup = () => { if (loaded && !writing && (configuration.enabled || storageUnavailable)) { writing = true; (storageUnavailable ? initializeConfiguration() : activate(configuration.selectedId, { restoring: true })).catch(error => setStatus('blocked', safeProxyError(error).code)).finally(() => { writing = false; }); } };
  api.runtime.onStartup?.addListener(startup);
  async function reconcileRevocation() {
    await ready;
    if (disposed || !configuration.enabled) { revokePending = false; return; }
    if (writing) { revokePending = true; return; }
    writing = true; revokePending = false;
    try {
      endpoint = blockedEndpoint;
      try { await applyEndpoint(blockedEndpoint); } catch { /* Revoked native API cannot claim application. */ }
      native.dispose(); setStatus('permission-required', 'permission-required');
    } finally { writing = false; }
  }
  const removedListener = details => { if (details?.permissions?.some(permission => ['proxy', 'privacy', 'nativeMessaging'].includes(permission))) { revokePending = true; void reconcileRevocation(); } };
  const settingListener = details => {
    if (!configuration.enabled || writing || disposed) return;
    if (firefox) {
      if (['controlled_by_other_extensions', 'not_controllable'].includes(details?.levelOfControl)) { firefoxConflict = true; setStatus('conflict', 'not-controllable'); }
      return;
    }
    if (details?.levelOfControl === 'controlled_by_other_extensions' || details?.levelOfControl === 'not_controllable') setStatus('conflict', 'not-controllable');
    else if (details?.levelOfControl !== 'controlled_by_this_extension' || details?.value?.pacScript?.data !== expectedPac) setStatus('error', 'not-applied');
  };
  api.permissions?.onRemoved?.addListener(removedListener);
  api.proxy?.settings?.onChange?.addListener(settingListener);
  return { ready, snapshot, restore: startup, dispose() { disposed = true; if (restartTimer !== null) cancelSchedule(restartTimer); if (startupRetryTimer !== null) cancelSchedule(startupRetryTimer); if (restartPending) void api.storage.local.remove(PROXY_NATIVE_RESTART_KEY).catch(() => {}); api.runtime.onConnect.removeListener(connectListener); api.runtime.onStartup?.removeListener(startup); api.proxy?.onRequest?.removeListener(requestListener); api.proxy?.onProxyError?.removeListener(proxyErrorListener); api.proxy?.onError?.removeListener(proxyErrorListener); api.proxy?.settings?.onChange?.removeListener(settingListener); api.permissions?.onRemoved?.removeListener(removedListener); for (const port of ports) port.disconnect(); ports.clear(); native.dispose(); } };
}
