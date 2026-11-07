// ADR-020 §F (S10): script attribution lane of the module «Защита». MAIN send/registration samples (page-controlled)
// correlated with webRequest in SW memory; the port is published as ctx.ports.attribution while the lane runs.
// Consumers cast it: `const port = ctx.ports.attribution as AttributionPort | null` (value-match S07, firewall S08,
// replay S11).

import { AttributionService } from './service';
import type { AttributionServiceOptions } from './service';

export {
  AttributionService,
  MAX_RESULTS,
  PASSWORD_LISTENER_EVENTS,
  RESULT_TTL_MS,
  SAMPLE_TTL_MS,
  SETTLE_MS,
  siteOfMaskedHost,
} from './service';
export type { AttributionListener, AttributionPort, AttributionServiceOptions } from './service';

export function createAttributionService(options: AttributionServiceOptions = {}): AttributionService {
  return new AttributionService(options);
}
