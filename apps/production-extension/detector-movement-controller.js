// ADR-097: Options-only metadata sampling of a fixed ISOLATED-world lease.
import {detectorMovementLease} from './detector-movement-counter.js';

const MAX = 2147483647, FRAME_LIMIT = 64, SCAN_LIMIT = 256;
const boundedId = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX;
const nativeFrameId = value => Number.isSafeInteger(value) && value >= 0;
const documentId = value => typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,128}$/u.test(value);
function own(value, key) {
  if (value === null || typeof value !== 'object') return undefined;
  const field = Object.getOwnPropertyDescriptor(value, key);
  return field && Object.hasOwn(field, 'value') ? field.value : undefined;
}
function webUrl(value, child = false) {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) || child && ['about:blank', 'about:srcdoc'].includes(url.href);
  } catch {return false;}
}
function ownedOptions(root, api) {
  try {
    const window = root.window ?? root, expected = new URL(api.runtime.getURL('options.html')), actual = new URL(root.location.href);
    return window === window.top && actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname;
  } catch {return false;}
}
function movementPolicy(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const scopeMode = own(value, 'scopeMode'), hosts = own(value, 'hosts'), grantedAllSites = own(value, 'grantedAllSites'), activeDocumentId = own(value, 'activeDocumentId');
    if (!['all-sites', 'site', 'active-tab'].includes(scopeMode) || typeof grantedAllSites !== 'boolean' || !Array.isArray(hosts) || hosts.length > 512) return null;
    const selected = new Set();
    for (let index = 0; index < hosts.length; index++) {
      const host = own(hosts, index);
      if (typeof host !== 'string' || !host.length || host.length > 253) return null;
      const url = new URL('https://' + host);
      if (url.hostname !== host || url.host !== host || url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
      selected.add(host);
    }
    if (scopeMode === 'all-sites' && grantedAllSites !== true || scopeMode === 'site' && !selected.size || scopeMode === 'active-tab' && !documentId(activeDocumentId)) return null;
    return Object.freeze({scopeMode, hosts: Object.freeze([...selected].sort()), grantedAllSites, ...(scopeMode === 'active-tab' ? {activeDocumentId} : {})});
  } catch {return null;}
}
function policyAllowsFrame(policy, url, id) {
  try {const parsed = new URL(url);return ['http:', 'https:'].includes(parsed.protocol) && (policy.scopeMode === 'all-sites' || policy.scopeMode === 'site' && policy.hosts.includes(parsed.hostname) || policy.scopeMode === 'active-tab' && id === 0);} catch {return false;}
}
export function createDetectorMovementController({browserApi = globalThis.chrome, root = globalThis, tabId, isCurrent = () => false, authorize = async () => false, onChange = () => {}, pollMs = 1000, getNativeFrames = request => browserApi.webNavigation.getAllFrames(request)} = {}) {
  const interval = Number.isFinite(pollMs) ? Math.max(1000, pollMs) : 1000;
  const now = () => typeof root.performance?.now === 'function' ? root.performance.now() : Date.now();
  let current = Object.freeze({state: 'idle', count: null, frameCount: 0, partial: false});
  let running = false, disposed = false, reading = false, revision = 0, timer = null, lastRead = -Infinity;
  let leaseId = null, lastFrames = [], known = new Map(), total = 0, limited = false, topDocument = null, boundPolicy = null, policyKey = null;
  const timeoutError = new Error('movement-timeout');
  const bounded = (promise, milliseconds = 1500) => {
    let timeout;
    return Promise.race([Promise.resolve(promise), new Promise((_, reject) => {timeout = root.setTimeout(() => reject(timeoutError), milliseconds);})]).finally(() => root.clearTimeout(timeout));
  };
  const publish = value => {current = Object.freeze(value);try {onChange(current);} catch { /* A closed view cannot retain a lease. */ }};
  const permitted = () => {
    try {return running && !disposed && boundedId(tabId) && ownedOptions(root, browserApi) && isCurrent() === true;} catch {return false;}
  };
  const fresh = token => token === revision && permitted();
  const cancelTimer = () => {if (timer !== null) {root.clearTimeout(timer);timer = null;}};
  const targetFor = (frames, policy) => policy?.scopeMode === 'active-tab' ? {tabId, documentIds: [policy.activeDocumentId]} : {tabId, frameIds: [...frames]};
  async function closeFrames(frames = lastFrames, policy = boundPolicy) {
    if (!leaseId || !frames.length || !ownedOptions(root, browserApi)) return;
    try {await bounded(browserApi.scripting.executeScript({target: targetFor(frames, policy), world: 'ISOLATED', func: detectorMovementLease, args: ['close', leaseId]}));} catch { /* Each lease also expires locally. */ }
  }
  function schedule() {
    if (!permitted() || timer !== null || reading) return;
    const delay = Math.max(0, interval - (now() - lastRead));
    timer = root.setTimeout(() => {timer = null;void sample();}, delay);
  }
  async function sample() {
    if (reading) return;
    if (!permitted()) {
      if (running && !disposed) {running = false;++revision;publish({state: 'unavailable', count: null, frameCount: 0, partial: false});await closeFrames();}
      return;
    }
    reading = true;const token = revision;lastRead = now();
    let requested = [];
    try {
      const policy = movementPolicy(await bounded(authorize()));
      if (!policy || !fresh(token)) {
        if (token === revision && running) {running = false;++revision;publish({state: 'unavailable', count: null, frameCount: 0, partial: false});await closeFrames();}
        return;
      }
      const key = JSON.stringify(policy);
      if (policyKey !== null && key !== policyKey) {running = false;++revision;publish({state: 'unavailable', count: null, frameCount: 0, partial: false});await closeFrames();return;}
      boundPolicy = policy;policyKey = key;
      if (!fresh(token)) return;
      const tab = await bounded(browserApi.tabs.get(tabId));
      if (!fresh(token)) return;
      if (own(tab, 'id') !== tabId || !webUrl(own(tab, 'url'))) throw Error('movement-source-unavailable');
      if (!fresh(token)) return;
      const frames = await bounded(getNativeFrames({tabId}));
      if (!fresh(token)) return;
      if (!Array.isArray(frames)) throw Error('movement-frames-unavailable');
      let partial = frames.length > FRAME_LIMIT;
      const selected = new Map();
      for (let index = 0; index < Math.min(frames.length, SCAN_LIMIT); index++) {
        const frame = own(frames, index), id = own(frame, 'frameId'), nativeDocument = own(frame, 'documentId');
        if (!nativeFrameId(id) || selected.has(id) || !webUrl(own(frame, 'url'), id !== 0) || !policyAllowsFrame(policy, own(frame, 'url'), id)) {partial = true;continue;}
        if (selected.size >= FRAME_LIMIT && id !== 0) {partial = true;continue;}
        if (selected.size >= FRAME_LIMIT) {selected.delete(selected.keys().next().value);partial = true;}
        selected.set(id, documentId(nativeDocument) ? nativeDocument : null);
        if (!documentId(nativeDocument)) partial = true;
      }
      if (!selected.has(0)) throw Error('movement-top-frame-unavailable');
      const currentTop = selected.get(0);
      if (policy.scopeMode === 'active-tab' && currentTop !== policy.activeDocumentId) throw Error('movement-active-document-unavailable');
      if (topDocument !== null && currentTop !== null && topDocument !== currentTop) {
        running = false;++revision;publish({state: 'unavailable', count: null, frameCount: 0, partial: false});await closeFrames();return;
      }
      if (currentTop !== null) topDocument = currentTop;
      requested = [...selected.keys()];lastFrames = requested;
      if (!fresh(token)) return;
      const pending = browserApi.scripting.executeScript({target: targetFor(requested, policy), world: 'ISOLATED', func: detectorMovementLease, args: ['sample', leaseId, policy]});
      void Promise.resolve(pending).then(() => {if (!fresh(token)) void closeFrames(requested, policy);}, () => {});
      const results = await bounded(pending);
      if (!fresh(token)) {await closeFrames(requested);return;}
      if (!Array.isArray(results) || results.length > FRAME_LIMIT) throw Error('movement-results-unavailable');
      const next = new Map(), seen = new Set();let delta = 0;
      for (let index = 0; index < results.length; index++) {
        const item = own(results, index), id = own(item, 'frameId'), nativeDocument = own(item, 'documentId'), value = own(item, 'result');
        if (!nativeFrameId(id) || !selected.has(id) || seen.has(id)) {partial = true;continue;}
        seen.add(id);
        const expected = selected.get(id);
        if (expected !== null && nativeDocument !== expected || nativeDocument !== undefined && !documentId(nativeDocument)) {partial = true;continue;}
        if (!documentId(nativeDocument)) partial = true;
        const amount = own(value, 'count'), generation = own(value, 'generation'), documentToken = own(value, 'documentToken'), saturated = own(value, 'saturated');
        if (own(value, 'state') !== 'ready' || !boundedId(amount) || !boundedId(generation) || generation < 1 || typeof documentToken !== 'string' || !/^[a-f0-9]{32}$/u.test(documentToken) || typeof saturated !== 'boolean') {partial = true;continue;}
        const previous = known.get(id);
        if (previous && previous.documentToken === documentToken && previous.generation !== generation) partial = true;
        const nativeIdentity = documentId(nativeDocument) ? nativeDocument : expected;
        if (previous && previous.documentToken !== documentToken &&
            (nativeIdentity === null || previous.nativeDocumentId === null || previous.nativeDocumentId === nativeIdentity)) partial = true;
        const sameEpoch = previous && previous.documentToken === documentToken && previous.generation === generation && previous.nativeDocumentId === nativeIdentity;
        if (sameEpoch && amount < previous.count) partial = true;
        // First reads establish a baseline. An unseen/evicted epoch with a
        // positive count may already have contributed before a lost reply or
        // frame disappearance; never add it again as supposedly new movement.
        if (!sameEpoch && amount > 0) partial = true;
        const increment = sameEpoch ? Math.max(0, amount - previous.count) : 0;
        // A child document starts a new baseline; its old observed deltas remain
        // in this view's total, without retaining removed frame identities.
        next.set(id, {documentToken, generation, nativeDocumentId: nativeIdentity, count: amount});
        if (delta + increment > MAX || saturated) partial = true;
        delta = Math.min(MAX, delta + increment);
      }
      if (next.size !== selected.size) partial = true;
      for (const [id, previous] of known) {
        const value = next.get(id);
        if (!value || value.documentToken !== previous.documentToken || value.generation !== previous.generation || value.nativeDocumentId !== previous.nativeDocumentId) partial = true;
      }
      known = next;
      if (!next.size) {publish({state: 'unavailable', count: null, frameCount: 0, partial: true});await closeFrames(requested);}
      else {
        if (total + delta > MAX) partial = true;
        total = Math.min(MAX, total + delta);limited ||= partial;
        publish({state: limited ? 'partial' : 'ready', count: total, frameCount: next.size, partial: limited});
      }
    } catch (error) {
      if (fresh(token)) {limited = true;publish({state: 'unavailable', count: null, frameCount: 0, partial: false});await closeFrames(requested.length ? requested : lastFrames);known.clear();if (error === timeoutError) {running = false;++revision;}}
    } finally {
      reading = false;
      if (permitted()) schedule();
      else if (running && !disposed) {running = false;++revision;publish({state: 'unavailable', count: null, frameCount: 0, partial: false});void closeFrames();}
    }
  }
  const pageHidden = () => {void stop();};
  async function start() {
    if (disposed || running) return;
    if (!boundedId(tabId) || !ownedOptions(root, browserApi)) {publish({state: 'unavailable', count: null, frameCount: 0, partial: false});return;}
    try {
      leaseId = root.crypto.randomUUID();
      if (!/^[a-f0-9-]{20,64}$/u.test(leaseId)) throw Error('invalid-movement-lease');
    } catch {publish({state: 'unavailable', count: null, frameCount: 0, partial: false});return;}
    running = true;++revision;root.addEventListener?.('pagehide', pageHidden, {once: true});
    await sample();
  }
  async function stop() {
    if (disposed) return;
    disposed = true;running = false;++revision;cancelTimer();root.removeEventListener?.('pagehide', pageHidden);known.clear();
    publish({state: 'stopped', count: null, frameCount: 0, partial: false});await closeFrames();
  }
  return Object.freeze({start, stop, getSnapshot: () => current});
}
