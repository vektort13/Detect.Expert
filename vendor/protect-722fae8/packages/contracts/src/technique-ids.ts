// Technique registry identifiers DET-001..DET-069 (spec Part III). Keep in sync with schemas/common.v1.schema.json.
export const TECHNIQUE_IDS = [
  'DET-001', 'DET-002', 'DET-003', 'DET-004', 'DET-005', 'DET-006', 'DET-007', 'DET-008',
  'DET-009', 'DET-010', 'DET-011', 'DET-012', 'DET-013', 'DET-014', 'DET-015', 'DET-016',
  'DET-017', 'DET-018', 'DET-019', 'DET-020', 'DET-021', 'DET-022', 'DET-023', 'DET-024',
  'DET-025', 'DET-026', 'DET-027', 'DET-028', 'DET-029', 'DET-030', 'DET-031', 'DET-032',
  'DET-033', 'DET-034', 'DET-035', 'DET-036', 'DET-037', 'DET-038', 'DET-039', 'DET-040',
  'DET-041', 'DET-042', 'DET-043', 'DET-044', 'DET-045', 'DET-046', 'DET-047', 'DET-048',
  'DET-049', 'DET-050', 'DET-051', 'DET-052', 'DET-053', 'DET-054', 'DET-055', 'DET-056',
  'DET-057', 'DET-058', 'DET-059', 'DET-060', 'DET-061', 'DET-062', 'DET-063', 'DET-064',
  'DET-065', 'DET-066', 'DET-067', 'DET-068', 'DET-069',
] as const;

export type TechniqueId = (typeof TECHNIQUE_IDS)[number];
