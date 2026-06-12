/**
 * Builds the per-frame neutral entity draw list — the y-sorted, screen-space
 * draw commands for buildings, barriers, NPCs, vegetation and decorations.
 * Extracted from `createIsoRenderMap`'s inline loop so the SAME list can be
 * executed by either backend (Canvas2D `executeDrawListCanvas` or the PixiJS
 * entity layer) — placement parity by construction.
 */
import type { RenderContext, Entity } from '@/core/types';
import type { TileBounds } from './iso-projection';
import type { DrawItem } from './draw-list';
import type { IsoItemCtx } from './iso-sprites';
import { npcItems, vegetationItems, artBillboardItem } from './iso-sprites';
import {
  buildingSpriteItemFromImage, buildingSpriteItemFromPack, flatBlockItems, pickBuildingSource,
} from './iso-building';
import { barrierItems } from './iso-barrier';
import { buildYSortBucket, buildingSortKey, type YSortEntry } from './iso-ysort';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import { blueprintOf } from '@/blueprint/entity';
import { isLayerHidden } from '@/render/layer-visibility';

/** Structure bounding box (footprint-local), as the iso renderer consumes it. */
interface StructureBox { dx: number; dy: number; w: number; h: number; }

const KIND_PRIORITY: Record<string, number> = {
  river: 0, road: 1, deco: 2, vegetation: 3, barrier: 4, building: 4, npc: 5,
};

/**
 * The Pixi stage transform that mirrors the Canvas2D world transform
 * (`ctx.scale(z); ctx.translate(round(-cam·z)/z)` under an outer
 * devicePixelRatio scale): with the renderer at `resolution = dpr`, the stage
 * scales by `z` and offsets by the SAME whole-CSS-pixel-snapped translation,
 * so a draw item lands on the identical device pixel in both backends.
 */
export function isoStageTransform(camera: { x: number; y: number; zoom: number }): {
  scale: number; x: number; y: number;
} {
  const z = camera.zoom;
  return { scale: z, x: Math.round(-camera.x * z), y: Math.round(-camera.y * z) };
}

/**
 * Query + partition + y-sort + per-kind item emission. `ic` carries the iso
 * origin and the NPC/tree sheets (everything the emitters need, minus the 2D
 * context). Art resolvers on `rc` are peek/warm — a miss warms the cache and
 * falls through, never blocking the frame.
 */
export function buildEntityDrawList(rc: RenderContext, bounds: TileBounds, ic: IsoItemCtx): DrawItem[] {
  const entries: YSortEntry[] = [];
  const hideBuildings = isLayerHidden('buildings', rc.devMode);
  const hideVegetation = isLayerHidden('vegetation', rc.devMode);
  const hideBarriers = isLayerHidden('buildings', rc.devMode);

  // Buildings and vegetation are both world entities — one region query, then
  // partition. Buildings are drawn parametrically from their descriptor's
  // Massing (the legacy map.buildings/template path is gone).
  const buildingById = new Map<string, { e: Entity; s: StructureBox }>();
  const vegById = new Map<string, Entity>();
  const barrierById = new Map<string, Entity>();
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
      const stored = blueprintOf(e);
      if (stored) {
        if (hideBuildings) continue;
        // Structure bounding box from the resolved parts' footprint claims.
        let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
        for (const p of stored.rb.parts) {
          minX = Math.min(minX, p.at.x); minY = Math.min(minY, p.at.y);
          maxX = Math.max(maxX, p.at.x + p.size.w); maxY = Math.max(maxY, p.at.y + p.size.h);
        }
        if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = stored.rb.footprint.w; maxY = stored.rb.footprint.h; }
        const s: StructureBox = { dx: minX, dy: minY, w: maxX - minX, h: maxY - minY };
        const tx = Math.floor(e.x) + s.dx, ty = Math.floor(e.y) + s.dy;
        const key = buildingSortKey({ tx, ty, footprintW: s.w, footprintH: s.h });
        buildingById.set(e.id, { e, s });
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

  const items: DrawItem[] = [];
  const sorted = buildYSortBucket(entries);
  for (const e of sorted) {
    if (e.kind === 'building') {
      const b = buildingById.get(e.id);
      if (b) {
        const bx = Math.floor(b.e.x) + b.s.dx, by = Math.floor(b.e.y) + b.s.dy;
        const mode = rc.devMode?.buildingRenderMode ?? 'auto';
        const asset = () => rc.resolveBuildingArt?.(b.e) ?? null;
        const generated = () => rc.resolveGeneratedBuildingArt?.(b.e) ?? null;
        const parametric = () => rc.resolveParametricBuildingArt?.(b.e) ?? null;
        const fp = { w: b.s.w, h: b.s.h };
        switch (pickBuildingSource(mode, asset, generated, parametric)) {
          case 'asset':      items.push(buildingSpriteItemFromImage(ic, asset() as HTMLImageElement, bx, by, fp)); break;
          case 'generated':  items.push(buildingSpriteItemFromPack(ic, generated()!, bx, by, fp)); break;
          case 'parametric': items.push(buildingSpriteItemFromPack(ic, parametric()!, bx, by, fp)); break;
          case 'flat':       items.push(...flatBlockItems(ic, fp, bx, by)); break;
        }
      }
    } else if (e.kind === 'barrier') {
      const b = barrierById.get(e.id);
      if (b) items.push(...barrierItems(b, ic));
    } else if (e.kind === 'npc') {
      const n = rc.npcs.find((x) => x.id === e.id);
      if (n) items.push(...npcItems(ic, n));
    } else if (e.kind === 'vegetation') {
      const v = vegById.get(e.id);
      if (v) {
        const art = rc.resolveEntityArt?.(v) ?? null;
        if (art) items.push(artBillboardItem(ic, art, v.x, v.y));
        else items.push(...vegetationItems(ic, v));
      }
    } else if (e.kind === 'deco') {
      const d = decoById.get(e.id);
      const img = d ? rc.resolveDecorationImage?.(d.assetId) ?? null : null;
      if (d && img) items.push(artBillboardItem(ic, img, d.tx, d.ty));
    }
  }

  return items;
}
