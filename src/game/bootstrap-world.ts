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
import { seedStatisticalCohorts } from '@/sim/cohorts';
import { planWorldLayout } from '@/world/poi-layout';
import { generateRivalSpirits } from '@/sim/rival-spirit';
import { rivalToSpirit } from '@/sim/command/rival-adapter';
import { identityOracle } from '@/world/oracle';
import { buildCharacterSpec, getOrGenerateSheet } from '@/render/lpc';
import { npcProps } from '@/world/npc-helpers';
import { loadDecorations } from '@/services/decoration-store';
import { WaterDynamics } from '@/render/gpu/water-dynamics';
import { buildFloodWatch } from '@/world/flood-watch';
import { CausalSiteStore } from '@/world/causal-site';
import { readSave as readSaveDefault } from '@/services/save-store';
import { applySaveFile, type SaveFile } from '@/core/save-file';
import { solarAnchorTickForDate, tickAtSolarHour } from '@/core/calendar';

export interface BootstrapDeps {
  state: GameState;
  assets: AssetManager;
  sheets: Map<string, HTMLCanvasElement>;
  decorationImages: DecorationImageCache;
  getViewport: () => Viewport;
  worldSeed?: WorldSeed;
  /** Phase announcements for the loading screen (worldgen sub-phases, restore steps).
   *  Messages ending in '...' are phase starts; others are stat lines. */
  onProgress?: (message: string) => void;
  /** Fired after the world is ready, before the caller starts the loop. */
  onReady?: () => void;
  /** Injectable for tests; defaults to the IndexedDB save-store reader. */
  readSave?: () => Promise<SaveFile | null>;
  /** Injectable for tests; defaults to applySaveFile. Returns false on version mismatch. */
  applySave?: (state: GameState, save: SaveFile) => boolean;
}

/** Yield one macrotask so a just-updated progress label can actually paint before
 *  the next synchronous block (visualMap/blobMap/seedWorld) grabs the thread. */
const yieldToPaint = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export async function bootstrapWorld(deps: BootstrapDeps): Promise<GameMap> {
  const { state, assets, sheets, decorationImages, getViewport } = deps;
  const progress = deps.onProgress ?? (() => {});

  // Terrain gen seed override: `?genseed=N` exists so a dev (or an agent verifying
  // worldgen) loads the SAME roll the offline probes/lint use. Parsed BEFORE the
  // resume branch — an explicit genseed must force a fresh deterministic gen, or an
  // existing autosave silently wins and the param does nothing (user-reported).
  const genseedOverride = ((): number | null => {
    try {
      const p = Number(new URLSearchParams(window.location.search).get('genseed'));
      if (Number.isFinite(p) && p > 0) return p;
    } catch { /* non-browser host */ }
    return null;
  })();

  // Resume branch: if a valid autosave exists, rehydrate it and skip the whole
  // generate/seed path. The saved world already has its entities, spirits,
  // rivals, clock, event history, and camera.
  const readSaveFn = deps.readSave ?? readSaveDefault;
  const applySaveFn = deps.applySave ?? applySaveFile;
  progress(genseedOverride !== null ? 'Fresh world (genseed override)...' : 'Looking for a saved world...');
  const saved = genseedOverride !== null ? null : await readSaveFn();
  if (saved && applySaveFn(state, saved)) {
    progress('Waking your saved world...');
    await assets.loadAll();
    state.generatedDecorations = loadDecorations(state.worldSeed?.name ?? '');
    void decorationImages.preload(state.generatedDecorations.map(d => d.assetId));
    kickOffSheets(state, sheets);
    if (state.map) installWeather(state, state.map);   // W-G: deterministic water stepper
    deps.onReady?.();
    return state.map!;
  }

  const ws = deps.worldSeed || await WorldManager.loadDefault();
  // Terrain gen seed: random per fresh world, overridable via `?genseed=N` so a dev (or
  // an agent verifying worldgen) can load the SAME roll the offline probes/lint use.
  const seed = (() => {
    try {
      const p = Number(new URLSearchParams(window.location.search).get('genseed'));
      if (Number.isFinite(p) && p > 0) return p;
    } catch { /* non-browser host */ }
    return Date.now();
  })();

  // TRUE-1:1 wall-clock anchor: stamp the clock's STARTING tick from the
  // player's local time so game solar time matches the real clock (boot at
  // 21:30 → the world is in evening). Generated exactly once, here, before
  // anything reads the clock (seeded-NPC birthTicks, the timeline baseline);
  // from then on everything is a pure deterministic function of the tick, and
  // the anchor persists as ordinary save/snapshot tick state. Overridable via
  // `?solarhour=H` (dev/e2e determinism); non-browser hosts (tests, scripts)
  // keep the fixed tick-0 = 09:00 fallback (SOLAR_START_HOUR).
  const anchorTick = (() => {
    try {
      const p = new URLSearchParams(window.location.search).get('solarhour');
      if (p !== null && Number.isFinite(Number(p))) return tickAtSolarHour(Number(p));
      return solarAnchorTickForDate(new Date());
    } catch { return 0; /* non-browser host */ }
  })();
  if (anchorTick > 0) state.clock.setNow(anchorTick);

  // W0/W3 (connectome-driven world layout): derive the map size from the content
  // (always big enough for every POI/region/waypoint) and, for island worlds,
  // recentre the layout inside an ocean margin. No-op for a non-island,
  // well-authored world (e.g. default.json) — generation stays byte-identical.
  const layout = planWorldLayout(ws);
  ws.size = layout.size;
  ws.pois = layout.pois;
  ws.connections = layout.connections;

  const { map, world, biomeMap, trample } = await generateWithNoise(
    ws.size.width, ws.size.height, seed, ws,
    { onProgress: (msg) => { console.log('[terrain]', msg); progress(msg); } },
  );

  state.map = map;
  state.worldSeed = ws;
  state.world = world;
  state.biomeMap = biomeMap;
  // Desire-line trample grid, prewarmed from authored roads/markets; live NPC
  // traffic keeps carving from here (fed by the trample systems in game.ts).
  state.trample = trample;
  progress('Preparing the view...');
  await yieldToPaint();
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

  progress('Peopling the world...');
  await yieldToPaint();
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
  // Two-tier population (P1): seed each inhabited settlement's STATISTICAL tier
  // (fiction population beyond the named residents). After rival instantiation
  // so heathen settlements can lean toward the rival that holds them; before
  // the first sim tick so CohortSystem's conservation baseline includes it.
  state.cohorts = seedStatisticalCohorts(state.world!, ws, state.spirits, state.clock.now());
  installWeather(state, map);   // W-G: deterministic water stepper + flood watch
  kickOffSheets(state, sheets);
  state.generatedDecorations = loadDecorations(ws.name);
  // Kick off image preloading; missing ids resolve to null and the renderer
  // falls back to placeholder squares until the load completes.
  void decorationImages.preload(state.generatedDecorations.map(d => d.assetId));

  deps.onReady?.();

  return map;
}

/**
 * W-G: install the deterministic water/atmosphere stepper + the per-world flood watch
 * onto the state. `WeatherSystem` (registered in game.ts) steps the stepper on the sim
 * tick and polls the watch; the stepper's fields are captured in the snapshot. The
 * watch covers the placed POIs (the "important places" a flood event names).
 */
function installWeather(state: GameState, map: GameMap): void {
  state.weather = new WaterDynamics(map);
  const pois = state.worldSeed?.pois ?? [];
  const placed = pois.filter((p) => p.position);
  state.floodWatch = buildFloodWatch(
    placed.map((p) => ({ id: p.id, name: p.name ?? p.id, x: p.position!.x, y: p.position!.y, radius: 3 })),
    map.width, map.height,
  );
  // W-I: causal sites are born from floods on land the watch does NOT cover (settlement
  // floods are the watch's job). Exclude the watched footprints; name new sites after
  // the nearest authored landmark.
  state.causalSites = new CausalSiteStore(
    map.width, map.height,
    state.floodWatch.watchedCells(),
    placed.map((p) => ({ name: p.name ?? p.id, x: p.position!.x, y: p.position!.y })),
  );
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
