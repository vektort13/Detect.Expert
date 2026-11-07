// Engine models, an independent oracle and helpers for the translucent-pixel rule of api-custom-canvas-runtime.js (header: 'Translucent
// pixels'). Not a test file (no .test.mjs suffix). Everything below is MEASURED data plus the closed forms it fits, never a copy of the
// production code: scripts/test/canvas-translucent-native.mjs re-measures a live browser and fails when an embedded list no longer matches.
//
// A canvas stores a channel premultiplied as a byte q <= alpha (the "state"); getImageData returns get(q, alpha), the PNG encoder
// png(q, alpha), putImageData stores premul(v, alpha). x(q) = 255 q / alpha. Measured over all 254 alphas x 256 values = 65,024 pairs =
// 32,639 states (alpha 0 and 255 are exact everywhere):
//   skia-cpu   Chromium 153.0.8010.12 and Chrome 156.0.8078.80, software canvas (willReadFrequently) and every PNG: premul = round(v a / 255),
//              get = round(x), halves up, except 291 states at an exact half that return round(x) - 1.
//   skia-gpu   the same builds on an NVIDIA RTX 2080 SUPER (ANGLE D3D11), first read of an accelerated canvas and OffscreenCanvas: the same
//              premul, get = round(x) except 163 of the exact halves, which return round(x) - 1; the PNG encoder is the CPU one.
//   moz2d-old  Firefox 138.0.4 (release) and 153.0 (Nightly 20260722): premul = ceil(v a / 255), get = floor(x) except 423 states that
//              return floor(x) - 1 (all within 0.0137 above an integer), png = round(x), halves up, exactly.
//   moz2d-new  the arithmetic of the current upstream source (gfx/2d/SwizzleGeneric.h, read on 2026-11-06, NOT run in a browser): premul
//              rounds to nearest, get = png = (q * floor(0xFF00FF / a) + 0x8000) >> 16.
// The skia exceptions are exact-half states only: every other state returns round(x) in all paths.
const decode = text => { const out = new Set(); let sum = 0; for (const part of text.split(',')) { sum += Number(part); out.add(sum); } return out; };
const SKIA_CPU_DOWN = decode('1537,4,1533,8,1529,1537,16,1517,4,2,2,2,2,2,2,2,2,2,2,4,998,2,2,2,2,4,4,4,8,487,1537,28,1509,32,477,10,20,10,988,36,1493,8,4,4,4,4,4,4,4,4,4,4,8,1489,507,4,4,4,4,8,8,8,16,471,503,1537,52,1485,56,1469,12,12,12,48,1465,64,954,20,40,20,423,4,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,4,4,4,4,4,4,4,4,2,2,2,2,2,2,2,2,4,1453,72,455,44,966,76,988,457,16,8,8,8,8,8,8,8,8,8,8,16,457,984,1042,52,443,1014,8,8,8,8,16,16,16,32,411,531,1006,1517,20,20,20,20,1477,104,1433,1537,112,383,12,20,4,4,4,4,4,4,4,4,4,4,4,4,4,958,116,1397,24,24,24,96,1393,1050,487,128,1409,132,367,40,80,40,433,413,8,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,8,8,8,8,8,8,8,8,4,4,4,4,4,4,4,4,8,1341,14,14,28,14,14,28,28,28,14,942,441,144,910,88,395,74,74,1389,152,391,92,902,156,435,415,56,56,28,28,331,32,16,16,16,16,16,16,16,16,16,16,32,914,431,1058,100,379');
const SKIA_GPU_DOWN = decode('1537,1537,3074,1533,4,2,2,2,2,2,2,2,2,2,1006,4,2,3581,509,10,20,10,988,1529,8,4,4,4,4,4,4,4,4,4,2012,8,4,7162,1018,20,40,20,423,4,2,2,2,2,2,2,2,2,2,4,2,2,2,2,2,2,2,2,2,2,34,2,2,2,2,2,2,2,1459,505,22,22,22,966,76,988,457,16,8,8,8,8,8,8,8,8,8,2507,1517,16,8,491,3054,40,10739,1537,132,367,40,80,40,433,413,8,4,4,4,4,4,4,4,4,4,8,4,4,4,4,4,4,4,4,4,4,68,4,4,4,4,4,4,4,1353,14,14,28,14,14,98,1383,1010,44,44,44,1932,152,1385,591,914,32,16,16,16,16,16,16,16,16,16');
const MOZ_OLD_DOWN = decode('2307,3,3,514,514,1273,6,6,257,500,7,7,257,257,494,5,5,5,5,257,239,9,9,257,257,514,13107,1227,29,29,257,1028,695,19,19,19,19,2056,257,514,442,36,36,1285,181,38,38,514,179,39,39,257,145,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,514,432,41,41,687,42,42,1285,169,44,44,257,257,936,46,46,257,145,28,28,28,28,163,47,47,514,1659,10,10,10,10,10,10,10,10,10,10,10,10,10,10,257,257,107,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,390,31,31,31,31,506,8,257,151,53,53,1276,9,103,11,11,11,11,11,11,11,11,11,11,11,11,11,11,257,402,56,56,657,57,57,257,398,58,58,514,139,59,59,514,89,12,12,12,12,12,12,12,12,12,12,12,12,12,12,257,392,61,61,257,1028,362,38,38,38,38,715,28,28,332,13,13,13,13,13,13,13,13,13,13,13,13,13,13,639,66,66,257,771,257,350,41,41,41,41,215,21,21,119,69,69,257,257,61,14,14,14,14,14,14,14,14,14,14,14,14,14,14,257,188,69,115,71,71,257,85,43,43,43,43,113,72,72,257,204,53,111,73,67,6,81,44,44,44,44,49,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,514,304,15,15,15,15,15,15,15,15,15,15,15,15,15,15,257,257,105,76,76,257,73,46,46,46,46,103,77,77,257,257,101,78,78,69,47,47,47,47,108,87,62,99,79,79,33,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,257,771,95,81,61,20,124,111,22,61,49,49,49,49,93,82,55,27,257,257,91,83,83,326,63,63,62,89,84,84,514');
export const SKIA_CPU_LIST = SKIA_CPU_DOWN, SKIA_GPU_LIST = SKIA_GPU_DOWN, MOZ_OLD_LIST = MOZ_OLD_DOWN; // packed alpha * 256 + q
export const roundUp = (q, a) => Math.floor((q * 510 + a) / (2 * a)); // round(255 q / a), halves up
export const floorOf = (q, a) => Math.floor(q * 255 / a);
const upstream = (q, a) => Math.min(255, (q * Math.floor(0xFF00FF / a) + 0x8000) >>> 16);
const packed = (a, q) => a * 256 + q;

// premul(v, a): the stored byte; get / png(q, a): the straight byte (0 < a < 255; the callers handle 0 and 255).
export const ENGINES = Object.freeze({
  'skia-cpu': Object.freeze({ family: 1, name: 'skia-cpu', premul: (v, a) => Math.floor((v * a * 2 + 255) / 510), get: (q, a) => roundUp(q, a) - (SKIA_CPU_DOWN.has(packed(a, q)) ? 1 : 0), png: (q, a) => roundUp(q, a) - (SKIA_CPU_DOWN.has(packed(a, q)) ? 1 : 0) }),
  'skia-gpu': Object.freeze({ family: 1, name: 'skia-gpu', premul: (v, a) => Math.floor((v * a * 2 + 255) / 510), get: (q, a) => roundUp(q, a) - (SKIA_GPU_DOWN.has(packed(a, q)) ? 1 : 0), png: (q, a) => roundUp(q, a) - (SKIA_CPU_DOWN.has(packed(a, q)) ? 1 : 0) }),
  'moz2d-old': Object.freeze({ family: 2, name: 'moz2d-old', premul: (v, a) => Math.ceil(v * a / 255), get: (q, a) => floorOf(q, a) - (MOZ_OLD_DOWN.has(packed(a, q)) ? 1 : 0), png: (q, a) => roundUp(q, a) }),
  'moz2d-new': Object.freeze({ family: 2, name: 'moz2d-new', premul: (v, a) => Math.floor((v * a * 2 + 255) / 510), get: upstream, png: upstream }),
});
export const FAMILIES = Object.freeze({ 1: Object.freeze(['skia-cpu', 'skia-gpu']), 2: Object.freeze(['moz2d-old', 'moz2d-new']) });
// Realm members that select a family in production (a Chromium window has webkitRequestAnimationFrame, a Firefox window mozInnerScreenX).
export function markRealm(realm, family) { if (family === 1) realm.webkitRequestAnimationFrame = function webkitRequestAnimationFrame() { return 0; }; else if (family === 2) realm.mozInnerScreenX = 0; return realm; }

// One pixel at offset o: straight RGBA -> stored bytes, and stored bytes -> straight (which = 'get' | 'png').
export function storePixel(engine, straight, o, out = straight) {
  const a = straight[o + 3];
  if (a === 0) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; return; }
  for (let c = 0; c < 3; c++) out[o + c] = a === 255 ? straight[o + c] : engine.premul(straight[o + c], a);
  out[o + 3] = a;
}
export function readPixel(engine, stored, o, which = 'get', out = stored) {
  const a = stored[o + 3];
  if (a === 0) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; return; }
  for (let c = 0; c < 3; c++) out[o + c] = a === 255 ? stored[o + c] : engine[which](stored[o + c], a);
  out[o + 3] = a;
}
// Every straight byte the engine can return for alpha a (0 < a < 255): its image of the states.
export function reachable(engine, a, which = 'get') { const out = new Set(); for (let q = 0; q <= a; q++) out.add(engine[which](q, a)); return out; }

// ---------------------------------------------------------------------------------------------
// Independent oracle: the specification of the header written with loops over the states (production uses closed forms).
// ---------------------------------------------------------------------------------------------
export const nearestState = (v, a) => { let best = 0, bestGap = Infinity; for (let q = 0; q <= a; q++) { const gap = Math.abs(255 * q - v * a); if (gap <= bestGap) { best = q; bestGap = gap; } } return best; }; // ties: larger q
const roundedValue = (t, a) => { let best = 0, bestGap = Infinity; for (let k = 0; k <= 255; k++) { const gap = Math.abs(255 * t - k * a); if (gap <= bestGap) { best = k; bestGap = gap; } } return best; }; // ties: larger k
const flooredValue = (t, a) => { let k = 0; while (k < 255 && (k + 1) * a <= 255 * t) k++; return k; };
// Is w a straight byte that every arithmetic of the family returns for some state?
export function usable(w, a, family) {
  const t = nearestState(w, a), gap = 255 * t - w * a;
  if (family === 1) return 2 * Math.abs(gap) < a;
  if (100 * Math.abs(gap) > 49 * a) return false;
  let above = 0; while (255 * above < w * a) above++;
  if (above > a || 255 * above - w * a >= a) return false;
  if (above === 0) return true;
  const rest = (255 * above) % a;
  return rest === 0 ? 255 % a === 0 : rest * 100 >= 3 * a;
}
// The new value of one translucent channel (0 < a < 255), or -1 when it stays. up: truthy = the selection says up.
export function oracleNearby(v, a, up, family) {
  if (!family || a <= 0 || a >= 255) return -1;
  const q = nearestState(v, a), gap = 255 * q - v * a;
  if (family === 1 ? 2 * Math.abs(gap) > a : (2 * gap < -a || 100 * gap > 102 * a)) return -1;
  for (let step = 1; step <= REACH[family]; step++) for (const side of up ? [1, -1] : [-1, 1]) {
    const t = q + side * step; if (t < 0 || t > a) continue;
    const first = roundedValue(t, a), second = family === 2 ? flooredValue(t, a) : first;
    for (const w of first === second ? [first] : [first, second]) if (w !== v && usable(w, a, family)) return w;
  }
  return -1;
}
// Largest state distance the search may use (family 1: 2 states, family 2: 3).
export const REACH = Object.freeze({ 1: 2, 2: 3 });

// sparse-rgb-v2 (ADR-112): the same specification with the keyed bit as the target PARITY of the stored state instead of a direction.
// A pixel whose state already has the parity stays; otherwise the neighbouring states q + 1, q - 1 (family 2: then q + 3, q - 3) are
// tried in that order, each by its rounded value (family 2: then its floored value), and the first usable value other than v wins.
export const PARITY_REACH = Object.freeze({ 1: 1, 2: 3 });
export function oracleParity(v, a, bit, family) {
  if (!family || a <= 0 || a >= 255) return -1;
  const q = nearestState(v, a), gap = 255 * q - v * a;
  if (family === 1 ? 2 * Math.abs(gap) > a : (2 * gap < -a || 100 * gap > 102 * a)) return -1;
  if ((q & 1) === bit) return -1;
  for (let step = 1; step <= PARITY_REACH[family]; step += 2) for (const side of [1, -1]) {
    const t = q + side * step; if (t < 0 || t > a) continue;
    const first = roundedValue(t, a), second = family === 2 ? flooredValue(t, a) : first;
    for (const w of first === second ? [first] : [first, second]) if (w !== v && usable(w, a, family)) return w;
  }
  return -1;
}
