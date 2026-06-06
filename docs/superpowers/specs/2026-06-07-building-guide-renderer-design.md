# Building Guide-Image Renderer (headless three.js) — Design

**Date:** 2026-06-07
**Status:** Spec — approved forks, pending final user review.

## Goal

Replace the flat Canvas2D massing guide with a real **3D render** of each
building, produced **offline**, fed to PixelLab as the `init_image`, and baked
into the vendored asset library. Same run also produces a depth pass (future
ControlNet provider) and renders a fuller, height-correct roof vocabulary plus
smoke-vent attachment points.

## Why

The current guide is a flat Canvas2D massing image (`src/assetgen/massing-guidance.ts`):
no real occlusion (z-order faked), no lighting consistent with our sun, and a
**width-blind roof height** (`ROOF_RISE` is a fixed scalar per type, so a gable
on a 1-wide cottage rises the same absolute height as on a 5-wide hall). A real
3D render from the existing `BuildingDescriptor` fixes all three and gives a
depth pass nearly for free.

## Decisions (locked via brainstorming)

| Fork | Decision |
|------|----------|
| Engine | **Lightweight 3D via three.js** (not a CAD kernel; replicad/OpenCascade reserved for future boolean openings) |
| Runtime | **Offline gen script (Node, headless)** — no three.js in the shipped game bundle |
| Passes | **Color massing PNG + grayscale depth PNG** |
| Angle | **Single iso** (buildings are static, non-directional) |
| Roof height | **Hybrid: pitch-derived for pitched roofs, target-height for domes/spires** |
| Roof set | **Full vocabulary** (16 types) |
| Vents | **Smoke-vent attachment points** on the descriptor (chimney/smokehole/pipe), drawn in the render + reserved as future particle emitters |
| Ground | **Faint w×h tile-diamond ground plane in the 3D scene** (embeds tile scale/alignment) |
| Headless GL | **headless-gl (`gl`) first**, Playwright headless-browser fallback; de-risked by a Task-1 spike |

## Architecture

```
BuildingDescriptor  ──►  buildingMassing()  ──►  massing-scene.ts  ──►  headless-massing-renderer.ts
(existing,             (extended:               (descriptor →           (two passes → PNGs)
 +roof, +vents)        RoofProfile, vents)      three.js scene)               │
                                                                              ▼
                                                          scripts/gen-buildings.ts → PixelLab init_image
                                                                              │
                                                                              ▼
                                                          baked into public/asset-library/ (sprite + guide PNG)
```

### Files

- **Modify** `src/world/building-descriptor.ts`
  - Extend `Roof` union to the full 16-type vocabulary.
  - Add `Vent` interface + optional `vents?: Vent[]` on `BuildingDescriptor`.
  - Mirror `vents` into `buildingEntity().properties` (rides snapshot/save, no version bump — same pattern as `door`/`footprint`).
- **Modify** `src/world/building-presets.ts`
  - Seed sensible `vents` on presets that have them (see Vents below).
- **Modify** `src/render/building-massing-model.ts`
  - Replace the scalar `ROOF_RISE` table with a `ROOF_PROFILES` registry + `roofRise(profile, footprint)` height function (hybrid pitch/target).
  - Carry `vents` and per-vent mouth height onto `Massing`.
- **Create** `src/assetgen/headless/massing-scene.ts`
  - Pure: `BuildingDescriptor → THREE.Scene` (geometry per plan + per roof kind, materials from palette, door marker, vent chimneys, tile-diamond ground plane, iso camera, upper-left directional light). No rendering — returns scene + camera. Unit-testable headlessly (asserts mesh counts / bounding boxes, no GL).
- **Create** `src/assetgen/headless/massing-renderer.ts`
  - Takes a scene+camera, renders **color** and **depth** passes to PNG buffers at sizes from `view-registry.isoNativeSize`. Owns the GL context (headless-gl).
- **Modify** `scripts/gen-buildings.ts`
  - Use the renderer to produce the guide PNG (→ PixelLab `init_image`, strength ~400–500) + depth PNG; bake guide PNG alongside the sprite in the library.
- **Add** `three` as a **devDependency** (offline-only).
- **Create** guard test: app entry (`src/main.ts` import graph) never imports `three` or `src/assetgen/headless/*`.

The in-game Canvas2D massing placeholder (`iso-building.ts`) and `massing-guidance.ts` stay as-is — this renderer is purely author-time guide generation. The baked guide PNG ships into `public/asset-library/` next to each sprite so the building panel's **"Sent ⇄ Received"** toggle shows the *actual* guide that produced the sprite (no in-browser re-render needed).

## Roof vocabulary (full — 16 types)

Existing: `flat · gable · hip · conical · domed · stepped · lean_to`
Added: `gambrel · mansard · pyramidal · saltbox · onion · spire · tented · jerkinhead · cross_gable`

```ts
export type Roof =
  | 'flat' | 'gable' | 'hip' | 'conical' | 'domed' | 'stepped' | 'lean_to'
  | 'gambrel' | 'mansard' | 'pyramidal' | 'saltbox' | 'onion' | 'spire'
  | 'tented' | 'jerkinhead' | 'cross_gable';
```

### three.js geometry per roof

| Roof | Geometry |
|------|----------|
| flat | thin slab / low parapet |
| gable | triangular prism along the long-axis ridge |
| hip | 4-slope hip (rectangular pyramid / frustum) |
| pyramidal | square pyramid to a single apex |
| jerkinhead | gable with clipped (half-hipped) ridge ends |
| saltbox | asymmetric gable (ridge offset toward one wall) |
| gambrel | two-pitch prism (barn: steep lower, shallow upper) |
| mansard | steep lower hip + shallow upper cap (frustum + low pyramid) |
| cross_gable | two intersecting gable prisms |
| lean_to | single-slope wedge |
| conical | `ConeGeometry` over a round plan |
| domed | hemisphere |
| onion | lathe of a bulbous profile (Byzantine/eastern temple) |
| spire | tall thin cone/pyramid (steeple/tower) |
| tented | steep square pyramid (tower roof) |
| stepped | flat cap; the *body* steps via `levelInset` (keep/ziggurat) |

## Roof height model (hybrid, "correct height format")

All rises in **tile-height units** so they compose with `bodyHeight = levels × heightPerLevel`.

```ts
type RoofMode = 'pitch' | 'target';
interface RoofProfile {
  mode: RoofMode;
  pitch?: number;        // rise per unit run, for 'pitch'
  fullSpan?: boolean;    // run = full short span (single-slope, e.g. lean_to) vs half-span (ridged)
  targetAspect?: number; // rise = targetAspect × plan diameter, for 'target'
  minRise?: number; maxRise?: number; // clamp
}
function roofRise(p: RoofProfile, footprint: {w:number;h:number}): number {
  const shortSpan = Math.min(footprint.w, footprint.h);
  if (p.mode === 'pitch') {
    const run = p.fullSpan ? shortSpan : shortSpan / 2; // lean_to uses fullSpan: true
    return clamp(p.pitch! * run, p.minRise ?? 0.1, p.maxRise ?? 2.5);
  }
  const diameter = Math.max(footprint.w, footprint.h);
  return clamp(p.targetAspect! * diameter, p.minRise ?? 0.3, p.maxRise ?? 4);
}
```

**Pitched (rise scales with building width):** gable, hip, pyramidal, jerkinhead,
saltbox, gambrel, mansard, cross_gable, lean_to (lean_to uses full span, not half).
**Target-height (intrinsic, width-independent):** conical, domed, onion, spire, tented.
**Special:** flat → low parapet (~0.12); stepped → cap (~0.2), height comes from body insets.

Concrete starting values (rise/run for pitch; aspect for target), tunable:

| Roof | mode | pitch / targetAspect |
|------|------|------|
| gable | pitch | 0.55 |
| hip | pitch | 0.5 |
| pyramidal | pitch | 0.7 |
| jerkinhead | pitch | 0.5 |
| saltbox | pitch | 0.6 |
| gambrel | pitch | 0.75 |
| mansard | pitch | 0.8 |
| cross_gable | pitch | 0.6 |
| lean_to | pitch | 0.4 |
| conical | target | 0.55 |
| domed | target | 0.5 |
| onion | target | 0.7 |
| spire | target | 1.4 |
| tented | target | 1.0 |
| flat | — | parapet 0.12 |
| stepped | — | cap 0.2 |

## Smoke vents (pipe locations)

Attachment points like `door`, reserved as future particle emitters; drawn in the render so the generated sprite has a chimney where smoke will rise.

```ts
export interface Vent {
  x: number; y: number;            // tile-relative to footprint top-left (like door)
  height: number;                  // mouth/emitter height in tile-height units above roof base
  kind: 'chimney' | 'smokehole' | 'pipe';
  emit?: 'smoke' | 'steam';        // default 'smoke' — hint for the future particle system
}
// on BuildingDescriptor:  vents?: Vent[];
```

The renderer draws a small box (chimney/pipe) or roof aperture (smokehole) at each
`(x,y)` rising to `height`; the same world-space point becomes the smoke emitter when
particle smoke ships (out of scope here — we only place anchors + draw the stack).

**Seeded vents** (sensible defaults; presets without are fine):

| Preset | Vent |
|--------|------|
| cottage | chimney at a roof corner |
| tavern | chimney (kitchen), `emit: smoke` |
| longhouse | central smokehole, `emit: smoke` |
| yurt | smokehole at dome apex |
| farm_barn | (none) |
| shrine / temple_small | optional incense smokehole, `emit: smoke` (low rate) |

## Render passes & output

- **Color pass** — flat/Lambert materials in palette colors, one `DirectionalLight`
  from the canonical upper-left (`SUN_DIRECTION`, `src/render/lighting.ts`) + soft
  ambient. Door marker quad on the door face. Faint tile-diamond ground plane for
  scale. → PixelLab `init_image`.
- **Depth pass** — `MeshDepthMaterial`, grayscale. Stored alongside; **unused by
  PixelLab today**, documented as ControlNet-provider future-proofing.
- **Sizing** — both via the existing aspect-preserving `view-registry.isoNativeSize`
  (≤128² ceiling — the transparency fix). Transparent background (color pass).

### Camera & projection

`OrthographicCamera` posed to the game's **2:1 dimetric iso** (ISO_TILE_W 128 :
ISO_TILE_H 64), so the rendered sprite drops back into the world pre-aligned. The
tile-diamond ground plane is rendered at the same projection to lock scale.

## Headless runtime & risk

three.js needs a GL context in Node. **Plan: headless-gl (`gl`).** Main risk:
native build on Darwin 21.6.

- **Task 1 is a spike**: render one lit triangle to a PNG via headless-gl, confirm
  the context builds and `readPixels` works on this machine, *before* building the
  renderer.
- **Fallback** if headless-gl won't build: render via a Playwright headless
  Chromium page (real WebGL), screenshot the canvas. Heavier dependency but robust.

## Testing

- `massing-scene.test.ts` — every preset + every roof kind builds a scene without
  throwing; correct mesh count for plan; roof apex Y matches `roofRise` within
  tolerance; wider footprint ⇒ taller pitched roof (height-correctness guard);
  vent meshes placed at seeded positions.
- `roof-rise.test.ts` — `roofRise` is monotonic in span for pitch roofs and
  width-independent for target roofs; clamps hold.
- `massing-renderer.test.ts` (spike-gated) — renders a preset to a non-empty PNG of
  the expected dimensions; depth pass is grayscale.
- Guard test — app bundle entry never imports `three` / `headless/*`.

## Non-goals (leads logged, not in scope)

- **Shape-grammar footprints** (L-shapes, setbacks, towers) — the
  `FloorShape → FloorShapeRule → stacked extrude` pattern from the Aljullu thesis
  repo is the right model for the deferred [building-variety] work; this renderer
  will consume whatever geometry it emits. Not built now.
- **In-app Generate button** — the renderer module is structured to also run in the
  browser later, but only the offline path ships now.
- **Particle smoke** — we place vent anchors + draw stacks; the particle system is
  separate future work.
- **Boolean window/door openings** — reserved for a future replicad/OpenCascade
  upgrade if cut openings/cutaways become the bottleneck.
- **Depth-conditioned generation** — depth PNG is produced but no current provider
  consumes it; wiring a ControlNet provider is separate.

## Open questions for review

1. Vent seeding above — keep this default set, or adjust which presets get stacks?
2. headless-gl-first vs going straight to Playwright — preference?
3. Roof pitch/aspect starting values — fine to tune during implementation, or any
   you want pinned now?
