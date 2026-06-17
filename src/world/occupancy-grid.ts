// src/world/occupancy-grid.ts
//
// S1 (connectome-world-layout) — the settlement-scale OCCUPANCY / CLAIM LAYER.
//
// Every settlement producer (internal roads, civic precincts, building footprints,
// croft/settlement barriers) used to deconflict against its own ad-hoc set of cells
// — `roadSet`, `civicSet`, registry occupancy, `tileBlockedByBuilding`. The spatial-
// invariant net (`tests/integration/settlement-spatial-invariants.test.ts`) proved
// those scattered checks agree today, but each new producer (the nucleated-village
// grammar S3, tofts/crofts S4, open fields S5) would have to re-derive the same
// notion of "is this cell taken, and by what?".
//
// This grid is that ONE spatial authority. A producer CLAIMS the cells it writes,
// tagged with what wrote them, and CONSULTS the grid before writing — deconfliction
// by construction rather than post-hoc filtering. It is settlement-local (one grid
// per `placeSettlement` call — see the spec's Open-question 5, recommend "local"),
// pure, and `Math.random`-free.
//
// Cell keys are the canonical `"x,y"` tile strings used everywhere else in worldgen.

/** What occupies a claimed cell. The kind is advisory metadata for consultation —
 *  a producer decides which kinds block it (a barrier ring GATES over 'building',
 *  a building placer treats any claim as taken). */
export type OccupantKind = 'road' | 'civic' | 'building' | 'barrier';

const key = (x: number, y: number): string => `${x},${y}`;

export class OccupancyGrid {
  /** "x,y" → the kind that claimed it. Last claim wins (a producer may upgrade a
   *  cell, e.g. road over reserved ground); callers that care order their claims. */
  private readonly cells = new Map<string, OccupantKind>();

  /** Claim a single cell. */
  claim(x: number, y: number, kind: OccupantKind): void {
    this.cells.set(key(x, y), kind);
  }

  /** Claim a w×h rectangle anchored at (x,y). */
  claimRect(x: number, y: number, w: number, h: number, kind: OccupantKind): void {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.cells.set(key(x + dx, y + dy), kind);
  }

  /** Claim a set of already-formatted `"x,y"` cell keys (e.g. a building's solid mask). */
  claimCells(cells: Iterable<string>, kind: OccupantKind): void {
    for (const c of cells) this.cells.set(c, kind);
  }

  /** The kind occupying (x,y), or undefined if free. */
  at(x: number, y: number): OccupantKind | undefined {
    return this.cells.get(key(x, y));
  }

  /** True when (x,y) carries any claim. */
  has(x: number, y: number): boolean {
    return this.cells.has(key(x, y));
  }

  /** True when (x,y) is claimed by exactly `kind`. */
  is(x: number, y: number, kind: OccupantKind): boolean {
    return this.cells.get(key(x, y)) === kind;
  }

  /** True when (x,y) carries no claim. */
  isFree(x: number, y: number): boolean {
    return !this.cells.has(key(x, y));
  }

  /** True when EVERY cell of the w×h rectangle at (x,y) is free. */
  isFreeRect(x: number, y: number, w: number, h: number): boolean {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (this.cells.has(key(x + dx, y + dy))) return false;
      }
    }
    return true;
  }

  /** Number of claimed cells (diagnostics/tests). */
  get size(): number {
    return this.cells.size;
  }
}

/**
 * The SOLID structure cells of a building placed at (ox,oy), as absolute `"x,y"`
 * keys: its compiled `blocked` mask minus passable door cells. This is the exact
 * notion of "inside the walls" the spatial-invariant net and `tileBlockedByBuilding`
 * use, so a 'building' claim from this helper gates barriers identically to the old
 * registry read.
 */
export function buildingSolidCells(
  collision: { blocked: string[]; doorCells: string[] },
  ox: number,
  oy: number,
): string[] {
  const doors = new Set(collision.doorCells);
  const out: string[] = [];
  for (const local of collision.blocked) {
    if (doors.has(local)) continue;          // passable doorway — not a solid wall
    const ci = local.indexOf(',');
    const lx = Number(local.slice(0, ci));
    const ly = Number(local.slice(ci + 1));
    out.push(key(ox + lx, oy + ly));
  }
  return out;
}
