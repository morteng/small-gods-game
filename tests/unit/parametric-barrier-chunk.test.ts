import { describe, it, expect } from 'vitest';
import { chunkBarrierRun, runElements } from '@/render/parametric-barrier-source';
import { BARRIER_DEFAULTS, type BarrierRun } from '@/world/barrier';

const wall = (path: [number, number][], gates = [] as { t: number; width: number }[]): BarrierRun =>
  ({ kind: 'wall', path, ...BARRIER_DEFAULTS.wall, gates });

const RING: [number, number][] = [[0, 0], [14, 0], [14, 10], [0, 10], [0, 0]];
const crenStoneRing = (gates = [] as { t: number; width: number }[]): BarrierRun =>
  ({ kind: 'wall', path: RING, height: 3, thickness: 2, material: 'stone', crenellated: true, gates });

describe('chunkBarrierRun', () => {
  it('splits a straight run into 2-tile cardinal pieces that cover the whole length', () => {
    // WP-W2: a canonical cardinal edge is cut into fixed 2-tile pieces (delta exactly [2,0]) —
    // a finite vocabulary, so identical pieces across worlds dedup to one composed sprite. The
    // 2-tile length also holds CHUNK_DEPTH_SPAN_MAX = 2 (each piece carries ONE midpoint key).
    const chunks = chunkBarrierRun(wall([[0, 0], [12, 0]]));
    expect(chunks.length).toBe(6);                       // 12 / 2
    expect(chunks[0].refX).toBe(0);
    expect(chunks[1].refX).toBeCloseTo(2);
    expect(chunks[2].refX).toBeCloseTo(4);
    // Each localised piece runs from its own origin along +x for exactly one cardinal piece.
    expect(chunks[0].localRun.path[0]).toEqual([0, 0]);
    expect(chunks[0].localRun.path[1]).toEqual([2, 0]);   // exact integer delta — no float noise
  });

  it('a diagonal wall is cut into √2 diagonal pieces that all share ONE key', () => {
    // Inverted by WP-W2: a canonical diagonal edge is cut into ONE-STEP (±1,±1) pieces of length
    // √2 (each holds |Δ(x+y)| ≤ 2), NOT full-length chunks. [[0,8],[8,0]] (bearing SE, length 8√2)
    // → 8 identical pieces, orientation-normalized to the NW bearing so they all share one key.
    const chunks = chunkBarrierRun(wall([[0, 8], [8, 0]]));
    expect(chunks.length).toBe(8);
    for (const c of chunks) {
      expect(Math.hypot(c.localRun.path[1][0], c.localRun.path[1][1])).toBeCloseTo(Math.SQRT2, 6);
    }
    expect(new Set(chunks.map((c) => c.key)).size).toBe(1);   // ALL one key
  });

  it('identical straight pieces share ONE cache key, matching the finite `piece:` grammar', () => {
    const chunks = chunkBarrierRun(wall([[0, 0], [16, 0]]));
    expect(chunks.length).toBe(8);                          // 16 / 2 cardinal pieces
    expect(new Set(chunks.map((c) => c.key)).size).toBe(1); // all pieces → same key
    for (const c of chunks) {
      expect(c.key).toMatch(/^piece:/);                    // finite grammar, not a JSON blob
      expect(c.key).not.toContain('{');
    }
  });

  it('breaks chunks at polyline vertices (a corner is never inside one chunk)', () => {
    const chunks = chunkBarrierRun(wall([[0, 0], [4, 0], [4, 4]]));
    // Two perpendicular legs → no chunk spans both; each chunk is axis-aligned.
    for (const c of chunks) {
      const [dx, dy] = c.localRun.path[1];
      expect(Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6).toBe(true);
    }
  });

  it('a real gate REPLACES whole curtain pieces with gate fragments on a slot boundary', () => {
    // WP-W2: the gate snaps to whole piece slots, and the piece(s) under its span become GATE
    // FRAGMENTS (role gate) instead of curtain — no boolean gate-clipping inside a curtain key.
    const ungated = chunkBarrierRun(wall([[0, 0], [12, 0]]));
    const gated = chunkBarrierRun(wall([[0, 0], [12, 0]], [{ t: 6, width: 2 }]));
    const gates = gated.filter((c) => c.localRun.gates.length > 0);
    expect(gates).toHaveLength(1);                              // exactly one gate piece (1 slot)
    expect(gates[0].key).toContain(':gate:');                  // role gate in the key
    // The gate piece sits on a piece boundary (its refX is an even tile = a slot boundary).
    expect(gates[0].refX % 2).toBeCloseTo(0, 6);
    // The curtain pieces are byte-identical to the ungated wall's (gates drop out of curtain keys).
    const curtainKeys = (cs: typeof gated) => cs.filter((c) => c.localRun.gates.length === 0).map((c) => c.key);
    expect(new Set(curtainKeys(gated))).toEqual(new Set(curtainKeys(ungated).slice(0, 1)));
    // No curtain piece survives under the gate span [5,7]: every piece there is a gate fragment.
    for (const c of gated) {
      const mid = c.sortX;
      if (mid > 5 && mid < 7) expect(c.localRun.gates.length).toBeGreaterThan(0);
    }
  });

  it('a croft-style odd cardinal side emits full pieces + one remainder piece', () => {
    // A 3-tile side = one full 2-tile piece + a 1-tile remainder (crofts keep sub-piece sides).
    const chunks = chunkBarrierRun(wall([[0, 0], [3, 0]]));
    expect(chunks).toHaveLength(2);
    const lens = chunks.map((c) => c.localRun.path[1][0]).sort((a, b) => a - b);
    expect(lens).toEqual([1, 2]);
    expect(chunks.some((c) => c.key.includes(':rem1:'))).toBe(true);   // the remainder piece
    expect(chunks.some((c) => c.key.includes(':full:'))).toBe(true);   // the full piece
  });

  it('a GAP opening DROPS the pieces under its span (no gate fragment, no curtain)', () => {
    const solid = chunkBarrierRun(wall([[0, 0], [12, 0]]));                       // 6 pieces
    const gap: BarrierRun = { kind: 'wall', path: [[0, 0], [12, 0]], ...BARRIER_DEFAULTS.wall, gates: [{ t: 6, width: 4, kind: 'gap' }] };
    const dropped = chunkBarrierRun(gap);
    expect(dropped.length).toBeLessThan(solid.length);               // the gap removed pieces
    expect(dropped.every((c) => c.localRun.gates.length === 0)).toBe(true);  // no gate fragments
    for (const c of dropped) expect(c.sortX > 4 && c.sortX < 8).toBe(false);  // none under the gap span
  });

  it('a degenerate run (one point) yields no chunks', () => {
    expect(chunkBarrierRun(wall([[3, 3]]))).toHaveLength(0);
  });

  it('a crenellated stone ring adds a flanking tower at every corner', () => {
    const chunks = chunkBarrierRun(crenStoneRing()).length;
    const elements = runElements(crenStoneRing()).length;
    // 4 rectangular corners → 4 extra tower elements over the curtain chunks.
    expect(elements).toBe(chunks + 4);
  });

  it('a gate adds a gatehouse (two flanking towers) + a timber gate leaf', () => {
    const ungated = runElements(crenStoneRing()).length;
    const gatedEls = runElements(crenStoneRing([{ t: 7, width: 3 }]));
    expect(gatedEls.length).toBe(ungated + 3);                                // 2 towers + 1 leaf
    expect(gatedEls.filter((e) => e.key.startsWith('gate:'))).toHaveLength(1);
  });

  it('a palisade gate gets a timber gate leaf but NO masonry towers', () => {
    const palisade = (gates = [] as { t: number; width: number }[]): BarrierRun =>
      ({ kind: 'palisade', path: [[0, 0], [10, 0]], ...BARRIER_DEFAULTS.palisade, gates });
    const els = runElements(palisade([{ t: 5, width: 3 }]));
    expect(els.filter((e) => e.key.startsWith('gate:'))).toHaveLength(1);     // closing gate
    expect(els.filter((e) => e.key.startsWith('tower:'))).toHaveLength(0);    // timber: no drums
  });

  it('a fence / hedge gate gets NO gate leaf (only defensive runs close)', () => {
    const fence: BarrierRun = { kind: 'fence', path: [[0, 0], [8, 0]], ...BARRIER_DEFAULTS.fence, gates: [{ t: 4, width: 2 }] };
    expect(runElements(fence).filter((e) => e.key.startsWith('gate:'))).toHaveLength(0);
  });

  it('corner towers are ROUND drums; gate towers are SQUARE (distinct cached geometry)', () => {
    const keys = runElements(crenStoneRing([{ t: 7, width: 3 }])).map((e) => e.key);
    expect(keys.some((k) => k.startsWith('tower:round:'))).toBe(true);   // 4 corner drums
    expect(keys.some((k) => k.startsWith('tower:gate:'))).toBe(true);    // 2 gatehouse towers
    // The two kinds compose separately (one cache entry each), not as one shared tower.
    expect(new Set(keys.filter((k) => k.startsWith('tower:'))).size).toBe(2);
  });

  it('non-masonry / uncrenellated runs get NO towers (curtain chunks only)', () => {
    const hedge: BarrierRun = { kind: 'hedge', path: RING, ...BARRIER_DEFAULTS.hedge, gates: [] };
    expect(runElements(hedge).length).toBe(chunkBarrierRun(hedge).length);
    const plainStone: BarrierRun = { kind: 'wall', path: RING, height: 1.3, thickness: 1, material: 'stone', crenellated: false, gates: [] };
    expect(runElements(plainStone).length).toBe(chunkBarrierRun(plainStone).length);
  });

  it('WP-S coverage towers WITH a bare corner get an extra coverage drum (render-side)', () => {
    // run.towers is coverage-sited by bowshot, not ring geometry, so a turning vertex can be left
    // uncovered — WP-W2 caps any such corner with an extra drum (same `tower:round:` vocabulary).
    const base = { kind: 'wall' as const, path: RING, height: 3, thickness: 2, material: 'stone', crenellated: true, centroid: [7, 5] as [number, number], gates: [] };
    // Cover 3 of the 4 corners; leave (0,10) bare.
    const covered: BarrierRun = { ...base, towers: [
      { x: 0, y: 0, role: 'salient' }, { x: 14, y: 0, role: 'salient' }, { x: 14, y: 10, role: 'salient' },
    ] };
    const towerEls = runElements(covered).filter((e) => e.key.startsWith('tower:'));
    // 3 committed + 1 coverage drum at the bare corner = 4 round drums.
    expect(towerEls).toHaveLength(4);
    expect(towerEls.every((e) => e.key.startsWith('tower:round:'))).toBe(true);
    const drumAtBareCorner = runElements(covered).find((e) => e.key.startsWith('tower:round:') && Math.hypot(e.refX - 0, e.refY - 10) < 1e-6);
    expect(drumAtBareCorner).toBeTruthy();
  });
});

describe('chunkBarrierRun — outward orientation (parapet must face the field)', () => {
  // A centred rectangular ring: every chunk should know which local-y is OUTWARD, and it must
  // point AWAY from the ring centre (so the crenellated parapet lands on the field edge).
  const ring: BarrierRun = { kind: 'wall', path: RING, height: 3, thickness: 2, material: 'stone', crenellated: true, centroid: [7, 5], gates: [] };

  it('assigns an outwardSign to every chunk of a ring with a centroid', () => {
    const chunks = chunkBarrierRun(ring);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) expect(Math.abs(c.localRun.outwardSign ?? 0)).toBe(1);
  });

  it('outwardSign points the local +y frame away from the ring centre on each side', () => {
    for (const c of chunkBarrierRun(ring)) {
      // Reconstruct the (possibly reversed/normalized) piece bearing from its localised path,
      // then the world dir of local +y. refX/refY is the piece's local origin (its far endpoint
      // when the edge was orientation-normalized), so the world midpoint is refX + dir*len/2.
      const [ldx, ldy] = c.localRun.path[1];
      const len = Math.hypot(ldx, ldy) || 1;
      const dx = ldx / len, dy = ldy / len;
      const sign = c.localRun.outwardSign ?? 0;
      expect(Math.abs(sign)).toBe(1);                     // every piece knows its outward side
      const ox = sign * -dy, oy = sign * dx;              // world vector of the OUTWARD normal
      const mx = c.refX + dx * (len / 2), my = c.refY + dy * (len / 2);   // world midpoint
      expect(ox * (mx - 7) + oy * (my - 5)).toBeGreaterThan(0);
    }
  });

  it('normalizes back-half bearings to the E/NE/N/NW half so the sprite set halves', () => {
    // Every piece's localised bearing must be one of the 4 forward octants (E,NE,N,NW): a
    // south/west edge is emitted reversed from its far endpoint (with outwardSign flipped).
    for (const c of chunkBarrierRun(ring)) {
      const [dx, dy] = c.localRun.path[1];
      const oct = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
      expect(oct).toBeLessThanOrEqual(3);
    }
  });

  it('leaves outwardSign undefined for an open run with no centroid (symmetric fallback)', () => {
    for (const c of chunkBarrierRun(wall([[0, 0], [12, 0]]))) {
      expect(c.localRun.outwardSign).toBeUndefined();
    }
  });
});

describe('runElements — mural stairs (one clean flight, not rubble stubs)', () => {
  it('a crenellated stone ring WITH a centroid + gate gets EXACTLY ONE stair (beside the main gate)', () => {
    // The old per-long-segment + per-gate flights placed ~8–14 tiny inward stubs that read as rubble
    // cairns at game zoom; D1 keeps a single readable coursed flight by the gate the player enters.
    const ring: BarrierRun = { kind: 'wall', path: RING, height: 3, thickness: 2, material: 'stone', crenellated: true, centroid: [7, 5], gates: [{ t: 7, width: 3 }] };
    const stairs = runElements(ring).filter((e) => e.key.startsWith('stair:'));
    expect(stairs).toHaveLength(1);
  });
  it('no stair on a gateless ring (nothing to key the single flight to)', () => {
    const gateless: BarrierRun = { kind: 'wall', path: RING, height: 3, thickness: 2, material: 'stone', crenellated: true, centroid: [7, 5], gates: [] };
    expect(runElements(gateless).some((e) => e.key.startsWith('stair:'))).toBe(false);
  });
  it('no stairs without a centroid (open run / unknown inside) or on a hedge', () => {
    const noCentroid: BarrierRun = { kind: 'wall', path: RING, height: 3, thickness: 2, material: 'stone', crenellated: true, gates: [] };
    expect(runElements(noCentroid).some((e) => e.key.startsWith('stair:'))).toBe(false);
  });
});

describe('runElements — assembly y-sort ordering (residual render-order fixes)', () => {
  const depth = (e: { sortX: number; sortY: number }): number => e.sortX + e.sortY;

  it('the gate LEAF sorts behind EVERY fragment of its own opening (door shows through the arch, never over the wall face)', () => {
    // Gate on the NORTH edge (y=0, runs +x) — an iso-depth-changing cardinal edge.
    const els = runElements(crenStoneRing([{ t: 7, width: 3 }]));
    const leaf = els.find((e) => e.key.startsWith('gate:'))!;
    const fragments = els.filter((e) => e.key.startsWith('piece:') && e.key.includes(':gate'));
    expect(leaf).toBeDefined();
    expect(fragments.length).toBeGreaterThan(0);
    for (const f of fragments) expect(depth(leaf)).toBeLessThan(depth(f));
  });

  it('the leaf bias also clears a DIAGONAL opening (fragments spread across iso depth)', () => {
    const run = wall([[0, 8], [8, 0]], [{ t: 4 * Math.SQRT2, width: 2 * Math.SQRT2 }]);
    (run as { height: number }).height = 3; (run as { material: string }).material = 'stone';
    const els = runElements(run);
    const leaf = els.find((e) => e.key.startsWith('gate:'))!;
    const fragments = els.filter((e) => e.key.startsWith('piece:') && e.key.includes(':gate'));
    expect(fragments.length).toBeGreaterThan(1);
    for (const f of fragments) expect(depth(leaf)).toBeLessThan(depth(f));
  });

  it('towers bias forward DIRECTIONALLY — near-side caps its joint, far-side never sorts over the wall behind it', () => {
    // A ring WITH a centroid → the directional path. Corners of RING relative to centroid
    // [7,5]: [14,10] is the CAMERA-NEAR corner (+x/+y), [0,0] is the FAR corner (−x/−y).
    const ring: BarrierRun = { kind: 'wall', path: RING, height: 3, thickness: 2, material: 'stone', crenellated: true, centroid: [7, 5], gates: [] };
    const towers = runElements(ring).filter((e) => e.key.startsWith('tower:'));
    expect(towers.length).toBeGreaterThan(0);
    // No tower ever biases BEHIND its anchor (that would let the near curtain slice it).
    for (const t of towers) {
      expect(t.sortX).toBeGreaterThanOrEqual(t.refX);
      expect(t.sortY).toBeGreaterThanOrEqual(t.refY);
    }
    // The near corner biases forward on BOTH axes (caps its joint); the far corner stays AT
    // its anchor (does NOT sort proud of the wall it stands behind — the pasted-on-drum fix).
    const near = towers.find((t) => t.refX === 14 && t.refY === 10)!;
    const far = towers.find((t) => t.refX === 0 && t.refY === 0)!;
    expect(near.sortX).toBeGreaterThan(near.refX);
    expect(near.sortY).toBeGreaterThan(near.refY);
    expect(far.sortX).toBe(far.refX);
    expect(far.sortY).toBe(far.refY);
  });
});
