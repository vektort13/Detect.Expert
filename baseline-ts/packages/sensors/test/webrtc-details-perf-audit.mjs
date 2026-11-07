// ADR-020 raw native ctor+close cost. No extension, ICE gathering, remote endpoints or result values.
import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const built = await build({ stdin: { contents: "export {SensorRuntime,browserEnv} from './packages/sensors/src/runtime'; export {installWebRTCSensor} from './packages/sensors/src/webrtc';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'RTCPerf', target: 'es2022', logLevel: 'silent' });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const result = { measuredAt: new Date().toISOString(), browser: browser.version(), extensionLoaded: false,
  method: 'N5 alternating native/hooked pairs per batch size; one fresh page per pair; five warmups each; native Performance.now captured before hooks; real browserEnv clock; timers/transport disabled; iceServers empty and candidate pool zero',
  interpretation: 'Raw source-sensor ctor+close microcost, not whole-extension performance or a global 5% gate; batch100 includes the documented32connection detail cap', trials: [] };
try {
  for (const iterations of [10, 100]) {
    const pairs = [];
    for (let trial = 0; trial < 5; trial++) {
      const page = await browser.newPage();
      try {
        await page.goto('about:blank'); await page.addScriptTag({ content: built.outputFiles[0].text });
        const pair = await page.evaluate(({ iterations, trial }) => {
          const Native = RTCPeerConnection, nativeClose = RTCPeerConnection.prototype.close;
          const now = Performance.prototype.now.bind(performance);
          const config = { iceServers: [], iceCandidatePoolSize: 0 };
          function nativeLoop(count) { for (let i = 0; i < count; i++) Reflect.apply(nativeClose, new Native(config), []); }
          function hookedLoop(count) { for (let i = 0; i < count; i++) { const pc = new RTCPeerConnection(config); pc.close(); } }
          function install() {
            const env = RTCPerf.browserEnv(window);
            const runtime = new RTCPerf.SensorRuntime({ ...env, setTimeout: () => 0, clearTimeout() {}, postMessage() {} });
            RTCPerf.installWebRTCSensor(runtime, window); return runtime;
          }
          nativeLoop(5);
          const warmup = install(); hookedLoop(5); warmup.stop('local');
          let nativeMs, hookedMs;
          const measureNative = () => { const begin = now(); nativeLoop(iterations); nativeMs = now() - begin; };
          const measureHooked = () => {
            const runtime = install();
            const begin = now(); hookedLoop(iterations); hookedMs = now() - begin;
            runtime.stop('local');
          };
          if (trial % 2 === 0) { measureNative(); measureHooked(); } else { measureHooked(); measureNative(); }
          return { trial: trial + 1, order: trial % 2 === 0 ? 'native-first' : 'hooked-first', nativeUsPerPair: nativeMs * 1000 / iterations, hookedUsPerPair: hookedMs * 1000 / iterations, restored: RTCPeerConnection === Native && RTCPeerConnection.prototype.close === nativeClose };
        }, { iterations, trial });
        if (!pair.restored) throw new Error('Native constructor/close not restored');
        pairs.push(pair);
      } finally { await page.close(); }
    }
    const median = values => values.slice().sort((a, b) => a - b)[2];
    const nativeMedianUsPerPair = median(pairs.map(pair => pair.nativeUsPerPair));
    const hookedMedianUsPerPair = median(pairs.map(pair => pair.hookedUsPerPair));
    result.trials.push({ iterations, pairs, nativeMedianUsPerPair, hookedMedianUsPerPair, deltaUsPerPair: hookedMedianUsPerPair - nativeMedianUsPerPair,
      relativeDeltaPercent: (hookedMedianUsPerPair / nativeMedianUsPerPair - 1) * 100 });
  }
  writeFileSync('test-results/prod/reports/2026-09-13-webrtc-details-microperf.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result.trials.map(({ pairs, ...summary }) => summary), null, 2));
} finally { await browser.close(); }
