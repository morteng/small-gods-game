/**
 * Emergent desire-line trample grid.
 *
 * NPC footfall accumulates on the tiles they cross; where enough traffic bundles,
 * soft ground wears down to a `dirt` trail (which the pathfinder then treats as
 * cheaper than grass, so subsequent traffic bundles onto the forming trail — the
 * Helbing active-walker feedback that makes desire lines a single shared path
 * instead of a smear). Trails fade back to their original ground when the traffic
 * that carved them stops.
 *
 * ONE mechanism, two entry points:
 *  - gen-time PREWARM (`settlement-wear.ts`) seeds the accumulator around authored
 *    roads/markets so a freshly-generated settlement already shows worn lanes;
 *  - runtime DEPOSIT (`systems/trample-system.ts`) feeds it from live NPC movement.
 *
 * Tuning follows the RimWorld "Desire Paths" numbers (proven shape): deposit a
 * fixed quantum per throttled agent-pass, promote above HI, geometric decay per
 * low-Hz pass, revert below LO. The HI/LO gap is the anti-flicker (hysteresis)
 * design — a tile hovering near the threshold does not oscillate dirt↔grass.
 *
 * Deterministic by construction: deposits come from deterministic movement and
 * the passes are pure integer arithmetic — no RNG (guard: no-random-in-sim).
 *
 * Opt-out is by terrain: only soft natural ground (`SOFT_GROUND`) ever trampls,
 * and a trail caps at `dirt` — it NEVER produces road-class tiles, so it can
 * never feed the road graph / roads-lead-to-gates lint contracts. Trails are
 * ground wear, not roads.
 */

import type { GameMap, Tile } from '@/core/types';
import { bumpTilesRev } from '@/core/tile-rev';

/** Tuning constants (RimWorld "Desire Paths" shape). */
export const TRAMPLE = {
  /** Wear added per throttled agent-pass over a tile. ~5 passes to promote.
   *  Round-8 visibility tuning: 12 → 24. At the live cadence (deposit 3 Hz, decay 0.25 Hz →
   *  12 deposit passes per decay pass, ×0.9 geometric decay) a cell crossed `k` times per
   *  decay period equilibrates at ≈ 9·D·k wear; D=12 needed k ≥ 1.11 crossings/period to hold
   *  PROMOTE_HI and the live world settled at ~a dozen promoted cells (round-5 note: "too
   *  subtle"). D=24 promotes at k ≥ 0.56 — the same desire lines, roughly twice the reach —
   *  measured in `tests/unit/trample-equilibrium.test.ts`. */
  DEPOSIT_AMOUNT: 24,
  /** Promote soft ground to `dirt` at/above this wear. */
  PROMOTE_HI: 120,
  /** Revert a trail to its original ground below this wear (HI-LO = hysteresis gap). */
  REVERT_LO: 80,
  /** Geometric decay applied per promote/decay pass. */
  DECAY_FACTOR: 0.9,
  /** Saturation cap — a trail can't deepen forever (Uint16 headroom, kept modest
   *  so an abandoned trail fades in a sane number of passes). */
  SATURATION_CAP: 255,
  /** Neighbour SPILL (RimWorld Desire Paths): each runtime deposit also drops this fraction
   *  into the 8 surrounding cells (eligible ground only), so a busy trunk trail widens to
   *  2–3 tiles organically while a side path walked single-file stays one tile wide. */
  SPILL_FACTOR: 0.2,
} as const;

/**
 * Biome ground soft enough to trample to `dirt`. Everything else — roads, bridges,
 * water, stone/mountain, farmland, building footprints (`walkable === false`),
 * and already-`dirt` trails — is opt-out by construction.
 */
export const SOFT_GROUND: ReadonlySet<string> = new Set([
  'grass', 'scrubland', 'hills', 'glen', 'sacred_grove', 'meadow',
]);

/** True when a tile is natural soft ground a trail may wear down. */
export function isTrampleEligible(tile: Tile | undefined): boolean {
  if (!tile) return false;
  if (tile.walkable === false) return false; // footprints / blocked cells
  return SOFT_GROUND.has(tile.type);
}

/** Serialized form — sparse (only touched cells), so snapshots stay cheap. */
export interface TrampleSnapshot {
  width: number;
  height: number;
  /** [flatIndex, wear] for every cell with non-zero accumulated wear. */
  cells: [number, number][];
  /** [flatIndex, originalTileType] for every cell currently promoted to dirt. */
  promoted: [number, string][];
}

export class TrampleGrid {
  readonly width: number;
  readonly height: number;
  /** Sparse accumulator: flatIndex → wear (Uint16 semantics, 0..cap). A cell is
   *  "active" iff it appears here; cleared to 0 ⇒ removed. */
  private readonly accum = new Map<number, number>();
  /** flatIndex → the tile type this cell was BEFORE it was promoted to dirt.
   *  Keys are always a subset of `accum` keys (a promoted cell retains wear). */
  private readonly promoted = new Map<number, string>();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  private idx(x: number, y: number): number {
    return y * this.width + x;
  }

  /** Current accumulated wear at a tile (0 when untouched). */
  wearAt(x: number, y: number): number {
    return this.accum.get(this.idx(x, y)) ?? 0;
  }

  /** True when this tile is currently a promoted trail (`dirt`). */
  isPromoted(x: number, y: number): boolean {
    return this.promoted.has(this.idx(x, y));
  }

  /** Number of cells currently carrying wear (for tests / diagnostics). */
  activeCount(): number {
    return this.accum.size;
  }

  /**
   * Add wear at a tile (footfall or prewarm seed). Saturates at the cap so a
   * trail can never deepen without bound.
   */
  deposit(x: number, y: number, amount: number = TRAMPLE.DEPOSIT_AMOUNT): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = this.idx(x, y);
    const next = Math.min(TRAMPLE.SATURATION_CAP, (this.accum.get(i) ?? 0) + amount);
    this.accum.set(i, next);
  }

  /**
   * Runtime footfall deposit WITH 8-neighbour spill (RimWorld Desire Paths): the full quantum
   * lands on the walked tile, and `SPILL_FACTOR` of it bleeds into each surrounding cell that is
   * itself trample-eligible (soft ground, or an already-promoted trail it helps sustain). A busy
   * trunk route's flanking cells then cross PROMOTE_HI from spill alone and the trail widens to
   * 2–3 tiles, while a side path walked single-file never spills enough to widen — trail WIDTH
   * from traffic volume. Opt-out terrains (roads, water, farmland, footprints) never take spill,
   * so a trail can't bleed across a field boundary. Deterministic (pure integer arithmetic).
   */
  depositWithSpill(map: GameMap, x: number, y: number, amount: number = TRAMPLE.DEPOSIT_AMOUNT): void {
    this.deposit(x, y, amount);
    const spill = Math.round(amount * TRAMPLE.SPILL_FACTOR);
    if (spill <= 0) return;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (isTrampleEligible(map.tiles[ny]?.[nx]) || this.isPromoted(nx, ny)) this.deposit(nx, ny, spill);
      }
    }
  }

  /**
   * The low-Hz promote/decay pass. For every active cell: promote eligible soft
   * ground that has reached HI to `dirt` (recording its original type), revert a
   * trail that has decayed below LO, then apply geometric decay. Iterates only
   * active cells — never the whole grid.
   */
  promoteDecay(map: GameMap): void {
    let changed = false;
    // Snapshot keys first: the pass mutates `accum` (delete on decay-to-zero).
    for (const i of Array.from(this.accum.keys())) {
      const wear = this.accum.get(i)!;
      const x = i % this.width;
      const y = (i - x) / this.width;
      const tile = map.tiles[y]?.[x];

      const isDirt = this.promoted.has(i);
      if (!isDirt && wear >= TRAMPLE.PROMOTE_HI && isTrampleEligible(tile)) {
        this.promoted.set(i, tile!.type);
        tile!.type = 'dirt';
        tile!.walkable = true;
        changed = true;
      } else if (isDirt && wear < TRAMPLE.REVERT_LO) {
        this.revertCell(i, map);
        changed = true;
      }

      const decayed = Math.floor(wear * TRAMPLE.DECAY_FACTOR);
      if (decayed <= 0 && !this.promoted.has(i)) {
        this.accum.delete(i);
      } else {
        this.accum.set(i, decayed);
      }
    }
    if (changed) bumpTilesRev(map);
  }

  /**
   * PREWARM realise pass: promote every eligible cell already at/above HI to
   * `dirt`, without decaying. Used once at gen-time after the settlement wear
   * seed so the generated world already shows worn lanes while the seeded wear
   * stays primed for runtime traffic to continue from.
   */
  settle(map: GameMap): void {
    let changed = false;
    for (const [i, wear] of this.accum) {
      if (this.promoted.has(i) || wear < TRAMPLE.PROMOTE_HI) continue;
      const x = i % this.width;
      const y = (i - x) / this.width;
      const tile = map.tiles[y]?.[x];
      if (!isTrampleEligible(tile)) continue;
      this.promoted.set(i, tile!.type);
      tile!.type = 'dirt';
      tile!.walkable = true;
      changed = true;
    }
    if (changed) bumpTilesRev(map);
  }

  /** Revert one promoted cell's tile back to its stored original ground. */
  private revertCell(i: number, map: GameMap): void {
    const orig = this.promoted.get(i);
    if (orig === undefined) return;
    const x = i % this.width;
    const y = (i - x) / this.width;
    const tile = map.tiles[y]?.[x];
    if (tile && (tile.type === 'dirt' || isTrampleEligible(tile))) {
      tile.type = orig;
      tile.walkable = true;
    }
    this.promoted.delete(i);
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  serialize(): TrampleSnapshot {
    return {
      width: this.width,
      height: this.height,
      cells: Array.from(this.accum.entries()),
      promoted: Array.from(this.promoted.entries()),
    };
  }

  /** Replace this grid's contents with a serialized snapshot (authoritative). */
  hydrate(snap: TrampleSnapshot): void {
    this.accum.clear();
    this.promoted.clear();
    for (const [i, w] of snap.cells) this.accum.set(i, w);
    for (const [i, orig] of snap.promoted) this.promoted.set(i, orig);
  }

  static fromSnapshot(snap: TrampleSnapshot): TrampleGrid {
    const g = new TrampleGrid(snap.width, snap.height);
    g.hydrate(snap);
    return g;
  }

  /**
   * Reconcile map tiles to THIS grid's promoted set after a snapshot restore
   * (scrub / save-load). Because tile mutations happen in place (the map is not
   * part of the entity snapshot — the same reason `reconcileSettlementTiles`
   * exists), a scrub-back must undo trail dirt carved after the restore point.
   *
   * `prev` is the grid state that was live BEFORE this restore (its `promoted`
   * records the original ground for any tile it trampled); pass it so cells it
   * promoted but this grid did not can be reverted to their real ground.
   */
  reconcileTiles(map: GameMap, prev?: TrampleGrid | null): void {
    let changed = false;
    // Undo trails the previous grid carved that this one doesn't have.
    if (prev) {
      for (const [i, orig] of prev.promoted) {
        if (this.promoted.has(i)) continue;
        const x = i % this.width;
        const y = (i - x) / this.width;
        const tile = map.tiles[y]?.[x];
        if (tile && tile.type === 'dirt') {
          tile.type = orig;
          tile.walkable = true;
          changed = true;
        }
      }
    }
    // Re-assert this grid's trails as dirt (no-op when the loaded map already
    // holds them; guarded so a since-built footprint/road isn't clobbered).
    for (const i of this.promoted.keys()) {
      const x = i % this.width;
      const y = (i - x) / this.width;
      const tile = map.tiles[y]?.[x];
      if (tile && (tile.type === 'dirt' || isTrampleEligible(tile))) {
        if (tile.type !== 'dirt') changed = true;
        tile.type = 'dirt';
        tile.walkable = true;
      }
    }
    if (changed) bumpTilesRev(map);
  }
}
