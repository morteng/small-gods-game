import type { RenderContext, Entity } from '@/core/types';
import { drawIsoTerrain } from './iso-terrain';
import { drawIsoNpc, drawIsoVegetation, drawIsoArtBillboard } from './iso-sprites';
import { drawIsoBuildingSprite, drawIsoBuildingSpriteGenerated, drawIsoFlatBlock, pickBuildingSource } from './iso-building';
import { drawIsoBarrier } from './iso-barrier';
import { drawIsoOverlays } from './iso-overlay';
import { createNullAtlas } from './iso-atlas';
import { visibleTileBounds } from './iso-projection';
import { buildYSortBucket, buildingSortKey, type YSortEntry } from './iso-ysort';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import { buildingMassing, type Massing } from '@/render/building-massing-model';
import { structureRect, type BuildingDescriptor, type StructureRect } from '@/world/building-descriptor';
import { isLayerHidden } from '@/render/layer-visibility';

const BG_COLOR = '#1a1a24';
const KIND_PRIORITY: Record<string, number> = {
  river: 0, road: 1, deco: 2, vegetation: 3, barrier: 4, building: 4, npc: 5,
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
    // Pixel-perfect transform: zoom is a ladder rung (integer or 1/integer) and
    // the world origin is snapped to a whole CSS pixel — so a sprite drawn at an
    // integer world position lands on an integer device pixel (no sub-pixel
    // seams or shimmer). Snap is composed via translate (not setTransform) to
    // preserve the outer devicePixelRatio scale already on the context.
    const z = camera.zoom;
    ctx.scale(z, z);
    ctx.translate(Math.round(-camera.x * z) / z, Math.round(-camera.y * z) / z);

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

    // (Building foundation + apron ground field removed — the blended packed-dirt
    // patch around buildings read as a misaligned colour smear. Buildings now sit
    // directly on the terrain; the sprite carries its own base.)
    const hideVegetation = isLayerHidden('vegetation', rc.devMode);

    // Buildings and vegetation are both world entities — one region query, then
    // partition. Buildings are drawn parametrically from their descriptor's
    // Massing (the legacy map.buildings/template path is gone).
    const buildingById = new Map<string, { e: Entity; massing: Massing; s: StructureRect }>();
    const vegById = new Map<string, Entity>();
    const barrierById = new Map<string, Entity>();
    const hideBarriers = isLayerHidden('buildings', rc.devMode);
    if (!hideBuildings || !hideVegetation || !hideBarriers) {
      const region = {
        x: bounds.minTx, y: bounds.minTy,
        w: bounds.maxTx - bounds.minTx + 1,
        h: bounds.maxTy - bounds.minTy + 1,
      };
      for (const e of rc.world.query({ region })) {
        // Linear barrier runs (walls/palisades/fences) — drawn near buildings.
        if (e.kind.endsWith('_run') || e.tags?.includes('barrier')) {
          if (hideBarriers) continue;
          barrierById.set(e.id, e);
          entries.push({
            id: e.id, kind: 'barrier',
            tx: Math.floor(e.x), ty: Math.floor(e.y), z: 0,
            kindPriority: KIND_PRIORITY.barrier,
          });
          continue;
        }
        const descriptor = e.properties?.descriptor as BuildingDescriptor | undefined;
        if (descriptor) {
          if (hideBuildings) continue;
          const s = structureRect(descriptor);
          const tx = Math.floor(e.x) + s.dx, ty = Math.floor(e.y) + s.dy;
          const key = buildingSortKey({ tx, ty, footprintW: s.w, footprintH: s.h });
          buildingById.set(e.id, { e, massing: buildingMassing(descriptor), s });
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

    const decoById = new Map<string, { tx: number; ty: number; assetId: string }>();
    for (const d of rc.generatedDecorations ?? []) {
      const id = `deco:${d.tileX},${d.tileY}`;
      decoById.set(id, { tx: d.tileX, ty: d.tileY, assetId: d.assetId });
      entries.push({
        id, kind: 'deco',
        tx: d.tileX, ty: d.tileY, z: 0,
        kindPriority: KIND_PRIORITY.deco,
      });
    }

    const drawCtx = { ctx, atlas: effectiveAtlas, originX, originY, npcSheets: rc.npcSheets, treeSheets: rc.treeSheets };
    const sorted = buildYSortBucket(entries);
    for (const e of sorted) {
      if (e.kind === 'building') {
        const b = buildingById.get(e.id);
        if (b) {
          const bx = Math.floor(b.e.x) + b.s.dx, by = Math.floor(b.e.y) + b.s.dy;
          const mode = rc.devMode?.buildingRenderMode ?? 'auto';
          const asset = () => rc.resolveBuildingArt?.(b.e) ?? null;
          const parametric = () => rc.resolveParametricBuildingArt?.(b.e) ?? null;
          switch (pickBuildingSource(mode, asset, parametric)) {
            case 'asset':      drawIsoBuildingSprite(drawCtx, asset() as HTMLImageElement, bx, by, b.massing.footprint); break;
            case 'parametric': drawIsoBuildingSpriteGenerated(drawCtx, parametric() as HTMLCanvasElement, bx, by, b.massing.footprint); break;
            case 'flat':       drawIsoFlatBlock(drawCtx, { w: b.s.w, h: b.s.h }, bx, by); break;
          }
        }
      } else if (e.kind === 'barrier') {
        const b = barrierById.get(e.id);
        if (b) drawIsoBarrier(ctx, b, { originX, originY });
      } else if (e.kind === 'npc') {
        const n = rc.npcs.find((x) => x.id === e.id);
        if (n) drawIsoNpc(drawCtx, n);
      } else if (e.kind === 'vegetation') {
        const v = vegById.get(e.id);
        if (v) {
          const art = rc.resolveEntityArt?.(v) ?? null;
          if (art) drawIsoArtBillboard(drawCtx, art, v.x, v.y);
          else drawIsoVegetation(drawCtx, v);
        }
      } else if (e.kind === 'deco') {
        const d = decoById.get(e.id);
        const img = d ? rc.resolveDecorationImage?.(d.assetId) ?? null : null;
        if (d && img) drawIsoArtBillboard(drawCtx, img, d.tx, d.ty);
      }
    }

    ctx.restore();

    drawIsoOverlays(ctx, rc);
  };
}

export const renderMap: RenderMap = createIsoRenderMap();
