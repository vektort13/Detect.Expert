// ADR-063: explicit own-UI environment reads and bounded native setting changes.
import { BROWSER_DEBUG_LIMITS, debugFail, debugField, debugRecord, debugText, debugNumber, debugSame } from './browser-debug-shared.js';

const PRIVACY = Object.freeze([
  'network.networkPredictionEnabled',
  'services.alternateErrorPagesEnabled', 'services.autofillAddressEnabled', 'services.autofillCreditCardEnabled',
  'services.passwordSavingEnabled', 'services.safeBrowsingEnabled', 'services.safeBrowsingExtendedReportingEnabled',
  'services.searchSuggestEnabled', 'services.spellingServiceEnabled', 'services.translationServiceEnabled',
  'websites.doNotTrackEnabled', 'websites.hyperlinkAuditingEnabled', 'websites.protectedContentEnabled',
  'websites.referrersEnabled', 'websites.thirdPartyCookiesAllowed',
]);
const RTC = 'network.webRTCIPHandlingPolicy';
const CONTROLS = Object.freeze(['not_controllable', 'controlled_by_other_extensions', 'controllable_by_this_extension', 'controlled_by_this_extension']);
const CONTENT = Object.freeze({
  automaticDownloads: ['allow', 'block', 'ask'], camera: ['allow', 'block', 'ask'], clipboard: ['allow', 'block', 'ask'],
  cookies: ['allow', 'block', 'session_only'], images: ['allow', 'block'], javascript: ['allow', 'block'],
  location: ['allow', 'block', 'ask'], microphone: ['allow', 'block', 'ask'], notifications: ['allow', 'block', 'ask'],
  popups: ['allow', 'block'], sound: ['allow', 'block'],
});
const INTERNALS = Object.freeze({
  chrome: Object.freeze([
    ['version', 'chrome://version/'], ['privacy', 'chrome://settings/privacy'], ['site-settings', 'chrome://settings/content'],
    ['history', 'chrome://history/'], ['bookmarks', 'chrome://bookmarks/'], ['downloads', 'chrome://downloads/'],
    ['extensions', 'chrome://extensions/'], ['policy', 'chrome://policy/'], ['sync', 'chrome://sync-internals/'],
    ['site-engagement', 'chrome://site-engagement/'], ['media-engagement', 'chrome://media-engagement/'],
  ]),
  firefox: Object.freeze([
    ['support', 'about:support'], ['privacy', 'about:preferences#privacy'], ['preferences', 'about:preferences#general'],
    ['extensions', 'about:addons'], ['profiles', 'about:profiles'], ['policy', 'about:policies'], ['configuration', 'about:config'],
  ]),
});
const own = (object, key) => object && typeof object === 'object' ? Object.getOwnPropertyDescriptor(object, key)?.value : undefined;
function data(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) debugFail('invalid-input');
  const prototype = Object.getPrototypeOf(value), names = Reflect.ownKeys(value);
  if (prototype !== null && prototype !== Object.prototype || names.length !== keys.length || names.some(key => !keys.includes(key))) debugFail('invalid-input');
  for (const key of keys) { const field = Object.getOwnPropertyDescriptor(value, key); if (!field || !Object.hasOwn(field, 'value')) debugFail('invalid-input'); }
  return value;
}
function originOf(input) {
  if (typeof input !== 'string' || input.length > BROWSER_DEBUG_LIMITS.string) debugFail('invalid-input');
  let url; try { url = new URL(input); } catch { debugFail('invalid-input'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) debugFail('invalid-input');
  return url.origin;
}
function patternFor(origin) {
  const url = new URL(origin);
  // A missing content-setting pattern port means ALL ports, not the URL default.
  return url.protocol + '//' + url.hostname + ':' + (url.port || (url.protocol === 'https:' ? '443' : '80')) + '/*';
}

export function createBrowserDebugEnvironmentDriver(ctx) {
  const { api, env } = ctx;
  const setting = path => { const [group, key] = path.split('.'); return api.privacy?.[group]?.[key]; };
  const content = type => Object.hasOwn(CONTENT, type) ? api.contentSettings?.[type] : undefined;
  const has = (target, method) => typeof target?.[method] === 'function';
  function supports(id) {
    if (id === 'overview') return true;
    if (id === 'system') return ['cpu', 'memory', 'storage', 'display'].some(type => has(api.system?.[type], 'getInfo'));
    if (id === 'account') return has(api.identity, 'getProfileUserInfo');
    if (id === 'privacy') return [...PRIVACY, RTC].some(path => has(setting(path), 'get'));
    if (id === 'site-permissions') return Object.keys(CONTENT).some(type => has(content(type), 'get'));
    if (id === 'internals') return Object.hasOwn(INTERNALS, ctx.browser) && has(api.tabs, 'create');
    return false;
  }
  async function privacyState(path) {
    if (!PRIVACY.includes(path) && path !== RTC) debugFail('invalid-input');
    const target = setting(path); if (!has(target, 'get')) debugFail('unsupported');
    const native = await ctx.call(target, 'get', [{ incognito: false }]);
    if (!native || !CONTROLS.includes(native.levelOfControl) || native.incognitoSpecific === true || (path === RTC ? !['default', 'default_public_and_private_interfaces', 'default_public_interface_only', 'disable_non_proxied_udp', 'proxy_only'].includes(native.value) : typeof native.value !== 'boolean')) debugFail('unsupported');
    return { kind: 'privacy', path, value: native.value, levelOfControl: native.levelOfControl };
  }
  async function contentState(type, origin) {
    const target = content(type); if (!has(target, 'get')) debugFail('unsupported');
    const native = await ctx.call(target, 'get', [{ primaryUrl: origin + '/', secondaryUrl: origin + '/', incognito: false }]);
    if (!native || !CONTENT[type].includes(native.setting)) debugFail('unsupported');
    return { kind: 'site-permissions', type, origin, value: native.setting };
  }
  function privateReference(id, reference) {
    if (id === 'privacy') {
      data(reference, ['kind', 'path', 'value', 'levelOfControl']);
      if (reference.kind !== 'privacy' || ![...PRIVACY, RTC].includes(reference.path) || !CONTROLS.includes(reference.levelOfControl) || (reference.path === RTC ? typeof reference.value !== 'string' : typeof reference.value !== 'boolean')) debugFail('invalid-input');
    } else if (id === 'site-permissions') {
      data(reference, ['kind', 'type', 'origin', 'value']);
      if (reference.kind !== 'site-permissions' || !Object.hasOwn(CONTENT, reference.type) || !CONTENT[reference.type].includes(reference.value) || originOf(reference.origin) !== reference.origin) debugFail('invalid-input');
    } else if (id === 'internals') {
      data(reference, ['kind', 'key', 'url']);
      if (reference.kind !== 'internal' || !INTERNALS[ctx.browser]?.some(([key, url]) => key === reference.key && url === reference.url)) debugFail('invalid-input');
    } else debugFail('unsupported');
    return reference;
  }
  async function fresh(id, reference) {
    privateReference(id, reference);
    const current = id === 'privacy' ? await privacyState(reference.path) : id === 'site-permissions' ? await contentState(reference.type, reference.origin) : reference;
    if (!debugSame(current, reference)) debugFail('stale-record');
    return current;
  }
  async function read(id, options = {}) {
    if (!supports(id)) debugFail('unsupported');
    ctx.check();
    const records = []; let truncated = false, exhausted = false, nodes = 0, bytes = 0;
    const append = (name, value) => {
      if (records.length >= BROWSER_DEBUG_LIMITS.rows) { truncated = true; return; }
      if (name.length > BROWSER_DEBUG_LIMITS.string || typeof value === 'string' && value.length > BROWSER_DEBUG_LIMITS.string) truncated = true;
      const record = debugRecord({ name: debugText(name), value: typeof value === 'string' ? debugText(value) : value });
      const length = new TextEncoder().encode(JSON.stringify(record)).length;
      if (bytes + length + 1 > BROWSER_DEBUG_LIMITS.bytes - 1024) { truncated = true; exhausted = true; return; }
      bytes += length; records.push(record);
    };
    function flatten(name, value, depth = 0, limit = BROWSER_DEBUG_LIMITS.rows) {
      if (exhausted || ++nodes > BROWSER_DEBUG_LIMITS.scan || depth > 6 || records.length >= limit) { truncated = true; return; }
      if (value === null || typeof value === 'boolean' || typeof value === 'string') append(name, value);
      else if (typeof value === 'number') append(name, debugNumber(value));
      else if (value && typeof value === 'object') {
        const keys = Object.keys(value);
        for (let index = 0; index < keys.length; index++) {
          if (exhausted || nodes >= BROWSER_DEBUG_LIMITS.scan || records.length >= limit) { truncated = true; break; }
          const field = Object.getOwnPropertyDescriptor(value, keys[index]);
          if (field && Object.hasOwn(field, 'value')) flatten(name + '.' + keys[index], field.value, depth + 1, limit);
        }
      }
    }
    if (id === 'overview') {
      for (const key of ['userAgent', 'platform', 'language', 'languages', 'hardwareConcurrency', 'deviceMemory', 'maxTouchPoints', 'cookieEnabled', 'onLine', 'webdriver']) flatten('navigator.' + key, env.navigator?.[key]);
      if (has(api.runtime, 'getPlatformInfo')) flatten('runtime.platform', await ctx.call(api.runtime, 'getPlatformInfo'));
      if (has(api.runtime, 'getBrowserInfo')) flatten('runtime.browser', await ctx.call(api.runtime, 'getBrowserInfo'));
      if (has(api.runtime, 'getManifest')) {
        const manifest = await ctx.call(api.runtime, 'getManifest');
        for (const key of ['name', 'version', 'manifest_version', 'default_locale', 'minimum_chrome_version', 'incognito', 'permissions', 'optional_permissions', 'host_permissions', 'optional_host_permissions']) flatten('manifest.' + key, own(manifest, key));
      }
      for (const area of ['local', 'sync', 'session']) if (has(api.storage?.[area], 'getBytesInUse')) flatten('storage.' + area + '.bytes', await ctx.call(api.storage[area], 'getBytesInUse', [null]));
    } else if (id === 'system') {
      const types = ['cpu', 'memory', 'storage', 'display'].filter(type => has(api.system?.[type], 'getInfo'));
      for (const type of types) flatten('system.' + type, await ctx.call(api.system[type], 'getInfo'), 0, records.length + Math.floor(BROWSER_DEBUG_LIMITS.rows / types.length));
    } else if (id === 'account') {
      const account = await ctx.call(api.identity, 'getProfileUserInfo', [{ accountStatus: 'ANY' }]);
      for (const key of ['email', 'id']) { if (typeof own(account, key) !== 'string') debugFail('unsupported'); append('account.' + key, own(account, key)); }
    } else if (id === 'privacy') {
      for (const path of [...PRIVACY, RTC]) if (has(setting(path), 'get')) {
        const reference = await privacyState(path), target = setting(path), actions = [];
        if (path === RTC) actions.push('api-guard');
        else {
          if (has(target, 'set') && ['controllable_by_this_extension', 'controlled_by_this_extension'].includes(reference.levelOfControl)) actions.push('edit');
          if (has(target, 'clear') && reference.levelOfControl === 'controlled_by_this_extension') actions.push('clear');
        }
        records.push(debugRecord({ name: path, value: reference.value, levelOfControl: reference.levelOfControl }, reference, actions));
      }
    } else if (id === 'site-permissions') {
      const origin = originOf(options.origin);
      for (const type of Object.keys(CONTENT)) if (has(content(type), 'get')) {
        const reference = await contentState(type, origin);
        records.push(debugRecord({ name: type, value: reference.value, origin, scope: ['cookies', 'location'].includes(type) ? 'same-origin-context' : 'exact-origin' }, reference, has(content(type), 'set') ? ['edit'] : []));
      }
    } else if (id === 'internals') {
      for (const [key, url] of INTERNALS[ctx.browser]) records.push(debugRecord({ name: key, url }, { kind: 'internal', key, url }, ['open']));
    }
    ctx.check(); return { records, truncated };
  }
  function describe(id, operation, reference) {
    ctx.check();
    const current = privateReference(id, reference);
    if (id === 'privacy') {
      const target = setting(current.path);
      if (current.path === RTC) { if (operation !== 'api-guard') debugFail('unsupported'); return { fields: [], destructive: false }; }
      if (operation === 'edit' && has(target, 'set') && ['controllable_by_this_extension', 'controlled_by_this_extension'].includes(current.levelOfControl)) return { fields: [debugField('value', 'boolean', current.value)], destructive: current.path === 'services.safeBrowsingEnabled' };
      if (operation === 'clear' && has(target, 'clear') && current.levelOfControl === 'controlled_by_this_extension') return { fields: [], destructive: true };
      debugFail('not-controllable');
    }
    if (id === 'site-permissions' && operation === 'edit' && has(content(current.type), 'set')) return { fields: [debugField('value', 'select', current.value, { options: [...CONTENT[current.type]] })], destructive: false };
    if (id === 'internals' && operation === 'open') return { fields: [], destructive: false };
    debugFail('unsupported');
  }
  async function write(id, operation, reference, patch = {}) {
    const current = await fresh(id, reference);
    if (id === 'privacy') {
      if (current.path === RTC) debugFail('unsupported'); // The API Guard is its only native policy writer.
      const target = setting(current.path);
      if (operation === 'edit') {
        data(patch, ['value']); if (typeof patch.value !== 'boolean') debugFail('invalid-input');
        if (!has(target, 'set') || !['controllable_by_this_extension', 'controlled_by_this_extension'].includes(current.levelOfControl)) debugFail('not-controllable');
        if (patch.value === current.value) return { applied: false, unchanged: true };
        ctx.check(); if (await ctx.call(target, 'set', [{ value: patch.value, scope: 'regular' }]) === false) debugFail('verification-failed');
        const applied = await privacyState(current.path);
        if (applied.value !== patch.value || applied.levelOfControl !== 'controlled_by_this_extension') debugFail('verification-failed');
        return { applied: true, value: applied.value };
      }
      if (operation === 'clear') {
        data(patch, []); if (!has(target, 'clear') || current.levelOfControl !== 'controlled_by_this_extension') debugFail('not-controllable');
        ctx.check(); if (await ctx.call(target, 'clear', [{ scope: 'regular' }]) === false) debugFail('verification-failed');
        const applied = await privacyState(current.path); if (applied.levelOfControl === 'controlled_by_this_extension') debugFail('verification-failed');
        return { applied: true, value: applied.value };
      }
    } else if (id === 'site-permissions' && operation === 'edit') {
      data(patch, ['value']); if (!CONTENT[current.type].includes(patch.value)) debugFail('invalid-input');
      const target = content(current.type); if (!has(target, 'set')) debugFail('unsupported');
      if (patch.value === current.value) return { applied: false, unchanged: true };
      const pattern = patternFor(current.origin), details = { primaryPattern: pattern, setting: patch.value, scope: 'regular' };
      if (['cookies', 'location'].includes(current.type)) details.secondaryPattern = pattern;
      ctx.check(); if (await ctx.call(target, 'set', [details]) === false) debugFail('not-applied');
      const applied = await contentState(current.type, current.origin); if (applied.value !== patch.value) debugFail('not-applied');
      return { applied: true, value: applied.value };
    } else if (id === 'internals' && operation === 'open') {
      data(patch, []); ctx.check(); await ctx.call(api.tabs, 'create', [{ url: current.url }]); return { opened: true };
    }
    debugFail('unsupported');
  }
  return { supports, read, describe, write };
}
