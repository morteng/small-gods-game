// src/render/gpu/water-dynamics.ts
//
// Climate substrate — slices W-B + W-C: a coupled, real-time climate stepper.
//
// W-C (the emergent atmosphere, gated behind `autoWeather`) layers wind, a
// temperature field and a drifting cloud field on top of W-B's water/humidity:
//
//     evaporation  open water + warmth ──► CLOUD (the source)
//     wind         cloud ADVECTS downwind (semi-Lagrangian)
//     orographic   wind pushing cloud UP a slope rains on the windward face,
//                  leaving a dry rain-shadow leeward
//     saturation   cold air holds less → caps cloud low → rains out on peaks
//     precip       rain ──► fills the lake it drains into (W-B routing) + humidity;
//                  catchments the clouds never reach drift into DROUGHT
//
// So storms, rain-shadow deserts and drought EMERGE from wind × terrain × heat —
// nothing is scripted. Still a live studio playground (not in snapshot/timeline);
// the deterministic-sim promotion is W-D.
//
// W-B: LOCALIZED real-time water level + humidity (manual rain) — unchanged below.
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
// waterline clips against.
//
// W-E (per-cell flood field): `floodM` lays standing water on ARBITRARY land — the
// "a powerful god floods a plain" lever — generalizing the per-body lake offset into
// a per-cell sheet the renderer bakes into the surface and clips to the terrain.
//
// No RNG, no DOM — a pure stepper. NOT yet wired into snapshot/timeline, so it's a
// live playground value (the deterministic-replay integration is W-D).

import type { GameMap } from '@/core/types';
import { WaterType } from '@/core/types';
import { getHydrologyResult } from '@/world/hydrology-store';
import { getLakeBodies } from '@/render/gpu/water-field';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec } from '@/terrain/terrain-shape';
import { styledClimate } from '@/terrain/climate';
import type { WeatherStepper, WeatherSnapshot } from '@/sim/water/weather-stepper';

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

  // ── W-C: emergent atmosphere (off unless `autoWeather`) ──────────────────────
  /** Master switch for the coupled atmosphere (clouds/wind/temp/orographic rain).
   *  Off → `step()` only runs the W-B lake+humidity relaxation (back-compat). */
  autoWeather: boolean;
  /** Wind direction in degrees (0 = +x / east, 90 = +y / south). */
  windDirDeg: number;
  /** Wind speed in tiles/sec — how fast cloud advects downwind. */
  windSpeed: number;
  /** Cloud formed per second over open water at temp 1 (the evaporation source). */
  evapRate: number;
  /** Cloud saturation scale: a cell rains its cloud above `precipThreshold·temp`
   *  (cold air holds less → rains out first → snow/rain caps on cold peaks). */
  precipThreshold: number;
  /** Extra precip when wind pushes cloud UP a slope (orographic) — rain on the
   *  windward side, a dry shadow leeward. */
  orographicGain: number;
  /** Diurnal temperature swing amplitude (±, in the [0,1] temp scale). */
  diurnalAmp: number;
  /** Millimetres of runoff per unit of cloud rained — couples precip → lake level. */
  cloudToMm: number;
}

export const DEFAULT_WEATHER: WeatherParams = {
  rainMm: 800,
  brushRadius: 6,
  runoffFrac: 0.5,
  evapMmPerSec: 25,
  humidityPerMm: 0.0014,
  humidityDecayPerSec: 0.04,
  humidityDiffuse: 0.12,
  // Atmosphere — off by default so W-B (manual rain) and the unit tests are
  // unchanged; the studio flips `autoWeather` on for the live weather demo.
  autoWeather: false,
  windDirDeg: 35,
  windSpeed: 6,
  evapRate: 0.05,
  precipThreshold: 0.9,
  orographicGain: 0.6,
  diurnalAmp: 0.08,
  cloudToMm: 1800,
};

/** Seconds of real time per in-world day (studio-fast, for a visible diurnal cycle). */
const DAY_SEC = 24;

export class WaterDynamics implements WeatherStepper {
  readonly W: number;
  readonly H: number;
  /** Current tunable params — used by the deterministic `stepTick` (the studio path
   *  passes its own params to `step()` directly; the game sets these once). */
  private params: WeatherParams = { ...DEFAULT_WEATHER };
  /** Air humidity 0..1 per cell (row-major) — read directly for the overlay. */
  readonly humidity: Float32Array;

  /** Per-CELL standing-water depth in METRES above the local terrain (≥0). This is
   *  the "flood a plain" field — water on ARBITRARY ground, not just a raised lake
   *  basin. The per-body `bodyOffsetM` below raises EXISTING lakes within their bank;
   *  `floodM` puts a sheet of water anywhere a god (or a deluge) drops it, and the
   *  per-pixel water clip in the shader carves it to the terrain contour. Sparse:
   *  almost all cells stay 0 (no per-frame full-grid work unless a flood is live). */
  readonly floodM: Float32Array;
  /** Count of cells currently holding standing water — gates the flood bake/scan. */
  private floodCount = 0;

  /** Per-lake-body water-level offset in METRES (flood > 0, drought < 0). */
  private readonly bodyOffsetM: Float32Array;
  private readonly bodyId: Int32Array;
  private readonly areaCells: number[];
  /** Cells of each lake body — for the evaporation→humidity sweep (lakes are small). */
  private readonly bodyCells: number[][];
  private readonly drainTo: Int32Array;
  private readonly tmp: Float32Array;

  // ── W-C atmosphere ───────────────────────────────────────────────────────────
  /** Cloud water 0..1 per cell (row-major) — read directly for the overlay. */
  readonly cloud: Float32Array;
  /** Live air temperature 0..1 per cell (base climate + diurnal) — for the overlay. */
  readonly temp: Float32Array;
  private readonly cloudTmp: Float32Array;
  private readonly baseTemp: Float32Array;   // static latitude band + elevation lapse
  private readonly elev: Float32Array;       // [0,1], sea level = ELEVATION_SEA_LEVEL
  private readonly isWater: Uint8Array;      // ocean/lake cell → an evaporation source
  /** Terminal lake body each cell drains into (−1 = drains to sea / no lake). */
  private readonly drainBody: Int32Array;
  private timeOfDaySec = 0;
  /** POI id → tile centre, for `floodPoi` (the `summon_storm` target lookup). */
  private readonly poiPos = new Map<string, { x: number; y: number }>();

  constructor(map: GameMap) {
    this.W = map.width;
    this.H = map.height;
    const cells = this.W * this.H;
    this.humidity = new Float32Array(cells);
    this.floodM = new Float32Array(cells);
    this.tmp = new Float32Array(cells);
    this.cloud = new Float32Array(cells);
    this.cloudTmp = new Float32Array(cells);
    this.temp = new Float32Array(cells);

    const lb = getLakeBodies(map);
    this.bodyId = lb.bodyId;
    this.areaCells = lb.areaCells;
    this.bodyOffsetM = new Float32Array(lb.areaCells.length);
    this.bodyCells = lb.areaCells.map(() => []);
    for (let i = 0; i < this.bodyId.length; i++) {
      const b = this.bodyId[i];
      if (b >= 0) this.bodyCells[b].push(i);
    }

    const hy = getHydrologyResult(map);
    this.drainTo = hy.drainTo;

    // Elevation (same memoised heightfield hydrology/render use) + water mask.
    this.elev = getHeightfield(
      map.seed, this.W, this.H,
      styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null, styledShapeSpec(map.worldSeed),
    );
    this.isWater = new Uint8Array(cells);
    for (let i = 0; i < cells; i++) {
      const wt = hy.waterType[i];
      this.isWater[i] = (wt === WaterType.Ocean || wt === WaterType.Lake) ? 1 : 0;
    }

    // Base temperature: the climate latitude band (north→south) + east-warm lean,
    // minus the elevation lapse — the structure that makes lowlands warm and peaks
    // cold (so orographic rain falls on cold high ground). Mirrors climate.ts; it's
    // the atmosphere's resting state, perturbed each step by the diurnal cycle.
    const clim = styledClimate(map.worldSeed);
    this.baseTemp = new Float32Array(cells);
    for (let y = 0; y < this.H; y++) {
      const lat = this.H > 1 ? y / (this.H - 1) : 0;            // 0 north → 1 south
      const band = clim.tempNorth + (clim.tempSouth - clim.tempNorth) * lat;
      for (let x = 0; x < this.W; x++) {
        const i = y * this.W + x;
        const ew = this.W > 1 ? (x / (this.W - 1) - 0.5) : 0;   // −0.5 west → +0.5 east
        const aboveSea = Math.max(0, this.elev[i] - ELEVATION_SEA_LEVEL);
        let t = band + ew * clim.eastWarmLean - aboveSea * clim.elevationLapse;
        this.baseTemp[i] = t < 0 ? 0 : t > 1 ? 1 : t;
      }
    }
    this.temp.set(this.baseTemp);

    // Precompute each cell's terminal lake body once (so per-cell precip routing is
    // O(1), not a drainTo walk every step over every raining cell).
    this.drainBody = new Int32Array(cells).fill(-2);   // −2 = not yet resolved
    for (let i = 0; i < cells; i++) this.drainBody[i] = this.resolveDrainBody(i);

    // POI centres (for floodPoi / summon_storm) — positioned POIs only.
    for (const p of map.worldSeed?.pois ?? []) {
      if (p.position) this.poiPos.set(p.id, { x: p.position.x, y: p.position.y });
    }
  }

  /** Walk `drainTo` from a cell to its terminal lake body (memoised into drainBody). */
  private resolveDrainBody(start: number): number {
    if (this.drainBody[start] !== -2) return this.drainBody[start];
    const path: number[] = [];
    let i = start;
    const cap = this.W + this.H;
    let result = -1;
    for (let steps = 0; steps < cap; steps++) {
      if (this.bodyId[i] >= 0) { result = this.bodyId[i]; break; }
      if (this.drainBody[i] !== -2) { result = this.drainBody[i]; break; }
      path.push(i);
      const t = this.drainTo[i];
      if (t < 0 || t === i) { result = -1; break; }
      i = t;
    }
    for (const c of path) this.drainBody[c] = result;
    return result;
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
    // With the atmosphere on the world is never idle (oceans always evaporate);
    // otherwise skip the full-grid work when nothing is forced (true idle).
    if (!p.autoWeather && !this.active()) return;
    if (p.autoWeather) this.stepAtmosphere(dt, p);
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

    // Standing water on dry land evaporates back toward bare ground (a flooded plain
    // dries out), humidifying the air above it as it goes. Sparse — only touched when
    // a flood is live, so a dry world pays nothing here.
    if (this.floodCount > 0) {
      let remaining = 0;
      for (let i = 0; i < this.floodM.length; i++) {
        const f = this.floodM[i];
        if (f <= 0) continue;
        const nf = f - evapM;
        if (nf <= 1e-4) { this.floodM[i] = 0; continue; }
        this.floodM[i] = nf;
        this.humidity[i] = Math.min(1, this.humidity[i] + evapHumidity);
        remaining++;
      }
      this.floodCount = remaining;
    }

    this.diffuseHumidity(p, dt);
  }

  /** Flood a disc of ground: lay a sheet of standing water `depthM` metres deep over
   *  every land cell in the brush (raising, never lowering, what's already there). The
   *  headline divine lever — "a powerful god floods a plain." Water on dry land is the
   *  per-cell `floodM` field; the renderer bakes it into the surface and the per-pixel
   *  clip trims it to the terrain. Also wets the air over the flood. Returns the number
   *  of cells flooded. */
  floodArea(tileX: number, tileY: number, radius: number, depthM: number): number {
    const { W, H } = this;
    const r = Math.max(0, Math.round(radius));
    const cx = Math.round(tileX), cy = Math.round(tileY);
    const r2 = r * r;
    const depth = Math.max(0, depthM);
    let n = 0;
    for (let dy = -r; dy <= r; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= H) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const nx = cx + dx;
        if (nx < 0 || nx >= W) continue;
        const i = ny * W + nx;
        if (this.elev[i] < ELEVATION_SEA_LEVEL) continue;   // below the sea — already ocean
        if (this.floodM[i] < depth) this.floodM[i] = depth;
        this.humidity[i] = Math.min(1, this.humidity[i] + 0.4);
        n++;
      }
    }
    this.recountFlood();
    return n;
  }

  /** Per-cell standing-water depth (metres) handed to `buildWaterField({ floodOffsetM })`. */
  floodOffsetM(): Float32Array { return this.floodM; }

  /** Flood the ground around a POI (the `summon_storm` effect). Returns cells flooded. */
  floodPoi(poiId: string, radius: number, depthM: number): number {
    const pos = this.poiPos.get(poiId);
    if (!pos) return 0;
    return this.floodArea(pos.x, pos.y, radius, depthM);
  }

  // ── W-G: deterministic sim seam (WeatherStepper) ─────────────────────────────────

  /** Set the tunable params the deterministic `stepTick` uses (the game path). */
  setParams(p: WeatherParams): void { this.params = { ...p }; }

  /** Advance on a FIXED sim-tick interval (ms) using the stored params — the
   *  deterministic entry the sim's `WeatherSystem` calls. Same dt + same logged
   *  actions ⇒ same fields, so scrub/replay reproduce the flood. */
  stepTick(dtMs: number): void { this.step(dtMs / 1000, this.params); }

  /** Capture the evolving fields for the snapshot (plain arrays). */
  serialize(): WeatherSnapshot {
    return {
      bodyOffsetM: Array.from(this.bodyOffsetM),
      floodM: Array.from(this.floodM),
      humidity: Array.from(this.humidity),
      cloud: Array.from(this.cloud),
      temp: Array.from(this.temp),
      timeOfDaySec: this.timeOfDaySec,
    };
  }

  /** Restore the fields from a snapshot. Array lengths are tolerated defensively:
   *  a snapshot from a different map size is ignored per-field (keeps current). */
  hydrate(snap: WeatherSnapshot): void {
    const setIf = (dst: Float32Array, src: number[] | undefined): void => {
      if (src && src.length === dst.length) dst.set(src);
    };
    setIf(this.bodyOffsetM, snap.bodyOffsetM);
    setIf(this.floodM, snap.floodM);
    setIf(this.humidity, snap.humidity);
    setIf(this.cloud, snap.cloud);
    setIf(this.temp, snap.temp);
    this.timeOfDaySec = snap.timeOfDaySec ?? 0;
    this.recountFlood();
  }

  /** Cheap O(cells) refresh of the flood-active count (called after flood edits/step). */
  private recountFlood(): void {
    let n = 0;
    for (let i = 0; i < this.floodM.length; i++) if (this.floodM[i] > 1e-4) n++;
    this.floodCount = n;
  }

  /** Push a basin into drought (negative offset) — the dry half of the lever. */
  drought(tileX: number, tileY: number, metres: number): number {
    const b = this.routeToLakeBody(Math.round(tileX), Math.round(tileY));
    if (b >= 0) this.bodyOffsetM[b] -= Math.abs(metres);
    return b;
  }

  /** Any active forcing (a shifted basin or lingering humidity)? Gates re-upload. */
  active(): boolean {
    if (this.floodCount > 0) return true;
    for (let b = 0; b < this.bodyOffsetM.length; b++) if (this.bodyOffsetM[b] !== 0) return true;
    for (let i = 0; i < this.humidity.length; i++) if (this.humidity[i] > 1e-4) return true;
    return false;
  }

  /** Peak cloud water (0..1) — a studio readout / "is it overcast" gauge. */
  maxCloud(): number {
    let m = 0;
    for (let i = 0; i < this.cloud.length; i++) if (this.cloud[i] > m) m = this.cloud[i];
    return m;
  }

  /** Wind as a unit-ish vector scaled by speed (tiles/sec), from the params. */
  windVector(p: WeatherParams): { x: number; y: number } {
    const a = (p.windDirDeg * Math.PI) / 180;
    return { x: Math.cos(a) * p.windSpeed, y: Math.sin(a) * p.windSpeed };
  }

  /** Time of day in [0,1) (0 = dawn) — drives the diurnal temperature swing. */
  timeOfDay(): number { return (this.timeOfDaySec / DAY_SEC) % 1; }

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
    this.floodM.fill(0);
    this.floodCount = 0;
    this.cloud.fill(0);
    this.temp.set(this.baseTemp);
    this.timeOfDaySec = 0;
  }

  /** Peak standing-water depth (metres) anywhere on land — a studio readout. */
  maxFloodM(): number {
    let m = 0;
    for (let i = 0; i < this.floodM.length; i++) if (this.floodM[i] > m) m = this.floodM[i];
    return m;
  }

  /** Seed an overcast sky so emergent rain has cloud to work with immediately —
   *  the studio "Seed clouds" button (otherwise you wait for evaporation). */
  seedClouds(amount = 0.6): void {
    for (let i = 0; i < this.cloud.length; i++) {
      if (this.elev[i] >= ELEVATION_SEA_LEVEL) this.cloud[i] = Math.min(1, this.cloud[i] + amount);
    }
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

  /**
   * The emergent atmosphere: diurnal temperature, evaporation→cloud, wind
   * advection of cloud, then orographic + saturation precipitation that fills
   * downstream lakes and wets the ground. Catchments the cloud never reaches get
   * no precip → their basins drift toward drought in the W-B relaxation.
   */
  private stepAtmosphere(dt: number, p: WeatherParams): void {
    const { W, H, cloud, cloudTmp, temp, baseTemp, elev, isWater, humidity } = this;

    // ── 1. Diurnal temperature: warmest mid-day, coldest pre-dawn. ──────────────
    this.timeOfDaySec += dt;
    const diurnal = -Math.cos((this.timeOfDaySec / DAY_SEC) * Math.PI * 2) * p.diurnalAmp;
    for (let i = 0; i < temp.length; i++) {
      let t = baseTemp[i] + diurnal;
      temp[i] = t < 0 ? 0 : t > 1 ? 1 : t;
    }

    // ── 2. Evaporation: open water + warmth → cloud (and a little ground humidity).
    const evap = p.evapRate * dt;
    for (let i = 0; i < cloud.length; i++) {
      if (isWater[i]) {
        const g = evap * temp[i];
        cloud[i] = Math.min(1, cloud[i] + g);
        humidity[i] = Math.min(1, humidity[i] + g * 0.5);
      }
    }

    // ── 3. Wind advection (semi-Lagrangian: sample cloud from upwind). ──────────
    const w = this.windVector(p);
    const wx = w.x * dt, wy = w.y * dt;
    if (wx !== 0 || wy !== 0) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let sx = x - wx, sy = y - wy;
          if (sx < 0) sx = 0; else if (sx > W - 1) sx = W - 1;
          if (sy < 0) sy = 0; else if (sy > H - 1) sy = H - 1;
          // Bilinear sample of the old cloud field.
          const x0 = sx | 0, y0 = sy | 0;
          const x1 = x0 < W - 1 ? x0 + 1 : x0, y1 = y0 < H - 1 ? y0 + 1 : y0;
          const fx = sx - x0, fy = sy - y0;
          const c00 = cloud[y0 * W + x0], c10 = cloud[y0 * W + x1];
          const c01 = cloud[y1 * W + x0], c11 = cloud[y1 * W + x1];
          cloudTmp[y * W + x] =
            (c00 * (1 - fx) + c10 * fx) * (1 - fy) + (c01 * (1 - fx) + c11 * fx) * fy;
        }
      }
      cloud.set(cloudTmp);
    }

    // ── 4. Precipitation: orographic (wind up a slope) + saturation (cold caps). ─
    const nWx = w.x, nWy = w.y;
    const wMag = Math.hypot(nWx, nWy) || 1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const c = cloud[i];
        if (c <= 1e-4) continue;

        // Uphill component of wind: ∇elev · windDir (central differences).
        const ex = (elev[i + (x < W - 1 ? 1 : 0)] - elev[i - (x > 0 ? 1 : 0)]);
        const ey = (elev[i + (y < H - 1 ? W : 0)] - elev[i - (y > 0 ? W : 0)]);
        const lift = (ex * nWx + ey * nWy) / wMag;        // >0 = wind climbing
        const orographic = lift > 0 ? p.orographicGain * lift * c : 0;

        // Cold air holds less moisture → lower cloud cap → rains out on peaks.
        const cap = p.precipThreshold * temp[i];
        const saturation = c > cap ? c - cap : 0;

        let precip = orographic + saturation;
        if (precip > c) precip = c;
        if (precip <= 0) continue;

        cloud[i] = c - precip;
        humidity[i] = Math.min(1, humidity[i] + precip);
        const body = this.drainBody[i];
        if (body >= 0) {
          const riseM = (precip * p.cloudToMm / 1000) * p.runoffFrac
            / Math.max(1, this.areaCells[body]);
          this.bodyOffsetM[body] += riseM;
        }
      }
    }

    // ── 5. Cloud thins slowly (dissipation) so a calm sky clears. ───────────────
    const keep = Math.max(0, 1 - 0.02 * dt);
    for (let i = 0; i < cloud.length; i++) cloud[i] *= keep;
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
