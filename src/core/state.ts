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
import { SystemStateRegistry } from '@/core/system-state';
import type { WeatherStepper } from '@/sim/water/weather-stepper';
import type { FloodWatch } from '@/world/flood-watch';
import type { CausalSiteStore } from '@/world/causal-site';
import type { TrampleGrid } from '@/sim/trample';
import type { SettlementCohorts } from '@/sim/cohorts';

export interface GameState {
  map: GameMap | null;
  camera: Camera;
  worldSeed: WorldSeed | null;
  selectedNpcId: string | null;
  /** Building entity whose info panel is open, or null. Mirrors selectedNpcId. */
  selectedBuildingId: string | null;
  /** W-I-d: the causal site (`causalSites`) whose card is open, or null. The
   *  third member of the mutually-exclusive selection set (npc / building / site). */
  selectedCausalSiteId: string | null;
  visualMap: string[][] | null;
  blobMap: BlobTile[][] | null;
  debug: boolean;
  showLabels: boolean;
  showPoiMarkers: boolean;
  pinnedNpcId: string | null;
  followNpc: boolean;
  /** P5 semantic-zoom: an in-flight camera-fly tween toward a tile anchor at a
   *  target zoom (set when the player clicks a zoomed-out alert pin). Presentation
   *  only — never serialized, never touches the command stream; cleared by
   *  `applyCameraFly` on arrival and by any user pan/zoom. */
  cameraFly: { tx: number; ty: number; zoom: number } | null;
  spirits: Map<SpiritId, Spirit>;
  eventLog: EventLog;
  clock: SimClock;
  cameraLock: { mode: 'follower' | 'free'; targetId?: EntityId };
  rng: Rng;
  world: World | null;
  terrainFields: TerrainField | null;
  biomeMap: BiomeMap | null;
  generatedDecorations: GeneratedDecoration[];
  /** WP-D scrub-ghost pattern: tick systems with internal sim state (cooldowns,
   *  edge-detection sides, ever-believed history) register here so snapshots
   *  capture + restore that state alongside entities/spirits. See
   *  `@/core/system-state`. */
  systemState: SystemStateRegistry;
  /** Narrative substrate: recognized/tracked plot threads (serialized in snapshots). */
  plotThreads: PlotThreadStore;
  /** Narrative substrate: armed, dormant staged beats (serialized in snapshots). */
  staging: StagingBuffer;
  /** Fate-surfacing seam (Track B / B-E): divine-inbox item ids the director has
   *  promoted with intent. Read by `GameQuery.divineInbox` to boost salience +
   *  flag items. Transient exogenous intent (like the command queue), not core sim
   *  state — dropped on snapshot restore, repopulated by the live director. */
  surfacedInbox: Set<string>;
  /** Inland water-level offset in METRES (drought < 0, flood > 0), applied to the
   *  river + lake water surfaces at render time — the shoreline recedes/advances
   *  along the real terrain contour. The sea (ocean) is the fixed datum, unaffected.
   *  A render parameter today (reversible, scrub-safe); the seam a climate/Fate
   *  drought-or-flood condition drives. */
  waterLevelM: number;
  /** W-G: the deterministic water/atmosphere stepper (render-side `WaterDynamics`,
   *  injected by the game) — stepped by `WeatherSystem` on the sim tick, its fields
   *  captured in the snapshot. Null until a world is seeded / in headless states. */
  weather: WeatherStepper | null;
  /** W-F/W-G: per-world flood watch over the important places (POIs). Polled by
   *  `WeatherSystem`; its latched flood state is snapshotted alongside the fields. */
  floodWatch: FloodWatch | null;
  /** W-I: ephemeral, event-born places (a god-flooded plain → "The Drowned Reach").
   *  Reconciled by `WeatherSystem` against the flood field each tick; its live sites
   *  are snapshotted. Null until a world is seeded. */
  causalSites: CausalSiteStore | null;
  /** Emergent desire-line trample grid: NPC footfall accumulates here and wears
   *  soft ground down to `dirt` trails (`@/sim/trample`). Prewarmed at gen from
   *  authored roads/markets, fed at runtime by the trample systems, captured in
   *  the snapshot. Null until a world is seeded / in headless states. */
  trample: TrampleGrid | null;
  /** Two-tier population (P1): the STATISTICAL tier — per-settlement age-band
   *  cohorts of souls beyond the named residents, keyed by poiId. Seeded at
   *  worldgen (`seedStatisticalCohorts`), captured in the snapshot, read by the
   *  belief economy (SpiritSystem/believer counts/rival situation/perception/
   *  growth + birth throttle). Mutated ONLY through `@/sim/cohorts` transfer
   *  fns (P1 has no flows — CohortSystem audits the counts stay constant).
   *  The NAMED tier lives in World entities; a soul is never in both. Empty
   *  until a world is seeded (old saves restore empty — no statistical tier). */
  cohorts: Map<string, SettlementCohorts>;
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
    selectedCausalSiteId: null,
    visualMap: null,
    blobMap: null,
    debug: false,
    showLabels: true,
    showPoiMarkers: true,
    pinnedNpcId: null,
    followNpc: false,
    cameraFly: null,
    spirits,
    eventLog,
    clock,
    cameraLock: { mode: 'free' },
    rng,
    world: null,
    terrainFields: null,
    biomeMap: null,
    generatedDecorations: [],
    systemState: new SystemStateRegistry(),
    plotThreads: new PlotThreadStore(),
    staging: new StagingBuffer(),
    surfacedInbox: new Set<string>(),
    waterLevelM: 0,
    weather: null,
    floodWatch: null,
    causalSites: null,
    trample: null,
    cohorts: new Map(),
  };
}
