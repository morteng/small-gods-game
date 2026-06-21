# Flora multi-view bake-to-atlas (plan)

**Design context:** [2026-06-14-flora-vegetation-generation-design.md](../specs/2026-06-14-flora-vegetation-generation-design.md)
· builds on [2026-06-13-render-trees-slice2-spec.md](../specs/2026-06-13-render-trees-slice2-spec.md)
· **Status:** 📋 not started · **Branch:** `feat/flora-multiview-atlas` off `main`

Give trees and bushes **per-instance orientation variety** by baking each species'
parametric geometry from **N yaws** into a small atlas of `SpritePack`s, and letting
each placed plant pick a stable yaw bucket. Today every plant of a species blits the
*same* yaw-0 pack — a forest is N clones distinguished only by a quantized scale
class. This is the standout-ROI variety win from the NPC/flora animation thread, and
it is the **first half of a shared multi-angle bake pipeline** that the NPC voxel→8-dir
atlas work will reuse (flora = static yaws; NPCs later add animation frames).

## Context & decisions (the brainstorm, folded in)

- **Why bake, not live 3D:** keeps the 1:1 pixel-perfect rule intact (still AABB
  blits — no per-instance rotation in the instance buffer/shader), and reuses the
  existing parametric→`SpritePack` pipeline. Live mesh rendering was the alternative;
  rejected to preserve crispness and avoid a new render pass. (Buildings stay
  single-yaw baked — pixel-perfect + img2img skin matter most there, rotation least.)
- **Enabler already exists:** `composeStructure({ yaw })` (`src/assetgen/compose.ts`)
  is a turntable rotor about the vertical axis; **yaw≈0 is a deliberate no-op**, so
  existing golden hashes (`assetgen-golden.test.ts`) are untouched. The geometry-baked
  ground shadow rotates with the model, so shadows stay correct per yaw.
- **Decisions:** **8 yaws** (matches the NPC direction count → one mental model);
  **lazy bake** (warm a species' yaws on first use, not all 26×8 up front); **combine
  with the existing scale-class variety** (yaw × scale reads as a rich stand);
  **additive + flag-gated**, yaw-0 single-pack path stays as the fallback; **bump
  `ART_RECIPE_VERSION`** (runtime flora appearance changes → cache-bust).
- **Determinism:** the per-entity yaw is **render-side only** — derived from a stable
  hash of the entity id, no `Math.random`, nothing in `src/sim/`. Sim/snapshot/replay
  never see it; the same world re-renders identically.

## The seam (current → new)

`src/render/parametric-plant-source.ts` caches **one** `SpritePack` per species
(`Map<kind, SpritePack|null>`), resolved through `rc.resolveParametricPlantArt(kind)`
and emitted by `plantSpriteItemFromPack()` (`src/render/iso/iso-sprites.ts`), dispatched
in `entity-draw-list.ts` (~211). Four touch points, all render-side:

1. **`parametric-plant-source.ts`** — cache becomes `Map<kind, (SpritePack|null)[]>`;
   bake `yaw = k·(2π/N)` for `k∈0..N-1`, **lazily**; `packs[0]` ≡ today's yaw-0 pack.
2. **new pure helper** — `floraYawBucket(entityId, yawCount)` → `0..N-1`, stable, no RNG.
3. **`entity-draw-list.ts` / `render-context.ts`** — `resolveParametricPlantArt(kind,
   yawBucket?)` selects `packs[bucket]`; pass through to `plantSpriteItemFromPack`.
4. **none** in `instance-buffer.ts` / shader — still AABB blits → pixel-perfect kept.

Build order is **inside-out**: pure CPU pieces first (Node-testable), then the bake,
then wiring, then eyeball. Every stage leaves the suite green and the game rendering
(yaw-0 fallback) until the flag flips.

## Stage 0 — Branch + flag scaffold
- Branch `feat/flora-multiview-atlas` off `main` (confirm clean tree).
- Add a flag gating the multi-yaw path (`?floraYaw` URL flag + a `FLORA_YAW_COUNT`
  const, default count behind the flag; **off → current single-pack behaviour**).
- **Checkpoint:** tsc clean, suite green, no behaviour change.

## Stage 1 — `floraYawBucket` (pure CPU)
- Pure helper: stable integer `0..N-1` from a hash of the entity id (reuse the
  existing id-hash util if one exists; else a small fnv-style hash — **not**
  `Math.random`, **not** under `src/sim/`).
- Tests: deterministic across calls; in-range for N∈{1,4,8}; reasonably uniform over
  many ids; N=1 always 0 (degenerate = today).
- **Checkpoint:** Node tests green.

## Stage 2 — Multi-yaw bake in `ParametricPlantSource` (the core)
- Cache → `Map<kind, (SpritePack|null)[]>`. `warm(kind)` bakes the species' N yaws via
  `composeStructure({ yaw: k·2π/N })` → `structureResultToPack()`; **lazy** (only
  warmed species pay the cost). `packs[0]` is the unchanged yaw-0 bake.
- `resolveParametricPlantArt(kind, yawBucket = 0)` returns `packs[bucket] ?? packs[0]`.
- Tests: N distinct packs per species; **`packs[0]` byte-identical to the pre-change
  single pack** (regression guard — yaw-0 is a no-op); flag off → single pack only.
  (`composeStructure` runs in Node, per existing assetgen tests.)
- **Checkpoint:** tsc clean; source unit tests green.

## Stage 3 — Draw-list wiring
- `entity-draw-list.ts` (~211): compute `floraYawBucket(entity.id, N)`, pass to the
  resolver, hand the chosen pack to `plantSpriteItemFromPack`.
- `render-context.ts`: widen `resolveParametricPlantArt` signature with optional
  `yawBucket`.
- Confirm the **static draw-list cache** (`static-draw-list-cache.ts`) stays valid:
  yaw is stable per entity, so cached items don't churn — note it, verify no
  invalidation regression.
- **Checkpoint:** tsc + build clean; game boots (flag on).

## Stage 4 — Content version + golden stability
- Bump `ART_RECIPE_VERSION` (runtime flora appearance changes → cache-bust).
- Verify `assetgen-golden.test.ts` is **unchanged** (yaw-0 no-op); if any golden
  moves, that's a real bug in the rotor's no-op path — stop and investigate.
- **Checkpoint:** golden tests green; version bumped.

## Stage 5 — Browser eyeball + budget
- `npm run dev`, `__debug.grab()`: a stand of one species (oak) shows varied
  orientations; **bushes/shrubs** too; crisp at integer scale, **no rotation shimmer**
  (each instance is a static baked yaw); yaw × scale reads as a natural forest.
- Perf: ~10k flora overview — draw-list cache still effective; frame budget intact
  ([[project-renderer-perf-profiling]] bench).
- Memory: ~N× canvases per **warmed** species. Sanity-check the warmed-set footprint;
  if heavy, **fallback levers**: drop to 4 yaws, or bake only on-screen buckets.
- **Checkpoint:** screenshots captured; visual + perf sign-off.

## Stage 6 — Land
- Full suite green, tsc + build clean. `/code-review` the diff.
- Flag decision: default the multi-yaw path **on** (keep the flag as an escape hatch)
  or leave behind the flag for one more session — decide at sign-off.
- Update memory [[project-flora-vegetation-generation]] (yaw variety shipped) and note
  this is the **shared multi-angle bake seam** the NPC 8-dir atlas will extend
  ([[project-generative-npc-system]]). ROADMAP: flora variety done; NPC bake next.

## Risks / notes
- **Memory** is the one real cost (N× packs per warmed species). Lazy warming + the
  4-yaw / on-screen-only fallbacks bound it.
- **Shared seam intent:** name the bake helper generically — NPCs reuse "render
  geometry from N yaws → atlas", adding an animation-frame dimension on top. Don't
  over-fit it to flora.
- **Buildings explicitly out of scope** — they keep the single-yaw img2img path.
- **Replay safety:** per-entity yaw is a pure function of the (deterministic) entity
  id; never store it in sim state, never roll it from `Math.random`.
