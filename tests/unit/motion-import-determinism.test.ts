/**
 * The determinism contract, made real rather than aspirational.
 *
 * Imported motion is checked-in CODE, not a runtime asset: nothing at run time
 * opens a `.bvh`. That only holds up if re-running the importer reproduces the
 * checked-in bytes EXACTLY — otherwise "generated, do not hand-edit" is a lie
 * and every future re-run is an unreviewable diff. So this suite re-runs
 * `scripts/motion-import-bvh.ts` over the real vendored captures and compares
 * against what is on disk, character for character.
 *
 * It also pins the two ways a projected clip goes quietly wrong, because a
 * byte-identical WRONG clip is still wrong: a track that names a chip its
 * facing template does not own, and an angle step past 180° between baked
 * frames (the unwrapper's blind spot — where a fast gesture stops waving and
 * starts winding).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MOTION_IMPORTS,
  importClips,
  indexFile,
  moduleFileFor,
  renderIndex,
  renderModule,
  runImport,
} from '../../scripts/motion-import-bvh';
import { sampleClip, type AnimTemplate, type Clip } from '@/render/paperdoll/rig';
import { LPC_HUMANOID_SOUTH } from '@/render/paperdoll/lpc-humanoid';
import { LPC_HUMANOID_NORTH } from '@/render/paperdoll/lpc-humanoid-north';
import { LPC_HUMANOID_WEST } from '@/render/paperdoll/lpc-humanoid-west';
import { IMPORTED_CLIPS, IMPORTED_CLIP_META } from '@/render/paperdoll/clips';

const TEMPLATES: Record<'down' | 'up' | 'left', AnimTemplate> = {
  down: LPC_HUMANOID_SOUTH,
  up: LPC_HUMANOID_NORTH,
  left: LPC_HUMANOID_WEST,
};
const FACINGS = ['down', 'up', 'left'] as const;

/** Import each spec once; every test below reads from this. */
const imported = MOTION_IMPORTS.map((spec) => ({ spec, ...runImport(spec) }));

describe('motion import — the checked-in modules ARE the artifact', () => {
  it.each(imported)('$spec.id re-imports byte-identical to the checked-in module', ({ spec, clips, metrics }) => {
    expect(renderModule(spec, clips, metrics)).toBe(readFileSync(moduleFileFor(spec), 'utf8'));
  });

  it('the registry module is byte-identical too', () => {
    expect(renderIndex(MOTION_IMPORTS)).toBe(readFileSync(indexFile(), 'utf8'));
  });

  it('lists every imported clip in the registry, and nothing else', () => {
    expect(Object.keys(IMPORTED_CLIPS).sort()).toEqual(MOTION_IMPORTS.map((s) => s.id).sort());
  });

  it('is stable run to run, not merely stable on disk', () => {
    // Byte-equality with the file could also be satisfied by an importer that
    // is stable ONLY on this machine's first run. Import twice and compare.
    // `importClips` rather than `runImport`: the clips ARE the serialized
    // artifact, so they are the whole determinism surface, while the metrics
    // beside them cost an undecimated reference bake each — six of those made
    // this test a load-dependent timeout rather than a stronger assertion.
    for (const spec of MOTION_IMPORTS) {
      expect(JSON.stringify(importClips(spec))).toBe(JSON.stringify(importClips(spec)));
    }
  });

  it('quantizes every emitted key to 0.5° / 0.25 px', () => {
    let keys = 0;
    for (const { clips } of imported) {
      for (const facing of FACINGS) {
        for (const track of Object.values(clips[facing].tracks)) {
          for (const k of track) {
            keys++;
            expect(k.deg * 2).toBe(Math.round(k.deg * 2));
            if (k.dx !== undefined) expect(k.dx * 4).toBe(Math.round(k.dx * 4));
            if (k.dy !== undefined) expect(k.dy * 4).toBe(Math.round(k.dy * 4));
          }
        }
      }
    }
    expect(keys).toBeGreaterThan(100);
  });
});

describe('motion import — a byte-identical clip can still be a wrong clip', () => {
  it.each(imported)('$spec.id names only chips its facing template owns', ({ clips }) => {
    for (const facing of FACINGS) {
      const owned = new Set(TEMPLATES[facing].chips.map((c) => c.name));
      for (const chip of Object.keys(clips[facing].tracks)) expect(owned).toContain(chip);
      for (const p of clips[facing].plant ?? []) expect(owned).toContain(p.chip);
    }
  });

  it.each(imported)('$spec.id never steps a chip past 180° between baked frames', ({ clips }) => {
    // Past 180° the unwrapper cannot tell +200° from −160°, and a gesture stops
    // waving and starts winding. The fix when this fires is a tighter `range`
    // or more `frames` — never a looser tolerance.
    for (const facing of FACINGS) {
      const clip = clips[facing];
      const template = TEMPLATES[facing];
      for (let f = 1; f < clip.frames; f++) {
        const a = sampleClip(template, clip, (f - 1) / (clip.frames - 1));
        const b = sampleClip(template, clip, f / (clip.frames - 1));
        template.chips.forEach((ch, i) => {
          if (clip.tracks[ch.name] === undefined) return;
          expect(Math.abs(b[i].deg - a[i].deg)).toBeLessThan(180);
        });
      }
    }
  });

  it.each(imported)('$spec.id closes its loop exactly where its OWN per-facing measurement says so', ({ metrics, clips }) => {
    // A cyclic import must sample identically at t=0 and t=1 or the sprite pops
    // at the wrap; a one-shot must NOT — silently bending a gesture into a loop
    // would be the wrong kind of helpful. But whether a facing closes is a
    // PER-FACING decision inside `closeLoop` (bvh.ts): a facing whose own
    // residual exceeds tolerance is left open even when the other two close.
    // That looked like a distinction without a difference — every capture
    // imported so far closed uniformly across all three facings — until the
    // `dig` capture, whose `left` measured an 11.5° gap on `armFar_up` while
    // `down`/`up` closed at 0°. That capture was declined for unrelated
    // reasons (see the importer's declined register) and is no longer in the
    // tree, but the asymmetry it exposed is a property of real mocap, not of
    // that one file, so the check stays per-facing. The right check is against
    // `metrics.facings[].loopDeg`, the same per-facing measurement `runImport`
    // itself derived, not a single clip-wide "was this imported as cyclic"
    // flag that assumes every facing agrees.
    for (const facing of FACINGS) {
      const clip: Clip = clips[facing];
      const at0 = sampleClip(TEMPLATES[facing], clip, 0);
      const at1 = sampleClip(TEMPLATES[facing], clip, 1);
      const closes = metrics.facings.find((f) => f.facing === facing)!.loopDeg === 0;
      if (closes) expect(at1).toEqual(at0);
      else expect(at1).not.toEqual(at0);
    }
  });

  it.each(imported)('$spec.id stays close to an undecimated bake of the same range', ({ metrics }) => {
    // The decimation error is what stops a landed clip carrying an asterisk.
    // 8° RMS is a real bar, not a rubber stamp: the three landed clips measure
    // 4.6–5.6°, and the wave as first imported (17 frames, default 12-key cap)
    // measured 13.3° — this assertion is exactly what would have caught it.
    // When it fires, the fix is a tighter `range`, more `frames` or more
    // `maxKeys`; never a looser bound here.
    expect(metrics.decimation).not.toBeNull();
    expect(metrics.decimation!.rmsDeg).toBeLessThanOrEqual(8);
  });

  it('the exported meta says the same thing as the comment above it', () => {
    // The header prose and `*_META` are rendered from one `ClipMetrics`, but only
    // the meta is readable by code — so it is the one that can silently drift
    // into decoration. Pin it against the measurement it claims to report.
    for (const { spec, metrics } of imported) {
      const meta = IMPORTED_CLIP_META[spec.id];
      expect(meta, `${spec.id} has no meta entry`).toBeDefined();
      expect(meta.source).toBe(spec.source);
      expect(meta.cycleSeconds).toBe(metrics.cycleSeconds);
      expect(meta.frameMs).toBe(metrics.msPerFrame);
      expect(meta.loop).toBe(metrics.loops);
      // Sub-pixel travel over a whole cycle is capture noise; calling it a stride
      // would hand M2 a ground speed to tune against that means nothing.
      const travels = metrics.stridePx >= 1;
      expect(meta.stridePx).toBe(travels ? metrics.stridePx : 0);
      expect(meta.groundSpeedPxPerSec).toBe(travels ? metrics.groundSpeedPxPerSec : 0);
    }
  });

  it('agrees with the loop closure the clips actually have', () => {
    // `metrics.loops` is itself a claim. Check it against the clips rather than
    // trusting two derived numbers to agree with each other.
    for (const { spec, clips } of imported) {
      const closed = FACINGS.every((f) => {
        const t = TEMPLATES[f];
        return JSON.stringify(sampleClip(t, clips[f], 0)) === JSON.stringify(sampleClip(t, clips[f], 1));
      });
      expect(IMPORTED_CLIP_META[spec.id].loop).toBe(closed);
    }
  });

  it.each(imported)('$spec.id stands where the rig stands, on every facing', ({ spec, clips }) => {
    // The root's `dx` is a rigid translation of the whole figure. Nothing else
    // in this file has an opinion about ABSOLUTE position, so a capture's own
    // location in the mocap volume once leaked straight through: the sagittal
    // (west) facing puts the travel axis on screen x, and the walk came out
    // sitting at a constant +20px — two thirds of the way out of a 64px cell,
    // feet clipping the frame. Angles, loop closure, decimation and
    // byte-identity were all green throughout.
    //
    // What is pinned is the ANCHOR, not the amplitude. A gesture may genuinely
    // sway (the wave's actor shifts 7px of weight and that is the motion); what
    // it may not do is stand somewhere other than where the rig stands. So the
    // reference pose — the same one the rotations are measured from — must land
    // at the rig's own rest position.
    const refMode = spec.opts.referenceFrame ?? 0;
    for (const facing of FACINGS) {
      const clip = clips[facing];
      const root = TEMPLATES[facing].chips[0].name;
      const track = clip.tracks[root];
      if (track === undefined) continue;
      let anchor: number;
      if (refMode === 'mean') {
        let sum = 0;
        for (let f = 0; f < clip.frames; f++) {
          sum += sampleClip(TEMPLATES[facing], clip, f / (clip.frames - 1))[0].dx;
        }
        anchor = sum / clip.frames;
      } else {
        anchor = sampleClip(TEMPLATES[facing], clip, refMode / (clip.frames - 1))[0].dx;
      }
      expect(Math.abs(anchor), `${facing} root anchored at ${anchor.toFixed(2)}px`).toBeLessThan(1);
    }
  });

  it('every locomotion clip records the ground speed its feet need', () => {
    // The bake is in-place, so the feet slide one stride per cycle and only read
    // as planted at this speed. If the number were absent, M2 would have to
    // re-derive it from a capture nobody reads at run time.
    const walks = imported.filter(({ metrics }) => metrics.stridePx >= 1);
    expect(walks.length).toBeGreaterThan(0);
    for (const { metrics } of walks) {
      expect(metrics.groundSpeedPxPerSec).toBeGreaterThan(0);
      expect(metrics.groundSpeedPxPerSec).toBeCloseTo(metrics.stridePx / metrics.cycleSeconds, 0);
    }
  });
});
