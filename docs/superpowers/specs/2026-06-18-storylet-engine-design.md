# Storylet Engine — Authored Narrative Layer (Brainstorm / Design)

**Status:** first-proof runtime + **agent-first integration layer** built (`src/story/`).
Library-level wiring to the bus and to single-beat staging done; final game.ts/UI
wiring is the one remaining step.
**Branch / worktree:** `feat/storylet-engine` @ `/Users/Morten/mcpui/sg-story`.
**Inspiration:** [jeremyfa/loreline](https://github.com/jeremyfa/loreline) — concepts borrowed, runtime rebuilt native.

## 1. What & why

An **authored-narrative layer**: deterministic, self-contained, distributable *story
packs* of branching beats. It is **not** a pivot away from the live Fate AI — it is a
**content tier that degrades gracefully**, and the same content feeds two paths:

- **No AI key** → a *dumb director* plays the pack standalone, deterministically. The
  game is fully playable with zero LLM.
- **With AI key** → Fate uses the **same** packs as a **reservoir to draw from at
  will**, narrating transitions and rewriting AI-optional slots, and can author **new**
  storylets at runtime into the same format.
- **UGC** → players author worlds + stories as packs for others to play.

> One mechanism, two **director policies**. What changes across tiers is the
> selection/presentation policy, *not* the content format or the runtime.

### The one rule that makes it work
**No IR node may REQUIRE the AI to be runnable.** Every AI-touchable slot carries a
deterministic `fallback`. This is enforced *twice*: by the TextSlot type, and by the
validator. It is what gives us the no-key path for free and the with-key path as pure
upgrade.

## 2. Borrowed from Loreline (concepts only)

| Loreline | Here |
|---|---|
| `beat` labelled node | `Storylet` (beat **+ `when` preconditions + `priority`**) |
| `character` / `state` blocks | `Scope` (dotted-key fields) + host fall-through reads |
| bare line / `name: <tag> text` | `say` node (`who` null = narration) |
| `choice` + per-option `if` guard | `choice` node + `when` on options |
| `if / else if / else` | `if` node with branches |
| `pick` / `--` variants | `{ pick: [...] }` text slot (seeded) |
| `-> Beat` jump | `goto` node |
| host `functions` (e.g. `chance`) | `chance` expr + `do`→**bus effect** |
| `interpreter.save()` / `resume()` | `Scope` snapshot + `seen` (mid-beat resume = later slice) |

**Not** borrowed: the Haxe-compiled runtime, its own RNG, its own state model, the
whitespace surface syntax. We rebuilt native so it lives inside our seeded-RNG /
command-bus / World discipline. The JSON IR is the contract the (LLM) author emits and
the validator checks; a human-readable surface syntax can come later as a view.

## 3. Two reframes baked into the design

1. **Storylets, not a hand-drawn branching+merging tree.** Merges are where authored IF
   rots and where LLM authoring is weakest. The "graph" between beats **emerges** from
   `when` preconditions over world state (Fallen London / Cultist Simulator model).
   Local branching (`choice` / `if` / `goto`) lives *inside* a beat where an LLM can hold
   it consistent. Selection *between* beats is state-gated.
2. **Beats perturb a living sim, they don't replace it.** With a key, Fate is the
   director over a real belief/lineage/time-skip world; with no key, the same world runs
   on authored content + the deterministic sim. We keep investing in the sim either way.

## 4. Architecture (what's built — `src/story/`)

```
story-ir.ts    IR types + STORY_IR_VERSION (the public contract)
story-state.ts Scope (dotted fields) + StoryHost (read fall-through + effect dispatch)
expr.ts        pure Expr/Condition eval; only entropy is the seeded Rng (chance)
text.ts        TextSlot → string: literal | pick(seeded) | fallback+enrich
director.ts    Director interface + DumbDirector (no-key reference impl)
select.ts      eligibleStorylets + selectStorylet (precondition + priority + seeded tiebreak)
runner.ts      StoryRunner: frame-stack stepper, advance()/choose(), goto-cycle guard
validate.ts    validatePack — dup ids, goto targets, empty choices, **fallback law**, verb allowlist
play.ts        scriptedPlay — headless no-key driver, returns a Transcript (test backbone)
samples/the-drought-omen.ts  first-proof pack exercising every node
```

**Sandbox boundary:** `do` effects dispatch onto the **command/query bus**, so authored
content can only invoke **registered, safe capabilities**. `validatePack(pack, {
allowedVerbs })` rejects any effect outside the allowlist *before* it runs — the gate for
imported UGC.

**Determinism:** the only entropy is the injected `Rng` (seeded sfc32). Same pack + seed
+ same choice sequence ⇒ identical transcript (proven in tests). This keeps authored
beats replayable and snapshot-compatible, and makes UGC runs reproducible across players.

## 5. Status & test results

- `src/story/` builds clean (tsc) and **20/20 tests pass** (`tests/unit/story-engine.test.ts`).
- Proven: validation, no-key playability (fallbacks only), determinism, branch
  divergence (omen/dream/silent), guarded choices, AI-optional enrichment (fallback vs
  director rewrite), reservoir selection (precondition/once/priority/tiebreak), validator
  (dup/goto/empty-choice/missing-fallback/version/verb-allowlist), goto-cycle guard, host
  read fall-through.
- **Worktree gotcha:** vitest's default *threads* pool hangs here (symlinked
  node_modules); run with `--pool=forks`.

## 6. Agent-first integration layer (BUILT this slice)

The engine is built to be something Fate can **author into, draw from, and enrich** —
not just a runtime the dumb path drives. New modules (`src/story/`):

- **`story-host-bus.ts`** — `createBusStoryHost(bus, { source })`: `dispatch` maps a
  `StoryEffect` → real `Command` → `GameBus.emit` (so `do` nodes are genuine
  divine/authoring actions, sandboxed to registered capabilities); `read` resolves
  dotted guards (`npc.<id>.faith`, `belief.power`, `world.tick`) over the query facade.
  `busAllowedVerbs(bus)` feeds the validator allowlist.
- **`story-session.ts`** — `StorySession`, the **interactive** driver (live counterpart
  to headless `scriptedPlay`): surfaces one `line`/`choice` at a time and waits;
  auto-dispatches effects between stops. The choice source is decoupled — a human clicks
  or **an agent calls `choose()`**, identical API.
- **`fate-director.ts`** — the with-AI tier, **determinism-preserving**. The runtime
  stays synchronous; the agent works at two ASYNC boundaries *between* sync steps:
  `warmEnrichment()` pre-warms a slot cache the runner reads sync (un-warmed/declined →
  fallback, so a slow/failed agent never blocks or desyncs); `chooseNext()` lets the
  agent narrow the already-eligible pool (advisory; out-of-pool ids ignored). The
  `StoryAgent` interface is the Track-4 seam (capable-tier client backs it; tests use a
  mock). The cache is also the **replay/persistence unit** — a warmed slot reproduces.
- **`pack-schema.ts`** — the **authoring contract**: `STORY_PACK_SCHEMA` (JSON Schema)
  constrains an agent's tool-input/structured-output so Fate can only EMIT valid IR;
  `parsePack()` is the ingest gate (parse → structural → `validatePack`) returning
  precise, iterable error messages. Two layers: schema = shape at generation time,
  validator = semantics (goto targets, the fallback law, the capability allowlist).
- **Single-beat staging seam** — `StagedBeat` gains an optional `storylet?: string`
  (additive, structuredClone-safe), and `StagingActivationSystem` gains a parallel
  optional `onStoryletBeat` callback (mirrors `onSoftBeat`). On fire, a beat carrying a
  storylet ref surfaces it so the game layer plays it in a `StorySession` — the
  branching/interactive payload single-beat `hard`/`soft` lacks. Existing staging + fate
  tests stay green (additive, non-breaking).

**Tests:** `tests/unit/story-integration.test.ts` (+16, total **36/36** across both story
suites; 10/10 existing staging/fate tests still green; tsc clean).

### Remaining wiring (the one next step)
Construct the `onStoryletBeat` handler in `game.ts` where `StagingActivationSystem` is
built (next to the `onSoftBeat` handler at ~game.ts:219): it creates a `StorySession`
over a loaded `StoryPack` with `createBusStoryHost(this.bus, { source: PLAYER })` and
presents stages to the UI (player) or to Fate (`FateDirector` + `StoryAgent`). Needs a
pack **registry/loader** and a UI surface for lines/choices — both deliberate decisions,
hence left for explicit sign-off rather than guessed.

- **Story package** = IR + asset manifest (stable catalogue IDs) + world seed; resolve
  assets at **author time** (bounds cost — relevant to the frozen reseed).

## 7. Open decisions

- **IR surface:** JSON-IR-only for now (validator = contract). Add Loreline-style
  human-readable syntax + `parse`/`print` later? (Recommend: defer.)
- **Mid-beat resume:** v1 snapshots scope + `seen` + current storylet, not the frame-stack
  IP (resume restarts the current storylet). Promote to full frame-stack serialization
  when wiring into `core/snapshot.ts`.
- **Selector richness:** dumb = priority + seeded tiebreak today. Cooldowns / weighting /
  tag-budgets are a later slice.
```
