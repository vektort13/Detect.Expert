// Technique registry facts used by the engine (spec Part III §2, sections 2.1–2.6). Categories follow the
// registry subsections; DET-067/068 are documented coverage boundaries, not detectors.

import type { TechniqueId } from '@detect-expert/contracts';

export const TECHNIQUE_CATEGORIES = [
  'graphics',
  'media-compute',
  'environment',
  'devices',
  'storage',
  'network',
  'boundary',
] as const;
export type TechniqueCategory = (typeof TECHNIQUE_CATEGORIES)[number];

/** Registry subsection of a technique (spec III §2.1–2.6). */
export function techniqueCategory(id: TechniqueId): TechniqueCategory {
  const n = Number(id.slice(4));
  if (n <= 14) return 'graphics';
  if (n <= 24) return 'media-compute';
  if (n <= 38) return 'environment';
  if (n <= 48 || n === 69) return 'devices';
  if (n <= 55) return 'storage';
  if (n <= 66) return 'network';
  return 'boundary';
}

/** Slice 1: canvas family (E07-01). */
export const CANVAS_TECHNIQUE_IDS = ['DET-001', 'DET-002', 'DET-003', 'DET-004'] as const;
export type CanvasTechniqueId = (typeof CANVAS_TECHNIQUE_IDS)[number];

const CANVAS_SET: ReadonlySet<string> = new Set<string>(CANVAS_TECHNIQUE_IDS);

export function isCanvasTechnique(id: TechniqueId): id is CanvasTechniqueId {
  return CANVAS_SET.has(id);
}

/** Techniques whose call hands pixels (or an encoded image) back to the page. DET-003 only draws/measures. */
export const CANVAS_READOUT_TECHNIQUE_IDS = ['DET-002', 'DET-001', 'DET-004'] as const;

/** UI message keys per technique (docs/ui-copy.md §4.1). Techniques without a key use `card_api_use_generic`. */
export const TECHNIQUE_LABEL_KEYS: Readonly<Partial<Record<TechniqueId, string>>> = Object.freeze({
  'DET-001': 'card_api_use_canvas_export',
  'DET-002': 'card_api_use_canvas_readback',
  'DET-003': 'card_api_use_canvas_text',
  'DET-004': 'card_api_use_offscreen',
});

/** API surface names shown verbatim in both locales ($API$ placeholder). Never page data. */
export const TECHNIQUE_API_NAMES: Readonly<Partial<Record<TechniqueId, string>>> = Object.freeze({
  'DET-001': 'toDataURL / toBlob',
  'DET-002': 'getImageData',
  'DET-003': 'measureText / fillText / strokeText',
  'DET-004': 'OffscreenCanvas',
});
