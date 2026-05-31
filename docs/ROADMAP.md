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

## Track 1 — Close the belief-model loops  ⭐ foundational, do first

These make VISION's central thesis *true in code*. Cheap, high-leverage, unblock
everything else. (VISION §9.)

| Item | Current state | Target |
|---|---|---|
| **Power formula** | `power += Σ faith × 0.02`; `understanding`/`devotion` read by nothing | `power regen ∝ Σ(faith × understanding × devotion)` so quantity ≠ power (VISION §3) |
| **Mortal self-agency** | activities set a target but never satisfy needs | on activity completion, restore the matching need (worship→meaning, socialize→community, work→prosperity) — the god is the *margin* (VISION tenet 9) |
| **Devotion has a job** | only Answer-Prayer writes it; nothing reads it | devotion drives power multiplier + propagation strength + unlocks costly acts (sacrifice/shrine/monument) |
| **Understanding has a job** | written, unread | gates sign-perception, prayer efficacy, and *story fidelity* (folds in the retired Stories subsystem — VISION §3, §9 #8) |
| **Consume belief events** | `belief_cross`/`mood_cross` fire, nothing listens | drive the Book, the timeline UI, and Fate's attention from them (VISION §9 #5) |
| **Secularization** | faith decays, but comfort isn't modeled as the trap | tune so met-needs → faith decay; surface it as the core tension (VISION §3) |

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
