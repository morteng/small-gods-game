import type { RenderContext, Entity } from '@/core/types';
import { drawIsoTerrain } from './iso-terrain';
import { drawIsoNpc, drawIsoVegetation } from './iso-sprites';
import { drawIsoBuildingMassing } from './iso-building';
import { drawIsoOverlays } from './iso-overlay';
import { createNullAtlas } from './iso-atlas';
import { visibleTileBounds } from './iso-projection';
import { buildYSortBucket, buildingSortKey, type YSortEntry } from './iso-ysort';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import { buildingMassing, type Massing } from '@/render/building-massing-model';
import type { BuildingDescriptor } from '@/world/building-descriptor';
import { isLayerHidden } from '@/render/layer-visibility';

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

    if (!isLayerHidden('terrain', rc.devMode)) {
      drawIsoTerrain(ctx, { map, bounds, originX, originY, devMode: rc.devMode });
    }

    const entries: YSortEntry[] = [];
    const hideBuildings = isLayerHidden('buildings', rc.devMode);
    const hideVegetation = isLayerHidden('vegetation', rc.devMode);

    // Buildings and vegetation are both world entities — one region query, then
    // partition. Buildings are drawn parametrically from their descriptor's
    // Massing (the legacy map.buildings/template path is gone).
    const buildingById = new Map<string, { e: Entity; massing: Massing }>();
    const vegById = new Map<string, Entity>();
    if (!hideBuildings || !hideVegetation) {
      const region = {
        x: bounds.minTx, y: bounds.minTy,
        w: bounds.maxTx - bounds.minTx + 1,
        h: bounds.maxTy - bounds.minTy + 1,
      };
      for (const e of rc.world.query({ region })) {
        const descriptor = e.properties?.descriptor as BuildingDescriptor | undefined;
        if (descriptor) {
          if (hideBuildings) continue;
          const tx = Math.floor(e.x), ty = Math.floor(e.y);
          const key = buildingSortKey({
            tx, ty, footprintW: descriptor.footprint.w, footprintH: descriptor.footprint.h,
          });
          buildingById.set(e.id, { e, massing: buildingMassing(descriptor) });
          entries.push({
            id: e.id, kind: 'building',
            tx, ty, z: 0,
            sortTx: key.sortTx, sortTy: key.sortTy,
            kindPriority: KIND_PRIORITY.building,
          });
          continue;
        }
        if (!hideVegetation && tryGetEntityKindDef(e.kind)?.category === 'vegetation') {
          vegById.set(e.id, e);
          entries.push({
            id: e.id, kind: 'vegetation',
            tx: e.x, ty: e.y, z: 0,
            kindPriority: KIND_PRIORITY.vegetation,
          });
        }
      }
    }

    if (!isLayerHidden('npcs', rc.devMode)) {
      for (const n of rc.npcs) {
        entries.push({
          id: n.id, kind: 'npc',
          tx: n.tileX, ty: n.tileY, z: 0,
          kindPriority: KIND_PRIORITY.npc,
        });
      }
    }

    const drawCtx = { ctx, atlas: effectiveAtlas, originX, originY, npcSheets: rc.npcSheets };
    const sorted = buildYSortBucket(entries);
    for (const e of sorted) {
      if (e.kind === 'building') {
        const b = buildingById.get(e.id);
        if (b) drawIsoBuildingMassing(drawCtx, b.massing, Math.floor(b.e.x), Math.floor(b.e.y));
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
