# Small Gods — Roadmap

**Version**: 1.0.0
**Status**: Canonical — the single forward plan
**Last Updated**: 2026-05-31

> This is the **one** go-forward plan. It supersedes the old `IMPLEMENTATION.md`
> and `MVP_ROADMAP.md` (both archived/removed). It is anchored on
> [VISION.md](VISION.md) — the canonical cosmology, belief model, and arc.
>
> **How to use it:** each track below is a *destination*, not a task list. When a
> track is picked up, it gets its own **brainstorm → spec → plan** cycle written to
> `docs/superpowers/specs/` and `docs/superpowers/plans/`. This file says *what*
> and *why* and *in what order*; the specs say *how*.

---

## Shipped baseline (do not re-litigate)

Architectural spine (Spec A), Time scrub/commit/re-roll (Spec B), clickable time
history (Spec C minimal), Phase 7 NPC simulation, Phase 8 divine actions, the TS
migration, LPC terrain/sprites + PixelLab asset library, the iso-renderer scaffold
(flat colored diamonds — the autotiled-art experiments were abandoned), dev-mode
inspector, and the `game.ts` decomposition. ~733+ tests passing. Historical specs
& plans live in `docs/archive/`.

The world model is real: NPCs are `World` entities (`faith/understanding/devotion`
per spirit + `safety/prosperity/community/meaning` needs), systems tick on the
Scheduler, the sim is deterministic and snapshot/replayable.

**The gap:** the systems exist but the core *loops are open* — belief is tracked
but barely consumed, rivals are inert, Fate is unbuilt, and there is no
progression. Closing those loops is the work below.

---

## Track 1 — Close the belief-model loops  ⭐ foundational — ✅ **shipped**

These make VISION's central thesis *true in code*. Cheap, high-leverage, unblock
everything else. (VISION §9.) **Shipped via the Dilemma MVP + the "make understanding
matter" slice (merge `f8dce2c`, 2026-06-01).** The genuinely self-contained loops are
closed; the few remaining items below are deferred *by dependency* into their natural
later tracks (noted inline).

| Item | State | Notes |
|---|---|---|
| **Power formula** | ✅ done | `power regen ∝ Σ faith·(1+2u)·(1+2d)` — `spirit-system.ts`. Quantity ≠ power (a deepened believer ≈ 9× a fearful one). |
| **Mortal self-agency** | ✅ done | activity completion restores the matching need (work→prosperity, socialize→community, sleep→safety); **worship is excluded — the god is the margin for meaning** (`npc-activity-system.ts`). |
| **Secularization** | ✅ done | comfort decay + abandonment decay + desperation boost (`npc-sim.ts`); devotion resists both. |
| **Understanding has a job** | ✅ done | gates sign-perception (omen/whisper/realization reach) + prayer efficacy via `signResponse` (`f8dce2c`). *Story-fidelity / misattribution* — the 3rd VISION §3 job — **deferred to Tracks 2–3** (needs LLM + rivals). |
| **Devotion has a job** | 🟡 2/3 | power multiplier ✅ + propagation ✅; **costly-acts gating ❌ deferred** — needs the costly acts (sacrifice/shrine/monument) to exist first (Track 7 / progression). |
| **Consume belief events** | 🟡 emitted | `belief_cross`/`mood_cross`/`believer_lost` fire and feed the timeline UI; **driving Fate's attention deferred to Track 4**, the Book to Track 6. |

## Track 2 — Phase 9: LLM backfill (partial → done)

Make the narration layer real. **Rule: the sim is truth; the LLM animates it and
never contradicts its numbers** (VISION §2.1, LLM_INTEGRATION.md).

- Replace the hardcoded `MockLLMProvider(100)` in `triggerLlmBackfill` with the
  configured provider; wire `applyLLMWriteback` so narration deltas feed back into
  sim state (VISION §9 #4).
- Finish NPC focus/inspector integration.
- Interaction memory (compress + store; `createInteractionSummary()` is partial).
- Conversation UI.

## Track 3 — Phase 10: Rival spirits

Wire the inert `rival-spirit.ts` scaffolding into a live `RivalSystem`.

- Rivals regen power, act on personality+situation, and **claim the prayers you
  don't answer** (defection — VISION §3 Faith, §4 counter-loop).
- **Player-modelling lives here** (rivals learn your strategy), *not* in Fate.
- Spirit↔player intersection detection → LLM-narrated rival encounters (a rival
  speaks through a devoted follower).
- Inter-faction conflict (proselytizing, disputes, eventually holy wars).

## Track 4 — Phase 11: Fate (the DM agent)

The background orchestrator. **Fate is impersonal & reactive** — it amplifies and
escalates what the sim already produces; it is never petitioned and never models
the player (VISION §2.1). Build as a low-frequency `FateSystem` emitting commands
on the same channel as the player and rivals.

- World-state summarizer → compact prompt; cadence on game-day / significant change.
- Plot-thread tracker (setup → active → climax → resolve); escalation ladder.
- **Fate resists ascension** — the bigger a god gets, the harder Fate pushes back
  (the built-in anti-snowball — VISION §4).
- Anti-grinding detection; new-NPC injection (preacher / skeptic / refugee) as
  *escalation*, not arbitrary plot.
- "Defying Fate has a price": time-scrub/re-roll must cost belief or invite Fate
  escalation (VISION tenet 10).

## Track 5 — Progression & win-state

The arc's spine (VISION §5, §7). Subsumes the old power-tier table and
six-victory menu from the retired DESIGN.md.

- God tiers (small → cult → major) with believer accounting.
- God **fading threshold** — faith → 0 across believers shrinks a god toward
  "nothing but names" (applies to you, rivals, and major gods).
- **Win = attribution, not comfort:** become the name credited in crisis *and*
  plenty; supplanting = starving rivals/major gods' belief until they fade.
- Established **major gods** as endgame antagonists — powerful but hollow,
  beatable by intimacy.

## Track 6 — The arc surfaces (UI/UX features)

Resolve against the kept design reference `docs/design/2026-05-17-ui-system-handoff/`.

- **Spec E — The Book of [Spirit Name]** (emergent divine identity, naming ritual,
  chapter detection, narrative rendering). The strongest expression of VISION §6.
- **Act 0 stone-age tutorial** — first believer; an unpreventable Fate-loss the
  player can only give *meaning* (VISION §7, Act 0). Teaches the Gods-vs-Fate stakes.
  Its front-end is the **Drifting Spirit** opening (powerless roving spirit drifts &
  illuminates the dark, drawn to minds, free first-contact bootstraps belief, 1–3
  hand-scripted Fate scenarios) — specced as "Slice 2" in
  `docs/superpowers/specs/2026-05-31-dilemma-mvp-design.md` §12, to follow the
  Dilemma MVP (Slice 1).
- **Spec C full — Branching** (parallel universes, discarded futures, lineage UI;
  `TimelineController.getDiscardedFutures()` is the in-place hook).
- **Spec D — Cinematic** (cutscenes, camera director, void visual polish).
- **Generated imagery** (NPC portraits, area vistas, chapter scenes, god portrait).

## Track 7 — Backlog (low priority / opportunistic)

- Divine-action ladder beyond the current five: **bless / curse / manifest /
  empower-prophet** (harvested from the retired DESIGN.md; design against VISION).
- Natural-language → world-seed generation (LLM prompt → validated seed).
- SAM-2 segmentation → walkability mask → A* pathfinding (from the archived art
  pipeline plan).
- Deferred terrain phases: **2b** dual-grid, **4** offscreen bake, **5** HSWFC over
  POI zones, **6** normal-map lighting (from the archived terrain roadmap).
- **Open design question:** independent magic-users (wizards/heroes who bend
  reality outside the belief economy) — yes/no, and if yes, how (VISION §10).
- **3D/voxel pivot + Fate-driven asset generation.** 🔬 Researched, not scheduled —
  see [ANIMATION_AND_ASSET_GENERATION.md](ANIMATION_AND_ASSET_GENERATION.md). Animate
  the eventual NPC/animal/monster zoo (and ever-growing worship vocabulary) by moving
  to a WebGL/voxel renderer and giving Fate a **cache-or-generate asset library**:
  reuse a pre-generated motion/model when one fits (caption→embed→retrieve), else
  prompt a generator (AnyTop for arbitrary-topology creature motion; HY-Motion/Kimodo
  for humanoids; Meshy/Tripo or open Hunyuan3D/TRELLIS for bodies), then write it back
  for reuse. **Three coupled future tracks:** (1) WebGL renderer, (2) self-hosted
  generation service, (3) the Fate asset-library/retrieval layer (the novel heart;
  spec this one first). **Determinism rule:** the library is the deterministic
  interface — generation never touches the sim/replay path; bind chosen asset IDs into
  scenario state. **Now:** keep building Tracks 1–4 with placeholders; do not start the
  renderer rewrite or gen-service yet.
  - **Spike (2026-06-21) — bake-to-atlas sidesteps the renderer rewrite.**
    [`docs/superpowers/spikes/2026-06-21-biped-skeletal-bake-spike.md`](superpowers/spikes/2026-06-21-biped-skeletal-bake-spike.md)
    proved a procedural skeletal biped can be posed by FK and baked to an **8-direction ×
    8-frame animation atlas through the *existing* asset pipeline** (`composeStructure`):
    skeleton bones = flora `Limb` capsules, the yaw rotor gives directions, `fixedFit`
    keeps a constant metric scale, output is plain pixel-perfect sprite blits + full PBR
    G-buffer — **no WebGL/voxel renderer needed** (coupled track 1 above largely moot for
    the *render* side). This is the shared multi-angle bake seam the flora multi-view plan
    builds first; NPCs add the animation-frame dimension. Remaining work is content/policy
    (real rig, pose library mapping `LPC_ANIMATIONS`, img2img skin + boiling, atlas
    packing/draw-list wiring), not plumbing. Feeds the generative-NPC rebuild.
- **Persistence principle + death & remains.** Worldbuilding rule: *once an NPC
  is instantiated it never leaves the world* — no sim-driven hard-deletes. Losing
  faith is a **lapse** (already shipped: `AbandonmentSystem` marks `believer_lost`
  and the soul lives on as a re-convertible non-believer), **not** death. Death is
  a separate, rarer event that converts the actor into a persistent **remains**
  entity (skeleton / grave / abandoned dwelling) discoverable for ~100+ in-game
  years, slowly weathering but never fully disappearing — the world accretes its
  own archaeology. Needs: a `remains` entity kind, a death trigger (age/famine/
  plague — distinct from lapse), a long weathering decay, and renderer support.

---

## Suggested sequencing

```
Track 1 (belief loops)  ──┬──►  Track 3 (rivals)  ──┐
   foundational           │                          ├──►  Track 5 (progression & win)
Track 2 (LLM backfill)  ──┘──►  Track 4 (Fate)   ───┘
                                                       └──►  Track 6 (Book, tutorial, branching, cinematic)
Track 7 — opportunistic, any time
```

Track 1 first: it's cheap and makes every later track meaningful (no point
building rivals that compete over belief that doesn't yet behave correctly). Tracks
2–4 are the big systems; 5 ties them into a game; 6 is the player-facing payoff.
