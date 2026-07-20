// src/assetgen/geometry/linear.ts
// Linear defensive structures (walls / ramparts / palisades / fences / hedges) for the
// manifold-3d CSG pipeline. A polyline path → a believable fortification cross-section
// extruded along each segment, then gates boolean-subtracted as clean openings. Emits the
// same flat-normal WorldFacets + world-space anchors as the building massing path, so a
// barrier rides the SAME compose → SpritePack → banded-PBR lighting as a building.
//
// The geometry is *defensive-construction aware* — the cross-section is chosen by the
// barrier's construction FAMILY (drawn from its kind + material), not one box-per-segment:
//
//   • masonry  (stone/brick wall, town wall, curtain) — a battered plinth (talus) so the
//     foot flares out (deflects shot, resists the sap), a curtain rising to a wall-walk
//     (allure), and a crenellated parapet on the field edge(s): merlons (solid teeth) with
//     crenels (gaps) over a continuous base course so no light leaks at knee height. A plain
//     field wall (no crenels) instead gets a saddleback coping cope on top, drystone-battered.
//   • palisade (timber stockade) — close-set pointed stakes lashed by two horizontal rails,
//     standing on a low earthen bank (the rampart crest it was driven into).
//   • light    (paling fence / barricade) — square posts + one or two rails, an open field.
//   • living   (hedge) — a row of overlapping organic blobs, bushy and battered.
//   • earthbank(rampart of earth) — a broad trapezoidal bank, no crest works.
//
// Dimensions are grounded in docs/reference/medieval-building-reference.md + the metric scale
// contract (1 tile = 2 m). Pure + deterministic (no Math.random) so identical runs cache to
// one sprite and the assetgen goldens stay stable.
import type { Vec3, Mat, WorldFacet } from '@/assetgen/types';
import type { Manifold } from 'manifold-3d';
import { getManifold } from '@/assetgen/geometry/manifold-runtime';
import { manifoldToFacets } from '@/assetgen/geometry/solids';
import { mToTiles } from '@/render/scale-contract';
import { MERLON_PERIOD_TILES, MERLON_WIDTH_FRAC } from '@/assetgen/geometry/tower-spec';
import type { BarrierRun } from '@/world/barrier';

export interface LinearResult {
  facets: WorldFacet[];
  anchors: { wallEnds: Vec3[]; gates: Vec3[] };   // WORLD-space points (tile x,y; z up)
  volume: number;
}

type ManifoldT = Manifold;
type ManifoldNS = Awaited<ReturnType<typeof getManifold>>['Manifold'];

const RAD2DEG = 180 / Math.PI;

/** Snap a near-canonical bearing to an exact 45° multiple so a piece composed from a canonical
 *  wall edge (WP-W2) rotates to a clean axis/diagonal (no sub-degree float noise in the rotate),
 *  while a genuinely free-angle legacy run keeps its exact bearing. */
function snapAngle45(deg: number): number {
  const snapped = Math.round(deg / 45) * 45;
  return Math.abs(deg - snapped) < 0.5 ? snapped : deg;
}

/** Per-segment geometry derived from a consecutive path pair (local +x = along the run). */
interface Seg { ax: number; ay: number; len: number; angleDeg: number }

function segments(path: [number, number][]): Seg[] {
  const segs: Seg[] = [];
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len <= 0) continue;
    segs.push({ ax, ay, len, angleDeg: snapAngle45(Math.atan2(by - ay, bx - ax) * RAD2DEG) });
  }
  return segs;
}

/** Map a path distance `t` (tiles) to a world point + the segment angle it falls on. */
function pointAt(path: [number, number][], t: number): { p: [number, number]; angleDeg: number } {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const len = Math.hypot(bx - ax, by - ay);
    const angleDeg = snapAngle45(Math.atan2(by - ay, bx - ax) * RAD2DEG);
    if (t <= acc + len) {
      const u = (t - acc) / (len || 1);
      return { p: [ax + (bx - ax) * u, ay + (by - ay) * u], angleDeg };
    }
    acc += len;
  }
  const [ax, ay] = path[path.length - 2] ?? path[0];
  const [bx, by] = path[path.length - 1];
  return { p: [bx, by], angleDeg: snapAngle45(Math.atan2(by - ay, bx - ax) * RAD2DEG) };
}

const MATERIAL_MAP: Record<string, Mat> = {
  stone: 'stone', timber: 'timber', wood: 'timber', earth: 'earth', brick: 'brick', hedge: 'foliage',
};

/** Construction family — drives the whole cross-section. Derived from kind + material. */
type Family = 'masonry' | 'palisade' | 'light' | 'living' | 'earthbank';

function familyOf(run: BarrierRun): Family {
  const m = run.material;
  if (m === 'hedge') return 'living';
  if (run.kind === 'palisade') return 'palisade';
  if (run.kind === 'rampart' && (m === 'earth')) return 'earthbank';
  if (m === 'stone' || m === 'brick') return 'masonry';
  if (m === 'earth') return 'earthbank';
  if (run.kind === 'wall') return 'masonry';      // a timber "wall" still reads as a solid curtain
  return 'light';                                  // fence / barricade
}

/** Default masonry coursing for a material — fine ashlar for brick, rubble for stone. A
 *  drystone field wall (thin, uncrenellated) reads as `dry_stone`; a town wall as ashlar.
 *  Exported so a run's TOWERS and STAIRS paint the SAME coursing as its curtain. */
export function masonryWork(run: BarrierRun): string {
  if (run.material === 'brick') return 'running';
  if (!run.crenellated && run.thickness <= 1) return 'dry_stone';
  return run.crenellated ? 'ashlar' : 'coursed_rubble';
}

/** A material group: a solid + the material (+ optional masonry/finish work) it paints with.
 *  Gates are subtracted from every group, so an opening cuts cleanly through the whole run. */
interface MatGroup { mat: Mat; work?: string; solid: ManifoldT }

/** A box in the segment-LOCAL frame: spans `aLen` along +x from along-offset `a0`, `cross`
 *  wide centred on the line (+`yOff`), rising `h` from `z0`. Caller rotates+places it. */
function locBox(M: ManifoldNS, a0: number, aLen: number, cross: number, z0: number, h: number, yOff = 0): ManifoldT {
  return M.cube([aLen, cross, h]).translate([a0, yOff - cross / 2, z0]);
}

/** Place a local-frame solid onto segment `s` (rotate about z, then translate to the start). */
function place(m: ManifoldT, s: Seg): ManifoldT {
  return m.rotate([0, 0, s.angleDeg]).translate([s.ax, s.ay, 0]);
}

/** Deterministic 0..1 hash for organic jitter (hedge), seeded by integer index. */
function hash01(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Which local-y is OUTWARD (toward the field, away from what the wall protects) for segment `s`?
 * Returns +1 (local +y outward), −1 (local −y outward), or 0 (unknown → caller keeps the legacy
 * symmetric parapet). `run.outwardSign` (precomputed per chunk) wins; else derive from the ring
 * `centroid`; else 0. Local +y maps to world (−dy, dx), so the field side is whichever of ±y
 * points away from the centre at this segment's midpoint. */
function outwardSignFor(run: BarrierRun, s: Seg): number {
  if (typeof run.outwardSign === 'number') return run.outwardSign;
  if (!run.centroid) return 0;
  const rad = s.angleDeg / RAD2DEG;
  const dx = Math.cos(rad), dy = Math.sin(rad);
  const mx = s.ax + dx * s.len / 2, my = s.ay + dy * s.len / 2;   // segment midpoint (world)
  const dot = (-dy) * (mx - run.centroid[0]) + dx * (my - run.centroid[1]);
  return dot >= 0 ? 1 : -1;
}

// ── Family builders: each returns the per-segment solids for its material groups ──────────

/** Masonry curtain: battered plinth + curtain to the wall-walk + crenellated parapet (or a
 *  coping cope when uncrenellated). One stone group; the work (ashlar/rubble/drystone) varies. */
function masonrySeg(M: ManifoldNS, run: BarrierRun, s: Seg): ManifoldT[] {
  const H = Math.max(mToTiles(1.0), run.height);
  const th = Math.max(mToTiles(0.6), run.thickness);
  const out: ManifoldT[] = [];

  // Battered plinth (talus): two offset courses flaring the foot out — the defining
  // silhouette of a fortified base. A 1 m course wider by ~0.7 m, then a half-step.
  // NO below-grade skirt: sprites paint over terrain, so buried geometry isn't hidden —
  // it hangs over the ground in front. Ground fit is the terraced footing's job
  // (barrier-deformation.ts benches the ground per piece, ramps tucked under piece ends).
  const plinthH = Math.min(mToTiles(1.2), H * 0.32);
  const flare = mToTiles(0.55);
  out.push(place(locBox(M, 0, s.len, th + 2 * flare, 0, plinthH * 0.55), s));            // wide foot course
  out.push(place(locBox(M, 0, s.len, th + flare, plinthH * 0.5, plinthH * 0.6), s));     // half-step in

  // Curtain rising to the wall-walk floor (allure). With a parapet, stop below the crest.
  const parapetH = run.crenellated ? Math.min(mToTiles(1.6), H * 0.4) : 0;
  const walkZ = H - parapetH;
  out.push(place(locBox(M, 0, s.len, th, plinthH * 0.4, walkZ - plinthH * 0.4), s));

  if (run.crenellated && run.hoarded) {
    // A hoarded wall carries its defence in the TIMBER gallery built over the top (added by
    // hoardingSeg), so the stone crown is just a flat wall-walk here — no stone merlons to
    // clutter under the timber. The curtain already rises to walkZ above.
  } else if (run.crenellated) {
    // Crenellated parapet + wall-walk. A defender stands on the walk (the curtain top at walkZ)
    // sheltered behind merlons that FACE THE FIELD. So the toothed parapet goes on the OUTER edge
    // only, with a low solid inner kerb (parados) closing the walk on the town side — never a
    // second fighting face. When orientation is unknown (open runs / legacy callers) fall back to
    // the old symmetric parapet (both edges thick, single coping thin).
    const parapetTh = Math.max(mToTiles(0.45), th * 0.32);
    const baseCourseH = parapetH * 0.42;
    const outward = outwardSignFor(run, s);
    const edgeCross = (th - parapetTh) / 2;       // parapet centre sits on a face, not the middle
    // SELF-TILING symmetric merlons (WP-W2): lay a WHOLE number of merlon periods across this
    // segment, teeth centred at (k+0.5)·period. The layout is symmetric under x→len−x (which
    // legalizes the render cutter's orientation normalization) and continuous across piece seams
    // (each canonical piece carries whole periods — a 2-tile cardinal piece keeps 2 teeth, a √2
    // diagonal piece 1). No global merlonPhase needed: seam continuity is now STRUCTURAL.
    const parapet = (ey: number): void => {
      out.push(place(locBox(M, 0, s.len, parapetTh, walkZ, baseCourseH, ey), s));      // base course
      const n = Math.max(1, Math.round(s.len / MERLON_PERIOD_TILES));
      const period = s.len / n;
      const merlonW = period * MERLON_WIDTH_FRAC;   // merlon a touch wider than the crenel
      for (let k = 0; k < n; k++) {
        out.push(place(locBox(M, (k + 0.5) * period - merlonW / 2, merlonW, parapetTh, walkZ, parapetH, ey), s));
      }
    };
    if (outward !== 0) {
      parapet(outward * edgeCross);                                                    // field-facing crenellations
      if (th >= mToTiles(1.4)) {                                                        // room for a real walk → inner kerb
        const kerbH = parapetH * 0.5, kerbTh = parapetTh * 0.8;
        out.push(place(locBox(M, 0, s.len, kerbTh, walkZ, kerbH, -outward * edgeCross), s));
      }
    } else {
      const edges = th >= mToTiles(2.2) ? [edgeCross, -edgeCross] : [0];
      for (const ey of edges) parapet(ey);
    }
  } else {
    // Uncrenellated field wall: a saddleback coping cope, oversailing both faces to throw water.
    const copeH = mToTiles(0.3);
    out.push(place(locBox(M, 0, s.len, th + mToTiles(0.25), H - copeH, copeH), s));
  }
  return out;
}

/**
 * Timber HOARDING (hourd / brattice) — the wartime covered gallery cantilevered out over the
 * OUTER face at parapet level: stubby support beams (putlogs) → an overhanging plank floor →
 * a shooting breastwork at the lip → a mono-pitch shingle roof. Defenders in it drop stones /
 * quicklime through the gap at their feet straight down the wall base a flush parapet can't reach.
 * All timber; needs a known outward side (returns nothing otherwise) and a crenellated curtain.
 * Splits the shooting BREASTWORK (upright boards → `plank_v`) from the along-member FRAME
 * (putlogs/braces/floor/roof → `plank`, horizontal grain) so each reads with the right grain.
 */
function hoardingSeg(M: ManifoldNS, run: BarrierRun, s: Seg): { frame: ManifoldT[]; breast: ManifoldT[] } {
  const outward = outwardSignFor(run, s);
  if (outward === 0) return { frame: [], breast: [] };
  const H = Math.max(mToTiles(1.0), run.height);
  const th = Math.max(mToTiles(0.6), run.thickness);
  const parapetH = run.crenellated ? Math.min(mToTiles(1.6), H * 0.4) : 0;
  const walkZ = H - parapetH;
  const out: ManifoldT[] = [];
  const breast: ManifoldT[] = [];

  const over = mToTiles(1.3);                       // how far the gallery juts past the wall face
  const frontY = outward * (th / 2 + over);         // outer lip of the gallery (local y)

  // Support beams (putlogs): stubby timbers from inside the wall out to the lip, just below the
  // walk — the cantilever brackets that carry the floor. Spaced along the run.
  const beamH = mToTiles(0.3), beamW = mToTiles(0.24);
  const beamInner = outward * (th * 0.15);
  const beamSpan = Math.abs(frontY) - Math.abs(beamInner);
  const beamCenterY = (beamInner + frontY) / 2;
  const bz = walkZ - beamH;
  for (let d = mToTiles(0.35); d <= s.len - mToTiles(0.2); d += mToTiles(0.9)) {
    out.push(place(locBox(M, d, beamW, beamSpan, bz, beamH, beamCenterY), s));
  }

  // Diagonal brace struts under the lip — the visible timber brackets that carry the overhang.
  // Bayed with the putlogs so the gallery reads as bracketed carpentry, not a solid slab.
  const strutT = mToTiles(0.18);
  for (let d = mToTiles(0.35); d <= s.len - mToTiles(0.2); d += mToTiles(1.8)) {
    const strut = M.cube([strutT, Math.abs(frontY) + mToTiles(0.2), mToTiles(0.9)])
      .translate([0, 0, -mToTiles(0.45)])
      .rotate([outward * 42, 0, 0])
      .translate([d, outward * (th / 2 + over * 0.4), bz - mToTiles(0.1)]);
    out.push(place(strut, s));
  }

  // Overhanging plank floor — slightly overlaps the wall top, extends out past the lip.
  const ft = mToTiles(0.22);
  const floorSpan = over + mToTiles(0.5);
  const floorCenterY = outward * (th / 2 + over / 2 - mToTiles(0.05));
  out.push(place(locBox(M, 0, s.len, floorSpan, walkZ, ft, floorCenterY), s));

  // Shooting breastwork at the outer lip — the timber wall defenders stand behind. Upright
  // boards (its own group so it paints `plank_v`, not the frame's horizontal grain).
  const bwTh = mToTiles(0.28), bwH = mToTiles(1.05);
  breast.push(place(locBox(M, 0, s.len, bwTh, walkZ + ft, bwH, frontY), s));
  // A back post row where the gallery meets the wall top (the inner support the roof springs from).
  out.push(place(locBox(M, 0, s.len, mToTiles(0.2), walkZ + ft, bwH + mToTiles(0.4), outward * (th / 2)), s));

  // Mono-pitch shingle roof, BROKEN INTO BAYS (a gap between sections) so it reads as sectioned
  // timber rather than one continuous plank. High ridge at the wall side, eave past the outer lip.
  const roofTh = mToTiles(0.16);
  const roofD = over + mToTiles(0.7);
  const bay = mToTiles(2.2), gap = mToTiles(0.35);
  for (let d = 0; d < s.len - 1e-6; d += bay) {
    const bl = Math.min(bay - gap, s.len - d);
    if (bl <= mToTiles(0.2)) continue;
    const roof = M.cube([bl, roofD, roofTh])
      .translate([0, -roofD / 2, -roofTh / 2])
      .rotate([-outward * 30, 0, 0])
      .translate([d, outward * (th / 2 + over / 2), walkZ + ft + bwH + mToTiles(0.5)]);
    out.push(place(roof, s));
  }
  return { frame: out, breast };
}

/** Timber palisade: close-set pointed stakes + two lashing rails, on a low earthen bank.
 *  The upright staves paint with the `stave` work (vertical round logs); the two horizontal
 *  lashing rails are along-member timbers, so they keep `plank` (horizontal grain). Returns the
 *  three groups so the bank paints as earth, the stockade as staves, the rails as plank. */
function palisadeSeg(M: ManifoldNS, run: BarrierRun, s: Seg): { staves: ManifoldT[]; rails: ManifoldT[]; earth: ManifoldT[] } {
  const H = Math.max(mToTiles(1.4), run.height);
  const th = Math.max(mToTiles(0.5), run.thickness);
  const staves: ManifoldT[] = [];
  const rails: ManifoldT[] = [];
  const earth: ManifoldT[] = [];

  // Low earthen bank the stakes are driven into (the rampart crest). Width caps well under
  // the run's nominal tile-wide thickness: a `th + 0.9 m` bank came out 2.9 m wide, and on a
  // depth-axis diagonal edge its flat pale top dominated the whole view as two featureless
  // ribbons flanking the stake line.
  const bankH = mToTiles(0.7), bankW = Math.min(th, mToTiles(0.7)) + mToTiles(0.6);
  earth.push(place(locBox(M, 0, s.len, bankW, 0, bankH), s));

  // Stakes: a close-set main row + a sparse offset BACK row, with ±8 % height jitter. The
  // single centred row collapsed to ONE stake column when the run heads along the iso depth
  // axis (a diagonal ring edge seen end-on) — the piece read as a bare pale bank slab with a
  // lone post. The back row keeps a second stake column visible from every bearing while the
  // dense main row preserves the close-set stockade front.
  const pitch = mToTiles(0.5);
  const pw = mToTiles(0.42);
  const capH = mToTiles(0.6);
  const shaftH = H - capH;
  const rowOff = mToTiles(0.1);
  const n = Math.max(1, Math.round(s.len / pitch));
  const step = s.len / n;
  const stake = (d: number, off: number, hj: number): void => {
    staves.push(place(locBox(M, d - pw / 2, pw, pw, bankH * 0.6, shaftH * hj, off), s));   // shaft
    // Pointed cap: a 4-sided cone (pyramid) from the shaft width to a point.
    const cap = M.cylinder(capH, pw * 0.62, 0.0, 4).rotate([0, 0, 45]).translate([d, off, bankH * 0.6 + shaftH * hj]);
    staves.push(place(cap, s));
  };
  for (let i = 0; i <= n; i++) {
    stake(Math.min(s.len, i * step), -rowOff, 1 + (hash01(i * 17 + 3) - 0.5) * 0.16);
  }
  for (let i = 0; i < n; i += 2) {
    stake(Math.min(s.len, (i + 0.5) * step), rowOff + mToTiles(0.06), 1 + (hash01(i * 29 + 11) - 0.5) * 0.16);
  }
  // Two horizontal lashing rails tying the stakes together.
  const railT = mToTiles(0.14);
  for (const rz of [shaftH * 0.35, shaftH * 0.78]) {
    rails.push(place(locBox(M, 0, s.len, pw * 0.6, bankH * 0.6 + rz, railT, th * 0.2), s));
  }
  return { staves, rails, earth };
}

/** Light fence (paling / barricade): square posts + one or two thin rails, open between. */
function lightSeg(M: ManifoldNS, run: BarrierRun, s: Seg): ManifoldT[] {
  const H = Math.max(mToTiles(0.8), run.height);
  const out: ManifoldT[] = [];
  const pw = mToTiles(0.16);
  const pitch = mToTiles(1.6);
  const n = Math.max(1, Math.round(s.len / pitch));
  const step = s.len / n;
  for (let i = 0; i <= n; i++) {
    const d = Math.min(s.len, i * step);
    out.push(place(locBox(M, d - pw / 2, pw, pw, 0, H * 1.05), s));                      // post (slightly proud)
  }
  // Rails: a top rail always, a mid rail for taller fences.
  const railT = mToTiles(0.12);
  const rails = H >= mToTiles(1.2) ? [H * 0.45, H * 0.85] : [H * 0.75];
  for (const rz of rails) out.push(place(locBox(M, 0, s.len, pw * 0.7, rz, railT), s));
  // Close pickets (paling) for a fence with posts flagged — riven stakes between the rails.
  if (run.posts) {
    const palW = mToTiles(0.1), palPitch = mToTiles(0.22);
    const m = Math.max(1, Math.round(s.len / palPitch));
    const ps = s.len / m;
    for (let i = 0; i < m; i++) {
      out.push(place(locBox(M, i * ps, palW, palW * 0.8, 0, H * 0.92), s));
    }
  }
  return out;
}

/** Living hedge: a row of overlapping organic blobs (squat ellipsoids), bushy + battered. */
function hedgeSeg(M: ManifoldNS, run: BarrierRun, s: Seg, segIdx: number): ManifoldT[] {
  const H = Math.max(mToTiles(1.0), run.height);
  const th = Math.max(mToTiles(0.8), run.thickness + mToTiles(0.4));
  const out: ManifoldT[] = [];
  const pitch = mToTiles(1.1);
  const n = Math.max(1, Math.round(s.len / pitch));
  const step = s.len / n;
  // A continuous lower body so the hedge reads dense, not as separate bushes.
  out.push(place(locBox(M, 0, s.len, th * 0.85, 0, H * 0.6), s));
  const vseed = (run.variant ?? 0) * 911;            // position-hashed variant (WP-W2) → organic variety
  for (let i = 0; i <= n; i++) {
    const d = Math.min(s.len, i * step);
    const j = hash01(segIdx * 131 + i + vseed);
    const r = 0.85 + j * 0.4;                        // organic size jitter
    const blob = M.sphere(1, 16)
      .scale([pitch * 0.7 * r, th * 0.55 * r, H * 0.5 * r])
      .translate([d, 0, H * (0.55 + (hash01(i + 7 + vseed) - 0.5) * 0.12)]);
    out.push(place(blob, s));
  }
  return out;
}

// ── Gate cut: an ARCHED passage void centred on the path point ────────────────────────────
// Not a full-height slot — a rectangular passage rising to a springing line, capped by a
// semicircular arch barrel running through the wall thickness. The crown is held BELOW the
// wall-walk so masonry (and the parapet/merlons placed along the segment) span over the gate:
// the curtain reads as a real arched gateway, not a wall sliced to the ground. For a humble
// barrier (fence/hedge/low bank) with no spanning mass to keep, it degrades to a clean slot.
/** The arched-passage profile `gateCut` punches through a masonry curtain: clear jamb height to
 *  the springing line, arc rise, and the circle through jamb-tops + crown. EXPORTED so the gate
 *  LEAF (gate-spec.ts) fills exactly this opening — an arch-topped door, per the gatehouse TTI
 *  reference — and cut and door can never disagree. Heights in tile/cube units (run.height space). */
export function gateArchProfile(height: number, width: number): {
  springZ: number; rise: number; archR: number; centreZ: number;
} {
  const H = Math.max(mToTiles(1.0), height);
  const halfW = width / 2;
  const maxCrown = H * 0.74;
  const springZ = Math.min(mToTiles(2.0), maxCrown - mToTiles(0.5));   // clear height to springing
  const rise = Math.max(mToTiles(0.5), Math.min(halfW, maxCrown - springZ));
  const archR = (halfW * halfW + rise * rise) / (2 * rise);            // circle through jamb-tops + crown
  return { springZ, rise, archR, centreZ: springZ + rise - archR };    // centre below spring ⇒ segmental
}

/** Does this run's gate cut as an ARCHED masonry passage (vs a plain full-height slot)? The gate
 *  leaf reads this to pick its silhouette (arch-topped vs flat-topped). */
export function gateIsArched(run: BarrierRun): boolean {
  return familyOf(run) === 'masonry' && Math.max(mToTiles(1.0), run.height) >= mToTiles(2.4);
}

function gateCut(M: ManifoldNS, run: BarrierRun, t: number, width: number): ManifoldT {
  const { p, angleDeg } = pointAt(run.path, t);
  const H = Math.max(mToTiles(1.0), run.height);
  const th = run.thickness + mToTiles(1.0);          // overshoot both faces for a clean punch
  const base = mToTiles(0.6);                          // start the void just below grade

  // Low/insubstantial barriers can't carry an arch — punch a plain full-height slot.
  if (!gateIsArched(run)) {
    return M.cube([width, th, H + base + mToTiles(1.2)])
      .translate([-width / 2, -th / 2, -base])
      .rotate([0, 0, angleDeg])
      .translate([p[0], p[1], 0]);
  }

  // Arched passage. The crown is kept under ~0.74·H so a masonry spandrel + the parapet/merlons
  // (placed along the segment) bridge over the gate. A narrow gate gets a full semicircular head;
  // a wide one a flatter SEGMENTAL arch (rise < half-span) — both meet the jambs exactly at the
  // springing line, so the opening reads as one clean arch of the right span.
  const { springZ, archR, centreZ } = gateArchProfile(run.height, width);
  const rect = M.cube([width, th, springZ + base]).translate([-width / 2, -th / 2, -base]);
  const arch = M.cylinder(th, archR, archR, 48)       // z-axis barrel of the arc radius
    .translate([0, 0, -th / 2])                        // centre on its own axis…
    .rotate([90, 0, 0])                                // …then lay it through the wall thickness (axis → y)
    .translate([0, 0, centreZ]);                       // arc centre on the wall centreline
  return rect.add(arch)
    .rotate([0, 0, angleDeg])
    .translate([p[0], p[1], 0]);
}

/** A proud VOUSSOIR RING around an arched gate (the gatehouse TTI reference draws a raised
 *  wedge-stone band + keystone around every arch; ours read flush) — an annulus of radial depth
 *  ~0.35, standing slightly proud of BOTH wall faces, clipped to start just below the springing
 *  (springer stones). Built in the gate frame, world-placed like the cut. */
function gateRing(M: ManifoldNS, run: BarrierRun, t: number, width: number): ManifoldT {
  const { p, angleDeg } = pointAt(run.path, t);
  const { springZ, archR, centreZ } = gateArchProfile(run.height, width);
  const proud = mToTiles(0.12), radial = mToTiles(0.35);
  const th = run.thickness + proud * 2;
  const annulus = M.cylinder(th, archR + radial, archR + radial, 48)
    .subtract(M.cylinder(th + mToTiles(0.2), archR, archR, 48).translate([0, 0, -mToTiles(0.1)]))
    .translate([0, 0, -th / 2])
    .rotate([90, 0, 0])
    .translate([0, 0, centreZ]);
  // Keep only the visible arc: from a hand's breadth below the springing up over the crown.
  const clipZ0 = springZ - mToTiles(0.4);
  const span = archR + radial + mToTiles(1.0);
  const clip = M.cube([span * 2, th, span]).translate([-span, -th / 2, clipZ0]);
  return annulus.intersect(clip)
    .rotate([0, 0, angleDeg])
    .translate([p[0], p[1], 0]);
}

export async function linearFacets(run: BarrierRun): Promise<LinearResult> {
  const { Manifold } = await getManifold();
  const M: ManifoldNS = Manifold;
  const segs = segments(run.path);
  const baseMat: Mat = MATERIAL_MAP[run.material] ?? 'stone';
  const family = familyOf(run);

  // Collect per-material solids, then union within each material so one boolean per group.
  const byMat = new Map<string, { mat: Mat; work?: string; solids: ManifoldT[] }>();
  const push = (mat: Mat, work: string | undefined, solids: ManifoldT[]): void => {
    if (!solids.length) return;
    const key = `${mat}|${work ?? ''}`;
    const g = byMat.get(key) ?? { mat, work, solids: [] };
    g.solids.push(...solids);
    byMat.set(key, g);
  };

  segs.forEach((s, i) => {
    switch (family) {
      case 'masonry': {
        push(baseMat, masonryWork(run), masonrySeg(M, run, s));
        if (run.hoarded) {                                                   // wartime timber galleries
          const h = hoardingSeg(M, run, s);
          push('timber', 'plank', h.frame);                                 // putlogs/floor/braces/roof — horizontal grain
          push('timber', 'plank_v', h.breast);                              // upright shooting breastwork
        }
        break;
      }
      case 'palisade': {
        const r = palisadeSeg(M, run, s);
        push('timber', 'stave', r.staves);                                  // upright round logs
        push('timber', 'plank', r.rails);                                   // horizontal lashing rails
        push('earth', undefined, r.earth);
        break;
      }
      case 'light':    push('timber', 'plank', lightSeg(M, run, s)); break;
      case 'living':   push('foliage', undefined, hedgeSeg(M, run, s, i)); break;
      case 'earthbank': {
        // Trapezoid-ish earthen bank: a wide base course + a narrower crest course.
        const H = Math.max(mToTiles(1.0), run.height), th = Math.max(mToTiles(1.0), run.thickness);
        push('earth', undefined, [
          place(locBox(M, 0, s.len, th + mToTiles(1.4), 0, H * 0.55), s),
          place(locBox(M, 0, s.len, th, H * 0.5, H * 0.5), s),
        ]);
        break;
      }
    }
  });

  // Union each material's solids, subtract every gate, → facets tagged with that material.
  const groups: MatGroup[] = [];
  for (const { mat, work, solids } of byMat.values()) {
    if (!solids.length) continue;
    groups.push({ mat, work, solid: Manifold.union(solids) });
  }
  const cuts = run.gates.map((g) => gateCut(M, run, g.t, g.width));

  const facets: WorldFacet[] = [];
  let volume = 0;
  const gateAnchors: Vec3[] = run.gates.map((g) => {
    const { p } = pointAt(run.path, g.t);
    return [p[0], p[1], run.height / 2] as Vec3;
  });
  for (const g of groups) {
    let solid = g.solid;
    for (const cut of cuts) solid = solid.subtract(cut);
    facets.push(...manifoldToFacets(solid.getMesh(), g.mat, g.work));
    volume += solid.volume();
  }
  // Proud voussoir ring + springers around each ARCHED gate (added after the cuts so the band
  // survives; the passage stays clear — the annulus starts at the arch's own radius). Dressed
  // ashlar regardless of the curtain's coursing, as a real gate surround is.
  if (gateIsArched(run) && run.gates.length) {
    for (const g of run.gates) {
      let ring = gateRing(M, run, g.t, g.width);
      for (const cut of cuts) ring = ring.subtract(cut);
      facets.push(...manifoldToFacets(ring.getMesh(), baseMat, 'ashlar'));
      volume += ring.volume();
    }
  }

  const first = run.path[0], last = run.path[run.path.length - 1];
  const wallEnds: Vec3[] = [[first[0], first[1], 0], [last[0], last[1], 0]];
  return { facets, anchors: { wallEnds, gates: gateAnchors }, volume };
}
