// Shared synthetic realms for the site-scope, authored-audio and font-policy tests of the ADR-087 surfaces installer.
// Not a test file (no .test.mjs suffix): `node --test scripts/test/*.test.mjs` never runs it.
import vm from 'node:vm';
import { installSurfaceCustom } from '../../apps/production-extension/api-custom-surfaces-runtime.js';

// Runs the serialized production installer inside a fresh vm realm (the page bootstrap serializes it the same way).
export function surfaceFixture(entries, { setup = '', mocks = '' } = {}) {
  const context = vm.createContext({ DOMException });
  vm.runInContext(mocks + '\n' + setup + '\nglobalThis.installSurfaceCustom = (' + installSurfaceCustom.toString() + ');', context);
  context.entries = entries.map(row => ({ mode: 'custom', ...row }));
  vm.runInContext('globalThis.guard = installSurfaceCustom(globalThis, entries)', context);
  return source => vm.runInContext(source, context);
}

export const originOf = value => 'Object.defineProperty(globalThis, "origin", { get() { return ' + JSON.stringify(value) + '; }, configurable: true, enumerable: true });';

// Chromium-shaped Location.ancestorOrigins for a vm realm: an unforgeable accessor on `location`, a DOMStringList-like value
// (indexed own entries, `length` on the prototype) whose item()/contains()/iterator/toString/forEach/at are tripwires counted in
// globalThis.trips. Options break one link of the chain: data (plain Array value, no DOMStringList), length (JS value), ownLength (an own
// "length" planted on the list instance, shadowing the prototype getter),
// listThrows, lengthThrows, locationThrows, none (location without ancestorOrigins, like Firefox and workers).
export function chainSetup(entries, { data = false, length, ownLength, listThrows = false, lengthThrows = false, locationThrows = false, none = false } = {}) {
  return `(() => {
    globalThis.trips = 0;
    const trap = () => { globalThis.trips++; throw new Error('PAGE_METHOD'); };
    const entries = ${JSON.stringify(entries)};
    class DOMStringList {
      get length() { ${lengthThrows ? "throw new Error('LENGTH');" : ''} return ${length === undefined ? 'entries.length' : JSON.stringify(length)}; }
      item() { trap(); } contains() { trap(); } toString() { trap(); } forEach() { trap(); } at() { trap(); } [Symbol.iterator]() { trap(); }
    }
    const list = ${data ? '[...entries]' : 'Object.create(DOMStringList.prototype)'};
    ${data ? '' : "entries.forEach((value, index) => Object.defineProperty(list, index, { value, enumerable: true, writable: true, configurable: true }));"}
    ${data ? '' : 'globalThis.DOMStringList = DOMStringList;'}
    ${ownLength === undefined ? '' : 'Object.defineProperty(list, "length", { value: ' + JSON.stringify(ownLength) + ', configurable: true });'}
    globalThis.chainList = list;
    const location = {};
    ${none ? '' : `Object.defineProperty(location, 'ancestorOrigins', { get() { ${listThrows ? "throw new Error('LIST');" : ''} return list; }, enumerable: true, configurable: false });`}
    Object.defineProperty(globalThis, 'location', { get() { ${locationThrows ? "throw new Error('LOCATION');" : ''} return location; }, enumerable: true, configurable: true });
  })();`;
}

// Web Audio shaped like the browser: engine-produced buffers (startRendering, decodeAudioData, engineBuffer) are built from the
// unwrapped class, so only buffers created through the page-visible constructor or createBuffer can be tracked as page-authored.
export const AUDIO_MOCKS = `(() => {
  const contexts = new WeakMap(), buffers = new WeakMap();
  const counts = globalThis.counts = { construct: 0, create: 0, channelReads: 0, copies: 0, render: 0, decode: 0 };
  globalThis.last = { construct: null, create: null };
  globalThis.failure = new DOMException('Synthetic native audio failure', 'NotSupportedError');
  let internal = false;
  function own(buffer) { const found = buffers.get(buffer); if (!found) throw new TypeError('Illegal invocation'); return found; }
  class AudioBuffer {
    constructor(options) {
      if (!internal) { counts.construct++; globalThis.last.construct = { args: [...arguments], target: new.target }; }
      if (options === null || typeof options !== 'object') throw new TypeError("Failed to construct 'AudioBuffer': parameter 1 is not of type 'AudioBufferOptions'.");
      const length = Number(options.length), channels = options.numberOfChannels === undefined ? 1 : Number(options.numberOfChannels), sampleRate = Number(options.sampleRate);
      if (!(length >= 1 && length <= 4194304) || !(channels >= 1 && channels <= 32) || !(sampleRate > 0)) throw globalThis.failure;
      buffers.set(this, { data: Array.from({ length: channels }, () => new Float32Array(length)), sampleRate, length });
    }
    get length() { return own(this).length; }
    get numberOfChannels() { return own(this).data.length; }
    get sampleRate() { return own(this).sampleRate; }
    getChannelData(channel) {
      const found = own(this); counts.channelReads++; const index = Number(channel) >>> 0;
      if (index >= found.data.length) throw new DOMException('channel index', 'IndexSizeError');
      return found.data[index];
    }
    copyFromChannel(destination, channel, start = 0) {
      const found = own(this); counts.copies++; const index = Number(channel) >>> 0, offset = Number(start) >>> 0;
      if (index >= found.data.length) throw new DOMException('channel index', 'IndexSizeError');
      const count = Math.max(0, Math.min(destination.length, found.data[index].length - offset));
      for (let at = 0; at < count; at++) destination[at] = found.data[index][offset + at];
    }
    copyToChannel(source, channel, start = 0) {
      const found = own(this); const index = Number(channel) >>> 0, offset = Number(start) >>> 0;
      if (index >= found.data.length) throw new DOMException('channel index', 'IndexSizeError');
      const count = Math.max(0, Math.min(source.length, found.data[index].length - offset));
      for (let at = 0; at < count; at++) found.data[index][offset + at] = source[at];
    }
  }
  const NativeAudioBuffer = AudioBuffer;
  function make(options) { internal = true; try { return new NativeAudioBuffer(options); } finally { internal = false; } }
  const sample = index => Math.fround(index === 0 ? 0 : Math.sin(index) * 0.75);
  function sine(buffer) { for (const data of buffers.get(buffer).data) for (let index = 0; index < data.length; index++) data[index] = sample(index); return buffer; }
  class BaseAudioContext {
    createBuffer(channels, length, sampleRate) {
      if (!contexts.has(this)) throw new TypeError('Illegal invocation');
      counts.create++; globalThis.last.create = { receiver: this, args: [...arguments] };
      return make({ numberOfChannels: channels, length, sampleRate });
    }
    decodeAudioData() { if (!contexts.has(this)) throw new TypeError('Illegal invocation'); counts.decode++; return Promise.resolve(sine(make({ numberOfChannels: 1, length: 64, sampleRate: 44100 }))); }
  }
  class AudioContext extends BaseAudioContext { constructor() { super(); contexts.set(this, { offline: false }); } }
  class OfflineAudioContext extends BaseAudioContext {
    constructor() { super(); contexts.set(this, { offline: true }); }
    startRendering() { if (!contexts.has(this)) throw new TypeError('Illegal invocation'); counts.render++; return Promise.resolve(sine(make({ numberOfChannels: 1, length: 64, sampleRate: 44100 }))); }
  }
  for (const [name, value] of Object.entries({ AudioBuffer, BaseAudioContext, AudioContext, OfflineAudioContext })) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });
  // Test-only back doors to the unwrapped native storage and the engine-side factory.
  globalThis.sampleAt = sample; globalThis.NativeAudioBufferClass = NativeAudioBuffer;
  globalThis.rawChannel = (buffer, channel = 0) => buffers.get(buffer).data[channel];
  globalThis.engineBuffer = (options, filled = true) => { const buffer = make(options); return filled ? sine(buffer) : buffer; };
  globalThis.bitsOf = (view, from, count) => Array.from(new Uint32Array(view.buffer, view.byteOffset + from * 4, count), word => word.toString(16).padStart(8, '0')).join(',');
})();
`;
