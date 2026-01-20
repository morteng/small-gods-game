# Entities & Powers System

A flexible system for wizards, monsters, heroes, and anything the LLM imagines.

---

## Design Philosophy

The world should be able to contain:
- Wizards casting spells
- Witches brewing potions
- Priests channeling divine power
- Heroes on quests
- Villains with schemes
- Dragons, trolls, spirits, demons
- Creatures from any mythology
- Beings from fiction
- Things never seen before

**Key principle:** The LLM is the GM. It should be able to create *any* entity on the fly, with the system providing structure without constraining creativity.

---

## The Universal Entity Model

Everything in the world (except terrain) is an **Entity**. Villagers are entities. Dragons are entities. A magical sword is an entity.

```typescript
interface Entity {
  id: EntityId;
  name: string;
  type: EntityType;

  // What it is
  category: EntityCategory;
  subcategory: string;        // Freeform: "fire dragon", "hedge witch", etc.
  description: string;        // LLM-generated appearance/nature

  // Where it is
  location: TileCoord | "roaming" | "hidden" | "otherworldly";
  homeLocation: TileCoord | null;
  territory: TileCoord[];     // Area it controls/haunts

  // Core attributes (D&D-inspired but simplified)
  attributes: Attributes;

  // What it can do
  abilities: Ability[];
  powers: Power[];
  resistances: Resistance[];
  vulnerabilities: Vulnerability[];

  // Behavior
  disposition: Disposition;
  goals: Goal[];
  relationships: EntityRelationship[];

  // Divine connection
  divineAffiliation: GodId | null;
  beliefContribution: number;   // Does believing in this help a god?
  canBeWorshipped: boolean;     // Is it itself a minor divine being?

  // State
  health: number;
  mana: number;               // For magical beings
  status: EntityStatus[];
  isAlive: boolean;
  isCorporeal: boolean;       // Ghosts, spirits = false

  // Narrative
  origin: string;             // Where it came from
  legends: StoryId[];         // Stories about this entity
  knownBy: VillagerId[];      // Who knows of its existence
}

type EntityType =
  | "mortal"          // Humans, villagers
  | "creature"        // Animals, monsters
  | "supernatural"    // Spirits, demons, fae
  | "divine"          // Minor gods, angels
  | "undead"          // Ghosts, zombies, vampires
  | "construct"       // Golems, animated objects
  | "elemental"       // Fire, water, earth, air beings
  | "aberration"      // Things that shouldn't exist
  | "object";         // Magical items, artifacts

type EntityCategory =
  // Mortals
  | "villager" | "wizard" | "witch" | "priest" | "hero" | "villain"
  | "warrior" | "rogue" | "bard" | "scholar" | "merchant" | "noble"

  // Creatures
  | "beast" | "dragon" | "giant" | "troll" | "goblin" | "orc"
  | "wolf" | "bear" | "serpent" | "bird" | "fish" | "insect"

  // Supernatural
  | "spirit" | "demon" | "angel" | "fae" | "djinn" | "yokai"
  | "ghost" | "wraith" | "banshee" | "dryad" | "nymph"

  // Mythological
  | "phoenix" | "unicorn" | "griffin" | "basilisk" | "hydra"
  | "minotaur" | "centaur" | "satyr" | "siren" | "kraken"

  // And anything else - this is extensible
  | string;
```

---

## Attributes (D&D-Inspired, Simplified)

Six core attributes, scaled 1-20 (10 = human average):

```typescript
interface Attributes {
  // Physical
  strength: number;      // 1-20, physical power
  agility: number;       // 1-20, speed, reflexes, coordination
  vitality: number;      // 1-20, health, endurance, resistance

  // Mental
  intellect: number;     // 1-20, reasoning, memory, learning
  wisdom: number;        // 1-20, perception, intuition, willpower
  charisma: number;      // 1-20, presence, influence, force of personality

  // Derived stats
  get maxHealth(): number;     // vitality * 5
  get maxMana(): number;       // (intellect + wisdom) * 3
  get initiative(): number;    // agility + wisdom / 2
  get carryCapacity(): number; // strength * 10
}

// Attribute ranges by entity type
const ATTRIBUTE_RANGES = {
  villager:    { min: 6,  max: 14, average: 10 },
  hero:        { min: 12, max: 18, average: 15 },
  wizard:      { min: 8,  max: 18, average: 13 },  // High INT, lower STR
  dragon:      { min: 14, max: 20, average: 17 },
  goblin:      { min: 4,  max: 12, average: 8 },
  god:         { min: 18, max: 30, average: 25 },  // Beyond mortal scale
};
```

### Attribute Descriptions

| Attribute | Low (1-5) | Average (8-12) | High (15-18) | Legendary (19-20) |
|-----------|-----------|----------------|--------------|-------------------|
| **Strength** | Frail child | Adult human | Strongman | Giant |
| **Agility** | Clumsy | Normal | Acrobat | Blur |
| **Vitality** | Sickly | Healthy | Tireless | Unkillable |
| **Intellect** | Simple | Average | Scholar | Genius |
| **Wisdom** | Oblivious | Aware | Perceptive | Seer |
| **Charisma** | Forgettable | Likeable | Inspiring | Legendary |

---

## Powers & Abilities

### Ability (Passive/Always-On)

```typescript
interface Ability {
  id: AbilityId;
  name: string;
  description: string;
  type: AbilityType;

  // Effects (always active)
  effects: PassiveEffect[];

  // Requirements
  requiresConcentration: boolean;
  requiresItem: ItemId | null;
}

type AbilityType =
  | "natural"       // Darkvision, flight, water breathing
  | "trained"       // Combat expertise, stealth
  | "magical"       // Mage armor, detect magic
  | "divine"        // Sense evil, turn undead aura
  | "racial";       // Elven grace, dwarven resilience

interface PassiveEffect {
  type: EffectType;
  value: number;
  target: "self" | "allies" | "enemies" | "area";
  condition?: string;   // "in darkness", "near water"
}
```

### Power (Active/Usable)

```typescript
interface Power {
  id: PowerId;
  name: string;
  description: string;
  type: PowerType;
  school: MagicSchool | null;

  // Costs
  manaCost: number;
  healthCost: number;        // Blood magic, etc.
  materialCost: string[];    // Required components
  cooldown: number;          // Turns before reuse

  // Targeting
  range: number | "self" | "touch" | "sight" | "unlimited";
  areaOfEffect: AreaOfEffect | null;
  targets: "single" | "multiple" | "all_in_area";

  // Effects
  effects: ActiveEffect[];
  duration: number | "instant" | "concentration" | "permanent";

  // Requirements
  minAttribute: Partial<Attributes>;  // Minimum stats needed
  requiresVerbal: boolean;    // Must speak (can be silenced)
  requiresSomatic: boolean;   // Must gesture (can be bound)
  requiresFocus: boolean;     // Needs wand/staff/etc.

  // Narrative
  visualDescription: string;  // What it looks like
  soundDescription: string;   // What it sounds like
}

type PowerType =
  | "spell"         // Learned magic
  | "prayer"        // Divine granted
  | "innate"        // Natural ability (dragon breath)
  | "ritual"        // Takes time, more powerful
  | "cantrip"       // Minor, unlimited use
  | "legendary";    // Unique, world-shaking

type MagicSchool =
  | "evocation"     // Energy, damage (fireball)
  | "conjuration"   // Summoning, creation
  | "transmutation" // Changing things
  | "divination"    // Knowledge, seeing
  | "enchantment"   // Mind control, charm
  | "illusion"      // Deception, images
  | "necromancy"    // Death, undead
  | "abjuration"    // Protection, dispelling
  | "nature"        // Plants, animals, weather
  | "blood"         // Dark, sacrifice-based
  | "time"          // Rare, dangerous
  | "chaos"         // Unpredictable
  | "order";        // Law, binding

interface ActiveEffect {
  type: EffectType;
  value: number | string;   // Can be formula: "2d6 + intellect"
  damageType?: DamageType;
  saveAttribute?: keyof Attributes;  // Attribute to resist
  saveDifficulty?: number;
}

type DamageType =
  | "physical" | "fire" | "ice" | "lightning" | "acid"
  | "poison" | "psychic" | "radiant" | "necrotic" | "force";

interface AreaOfEffect {
  shape: "sphere" | "cone" | "line" | "cube" | "cylinder";
  size: number;   // Tiles
}
```

---

## Example Entities

### Hedge Witch

```typescript
const hedgeWitch: Entity = {
  name: "Old Maren",
  type: "mortal",
  category: "witch",
  subcategory: "hedge witch",
  description: "A bent old woman with knowing eyes and fingers stained by herbs",

  attributes: {
    strength: 5,
    agility: 7,
    vitality: 8,
    intellect: 14,
    wisdom: 16,
    charisma: 12
  },

  abilities: [
    {
      name: "Herb Lore",
      type: "trained",
      effects: [{ type: "skill_bonus", value: 5, target: "self" }]
    },
    {
      name: "Second Sight",
      type: "magical",
      effects: [{ type: "detect_magic", value: 1, target: "area" }]
    }
  ],

  powers: [
    {
      name: "Healing Poultice",
      type: "ritual",
      school: "nature",
      manaCost: 5,
      range: "touch",
      effects: [{ type: "heal", value: "2d6 + wisdom" }],
      duration: "instant",
      materialCost: ["herbs", "clean water"],
      visualDescription: "Glowing green paste that soothes wounds"
    },
    {
      name: "Curse of Boils",
      type: "spell",
      school: "transmutation",
      manaCost: 10,
      range: "sight",
      effects: [{
        type: "condition",
        value: "boils",
        damageType: "poison",
        saveAttribute: "vitality",
        saveDifficulty: 14
      }],
      duration: 7,
      visualDescription: "Maren points a gnarled finger and mutters"
    }
  ],

  disposition: {
    defaultAttitude: "wary",
    towardStrangers: "suspicious",
    towardAuthority: "defiant",
    towardGods: "respectful_distant"
  },

  divineAffiliation: null,  // Witches often unaffiliated
  canBeWorshipped: false,
  beliefContribution: 0
};
```

### Fire Dragon

```typescript
const fireDragon: Entity = {
  name: "Scorrath the Burning",
  type: "creature",
  category: "dragon",
  subcategory: "fire dragon, ancient",
  description: "A mountain of scales and rage, eyes like molten gold",

  attributes: {
    strength: 20,
    agility: 12,
    vitality: 20,
    intellect: 16,
    wisdom: 14,
    charisma: 18
  },

  abilities: [
    { name: "Flight", type: "natural", effects: [{ type: "movement_mode", value: "fly", target: "self" }] },
    { name: "Darkvision", type: "natural", effects: [{ type: "sense", value: "darkvision", target: "self" }] },
    { name: "Fire Immunity", type: "natural", effects: [{ type: "immunity", value: "fire", target: "self" }] },
    { name: "Frightful Presence", type: "natural", effects: [{ type: "fear_aura", value: 5, target: "enemies" }] }
  ],

  powers: [
    {
      name: "Fire Breath",
      type: "innate",
      school: "evocation",
      manaCost: 0,
      cooldown: 3,
      range: 10,
      areaOfEffect: { shape: "cone", size: 8 },
      effects: [{
        type: "damage",
        value: "8d6",
        damageType: "fire",
        saveAttribute: "agility",
        saveDifficulty: 18
      }],
      visualDescription: "A torrent of white-hot flame erupts forth"
    },
    {
      name: "Wing Buffet",
      type: "innate",
      manaCost: 0,
      cooldown: 1,
      range: "adjacent",
      areaOfEffect: { shape: "sphere", size: 3 },
      effects: [
        { type: "damage", value: "2d6", damageType: "physical" },
        { type: "knockback", value: 3 }
      ]
    }
  ],

  resistances: [
    { type: "physical", value: 0.5 },  // Thick scales
    { type: "magic", value: 0.25 }
  ],

  vulnerabilities: [
    { type: "ice", value: 1.5 }
  ],

  disposition: {
    defaultAttitude: "hostile",
    towardStrangers: "predatory",
    towardGods: "contemptuous"
  },

  territory: [/* mountain tiles */],
  canBeWorshipped: true,   // Some might worship it!
  beliefContribution: -0.5  // Belief in dragon weakens "true" gods
};
```

### Wandering Hero

```typescript
const hero: Entity = {
  name: "Aric the Wanderer",
  type: "mortal",
  category: "hero",
  subcategory: "knight errant",
  description: "Travel-worn armor, kind eyes, a sword that's seen much use",

  attributes: {
    strength: 16,
    agility: 14,
    vitality: 15,
    intellect: 11,
    wisdom: 13,
    charisma: 15
  },

  abilities: [
    { name: "Combat Training", type: "trained", effects: [{ type: "attack_bonus", value: 3, target: "self" }] },
    { name: "Inspiring Presence", type: "trained", effects: [{ type: "morale_bonus", value: 2, target: "allies" }] }
  ],

  powers: [
    {
      name: "Rallying Cry",
      type: "innate",
      manaCost: 0,
      cooldown: 5,
      range: "sight",
      targets: "all_in_area",
      areaOfEffect: { shape: "sphere", size: 5 },
      effects: [
        { type: "remove_condition", value: "fear" },
        { type: "temporary_health", value: 10 }
      ],
      duration: 3,
      visualDescription: "Aric raises his sword and shouts words of courage"
    }
  ],

  goals: [
    { type: "quest", description: "Slay the dragon Scorrath" },
    { type: "protect", target: "innocent villagers" }
  ],

  disposition: {
    defaultAttitude: "friendly",
    towardEvil: "hostile",
    towardGods: "devout"
  },

  divineAffiliation: "player_god",  // Could be YOUR follower!
  canBeWorshipped: false,
  beliefContribution: 0.3  // Heroes who serve you boost belief
};
```

---

## Entity Generation by LLM

The LLM can create any entity on the fly:

### Entity Generation Prompt

```
SYSTEM:
You are creating entities for a fantasy world.
You have complete creative freedom - draw from any mythology,
fiction, or pure imagination.

CONTEXT:
- World state: {world.summary}
- Current threats: {world.threats}
- Player god's domain: {god.domains}
- Existing notable entities: {world.notableEntities}
- Recent events: {world.recentEvents}

TASK:
Generate a new entity appropriate to the current situation.

Consider:
- Does the world need a threat? A helper? A mystery?
- What would create interesting stories?
- How might this entity interact with the god?

OUTPUT FORMAT:
```json
{
  "name": "...",
  "type": "creature|supernatural|mortal|...",
  "category": "...",
  "subcategory": "...",
  "description": "2-3 sentences of vivid description",

  "attributes": {
    "strength": 1-20,
    "agility": 1-20,
    "vitality": 1-20,
    "intellect": 1-20,
    "wisdom": 1-20,
    "charisma": 1-20
  },

  "abilities": [
    {"name": "...", "type": "...", "description": "..."}
  ],

  "powers": [
    {
      "name": "...",
      "type": "spell|innate|...",
      "description": "...",
      "manaCost": 0-50,
      "effects": "..."
    }
  ],

  "disposition": {
    "defaultAttitude": "friendly|neutral|hostile|...",
    "goals": ["..."]
  },

  "divineRelation": "worships_player|opposes_player|neutral|...",
  "storyPotential": "How this entity could generate interesting stories"
}
```
```

---

## Mortals with Power

### Wizard Types

| Type | Source of Power | Typical Stats | Relationship to Gods |
|------|-----------------|---------------|----------------------|
| **Wizard** | Study, intellect | High INT | Often skeptical |
| **Sorcerer** | Innate bloodline | High CHA | Varies |
| **Warlock** | Pact with entity | High CHA/WIS | Serves patron |
| **Druid** | Nature itself | High WIS | Respects nature spirits |
| **Cleric** | Divine grant | High WIS | Devout servant |
| **Witch** | Tradition, spirits | High WIS | Complex, often independent |
| **Shaman** | Ancestor spirits | High WIS | Animist beliefs |
| **Necromancer** | Death energy | High INT | Often opposed by gods |
| **Alchemist** | Science/magic | High INT | Pragmatic |
| **Bard** | Words, music | High CHA | Spreads stories! |

### Wizard and Gods

Magic users have complex relationships with gods:

```typescript
interface MagicUserBeliefInteraction {
  // Wizards might not contribute belief
  beliefContribution: number;  // Often 0 or negative

  // But they can affect others' beliefs
  canCastMiracles: boolean;    // Fake miracles?
  canDispelDivine: boolean;    // Counter god powers?
  canDetectDivine: boolean;    // Know when god acts?

  // Story implications
  storiesAbout: "explain_away" | "attribute_to_magic" | "credit_god";
}
```

A wizard might:
- Perform "miracles" that compete with your divine acts
- Explain away your miracles as natural magic
- Serve you as a divine agent (cleric/priest)
- Oppose you as a rationalist threat

---

## Priests and Divine Agents

Priests are special - they channel YOUR power:

```typescript
interface Priest extends Entity {
  type: "mortal";
  category: "priest";

  // Divine connection
  divineAffiliation: GodId;
  devotionLevel: number;        // 0-1, affects power
  grantedPowers: Power[];       // Powers you gave them

  // Relationship
  faithQuality: "genuine" | "habitual" | "political";
  interpretationStyle: "orthodox" | "reformist" | "heretical";

  // Abilities
  canPerformRituals: boolean;
  canGrantBlessings: boolean;   // On your behalf
  canSpeakProphecy: boolean;

  // Risk
  mightMisinterpret: number;    // Chance of "creative" theology
  mightSchism: number;          // Chance of starting heresy
}
```

### Priest Powers (Granted by God)

When you empower a priest, they can use limited divine powers:

```typescript
const priestPowers: Power[] = [
  {
    name: "Minor Blessing",
    type: "prayer",
    description: "Bless crops, tools, or people",
    manaCost: 0,  // Uses GOD's power instead
    divineCost: 2,
    effects: [{ type: "bless", value: 0.5, duration: 30 }]
  },
  {
    name: "Heal Wounds",
    type: "prayer",
    manaCost: 0,
    divineCost: 5,
    effects: [{ type: "heal", value: "1d6 + devotion" }]
  },
  {
    name: "Speak the Word",
    type: "prayer",
    description: "Deliver a message from the god",
    manaCost: 0,
    divineCost: 1,
    effects: [{ type: "deliver_message", value: "god_speaks" }]
  }
];
```

---

## Monsters and Creatures

### Monster Categories

| Category | Examples | Typical Behavior | Divine Relation |
|----------|----------|------------------|-----------------|
| **Beasts** | Wolves, bears, boars | Territorial, hungry | Neutral |
| **Monsters** | Trolls, ogres, giants | Aggressive, simple | Often opposed |
| **Dragons** | Fire, ice, storm | Intelligent, proud | Rival powers |
| **Undead** | Ghosts, zombies, vampires | Varied, often cursed | Usually opposed |
| **Fae** | Sprites, dryads, sidhe | Tricky, alien morality | Parallel power |
| **Demons** | Imps, fiends, devils | Corruptive, scheming | Enemy |
| **Elementals** | Fire, water, earth, air | Force of nature | Neutral/servant |
| **Spirits** | Ancestors, place spirits | Protective/vengeful | Complex |
| **Aberrations** | Things from beyond | Incomprehensible | Threat to all |

### Monster Behavior AI

```typescript
interface MonsterBehavior {
  // What triggers aggression
  aggressionTriggers: string[];   // "trespass", "provocation", "hunger"

  // What it wants
  primaryGoal: "survival" | "territory" | "hunger" | "hoarding" | "chaos";

  // How smart is its tactics
  tacticalIntelligence: "bestial" | "cunning" | "strategic" | "genius";

  // Social behavior
  packBehavior: "solitary" | "pair" | "pack" | "swarm" | "hive";

  // Can it be reasoned with
  negotiable: boolean;
  bribable: boolean;
  what_it_values: string[];  // "gold", "food", "flattery", "knowledge"
}
```

---

## Heroes and Villains

### Hero Archetypes

```typescript
type HeroArchetype =
  | "knight"          // Honorable warrior
  | "ranger"          // Wilderness protector
  | "paladin"         // Divine champion
  | "rogue"           // Clever troublemaker
  | "sage"            // Wise advisor
  | "chosen_one"      // Destined for greatness
  | "reluctant"       // Doesn't want to be hero
  | "fallen"          // Seeking redemption
  | "folk_hero"       // Common person risen up
  | "trickster";      // Wins through cunning

interface Hero extends Entity {
  archetype: HeroArchetype;

  // The hero's journey
  quest: Quest;
  allies: EntityId[];
  enemies: EntityId[];

  // Narrative role
  destinyWeight: number;      // How much fate bends around them
  plotArmor: number;          // Resistance to random death

  // Relationship to player god
  couldBeChampion: boolean;   // Can you recruit them?
  opposesYou: boolean;        // Are they your enemy?
}

interface Quest {
  type: "slay_monster" | "find_artifact" | "save_person" | "discover_truth";
  target: EntityId | string;
  status: "seeking" | "pursuing" | "confronting" | "completed" | "failed";
  storyImpact: number;        // How much stories will spread about this
}
```

### Villain Archetypes

```typescript
type VillainArchetype =
  | "tyrant"          // Rules through fear
  | "dark_lord"       // Wants to conquer/destroy
  | "cultist"         // Serves dark power
  | "corruptor"       // Spreads evil slowly
  | "nihilist"        // Wants destruction
  | "rival"           // Wants what hero has
  | "tragic"          // Was good once
  | "necessary"       // Does evil for "good" reasons
  | "monster"         // Pure predator
  | "deceiver";       // Hides true nature

interface Villain extends Entity {
  archetype: VillainArchetype;

  // The villain's plan
  scheme: Scheme;
  minions: EntityId[];
  resources: string[];

  // Threat level
  threatLevel: "local" | "regional" | "existential";

  // Can they be redeemed?
  redeemable: boolean;
  whatWouldRedeemThem: string;
}

interface Scheme {
  goal: string;
  currentPhase: number;
  phases: string[];
  progressPerTurn: number;
  canBeDisrupted: boolean;
  disruptionMethod: string;
}
```

---

## Mythological Beings

### Drawing from Mythology

The LLM can pull from any mythology:

```
MYTHOLOGICAL SOURCES:
- Greek: Zeus, centaurs, hydra, sirens, Olympians
- Norse: Odin, Thor, dwarves, elves, Yggdrasil
- Egyptian: Ra, Anubis, scarabs, mummies, sphinxes
- Japanese: Yokai, oni, kitsune, tengu, dragons
- Celtic: Sidhe, banshees, selkies, green man
- Slavic: Baba Yaga, domovoi, rusalka, leshy
- Chinese: Dragons, phoenix, qilin, jiangshi
- Hindu: Naga, rakshasa, asura, deva
- Native American: Thunderbird, wendigo, coyote
- African: Anansi, Mami Wata, various spirits
- Lovecraftian: Cosmic horrors, cultists
- Tolkien-esque: Elves, dwarves, orcs, ents
- Fairy tales: Witches, ogres, talking animals
- Modern: Vampires, werewolves, ghosts
- Original: Anything the LLM creates
```

### Scaling Mythological Power

```typescript
interface MythologicalScale {
  tier: "minor" | "major" | "greater" | "cosmic";

  /*
    Minor: Local spirits, imps, small fae
    Major: Named monsters, powerful wizards
    Greater: Dragon lords, demon princes, minor gods
    Cosmic: Creation-level beings, elder gods
  */

  attributeRange: { min: number; max: number };
  powerScale: number;         // Multiplier for abilities
  canBeKilled: boolean;
  canBePermanentlyDestroyed: boolean;
  requiresSpecialMeans: string | null;  // "Only silver", "True name"
}
```

---

## Interaction with God System

### How Entities Affect Belief

| Entity Type | Belief Effect |
|-------------|---------------|
| **Priest (yours)** | +Major boost to belief |
| **Hero (yours)** | +Moderate boost, great stories |
| **Wizard (neutral)** | Explains miracles away (-) |
| **Rival god** | Competes for believers (--) |
| **Monster** | Opportunity: save people (+) or fail (-) |
| **Demon** | Usually enemy, defeating boosts belief |
| **Helpful spirit** | Can be your agent |

### Entities and Stories

Entities generate GREAT stories:

```typescript
interface EntityStoryPotential {
  // What stories might arise
  heroicDeeds: string[];      // "Slew the dragon"
  tragicFates: string[];      // "Fell to darkness"
  mysteriesCreated: string[]; // "What sleeps beneath"
  propheciesFulfilled: string[];

  // Story spread multiplier
  howMemorableIs: number;     // 1-10, affects story spread
  howFrighteningIs: number;   // 1-10, fear-based stories
  howInspiringIs: number;     // 1-10, hope-based stories
}
```

---

## Combat System (Simple)

When entities fight:

```typescript
interface CombatRound {
  // Initiative order
  order: EntityId[];  // Sorted by initiative

  // Each combatant acts
  actions: CombatAction[];

  // Resolution
  results: CombatResult[];
}

interface CombatAction {
  actor: EntityId;
  type: "attack" | "power" | "defend" | "flee" | "talk";
  target: EntityId | TileCoord;
  powerUsed?: PowerId;
}

interface CombatResult {
  actor: EntityId;
  target: EntityId;
  success: boolean;
  damage: number;
  effects: string[];
  narrative: string;  // LLM-generated description
}

// Simple combat resolution
function resolveCombat(action: CombatAction, world: WorldState): CombatResult {
  const attacker = world.getEntity(action.actor);
  const defender = world.getEntity(action.target);

  // Attack roll: d20 + relevant attribute modifier
  const attackRoll = roll(20) + getModifier(attacker.attributes.strength);
  const defense = 10 + getModifier(defender.attributes.agility);

  if (attackRoll >= defense) {
    const damage = rollDamage(attacker.mainAttack);
    defender.health -= damage;

    return {
      success: true,
      damage,
      narrative: await llm.describeCombat(attacker, defender, "hit", damage)
    };
  }

  return {
    success: false,
    damage: 0,
    narrative: await llm.describeCombat(attacker, defender, "miss", 0)
  };
}
```

---

## LLM as Monster/NPC Controller

The LLM decides what entities do:

```
SYSTEM:
You control all non-player entities in the world.
Decide their actions each turn based on their nature,
goals, and the current situation.

ENTITY: {entity.name} ({entity.category})
- Disposition: {entity.disposition}
- Goals: {entity.goals}
- Current status: {entity.status}
- Location: {entity.location}
- Nearby: {nearbyEntities}

SITUATION:
{world.currentSituation}

TASK:
Decide what {entity.name} does this turn.

Consider:
- Their nature and goals
- Opportunities and threats
- How their action creates story potential
- Whether they might interact with the god's followers

OUTPUT:
ACTION: [what they do]
TARGET: [if applicable]
REASONING: [brief explanation]
STORY_HOOK: [how this might become a story]
```

---

## MVP Scope

For MVP, start simple:

### MVP Entities
- Villagers (existing)
- One monster type (wolf pack or troll)
- One wizard/witch (helpful or rival)
- One wandering hero (potential champion)

### MVP Powers
- 3-5 powers per entity type
- Simple damage/heal/buff/debuff
- No complex spell slots or mana management

### Post-MVP
- Full bestiary
- Complex magic system
- Legendary artifacts
- Divine champions
- Demon invasions
- Hero quests

---

*Document version: 0.1*
