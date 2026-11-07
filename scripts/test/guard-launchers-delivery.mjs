// ADR-068: exact native-tested launcher/runtime bytes, including browser adapters.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectedDelivered, API_OBSERVED_DELIVERY_FILES } from './api-observed-delivery.mjs';
import { PROTECT_FIREFOX_STUBS } from '../production/protect-files.mjs';

export const GUARD_LAUNCHER_FILES = Object.freeze([...API_OBSERVED_DELIVERY_FILES,
  'popup.js', 'sidepanel.js', 'guard-launcher-controller.js', 'guard-launchers-ui.js',
  'api-configuration.js', 'api-configuration-controller.js', 'api-custom-registration.js',
  'api-custom.main.js', 'protection-ui.js', 'protection-ui.css', 'protect-ui.js', 'protect.css',
  'antidetect-controller.js', 'fingerprint-profiles.js', 'management-navigation.js',
  'webrtc-network-controller.js', 'antidetect-protocol-controller.js', 'antidetect-header-controller.js', 'webrtc-configuration-ui.js',
]);
export function expectedGuardDelivery(root, file, browser) {
  assert.ok(GUARD_LAUNCHER_FILES.includes(file));
  const source = join(root, 'apps/production-extension');
  if (API_OBSERVED_DELIVERY_FILES.includes(file)) return expectedDelivered(source, file, browser);
  if (browser === 'firefox' && Object.hasOwn(PROTECT_FIREFOX_STUBS, file)) return readFileSync(join(root, PROTECT_FIREFOX_STUBS[file]));
  const bytes = readFileSync(join(source, file));
  if (browser === 'firefox' && ['popup.js', 'sidepanel.js'].includes(file)) {
    return Buffer.from(readFileSync(join(source, 'browser-adapter.js'), 'utf8') + '\nvar chrome = createFirefoxAdapter(globalThis.browser, "ui");\n' + bytes.toString('utf8'));
  }
  return bytes;
}
