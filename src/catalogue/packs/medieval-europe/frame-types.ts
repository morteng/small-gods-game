/**
 * medieval-europe pack — structural frame types. The carpentry/masonry system that
 * carries the walls + roof. This is the CONSTRUCTION axis of the layered connectome
 * (Layer 1): a building's structure subsystem (`blueprint/connectome/structure.ts`)
 * selects a frame from the wall material + era/region, then the frame GATES the form —
 * `jettyMax` says whether the upper storeys can overhang (a timber-frame trick),
 * `maxStoreys` how high it stacks, `bayModule`/`fenestration` how the walls are rhythmed
 * and opened. Different building TYPES share a frame (a cottage and a townhouse can both
 * be timber) — or not (a stone church is mass-wall). The numbers are pack content.
 */
import type { FactEntry, FrameTypeFields } from '@/catalogue/types';

const f = (
  id: string,
  l0: string,
  l1: string[],
  structural: FrameTypeFields,
  l2?: string,
): FactEntry<FrameTypeFields> => ({
  id,
  kind: 'frameType',
  pack: 'medieval-europe',
  lod: { l0, l1, l2 },
  fields: structural,
  visibility: 'data-only',
});

export const MEDIEVAL_FRAME_TYPES: FactEntry<FrameTypeFields>[] = [
  f(
    'cruck',
    'cruck frame — paired curved blades from ground to ridge',
    ['A-frame blades', 'no separate wall posts', 'bay-defined'],
    {
      regionAffinity: ['britain', 'wales'],
      wallAffinity: ['wattle', 'cob', 'timber', 'log', 'daub'],
      maxStoreys: 1, // blades meeting at the ridge leave no room to stack floors
      jettyMax: 0, // no wall posts to jetty from
      bayModule: 2.0, // the cruck truss defines a generous bay
      fenestration: { maxPerFace: 2, spacing: 1.9 },
    },
    'Pairs of naturally curved timbers (blades) rise from near ground level to meet at the ridge, defining the building in bays. Common for peasant and yeoman houses.',
  ),
  f(
    'box-frame',
    'box frame — posts, plates and tie-beams forming rigid boxes',
    ['vertical studs', 'wall plates', 'jowled posts'],
    {
      regionAffinity: ['england', 'lowlands'],
      wallAffinity: ['timber', 'log', 'brick'],
      maxStoreys: 3, // wall plates let storeys stack
      jettyMax: 0.15, // the jetty is THE box-frame signature
      bayModule: 1.6,
      fenestration: { maxPerFace: 3, spacing: 1.5 }, // framed panels glaze generously
    },
    'Walls of vertical and horizontal members carry the roof on wall plates; the dominant town and high-status timber system, enabling jetties and multiple storeys.',
  ),
  f(
    'mass-wall',
    'mass wall — load-bearing stone or cob with no separate frame',
    ['thick solid walls', 'small openings', 'self-supporting'],
    {
      wallAffinity: ['stone', 'cob', 'brick', 'flagstone', 'slate'],
      maxStoreys: 4, // thick walls carry height; each opening weakens them
      jettyMax: 0, // a solid wall cannot overhang
      bayModule: 2.4, // bays set by what the wall can span, not a frame
      fenestration: { maxPerFace: 2, spacing: 2.3 }, // openings limited by wall strength
    },
    'Solid masonry or cob carries all loads; openings are limited by wall strength. Used for keeps, churches, and durable houses where stone is at hand.',
  ),
  f(
    'stave',
    'stave construction — vertical timber staves set in a sill or earth',
    ['upright planks', 'tarred surface', 'shingled'],
    {
      regionAffinity: ['scandinavia'],
      wallAffinity: ['log', 'timber'],
      maxStoreys: 1,
      jettyMax: 0,
      bayModule: 1.4,
      fenestration: { maxPerFace: 1, spacing: 2.6 }, // staved walls keep openings few
    },
    'Vertical wooden staves form the walls, famously in stave churches; an earlier earth-fast variant set posts directly in the ground.',
  ),
];
