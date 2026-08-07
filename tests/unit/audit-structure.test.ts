// tests/unit/audit-structure.test.ts
// Phase B1 — structure-stage audit. One fixture per rule (a spec that TRIPS it + a clean
// counter-candidate via real compose), severity ordering, and determinism. Tooling, not
// shipped geometry: read-only over the composed result, so NO golden pins here.
import { describe, it, expect } from 'vitest';
import { auditStructure } from '@/blueprint/audit-structure';
import { authorBlueprint } from '@/blueprint/authoring';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { composeStructure, type StructureResult, type StructureSpec } from '@/assetgen/compose';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import type { ResolvedBlueprint, ResolvedPart } from '@/blueprint/types';

/** Minimal ResolvedBlueprint builder (fields we don't exercise are filled safe defaults). */
function makeRb(over: Partial<ResolvedBlueprint> = {}): ResolvedBlueprint {
  return {
    version: 1, class: 'building', parts: [], materials: {}, palette: {},
    footprint: { w: 4, h: 4 }, ...over,
  } as ResolvedBlueprint;
}

/** Minimal StructureResult builder — enough surface for the (non-mesh) audit rules. */
function makeResult(over: Partial<StructureResult>): StructureResult {
  const size = over.size ?? 64;
  const blank = new Uint8ClampedArray(size * size * 4);
  return {
    grey: blank, normal: blank, material: blank, emissive: blank,
    size,
    meta: { bbox: { x: 0, y: 0, w: 0, h: 0 }, anchors: { doors: [], vents: [] } },
    bbox: { x: 0, y: 0, w: 0, h: 0 },
    anchors: { doors: [], vents: [] },
    ...over,
  } as StructureResult;
}

function part(p: Partial<ResolvedPart>): ResolvedPart {
  return { id: 'p', type: 'box', at: { x: 0, y: 0 }, size: { w: 1, h: 1 }, params: {}, features: [], ...p } as ResolvedPart;
}

describe('clean structure (real compose path)', () => {
  it('a valid preset audits clean (no errors) and reports massing info', async () => {
    const gate = authorBlueprint({ preset: 'cottage' });
    expect(gate.ok).toBe(true);
    const spec = toGeometry(gate.rb!);
    const r = await composeStructure(spec, undefined, {});
    const audits = await auditStructure(spec, gate.rb!, r);
    expect(audits.some((a) => a.severity === 'error')).toBe(false);
    expect(audits.some((a) => a.code === 'massing' && a.severity === 'info')).toBe(true);
  });

  it('is deterministic — two audits over the same spec are byte-identical', async () => {
    const gate = authorBlueprint({ preset: 'cottage' });
    const spec = toGeometry(gate.rb!);
    const r = await composeStructure(spec, undefined, {});
    const a = await auditStructure(spec, gate.rb!, r);
    const b = await auditStructure(spec, gate.rb!, r);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('rule fixtures (computeMeshStats off — cheap rules only)', () => {
  it('structure-empty — an asset that composes to no opaque geometry errors', async () => {
    const res = makeResult({ size: 64, bbox: { x: 0, y: 0, w: 0, h: 0 } });
    const audits = await auditStructure({ parts: [] } as unknown as StructureSpec, makeRb(), res, { computeMeshStats: false });
    expect(audits.some((a) => a.code === 'structure-empty' && a.severity === 'error')).toBe(true);
  });

  it('structure-overflow — a solid clipping the sprite budget warns (and clean does not)', async () => {
    const spill = await auditStructure(
      { parts: [] } as unknown as StructureSpec, makeRb(),
      makeResult({ size: 64, bbox: { x: 0, y: 0, w: 64, h: 32 } }),
      { computeMeshStats: false },
    );
    expect(spill.some((a) => a.code === 'structure-overflow' && a.severity === 'warn')).toBe(true);

    const fits = await auditStructure(
      { parts: [] } as unknown as StructureSpec, makeRb(),
      makeResult({ size: 64, bbox: { x: 2, y: 4, w: 30, h: 20 } }),
      { computeMeshStats: false },
    );
    expect(fits.some((a) => a.code === 'structure-overflow')).toBe(false);
  });

  it('z-penetration — a non-skirt prim whose floor sits below the ground plane errors', async () => {
    const spec = { parts: [{ prim: 'box', at: [0, 0, -0.5], size: [1, 1, 1] }] } as unknown as StructureSpec;
    const audits = await auditStructure(spec, makeRb(), makeResult({ size: 64, bbox: { x: 0, y: 0, w: 10, h: 10 } }), { computeMeshStats: false });
    expect(audits.some((a) => a.code === 'z-penetration' && a.severity === 'error')).toBe(true);
  });

  it('skirt prims are allowlisted — they legitimately drop below ground (no z-penetration)', async () => {
    const spec = { parts: [{ prim: 'skirt', rect: { x: 0, y: 0, w: 2, h: 2 }, thickness: 0.2 }] } as unknown as StructureSpec;
    const audits = await auditStructure(spec, makeRb(), makeResult({ size: 64, bbox: { x: 0, y: 0, w: 10, h: 10 } }), { computeMeshStats: false });
    expect(audits.some((a) => a.code === 'z-penetration')).toBe(false);
  });

  it('opening-no-wall — a declared opening with no wall-bearing solid warns (and clean does not)', async () => {
    await ensureBuildingTypesRegistered();
    const rbp = makeRb({
      parts: [part({ id: 'p', features: [{ id: 'd', type: 'door', face: 'south', params: { main: true } }] })],
    });
    const noWall = { parts: [{ prim: 'flora', limbs: [], leaves: [] }] } as unknown as StructureSpec;
    const audits = await auditStructure(noWall, rbp, makeResult({ size: 64, bbox: { x: 0, y: 0, w: 10, h: 10 } }), { computeMeshStats: false });
    expect(audits.some((a) => a.code === 'opening-no-wall' && a.severity === 'warn')).toBe(true);

    // Same opening on a wall-bearing box ⇒ no opening-no-wall.
    const wall = { parts: [{ prim: 'box', at: [0, 0, 0], size: [1, 1, 1] }] } as unknown as StructureSpec;
    const clean = await auditStructure(wall, rbp, makeResult({ size: 64, bbox: { x: 0, y: 0, w: 10, h: 10 } }), { computeMeshStats: false });
    expect(clean.some((a) => a.code === 'opening-no-wall')).toBe(false);
  });

  it('mount-anchor-missing — a building that projects no mount sockets warns', async () => {
    const rbp = makeRb({ parts: [part({ id: 'body', type: 'body', size: { w: 2, h: 2 } })] });
    const res = makeResult({ size: 64, bbox: { x: 0, y: 0, w: 10, h: 10 }, anchors: { doors: [], vents: [], tags: [] } });
    const audits = await auditStructure({ parts: [] } as unknown as StructureSpec, rbp, res, { computeMeshStats: false });
    expect(audits.some((a) => a.code === 'mount-anchor-missing' && a.severity === 'warn')).toBe(true);
  });
});

describe('severity ordering', () => {
  it('errors sort before warns before infos', async () => {
    // z-penetration (error) + structure-overflow (warn) + mount-anchor-missing (warn).
    const spec = { parts: [{ prim: 'box', at: [0, 0, -0.5], size: [1, 1, 1] }] } as unknown as StructureSpec;
    const rbp = makeRb({ parts: [part({ id: 'body', type: 'body', size: { w: 2, h: 2 } })] });
    const res = makeResult({ size: 64, bbox: { x: 0, y: 0, w: 64, h: 32 }, anchors: { doors: [], vents: [], tags: [] } });
    const audits = await auditStructure(spec, rbp, res, { computeMeshStats: false });
    expect(audits.some((a) => a.code === 'z-penetration')).toBe(true);
    expect(audits.some((a) => a.code === 'structure-overflow')).toBe(true);
    expect(audits.some((a) => a.code === 'mount-anchor-missing')).toBe(true);
    const rank: Record<string, number> = { error: 0, warn: 1, info: 2 };
    const sevs = audits.map((a) => a.severity);
    for (let i = 1; i < sevs.length; i++) expect(rank[sevs[i - 1]]).toBeLessThanOrEqual(rank[sevs[i]]);
    expect(sevs[0]).toBe('error');
  });
});
