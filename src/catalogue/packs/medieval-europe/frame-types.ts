/**
 * medieval-europe pack — structural frame types. The carpentry/masonry system that
 * carries the walls + roof. Slice 3 makes `frameType` first-class in geometry
 * (cruck vs box-frame shape the bay rhythm); seeded now so the facts exist.
 */
import type { FactEntry, FrameTypeFields } from '@/catalogue/types';

const f = (
  id: string,
  l0: string,
  l1: string[],
  regionAffinity: string[] | undefined,
  l2?: string,
): FactEntry<FrameTypeFields> => ({
  id,
  kind: 'frameType',
  pack: 'medieval-europe',
  lod: { l0, l1, l2 },
  fields: regionAffinity ? { regionAffinity } : {},
  visibility: 'data-only',
});

export const MEDIEVAL_FRAME_TYPES: FactEntry<FrameTypeFields>[] = [
  f(
    'cruck',
    'cruck frame — paired curved blades from ground to ridge',
    ['A-frame blades', 'no separate wall posts', 'bay-defined'],
    ['britain', 'wales'],
    'Pairs of naturally curved timbers (blades) rise from near ground level to meet at the ridge, defining the building in bays. Common for peasant and yeoman houses.',
  ),
  f(
    'box-frame',
    'box frame — posts, plates and tie-beams forming rigid boxes',
    ['vertical studs', 'wall plates', 'jowled posts'],
    ['england', 'lowlands'],
    'Walls of vertical and horizontal members carry the roof on wall plates; the dominant town and high-status timber system, enabling jetties and multiple storeys.',
  ),
  f(
    'mass-wall',
    'mass wall — load-bearing stone or cob with no separate frame',
    ['thick solid walls', 'small openings', 'self-supporting'],
    undefined,
    'Solid masonry or cob carries all loads; openings are limited by wall strength. Used for keeps, churches, and durable houses where stone is at hand.',
  ),
  f(
    'stave',
    'stave construction — vertical timber staves set in a sill or earth',
    ['upright planks', 'tarred surface', 'shingled'],
    ['scandinavia'],
    'Vertical wooden staves form the walls, famously in stave churches; an earlier earth-fast variant set posts directly in the ground.',
  ),
];
