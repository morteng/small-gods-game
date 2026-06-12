import type { RenderContext } from '@/core/types';
import { drawIsoTerrain } from './iso-terrain';
import { drawIsoOverlays } from './iso-overlay';
import { createNullAtlas } from './iso-atlas';
import { visibleTileBounds } from './iso-projection';
import { isLayerHidden } from '@/render/layer-visibility';
import { buildEntityDrawList } from './entity-draw-list';
import { executeDrawListCanvas } from './draw-list';

const BG_COLOR = '#1a1a24';

export type RenderMap = (ctx: CanvasRenderingContext2D, rc: RenderContext) => void;

/**
 * Factory: build a renderMap closure. Terrain is drawn as plain colored
 * diamonds. The entity pass (buildings / barriers / NPCs / vegetation /
 * decorations) is built as a neutral draw list and executed by ONE of two
 * backends: the PixiJS WebGL layer (`rc.entityLayer`, composited between
 * terrain and overlays) or the Canvas2D executor — same list, same placement.
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

    const items = buildEntityDrawList(rc, bounds, {
      atlas: effectiveAtlas, originX, originY,
      npcSheets: rc.npcSheets, treeSheets: rc.treeSheets,
    });

    // WebGL backend: the Pixi layer applies the SAME world transform itself
    // (isoStageTransform mirrors the ctx math above), so its canvas is
    // composited under the identity transform — device pixel to device pixel.
    const backend = rc.devMode?.entityRenderBackend ?? 'auto';
    const layerCanvas = backend === 'auto' && rc.entityLayer
      ? rc.entityLayer.render(items, {
          cssWidth: canvasWidth, cssHeight: canvasHeight,
          dpr: (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1),
          camera,
          lighting: rc.lighting,
        })
      : null;
    if (layerCanvas) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(layerCanvas, 0, 0);
      ctx.restore();
    } else {
      executeDrawListCanvas(ctx, items);
    }

    ctx.restore();

    drawIsoOverlays(ctx, rc);
  };
}

export const renderMap: RenderMap = createIsoRenderMap();
