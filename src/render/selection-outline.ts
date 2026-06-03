import type {
  Camera, GameMap, GeneratedDecoration, WorldSeed,
} from '@/core/types';
import type { World } from '@/world/world';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { Selection } from '@/dev/inspector/selection';
import type { RenderMode } from './select-renderer';
import { worldToScreen as topdownWorldToScreen } from './camera';
import { worldToScreen as isoWorldToScreen } from './iso/iso-projection';
import { ISO_TILE_W, ISO_TILE_H } from './iso/iso-constants';
import { TILE_SIZE } from '@/core/constants';

/** A tile-space rectangle to highlight (w, h >= 1). A single tile is w=h=1. */
export interface OutlineRect { x: number; y: number; w: number; h: number; }

/** Everything the resolver needs to turn a Selection into a tile-rect. */
export interface OutlineWorld {
  world: World | null;
  decorations: GeneratedDecoration[];
  spirits: Map<SpiritId, Spirit>;
  seed: WorldSeed | null;
}

const POINT_COLOR = '#39d0ff'; // single tile / entity / npc / decoration / spirit
const AREA_COLOR = '#ffd24a';  // a POI region (multi-tile area)

/**
 * Resolve a unified Selection to the tile-rect it occupies on the map, or null
 * if the selection has no spatial footprint (world, lore, an unresolved
 * decoration, a discarnate spirit, …).
 */
export function resolveOutlineRect(sel: Selection | null, w: OutlineWorld): OutlineRect | null {
  if (!sel) return null;
  switch (sel.type) {
    case 'tile':
      return { x: sel.x, y: sel.y, w: 1, h: 1 };
    case 'entity': {
      const e = w.world?.registry.get(sel.id);
      return e ? { x: Math.floor(e.x), y: Math.floor(e.y), w: 1, h: 1 } : null;
    }
    case 'decoration': {
      const d = sel.index >= 0 ? w.decorations[sel.index] : undefined;
      return d ? { x: d.tileX, y: d.tileY, w: 1, h: 1 } : null;
    }
    case 'spirit': {
      const s = w.spirits.get(sel.id);
      const manifestId = s?.manifestation
        ? (s.manifestation.kind === 'avatar' ? s.manifestation.entityId : s.manifestation.npcEntityId)
        : null;
      const e = manifestId ? w.world?.registry.get(manifestId) : undefined;
      return e ? { x: Math.floor(e.x), y: Math.floor(e.y), w: 1, h: 1 } : null;
    }
    case 'poi': {
      const poi = w.seed?.pois.find(p => p.id === sel.id);
      if (!poi) return null;
      if (poi.region) {
        const { x_min, x_max, y_min, y_max } = poi.region;
        return { x: x_min, y: y_min, w: x_max - x_min + 1, h: y_max - y_min + 1 };
      }
      if (poi.position) return { x: poi.position.x, y: poi.position.y, w: 1, h: 1 };
      const ents = w.world?.registry.getByPoi(poi.id) ?? [];
      return ents.length ? { x: Math.floor(ents[0].x), y: Math.floor(ents[0].y), w: 1, h: 1 } : null;
    }
    case 'world':
    case 'lore':
      return null;
  }
}

/**
 * Draw a glowing, gently pulsing outline around the current selection. Works in
 * both render modes: an axis-aligned rect in topdown, the outer diamond of the
 * tile-rect in iso. Drawn in raw screen space (after the renderer's transform
 * is restored), so camera + zoom are applied manually.
 */
export function drawSelectionOutline(
  ctx: CanvasRenderingContext2D,
  sel: Selection | null,
  camera: Camera,
  mode: RenderMode,
  w: OutlineWorld,
  nowMs: number,
): void {
  const rect = resolveOutlineRect(sel, w);
  if (!rect) return;

  const isArea = rect.w > 1 || rect.h > 1;
  const color = isArea ? AREA_COLOR : POINT_COLOR;
  const pulse = 0.6 + 0.4 * Math.sin(nowMs / 300); // 0.2 .. 1.0

  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14 * pulse;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.85;

  if (mode === 'iso') {
    drawIsoDiamond(ctx, rect, camera);
  } else {
    const tl = topdownWorldToScreen(camera, rect.x, rect.y, TILE_SIZE);
    const br = topdownWorldToScreen(camera, rect.x + rect.w, rect.y + rect.h, TILE_SIZE);
    ctx.strokeRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
  }

  ctx.restore();
}

/** Screen-space center of an iso tile, with camera + zoom applied. */
function isoTileCenter(tx: number, ty: number, camera: Camera): { sx: number; sy: number } {
  const { sx, sy } = isoWorldToScreen(tx, ty, 0, 0, 0);
  return { sx: (sx - camera.x) * camera.zoom, sy: (sy - camera.y) * camera.zoom };
}

/** Trace the outer diamond of a tile-rect in iso screen space. */
function drawIsoDiamond(ctx: CanvasRenderingContext2D, rect: OutlineRect, camera: Camera): void {
  const halfW = (ISO_TILE_W / 2) * camera.zoom;
  const halfH = (ISO_TILE_H / 2) * camera.zoom;
  // Extreme tiles of the rect, each pushed out by its half-diamond.
  const top = isoTileCenter(rect.x, rect.y, camera);
  const right = isoTileCenter(rect.x + rect.w - 1, rect.y, camera);
  const bottom = isoTileCenter(rect.x + rect.w - 1, rect.y + rect.h - 1, camera);
  const left = isoTileCenter(rect.x, rect.y + rect.h - 1, camera);

  ctx.beginPath();
  ctx.moveTo(top.sx, top.sy - halfH);
  ctx.lineTo(right.sx + halfW, right.sy);
  ctx.lineTo(bottom.sx, bottom.sy + halfH);
  ctx.lineTo(left.sx - halfW, left.sy);
  ctx.closePath();
  ctx.stroke();
}
