import type { GameMap, WorldSeed } from '@/core/types';
import type { GameState } from '@/core/state';
import type { AssetManager } from '@/render/asset-manager';
import type { DecorationImageCache } from '@/render/decoration-image-cache';
import type { Viewport } from './viewport';
import { WorldManager } from '@/map/world-manager';
import { generateWithNoise } from '@/map/map-generator';
import { Autotiler } from '@/map/autotiler';
import { computeBlobMap } from '@/map/blob-autotiler';
import { centerOn } from '@/render/camera';
import { readRenderMode } from '@/render/select-renderer';
import { seedWorld } from '@/world/seed-world';
import { identityOracle } from '@/world/oracle';
import { buildCharacterSpec, getOrGenerateSheet } from '@/render/lpc';
import { npcProps } from '@/world/npc-helpers';
import { loadDecorations } from '@/services/decoration-store';
import { TILE_SIZE } from '@/core/constants';

export interface BootstrapDeps {
  state: GameState;
  assets: AssetManager;
  sheets: Map<string, HTMLCanvasElement>;
  decorationImages: DecorationImageCache;
  getViewport: () => Viewport;
  worldSeed?: WorldSeed;
  /** Fired after the world is ready, before the caller starts the loop. */
  onReady?: () => void;
}

export async function bootstrapWorld(deps: BootstrapDeps): Promise<GameMap> {
  const { state, assets, sheets, decorationImages, getViewport } = deps;

  const ws = deps.worldSeed || await WorldManager.loadDefault();
  const seed = Date.now();

  const { map, world } = await generateWithNoise(
    ws.size.width, ws.size.height, seed, ws,
    { onProgress: (msg) => console.log('[terrain]', msg) },
  );

  state.map = map;
  state.worldSeed = ws;
  state.world = world;
  state.visualMap = Autotiler.computeVisualMap(map);
  state.blobMap = computeBlobMap(map.tiles, map.width, map.height);
  await assets.loadAll();

  const vp = getViewport();
  centerOn(
    state.camera,
    (map.width  * TILE_SIZE) / 2,
    (map.height * TILE_SIZE) / 2,
    vp.width,
    vp.height,
  );

  // In iso mode the camera coordinate space is different - recentre
  if (readRenderMode() === 'iso') {
    const { centerOnTile } = await import('@/render/iso/iso-camera');
    centerOnTile(
      state.camera,
      Math.floor(map.width / 2),
      Math.floor(map.height / 2),
      vp.width,
      vp.height,
    );
  }

  seedWorld({
    world: state.world!,
    log: state.eventLog,
    clock: state.clock,
    spirits: state.spirits,
    rng: state.rng,
    worldSeed: ws,
    map,
    oracle: identityOracle,
  });
  kickOffSheets(state, sheets);
  state.generatedDecorations = loadDecorations(ws.name);
  // Kick off image preloading; missing ids resolve to null and the renderer
  // falls back to placeholder squares until the load completes.
  void decorationImages.preload(state.generatedDecorations.map(d => d.assetId));

  deps.onReady?.();

  return map;
}

function kickOffSheets(state: GameState, sheets: Map<string, HTMLCanvasElement>): void {
  if (!state.world) return;
  for (const e of state.world.query({ kind: 'npc' })) {
    if (sheets.has(e.id)) continue;
    const p = npcProps(e);
    const spec = buildCharacterSpec(p.role, p.seed);
    getOrGenerateSheet(spec).then(canvas => {
      if (canvas) sheets.set(e.id, canvas);
    });
  }
}
