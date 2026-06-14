/**
 * medieval-europe pack — roof coverings. Pitch (ridge rise fraction) + eave
 * (overhang fraction) match the values pinned in
 * `docs/reference/medieval-building-reference.md` and used by the geometry v7 pass.
 * These are the same material ids as the `roof` role in `materials.ts`; this kind
 * carries the geometric pitch/eave the material kind does not.
 */
import type { FactEntry, RoofCoveringFields } from '@/catalogue/types';

const r = (
  id: string,
  pitch: number,
  eave: number,
  l0: string,
  l1: string[],
): FactEntry<RoofCoveringFields> => ({
  id,
  kind: 'roofCovering',
  pack: 'medieval-europe',
  lod: { l0, l1 },
  fields: { pitch, eave },
  visibility: 'geometry',
});

export const MEDIEVAL_ROOF_COVERINGS: FactEntry<RoofCoveringFields>[] = [
  r('thatch', 0.3, 0.15, 'thatched roof — steepest pitch, deepest eaves', ['steep', 'deep overhang', 'combed ridge']),
  r('wood', 0.24, 0.12, 'board / shake roof', ['mid pitch', 'plank seams']),
  r('shingle', 0.24, 0.12, 'wooden-shingle roof', ['mid pitch', 'split oak courses']),
  r('tile', 0.2, 0.1, 'clay-tile roof', ['shallower pitch', 'red ridge tiles']),
  r('slate', 0.1, 0.0, 'stone-slate roof — shallowest, flush eaves', ['low pitch', 'heavy', 'flush verge']),
];
