import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { FORTER_RESOURCE_RULES, patchForterMatcher } from './forter-resource-plan.mjs';
const root = resolve(import.meta.dirname, '../..'), folder = resolve(root, 'apps/production-extension');
let source = readFileSync(resolve(folder, 'background.js'), 'utf8');
const start = source.indexOf('var vendors_runtime_default = '), end = source.indexOf(';\n', start);
if (start < 0 || end < start) throw Error('Missing vendor resource registry');
const registry = vm.runInNewContext('(' + source.slice(start + 'var vendors_runtime_default = '.length, end) + ')');
registry.rules = registry.rules.filter(rule => !FORTER_RESOURCE_RULES.some(added => added.id === rule.id));
registry.rules.push(...FORTER_RESOURCE_RULES);
registry.catalogVersion = 'curated-2026-10-10.1';
if (registry.rules.length > 64) throw Error('Resource rule budget exceeded');
source = source.slice(0, start) + 'var vendors_runtime_default = ' + JSON.stringify(registry, null, 2) + source.slice(end);
source = patchForterMatcher(source);
source = source.replace(/var NETWORK_RESOURCE_TYPES = \[[^\n]+\], NETWORK_FILTER =/, 'var NETWORK_RESOURCE_TYPES = ["script", "xmlhttprequest", "sub_frame", "other", "image", "ping"], NETWORK_FILTER =');
writeFileSync(resolve(folder, 'background.js'), source);
for (const file of ['popup.js', 'sidepanel.js', 'report.js']) {
  let ui = readFileSync(resolve(folder, file), 'utf8');
  if (!ui.includes('forter: "Forter')) throw Error('Missing Forter UI identity in ' + file);
  ui = ui.replace('forter: "Forter 3DS"', 'forter: "Forter"');
  ui = ui.replace(/VENDOR_CATALOG_RULE_COUNT = \d+/, 'VENDOR_CATALOG_RULE_COUNT = ' + registry.rules.length);
  writeFileSync(resolve(folder, file), ui);
}
console.log('Forter synchronized: ' + registry.rules.length + ' resource rules; 3 added endpoint groups; existing rules retained.');
