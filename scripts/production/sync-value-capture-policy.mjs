// ADR-066: canonical private preview veto, preserving the reviewed production
// recorder's later RTC/technical/loader additions through narrow guarded edits.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
const root = resolve(import.meta.dirname, '../..');
export function valueCapturePolicyRuntimeSource() {
  const canonical = readFileSync(resolve(root, 'baseline-ts/packages/sensors/src/value-capture-policy.ts'), 'utf8');
  const compiled = transformSync(canonical.replace(/^export /gm, ''), { loader: 'ts', target: 'es2022', charset: 'utf8', legalComments: 'none', minify: false }).code;
  return '  // ADR-066 value capture policy start\n  var valueCapturePolicy66 = (() => {\n' + compiled.split('\n').map(line => '    ' + line).join('\n') +
    '\n    return { bindValueCapturePolicy, registerValueCaptureRealm, valueCaptureDenied, onValueCaptureDenied };\n  })();\n' +
    '  var { bindValueCapturePolicy, registerValueCaptureRealm, valueCaptureDenied, onValueCaptureDenied } = valueCapturePolicy66;\n' +
    '  // ADR-066 value capture policy end\n';
}
export function rtcCaptureRuntimeSource() {
  const canonical = readFileSync(resolve(root, 'baseline-ts/packages/sensors/src/rtc-details.ts'), 'utf8');
  const body = canonical.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const compiled = transformSync(body, { loader: 'ts', target: 'es2022', charset: 'utf8', legalComments: 'none', minify: false }).code;
  return '  // packages/sensors/src/rtc-details.ts\n' +
    '  // ADR-066 canonical RTC details policy start\n' +
    '  var installRtcCapture = (() => {\n' + compiled.split('\n').map(line => '    ' + line).join('\n') +
    '\n    return installRtcCapture;\n  })();\n' +
    '  // ADR-066 canonical RTC details policy end\n\n';
}
export function syncValueCapturePolicy({ check = false } = {}) {
  const block = valueCapturePolicyRuntimeSource();
  const rtc = rtcCaptureRuntimeSource();
  for (const name of ['hook.early.js', 'hook.main.js']) {
    const path = resolve(root, 'apps/production-extension', name), before = readFileSync(path, 'utf8'); let source = before;
    const from = source.indexOf('  // ADR-066 value capture policy start\n'), endMarker = '  // ADR-066 value capture policy end\n';
    if (from >= 0) { const end = source.indexOf(endMarker, from); if (end < from) throw Error(name + ': value policy boundary'); source = source.slice(0, from) + block + source.slice(end + endMarker.length); }
    else source = source.replace('  // packages/sensors/src/api-results.ts\n', '  // packages/sensors/src/api-results.ts\n' + block);
    const replace = (old, replacement) => { if (source.includes(replacement)) return; if (!source.includes(old)) throw Error(name + ': value policy integration missing: ' + old.slice(0, 90)); source = source.replace(old, replacement); };
    for (const signature of ['recordRtc(operation, value, args)', 'recordPro(operation, phase, result, args, proTechnique)', 'storePro(row)', 'record(operation, phase, result)', 'store(entry)']) {
      replace('    ' + signature + ' {\n', '    ' + signature + ' {\n      if (valueCaptureDenied(this)) return;\n');
    }
    replace('    snapshot() {\n      let rows = [];', '    snapshot() {\n      if (valueCaptureDenied(this)) return { rows: [], truncated: false };\n      let rows = [];');
    replace('    handleControl(control2, enabled, env) {\n', '    handleControl(control2, enabled, env) {\n      enabled = enabled && !valueCaptureDenied(this);\n');
    replace('        env.postMessage({\n          channel: API_RESULTS_CHANNEL,', '        const denied = valueCaptureDenied(this);\n        env.postMessage({\n          channel: API_RESULTS_CHANNEL,');
    replace('          final: index >= snapshot.rows.length,\n          enabled,\n          rows,\n          truncated: snapshot.truncated\n        }), batchSeq++;', '          final: denied || index >= snapshot.rows.length,\n          enabled: enabled && !denied,\n          rows: denied ? [] : rows,\n          truncated: denied ? false : snapshot.truncated\n        }), batchSeq++;\n        if (denied) return;');
    replace('this.env = env, this.apiResults = new ApiResultRecorder(env.earlyCaptureGuaranteed === !0 && !env.startedLate), this.hooks.onObserverError', 'this.env = env; this.apiResults = new ApiResultRecorder(env.earlyCaptureGuaranteed === !0 && !env.startedLate);\n      bindValueCapturePolicy(this.apiResults, this);\n      onValueCaptureDenied(this, () => this.apiResults.clear());\n      registerValueCaptureRealm(this, env.self);\n      this.hooks.onObserverError');
    replace('  function installSensors(runtime, realm) {\n', '  function installSensors(runtime, realm) {\n    registerValueCaptureRealm(runtime, realm);\n');
    const rtcStart = source.indexOf('  // packages/sensors/src/rtc-details.ts\n');
    const rtcEnd = source.indexOf('  // packages/sensors/src/rtc-values.ts\n', rtcStart);
    if (rtcStart < 0 || rtcEnd <= rtcStart) throw Error(name + ': RTC details module boundary');
    source = source.slice(0, rtcStart) + rtc + source.slice(rtcEnd);
    if (check && source !== before) throw Error(name + ': value capture synchronization required');
    if (!check && source !== before) writeFileSync(path, source);
  }
  return block;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const check = process.argv.includes('--check'); syncValueCapturePolicy({ check }); console.log((check ? 'checked' : 'synchronized') + ' canonical value capture policy'); }
