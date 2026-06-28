# Agent-Driven UI · Semantic-Zoom Interaction — Brainstorm / Design

**Status:** brainstorm (2026-06-28). No code yet. Design refined inline with the user this session.
**Origin:** user direction —
- *"there is new work on agent-driven ui and i would like to think about using that for the game."* → chose **Direction B: Fate drives the in-game UI** (a declarative UI spec the **WebGPU** UI renders), over Direction A (game-as-MCP-App).
- *"remember, we use webgpu ui components, not DOM. no DOM in the game."*
- *"there should be some kind of info panel for npcs and maybe all things… targeting and selecting from the powers player is capable of using… when npcs believe a player spirit can control the weather, then they get control of weather… spend power on raining on npcs farms."*
- *"we want entity+tile/area targets… if i hover over an entity i should be given (system should surface) most likely actions… given overall situation."*
- *"things to whisper (by clicking one of several suggestions leading to different paths), and actions like smite with thunderbolt."*
- *"when zoomed out the interface is more overview-ish… player sees prayers as alerts? and when zoomed in sees npcs interact… less overview stuff."*

**Relationship to shipped/standing work.** This is the **player-facing front-end of the belief-power loop that already exists in the sim** (`[[project-belief-powers-divine-inbox]]` — "MVP MERGED. Deferred: targeting UX"). It consumes, does not rebuild: the belief-granted-powers system (`src/sim/belief-domains.ts`), the command channel (`src/sim/command/`), the divine inbox + salience (`src/game/game-query.ts`), the storylet IR + Director (`src/story/`), the Fate brain (`src/game/fate/`), and the WebGPU immediate-mode UI (`src/render/ui/`). It is the concrete first **caller** of two built-but-uncalled seams: `Game.llmClientCapable` (Track-4 capable tier) and `FateBrainDeps.onArmed`. Honors the standing **no-DOM-in-game** and **WebGPU-only** constraints throughout.

**Industry context (why now).** "Agent-driven UI" converged in 2025–26 on the **declarative** pattern: the agent returns a *structured spec*, the host renders it in its own style (A2UI / Open-JSON-UI) — as opposed to *open-ended* (agent returns raw HTML/iframe, e.g. MCP Apps / `ui://`). Open-ended is wrong for us (it needs a DOM/iframe and surrenders art direction); **declarative is the exact fit** for a WebGPU immediate-mode renderer, where layout is recomputed every frame anyway. We adopt the declarative pattern internally: Fate (and the sim) emit a closed, typed `UiSpec`; the renderer owns all layout.

---

## 1. Thesis

**Every divine act is the player forming one `Command { verb, target }`.** The entire interaction surface — powers panel, NPC inspector, hover suggestions, divine inbox, Fate-narrated cards — is *four curation levels of that single act*, organized by one new spine: **semantic zoom** (the UI is a function of the player's *altitude of attention*).

Four ideas collapse into one architecture:

1. **One primitive** — `Command{verb,target}` (already the sim's only write path). `castPower`, `actOnInbox`, and Fate-card choices all just `bus.emit()` one.
2. **One affordance type** — `CommandAffordance` = "a verb I could issue now," in two shapes: **leaf** (smite → fires) or **branch** (whisper → expands to a card of sub-choices). Gated by the existing `previewCommand`.
3. **One salience brain** — `scoreAffordance(verb, target, situation)`, the inbox's ranking logic generalized; selects *which* affordances surface. Fate biases it (the inbox's existing `surfaced` +1 boost, generalized).
4. **One spine** — **semantic zoom** picks which surface is primary and which aggregation level the salience brain runs at: zoomed-out = aggregate / place-targets / inbox-as-alerts; zoomed-in = individual / entity-targets / inspector + whisper.

The payoff: the four surfaces stop competing (clutter) and become a single altitude-driven progression. And because **zoom = attention = the narration-backfill trigger**, the whole thing snaps onto the game's two-layer architecture.

---

## 2. The unifying primitive — `Command { verb, target }` (verified)

The command channel is already the sim's only write path. Verbatim (`src/sim/command/types.ts`):

```ts
export interface Command {
  verb: CommandVerb;
  source: SpiritId;            // 'player' | rival id | 'fate' | 'author'
  target: CommandTarget;
  params?: Record<string, number | string>;
  payload?: Record<string, unknown>;
  seq: number;
}
export type CommandTarget =
  | { kind: 'npc'; npcId: string }
  | { kind: 'settlement'; poiId: string }
  | { kind: 'none' };
```

Verbs + costs (`src/sim/divine-actions.ts`): `whisper`=1, `answer_prayer`=2, `omen`=3, `dream`=4, `miracle`=10, `smite`=8, `summon_storm`=12. Each capability declares `targetKind: 'npc'|'settlement'|'none'` (`src/sim/command/registry.ts`). Power is a scalar `spirit.power`, deducted in each effect fn; `previewCommand`/`GameBus.preview` gate cost+cooldown read-only before emit.

### Key code finding — targeting is a stub that *cheats*

`Game.castPower` (`src/game.ts` ~795) does **not** target. For NPC verbs it uses `selectedNpcId ?? this.query.npcs()[0]`; for settlement verbs it uses **`worldSeed.pois[0]`** — literally the first settlement in the array. There is no reticle, no hover-to-target, no validity check. This is the deferred "targeting UX." Building it is the bulk of this epic's *interaction* half.

---

## 3. `CommandAffordance` — the shared seam (leaf vs branch)

One derived type that every surface renders, so "can I do this now / what happens" lives in exactly one place:

```ts
interface CommandAffordance {
  verb: CommandVerb;
  label: string;
  targetKind: TargetKind;          // npc | entity | settlement | tile | area | none
  footprint: 'point' | 'area';     // NEW — reticle shape (see §7)
  shape: 'leaf' | 'branch';        // fire immediately, or expand to a UiSpec card
  unlocked: boolean;               // belief gate: aggregateDomain conviction ≥ threshold
  preview: Preview;                // from previewCommand: cost, affordable?, blockedReason
}
```

Derived from: capability registry (`targetKind`/cost) ∩ belief-grant state (`beliefPowers()`) ∩ context (selection/hover/zoom). **Leaf vs branch is the indirect↔direct spectrum of godhood:**

- **Leaf — `smite with a thunderbolt`.** One click → one `Command` → bolt falls (reuse `divineEffects.trigger` particles). Must stay one-click; a thunderbolt that opens a dialog isn't a thunderbolt.
- **Branch — `whisper`.** Click → a card of several suggestions, each a *different path* (different `Command`/`payload` or storylet entry). Deliberate, narrative.

**Discipline:** keep *visceral* verbs (smite, weather casts) as leaves; reserve branching for *influence/speech* verbs (whisper, dream, answer-prayer-with-a-chosen-sign) where content changes the outcome. A god-game that is all menus loses the feeling of power.

---

## 4. The whisper card = the first declarative `UiSpec` (the keystone)

A branch affordance *expands into a `UiSpec` card* — and that card **is** the agent-driven-UI deliverable. The most natural, shippable first home for the declarative spec is *"what do you want to whisper?"*, not an abstract future Fate moment.

```ts
type UiSpec = {                    // closed/enumerated; renderer owns ALL layout
  title: string;
  body: Block[];                   // Paragraph | NpcLine{who,text} | Omen | Divider | BeliefBar
  choices: Choice[];               // each is a CommandAffordance with a pre-paired target
  imageCue?: string;               // PARKED extension point (no target system yet)
  musicCue?: string;               // already exists on StagedBeat
};
type Choice = { text: string; command: Command; hint?: string };  // hint = "builds understanding"
```

**Two-layer content sourcing (the game's architecture in miniature):**

- **Structure is sim-owned, instant, deterministic.** The sim generates 2–3 whisper *paths* from the NPC's dominant need + active event. Exist with/without an LLM → replay-safe. The branch *set* and each path's `Command` are sim-authored.
- **Prose is LLM-enriched, pre-warmed.** `llm-backfill` already triggers on NPC focus (`src/game/llm-backfill.ts`); the same focus warms richer text for those paths via the `TextSlot {fallback, enrich}` pattern (`src/story/`). **The LLM rewrites words, never invents branches.** Same sync-structure / async-text split the storylet Director already uses (`src/story/fate-director.ts`).

**Why `UiSpec` is NOT a new scripting language.** A choice = `{text, Command}` drawn from the *already-validated* command set. No `goto`/`set`/effects/control-flow (that's the storylet IR's job, for *authored* packs). `UiSpec` is *Fate/sim-generated flat presentation* — a much smaller trust surface. It **shares the renderer** with the storylet Story Card (generalize the existing one, see §8) but is a different altitude with a different trust model. Nobody should have Fate emit storylet IR.

**No-scroll ⇒ content budgets.** The WebGPU UI has no scroll yet (`[[project-webgpu-ui-mcp-integration]]` S3). The `UiSpec` validator enforces budgets (max blocks, chars/block, choices) and falls back when overrun — same discipline as `state-writeback` delta-clamping.

---

## 5. `scoreAffordance` — one salience brain; hover surfaces likely actions

"Surface the actions I'd most likely want, given the situation" = the **divine-inbox salience model applied per-target.** The inbox (`divineInbox`, `src/game/game-query.ts` ~354) is the *global* ranked list of salient `(verb,target)` pairs (prayers by `faith × meaningDeficit`, opportunities by event severity, threats by rival pull). Hovering an entity is the **same computation scoped to one target**.

> **One situation model, three lenses: inbox (global), hover (local), Fate (bias).**

Extract a single `scoreAffordance(verb, target, situation)` that both inbox and hover call (so global and local never disagree). It reads what the inbox reads: target state (praying? in danger? wavering? rival-courted?), belief-loop value (is there an *active storm event* making smite/omen *attributable right now*? would acting seed the domain belief that unlocks the next power?), and resource (cheap actions float when power is low).

**Deterministic & instant — sim-computed, no LLM on the hover path** (can't call the model on mouse-move; replay would break). **Fate biases, never computes:** on its cooldown Fate pre-annotates targets it wants noticed — the inbox's existing `surfaced` +1 boost, generalized — re-ranking hover suggestions toward intended drama. This is the live use of `FateBrainDeps.onArmed` + `Game.llmClientCapable`.

---

## 6. Semantic zoom — the spine

Zoom stops being camera distance and becomes *altitude of attention*. It decides which surface is primary and which aggregation level `scoreAffordance` runs at.

| | **Zoomed out — overview / strategic** | **Zoomed in — intimate / tactical** |
|---|---|---|
| See | settlements, regions, belief spread | individual NPCs interacting (activity FSM legible) |
| Belief read | aggregate: `aggregateDomain` conviction/reach per settlement | per-NPC `SpiritBelief` (faith/understanding/devotion) |
| Primary surface | the **inbox, as map-anchored alerts** | hover popover + inspector + whisper cards |
| Affordances | place verbs: omen, miracle, **summon-storm over a region** (area/settlement) | people verbs: whisper, dream, **smite one soul** (entity/npc) |
| Salience lens | per settlement/region | per NPC |

**The target vocabulary (§7) maps onto zoom for free:** area/settlement = zoomed-out verbs; entity/tile = zoomed-in verbs. Altitude *is* the affordance filter — no separate filter to design.

**Deep alignment:** zoom = focus = the narration-backfill trigger. Zooming into an NPC *is* the "player focuses" signal that warms whisper prose/backfill; zoom depth can modulate backfill richness (deep → full narration). Principled, not bolted-on.

**The inbox and the alerts are the same data.** `InboxItem` already carries a positioned target. Zoomed-out → render as **world-anchored alert pins**; triage → render as the **screen-space list**. The UI batcher *already has a `UiSpace.World` mode, built but unused* (`src/render/ui/ui-batcher.ts`) — that is the home for map alerts, waiting.

**Play rhythm it produces:** spot a praying settlement as an alert (out) → zoom to see *who*/*why* (in) → whisper to one person → pull back to watch conviction spread (out) → zoom further to see the domain consolidate across the region. Zoom becomes the tempo of godhood.

**Cautions:** (a) **bands with crossfade, not a hard switch** — ~3 LOD bands (region/settlement/street) on the existing zoom ladder; (b) **never strand an action** — clicking an alert **flies the camera** to the right altitude with the card ready (this *is* the "act on inbox" flow); (c) **selection survives zoom** (inspector collapses to a pin, doesn't vanish); (d) **zoomed-out uses aggregate visuals** (halos/heatmaps, not per-NPC chrome) — readability + perf (NPCs already viewport-culled).

---

## 7. Target vocabulary expansion (entity / tile / area)

Today `CommandTarget = npc | settlement | none`. "Lightning on a bush" (a flora entity), "rain on a farm" (a building/tile/area) are **not expressible.** Grow it:

```ts
type CommandTarget =
  | { kind: 'npc'; npcId }
  | { kind: 'entity'; id }          // bush, animal, prop — any World entity
  | { kind: 'settlement'; poiId }
  | { kind: 'tile'; x; y }          // point cast
  | { kind: 'area'; x; y; r }       // brush / radius — weather
  | { kind: 'none' };
```

Consequence: a capability declares a **footprint** (point vs area), not just `targetKind`. Reticle forks: point → single-cell/entity highlight (reuse `pickTile` + entity find); area → brush preview + "which entities fall under it" resolution + area-scoped effects. **Area is the bigger lift** (brush render + area effect application); keep `entity`/`tile` point-targets as v1 of the richer vocabulary, `area` as the stretch that makes weather feel like weather.

---

## 8. The four surfaces over the model (rendering)

All four render `CommandAffordance`s and emit the same `Command`; they differ only in framing.

- **Hover popover (NEW, zoom-in).** Top 2–3 ranked affordance chips by the cursor; leaf chips fire, branch chips open the card. Each chip shows cost + a *why* tag ("praying", "drought") so the suggestion is legible, not magic. Verb-first targeting *without a mode*.
- **Inspector (NEW, WebGPU, zoom-in).** Generalize the legacy DOM `npc-attention-panel.ts` (under `?legacyui`) into a WebGPU panel for any selectable thing (npc/building/settlement/site/tile). Data exists: the `NpcDetail` query (`game-query.ts:60`). Shows full state **including the target's domain beliefs about you** (the loop's feedback instrument) + the full affordance list (not just top-3).
- **Inbox / alerts (EXISTS, zoom-out).** `drawInbox` (`ui-runtime.ts` ~439) screen-space list today; add the `UiSpace.World` pin rendering for overview. ACT already emits (`actOnInbox`, `game.ts` ~811) — rewire to the affordance model + camera-fly.
- **Fate card (NEW, any altitude).** A Fate-armed `StagedBeat` carrying a `UiSpec` (extend `arm_staged_beat`; `StagedBeat` already has `hard`/`soft`/`storylet`/`musicCue` — add `ui?`). The inbox is the *sim-authored* version of this exact card; the Fate card is the *LLM-authored* version. Same renderer.

**Renderer consolidation:** generalize the existing hardcoded **Story Card** (`ui-runtime.ts` ~490, already draws panel + labels + choice buttons over a dim backdrop, no DOM) into one `renderUiSpec(c, spec, rect)` walker. Tier-0 = whisper/story cards; Tier-1 also subsumes the inbox item; Tier-2 also expresses passive `soft` beats. Choose the IR shape now so Tier-1/2 are additive; build Tier-0 first.

---

## 9. The belief loop is the *point* (why branches steer power)

Each whisper path should steer **which kind of belief** it cultivates (per `docs/VISION.md`): explain who you are → **understanding** (gates sign-perception + accurate propagation); answer a need → **faith** (fast, fickle floor); seed a domain ("the sky answers to me") → **conviction** toward unlocking *smite*.

So the whisper card is where the player chooses *which power they are growing toward*: **the branch you pick today is the thunderbolt you can throw next week.** This ties the two affordance shapes into one engine: *whisper to make them believe you command the storm → conviction crosses `DOMAIN_DEFS.storm.unlockThreshold` → smite unlocks → smiting reinforces the belief.* Leaf and branch are the two halves of the belief loop, not just UI variety. Light, `understanding`-gated consequence hints keep the choice legible without spoiling it.

---

## 10. Hard constraints (must hold)

- **No DOM.** Everything renders through the immediate-mode WebGPU API (`panel`/`rect`/`label`/`button`/`hotspot`/`measure`). The one gap is **free-text input** (only the settings DOM island has it) → **v1 is choice-only**; WebGPU text input is a separate, larger primitive (caret/IME/clipboard) — defer "type your own prayer."
- **Determinism / replay.** The `UiSpec` is **authored at the async boundary and stored as data** in the beat/event log; runtime is a pure sync render. The player's choice is a `Command` with a `seq` (already in the deterministic input stream). **Replay re-presents stored card data + replays the stored command — zero LLM calls in replay.** Non-negotiable for scrub/commit (`[[project-d2-deterministic-time-skip]]`, timeline).
- **No LLM on the frame/hover path.** Salience is sim-computed; Fate only pre-biases on its cooldown.
- **Fallback always.** Every spec has an authored fallback (`TextSlot {fallback, enrich}`).

---

## 11. Verified code findings (the gaps this epic fills)

1. **Targeting cheats** — `castPower` uses `npcs()[0]` / `worldSeed.pois[0]` (`game.ts` ~795). No reticle.
2. **No WebGPU inspector** — only legacy DOM `npc-attention-panel.ts` behind `?legacyui`. `NpcDetail` query exists.
3. **`CommandTarget` too narrow** — `npc|settlement|none`; no entity/tile/area.
4. **Salience is inline in the inbox** — needs extraction to shared `scoreAffordance` for hover reuse.
5. **`UiSpace.World` built but unused** in the batcher — ready for map alerts.
6. **No scroll, no text-input** in the WebGPU UI (S3 / DOM-island respectively) → drives "budgets" + "choice-only."
7. **Fate seams live but uncalled** — `Game.llmClientCapable`, `FateBrainDeps.onArmed`; `StagedBeat` has no `ui?` field yet.
8. **Belief-powers fully built in sim** — `belief-domains.ts` (`aggregateDomain`→conviction), `beliefPowers()`→`BeliefPowerView[]`, smite/summon_storm. Only the *front-end* (targeting/affordance/UI) is missing.

---

## 12. Scope split

**v1 (vertical slice — proves the whole spine):**
- `scoreAffordance` extracted + shared (inbox ↔ hover).
- `CommandAffordance` derivation (registry ∩ belief-grant ∩ context); `previewCommand` gating.
- `CommandTarget` += `entity`, `tile` (point footprints). Real **targeting mode** (verb-first reticle) + extend `onTileClick`/`InteractionState`.
- **Hover popover** (top-3 leaf/branch chips).
- **WebGPU inspector** (target-first; full affordance list; domain-belief feedback).
- **`renderUiSpec` walker** generalized from the Story Card.
- **Whisper card** = first `UiSpec`: sim-authored branches + LLM-enriched prose (warmed on focus).
- **Smite** as a leaf with thunderbolt FX.
- **Semantic-zoom bands (≥2)**: inbox-as-list (in) vs inbox-as-`UiSpace.World`-alerts (out); camera-fly on alert click.

**Stretch / later:**
- `area` targets + brush reticle + area effects (weather "rain on the farms").
- Fate-authored `UiSpec` cards (`StagedBeat.ui?`, `arm_staged_beat` extension, `onArmed` wired).
- Tier-1/2 renderer convergence (inbox item + passive `soft` beats as `UiSpec`).
- 3 crossfaded LOD bands; aggregate belief heatmaps/halos.
- `imageCue` once an omen-visual target system exists.
- WebGPU free-text input (own epic) → "type your own prayer/commandment/prophet-name."

---

## 13. Open questions

1. **Which targeting modality leads?** Target-first (inspect→act; calmer, readable, *and* the loop's feedback instrument) vs verb-first (power→reticle; visceral). Proposal: inspector first, verb-first reticle second.
2. **`UiSpec` Tier for v1** — Tier-0 (whisper/story cards only) vs Tier-1 (also inbox). Proposal: Tier-0, IR shaped so Tier-1/2 are additive.
3. **Salience refactor risk** — extracting the inbox's inline scoring into `scoreAffordance` is surgery on working, replay-tested code. Worth it for DRY; needs golden coverage.
4. **Hover popover trigger** — instant on hover vs short dwell vs hover-hold/right-click radial. Dwell avoids flicker; radial reads as "wield."
5. **Zoom band thresholds** — where do region/settlement/street boundaries sit on the existing zoom ladder, and do area-target casts gate to the out-band only?
6. **Whisper branch generation** — how many paths (2–3?), and the deterministic template keys (dominant need × active event × dominant existing domain belief)?

---

## 14. Cross-links

`[[project-belief-powers-divine-inbox]]` (this is its deferred front-end) · `[[project-webgpu-ui-mcp-integration]]` (renderer; scroll/input S3) · `[[project-command-query-bus]]` / `[[project-command-channel-capability-registry]]` (the `Command` primitive) · `[[project-fate-brain]]` / `[[project-fate-orchestration-layer]]` (the `onArmed`/`llmClientCapable` callers) · `[[project-storylet-engine]]` (IR + Director enrich split) · `[[project-npc-attention-surface]]` / `[[project-persistent-npc-memory]]` (backfill on focus) · `[[project-vision-cosmology]]` (faith/understanding/devotion the branches steer) · `[[feedback-webgpu-only-renderer]]` / no-DOM constraint.
