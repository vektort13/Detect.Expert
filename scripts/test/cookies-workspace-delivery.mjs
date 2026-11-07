import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectedDelivered } from './api-observed-delivery.mjs';
export const COOKIE_FILES = Object.freeze(['manifest.json', 'options.html', 'options.js', 'management-navigation.js', 'management-ui.js', 'management-ui.css',
  'cookie-site.js', 'cookie-transfer-core.js', 'cookie-transfer-crypto.js', 'cookie-time.js', 'cookie-details.js', 'cookies-workspace-controller.js', 'cookies-ui.js', 'cookies-ui.css']);
export function expectedCookieDelivery(root, file, browser) {
  if (file === 'options.js' || file === 'management-ui.js') return expectedDelivered(join(root, 'apps/production-extension'), file, browser);
  return readFileSync(join(root, 'apps/production-extension', file));
}
