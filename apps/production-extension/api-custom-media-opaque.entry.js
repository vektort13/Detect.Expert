// ADR-101: inaccessible documents cannot query the private media backend.
import {installApiCustomOpaque} from './api-custom-opaque.entry.js';
import {installMediaCapabilitiesBridge} from './api-custom-media-bridge.js';
installApiCustomOpaque(globalThis,'media-capabilities',null,(realm,entries)=>{
 installMediaCapabilitiesBridge(realm,entries[0].value,{channel:'detect-expert-media-v1:000',bitrateBits:32});
});
