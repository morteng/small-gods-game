// src/world/flood-watch.ts
//
// Water W-F — flood STATE as discrete, place-level events.
//
// `WaterDynamics.floodM` is a per-cell standing-water depth (W-E). Raw, it changes
// every frame and means nothing to a narrative layer. This module turns it into the
// thing Fate actually reacts to: "the granary is flooding," "the steppe has dried
// out" — edge events keyed to IMPORTANT PLACES (settlements, temples, farms…), fired
// once on the dry→flooded (and flooded→dry) transition, never per frame.
//
// Hysteresis (rise high, fall low) keeps a place from chattering when its water sits
// right at the line. Pure + deterministic: given the same flood field and the same
// poll order it emits the same events, so it travels unchanged into the deterministic
// sim in W-G and onto the command bus / Fate in W-H.

/** A place worth watching — its footprint as a flat list of cell indices. */
export interface WatchedPlace {
  id: string;
  name: string;
  /** Row-major cell indices the place occupies (its footprint + a little apron). */
  cells: Int32Array;
}

/** What happened to a watched place this poll. */
export interface FloodEvent {
  placeId: string;
  name: string;
  /** `flooded` = crossed into standing water; `receded` = dried back out. */
  type: 'flooded' | 'receded';
  /** Peak standing-water depth over the footprint at the moment of the edge (m). */
  depthM: number;
  /** Fraction (0..1) of the footprint cells under water at the edge. */
  coverage: number;
}

/** Depth (m) a place's peak must exceed to count as FLOODING (rise threshold). */
const FLOOD_ON_M = 0.3;
/** Depth (m) a place's peak must fall below to count as RECEDED (fall threshold). */
const FLOOD_OFF_M = 0.08;

/**
 * Tracks the flood state of a fixed set of places and reports the transitions.
 * `poll()` is the whole API: hand it the current per-cell flood field, get back the
 * places that just flooded or just dried since the previous poll.
 */
export class FloodWatch {
  private readonly places: WatchedPlace[];
  /** Per-place latched flood state (true = currently considered flooded). */
  private readonly flooded: boolean[];

  constructor(places: WatchedPlace[]) {
    this.places = places;
    this.flooded = places.map(() => false);
  }

  get placeCount(): number { return this.places.length; }

  /** Reset all latched state (a fresh world, or after a drain). */
  reset(): void { this.flooded.fill(false); }

  /**
   * Compare the flood field against each place's latched state and emit edges.
   * Updates the latch, so each transition fires exactly once. Cheap — it touches
   * only the watched footprints, not the whole grid.
   */
  poll(floodM: Float32Array): FloodEvent[] {
    const events: FloodEvent[] = [];
    for (let p = 0; p < this.places.length; p++) {
      const place = this.places[p];
      const cells = place.cells;
      let peak = 0;
      let wetCells = 0;
      for (let k = 0; k < cells.length; k++) {
        const d = floodM[cells[k]];
        if (d > peak) peak = d;
        if (d > FLOOD_OFF_M) wetCells++;
      }
      const coverage = cells.length > 0 ? wetCells / cells.length : 0;
      const wasFlooded = this.flooded[p];
      if (!wasFlooded && peak >= FLOOD_ON_M) {
        this.flooded[p] = true;
        events.push({ placeId: place.id, name: place.name, type: 'flooded', depthM: peak, coverage });
      } else if (wasFlooded && peak < FLOOD_OFF_M) {
        this.flooded[p] = false;
        events.push({ placeId: place.id, name: place.name, type: 'receded', depthM: peak, coverage });
      }
    }
    return events;
  }

  /** Ids of the places currently latched as flooded — a snapshot for queries/UI. */
  floodedPlaceIds(): string[] {
    const out: string[] = [];
    for (let p = 0; p < this.places.length; p++) if (this.flooded[p]) out.push(this.places[p].id);
    return out;
  }
}

/** A place to watch, before its footprint cells are resolved. */
export interface PlaceSpec {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Footprint half-extent in tiles (a disc of this radius around x,y). */
  radius?: number;
}

/**
 * Build a `FloodWatch` from a list of placed sites. Each site's footprint is a disc
 * of `radius` tiles (default 3) clamped to the map — enough to catch the water
 * arriving at a settlement without demanding exact building geometry (that refinement
 * can swap in a real footprint later without changing the event contract).
 */
export function buildFloodWatch(
  specs: PlaceSpec[], width: number, height: number,
): FloodWatch {
  const places: WatchedPlace[] = [];
  for (const s of specs) {
    const r = Math.max(0, Math.round(s.radius ?? 3));
    const cx = Math.round(s.x), cy = Math.round(s.y);
    const r2 = r * r;
    const cells: number[] = [];
    for (let dy = -r; dy <= r; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const nx = cx + dx;
        if (nx < 0 || nx >= width) continue;
        cells.push(ny * width + nx);
      }
    }
    if (cells.length > 0) places.push({ id: s.id, name: s.name, cells: Int32Array.from(cells) });
  }
  return new FloodWatch(places);
}
