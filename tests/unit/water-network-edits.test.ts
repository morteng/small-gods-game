import { describe, it, expect } from 'vitest';
import { generateHydrology } from '@/terrain/hydrology';
import { buildWaterNetwork } from '@/terrain/river-network';
import { applyNodeMoves, mergeWaterFeatures, addLakeBody } from '@/terrain/water-network-edits';
import { suggestWaterResolutions } from '@/world/connectome/water-nodes';
import { computePressure } from '@/world/connectome/pressure';
import { waterPressureItems } from '@/world/connectome/water-nodes';
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

// A 5×5 valley with a closed pit that fills to a lake spilling into a channel (from the
// river-network suite) — gives us a lake body + junctions to merge.
const LAKE_VALLEY = [
  0.9, 0.9, 0.9, 0.9, 0.9,
  0.9, 0.9, 0.9, 0.9, 0.9,
  0.8, 0.2, 0.55, 0.45, 0.1,
  0.9, 0.9, 0.9, 0.9, 0.9,
  0.9, 0.9, 0.9, 0.9, 0.9,
];
function lakeNet() {
  const hydro = generateHydrology(field(LAKE_VALLEY), { seed: 1, width: 5, height: 5, seaLevel: 0.05 }, { riverFlowThreshold: 2 });
  return buildWaterNetwork(hydro, 5, 5);
}

describe('water network merging — join, don\'t always push apart', () => {
  it('joins a junction to a lake: the lake becomes its source (lake-fed)', () => {
    const n = lakeNet();
    const lake = n.lakes[0];
    const junc = n.nodes.find((x) => x.kind === 'spring') ?? n.nodes[0];
    const merged = mergeWaterFeatures(n, lake.id, junc.id);
    const node = merged.byId.get(junc.id)!;
    expect(['lake_outlet', 'lake_inlet']).toContain(node.kind);
    const l = merged.lakes.find((x) => x.id === lake.id)!;
    expect(l.outletIds.includes(junc.id) || l.inletIds.includes(junc.id)).toBe(true);
  });

  it('absorbs one headwater into another: the dropped node and its edges are gone', () => {
    const n = net();
    const springs = n.nodes.filter((x) => x.kind === 'spring');
    expect(springs.length).toBeGreaterThanOrEqual(2);
    const [keep, drop] = springs;
    const merged = mergeWaterFeatures(n, keep.id, drop.id);
    expect(merged.nodes.length).toBe(n.nodes.length - 1);
    expect(merged.byId.has(drop.id)).toBe(false);
    expect(merged.reaches.every((r) => r.from !== drop.id && r.to !== drop.id)).toBe(true);
  });

  it('is pure and a no-op for self-merge / unknown ids', () => {
    const n = net();
    const id = n.nodes[0].id;
    expect(mergeWaterFeatures(n, id, id)).toBe(n);
    expect(mergeWaterFeatures(n, id, 'nope:404')).toBe(n);
    const before = n.nodes.length;
    mergeWaterFeatures(n, n.nodes[0].id, n.nodes[1].id);
    expect(n.nodes.length).toBe(before); // input untouched
  });

  it('suggests MERGE for a channel meeting a lake, SEPARATE for unrelated', () => {
    const n = lakeNet();
    const items = waterPressureItems(n, 6, 6);   // inflate clearance so features impinge
    const resolved = suggestWaterResolutions(n, computePressure(items).pairs);
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved.some((r) => r.resolution === 'merge')).toBe(true);
    // every merge suggestion carries a human/agent-legible reason
    for (const r of resolved) expect(r.reason.length).toBeGreaterThan(0);
  });
});

describe('addLakeBody — stamp an author-placed lake (DIR-A)', () => {
  it('appends one classified disc body, leaving the input untouched', () => {
    const n = net();
    const before = n.lakes.length;
    const out = addLakeBody(n, { id: 'wl:placed:0', cx: 1, cy: 1, radius: 1 });
    expect(n.lakes.length).toBe(before);          // pure — input unchanged
    expect(out.lakes.length).toBe(before + 1);
    const lake = out.lakes[out.lakes.length - 1];
    expect(lake.id).toBe('wl:placed:0');
    expect(lake.area).toBe(lake.cells.length);
    expect(lake.area).toBeGreaterThan(0);
    expect(lake.klass).toBeDefined();
    // centroid lands near the stamp centre
    expect(lake.x).toBeCloseTo(1, 1);
    expect(lake.y).toBeCloseTo(1, 1);
  });

  it('every stamped cell lies within the radius and on the grid', () => {
    const n = net();                 // 3×3 grid
    const out = addLakeBody(n, { id: 'wl:placed:0', cx: 1, cy: 1, radius: 1 });
    const lake = out.lakes[out.lakes.length - 1];
    for (const c of lake.cells) {
      const x = c % n.width, y = (c / n.width) | 0;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(n.width);
      expect((x - 1) ** 2 + (y - 1) ** 2).toBeLessThanOrEqual(1);
    }
  });

  it('an off-map stamp produces no cells and returns the input unchanged', () => {
    const n = net();
    expect(addLakeBody(n, { id: 'x', cx: 99, cy: 99, radius: 1 })).toBe(n);
  });

  it('is deterministic — same stamp → identical cells', () => {
    const n = net();
    const la = addLakeBody(n, { id: 'a', cx: 1, cy: 1, radius: 1 }).lakes;
    const lb = addLakeBody(n, { id: 'a', cx: 1, cy: 1, radius: 1 }).lakes;
    expect(la[la.length - 1].cells).toEqual(lb[lb.length - 1].cells);
  });
});
