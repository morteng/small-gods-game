# Hall of the Gods — Phase C build plan

**Date:** 2026-07-26 · **Branch:** `feat/hall-of-gods` off `main` (head `24bae4a8`) · **Mode:** Opus orchestrator + builders
**Fulfils:** Phase C design contract, `docs/superpowers/plans/2026-07-26-abilities-cast-targeting-hall-of-gods.md` §4
(now UNBLOCKED — ui-v3 and abilities A+B are both on main). Commit THIS file to
`docs/superpowers/plans/2026-07-26-hall-of-the-gods-plan.md` as the first commit on the branch.

**User intent:** skill screen = a **Hall of the Gods above the clouds** — the divine realm the
title/loading/quit transitions already establish. One pedestal per belief domain, materializing as
conviction grows (hazy silhouette → solid lit marble); node paths carry the CLAIM → COMMAND →
DOCTRINE ripening (belief-powers spec §3) with Skyrim's at-a-glance path readability — the
STRUCTURE, explicitly not the starfield skin. Design stance (do not drift): Skyrim levels by
doing; **we level by being believed** — the hall is an *observatory of follower belief*, never a
point shop. Nothing in the hall spends, buys, or unlocks anything; the sim is truth and the hall
makes it legible.

---

## 0. What recon established (2026-07-26, main @ 24bae4a8 — line numbers are pointers, re-verify)

Two thorough recon passes (shell/sky architecture; belief-powers data model). The findings that
BEND the §4 contract — read before touching anything:

1. **The §4 "free pad float in SGlobals" is GONE.** `sky-backdrop-wgsl.ts:36-39` — `uParams` is
   `vec4<f32>` = viewport.x/y, timeSec, coverage; the ui-v3 transition spike consumed the spare
   lane for `coverage`. §4's "do not resize the struct" is unsatisfiable *if* a shader-side hall
   variant is wanted. **Resolution: the MVP needs NO shader change at all** (see decision 4);
   an optional polish slice may grow the struct to two vec4s (32 B) with both packers +
   `SKY_BACKDROP_GLOBALS_FLOATS` (gpu-scene.ts:108, :1521, :1894) updated in the same commit.
2. **The `pause` shell screen does not exist.** `'pause'` is a ScreenId with no module and no
   `Shell.draw` case — it paints NOTHING while swallowing pointer input. The real Esc menu is
   still legacy `UiRuntime.drawMenu` (`ui-runtime.ts:2058-2140`). §4's "entry point: pause
   screen" is therefore a `drawMenu` nav row + `open_screen`, NOT a shell-screen edit.
3. **CLAIM → COMMAND → DOCTRINE is design-only — zero code.** No tier field, enum, state, or
   constant exists. The only shipped rhymes: unlockThreshold gate (= de-facto COMMAND), devotion
   resisting decay `rate = 0.01 × (1 − devotion)` (`belief-content-system.ts:52-54`, = de-facto
   DOCTRINE), and the whisper-card "Claim the storm" choice + inbox opportunities (= de-facto
   CLAIM). `BeliefPowerView` carries only the fused `conviction`, none of faith/understanding/
   devotion. **The hall synthesizes tier state as DERIVED LEGIBILITY in the projection — no new
   sim state, no persistence, no crossing events** (conviction is non-monotonic; decay can
   re-lock a pedestal, and the UI must tolerate regression).
4. **Full-coverage sky overlay already hides the world.** `renderFrame`'s
   `skyOverlay: {coverage, timeSec}` (gpu-scene.ts:1336) draws the cloud pass before `passUi`
   (:1476, :1889-1902); at coverage 1.0 the world is fully occluded and the shell draws on top.
   In meta mode `renderMeta` already IS the sky. **The hall sits above the clouds with zero WGSL
   changes.**
5. **The ascent transition cannot carry a screen** — `beginTransition` unconditionally clears
   the stack (`shell-state.ts:126-130`). Do NOT add a TransitionKind. The entrance/exit feel
   comes from a Game-side coverage ramp instead (slice H4): the screen stays pushed; only
   `currentSkyOverlay.coverage` eases. This is the §4 "ascent is the entrance" intent delivered
   without a reducer change.
6. **Vertical node ladders need no new batcher primitive.** `ui-batcher.ts` has axis-aligned
   quads only (no line()/rotated quad). Per-domain tier paths drawn as VERTICAL ladders
   (pedestal at base, CLAIM → COMMAND → DOCTRINE ascending) are pure `rect` segments. Do not
   add a `line()` primitive this round.
7. **Glyph budget** (pixel-font `G` table; the per-file guard `ui-pixel-font.test.ts:335-350`
   auto-covers `hall-screen.ts` and FAILS the build on any glyph not in the table): available
   and on-theme — `✦` `⚡` `◎` `🔒` `▶` `▸` `·` `—`. NOT available: `◆ ● ○ ─ │` and all arrows.
   Use rects for connective tissue, glyphs only as marks. Adding a glyph = a 7×5 design in `G`
   — allowed but should not be needed.
8. **Shell screens are meta-only by convention, not mechanism.** Data arrives via view closures
   in `ShellDeps` (shell.ts:110-144) supplied by Game (game.ts:564-573). `gameover` is the
   in-world precedent (sim keeps running behind it). The hall is the FIRST screen to read live
   sim state: it MUST read through the `Game.hudSim()` wall-clock memo (game.ts:1983-2011) —
   `beliefPowers()` is a full congregation sweep and the hall draws every frame over a running
   world. Never call `this.query.beliefPowers()` per frame.
9. **A shell screen does not pause the sim** — and the hall SHOULD NOT: a living observatory
   (bars breathing as belief shifts) is the point. No rate-stash wiring.
10. **`ScreenId` and `SCREEN_IDS` are two independent declarations** (`shell-state.ts:19-29` and
    `game.ts:195-200`) with NO parity test — forgetting the second makes `open_screen` silently
    refuse. H3 adds the missing parity test.
11. **`BeliefPowerView` is the single legibility payload** (game-query.ts:237 doc; spec :184).
    Extend it — never a parallel projection. OPTIONAL fields are free; required fields break
    the two exhaustive fixtures (`belief-powers-ui.test.ts:5-10`, `ui-runtime.test.ts:1190-1195`).
    Views stay JSON-serializable (they cross MCP/bus); `verb`/`domain` stay `string` (the
    widening keeps `BeliefPowerView[]` assignable to `VerbUnlock[]` at game.ts:1523 — don't
    narrow). `beliefUnlocks` (game-query.ts:365) duplicates the unlock formula — the unlock RULE
    does not change this round, so it stays untouched.
12. **God tier reaches no live surface today.** `Spirit.beliefMass/intimacy/tier/faded` exist
    (spirit.ts:31-43, written by SpiritSystem) but `SpiritView`/`PantheonRow` omit them; only
    save-slot metadata shows tier. `buildHallView` (Game-side) may read the Spirit directly and
    prebuild prose — no projection change needed for the spirit strip.
13. **`shell.ts:13` references a non-existent `src/game/shell-view.ts`** — aspirational comment;
    the real idiom is the per-screen `*View` closure. Build to the closures.

## 1. Product decisions (made — do not relitigate)

1. **The hall is read-only legibility.** No purchases, no spends, no unlock buttons. The ONE
   interactive concession: an unlocked pedestal offers **CAST ⚡** — it closes the hall and arms
   the existing reticle (`onCastPower` path), exactly what the POWERS panel button does. Same
   verb path for click and agent.
2. **Tier nodes are derived, with documented bars** (legibility only, tunable constants in the
   projection, NOT in sim):
   - **CLAIM** reached when `conviction ≥ 0.5 × unlockThreshold` — the domain is *heard*;
     coincidence play (whisper-claims, inbox opportunities) is meaningfully live.
   - **COMMAND** reached when `unlocked` (the existing registry gate, verbatim — never a second
     formula).
   - **DOCTRINE** reached when `unlocked AND meanDevotion ≥ 0.6` among the domain's reached
     believers — devotion 0.6 cuts domain decay to ≤ 40% of base (`belief-content-system.ts:52`),
     the honest "belief begins to self-sustain" line.
   Node states regress when numbers regress. No celebration events this round.
3. **The sim is untouched.** `src/sim/belief-domains.ts` gains at most a pure sibling aggregate
   (dimension means over domain believers); no new sim state, no new events, no threshold
   changes. Unlock semantics identical before/after.
4. **Entry points: the Esc menu (`drawMenu` nav row "HALL OF THE GODS") and `open_screen
   screen=hall`.** Both routes emit the same meta verb — a player click and an agent's
   `emit_command` share one path (game.ts:1122-1125 rule). No keybind this round. The nav row
   closes the menu FIRST (`setMenu(false)`) so `menuOpen` never overlaps the shell (recon: the
   overlap leaves the sim rate-stashed at 0).
5. **The hall works in BOTH modes.** In-world: full-coverage sky overlay occludes the running
   world. Meta mode (no world): draws over `renderMeta`'s sky with the honest empty state —
   `beliefPowers()` is already null-world-safe (all-zero rows). Never crash, never lie.
6. **Selection state lives on `Shell`** (the `settingsTab` precedent, shell.ts:262-304) — a
   `hallDomain` field + setter called from the action hook. NOT a `GameState` field (the
   field-count pin), NOT `open_screen` params (no mechanism exists; don't invent one).
7. **Materialization is a paint ramp, not state**: `materialize = clamp(conviction/threshold, 0, 1)`
   drives alpha/dim→ink/gold ramp per pedestal; DOCTRINE adds the gold glow. Gold marks
   interactive-and-divine only (CAST, reached nodes) — never wall-to-wall.

## 2. Slices (builder-sized; each lands compiling, linted, tested)

**H1 — the projection (sim-adjacent + game-query).**
Pure sibling in `belief-domains.ts`: `aggregateDomainDimensions(world, spiritId, domain)` →
weighted mean `{faith, understanding, devotion}` over NPCs with `dom ≥ DOMAIN_REACH_FLOOR`
(weight = the existing `aggregateWeight`; zero-believer → zeros). Extend `BeliefPowerView` with
OPTIONAL fields: `dimensions?: {faith; understanding; devotion}` and
`tier?: 'dormant'|'claim'|'command'|'doctrine'` (highest reached), derived in
`game-query.beliefPowers()` with the decision-2 bars as named constants + doc comments.
Null-world degrade: fields present with zeros/'dormant'. Tests: tier derivation across the four
states incl. regression (conviction drop re-locks), dimension means, JSON-serializability, the
two fixtures still compile untouched (fields optional), MCP `belief_powers` passthrough shape.
Sim laws: no Math.random, no new imports into `src/sim/` that could cycle (pure leaf math only).

**H2 — the screen module (pure, the big one).**
`src/render/ui/shell/hall-screen.ts`: `HallView` (prebuilt prose only — no raw ticks; fractions
0..1 allowed for bars), `HallAction = {kind:'back'} | {kind:'select'; domain: string} |
{kind:'cast'; verb: string}`, exported `hallRows(view)` (the pure row/enable logic `describe()`
walks — CAST disabled with `reason` when locked or faded), and
`drawHallScreen(c, w, h, s, view, selectedDomain): HallAction | null`.
Layout: pedestal COLUMNS across the width (2 today; design for N with horizontal `scrollList`
beyond what fits — overflow SCROLLS, never shrinks below `caption`); each column a vertical
node ladder — pedestal base (domain glyph `⚡`/`✦` + label), rect-segment spine ascending through
CLAIM → COMMAND → DOCTRINE marks (`◎` reached / `🔒` dormant); materialization ramp per
decision 7; conviction bar + threshold tick (reuse the drawPowers grammar); selected pedestal
gets a detail pane (blurb, "believed by N — reach M", dimension bars, next-node hint prose).
Spirit strip along the top: god name, tier, belief-mass line, `intimacy`; faded state shows the
canon line ("only whispers remain") and disables every CAST. Honest empty state (no world / no
believers): the hall stands, pedestals fully hazy, one caption line.
Laws: `shellTypeScaleFor` tiers ONLY (never `FS.body`/`FS.title`); size every box via
`buttonWidth`/`buttonHeight`; measure-then-place with a degradation `Plan[]`, recurse at `s−1`;
disabled-row guard in the HANDLER not the paint; every glyph in the `G` table (the per-file
guard will catch you); device-free (`ui-cpu-purity`).
Tests: mirror `shell-gameover-screen.test.ts` (rows / inside-target / no-overlap / click fires /
cramped viewport / keyboard ACTIVATE) + a `ui-no-truncation` hall case + describe⊇draw hit-id
union across scroll offsets (the settings-screen test shape) if the list scrolls.

**H3 — shell + host wiring.**
`ScreenId` + `SCREEN_IDS` both (+ NEW parity test pinning the two declarations against each
other — closes recon gotcha 10 for every future screen). `ShellDeps.hallView` +
`EMPTY_HALL_VIEW` + `Shell.hallDomain`/`setHallDomain`; `ShellDrawResult.hall` + `INERT_DRAW`;
one `case 'hall'`; `describe()` arm derived from `hallRows` (never a hardcoded literal — the
`newgame` arm is the anti-pattern). `UiRuntimeHooks.onHallAction` + dispatch in `frame()`.
Game: `buildHallView()` beside `buildTitleView` — composes `hudSim().powers` (THE MEMO) +
spirit fields read off `state.spirits.get(PLAYER_SPIRIT_ID)` into prebuilt prose;
`onHallAction` routes: back → `close_screen`, select → `shell.setHallDomain` (presentation,
no bus), cast → close hall then the existing `castPower` path. `open_screen screen=hall` just
works once SCREEN_IDS knows it. Esc-pops for free (`onShellEscape`). Integration test case in
`shell-runtime-integration.test.ts`.

**H4 — above the clouds + the way in.**
In-world: while `shell.top() === 'hall'`, `Game` supplies `currentSkyOverlay` with coverage
ramping 0→1 on push and 1→0 after pop (~700 ms, `easeOutCubic` from `sky-transition.ts` —
pure-curve reuse, NO new TransitionKind, stack untouched; the hall content fades in with the
ramp via a draw alpha or simply appears at ramp-end — builder's call, but the world must never
peek through a fully-open hall). Meta mode: skip the ramp, draw immediately over the meta sky.
Esc menu: `nav('nav.hall', 'HALL OF THE GODS')` in `drawMenu` → `setMenu(false)` → new hook →
`open_screen` emit. Respect the backdrop-click gotcha (row inside `navBox`). Tests: ramp curve
pure test; menu-row → open_screen wiring; quit-to-title while hall open (beginAscent clears the
stack — must not leave a dangling ramp).
OPTIONAL (only if trivially green): grow `SGlobals` to two vec4s for a hall-mode godray boost —
both packers + `SKY_BACKDROP_GLOBALS_FLOATS` same commit, pixel/golden tests updated. Skip on
any friction; the plan is complete without it.

**H5 — live verify + docs + gate.**
Dev server, real world, `__debug.grab()` (never page.screenshot): menu row → clouds close →
hall over running world; empty-state grab from title (`open_screen` via bus on `?bridge=rw`);
CAST from a pedestal arms the reticle after the hall closes; Esc backs out; quit-to-title from
inside the hall. Agent parity: `describe()` shows the same choices the grabs show; MCP
`belief_powers` returns the new optional fields. Docs: update §4 status in the abilities plan
(BLOCKED → SHIPPED pointer to this doc); ROADMAP row if one exists. Full gate.

## 3. Orchestration & guardrails

- **Worktree + branch `feat/hall-of-gods` off `main` (24bae4a8).** Nothing else is editing the
  shell right now, but stay in the worktree — the main checkout is shared.
- Builders per slice: H1 (projection) ∥ H2 (pure module — can start against the H1 interface
  immediately; agree the `HallView`/`BeliefPowerView` field names FIRST, in writing, in the
  plan-commit) → H3 (wiring, needs both) → H4 (sky + entry) → H5 (verify/docs). H1 and H2 in
  parallel is the only safe parallelism; everything after is sequential on shared files
  (`shell.ts`, `game.ts`, `ui-runtime.ts`).
- **Sim law:** `src/sim/` stays Math.random-free and import-cycle-free (leaf + repoint pattern).
  H1's aggregate is pure math over existing structures.
- **`npm run lint` stays ZERO** (never `--fix`). `npx tsc --noEmit` is the only trusted
  typecheck (editor inline diagnostics are FALSE under TS7).
- Known pinned tests that may move: the two BeliefPowerView fixtures ONLY if a field is made
  required (don't); `state-reset-parity` ONLY if a GameState field is added (don't);
  `shell-sky-transition.test.ts` if TransitionKind is touched (don't).
- Full gate before any push: suite green locally, then `./scripts/ci-on-server.sh`, grep
  `✓ Server CI passed` (commit FIRST — the script archives HEAD; never chain `; git push`).
  GOTCHA: a killed local poller does NOT kill the remote runner — poll the sentinel
  `/tmp/smallgods-ci-<branch-slug>/ci-exit.code` instead of re-running.
- Commit style: small, one concern per commit, explicit paths (never `git add -A`).
- **Do NOT merge to main autonomously.** When green + live-verified, push the branch and report
  back for the merge decision.
- Out of scope (tracked open tickets — do not drift into them): `WeatherSystem`'s hardcoded
  `ATTRIBUTION_SPIRIT='player'`; `divine-effects.trigger` Math.random; per-settlement
  `aggregateDomainAt`; rival pedestal views (the spiritId plumbing exists — a later round);
  a real `pause` shell screen; wiring `describe()` into MCP.
