import type { GameState } from '@/core/state';
import type { GameMap, BiomeMap, Camera, EntityId, WorldSeed } from '@/core/types';
import type { AppendedEvent } from '@/core/events';
import { captureSnapshot, restoreSnapshot, type Snapshot } from '@/core/snapshot';
import { Autotiler } from '@/map/autotiler';
import { computeBlobMap } from '@/map/blob-autotiler';
import { WORLD_CONTENT_VERSION } from '@/core/content-version';

/** Bump when the SaveFile shape changes incompatibly. `applySaveFile` discards
 *  any save whose version differs (caller boots fresh). No migration in v1. */
export const SAVE_VERSION = 1;

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

export interface SaveFile {
  version: number;
  /** World-content version (worldgen/preset output). Mismatch on load → discard
   *  and boot fresh. Distinct from `version`, which guards the save schema. */
  contentVersion: number;
  /** Wall-clock ms at save time. Passed in by the caller; the sim stays Date.now-free. */
  savedAt: number;
  worldSeed: WorldSeed | null;
  /** Stored verbatim (not regenerated) so saves survive generator code changes. */
  map: GameMap;
  /** Produced by generateWithNoise; not derivable from `map` alone. */
  biomeMap: BiomeMap | null;
  /** The full live-world snapshot: tick, rng, entities, spirits, activeEvents. */
  snapshot: Snapshot;
  /** The canonical event log (the time-history strip depends on it). */
  events: AppendedEvent[];
  view: SaveView;
}

export function toSaveFile(state: GameState, savedAt: number): SaveFile {
  if (!state.world || !state.map) {
    throw new Error('toSaveFile: world/map not initialized');
  }
  return {
    version: SAVE_VERSION,
    contentVersion: WORLD_CONTENT_VERSION,
    savedAt,
    worldSeed: state.worldSeed ? structuredClone(state.worldSeed) : null,
    map: structuredClone(state.map),
    biomeMap: state.biomeMap ? structuredClone(state.biomeMap) : null,
    snapshot: captureSnapshot(state),
    events: structuredClone(state.eventLog.since(0)),
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
  state.map = structuredClone(save.map);
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
