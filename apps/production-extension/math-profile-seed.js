// ADR-065 / ADR-106: private Math noise key bound to the applied profile; never part of the portable configuration or page bridge.
import { ProfileNoiseSeeds } from './profile-noise-seed.js';
export const MATH_NOISE_PURPOSE = 'math-transcendentals:v1';
export class MathProfileSeed {
  constructor(api, noise = new ProfileNoiseSeeds(api)) { this.noise = noise; }
  async prepare(entries) {
    if (!entries.some(entry => entry.id === 'math-transcendentals' && entry.mode === 'custom' && entry.selected?.kind === 'value' && entry.selected.value.functions.length)) return null;
    return this.noise.derive(MATH_NOISE_PURPOSE, entries);
  }
}
