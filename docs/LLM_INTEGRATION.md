# LLM Integration Architecture

How the LLM animates the world.

---

## Overview

The LLM serves as the "soul" of the simulation. It handles:

1. **NPC Reactions** - How villagers respond to player actions
2. **Story Mutation** - How stories change when retold
3. **World Events** - Generating organic events
4. **NPC Inner Lives** - Thoughts, dialogue, personality expression
5. **Interpretation** - How the world makes meaning of miracles

---

## LLM Call Strategy

### When to Call the LLM

Not every operation needs an LLM. Use deterministic code when possible.

| Operation | LLM? | Reason |
|-----------|------|--------|
| Move villager | No | Pathfinding is deterministic |
| Calculate belief | No | Math formula |
| Check story death | No | Simple condition |
| Generate NPC reaction | **Yes** | Needs narrative |
| Mutate story | **Yes** | Creative transformation |
| Create event | **Yes** | Narrative generation |
| Describe miracle result | **Yes** | Interpretation |

### Batching

Batch LLM calls where possible to reduce latency:

```typescript
// Bad: Sequential calls
for (const villager of witnesses) {
  const reaction = await llm.generateReaction(villager, event);
}

// Good: Parallel batch
const reactions = await llm.batchGenerate(
  witnesses.map(v => ({
    type: "reaction",
    villager: v,
    event: event
  }))
);
```

### Caching

Cache common patterns:

```typescript
interface LLMCache {
  // Personality descriptions (stable)
  personalityDescriptions: Map<VillagerId, string>;

  // Recent reactions (may repeat within session)
  recentReactions: Map<string, string>;

  // Story tellings (same teller+story = similar result)
  storyTellings: Map<string, string>;
}
```

---

## Prompt Templates

### System Prompt (Shared Context)

All prompts include this base context:

```
SYSTEM:
You are the world-soul of a fantasy simulation called "Small Gods."
You animate villagers, mutate stories, and generate events.

WORLD RULES:
- Gods gain power from genuine belief, not fear or habit
- Stories evolve as they're retold across generations
- Villagers have rich inner lives and memories
- The supernatural is real but subtle
- Tone: Pratchett-esque (serious themes, wry observations)

STYLE GUIDELINES:
- Be concise (2-4 sentences unless more needed)
- Show personality through word choice and perspective
- Embrace ambiguity (not everything has clear meaning)
- Allow for skepticism and doubt
- Avoid purple prose; prefer grounded language

CURRENT WORLD STATE:
{world.summary}

CURRENT TURN: {world.turn} (Year {world.year}, {world.season})
```

### NPC Reaction Prompt

When the player does something and villagers witness/experience it:

```
CONTEXT:
The god has taken an action. Simulate how {villager.name} reacts.

ACTION:
{action.description}

VILLAGER: {villager.name}
- Age: {villager.age}
- Personality: {villager.personality.summary}
- Current belief: {villager.belief.summary}
- Recent experiences: {villager.recentExperiences}
- Relationship to event: {villager.relationshipToEvent}

WITNESSES:
{otherWitnesses.map(w => w.name).join(", ")}

TASK:
Describe {villager.name}'s immediate reaction and any lasting impact.

Consider:
- Do they attribute this to the god?
- Does it strengthen or weaken belief?
- Do they tell others? What do they say?
- How does their personality color interpretation?

Format your response as:
REACTION: [1-2 sentences of immediate response]
BELIEF_CHANGE: [increase/decrease/none] [reason]
TELLS_OTHERS: [yes/no] [if yes, who and what]
INTERNAL: [1 sentence of private thought]
```

### Story Mutation Prompt

When a story passes from teller to listener:

```
CONTEXT:
{teller.name} is telling a story to {listener.name}.

THE STORY (as {teller.name} knows it):
"{story.currentTelling}"

ORIGINAL EVENTS (unknown to teller):
{story.trueEvents.summary}

TELLER: {teller.name}
- Age: {teller.age}
- Personality: {teller.personality.summary}
- How they learned this story: {story.howTellerLearned}
- Their belief state: {teller.belief.summary}
- Storytelling style: {teller.personality.storytelling > 0.7 ? "dramatic" : "plain"}

LISTENER: {listener.name}
- Age: {listener.age}
- Prior knowledge of gods: {listener.belief.summary}
- Relationship to teller: {teller.relationshipTo(listener)}

SETTING:
{context.setting} ({context.settingDescription})

TASK:
Write how {teller.name} tells this story.

Apply oral tradition effects based on generations ({story.generations}):
- Gen 1-2: Minor embellishments, personal perspective
- Gen 3-4: Details blur, emotional core strengthens
- Gen 5+: Heavy mythologization, symbolic interpretation

The story should:
- Be 2-4 sentences
- Sound like {teller.name} speaking
- Preserve emotional truth even if facts drift
- Reflect teller's beliefs and personality

OUTPUT FORMAT:
TELLING: "[The story as told]"
CHANGES: [Brief note on what shifted from previous version]
NEW_FIDELITY: [0.0-1.0 estimate]
```

### Event Generation Prompt

Creating organic world events:

```
CONTEXT:
Generate 0-2 events for this turn.

WORLD STATE:
- Season: {world.season}
- Recent weather: {world.recentWeather}
- Population: {world.population} across {world.villages.length} settlements
- Current tensions: {world.tensions}
- Recent events: {world.recentEvents}
- Years since last major event: {world.turnsSinceMajorEvent / turnsPerYear}

ACTIVE STORYLINES:
{world.activeStorylines.map(s => `- ${s.summary}`).join("\n")}

GOD'S RECENT ACTIONS:
{god.recentActions.map(a => `- ${a.summary}`).join("\n")}

TASK:
Decide if any events occur this turn. Events should:
- Feel organic to the world state
- Create opportunities for player response
- Sometimes threaten, sometimes offer growth
- Vary in scale (not every event is catastrophic)

If no event feels right, output NONE.

OUTPUT FORMAT:
EVENT_1:
  TYPE: [drought/flood/plague/birth/death/trader/omen/etc]
  DESCRIPTION: [2-3 sentences]
  AFFECTED: [villager names or "village" or tile coords]
  SEVERITY: [minor/moderate/major/catastrophic]
  STORY_POTENTIAL: [what stories might emerge]

EVENT_2: (if applicable)
  ...

Or: NONE
```

### NPC Inner Life Prompt

Generating/updating a villager's inner state:

```
CONTEXT:
Update {villager.name}'s inner life for this turn.

VILLAGER: {villager.name}
- Age: {villager.age}
- Role: {villager.socialRole}
- Personality: {villager.personality.detailed}
- Current biography: {villager.biography}
- Recent thoughts: {villager.recentThoughts}

RECENT EXPERIENCES:
{villager.recentExperiences.map(e => `- ${e.summary}`).join("\n")}

RELATIONSHIPS:
{villager.relationships.map(r => `- ${r.target.name}: ${r.type}, ${r.strength}`).join("\n")}

BELIEF STATE:
{villager.belief.detailed}

CURRENT SITUATION:
{world.getLocalContext(villager)}

TASK:
Generate {villager.name}'s current inner state.

Consider:
- What are they thinking about?
- Any worries or hopes?
- How do they feel about the gods?
- Any plans or intentions?

OUTPUT FORMAT:
THOUGHTS: [2-3 sentences of current preoccupations]
MOOD: [one word + brief explanation]
BELIEF_DIRECTION: [strengthening/weakening/stable] [why]
INTENTION: [what they plan to do soon, if anything notable]
```

### Miracle Interpretation Prompt

How the world understands a miracle:

```
CONTEXT:
The god has performed a miracle. Determine how it's interpreted.

MIRACLE:
- Type: {miracle.type}
- Scale: {miracle.scale}
- Target: {miracle.target}
- Description: {miracle.description}

WITNESSES:
{witnesses.map(w => `- ${w.name}: ${w.personality.summary}, belief: ${w.belief.strength}`).join("\n")}

NON-WITNESSES WHO WILL HEAR:
{nearbyVillagers.map(v => v.name).join(", ")}

WORLD CONTEXT:
- Recent events: {world.recentEvents}
- Current needs: {world.currentNeeds}
- Competing explanations: {world.competingNarratives}

TASK:
Determine how this miracle is interpreted by different people.

Consider:
- Believers may see divine intervention
- Skeptics may see coincidence
- Fearful may see omen or warning
- Some may attribute to wrong cause

OUTPUT FORMAT:
DOMINANT_INTERPRETATION: [How most people see it]
DISSENTING_VIEWS: [Alternative interpretations, if any]
IMMEDIATE_STORIES: [1-2 sentence summaries of stories that form]
BELIEF_IMPACT:
  - {witness1.name}: [+/-/=] [reason]
  - {witness2.name}: [+/-/=] [reason]
  ...
LONG_TERM: [How this might be remembered in a generation]
```

---

## Response Parsing

### Structured Output

Request structured output to make parsing reliable:

```typescript
interface LLMResponse {
  raw: string;
  parsed: Record<string, any>;
  parseSuccess: boolean;
  errors: string[];
}

function parseReactionResponse(raw: string): ReactionResult {
  const lines = raw.split("\n");
  const result: Partial<ReactionResult> = {};

  for (const line of lines) {
    if (line.startsWith("REACTION:")) {
      result.reaction = line.replace("REACTION:", "").trim();
    }
    if (line.startsWith("BELIEF_CHANGE:")) {
      const [direction, ...reason] = line.replace("BELIEF_CHANGE:", "").trim().split(" ");
      result.beliefChange = {
        direction: direction as "increase" | "decrease" | "none",
        reason: reason.join(" ")
      };
    }
    // ... etc
  }

  return validateReactionResult(result);
}
```

### Fallback Handling

When parsing fails:

```typescript
async function generateWithFallback<T>(
  prompt: string,
  parser: (raw: string) => T,
  fallback: T
): Promise<T> {
  try {
    const response = await llm.generate(prompt);
    return parser(response);
  } catch (parseError) {
    console.warn("Parse failed, using fallback:", parseError);
    return fallback;
  }
}
```

---

## Cost Optimization

### Token Budget per Turn

Estimate tokens per turn:

```
Base world context:     ~500 tokens
Per-villager reaction:  ~200 tokens (input) + ~100 tokens (output)
Story mutation:         ~300 tokens (input) + ~150 tokens (output)
Event generation:       ~400 tokens (input) + ~200 tokens (output)
Inner life updates:     ~250 tokens (input) + ~150 tokens (output)

Typical turn (20 villagers, 2 stories told, 1 event):
- 1 event generation:    600 tokens
- 5 witness reactions:   1500 tokens
- 2 story mutations:     900 tokens
- 3 inner life updates:  1200 tokens
- Miracle interpretation: 800 tokens (if miracle)
Total: ~5000 tokens/turn

At $3/million tokens (Claude Haiku): ~$0.015/turn
100-turn session: ~$1.50
```

### Optimization Strategies

1. **Batch similar operations**
   - Generate all reactions in one call with numbered outputs

2. **Skip unnecessary updates**
   - Don't update inner life for villagers with no recent experiences

3. **Use smaller models for routine tasks**
   - Haiku for simple reactions
   - Sonnet for important story mutations
   - Opus for pivotal moments (optional)

4. **Cache personality descriptions**
   - Generate once, reuse in prompts

5. **Summarize instead of full detail**
   - "Villagers generally react positively" vs individual reactions

```typescript
interface LLMConfig {
  // Model selection per task
  models: {
    reaction: "haiku";
    storyMutation: "sonnet";
    eventGeneration: "sonnet";
    innerLife: "haiku";
    pivotalMoment: "sonnet";
  };

  // When to skip
  skipInnerLifeUpdate: (v: Villager) => v.recentExperiences.length === 0;
  batchReactionsThreshold: 3;  // Batch if more than 3 witnesses
}
```

---

## Consistency Mechanisms

### Character Voice Consistency

Keep characters sounding like themselves:

```typescript
interface CharacterVoice {
  // Stable traits (don't change)
  speechPatterns: string[];    // "uses 'reckon'", "formal speech"
  vocabulary: "simple" | "educated" | "archaic";
  quirks: string[];            // "always mentions weather"

  // Generated once, cached
  voiceSummary: string;
}

function buildVoicePrompt(villager: Villager): string {
  return `
    ${villager.name}'s speech patterns:
    - Vocabulary: ${villager.voice.vocabulary}
    - Patterns: ${villager.voice.speechPatterns.join(", ")}
    - Quirks: ${villager.voice.quirks.join(", ")}

    Example of their voice: "${villager.voice.voiceSummary}"
  `;
}
```

### World State Consistency

Prevent contradictions:

```typescript
interface ConsistencyChecks {
  // Before generating
  validatePromptContext(prompt: string, world: WorldState): string[];

  // After generating
  validateResponse(response: string, world: WorldState): {
    valid: boolean;
    contradictions: string[];
    corrected: string;
  };
}

// Example contradiction detection
function checkContradictions(response: string, world: WorldState): string[] {
  const issues: string[] = [];

  // Check for dead people being mentioned as alive
  for (const deadVillager of world.deadVillagers) {
    if (response.includes(`${deadVillager.name} said`) ||
        response.includes(`${deadVillager.name} walked`)) {
      issues.push(`References dead villager ${deadVillager.name} as alive`);
    }
  }

  // Check for impossible weather
  if (world.season === "winter" && response.includes("scorching heat")) {
    issues.push("Weather inconsistent with season");
  }

  return issues;
}
```

### Memory Management

Track what the LLM "knows" vs what it's told:

```typescript
interface WorldSummary {
  // Always included (core facts)
  essential: {
    turn: number;
    season: string;
    population: number;
    godPower: number;
    majorTensions: string[];
  };

  // Include if relevant
  contextual: {
    recentEvents: WorldEvent[];
    relevantVillagers: Villager[];
    activeStories: Story[];
  };

  // Never include (save tokens)
  omitted: {
    fullVillagerList: Villager[];
    allHistoricalEvents: WorldEvent[];
    completeBiographies: string[];
  };
}

function buildPromptContext(
  world: WorldState,
  focus: "reaction" | "story" | "event"
): string {
  const summary = new WorldSummary(world);

  switch (focus) {
    case "reaction":
      return summary.essential + summary.contextual.recentEvents;
    case "story":
      return summary.essential + summary.contextual.activeStories;
    case "event":
      return summary.essential + summary.contextual.relevantVillagers;
  }
}
```

---

## Error Handling

### Retry Strategy

```typescript
async function llmCallWithRetry<T>(
  promptFn: () => string,
  parser: (raw: string) => T,
  options: {
    maxRetries: number;
    backoffMs: number;
    fallback: T;
  }
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i < options.maxRetries; i++) {
    try {
      const prompt = promptFn();
      const response = await llm.generate(prompt);
      return parser(response);
    } catch (error) {
      lastError = error;
      await sleep(options.backoffMs * (i + 1));

      // On retry, simplify prompt
      if (i > 0) {
        console.log(`Retry ${i + 1}, simplifying prompt`);
      }
    }
  }

  console.error("LLM call failed after retries:", lastError);
  return options.fallback;
}
```

### Graceful Degradation

When LLM is unavailable:

```typescript
interface FallbackBehavior {
  // Simple deterministic alternatives
  reaction: (villager: Villager, event: WorldEvent) => string;
  storyMutation: (story: Story) => Story;
  eventGeneration: (world: WorldState) => WorldEvent | null;
}

const fallbacks: FallbackBehavior = {
  reaction: (v, e) => {
    if (v.belief.strength > 0.5) {
      return `${v.name} sees this as a sign from the gods.`;
    }
    return `${v.name} watches with uncertainty.`;
  },

  storyMutation: (story) => ({
    ...story,
    currentTelling: story.currentTelling,  // No change
    generations: story.generations + 1,
    fidelity: story.fidelity * 0.95,  // Slight degradation
  }),

  eventGeneration: (world) => {
    // Simple random event from templates
    if (Math.random() < 0.1) {
      return randomEventFromTemplates(world);
    }
    return null;
  },
};
```

---

## Testing LLM Integration

### Prompt Testing

```typescript
describe("Story Mutation Prompt", () => {
  it("should produce valid story format", async () => {
    const story = createTestStory();
    const teller = createTestVillager({ personality: { storytelling: 0.8 } });
    const listener = createTestVillager({ age: 12 });

    const response = await generateStoryMutation(story, teller, listener);

    expect(response.telling).toBeDefined();
    expect(response.telling.length).toBeGreaterThan(20);
    expect(response.telling.length).toBeLessThan(500);
    expect(response.newFidelity).toBeGreaterThanOrEqual(0);
    expect(response.newFidelity).toBeLessThanOrEqual(1);
  });

  it("should reflect teller personality", async () => {
    const story = createTestStory();

    const skepticTeller = createTestVillager({
      personality: { skepticism: 0.9 }
    });
    const piousTeller = createTestVillager({
      personality: { piety: 0.9 }
    });

    const skepticVersion = await generateStoryMutation(story, skepticTeller);
    const piousVersion = await generateStoryMutation(story, piousTeller);

    // Skeptic version should downplay supernatural
    // Pious version should emphasize divine
    expect(skepticVersion.telling).not.toEqual(piousVersion.telling);
  });
});
```

### Consistency Testing

```typescript
describe("World Consistency", () => {
  it("should not reference dead villagers as alive", async () => {
    const world = createTestWorld();
    const deadVillager = world.villagers[0];
    deadVillager.isAlive = false;

    const event = await generateEvent(world);

    expect(event.description).not.toContain(`${deadVillager.name} said`);
    expect(event.description).not.toContain(`${deadVillager.name} walked`);
  });
});
```

---

*Document version: 0.1*
