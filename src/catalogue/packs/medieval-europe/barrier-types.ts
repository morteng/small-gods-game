/**
 * Medieval-Europe content pack — BARRIER TYPE catalogue (linear enclosures).
 *
 * Pure data: the linear structures that bound a croft or a settlement — living
 * hedges, paling fences, drystone field walls, timber palisades, and masonry town
 * walls. Each entry follows `FactEntry<BarrierTypeFields>`: an LOD description
 * ladder plus structured fields (the runtime barrier primitive, real metric
 * dimensions, render material, and selection metadata). Worldgen's enclosure
 * placement (`src/world/enclosure.ts`, DC-3) reads these to ring crofts and
 * settlements with period-correct barriers.
 *
 * Dimensions are grounded in the cited Wikipedia sources (provenance) and the
 * project's metric scale contract (1 tile = 2 m).
 *
 * Selection axes:
 *  - `scale: 'croft'`      → placed around an individual burgage-lot yard.
 *  - `scale: 'settlement'` → placed as a ring around the whole built area; the
 *    smallest settlement it suits is `minBuildings` (a hamlet gets only crofts;
 *    a village a palisade; a town a stone wall).
 */
import type { FactEntry, BarrierTypeFields } from '@/catalogue/types';

export const MEDIEVAL_BARRIER_TYPES: FactEntry<BarrierTypeFields>[] = [
  // ── Croft / field boundaries ──────────────────────────────────────────────
  {
    id: 'hedge',
    kind: 'barrierType',
    pack: 'medieval-europe',
    lod: {
      l0: 'A living hedge of closely planted shrubs marking a croft or field boundary.',
      l1: ['densely spaced shrubs', 'low and bushy', 'a "live fence"', 'a windbreak for crops'],
      l2: 'A line of closely spaced (a yard apart or less) shrubs and small trees, planted and trained as a living barrier to pen stock and mark a boundary between plots. The humblest enclosure: it grows rather than being built, and in bocage country doubles as a windbreak.',
    },
    fields: {
      barrierKind: 'hedge', heightM: 1.5, thicknessTiles: 1, material: 'hedge',
      scale: 'croft', gateWidthTiles: 1.5,
    },
    provenance: ['https://en.wikipedia.org/wiki/Hedge'],
    visibility: 'geometry',
    tags: ['enclosure', 'living', 'croft', 'boundary'],
  },
  {
    id: 'paling-fence',
    kind: 'barrierType',
    pack: 'medieval-europe',
    lod: {
      l0: 'A low timber paling fence of riven stakes around a yard.',
      l1: ['split timber pales', 'driven on posts', 'waist-to-chest high', 'gaps between the pales'],
      l2: 'A wattle or paling fence of cleft stakes set on posts, the everyday enclosure of a town yard or garden plot. Quick and cheap to raise from coppice wood, tall enough to keep pigs and poultry but no defence.',
    },
    fields: {
      barrierKind: 'fence', heightM: 1.1, thicknessTiles: 1, material: 'timber',
      posts: true, scale: 'croft', gateWidthTiles: 1.5,
    },
    visibility: 'geometry',
    tags: ['enclosure', 'timber', 'croft', 'yard'],
  },
  {
    id: 'drystone-wall',
    kind: 'barrierType',
    pack: 'medieval-europe',
    applicability: { regions: ['upland', 'north'] },
    lod: {
      l0: 'A mortarless wall of interlocking field stone bounding a plot.',
      l1: ['unmortared stacked stone', 'battered (tapering) faces', 'a stone cope on top', 'roughly chest high'],
      l2: 'A wall built from stones laid without mortar, bound only by careful interlocking, the traditional boundary of upland fields and churchyards where stone is cleared from the ground in plenty. Durable for centuries with no timber.',
    },
    fields: {
      barrierKind: 'wall', heightM: 1.3, thicknessTiles: 1, material: 'stone',
      scale: 'croft', gateWidthTiles: 1.5,
    },
    provenance: ['https://en.wikipedia.org/wiki/Dry_stone'],
    visibility: 'geometry',
    tags: ['enclosure', 'stone', 'croft', 'field'],
  },

  // ── Settlement enclosures ─────────────────────────────────────────────────
  {
    id: 'timber-palisade',
    kind: 'barrierType',
    pack: 'medieval-europe',
    lod: {
      l0: 'A defensive ring of closely set tall timber stakes around a settlement.',
      l1: ['row of high upright trunks', 'pointed tops', 'a walkway behind', 'gated where roads enter'],
      l2: 'A stockade of closely placed, high vertical tree trunks or stakes forming a defensive wall — the enclosure of a ringwork or a stockaded village, and the bailey ring of a motte-and-bailey castle. Buildable with unskilled labour yet militarily formidable.',
    },
    fields: {
      barrierKind: 'palisade', heightM: 3.0, thicknessTiles: 1, material: 'timber',
      posts: true, scale: 'settlement', minBuildings: 6, gateWidthTiles: 3,
    },
    provenance: [
      'https://en.wikipedia.org/wiki/Palisade',
      'https://en.wikipedia.org/wiki/Motte-and-bailey_castle',
    ],
    visibility: 'geometry',
    tags: ['enclosure', 'defensive', 'timber', 'settlement'],
  },
  {
    id: 'town-wall',
    kind: 'barrierType',
    pack: 'medieval-europe',
    applicability: { wealth: ['comfortable', 'wealthy', 'elite'] },
    lod: {
      l0: 'A masonry curtain wall with crenellated parapet enclosing a town.',
      l1: ['high mortared stone curtain', 'crenellated battlements', 'gate towers at the roads', 'follows rivers and cliffs'],
      l2: 'A defensive curtain wall of mortared stone enclosing a town, crowned with a crenellated parapet and pierced by fortified gates where the roads enter. Beyond defence it proclaimed the status and independence of the community, and it incorporated rivers and coastline into its line where the terrain offered them.',
    },
    fields: {
      barrierKind: 'wall', heightM: 6.0, thicknessTiles: 2, material: 'stone',
      crenellated: true, scale: 'settlement', minBuildings: 12, gateWidthTiles: 3.5,
    },
    provenance: [
      'https://en.wikipedia.org/wiki/Defensive_wall',
      'https://en.wikipedia.org/wiki/Walls_of_Constantinople',
    ],
    visibility: 'geometry',
    tags: ['enclosure', 'defensive', 'stone', 'town', 'status'],
  },
];
