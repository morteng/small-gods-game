# MVP Roadmap

Minimal Viable Product for Small Gods.

---

## MVP Definition

The MVP should demonstrate the core loop:

> **Perform actions → Create stories → Stories spread & mutate → Gain/lose belief → Grow or fade**

### In Scope for MVP

- Single village (~30 villagers)
- Core god abilities: whisper, miracle (2-3 types), bless
- Story creation from witnessed miracles
- Story mutation when retold
- Story death when carriers die
- Belief calculation from stories
- 3 generations of play (~90 years)
- Text + emoji UI (MCP tools + simple iframe)
- Single LLM backend (Claude)

### Out of Scope for MVP

- Multiple villages
- Competing gods
- Prophet system
- Curses (keep it positive for MVP)
- Manifestation
- Complex events (disasters, wars)
- Save/load
- Rich visual UI

---

## Architecture Decisions for MVP

### Simplifications

| Full Design | MVP Version |
|-------------|-------------|
| Infinite map | Fixed 15x15 grid |
| Complex terrain | 4 terrain types |
| Full personality | 3 key traits |
| All story types | Miracle stories only |
| Complex belief | Simple 0-1 scale |
| Multiple LLM models | Single model (Sonnet) |

### Tech Stack

- **Runtime:** Node.js + TypeScript
- **MCP SDK:** @modelcontextprotocol/sdk
- **LLM:** Anthropic Claude (via SDK)
- **Storage:** In-memory (no persistence for MVP)

---

## Task Breakdown

### Phase 1: Foundation (Week 1)

#### 1.1 Project Setup
- [ ] Initialize npm project with TypeScript
- [ ] Install MCP SDK and Anthropic SDK
- [ ] Set up project structure
- [ ] Configure tsconfig.json
- [ ] Create basic entry point

#### 1.2 Data Models
- [ ] Implement Villager type
- [ ] Implement Story type
- [ ] Implement God type
- [ ] Implement WorldState type
- [ ] Implement Tile/Map types

#### 1.3 World Generation
- [ ] Create simple terrain generator (15x15)
- [ ] Generate initial village (houses, shrine)
- [ ] Generate initial villagers (~30)
- [ ] Assign relationships (families)
- [ ] Assign personalities (simplified)

### Phase 2: Core Simulation (Week 2)

#### 2.1 Belief System
- [ ] Implement belief calculation formula
- [ ] Track belief per villager
- [ ] Calculate total god power
- [ ] Implement power tiers
- [ ] Track belief changes over time

#### 2.2 Villager Lifecycle
- [ ] Implement aging (1 turn = 1 week)
- [ ] Implement death (old age, random illness)
- [ ] Implement birth (simple, married couples)
- [ ] Implement story knowledge inheritance

#### 2.3 Story System (Basic)
- [ ] Create story when miracle witnessed
- [ ] Track story carriers
- [ ] Detect endangered stories
- [ ] Remove dead stories
- [ ] Calculate story fidelity (placeholder)

### Phase 3: Player Actions (Week 3)

#### 3.1 Whisper
- [ ] Implement whisper action
- [ ] LLM generates villager response
- [ ] Update villager state based on response
- [ ] Return narrative result

#### 3.2 Miracle
- [ ] Implement miracle action (rain, healing)
- [ ] Deduct power cost
- [ ] Identify witnesses
- [ ] Generate stories from witnesses
- [ ] LLM interprets miracle

#### 3.3 Bless
- [ ] Implement bless action
- [ ] Track blessed entities
- [ ] Apply blessing effects
- [ ] Blessings expire over time

### Phase 4: LLM Integration (Week 3-4)

#### 4.1 Prompt System
- [ ] Create system prompt template
- [ ] Create reaction prompt template
- [ ] Create story mutation prompt template
- [ ] Create interpretation prompt template

#### 4.2 LLM Client
- [ ] Set up Anthropic client
- [ ] Implement generate function
- [ ] Implement response parsing
- [ ] Add error handling/retry
- [ ] Add basic caching

#### 4.3 Story Mutation
- [ ] When story is told, call LLM to mutate
- [ ] Parse mutated version
- [ ] Update story with new version
- [ ] Recalculate fidelity

### Phase 5: MCP Server (Week 4)

#### 5.1 Basic Server
- [ ] Set up MCP server structure
- [ ] Register tools
- [ ] Implement tool handlers
- [ ] Test with Claude Desktop

#### 5.2 Tools
- [ ] Implement whisper tool
- [ ] Implement miracle tool
- [ ] Implement bless tool
- [ ] Implement observe tool
- [ ] Implement advance tool

#### 5.3 Resources (Basic UI)
- [ ] Create world map renderer (emoji)
- [ ] Create status renderer
- [ ] Create story list renderer
- [ ] Register as ui:// resources

### Phase 6: Game Loop (Week 4-5)

#### 6.1 Turn Simulation
- [ ] Process player action
- [ ] Simulate NPC reactions
- [ ] Process story tellings (random)
- [ ] Mutate told stories via LLM
- [ ] Update beliefs
- [ ] Age villagers
- [ ] Check births/deaths
- [ ] Check story deaths
- [ ] Update god power

#### 6.2 Events (Simple)
- [ ] Random minor events (illness, good harvest)
- [ ] Events create story opportunities
- [ ] LLM generates event descriptions

### Phase 7: Polish & Test (Week 5)

#### 7.1 Balancing
- [ ] Tune belief decay rate
- [ ] Tune miracle costs
- [ ] Tune story mutation rate
- [ ] Test 3-generation playthrough

#### 7.2 UX
- [ ] Improve tool descriptions
- [ ] Add helpful error messages
- [ ] Create /help prompt
- [ ] Add turn summary output

#### 7.3 Testing
- [ ] Manual playtest full loop
- [ ] Test story lifecycle
- [ ] Test belief calculations
- [ ] Test LLM integration reliability

---

## Milestone Checkpoints

### Milestone 1: "Hello World" (End of Week 1)
- [ ] MCP server runs and connects to Claude Desktop
- [ ] Can call a dummy tool and get response
- [ ] World generates with villagers displayed

### Milestone 2: "First Miracle" (End of Week 2)
- [ ] Can perform a miracle
- [ ] Witnesses remember it
- [ ] Story is created
- [ ] Belief increases

### Milestone 3: "Living World" (End of Week 3)
- [ ] Villagers age and die
- [ ] Stories are told and mutate
- [ ] Can play multiple turns
- [ ] Power goes up and down

### Milestone 4: "Playable MVP" (End of Week 5)
- [ ] Full game loop works
- [ ] Can play 3 generations
- [ ] Stories survive or die
- [ ] Clear win/fade conditions
- [ ] Enjoyable to play

---

## Risk Mitigation

### Risk: LLM Costs Too High
- **Mitigation:** Start with aggressive caching, batch calls
- **Fallback:** Use Haiku for routine tasks, Sonnet for key moments

### Risk: LLM Responses Inconsistent
- **Mitigation:** Strong prompts with examples, structured output
- **Fallback:** Deterministic fallbacks for parse failures

### Risk: Game Loop Too Slow
- **Mitigation:** Profile early, parallelize LLM calls
- **Fallback:** Reduce LLM calls per turn, more deterministic logic

### Risk: Story System Too Complex
- **Mitigation:** Start with single story type (miracle)
- **Fallback:** Simplify mutation to templated changes

### Risk: Not Fun
- **Mitigation:** Playtest early (Week 3), iterate
- **Fallback:** Focus on what works, cut what doesn't

---

## Success Criteria

The MVP is successful if:

1. **Technical:** Full game loop runs without errors
2. **Narrative:** Stories feel alive and interesting
3. **Agency:** Player actions have meaningful consequences
4. **Emergence:** Unexpected things happen
5. **Engagement:** Playtester wants to see "what happens next"

---

## Post-MVP Priorities

After MVP, prioritize based on playtesting:

1. **If stories are the highlight:** Add more story types, richer mutation
2. **If villagers are compelling:** Add dialogue, deeper personalities
3. **If world feels empty:** Add events, disasters, other gods
4. **If replayability is low:** Add different starting conditions, goals
5. **If UI is limiting:** Build richer iframe interface

---

## Getting Started

```bash
# Create project
mkdir small-gods-mcp
cd small-gods-mcp
npm init -y

# Install dependencies
npm install @modelcontextprotocol/sdk @anthropic-ai/sdk
npm install -D typescript tsx @types/node

# Initialize TypeScript
npx tsc --init

# Create structure
mkdir -p src/{mcp,game,llm,ui,utils}
mkdir -p data saves

# Start coding!
touch src/index.ts
```

---

*Last updated: 2026-01-18*
