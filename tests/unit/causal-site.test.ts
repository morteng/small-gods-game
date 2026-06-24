import { describe, it, expect } from 'vitest';
import { CausalSiteStore } from '@/world/causal-site';

const W = 40, H = 40;

/** A flood field that is `depth` m deep over a filled disc of `r` tiles at (cx,cy). */
function floodDisc(cx: number, cy: number, r: number, depth: number): Float32Array {
  const f = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) f[y * W + x] = depth;
    }
  }
  return f;
}

const DRY = new Float32Array(W * H);

describe('CausalSiteStore', () => {
  it('births a site for a deep flood blob on un-watched land', () => {
    const store = new CausalSiteStore(W, H, new Set(), []);
    const { born, faded } = store.update(floodDisc(20, 20, 5, 1.5), 100, 'player');
    expect(faded).toHaveLength(0);
    expect(born).toHaveLength(1);
    const s = born[0];
    expect(s.id).toBe('causal:flood:0000');
    expect(s.kind).toBe('flood');
    expect(s.bornTick).toBe(100);
    expect(s.cause).toBe('player');
    expect(s.intensity).toBeGreaterThan(0);
    // Centroid lands at the disc centre.
    expect(Math.abs(s.pos.x - 20)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.pos.y - 20)).toBeLessThanOrEqual(1);
    expect(store.active()).toHaveLength(1);
  });

  it('ignores a tiny puddle (below the min cell count)', () => {
    const store = new CausalSiteStore(W, H, new Set(), []);
    const { born } = store.update(floodDisc(20, 20, 1, 1.5), 0, 'player');  // ~5 cells < 12
    expect(born).toHaveLength(0);
    expect(store.active()).toHaveLength(0);
  });

  it('ignores a shallow flood (below the birth depth)', () => {
    const store = new CausalSiteStore(W, H, new Set(), []);
    const { born } = store.update(floodDisc(20, 20, 5, 0.2), 0, 'player');  // 0.2 < 0.3 birth
    expect(born).toHaveLength(0);
  });

  it('does not birth over watched (settlement) cells', () => {
    const exclude = new Set<number>();
    for (let y = 15; y < 26; y++) for (let x = 15; x < 26; x++) exclude.add(y * W + x);
    const store = new CausalSiteStore(W, H, exclude, []);
    const { born } = store.update(floodDisc(20, 20, 5, 1.5), 0, 'player');
    expect(born).toHaveLength(0);  // the whole disc sits inside the exclusion box
  });

  it('renews (does not re-birth) while the flood persists, then ages + fades when it drains', () => {
    const store = new CausalSiteStore(W, H, new Set(), []);
    const wet = floodDisc(20, 20, 5, 1.5);

    const t0 = store.update(wet, 0, 'player');
    expect(t0.born).toHaveLength(1);
    const id = t0.born[0].id;

    // Persisting flood → no new births, site stays young.
    for (let t = 1; t <= 5; t++) {
      const r = store.update(wet, t, 'player');
      expect(r.born).toHaveLength(0);
      expect(r.faded).toHaveLength(0);
    }
    expect(store.byId(id)!.ageTicks).toBe(0);
    expect(store.active()).toHaveLength(1);

    // Drain it. The site ages for FADE_TICKS (30) then fades exactly once.
    let fadedId: string | null = null;
    let intensityWhileFading = store.byId(id)!.intensity;
    for (let t = 6; t < 6 + 40 && !fadedId; t++) {
      const r = store.update(DRY, t, 'player');
      if (r.faded.length) fadedId = r.faded[0].id;
      else {
        // intensity decays monotonically toward 0 as it fades
        const cur = store.byId(id)!.intensity;
        expect(cur).toBeLessThanOrEqual(intensityWhileFading + 1e-9);
        intensityWhileFading = cur;
      }
    }
    expect(fadedId).toBe(id);
    expect(store.active()).toHaveLength(0);
    expect(store.byId(id)).toBeUndefined();
  });

  it('assigns monotonically increasing ids across separate births', () => {
    const store = new CausalSiteStore(W, H, new Set(), []);
    store.update(floodDisc(10, 10, 4, 1.5), 0, 'player');
    // A second, spatially separate flood blob on a later tick.
    const two = new Float32Array(W * H);
    const a = floodDisc(10, 10, 4, 1.5), b = floodDisc(30, 30, 4, 1.5);
    for (let i = 0; i < two.length; i++) two[i] = Math.max(a[i], b[i]);
    const r = store.update(two, 1, 'player');
    expect(r.born).toHaveLength(1);
    expect(r.born[0].id).toBe('causal:flood:0001');
  });

  it('names a site after the nearest landmark, falls back to coords when far', () => {
    const store = new CausalSiteStore(W, H, new Set(), [{ name: 'Ironvein', x: 22, y: 22 }]);
    const near = store.update(floodDisc(20, 20, 5, 1.5), 0, 'player').born[0];
    expect(near.name).toBe('The Drowned Reach of Ironvein');

    const far = new CausalSiteStore(W, H, new Set(), [{ name: 'Ironvein', x: 0, y: 0 }]);
    const s = far.update(floodDisc(35, 35, 4, 1.5), 0, 'player').born[0];
    expect(s.name).toMatch(/^The Drowned Reach at \d+,\d+$/);
  });

  it('siteAt hit-tests a live footprint', () => {
    const store = new CausalSiteStore(W, H, new Set(), []);
    const s = store.update(floodDisc(20, 20, 5, 1.5), 0, 'player').born[0];
    expect(store.siteAt(20, 20)).toBe(s.id);
    expect(store.siteAt(0, 0)).toBeNull();
  });

  it('round-trips through serialize / hydrate', () => {
    const store = new CausalSiteStore(W, H, new Set(), [{ name: 'Ironvein', x: 22, y: 22 }]);
    store.update(floodDisc(20, 20, 5, 1.5), 7, 'player');
    const snap = store.serialize();

    const restored = new CausalSiteStore(W, H, new Set(), []);
    restored.hydrate(snap);
    expect(restored.active()).toHaveLength(1);
    const a = store.active()[0], b = restored.active()[0];
    expect(b.id).toBe(a.id);
    expect(b.name).toBe(a.name);
    expect(b.bornTick).toBe(a.bornTick);
    expect(Array.from(b.cells)).toEqual(Array.from(a.cells));

    // The id counter survives, so the next birth doesn't collide with a restored site.
    const next = restored.update(floodDisc(30, 30, 4, 1.5), 8, 'player').born[0];
    expect(next.id).toBe('causal:flood:0001');
  });

  it('is deterministic: identical inputs → identical site ids + footprints', () => {
    const run = () => {
      const store = new CausalSiteStore(W, H, new Set(), []);
      const wet = floodDisc(18, 22, 5, 1.5);
      store.update(wet, 0, 'player');
      store.update(wet, 1, 'player');
      return store.serialize();
    };
    expect(run()).toEqual(run());
  });

  it('reset clears sites and the id counter', () => {
    const store = new CausalSiteStore(W, H, new Set(), []);
    store.update(floodDisc(20, 20, 5, 1.5), 0, 'player');
    store.reset();
    expect(store.active()).toHaveLength(0);
    const s = store.update(floodDisc(20, 20, 5, 1.5), 1, 'player').born[0];
    expect(s.id).toBe('causal:flood:0000');
  });
});
