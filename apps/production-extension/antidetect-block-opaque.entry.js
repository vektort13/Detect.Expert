// ADR-064: fallback only for inherited opaque realms; normal documents use their exact profile.
import { installAntidetectBlocks } from './antidetect-block-runtime.js';
if (typeof __DETECT_EXPERT_BLOCK_API_ID__ === 'string' && ['about:', 'blob:', 'data:'].includes(globalThis.location?.protocol)) {
  const marker = Symbol.for('detect.expert/api-custom/document/v2');
  if (Object.getOwnPropertyDescriptor(globalThis, marker)?.value !== true) installAntidetectBlocks(globalThis, [{ id: __DETECT_EXPERT_BLOCK_API_ID__, mode: 'on' }]);
}
