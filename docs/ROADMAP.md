# Small Gods — Roadmap

**Version**: 2.1.0
**Status**: Canonical — the single forward plan
**Last Updated**: 2026-07-05

> **Near-term execution queue (next several weeks):**
> [`docs/superpowers/plans/2026-07-05-handoff-multiweek-plan.md`](superpowers/plans/2026-07-05-handoff-multiweek-plan.md)
> — pre-decided, model-routed (Opus/Sonnet) task queue: round-9 time controls, the
> realistic-rivers epic (waterfalls/ponds/dams/rocks —
> [spec](superpowers/specs/2026-07-05-realistic-rivers-streams-design.md)), then
> conversation UI / rival economics / Fate pacing. Start there.

> This is the **one** go-forward plan. It supersedes the old `IMPLEMENTATION.md`
> and `MVP_ROADMAP.md` (both archived). It is anchored on
> [VISION.md](VISION.md) — the canonical cosmology, belief model, and arc.
>
> **Scope split (important):** this file owns the **gameplay arc** — the belief
> loops, rivals, Fate, progression, and the player-facing surfaces that turn the
> engine into a *game*. The (large, mature, still-growing) body of **engine /
> world / render** work is tracked as live epics in the session memory
> (`MEMORY.md`) and its topic files; this file *points* to it (see
> [Engine & world epics](#engine--world-epics-tracked-in-memorymd)) but does not
> duplicate it.
>
> **How to use it:** each track is a *destination*, not a task list. When a track
> is picked up it gets its own **brainstorm → spec → plan** cycle under
> `docs/superpowers/{specs,plans}/`. This file says *what / why / in what order*;
> the specs say *how*.

---

## Shipped baseline (do not re-litigate)

The **engine is mature**; the *game* is the open part. Shipped to `main`:

**Spine & time.** Architectural spine (Spec A), deterministic seedable sim with
snapshot/replay, Time scrub/commit/re-roll + jump-forward presets + clickable
history (Spec B/C), calendar, rate-scaled scheduler. `src/sim/` is
`Math.random`-free (guard test).

**Simulation.** Phase 7 NPC sim (traits, belief per spirit, needs, social graph,
activity FSM, settlement events), Phase 8 divine actions (whisper/omen/dream/
miracle/answer-prayer + power economy), D1 mortality/birth/lineage (NPCs age,
die→`remains`, reproduce), D2 deterministic time-skip (`applySkip` + commit
boundary).

**Belief made real (Track 1).** Power formula, mortal self-agency, secularization,
understanding gates perception+prayer, devotion multiplier+propagation. Plus
**belief-granted powers + the divine inbox** (a god's powers = what believers
think it can do; coincidence→attribution→domain-spread→threshold→unlock loop).

**LLM backfill (Phase 9).** Real configured provider (Mock/OpenAI/OpenRouter),
prompt builder, state writeback, player provider-config UI, live-apply (no
reload). Two-tier OpenRouter model catalog (see [Models](#models-current-reality)).

**Authored narrative.** Storylet engine (deterministic agent-first authored tier:
plays no-key AND feeds Fate; WebGPU story card, pauses sim).

**Rendering — WebGPU-only.** The Canvas2D/PixiJS scene path is **retired**. GPU
heightfield terrain (buffer-driven, lit), y-sorted instanced entity pass, banded
lighting + projected cast shadows, per-sprite PBR G-buffer (albedo+normal+
material), procedural weathering + lit windows. WebGPU-native immediate-mode UI
(`src/render/ui/`) is the default chrome.

**World & content.** Noise terrain → biomes; connectome world-layout (island
worldgen, village green, mini-biomes, world-style); settlement growth S1–S6
(placement, lots/wards, live growth, civics); water hydrology S0–S6 (rivers,
carve/fill, flow field, flotsam); flora generation (L-system kit + 26-species
fact-DB + proctree/space-colonization generators); roads-as-portals (ribbons +
grade-cut); anchor-snap connectome.

**Buildings.** One parametric pipeline (blueprint→manifold→img2img→chroma-key→
quality-gate→register→SpritePack), geometry **v13**, generative openings/
fenestration, metric scale standardization, content-version cache-busting.
*Runtime paid art is OFF and a reseed is frozen → buildings render as grey
massing until a funded reseed.*

**Studio.** Unified Object+World studio shell (`?studio=…`): world browser (load/
seed/scale → live regen), drill World→Settlement→Building with breadcrumb +
inspector + "Edit in studio" handoff, schema-aware live param editing, turntable
orbit.

**~2640 tests passing (~436 files).** Historical specs/plans live in
`docs/archive/`.

---

## The gameplay gap (what this roadmap closes)

Belief is modeled and now *partly* consumed (Track 1 loops + belief-powers).
Rival spirits and Fate now have live cores (Track 3/4 — see below), but
**there is no progression / win-state.** The narration layer animates focus but
there's no conversation UI and no Book. Closing those loops is the work below.

## Models (current reality)

The game's runtime LLM is **player-configured via OpenRouter** (their key) over a
two-tier catalog in `src/llm/openrouter-catalog.ts`:

- **Fast/chat tier** — `DEFAULT_CHAT_MODEL` (currently `deepseek/deepseek-v4-flash`).
  Runs the high-frequency NPC backfill.
- **Capable tier** — `DEFAULT_CAPABLE_MODEL` (currently `deepseek/deepseek-v4-pro`).
  Reserved for low-frequency, high-stakes reasoning (Fate / era-authoring). The
  `Game.llmClientCapable` seam is **built but uncalled** — Track 4 wires it.

A `DEAD_MODEL_IDS` set remaps retired defaults (e.g. `claude-sonnet-4.6`,
`deepseek/deepseek-v4`) so stale localStorage can't wedge backfill. Both tiers
require tool-calling support. When updating model defaults, edit the catalog —
**not** prose in plan docs (those are historical records).

---

## Track 1 — Close the belief-model loops  ⭐ — ✅ **shipped**

The self-contained loops are closed (power formula, self-agency, secularization,
understanding/devotion jobs). Extended by **belief-powers / divine inbox** (Track
6 surface). Deferred remnants live in their natural later tracks: *story-fidelity
/ misattribution* (needs LLM + rivals), *devotion costly-acts gating* (needs
sacrifice/shrine/monument from Track 5), *belief-event → Fate attention* (Track 4).

## Track 2 — LLM backfill (Phase 9)  — 🟢 **mostly shipped**

The narration layer is live: configured provider, prompt builder, writeback,
provider-config UI, live-apply. **Rule: the sim is truth; the LLM animates it and
never contradicts its numbers.** Remaining:

- **Conversation UI** — talk to a focused believer (the last core LLM surface).
- Interaction memory (compress + store; `createInteractionSummary()` is partial).
- Deepen NPC focus/inspector integration.

## Track 3 — Rival spirits (Phase 10)  — ✅ **core shipped**

Live `RivalSystem` (0.5 Hz) decides from real per-settlement follower data
(`buildRivalSituation`) and **claims prayers left unanswered past
`PRAYER_CLAIM_WINDOW_TICKS`** (120 ticks = half a sim-day, `src/sim/rival-claims.ts`)
via the shared `answer_prayer` command path (defection — VISION §3/§4); contested
+ lost pleas surface as inbox threats → alert pins. Fate coaches rival stances
(`set_rival_stance`, anti-snowball). **Power-economics + contention round shipped
2026-07-20** (spec `docs/superpowers/specs/2026-07-20-rival-power-economics-contention.md`):
spend/save policy (wealth pressure + save-for-miracle war chest), idle-poor sweep
guard, other-rival awareness in `RivalSituation`, undermine/expand target the
strongest/weakest opposition god OVERALL (player or rival), and rival-vs-rival
strikes surface as coalesced `rival_dispute` inbox tidings. Remaining:

- Economy tuning pass against live playtest numbers (regen vs claim pressure
  over a real day).
- Rival-vs-rival escalation beyond disputes (inter-faction conflict, eventually
  holy wars).
- Spirit↔player intersection → LLM-narrated rival encounters (a rival speaks
  through a devoted follower).

## Track 4 — Fate, the DM agent (Phase 11)  — ✅ **shipped, deepening**

The background orchestrator. **Fate is PROACTIVE but sim-bound** — as of VISION
1.1.0 (§2.1, §2.1.1) it takes initiative, plans arcs ahead, and weaves several at
once, but may only spend **legal sim mutations**, must **foreshadow before it lands
a beat**, and **re-plans rather than forcing**. It is still impersonal: never
petitioned, never models the player (that is rival spirits). *Fate plots against the
story, not the player.*

LIVE: event-driven `FateBrainService` (`src/game/fate/`, async — off the sim tick)
on the **capable tier** (`DEFAULT_CAPABLE_MODEL`) via `Game.llmClientCapable`; wakes
on significant story-thread events + sustained rival claim pressure (≥2
claims/sim-day window), cooldown-throttled. **5** constrained, drift-guarded tools
(`src/game/fate/fate-tools.ts`): `arm_staged_beat` (optionally with a validated
`storylet` ref → interactive card on discovery), `nudge_event_severity`,
`force_next_event`, `set_rival_stance` (anti-snowball coaching, deltas capped ±0.2
both sides of the LLM boundary — VISION §4), `author_building` (structural lint gate
+ one bounded self-correction retry).

**IN FLIGHT — 📋 [spec: Proactive Fate — arcs, portents, weaving](superpowers/specs/2026-07-14-proactive-fate-arcs-portents.md).**
The gap was architectural, not a prompt: `FateBrainService.deliberate()` was
**stateless** (arms one beat, forgets), and `FateTrigger` only woke on an incoming
event (**no heartbeat** ⇒ no initiative). Fate needs **memory**, **a pulse**, and **a
vocabulary for intent**. ✅ **F1+F2 SHIPPED (2026-07-16)** — `FateArcStore` rides the
snapshot (scrubbing rewinds Fate's plan; `ArcGoal.met` recomputed, never trusted from
disk) and `FatePulse` wakes the brain once per game-day through the trigger's shared
cooldown, with a deterministic stub arc as the permanent offline fallback. F3–F6
(arc library + `seed_arc`/`plant_portent`/`advance_arc` tools, portent gate, weaving,
era-authoring) are content on top. **This single spec closes both remaining Track-4
items below.**

- ~~Pacing/plot intelligence beyond single-beat reactions~~ → **arcs + weaving (F3/F5).**
- ~~Owns the LLM era-authoring half of the D2 time-skip loop~~ → **F6.**
- "Defying Fate has a price": time-scrub/re-roll must cost belief or invite
  escalation (VISION tenet 10). *(Sharpened by F1: arc state scrubs WITH the
  timeline — rewinding the world rewinds Fate's plan.)*

## Track 5 — Progression & win-state  — ⬜

The arc's spine (VISION §5/§7).

- God tiers (small → cult → major) with believer accounting.
- God **fading threshold** — faith→0 across believers shrinks a god toward
  "nothing but names" (you, rivals, major gods alike).
- **Win = attribution, not comfort:** become the name credited in crisis *and*
  plenty; supplanting = starving rivals/major gods' belief until they fade.
- Established **major gods** as endgame antagonists — powerful but hollow,
  beatable by intimacy.
- Unlocks **devotion costly-acts gating** (the deferred Track 1 remnant).

## Track 6 — The arc surfaces  — 🟡 **major pieces shipped**

The player-facing payoff. **Shipped:** belief-powers skill panel + divine inbox,
the storylet card, and — ✅ **v1 complete, P0–P5 merged** — the **divine-action
interaction UI + semantic zoom** ⭐, the front-end of the belief-powers/inbox loop.
One model: every act is a `Command{verb,target}`; one `CommandAffordance` (leaf =
smite-with-thunderbolt fires; branch = whisper expands to a card of paths) gated
by `previewCommand`; one shared `scoreAffordance` salience brain so hover surfaces
the most likely actions given the situation. **Semantic zoom is the spine**
(`src/game/affordance/zoom-band.ts`: hysteresis band-switch at zoom 0.40–0.45) —
zoomed-out = aggregate/place-targets/inbox-as-map-alerts, zoomed-in = per-NPC
inspector + whisper. The **whisper card is the first declarative `UiSpec`**
(`src/game/affordance/whisper-card.ts`) — Fate/sim emit a closed, typed structured
spec the **WebGPU** UI renders (`src/render/ui/ui-runtime.ts`), structure
sim-owned/deterministic + prose LLM-enriched. **Brainstormed:** the Presentation
Director (adaptive score, cinematic camera, SFX/voice — observes the sim, off the
command bus). Remaining:

- **Semantic-zoom stretch goals** — area targets ("lightning on a bush", "rain on
  a farm"), Fate-authored `UiSpec` via `onArmed`, crossfade between zoom bands.
- **Spec E — The Book of [Spirit Name]** (emergent divine identity, naming ritual,
  chapter detection). The strongest expression of VISION §6.
- **Act 0 stone-age tutorial / Drifting Spirit opening** — first believer; an
  unpreventable Fate-loss the player can only give *meaning*
  (`docs/superpowers/specs/2026-05-31-dilemma-mvp-design.md` §12).
- **Spec C full — Branching** (parallel universes, discarded futures, lineage UI;
  `TimelineController.getDiscardedFutures()` is the hook).
- **Generated imagery** (NPC portraits, vistas, chapter scenes, god portrait) —
  gated by the art-reseed freeze.

## Track 8 — Mortal power: the lord, the castle, the knights  — 📋 **spec'd**

📋 **[spec](superpowers/specs/2026-07-14-mortal-power-lord-castle-knights.md)** ·
🧠 **[brainstorm](superpowers/2026-07-14-mortal-power-and-proactive-fate-brainstorm.md)**

**Thesis: oppression manufactures need, and need is what a small god feeds on — so a
castle is a belief engine.** A lord doesn't *add* need, he **changes which need is
unmet** (supplies `safety`, drains `prosperity`/`meaning`). **The trap:** topple him
and you remove the fear that feeds you. This turns VISION's already-canonical
"comfort kills belief" counter-loop into **a choice with a face on it**, and supplies
Track 4's arc library. Cost: **$0** (sim, prompt, parametric geometry — the paid
img2img gate stays OFF).

**⚠ M0 IS A PREREQUISITE FOR MOST OF THIS ROADMAP, not just Track 8.** The belief
engine **cannot see** any of it today (VISION §9 rows 11–12, verified in code):
`computeMood()` is the **flat mean** of the four needs, so draining `prosperity` and
supplying `safety` in equal measure is a **literal no-op on faith**; and `worship`
fires **only** on `meaning < 0.3`, so **a starving peasant cannot pray** — meaning
the entire belief economy runs on **one need out of four**. M0 (worship fires on the
*lowest* need; a prayer gets a *subject*) is ~10 lines for the decisive half, and it
**also unblocks Track 3's stated rival domain-matching deferral** as a side effect.

- **M0 — need gets a direction** ⭐ — ✅ **SHIPPED 2026-07-16** (M0.a+b: worship on
  the lowest need, prayers carry a subject end-to-end; M0.c tithe deferred to M3 —
  see the spec's reality-check). **Also closed Track 3's rival domain-matching
  deferral** (rivals carry a need-domain vector; matched pleas claimable at the
  normal window, mismatched at 2×).
- **M1 — the chronicler's voice** — ✅ **SHIPPED 2026-07-16.** Monastic-register
  annalist over the event log (fast tier, strictly read-only — guard-tested), one
  entry per game day, deterministic offline fallback; surfaces as a low-salience
  inbox tiding, persists in the snapshot, and reads aloud on the boot loading screen.
- **M2 — epithets** — ✅ **SHIPPED 2026-07-16** — deed-derived, salience-argmax over
  the memory ring, escalating for answered prayers (*victory renames you*).
- **M3 — the lord** — a `noble` NPC (role exists). **Never** gets a `beliefs[]`
  entry — he competes for *allegiance*, not *belief* (that would invent a fifth
  category of god). He can fight you **by proxy** by endowing a rival's shrine.
- **M4 — the castle** — `placeComplexOnPatch` **already plants a motte-and-bailey on
  an empty hilltop** and the game never calls it. ⚠ Blocked on **runtime POI
  creation** (there is none) — needs its own spike.
- **M5 — knights** — `soldier` NPCs, **not** a new entity kind.
- **M6 — the Peace of God** — relics paraded into a field; armed men bound by oath
  before a crowd. **Spends `devotion`, not power** — finally giving devotion a job
  the player can feel, and denying the move to a god who only bought cheap fear.

## Track 7 — Backlog (opportunistic)

- Divine-action ladder beyond the five: **bless / curse / manifest /
  empower-prophet** (design against VISION).
- Natural-language → world-seed generation (LLM prompt → validated seed).
- **Independent magic-users** (wizards/heroes outside the belief economy) —
  open design question (VISION §10).
- **3D / asset-generation research** — see
  [ANIMATION_AND_ASSET_GENERATION.md](ANIMATION_AND_ASSET_GENERATION.md). A
  *cache-or-generate* asset library so Fate can animate an ever-growing creature/
  worship zoo: reuse a fitting pre-generated model (caption→embed→retrieve) else
  prompt a generator, then write it back. **Determinism rule:** the library is the
  deterministic interface — generation never touches sim/replay; bind chosen asset
  IDs into scenario state. *Not scheduled — keep building the tracks above with the
  parametric/grey placeholders.*

---

## Engine & world epics (tracked in `MEMORY.md`)

The render/world/content engine is an active, multi-epic effort separate from the
gameplay arc above. These live as topic files under the session memory; the
current shortlist (see `MEMORY.md` for status & next slices):

- **Structure-mesh rendering** — render ground-anchored structural geometry
  (bridges + stairs first, walls/towers next) as real 3D meshes in a depth-tested
  pass sharing the terrain depth buffer, instead of flat billboard sprites. Fixes
  the bridge "float above the riverbed", wall/tower draw-order glitches, and
  "structures sit *on* the world not *in* it" — reusing the manifold geometry we
  already compute + discard. **$0, draw-only, no sim changes.** *Spec + plan, no
  code:* `docs/superpowers/specs/2026-07-15-structure-mesh-rendering.md`.
- **Terrain+Water shader system** — one per-cell field → texturing + water +
  scatter; zoom-LOD; pixel-perfect snap (also kills jerky-zoom). *Spec, no code.*
- **Render-perf engine pass** — attack the overview fill-bound regime (deeper px
  ladder + half-res water target + bake fbm noise to a tiling texture), kill
  redundant per-frame `world.query()` waste, then professionalize (timestamp-query
  GPU profiling, render bundles, alloc hygiene). GPU-driven culling + bindless are
  the noted *later* scaling path. *Spec, no code:*
  `docs/superpowers/specs/2026-06-28-render-perf-engine-pass-spec.md`.
- **Incremental world-update substrate** — regional (dig/crater) + global
  (climate) edits over one dirty-region substrate. *Design only.*
- **Spatial-coordination** — one footprint def / occupancy authority across all
  connectome producers; includes the **save-version gate** (fixes stale-autosave-
  masks-worldgen). *Brainstorm.*
- **River crossings as generative sites**, **building-validity** (auto-fix +
  scored siting), **shrine procession connectome**, **skirt + affordance graph**.
- **Legacy-chrome retirement** (L0 done → L1 tooltip next).
- **WebGPU-UI / MCP integration** (UI S1–S2 shipped → S3 input/scroll; then
  MCP-into-running-game over the command/query bus).
- **Studio** — the current active surface (world browser + object editor); next
  neighbours surface naturally: world-style **S4 live panel**, building-validity
  **S1**.

🅿️ **Parked / frozen:** DC-2 defensive-constructions (branch unmerged; revive as
*coexist-as-2-kinds*), art reseed (buildings + flora — plumbing keyless-ready,
frozen until funded), Time-Debug snapshot/inject stubs.

---

## Suggested sequencing

```
Track 1 (belief loops) ✅ ──┬──►  Track 3 (rivals)  ✅ ──┐
                            │                            ├──►  Track 5 (progression & win)
Track 2 (LLM backfill) 🟢 ──┘──►  Track 4 (Fate)   ✅ ───┘
                                                         └──►  Track 6 (Book, tutorial, branching)
Engine & world epics — parallel, continuous             Track 7 — opportunistic, any time
```

Track 1 is done; Track 3 (rivals) and Track 4 (Fate) both have live cores.
**Track 2's conversation UI** is the last core LLM surface, and deepening rivals
(power-economics, contention) and Fate (pacing/plot intelligence) are the
highest-leverage gameplay moves next. Track 5 makes it a game with a win; Track 6
is the payoff. The engine epics run continuously alongside.
