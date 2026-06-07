import type { GameMap, Camera, WorldSeed, TerrainField, BiomeMap, GeneratedDecoration, EntityId } from '@/core/types';
import type { BlobTile } from '@/map/blob-autotiler';
import type { World } from '@/world/world';
import type { Spirit, SpiritId } from '@/core/spirit';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import { createCamera } from '@/render/camera';
import { createRng, type Rng } from '@/core/rng';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';

export interface GameState {
  map: GameMap | null;
  camera: Camera;
  worldSeed: WorldSeed | null;
  selectedNpcId: string | null;
  /** Building entity whose info panel is open, or null. Mirrors selectedNpcId. */
  selectedBuildingId: string | null;
  visualMap: string[][] | null;
  blobMap: BlobTile[][] | null;
  debug: boolean;
  showLabels: boolean;
  showPoiMarkers: boolean;
  pinnedNpcId: string | null;
  followNpc: boolean;
  spirits: Map<SpiritId, Spirit>;
  eventLog: EventLog;
  clock: SimClock;
  cameraLock: { mode: 'follower' | 'free'; targetId?: EntityId };
  rng: Rng;
  world: World | null;
  terrainFields: TerrainField | null;
  biomeMap: BiomeMap | null;
  generatedDecorations: GeneratedDecoration[];
  /** Narrative substrate: recognized/tracked plot threads (serialized in snapshots). */
  plotThreads: PlotThreadStore;
  /** Narrative substrate: armed, dormant staged beats (serialized in snapshots). */
  staging: StagingBuffer;
}

export function createState(): GameState {
  const clock = new SimClock();
  const eventLog = new EventLog(clock);
  const rng = createRng(1);
  const spirits = new Map<SpiritId, Spirit>();
  // Seed the player spirit. Named "Fooob" placeholder — naming ritual is Spec E.
  spirits.set('player', {
    id: 'player',
    name: 'Fooob',
    sigil: '⊙',
    color: '#ffd700',
    isPlayer: true,
    power: 10, // Slice-1 stipend so the player can act before belief generates power
    manifestation: null,
  });
  eventLog.append({ type: 'spirit_birth', spiritId: 'player', name: 'Fooob', isPlayer: true });

  return {
    map: null,
    camera: createCamera(),
    worldSeed: null,
    selectedNpcId: null,
    selectedBuildingId: null,
    visualMap: null,
    blobMap: null,
    debug: false,
    showLabels: true,
    showPoiMarkers: true,
    pinnedNpcId: null,
    followNpc: false,
    spirits,
    eventLog,
    clock,
    cameraLock: { mode: 'free' },
    rng,
    world: null,
    terrainFields: null,
    biomeMap: null,
    generatedDecorations: [],
    plotThreads: new PlotThreadStore(),
    staging: new StagingBuffer(),
  };
}
