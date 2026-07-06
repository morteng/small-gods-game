// src/blueprint/parts/frame.ts
// Exposed timber frame (half-timbering): raised timber posts + rails + studs standing proud
// of the plaster infill wall, derived from the body's wings + storeys. A systemic FABRIC
// detail — ANY timber-framed body (params.frame) renders its structural frame instead of a
// flat wall, so the frame data the connectome already computes becomes visible geometry.
// The frame READS its openings: rails break around each door/window, studs jamb their edges,
// and a door gets its head beam — so no member ever runs blindly across a hole.
// Members are `box` prims (material 'timber') composed alongside the plaster wall solid.
import type { Part as Prim } from '@/assetgen/compose';
import type { Wing } from '@/assetgen/geometry/building';
import type { WallFace } from '@/assetgen/geometry/building';
import { STOREY } from '@/assetgen/geometry/building';

const TW = 0.15;        // timber member width (posts + rails) — bold enough to read as framing
const PROUD = 0.08;     // how far a member stands proud of the plaster face
const INTO = 0.02;      // how far it sinks back into the wall (clean fusion, no gap)
const BAY_TILES = 1.4;  // target panel width between studs (close-ish studding — ~2.8 m bays)
const OPEN_PAD = 0.04;  // clear this much to each side of an opening before a rail resumes
const OAK: [number, number, number] = [72, 50, 32];   // dark-oak tint for the frame timber

/** An opening (door/window) the frame must respect, in absolute wing/part coords. `face`
 *  matches the wall it sits on; `[a0,a1]` is its run interval, `[z0,z1]` its vertical span. */
export interface FrameOpening { face: WallFace; a0: number; a1: number; z0: number; z1: number }

// A flat wall face of a wing: the run interval [aMin,aMax] along one axis, at a fixed
// (constant) coordinate on the other, with the outward normal sign and its WallFace name
// (so openings can be matched to the face they cut).
interface Face { name: WallFace; fixed: 'x' | 'y'; at: number; out: 1 | -1; aMin: number; aMax: number }

/** Depth interval on the fixed axis: a member sinks INTO the wall and stands PROUD of it. */
function depth(f: Face): [number, number] {
  return f.out > 0 ? [f.at - INTO, f.at + PROUD] : [f.at - PROUD, f.at + INTO];
}

const member = (f: Face, a0: number, a1: number, z0: number, z1: number, horizontal: boolean): Prim => {
  const [d0, d1] = depth(f);
  // horizontal = a rail (runs along the face); else a post (runs up in z). The face's fixed
  // axis is the wall's constant coordinate; the free axis is the run.
  const box: Prim = f.fixed === 'y'
    ? { prim: 'box', at: [a0, d0, z0], size: [a1 - a0, d1 - d0, z1 - z0], material: 'timber', finish: 'polychrome', tint: OAK }
    : { prim: 'box', at: [d0, a0, z0], size: [d1 - d0, a1 - a0, z1 - z0], material: 'timber', finish: 'polychrome', tint: OAK };
  void horizontal;
  return box;
};

/** A vertical post/stud centred at along-position `a`, running z0→z1. */
function post(f: Face, a: number, z0: number, z1: number): Prim {
  return member(f, a - TW / 2, a + TW / 2, z0, z1, false);
}

/** Openings on this face whose vertical span brackets height `z` (the rail would cross them). */
function crossingGaps(f: Face, z: number, openings: FrameOpening[]): Array<[number, number]> {
  const m = TW / 2;
  return openings
    .filter(o => o.face === f.name && z + m > o.z0 && z - m < o.z1)
    .map(o => [Math.max(f.aMin, o.a0 - OPEN_PAD), Math.min(f.aMax, o.a1 + OPEN_PAD)] as [number, number])
    .filter(g => g[1] > g[0])
    .sort((a, b) => a[0] - b[0]);
}

/** A horizontal rail centred at height `z`, broken into segments around any opening it crosses. */
function rail(f: Face, z: number, openings: FrameOpening[]): Prim[] {
  const out: Prim[] = [];
  let cursor = f.aMin;
  for (const [g0, g1] of crossingGaps(f, z, openings)) {
    if (g0 > cursor) out.push(member(f, cursor, g0, z - TW / 2, z + TW / 2, true));
    cursor = Math.max(cursor, g1);
  }
  if (cursor < f.aMax) out.push(member(f, cursor, f.aMax, z - TW / 2, z + TW / 2, true));
  return out;
}

/**
 * Timber frame members for every flat wall face of `wings`, respecting `openings`. Corner
 * posts + evenly-spaced studs divide each face into panels (a stud that would spear an
 * opening is dropped in favour of jamb posts at the opening's edges); a sill beam (above the
 * plinth), one mid-rail per storey boundary and a wall-plate under the eave band it
 * horizontally, each broken around any opening it crosses; a door also gets a head beam.
 * `baseCourse` is the stone-plinth height the frame starts above (0 = frame from the ground).
 */
export function framePrims(wings: Wing[], baseCourse = 0, openings: FrameOpening[] = []): Prim[] {
  const out: Prim[] = [];
  for (const w of wings) {
    const n = w.storeys ?? 1;
    const sh = w.storeyHeight ?? STOREY;
    const z0 = baseCourse;      // frame timber starts atop the stone plinth
    const z1 = n * sh;          // wall plate / eave line
    if (z1 - z0 < 0.3) continue;
    const faces: Face[] = [
      { name: 'south', fixed: 'y', at: w.y + w.h, out: 1,  aMin: w.x, aMax: w.x + w.w },
      { name: 'north', fixed: 'y', at: w.y,       out: -1, aMin: w.x, aMax: w.x + w.w },
      { name: 'east',  fixed: 'x', at: w.x + w.w, out: 1,  aMin: w.y, aMax: w.y + w.h },
      { name: 'west',  fixed: 'x', at: w.x,       out: -1, aMin: w.y, aMax: w.y + w.h },
    ];
    for (const f of faces) {
      const faceOpenings = openings.filter(o => o.face === f.name);
      const insideOpening = (a: number) =>
        faceOpenings.some(o => a > o.a0 - OPEN_PAD && a < o.a1 + OPEN_PAD);
      const run = f.aMax - f.aMin;
      const bays = Math.max(1, Math.ceil(run / BAY_TILES));
      // Corner posts always; interior bay studs unless one would spear an opening (jamb posts
      // cover the opening edges instead).
      for (let i = 0; i <= bays; i++) {
        const a = f.aMin + run * (i / bays);
        const corner = i === 0 || i === bays;
        if (corner || !insideOpening(a)) out.push(post(f, a, z0, z1));
      }
      // Jamb posts flanking each opening + a head beam over a door (a window keeps its stone lintel).
      for (const o of faceOpenings) {
        out.push(post(f, Math.max(f.aMin, o.a0), Math.max(z0, o.z0), Math.min(z1, o.z1)));
        out.push(post(f, Math.min(f.aMax, o.a1), Math.max(z0, o.z0), Math.min(z1, o.z1)));
        if (o.z0 < 0.05 && o.z1 < z1) out.push(member(f, o.a0, o.a1, o.z1 - TW / 2, o.z1 + TW / 2, true));   // door head beam
      }
      out.push(...rail(f, z0 + TW / 2, faceOpenings));           // sill beam (sits on the plinth)
      for (let k = 1; k < n; k++) out.push(...rail(f, k * sh, faceOpenings));   // mid-rail per storey
      out.push(...rail(f, z1 - TW / 2, faceOpenings));           // wall plate under the eave
    }
  }
  return out;
}
