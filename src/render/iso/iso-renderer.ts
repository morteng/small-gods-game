import type { RenderContext } from '@/core/types';
import { drawIsoTerrain } from './iso-terrain';
import { drawIsoNpc, drawIsoBuilding, drawIsoTree } from './iso-sprites';
import { drawIsoOverlays } from './iso-overlay';
import { createNullAtlas, type IsoAtlas } from './iso-atlas';
import { visibleTileBounds } from './iso-projection';
import { buildYSortBucket, buildingSortKey, type YSortEntry } from './iso-ysort';

const BG_COLOR = '#1a1a24';
const KIND_PRIORITY: Record<string, number> = {
  river: 0, road: 1, deco: 2, tree: 3, building: 4, npc: 5,
};

export type RenderMap = (ctx: CanvasRenderingContext2D, rc: RenderContext) => void;

/**
 * Factory: build a renderMap closure that captures the provided atlas.
 * If atlas is null (load failed), fall back to the null atlas — renderer
 * still produces output via the per-tile diamond/extruded-box fallback.
 */
export function createIsoRenderMap(atlas: IsoAtlas | null): RenderMap {
  const effectiveAtlas = atlas ?? createNullAtlas();
  return function renderMap(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
    const { camera, canvasWidth, canvasHeight, map } = rc;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    const originX = 0;
    const originY = 0;

    const bounds = visibleTileBounds(
      { originX: -camera.x, originY: -camera.y },
      canvasWidth / camera.zoom,
      canvasHeight / camera.zoom,
      { mapW: map.width, mapH: map.height },
    );

    drawIsoTerrain(ctx, {
      map,
      atlas: effectiveAtlas,
      blobMap: rc.blobMap,
      bounds, originX, originY,
    });

    const entries: YSortEntry[] = [];
    for (const b of (map as any).buildings ?? []) {
      const key = buildingSortKey({
        tx: b.tileX, ty: b.tileY,
        footprintW: b.footprintW ?? 1, footprintH: b.footprintH ?? 1,
      });
      entries.push({
        id: b.id, kind: 'building',
        tx: b.tileX, ty: b.tileY, z: 0,
        sortTx: key.sortTx, sortTy: key.sortTy,
        kindPriority: KIND_PRIORITY.building,
      });
    }
    for (const n of rc.npcs) {
      entries.push({
        id: n.id, kind: 'npc',
        tx: n.tileX, ty: n.tileY, z: 0,
        kindPriority: KIND_PRIORITY.npc,
      });
    }

    const sorted = buildYSortBucket(entries);
    for (const e of sorted) {
      if (e.kind === 'building') {
        const b = (map as any).buildings.find((x: any) => x.id === e.id);
        if (b) drawIsoBuilding({ ctx, atlas: effectiveAtlas, originX, originY }, b, b.footprintW ?? 1, b.footprintH ?? 1);
      } else if (e.kind === 'npc') {
        const n = rc.npcs.find((x) => x.id === e.id);
        if (n) drawIsoNpc({ ctx, atlas: effectiveAtlas, originX, originY }, n);
      } else if (e.kind === 'tree') {
        drawIsoTree({ ctx, atlas: effectiveAtlas, originX, originY }, e.tx, e.ty, '#3a7a3a');
      }
    }

    ctx.restore();

    drawIsoOverlays(ctx, rc);
  };
}

/**
 * Back-compat shim: existing dynamic-import paths reference `renderMap`
 * as a top-level export. Now that the renderer is a factory we expose a
 * fallback `renderMap` constructed with a null atlas (i.e. the same
 * behavior as before). select-renderer.ts replaces this at runtime by
 * calling createIsoRenderMap(atlas) with the loaded atlas.
 */
export const renderMap: RenderMap = createIsoRenderMap(null);
