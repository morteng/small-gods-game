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
 *  grid object-by-object (was the dominant ~720 ms of the autosave task).
 *  v4: EVENT JOURNAL — `events` (the O(total history) array that grew without
 *  bound on a 24h-realtime world — see the removed KNOWN GROWTH note this
 *  replaces) is gone from the blob. `eventCursor` (the journal high-water
 *  mark) and `playtimeMs` (real playtime; meta state, outside the
 *  deterministic stream, same reasoning as `savedAt`) take its place. The
 *  actual event history now lives in the `event-journal` IDB store
 *  (`services/save-store.ts`), appended incrementally per save and read back
 *  via `readJournal(slot, save.eventCursor)` on resume. */
export const SAVE_VERSION = 4;

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
  /** Real playtime accrued in this world (ms, real time), stamped at save
   *  time. Top-level, not inside `snapshot` — meta state outside the
   *  deterministic sim stream, same reasoning as `savedAt`. */
  playtimeMs: number;
  /** Journal high-water mark: the highest event id captured as of this save
   *  (`EventLog.lastId()`). The events themselves no longer ride the blob —
   *  `readJournal(slot, eventCursor)` (`services/save-store.ts`) reconstructs
   *  this save's exact event history from the `event-journal` IDB store. */
  eventCursor: number;
  worldSeed: WorldSeed | null;
  /** Stored verbatim (not regenerated) so saves survive generator code changes;
   *  tiles ride the compact codec (see SavedGameMap). */
  map: SavedGameMap;
  /** Produced by generateWithNoise; not derivable from `map` alone. */
  biomeMap: BiomeMap | null;
  /** The full live-world snapshot: tick, rng, entities, spirits, activeEvents. */
  snapshot: Snapshot;
  view: SaveView;
}

export function toSaveFile(state: GameState, savedAt: number, playtimeMs = 0): SaveFile {
  return buildSaveFile(state, savedAt, playtimeMs, true);
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
export function toSaveFileLive(state: GameState, savedAt: number, playtimeMs = 0): SaveFile {
  return buildSaveFile(state, savedAt, playtimeMs, false);
}

function buildSaveFile(state: GameState, savedAt: number, playtimeMs: number, deep: boolean): SaveFile {
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
    playtimeMs,
    // The event ARRAY no longer rides the blob (see the v4 note on
    // SAVE_VERSION — this used to be an O(total history) `structuredClone`
    // of `eventLog.since(0)`, unbounded on a 24h-realtime world). The blob
    // only stamps where the log currently stands; `services/save-store.ts`
    // journals the actual events incrementally, in the same IDB transaction
    // as this blob, keyed off this same cursor.
    eventCursor: state.eventLog.lastId(),
    worldSeed: deep && state.worldSeed ? structuredClone(state.worldSeed) : state.worldSeed,
    map,
    biomeMap: deep && state.biomeMap ? structuredClone(state.biomeMap) : state.biomeMap,
    snapshot: deep ? captureSnapshot(state) : captureSnapshotLive(state),
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
 *
 * `events` is the save's event HISTORY, read separately from the blob (v4: it
 * no longer lives on `SaveFile` — see `services/save-store.ts#readJournal`,
 * keyed by `save.eventCursor`). Defaults to `[]` so a caller that hasn't
 * wired the journal read yet (or a save with no journaled history) still
 * resumes — an empty event log degrades the annals strip, not the load; same
 * philosophy as a journal read failure (never fail the load over history).
 */
export function applySaveFile(state: GameState, save: SaveFile, events: AppendedEvent[] = []): boolean {
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
  state.eventLog.hydrate(structuredClone(events));

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
