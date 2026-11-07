// ADR-017 / ADR-018 / ADR-040: one full package per browser, shared production source.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { updateProductionLocales } from './production-locales.mjs';
import { verifyProductionSource } from './production/preflight.mjs';
import { PROTECT_CHROME_ONLY, PROTECT_CHROME_REQUIRED_PERMISSIONS, PROTECT_FIREFOX_STUBS, PROTECT_OUTPUTS } from './production/protect-files.mjs';
import { BROWSER_DEBUG_CHROME_OPTIONAL, BROWSER_DEBUG_FIREFOX_OPTIONAL } from '../apps/production-extension/browser-debug-shared.js';
import { geoConnectOrigins } from '../apps/production-extension/proxy-geo-shared.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'apps', 'production-extension');
const BROWSERS = ['chrome', 'firefox'];
export const FIREFOX_ID = 'detect.expert@detect.expert';
export const FIREFOX_MINIMUM_VERSION = '128.0';

export function productionManifest(browser, version) {
  if (!BROWSERS.includes(browser)) throw new Error('unknown browser ' + browser);
  if (!/^\d+(\.\d+){1,3}$/.test(version)) throw new Error('invalid version');
  const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));
  manifest.version = version;
  // ADR-049: Chrome grants the native early registration API at install time;
  // Firefox requires its separate, optional-only runtime permission.
  if (browser === 'chrome' && !manifest.permissions.includes('userScripts')) manifest.permissions.push('userScripts');
  if (browser === 'firefox') {
    delete manifest.minimum_chrome_version;
    delete manifest.side_panel;
    delete manifest.storage;
    // ADR-047: the module «Защита» is Chrome-only, so Firefox gets none of its permissions.
    manifest.permissions = manifest.permissions.filter((permission) => permission !== 'sidePanel' && permission !== 'debugger' && !PROTECT_CHROME_REQUIRED_PERMISSIONS.includes(permission));
    manifest.permissions = manifest.permissions.filter(permission => permission !== 'userScripts');
    manifest.optional_permissions = [...BROWSER_DEBUG_FIREFOX_OPTIONAL, 'userScripts', 'nativeMessaging', 'clipboardWrite', 'notifications'];
    manifest.background = { scripts: ['background.js'], type: 'module' };
    manifest.sidebar_action = { default_panel: 'sidepanel.html', default_title: '__MSG_actionTitle__', default_icon: manifest.icons };
    manifest.browser_specific_settings = { gecko: {
      id: FIREFOX_ID, strict_min_version: FIREFOX_MINIMUM_VERSION,
      data_collection_permissions: { required: ['none'] },
    } };
  }
  return manifest;
}

export function validateProductionManifest(manifest, browser) {
  if (!BROWSERS.includes(browser)) return ['unknown browser ' + browser];
  const errors = [];
  const expected = ['activeTab', 'scripting', 'storage', 'webRequest', 'webNavigation', 'alarms', 'proxy'];
  // ADR-047 (owner decision Q1, 2026-10-18): Chrome requires declarativeNetRequestWithHostAccess for the module «Защита».
  // ADR-075: the user selected real pointer input for the built-in Autosurfer.
  if (browser === 'chrome') expected.push('sidePanel', 'userScripts', 'debugger', ...PROTECT_CHROME_REQUIRED_PERMISSIONS);
  if (browser === 'chrome' && manifest.minimum_chrome_version !== '153') errors.push('Production Chrome baseline must be 153');
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (!same(manifest.permissions, expected)) errors.push('unexpected permissions');
  if (!same(manifest.host_permissions, ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'])) errors.push('unexpected host permissions');
  if (manifest.optional_host_permissions.length !== 0) errors.push('unexpected optional permissions');
  if (!same(manifest.optional_permissions ?? [], browser === 'firefox' ? [...BROWSER_DEBUG_FIREFOX_OPTIONAL, 'userScripts', 'nativeMessaging', 'clipboardWrite', 'notifications'] : [...BROWSER_DEBUG_CHROME_OPTIONAL, 'nativeMessaging', 'clipboardWrite', 'notifications'])) errors.push('unexpected optional API permissions');
  // Only the host-access DNR variant (no install warning of its own); never the broad blocking or feedback variants.
  for (const permission of ['declarativeNetRequest', 'declarativeNetRequestFeedback']) if ((manifest.permissions ?? []).includes(permission) || (manifest.optional_permissions ?? []).includes(permission)) errors.push('forbidden permission ' + permission);
  if (manifest.declarative_net_request !== undefined) errors.push('unexpected declarative_net_request rulesets');
  if (browser === 'chrome' ? JSON.stringify(manifest.storage) !== JSON.stringify({ managed_schema: 'protect-managed-schema.json' }) : manifest.storage !== undefined) errors.push('unexpected managed storage schema');
  // ADR-076 (Cloudflare API) + ADR-109 (the four geolocation providers, hosts from the single catalogue): the only hosts extension pages may reach.
  if (manifest.content_security_policy.extension_pages !== "script-src 'self'; object-src 'none'; connect-src " + ['https://api.cloudflare.com', ...geoConnectOrigins()].join(' ') + "; base-uri 'none'; frame-ancestors 'none'") errors.push('unexpected CSP');
  if (manifest.manifest_version !== 3 || manifest.incognito !== 'not_allowed') errors.push('unexpected manifest policy');
  if (browser === 'chrome' && (manifest.background.service_worker !== 'background.js' || manifest.background.scripts)) errors.push('Chrome background must be service worker');
  if (browser === 'firefox' && (manifest.background.service_worker || manifest.background.scripts?.join(',') !== 'background.js' || manifest.permissions.includes('sidePanel') || manifest.side_panel)) errors.push('invalid Firefox background/sidebar');
  const unexpected = ['externally_connectable', 'oauth2', 'update_url', 'key', 'content_scripts', 'web_accessible_resources'];
  for (const property of unexpected) if (manifest[property] !== undefined) errors.push('unexpected ' + property);
  return errors;
}

function filesIn(directory, base = directory) {
  return readdirSync(directory).sort().flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesIn(path, base) : [relative(base, path).replaceAll('\\', '/')];
  });
}

function compatibleSource(code, file) {
  if (file === 'background.js') {
    const previous = 'return "chrome-extension://" + runtimeId;';
    if (!code.includes(previous) && !code.includes('chrome.runtime.getURL("").replace')) throw new Error('missing background origin boundary');
    code = code.replace(previous, 'return chrome.runtime.getURL("").replace(/\\/$/, "");');
  }
  if (file === 'bridge.js') code = code.replace('let own3 = "chrome-extension://" + id;', 'let own3 = chrome.runtime.getURL("").replace(/\\/$/, "");');
  return code;
}

/** ADR-047: Chrome carries every module file; Firefox carries exactly the three stubs and no other module file. */
export function verifyProtectDelivery(output, browser) {
  for (const name of PROTECT_OUTPUTS) {
    const present = existsSync(join(output, name));
    if (browser === 'chrome' && !present) throw new Error('missing module file ' + name);
    if (browser === 'firefox' && PROTECT_CHROME_ONLY.includes(name) && present) throw new Error('Chrome-only module file in Firefox: ' + name);
  }
  if (browser === 'firefox') for (const [name, stub] of Object.entries(PROTECT_FIREFOX_STUBS)) {
    if (!existsSync(join(output, name)) || !readFileSync(join(output, name)).equals(readFileSync(join(root, stub)))) throw new Error('Firefox stub expected for ' + name);
  }
}

export function buildProduction(browser) {
  updateProductionLocales(source);
  verifyProductionSource(source);
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const manifest = productionManifest(browser, version);
  const errors = validateProductionManifest(manifest, browser);
  if (errors.length) throw new Error(errors.join('; '));
  const output = join(root, 'dist', browser);
  // These resolved paths are constants inside this project's dist directory.
  if (!output.startsWith(join(root, 'dist') + '\\') && !output.startsWith(join(root, 'dist') + '/')) throw new Error('unsafe output path');
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const adapter = readFileSync(join(source, 'browser-adapter.js'), 'utf8');
  for (const entry of readdirSync(source).sort()) {
    if (['manifest.json', 'browser-adapter.js', 'PROVENANCE.json'].includes(entry) || entry.endsWith('.md')) continue;
    // ADR-047 (port plan §2.7): Firefox ships stubs of the module «Защита» and none of its other files.
    if (browser === 'firefox' && PROTECT_CHROME_ONLY.includes(entry)) continue;
    if (browser === 'firefox' && Object.hasOwn(PROTECT_FIREFOX_STUBS, entry)) {
      cpSync(join(root, PROTECT_FIREFOX_STUBS[entry]), join(output, entry));
      continue;
    }
    cpSync(join(source, entry), join(output, entry), { recursive: true });
    if (entry.endsWith('.js')) {
      let code = compatibleSource(readFileSync(join(source, entry), 'utf8'), entry);
      if (browser === 'firefox' && ['background.js', 'bridge.js', 'api-custom-relay.js', 'api-custom-media-relay.js', 'popup.js', 'sidepanel.js', 'options.js', 'report.js'].includes(entry)) {
        const context = entry === 'background.js' ? 'background' : ['bridge.js', 'api-custom-relay.js', 'api-custom-media-relay.js'].includes(entry) ? 'bridge' : 'ui';
        code = adapter + '\nvar chrome = createFirefoxAdapter(globalThis.browser, ' + JSON.stringify(context) + ');\n' + code;
      }
      writeFileSync(join(output, entry), code, 'utf8');
    }
  }
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  verifyProtectDelivery(output, browser);
  for (const ref of [manifest.background.service_worker, ...(manifest.background.scripts ?? []), manifest.action.default_popup, manifest.options_ui.page, manifest.side_panel?.default_path, manifest.sidebar_action?.default_panel, manifest.storage?.managed_schema].filter(Boolean)) {
    if (!existsSync(join(output, ref))) throw new Error('missing manifest reference ' + ref);
  }
  console.log('build-production: ' + browser + ' ' + version + ' -> ' + relative(root, output).replaceAll('\\', '/'));
  console.log('  ' + filesIn(output).length + ' files; shared source apps/production-extension; no new dependencies');
  return { output, manifest };
}

export function archiveProduction(directory) {
  const locals = [], central = [];
  let offset = 0;
  for (const name of filesIn(directory)) {
    const raw = readFileSync(join(directory, name));
    const data = deflateRawSync(raw, { level: 9 });
    const filename = Buffer.from(name), checksum = crc32(raw) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8); header.writeUInt16LE(33, 12); header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(raw.length, 22); header.writeUInt16LE(filename.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8); record.writeUInt16LE(8, 10); record.writeUInt16LE(33, 14);
    record.writeUInt32LE(checksum, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(raw.length, 24);
    record.writeUInt16LE(filename.length, 28); record.writeUInt32LE(offset, 42);
    locals.push(header, filename, data); central.push(record, filename); offset += header.length + filename.length + data.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22), count = central.length / 2;
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, index, end]);
}

function main(argv) {
  const browserIndex = argv.indexOf('--browser');
  const browser = browserIndex < 0 ? 'chrome' : argv[browserIndex + 1];
  if (!BROWSERS.includes(browser) && browser !== 'all') throw new Error('--browser chrome|firefox|all expected');
  const targets = browser === 'all' ? BROWSERS : [browser];
  for (const target of targets) {
    const { output, manifest } = buildProduction(target);
    if (argv.includes('--release')) {
      const name = 'Detect.Expert-' + manifest.version + '-' + target + '.zip';
      mkdirSync(join(root, 'release'), { recursive: true });
      const zip = archiveProduction(output);
      writeFileSync(join(root, 'release', name), zip);
      console.log('  release/' + name + ' ' + zip.length + ' bytes SHA256 ' + createHash('sha256').update(zip).digest('hex'));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2));
