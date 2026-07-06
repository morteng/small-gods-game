// src/blueprint/parts/frame.ts
// Exposed timber frame (half-timbering): raised timber posts + rails + studs + corner braces
// standing proud of the plaster infill wall, derived from the body's wings + storeys. A
// systemic FABRIC detail — ANY timber-framed body (params.frame) renders its structural frame
// instead of a flat wall, so the frame data the connectome already computes becomes visible
// geometry. The frame is built STOREY-BY-STOREY so a jettied upper floor's members step out
// with the oversail (they sit proud of the jettied wall, not buried behind it), and it READS
// its openings: rails break around each door/window, studs jamb their edges, a door gets its
// head beam, and diagonal corner braces skip any panel an opening occupies.
// Members are `box` prims (material 'timber'); braces use the box `rot` (tilt in the wall plane).
import type { Part as Prim } from '@/assetgen/compose';
import type { Vec3 } from '@/assetgen/types';
import type { Wing, WallFace } from '@/assetgen/geometry/building';
import { STOREY } from '@/assetgen/geometry/building';

const TW = 0.15;        // timber member width (posts + rails) — bold enough to read as framing
const PROUD = 0.08;     // how far a member stands proud of the plaster face
const INTO = 0.02;      // how far it sinks back into the wall (clean fusion, no gap)
const BAY_TILES = 1.4;  // target panel width between studs (close-ish studding — ~2.8 m bays)
const OPEN_PAD = 0.04;  // clear this much to each side of an opening before a rail resumes
const BRACE_MAX = 0.6;  // corner-brace leg length (tiles) — a knee brace, not a full strut
const OAK: [number, number, number] = [72, 50, 32];   // dark-oak tint for the frame timber

/** An opening (door/window) the frame must respect, in absolute wing/part coords. `face`
 *  matches the wall it sits on; `[a0,a1]` is its run interval, `[z0,z1]` its vertical span. */
export interface FrameOpening { face: WallFace; a0: number; a1: number; z0: number; z1: number }

// A flat wall face of a wing at ONE storey: the run interval [aMin,aMax] along one axis, at a
// fixed (constant) coordinate on the other, with the outward normal sign and its WallFace name.
interface Face { name: WallFace; fixed: 'x' | 'y'; at: number; out: 1 | -1; aMin: number; aMax: number }

/** Depth interval on the fixed axis: a member sinks INTO the wall and stands PROUD of it. */
function depth(f: Face): [number, number] {
  return f.out > 0 ? [f.at - INTO, f.at + PROUD] : [f.at - PROUD, f.at + INTO];
}

/** An axis-aligned member: horizontal (rail, runs along the face) or vertical (post, runs in z). */
function member(f: Face, a0: number, a1: number, z0: number, z1: number): Prim {
  const [d0, d1] = depth(f);
  return f.fixed === 'y'
    ? { prim: 'box', at: [a0, d0, z0], size: [a1 - a0, d1 - d0, z1 - z0], material: 'timber', finish: 'polychrome', tint: OAK }
    : { prim: 'box', at: [d0, a0, z0], size: [d1 - d0, a1 - a0, z1 - z0], material: 'timber', finish: 'polychrome', tint: OAK };
}

/** A vertical post/stud centred at along-position `a`, running z0→z1. */
function post(f: Face, a: number, z0: number, z1: number): Prim {
  return member(f, a - TW / 2, a + TW / 2, z0, z1);
}

/** Openings on this face whose vertical span brackets height `z` (the rail would cross them). */
function crossingGaps(f: Face, z: number, openings: FrameOpening[]): Array<[number, number]> {
  const m = TW / 2;
  return openings
    .filter(o => z + m > o.z0 && z - m < o.z1)
    .map(o => [Math.max(f.aMin, o.a0 - OPEN_PAD), Math.min(f.aMax, o.a1 + OPEN_PAD)] as [number, number])
    .filter(g => g[1] > g[0])
    .sort((a, b) => a[0] - b[0]);
}

/** A horizontal rail centred at height `z`, broken into segments around any opening it crosses. */
function rail(f: Face, z: number, openings: FrameOpening[]): Prim[] {
  const out: Prim[] = [];
  let cursor = f.aMin;
  for (const [g0, g1] of crossingGaps(f, z, openings)) {
    if (g0 > cursor) out.push(member(f, cursor, g0, z - TW / 2, z + TW / 2));
    cursor = Math.max(cursor, g1);
  }
  if (cursor < f.aMax) out.push(member(f, cursor, f.aMax, z - TW / 2, z + TW / 2));
  return out;
}

/** A diagonal knee brace springing from a bottom corner up-and-inward — a thin box tilted in
 *  the wall plane via the box `rot`. Returns null if it would be too small or spear an opening. */
function brace(f: Face, corner: 'lo' | 'hi', zBot: number, zTop: number, openings: FrameOpening[]): Prim | null {
  const run = f.aMax - f.aMin;
  const b = Math.min(BRACE_MAX, run * 0.4, (zTop - zBot) * 0.6);
  if (b < 0.22) return null;
  const aCorner = corner === 'lo' ? f.aMin : f.aMax;
  const aInner = corner === 'lo' ? f.aMin + b : f.aMax - b;
  const aLo = Math.min(aCorner, aInner), aHi = Math.max(aCorner, aInner);
  if (openings.some(o => aHi > o.a0 - OPEN_PAD && aLo < o.a1 + OPEN_PAD && zBot < o.z1)) return null;
  const [d0, d1] = depth(f);
  const aMid = (aCorner + aInner) / 2, zMid = zBot + b / 2;
  const L = b * Math.SQRT2;                           // the diagonal spans the b×b corner square
  const horiz = f.fixed === 'y';                      // south/north face → tilt about Y; else about X
  const sign = corner === 'lo' ? 1 : -1;
  const rot: Vec3 = horiz ? [0, sign * 45, 0] : [-sign * 45, 0, 0];
  const at: Vec3 = horiz ? [aMid - TW / 2, d0, zMid - L / 2] : [d0, aMid - TW / 2, zMid - L / 2];
  const size: Vec3 = horiz ? [TW, d1 - d0, L] : [d1 - d0, TW, L];
  return { prim: 'box', at, size, rot, material: 'timber', finish: 'polychrome', tint: OAK };
}

/**
 * Timber frame members for every flat wall face of `wings`, built storey-by-storey and
 * respecting `openings`. Each storey's rect oversails by `jetty·s` toward the camera (+x/+y)
 * so an upper floor's frame steps out with the jettied wall instead of hiding behind it.
 * Per storey + face: corner posts + evenly-spaced studs (a stud that would spear an opening is
 * dropped for jamb posts at the opening's edges); a bressummer/sill beam at the storey foot and
 * a wall-plate under the eave, each broken around any opening they cross; a door gets a head
 * beam; and diagonal corner braces where a panel is clear. `baseCourse` is the stone-plinth
 * height the ground storey starts above (0 = frame from the ground).
 */
export function framePrims(wings: Wing[], baseCourse = 0, openings: FrameOpening[] = [], jetty = 0): Prim[] {
  const out: Prim[] = [];
  for (const w of wings) {
    const n = w.storeys ?? 1;
    const sh = w.storeyHeight ?? STOREY;
    if (n * sh - baseCourse < 0.3) continue;
    for (let s = 0; s < n; s++) {
      const jz = jetty * s;                      // this storey's oversail toward +x/+y
      const zBot = s === 0 ? baseCourse : s * sh;
      const zTop = (s + 1) * sh;
      if (zTop - zBot < 0.3) continue;
      // The storey rect grows toward +x/+y by the jetty; south/east faces move OUT, run grows.
      const rx = w.x, ry = w.y, rw = w.w + jz, rh = w.h + jz;
      const faces: Face[] = [
        { name: 'south', fixed: 'y', at: ry + rh, out: 1,  aMin: rx, aMax: rx + rw },
        { name: 'north', fixed: 'y', at: ry,      out: -1, aMin: rx, aMax: rx + rw },
        { name: 'east',  fixed: 'x', at: rx + rw, out: 1,  aMin: ry, aMax: ry + rh },
        { name: 'west',  fixed: 'x', at: rx,      out: -1, aMin: ry, aMax: ry + rh },
      ];
      const top = s === n - 1;
      for (const f of faces) {
        const faceOpenings = openings.filter(o => o.face === f.name);
        const insideOpening = (a: number) => faceOpenings.some(o => a > o.a0 - OPEN_PAD && a < o.a1 + OPEN_PAD);
        const run = f.aMax - f.aMin;
        const bays = Math.max(1, Math.ceil(run / BAY_TILES));
        for (let i = 0; i <= bays; i++) {
          const a = f.aMin + run * (i / bays);
          if (i === 0 || i === bays || !insideOpening(a)) out.push(post(f, a, zBot, zTop));
        }
        // Jamb posts flanking each opening in this storey + a door head beam (windows keep a stone lintel).
        for (const o of faceOpenings) {
          if (o.z1 <= zBot || o.z0 >= zTop) continue;
          const oz0 = Math.max(zBot, o.z0), oz1 = Math.min(zTop, o.z1);
          out.push(post(f, Math.max(f.aMin, o.a0), oz0, oz1));
          out.push(post(f, Math.min(f.aMax, o.a1), oz0, oz1));
          if (o.z0 < 0.05 && o.z1 < zTop) out.push(member(f, o.a0, o.a1, o.z1 - TW / 2, o.z1 + TW / 2));   // door head beam
        }
        out.push(...rail(f, zBot + TW / 2, faceOpenings));      // bressummer / sill beam at the storey foot
        if (top) out.push(...rail(f, zTop - TW / 2, faceOpenings));   // wall plate under the eave
        // Diagonal corner braces where the corner panel is clear of openings.
        for (const corner of ['lo', 'hi'] as const) {
          const br = brace(f, corner, zBot, zTop, faceOpenings);
          if (br) out.push(br);
        }
      }
    }
  }
  return out;
}
