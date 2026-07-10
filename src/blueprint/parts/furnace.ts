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
    /** forge only: which way the open hearth mouth faces (the back wall sits opposite,
     *  against the body). Pick the direction away from the body it abuts. */
    mouth: { kind: 'enum', values: ['north', 'south', 'east', 'west'], default: 'east' },
  },
  resolve: (part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p): Prim[] {
    const kind = (p.params.kind as string) ?? 'forge';
    const { x, y } = p.at, { w, h } = p.size;
    const cx = x + w / 2, cy = y + h / 2;
    const r = Math.max(0.5, Math.min(w, h) / 2);

    if (kind === 'oven') {
      // Communal bakehouse: a stone beehive bread oven BULGING from the gable — a low stone drum
      // topped by a smooth HEMISPHERICAL dome (widest at its base, sat flush on the drum so it
      // reads as a dome, never a capped cylinder or a flat drum), with a slim flue off the crown.
      // The dome hugs the furnace cell's -x edge (the body wall) so it reads as a bulge on the
      // gable, not a detached silo. Its lower hemisphere is buried inside the drum → nothing dips
      // below z=0 (an underground bulge would extend the sprite silhouette below the wall foot).
      const rDome = Math.min(0.85, Math.max(0.5, Math.min(w, h) / 2));
      const dcx = x + rDome, dcy = cy;
      const rz = mToTiles(1.4);   // dome vertical radius; drum height = rz so the equator sits flush
      // Tall square stone flue stack rising from behind the dome (toward the rear gable), well
      // clear of the crown — the bakehouse's read from a distance, like the reference's chimney.
      const fw = 0.5, fx = dcx - fw / 2, fy = dcy - rDome * 0.55 - fw / 2;
      const fTop = STOREY + mToTiles(1.4);
      return [
        { prim: 'cylinder', center: [dcx, dcy], baseZ: 0, radius: rDome, height: rz, material: 'stone' },
        { prim: 'ellipsoid', center: [dcx, dcy], baseZ: 0, radii: [rDome, rDome, rz], material: 'stone' },
        { prim: 'box', at: [fx, fy, 0], size: [fw, fw, fTop], material: 'stone' },
      ];
    }

    if (kind === 'kiln') {
      // Brewhouse oast / steam louver: a round stone drum under a pointed conical tiled
      // cap — the oast silhouette — with a small timber cowl box at the tip. Proportions
      // anchored to the reference: drum ≈ body wall height, cap ≈ 80% of drum (shorter,
      // not taller), cap overhangs the drum (eaves), drum+cap ≈ main roof ridge height.
      // The cowl is a single small box on the cone tip — at grey-massing scale thin posts
      // and a peaked cap read as a disconnected floating block, so we keep it simple;
      // the img2img pass paints the swivel vent + gable roof detail.
      const drumH = STOREY;                     // ≈ wall height (2.7 m)
      const capH = drumH * 0.8;                 // ref: cap ~80% of drum
      const capR = r * 1.15;                    // visible eaves overhang past the drum
      const cowlW = mToTiles(0.5);              // small boxy vent
      const cowlH = mToTiles(0.3);             // squat box (not a tall stack)
      const cowlZ = drumH + capH - mToTiles(0.1); // nestled into the cone tip
      return [
        { prim: 'cylinder', center: [cx, cy], baseZ: 0, radius: r, height: drumH, material: 'stone' },
        { prim: 'cone', center: [cx, cy], baseZ: drumH, radius: capR, height: capH, material: 'tile' },
        // boxy timber cowl nestled at the cone tip.
        { prim: 'box', at: [cx - cowlW / 2, cy - cowlW / 2, cowlZ], size: [cowlW, cowlW, cowlH], material: 'timber' },
      ];
    }

    // Smithy forge (default): a chimney BREAST with an OPEN hearth mouth — the smithy-2
    // reference read (a wall-mounted breast whose arch faces out, near the rear of the
    // range). Stone cheeks + a back wall against the body frame a mouth opening `mouth`-
    // ward; a brick breast spans the mouth to the eaves and carries a narrower brick
    // stack past the ridge, finished with a corbelled cap plate. The old full-cell
    // "bench slab + centred flue" read as an empty terrace with a detached brick box —
    // the mouth is what makes it a forge in grey.
    const mouth = (p.params.mouth as string) ?? 'east';
    const cheekT = 0.18;                     // 0.36 m masonry cheeks framing the mouth
    const backT = 0.2;                       // back wall against the body
    const mouthH = mToTiles(1.7);            // hearth opening height (paint rounds the arch)
    const breastTop = STOREY;                // masonry breast up to the eaves line
    const flueTop = STOREY + mToTiles(2.4);  // stack clears the ridge
    const capT = mToTiles(0.25);
    const sw = w * 0.7, sh = h * 0.7;        // stack narrower than the breast
    const alongX = mouth === 'east' || mouth === 'west';   // mouth axis runs along x
    const cheeks: Prim[] = alongX
      ? [{ prim: 'box', at: [x, y, 0], size: [w, cheekT, mouthH], material: 'stone' },
         { prim: 'box', at: [x, y + h - cheekT, 0], size: [w, cheekT, mouthH], material: 'stone' }]
      : [{ prim: 'box', at: [x, y, 0], size: [cheekT, h, mouthH], material: 'stone' },
         { prim: 'box', at: [x + w - cheekT, y, 0], size: [cheekT, h, mouthH], material: 'stone' }];
    const back: Prim = mouth === 'east' ? { prim: 'box', at: [x, y, 0], size: [backT, h, mouthH], material: 'stone' }
      : mouth === 'west' ? { prim: 'box', at: [x + w - backT, y, 0], size: [backT, h, mouthH], material: 'stone' }
      : mouth === 'south' ? { prim: 'box', at: [x, y, 0], size: [w, backT, mouthH], material: 'stone' }
      : { prim: 'box', at: [x, y + h - backT, 0], size: [w, backT, mouthH], material: 'stone' };
    return [
      ...cheeks, back,
      { prim: 'box', at: [x, y, mouthH], size: [w, h, breastTop - mouthH], material: 'brick' },
      { prim: 'box', at: [cx - sw / 2, cy - sh / 2, breastTop], size: [sw, sh, flueTop - breastTop], material: 'brick' },
      { prim: 'box', at: [cx - sw / 2 - 0.06, cy - sh / 2 - 0.06, flueTop], size: [sw + 0.12, sh + 0.12, capT], material: 'brick' },
    ];
  },
  toCollision: (p) => cellsOf(p),
  toAnchors: () => [],
  // A geometry-true phrase for the image prompt — the furnace IS the craft building's tell, so it
  // must be named for the model (an "oven furnace" tag draws nothing). Kept free of the words the
  // prompt-truth guard bans for absent features (no "chimney" — a flue is not a chimney).
  toBrief: (p) => {
    const kind = (p.params.kind as string) ?? 'forge';
    if (kind === 'oven') return 'a domed masonry bread oven with a slim flue, bulging from one gable';
    if (kind === 'kiln') return 'an oast kiln — a stone drum under a conical cap with a timber cowl';
    return 'an open forge hearth under a tall brick flue';
  },
};
