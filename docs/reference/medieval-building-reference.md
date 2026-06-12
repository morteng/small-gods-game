# Medieval Building Reference for Procedural Generation

*(c. 900–1500 European vernacular + minor fortification; values are defensible
typicals, tuned for a 32 px/m isometric pixel-art generator. Researched 2026-06-12
for the building-geometry v6 detail pass.)*

Game units: 1 tile = 2 m, 1 cube-unit = 1 tile, 32 px/m on screen.

## 1. Roof eaves & overhangs

| Roof covering | Side eave overhang | Gable/verge (rake) overhang | Notes |
|---|---|---|---|
| **Thatch** (straw/reed) | **40–60 cm** typical, up to **90 cm** over wattle-and-daub | **15–30 cm** — verges much tighter than eaves | Eave edge is thick (thatch is 30–40 cm deep) and soft, no fascia. |
| **Wood shingle / shake** | **20–40 cm** | **10–25 cm** | Crisper edge; towers, churches, Central/Eastern Europe. |
| **Slate / stone slate / clay tile** | **10–25 cm** | **5–15 cm**, often near-flush | Stone gables often have raised coping with **zero** verge overhang. |
| **Alpine/Germanic timber** | **50–100 cm+** | **30–80 cm** | The exception: huge overhangs all round. "Mountain" style only. |

Rules:
- Verge overhang ≈ **0.3–0.5×** the eave overhang, except Alpine.
- Masonry-gable buildings (keep, church, crow-step): verge = 0; eaves 10–20 cm.
- Jettied townhouses: eave measured from the *top* (jettied) wall plane, 20–40 cm.
- Pitch by material: thatch **45–55°**, shingle **40–50°**, plain tile **45–50°**,
  slate/stone-slate **30–40°**, pantile ~35°.

## 2. Chimneys vs smoke louvres

Timeline:
- **Before ~1200:** essentially **no chimneys** outside stone castles/manors. Open
  central hearth; smoke exits a **gable smoke-hole / ridge louvre**.
- **1150–1300:** wall fireplaces + masonry flues in stone keeps/manors.
- **1300–1450:** chimneys spread to urban houses and inns; rural commoners still open-hearth.
- **1450–1550+:** chimneys reach better cottages/farmhouses.

**Smoke louvre (period-correct default for commoners):** small gablet, raised
ridge-box, or slatted turret **at the ridge, centred or ⅓ from one gable**,
~**0.5–1 m square**, rising **0.5–1 m** above the ridge.

**Chimney stack:** masonry **0.6–1.0 m square** in plan (kitchen/inn stacks up to
1.5–2 m at base); rises **0.8–1.5 m above the ridge**. Placement: **gable-end**
(external on stone houses, very readable) or **axial on the ridge**. Never mid-slope.

**Counts:** barn/granary/stall = **0**; cottage/longhouse = **0 (louvre)** early,
**1 gable stack** late; townhouse = **1**; tavern/inn = **1–2**; manor = **2–3**;
keep = **1–2** (flues in wall thickness, small caps at parapet); church = **0**;
smithy = **1 squat wide forge stack**; yurt = central **smoke ring (toono)** only.

## 3. Roof forms & furniture

- **Gable is the overwhelming default** (≥80%).
- **Hip / half-hip (gablet, *Krüppelwalm*, jerkinhead):** half-hip is very
  characteristic of thatched longhouses; the gablet doubles as the smoke vent.
  Good variety at ~15–25% on rural thatch.
- **Crow-stepped gables:** stone/brick urban, 14th c.+, northern-town style only.
- **Dormers:** rare before ~1400; later-medieval townhouses/manors/inns. 0 on
  commoner buildings; 1–2 small gabled dormers on late manor/inn fronts.
- **Catslide:** rear slope extended low over an outshot (cottages/farmhouses).
- **Bargeboards:** plain on commoners; carved only on rich 14th–15th c. fronts.
  At sprite scale: a 1–2 px contrasting rake line (albedo).
- **Thatch ridge:** flush ridge with a 20–30 cm ridge roll; decorative scalloped
  block-ridge is post-medieval — skip.
- **Jetty (townhouses):** **45–60 cm per storey** on the street face; the single
  most readable "medieval town" cue.

## 4. Per-building-type table

Commoner windows are **unglazed, shuttered**, ~**0.4–0.6 m wide × 0.5–0.8 m tall**;
high-status/traceried up to 0.8 × 1.5 m; arrow slits 0.1–0.15 m wide.
"Windows/face" = long face / gable face.

| Type | Footprint (m), W:D | Storeys | Windows (long face / gable) | Chimney or louvre | Roof | Distinctive |
|---|---|---|---|---|---|---|
| **Peasant cottage** | 5–6 × 8–12, 1:1.5–1:2 | 1 | 1–2 small / 0–1; door + 1 window on entry face is the classic read | Louvre (early) or 1 gable stack (late) | Steep gable thatch, optional half-hip | Door off-centre, low eaves (~2 m wall), catslide outshot |
| **Longhouse** | 4.5–6 × 14–25, 1:3–1:4.5 | 1 | 2–3 small on the humans' end / 0–1; byre end 0 windows | Louvre over hearth bay; 0 stacks | Gable or half-hip thatch, one ridge | Cross-passage **opposed doors** at ⅓ length; byre end |
| **Townhouse (jettied)** | 4.5–7 × 9–15, gable to street | 2–3 | Street: 0–1 ground (shopfront), 2–3 per upper storey; sides near-blind | 1 rear/party-wall stack | Steep gable facing street, tile | **Jetty 0.5 m/storey**, shopfront |
| **Tavern / inn** | 7–9 × 12–18 | 2 | 2–3 ground / 3–4 upper per long face; 1–2 per gable | **1–2 stacks** (cooking building) | Gable, tile/thatch; late get 1–2 dormers | Wide yard door, sign bracket, bigger windows than a house |
| **Church / temple** | Nave 6–9 × 15–30 + square W tower | 1 tall | 2–4 tall arched per nave side; tower slits + belfry pairs | **0** | Steep gable nave, lower chancel | Tower, buttresses, arched windows |
| **Smithy** | 5–7 × 7–10 | 1 | 0–1; one wall largely open (work front) | 1 squat wide forge stack | Gable, shingle/tile (not thatch — sparks) | Open work bay, lean-to fuel store |
| **Granary / barn** | Barn 6–9 × 15–25; granary 4–6 × 5–8 | 1 tall | **0** windows; 3–5 thin slit vents high | **0** | Gable or half-hip; one huge roof | Barn: full-height double doors mid-long-face; granary on staddle posts |
| **Watchtower** | 3–5 m square | 3–4 | Slits below; 1 small window/face top storey | 0–1 small flue | Pyramidal cap or flat + crenellated | First-floor entry, batter at base |
| **Small keep** | 10–15 m square, walls 1.5–3 m | 3–4 | Ground 0–1 slits/face; windows **grow with height** | 1–2 wall-flues, caps at parapet | Flat-behind-parapet + crenellations | First-floor entrance + forestair, turrets |
| **Manor house** | Hall 7–9 × 12–18 + cross-wings (L/T/H) | hall 1 tall + 2-storey wings | Hall 1–2 tall (1.5 m) incl. oriel; wings 2/storey/face | 2–3 stacks (or louvre over open hall, 13th c.) | Gabled hall + gabled cross-wings (multiple ridges) | Porch, hall window taller than everything |
| **Yurt (ger)** | circular Ø 4–6 m | 1; wall 1.2–1.5 m | **0** | Central smoke ring Ø 1–1.5 m at apex | Shallow felt dome; rise ≈ 0.25–0.3× radius | Low S-facing door, lattice band |
| **Market stall** | 2–3 × 2–4 | 1 open | n/a — open front, counter | 0 | Single-pitch/gable canvas ~30° | 4 posts + canopy + counter |

Cross-type window rules:
- Ground floor ≤ upper floors in count and size; on towers strictly increasing with height.
- Windows avoid the hearth/chimney wall and the byre/store end.
- Commoners: windows on **1–2 faces only**, never all four.
- Visible glazing only on church/manor/keep/rich townhouse; everyone else dark openings + shutters.

## 5. What reads at 100–250 px / 32 px-per-metre

**Model in 3D geometry (≥8–10 px, sells the silhouette):** eave overhang (thatch
40–60 cm = 13–19 px), jetty steps (16 px/storey), chimney stacks, smoke
louvre/gablet, yurt smoke-ring, dormers, half-hip/gablet, crow-steps,
cross-wings/multiple ridges, church tower + buttresses, crenellations, barn
cart-porch, granary staddle posts, catslide, oriel, forestair.

**Texture/albedo only (2–5 px):** shutters, mullions/diamond panes, thatch liggers,
bargeboard line, door hardware, timber-frame pattern, ridge roll.

**Skip entirely (<2 px):** drip edges, flashing, individual shingles/tiles (use
2 px coursing bands), chimney pots, gutters (didn't exist), corbel brackets
(1 px shadow line instead), wall batter under ~20 cm.

Pragmatic note: historical verges (5–15 cm) round to 2–5 px — exaggerate verges to
~8 px minimum so the roof doesn't merge into the gable, *except* masonry-gable
types where flush is authentic and readable.
