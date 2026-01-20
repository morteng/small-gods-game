# Dynamic World System

Supporting any event the LLM can imagine.

---

## The Challenge

The LLM is the GM. It might generate:
- Floods covering farmland
- Fire spreading through forest
- Rain of frogs on the village
- Locust swarms devouring crops
- Aurora borealis as an omen
- Blood-red moon
- Spontaneous flowers blooming
- Ghostly processions
- Rivers running backward

We can't predefine all possibilities. The system must be **extensible by the LLM itself**.

---

## Architecture: Effects as Overlays

Instead of hardcoding event types, use a flexible **effect layer** on top of the base map.

```
┌─────────────────────────────────────┐
│         RENDERING LAYER             │
│  (what the player sees)             │
├─────────────────────────────────────┤
│         EFFECT LAYER                │  ← Dynamic, LLM-controlled
│  (temporary overlays, modifiers)    │
├─────────────────────────────────────┤
│         STRUCTURE LAYER             │
│  (buildings, shrines)               │
├─────────────────────────────────────┤
│         TERRAIN LAYER               │  ← Static base
│  (water, forest, farmland)          │
└─────────────────────────────────────┘
```

---

## Effect Data Model

```typescript
interface TileEffect {
  id: EffectId;
  type: string;           // Freeform: "flood", "fire", "frogs", "glow", etc.

  // Scope
  tiles: TileCoord[];     // Which tiles affected
  intensity: number;      // 0-1, how severe

  // Timing
  startTurn: number;
  duration: number;       // Turns, or -1 for permanent until removed
  decayRate: number;      // How fast intensity decreases

  // Visual
  emoji: string;          // Primary emoji to overlay
  description: string;    // LLM-generated description
  visualStyle: VisualStyle;

  // Gameplay
  effects: GameplayEffect[];

  // Meta
  source: "god" | "natural" | "supernatural" | "unknown";
  associatedGod: GodId | null;
}

interface VisualStyle {
  mode: "replace" | "overlay" | "border" | "animate";
  color?: string;         // Tint color if supported
  opacity?: number;       // For overlay mode
  animation?: "pulse" | "flicker" | "wave" | "none";
}

interface GameplayEffect {
  type: EffectType;
  value: number;
  target: "tile" | "villagers_here" | "crops" | "buildings";
}

type EffectType =
  | "damage"              // Harms health
  | "heal"                // Restores health
  | "fertility"           // Affects crop yield
  | "movement_block"      // Can't pass through
  | "belief_modifier"     // Affects belief calculations
  | "fear"                // Increases fear
  | "wonder"              // Increases wonder/openness
  | "prosperity"          // General good fortune
  | "blight";             // General misfortune
```

---

## LLM Event Generation

The LLM generates events with structured effect descriptions:

### Event Generation Prompt

```
SYSTEM:
You are the world-soul generating events for Small Gods.
You can create ANY event that fits the narrative.

WORLD STATE:
{world.summary}
- Season: {world.season}
- Recent divine activity: {god.recentActions}
- Current tensions: {world.tensions}
- Villager concerns: {world.villagerConcerns}

TASK:
Generate 0-2 events for this turn. You have complete creative
freedom - floods, plagues, miracles, omens, strange phenomena.

For each event, provide:

EVENT:
  name: [Short evocative name]
  description: [2-3 sentence narrative description]
  type: [natural/supernatural/omen/disaster/blessing/strange]

  EFFECTS:
    - tiles: [list of coords or "village" or "farmland" or "forest"]
      emoji: [single emoji to represent this effect]
      type: [flood/fire/blight/blessing/creature/phenomenon/etc]
      intensity: [0.0-1.0]
      duration: [turns, or "permanent" or "until_resolved"]
      visual_mode: [replace/overlay/border]
      gameplay:
        - effect: [damage/heal/fertility/etc]
          value: [number]
          target: [tile/villagers/crops/buildings]
      description: [what it looks like on these tiles]

  STORY_SEED:
    potential_interpretations:
      - [How believers might see this]
      - [How skeptics might see this]
    themes: [list of narrative themes]

EXAMPLES:

EVENT:
  name: "The Creeping Flood"
  description: "Heavy rains upstream have swollen the river. Water
    seeps across the low farmland, threatening the harvest."
  type: natural

  EFFECTS:
    - tiles: [[3,4], [3,5], [4,4], [4,5], [5,5]]
      emoji: "🌊"
      type: "flood"
      intensity: 0.6
      duration: 8
      visual_mode: overlay
      gameplay:
        - effect: fertility
          value: -0.3
          target: crops
        - effect: movement_block
          value: 0.5
          target: tile
      description: "Murky floodwater covers the fields, crops half-submerged"

---

EVENT:
  name: "Rain of Frogs"
  description: "At dawn, frogs fall from a cloudless sky. They land
    on rooftops, in cooking pots, on sleeping children. By noon,
    they've hopped away, but the village is shaken."
  type: strange

  EFFECTS:
    - tiles: "village"
      emoji: "🐸"
      type: "creature_rain"
      intensity: 0.8
      duration: 1
      visual_mode: overlay
      gameplay:
        - effect: wonder
          value: 0.4
          target: villagers_here
        - effect: fear
          value: 0.2
          target: villagers_here
      description: "Frogs everywhere, hopping between houses"

  STORY_SEED:
    potential_interpretations:
      - "A sign from the gods - but what does it mean?"
      - "Just a strange weather phenomenon, nothing more"
      - "The old stories speak of frog rain before great changes"
    themes: [omen, wonder, uncertainty]
```

---

## Effect Registry (Extensible)

We maintain a registry of known effects for consistent rendering, but the LLM can create new ones.

```typescript
interface EffectTemplate {
  type: string;
  defaultEmoji: string;
  defaultDuration: number;
  defaultGameplayEffects: GameplayEffect[];
  renderingHints: RenderingHint[];
}

const KNOWN_EFFECTS: Record<string, EffectTemplate> = {
  flood: {
    type: "flood",
    defaultEmoji: "🌊",
    defaultDuration: 10,
    defaultGameplayEffects: [
      { type: "fertility", value: -0.3, target: "crops" },
      { type: "movement_block", value: 0.5, target: "tile" }
    ],
    renderingHints: ["animate:wave", "overlay:blue"]
  },

  fire: {
    type: "fire",
    defaultEmoji: "🔥",
    defaultDuration: 3,
    defaultGameplayEffects: [
      { type: "damage", value: 0.3, target: "buildings" },
      { type: "damage", value: 0.2, target: "villagers_here" }
    ],
    renderingHints: ["animate:flicker", "spread:true"]
  },

  blight: {
    type: "blight",
    defaultEmoji: "🦠",
    defaultDuration: 15,
    defaultGameplayEffects: [
      { type: "fertility", value: -0.5, target: "crops" }
    ],
    renderingHints: ["overlay:sickly_green"]
  },

  blessing: {
    type: "blessing",
    defaultEmoji: "✨",
    defaultDuration: 20,
    defaultGameplayEffects: [
      { type: "fertility", value: 0.3, target: "crops" },
      { type: "prosperity", value: 0.2, target: "tile" }
    ],
    renderingHints: ["animate:pulse", "overlay:gold"]
  },

  // ... many more
};

// When LLM creates unknown effect, use sensible defaults
function getEffectTemplate(type: string): EffectTemplate {
  if (KNOWN_EFFECTS[type]) {
    return KNOWN_EFFECTS[type];
  }

  // Unknown effect - LLM must provide all details
  return {
    type,
    defaultEmoji: "❓",
    defaultDuration: 5,
    defaultGameplayEffects: [],
    renderingHints: []
  };
}
```

---

## Map Rendering with Effects

```typescript
class DynamicMapRenderer {
  constructor(
    private world: WorldState,
    private effects: TileEffect[]
  ) {}

  renderTile(x: number, y: number): string {
    const tile = this.world.map.tiles[y][x];
    const effectsHere = this.getEffectsAt(x, y);

    // No effects - render normally
    if (effectsHere.length === 0) {
      return this.renderBaseTile(tile);
    }

    // Sort effects by intensity (strongest wins for 'replace' mode)
    const sorted = effectsHere.sort((a, b) => b.intensity - a.intensity);
    const primary = sorted[0];

    switch (primary.visualStyle.mode) {
      case "replace":
        // Effect completely replaces tile appearance
        return primary.emoji;

      case "overlay":
        // Show effect emoji (base tile implied)
        return primary.emoji;

      case "border":
        // Keep base tile, border shown separately
        return this.renderBaseTile(tile); // Border handled in CSS

      case "animate":
        // Return with animation marker
        return `<span class="animate-${primary.visualStyle.animation}">${primary.emoji}</span>`;

      default:
        return primary.emoji;
    }
  }

  renderMap(): string {
    let html = '<div class="world-map">';

    for (let y = 0; y < this.world.map.height; y++) {
      html += '<div class="row">';
      for (let x = 0; x < this.world.map.width; x++) {
        const classes = this.getTileClasses(x, y);
        const content = this.renderTile(x, y);
        html += `<span class="tile ${classes}" data-x="${x}" data-y="${y}">${content}</span>`;
      }
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  private getTileClasses(x: number, y: number): string {
    const effects = this.getEffectsAt(x, y);
    const classes: string[] = [];

    for (const effect of effects) {
      classes.push(`effect-${effect.type}`);

      if (effect.visualStyle.animation) {
        classes.push(`anim-${effect.visualStyle.animation}`);
      }

      // Intensity classes for CSS styling
      if (effect.intensity > 0.7) classes.push("intensity-high");
      else if (effect.intensity > 0.4) classes.push("intensity-medium");
      else classes.push("intensity-low");
    }

    return classes.join(" ");
  }

  private getEffectsAt(x: number, y: number): TileEffect[] {
    return this.effects.filter(e =>
      e.tiles.some(t => t.x === x && t.y === y)
    );
  }
}
```

---

## Effect Processing Each Turn

```typescript
async function processEffects(world: WorldState, llm: LLMClient): Promise<void> {
  const activeEffects = world.effects.filter(e => isEffectActive(e, world.turn));

  for (const effect of activeEffects) {
    // Apply gameplay effects
    for (const ge of effect.effects) {
      applyGameplayEffect(effect, ge, world);
    }

    // Decay intensity
    effect.intensity -= effect.decayRate;

    // Check for spread (fire, flood, blight)
    if (shouldSpread(effect)) {
      const newTiles = await determineSpread(effect, world, llm);
      effect.tiles.push(...newTiles);
    }

    // Check for end
    if (effect.intensity <= 0 || isExpired(effect, world.turn)) {
      effect.status = "ended";

      // Generate ending narrative
      const ending = await llm.generate(`
        The effect "${effect.type}" at ${effect.tiles} is ending.
        Describe how it concludes in 1-2 sentences.
      `);

      world.eventLog.push({
        turn: world.turn,
        type: "effect_ended",
        description: ending
      });
    }
  }

  // Remove ended effects
  world.effects = world.effects.filter(e => e.status !== "ended");
}

function applyGameplayEffect(
  tileEffect: TileEffect,
  ge: GameplayEffect,
  world: WorldState
): void {
  switch (ge.target) {
    case "villagers_here":
      const villagersAffected = world.villagers.filter(v =>
        tileEffect.tiles.some(t =>
          t.x === v.currentLocation.x && t.y === v.currentLocation.y
        )
      );

      for (const v of villagersAffected) {
        switch (ge.type) {
          case "damage":
            v.health -= ge.value * tileEffect.intensity;
            break;
          case "heal":
            v.health = Math.min(1, v.health + ge.value * tileEffect.intensity);
            break;
          case "fear":
            v.personality.fearfulness += ge.value * 0.1;
            break;
          case "wonder":
            v.personality.curiosity += ge.value * 0.1;
            // Wonder can increase belief
            v.belief.strength += ge.value * 0.05;
            break;
        }
      }
      break;

    case "crops":
      for (const tile of tileEffect.tiles) {
        const t = world.map.tiles[tile.y][tile.x];
        if (t.terrain === "farmland") {
          t.fertility = (t.fertility || 1) + ge.value * tileEffect.intensity;
        }
      }
      break;

    case "buildings":
      for (const tile of tileEffect.tiles) {
        const t = world.map.tiles[tile.y][tile.x];
        if (t.structure) {
          t.structure.condition -= ge.value * tileEffect.intensity;
          if (t.structure.condition <= 0) {
            // Building destroyed
            world.eventLog.push({
              turn: world.turn,
              type: "building_destroyed",
              location: tile,
              structure: t.structure.type
            });
            t.structure = null;
          }
        }
      }
      break;
  }
}
```

---

## Spreading Effects

Some effects spread (fire, flood, blight):

```typescript
async function determineSpread(
  effect: TileEffect,
  world: WorldState,
  llm: LLMClient
): Promise<TileCoord[]> {
  // Only certain types spread
  const spreadingTypes = ["fire", "flood", "blight", "plague"];
  if (!spreadingTypes.includes(effect.type)) {
    return [];
  }

  // Ask LLM if/how it spreads
  const response = await llm.generate(`
    EFFECT: ${effect.type} at intensity ${effect.intensity}
    CURRENT TILES: ${JSON.stringify(effect.tiles)}
    ADJACENT TERRAIN: ${getAdjacentTerrain(effect.tiles, world.map)}
    WIND/WEATHER: ${world.weather}

    Should this effect spread? If so, to which adjacent tiles?
    Consider:
    - Fire spreads to forest, not water
    - Flood spreads to low terrain
    - Blight spreads to farmland

    OUTPUT:
    SPREADS: [yes/no]
    NEW_TILES: [[x,y], ...] or []
    REASON: [brief explanation]
  `);

  const parsed = parseSpreadResponse(response);

  if (parsed.spreads && parsed.newTiles.length > 0) {
    // Create spread narrative
    world.eventLog.push({
      turn: world.turn,
      type: "effect_spreads",
      effect: effect.type,
      reason: parsed.reason
    });
  }

  return parsed.newTiles;
}
```

---

## Player Interaction with Effects

Players can try to counter effects:

```typescript
// New miracle types for effect interaction
const COUNTER_MIRACLES = {
  rain: {
    counters: ["fire", "drought"],
    creates: "blessed_rain",
    description: "Rain quenches flames and nourishes crops"
  },

  sun: {
    counters: ["flood", "blight"],
    creates: "blessed_light",
    description: "Blessed sunlight dries floods and purifies blight"
  },

  protection: {
    counters: ["any_harmful"],
    creates: "divine_shield",
    description: "A protective barrier wards off harm"
  }
};

async function handleCounterMiracle(
  miracle: Miracle,
  targetEffect: TileEffect,
  world: WorldState,
  llm: LLMClient
): Promise<ActionResult> {
  const counter = COUNTER_MIRACLES[miracle.type];

  if (!counter.counters.includes(targetEffect.type) &&
      !(counter.counters.includes("any_harmful") && isHarmful(targetEffect))) {
    return {
      success: false,
      narrative: "This miracle cannot counter that effect."
    };
  }

  // Reduce or remove the effect
  const effectiveness = miracle.scale_factor * god.power / 100;
  targetEffect.intensity -= effectiveness;

  // Generate narrative
  const narrative = await llm.generate(`
    The god performs a ${miracle.type} miracle to counter ${targetEffect.type}.
    Effectiveness: ${Math.round(effectiveness * 100)}%
    Remaining intensity: ${Math.round(targetEffect.intensity * 100)}%

    Describe what the villagers see in 2-3 sentences.
  `);

  return {
    success: true,
    narrative,
    storiesCreated: await generateMiracleStories(miracle, witnesses, world, llm)
  };
}
```

---

## Weather System

Weather affects events and is itself LLM-driven:

```typescript
interface Weather {
  type: string;           // "clear", "rainy", "stormy", "drought", etc.
  emoji: string;          // ☀️ 🌧️ ⛈️ 🌫️ etc.
  intensity: number;      // 0-1
  duration: number;       // Turns remaining
  effects: WeatherEffect[];
}

async function generateWeather(
  world: WorldState,
  llm: LLMClient
): Promise<Weather> {
  const response = await llm.generate(`
    SEASON: ${world.season}
    PREVIOUS WEATHER: ${world.weather.type} for ${world.weather.duration} turns
    RECENT EVENTS: ${world.recentEvents.map(e => e.type).join(", ")}
    DIVINE ACTIVITY: ${world.god.recentMiracles.map(m => m.type).join(", ")}

    Generate weather for the next period.
    Consider seasonal norms, but allow for unusual weather
    especially if divine activity might influence it.

    OUTPUT:
    TYPE: [weather type]
    EMOJI: [single emoji]
    INTENSITY: [0.0-1.0]
    DURATION: [turns]
    DESCRIPTION: [1 sentence]
    EFFECTS:
      - [effect on gameplay]
  `);

  return parseWeatherResponse(response);
}
```

---

## Celestial Events

Big omen-worthy events:

```typescript
interface CelestialEvent {
  type: string;           // "blood_moon", "eclipse", "comet", "aurora"
  emoji: string;
  visibility: "all" | "region" | TileCoord[];
  duration: number;
  beliefImpact: number;   // How much it affects belief/wonder
  storyPotential: number; // Likelihood of generating stories
}

const CELESTIAL_EVENTS = {
  blood_moon: {
    emoji: "🌑",
    rarity: 0.01,
    beliefImpact: 0.3,
    interpretations: [
      "An omen of doom",
      "The gods are angry",
      "A sign of coming change",
      "Just a natural phenomenon"
    ]
  },

  comet: {
    emoji: "☄️",
    rarity: 0.005,
    beliefImpact: 0.4,
    interpretations: [
      "A messenger from the gods",
      "A harbinger of war or death",
      "A blessing streaking across the sky",
      "A natural wanderer of the heavens"
    ]
  },

  aurora: {
    emoji: "🌌",
    rarity: 0.02,
    beliefImpact: 0.2,
    interpretations: [
      "The gods dancing in the sky",
      "Spirits of ancestors",
      "Divine light made visible",
      "Strange lights, cause unknown"
    ]
  }
};
```

---

## Example: Complex Event Sequence

The LLM might generate a multi-stage event:

```
Turn 45: LLM generates "dark clouds gathering" (omen)
Turn 46: LLM generates "storm breaks" (weather change)
Turn 47: Storm intensifies, player does nothing
Turn 48: LLM generates "flooding begins" (effect starts)
Turn 49: Player performs rain-stopping miracle
Turn 50: Flood recedes, miracle stories spread
Turn 51: LLM generates "rainbow appears" (resolution omen)
```

Each stage builds on the last, creating a narrative arc that the player can influence.

---

## Rendering Examples

### Flood Spreading

```
Turn 1:              Turn 3:              Turn 5:
🌾🌾🌾🏠🌾          🌾🌾🌾🏠🌾          🌊🌊🌾🏠🌾
🌾🌾🌊🌾🌾          🌾🌊🌊🌊🌾          🌊🌊🌊🌊🌾
🌾🌊🌊🌊🌾          🌊🌊🌊🌊🌊          🌊🌊🌊🌊🌊
🌊🌊🌊🌊🌊          🌊🌊🌊🌊🌊          🌊🌊🌊🌊🌊
```

### Fire + Rain Miracle

```
Before miracle:      After miracle:
🌳🔥🔥🌳            🌳💨🌧️🌳
🌳🔥🔥🔥🌳          🌳💨🌧️💨🌳
🌳🌳🔥🌳🌳          🌳🌳🌧️🌳🌳

💨 = smoke/steam
🌧️ = rain putting out fire
```

### Blight on Farmland

```
Healthy:             Blighted:
🌾🌾🌾🌾🌾          🌾🦠🦠🌾🌾
🌾🌾🌾🌾🌾          🦠🦠🦠🦠🌾
🌾🌾🌾🌾🌾          🌾🦠🦠🌾🌾
```

---

## Implementation Notes

1. **Effect priority:** When multiple effects overlap, highest intensity wins for display
2. **Performance:** Cache effect lookups per tile
3. **Persistence:** Effects survive across turns until duration expires
4. **LLM consistency:** Store effect descriptions to maintain narrative coherence
5. **Player agency:** Always give players ways to interact with/counter effects

---

*Document version: 0.1*
