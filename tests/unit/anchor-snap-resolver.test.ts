// tests/unit/anchor-snap-resolver.test.ts
import { describe, it, expect } from 'vitest';
import { resolveAttach, attachInConnectome } from '@/world/anchor-snap-resolver';
import { node } from '@/world/connectome/world-node';
import type { Anchor } from '@/world/anchors';
import type { RoadPolyline } from '@/world/anchor-rules';

const stallService = (x: number, y: number, facing: [number, number]): Anchor => ({ kind: 'service', x, y, facing });
const deck: RoadPolyline = { id: 'deck0', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };

describe('resolveAttach', () => {
  it('attaches a stall service anchor onto a deck (road) it faces', () => {
    const link = resolveAttach({ source: [stallService(4, 1.5, [0, -1])], targetRoads: [deck] });
    expect(link).not.toBeNull();
    expect(link!.relation).toBe('serves');
    expect(link!.b.ownerId).toBe('deck0');
  });

  it('returns null when the stall faces away from the deck', () => {
    const link = resolveAttach({ source: [stallService(4, 1.5, [0, 1])], targetRoads: [deck] });
    expect(link).toBeNull();
  });

  it('attaches two wall ends (anchor↔anchor)', () => {
    const a: Anchor = { kind: 'wall_end', x: 2, y: 2, facing: [1, 0] };
    const b: Anchor = { kind: 'wall_end', x: 2.5, y: 2, facing: [-1, 0] };
    const link = resolveAttach({ source: [a], targetAnchors: [b] });
    expect(link?.relation).toBe('connects');
  });
});

describe('attachInConnectome', () => {
  it('records the resolved relation on the tree', () => {
    const root = node('world', 'region', {
      children: [node('stall', 'building(stall)'), node('bridge', 'bridge')],
    });
    const { root: next, link } = attachInConnectome(root, 'stall', 'bridge', {
      source: [stallService(4, 1.5, [0, -1])], targetRoads: [deck],
    });
    expect(link).not.toBeNull();
    const stall = next.children.find((c) => c.id === 'stall')!;
    expect(stall.relations).toContainEqual({ kind: 'serves', to: 'bridge' });
    // original tree untouched (pure)
    expect(root.children.find((c) => c.id === 'stall')!.relations).toHaveLength(0);
  });

  it('leaves the tree unchanged when nothing snaps', () => {
    const root = node('world', 'region', { children: [node('stall', 'building(stall)')] });
    const { root: next, link } = attachInConnectome(root, 'stall', 'bridge', {
      source: [stallService(4, 99, [0, -1])], targetRoads: [deck],
    });
    expect(link).toBeNull();
    expect(next).toBe(root);
  });
});
