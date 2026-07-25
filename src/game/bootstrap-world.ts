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
import { buildFloodWatchForMap, watchedPlaceSpecs } from '@/world/flood-watch';
import { CausalSiteStore } from '@/world/causal-site';
import { readSave as readSaveDefault, readJournal as readJournalDefault } from '@/services/save-store';
import { applySaveFile, type SaveFile } from '@/core/save-file';
import type { AppendedEvent } from '@/core/events';
import { tickAtSolarHour, WORLD_START_HOUR } from '@/core/calendar';
import { PINNED_GEN_SEED } from '@/core/constants';

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
  /** Fired ONLY when an existing save was successfully resumed, with that save.
   *  The caller needs it to know the journal cursor the autosave should continue
   *  from — the events just hydrated into the log are already persisted, so
   *  appending them again would duplicate the world's history. */
  onResumed?: (save: SaveFile) => void;
  /** UI v3: force a fresh generation regardless of any existing autosave. The URL
   *  flags (`?genseed`, `?genome`) still force it on their own; this is the
   *  EXPLICIT, programmatic route — the one a `new_game` command from the title
   *  screen (or from a connected agent over the bus) travels, since an agent has
   *  no URL to set. */
  forceFresh?: boolean;
  /** UI v3: terrain gen seed, overriding both `?genseed` and the pinned default.
   *  Same reasoning as `forceFresh`: `new_game { genSeed }` must be expressible
   *  without a page reload. */
  genSeedOverride?: number;
  /** Injectable for tests; defaults to the IndexedDB save-store reader. */
  readSave?: () => Promise<SaveFile | null>;
  /** Injectable for tests; defaults to `readJournal`. The event history no longer
   *  rides the SaveFile blob (it was O(total history) per autosave on a world
   *  where a real day is a real day) — it lives in an append-only IDB journal and
   *  is read back separately, up to the cursor the save recorded. */
  readJournal?: (upTo: number) => Promise<AppendedEvent[]>;
  /** Injectable for tests; defaults to applySaveFile. Returns false on version mismatch. */
  applySave?: (state: GameState, save: SaveFile, events: AppendedEvent[]) => boolean;
}

/** Yield one macrotask so a just-updated progress label can actually paint before
 *  the next synchronous block (visualMap/blobMap/seedWorld) grabs the thread. */
const yieldToPaint = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Read the event journal, degrading to an EMPTY history on any failure. The
 *  journal is flavour (the annals strip); the world is the thing worth saving. */
async function readJournalSafely(
  read: (upTo: number) => Promise<AppendedEvent[]>,
  upTo: number,
): Promise<AppendedEvent[]> {
  try {
    return await read(upTo);
  } catch (err) {
    console.warn('[boot] event journal unreadable — restoring without history', err);
    return [];
  }
}

export async function bootstrapWorld(deps: BootstrapDeps): Promise<GameMap> {
  const { state, assets, sheets, decorationImages, getViewport } = deps;
  const progress = deps.onProgress ?? (() => {});

  // Terrain gen seed override: `?genseed=N` exists so a dev (or an agent verifying
  // worldgen) loads the SAME roll the offline probes/lint use. Parsed BEFORE the
  // resume branch — an explicit genseed must force a fresh deterministic gen, or an
  // existing autosave silently wins and the param does nothing (user-reported).
  const genseedOverride = ((): number | null => {
    // An explicit caller-supplied seed wins over the URL: a `new_game { genSeed }`
    // command must be able to pick a world without touching `location`.
    if (deps.genSeedOverride !== undefined
      && Number.isFinite(deps.genSeedOverride) && deps.genSeedOverride > 0) {
      return deps.genSeedOverride;
    }
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
  const readJournalFn = deps.readJournal ?? ((upTo: number) => readJournalDefault('autosave', upTo));
  const applySaveFn = deps.applySave ?? applySaveFile;
  // A generated genome (`?genome=…`) is an explicit fresh terrain study — an existing
  // autosave must NOT shadow it (same reasoning as the genseed override).
  const genomeFresh = (() => {
    try { return new URLSearchParams(window.location.search).has('genome'); }
    catch { return false; }
  })();
  const forceFresh = deps.forceFresh === true || genseedOverride !== null || genomeFresh;
  progress(forceFresh ? 'Fresh world...' : 'Looking for a saved world...');
  const saved = forceFresh ? null : await readSaveFn();
  // The chronicle/history comes from the journal, read up to the cursor this save
  // recorded. A journal read that fails degrades to NO HISTORY — the world still
  // loads and the annals strip is simply short. Losing the world because its
  // history could not be read would be a far worse trade.
  const events = saved ? await readJournalSafely(readJournalFn, saved.eventCursor) : [];
  if (saved && applySaveFn(state, saved, events)) {
    deps.onResumed?.(saved);
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
  // Terrain gen seed: PINNED by default (not random) so a fresh boot builds the
  // exact world the vendored sprite bundle was seeded against — every bld/bar
  // pack is a bundle hit and "Raising the buildings…" costs ~nothing. Variety
  // stays an explicit ask: `?genseed=N` rolls any other world (and pays its
  // first-boot composes, cached to IDB after).
  const seed = genseedOverride ?? PINNED_GEN_SEED;

  // Fixed morning start: every fresh world's clock is stamped to
  // WORLD_START_HOUR (08:00) — regardless of the player's wall clock, so a new
  // game never opens in the dark. Stamped exactly once, here, before anything
  // reads the clock (seeded-NPC birthTicks, the timeline baseline); from then
  // on everything is a pure deterministic function of the tick, and the anchor
  // persists as ordinary save/snapshot tick state. Time still flows 1:1 while
  // the game runs. Overridable via `?solarhour=H` (dev/e2e determinism);
  // non-browser hosts (tests, scripts) keep the tick-0 = 09:00 fallback
  // (SOLAR_START_HOUR).
  const anchorTick = (() => {
    try {
      const p = new URLSearchParams(window.location.search).get('solarhour');
      if (p !== null && Number.isFinite(Number(p))) return tickAtSolarHour(Number(p));
      return tickAtSolarHour(WORLD_START_HOUR);
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
  state.floodWatch = buildFloodWatchForMap(map);
  // W-I: causal sites are born from floods on land the watch does NOT cover (settlement
  // floods are the watch's job). Exclude the watched footprints; name new sites after
  // the nearest authored landmark.
  const placed = watchedPlaceSpecs(map);
  state.causalSites = new CausalSiteStore(
    map.width, map.height,
    state.floodWatch.watchedCells(),
    placed.map((p) => ({ name: p.name, x: p.x, y: p.y })),
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

/** Request an LPC sheet for every NPC that doesn't have one yet. Dedupes via the
 *  `sheets` map + the cache's inflight set, so calling it repeatedly is cheap.
 *  Exported for the Game's slow re-kick: NPCs BORN after boot (birth/lineage)
 *  otherwise never get a sheet and would stand around as fallback circles. */
export function kickOffSheets(state: GameState, sheets: Map<string, HTMLCanvasElement>): void {
  if (!state.world) return;
  for (const e of state.world.query({ kind: 'npc' })) {
    if (sheets.has(e.id)) continue;
    const p = npcProps(e);
    const spec = buildCharacterSpec(p.role, p.seed);
    // A sheet that fails to generate is survivable — that NPC renders as the
    // fallback circle. What is NOT survivable is letting it reject unhandled:
    // this runs on a repeating timer, so one broken spec would spray the console
    // (and, under a strict host, take the page down) every re-kick.
    getOrGenerateSheet(spec).then(
      canvas => { if (canvas) sheets.set(e.id, canvas); },
      err => { console.warn('[sheets] generation failed for', e.id, err); },
    );
  }
}
