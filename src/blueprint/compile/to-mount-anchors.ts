// src/blueprint/compile/to-mount-anchors.ts
//
// MOUNT anchors for a placed building: the typed attachment points a sign hangs on, a lamp
// brackets to, a banner flies from, a bird lands on, smoke leaves through. Sibling to
// `toAnchors` (which emits ground-plane CONNECTION anchors from passable openings); this
// emits the height-bearing sockets ON the structure, derived from the SAME resolved
// geometry so they sit on real ridges/gables/lintels rather than invented points.
//
// Pure + deterministic + content-free. Nothing consumes these for placement yet — they are
// the E0.5 "scale-free Anchor" foundation (see the establishments/site-connectome design,
// §5) that a later fauna/decoration/sign pass reads via `accepts` tokens.
//
// The mount-kind vocabulary (roof_ridge/gable_peak/roof_apex/chimney_top/eave/lintel)
// realises the earlier semantic-feature-anchor-tags brainstorm
// (docs/superpowers/specs/2026-06-13-semantic-feature-anchor-tags-design.md), but in WORLD
// space (metric, works on grey massing) rather than that spec's sprite-normalised tags —
// per the 2026-06-24 "unified anchor, whole stack" decision. A sprite-normalised projection
// (for 2D decoration rendering) is a downstream lookup off these, built when a renderer needs it.
import type { ResolvedBlueprint, ResolvedPart, WallFace } from '../types';
import { getFeatureType } from '../registry';
import { faceCell, FACE_FACING } from '../wall-geometry';
import { METRES_PER_TILE, STOREY_M, DOOR_HEIGHT_M } from '@/render/scale-contract';
import type { Anchor } from '@/world/anchors';

/** Roof rise ≈ a ~35° gable over the SHORT span (the gabled-end half-width). */
const GABLE_PITCH = 0.7;            // tan(35°) ≈ 0.70
const CHIMNEY_STACK_M = 1.0;        // a stack stands ~1 m proud of the ridge it pierces

/** Eave (wall-top) and ridge (crest) height in metres for a body-like part. */
function bodyHeights(part: ResolvedPart): { eaveM: number; ridgeM: number; rise: number } {
  const storeys = Math.max(1, (part.params.levels as number) ?? 1);
  const storeyM = (part.params.storeyM as number) > 0 ? (part.params.storeyM as number) : STOREY_M;
  const eaveM = storeys * storeyM;
  const roof = (part.params.roof as string) ?? 'gable';
  if (roof === 'flat') return { eaveM, ridgeM: eaveM, rise: 0 };
  const shortSpanM = Math.min(part.size.w, part.size.h) * METRES_PER_TILE;
  const rise = (shortSpanM / 2) * GABLE_PITCH;
  return { eaveM, ridgeM: eaveM + rise, rise };
}

/** Does this part carry a pitched roof we can hang ridge/gable sockets on? */
function isRoofedMass(part: ResolvedPart): boolean {
  return part.params.roof !== undefined && part.params.levels !== undefined;
}

/** Mount anchors for a placed resolved blueprint (origin = footprint top-left in world tiles). */
export function toMountAnchors(rb: ResolvedBlueprint, originX: number, originY: number): Anchor[] {
  const out: Anchor[] = [];
  for (const part of rb.parts) {
    // 1. Lintel over every passable opening — the sign/lamp socket above a door.
    for (const f of part.features) {
      const ft = getFeatureType(f.type);
      if (!ft?.threshold) continue;
      const face = (f.face ?? 'south') as WallFace;
      const t = (f.params.t as number) ?? 0.5;
      const [cx, cy] = faceCell(part, face, t);
      const fdir = FACE_FACING[face];
      const x = originX + cx + (fdir[0] > 0 ? 1 : fdir[0] < 0 ? 0 : 0.5);
      const y = originY + cy + (fdir[1] > 0 ? 1 : fdir[1] < 0 ? 0 : 0.5);
      out.push({
        kind: 'lintel', x, y, facing: fdir, z: DOOR_HEIGHT_M,
        accepts: ['sign', 'lamp'], main: f.params.main === true,
      });
    }

    if (!isRoofedMass(part)) continue;
    const { ridgeM } = bodyHeights(part);
    const plan = part.params.plan as string | undefined;
    const ox = originX + part.at.x, oy = originY + part.at.y;
    const w = part.size.w, h = part.size.h;
    const cx = ox + w / 2, cy = oy + h / 2;

    // 2/3. Round/domed/conical masses: a single apex socket at the cone/dome tip.
    if (plan === 'round') {
      out.push({ kind: 'roof_apex', x: cx, y: cy, facing: [0, 0], z: ridgeM, accepts: ['perch', 'finial', 'vane'] });
      continue;
    }
    if ((part.params.roof as string) === 'flat') continue;  // no ridge/gable on a flat roof

    // Ridge runs along the LONGER footprint axis; the two gable peaks cap the SHORT-axis ends.
    const ridgeAlongX = w >= h;
    // Ridge crest socket (mid-roof) — a weathervane / perch line.
    out.push({ kind: 'roof_ridge', x: cx, y: cy, facing: [0, 0], z: ridgeM, accepts: ['perch', 'vane', 'finial'] });
    // Two gable peaks at the ridge ends, each facing outward along the ridge axis.
    if (ridgeAlongX) {
      out.push({ kind: 'gable_peak', x: ox + 0.5, y: cy, facing: [-1, 0], z: ridgeM, accepts: ['perch', 'finial', 'banner'] });
      out.push({ kind: 'gable_peak', x: ox + w - 0.5, y: cy, facing: [1, 0], z: ridgeM, accepts: ['perch', 'finial', 'banner'] });
    } else {
      out.push({ kind: 'gable_peak', x: cx, y: oy + 0.5, facing: [0, -1], z: ridgeM, accepts: ['perch', 'finial', 'banner'] });
      out.push({ kind: 'gable_peak', x: cx, y: oy + h - 0.5, facing: [0, 1], z: ridgeM, accepts: ['perch', 'finial', 'banner'] });
    }

    // 4. Chimney tops — one per smoke vent, riding the ridge at the vent's fraction `t`.
    for (const f of part.features) {
      if (f.type !== 'vent') continue;
      const t = (f.params.t as number) ?? 0.5;
      const x = ridgeAlongX ? ox + t * w : cx;
      const y = ridgeAlongX ? cy : oy + t * h;
      out.push({ kind: 'chimney_top', x, y, facing: [0, 0], z: ridgeM + CHIMNEY_STACK_M, accepts: ['smoke', 'perch'] });
    }
    // (eave-bracket sockets — lamp/perch along the wall-top at height `eaveM` — next increment.)
  }
  return out;
}
