# Data Models

Core data structures for Small Gods.

---

## World State

```typescript
interface WorldState {
  // Time
  turn: number;
  year: number;
  season: "spring" | "summer" | "autumn" | "winter";
  generation: number;

  // Geography
  map: TileMap;
  locations: Location[];

  // Population
  villagers: Villager[];
  socialGraph: Relationship[];

  // Narrative
  stories: Story[];
  events: WorldEvent[];

  // Divine
  gods: God[];  // For future multiplayer; MVP has one
  shrines: Shrine[];

  // Meta
  seed: number;
  settings: GameSettings;
}
```

---

## Tile Map

```typescript
interface TileMap {
  width: number;
  height: number;
  tiles: Tile[][];
}

interface Tile {
  x: number;
  y: number;
  terrain: TerrainType;
  structure: Structure | null;
  villagers: VillagerId[];  // who's here
  blessed: GodId | null;
  cursed: GodId | null;
}

type TerrainType =
  | "water"      // 🌊
  | "forest"     // 🌳
  | "mountain"   // ⛰️
  | "peak"       // 🏔️
  | "farmland"   // 🌾
  | "desert"     // 🏜️
  | "swamp"      // 🌿
  | "plains";    // 🟫

type Structure =
  | { type: "house"; owner: VillagerId }      // 🏠
  | { type: "shrine"; god: GodId }            // 🏛️
  | { type: "village_center" }                // 🏘️
  | { type: "market" }                        // 🛒
  | { type: "sacred_stone" }                  // 🪨
  | { type: "ruins" };                        // 🏚️

// Emoji rendering
const TERRAIN_EMOJI: Record<TerrainType, string> = {
  water: "🌊",
  forest: "🌳",
  mountain: "⛰️",
  peak: "🏔️",
  farmland: "🌾",
  desert: "🏜️",
  swamp: "🌿",
  plains: "·",
};
```

---

## Villager

```typescript
interface Villager {
  id: VillagerId;
  name: string;
  age: number;
  gender: "male" | "female" | "other";
  isAlive: boolean;

  // Location
  homeLocation: TileCoord;
  currentLocation: TileCoord;

  // Belief (the core!)
  belief: BeliefState;

  // Personality (affects everything)
  personality: Personality;

  // Background & Education (affects credulity)
  background: Background;
  education: Education;
  hasTraveled: boolean;

  // Credulity (how easily they believe stories)
  credulity: Credulity;

  // Reputation & Trust
  reputation: number;           // 0-1, community trust in them as source
  knownLies: number;            // Times caught in falsehood

  // Social
  relationships: VillagerRelationship[];
  socialRole: SocialRole;

  // Knowledge
  knownStories: StoryId[];
  witnessedEvents: EventId[];
  witnessedMiracles: WitnessRecord[];    // Direct evidence

  // Life experience (affects credulity)
  majorLosses: number;          // Tragedies suffered
  nearDeathSaved: boolean;      // Survived when shouldn't have
  deceivedByProphet: boolean;   // Burned by false belief
  unansweredPrayers: number;    // Prayers that went unanswered

  // Credence modifiers (temporary/contextual)
  credenceModifiers: Record<GodId, CredenceModifier>;

  // Biography (LLM-generated, updated over time)
  biography: string;
  recentThoughts: string;  // Updated each turn

  // Physical
  health: number;  // 0-1
  traits: PhysicalTrait[];

  // Life events
  birthTurn: number;
  deathTurn: number | null;
  causeOfDeath: string | null;
}

interface WitnessRecord {
  eventId: EventId;
  godId: GodId;
  turn: number;
  description: string;
}

interface CredenceModifier {
  type: "eyewitness" | "personal_experience" | "disappointment" | "verified" | "contradicted";
  value: number;       // Multiplier
  reason: string;
  turn: number;        // When acquired
  expires?: number;    // Optional expiry turn
}

interface BeliefState {
  // Who they worship (if anyone)
  target: GodId | null;

  // How strongly (0 = atheist, 1 = fanatic)
  strength: number;

  // Quality of belief
  type: BeliefType;

  // Tracks exposure to different gods' stories
  exposure: Record<GodId, number>;

  // Recent belief changes (for debugging/display)
  history: BeliefChange[];
}

type BeliefType =
  | "genuine"     // True faith, full power contribution
  | "habitual"    // Going through motions, reduced power
  | "fearful"     // Believes in institution, negative power
  | "curious"     // Open but uncommitted
  | "skeptic"     // Resistant to belief
  | "heretic";    // Actively opposes, drains power

interface Personality {
  // Core traits (0-1 scale)
  skepticism: number;     // Resistance to belief
  piety: number;          // Natural inclination to faith
  storytelling: number;   // How often they share stories
  curiosity: number;      // Openness to new ideas
  fearfulness: number;    // Susceptibility to fear
  stubbornness: number;   // Resistance to change
  empathy: number;        // Affected by others' emotions
  honesty: number;        // Truthfulness (affects reliability as story source)

  // Derived behaviors
  get believability(): number;  // How easily they believe
  get influence(): number;      // How much others listen
}

interface Credulity {
  base: number;           // General credulity (0-1)
  miraculous: number;     // For miraculous claims (0-1.5)
  evidenced: number;      // When evidence present (0-1.5)
}

type Education = "none" | "basic" | "learned" | "scholar";

type Background =
  | "farmer"
  | "herder"
  | "fisher"
  | "craftsman"
  | "trader"
  | "healer"
  | "elder"
  | "child"
  | "traveler"
  | "scholar"
  | "priest";

type SocialRole =
  | "child"
  | "farmer"
  | "herder"
  | "fisher"
  | "healer"
  | "elder"
  | "trader"
  | "craftsman"
  | "storyteller"   // Special role: bonus to story spread
  | "skeptic"       // Social role, not just belief type
  | "prophet";      // Player-empowered

interface VillagerRelationship {
  target: VillagerId;
  type: RelationType;
  strength: number;  // 0-1
}

type RelationType =
  | "parent"
  | "child"
  | "sibling"
  | "spouse"
  | "friend"
  | "rival"
  | "mentor"
  | "student"
  | "neighbor";

type PhysicalTrait =
  | "strong"
  | "weak"
  | "tall"
  | "short"
  | "scarred"
  | "beautiful"
  | "elderly_appearance"
  | "birthmark";  // Potential divine sign
```

---

## Story

```typescript
interface Story {
  id: StoryId;
  name: string;
  type: StoryType;

  // What actually happened
  trueEvents: TrueEvent[];

  // Current narrative form
  currentTelling: string;

  // Mutation history
  versions: StoryVersion[];

  // Who knows this
  carriers: VillagerId[];

  // Metrics
  generations: number;     // Times retold
  fidelity: number;        // 0-1, similarity to truth
  influence: number;       // Belief impact when told
  themes: string[];        // Semantic tags

  // Associated deity
  associatedGod: GodId | null;

  // Status
  status: "active" | "endangered" | "dead" | "revived";
  lastToldTurn: number;

  // Creation metadata
  createdTurn: number;
  originalWitness: VillagerId;
}

type StoryType =
  | "miracle"
  | "disaster"
  | "origin"
  | "hero"
  | "warning"
  | "prophecy";

interface TrueEvent {
  turn: number;
  action: string;
  actor: "god" | VillagerId | "world";
  target: VillagerId | TileCoord | null;
  details: Record<string, any>;
  witnesses: VillagerId[];
}

interface StoryVersion {
  generation: number;
  teller: VillagerId;
  listener: VillagerId;
  turn: number;
  text: string;
  fidelityAtTime: number;
  context: string;  // Why it was told
}

interface StoryTelling {
  story: StoryId;
  teller: VillagerId;
  listener: VillagerId;
  turn: number;
  setting: TellingContext;
  resultingVersion: StoryVersion;
}

type TellingContext =
  | "fireside"       // Intimate, personal
  | "gathering"      // Public, formal
  | "teaching"       // Parent to child
  | "warning"        // Cautionary context
  | "celebration"    // Festival/ritual
  | "grief"          // Death/disaster
  | "curiosity";     // Someone asked
```

---

## God (Player)

```typescript
interface God {
  id: GodId;
  isPlayer: boolean;

  // Power
  power: number;
  powerTier: PowerTier;

  // Identity (emergent from stories)
  knownNames: string[];        // What people call you
  domains: string[];           // What you're god "of"
  personality: GodPersonality; // How you've acted

  // Followers
  believers: VillagerId[];
  shrines: ShrineId[];

  // Abilities
  availableAbilities: Ability[];
  cooldowns: Record<AbilityId, number>;

  // History
  miraclesPerformed: MiracleRecord[];
  turnsExisted: number;

  // Status
  status: "active" | "fading" | "dormant" | "dead";
  turnsUntilFade: number | null;  // If power is 0
}

type PowerTier =
  | "fading"     // 🐢 0-10
  | "stirring"   // 🦎 11-30
  | "rising"     // 🐍 31-100
  | "ascendant"  // 🐉 101-300
  | "divine";    // ⚡ 301+

interface GodPersonality {
  // Derived from actions taken
  merciful: number;      // Healing, blessing
  wrathful: number;      // Cursing, smiting
  mysterious: number;    // Subtle actions
  interventionist: number; // Frequent miracles
  distant: number;       // Rare actions
}

interface Ability {
  id: AbilityId;
  name: string;
  type: AbilityType;
  powerCost: number;
  minTier: PowerTier;
  cooldown: number;  // Turns
  description: string;
}

type AbilityType =
  | "whisper"
  | "miracle"
  | "bless"
  | "curse"
  | "manifest"
  | "prophet";

interface MiracleRecord {
  turn: number;
  type: string;
  target: VillagerId | TileCoord | null;
  powerSpent: number;
  witnesses: VillagerId[];
  storiesCreated: StoryId[];
  beliefImpact: number;
}
```

---

## Shrine

```typescript
interface Shrine {
  id: ShrineId;
  god: GodId;
  location: TileCoord;

  // Status
  condition: number;  // 0-1, degrades without maintenance
  age: number;        // Turns since built

  // Effects
  beliefRadius: number;      // Tiles affected
  beliefBonus: number;       // % boost to nearby villagers
  storyTellingBonus: number; // More stories told here

  // History
  builtTurn: number;
  builtBy: VillagerId | "miracle";
  offerings: Offering[];
}

interface Offering {
  turn: number;
  offerer: VillagerId;
  type: "food" | "craft" | "prayer" | "sacrifice";
  value: number;
}
```

---

## World Events

```typescript
interface WorldEvent {
  id: EventId;
  turn: number;
  type: EventType;

  // What happened
  description: string;
  affectedTiles: TileCoord[];
  affectedVillagers: VillagerId[];

  // Consequences
  deaths: VillagerId[];
  injuries: VillagerId[];
  propertyDamage: TileCoord[];

  // Narrative
  storiesGenerated: StoryId[];
  playerResponded: boolean;
  playerResponse: string | null;
}

type EventType =
  // Natural
  | "drought"
  | "flood"
  | "earthquake"
  | "storm"
  | "wildfire"
  | "bountiful_harvest"
  | "plague"
  | "famine"

  // Social
  | "birth"
  | "death"
  | "marriage"
  | "conflict"
  | "trader_arrival"
  | "migration"

  // Supernatural
  | "rival_god_act"
  | "omen"
  | "vision"
  | "monster";

interface ScheduledEvent {
  turn: number;
  type: EventType;
  probability: number;  // May or may not happen
  parameters: Record<string, any>;
}
```

---

## Game Settings

```typescript
interface GameSettings {
  // Difficulty
  startingPower: number;
  beliefDecayRate: number;
  storyMutationRate: number;
  eventFrequency: number;

  // World size
  mapWidth: number;
  mapHeight: number;
  startingVillagers: number;

  // Time
  turnsPerYear: number;
  yearsPerGeneration: number;

  // Victory
  victoryCondition: VictoryCondition | null;
  turnsToPlay: number | null;  // Endless if null

  // LLM
  llmModel: string;
  llmTemperature: number;
  llmMaxTokens: number;
}

type VictoryCondition =
  | { type: "survival"; generations: number }
  | { type: "dominion"; believers: number }
  | { type: "truth"; minFidelity: number; generations: number }
  | { type: "mystery"; maxFidelity: number; believers: number }
  | { type: "ascension"; powerLevel: number }
  | { type: "legacy"; stories: number; generations: number };
```

---

## Action Types (Player Commands)

```typescript
// Player actions exposed via MCP tools

interface WhisperAction {
  type: "whisper";
  target: VillagerId;
  message: string;
}

interface MiracleAction {
  type: "miracle";
  miracleType: MiracleType;
  target: VillagerId | TileCoord;
  scale: "tiny" | "small" | "medium" | "large";
}

type MiracleType =
  | "rain"
  | "sun"
  | "healing"
  | "fertility"
  | "protection"
  | "destruction"
  | "vision"
  | "sign";

interface BlessAction {
  type: "bless";
  target: VillagerId | TileCoord | "crops" | "livestock";
  duration: number;  // Turns
}

interface CurseAction {
  type: "curse";
  target: VillagerId | TileCoord;
  curseType: "misfortune" | "illness" | "barren" | "haunted";
}

interface ManifestAction {
  type: "manifest";
  form: "dream" | "apparition" | "animal" | "avatar";
  target: VillagerId;
  message: string | null;
}

interface ProphetAction {
  type: "empower_prophet";
  target: VillagerId;
}

interface ObserveAction {
  type: "observe";
  focus: "world" | "villager" | "story" | "shrine";
  targetId?: string;
}

interface WaitAction {
  type: "wait";
  turns: number;
}

type PlayerAction =
  | WhisperAction
  | MiracleAction
  | BlessAction
  | CurseAction
  | ManifestAction
  | ProphetAction
  | ObserveAction
  | WaitAction;
```

---

## Action Results

```typescript
interface ActionResult {
  success: boolean;
  powerSpent: number;
  narrative: string;  // LLM-generated description

  // Effects
  beliefChanges: BeliefChange[];
  storiesCreated: Story[];
  eventsTriggered: WorldEvent[];

  // For display
  affectedVillagers: VillagerSummary[];
  warnings: string[];
}

interface BeliefChange {
  villager: VillagerId;
  before: number;
  after: number;
  reason: string;
}

interface VillagerSummary {
  id: VillagerId;
  name: string;
  reaction: string;  // LLM-generated
}
```

---

## Save Game Format

```typescript
interface SaveGame {
  version: string;
  timestamp: Date;
  name: string;

  // Full state
  world: WorldState;

  // Metadata
  playTime: number;  // Minutes
  turnCount: number;
  generationCount: number;

  // Stats
  stats: GameStats;
}

interface GameStats {
  miraclesPerformed: number;
  storiesCreated: number;
  storiesLost: number;
  peakBelievers: number;
  peakPower: number;
  villagersLived: number;
  generationsSpanned: number;
}
```

---

## IDs and References

```typescript
// Branded types for type safety
type VillagerId = string & { __brand: "VillagerId" };
type StoryId = string & { __brand: "StoryId" };
type GodId = string & { __brand: "GodId" };
type ShrineId = string & { __brand: "ShrineId" };
type EventId = string & { __brand: "EventId" };
type AbilityId = string & { __brand: "AbilityId" };

interface TileCoord {
  x: number;
  y: number;
}

// ID generation
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
```

---

*Document version: 0.1*
