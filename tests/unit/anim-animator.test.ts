import { describe, expect, it } from 'vitest';
import { Animator } from '@/render/anim/animator';
import type { Clip, ClipLayer } from '@/render/paperdoll/rig';

const clip = (name: string): Clip => ({ name, frames: 2, tracks: {} }) as Clip;

const CLIP_A = clip('walk');
const CLIP_B = clip('run');
const CLIP_C = clip('sprint');
const CLIP_WAVE = clip('wave');

describe('Animator gait loop + rate', () => {
  it('samples t at 0 / half / full(wraps) / 1.5x duration', () => {
    const a = new Animator();
    a.setGait(CLIP_A, 1000, 0);
    expect(a.update(0)[0].t).toBeCloseTo(0);
    expect(a.update(500)[0].t).toBeCloseTo(0.5);
    expect(a.update(1000)[0].t).toBeCloseTo(0);
    expect(a.update(1500)[0].t).toBeCloseTo(0.5);
  });

  it('rate doubles phase speed', () => {
    const a = new Animator();
    a.setGait(CLIP_A, 1000, 0, { rate: 2 });
    expect(a.update(250)[0].t).toBeCloseTo(0.5);
    expect(a.update(500)[0].t).toBeCloseTo(0);
  });

  it('changing rate mid-loop (same clip) keeps t continuous at the change moment', () => {
    const a = new Animator();
    a.setGait(CLIP_A, 1000, 0);
    const tBefore = a.update(300)[0].t; // 0.3
    expect(tBefore).toBeCloseTo(0.3);
    a.setGait(CLIP_A, 1000, 300, { rate: 2 });
    const tAt = a.update(300)[0];
    expect(tAt.t).toBeCloseTo(0.3);
    // now advancing 100ms at rate 2 over a 1000ms duration => +0.2
    expect(a.update(400)[0].t).toBeCloseTo(0.5);
  });
});

describe('Animator gait crossfade', () => {
  it('setGait A then B at X: mid-fade both present, weight ~0.5 at X+fadeMs/2, only B after fade', () => {
    const a = new Animator({ fadeMs: 100 });
    a.setGait(CLIP_A, 1000, 0);
    a.setGait(CLIP_B, 1000, 500);

    const mid = a.update(550);
    expect(mid).toHaveLength(2);
    expect(mid[0].clip).toBe(CLIP_A);
    expect(mid[0].weight).toBeCloseTo(1);
    expect(mid[1].clip).toBe(CLIP_B);
    expect(mid[1].weight).toBeCloseTo(0.5, 1);

    const after = a.update(650);
    expect(after).toHaveLength(1);
    expect(after[0].clip).toBe(CLIP_B);
    expect(after[0].weight).toBeCloseTo(1);
  });

  it('setGait with the SAME clip object does not begin a crossfade and preserves phase', () => {
    const a = new Animator({ fadeMs: 100 });
    a.setGait(CLIP_A, 1000, 0);
    a.update(300); // t = 0.3
    a.setGait(CLIP_A, 1000, 300); // same clip identity — no restart
    const layers = a.update(300);
    expect(layers).toHaveLength(1);
    expect(layers[0].clip).toBe(CLIP_A);
    expect(layers[0].weight).toBeCloseTo(1);
    expect(layers[0].t).toBeCloseTo(0.3);
  });

  it('setGait(null) ramps the current gait weight down to empty', () => {
    const a = new Animator({ fadeMs: 100 });
    a.setGait(CLIP_A, 1000, 0);
    a.setGait(null, 0, 500);

    const mid = a.update(550);
    expect(mid).toHaveLength(1);
    expect(mid[0].clip).toBe(CLIP_A);
    expect(mid[0].weight).toBeCloseTo(0.5, 1);

    const done = a.update(600);
    expect(done).toHaveLength(0);
  });

  it('a third setGait mid-fade drops the eldest slot outright (documented pop tradeoff)', () => {
    const a = new Animator({ fadeMs: 100 });
    a.setGait(CLIP_A, 1000, 0);
    a.setGait(CLIP_B, 1000, 500); // A outgoing, B incoming, fading
    a.setGait(CLIP_C, 1000, 520); // arrives mid-fade: A dropped, B outgoing, C incoming
    const layers = a.update(520);
    expect(layers.map((l) => l.clip)).toEqual([CLIP_B, CLIP_C]);
  });
});

describe('Animator overlays — one-shot', () => {
  it('fades in, holds full weight mid-flight, fades out at the tail, auto-removes; forwards chips/mode', () => {
    const a = new Animator({ fadeMs: 100 });
    a.playOverlay('wave', CLIP_WAVE, 1000, 0, { chips: ['armR'], mode: 'additive', weight: 0.8 });

    const early = a.update(10);
    expect(early).toHaveLength(1);
    expect(early[0].weight).toBeGreaterThan(0);
    expect(early[0].weight).toBeLessThan(0.8);
    expect(early[0].chips).toEqual(['armR']);
    expect(early[0].mode).toBe('additive');

    const mid = a.update(500);
    expect(mid[0].weight).toBeCloseTo(0.8);
    expect(mid[0].t).toBeCloseTo(0.5);

    const tail = a.update(950);
    expect(tail[0].weight).toBeGreaterThan(0);
    expect(tail[0].weight).toBeLessThan(0.8);

    const gone = a.update(1000);
    expect(gone).toHaveLength(0);
    // stays gone afterward too
    expect(a.update(2000)).toHaveLength(0);
  });

  it('upserting an active overlay updates options without restarting phase', () => {
    const a = new Animator({ fadeMs: 50 });
    a.playOverlay('wave', CLIP_WAVE, 1000, 0);
    a.update(500); // t = 0.5
    a.playOverlay('wave', CLIP_WAVE, 1000, 500, { weight: 0.5 });
    const layers = a.update(500);
    expect(layers[0].t).toBeCloseTo(0.5);
    expect(layers[0].weight).toBeCloseTo(0.5);
  });
});

describe('Animator overlays — looping', () => {
  it('stays present across several loops and wraps t', () => {
    const a = new Animator({ fadeMs: 50 });
    a.playOverlay('idle-fidget', CLIP_WAVE, 400, 0, { loop: true });
    expect(a.update(200)[0].t).toBeCloseTo(0.5);
    expect(a.update(1000)[0].t).toBeCloseTo(0.5); // 2.5 loops in -> 0.5
    expect(a.update(3600)).toHaveLength(1); // still looping after 9 cycles
  });

  it('stopOverlay fades it out then removes it; unknown id is a no-op', () => {
    const a = new Animator({ fadeMs: 100 });
    a.playOverlay('idle-fidget', CLIP_WAVE, 400, 0, { loop: true });
    a.update(200); // past fade-in, full weight
    expect(() => a.stopOverlay('nope', 200)).not.toThrow();
    expect(a.update(200)).toHaveLength(1);

    a.stopOverlay('idle-fidget', 300);
    const mid = a.update(350);
    expect(mid).toHaveLength(1);
    expect(mid[0].weight).toBeGreaterThan(0);
    expect(mid[0].weight).toBeLessThan(1);

    expect(a.update(400)).toHaveLength(0);
  });
});

describe('Animator ordering + determinism', () => {
  it('gait layers precede overlay layers', () => {
    const a = new Animator({ fadeMs: 50 });
    a.setGait(CLIP_A, 1000, 0);
    a.playOverlay('wave', CLIP_WAVE, 500, 0, { loop: true });
    const layers = a.update(100);
    expect(layers).toHaveLength(2);
    expect(layers[0].clip).toBe(CLIP_A);
    expect(layers[1].clip).toBe(CLIP_WAVE);
  });

  it('two identically-driven Animators produce deep-equal update() results', () => {
    const drive = (): ClipLayer[][] => {
      const a = new Animator({ fadeMs: 100 });
      const out: ClipLayer[][] = [];
      a.setGait(CLIP_A, 1000, 0);
      out.push(a.update(0));
      a.setGait(CLIP_B, 800, 300);
      out.push(a.update(350));
      a.playOverlay('wave', CLIP_WAVE, 400, 350, { chips: ['armR'], weight: 0.7 });
      out.push(a.update(500));
      out.push(a.update(900));
      a.stopOverlay('missing', 900);
      out.push(a.update(1200));
      return out;
    };
    expect(drive()).toEqual(drive());
  });
});
