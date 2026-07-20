// src/assetgen/geometry/post-spec.ts
// A stout timber CORNER POST / watchpost for a palisade or timber-wall ring — the wooden analogue
// of the masonry corner drum. Two straight stake runs meeting at a right angle leave a raw seam;
// a real stockade capped the corner with a heavy squared post (often raised as a lookout). This
// covers that joint and rises above the stakes, so a wooden ring reads as INTENTIONALLY cornered.
//
// Expressed as composeStructure prims so it rides the same lit pipeline + composites into one
// sprite, like the tower / gate specs. Pure prim emission; the source composes + caches it.
import type { Part } from '@/assetgen/compose';
import type { Mat } from '@/assetgen/types';
import { mToTiles } from '@/render/scale-contract';
import type { Anchor } from '@/world/anchors';

export interface PostOpts {
  /** Curtain (palisade) height it caps, cube-units — the post rises above it. */
  curtainHeight: number;
  /** Curtain thickness, cube-units — the post is sized to overlap both stake runs. */
  curtainThickness: number;
  material?: Mat;
}

export interface PostSpec {
  parts: Part[];
  /** z=0 mount anchor at the post's base CENTRE — the source lands it on the ring corner. */
  mountAnchors: Anchor[];
  /** Footprint side (tiles). */
  side: number;
}

/** Build a corner post centred at world (cx,cy), base at z=0. */
export function postSpec(opts: PostOpts, cx = 0, cy = 0): PostSpec {
  const mat: Mat = opts.material ?? 'timber';
  // Wide enough to cover the corner joint of the STAKE LINES meeting square — the stakes sit on
  // the run centreline (~0.4 m wide), so the post scales off a fraction of the nominal run
  // thickness, not the whole tile-wide massing (a full `th + 0.7 m` post came out 2.7 m square
  // — a smooth silo dwarfing the stakes it capped).
  const side = Math.max(mToTiles(0.9), opts.curtainThickness * 0.35 + mToTiles(0.35));
  const r = side / 2;
  const bankH = mToTiles(0.6);                                   // seats on the rampart bank
  const rise = mToTiles(1.4);                                    // stands proud as a lookout
  const shaftH = Math.max(mToTiles(1.6), opts.curtainHeight) + rise - bankH * 0.4;
  const capH = mToTiles(0.9);

  const parts: Part[] = [];
  // Earthen foot the post is driven into (matches the palisade's bank).
  parts.push({ prim: 'box', at: [cx - r - mToTiles(0.25), cy - r - mToTiles(0.25), 0],
    size: [side + mToTiles(0.5), side + mToTiles(0.5), bankH], material: 'earth' });
  // Squared timber shaft — upright hewn grain (`plank_v`), so it reads as dark worked timber
  // beside the stave curtain instead of a smooth pale monolith.
  parts.push({ prim: 'column', center: [cx, cy], baseZ: bankH * 0.6, shape: 'square',
    radius: r, height: shaftH, material: mat, work: 'plank_v' });
  // A pair of lashing collars where the wall rails tie in (proud bands, like the palisade rails).
  const collarT = mToTiles(0.16);
  for (const fz of [0.4, 0.78]) {
    const bz = bankH * 0.6 + shaftH * fz;
    parts.push({ prim: 'box', at: [cx - r - mToTiles(0.06), cy - r - mToTiles(0.06), bz],
      size: [side + mToTiles(0.12), side + mToTiles(0.12), collarT], material: mat });
  }
  // Pyramidal cap (a squared spike, echoing the stakes' pointed tops).
  parts.push({ prim: 'column', center: [cx, cy], baseZ: bankH * 0.6 + shaftH, shape: 'square',
    radius: r * 0.98, topRadius: 0, height: capH, material: mat, work: 'plank_v' });

  return { parts, mountAnchors: [{ kind: 'lintel', x: cx, y: cy, facing: [0, 0], z: 0 }], side };
}
