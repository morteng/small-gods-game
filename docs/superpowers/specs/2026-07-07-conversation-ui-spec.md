# Conversation UI — Living Whisper Card — Spec

**Status:** spec (2026-07-07). No code yet. Succeeds the [Agent-Driven UI · Semantic-Zoom spec](2026-07-01-agent-driven-ui-semantic-zoom-spec.md), which shipped the **single-shot** whisper card (its §1 Q6). This spec evolves that card into a **multi-turn conversation surface** and, in doing so, retires the legacy DOM whisper chrome (advances the legacy-chrome-retirement epic, "L1").

**One-line:** the god's whisper card stops dismissing on choose. Your line appends, the NPC answers *in the card*, belief bars refresh, fresh situation-keyed paths regenerate, and you can whisper **free text** — a living back-and-forth built on the whisper substrate that already works, rendered entirely in the WebGPU UI.

**Why now:** measure-first found the rivers/water track at diminishing returns; per ROADMAP + the handoff plan, conversation UI is the highest player-facing next feature. Critically, the *sim + LLM substrate is already built* (see §0) — this is a **presentation + input** epic, not a systems build. The sim stays unchanged truth.

---

## 0. Verified ground (as of 2026-07-07)

Confirmed against the codebase before writing (file:line). The headline: **a multi-turn whisper conversation loop already exists end-to-end** — what's missing is the WebGPU-native surface to live in.

| # | Seam | Location | Status |
|---|------|----------|--------|
| 1 | `sendWhisper(npcId, text)` — deterministic floor → provisional turn → LLM narrate → clamped writeback; degraded-safe | `src/game/whisper-orchestrator.ts:33` | ✅ the working turn loop; reuse verbatim |
| 2 | `whisper()` on-tick effect; `conversational:true` bypasses cooldown | `src/sim/divine-actions.ts:76`, `src/sim/command/registry.ts:99` | ✅ authoritative belief/power floor |
| 3 | Transcript store `NpcAttentionStore.getTranscript/appendTurn`; `WhisperTurn{whisper,dialogue,tick,faithBonus?,degraded?}` | `src/llm/npc-attention-store.ts:1,39` | ✅ **session-scoped, NOT snapshotted** (wiped on scrub/commit/era-skip, `:28`) |
| 4 | Persistent memory `MemoryEntry[]` on `NpcProperties.memories`; salience ring `MEMORY_MAX=20`; rides snapshot + SaveFile | `src/core/types.ts:484,570`, `src/llm/interaction-memory.ts:70` | ✅ durable episodic history |
| 5 | Prompt continuity: last 6 turns + top-4 memories + comprehension note keyed on `understanding` | `src/llm/whisper-prompt-builder.ts:37` | ✅ ready context summarizer |
| 6 | Whisper writeback clamp: `applyWhisperBonus` ±0.10 faith, ±0.2 mood, **never snapshotted** (replay reproduces only the floor) | `src/llm/state-writeback.ts:180` | ✅ sim-is-truth boundary holds |
| 7 | `buildWhisperCard(target, source, ctx) → UiSpec` — deterministic, keyed `dominantNeed × activeEvent × dominantDomainBelief`; 2–3 canned paths, each a pre-paired `whisper` Command | `src/game/affordance/whisper-card.ts:99` | ✅ **single-shot**; this spec makes it re-presentable |
| 8 | Card seam: `presentWhisperCard` → `getUiRuntime().presentUiSpec(spec, onChoose)`; `onCardChoice` emits the pre-paired command + FX | `src/game.ts:1048,1061` | ⚠️ `onChoose` **dismisses**; must be able to re-present |
| 9 | `UiSpec{title, body: UiSpecBlock[], choices}`; blocks `paragraph\|npcLine\|omen\|divider\|beliefBar`; `validateUiSpec` clamps to no-scroll `UISPEC_BUDGETS` (6 blocks/4 choices/220 chars) | `src/story/uispec.ts:40,49,75` | ⚠️ budgets assume one screen; a transcript needs scroll |
| 10 | `presentUiSpec`/`renderUiSpec` — **single-shot modal**, pauses sim, dismisses on choose | `src/render/ui/ui-runtime.ts:257,994,1038` | ⚠️ must gain a re-present/keep-open mode |
| 11 | `UiContext` primitives: `panel/rect/label/button/hotspot` — **no scroll, no clip, no text input** | `src/render/ui/ui-context.ts:73,80,86,97,125` | ❌ scroll region + input path are the real build items |
| 12 | DOM-island text-input precedent (the sanctioned "canvas can't type" escape hatch), positioned each frame device-px→css-px | `src/render/ui/ui-settings-island.ts:1` | ✅ template for the free-text field |
| 13 | Selection/focus: `selectedNpcId/pinnedNpcId/followNpc`; click-select in `InteractionController.onTileClick` | `src/core/state.ts:21`, `src/game/interaction-controller.ts:20` | ✅ target concept exists |
| 14 | Fast/chat tier drives whisper (`this.llmClient`); capable via `llmClientCapable ?? llmClient` fallback (mind-pages pattern) | `src/game.ts:571,586`, `src/llm/openrouter-catalog.ts` | ✅ tier choice is a one-line knob |

**Nothing in `src/sim/` changes.** The write path (`whisper` command → on-tick effect → clamped writeback) is untouched. Everything here is the game/render layer.

---

## 1. Core design decision

**The card becomes a projection of the live transcript, rebuilt every turn — never a retained widget.** This is the immediate-mode-native move and it preserves every existing invariant:

1. **Structure stays sim-owned & deterministic.** `buildWhisperCard` already derives the *paths* from NPC situation. We extend it to `buildConversationCard(target, source, ctx, transcript)` — same deterministic path logic, but the `body` now also renders the recent transcript turns (as `npcLine` / a new player-line block) above the fresh paths.
2. **Prose stays resolved strings.** The card holds the *already-returned* `dialogue` strings from past turns — never a live prompt, never a stream. Replay-safety (uispec.ts:12) is unbroken: on scrub the transcript store is wiped (§0 #3) and the card rebuilds from whatever survives (the durable memory ring), so a restored timeline reproduces the deterministic floor exactly.
3. **The async reply is the only new control-flow.** Choosing a path (or submitting free text) calls `sendWhisper` (which already does floor→LLM→writeback), then on resolution **rebuilds the card from the updated transcript and re-presents it** — instead of dismissing. A pending "…" turn shows immediately (the provisional turn already exists, whisper-orchestrator.ts:46).

This means **the whole feature is: (a) make the card re-presentable, (b) render the transcript in it, (c) add a free-text field, (d) add scroll.** No new sim systems, no new persistence (the memory ring already persists; verbatim transcript remaining ephemeral is a deliberate, already-shipped choice we keep).

### Alternatives rejected
- **A retained conversation panel (bespoke widget).** Violates "all UI through the agent-driven system." Rejected.
- **Keep the legacy DOM whisper panel, just style it.** Violates WebGPU-only-in-game + no-DOM-chrome. Rejected (and this epic *removes* it).
- **Stream tokens into the card.** Conflicts with the "resolved strings only" replay contract and needs a per-frame LLM-stream pump. Deferred to a stretch goal (§6); v1 shows a pending "…" then the full reply.

---

## 2. The three real build items

Everything else is wiring. These are the parts that don't exist yet:

### 2a. Re-presentable UiSpec card (`ui-runtime.ts`)
Today `presentUiSpec(spec, onChoose)` is single-shot: `renderUiSpec` dismisses on choose (ui-runtime.ts:1038). Add a **keep-open** mode:
- `presentUiSpec(spec, onChoose, { keepOpen?: boolean })` — when `keepOpen`, choosing calls `onChoose` but does **not** dismiss; the card stays until an explicit close (Esc / a `done`-style close affordance).
- A `updateOpenCard(spec)` entry so the game can swap the rendered spec in place after an async reply (immediate-mode: just replace the stored spec; next frame redraws).
- Sim stays paused while the card is open (existing behavior, game.ts:779) — a conversation is a focused modal moment. (Open Q §7.1: pause vs. keep-running.)

### 2b. Free-text input (DOM-island, per the mandated precedent)
No GPU text widget exists; the sanctioned path is the DOM island (§0 #12). Build a `WhisperInputIsland` mirroring `SettingsIsland`:
- A single-line `<input>` (Enter submits, Esc blurs) floated over the card's input row, positioned each frame from the card layout (device-px→css-px).
- On submit: clear the field, call the same `onSubmit(text)` that a canned path uses → `sendWhisper`. The canned paths remain as **one-tap suggestions** above the field (they pre-fill/emit their `payload.text`).
- Self-contained inline styles, no CSS deps, CSP-safe (matches `ui-settings-island.ts`).

### 2c. Scroll + clip region in `UiContext`
A growing transcript exceeds the one-screen budget. Add the minimum viable scroll:
- `beginScroll(id, rect, contentH) / endScroll()` in `ui-context.ts` — a clip rect + a scroll offset kept in a tiny persistent map keyed by `id` (immediate-mode-friendly, same pattern as `hotId`). Wheel events adjust the offset; content drawn outside the clip rect is culled.
- Only the transcript region scrolls; title, belief bars, paths, and the input field stay pinned. Auto-scroll to bottom on a new turn.
- This is a **general** primitive — the inspector and inbox can adopt it later (they currently truncate via content budgets), so it pays down debt beyond this feature.

---

## 3. Card anatomy (rendered spec)

```
┌─ Whisper to Bram ──────────────────┐
│ Faith     ▓▓▓▓░░░░░░  0.38          │   ← beliefBar (pinned, refreshes each turn)
│ Meaning   ▓▓░░░░░░░░  0.19          │
├────────────────────────────────────┤
│ ‹scroll region — the transcript›    │
│  Bram: "What is any of this for?"   │   ← npcLine (situation opener, turn 0)
│  You:  "Your work feeds a village." │   ← NEW playerLine block
│  Bram: "…does it? I hadn't thought  │   ← npcLine (LLM dialogue, resolved string)
│         of it that way."            │
│  You:  …                            │   ← pending turn (provisional, no reply yet)
├────────────────────────────────────┤
│ [Soothe their meaning]  [Claim …]   │   ← canned paths (one-tap suggestions)
│ ┌────────────────────────────────┐  │
│ │ whisper your own words…      ⏎ │  │   ← DOM-island free-text field
│ └────────────────────────────────┘  │
└────────────────────────────────────┘
```

New pieces vs. today's card: a **`playerLine`** block kind (`{kind:'playerLine', text}`), the scroll region wrapping the transcript, and the input field. Belief bars move to a pinned header so they visibly move as faith shifts (the belief-loop feedback instrument, exactly the semantic-zoom spec's intent).

---

## 4. Vertical slices

Ordered so each ends green, renders, and is independently shippable. WCV/ART untouched (no worldgen change). Build stays GREEN before any push; server CI (`✓ Server CI passed`) gates.

- **C1 — Re-presentable card (no new content).** Add `keepOpen`/`updateOpenCard` to `ui-runtime.ts`; wire `presentWhisperCard` to keep the card open and, on choose, call `sendWhisper`, then rebuild via `buildWhisperCard` and `updateOpenCard`. The canned paths now loop instead of dismissing. **Ship-test:** click a path repeatedly, watch belief bars climb, card stays open. No transcript display yet — proves the loop.
- **C2 — Transcript in the card + `playerLine`.** `buildConversationCard` renders recent `WhisperTurn[]` above the paths; add the `playerLine` block + its `drawSpecBlock` arm. Pending "…" turn shows on send, fills on reply. **Ship-test:** a 3–4 turn exchange reads back correctly; degraded turns render a subtle marker.
- **C3 — Scroll region.** `beginScroll/endScroll` in `UiContext`; wrap the transcript; auto-scroll to bottom; wheel to review. **Ship-test:** a 10-turn conversation scrolls; header/paths/input stay pinned.
- **C4 — Free-text input (DOM-island).** `WhisperInputIsland`; Enter → `sendWhisper` with the typed words. Canned paths become one-tap prefills. **Ship-test:** type a bespoke whisper, NPC answers it; field clears; Esc closes island; island tracks the card on resize/zoom.
- **C5 — Retire legacy DOM whisper chrome.** Remove `npc-attention-panel`/`npc-whisper-mode`/`llm-display` wiring from the live game path (keep behind `?legacyui` if cheap, else delete). Route focus→whisper entirely through the card. **Ship-test:** no DOM whisper panel appears in the default (`barebones`) chrome; `?legacyui` unaffected or cleanly gone. Advances legacy-chrome-retirement L1.

**Stretch (own slices, not v1):** streaming tokens into the card (§6); capable-tier opt-in for richer replies (one-line knob, §0 #14); NPC-initiated openers; conversation-significant events waking Fate (the clean EventLog seam already exists).

---

## 5. Invariants preserved (the checklist that must stay true)

1. **Sim is truth.** No `src/sim/` change. The deterministic floor (`whisper()` on-tick) runs first and is the only replay-durable belief effect; LLM prose + the ±0.10 soft bonus are sugar, already never-snapshotted (§0 #6).
2. **Replay-safe cards.** The rendered spec holds resolved strings only; on scrub the transcript store wipes and the card rebuilds from durable memory — reproducing the floor. No live prompt in a spec.
3. **Deterministic structure.** Path generation stays `Math.random`-free and keyed by NPC situation (whisper-card.ts is already pure). Free text doesn't change *which* paths appear.
4. **All UI through the agent-driven system.** The surface is a `UiSpec` card + the `whisper` capability command; the only DOM is the sanctioned text-input island. No bespoke retained panel.
5. **Degraded-mode honesty.** LLM failure still counts the floor and shows the turn as `degraded` (existing, whisper-orchestrator.ts:60) — the card must render that state, not hide it.

---

## 6. Non-goals (v1)

- Token streaming (deferred; pending "…" is the v1 affordance).
- Persisting the verbatim transcript across save/scrub (deliberately kept ephemeral; the distilled memory ring is the durable record — unchanged).
- NPC-initiated conversation / an NPC "wants to talk" queue.
- Multi-NPC / group conversations.
- A new `converse` verb — we reuse the existing conversational `whisper` path (§0 #2); a distinct verb is only worth it if free text needs different gating (it doesn't — same cost/cooldown-bypass).
- Capable-tier by default (fast tier is fine for v1; opt-in is a later knob).

---

## 7. Open questions

1. **Pause while conversing? — RESOLVED (C1): do NOT pause.** Forced by a mechanism constraint discovered in implementation: `sendWhisper` enqueues the whisper command to apply *on a tick*, so the deterministic belief floor only lands while the sim runs. A paused card would never show the bars climb. Therefore a conversation card keeps the sim running (skips `onStoryToggle`) while still capturing input (modal for clicks, not for time). Bonus: the world drifting gently under the conversation is the more alive feel. One-shot cards (whisper-single, seek-landing) keep pausing unchanged.
2. **Turn budget in the card.** Show last N turns inline (scroll for older) vs. the full session. *Lean: render full session in the scroll region, cap the LLM prompt at the existing 6 (whisper-prompt-builder already does).*
3. **Cost pacing.** Whisper costs 1 belief-power/turn (divine-actions.ts:14). A long free-text chat drains power fast. Is per-turn cost right, or should conversation amortize (first turn costs, follow-ups within a session cheaper)? *Lean: keep per-turn v1; tune if it gates play.*
4. **Free text → slant.** Canned paths carry a `params.slant` steer (need/event/domain). A free-text whisper has no slant — does the writeback/LLM need one, or is the raw text enough? *Lean: raw text enough; slant is `free`.*

---

## 8. Test strategy

- **Deterministic card structure** — `buildConversationCard` given a fixed NPC + transcript yields a stable spec (extends the existing whisper-card determinism test). Golden-pin the block sequence.
- **Re-present loop** — a headless test drives `presentUiSpec(keepOpen)` → choose → `updateOpenCard` and asserts the card survives + belief bars reflect the floor after N turns.
- **Replay-safety** — after a scrub, the rebuilt card contains no stale transcript (store wiped) and belief matches the deterministic floor only.
- **Degraded path** — force an LLM failure; assert the floor still applied and the turn renders `degraded`.
- **Scroll primitive** — unit-test `beginScroll/endScroll` clip + offset + wheel + auto-bottom in isolation.
- **DOM-island** — jsdom test for submit/clear/Esc + a manual/offline check for device-px→css-px tracking on resize/zoom (the island alignment is the classic breakage point; verify with a live grab per the dev-loop discipline).

Per the verify-claims discipline, every §0 anchor above was read before writing; the load-bearing ones (#7 whisper-card single-shot, #8 card seam, #10 modal dismiss, #12 DOM-island) were opened in full.
