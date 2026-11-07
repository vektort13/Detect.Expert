// ADR-048: one SW transaction owns both the portable configuration and the legacy denial projection.
import { API_CONFIG_CATALOG, createApiConfiguration, validateApiConfiguration, validateApiConfigurationWrite, upgradeApiConfiguration, configurationToLegacy } from './api-configuration.js';
import { PROTECTION_FEATURES } from './api-protection-features.js';
import { buildApiCustomScripts, apiCustomSiteScriptId, API_CUSTOM_SCRIPT_PREFIX } from './api-custom-registration.js';
import { WebRtcNetworkController, WebRtcProfileSeeds } from './webrtc-network-controller.js';
import { AntidetectProtocolController } from './antidetect-protocol-controller.js';
import { AntidetectHeaderController } from './antidetect-header-controller.js';
import { MathProfileSeed } from './math-profile-seed.js';
import { CanvasProfileSeed } from './canvas-profile-seed.js';
import { RowNoiseSeed, AUDIO_NOISE_PURPOSE, WEBGL_NOISE_PURPOSE, NETWORK_NOISE_PURPOSE } from './profile-noise-seed.js';
import { createMediaCapabilitiesRoute } from './api-custom-media-service.js';
import { TEMPORARY_KEY, TEMPORARY_LIVE_KEY, temporaryStartupPlan, revertTemporaryConfiguration } from './fingerprint-temporary.js';

export const API_CONFIGURATION_STORAGE_KEY = 'api-configuration:v1';
const LEGACY_KEY = 'protection:v1', PENDING_KEY = 'protection:pending:v1';
const SCRIPT_IDS = ['detector-api-custom-main-v1', 'detector-api-custom-relay-v1'];
const INHERIT_SCRIPT_ID = 'detector-api-custom-inherit-v2';
const FALLBACK_PREFIX = 'detector-api-custom-fallback-v2-';
const MEDIA_RELAY_ID = 'detector-api-custom-media-relay-v1';
const oldIds = new Set(PROTECTION_FEATURES), MAX_DOCUMENTS = 1024;
const earlyBlockIds = new Set(['webrtc', 'websocket', 'webtransport']);
const clone = value => JSON.parse(JSON.stringify(value));
// A library edit changes portable metadata, never the applied profile or open-page guards.
const appliedSignature = configuration => JSON.stringify({ ...configuration, fingerprintProfiles: [] });
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const orderedRules = rows => rows.map(row => ({ feature: row.feature, state: row.state })).sort((a, b) => compare(a.feature, b.feature));
const signature = value => JSON.stringify({ enabled: value.enabled, preset: value.preset, global: orderedRules(value.global),
  sites: value.sites.map(site => ({ host: site.host, disabled: site.disabled, rules: orderedRules(site.rules) })).sort((a, b) => compare(a.host, b.host)) });
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const validTab = value => value === null || Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
const error = (code, message = code) => ({ schemaVersion: 1, type: 'api-config-error', code, message });

export function customEntries(configuration, host) {
  if (!configuration.enabled && !configuration.antidetectEnabled) return [];
  const site = configuration.sites.find(entry => entry.host === host);
  if (site?.disabled) return [];
  const entries = [];
  for (const global of configuration.apis) {
    const local = site?.apis.find(entry => entry.id === global.id);
    const row = local && local.mode !== 'bypass' ? local : global;
    if (row.mode === 'custom' && row.id === 'math-transcendentals' && row.selected.value.functions.length === 0) continue;
    if (row.mode === 'custom' && configuration.antidetectEnabled) entries.push({ id: row.id, mode: 'custom', selected: row.selected });
    else if (row.mode === 'on' && configuration.enabled && (!oldIds.has(row.id) || earlyBlockIds.has(row.id))) entries.push({ id: row.id, mode: 'on', selected: { kind: 'unset' } });
  }
  return entries;
}

// Changes made by an old launcher/preset editor are merged without throwing away saved Custom libraries.
export function mergeLegacyConfiguration(configuration, legacy) {
  const before = configurationToLegacy(configuration, legacy);
  if (signature(before) === signature(legacy)) return configuration;
  const fresh = createApiConfiguration(legacy), next = clone(configuration);
  next.enabled = legacy.enabled; next.preset = legacy.preset;
  const oldMode = row => row.mode === 'custom' ? 'off' : row.mode;
  for (const incoming of fresh.apis) {
    if (!oldIds.has(incoming.id)) continue;
    const row = next.apis.find(entry => entry.id === incoming.id);
    if (oldMode(row) !== incoming.mode) row.mode = incoming.mode;
  }
  const previousSites = new Map(next.sites.map(site => [site.host, site]));
  next.sites = fresh.sites.map(incoming => {
    const previous = previousSites.get(incoming.host);
    if (!previous) return incoming;
    previous.disabled = incoming.disabled;
    for (const item of incoming.apis) {
      if (!oldIds.has(item.id)) continue;
      const row = previous.apis.find(entry => entry.id === item.id);
      if (oldMode(row) !== item.mode) row.mode = item.mode;
    }
    return previous;
  });
  return next;
}

export class ApiConfigurationController {
  constructor({ api, legacy, scope, whenReady, verifyUiSender, readPageSender }) {
    Object.assign(this, { api, legacy, scope, whenReady, verifyUiSender, readPageSender });
    this.webrtcNetwork = new WebRtcNetworkController(api); this.webrtcSeeds = new WebRtcProfileSeeds(api);
    this.antidetectProtocols = new AntidetectProtocolController(api);
    this.antidetectHeaders = new AntidetectHeaderController(api);
    this.mathSeed = new MathProfileSeed(api);
    this.canvasSeed = new CanvasProfileSeed(api);
    this.audioSeed = new RowNoiseSeed(api, 'audio-fingerprint', AUDIO_NOISE_PURPOSE);
    this.webglSeed = new RowNoiseSeed(api, 'webgl-readback', WEBGL_NOISE_PURPOSE);
    this.networkSeed = new RowNoiseSeed(api, 'network-information', NETWORK_NOISE_PURPOSE);
    this.configuration = null; this.revision = 0; this.loading = null; this.registration = 'inactive';
    this.documents = new Map(); this.pending = 0; this.refreshing = null; this.reloadRequired = false;
    this.mutating = 0; this.refreshAgain = false;
    this.earlyAccess = 'unsupported';
    this.recoveryPending = false; this.recoveryAttempted = false; this.recoveryInFlight = null;
    this.mediaRoute = createMediaCapabilitiesRoute({api,controller:this,entriesForHost:customEntries});
  }
  start() {
    return this.loading ??= (async () => {
      await this.whenReady(); await this.legacy.start(); await this.legacy.chain;
      const raw = (await this.api.storage.local.get(API_CONFIGURATION_STORAGE_KEY))[API_CONFIGURATION_STORAGE_KEY];
      const read = raw && Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? upgradeApiConfiguration(raw.configuration) : null;
      // A valid historical file can exceed the byte budget after additive
      // metadata. Never replace its libraries with a legacy-only fallback.
      if (read?.upgradeFailure) throw new Error(read.error.message);
      this.configuration = read?.ok ? read.value : createApiConfiguration(this.legacy.settings);
      this.revision = read?.ok ? raw.revision : 0;
      this.storageError = raw !== undefined && !read?.ok;
      await this.serialize(async () => {
        if (!read?.ok || !read.migrated) return this.synchronizeLegacy();
        // No effective rule changes: new catalogue rows inherit Bypass. Persist
        // the complete upgrade before reconciliation and invalidate old editors.
        if (this.revision >= Number.MAX_SAFE_INTEGER) throw new Error('stale-revision');
        const next = mergeLegacyConfiguration(this.configuration, this.legacy.settings);
        const checked = validateApiConfiguration(next);
        if (!checked.ok) throw new Error(checked.error.message);
        const revision = this.revision + 1;
        await this.api.storage.local.set({ [API_CONFIGURATION_STORAGE_KEY]: { revision, configuration: checked.value } });
        this.configuration = checked.value; this.revision = revision;
      });
      // ADR-107 round 5: a temporary profile from an earlier browser session ends here, before anything is registered.
      await this.restoreTemporary();
      await this.reconcile();
    })().catch(reason => {
      // A temporary browser/storage failure must allow the next explicit request
      // to retry startup rather than retaining one rejected promise forever.
      this.loading = null; this.registration = 'error';
      throw reason;
    });
  }
  // ADR-107 round 5: a temporary profile lives for one browser session. Its record is in storage.local, its marker in storage.session
  // (the browser clears that area when the browser session ends and when the extension is reloaded or updated, and keeps it across
  // service worker restarts). A valid record without the marker means "restarted since": the remembered state is laid back over the
  // current configuration through persist(), the same revision-checked path as every other write, and the record is removed. A record
  // that is not valid is removed without restoring anything. Whatever is uncertain (a storage read fails, the write is refused) leaves
  // the record for the next start. Never throws: start-up must not fail because of a temporary profile.
  async restoreTemporary() {
    const session = this.api.storage.session, local = this.api.storage.local;
    if (typeof session?.get !== 'function' || typeof local.remove !== 'function') return;
    try {
      const raw = (await local.get(TEMPORARY_KEY))[TEMPORARY_KEY];
      const plan = temporaryStartupPlan(raw, raw === undefined ? undefined : (await session.get(TEMPORARY_LIVE_KEY))[TEMPORARY_LIVE_KEY]);
      if (plan.action === 'none') return;
      if (plan.action === 'revert') {
        const restored = revertTemporaryConfiguration(this.configuration, plan.record.previous);
        // A remembered state that no longer fits this configuration cannot be applied; keeping the record would only repeat the attempt.
        if (restored?.changed && await this.persist(restored.configuration, this.revision, { gated: false }) !== null) return;
      }
      await local.remove(TEMPORARY_KEY);
    } catch { /* The record stays; the next start tries again. */ }
  }
  active() {
    return (this.configuration?.enabled === true || this.configuration?.antidetectEnabled === true) && !this.legacy.accessUnavailable && this.scope.accessReady && this.scope.hasDataConsent;
  }
  async readEarlyAccess() {
    try {
      if (!this.api.userScripts || typeof this.api.userScripts.getScripts !== 'function') throw new Error('unavailable');
      await this.api.userScripts.getScripts();
      if (this.earlyAccess !== 'ready') this.recoveryAttempted = false;
      return this.earlyAccess = 'ready';
    } catch {
      const firefox = this.api.runtime.getURL?.('').startsWith('moz-extension:');
      if (firefox && this.api.runtime.getBrowserInfo) {
        try { if (Number.parseInt((await this.api.runtime.getBrowserInfo()).version, 10) < 137) return this.earlyAccess = 'unsupported'; } catch {}
      }
      return this.earlyAccess = firefox ? 'permission-required' : 'browser-toggle-required';
    }
  }
  async serialize(operation) {
    this.mutating++;
    try { return await this.legacy.serialize(operation); }
    finally { this.mutating--; }
  }
  async synchronizeLegacy() {
    const next = mergeLegacyConfiguration(this.configuration, this.legacy.settings);
    if (next === this.configuration) return;
    const read = validateApiConfiguration(next);
    if (!read.ok) throw new Error(read.error.message);
    if (this.revision >= Number.MAX_SAFE_INTEGER) throw new Error('stale-revision');
    const revision = this.revision + 1;
    await this.api.storage.local.set({ [API_CONFIGURATION_STORAGE_KEY]: { revision, configuration: read.value } });
    this.configuration = read.value; this.revision = revision;
  }
  legacyChanged() {
    if (!this.configuration || this.mutating) return;
    if (this.refreshing) { this.refreshAgain = true; return; }
    this.refreshAgain = false;
    this.refreshing = this.serialize(async () => { await this.synchronizeLegacy(); await this.reconcile(); await this.applyDocuments(); })
      .catch(() => { this.registration = 'error'; })
      .finally(() => { this.refreshing = null; if (this.refreshAgain) this.legacyChanged(); });
  }
  async reconcile({ recovery = false } = {}) {
    if (!recovery) this.recoveryAttempted = false;
    // ADR-113: the observation sensors follow the master of this configuration (sensor-quiet.js). The Custom registration below is unchanged.
    await this.scope.sensorGate?.noteAntidetect(this.configuration.antidetectEnabled === true);
    const networkState = await this.webrtcNetwork.reconcile(this.scope.hasDataConsent && this.configuration.antidetectEnabled ? this.configuration.webrtcNetworkPolicy : 'system');
    const protocolState = await this.antidetectProtocols.reconcile(this.configuration, this.scope.desiredMatches(), this.active());
    // ADR-105: HTTP headers follow the Custom JavaScript identity, so they need the same early registration. A header 'unsupported' is not an error.
    const headerState = await this.antidetectHeaders.reconcile(this.configuration, this.scope.desiredMatches(), this.active() && await this.readEarlyAccess() === 'ready');
    const nativeError = networkState.status === 'error' || protocolState.status === 'error' || headerState.status === 'error';
    const entries = this.active() ? [null, ...this.configuration.sites.map(site => site.host)].flatMap(host => customEntries(this.configuration, host)) : [];
    const deviceSeeds = await this.webrtcSeeds.prepare(entries);
    const mathSeed = await this.mathSeed.prepare(entries);
    const canvasSeed = await this.canvasSeed.prepare(entries);
    const audioSeed = await this.audioSeed.prepare(entries), webglSeed = await this.webglSeed.prepare(entries), networkSeed = await this.networkSeed.prepare(entries);
    const scripts = this.active() ? buildApiCustomScripts(this.configuration, this.scope.desiredMatches(), { deviceSeeds, mathSeed, canvasSeed, audioSeed, webglSeed, networkSeed, mediaBitrateBits:this.api.runtime.getURL('').startsWith('moz-extension:')?64:32 }) : [];
    try {
      const mediaMatches=[...new Set(scripts.flatMap(script=>script.matches))].sort(compare);
      const mediaWanted=entries.some(entry=>entry.id==='media-capabilities'&&entry.mode==='custom')&&mediaMatches.length>0;
      const mediaExisting=await this.api.scripting.getRegisteredContentScripts({ids:[MEDIA_RELAY_ID]});
      const mediaScript={id:MEDIA_RELAY_ID,js:['api-custom-media-relay.js'],matches:mediaMatches,world:'ISOLATED',runAt:'document_start',allFrames:true,persistAcrossSessions:true,matchOriginAsFallback:true};
      if(mediaWanted){
        if(mediaExisting.length)await this.api.scripting.updateContentScripts([mediaScript]);else await this.api.scripting.registerContentScripts([mediaScript]);
        const actual=(await this.api.scripting.getRegisteredContentScripts({ids:[MEDIA_RELAY_ID]}))[0];
        if(!actual||actual.world!=='ISOLATED'||actual.runAt!=='document_start'||actual.allFrames!==true||actual.matchOriginAsFallback!==true||JSON.stringify(actual.js)!==JSON.stringify(mediaScript.js)||JSON.stringify([...actual.matches??[]].sort(compare))!==JSON.stringify(mediaMatches))throw new Error('media-relay-registration-mismatch');
      }else if(mediaExisting.length)await this.api.scripting.unregisterContentScripts({ids:[MEDIA_RELAY_ID]});
      // Retire the asynchronous v1 delivery. New documents never receive its
      // public stop/apply channel, even after a browser/extension restart.
      const obsolete = await this.api.scripting.getRegisteredContentScripts({ ids: [...SCRIPT_IDS, INHERIT_SCRIPT_ID] });
      if (obsolete.length) await this.api.scripting.unregisterContentScripts({ ids: obsolete.map(row => row.id) });
      if (await this.readEarlyAccess() !== 'ready') {
        const inherit = (await this.api.scripting.getRegisteredContentScripts()).filter(row => row.id.startsWith(FALLBACK_PREFIX));
        if (inherit.length) await this.api.scripting.unregisterContentScripts({ ids: inherit.map(row => row.id) });
        this.registration = nativeError || scripts.length ? 'error' : 'inactive'; this.recoveryPending = true; return;
      }
      const existing = (await this.api.userScripts.getScripts()).filter(row => row.id.startsWith(API_CUSTOM_SCRIPT_PREFIX));
      const remove = existing.filter(old => !scripts.some(row => row.id === old.id)).map(row => row.id);
      const update = scripts.filter(row => existing.some(old => old.id === row.id));
      // A restored document can retain the prior session's immutable Math key.
      // Keep it shifted; the UI must require a new document for the fresh epoch.
      if (entries.some(row => ['math-transcendentals', 'canvas-readback', 'audio-fingerprint', 'webgl-readback', 'network-information'].includes(row.id)) && update.some(row => existing.some(old => old.id === row.id && JSON.stringify(old.js) !== JSON.stringify(row.js)))) this.reloadRequired = true;
      const add = scripts.filter(row => !existing.some(old => old.id === row.id));
      if (add.length) await this.api.userScripts.register(add);
      if (update.length) await this.api.userScripts.update(update);
      if (remove.length) await this.api.userScripts.unregister({ ids: remove });
      const inherits = (await this.api.scripting.getRegisteredContentScripts()).filter(row => row.id.startsWith(FALLBACK_PREFIX));
      const inheritance = scripts.map(script => {
        const site = this.configuration.sites.find(site => apiCustomSiteScriptId(site.host) === script.id);
        const entries = customEntries(this.configuration, site?.host ?? null).filter(entry => entry.mode === 'custom' || earlyBlockIds.has(entry.id));
        return { id: FALLBACK_PREFIX + script.id.slice(API_CUSTOM_SCRIPT_PREFIX.length),
          js: ['api-custom-inherit.main.js', ...entries.map(entry => entry.mode === 'on' ? 'antidetect-block-opaque.' + entry.id + '.js' : 'api-custom-opaque.' + entry.id + '.js')], matches: script.matches, excludeMatches: script.excludeMatches,
          world: 'MAIN', runAt: 'document_start', allFrames: true, persistAcrossSessions: true, matchOriginAsFallback: true };
      });
      const inheritAdd = inheritance.filter(row => !inherits.some(old => old.id === row.id));
      const inheritUpdate = inheritance.filter(row => inherits.some(old => old.id === row.id));
      const inheritRemove = inherits.filter(old => !inheritance.some(row => row.id === old.id)).map(row => row.id);
      if (inheritAdd.length) await this.api.scripting.registerContentScripts(inheritAdd);
      if (inheritUpdate.length) await this.api.scripting.updateContentScripts(inheritUpdate);
      if (inheritRemove.length) await this.api.scripting.unregisterContentScripts({ ids: inheritRemove });
      const actualInheritance = (await this.api.scripting.getRegisteredContentScripts()).filter(row => row.id.startsWith(FALLBACK_PREFIX));
      const sorted = rows => JSON.stringify([...rows ?? []].sort());
      if (actualInheritance.length !== inheritance.length || inheritance.some(script => !actualInheritance.some(row => row.id === script.id && row.world === 'MAIN' && row.runAt === 'document_start' && row.allFrames === true && row.persistAcrossSessions === true && row.matchOriginAsFallback === true && sorted(row.matches) === sorted(script.matches) && sorted(row.excludeMatches) === sorted(script.excludeMatches) && JSON.stringify(row.js) === JSON.stringify(script.js)))) throw new Error('inheritance-registration-mismatch');
      const actual = (await this.api.userScripts.getScripts()).filter(row => row.id.startsWith(API_CUSTOM_SCRIPT_PREFIX));
      const list = values => [...values ?? []].sort().join('\n');
      if (actual.length !== scripts.length || scripts.some(script => !actual.some(row =>
        row.id === script.id && list(row.matches) === list(script.matches) && list(row.excludeMatches) === list(script.excludeMatches) && JSON.stringify(row.js) === JSON.stringify(script.js) &&
        row.world === 'MAIN' && row.runAt === 'document_start' && row.allFrames === true))) throw new Error('registration-mismatch');
      this.registration = nativeError ? 'error' : scripts.length ? 'ready' : 'inactive';
      this.recoveryPending = nativeError;
    } catch {
      this.registration = 'error';
      this.recoveryPending = true;
      // Keep the last installed Custom profile on failure. Clearing it here
      // would expose native values in concurrent navigations during an update.
    }
  }
  async identity(tabId) {
    if (tabId === null) return { host: null, documentId: null };
    try {
      const frame = (await this.api.webNavigation.getAllFrames({ tabId }))?.find(row => row.frameId === 0);
      const url = frame && new URL(frame.url);
      if (frame?.documentId && ['http:', 'https:'].includes(url.protocol)) return { host: url.hostname, documentId: frame.documentId };
    } catch {}
    return { host: null, documentId: null };
  }
  async recoverRegistration() {
    if (this.recoveryInFlight) { await this.recoveryInFlight; return; }
    if (!this.recoveryPending || this.recoveryAttempted || this.earlyAccess !== 'ready') return;
    // One read-triggered attempt per failed application/access restoration. A
    // persistent browser failure never turns ordinary UI polling into a retry loop.
    this.recoveryAttempted = true;
    this.recoveryInFlight = this.serialize(async () => {
      if (!this.recoveryPending) return;
      await this.synchronizeLegacy();
      await this.reconcile({ recovery: true });
      await this.applyDocuments();
      if (!this.recoveryPending && this.legacy.registration !== 'error') {
        await this.legacy.finishApplication();
        if (this.legacy.registration === 'error') { this.registration = 'error'; this.recoveryPending = true; }
      }
    }).catch(() => { this.registration = 'error'; this.recoveryPending = true; })
      .finally(() => { this.recoveryInFlight = null; });
    await this.recoveryInFlight;
  }
  async state(tabId, recover = true) {
    await this.start(); await this.legacy.chain;
    await this.readEarlyAccess();
    if (recover) await this.recoverRegistration();
    return { schemaVersion: 1, type: 'api-config-state', revision: this.revision, configuration: clone(this.configuration),
      ...await this.identity(tabId), registration: this.storageError ? 'error' : this.active() && this.earlyAccess !== 'ready' && this.registration === 'ready' ? 'inactive' : this.registration, reloadRequired: this.reloadRequired, earlyAccess: this.earlyAccess, webrtcNetwork: await this.webrtcNetwork.inspect() };
  }
  async set(configuration, expectedRevision, tabId) {
    await this.start();
    return await this.persist(configuration, expectedRevision, { gated: true }) ?? this.state(tabId, false);
  }
  // The one write path: a UI write (set) and the start-up revert of a temporary profile (restoreTemporary) share it, so both go through the
  // same validation, revision check, storage write and legacy projection. Returns null on success or an error reply. `gated: false` skips the
  // two "may this be activated now" refusals below: restoring a state that was applied before must not be refused because a permission or
  // the browser's early-script switch is missing today (reconcile then reports the registration state as it does after any restart).
  async persist(configuration, expectedRevision, { gated }) {
    // ADR-107: UI writes refuse new or renamed unsafe labels; stored ones stay grandfathered.
    const checked = validateApiConfigurationWrite(configuration, this.configuration);
    if (!checked.ok) return error(checked.error.code, checked.error.message);
    if (gated && appliedSignature(checked.value) !== appliedSignature(this.configuration)) {
      if (checked.value.antidetectEnabled && this.webrtcNetwork.refusal(checked.value.webrtcNetworkPolicy)) return error('webrtc-policy-unsupported', 'This WebRTC network policy is not available in this browser.');
      if (checked.value.antidetectEnabled && checked.value.webrtcNetworkPolicy !== 'system' && !await this.webrtcNetwork.allowed()) return error('privacy-permission-required', 'Enable WebRTC network access before applying this configuration.');
      if ([null, ...checked.value.sites.map(site => site.host)].some(host => customEntries(checked.value, host).length) && await this.readEarlyAccess() !== 'ready') return error('early-access-required', 'Enable the browser early Custom API before activating this configuration.');
    }
    const outcome = await this.serialize(async () => {
      await this.synchronizeLegacy();
      if (expectedRevision !== this.revision || this.revision >= Number.MAX_SAFE_INTEGER) return error('stale-revision');
      const previous = this.legacy.settings;
      const applicationChanged = appliedSignature(checked.value) !== appliedSignature(this.configuration);
      // FP06 / ADR-083: library-only CAS writes do not reactivate the saved application.
      if (gated && applicationChanged) {
        if (checked.value.antidetectEnabled && checked.value.webrtcNetworkPolicy !== 'system' && !await this.webrtcNetwork.allowed()) return error('privacy-permission-required', 'Enable WebRTC network access before applying this configuration.');
        if ([null, ...checked.value.sites.map(site => site.host)].some(host => customEntries(checked.value, host).length) && await this.readEarlyAccess() !== 'ready') return error('early-access-required', 'Enable the browser early Custom API before activating this configuration.');
      }
      const projection = configurationToLegacy(checked.value, previous);
      const legacyChanged = signature(projection) !== signature(previous);
      if (legacyChanged && (!Number.isSafeInteger(previous.revision) || previous.revision >= Number.MAX_SAFE_INTEGER)) return error('stale-revision');
      const next = legacyChanged ? { ...projection, revision: previous.revision + 1 } : previous;
      const revision = this.revision + 1;
      try {
        await this.api.storage.local.set({ [API_CONFIGURATION_STORAGE_KEY]: { revision, configuration: checked.value }, ...(applicationChanged ? { [LEGACY_KEY]: next, [PENDING_KEY]: true } : {}) });
      } catch { return error('storage-error'); }
      this.configuration = checked.value; this.revision = revision; this.storageError = false;
      if (!applicationChanged) return null;
      this.legacy.settings = next; this.legacy.cleanupIncomplete = false;
      try {
        await this.legacy.reconcile();
        if (legacyChanged && (previous.enabled || next.enabled)) await this.legacy.stopOpenDocuments();
        await this.reconcile();
        await this.applyDocuments();
        if (this.legacy.registration !== 'error' && this.registration !== 'error') await this.legacy.finishApplication();
      } catch {
        // Persistence already committed. Report application state, not a false
        // storage rollback; the pending marker makes interrupted cleanup retry.
        this.registration = 'error'; this.reloadRequired = true;
      }
      return null;
    });
    return outcome;
  }
  async permitted(context) {
    if (!this.active() || this.registration !== 'ready' || !context.originPattern || context.documentLifecycle === 'prerender') return false;
    const generation = this.scope.accessGeneration;
    return await this.scope.isGranted(context.originPattern, context.tabId, context.documentId) && this.active() && generation === this.scope.accessGeneration;
  }
  async page(sender) {
    await this.start();
    const read = this.readPageSender(sender, this.api.runtime.id);
    if (!read.ok) return error('unauthorized-sender');
    // Compatibility reply only: v2 never transports values through page messages.
    return { schemaVersion: 1, type: 'api-custom-state', revision: this.revision, entries: [] };
  }
  async applyDocuments() {
    this.reloadRequired = false;
    // Protected values/native handles live until the document is discarded.
    // Replacing a wrapper in place could expose native through retained links.
    const tabs = await this.api.tabs.query({});
    for (const tab of tabs.slice(0, 128)) {
      if (!Number.isInteger(tab.id)) continue;
      let frames;
      try { frames = await this.api.webNavigation.getAllFrames({ tabId: tab.id }); } catch { continue; }
      for (const frame of (frames ?? []).slice(0, 128)) {
        if (['http:', 'https:'].some(scheme => frame.url?.startsWith(scheme))) { this.reloadRequired = true; return; }
      }
    }
  }
  removed(tabId) { for (const [key, context] of this.documents) if (context.tabId === tabId) this.documents.delete(key); }
  route(message, sender) {
    const media=this.mediaRoute(message,sender);if(media!==null)return media;
    const type = own(message, 'type');
    if (!['ui-api-config-get', 'ui-api-config-set', 'api-custom-ready'].includes(type)) return null;
    if (this.pending >= 16) return Promise.resolve(error('busy'));
    const keys = Reflect.ownKeys(message), expected = type === 'api-custom-ready' ? ['schemaVersion', 'type'] : type === 'ui-api-config-get' ? ['schemaVersion', 'type', 'tabId'] : ['schemaVersion', 'type', 'tabId', 'expectedRevision', 'configuration'];
    if (own(message, 'schemaVersion') !== 1 || keys.length !== expected.length || expected.some(key => !Object.getOwnPropertyDescriptor(message, key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(message, key), 'value'))) return Promise.resolve(error('invalid-request'));
    if (type !== 'api-custom-ready' && (!this.verifyUiSender(sender, this.api.runtime.id) || !validTab(own(message, 'tabId')))) return Promise.resolve(error('unauthorized-sender'));
    if (type === 'ui-api-config-set' && (!Number.isSafeInteger(own(message, 'expectedRevision')) || message.expectedRevision < 0)) return Promise.resolve(error('invalid-request'));
    this.pending++;
    return (async () => {
      await this.whenReady();
      if (type === 'api-custom-ready') return this.page(sender);
      if (!this.scope.hasDataConsent) return error('no-access');
      return type === 'ui-api-config-get' ? this.state(message.tabId) : this.set(message.configuration, message.expectedRevision, message.tabId);
    })().catch(() => error('storage-error')).finally(() => { this.pending--; });
  }
}
