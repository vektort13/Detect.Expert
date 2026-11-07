// ADR-087: fixed metadata in inaccessible realms; readbacks require a trusted profile.
import { installApiCustomOpaque } from './api-custom-opaque.entry.js';
import { installApiCustomEnvironment } from './api-custom-environment-runtime.js';
import { installIntlCustom } from './api-custom-intl-runtime.js';
import { installSurfaceCustom } from './api-custom-surfaces-runtime.js';

const id = __DETECT_EXPERT_OPAQUE_API_ID__;
installApiCustomOpaque(globalThis, id, null, (realm, entries) => {
  if (id === 'audio-fingerprint' || id === 'webgl-readback') {
    // Every covered readback fails before its native call: AudioBuffer samples, the four AnalyserNode readouts (ADR-107) and readPixels.
    const analyser = ['getFloatFrequencyData', 'getByteFrequencyData', 'getFloatTimeDomainData', 'getByteTimeDomainData'];
    const targets = id === 'audio-fingerprint' ? [[realm.AudioBuffer?.prototype, ['getChannelData', 'copyFromChannel']], [realm.AnalyserNode?.prototype, analyser]]
      : [[realm.WebGLRenderingContext?.prototype, ['readPixels']], [realm.WebGL2RenderingContext?.prototype, ['readPixels']]];
    for (let index = 0; index < targets.length; index++) {
      const prototype = targets[index][0], names = targets[index][1];
      for (let name = 0; prototype && name < names.length; name++) {
        const field = Object.getOwnPropertyDescriptor(prototype, names[name]);
        if (field?.configurable && typeof field.value === 'function') {
          let self; // ADR-112: a denial Proxy refuses to close a prototype cycle through itself (Object.setPrototypeOf(fn, fn)) with the engine's own TypeError, as the native function does.
          const denied = self = new Proxy(field.value, { apply() { throw new DOMException('Readback profile unavailable in this frame', 'SecurityError'); }, setPrototypeOf(target, value) { if (value === self) { Object.setPrototypeOf(target, target); return false; } return Reflect.setPrototypeOf(target, value); } });
          Object.defineProperty(prototype, names[name], { ...field, value: denied });
        }
      }
    }
    return;
  }
  installSurfaceCustom(realm, [{ ...entries[0], opaqueNeutral: true }]);
  installApiCustomEnvironment(realm, entries);
  installIntlCustom(realm, entries);
});
