# Multi-week execution plan — handoff to Opus / Sonnet

**Status:** canonical near-term execution plan · written 2026-07-05
**Audience:** future Claude sessions on Opus or Sonnet (this doc assumes you, the reader, are one
of them). ROADMAP.md stays the *destination* map; this doc is the *next-several-weeks* task
queue, pre-decided so you rarely need to make architecture calls solo.

---

## 0. How to work (read before any task)

**Read first, every session:** `CLAUDE.md` (gotchas are load-bearing), `MEMORY.md` (live epic
state), then the spec/plan the task links. The specs contain the decisions — do not re-decide
them; if a spec turns out wrong against code reality, STOP, write what you found into the spec
("## Reality check <date>" section), and pick the next task instead of improvising.

**Model routing.**
- **Opus:** worldgen/sim changes (determinism-sensitive), multi-system integration, anything
  touching save format / snapshot / replay / the deformation channel / hydrology, Fate/rival
  logic, new architecture. Also: writing new specs.
- **Sonnet:** shader/render polish with a precise spec, WebGPU-UI widgets, single-module features
  with crisp acceptance criteria, tests, doc upkeep, mechanical migrations.
- **Either, unsure → smaller scope.** A finished small slice beats a stalled big one.

**Non-negotiable guardrails (digest — full versions in CLAUDE.md):**
1. **No money:** art reseed FROZEN; never call paid generation; grey massing is correct.
2. **Determinism:** no `Math.random` in `src/sim/`/gen paths (guard test); all randomness via
   seeded rng. Hydrology runs twice (map-generator + hydrology-store) and must stay
   byte-identical — change only shared code.
3. **Every gen-output change:** bump `WORLD_CONTENT_VERSION` + update its pin test
   (`tests/unit/content-version.test.ts`) in the SAME commit. Probe ≥2 genSeeds
   (`scripts/probe-world.ts`, `npm run lint:world`).
4. **Terrain writes** go through the deformation channel (`src/world/terrain-deformation.ts`);
   post-gen `tile.type` writes MUST `bumpTilesRev(map)`.
5. **Entities:** mutate position/kind/tags only via `World.updateEntity()`.
6. **UI:** ALL new UI through the agent-driven system (Commands + affordances + UiSpec in
   `src/render/ui/`), never bespoke DOM panels (standing user directive 2026-07-05).
7. **Ship gate:** server CI (`./scripts/ci-on-server.sh`) — grep the log for
   `✓ Server CI passed` BEFORE pushing; never chain `; git push` after an ungated command.
   Local `npm run build` green. Push to `main` auto-deploys.
8. **Git:** branch per work package off `main`; explicit paths, never `git add -A`; check for a
   parallel session on the same checkout (`ps`, `git status`) before merging.
9. **Time constants:** fiction-day constants must be `TICKS_PER_DAY` multiples (1:1 realtime,
   R8). Never raw tick literals.
10. **Verify empirically** — a visual grab (`__debug.grab()`, dev server :3000) catches what
    assertions don't. For worldgen: before/after screenshots on the same seed.

**Definition of done per work package:** tests green (server CI), build green, visual verify
where it renders, WCV/pin handled, MEMORY.md topic file updated (one status line), pushed.

---

## Week 1 — Round 9 time controls + rivers quick wins

### 1.1 Round 9: fastforward + jump-to-next-event
Plan is complete and pre-decided: `docs/superpowers/plans/2026-07-05-round9-time-controls.md`.
- **WP-A (Opus):** `TimeController`, budgeted advance, seek engine, interest predicate,
  replay-excluded commands, `scripts/bench-sim-rate.ts`.
- **WP-B (Sonnet, parallel):** WebGPU transport cluster + landing UiSpec card + DOM time-chip
  retirement. Interface contract is in the plan §Work packages — respect it and the two WPs
  don't collide.
- No WCV bump; SAVE_VERSION untouched.

### 1.2 Rivers slice 1 — render polish (Sonnet)
Spec: `docs/superpowers/specs/2026-07-05-realistic-rivers-streams-design.md` §R6. Three shader
features in `src/render/gpu/wgsl/water-wgsl.ts` (+ CPU feeds already exist):
bank-edge fade + wet band, Valve dual-phase flow advection along the existing flow vectors,
unified SDF foam term. **No worldgen change, no WCV bump** — pure visual payoff, ideal first
task. Acceptance: before/after grabs on seed-pinned world; rivers read as moving water with a
soft waterline; no perf regression at overview zoom (profile per
[[project-renderer-perf-profiling]] protocol: midday-pinned, isolated browser).

### 1.3 Rivers slice 2 — rocks in rivers bug fix (Sonnet)
Spec §R4 first bullet. `clearObstructedVegetation` (`src/world/vegetation-clear.ts`) deletes the
boulders `riparian-scatter.ts` deliberately placed. Fix by ordering or a `waterPlaced` exemption
tag (pick whichever is less invasive after reading both files — the clear pass's road/river
tree-clearing purpose must survive). WCV bump + pin test. Acceptance: probe 2 seeds → boulders
present in river margins; existing riparian + vegetation-clear tests updated, no other scatter
regressions.

## Week 2 — rocks seated + honest meanders

### 2.1 Rivers slice 3 — rock bury + ground blend (Sonnet, 2 PRs)
Spec §R5. PR1: per-instance bury fraction (10–20% seeded) as negative foot offset in
`src/render/gpu/terrain-lift.ts` + iso `lifted-projection.ts` — render-only, no WCV. PR2: mini
settle pads for boulders ≥1.5 m via `settlement-deformation.ts` machinery + contact-ring darkening
(WCV bump). Matches flora doc §G7 `partialBury` — update that doc's roadmap table when done.

### 2.2 Rivers slice 4 — gradient-aware meanders (Opus)
Spec §R1. Replace the terrain-blind sine in `terrain/river-network.ts` (`reachMeander`,
`smoothCenterline`) with the science-driven planform (meander/straight gate S꜀ ∝ Q^−0.44;
K = S_valley/S_channel; λ = 11 widths; confinement clamp). Calibrate the gate coefficient on the
24 probe seeds. WCV bump; re-pin `river-channel-geometry` goldens + any crossing goldens that
move. Acceptance: side-by-side grabs on 3 seeds — lowland reaches meander in long wavelengths,
steep/confined reaches run straight; no road/crossing lint regressions (`npm run lint:world`).

## Week 3 — waterfalls (the big one)

### 3.1 Rivers slice 5 — reach types, steps, pools, waterfalls (Opus)
Spec §R2. The core mechanism is **per-pool flat water** in
`src/render/gpu/river-surface-field.ts` + step/plunge carves via the deformation channel +
vertical face + foam at drops in the shader. Slope-classify reaches (Montgomery–Buffington table
is in the spec). Suggest 3 PRs: (a) reach classification + profile quantization data,
(b) carve + surface, (c) render faces/foam. WCV bump. Acceptance: a brook in hills shows a
step-pool chain; a river over a steep edge shows a fall + plunge pool; plane-bed reaches
unchanged; determinism suite green.

### 3.2 Waterfall connectome nodes (Opus, after 3.1)
Spec §7 (decided): `waterfall` site nodes with mill/shrine affordance seats, following
`crossing-structures.ts` + site-connectome patterns. Keep slice minimal: node emission + lint
visibility + one affordance (shrine seat). Mill establishment can follow later.

## Week 4 — ponds, dams, fishing

### 4.1 Rivers slice 6 — fill-spill-merge ponds + beaver dams (Opus)
Spec §R3. Port Fill-Spill-Merge (Barnes 2020 — reference C++ linked in spec §8) or the simpler
testing-plane pool routine; beaver dams as crest-clamp weirs (siting rule in spec). WCV bump.
Acceptance: probe seeds show ponds in former erased pits with real outlets; ≥1 beaver dam
appears across the 24-seed probe set on brook/stream reaches near forest.

### 4.2 Pond/fishery connectome nodes (Opus or strong Sonnet)
Spec §7: `pond` nodes; `fishery` affordance (area/flow scored) realizing fisherman's hut + jetty
+ drying racks through the prop pipeline (grey-safe). NPC fishing *activity* is explicitly NOT
in scope — worldgen + site only.

## Weeks 5–6 — back to the gameplay arc (ROADMAP tracks)

These need a **spec-first cycle** (brainstorm → spec → plan) before code. Opus writes the spec,
gets user sign-off, then either model implements per routing above.

### 5.1 Conversation UI (Track 2 — the last core LLM surface)
Talk to a focused believer. Pre-made decisions to build on: it's a `UiSpec` card surface
(whisper-card is the precedent, `src/game/affordance/whisper-card.ts`); prompts via
`npc-prompt-builder`; fast tier; writeback through the existing state-writeback path; sim is
truth. Needs design: turn structure, interaction memory (`createInteractionSummary()` is
partial), how conversation surfaces in the semantic-zoom bands.

### 5.2 Rival power-economics + contention depth (Track 3 remainder)
Rivals currently claim prayers but their power economy is untuned and rival-vs-rival contention
is shallow. Needs a short spec: rival power budget symmetrical to the player's
(belief × understanding × devotion), spend/regen rates, and 1–2 contention behaviors
(proselytize, dispute). Keep deltas capped (anti-snowball is a VISION rule).

### 5.3 Fate pacing intelligence (Track 4 remainder)
Plot-thread tracker + escalation ladder + anti-grinding. Spec-first; the constrained-tools
pattern (`src/game/fate/fate-tools.ts`) is the boundary — new capabilities are new *tools with
caps*, never freeform. Era-authoring (D2 skip loop's LLM half) belongs here too.

## Parallel / filler queue (Sonnet-sized, any time a session has slack)

- **WebGPU-UI S3** input/scroll ([[project-webgpu-ui-mcp-integration]]), then MCP-into-running-game.
- **Legacy chrome L1** (tooltip) ([[project-legacy-chrome-retirement]]).
- **Entity pass 7–9 ms** gameplay-zoom perf ([[project-renderer-perf-profiling]] — follow the
  measurement protocol; do not trust stale baselines).
- **Storylet `subject:` binding** → command targets ([[project-storylet-engine]]) + 1–2 new packs
  (verbs MUST come from the capability registry — the allowlist rejects whole packs silently).
- Trample visibility tuning; stair/portcullis NEXTs ([[project-parametric-defensive-walls]]);
  world-style S4 live panel.
- Worktree hygiene: `sg-r8-*` worktrees + branches are removable (WP-H landed).

## Longer horizon (design-first; queue an Opus spec session, implement after)

Ordered by ROADMAP leverage:
1. **Track 5 — progression & win-state** (god tiers, fading threshold, win = attribution).
   The biggest missing *game* piece. Spec must anchor on VISION §5/§7.
2. **Book of [Spirit Name]** (Track 6 Spec E) — emergent divine identity; strongest VISION §6 payoff.
3. **Act 0 tutorial / Drifting Spirit opening** (dilemma-mvp spec §12 has the design seed).
4. **"Defying Fate has a price"** (scrub/re-roll costs belief — VISION tenet 10; small, sharp).
5. Rivers escalation IF valleys still read carved after slices 4–5: Génevaux valley profiles →
   stream-power pass (spec §5 escalation path).
6. Fastforward follow-ups: Fate-authored landing cards, era-authoring integration (round-9 plan
   §out-of-scope).

## Standing user directives (do not drop)

- Reseed FROZEN — no spending. · WebGPU-only renderer. · All UI agent-driven. · Push green work
  to main (auto-deploys). · Presets generative, not hand-tuned. · Dev viz in studios, not the
  shipped game. · Buttons over shortcuts; nothing shortcut-only. · Pixel-perfect art (native
  sizes, no fractional scaling).
