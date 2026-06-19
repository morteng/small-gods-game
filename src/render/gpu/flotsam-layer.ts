// src/render/gpu/flotsam-layer.ts
//
// The cosmetic flotsam/fauna draw layer (S6) — flow-advected particles that ride
// the water surface. Lazily created from the map seed on first use and stepped by
// WALL-CLOCK delta (pure render — never the sim clock, so scrubbing time doesn't
// re-roll it). This wrapper owns the particle system + its last-stepped timestamp
// so the render frame doesn't carry that mutable state inline; the frame still
// decides WHETHER to draw the layer (only over a wet, visible water surface).

import type { GameMap } from '@/core/types';
import type { DrawItem } from '@/render/iso/draw-list';
import { FlotsamSystem } from '@/water/water-flotsam';
import { getHydrologyResult } from '@/world/hydrology-store';

export class FlotsamLayer {
  private system: FlotsamSystem | null = null;
  private lastTime = 0;

  /**
   * Advance the particles to `timeSec` (wall-clock seconds) and return their draw
   * items. The first call seeds the system (no motion, dt=0). Items are `circle`s
   * the renderer doesn't terrain-lift, so they keep their water-surface z when the
   * frame appends them after the entity list.
   */
  items(map: GameMap, timeSec: number): DrawItem[] {
    const hydro = getHydrologyResult(map);
    if (!this.system) this.system = new FlotsamSystem(map.seed);
    const dt = this.lastTime > 0 ? timeSec - this.lastTime : 0;
    this.lastTime = timeSec;
    this.system.step(map, hydro, dt);
    return this.system.drawItems(map, hydro);
  }
}
