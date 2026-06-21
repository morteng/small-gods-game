// src/blueprint/parts/flora.ts
// Flora parts — trees as manifold-buildable primitives so they flow through the
// SAME generate→sprite pipeline as buildings (PBR-lit, cast shadows, day/night).
// A tree = a `bark` trunk cylinder + a `foliage` crown of ellipsoids/cones —
// standalone prims only (no `prim:'building'`), exactly like the yurt's round
// body, so `toGeometry` folds them with zero compiler changes.
//
// Trees are MANY (a forest = thousands), so they do NOT carry a per-entity
// blueprint: the render layer keys ONE cached sprite per species off the kind.
// The crown layout is therefore FIXED per form (deterministic, seedless — like
// the well/graveyard) since every instance of a species shares one sprite.
import type { PartType } from '../registry';
import type { Part as Prim } from '@/assetgen/compose';
import { mToTiles } from '@/render/scale-contract';

type TreeForm = 'broad' | 'conifer' | 'slender' | 'bare';
const FORMS: readonly TreeForm[] = ['broad', 'conifer', 'slender', 'bare'];

/** Trunk height as a fraction of total height, per crown form. */
const TRUNK_FRAC: Record<TreeForm, number> = { broad: 0.42, conifer: 0.16, slender: 0.46, bare: 0.95 };

/**
 * Game-feel stylization scale for trees. Metrically a pine is 18 m (9 tiles) and
 * towers ~3× over a cottage — realistic but it dwarfs the settlement. We render
 * trees at a fraction of true height so they read as charming game props, not a
 * forester's survey. `heightM`/`crownM` stay metric truth (briefs, billboard
 * fallback, any sim); only the rendered geometry shrinks. A future refinement
 * keys this per-context (smaller "ornamental" trees inside a settlement, full
 * size in the wild) — the part is the right home for that knob. (See
 * docs/.../render-trees-slice2-spec.md.)
 */
export const TREE_GAME_SCALE = 0.34;

const footprintCells = (p: { at: { x: number; y: number }; size: { w: number; h: number } }): Array<[number, number]> => {
  const cells: Array<[number, number]> = [];
  for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) cells.push([p.at.x + i, p.at.y + j]);
  return cells;
};

const BRIEF: Record<TreeForm, string> = {
  broad: 'a broad-crowned deciduous tree with dense rounded foliage',
  conifer: 'a tall conical evergreen conifer',
  slender: 'a slender birch with a narrow upright crown',
  bare: 'a bare dead tree, leafless branches against the sky',
};

/**
 * A single tree. `form` picks the crown silhouette; `heightM` (metres, matches
 * NATURE_HEIGHT_M) and `crownM` (crown diameter, metres) size it. Trunk = bark
 * cylinder; crown = foliage ellipsoids (broad/slender) or stacked cones (conifer);
 * `bare` is trunk + two stubby branch boxes, no foliage.
 */
export const treePartType: PartType = {
  type: 'tree',
  paramSchema: {
    form: { kind: 'enum', values: FORMS, default: 'broad' },
    heightM: { kind: 'number', min: 1, max: 40, default: 10 },
    crownM: { kind: 'number', min: 0.5, max: 16, default: 6 },
    trunkR: { kind: 'number', min: 0.04, max: 0.5, default: 0.16 },
  },
  resolve: (part) => ({ params: { form: 'broad', heightM: 10, crownM: 6, trunkR: 0.16, ...(part.params ?? {}) } }),
  toPrims(p): Prim[] {
    const form = p.params.form as TreeForm;
    const k = TREE_GAME_SCALE;
    const H = mToTiles((p.params.heightM as number) * k);          // total height (height-units)
    const crownR = mToTiles((p.params.crownM as number) * k) / 2;  // crown radius (tile-units)
    const trunkR = (p.params.trunkR as number) * k;
    const cx = p.at.x + p.size.w / 2, cy = p.at.y + p.size.h / 2;
    const trunkH = H * TRUNK_FRAC[form];

    const prims: Prim[] = [
      { prim: 'cylinder', center: [cx, cy], baseZ: 0, radius: trunkR, height: trunkH, material: 'bark' },
    ];

    if (form === 'bare') {
      // Two stubby leafless branch boxes reaching off the upper trunk.
      const bw = crownR * 0.9, bt = trunkR * 1.1;
      prims.push(
        { prim: 'box', at: [cx, cy - bt / 2, trunkH * 0.72], size: [bw, bt, bt], material: 'bark' },
        { prim: 'box', at: [cx - bw, cy - bt / 2, trunkH * 0.55], size: [bw, bt, bt], material: 'bark' },
      );
      return prims;
    }

    if (form === 'conifer') {
      // Two stacked point-topped cones (cone prim is radiusBase→0), narrowing up.
      const cBase = trunkH * 0.8;
      const span = H - cBase;
      prims.push(
        { prim: 'cone', center: [cx, cy], baseZ: cBase, radius: crownR, height: span * 0.66, material: 'foliage' },
        { prim: 'cone', center: [cx, cy], baseZ: cBase + span * 0.4, radius: crownR * 0.62, height: span * 0.6, material: 'foliage' },
      );
      return prims;
    }

    if (form === 'slender') {
      // One tall narrow ellipsoid crown.
      const base = trunkH * 0.85;
      const rz = (H - base) / 2;
      prims.push({ prim: 'ellipsoid', center: [cx, cy], baseZ: base, radii: [crownR, crownR, rz], material: 'foliage' });
      return prims;
    }

    // broad: a central ellipsoid + two smaller offset lobes for a rounded crown.
    const base = trunkH * 0.7;
    const rz = (H - base) / 2;
    const off = crownR * 0.5;
    prims.push(
      { prim: 'ellipsoid', center: [cx, cy], baseZ: base, radii: [crownR, crownR, rz], material: 'foliage' },
      { prim: 'ellipsoid', center: [cx + off, cy - off * 0.6], baseZ: base + rz * 0.2, radii: [crownR * 0.7, crownR * 0.7, rz * 0.7], material: 'foliage' },
      { prim: 'ellipsoid', center: [cx - off, cy + off * 0.5], baseZ: base + rz * 0.1, radii: [crownR * 0.66, crownR * 0.66, rz * 0.66], material: 'foliage' },
    );
    return prims;
  },
  toCollision: (p) => footprintCells(p),
  toAnchors: () => [],
  toBrief: (p) => BRIEF[(p.params.form as TreeForm) ?? 'broad'],
};
