// Fixture and pure checks for antidetect-consistency-native.mjs: what one owned page reads in every realm a site can
// reach (top, same-origin iframe, srcdoc, about:blank, a popup, a dedicated worker) and which of those reads must agree.
// The page only reads standard APIs; it never probes automation (no webdriver/CDP/headless checks).
import { canonicalTimeZone } from '../../apps/production-extension/fingerprint-timezone-data.js';
import { deviceMemoryBuckets } from '../../apps/production-extension/fingerprint-device-presets.js';
import { fingerprintProfileIssues } from '../../apps/production-extension/fingerprint-profiles.js';

export const CONSISTENCY_PRESETS = Object.freeze(['compatibility', 'balanced', 'strict']);
// Eight fixed claims. Regions are northern-hemisphere or DST-free so the fixed standard offset matches most of the year;
// version is an index into browserVersions() (0 = newest).
export const CONSISTENCY_CASES = Object.freeze([
  { seed: 1, deviceType: 'desktop', os: 'windows-11', browser: 'chrome', version: 0, region: 'DE' },
  { seed: 7, deviceType: 'laptop', os: 'windows-10', browser: 'edge', version: 3, region: 'JP' },
  { seed: 42, deviceType: 'desktop', os: 'windows-10', browser: 'chrome', version: 6, region: 'US' },
  { seed: 1337, deviceType: 'laptop', os: 'windows-11', browser: 'chrome', version: 12, region: 'FR' },
  { seed: 65535, deviceType: 'desktop', os: 'windows-11', browser: 'edge', version: 1, region: 'IN' },
  { seed: 2026, deviceType: 'laptop', os: 'windows-11', browser: 'chrome', version: 9, region: 'BR' },
  { seed: 123456789, deviceType: 'desktop', os: 'windows-10', browser: 'edge', version: 15, region: 'PL' },
  { seed: 4294967295, deviceType: 'laptop', os: 'windows-10', browser: 'chrome', version: 20, region: 'KR' },
].map(item => Object.freeze(item)));
// A fixed instant (2026-01-15T12:00:00Z) for Date#toString: the zone offset there is its standard (winter) offset.
export const DATE_PROBE_INSTANT = Date.UTC(2026, 0, 15, 12);

// ---- page code (runs in the browser; self-contained, no references outside the function) ---------------------------
export function realmSnapshot(w) {
  const t = read => { try { const value = read(); return value === undefined ? null : value; } catch (error) { return { error: String(error && error.name || error) }; } };
  const n = w.navigator, s = w.screen;
  return {
    ua: t(() => n.userAgent), appVersion: t(() => n.appVersion), platform: t(() => n.platform), vendor: t(() => n.vendor),
    oscpu: t(() => ('oscpu' in n ? n.oscpu : null)), language: t(() => n.language), languages: t(() => Array.from(n.languages)),
    cores: t(() => n.hardwareConcurrency), memory: t(() => ('deviceMemory' in n ? n.deviceMemory : null)), touch: t(() => n.maxTouchPoints),
    uaData: t(() => n.userAgentData ? { brands: Array.from(n.userAgentData.brands, item => ({ brand: item.brand, version: item.version })), mobile: n.userAgentData.mobile, platform: n.userAgentData.platform } : null),
    intl: t(() => { const options = new w.Intl.DateTimeFormat().resolvedOptions(); return { locale: options.locale, timeZone: options.timeZone, calendar: options.calendar, numberingSystem: options.numberingSystem, number: new w.Intl.NumberFormat().resolvedOptions().locale }; }),
    offset: t(() => new w.Date().getTimezoneOffset()),
    dateString: t(() => String(new w.Date(1768478400000))),
    screen: t(() => ({ width: s.width, height: s.height, availWidth: s.availWidth, availHeight: s.availHeight, colorDepth: s.colorDepth, pixelDepth: s.pixelDepth, orientation: s.orientation ? { type: s.orientation.type, angle: s.orientation.angle } : null })),
    dpr: t(() => w.devicePixelRatio),
    media: t(() => { const match = query => w.matchMedia(query).matches; return { deviceWidth: match('(device-width: ' + s.width + 'px)'), deviceHeight: match('(device-height: ' + s.height + 'px)'), resolution: match('(resolution: ' + w.devicePixelRatio + 'dppx)'), coarse: match('(any-pointer: coarse)') }; }),
    webgl: t(() => {
      const gl = w.document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const value = { vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER), unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null, unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null };
      const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      return value;
    }),
  };
}
export function workerSnapshot() {
  const n = self.navigator, t = read => { try { const value = read(); return value === undefined ? null : value; } catch (error) { return { error: String(error && error.name || error) }; } };
  return { ua: t(() => n.userAgent), platform: t(() => n.platform), language: t(() => n.language), languages: t(() => Array.from(n.languages)), cores: t(() => n.hardwareConcurrency),
    memory: t(() => ('deviceMemory' in n ? n.deviceMemory : null)), timeZone: t(() => Intl.DateTimeFormat().resolvedOptions().timeZone), offset: t(() => new Date().getTimezoneOffset()),
    uaData: t(() => n.userAgentData ? { brands: Array.from(n.userAgentData.brands, item => ({ brand: item.brand, version: item.version })), platform: n.userAgentData.platform } : null) };
}
const script = source => '<script>' + source.replaceAll('</script', '<\\/script') + '</script>';
const CHILD = run => script('const realmSnapshot = ' + realmSnapshot.toString() + ';\n(window.opener || window.parent).postMessage({ channel: "consistency", run: ' + JSON.stringify(run) + ', kind: window.opener ? "popup" : "frame", snapshot: realmSnapshot(window) }, "*");');
export function childHtml(run) { return '<!doctype html><meta charset=utf-8><title>child</title>' + CHILD(run) + '<body>child'; }
export function workerJs() { return 'const workerSnapshot = ' + workerSnapshot.toString() + ';\npostMessage(workerSnapshot());'; }
export function topHtml(run) {
  const body = `
const RUN = ${JSON.stringify(run)};
const realmSnapshot = ${realmSnapshot.toString()};
const result = { run: RUN, top: realmSnapshot(window), realms: {}, high: null, gpu: null, worker: null, errors: [], asyncDone: false, popupState: 'closed' };
window.__consistency = result;
addEventListener('message', event => {
  const data = event.data;
  if (!data || data.channel !== 'consistency' || data.run !== RUN) return;
  if (data.kind === 'popup') { result.realms.popup = data.snapshot; result.popupState = 'loaded'; try { event.source.close(); } catch {} }
  else if (event.source === srcdocFrame?.contentWindow) result.realms.srcdoc = data.snapshot;
  else if (event.source === sameFrame?.contentWindow) result.realms.same = data.snapshot;
});
let srcdocFrame, sameFrame;
const race = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve({ timeout: ms }), ms))]);
const plain = value => JSON.parse(JSON.stringify(value));
addEventListener('DOMContentLoaded', () => {
  const blank = document.createElement('iframe'); document.body.append(blank); result.realms.blank = realmSnapshot(blank.contentWindow);
  srcdocFrame = document.createElement('iframe'); srcdocFrame.srcdoc = ${JSON.stringify(childHtml(run))}; document.body.append(srcdocFrame);
  sameFrame = document.createElement('iframe'); sameFrame.src = '/frame?run=' + RUN; document.body.append(sameFrame);
  document.getElementById('open-popup').addEventListener('click', () => {
    const popup = window.open('/popup?run=' + RUN, 'consistency-' + RUN, 'popup,width=520,height=420');
    if (!popup) { result.popupState = 'blocked'; return; }
    result.popupState = 'opened'; result.realms.popupBlank = realmSnapshot(popup);
  });
}, { once: true });
(async () => {
  const n = navigator;
  try { result.high = n.userAgentData ? plain(await race(n.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'formFactors', 'fullVersionList', 'model', 'platform', 'platformVersion', 'uaFullVersion', 'wow64']), 4000)) : null; } catch (error) { result.errors.push('high:' + error.name); }
  try {
    if (!n.gpu) result.gpu = { absent: true };
    else { const adapter = await race(n.gpu.requestAdapter(), 4000); result.gpu = !adapter ? { adapter: null } : adapter.timeout ? { timeout: true } : { info: adapter.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description } : null }; }
  } catch (error) { result.errors.push('gpu:' + error.name); }
  try { await fetch('/echo?run=' + RUN + '&type=fetch').then(response => response.text()); } catch (error) { result.errors.push('fetch:' + error.name); }
  try {
    result.worker = await race(new Promise((resolve, reject) => { const worker = new Worker('/worker.js?run=' + RUN); worker.onmessage = event => { worker.terminate(); resolve(event.data); }; worker.onerror = () => reject(new Error('worker')); }), 4000);
  } catch (error) { result.errors.push('worker:' + error.message); }
  result.asyncDone = true;
})();`;
  return '<!doctype html><meta charset=utf-8><title>consistency</title>' + script(body) + '<body><button id="open-popup" type="button">Open popup</button>';
}

// ---- expectations ----------------------------------------------------------------------------------------------------
export function customValue(configuration, id) {
  const row = configuration.apis.find(item => item.id === id);
  return row?.mode === 'custom' && row.selected?.kind === 'value' ? row.selected.value : undefined;
}
// Independent re-implementations of the wire formats a Chrome request carries for these page values.
export const wireAcceptLanguage = tags => tags.map((tag, index) => index === 0 ? tag : tag + ';q=0.' + Math.max(1, 10 - index)).join(',');
export const wireBrands = brands => brands.map(item => '"' + item.brand + '";v="' + item.version + '"').join(', ');
const family = text => typeof text !== 'string' ? null : /Windows|Win32|Win64/u.test(text) ? 'windows' : /Mac/u.test(text) ? 'mac' : /Android/u.test(text) ? 'android' : /Linux|X11/u.test(text) ? 'linux' : null;
const gpuFamily = text => typeof text !== 'string' ? null : /nvidia/iu.test(text) ? 'nvidia' : /\bamd\b|\bati\b|radeon/iu.test(text) ? 'amd' : /intel/iu.test(text) ? 'intel' : /apple/iu.test(text) ? 'apple' : null;
const uaMajor = ua => Number(/(?:Chrome|Chromium)\/(\d+)/u.exec(ua ?? '')?.[1]) || null;
// Key order is not a value: stored profile objects and page objects may list the same keys differently.
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const canonicalLocale = tag => { try { return Intl.getCanonicalLocales(tag)[0]; } catch { return tag; } };
// Offset in minutes behind UTC (the getTimezoneOffset sign) of `zone` at `instant`, from this Node's ICU.
export function zoneOffsetAt(zone, instant) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(new Date(instant));
  const text = parts.find(part => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):?(\d{2})?/u.exec(text);
  return match ? -(match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0)) : 0;
}
const stringOffset = text => { const match = /GMT([+-])(\d{2})(\d{2})/u.exec(text ?? ''); return match ? -(match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : null; };
const FIELDS = { 'navigator-user-agent': 'ua', 'navigator-platform': 'platform', 'navigator-app-version': 'appVersion', 'navigator-language': 'language', 'navigator-languages': 'languages',
  'hardware-concurrency': 'cores', 'device-memory': 'memory', 'touch-points': 'touch', 'window-device-pixel-ratio': 'dpr' };
const SCREEN = { 'screen-width': 'width', 'screen-height': 'height', 'screen-avail-width': 'availWidth', 'screen-avail-height': 'availHeight', 'screen-color-depth': 'colorDepth', 'screen-pixel-depth': 'pixelDepth' };
const RELEVANT = ['main_frame', 'sub_frame', 'fetch', 'popup'];
const errorsIn = snapshot => Object.entries(snapshot ?? {}).filter(([, value]) => value && typeof value === 'object' && typeof value.error === 'string').map(([key, value]) => key + ':' + value.error);

// Every finding of one applied configuration: [{ check, detail }] for failures, plus `notes` for date-dependent facts.
// `run` = { browser, configuration, environment, result, headers: [{ type, scheme, headers }], nativeWorker, now, issues? }
// (`issues` replaces fingerprintProfileIssues(configuration, environment) when a caller already has them).
export function consistencyFindings(run) {
  const failures = [], notes = [], fail = (check, detail) => failures.push({ check, detail });
  const { configuration, result } = run, top = result?.top ?? {}, realms = result?.realms ?? {};
  if (!result?.top) return { failures: [{ check: 'probe', detail: 'no top snapshot' }], notes };
  for (const [name, snapshot] of [['top', top], ...Object.entries(realms)]) { const errors = errorsIn(snapshot); if (errors.length) fail('realm-errors', name + ': ' + errors.join(', ')); }
  if (result.errors?.length) fail('realm-errors', 'async: ' + result.errors.join(', '));
  // Applied values: every Custom row of the profile is what the top document reads.
  for (const [id, field] of Object.entries(FIELDS)) { const value = customValue(configuration, id); if (value !== undefined && !same(top[field], value)) fail('apply:' + id, 'page ' + JSON.stringify(top[field]) + ' vs ' + JSON.stringify(value)); }
  for (const [id, field] of Object.entries(SCREEN)) { const value = customValue(configuration, id); if (value !== undefined && top.screen?.[field] !== value) fail('apply:' + id, 'page ' + top.screen?.[field] + ' vs ' + value); }
  const orientation = customValue(configuration, 'screen-orientation'); if (orientation && !same(top.screen?.orientation, orientation)) fail('apply:screen-orientation', 'page ' + JSON.stringify(top.screen?.orientation));
  const gl = customValue(configuration, 'webgl'); if (gl && top.webgl && ['vendor', 'renderer', 'unmaskedVendor', 'unmaskedRenderer'].some(key => top.webgl[key] !== gl[key])) fail('apply:webgl', JSON.stringify(top.webgl) + ' vs ' + JSON.stringify(gl));
  const zoneRow = customValue(configuration, 'timezone'), intlRow = customValue(configuration, 'intl-formatting');
  const zone = zoneRow?.timeZone ?? intlRow?.timeZone;
  if (zone && canonicalTimeZone(top.intl?.timeZone) !== canonicalTimeZone(zone)) fail('apply-intl', 'Intl timeZone ' + top.intl?.timeZone + ' vs ' + zone);
  if (intlRow?.locale && canonicalLocale(top.intl?.locale) !== canonicalLocale(intlRow.locale)) fail('apply-intl', 'Intl locale ' + top.intl?.locale + ' vs ' + intlRow.locale);
  // Identity: one operating system and one browser build everywhere.
  const systems = [family(top.ua), family(top.platform), top.uaData ? family(top.uaData.platform) : family(top.ua)];
  if (new Set(systems).size !== 1 || systems[0] === null) fail('ua-platform', 'UA/platform/uaData.platform families ' + JSON.stringify(systems));
  if (typeof top.ua === 'string' && top.appVersion !== top.ua.replace(/^Mozilla\//u, '')) fail('ua-platform', 'appVersion is not the UA without "Mozilla/"');
  const major = uaMajor(top.ua), edge = /\bEdg\//u.test(top.ua ?? '');
  if (major && (top.vendor !== 'Google Inc.' || top.oscpu !== null)) fail('ua-vendor', 'Chromium UA with vendor ' + JSON.stringify(top.vendor) + ' and oscpu ' + JSON.stringify(top.oscpu));
  if (major && !top.uaData) fail('ua-data-missing', 'Chromium ' + major + ' UA without navigator.userAgentData');
  if (major && top.uaData) {
    const brands = top.uaData.brands, product = edge ? 'Microsoft Edge' : 'Google Chrome';
    if (!brands.some(item => item.brand === product && Number(item.version) === major) || !brands.some(item => item.brand === 'Chromium' && Number(item.version) === major)) fail('ua-brands', 'UA ' + major + (edge ? ' Edge' : ' Chrome') + ' vs brands ' + JSON.stringify(brands));
    if (top.uaData.mobile !== /\bMobile\b/u.test(top.ua)) fail('ua-brands', 'uaData.mobile disagrees with the UA');
    const high = result.high;
    if (high && !high.timeout) {
      const list = high.fullVersionList ?? [];
      if (!same(list.map(item => item.brand), brands.map(item => item.brand)) || list.some(item => brands.find(brand => brand.brand === item.brand)?.version !== String(item.version).split('.')[0])) fail('ua-brands', 'fullVersionList ' + JSON.stringify(list) + ' vs brands');
      if (uaMajor('Chrome/' + high.uaFullVersion) !== major) fail('ua-brands', 'uaFullVersion ' + high.uaFullVersion + ' vs UA major ' + major);
      if (high.platform !== top.uaData.platform) fail('ua-brands', 'high-entropy platform ' + high.platform + ' vs ' + top.uaData.platform);
    }
  }
  // Language: navigator, Intl and the Accept-Language a server receives.
  if (top.languages?.[0] !== top.language) fail('language', 'language ' + top.language + ' vs languages[0] ' + top.languages?.[0]);
  if (canonicalLocale(top.intl?.locale) !== canonicalLocale(top.language) || canonicalLocale(top.intl?.number) !== canonicalLocale(top.language)) fail('language-intl', 'navigator ' + top.language + ' vs Intl ' + top.intl?.locale + '/' + top.intl?.number);
  const relevant = (run.headers ?? []).filter(row => RELEVANT.includes(row.type));
  if (!relevant.length) fail('headers', 'the server saw no page/frame/fetch/popup request');
  for (const row of relevant) {
    if (Array.isArray(top.languages) && row.headers['accept-language'] !== wireAcceptLanguage(top.languages)) fail('header-accept-language', row.type + ': ' + row.headers['accept-language'] + ' vs ' + wireAcceptLanguage(top.languages));
    if (row.headers['user-agent'] !== top.ua) fail('header-user-agent', row.type + ': server and page User-Agent differ');
    if (row.scheme === 'https' && top.uaData) {
      if (row.headers['sec-ch-ua'] !== wireBrands(top.uaData.brands)) fail('header-client-hints', row.type + ': sec-ch-ua ' + row.headers['sec-ch-ua'] + ' vs ' + wireBrands(top.uaData.brands));
      if (row.headers['sec-ch-ua-platform'] !== '"' + top.uaData.platform + '"' || row.headers['sec-ch-ua-mobile'] !== (top.uaData.mobile ? '?1' : '?0')) fail('header-client-hints', row.type + ': platform/mobile hint ' + row.headers['sec-ch-ua-platform'] + ' ' + row.headers['sec-ch-ua-mobile']);
    }
  }
  // Time zone: Intl zone, Date offset and Date#toString offset tell one story.
  const pageZone = top.intl?.timeZone;
  if (typeof pageZone === 'string') {
    const now = zoneOffsetAt(pageZone, run.now ?? Date.now()), winter = zoneOffsetAt(pageZone, DATE_PROBE_INSTANT);
    // getTimezoneOffset grows westwards, so the standard (non-DST) offset is the larger of January and July.
    const standard = Math.max(winter, zoneOffsetAt(pageZone, Date.UTC(2026, 6, 15, 12)));
    if (top.offset !== now) {
      // The timezone row is a FIXED offset by contract; during daylight saving time it differs from the zone. Date-dependent, so a note.
      if (zoneRow && top.offset === zoneRow.offsetMinutes && top.offset === standard && now !== standard) notes.push('daylight saving time: ' + pageZone + ' is at ' + now + ' today, the profile reports its fixed standard offset ' + top.offset);
      else fail('timezone-offset', 'Intl ' + pageZone + ' is at ' + now + ', Date#getTimezoneOffset ' + top.offset);
    }
    if (stringOffset(top.dateString) !== winter) fail('date-string', 'Date#toString ' + /GMT[+-]\d{4}/u.exec(top.dateString ?? '')?.[0] + ' vs ' + pageZone + ' (' + winter + ')');
  }
  // Screen: sizes, avail, depth, orientation, CSS media and DPR.
  const screen = top.screen ?? {};
  if (!(screen.availWidth <= screen.width && screen.availHeight <= screen.height)) fail('screen-shape', 'avail ' + screen.availWidth + 'x' + screen.availHeight + ' outside ' + screen.width + 'x' + screen.height);
  if (screen.colorDepth !== screen.pixelDepth) fail('screen-shape', 'colorDepth ' + screen.colorDepth + ' vs pixelDepth ' + screen.pixelDepth);
  if (screen.orientation && screen.orientation.type.startsWith('landscape') !== screen.width >= screen.height) fail('screen-shape', 'orientation ' + screen.orientation.type + ' vs ' + screen.width + 'x' + screen.height);
  if (top.media && !(top.media.deviceWidth && top.media.deviceHeight)) fail('screen-media', 'matchMedia(device-width/height) does not match ' + screen.width + 'x' + screen.height);
  if (top.media && !top.media.resolution) fail('screen-dpr-media', 'matchMedia(resolution: ' + top.dpr + 'dppx) is false');
  if (top.media && top.touch > 0 !== top.media.coarse) fail('touch', 'maxTouchPoints ' + top.touch + ' vs any-pointer:coarse ' + top.media.coarse);
  // Graphics: the WebGL vendor family is the WebGPU adapter's.
  const glVendor = gpuFamily(top.webgl?.unmaskedVendor) ?? gpuFamily(top.webgl?.unmaskedRenderer), adapterVendor = gpuFamily(result.gpu?.info?.vendor);
  if (glVendor && adapterVendor && glVendor !== adapterVendor) fail('gpu-family', 'WebGL ' + glVendor + ' vs WebGPU adapter ' + adapterVendor);
  // Every realm the page can reach reads the same values as the top document.
  for (const name of ['blank', 'srcdoc', 'same', 'popupBlank', 'popup']) {
    const snapshot = realms[name];
    if (!snapshot) { fail('realms', name + ': no snapshot'); continue; }
    const differs = Object.keys(top).filter(key => !same(top[key], snapshot[key]));
    if (differs.length) fail('realms', name + ': ' + differs.join(', ') + ' differ from the top document');
  }
  // Workers are outside the Custom scope (ADR-101): they keep the browser's own values.
  if (!result.worker || result.worker.timeout) fail('worker', 'no worker answer');
  else if (run.nativeWorker && !same(result.worker, run.nativeWorker)) fail('worker', 'worker values changed: ' + Object.keys(run.nativeWorker).filter(key => !same(run.nativeWorker[key], result.worker[key])).join(', '));
  if (typeof top.memory === 'number' && major && !deviceMemoryBuckets(major).includes(top.memory)) fail('device-memory', top.memory + ' is not a Chrome ' + major + ' bucket ' + JSON.stringify(deviceMemoryBuckets(major)));
  const warnings = (run.issues ?? fingerprintProfileIssues(configuration, run.environment ?? {})).filter(item => item.severity === 'warning').map(item => item.code);
  if (warnings.length) fail('profile-issues', warnings.join(', '));
  return { failures, notes };
}

// ---- known limits (ratchet) ------------------------------------------------------------------------------------------
// limits: [{ check, browsers: [...], presets?: [...], reason }]. A failure covered by a limit is a known limit; a
// (limit, browser) pair that covered nothing in a complete run is stale and must be removed.
export function applyLimits(findings, limits, { browsers, complete = true }) {
  const unexpected = [], known = [], used = new Set();
  for (const finding of findings) {
    const index = limits.findIndex(limit => limit.check === finding.check && limit.browsers.includes(finding.browser) && (!limit.presets || limit.presets.includes(finding.preset)));
    if (index < 0) unexpected.push(finding); else { known.push({ ...finding, limit: index }); used.add(index + '|' + finding.browser); }
  }
  const stale = complete ? limits.flatMap((limit, index) => limit.browsers.filter(browser => browsers.includes(browser) && !used.has(index + '|' + browser)).map(browser => ({ check: limit.check, browser, presets: limit.presets ?? null }))) : [];
  return { unexpected, known, stale };
}
export function limitsProblems(limits) {
  const problems = [], keys = new Set();
  if (!Array.isArray(limits)) return ['limits must be an array'];
  for (const limit of limits) {
    const key = limit.check + '|' + [...(limit.browsers ?? [])].sort().join(',') + '|' + (limit.presets ?? []).join(',');
    if (typeof limit.check !== 'string' || !Array.isArray(limit.browsers) || !limit.browsers.length || limit.browsers.some(browser => !['chrome', 'firefox'].includes(browser))) problems.push('malformed limit ' + JSON.stringify(limit));
    if (limit.presets !== undefined && (!Array.isArray(limit.presets) || limit.presets.some(preset => !CONSISTENCY_PRESETS.includes(preset)))) problems.push('bad presets in ' + limit.check);
    if (typeof limit.reason !== 'string' || limit.reason.length < 40) problems.push('limit ' + limit.check + ' needs a reason of at least 40 characters');
    if (keys.has(key)) problems.push('duplicate limit ' + key); keys.add(key);
  }
  return problems;
}
