// src/sim/water/weather-stepper.ts
//
// Water W-G — the deterministic seam between the sim and the water stepper.
//
// The live water/atmosphere stepper (`WaterDynamics`) lives in the render layer
// because it shares the render heightfield + lake-body helpers. The SIM must never
// import render, so this module defines the structural CONTRACT the sim depends on
// instead — `WaterDynamics` implements it, the game injects the instance, and the
// `WeatherSystem` + snapshot code talk only to this interface. Dependency arrow
// stays render → sim (never the reverse).
//
// Determinism: `stepTick(dtMs)` advances on a FIXED sim-tick dt (not wall-clock), so
// the water fields are a pure function of (terrain, tick count, logged divine
// actions). `serialize()`/`hydrate()` put the evolving fields into the snapshot so
// scrub / commit / replay reproduce the exact flood state — the prerequisite for a
// flood driving a Fate beat without the timeline diverging.

/** The serializable physical state of the water/atmosphere fields (plain arrays so a
 *  snapshot is structured-clone + JSON friendly). Tunable params are NOT here — they
 *  are exogenous config re-applied by the game, like the command queue / surfaced
 *  inbox; only DERIVED sim state is snapshotted. */
export interface WeatherSnapshot {
  /** Per-lake-body level offset (metres), indexed by render lake body. */
  bodyOffsetM: number[];
  /** Per-cell standing-water depth (metres above terrain), row-major. */
  floodM: number[];
  /** Per-cell air humidity 0..1, row-major. */
  humidity: number[];
  /** Per-cell cloud water 0..1, row-major. */
  cloud: number[];
  /** Per-cell live air temperature 0..1, row-major. */
  temp: number[];
  /** Time-of-day accumulator (seconds), for the diurnal cycle. */
  timeOfDaySec: number;
}

/** The contract the sim + snapshot use to drive and persist the water stepper. */
export interface WeatherStepper {
  /** Advance the coupled fields by a FIXED sim-tick interval (milliseconds). */
  stepTick(dtMs: number): void;
  /** Capture the evolving fields for the snapshot. */
  serialize(): WeatherSnapshot;
  /** Restore the fields from a snapshot (scrub / replay / load). */
  hydrate(snap: WeatherSnapshot): void;
  /** Per-cell standing-water depth (metres) — the flood field FloodWatch reads. */
  floodOffsetM(): Float32Array;
  /** Per-lake-body level offset (metres) — the renderer bakes it into the lake surface. */
  lakeOffsetM(): Float32Array;
  /** Flood the ground around a named POI (the `summon_storm` effect): lay `depthM`
   *  metres of standing water over a `radius`-tile disc at the POI. Returns the number
   *  of cells flooded (0 if the POI is unknown). */
  floodPoi(poiId: string, radius: number, depthM: number): number;
  /** Clear all dynamic state back to the resting world. */
  reset(): void;
}
