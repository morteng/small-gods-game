# Story Mechanics - Deep Dive

Stories are the core innovation of Small Gods. This document details how they work.

---

## Why Stories Matter

In most god games, belief is abstract: do X, get Y believers. In Small Gods, belief flows through **narrative**. Your miracles don't directly create believers—they create *stories*, and stories create believers (or heretics).

This means:
- A witnessed miracle is worth more than an unseen one
- How a story is told matters as much as what happened
- Stories can outlive their witnesses
- Stories can be corrupted, lost, or weaponized

---

## Story Types

### 1. Miracle Stories
Created when you perform a supernatural act and someone witnesses it.

```
Trigger: Player performs miracle with witness
Initial telling: Close to truth
Typical drift: Exaggeration, attribution to special person
Example evolution:
  v1: "Rain came when I prayed"
  v4: "The prophet summoned a flood from heaven"
```

### 2. Disaster Stories
Created when calamity strikes. Can blame or credit you.

```
Trigger: Disaster event (plague, earthquake, etc)
Initial telling: Raw fear/grief
Typical drift: Seeks meaning—punishment or test?
Example evolution:
  v1: "The river flooded and took my home"
  v4: "The god sent floods to punish the unbelievers"
```

### 3. Origin Stories
How you came to be. Often mythologized rapidly.

```
Trigger: First miracle or first believer
Initial telling: Personal encounter
Typical drift: Cosmic significance added
Example evolution:
  v1: "I felt a presence at the old stone"
  v4: "In the beginning, the god rose from the sacred mountain"
```

### 4. Hero Stories
About exceptional mortals—prophets, saints, martyrs.

```
Trigger: Mortal does something significant for/against you
Initial telling: Factual account
Typical drift: Mythologization of person
Example evolution:
  v1: "Mira helped heal the sick during plague"
  v4: "Saint Mira could raise the dead with a touch"
```

### 5. Warning Stories
Cautionary tales about defying or angering you.

```
Trigger: Someone suffers after defying you
Initial telling: "Bad things happened to X"
Typical drift: Moral lesson added
Example evolution:
  v1: "Orin mocked the shrine and then got sick"
  v4: "Those who blaspheme will be struck down by divine wrath"
```

### 6. Prophecy Stories
Forward-looking narratives. Can be player-seeded or emergent.

```
Trigger: Prophet speaks, or pattern interpreted
Initial telling: Vague prediction
Typical drift: Reinterpreted to fit events
Example evolution:
  v1: "The prophet said rain would come"
  v4: "It was foretold that the chosen one would bring water from stone"
```

---

## Story Attributes

### Fidelity (0.0 - 1.0)
How close is the current telling to what actually happened?

```
1.0 = Perfect accuracy (eyewitness account)
0.7 = Minor embellishments
0.5 = Core events intact, details wrong
0.3 = Heavily mythologized
0.1 = Almost no connection to original events
0.0 = Complete fabrication (can't happen organically)
```

**Fidelity calculation:**
```python
def calculate_fidelity(story):
    true_elements = extract_elements(story.true_events)
    current_elements = extract_elements(story.current_telling)

    matches = 0
    for element in true_elements:
        if similar_element_exists(element, current_elements):
            matches += 1

    return matches / len(true_elements)
```

### Influence (Integer)
How much does hearing this story affect belief?

```
Factors:
+ Emotional intensity of events
+ Miraculous content
+ Personal relevance to listener
+ Teller's credibility
+ Story's age (old stories feel more "true")
- Contradicts listener's existing beliefs
- Teller is distrusted
```

### Themes (Tags)
Abstract concepts the story carries. Used for:
- Grouping related stories
- Understanding cultural values
- Tracking narrative evolution

```
Common themes:
[sacrifice] [salvation] [punishment] [mercy] [creation]
[destruction] [love] [betrayal] [wisdom] [foolishness]
[nature] [civilization] [death] [rebirth] [journey]
```

### Carriers (List)
Who knows this story. When empty, story is dead.

### Generations (Integer)
How many times retold. Higher = more drift.

---

## Story Transmission

### When Stories Are Told

Stories don't automatically spread. Specific situations trigger telling:

1. **Seasonal gatherings** - Festivals, harvests, winter nights
2. **Rites of passage** - Children come of age, hear the lore
3. **Crisis moments** - Disaster strikes, people seek meaning
4. **Direct questions** - Someone asks about the gods
5. **Teaching moments** - Parent warns child
6. **Death of elder** - Rush to record what they knew

### Transmission Probability

```python
def will_story_be_told(teller, story, context):
    base_chance = 0.05  # 5% per turn

    # Modifiers
    if context.is_gathering:
        base_chance += 0.20
    if context.recent_disaster:
        base_chance += 0.15
    if teller.personality.storytelling > 0.7:
        base_chance += 0.10
    if story.generations == 1:  # Fresh story, eager to share
        base_chance += 0.15
    if teller.age > 70:  # Elders tell more stories
        base_chance += 0.10

    return random() < base_chance
```

### Listener Selection

Who hears the story matters:

```python
def select_listener(teller, village):
    candidates = []

    # Family first
    for relative in teller.family:
        if relative.age < teller.age:
            candidates.append((relative, 0.4))

    # Close friends
    for friend in teller.close_relationships:
        candidates.append((friend, 0.2))

    # Community (gatherings only)
    if context.is_gathering:
        for villager in village.present:
            candidates.append((villager, 0.1))

    return weighted_random_choice(candidates)
```

---

## Story Mutation Rules

When a story is retold, it changes. The LLM applies these transformations:

### 1. Memory Decay
Older memories lose detail.

```
Affects: Specific numbers, exact sequences, minor characters
Example:
  Before: "She prayed for three days at the eastern stone"
  After: "She prayed for many days at the old shrine"
```

### 2. Emotional Amplification
Feelings grow stronger.

```
Affects: Intensity of events, stakes
Example:
  Before: "The village was worried about the drought"
  After: "The village was dying, all hope lost"
```

### 3. Hero Inflation
Key figures become more exceptional.

```
Affects: Abilities, status, virtue of protagonists
Example:
  Before: "Mira was a farmer who prayed"
  After: "Mira was a holy woman, pure of heart"
```

### 4. Causality Simplification
Complex causes become simple.

```
Affects: Explanations, motivations
Example:
  Before: "Rain came due to weather patterns changing"
  After: "Rain came because the god willed it"
```

### 5. Moral Insertion
Lessons are added.

```
Affects: Framing, conclusions
Example:
  Before: "Orin didn't believe and then got sick"
  After: "Orin's blasphemy brought illness as punishment"
```

### 6. Detail Substitution
Forgotten details replaced with plausible ones.

```
Affects: Names, places, objects
Example:
  Before: "She went to the stone by the river"
  After: "She climbed the sacred mountain"
```

### 7. Conflation
Multiple events merge into one.

```
Affects: Separate events with similarities
Example:
  Before: "Mira prayed for rain. Years later, her daughter healed the sick."
  After: "Mira called rain and healed the sick with divine power"
```

---

## Story Death

Stories die when their last carrier dies without passing them on.

### Death Conditions

```python
def check_story_death(story, village):
    living_carriers = [c for c in story.carriers if c.is_alive]

    if len(living_carriers) == 0:
        story.status = "dead"
        log_story_death(story)
        return True

    return False
```

### Warning System

Player sees warnings when stories are endangered:

```
⚠️ ENDANGERED STORY: "The First Miracle"

Last carriers:
- Elder Tam (age 87, poor health)
- Old Wren (age 82, rarely speaks)

Neither has told this story in 3 years.
Estimated survival: 2-5 years without intervention.
```

### Player Intervention

You can try to save endangered stories:
- Whisper to a carrier to tell the story
- Whisper to a young villager to ask the elder
- Manifest in a dream referencing the story

---

## Story Revival

Dead stories can sometimes return.

### Revival Triggers

1. **Archaeological discovery** - Old shrine, carving, artifact found
2. **Foreign visitor** - Brings variant from distant land
3. **Divine intervention** - You manifest and retell it
4. **Dreams** - Villager dreams of forgotten events

### Revival Mechanics

```python
def attempt_revival(story, trigger):
    if story.status != "dead":
        return

    # Revival creates a new, mutated version
    revived = Story(
        true_events=story.true_events,
        current_telling=generate_revival_telling(story, trigger),
        generations=story.generations + 1,
        fidelity=story.fidelity * 0.5,  # Major degradation
        carriers=[trigger.discoverer]
    )

    return revived
```

Revived stories are heavily degraded—fragments of the original.

---

## Story Competition

When multiple gods exist, their stories compete.

### Attention Economy

Villagers have limited "story bandwidth." They can only remember so many stories, tell so many per year.

```python
VILLAGER_STORY_CAPACITY = 20-50  # varies by personality
TELLINGS_PER_YEAR = 5-15        # varies by personality
```

### Dominant Narrative

The most-told stories shape belief:

```python
def calculate_narrative_dominance(village):
    story_counts = {}
    for villager in village:
        for story in villager.known_stories:
            god = story.associated_god
            story_counts[god] = story_counts.get(god, 0) + 1

    total = sum(story_counts.values())
    return {god: count/total for god, count in story_counts.items()}
```

A god with 60% narrative dominance will tend to gain believers over time.

### Counter-Narratives

Competing stories can cancel each other:

```
Story A: "The river god brought fish"
Story B: "The fish come from the sea, not gods"

If both circulate, belief impact is reduced.
```

---

## Story UI Concepts

### Story List View
```
╔═══════════════════════════════════════════════════════╗
║ 📜 YOUR STORIES                          [Filter ▼]  ║
╠═══════════════════════════════════════════════════════╣
║                                                       ║
║ ● The First Miracle          Gen 4 │ 34% │ 47 know  ║
║   └─ "Prophet Mira summoned rain from heaven..."     ║
║                                                       ║
║ ● The Healing of Jin         Gen 2 │ 78% │ 12 know  ║
║   └─ "The god cured the blacksmith's fever..."       ║
║                                                       ║
║ ⚠ The Old Stone [ENDANGERED] Gen 6 │ 12% │ 2 know   ║
║   └─ "Before the village, there was the stone..."    ║
║                                                       ║
║ ◐ Orin's Doubt [MIXED]       Gen 1 │ 95% │ 8 know   ║
║   └─ "The skeptic Orin says there are no gods..."    ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
```

### Story Detail View
```
╔═══════════════════════════════════════════════════════╗
║ 📜 THE FIRST MIRACLE                                  ║
╠═══════════════════════════════════════════════════════╣
║                                                       ║
║ TRUTH (Turn 5):                                       ║
║ You caused rain during drought. Mira witnessed.       ║
║                                                       ║
║ CURRENT TELLING:                                      ║
║ "In the time of the Great Drought, the prophet Mira  ║
║  climbed the sacred mountain and wrestled with the   ║
║  Storm Spirit for three days. She won, and the       ║
║  spirit's tears became rain that saved the village." ║
║                                                       ║
╠═══════════════════════════════════════════════════════╣
║ LINEAGE:                                              ║
║ ┌─ v1: Mira (eyewitness) ────────────────── 98%     ║
║ ├─ v2: Kira (Mira's daughter) ───────────── 71%     ║
║ ├─ v3: Village elders (gathering) ────────  45%     ║
║ └─ v4: Current generation ───────────────── 34%     ║
║                                                       ║
╠═══════════════════════════════════════════════════════╣
║ STATS                                                 ║
║ Fidelity: 34% │ Generations: 4 │ Carriers: 47        ║
║ Themes: [rain] [prophet] [sacrifice] [salvation]     ║
║ Influence: +12 belief when told                      ║
║ Tellings this year: 8                                ║
╚═══════════════════════════════════════════════════════╝
```

### Story Lineage Visualization
```
Turn 5                              Now (Turn 180)
  │                                      │
  ▼                                      ▼
[Mira]──────[Kira]──────[Tam]──────[village]
  │            │           │           │
"Rain came   "Mother     "The old    "Prophet
 when I      prayed and   woman had   Mira
 prayed"     sky opened"  god's ear"  wrestled
                                      the Storm"

 98%          71%         45%         34%
fidelity    fidelity    fidelity    fidelity
```

---

## Prompt Templates

### Story Mutation Prompt

```
SYSTEM:
You are simulating oral tradition in a fantasy world where
stories naturally evolve as they're retold across generations.

TELLER: {teller.name}
- Age: {teller.age}
- Personality: {teller.personality}
- Relationship to story: {teller.relationship_to_events}
- Current mood: {teller.mood}

LISTENER: {listener.name}
- Age: {listener.age}
- Already knows about gods: {listener.belief_state}

STORY (as teller knows it):
"{story.current_telling}"

ORIGINAL EVENTS (for reference, teller may not know these):
{story.true_events}

CONTEXT:
- Setting: {context.setting} (fireside, gathering, private)
- Recent events: {context.recent_events}
- Generations since original: {story.generations}

TASK:
Write how {teller.name} tells this story to {listener.name}.

Apply realistic oral tradition effects:
- Memory gaps (fill with plausible details)
- Emotional amplification
- Personal perspective of teller
- Moral lessons if teller is didactic
- Simplification of complex causality

The story should be 2-4 sentences, in the teller's voice.
Do not break character or add meta-commentary.
```

### Story Creation Prompt (for new events)

```
SYSTEM:
A significant event has occurred. Generate the initial story
that witnesses will tell.

EVENT:
{event.description}

WITNESS: {witness.name}
- Personality: {witness.personality}
- Prior belief: {witness.belief_state}
- Relationship to event: {witness.involvement}

TASK:
Write the story as {witness.name} would first tell it.
This is an eyewitness account—relatively accurate but
filtered through their personality and beliefs.

Keep it to 2-3 sentences.
```

---

*Document version: 0.1*
