// ADR-060: RTC-only opaque bundle keeps the remaining 37 guards small.
import { installApiCustomOpaque } from './api-custom-opaque.entry.js';
import { installWebRtcCustom } from './api-custom-webrtc-runtime.js';
installApiCustomOpaque(globalThis, 'webrtc', installWebRtcCustom);
