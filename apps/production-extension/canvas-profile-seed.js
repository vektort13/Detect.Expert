// ADR-066 / ADR-106: private Canvas noise key bound to the applied profile; never a portable fingerprint value.
import { ProfileNoiseSeeds } from './profile-noise-seed.js';
export const CANVAS_NOISE_PURPOSE = 'canvas-projection:v1';
export class CanvasProfileSeed {
  constructor(api, noise = new ProfileNoiseSeeds(api)) { this.noise = noise; }
  async prepare(entries) {
    if (!entries.some(row => row.id === 'canvas-readback' && row.mode === 'custom' && row.selected?.kind === 'value')) return null;
    return this.noise.derive(CANVAS_NOISE_PURPOSE, entries);
  }
}
