// src/render/gpu/water-dynamics.ts
//
// Climate substrate — slice W-B: LOCALIZED real-time water level + humidity.
//
// The first dynamic layer over the static hydrology model: a small cloud rains on
// one part of the map and the water level + air humidity there respond, in real
// time. It is the "independent-but-connected variables" idea at minimum scale —
// two coupled fields (lake level, humidity) with rain as the forcing and
// evaporation as the relaxation:
//
//     rain(disc)  ──► +humidity over the disc
//                 └─► runoff routed DOWNHILL (hydrology `drainTo`) to the
//                     terminal lake basin ──► that basin's level RISES
//     step(dt)    ──► basins EVAPORATE back toward baseline (drought when dry),
//                     feeding humidity to the air above them; humidity DIFFUSES
//                     and DECAYS.
//
// The renderer already draws a rising/receding lake per-pixel (the water pass
// clips at `surface − bed ≤ 0` and `floodDilateLakes` pre-dilates the plane for
// headroom), so this only has to produce a per-lake-body level offset in metres —
// `buildWaterField({ lakeOffsetM })` bakes it into the surface, no shader change.
//
// Bodies are the connected RENDER lake components (`getLakeBodies`), so different
// lakes rise independently and the offset covers the dilated overhang the
// waterline clips against. Rivers (ribbon pass) and puddles on dry land are a
// later slice; this targets the clearest visual: a basin filling and draining.
//
// No RNG, no DOM — a pure stepper. NOT yet wired into snapshot/timeline, so it's a
// live playground value (the deterministic-replay integration is W-D).

import type { GameMap } from '@/core/types';
import { getHydrologyResult } from '@/world/hydrology-store';
import { getLakeBodies } from '@/render/gpu/water-field';

/** The tunable emergent parameters — exposed in the studio for live play. */
export interface WeatherParams {
  /** Depth of rain deposited per `rain()` over the brush, in millimetres. */
  rainMm: number;
  /** Brush radius in tiles. */
  brushRadius: number;
  /** Fraction (0..1) of the rained volume that reaches the downstream basin (vs.
   *  soaking in / evaporating on the way) — the "how flashy is the catchment" knob. */
  runoffFrac: number;
  /** Lake level fall in mm/sec — the evaporation that drains a flood back to
   *  baseline (and, with no rain, would pull a basin into drought). */
  evapMmPerSec: number;
  /** Air humidity (0..1) gained per mm of rain (and per mm evaporated off a lake). */
  humidityPerMm: number;
  /** Humidity lost per second (relaxation back to a dry sky). */
  humidityDecayPerSec: number;
  /** Humidity spatial diffusion per step (0..0.25) — how fast a wet patch spreads. */
  humidityDiffuse: number;
}

export const DEFAULT_WEATHER: WeatherParams = {
  rainMm: 800,
  brushRadius: 6,
  runoffFrac: 0.5,
  evapMmPerSec: 25,
  humidityPerMm: 0.0014,
  humidityDecayPerSec: 0.04,
  humidityDiffuse: 0.12,
};

export class WaterDynamics {
  readonly W: number;
  readonly H: number;
  /** Air humidity 0..1 per cell (row-major) — read directly for the overlay. */
  readonly humidity: Float32Array;

  /** Per-lake-body water-level offset in METRES (flood > 0, drought < 0). */
  private readonly bodyOffsetM: Float32Array;
  private readonly bodyId: Int32Array;
  private readonly areaCells: number[];
  /** Cells of each lake body — for the evaporation→humidity sweep (lakes are small). */
  private readonly bodyCells: number[][];
  private readonly drainTo: Int32Array;
  private readonly tmp: Float32Array;

  constructor(map: GameMap) {
    this.W = map.width;
    this.H = map.height;
    const cells = this.W * this.H;
    this.humidity = new Float32Array(cells);
    this.tmp = new Float32Array(cells);

    const lb = getLakeBodies(map);
    this.bodyId = lb.bodyId;
    this.areaCells = lb.areaCells;
    this.bodyOffsetM = new Float32Array(lb.areaCells.length);
    this.bodyCells = lb.areaCells.map(() => []);
    for (let i = 0; i < this.bodyId.length; i++) {
      const b = this.bodyId[i];
      if (b >= 0) this.bodyCells[b].push(i);
    }

    this.drainTo = getHydrologyResult(map).drainTo;
  }

  /** Number of lake bodies (0 → nowhere for runoff to pool). */
  get bodyCount(): number { return this.bodyOffsetM.length; }

  /** The per-body level offset (metres) handed to `buildWaterField({ lakeOffsetM })`. */
  lakeOffsetM(): Float32Array { return this.bodyOffsetM; }

  /** Rain a disc at a tile: humidity rises over the disc, runoff fills the basin the
   *  centre drains into. `mm`/`radius` default to the params. Returns the body index
   *  that filled (or −1 if the catchment drains to sea / no lake). */
  rain(tileX: number, tileY: number, p: WeatherParams): number {
    const { W, H } = this;
    const r = Math.max(0, Math.round(p.brushRadius));
    const cx = Math.round(tileX), cy = Math.round(tileY);
    const r2 = r * r;
    const hGain = p.humidityPerMm * p.rainMm;
    let discCells = 0;
    for (let dy = -r; dy <= r; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= H) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const nx = cx + dx;
        if (nx < 0 || nx >= W) continue;
        const i = ny * W + nx;
        this.humidity[i] = Math.min(1, this.humidity[i] + hGain);
        discCells++;
      }
    }
    if (discCells === 0) return -1;

    const targetBody = this.routeToLakeBody(cx, cy);
    if (targetBody >= 0) {
      // Volume = rainDepth × discArea × runoff; level rise = volume / basinArea.
      // Tile area cancels (both in tiles), so this is a pure depth ratio.
      const riseM = (p.rainMm / 1000) * discCells * p.runoffFrac
        / Math.max(1, this.areaCells[targetBody]);
      this.bodyOffsetM[targetBody] += riseM;
    }
    return targetBody;
  }

  /** Advance the coupled fields by `dt` seconds. */
  step(dt: number, p: WeatherParams): void {
    if (dt <= 0) return;
    if (!this.active()) return;   // inert world: skip the full-grid blur (true idle)
    const evapM = (p.evapMmPerSec / 1000) * dt;
    const evapHumidity = p.humidityPerMm * p.evapMmPerSec * dt;

    for (let b = 0; b < this.bodyOffsetM.length; b++) {
      const off = this.bodyOffsetM[b];
      if (off > 0) {
        // Flood evaporates back toward baseline, humidifying the air above it.
        this.bodyOffsetM[b] = Math.max(0, off - evapM);
        const cellsB = this.bodyCells[b];
        for (let k = 0; k < cellsB.length; k++) {
          const i = cellsB[k];
          this.humidity[i] = Math.min(1, this.humidity[i] + evapHumidity);
        }
      } else if (off < 0) {
        // Drought recovers slowly (springs refill) when not actively drained.
        this.bodyOffsetM[b] = Math.min(0, off + evapM * 0.5);
      }
    }

    this.diffuseHumidity(p, dt);
  }

  /** Push a basin into drought (negative offset) — the dry half of the lever. */
  drought(tileX: number, tileY: number, metres: number): number {
    const b = this.routeToLakeBody(Math.round(tileX), Math.round(tileY));
    if (b >= 0) this.bodyOffsetM[b] -= Math.abs(metres);
    return b;
  }

  /** Any active forcing (a shifted basin or lingering humidity)? Gates re-upload. */
  active(): boolean {
    for (let b = 0; b < this.bodyOffsetM.length; b++) if (this.bodyOffsetM[b] !== 0) return true;
    for (let i = 0; i < this.humidity.length; i++) if (this.humidity[i] > 1e-4) return true;
    return false;
  }

  /** Peak humidity (0..1) — a cheap studio readout. */
  maxHumidity(): number {
    let m = 0;
    for (let i = 0; i < this.humidity.length; i++) if (this.humidity[i] > m) m = this.humidity[i];
    return m;
  }

  /** Largest basin level offset (metres), signed by sign of the biggest magnitude. */
  maxLevelM(): number {
    let m = 0;
    for (let b = 0; b < this.bodyOffsetM.length; b++) {
      if (Math.abs(this.bodyOffsetM[b]) > Math.abs(m)) m = this.bodyOffsetM[b];
    }
    return m;
  }

  reset(): void {
    this.bodyOffsetM.fill(0);
    this.humidity.fill(0);
  }

  /** Index of the largest lake body, or −1 if the world has no lakes. */
  largestBody(): number {
    let best = -1, bestArea = 0;
    for (let b = 0; b < this.areaCells.length; b++) {
      if (this.areaCells[b] > bestArea) { bestArea = this.areaCells[b]; best = b; }
    }
    return best;
  }

  /** Shove the biggest basin up (flood) or down (drought) by `metres` — the no-aim
   *  button path. Returns false if there are no lakes. */
  shiftLargest(metres: number): boolean {
    const b = this.largestBody();
    if (b < 0) return false;
    this.bodyOffsetM[b] += metres;
    return true;
  }

  /** Walk `drainTo` from a tile until a lake cell (returns its body) or sea/outlet (−1). */
  private routeToLakeBody(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return -1;
    let i = y * this.W + x;
    const cap = this.W + this.H;
    for (let steps = 0; steps < cap; steps++) {
      if (this.bodyId[i] >= 0) return this.bodyId[i];
      const t = this.drainTo[i];
      if (t < 0 || t === i) return -1;
      i = t;
    }
    return -1;
  }

  /** 4-neighbour blur + exponential decay of the humidity field. */
  private diffuseHumidity(p: WeatherParams, dt: number): void {
    const { W, H, humidity, tmp } = this;
    const decay = Math.max(0, 1 - p.humidityDecayPerSec * dt);
    const k = Math.min(0.25, Math.max(0, p.humidityDiffuse));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const c = humidity[i];
        const l = x > 0 ? humidity[i - 1] : c;
        const rr = x < W - 1 ? humidity[i + 1] : c;
        const u = y > 0 ? humidity[i - W] : c;
        const d = y < H - 1 ? humidity[i + W] : c;
        tmp[i] = (c + k * ((l + rr + u + d) * 0.25 - c)) * decay;
      }
    }
    humidity.set(tmp);
  }
}
