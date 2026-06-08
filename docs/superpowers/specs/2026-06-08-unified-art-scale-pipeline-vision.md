# Unified Art, Scale & Generative Pipeline — Vision

**Status:** Vision (parent). Approved 2026-06-08. First child slice: Buildings (this date).
**Scope:** A parent vision that per-slice specs hang off. Each child slice gets its own spec → plan → implementation and is independently shippable.

## One line

Every visible thing in the world — buildings, vegetation, terrain features, barriers, (eventually) characters — is defined by **parameters**, turned into **reference geometry**, sent with a **prompt** to a **generative model** that returns a **stylized sprite + normals + feature tags**, cached in the asset library, with the **parametric raster as the fallback** when no generated asset exists yet. All of it shares **one world-scale** and **one art-density**, so proportions and fidelity are coherent by construction.

## The problem this solves

The parametric building system is excellent, but the rest of the world wasn't built to the same contract. Measured today (iso renderer):

| Class | Native px | Sized from world units? | Art density |
|---|---|---|---|
| Tile | 128 × 64 (`ISO_TILE_W/H`) | ✅ canonical | n/a |
| Height unit | 64 px / storey (`H_UNIT_PX = ISO_TILE_H`) | ✅ | n/a |
| Building (3×3 cottage) | ~384 w, ~115 px above-ground rise | ✅ `isoNativeSize(footprint, rise)` | high (generated) |
| NPC | 64×64 LPC cell, ~40–48 px visible body | ❌ fixed LPC legacy | low |
| Tree | 64 px src → 1×/2× | ❌ ad-hoc integer scale | low |
| Terrain feature | procedural radius math | ❌ ad-hoc | low |

Two distinct failures:

1. **Proportion drift** — only buildings derive size from world units; everything else is pinned to legacy fixed sizes, so any building-scale tuning desyncs the world.
2. **Fidelity mismatch** — a ~384 px generated building next to a ~40 px LPC villager and a 64 px tree reads as *crisp houses among chunky low-res props*. This is the visible eyesore, and the generative foundation is exactly the tool that removes it.

## Three pillars

### Pillar 1 — Scale contract (proportion by construction)
A single module owns the canonical world metrics and a **reference human height**; every entity class derives its native sprite size from world dimensions through it. Concrete anchors:

- tile = `ISO_TILE_W` × `ISO_TILE_H` = 128 × 64
- height unit = `H_UNIT_PX` = `ISO_TILE_H` = 64 px / storey
- **reference human** ≈ `0.72` height-units ≈ **46 px** tall (consistent with the current LPC visible body)
- **door** ≈ `0.85` height-units ≈ 54 px tall, ≈ `0.4` tile wide (human + headroom)

No code hardcodes a pixel size again — sizes are `f(worldDims, contract)`. Buildings already do this; NPCs / trees / terrain features get pulled under it slice by slice.

### Pillar 2 — Fidelity contract (uniform art density)
One locked **pixels-per-tile detail target**, hit by every class. Buildings already sit near it; the others are below it. The remedy is **regenerate at the contract density through the pipeline — never upscale** (blowing up LPC/64 px art looks soft and blocky). Hold the building density and bring the other classes up to it, unless an in-game eyeball wants a slightly chunkier unified grain — that is one tunable constant, set once.

### Pillar 3 — One pipeline (the unification)
Everything visual flows through the path already built for buildings:

```
params / descriptor
  → manifold reference geometry (src/assetgen/geometry/solids.ts)
  → brief / prompt (description ↔ prompt ↔ image aligned)
  → generative model (OpenRouter / PixelLab)  →  albedo + NORMALS + feature tags
  → AssetLibrary (vendored base + IndexedDB cache)
  → parametric raster = fallback when no asset exists yet
```

`composeStructure` already emits `grey` (reference albedo the model recolors) + `normal` + `anchors` (doors / vents / wall-ends / gates). Normals feed the future **Track-R** lit renderer; generated classes get ground-truth normals for free.

## Generate, don't upscale — and the NPC exception

- **Trees / vegetation / terrain features: regenerate through the pipeline at the contract density.** A tree is trivially parametric (trunk `solidCylinder` + canopy `solidEllipsoid`/`solidCone`, all already in `solids.ts`), so it fixes *size* and *fidelity* at once and drops into the asset→fallback architecture.
- **NPCs are the genuine exception.** Character art is multi-frame, multi-direction animation; upscaling LPC looks bad and full generative characters (animated, 8-direction, normal-mapped) is a large track of its own. So **fix NPC *size* now** (route the billboard through the scale contract), **defer NPC *resolution*** to the Track-R lighting era where the normals payoff justifies the regeneration effort.

## Slice sequencing

1. **Buildings** *(first child — spec `2026-06-08-buildings-parametric-standardization-design.md`)* — establish the scale-contract module; cottage gets a walkable yard (structure ⊂ plot); complete round/stepped in the parametric fallback; collapse the render dispatch to *generated asset → parametric fallback → flat-block*; delete the Canvas2D massing renderer + its guidance-panel consumer; verify building/door proportions against the live NPC billboard.
2. **Vegetation / trees** — parametric trees → generative, on-contract. Biggest visual win.
3. **Terrain features** — rocks / bushes / wells / shrines via the same pipeline.
4. **Barriers** — asset→fallback wiring (linear geometry already exists).
5. **NPC fidelity track** *(later, with Track-R)* — size-matched now; generative/normal-mapped characters deferred.

## Non-goals / out of scope (vision-wide)

- Replacing the topdown debug renderer (`renderer.ts`) — a separate render mode; candidate for a later standalone retirement, not part of any art slice.
- Per-frame facet rasterization or camera rotation — the camera is fixed-angle 2D.
- The Track-R WebGL/PixiJS normal-lit shader layer itself — this vision *feeds* it (every class emits normals) but does not build it.

## Related canon

- `[[project-live-parametric-building-rendering]]`, `[[project-parametric-building-features]]`, `[[project-assetgen-manifold-geometry]]` — the foundation this standardizes on.
- `[[project-prompt-generation-system]]` — the Brief→Compiler generative path.
- `[[project-generated-asset-library]]` — the asset cache the pipeline writes to.
- Track-R (PixiJS normal-lit renderer) — the consumer of the normals this pipeline emits.
