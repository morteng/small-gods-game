# Shrines as procession sub-connectomes (brainstorm)

**Date:** 2026-06-16 · **Status:** brainstorm (user-directed) · **Builds on:**
[worldbuilding fact DB + building connectome](2026-06-14-worldbuilding-fact-database-design.md),
[fact-catalogue + connectome slice 0–1 spec](2026-06-14-fact-catalogue-connectome-slice01-spec.md),
[roads / linear features connectome](2026-06-14-roads-linear-features-connectome-design.md),
[semantic feature / anchor tags (affordance graph)](2026-06-13-semantic-feature-anchor-tags-design.md),
[settlement growth placement](2026-06-13-settlement-growth-placement-design.md)

## What the user asked

> "Consider whether shrines should not be their own connectomes of props, parts,
> buildings or whatever as a subset of the world connectome."

…motivated by research into the **universal spatial grammar of European shrine
worship** — that beneath stylistic differences (Megalithic passage tomb, Celtic
grove, Norse cult-house, medieval crypt) the same four structural laws recur:

1. **The Threshold (Law of Demarcation).** An explicit boundary marker that tells
   the worshipper they are leaving the common world — concentric ditch → narthex →
   porch — adorned with a *cleansing or defensive* fixture at the exact border
   (Roman basin, buried torque/bent sword, Christian holy-water font).
2. **The Funnel (Law of Sensory Deprivation).** Progressive **narrowing and
   darkening** — low lintels, tight tunnels, subterranean stairs, column-shadowed
   aisles, drapery/veils — forcing a posture of submission ("return to the cosmic
   womb").
3. **The Axis Mundi (Law of Vertical Alignment).** A core focal object (deity
   pillar, altar, reliquary) placed on a precise vertical line linking underworld,
   earth, and heaven — celestially aligned (solstice entry, spire over crypt) and
   adorned in high-contrast reflective material (gold leaf, silver, gems) that
   **flashes in candle/lamp light**.
4. **Controlled Contact (Law of Filtered Access).** Screens, grilles, and
   **fenestellae** (hand-sized openings to touch grave dust / lower a *brandeum*),
   plus **kissing stones** worn smooth over centuries — restricted, channelled
   physical access that increases perceived power.

## The thesis (my synthesis)

**Yes — but reframe.** A shrine is *not* a separate connectome system. It is the
**existing connectome vocabulary** (`Zone` / `Portal` / `Fixture`, see
`src/blueprint/connectome/types.ts`) **specialized by a generative grammar** and
expressed as one graph shape the building connectome does not yet model: a
**directed procession path** — an *ordered* sequence of zones with *attribute
gradients*, not the adjacency graph ("which room touches which") it builds today.

The four laws map onto the primitives almost suspiciously cleanly:

| Law | Connectome expression | Status today |
|---|---|---|
| **1. Threshold** | a `Portal` `type:'threshold'` (`from:'OUTSIDE'`) + a boundary `Fixture` (`fn:'cleanse'`/`'ward'`: font / torque-deposit) anchored on it | Portals exist; **gate-with-state** is the affordance-graph epic |
| **2. Funnel** | an **ordered `Zone` path** carrying monotonic *attribute ramps* in `attrs` (`width↓`, `light↓`, `floorZ↓`) | partial — `frontageValue` gradient, road grade-cut. **Ordered-path-with-ramps is the new primitive.** |
| **3. Axis Mundi** | one `Fixture` (`fn:'worship'`) with an **alignment constraint** linking its position ↔ an aperture/spire ↔ a sky azimuth; emissive/reflective material | pieces exist — solar/moon sky model, `lighting-state` sun azimuth, the `heightAt ⊕ deformations` channel for crypt-below / spire-above. **The constraint that ties them is new.** |
| **4. Controlled contact** | a `Portal` with **partial permeability / state** (screen / grille / fenestella) + a tagged **contact anchor** with a **wear accumulator** | overlaps gate-state + wear-mask + lifecycle wear; **point wear-accumulator is new** |

This is the same `requires`/`satisfies` token machinery the hearth→`smoke-egress`
rule already uses: e.g. the worship fixture `requires:['axis-alignment']`, the
threshold `satisfies:['demarcation']`, a funnel zone `requires:['darkening']`.

## Why it is a *subset of the world connectome*, not a new thing

The four laws are **scale-free invariants** — the exact property that already makes
the connectome scale-free (`ConnectomeScale: niche ⊂ room ⊂ building ⊂ district ⊂
settlement ⊂ region ⊂ world`). The *same* shrine grammar instantiates at every
scale:

- **`niche`** → a household altar (a single `Fixture` in a domestic `Zone`) — recursion floor
- **`building`** → a chapel / `temple_small` (procession internalised into rooms)
- **`district`/`settlement`** → a temple precinct (zones + portals at settlement scale)
- **`region`/`world`** → a stone circle: the **avenue is a `Portal`** (a road — see
  roads-as-Portals), the henge a `Zone`, the heel stone a `Fixture`, the solstice
  the alignment constraint

That last row is the tell: **Stonehenge and a crypt are the same graph at different
scales.** So a shrine must *not* be a hand-authored building preset — it is a
**rule pack** (like `SITE_RULES` / `CIVIC_RULES` / `UPGRADE_CHAINS` / the medieval
fact pack) that, given *culture + era + site + scale*, **emits** a procession
sub-connectome via the normal grammar expansion (`src/blueprint/connectome/
grammar.ts`) and resolves down through `to-blueprint.ts` → `toGeometry` → the
existing img2img pipeline. **This directly serves the standing directive:**
*"ideally the hand-tuned presets are not hand-tuned, just generative results of the
graph."* The grammar would *retire* the hand-tuned `temple_small` by deriving it.

## How it wires into work already in flight

- **Affordance-graph epic** ([anchor tags](2026-06-13-semantic-feature-anchor-tags-design.md))
  — the threshold-gate-with-state, the touch/kiss contact anchor, and the
  axis-mundi camera/light anchor are all *typed + tagged + stateful* anchors.
  Shrines would be its first serious **consumer** (it has been a producer-only idea).
- **Roads as Portals** ([roads/linear features](2026-06-14-roads-linear-features-connectome-design.md))
  — a pilgrimage route is literally a world-scale **funnel `Portal`** feeding the
  precinct; the avenue's spline is already a `Portal.attrs.path`.
- **Worldbuilding fact DB** ([fact DB](2026-06-14-worldbuilding-fact-database-design.md))
  — a Wikipedia-grounded **shrine pack** (per-culture: threshold marker, boundary
  ornament, core object, contact filter), the same shape as the barrier-type and
  flora fact DBs. Cultures = swappable packs; the engine stays content-free.
- **Lighting / sky + deformation channel** — solstice azimuth (sky model),
  candlelight emissive (PBR Slice 5 point lights + emissive), crypt-below /
  spire-above (`heightAt ⊕ deformations`) are existing channels the alignment
  constraint ties together.
- **Fate / belief loop** — a shrine is where *belief is transacted*. The procession
  graph gives Fate concrete anchors (threshold crossed, core reached, relic
  touched) to attach miracles/omens to. Worn kissing stones are a *physical record
  of accumulated devotion* — a sim signal, not just decoration.

## What is genuinely new (the honest scope)

Three graph primitives, each useful **beyond** shrines:

1. **Ordered path with attribute ramps** — a directed `Zone` sequence where
   `light` / `width` / `floorZ` interpolate threshold→core. (Reusable for any
   designed circulation: a hall of approach, a fortified gatehouse run.)
2. **Alignment constraint** — links a `Fixture` + an aperture/spire + a celestial
   azimuth. (Reusable for any sun-aware building — solar orientation, light wells.)
3. **Permeable/stateful `Portal` + contact wear-accumulator** — partial barriers
   and surfaces that record contact over time. (Reusable for gates, market grilles,
   worn thresholds everywhere.)

Everything else reuses what exists: `Zone`/`Portal`/`Fixture`, `attrs` bags,
`requires`/`satisfies` tokens, `fn` function tags, `ConnectomeScale`, `TerrainProbe`,
the grammar expansion, `to-blueprint` resolve-down, and the geometry/img2img pipeline.

## Open questions (for the spec Q&A)

1. **How explicit is the procession order?** A dedicated ordered `sequence: string[]`
   on the Connectome, or inferred from a `threshold→core` Portal chain + a
   `depth` attr per Zone? (Leaning: a typed `procession` edge-chain so it stays in
   the existing primitives.)
2. **Attribute ramps — where do they live?** Per-Zone `attrs.light/width/floorZ`
   written by the grammar, vs. a ramp declared once on the procession and sampled.
   (Leaning: grammar writes per-zone, so resolve-down and rendering stay dumb.)
3. **Alignment constraint — solve at expand-time or resolve-time?** Does the
   grammar place the axis fixture and *then* orient the aperture, or does a
   constraint solver reconcile both against the sky azimuth?
4. **Does interior get rendered now, or stay latent (as buildings do)?** "Do
   outside first" suggests latent: the procession constrains the *exterior*
   (entry placement, spire, orientation, ditch/skirt) and interior rendering comes
   when there is a camera that goes inside.
5. **Culture pack breadth for slice 1** — one era/culture (early-medieval Christian
   crypt-chapel) to prove the grammar, or the four exemplars (megalith / grove /
   cult-house / crypt) to prove scale-freedom in one shot? (Leaning: one, deep.)
6. **Sim coupling depth** — is the wear-accumulator real sim state (belief-driven),
   or render-only for now with a seam for later?

## Recommended path forward

Standard flow: **this brainstorm → spec → plan → sliced build.** Smallest slice
that proves the thesis:

> **Slice 1 — one chapel as a four-node procession sub-connectome.** Model a small
> chapel/temple as `OUTSIDE →[threshold Portal + font Fixture]→ funnel Zone(s with
> light/width ramp) →[contact Portal]→ sanctum Zone + axis-mundi Fixture`, emitted
> by a shrine grammar rule from a one-culture pack, resolved through the existing
> pipeline to a rendered exterior — **retiring the hand-tuned `temple_small`.**
> Adds primitive #1 (ordered path + ramps) only; #2 (alignment) and #3 (permeable
> portal + wear) follow as Slices 2–3.

Then scale **up** (precinct at settlement scale, avenue-as-Portal) and **down**
(household altar at `niche` scale) to demonstrate the grammar is genuinely
scale-free — the same four laws, three instantiations.

## Decisions taken

1. **Shrine = specialization of the existing connectome, not a parallel system.**
   Same `Zone`/`Portal`/`Fixture`; new = the *directed procession path* shape.
2. **Generative, not hand-authored.** A shrine grammar rule pack emits the
   sub-connectome from culture+era+site+scale; it retires `temple_small`.
3. **Scale-free by construction.** One grammar, instantiating from `niche` (altar)
   to `world` (stone circle); slice 1 proves it at `building` scale.
4. **Outside first.** The procession is latent/constraining for the exterior now;
   interior rendering deferred, zero rework (same graph).
5. **Brainstorm doc first** (this document), then spec → plan.
