/**
 * medieval-europe pack — BUILDING TYPES. The hub: each entry names its `topology`
 * (→ grammar interpreter), its `roomProgram` (→ roomType ids), its `hearthRule`
 * (→ roomType + fixtureType ids), entrance, size, and default materials. The first
 * 14 ids MUST match the existing blueprint preset ids exactly (the coverage test
 * asserts every preset resolves to a buildingType). The trailing entries are
 * facts-only — primed for Slice 4 geometry; their room programmes exist now so the
 * connectome + briefs can already reason about them.
 */
import type { BuildingTypeFields, FactEntry, RoomSlot } from '@/catalogue/types';

type B = FactEntry<BuildingTypeFields>;

const room = (type: string, count = 1, bays = 1): RoomSlot => ({ type, count, bays });

const b = (
  id: string,
  topology: string,
  roomProgram: RoomSlot[],
  entrance: BuildingTypeFields['entrance'],
  hearthRule: BuildingTypeFields['hearthRule'],
  sizeBays: [number, number],
  defaultMaterials: Record<string, string>,
  lod: { l0: string; l1: string[]; l2?: string },
  extra: Partial<B> = {},
  // Optional cross-axis fields: establishment tokens read by the site grammar
  // (functions/requires/satisfies) + the `frame` construction hint read by the
  // structure subsystem (omitted ⇒ frame derived from the wall material).
  siteFields: Partial<Pick<BuildingTypeFields, 'functions' | 'requires' | 'satisfies' | 'frame' | 'undercroft'>> = {},
): B => ({
  id,
  kind: 'buildingType',
  pack: 'medieval-europe',
  lod,
  fields: { topology, roomProgram, entrance, hearthRule, sizeBays, defaultMaterials, ...siteFields },
  visibility: 'geometry',
  ...extra,
});

export const MEDIEVAL_BUILDING_TYPES: B[] = [
  // ── the 14 existing presets (ids must match presets/index.ts) ──────────────
  b('cottage', 'tripartite-linear',
    [room('hall', 1, 1)],
    { face: 's', sizeClass: 'human', portal: 'doorway' },
    { room: 'hall', fixture: 'open-hearth' },
    [1, 2], { walls: 'wattle', roof: 'thatch', ground: 'packed_dirt' },
    { l0: 'a one-room peasant cottage', l1: ['mud or wattle walls', 'thatched roof', 'central open hearth'],
      l2: 'A single-bay commoner dwelling, hearth in the middle of the floor, smoke escaping through a ridge louver — no chimney.' },
    { applicability: { eras: ['medieval'] }, provenance: ['https://en.wikipedia.org/wiki/Cottage'] },
    { frame: 'cruck' }),

  b('tavern', 'tripartite-linear',
    [room('taproom', 1, 1), room('kitchen', 1, 1), room('guest-chamber', 2, 1)],
    { face: 's', sizeClass: 'human', portal: 'doorway' },
    { room: 'kitchen', fixture: 'wall-fireplace' },
    [2, 3], { walls: 'timber', roof: 'tile', ground: 'packed_dirt' },
    { l0: 'a timber-framed tavern or inn', l1: ['jettied upper storey', 'twin chimney stacks', 'many windows'],
      l2: 'A cooking-and-lodging house: ground-floor taproom and kitchen, guest chambers above, smoke carried up real chimney stacks.' },
    { provenance: ['https://en.wikipedia.org/wiki/Inn'] },
    { functions: ['hospitality', 'commercial'], requires: ['stabling', 'signage', 'seating', 'water-supply'], frame: 'box-frame' }),

  b('townhouse', 'tripartite-linear',
    [room('parlour', 1, 1), room('chamber', 1, 1)],
    { face: 's', sizeClass: 'human', portal: 'doorway' },
    { room: 'parlour', fixture: 'wall-fireplace' },
    [1, 2], { walls: 'timber', roof: 'tile', ground: 'flagstone' },
    { l0: 'an urban burgage townhouse', l1: ['two jettied storeys', 'stone ground floor', 'gable to the street'],
      l2: 'The cottage’s town upgrade on a narrow burgage plot: parlour over a stone undercroft, chambers above, a proper chimney.' },
    { provenance: ['https://en.wikipedia.org/wiki/Burgage'] },
    { frame: 'box-frame', undercroft: true }),

  b('market_stall', 'tripartite-linear',
    [room('shopfront-stall', 1, 1)],
    { face: 's', sizeClass: 'human', portal: 'doorway' },
    { room: 'none' },
    [1, 1], { walls: 'timber', roof: 'thatch' },
    { l0: 'an open market stall', l1: ['lean-to roof', 'open shopfront', 'fold-down counter'] }),

  b('temple_small', 'church-axial',
    [room('nave', 1, 2), room('chancel', 1, 1)],
    { face: 's', sizeClass: 'grand' },
    { room: 'none' },
    [2, 3], { walls: 'stone', roof: 'tile', ground: 'flagstone' },
    { l0: 'a small stone temple', l1: ['tall arched windows', 'rectangular cella', 'pedimented gable front'] },
    { applicability: { eras: ['classical', 'medieval'] } }),

  b('farm_barn', 'church-axial',
    [room('nave', 1, 3), room('aisle', 2, 3)],
    { face: 's', sizeClass: 'cart', portal: 'cart-door', through: true },
    { room: 'none' },
    [3, 4], { walls: 'timber', roof: 'wood', ground: 'dirt' },
    { l0: 'a timber threshing barn', l1: ['one huge roof', 'twin cart doors', 'no windows'],
      l2: 'An aisled barn entered through opposed cart doors onto a central threshing floor; storage in the flanking aisles.' },
    { provenance: ['https://en.wikipedia.org/wiki/Barn'] }),

  b('tower', 'vertical-stack',
    [room('chamber', 3, 1)],
    { face: 's', sizeClass: 'human' },
    { room: 'none' },
    [1, 1], { walls: 'stone', roof: 'slate', ground: 'flagstone' },
    { l0: 'a stone watchtower', l1: ['tall narrow plan', 'slit windows low', 'arched pairs high'] }),

  b('castle_keep', 'vertical-stack',
    [room('undercroft', 1, 1), room('hall', 1, 2), room('solar', 1, 1), room('chamber', 1, 1)],
    { face: 's', sizeClass: 'human' },
    { room: 'hall', fixture: 'wall-fireplace' },
    [2, 3], { walls: 'stone', roof: 'slate', ground: 'gravel' },
    { l0: 'a stone castle keep', l1: ['bailey and tower', 'arrow slits', 'arched windows high'],
      l2: 'A great tower of stacked chambers over a storage undercroft; the hall takes the keep’s wall fireplace — the early home of the true chimney.' },
    { provenance: ['https://en.wikipedia.org/wiki/Keep'] }),

  b('dock', 'tripartite-linear',
    [room('workshop', 1, 1)],
    { face: 'n', sizeClass: 'human' },
    { room: 'none' },
    [1, 2], { walls: 'timber', roof: 'wood', ground: 'wood' },
    { l0: 'a timber wharf shed', l1: ['low platform', 'water-side door', 'plank decking'] }),

  b('shrine', 'church-axial',
    [room('chancel', 1, 1)],
    { face: 's', sizeClass: 'human' },
    { room: 'none' },
    [1, 1], { walls: 'stone', roof: 'tile', ground: 'flagstone' },
    { l0: 'a wayside shrine', l1: ['single arched window', 'gabled stone cell'] },
    { applicability: { eras: ['classical', 'medieval'] } },
    { functions: ['worship'] }),

  b('guard_post', 'tripartite-linear',
    [room('chamber', 1, 1)],
    { face: 's', sizeClass: 'human' },
    { room: 'none' },
    [1, 1], { walls: 'timber', roof: 'wood' },
    { l0: 'a timber guard post', l1: ['hip roof', 'single shuttered window'] }),

  b('watermill', 'vertical-stack',
    [room('mill-room', 1, 1)],
    { face: 's', sizeClass: 'cart' },
    { room: 'none' },
    [1, 2], { walls: 'timber', roof: 'wood', ground: 'flagstone' },
    { l0: 'a working watermill', l1: ['stone base', 'tall cart door', 'wheel-housing gap'],
      l2: 'A mill astride the stream; grain comes in by cart, the wheel drives the millstones within.' },
    { provenance: ['https://en.wikipedia.org/wiki/Watermill'] }),

  b('yurt', 'tripartite-linear',
    [room('hall', 1, 1)],
    { face: 's', sizeClass: 'human' },
    { room: 'hall', fixture: 'open-hearth' },
    [1, 1], { walls: 'hide', roof: 'hide', ground: 'dirt' },
    { l0: 'a round hide yurt', l1: ['domed felt roof', 'lattice frame', 'apex smoke-hole'],
      l2: 'A single round room of hide over a lattice frame, a central hearth venting through the crown (toono).' },
    { applicability: { eras: ['primordial', 'ancient'] } }),

  b('longhouse', 'tripartite-linear',
    [room('hall', 1, 2), room('byre', 1, 2)],
    { face: 's', sizeClass: 'human', portal: 'doorway', through: true },
    { room: 'hall', fixture: 'open-hearth' },
    [3, 4], { walls: 'log', roof: 'thatch', ground: 'packed_dirt' },
    { l0: 'a longhouse shared with stock', l1: ['half-hip thatch', 'opposed cross-passage doors', 'blind byre end'],
      l2: 'Humans and cattle under one roof: living end with the hearth, byre end down-slope with a dung drain, divided by a cross-passage.' },
    { provenance: ['https://en.wikipedia.org/wiki/Longhouse'] },
    { frame: 'cruck' }),

  // ── primed (facts now, geometry in Slice 4) ────────────────────────────────
  b('manor', 'tripartite-linear',
    [room('hall', 1, 2), room('solar', 1, 1), room('parlour', 1, 1), room('pantry', 1, 1), room('buttery', 1, 1), room('kitchen', 1, 1)],
    { face: 's', sizeClass: 'grand', portal: 'doorway', through: true },
    { room: 'hall', fixture: 'wall-fireplace' },
    [3, 5], { walls: 'stone', roof: 'tile', ground: 'flagstone' },
    { l0: 'a manor hall house', l1: ['great hall', 'service and solar wings', 'cross-passage'] },
    { provenance: ['https://en.wikipedia.org/wiki/Manor_house'] },
    // A working estate, not a lone hall: its premises derive a stable block and a
    // private well (the same site machinery the tavern uses). 'stabling' ⇒ the `stable`
    // auxiliary building; 'water-supply' ⇒ the `well` yard fixture.
    { functions: ['residential', 'agrarian'], requires: ['stabling', 'water-supply'] }),

  b('inn', 'courtyard-hub',
    [room('taproom', 1, 1), room('kitchen', 1, 1), room('guest-chamber', 4, 1), room('stable', 1, 2)],
    { face: 's', sizeClass: 'cart', portal: 'cart-door', through: true },
    { room: 'kitchen', fixture: 'wall-fireplace' },
    [4, 6], { walls: 'timber', roof: 'tile', ground: 'cobble' },
    { l0: 'a courtyard coaching inn', l1: ['galleried court', 'arched carriage entry', 'stable range'] },
    { provenance: ['https://en.wikipedia.org/wiki/Inn'] }),

  b('parish-church', 'church-axial',
    [room('nave', 1, 3), room('chancel', 1, 2), room('aisle', 2, 3), room('porch', 1, 1)],
    { face: 'w', sizeClass: 'grand' },
    { room: 'none' },
    [4, 6], { walls: 'stone', roof: 'slate', ground: 'flagstone' },
    { l0: 'a parish church', l1: ['west tower', 'aisled nave', 'east chancel'] },
    { provenance: ['https://en.wikipedia.org/wiki/Parish_church'] }),

  b('tithe-barn', 'church-axial',
    [room('nave', 1, 4), room('aisle', 2, 4)],
    { face: 's', sizeClass: 'cart', portal: 'cart-door', through: true },
    { room: 'none' },
    [4, 6], { walls: 'stone', roof: 'tile', ground: 'dirt' },
    { l0: 'a great tithe barn', l1: ['cathedral-like roof', 'buttressed stone walls', 'cart porches'] },
    { provenance: ['https://en.wikipedia.org/wiki/Tithe_barn'] }),

  b('granary', 'vertical-stack',
    [room('granary-loft', 1, 1), room('undercroft', 1, 1)],
    { face: 's', sizeClass: 'human' },
    { room: 'none' },
    [1, 2], { walls: 'timber', roof: 'tile', ground: 'flagstone' },
    { l0: 'a raised granary', l1: ['staddle-stone mushrooms', 'boarded loft', 'external stair'] },
    { provenance: ['https://en.wikipedia.org/wiki/Granary'] }),

  b('dovecote', 'vertical-stack',
    [room('dovecote-loft', 1, 1)],
    { face: 's', sizeClass: 'human' },
    { room: 'none' },
    [1, 1], { walls: 'stone', roof: 'tile', ground: 'dirt' },
    { l0: 'a dovecote', l1: ['nesting holes within', 'lantern crown', 'rotating potence'] },
    { provenance: ['https://en.wikipedia.org/wiki/Dovecote'] }),

  b('smithy', 'tripartite-linear',
    [room('forge-room', 1, 1), room('workshop', 1, 1)],
    { face: 's', sizeClass: 'cart' },
    { room: 'forge-room', fixture: 'forge-hearth' },
    [1, 2], { walls: 'stone', roof: 'tile', ground: 'packed_dirt' },
    { l0: 'a blacksmith’s smithy', l1: ['open forge front', 'tall flue', 'soot-blackened'] },
    { provenance: ['https://en.wikipedia.org/wiki/Blacksmith'] },
    { functions: ['craft'], requires: ['water-supply'] }),

  // A stable block — facts-only; primed as a site auxiliary that SATISFIES 'stabling'.
  b('stable', 'tripartite-linear',
    [room('stable', 1, 2)],
    { face: 's', sizeClass: 'cart', portal: 'cart-door' },
    { room: 'none' },
    [1, 2], { walls: 'timber', roof: 'tile', ground: 'packed_dirt' },
    { l0: 'a timber stable block', l1: ['open stalls', 'hay loft over', 'wide cart door'] },
    { provenance: ['https://en.wikipedia.org/wiki/Stable'] },
    { functions: ['agrarian', 'hospitality'], satisfies: ['stabling'] }),

  b('bakehouse', 'tripartite-linear',
    [room('bakehouse-room', 1, 1)],
    { face: 's', sizeClass: 'human' },
    { room: 'bakehouse-room', fixture: 'bread-oven' },
    [1, 1], { walls: 'stone', roof: 'tile', ground: 'flagstone' },
    { l0: 'a communal bakehouse', l1: ['domed bread oven', 'fire-risk stone walls', 'flue stack'] },
    { provenance: ['https://en.wikipedia.org/wiki/Bakehouse'] }),

  b('brewhouse', 'tripartite-linear',
    [room('brewhouse-room', 1, 1)],
    { face: 's', sizeClass: 'human' },
    { room: 'brewhouse-room', fixture: 'wall-fireplace' },
    [1, 2], { walls: 'timber', roof: 'tile', ground: 'flagstone' },
    { l0: 'a brewhouse', l1: ['copper and mash-tun', 'steam louver', 'malt store'] },
    { provenance: ['https://en.wikipedia.org/wiki/Brewing'] }),
];
