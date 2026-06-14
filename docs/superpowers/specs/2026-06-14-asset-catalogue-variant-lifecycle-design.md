# Asset Catalogue · Variants · Descriptors · Lifecycle — design

> Status: **DESIGN (awaiting review)** · 2026-06-14
> Supersedes/absorbs the queued *period-style-world-recipe* idea. Builds directly
> on the existing layered-patch Blueprint model (`src/blueprint/`), the resolved-
> blueprint art-cache key, and the studio. Connects to
> `2026-06-13-semantic-feature-anchor-tags-design.md` (lifecycle damage needs
> ridge/wall/eave verts to break geometry at).

## 1. Problem

The art pipeline can render one sprite per *preset kind*. The game now wants a far
richer asset space, and — critically — wants **agents** (the Fate DM, the world
authoring panel) to ask for assets by *meaning*, not by hard-coded preset name:

- **Many variants of the same type** — not just "cottage", but a dozen distinct
  cottages.
- **Period versions** — a *classical* temple vs a *medieval* one; the same "house"
  concept across `primordial → ancient → classical → medieval → current`.
- **Rich descriptors** — an agent should say "a **rich, opulent** townhouse" or "a
  **cheap, run-down** hovel" and get matching geometry/materials.
- **Per-instance lifecycle** — every placed tree/building/bridge has its own
  timeline: a tree goes sapling → young → mature → dying → fallen / cut-to-stub; a
  building goes cleared-plot → under-construction (stages) → complete → worn → ruin
  → fire-damaged → burnt-out → old-ruins.
- **A queryable database** — easy search/retrieval over all of the above, for both
  the studio browser (humans) and agents (programmatic).

Today none of this is modelled: presets are a flat map, era is a single optional
field, there are no descriptors, and there is no notion of a lifecycle stage.

## 2. The model: three orthogonal axes + a catalogue

A concrete renderable asset is identified by a **type** plus a position on three
independent axes, all of which feed the existing Blueprint resolve:

```
            ┌─ TYPE ──────────  cottage | tavern | temple | oak | stone_bridge …
            │
asset  ─────┼─ ERA ───────────  primordial | ancient | classical | medieval | current
            │
            ├─ DESCRIPTORS ───  wealth/quality/style/condition axes + free tags
            │
            └─ LIFECYCLE STAGE  (per-instance) plot→…→complete→ruin→burnt | sapling→…→fallen
```

Key architectural insight: **era, descriptors and lifecycle-stage are all just
patch layers** on the base Blueprint. `resolveBlueprint([base, ...patches], seed)`
already composes layers; we add three new well-known layer producers. And because
the **art-cache key is `generatedArtKey(canonicalJson(resolvedBlueprint), model,
footprint)`**, every distinct (type, era, descriptors, stage, seed) combination
gets its own sprite *for free* — no cache-key changes needed. The blueprint IS the
identity.

```
   AssetRequest { type, era?, descriptors?, stage?, seed? }
        │  resolveAsset()
        ▼
   [ base preset ] + [ era patch ] + [ descriptor patch ] + [ stage patch ]  ─seed→  ResolvedBlueprint
        │                                                                              │
        │                                                                    canonicalJson → art key
        ▼                                                                              ▼
   CatalogueEntry (what's available)                                         SpritePack (cached/generated)
```

## 3. Data-model changes (`src/blueprint/types.ts`)

### 3a. Descriptors — structured axes **+** free tags (decision: hybrid)

```ts
// Named axes with closed vocabularies the agent/UI can enumerate & validate…
export interface Descriptors {
  wealth?: 'destitute' | 'poor' | 'modest' | 'comfortable' | 'rich' | 'opulent';
  quality?: 'crude' | 'plain' | 'fine' | 'ornate';   // craftsmanship / ornamentation
  style?: string;                                     // open: 'rustic','civic','fortified',…
  condition?: 'pristine' | 'lived_in' | 'worn' | 'dilapidated';  // condition-when-built
  // …plus an open set for anything the axes don't capture:
  tags?: string[];                                    // ['riverside','guild','painted']
}
```

`Descriptors` is added (optional) to `Blueprint`, `BlueprintPatch`, and
`ResolvedBlueprint`. A preset declares its *defaults*; an `AssetRequest` overrides
any subset.

Descriptors **bias the resolve**, they are not cosmetic metadata:
- `wealth`/`quality` scale ornamentation density, window glazing, material tier
  (wattle→timber→stone), storey count, chimney vs louvre, palette richness.
- These map to **descriptor → BlueprintPatch** functions (e.g. `opulent` ⇒ patch
  materials.walls='stone', add ornament features, glazed windows, bump palette).
- They are also surfaced in the **img2img prompt** (the prompt already derives from
  the brief; we feed it "a rich, ornately-carved …" so the painted art matches).

### 3b. Lifecycle — per-instance stage; procedural transform + preset fallback (decision)

Stage is a property of the **instance over time**, not the type. But each stage is
its own geometry (a ruin ≠ a complete building), so a stage resolves to a
**transformed blueprint**:

```ts
// Per class, an ordered lifecycle. Stage names are class-specific.
export type BuildingStage =
  | 'cleared' | 'foundation' | 'framing' | 'roofed' | 'complete'
  | 'worn' | 'ruined' | 'fire_damaged' | 'burnt' | 'old_ruin';
export type PlantStage =
  | 'sapling' | 'young' | 'mature' | 'dying' | 'fallen' | 'stub';

export interface Lifecycle {
  stage: string;            // current stage (class-appropriate enum value)
  sequence: string[];       // the ordered timeline this asset can walk
}
```

- **Procedural transforms** (the default): a `stagePatch(class, stage, rb)` derives
  geometry from the base — `ruined` drops the roof parts + shortens walls;
  `framing` keeps only the timber skeleton (walls as studs, no infill, no roof);
  `burnt` blackens the palette + removes the roof + leaves charred posts;
  `sapling` scales crown/height down a growth curve; `fallen` rotates the trunk to
  ground. These lean on **semantic feature-anchor tags** (`roof_ridge`, `eave`,
  `wall_top`, `gable_peak`) so a transform can say "break the wall at 60% height"
  without re-deriving verts — that companion design is a prerequisite for the
  heavier building-damage stages.
- **Preset fallback**: where a stage departs too far for a transform to read well
  (e.g. `old_ruin` = a grassed-over footprint with one standing arch), the type may
  register a dedicated stage blueprint that the resolver prefers over the transform.

Instance state lives on the entity: `properties.lifecycle: Lifecycle`. The sim
advances it (trees grow on the existing tick; buildings are driven by construction
/ destruction events — fire, abandonment). Advancing a stage re-resolves the
blueprint and re-keys the sprite (which the art source already lazy-loads/caches).

### 3c. AssetRequest + resolveAsset

```ts
export interface AssetRequest {
  type: string;                 // preset/type key
  era?: Era;                    // default: the preset's era
  descriptors?: Descriptors;    // default: the preset's descriptors
  stage?: string;               // default: the type's "complete"/"mature" stage
  seed?: number;                // default: name+request-derived
}
// Layers: base preset → era patch → descriptor patch → stage patch → resolve(seed)
export function resolveAsset(req: AssetRequest): ResolvedBlueprint;
```

`synthesizeBlueprint(name, patches, seed)` becomes a thin wrapper over
`resolveAsset` for back-compat.

## 4. The catalogue (the "database")

A queryable index over **types** — what exists and what axes each supports — plus a
record of **realized variants** (what's been generated/seeded into the art library).

```ts
export interface CatalogueEntry {
  type: string;
  class: EntityClass;           // building | prop | plant | barrier | terrain_feature
  category: string;             // residential | commercial | religious | farm | civic | flora …
  eras: Era[];                  // eras this type has a recipe for
  descriptorAxes: {             // which axis values are meaningful for this type
    wealth?: string[]; quality?: string[]; style?: string[]; condition?: string[];
  };
  stages: string[];             // lifecycle stages available for this type
  defaults: Descriptors;        // the preset's baseline descriptors
  footprint: { w: number; h: number };
  tags: string[];               // searchable free tags
}

export function assetCatalogue(): CatalogueEntry[];        // derived from presets (+registry)
export function queryCatalogue(f: CatalogueQuery): CatalogueEntry[];

export interface CatalogueQuery {
  text?: string;                // substring over type/category/tags
  class?: EntityClass; category?: string; era?: Era;
  wealth?: string; quality?: string; style?: string;
  tags?: string[];              // all-of
}
```

- **For agents**: `queryCatalogue({ category:'residential', era:'medieval', wealth:'rich' })`
  → candidate types; pick one + build an `AssetRequest`. This is the retrieval API
  the Fate/authoring layers call.
- **For the studio browser**: the same query backs the search box + facet chips.
- **Realized-variant index**: the existing `building-sprites/manifest.json` is
  extended so each row records its `{ type, era, descriptors, stage }` — turning the
  art library into a browsable, de-duplicated variant DB (and letting the seed
  script target "every era×wealth of cottage").

## 5. Art-library / cache implications

- **No cache-key change.** The key already hashes the full resolved blueprint;
  era/descriptor/stage all flow into it. Distinct variants ⇒ distinct keys ⇒
  distinct sprites, automatically.
- **`ART_RECIPE_VERSION` bump** when descriptor/stage patches change geometry
  output (golden tests re-pinned as usual).
- **Manifest enrichment** (additive, back-compat): add `type/era/descriptors/stage`
  to each manifest entry so the library is queryable and the seed script can plan
  "what's missing" across the variant matrix.
- **Combinatorial cost is opt-in.** The full matrix (types × eras × descriptors ×
  stages) is huge; we never seed it all. Worldgen + agents realize variants on
  demand (runtime IDB cache), and we *seed* only a curated core set per release.
  The catalogue tracks availability so missing variants fall back gracefully
  (parametric render) and `--plan` reports the gap.

## 6. Studio integration (the front-end of the DB)

- **Object browser** (left-pane top section): search box + facet chips (class,
  category, era, wealth/quality, tags) over `queryCatalogue`; selecting a type sets
  the subject. Replaces the right-panel dropdown.
- **Variant controls**: era selector + descriptor pickers (wealth/quality/style)
  that rebuild the live blueprint via `resolveAsset` (re-warms geometry, like the
  randomize button does today).
- **Lifecycle scrubber**: a slider over the type's `stages` sequence; scrubbing
  re-resolves to that stage so you can watch plot→…→ruin or sapling→…→fallen.
- **A/B + stage zoom**: already built this iteration; the A/B panel moves into the
  left-pane accordion (task #16).

## 7. Worldgen / sim integration

- **Placement** (`building-placer`, settlement growth): picks types via
  `queryCatalogue` filtered by the settlement's era + a wealth gradient
  (centre/market = richer, rim = poorer) instead of hard-coded preset names. New
  buildings start at `complete` (or `under-construction` if we want visible growth).
- **Lifecycle advance**: trees grow on the existing nature tick; buildings react to
  events (abandonment → `worn`→`ruined`; fire → `fire_damaged`→`burnt`). The
  abandonment system already exists; this gives it visible geometry.
- Everything stays deterministic/seeded (sim `Math.random`-free).

## 8. Slice plan (proposed sequencing)

- **Slice A — Studio shell** *(independent, build now)*: collapsible/resizable
  left-pane accordion (#15), move A/B into it (#16), object browser against the
  *current* facets (class/category/era) (#17 v1). No data-model change yet.
- **Slice B — Descriptors + catalogue**: `Descriptors` type, descriptor→patch
  functions, `assetCatalogue`/`queryCatalogue`, agent query API, prompt wiring;
  browser gains wealth/quality/style facets + descriptor pickers. Manifest
  enrichment.
- **Slice C — Period/era variants**: era→patch functions for the core types across
  the 5 eras, browser era switcher, curated seed set per era.
- **Slice D — Lifecycle (plants first)**: `Lifecycle` type, plant stage transforms
  (growth curve), per-instance state + nature-tick advance, studio scrubber. Plants
  first because growth is a clean scalar transform.
- **Slice E — Lifecycle (buildings)**: building stage transforms (needs semantic
  feature-anchor tags for damage), construction/ruin/fire stages, event-driven
  advance, preset fallback for `old_ruin`. Depends on the anchor-tags design.
- **Slice F — Seeding + persistence**: seed-script variant-matrix planning,
  manifest as the variant DB, retrieval wired into Fate/authoring.

## 8b. Ground — apron (building param) vs terrain (map)

A building can be placed on different terrains, so we must separate two things the
current single `materials.ground` field conflates:

- **Natural terrain** (grass / dirt / sand / snow / rock) — owned by the **map**,
  varies per placement. It must **never be baked into the building sprite**, or a
  desert cottage drags a patch of grass onto the dunes.
- **Worked apron / plot surface** (packed dirt, cobbles, flagstone, gravel, boards)
  — the ground the building's occupants *create*. This **is** intrinsic to the
  building and stays a blueprint parameter (`materials.ground`), now with clear
  meaning + two upgrades:
  1. **Descriptor-linked**: the apron is a strong wealth/quality signal —
     `opulent`⇒flagstone, `modest`⇒packed dirt, `farm`⇒mud/straw. The descriptor
     patches set it.
  2. **Separable decal, not baked**: the apron renders as its **own ground-plane
     part/sprite** (a flat 2:1 decal under the billboard), composited over whatever
     terrain — like the settlement wear-mask ground already does. So the building
     billboard carries *no* ground; the apron is a sibling draw item. This also lets
     lifecycle reach it (a `ruined` apron is cracked/overgrown; a `cleared` plot is
     bare apron only).

Placement affinity stays separate too: the catalogue exposes `placeableOn:
TerrainKind[]` (dock⇒water-edge, most⇒land) — extending the existing `SITE_RULES`
seam — so agents/worldgen query "what can go on sand here".

`materials.ground` therefore **remains a building parameter** (the apron), terrain
does not — and the apron becomes a first-class, descriptor-driven, separable layer.

## 9. Non-goals / open questions

- Not seeding the full combinatorial matrix (cost) — curated core only; rest on
  demand.
- Animation between lifecycle stages is out of scope (discrete swaps; the
  multi-view/animatable-parts design is separate).
- **Q:** Should `style` be a closed enum per class or fully open? (Leaning open +
  per-class suggested values in the catalogue.)
- **Q:** Building construction sub-stages — how many read at 32px/m? Likely 3
  (foundation, framing, roofed) before `complete`.
- **Q:** Do bridges/walls (barriers, `terrain_feature`) get the same lifecycle, or
  a reduced one (intact → damaged → collapsed)? Leaning reduced.
```
