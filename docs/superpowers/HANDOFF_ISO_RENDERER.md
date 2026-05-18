# Handoff: Iso Renderer (PR 1 shipped, PRs 2–7 ahead)

**Read this if you are picking up the iso renderer track.** Spec arc (A/B/C/D/E) is a separate thread — this handoff is just the iso visual upgrade.

## TL;DR

- **Iso renderer scaffold (PR 1 of 7) is open as [PR #6](https://github.com/morteng/small-gods-game/pull/6)** against `main` from `feat/iso-renderer-scaffold`.
- Branch sits on top of `feat/spec-b-time` (depends on Spec A/B types and the async `generateWorld()` pattern), so the diff is large until Spec B merges and the iso branch rebases onto `main`.
- Dimetric 2:1, 128×64 px tiles, flag-gated via `localStorage.smallgods.render.mode`. Logical world / sim / snapshots / saves unchanged.
- 599/599 tests passing. `vite build` clean. Iso renderer is a separate 3.6 KB chunk (dynamic import works).
- **Manual smoke (browser flip + pan/zoom + pick) still unchecked** — couldn't run interactively from the implementation flow. Do that before merging.

## What "iso renderer" means here

The user wants a higher-fidelity look without throwing away the sim. Brainstorm settled on:

| Decision | Choice | Why |
|---|---|---|
| Projection | Dimetric 2:1 | Classic pixel-art iso; PixelLab supports the view angle natively |
| Tile size | 128×64 px | "Songs of Conquest" scale; generous detail; ~16× pixel budget vs current 32px topdown |
| Rollout | Flag-gated parallel renderer | Top-down stays default; Spec C/D continue unaffected |
| Logical grid | Stays square | Only render math differs; sim unchanged |
| Engineering shape | Classic painter's iso (Canvas 2D) | Mirrors existing `renderer.ts` three-phase pipeline |
| NPC anims | 4 directions × 4 frames | Standard iso budget |
| Art MVP before flag-flip | terrain + buildings + NPCs + trees | Full set, generated via PixelLab |
| Asset cadence | Trickle across PRs 2–5 | Not one big batch |

Approach B (OffscreenCanvas terrain bake) and Approach C (WebGL/WebGPU iso pass) are explicitly out of scope — noted as future upgrade paths if perf demands or if the icegame compute-shader terrain dream gets a spec.

## Where PR #6 leaves things

**Files added/modified:**

```
src/render/iso/
  iso-constants.ts        ISO_TILE_W=128, ISO_TILE_H=64
  iso-projection.ts       worldToScreen, screenToTile, visibleTileBounds
  iso-camera.ts           createIsoCamera, centerOnTile, clampIsoZoom, ISO_ZOOM_MIN/MAX
  iso-ysort.ts            buildYSortBucket, buildingSortKey, YSortEntry
  iso-atlas.ts            IsoAtlas interface + createNullAtlas() (returns null for every lookup)
  iso-terrain.ts          drawIsoTerrain (diamond fallback via TILE_COLORS)
  iso-sprites.ts          drawIsoNpc / drawIsoBuilding / drawIsoTree (fallback shapes)
  iso-overlay.ts          drawIsoOverlays (no-op stub — overlays wire in PR 6)
  iso-renderer.ts         renderMap entrypoint stitching the three phases
src/render/select-renderer.ts   reads localStorage flag, dynamic-imports renderer
src/ui/pick-tile.ts             mode-aware click → tile
src/ui/controls.ts              3 call sites moved from screenToWorld to pickTile
src/game.ts                     awaits selectRenderer() in generateWorld(), uses this.renderMap
```

**Test files:** `iso-projection.test.ts` (8), `iso-camera.test.ts` (3), `iso-ysort.test.ts` (4), `iso-terrain.test.ts` (1), `iso-renderer.test.ts` (1), `pick-tile.test.ts` (2). Total +19; suite 576 → 599 (some delta is from Morten's concurrent `npc-movement` fix).

**Visuals you'll see** with `localStorage.setItem('smallgods.render.mode','iso'); location.reload();`:
- Terrain: flat-color diamonds per `TILE_COLORS`
- Buildings: extruded colored boxes (rhombus base + flat top + two side faces)
- NPCs: colored circle + iso shadow ellipse
- Trees: colored triangle on diamond base
- Past-veil / sim heatmap / sigils: not yet (PR 6)

## PRs 2–7 (still to do)

The spec describes 7 PRs total. PR 1 (this one) is scaffold. PRs 2–5 are repeating art-load work; PRs 6–7 are small.

| PR | Scope | Plan? | Notes |
|---|---|---|---|
| **2 — Iso terrain art** | Replace flat diamonds with real PixelLab-generated iso terrain (6 base types × 47 blob variants) | not written | Biggest asset gen cost. Plan should cover atlas format + PixelLab `view` param + IndexedDB cache reuse |
| **3 — Iso buildings** | 8 BUILDING_TEMPLATES × 1 iso sprite each (footprint + roof baked in) | not written | Smaller. Anchor + multi-tile offset already plumbed through `iso-sprites.ts` |
| **4 — Iso characters** | ~8 character classes × 1 sheet each (4-dir × 4-frame = 16 cells) | not written | Use PixelLab rotation feature for all 4 dirs in one call |
| **5 — Iso trees + decorations** | 5 tree variants + procedural decorations cached in IndexedDB | not written | Smallest |
| **6 — Iso overlays** | Past-veil signal wiring, sim heatmap, sigils, selection ring — all in iso | not written | Code-only, no assets |
| **7 — Flag-flip** | Expose `render.mode` in settings panel; decide whether to flip default | not written | Trivial UI |

The atlas layer is ready for art to drop in — `iso-atlas.ts` exports `IsoAtlas` interface (`getTerrain`, `getBuilding`, `getCharacter`, `getTree`). Replace `createNullAtlas()` with a real loader once art exists at `public/sprites/iso/`. Renderer falls back gracefully per-asset, so PRs 2–5 can land progressively without breaking the flag.

## Plan deviations caught during execution (read these before writing follow-up plans)

Six places the plan in `docs/superpowers/plans/2026-05-18-iso-renderer-scaffold.md` was wrong. Fixed in implementation, but apply the lessons when writing PRs 2–7:

1. **`Math.floor` → `Math.round`** in `screenToTile` — `floor` fails the diamond-interior point test; `round` is geometrically correct for nearest-tile picking.
2. **Y-sort test expected order** had ascending wrong (`['b','a','c']` for sums (2,10,9) should be `['b','c','a']`). Always sanity-check expected orderings against the actual sort key formula when writing test code in plans.
3. **`Tile.type` vs raw tile** — `GameMap.tiles: Tile[][]`, not `string[][]`. Each `Tile` has `.type: string`. The terrain pass needs `.type` access.
4. **`BuildingInstance.tileX/tileY`** — not `tx/ty`. The plan got the property names wrong.
5. **Picking is in `controls.ts`** — the plan said modify `overlay-dispatcher.ts`, but the dispatcher only does screen-space bbox hits. The 3 click→tile conversion sites are in `src/ui/controls.ts`.
6. **`NpcRole` / `Direction` literal types** — `'villager'` and `'south'` aren't valid; use `'farmer'` / `'down'` (or other union members). The `as NpcInstance` cast passes at runtime but `tsc --noEmit` flags it.

## Known gaps in PR 1

These are deliberate scope cuts noted in the PR body:

- **Iso zoom range** (`0.5×–4×`) is exported as `ISO_ZOOM_MIN/MAX` but not wired into the shared camera clamp. Camera uses topdown's `[0.25, 8]`. Cosmetic only — no behavior bug.
- **Per-mode camera state localStorage namespacing** was Task 13 — confirmed no-op because camera state isn't persisted anywhere. If/when persistence lands, the `pickTile` pattern (per-mode helper) is the model.
- **The full two-stage subagent review** (spec compliance + code quality) was condensed for the pure-function tasks (1–11) — controller-side verification after a spec-reviewer subagent timeout at Task 1. Integration tasks (12, 14) ran with full implementer subagents. **Final dedicated reviewer pass not dispatched.** If you want one before merging PR #6, dispatch via `pr-review-toolkit:code-reviewer` against the PR.

## Branch state

```
main                         8d2ebc6   (Spec B specs/plans only, NOT the implementation)
feat/spec-b-time             8d99686 + 4 unpushed local commits   (Spec B impl + Spec C planning)
feat/iso-renderer-scaffold   2de197a   ← PR #6 source; on top of spec-b-time
feat/iso-renderer-design     3f5fbf9   ← spec + plan only, off main. Probably redundant; could delete after PR #6 merges
```

**The mess:**
- Origin's `feat/spec-b-time` is at `1a9306d` (old). Morten has 5 local commits ahead of that, including the implementation that the iso branch depends on.
- PR #6 targets `main` because targeting origin's stale `feat/spec-b-time` would surface Morten's unpushed Spec B commits in the diff.
- **Cleanest path forward:** push `feat/spec-b-time`, merge it to `main`, then rebase `feat/iso-renderer-scaffold` onto `main`. PR #6 diff will collapse from +6356 to ~+1500.
- **Alternative:** re-target PR #6 at `feat/spec-b-time` once Morten pushes that branch. GitHub will redraw the diff.

## Concurrent-edits gotcha

Morten edited `feat/spec-b-time` directly while my subagents were running (added `99034e5 fix(npc-movement): consume fixed per-tick interval, not ctx.dt` on the iso branch and the same fix as `8d99686` on spec-b-time, different SHAs). This is fine for now — the iso branch carries the fix as a single commit — but **if `feat/spec-b-time` gets pushed and merged with `8d99686`, rebase will surface a duplicate-commit conflict on the iso branch.** Resolution: `git rebase` will probably auto-drop the duplicate; if not, accept the spec-b-time version and discard the iso branch's copy.

## How to verify the iso flag in browser

```
npm run dev
# open the URL Vite prints
# in devtools console:
localStorage.setItem('smallgods.render.mode', 'iso')
location.reload()
```

Expected:
- World renders as colored diamonds (terrain), extruded colored boxes (buildings), colored circles with shadows (NPCs)
- Pan (drag) and zoom (scroll) work
- Click on an NPC selects it (NPC info panel responds)
- No console errors over 30s of play
- `localStorage.removeItem('smallgods.render.mode'); location.reload();` → top-down restored, no regression

## Where to look in code

| What | File |
|---|---|
| Spec | `docs/superpowers/specs/2026-05-18-iso-renderer-design.md` |
| Plan (PR 1) | `docs/superpowers/plans/2026-05-18-iso-renderer-scaffold.md` |
| Iso projection math | `src/render/iso/iso-projection.ts` |
| Iso renderer entrypoint | `src/render/iso/iso-renderer.ts` |
| Flag reader / dynamic import | `src/render/select-renderer.ts` |
| Mode-aware picking | `src/ui/pick-tile.ts` |
| Atlas interface (null impl) | `src/render/iso/iso-atlas.ts` ← PR 2+ replaces with real loader |
| PixelLab service (used by PRs 2–5) | `src/services/pixellab.ts` |
| Existing tile colors (iso fallback uses these) | `src/core/constants.ts` `TILE_COLORS` |
| BuildingInstance type | `src/core/types.ts:21` |
| NpcRole / Direction unions | `src/core/types.ts:129,132` |
| Top-down renderer (reference for iso parallel) | `src/render/renderer.ts` |

## Recommended next session opening

**If continuing iso work:**
> "Pick up the iso renderer track. Read `docs/superpowers/HANDOFF_ISO_RENDERER.md`. PR #6 is open. Help me [(a) get it merged — verify manual smoke + dispatch a final code review, OR (b) write the plan for PR 2 — iso terrain art generation via PixelLab]."

**If returning to the spec arc:**
> "I'm going back to Spec C (Branching). Read `docs/superpowers/HANDOFF_SPEC_C.md` and ignore the iso work — PR #6 can wait."

## A note on flow

Subagent-driven-development is what produced this PR. It worked but with friction:

- **The spec-reviewer subagent hung at Task 1** (6.5 min stream-idle timeout). I switched to controller-side verification for pure-function tasks after that. Integration tasks (12, 14) got full implementer subagents and inline verification. This was a pragmatic deviation from the skill's prescribed flow; if you redo this with strict adherence, budget for the spec-reviewer step taking real time.
- **The plan had 6 small bugs** the implementer subagents caught (formula errors, type mismatches, wrong target files). The implementers reported them clearly via DONE_WITH_CONCERNS status. The skill's "trust but verify" framing held up: I would not have caught all six myself.
- **Token cost was meaningful.** 14 implementer dispatches across Sonnet (most) and Haiku (trivial). For PRs 2–5 (asset gen + atlas plumbing) the work is even more mechanical — consider Haiku for everything.
- **Don't forget the manual smoke.** Subagents can't drive a browser; the iso visual MUST be confirmed by a human (or a Chrome-DevTools-MCP run) before flag-flip.
