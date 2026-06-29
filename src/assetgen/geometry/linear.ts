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
import type { BarrierRun } from '@/world/barrier';

export interface LinearResult {
  facets: WorldFacet[];
  anchors: { wallEnds: Vec3[]; gates: Vec3[] };   // WORLD-space points (tile x,y; z up)
  volume: number;
}

type ManifoldT = Manifold;
type ManifoldNS = Awaited<ReturnType<typeof getManifold>>['Manifold'];

const RAD2DEG = 180 / Math.PI;

/** Per-segment geometry derived from a consecutive path pair (local +x = along the run). */
interface Seg { ax: number; ay: number; len: number; angleDeg: number }

function segments(path: [number, number][]): Seg[] {
  const segs: Seg[] = [];
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len <= 0) continue;
    segs.push({ ax, ay, len, angleDeg: Math.atan2(by - ay, bx - ax) * RAD2DEG });
  }
  return segs;
}

/** Map a path distance `t` (tiles) to a world point + the segment angle it falls on. */
function pointAt(path: [number, number][], t: number): { p: [number, number]; angleDeg: number } {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const len = Math.hypot(bx - ax, by - ay);
    const angleDeg = Math.atan2(by - ay, bx - ax) * RAD2DEG;
    if (t <= acc + len) {
      const u = (t - acc) / (len || 1);
      return { p: [ax + (bx - ax) * u, ay + (by - ay) * u], angleDeg };
    }
    acc += len;
  }
  const [ax, ay] = path[path.length - 2] ?? path[0];
  const [bx, by] = path[path.length - 1];
  return { p: [bx, by], angleDeg: Math.atan2(by - ay, bx - ax) * RAD2DEG };
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
 *  drystone field wall (thin, uncrenellated) reads as `dry_stone`; a town wall as ashlar. */
function masonryWork(run: BarrierRun): string {
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

// ── Family builders: each returns the per-segment solids for its material groups ──────────

/** Masonry curtain: battered plinth + curtain to the wall-walk + crenellated parapet (or a
 *  coping cope when uncrenellated). One stone group; the work (ashlar/rubble/drystone) varies. */
function masonrySeg(M: ManifoldNS, run: BarrierRun, s: Seg): ManifoldT[] {
  const H = Math.max(mToTiles(1.0), run.height);
  const th = Math.max(mToTiles(0.6), run.thickness);
  const out: ManifoldT[] = [];

  // Battered plinth (talus): two offset courses flaring the foot out — the defining
  // silhouette of a fortified base. A 1 m course wider by ~0.7 m, then a half-step.
  const plinthH = Math.min(mToTiles(1.2), H * 0.32);
  const flare = mToTiles(0.55);
  out.push(place(locBox(M, 0, s.len, th + 2 * flare, 0, plinthH * 0.55), s));            // wide foot course
  out.push(place(locBox(M, 0, s.len, th + flare, plinthH * 0.5, plinthH * 0.6), s));     // half-step in

  // Curtain rising to the wall-walk floor (allure). With a parapet, stop below the crest.
  const parapetH = run.crenellated ? Math.min(mToTiles(1.6), H * 0.4) : 0;
  const walkZ = H - parapetH;
  out.push(place(locBox(M, 0, s.len, th, plinthH * 0.4, walkZ - plinthH * 0.4), s));

  if (run.crenellated) {
    // Crenellated parapet on the field edge(s): a continuous knee-high base course (so no
    // gap leaks light low down) + merlon teeth with crenel embrasures over it. Thick walls
    // get a true wall-walk with a parapet on BOTH long edges; thin walls a single toothed coping.
    const parapetTh = Math.max(mToTiles(0.45), th * 0.32);
    const edges = th >= mToTiles(2.2) ? [(th - parapetTh) / 2, -(th - parapetTh) / 2] : [0];
    const baseCourseH = parapetH * 0.42;
    const period = mToTiles(1.5);                 // merlon + crenel pitch (~3 m)
    const merlonW = period * 0.56;                // merlon a touch wider than the crenel
    for (const ey of edges) {
      out.push(place(locBox(M, 0, s.len, parapetTh, walkZ, baseCourseH, ey), s));      // base course
      for (let d = mToTiles(0.25); d + merlonW <= s.len + 1e-6; d += period) {
        out.push(place(locBox(M, d, merlonW, parapetTh, walkZ, parapetH, ey), s));     // merlon tooth
      }
    }
  } else {
    // Uncrenellated field wall: a saddleback coping cope, oversailing both faces to throw water.
    const copeH = mToTiles(0.3);
    out.push(place(locBox(M, 0, s.len, th + mToTiles(0.25), H - copeH, copeH), s));
  }
  return out;
}

/** Timber palisade: close-set pointed stakes + two lashing rails, on a low earthen bank.
 *  Returns [timberSolids, earthSolids] so the bank paints as earth, the stockade as timber. */
function palisadeSeg(M: ManifoldNS, run: BarrierRun, s: Seg): { timber: ManifoldT[]; earth: ManifoldT[] } {
  const H = Math.max(mToTiles(1.4), run.height);
  const th = Math.max(mToTiles(0.5), run.thickness);
  const timber: ManifoldT[] = [];
  const earth: ManifoldT[] = [];

  // Low earthen bank the stakes are driven into (the rampart crest).
  const bankH = mToTiles(0.7), bankW = th + mToTiles(0.9);
  earth.push(place(locBox(M, 0, s.len, bankW, 0, bankH), s));

  // Stakes: square posts standing on the bank, each tapering to a sharpened point.
  const pitch = mToTiles(0.5);
  const pw = mToTiles(0.42);
  const capH = mToTiles(0.6);
  const shaftH = H - capH;
  const n = Math.max(1, Math.round(s.len / pitch));
  const step = s.len / n;
  for (let i = 0; i <= n; i++) {
    const d = Math.min(s.len, i * step);
    timber.push(place(locBox(M, d - pw / 2, pw, pw, bankH * 0.6, shaftH), s));          // shaft
    // Pointed cap: a 4-sided cone (pyramid) from the shaft width to a point.
    const cap = M.cylinder(capH, pw * 0.62, 0.0, 4).rotate([0, 0, 45]).translate([d, 0, bankH * 0.6 + shaftH]);
    timber.push(place(cap, s));
  }
  // Two horizontal lashing rails tying the stakes together.
  const railT = mToTiles(0.14);
  for (const rz of [shaftH * 0.35, shaftH * 0.78]) {
    timber.push(place(locBox(M, 0, s.len, pw * 0.6, bankH * 0.6 + rz, railT, th * 0.2), s));
  }
  return { timber, earth };
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
  for (let i = 0; i <= n; i++) {
    const d = Math.min(s.len, i * step);
    const j = hash01(segIdx * 131 + i);
    const r = 0.85 + j * 0.4;                        // organic size jitter
    const blob = M.sphere(1, 16)
      .scale([pitch * 0.7 * r, th * 0.55 * r, H * 0.5 * r])
      .translate([d, 0, H * (0.55 + (hash01(i + 7) - 0.5) * 0.12)]);
    out.push(place(blob, s));
  }
  return out;
}

// ── Gate cut: an oversized oriented void centred on the path point ────────────────────────
function gateCut(M: ManifoldNS, run: BarrierRun, t: number, width: number): ManifoldT {
  const { p, angleDeg } = pointAt(run.path, t);
  const th = run.thickness + mToTiles(1.0);
  const h = Math.max(mToTiles(1.0), run.height) + mToTiles(1.2);
  return M.cube([width, th, h])
    .translate([-width / 2, -th / 2, -mToTiles(0.6)])
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
      case 'masonry':  push(baseMat, masonryWork(run), masonrySeg(M, run, s)); break;
      case 'palisade': { const r = palisadeSeg(M, run, s); push('timber', 'plank', r.timber); push('earth', undefined, r.earth); break; }
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

  const first = run.path[0], last = run.path[run.path.length - 1];
  const wallEnds: Vec3[] = [[first[0], first[1], 0], [last[0], last[1], 0]];
  return { facets, anchors: { wallEnds, gates: gateAnchors }, volume };
}
