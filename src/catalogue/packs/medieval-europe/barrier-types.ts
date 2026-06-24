/**
 * Medieval-Europe content pack — BARRIER TYPE catalogue (linear structures).
 *
 * Pure data. Two families share one `FactEntry<BarrierTypeFields>` shape:
 *
 *  1. CROFT / SETTLEMENT ENCLOSURES (`scale: 'croft' | 'settlement'`) — living hedges,
 *     paling fences, drystone field walls, timber palisades and masonry town walls.
 *     The LIVE worldgen enclosure placer (`src/world/enclosure.ts`, DC-3) reads these to
 *     ring crofts and settlements with period-correct barriers. Dimensions are grounded
 *     in the cited Wikipedia sources and the metric scale contract (1 tile = 2 m).
 *
 *  2. DEFENDED-COMPLEX RINGS (`scale: 'complex'`) — the rampart/ditch/palisade/curtain
 *     the `enclosure` grammar wraps around the wards of a motte-and-bailey or ringwork
 *     (`blueprint/connectome/complex.ts`). These carry the defensive vocab (`kind`,
 *     `defensibility`, `heightHint`) the ring grammar reads. They sit at `scale:
 *     'complex'` so the croft/settlement enclosure picker never selects them — adding
 *     the complex layer leaves live enclosure output untouched.
 *
 * Selection axes (enclosure scales):
 *  - `scale: 'croft'`      → placed around an individual burgage-lot yard.
 *  - `scale: 'settlement'` → a ring around the whole built area; the smallest settlement
 *    it suits is `minBuildings` (a hamlet gets only crofts; a village a palisade; a town
 *    a stone wall).
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
      kind: 'wall', defensibility: 0.5, heightHint: 3,
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
      kind: 'wall', defensibility: 0.8, heightHint: 6,
    },
    provenance: [
      'https://en.wikipedia.org/wiki/Defensive_wall',
      'https://en.wikipedia.org/wiki/Walls_of_Constantinople',
    ],
    visibility: 'geometry',
    tags: ['enclosure', 'defensive', 'stone', 'town', 'status'],
  },

  // ── Defended-complex rings (scale: 'complex' — read by the enclosure grammar; ──
  //    INVISIBLE to the croft/settlement enclosure picker) ───────────────────────
  {
    id: 'palisade',
    kind: 'barrierType',
    pack: 'medieval-europe',
    lod: {
      l0: 'A timber stockade of upright logs ringing a castle ward.',
      l1: ['close-set tree-trunks', 'pointed tops', 'fighting walk behind', 'set on the rampart crest'],
      l2: 'A wall of split or whole tree-trunks set upright in the rampart crest, with a walkway behind. The standard early ring of a motte-and-bailey or ringwork — fast, cheap, and flammable; the form a stone curtain later replaced.',
    },
    fields: {
      barrierKind: 'palisade', heightM: 3.0, thicknessTiles: 1, material: 'timber',
      posts: true, scale: 'complex', gateWidthTiles: 3,
      kind: 'wall', defensibility: 0.5, heightHint: 3,
    },
    provenance: ['https://en.wikipedia.org/wiki/Palisade'],
    visibility: 'geometry',
    tags: ['ring', 'defensive', 'timber', 'complex'],
  },
  {
    id: 'rampart',
    kind: 'barrierType',
    pack: 'medieval-europe',
    lod: {
      l0: 'An earthen bank thrown up from the ditch spoil.',
      l1: ['heaped earth bank', 'palisade along the crest', 'spoil from the ditch'],
      l2: 'The defensive bank raised from the earth dug out of the ditch — the cheapest enclosure, usually crowned by a timber palisade. The bank and ditch are made in one operation, so their volumes balance.',
    },
    fields: {
      barrierKind: 'rampart', heightM: 2.5, thicknessTiles: 2, material: 'earth',
      scale: 'complex', gateWidthTiles: 3,
      kind: 'bank', defensibility: 0.4, heightHint: 2.5,
    },
    provenance: ['https://en.wikipedia.org/wiki/Rampart_(fortification)'],
    visibility: 'geometry',
    tags: ['ring', 'defensive', 'earthwork', 'complex'],
  },
  {
    id: 'ditch',
    kind: 'barrierType',
    pack: 'medieval-europe',
    lod: {
      l0: 'A dry ditch encircling the work.',
      l1: ['steep-sided cut', 'spoil thrown inward', 'wet if water is near'],
      l2: 'The encircling ditch (fosse). Dry on high ground; where the water table or a river allows, it fills as a wet moat. Its spoil builds the rampart and motte.',
    },
    fields: {
      barrierKind: 'ditch', heightM: 3.0, thicknessTiles: 3, material: 'earth',
      scale: 'complex', gateWidthTiles: 3,
      kind: 'ditch', defensibility: 0.6, heightHint: 3,
    },
    provenance: ['https://en.wikipedia.org/wiki/Defensive_fighting_position'],
    visibility: 'geometry',
    tags: ['ring', 'defensive', 'earthwork', 'complex'],
  },
  {
    id: 'curtain-wall',
    kind: 'barrierType',
    pack: 'medieval-europe',
    applicability: { wealth: ['wealthy', 'elite'] },
    lod: {
      l0: 'A high stone curtain between mural towers.',
      l1: ['ashlar or rubble masonry', 'crenellated parapet', 'wall-walk', 'flanking towers'],
      l2: 'The stone wall that replaced the palisade from the 12th century: a tall crenellated curtain with a wall-walk, flanked by projecting mural towers so defenders can rake the foot of the wall. The defining element of the stone castle.',
    },
    fields: {
      barrierKind: 'wall', heightM: 8.0, thicknessTiles: 2, material: 'stone',
      crenellated: true, scale: 'complex', gateWidthTiles: 3.5,
      kind: 'wall', defensibility: 0.85, heightHint: 8,
    },
    provenance: ['https://en.wikipedia.org/wiki/Defensive_wall'],
    visibility: 'geometry',
    tags: ['ring', 'defensive', 'stone', 'complex'],
  },
  {
    id: 'earth-dyke',
    kind: 'barrierType',
    pack: 'medieval-europe',
    lod: {
      l0: 'A long linear bank-and-ditch across the land.',
      l1: ['runs for miles', 'bank on one side, ditch on the other', 'no enclosure'],
      l2: 'A frontier earthwork that SPANS rather than encloses — a bank and ditch drawn across country to mark and hold a border (Offa’s Dyke, Wansdyke). Modelled as a spanning barrier with no zone it bounds.',
    },
    fields: {
      barrierKind: 'rampart', heightM: 2.0, thicknessTiles: 3, material: 'earth',
      scale: 'complex', gateWidthTiles: 0,
      kind: 'bank', defensibility: 0.3, heightHint: 2,
    },
    provenance: ['https://en.wikipedia.org/wiki/Offa%27s_Dyke'],
    visibility: 'geometry',
    tags: ['spanning', 'defensive', 'earthwork', 'frontier'],
  },
];
