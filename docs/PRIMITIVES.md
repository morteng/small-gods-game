# Small Gods — Authoring PRIMITIVES (LLM authoring reference)

> This file is **generated**: the preamble below is hand-authored; everything after the
> "Capability catalogue" header is derived live from the blueprint registry by
> `scripts/generate-primitives-doc.ts` and pinned in-sync by
> `tests/unit/primitives-doc.test.ts`. An agent given ONLY this file should be able to
> author a spec that passes the preview gate.

## How to author — the one-line rule

**Write a Blueprint (or name a preset + optional patches/descriptors). Never hand-write the
compose-level `Part[]` list.** The registry turns your Blueprint into an `AuthorInput`,
which `authorBlueprint()` resolves → validates → lints, and which `scripts/author-preview.ts`
then composes to a real sprite + diagnostics. The `Part[]` solids (box/cylinder/arch/…)
are the **compile target** that `to-geometry.ts` produces; authoring them directly bypasses
the gate and is out of scope. See the primer below for the blueprint vocabulary.

## Units contract

- **1 tile = 2 metres** (the metric scale contract; `mToTiles` in `render/scale-contract.ts`).
- Feetprints (`footprint.w/h`, part `size.w/h`) are in **tiles**.
- Vertical `z` is in **cube-units** (= metres here), so a wall storey is `levels × storeyM`.
- Part `at`/features `face` are in the **structure-local** tile frame; the composer
  projects them through the terrain iso fit — your job is the local shape, not screen space.
- Themes are deterministic: same spec ⇒ byte-identical sprite and audit.

## Layering: what vocab do I have?

A Blueprint is: `class` + `footprint` + ordered `parts` (each a registry part type with
`at/size/params/features`), a `materials` map, optional `palette`, `descriptors`,
`stage`, `category`, `notes`. Every part/feature `type` and its `params` are enumerated
in the generated catalogue below — that is your legal knob set.

- **Descriptors** (qualitative direction, folded in by `descriptors.ts`):
  - `wealth`: destitute → poor → modest → comfortable → rich → opulent (shifts materials + glazing).
  - `quality`: crude → plain → fine → ornate.
  - `condition`: pristine → lived_in → worn → dilapidated.
  - `style`: era/programme flavour when the preset knows one.
- **Materials** by role — walls: `mud wattle timber log brick stone marble hide`;
  roof: `thatch wood tile slate hide none`; ground: `flagstone dirt packed_dirt wood tile gravel`.
- **Masonry `work`** (on `body`/walls): `coursed_rubble`, `ashlar`, `dry_stone`, `running`
  brick, plaster finish — picked automatically from material, thickness and crenellation.
- **Defensive / masonry construction is FIRST-CLASS and already authorable** — the
  `barrier` part emits the same `linear` prim the world's walls use: `kind:'wall'`
  (crenellated town wall / curtain), `rampart`, `palisade`, `fence`, `barricade`,
  `hedge`, with `lengthM/heightM/thicknessTiles/material`, `crenellated` (merlon/crenel
  parapet on the field edges), `posts` and an optional `gateWidthM` opening. `body.parapet`
  puts a crenellated parapet on a building's flat roof. See
  `docs/primitives-examples/crenellated-wall.json`. This vocabulary existed before the
  LLM-modeling epic — no geometry was added for it.
- **Lifecycle `stage`**: buildings run `complete → fire_damaged → ruin → burnt → old_ruin`;
  `stage` rides the resolve identity (its painter/validity check) — geometry compose still
  reflects the base massing. **Descriptors `condition`/a lowered `quality` are what believably
  "ruined-read" a build through this deterministic pipeline.**

## Worked examples

Every file under `docs/primitives-examples/` is a real `AuthorInput` that passes the gate AND
composes non-empty geometry — pinned by the sync test. Point a preview at any of them:

```
npx tsx scripts/author-preview.ts docs/primitives-examples/cottage.json
npx tsx scripts/author-preview.ts docs/primitives-examples/crenellated-wall.json
npx tsx scripts/author-preview.ts docs/primitives-examples/townhouse.json --json
```

## Capability catalogue

```
PART TYPES
=========
  body
    plan: enum {rect|round|L|cross|stepped} = "rect"  — footprint shape: rect box, round (cylinder+cap, e.g. yurt), L/cross multi-wing, or stepped ziggurat tiers
    levels: number [1..8] = 1  — number of storeys (wall height = levels × storey)
    levelInset: number [0..3] = 0  — stepped plan only: tiles each tier insets from the one below
    storeyM: number [0.5..12] = -1  — metres per storey; -1 = the standard 2.7 m storey
    jetty: number [0..0.3] = 0  — tiles each upper storey oversails toward the street (+x/+y) — the jettied townhouse cue; 0.12 ≈ 24 cm/storey
    roofPitch: number [0..3] = -1  — gable pitch (ridge rise = pitch × half-span); -1 = the standard steep 1.5. Lower = shallower/less-tall roof (≈1.0 is a 45° roof)
    baseCourse: number [0..2] = 0  — height (tiles) of a stone base course at the wall foot (burgage undercroft under timber, or a shallow plinth); 0 = none
    frame: bool {true|false} = false  — exposed timber frame (half-timbering): render posts/rails/studs as raised timber over plaster infill panels (rect plan). The infill wall switches to plaster.
    cutaway: bool {true|false} = false  — render roof-off + floor exposed (the interior-reveal geometry); false = closed building
    interior: any  — connectome-derived InteriorPlan {partitions, floorDrop} drawn only in a cutaway; set by cutawayOf
    buttress: bool {true|false} = false  — stepped buttresses between windows + at corners (rect plan) — the masonry-span cue for churches/tithe barns
    parapet: bool {true|false} = false  — crenellated parapet around a FLAT roof (keeps/watch towers)
    roof: enum {flat|gable|hip|half_hip|conical|domed|stepped|lean_to|shed|mono_pitch|penthouse|gambrel|mansard|pyramidal|saltbox|onion|spire|tented|jerkinhead|cross_gable} = "gable"  — roof silhouette; a dormer/gabled-dormer feature needs a pitched roof (not flat)
  wing
    levels: number [1..8] = 1  — storeys for this additive wing
    roof: enum {flat|gable|hip|pyramidal|lean_to|shed|mono_pitch|conical|domed} = "gable"  — roof silhouette for this wing
  tower
    levels: number [1..12] = 3  — storeys — tower height
    shape: enum {square|round} = "square"  — tower footprint: square or round
    roof: enum {flat|pyramidal|conical|domed} = "pyramidal"  — tower cap: flat, pyramidal, conical, or domed
    spire: number [0.5..8] = 1.2  — spire/cap height as a multiple of the tower radius. 1.2 = the squat watchtower cap; ~4 = a tall broach spire
    parapet: bool {true|false} = false  — crenellated battlement around a FLAT top (corbel band + merlons) — ignored under a spire/cone cap
  porch
    depth: number [1..3] = 1  — overhang depth of the covered porch (metres)
  chimney
    height: number [0.2..3] = 1  — chimney rise above the standard storey (metres)
  waterwheel
    face: enum {south|north|east|west} = "south"  — wall face the wheel hangs against (the stream side)
    radius: number [0.8..4] = 1.3  — wheel radius (metres)
    spokes: number [4..16] = 8  — number of radial spokes
    paddles: number [6..24] = 12  — number of paddles around the rim
    submerge: number [0..1.5] = 0.1  — tiles the wheel bottom sinks below the ground/waterline (dips into the millrace)
  furnace
    kind: enum {forge|oven|kiln} = "forge"  — hearth type: forge = smithy hearth under a broad brick flue; oven = domed masonry bread oven + flue stack; kiln = brewhouse oast (a drum under a conical cap with a timber cowl)
    mouth: enum {north|south|east|west} = "east"  — forge only: which way the open hearth mouth faces (the back wall sits opposite, against the body) — face it away from the body it abuts
  prim
    prim: any  — raw assetgen Part object (passed through)
  well
  graveyard
    stones: number [0..24] = 5  — number of weathered headstones to place (2×2 footprint)
  stall
    counter: bool {true|false} = true  — add the front sales counter (waist-high) along the street side
    postHeightM: number [1.4..3.5] = 1.9  — corner-post height (metres)
    canopyRiseM: number [0.3..3.5] = 2.6  — peak of the cloth awning above the posts (metres)
  tent
    heightM: number [1.2..6] = 2.6  — tent rise (metres): a squat bell vs a tall teepee
    pole: bool {true|false} = true  — centre pole through the apex (visible above the cone)
  branch_plant
    generator: enum {lsystem|proctree|spacecol} = "proctree"  — branch-generation algorithm (shape the tree is grown with)
    recipe: enum {oak|pine|willow|shrub|fern|flower|grass} = "oak"  — species recipe — trunk/branch habit + bark/leaf dress (oak, birch, fir, …)
    crownShape: enum {rounded|spreading|conical|columnar|weeping|irregular|tufted|none} = "rounded"  — crown silhouette: rounded, columnar, conical, umbrella, …
    heightM: number [0.2..40] = 10  — overall tree height (metres)
    trunkR: number [0.02..0.5] = 0.16  — trunk radius at the base (metres)
    petalTint: number [0..16777215] = 0  — flower-head tint packed 0xRRGGBB; 0 = none (recolours the leaf whorl)
    bare: number [0..1] = 0  — 1 = bare crown (alpine/winter): leaves dropped, twig tips extended; selected by the render snow-mask
    seed: number [-∞..∞] = 0  — deterministic shape seed (0 = default form)
  rock
    sizeM: number [0.2..8] = 1.5  — boulder size (metres)
    jitter: number [0..0.7] = 0.35  — how irregular the silhouette is (0 = smooth, 0.7 = craggy)
    aspect: number [0.4..4] = 1  — height/width ratio (1 = round; <1 = squat; >1 = tall pillar)
    cluster: number [1..6] = 1  — number of boulders in the cluster
    cuts: number [0..12] = 6  — plane-cut facets — large knapped faces instead of a noise lump (0 = no faceting)
    shelves: number [1..6] = 1  — >1 = a craggy OUTcrop: stacked shrinking cut-slabs + foot stones, not a pile
    seed: number [-∞..∞] = 0  — deterministic shape seed (0 = default form)
  stair_flight
    riseM: number [0.3..40] = 1.8  — total vertical rise in metres (drives tread count unless `treads` is set)
    treads: number [1..200] = -1  — explicit tread count; -1 = derive from rise
    widthM: number [0.6..12] = 2  — running width in metres
    construction: number [0..1] = 0.5  — 0 = rough scramble (tall steep steps) → 1 = dressed accessible (low, deep steps)
    dir: enum {north|south|east|west} = "south"  — climb direction in structure-local space (which way the flight ascends)
    railing: enum {none|one|both} = "none"  — balustrade on none / one / both sides
  landing
    widthM: number [0.6..20] = 2  — platform width in metres
    depthM: number [0.6..20] = 2  — platform depth in metres
    elevM: number [0..40] = 0  — top-surface height above ground (the level the flight below ends at), in metres
    thicknessM: number [0.1..4] = 0.4  — platform slab thickness in metres
  deck
    lengthM: number [0.5..60] = 4  — span length along the road (metres)
    widthM: number [0.5..20] = 3  — deck width across the road (metres)
    thicknessM: number [0.1..3] = 0.6  — structural slab thickness (metres)
    baseZM: any  — deck-underside height above the part z datum (m); overrides nothing when unset
    camberM: any  — hump-back crown rise at mid-span (m); 0/unset ⇒ flat deck
    dir: enum {ns|ew} = "ns"  — span bearing: ns = along +y, ew = along +x (overridden by yawDeg)
    yawDeg: any  — true bank→bank bearing °, CCW from +x; overrides dir
    parapet: enum {none|both|rails} = "none"  — side edges: none, solid masonry parapet walls, or open post-and-rail (timber bridges)
    roadway: any  — running surface carried across: dirt|gravel|cobble|paved; unset ⇒ bare structural deck
  pier
    heightM: number [0.3..40] = 3  — pier height, riverbed → deck underside (metres)
    widthM: number [0.3..8] = 1  — pier shaft width (metres)
    batter: number [0..0.6] = 0  — top-vs-base taper: 0 = straight, 0.5 = top is half the base width
    headM: any  — square pile-head cap height (m), ~1.4× the shaft width; unset ⇒ bare column
  arch_span
    spanM: number [0.5..40] = 4  — clear opening width of the arch (metres)
    riseM: number [0.3..20] = 2  — crown height above the springing (metres)
    thicknessM: number [0.2..6] = 1  — arch/wall thickness along the span (metres)
    dir: enum {ns|ew} = "ew"  — arch opening faces this bearing: ew = along +x, ns = along +y (overridden by yawDeg)
    yawDeg: any  — true bank→bank bearing °, CCW from +x; overrides dir
    style: enum {round|segmental|pointed|horseshoe|flat} = "round"  — arch head profile: round (curved ring), segmental, pointed, horseshoe, or flat post-and-lintel
    ringDepthM: any  — masonry ring depth above the intrados crown (m); unset ⇒ arch default 0.7 m
    openRib: any  — true ⇒ open curved rib instead of a filled spandrel wall
  abutment
    heightM: number [0.3..20] = 3  — bed → deck underside (metres)
    widthM: number [0.5..20] = 3  — across the road (deck width), metres
    depthM: number [0.3..8] = 1.5  — along the span, into the bank (metres)
    batter: number [0..0.6] = 0.15  — foot flare: 0 = straight, 0.3 = foot 30% wider than the top
    baseZM: any  — base height above the part datum (m); unset ⇒ 0
    dir: enum {ns|ew} = "ew"  — bearing: ew = along +x, ns = along +y (overridden by yawDeg)
    yawDeg: any  — true bank→bank bearing °, CCW from +x; overrides dir
  log
    lengthM: number [0.1..40] = 6  — log length along its bearing (metres)
    radiusM: number [0.02..0.8] = 0.3  — butt-end radius (metres) — a generous trunk, not a pole
    tipRadiusM: any  — tip-end radius (m), < radiusM = natural taper; unset ⇒ no taper
    baseZM: number [-10..40] = 0.5  — axis-centre height above the part z datum (metres) — the log rests with its underside at baseZM − radiusM, so seat it via baseZM = seatTop + radiusM
    dir: enum {ns|ew} = "ew"  — bearing: ew = along +x, ns = along +y (overridden by yawDeg)
    yawDeg: any  — true bearing °, CCW from +x; overrides dir
    pitchDeg: any  — incline °, + lifts the tip end; ±90 ⇒ a vertical post
    flatDepthM: any  — hewn-flat top: chord depth (m) cut from the crown; unset ⇒ fully round
  column
    heightM: number [0.3..20] = 3  — total height (base + shaft + capital) in metres
    radiusM: number [0.05..3] = 0.3  — shaft half-width (round ⇒ radius) at the foot, in metres
    shape: enum {round|square|polygon} = "round"  — cross-section: a round drum, a square pier, or a regular polygon
    sides: number [3..12] = 8  — sides for a polygon shaft (ignored otherwise)
    taper: number [0..0.6] = 0  — diminution/batter: top half-width = (1 − taper) × base. 0 = parallel-sided column
    base: bool {true|false} = false  — add a plinth at the foot
    capital: bool {true|false} = false  — add a capital/abacus at the head
  railing
    style: enum {parapet|balustrade|picket|coping|crenellated} = "balustrade"  — top treatment: solid parapet, open balustrade, picket fence, low coping cap, or crenellated teeth
    lengthM: number [0.3..60] = 4  — run length (metres; 1 tile = 2 m) — the rail is laid along this
    axis: enum {x|y} = "x"  — which axis the run is laid out along (rotates the rail)
    heightM: number [0.2..4] = 0.95  — height of the rail/coping (metres)
    thicknessM: number [0.05..1.5] = 0.22  — thickness of the rail/coping band (metres)
  channel
    lengthM: number [0.5..60] = 4  — channel run length (metres)
    axis: enum {x|y} = "x"  — axis the channel runs along (x or y)
    innerWidthM: number [0.2..8] = 1  — clear inner width of the waterway (metres)
    wallM: number [0.1..2] = 0.3  — side-wall thickness (metres)
    depthM: number [0.2..4] = 0.6  — channel depth below the surrounding surface (metres)
    floorM: number [0.1..2] = 0.3  — floor slab thickness (metres)
    covered: bool {true|false} = false  — covered/capped (a culvert) vs an open channel
  barrier
    kind: enum {wall|rampart|palisade|fence|barricade|hedge} = "wall"  — defensive-structure family: wall (masonry curtain), rampart (earthen bank), palisade (staked), fence, barricade, or living hedge — each picks its own default cross-section + construction
    lengthM: number [2..48] = 12  — run length (metres; 1 tile = 2 m) — the wall/palisade is extruded along this line
    heightM: number [0..12] = 0  — height (metres); 0 = the kind default (a tall town wall vs a low hedge)
    thicknessTiles: number [0..4] = 0  — wall thickness in tiles; 0 = the kind default (thick masonry vs a thin paling)
    crenellated: bool {true|false} = false  — merlon/crenel teeth along the top (masonry wall)
    posts: bool {true|false} = false  — render the palisade stakes / fence posts (palisade & fence families)
    gateWidthM: number [0..8] = 0  — gate opening cut through the run (metres); 0 = solid, no gate
    material: enum {|stone|brick|timber|earth|hedge} = ""  — construction material; '' = the kind default (stone wall, timber palisade, hedge)
  sea_arch
    spanM: number [4..24] = 13  — clear opening width under the arch (metres)
    riseM: number [2..16] = 8  — crown height above the springing (metres)
    depthM: number [2..14] = 6  — headland thickness (metres) — a solid mass, not a gate
    seed: number [-∞..∞] = 0  — deterministic shape seed (0 = default form)
  cliff_face
    widthM: number [4..24] = 11  — width along the shore (metres)
    heightM: number [4..26] = 14  — total cliff height (metres)
    overhangM: number [0..12] = 6  — how far the brow juts past the base (metres)
    seed: number [-∞..∞] = 0  — deterministic shape seed (0 = default form)
  cave_mouth
    widthM: number [6..26] = 13  — mouth width (metres)
    depthM: number [5..20] = 10  — cave depth into the rock (metres)
    heightM: number [4..18] = 9  — mouth height (metres)
    seed: number [-∞..∞] = 0  — deterministic shape seed (0 = default form)
  hoodoo
    heightM: number [4..18] = 11  — pinnacle height (metres)
    capM: number [2..10] = 5  — cap diameter (metres) — the overhang
    seed: number [-∞..∞] = 0  — deterministic shape seed (0 = default form)

FEATURE TYPES
=============
  door (opening, passable)
    main: bool {true|false} = false  — the primary entrance (drives the main pathing anchor)
    arched: bool {true|false} = false  — round-headed doorway
    width: number [-1..2] = -1  — half-width along the wall (tiles); -1 = scale default
    height: number [-1..4] = -1  — door height (tiles); -1 = scale default
    t: number [0..1] = 0.5  — centre along the wall run (0..1)
    hinge: enum {left|right} = "left"  — hinge side
    swing: enum {in|out|slide} = "in"  — how the leaf opens
    locked: bool {true|false} = false  — starts locked (state)
    open: number [0..1] = 0  — 0 shut … 1 wide open (state)
    handle: bool {true|false} = true  — has a handle (hardware, shown at close zoom)
    lock: bool {true|false} = false  — has a visible lock
    bell: bool {true|false} = false  — has a bell
    knocker: bool {true|false} = false  — has a knocker
  vent
    kind: enum {chimney|smokehole|pipe|spire} = "chimney"  — stack type: brick chimney, low capped smokehole, thin metal pipe, or a stone steeple (spire)
    placement: enum {ridge|wall} = "ridge"  — ride the roof ridge (interior stack) or climb an exterior wall (fireplace stack)
    side: enum {front|back} = "front"  — for placement:'ridge' — which slope the stack pierces (front = camera-facing, back = far slope)
    t: number [0..1] = 0.5  — fraction along the ridge/wall (0..1) where the stack sits
    width: number [-1..1] = -1  — stack width (tiles); -1 = the per-kind default
    height: number [-1..2] = -1  — height above the ridge/eave (tiles); -1 = the per-kind default
    material: enum {default|stone|brick} = "default"  — override the stack material; 'default' = the per-kind default (brick chimney, timber smokehole)
  window (opening)
    style: enum {plain|shuttered|arched|lancet} = "plain"  — opening shape: square, shuttered, round-arched, or tall narrow lancet
    glazed: bool {true|false} = true  — glazed (wealthier) vs open/shuttered (crude)
    t: number [0..1] = 0.5  — centre along the wall run (0..1)
    width: number [-1..2] = -1  — half-width along the wall (tiles); -1 = default
    height: number [-1..4] = -1  — opening height (tiles); -1 = default. Clamped under the eave — an over-tall value fires an eave-breach lint
    sill: number [0..3] = 0.4  — height of the sill above the floor (tiles)
    lightsWide: number [1..6] = 2  — panes across (glazing-bar count = lightsWide−1). 1 = a single undivided light; more, smaller lights read as leaded/wealthier
    lightsHigh: number [1..6] = 2  — panes tall (transom count = lightsHigh−1)
    perStorey: bool {true|false} = false  — repeat this window at every upper storey sill (adding a floor adds its windows); false = author each level
  dormer
    t: number [0..1] = 0.5  — fraction along the ridge (0..1) where the dormer sits
    width: number [0.3..1.2] = 0.5  — dormer width in tiles
```
