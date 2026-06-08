// src/assetgen/geometry/linear.ts
// Linear structures (walls / fences / ramparts / palisades) for the manifold-3d CSG
// pipeline. A polyline path → a chain of oriented box segments, with gates
// boolean-subtracted as clean openings, optional crenellation (merlons on top) and
// posts (square uprights at corners + ends). Emits the same flat-normal WorldFacets +
// world-space anchors as the building massing path.
import type { Vec3, Mat, WorldFacet } from '@/assetgen/types';
import type { Manifold } from 'manifold-3d';
import { getManifold } from '@/assetgen/geometry/manifold-runtime';
import { manifoldToFacets } from '@/assetgen/geometry/solids';
import type { BarrierRun } from '@/world/barrier';

export interface LinearResult {
  facets: WorldFacet[];
  anchors: { wallEnds: Vec3[]; gates: Vec3[] };   // WORLD-space points (tile x,y; z up)
  volume: number;
}

const RAD2DEG = 180 / Math.PI;

/** Per-segment geometry derived from a consecutive path pair. */
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

/** Map a path distance `t` (tiles) to a world point + the segment it falls on. */
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

const MATERIAL_MAP: Record<string, Mat> = { stone: 'stone', timber: 'timber', earth: 'earth', brick: 'brick' };

export async function linearFacets(run: BarrierRun): Promise<LinearResult> {
  const { Manifold } = await getManifold();
  const { path, height: h, thickness: th } = run;
  const mat: Mat = MATERIAL_MAP[run.material] ?? 'stone';
  const segs = segments(path);

  // ── Wall segment boxes (origin box, min-corner [0,-th/2,0], rotate, translate) ──
  const segBox = (s: Seg): Manifold =>
    Manifold.cube([s.len, th, h]).translate([0, -th / 2, 0]).rotate([0, 0, s.angleDeg]).translate([s.ax, s.ay, 0]);
  let solid = Manifold.union(segs.map(segBox));

  // ── Crenellation: a row of merlon boxes along the top edge of each segment ──
  if (run.crenellated) {
    const merlons: Manifold[] = [];
    const mw = 0.5, mh = 0.5, step = 1.0;
    for (const s of segs) {
      for (let d = 0.25; d + mw <= s.len; d += step) {
        merlons.push(
          Manifold.cube([mw, th, mh]).translate([d, -th / 2, h]).rotate([0, 0, s.angleDeg]).translate([s.ax, s.ay, 0]),
        );
      }
    }
    if (merlons.length) solid = Manifold.union([solid, ...merlons]);
  }

  // ── Posts: square uprights at interior corners + the two ends ──
  if (run.posts) {
    const pt = th * 1.1, ph = h + 0.3, half = pt / 2;
    const posts = path.map(([px, py]) =>
      Manifold.cube([pt, pt, ph]).translate([px - half, py - half, 0]),
    );
    if (posts.length) solid = Manifold.union([solid, ...posts]);
  }

  // ── Gates: subtract an oversized oriented box centred on the path point ──
  const gateAnchors: Vec3[] = [];
  for (const g of run.gates) {
    const { p, angleDeg } = pointAt(path, g.t);
    const cut = Manifold.cube([g.width, th + 0.2, h + 0.4])
      .translate([-g.width / 2, -(th + 0.2) / 2, -0.2])
      .rotate([0, 0, angleDeg])
      .translate([p[0], p[1], 0]);
    solid = solid.subtract(cut);
    gateAnchors.push([p[0], p[1], h / 2]);
  }

  const facets = manifoldToFacets(solid.getMesh(), mat);
  const first = path[0], last = path[path.length - 1];
  const wallEnds: Vec3[] = [[first[0], first[1], 0], [last[0], last[1], 0]];

  return { facets, anchors: { wallEnds, gates: gateAnchors }, volume: solid.volume() };
}
