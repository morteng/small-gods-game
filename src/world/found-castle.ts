// src/world/found-castle.ts
//
// M4 S2 — FOUND a castle at runtime: the single game-path creator of a runtime POI
// (spike §7.5: the Site studio stays POI-less; this wrapper is how the GAME plants a
// defended complex). It wraps the shipped-but-never-called `placeComplexOnPatch`
// primitive and adds everything that makes the placement a first-class, scrub-safe
// place:
//
//   1. allocates a runtime poiId (`castle:0001`) from the snapshot-authoritative
//      `RuntimePoiStore`;
//   2. stamps the ground via `placeComplexOnPatch` (earthworks → deformation store,
//      ring barriers → entities + `map.barrierRuns`, keep/bailey → blueprint
//      entities), minting entity ids under a `<poiId>:` prefix so two castles of
//      the same complexType never collide;
//   3. tags the committed earthworks + barrier runs with `ownerPoiId` and records
//      them on the store entry — the provenance `reconcileRuntimePoiStamps` needs
//      to un-build the castle on a scrub to before its bornTick;
//   4. projects the new POI into `worldSeed.pois` (marked `runtime: true`, so the
//      heightfield-inertness guards keep the base terrain untouched) — perception,
//      naming, focus, minimap and Fate prose see it immediately.
//
// Deterministic given (state.rng-driven caller, centre, seed): no `Math.random`,
// ids by call order. The player-facing `found_castle` capability verb is S4; until
// then this is the harness/system entry point.

import type { GameState } from '@/core/state';
import type { GameMap, POI } from '@/core/types';
import type { World } from '@/world/world';
import type { Era } from '@/core/era';
import { placeComplexOnPatch, type PlaceComplexResult } from '@/world/place-complex';
import { projectRuntimePois, rebuildDominions } from '@/world/runtime-poi';
import { catalogue } from '@/catalogue/pack';
import { loadDefaultPacks } from '@/catalogue/default-packs';
import type { ComplexTypeFields } from '@/catalogue/types';
import {
  siteSelect, specFromComplexType, DEFENSIVE_SITE_WEIGHTS, type SiteCandidate,
} from '@/blueprint/connectome';
import type { TerrainProbe } from '@/blueprint/connectome/types';
import { heightMetresAt } from '@/world/heightfield';
import { isWaterTile } from '@/world/land-snap';

export interface FoundCastleOpts {
  centre: { x: number; y: number };
  /** Geometry seed fed to the complex grammar (deterministic — derive from `ctx.rng`). */
  seed: number;
  era: Era;
  /** Complex recipe; defaults to the timber first rung of the wealth ladder. */
  complexTypeId?: string;
  /** Display name for the directory/prose. S4 owns real naming. */
  name?: string;
  /** Attribution: a spirit id, `lord:<npcId>`, 'fate', … */
  cause: string;
  /** M4 S4: the settlement whose seated lord founded the place (the verb's
   *  one-castle-per-seat provenance). Absent on harness foundations. */
  foundedFromPoiId?: string;
}

export interface FoundCastleResult {
  poiId: string;
  poi: POI;
  placement: PlaceComplexResult;
}

/**
 * Found a castle at `centre`. Returns null — with NO partial state left behind —
 * when the siting step rejects the ground (`placed === null`); otherwise the
 * castle is live, addressable, and fully scrub-safe.
 */
export function foundCastle(
  world: World,
  map: GameMap,
  state: GameState,
  opts: FoundCastleOpts,
): FoundCastleResult | null {
  const store = state.runtimePois;
  const complexTypeId = opts.complexTypeId ?? 'motte_and_bailey';
  // Allocate first so entity ids can ride the poiId prefix. The counter never
  // rewinds on rejection — ids stay unique, and replay determinism holds because
  // allocation is by call order either way.
  const poiId = store.allocateId('castle');

  const baseEarthworks = map.earthworks?.length ?? 0;
  const baseRuns = map.barrierRuns?.length ?? 0;

  const placement = placeComplexOnPatch(world, map, {
    complexTypeId,
    centre: opts.centre,
    seed: opts.seed,
    era: opts.era,
    idPrefix: `${poiId}:`,
  });

  if (!placement.placed) {
    // Siting rejected the ground. `placeComplexOnPatch` still committed barrier
    // rings + buildings (it predates a rejection path — S4's job to refine);
    // roll those back so a failed foundation leaves NO partial state.
    for (const id of [...placement.barrierIds, ...placement.buildingIds, ...placement.fixtureIds]) {
      world.removeEntity(id);
    }
    if (map.barrierRuns) map.barrierRuns = map.barrierRuns.slice(0, baseRuns);
    return null;
  }

  // Ownership tags: the provenance the snapshot-restore reconcile keys on.
  const earthworks = (map.earthworks ?? []).slice(baseEarthworks);
  const barrierRuns = (map.barrierRuns ?? []).slice(baseRuns);
  for (const e of earthworks) e.ownerPoiId = poiId;
  for (const b of barrierRuns) b.ownerPoiId = poiId;

  const poi: POI = {
    id: poiId,
    type: 'castle',
    name: opts.name ?? 'The New Castle',
    position: { x: Math.round(opts.centre.x), y: Math.round(opts.centre.y) },
    size: 'small',
    importance: 'medium',
    runtime: true,
  };

  store.add({
    poi,
    provenance: {
      bornTick: state.clock.now(), cause: opts.cause, complexTypeId,
      ...(opts.foundedFromPoiId ? { foundedFromPoiId: opts.foundedFromPoiId } : {}),
    },
    earthworks,
    barrierRuns,
  });
  // Directory projection: both worldSeed clones (state + map) list the castle now.
  projectRuntimePois(store, [state.worldSeed, map.worldSeed]);
  // M5: dominion link (gripped settlement → castle) is live the moment the
  // provenance exists — activeness still waits on the seat + garrison
  // (grippingSeatOf), which LordSystem attaches within a game hour.
  rebuildDominions(world.dominions, store);

  return { poiId, poi, placement };
}

// ── S4: deterministic castle siting — siteSelect finally gets its N candidates ──

/** Candidate lattice shape around the founding settlement: three distance bands
 *  (measured OUT from the complex's own outer ring radius, so the bailey never
 *  overlaps the town) × this many bearings. */
const SITE_BEARINGS = 16;
const SITE_BAND_STEP = 8;          // tiles between the three distance bands
const SITE_CLEARANCE = 6;          // tiles of open ground between town edge and outer ring
const RING_LAND_SAMPLES = 16;      // per-radius sample points that must be dry land

export interface ChooseCastleSiteOpts {
  /** Complex recipe; sets the outer-ring radius (candidate margins) and the
   *  motte height the defensive score wants. Defaults like `foundCastle`. */
  complexTypeId?: string;
  /** Tie-break seed for `siteSelect` (deterministic — derive from `ctx.rng`). */
  seed: number;
}

/**
 * Choose where the lord's castle stands: a deterministic polar lattice of
 * candidates around `target` (the settlement to control — the 'subdue-town'
 * intent), filtered to sites whose centre AND outer-ring circle stand on
 * in-bounds dry land, scored by `siteSelect` + `DEFENSIVE_SITE_WEIGHTS` over the
 * real composed terrain (`heightMetresAt`). This is the spike's "feed it N
 * hilltops and it chooses for free" — `placeComplexOnPatch` still receives the
 * ONE chosen centre. Returns null when no candidate survives the land filter
 * (the caller declines cleanly — no partial state).
 */
export function chooseCastleSite(
  map: GameMap,
  target: { x: number; y: number },
  opts: ChooseCastleSiteOpts,
): { x: number; y: number } | null {
  loadDefaultPacks();
  const complexTypeId = opts.complexTypeId ?? 'motte_and_bailey';
  const ct = catalogue.get<ComplexTypeFields>('complexType', complexTypeId);
  const spec = ct ? specFromComplexType(ct.fields) : null;
  const outerR = Math.max(
    4, ...(ct?.fields.rings ?? []).map(r => Number(r.radius) || 0),
  );
  const margin = outerR + 2;

  const dryLand = (x: number, y: number): boolean => {
    const tx = Math.round(x), ty = Math.round(y);
    if (tx < margin || ty < margin || tx >= map.width - margin || ty >= map.height - margin) return false;
    return !isWaterTile(map, tx, ty);
  };
  // The whole WORK must stand dry: the curtain (outer ring), the bailey arc
  // where the buildings drop (~0.65·R), and the yard — a pond inside the ring
  // is a barrier.over-water / building.on-water lint error waiting to commit.
  const ringOnLand = (cx: number, cy: number): boolean => {
    for (const r of [outerR, outerR * 0.65, outerR * 0.3]) {
      for (let k = 0; k < RING_LAND_SAMPLES; k++) {
        const a = (2 * Math.PI * k) / RING_LAND_SAMPLES;
        const sx = Math.round(cx + r * Math.cos(a));
        const sy = Math.round(cy + r * Math.sin(a));
        if (sx < 0 || sy < 0 || sx >= map.width || sy >= map.height) return false;
        if (isWaterTile(map, sx, sy)) return false;
      }
    }
    return true;
  };

  // Polar lattice: three distance bands × SITE_BEARINGS bearings, in a fixed
  // deterministic order (band-major, bearing-minor).
  const dMin = outerR + SITE_CLEARANCE;
  const candidates: SiteCandidate[] = [];
  for (let band = 0; band < 3; band++) {
    const d = dMin + band * SITE_BAND_STEP;
    for (let k = 0; k < SITE_BEARINGS; k++) {
      const a = (2 * Math.PI * k) / SITE_BEARINGS;
      const x = Math.round(target.x + d * Math.cos(a));
      const y = Math.round(target.y + d * Math.sin(a));
      if (!dryLand(x, y) || !ringOnLand(x, y)) continue;
      candidates.push({ x, y });
    }
  }
  if (!candidates.length) return null;

  const probe: TerrainProbe = {
    affordanceAt: (x, y) => ({ height: heightMetresAt(map, Math.round(x), Math.round(y)) }),
  };
  const best = siteSelect(
    candidates,
    { purpose: 'subdue-town', target, desiredHeight: spec?.motteHeight ?? 8 },
    DEFENSIVE_SITE_WEIGHTS,
    probe,
    opts.seed,
  );
  return best ? { x: best.site.x, y: best.site.y } : null;
}
