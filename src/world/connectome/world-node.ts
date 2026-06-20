// src/world/connectome/world-node.ts
//
// The Unified World Connectome — v0 core model.
// See docs/superpowers/specs/2026-06-20-unified-world-connectome-design.md.
//
// ONE composable, scale-free vocabulary for ALL worldbuilding structure: a cottage, a
// stone arch, an inhabited bridge that carries shops, a hamlet, a region — every one is a
// `WorldNode`. Composition is `contains` (the scale-free workhorse: a deck contains a
// shop, an apron contains a toll booth, a settlement contains lots); three more typed
// relations (`connects`, `spans`, `serves`) carry the non-tree edges. Site parameters
// (era / prosperity / style / biome / scale) CASCADE down `contains` with local override,
// so "all the relevant parameters" resolve once at the top and flow to every descendant —
// Blueprint's layered-patch idea, lifted to world scale.
//
// This module is the pure data layer ONLY: the node type, the parameter cascade, tree
// traversal, the agent-legible serialization, and the basic graph-ops agents use to build
// and modify the world (compose / connect / setParam / remove). Realization (kind →
// generator → geometry/art) and the road×water crossing PRODUCER are separate layers that
// consume this. No rendering, no randomness, no I/O — fully unit-testable.

/** Typed edges. `contains` is implicit in the `children` tree; the rest live in `relations`. */
export type RelationKind = 'contains' | 'connects' | 'spans' | 'serves';

/** Non-containment edge from a node to another node id. */
export interface Relation {
  kind: Exclude<RelationKind, 'contains'>;
  to: string;
}

/**
 * Node parameters. The CASCADING keys (see {@link CASCADING_PARAMS}) inherit down `contains`
 * unless a descendant overrides them; everything else is local to the node (material, role,
 * span, fortified, …). Free-form by design — `kind` decides which locals matter.
 */
export interface WorldNodeParams {
  era?: string;
  prosperity?: string;
  style?: string;
  biome?: string;
  scale?: string;
  [k: string]: unknown;
}

/** The site parameters that flow down the `contains` tree (override allowed at any depth). */
export const CASCADING_PARAMS = ['era', 'prosperity', 'style', 'biome', 'scale'] as const;
export type CascadingParam = (typeof CASCADING_PARAMS)[number];

/**
 * A place/structure at any scale. `kind` is an open, fact-DB-backed vocabulary — LEAF kinds
 * (`building(*)`, `deck`, `pier`, …) are realized directly by a generator; INTERIOR kinds
 * (`crossing`, `bridge`, `apron`, `settlement`, …) compose `children`. `anchor` is the
 * spatial-coordination footprint origin (optional until a node is placed).
 */
export interface WorldNode {
  id: string;
  kind: string;
  params: WorldNodeParams;
  anchor?: { x: number; y: number };
  /** `contains` children — the scale-free composition. */
  children: WorldNode[];
  /** Non-containment edges (`connects` / `spans` / `serves`). */
  relations: Relation[];
}

/** Construct a node with sensible empty defaults. Pure. */
export function node(
  id: string,
  kind: string,
  opts: { params?: WorldNodeParams; anchor?: { x: number; y: number }; children?: WorldNode[]; relations?: Relation[] } = {},
): WorldNode {
  return {
    id,
    kind,
    params: { ...(opts.params ?? {}) },
    anchor: opts.anchor,
    children: opts.children ?? [],
    relations: opts.relations ?? [],
  };
}

/** The cascading subset of a params bag (the keys that flow to children). */
function cascadingSubset(p: WorldNodeParams): Partial<Record<CascadingParam, string>> {
  const out: Partial<Record<CascadingParam, string>> = {};
  for (const k of CASCADING_PARAMS) {
    const v = p[k];
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Resolve one node's params given the cascading params inherited from its parent: the node's
 * own values win, missing cascading keys fall back to the inherited ones, locals pass through.
 * Pure — does not mutate the node.
 */
export function resolveParams(
  ownParams: WorldNodeParams,
  inheritedCascading: Partial<Record<CascadingParam, string>>,
): WorldNodeParams {
  return { ...inheritedCascading, ...ownParams };
}

/** A node whose params have been resolved against the cascade (full subtree). */
export interface ResolvedNode extends Omit<WorldNode, 'children'> {
  params: WorldNodeParams;
  children: ResolvedNode[];
}

/**
 * Resolve the parameter cascade over a whole subtree: each node inherits the cascading
 * params of its ancestors (nearest override wins), locals stay local. Returns a parallel
 * tree with fully-resolved `params`; the input is untouched.
 */
export function resolveTree(
  root: WorldNode,
  inheritedCascading: Partial<Record<CascadingParam, string>> = {},
): ResolvedNode {
  const params = resolveParams(root.params, inheritedCascading);
  const nextInherited = cascadingSubset(params);
  return {
    ...root,
    params,
    children: root.children.map((c) => resolveTree(c, nextInherited)),
  };
}

/** Depth-first visit of a node and all its `contains` descendants (pre-order). */
export function walk(root: WorldNode, fn: (n: WorldNode, depth: number) => void, depth = 0): void {
  fn(root, depth);
  for (const c of root.children) walk(c, fn, depth + 1);
}

/** First node in the subtree (pre-order) matching `pred`, or null. */
export function find(root: WorldNode, pred: (n: WorldNode) => boolean): WorldNode | null {
  let hit: WorldNode | null = null;
  walk(root, (n) => { if (!hit && pred(n)) hit = n; });
  return hit;
}

/** Every node in the subtree whose `kind` matches (exact, or by prefix like `building`). */
export function collectByKind(root: WorldNode, kind: string): WorldNode[] {
  const out: WorldNode[] = [];
  walk(root, (n) => { if (n.kind === kind || n.kind.startsWith(`${kind}(`)) out.push(n); });
  return out;
}

// ── Agent graph-ops — the build/modify surface (pure: return a NEW tree, never mutate) ──

function mapTree(root: WorldNode, f: (n: WorldNode) => WorldNode): WorldNode {
  const mapped = f(root);
  return { ...mapped, children: mapped.children.map((c) => mapTree(c, f)) };
}

/** Add `child` to the `contains` of the node with id `parentId`. Returns a new tree. */
export function composeInto(root: WorldNode, parentId: string, child: WorldNode): WorldNode {
  return mapTree(root, (n) =>
    n.id === parentId ? { ...n, children: [...n.children, child] } : n);
}

/** Add a typed relation (`connects`/`spans`/`serves`) from `fromId` to `toId`. New tree. */
export function connect(root: WorldNode, fromId: string, rel: Relation['kind'], toId: string): WorldNode {
  return mapTree(root, (n) =>
    n.id === fromId ? { ...n, relations: [...n.relations, { kind: rel, to: toId }] } : n);
}

/** Set/override one param on the node with id `targetId` (e.g. Fate raising prosperity). New tree. */
export function setParam(root: WorldNode, targetId: string, key: string, value: unknown): WorldNode {
  return mapTree(root, (n) =>
    n.id === targetId ? { ...n, params: { ...n.params, [key]: value } } : n);
}

/** Remove the node with id `targetId` (and its subtree) from anywhere in the tree. New tree.
 *  Returns the root unchanged if `targetId` is the root itself (can't remove the root). */
export function removeNode(root: WorldNode, targetId: string): WorldNode {
  if (root.id === targetId) return root;
  const prune = (n: WorldNode): WorldNode => ({
    ...n,
    children: n.children.filter((c) => c.id !== targetId).map(prune),
  });
  return prune(root);
}

/**
 * Compact, LLM-legible serialization of a sub-connectome — the form an agent reads to reason
 * about "the crossing, its bridge, its toll booth". Indentation = `contains`; non-tree edges
 * trail their node. Optionally resolves the param cascade first so inherited site params show.
 */
export function serializeCompact(root: WorldNode, opts: { resolve?: boolean } = {}): string {
  const tree = opts.resolve ? resolveTree(root) : root;
  const lines: string[] = [];
  const fmtParams = (p: WorldNodeParams): string => {
    const entries = Object.entries(p).filter(([, v]) => v !== undefined);
    return entries.length ? ` {${entries.map(([k, v]) => `${k}: ${v}`).join(', ')}}` : '';
  };
  const rec = (n: WorldNode | ResolvedNode, depth: number): void => {
    const pad = '  '.repeat(depth);
    const rels = n.relations.length ? '  ' + n.relations.map((r) => `─${r.kind}→ ${r.to}`).join('  ') : '';
    lines.push(`${pad}${n.id}: ${n.kind}${fmtParams(n.params)}${rels}`);
    for (const c of n.children) rec(c, depth + 1);
  };
  rec(tree, 0);
  return lines.join('\n');
}
