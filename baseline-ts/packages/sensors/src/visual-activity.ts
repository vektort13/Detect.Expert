import { VISUAL_LIMITS, VISUAL_OPERATIONS } from '@detect-expert/contracts';
import type { VisualCanvas, VisualImage, VisualOperation, VisualRenderer } from '@detect-expert/contracts';
import { arrayPush } from './intrinsics';

const WeakMapCtor = WeakMap;
const get = Function.prototype.call.bind(WeakMap.prototype.get) as <Value>(map: WeakMap<object, Value>, key: object) => Value | undefined;
const set = Function.prototype.call.bind(WeakMap.prototype.set) as <Value>(map: WeakMap<object, Value>, key: object, value: Value) => unknown;
const create = Object.create;
const finite = Number.isFinite;
const slice = Function.prototype.call.bind(String.prototype.slice) as (value: string, start: number, end: number) => string;
const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null;

export interface VisualRecord {
  id: string;
  renderer: VisualRenderer;
  operations: Partial<Record<VisualOperation, true>>;
  readbacks: number;
  sources: number;
  image: VisualImage | null;
  queued: boolean;
  omitted: boolean;
}

export class VisualActivity {
  private records = new WeakMapCtor<object, VisualRecord>();
  private images = new WeakMapCtor<object, boolean>();
  private count = 0;
  private imageCount = 0;
  constructor(private readonly boot: string, private readonly changed: (record: VisualRecord) => void, private readonly limited: () => void) {}

  lookup(receiver: unknown): VisualRecord | undefined { return isObject(receiver) ? get(this.records, receiver) : undefined; }

  private make(receiver: object, renderer: VisualRenderer): VisualRecord | undefined {
    if (this.count >= VISUAL_LIMITS.maxCanvases) { this.limited(); return undefined; }
    const record: VisualRecord = { id: this.boot + ':' + (++this.count), renderer,
      operations: create(null) as VisualRecord['operations'], readbacks: 0, sources: 0, image: null, queued: false, omitted: false };
    set(this.records, receiver, record);
    return record;
  }

  context(receiver: unknown, result: unknown, type: unknown): void {
    if (!isObject(receiver) || !isObject(result)) return;
    const renderer = type === 'experimental-webgl' ? 'webgl' : type;
    if (renderer !== '2d' && renderer !== 'webgl' && renderer !== 'webgl2' && renderer !== 'webgpu' && renderer !== 'bitmaprenderer') return;
    const record = this.lookup(result) ?? this.lookup(receiver) ?? this.make(receiver, renderer);
    if (!record) return;
    if (record.renderer === 'unknown') {
      record.renderer = renderer;
      if (record.image?.format === 'png' && (renderer === 'webgl' || renderer === 'webgl2')) record.image.kind = 'webgl';
      this.changed(record);
    }
    set(this.records, receiver, record); set(this.records, result, record);
  }

  private mark(record: VisualRecord, operation: VisualOperation): void {
    if (record.operations[operation]) return;
    record.operations[operation] = true;
    if (!record.queued) this.changed(record);
  }

  readback(receiver: unknown, renderer: VisualRenderer, source: number): VisualRecord | undefined {
    if (!isObject(receiver)) return undefined;
    const record = this.lookup(receiver) ?? this.make(receiver, renderer);
    if (!record) return undefined;
    if (record.readbacks < VISUAL_LIMITS.maxReadbacks) record.readbacks++;
    if (record.readbacks === 2) this.mark(record, 'repeat-readback');
    if (record.sources !== 0 && (record.sources & source) === 0) this.mark(record, 'multiple-readback-formats');
    record.sources |= source;
    if (record.image && !record.queued) this.changed(record);
    return record;
  }

  snapshot(record: VisualRecord): VisualCanvas {
    const operations: VisualOperation[] = [];
    for (let index = 0; index < VISUAL_OPERATIONS.length; index++) {
      const operation = VISUAL_OPERATIONS[index]!;
      if (record.operations[operation]) arrayPush(operations, operation);
    }
    return { id: record.id, renderer: record.renderer, operations, readbacks: record.readbacks };
  }

  reset(receiver: unknown): void {
    const record = this.lookup(receiver);
    if (!record) return;
    this.mark(record, 'canvas-reset');
  }

  imageSource(receiver: unknown, value: unknown): void {
    if (!isObject(receiver)) return;
    const svg = typeof value === 'string' && slice(value, 0, 18) === 'data:image/svg+xml';
    if (get(this.images, receiver) !== undefined) { set(this.images, receiver, svg); return; }
    if (svg && this.imageCount < VISUAL_LIMITS.maxCanvases) { this.imageCount++; set(this.images, receiver, true); }
  }

  bitmap(receiver: unknown, result: unknown): void {
    const record = this.lookup(receiver);
    if (!record || !isObject(result)) return;
    set(this.records, result, record);
    this.mark(record, 'bitmap-transfer');
  }

  offscreen(receiver: unknown, result: unknown): void {
    if (!isObject(receiver) || !isObject(result)) return;
    const record = this.lookup(receiver) ?? this.make(receiver, 'unknown');
    if (!record) return;
    set(this.records, result, record);
    this.mark(record, 'offscreen-transfer');
  }

  action(receiver: unknown, name: string, args: IArguments): void {
    const record = this.lookup(receiver);
    if (!record) return;
    const mark = (operation: VisualOperation) => this.mark(record, operation);
    if (name === 'fillText' || name === 'strokeText') mark('text');
    else if (name === 'drawImage') {
      mark('image-copy');
      if (args.length === 9) mark('cropped-copy');
      const source = this.lookup(args[0]);
      if (source?.operations['cropped-copy']) mark('recombined-copy');
      if (source?.operations['flip-y'] && record.operations['flip-y']) mark('flip-back-copy');
      if (source?.renderer === 'webgl' || source?.renderer === 'webgl2') mark('webgl-to-2d');
      if (isObject(args[0]) && get(this.images, args[0])) mark('svg-source');
    } else if (name === 'putImageData') mark('pixel-write');
    else if (name === 'fillRect' || name === 'clearRect') mark('fill');
    else if (name === 'createLinearGradient' || name === 'createRadialGradient' || name === 'createConicGradient') mark('gradient');
    else if (name === 'createPattern') mark('pattern');
    else if (name === 'arc' || name === 'fill' || name === 'stroke' || name === 'rect') mark('path');
    else if (name === 'scale' || name === 'translate' || name === 'rotate' || name === 'transform' || name === 'setTransform' || name === 'resetTransform') {
      mark('transform');
      for (let index = 0; index < args.length && index < 6; index++) {
        const value: unknown = args[index];
        if (typeof value === 'number' && finite(value) && value % 1 !== 0) mark('fractional');
      }
      if (name === 'scale') {
        if (typeof args[0] === 'number' && args[0] < 0) mark('flip-x');
        if (typeof args[1] === 'number' && args[1] < 0) mark('flip-y');
      } else if ((name === 'setTransform' || name === 'transform') && args.length >= 6 && args[1] === 0 && args[2] === 0) {
        if (typeof args[0] === 'number' && args[0] < 0) mark('flip-x');
        if (typeof args[3] === 'number' && args[3] < 0) mark('flip-y');
      }
    } else if (name === 'globalAlpha') mark('alpha');
    else if (name === 'globalCompositeOperation') mark('composite');
    else if (name === 'texImage2D' || name === 'texSubImage2D') {
      mark('texture-upload');
      const sourceIndex = args.length === 6 ? 5 : args.length === 7 ? 6 : 8;
      const source = this.lookup(args[sourceIndex]);
      if (source?.renderer === '2d') mark('2d-to-webgl');
      else if (source?.renderer === 'webgl' || source?.renderer === 'webgl2') mark('webgl-to-webgl');
    } else if (name === 'createShader' || name === 'shaderSource' || name === 'compileShader' || name === 'linkProgram' || name === 'useProgram') mark('shader');
    else if (name === 'drawArrays' || name === 'drawElements' || name === 'clear') mark('gpu-draw');
    else if (name === 'finish' || name === 'flush') mark('gpu-sync');
    else if (name === 'getParameter' || name === 'getSupportedExtensions' || name === 'getShaderPrecisionFormat') mark('gl-parameters');
    else if (name === 'getExtension') {
      if (args[0] === 'EXT_disjoint_timer_query' || args[0] === 'EXT_disjoint_timer_query_webgl2') mark('timer-extension');
    } else if (name === 'beginQuery' || name === 'endQuery') {
      if (args[0] === 0x8c2f || args[0] === 0x8d6a) mark('occlusion-query');
      if (args[0] === 0x88bf) mark('timer-query');
    } else if (name === 'getQueryParameter') mark('query-read');
    else if (name === 'pixelStorei') {
      if (args[0] === 0x9240 && (args[1] === true || args[1] === 1)) mark('flip-y');
      if (args[0] === 0x9241 && (args[1] === true || args[1] === 1)) mark('alpha');
    } else if (name === 'transferControlToOffscreen') mark('offscreen-transfer');
    else if (name === 'createImageBitmap') mark('bitmap-create');
  }

  clear(): void { this.records = new WeakMapCtor<object, VisualRecord>(); this.images = new WeakMapCtor<object, boolean>(); }
}