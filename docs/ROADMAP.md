# Small Gods — Roadmap

**Version**: 2.0.0
**Status**: Canonical — the single forward plan
**Last Updated**: 2026-06-21

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

Belief is modeled and now *partly* consumed (Track 1 loops + belief-powers), but
**rivals are inert, Fate is unbuilt, and there is no progression / win-state.**
The narration layer animates focus but there's no conversation UI and no Book.
Closing those loops is the work below.

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

## Track 3 — Rival spirits (Phase 10)  — ⬜

Wire the inert `rival-spirit.ts` scaffolding into a live `RivalSystem`.

- Rivals regen power, act on personality+situation, and **claim the prayers you
  don't answer** (defection — VISION §3/§4).
- **Player-modelling lives here** (rivals learn your strategy), *not* in Fate.
- Spirit↔player intersection → LLM-narrated rival encounters (a rival speaks
  through a devoted follower).
- Inter-faction conflict (proselytizing, disputes, eventually holy wars).

## Track 4 — Fate, the DM agent (Phase 11)  — ⬜

The background orchestrator. **Fate is impersonal & reactive** — it amplifies and
escalates what the sim produces; never petitioned, never models the player
(VISION §2.1). Build as a low-frequency `FateSystem` emitting commands on the same
command/query bus as the player and rivals. **Model: the capable tier**
(`DEFAULT_CAPABLE_MODEL`) via `Game.llmClientCapable`; cadence on game-day /
significant change, so cost/latency is acceptable.

- World-state summarizer → compact prompt.
- Plot-thread tracker (setup→active→climax→resolve); escalation ladder.
- **Fate resists ascension** — the bigger a god gets, the harder Fate pushes back
  (built-in anti-snowball — VISION §4).
- Anti-grinding detection; new-NPC injection (preacher/skeptic/refugee) as
  *escalation*, not arbitrary plot.
- "Defying Fate has a price": time-scrub/re-roll must cost belief or invite
  escalation (VISION tenet 10).
- Owns the **LLM era-authoring half** of the D2 time-skip loop.

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

## Track 6 — The arc surfaces  — 🟡 **first pieces shipped**

The player-facing payoff. **Shipped:** belief-powers skill panel + divine inbox,
the storylet card. **Brainstormed:** the Presentation Director (adaptive score,
cinematic camera, SFX/voice — observes the sim, off the command bus). Remaining:

- **Spec E — The Book of [Spirit Name]** (emergent divine identity, naming ritual,
  chapter detection). The strongest expression of VISION §6.
- **Act 0 stone-age tutorial / Drifting Spirit opening** — first believer; an
  unpreventable Fate-loss the player can only give *meaning*
  (`docs/superpowers/specs/2026-05-31-dilemma-mvp-design.md` §12).
- **Spec C full — Branching** (parallel universes, discarded futures, lineage UI;
  `TimelineController.getDiscardedFutures()` is the hook).
- **Generated imagery** (NPC portraits, vistas, chapter scenes, god portrait) —
  gated by the art-reseed freeze.

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

- **Terrain+Water shader system** — one per-cell field → texturing + water +
  scatter; zoom-LOD; pixel-perfect snap (also kills jerky-zoom). *Spec, no code.*
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
Track 1 (belief loops) ✅ ──┬──►  Track 3 (rivals)  ──┐
                            │                          ├──►  Track 5 (progression & win)
Track 2 (LLM backfill) 🟢 ──┘──►  Track 4 (Fate)   ───┘
                                                       └──►  Track 6 (Book, tutorial, branching)
Engine & world epics — parallel, continuous           Track 7 — opportunistic, any time
```

Track 1 is done. **Track 2's conversation UI** and **Track 3 (rivals)** are the
highest-leverage gameplay moves next: rivals make belief contested, and a
conversation surface makes the LLM layer felt. Track 4 (Fate) is the big system
that ties pacing together; Track 5 makes it a game with a win; Track 6 is the
payoff. The engine epics run continuously alongside.
