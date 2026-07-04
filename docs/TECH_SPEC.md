# Small Gods - Technical Specification

**Version**: 2.1.0
**Status**: Active
**Last Updated**: 2026-05-29

---

## 1. Overview

> **Canonical reference:** Cosmology, the belief model, progression, and the Gods-vs-Fate framing are defined in [VISION.md](VISION.md). This spec defers to it on those topics.

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

**Progression and win condition** (canonical: [VISION.md §7](VISION.md)): the arc runs tiny → major → supplant. The win is **attribution, not comfort** — you win by becoming the name mortals reach for *in crisis and in plenty*, not by making everyone safe (universal comfort triggers **secularization** and dissolves you). Supplanting rivals and great gods means starving their belief until they fade to "nothing but names." This counter-pressure — comfort kills belief, rivals eat neglect, Fate escalates against dominance — is the central anti-snowball tension.

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

**Power economy** (canonical: [VISION.md §3](VISION.md)):
```
power regen ∝ Σ_believers (faith × understanding × devotion)
```
- This is the canonical formula, and it is **implemented**: `src/sim/spirit-system.ts` computes `power regen ∝ Σ faith × (1 + 2·understanding) × (1 + 2·devotion) × POWER_REGEN_RATE(0.02)` — `understanding` and `devotion` are real power multipliers, not dead fields (VISION.md §9 item 1, closed).
- Quantity of believers ≠ power: a hundred who *understand* and are *devoted* outweigh a million fearful nominal believers.
- Actions drain power (checked before execution)
- Player must maintain positive flow — spend too much and you fade

### 2.5 Rival Spirits

Other spirits compete for mortal belief. They run on the sim layer with personality-weighted action selection:

- **Household spirits** — minor, cling to a single hearth, low threat
- **Nature spirits** — tied to rivers/groves, territorial
- **Other small gods** — direct competitors, hungry and ambitious
- **Established deities** — powerful, with organized religions and institutional inertia

Each rival has: `aggression`, `subtlety`, `territoriality` traits and a current strategy (`expand` / `defend` / `undermine` / `coexist`). Their actions are programmatic most of the time, but when they **directly intersect with the player** (competing for the same NPC, countering a miracle), that moment gets LLM treatment — the rival manifests through their most devoted follower.

**Player-modelling lives here, not in Fate** ([VISION.md §5](VISION.md)): rivals learn the player's strategy, claim the prayers the player ignores, and adapt their own play to counter the player. Fate (§2.8) is impersonal and does not model the player.

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

### 2.8 Fate (Background Director / DM Agent)

This background agent **is Fate** (see [VISION.md §2.1](VISION.md)): impersonal, reactive, and **unpetitionable from in-world** — no mortal prays to it, no one bargains with it. The player never interacts with it directly. Fate does **not** inject arbitrary plot; it **amplifies and escalates what the simulation is already producing**, turning the sim's emergent tendencies into *story* by biasing event timing/severity, coaching rival spirits, and managing narrative pacing. It puts a drought on the table (because the climate system makes it plausible), but whether the player's miracle saves the village is up to the sim and the player's choices.

> **Player-modelling lives in rival spirits, not in Fate.** Learning the player's strategy and skewing behaviour toward/against their preferences is a **rival spirit** capability (§2.5). Fate is impersonal and does not track player taste.

**Cadence:** Runs once per game-day, or when significant state changes accumulate (conversion cascade, miracle, settlement flipping religion). Can take 2-5 seconds since it's a background process — completely different latency budget than NPC dialogue.

**Model:** The **capable tier** of the two-tier OpenRouter catalog (`DEFAULT_CAPABLE_MODEL` in `src/llm/openrouter-catalog.ts`, currently `deepseek/deepseek-v4-pro`) — a stronger model than the fast NPC-backfill tier (`DEFAULT_CHAT_MODEL`, currently `deepseek/deepseek-v4-flash`). Reached via the built-but-uncalled `Game.llmClientCapable` seam. It needs to reason about narrative arcs, pacing, and multi-faction dynamics. (Reasoning about *player psychology* belongs to rival spirits — Fate stays impersonal.) Runs infrequently enough that cost/latency is acceptable. Players pick the exact model in LLM settings; update the catalog (not this prose) when the recommended defaults change.

**Core responsibilities:**

1. **Pacing** — Is it too peaceful? Too punishing? Is the player coasting? Creates situations that maintain interesting tension.

2. **Narrative arc management** — Recognizes emerging stories in the sim state ("NPC A converted B, but B's sister is devout to a rival — family schism incoming") and nudges events to bring them to the surface. Tracks plot threads to completion (Chekhov's gun management).

3. **Rival spirit coaching** — Makes rival behavior dramatically interesting rather than randomly weighted. "The river spirit should challenge now because the player just performed a water miracle — domain conflict." (The rivals themselves carry the player-modelling; Fate only times their moves for drama.)

4. **Escalation ladder** — Calibrates challenge to player progression. Early: one village, household spirits. Mid: multiple settlements, organized rivals. Late: crusades, established religions, existential threats. Fate resists ascension: the more dominant the player, the harder Fate pushes back (a winning god is a boring story).

5. **Anti-grinding** — Detects repetitive player strategies and introduces complications. Always whispering to farmers? Here's a skeptic philosopher immune to whispers.

6. **Macro narration** — Provides world-scale backfill when the player zooms out: the state of factions, spreading influence, brewing conflicts.

**Invisible hand constraint:** Fate works *with* the simulation, amplifying emerging trends rather than injecting arbitrary plot devices. Events should feel like natural consequences of the world state. A drought comes because the climate system makes it plausible, not because it's time for drama.

**Fate's output feeds into NPC prompts:** When Fate surfaces "rumors of plague from the north," this becomes part of the world context block in every NPC backfill prompt, ensuring NPCs mention it naturally.

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

  // NOTE: no playerModel here. Player-modelling (play-style weights, what the
  // player is observing, defection opportunities) lives on RIVAL SPIRITS — see
  // §2.5 and VISION.md §5. Fate is impersonal and unpetitionable; it does not
  // track player taste.

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

> **Superseded.** The diagram originally here (UI editors → Kenney/FLUX/Birefnet
> AI-rendering pipeline → WFC generation engine) was never built; see
> [`docs/archive/tech-spec-2026-05-generation-api-sections.md`](archive/tech-spec-2026-05-generation-api-sections.md)
> for the original text and what shipped instead. The real architecture is the
> one in `CLAUDE.md` § Architecture: `game.ts` coordinator over `src/game/`
> collaborators, a WebGPU-only renderer (`src/render/gpu/`), noise-based +
> connectome-driven world generation (`src/terrain/`, `src/world/connectome/`),
> and the parametric blueprint→manifold→OpenRouter img2img building pipeline
> (`src/assetgen/`). No server; this is a client-only Vite/TypeScript app.

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

> **Note:** the interface below is the original 2026-05-29 design and
> materially disagrees with the shipped type. Defer to code:
> `POI` in `src/core/types.ts` — `type` is a plain `string` (not the closed
> `POIType` union below), almost every field is optional, `position` itself is
> optional, and there is no `radius`/`visualStyle`/`decorations`/`items`/
> `secrets`/`terrainInfluence` (those belonged to the never-built WFC/AI-tile
> pipeline — see [the archive note](#3-system-architecture) above). The shipped
> `POI` instead carries `coast` (seed-proof shoreline anchoring) and `summitM`
> (authored peak height), which postdate this doc.

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

> **Superseded.** The chunked-on-demand WFC generation flow originally
> documented here (4.1 Chunk Generation Flow, 4.2 WFC Constraint System, 4.3
> Road Auto-Bridge Logic) was never built — the game generates a whole world
> up front, not per-chunk on demand. Original text archived at
> [`docs/archive/tech-spec-2026-05-generation-api-sections.md`](archive/tech-spec-2026-05-generation-api-sections.md).
> The real pipeline: noise-based terrain (`terrain/terrain-generator.ts`:
> fractal noise → biomes → tiles) plus connectome/settlement-driven layout
> (`src/world/connectome/`); roads/rivers carve through one analytic
> feature-SDF (`render/gpu/feature-geometry.ts`) with bridges as a generative
> site (river-crossing epic), not a chunk-boundary auto-bridge check. WFC
> primitives (`src/wfc/`) are retained but **dormant**
> (`generateWithWFC` is bypassed).

---

## 5. Rendering Pipeline

> **Superseded.** The Kenney-tiles + FLUX/Birefnet/ADE20K AI-tile-rendering
> flow originally documented here (5.1 View Modes, 5.2 AI Tile Generation
> Flow, 5.3 Tile Caching Strategy) was never built — zero references to
> Birefnet, ADE20K, or fal.ai/FLUX tile rendering exist in `src/`. Original
> text archived at
> [`docs/archive/tech-spec-2026-05-generation-api-sections.md`](archive/tech-spec-2026-05-generation-api-sections.md).
> The real renderer is **WebGPU-only** (`CLAUDE.md` § Rendering): a
> buffer-driven GPU heightfield terrain, a y-sorted instanced entity pass, and
> banded lighting with projected cast shadows — no tile-caching layer, no
> segmentation-map AI conditioning. Buildings are `SpritePack`s produced by the
> blueprint→manifold→OpenRouter-img2img pipeline (`src/assetgen/`), cached in
> IndexedDB / a vendored library, not a Kenney+FLUX render loop.

---

## 6. Editor Features

> **Superseded.** The POI/Road editor with drag handles originally documented
> here (6.1–6.5: map nav, tile selection, POI editor, road editor, decoration
> editor) was never built. Original text archived at
> [`docs/archive/tech-spec-2026-05-generation-api-sections.md`](archive/tech-spec-2026-05-generation-api-sections.md).
> World/POI editing today lives in the dev **Studio** (`?studio=world`):
> `src/studio/world-node-edits.ts` exposes move/add/remove/retune POI edits
> that fold back into a `WorldSeed` for regeneration (schema-aware live param
> editing, per `CLAUDE.md` § Studio) — there is no live drag-handle POI marker
> or road-waypoint editor as described below.

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

> **Superseded.** The REST API originally documented here (9.1 Server
> Endpoints, 9.2 Future Endpoints) was never built — this is a **client-only**
> Vite/TypeScript app with no server. Original text archived at
> [`docs/archive/tech-spec-2026-05-generation-api-sections.md`](archive/tech-spec-2026-05-generation-api-sections.md).
> The real out-of-process control surface (dev-only) is the `GameBus`
> WebSocket bridge (`?bridge`/`?bridge=rw`, a Vite plugin on `/__bus`) driven
> by a CLI (`tools/bus-cli.ts`) or a stdio MCP server (`tools/mcp-server.ts`,
> 16 tools) — see `CLAUDE.md` § Development.

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
