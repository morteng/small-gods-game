# Semantic Feature-Anchor Tags — design note

Status: **brainstorm / forward seam** (not yet built). Captured 2026-06-13 at user
request ("tag all things in asset for use later — gables, tops of roofs, windows…
bird landing spots … planning for it now is smart").

## Goal

Every generated asset should carry a set of **named, located anchor points** — not
just the door/vent anchors we already extract, but the gameplay-relevant landmarks:
roof ridge ends, gable peaks, chimney tops, eaves, window sills, sign brackets,
lantern hooks. Later systems query them by **role**:

- birds/cats **perch** on ridges, chimney tops, gable peaks, fence posts;
- smoke/heat **emit** from chimney tops; light **emits** from windows/lanterns;
- decorations/NPCs **attach** to door thresholds, sign brackets, market awnings;
- divine FX **target** roof apex / door.

The point: the geometry already *knows* where these are at compose time. Capture them
once, persist with the sprite, and the cost at runtime is a lookup.

## What already exists (the seam we extend)

`composeStructure` (`src/assetgen/compose.ts`) already returns `StructureAnchors`:

```ts
interface StructureAnchors { doors: DoorAnchorN[]; vents: NormAnchor[]; wallEnds?: …; gates?: … }
```

These are **normalised (0..1) against the opaque sprite bbox**, computed by projecting
world-space points (`BuildingAnchors`, `LinearWorldAnchors`) through the *same* fit
used for the render, so they survive the img2img repaint + crop. That projection +
normalisation step is exactly the machinery anchor tags need — we are generalising
`doors`/`vents` from two hard-coded lists into one tagged list.

## Proposed shape

```ts
type AnchorRole =
  | 'door' | 'window' | 'chimney_top' | 'roof_ridge' | 'roof_apex'
  | 'gable_peak' | 'eave' | 'sign_bracket' | 'lantern_hook' | 'fence_post';

interface FeatureAnchor {
  role: AnchorRole;
  /** sprite-space, normalised to the opaque bbox (like today's NormAnchor) */
  x: number; y: number;
  /** optional: world-space metric position (for 3D-correct attach / height) */
  world?: Vec3;
  face?: WallFace;           // wall features only
  /** stable id so saves/regen can re-bind (e.g. "vent#0") */
  id?: string;
}
```

`StructureAnchors` keeps `doors`/`vents` for back-compat but gains
`tags: FeatureAnchor[]`. The SpritePack/meta persists `tags`; `registerAlbedo`
already preserves bbox-relative coords across the negotiation band, so tags ride
along untouched.

## Where each anchor comes from (compute, don't author)

| Role | Source at compose time |
|------|------------------------|
| door / window | existing opening features (face + `t` → wall cell → world point) |
| chimney_top | vent feature top: chimney base + height along ridge |
| roof_ridge / roof_apex | the roof prism ridge line ends + midpoint (already built in `buildingFacets`) |
| gable_peak | gable-end wall top centre = ridge end projected to the verge |
| eave | wing wall-top corners (the eave line endpoints) |
| sign_bracket / lantern_hook | future authored features (Blueprint `Feature`s) |
| fence_post | `linear` run post spacing (already enumerated in `linearFacets`) |

Most are a few lines each because the facet builder already has the ridge/eave
vertices in hand — we just tee them off as labelled points before they are flattened.

## Build order (when we get to it)

1. Add `FeatureAnchor`/`AnchorRole` types + `tags: FeatureAnchor[]` on
   `StructureAnchors` (additive, no behaviour change).
2. Emit `door`/`window`/`chimney_top` tags from the opening + vent features (reuses
   the existing `norm()` projection) — verify in the Render Studio (the node tree +
   an overlay that dots each tag).
3. Emit roof tags (`roof_ridge`, `gable_peak`, `eave`) from `buildingFacets` — this
   lands naturally alongside the **roof-slab remodel** (task: thick individual roof
   slabs), since that work already re-derives ridge/verge vertices.
4. Persist `tags` in the SpritePack cache + autosave; add a `world.queryAnchors(entity,
   role)` helper for gameplay (perch/emit/attach).

## Dependencies / sequencing

- Pairs with the **roof-slab remodel** — do roof tags in that pass (shared vertices).
- The Render Studio is the verification surface: render a tag overlay (coloured dots
  per role) so we can eyeball correctness before persisting.
- No `ART_RECIPE_VERSION` bump needed for tags alone (they don't change pixels); the
  roof remodel that bumps it is the natural moment to also ship roof tags.
