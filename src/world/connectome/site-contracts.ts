// src/world/connectome/site-contracts.ts
//
// SITE-LEVEL contracts — invariants about a single placed fixture's relationship to the
// terrain it was sited against. Where `wall-contracts` speaks about a settlement's ring and
// `road-contracts` about the road ribbon, this file is for "the recipe asked for a thing to
// SIT somewhere specific; did it?".
//
// First tenant: `mill.wheel-reaches-water` (believability round WP-1,
// docs/audit/IMPLEMENTATION-PLAN.md). A watermill whose wheel turns over dry grass — or
// stops short of the water below it — is the single most-reported worldgen absurdity, and it
// went unnoticed for a whole content version because nothing checked it.
//
// Registered by side-effect import from `map/map-generator.ts`, the same wiring
// `road-contracts` and `scaling-contracts` use.
//
// WHY `level: 'world'` FOR A PER-SITE FINDING. `evaluateContracts` runs a contract
// unconditionally only when it is `level:'world'` AND `kind:'invariant'`; anything scoped
// must be DECLARED per instance on `map.contracts` (the `settlementRingContracts` seam). A
// mill is not a ring and has no declaration seam of its own yet, so a `site`/`requirement`
// registration — which is what this morally is, since worldgen actively tries to satisfy it —
// would silently never run. It therefore registers as a world invariant that scans every
// placed mill, exactly like `scaling.infrastructure-sublinear` scans every settlement. Promote
// it to a declared site-level requirement (with a `suggestedFix`) when a per-fixture
// declaration seam exists; the findings themselves are already per-entity.

import type { Entity, GameMap } from '@/core/types';
import type { Diagnostic } from '@/world/connectome-diagnostics';
import type { Contract } from '@/world/connectome-contracts';
import { registerContract } from '@/world/connectome-contracts';
import { heightField } from '@/render/gpu/terrain-field';
import { worldStyleOf } from '@/core/world-style';
import { blueprintOf } from '@/blueprint/entity';
import { millWheelGapM, metresPerPrimZ, type MillFace } from '@/world/mill-site-store';

const FACES: ReadonlySet<string> = new Set(['north', 'south', 'east', 'west']);
const FACE_VEC: Record<MillFace, readonly [number, number]> = {
  north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
};

/**
 * Slack (metres) allowed between the wheel's lowest point and the drawn fill line before the
 * contract complains.
 *
 * The placer measures on the generator's map STUB — base terrain ⊕ river incision, before
 * roads, foundation pads and wall footings are declared, and before those in turn move the
 * BANK-REFERENCED river surface. `mill-site-store` already aims deliberately deep to absorb
 * that (`PLACEMENT_DRIFT_ALLOWANCE_M`); this is the remaining slack before a miss is worth
 * reporting. 0.15 m is ~4 screen px on the default world — under a pixel-perfect eye's
 * threshold, and two orders below the 1.8–2.1 m gaps that prompted WP-1.
 */
const REACH_TOLERANCE_M = 0.15;

/** The bank cell behind a mill's wheel: the wheel hangs one cell beyond the footprint's
 *  `face` edge, so the foot elevation that matters is the footprint cell it hangs off. */
function bankCellOf(e: Entity, face: MillFace): { x: number; y: number } {
  const fp = (e.properties as { footprint?: { w: number; h: number } } | undefined)?.footprint;
  const w = fp?.w ?? 1, h = fp?.h ?? 1;
  const [fx, fy] = FACE_VEC[face];
  // Mirrors `settlement-plan.flankPoint` minus the face vector — i.e. the last footprint
  // cell on that flank, at the flank's centre.
  const cx = e.x + w / 2, cy = e.y + h / 2;
  return {
    x: Math.floor(cx + fx * (w / 2 + 0.5)) - fx,
    y: Math.floor(cy + fy * (h / 2 + 0.5)) - fy,
  };
}

/** The `submerge` param (prim-z units) on a placed mill's waterwheel part, or null. */
function submergeOf(e: Entity): number | null {
  const wheel = blueprintOf(e)?.rb.parts.find((p) => p.type === 'waterwheel');
  const v = wheel?.params.submerge;
  return typeof v === 'number' ? v : null;
}

/** Every entity the placer stamped as a civic mill, in deterministic id order. */
function millsOf(ctx: { world: { query(q: Record<string, unknown>): Iterable<Entity> } }): Entity[] {
  const out: Entity[] = [];
  for (const e of ctx.world.query({})) {
    if ((e.properties as { civic?: string } | undefined)?.civic === 'mill') out.push(e);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export const millWheelReachesWater: Contract = {
  id: 'mill.wheel-reaches-water',
  level: 'world',      // see the header — a site finding, registered where it actually runs
  kind: 'invariant',
  severity: 'warn',
  description: 'A watermill\'s wheel must hang over a cell the water is actually DRAWN on, and '
    + 'its lower arc must reach that surface. Checks every placed civic mill against the final '
    + 'composed terrain + unified water surface (waterSurfaceAt), converting the blueprint\'s '
    + 'submerge from prim-z units into terrain metres.',
  evaluate(ctx): Diagnostic[] {
    const map: GameMap | undefined = ctx.map;
    if (!map) return [];
    const mills = millsOf(ctx);
    if (mills.length === 0) return [];
    const hf = heightField(map);
    const relief = worldStyleOf(map.worldSeed).mountainRelief;
    const mpz = metresPerPrimZ(map);

    const out: Diagnostic[] = [];
    for (const e of mills) {
      const face = (e.properties as { waterFace?: string } | undefined)?.waterFace;
      // A map-less/legacy mill never resolved a flank (it was sited by the tile scan, not the
      // hydrology tags). There is nothing this contract can honestly measure — reporting it
      // would be reporting the absence of a claim, not a broken one.
      if (!face || !FACES.has(face)) continue;
      const bank = bankCellOf(e, face as MillFace);
      const gapM = millWheelGapM(map, bank.x, bank.y, face as MillFace, hf, relief);
      const [fx, fy] = FACE_VEC[face as MillFace];

      if (gapM === null) {
        out.push({
          rule: millWheelReachesWater.id,
          severity: 'warn',
          message: `watermill ${e.id} faces ${face}, but the cell its wheel hangs over `
            + `(${bank.x + fx},${bank.y + fy}) has no DRAWN water — the wheel turns on dry ground`,
          locus: { entities: [e.id], tiles: [{ x: bank.x + fx, y: bank.y + fy }] },
          metrics: { wheelX: bank.x + fx, wheelY: bank.y + fy },
        });
        continue;
      }
      const submerge = submergeOf(e) ?? 0;
      const shortfallM = gapM - submerge * mpz;
      if (shortfallM <= REACH_TOLERANCE_M) continue;
      out.push({
        rule: millWheelReachesWater.id,
        severity: 'warn',
        message: `watermill ${e.id} stands ${gapM.toFixed(2)} m above the water at its wheel `
          + `cell but its wheel only reaches ${(submerge * mpz).toFixed(2)} m below its foot `
          + `(submerge ${submerge}) — short by ${shortfallM.toFixed(2)} m`,
        locus: { entities: [e.id], tiles: [{ x: bank.x + fx, y: bank.y + fy }] },
        metrics: { gapM, submerge, reachM: submerge * mpz, shortfallM },
      });
    }
    return out;
  },
};

registerContract(millWheelReachesWater);
