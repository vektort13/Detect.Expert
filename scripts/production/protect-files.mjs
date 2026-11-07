// ADR-047 (S1): the single list of the files the module «Защита» adds to apps/production-extension (port plan §1.2).
// Used by scripts/production/build-protect.mjs (what it generates), by scripts/build-production.mjs from S2 on (which
// files are Chrome-only and which Firefox stubs replace) and by the tests. Names follow 722fae8: the vendored
// registration.ts and requests/open.ts refer to them.

export const PROTECT_VENDOR_DIR = 'vendor/protect-722fae8';
export const PROTECT_ADAPTER_DIR = 'apps/production-protect';
export const PRODUCTION_EXTENSION_DIR = 'apps/production-extension';
export const PROTECT_BUILD_RECORD = 'apps/production-protect/BUILD.json';
export const PROTECT_CATALOG_FILE = 'apps/production-protect/src/locales/catalog.generated.json';

/** PROTECT_MAIN_GROUPS of the vendored contracts (build-protect.mjs verifies the order): bit = 1 << index. */
export const PROTECT_GROUPS = Object.freeze(['send', 'listen']);

/**
 * Bundles. entry: path relative to the project root. world: sw | isolated | main | ui. prelude: MAIN prelude
 * (at most 2048 B). The vendored entrypoints import the vendored packages by relative paths.
 */
export const PROTECT_BUNDLES = Object.freeze([
  { out: 'protect-sw.js', entry: 'apps/production-protect/src/sw-entry.ts', format: 'esm', world: 'sw' },
  { out: 'protect.js', entry: 'vendor/protect-722fae8/apps/extension/entrypoints/protect.ts', format: 'iife', world: 'isolated' },
  { out: 'protect-policy.js', entry: 'vendor/protect-722fae8/apps/extension/entrypoints/protect-policy.ts', format: 'iife', world: 'main', prelude: true },
  ...PROTECT_GROUPS.map((group, i) => ({
    out: 'protect-on.' + group + '.js', entry: 'vendor/protect-722fae8/apps/extension/entrypoints/protect-on.ts', format: 'iife', world: 'main', prelude: true,
    define: { __PROTECT_GROUP_BIT__: String(1 << i) },
  })),
  {
    out: 'protect.main.js', entry: 'vendor/protect-722fae8/apps/extension/entrypoints/protect.main.ts', format: 'iife', world: 'main',
    define: { __EARLY_CAPTURE__: 'true', __PROTECT_GROUP_COUNT__: String(PROTECT_GROUPS.length) },
  },
  { out: 'gpc.main.js', entry: 'vendor/protect-722fae8/apps/extension/entrypoints/gpc.main.ts', format: 'iife', world: 'main', prelude: true },
  { out: 'protect-ui.js', entry: 'apps/production-protect/src/ui-entry.ts', format: 'esm', world: 'ui', catalog: true },
  { out: 'requests.js', entry: 'apps/production-protect/src/requests-entry.ts', format: 'esm', world: 'ui', external: ['./protect-ui.js'] },
  // S4b: the firewall as its own action popup (the service worker sets it per tab, surface.ts).
  { out: 'firewall.js', entry: 'apps/production-protect/src/firewall-entry.ts', format: 'esm', world: 'ui', external: ['./protect-ui.js'] },
  // ADR-052: automatic positive findings in a separate bottom-right extension window.
  { out: 'findings.js', entry: 'apps/production-protect/src/findings-entry.ts', format: 'esm', world: 'ui', external: ['./protect-ui.js'] },
  { out: 'activation-toast.js', entry: 'apps/production-protect/src/activation-toast-entry.ts', format: 'esm', world: 'ui', external: ['./protect-ui.js'] },
  // ADR-058: local Preact/CSS in an exact-document ISOLATED content script, without a page bridge.
  { out: 'firewall-overlay.js', entry: 'apps/production-protect/src/overlay-entry.tsx', format: 'iife', world: 'ui', overlayUi: true },
]);

/** Static files copied byte for byte. */
export const PROTECT_STATIC = Object.freeze([
  { out: 'protect-managed-schema.json', from: 'apps/production-protect/src/protect-managed-schema.json' },
  { out: 'firewall.html', from: 'apps/production-protect/src/firewall.html' },
  { out: 'findings.html', from: 'apps/production-protect/src/findings.html' },
  { out: 'activation-toast.html', from: 'apps/production-protect/src/activation-toast.html' },
  { out: 'requests.html', from: 'apps/production-protect/src/requests.html' },
  { out: 'requests.css', from: 'vendor/protect-722fae8/apps/extension/entrypoints/requests/requests.css' },
]);

/** Generated stylesheet: vendored module styles + inherited ui.css rules + the production layer. */
export const PROTECT_CSS = 'protect.css';

/** Test-only overlay bundles (build-protect --overlay <dir>): never written into apps/production-extension. */
export const PROTECT_OVERLAY_BUNDLES = Object.freeze([
  { out: 'protect-tripwire.isolated.js', entry: 'vendor/protect-722fae8/apps/extension/entrypoints/test-only/protect-tripwire.isolated.ts', format: 'iife', world: 'isolated', testOnly: true },
  { out: 'protect-tripwire.main.js', entry: 'vendor/protect-722fae8/apps/extension/entrypoints/test-only/protect-tripwire.main.ts', format: 'iife', world: 'main', testOnly: true },
]);

/** Every file the module adds to apps/production-extension. */
export const PROTECT_OUTPUTS = Object.freeze([...PROTECT_BUNDLES.map((b) => b.out), ...PROTECT_STATIC.map((s) => s.out), PROTECT_CSS].sort());

/** Firefox (port plan §2.7, wired in S2): these three are replaced by stubs, every other module file is not shipped. */
export const PROTECT_FIREFOX_STUBS = Object.freeze({
  'protect-sw.js': 'apps/production-protect/firefox/protect-sw.js',
  'protect-ui.js': 'apps/production-protect/firefox/protect-ui.js',
  'protect.css': 'apps/production-protect/firefox/protect.css',
});
export const PROTECT_CHROME_ONLY = Object.freeze(PROTECT_OUTPUTS.filter((name) => !Object.hasOwn(PROTECT_FIREFOX_STUBS, name)));

/**
 * Owner decision Q1 (2026-10-18, «Обязательное разрешение»): the Chrome manifest gets
 * declarativeNetRequestWithHostAccess in the required `permissions` (S2 changes manifest.json and
 * validateProductionManifest; ADR-047 edits ADR-020 §7). Firefox gets nothing of the module.
 */
export const PROTECT_CHROME_REQUIRED_PERMISSIONS = Object.freeze(['declarativeNetRequestWithHostAccess']);

/** Observation bundles the module never changes and the module strings they must not contain (ADR-020 §10). */
export const OBSERVATION_BUNDLES = Object.freeze(['hook.early.js', 'hook.main.js', 'bridge.js']);
export const OBSERVATION_FORBIDDEN_STRINGS = Object.freeze(['detect.expert/protect/v1', 'protect-policy', 'globalPrivacyControl']);
