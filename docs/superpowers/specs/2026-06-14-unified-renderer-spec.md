# Unified renderer over the connectome graph — Slices R0–R3 (spec)

**Date:** 2026-06-14 · **Status:** spec (ready for plan) · **Branch:** `feat/unified-renderer`
(worktree `/Users/Morten/mcpui/small-gods-render`, dev port :3002) ·
**Brainstorm:** [unified renderer / connectome](2026-06-14-unified-renderer-connectome-design.md)

## Purpose

Turn the current split render path (Canvas2D terrain + a separate WebGL entity
layer, static lighting, no elevation) into **one GPU scene driven by a narrow,
stable projection of the world graph** — without breaking `main` and without
colliding with the two sibling sessions (connectome, modeling).

Four slices, each shippable behind the existing renderer seam:

- **R0 — the `RenderGraph` seam.** A renderer-owned read interface + an adapter
  from today's `World`/`Tile`. The *current* iso renderer reads through it. Pure
  refactor; golden-frame parity. **This is the cross-session contract** — land first.
- **R1 — elevation data.** Resurface the worldgen heightfield (generated then
  discarded today) onto the terrain the renderer reads. Still Canvas2D, now
  height-shaded — a free win and a data foundation.
- **R2 — the GPU scene (WebGPU/WGSL).** Terrain + instanced lit entities in one
  Pixi v8 WebGPU pass under one camera; Canvas2D stays the parity fallback for
  no-WebGPU clients.
- **R3 — dynamic day/night.** Wire `studio/solar.ts` → live `LightingState`.

R4+ (water, fog, terrain-receives-shadow, emissive night windows, weather) are
sketched in the brainstorm and specced later.

## First principles (load-bearing constraints)

1. **Renderer = pure projection.** The renderer reads a `RenderGraph` view and
   emits pixels. No render state flows back into world/sim/graph. (Already true of
   `RenderFn(ctx, RenderContext)`; R0 hardens the *input* into `RenderGraph`.)
2. **The seam is the inter-session API.** The connectome's internal model may churn
   freely as long as it keeps exposing `RenderGraph`. The renderer holds **no**
   knowledge of rooms / trades / sim — only placed drawables + terrain + light.
3. **WGSL-only on WebGPU; Canvas2D is the sole fallback** (brainstorm decision).
   Probe `navigator.gpu`: present → Pixi v8 WebGPU lit scene; absent → existing
   unlit Canvas2D path. No GLSL twin (addable later behind the seam if telemetry
   ever demands).
4. **Instancing is first-class.** One shader, one unit-quad geometry, per-instance
   attributes; instances bucketed by SpritePack (the asset cache key already
   collapses identical kinds). Closes the current per-sprite-Mesh inefficiency.
5. **Determinism & parity.** Same `RenderGraph` → same frame. Each slice keeps a
   golden-frame / parity test; the GPU path and Canvas2D path agree on *placement*
   by construction (they consume the same draw list / graph).
6. **Pixel-art fidelity is non-negotiable.** Pixel-snapped 1:1 iso sprites, banded
   lighting, alpha-cutout (alpha-test + depth, not soft AA). Height + perspective
   must not soften edges.

## Non-goals (this spec)

- The world/settlement connectome itself, or any graph *authoring* (Session A).
- New node *types* / models — trees, props, building interiors (Session B).
- True heightmap mesh terrain with cliffs (R2 uses per-vertex-z iso tiles; a general
  mesh is a later option — see open Qs).
- WebGPU compute shaders (GPU erosion, GPU-driven indirect culling) — brainstorm
  notes these as the WebGPU-era payoff; not built here.
- Removing the Canvas2D path (it stays as the fallback + parity oracle).

---

## The `RenderGraph` contract (R0 — the spine)

A renderer-owned, serialization-free **read view**. The graph/world side supplies
an adapter; the renderer never imports world/sim/catalogue types.

```ts
// src/render/graph/render-graph.ts  (renderer-owned)

export interface RenderGraph {
  readonly bounds: { w: number; h: number };          // tiles
  terrain: TerrainView;
  /** Drawable nodes in the visible region (caller may pre-cull; renderer re-culls). */
  nodes(region: Region): Iterable<RenderNode>;
  /** Linear features (roads/rivers/walls) intersecting the region. */
  edges(region: Region): Iterable<RenderEdge>;
  light: LightView;                                    // time/season → resolved by solar.ts
}

export interface TerrainView {
  /** Elevation in metres at tile (tx,ty). 0 until R1; real field after. */
  heightAt(tx: number, ty: number): number;
  /** Material/biome id for tile shading + (later) ground texture selection. */
  materialAt(tx: number, ty: number): string;
  waterLevelM: number;
}

export interface RenderNode {
  id: string;
  x: number; y: number; z: number;                    // world tile coords + elevation (m)
  footprint: { w: number; h: number };
  kind: string;                                        // entity kind → asset resolution
  assetKey?: string;                                   // resolved SpritePack key (cache hit)
  variantKey?: string;                                 // era/descriptor/lifecycle (asset identity)
  facing?: 0 | 1 | 2 | 3;                              // for future 4-facing art
  category: 'building' | 'vegetation' | 'barrier' | 'npc' | 'prop' | 'decoration';
}

export type RenderEdge =
  | { kind: 'road' | 'river' | 'wall'; polyline: Array<[number, number]>; width: number; material?: string };

export interface LightView {                           // mirrors studio/solar.ts output
  ambient: [number, number, number];
  sunColor: [number, number, number];
  sunDir: [number, number, number];                    // toward the light
  bands: number;
  body: 'sun' | 'moon';
}

export interface Region { x: number; y: number; w: number; h: number } // tile-space AABB
```

**R0 adapter** (`src/render/graph/world-render-graph.ts`): wraps today's
`RenderContext` (`world`, `map`, `lighting`) into a `RenderGraph` — `nodes()` is the
existing `world.query(region)` partitioned by category; `terrain.heightAt` returns 0
(until R1); `light` from `lighting-state`. **No behavior change.**

**R0 acceptance / tests**
- `WorldRenderGraph` `nodes()` yields exactly the entities the current
  `entity-draw-list` emits for a fixed region (set-equality test).
- The iso renderer, refactored to consume `RenderGraph`, produces a **byte-identical
  frame** to pre-refactor on a fixed seed (golden-frame hash test; reuse the
  assetgen-golden harness shape).
- `RenderGraph` types import nothing from `src/world`, `src/sim`, or `src/catalogue`
  (a guard test on imports — keeps the seam clean).
- Draft `RenderGraph` is shared with Session A as the terrain/heightfield + node
  projection they will eventually back natively (doc hand-off, not code).

---

## Slice R1 — elevation data

Worldgen already computes an elevation field (`src/terrain/terrain-generator.ts`)
and flattens it into flat tiles. Resurface it.

- Add a `heightfield: Float32Array` (or quantized `Uint8` + scale) to the terrain
  data the `RenderGraph` reads; `TerrainView.heightAt` returns real metres.
- **Ownership:** terrain heightfield is **world data** (sim may later read it for
  pathfinding cost / placement), renderer consumes read-only. Coordinate the field's
  home with Session A (lean: lives on the map/world, exposed via the graph).
- Canvas2D terrain (`iso-terrain.ts`) shades diamonds by height (cheap directional
  + elevation tint) — visible payoff with zero GPU work yet.
- `worldToScreen(tx,ty,z)` finally receives a real `z`; verify the existing
  pixel-snap still holds (no sub-pixel drift).

**R1 acceptance / tests**
- A fixed seed yields a deterministic heightfield (golden hash).
- `heightAt` matches the generator's pre-flatten field (no information lost).
- Iso placement with non-zero `z` stays pixel-snapped (projection test).
- Sim/save unaffected: heightfield is derived/regenerable or versioned into the save
  deliberately (decide in plan; lean: regenerated from seed, not saved).

---

## Slice R2 — the GPU scene (WebGPU / WGSL)

A third renderer behind `select-renderer.ts` (`?render=gpu`), alongside `iso`
(current) and `topdown` (legacy), so development A/Bs against the live game and never
breaks `main`.

- **Backend:** Pixi v8 with `preference:'webgpu'`. We already depend on Pixi v8
  (entity layer). Probe `navigator.gpu` at init: absent → do **not** let Pixi fall
  back to WebGL2 (our shaders are WGSL-only); instead route to the existing Canvas2D
  executor. Present → build the WebGPU scene.
- **Terrain:** per-vertex-z iso tiles as GPU geometry (start here, not a general
  heightmap mesh — preserves the art language + pixel snap), textured by
  `materialAt`, lit by the same sun/ambient as entities.
- **Entities:** the existing neutral draw list, but executed as **instanced** lit
  quads. One WGSL shader (port `lit-shader.ts`'s banded-PBR math to WGSL: ambient +
  one directional sun, banded diffuse, AO from material.G, alpha-cutout). Per-instance
  attributes: transform (x,y,z,scale), atlas-layer index, tint, foot-lift. Bucket
  instances by SpritePack; pack albedo/normal/material as **texture-array layers**
  (one bind per batch).
- **One scene, one camera:** terrain geometry + instanced entity quads + linear
  ribbons in a single pass; depth buffer + alpha-test replaces strict y-sort within
  a layer (legal because sprites are hard cutouts) — this is what makes instancing
  pay off.
- **Cast shadows:** keep the geometry-baked shadow approach, drawn into the same
  scene (a shadow instance batch), direction from `LightingState.sunDir`.
- Canvas2D path stays the parity fallback **and** the placement oracle.

**R2 acceptance / tests**
- `?render=gpu` on a WebGPU browser renders terrain + buildings + trees + NPCs,
  visually matching the Canvas2D path's *placement* (in-browser eyeball + a
  pixel-diff budget for shape-edge/lighting only, like the PBR Slice 2 parity check).
- A forest scene (≥500 trees of a few species) renders in **≤ N draw calls** (one per
  species bucket + terrain + linear), not one-per-instance (draw-call count assertion
  via a test hook).
- No-WebGPU path: with `navigator.gpu` stubbed absent, the renderer routes to Canvas2D
  and still draws (no throw, no black screen).
- WGSL banded-PBR matches the GLSL reference math within tolerance on a unit fixture
  (shader parity unit test on sampled outputs).
- `no-static-pixi-import` / bundle guards stay green; `pixi.js` stays lazy-chunked.

---

## Slice R3 — dynamic day/night

- Lift `studio/solar.ts` (already pure, Node-safe) into a shared module the live game
  consumes: `state.clock` → `{hour, yearFrac}` → `celestial()` → `LightView`
  (ambient + sunColor + sunDir + body).
- Sun/ambient/cast-shadow direction animate together as time passes; moon at night.
- Expose a dev toggle to scrub time (reuse the studio Sky popover shape) for eyeballing.

**R3 acceptance / tests**
- `solar.ts` stays pure + Node-safe (existing tests move/extend, not duplicate).
- A fixed `(clock, season, lat)` → deterministic `LightView` (golden values — the
  studio already verified dawn/noon/dusk/moon ramps).
- Shadow direction tracks `sunDir` across a simulated day (no desync between sun
  colour and shadow azimuth — the v7 grounded-shadow bug class stays fixed).
- Lighting changes do not re-bake building geometry shadows more than once per
  direction change (cache-invalidation assertion).

---

## File layout (proposed)

```
src/render/graph/
  render-graph.ts          — the RenderGraph read interface (renderer-owned, import-pure)
  world-render-graph.ts    — R0 adapter over today's World/Tile/RenderContext
src/render/gpu/            — R2, the WebGPU scene (lazy, sibling to render/pixi/)
  gpu-renderer.ts          — RenderFn; navigator.gpu probe; Canvas2D route-out
  gpu-scene.ts             — terrain geometry + instanced entity batches + ribbons
  wgsl/lit.wgsl            — banded-PBR (WGSL port of lit-shader.ts)
  instance-batch.ts        — SpritePack-bucketed instanced geometry + texture array
src/render/lighting/
  solar.ts                 — promoted from studio/solar.ts (shared, pure)
src/terrain/               — heightfield surfaced (R1; coordinate home with Session A)
```

`select-renderer.ts` gains a `'gpu'` branch. `iso/` and `topdown/` are untouched
(both keep working through the same `RenderGraph` after R0).

## Open questions (carry into the plan)

- **Heightfield home & persistence** — world data vs graph node; saved vs
  regenerated-from-seed. *Lean: world-owned, regenerated from seed (not in the save).*
  Needs Session A sign-off.
- **`RenderGraph` ownership** — renderer-owned interface + graph adapter (this spec's
  choice) vs graph exposes it natively. *Lean: renderer-owned now; Session A may back
  it natively later without changing the renderer.*
- **Pixi WebGPU vs hand-rolled** — start on Pixi v8 WebGPU (batching/textures/passes
  for free); fall back to hand-rolled WebGPU only if Pixi's instanced-custom-shader
  path is insufficient. *Lean: Pixi first; spike already proved raw WebGPU works if
  needed.*
- **Per-vertex-z iso tiles vs heightmap mesh** — start tiles (art language + snap);
  revisit mesh when cliffs/smooth slopes are needed.
- **Texture-array sizing** — max layers vs SpritePack count; atlas overflow strategy.

## Coordination (three sessions)

- **Hand-off to Session A:** the `RenderGraph` `TerrainView` + `RenderNode`
  projection is the API; share the R0 draft so the connectome can grow into backing
  it (esp. the heightfield + node positions). Until then the R0 adapter bridges
  today's `World`.
- **Session B (modeling):** new node types need *no* renderer change — they resolve
  to a SpritePack and flow through the instanced lit path by `kind`/`variantKey`.
- **My lane:** `src/render/**` + `select-renderer.ts` + promoting `solar.ts`. I do
  not edit `src/catalogue/**`, `src/blueprint/**`, or sim. Worktree
  `feat/unified-renderer`, dev :3002.
