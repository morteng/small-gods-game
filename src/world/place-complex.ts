// src/world/place-complex.ts
//
// Place a defended COMPLEX (motte-and-bailey, ringwork, walled enclosure) onto a real
// terrain patch — the DC-2/DC-3 step the connectome layer stops short of. The complex
// grammar (blueprint/connectome/complex.ts) resolves a `complexType` DOWN to a
// topological `ComplexPlan` (wards + concentric barrier rings + gates + buildings-by-ward)
// and `siteComplex` derives the earthworks; this module commits that plan to a `World` +
// `GameMap`:
//
//   * earthworks  → the shared deformation store (motte rises, ditch cuts) via
//                   buildEarthworkDeformations — so the ground actually changes shape.
//   * ring barriers → closed-polygon BarrierRun entities (lit, with a south gate) via
//                   placeBarrier, AND map.barrierRuns so the curtain gets its footing.
//   * buildings   → the keep on the motte top, the bailey buildings on an arc inside the
//                   outer ring, as blueprint entities the GPU scene composes at runtime.
//
// The plan is topological (rings carry a radius, buildings carry a ward, nothing carries a
// position), so placement is a clean geometric recipe centred on the site — no dependence
// on the settlement placer's lot machinery. Deterministic given (centre, seed).

import type { GameMap, Entity } from '@/core/types';
import type { World } from '@/world/world';
import type { Era } from '@/core/era';
import { catalogue } from '@/catalogue/pack';
import { loadDefaultPacks } from '@/catalogue/default-packs';
import type { ComplexTypeFields } from '@/catalogue/types';
import {
  expandComplex, complexToPlan, siteComplex, specFromComplexType,
  DEFENSIVE_SITE_WEIGHTS, type ComplexPlan, type PlacedComplex,
} from '@/blueprint/connectome';
import type { TerrainProbe } from '@/blueprint/connectome/types';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { blueprintEntity } from '@/blueprint/entity';
import { placeBarrier } from '@/world/place-barrier';
import { barrierRunFromType } from '@/world/enclosure';
import { BARRIER_DEFAULTS, type BarrierRun, type BarrierKind, type BarrierGate, type PlacedBarrier } from '@/world/barrier';
import { heightMetresAt } from '@/world/heightfield';

export interface PlaceComplexOpts {
  complexTypeId: string;       // e.g. 'motte_and_bailey'
  centre: { x: number; y: number };
  seed: number;
  era: Era;
}

export interface PlaceComplexResult {
  placed: PlacedComplex | null;   // chosen site + earthworks (spoil-conserved)
  plan: ComplexPlan;
  barriers: PlacedBarrier[];      // the ring runs committed (also set on map.barrierRuns)
  buildingIds: string[];
  barrierIds: string[];
  skippedBuildings: string[];     // buildingTypes that didn't resolve to a blueprint
}

/** A closed regular-polygon ring path (tile coords) + the arc-length t of a south gate. */
function ringPathWithGate(cx: number, cy: number, r: number, segs = 28): { path: [number, number][]; gateT: number } {
  const path: [number, number][] = [];
  const verts: [number, number][] = [];
  for (let k = 0; k < segs; k++) {
    const a = (2 * Math.PI * k) / segs;
    verts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  verts.push(verts[0]); // close
  // Cumulative arc length; the gate sits at the vertex nearest due-south (angle +π/2, +y).
  const gateVert = Math.round(segs / 4) % segs;
  let gateT = 0, acc = 0;
  for (let i = 0; i < verts.length; i++) {
    path.push(verts[i]);
    if (i === gateVert) gateT = acc;
    if (i + 1 < verts.length) acc += Math.hypot(verts[i + 1][0] - verts[i][0], verts[i + 1][1] - verts[i][1]);
  }
  return { path, gateT };
}

/** Build a ring BarrierRun for a barrierType id (falls back to BARRIER_DEFAULTS by kind). */
function ringRun(typeId: string, path: [number, number][], gates: BarrierGate[]): BarrierRun {
  const fromType = barrierRunFromType(typeId, path, gates);
  if (fromType) return fromType;
  const kind: BarrierKind = (['wall', 'fence', 'palisade', 'rampart', 'barricade', 'hedge'] as BarrierKind[])
    .includes(typeId as BarrierKind) ? (typeId as BarrierKind) : 'palisade';
  return { kind, path, gates, ...BARRIER_DEFAULTS[kind] };
}

/**
 * Place a complex centred on `centre` of `map`/`world`. Pure-ish: mutates the world
 * (adds entities), the map (`barrierRuns`), and the map's deformation store (earthworks).
 * Returns what it placed for inspection/diagnostics.
 */
export function placeComplexOnPatch(world: World, map: GameMap, opts: PlaceComplexOpts): PlaceComplexResult {
  loadDefaultPacks();
  const { complexTypeId, centre, seed, era } = opts;

  // Terrain probe: the affordance the siting step reads. We pre-choose the patch centre as
  // the single candidate (the studio decides WHERE; the grammar decides WHAT), so siteSelect
  // returns it and deriveEarthworks uses the real ground height there.
  const terrain: TerrainProbe = {
    affordanceAt: (x, y) => ({ height: heightMetresAt(map, Math.round(x), Math.round(y)) }),
  };
  const ctx = { era, seed, registry: catalogue, terrain };

  const con = expandComplex(complexTypeId, ctx);
  const plan = complexToPlan(con);
  const ct = catalogue.get<ComplexTypeFields>('complexType', complexTypeId);
  const spec = ct ? specFromComplexType(ct.fields) : null;

  // Site + earthworks (centred on the patch centre; spoil conserved).
  const placed = siteComplex(
    complexTypeId, ctx,
    { target: centre, desiredHeight: spec?.motteHeight },
    [centre], DEFENSIVE_SITE_WEIGHTS,
  );
  // Earthworks ride on map.earthworks (a persisted field), so the deformation producer
  // picks them up inside the memoised store rebuild — robust to the cache key changing
  // when we set map.barrierRuns below (an ad-hoc store.add would be orphaned by that).
  if (placed) {
    map.earthworks = [...(map.earthworks ?? []), ...placed.earthworks];
  }

  // Barrier rings (inner→outer). Each plan barrier carries attrs.radius from the ring slot.
  const barriers: PlacedBarrier[] = [];
  const barrierIds: string[] = [];
  plan.barriers.forEach((b, i) => {
    const radius = Number(b.attrs?.radius);
    if (!Number.isFinite(radius) || radius <= 1) return;
    const { path, gateT } = ringPathWithGate(centre.x, centre.y, radius);
    const run = ringRun(b.type, path, [{ t: gateT, width: 3 }]);
    const id = `${complexTypeId}-ring${i}`;
    barrierIds.push(String(placeBarrier(world, run, id)));
    barriers.push({ id, run });
  });
  map.barrierRuns = [...(map.barrierRuns ?? []), ...barriers];

  // Buildings: keep on the motte top (centre); bailey buildings on a north arc inside the
  // outer ring, away from the south gate/approach.
  const outerR = plan.barriers.reduce((m, b) => Math.max(m, Number(b.attrs?.radius) || 0), 0) || 20;
  const innerR = plan.barriers.reduce((m, b) => Math.min(m, Number(b.attrs?.radius) || Infinity), Infinity);
  const baileyR = Number.isFinite(innerR) ? (innerR + outerR) / 2 : outerR * 0.6;

  const bailey = plan.buildings.filter((b) => !b.onCore);
  const core = plan.buildings.filter((b) => b.onCore);
  const buildingIds: string[] = [];
  const skippedBuildings: string[] = [];

  const drop = (buildingType: string, x: number, y: number, idx: number): void => {
    const rb = synthesizeBlueprint(buildingType, [], seed + idx * 101);
    if (!rb) { skippedBuildings.push(buildingType); return; }
    const id = `${complexTypeId}-${buildingType}-${idx}`;
    const e: Entity = blueprintEntity(id, rb, Math.round(x), Math.round(y));
    world.addEntity(e);
    buildingIds.push(id);
  };

  core.forEach((b, i) => drop(b.buildingType, centre.x, centre.y, i));
  // North arc centred on -π/2 (up), spread ±120°, so they ring the bailey clear of the gate.
  const SPREAD = (2 * Math.PI) / 3; // ±120°
  bailey.forEach((b, i) => {
    const t = bailey.length > 1 ? i / (bailey.length - 1) - 0.5 : 0;
    const a = -Math.PI / 2 + 2 * SPREAD * t;
    drop(b.buildingType, centre.x + baileyR * Math.cos(a), centre.y + baileyR * Math.sin(a), 100 + i);
  });

  return { placed, plan, barriers, buildingIds, barrierIds, skippedBuildings };
}
