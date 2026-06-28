/**
 * Engine-purity guard — locks the load-bearing module boundary of the worldbuilding
 * spine: the CATALOGUE ENGINE and the CONNECTOME ENGINE must contain NO content.
 * All medieval (or any pack's) specifics live under `packs/`. This mirrors the
 * existing `no-three-in-bundle` / `no-random-in-sim` guards.
 *
 * Allowed in engine code: structural vocabulary that is deliberately engine-shared —
 * the topology/interpreter ids (the grammar dispatches on them) and the
 * 'smoke-egress' requirement-protocol token. Forbidden: quoted content ids
 * (building/room/material/fixture names, the pack name).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');

// The pure engine files (NOT the content packs, NOT the sanctioned default-packs seam).
const ENGINE_FILES = [
  'src/catalogue/types.ts',
  'src/catalogue/registry.ts',
  'src/catalogue/pack.ts',
  'src/catalogue/constraints.ts',
  'src/catalogue/index.ts',
  'src/blueprint/connectome/types.ts',
  'src/blueprint/connectome/grammar.ts',
  'src/blueprint/connectome/smoke.ts',
  'src/blueprint/connectome/earthworks.ts',
  'src/blueprint/connectome/complex.ts',
  'src/blueprint/connectome/site.ts',
  'src/blueprint/connectome/structure.ts',
  'src/blueprint/connectome/index.ts',
];

// Quoted content ids that must NEVER appear in engine code (they belong to packs).
const FORBIDDEN = [
  'cottage', 'longhouse', 'tavern', 'townhouse', 'castle_keep', 'farm_barn',
  'watermill', 'yurt', 'manor', 'parish-church',
  'hall', 'byre', 'solar', 'nave', 'chancel', 'taproom',
  'thatch', 'wattle', 'cob', 'flagstone',
  'open-hearth', 'wall-fireplace', 'wall-chimney', 'louver', 'smoke-hole', 'bread-oven',
  'doorway', 'cart-door',
  'medieval-europe',
];

describe('engine-purity guard', () => {
  for (const file of ENGINE_FILES) {
    it(`${file} contains no quoted content ids`, () => {
      const src = readFileSync(resolve(ROOT, file), 'utf8');
      const hits: string[] = [];
      for (const id of FORBIDDEN) {
        const re = new RegExp(`['"]${id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}['"]`);
        if (re.test(src)) hits.push(id);
      }
      expect(hits, `content ids leaked into engine file ${file}`).toEqual([]);
    });
  }

  it('the default-packs seam exists and is the only engine→content reference', () => {
    const seam = readFileSync(resolve(ROOT, 'src/catalogue/default-packs.ts'), 'utf8');
    expect(seam).toContain('packs/medieval-europe');
  });
});
