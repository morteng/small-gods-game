# Opening Feature Model — Extensible Wall Apertures — Design

**Status:** Design. Approved (direction) 2026-06-08.
**Parent:** [`2026-06-08-blueprint-parameter-model-design.md`](2026-06-08-blueprint-parameter-model-design.md). This extends the Blueprint feature registry; it does not replace it.
**Supersedes (for doors):** the bespoke proud-box door (`doorSolid` in `src/assetgen/geometry/solids.ts`) and the one-shape `door` feature.

## One line

A single **`Opening`** feature family — a registered *kind* (`door`, `window`, … later `gate`/`portcullis`/`sliding_door`/`portal`) that describes a hole on a wall face plus a kind-specific filler — built on a **carved-aperture** geometry substrate (subtract the hole, drop in the filler) that works on rect, round, and stepped walls. The **semantic model is rich from day one** (kind, face, position, size, sill, hinge, swing, locked/open-state, open-ended hardware), the **rendered geometry is deliberately thin** (aperture + leaf/glass), and everything else (hardware geometry, swing animation, see-through portals, new kinds) is one registration or a deferred renderer away.

## Why

Three problems, one root cause — doors are modelled as a single bespoke shape, not as a member of an open family:

1. **Doors protrude.** `doorSolid` builds the door as an *additive box standing proud of the wall by `depth:0.14`* ("no booleans"), so it visibly sticks out. A door is a hole in a wall, not a slab glued to the outside.
2. **Round and stepped buildings have no doors.** `body.toPrims` emits round bodies as `cylinder`+`cap` and stepped as stacked `box` prims — these bypass `buildingFacets`/`resolveFeatures` entirely, so their door solids are never generated (yurt, castle_keep). The door exists *structurally* (collision cell + anchor) but has no geometry.
3. **No room to grow.** Fate will want gates, portcullises, sliding doors, portals, windows — each with attributes (hinge side, swing direction, locks, handles, doorbells). The current shape can't express any of it.

The fix is to make an opening a **registered feature kind with geometry hooks**, carved into whatever wall the body produced. The Blueprint registry already gives the extensibility (per-kind `paramSchema` is the agent capability catalogue); this slice adds the *geometry* half (carve + filler) and the missing kinds.

## Decisions (locked during brainstorming)

1. **One `Opening` feature family**, not per-shape code. `door`/`window`/`gate`/`portcullis`/`sliding_door`/`portal` are registered kinds sharing one structural contract; they differ in filler geometry and passability. New kind = one registration, no pipeline change.
2. **Carved-aperture substrate.** Every opening subtracts an aperture (a box) from the host wall solid, then the kind adds a filler. This is the general primitive: door→leaf, window→recessed glass+sill, portal→nothing (a real see-through hole, which also serves future camera rotation). The building geometry already uses manifold booleans for wing/roof unions, so this is consistent, just one subtract per opening. Generalises to round (subtract from the cylinder) and stepped (subtract from the ground box) — fixing problems #2 and #1 at once.
3. **Semantic data rich, rendered geometry thin.** A human is ~46 px (`scale-contract`), so a doorknob is ~1 px and a doorbell is sub-pixel — rendering hardware now is wasted. So: *model* kind/face/position/size/sill/hinge/swing/locked + open-ended hardware as data (cheap, drives Fate narration + sim + interaction); *render* only the aperture + leaf/glass; *defer* hardware geometry, swing animation, and see-through portals behind a clean seam that reads the same data later.

## Vocabulary

| Concept | Name | Meaning |
|---|---|---|
| The feature on a wall | **Opening** | a registered kind (`door`/`window`/…) placed on a part's face |
| The carved hole | **Aperture** | the box subtracted from the wall solid |
| The fitting in the hole | **Filler** (leaf / glass / bars / none) | kind-specific geometry the opening adds back |
| Does it pass movement? | **threshold** | a per-kind flag; a passable opening contributes a walkable cell |

## The model

Openings live where door features already live — in a part's `features` map — but opening *kinds* register richer metadata: structural + behavioural params, plus geometry hooks. To avoid a third registry, opening kinds are `FeatureType`s that additionally implement the optional **opening hooks**; the geometry compiler treats any feature whose kind declares `aperture` as an opening. (`vent` stays a plain feature — it's a roof addition, not a wall aperture, and keeps its current path.)

```ts
// Extends the existing FeatureType (src/blueprint/registry.ts) with optional opening hooks.
interface OpeningHooks {
  /** True if a passable threshold (door/gate) → contributes a walkable cell; window=false. */
  threshold: boolean;
  /** The hole to subtract from the host wall, in wall-local units (face + span + height + sill). */
  aperture(f: ResolvedFeature, host: ResolvedPart, ctx: CompileCtx): ApertureSpec;
  /** Kind-specific fitting added back (leaf / glass+sill / bars / [] for portal). */
  filler(f: ResolvedFeature, host: ResolvedPart, ctx: CompileCtx): Prim[];
}

interface ApertureSpec {
  face: WallFace;
  /** centre position along the wall run (0..1) and sill height (height-units). */
  t: number; sill: number;
  /** opening size: half-width along the wall (tiles) and height (height-units). */
  halfW: number; height: number;
  /** how deep to cut (≥ wall thickness so it punches through). */
  depth: number;
}
```

**MVP kind schemas** (the `paramSchema` is the agent catalogue — these are the day-one params, sizing defaults from `scale-contract`):

- `door`: `face`, `t` (position, default centred), `width`/`height` (default from `DOOR_WIDTH_TILES`/`DOOR_HEIGHT_UNITS`), `main` (wider/taller, ≤1.4× human), `hinge: left|right`, `swing: in|out|slide`, `locked: bool`, `open: 0..1` (state). Hardware as open-ended data: `handle?`, `lock?`, `bell?`, `knocker?` (modelled, not yet rendered). `threshold = true`.
- `window`: `face`, `t`, `width`/`height` (smaller default), `sill` (raised, default ~0.4 units), `style: plain|shuttered|arched`, `glazed: bool`. `threshold = false`.

## Geometry: carve + filler, uniform across body types

The single new idea: **after a part builds its wall solid, subtract that part's openings' apertures, then add the fillers** — applied the same way to every body kind.

- **Building-prim path (rect/L/cross):** `buildingFacets` currently unions per-storey wall boxes per wing, then adds additive door/vent solids. Change: build `wallSolid = union(wingBoxes)`, compute each opening's aperture box (positioned on its face from `ApertureSpec`), `wallSolid = wallSolid.subtract(union(apertures))`, *then* facet it; add `filler()` solids (own material). The additive `doorSolid` is deleted; `resolveFeatures`' door-defaulting moves to the Blueprint layer (openings are already resolved there).
- **Round path:** the body's `cylinder` wall gets the same treatment — subtract an aperture box oriented to the door's face/angle, add the leaf as a slightly-curved-or-flat panel inset into the cut. Yurt gets a real door.
- **Stepped path:** subtract the aperture from the ground-level box; add the leaf. Castle_keep gets a real door/gate.

To keep this DRY, the Blueprint geometry compiler (`toGeometry`) resolves each part's openings into `{ aperture, filler }` pairs and hands them to the assetgen layer alongside the wall geometry; a shared `carveOpenings(wallSolid, apertures)` + `fillerFacets(fillers)` helper is used by all three paths. The exact prim/seam (e.g. a richer building prim that carries apertures, or a post-compose carve step) is a plan-level decision; the contract is: *every wall solid is carved by its openings before faceting, and fillers are added with their own material.*

## Structural integration (mostly already done)

- **Collision:** `toCollision` already emits a passable "door cell" per door on any face. Generalise: emit a threshold cell only for openings whose kind has `threshold = true` (doors/gates), never for windows. Lawn/blocked logic unchanged.
- **Anchors:** `toAnchors` already emits a `door` anchor per door on any face with outward facing. Generalise the kind label so a `gate` anchor reads as such (kind from the opening). Pathing/road-wiring keep working; multi-opening per building is already supported (features keyed by id).
- **Brief:** each opening contributes a phrase via `toBrief` (e.g. "arched window", "iron portcullis") so the generative prompt matches the modelled openings.

These three are face-agnostic and multi-instance today, which is exactly the "model all sides including hidden, for future camera rotation, structurally correct for paths/roads" requirement — the structural data is already complete; this slice makes the *geometry* honour it.

## MVP scope (YAGNI)

**Build now:**
- The `Opening` feature contract (opening hooks on `FeatureType`: `threshold`, `aperture`, `filler`) + kind registry entries.
- Carve-aperture substrate: a shared carve+filler applied across rect/round/stepped wall solids; the additive `doorSolid` retired.
- Kinds `door` and `window`, with the rich semantic `paramSchema` above (kind/face/position/size/sill/hinge/swing/locked/open + hardware-as-data). Sizing from `scale-contract`.
- `toCollision`/`toAnchors`/`toBrief` generalised from "door" to "opening" (threshold flag drives passability).
- Protrusion fixed by construction; yurt + castle_keep get visible doors.
- Migrate the existing `door`/`window` feature kinds and the 12 presets to the opening family (mechanical — presets already declare a `door` feature).

**Design-for, do NOT build (each has its seam):**
- Kinds `gate`, `portcullis`, `sliding_door`, `portal` — registrations only; not authored into presets yet.
- Hardware geometry (handles, locks, bells, knockers) — modelled as data now; rendered when zoom/camera/scale justifies.
- Swing animation / open-state geometry — `open: 0..1` is modelled; the renderer that rotates the leaf is later.
- See-through portals / interior reveal on camera rotation — the carved hole already exists; the camera/renderer work is its own track.

## Migration

- The just-shipped `door`/`window` `FeatureType`s gain opening hooks (they become opening kinds). `vent` is untouched.
- Presets keep their `door` feature declarations; they resolve through the opening path. No preset rewrite beyond optionally enriching params later.
- `doorSolid` (additive proud box) deleted; `resolveFeatures`' implicit door-defaulting in assetgen is removed (openings resolve in the Blueprint layer). The golden regression updates to assert carved apertures + fillers instead of proud boxes.
- Clean cut, consistent with the Blueprint slice: saved worlds regenerate via "New World"; no compat shim.

## Testing

TDD throughout:
- **Opening registry:** a kind's `paramSchema` validates + defaults (door size from `scale-contract`); `threshold` correct per kind (door true, window false).
- **Aperture geometry:** an opening on each face produces an aperture box on the correct wall at the right span/height/sill; carving reduces the wall solid (a ray through the doorway no longer hits wall); filler present with its own material. Repeat for round (cylinder) and stepped (box) walls — proving yurt/keep doors render.
- **No protrusion:** the door no longer extends beyond the wall's exterior plane (assert the door geometry's outward extent ≤ wall face, vs the old proud box).
- **Structural carry-over:** `toCollision` emits a threshold cell for a door but not a window; multi-opening building emits multiple anchors; the existing pathfinding-lawn test stays green.
- **Golden regression:** cottage/yurt/castle_keep compile to carved-door geometry; door height tracks `scale-contract`.
- **Guard:** no file references the deleted `doorSolid`/proud-box path.

## Non-goals

- Rendering hardware (handles/locks/bells) or animating swing — modelled only.
- The camera-rotation / multi-view renderer itself (this *prepares* its data).
- Authoring gates/portcullises/portals into presets (kinds registered, not used yet).
- Windows/doors as interior-partitioning (this is exterior-wall apertures).

## Future expansion explicitly planned for

1. **New opening kinds** — register `gate`/`portcullis`/`sliding_door`/`portal` with their `filler`/`threshold`; agents discover them from the registry.
2. **Hardware sub-features** — handle/lock/bell as data now; a later renderer reads them; or they graduate to tiny composable sub-parts on the opening.
3. **Open-state + swing** — `open: 0..1` + `hinge`/`swing` drive a future animated/rotated leaf and "is the door open?" sim/AI queries.
4. **Camera rotation / see-through** — carved holes are real geometry, so rotating the camera reveals openings on previously-hidden faces with no model change.
5. **Other geometry features beyond openings** — the same "register a kind with geometry hooks" pattern applies to future wall/roof details (the user's "other geometry things too").

## Related canon

- `[[project-blueprint-parameter-model]]` — the parameter model + registry this extends.
- `[[project-door-sizing-followup]]` — the door-size fix this builds on (sizing stays from `scale-contract`).
- `[[project-unified-art-scale-pipeline]]` — the scale contract that makes "hardware is sub-pixel, defer it" a principled cut.
- `[[project-fate-brain]]` — the agent layer that authors openings/attributes from the registry schema.
