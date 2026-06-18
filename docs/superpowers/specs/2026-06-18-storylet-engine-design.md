# Storylet Engine — Authored Narrative Layer (Brainstorm / Design)

**Status:** brainstorm + first-proof runtime built (`src/story/`), no game integration yet.
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

## 6. Integration seam (next, not yet done)

- A `StoryHost` adapter backed by `GameBus` (`read` → `GameBus.query`, `dispatch` →
  `GameBus.emit`), with `allowedVerbs` = `bus.capabilities()`.
- Connect to the existing **single-beat staging** (`src/sim/threads/staging-types.ts`):
  a `StagedBeat` on fire could *enter a storylet* — the storylet engine is the branching
  layer that single-beat `StagedBeat.hard` currently lacks.
- A `FateDirector implements Director` (Track 4): `enrich` rewrites slots from
  `exemplars`; `select` picks storylets for pacing/theme/player-model. Async LLM driver
  is a separate slice from the sync no-key driver.
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
