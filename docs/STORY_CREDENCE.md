# Story Credence System

How much NPCs believe the stories they hear.

---

## The Problem

Currently, stories spread and affect belief uniformly. But in reality:

- I trust my mother more than a stranger
- Seeing is believing (eyewitnesses > hearsay)
- Past experiences color interpretation
- Extraordinary claims require extraordinary evidence

**Credence** models how much a listener actually *believes* a story they hear.

---

## Credence Formula

```
Story Impact = story.influence × credence × listener.openness

Where:
  credence = base_trust
           × source_reliability
           × evidence_factor
           × consistency_factor
           × extraordinary_discount
           × listener.baseline_credulity
```

---

## Baseline Credulity

Different people have different default levels of credulity based on their background, education, and life experience.

### Credulity by Background

| Background | Credulity | Rationale |
|------------|-----------|-----------|
| Rural farmer | 0.9 | Lives close to nature, sees mystery everywhere |
| Village elder | 0.85 | Traditional, values old stories |
| Child | 0.95 | Accepts what adults say |
| Herder (isolated) | 0.9 | Lonely work, talks to gods |
| Fisher | 0.8 | Superstitious, respects the sea |
| Craftsman | 0.7 | Practical, but respects tradition |
| Trader | 0.5 | Seen many beliefs, skeptical of all |
| Healer | 0.6 | Knows natural explanations exist |
| Outsider/Traveler | 0.4 | Exposed to many contradicting beliefs |
| Scholar (rare) | 0.3 | Seeks rational explanations |
| Priest (own god) | 0.9 | Believes their god, doubts others |
| Priest (other god) | 0.2 | Actively disbelieves rival stories |

### Education Modifier

```python
def get_education_modifier(villager):
    # Simple model: more educated = more skeptical of miraculous claims
    # but also more likely to believe well-evidenced claims

    if villager.education == "none":
        return {
            "miraculous_claims": 1.0,  # Believes easily
            "evidenced_claims": 0.8    # Doesn't weigh evidence well
        }

    if villager.education == "basic":
        return {
            "miraculous_claims": 0.85,
            "evidenced_claims": 0.9
        }

    if villager.education == "learned":
        return {
            "miraculous_claims": 0.5,   # Skeptical of miracles
            "evidenced_claims": 1.2     # But respects evidence more
        }

    if villager.education == "scholar":
        return {
            "miraculous_claims": 0.3,   # Very skeptical
            "evidenced_claims": 1.5     # Strong evidence sways them
        }
```

### Life Experience Modifier

Credulity shifts based on personal history:

```python
def get_experience_modifier(villager):
    modifier = 1.0

    # Witnessed genuine miracles → more credulous
    if len(villager.witnessed_miracles) > 0:
        modifier += 0.1 * min(len(villager.witnessed_miracles), 3)

    # Suffered tragedy gods didn't prevent → less credulous
    if villager.major_losses > 2:
        modifier -= 0.15

    # Traveled widely → more skeptical (seen contradictions)
    if villager.has_traveled:
        modifier -= 0.1

    # Nearly died and "saved" → more credulous
    if villager.near_death_saved:
        modifier += 0.2

    # Been deceived by false prophet → less credulous
    if villager.deceived_by_prophet:
        modifier -= 0.25

    return max(0.2, min(1.2, modifier))  # Clamp to reasonable range
```

### Age Modifier

Age affects credulity in complex ways:

```python
def get_age_modifier(villager):
    age = villager.age

    if age < 12:
        return 1.1   # Children believe readily

    if age < 20:
        return 0.85  # Teenagers often question

    if age < 40:
        return 0.9   # Adults are practical

    if age < 60:
        return 0.95  # Middle-aged return to tradition

    return 1.05      # Elders embrace meaning/legacy
```

### Full Baseline Calculation

```python
def calculate_baseline_credulity(villager):
    # Start with background default
    base = CREDULITY_BY_BACKGROUND[villager.background]

    # Apply education (affects miraculous claims differently)
    education = get_education_modifier(villager)

    # Apply life experience
    experience = get_experience_modifier(villager)

    # Apply age
    age = get_age_modifier(villager)

    # Combine
    credulity = base * experience * age

    # Store both miraculous and evidenced modifiers
    return {
        "base": credulity,
        "miraculous": credulity * education["miraculous_claims"],
        "evidenced": credulity * education["evidenced_claims"]
    }
```

### Using Credulity in Credence

```python
def calculate_credence(story, teller, listener, world):
    base = get_base_trust(teller, listener)
    reliability = get_source_reliability(teller)
    evidence = get_evidence_factor(story, listener, world)
    consistency = get_consistency_factor(story, listener)
    extraordinary = get_extraordinary_discount(story)

    # Get appropriate credulity based on story type
    credulity = listener.credulity
    if story.contains_miraculous_claims:
        credulity_factor = credulity["miraculous"]
    else:
        credulity_factor = credulity["base"]

    # If strong evidence, use evidenced modifier
    if evidence > 1.5:
        credulity_factor = max(credulity_factor, credulity["evidenced"])

    credence = base * reliability * evidence * consistency * extraordinary * credulity_factor

    return max(0.0, min(1.0, credence))
```

### Gameplay Implications

| Villager Type | Strategy |
|---------------|----------|
| **Rural farmers** | Easy converts, but stories mutate wildly |
| **Traders** | Hard to convert, but their belief carries weight |
| **Children** | Believe everything, grow up with your stories |
| **Scholars** | Need strong evidence, but very influential |
| **Elders** | Repositories of tradition, shape what survives |

### Example Credulity Scores

```
Mira (farmer, age 45, witnessed miracle):
  Background: 0.9 (farmer)
  Education: 1.0 (none)
  Experience: 1.2 (witnessed miracle)
  Age: 0.95
  → Miraculous credulity: 1.03 (very credulous)

Orin (trader, age 38, traveled widely):
  Background: 0.5 (trader)
  Education: 0.85 (basic literacy)
  Experience: 0.9 (traveled)
  Age: 0.9
  → Miraculous credulity: 0.34 (skeptical)

Young Jin (child, age 8):
  Background: 0.9 (village)
  Education: 1.0 (none yet)
  Experience: 1.0 (no major events)
  Age: 1.1 (child)
  → Miraculous credulity: 0.99 (believes everything)
```

### Factors Explained

#### 1. Base Trust (Relationship)

How much does the listener trust the teller?

| Relationship | Base Trust |
|--------------|------------|
| Parent | 0.9 |
| Spouse | 0.85 |
| Sibling | 0.8 |
| Close friend | 0.75 |
| Elder (respected) | 0.7 |
| Neighbor | 0.6 |
| Acquaintance | 0.4 |
| Stranger | 0.2 |
| Known liar | 0.05 |
| Enemy/rival | 0.1 |

```python
def get_base_trust(teller, listener):
    relationship = get_relationship(teller, listener)

    if relationship:
        return TRUST_BY_RELATIONSHIP[relationship.type] * relationship.strength
    else:
        # Strangers - modified by reputation
        return 0.2 * teller.reputation
```

#### 2. Source Reliability

Is the teller known for truth or embellishment?

```python
def get_source_reliability(teller):
    # Track history of teller's stories vs reality
    if teller.social_role == "storyteller":
        # Professional storytellers embellish - everyone knows this
        return 0.6
    if teller.personality.honesty > 0.8:
        return 1.0
    if teller.known_lies > 3:
        return 0.3

    return 0.7 + (teller.personality.honesty * 0.3)
```

#### 3. Evidence Factor

Does the listener have corroborating evidence?

| Evidence Type | Multiplier |
|---------------|------------|
| Listener witnessed same event | 2.0 |
| Listener saw aftermath/results | 1.5 |
| Multiple independent sources | 1.3 per source (cap 2.0) |
| Listener experienced similar | 1.2 |
| No evidence | 1.0 |
| Contradicts listener's experience | 0.3 |

```python
def get_evidence_factor(story, listener, world):
    factor = 1.0

    # Did they witness it themselves?
    if listener.id in story.true_events[0].witnesses:
        factor *= 2.0

    # Have they seen results?
    if listener_saw_aftermath(listener, story, world):
        factor *= 1.5

    # Multiple sources?
    sources = count_independent_sources(listener, story)
    if sources > 1:
        factor *= min(2.0, 1.0 + (sources - 1) * 0.3)

    # Contradicts experience?
    if contradicts_experience(listener, story):
        factor *= 0.3

    return factor
```

#### 4. Consistency Factor

Does this story fit with what the listener already believes?

```python
def get_consistency_factor(story, listener):
    # Stories that fit existing beliefs are more credible
    existing_beliefs = listener.belief

    if story.associated_god == existing_beliefs.target:
        if existing_beliefs.strength > 0.7:
            return 1.3  # "Of course my god did this!"
        return 1.1

    if story.associated_god != existing_beliefs.target and existing_beliefs.strength > 0.5:
        return 0.7  # "My god is the true one, not theirs"

    if existing_beliefs.type == "skeptic":
        return 0.5  # Skeptics doubt all divine stories

    return 1.0
```

#### 5. Extraordinary Discount

More miraculous claims need more proof.

```python
def get_extraordinary_discount(story):
    # Based on story content
    miracle_scale = story.miracle_scale  # tiny/small/medium/large

    discounts = {
        "tiny": 0.95,    # Candle relit - easy to believe
        "small": 0.85,   # Rain came - plausible
        "medium": 0.65,  # Plague cured - remarkable
        "large": 0.40,   # Mountain moved - extraordinary
    }

    return discounts.get(miracle_scale, 0.8)
```

---

## Full Credence Calculation

```python
def calculate_credence(story, teller, listener, world):
    base = get_base_trust(teller, listener)
    reliability = get_source_reliability(teller)
    evidence = get_evidence_factor(story, listener, world)
    consistency = get_consistency_factor(story, listener)
    extraordinary = get_extraordinary_discount(story)

    credence = base * reliability * evidence * consistency * extraordinary

    # Clamp to valid range
    return max(0.0, min(1.0, credence))

def apply_story_to_listener(story, teller, listener, world):
    credence = calculate_credence(story, teller, listener, world)
    openness = 1.0 - listener.personality.skepticism

    impact = story.influence * credence * openness

    # Update belief
    if story.type == "miracle" and story.associated_god:
        old_belief = listener.belief.strength
        listener.belief.strength += impact * 0.1
        listener.belief.strength = min(1.0, listener.belief.strength)

        # Track why belief changed
        listener.belief.history.append({
            "turn": world.turn,
            "change": listener.belief.strength - old_belief,
            "reason": f"Heard '{story.name}' from {teller.name}",
            "credence": credence
        })
```

---

## Credence Modifiers Over Time

### Building Trust

Trust between individuals grows through:

```python
def update_trust(teller, listener, story, outcome):
    relationship = get_relationship(teller, listener)

    if outcome == "story_verified":
        # Listener later witnessed truth of story
        relationship.trust += 0.1
        teller.reputation += 0.05

    elif outcome == "story_contradicted":
        # Listener found story to be false
        relationship.trust -= 0.15
        teller.reputation -= 0.1

    elif outcome == "consistent_telling":
        # Teller's version matches others
        relationship.trust += 0.02
```

### Prayer Results

Personal experience trumps hearsay:

```python
def process_prayer_result(villager, god, outcome):
    if outcome == "answered":
        # Prayer seemingly answered
        villager.personal_evidence[god.id] += 1
        villager.belief.strength += 0.15

        # Future stories about this god get credence boost
        villager.credence_modifiers[god.id] = {
            "type": "personal_experience",
            "value": 1.3,
            "reason": "Prayer answered"
        }

    elif outcome == "unanswered":
        villager.unanswered_prayers += 1

        if villager.unanswered_prayers > 3:
            # Doubt creeps in
            villager.credence_modifiers[god.id] = {
                "type": "disappointment",
                "value": 0.7,
                "reason": "Prayers unanswered"
            }
```

### Witnessing Miracles

Direct witness = maximum credence for related stories:

```python
def process_witness(villager, event):
    if event.type == "miracle":
        god = event.associated_god

        # This villager now has firsthand evidence
        villager.witnessed_miracles.append({
            "event": event.id,
            "god": god.id,
            "turn": world.turn
        })

        # Massive credence boost for stories about this god
        villager.credence_modifiers[god.id] = {
            "type": "eyewitness",
            "value": 2.0,
            "reason": f"Witnessed {event.description}"
        }

        # Also affects belief directly
        villager.belief.target = god.id
        villager.belief.strength = min(1.0, villager.belief.strength + 0.3)
        villager.belief.type = "genuine"  # Eyewitness = genuine belief
```

---

## Credence Affects Story Spread

Low-credence stories spread less effectively:

```python
def will_listener_retell(listener, story, credence):
    # Base chance modified by how much they believed it
    base_chance = listener.personality.storytelling * 0.2

    # Only retell if you believe it enough
    if credence < 0.3:
        return False  # "I don't believe that story"

    if credence < 0.5:
        base_chance *= 0.5  # Might mention it skeptically

    if credence > 0.8:
        base_chance *= 1.5  # Eager to share

    return random() < base_chance
```

### Skeptical Retellings

When credence is medium-low, stories might be told *skeptically*:

```python
def get_telling_stance(listener, credence):
    if credence > 0.8:
        return "believing"    # Tells it as truth
    if credence > 0.5:
        return "neutral"      # Tells it as "I heard..."
    if credence > 0.3:
        return "skeptical"    # Tells it as "Some say..." or adds doubt
    return "dismissive"       # Won't retell, or mocks it
```

The LLM uses this stance when generating retellings:

```
TELLING_STANCE: skeptical

Generate the story as {teller.name} tells it, but include
their doubt. They might say "Some claim..." or "I'm not
sure I believe it, but..." or add alternative explanations.
```

---

## UI Display

Show credence in story views:

```
╔═══════════════════════════════════════════════════════╗
║ 📜 "THE RAIN OF MIRA"                                 ║
╠═══════════════════════════════════════════════════════╣
║ Last told by: Elder Tam → Young Finn                  ║
║                                                       ║
║ CREDENCE FACTORS:                                     ║
║ • Tam is Finn's mentor         → Trust: 0.7          ║
║ • Tam is honest                → Reliability: 0.9    ║
║ • Finn never saw a miracle     → Evidence: 1.0       ║
║ • Finn worships same god       → Consistency: 1.2    ║
║ • "Wrestled storm god"         → Extraordinary: 0.5  ║
║                                                       ║
║ FINAL CREDENCE: 0.38                                  ║
║ FINN'S VERDICT: "A nice story, but surely exaggerated"║
╚═══════════════════════════════════════════════════════╝
```

---

## Gameplay Implications

### For the Player

1. **Choose your witnesses wisely**
   - Miracle in front of a respected elder = high credence spread
   - Miracle in front of a known liar = story won't be believed

2. **Build evidence chains**
   - Multiple small miracles > one big one
   - Consistent pattern = credible god

3. **Answer prayers strategically**
   - Answered prayers = personal evidence = high credence
   - Unanswered prayers = doubt

4. **Relationships matter**
   - Stories spread better through trust networks
   - Target well-connected believers

### Emergent Dynamics

1. **Skeptic Networks**
   - Skeptics reinforce each other's doubt
   - Hard to penetrate without direct evidence

2. **Believer Bubbles**
   - High-trust groups amplify stories
   - But may become insular

3. **Reputation Spirals**
   - Tellers who are verified gain credibility
   - Liars lose influence permanently

4. **Evidence Cascades**
   - Once critical mass of evidence, belief spreads fast
   - Pre-evidence, stories struggle

---

## Data Model Additions

```typescript
interface Villager {
  // ... existing fields ...

  // Credence tracking
  reputation: number;                    // 0-1, community trust
  knownLies: number;                     // Times caught lying
  witnessedMiracles: WitnessRecord[];    // Personal evidence
  unansweredPrayers: number;             // Disappointments
  credenceModifiers: Record<GodId, CredenceModifier>;
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

interface StoryTelling {
  // ... existing fields ...

  credence: number;              // How much listener believed
  stance: TellingStance;         // How it was told
  willRetell: boolean;           // Will listener pass it on
  verdictReason: string;         // LLM-generated explanation
}

type TellingStance = "believing" | "neutral" | "skeptical" | "dismissive";
```

---

## Integration with Existing Systems

### Story Mutation

Credence affects *how* stories mutate:

```python
if telling_stance == "skeptical":
    # Skeptical tellers add doubt, reduce miraculous elements
    prompt += """
    The teller is skeptical. They may:
    - Add naturalistic explanations
    - Use hedging language ("supposedly", "some claim")
    - Downplay miraculous elements
    - Express personal doubt
    """
```

### Belief Calculation

Replace simple story impact with credence-weighted impact:

```python
# Old
belief_change = story.influence * 0.1

# New
belief_change = story.influence * credence * listener.openness * 0.1
```

### Story Death

Low-credence stories die faster (people stop retelling what they don't believe):

```python
def check_story_spread_health(story):
    total_credence = sum(
        s.credence for s in story.recent_tellings
    )
    average_credence = total_credence / len(story.recent_tellings)

    if average_credence < 0.3:
        story.status = "dying"  # Not believed enough to survive
```

---

*Document version: 0.1*
