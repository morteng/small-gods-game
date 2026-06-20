// src/world/terrain-deformation.ts
//
// The SHARED terrain-deformation WRITE channel — the `⊕ deformations` half of the
// world-owned contract `heightAt = baseSeedHeight ⊕ deformations` (heightfield.ts is
// the base half). ONE channel that every producer feeds: defensive earthworks
// (motte/ditch/rampart), roads/rivers (road-cut / river incision), and settlement pads.
// See the cross-epic spec `spec-shared-terrain-deformation-channel` in shared memory.
//
// Design in one breath:
//   * A Deformation is an analytic, BOUNDED, blended brush — not a baked array.
//   * Four blend ops compose in priority order: raise (max), carve (min), add (+),
//     level (toward a target plateau). Each is masked by a 0..1 falloff so it is
//     identity outside its footprint.
//   * TWO reads, deliberately: baseHeightAt (seed terrain — siting/affordance decisions
//     read THIS, so a castle's own motte never feeds back into where it was sited) and
//     heightAt (base ⊕ deformations — rendering/collision read THIS).
//
// World-owned (neither renderer nor connectome); both import read-only. Returns metres.
import type { GameMap } from '@/core/types';
import { heightMetresAt } from '@/world/heightfield';

/** Seed terrain height in metres at a tile — the affordance/siting read (no deformations). */
export const baseHeightAt = heightMetresAt;

/** Axis-aligned bounds of a deformation's influence, in tiles (inclusive). */
export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * How a deformation combines with the height accumulated so far:
 *   raise — never lower the ground (mounds/mottes): max(acc, base + amount)
 *   carve — always cut down (ditches/river channels): min(acc, base − amount)
 *   add   — genuinely additive (banks/ramparts/spoil): acc + amount
 *   level — move toward an absolute plateau (roads, motte top, pads): toward `target`
 * Each is masked by the brush falloff so it is identity at/outside the footprint edge.
 */
export type BlendOp = 'raise' | 'carve' | 'add' | 'level';

export interface Deformation {
  id: string;
  source: string; // 'earthwork:motte' | 'road:cut' | 'river:incision' | 'settlement:pad' | …
  op: BlendOp;
  bounds: AABB; // footprint of influence (for culling); mask() must be 0 outside it
  priority: number; // composition order, low→high; ties broken by id for determinism
  /** Peak displacement in metres (raise/carve/add). Ignored by `level`. */
  amount: number;
  /** Absolute plateau height in metres (level only). */
  target?: number;
  /** Footprint falloff 0..1 at a tile — 1 at the core, 0 at/beyond the edge. */
  mask(tx: number, ty: number): number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Combine one deformation's masked contribution into the accumulator. Pure. */
export function applyOp(d: Deformation, acc: number, base: number, m: number): number {
  if (m <= 0) return acc;
  switch (d.op) {
    case 'raise':
      return lerp(acc, Math.max(acc, base + d.amount), m);
    case 'carve':
      return lerp(acc, Math.min(acc, base - d.amount), m);
    case 'add':
      return acc + d.amount * m;
    case 'level':
      return lerp(acc, d.target ?? acc, m);
    default:
      return acc;
  }
}

function inBounds(b: AABB, tx: number, ty: number): boolean {
  return tx >= b.minX && tx <= b.maxX && ty >= b.minY && ty <= b.maxY;
}

/**
 * The set of deformations layered over a world's base terrain. Producers register
 * their `Deformation[]` (keyed by `source` so they can be replaced/removed wholesale);
 * consumers read `heightAt`. `version` bumps on every mutation so callers can memoise.
 */
export class DeformationStore {
  private defs: Deformation[] = [];
  private dirty = true;
  private _version = 0;

  get version(): number {
    return this._version;
  }

  /** Add deformations. Determinism: composition re-sorts by (priority, id) on read. */
  add(...ds: Deformation[]): void {
    if (!ds.length) return;
    this.defs.push(...ds);
    this.dirty = true;
    this._version++;
  }

  /** Remove every deformation from a given source (a producer replacing its output). */
  removeSource(source: string): void {
    const before = this.defs.length;
    this.defs = this.defs.filter((d) => d.source !== source);
    if (this.defs.length !== before) {
      this.dirty = true;
      this._version++;
    }
  }

  clear(): void {
    if (!this.defs.length) return;
    this.defs = [];
    this.dirty = true;
    this._version++;
  }

  get size(): number {
    return this.defs.length;
  }

  private ensureSorted(): void {
    if (!this.dirty) return;
    // Stable, deterministic composition order.
    this.defs.sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.dirty = false;
  }

  /** Deformations whose footprint covers (tx,ty), in composition order. */
  at(tx: number, ty: number): Deformation[] {
    this.ensureSorted();
    // Linear scan + AABB cull. Deformation counts are small (tens, not thousands);
    // a spatial index is a noted perf follow-up, not needed for correctness.
    return this.defs.filter((d) => inBounds(d.bounds, tx, ty));
  }
}

/**
 * Composed terrain height in metres: `base ⊕ deformations`. Rendering, collision, and
 * "what does the ground look like now" read THIS. With an empty store it is exactly
 * `baseHeightAt` (parity by construction).
 */
export function heightAt(map: GameMap, store: DeformationStore, tx: number, ty: number): number {
  const base = baseHeightAt(map, tx, ty);
  let acc = base;
  for (const d of store.at(tx, ty)) {
    acc = applyOp(d, acc, base, d.mask(tx, ty));
  }
  return acc;
}

// ── Brush constructors — pure geometry → Deformation. Producers (earthworks, roads,
//    settlement) call these; the channel stays content-neutral. ───────────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface BrushBase {
  id: string;
  source: string;
  priority?: number;
}

/**
 * A flat-topped cone (motte): full inside `topRadius`, sloping out over the batter to
 * 0 at `topRadius + slope*height`. Pairs with op 'raise'.
 */
export function frustumDeformation(
  o: BrushBase & { cx: number; cy: number; topRadius: number; height: number; slope: number },
): Deformation {
  const baseR = o.topRadius + o.slope * Math.abs(o.height);
  return {
    id: o.id,
    source: o.source,
    op: 'raise',
    priority: o.priority ?? 50,
    amount: o.height,
    bounds: { minX: o.cx - baseR, minY: o.cy - baseR, maxX: o.cx + baseR, maxY: o.cy + baseR },
    mask(tx, ty) {
      const r = Math.hypot(tx - o.cx, ty - o.cy);
      if (r <= o.topRadius) return 1;
      if (r >= baseR) return 0;
      return clamp01(1 - (r - o.topRadius) / (baseR - o.topRadius));
    },
  };
}

/**
 * An annular band (ditch or rampart): full across `width` centred on radius `r`,
 * falling to 0 at the band edges. Use op 'carve' (ditch) or 'add' (rampart).
 */
export function annulusDeformation(
  o: BrushBase & { cx: number; cy: number; r: number; width: number; amount: number; op: 'carve' | 'add' },
): Deformation {
  const half = o.width / 2;
  const outer = o.r + half;
  return {
    id: o.id,
    source: o.source,
    op: o.op,
    priority: o.priority ?? (o.op === 'carve' ? 70 : 60),
    amount: o.amount,
    bounds: { minX: o.cx - outer, minY: o.cy - outer, maxX: o.cx + outer, maxY: o.cy + outer },
    mask(tx, ty) {
      const d = Math.abs(Math.hypot(tx - o.cx, ty - o.cy) - o.r);
      if (d >= half) return 0;
      // smooth-ish: full in the inner third, taper to the edge
      return clamp01(1 - d / half);
    },
  };
}

/** A disc pad levelled to an absolute height (settlement/building pad). Op 'level'. */
export function discDeformation(
  o: BrushBase & { cx: number; cy: number; radius: number; target: number; feather?: number },
): Deformation {
  const feather = o.feather ?? 1;
  const outer = o.radius + feather;
  return {
    id: o.id,
    source: o.source,
    op: 'level',
    priority: o.priority ?? 20,
    amount: 0,
    target: o.target,
    bounds: { minX: o.cx - outer, minY: o.cy - outer, maxX: o.cx + outer, maxY: o.cy + outer },
    mask(tx, ty) {
      const r = Math.hypot(tx - o.cx, ty - o.cy);
      if (r <= o.radius) return 1;
      if (r >= outer) return 0;
      return clamp01(1 - (r - o.radius) / feather);
    },
  };
}

/** Squared distance from point to a segment (for the polyline brush). */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * A brush following a polyline (road cut / river channel): full within `halfWidth` of
 * the line, tapering to 0 over `feather` beyond. Use op 'carve' (river/road-cut) or
 * 'level' (road grade — pass `target`). Pairs with the roads epic's polylines.
 *
 * `peak` (0..1, default 1) scales the mask at the core so the brush only blends `peak`
 * of the way to its target — the carve STRENGTH. A footpath (low peak) barely pulls the
 * ground toward grade so it follows the terrain; a highway (peak 1) cuts a full flat
 * shelf. Drives the tier→carve coupling without changing footprint or feather.
 */
export function polylineDeformation(
  o: BrushBase & {
    points: { x: number; y: number }[];
    halfWidth: number;
    amount: number;
    op: 'carve' | 'level';
    target?: number;
    feather?: number;
    peak?: number;
  },
): Deformation {
  const feather = o.feather ?? 1;
  const peak = o.peak ?? 1;
  const reach = o.halfWidth + feather;
  const xs = o.points.map((p) => p.x);
  const ys = o.points.map((p) => p.y);
  return {
    id: o.id,
    source: o.source,
    op: o.op,
    priority: o.priority ?? (o.op === 'carve' ? 40 : 30),
    amount: o.amount,
    target: o.target,
    bounds: {
      minX: Math.min(...xs) - reach,
      minY: Math.min(...ys) - reach,
      maxX: Math.max(...xs) + reach,
      maxY: Math.max(...ys) + reach,
    },
    mask(tx, ty) {
      let best = Infinity;
      for (let i = 0; i < o.points.length - 1; i++) {
        const d = distToSegment(tx, ty, o.points[i].x, o.points[i].y, o.points[i + 1].x, o.points[i + 1].y);
        if (d < best) best = d;
      }
      if (o.points.length === 1) best = Math.hypot(tx - o.points[0].x, ty - o.points[0].y);
      if (best <= o.halfWidth) return peak;
      if (best >= reach) return 0;
      return peak * clamp01(1 - (best - o.halfWidth) / feather);
    },
  };
}
