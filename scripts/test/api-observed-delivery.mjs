// ADR-067: independently reproduce only the approved packaging transforms.
// The entire expected file is compared; an arbitrary prefix cannot pass.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const API_OBSERVED_DELIVERY_FILES = Object.freeze([
  'api-observed-usage.js', 'api-observed-usage-controller.js', 'api-observed-usage-ui.js',
  'api-configuration-ui.js', 'api-configuration-ui.css', 'antidetect-ui.js', 'antidetect-ui.css',
  'management-ui.js', 'options.js', 'background.js', 'report.js'
]);
const FIREFOX_CONTEXT = Object.freeze({ 'background.js': 'background', 'options.js': 'ui', 'report.js': 'ui' });
const OLD_ORIGIN = 'return "chrome-extension://" + runtimeId;';
const NATIVE_ORIGIN = 'return chrome.runtime.getURL("").replace(/\\/$/, "");';

export function expectedDelivered(sourceDirectory, file, browser) {
  assert.ok(browser === 'chrome' || browser === 'firefox', 'Known production browser');
  assert.ok(API_OBSERVED_DELIVERY_FILES.includes(file), 'Known observed-API proof file');
  let code = readFileSync(join(sourceDirectory, file), 'utf8');
  if (file === 'background.js') {
    const matches = code.split(OLD_ORIGIN).length - 1;
    assert.ok(matches <= 1, 'One approved background origin boundary');
    assert.ok(matches === 1 || code.includes(NATIVE_ORIGIN), 'Expected background origin boundary is present');
    // build-production applies compatibleSource before its browser branch,
    // including Chrome. A second occurrence would need an explicit review.
    code = code.replace(OLD_ORIGIN, NATIVE_ORIGIN);
  }
  if (browser === 'firefox' && Object.hasOwn(FIREFOX_CONTEXT, file)) {
    const adapter = readFileSync(join(sourceDirectory, 'browser-adapter.js'), 'utf8');
    code = adapter + '\nvar chrome = createFirefoxAdapter(globalThis.browser, ' + JSON.stringify(FIREFOX_CONTEXT[file]) + ');\n' + code;
  }
  return Buffer.from(code, 'utf8');
}
