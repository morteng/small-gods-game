import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCharacterSpec } from '@/render/lpc/character-builder';
import { walkSpriteCandidates } from '@/render/lpc/lpc-walk-path';
import type { NpcRole } from '@/core/types';

const ROLES: NpcRole[] = ['farmer', 'priest', 'soldier', 'merchant', 'elder', 'child', 'noble', 'beggar'];
const SPRITES = resolve(__dirname, '../../public/sprites/lpc/spritesheets');

/** Sweep many seeds per role — enough to hit both sexes and all pooled picks. */
const SEEDS = Array.from({ length: 60 }, (_, i) => i * 1009 + 7);

describe('character-builder: determinism', () => {
  it('same (role, seed) always yields the same spec', () => {
    for (const role of ROLES) {
      for (const seed of [1, 42, 1000]) {
        expect(buildCharacterSpec(role, seed)).toEqual(buildCharacterSpec(role, seed));
      }
    }
  });
});

describe('character-builder: every referenced sprite is vendored (no broken NPCs)', () => {
  // Faces are a soft overlay the compositor tolerates missing; the wardrobe is
  // what must resolve. (Child face isn't vendored, by design.)
  const SKIP_LAYERS = new Set(['expression']);

  it('all role × seed wardrobe layers resolve to a vendored walk.png', () => {
    const missing: string[] = [];
    for (const role of ROLES) {
      for (const seed of SEEDS) {
        const spec = buildCharacterSpec(role, seed);
        for (const [layer, sel] of Object.entries(spec.items)) {
          if (SKIP_LAYERS.has(layer) || !sel) continue;
          const candidates = walkSpriteCandidates(sel.itemId, sel.variant, spec.bodyType);
          expect(candidates.length, `unmodelled item ${sel.itemId}`).toBeGreaterThan(0);
          if (!candidates.some((p) => existsSync(resolve(SPRITES, p)))) {
            missing.push(`${role}/${seed} ${layer}=${sel.itemId}:${sel.variant} (${spec.bodyType}) → ${candidates.join(' | ')}`);
          }
        }
      }
    }
    expect(missing, `missing vendored sprites:\n${missing.slice(0, 20).join('\n')}`).toEqual([]);
  });
});

describe('character-builder: diverse crowds', () => {
  it('mixed-sex roles produce both men and women across seeds', () => {
    for (const role of ['farmer', 'merchant', 'noble', 'beggar', 'priest'] as NpcRole[]) {
      const sexes = new Set(SEEDS.map((s) => buildCharacterSpec(role, s).sex));
      expect(sexes.has('male'), `${role} never male`).toBe(true);
      expect(sexes.has('female'), `${role} never female`).toBe(true);
    }
  });

  it('male-only roles stay male / child stays child', () => {
    for (const seed of SEEDS) {
      expect(buildCharacterSpec('soldier', seed).sex).toBe('male');
      expect(buildCharacterSpec('elder', seed).sex).toBe('male');
      expect(buildCharacterSpec('child', seed).sex).toBe('child');
    }
  });

  it('a single role yields many distinct looks (not clones)', () => {
    const looks = new Set(
      SEEDS.map((s) => {
        const spec = buildCharacterSpec('farmer', s);
        const it = spec.items;
        return [spec.sex, it.hair?.itemId, it.clothes?.itemId, it.clothes?.variant, it.legs?.variant, it.shoes?.variant].join('|');
      }),
    );
    expect(looks.size).toBeGreaterThan(8);
  });
});
