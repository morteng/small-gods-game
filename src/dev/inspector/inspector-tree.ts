import type { World } from '@/world/world';
import type { GameMap, GeneratedDecoration, WorldSeed, Entity } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { Selection } from './selection';

export interface TreeNode {
  id: string;
  label: string;
  selection?: Selection;
  children?: TreeNode[];
  defaultOpen?: boolean;
}

export function buildInspectorTree(
  world: World | null,
  _map: GameMap | null,
  spirits: Map<SpiritId, Spirit>,
  decorations: GeneratedDecoration[],
  seed: WorldSeed | null,
): TreeNode {
  if (!world) {
    return { id: 'root', label: '∅ No world loaded' };
  }

  const all = world.registry.all();
  const children: TreeNode[] = [];

  children.push({ id: 'seed', label: '⚙ Seed & generation', selection: { type: 'world' } });
  children.push({ id: 'lore', label: '📖 Lore', selection: { type: 'lore' } });

  const pois = seed?.pois ?? [];
  children.push({
    id: 'pois',
    label: `📍 POIs (${pois.length})`,
    children: pois.map(p => ({
      id: `poi:${p.id}`,
      label: p.name ?? p.id,
      selection: { type: 'poi', id: p.id } as Selection,
    })),
  });

  const byKind = new Map<string, Entity[]>();
  for (const e of all) {
    const list = byKind.get(e.kind) ?? [];
    list.push(e);
    byKind.set(e.kind, list);
  }
  const kindNodes: TreeNode[] = Array.from(byKind.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([kind, list]) => ({
      id: `kind:${kind}`,
      label: `${kind} (${list.length})`,
      children: list
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(e => ({
          id: `entity:${e.id}`,
          label: entityLabel(e),
          selection: { type: 'entity', id: e.id } as Selection,
        })),
    }));
  children.push({ id: 'kinds', label: '🧩 Entities by kind', children: kindNodes, defaultOpen: true });

  children.push({
    id: 'spirits',
    label: `✨ Spirits (${spirits.size})`,
    children: Array.from(spirits.values()).map(s => ({
      id: `spirit:${s.id}`,
      label: `${s.sigil} ${s.name}${s.isPlayer ? ' 👑' : ''}`,
      selection: { type: 'spirit', id: s.id } as Selection,
    })),
  });

  children.push({
    id: 'decorations',
    label: `🎨 Decorations (${decorations.length})`,
    children: decorations.map((d, i) => ({
      id: `deco:${i}`,
      label: `${d.assetId} (${d.tileX},${d.tileY})`,
      selection: { type: 'decoration', index: i } as Selection,
    })),
  });

  return {
    id: 'root',
    label: `🌍 World "${seed?.name ?? 'unknown'}"`,
    selection: { type: 'world' },
    defaultOpen: true,
    children,
  };
}

function entityLabel(e: Entity): string {
  const name = (e.properties as { name?: string } | undefined)?.name;
  return name ? `${name} · ${e.id}` : e.id;
}

/**
 * Return a copy of the tree containing only nodes whose label matches `term`
 * (case-insensitive) or which have a matching descendant. Returns null if
 * nothing matches. Empty term returns the tree unchanged.
 */
export function filterTree(node: TreeNode, term: string): TreeNode | null {
  const q = term.trim().toLowerCase();
  if (!q) return node;
  const selfMatch = node.label.toLowerCase().includes(q);
  const keptChildren = (node.children ?? [])
    .map(c => filterTree(c, q))
    .filter((c): c is TreeNode => c !== null);
  if (selfMatch) return { ...node, children: keptChildren };
  if (keptChildren.length > 0) return { ...node, children: keptChildren };
  return null;
}
