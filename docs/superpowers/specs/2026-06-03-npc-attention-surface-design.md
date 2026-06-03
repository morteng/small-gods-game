# NPC Attention Surface — Whisper & Mind (Epic Design)

**Status:** Approved 2026-06-03. Track 2 of the roadmap ("LLM backfill / NPC narration"), reframed as the player-facing NPC interaction surface.

**One-line:** A unified, player-facing NPC panel with two modes — 🗣️ **Whisper** (influence: a multi-turn divine-voice thread) and 🧠 **Mind** (observe: an infinite, on-the-fly hyperlinked wiki of the NPC's psyche) — both built on a single principle: a **deterministic power-cost command** on the existing command channel, plus **soft LLM-generated content that never enters a snapshot**.

---

## 1. Motivation & fit

The two-layer architecture promises: the sim runs deterministically; the LLM "backfills" rich narration when the player pays attention. Today the only attention surface is a one-shot "Backfill" button on the NPC info panel. This epic turns *paying attention to an NPC* into a real, repeatable interaction with two complementary facets:

- **Whisper** — the god speaks into a mortal's mind and watches belief shift. Deepens the existing `whisper` divine action into a conversation.
- **Mind** — the god reads a mortal's mind as an infinite wiki, drilling from the surface thought down through memories, fears, and relationships, crossing into the minds of everyone they know.

Both are *god-appropriate*: indirect influence and omniscient observation, not peer chat.

### The governing principle (applies to both modes)

> **Deterministic floor + soft narration.** Every player action that costs power flows through the **command channel** as a deterministic, replay-safe command (the "floor"). Everything the LLM generates — dialogue, mind pages, the clamped belief *bonus* — lives in the **narration layer**: held in memory, shown to the player, and **never written into a snapshot**. On time-scrub / replay, only the deterministic floor reproduces.

This is exactly how the codebase already treats LLM writeback (soft, silenced on replay via `SilentEventLog`, command queue cleared on restore). The epic generalizes it.

---

## 2. Architecture overview

```
┌─ NPC Attention Panel (DOM, replaces today's npc-info-panel) ─────────────┐
│  Header: identity · needs bars · faith/understanding/devotion (as today) │
│  Mode switch:  [ 🗣️ Whisper ]  [ 🧠 Mind ]                                │
│  ┌─ Whisper body ─────────────┐   ┌─ Mind body ──────────────────────┐   │
│  │ scrollable thread          │   │ breadcrumb · page prose ·         │   │
│  │ NPC reaction + your whisper│   │ gold/purple hyperlinks            │   │
│  │ input box  → whisper cmd   │   │ drill → probe_mind cmd            │   │
│  └────────────────────────────┘   └──────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
        │ power cost                              │ power cost
        ▼ (deterministic, replayed)              ▼ (deterministic, replayed)
   CommandQueue ── whisper ──┐            CommandQueue ── probe_mind ──┐
                             ▼                                          ▼
                    deterministic floor                       depth-scaled power spend
                    (faith/understanding +)                   (no sim state change; v1)
        │ then (soft, NOT replayed)               │ then (soft, NOT replayed)
        ▼                                          ▼
   LLMClient.generate ── dialogue + clamped     LLMClient (structured) ── page prose
   belief bonus (±0.10)                          + typed link list
        │                                          │
        ▼                                          ▼
   NpcAttentionStore (narration layer, per-NPC, session-scoped, wiped on scrub)
        ├─ whisper transcript[]                    └─ mind page cache (by node-path)
```

### New/changed units

| Unit | File | Responsibility |
|------|------|----------------|
| `NpcAttentionStore` | `src/llm/npc-attention-store.ts` | Narration-layer state per NPC: whisper transcript + mind page cache. Session-scoped, never snapshotted, `clearAll()` on scrub/commit. |
| Attention panel shell | `src/ui/npc-info-panel.ts` (refactor) → shell + modes | Header (existing) + mode switch + active mode body + footer. |
| Whisper mode view | `src/ui/npc-whisper-mode.ts` | Thread render + input → emit `whisper`; render NPC reactions. |
| Mind mode view | `src/ui/npc-mind-mode.ts` | Breadcrumb + page prose + links; drill → emit `probe_mind`; cross-nav for gold links. |
| Whisper prompt | `src/llm/whisper-prompt-builder.ts` | `buildWhisperPrompt(npc, recentTurns, world)` → system+user. |
| Mind prompt | `src/llm/mind-prompt-builder.ts` | `buildMindPagePrompt(npc, path, world)` → system+user + the link tool schema. |
| `probe_mind` verb | `src/sim/command/registry.ts` + `src/sim/mind-probe.ts` | New divine-tier command: depth-scaled power cost, no sim mutation (v1). |
| Whisper bonus writeback | `src/llm/state-writeback.ts` (extend) | Apply the clamped (±0.10) soft belief bonus separate from the deterministic floor. |

Each unit has one clear job and a narrow interface; the modes don't know about each other, only the shell and the store.

---

## 3. 🗣️ Whisper mode (detailed)

**Interaction:** a per-NPC thread of `(your whisper → NPC reaction)` pairs, session-persistent.

**Effect — hybrid bounded:**
1. **Deterministic floor (command, replayed):** each send emits a `whisper` command (`source:'player'`, `target:{kind:'npc', npcId}`). The existing `whisper()` applies `faith += 0.15 · signResponse(understanding)`, `understanding += 0.03`, spends **1 power**, appends a `whisper` event.
2. **Pacing:** the per-NPC 5-tick cooldown is **lifted inside an open thread** (see §6 for how). Power is the throttle — you whisper as fast as you can afford; power regen (belief × understanding × devotion) self-limits.
3. **Soft narration (LLM, not replayed):** after the floor applies, `LLMClient.generate` is called with `buildWhisperPrompt`. It returns:
   - `dialogue` — the NPC's spoken reaction,
   - `mood_delta` and a **clamped belief bonus** `±0.10` reflecting how *apt* the whisper was (a fitting whisper moves faith more).
   The bonus is applied as soft writeback (overwritten on restore). Replay reproduces the floor only.

**Continuity:** the prompt includes the last ~6 transcript turns. The NPC's `understanding` is in the prompt so comprehension scales — a low-understanding NPC responds confused ("a murmur I can't place"), a high-understanding one grasps the message. This is understanding's on-theme third job (comprehension/coherence) surfacing in narration.

**Empty/failure:** if the LLM is unavailable or errors, the deterministic floor still applied (belief still moved); the thread shows the mechanical result with a muted "…(the words land, but no vision comes)" line. No throw to the player.

---

## 4. 🧠 Mind mode (detailed)

**Interaction:** an infinite wiki. Opens at the **surface** (depth 0); each hyperlink drills a new page.

**Pages:** a generated page = short prose (what's in the NPC's mind at this node) + a typed **link list**. Seeded by the NPC's compact deterministic state (personality, beliefs, needs, mood, activity, recent events, home) plus the **breadcrumb path** that reached this node (e.g. `surface ▸ fear of being forgotten ▸ the flood of Y3`).

**Two link kinds (structured output):**
- **`entity` (gold):** references a real sim entity, carrying a validated `entityId` (another NPC, a POI/place, an event). Clicking **cross-navigates**: select that NPC and open *their* mind, or pan to that place. The model is given the real ids it may link (nearby NPCs, the NPC's relationships/home, recent events) so gold links resolve; any link the model invents that doesn't resolve **degrades to a concept link** (it's a rumor/imagining, not a real person).
- **`concept` (purple):** a psyche node (a fear, a feeling, a memory, a belief). Clicking generates a deeper page *within this mind*.

**Cost — escalating by depth:** surface (depth 0) is **free**; each deeper level costs `2^(depth-1)` power → `0, 1, 2, 4, 8, …`. Drilling deep is a deliberate splurge; total power caps reachable depth.

**Caching:** visited pages are cached in `NpcAttentionStore` by node-path; navigating *back* to a cached page is free (no re-spend, no re-generate). Re-drilling a *new* path pays. Cache is per-NPC, session-scoped, wiped on scrub.

**Grounding & safety:** prose must respect deterministic facts (name, role, real relationships, real recent events); concept nodes are free generation. **Observation-only in v1** — reading a mind does not alter it (the only cost is power).

**Breadcrumb & navigation:** the panel shows the path with clickable crumbs (back = free), the current depth, and the running power cost. A "surface" crumb always returns to depth 0.

---

## 5. Data flow & LLM integration

- **Prompt builders** compile the same compact NPC card the existing `npc-prompt-builder` assembles (~150 tokens) plus mode-specific context (transcript turns / breadcrumb path). Target ≤ ~600 tokens.
- **Mind pages use structured output** (SP1's tool-calling/JSON path): the model returns `{ prose: string, links: Array<{ label: string, kind: 'entity'|'concept', entityId?: string }> }`. Entity links are validated against a candidate id set built from the NPC's world neighborhood; unresolved ids degrade to concept.
- **Whisper** uses plain `generate` returning `{ dialogue, mood_delta, belief_bonus }` parsed via the existing `parseLLMJson` fallback.
- **`NpcAttentionStore`** is the single narration-layer owner: `getTranscript(npcId)`, `appendTurn(npcId, turn)`, `getPage(npcId, path)`, `putPage(npcId, path, page)`, `clearAll()`. Held by `Game`/the panel, **not** in `GameState`/snapshots.

---

## 6. Determinism & replay (the load-bearing section)

- **Power spends are commands.** `whisper` (exists) and `probe_mind` (new) go through `CommandQueue` → `CommandExecutorSystem`, so they are sequenced, replayed, and power-accounted deterministically. `probe_mind`'s precondition checks the player has the depth-scaled power; its apply spends power and (v1) mutates no NPC state.
- **No `Math.random`.** `probe_mind` and the whisper floor use no randomness (or seeded `ctx.rng` only). Guarded by `tests/unit/no-random-in-sim.test.ts`.
- **Soft layer is disposable.** All generated text and the clamped whisper bonus live only in `NpcAttentionStore`, which is **wiped on snapshot restore / time-scrub / era-commit** (subscribe to the same boundary the command queue clear uses). Replay reproduces the deterministic floor exactly; the rich narration simply regenerates next time the player looks.
- **Cooldown lift, replay-safe:** the in-thread cooldown lift is a *property of how the panel emits* (it emits a `whisper` regardless of the soft cooldown-display), not a sim change — the `whisper` command's own precondition is relaxed for `source:'player'` conversational sends, or the panel simply doesn't gate on the display cooldown. The deterministic effect per command is unchanged, so replay is unaffected. (Implementation detail resolved in the Whisper plan; the invariant is: one send = one deterministic `whisper` command.)

---

## 7. Build slices

Each slice ships independently with its own implementation plan (`docs/superpowers/plans/`), built via subagent-driven development.

**Slice 1 — Shell + store (no behavior change).**
Refactor `npc-info-panel.ts` into a shell (existing header) + a mode switch (`🗣️/🧠`) + a body slot. Introduce `NpcAttentionStore` (empty for now) and wire its `clearAll()` to the scrub/restore boundary. The existing action buttons remain. Tests: shell renders header + switch; store persists/clears; nothing snapshotted.

**Slice 2 — Whisper mode.**
Thread UI + input → emit `whisper`; render the deterministic result immediately, then the LLM reaction; `buildWhisperPrompt` with last-N turns + understanding; clamped ±0.10 soft bonus writeback; transcript in the store. Tests: send→floor applied→thread renders; bonus clamped; low-understanding garble flag in prompt; LLM-unavailable fallback; transcript persists + clears on scrub.

**Slice 3 — Mind mode.**
`probe_mind` verb (escalating cost, power-gated, no mutation); `buildMindPagePrompt` + structured link output; wiki UI (breadcrumb, page prose, gold/purple links); gold cross-nav (select NPC + open mind / pan to place); page cache by path (free back-nav). Tests: cost curve 0/1/2/4/8; power gate rejects when broke; link resolution (valid id→entity, invalid→concept); drill renders page; cross-nav selects target; cache hit = no re-spend; cache clears on scrub.

---

## 8. Testing strategy

- **Unit:** `NpcAttentionStore` (persist/clear), `probe_mind` cost + gating, whisper clamped-bonus math, link resolution/degradation.
- **DOM (jsdom):** shell mode-switch, whisper send→thread render→reaction, mind drill→page render→cross-nav, breadcrumb back = free.
- **LLM mocking:** `MockLLMProvider` returns canned dialogue / canned pages + links (extend its tool-call canning from SP1).
- **Determinism guard:** assert `NpcAttentionStore` contents never appear in a snapshot; a replay test scrubs past whisper/probe activity and confirms the deterministic floor reproduces while the soft layer is gone.

---

## 9. Out of scope (v2+)

- Distilling conversations/reads into **durable, replayable** sim memory (the "distilled into sim memory" option).
- Mind-reading leaving a "watched"/unsettled trace on the NPC.
- Promoting either mode to a non-focus / broadcast surface (e.g. whisper to a whole settlement).
- Streaming LLM output (the client is one-shot today).
- "The world itself" — these modes read/whisper *minds*; world authoring is the (shipped) Create panel.

---

## 10. Open implementation details (resolved per-slice, not blocking the epic)

- Exact `probe_mind` capability shape (`tier:'divine'`, `cost` computed from payload `depth`, `targetKind:'npc'`).
- Whether the in-thread cooldown lift relaxes the `whisper` precondition for `source:'player'` conversational sends or is purely a panel-display concern (Whisper plan decides; invariant: one send = one deterministic `whisper`).
- The candidate-id set construction for gold-link validation (nearby NPCs + relationships + home POI + recent-event actors).
- Token budget tuning for the mind-page prompt as breadcrumb depth grows (summarize the path tail).
