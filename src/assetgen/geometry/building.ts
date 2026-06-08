// src/assetgen/geometry/building.ts
//
// The parametric building contract. Every knob here is overrideable by an authoring
// agent (LLM producer / Fate); anything left unset falls back to a deterministic,
// seed-varied default so a bare `{ wings }` still renders a complete building.
export type RoofKind = 'gable' | 'hip' | 'pyramidal' | 'flat';
export type RoofStyle = 'gable' | 'hip';
/** Which world axis a wing's roof ridge runs along. */
export type RidgeAxis = 'x' | 'y';

export interface Wing {
  x: number; y: number; w: number; h: number;
  storeys?: number;
  /** Per-wing roof override; falls back to the building-wide `roofStyle`. */
  roof?: RoofKind;
  /** Force the ridge orientation (a 4×2 longhouse can run its ridge N–S or E–W);
   *  defaults to the wing's LONG axis. */
  ridge?: RidgeAxis;
  /** Jetty: tiles each storey above the ground oversails the one below, toward the
   *  camera (the +x/+y street faces) — the classic jettied upper floor. Default 0. */
  jetty?: number;
}

export const STOREY = 2.1;                           // cube-units of height per storey

export function occupancy(wings: Wing[]): Set<string> {
  const s = new Set<string>();
  for (const w of wings) for (let i = w.x; i < w.x+w.w; i++) for (let j = w.y; j < w.y+w.h; j++) s.add(i+','+j);
  return s;
}

/** Ridge axis of a wing: explicit override, else its long axis (ties → x). */
export function ridgeAxisOf(w: Wing): RidgeAxis {
  return w.ridge ?? (w.w >= w.h ? 'x' : 'y');
}

// ── attachable features (door + smoke vents) ───────────────────────────────────────
// All four walls are addressable; only the +y ("south") and +x ("east") faces are
// camera-facing in the 2:1 view, so a door on 'north'/'west' is recorded (anchor +
// solid) but hidden behind the mass. The seeded default only ever picks a visible wall.
export type WallFace = 'north' | 'east' | 'south' | 'west';
export type VentKind = 'chimney' | 'smokehole' | 'pipe';
/** Where a vent sits: on the roof ridge (interior stack) or against an exterior wall. */
export type VentPlacement = 'ridge' | 'wall';

/**
 * A door on an exterior wall. A building can have several; mark one `main` and it
 * becomes the wide, tall entrance centred on its wall run. `cell` is optional —
 * omit it and the door snaps to the centre of the longest exterior run on `face`.
 */
export interface DoorFeature {
  face: WallFace;
  /** Explicit perimeter cell; omit to auto-place on the centre of `face`'s longest run. */
  cell?: [number, number];
  /** The main entrance: wide, tall, centred on its wall (implies `grand`). */
  main?: boolean;
  /** Sugar for a wider+taller opening. */
  grand?: boolean;
  /** Half-width along the wall (tiles). Default 0.30 (grand/main 0.42). */
  width?: number;
  /** Door height (height-units). Default 1.5 (grand/main 2.0). */
  height?: number;
}
/**
 * A smoke vent on a wing.
 *  - `placement:'ridge'` (default): rides the roof ridge at fraction `t` along it.
 *  - `placement:'wall'`: an exterior stack climbing the `face` wall at fraction `t`.
 *  `kind` selects the geometry: chimney = brick box, pipe = thin metal, smokehole = a
 *  low capped vent. `width`/`height` override the per-kind defaults.
 */
export interface VentFeature {
  wing: number;
  t: number;
  kind?: VentKind;
  placement?: VentPlacement;
  /** For `placement:'wall'`: which exterior wall the stack rides (default 'south'). */
  face?: WallFace;
  width?: number;
  height?: number;
}
/** Optional explicit features; omit any list to derive seeded defaults. */
export interface BuildingFeatures { doors?: DoorFeature[]; vents?: VentFeature[] }

/** A resolved door — every field concrete, ready for geometry. */
export interface ResolvedDoor { cell: [number, number]; face: WallFace; halfW: number; height: number; main: boolean }
export interface ResolvedFeatures { doors: ResolvedDoor[]; vents: VentFeature[] }

/** World-space anchor points (tile x,y; z up) for runtime overlays. */
export interface DoorAnchor { pos: [number, number, number]; main: boolean }
export interface BuildingAnchors { doors: DoorAnchor[]; vents: [number, number, number][] }

const occHas = (occ: Set<string>, i: number, j: number): boolean => occ.has(i + ',' + j);

/** Deterministic seed from a string (FNV-1a) — used to vary default placement. */
export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Index of the largest-area wing (where the chimney/main door go). */
export function mainWing(wings: Wing[]): number {
  return wings.reduce((bi, w, i, a) => (w.w * w.h) > (a[bi].w * a[bi].h) ? i : bi, 0);
}

/** The neighbour cell just OUTSIDE a given face of cell (i,j). */
const faceOutward: Record<WallFace, (i: number, j: number) => [number, number]> = {
  south: (i, j) => [i, j + 1], north: (i, j) => [i, j - 1],
  east: (i, j) => [i + 1, j], west: (i, j) => [i - 1, j],
};

/** Contiguous exterior wall runs on one face (cells whose `face` edge meets open space). */
function runsOnFace(occ: Set<string>, face: WallFace): [number, number][][] {
  const cells = [...occ].map((k) => k.split(',').map(Number) as [number, number]);
  const out = cells.filter(([i, j]) => !occHas(occ, ...faceOutward[face](i, j)));
  const alongI = face === 'south' || face === 'north';   // runs are contiguous in i (S/N) or j (E/W)
  const lanes = new Map<number, number[]>();             // fixed coord → varying coords
  for (const [i, j] of out) {
    const fixed = alongI ? j : i, vary = alongI ? i : j;
    (lanes.get(fixed) ?? lanes.set(fixed, []).get(fixed)!).push(vary);
  }
  const runs: [number, number][][] = [];
  for (const [fixed, varies] of lanes) {
    varies.sort((a, b) => a - b);
    let run: number[] = [];
    const flush = () => { if (run.length) runs.push(run.map((v) => (alongI ? [v, fixed] : [fixed, v]) as [number, number])); run = []; };
    for (const v of varies) { if (run.length && v !== run[run.length - 1] + 1) flush(); run.push(v); }
    flush();
  }
  return runs;
}

/** The wall-midpoint a door on (cell, face) occupies — used for spacing/separation. */
function doorThreshold([ci, cj]: [number, number], face: WallFace): [number, number] {
  switch (face) {
    case 'south': return [ci + 0.5, cj + 1];
    case 'north': return [ci + 0.5, cj];
    case 'east':  return [ci + 1, cj + 0.5];
    case 'west':  return [ci, cj + 0.5];
  }
}
const dist2 = (a: [number, number], b: [number, number]): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** Centre cell of the longest exterior run on `face`, if any. */
export function centerCellOnFace(occ: Set<string>, face: WallFace): [number, number] | undefined {
  const runs = runsOnFace(occ, face).sort((a, b) => b.length - a.length);
  return runs.length ? runs[0][Math.floor(runs[0].length / 2)] : undefined;
}

/** Camera-facing (south/east) runs scored by how forward + long they are — for default doors. */
function frontRuns(occ: Set<string>): { face: WallFace; cells: [number, number][]; score: number }[] {
  const scored: { face: WallFace; cells: [number, number][]; score: number }[] = [];
  for (const face of ['south', 'east'] as WallFace[]) {
    for (const cells of runsOnFace(occ, face)) {
      scored.push({ face, cells, score: cells.reduce((s, [i, j]) => s + i + j, 0) / cells.length + cells.length * 0.5 });
    }
  }
  return scored;
}

/** Minimum spacing (tiles) the ruleset keeps between two door thresholds. */
const MIN_DOOR_SEP = 1.6;

/**
 * Placement ruleset for a building's doors:
 *  - an explicit `cell` is always honoured (author override wins);
 *  - a MAIN door auto-places on the CENTRE of the longest run on its face;
 *  - a secondary door auto-places on the cell of its face that is FARTHEST from every
 *    already-placed door (so two doors never share a corner / crowd one wall);
 *  - mains resolve before secondaries so secondaries spread away from the main.
 * A secondary auto-door that cannot clear `MIN_DOOR_SEP` anywhere on its face is dropped.
 */
function placeDoors(occ: Set<string>, specs: DoorFeature[]): ResolvedDoor[] {
  const ordered = [...specs].sort((a, b) => Number(!!b.main) - Number(!!a.main));
  const placed: ResolvedDoor[] = [];
  const thresholds: [number, number][] = [];

  for (const d of ordered) {
    let cell: [number, number] | undefined;
    if (d.cell) {
      cell = d.cell;
    } else {
      const runs = runsOnFace(occ, d.face).sort((a, b) => b.length - a.length);
      const cells = runs.flat();
      if (!cells.length) continue;
      if (d.main || !thresholds.length) {
        cell = runs[0][Math.floor(runs[0].length / 2)];          // main → centre of longest run
      } else {
        let best = cells[0], bestSep = -1;                        // secondary → maximise separation
        for (const c of cells) {
          const sep = Math.min(...thresholds.map((t) => dist2(doorThreshold(c, d.face), t)));
          if (sep > bestSep) { bestSep = sep; best = c; }
        }
        if (bestSep < MIN_DOOR_SEP ** 2) continue;                 // nowhere far enough → drop it
        cell = best;
      }
    }
    const big = d.main || d.grand;
    placed.push({ cell, face: d.face, main: !!d.main, halfW: d.width ?? (big ? 0.42 : 0.30), height: d.height ?? (big ? 2.0 : 1.5) });
    thresholds.push(doorThreshold(cell, d.face));
  }
  return placed;
}

/**
 * Resolve a building's features: use explicit ones where given, else derive a
 * deterministic default — a single MAIN door centred on the most prominent
 * camera-facing wall run, one chimney partway along the main wing's ridge. `seed`
 * varies the default placement. Door placement obeys {@link placeDoors}' ruleset.
 */
export function resolveFeatures(wings: Wing[], features: BuildingFeatures = {}, seed = 0): ResolvedFeatures {
  const rng = mulberry32(seed >>> 0);
  const occ = occupancy(wings);

  let doorSpecs = features.doors;
  if (!doorSpecs) {
    const runs = frontRuns(occ).sort((a, b) => b.score - a.score);
    const top = runs.slice(0, Math.max(1, Math.min(3, runs.length)));
    const chosen = top.length ? top[Math.floor(rng() * top.length)] : undefined;
    doorSpecs = chosen ? [{ face: chosen.face, main: true }] : [];
  }
  const doors = placeDoors(occ, doorSpecs);

  const vents = features.vents ?? [{ wing: mainWing(wings), t: 0.28 + rng() * 0.2 }];
  return { doors, vents };
}
