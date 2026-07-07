// src/blueprint/parts/furnace.ts
//
// FURNACE — the craft-building heat structure that gives trade buildings their silhouette.
// A blacksmith's forge, a bakehouse's domed bread oven, and a brewhouse's oast/steam kiln are
// all "a masonry heat-mass with a flue", so ONE part with a `kind` variant serves all three
// (the catalogue building-types already name them: forge-hearth / bread-oven / steam-louver).
// Additive like the other structural parts (tower/chimney/porch): emits standalone masonry prims
// the geometry compiler unions alongside the body. Grey massing IS the identity here — no paint
// needed to read a forge flue from a house chimney.
import type { PartType } from '../registry';
import type { Part as Prim } from '@/assetgen/compose';
import { STOREY } from '@/assetgen/geometry/building';
import { mToTiles } from '@/render/scale-contract';

const cellsOf = (p: { at: { x: number; y: number }; size: { w: number; h: number } }): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) out.push([p.at.x + i, p.at.y + j]);
  return out;
};

export const furnacePartType: PartType = {
  type: 'furnace',
  paramSchema: {
    /** forge — a smithy hearth under a broad brick flue; oven — a domed masonry bread oven +
     *  flue stack; kiln — a brewhouse oast: a drum under a conical cap with a timber cowl. */
    kind: { kind: 'enum', values: ['forge', 'oven', 'kiln'], default: 'forge' },
  },
  resolve: (part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p): Prim[] {
    const kind = (p.params.kind as string) ?? 'forge';
    const { x, y } = p.at, { w, h } = p.size;
    const cx = x + w / 2, cy = y + h / 2;
    const r = Math.max(0.5, Math.min(w, h) / 2);

    if (kind === 'oven') {
      // Communal bakehouse: a beehive bread oven — a stone drum under a TALL smooth dome so it
      // reads as a dome, not a capped cylinder; a slim flue stub just pokes the apex.
      const drumH = mToTiles(1.2);
      const domeH = mToTiles(1.7);
      return [
        { prim: 'cylinder', center: [cx, cy], baseZ: 0, radius: r, height: drumH, material: 'stone' },
        { prim: 'cone', center: [cx, cy], baseZ: drumH, radius: r, height: domeH, material: 'stone' },
        // thin flue: rises through the dome and pokes a touch above its tip (a stub, not a cube).
        { prim: 'box', at: [cx - 0.125, cy - 0.125, drumH], size: [0.25, 0.25, domeH + mToTiles(0.3)], material: 'brick' },
      ];
    }

    if (kind === 'kiln') {
      // Brewhouse oast / steam louver: a tall stone drum under a POINTED conical tiled cap — the
      // oast silhouette — with a small timber cowl stub at the very tip.
      const drumH = mToTiles(2.2);
      const capH = mToTiles(3.0);
      return [
        { prim: 'cylinder', center: [cx, cy], baseZ: 0, radius: r, height: drumH, material: 'stone' },
        { prim: 'cone', center: [cx, cy], baseZ: drumH, radius: r, height: capH, material: 'tile' },
        // cowl: a slim timber stub poking just past the cone tip (the oast's swivel vent).
        { prim: 'box', at: [cx - 0.15, cy - 0.15, drumH + capH * 0.88], size: [0.3, 0.3, mToTiles(0.8)], material: 'timber' },
      ];
    }

    // Smithy forge (default): a squat stone hearth mass under a broad brick flue/hood that rises
    // well through the roof — the "tall flue" the catalogue names as the smithy's read.
    const hearthH = mToTiles(1.5);
    const flueTop = STOREY + mToTiles(2.4);
    const fw = Math.min(w, 1.0), fh = Math.min(h, 1.0);
    return [
      { prim: 'box', at: [x, y, 0], size: [w, h, hearthH], material: 'stone' },
      { prim: 'box', at: [cx - fw / 2, cy - fh / 2, hearthH], size: [fw, fh, flueTop - hearthH], material: 'brick' },
    ];
  },
  toCollision: (p) => cellsOf(p),
  toAnchors: () => [],
  toBrief: (p) => `${p.params.kind ?? 'forge'} furnace`,
};
