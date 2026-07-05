// tests/unit/blueprint-montage.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { renderBlueprintMontage } from '@/assetgen/blueprint-montage';
import { composeStructure } from '@/assetgen/compose';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { resolveBlueprint } from '@/blueprint/resolve';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';

beforeAll(() => ensureBuildingTypesRegistered());

const church: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 3, h: 6 },
  materials: { walls: 'stone', roof: 'slate' },
  parts: {
    nave: { type: 'body', at: { x: 0, y: 2 }, size: { w: 3, h: 4 }, params: { plan: 'rect', levels: 1, roof: 'gable' } },
    tower: { type: 'tower', at: { x: 0, y: 0 }, size: { w: 2, h: 2 }, params: {} },
  },
};

describe('composeStructure labelPoints (additive)', () => {
  it('returns no labels field when labelPoints is absent (goldens untouched)', async () => {
    const spec = toGeometry(resolveBlueprint([church], 0), { diagnostics: [] });
    const r = await composeStructure(spec);
    expect(r.labels).toBeUndefined();
  });

  it('projects each labelPoint to a normalised position through the same fit', async () => {
    const spec = toGeometry(resolveBlueprint([church], 0), { diagnostics: [] });
    const r = await composeStructure(spec, undefined, {
      labelPoints: [{ id: 'nave', x: 1.5, y: 4, z: 1 }, { id: 'tower', x: 1, y: 1, z: 3 }],
    });
    expect(r.labels).toHaveLength(2);
    expect(r.labels!.map(l => l.id)).toEqual(['nave', 'tower']);
    for (const l of r.labels!) { expect(Number.isFinite(l.x)).toBe(true); expect(Number.isFinite(l.y)).toBe(true); }
  });

  it('rotates label positions with the turntable yaw', async () => {
    const spec = toGeometry(resolveBlueprint([church], 0), { diagnostics: [] });
    const pts = [{ id: 'tower', x: 1, y: 1, z: 3 }];
    const a = await composeStructure(spec, undefined, { labelPoints: pts });
    const b = await composeStructure(spec, undefined, { yaw: Math.PI, labelPoints: pts });
    // A 180° turntable moves the tower to the opposite side of the sprite.
    expect(Math.abs(a.labels![0].x - b.labels![0].x)).toBeGreaterThan(0.1);
  });
});

describe('renderBlueprintMontage', () => {
  it('renders a 4-yaw sheet with one mark per part, keyed to part ids', async () => {
    const m = await renderBlueprintMontage(resolveBlueprint([church], 0));
    expect(m.yaws).toHaveLength(4);
    expect(m.legend.map(e => e.id)).toEqual(['nave', 'tower']);
    expect(m.legend.map(e => e.mark)).toEqual([1, 2]);
    // 2×2 grid of 256px cells + gutters.
    expect(m.width).toBe(2 * 256 + 3 * 8);
    expect(m.height).toBe(2 * 256 + 3 * 8);
    expect(m.rgba.length).toBe(m.width * m.height * 4);
  }, 15000);

  it('is deterministic (same bytes for the same blueprint)', async () => {
    const rb = resolveBlueprint([church], 0);
    const opts = { yaws: [0, Math.PI], cell: 96 };   // cheap: 2 small views
    const a = await renderBlueprintMontage(rb, opts);
    const b = await renderBlueprintMontage(rb, opts);
    expect(Buffer.from(a.rgba)).toEqual(Buffer.from(b.rgba));
  }, 15000);
});
