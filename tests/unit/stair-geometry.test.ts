// tests/unit/stair-geometry.test.ts — G3a: parametric stairs.
// "All kinds of stairs, the same way we support all kinds of buildings." A stair is a
// class:'prop' blueprint whose `stair_flight` part emits stepped box prims through the
// shared generate→sprite pipeline; variety is parametric (construction spectrum +
// material), not hand-authored.
import { describe, it, expect, beforeAll } from 'vitest';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { stairTreads, stairFootprint } from '@/blueprint/parts/stair';
import { mToTiles } from '@/render/scale-contract';

beforeAll(() => ensureBuildingTypesRegistered());

/* eslint-disable @typescript-eslint/no-explicit-any */
const boxes = (spec: { parts: any[] }): any[] => spec.parts.filter((p) => p.prim === 'box');
const cyls = (spec: { parts: any[] }): any[] => spec.parts.filter((p) => p.prim === 'cylinder');
/** The tread boxes only (srcId 'flight') — the flight also emits nosing lips, side cheeks and
 *  foot/head blocks tagged 'flight/…', which mass the stair but are not steps. */
const steps = (spec: { parts: any[] }): any[] => spec.parts.filter((p) => p.prim === 'box' && p.srcId === 'flight');

describe('stairTreads (pure tread breakdown)', () => {
  it('derives tread count from rise and the construction-driven riser', () => {
    const rough = stairTreads({ riseM: 1.8, construction: 0 });
    const dressed = stairTreads({ riseM: 1.8, construction: 1 });
    // Rough scrambles climb in taller steps → fewer treads for the same rise.
    expect(rough.treads).toBeLessThan(dressed.treads);
    // Every flight covers its full rise within a riser of tolerance.
    expect(rough.treads * rough.riserM).toBeCloseTo(1.8, 5);
    expect(dressed.treads * dressed.riserM).toBeCloseTo(1.8, 5);
    // Dressed steps are gentler (lower riser, deeper run).
    expect(dressed.riserM).toBeLessThan(rough.riserM);
    expect(dressed.runM).toBeGreaterThan(rough.runM);
  });

  it('honours an explicit tread count over the rise-derived one', () => {
    expect(stairTreads({ riseM: 5, treads: 12 }).treads).toBe(12);
  });

  it('footprint spans the full run along the climb axis', () => {
    const fp = stairFootprint({ riseM: 3, widthM: 2, construction: 0.5 });
    const { treads, runM } = stairTreads({ riseM: 3, construction: 0.5 });
    expect(fp.h).toBeGreaterThanOrEqual(Math.ceil(mToTiles(treads * runM)));
    expect(fp.w).toBeGreaterThanOrEqual(1);
  });
});

describe('stair presets resolve & compile', () => {
  it('all four base presets resolve as class:prop infrastructure', () => {
    for (const name of ['stair_scramble', 'stair_wood', 'stair_stone', 'stair_grand']) {
      const rb = synthesizeBlueprint(name);
      expect(rb, name).toBeTruthy();
      expect(rb!.class).toBe('prop');
      expect(rb!.category).toBe('infrastructure');
    }
  });

  it('emits one stepped box per tread (no building prim)', () => {
    const rb = synthesizeBlueprint('stair_stone')!;
    const spec = toGeometry(rb);
    expect(spec.parts.some(p => p.prim === 'building')).toBe(false);
    const { treads } = stairTreads({ riseM: 2.4, construction: 0.6 });
    expect(steps(spec).length).toBe(treads);
    // The flight also masses itself with nosing + cheeks + foot/head blocks (more boxes than steps).
    expect(boxes(spec).length).toBeGreaterThan(treads);
    // Steps rise monotonically: each step block is taller than the previous.
    const heights = steps(spec).map((b) => b.size[2]);
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeGreaterThan(heights[i - 1]);
  });

  it('a stone flight rails with a coursed parapet cheek; a timber flight with balustrade posts', () => {
    const grand = toGeometry(synthesizeBlueprint('stair_grand')!);    // stone, railing: both
    const wood = toGeometry(synthesizeBlueprint('stair_wood')!);      // timber, railing: both
    const scramble = toGeometry(synthesizeBlueprint('stair_scramble')!); // stone, railing: none
    // Masonry railings are raised parapet cheeks (no posts); timber railings are upright balusters.
    expect(grand.parts.some((p) => p.srcId === 'flight/rail')).toBe(true);
    expect(cyls(grand).length).toBe(0);
    expect(cyls(wood).length).toBeGreaterThan(0);
    // A rough scramble has no railing and no cheeks at all.
    expect(cyls(scramble).length).toBe(0);
    expect(scramble.parts.some((p) => String(p.srcId ?? '').startsWith('flight/cheek'))).toBe(false);
  });

  it('material spectrum: timber vs stone flights differ in material', () => {
    const wood = toGeometry(synthesizeBlueprint('stair_wood')!);
    const stone = toGeometry(synthesizeBlueprint('stair_stone')!);
    expect(boxes(wood)[0].material).toBe('timber');
    expect(boxes(stone)[0].material).toBe('stone');
  });

  it('grand stair is wider and finer than a scramble (parametric, not preset-coded)', () => {
    const grand = toGeometry(synthesizeBlueprint('stair_grand')!);
    const scramble = toGeometry(synthesizeBlueprint('stair_scramble')!);
    expect(boxes(grand).length).toBeGreaterThan(boxes(scramble).length);
    const gw = boxes(grand)[0].size[0];
    const sw = boxes(scramble)[0].size[0];
    expect(gw).toBeGreaterThan(sw);
  });
});
