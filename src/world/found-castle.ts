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
import { projectRuntimePois } from '@/world/runtime-poi';

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
    provenance: { bornTick: state.clock.now(), cause: opts.cause, complexTypeId },
    earthworks,
    barrierRuns,
  });
  // Directory projection: both worldSeed clones (state + map) list the castle now.
  projectRuntimePois(store, [state.worldSeed, map.worldSeed]);

  return { poiId, poi, placement };
}
