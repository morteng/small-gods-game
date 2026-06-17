import type { GameMap, WorldSeed } from '@/core/types';
import type { GameState } from '@/core/state';
import type { AssetManager } from '@/render/asset-manager';
import type { DecorationImageCache } from '@/render/decoration-image-cache';
import type { Viewport } from './viewport';
import { WorldManager } from '@/map/world-manager';
import { generateWithNoise } from '@/map/map-generator';
import { Autotiler } from '@/map/autotiler';
import { computeBlobMap } from '@/map/blob-autotiler';
import { seedWorld } from '@/world/seed-world';
import { planWorldLayout } from '@/world/poi-layout';
import { generateRivalSpirits } from '@/sim/rival-spirit';
import { rivalToSpirit } from '@/sim/command/rival-adapter';
import { identityOracle } from '@/world/oracle';
import { buildCharacterSpec, getOrGenerateSheet } from '@/render/lpc';
import { npcProps } from '@/world/npc-helpers';
import { loadDecorations } from '@/services/decoration-store';
import { readSave as readSaveDefault } from '@/services/save-store';
import { applySaveFile, type SaveFile } from '@/core/save-file';

export interface BootstrapDeps {
  state: GameState;
  assets: AssetManager;
  sheets: Map<string, HTMLCanvasElement>;
  decorationImages: DecorationImageCache;
  getViewport: () => Viewport;
  worldSeed?: WorldSeed;
  /** Fired after the world is ready, before the caller starts the loop. */
  onReady?: () => void;
  /** Injectable for tests; defaults to the IndexedDB save-store reader. */
  readSave?: () => Promise<SaveFile | null>;
  /** Injectable for tests; defaults to applySaveFile. Returns false on version mismatch. */
  applySave?: (state: GameState, save: SaveFile) => boolean;
}

export async function bootstrapWorld(deps: BootstrapDeps): Promise<GameMap> {
  const { state, assets, sheets, decorationImages, getViewport } = deps;

  // Resume branch: if a valid autosave exists, rehydrate it and skip the whole
  // generate/seed path. The saved world already has its entities, spirits,
  // rivals, clock, event history, and camera.
  const readSaveFn = deps.readSave ?? readSaveDefault;
  const applySaveFn = deps.applySave ?? applySaveFile;
  const saved = await readSaveFn();
  if (saved && applySaveFn(state, saved)) {
    await assets.loadAll();
    state.generatedDecorations = loadDecorations(state.worldSeed?.name ?? '');
    void decorationImages.preload(state.generatedDecorations.map(d => d.assetId));
    kickOffSheets(state, sheets);
    deps.onReady?.();
    return state.map!;
  }

  const ws = deps.worldSeed || await WorldManager.loadDefault();
  const seed = Date.now();

  // W0/W3 (connectome-driven world layout): derive the map size from the content
  // (always big enough for every POI/region/waypoint) and, for island worlds,
  // recentre the layout inside an ocean margin. No-op for a non-island,
  // well-authored world (e.g. default.json) — generation stays byte-identical.
  const layout = planWorldLayout(ws);
  ws.size = layout.size;
  ws.pois = layout.pois;
  ws.connections = layout.connections;

  const { map, world, biomeMap } = await generateWithNoise(
    ws.size.width, ws.size.height, seed, ws,
    { onProgress: (msg) => console.log('[terrain]', msg) },
  );

  state.map = map;
  state.worldSeed = ws;
  state.world = world;
  state.biomeMap = biomeMap;
  state.visualMap = Autotiler.computeVisualMap(map);
  state.blobMap = computeBlobMap(map.tiles, map.width, map.height);
  await assets.loadAll();

  const vp = getViewport();
  // The renderer is iso-projected: centre the camera on the map's middle tile in
  // iso screen space.
  const { centerOnTile } = await import('@/render/iso/iso-camera');
  centerOnTile(
    state.camera,
    Math.floor(map.width / 2),
    Math.floor(map.height / 2),
    vp.width,
    vp.height,
  );

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
  instantiateRivals(state, ws);
  kickOffSheets(state, sheets);
  state.generatedDecorations = loadDecorations(ws.name);
  // Kick off image preloading; missing ids resolve to null and the renderer
  // falls back to placeholder squares until the load completes.
  void decorationImages.preload(state.generatedDecorations.map(d => d.assetId));

  deps.onReady?.();

  return map;
}

/**
 * Instantiate rival spirits as non-player Spirits in state.spirits (the first time
 * rivals are actually created). They claim inhabited POIs and act via the
 * RivalSystem. Seeded from the deterministic state.rng so the cohort is reproducible.
 */
function instantiateRivals(state: GameState, ws: WorldSeed): void {
  const settlementIds = (ws.pois ?? [])
    .filter(p => Array.isArray((p as { npcs?: unknown[] }).npcs) && (p as { npcs?: unknown[] }).npcs!.length > 0)
    .map(p => p.id);
  if (settlementIds.length === 0) return;

  const rivals = generateRivalSpirits(state.rng.nextInt(0x7fffffff), settlementIds, 2);
  for (const r of rivals) {
    state.spirits.set(r.id, rivalToSpirit(r));
  }
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
