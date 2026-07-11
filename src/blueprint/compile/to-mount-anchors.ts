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

// Roof + chimney dimensions MUST match the actual geometry (`src/assetgen/geometry/solids.ts`)
// or the projected sprite tags float off the rendered massing (the ridge sat at ~half height
// and chimney sockets fell short of the stacks, 2026-06-25). `mount-anchor-geometry-parity`
// pins these equal to the exported solids constants without importing the heavy manifold
// module into the runtime/sim anchor path.
export const GABLE_PITCH = 1.5;     // rise per unit HALF-span (≈56°) — solids GABLE_PITCH
export const HIP_PITCH = 1.35;      // solids HIP_PITCH
export const SHED_SLOPE = 0.5;      // mono-pitch rise per unit of FULL run — solids SHED_SLOPE
export const CHIMNEY_PROTRUDE = 0.55; // tiles a ridge stack clears the slope — solids CHIMNEY_PROTRUDE
export const MANSARD_RISE_K = 1.1;  // mansard rise per unit half-span — solids MANSARD_RISE_K
export const SALTBOX_RIDGE_T = 0.35; // saltbox ridge fraction across the span — solids SALTBOX_RIDGE_T
const VENT_CW = 0.30;               // chimney stack width (tiles) — solids ventProfile('chimney')

/** Roof rise (TILES) above the wall top, mirroring solids `roofRise`: a gable/hip pitches
 *  over HALF the across-ridge span; a shed slopes over the FULL run; flat has none.
 *  gambrel/cross_gable share the gable crest by construction; saltbox crests at
 *  GABLE_PITCH · t · span; mansard at MANSARD_RISE_K · half-span. */
function roofRiseTiles(part: ResolvedPart): number {
  const roof = (part.params.roof as string) ?? 'gable';
  if (roof === 'flat') return 0;
  const crossTiles = Math.min(part.size.w, part.size.h);   // span perpendicular to the ridge
  if (roof === 'shed' || roof === 'mono_pitch' || roof === 'lean_to') return SHED_SLOPE * crossTiles;
  if (roof === 'saltbox') return GABLE_PITCH * SALTBOX_RIDGE_T * crossTiles;
  if (roof === 'mansard') return MANSARD_RISE_K * (crossTiles / 2);
  const hip = roof === 'hip' || roof === 'pyramidal' || roof === 'half_hip';
  return (hip ? HIP_PITCH : effectiveGablePitch(part)) * (crossTiles / 2);
}

/** The gable family's per-part pitch override (body `roofPitch` → wing `pitch`; solids
 *  `pitchOf(w) = w.pitch ?? GABLE_PITCH`). The v30 shallower-pitch presets AUTHOR this
 *  (tavern roofPitch 1.05), and the mirror must honour it or every roof socket floats
 *  ~0.45·half-span above the real ridge — perched birds hung in mid-air, 2026-07-11.
 *  NOTE the mirror still ignores jetty oversail (roof spans the jettied outline, a few
 *  px of extra rise on jettied presets) — accepted tolerance, same as before. */
function effectiveGablePitch(part: ResolvedPart): number {
  const p = part.params.roofPitch as number | undefined;
  return typeof p === 'number' && p > 0 ? p : GABLE_PITCH;
}

/** Eave (wall-top) and ridge (crest) height in METRES for a body-like part. */
function bodyHeights(part: ResolvedPart): { eaveM: number; ridgeM: number } {
  const storeys = Math.max(1, (part.params.levels as number) ?? 1);
  const storeyM = (part.params.storeyM as number) > 0 ? (part.params.storeyM as number) : STOREY_M;
  const eaveM = storeys * storeyM;
  return { eaveM, ridgeM: eaveM + roofRiseTiles(part) * METRES_PER_TILE };
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
    const { eaveM, ridgeM } = bodyHeights(part);
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

    // 4. Chimney tops — one per smoke vent, at the stack's actual top. A ridge stack is
    //    OFFSET to one side of the ridge (it clears the beam) and a wall stack hugs its
    //    chosen face; both rise CHIMNEY_PROTRUDE above the ridge. Mirrors solids `ventSolid`.
    const zTop = ridgeM + CHIMNEY_PROTRUDE * METRES_PER_TILE;
    for (const f of part.features) {
      if (f.type !== 'vent') continue;
      const t = (f.params.t as number) ?? 0.5;
      let vx: number, vy: number;
      if ((f.params.placement as string) === 'wall') {
        const face = (f.face ?? 'south') as WallFace;
        const half = VENT_CW / 2;
        if (face === 'south')      { vx = ox + t * w;    vy = oy + h + half; }
        else if (face === 'north') { vx = ox + t * w;    vy = oy - half; }
        else if (face === 'east')  { vx = ox + w + half; vy = oy + t * h; }
        else                       { vx = ox - half;     vy = oy + t * h; }
      } else {
        // Ridge stack: clear the ridge line toward the camera-facing (+cross) slope.
        const off = Math.min(VENT_CW / 2 + 0.08, (Math.min(w, h) / 2) * 0.55);
        if (ridgeAlongX) { vx = ox + t * w; vy = cy + off; }
        else             { vx = cx + off;   vy = oy + t * h; }
      }
      out.push({ kind: 'chimney_top', x: vx, y: vy, facing: [0, 0], z: zTop, accepts: ['smoke', 'perch'] });
    }

    // 5. Eave sockets at the two long-wall midpoints (the roof's lower edges) — bracket a
    //    lamp, hang a sign arm, or let a bird perch on the wall-top. The eave walls run
    //    PARALLEL to the ridge, so they face across the ridge axis.
    if (ridgeAlongX) {
      out.push({ kind: 'eave', x: cx, y: oy,     facing: [0, -1], z: eaveM, accepts: ['lamp', 'bracket', 'perch'] });
      out.push({ kind: 'eave', x: cx, y: oy + h, facing: [0, 1],  z: eaveM, accepts: ['lamp', 'bracket', 'perch'] });
    } else {
      out.push({ kind: 'eave', x: ox,     y: cy, facing: [-1, 0], z: eaveM, accepts: ['lamp', 'bracket', 'perch'] });
      out.push({ kind: 'eave', x: ox + w, y: cy, facing: [1, 0],  z: eaveM, accepts: ['lamp', 'bracket', 'perch'] });
    }
  }
  return out;
}
