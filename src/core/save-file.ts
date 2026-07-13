import type { GameState } from '@/core/state';
import type { GameMap, BiomeMap, Camera, EntityId, WorldSeed } from '@/core/types';
import type { AppendedEvent } from '@/core/events';
import { captureSnapshot, captureSnapshotLive, restoreSnapshot, type Snapshot } from '@/core/snapshot';
import { encodeTiles, decodeTiles, type EncodedTiles } from '@/core/tile-codec';
import { Autotiler } from '@/map/autotiler';
import { computeBlobMap } from '@/map/blob-autotiler';
import { WORLD_CONTENT_VERSION } from '@/core/content-version';

/** Bump when the SaveFile shape changes incompatibly. `applySaveFile` discards
 *  any save whose version differs (caller boots fresh). No migration.
 *  v2: TRUE-1:1 REALTIME — TICKS_PER_DAY went 240 → 5,184,000, so a v1 save's
 *  tick counts (clock, birthTicks, cooldowns, event timestamps) would
 *  reinterpret wildly (a 30-year-old NPC would read as minutes old). Old
 *  autosaves degrade to a fresh world rather than a corrupted-feeling one.
 *  v3: COMPACT TILE CODEC — `map.tiles` is persisted as `EncodedTiles` (typed
 *  arrays + sparse exceptions, `core/tile-codec.ts`) instead of ~171k Tile
 *  objects, so IDB put()'s synchronous structured clone stops walking the
 *  grid object-by-object (was the dominant ~720 ms of the autosave task). */
export const SAVE_VERSION = 3;

export interface SaveView {
  camera: Camera;
  selectedNpcId: string | null;
  pinnedNpcId: string | null;
  followNpc: boolean;
  cameraLock: { mode: 'follower' | 'free'; targetId?: EntityId };
  debug: boolean;
  showLabels: boolean;
  showPoiMarkers: boolean;
}

/** The persisted map: every GameMap field verbatim EXCEPT `tiles`, which is
 *  stored in the compact typed-array form so put()'s structured clone never
 *  walks 171k tile objects. `applySaveFile` decodes back to full Tile objects. */
export interface SavedGameMap extends Omit<GameMap, 'tiles'> {
  tiles: EncodedTiles;
}

export interface SaveFile {
  version: number;
  /** World-content version (worldgen/preset output). Mismatch on load → discard
   *  and boot fresh. Distinct from `version`, which guards the save schema. */
  contentVersion: number;
  /** Wall-clock ms at save time. Passed in by the caller; the sim stays Date.now-free. */
  savedAt: number;
  worldSeed: WorldSeed | null;
  /** Stored verbatim (not regenerated) so saves survive generator code changes;
   *  tiles ride the compact codec (see SavedGameMap). */
  map: SavedGameMap;
  /** Produced by generateWithNoise; not derivable from `map` alone. */
  biomeMap: BiomeMap | null;
  /** The full live-world snapshot: tick, rng, entities, spirits, activeEvents. */
  snapshot: Snapshot;
  /** The canonical event log (the time-history strip depends on it). */
  events: AppendedEvent[];
  view: SaveView;
}

export function toSaveFile(state: GameState, savedAt: number): SaveFile {
  return buildSaveFile(state, savedAt, true);
}

/**
 * SaveFile that ALIASES live state (map fields, snapshot entities, event
 * objects) instead of deep-cloning — the autosave path uses it because
 * IndexedDB's `put()` structured-clones the value synchronously at call time
 * anyway, so the deep copies here were paid twice per save. Tiles are the one
 * exception: they are ENCODED (compact typed arrays, `core/tile-codec.ts`)
 * synchronously in here rather than aliased, so put()'s clone never walks the
 * 171k-object grid (that walk was the residual ~720 ms autosave task).
 *
 * CONTRACT (same as `captureSnapshotLive`): only coherent within the CURRENT
 * task — hand it to a synchronous consumer (IDB `put`) before yielding to the
 * event loop; never hold it across an await or a frame.
 */
export function toSaveFileLive(state: GameState, savedAt: number): SaveFile {
  return buildSaveFile(state, savedAt, false);
}

function buildSaveFile(state: GameState, savedAt: number, deep: boolean): SaveFile {
  if (!state.world || !state.map) {
    throw new Error('toSaveFile: world/map not initialized');
  }
  // Tiles ALWAYS go through the compact codec (both paths): the encode is a
  // synchronous linear typed-array fill (~10 ms on a 171k-tile map) and the
  // encoded arrays never alias the live grid, so put()'s structured clone of
  // the map becomes a few memcpys instead of a 171k-object walk. The rest of
  // the map (roadGraph, settlementPlans, …) is small; live mode aliases it
  // under the same current-task contract as the snapshot.
  const { tiles, ...mapRest } = state.map;
  const map: SavedGameMap = {
    ...(deep ? structuredClone(mapRest) : mapRest),
    tiles: encodeTiles(tiles, state.map.width, state.map.height),
  };
  return {
    version: SAVE_VERSION,
    contentVersion: WORLD_CONTENT_VERSION,
    savedAt,
    worldSeed: deep && state.worldSeed ? structuredClone(state.worldSeed) : state.worldSeed,
    map,
    biomeMap: deep && state.biomeMap ? structuredClone(state.biomeMap) : state.biomeMap,
    snapshot: deep ? captureSnapshot(state) : captureSnapshotLive(state),
    // `since(0)` returns a fresh array; in live mode the EVENT objects stay
    // aliased (append-only + immutable once appended, so safe under the contract).
    //
    // KNOWN GROWTH (design note, 2026-07-13): this is O(total history) per save
    // — the array AND put()'s clone of it grow without bound on a 24h-realtime
    // world. Fixing it cleanly means moving events OUT of the SaveFile blob
    // into an append-only IDB journal (one row per event batch, save stores a
    // cursor; rewrite-compaction on clearSave/newWorld) so each autosave
    // persists only the delta since the last one. That touches save-store's
    // slot semantics + the resume path's EventLog.hydrate and deserves its own
    // round; NOT half-done here. Until then the tile codec removes the
    // dominant cost, and events stay correct-but-linear.
    events: deep ? structuredClone(state.eventLog.since(0)) : state.eventLog.since(0),
    view: {
      camera: { ...state.camera },
      selectedNpcId: state.selectedNpcId,
      pinnedNpcId: state.pinnedNpcId,
      followNpc: state.followNpc,
      cameraLock: { ...state.cameraLock },
      debug: state.debug,
      showLabels: state.showLabels,
      showPoiMarkers: state.showPoiMarkers,
    },
  };
}

/**
 * Rehydrate a saved game into `state`. Returns false (mutating nothing) on a
 * version mismatch so the caller can discard the save and boot fresh.
 */
export function applySaveFile(state: GameState, save: SaveFile): boolean {
  if (save.version !== SAVE_VERSION) return false;
  if (save.contentVersion !== WORLD_CONTENT_VERSION) return false;

  // Map must be set BEFORE restoreSnapshot — it does `new World(state.map)`.
  // Tiles come back through the codec (fresh objects); the rest of the map is
  // deep-cloned so the restored state never aliases the save.
  const { tiles: encodedTiles, ...mapRest } = save.map;
  state.map = { ...structuredClone(mapRest), tiles: decodeTiles(encodedTiles) };
  state.worldSeed = save.worldSeed ? structuredClone(save.worldSeed) : null;
  state.biomeMap = save.biomeMap ? structuredClone(save.biomeMap) : null;
  state.visualMap = Autotiler.computeVisualMap(state.map);
  state.blobMap = computeBlobMap(state.map.tiles, state.map.width, state.map.height);

  restoreSnapshot(state, save.snapshot);
  state.eventLog.hydrate(structuredClone(save.events));

  const v = save.view;
  Object.assign(state.camera, v.camera);
  state.selectedNpcId = v.selectedNpcId;
  state.pinnedNpcId = v.pinnedNpcId;
  state.followNpc = v.followNpc;
  state.cameraLock = { ...v.cameraLock };
  state.debug = v.debug;
  state.showLabels = v.showLabels;
  state.showPoiMarkers = v.showPoiMarkers;
  return true;
}
