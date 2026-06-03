# Mind-Centric NPC Panel — Design

**Date:** 2026-06-04
**Status:** Approved (brainstorm)
**Supersedes the tab/mode model** introduced by the NPC Attention Surface epic (`feat/npc-attention-surface`). This is a follow-on restructure on the same branch.

## Goal

Make reading an NPC's **mind** the single, always-present view of the NPC panel. Whisper stops being a co-equal "mode" and becomes a small input under the mind. Whispering visibly *changes the mind*: after a whisper the surface mind page re-reads and reflects it — the mortal's shifted thought *is* the reaction, never spoken dialogue back at the god (they never perceive the god directly).

## Motivation

The current panel presents Mind and Whisper as two tabs with two body views (mind reader + a chat thread). That framing fights the cosmology: a god whispers *into* a mortal's mind and reads the result; the mortal does not converse with the god. Folding whisper into a sub-action of the mind view both simplifies the UI and tightens the fiction.

## Non-Goals

- No change to the deterministic command/spend layer (`whisper`, `probe_mind` capabilities, executor single-spend path).
- No change to drill-deeper mechanics, costs, link resolution, or the snapshot/replay determinism invariants. `NpcAttentionStore` remains soft, un-snapshotted, wiped on scrub.
- Not adding persistence/save-load (separate sub-project).

## Design

### 1. Layout (one view, no tabs)

The Mind/Whisper tab switcher (`modes` row) and the separate whisper *thread* body are removed. The panel is always, top to bottom:

- **Header** — `name · role`, portrait, and the need/faith stat bars. Unchanged.
- **Body** — the mind reader: breadcrumb, current page prose, drill links, depth/cost foot. Default path `['surface']`, depth 0. Mechanics unchanged.
- **Footer** — a whisper input row (a `<textarea>` + Send button), then the divine-action buttons (Omen / Dream / Miracle / Pray / Answer / Backfill, as already wired). Whisper moves out of the divine-action button row and becomes this dedicated input.

### 2. The whisper → mind loop

`onWhisperSend(npcId, text)` (the existing path) is extended so that, after the whisper resolves, the **surface page regenerates**:

1. Emit the `whisper` command (conversational; costs power as today) and record the turn in `NpcAttentionStore`.
2. Run the existing whisper-reaction LLM call for its **deterministic belief effect only**: `belief_bonus` → `applyWhisperBonus`, `mood_delta` → mood. Its text is no longer rendered as a chat bubble; it is retained as the stored turn's `dialogue` (memory/context).
3. The body shows a brief *"their thoughts stir…"* loading state, then the **surface mind page is force-regenerated** (invalidate the surface cache key, re-run `openMindPage` at depth 0 — free), passing the recent whisper turns as context. The new surface prose reflects the whisper.

There is no separate reaction toast and no thread view. The visible result of a whisper is the changed surface.

### 3. Surface generation gets whisper context

`buildMindPagePrompt` accepts recent whisper turns (already available from the store) and, **at depth 0 only**, includes them in the user prompt framed as intrusive/unbidden notions ("a thought arrives unbidden, as if from outside…"). Deeper pages (depth ≥ 1) are unchanged and do not receive whisper context. The brevity instruction and the no-token-cap behavior (fixed in `d08caa9`) are retained.

### 4. Force re-read path

`openMindPage` currently returns a cache hit unconditionally. Add an explicit invalidation so the whisper loop can force a fresh surface read:

- `NpcAttentionStore` gains `invalidatePage(npcId, key)` (or the orchestrator deletes via an existing method) so the surface key can be cleared before regeneration.
- The regeneration reuses the normal `openMindPage` path (cache-miss → generate → the page is free at depth 0, so no `probe_mind` command is emitted for depth 0; confirm `mindProbeCost(0) === 0` and that depth-0 misses do not emit a command — they already do not charge).

> Note: depth-0 reads are free and (per current orchestrator) still emit a `probe_mind` command on a miss with `depth: 0` and cost 0. Re-reading the surface on every whisper would emit a stream of zero-cost `probe_mind(depth:0)` commands. Decision: **suppress the command for depth-0 reads** (free reads need no spend record) to avoid log/replay noise, OR keep it as a harmless zero-cost audit entry. Spec choice: **suppress for depth 0** — a free read records nothing. This is a small, contained change in `openMindPage` (only emit when `cost > 0`).

### 5. Panel handle changes

- Remove `getActiveMode`, `refreshWhisper`, `refreshWhisperLast` from `NpcAttentionPanelHandle`.
- Keep `update`, `setNpc`, `showMindPage`, `destroy`.
- The panel owns the "thoughts stir…" transition: when its whisper input fires, it immediately shows the mind body's loading state, then awaits the orchestrator's `showMindPage` with the regenerated surface. The orchestrator does not reach into loading UI.
- `npc-whisper-mode.ts` shrinks to a reusable input row (`mountWhisperInput(host, { onSend, disabled })`) — textarea + Send + power-gating; the thread/transcript rendering is deleted.

### 6. Edge cases

- **Power gating:** the whisper input's Send is disabled when `power < whisperCost` (same gate as the old whisper action button).
- **No extra power cost:** the surface re-read is free (depth 0); the loop costs exactly one whisper.
- **No-key / Mock mode:** surface re-reads to the canned mock page; the whisper-reaction call returns no aptness (mock returns generic narration without `=== NPC CARD ===`), so belief is unchanged. Acceptable for dev.
- **Whisper in flight:** disable Send while a whisper+re-read is resolving to prevent overlapping regenerations; re-enable on completion (or error → restore prior surface).
- **Determinism:** unchanged — all soft content stays in `NpcAttentionStore`; scrub still clears it.

## Files

- `src/ui/npc-attention-panel.ts` — remove tab/mode state and the mode row; mind body always visible; mount the whisper input row in the footer above the divine buttons; trim the handle.
- `src/ui/npc-whisper-mode.ts` — reduce to `mountWhisperInput` (textarea + Send + gating); delete thread rendering, `refresh`/`refreshLast`, degraded markers.
- `src/llm/mind-prompt-builder.ts` — `buildMindPagePrompt` accepts optional `recentWhispers` and includes them at depth 0 only.
- `src/game/mind-orchestrator.ts` — accept recent-whisper context for surface; suppress `probe_mind` emission when `cost === 0`; surface re-read via cache invalidation.
- `src/game/whisper-orchestrator.ts` — after the whisper resolves, force-regenerate the surface page (invalidate + `openMindPage` depth 0) and push it to the panel via `showMindPage`; stop relying on thread refresh.
- `src/llm/npc-attention-store.ts` — add `invalidatePage(npcId, key)`.
- `src/game/game-ui.ts`, `src/game/frame-renderer.ts`, `src/game.ts` — adjust wiring for the trimmed handle and the whisper-triggered surface refresh.
- Tests: update `npc-attention-panel.test.ts` (no tabs; whisper input present; mind body always shown), `mind-prompt-builder.test.ts` (depth-0 whisper context), `mind-orchestration.test.ts` (no command at depth 0), `whisper-*` tests (surface re-read triggered, no thread). Remove thread-view tests.

## Testing

- Panel renders mind body with no tab row; whisper input present and power-gated.
- Sending a whisper: emits one whisper command, applies belief/mood, then re-reads the surface (no thread bubble rendered).
- Surface re-read at depth 0 emits **no** `probe_mind` command and costs no power.
- `buildMindPagePrompt` includes whisper context at depth 0 and omits it at depth ≥ 1.
- Determinism guard: scrub still clears the store; no new `Math.random` in `src/sim/`.

## Rollback

Self-contained on `feat/npc-attention-surface`; revert the restructure commits to return to the tabbed model.
