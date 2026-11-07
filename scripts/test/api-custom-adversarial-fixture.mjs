// ADR-048: native post-installation checks. No original hardware values leave the fixture.
export const ADVERSARIAL_CUSTOM_ENTRIES = [
  { id: 'hardware-concurrency', value: 257 },
  { id: 'navigator-platform', value: 'detect-expert-adversarial-platform' },
  { id: 'screen-width', value: 1234 },
  { id: 'window-device-pixel-ratio', value: 1.75 },
  { id: 'webgl', value: { vendor: 'detect-expert-vendor', renderer: 'detect-expert-renderer', unmaskedVendor: 'detect-expert-unmasked-vendor', unmaskedRenderer: 'detect-expert-unmasked-renderer' } },
  { id: 'webgpu', value: { vendor: 'detect-expert-gpu-vendor', architecture: 'detect-expert-gpu-architecture', device: 'detect-expert-gpu-device', description: 'detect-expert-gpu-description' } },
  { id: 'media-enumeration', value: [
    { kind: 'audioinput', deviceId: 'detect-expert-microphone', groupId: 'detect-expert-input-group', label: 'detect.expert test microphone' },
    { kind: 'audiooutput', deviceId: 'detect-expert-speaker', groupId: 'detect-expert-output-group', label: 'detect.expert test speaker' },
    { kind: 'videoinput', deviceId: 'detect-expert-camera', groupId: 'detect-expert-camera-group', label: 'detect.expert test camera' }
  ] }
];

// Self-contained so the same function can run in native Chrome and Firefox pages.
export async function nativeCustomAdversarialProbe(entries) {
  const checks = [], expected = new Map(entries.map(entry => [entry.id, entry.value]));
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ?
    Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const pass = (id, actual, selected) => checks.push({ id, status: equal(actual, selected) ? 'pass' : 'fail', actualType: actual === null ? 'null' : typeof actual });
  const unsupported = id => checks.push({ id, status: 'unsupported' });
  function descriptor(target, key) {
    for (let index = 0; target !== null && index < 16; index++, target = Object.getPrototypeOf(target)) {
      const found = Object.getOwnPropertyDescriptor(target, key);
      if (found) return found;
    }
    return undefined;
  }
  for (const [id, target, key] of [
    ['hardware-concurrency', navigator, 'hardwareConcurrency'],
    ['navigator-platform', navigator, 'platform'],
    ['screen-width', screen, 'width'],
    ['window-device-pixel-ratio', window, 'devicePixelRatio']
  ]) {
    const selected = expected.get(id), found = descriptor(target, key);
    if (!found || !expected.has(id)) { unsupported(id); continue; }
    pass(id + ':direct', target[key], selected);
    if (typeof found.get === 'function') {
      pass(id + ':getter.call', Reflect.apply(found.get, target, []), selected);
      const saved = found.get;
      pass(id + ':saved-getter.call', Reflect.apply(saved, target, []), selected);
    }
  }
  if (expected.has('webgl')) {
    const value = expected.get('webgl');
    const contexts = [];
    for (const kind of ['webgl', 'webgl2']) {
      let context = null;
      try { context = document.createElement('canvas').getContext(kind); } catch {}
      if (context) contexts.push({ kind, context }); else unsupported(kind);
      if (typeof OffscreenCanvas === 'function') {
        let offscreen = null;
        try { offscreen = new OffscreenCanvas(2, 2).getContext(kind); } catch {}
        if (offscreen) contexts.push({ kind: 'offscreen-' + kind, context: offscreen }); else unsupported('offscreen-' + kind);
      }
    }
    for (const { kind, context } of contexts) {
      const debug = context.getExtension('WEBGL_debug_renderer_info');
      const parameters = [[7936, value.vendor], [7937, value.renderer]];
      if (debug) parameters.push([debug.UNMASKED_VENDOR_WEBGL, value.unmaskedVendor], [debug.UNMASKED_RENDERER_WEBGL, value.unmaskedRenderer]);
      else unsupported(kind + ':debug-metadata');
      const saved = context.getParameter, borrowed = descriptor(Object.getPrototypeOf(context), 'getParameter')?.value;
      for (const [parameter, selected] of parameters) {
        pass(kind + ':' + parameter + ':direct', context.getParameter(parameter), selected);
        pass(kind + ':' + parameter + ':numeric-string', context.getParameter(String(parameter)), selected);
        pass(kind + ':' + parameter + ':uint32-wrapped', context.getParameter(2 ** 32 + parameter), selected);
        pass(kind + ':' + parameter + ':fraction', context.getParameter(parameter + 0.75), selected);
        pass(kind + ':' + parameter + ':saved.call', Reflect.apply(saved, context, [parameter]), selected);
        if (typeof borrowed === 'function') pass(kind + ':' + parameter + ':prototype.call', Reflect.apply(borrowed, context, [parameter]), selected);
        let coercions = 0;
        const opaque = { valueOf() { coercions++; return parameter; } };
        pass(kind + ':' + parameter + ':opaque-withheld', context.getParameter(opaque), undefined);
        pass(kind + ':' + parameter + ':one-coercion', coercions, 1);
      }
    }
  }
  if (expected.has('media-enumeration') && navigator.mediaDevices?.enumerateDevices) {
    // ADR-107: rows sit on native devices of the same kind in native order (k-th device of a kind <- k-th row of that kind);
    // never more rows than rows selected, never a created record.
    const values = expected.get('media-enumeration'), devices = await navigator.mediaDevices.enumerateDevices(), position = {};
    pass('media:count-at-most-rows', devices.length <= values.length, true);
    let nativeObjects = 0;
    for (let index = 0; index < devices.length; index++) {
      const device = devices[index], kind = device.kind;
      position[kind] = (position[kind] ?? -1) + 1;
      const selected = values.filter(row => row.kind === kind)[position[kind]];
      if (!selected) { pass('media:' + index + ':row-of-same-kind', 'missing', 'present'); continue; }
      pass('media:' + index + ':native-object', typeof MediaDeviceInfo === 'function' && device instanceof MediaDeviceInfo, true);
      for (const key of ['kind', 'deviceId', 'groupId', 'label']) {
        pass('media:' + index + ':' + key + ':direct', device[key], selected[key]);
        const getter = typeof MediaDeviceInfo === 'function' && descriptor(MediaDeviceInfo.prototype, key)?.get;
        if (getter) {
          try { pass('media:' + index + ':' + key + ':prototype.call', Reflect.apply(getter, device, []), selected[key]); }
          catch (error) { pass('media:' + index + ':' + key + ':metadata-only-brand', error.name, 'TypeError'); }
        }
      }
      pass('media:' + index + ':toJSON', device.toJSON(), selected);
      if (typeof device.getCapabilities === 'function') {
        const inspectCapabilities = (capabilities, label) => {
          pass('media:' + index + ':' + label + ':own-data-fields', Reflect.ownKeys(capabilities).every(key => key !== '__proto__' && Object.hasOwn(descriptor(capabilities, key), 'value')), true);
          for (const key of ['deviceId', 'groupId']) if (Object.hasOwn(capabilities, key)) pass('media:' + index + ':' + label + ':' + key, capabilities[key], selected[key]);
        };
        inspectCapabilities(device.getCapabilities(), 'capabilities');
        const borrowed = descriptor(Object.getPrototypeOf(device), 'getCapabilities')?.value;
        if (typeof borrowed === 'function') inspectCapabilities(Reflect.apply(borrowed, device, []), 'prototype.getCapabilities.call');
      }
      if (typeof MediaDeviceInfo === 'function' && device instanceof MediaDeviceInfo) {
        nativeObjects++;
        const toJSON = descriptor(MediaDeviceInfo.prototype, 'toJSON')?.value;
        if (typeof toJSON === 'function') pass('media:' + index + ':prototype.toJSON.call', Reflect.apply(toJSON, device, []), selected);
      }
    }
    if (nativeObjects) pass('media:native-object-prototype-coverage', nativeObjects > 0, true);
    else unsupported('media:native-object-prototype-coverage');
  } else unsupported('media-enumeration');
  if (expected.has('webgpu') && navigator.gpu?.requestAdapter) {
    let adapter = null;
    try { adapter = await navigator.gpu.requestAdapter(); } catch {}
    if (!adapter) unsupported('webgpu:native-adapter');
    else {
      const value = expected.get('webgpu');
      const inspect = (info, label) => {
        for (const key of ['vendor', 'architecture', 'device', 'description']) {
          pass('webgpu:' + label + ':' + key, info[key], value[key]);
          const getter = descriptor(Object.getPrototypeOf(info), key)?.get;
          if (getter) pass('webgpu:' + label + ':' + key + ':prototype.call', Reflect.apply(getter, info, []), value[key]);
        }
      };
      if ('info' in adapter) {
        inspect(adapter.info, 'info');
        const getter = descriptor(Object.getPrototypeOf(adapter), 'info')?.get;
        if (getter) inspect(Reflect.apply(getter, adapter, []), 'borrowed-info');
      } else unsupported('webgpu:info');
      if (typeof adapter.requestAdapterInfo === 'function') inspect(await adapter.requestAdapterInfo(), 'requestAdapterInfo');
      else unsupported('webgpu:legacy-requestAdapterInfo');
    }
  } else unsupported('webgpu');
  return { checks, failures: checks.filter(check => check.status === 'fail'), passed: checks.filter(check => check.status === 'pass').length,
    unsupported: checks.filter(check => check.status === 'unsupported').map(check => check.id) };
}
