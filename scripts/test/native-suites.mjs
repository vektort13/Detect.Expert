// Registry of every native test (scripts/test/*-native.mjs) and of the package checks that read their evidence.
// scripts/test/native-suites.test.mjs fails when a native file is missing here, listed twice or listed but absent.
// scripts/run-natives.mjs runs the entries one at a time (natives are heavy) and writes
// test-results/production-<manifest version>/natives-summary.{json,md}.
//
// Fields
//   file   file name inside scripts/test/
//   run    { chrome?: [...args], firefox?: [...args] }: the supported browsers and the exact arguments that select them.
//          `chrome` is the Playwright-bundled Chromium unless the args say otherwise.
//   group  one of NATIVE_GROUPS
//   gate   release  part of a release gate: `pnpm release:verify` (its four natives, unchanged) or
//                   `pnpm release:verify:full` (= release:verify + every non-manual entry of the `antidetect` group)
//          suite    self-contained (owned loopback fixtures, disposable profiles); run by `pnpm test:natives`
//          manual   never started by the runner unless named with --only; `reason` says what it needs
//   reason required for manual entries
//   timeoutMinutes optional, default 20
//
// Package checks (`kind: 'package'`) run once per group after its natives, only when all of them passed.
export const NATIVE_GROUPS = Object.freeze(['antidetect', 'api-guard', 'protect', 'management', 'detector', 'precursor', 'tools', 'proxy']);
export const NATIVE_GATES = Object.freeze(['release', 'suite', 'manual']);
export const NATIVE_BROWSERS = Object.freeze(['chrome', 'firefox']);
// The group `pnpm release:verify:full` adds to `pnpm release:verify`.
export const FULL_RELEASE_GROUP = 'antidetect';

const both = Object.freeze({ chrome: [], firefox: ['--firefox'] });
const bothOption = Object.freeze({ chrome: ['--browser', 'chrome'], firefox: ['--browser', 'firefox'] });
const chromeOnly = Object.freeze({ chrome: [] });
const firefoxOnly = Object.freeze({ firefox: [] });
const entry = (file, run, group, gate, extra = {}) => Object.freeze({ file, run, group, gate, ...extra });

export const NATIVE_SUITES = Object.freeze([
  // ---- Antidetect / Custom values (ADR-048/049/064-066/085-087/100/101/104-107) --------------------------------------
  entry('antidetect-consistency-native.mjs', both, 'antidetect', 'release'),
  entry('antidetect-flow-native.mjs', chromeOnly, 'antidetect', 'release', { note: 'Chrome first-run journey with the per-extension user-scripts switch OFF; Firefox has no such switch' }),
  entry('antidetect-headers-native.mjs', { chrome: ['--dist'] }, 'antidetect', 'release', { note: 'ADR-105 headers are Chrome-only; --dist tests the packaged build instead of a source assembly' }),
  entry('antidetect-protocol-native.mjs', chromeOnly, 'antidetect', 'release', { note: 'Chrome DNR protocol blocks; Firefox has no DNR delivery for them' }),
  entry('antidetect-slider-native.mjs', both, 'antidetect', 'release'),
  entry('antidetect-ui-native.mjs', both, 'antidetect', 'release'),
  entry('antidetect-webrtc-native.mjs', { chrome: ['--chromium'], firefox: ['--firefox'] }, 'antidetect', 'release', { note: 'without --chromium the file uses the installed branded Chrome' }),
  entry('api-config-recovery-native.mjs', chromeOnly, 'antidetect', 'release'),
  entry('api-configuration-native.mjs', chromeOnly, 'antidetect', 'release'),
  entry('api-custom-cold-firefox-native.mjs', firefoxOnly, 'antidetect', 'manual', { reason: 'needs an existing Firefox Nightly/unbranded build that accepts unsigned persistent add-ons (ADR-049 cold start)' }),
  entry('api-custom-early-firefox-native.mjs', firefoxOnly, 'antidetect', 'release'),
  entry('api-custom-early-native.mjs', chromeOnly, 'antidetect', 'release'),
  entry('api-custom-media-extension-native.mjs', both, 'antidetect', 'release', { note: 'round 5: Custom media codecs only lower the browser answer, through the extension assembled from source (no build needed); the shapes suite checks the same pieces in a bare page' }),
  entry('api-custom-mode-transitions-native.mjs', chromeOnly, 'antidetect', 'release'),
  entry('api-custom-native-shapes-native.mjs', both, 'antidetect', 'release', { note: 'ADR-107 shapes; --chrome would switch to the installed branded Chrome, --headed reads the real Windows voices' }),
  entry('api-custom-storage-surfaces-native.mjs', both, 'antidetect', 'release', { note: '--chrome would switch to the installed branded Chrome' }),
  entry('api-custom-webrtc-native.mjs', chromeOnly, 'antidetect', 'release'),
  entry('canvas-frames-native.mjs', chromeOnly, 'antidetect', 'release', { note: 'ADR-066/049: the same non-flat Canvas/WebGL drawing read in 29 kinds of realm (srcdoc, navigated, cross-origin, sandboxed, nested, blob/data, popups, shadow roots) must project like the top page; balanced, strict and scope site; staged from source (no build); Chrome only (popups, alt.test host mapping); gate release because registryProblems refuses a suite gate inside the antidetect group' }),
  entry('canvas-readback-native.mjs', both, 'antidetect', 'release', { note: '--chrome would switch to the installed branded Chrome' }),
  entry('canvas-sparse-native.mjs', both, 'antidetect', 'release'),
  entry('canvas-sparse-v2-native.mjs', both, 'antidetect', 'release', { note: 'ADR-112: sparse-rgb-v2 (parity, saturated channels, flat canvases, PNG round trip, WebGL export and readPixels) against the independent oracle; no extension package, the production installer is injected into owned pages' }),
  entry('canvas-translucent-native.mjs', both, 'antidetect', 'release', { note: 'measures the engine premultiply/unpremultiply arithmetic and checks the translucent-pixel rule of the Canvas projection; --chrome selects the installed branded Chrome, --installed-firefox measures the installed Firefox (no installed rule there)' }),
  entry('canvas-fingerprint-corpus-native.mjs', both, 'antidetect', 'release', { note: 'no extension package; the production installer is injected into owned pages' }),
  entry('custom-value-composition-native.mjs', bothOption, 'antidetect', 'release'),
  entry('fingerprint-identity-native.mjs', both, 'antidetect', 'release', { note: 'ADR-107 round 5: tags and notes, trash, temporary profiles (a real browser restart in Chromium only), profile-to-proxy link; both accept --from-source' }),
  entry('fingerprint-profiles-native.mjs', both, 'antidetect', 'release'),
  entry('font-shield-native.mjs', both, 'antidetect', 'release', { note: 'ADR-110 HTML/CSS font shield of the Fonts option, staged from source (no build): width-difference font enumeration through DOM, SVG, Canvas and OffscreenCanvas, FontFace local(), document.fonts in the top page, about:blank, srcdoc, cross-origin and shadow-root contexts; OFF equals a browser without the extension; --chrome selects the installed Chrome' }),
  entry('geolocation-custom-native.mjs', both, 'antidetect', 'release'),
  entry('math-transcendentals-native.mjs', both, 'antidetect', 'release'),
  entry('media-codec-fields-native.mjs', both, 'antidetect', 'release', { note: 'round 5: the Custom media codec controls in a real DOM (production ValueModal + stylesheet bundled in memory): keyboard path, sync with the JSON view, 21 languages without clipping; no extension needed' }),
  entry('sensor-quiet-native.mjs', both, 'antidetect', 'release', { note: 'ADR-113: the opt-in setting that keeps the observation sensors out of pages while Antidetect is on; the extension is assembled from source (no build needed); measures the page-visible traces (marker, function text, extension frames) with the setting off and on, the Detector reading paused (Chrome) and the master/scope transitions' }),
  entry('surfaces-readback-native.mjs', both, 'antidetect', 'release', { note: 'ADR-107 WebGL readPixels / Web Audio / TextMetrics; no extension package' }),
  entry('webrtc-custom-input-native.mjs', both, 'antidetect', 'release'),
  entry('webrtc-mdns-native.mjs', chromeOnly, 'antidetect', 'release'),
  entry('webrtc-mdns-ui-native.mjs', chromeOnly, 'antidetect', 'release'),
  entry('webrtc-native.mjs', chromeOnly, 'antidetect', 'release'),
  entry('webrtc-policy-native.mjs', both, 'antidetect', 'release', { note: 'Firefox-only proxy_only through ui-api-config-set; assembled from source (no build); the Chrome half proves the browser rejects the value and the controller refuses it' }),
  entry('webrtc-ui-native.mjs', chromeOnly, 'antidetect', 'release'),
  entry('webrtc-ui-firefox-native.mjs', firefoxOnly, 'antidetect', 'release'),
  entry('antidetect-package.mjs', null, 'antidetect', 'release', { kind: 'package', args: [], note: 'reads the evidence of the natives above, dist/<browser> of both browsers and the release ZIPs; needs a --release build' }),

  // ---- API Guard (blocking) ------------------------------------------------------------------------------------------
  entry('api-mode-filters-native.mjs', chromeOnly, 'api-guard', 'suite'),
  entry('api-mode-switches-native.mjs', chromeOnly, 'api-guard', 'suite'),
  entry('api-observed-usage-native.mjs', both, 'api-guard', 'suite'),
  entry('guard-launchers-native.mjs', both, 'api-guard', 'suite'),
  entry('webassembly-native.mjs', bothOption, 'api-guard', 'suite'),
  entry('webassembly-observer-native.mjs', chromeOnly, 'api-guard', 'suite'),
  entry('webassembly-ui-native.mjs', chromeOnly, 'api-guard', 'suite'),
  entry('webgl-protection-native.mjs', both, 'api-guard', 'suite'),

  // ---- Protect (ADR-020-protect / ADR-047 / ADR-053 / ADR-058) -------------------------------------------------------
  entry('protect-overlay-native.mjs', chromeOnly, 'protect', 'release'),
  entry('protect-privacy-native.mjs', chromeOnly, 'protect', 'release', { note: 'release:verify adds --build; the runner never builds and tests dist/chrome' }),
  entry('protect-ui-native.mjs', chromeOnly, 'protect', 'suite'),
  entry('firewall-launcher-layout-native.mjs', chromeOnly, 'protect', 'suite'),
  entry('firewall-launcher-toggle-native.mjs', chromeOnly, 'protect', 'suite'),
  entry('protect-managed-native.mjs', chromeOnly, 'protect', 'manual', { reason: 'writes and removes Windows managed-storage policy registry keys (scoped to a random test extension ID); run deliberately' }),
  entry('protect-activation-toast-native.mjs', chromeOnly, 'protect', 'manual', { reason: 'ADR-058 compatibility alias that only re-runs protect-overlay-native.mjs' }),
  entry('protect-findings-native.mjs', chromeOnly, 'protect', 'manual', { reason: 'ADR-058 compatibility alias that only re-runs protect-overlay-native.mjs' }),
  entry('protect-firewall-popup-native.mjs', chromeOnly, 'protect', 'manual', { reason: 'ADR-058 compatibility alias that only re-runs protect-overlay-native.mjs' }),

  // ---- Management shell, Browser Debug, settings ---------------------------------------------------------------------
  entry('management-native.mjs', chromeOnly, 'management', 'release'),
  entry('management-firefox-native.mjs', firefoxOnly, 'management', 'suite'),
  entry('ui-tour-native.mjs', both, 'management', 'suite', { note: 'round 5 guided tour of Antidetect driven by real key presses; assembled from source (no build and no locale regeneration needed: the tour copy is the Options-only module ui-tour-labels.js); --dist tests dist/<browser>; UI_TOUR_NATIVE_MUTATION edits that copy for the breakage check; --no-evidence keeps the run out of test-results' }),
  entry('ui-tour-tabs-native.mjs', both, 'management', 'suite', { note: 'ADR-111: the Tour button in the header of every section (2576/1180/520/340 px, RTL, 21 languages, 7 palettes, forced colors; in the Firewall header, Chrome only, the Tab key is pressed for real: title, Tour button, switch) and every tour walked by real key presses; assembled from source; --dist tests dist/<browser>; UI_TOUR_TABS_NATIVE_MUTATION edits the copy for the breakage check; --no-evidence and --no-screens skip the evidence file and the review screenshots (.tmp/ui-tour-header-screens); --quick is a short development run', timeoutMinutes: 60 }),
  entry('browser-debug-native.mjs', bothOption, 'management', 'release', { note: 'release:verify runs the Chrome half only' }),
  entry('browser-debug-settings-native.mjs', both, 'management', 'suite'),
  entry('clear-reset-native.mjs', both, 'management', 'suite'),
  entry('site-systems-native.mjs', both, 'management', 'suite'),
  entry('review-surfaces-native.mjs', chromeOnly, 'management', 'suite'),
  entry('review-surfaces-firefox-native.mjs', firefoxOnly, 'management', 'suite'),

  // ---- Detector / Pro observation ------------------------------------------------------------------------------------
  entry('forter-native.mjs', chromeOnly, 'detector', 'suite'),
  entry('pro-request-values-native.mjs', chromeOnly, 'detector', 'suite'),
  entry('cloudflare-site-native.mjs', chromeOnly, 'detector', 'manual', { reason: 'opens the exact owner-provided public demo site (external network)' }),
  entry('cloudflare-site-firefox-native.mjs', firefoxOnly, 'detector', 'manual', { reason: 'opens the exact owner-provided public demo site (external network)' }),
  entry('cloudflare-turnstile-native.mjs', chromeOnly, 'detector', 'manual', { reason: "loads Cloudflare's public Turnstile SDK with the documented dummy sitekeys (external network)" }),
  entry('cloudflare-turnstile-firefox-native.mjs', firefoxOnly, 'detector', 'manual', { reason: "loads Cloudflare's public Turnstile SDK with the documented dummy sitekeys (external network)" }),
  entry('vendor-redirect-native.mjs', bothOption, 'detector', 'manual', { reason: 'follows the official Turnstile SDK redirect on challenges.cloudflare.com (external network)' }),

  // ---- Cloudflare Precursor (ADR-074/076) ----------------------------------------------------------------------------
  entry('precursor-modes-native.mjs', chromeOnly, 'precursor', 'suite'),
  entry('precursor-settings-firefox-native.mjs', firefoxOnly, 'precursor', 'suite'),
  entry('precursor-timing-native.mjs', firefoxOnly, 'precursor', 'suite'),
  entry('precursor-native.mjs', bothOption, 'precursor', 'manual', { reason: 'navigates the public luma.com site (external network)' }),
  entry('precursor-firefox-capability-native.mjs', firefoxOnly, 'precursor', 'manual', { reason: 'reads public sites (luma.com, blog.cloudflare.com, stackoverflow.com) over the external network' }),

  // ---- Tools: Autosurfer, Cookies --------------------------------------------------------------------------------------
  entry('autosurf-native.mjs', both, 'tools', 'suite'),
  entry('autosurf-sites-native.mjs', both, 'tools', 'suite'),
  entry('cookies-workspace-native.mjs', both, 'tools', 'suite'),
  entry('cookies-editor-native.mjs', both, 'tools', 'suite', { note: 'ADR-069 addendum 2026-11-07: the cookie editor (all attributes, details, identity lock and copy, Unix seconds <-> date/time converter) staged from source with a private cookies grant; Chrome checks DST through a CDP time zone override and real key events, Firefox runs without the DST checks (its TZ is not honoured on Windows)' }),
  entry('cookie-transfer-canonical-native.mjs', { chrome: ['--chrome'], firefox: ['--firefox'] }, 'tools', 'suite'),

  // ---- Proxy (ADR-070/071) -------------------------------------------------------------------------------------------
  entry('proxy-browser-native.mjs', both, 'proxy', 'suite', { note: 'needs the companion build (pnpm build:proxy) first' }),
  entry('proxy-permission-native.mjs', { chrome: ['--normal-install', '--deny-first', '--recover-native'], firefox: ['--firefox'] }, 'proxy', 'suite', { note: 'ADR-070 E22-27: a live Chrome never gains connectNative after the first optional nativeMessaging grant, so Chrome runs the real Cancel, Allow, explicit restart, Save journey on a normal unpacked install (UI Automation presses the real prompt buttons); Firefox saves straight after the grant and its helper disables the prompt UI' }),
  entry('proxy-https-native.mjs', both, 'proxy', 'suite', { note: 'owned HTTPS-scheme proxy with a throw-away self-signed certificate made by Windows PowerShell; no companion needed' }),
  entry('proxy-ui-native.mjs', both, 'proxy', 'suite'),
  entry('proxy-ui-visual-native.mjs', both, 'proxy', 'suite', { note: 'ADR-103 round 5: screenshots in test-results/production-2.0.0/proxy-ui, layout tiers, touch targets, AA contrast in every theme, keyboard-only flow, motion, forced colors, 100 profiles, 21 languages; Firefox runs the subset a WebDriver session can drive; accepts --extension <dir> or --from-source' }),
  entry('proxy-geo-settings-native.mjs', both, 'proxy', 'suite', { note: 'ADR-109 settings page, staged from source; Chrome answers the provider hosts with canned replies, Firefox only counts requests' }),
  entry('proxy-geo-manager-native.mjs', both, 'proxy', 'suite', { note: 'ADR-109 manager integration, staged from source; Chrome answers the provider hosts with canned replies, Firefox runs without a ready provider so nothing can be sent' }),
  entry('proxy-provider-native.mjs', chromeOnly, 'proxy', 'manual', { reason: 'needs a real provider test input on stdin from the owner' }),
]);

export const NATIVE_FILES = Object.freeze(NATIVE_SUITES.filter(item => item.kind !== 'package').map(item => item.file));
export const PACKAGE_CHECKS = Object.freeze(NATIVE_SUITES.filter(item => item.kind === 'package'));
export const browsersOf = item => item.run ? NATIVE_BROWSERS.filter(browser => Object.hasOwn(item.run, browser)) : [];

// Everything that makes the registry disagree with the disk or with the release scripts; [] when consistent.
// `files` are the names in scripts/test/, `scripts` the package.json scripts object.
export function registryProblems(files, registry = NATIVE_SUITES, scripts = {}) {
  const problems = [], natives = files.filter(file => /-native\.mjs$/u.test(file)), seen = new Map();
  for (const item of registry) seen.set(item.file, (seen.get(item.file) ?? 0) + 1);
  for (const [file, count] of seen) if (count > 1) problems.push('listed ' + count + ' times: ' + file);
  for (const file of natives) if (!seen.has(file)) problems.push('not listed: ' + file);
  for (const item of registry) {
    const where = item.file + ': ';
    if (!files.includes(item.file)) problems.push(where + 'listed but missing in scripts/test');
    if (!NATIVE_GROUPS.includes(item.group)) problems.push(where + 'unknown group ' + item.group);
    if (!NATIVE_GATES.includes(item.gate)) problems.push(where + 'unknown gate ' + item.gate);
    if (item.gate === 'manual' ? !(typeof item.reason === 'string' && item.reason.length >= 20) : item.reason !== undefined) problems.push(where + (item.gate === 'manual' ? 'manual entries need a reason' : 'only manual entries carry a reason'));
    const argumentLists = item.kind === 'package' ? [item.args] : Object.values(item.run ?? {});
    if (item.kind === 'package') {
      if (item.run !== null || !Array.isArray(item.args) || /-native\.mjs$/u.test(item.file)) problems.push(where + 'package checks have args, no run, and are not *-native.mjs files');
    } else {
      if (!/-native\.mjs$/u.test(item.file)) problems.push(where + 'only *-native.mjs files are natives');
      const keys = Object.keys(item.run ?? {});
      if (!keys.length || keys.some(key => !NATIVE_BROWSERS.includes(key))) problems.push(where + 'run must name chrome and/or firefox');
    }
    for (const args of argumentLists) {
      if (!Array.isArray(args) || args.some(argument => typeof argument !== 'string')) problems.push(where + 'arguments must be string arrays');
      else if (args.some(argument => ['--build', '--release'].includes(argument))) problems.push(where + 'the runner never builds (no --build/--release)');
    }
  }
  const references = script => [...String(script ?? '').matchAll(/scripts\/test\/([a-z0-9-]+-native\.mjs)/gu)].map(match => match[1]);
  for (const file of references(scripts['release:verify'])) if (registry.find(item => item.file === file)?.gate !== 'release') problems.push('release:verify runs ' + file + ' but its gate is not release');
  for (const item of registry) if (item.gate === 'release' && item.group !== FULL_RELEASE_GROUP && !references(scripts['release:verify']).includes(item.file)) problems.push(item.file + ': gate release outside the ' + FULL_RELEASE_GROUP + ' group, but release:verify does not run it');
  for (const item of registry) if (item.group === FULL_RELEASE_GROUP && item.gate === 'suite') problems.push(item.file + ': the ' + FULL_RELEASE_GROUP + ' group is the full release gate; use release or manual');
  for (const [name, script] of Object.entries(scripts)) for (const file of references(script)) if (!seen.has(file)) problems.push('package.json ' + name + ' runs unregistered ' + file);
  return problems;
}
