// E22-24: independently reproduce the exact delivery bytes used by the Custom IP proof.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUARD_LAUNCHER_FILES, expectedGuardDelivery } from './guard-launchers-delivery.mjs';

export const WEBRTC_CUSTOM_INPUT_FILES = Object.freeze([...GUARD_LAUNCHER_FILES,
  'webrtc-configuration-ui.css', 'api-custom-webrtc-runtime.js',
  'api-custom-document-runtime.js',
]);

export function expectedWebRtcInputDelivery(root, file, browser) {
  assert.ok(WEBRTC_CUSTOM_INPUT_FILES.includes(file));
  if (GUARD_LAUNCHER_FILES.includes(file)) return expectedGuardDelivery(root, file, browser);
  return readFileSync(join(root, 'apps/production-extension', file));
}
