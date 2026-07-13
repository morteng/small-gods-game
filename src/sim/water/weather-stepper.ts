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

/** The serializable physical state of the water/atmosphere fields. Tunable params
 *  are NOT here — they are exogenous config re-applied by the game, like the command
 *  queue / surfaced inbox; only DERIVED sim state is snapshotted.
 *
 *  The PER-CELL fields are typed-array copies, NOT plain number[] (profiled
 *  2026-07-13): `Array.from` on four ~171k-cell Float32Arrays boxed ~700k numbers
 *  per capture — and captures are FREQUENT (every autosave AND every 50-event
 *  timeline snapshot, which tile-realization storms fire in bursts). A .slice()
 *  memcpy + structured clone of a typed array is near-free; nothing JSON-serializes
 *  a Snapshot (verified — only WorldSeed goes through JSON). `number[]` stays
 *  accepted for hydration compat with older captures/stubs. */
export interface WeatherSnapshot {
  /** Per-lake-body level offset (metres), indexed by render lake body (tiny). */
  bodyOffsetM: number[];
  /** Per-cell standing-water depth (metres above terrain), row-major. */
  floodM: Float32Array | number[];
  /** Per-cell air humidity 0..1, row-major. */
  humidity: Float32Array | number[];
  /** Per-cell cloud water 0..1, row-major. */
  cloud: Float32Array | number[];
  /** Per-cell live air temperature 0..1, row-major. */
  temp: Float32Array | number[];
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
  /** Any standing flood water anywhere? O(1) (maintained incrementally by the stepper).
   *  The render path MUST check this before handing `floodOffsetM()` to the frame:
   *  the flood array is per-cell (~171k floats on the default world), and the
   *  renderer's activity scan over an all-zero array cost 4–7 ms EVERY frame at a
   *  steady camera (profiled 2026-07-13) — the array should never reach the frame
   *  when there is no flood. */
  hasFlood(): boolean;
  /** Per-lake-body level offset (metres) — the renderer bakes it into the lake surface. */
  lakeOffsetM(): Float32Array;
  /** Flood the ground around a named POI (the `summon_storm` effect): lay `depthM`
   *  metres of standing water over a `radius`-tile disc at the POI. Returns the number
   *  of cells flooded (0 if the POI is unknown). */
  floodPoi(poiId: string, radius: number, depthM: number): number;
  /** Clear all dynamic state back to the resting world. */
  reset(): void;
}
