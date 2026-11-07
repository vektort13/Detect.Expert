// ADR-017/018: user-requested automatic, ephemeral copies of page-requested readbacks. Never report observations.
// No draw/readback API is called here. Native brand getters reject Proxy/fake objects without page getters.
import { CHANNEL, PROTOCOL_VERSION, UNBOUND_SENSOR_BOOT_ID, VISUAL_CHANNEL, VISUAL_LIMITS, validateBridgeMessage, validateVisualConfigMessage } from '@detect-expert/contracts';
import type { VisualImage } from '@detect-expert/contracts';
import type { SensorRuntime } from './runtime';
import { VisualActivity } from './visual-activity';
import type { VisualRecord } from './visual-activity';
import { registerValueCaptureRealm, valueCaptureDenied, onValueCaptureDenied } from './value-capture-policy';

const descriptor = Object.getOwnPropertyDescriptor;
const create = Object.create;
const getPrototype = Object.getPrototypeOf;
const apply = Reflect.apply;
const own = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (value: object, key: PropertyKey) => boolean;
const slice = Function.prototype.call.bind(String.prototype.slice) as (text: string, start: number, end?: number) => string;
const charCode = Function.prototype.call.bind(String.prototype.charCodeAt) as (text: string, index: number) => number;
const includes = Function.prototype.call.bind(String.prototype.includes) as (text: string, part: string) => boolean;
const functionSource = Function.prototype.call.bind(Function.prototype.toString) as (fn: Function) => string;
const regexTest = Function.prototype.call.bind(RegExp.prototype.test) as (regex: RegExp, text: string) => boolean;
const integer = Number.isSafeInteger;
const ceil = Math.ceil;
const decode = atob;
const WeakMapCtor = WeakMap;
const weakGet = Function.prototype.call.bind(WeakMap.prototype.get) as <V>(map: WeakMap<object, V>, key: object) => V | undefined;
const weakSet = Function.prototype.call.bind(WeakMap.prototype.set) as <V>(map: WeakMap<object, V>, key: object, value: V) => unknown;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const PNG_PREFIX = 'data:image/png;base64,';

function nativeGetter(target: object | null, key: PropertyKey): Function | null {
  const getter = target && descriptor(target, key)?.get;
  return typeof getter === 'function' && includes(functionSource(getter), '[native code]') ? getter : null;
}
function nativePrototype(name: string): object | null {
  const constructor = descriptor(globalThis, name);
  if (!constructor || !own(constructor, 'value') || typeof constructor.value !== 'function') return null;
  const prototype = descriptor(constructor.value, 'prototype');
  return prototype && own(prototype, 'value') && typeof prototype.value === 'object' ? prototype.value : null;
}
// Captured in the module's parent realm, also usable on genuine same-origin child realm instances.
const imagePrototype = nativePrototype('ImageData');
const imageWidth = nativeGetter(imagePrototype, 'width');
const imageHeight = nativeGetter(imagePrototype, 'height');
const imageBytes = nativeGetter(imagePrototype, 'data');
const imageColorSpace = nativeGetter(imagePrototype, 'colorSpace');
const typedPrototype = getPrototype(Uint8Array.prototype) as object;
const typedLength = nativeGetter(typedPrototype, 'length')!;
const typedBuffer = nativeGetter(typedPrototype, 'buffer')!;
const typedKind = nativeGetter(typedPrototype, Symbol.toStringTag)!;
const bufferLength = nativeGetter(ArrayBuffer.prototype, 'byteLength')!;

function dimensions(width: unknown, height: unknown): width is number {
  return typeof width === 'number' && typeof height === 'number' && integer(width) && integer(height)
    && width > 0 && height > 0 && width <= VISUAL_LIMITS.maxDimension && height <= VISUAL_LIMITS.maxDimension
    && width * height <= VISUAL_LIMITS.maxPixels;
}
function bytes(value: unknown, kind: string, length: number, exact = true): Uint8Array | Uint8ClampedArray | null {
  if (typeof value !== 'object' || value === null || apply(typedKind, value, []) !== kind) return null;
  const available = apply(typedLength, value, []) as number;
  if (exact ? available !== length : available < length) return null;
  // SharedArrayBuffer allows concurrent changes; detached buffers and fake views are rejected as well.
  const buffer = apply(typedBuffer, value, []);
  if (apply(bufferLength, buffer, []) < length) return null;
  return value as Uint8Array | Uint8ClampedArray;
}
function encode(value: Uint8Array | Uint8ClampedArray, length: number, offset = 0): string {
  let out = '';
  for (let i = 0; i < length; i += 3) {
    const start = offset + i;
    const a = value[start]!, b = i + 1 < length ? value[start + 1]! : 0, c = i + 2 < length ? value[start + 2]! : 0;
    out += ALPHABET[a >> 2]! + ALPHABET[((a & 3) << 4) | (b >> 4)]!
      + (i + 1 < length ? ALPHABET[((b & 15) << 2) | (c >> 6)]! : '=')
      + (i + 2 < length ? ALPHABET[c & 63]! : '=');
  }
  return out;
}

export interface VisualCapture {
  imageData(result: unknown, receiver?: unknown): void;
  dataUrl(result: unknown, receiver?: unknown): void;
  context(receiver: unknown, result: unknown, type: unknown): void;
  action(receiver: unknown, name: string, args: IArguments): void;
  reset(receiver: unknown): void;
  imageSource(receiver: unknown, value: unknown): void;
  bitmap(receiver: unknown, result: unknown): void;
  offscreen(receiver: unknown, result: unknown): void;
  readPixels(receiver: unknown, args: IArguments, webgl2?: boolean): void;
  pixelStore(receiver: unknown, args: IArguments): void;
  stop(): void;
}
interface CaptureState { capture: VisualCapture; registerRealm: (realm: object) => void }
const captures = new WeakMapCtor<object, CaptureState>();
export function visualCaptureFor(runtime: SensorRuntime): VisualCapture | undefined { return weakGet(captures, runtime)?.capture; }

export function installVisualCapture(runtime: SensorRuntime, _realm: object = globalThis): VisualCapture {
  const existing = weakGet(captures, runtime);
  if (existing) { existing.registerRealm(_realm); return existing.capture; }
  const env = runtime.visualEnv;
  let expires = 0;
  let timer: unknown = null;
  const epoch = runtime.historyEpoch;
  let seen = 0;
  let capturedCount = 0;
  let capturedChars = 0;
  let deliveredFrames = 0;
  let deliveredChars = 0;
  let limited = false;
  let limitSent = false;
  let flushTimer: unknown = null;
  let transportEnabled = false;
  let pending: Record<number, VisualImage> = create(null) as Record<number, VisualImage>;
  let pendingRecords: Record<number, VisualRecord> = create(null) as Record<number, VisualRecord>;
  let pendingIndices: Record<string, number> = create(null) as Record<string, number>;
  let pendingCount = 0;
  let drainingCount = 0;
  let stopped = false;
  let helloTimer: unknown = null;
  let helloCount = 0;
  let lastHello = -Infinity;
  // Kept only in this closure, never on the page-mutable SensorRuntime object.
  // A child can share its parent's observer even when its Custom scope differs.
  let policyDenied = false;
  // Weak context state has no pixel/value payload. Only pack layouts known to stay tight are accepted.
  const unsafePack = new WeakMapCtor<object, boolean>();
  const markLimited = (): void => { limited = true; schedule(); };
  const activity = new VisualActivity(runtime.sensorBootId, record => {
    if (record.image) queue(record.image, record);
  }, markLimited);
  const disable = (): void => {
    expires = 0;
    transportEnabled = false;
    pending = create(null) as Record<number, VisualImage>; pendingCount = 0;
    pendingRecords = create(null) as Record<number, VisualRecord>;
    pendingIndices = create(null) as Record<string, number>;
    activity.clear();
    if (flushTimer !== null) { env.clearTimeout(flushTimer); flushTimer = null; }
    if (timer !== null) { env.clearTimeout(timer); timer = null; }
  };
  const denyPolicy = (): void => {
    policyDenied = true;
    disable(); drainingCount = 0;
    if (helloTimer !== null) { env.clearTimeout(helloTimer); helloTimer = null; }
  };
  const registerRealm = (realm: object): void => {
    registerValueCaptureRealm(runtime, realm);
  };
  const denied = (): boolean => valueCaptureDenied(runtime);
  const expire = (): void => {
    if ((pendingCount > 0 || drainingCount > 0 || limited) && transportEnabled && !limitSent && !stopped && runtime.hooks.enabled && epoch === runtime.historyEpoch) {
      limitSent = true;
      try { env.postMessage({ channel: VISUAL_CHANNEL, type: 'visual-limited', sensorBootId: runtime.sensorBootId }); } catch {}
    }
    disable();
  };
  const alive = (): boolean => {
    if (!expires || stopped) return false;
    if (!runtime.hooks.enabled || epoch !== runtime.historyEpoch) { disable(); return false; }
    if (env.now() >= expires) { expire(); return false; }
    return true;
  };
  const active = (kind: number, receiver?: unknown): boolean => {
    const record = activity.lookup(receiver);
    if (record?.image || record?.omitted) return false;
    if (capturedCount >= VISUAL_LIMITS.maxImages) { markLimited(); return false; }
    return typeof receiver === 'object' && receiver !== null ? record?.image === null : (seen & kind) === 0;
  };
  const drain = (): void => {
    if (denied()) return;
    if (flushTimer !== null) { env.clearTimeout(flushTimer); flushTimer = null; }
    if (!transportEnabled || !alive()) return;
    const queued = pending, records = pendingRecords, count = pendingCount;
    pending = create(null) as Record<number, VisualImage>; pendingCount = 0;
    pendingRecords = create(null) as Record<number, VisualRecord>;
    pendingIndices = create(null) as Record<string, number>;
    drainingCount = count;
    for (let index = 0; index < count && transportEnabled && alive(); index++) {
      if (denied()) return;
      const raw = queued[index], record = records[index];
      drainingCount = count - index;
      if (!raw) continue;
      const image = record ? { ...raw, canvas: activity.snapshot(record) } : raw;
      if (record) record.queued = false;
      if (deliveredFrames >= VISUAL_LIMITS.maxFrames || deliveredChars + image.data.length > VISUAL_LIMITS.maxTotalBase64Chars * 2) { limited = true; continue; }
      deliveredFrames++; deliveredChars += image.data.length;
      if (denied()) return;
      env.postMessage({ channel: VISUAL_CHANNEL, type: 'visual-image', sensorBootId: runtime.sensorBootId, image });
    }
    drainingCount = 0;
    if (limited && !limitSent && transportEnabled && alive()) {
      limitSent = true;
      env.postMessage({ channel: VISUAL_CHANNEL, type: 'visual-limited', sensorBootId: runtime.sensorBootId });
    }
  };
  const schedule = (): void => {
    if (!transportEnabled || !alive()) return;
    if (expires - env.now() <= 250) drain();
    else if (flushTimer === null) flushTimer = env.setTimeout(drain, 250);
  };
  const queue = (image: VisualImage, record?: VisualRecord): void => {
    if (denied()) return;
    if (record?.queued) return;
    const key = record?.id ?? image.kind;
    const previous = pendingIndices[key];
    if (previous !== undefined) { pending[previous] = image; if (record) pendingRecords[previous] = record; }
    else {
      if (pendingCount >= VISUAL_LIMITS.maxImages) { markLimited(); return; }
      pendingIndices[key] = pendingCount; pending[pendingCount] = image;
      if (record) pendingRecords[pendingCount] = record;
      pendingCount++;
    }
    if (record) record.queued = true;
    if (deliveredFrames === 0) drain(); else schedule();
  };
  const send = (image: VisualImage, kind: number, receiver?: unknown): void => {
    if (denied()) return;
    if (!active(kind, receiver)) { if (alive() && capturedCount >= VISUAL_LIMITS.maxImages) markLimited(); return; }
    if (capturedChars + image.data.length > VISUAL_LIMITS.maxTotalBase64Chars) { markLimited(); return; }
    capturedCount++;
    capturedChars += image.data.length;
    const record = activity.lookup(receiver);
    if (record) record.image = image;
    else seen |= kind;
    queue(image, record);
  };
  const fits = (length: number, receiver: unknown): boolean => {
    if (capturedChars + length <= VISUAL_LIMITS.maxTotalBase64Chars) return true;
    const record = activity.lookup(receiver);
    if (record) record.omitted = true;
    markLimited();
    return false;
  };
  const hello = (): void => {
    helloTimer = null;
    if (stopped || policyDenied || helloCount >= 4) return;
    helloCount++; lastHello = env.now();
    env.postMessage({ channel: VISUAL_CHANNEL, type: 'visual-hello', sensorBootId: runtime.sensorBootId });
  };
  const onMessage = (event: unknown): void => {
    try {
      if (stopped || denied() || typeof event !== 'object' || event === null) return;
      const message = env.readMessage(event);
      if (message.source !== env.self) return;
      if (typeof message.data === 'object' && message.data !== null && descriptor(message.data, 'channel')?.value === CHANNEL) {
        const checked = validateBridgeMessage(message.data);
        if (!checked.ok) return;
        const boot = descriptor(checked.value, 'sensorBootId')?.value;
        if (boot !== runtime.sensorBootId && boot !== UNBOUND_SENSOR_BOOT_ID) return;
        const type = descriptor(checked.value, 'type')?.value;
        if (type === 'bridge-hello' && descriptor(checked.value, 'protocolVersion')?.value === PROTOCOL_VERSION && helloCount < 4 && helloTimer === null) {
          const elapsed = env.now() - lastHello;
          if (elapsed >= 250) hello(); else helloTimer = env.setTimeout(hello, 250 - elapsed);
        } else if (boot === runtime.sensorBootId && type === 'bridge-pause') disable();
        return;
      }
      const valid = validateVisualConfigMessage(message.data);
      if (!valid.ok || descriptor(valid.value, 'sensorBootId')?.value !== runtime.sensorBootId) return;
      const enabled = descriptor(valid.value, 'enabled')?.value === true;
      const remaining = descriptor(valid.value, 'remainingMs')?.value as number;
      // A synthetic MessageEvent can carry a Proxy whose descriptors change between validation/reads.
      if (typeof remaining !== 'number' || !integer(remaining) || remaining < 0 || remaining > VISUAL_LIMITS.leaseMs) return;
      if (!alive()) return;
      // Startup's not-ready reply is not a terminal revoke; keep the bounded pre-handshake copies.
      // Actual pause/stop/expiry clears them through the lifecycle paths above.
      if (!enabled || remaining === 0) { transportEnabled = false; return; }
      const now = env.now();
      // Handshake/config retries may shorten the installation window, never renew it or its image budget.
      if (now + remaining < expires) { expires = now + remaining; if (timer !== null) env.clearTimeout(timer); timer = env.setTimeout(expire, remaining); }
      transportEnabled = true;
      drain();
    } catch { /* Page-controlled routing never escapes into the page or changes report state. */ }
  };
  const capture: VisualCapture = {
    context(receiver, result, type) { if (alive()) activity.context(receiver, result, type); },
    action(receiver, name, args) { if (alive()) activity.action(receiver, name, args); },
    reset(receiver) { if (alive()) activity.reset(receiver); },
    imageSource(receiver, value) { if (alive()) activity.imageSource(receiver, value); },
    bitmap(receiver, result) { if (alive()) activity.bitmap(receiver, result); },
    offscreen(receiver, result) { if (alive()) activity.offscreen(receiver, result); },
    imageData(result, receiver) {
      if (denied()) return;
      if (!alive()) return;
      activity.readback(receiver, '2d', 1);
      if (!active(1, receiver) || !imageWidth || !imageHeight || !imageBytes) return;
      try {
        const width = apply(imageWidth, result, []), height = apply(imageHeight, result, []);
        if (!dimensions(width, height)) return;
        // The RGBA preview contract is sRGB; do not silently reinterpret Display-P3 channels.
        if (imageColorSpace && apply(imageColorSpace, result, []) !== 'srgb') return;
        const length = width * height * 4;
        if (!fits(ceil(length / 3) * 4, receiver)) return;
        const data = bytes(apply(imageBytes, result, []), 'Uint8ClampedArray', length);
        if (data) send({ kind: 'canvas', source: 'getImageData', format: 'rgba', width, height, data: encode(data, length) }, 1, receiver);
      } catch { /* Reject non-branded, detached, float16 or hostile results without invoking their getters. */ }
    },
    dataUrl(result, receiver) {
      if (denied()) return;
      if (!alive()) return;
      const record = activity.readback(receiver, 'unknown', 2);
      const kind = record?.renderer === 'webgl' || record?.renderer === 'webgl2' ? 'webgl' : 'canvas';
      if (!active(1, receiver) || typeof result !== 'string' || result.length > VISUAL_LIMITS.maxBase64Chars + PNG_PREFIX.length || slice(result, 0, PNG_PREFIX.length) !== PNG_PREFIX) return;
      try {
        const data = slice(result, PNG_PREFIX.length);
        if (!fits(data.length, receiver)) return;
        if (data.length < 44 || data.length % 4 !== 0 || !regexTest(BASE64, data)) return;
        const header = decode(slice(data, 0, 44));
        const uint = (i: number): number => charCode(header, i) * 16_777_216 + charCode(header, i + 1) * 65_536 + charCode(header, i + 2) * 256 + charCode(header, i + 3);
        const width = uint(16), height = uint(20);
        if (slice(header, 0, 8) !== '\x89PNG\r\n\x1a\n' || uint(8) !== 13 || slice(header, 12, 16) !== 'IHDR' || !dimensions(width, height)) return;
        send({ kind, source: 'toDataURL', format: 'png', width, height, data }, 1, receiver);
      } catch { /* Only a bounded primitive PNG returned by the original site call is eligible. */ }
    },
    readPixels(receiver, args, webgl2 = false) {
      if (denied()) return;
      if (!alive()) return;
      activity.readback(receiver, 'webgl', 4);
      if (!active(2, receiver) || typeof receiver !== 'object' || receiver === null || weakGet(unsafePack, receiver)) return;
      try {
        // Width/height/format/type must already be primitive: no second WebIDL conversion of page objects.
        if (args.length < 7) return;
        const width = args[2] as unknown, height = args[3] as unknown;
        if (!dimensions(width, height) || args[4] !== 0x1908 || args[5] !== 0x1401) return;
        const length = width * (height as number) * 4;
        const rawOffset: unknown = webgl2 && args.length > 7 ? args[7] : 0;
        const offset = rawOffset === undefined ? 0 : rawOffset;
        if (typeof offset !== 'number' || !integer(offset) || offset < 0 || !integer(offset + length)) return;
        if (!fits(ceil(length / 3) * 4, receiver)) return;
        const data = bytes(args[6], 'Uint8Array', offset + length, false);
        if (data) send({ kind: 'webgl', source: 'readPixels', format: 'rgba', width, height: height as number, data: encode(data, length, offset) }, 2, receiver);
      } catch { /* PBO/float/shared/detached buffers and unsupported layouts are skipped. */ }
    },
    pixelStore(receiver, args) {
      // Keep this state even while preview is off. Once uncertain, skip this context until collection.
      if (typeof receiver !== 'object' || receiver === null) return;
      const parameter = args[0] as unknown, value = args[1] as unknown;
      if (typeof parameter !== 'number' || (parameter === 0x0d05 && value !== 1 && value !== 2 && value !== 4)
        || ((parameter === 0x0d02 || parameter === 0x0d03 || parameter === 0x0d04) && value !== 0)) weakSet(unsafePack, receiver, true);
    },
    stop() {
      if (stopped) return;
      stopped = true; disable();
      if (helloTimer !== null) { env.clearTimeout(helloTimer); helloTimer = null; }
      env.removeEventListener('message', onMessage);
    },
  };
  weakSet(captures, runtime, { capture, registerRealm });
  onValueCaptureDenied(runtime, denyPolicy);
  registerRealm(_realm);
  runtime.onStop(capture.stop);
  if (runtime.hooks.enabled && !policyDenied) {
    expires = env.now() + VISUAL_LIMITS.leaseMs;
    timer = env.setTimeout(expire, VISUAL_LIMITS.leaseMs);
    env.addEventListener('message', onMessage);
    hello();
  }
  return capture;
}
