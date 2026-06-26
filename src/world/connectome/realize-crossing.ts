// src/world/connectome/realize-crossing.ts
//
// Crossing REALIZATION (layout half) — a crossing `WorldNode` → a flat list of placed
// `Placement`s the renderer can draw. This is the "kind → geometry" dispatch: it resolves
// the parameter cascade, then lays each realizable node out in tile space relative to the
// two bank anchors the detector supplied. It produces POSITIONS + a coarse category; what
// each placement looks like (grey massing now, generated art when the reseed freeze lifts)
// is the renderer's job, not this layer's.
//
// Pure: tile-space geometry only, no rendering, no entity spawning, no randomness. The
// renderer (and later the building pipeline) consume `Placement[]`.

import { resolveTree, type WorldNode, type WorldNodeParams } from './world-node';

export type PlacementCategory = 'span' | 'pier' | 'arch' | 'building' | 'apron' | 'feature';

export interface Placement {
  nodeId: string;
  kind: string;
  category: PlacementCategory;
  /** Tile-space centre. */
  at: { x: number; y: number };
  /** Facing/long axis as a unit vector (span direction for the deck, road normal for banks). */
  dir: { x: number; y: number };
  /** Resolved params (site cascade applied) — material/era/prosperity/style/etc. */
  params: WorldNodeParams;
}

const sub = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: { x: number; y: number }, s: number) => ({ x: a.x * s, y: a.y * s });
const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => add(a, scale(sub(b, a), t));
function unit(a: { x: number; y: number }): { x: number; y: number } {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
}

/**
 * Lay a crossing connectome out into placements. Geometry is anchored on the two bank
 * aprons (`params.side: 'near' | 'far'`, each carrying an `anchor` from detection); the
 * deck spans between them, piers space along it, deck buildings sit on the span line, and
 * apron buildings cluster just inland of their bank. A crossing with no bank anchors yields
 * an empty list (nothing to place) rather than guessing.
 */
export function realizeCrossing(crossing: WorldNode): Placement[] {
  const tree = resolveTree(crossing);
  // Bank anchors (near/far) from the apron nodes.
  let near: { x: number; y: number } | undefined;
  let far: { x: number; y: number } | undefined;
  for (const c of tree.children) {
    if (c.kind === 'apron') {
      if (c.params.side === 'near') near = c.anchor;
      else if (c.params.side === 'far') far = c.anchor;
    }
  }
  if (!near || !far) return [];

  const axis = unit(sub(far, near));            // span direction (near → far)
  const perp = { x: -axis.y, y: axis.x };       // across the road
  const mid = lerp(near, far, 0.5);
  const out: Placement[] = [];

  const bridge = tree.children.find((c) => c.kind === 'bridge');
  if (bridge) {
    // Deck: one span placement at the midpoint, oriented along the axis.
    const deck = bridge.children.find((c) => c.kind === 'deck');
    if (deck) out.push({ nodeId: deck.id, kind: deck.kind, category: 'span', at: mid, dir: axis, params: deck.params });

    // Piers: evenly spaced between the banks (skip the very ends, which sit on land).
    const piers = bridge.children.filter((c) => c.kind === 'pier');
    piers.forEach((p, i) => {
      const t = (i + 1) / (piers.length + 1);
      out.push({ nodeId: p.id, kind: p.kind, category: 'pier', at: lerp(near!, far!, t), dir: axis, params: p.params });
    });

    // Arches: one masonry bay per gap, marching across the span at the bay midpoints. With N
    // arches the deck reads as N spans springing between the piers — a multi-arch viaduct rather
    // than a flat slab. Each carries the span axis so the frame yaws to face across the water.
    const archNodes = bridge.children.filter((c) => c.kind === 'arch_span');
    archNodes.forEach((a, i) => {
      const t = (i + 0.5) / archNodes.length;
      out.push({ nodeId: a.id, kind: a.kind, category: 'arch', at: lerp(near!, far!, t), dir: axis, params: a.params });
    });

    // Deck buildings (shops on the span): spread along the deck line, offset to one side.
    const deckBuildings = (deck?.children ?? []).filter((c) => c.kind.startsWith('building('));
    deckBuildings.forEach((b, i) => {
      const t = 0.35 + 0.3 * i;                  // spaced across the middle of the span
      const base = lerp(near!, far!, Math.min(0.7, t));
      out.push({ nodeId: b.id, kind: b.kind, category: 'building', at: add(base, scale(perp, 0.6)), dir: perp, params: b.params });
    });

    // Gatehouse: at the near deck end.
    const gate = bridge.children.find((c) => c.kind === 'building(gatehouse)');
    if (gate) out.push({ nodeId: gate.id, kind: gate.kind, category: 'building', at: lerp(near, far, 0.12), dir: axis, params: gate.params });
  }

  // Apron buildings: cluster just inland of each bank, stepped along the road normal.
  for (const apron of tree.children.filter((c) => c.kind === 'apron')) {
    const bank = apron.params.side === 'near' ? near : far;
    const inland = apron.params.side === 'near' ? scale(axis, -1) : axis; // away from the water
    const buildings = apron.children.filter((c) => c.kind.startsWith('building('));
    buildings.forEach((b, i) => {
      const along = add(bank, scale(inland, 1.2 + i * 0.2));
      const side = scale(perp, (i % 2 === 0 ? 1 : -1) * 1.0);
      out.push({ nodeId: b.id, kind: b.kind, category: 'building', at: add(along, side), dir: perp, params: b.params });
    });
  }

  // Free-standing serving structures (e.g. watermill): just off the near bank, waterward.
  for (const c of tree.children) {
    if (c.kind.startsWith('building(') && c.relations.some((r) => r.kind === 'serves')) {
      out.push({ nodeId: c.id, kind: c.kind, category: 'building', at: add(mid, scale(perp, 1.4)), dir: perp, params: c.params });
    }
  }

  return out;
}
