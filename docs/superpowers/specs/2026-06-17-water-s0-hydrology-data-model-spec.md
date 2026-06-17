# Water S0 — hydrology data model (spec)

**Date:** 2026-06-17 · **Status:** 📋 DRAFT → implementing ·
**Parent:** [Water: hydrology, aquatic biomes & lean rendering](2026-06-17-water-hydrology-biome-rendering-design.md)
· **Successors:** S1 carve+fill geometry · S2 water pass+shader · S4 biome layer

## Goal

Produce the **derived water data model** that every later slice consumes:
a unified **water mask + type**, a **water-surface height field**, a **flow
vector field**, and **Strahler order/width** — all deterministic, all from the
terrain heightfield. No rendering, no geometry; this slice ships *data + tests*.

## The key insight — it (mostly) already exists

`src/terrain/hydrology.ts::generateHydrology` already runs a Barnes-2014
priority-flood and **internally computes but then discards** exactly what we
need:

| Internal value | What it actually is | Today |
|----------------|--------------------|-------|
| `W` (filled water table) | **lake-surface height** where `W > elevation` (a filled basin = standing water at its outlet height) | discarded |
| `drainTo[i]` | the D8 **downstream neighbour** = flow **direction** | discarded |
| `flowField[i]` | upstream flow **accumulation** (∝ discharge) | exported (magnitude only) |
| `riverMask[i]` | accumulation ≥ threshold | exported |

So S0 is **"stop throwing `W` and `drainTo` away, and derive the render-facing
fields from them."** The hard parts (pit-fill, D8 directions, accumulation) are
done and already deterministic (stable heap tie-break, stable sort).

## Resolved open questions (from brainstorm §9)

1. **Flotsam/fauna determinism** → cosmetic-only, out of snapshot (an S6 concern; noted, no S0 impact).
2. **Carve-vs-ribbon split** → by **Strahler order**: order ≥ 2 (≈ width ≥ 1 cell) → S1 carve+fill; order-1 headwaters → ribbon. S0 exposes `strahler` + `width` so S1 can split; the threshold is an S1 constant.
3. **Sea level** → **single global `seaLevel`** for ocean (already `config.seaLevel = 0.35`). Inland lakes need no per-region level — `W` already fills each basin to *its own* outlet height. Multi-level inland water falls out for free.
4. **Caustics** → procedural in-shader, no art asset (an S5 concern; noted, no S0 impact).

## What S0 adds (additive to `HydrologyResult`)

`src/core/types.ts` — extend the interface (existing fields unchanged, so the one
consumer `map-generator.ts` keeps working):

```ts
export interface HydrologyResult {
  riverMask: Uint8Array;    // [N] 0/1 — unchanged (accumulation ≥ threshold)
  flowField: Float32Array;  // [N] ≥0  — unchanged (accumulation)
  // ── S0 additions ──
  drainTo: Int32Array;      // [N] downstream neighbour index, −1 at outlets/ocean
  surfaceW: Float32Array;   // [N] water-surface height (normalized elev units): max(seaLevel, filled-W where standing) else NaN/sentinel on dry land
  waterMask: Uint8Array;    // [N] 0=dry 1=wet — unified river ∪ lake ∪ ocean
  waterType: Uint8Array;    // [N] enum: 0 dry, 1 ocean, 2 lake, 3 river  (stream = river ∧ strahler 1)
  flowDirX: Float32Array;   // [N] unit flow vector x (0 in still water)
  flowDirY: Float32Array;   // [N] unit flow vector y
  strahler: Uint8Array;     // [N] Strahler order along the drainage tree (0 off-channel)
  width: Float32Array;      // [N] channel width in cells, derived from strahler/accumulation (0 off-channel)
}
```

### Derivations

- **`waterType` / `waterMask`** — `ocean` where `elevation < seaLevel` *and* connected to the map border (border-seeded flood, to keep enclosed below-sea basins as lakes); `lake` where `W > elevation + ε` (standing fill) and not ocean; `river` where `riverMask`; else dry. Precedence ocean > lake > river. This becomes the **canonical** "where is water" — §Integration reconciles it with the existing tile/biome path.
- **`surfaceW`** — `ocean` → `seaLevel`; `lake` → `W[i]`; `river` → `elevation[i]` (thin sheet over the bed; S1's carve deepens the channel, this is the fill level); dry → sentinel (`-1`).
- **`flowDirX/Y`** — at channel cells, unit vector toward `drainTo[i]` (one of 4 axis dirs from D8); still water (ocean/lake) → `(0,0)` (S2 adds wind/tide ripple as pure render noise). Magnitude is *not* baked into the vector — speed comes from `width`/`flowField` in-shader, so the vector stays unit.
- **`strahler`** — second pass over the drainage forest defined by `drainTo` (each land cell → exactly one parent; roots = outlets). Standard rule: a cell with no upstream donors = order 1; merging two order-`k` = order `k+1`, else `max`. Compute by processing land cells in **W-ascending order** (headwaters→outlet) accumulating child orders. Deterministic (same stable order as accumulation, reversed).
- **`width`** — `f(strahler)` (e.g. `0.5 · strahler` cells, clamped) — a simple monotone map; S1 may refine with `flowField`. Lets S1 split carve+fill (≥1 cell) from ribbon (<1 cell).

## Determinism

Whole pass stays `Math.random`-free and order-stable (it's under the `src/terrain`
boundary, consumed by worldgen which is seed-deterministic). Strahler uses the
same stable W-ordering as accumulation. Guard: identical seed ⇒ byte-identical
arrays (a determinism test re-runs the pass twice and compares).

## Tests (`tests/unit/hydrology-water-model.test.ts`)

1. **Backward-compat:** `riverMask`/`flowField` byte-identical to pre-S0 on a fixed field.
2. **Lake fill:** a hand-built bowl below its rim but above seaLevel ⇒ `waterType==lake`, `surfaceW==rim height`, `flowDir==(0,0)`.
3. **Ocean connectivity:** below-seaLevel cells touching the border ⇒ ocean; an enclosed below-sea pit ⇒ lake (not ocean).
4. **Flow direction points downhill:** on a tilted plane, `flowDir` is the descent direction and the `drainTo` chain reaches an outlet.
5. **Strahler monotonic:** order never decreases downstream; a confluence of two equal-order channels increments.
6. **Width/strahler split:** at least one order-1 (stream→ribbon) and one order-≥2 (river→carve) cell on the standard map.
7. **Determinism:** two runs ⇒ identical arrays.

## Integration / single source of truth

- **`map-generator.ts`** already calls `generateHydrology` and stamps `river` tiles from `riverMask` (lines ~146–160). After S0 it can additionally reconcile lake/ocean tiles from `waterType` — but that tile-stamping change is **deferred to S1** (S0 only *produces* the model; it must not change current tile output, so the backward-compat test holds).
- The unified `waterMask` is the mask the sim (placement/dock rule in `building-placer.ts` / `settlement-plan.ts`, pathfinding in `road-walker.ts`) and the render epic will *both* read — reconciling these to the single mask is tracked into S1, not forced here.
- `surfaceW`/`flowDir`/`width` are exactly the S2 shader uniforms and the S1 carve inputs (river incision is a `carve` `Deformation` keyed on channel cells, depth ∝ `width`).

## Non-goals (later slices)

- Any geometry, deformation, or rendering (S1/S2).
- Changing tile/biome output or the sim water mask wiring (S1).
- Aquatic biome packs, banks, caustics, flotsam, fauna (S4–S6).
