import type { GameState } from '@/core/state';
import type { RenderContext, DevModeState, Entity } from '@/core/types';
import type { AssetManager } from '@/render/asset-manager';
import type { DecorationImageCache } from '@/render/decoration-image-cache';
import type { ArtResolver } from '@/render/art-resolver';
import type { ParametricBuildingSource } from '@/render/parametric-building-source';
import type { ParametricBarrierSource } from '@/render/parametric-barrier-source';
import type { ParametricPlantSource } from '@/render/parametric-plant-source';
import type { GeneratedBuildingArtSource } from '@/render/generated-building-art-source';
import type { GeneratedFloraArtSource } from '@/render/generated-flora-art-source';
import type { Viewport } from './viewport';
import { toRenderNpc } from '@/world/npc-helpers';
import { DEFAULT_LIGHTING, LIGHTING_OFF } from '@/render/lighting-state';

export interface RenderContextDeps {
  state: GameState;
  viewport: Viewport;
  sheets: Map<string, HTMLCanvasElement>;
  assets: AssetManager;
  decorationImages: DecorationImageCache;
  artResolver: ArtResolver;
  buildingArtResolver: ArtResolver;
  parametricBuildingSource: ParametricBuildingSource;
  /** Optional: the world barrier source. Absent ⇒ barriers fall back to the flat-quad slabs. */
  parametricBarrierSource?: ParametricBarrierSource;
  parametricPlantSource: ParametricPlantSource;
  generatedBuildingArtSource?: GeneratedBuildingArtSource;
  generatedFloraArtSource?: GeneratedFloraArtSource;
  devMode: DevModeState;
  /** Interior I-2 reveal flag (`?interiorReveal`/`?i2`): when on, the SELECTED building
   *  renders cutaway (roof off). Off ⇒ the cutaway swap is fully inert (byte-identical render). */
  interiorReveal?: boolean;
}

/** Dev eyeball override for the day/night emissive factor. Set `window.__nightFactor`
 *  to a 0..1 number to force the lit-window glow at any time of day; clear it (or set a
 *  non-number) to fall back to the clock-derived value. */
function nightFactorOverride(): number | null {
  const v = (globalThis as { __nightFactor?: unknown }).__nightFactor;
  return typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
}

/** Single source of truth for the per-frame RenderContext.
 *  `map` and `world` are asserted non-null — every caller guards both before calling.
 *  `npcs` is [] when no world exists yet (pre-generation). */
export function buildRenderContext(deps: RenderContextDeps): RenderContext {
  const { state, viewport, sheets, assets, decorationImages, artResolver, buildingArtResolver, parametricBuildingSource, parametricBarrierSource, parametricPlantSource, generatedBuildingArtSource, generatedFloraArtSource, devMode } = deps;
  // Interior I-2: the focused building (if any) renders cutaway when the reveal flag is on.
  // Off (default) ⇒ null ⇒ every building takes the unchanged closed path.
  const cutawayBuildingId = deps.interiorReveal ? (state.selectedBuildingId ?? null) : null;
  return {
    map: state.map!,
    camera: state.camera,
    waterLevelM: state.waterLevelM,
    // W-G: localized lake level + per-cell flood from the live water stepper, so a
    // flood/drought shows in the running game (not just the studio).
    lakeOffsetM: state.weather?.lakeOffsetM?.(),
    floodOffsetM: state.weather?.floodOffsetM(),
    canvasWidth: viewport.width,
    canvasHeight: viewport.height,
    npcs: state.world ? state.world.query({ kind: 'npc' }).map(toRenderNpc) : [],
    npcSheets: sheets,
    visualMap: state.visualMap,
    blobMap: state.blobMap ?? null,
    tileAtlas: assets.getTileAtlas(),
    terrainSheets: assets.getTerrainSheets(),
    buildingSprites: assets.getBuildingSprites(),
    world: state.world!,
    showLabels: state.showLabels,
    showPoiMarkers: state.showPoiMarkers,
    generatedDecorations: state.generatedDecorations,
    resolveDecorationImage: (id: string) => decorationImages.get(id),
    resolveEntityArt: (entity: Entity) => {
      const id = artResolver.peek(entity);
      if (id) return decorationImages.get(id);
      artResolver.warm(entity); // fire-and-forget; never blocks the frame
      return null;
    },
    resolveBuildingArt: (entity: Entity) => {
      // The focused (cutaway) building skips the closed asset/img2img sprite so the
      // parametric cutaway wins via pickBuildingSource.
      if (entity.id === cutawayBuildingId) return null;
      const id = buildingArtResolver.peek(entity);
      if (id) return decorationImages.get(id); // shared kind-agnostic image cache
      buildingArtResolver.warm(entity); // fire-and-forget; never blocks the frame
      return null;
    },
    resolveParametricBuildingArt: (entity: Entity) => {
      const cutaway = entity.id === cutawayBuildingId;
      const s = parametricBuildingSource.peek(entity, cutaway);
      if (s) return s;
      parametricBuildingSource.warm(entity, cutaway); // fire-and-forget; never blocks the frame
      return null;
    },
    resolveParametricBarrierArt: parametricBarrierSource
      ? (entity: Entity) => {
          const pieces = parametricBarrierSource.peek(entity);
          if (pieces) return pieces;
          parametricBarrierSource.warm(entity); // fire-and-forget; never blocks the frame
          return null;
        }
      : undefined,
    resolveParametricPlantArt: (kind: string) => {
      // Prefer the img2img-refined flora sprite (IDB cache / vendored library /
      // paid gen when enabled); fall back to the grey parametric massing on a miss.
      // Both warm fire-and-forget so the frame never blocks.
      if (generatedFloraArtSource) {
        const g = generatedFloraArtSource.peek(kind);
        if (g) return g;
        generatedFloraArtSource.warm(kind);
      }
      const s = parametricPlantSource.peek(kind);
      if (s) return s;
      parametricPlantSource.warm(kind); // fire-and-forget; never blocks the frame
      return null;
    },
    resolveGeneratedBuildingArt: (entity: Entity) => {
      const src = generatedBuildingArtSource;
      if (!src) return null;
      // Focused (cutaway) building skips its closed img2img sprite — parametric cutaway wins.
      if (entity.id === cutawayBuildingId) return null;
      const s = src.peek(entity);
      if (s) return s;
      src.warm(entity); // fire-and-forget; never blocks the frame
      return null;
    },
    // Window lighting: the emissive (lit-window) glow is DISABLED for now — driving it off the
    // raw sim clock made every window blink on/off as time advanced, with no relation to whether
    // anyone's home. It should be wired to real occupancy + time-of-day (a building knows its
    // residents + their schedules) before it comes back. Until then nightFactor is 0 (no glow);
    // `__nightFactor` (dev) still overrides for eyeballing the pane emissive. Re-enable via
    // `nightFactorForTick(state.clock.now())` once an occupancy signal gates it.
    lighting: devMode.lighting === 'off'
      ? LIGHTING_OFF
      : { ...DEFAULT_LIGHTING, nightFactor: nightFactorOverride() ?? 0 },
    devMode,
    // Folds into the static draw-cache key so the building layer rebuilds once the
    // async parametric massing packs finish composing (otherwise the first snapshot —
    // taken before compose lands — freezes flatblock fallbacks forever).
    buildingArtRev: parametricBuildingSource.version() + (parametricBarrierSource?.version() ?? 0),
    cutawayBuildingId,
  };
}
