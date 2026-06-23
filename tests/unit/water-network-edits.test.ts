import { describe, it, expect } from 'vitest';
import { generateHydrology } from '@/terrain/hydrology';
import { buildWaterNetwork } from '@/terrain/river-network';
import { applyNodeMoves } from '@/terrain/water-network-edits';
import { type TerrainField } from '@/core/types';

function field(elev: number[]): TerrainField {
  return {
    elevation: new Float32Array(elev),
    moisture: new Float32Array(elev.length),
    temperature: new Float32Array(elev.length),
  };
}
const CONFLUENCE = [0.9, 1.0, 0.9, 0.5, 0.4, 0.5, 1.0, 0.1, 1.0];
function net() {
  const hydro = generateHydrology(field(CONFLUENCE), { seed: 1, width: 3, height: 3, seaLevel: 0.0 }, { riverFlowThreshold: 2 });
  return buildWaterNetwork(hydro, 3, 3);
}

describe('water network edits — movable / reorderable', () => {
  it('an empty move set is the identity', () => {
    const n = net();
    expect(applyNodeMoves(n, new Map())).toBe(n);
  });

  it('moving a node relocates it and re-routes the reaches incident to it', () => {
    const n = net();
    const spring = n.nodes.find((x) => x.kind === 'spring')!;
    const before = n.reaches.find((r) => r.from === spring.id)!;
    const moved = applyNodeMoves(n, new Map([[spring.id, { x: spring.x + 2, y: spring.y + 2 }]]));

    // node anchor moved
    const after = moved.nodes.find((x) => x.id === spring.id)!;
    expect(after.x).toBe(spring.x + 2);
    expect(after.y).toBe(spring.y + 2);
    // the reach leaving the spring now starts at the moved head (cell-centre of new pos)
    const reach = moved.reaches.find((r) => r.from === spring.id)!;
    expect(reach.centerline[0].x).toBeCloseTo(spring.x + 2 + 0.5, 5);
    expect(reach.centerline[0].y).toBeCloseTo(spring.y + 2 + 0.5, 5);
    // its downstream end is unchanged (the bed stays put)
    const end = reach.centerline[reach.centerline.length - 1];
    const endBefore = before.centerline[before.centerline.length - 1];
    expect(end.x).toBeCloseTo(endBefore.x, 5);
    expect(end.y).toBeCloseTo(endBefore.y, 5);
  });

  it('is pure — the input network is untouched', () => {
    const n = net();
    const spring = n.nodes.find((x) => x.kind === 'spring')!;
    const origX = spring.x;
    const origLine = n.reaches.find((r) => r.from === spring.id)!.centerline[0].x;
    applyNodeMoves(n, new Map([[spring.id, { x: spring.x + 5, y: spring.y }]]));
    expect(n.nodes.find((x) => x.id === spring.id)!.x).toBe(origX);
    expect(n.reaches.find((r) => r.from === spring.id)!.centerline[0].x).toBe(origLine);
  });

  it('reaches not touching a moved node are returned unchanged', () => {
    const n = net();
    const spring = n.nodes.find((x) => x.kind === 'spring')!;
    const moved = applyNodeMoves(n, new Map([[spring.id, { x: spring.x + 1, y: spring.y }]]));
    for (let i = 0; i < n.reaches.length; i++) {
      const touches = n.reaches[i].from === spring.id || n.reaches[i].to === spring.id;
      if (!touches) expect(moved.reaches[i]).toBe(n.reaches[i]); // same reference (no re-smooth)
    }
  });
});
