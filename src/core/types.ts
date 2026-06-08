import type { BlobTile } from '@/map/blob-autotiler';
import type { World } from '@/world/world';
import type { SpiritId } from '@/core/spirit';
import type { Era } from '@/core/era';

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
}

// TODO(building-descriptor-cleanup): remove BuildingInstance + GameMap.buildings legacy mirror once nothing reads it.
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
  stats: { iterations: number; backtracks: number };
  buildings: BuildingInstance[];
}

/** Village/settlement on the map */
export interface Village {
  x: number;
  y: number;
  name?: string;
  type: string;
}

/** Point of Interest */
export interface POI {
  id: string;
  type: string;
  name?: string;
  description?: string;
  position?: { x: number; y: number };
  region?: { x_min: number; x_max: number; y_min: number; y_max: number };
  size?: 'small' | 'medium' | 'large';
  importance?: 'low' | 'medium' | 'high' | 'critical';
  npcs?: NPC[];
  /** Overrides the world era for this settlement's buildings. */
  era?: Era;
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
  treeSheets: Map<string, HTMLImageElement>;
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
  /** A runtime-generated parametric building sprite (manifold), or null. */
  resolveParametricBuildingArt?: (entity: Entity) => CanvasImageSource | null;
  /** Dev mode state — when present and enabled, renderer draws highlights. */
  devMode?: DevModeState;
  /** Debug overlay options (extracted from devMode for convenience). */
  debugOverlays?: DebugOverlayOptions;
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
  frame: number;      // 0 = idle stand, 1–8 = walk cycle
  frameTimer: number; // ms accumulator since last frame advance
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
export interface HydrologyResult {
  riverMask: Uint8Array;   // [width * height], 0 or 1
  flowField: Float32Array; // [width * height], ≥ 0
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

export type BuildingRenderMode = 'auto' | 'generator' | 'massing';

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
  // Building render mode (dev). 'auto' = asset sprite where one exists, else massing
  // (today's behavior); 'generator' = runtime manifold parametric sprite, else massing;
  // 'massing' = always the legacy Canvas2D massing. Default 'auto'.
  buildingRenderMode?: BuildingRenderMode;
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
  // Time debug
  showEventLog?: boolean;
  showSimState?: boolean;
}

// ─── Extend RenderContext with devMode ────────────────────────────────────────
// (Done inline to avoid circular dependency — see renderContext definition above)
// The RenderContext interface should have devMode?: DevModeState added to it.
