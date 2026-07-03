# Plan: round 3 — swamp shrine fix + renderer perf + rivals live-data (delegated)

**Date:** 2026-07-03 · **Integrator:** main session · **Base:** `main` @ `6882d01` (post round-2).

Three independent, non-overlapping work packages: WP-I (worldgen placement), WP-J (renderer),
WP-K (sim). Same protocol as round 2.

## Shared protocol (all agents)

- Branch from current `main` in your worktree. Commit **explicit paths** (never `git add -A`).
- Verify with targeted tests + `npx tsc --noEmit` only; the integrator runs the full suite.
- No `Math.random` in `src/sim/` (guard test). No DOM outside `src/ui/`. No new npm deps.
  No paid generation of any kind.
- `WORLD_CONTENT_VERSION` (78): bump ONCE only if your change alters generated world output
  (verify with `npx tsx scripts/probe-world.ts` before/after); say so in your report.
- Final report = data for the integrator: branch, SHAs, root cause / approach, files, evidence
  (numbers, renders, lint output), test results, deviations.

---

## WP-I — swamp_shrine seated on water (task #22) (Sonnet)

**Bug (pre-existing, tracked):** `npm run lint:world` genSeed **12345** reports 3 errors around
`swamp_shrine` (`public/data/worlds/default.json:414`): `building.on-water` (shrine footprint on
2 water tiles) + `road-x-water` / `building-x-water` follow-ons. genSeed 777 is clean.

**Direction:** the shrine is *supposed* to sit in a swamp — the failure is the seat picker
accepting open-water cells, not the swamp setting. Likely fix altitude: the building placer /
seat scoring should treat water tiles as hard-invalid for the footprint (or ease/nudge the seat
to the nearest valid dry/swamp ground, the way settlement `cap` ground-easing works). Prefer a
GENERAL fix at the placement layer over a special case for this POI, and never a hand-move of
the authored anchor (presets/seeds are generative, not hand-tuned — house rule).

1. Repro: `npm run lint:world` (runs both seeds) — isolate the failing genSeed-12345 layout.
   `scripts/probe-world.ts` and a scratch script can dump the shrine's seat + surrounding tiles.
2. Diagnose which layer accepted the wet seat (seat scoring? footprint validity? deformation
   later flooding it? hydrology change since authoring?). State the mechanism precisely.
3. Fix at that layer. Guard with a unit test that reproduces the wet-seat situation compactly.
4. Worldgen output WILL likely change on seed 12345 → expect a WCV bump (78→79); confirm seed
   777 + default gen stay byte-identical or explain the diff. `npm run lint:world` must go to
   0 errors on BOTH seeds (the road×road info findings stay).

---

## WP-J — renderer perf: half-res water + per-frame query elimination (Opus)

From [[project-renderer-perf-profiling]] NEXT steps. NOTE: the waterAnimating→'ambient' ~20 fps
demotion ALREADY SHIPPED (`src/game.ts:1326/1374`) — do not redo it; measure on top of it.

1. **Measure first.** Build a repeatable frame-cost probe (headless where possible; else the
   dev-server tab with `__debug`/`window.__game` timers) on a watery overview view and a
   zoomed-in view. Record baseline ms/frame + where it goes (GPU pass vs CPU build). Numbers in
   the report — no perf claim without a measurement (house rule).
2. **Kill per-frame `world.query()`** on the frame path: find render/frame-loop call sites that
   query the world every frame (draw-list rebuild triggers, minimap, overlays) and cache/dirty-
   flag them (the static draw-cache pattern from the same epic is the precedent).
3. **Half-res water**: render the water/terrain water contribution at ½ resolution and upsample
   (or reduce the water pass's shading rate) while keeping shorelines crisp — pixel-art
   integrity matters (pixel-perfect house rule; nearest-neighbour upscale, no smearing).
   If the terrain shader architecture makes true half-res disproportionate, an alternative
   with equivalent measured savings (e.g. cheaper water shading path at overview zooms) is
   acceptable — justify with numbers.
4. Acceptance: measured improvement on the watery-overview scenario, zero visual regression at
   1:1 zoom (before/after grabs), all targeted render tests + tsc green. No sim changes.

---

## WP-K — rivals act on real information + claim unanswered prayers (Opus)

Track 3 status: `RivalSystem` (`src/sim/systems/rival-system.ts`) is LIVE (0.5 Hz) but feeds
`decideRivalAction` an EMPTY situation — `playerPower` only, `playerFollowersInSettlement: {}`,
`rivalFollowersInSettlement: {}`, `npcBeliefs: new Map()`. Rivals currently act blind. The
roadmap's headline — **"claim the prayers you don't answer"** — does not exist yet.

1. **Real situation data.** Build the situation from the world each decision tick: follower
   counts per settlement for player + each rival (existing believer/belief helpers — see
   `src/sim/believers.ts`, `getDomainBelief`/`aggregateDomain`), and the npc-belief map the
   decider expects. Keep it CHEAP (0.5 Hz, aggregate per settlement; no per-frame work).
2. **Claim unanswered prayers.** A prayer event that the player leaves unanswered for a
   deterministic window (define a constant, e.g. N sim-hours) becomes claimable: an eligible
   rival (present in / adjacent to the settlement, compatible domain) answers it — belief shifts
   toward the rival via the EXISTING belief loops (no new write path; route through the command
   queue like their other actions). Emit a SimEvent so the player can see what happened.
3. **Surface to the player.** The divine inbox already has a threat kind — an unanswered prayer
   nearing its claim window and a successful rival claim should each surface (check
   `divineInbox` in `src/game/game-query.ts`; follow its existing salience patterns). This makes
   the P5 zoom-band pins immediately more alive.
4. Determinism: everything through `ctx.rng`/seeded state; replay-safe (commands through the
   queue with `seq`). No LLM anywhere in this loop.
5. Tests: unit tests for the situation builder, the claim-window state machine, a
   claimed-prayer belief shift, and inbox surfacing. Extend existing rival/believer test files
   where natural.

**Read first:** `src/sim/rival-spirit.ts` (the decider you're feeding), `rival-adapter.ts`,
`src/sim/believers.ts`, `src/sim/spirit-system.ts`, prayer event shape (grep `prayer` in
`src/sim/`), `docs/VISION.md` §rivals for tone. Do NOT touch UI files (inbox surfacing happens
in `game-query.ts`, which is game/, not render/ui/).

---

## Deliberately NOT in this round

- **WP-D (plan/compile split of `generateWithNoise`)** — the world-compiler flagship; needs its
  own design pass first (integrator writes that spec separately).
- Conversation UI, Fate-authored UiSpec cards, area targets — after rivals land, Fate has more
  to react to.

## Integration protocol (integrator)

1. Merge order: WP-I, WP-K, WP-J (worldgen first since it may bump WCV; renderer last since its
   verification is visual). Review each diff.
2. Full suite + build + `npm run lint:world` (expect 0 errors on both seeds after WP-I) +
   browser check (water perf numbers, rival events in inbox).
3. Single push to `main` once green.
