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

import type { GameMap, Entity, POI } from '@/core/types';
import type { World } from '@/world/world';
import type { Blueprint, BlueprintPatch, ResolvedBlueprint } from '@/blueprint/types';
import { BUILDING_BLUEPRINTS, synthesizeBlueprint, isBridgePreset, bridgePresetNames } from '@/blueprint/presets';
import { toCollision } from '@/blueprint/compile/to-collision';
import { blueprintEntity } from '@/blueprint/entity';
import { allFloraSpecies } from '@/flora/flora-registry';
import { loadDefaultPacks } from '@/catalogue/default-packs';
import { catalogue } from '@/catalogue/pack';
import { clearFootprint } from '@/world/building-placer';
import { defaultEntity } from '@/world/brush-helpers';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
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

// ─── Layout constants ─────────────────────────────────────────────────────────

/** Clear tiles between two specimens on a line. */
const GAP = 2;
/** Clear tiles between two ROWS (a row is one registry axis). */
const ROW_GAP = 3;
/** Side of the synthetic apron used when the POI carries a `position` but no `region`. */
const DEFAULT_APRON_SIDE = 64;
/** How far a wet-row search may wander from the apron looking for rendered water. */
const WET_SEARCH_RADIUS = 90;
/** Bounded retries when the flow cursor lands on water / off-map before giving up on a slot. */
const MAX_SLOT_RETRIES = 512;
/** Widest water run the wet row will call a "channel" — beyond this it is a lake or the sea,
 *  which no specimen deck spans. (The widest recipe, `stone-arch`, wants ~12 tiles.) */
const MAX_WET_SPAN = 14;

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
  failed: { id: string; row: string; reason: string }[];
  /** Non-fatal notes (e.g. a bridge that found no channel and stands on dry ground). */
  warnings: string[];
  /** Tiles the flow ran past the apron's south edge (0 ⇒ the apron was big enough). */
  overflowRows: number;
  /** Bounding box actually used (may exceed the apron — see `overflowRows`). */
  used: SpecimenRect | null;
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
  row: string;
  w: number;
  h: number;
  place: PlaceFn;
  /** Fixed world origin, bypassing the flow grid — the wet row's bridges sit on the channel
   *  the scan found, not on the apron lattice. */
  at?: { x: number; y: number };
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
  registryId: string, row: string, x: number, y: number,
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
  map: GameMap, world: World, kind: string, row: string, x: number, y: number,
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
  map: GameMap, world: World, registryId: string, row: string,
  x: number, y: number, spec: Omit<BarrierRun, 'path' | 'gates' | 'towers'>, gateWidthTiles: number,
): Entity | null {
  const len = BARRIER_SPECIMEN_LENGTH;
  const cy = y + Math.max(0, Math.floor((spec.thickness - 1) / 2));
  const run: BarrierRun = {
    ...spec,
    path: [[x, cy], [x + len, cy]],
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

/** Specimen barrier run length in tiles — "one SHORT run per kind". */
const BARRIER_SPECIMEN_LENGTH = 12;

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
    rect: null, placed: new Map(), failed: [], warnings: [], overflowRows: 0, used: null,
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

  // ── Flow layout: rows top→bottom, items left→right in sorted-key order. Deterministic,
  //    rng-free, and stable: the same registry yields the same coordinates every run.
  let cx = rect.x0;
  let cy = rect.y0;
  let lineH = 0;
  let lastRow = '';
  const used: SpecimenRect = { x0: rect.x0, y0: rect.y0, x1: rect.x0, y1: rect.y0 };

  const dryAt = (x: number, y: number, w: number, h: number): boolean => {
    if (x < 0 || y < 0 || x + w > map.width || y + h > map.height) return false;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (isWater(x + dx, y + dy)) return false;
    return true;
  };

  for (const s of specimens) {
    let px: number, py: number;
    if (s.at) {
      px = s.at.x; py = s.at.y;                                // wet row: fixed, off-grid
    } else {
      if (s.row !== lastRow) {
        if (lastRow !== '') { cy += lineH + ROW_GAP; cx = rect.x0; lineH = 0; }
        lastRow = s.row;
      }
      // Advance until the footprint fits on DRY, in-bounds ground. Rows wrap at the apron's
      // east edge; a wet or off-map slot is skipped rather than drowning a dry-row specimen.
      let tries = 0;
      let fits = false;
      while (tries++ < MAX_SLOT_RETRIES) {
        if (cx + s.w - 1 > rect.x1) { cy += lineH + GAP; cx = rect.x0; lineH = 0; continue; }
        if (dryAt(cx, cy, s.w, s.h)) { fits = true; break; }
        cx += 1;
      }
      if (!fits) {
        report.failed.push({ id: s.id, row: s.row, reason: 'no dry in-bounds slot in the apron' });
        continue;
      }
      px = cx; py = cy;
      cx += s.w + GAP;
      lineH = Math.max(lineH, s.h);
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
      }
    } else if (!report.failed.some((f) => f.id === s.id && f.row === s.row && f.reason.startsWith('placement'))) {
      report.failed.push({ id: s.id, row: s.row, reason: 'placement returned null' });
    }
  }

  report.used = used;
  report.overflowRows = Math.max(0, used.y1 - rect.y1);

  // Every `clearFootprint` above rewrote `tile.type`/`walkable` in place, and the flora tint
  // feeds the same colour field — without this the GPU repaints neither until reload.
  bumpTilesRev(map);

  if (!opts.quiet) {
    console.log(
      `[testbed] specimens: ${report.placed.size} ids placed, ${report.failed.length} failed; `
      + `apron ${rect.x1 - rect.x0 + 1}x${rect.y1 - rect.y0 + 1} at (${rect.x0},${rect.y0}), `
      + `used ${used.x1 - used.x0 + 1}x${used.y1 - used.y0 + 1}`
      + (report.overflowRows > 0
        ? ` — OVERFLOWED the apron by ${report.overflowRows} rows (grow specimen_apron to `
          + `${used.y1 - rect.y0 + 1} tall)`
        : ''),
    );
    for (const f of report.failed) console.warn(`[testbed] specimen '${f.id}' (${f.row}): ${f.reason}`);
    for (const w of report.warnings) console.warn(`[testbed] ${w}`);
  }
  return report;
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
  const addBlueprint = (row: string, name: string, patches: BlueprintPatch[] = [], clear = true): void => {
    const { rb, err } = resolve(name, patches);
    if (!rb) { report.failed.push({ id: name, row, reason: err ?? 'unresolved' }); return; }
    const fp = toCollision(rb).footprint;
    out.push({
      id: name, row, w: Math.max(1, fp.w), h: Math.max(1, fp.h),
      place: (x, y) => placeBlueprintSpecimen(map, world, rb, name, row, x, y, { clear }),
    });
  };

  // Row 1 — every hand preset that is a BUILDING.
  for (const name of presetKeys((bp) => bp.class === 'building')) addBlueprint('buildings', name);

  // Row 2 — the catalogue buildingTypes with NO hand preset (the generative bridge).
  for (const name of presetlessBuildingTypes()) addBlueprint('buildingTypes', name);

  // Row 3 — every hand preset that is a PROP, minus the stairs (their own graded row).
  for (const name of presetKeys((bp) => bp.class === 'prop' && !isStairPreset(bp))) addBlueprint('props', name);

  // Row 4 — the hand-authored PLANT presets. Those that own an entity kind take the organic
  // kind-keyed vegetation path; the 7 that do not (see the header) take the blueprint path.
  for (const name of presetKeys((bp) => bp.class === 'plant')) {
    if (hasVegetationKind(name)) {
      out.push({
        id: name, row: 'plants', w: 1, h: 1,
        place: (x, y) => placeVegetationSpecimen(map, world, name, 'plants', x, y),
      });
    } else {
      addBlueprint('plants', name);
    }
  }

  // Row 5 — every flora species (trees, shrubs, rocks AND the clutter herbs/grasses/ferns,
  // which are vegetation entities exactly like a tree — see the header).
  for (const id of floraSpeciesIds()) {
    out.push({
      id, row: 'flora', w: 1, h: 1,
      place: (x, y) => placeVegetationSpecimen(map, world, id, 'flora', x, y),
    });
  }

  // Row 6 — one run per `class:'barrier'` PRESET, built from the preset's own authored line.
  for (const name of presetKeys((bp) => bp.class === 'barrier')) {
    const b = barrierSpecFromPreset(BUILDING_BLUEPRINTS[name]);
    if (!b) { report.failed.push({ id: name, row: 'barrierPresets', reason: 'preset has no barrier part' }); continue; }
    out.push({
      id: name, row: 'barrierPresets',
      w: BARRIER_SPECIMEN_LENGTH + 1, h: Math.max(1, b.spec.thickness) + 1,
      place: (x, y) => placeBarrierSpecimen(map, world, name, 'barrierPresets', x, y, b.spec, b.gate),
    });
  }

  // Row 7 — one run per ENGINE `BarrierKind` at its defaults (this is what covers `barricade`,
  // which no hand preset uses). Each gets a gate; towers come from `placeCoverageTowers`.
  for (const kind of (Object.keys(BARRIER_DEFAULTS) as BarrierKind[]).sort()) {
    const spec = { kind, ...BARRIER_DEFAULTS[kind] };
    out.push({
      id: kind, row: 'barrierKinds',
      w: BARRIER_SPECIMEN_LENGTH + 1, h: Math.max(1, spec.thickness) + 1,
      place: (x, y) => placeBarrierSpecimen(map, world, kind, 'barrierKinds', x, y, spec, DEFAULT_GATE_WIDTH_TILES),
    });
  }

  // Row 8 — the STAIRS, each turned to face the local downhill so the flight reads against
  // whatever grade the apron carries (a `params` patch, not a new preset).
  for (const name of presetKeys((bp) => bp.class === 'prop' && isStairPreset(bp))) {
    const partKey = stairPartKey(BUILDING_BLUEPRINTS[name]);
    // Footprint first (unpatched — `dir` does not change the flight's extent), so the flow
    // layout can size the slot before the downhill direction at that slot is known.
    const { rb: probe, err } = resolve(name);
    if (!probe || !partKey) {
      report.failed.push({ id: name, row: 'stairs', reason: err ?? 'no stair_flight part' });
      continue;
    }
    const fp = toCollision(probe).footprint;
    out.push({
      id: name, row: 'stairs', w: Math.max(1, fp.w), h: Math.max(1, fp.h),
      place: (x, y) => {
        const dir = downhillCardinal(map, x + fp.w / 2, y + fp.h / 2);
        const turned = resolve(name, [{ parts: { [partKey]: { type: 'stair_flight', params: { dir } } } }]).rb;
        return placeBlueprintSpecimen(map, world, turned ?? probe, name, 'stairs', x, y);
      },
    });
  }

  // Row 9 — THE WET ROW. Every bridge recipe, spanning REAL rendered water near the apron.
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
