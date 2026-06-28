// tests/unit/entrance-stoops.test.ts — the outdoor-architectural stair siter: a building
// standing proud of the grade it faces earns a perron/stoop from grade up to its door.
// Pins: flush sites get none, a building on a rise gets exactly one stoop footed outside its
// door, the rise is read from the grade drop, and it inherits the building's wall material.
import { describe, it, expect } from 'vitest';
import { buildEntranceStoopEntities } from '@/world/connectome/entrance-stoops';
import { blueprintEntity, blueprintOf } from '@/blueprint/entity';
import { synthesizeBlueprint } from '@/blueprint/presets';
import type { Entity } from '@/core/types';

const building = (id: string, x: number, y: number, preset = 'cottage'): Entity =>
  blueprintEntity(id, synthesizeBlueprint(preset)!, x, y);

// A hill centred on (10,10): elevation falls off in every direction, so whatever way the
// door faces, the ground a couple tiles out is lower → a drop the stoop must bridge.
const hill = (cx: number, cy: number, peak = 0.7, slope = 0.04) =>
  (x: number, y: number) => Math.max(0, peak - (Math.abs(x - cx) + Math.abs(y - cy)) * slope);

describe('buildEntranceStoopEntities', () => {
  it('a flush-sited building (flat ground) gets no stoop', () => {
    const stoops = buildEntranceStoopEntities([building('b1', 10, 10)], { elevAt: () => 0.5, reliefM: 20 });
    expect(stoops).toHaveLength(0);
  });

  it('a building proud of the grade it faces gets exactly one perron, footed outside its door', () => {
    const b = building('b1', 10, 10);
    const stoops = buildEntranceStoopEntities([b], { elevAt: hill(10, 10), reliefM: 16 });
    expect(stoops).toHaveLength(1);
    expect(stoops[0].id).toBe('b1:stoop');
    const rb = blueprintOf(stoops[0])!.rb;
    expect(rb.preset).toBe('stair_perron');
    expect(rb.parts[0].type).toBe('stair_flight');
    // footed off the building centre (the door is on an edge, the foot one tile beyond it)
    expect(Math.abs(stoops[0].x - 10) + Math.abs(stoops[0].y - 10)).toBeGreaterThan(0);
  });

  it('inherits the building wall material (the steps match the house)', () => {
    const cottage = building('c1', 10, 10);
    const wall = blueprintOf(cottage)!.rb.materials.walls;          // cottage = wattle
    const stoops = buildEntranceStoopEntities([cottage], { elevAt: hill(10, 10), reliefM: 16 });
    expect(stoops).toHaveLength(1);
    expect(blueprintOf(stoops[0])!.rb.materials.walls).toBe(wall);
  });

  it('skips a barely-raised site (sub-0.8 m) and a cliff (over 4 m) — only real stoops', () => {
    const b = building('b1', 10, 10);
    // tiny relief → drop < 0.8 m → no stoop
    expect(buildEntranceStoopEntities([b], { elevAt: hill(10, 10), reliefM: 2 })).toHaveLength(0);
    // huge relief → drop > 4 m → that's a retaining problem, not a stoop
    expect(buildEntranceStoopEntities([b], { elevAt: hill(10, 10), reliefM: 80 })).toHaveLength(0);
  });

  it('respects cellBlocked (no stoop into water / a road / another building)', () => {
    const b = building('b1', 10, 10);
    const stoops = buildEntranceStoopEntities([b], { elevAt: hill(10, 10), reliefM: 16, cellBlocked: () => true });
    expect(stoops).toHaveLength(0);
  });

  it('is deterministic and id-stable across building order', () => {
    const a = building('a', 10, 10), b = building('b', 30, 30);
    const r1 = buildEntranceStoopEntities([a, b], { elevAt: hill(10, 10), reliefM: 16 }).map(e => e.id);
    const r2 = buildEntranceStoopEntities([b, a], { elevAt: hill(10, 10), reliefM: 16 }).map(e => e.id);
    expect(r1).toEqual(r2);
  });
});
