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
import { IMPORTED_CLIPS } from '@/render/paperdoll/clips';

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
    for (const spec of MOTION_IMPORTS) {
      const a = runImport(spec);
      const b = runImport(spec);
      expect(JSON.stringify(b.clips)).toBe(JSON.stringify(a.clips));
      expect(b.metrics).toEqual(a.metrics);
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

  it.each(imported)('$spec.id closes its loop iff it was imported as cyclic', ({ spec, clips }) => {
    // A cyclic import must sample identically at t=0 and t=1 or the sprite pops
    // at the wrap. A one-shot must NOT — silently bending a gesture into a loop
    // would be the wrong kind of helpful.
    const cyclic = (spec.opts.loop ?? 'auto') !== 'none';
    for (const facing of FACINGS) {
      const clip: Clip = clips[facing];
      const at0 = sampleClip(TEMPLATES[facing], clip, 0);
      const at1 = sampleClip(TEMPLATES[facing], clip, 1);
      if (cyclic) expect(at1).toEqual(at0);
      else expect(at1).not.toEqual(at0);
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
