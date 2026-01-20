# Small Gods: Game Design Document

> *"Gods need belief. Belief needs stories. Stories need people."*

## Overview

**Small Gods** is a single-player god game where you play as a nascent spirit trying to grow from nothing into a deity. The twist: an LLM animates the entire world—every villager, every story, every disaster. Your power comes from belief, but belief is shaped by *stories*, and stories mutate as they pass between generations.

**Core Fantasy:** Experience what it's like to be a small god—whispering into dreams, performing miracles, watching your deeds become legend (or be forgotten).

**Inspired By:**
- Terry Pratchett's *Small Gods* (belief mechanics)
- Dwarf Fortress (emergent narrative)
- Black & White (god game genre)
- Oral tradition research (story mutation)
- D&D (entity powers and attributes)
- World mythology (creatures and beings)

---

## World Overview

The world is a living, breathing place filled with:

- **Mortals** - Villagers, wizards, witches, priests, heroes, villains
- **Creatures** - Wolves, dragons, trolls, and beasts of all kinds
- **Supernatural beings** - Spirits, demons, fae, angels, and more
- **Mythological entities** - Anything from any mythology or fiction
- **Dynamic events** - Floods, fires, plagues, auroras, rain of frogs

The LLM serves as GM, able to create *any* entity or event on the fly.

See: `docs/ENTITIES_AND_POWERS.md`, `docs/DYNAMIC_WORLD.md`, `docs/AI_VISUALS_AND_AUDIO.md`

---

## Core Concept

```
┌─────────────────────────────────────────────────────┐
│                    HUMAN PLAYER                     │
│                        🐢                           │
│                    Small God                        │
│                                                     │
│   Actions: whisper, miracle, bless, curse, wait    │
└──────────────────────┬──────────────────────────────┘
                       │ affects
                       ▼
┌─────────────────────────────────────────────────────┐
│                    THE WORLD                        │
│            (Simulated by LLM)                       │
│                                                     │
│   👤👤👤 Villagers with inner lives                │
│   📜📜📜 Stories that evolve                       │
│   🌧️🌋⚡ Weather, disasters, events               │
│   ⏰ Time passing, generations                      │
└─────────────────────────────────────────────────────┘
```

The **player** has limited, indirect control. You can't force anyone to believe. You can only act, and hope the world interprets your actions favorably.

The **LLM** is the soul of the world. It generates NPC personalities, simulates their reactions, transforms stories as they're retold, and creates emergent events.

---

## The Belief Economy

### How Belief Works

Belief is your power source. Without it, you fade to nothing.

```
BELIEF FORMULA:

Total Power = Σ (villager.belief_strength × belief_quality_modifier)

Where belief_quality_modifier:
  genuine_faith    = 1.0   (they truly believe in YOU)
  habitual_worship = 0.3   (going through motions)
  fear_of_church   = -0.2  (believe in institution, not you)
  active_heresy    = -0.5  (spreading disbelief)
```

### The Pratchett Paradox

A massive church with thousands of "followers" might give you LESS power than a single true believer—if those followers fear the institution rather than believe in you.

```
Example:
  Village A: 10 genuine believers (10 × 1.0 = 10 power)
  Village B: 100 fearful subjects (100 × -0.2 = -20 power)

  Village B is actually DRAINING you.
```

This creates interesting strategic tension: rapid institutional growth vs. deep genuine faith.

---

## Power Levels & Abilities

As belief accumulates, you gain power and unlock abilities.

### Power Tiers

| Power | State | Emoji | Abilities |
|-------|-------|-------|-----------|
| 0-10 | Fading | 🐢 | Whisper to one true believer only |
| 11-30 | Stirring | 🦎 | Whisper to any villager, tiny signs |
| 31-100 | Rising | 🐍 | Small miracles, appear in dreams, bless/curse individuals |
| 101-300 | Ascendant | 🐉 | Weather control, heal/harm, manifest briefly, empower prophets |
| 301+ | Divine | ⚡ | Reshape landscape, mass visions, create artifacts, smite |

### Abilities (Detailed)

#### Whisper (Cost: 0-1 power)
Send a thought, feeling, or urge to a villager.
- At 🐢: Only works on your most devoted believer
- At 🦎+: Works on anyone, but skeptics may ignore
- The LLM interprets how the villager receives/reacts

```
Player: whisper kira "Visit Elder Tam"

LLM Response:
"Kira pauses while grinding grain. A thought surfaces—
she should visit old Tam. Strange. She hasn't thought
of him in months. She dismisses it, then pauses again.
Perhaps after her chores."
```

#### Miracle (Cost: 5-50 power)
Cause a supernatural event. Cost depends on scale.

| Miracle | Cost | Examples |
|---------|------|----------|
| Tiny | 5 | Candle relights, lost item found, gentle breeze |
| Small | 15 | Rain during drought, illness healed, bountiful catch |
| Medium | 30 | Storm summoned, spring created, building protected from fire |
| Large | 50 | Earthquake, plague ended, river changes course |

**Critical:** Miracles don't automatically generate belief. The LLM simulates how witnesses *interpret* the event. A miracle might be:
- Attributed to you (belief increases)
- Attributed to another god (no gain)
- Seen as coincidence (skepticism)
- Seen as terrifying (fear, not faith)

#### Bless (Cost: 3-10 power)
Grant ongoing favor to a person, place, or thing.
- Blessed crops yield more
- Blessed person has good fortune
- Blessed shrine attracts visitors

#### Curse (Cost: 5-15 power)
Inflict ongoing misfortune.
- Cursed person suffers accidents
- Cursed land becomes barren
- Cursed object brings bad luck

**Warning:** Curses can backfire narratively. Villagers might blame you for cruelty rather than fear your power.

#### Manifest (Cost: 20-100 power)
Appear in physical or vision form.
- Dream visitation (cheapest)
- Ghostly apparition
- Animal avatar (speak through beast)
- Full physical form (most expensive, temporary)

#### Prophet (Cost: 30 power + ongoing)
Empower a believer to speak with your authority.
- Prophet can perform minor miracles
- Prophet spreads your stories more effectively
- **Risk:** Prophet may *reinterpret* your will

---

## The Story System

> *Stories are not flavor. Stories are the game.*

### What Stories Are

Stories are the persistent memory of the world. They record events, but transform over time as they're retold.

### Story Structure

```
Story {
  id: unique identifier
  name: "The Rain of Mira"
  type: miracle | disaster | hero | warning | origin | prophecy

  # What actually happened
  true_events: [
    {turn: 5, action: "rain_miracle", witnesses: ["mira"]}
  ]

  # Current narrative form
  current_telling: "When grandmother Mira prayed at the
                    stone, the sky opened and rain fell
                    for three days..."

  # How it's changed
  versions: [
    {gen: 1, teller: "mira", text: "..."},
    {gen: 2, teller: "kira", text: "..."},
    ...
  ]

  # Who knows this story
  carriers: [villager_ids]

  # Metadata
  generations: 4           # times retold
  fidelity: 0.34           # similarity to truth (0-1)
  themes: ["sacrifice", "rain", "holy_woman"]
  influence: 12            # belief impact when told
}
```

### Story Lifecycle

```
1. EVENT OCCURS
   └── Player performs miracle / disaster happens / hero acts

2. WITNESSES REMEMBER
   └── Eyewitnesses create v1 of story (high fidelity)

3. STORIES SPREAD
   └── Teller → Listener (story mutates each time)

4. GENERATIONS PASS
   └── Old carriers die, young ones inherit (or don't)

5. STORIES SURVIVE OR DIE
   └── Untold stories fade when last carrier dies
```

### Story Mutation

When a story is told, the LLM transforms it based on:

1. **Teller's personality** - A skeptic tells it differently than a devout
2. **Teller's age/memory** - Old memories fade, details blur
3. **Listener's context** - Stories adapt to what listeners care about
4. **Cultural drift** - Language and references shift over generations
5. **Embellishment** - Drama increases, mundane details drop
6. **Moral lessons** - Tellers add meaning/warnings

### Mutation Prompt Template

```
SYSTEM: You are simulating oral tradition in a fantasy world.

CONTEXT:
- Teller: {teller.name}, age {teller.age}, {teller.personality}
- Listener: {listener.name}, age {listener.age}
- Story has been told {story.generations} times before
- Current version: "{story.current_telling}"
- True events: {story.true_events}
- Current world situation: {world.current_events}

TASK:
Write how {teller.name} tells this story to {listener.name}.
Apply realistic oral tradition effects:
- Memory distortion (forgetting, conflating)
- Embellishment (drama, exaggeration)
- Personalization (teller's perspective)
- Moral framing (lessons, warnings)
- Cultural adaptation (references, language)

Keep it to 2-4 sentences. Speak as the teller would.
```

### Story Mechanics

#### Stories Affect Belief

```python
def hear_story(listener, story):
    impact = story.influence * teller.credibility

    if story.type == "miracle":
        listener.belief_strength += impact * 0.1
    elif story.type == "warning":
        listener.fear_level += impact * 0.05
    elif story.type == "abandonment":
        listener.belief_strength -= impact * 0.15
```

#### Stories Compete

Multiple gods = multiple story traditions. Dominant narratives win.

```
Village Story Frequency (this generation):
├── River Spirit stories: 45 tellings
├── Mountain God stories: 23 tellings
├── "No gods" stories: 8 tellings
└── Foreign trader's god: 3 tellings
```

The most-told stories shape the village's beliefs.

#### Stories Can Die

```
⚠️ WARNING: "The First Miracle"
   Last carrier: Elder Tam (age 87, failing health)
   Last told: 4 years ago

   If Tam dies without telling this story, it is LOST FOREVER.
```

Player choice: Whisper to someone to visit Tam? Or let history die?

#### Stories Can Resurrect

- Old shrine discovered → questions asked → dormant stories revive
- Traveler arrives with foreign version of your myth
- Child finds ancient carving, asks elders

#### Player Can See Drift

The UI shows both truth and current myth:

```
╔═══════════════════════════════════════════════════════╗
║ 📜 "THE RAIN OF MIRA"                                 ║
╠═══════════════════════════════════════════════════════╣
║ WHAT YOU DID (Turn 5):                                ║
║ • Caused rain during drought                          ║
║ • Witness: Mira (farmer, praying at old stone)        ║
║                                                       ║
║ WHAT THEY BELIEVE (Generation 4):                     ║
║ "The prophet Mira climbed the sacred mountain and     ║
║  wrestled the Storm God for three days. She won,      ║
║  and the god's tears became rain that saved the       ║
║  village from the Great Drought."                     ║
║                                                       ║
║ Fidelity: 23% │ Carriers: 47 │ Tellings/year: 12     ║
╚═══════════════════════════════════════════════════════╝
```

---

## Villager System

### Villager Structure

```
Villager {
  id: unique identifier
  name: "Kira"
  age: 34

  # Belief state
  belief_target: god_id | null    # who they worship
  belief_strength: 0.0-1.0        # how strongly
  belief_type: genuine | habitual | fearful | skeptic

  # Personality (affects story telling/receiving)
  personality: {
    skepticism: 0.0-1.0      # resistant to belief
    piety: 0.0-1.0           # tendency toward faith
    storytelling: 0.0-1.0    # how often they tell stories
    curiosity: 0.0-1.0       # seek new knowledge
    fear: 0.0-1.0            # susceptible to fear
  }

  # Social
  relationships: [{target, type, strength}]
  social_role: farmer | elder | trader | child | healer | etc

  # Memory
  witnessed_events: [event_ids]
  known_stories: [story_ids]
  personal_history: string (LLM-generated biography)

  # Physical
  health: 0.0-1.0
  location: coordinates
}
```

### Villager Simulation

Each turn, the LLM simulates villager life:

```python
async def simulate_villager_turn(villager, world, llm):
    prompt = f"""
    Simulate one day/week in the life of {villager.name}.

    Character: {villager.personal_history}
    Personality: {villager.personality}
    Current situation: {world.get_local_context(villager)}
    Recent events: {world.recent_events}

    What do they:
    - Think about?
    - Do today?
    - Talk about with others?
    - Feel about the gods?

    Note any significant actions or attitude changes.
    """

    response = await llm.generate(prompt)
    return parse_villager_update(response)
```

### Life Events

Villagers experience life events that create story opportunities:

- **Birth** - New potential believer
- **Coming of age** - Receives stories from elders
- **Marriage** - Stories merge between families
- **Childbirth** - Mother might pray, creating opportunity
- **Illness** - Crisis of faith or deepening
- **Death** - Stories might die with them

### Social Network

```
     👤 Tam (elder, storyteller)
     │
     ├── 👤 Mira (daughter, devout)
     │   ├── 👤 Kira (granddaughter, curious)
     │   └── 👤 Jin (grandson, skeptic)
     │
     └── 👤 Orin (friend, skeptic)
         └── 👤 traders (outside influence)
```

Stories flow along relationship lines. Break the network = stories don't spread.

---

## Time & Generations

### Time Scale

```
1 Turn = ~1 week of world time (adjustable)
1 Season = 12 turns
1 Year = 48 turns
1 Generation = ~30 years = ~1440 turns
```

### Generational Mechanics

Every ~30 years:
- Elders die (taking unshared stories with them)
- Adults become elders
- Children become adults
- New children are born
- Cultural shifts occur

### The Long Game

The game is designed to be played across multiple generations:

```
GENERATION 1: "The Awakening"
├── Find your first believer
├── Perform first miracle
├── First stories created
└── Establish initial cult

GENERATION 2: "Growth"
├── Stories spread and mutate
├── First shrine built
├── Institutional challenges begin
└── First schism possible

GENERATION 3: "Legacy"
├── You're now "ancient" god
├── Original stories heavily mutated
├── Competing interpretations
└── Face existential threat

GENERATION 4+: "Myth"
├── Your origins are legend
├── Multiple denominations possible
├── Stories have taken own life
└── What kind of god have you become?
```

---

## World Events

The LLM generates world events that create challenges and opportunities.

### Event Types

| Type | Examples | Opportunity |
|------|----------|-------------|
| **Natural** | Drought, flood, earthquake | Miracle to save, or test of faith |
| **Disease** | Plague, crop blight | Healing miracle or mass death |
| **Social** | War, migration, trade | New believers or competing gods |
| **Personal** | Birth, death, crime | Individual conversion moments |
| **Supernatural** | Other gods, monsters | Conflict or alliance |

### Event Generation

```python
async def generate_events(world, llm):
    prompt = f"""
    Generate 1-3 events for this turn.

    World state: {world.summary}
    Season: {world.season}
    Recent history: {world.recent_events}
    Current tensions: {world.tensions}

    Events should:
    - Feel organic to the world
    - Create opportunities for player action
    - Sometimes threaten believers
    - Sometimes offer growth chances

    Format: {event_schema}
    """

    return await llm.generate(prompt)
```

### Player Response to Events

Events demand response. Inaction is also a choice.

```
EVENT: Plague strikes the village. 12 sick, 3 dead.

Options:
[M] Miracle: Heal the sick (cost: 25 power)
[W] Whisper: Guide healer to cure (cost: 2 power)
[B] Bless: Protect your believers only (cost: 10 power)
[O] Observe: Do nothing, see what happens

Each choice has narrative consequences:
- Heal all → "The god saved us!" (belief rises)
- Whisper → Credit goes to healer (mixed result)
- Protect believers → "The god only loves the faithful" (fear)
- Nothing → "Where was our god?" (doubt spreads)
```

---

## Win/Loss Conditions

### Loss: Fading

If belief drops to 0 and stays there, you fade from existence.

```
⚠️ FADING WARNING
Power: 2 │ Believers: 1 │ Turns until fade: 10

Your last believer is Elder Tam (age 89).
If he dies or loses faith, you cease to exist.
```

### Victory Conditions (Player Chooses)

| Victory | Condition | Playstyle |
|---------|-----------|-----------|
| **Survival** | Exist for 10 generations | Careful, sustainable |
| **Dominion** | 1000+ believers | Expansionist |
| **Truth** | Core story >80% fidelity after 5 gen | Interventionist |
| **Mystery** | Core story <20% fidelity, 500+ believers | Hands-off |
| **Ascension** | Reach ⚡ power level | Power-focused |
| **Legacy** | 50+ stories survive 5 generations | Story-focused |

### Endless Mode

No win condition. Just exist, grow, watch your mythology evolve.

---

## Visual & Audio System

### AI-Generated Map Pipeline

The game uses a novel approach to visuals: **skeleton tiles** provide game logic geometry, **AI generation** paints over them.

```
[Clean Isometric Tiles] → [Segment Color Map] → [AI Image Generator] → [Rich Painted World]
```

1. **Skeleton tiles** (e.g., route1rodent's 32x32 set) define structure
2. **Segment map** encodes tile types as colors (blue=water, green=grass, etc.)
3. **ControlNet** conditions SDXL to paint over while preserving geometry
4. **Game logic** uses tile data; **players** see the painted result

Benefits:
- Same skeleton can be repainted for different times of day, weather, seasons
- Dynamic events (fire, flood) trigger localized regeneration
- Unique visual style per playthrough (different style seeds)

### Emergent God Visual Identity

**The Pratchett Principle:** Believers define the god, not the other way around.

The god's visual form emerges from aggregate believer narratives:
- As stories spread describing you as a "great turtle," you become turtle-shaped
- Minority beliefs add secondary features
- Form shifts over generations as beliefs evolve
- AI regenerates god portrait when dominant perception changes

### Dynamic NPC Portraits

AI-generated portraits that evolve:
- Base portrait from NPC physical description (derived from attributes)
- Age variants (child → young adult → adult → elderly) via img2img
- Life events modify appearance (scars, blessings, prosperity, illness)

### Voice Synthesis

Using lightweight TTS (Kyutai Pocket TTS) for:
- **Key conversations** - LLM GM flags important moments for voicing
- **Divine responses** - Believers speak aloud when player interacts
- **Per-NPC voices** - Derived from entity attributes (pitch, speed, accent)

See: `docs/AI_VISUALS_AND_AUDIO.md` for full technical details.

---

## Technical Architecture

### MCP Server Structure

```
small-gods-mcp-server/
├── src/
│   ├── server.ts           # MCP server entry point
│   ├── game/
│   │   ├── world.ts        # World state management
│   │   ├── villager.ts     # Villager simulation
│   │   ├── story.ts        # Story system
│   │   ├── belief.ts       # Belief calculations
│   │   └── events.ts       # Event generation
│   ├── llm/
│   │   ├── prompts.ts      # Prompt templates
│   │   ├── simulation.ts   # LLM world simulation
│   │   └── mutation.ts     # Story mutation
│   ├── tools/
│   │   ├── whisper.ts      # Whisper action
│   │   ├── miracle.ts      # Miracle action
│   │   ├── bless.ts        # Bless action
│   │   ├── curse.ts        # Curse action
│   │   └── observe.ts      # View world state
│   └── ui/
│       └── renderer.ts     # Emoji world rendering
├── data/
│   ├── names.json          # Name generation
│   └── events.json         # Event templates
└── saves/                  # Saved games
```

### MCP Tools Exposed

```typescript
// Player actions
whisper(target: string, message: string): WhisperResult
miracle(type: MiracleType, target?: string): MiracleResult
bless(target: string): BlessResult
curse(target: string): CurseResult
manifest(form: ManifestForm, target?: string): ManifestResult
empower_prophet(target: string): ProphetResult

// Information
observe(): WorldState
view_story(story_id: string): StoryDetail
view_villager(villager_id: string): VillagerDetail
list_believers(): Believer[]
list_stories(): StorySummary[]

// Game control
advance_turn(): TurnResult
save_game(name: string): void
load_game(name: string): void
```

### UI Resources (MCP Apps)

```typescript
// ui:// resources for iframe rendering
"ui://world-map"      // Emoji grid world view
"ui://story-viewer"   // Story detail/lineage view
"ui://villager-list"  // Believer management
"ui://event-log"      // Recent events
"ui://power-status"   // God power/abilities
```

### Game Loop

```
┌─────────────────────────────────────────────────────┐
│                   GAME LOOP                         │
├─────────────────────────────────────────────────────┤
│                                                     │
│  1. RENDER WORLD STATE                              │
│     └── Display map, events, status via iframe      │
│                                                     │
│  2. PLAYER INPUT                                    │
│     └── Player calls MCP tool (whisper/miracle/etc) │
│                                                     │
│  3. RESOLVE ACTION                                  │
│     └── Execute player action, determine effects    │
│                                                     │
│  4. LLM WORLD SIMULATION                            │
│     ├── Simulate NPC reactions                      │
│     ├── Mutate stories that get told                │
│     ├── Generate new events                         │
│     ├── Update relationships                        │
│     └── Process births/deaths                       │
│                                                     │
│  5. UPDATE BELIEF                                   │
│     ├── Recalculate each villager's belief          │
│     └── Recalculate total power                     │
│                                                     │
│  6. CHECK WIN/LOSS                                  │
│     └── Fading? Victory condition met?              │
│                                                     │
│  → Return to step 1                                 │
└─────────────────────────────────────────────────────┘
```

---

## MVP Scope

### MVP Features (Phase 1)

- [ ] Single village (~20-50 villagers)
- [ ] Basic villager simulation (personality, belief)
- [ ] Core god abilities (whisper, miracle, bless)
- [ ] Story creation and basic mutation
- [ ] 3 generations of play
- [ ] Text-based UI with emoji world
- [ ] Single LLM backend (Claude)

### Post-MVP (Phase 2)

- [ ] Multiple villages
- [ ] Competing NPC gods
- [ ] Prophet system
- [ ] Richer story mechanics
- [ ] Visual UI (beyond emoji)
- [ ] Save/load system

### Future (Phase 3)

- [ ] Multiplayer (multiple human gods)
- [ ] Procedural infinite world
- [ ] Mod support (custom events, abilities)
- [ ] Mobile version

---

## Open Questions

1. **Turn pacing:** How much happens per turn? Too much = overwhelming. Too little = boring.

2. **LLM cost:** Each turn requires multiple LLM calls. How to optimize?

3. **Story storage:** How many stories can exist before it becomes unwieldy?

4. **Balancing:** How to make different strategies viable?

5. **Onboarding:** How to teach these systems to new players?

---

## Name Candidates

- Small Gods (direct Pratchett reference)
- Belief Engine
- The Whisper
- Apotheosis
- Faithkeep
- The Myth Below
- Godseed
- Pantheon

---

*Document version: 0.1*
*Last updated: 2026-01-18*
