// ADR-113: the Detector says WHY a page it could not observe reads "paused" when the observation sensors were kept out of that page
// next to Antidetect. Narrow, idempotent patches of the shared Inspector view-model in popup.js and sidepanel.js (places are found by
// anchor strings, never by line numbers); `--check` changes nothing and exits 1 when a bundle is out of date.
//   Q1 helpers block after the ADR-103 helpers: the label module import and the three lines of the reason;
//   Q2 coverageInputOf: the scope reply of the service worker carries `sensorsQuiet` (a boolean, additive);
//   Q3 coverageView, state "paused": a pause without the "paused" flag is not the user's pause, so the reason replaces the generic text.
// The user's own pause (flag "paused") keeps its text. The report schema, the coverage states and the flag set are unchanged.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
export const QUIET_UI_BUNDLES = Object.freeze(['popup.js', 'sidepanel.js']);
export const HELPERS_ANCHOR = '// end ADR-103 redesign helpers\n';
export const HELPERS_BEGIN = '// ADR-113 sensor quiet helpers\n';
export const HELPERS_END = '// end ADR-113 sensor quiet helpers\n';
export const HELPERS = HELPERS_BEGIN
  + 'import { antidetectQuietLabels } from "./antidetect-quiet-labels.js";\n'
  + 'var quietText = (key) => antidetectQuietLabels(uiLocale())[key];\n'
  + 'var quietPausedLines = (now) => [quietText(now ? "paused_now" : "paused_ended"), quietText("paused_calls"), quietText("paused_setting")];\n'
  + HELPERS_END;
export const REPLACEMENTS = Object.freeze([
  ['    managed: session.scope?.managed === !0,\n',
    '    managed: session.scope?.managed === !0,\n    sensorsQuiet: session.scope?.sensorsQuiet === !0,\n'],
  ['    case "paused":\n      tone = "muted", lines.push(msg("coverage_paused_desc"), msg("coverage_paused_reload"));\n      break;\n',
    '    case "paused":\n      // ADR-113: a pause without the "paused" flag is not the user\'s pause: the sensors were kept out of this page next to Antidetect.\n'
    + '      tone = "muted", report2.coverageFlags.includes("paused") ? lines.push(msg("coverage_paused_desc"), msg("coverage_paused_reload")) : lines.push(...quietPausedLines(input.sensorsQuiet === !0));\n      break;\n'],
]);

const count = (text, needle) => text.split(needle).length - 1;

export function patchSensorQuietUi(before, name = 'bundle') {
  let source = before;
  for (const [from, to] of REPLACEMENTS) {
    if (source.includes(to)) continue;
    if (count(source, from) !== 1) throw Error(name + ': ADR-113 anchor requires review: ' + from.slice(0, 80));
    source = source.replace(from, () => to);
  }
  const begin = source.indexOf(HELPERS_BEGIN);
  if (begin >= 0) {
    const end = source.indexOf(HELPERS_END, begin);
    if (end < 0 || count(source, HELPERS_BEGIN) !== 1) throw Error(name + ': ADR-113 helpers markers are damaged');
    source = source.slice(0, begin) + HELPERS + source.slice(end + HELPERS_END.length);
  } else {
    if (count(source, HELPERS_ANCHOR) !== 1) throw Error(name + ': ADR-103 helpers end marker requires review');
    source = source.replace(HELPERS_ANCHOR, () => HELPERS_ANCHOR + HELPERS);
  }
  return source;
}

export function syncSensorQuietUi({ check = false, directory = resolve(root, 'apps/production-extension') } = {}) {
  if (!existsSync(resolve(directory, 'antidetect-quiet-labels.js'))) throw Error('antidetect-quiet-labels.js is missing');
  for (const name of QUIET_UI_BUNDLES) {
    const path = resolve(directory, name), source = readFileSync(path, 'utf8'), next = patchSensorQuietUi(source, name);
    if (check && next !== source) throw Error(name + ': ADR-113 sensor quiet synchronization required (run scripts/production/sync-sensor-quiet-ui.mjs)');
    if (!check && next !== source) writeFileSync(path, next, 'utf8');
  }
  return QUIET_UI_BUNDLES.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  console.log((check ? 'checked' : 'synchronized') + ' ADR-113 sensor quiet reason: ' + syncSensorQuietUi({ check }) + ' Inspector bundles');
}
