# World Style — "Tone & Scale" meta-configuration (brainstorm)

**Status:** brainstorm (no code beyond the terrain-height default bump)
**Date:** 2026-06-17
**Origin:** user — "let's consider some overall 'emergent' parameters for the entire
game that should be controllable by the user. one is ESRB rating (Kid-friendly, PG,
etc), another is 'game factor' going from something like simulator to 'children's book'…
game factor should have individually controllable parameters like terrain height and
field sizes etc … spacing between different kinds of buildings, height of mountains,
spacing between pois."

## 1. The idea, restated

Expose a small number of **high-level emergent dials** the player sets once (or tweaks
live), each of which fans out into many concrete generation/render parameters. Two
dials to start:

1. **Content rating** (ESRB-like): *Kid-friendly → PG → Teen → Mature*. Governs **tone
   and content** — how death/violence are depicted, which dark events fire, the LLM's
   narrative voice.
2. **Game factor / stylization**: *Simulator → Children's book*. Governs **spatial and
   visual exaggeration & abstraction** — terrain height, mountain drama, building/POI
   spacing, field sizes, flora scale, palette.

These two axes are **orthogonal** — you can have a *Mature* world rendered in a chunky
*storybook* style, or a *kid-friendly* one in a flat *simulator* style. Keep them
separate; do **not** collapse "children's book" into "kid-friendly."

## 2. Architecture: one resolved style object, many knobs

The pattern is exactly a graphics-settings panel: a **preset** (High/Med/Low) sets
everything, and any individual **slider** can override.

```
resolveWorldStyle({ scalePreset, ratingPreset, overrides }) -> ResolvedStyle
```

- `ResolvedStyle` is a **flat record** of every knob's final value.
- A **profile** is just a named override-bag applied over `STYLE_DEFAULTS`.
- Per-knob `overrides` win last.
- Stored on `worldSeed.style` → **deterministic, serializable, part of the save**
  (aligns with the `Math.random`-free seeded-sim rule). A live-edit panel mutates it
  and re-derives.

Consumers **read the resolved style** instead of hardcoded constants. The seam is the
whole point: `STYLE_DEFAULTS` equals today's constants, so S0 is a behavior-neutral
refactor.

| Today (hardcoded) | Becomes |
|---|---|
| `TERRAIN_Z_PX_PER_M` | `style.terrainVerticalExaggeration` |
| `TERRAIN_RELIEF_M` / ridge weight | `style.mountainRelief` |
| island dome + falloff steepness | `style.coastDrama` |
| settlement frontage gaps / lot padding | `style.buildingSpacing` |
| settlement & POI separation | `style.poiSpacing` / `style.settlementSpacing` |
| open-field / croft dimensions | `style.fieldSize` |
| tree/prop scale (the existing tree "game factor") | `style.floraScale` / `style.propScale` |
| terrain/biome palette | `style.paletteSaturation` / `style.paletteWarmth` |
| LLM prompt tone, event gating | `style.narrationTone`, `style.deathDepiction`, `style.darkThemes` |

## 3. Knob taxonomy

### Scale / "game factor" axis (Simulator ↔ Storybook)
- `terrainVerticalExaggeration` — px per metre of relief (today's `TERRAIN_Z_PX_PER_M`)
- `mountainRelief` — interior peak height (relief metres / ridge weight)
- `coastDrama` — island dome strength + edge-falloff steepness
- `fieldSize` — open-field & croft dimensions
- `buildingSpacing` / `lotPadding` — frontage gaps between buildings
- `settlementSpacing` / `poiSpacing` — separation between settlements & POIs
- `settlementDensity` — growth pressure / buildings per settlement
- `floraScale` & `floraDensity` — tree/bush size & count (generalize the tree factor)
- `propScale`
- `paletteSaturation` / `paletteWarmth` — naturalistic vs candy-colored
- `outlineWeight` — none (sim) ↔ thick storybook outlines (future render knob)

*Simulator end:* exaggeration low, spacing realistic/tight, density high, palette
desaturated, small flora. *Storybook end:* tall chunky mountains, generous cozy
spacing, fewer larger **readable** elements, saturated palette, big rounded flora.

### Rating axis (Kid-friendly ↔ Mature)
- `deathDepiction` — euphemistic ("passes on", petals) ↔ graphic (remains, blood)
- `violence` — none ↔ depicted (raids, war, sacrifice)
- `darkThemes` — gate plague / famine / sacrifice / heresy-burning events
- `narrationTone` — gentle/whimsical ↔ grim/literary (LLM system-prompt modifier)
- `miracleIntensity` — gentle glow ↔ smiting/body-horror visuals
- `language` — LLM register / profanity ceiling

The rating axis has two clean integration points that already exist: the **settlement
/ divine event catalogue** (gate which events may fire) and the **LLM prompt builder**
(`src/llm/npc-prompt-builder.ts` — inject tone + content ceiling).

## 4. Render-live vs regenerate-on-apply

A crucial UX distinction the panel must surface:

- **Render-live knobs** (re-render, no regen): `terrainVerticalExaggeration`,
  `mountainRelief`*, palette, `floraScale`/`propScale`, `outlineWeight`, narration tone.
  (*relief affects the heightfield, which is memoized+derived, so a relief change just
  invalidates the memo — still no worldgen rerun.)
- **Regenerate-on-apply knobs** (change the seeded layout): `buildingSpacing`,
  `poiSpacing`, `fieldSize`, `settlementDensity`, `coastDrama`, event gating.

The panel marks the latter "applies on regenerate."

## 5. Slicing

- **S0 — resolution core (behavior-neutral):** `WorldStyle` type + `STYLE_DEFAULTS` +
  `resolveWorldStyle` + the two profile tables, stored on `worldSeed.style`, plumbed but
  every consumer still resolves to today's constant. Pure, fully unit-tested. The seam.
- **S1 — wire existing scale constants:** `terrainVerticalExaggeration`,
  `mountainRelief`, `coastDrama`, `floraScale` read from the resolved style. Immediate
  payoff: the terrain height the user just flagged becomes a profile + slider. (Today's
  `TERRAIN_Z_PX_PER_M=14` bump is this knob's seed default.)
- **S2 — spacing/size knobs into worldgen:** `buildingSpacing`, `poiSpacing`,
  `fieldSize`, `settlementDensity`.
- **S3 — rating axis:** event gating + LLM prompt tone (parallelizable with S1/S2).
- **S4 — live-edit "World Style" panel:** two preset dropdowns + an expandable per-knob
  slider tray; render-live knobs apply instantly, regenerate knobs prompt a re-roll.

## 6. Recommended MVP

**S0 + S1.** It establishes the seam and immediately turns the terrain-height
complaint into a controllable knob with Simulator/Storybook presets — the most visible
win — without touching worldgen layout or the LLM. S2–S4 follow as appetite allows.

## 7. Open questions / defaults chosen
- **Storage:** `worldSeed.style` (deterministic + saved). ✔
- **Two axes, not one umbrella scalar.** ✔
- **Profiles are sparse override-bags over `STYLE_DEFAULTS`**, so adding a knob never
  breaks an existing profile. ✔
- Naming: "World Style" with sub-tabs "Tone" (rating) and "Scale" (game factor) — open
  to a better player-facing label.
