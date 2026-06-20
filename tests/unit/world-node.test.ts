import { describe, it, expect } from 'vitest';
import {
  node, resolveParams, resolveTree, walk, find, collectByKind,
  composeInto, connect, setParam, removeNode, serializeCompact,
  CASCADING_PARAMS, type WorldNode,
} from '@/world/connectome/world-node';

// The Example B inhabited/gatehouse bridge from the design doc, as a buildable tree.
function inhabitedCrossing(): WorldNode {
  return node('crossing#2', 'crossing', {
    params: { era: 'late-medieval', prosperity: 'rich', style: 'region-X', biome: 'river-meadow' },
    relations: [{ kind: 'spans', to: 'river-reach#q' }],
    children: [
      node('bridge#2', 'bridge', {
        params: { material: 'dressed-stone', span: 8, arches: 3 },
        children: [
          node('deck#2', 'deck', {
            children: [
              node('shop#a', 'building(shop)'),
              node('shop#b', 'building(shop)'),
            ],
          }),
          node('gate#g', 'building(gatehouse)', { params: { fortified: true } }),
        ],
      }),
      node('apron#N', 'apron', {
        children: [node('toll#t', 'building(toll_booth)'), node('guard#s', 'building(guard_post)')],
      }),
      node('apron#S', 'apron', { children: [node('shrine#h', 'building(shrine)')] }),
    ],
  });
}

describe('param cascade', () => {
  it('inherits cascading site params down contains; node own values win; locals stay local', () => {
    const root = node('s', 'settlement', { params: { era: 'iron', prosperity: 'modest', biome: 'vale' } });
    const resolved = resolveParams({ material: 'thatch', prosperity: 'rich' }, { era: 'iron', prosperity: 'modest', biome: 'vale' });
    expect(resolved.era).toBe('iron');         // inherited
    expect(resolved.prosperity).toBe('rich');  // own override wins
    expect(resolved.biome).toBe('vale');       // inherited
    expect(resolved.material).toBe('thatch');  // local passes through
    expect(root.params.era).toBe('iron');
  });

  it('resolveTree flows era/prosperity/style/biome to every descendant (with overrides)', () => {
    const t = resolveTree(inhabitedCrossing());
    const find2 = (id: string): any => {
      let hit: any = null;
      const rec = (n: any) => { if (n.id === id) hit = n; n.children.forEach(rec); };
      rec(t); return hit;
    };
    // A deep leaf (shop on the deck) inherits the crossing's site params.
    const shop = find2('shop#a');
    expect(shop.params.era).toBe('late-medieval');
    expect(shop.params.prosperity).toBe('rich');
    expect(shop.params.biome).toBe('river-meadow');
    // The gatehouse keeps its local param AND inherits cascading ones.
    const gate = find2('gate#g');
    expect(gate.params.fortified).toBe(true);
    expect(gate.params.style).toBe('region-X');
  });

  it('does not mutate the input tree', () => {
    const root = inhabitedCrossing();
    const before = JSON.stringify(root);
    resolveTree(root);
    expect(JSON.stringify(root)).toBe(before);
  });

  it('CASCADING_PARAMS is the documented site-parameter set', () => {
    expect([...CASCADING_PARAMS]).toEqual(['era', 'prosperity', 'style', 'biome', 'scale']);
  });
});

describe('traversal', () => {
  it('walk visits the whole subtree pre-order with depth', () => {
    const ids: string[] = [];
    walk(inhabitedCrossing(), (n, d) => ids.push(`${d}:${n.id}`));
    expect(ids[0]).toBe('0:crossing#2');
    expect(ids).toContain('3:shop#a'); // crossing→bridge→deck→shop
  });

  it('find returns the first matching node, collectByKind matches exact + prefix', () => {
    const root = inhabitedCrossing();
    expect(find(root, (n) => n.id === 'toll#t')?.kind).toBe('building(toll_booth)');
    // "building on a bridge" falls out as nesting — collect every building leaf.
    const buildings = collectByKind(root, 'building');
    expect(buildings.map((b) => b.id).sort()).toEqual(['gate#g', 'guard#s', 'shop#a', 'shop#b', 'shrine#h', 'toll#t']);
  });
});

describe('agent graph-ops (pure — new tree, never mutate)', () => {
  it('composeInto adds a child (a cult claims the threshold)', () => {
    const root = node('apron', 'apron');
    const next = composeInto(root, 'apron', node('shrine#x', 'building(shrine)'));
    expect(root.children).toHaveLength(0);             // input untouched
    expect(next.children.map((c) => c.id)).toEqual(['shrine#x']);
  });

  it('connect adds a typed non-tree relation (mill serves the crossing)', () => {
    const root = node('mill', 'building(watermill)');
    const next = connect(root, 'mill', 'serves', 'crossing#2');
    expect(next.relations).toEqual([{ kind: 'serves', to: 'crossing#2' }]);
    expect(root.relations).toHaveLength(0);
  });

  it('setParam overrides one param (Fate raises prosperity)', () => {
    const root = inhabitedCrossing();
    const next = setParam(root, 'crossing#2', 'prosperity', 'opulent');
    expect(find(next, (n) => n.id === 'crossing#2')?.params.prosperity).toBe('opulent');
    expect(find(root, (n) => n.id === 'crossing#2')?.params.prosperity).toBe('rich');
  });

  it('removeNode drops a subtree anywhere; cannot remove the root', () => {
    const root = inhabitedCrossing();
    const next = removeNode(root, 'bridge#2');     // flood washes out the span
    expect(find(next, (n) => n.id === 'bridge#2')).toBeNull();
    expect(find(next, (n) => n.id === 'shop#a')).toBeNull(); // subtree gone too
    expect(removeNode(root, 'crossing#2')).toBe(root);       // root is unremovable
  });
});

describe('agent-legible serialization', () => {
  it('renders a compact indented tree with relations, resolving the cascade on request', () => {
    const out = serializeCompact(inhabitedCrossing(), { resolve: true });
    // Top node shows its site params + the spans edge.
    expect(out.split('\n')[0]).toContain('crossing#2: crossing');
    expect(out).toContain('─spans→ river-reach#q');
    // Nesting indents; a deep building leaf shows the inherited era.
    const shopLine = out.split('\n').find((l) => l.includes('shop#a'))!;
    expect(shopLine.startsWith('      ')).toBe(true); // depth 3 → 6 spaces
    expect(shopLine).toContain('era: late-medieval');
  });
});
