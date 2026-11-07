import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { patchRtcReviewMatcher, patchRtcOccurrenceIdentity, patchRtcReviewUi } from './rtc-review-plan.mjs';
const root = resolve(import.meta.dirname, '../../apps/production-extension'), check = process.argv.includes('--check');
for (const name of ['background.js', 'popup.js', 'sidepanel.js', 'report.js']) {
  const file = resolve(root, name), before = readFileSync(file, 'utf8'); let source = before;
  if (name === 'background.js') source = patchRtcOccurrenceIdentity(patchRtcReviewMatcher(source));
  else {
    source = patchRtcReviewUi(source);
    const mechanisms = ['device-sensor', 'webtransport', 'webauthn', 'clipboard', 'worker', 'storage'];
    if (!source.includes('"device-sensor": "api_mechanism_device_sensor"')) {
      const titles = 'TITLES = {\n', icons = '}, ICONS = {\n';
      if (!source.includes(titles) || !source.includes(icons)) throw Error(name + ': API groups boundary');
      source = source.replace(titles, titles + mechanisms.map(key => '  ' + JSON.stringify(key) + ': ' + JSON.stringify('api_mechanism_' + key.replaceAll('-', '_')) + ',\n').join(''));
      const iconNames = ['interaction', 'network', 'permissions', 'permissions', 'wasm', 'storage'];
      source = source.replace(icons, icons + mechanisms.map((key, i) => '  ' + JSON.stringify(key) + ': ' + JSON.stringify(iconNames[i]) + ',\n').join(''));
    }
    const note = '/* @__PURE__ */ u3("p", { class: "small muted", children: t3((results !== void 0 && PREVIEW_MECHANISMS.includes(mechanism)';
    if (!source.includes('["device-sensor","webtransport","webauthn","clipboard","worker","storage"].includes(mechanism) ? null :')) {
      if (!source.includes(note)) throw Error(name + ': API note boundary');
      source = source.replace(note, JSON.stringify(mechanisms) + '.includes(mechanism) ? null : ' + note);
    }
    if (!source.includes('CookieWritersTable, ProCookieSnapshot')) source = source.replaceAll('ProCookieSnapshot, ProSocialSnapshot', 'CookieWritersTable, ProCookieSnapshot, ProSocialSnapshot');
    const snapshot = '      u3(ProCookieSnapshot, { snapshot: page.cookies }),';
    if (!source.includes('u3(CookieWritersTable, { documents: page.cookieWriters })')) {
      if (!source.includes(snapshot)) throw Error(name + ': Pro cookies boundary');
      source = source.replaceAll(snapshot, snapshot + '\n      u3(CookieWritersTable, { documents: page.cookieWriters }),');
    }
    if (name !== 'report.js') {
      if (!source.includes('useCookieWriters, useCookies')) source = source.replace('IdentificationNavigation, useCookies,', 'IdentificationNavigation, useCookieWriters, useCookies,');
      const anchor = 'useCookies(session, mode.mode === "light" && identificationPanel === "cookie")';
      if (!source.includes('cookieWriters = useCookieWriters(')) {
        if (!source.includes(anchor)) throw Error(name + ': live cookies boundary');
        source = source.replace(anchor, anchor + ', cookieWriters = useCookieWriters(session, mode.mode === "light" && identificationPanel === "cookie")');
      }
      if (!source.includes('u3(CookiePanel, { writers: cookieWriters,')) source = source.replace('u3(CookiePanel, { cookies:', 'u3(CookiePanel, { writers: cookieWriters, cookies:');
    }
  }
  if (check && source !== before) throw Error(name + ': review UI sync required');
  if (!check && source !== before) writeFileSync(file, source);
}
console.log((check ? 'checked' : 'synchronized') + ' review UI');
