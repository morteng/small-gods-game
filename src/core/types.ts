import type { BlobTile } from '@/map/blob-autotiler';
import type { World } from '@/world/world';
import type { SpiritId } from '@/core/spirit';
import type { Era } from '@/core/era';
import type { SpritePack, BarrierPiece } from '@/render/iso/sprite-canvas';
import type { LightingState } from '@/render/lighting-state';
import type { IslandSpec } from '@/terrain/island-mask';
import type { ClimateName, ClimateSpec } from '@/terrain/climate';
import type { WorldStyle, WorldStyleConfig } from '@/core/world-style';
import type { NpcAnimation } from '@/core/npc-animation';

export type { Era } from '@/core/era';

export type TileState = 'void' | 'realizing' | 'realized';

/** A single tile in the map grid */
export interface Tile {
  type: string;
  x: number;
  y: number;
  walkable: boolean;
  /** Reality state. 'realizing' is reserved for Spec D animation + Oracle override window; Spec A never produces it. */
  state: TileState;
  realizedAt?: number;
  height?: number;
  bridgeDirection?: string;
  /** Original biome tile type, preserved when a road/bridge overwrites `type`.
   *  Lets the colour field paint the ground *under* a road so the road's albedo
   *  comes purely from the shader surface channel — an overgrown road then fades
   *  back to this biome instead of a flat road-brown. Set once, at carve time. */
  baseType?: string;
  /** True when a farm_field tile is reached by an irrigation ditch (G7) — a queryable
   *  fertility signal (watered vs rain-fed), set deterministically at worldgen. */
  irrigated?: boolean;
}

// TODO(building-cleanup): remove BuildingInstance + GameMap.buildings legacy mirror once nothing reads it.
/** A placed building on the map */
export interface BuildingInstance {
  id: string;
  templateId: string;
  tileX: number;         // top-left corner of footprint
  tileY: number;
  poiId?: string;        // owning POI
  state: 'intact' | 'damaged' | 'ruined' | 'construction';
}

/** Generated map data */
export interface GameMap {
  tiles: Tile[][];
  width: number;
  height: number;
  villages: Village[];
  seed: number;
  success: boolean;
  worldSeed: WorldSeed | null;
  stats: {
    iterations: number;
    backtracks: number;
    /** Gate-stitch REPAIRS that actually carved during gen (interior-gate stitch / orphan-gate
     *  spur). Gates are committed portal nodes with commit-time half-edge repair, so on a healthy
     *  seed this is EMPTY — a nonzero entry means the by-construction wiring missed and wants a
     *  look (`scripts/stitch-sweep.ts` sweeps seeds and fails on any firing). */
    gateStitches?: { phase: 'interior' | 'orphan'; runId: string; x: number; y: number; carved: number }[];
  };
  buildings: BuildingInstance[];
  /** Monotonic revision of runtime in-place tile mutations (trample trails,
   *  settlement-growth stamping, perception realize, dev brush). Renderer
   *  color memos fold it into their key — every post-gen `tile.type` write
   *  must go through / be followed by `bumpTilesRev` (core/tile-rev.ts) or
   *  the GPU keeps painting the old ground until reload. */
  tilesRev?: number;
  /** Settlement plans from worldgen (S2/S3): road graph, lots, wards. Live
   *  growth consumes free lots; persisted verbatim via SaveFile.map. */
  settlementPlans?: import('@/world/settlement-plan').SettlementPlan[];
  /** Inter-POI road graph (Roads Slice 0): polylines + bridges are the source of
   *  truth, tile carving is derived. Persisted verbatim via SaveFile.map. */
  roadGraph?: import('@/world/road-graph').RoadGraph;
  /** Barriers committed by worldgen (settlement rings + croft enclosures). Source of
   *  truth for the terrain FOUNDATION carve (`buildBarrierDeformations`), which can't
   *  re-derive them (placement consumes live RNG/occupancy). Persisted verbatim via
   *  SaveFile.map; the World entities are re-indexed from these on load. */
  barrierRuns?: import('@/world/barrier').PlacedBarrier[];
  /** Earthworks committed by a placed defended complex (motte/ditch/rampart). Source of
   *  truth for the terrain CARVE (`buildEarthworkDeformations`) the same way barrierRuns
   *  feeds the foundation footing — derived from the connectome siting step, not
   *  re-derivable from tiles. Worldgen leaves this empty (only complex placement / the
   *  Site studio sets it), so the live world stays byte-identical. Persisted via SaveFile.map. */
  earthworks?: import('@/blueprint/connectome/earthworks').Earthwork[];
  /** Junction ARTIFACTS the world's builders committed: the typed objects that OWN each
   *  feature×feature overlap (Bridge over a crossing, Gatehouse/WaterGate at a barrier opening) —
   *  the world-compiler's first-class resolutions. Derived from committed state at gen time
   *  (`deriveBuiltJunctions`), consumed by the claims ledger as resolutions. Re-derivable from
   *  world+map; persisted for overlay/authoring + the (WP-D) compile phase. */
  junctions?: import('@/world/junction-artifacts').JunctionArtifact[];
  /** Derived anchor-snap layer: typed connection points on every feature + the matched
   *  links between them. Re-derivable from world+roadGraph; persisted for overlay/authoring. */
  anchors?: import('@/world/anchors').Anchor[];
  anchorLinks?: import('@/world/anchor-rules').AnchorLink[];
  /** Connectome CONTRACTS a recipe declared against this map (e.g. "this town gate must be
   *  reached by a road"). Pure data → rides `structuredClone(map)` in the save; evaluated by
   *  `evaluateContracts` (`@/world/connectome-contracts`) into a leveled report. */
  contracts?: import('@/world/connectome-contracts').ContractSet;
  /** Inspection ground: render a DEAD-FLAT heightfield (no seed noise → no peaks/
   *  snow/rock) so a studied subject sits on a clean plane. Studio-only; real game
   *  maps never set it, so the live terrain stays byte-identical. */
  flatHeight?: boolean;
  /** The seed `generateWithNoise` fed the riparian scatter — the map DECLARING that the
   *  scatter ran and with what identity, so map-pure consumers (boulder settle pads,
   *  `buildBoulderPadDeformations`) can re-derive the exact entity set. Absent on maps
   *  that never ran the pass (test stubs, studio grounds) → no pads, by construction.
   *  Persisted via SaveFile.map like roadGraph. */
  riparianSeed?: number;
  /** Rock SETTLE PADS the generator committed: flat (x, y, sizeM) triples, one per rock
   *  big enough to dish the ground it rests in (`world/rock-deformation.ts`). Unlike the
   *  riparian scatter, the biome-brush scatter is NOT re-derivable from the map (it was
   *  gated by biome-region bboxes and ran on the pre-road tile grid), so the map declares
   *  the pads THEMSELVES — the same "maps declare derived-entity identity" contract as
   *  `riparianSeed`, taken to its exact form. Source of truth for the pad carve; persisted
   *  verbatim via SaveFile.map. */
  rockPads?: number[];
}

/** Village/settlement on the map */
export interface Village {
  x: number;
  y: number;
  name?: string;
  type: string;
  /** Named districts from the settlement plan (S2) — promptable by name. */
  wards?: { name: string; type: string }[];
}

/** Point of Interest */
export interface POI {
  id: string;
  type: string;
  name?: string;
  description?: string;
  position?: { x: number; y: number };
  region?: { x_min: number; x_max: number; y_min: number; y_max: number };
  size?: 'small' | 'medium' | 'large' | 'huge';
  importance?: 'low' | 'medium' | 'high' | 'critical';
  npcs?: NPC[];
  /** Overrides the world era for this settlement's buildings. */
  era?: Era;
  /**
   * TERRAIN ANCHOR for coastal/terrain-conditional features (e.g. `cliffs`). A
   * fixed `position` can't track a seed-varied coastline — it lands inland. With a
   * `coast` direction the feature is RESOLVED to the real shoreline at gen time:
   * worldgen walks from the nominal point toward that edge and stamps the feature on
   * the land cell that meets the sea. `'nearest'` snaps to the closest shore.
   */
  coast?: 'east' | 'west' | 'north' | 'south' | 'nearest';
  /**
   * Author-facing summit height in METRES above sea, for peak types
   * (mountain/volcano/glacier). Overrides the type's built-in summit outright;
   * absent → the type default (optionally grown by `size` via summitSizeBoost).
   */
  summitM?: number;
}

/** NPC definition */
export interface NPC {
  name: string;
  role: string;
  description?: string;
  personality?: string;
  knowledge?: string[];
}

/** Connection between POIs */
export interface Connection {
  from: string;
  to: string;
  type: 'road' | 'river' | 'wall';
  style?: 'dirt' | 'stone' | 'bridge';
  waypoints?: { x: number; y: number }[];
  width?: number;
  autoBridge?: boolean;
}

/** World seed -- full world definition */
export interface WorldSeed {
  name: string;
  description?: string;
  size: { width: number; height: number };
  biome: string;
  visualTheme?: string;
  /** Default era for every settlement; per-POI `era` overrides it. Defaults to 'medieval'. */
  era?: Era;
  pois: POI[];
  connections: Connection[];
  constraints: string[];
  tileWeights?: Record<string, number>;
  lore?: { history?: string; factions?: string[]; quests?: string[] };
  roadEndpoints?: { direction: string; style?: string }[];
  /**
   * W1: sink the map edges to ocean (the world is an island). `true` uses the
   * default island shape; pass an {@link IslandSpec} to customise the coastline.
   */
  island?: boolean | IslandSpec;
  /**
   * "Tone & Scale" meta-config: high-level Scale (game factor) + Rating presets
   * plus per-knob overrides, resolved to a flat {@link WorldStyle} by
   * `worldStyleOf` (see `src/core/world-style.ts`). Absent → neutral defaults.
   */
  style?: WorldStyleConfig;
  /**
   * Climate zone — where the temperature/moisture band sits (north cold → south
   * warm). A {@link ClimateName} preset (`'european'` default) or a partial
   * {@link ClimateSpec} override. Local cold/heat is the POI layer's job
   * (glacier/mountain/volcano deltas), independent of this global backdrop.
   * Resolved by `styledClimate` (see `src/terrain/climate.ts`).
   */
  climate?: ClimateName | Partial<ClimateSpec>;
  /**
   * Authored terrain SHAPE laid over the procedural noise — a deliberate landform
   * (a river vale, a knoll, a flat plain) for studying a connectome subset against
   * the terrain features it interacts with. Absent → pure procedural terrain.
   * Resolved by `styledShapeSpec` (see `src/terrain/terrain-shape.ts`).
   */
  terrainShape?: import('@/terrain/terrain-shape').TerrainShapeSpec;
}

/** Camera state for pan/zoom */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
  dragging: boolean;
  lastX: number;
  lastY: number;
}

/** Tile definition from WFC system */
export interface TileDef {
  id: string;
  weight?: number;
  walkable: boolean;
  color: string;
  segColor?: string;
  category: string;
  baseType?: string;
  tree?: boolean;
}

/** Terrain generation options */
export interface TerrainOptions {
  forestDensity: number;
  waterLevel: number;
  villageCount: number;
}

/** NPC role in the world */
export type NpcRole = 'farmer' | 'priest' | 'soldier' | 'merchant' | 'elder' | 'child' | 'noble' | 'beggar';

/** Direction an NPC is facing */
export type Direction = 'up' | 'down' | 'left' | 'right';

/** Context passed to renderMap */
export interface RenderContext {
  map: GameMap;
  camera: Camera;
  canvasWidth: number;
  canvasHeight: number;
  npcs: NpcInstance[];
  npcSheets: Map<string, HTMLCanvasElement>;
  visualMap: string[][] | null;
  blobMap: BlobTile[][] | null;
  tileAtlas: HTMLImageElement | null;
  terrainSheets: Map<string, HTMLImageElement>;
  buildingSprites: Map<string, HTMLImageElement>;
  world: World;
  showLabels?: boolean;
  showPoiMarkers?: boolean;
  /** Player-placed decorations to render, y-sorted with other entities. */
  generatedDecorations?: GeneratedDecoration[];
  /** Resolves an asset id to its cached `<img>`; null until the image
   *  finishes loading (renderer falls back to a placeholder square). */
  resolveDecorationImage?: (assetId: string) => HTMLImageElement | null;
  /** Resolves an entity to its cached art `<img>` (base library or live), or
   *  null while loading / on no match (renderer keeps its procedural fallback). */
  resolveEntityArt?: (entity: Entity) => HTMLImageElement | null;
  /** Render-only: building entity → generated sprite image, or null to fall back to parametric massing. */
  resolveBuildingArt?: (entity: Entity) => HTMLImageElement | null;
  /** A runtime-generated parametric building sprite pack (manifold), or null. */
  resolveParametricBuildingArt?: (entity: Entity) => SpritePack | null;
  /** A barrier run's composed-and-lit chunk pieces (manifold), or null until warm — the
   *  parametric replacement for the flat-quad `barrierSlabs`. Each piece y-sorts independently. */
  resolveParametricBarrierArt?: (entity: Entity) => BarrierPiece[] | null;
  /** Monotonic revision of the parametric building source (bumped as async massing
   *  packs settle). Folded into the static draw-cache key so the building layer
   *  rebuilds once packs are ready instead of freezing flatblock fallbacks. */
  buildingArtRev?: number;
  /** An img2img-generated building sprite pack, or null (falls back to parametric). */
  resolveGeneratedBuildingArt?: (entity: Entity) => SpritePack | null;
  /** Interior I-2 focus reveal: the entity id of the building drawn CUTAWAY (roof off,
   *  floor exposed), or null/absent for none. Folded into the static draw-cache key so
   *  the building layer rebuilds when the focused building changes. */
  cutawayBuildingId?: string | null;
  /** A runtime-generated parametric TREE sprite pack, keyed by species kind (not
   *  entity — trees are many and carry no blueprint) plus a per-instance `variant`
   *  bucket (0-based; several seeded silhouettes per species), or null to fall back
   *  to the flat billboard. A not-yet-composed variant degrades to variant 0. */
  resolveParametricPlantArt?: (kind: string, variant?: number) => SpritePack | null;
  /** Global lighting for the WebGL entity layer (PBR Slice 3); absent = unlit. */
  lighting?: LightingState;
  /** Dev mode state — when present and enabled, renderer draws highlights. */
  devMode?: DevModeState;
  /** Debug overlay options (extracted from devMode for convenience). */
  debugOverlays?: DebugOverlayOptions;
  /** Inland water-level offset in METRES (drought < 0, flood > 0) — shifts the
   *  river + lake water surfaces; the sea is the fixed datum. Default 0. */
  waterLevelM?: number;
  /** LOCALIZED per-lake-body level offset in METRES (climate W-B: rain fills one
   *  basin) — indexed by lake body (`getLakeBodies`). Baked into the lake surface
   *  per cell, so different lakes rise/recede independently. Default: none. */
  lakeOffsetM?: Float32Array;
  /** Per-CELL standing-water depth in METRES (W-E: "flood a plain") — lays water on
   *  arbitrary land, baked into the water surface + type. Default: none. */
  floodOffsetM?: Float32Array;
  /** OPT-IN connectome-projected water (studio editing): an author-placed/moved lake
   *  the hydrology raster never knew. When present, the render water type + surface
   *  include these lakes so they paint as real still water through the SAME path as
   *  generated lakes. The game leaves this unset → the pure raster path, byte-identical.
   *  See `ConnectomeWaterOverride`. Default: none. */
  connectomeWater?: ConnectomeWaterOverride;
  /** OPT-IN analytic river-channel geometry from the LIVE (studio-edited) water network,
   *  so a dragged node re-projects the smooth signed-distance river silhouette instantly.
   *  The game leaves this unset → the memoised per-(seed,dims) channel. Type-only import
   *  (erased), so no runtime coupling to the render layer. */
  riverChannel?: import('@/render/gpu/river-channel-geometry').RiverChannelGeometry;
}

/** DIR-A: a placed/edited connectome lake projected into render space — fed to the
 *  terrain colour + water-surface builds so it renders like a generated lake. `version`
 *  bumps on each connectome edit so the (otherwise map-memoised) render caches rebuild. */
export interface ConnectomeWaterOverride {
  /** Full RENDER waterType (ocean + connectome rivers + lakes incl. placed), `W*H`. */
  waterType: Uint8Array;
  /** Render-elevation water surface for PLACED-lake cells (the spill lip); cells that
   *  are not a placed lake are ignored (their surface comes from the raster path). */
  lakeSurface: Float32Array;
  /** Edit counter — busts the colour + water-static caches when the connectome changes. */
  version: number;
}

/** Options for debug visualization overlays */
export interface DebugOverlayOptions {
  showBeliefHeatmap: boolean;
  showNeeds: boolean;
  showMood: boolean;
  showSocialConnections: boolean;
  beliefThreshold: number;
  selectedSpiritId: string | null;
}

/** Render-only adapter shape (built via toRenderNpc in npc-helpers.ts). Not stored anywhere persistent. */
export interface NpcInstance {
  id: string;
  name: string;
  role: NpcRole;
  seed: number;       // deterministic appearance seed, derived from id
  tileX: number;
  tileY: number;
  direction: Direction;
  frame: number;      // column within the current animation's cycle (walk: 0=idle, 1–8)
  frameTimer: number; // ms accumulator since last frame advance
  /** LPC animation row to sample. Omitted/undefined renders as 'walk'. */
  animation?: NpcAnimation;
  homeBuildingId?: string;
  homePoiId?: string;
  // Random-walk movement scaffolding (placeholder until proper schedules land).
  // moveCooldown counts down in ms; on reach 0 the NPC picks a new step.
  moveCooldown?: number;
}

export interface Relationship {
  npcId: string;
  type: 'family' | 'friend' | 'rival' | 'lover' | 'mentor';
  trust: number;  // 0–1
}

export interface NpcPersonality {
  assertiveness: number;  // 0–1: how strongly they share beliefs (Phase 8+ propagation)
  skepticism:    number;  // 0–1: resistance to faith change
  piety:         number;  // 0–1: baseline religious tendency
  sociability:   number;  // 0–1: social pressure weight (reserved for propagation)
}

export interface SpiritBelief {
  faith:         number;  // 0–1: raw belief strength
  understanding: number;  // 0–1: depth of comprehension (quality multiplier)
  devotion:      number;  // 0–1: behavioral commitment
}

/** A *kind of power* believers can attribute to a spirit — the content of belief,
 *  not its strength. Each domain is backed by a real coded capability (no button
 *  without an effect; see `src/sim/belief-domains.ts`). Bounded enum: Fate may
 *  name/flavour a domain but cannot invent an effect outside this set. */
export type BeliefDomain =
  | 'storm'   // storm & lightning → the `smite` capability.
  | 'flood';  // tempests & deluge → the `summon_storm` capability (W-H).

export interface NpcNeeds {
  safety:     number;  // 0–1 (higher = more satisfied)
  prosperity: number;
  community:  number;
  meaning:    number;
}

// ─── Terrain system (Phase I) ─────────────────────────────────────────────────

export interface TerrainConfig {
  seed: number;
  width: number;
  height: number;
  elevationScale?: number;   // default 0.02
  moistureScale?: number;    // default 0.03
  seaLevel?: number;         // default 0.35
  poleFalloff?: boolean;     // temperature drops at poles
  continentWarp?: number;    // domain warp strength (0 = off)
  /** W1 island mask: sinks the map edges to ocean. Off when undefined. */
  island?: IslandSpec;
  /** Resolved climate gradient. Defaults to `european` when undefined. */
  climate?: ClimateSpec;
  /** Authored terrain shape laid over the noise (studio scenarios). Off when undefined. */
  shape?: import('@/terrain/terrain-shape').TerrainShapeSpec;
  /** Total relief (metres) for the elevation 0→1 span — `worldStyleOf().mountainRelief`.
   *  Lets biome classification gate snow/rock on ABSOLUTE height, not a fraction.
   *  Defaults to 48 (TERRAIN_RELIEF_M) when undefined. */
  reliefM?: number;
}

export interface TerrainField {
  elevation: Float32Array;   // [width * height], range [0, 1]
  moisture: Float32Array;
  temperature: Float32Array;
}

export interface BiomeMap {
  biomes: string[];          // Biome enum values, length = width * height
  width: number;
  height: number;
}

/**
 * Output of the drainage-basin hydrology pass.
 * `riverMask[i] === 1` means cell i should become a river tile.
 * `flowField[i]` is the accumulated flow count (number of paths that visited cell i).
 */
/** Water classification per cell (see `WaterType`). */
export enum WaterType {
  Dry = 0,
  Ocean = 1, // below sea level and connected to the map border
  Lake = 2,  // standing fill (closed basin) or enclosed below-sea depression
  River = 3, // drainage accumulation ≥ threshold (stream = River with strahler 1)
}

export interface HydrologyResult {
  riverMask: Uint8Array;   // [width * height], 0 or 1
  flowField: Float32Array; // [width * height], ≥ 0 (accumulation)
  // ── Water S0 additions (derived; see water-s0 spec). All length width*height. ──
  drainTo: Int32Array;     // downstream neighbour index, −1 at outlets/ocean/sentinel
  surfaceW: Float32Array;  // water-surface height (normalized elev units); −1 on dry land
  waterMask: Uint8Array;   // 0=dry, 1=wet — unified ocean ∪ lake ∪ river
  waterType: Uint8Array;   // WaterType enum per cell
  flowDirX: Float32Array;  // unit flow vector x at river cells; 0 in still/dry water
  flowDirY: Float32Array;  // unit flow vector y at river cells; 0 in still/dry water
  strahler: Uint8Array;    // Strahler order along the drainage tree; 0 off-channel
  width: Float32Array;     // channel width in cells (from strahler); 0 off-channel
}

// ─── Entity system (Phase II) — legacy type aliases ──────────────────────────
// These kept for code that still imports them. WorldEntity is now an alias for
// Entity; the old fields (category, type, tileX, tileY, etc.) are gone — they
// live in Entity.properties and Entity.x/y respectively.

export type ReligiousSignificance = 'sacred' | 'profane' | 'neutral' | 'contested';

/** Legacy shape consumed by render-overlay/info-panel helpers; built via simStateFromEntity. Not stored. */
export interface NpcSimState {
  npcId:           string;
  name:            string;
  role:            NpcRole;
  personality:     NpcPersonality;
  beliefs:         Record<string, SpiritBelief>;  // key = spirit id, e.g. 'player'
  needs:           NpcNeeds;
  mood:            number;  // 0–1, derived from needs each tick
  recentEvents:    string[];   // ring buffer, max 5
  whisperCooldown: number;     // integer seconds remaining (ticked per sim tick)
  relationships:  Relationship[];
  homeBuildingId?: string;
  homePoiId?:      string;
  activity:        NpcActivity;
}

/** What kind of interaction produced a memory. */
export type MemoryKind = 'whisper' | 'backfill' | 'dream' | 'miracle' | 'answer';

/** A distilled, salience-tagged episodic memory of one interaction with a god.
 *  Stored on NpcProperties; rides the snapshot (structuredClone) + SaveFile. */
export interface MemoryEntry {
  /** Sim tick when it happened. */
  tick: number;
  kind: MemoryKind;
  /** One-line distilled summary (from interaction-memory.distillInteraction / summarizeDivineAct). */
  summary: string;
  /** 0..1, deterministic — high-salience landmarks survive eviction. */
  salience: number;
}

/** Properties stored on an Entity with kind: 'npc'. Replaces NpcInstance + NpcSimState. */
export interface NpcProperties {
  // identity
  name: string;
  role: NpcRole;
  seed: number;
  // lineage & mortality
  /** Sim tick at which this soul was born. Age is DERIVED, never stored-mutated. */
  birthTick: number;
  /** 0 (founder), 1, or 2 parent entity ids. */
  parentIds: NpcId[];
  /** Root-ancestor id for "house of X" grouping. Founders: their own id. */
  lineageId: NpcId;
  /** Set only on a converted `remains` entity. Sim tick of death. */
  deathTick?: number;
  /** Set only on a converted `remains` entity. e.g. 'old_age'. */
  deathCause?: string;
  /** Fate-narrative archetype this stranger was injected as (Track 4 inject_npc). */
  fateRole?: string;
  // movement / animation
  direction: Direction;
  frame: number;
  frameTimer: number;
  /** LPC animation row currently playing. Omitted/undefined → 'walk'. */
  animation?: NpcAnimation;
  /** Dev override (`__debug.playAnim`): pins the animation, bypassing the sim. */
  animForce?: NpcAnimation;
  moveCooldown?: number;
  // pathfinding / smooth movement
  /** Ordered tile positions to walk through. First entry is the NPC's immediate destination. */
  currentPath?: { x: number; y: number }[];
  /** Index into currentPath; 0 means currentPath[0] is the next tile. -1 means no path loaded. */
  pathIndex?: number;
  /** Speed multiplier (1.0 = default, >1 = fast, <1 = slow). */
  pathSpeedMul?: number;
  // home
  homeBuildingId?: string;
  homePoiId?: string;
  // home coords (spawn position, used for sleep/work targets)
  homeX: number;
  homeY: number;
  // sim
  personality: NpcPersonality;
  beliefs: Record<SpiritId, SpiritBelief>;
  /** Belief *content* (Track-B): what this NPC thinks a spirit can DO, per domain
   *  (storm, fire, …), 0–1. Sparse — most NPCs hold 0–2 domain beliefs. Keyed by
   *  spirit id, then domain. Optional → old saves/snapshots read as no content. */
  domains?: Record<SpiritId, Partial<Record<BeliefDomain, number>>>;
  needs: NpcNeeds;
  mood: number;
  whisperCooldown: number;
  // activity state machine
  activity: NpcActivity;
  /** Tile the NPC is trying to reach. May be home or a place of work/worship. */
  activityTargetX?: number;
  activityTargetY?: number;
  /** Ticks remaining for the current activity before the next activity tick re-evaluates. */
  activityDuration: number;
  /** Sim tick at which the NPC's *current* unanswered plea began (Track-3 rival
   *  claims). Set when a `worship` state is first observed and cleared the moment
   *  the plea lifts, so `now - prayerSince` is the prayer's age. Optional → old
   *  saves/snapshots read as "no standing plea"; rides the snapshot on properties. */
  prayerSince?: number;
  // social graph
  relationships: Relationship[];
  // possession marker
  possessedBy?: SpiritId;
  // narrative breadcrumbs
  recentEventIds: number[];
  /** Distilled, salience-tagged episodic memory of interactions with gods (Track 2).
   *  Optional → old saves/snapshots without it read as []. */
  memories?: MemoryEntry[];
}

/** NPC activity state */
export type NpcActivity =
  | 'sleep'
  | 'work'
  | 'socialize'
  | 'worship'
  | 'idle'
  | 'wander';

/** Settlement-level event types (Sprint 4). */
export type SettlementEventType =
  | 'drought'
  | 'festival'
  | 'dispute'
  | 'plague'
  | 'raiders'
  | 'trading_caravan'
  | 'stranger_arrives'
  | 'harvest_blessing';

/** An active settlement event affecting all NPCs in a POI. */
export interface ActiveEvent {
  type: SettlementEventType;
  poiId: string;
  severity: number;   // 0–1, fraction of max effect
  durationTicks: number;  // total lifespan in ticks
  ticksElapsed: number;
}

// ─── Entity system v2 (Spec A) ────────────────────────────────────────────────

export type EntityId = string;

/** An entity id known to refer to an NPC (or its remains). */
export type NpcId = EntityId;

/** Spec-A Entity: every visible world object collapses into this shape. */
export interface Entity {
  id: EntityId;
  kind: string;
  x: number;                                  // tile coords, sub-tile allowed
  y: number;
  properties?: Record<string, unknown>;
  tags?: ReadonlyArray<string>;
}

/** Backwards-compat alias — all consumers should migrate to Entity. */
export type WorldEntity = Entity;

export interface Region {
  x: number;       // top-left tile x
  y: number;       // top-left tile y
  w: number;       // width in tiles
  h: number;
}

export interface SpriteRef {
  atlas?: string;                            // atlas key e.g. 'lpc-terrain'
  region?: { sx: number; sy: number; sw: number; sh: number };
  fallbackColor?: string;                    // e.g. '#7ab06e'
  fallbackShape?: 'circle' | 'square' | 'triangle';
}

/** Read-only view of the World, passed to brushes. */
export interface WorldReadOnly {
  query(opts: {
    region?: Region;
    kind?: string;
    tag?: string;
    limit?: number;
  }): Entity[];
  tileAt(x: number, y: number): Tile | undefined;
}

export interface BrushContext {
  world: WorldReadOnly;
  tiles: GameMap;
  /**
   * Resolved world style (Tone & Scale) for the map being painted — the seam
   * through which style knobs (e.g. `floraDensity`) reach brushes. Populated by
   * `World.applyBrush` from `tiles.worldSeed.style`; absent (direct brush calls,
   * legacy contexts) means neutral defaults — consumers fall back per-knob.
   */
  style?: WorldStyle;
}

// ─── PixelLab integration (user-supplied API key) ─────────────────────────────

export type PixelLabOutline =
  | 'single color black outline'
  | 'single color outline'
  | 'selective outline'
  | 'lineless';

export type PixelLabShading =
  | 'flat shading'
  | 'basic shading'
  | 'medium shading'
  | 'detailed shading'
  | 'highly detailed shading';

export type PixelLabDetail = 'low detail' | 'medium detail' | 'highly detailed';

/** Camera view enum (create-image-pixflux `view`). */
export type PixelLabView = 'side' | 'low top-down' | 'high top-down';

/** Object facing (create-image-pixflux `direction`). */
export type PixelLabDirection =
  | 'north' | 'north-east' | 'east' | 'south-east'
  | 'south' | 'south-west' | 'west' | 'north-west';

// ─── Asset library metadata ───────────────────────────────────────────────────

export type AssetKind =
  | 'decoration'
  | 'building'
  | 'npc-portrait'
  | 'npc-sprite'
  | 'icon'
  | 'terrain-stamp'
  | 'unknown';

export type CurationStatus = 'pending' | 'kept' | 'rejected';

export type AssetOrigin = 'sandbox' | 'official' | 'imported';

export type AssetStyle = 'pixel-art' | 'painterly' | 'unknown';
export type AssetProvider = 'pixellab' | 'replicate' | 'fal' | 'mock';

/** Soft selection hints — overlap raises an asset's match score, never required. */
export interface AssetAffinity {
  biome?: string[];
  era?: string[];
}

/** Options for a single PixelLab generation call. The client bakes in the
 *  project style recipe (color_image, outline, shading, detail) on top. */
export interface PixelLabGenerateOpts {
  prompt: string;
  width: number;
  height: number;
  /** Negative prompt — what to avoid (create-image-pixflux `negative_description`). */
  negativeDescription?: string;
  /** Overrides for the baked-in style recipe (rarely used). */
  outline?: PixelLabOutline;
  shading?: PixelLabShading;
  detail?: PixelLabDetail;
  /** True → isometric projection flag (not just a text hint). */
  isometric?: boolean;
  /** Camera view enum. */
  view?: PixelLabView;
  /** Object facing enum. */
  direction?: PixelLabDirection;
  /** Prompt-adherence weight (1–20, default 8). Higher = follow description more. */
  textGuidanceScale?: number;
  /** Deterministic seed for reproducibility. */
  seed?: number;

  /** Base64 PNG guidance image for img2img (rendered massing or placement scaffold). */
  initImage?: string;
  /** img2img strength (1–999); only applied when initImage is present. */
  initImageStrength?: number;
  /** Hex colours that MUST appear; synthesized into a per-call color_image. */
  paletteAnchors?: string[];
  /** View-recipe version; folded into the cache key (defaults to RECIPE_V). */
  recipeVersion?: string;

  // Library metadata. Required logically for 'official' origin (callers should
  // supply them); for 'sandbox' (default) they may be omitted and will default.
  kind?: AssetKind;
  tags?: string[];
  description?: string;
  origin?: AssetOrigin;
  /** Style tag for the generated asset (defaults to 'pixel-art'). */
  style?: AssetStyle;
  /** Soft selection hints stored with the asset. */
  affinity?: AssetAffinity;
}

export interface PixelLabBalance {
  /** Remaining free-tier monthly generations. */
  generationsRemaining: number;
  generationsTotal: number;
  /** Pay-as-you-go credits in USD (0 on pure free tier). */
  creditsUsd: number;
}

/** A single asset in the library (also the cache record). */
export interface LibraryAsset {
  /** SHA-256 hex of the canonical call shape. Primary key. */
  key: string;
  schemaVersion: 3;

  blob: Blob;
  prompt: string;
  width: number;
  height: number;
  generatedAt: number;

  curated: CurationStatus;
  origin: AssetOrigin;

  kind: AssetKind;
  tags: string[];
  description?: string;

  // v3 metadata
  provider: AssetProvider;
  model: string;
  style: AssetStyle;
  recipeVersion: string;
  affinity?: AssetAffinity;
}

/** Structured library query — designed for the future LLM agent's tool call. */
export interface AssetQuery {
  kind: AssetKind;
  /** OR-match: result must contain at least one of these tags. */
  tagsAny?: string[];
  /** AND-match: result must contain all of these tags. */
  tagsAll?: string[];
  /** Exact-match dimensions. */
  size?: { w: number; h: number };
  /** Exact style match (e.g. only 'pixel-art'). */
  style?: AssetStyle;
  /** Exact model match — "only assets from this model". */
  model?: string;
  /** Exact provider match. */
  provider?: AssetProvider;
  /** OR-match biome affinity. */
  biomeAny?: string[];
  /** OR-match era affinity. */
  eraAny?: string[];
  /** Default 16. */
  limit?: number;
}

/** Metadata-only summary returned by `findAssets`. Callers fetch the blob
 *  separately via `getAssetBlob(id)`. */
export interface AssetSummary {
  id: string;
  kind: AssetKind;
  tags: string[];
  prompt: string;
  description?: string;
  width: number;
  height: number;
  /** When this asset entered the library (epoch ms). Equals `LibraryAsset.generatedAt`
   *  for entries created via `generate()`; will differ for future imported entries. */
  addedAt: number;
  style: AssetStyle;
  model: string;
  provider: AssetProvider;
  affinity?: AssetAffinity;
}

export type PixelLabKeyStatus = 'missing' | 'unverified' | 'valid' | 'invalid';

// ─── Player-placed decorations ────────────────────────────────────────────────

/** A decoration the player placed via right-click. References a LibraryAsset
 *  by its content-hash id (= LibraryAsset.key). Persisted per world seed. */
export interface GeneratedDecoration {
  tileX: number;
  tileY: number;
  assetId: string;
}

// ─── Dev Mode & World Inspector (Phase 1+) ────────────────────────────────────

/** Result of a hit-test against the world at a screen position. */
export interface HitResult {
  type: 'tile' | 'entity' | 'npc' | 'decoration' | null;
  tileX: number;
  tileY: number;
  tile?: Tile;
  entity?: Entity;
  npc?: NpcInstance;
  decoration?: GeneratedDecoration;
}

/** Dev mode undo/redo action. */
export interface UndoAction {
  type: 'entity_update' | 'tile_update' | 'entity_delete' | 'entity_create';
  target: { tileX: number; tileY: number; entityId?: string };
  before: unknown;
  after: unknown;
}

export type BuildingRenderMode = 'auto' | 'fallback';

/** Developer mode state exposed on GameState. */
export interface DevModeState {
  enabled: boolean;
  selected: HitResult | null;
  clipboard: Entity | null;
  undoStack: UndoAction[];
  redoStack: UndoAction[];
  activeTool: 'select' | 'paint' | 'erase' | 'place';
  brushType?: string;
  showGrid?: boolean;
  showCoords?: boolean;
  // Debug visualization overlays
  showBeliefHeatmap?: boolean;
  showNeeds?: boolean;
  showMood?: boolean;
  showSocialConnections?: boolean;
  beliefThreshold?: number;
  selectedSpiritId?: string | null;
  // Map info layers (rendering-only overlays)
  showPoiLayer?: boolean;
  showBiomeLayer?: boolean;
  // Building render mode (dev). 'auto' = generated asset → parametric fallback →
  // flat block; 'fallback' = always the parametric fallback (skip assets). Default 'auto'.
  buildingRenderMode?: BuildingRenderMode;
  // Entity lighting (dev). 'banded' = ambient + banded directional sun over the
  // sprite packs' normal/AO maps; 'off' = unlit. Default 'banded'.
  lighting?: 'banded' | 'off';
  // Render layer toggles — each base scene category is shown unless its flag is
  // explicitly false (default: shown). See src/render/layer-visibility.ts.
  showTerrain?: boolean;
  showNpcs?: boolean;
  showBuildings?: boolean;
  showVegetation?: boolean;
  showProps?: boolean;
  showTerrainFeatures?: boolean;
  showDecorations?: boolean;
  showRemains?: boolean;
  // Terrain sub-layers (tile-type based; gated inside the terrain pass).
  showRoads?: boolean;
  showRivers?: boolean;
  // Sea & lake water surface (the buildWaterField pass + its ocean backdrop). Off
  // reveals the bathymetry / lake & sea beds. River ribbons are separate (showRivers).
  showWater?: boolean;
  // Terrain display mode enum (0 = textured … 6 = wireframe). See TERRAIN_MODES in
  // src/render/gpu/terrain-field.ts; threaded into the terrain shader uniform.
  terrainMode?: number;
  // Terrain mesh supersample (≥1; 1 = one quad/tile). Subdivides the GPU-generated
  // terrain grid for inspection (visible in the wireframe mode). Default 1.
  terrainSuper?: number;
  // Time debug
  showEventLog?: boolean;
  showSimState?: boolean;
}

// ─── Extend RenderContext with devMode ────────────────────────────────────────
// (Done inline to avoid circular dependency — see renderContext definition above)
// The RenderContext interface should have devMode?: DevModeState added to it.
