# Plan: round 4 — Fate sees rivals + storylets fire + overview fill perf (delegated)

**Date:** 2026-07-03 · **Integrator:** main session · **Base:** `main` @ `ff60adf` (post round-3).

Three independent, non-overlapping work packages: WP-L (Fate/game layer), WP-M (renderer),
WP-N (narrative sim + game layer). Same protocol as rounds 2–3.

## Shared protocol (all agents)

- Branch from current `main` in your worktree. Commit **explicit paths** (never `git add -A`).
- Verify with targeted tests + `npx tsc --noEmit` only; the integrator runs the full suite.
- No `Math.random` in `src/sim/` (guard test). No DOM outside `src/ui/`. No new npm deps.
  No paid generation of any kind. **No live LLM calls in tests** — `MockLLMClient` only.
- `WORLD_CONTENT_VERSION` (79): none of these WPs should change generated world output; if
  yours somehow does, verify with `npx tsx scripts/probe-world.ts` and say so loudly.
- Final report = data for the integrator: branch, SHAs, root cause / approach, files, evidence
  (numbers, renders, test output), test results, deviations.

---

## WP-L — Fate reacts to rivals: trigger + context + coaching lever (Opus)

Track 4 deepening, unblocked by round 3 (rivals now emit real events). Current state:

- `FateBrainService` is LIVE (`src/game/fate/fate-brain-service.ts`), woken by `FateTrigger`
  (`fate-trigger.ts`) which fires ONLY on plot-thread events (`thread_opened`/`thread_resolved`/
  `thread_advanced` climax) with a 480-tick cooldown. **Rival activity is invisible to Fate.**
- Rivals claim unanswered prayers (`src/sim/rival-claims.ts`, round 3): event-log entries are
  `{type:'answer_prayer', spiritId:<rival>, npcId}`. Rival state: `src/sim/rival-spirit.ts`
  (`RivalPersonality` — aggression etc.), `spirit.ai.settlements`, `buildRivalSituation`.
- Fate already has three constrained tools (`fate-tools.ts`): `arm_staged_beat`,
  `nudge_event_severity`, `force_next_event`.

Deliverables:

1. **Trigger on rival pressure.** Extend `FateTrigger` so sustained rival activity wakes the
   brain: a rival `answer_prayer` claim (non-player spiritId) counts toward a small threshold
   (e.g. ≥2 claims within a window) rather than firing per-event — keep the existing cooldown
   and `lastTick`-after-all-gates discipline. Don't fire on the player's own answers.
2. **Rival digest in Fate context.** `fate-context.ts` gains a compact rivals section: per
   rival — name/title, personality summary, settlements held, follower counts vs player,
   recent claims (from the event log). Reuse `buildRivalSituation`; keep it cheap and bounded
   (it rides an LLM prompt — think ~10 lines, not a dump).
3. **ONE coaching lever, through the command queue.** New authoring verb (e.g.
   `set_rival_stance`) in `src/sim/command/authoring-verbs.ts` + registry entry: adjusts a
   rival's `RivalPersonality` fields by clamped deltas (define per-call caps like
   `nudge_severity` does; hard floor/ceiling so Fate can't max a rival). Deterministic, no RNG.
   Precondition: target spirit exists, is a rival (not player). Expose it as a fourth
   constrained Fate tool with the same drift-guard pattern (validate rival ids against live
   spirits; dropped calls logged). Anti-snowball intent per VISION: Fate turns rivals UP when
   the player coasts and DOWN when they're drowning — put that in the tool description/prompt
   guidance, not in code.
4. Tests: trigger threshold/cooldown gating (incl. player-answer non-firing), context digest
   builder, verb clamps + preconditions, tool validation drops bad rival ids. Extend
   `tests/unit/fate-*`/rival test files where natural.

**Read first:** all four `src/game/fate/*.ts`, `src/sim/rival-claims.ts`,
`src/sim/rival-spirit.ts`, `src/sim/command/authoring-verbs.ts` (bias_event/nudge_severity are
the pattern), `command-registry`/`command-system` for verb registration, `docs/VISION.md`
§Fate for tone. Do NOT touch `src/render/ui/`.

---

## WP-M — overview fill-bound perf: shore-gated water shading + px ladder (Opus)

From [[project-renderer-perf-profiling]]. The regime map (measured, gen-8 iGPU floor):
gameplay-zoom water is WON (mesh cull → ~1ms); the open problem is **overview/fit-zoom, which
is FILL-bound** (px1 69ms → px4 12.5ms measured 2026-06-25). Round 3 (WP-J) measured that the
water pass is **memory-bandwidth-bound on bicubic height-field reads (~80 storage reads/frag)**
— cheaper ALU (fewer noise taps) changed look, not cost; naive half-res aliased the shoreline
clip. Rejected levers: do not redo half-res water or tap-count gating.

Deliverables:

1. **Measure first** (house rule): `window.__renderProfile({frames,warmup})` +
   `__renderTrace` on (a) watery overview/fit zoom, (b) gameplay zoom. Baseline numbers in the
   report. Note: `load:true` reloads the page — avoid in automated runs.
2. **Deep-water cheap-read branch.** In the water fragment path
   (`src/render/gpu/terrain-field.ts`), branch fragments far from shore (shore-distance > N
   tiles, or an equivalent cheap proxy already in the field data) to a **bilinear** height
   read; keep **bicubic ONLY near the shoreline** where the per-pixel clip needs it. The
   shoreline clip itself must stay full-res/bicubic-crisp — zero visible change at the
   water/land boundary (before/after grabs at 1:1, pixel-perfect house rule).
3. **Deepen the adaptive px ladder at wide zoom** where measurement supports it (px3/px4 help
   at overview per the 2026-06-25 profile; they did NOT at gameplay zoom — gate by zoom band,
   don't regress the ladder elsewhere).
4. Acceptance: measured ms/frame improvement at watery overview; no visual diff at gameplay
   zoom 1:1 (grabs via `__debug.grab()`, NOT page.screenshot); render tests + tsc green; the
   profiler (`render-profiler.ts`) mirrors any new uniforms/branches (standing rule).
   If measurement shows the bilinear branch buys <10% at overview, STOP, report the numbers,
   and ship only the ladder change — no unmeasured complexity.

**Read first:** `src/render/gpu/render-profiler.ts` (+ its memory of past findings in the
plan header comments), `terrain-field.ts` water pass + `uWindow` cull, `gpu-scene.ts` passes.
No sim changes.

---

## WP-N — storylets fire for real: arm → discover → play (Sonnet)

[[project-storylet-engine]] merged the engine but nothing ever ARMS a storylet:
`StagedBeat.storylet?: string` (`src/sim/threads/staging-types.ts`) and the
`onStoryletBeat(subject, storyletId, beat)` callback (`staging-activation-system.ts:93`) exist,
but no producer sets `.storylet`, so the callback never fires in a real game.

Deliverables:

1. **Recon + state the wiring precisely** in your report: where StoryPacks load, what
   storylets exist in the shipped pack(s), whether `game.ts` passes an `onStoryletBeat`
   callback today (if not, that's part of the gap).
2. **Deterministic producer arms storylets.** The stub/offline producer (and/or
   `PlotThreadSystem`'s beat staging) selects a matching storylet from the loaded pack for the
   beats it stages — deterministic selection (`ctx.rng` if a choice is needed), validated
   against the pack (unknown id → arm without storylet, log it).
3. **Fate can arm them too.** `arm_staged_beat` (`src/game/fate/fate-tools.ts`) gains an
   optional `storylet` param, drift-guarded against the loaded pack's ids (same pattern as
   `validPoiIds` — invalid refs dropped + logged, beat still arms).
4. **Game layer plays it.** Wire `onStoryletBeat` in `game.ts` (or the right `src/game/`
   module) so a fired storylet surfaces to the player — follow the existing pattern for
   narrative surfacing (divine inbox item and/or the P4 whisper-card `UiSpec` path in
   `src/game/` — check how round-3 rival threats surface in `game-query.ts` and match it).
   Keep it minimal: this WP proves the loop, not a dialogue system.
5. Tests: producer selects + validates storylet ids; fate-tool drift guard; activation →
   callback → surfaced item (extend `fate-integration.test.ts` or the staging tests).

**Read first:** `src/sim/threads/` (all), the StoryPack content files (grep `StoryPack`),
`src/game/fate/fate-tools.ts`, `src/game/game-query.ts` inbox patterns. Storylet CONTENT
authoring beyond what the pack already has is out of scope. Sim stays `Math.random`-free.

---

## Deliberately NOT in this round

- **WP-D (plan/compile split of `generateWithNoise`)** — still needs the integrator-authored
  design pass first.
- Conversation UI — next after storylets prove the narrative surfacing path.
- Rival power-economics tuning — wait until Fate coaching (WP-L) lands so tuning happens
  against the full loop.

## Integration protocol (integrator)

1. Merge order: WP-N, WP-L, WP-M (storylet plumbing first — WP-L's tool change touches the
   same `fate-tools.ts`; renderer last, verification is visual). Review each diff.
2. Full suite + build + `npm run lint:world` (expect 0 errors both seeds, unchanged) +
   browser check (Fate trigger on rival claims via injected state; overview perf numbers).
3. Zombie-session check (`ps`/`git reflog`/`gh run list`) before merging/pushing.
4. Single push to `main` once green.
