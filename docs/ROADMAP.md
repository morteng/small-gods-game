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

## Track 5 — Progression & win-state  — 🟡 **lifecycle shipped, arc ahead**

The arc's spine (VISION §5/§7).
📋 **[spec](superpowers/specs/2026-07-25-progression-winstate-spec.md)** ·
🧠 **[brainstorm](superpowers/2026-07-25-progression-winstate-brainstorm.md)**

**Shipped (T5.0 + T5.1, 2026-07-25) — a god is only as real as its belief.**
`SpiritSystem` was already summing each god's belief mass every second and
discarding it; it is now persisted as `Spirit.beliefMass` alongside `intimacy`
(mass-weighted mean of understanding·devotion — the *hollowness* axis that makes
major gods beatable) and a hysteretic `tier` (`nameless`/`small`/`cult`/`major`,
edges calibrated against `FICTION_POP_BY_SIZE`). Mass held below `FADE_MASS` for
two game days fades a god to "nothing but names" (`god_faded` / `god_returned`),
**symmetrically for the player, rivals, and great gods alike**. A faded god keeps
**only the whisper** — canon (tenet 6) *and* the reason the lose-state isn't a
softlock. Faded rivals stop claiming prayers and stop running strategies, so
Track 3's long-promised **supplanting** finally has teeth.

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
command bus).

**Also shipped — abilities: cast targeting, area effects, and the Hall of the Gods**
📋 **[plan A+B](superpowers/plans/2026-07-26-abilities-cast-targeting-hall-of-gods.md)** ·
📋 **[plan C](superpowers/plans/2026-07-26-hall-of-the-gods-plan.md)**
- ✅ **Phases A+B (2026-07-26)** — CAST always arms a **reticle** (the auto-pick fast
  path that shadowed the feature is gone); an invalid click **stays armed** and says
  why instead of missing in silence; Esc has an explicit precedence (cancel aim →
  screen → card → menu); **click+drag area storms** with radius²-scaled cost;
  `area` targets over MCP; cast FX moved onto the **event log** so an agent's cast is
  as visible as a player's.
- ✅ **Phase C — the HALL OF THE GODS (2026-07-26)** — the skill screen as the divine
  realm above the clouds: a shell screen (`src/render/ui/shell/hall-screen.ts`) with
  one **pedestal per belief domain**, materializing from hazy to lit as conviction
  grows, each carrying a **CLAIM → COMMAND → DOCTRINE** ladder. It is an
  **observatory of follower belief, never a point shop** — nothing in it spends, buys,
  or unlocks; the sim is truth and the hall makes it legible. The ladder is **derived
  every read** from live numbers (`BeliefPowerView.dimensions`/`tier`, both optional —
  the single-payload law held), so a pedestal regresses honestly when belief decays.
  The one interactive concession is **CAST**, which closes the hall and arms the same
  reticle the powers panel does. Entered from the Esc menu or `open_screen screen=hall`
  — one route for a click and an agent alike — and `Shell.describe()` enumerates every
  pedestal with its refusal reason, so a headless agent navigates it without
  screenshots. Works with **no world loaded** (honest empty state).

Remaining:

- **Semantic-zoom stretch goals** — Fate-authored `UiSpec` via `onArmed`, crossfade
  between zoom bands. (Area targets shipped with abilities phase B, above.)
- **Hall of the Gods, next round** — rival/great-god pedestals (the `spiritId`
  plumbing exists), the per-node `hint` prose the view already carries but 10-foot
  type has no room for yet, and a real `pause` shell screen to replace the legacy
  `drawMenu` nav row that is currently the way in.
- **Spec E — The Book of [Spirit Name]** (emergent divine identity, naming ritual,
  chapter detection). The strongest expression of VISION §6.
- **Act 0 stone-age tutorial / Drifting Spirit opening** — first believer; an
  unpreventable Fate-loss the player can only give *meaning*
  (`docs/superpowers/specs/2026-05-31-dilemma-mvp-design.md` §12).
- **Spec C full — Branching** (parallel universes, discarded futures, lineage UI;
  `TimelineController.getDiscardedFutures()` is the hook).
- **Generated imagery** (NPC portraits, vistas, chapter scenes, god portrait) —
  gated by the art-reseed freeze.

## Track 8 — Mortal power: the lord, the castle, the knights  — ✅ **shipped**

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
- **M3 — the lord** — ✅ **SHIPPED 2026-07-17** — `noble` role + `LordState` on
  `World.lords` + `LordSystem` + `set_lord_stance` (tithe capped ±0.2, shrine-
  endowment proxy). Never gets a `beliefs[]` entry: he competes for *allegiance*.
  Closed M0.c (tithe scales the `work` self-restore).
- **M4 — the castle** — ✅ **SHIPPED 2026-07-17** (S1–S5) — the runtime-POI blocker
  was resolved in the slice rather than a separate spike.
- **M5 — knights** — ✅ **SHIPPED 2026-07-17** — `soldier` NPCs; the garrison got teeth.
- **M6 — the Peace of God** — ✅ **SHIPPED 2026-07-17** — spends `devotion`, not
  power, giving devotion its first job the player can feel.

**Track 8 is closed.** Per-slice reality checks live at the foot of the spec.

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

- **NPC motion & appearance** — own the MOTION, rent the APPEARANCE. Free motion
  capture (CMU BVH, vendored author-time) projects onto the existing paperdoll rig
  into checked-in `Clip` modules; appearance goes through one swappable
  `SpriteBackend` so no single art vendor is load-bearing. **Wave 1 shipped
  2026-08-03:** the BVH importer (`src/render/paperdoll/bvh.ts`), rig clips
  reaching live NPCs for the first time (`pray-raise`/`idle-shift`), the
  provider-neutral sprite library, and `AssetProvider` becoming real dispatch.
  **Wave 2 shipped 2026-08-04:** M2's studio + offline validation lanes, M4/M5
  (chip skinning, the frontal forearm unlock, and `march` — the rig's first gait
  LPC does not ship — live on moving soldiers), and all of Phase G: the
  rig-frame img2img pipeline with its gates (`src/assetgen/npc-sprite-pipeline.ts`),
  the author-time seeder (`scripts/seed-npc-art.ts`, `--plan` is free and there is
  deliberately no `--go`), and the runtime source shipped **dark**
  (`liveNpcArtEnabled = false`). **Nothing has been generated through it — every
  gate constant is a first guess awaiting the first funded run**, and the seeder's
  default target list is ONE sheet for that reason. *Next:* a funded pilot run
  (needs an explicit spend decision), then the two things G2's header names as
  genuinely unwired — deriving an `NpcSubject` description from a live
  `CharacterSpec`, and landing a generated strip on a fresh-identity canvas in
  `rigSheets`. Phase L (local SD backend) is a sketch by choice:
  `docs/superpowers/plans/2026-08-04-npc-local-sd-backend-sketch.md`. Spec + plan:
  `docs/superpowers/{specs,plans}/2026-08-03-npc-animation-appearance-*.md`.
- **Structure-mesh rendering** — render ground-anchored structural geometry
  (bridges + stairs first, walls/towers next) as real 3D meshes in a depth-tested
  pass sharing the terrain depth buffer, instead of flat billboard sprites. Fixes
  the bridge "float above the riverbed", wall/tower draw-order glitches, and
  "structures sit *on* the world not *in* it" — reusing the manifold geometry we
  already compute + discard. **$0, draw-only, no sim changes.** *Spec + plan, no
  code:* `docs/superpowers/specs/2026-07-15-structure-mesh-rendering.md`.
- **LLM-authorable modeling** — ✅ **shipped, B0–B5**
  (`docs/LLM-AUTHORING.md` — the authoring contract; plan:
  `docs/superpowers/plans/2026-08-07-llm-authorable-modeling-plan.md`; catalogue:
  `docs/PRIMITIVES.md`). An LLM (dev harness / MCP / in-game Fate) now authors game
  geometry as **validated Blueprints** through a deterministic feedback loop instead of
  hand-edited manifold-3d code: the `author-preview` loop (spec → gate → sprite +
  diagnostics; exit 0/1/2), the structure-stage audit (bbox, z-penetration, openings,
  mount sockets, massing), a complete generated capability catalogue + 8 worked examples
  pinned to pass-the-gate-and-compose, spec↔terrain fit measurement
  (`scripts/measure-structure-fit.ts`), and the golden/version commit contract. **No
  geometry was added** — the masonry wall/parapet/crenellation vocab was already
  authorable (`barrier` part + `body.parapet`), so no `ART_RECIPE_VERSION` bump. **$0.**
  *Deferred:* an MCP/dev meta-verb wrapping measurement (verb names are API - pending
  product sign-off).
- **New Game origin & onboarding** - the fresh-run entry re-conceived as **New Game** (a
  run, not a map) with a **god's-origin** first session. **Phase 1 shipped:** the
  game-vs-world terminology contract: title NEW WORLD->NEW GAME, LOAD WORLD->LOAD GAME,
  DEMO WORLD->DEMO; pause-menu NEW WORLD->NEW GAME; `new_game`/`load_slot` describe prose
  -> "begin a new game"/"load the saved game". Verb NAMES kept (external agent API, renaming
  is breaking); "world" kept only for the map/technical sense (COPY WORLD CODE). **Phase 2
  shipped:** first-run tidings re-authored as the player's origin story - the player
  "Boltzmanns into existence" because one primitive mind half-believes in a simple spirit,
  and domain/vocabulary is defined by that believer (`src/game/first-run-tidings.ts`).
  **Origin variety shipped:** `src/game/origin-profile.ts` derives a per-run origin
  (water/forest/stone/bog/dry/meadow place + a named founding first-mind + prose variant)
  from the seeded world - same world code, same opening; different codes differ. `$0`,
  no sim/worldgen change, sim-truth guarded (only storm/flood are real domains, so only a
  water place gestures at a water spirit - and never as a claimed power). **World-variety
  seam (B0) shipped:** a fresh `genSeed` only tunes noise - the world's identity is the
  `WorldSeed`, so a genuinely different New Game must vary the world/biome too. B0 adds
  the playable-world registry (`src/world/playable-worlds.ts`, canonical ids),
  `WorldManager.loadNamed`, threads `worldSeedName` through New Game/RANDOM/paste (fixing
  the paste-drop: world codes now regenerate the world they name), and `pickPlayableWorld()`
  on the same CSPRNG. With a one-entry registry RANDOM equals today (expected); B0 is
  invisible until worlds are authored. **B1 shipped (DR-6, WORLD_CONTENT_VERSION 119):**
  two new authored playable worlds are live — `dawn` ("A Steppe To The Sun", temperate/arid
  steppe-herder world) and `frost` ("The Frost Reaches", arctic/boreal fiord world). Both
  reuse existing biomes/climate/art, pass the world-doctor at 0 errors across seeds, and
  run at-or-better than the shipped `default` on the connectome contracts; `connectome-lint`
  now iterates every {`PLAYABLE_WORLD_NAMES`} entry (new `--world <id|path>` flag) and per-world
  schema/determinism pins gate each JSON. RANDOM genuinely yields different people/places/biome
  per run (old saves regenerate). *Deferred, gated
  (DR-6):* planned **Phase 3 single-believer intro mode** - a lone believer by a stream,
  rivals + statistical cohorts deferred until "first crystallization" matures the god into
  a clan (threads an intro flag through `startWorld`/`bootstrapWorld` + a deferred-seeding
  determinism pin); and any NEW domain/power (fire/sky/...) = a new `BeliefDomain` +
  capability + `DOMAIN_DEFS` entry (product sign-off + version/golden review). — one per-cell field → texturing + water +
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
- **UI v3 — "a proper, real game"** — ✅ **shipped, all phases**
  (`docs/superpowers/specs/2026-07-25-ui-v3-complete-game-design.md`; full history in
  `docs/superpowers/plans/2026-07-25-ui-v3-handoff.md`). Meta-mode (world-less) render path
  + sky backdrop, the shell screen stack, the WebGPU loading screen, UI kit + design tokens
  + a shared keyboard/gamepad focus ring, an 87-glyph pixel font, 12 meta capability verbs
  as an **external agent API**, in-process quit-to-title (`resetState` + keys-parity guard),
  instant title with generation on demand, the save services (slots + metadata store +
  append-only event journal, `SAVE_VERSION` 4) with save/load screens, settings v2 (four
  tabs, one settings-store) + independent audio buses, rebindable keymap + gamepad,
  game-over/photo-mode/seed-share/first-run tidings, the cloud descent/ascent sky
  transition (own blend overlay pipeline, `src/game/sky-transition.ts`'s pure phase curves),
  and **legacy-chrome retirement L1–L6** (~3,940 DOM lines deleted — tooltip, NPC/building
  panels, rival panel, narration card + placement modal, the minimap [deleted, not ported,
  per D4], `Game.barebones`/`?legacyui`/`FrameRenderer.legacyChrome`; `debugHud` stays DOM,
  `?dev`-only). Docs + full suite + server CI + branch push closed the epic (P7).
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
