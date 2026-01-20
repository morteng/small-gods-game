# AI-Generated Visuals and Audio System

## Overview

This document describes an innovative approach to game visuals where:
1. **Skeleton tiles** provide structural geometry for game logic
2. **AI image generation** paints over the skeleton to create unique, stylized visuals
3. **Dynamic portraits** show NPCs aging over time
4. **Voice synthesis** lets players overhear key conversations
5. **Emergent god identity** - the god's visual form emerges from believer narratives

---

## 1. Skeleton-to-Painted Map Pipeline

### Concept

```
[Procedural Map Generator]
         │
         ▼
[Skeleton Tilemap]          [Color/Segment Map]
(clean isometric tiles)  →  (tile types as colors)
         │                          │
         ▼                          ▼
    [Composite]  ←──────────────────┘
         │
         ▼
[AI Image Generator]
(ControlNet/img2img with style prompt)
         │
         ▼
[Painted Map Image]
(visually rich, game logic uses skeleton data)
```

### Tile Types and Color Encoding

The skeleton tilemap is converted to a **segment map** where each color represents a tile type:

```typescript
const TILE_COLORS: Record<TileType, string> = {
  // Terrain
  water_deep: '#0000AA',
  water_shallow: '#0066CC',
  grass: '#00AA00',
  grass_tall: '#008800',
  dirt: '#8B4513',
  sand: '#F4D03F',
  desert: '#EDC9AF',
  snow: '#FFFFFF',
  ice: '#A5F2F3',
  swamp: '#556B2F',

  // Vegetation
  forest_deciduous: '#228B22',
  forest_conifer: '#006400',
  forest_dead: '#4A4A4A',
  jungle: '#004D00',

  // Structures
  road_dirt: '#D2691E',
  road_stone: '#808080',
  building_wood: '#DEB887',
  building_stone: '#A9A9A9',
  building_temple: '#FFD700',
  wall: '#696969',
  bridge: '#8B7355',

  // Special
  farmland: '#90EE90',
  ruins: '#BC8F8F',
  cave_entrance: '#2F4F4F',
  magical_ground: '#9400D3',
};
```

### Generation Pipeline

#### Step 1: Generate Skeleton Map

Use clean isometric tiles (like route1rodent's 32x32 set) to build the structural map:

```typescript
interface SkeletonMap {
  width: number;
  height: number;
  tiles: TileData[][];

  // Each tile knows its type and connections
  getTile(x: number, y: number): TileData;
  getNeighbors(x: number, y: number): TileData[];
}

interface TileData {
  type: TileType;
  elevation: number;        // For isometric depth
  variation: number;        // 0-3 for tile variants
  connections: Direction[]; // Which edges connect to same type
  entities: EntityId[];     // NPCs, objects on this tile
  effects: TileEffect[];    // Active effects (fire, blessing, etc.)
}
```

#### Step 2: Render Segment Map

Convert tile types to solid colors, maintaining exact pixel positions:

```typescript
function renderSegmentMap(skeleton: SkeletonMap): ImageData {
  const canvas = new OffscreenCanvas(
    skeleton.width * TILE_SIZE,
    skeleton.height * TILE_SIZE
  );
  const ctx = canvas.getContext('2d');

  for (let y = 0; y < skeleton.height; y++) {
    for (let x = 0; x < skeleton.width; x++) {
      const tile = skeleton.getTile(x, y);
      const isoPos = toIsometric(x, y);

      // Fill tile area with type color
      ctx.fillStyle = TILE_COLORS[tile.type];
      drawIsoTile(ctx, isoPos.x, isoPos.y);
    }
  }

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
```

#### Step 3: Composite for AI Generation

Combine skeleton render + segment map as conditioning inputs:

```typescript
interface MapGenerationRequest {
  // Structural reference (isometric skeleton tiles)
  skeletonImage: Blob;

  // Color-coded tile types
  segmentMap: Blob;

  // Style prompt
  prompt: string;

  // Consistency seed for reproducible results
  seed: number;

  // Optional: specific area to regenerate
  region?: { x: number; y: number; width: number; height: number };
}

// Example prompt
const stylePrompt = `
Fantasy isometric world map, painterly style,
rich colors, atmospheric lighting, magical ambiance,
cohesive art direction, game asset quality,
consistent perspective, ${timeOfDay} lighting
`;
```

#### Step 4: AI Image Generation

Use ControlNet (or similar) with multiple conditioning inputs:

```typescript
async function generatePaintedMap(request: MapGenerationRequest): Promise<Blob> {
  // Using a service like Stability AI, Replicate, or local ComfyUI

  const response = await imageGeneration.generate({
    // Base prompt
    prompt: request.prompt,
    negative_prompt: "blurry, low quality, inconsistent style, modern elements",

    // ControlNet conditioning
    controlnets: [
      {
        type: 'depth',
        image: request.skeletonImage,
        strength: 0.8,  // Strong structural adherence
      },
      {
        type: 'seg',    // Segmentation
        image: request.segmentMap,
        strength: 0.9,  // Strong type adherence
      }
    ],

    seed: request.seed,
    steps: 30,
    cfg_scale: 7,
  });

  return response.image;
}
```

### Caching and Updates

```typescript
interface MapCache {
  // Full map at various zoom levels
  fullMap: Map<ZoomLevel, Blob>;

  // Individual tile renders for incremental updates
  tiles: Map<TileKey, Blob>;

  // Generation parameters for consistency
  styleSeed: number;
  stylePrompt: string;

  // Track which tiles need regeneration
  dirtyTiles: Set<TileKey>;
}

// When a tile changes (fire, flood, building destroyed):
function markTileDirty(cache: MapCache, x: number, y: number, radius: number = 1) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      cache.dirtyTiles.add(`${x + dx},${y + dy}`);
    }
  }
}

// Batch regenerate dirty regions
async function updateDirtyRegions(cache: MapCache, skeleton: SkeletonMap) {
  // Group dirty tiles into regions
  const regions = clusterDirtyTiles(cache.dirtyTiles);

  for (const region of regions) {
    const paintedRegion = await generatePaintedMap({
      skeletonImage: renderSkeletonRegion(skeleton, region),
      segmentMap: renderSegmentRegion(skeleton, region),
      prompt: cache.stylePrompt,
      seed: cache.styleSeed,
      region,
    });

    // Composite into full map
    blitRegion(cache.fullMap, paintedRegion, region);
  }

  cache.dirtyTiles.clear();
}
```

### Time of Day and Weather

The same skeleton can be repainted with different lighting:

```typescript
type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';
type Weather = 'clear' | 'cloudy' | 'rainy' | 'stormy' | 'foggy' | 'snowy';

function getAtmosphericPrompt(time: TimeOfDay, weather: Weather): string {
  const timePrompts: Record<TimeOfDay, string> = {
    dawn: 'soft pink and orange sunrise, long shadows, morning mist',
    day: 'bright daylight, clear sky, vibrant colors',
    dusk: 'golden hour, purple and orange sunset, warm shadows',
    night: 'moonlit, dark blue atmosphere, stars visible, torchlight glow',
  };

  const weatherPrompts: Record<Weather, string> = {
    clear: 'clear sky, sharp details',
    cloudy: 'overcast, diffused light, muted shadows',
    rainy: 'rain falling, wet surfaces, puddles reflecting',
    stormy: 'dark clouds, lightning, dramatic atmosphere',
    foggy: 'thick fog, limited visibility, mysterious',
    snowy: 'falling snow, white accumulation, cold atmosphere',
  };

  return `${timePrompts[time]}, ${weatherPrompts[weather]}`;
}
```

---

## 2. Dynamic NPC Portraits

### Age-Based Portrait Evolution

Each NPC gets AI-generated portraits at key life stages:

```typescript
interface NPCPortraits {
  entityId: EntityId;

  // Base generation parameters for consistency
  baseSeed: number;
  basePrompt: string;  // Physical description

  // Cached portraits at different ages
  portraits: Map<AgeStage, Blob>;

  // Current displayed portrait
  currentStage: AgeStage;
}

type AgeStage = 'child' | 'young_adult' | 'adult' | 'middle_aged' | 'elderly' | 'ancient';

function getAgeStage(age: number, lifespan: number): AgeStage {
  const ratio = age / lifespan;
  if (ratio < 0.15) return 'child';
  if (ratio < 0.25) return 'young_adult';
  if (ratio < 0.45) return 'adult';
  if (ratio < 0.65) return 'middle_aged';
  if (ratio < 0.85) return 'elderly';
  return 'ancient';
}
```

### Portrait Generation

```typescript
async function generateNPCPortrait(
  npc: Entity,
  stage: AgeStage,
  baseSeed: number
): Promise<Blob> {
  const baseDescription = describeNPCAppearance(npc);

  const ageModifiers: Record<AgeStage, string> = {
    child: 'young child, innocent expression, round face',
    young_adult: 'young adult, energetic, smooth skin',
    adult: 'adult, mature features, confident expression',
    middle_aged: 'middle-aged, some wrinkles, experienced look',
    elderly: 'elderly, wrinkled, wise expression, grey hair',
    ancient: 'very old, deeply wrinkled, wispy white hair, knowing eyes',
  };

  const prompt = `
    Portrait of ${baseDescription},
    ${ageModifiers[stage]},
    fantasy art style, painterly,
    ${npc.occupation} attire,
    ${getEmotionalState(npc)} expression,
    medieval fantasy setting
  `;

  return await imageGeneration.generate({
    prompt,
    negative_prompt: 'modern clothing, technology, blurry',
    seed: baseSeed + stageOffset(stage),
    size: '256x256',
  });
}

function describeNPCAppearance(npc: Entity): string {
  // Generate consistent physical description from entity data
  const features = [];

  // Derive from attributes
  if (npc.attributes.str >= 15) features.push('muscular build');
  if (npc.attributes.str <= 8) features.push('slight build');
  if (npc.attributes.cha >= 15) features.push('attractive features');
  if (npc.attributes.wis >= 15) features.push('thoughtful eyes');

  // From background
  if (npc.background === 'farmer') features.push('weathered skin, calloused hands');
  if (npc.background === 'scholar') features.push('spectacles, ink-stained fingers');
  if (npc.background === 'soldier') features.push('scarred, stern expression');

  return features.join(', ');
}
```

### Life Events Affecting Appearance

Major life events can modify portraits:

```typescript
interface AppearanceModifier {
  event: string;
  promptAddition: string;
  permanent: boolean;
}

const APPEARANCE_MODIFIERS: AppearanceModifier[] = [
  { event: 'battle_scar', promptAddition: 'facial scar', permanent: true },
  { event: 'divine_blessing', promptAddition: 'faint golden aura', permanent: false },
  { event: 'cursed', promptAddition: 'pallid skin, sunken eyes', permanent: false },
  { event: 'wealthy', promptAddition: 'fine jewelry, rich clothing', permanent: false },
  { event: 'starving', promptAddition: 'gaunt, hollow cheeks', permanent: false },
  { event: 'plague_survivor', promptAddition: 'pockmarked skin', permanent: true },
];

// Regenerate portrait when significant events occur
async function updatePortraitForEvent(
  npc: Entity,
  event: string,
  portraitCache: NPCPortraits
): Promise<void> {
  const modifier = APPEARANCE_MODIFIERS.find(m => m.event === event);
  if (!modifier) return;

  // Add modifier to base prompt
  portraitCache.basePrompt += `, ${modifier.promptAddition}`;

  // Regenerate current stage portrait
  const newPortrait = await generateNPCPortrait(
    npc,
    portraitCache.currentStage,
    portraitCache.baseSeed
  );

  portraitCache.portraits.set(portraitCache.currentStage, newPortrait);
}
```

---

## 3. Voice Synthesis with Pocket TTS

### Kyutai Pocket TTS Integration

[Pocket TTS](https://kyutai.org/blog/2026-01-13-pocket-tts) is a lightweight, fast TTS model suitable for game dialogue.

```typescript
interface VoiceProfile {
  entityId: EntityId;

  // Voice characteristics
  pitch: number;        // 0.5 - 2.0
  speed: number;        // 0.5 - 2.0
  accent: string;       // Regional variation

  // Derived from entity
  gender: 'male' | 'female' | 'neutral';
  age: 'young' | 'adult' | 'elderly';
}

function deriveVoiceProfile(entity: Entity): VoiceProfile {
  // Deterministic voice from entity seed
  const rng = seededRandom(entity.id);

  return {
    entityId: entity.id,
    pitch: entity.attributes.cha >= 12 ?
      rng.range(0.9, 1.1) : rng.range(0.7, 1.3),
    speed: entity.attributes.int >= 12 ?
      rng.range(1.0, 1.2) : rng.range(0.8, 1.0),
    accent: deriveAccentFromBackground(entity.background),
    gender: entity.gender,
    age: getAgeCategory(entity.age),
  };
}
```

### Conversation Voicing

```typescript
interface VoicedConversation {
  participants: EntityId[];
  lines: VoicedLine[];
  importance: 'background' | 'notable' | 'critical';
}

interface VoicedLine {
  speaker: EntityId;
  text: string;
  emotion: 'neutral' | 'happy' | 'sad' | 'angry' | 'fearful' | 'reverent';
  audio?: Blob;
}

async function voiceConversation(
  conversation: VoicedConversation,
  voiceProfiles: Map<EntityId, VoiceProfile>
): Promise<VoicedConversation> {
  // Only voice notable+ conversations to save resources
  if (conversation.importance === 'background') {
    return conversation;
  }

  for (const line of conversation.lines) {
    const profile = voiceProfiles.get(line.speaker);
    if (!profile) continue;

    line.audio = await pocketTTS.synthesize({
      text: line.text,
      voice: {
        pitch: profile.pitch,
        speed: profile.speed,
        emotion: line.emotion,
      },
    });
  }

  return conversation;
}
```

### GM-Flagged Key Conversations

The LLM GM decides which conversations are worth voicing:

```typescript
interface GMConversationDecision {
  shouldVoice: boolean;
  importance: 'background' | 'notable' | 'critical';
  reason?: string;  // Why this matters to the narrative
}

// LLM prompt for conversation importance
const CONVERSATION_IMPORTANCE_PROMPT = `
You are the GM of a god game. Evaluate this conversation between NPCs.

Conversation:
{{conversation}}

Context:
- Player's god: {{godName}} ({{believerCount}} believers)
- Current narrative threads: {{narrativeThreads}}
- Recent player actions: {{recentActions}}

Determine if the player should overhear this conversation:
- CRITICAL: Directly about the player's god, miracles, or major plot points
- NOTABLE: References beliefs, spreading stories, or interesting character moments
- BACKGROUND: Mundane daily life, not relevant to player

Respond with JSON:
{
  "shouldVoice": boolean,
  "importance": "background" | "notable" | "critical",
  "reason": "brief explanation"
}
`;
```

### Player-God Communication

When the player (as a god) interacts with a believer:

```typescript
interface DivineCommunication {
  type: 'whisper' | 'vision' | 'omen' | 'manifestation';
  content: string;
  recipient: EntityId;
}

interface BelieverResponse {
  text: string;
  emotion: string;
  voiced: boolean;
  audio?: Blob;
}

async function handleBelieverResponse(
  communication: DivineCommunication,
  believer: Entity
): Promise<BelieverResponse> {
  // LLM generates response based on believer personality
  const responseText = await generateBelieverResponse(communication, believer);

  // Voice the response
  const profile = getVoiceProfile(believer);
  const audio = await pocketTTS.synthesize({
    text: responseText,
    voice: profile,
    emotion: deriveEmotion(believer, communication),
  });

  return {
    text: responseText,
    emotion: deriveEmotion(believer, communication),
    voiced: true,
    audio,
  };
}

function deriveEmotion(believer: Entity, comm: DivineCommunication): string {
  const belief = believer.belief?.strength ?? 0;

  if (comm.type === 'manifestation') {
    return belief > 0.7 ? 'reverent' : 'fearful';
  }
  if (comm.type === 'whisper') {
    return belief > 0.5 ? 'reverent' : 'confused';
  }
  return 'neutral';
}
```

---

## 4. Emergent God Visual Identity

### The Pratchett Principle

In Pratchett's Small Gods, Om discovers that gods don't define themselves - their believers do. The Great God Om was worshipped as a mighty bull, but when belief waned, he became a small tortoise.

**Core mechanic**: The god's visual form emerges from aggregate believer narratives.

### Tracking Believer Perceptions

```typescript
interface GodPerception {
  // What form believers imagine
  animalForm: string;        // 'turtle', 'crocodile', 'eagle', etc.
  humanoidForm?: string;     // Some gods have human aspects

  // Visual attributes
  size: 'tiny' | 'small' | 'medium' | 'large' | 'colossal';
  colors: string[];          // Primary colors in imagery
  symbols: string[];         // Associated symbols

  // Emotional qualities
  temperament: string;       // 'wrathful', 'benevolent', 'mysterious'
  domain: string;            // 'storms', 'harvest', 'wisdom'

  // Strength of this perception
  believers: number;
  conviction: number;        // Average belief strength
}

interface GodIdentity {
  // Aggregate of all perceptions
  perceptions: GodPerception[];

  // Dominant form (most believed)
  dominantForm: GodPerception;

  // Visual consistency seed
  visualSeed: number;

  // Cached portrait
  currentPortrait?: Blob;
}
```

### Form Emergence from Stories

```typescript
function analyzeStoriesForGodForm(
  stories: Story[],
  believers: Entity[]
): GodPerception[] {
  const perceptions = new Map<string, GodPerception>();

  for (const story of stories) {
    // Extract god descriptions from story content
    const forms = extractGodForms(story.currentVersion);

    for (const form of forms) {
      const key = `${form.animalForm}-${form.temperament}`;

      if (!perceptions.has(key)) {
        perceptions.set(key, {
          ...form,
          believers: 0,
          conviction: 0,
        });
      }

      const perception = perceptions.get(key)!;

      // Weight by number of carriers and their belief strength
      const carriers = believers.filter(b =>
        b.knownStories.includes(story.id)
      );

      perception.believers += carriers.length;
      perception.conviction += carriers.reduce(
        (sum, c) => sum + (c.belief?.strength ?? 0), 0
      );
    }
  }

  return Array.from(perceptions.values())
    .sort((a, b) => (b.believers * b.conviction) - (a.believers * a.conviction));
}

// LLM extracts god form from story text
const EXTRACT_GOD_FORM_PROMPT = `
Analyze this story about a god and extract how the god is depicted:

Story: {{storyText}}

Extract (if mentioned):
- Animal form (turtle, snake, eagle, wolf, etc.)
- Size (tiny to colossal)
- Colors associated with the god
- Symbols (lightning, sun, scales, etc.)
- Temperament (wrathful, benevolent, mysterious, etc.)
- Domain (what the god controls/represents)

Return JSON:
{
  "animalForm": string | null,
  "humanoidForm": string | null,
  "size": string | null,
  "colors": string[],
  "symbols": string[],
  "temperament": string | null,
  "domain": string | null
}
`;
```

### Dynamic God Portrait Generation

```typescript
async function generateGodPortrait(identity: GodIdentity): Promise<Blob> {
  const dominant = identity.dominantForm;

  // Build prompt from believer perceptions
  const prompt = buildGodPortraitPrompt(dominant, identity.perceptions);

  return await imageGeneration.generate({
    prompt,
    negative_prompt: 'cute, cartoon, modern, technology',
    seed: identity.visualSeed,
    size: '512x512',
    style: 'divine_entity',
  });
}

function buildGodPortraitPrompt(
  dominant: GodPerception,
  all: GodPerception[]
): string {
  const parts: string[] = [];

  // Primary form
  if (dominant.animalForm) {
    parts.push(`majestic ${dominant.size} ${dominant.animalForm}`);
  }

  // Divine qualities
  parts.push(`divine entity, god of ${dominant.domain}`);
  parts.push(`${dominant.temperament} presence`);

  // Colors
  if (dominant.colors.length > 0) {
    parts.push(`${dominant.colors.join(' and ')} coloring`);
  }

  // Symbols
  if (dominant.symbols.length > 0) {
    parts.push(`surrounded by ${dominant.symbols.join(', ')}`);
  }

  // Secondary influences (minority beliefs add mystery)
  const minorities = all.slice(1, 3);
  for (const minor of minorities) {
    if (minor.believers > dominant.believers * 0.2) {
      parts.push(`hints of ${minor.animalForm} features`);
    }
  }

  // Power level based on total belief
  const totalBelief = all.reduce((sum, p) => sum + p.believers * p.conviction, 0);
  if (totalBelief < 10) {
    parts.push('faint, barely visible, ephemeral');
  } else if (totalBelief < 50) {
    parts.push('translucent, forming, gaining substance');
  } else if (totalBelief < 200) {
    parts.push('solid, powerful, radiant');
  } else {
    parts.push('overwhelming presence, reality-bending, cosmic');
  }

  parts.push('fantasy art, painterly style, divine lighting, ethereal');

  return parts.join(', ');
}
```

### Form Evolution Over Time

```typescript
interface FormTransition {
  from: GodPerception;
  to: GodPerception;
  progress: number;  // 0-1

  // Transitional portrait blending old and new
  transitionalPortrait?: Blob;
}

async function handleFormEvolution(
  identity: GodIdentity,
  newPerceptions: GodPerception[]
): Promise<void> {
  const newDominant = newPerceptions[0];

  // Check if dominant form is changing
  if (newDominant.animalForm !== identity.dominantForm.animalForm) {
    // Gradual transition based on belief momentum
    const transition: FormTransition = {
      from: identity.dominantForm,
      to: newDominant,
      progress: calculateTransitionProgress(identity, newDominant),
    };

    // Generate transitional portrait (blend of old and new)
    transition.transitionalPortrait = await generateTransitionalPortrait(
      identity,
      transition
    );

    // Narrative event: believers notice the god changing
    emitNarrativeEvent({
      type: 'god_form_shifting',
      description: `The faithful begin to see ${identity.name} differently. Where once they saw a ${transition.from.animalForm}, some now speak of a ${transition.to.animalForm}...`,
    });
  }

  identity.perceptions = newPerceptions;
  identity.dominantForm = newDominant;
}
```

---

## 5. Implementation Architecture

### Service Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                        Game Client                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │   Map    │  │ Portrait │  │  Voice   │  │   God    │        │
│  │ Renderer │  │  Cache   │  │  Player  │  │ Identity │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       │             │             │             │               │
├───────┴─────────────┴─────────────┴─────────────┴───────────────┤
│                     MCP Server Interface                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Map Generation│  │   Portrait   │  │    Voice     │          │
│  │    Service   │  │   Service    │  │   Service    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  ┌──────────────────────────────────────────────────────┐      │
│  │              AI Service Providers                     │      │
│  │  (Stability AI / ComfyUI / Kyutai Pocket TTS)        │      │
│  └──────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

### Resource Management

```typescript
interface VisualResourceBudget {
  // Map generation
  mapRegenerationsPerHour: number;      // Limit AI calls
  maxDirtyTilesBeforeRegen: number;     // Batch threshold

  // Portraits
  portraitsPerSession: number;          // New NPC portraits
  portraitRegenerationsPerHour: number; // Age/event updates

  // Voice
  voicedConversationsPerHour: number;   // TTS calls
  maxVoiceLineLengthChars: number;      // Truncate long lines

  // God identity
  godPortraitUpdatesPerHour: number;    // Identity shifts
}

const DEFAULT_BUDGET: VisualResourceBudget = {
  mapRegenerationsPerHour: 10,
  maxDirtyTilesBeforeRegen: 20,
  portraitsPerSession: 50,
  portraitRegenerationsPerHour: 20,
  voicedConversationsPerHour: 30,
  maxVoiceLineLengthChars: 200,
  godPortraitUpdatesPerHour: 5,
};
```

### Fallback Rendering

When AI generation unavailable or budget exceeded:

```typescript
interface FallbackRendering {
  // Map: Use skeleton tiles directly with color overlay
  mapFallback: 'skeleton_only' | 'skeleton_tinted';

  // Portraits: Use procedural pixel art or emoji
  portraitFallback: 'pixel_procedural' | 'emoji_placeholder';

  // Voice: Show text only
  voiceFallback: 'text_only' | 'simple_beeps';

  // God: Use emoji or simple shape
  godFallback: 'emoji' | 'glow_shape';
}
```

---

## 6. Asset Sources and Licensing

### Skeleton Tiles

- **route1rodent's Isometric Sandbox**: https://route1rodent.itch.io/isometric-sandbox-pixel-world-32x32
  - Clean, consistent isometric tiles
  - Good structural reference for AI
  - Check license for commercial use

### Alternative Tile Sources

- **Kenney Assets**: https://kenney.nl/assets (CC0)
- **OpenGameArt**: https://opengameart.org (various licenses)
- **itch.io**: Search "isometric tileset" (various licenses)

### AI Image Generation

- **Stability AI**: SDXL, ControlNet support
- **Replicate**: Various models including SDXL
- **ComfyUI**: Self-hosted, full control
- **AUTOMATIC1111**: Self-hosted alternative

### TTS

- **Kyutai Pocket TTS**: Lightweight, fast
- **Coqui TTS**: Open source alternative
- **ElevenLabs**: Higher quality, paid
