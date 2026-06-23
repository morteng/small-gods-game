import { describe, it, expect } from 'vitest';
import { generateHydrology } from '@/terrain/hydrology';
import { buildWaterNetwork } from '@/terrain/river-network';
import { waterNetworkToConnectome } from '@/world/connectome/water-nodes';
import { collectByKind, walk, serializeCompact } from '@/world/connectome/world-node';
import { type TerrainField } from '@/core/types';

function field(elev: number[]): TerrainField {
  return {
    elevation: new Float32Array(elev),
    moisture: new Float32Array(elev.length),
    temperature: new Float32Array(elev.length),
  };
}

// The Y-confluence fixture from the river-network suite: two springs merge, exit at edge.
const CONFLUENCE = [0.9, 1.0, 0.9, 0.5, 0.4, 0.5, 1.0, 0.1, 1.0];

function net() {
  const hydro = generateHydrology(field(CONFLUENCE), { seed: 1, width: 3, height: 3, seaLevel: 0.0 }, { riverFlowThreshold: 2 });
  return buildWaterNetwork(hydro, 3, 3);
}

describe('water → world connectome', () => {
  it('lifts every junction and reach into the water_system tree', () => {
    const n = net();
    const root = waterNetworkToConnectome(n);
    expect(root.kind).toBe('water_system');
    // One WorldNode per water node + one per reach.
    let count = 0;
    walk(root, () => count++);
    expect(count).toBe(1 + n.nodes.length + n.reaches.length);
    expect(collectByKind(root, 'reach').length).toBe(n.reaches.length);
    expect(collectByKind(root, 'spring').length).toBe(n.nodes.filter((w) => w.kind === 'spring').length);
  });

  it('every reach connects to two real endpoint nodes (a navigable graph)', () => {
    const root = waterNetworkToConnectome(net());
    const ids = new Set<string>();
    walk(root, (w) => ids.add(w.id));
    for (const reach of collectByKind(root, 'reach')) {
      const conns = reach.relations.filter((r) => r.kind === 'connects');
      expect(conns.length).toBe(2);
      for (const c of conns) expect(ids.has(c.to)).toBe(true); // endpoint exists in the tree
      expect(reach.params.klass).toBeDefined();
      expect(reach.params.water).toBe(true);
    }
  });

  it('reuses water-network ids so crossings can span a reach by id', () => {
    const n = net();
    const root = waterNetworkToConnectome(n);
    const reachIds = new Set(collectByKind(root, 'reach').map((r) => r.id));
    for (const r of n.reaches) expect(reachIds.has(r.id)).toBe(true);
  });

  it('stamps feature tags from the resolver onto nodes (the integration seam)', () => {
    const root = waterNetworkToConnectome(net(), { tagsAt: () => ['temperate', 'near:hamlet'] });
    let tagged = 0;
    walk(root, (w) => { if (Array.isArray(w.params.tags) && (w.params.tags as string[]).includes('near:hamlet')) tagged++; });
    expect(tagged).toBeGreaterThan(0);
  });

  it('serializes compactly for an agent to read', () => {
    const root = waterNetworkToConnectome(net());
    const txt = serializeCompact(root);
    expect(txt).toContain('water_system');
    expect(txt).toContain('reach');
    expect(txt).toContain('connects→');
  });

  it('is deterministic — same network yields identical node ids/kinds', () => {
    const a = serializeCompact(waterNetworkToConnectome(net()));
    const b = serializeCompact(waterNetworkToConnectome(net()));
    expect(a).toBe(b);
  });
});
