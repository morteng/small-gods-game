# Create Panel — Natural-Language World Authoring (Design)

**Status:** approved (shape + v1 scope), 2026-06-03
**Epic.** Decomposes into three sub-projects; each gets its own implementation plan.
**Track:** Track 4 / Fate substrate — but this feature is *not* Fate (see §2).

---

## 1. Goal

A creator console where the author types a request in plain language — *"add three
farmers near Northvale", "make Brother Aldous a devout zealot", "remove the beggars"* —
and the **capable LLM** (deepseek-v4) turns it into concrete world edits that are
applied through the existing command channel and **recorded as replayable history**.

This is the first consumer of a new LLM **tool-calling** layer; the same layer is
later reused for the autonomous Fate brain.

## 2. This is *not* Fate

The create panel and Fate share plumbing but are different agents with opposite stances.
Keeping them separate protects the cosmology (VISION §2.1 / TECH_SPEC §2.8: Fate is
impersonal, reactive, and "amplifies, never injects arbitrary plot").

| | **Fate** (the DM brain) | **Create panel** (this spec) |
|---|---|---|
| Driver | Autonomous background loop | The author, on demand, via a prompt |
| Stance | In-world, impersonal, reactive | Out-of-character god-mode |
| Injects arbitrary content? | **No** (forbidden by canon) | **Yes** — that's the point |
| Vocabulary | Bounded authoring verbs (`bias_event`, `inject_npc`, `nudge_severity`) | Broad entity CRUD (editor tier) |
| Cost | Belief power | None (god-mode) |

The panel is labelled an **author/creator tool**, kept distinct from the in-world
divine/authoring verbs.

## 3. Architecture overview

```
 Create panel (UI)                        capable client (deepseek-v4)
 ┌────────────────────┐   prompt+tools   ┌──────────────────────────┐
 │ prompt box         │ ───────────────▶ │ LLM tool-calling          │
 │ + world summary    │ ◀─────────────── │ returns tool_calls[]      │
 │ preview / confirm  │   tool_calls     └──────────────────────────┘
 └─────────┬──────────┘
           │ confirm → editor commands (payload-carrying)
           ▼
 ┌───────────────────────────────────────────────────────────┐
 │ command channel (existing)                                 │
 │  CommandQueue → CommandExecutorSystem                      │
 │   editor tier: skip spirit/power; apply CRUD via safe API  │
 │   record {tick, command} in AuthorCommandLog (replay)      │
 │   log SimEvent ('authored_*')                              │
 └───────────────────────────────────────────────────────────┘
```

Three sub-projects, sequenced (prerequisite first):

### Sub-project 1 — Tool-calling in the LLM client *(shared substrate)*

The client is JSON-in-text only today; tool-calling does not exist. This is the
gating piece and is reused by Fate later.

- New types in `src/llm/llm-client.ts`:
  - `LLMTool { name: string; description: string; parameters: object /* JSON Schema */ }`
  - `LLMToolCall { id: string; name: string; arguments: Record<string, unknown> }`
- `LLMOptions` gains `tools?: LLMTool[]` and `toolChoice?: 'auto' | 'required' | 'none'`.
- `LLMResponse` gains `toolCalls?: LLMToolCall[]`.
- `OpenRouterProvider.generate` sends OpenAI-style `tools` / `tool_choice` and parses
  `choices[0].message.tool_calls` (OpenRouter supports this natively). `arguments`
  arrives as a JSON string per call → parse + guard.
- `OpenAIProvider`: same wiring (same request shape).
- `MockLLMProvider`: returns canned `toolCalls` when `opts.tools` is present, so
  sub-projects 2 & 3 are testable without a network.
- A small helper on `LLMClient`, e.g. `generateWithTools(messages, tools, opts)`,
  used by the capable tier. Single-shot for v1 (one request → tool calls); no
  multi-turn read loop.

### Sub-project 2 — Editor tools + recorded authoring commands *(engine)*

**Editor tier on the capability registry.** A new `tier: 'editor'` with god-mode
verbs (cost 0, no spirit, out-of-character). v1 verbs:

| verb | payload (→ JSON-schema tool params) | apply (safe API) |
|---|---|---|
| `author_spawn_npc` | `{ role, count?, near: poiId\|{x,y}, name?, faith?, understanding?, devotion? }` | `initNpcProps` + `world.addEntity`, placed near target via `registry.canPlace`; appearance seed from `ctx.rng` |
| `author_remove_entity` | `{ entityId }` *or* `{ filter: { kind?, role?, near? } }` | `world.removeEntity` (delete; god-mode, not death-to-remains) |
| `author_modify_npc` | `{ entityId, set: { name?, role?, faith?, understanding?, devotion?, needs?, mood?, activity? } }` | `world.setProperty` / `world.updateEntity` |
| `author_place_object` | `{ kind /* entityKind id */, x, y, count?, scatterRadius? }` | validate `kind` via `tryGetEntityKindDef`; `registry.canPlace`; `world.addEntity` |
| `author_move_entity` | `{ entityId, to: {x,y} }` | `world.updateEntity(id, {x,y})` |

Each verb declares: `verb`, `tier:'editor'`, `cost:0`, params JSON-schema (so the
registry can emit the LLM tool list directly), `apply(cmd, ctx)`, and `describe(cmd)`
(used for the preview text). All randomness flows through `ctx.rng` — never
`Math.random` (enforced by `tests/unit/no-random-in-sim.test.ts`).

**Payload widening.** `Command.params` is `Record<string, number|string>` — too
narrow for structured editor args. Add an optional `payload?: Record<string, unknown>`
to `Command`. Divine verbs are untouched; editor verbs read `payload`.

**Executor changes.** For `tier === 'editor'`: skip the spirit lookup and power
check; allow a non-spirit `source: 'author'`. Validate target/payload, call `apply`,
log a `SimEvent` (`authored_spawn` / `authored_remove` / `authored_modify` / …).

**Recorded authoring commands (the replayable bit).** Exogenous LLM edits cannot be
*re-derived* on replay (the model is non-deterministic), so we record the **resolved**
commands:

- `AuthorCommandLog`: an ordered `{ tick, command }[]`, owned by the timeline layer.
- **Live:** on apply, append `{ clock.now(), command }`.
- **Replay (`TimelineController.forwardSilent`):** before the executor drains at tick
  `T`, re-emit any recorded author commands with `tick === T` into the queue. They
  re-apply deterministically (same restored rng stream, no second LLM call) because
  the executor runs first in tick order both live and on replay.
- **Persistence:** the log is *not* cleared on snapshot restore (it is history, unlike
  the transient `CommandQueue`). It **truncates on timeline commit / re-roll**,
  consistent with `EventLog.truncateAfter`.
- Bonus: this same input-log mechanism could later make player divine-acts survive a
  scrub-back-then-forward (out of scope here, noted as a future generalization).

### Sub-project 3 — The Create panel UI

- A creator panel built on the shared dev chrome (`FloatingPanel` + dock rails +
  layout persistence, like the other dev panels). Toolbar-reachable (the project
  prefers buttons over shortcuts).
- Flow: **prompt box** → on send, build a **compact world summary** (settlement
  ids/coords, entity counts, NPC roster digest) + the editor tool list from the
  registry → call `llmClientCapable.generateWithTools` → receive `toolCalls`.
- **Preview / confirm:** render the proposed edits as human-readable lines (via each
  verb's `describe`), e.g. *"Spawn 3 farmers near Northvale · Remove 2 beggars"* with
  **Confirm** / **Discard**. (Default; can be made apply-on-send later.)
- **Confirm** → emit the editor commands on the channel (`source:'author'`) → they
  apply + record + log. Results / rejections (`not_implemented`, `invalid_target`,
  bad payload) surface back in the panel.
- The model resolves references like "the northern village" from the world summary in
  the prompt — no read-tool loop in v1.

## 4. Determinism & replay (the load-bearing constraint)

- All sim code stays `Math.random`-free; editor `apply` uses `ctx.rng`.
- The LLM *choice* is exogenous and recorded once; *application* is deterministic
  given the recorded command + restored rng state.
- Executor is registered first, so editor commands apply at a stable point in the tick
  (and thus a stable point in the rng stream) both live and on replay.
- `AuthorCommandLog` makes author edits first-class, replayable history.

## 5. Scope

**v1 (this epic):** entity-level CRUD (the five editor verbs), single-shot
tool-calling, preview→confirm, recorded/replayable edits, creator/dev panel.

**Deferred to a later spec (v2):**
- **"The world itself"** — tile / biome / seed / region mutation (map mutation + WFC +
  realization is a much larger, riskier surface).
- Multi-turn read-tool agentic loop (LLM querying the world before editing).
- Promoting the panel to player-facing god-mode.
- Generalizing the input-log to record *all* exogenous commands (incl. player divine
  acts) for perfect scrub-replay.

## 6. Testing strategy

- **Sub-project 1:** unit tests for tool serialization + `tool_calls` parsing against
  a stubbed fetch; `MockLLMProvider` canned tool calls.
- **Sub-project 2:** headless tests per editor verb (apply mutates the world correctly
  via the safe API); executor rejects malformed payloads / unknown kinds; **replay
  parity** — author-edit a world, snapshot, scrub back before the edit, `forwardSilent`,
  assert the edit reappears identically; `no-random-in-sim` guard stays green.
- **Sub-project 3:** DOM test — panel mounts, send → preview renders from `toolCalls`,
  Confirm emits the expected commands (mock client), Discard emits nothing.

## 7. Open questions / risks

- **deepseek-v4 tool-calling fidelity** at `reasoning:{enabled:false}` — if quality
  needs thinking, the capable tier can opt it back in per-call (already supported).
- **Payload validation depth** — start strict (reject unknown fields / out-of-range);
  the executor returns a clean rejection the panel can show.
- **`source` typing** — `Command.source` is `SpiritId` today; `'author'` is a
  non-spirit sentinel handled only on the editor path.
