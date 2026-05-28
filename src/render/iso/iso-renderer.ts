import type { RenderContext, Entity } from '@/core/types';
import { drawIsoTerrain } from './iso-terrain';
import { drawIsoNpc, drawIsoBuilding, drawIsoVegetation } from './iso-sprites';
import { drawIsoOverlays } from './iso-overlay';
import { createNullAtlas } from './iso-atlas';
import { visibleTileBounds } from './iso-projection';
import { buildYSortBucket, buildingSortKey, type YSortEntry } from './iso-ysort';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import { getBuildingTemplate } from '@/map/building-templates';

const BG_COLOR = '#1a1a24';
const KIND_PRIORITY: Record<string, number> = {
  river: 0, road: 1, deco: 2, vegetation: 3, building: 4, npc: 5,
};

export type RenderMap = (ctx: CanvasRenderingContext2D, rc: RenderContext) => void;

/**
 * Factory: build a renderMap closure. Terrain is drawn as plain colored
 * diamonds; building/tree/npc sprite helpers use the null atlas (they
 * already fall back to extruded-box/diamond primitives).
 */
export function createIsoRenderMap(): RenderMap {
  const effectiveAtlas = createNullAtlas();
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

    drawIsoTerrain(ctx, { map, bounds, originX, originY });

    const entries: YSortEntry[] = [];
    for (const b of (map as any).buildings ?? []) {
      const tpl = getBuildingTemplate(b.templateId);
      const footprintW = tpl?.footprint.w ?? 1;
      const footprintH = tpl?.footprint.h ?? 1;
      const key = buildingSortKey({
        tx: b.tileX, ty: b.tileY,
        footprintW, footprintH,
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

    const vegById = new Map<string, Entity>();
    const region = {
      x: bounds.minTx, y: bounds.minTy,
      w: bounds.maxTx - bounds.minTx + 1,
      h: bounds.maxTy - bounds.minTy + 1,
    };
    for (const e of rc.world.query({ region })) {
      if (tryGetEntityKindDef(e.kind)?.category !== 'vegetation') continue;
      vegById.set(e.id, e);
      entries.push({
        id: e.id, kind: 'vegetation',
        tx: e.x, ty: e.y, z: 0,
        kindPriority: KIND_PRIORITY.vegetation,
      });
    }

    const drawCtx = { ctx, atlas: effectiveAtlas, originX, originY, npcSheets: rc.npcSheets };
    const sorted = buildYSortBucket(entries);
    for (const e of sorted) {
      if (e.kind === 'building') {
        const b = (map as any).buildings.find((x: any) => x.id === e.id);
        if (b) {
          const btpl = getBuildingTemplate(b.templateId);
          drawIsoBuilding(drawCtx, b, btpl?.footprint.w ?? 1, btpl?.footprint.h ?? 1);
        }
      } else if (e.kind === 'npc') {
        const n = rc.npcs.find((x) => x.id === e.id);
        if (n) drawIsoNpc(drawCtx, n);
      } else if (e.kind === 'vegetation') {
        const v = vegById.get(e.id);
        if (v) drawIsoVegetation(drawCtx, v);
      }
    }

    ctx.restore();

    drawIsoOverlays(ctx, rc);
  };
}

export const renderMap: RenderMap = createIsoRenderMap();
