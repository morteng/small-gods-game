# Small Gods - Technical Specification

**Version**: 2.1.0
**Status**: Active
**Last Updated**: 2026-05-29

---

## 1. Overview

Small Gods is a god game inspired by Terry Pratchett's *Small Gods*. The player takes the role of a minor deity — barely more than a whisper — who must cultivate genuine belief among LLM-driven NPCs in a procedurally generated world. Power comes from faith, not force: the player cannot command anyone, only influence through whispers, omens, dreams, and miracles. Rival spirits compete for the same mortal attention.

The world runs on a two-layer architecture:
- **Simulation layer** — every NPC has compact programmatic state (beliefs, needs, relationships, mood) that ticks cheaply and continuously
- **Narration layer** — when the player pays attention to anything, an LLM "backfills" rich dialogue, emotion, and drama from the sim state, so the world appears to have a deep narrative tapestry at all times

The map system uses Wave Function Collapse (WFC) for procedural terrain, a decoration system for environmental detail, and a simple top-down colored-rectangle renderer (isometric + AI rendering replaced in TS migration).

**Current Implementation Status:**
- ✅ Phase 7: NPC Simulation Layer - Complete (tick system, beliefs, needs, activities, events)
- ✅ Phase 8: Divine Action System - Complete (whisper, omen, dream, miracle, answer prayer)
- ⬜ Phase 9: LLM Integration - Not Started
- ⬜ Phase 10: Rival Spirit System - Not Started  
- ⬜ Phase 11: DM Agent - Not Started

### 1.1 Goals

- Simulate a living world of NPCs with beliefs, needs, and social relationships
- Let the player influence (never command) NPCs through divine actions
- Generate rich LLM-driven narrative on demand from compact sim state
- Compete against rival spirits with distinct personalities and strategies
- Generate infinite, coherent maps using WFC with chunked generation
- Render maps at multiple quality levels (base tiles, decorated, AI-rendered)

### 1.2 Out of Scope (Current Phase)

- Real-time multiplayer
- Mobile/touch support

---

## 2. Gameplay Systems

### 2.1 Core Loop

```
Player observes world → identifies opportunity (unmet need, crisis, receptive NPC)
  → spends belief-power on divine action (whisper, omen, miracle)
    → NPC state changes (faith++, mood shifts, events recorded)
      → NPC propagates belief to social connections (sim layer)
        → player's power grows from increased genuine belief
          → rival spirits react → cycle continues
```

### 2.2 NPC Simulation Layer (Programmatic)

**Status**: ✅ Complete (Phase 7)

Every NPC runs on compact state that ticks every game cycle without LLM calls.

**Per-NPC per-tick:**
1. Update needs from world state (drought → prosperity--, war → safety--)
2. Compute mood as composite of needs
3. Belief decay/growth:
   - Time decay based on skepticism (`src/sim/npc-sim.ts`)
   - Need-based faith boost when desperate (`src/sim/npc-sim.ts`)
   - Social propagation from relationships (`src/sim/systems/belief-propagation-system.ts`)
4. Activity state machine (sleeping/working/trading/praying/wandering)
   - Time-of-day schedule: sleep at night, work/day, worship if low meaning (`src/sim/systems/npc-activity-system.ts`)
5. Settlement events affect needs (`src/sim/systems/settlement-event-system.ts`)

**Per-settlement per-tick:**
1. Aggregate belief levels → spirit power calculation (`src/sim/spirit-system.ts`)
2. Roll for random events (8 types: drought, festival, dispute, plague, raiders, trading caravan, stranger arrives, harvest blessing)
3. Apply event effects to relevant NPCs (severity-scaled need modifiers)

### 2.3 Belief Propagation

Social contagion on the relationship graph:

```
For each NPC where assertiveness > threshold AND faith > threshold:
  For each relationship where trust > threshold:
    influence = faith × devotion × assertiveness × trust × (1 - target.skepticism)
    target.beliefs[spirit].faith += influence × propagation_rate
```

Boosted by: recent events (miracle), unmet needs (desperation), personality match.
A single zealous NPC with many trusted relationships can cascade belief through a village.
A vocal skeptic can erode faith the same way.

**Pratchett-faithful distinction:** genuine belief ≠ institutional obedience. One fervent believer who understands what the god *means* generates more power than a hundred who show up on holy days out of habit. The `understanding` stat captures this.

### 2.4 Divine Actions

**Status**: ✅ Complete (Phase 8)

| Action | Cost | Scope | Sim Effect | Implementation |
|--------|------|-------|------------|----------------|
| Whisper | 1 | 1 NPC | faith++, understanding++, sets cooldown | `src/sim/divine-actions.ts` |
| Omen | 3 | Area | faith+ for witnesses, severity boost to active events | `src/sim/divine-actions.ts` |
| Answer prayer | 2 | 1 NPC | faith++, understanding++, devotion++, need boost | `src/sim/divine-actions.ts` |
| Dream | 4 | 1 NPC | deep influence, personality drift, extends sleep | `src/sim/divine-actions.ts` |
| Miracle | 10 | Settlement | meets a need, massive faith boost | `src/sim/divine-actions.ts` |

**Power economy:**
```
power = Σ (faith × understanding × devotion) across all followers
```
- Regeneration: `POWER_REGEN_RATE = 0.02` applied each tick in `src/sim/spirit-system.ts`
- Actions drain power (checked before execution)
- Player must maintain positive flow — spend too much and you fade

### 2.5 Rival Spirits

Other spirits compete for mortal belief. They run on the sim layer with personality-weighted action selection:

- **Household spirits** — minor, cling to a single hearth, low threat
- **Nature spirits** — tied to rivers/groves, territorial
- **Other small gods** — direct competitors, hungry and ambitious
- **Established deities** — powerful, with organized religions and institutional inertia

Each rival has: `aggression`, `subtlety`, `territoriality` traits and a current strategy (`expand` / `defend` / `undermine` / `coexist`). Their actions are programmatic most of the time, but when they **directly intersect with the player** (competing for the same NPC, countering a miracle), that moment gets LLM treatment — the rival manifests through their most devoted follower.

### 2.6 Domain Emergence

The player doesn't choose "god of storms" at creation. Their domain emerges from play:

```
domain_tags: { "harvest": 0.6, "protection": 0.4, "storms": 0.1 }
```

Updated by: what prayers are answered, what miracles performed, how followers describe the god during proselytizing. Dominant tags become the god's identity and feed back into NPC dialogue. Followers say *"Our god watches over the harvest"* — which reinforces the tag further.

### 2.7 LLM Backfill System

When the player focuses on any NPC, event, or scene, the LLM generates rich narrative from sim state. The world appears to have a continuous tapestry of dialogue and drama; in reality it's invented on the spot, grounded in the simulation.

**LLM input (~500 tokens):**
- NPC card: personality traits, role, current mood, beliefs (~150 tokens)
- Recent events from ring buffer (~100 tokens)
- Previous player interaction summaries (~100 tokens)
- Current context: activity, nearby NPCs, settlement mood, time of day (~50 tokens)
- World tone system prompt (~100 tokens)

**LLM output:**
- Narrative text (what the player sees/hears)
- Structured state delta: `{ belief_changes, mood_shift, new_events, relationship_changes }`

The state delta feeds back into the sim layer, ensuring LLM interactions have lasting consequences.

**Observation principle:** anything the player isn't looking at runs on the sim. The moment they pay attention, it gets backfilled. Conversations, arguments, prayers, doubts — all generated from the compact state so they're consistent with history but richly detailed.

### 2.8 DM Agent (Background Director)

A background LLM agent that the player never interacts with directly. It turns raw simulation into *story* by injecting events, coaching rival spirits, and managing narrative pacing. The DM creates situations, never outcomes — it puts a drought on the table, but whether the player's miracle saves the village is up to the sim and the player's choices.

**Cadence:** Runs once per game-day, or when significant state changes accumulate (conversion cascade, miracle, settlement flipping religion). Can take 2-5 seconds since it's a background process — completely different latency budget than NPC dialogue.

**Model:** Larger model than NPC backfill (70B or frontier). Needs to reason about narrative arcs, pacing, player psychology, and multi-faction dynamics. Runs infrequently enough that cost/latency is acceptable. Can use a different provider than the NPC layer.

**Core responsibilities:**

1. **Pacing** — Is it too peaceful? Too punishing? Is the player coasting? Creates situations that maintain interesting tension.

2. **Narrative arc management** — Recognizes emerging stories in the sim state ("NPC A converted B, but B's sister is devout to a rival — family schism incoming") and nudges events to bring them to the surface. Tracks plot threads to completion (Chekhov's gun management).

3. **Rival spirit coaching** — Makes rival behavior dramatically interesting rather than randomly weighted. "The river spirit should challenge now because the player just performed a water miracle — domain conflict."

4. **Escalation ladder** — Calibrates challenge to player progression. Early: one village, household spirits. Mid: multiple settlements, organized rivals. Late: crusades, established religions, existential threats.

5. **Anti-grinding** — Detects repetitive player strategies and introduces complications. Always whispering to farmers? Here's a skeptic philosopher immune to whispers.

6. **Player modeling** — Learns what the player enjoys (political intrigue vs war vs peaceful expansion vs theological debate) and skews events toward those preferences.

7. **Macro narration** — Provides world-scale backfill when the player zooms out: the state of factions, spreading influence, brewing conflicts.

**Invisible hand constraint:** The DM works *with* the simulation, amplifying emerging trends rather than injecting arbitrary plot devices. Events should feel like natural consequences of the world state. A drought comes because the climate system makes it plausible, not because it's time for drama.

**DM output feeds into NPC prompts:** When the DM injects "rumors of plague from the north," this becomes part of the world context block in every NPC backfill prompt, ensuring NPCs mention it naturally.

**Input (~2000 tokens):**
- World state summary: settlement beliefs, faction strengths, recent events
- Player behavior summary: actions taken, focus areas, play style signals
- Active plot threads: what's been set up, what's unresolved
- Pacing state: ticks since last crisis/victory, current tension level
- Game phase: early/mid/late (based on player power + follower count)

**Output (structured JSON):**
```typescript
interface DMDirective {
  events_to_inject: {
    type: string;                // "drought", "stranger_arrives", "rival_challenge"
    target: string;              // Settlement or NPC id
    timing: 'immediate' | 'soon' | 'brewing';
    description: string;
  }[];

  rival_directives: {
    spiritId: string;
    strategyShift: string;       // New strategy or specific action
    reason: string;              // For DM's own continuity
  }[];

  new_npcs: {
    role: string;                // "wandering_preacher", "refugee", "philosopher", "spy"
    personality: object;         // Personality seed
    purpose: string;             // Why the DM is introducing them
    destination: string;         // Settlement id
  }[];

  world_shifts: {
    type: string;                // "trade_route", "season", "political"
    description: string;
  }[];

  plot_thread_updates: {
    id: string;
    action: 'advance' | 'resolve' | 'abandon';
    notes: string;
  }[];

  world_context_lines: string[]; // Injected into NPC backfill prompts
}
```

**Persistent DM state:**
```typescript
interface DMState {
  plotThreads: {
    id: string;
    description: string;
    setupTick: number;
    status: 'setup' | 'active' | 'climax' | 'resolving';
    involvedNpcs: string[];
    resolutionConditions: string;
  }[];

  playerModel: {
    playStyleWeights: Record<string, number>;  // "intrigue": 0.7, "war": 0.2, "expansion": 0.5
    engagementSignals: string[];               // What they spend time observing
    currentChallenges: string[];               // What the DM is testing them with
  };

  pacing: {
    tensionLevel: number;        // 0-1
    ticksSinceCrisis: number;
    ticksSinceVictory: number;
    ticksSinceSurprise: number;
  };

  narrativePhase: 'establishing' | 'rising_action' | 'climax' | 'resolution';
}
```

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           User Interface                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ Map Viewer  │  │ Map Editor  │  │ POI Editor  │  │ Road Editor │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
└─────────┼────────────────┼────────────────┼────────────────┼────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Rendering Pipeline                           │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ View Modes: Base │ Base+Decos │ Segmap │ Rendered              ││
│  └─────────────────────────────────────────────────────────────────┘│
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │  Autotiler  │→ │TileRenderer │→ │DecoRenderer │→ │ Compositor  │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        AI Rendering Pipeline                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ Base Image  │+ │ Decorations │+ │   Segmap    │→ │  FLUX AI    │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └──────┬──────┘ │
│                                                            │        │
│                                      ┌─────────────┐       │        │
│                                      │  Birefnet   │←──────┘        │
│                                      │ (BG Remove) │                │
│                                      └──────┬──────┘                │
│                                             ▼                       │
│                                    Transparent Tile PNG             │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Generation Engine                             │
│         ┌─────────────┐    ┌─────────────┐    ┌─────────────┐       │
│         │ WFC Engine  │ →  │ POI Placer  │ →  │ Road Carver │       │
│         └─────────────┘    └─────────────┘    └─────────────┘       │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Data Layer                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ WorldSeed   │  │   Chunks    │  │    POIs     │  │ Connections │ │
│  │   (JSON)    │  │  (Cached)   │  │  (Indexed)  │  │  (Indexed)  │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Models

### 3.1 World Seed

The root configuration object for a world.

```typescript
interface WorldSeed {
  id: string;                    // Unique identifier
  name: string;                  // Display name
  description: string;           // World description for AI prompts
  version: string;               // Schema version for migrations

  seed: number;                  // Master RNG seed

  biome: BiomeType;              // Global biome setting
  visualTheme: string;           // Art style hints

  // Infinite map - no fixed size, chunks generated on demand
  chunkSize: number;             // Default: 16 (tiles per chunk)

  pois: POI[];                   // Points of Interest
  connections: Connection[];      // Roads, rivers, walls
  roadEndpoints: RoadEndpoint[]; // Connections to off-map locations

  lore: {
    history: string;
    factions: Faction[];
    quests: Quest[];
  };

  metadata: {
    created: ISO8601;
    modified: ISO8601;
    author: string;
  };
}

type BiomeType =
  | 'temperate' | 'desert' | 'arctic'
  | 'tropical' | 'volcanic' | 'swamp' | 'highland';
```

### 3.2 Point of Interest (POI)

```typescript
interface POI {
  id: string;                    // Unique identifier
  type: POIType;                 // Category
  name: string;                  // Display name
  description: string;           // AI prompt content

  // Position (required)
  position: {
    x: number;                   // World coordinates (can be fractional)
    y: number;
  };

  // Optional placement hints
  region?: {                     // Preferred area (for WFC influence)
    x_min: number;
    x_max: number;
    y_min: number;
    y_max: number;
  };

  // Size and influence
  size: 'tiny' | 'small' | 'medium' | 'large' | 'huge';
  radius: number;                // Influence radius in tiles
  importance: 'low' | 'medium' | 'high' | 'critical';

  // Visual customization
  visualStyle?: string;          // Style hints for rendering
  decorations?: DecorationHint[]; // Specific decorations to place

  // Content
  npcs: NPC[];
  items: Item[];
  secrets: Record<string, any>;  // DM-only information

  // Generation hints
  terrainInfluence?: {
    [tileType: string]: number;  // Weight modifiers for nearby tiles
  };
}

type POIType =
  // Terrain zones
  | 'forest' | 'lake' | 'mountain' | 'swamp' | 'meadow' | 'desert'
  // Settlements
  | 'village' | 'city' | 'castle' | 'farm' | 'port' | 'tavern'
  // Special
  | 'ruins' | 'temple' | 'mine' | 'tower' | 'bridge' | 'crossroads'
  // Custom
  | 'custom';
```

### 3.3 Connection (Roads, Rivers, Walls)

```typescript
interface Connection {
  id: string;
  type: 'road' | 'river' | 'wall' | 'path';

  // Endpoints (POI references or coordinates)
  from: string | { x: number; y: number };
  to: string | { x: number; y: number };

  // Path definition
  waypoints: { x: number; y: number }[];  // Intermediate points

  // Properties
  style: string;                 // 'dirt', 'stone', 'cobble', etc.
  width: 1 | 2 | 3;             // Tile width

  // Auto-features
  autoBridge: boolean;           // Auto-place bridges over water
  autoTunnel: boolean;           // Auto-place tunnels through mountains

  description?: string;          // For AI prompts
}
```

### 3.4 Chunk

```typescript
interface Chunk {
  x: number;                     // Chunk coordinate (not tile)
  y: number;

  tiles: Tile[][];               // chunkSize x chunkSize grid
  decorations: DecorationInstance[];

  state: 'ungenerated' | 'generating' | 'generated' | 'rendered';

  // Cache info
  generatedAt: number;           // Timestamp
  renderCache?: {
    base: ImageBitmap;
    baseDecos: ImageBitmap;
    segmap: ImageBitmap;
    rendered: ImageBitmap;
  };
}

interface Tile {
  type: string;                  // Semantic type (grass, water, road)
  visualVariant?: string;        // Computed by autotiler (road_ns, shore_e)

  height: number;                // Elevation
  walkable: boolean;

  decorations: DecorationInstance[];

  // POI reference if this tile is part of a POI
  poi?: string;
}
```

### 3.5 Decoration

```typescript
interface DecorationDefinition {
  id: string;
  name: string;
  category: string;              // 'tree', 'building', 'rock', etc.

  placement: {
    allowedTiles: string[];
    excludedTiles: string[];
    allowedBiomes: string[];
    probability: number;         // 0-1
    minDistance: number;         // Manhattan distance
    maxPerTile: number;
  };

  prompt: {
    description: string;         // For AI painting
  };

  segmentation: {
    color: string;               // ADE20K hex color
    extent: {
      width: number;             // Relative to tile (0-1)
      heightAbove: number;       // Pixels above ground
    };
  };

  drawing: {
    palettes: Record<string, string[]>;
    variants: Record<string, Layer[]>;
    layers: Layer[];
  };
}

interface DecorationInstance {
  id: string;                    // Reference to definition
  seed: number;                  // For deterministic rendering
  offsetX: number;               // Pixel offset
  offsetY: number;
}
```

### 3.7 NPC

```typescript
interface NPC {
  id: string;
  name: string;
  role: 'farmer' | 'elder' | 'merchant' | 'healer' | 'smith' | 'guard' | 'priest' | 'beggar';
  settlement: string;            // POI id where they live

  // Fixed at generation — personality seed
  personality: {
    openness: number;            // 0-1: receptive to new ideas vs traditional
    assertiveness: number;       // 0-1: spreads beliefs vs keeps quiet
    skepticism: number;          // 0-1: needs evidence vs accepts on faith
    courage: number;             // 0-1: acts on conviction vs follows crowd
  };

  // Dynamic — updated every tick
  beliefs: {
    [spiritId: string]: {
      faith: number;             // 0-1: strength of belief
      understanding: number;     // 0-1: how well they grasp the god's nature
      devotion: number;          // 0-1: active worship vs passive belief
    };
  };

  needs: {
    safety: number;              // 0-1: 0 = terrified, 1 = secure
    prosperity: number;          // 0-1: 0 = starving, 1 = thriving
    community: number;           // 0-1: 0 = isolated, 1 = connected
    meaning: number;             // 0-1: 0 = existential crisis, 1 = purposeful
  };

  mood: number;                  // -1 (despair) to 1 (elated), derived from needs

  relationships: Relationship[];

  // Ring buffer of last ~10 events
  recentEvents: NPCEvent[];

  // Compressed summaries of past LLM exchanges (max ~5)
  playerInteractions: InteractionMemory[];

  // Current state machine state
  currentActivity: 'sleeping' | 'farming' | 'trading' | 'gossiping' | 'praying' | 'traveling' | 'celebrating' | 'mourning';
}

interface Relationship {
  npcId: string;
  type: 'family' | 'friend' | 'rival' | 'lover' | 'mentor';
  trust: number;                 // 0-1
}

interface NPCEvent {
  tick: number;
  type: string;                  // "saw_omen", "neighbor_converted", "crop_failed", "heard_prayer_answered"
  description: string;           // Brief text for LLM context
  impact: number;                // Magnitude of effect on beliefs/mood
}

interface InteractionMemory {
  tick: number;
  summary: string;               // LLM-compressed: "Player whispered about protecting the harvest. NPC was skeptical but intrigued."
  stateChange: Record<string, number>; // What changed: { "faith": +0.2, "mood": +0.1 }
}
```

### 3.8 Spirit (Rival)

```typescript
interface Spirit {
  id: string;
  name: string;
  domain: string;                // What they're god of (or aspire to be)
  power: number;                 // Derived from total belief across followers

  personality: {
    aggression: number;          // 0-1: proselytize/attack vs passive
    subtlety: number;            // 0-1: omens/dreams vs direct action
    territoriality: number;      // 0-1: defend followers vs expand
  };

  strategy: 'expand' | 'defend' | 'undermine' | 'coexist';

  // Programmatic action weights (derived from personality + situation)
  actionWeights: {
    whisper: number;             // Inspire a follower
    omen: number;                // Display power
    counter: number;             // Oppose player's moves
    crusade: number;             // Incite inter-faction conflict
    gift: number;                // Meet a follower's need
  };

  followers: string[];           // NPC ids
}

type SpiritTier = 'household' | 'nature' | 'small_god' | 'established';
```

### 3.9 Player (Small God)

```typescript
interface PlayerGod {
  power: number;                 // Σ(faith × understanding × devotion) across followers
  domainTags: {
    [tag: string]: number;       // Weighted tag cloud: "harvest": 0.6, "protection": 0.4
  };
  followers: string[];           // NPC ids
  actionHistory: DivineAction[]; // Recent actions for pattern detection
}

interface DivineAction {
  tick: number;
  type: 'whisper' | 'omen' | 'answer_prayer' | 'dream' | 'miracle';
  targetNpc?: string;
  targetSettlement?: string;
  cost: number;
  domainTagsAffected: string[];  // What domain tags this action reinforces
}
```

---

## 4. Generation Pipeline

### 4.1 Chunk Generation Flow

```
1. Request chunk at (cx, cy)
           │
           ▼
2. Check if chunk exists in cache
           │
    ┌──────┴──────┐
    │ Yes         │ No
    ▼             ▼
3. Return    4. Get neighboring chunks (for edge constraints)
   cached           │
                    ▼
           5. Initialize WFC grid with:
              - Edge constraints from neighbors
              - POI terrain influence
              - Biome weights
                    │
                    ▼
           6. Run WFC solver
                    │
                    ▼
           7. Apply POI-specific tiles
              (buildings on village POIs, etc.)
                    │
                    ▼
           8. Carve roads/rivers through chunk
              (using Connection data)
                    │
                    ▼
           9. Place decorations
              (respecting placement rules)
                    │
                    ▼
          10. Cache chunk
                    │
                    ▼
          11. Return chunk
```

### 4.2 WFC Constraint System

```typescript
interface TileConstraint {
  tile: string;

  // Adjacency rules (which tiles can be neighbors)
  north: string[];
  south: string[];
  east: string[];
  west: string[];

  // Weight modifiers
  baseWeight: number;            // Default probability
  biomeWeights: Record<BiomeType, number>;
  poiInfluence: Record<POIType, number>;
}
```

### 4.3 Road Auto-Bridge Logic

When a road crosses water:

1. Detect water tile intersection during road carving
2. Check if bridge is possible (water width ≤ 3 tiles)
3. Place bridge tiles with correct orientation (NS or EW)
4. If water too wide, route around or fail with warning

---

## 5. Rendering Pipeline

### 5.1 View Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| Base | Kenney tiles only | Debug, tile inspection |
| Base + Decos | Kenney + decoration sprites | Full preview |
| Segmap | ADE20K segmentation colors | AI input preview |
| Rendered | AI-generated tiles | Final quality |

### 5.2 AI Tile Generation Flow

```
1. Prepare base canvas (512x512, transparent)
           │
           ▼
2. Draw Kenney tile centered at (256, 333)
           │
           ▼
3. Draw decorations on top (using DecorationRenderer)
           │
           ▼
4. Prepare segmap canvas (512x512, ADE20K sea background)
           │
           ▼
5. Draw tile segmentation diamond
           │
           ▼
6. Draw decoration segmentation shapes
           │
           ▼
7. Build prompt from:
   - Tile type description
   - Decoration descriptions
   - World biome/style
           │
           ▼
8. Send to FLUX API:
   - image_url: base canvas
   - easycontrols[0]: segmap (optional)
   - prompt: generated prompt
           │
           ▼
9. Receive AI result image
           │
           ▼
10. Send to Birefnet for background removal
           │
           ▼
11. Save transparent PNG to cache
           │
           ▼
12. Update renderedTileCache
```

### 5.3 Tile Caching Strategy

```typescript
interface TileCache {
  // In-memory cache (LRU)
  memory: Map<string, ImageBitmap>;  // key: `${layer}:${tileId}_v${variant}`
  maxMemorySize: number;             // Default: 500 tiles

  // Disk cache (persistent)
  diskPath: string;                  // /tiles/rendered/{style}/
  format: 'png';

  // Cache key format
  getKey(style: string, tileId: string, variant: number): string;
}
```

---

## 6. Editor Features

### 6.1 Map Navigation

- **Pan**: Drag to pan, scroll wheel
- **Zoom**: +/- buttons, pinch gesture, scroll + modifier
- **Minimap**: Click to jump, viewport indicator

### 6.2 Tile Selection

- Click tile to select
- Show tile info panel:
  - Position (x, y)
  - Type (semantic + visual variant)
  - Decorations list
  - POI reference (if any)
  - AI render status

### 6.3 POI Editor

- **Add POI**: Click location, select type, fill details
- **Edit POI**: Select POI marker, edit in panel
- **Delete POI**: Select + delete key
- **Move POI**: Drag POI marker
- **Resize POI**: Drag radius handle

### 6.4 Road Editor

- **Add Road**:
  1. Enter road mode
  2. Click start point (POI or coordinate)
  3. Click waypoints (optional)
  4. Click end point
  5. Configure style, width, auto-bridge

- **Edit Road**:
  - Select road to show waypoints
  - Drag waypoints to adjust
  - Add/remove waypoints

- **Auto-Bridge**: Toggle per-road, visual indicator on water crossings

### 6.5 Decoration Editor (Future)

- Manual decoration placement
- Decoration brush for area filling
- Clear decorations from selection

---

## 7. Storage

### 7.1 Primary Format: JSON

```
/data/worlds/{worldId}.json     # World seed
/tiles/rendered/{style}/        # AI-rendered tiles
/tiles/kenney/                  # Base Kenney tiles
```

### 7.2 Cache Storage

```
localStorage:
  smallgods_world_{id}          # World seed JSON
  smallgods_settings            # User preferences

IndexedDB (future):
  chunks                        # Generated chunk data
  renderedTiles                 # Tile image blobs
```

### 7.3 Export/Import

- Download world as JSON
- Import world from JSON file
- Future: Export rendered map as PNG

---

## 8. Performance Targets

| Metric | Target |
|--------|--------|
| Chunk generation | < 100ms |
| View mode switch | < 50ms |
| AI tile render | < 15s |
| Pan/zoom | 60 FPS |
| Memory usage | < 200MB |
| Initial load | < 2s |

---

## 9. API Endpoints

### 9.1 Server Endpoints

```
GET  /api/tiles/available       # List available tile types
POST /api/tiles/save-rendered   # Save AI-rendered tile
GET  /tiles/kenney/{id}.png     # Kenney tile images
GET  /tiles/rendered/{style}/{id}_v{n}.png  # Rendered tiles

POST /api/fal/{endpoint}        # Proxy to fal.ai
  - fal-ai/flux-general/image-to-image
  - fal-ai/birefnet
```

### 9.2 Future Endpoints

```
POST /api/worlds                # Create world
GET  /api/worlds/{id}           # Get world
PUT  /api/worlds/{id}           # Update world
DELETE /api/worlds/{id}         # Delete world

GET  /api/worlds/{id}/chunks/{cx},{cy}  # Get generated chunk
```

---

## 10. Error Handling

### 10.1 Generation Errors

| Error | Handling |
|-------|----------|
| WFC contradiction | Backtrack up to 500 attempts, then fallback to noise |
| Invalid POI position | Snap to valid terrain, warn user |
| Road cannot connect | Show warning, offer manual waypoint mode |

### 10.2 Rendering Errors

| Error | Handling |
|-------|----------|
| Tile not found | Use placeholder, log warning |
| AI API failure | Use base tile, retry queue |
| Background removal failure | Use original AI result |

---

## 11. Future Considerations

### 11.1 Multiplayer

- Shared world state (multiple small gods competing)
- Conflict resolution for simultaneous divine actions
- Real-time sync

### 11.2 MCP UI Integration

- Map rendered in LLM client
- Interactive POI/NPC inspection via tool calls
- Real-time world updates via streaming
