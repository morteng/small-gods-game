/**
 * Isometric building rendering. The canonical path blits a generated/parametric
 * pixel-art sprite onto the footprint (`drawIsoBuildingSprite` /
 * `drawIsoBuildingSpriteGenerated`). `drawIsoFlatBlock` is the last-resort
 * primitive (an extruded box, no roof) used only when neither a generated nor a
 * parametric sprite is available — e.g. manifold wasm failed to load.
 * `pickBuildingSource` is the pure dispatch decision the renderer uses.
 *
 * All placement math lives in the `*Items` emitters (neutral draw-list items);
 * the draw* functions are thin Canvas2D wrappers kept for direct callers/tests.
 */
import { worldToScreen } from './iso-projection';
import { opaqueAnchor, type SpriteAnchor } from './iso-sprite-bbox';
import type { IsoDrawCtx } from './iso-sprites';
import type { BuildingRenderMode } from '@/core/types';
import { HEIGHT_UNIT_PX, ISO_TILE_H } from '@/render/scale-contract';
import { executeDrawListCanvas, type DrawItem } from './draw-list';

interface P { sx: number; sy: number }

function shade(hex: string, factor: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((n & 255) * factor));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const quadItem = (a: P, b: P, c: P, d: P, color: string): DrawItem => ({
  t: 'poly',
  points: [{ x: a.sx, y: a.sy }, { x: b.sx, y: b.sy }, { x: c.sx, y: c.sy }, { x: d.sx, y: d.sy }],
  color,
});

const raise = (p: P, dz: number): P => ({ sx: p.sx, sy: p.sy - dz });

interface Corners { n: P; e: P; s: P; w: P }

function groundCorners(tx: number, ty: number, w: number, h: number, o: { originX: number; originY: number }): Corners {
  // worldToScreen gives a tile CENTRE; the footprint block's outer-diamond
  // corners sit half a tile (ISO_TILE_H/2) higher than these lattice points.
  // Lift by that so the massing seats on its footprint tiles — matching the
  // terrain + the sprite path (same half-tile fix).
  const lift = ISO_TILE_H / 2;
  const at = (x: number, y: number): P => {
    const s = worldToScreen(x, y, 0, o.originX, o.originY);
    return { sx: s.sx, sy: s.sy - lift };
  };
  return {
    n: at(tx, ty),
    e: at(tx + w, ty),
    s: at(tx + w, ty + h),
    w: at(tx, ty + h),
  };
}

/** The two visible vertical walls + the flat top of a box, as draw items. */
function boxItems(g: Corners, height: number, wall: string): DrawItem[] {
  const top: Corners = { n: raise(g.n, height), e: raise(g.e, height), s: raise(g.s, height), w: raise(g.w, height) };
  return [
    // left (south-west) wall, right (south-east) wall, then top face
    quadItem(g.w, g.s, top.s, top.w, shade(wall, 0.6)),
    quadItem(g.s, g.e, top.e, top.s, shade(wall, 0.78)),
    quadItem(top.n, top.e, top.s, top.w, wall),
  ];
}

/** Shared placement: land `anchor` (in sprite px) on the footprint's front tip. */
export function buildingSpriteItem(
  o: { originX: number; originY: number }, src: CanvasImageSource, natW: number, natH: number,
  anchor: SpriteAnchor, tileX: number, tileY: number, footprint: { w: number; h: number },
): DrawItem {
  const { originX, originY } = o;
  const { w, h } = footprint;
  const west = worldToScreen(tileX, tileY + h, 0, originX, originY);
  const east = worldToScreen(tileX + w, tileY, 0, originX, originY);
  // The footprint occupies tiles [tileX..tileX+w-1] × [tileY..tileY+h-1], and
  // worldToScreen returns a tile's CENTRE (matching the terrain). The sprite's
  // base sits on the footprint's front (south) tip = the south vertex of the
  // frontmost tile = its centre + half a tile down. Anchoring instead to
  // worldToScreen(tileX+w, tileY+h) — the centre of the tile one PAST the block —
  // drew every building a half-tile (ISO_TILE_H/2 = 32px) too low, off its grid.
  const front = worldToScreen(tileX + w - 1, tileY + h - 1, 0, originX, originY);
  const bottomY = front.sy + ISO_TILE_H / 2;
  const cx = (west.sx + east.sx) / 2; // footprint centre x

  return {
    t: 'image', src,
    dx: Math.round(cx - anchor.centerX),
    dy: Math.round(bottomY - anchor.bottom),
    dw: natW, dh: natH,
  };
}

/**
 * Draw a generated pixel-art building sprite anchored to its footprint, **1:1**.
 *
 * WYSIWYG: the sprite is blitted at its NATIVE pixel size (never rescaled to the
 * footprint diamond), anchored with its bottom edge at the diamond's front
 * (south) tip and its horizontal centre on the footprint centre. The art is
 * authored at the view registry's native size = the footprint diamond width ×
 * (diamond height + rise), so native width == diamond width and the sprite fills
 * its footprint exactly — one source pixel == one screen pixel at zoom 1 (the
 * outer ctx.scale supplies integer/1-over-integer zoom).
 *
 * The whole image is blitted at native size, but the ANCHOR uses the sprite's
 * opaque-content bounding box (`opaqueAnchor`), not the frame edges — PixelLab
 * leaves arbitrary transparent margins, so we land the building's real base
 * centre on the footprint's front tip for pixel-exact placement. Used when the
 * ArtResolver finds a sprite; otherwise we fall back to `drawIsoFlatBlock`.
 */
export function buildingSpriteItemFromImage(
  o: { originX: number; originY: number }, img: HTMLImageElement,
  tileX: number, tileY: number, footprint: { w: number; h: number },
): DrawItem {
  const { w, h } = footprint;
  const west = worldToScreen(tileX, tileY + h, 0, o.originX, o.originY);
  const east = worldToScreen(tileX + w, tileY, 0, o.originX, o.originY);
  const natW = img.naturalWidth || img.width || (east.sx - west.sx);
  const natH = img.naturalHeight || img.height || natW;
  // Anchor by the building's real pixels, not the (margin-padded) frame.
  return buildingSpriteItem(o, img, natW, natH, opaqueAnchor(img), tileX, tileY, footprint);
}

export function drawIsoBuildingSprite(
  dc: IsoDrawCtx, img: HTMLImageElement,
  tileX: number, tileY: number, footprint: { w: number; h: number },
): void {
  executeDrawListCanvas(dc.ctx, [buildingSpriteItemFromImage(dc, img, tileX, tileY, footprint)]);
}

/**
 * A runtime parametric building sprite (manifold generate-to-sprite). The
 * canvas is cropped to opaque content, so its base anchor is trivially centre/bottom.
 */
export function buildingSpriteItemFromCanvas(
  o: { originX: number; originY: number }, src: HTMLCanvasElement | OffscreenCanvas,
  tileX: number, tileY: number, footprint: { w: number; h: number },
): DrawItem {
  const natW = src.width, natH = src.height;
  return buildingSpriteItem(o, src, natW, natH, { centerX: natW / 2, bottom: natH }, tileX, tileY, footprint);
}

export function drawIsoBuildingSpriteGenerated(
  dc: IsoDrawCtx, src: HTMLCanvasElement | OffscreenCanvas,
  tileX: number, tileY: number, footprint: { w: number; h: number },
): void {
  executeDrawListCanvas(dc.ctx, [buildingSpriteItemFromCanvas(dc, src, tileX, tileY, footprint)]);
}

/**
 * Pure dispatch decision: which source should the renderer draw a building from?
 *  - `'asset'`      — a generated PixelLab sprite
 *  - `'generated'`  — an img2img generated sprite (preferred over parametric)
 *  - `'parametric'` — a runtime manifold parametric sprite (the 3D model render)
 *  - `'flat'`       — the last-resort Canvas2D flat block
 * `'fallback'` mode forces the parametric 3D-model render: BOTH art sources
 * (PixelLab asset and img2img generated) are skipped, so the toggle actually
 * switches every building to its model primitives.
 * Extracted from the renderer so it's unit-testable without a canvas.
 */
export function pickBuildingSource(
  mode: BuildingRenderMode,
  asset: () => CanvasImageSource | null,
  generated: () => CanvasImageSource | null,
  parametric: () => CanvasImageSource | null,
): 'asset' | 'generated' | 'parametric' | 'flat' {
  if (mode !== 'fallback') {
    if (asset()) return 'asset';
    if (generated()) return 'generated';
  }
  if (parametric()) return 'parametric';
  return 'flat';
}

/**
 * Last-resort flat block (extruded box, no roof) when neither a generated nor a
 * parametric sprite is available — e.g. manifold wasm failed to load. Drawn from
 * the structure rect at tile (tileX, tileY), one HEIGHT_UNIT_PX tall.
 */
export function flatBlockItems(
  o: { originX: number; originY: number }, struct: { w: number; h: number },
  tileX: number, tileY: number, color = '#6b6b78',
): DrawItem[] {
  const g = groundCorners(tileX, tileY, struct.w, struct.h, o);
  return boxItems(g, HEIGHT_UNIT_PX, color);
}

export function drawIsoFlatBlock(
  dc: IsoDrawCtx, struct: { w: number; h: number },
  tileX: number, tileY: number, color = '#6b6b78',
): void {
  executeDrawListCanvas(dc.ctx, flatBlockItems(dc, struct, tileX, tileY, color));
}
