// src/world/causal-site.ts
//
// Water W-I-a — CAUSAL SITES: ephemeral, event-born places.
//
// A causal site is a place the WORLD produces rather than worldgen authors: a god
// floods an empty plain (W-E/W-H) and the standing water becomes "The Drowned Reach"
// — a transient site with a footprint, a cause, and a lifetime. It fills the gap the
// flood loop left open: a flood on a settlement is caught by `FloodWatch` (→
// `place_flooded`, a real poiId), but a flood on EMPTY land produced nothing
// addressable — no id, no focus target, no Fate subject. This store is that catcher.
//
// It deliberately is NOT a `WorldSeed.POI` (those are immutable + authored). It is a
// parallel store whose ids (`causal:flood:NNNN`) are poiId-compatible strings, so the
// rest of the game can treat a causal site as a place for the three things that matter
// — identity, focus (W-I-d), and Fate addressing (W-I-b) — without a schema change.
//
// Determinism + layering: pure data, no render import, no `Math.random`. Ids come from
// a monotonic counter (deterministic by call order); blob detection + matching scan in
// fixed row-major / id order. `serialize`/`hydrate` put the live sites into the
// snapshot (the W-G pattern) so scrub / commit / replay reproduce them exactly.

/** What kind of event bore this site (drives naming, decay, belief flavour). */
export type CausalKind = 'flood' | 'scorch' | 'battlefield' | 'miracle_mark';

/** A live, ephemeral place born from a sim event. */
export interface CausalSite {
  /** Globally-unique, poiId-compatible id, e.g. `causal:flood:0007`. */
  id: string;
  kind: CausalKind;
  /** Generated display name, e.g. "The Drowned Reach of Ironvein". */
  name: string;
  /** Centroid tile at birth (a stable anchor for focus + Fate prose). */
  pos: { x: number; y: number };
  /** Frozen footprint — the wet blob at birth, row-major cell indices. */
  cells: Int32Array;
  /** Tick the site was born. */
  bornTick: number;
  /** Ticks of being un-sustained (cause drained) before the site dies. */
  lifeTicks: number;
  /** How long the cause has been gone (0 while the flood still covers the footprint). */
  ageTicks: number;
  /** Current strength 0..1 (flood depth normalized); decays as the site fades. */
  intensity: number;
  /** Attribution: the spirit id credited, or 'nature'. */
  cause: string;
}

/** Plain, JSON/structured-clone-friendly form for the snapshot. */
export interface SerializedCausalSite {
  id: string;
  kind: CausalKind;
  name: string;
  x: number;
  y: number;
  cells: number[];
  bornTick: number;
  lifeTicks: number;
  ageTicks: number;
  intensity: number;
  cause: string;
}

/** Snapshot of the whole store — live sites + the id counter (so re-births don't
 *  collide with sites captured at this tick). Construction config (exclusion mask,
 *  landmarks, dims) is re-injected by the game, not snapshotted — only derived state. */
export interface CausalSiteSnapshot {
  sites: SerializedCausalSite[];
  nextId: number;
}

/** A named landmark used only to flavour site names ("…of Ironvein"). */
export interface Landmark { name: string; x: number; y: number; }

/** Depth (m) a blob's peak must reach to BIRTH a site (matches FloodWatch rise). */
const BIRTH_DEPTH_M = 0.3;
/** Depth (m) a cell counts as wet for blob detection + sustain (matches FloodWatch fall). */
const WET_DEPTH_M = 0.08;
/** Smallest blob (cells) worth naming — keeps puddles from spawning sites. */
const MIN_SITE_CELLS = 12;
/** Ticks from the cause draining to the site dying (at 1 Hz weather tick → seconds). */
const FADE_TICKS = 30;
/** Depth (m) mapped to intensity 1.0 (a deep god-storm flood). */
const FULL_DEPTH_M = 2;
/** Within this tile distance, a landmark lends the site its name. */
const NAME_NEAR_TILES = 24;

const KIND_PHRASE: Record<CausalKind, string> = {
  flood: 'The Drowned Reach',
  scorch: 'The Scorched Waste',
  battlefield: 'The Bloodied Field',
  miracle_mark: 'The Hallowed Ground',
};

interface Blob { cells: number[]; peak: number; cx: number; cy: number; }

/**
 * Tracks the causal sites a world's water (and later: fire, battle) gives rise to.
 * `update()` is the whole sim API: hand it the current per-cell flood field + tick,
 * get back the sites that were just born / just faded so the caller can log events
 * and seed belief.
 */
export class CausalSiteStore {
  private readonly width: number;
  private readonly height: number;
  /** Cells covered by authored POIs — floods here are FloodWatch's job, not ours. */
  private readonly exclude: Set<number>;
  private readonly landmarks: Landmark[];
  private sites: CausalSite[] = [];
  private nextId = 0;

  constructor(width: number, height: number, excludeCells: Set<number>, landmarks: Landmark[] = []) {
    this.width = width;
    this.height = height;
    this.exclude = excludeCells;
    this.landmarks = landmarks;
  }

  /** Live sites, in birth order (deterministic). */
  active(): readonly CausalSite[] { return this.sites; }

  byId(id: string): CausalSite | undefined { return this.sites.find(s => s.id === id); }

  /** Is `(x,y)` inside any live site's footprint? Returns the site id, or null.
   *  Used by focus hit-testing (W-I-d). */
  siteAt(x: number, y: number): string | null {
    const idx = (y | 0) * this.width + (x | 0);
    for (const s of this.sites) {
      for (let k = 0; k < s.cells.length; k++) if (s.cells[k] === idx) return s.id;
    }
    return null;
  }

  /** Clear all sites (fresh world / full drain). */
  reset(): void { this.sites = []; this.nextId = 0; }

  /**
   * Reconcile the live sites against the current flood field for one sim tick.
   * Births sites for fresh flood blobs on un-watched land, renews sites whose flood
   * persists, ages + kills sites whose flood has drained. Pure function of the field
   * + the prior site set + the tick, so it replays identically.
   */
  update(floodM: Float32Array, tick: number, cause: string): { born: CausalSite[]; faded: CausalSite[] } {
    const blobs = this.findBlobs(floodM);

    // Map every live-site footprint cell → its site id, so a blob can claim the site
    // it overlaps (deterministic: first site by birth order wins an overlap).
    const cellOwner = new Map<number, string>();
    for (const s of this.sites) {
      for (let k = 0; k < s.cells.length; k++) {
        if (!cellOwner.has(s.cells[k])) cellOwner.set(s.cells[k], s.id);
      }
    }

    const sustained = new Set<string>();
    const born: CausalSite[] = [];
    for (const b of blobs) {
      // Which existing site (if any) does this blob renew? Scan cells in index order.
      let ownerId: string | null = null;
      for (const c of b.cells) {
        const o = cellOwner.get(c);
        if (o !== undefined) { ownerId = o; break; }
      }
      if (ownerId) {
        const s = this.byId(ownerId)!;
        s.ageTicks = 0;                              // cause still present → renew
        s.intensity = Math.min(1, b.peak / FULL_DEPTH_M);
        sustained.add(ownerId);
      } else if (b.peak >= BIRTH_DEPTH_M && b.cells.length >= MIN_SITE_CELLS) {
        born.push(this.birth(b, tick, cause));
      }
    }

    // Age + reap sites whose flood didn't renew them this tick.
    const faded: CausalSite[] = [];
    const survivors: CausalSite[] = [];
    for (const s of this.sites) {
      if (sustained.has(s.id) || born.includes(s)) { survivors.push(s); continue; }
      s.ageTicks++;
      const remaining = s.lifeTicks - s.ageTicks;
      s.intensity = remaining > 0 ? s.intensity * (remaining / (remaining + 1)) : 0;
      if (s.ageTicks >= s.lifeTicks) faded.push(s);
      else survivors.push(s);
    }
    this.sites = survivors;
    return { born, faded };
  }

  // --- internals ---------------------------------------------------------------

  private birth(b: Blob, tick: number, cause: string): CausalSite {
    const id = `causal:flood:${String(this.nextId++).padStart(4, '0')}`;
    const site: CausalSite = {
      id,
      kind: 'flood',
      name: this.nameFor('flood', b.cx, b.cy),
      pos: { x: b.cx, y: b.cy },
      cells: Int32Array.from(b.cells),
      bornTick: tick,
      lifeTicks: FADE_TICKS,
      ageTicks: 0,
      intensity: Math.min(1, b.peak / FULL_DEPTH_M),
      cause,
    };
    this.sites.push(site);
    return site;
  }

  /** Connected wet blobs (4-conn) over land NOT covered by an authored POI. */
  private findBlobs(floodM: Float32Array): Blob[] {
    const { width, height } = this;
    const n = width * height;
    const seen = new Uint8Array(n);
    const blobs: Blob[] = [];
    const stack: number[] = [];
    for (let start = 0; start < n; start++) {
      if (seen[start]) continue;
      if (floodM[start] < WET_DEPTH_M || this.exclude.has(start)) { seen[start] = 1; continue; }
      // Flood-fill this component.
      stack.length = 0;
      stack.push(start);
      seen[start] = 1;
      const cells: number[] = [];
      let peak = 0, sx = 0, sy = 0;
      while (stack.length) {
        const c = stack.pop()!;
        const d = floodM[c];
        cells.push(c);
        if (d > peak) peak = d;
        const cx = c % width, cy = (c / width) | 0;
        sx += cx; sy += cy;
        // 4 neighbours
        if (cx > 0) this.tryPush(c - 1, floodM, seen, stack);
        if (cx < width - 1) this.tryPush(c + 1, floodM, seen, stack);
        if (cy > 0) this.tryPush(c - width, floodM, seen, stack);
        if (cy < height - 1) this.tryPush(c + width, floodM, seen, stack);
      }
      cells.sort((a, z) => a - z);  // stable footprint order
      blobs.push({ cells, peak, cx: Math.round(sx / cells.length), cy: Math.round(sy / cells.length) });
    }
    return blobs;
  }

  private tryPush(c: number, floodM: Float32Array, seen: Uint8Array, stack: number[]): void {
    if (seen[c]) return;
    seen[c] = 1;
    if (floodM[c] < WET_DEPTH_M || this.exclude.has(c)) return;
    stack.push(c);
  }

  private nameFor(kind: CausalKind, x: number, y: number): string {
    const phrase = KIND_PHRASE[kind];
    let best: Landmark | null = null;
    let bestD = NAME_NEAR_TILES * NAME_NEAR_TILES;
    for (const lm of this.landmarks) {
      const dx = lm.x - x, dy = lm.y - y;
      const d = dx * dx + dy * dy;
      if (d <= bestD) { bestD = d; best = lm; }
    }
    return best ? `${phrase} of ${best.name}` : `${phrase} at ${x},${y}`;
  }

  // --- snapshot ----------------------------------------------------------------

  serialize(): CausalSiteSnapshot {
    return {
      nextId: this.nextId,
      sites: this.sites.map(s => ({
        id: s.id, kind: s.kind, name: s.name, x: s.pos.x, y: s.pos.y,
        cells: Array.from(s.cells), bornTick: s.bornTick, lifeTicks: s.lifeTicks,
        ageTicks: s.ageTicks, intensity: s.intensity, cause: s.cause,
      })),
    };
  }

  hydrate(snap: CausalSiteSnapshot): void {
    this.nextId = snap.nextId ?? 0;
    this.sites = (snap.sites ?? []).map(s => ({
      id: s.id, kind: s.kind, name: s.name, pos: { x: s.x, y: s.y },
      cells: Int32Array.from(s.cells), bornTick: s.bornTick, lifeTicks: s.lifeTicks,
      ageTicks: s.ageTicks, intensity: s.intensity, cause: s.cause,
    }));
  }
}
