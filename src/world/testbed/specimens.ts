// src/world/testbed/specimens.ts
//
// THE SPECIMEN GROUND (testbed WP-T2) — one of every renderable catalogue entry, stood up on
// the testbed world's `specimen_apron` region so a human (or a screenshot tour) can see that
// each one RENDERS, sits on grade, and reads at world palette and scale next to its neighbours.
//
// PURPOSE IS RENDER / GRADE / SCALE COVERAGE — **NOT SITING.** Specimens are laid out on a
// deterministic grid on reserved ground; nothing here models where a thing would believably
// stand. Specimens are therefore EXEMPT from siting-believability judgements, and — the rule
// this file exists to keep honest —
//
//     A GREEN TESTBED IS NEVER EVIDENCE THAT A SITING FIX WORKS.
//
// Siting fixes are accepted against the ADVERSARIAL instruments on the playable worlds:
// `scripts/probe-bridge-decks.ts` and multi-seed `npm run lint:world` (plus
// `scripts/probe-hydrology-parity.ts` / `scripts/probe-world.ts`). A tidy authored world at a
// pinned gen seed snaps nothing and would have shown green straight through the WCV 123/124
// bug. Do not quote this apron at a siting review.
//
// ── Contract ────────────────────────────────────────────────────────────────────────────────
// * REGISTRY-DERIVED. Every row is enumerated from a live registry in sorted-key order, so a
//   new catalogue entry appears here with ZERO edits to this file. That anti-rot property is
//   the point of the slice — never hand-list an id.
// * SAME REGISTRATION PATH as organic placement. Nothing here is a parallel art/render path:
//     - `class:'building' | 'prop'` presets and preset-less catalogue buildingTypes →
//       `synthesizeBlueprint` → `blueprintEntity` → `clearFootprint` → `world.addEntity`
//       (what `building-placer.ts` does for a civic/auxiliary building).
//     - flora species + the plant presets that own an ENTITY KIND → `defaultEntity` vegetation
//       entities keyed by `kind` (what the vegetation brushes emit). The renderer resolves art
//       from the kind (`resolveParametricPlantArt`), so CLUTTER species (habit herb/grass/fern
//       — `isClutterFloraKind`) are placed EXACTLY like a tree: "one instance" of a clutter
//       species is one vegetation entity whose `kind` is the species id, and the clutter-atlas
//       source slices its billboard from that kind. There is no second representation.
//     - `class:'barrier'` presets and the engine `BarrierKind`s → a real `BarrierRun` through
//       `placeBarrier` + `map.barrierRuns` (which is what earns them the terrain footing
//       carve). A barrier-class blueprint placed as a `blueprintEntity` would be tagged
//       'barrier' with NO `properties.barrier` run and would render NOTHING — verified.
//     - bridges → the `bridge-*` parametric prop presets, spanning REAL rendered water found
//       near the apron (the wet row), never `clearFootprint`ed (that would stamp grass into
//       the channel — the `fishery_jetty` precedent).
// * Deterministic and rng-free (a grid needs none), and IDEMPOTENT: the pass returns early if
//   the world already carries specimens, so a second call cannot double-place or double-count
//   the flora ground tint. Running it twice yields identical positions.
// * Post-gen tile writes (`clearFootprint` stamps ground + walkability) are followed by
//   `bumpTilesRev(map)` — without it the GPU keeps painting the old ground until reload.
// * Entity mutation goes through `World.updateEntity` only (World keeps a SECOND index layer
//   beside the registry's; direct x/y/kind/tags mutation desyncs them).
//
// ── Known coverage seams (measured 2026-08-11, stated rather than hidden) ────────────────────
// * 7 of the 18 `class:'plant'` presets (oak_branched, pine_branched, willow_tree, shrub_bush,
//   bracken_fern, wildflower, rock_small) have NO `entityKinds` def and therefore CANNOT be
//   spawned as vegetation entities today — `getEntityKindDef` throws, and the render graph
//   gates the vegetation node on that same lookup (`src/world/brushes/hills.ts:30` documents
//   the same hole for `rock_small`). They are placed as BLUEPRINT entities instead, which
//   composes the identical geometry through `ParametricBuildingSource`. Give them entity
//   kinds (+ a `NATURE_HEIGHT_M` entry) and they move to the vegetation path automatically —
//   the branch is derived, not hand-listed.
// * `BUILDING_BLUEPRINTS` currently holds ZERO `bridge-*` keys (bridges live in their own
//   `BRIDGE_RECIPES` registry), so the "except bridge-*" filter below is future-proofing, not
//   a live exclusion.
// * NO LIVESTOCK, and it is not a testbed gap: there are no animals IN THE WORLD to stand up.
//   A sheep RIG ships (`render/paperdoll/rig-catalog.ts:208`, quadruped paperdoll, driven by
//   the motion studio) but nothing binds it to a world entity — there is no animal entity
//   kind, no brush, no seed vocabulary and no spawner anywhere. An instrument can only show
//   one of each thing that exists; inventing livestock inside a dev testbed would be building
//   gameplay content through the wrong door. When an animal entity kind does land it will
//   need a ROW here (the rows enumerate blueprint presets / buildingTypes / flora species /
//   barrier kinds / bridge recipes — a creature registry is none of those), so this is the
//   one place the derive-don't-enumerate property does NOT cover it for free.

import type { GameMap, Entity, POI } from '@/core/types';
import type { World } from '@/world/world';
import type { Blueprint, BlueprintPatch, ResolvedBlueprint } from '@/blueprint/types';
import { BUILDING_BLUEPRINTS, synthesizeBlueprint, isBridgePreset, bridgePresetNames } from '@/blueprint/presets';
import { toCollision } from '@/blueprint/compile/to-collision';
import { blueprintEntity, blueprintOf } from '@/blueprint/entity';
import { buildingVisualCells } from '@/blueprint/footprint';
import { tileBlockedByBuilding } from '@/world/building-collision';
import { allFloraSpecies } from '@/flora/flora-registry';
import { loadDefaultPacks } from '@/catalogue/default-packs';
import { catalogue } from '@/catalogue/pack';
import { clearFootprint } from '@/world/building-placer';
import { defaultEntity } from '@/world/brush-helpers';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import { NATURE_CATEGORIES } from '@/world/vegetation-clear';
import { accumulateFloraTint } from '@/world/brushes/vegetation-placer';
import { placeBarrier } from '@/world/place-barrier';
import { placeCoverageTowers } from '@/world/enclosure';
import { BARRIER_DEFAULTS, type BarrierKind, type BarrierRun } from '@/world/barrier';
import { heightMetresAt } from '@/world/heightfield';
import { buildRenderWaterTypeMemo } from '@/render/gpu/render-water-mask';
import { mToTiles } from '@/render/scale-contract';
import { bumpTilesRev } from '@/core/tile-rev';

// ─── Contract with WP-T1 ──────────────────────────────────────────────────────

/** The reserved flat region POI WP-T1 authors on a vale flank, clear of settlements.
 *  Its RECT IS READ FROM THE LAID-OUT WORLD AT RUNTIME (`map.worldSeed.pois`), never
 *  hardcoded: `planWorldLayout` translates every authored region and
 *  `snapDrySettlementsOffWater` moves POIs mid-generation, so authored coordinates and
 *  final coordinates are different spaces (the WCV 123/124 lesson). */
export const SPECIMEN_APRON_POI_ID = 'specimen_apron';

/** Tag carried by every entity this pass creates — the coverage test's handle, and the
 *  idempotency sentinel. */
export const SPECIMEN_TAG = 'specimen';

/** Property key recording which registry id a specimen stands for (the preset name, species
 *  id, buildingType id, barrier kind or bridge preset), so a coverage scan reads the id it is
 *  looking for instead of re-deriving it from `kind`. */
export const SPECIMEN_OF = 'specimenOf';

/** Property key recording the row a specimen belongs to (station framing + legibility). */
export const SPECIMEN_ROW = 'specimenRow';

/** The rows a specimen can belong to — the authoritative list, in layout order.
 *  `SpecimenRowName` types every `row:` literal below, so ADDING A ROW WITHOUT ADDING IT
 *  HERE FAILS TYPECHECK. That is deliberate: the tour (`src/world/testbed/stations.ts`)
 *  frames one station per row and derives them from this array, so a hand-maintained copy
 *  over there would silently drift the moment a row was added — the same enumerate-by-hand
 *  rot this whole pass exists to avoid. */
export const SPECIMEN_ROW_NAMES = [
  'barrierPresets', 'barrierKinds', 'buildings', 'buildingTypes',
  'props', 'stairs', 'plants', 'flora', 'bridges',
] as const;

export type SpecimenRowName = (typeof SPECIMEN_ROW_NAMES)[number];

// ─── Layout constants ─────────────────────────────────────────────────────────
//
// THE APRON IS THE BINDING CONSTRAINT, and it cannot legitimately grow: WP-T1 measured that
// pushing the apron's west edge past x_min 36 drags it into Sloughmire's swamp region, whose
// region-fill rewrites moisture → biomes → tiles → road cost and takes `probe-bridge-decks`
// from 4 decks · 0 · 0 · 0 to 5 decks with 2 class1. So the layout has to fit the ground,
// not the other way round. Measured on the shipped world (192×128, gen seed 12345):
//
//   apron rect        (88,86)…(140,93) — 53 × 8, 424 dry cells
//   usable band       the apron's x-range carried SOUTH to the coast: 1,716 cells free after
//                     water (477), carved roads (20) and organic buildings (13) are removed.
//                     Full 53 wide to y 112, then TAPERING (50·48·47·38·33·32·30·27·13) to
//                     the shore at y 122.
//   specimen area     974 tiles of footprint, of which the 9 bridges (273) sit OFF-grid on
//                     real water ⇒ 701 tiles must fit in 1,716. Room for 2.4× — but only if
//                     the padding is small: the original GAP 2 / ROW_GAP 3 wrapping flow
//                     spent ~60% of the band on air and placed 82 of 119 ids.
//   after this pass   118/119 ids (119 entities — `palisade` is both a preset and a kind),
//                     0 failures, y 86..120, 647 organic nature entities mown off, 291 dry
//                     cells still free (575 before {@link SEP_BIG} widened the ring around
//                     the big items — that headroom is what legibility was bought with).
//
// Four things bought the COVERAGE, in order of what they were worth:
//   1. A real bottom-left PACKER instead of a wrapping flow ({@link Slab}) — a 1×1 herb can
//      slide into the leftover width beside a 3×6 church instead of costing a whole line.
//   2. SEP 1 / BAND_GAP 1 instead of GAP 2 / ROW_GAP 3.
//   3. BANDS ORDERED TALLEST-FIRST, and BARRIER RUNS STOOD VERTICAL. Both are about the
//      taper: a tall item needs all its rows dry in the SAME columns, so an 11-row wall run
//      cannot stand near the shore (measured: barriers placed last lost 10 of 13 runs).
//   4. The SWARD was broadcast-sown from the apron's north edge, through the ground the
//      taller bands left over. That was the densest use of the apron — and it is exactly
//      what the legibility pass below had to undo.
//
// ── AND THEN THE METRICS WENT GREEN WHILE THE ARTIFACT FAILED ────────────────────────────
// 118/119 placed, 0 failures, 0 touching pairs — and the first capture of the finished
// ground was UNREADABLE: a chaotic town, not a specimen ground. Measuring the PICTURE
// rather than the report found why, and it was not the packing. **680 ORGANIC NATURE
// ENTITIES ALREADY STOOD IN THE PACKING BAND BEFORE A SINGLE SPECIMEN WAS PLACED** — 211
// tussock-grass, 50 english-oak, 41 hawthorn, 38 beech, 20 birch … against the 61
// vegetation specimens the pass itself sows. The apron POI's `plains` region-fill dries the
// ground's BIOME; it does not sweep what the vegetation brushes already draped over it, and
// `clearFootprint` only sweeps each specimen's OWN footprint, so every tree BETWEEN
// specimens survived. A specimen english-oak stood indistinguishable among fifty organic
// ones. Hence {@link mowSpecimenGround} (647 swept, and `natureCleared` is gated in
// `tests/unit/testbed-coverage.test.ts` so it cannot silently stop firing), and hence
// {@link SEP_BIG} — a footprint tile is not what occludes in an isometric view, HEIGHT is.
// Those two are what made it readable. Two OTHER plausible fixes were tried and rejected on
// measurement: the sward as its own band (does not fit — see its note below) and BAND_GAP 3
// (bought no aisle, cost 10 extra out-of-band placements).
//
// Legibility is what this ground is FOR, and it is not a number the report can carry: every
// coverage metric was green while the artifact was useless. The same shape of error as three
// bridge rounds shipping green against a decline count. LOOK AT THE PICTURE.

/** Clear tiles between two SMALL specimens. ONE — the smallest separation that still reads as
 *  "two things" rather than one clump at the tour's framing zoom, and the value the area
 *  budget above can actually afford. Zero would let neighbouring silhouettes touch. */
const SEP = 1;
/** Clear tiles around a BIG specimen ({@link BIG_SPECIMEN_TILES} or more on either axis).
 *  A footprint tile is not what occludes in an isometric view — HEIGHT is, and a keep's
 *  sprite rises far above its four cells, so at SEP 1 a tall specimen simply eats the one
 *  standing behind it. Measured cost of the extra ring on the ~38 big items: ~495 cells
 *  against 577 free, i.e. it fits and nothing else does. */
const SEP_BIG = 2;
/** Footprint extent (either axis) at which a specimen claims {@link SEP_BIG}. Four: the
 *  three big bands (barrier runs h 9, buildings, the larger props) clear it and the sward's
 *  1×1s do not, which is exactly the split that matters for occlusion. */
const BIG_SPECIMEN_TILES = 4;

/** The separation ring a w×h specimen claims. */
function sepFor(w: number, h: number): number {
  return Math.max(w, h) >= BIG_SPECIMEN_TILES ? SEP_BIG : SEP;
}
/** Extra clear lane between two BANDS, on top of {@link SEP}.
 *
 *  STAYS AT ONE, and that is measured rather than assumed. Widening it to 3 to cut visible
 *  aisles was TRIED: it bought no aisle, because the bands do not hold their rows anyway
 *  (the sward is broadcast across all of them and the packer backfills a full band into
 *  earlier holes), and it cost 10 extra out-of-band placements — 19 backfilled at 3 against
 *  9 at 1. Aisles are not a knob on a ground this full; {@link mowSpecimenGround} and
 *  {@link SEP_BIG} are what made the layout readable. */
const BAND_GAP = 1;
/** How far past the specimens' own bounding box {@link mowSpecimenGround} sweeps organic
 *  nature. Two tiles: a tree's drawn canopy is ~2-3 tiles across (`TREE_CLEAR_RADIUS` 2.2),
 *  so a trunk standing just outside the box still splats foliage over the edge specimens. */
const MOW_MARGIN = 2;
/** Side of the synthetic apron used when the POI carries a `position` but no `region`. */
const DEFAULT_APRON_SIDE = 64;
/** How far a wet-row search may wander from the apron looking for rendered water. */
const WET_SEARCH_RADIUS = 90;
/** Widest water run the wet row will call a "channel" — beyond this it is a lake or the sea,
 *  which no specimen deck spans. (The widest recipe, `stone-arch`, wants ~12 tiles.) */
const MAX_WET_SPAN = 14;
/** Road tile types the packer keeps clear of (a specimen standing in a carved lane reads as
 *  a bug and would fight the road ribbon). Mirrors `building-placer.ts`'s ROAD_TYPES. */
const ROAD_TILE_TYPES: ReadonlySet<string> = new Set(['dirt_road', 'stone_road', 'bridge']);

export interface SpecimenRect { x0: number; y0: number; x1: number; y1: number }

export interface PlaceSpecimensOptions {
  /** Override the apron rect (dev smoke-testing against a flat genome world that has no
   *  `specimen_apron` POI). Production passes nothing and the rect is resolved from the POIs. */
  rect?: SpecimenRect;
  /** Suppress the summary log line (tests). */
  quiet?: boolean;
}

/** What the pass did — returned for tests/probes; the bootstrap call site ignores it. */
export interface SpecimenReport {
  rect: SpecimenRect | null;
  /** registry id → the entity id(s) standing for it. */
  placed: Map<string, string[]>;
  /** registry ids the pass could not stand up, with the reason. */
  failed: { id: string; row: SpecimenRowName; reason: string }[];
  /** Non-fatal notes (e.g. a bridge that found no channel and stands on dry ground). */
  warnings: string[];
  /** Rows the layout used on the dry terrace SOUTH of the apron rect. Expected to be > 0 and
   *  NOT an error: the apron rect is 53×8 = 424 cells and the non-bridge specimens are 701
   *  tiles of footprint, so the set cannot fit inside the rect at any packing density, and the
   *  apron already runs to the authoring frame's south edge (`AUTHOR_H`) so it cannot be made
   *  taller. WP-T1's own module note designs for this ("free to run SOUTH past its bottom
   *  edge … the apron's height is not the constraint — the southern coast is"). The number to
   *  watch is `failed`; this one is a framing hint for the tour. */
  overflowRows: number;
  /** Bounding box actually used (may exceed the apron — see `overflowRows`). */
  used: SpecimenRect | null;
  /** Per-band north/south extent — the tour's station framing, and the first thing to look at
   *  when the apron runs out of room. */
  bands: { band: string; y0: number; y1: number; n: number }[];
  /** Dry, unclaimed cells still left in the apron band after the pass — the HEADROOM for
   *  future catalogue entries. When this approaches zero the next new preset will be the one
   *  that fails, and the fix is the apron/world, not this file. */
  freeCellsLeft: number;
  /** Organic nature entities {@link mowSpecimenGround} swept off the specimen ground. The
   *  measured baseline is ~680 — an order of magnitude more than the pass's own 61 vegetation
   *  specimens, and the reason the ground was unreadable before this existed. A number near
   *  ZERO here means the sweep has stopped finding the brushes' output and the ground is
   *  about to silently go back to being a thicket. */
  natureCleared: number;
}

// ─── Apron resolution ─────────────────────────────────────────────────────────

/** The apron POI as the world FINALLY laid it out (post-layout translate, post-snap). */
export function findApronPoi(map: GameMap): POI | undefined {
  return map.worldSeed?.pois?.find((p) => p.id === SPECIMEN_APRON_POI_ID);
}

/**
 * The apron rect in FINAL tile space, clamped into the map. Prefers the POI's authored
 * `region` (translated by `planWorldLayout`); falls back to a square centred on its resolved
 * `position` for a region-less apron. Null when the world has no apron POI at all.
 */
export function resolveApronRect(map: GameMap): SpecimenRect | null {
  const poi = findApronPoi(map);
  if (!poi) return null;
  const r = poi.region;
  const raw: SpecimenRect | null = r
    ? { x0: Math.round(r.x_min), y0: Math.round(r.y_min), x1: Math.round(r.x_max), y1: Math.round(r.y_max) }
    : poi.position
      ? {
          x0: Math.round(poi.position.x - DEFAULT_APRON_SIDE / 2),
          y0: Math.round(poi.position.y - DEFAULT_APRON_SIDE / 2),
          x1: Math.round(poi.position.x + DEFAULT_APRON_SIDE / 2),
          y1: Math.round(poi.position.y + DEFAULT_APRON_SIDE / 2),
        }
      : null;
  return raw ? clampRect(raw, map) : null;
}

function clampRect(r: SpecimenRect, map: GameMap): SpecimenRect {
  return {
    x0: Math.max(0, Math.min(map.width - 1, r.x0)),
    y0: Math.max(0, Math.min(map.height - 1, r.y0)),
    x1: Math.max(0, Math.min(map.width - 1, r.x1)),
    y1: Math.max(0, Math.min(map.height - 1, r.y1)),
  };
}

// ─── Row derivation (every list below is READ FROM A REGISTRY) ────────────────

/** Sorted keys of `BUILDING_BLUEPRINTS` whose blueprint matches `pred`, minus `bridge-*`
 *  (bridges own their own registry and their own wet row). */
function presetKeys(pred: (bp: Blueprint, name: string) => boolean): string[] {
  return Object.keys(BUILDING_BLUEPRINTS)
    .filter((n) => !isBridgePreset(n) && !n.startsWith('bridge-'))
    .filter((n) => pred(BUILDING_BLUEPRINTS[n], n))
    .sort();
}

/** A stair preset = any preset carrying a `stair_flight` part. Derived, so a 5th stair joins
 *  the stair row with no edit here. */
function isStairPreset(bp: Blueprint): boolean {
  return Object.values(bp.parts ?? {}).some((p) => p.type === 'stair_flight');
}

/** The part key carrying the stair flight (for the downhill `dir` patch). */
function stairPartKey(bp: Blueprint): string | undefined {
  return Object.entries(bp.parts ?? {}).find(([, p]) => p.type === 'stair_flight')?.[0];
}

/** Catalogue buildingTypes with NO hand preset — they resolve through the generative bridge
 *  (`presets/index.ts` resolution order). Pack-agnostic: a new pack's types appear here. */
function presetlessBuildingTypes(): string[] {
  loadDefaultPacks();
  return catalogue
    .all('buildingType')
    .map((e) => e.id)
    .filter((id) => !(id in BUILDING_BLUEPRINTS))
    .sort();
}

/** Every flora species id (curated core + any runtime lazy-fills), sorted. */
function floraSpeciesIds(): string[] {
  return allFloraSpecies().map((s) => s.id).sort();
}

/** True when this preset name resolves to a VEGETATION entity kind — i.e. the organic
 *  kind-keyed path is available to it. */
function hasVegetationKind(name: string): boolean {
  return tryGetEntityKindDef(name)?.category === 'vegetation';
}

// ─── The specimen list ────────────────────────────────────────────────────────

type PlaceFn = (x: number, y: number) => Entity | null;

interface Specimen {
  /** The registry id this specimen stands for (what the coverage test looks up). */
  id: string;
  /** Semantic label recorded on the entity (`specimenRow`) — what registry it came from. */
  row: SpecimenRowName;
  /** LAYOUT group. Defaults to `row`; two rows sharing a band are packed together (the two
   *  barrier registries do, so the 13 runs form one wall line instead of two). */
  band?: string;
  w: number;
  h: number;
  place: PlaceFn;
  /** Fixed world origin, bypassing the packer — the wet row's bridges sit on the channel the
   *  scan found, not on the apron lattice. */
  at?: { x: number; y: number };
  /** Search the WHOLE apron from its north edge rather than starting below the previous band.
   *  Set on the SWARD only: 1×1 vegetation is the only thing that fits both the leftover
   *  ground between the taller specimens and the tapering cells at the coast, and the island
   *  has no room for it as a band of its own (measured — see the sward's own note below). */
  fromTop?: boolean;
}

/** A stable per-specimen seed — a pure hash of the id, so blueprint synthesis is reproducible
 *  without touching the world rng (this pass is rng-free by contract). */
function seedOf(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/** Resolve a preset / buildingType / bridge name to its blueprint. Never throws — a bad
 *  registry entry becomes a NAMED failure in the report instead of killing the whole pass. */
function resolve(name: string, patches: BlueprintPatch[] = []): { rb?: ResolvedBlueprint; err?: string } {
  try {
    const rb = synthesizeBlueprint(name, patches, seedOf(name));
    return rb ? { rb } : { err: 'synthesizeBlueprint returned undefined' };
  } catch (e) {
    return { err: `synthesizeBlueprint threw: ${String(e)}` };
  }
}

// ─── Placement primitives (the shared registration paths) ─────────────────────

/** Commit a blueprint specimen exactly the way `building-placer` commits a civic building:
 *  clear the footprint (nature swept, ground stamped, footprint solid), reopen the door
 *  thresholds, then register on the World (registry + BOTH index layers). */
function placeBlueprintSpecimen(
  map: GameMap, world: World, rb: ResolvedBlueprint,
  registryId: string, row: SpecimenRowName, x: number, y: number,
  opts: { clear?: boolean } = {},
): Entity {
  const col = toCollision(rb);
  const entity = blueprintEntity(`specimen_${row}_${registryId}`, rb, x, y);
  entity.tags = [...new Set([...(entity.tags ?? []), SPECIMEN_TAG])];
  entity.properties![SPECIMEN_OF] = registryId;
  entity.properties![SPECIMEN_ROW] = row;
  if (opts.clear !== false) {
    clearFootprint(x, y, col.footprint.w, col.footprint.h, world.registry, world, map.tiles);
    // clearFootprint marks the whole footprint solid; a door threshold stays walkable —
    // the same reopen the core `commit` / civic loop applies.
    for (const dc of col.doorCells) {
      const ci = dc.indexOf(',');
      const t = map.tiles[y + Number(dc.slice(ci + 1))]?.[x + Number(dc.slice(0, ci))];
      if (t) t.walkable = true;
    }
  }
  world.addEntity(entity);
  return entity;
}

/** Commit a vegetation specimen the way a vegetation brush does: a kind-keyed entity with the
 *  brush's own in-cell offsets, plus its contribution to the ground flora tint. */
function placeVegetationSpecimen(
  map: GameMap, world: World, kind: string, row: SpecimenRowName, x: number, y: number,
): Entity {
  const fx = 0.5, fy = 0.5;
  const e = defaultEntity('specimen', kind, x + fx, y + fy,
    { offsetX: fx, offsetY: fy, scale: 1, rotation: 0, [SPECIMEN_OF]: kind, [SPECIMEN_ROW]: row },
    [SPECIMEN_TAG]);
  world.addEntity(e);
  accumulateFloraTint(map, x + fx, y + fy, kind, 1);
  return e;
}

/** Build a straight west→east `BarrierRun` of `lengthTiles`, with one real gate at its middle
 *  and towers DERIVED by the shipped coverage pass (`placeCoverageTowers` returns [] for the
 *  kinds that carry none — that is the "a tower where the kind supports it" rule, not a
 *  hand-list). Commits through `placeBarrier` and declares itself on `map.barrierRuns`, so the
 *  stepped foundation footing carves under it exactly like a town wall's. */
function placeBarrierSpecimen(
  map: GameMap, world: World, registryId: string, row: SpecimenRowName,
  x: number, y: number, spec: Omit<BarrierRun, 'path' | 'gates' | 'towers'>, gateWidthTiles: number,
): Entity | null {
  // Runs stand NORTH→SOUTH: a wall is long and thin, and 13 tall-thin boxes tile the apron's
  // 53-tile width in ONE line (44 tiles all told) where 13 horizontal ones needed three.
  // Measured: 11 rows for the whole barrier band, against ~25 laid out east–west.
  const len = BARRIER_SPECIMEN_LENGTH;
  const cx = x + Math.floor(barrierBoxW(spec.thickness) / 2);
  const run: BarrierRun = {
    ...spec,
    path: [[cx, y], [cx, y + len]],
    gates: [{ t: len / 2, width: gateWidthTiles, kind: 'gate' }],
  };
  // Towers are a DERIVED defensive decision, not a hand-list: the shipped coverage pass
  // returns [] for the kinds that carry none, which is exactly "a tower where the kind
  // supports it". (The renderer draws them only for a crenellated masonry run — the two
  // gates agree by construction because both read the same run.)
  run.towers = placeCoverageTowers(run);
  const id = placeBarrier(world, run, `specimen_${row}_${registryId}`);
  const placed = world.registry.get(id);
  if (!placed) return null;
  world.updateEntity(id, { tags: [...new Set([...(placed.tags ?? []), SPECIMEN_TAG])] });
  world.setProperty(id, SPECIMEN_OF, registryId);
  world.setProperty(id, SPECIMEN_ROW, row);
  (map.barrierRuns ??= []).push({ id, run });
  return world.registry.get(id) ?? null;
}

/** Specimen barrier run length in tiles — "one SHORT run per kind". 8 keeps a real stretch of
 *  curtain either side of the central gate (a 3-tile opening leaves 2.5 tiles of wall each
 *  way) and keeps both gate-flanker towers ON the run (`GATE_FLANK_MARGIN` 1.3 puts them at
 *  t = 4 ± 2.8). Shorter reads as a gatehouse with no wall; each extra tile costs the whole
 *  band a row, and the apron has none to spare. */
const BARRIER_SPECIMEN_LENGTH = 8;

/** A vertical run's box width: the rasterized curtain spans `thickness` cells about its
 *  centreline, plus a cell so a 2-thick wall's outer face is not flush with its neighbour. */
function barrierBoxW(thickness: number): number {
  return Math.max(1, Math.ceil(thickness)) + 1;
}

/** Enclosure's own default gate clearance when a run has no authored one (`enclosure.ts`). */
const DEFAULT_GATE_WIDTH_TILES = 3;

/** Read a `class:'barrier'` preset's authored line params back into a `BarrierRun` spec.
 *  Everything the preset does not author falls back to `BARRIER_DEFAULTS[kind]`, so the run
 *  and the preset's studio subject describe the same wall. */
function barrierSpecFromPreset(bp: Blueprint): { spec: Omit<BarrierRun, 'path' | 'gates' | 'towers'>; gate: number } | null {
  const line = Object.values(bp.parts ?? {}).find((p) => p.type === 'barrier');
  const params = (line?.params ?? {}) as {
    kind?: BarrierKind; heightM?: number; thicknessTiles?: number;
    crenellated?: boolean; posts?: boolean; gateWidthM?: number; material?: string;
  };
  const kind = params.kind;
  if (!kind || !(kind in BARRIER_DEFAULTS)) return null;
  const d = BARRIER_DEFAULTS[kind];
  const crenellated = params.crenellated ?? d.crenellated;
  const posts = params.posts ?? d.posts;
  return {
    spec: {
      kind,
      height: params.heightM !== undefined ? mToTiles(params.heightM) : d.height,
      thickness: params.thicknessTiles ?? d.thickness,
      material: params.material ?? bp.materials?.walls ?? d.material,
      ...(crenellated !== undefined ? { crenellated } : {}),
      ...(posts !== undefined ? { posts } : {}),
    },
    gate: params.gateWidthM !== undefined ? mToTiles(params.gateWidthM) : DEFAULT_GATE_WIDTH_TILES,
  };
}

// ─── The pass ─────────────────────────────────────────────────────────────────

/**
 * Stand one specimen of every renderable catalogue entry on the testbed's specimen apron.
 * Dev-gated by its (WP-T1-owned) call site in `bootstrap-world.ts`; never runs for a
 * playable world. Idempotent — a second call is a no-op.
 */
export function placeSpecimens(map: GameMap, world: World, opts: PlaceSpecimensOptions = {}): SpecimenReport {
  const report: SpecimenReport = {
    rect: null, placed: new Map(), failed: [], warnings: [], overflowRows: 0, used: null, bands: [],
    freeCellsLeft: 0, natureCleared: 0,
  };

  // IDEMPOTENCY: the tag index is the sentinel. Re-running must not double-place entities
  // (the registry would throw on the duplicate id) nor double-count the flora ground tint.
  if (world.query({ tag: SPECIMEN_TAG, limit: 1 }).length > 0) return report;

  const rect = opts.rect ? clampRect(opts.rect, map) : resolveApronRect(map);
  report.rect = rect;
  if (!rect || rect.x1 - rect.x0 < 4 || rect.y1 - rect.y0 < 4) {
    console.warn(`[testbed] specimens: no usable '${SPECIMEN_APRON_POI_ID}' region — nothing placed`);
    return report;
  }

  const waterType = buildRenderWaterTypeMemo(map);
  const isWater = (x: number, y: number): boolean =>
    x < 0 || y < 0 || x >= map.width || y >= map.height || waterType[y * map.width + x] !== 0;

  const specimens = buildSpecimenList(map, world, isWater, rect, report);

  // ── Layout: a bottom-left packer over the apron's x-band. The band runs from the apron's
  //    north edge SOUTH to the map edge (WP-T1's apron is only 8 rows tall but the dry
  //    terrace below it is the real ground; the apron's height was never the constraint —
  //    the southern coast is). Deterministic, rng-free and stable: same registries ⇒ same
  //    coordinates, every run, on every machine.
  const slab = new Slab(rect.x0, rect.y0, rect.x1, map.height - 1);
  slab.blockWhere((x, y) => isWater(x, y)
    || ROAD_TILE_TYPES.has(map.tiles[y]?.[x]?.type ?? '')
    || tileBlockedByBuilding(world, x, y));
  for (const e of world.query({ tag: 'building' })) {
    const bp = blueprintOf(e);
    if (bp) for (const c of buildingVisualCells(bp.rb, Math.floor(e.x), Math.floor(e.y))) {
      const ci = c.indexOf(',');
      slab.block(Number(c.slice(0, ci)), Number(c.slice(ci + 1)));
    }
  }
  for (const e of world.query({ tag: 'barrier' })) {
    const cells = (e.properties as { footprintCells?: [number, number][] } | undefined)?.footprintCells;
    if (Array.isArray(cells)) for (const [bx, by] of cells) slab.block(bx, by);
  }

  const used: SpecimenRect = { x0: rect.x0, y0: rect.y0, x1: rect.x0, y1: rect.y0 };
  let bandTop = rect.y0;
  let lastBand = '';
  const outOfBand: string[] = [];

  for (const s of specimens) {
    let px: number, py: number;
    if (s.at) {
      px = s.at.x; py = s.at.y;                                // wet row: fixed, off-grid
    } else {
      const band = s.band ?? s.row;
      if (band !== lastBand) {
        if (lastBand !== '') bandTop = used.y1 + 1 + BAND_GAP;
        lastBand = band;
        report.bands.push({ band, y0: bandTop, y1: bandTop, n: 0 });
      }
      // Prefer this band's own ground; if the band is full, BACKFILL into any hole an
      // earlier band left rather than refuse the specimen — coverage beats tidiness, and
      // the fallback is reported by name so a drifting layout is still visible.
      const top = s.fromTop ? rect.y0 : bandTop;
      let spot = slab.find(s.w, s.h, top);
      if (!spot && !s.fromTop) {
        spot = slab.find(s.w, s.h, rect.y0);
        if (spot) outOfBand.push(s.id);
      }
      if (!spot) {
        // LOUD, per specimen and by name — a five-minute diagnosis beats a tidy log.
        report.failed.push({
          id: s.id, row: s.row,
          reason: `no free ${s.w}x${s.h} slot anywhere in the apron band (searched y ${rect.y0}..${map.height - 1})`,
        });
        continue;
      }
      slab.mark(spot.x, spot.y, s.w, s.h);
      px = spot.x; py = spot.y;
    }
    let entity: Entity | null = null;
    try {
      entity = s.place(px, py);
    } catch (err) {
      report.failed.push({ id: s.id, row: s.row, reason: `placement threw: ${String(err)}` });
    }
    if (entity) {
      const list = report.placed.get(s.id) ?? [];
      list.push(entity.id);
      report.placed.set(s.id, list);
      if (!s.at) {
        used.x1 = Math.max(used.x1, px + s.w - 1);
        used.y1 = Math.max(used.y1, py + s.h - 1);
        const b = report.bands[report.bands.length - 1];
        if (b) { b.y0 = Math.min(b.y0, py); b.y1 = Math.max(b.y1, py + s.h - 1); b.n++; }
      }
    } else if (!report.failed.some((f) => f.id === s.id && f.row === s.row && f.reason.startsWith('placement'))) {
      report.failed.push({ id: s.id, row: s.row, reason: 'placement returned null' });
    }
  }

  report.used = used;
  report.overflowRows = Math.max(0, used.y1 - rect.y1);
  if (outOfBand.length) {
    report.warnings.push(
      `${outOfBand.length} specimen(s) backfilled OUTSIDE their band (the band ran out of `
      + `ground): ${outOfBand.join(', ')}`);
  }

  report.natureCleared = mowSpecimenGround(world, used);

  // Every `clearFootprint` above rewrote `tile.type`/`walkable` in place, and the flora tint
  // feeds the same colour field — without this the GPU repaints neither until reload.
  bumpTilesRev(map);

  report.freeCellsLeft = slab.freeCount();

  if (!opts.quiet) {
    console.log(
      `[testbed] specimens: ${report.placed.size} ids placed, ${report.failed.length} failed; `
      + `apron ${rect.x1 - rect.x0 + 1}x${rect.y1 - rect.y0 + 1} at (${rect.x0},${rect.y0}); `
      + `used y ${used.y0}..${used.y1} (${report.overflowRows} row(s) on the terrace south of `
      + `the apron rect — expected, see SpecimenReport.overflowRows); `
      + `${report.natureCleared} organic nature entities mown off the ground; `
      + `${report.freeCellsLeft} dry cells of headroom left`,
    );
    for (const b of report.bands) {
      console.log(`[testbed]   band ${b.band}: y ${b.y0}..${b.y1}, ${b.n} specimen(s)`);
    }
    for (const f of report.failed) console.warn(`[testbed] specimen '${f.id}' (${f.row}): ${f.reason}`);
    for (const w of report.warnings) console.warn(`[testbed] ${w}`);
  }
  return report;
}

// ─── Mowing the ground ────────────────────────────────────────────────────────

/**
 * Sweep ORGANIC nature (the vegetation brushes' trees, shrubs, grasses, rocks and debris)
 * off the specimen ground, leaving the specimens as the only things standing on it.
 *
 * THIS IS THE LEGIBILITY PASS, and it was the missing one. The apron POI is a `plains`
 * region-fill: it dries the ground's BIOME, which changes what the brushes would seed there,
 * but it neither runs after them nor removes what they already draped over the terrace the
 * band overflows onto. Measured on the shipped world: **680 organic nature entities inside
 * the packing band before a single specimen existed** (211 tussock-grass, 50 english-oak, 41
 * hawthorn, 38 beech, 20 birch…), against 61 vegetation specimens. `clearFootprint` sweeps
 * only each specimen's own cells, so all 680 stood in the aisles.
 *
 * BOUNDED TO WHAT THE PASS ACTUALLY USED (`used`, inflated by {@link MOW_MARGIN}) — never
 * the whole band. `used` excludes the wet row, so this cannot bald a riverbank: the bridge
 * specimens keep their surroundings, which are ordinary world ground and read as such. A
 * blanket sweep of the apron's x-band to the map edge would shave a bare strip down to the
 * shore and look like a bug.
 *
 * Specimen-tagged entities are exempt (the 61 vegetation specimens are nature by category —
 * that is the whole point of them).
 *
 * KNOWN, ACCEPTED: removal does NOT reverse the ground flora TINT those entities contributed
 * during generation (`accumulateFloraTint` has no inverse, and nothing in the engine reverses
 * it — the shipped road/building sweeps `clearObstructedVegetation` leave it too). So the mown
 * ground keeps a faint memory of the wood that stood there. Consistent with the rest of the
 * engine, and on a specimen apron it reads as meadow colour.
 */
function mowSpecimenGround(world: World, used: SpecimenRect): number {
  const region = {
    x: used.x0 - MOW_MARGIN, y: used.y0 - MOW_MARGIN,
    w: used.x1 - used.x0 + 1 + MOW_MARGIN * 2, h: used.y1 - used.y0 + 1 + MOW_MARGIN * 2,
  };
  const doomed: string[] = [];
  for (const e of world.query({ region })) {
    if (e.tags?.includes(SPECIMEN_TAG)) continue;
    const def = tryGetEntityKindDef(e.kind);
    if (def && NATURE_CATEGORIES.has(def.category)) doomed.push(e.id);
  }
  for (const id of doomed) world.removeEntity(id);
  return doomed.length;
}

// ─── The packer ───────────────────────────────────────────────────────────────

/**
 * A tile-occupancy slab over the apron's x-band, packed bottom-left-first.
 *
 * Replaces the original wrapping flow, which spent one line-height on every wrapped line and
 * one uniform pitch on every item — ~60% of the band on air, and 37 specimens refused on the
 * shipped apron. A slab lets a 1×1 herb slide into the leftover width beside a 3×6 church,
 * and folds the "is this ground even usable" question (water, roads, organic buildings, the
 * tapering southern coastline) into the same test as "is it already taken", so the packer
 * follows the real shoreline instead of assuming a rectangle.
 *
 * Separation is enforced by testing a margin of {@link sepFor} on the item's east and south
 * sides: every neighbour reserved its own margin when it was placed, so no two specimens can
 * end up adjacent. Deterministic — a fixed north→south, west→east scan, no rng.
 *
 * The margin is PER ITEM (a big specimen claims a wider ring — see {@link SEP_BIG}), which
 * makes the guarantee asymmetric in an important way: two neighbours are separated by the
 * LARGER of their two rings, because whichever was placed first already marked its own.
 */
class Slab {
  private readonly taken: Uint8Array;
  constructor(
    private readonly x0: number, private readonly y0: number,
    private readonly x1: number, private readonly y1: number,
  ) {
    this.taken = new Uint8Array(Math.max(0, (x1 - x0 + 1) * (y1 - y0 + 1)));
  }

  private idx(x: number, y: number): number {
    return (y - this.y0) * (this.x1 - this.x0 + 1) + (x - this.x0);
  }

  private inside(x: number, y: number): boolean {
    return x >= this.x0 && x <= this.x1 && y >= this.y0 && y <= this.y1;
  }

  block(x: number, y: number): void {
    if (this.inside(x, y)) this.taken[this.idx(x, y)] = 1;
  }

  /** Block every cell the predicate rejects (water, roads, organic footprints, off-map). */
  blockWhere(pred: (x: number, y: number) => boolean): void {
    for (let y = this.y0; y <= this.y1; y++) {
      for (let x = this.x0; x <= this.x1; x++) if (pred(x, y)) this.taken[this.idx(x, y)] = 1;
    }
  }

  /** Claim the item's cells AND its east/south margin. Marking the margin (not merely testing
   *  it) is what actually guarantees separation: with the margin only tested, a later item
   *  scanning west→east would find the untouched cell immediately east of a placed one and
   *  sit flush against it. Marked + tested, every neighbour is {@link SEP} clear on all four
   *  sides — the west/north sides because the WESTERN item's own margin already owns them. */
  mark(x: number, y: number, w: number, h: number): void {
    const sep = sepFor(w, h);
    for (let dy = 0; dy < h + sep; dy++) for (let dx = 0; dx < w + sep; dx++) this.block(x + dx, y + dy);
  }

  /** Free for a w×h item at (x,y) INCLUDING its east/south separation margin. The margin is
   *  only required where it falls inside the slab, so an item may sit flush against the
   *  slab's own edge. */
  private fits(x: number, y: number, w: number, h: number): boolean {
    if (x < this.x0 || y < this.y0 || x + w - 1 > this.x1 || y + h - 1 > this.y1) return false;
    const sep = sepFor(w, h);
    for (let dy = 0; dy < h + sep; dy++) {
      for (let dx = 0; dx < w + sep; dx++) {
        const cx = x + dx, cy = y + dy;
        if (!this.inside(cx, cy)) continue;              // margin off the slab edge is fine
        if (this.taken[this.idx(cx, cy)]) return false;
      }
    }
    return true;
  }

  /** Dry, unclaimed cells left — the apron's remaining headroom for future catalogue growth. */
  freeCount(): number {
    let n = 0;
    for (let i = 0; i < this.taken.length; i++) if (!this.taken[i]) n++;
    return n;
  }

  /** The first free w×h slot at or below `fromY`, scanning north→south then west→east. */
  find(w: number, h: number, fromY: number): { x: number; y: number } | null {
    for (let y = Math.max(this.y0, fromY); y + h - 1 <= this.y1; y++) {
      for (let x = this.x0; x + w - 1 <= this.x1; x++) if (this.fits(x, y, w, h)) return { x, y };
    }
    return null;
  }
}

// ─── Row assembly ─────────────────────────────────────────────────────────────

function buildSpecimenList(
  map: GameMap, world: World,
  isWater: (x: number, y: number) => boolean,
  rect: SpecimenRect, report: SpecimenReport,
): Specimen[] {
  const out: Specimen[] = [];

  /** Blueprint-entity rows (buildings, generative buildingTypes, props, plant presets with no
   *  entity kind). One helper so every one of them takes the identical commit path. */
  const addBlueprint = (
    row: SpecimenRowName, name: string, patches: BlueprintPatch[] = [], clear = true, band?: string,
  ): void => {
    const { rb, err } = resolve(name, patches);
    if (!rb) { report.failed.push({ id: name, row, reason: err ?? 'unresolved' }); return; }
    const fp = toCollision(rb).footprint;
    out.push({
      id: name, row, ...(band ? { band } : {}), w: Math.max(1, fp.w), h: Math.max(1, fp.h),
      place: (x, y) => placeBlueprintSpecimen(map, world, rb, name, row, x, y, { clear }),
    });
  };

  // ── BAND ORDER IS TALLEST-FIRST, and that is load-bearing, not taste. The apron's own
  //    8 rows hold nothing; the usable ground is the dry terrace running south of it, and
  //    that terrace TAPERS as it reaches the coast (measured on the shipped world: 53 tiles
  //    wide down to y 112, then 50·48·47·38·33·32·30·27·13 to the shore at y 122). A tall
  //    item needs every one of its rows to be dry in the SAME columns, so a 11-row barrier
  //    run cannot stand in the taper — placing barriers last cost 10 of 13 runs. Ordered
  //    tall→short, the taper only ever meets 1×1 flora, which packs into any dry cell.
  //
  // Band 1 — the barrier line. Two registries, ONE layout band: a run per `class:'barrier'`
  // PRESET (built from the preset's own authored line), then a run per ENGINE `BarrierKind`
  // at its defaults — the latter is what covers `barricade`, which no hand preset uses. Each
  // gets a gate; towers come from `placeCoverageTowers`.
  for (const name of presetKeys((bp) => bp.class === 'barrier')) {
    const b = barrierSpecFromPreset(BUILDING_BLUEPRINTS[name]);
    if (!b) { report.failed.push({ id: name, row: 'barrierPresets', reason: 'preset has no barrier part' }); continue; }
    out.push({
      id: name, row: 'barrierPresets', band: 'barriers',
      w: barrierBoxW(b.spec.thickness), h: BARRIER_SPECIMEN_LENGTH + 1,
      place: (x, y) => placeBarrierSpecimen(map, world, name, 'barrierPresets', x, y, b.spec, b.gate),
    });
  }
  for (const kind of (Object.keys(BARRIER_DEFAULTS) as BarrierKind[]).sort()) {
    const spec = { kind, ...BARRIER_DEFAULTS[kind] };
    out.push({
      id: kind, row: 'barrierKinds', band: 'barriers',
      w: barrierBoxW(spec.thickness), h: BARRIER_SPECIMEN_LENGTH + 1,
      place: (x, y) => placeBarrierSpecimen(map, world, kind, 'barrierKinds', x, y, spec, DEFAULT_GATE_WIDTH_TILES),
    });
  }

  // Band 2 — every hand preset that is a BUILDING.
  for (const name of presetKeys((bp) => bp.class === 'building')) addBlueprint('buildings', name);

  // …and, in the SAME band, the catalogue buildingTypes with NO hand preset (the generative
  // bridge). Both are buildings; a band of five costs a whole row-height for 38% occupancy.
  for (const name of presetlessBuildingTypes()) addBlueprint('buildingTypes', name, [], true, 'buildings');

  // Band 3 — the small standing PROPS, and with them the STAIRS: four tiny items do not earn
  // a band of their own, and the tallest of them (`stair_grand`, 3×4) is the same height as
  // the props beside it. Each stair is turned to face the local downhill so the flight reads
  // against whatever grade the apron carries (a `params` patch, not a new preset).
  for (const name of presetKeys((bp) => bp.class === 'prop' && !isStairPreset(bp))) addBlueprint('props', name);
  for (const name of presetKeys((bp) => bp.class === 'prop' && isStairPreset(bp))) {
    const partKey = stairPartKey(BUILDING_BLUEPRINTS[name]);
    // Footprint first (unpatched — `dir` does not change the flight's extent), so the packer
    // can size the slot before the downhill direction at that slot is known.
    const { rb: probe, err } = resolve(name);
    if (!probe || !partKey) {
      report.failed.push({ id: name, row: 'stairs', reason: err ?? 'no stair_flight part' });
      continue;
    }
    const fp = toCollision(probe).footprint;
    out.push({
      id: name, row: 'stairs', band: 'props', w: Math.max(1, fp.w), h: Math.max(1, fp.h),
      place: (x, y) => {
        const dir = downhillCardinal(map, x + fp.w / 2, y + fp.h / 2);
        const turned = resolve(name, [{ parts: { [partKey]: { type: 'stair_flight', params: { dir } } } }]).rb;
        return placeBlueprintSpecimen(map, world, turned ?? probe, name, 'stairs', x, y);
      },
    });
  }

  // Band 5 — THE SWARD: every 1×1 vegetation specimen, in one band because they are the only
  // things that pack into the tapering ground at the coast. First the hand-authored PLANT
  // presets — those that own an entity kind take the organic kind-keyed vegetation path; the
  // 7 that do not (see the header) take the blueprint path — then every flora species (trees,
  // shrubs, rocks AND the clutter herbs/grasses/ferns, which are vegetation entities exactly
  // like a tree).
  //
  // THE SWARD IS BROADCAST (`fromTop`), AND THAT IS MEASURED, NOT LAZY. Laying it as an
  // ordinary band — one nursery block below the props, which is what a specimen ground wants
  // to look like — was TRIED and does not fit: with the props ending at y117 the sward's band
  // starts at y121, and the coast leaves ~102 dry cells below that against the ~250 a 61-item
  // 2×2 lattice needs. All 61 fell through to the backfill path, i.e. straight back to
  // broadcast, with a 61-name warning attached. Re-ordering does not rescue it either — the
  // three big bands plus their aisles already need ~32 of the ~36 usable rows, so whichever
  // band is pushed into the taper is the one that starts failing, and a coverage regression is
  // a worse outcome than a mixed sward. THE GROUND IS FULL: an ordered, aisled, one-row-per-
  // registry specimen ground needs more land than this island has (see the header's area
  // budget). What made the difference here was {@link mowSpecimenGround} — broadcast among 680
  // organic trees is a thicket; broadcast on mown ground is a collection.
  for (const name of presetKeys((bp) => bp.class === 'plant')) {
    if (hasVegetationKind(name)) {
      out.push({
        id: name, row: 'plants', band: 'sward', fromTop: true, w: 1, h: 1,
        place: (x, y) => placeVegetationSpecimen(map, world, name, 'plants', x, y),
      });
    } else {
      addBlueprint('plants', name, [], true, 'sward');
    }
  }
  for (const id of floraSpeciesIds()) {
    out.push({
      id, row: 'flora', band: 'sward', fromTop: true, w: 1, h: 1,
      place: (x, y) => placeVegetationSpecimen(map, world, id, 'flora', x, y),
    });
  }

  // Band 6 — THE WET ROW. Every bridge recipe, spanning REAL rendered water near the apron.
  // This row is the only coverage the low and high rungs of the crossing ladder get: worldgen
  // can only ever produce 3 distinct tiers at generation (`GEN_BRIDGE_CLASS_TIER`), so treat
  // it as load-bearing, not decoration. Sites are found at runtime (never hardcoded); if the
  // world has no reachable channel the bridges fall back into the dry flow so coverage still
  // holds, and the fallback is reported.
  const bridges = bridgePresetNames().sort();
  // Over-collect candidate reaches so each recipe can take the channel that best fits its own
  // span (a 12-tile stone arch wants a wider reach than a 3-tile log).
  const sites = findWetCrossings(map, rect, isWater, bridges.length * 3);
  const takenSites = new Set<number>();
  bridges.forEach((name) => {
    const { rb, err } = resolve(name);
    if (!rb) { report.failed.push({ id: name, row: 'bridges', reason: err ?? 'unresolved' }); return; }
    const fp = toCollision(rb).footprint;
    // Deck span ≈ footprint minus the two bank rows every recipe leaves at its ends.
    const wantSpan = Math.max(1, fp.w - 2);
    let bestIdx = -1, bestCost = Infinity;
    sites.forEach((s, si) => {
      if (takenSites.has(si)) return;
      // Span fit first (a deck must actually reach both banks), nearness second — weighted so
      // a channel one tile off-span never drags a specimen halfway across the map.
      const cost = Math.abs(s.span - wantSpan) * 8 + s.dist;
      if (cost < bestCost) { bestCost = cost; bestIdx = si; }
    });
    const site = bestIdx >= 0 ? sites[bestIdx] : undefined;
    if (bestIdx >= 0) takenSites.add(bestIdx);
    // No `clearFootprint` on this row — stamping grass under a bridge would fill in the very
    // water it spans (the `fishery_jetty` precedent: a prop over water is never grounded).
    const place: PlaceFn = (x, y) =>
      placeBlueprintSpecimen(map, world, rb, name, 'bridges', x, y, { clear: false });
    if (site) {
      // Straight onto the channel the scan found, OFF the dry flow grid: the deck is centred
      // on the wet run and the footprint's own bank rows (y0 = 1 in every recipe) land ashore.
      out.push({
        id: name, row: 'bridges', w: Math.max(1, fp.w), h: Math.max(1, fp.h), place,
        at: {
          x: Math.max(0, Math.min(map.width - fp.w, site.x - Math.max(0, Math.round((fp.w - site.span) / 2)))),
          y: Math.max(0, Math.min(map.height - fp.h, site.y - 1)),
        },
      });
      return;
    }
    out.push({ id: name, row: 'bridges', w: Math.max(1, fp.w), h: Math.max(1, fp.h), place });
    report.warnings.push(`bridge '${name}': no wet crossing within ${WET_SEARCH_RADIUS} tiles of the apron — placed DRY`);
  });

  return out;
}

// ─── Terrain helpers ──────────────────────────────────────────────────────────

/** The cardinal the ground falls away toward at (x, y), from the world heightfield. Feeds the
 *  stair row's `dir` patch so a flight descends the slope instead of climbing into it. */
function downhillCardinal(map: GameMap, x: number, y: number): 'north' | 'south' | 'east' | 'west' {
  const cxi = Math.round(x), cyi = Math.round(y);
  const h = (dx: number, dy: number): number => heightMetresAt(map, cxi + dx, cyi + dy);
  const gx = h(2, 0) - h(-2, 0);
  const gy = h(0, 2) - h(0, -2);
  if (Math.abs(gx) >= Math.abs(gy)) return gx > 0 ? 'west' : 'east';
  return gy > 0 ? 'north' : 'south';
}

interface WetCrossing { x: number; y: number; span: number; dist: number }

/**
 * Short WEST→EAST water runs near the apron with dry banks on both ends — one per bridge, all
 * distinct, nearest the apron centre first. Purely a scan of the RENDERED water the player
 * sees (`buildRenderWaterTypeMemo`), so a specimen deck lands over painted water, never over a
 * mask-only fringe. Deterministic: fixed scan order, no rng.
 */
function findWetCrossings(
  map: GameMap, rect: SpecimenRect, isWater: (x: number, y: number) => boolean, want: number,
): WetCrossing[] {
  if (want <= 0) return [];
  const acx = (rect.x0 + rect.x1) / 2, acy = (rect.y0 + rect.y1) / 2;
  const x0 = Math.max(1, Math.floor(acx - WET_SEARCH_RADIUS));
  const x1 = Math.min(map.width - 2, Math.ceil(acx + WET_SEARCH_RADIUS));
  const y0 = Math.max(1, Math.floor(acy - WET_SEARCH_RADIUS));
  const y1 = Math.min(map.height - 2, Math.ceil(acy + WET_SEARCH_RADIUS));
  const found: WetCrossing[] = [];
  for (let y = y0; y <= y1; y++) {
    let x = x0;
    while (x <= x1) {
      if (!isWater(x, y) || isWater(x - 1, y)) { x++; continue; }   // must start at the west bank
      let span = 0;
      while (x + span <= x1 && isWater(x + span, y)) span++;
      // A short crossing only: wide open water is a lake/sea, not a channel a specimen spans.
      if (span >= 1 && span <= MAX_WET_SPAN && !isWater(x + span, y)) {
        found.push({ x, y, span, dist: Math.hypot(x + span / 2 - acx, y - acy) });
      }
      x += span + 1;
    }
  }
  found.sort((a, b) => a.dist - b.dist || a.y - b.y || a.x - b.x);
  // Space the chosen sites out so nine decks do not stack on one reach.
  const picked: WetCrossing[] = [];
  for (const f of found) {
    if (picked.some((p) => Math.abs(p.x - f.x) < 10 && Math.abs(p.y - f.y) < 6)) continue;
    picked.push(f);
    if (picked.length >= want) break;
  }
  return picked;
}
