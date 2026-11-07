// ADR-017/018 / user-requested visual preview. Separate, automatic and ephemeral: never part of reports or exports.
export const VISUAL_CHANNEL = 'detect.expert/visual/v1' as const;
export const VISUAL_LIMITS = Object.freeze({ leaseMs: 60_000, maxPixels: 65_536, maxDimension: 1024, maxBase64Chars: 524_288,
  maxImages: 256, maxCanvases: 512, maxTotalBase64Chars: 12_582_912, maxFrames: 512, maxReadbacks: 65_535, maxDocuments: 4, maxPending: 4 });
export const VISUAL_RENDERERS = ['unknown', '2d', 'webgl', 'webgl2', 'webgpu', 'bitmaprenderer'] as const;
export type VisualRenderer = typeof VISUAL_RENDERERS[number];
export const VISUAL_OPERATIONS = ['text', 'image-copy', 'cropped-copy', 'recombined-copy', 'flip-back-copy', 'canvas-reset', 'pixel-write', 'fill', 'gradient', 'pattern', 'path',
  'transform', 'flip-x', 'flip-y', 'fractional', 'alpha', 'composite', 'repeat-readback', 'multiple-readback-formats',
  'texture-upload', '2d-to-webgl', 'webgl-to-2d', 'webgl-to-webgl', 'shader', 'gpu-draw', 'gpu-sync', 'gl-parameters',
  'timer-extension', 'timer-query', 'query-read', 'occlusion-query', 'bitmap-transfer', 'offscreen-transfer', 'bitmap-create', 'svg-source'] as const;
export type VisualOperation = typeof VISUAL_OPERATIONS[number];
export interface VisualCanvas { id: string; renderer: VisualRenderer; operations: VisualOperation[]; readbacks: number }
/** Renderer recovery is separate from the one-minute MAIN capture window. */
export const VISUAL_CACHE_IDLE_MS = 10 * 60_000;

export interface VisualImage {
  kind: 'canvas' | 'webgl';
  source: 'getImageData' | 'toDataURL' | 'readPixels';
  format: 'rgba' | 'png';
  width: number;
  height: number;
  /** Base64 only. RGBA is tightly packed; WebGL rows start at the bottom. */
  data: string;
  canvas?: VisualCanvas;
}
export type VisualUiRequest =
  | { schemaVersion: 1; type: 'ui-visual-set'; tabId: number; documentKey: string; reportRevision: number; enabled: boolean }
  | { schemaVersion: 1; type: 'ui-visual-get'; tabId: number; documentKey: string };
export type VisualPageRequest =
  | { schemaVersion: 1; type: 'visual-ready' }
  | { schemaVersion: 1; type: 'visual-limited' }
  | { schemaVersion: 1; type: 'visual-frame'; image: VisualImage };
export interface BridgeVisualControl { schemaVersion: 1; type: 'visual-control'; enabled: boolean; remainingMs: number }
/** SW acknowledgement grants a bounded renderer-memory recovery owner; never forwarded to MAIN. */
export interface VisualFrameAck { schemaVersion: 1; type: 'visual-frame-ack'; accepted: boolean; cacheToken: string | null; remainingMs: number; retained?: boolean; truncated?: boolean }
export interface VisualCacheRequest { schemaVersion: 1; type: 'visual-cache-read' | 'visual-cache-touch'; cacheToken: string }
export interface VisualCacheState { schemaVersion: 1; type: 'visual-cache-state'; cacheToken: string; images: VisualImage[]; truncated?: boolean }
export interface VisualStateResponse { schemaVersion: 1; type: 'visual-state'; documentKey: string; enabled: boolean; remainingMs: number; images: VisualImage[]; truncated?: boolean }
export type VisualSensorMessage =
  | { channel: typeof VISUAL_CHANNEL; type: 'visual-hello'; sensorBootId: string }
  | { channel: typeof VISUAL_CHANNEL; type: 'visual-limited'; sensorBootId: string }
  | { channel: typeof VISUAL_CHANNEL; type: 'visual-image'; sensorBootId: string; image: VisualImage };
export interface VisualConfigMessage { channel: typeof VISUAL_CHANNEL; type: 'visual-config'; sensorBootId: string; enabled: boolean; remainingMs: number }

type Checked<T> = { ok: true; value: T } | { ok: false };
const descriptor = Object.getOwnPropertyDescriptor;
const names = Object.getOwnPropertyNames;
const integer = Number.isSafeInteger;
const test = Function.prototype.call.bind(RegExp.prototype.test) as (re: RegExp, text: string) => boolean;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const decode = atob;
const BOOT = /^boot-[a-f0-9]{24}$/;
const CACHE_TOKEN = /^[a-f0-9]{32}$/;
const CANVAS_ID = /^boot-[a-f0-9]{24}:[1-9][0-9]{0,2}$/;
function read(value: object, key: string): unknown { return descriptor(value, key)?.value; }
function shape(value: unknown, keys: readonly string[]): value is object {
  if (typeof value !== 'object' || value === null) return false;
  const found = names(value);
  if (found.length !== keys.length) return false;
  for (let i = 0; i < keys.length; i++) {
    const d = descriptor(value, keys[i]!);
    if (!d || !descriptor(d, 'value')) return false;
  }
  return true;
}
function whole(value: unknown, min: number, max: number): value is number { return typeof value === 'number' && integer(value) && value >= min && value <= max; }
function key(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512; }
function control(value: object): boolean { return typeof read(value, 'enabled') === 'boolean' && whole(read(value, 'remainingMs'), 0, VISUAL_LIMITS.leaseMs); }

function optionalShape(value: unknown, required: readonly string[], optional: readonly string[]): value is object {
  if (typeof value !== 'object' || value === null) return false;
  return shape(value, [...required, ...optional.filter(key => descriptor(value, key) !== undefined)]);
}
function visualCanvas(input: unknown): VisualCanvas | null {
  if (!shape(input, ['id', 'renderer', 'operations', 'readbacks'])) return null;
  const id = read(input, 'id'), renderer = read(input, 'renderer'), raw = read(input, 'operations'), readbacks = read(input, 'readbacks');
  if (typeof id !== 'string' || !test(CANVAS_ID, id) || !whole(Number(id.slice(30)), 1, VISUAL_LIMITS.maxCanvases)
    || !VISUAL_RENDERERS.some(value => value === renderer) || !whole(readbacks, 1, VISUAL_LIMITS.maxReadbacks)
    || !Array.isArray(raw) || raw.length > VISUAL_OPERATIONS.length) return null;
  const operations: VisualOperation[] = [];
  for (let index = 0; index < raw.length; index++) {
    const item = descriptor(raw, String(index));
    if (!item || !descriptor(item, 'value') || !VISUAL_OPERATIONS.some(value => value === item.value) || operations.includes(item.value as VisualOperation)) return null;
    operations.push(item.value as VisualOperation);
  }
  return { id, renderer: renderer as VisualRenderer, operations, readbacks };
}

export function visualImageKey(image: VisualImage): string { return image.canvas?.id ?? image.kind; }

export function mergeVisualImage(previous: VisualImage | undefined, image: VisualImage): VisualImage {
  if (!previous) return image;
  if (!previous.canvas || !image.canvas) return previous;
  const operations = VISUAL_OPERATIONS.filter(operation => previous.canvas!.operations.includes(operation) || image.canvas!.operations.includes(operation));
  const readbacks = Math.max(previous.canvas.readbacks, image.canvas.readbacks);
  const renderer = previous.canvas.renderer === 'unknown' ? image.canvas.renderer : previous.canvas.renderer;
  if (operations.length === previous.canvas.operations.length && readbacks === previous.canvas.readbacks && renderer === previous.canvas.renderer) return previous;
  const kind = previous.format === 'png' && (renderer === 'webgl' || renderer === 'webgl2') ? 'webgl' : previous.kind;
  return { ...previous, kind, canvas: { id: previous.canvas.id, renderer, operations, readbacks } };
}

export function retainVisualImage(images: Map<string, VisualImage>, image: VisualImage): boolean {
  const key = visualImageKey(image), previous = images.get(key);
  image = mergeVisualImage(previous, image);
  if (previous === image) return true;
  if (!previous && images.size >= VISUAL_LIMITS.maxImages) return false;
  let total = image.data.length - (previous?.data.length ?? 0);
  for (const retained of images.values()) total += retained.data.length;
  if (total > VISUAL_LIMITS.maxTotalBase64Chars) return false;
  images.set(key, image);
  return true;
}

export function validateVisualImages(input: unknown): Checked<VisualImage[]> {
  try {
    if (!Array.isArray(input) || input.length > VISUAL_LIMITS.maxImages) return { ok: false };
    const images: VisualImage[] = [], keys = new Set<string>();
    let total = 0;
    for (let index = 0; index < input.length; index++) {
      const item = descriptor(input, String(index));
      if (!item || !descriptor(item, 'value')) return { ok: false };
      const parsed = validateVisualImage(item.value);
      if (!parsed.ok) return { ok: false };
      total += parsed.value.data.length;
      const key = visualImageKey(parsed.value);
      if (total > VISUAL_LIMITS.maxTotalBase64Chars || keys.has(key)) return { ok: false };
      keys.add(key); images.push(parsed.value);
    }
    return { ok: true, value: images };
  } catch { return { ok: false }; }
}

export function validateVisualImage(input: unknown): Checked<VisualImage> {
  try {
    if (!optionalShape(input, ['kind', 'source', 'format', 'width', 'height', 'data'], ['canvas'])) return { ok: false };
    const kind = read(input, 'kind'), source = read(input, 'source'), format = read(input, 'format');
    const width = read(input, 'width'), height = read(input, 'height'), data = read(input, 'data');
    if (!whole(width, 1, VISUAL_LIMITS.maxDimension) || !whole(height, 1, VISUAL_LIMITS.maxDimension) || width * height > VISUAL_LIMITS.maxPixels) return { ok: false };
    if (typeof data !== 'string' || data.length === 0 || data.length > VISUAL_LIMITS.maxBase64Chars || data.length % 4 !== 0 || !test(BASE64, data)) return { ok: false };
    if (kind === 'webgl' ? !((source === 'readPixels' && format === 'rgba') || (source === 'toDataURL' && format === 'png')) : kind !== 'canvas' || !((source === 'getImageData' && format === 'rgba') || (source === 'toDataURL' && format === 'png'))) return { ok: false };
    if (format === 'rgba') {
      const bytes = data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
      if (bytes !== width * height * 4) return { ok: false };
    } else {
      // Check the PNG signature and bounded IHDR before the UI decoder sees compressed bytes.
      if (data.length < 44) return { ok: false };
      const header = decode(data.slice(0, 44));
      const byte = (i: number): number => header.charCodeAt(i);
      const uint = (i: number): number => byte(i) * 16_777_216 + byte(i + 1) * 65_536 + byte(i + 2) * 256 + byte(i + 3);
      if (header.slice(0, 8) !== '\x89PNG\r\n\x1a\n' || uint(8) !== 13 || header.slice(12, 16) !== 'IHDR' || uint(16) !== width || uint(20) !== height) return { ok: false };
    }
    const hasCanvas = descriptor(input, 'canvas') !== undefined;
    const canvas = hasCanvas ? visualCanvas(read(input, 'canvas')) : null;
    if (hasCanvas && canvas === null) return { ok: false };
    if (canvas && ((canvas.renderer === 'webgl' || canvas.renderer === 'webgl2') !== (kind === 'webgl')) && canvas.renderer !== 'unknown') return { ok: false };
    return { ok: true, value: { kind, source, format, width, height, data, ...(canvas ? { canvas } : {}) } as VisualImage };
  } catch { return { ok: false }; }
}
export function validateVisualUiRequest(input: unknown): Checked<VisualUiRequest> {
  try {
    if (typeof input !== 'object' || input === null) return { ok: false };
    const type = read(input, 'type');
    if (!shape(input, type === 'ui-visual-set' ? ['schemaVersion', 'type', 'tabId', 'documentKey', 'reportRevision', 'enabled'] : ['schemaVersion', 'type', 'tabId', 'documentKey'])) return { ok: false };
    if (read(input, 'schemaVersion') !== 1 || !whole(read(input, 'tabId'), 0, 2_147_483_647) || !key(read(input, 'documentKey'))) return { ok: false };
    if (type === 'ui-visual-set' && (!whole(read(input, 'reportRevision'), 0, Number.MAX_SAFE_INTEGER) || typeof read(input, 'enabled') !== 'boolean')) return { ok: false };
    if (type !== 'ui-visual-set' && type !== 'ui-visual-get') return { ok: false };
    return { ok: true, value: input as VisualUiRequest };
  } catch { return { ok: false }; }
}
export function validateVisualPageRequest(input: unknown): Checked<VisualPageRequest> {
  try {
    if (typeof input !== 'object' || input === null) return { ok: false };
    if (read(input, 'schemaVersion') !== 1) return { ok: false };
    const type = read(input, 'type');
    if ((type === 'visual-ready' || type === 'visual-limited') && shape(input, ['schemaVersion', 'type'])) return { ok: true, value: { schemaVersion: 1, type } };
    if (read(input, 'type') === 'visual-frame' && shape(input, ['schemaVersion', 'type', 'image'])) {
      const image = validateVisualImage(read(input, 'image'));
      if (image.ok) return { ok: true, value: { schemaVersion: 1, type: 'visual-frame', image: image.value } };
    }
    return { ok: false };
  } catch { return { ok: false }; }
}
export function validateBridgeVisualControl(input: unknown): Checked<BridgeVisualControl> {
  try {
    if (!shape(input, ['schemaVersion', 'type', 'enabled', 'remainingMs']) || read(input, 'schemaVersion') !== 1 || read(input, 'type') !== 'visual-control' || !control(input)) return { ok: false };
    return { ok: true, value: input as BridgeVisualControl };
  } catch { return { ok: false }; }
}
export function validateVisualFrameAck(input: unknown): Checked<VisualFrameAck> {
  try {
    if (!optionalShape(input, ['schemaVersion', 'type', 'accepted', 'cacheToken', 'remainingMs'], ['retained', 'truncated']) || read(input, 'schemaVersion') !== 1 || read(input, 'type') !== 'visual-frame-ack') return { ok: false };
    const accepted = read(input, 'accepted'), cacheToken = read(input, 'cacheToken'), remainingMs = read(input, 'remainingMs');
    if (typeof accepted !== 'boolean' || !whole(remainingMs, 0, VISUAL_CACHE_IDLE_MS)) return { ok: false };
    if (accepted ? typeof cacheToken !== 'string' || !test(CACHE_TOKEN, cacheToken) || remainingMs === 0 : cacheToken !== null || remainingMs !== 0) return { ok: false };
    const retained = read(input, 'retained'), truncated = read(input, 'truncated');
    if ((descriptor(input, 'retained') && typeof retained !== 'boolean') || (descriptor(input, 'truncated') && typeof truncated !== 'boolean')) return { ok: false };
    return { ok: true, value: { schemaVersion: 1, type: 'visual-frame-ack', accepted, cacheToken: cacheToken as string | null, remainingMs,
      ...(typeof retained === 'boolean' ? { retained } : {}), ...(typeof truncated === 'boolean' ? { truncated } : {}) } };
  } catch { return { ok: false }; }
}
export function validateVisualCacheRequest(input: unknown): Checked<VisualCacheRequest> {
  try {
    if (!shape(input, ['schemaVersion', 'type', 'cacheToken']) || read(input, 'schemaVersion') !== 1) return { ok: false };
    const type = read(input, 'type'), cacheToken = read(input, 'cacheToken');
    if ((type !== 'visual-cache-read' && type !== 'visual-cache-touch') || typeof cacheToken !== 'string' || !test(CACHE_TOKEN, cacheToken)) return { ok: false };
    return { ok: true, value: { schemaVersion: 1, type, cacheToken } };
  } catch { return { ok: false }; }
}
export function validateVisualCacheState(input: unknown): Checked<VisualCacheState> {
  try {
    if (!optionalShape(input, ['schemaVersion', 'type', 'cacheToken', 'images'], ['truncated']) || read(input, 'schemaVersion') !== 1 || read(input, 'type') !== 'visual-cache-state') return { ok: false };
    const cacheToken = read(input, 'cacheToken'), rawImages = read(input, 'images');
    const images = validateVisualImages(rawImages), truncated = read(input, 'truncated');
    if (typeof cacheToken !== 'string' || !test(CACHE_TOKEN, cacheToken) || !images.ok || (descriptor(input, 'truncated') && typeof truncated !== 'boolean')) return { ok: false };
    return { ok: true, value: { schemaVersion: 1, type: 'visual-cache-state', cacheToken, images: images.value,
      ...(typeof truncated === 'boolean' ? { truncated } : {}) } };
  } catch { return { ok: false }; }
}
export function validateVisualSensorMessage(input: unknown): Checked<VisualSensorMessage> {
  try {
    if (typeof input !== 'object' || input === null || read(input, 'channel') !== VISUAL_CHANNEL) return { ok: false };
    const boot = read(input, 'sensorBootId');
    if (typeof boot !== 'string' || !test(BOOT, boot)) return { ok: false };
    const type = read(input, 'type');
    if ((type === 'visual-hello' || type === 'visual-limited') && shape(input, ['channel', 'type', 'sensorBootId'])) return { ok: true, value: { channel: VISUAL_CHANNEL, type, sensorBootId: boot } };
    if (read(input, 'type') === 'visual-image' && shape(input, ['channel', 'type', 'sensorBootId', 'image'])) {
      const image = validateVisualImage(read(input, 'image'));
      if (image.ok) return { ok: true, value: { channel: VISUAL_CHANNEL, type: 'visual-image', sensorBootId: boot, image: image.value } };
    }
    return { ok: false };
  } catch { return { ok: false }; }
}
export function validateVisualConfigMessage(input: unknown): Checked<VisualConfigMessage> {
  try {
    if (!shape(input, ['channel', 'type', 'sensorBootId', 'enabled', 'remainingMs']) || read(input, 'channel') !== VISUAL_CHANNEL || read(input, 'type') !== 'visual-config' || !control(input)) return { ok: false };
    const boot = read(input, 'sensorBootId');
    return typeof boot === 'string' && test(BOOT, boot) ? { ok: true, value: input as VisualConfigMessage } : { ok: false };
  } catch { return { ok: false }; }
}
