// src/water/water-flotsam.ts
//
// Water S6 — flotsam & fauna: cosmetic particles advected by the flow field.
// Leaves/twigs drift downstream, fish dart, birds skim — all moving with the
// hydrology model's per-cell flow vectors. PURELY cosmetic: deterministic from a
// seed (so it doesn't need Math.random) but deliberately NOT part of the sim or
// snapshot — flotsam is presentation, not state, so it won't be frame-identical
// across scrub/re-roll (the lean trade the design calls for).

import type { GameMap, HydrologyResult } from '@/core/types';
import type { DrawItem } from '@/render/iso/draw-list';
import { worldToScreen } from '@/render/iso/iso-projection';
import { ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { worldStyleOf } from '@/core/world-style';
import { createRng, type Rng } from '@/core/rng';

export type FlotsamKind = 'flotsam' | 'fish' | 'bird';

interface Particle { x: number; y: number; kind: FlotsamKind; age: number; ttl: number; }

const COLOR: Record<FlotsamKind, string> = {
  flotsam: '#6b5536', // brown debris
  fish: '#cdd6dd',    // silver flash
  bird: '#f0f2f4',    // pale wader
};
const RADIUS: Record<FlotsamKind, number> = { flotsam: 1.6, fish: 1.3, bird: 1.9 };

const FLOW_SPEED = 2.2; // tiles/sec at unit flow
const WANDER = 0.5;     // tiles/sec random drift (still water + fauna jitter)
const BASE_TTL = 14;    // seconds before a particle respawns

/**
 * A pool of flow-advected cosmetic particles. Construct once per session, call
 * {@link step} each frame with the elapsed seconds, then {@link drawItems} to get
 * `circle` DrawItems (which the renderer does NOT terrain-lift, so they keep the
 * water-surface z this sets).
 */
export class FlotsamSystem {
  private rng: Rng;
  private parts: Particle[] = [];
  private wetCells: number[] = [];
  private mapRef: GameMap | null = null;

  constructor(seed: number, private count = 80) {
    this.rng = createRng((seed ^ 0x71053) >>> 0);
  }

  /** (Re)seed the pool + the wet-cell spawn list when the world changes. */
  private ensure(map: GameMap, hydro: HydrologyResult): void {
    if (this.mapRef === map) return;
    this.mapRef = map;
    this.wetCells = [];
    for (let i = 0; i < hydro.waterMask.length; i++) if (hydro.waterMask[i]) this.wetCells.push(i);
    this.parts = [];
    if (this.wetCells.length === 0) return;
    for (let i = 0; i < this.count; i++) this.parts.push(this.spawn(map));
  }

  private spawn(map: GameMap): Particle {
    const ci = this.wetCells[this.rng.nextInt(this.wetCells.length)];
    const x = (ci % map.width) + this.rng.next();
    const y = Math.floor(ci / map.width) + this.rng.next();
    const r = this.rng.next();
    const kind: FlotsamKind = r < 0.6 ? 'flotsam' : r < 0.85 ? 'fish' : 'bird';
    return { x, y, kind, age: 0, ttl: BASE_TTL * (0.5 + this.rng.next()) };
  }

  /** Advance every particle along the flow field; respawn the dead/beached. */
  step(map: GameMap, hydro: HydrologyResult, dtSec: number): void {
    this.ensure(map, hydro);
    if (this.wetCells.length === 0) return;
    const dt = Math.min(0.1, Math.max(0, dtSec)); // clamp tab-out frame gaps
    const { width, height } = map;
    for (const p of this.parts) {
      const cx = Math.floor(p.x), cy = Math.floor(p.y);
      const inB = cx >= 0 && cy >= 0 && cx < width && cy < height;
      const ci = cy * width + cx;
      const fx = inB ? hydro.flowDirX[ci] : 0;
      const fy = inB ? hydro.flowDirY[ci] : 0;
      const jitter = p.kind === 'flotsam' ? 0.3 : 1.0;
      p.x += fx * FLOW_SPEED * dt + (this.rng.next() - 0.5) * WANDER * jitter * dt;
      p.y += fy * FLOW_SPEED * dt + (this.rng.next() - 0.5) * WANDER * jitter * dt;
      p.age += dt;

      const ncx = Math.floor(p.x), ncy = Math.floor(p.y);
      const nin = ncx >= 0 && ncy >= 0 && ncx < width && ncy < height;
      const beached = !nin || hydro.waterMask[ncy * width + ncx] === 0;
      // Flotsam/fish respawn the moment they leave water; birds may skim past a
      // shore but recycle once aged.
      if (p.age > p.ttl || (beached && p.kind !== 'bird') || (beached && p.age > p.ttl * 0.4)) {
        Object.assign(p, this.spawn(map));
      }
    }
  }

  /** Test/debug: a copy of the current particle positions. */
  snapshot(): Array<{ x: number; y: number; kind: FlotsamKind }> {
    return this.parts.map((p) => ({ x: p.x, y: p.y, kind: p.kind }));
  }

  /** `circle` DrawItems at each particle's water-surface position (origin 0; the
   *  caller's view transform is applied downstream, like the rest of the list). */
  drawItems(map: GameMap, hydro: HydrologyResult): DrawItem[] {
    const style = worldStyleOf(map.worldSeed);
    const zScale = style.mountainRelief * style.terrainVerticalExaggeration;
    const out: DrawItem[] = [];
    for (const p of this.parts) {
      const cx = Math.floor(p.x), cy = Math.floor(p.y);
      if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) continue;
      const surf = hydro.surfaceW[cy * map.width + cx];
      let z = surf < 0 ? 0 : (surf - ELEVATION_SEA_LEVEL) * zScale;
      if (p.kind === 'bird') z += 10 + 3 * Math.sin(p.age * 3); // hover above the surface
      const { sx, sy } = worldToScreen(p.x, p.y, z, 0, 0);
      out.push({ t: 'circle', cx: sx, cy: sy, r: RADIUS[p.kind], color: COLOR[p.kind] });
    }
    return out;
  }
}
