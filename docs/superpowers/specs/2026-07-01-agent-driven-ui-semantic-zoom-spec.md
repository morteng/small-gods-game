# Agent-Driven UI · Semantic-Zoom Interaction — Spec

**Status:** spec (2026-07-01). Succeeds the [brainstorm](2026-06-28-agent-driven-ui-semantic-zoom-brainstorm.md) (2026-06-28). No code yet.
**Origin:** the brainstorm chose *Direction B — a declarative `UiSpec` the WebGPU UI renders* and honors the standing **no-DOM-in-game** / **WebGPU-only** constraints. This spec resolves the brainstorm's §13 open questions and defines the v1 vertical slice with concrete seams, file touch-points, and test strategy.

**One-line:** build the **player-facing front-end of the belief-power loop that already exists in the sim** — verb-first targeting, hover suggestions, a WebGPU inspector, and the whisper card (the first declarative `UiSpec`) — organized by **semantic zoom** (attention altitude). The sim is unchanged truth; this is presentation + input.

---

## 0. Verified ground (as of 2026-07-01)

Confirmed against the codebase before writing (file:line). Two claims from the brainstorm **drifted** and are corrected here:

| # | Seam | Location | Status |
|---|------|----------|--------|
| 1 | `castPower` targeting stub (`selectedNpcId ?? npcs()[0]`, `worldSeed.pois[0]`) | `game.ts:805`, `:809`, `:813`, dup `:938` | ✅ stub — this epic replaces it |
| 2 | `CommandTarget = npc \| settlement \| none` | `sim/command/types.ts:29` | ✅ must grow |
| 3 | `CapabilityDef {verb,tier,cost,targetKind,implemented,precondition?,apply?,describe?}` | `sim/command/registry.ts:35`, registry `:67` | ✅ |
| 4 | Verb costs (whisper1 answer2 omen3 dream4 smite8 miracle10 storm12) | `sim/divine-actions.ts:13` | ✅ all match |
| 5 | Inbox salience (inline scoring) + `NpcDetail` | `game/game-query.ts:354` (score `:372/:392/:411`, Fate `+1` `:419`), `NpcDetail` `:60`, `npc()` `:154/:242` | ✅ |
| 6 | `previewCommand` / `GameBus.preview` | `sim/command/command-system.ts:23`, `game/game-bus.ts:38/:58` | ⚠️ **DRIFT** — returns `RejectionReason \| null`, **not** `{cost,affordable,blockedReason}` |
| 7 | `UiSpace {Screen=0, World=1}` (World unused); primitives `panel/button/hotspot/measure` (+`rect/label/border`) | `render/ui/ui-batcher.ts:30`, `render/ui/ui-context.ts:73/:95/:123/:141` | ✅ `World` defined, zero call-sites |
| 8 | `drawInbox`, `drawStory`, `drawSiteCard`, `actOnInbox` | `render/ui/ui-runtime.ts:439/:490/:347`, `game.ts:821` | ✅ |
| 9 | `StagedBeat {hard,soft?,storylet?,musicCue?}` — no `ui?` | `sim/threads/staging-types.ts:28` | ✅ |
| 10 | Belief powers: `DOMAIN_DEFS` (`smite` unlock .5 `:45`, `summon_storm` .45 `:53`), `aggregateDomain` `:129`, unlock `:152`; `beliefPowers()→BeliefPowerView[]` | `sim/belief-domains.ts`, `game/game-query.ts:148/:332` | ✅ |
| 11 | `Game.llmClientCapable`; `FateBrainDeps.onArmed` | `game.ts:184/:369/:748/:564/:582`; `game/fate/fate-brain-service.ts:25/:55`; ctor `game.ts:562` | ⚠️ **DRIFT** — `llmClientCapable` now **wired**; `onArmed` defined + internally invoked but **no consumer supplies it** (this epic is its first consumer) |
| 12 | Backfill on focus: `LlmBackfillService.trigger(npc)` via `onLlmBackfill` | `game/llm-backfill.ts:47`, `game/frame-renderer.ts:171` | ✅ |

**Correction to the brainstorm's `Preview` type.** There is no structured preview. This epic adds a thin **derive** helper (sim-side, replay-safe):

```ts
// new: src/sim/command/preview.ts  (pure; wraps previewCommand + registry)
interface Preview { cost: number; affordable: boolean; blockedReason: RejectionReason | null; }
function derivePreview(cmd: Command, ctx: CommandCtx): Preview {
  const cost = CAPABILITY_REGISTRY[cmd.verb].cost;
  const reason = previewCommand(cmd, ctx);           // RejectionReason | null
  return { cost, affordable: reason !== 'insufficient_power', blockedReason: reason };
}
```

`GameBus.preview` keeps its `RejectionReason | null` contract; `derivePreview` is the presentation-layer adapter. No change to the write path.

---

## 1. Resolved decisions (brainstorm §13)

| Q | Decision | Rationale |
|---|----------|-----------|
| 1 Targeting modality | **Both, inspector-first.** Ship the inspector (target→act) as the readable core; add verb-first reticle for `entity`/`tile` point casts (smite, omen). Verb-first is the visceral half and is *required* for casts that have no pre-selected target. | Inspector doubles as the belief-loop feedback instrument; reticle is unavoidable for "lightning on that bush." |
| 2 `UiSpec` tier | **Tier-0 only** (whisper + story cards), IR shaped so Tier-1 (inbox item) / Tier-2 (passive `soft` beats) are purely additive. | Smallest trust surface; proves the walker. |
| 3 Salience refactor | **Extract `scoreAffordance`; pin the inbox output with a golden test first, then refactor to call it.** Inbox ranking must be byte-identical after extraction. | Surgery on replay-tested code — protect it. |
| 4 Hover trigger | **Short dwell (~120 ms)**, no radial in v1. | Avoids flicker on mouse-move; radial "wield" is a later flourish. |
| 5 Zoom bands | **2 bands in v1** (in/out) on the existing zoom ladder; threshold picked empirically via a `?studio`/offline grab, not hand-guessed. Area casts gate to the out-band (stretch). | 3 crossfaded LOD bands are stretch. |
| 6 Whisper branches | **2–3 paths**, deterministic template key = `dominantNeed × activeEvent × dominantDomainBelief`. Each path pre-pairs a `Command`; prose enriched async. | Matches storylet sync-structure / async-text split. |

**Non-negotiables carried from the brainstorm §10** (restated as acceptance gates in §5): no DOM; `UiSpec` authored at the async boundary and stored as data (replay re-presents stored card + replays stored `Command`, zero LLM in replay); no LLM on frame/hover path; every spec has an authored fallback; v1 is **choice-only** (no WebGPU free-text input).

---

## 2. Architecture — one primitive, one affordance, one salience brain, one spine

Unchanged from the brainstorm thesis. The write path stays `Command{verb,target}`; everything the player touches derives a `CommandAffordance` and emits one `Command` via `bus.emit()`.

```ts
// new: src/game/affordance/types.ts
type TargetKind = 'npc' | 'entity' | 'settlement' | 'tile' | 'area' | 'none';
interface CommandAffordance {
  verb: CommandVerb;
  label: string;                    // from CapabilityDef.describe()
  targetKind: TargetKind;
  footprint: 'point' | 'area';      // reticle shape
  shape: 'leaf' | 'branch';         // fire vs expand-to-UiSpec
  unlocked: boolean;                // aggregateDomain conviction ≥ unlockThreshold
  preview: Preview;                 // derivePreview()
}
```

Derivation source = `CAPABILITY_REGISTRY` (targetKind/cost/tier) ∩ `beliefPowers()` (unlock) ∩ context (selection/hover/zoom). `footprint`/`shape` are **new static columns on `CapabilityDef`** (default `footprint:'point'`, `shape:'leaf'`; `whisper`/`dream`/`answer_prayer` → `'branch'`).

```ts
// src/game/affordance/salience.ts  — the extracted brain (SHIPPED, P0)
type Situation =
  | { kind: 'prayer'; faith: number; meaningDeficit: number; surfaced?: boolean }
  | { kind: 'opportunity'; severity: number; surfaced?: boolean }
  | { kind: 'threat'; rivalBelievers: number; surfaced?: boolean };
function scoreAffordance(sit: Situation): number;   // Fate's +1 folded via `surfaced`
```

**Signature note (refined from brainstorm during P0):** the brainstorm sketched `scoreAffordance(verb, target, sit)`, but verb/target don't drive the *number* — only the read-only situation signal does. So the scorer takes a discriminated `Situation`; the **`(verb, target) → Situation` mapping** is the hover-side adapter built in P3 (`buildSituation`), keeping the scorer a pure function shared byte-identically by inbox and hover. Inbox = `scoreAffordance` per salient item (global lens); hover = same call per target (local lens); Fate = `+1` bias via `surfaced` (existing boost, folded into the scorer). All read one function → global/local never disagree.

---

## 3. `UiSpec` — the declarative card (Tier-0)

```ts
// new: src/story/uispec.ts   (closed/enumerated; renderer owns ALL layout)
type UiSpec = {
  title: string;
  body: Block[];                    // Paragraph | NpcLine{who,text} | Omen | Divider | BeliefBar
  choices: Choice[];                // each a CommandAffordance with a pre-paired target
  imageCue?: string;                // PARKED (no omen-visual target system yet)
  musicCue?: string;                // reuse StagedBeat.musicCue vocabulary
};
type Choice = { text: string; command: Command; hint?: string };  // hint = "builds understanding"
```

**Sourcing (two-layer, the game's architecture in miniature):**
- **Structure = sim-owned, sync, deterministic.** Sim generates 2–3 whisper *paths* from `dominantNeed × activeEvent × dominantDomainBelief`; each path's `Command` is sim-authored. Exists with/without an LLM → replay-safe.
- **Prose = LLM-enriched, pre-warmed on focus.** Reuse `LlmBackfillService.trigger` (`llm-backfill.ts:47`, already fires via `onLlmBackfill`) + the storylet `TextSlot {fallback, enrich}` pattern. **The LLM rewrites words, never invents branches.**

**Validator + budgets.** `validateUiSpec(spec)` clamps to no-scroll budgets (max blocks, chars/block, choices) — same discipline as `state-writeback` delta-clamping — and falls back on overrun. Because there is no WebGPU scroll (S3) and no text-input, **v1 is choice-only** and layout must fit one card.

**Renderer.** Generalize the existing `drawStory` (`ui-runtime.ts:490`) into one `renderUiSpec(c, spec, rect)` block-walker; `drawStory`/`drawSiteCard` become thin callers. Same renderer later serves inbox items (Tier-1) and `soft` beats (Tier-2) — additive.

---

## 4. Target vocabulary + reticle

Grow `CommandTarget` (`sim/command/types.ts:29`):

```ts
type CommandTarget =
  | { kind: 'npc'; npcId: string }
  | { kind: 'entity'; id: string }        // NEW — any World entity (flora/prop/animal)
  | { kind: 'settlement'; poiId: string }
  | { kind: 'tile'; x: number; y: number } // NEW — point cast
  | { kind: 'area'; x: number; y: number; r: number }  // STRETCH — brush/radius
  | { kind: 'none' };
```

Every effect fn that switches on `target.kind` and every serializer/schema for the command/event log must handle the new arms (exhaustive-switch tests will catch omissions). `area` is **stretch** — land `entity`/`tile` point-targets in v1.

**Reticle** (verb-first): choosing a leaf affordance with a point footprint enters a targeting mode — `pickTile` (existing) + entity find under cursor → single-cell/entity highlight → click emits the `Command` with the resolved target → exit mode. Extend `InteractionState` + `onTileClick` (interaction-controller). ESC/right-click cancels.

---

## 5. The four surfaces (all render `CommandAffordance`, emit `Command`)

- **Hover popover** (NEW, zoom-in): top 2–3 ranked affordance chips at cursor after ~120 ms dwell; leaf fires, branch opens card. Each chip shows cost + a *why* tag ("praying","drought") from `Situation`.
- **Inspector** (NEW, WebGPU, zoom-in): generalize legacy DOM `npc-attention-panel.ts` into a WebGPU panel for any selectable (npc/building/settlement/tile). Data = `NpcDetail` (`game-query.ts:60`). Shows full state **including the target's domain beliefs about you** (loop feedback) + full affordance list.
- **Inbox / alerts** (EXISTS, zoom-out): `drawInbox` screen-space list today (`ui-runtime.ts:439`); add `UiSpace.World` pin rendering (`ui-batcher.ts:30`, currently unused). Rewire `actOnInbox` (`game.ts:821`) to the affordance model + **camera-fly on alert click** (never strand an action).
- **Fate card** (STRETCH, any altitude): `StagedBeat.ui?: UiSpec` (`staging-types.ts:28`) + `arm_staged_beat` extension + register `FateBrainDeps.onArmed` (first consumer). Same `renderUiSpec`.

---

## 6. Semantic zoom (the spine)

Zoom = altitude of attention; picks the primary surface + the aggregation level `scoreAffordance` runs at. **2 bands v1**, on the existing zoom ladder, threshold picked empirically:

| | Zoomed out | Zoomed in |
|---|---|---|
| Primary surface | inbox as `UiSpace.World` alert pins | hover popover + inspector + whisper card |
| Belief read | aggregate (`aggregateDomain` per settlement) | per-NPC `SpiritBelief` |
| Affordances | place verbs (omen, miracle, storm) | people verbs (whisper, dream, smite-one) |
| Salience lens | per settlement/region | per NPC |

Rules: bands with crossfade not hard switch; selection survives zoom (inspector collapses to pin); zoomed-out uses aggregate visuals (halos/heatmaps, not per-NPC chrome — perf + readability). **Zoom = focus = backfill trigger** (already the `onLlmBackfill` signal) — deep zoom can modulate backfill richness.

---

## 7. v1 vertical slice — phased plan

Ordered so each phase is independently mergeable and the risky refactor is fenced by a golden test.

**P0 — Salience extraction (fenced). ✅ SHIPPED 2026-07-01.**
1. ✅ Golden test pinning `divineInbox` output (`tests/unit/divine-inbox-golden.test.ts` — snapshot over prayers + opportunity + threat + Fate-surfacing).
2. ✅ Extracted `scoreAffordance` + `Situation` (`src/game/affordance/salience.ts`); refactored `divineInbox` (`game-query.ts:354`) to call it (Fate `+1` folded via `surfaced`). Golden byte-identical; `+5` direct scorer tests. Typecheck clean; game-bus/debug-api/belief-powers/game-query green.

**P1 — Affordance + preview seam.**
3. Add `footprint`/`shape` columns to `CapabilityDef`; `derivePreview` (`sim/command/preview.ts`).
4. `CommandAffordance` derivation (`game/affordance/`), gated by `beliefPowers()` + `derivePreview`.

**P2 — Target vocabulary + real targeting.**
5. Grow `CommandTarget` (+`entity`,+`tile`); update effect switches, schema, serializers, exhaustive-switch tests.
6. Replace `castPower` stub (`game.ts:805/938`) with resolved targets. Verb-first reticle (point footprint) via `InteractionState`/`onTileClick`.

**P3 — Surfaces.**
7. Hover popover (dwell, top-3 chips, why-tags).
8. WebGPU inspector (target-first; full affordance list; domain-belief feedback).

**P4 — The card (keystone).**
9. `UiSpec` + `validateUiSpec` (budgets) + `renderUiSpec` walker (generalize `drawStory`).
10. Whisper card: sim-authored 2–3 branches (`dominantNeed × activeEvent × dominantDomainBelief`) + LLM-enriched prose (warm on focus, `TextSlot` fallback). Store `UiSpec` as data on the beat/event log; choice = a `Command` with `seq`.
11. **Smite** leaf with thunderbolt FX (reuse `divineEffects.trigger`).

**P5 — Zoom bands.**
12. 2 bands: inbox-as-list (in) ↔ `UiSpace.World` alerts (out); camera-fly on alert click; empirical threshold.

**Stretch (post-v1):** `area` targets + brush + area effects (rain-on-farms); Fate-authored `UiSpec` (`StagedBeat.ui?`, `onArmed`); Tier-1/2 renderer convergence; 3 crossfaded LOD bands + heatmaps; `imageCue`; WebGPU free-text input (own epic).

---

## 8. Acceptance gates (must hold at every merge)

1. **No DOM in game.** Everything through `render/ui/` primitives; `?legacyui` untouched. (Guard: no new DOM imports outside `src/ui/`.)
2. **Replay determinism.** `UiSpec` is data on the log; scrub/commit/re-roll re-present the stored card and replay the stored `Command` with **zero LLM calls**. New golden/replay test on a whisper-choice sequence.
3. **No LLM on frame/hover.** `scoreAffordance` is pure sim; hover/reticle never `await` the model.
4. **Fallback always.** Every `UiSpec` renders from `TextSlot.fallback` with no provider configured.
5. **Sim is truth.** No new sim write path; the LLM never invents branches or contradicts numbers.
6. **`src/sim/` stays `Math.random`-free** (existing guard).
7. **Inbox parity** — P0 golden byte-identical after `scoreAffordance` extraction.

---

## 9. Open items to settle during implementation (not blockers)

- Exact dwell ms + zoom-band threshold — tune empirically (offline grab / `?studio`), don't hand-guess.
- Whisper template key cardinality — start `2×2×2`, expand if paths feel repetitive.
- Whether the inspector reuses the settlement/site inspector shell already in `?studio` vs a fresh game-chrome panel (prefer reuse if the studio panel is game-safe).

---

## 10. Cross-links

[[project-belief-powers-divine-inbox]] (this is its deferred front-end) · [[project-webgpu-ui-mcp-integration]] (renderer; scroll/input S3) · [[project-command-channel-capability-registry]] (the `Command` primitive) · [[project-fate-brain]] / [[project-fate-orchestration-layer]] (`onArmed` first consumer) · [[project-storylet-engine]] (IR + `TextSlot` enrich split) · [[project-npc-attention-surface]] / [[project-persistent-npc-memory]] (backfill on focus) · [[project-vision-cosmology]] (faith/understanding/devotion the branches steer) · [[feedback-webgpu-only-renderer]] / no-DOM constraint.
