# Plan: agent-driven-UI P5 (zoom bands) + carve-connections fix — delegated round

**Date:** 2026-07-02 · **Integrator:** main session · **Base:** `main` after the agent-driven-ui P0–P4 merge.
**Spec:** `docs/superpowers/specs/2026-07-01-agent-driven-ui-semantic-zoom-spec.md` §6 (semantic zoom), §7 P5, §8 (acceptance gates).

Two independent work packages, one agent each, worktree-isolated. The integrator merges, runs the
full suite, and pushes. Agents run **targeted tests only** and never push.

---

## Shared protocol (both agents)

- Branch from the current `main` tip in your worktree. Commit with **explicit paths** (never `git add -A`).
- Verify with `npx vitest run <your test files>` + `npx tsc --noEmit` only. The integrator runs the full suite.
- No `Math.random` in `src/sim/` (guard test). No DOM outside `src/ui/` (legacy). No new npm deps.
- Do not touch `WORLD_CONTENT_VERSION` unless your change alters generated world output — then bump once and say so in your report.
- Final report: branch name, commit SHAs, files touched, test results, and any spec deviation with rationale.

---

## WP-F — P5: two semantic-zoom bands (Opus)

**Goal (spec §6/§7.12):** zoomed-in keeps today's inbox *list*; zoomed-out renders inbox items as
**world-anchored alert pins** on the map. Clicking a pin **camera-flies** to the target and opens the
item's action (never strand an action). Threshold on the existing zoom ladder, picked empirically.

### Verified seams (read these first)

| Seam | Location | State |
|---|---|---|
| `UiSpace.World` | `src/render/ui/ui-batcher.ts:29` | enum exists; batcher groups by space |
| **World groups are DROPPED** | `src/render/ui/ui-pass.ts:119` — `groups.filter(g => g.space === UiSpace.Screen …)` | the real gap: no world projection in the UI pass |
| `worldToScreen` / `zoomAt` / quantized rungs | `src/render/camera.ts` | camera is plain state `{x,y,zoom}`; zoom pixel-snapped |
| Smooth-camera precedent | `src/game/camera-follow.ts` — `applyFollowCamera`, 0.15 lerp, called per-frame | copy this shape for the fly tween |
| Inbox list | `src/render/ui/ui-runtime.ts:722` `drawInbox`; hook `getInbox` / `onInboxAct` | |
| `actOnInbox` | `src/game.ts:1026` (wired at `:719`) | routes through `Game.emitDivine` conventions from P4 |
| `InboxItem` | `src/game/game-query.ts:157` — `target: npc \| settlement \| none` | world anchor derivable; **no x/y yet** |
| NPC pos / settlement pos | `getNpc(world,id)` (`@/world/npc-helpers`); settlement via poi lookup (see `nearestPoiId` usage in `src/game/interaction-controller.ts`) | |

### Steps

1. **World-space UI projection.** Make `UiSpace.World` groups actually draw. Preferred: give
   `ui-pass.ts` a second uniform/projection for world space (world-px → clip via camera `{x,y,zoom}`),
   drawing World groups under the Screen groups. Acceptable alternative if the pass change is
   disproportionate: CPU-project pins through `worldToScreen` at batch time (the UI is immediate-mode,
   rebuilt every frame) — but then say so in your report; the spec names `UiSpace.World` as the home.
   Either way pins must track pan/zoom with **no lag or swim** and stay pixel-snapped (user standard:
   pixel-perfect).
2. **Anchor on `InboxItem`.** Add `anchor?: { x: number; y: number }` (tile coords) populated in
   `divineInbox` (`game-query.ts:445`): npc → entity pos; settlement → poi pos; `none` → omitted.
   Keep the golden test (`tests/unit/divine-inbox-golden.test.ts`) passing — extend the snapshot
   deliberately, don't loosen it.
3. **Band selection.** One pure function `zoomBand(zoom: number): 'in' | 'out'` (new file under
   `src/game/affordance/` or `src/render/ui/`), threshold chosen empirically on the zoom ladder —
   pick the rung where a tile falls below readable-chrome size (~16 world px on screen is a starting
   guess; verify visually and note the chosen value). Hysteresis (small dead zone) so the boundary
   rung doesn't flicker.
4. **Alert pins (out-band).** In `ui-runtime`, when band = `out`, render each inbox item as a
   world-anchored pin at its anchor: small glyph (kind-coded: prayer ✉ / opportunity ☀ / threat ⚠)
   + salience-tinted ring; `surfaced` items pulse or rank first. Cap visible pins (top N by salience,
   N≈8) — no per-NPC chrome zoomed out (spec rule: aggregate visuals). Pins are clickable
   (`UiContext` hit-testing works in screen coords — project the hit rect). In-band keeps today's
   list; crossfade alpha over the hysteresis zone rather than a hard switch if cheap, else a clean
   swap is acceptable for v1 (note the choice).
5. **Camera-fly.** `applyCameraFly(state, viewport)` beside `applyFollowCamera`: ease `{x,y,zoom}`
   toward framing the anchor at an in-band zoom rung (~0.5 s, smoothstep or the 0.15-lerp idiom);
   any user drag/zoom input cancels the tween. Clicking a pin (or an inbox-list row's existing act)
   flies first, then routes to the same `actOnInbox`/`emitDivine` path — the action itself must not
   change.
6. **Selection survives zoom** (spec rule): if the inspector is open and the player zooms out past
   the band, the inspector collapses and its target renders as a (distinct) pin; zooming back in
   restores it. Minimal version acceptable: close inspector on band-out, re-open on pin click.
7. **Tests.** Pure tests: band threshold + hysteresis, anchor derivation (npc/settlement/none),
   fly-tween convergence + cancel-on-input, pin top-N ordering. Runtime tests in the existing
   `tests/unit/ui-runtime.test.ts` style (headless UiContext): pins emitted in World space in
   out-band, list in in-band, pin click fires the hook. Extend the inbox golden as needed.

### Acceptance (spec §8 subset)

- No DOM; everything through `render/ui/` primitives.
- No LLM anywhere on the frame/hover path.
- Replay untouched: pins/fly are pure presentation; the emitted `Command` stream is unchanged.
- `npx tsc --noEmit` clean; your targeted tests green; `npm run build` green.

---

## WP-G — fix carve-connections connectivity (Sonnet)

**Bug (task #28, pre-existing on main):** `tests/unit/carve-connections.test.ts` fails
**deterministically** — seed 1, 32×32 map, the road flood-fill from POI A never reaches within
3 tiles of POI B at x=26. Bisected: fails at current main, at the terrain-epic base, and before —
a real worldgen bug, not a regression.

### Steps

1. Repro: `npx vitest run tests/unit/carve-connections.test.ts`. Read the test's intent first.
2. Diagnose where the connection is lost: does `carveConnections` (or its successor path through
   `road-graph.ts` / `map-generator.ts`) fail to lay road tiles, does something later overwrite them
   (check the claims ledger / junction work merged 2026-07-02), or is the test's flood-fill /
   tolerance itself wrong for the current pipeline? Instrument in a scratch script under
   `scripts/_scratch-*.ts` (delete before committing).
3. **Fix at the source, not the test** — unless the diagnosis shows the test asserts an obsolete
   contract (pre-connectome semantics); in that case fix the test and justify it in your report.
4. If the fix changes generated world output on real seeds (probe with
   `npx tsx scripts/probe-world.ts` before/after), bump `WORLD_CONTENT_VERSION` (78 → 79) in
   `src/core/content-version.ts` with a one-line note, and run `npm run lint:world` — no new errors.
5. Targeted tests: the fixed test + `road-graph`/`map-generator`/`claims`-adjacent unit tests +
   `npx tsc --noEmit`.

---

## WP-H — better tree geometry: canopy-first crowns (Opus)

**Problem (verified by offline renders 2026-07-02, `.dev-grabs/{english-oak,scots-pine,white-willow,silver-birch}-grey.png`):**
every species shares one failure mode — foliage is tiny tip-tufts, so bare branch dominates and
nothing reads as its species. Oak = flattened spider with canopy holes (should be a broad dense
dome); scots pine = blob pile from the ground (should be tall bare trunk + conical crown); willow =
bare skeleton with specks (should be a weeping cascade); birch = closest, but same tuft problem +
an abrupt cylinder sleeve at the trunk base. The low-poly faceted STYLE is right (matches
buildings) — keep it; fix the silhouettes.

**Direction — the crown envelope is the authority:**
1. Derive a species crown envelope (dome / cone / weeping / columnar / vase) from
   `crownShape` + `heightM` + spread (`src/flora/flora-species.ts` `deriveGenParams`;
   recipes in `src/assetgen/geometry/flora/recipes.ts`).
2. Foliage = fewer, LARGER clustered blobs filling the envelope (anchored to branch endpoints,
   radius scaling with branch depth), with a coverage pass so the envelope has no holes at
   silhouette level. Branches that exit the envelope get culled or shortened — no bare sticks
   poking out (willow excepted: its envelope IS the hanging curtain).
3. Per-species bare-trunk fraction (crown base height): pine high, oak low, willow medium.
   Fix the birch base sleeve (trunk should taper, not telescope).
4. The space-colonization generator (`src/assetgen/geometry/flora/space-colonization.ts`) is
   already in-tree — sampling its attractors INSIDE the envelope is the natural skeleton shaper.
   Use it where it beats the L-system (broadleaf crowns); keep the L-system where it wins
   (conifers, shrubs, ferns, flowers).

### Mechanics
- Sprites are memoized in-memory per session (`src/render/parametric-plant-source.ts`),
  regenerated at load — NO cache-version bump needed; geometry changes show on reload.
- All 26 species prewarm on the loading screen — keep total facet counts in the same ballpark
  (measure prewarm before/after; no order-of-magnitude regressions).
- **Dev loop:** `npx tsx scripts/building-preview.ts <species-id>` → `.dev-grabs/<id>-grey.png`
  → LOOK at the image. Iterate per species. A visual render catches geometry bugs no assertion
  does (house rule). Also check readability SMALL: in-game a tree is ~40–80 px, so downscale
  mentally or render and squint — silhouette must read at that size.
- Species to verify: english-oak, scots-pine, white-willow, silver-birch, common-hazel, plus one
  shrub + one fern + one flower for non-regression (their recipes share code paths).
- Determinism: seeded per species; no `Math.random` anywhere in generation.
- Tests: `tests/unit/flora-{recipes,mesh,generators,lsystem,turtle}.test.ts`,
  `flora-blueprint.test.ts`, `render-trees-slice2.test.ts` — update assertions deliberately
  where behavior intentionally changed; add envelope-coverage/bare-stick unit checks if cheap.
- NO paid generation: img2img flora stays OFF/frozen. Pure geometry.

## Integration protocol (integrator, not agents)

1. Merge WP-G first (small), then WP-F, each `--no-ff` after review.
2. Full suite + `npm run build` + `npm run lint:world`; visual check of pins/fly on the dev server.
3. Single push to `main` once green (auto-deploys).
