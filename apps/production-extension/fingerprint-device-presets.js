// ADR-104: Profile Consistency Engine data. Pure data and pure functions, no browser
// calls. Every produced value stays inside a domain the api-configuration validator
// already accepts; this module introduces no new Custom type, API or capability. The
// goal is an internally consistent reported profile (an inconsistent one is itself a
// tracking signal), never a claim about real hardware, IP, TLS or the browser engine.
import { windowsFonts, regionFontGroup, regionFontRoots, REGION_FONT_GROUP_KEYS } from './fingerprint-font-groups.js';
import { fontNoiseModel, noisyFontList, followFontNoise, removedByNoise } from './fingerprint-font-noise.js';
import { regionOfTimeZone, regionCodes, regionByCode } from './fingerprint-region-data.js';

// Chrome build only (see ADR-104): Chromium family, Windows desktop/laptop. Firefox,
// Safari, macOS and Linux are deliberately out of this picker.

export const DEVICE_TYPES = Object.freeze(['laptop', 'desktop']);
export const DEVICE_OS = Object.freeze(['windows-10', 'windows-11']);
export const DEVICE_BROWSERS = Object.freeze(['chrome', 'edge']);

// Static, offline version list "136 … latest" (ТЗ §3). No network lookup. The newest
// entry tracks the newest Chrome stable the owner runs (156 on 2026-11-05); extend on real bumps.
export const BROWSER_VERSION_MIN = 136;
export const BROWSER_VERSION_MAX = 156;
// ADR-107: when this browser is newer than the static list, the list reaches up to its real major, at most this many majors
// past BROWSER_VERSION_MAX (about two years of four-week releases); anything further is treated as not a real version.
export const BROWSER_VERSION_REACH = 24;
export const claimableVersion = major => Number.isSafeInteger(major) && major >= BROWSER_VERSION_MIN && major <= BROWSER_VERSION_MAX + BROWSER_VERSION_REACH;
// `environment` (optional, plain data about the real browser; see normalizeEnvironment) only extends the top of the list.
export function browserVersions(environment) {
  const real = environment === undefined ? undefined : normalizeEnvironment(environment).uaMajor;
  const top = claimableVersion(real) && real > BROWSER_VERSION_MAX ? real : BROWSER_VERSION_MAX;
  const list = [];
  for (let v = top; v >= BROWSER_VERSION_MIN; v--) list.push(v);
  return list;
}

// navigator.deviceMemory is a bucket of the physical RAM. Chrome before 147 clamps it to {0.25..8};
// Chrome 147+ reports 2/4/8/16/32 (verified natively: Chromium 153 and Chrome 156 on a 127 GB host report 32).
// physicalGb is the visual-card image; the value handed to a page is the bucket for the claimed Chrome major.
export const RAM_STEPS = Object.freeze([4, 8, 16, 32, 64, 128]);
export const deviceMemoryBuckets = chromeMajor => Number(chromeMajor) >= 147 ? [2, 4, 8, 16, 32] : [0.5, 1, 2, 4, 8];
export function reportedDeviceMemory(physicalGb, chromeMajor = BROWSER_VERSION_MAX) {
  const n = Number(physicalGb), buckets = deviceMemoryBuckets(chromeMajor);
  if (!Number.isFinite(n) || n <= 0) return 8;
  for (const bucket of buckets) if (n <= bucket) return bucket;
  return buckets[buckets.length - 1];
}

// hardwareConcurrency steps of the slider (ТЗ §4).
export const CPU_STEPS = Object.freeze([2, 4, 6, 8, 12, 16, 18, 20, 24, 28, 32]);
// What a machine with a card of a given performance class (1 office … 4 high end) usually has. A random device draws
// only from these sets, so a 4K 24-thread desktop never gets an office iGPU and a gaming card never a 1366x768 panel.
// Each card also carries its own `threads` list (see GPU_PRESETS): the draw uses the overlap of both when there is one.
const CLASS_CORES = Object.freeze({
  laptop: Object.freeze({ 1: [4, 8], 2: [8, 12], 3: [8, 12, 16], 4: [12, 16, 20] }),
  desktop: Object.freeze({ 1: [4, 6, 8], 2: [6, 8, 12], 3: [8, 12, 16], 4: [12, 16, 20, 24] }),
});
// Panels (physical monitors) a random device of a class may get; the Windows display scale is drawn per panel below. A
// repeated id weights the draw (heuristic: 16:10 1920x1200 laptops are the minority, 1366x768 only on office laptops).
const CLASS_PANELS = Object.freeze({
  laptop: Object.freeze({ 1: ['1366x768', '1920x1080', '1920x1080', '1920x1080', '1920x1200'], 2: ['1920x1080', '1920x1080', '1920x1080', '1920x1080', '1920x1200'], 3: ['1920x1080', '1920x1080', '1920x1080', '1920x1080', '1920x1200'], 4: ['1920x1080'] }),
  desktop: Object.freeze({ 1: ['1920x1080'], 2: ['1920x1080'], 3: ['1920x1080', '2560x1440'], 4: ['2560x1440', '3840x2160', '1920x1080'] }),
});
const CLASS_RAM = Object.freeze({ laptop: Object.freeze({ 1: 8, 2: 16, 3: 16, 4: 32 }), desktop: Object.freeze({ 1: 8, 2: 16, 3: 32, 4: 32 }) });

// storage.estimate() quota — a plausible reported quota, NOT a physical disk size
// (Отчёт: do not pretend to be an "8 TB disk"). physicalGb is the visual image only.
// ADR-107 (measured on Chrome 156): Chrome reports quota = usage + 10 GiB whatever the disk is, so a Chromium claim keeps the quota
// native and the Disk control writes the share below only for another engine (a Firefox user without a Chromium claim).
export const STORAGE_CHROME_HEADROOM = 10 * 1024 * 1024 * 1024;
export const DISK_STEPS = Object.freeze([512, 1024, 2048, 4096, 8192]); // GiB, visual image
const QUOTA_SHARE = 0.5;
export function reportedStorageQuota(physicalGb) {
  // Chrome's quota is a share of the disk, never the disk itself. The share is fixed so the
  // pictured capacity can be read back from the reported value (see diskFromQuota).
  const n = Number(physicalGb);
  const gib = !Number.isFinite(n) || n <= 0 ? 512 : n;
  return { quota: Math.round(gib * QUOTA_SHARE) * 1024 * 1024 * 1024, usage: 0 };
}
// Inverse of reportedStorageQuota: the pictured disk step whose share is exactly this quota, else null. ADR-107: a Chrome-shaped
// quota (usage + 10 GiB, the catalogue presets) is not a disk picture, so it no longer reads back as the nearest step.
export function diskFromQuota(quotaBytes) {
  const quota = Number(quotaBytes);
  if (!Number.isFinite(quota) || quota <= 0) return null;
  return DISK_STEPS.find(step => reportedStorageQuota(step).quota === quota) ?? null;
}
// navigator.deviceMemory cannot say how much RAM is above 8 GB, so the pictured RAM is only
// a UI image. A bucket below 8 maps to itself; 8 maps to the typical machine of that class.
export function ramImageFromReported(bucket, deviceType = 'desktop', chromeMajor = BROWSER_VERSION_MAX) {
  if (!Number.isFinite(bucket)) return null;
  // Chrome 147+ reports 16/32 itself; before that 8 stands for every machine of 8 GB and more.
  if (Number(chromeMajor) >= 147 || bucket < 8) return RAM_STEPS.includes(bucket) ? bucket : RAM_STEPS[0];
  return deviceType === 'laptop' ? 16 : 32;
}

// --- Screens: a panel (physical monitor) at a Windows display scale ------------------------------------------------
// Windows Chrome reports screen.width/height in CSS pixels = physical panel / display scale and devicePixelRatio = that
// scale (measured on Chrome 156, Windows 11: a 3840x2160 panel at 150% reports 2560x1440 @1.5, a maximized window has
// outer = avail = 2560x1392, inner 2560x1305, taskbar 48). So a screen is modelled as (panel, scale), CSS size =
// round(panel / scale). The Windows scale steps are:
export const WINDOWS_SCALES = Object.freeze([1, 1.25, 1.5, 1.75, 2, 2.5, 3]);
// `scales` = [scale, weight] pairs a random device may draw; the weights are hand-set heuristics (sum 100), unverified
// against telemetry (a small public sample of Windows presets was used only as a sanity reference: 1920x1080@1,
// 1920x1080@1.25 and 1920x1080@1.5 are common there, 3840x2160@1 never occurs). `userScales` = real scales that are
// offered only when the user asks for them and never drawn (a 4K panel at 100%).
const panelOf = (id, types, scales, userScales = []) => {
  const [width, height] = id.split('x').map(Number);
  return Object.freeze({ id, width, height, types: Object.freeze(types), scales: Object.freeze(scales.map(pair => Object.freeze(pair))), userScales: Object.freeze(userScales) });
};
export const SCREEN_PANELS = Object.freeze([
  panelOf('1366x768', ['laptop'], [[1, 100]]),
  panelOf('1920x1080', ['laptop', 'desktop'], [[1, 55], [1.25, 30], [1.5, 15]]),
  panelOf('1920x1200', ['laptop', 'desktop'], [[1, 55], [1.25, 45]]),
  panelOf('2560x1440', ['desktop'], [[1, 50], [1.25, 25], [1.5, 25]]),
  panelOf('3840x2160', ['desktop'], [[1.5, 45], [1.75, 15], [2, 40]], [1]),
]);
const scalesOf = panel => [...panel.scales.map(([scale]) => scale), ...panel.userScales];
const cssSize = (panel, scale) => ({ width: Math.round(panel.width / scale), height: Math.round(panel.height / scale) });
const screenEntry = (panel, scale, id, types) => Object.freeze({ id, ...cssSize(panel, scale), dpr: scale, scale, panel: panel.id, types: Object.freeze([...types]) });

// The slider ladder. Ids are stored in saved profiles and used by the UI, so every old id stays valid: [id, panel, default
// scale, device types]. '1536x864' is the old name of a 1920x1080 panel at 125%. '3840x2160' now defaults to 150%
// (it used to be an unscaled 3840x2160, which a real Windows machine does not usually report).
const RUNGS = [
  ['1366x768', '1366x768', 1, ['laptop']],
  ['1536x864', '1920x1080', 1.25, ['laptop', 'desktop']],
  ['1920x1080', '1920x1080', 1, ['laptop', 'desktop']],
  ['1920x1200', '1920x1200', 1, ['laptop', 'desktop']],
  ['2560x1440', '2560x1440', 1, ['desktop']],
  ['3840x2160', '3840x2160', 1.5, ['desktop']],
];
const panelById = id => SCREEN_PANELS.find(panel => panel.id === id);
// Common desktop/laptop resolutions with realistic DPR; `width`/`height`/`dpr` are the CSS size and scale of the default.
export const SCREEN_PRESETS = Object.freeze(RUNGS.map(([id, panelId, scale, types]) => screenEntry(panelById(panelId), scale, id, types)));
// The ladder id that names a (panel, scale) pair: a rung when one has exactly that scale, else the panel id.
const screenIdFor = (panelId, scale) => SCREEN_PRESETS.find(entry => entry.panel === panelId && entry.scale === scale)?.id ?? panelId;
// Scales a screen id may use (drawn plus user-only); [] for an unknown id.
export function screenScalesFor(screenId) {
  const rung = SCREEN_PRESETS.find(entry => entry.id === screenId);
  return rung ? scalesOf(panelById(rung.panel)) : [];
}
// One screen as the generator writes it. `scale` overrides the default scale only when that panel really has it.
export function resolveScreen(screenId, scale) {
  const rung = SCREEN_PRESETS.find(entry => entry.id === screenId);
  if (!rung) return null;
  const panel = panelById(rung.panel), used = typeof scale === 'number' && scalesOf(panel).includes(scale) ? scale : rung.scale;
  return used === rung.scale ? rung : screenEntry(panel, used, screenIdFor(panel.id, used), panel.types);
}
// Inverse of the above for the level controls: which ladder id (and scale) do these screen values describe? The old ladder
// matched on CSS size alone, so that stays the fallback and every old saved value is still described.
function identifyScreen(width, height, dpr) {
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  if (typeof dpr === 'number') {
    for (const entry of SCREEN_PRESETS) if (entry.width === width && entry.height === height && entry.scale === dpr) return entry;
    for (const panel of SCREEN_PANELS) for (const scale of scalesOf(panel)) {
      const css = cssSize(panel, scale);
      if (scale === dpr && css.width === width && css.height === height) return resolveScreen(screenIdFor(panel.id, scale), scale);
    }
  }
  return SCREEN_PRESETS.find(entry => entry.width === width && entry.height === height) ?? null;
}

// --- Windows GPU catalogue ------------------------------------------------------------------------------------------
// 50 adapters. Chrome masks VENDOR/RENDERER as WebKit and exposes the ANGLE-on-Windows
// string only through the unmasked pair (37445/37446), so vendor/renderer stay 'WebKit'/'WebKit WebGL' and the identity
// lives in unmaskedVendor/unmaskedRenderer. The renderer has the form Chrome prints for Direct3D 11:
//   ANGLE (<vendor>, <adapter description> (0x<PCI device id, 8 hex digits>) Direct3D11 vs_5_0 ps_5_0, D3D11)
// and the vendor is 'Google Inc. (<vendor>)'. Device ids were checked against the pci-ids database (2026-11-05); the
// adapter description is the Windows driver name of the card and cannot be read from that database. `performance`
// (1 office … 4 high end) keeps cores, screen and RAM plausible for the card; `weight` is a hand-set relative
// popularity (not a measurement) so a random profile is a common one rather than a rare one.
//
// `threads` = hardwareConcurrency values a machine with this card can have, from the public CPU lineups of the card's
// generation and form factor (desktop vs laptop). HEURISTIC, unverified against telemetry; values are limited to the
// CPU_STEPS ladder, so exact counts such as 10, 14 or 22 threads are not representable (Meteor Lake keeps only 18).
// `architecture` = the WebGPU adapter.info.architecture string Chrome (Dawn) prints for the card's generation. Only
// `turing` was measured (Chrome 156, RTX 2080 SUPER: {vendor:'nvidia', architecture:'turing', device:'', description:''});
// every other mapping is a heuristic from the card's generation and the Dawn vocabulary (see WEBGPU_ARCHITECTURES).
const card = (id, vendor, description, deviceId, types, performance, weight, threads, architecture, label = description.replace(/\((?:R|TM)\)/gu, '').replace(/\s+/gu, ' ').trim()) => Object.freeze({
  id, label, vendorFamily: vendor.toLowerCase(), types: Object.freeze(types), performance, weight,
  tier: /UHD Graphics|HD Graphics|Iris\(R\)|Radeon\(TM\) Graphics|Arc\(TM\) Graphics$/u.test(description) ? 'integrated' : 'discrete',
  threads: Object.freeze(threads), webgpu: Object.freeze({ vendor: vendor.toLowerCase(), architecture }),
  webgl: Object.freeze({ vendor: 'WebKit', renderer: 'WebKit WebGL', unmaskedVendor: `Google Inc. (${vendor})`,
    unmaskedRenderer: `ANGLE (${vendor}, ${description} (0x${deviceId.toString(16).toUpperCase().padStart(8, '0')}) Direct3D11 vs_5_0 ps_5_0, D3D11)` }),
});
export const GPU_PRESETS = Object.freeze([
  card('nvidia-gtx-1060', 'NVIDIA', 'NVIDIA GeForce GTX 1060 6GB', 0x1C03, ['desktop'], 2, 5, [4, 6, 8, 12, 16], 'pascal'),
  card('nvidia-gtx-1650', 'NVIDIA', 'NVIDIA GeForce GTX 1650', 0x1F82, ['desktop'], 2, 8, [4, 6, 8, 12, 16], 'turing'),
  card('nvidia-gtx-1660-super', 'NVIDIA', 'NVIDIA GeForce GTX 1660 SUPER', 0x21C4, ['desktop'], 2, 5, [6, 8, 12, 16], 'turing'),
  card('nvidia-rtx-2060', 'NVIDIA', 'NVIDIA GeForce RTX 2060', 0x1F08, ['desktop'], 3, 6, [6, 8, 12, 16, 20], 'turing'),
  card('nvidia-rtx-2070-super', 'NVIDIA', 'NVIDIA GeForce RTX 2070 SUPER', 0x1E84, ['desktop'], 4, 3, [8, 12, 16, 20], 'turing'),
  card('nvidia-rtx-2080-super', 'NVIDIA', 'NVIDIA GeForce RTX 2080 SUPER', 0x1E81, ['desktop'], 4, 2, [8, 12, 16, 20, 24], 'turing'),
  card('nvidia-rtx-3050', 'NVIDIA', 'NVIDIA GeForce RTX 3050', 0x2507, ['desktop'], 2, 5, [6, 8, 12, 16], 'ampere'),
  card('nvidia-rtx-3060', 'NVIDIA', 'NVIDIA GeForce RTX 3060', 0x2503, ['desktop'], 3, 10, [8, 12, 16, 20, 24], 'ampere'),
  card('nvidia-rtx-3060-ti', 'NVIDIA', 'NVIDIA GeForce RTX 3060 Ti', 0x2486, ['desktop'], 3, 6, [12, 16, 20, 24], 'ampere'),
  card('nvidia-rtx-3070', 'NVIDIA', 'NVIDIA GeForce RTX 3070', 0x2484, ['desktop'], 4, 5, [12, 16, 20, 24], 'ampere'),
  card('nvidia-rtx-3080', 'NVIDIA', 'NVIDIA GeForce RTX 3080', 0x2206, ['desktop'], 4, 3, [12, 16, 20, 24, 32], 'ampere'),
  card('nvidia-rtx-4060', 'NVIDIA', 'NVIDIA GeForce RTX 4060', 0x2882, ['desktop'], 3, 8, [8, 12, 16, 20, 24], 'lovelace'),
  card('nvidia-rtx-4060-ti', 'NVIDIA', 'NVIDIA GeForce RTX 4060 Ti', 0x2803, ['desktop'], 3, 4, [12, 16, 20, 24], 'lovelace'),
  card('nvidia-rtx-4070', 'NVIDIA', 'NVIDIA GeForce RTX 4070', 0x2786, ['desktop'], 4, 5, [12, 16, 20, 24, 32], 'lovelace'),
  card('nvidia-rtx-4080', 'NVIDIA', 'NVIDIA GeForce RTX 4080', 0x2704, ['desktop'], 4, 2, [16, 20, 24, 32], 'lovelace'),
  card('nvidia-gtx-1650-ti-laptop', 'NVIDIA', 'NVIDIA GeForce GTX 1650 Ti', 0x1F95, ['laptop'], 2, 3, [8, 12, 16], 'turing'),
  card('nvidia-rtx-3050-laptop', 'NVIDIA', 'NVIDIA GeForce RTX 3050 Laptop GPU', 0x25A2, ['laptop'], 2, 5, [12, 16, 20], 'ampere'),
  card('nvidia-rtx-3050-ti-laptop', 'NVIDIA', 'NVIDIA GeForce RTX 3050 Ti Laptop GPU', 0x25A0, ['laptop'], 2, 3, [12, 16, 20], 'ampere'),
  card('nvidia-rtx-3060-laptop', 'NVIDIA', 'NVIDIA GeForce RTX 3060 Laptop GPU', 0x2520, ['laptop'], 3, 7, [12, 16, 20], 'ampere'),
  card('nvidia-rtx-3070-laptop', 'NVIDIA', 'NVIDIA GeForce RTX 3070 Laptop GPU', 0x249D, ['laptop'], 4, 3, [16, 20, 24], 'ampere'),
  card('nvidia-rtx-3080-laptop', 'NVIDIA', 'NVIDIA GeForce RTX 3080 Laptop GPU', 0x249C, ['laptop'], 4, 2, [16, 20, 24], 'ampere'),
  card('nvidia-rtx-4050-laptop', 'NVIDIA', 'NVIDIA GeForce RTX 4050 Laptop GPU', 0x28A1, ['laptop'], 3, 4, [12, 16, 20], 'lovelace'),
  card('nvidia-rtx-4060-laptop', 'NVIDIA', 'NVIDIA GeForce RTX 4060 Laptop GPU', 0x28E0, ['laptop'], 3, 6, [12, 16, 20, 24], 'lovelace'),
  card('nvidia-rtx-4070-laptop', 'NVIDIA', 'NVIDIA GeForce RTX 4070 Laptop GPU', 0x2860, ['laptop'], 4, 3, [16, 20, 24, 32], 'lovelace'),
  card('amd-rx-580', 'AMD', 'Radeon RX 580 Series', 0x67DF, ['desktop'], 2, 4, [4, 6, 8, 12, 16], 'gcn-4', 'AMD Radeon RX 580'),
  card('amd-rx-5500-xt', 'AMD', 'AMD Radeon RX 5500 XT', 0x7340, ['desktop'], 2, 2, [6, 8, 12, 16], 'rdna-1'),
  card('amd-rx-5700-xt', 'AMD', 'AMD Radeon RX 5700 XT', 0x731F, ['desktop'], 3, 3, [8, 12, 16, 20, 24], 'rdna-1'),
  card('amd-rx-6600', 'AMD', 'AMD Radeon RX 6600', 0x73FF, ['desktop'], 3, 4, [8, 12, 16, 20, 24], 'rdna-2'),
  card('amd-rx-6700-xt', 'AMD', 'AMD Radeon RX 6700 XT', 0x73DF, ['desktop'], 4, 3, [12, 16, 20, 24], 'rdna-2'),
  card('amd-rx-6800-xt', 'AMD', 'AMD Radeon RX 6800 XT', 0x73BF, ['desktop'], 4, 2, [12, 16, 20, 24, 32], 'rdna-2'),
  card('amd-rx-7600', 'AMD', 'AMD Radeon RX 7600', 0x7480, ['desktop'], 3, 3, [8, 12, 16, 20, 24], 'rdna-3'),
  card('amd-rx-7800-xt', 'AMD', 'AMD Radeon RX 7800 XT', 0x747E, ['desktop'], 4, 2, [12, 16, 20, 24, 32], 'rdna-3'),
  card('amd-radeon-renoir', 'AMD', 'AMD Radeon(TM) Graphics', 0x1636, ['laptop'], 1, 4, [4, 6, 8, 12, 16], 'gcn-5', 'AMD Radeon Graphics (Renoir)'),
  card('amd-radeon-cezanne', 'AMD', 'AMD Radeon(TM) Graphics', 0x1638, ['laptop', 'desktop'], 1, 5, [8, 12, 16], 'gcn-5', 'AMD Radeon Graphics (Cezanne)'),
  card('amd-radeon-rembrandt', 'AMD', 'AMD Radeon(TM) Graphics', 0x1681, ['laptop'], 1, 3, [12, 16], 'rdna-2', 'AMD Radeon Graphics (Rembrandt)'),
  card('intel-hd-620', 'Intel', 'Intel(R) HD Graphics 620', 0x5916, ['laptop'], 1, 5, [4], 'gen-9'),
  card('intel-hd-630', 'Intel', 'Intel(R) HD Graphics 630', 0x5912, ['desktop'], 1, 4, [4, 8], 'gen-9'),
  card('intel-uhd-620', 'Intel', 'Intel(R) UHD Graphics 620', 0x5917, ['laptop'], 1, 8, [4, 8], 'gen-9'),
  card('intel-uhd-630', 'Intel', 'Intel(R) UHD Graphics 630', 0x3E92, ['desktop'], 1, 8, [4, 6, 8, 12, 16, 20], 'gen-9'),
  card('intel-uhd-730', 'Intel', 'Intel(R) UHD Graphics 730', 0x4692, ['desktop'], 1, 3, [8, 12, 16], 'gen-12lp'),
  card('intel-uhd-770', 'Intel', 'Intel(R) UHD Graphics 770', 0x4680, ['desktop'], 1, 4, [12, 16, 20, 24], 'gen-12lp'),
  card('intel-uhd-comet-lake', 'Intel', 'Intel(R) UHD Graphics', 0x9BC4, ['laptop'], 1, 3, [8, 12, 16], 'gen-9', 'Intel UHD Graphics (Comet Lake)'),
  card('intel-iris-plus', 'Intel', 'Intel(R) Iris(R) Plus Graphics', 0x8A52, ['laptop'], 1, 2, [4, 8], 'gen-11'),
  card('intel-iris-xe', 'Intel', 'Intel(R) Iris(R) Xe Graphics', 0x9A49, ['laptop'], 1, 8, [4, 8], 'gen-12lp'),
  card('intel-iris-xe-alder-lake', 'Intel', 'Intel(R) Iris(R) Xe Graphics', 0x46A6, ['laptop'], 1, 6, [12, 16], 'gen-12lp', 'Intel Iris Xe Graphics (Alder Lake)'),
  card('intel-iris-xe-raptor-lake', 'Intel', 'Intel(R) Iris(R) Xe Graphics', 0xA7A0, ['laptop'], 1, 5, [12, 16], 'gen-12lp', 'Intel Iris Xe Graphics (Raptor Lake)'),
  card('intel-arc-a380', 'Intel', 'Intel(R) Arc(TM) A380 Graphics', 0x56A5, ['desktop'], 2, 1, [6, 8, 12, 16], 'gen-12hp'),
  card('intel-arc-a750', 'Intel', 'Intel(R) Arc(TM) A750 Graphics', 0x56A1, ['desktop'], 3, 1, [8, 12, 16, 20, 24], 'gen-12hp'),
  card('intel-arc-a770', 'Intel', 'Intel(R) Arc(TM) A770 Graphics', 0x56A0, ['desktop'], 3, 1, [12, 16, 20, 24], 'gen-12hp'),
  card('intel-arc-graphics', 'Intel', 'Intel(R) Arc(TM) Graphics', 0x7D55, ['laptop'], 1, 3, [18], 'xe-lpg', 'Intel Arc Graphics (Meteor Lake)'),
]);

// Dawn's WebGPU adapter.info.architecture vocabulary (strings found in Chrome 156's chrome.dll; "pascal" and "ampere" were
// only seen merged into longer strings, so those two are inferred and unverified). A card's `webgpu.architecture` and the
// coherence rule `gpu-shape` use it.
export const WEBGPU_ARCHITECTURES = Object.freeze({
  nvidia: Object.freeze(['fermi', 'kepler', 'maxwell', 'pascal', 'volta', 'turing', 'ampere', 'lovelace', 'blackwell']),
  amd: Object.freeze(['terascale-2', 'gcn-1', 'gcn-2', 'gcn-3', 'gcn-4', 'gcn-5', 'rdna-1', 'rdna-2', 'rdna-3', 'rdna-4', 'cdna-1']),
  intel: Object.freeze(['gen-7', 'gen-8', 'gen-9', 'gen-11', 'gen-12lp', 'gen-12hp', 'xe-lpg', 'xe-2lpg', 'xe-2hpg', 'xe-3lpg', 'xe-3lpg-xs']),
});

// D3D11 feature-level 11_x caps are the same for every GPU class on Chrome/ANGLE/Windows
// (texture/renderbuffer/cubemap 16384, fragment texture units 16); higher values are both
// unreachable and dead (the runtime clamps to native). We standardize to these realistic
// values and omit `extensions` entirely so the native WebGL extension list — including
// WEBGL_debug_renderer_info, needed to read the unmasked renderer — passes through.
const WEBGL_CAPS = Object.freeze({ parameters: { MAX_TEXTURE_SIZE: 16384, MAX_RENDERBUFFER_SIZE: 16384, MAX_VIEWPORT_DIMS: [32767, 32767], MAX_CUBE_MAP_TEXTURE_SIZE: 16384, MAX_VERTEX_ATTRIBS: 16, MAX_TEXTURE_IMAGE_UNITS: 16 } });

// Windows font baseline (Отчёт: standardize the available set per OS). The names live in fingerprint-font-groups.js:
// core always, the Windows 11 names only when Windows 11 is claimed, Office and Pan-European only on request.
const FONT_FALLBACK = 'sans-serif';
export const FONT_BASELINE = Object.freeze({ families: Object.freeze(windowsFonts()), fallback: FONT_FALLBACK });
// The fixed 14-name list written before the font groups existed: saved profiles that still hold it are described as Windows fonts.
const LEGACY_FONT_FAMILIES = Object.freeze(['Arial', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Impact', 'Lucida Console', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana']);
// The five platform aliases that joined the core group on 2026-11-07 (owner decision, ADR-110 addendum). A profile generated before that holds the
// core list without them; it is still the Windows list.
const ALIASES_ADDED = Object.freeze(['Courier', 'Helvetica', 'MS Sans Serif', 'MS Serif', 'Times']);
// The lists a Windows claim can hold: the eight choices of Windows 11 / Office / Pan-European, each without a regional group or with one of the four regional
// CJK groups (ADR-110 addendum 2): 40. `model` (the noise units of the list, fingerprint-font-noise.js, with the roots that the claimed region locks) is built
// on first use.
function fontCombo(groups, regionGroup, without = []) {
  const list = Object.freeze(windowsFonts({ ...groups, regionGroup }).filter(name => !without.includes(name)));
  let model = null;
  return Object.freeze({ groups, region: regionGroup, list, json: JSON.stringify(list), get model() { return model ??= fontNoiseModel(list, regionFontRoots(regionGroup)); } });
}
const FONT_COMBO_GROUPS = Object.freeze([false, true].flatMap(windows11 => [false, true].flatMap(office => [false, true].map(panEuropean => Object.freeze({ windows11, office, panEuropean })))));
const FONT_COMBOS = Object.freeze(FONT_COMBO_GROUPS.flatMap(groups => [null, ...REGION_FONT_GROUP_KEYS].map(regionGroup => fontCombo(groups, regionGroup))));
const PRIOR_FONT_COMBOS = Object.freeze(FONT_COMBO_GROUPS.map(groups => fontCombo(groups, null, ALIASES_ADDED)));

// Chromium derives the GREASE brand, its version and the brand order from the major version
// (components/embedder_support/user_agent_utils.cc, checked against native Chromium 153 = "Not_A Brand" 8);
// a fixed token or a fixed order is itself a detection signal.
const GREASE_CHARS = Object.freeze([' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_']);
const GREASE_VERSIONS = Object.freeze(['8', '99', '24']);
const BRAND_ORDERS = Object.freeze([[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]);
// userAgentData.platformVersion on Windows: 10.x or lower is Windows 10, 13 or higher is Windows 11. A Windows 11 claim
// defaults to 19.0.0 (24H2/25H2), measured on Windows 11 build 26200 only (Chrome 156 and Edge 156); older 11 builds
// report 13.0.0 .. 15.0.0 and keep working because every major >= 13 is read as Windows 11.
const WIN11_PLATFORM_VERSION = '19.0.0';
const PLATFORM_VERSION = /^(\d{1,4})\.\d{1,5}\.\d{1,5}$/u;
const platformVersionMajor = value => typeof value === 'string' ? Number(PLATFORM_VERSION.exec(value)?.[1] ?? NaN) : NaN;
const osFromPlatformVersion = value => {
  const major = platformVersionMajor(value);
  return major >= 13 ? 'windows-11' : major >= 1 && major <= 10 ? 'windows-10' : null;
};
// Windows 11 default taskbar is 48 CSS px; Windows 10 is 40 (independent of the display scale, measured).
export const windowsTaskbar = os => (os === 'windows-11' ? 48 : 40);
// A maximized window loses this much height to tabs and toolbar, per brand (measured on Windows 11: Chrome 156 87 CSS px,
// Edge 156 84; a non-maximized window 94); the coherence rule `window-chrome` warns below WINDOW_CHROME_MIN.
export const BROWSER_CHROME_HEIGHTS = Object.freeze({ chrome: 87, edge: 84 });
export const browserChromeHeight = brand => BROWSER_CHROME_HEIGHTS[brand === 'edge' ? 'edge' : 'chrome'];
export const WINDOW_CHROME_MIN = 80;

// --- Real browser facts (optional input, all fields optional) ------------------------------------------------------
// Plain data about the browser that is running the picker: { uaMajor, brand 'chrome'|'edge', platform 'windows'|'mac'|'linux',
// platformVersion, uaFullVersion, fullVersionList [{brand, version}], hardwareConcurrency, screen {width, height, availWidth,
// availHeight, colorDepth}, devicePixelRatio, outer {width, height}, timeZone }. It is only used to keep a claim from
// contradicting what a page can measure anyway; it never reaches a page, a report or storage. Every field is validated and
// bounded, anything else is dropped, accessors are never invoked. Several sources may be merged (first valid value wins);
// the older snapshot shape (userAgent, platform 'Win32', uaData) is understood too.
// ADR-107 (b) adds, all optional: deviceMemory (0 < n <= 1024), jsHeapSizeLimit (safe integer), gpu { vendor, renderer (1..512
// chars), caps { GPU_CAP_KEYS: integers 1..2^20, MAX_VIEWPORT_DIMS a pair }, webgl2 boolean, webgpu: null (a fact: no adapter) |
// { vendor, architecture (0..128 chars), subgroupMinSize, subgroupMaxSize (1..1024), isFallbackAdapter boolean } },
// proxy { state: 'connected'|'disconnected'|'conflict'|'unknown' } and pdfViewerEnabled boolean.
const own = (object, key) => object !== null && typeof object === 'object' ? Object.getOwnPropertyDescriptor(object, key)?.value : undefined;
const intBetween = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
const boundedText = (value, min, max) => typeof value === 'string' && value.length >= min && value.length <= max ? value : undefined;
export const GPU_CAP_KEYS = Object.freeze(['MAX_TEXTURE_SIZE', 'MAX_VIEWPORT_DIMS', 'MAX_RENDERBUFFER_SIZE', 'MAX_SAMPLES', 'MAX_COMBINED_TEXTURE_IMAGE_UNITS', 'MAX_VERTEX_UNIFORM_VECTORS']);
export const PROXY_STATES = Object.freeze(['connected', 'disconnected', 'conflict', 'unknown']);
const GPU_CAP_MAX = 1 << 20;
function readWebGpuFacts(value) {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out = {}, put = (key, raw) => { if (raw !== undefined) out[key] = raw; }, fallback = own(value, 'isFallbackAdapter');
  put('vendor', boundedText(own(value, 'vendor'), 0, 128)); put('architecture', boundedText(own(value, 'architecture'), 0, 128));
  put('subgroupMinSize', intBetween(own(value, 'subgroupMinSize'), 1, 1024)); put('subgroupMaxSize', intBetween(own(value, 'subgroupMaxSize'), 1, 1024));
  put('isFallbackAdapter', typeof fallback === 'boolean' ? fallback : undefined);
  return Object.keys(out).length ? Object.freeze(out) : undefined;
}
function readGpu(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out = {}, caps = {}, source = own(value, 'caps'), webgl2 = own(value, 'webgl2');
  const vendor = boundedText(own(value, 'vendor'), 1, 512), renderer = boundedText(own(value, 'renderer'), 1, 512);
  if (vendor !== undefined) out.vendor = vendor;
  if (renderer !== undefined) out.renderer = renderer;
  for (const key of GPU_CAP_KEYS) {
    const raw = own(source, key);
    if (key !== 'MAX_VIEWPORT_DIMS') { const number = intBetween(raw, 1, GPU_CAP_MAX); if (number !== undefined) caps[key] = number; continue; }
    if (!Array.isArray(raw) || raw.length !== 2) continue;
    const pair = [intBetween(own(raw, 0), 1, GPU_CAP_MAX), intBetween(own(raw, 1), 1, GPU_CAP_MAX)];
    if (pair[0] !== undefined && pair[1] !== undefined) caps[key] = Object.freeze(pair);
  }
  if (Object.keys(caps).length) out.caps = Object.freeze(caps);
  if (typeof webgl2 === 'boolean') out.webgl2 = webgl2;
  if (Object.hasOwn(value, 'webgpu')) { const webgpu = readWebGpuFacts(own(value, 'webgpu')); if (webgpu !== undefined) out.webgpu = webgpu; }
  return Object.keys(out).length ? Object.freeze(out) : undefined;
}
// GPU vendor family named by a WebGL/WebGPU vendor or renderer string; null when it names none of the three (or a software one).
export function gpuFamily(text) {
  if (typeof text !== 'string') return null;
  return /\bnvidia\b/iu.test(text) ? 'nvidia' : /\bintel\b/iu.test(text) ? 'intel' : /\b(?:amd|ati)\b/iu.test(text) ? 'amd' : null;
}
// Software renderers (SwiftShader, WARP / Microsoft Basic Render Driver, llvmpipe) and a WebGPU fallback adapter.
export const SOFTWARE_RENDERER = /SwiftShader|Basic Render|llvmpipe|softpipe|\bWARP\b/iu;
export const realGpuSoftware = gpu => !!gpu && (SOFTWARE_RENDERER.test(gpu.renderer ?? '') || SOFTWARE_RENDERER.test(gpu.vendor ?? '') || gpu.webgpu?.isFallbackAdapter === true);
// The vendor family of THIS browser's GPU (null when unknown or software).
export function realGpuFamily(gpu) {
  if (!gpu || realGpuSoftware(gpu)) return null;
  return gpuFamily(gpu.vendor) ?? gpuFamily(gpu.renderer) ?? gpuFamily(gpu.webgpu?.vendor);
}
// Is the identity a page sees Chromium? The claimed User-Agent decides when one is set; without it THIS browser does (a Chrome or
// Edge brand or major in the environment); with neither known the answer is false.
export function chromiumIdentity(agent, environment) {
  if (typeof agent === 'string') return /\b(?:Chrome|Chromium)\/\d/u.test(agent) && !/\bFirefox\/\d/u.test(agent);
  const real = normalizeEnvironment(environment);
  return real.brand !== undefined || real.uaMajor !== undefined;
}
// navigator.deviceMemory of THIS browser as an upper bound of a claim: Chrome before 147 reports at most 8 for every machine with
// 8 GB or more, so 8 from such (or an unknown) version bounds nothing.
export function memoryBound(environment) {
  const real = normalizeEnvironment(environment);
  if (real.deviceMemory === undefined) return undefined;
  return real.deviceMemory >= 8 && !(real.uaMajor >= 147) ? undefined : real.deviceMemory;
}
const FULL_VERSION = /^\d{1,4}(?:\.\d{1,5}){1,3}$/u;
const LIST_VERSION = /^\d{1,4}(?:\.\d{1,5}){0,3}$/u;
function platformFamily(value) {
  if (typeof value !== 'string' || value.length > 64) return undefined;
  return /^win/iu.test(value) ? 'windows' : /^(?:mac|darwin)/iu.test(value) ? 'mac' : /^(?:linux|x11|cros)/iu.test(value) ? 'linux' : undefined;
}
function readList(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) return undefined;
  const list = [], seen = new Set();
  for (let index = 0; index < value.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(value, index)?.value, brand = own(entry, 'brand'), version = own(entry, 'version');
    if (typeof brand !== 'string' || brand.length < 1 || brand.length > 128 || seen.has(brand) || typeof version !== 'string' || !LIST_VERSION.test(version)) return undefined;
    seen.add(brand); list.push(Object.freeze({ brand, version }));
  }
  return Object.freeze(list);
}
function readBox(value, keys, min, max) {
  const out = {};
  for (const key of keys) { const part = intBetween(own(value, key), min, max); if (part !== undefined) out[key] = part; }
  return Object.keys(out).length ? Object.freeze(out) : undefined;
}
export function normalizeEnvironment(...sources) {
  const out = {};
  for (const source of sources) {
    if (source === null || typeof source !== 'object' || Array.isArray(source)) continue;
    const agent = own(source, 'userAgent'), hints = own(source, 'uaData'), brands = own(hints, 'brands');
    const put = (key, value) => { if (out[key] === undefined && value !== undefined) out[key] = value; };
    const agentText = typeof agent === 'string' && agent.length <= 4096 ? agent : '';
    const agentBrand = /Edg\/\d/u.test(agentText) ? 'edge' : /Chrome\/\d/u.test(agentText) ? 'chrome' : undefined;
    const hintNames = Array.isArray(brands) ? Array.from({ length: Math.min(brands.length, 16) }, (_, index) => own(Object.getOwnPropertyDescriptor(brands, index)?.value, 'brand')) : [];
    const hintBrand = hintNames.includes('Microsoft Edge') ? 'edge' : hintNames.includes('Google Chrome') ? 'chrome' : undefined;
    const claimedBrand = own(source, 'brand');
    put('uaMajor', intBetween(own(source, 'uaMajor'), 1, 999) ?? intBetween(Number(/Chrome\/(\d{1,3})\./u.exec(agentText)?.[1]), 1, 999));
    put('brand', claimedBrand === 'chrome' || claimedBrand === 'edge' ? claimedBrand : agentBrand ?? hintBrand);
    put('platform', platformFamily(own(source, 'platform')) ?? platformFamily(own(hints, 'platform')));
    const platformVersion = own(source, 'platformVersion'), fullVersion = own(source, 'uaFullVersion');
    put('platformVersion', typeof platformVersion === 'string' && PLATFORM_VERSION.test(platformVersion) ? platformVersion : undefined);
    put('uaFullVersion', typeof fullVersion === 'string' && FULL_VERSION.test(fullVersion) ? fullVersion : undefined);
    put('fullVersionList', readList(own(source, 'fullVersionList')));
    put('hardwareConcurrency', intBetween(own(source, 'hardwareConcurrency'), 1, 1024));
    const screenBox = own(source, 'screen'), dims = readBox(screenBox, ['width', 'height', 'availWidth', 'availHeight'], 1, 32768), depth = readBox(screenBox, ['colorDepth'], 1, 64);
    put('screen', dims || depth ? Object.freeze({ ...dims, ...depth }) : undefined);
    const ratio = own(source, 'devicePixelRatio');
    put('devicePixelRatio', typeof ratio === 'number' && Number.isFinite(ratio) && ratio >= 0.1 && ratio <= 16 ? ratio : undefined);
    const outer = readBox(own(source, 'outer'), ['width', 'height'], 1, 32768);
    put('outer', outer && outer.width !== undefined && outer.height !== undefined ? outer : undefined);
    const zone = own(source, 'timeZone');
    put('timeZone', typeof zone === 'string' && zone.length >= 1 && zone.length <= 128 ? zone : undefined);
    const memory = own(source, 'deviceMemory'), pdf = own(source, 'pdfViewerEnabled'), proxyState = own(own(source, 'proxy'), 'state');
    put('deviceMemory', typeof memory === 'number' && Number.isFinite(memory) && memory > 0 && memory <= 1024 ? memory : undefined);
    put('jsHeapSizeLimit', intBetween(own(source, 'jsHeapSizeLimit'), 1, Number.MAX_SAFE_INTEGER));
    put('gpu', readGpu(own(source, 'gpu')));
    put('proxy', PROXY_STATES.includes(proxyState) ? Object.freeze({ state: proxyState }) : undefined);
    put('pdfViewerEnabled', typeof pdf === 'boolean' ? pdf : undefined);
  }
  return Object.freeze(out);
}

function userAgent(browser, version) {
  const base = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`;
  return browser === 'edge' ? `${base} Edg/${version}.0.0.0` : base;
}
function brands(browser, major, full = false) {
  const v = full ? `${major}.0.0.0` : String(major);
  const grease = { brand: 'Not' + GREASE_CHARS[major % 11] + 'A' + GREASE_CHARS[(major + 1) % 11] + 'Brand', version: GREASE_VERSIONS[major % 3] + (full ? '.0.0.0' : '') };
  const items = [grease, { brand: 'Chromium', version: v }, { brand: browser === 'edge' ? 'Microsoft Edge' : 'Google Chrome', version: v }], out = [];
  BRAND_ORDERS[major % 6].forEach((slot, index) => { out[slot] = items[index]; });
  return out;
}
// The browser's own build numbers are used only when the claim IS this browser (same major, same brand, Windows): the
// HTTP Sec-CH-UA-* headers carry the real values and cannot be changed, so equal JS values avoid a JS-vs-header
// contradiction. For any other claim the build part is ${major}.0.0.0 (lower fidelity: the real build of the claimed
// browser is unknown, only the major is checkable).
function claimedBuilds(browser, major, environment) {
  const real = environment.uaMajor === major && environment.brand === browser && environment.platform === 'windows';
  const brandName = browser === 'edge' ? 'Microsoft Edge' : 'Google Chrome', otherName = browser === 'edge' ? 'Google Chrome' : 'Microsoft Edge';
  const list = real ? environment.fullVersionList : undefined;
  const listUsable = list !== undefined && list.some(entry => entry.brand === 'Chromium' && entry.version.startsWith(major + '.')) && list.some(entry => entry.brand === brandName && entry.version.startsWith(major + '.')) && !list.some(entry => entry.brand === otherName);
  const fullVersion = real && typeof environment.uaFullVersion === 'string' && environment.uaFullVersion.startsWith(major + '.') ? environment.uaFullVersion : undefined;
  return { real, fullVersionList: listUsable ? list : undefined, uaFullVersion: fullVersion, platformVersion: real ? environment.platformVersion : undefined };
}

export function gpusFor(deviceType) {
  return GPU_PRESETS.filter(gpu => gpu.types.includes(deviceType));
}
export function screensFor(deviceType) {
  return SCREEN_PRESETS.filter(screen => screen.types.includes(deviceType));
}

// Deterministic pick from a seed so the same profile reproduces the same device.
function hash(seed, salt) {
  let h = (seed ^ (salt * 2654435761)) >>> 0;
  return Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
}
function pick(list, seed, salt) { return list.length ? list[hash(seed, salt) % list.length] : undefined; }
// Weighted variant: common cards are drawn more often than rare ones.
function pickWeighted(list, seed, salt) {
  if (!list.length) return undefined;
  let ticket = hash(seed, salt) % list.reduce((sum, entry) => sum + entry.weight, 0);
  for (const entry of list) { if (ticket < entry.weight) return entry; ticket -= entry.weight; }
  return list[list.length - 1];
}
// The display scale of a panel is drawn by the panel's weights; user-only scales are never drawn. `allowed(scale)` narrows the
// draw (the caller guarantees one scale is allowed); with every scale allowed the draw is the unfiltered one.
function drawScale(panel, seed, salt, allowed = () => true) {
  const scales = panel.scales.filter(([scale]) => allowed(scale));
  let ticket = hash(seed, salt) % scales.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [scale, weight] of scales) { if (ticket < weight) return scale; ticket -= weight; }
  return scales[scales.length - 1][0];
}

// --- Fine-grained value builders -------------------------------------------------------
// Each returns [{ id, raw }] for exactly the rows it owns, so a manual change touches only
// those rows plus the ones that must stay consistent with it (ТЗ §9: dependent values sync).
export const processorValues = cores => [{ id: 'hardware-concurrency', raw: cores }];
export const memoryValues = (ramGb, chromeMajor) => [{ id: 'device-memory', raw: reportedDeviceMemory(ramGb, chromeMajor) }];
export const storageValues = diskGb => [{ id: 'storage-estimate', raw: reportedStorageQuota(diskGb) }];
// WebGL and WebGPU follow the same card: Chrome blanks adapter.info.device/description, so the WebGPU row carries only the
// vendor and the architecture (see `card`), otherwise a claimed AMD card would still show the real NVIDIA adapter there.
export function gpuValues(gpuId) {
  const gpu = GPU_PRESETS.find(entry => entry.id === gpuId) ?? GPU_PRESETS[0];
  return [{ id: 'webgl', raw: { ...gpu.webgl } }, { id: 'webgl-capabilities', raw: structuredClone(WEBGL_CAPS) },
    { id: 'webgpu', raw: { vendor: gpu.webgpu.vendor, architecture: gpu.webgpu.architecture, device: '', description: '' } }];
}
// `browser` ('chrome' | 'edge', default chrome) picks the measured tab-strip and toolbar height of a maximized window.
export function screenValues(screenId, os, { geometry = true, scale, browser = 'chrome' } = {}) {
  const screen = resolveScreen(screenId, scale) ?? SCREEN_PRESETS.find(entry => entry.id === '1920x1080');
  const availHeight = Math.max(1, screen.height - windowsTaskbar(os));
  const rows = [
    { id: 'screen-width', raw: screen.width },
    { id: 'screen-height', raw: screen.height },
    { id: 'screen-avail-width', raw: screen.width },
    { id: 'screen-avail-height', raw: availHeight },
    { id: 'screen-color-depth', raw: 24 },
    { id: 'screen-pixel-depth', raw: 24 },
    { id: 'window-device-pixel-ratio', raw: screen.dpr },
    { id: 'screen-extended', raw: false },
    { id: 'screen-orientation', raw: { type: 'landscape-primary', angle: 0 } },
  ];
  if (geometry) {
    // Window metrics stay inside the screen so inner <= outer <= avail always holds.
    const innerHeight = Math.max(1, availHeight - browserChromeHeight(browser));
    rows.push({ id: 'screen-geometry', raw: { availLeft: 0, availTop: 0, screenX: 0, screenY: 0, innerWidth: screen.width, innerHeight, outerWidth: screen.width, outerHeight: availHeight } });
    rows.push({ id: 'css-media', raw: { viewportWidth: screen.width, viewportHeight: innerHeight, resolutionDppx: screen.dpr } });
  }
  return rows;
}
export function identityValues({ os, browser, version, environment }) {
  const major = Number(version), builds = claimedBuilds(browser, major, normalizeEnvironment(environment));
  const agent = userAgent(browser, version);
  // A real Windows 11 platformVersion is kept only for a Windows 11 claim and only if it really reads as Windows 11.
  const platformVersion = os === 'windows-11' ? (osFromPlatformVersion(builds.platformVersion) === 'windows-11' ? builds.platformVersion : WIN11_PLATFORM_VERSION) : '10.0.0';
  const fullVersionList = builds.fullVersionList ? builds.fullVersionList.map(entry => ({ brand: entry.brand, version: entry.version })) : brands(browser, version, true);
  // Low-entropy brands are the same list reduced to majors, exactly as Chrome derives them.
  const lowBrands = builds.fullVersionList ? fullVersionList.map(entry => ({ brand: entry.brand, version: entry.version.split('.')[0] })) : brands(browser, version);
  return [
    { id: 'navigator-platform', raw: 'Win32' },
    { id: 'navigator-user-agent', raw: agent },
    { id: 'navigator-app-version', raw: agent.replace('Mozilla/', '') },
    { id: 'client-hints', raw: { brands: lowBrands, fullVersionList, uaFullVersion: builds.uaFullVersion ?? `${version}.0.0.0`, formFactors: ['Desktop'], mobile: false, platform: 'Windows', platformVersion, architecture: 'x86', bitness: '64', wow64: false, model: '' } },
  ];
}
// Strict canvas font allow-list for one claimed OS (see fingerprint-font-groups.js). The families array shape is the
// Custom `canvas-font-policy` value; options: { windows11, office, panEuropean } (a non-object is read as none), `region` (the claimed region as an ISO 3166-1
// code: Japan, Korea, China, Singapore, Taiwan, Hong Kong and Macao add the regional CJK group of that region, any other value adds nothing) and, optionally,
// the noise of fingerprint-font-noise.js: `noiseSeed` (an integer: leave out about 3 % of the optional names, chosen by that seed) or `followNoise` (the
// names an earlier list had left out: noise that follows them when the claimed Windows or region changes). The families of the claimed region are
// mandatory for the noise.
export const fontValues = options => {
  const regionGroup = regionFontGroup(own(options, 'region')), locked = regionFontRoots(regionGroup), seed = own(options, 'noiseSeed'), follow = own(options, 'followNoise');
  const families = windowsFonts({ windows11: own(options, 'windows11'), office: own(options, 'office'), panEuropean: own(options, 'panEuropean'), regionGroup });
  const shaped = Number.isInteger(seed) ? noisyFontList(families, seed, locked) : Array.isArray(follow) && follow.length > 0 ? followFontNoise(families, follow, locked) : families;
  return [{ id: 'canvas-font-policy', raw: { families: shaped, fallback: FONT_FALLBACK } }];
};
// The options of fontValues for one generated device: the claimed Windows, the optional groups the caller asks for (`options.fontGroups`), the noise seed when
// `options.fontNoise` is true, and the claimed region when there is one. Shared by buildDeviceValues and by the generator's region step.
export function generatedFontOptions(options, os, seed, region) {
  return { windows11: os === 'windows-11', office: own(options.fontGroups, 'office') === true, panEuropean: own(options.fontGroups, 'panEuropean') === true,
    ...(options.fontNoise === true ? { noiseSeed: seed } : {}), ...(typeof region === 'string' ? { region } : {}) };
}

// --- Strict preset: neutral Custom values instead of blocks -----------------------------------------------------------
// Owner decision 2026-11-05 (ADR-104 addendum 4): "Максимальная защита" reports the answer of a stock desktop Chrome instead of
// removing the API, because a missing API is itself a rare signal. These are TYPICAL desktop Chrome answers, NOT measured on
// this machine and not a claim about any real device: a plugged-in, full battery (what a desktop without a battery reports),
// a typical 4g link, no Bluetooth adapter and no USB/HID/serial devices, game pads or speech voices. None creates a device, voice,
// pad or paired peripheral, and none makes an API disappear. Every value is accepted by the contract validators.
// ADR-107 (measured on Chrome 156, Windows 11, this machine): performance.memory.jsHeapSizeLimit is 4395630592 with deviceMemory 32,
// so the heap row is written ONLY for that measured class (see MEASURED_HEAP); other majors and memory sizes are not measured and
// keep the row native instead of an invented tier. Its total/used numbers are the measured light-page catalogue preset; the runtime
// passes the native used/total through, clamped to the limit. `clock-precision` 0.1 ms is Chrome's own performance.now() step. The
// network value is the typical Chrome-possible catalogue preset, given raw: the runtime rounds it per host the way Chrome does.
// Every value is a preset of its row in catalogue 8. Honest limits: an empty voice list is a rarer answer on Windows, where Chrome
// normally lists system voices (the contract's language filter would keep real ones); `gamepads` keeps the native array length
// filled with null, as the runtime does.
export const MEASURED_HEAP = Object.freeze({ chromeMajor: 156, minDeviceMemory: 16, value: Object.freeze({ jsHeapSizeLimit: 4395630592, totalJSHeapSize: 1573038, usedJSHeapSize: 1092582 }) });
// claim = { chromeMajor, reportedMemory }: the Chromium major and the navigator.deviceMemory bucket of the claimed device.
export const heapClassMeasured = claim => !!claim && claim.chromeMajor === MEASURED_HEAP.chromeMajor && Number(claim.reportedMemory) >= MEASURED_HEAP.minDeviceMemory;
const NEUTRAL_SENSOR_TABLE = Object.freeze([
  Object.freeze({ id: 'battery', raw: Object.freeze({ charging: true, chargingTime: 0, dischargingTime: null, level: 1 }) }),
  Object.freeze({ id: 'network-information', raw: Object.freeze({ downlink: 1.5, effectiveType: '4g', rtt: 100, saveData: false }) }),
  Object.freeze({ id: 'performance-memory', raw: MEASURED_HEAP.value }),
  Object.freeze({ id: 'bluetooth', raw: Object.freeze({ available: false, devices: Object.freeze([]) }) }),
  Object.freeze({ id: 'usb', raw: Object.freeze([]) }),
  Object.freeze({ id: 'hid', raw: Object.freeze([]) }),
  Object.freeze({ id: 'serial', raw: Object.freeze([]) }),
  Object.freeze({ id: 'gamepads', raw: Object.freeze([]) }),
  Object.freeze({ id: 'speech-voices', raw: Object.freeze([]) }),
  Object.freeze({ id: 'clock-precision', raw: Object.freeze({ resolutionMs: 0.1 }) }),
]);
// Fresh [{ id, raw }] copies for the guarded setter (the table itself is frozen). With a claim the heap row is kept only for the
// measured class; without one (null) every row Strict can ever write is listed (the lighter presets use that list to take them back).
export const neutralSensorValues = (claim = null) => NEUTRAL_SENSOR_TABLE
  .filter(({ id }) => id !== 'performance-memory' || claim === null || heapClassMeasured(claim))
  .map(({ id, raw }) => ({ id, raw: structuredClone(raw) }));
// The rows Strict still blocks, and the only reason: the contract has NO Custom shape for them (catalogue customSupported is
// false), so there is no neutral value to report. If the contract ever gains a shape, add the value to the table above, drop
// the id here and update the test that pins this exception (scripts/test/fingerprint-strict-neutral.test.mjs).
export const STRICT_BLOCK_ONLY = Object.freeze(['compute-pressure', 'generic-sensors', 'device-motion']);

// Rows owned by each manual control; `null` in a patch returns exactly these to «as in preset».
// `region` owns the time zone, the language pair and the Custom geolocation; its Intl locale and zone live inside the shared
// `intl-formatting` row, whose other keys (calendar, numbering system) the control never touches.
export const DEVICE_ROW_GROUPS = Object.freeze({
  cores: ['hardware-concurrency'], ramGb: ['device-memory'], diskGb: ['storage-estimate'],
  gpu: ['webgl', 'webgl-capabilities', 'webgpu'], fonts: ['canvas-font-policy'],
  screen: ['screen-width', 'screen-height', 'screen-avail-width', 'screen-avail-height', 'screen-color-depth', 'screen-pixel-depth', 'window-device-pixel-ratio', 'screen-extended', 'screen-orientation', 'screen-geometry', 'css-media'],
  language: ['navigator-language', 'navigator-languages'], timezone: ['timezone'],
  region: ['timezone', 'navigator-language', 'navigator-languages', 'geolocation'],
  canvas: ['canvas-readback'], audio: ['audio-fingerprint'], webgl: ['webgl-readback'],
});

// --- Chrome-form language lists (ADR-107) ------------------------------------------------------------------------------
// Chrome's navigator.languages for a UI locale: the locale, its base language, then English ('en-US', 'en'); an English locale
// keeps only itself and 'en'. A locale the offline region table uses takes that region's own list (Canada and India add their
// second language there). Duplicates are dropped case-insensitively; a tag Intl cannot canonicalize gives null.
let regionLists = null;
function regionLanguageLists() {
  if (regionLists === null) {
    regionLists = new Map();
    for (const code of regionCodes()) { const region = regionByCode(code); if (region && !regionLists.has(region.locale)) regionLists.set(region.locale, region.languages); }
  }
  return regionLists;
}
// The locales of the region table, unique, in table order (242 for REGION_DATA_VERSION 1).
export const regionLocales = () => [...regionLanguageLists().keys()];
export function chromeLanguages(locale) {
  if (typeof locale !== 'string' || locale.length < 1 || locale.length > 64) return null;
  let canonical;
  try { [canonical] = Intl.getCanonicalLocales(locale); } catch { return null; }
  if (typeof canonical !== 'string') return null;
  const table = regionLanguageLists().get(canonical), base = canonical.split('-')[0];
  const list = table ? [...table] : base === 'en' ? [canonical, 'en'] : [canonical, base, 'en-US', 'en'], seen = new Set();
  return list.filter(tag => { const key = tag.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

// Build the complete, internally consistent set of reported values for one device.
// Returns [{ id, raw }] pairs the generator applies through the existing validated setter.
export function buildDeviceValues(options = {}) {
  const deviceType = DEVICE_TYPES.includes(options.deviceType) ? options.deviceType : 'desktop';
  const os = DEVICE_OS.includes(options.os) ? options.os : 'windows-11';
  const browser = DEVICE_BROWSERS.includes(options.browser) ? options.browser : 'chrome';
  const seed = Number.isInteger(options.seed) ? options.seed >>> 0 : 0;
  const environment = normalizeEnvironment(options.environment);
  const versions = browserVersions(environment);
  const version = versions.includes(Number(options.version)) ? Number(options.version) : versions[0];
  const geometry = options.geometry !== false;

  // ADR-107: random choices respect THIS browser; a choice the user made is never filtered (the hints then say what does not fit).
  // A device is first drawn exactly as without an environment and kept when it fits; only a draw that contradicts this browser is
  // drawn again (another salt) from the choices that fit. For the card this gives the same distribution as drawing from the fitting
  // cards directly, while a seed keeps its device whenever it already fits. Each preference keeps the whole list when nothing
  // matches it. Cards: those with a thread count the real machine can report, then those of the real GPU vendor family.
  const realThreads = environment.hardwareConcurrency, realFamily = realGpuFamily(environment.gpu);
  const prefer = (list, keep) => { const kept = list.filter(keep); return kept.length ? kept : list; };
  const candidates = prefer(prefer(gpusFor(deviceType), card => realThreads === undefined || card.threads.some(count => count <= realThreads)), card => realFamily === null || card.vendorFamily === realFamily);
  let gpu = GPU_PRESETS.find(g => g.id === options.gpu && g.types.includes(deviceType));
  if (!gpu) { gpu = pickWeighted(gpusFor(deviceType), seed, 1) ?? GPU_PRESETS[0]; if (!candidates.includes(gpu)) gpu = pickWeighted(candidates, seed, 11) ?? gpu; }
  // A chosen ladder id keeps its default scale (or the scale asked for); a random device draws a panel for its class and a scale
  // for that panel. Without window geometry rows (Compatibility, Balanced) the real window stays native, so the pair must have a CSS
  // size that holds it (the real outer window, else the real screen): a draw that cannot is drawn again from the pairs that can, of
  // the class list, else of every panel of the device type; when no pair can, the screen rows are left native (screen null).
  const chosen = SCREEN_PRESETS.find(s => s.id === options.screen && s.types.includes(deviceType));
  const reference = geometry ? undefined : environment.outer ?? environment.screen;
  const holds = (panel, scale) => {
    if (!reference) return true;
    const css = cssSize(panel, scale);
    return !(Number.isFinite(reference.width) && css.width < reference.width) && !(Number.isFinite(reference.height) && css.height < reference.height);
  };
  let screen = null;
  if (chosen) screen = resolveScreen(chosen.id, options.scale);
  else {
    const classPanels = CLASS_PANELS[deviceType][gpu.performance].map(panelById), first = pick(classPanels, seed, 2), firstScale = first ? drawScale(first, seed, 8) : undefined;
    if (first && holds(first, firstScale)) screen = resolveScreen(screenIdFor(first.id, firstScale), firstScale);
    else {
      const fitting = list => list.filter(panel => panel.scales.some(([scale]) => holds(panel, scale)));
      const classPool = fitting(classPanels);
      const panel = pick(classPool.length ? classPool : fitting(SCREEN_PANELS.filter(entry => entry.types.includes(deviceType))), seed, 12);
      if (panel) { const drawn = drawScale(panel, seed, 13, scale => holds(panel, scale)); screen = resolveScreen(screenIdFor(panel.id, drawn), drawn); }
    }
  }

  // Threads: the overlap of the card's lineup and the class pool, else the card's lineup. A drawn value above the real
  // hardwareConcurrency (workers can time it) is lowered to the largest value of the card that fits, or to the card's
  // smallest value if none does (the `cores-above-real` hint then says so). A value the user chose is never changed.
  const overlap = CLASS_CORES[deviceType][gpu.performance].filter(count => gpu.threads.includes(count));
  let cores = CPU_STEPS.includes(Number(options.cores)) ? Number(options.cores) : (pick(overlap.length ? overlap : gpu.threads, seed, 3) ?? 8);
  if (!CPU_STEPS.includes(Number(options.cores)) && realThreads !== undefined && cores > realThreads) {
    const fits = gpu.threads.filter(count => count <= realThreads);
    cores = fits.length ? Math.max(...fits) : Math.min(...gpu.threads);
  }
  // RAM: a random image never reports more than this browser's own deviceMemory when that is an upper bound (memoryBound).
  const chosenRam = RAM_STEPS.includes(Number(options.ramGb)) ? Number(options.ramGb) : null;
  let physicalRamGb = chosenRam ?? CLASS_RAM[deviceType][gpu.performance], reportedMemory = reportedDeviceMemory(physicalRamGb, version);
  const bound = memoryBound(environment);
  if (chosenRam === null && bound !== undefined && reportedMemory > bound) {
    const buckets = deviceMemoryBuckets(version), below = buckets.filter(bucket => bucket <= bound);
    reportedMemory = below.length ? Math.max(...below) : buckets[0];
    physicalRamGb = ramImageFromReported(reportedMemory, deviceType, version) ?? physicalRamGb;
  }

  // Storage: every claim built here is Chromium, and Chrome reports a fixed quota (usage + 10 GiB) whatever the disk is, so the
  // quota stays native and a requested disk size is not written (ADR-107; see STORAGE_CHROME_HEADROOM).
  const values = [
    ...processorValues(cores),
    { id: 'device-memory', raw: reportedMemory },
    { id: 'touch-points', raw: 0 },
    ...(screen ? screenValues(screen.id, os, { geometry, scale: screen.scale, browser }) : []),
    ...gpuValues(gpu.id),
    ...identityValues({ os, browser, version, environment }),
    // `options.fontRegion` (a claimed region code, optional) adds the regional CJK group; the generator passes it once the region rows are known.
    ...(options.fonts === true ? fontValues(generatedFontOptions(options, os, seed, options.fontRegion)) : []),
  ];
  const summary = {
    deviceType, os, browser, version, cores,
    ramGb: physicalRamGb, reportedMemory,
    diskGb: null, gpu: gpu.id, gpuLabel: gpu.label,
    screen: screen?.id ?? null, width: screen?.width ?? null, height: screen?.height ?? null, dpr: screen?.dpr ?? null, scale: screen?.scale ?? null, panel: screen?.panel ?? null,
  };
  return { values, summary, gpu, screen };
}

// Which font groups does a canvas-font-policy value hold? null when it is not one of the Windows lists written by this module (the older fixed
// 14-name list counts as the core group, and so do the lists written before the five platform aliases joined the core group). `region` is the key of the
// regional CJK group of the list (ADR-110 addendum 2) or null; lists saved before that have none. `hidden` is empty for a
// plain list; for a list with noise it holds the optional names that the list lacks (a valid noise set: a few whole optional units, at most the limit;
// fingerprint-font-noise.js), which is how noise stays recognizable in a stored profile and can follow a change of the claimed Windows.
const NO_NAMES = Object.freeze([]);
function describeFonts(fonts) {
  if (fonts === undefined || fonts === null || fonts.fallback !== FONT_FALLBACK) return null;
  const families = fonts.families, json = JSON.stringify(families);
  if (json === JSON.stringify(LEGACY_FONT_FAMILIES)) return { groups: { windows11: false, office: false, panEuropean: false }, region: null, hidden: NO_NAMES };
  const plain = FONT_COMBOS.find(combo => combo.json === json) ?? PRIOR_FONT_COMBOS.find(combo => combo.json === json);
  if (plain) return { groups: plain.groups, region: plain.region, hidden: NO_NAMES };
  if (!Array.isArray(families)) return null;
  for (const combo of FONT_COMBOS) {
    if (families.length >= combo.list.length || families.length < combo.list.length - combo.model.limit) continue;
    const removed = removedByNoise(combo.list, families, combo.model);
    if (removed !== null && removed.length > 0) return { groups: combo.groups, region: combo.region, hidden: Object.freeze(removed) };
  }
  return null;
}

// The configuration form of describeDevice: the active Custom value of a row, read through data descriptors only.
function valueOfConfiguration(configuration) {
  const rows = own(configuration, 'apis');
  return id => {
    if (!Array.isArray(rows)) return undefined;
    for (let index = 0; index < rows.length; index++) {
      const row = Object.getOwnPropertyDescriptor(rows, index)?.value;
      if (own(row, 'id') !== id) continue;
      const selected = own(row, 'selected');
      return own(row, 'mode') === 'custom' && own(selected, 'kind') === 'value' ? own(selected, 'value') : undefined;
    }
    return undefined;
  };
}

// Read the device a configuration currently reports. `source` is either `valueOf(id)`, which returns the active Custom
// value of a row (or undefined), or a configuration object (its `apis` rows are read the same way). Every field is null
// when its rows are not overridden, so the level controls show «Авто» instead of inventing a value.
// `region` is derived from the selected time zone (the `timezone` row, else the zone of `intl-formatting`) through the
// offline region data; a zone that no region lists gives null. `geolocation` is the Custom coordinate pair, if any.
export function describeDevice(source) {
  const valueOf = typeof source === 'function' ? source : valueOfConfiguration(source);
  const agent = valueOf('navigator-user-agent'), hints = valueOf('client-hints'), webgl = valueOf('webgl');
  const width = valueOf('screen-width'), height = valueOf('screen-height'), ratio = valueOf('window-device-pixel-ratio'), fonts = valueOf('canvas-font-policy');
  const major = typeof agent === 'string' ? Number(/Chrome\/(\d+)/u.exec(agent)?.[1]) : 0;
  const quota = valueOf('storage-estimate')?.quota;
  const gpu = webgl ? GPU_PRESETS.find(entry => entry.webgl.unmaskedRenderer === webgl.unmaskedRenderer)?.id ?? null : null;
  const screen = identifyScreen(width, height, ratio);
  const fontMatch = describeFonts(fonts);
  const zoneRow = valueOf('timezone'), intlRow = valueOf('intl-formatting'), place = valueOf('geolocation');
  const zoneId = typeof zoneRow?.timeZone === 'string' ? zoneRow.timeZone : typeof intlRow?.timeZone === 'string' ? intlRow.timeZone : null;
  const isPlace = place !== null && typeof place === 'object' && ['latitude', 'longitude', 'accuracy'].every(key => typeof place[key] === 'number' && Number.isFinite(place[key]));
  return {
    browser: typeof agent === 'string' ? (/Edg\/\d/u.test(agent) ? 'edge' : /Chrome\/\d/u.test(agent) ? 'chrome' : null) : null,
    version: claimableVersion(major) ? major : null,
    os: typeof hints?.platform === 'string' && hints.platform !== 'Windows' ? null : osFromPlatformVersion(hints?.platformVersion),
    gpu,
    deviceType: gpu ? (GPU_PRESETS.find(entry => entry.id === gpu).types.length === 1 ? GPU_PRESETS.find(entry => entry.id === gpu).types[0] : null) : null,
    screen: screen?.id ?? null,
    scale: typeof ratio === 'number' ? ratio : null,
    cores: valueOf('hardware-concurrency') ?? null,
    reportedMemory: valueOf('device-memory') ?? null,
    diskGb: typeof quota === 'number' ? diskFromQuota(quota) : null,
    language: valueOf('navigator-language') ?? null,
    timezone: valueOf('timezone') ?? null,
    region: zoneId === null ? null : regionOfTimeZone(zoneId) ?? null,
    geolocation: isPlace ? { latitude: place.latitude, longitude: place.longitude, accuracy: place.accuracy } : null,
    fonts: fonts === undefined ? null : fontMatch ? 'windows' : 'custom',
    fontGroups: fontMatch ? { ...fontMatch.groups } : null,
    // The regional CJK group of a Windows list (a key of REGION_FONT_GROUP_KEYS), null when the list has none or is not a Windows list.
    fontRegion: fontMatch ? fontMatch.region : null,
    // For a Windows list: whether it lacks a few optional families (generated with the font list noise on) and which ones; null for any other row state.
    fontNoise: fontMatch ? fontMatch.hidden.length > 0 : null,
    fontHidden: fontMatch ? [...fontMatch.hidden] : null,
  };
}
