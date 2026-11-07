// ADR-030/031/032: reproducible integration with the readable shared UI bundles.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const dependency = 'import { createAdvancedUi } from "./advanced-ui.js";\n';
const factory = 'var { useBeacons, useBackgroundActivity, useCookieProbe, BeaconPanel, BackgroundPanel, CookieProbePanel, ProAdvancedSnapshot } = createAdvancedUi({ h: u3, useState: d2, useEffect: h2, useRef: A2, useLocale, browserApi: chrome, translate: (key, substitutions) => t3(key, substitutions) });\n';
for (const name of ['popup.js', 'sidepanel.js', 'report.js']) {
  const file = resolve(root, 'apps/production-extension', name), before = readFileSync(file, 'utf8'); let source = before;
  if (source.startsWith(dependency)) source = source.slice(dependency.length);
  if (!source.includes(dependency)) {
    const marker = '// packages/ui/src/view-models/message.ts\n';
    if (!source.includes(marker)) throw Error(name + ': UI dependency boundary');
    source = source.replace(marker, marker + dependency);
  }
  if (!source.includes(factory)) {
    const marker = name === 'report.js' ? 'var { ProCookieSnapshot, ProSocialSnapshot, ProTagManagerSection, ProThirdPartySnapshot }' : 'var { IdentificationNavigation, useCookies,';
    if (!source.includes(marker)) throw new Error(name + ': identification factory missing');
    source = source.replace(marker, factory + marker);
  }
  if (name !== 'report.js') {
    const marker = 'let identificationPrefix = prefix + "-identification", cookies =';
    if (!source.includes('beacons = useBeacons(session,')) {
      if (!source.includes(marker)) throw new Error(name + ': inspector boundary missing');
      source = source.replace(marker, 'let beacons = useBeacons(session, mode.mode === "light"), backgroundActivity = useBackgroundActivity(session, mode.mode === "light" && identificationPanel === "background"), cookieProbe = useCookieProbe(session, mode.mode === "light" && identificationPanel === "cookie");\n  ' + marker);
    }
    source = source.replace('thirdPartyState: thirdParty.state }', 'thirdPartyState: thirdParty.state, beaconState: beacons.state, backgroundState: backgroundActivity.state }');
    const cookiePanel = 'children: u3(CookiePanel, { cookies: { ...cookies, busy: cookies.busy || cookieProbe.pending || ["preparing", "watching"].includes(cookieProbe.state?.status) }, probeControl: u3(CookieProbePanel, { probe: cookieProbe, cookies }) })';
    source = source.replace('children: u3(CookiePanel, { cookies })', cookiePanel);
    source = source.replace('children: [u3(CookieProbePanel, { probe: cookieProbe, cookies }), u3(CookiePanel, { cookies: { ...cookies, busy: cookies.busy || cookieProbe.pending || ["preparing", "watching"].includes(cookieProbe.state?.status) } })]', cookiePanel);
    if (!source.includes('id: panelId(identificationPrefix, "beacons")')) {
      const anchor = '      identificationPanel !== "third-party" ? u3(FramePicker,';
      if (!source.includes(anchor)) throw new Error(name + ': frame picker boundary missing');
      const panels = ['beacons', 'background'].map(panel => '      u3("div", { class: "identification-panel", role: "tabpanel", id: panelId(identificationPrefix, "' + panel + '"), "aria-labelledby": tabId(identificationPrefix, "' + panel + '"), hidden: identificationPanel !== "' + panel + '", children: u3(' + (panel === 'beacons' ? 'BeaconPanel, { beacons }' : 'BackgroundPanel, { backgroundActivity }') + ') }),\n').join('');
      source = source.replace(anchor, panels + anchor);
    }
  }
  if (!source.includes('u3(ProAdvancedSnapshot, { page })')) {
    const marker = '        u3(ProSocialSnapshot, { snapshots: page.socialNetworks }),';
    if (!source.includes(marker)) throw new Error(name + ': Pro report boundary missing');
    source = source.replace(marker, marker + '\n        u3(ProAdvancedSnapshot, { page }),');
  }
  if (process.argv.includes('--check')) { if (source !== before) throw new Error(name + ': advanced UI synchronization required'); }
  else if (source !== before) writeFileSync(file, source);
}
for (const name of ['popup.html', 'sidepanel.html', 'report.html']) {
  const file = resolve(root, 'apps/production-extension', name), before = readFileSync(file, 'utf8');
  const source = before.includes('href="advanced-ui.css"') ? before : before.replace('    <link rel="stylesheet" href="identification-ui.css" />', '    <link rel="stylesheet" href="identification-ui.css" />\n    <link rel="stylesheet" href="advanced-ui.css" />');
  if (process.argv.includes('--check')) { if (source !== before) throw new Error(name + ': advanced CSS synchronization required'); }
  else if (source !== before) writeFileSync(file, source);
}
