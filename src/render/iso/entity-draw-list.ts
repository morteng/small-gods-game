/**
 * Builds the per-frame neutral entity draw list — the y-sorted, screen-space
 * draw commands for buildings, barriers, NPCs, vegetation and decorations.
 * Extracted from `createIsoRenderMap`'s inline loop so the SAME list can be
 * executed by either backend (Canvas2D `executeDrawListCanvas` or the PixiJS
 * entity layer) — placement parity by construction.
 */
import type { RenderContext, Entity, NpcInstance, GeneratedDecoration } from '@/core/types';
import type { TileBounds } from './iso-projection';
import { WorldRenderGraph } from '@/render/graph/world-render-graph';
import type { RenderCategory } from '@/render/graph/render-graph';
import type { DrawItem } from './draw-list';
import type { IsoItemCtx } from './iso-sprites';
import { npcItems, vegetationItems, artBillboardItem, plantSpriteItemFromPack, natureBuryFrac, isGroundCoverKind } from './iso-sprites';
import { isPlantPreset } from '@/blueprint/presets';
import { floraVariantBucket, FLORA_VARIANTS } from '@/render/flora-variant';
import {
  buildingSpriteItemFromImage, buildingSpriteItemFromPack, flatBlockItems, pickBuildingSource,
} from './iso-building';
import { barrierSlabs, barrierPieceItem } from './iso-barrier';
import { buildYSortBucket, buildingSortKey, type YSortEntry } from './iso-ysort';
import { blueprintOf } from '@/blueprint/entity';
import { structureBox, type StructureBox } from '@/blueprint/footprint';
import { isLayerHidden } from '@/render/layer-visibility';

// Tie-break order at EQUAL iso-depth keys. Barrier sits ABOVE building deliberately:
// rings stand outside every building's visual extent, so when a wall chunk and a building
// tie on depth the building's front corner is at most ON the wall line — the wall is the
// nearer object and must draw after it. (They used to share 4; the tie was insertion-order
// arbitrary, one cause of buildings poking through walls.)
const KIND_PRIORITY: Record<string, number> = {
  river: 0, road: 1, deco: 2, vegetation: 3, building: 4, barrier: 5, npc: 6,
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
export function buildEntityDrawList(
  rc: RenderContext, bounds: TileBounds, ic: IsoItemCtx,
  opts: { only?: 'static' | 'npcs' } = {},
): DrawItem[] {
  // `only` partitions the list so the renderer can CACHE the camera-independent
  // static layer (flora/buildings/deco/roads) and re-emit just the moving NPC
  // layer each frame — the static set never changes when an NPC walks, so its
  // expensive build (the ~293ms over ~10k flora) is paid once, not per frame.
  const wantNpcs = opts.only !== 'static';
  const wantStatic = opts.only !== 'npcs';
  const entries: YSortEntry[] = [];
  const hideBuildings = isLayerHidden('buildings', rc.devMode) || !wantStatic;
  const hideVegetation = isLayerHidden('vegetation', rc.devMode) || !wantStatic;
  const hideBarriers = isLayerHidden('buildings', rc.devMode) || !wantStatic;
  const hideNpcs = isLayerHidden('npcs', rc.devMode) || !wantNpcs;

  // Source the drawable stream from the RenderGraph seam (Slice R0b): a
  // WorldRenderGraph projects today's World into category-tagged nodes — the
  // SAME partition (barrier `*_run`/tag, building-by-blueprint, vegetation-by-
  // entity-kind, then NPCs, then decorations, in that order) that used to live
  // inline here. The renderer keeps the per-kind placement work (structure box,
  // sort keys) keyed off each node's opaque `ref`, and the by-id maps feed the
  // emission pass below — byte-identical draw list, now flowing through the seam.
  const buildingById = new Map<string, { e: Entity; s: StructureBox }>();
  const vegById = new Map<string, Entity>();
  // NPCs by id, so the emission pass below resolves each in O(1) instead of a
  // linear `rc.npcs.find()` per y-sorted entry (which was O(n²) in NPC count
  // every frame — the moving NPC layer is rebuilt unconditionally).
  const npcById = new Map<string, NpcInstance>();
  // Per-slab draw items keyed by a composite `${entityId}#${slabIndex}` id, so
  // each piece of a barrier run y-sorts independently (see barrierSlabs).
  const barrierSlabItems = new Map<string, DrawItem[]>();
  const decoById = new Map<string, { tx: number; ty: number; assetId: string }>();

  // Translate layer-visibility policy into a category read-filter, so the graph
  // can skip the world query when no world layer is shown (a preserved
  // optimisation) — the filter is authoritative, so the cases below need no
  // further hide checks.
  const want = new Set<RenderCategory>();
  if (!hideBuildings) want.add('building');
  if (!hideVegetation) want.add('vegetation');
  if (!hideBarriers) want.add('barrier');
  if (!hideNpcs) want.add('npc');
  if (wantStatic) want.add('decoration'); // decorations have no hide toggle today

  const region = {
    x: bounds.minTx, y: bounds.minTy,
    w: bounds.maxTx - bounds.minTx + 1,
    h: bounds.maxTy - bounds.minTy + 1,
  };
  for (const node of new WorldRenderGraph(rc).nodes(region, { categories: want })) {
    switch (node.category) {
      case 'barrier': {
        const e = node.ref as Entity;
        // Prefer the composed-and-lit parametric pieces (one bounded sprite per run chunk);
        // each y-sorts at its own chunk midpoint, interleaving with the buildings it weaves
        // past — exactly like the legacy slabs, but lit. Until every chunk's compose settles
        // the resolver returns null and we draw the flat-quad fallback for the whole run.
        const pieces = rc.resolveParametricBarrierArt?.(e) ?? null;
        if (pieces && pieces.length) {
          pieces.forEach((p, i) => {
            const cid = `${e.id}#${i}`;
            barrierSlabItems.set(cid, [barrierPieceItem(ic, p)]);
            entries.push({
              id: cid, kind: 'barrier',
              tx: Math.floor(p.sortX), ty: Math.floor(p.sortY), z: 0,
              // Unfloored midpoint: flooring cost up to a tile of depth precision per
              // chunk, widening the window where a building mis-sorts against the wall.
              sortTx: p.sortX, sortTy: p.sortY,
              kindPriority: KIND_PRIORITY.barrier,
            });
          });
        } else {
          // One y-sort entry per slab — a long run interleaves with buildings at
          // each piece's own iso depth instead of all at the entity anchor.
          const slabs = barrierSlabs(e, ic);
          slabs.forEach((sl, i) => {
            const cid = `${e.id}#${i}`;
            barrierSlabItems.set(cid, sl.items);
            entries.push({
              id: cid, kind: 'barrier',
              tx: Math.floor(sl.wx), ty: Math.floor(sl.wy), z: 0,
              sortTx: sl.wx, sortTy: sl.wy,
              kindPriority: KIND_PRIORITY.barrier,
            });
          });
        }
        break;
      }
      case 'building': {
        const e = node.ref as Entity;
        const stored = blueprintOf(e)!; // the graph only tags buildings that have one
        // Structure bounding box from the resolved parts' footprint claims — the SAME
        // derivation the barrier gate guard consults, so the drawn silhouette and the
        // "no fence may run here" extent can never drift (spatial-coordination C1).
        const s: StructureBox = structureBox(stored.rb);
        const tx = Math.floor(e.x) + s.dx, ty = Math.floor(e.y) + s.dy;
        const key = buildingSortKey({ tx, ty, footprintW: s.w, footprintH: s.h });
        buildingById.set(e.id, { e, s });
        entries.push({
          id: e.id, kind: 'building',
          tx, ty, z: 0,
          sortTx: key.sortTx, sortTy: key.sortTy,
          kindPriority: KIND_PRIORITY.building,
        });
        break;
      }
      case 'vegetation': {
        const e = node.ref as Entity;
        vegById.set(e.id, e);
        entries.push({
          id: e.id, kind: 'vegetation',
          tx: e.x, ty: e.y, z: 0,
          kindPriority: KIND_PRIORITY.vegetation,
        });
        break;
      }
      case 'npc': {
        const n = node.ref as NpcInstance;
        npcById.set(n.id, n);
        entries.push({
          id: n.id, kind: 'npc',
          tx: n.tileX, ty: n.tileY, z: 0,
          kindPriority: KIND_PRIORITY.npc,
        });
        break;
      }
      case 'decoration': {
        const d = node.ref as GeneratedDecoration;
        decoById.set(node.id, { tx: d.tileX, ty: d.tileY, assetId: d.assetId });
        entries.push({
          id: node.id, kind: 'deco',
          tx: d.tileX, ty: d.tileY, z: 0,
          kindPriority: KIND_PRIORITY.deco,
        });
        break;
      }
    }
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
        const picked = pickBuildingSource(mode, asset, generated, parametric);
        switch (picked) {
          case 'asset':      items.push(buildingSpriteItemFromImage(ic, asset() as HTMLImageElement, bx, by, fp)); break;
          case 'generated':  items.push(buildingSpriteItemFromPack(ic, generated()!, bx, by, fp)); break;
          case 'parametric': items.push(buildingSpriteItemFromPack(ic, parametric()!, bx, by, fp)); break;
          case 'flat':       items.push(...flatBlockItems(ic, fp, bx, by)); break;
        }
        // The geometry cast shadow depends only on the blueprint, not the LLM
        // albedo — so a cached img2img/asset building borrows the geometry shadow
        // from the parametric source (it shares the footprint foot anchor).
        if (picked === 'asset' || picked === 'generated') {
          const last = items[items.length - 1];
          const ps = (parametric() as { shadow?: { canvas: CanvasImageSource; dx: number; dy: number } } | null)?.shadow;
          if (last?.t === 'image' && !last.shadowSprite && ps) {
            last.shadowSprite = { src: ps.canvas, dx: ps.dx, dy: ps.dy };
          }
        }
        // Above-ground deck (G4/G5): a bridge deck carries an authored bank elevation so the
        // terrain-lift pre-pass rides it over the water instead of foot-sampling the bed.
        const liftElev = (b.e.properties as { liftElev?: number } | undefined)?.liftElev;
        if (liftElev !== undefined) {
          const last = items[items.length - 1];
          if (last?.t === 'image') last.liftElev = liftElev;
        }
      }
    } else if (e.kind === 'barrier') {
      const slab = barrierSlabItems.get(e.id);
      if (slab) items.push(...slab);
    } else if (e.kind === 'npc') {
      const n = npcById.get(e.id);
      if (n) items.push(...npcItems(ic, n));
    } else if (e.kind === 'vegetation') {
      const v = vegById.get(e.id);
      if (v) {
        // Generative species-keyed tree sprite (PBR-lit, cast shadow) when the
        // kind has a plant blueprint preset and its sprite is warm; the flat
        // billboard is the keyless fallback (and stays for ground cover).
        const pack = isPlantPreset(v.kind)
          ? rc.resolveParametricPlantArt?.(v.kind, floraVariantBucket(v.id, FLORA_VARIANTS)) ?? null
          : null;
        if (pack) {
          items.push(plantSpriteItemFromPack(ic, pack, v.x, v.y, natureBuryFrac(v.kind, v.x, v.y), isGroundCoverKind(v.kind)));
        } else {
          const art = rc.resolveEntityArt?.(v) ?? null;
          if (art) items.push(artBillboardItem(ic, art, v.x, v.y));
          else items.push(...vegetationItems(ic, v));
        }
      }
    } else if (e.kind === 'deco') {
      const d = decoById.get(e.id);
      const img = d ? rc.resolveDecorationImage?.(d.assetId) ?? null : null;
      if (d && img) items.push(artBillboardItem(ic, img, d.tx, d.ty));
    }
  }

  // Roads are not DrawItems at all: a road IS the terrain — carved by `road-deformation`
  // and textured by the terrain shader (analytic pavedness from the road feature geometry
  // + the material-exemplar atlas). The old GPU ribbon pass was retired (2026-06-25).
  return items;
}
