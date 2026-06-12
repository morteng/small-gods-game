# Small Gods - Development Notes

## Game Concept

A god game inspired by Terry Pratchett's *Small Gods*. The player is a minor deity who must cultivate genuine belief among NPCs through indirect influence (whispers, omens, dreams, miracles). Rival spirits compete for the same followers. NPCs run on a programmatic simulation layer; an LLM "backfills" rich narrative whenever the player pays attention.

**Two-layer architecture:**
- **Sim layer** (always running) — NPC state: beliefs, needs, mood, relationships. Belief propagates along social graphs. Events (droughts, festivals, rival actions) shift NPC needs and create opportunities for divine intervention.
- **Narration layer** (on-demand) — LLM generates dialogue, scene descriptions, and dramatic moments from compact sim state when the player focuses on anything. Returns structured state deltas that feed back into the sim.

## Project Documentation

**Primary References:**
- **[VISION.md](docs/VISION.md)** — 🧭 **Canonical** cosmology, belief model, and start-to-end arc. Read first; all other design docs defer to it on cosmology / belief / Fate / progression.
- **[ROADMAP.md](docs/ROADMAP.md)** — 🛣️ The **single** forward plan (replaces the old IMPLEMENTATION.md/MVP_ROADMAP.md). Every not-yet-built track lives here; each gets its own brainstorm → spec → plan under `docs/superpowers/`.
- **[TECH_SPEC.md](docs/TECH_SPEC.md)** - Complete technical specification (gameplay systems, architecture, data models)

> Completed/superseded specs & plans are archived under `docs/archive/` (organized by epic). New design work goes in `docs/superpowers/{specs,plans}/`.

**Current Status:** Spec A (spine), Spec B (Time), Spec C (minimal — clickable time history strip), **Phase 7 (NPC Simulation Layer) + Phase 8 (Divine Action System) shipped**, the **Dilemma MVP / Track 1 belief loops**, **D1 (Mortality, Birth & Lineage)**, and **D2 (Deterministic Time-Skip)** all merged to `main`. **Phase 9 (LLM Integration) is largely complete** (client/prompt/writeback live and wired into NPC focus; player-facing provider config, first-run welcome modal, live-apply, and DeepSeek token filter shipped — remaining: capable-tier invocation [Track 4] and a conversation UI). **`game.ts` has been decomposed** from a ~1444-line god object into a thin coordinator (~386 LOC) over `src/game/` modules. **880 tests passing** (as of D2).

**Phase 9 Progress:**
- ✅ NPC prompt builder (`src/llm/npc-prompt-builder.ts`)
- ✅ LLM client abstraction + providers (`src/llm/llm-client.ts`: Mock, OpenAI, OpenRouter)
- ✅ Provider factory + localStorage config (`src/llm/provider-factory.ts`)
- ✅ State writeback from LLM responses (`src/llm/state-writeback.ts`)
- ✅ Backfill wired into NPC focus (`src/game/llm-backfill.ts` — `LlmBackfillService`, receives the configured client)
- ✅ Player-facing provider config + first-run welcome modal + live-apply + DeepSeek delimiter-token filter (`src/ui/{llm-settings-new,settings-unified,welcome-modal}.ts`, `src/llm/filter-provider-tokens.ts`; spec/plan dated 2026-06-02)
- ⬜ Two-tier "capable model at key moments" invocation — config + `llmClientCapable` seam exist; the caller is Track 4 / Fate
- ⬜ Conversation UI

Sim is fully deterministic with seedable RNG; snapshot/replay layer supports scrub + commit + re-roll; summoned Time bar UI with past-veil scrubbed treatment, clickable history strip of past commits/whispers above the transport row, jump-forward presets (+10/+25/+50y), and keyboard shortcuts T/Space/1/2/4/8/Esc. `state.paused` retired in favor of `scheduler.getRate()`. The whole `src/sim/` is `Math.random`-free (guarded by `tests/unit/no-random-in-sim.test.ts`).

**Phase 7 Complete:** NPC simulation layer with tick system, belief propagation, activity state machine, settlement events (8 event types), and event ring buffer.

**Phase 8 Complete:** Divine action system with whisper, omen, dream, miracle, answer prayer. Power economy regenerates from belief × understanding × devotion.

**D1 Complete:** NPCs age, die (convert `npc`→`remains`, never deleted), and reproduce (diluted-faith children). Lineage queries span living + remains. `MortalitySystem` + `BirthSystem` (0.25 Hz, seeded). Closed-form `projectTurnover` bridge for D2.

**D2 Complete:** Deterministic time-skip — `applySkip` (closed-form "jump N years") + one-way commit boundary (`commitSkip`/`SnapshotStore.reset`). Survivors keep frozen belief, no power accrues; the LLM era-authoring half is deferred to Track 4 (Fate).

## Known gaps & gotchas (code reality)

- **`World` has TWO index layers.** `EntityRegistry` has its own spatial/kind/tile indexes AND `World` (`world.ts`) keeps separate `spatial`/`kindIdx`/`tagIdx`; `query()` uses World's. When mutating `x/y/kind/tags`, call **`World.updateEntity()`** (it syncs both) — never mutate entity position directly.
- **LLM backfill uses the configured provider** (`LlmBackfillService`, `src/game/llm-backfill.ts`); `game.ts` builds it via `createProvider(loadProviderConfig())` and passes the real client. The service only falls back to `MockLLMProvider` when constructed with no `client`. (The old "hardcodes MockLLMProvider at game.ts ~1270" gotcha is obsolete — that path is gone post-decomposition.) Saving in the LLM settings now **rebuilds the live client in place** via `Game.applyLlmConfig` → `LlmBackfillService.setClient` (no page reload). `Game.llmClientCapable` is built ready but **uncalled** — a Track-4 / Fate seam.
- **Time-Debug snapshot/inject are honest stubs** (disabled `makeStubButton()`s in `src/dev/TimeDebugPanel.ts`). Wiring Save/Load → `TimelineController`/`snapshot.ts` and Inject → settlement events (`world.activeEvents` + `settlement_begin` log) is a ROADMAP item.
- **All `src/sim/` randomness flows through `ctx.rng`/passed `rng` (seeded sfc32), never `Math.random`** — enforced by `tests/unit/no-random-in-sim.test.ts`. New sim code must follow this or the guard test fails.
- **Building sprites flow through ONE pipeline (runtime + author-time):** blueprint → manifold geometry → magenta-backed grey init (`compositeOverChroma`) → OpenRouter img2img (`google/gemini-2.5-flash-image`) → chroma-key (`src/render/chroma-key.ts`) → **quality gates** (border-keyed fraction ≥0.6 + silhouette IoU ≥0.7 vs the geometry mask) → **register onto the geometry grid with a negotiation band** (geometry alpha rules the eroded core, the LLM's alpha wins within ±~4% of the silhouette edge, beyond is clipped; missing core pixels flood-fill from neighbours, chroma residue scrubbed — `registerAlbedo` in `src/render/sprite-postprocess.ts`, pure buffers, Node+browser) → palette-quantize → persist. `GeneratedBuildingArtSource` (`src/render/generated-building-art-source.ts`) runs it at runtime (validate-BEFORE-persist; bad gens get one retry then a session-only null, never poisoning IndexedDB; ≤2 concurrent paid calls), checking IDB → vendored base library → paid generation. **Author-time seeding is the same pipeline:** `OPENROUTER_API_KEY=… npx tsx scripts/seed-building-art.ts` (or `--plan` to dry-run) writes `public/asset-library/building-sprites/` so keyless players get art; keys match worldgen exactly (placer synthesizes presets unpatched with name-derived seeds). The old PixelLab pixflux building path (`gen-buildings.ts`) is **deleted** (its imports died with the Blueprint epic); `pixflux-compiler.ts` survives only for floor-tile scripts. `no-three-in-bundle.test.ts` still keeps three/gl out of the bundle. Geometry G-buffer hashes are pinned in `tests/unit/assetgen-golden.test.ts` — intentional geometry changes update the pins AND bump `ART_RECIPE_VERSION`.
- **Every IndexedDB open/transaction must race `withIdbTimeout`** (`src/services/idb-guard.ts`). A wedged backing store (browser killed mid-write) leaves `indexedDB.open()` pending FOREVER — no success/error/blocked — which froze boot on the loading screen and starved building art (2026-06-12). The three stores (`save-store`, `generated-art-cache`, `pixellab`) are guarded and degrade (fresh world / vendored art / dropped autosave); new IDB code must follow the same pattern.

## Tech Stack

- **TypeScript** ES modules, bundled by **Vite**
- **Canvas 2D** terrain/UI + **PixiJS WebGL entity layer** (lazy-loaded chunk; Canvas2D fallback)
- **WFC** (Wave Function Collapse) procedural map generation
- **Vitest** for testing (880 tests, 139 files)
- Embeddable as iframe via `Game` class + postMessage API
- `@/` path alias → `src/`

## Architecture

`game.ts` is a thin coordinator (~386 LOC); the work lives in `src/game/` modules and the subsystem dirs.

```
src/
  main.ts              — Entry point, mounts Game into #app
  game.ts              — Game class: wires subsystems, owns the frame loop (thin)

  game/                — Game coordinator's collaborators (extracted from the old god object)
    bootstrap-world.ts        — world/map/spirit/NPC bring-up
    game-ui.ts                — builds & owns all UI panels (HUD, settings, minimap, …)
    frame-renderer.ts         — per-frame draw orchestration
    interaction-controller.ts — click/drag/right-click dispatch
    interaction-state.ts      — transient hover/selection state
    divine-actions-controller.ts — registers divine action handlers on the dispatcher
    llm-backfill.ts           — LlmBackfillService (NPC focus → LLM → writeback)
    dev-mode-controller.ts    — dev panels (incl. Time-Debug); dev-mode-history.ts
    camera-follow.ts, viewport.ts, render-context.ts

  core/
    state.ts           — GameState interface + factory
    types.ts           — All type definitions
    constants.ts       — Tile sizes, colors, POI icons
    rng.ts             — Seedable world RNG (sfc32)
    noise.ts           — noise functions
    schema.ts          — World seed validation + defaults
    clock.ts, scheduler.ts — sim tick clock + rate-scaled scheduler
    events.ts          — EventLog (canonical narrative sequence) + SilentEventLog (replay)
    snapshot.ts        — snapshot capture/restore + SnapshotStore
    timeline.ts        — TimelineController (scrub/commit/re-roll/commitSkip)
    calendar.ts        — tick → "Y1 spring · 30/96"; spirit.ts — Spirit type

  sim/                 — deterministic simulation (Math.random-free)
    npc-sim.ts, npc-movement.ts, social-graph.ts, believers.ts, whisper.ts
    divine-actions.ts, spirit-system.ts, rival-spirit.ts, pathfinding.ts, spawner.ts
    mortality.ts, turnover.ts, time-skip.ts   — D1 + D2 lifecycle/skip
    systems/           — registered tick systems (npc-sim, belief-propagation,
                         activity, movement, settlement-event, mortality, birth, abandonment)

  world/               — entities-as-world model
    world.ts, entity-registry.ts, indexes.ts, spatial-hash.ts, entity-kinds.ts
    npc-helpers.ts, npc-lifecycle.ts (killNpc/birthNpc/materializeSynthChild)
    seed-world.ts, biome-regions.ts, building-placer.ts, building-collision.ts
    perception-system.ts, oracle.ts, brushes/

  llm/                 — npc-prompt-builder.ts, llm-client.ts (Mock/OpenAI/OpenRouter),
                         provider-factory.ts, state-writeback.ts

  map/                 — map-generator.ts, autotiler.ts, blob-autotiler.ts,
                         building-templates.ts, poi-zones.ts, world-manager.ts
  wfc/                 — tile/cell/grid/propagator/solver/engine (3-phase WFC)
  render/              — renderer, camera, minimap, asset-manager; iso/ + lpc/ subrenderers
  ui/                  — chrome.ts, tokens.css, controls.ts, overlay-dispatcher.ts,
                         settings-unified.ts, llm-settings-new.ts, panels/ (time-chip,
                         time-bar, time-history, …)
  dev/                 — TimeDebugPanel.ts + dev panel chrome
  services/            — pixellab.ts (asset gen)
  terrain/             — terrain helpers
  embed/               — api.ts (postMessage), mount.ts
```

## Rendering

Iso renderer (default; `?render=topdown` for the legacy grid):
- Terrain = Canvas2D colored diamonds; minimap with viewport indicator
- **Entity pass = neutral draw list, two backends** (PBR epic Slice 2): the y-sorted
  buildings/barriers/NPCs/vegetation/decorations pass builds screen-space `DrawItem`s
  (`src/render/iso/entity-draw-list.ts`) executed by EITHER the **PixiJS WebGL layer**
  (`src/render/pixi/pixi-entity-layer.ts` — lazy `import('pixi.js')` own chunk, offscreen
  canvas composited between terrain and overlays, identity-transform `drawImage`) or the
  Canvas2D executor (`draw-list.ts`) — same list, placement parity by construction.
  WebGL-init failure or the dev "Backend: Force Canvas2D" toggle falls back per-frame.
  `pixi.js` must never be statically imported (guard: `no-static-pixi-import.test.ts`).
- **Banded lighting v1** (PBR Slice 3): building sprites travel as `SpritePack`s
  (albedo + co-registered normal/material canvases, decoded from the IDB cache /
  vendored library / composeStructure); map-carrying draw items render on the WebGL
  backend as unit-quad meshes with a custom GL shader (`src/render/pixi/lit-shader.ts`)
  — ambient + one directional sun (`src/render/lighting-state.ts`, screen-space normals,
  canonical upper-left), diffuse quantized into bands, AO from material.G. Canvas2D
  stays the UNLIT parity fallback; dev toggle "☀️ Lighting". Next slices: day/night
  from `state.clock` (4), point lights + emissive windows (5), material truth (6).
- Camera: pan (drag) + zoom ladder (integer / 1-over-integer rungs, pixel-snapped origin)

## Iframe Embedding

The game is designed to be embeddable in a secure iframe (for MCP UI):

```ts
import { mount } from './embed/mount';
const game = mount('#container');
await game.generateWorld();
```

- `Game` class: `new Game(containerElement, options?)` — mounts into any DOM element
- No `document.body` assumptions — everything scoped to container
- No inline event handlers — all `addEventListener`
- CSP-compatible — no dynamic code execution, no inline scripts
- PostMessage API for host communication
- Responsive to container size changes via ResizeObserver

## Key File Locations

| Purpose | File |
|---------|------|
| Entry point | `src/main.ts` |
| Game coordinator (thin) | `src/game.ts` |
| Game subsystems | `src/game/` (`bootstrap-world`, `game-ui`, `frame-renderer`, `interaction-controller`, `llm-backfill`, `dev-mode-controller`, …) |
| State management | `src/core/state.ts` |
| Type definitions | `src/core/types.ts` |
| Game constants | `src/core/constants.ts` |
| Map renderer | `src/render/renderer.ts` |
| Camera transforms | `src/render/camera.ts` |
| WFC engine | `src/wfc/engine.ts` |
| Map generation | `src/map/map-generator.ts` |
| Autotiler | `src/map/autotiler.ts` |
| World seeds | `public/data/worlds/default.json` |
| World seed schema | `src/core/schema.ts` |
| Seedable world RNG (sfc32) | `src/core/rng.ts` |
| Snapshot capture/restore + store | `src/core/snapshot.ts` |
| Timeline controller (scrub/commit/re-roll) | `src/core/timeline.ts` |
| Silent event log (replay) | `src/core/events.ts` (`SilentEventLog`) |
| Calendar helper (tick → "Y1 spring · 30/96") | `src/core/calendar.ts` |
| UI chrome scaffold + past-veil | `src/ui/chrome.ts` |
| Time chip | `src/ui/panels/time-chip.ts` |
| Time bar (summoned) | `src/ui/panels/time-bar.ts` |
| Time history strip (clickable chips) | `src/ui/panels/time-history.ts` |
| Design tokens (scoped to container) | `src/ui/tokens.css` |
| Time keyboard shortcuts | `src/ui/controls.ts` (`attachTimeKeys`) |
| **NPC simulation** | `src/sim/npc-sim.ts`, `src/sim/systems/` |
| **Divine actions** | `src/sim/divine-actions.ts`, `src/game/divine-actions-controller.ts` |
| **Spirit system** | `src/sim/spirit-system.ts`, `src/core/spirit.ts` |
| **NPC helpers** | `src/world/npc-helpers.ts` |
| **NPC lifecycle (D1/D2)** | `src/world/npc-lifecycle.ts` (`killNpc`/`birthNpc`/`materializeSynthChild`) |
| **Mortality / turnover / time-skip** | `src/sim/mortality.ts`, `src/sim/turnover.ts`, `src/sim/time-skip.ts` |
| **LLM client + providers** | `src/llm/llm-client.ts` (Mock/OpenAI/OpenRouter) |
| **LLM provider config** | `src/llm/provider-factory.ts` (localStorage `small-gods-llm-provider`) |
| **LLM backfill service** | `src/game/llm-backfill.ts` |
| **LLM settings UI** | `src/ui/settings-unified.ts`, `src/ui/llm-settings-new.ts` |
| **Jump-forward (skip) UI** | `src/ui/panels/time-bar.ts` + `commitSkip` in `src/core/timeline.ts` |
| **Dev / Time-Debug panel** | `src/game/dev-mode-controller.ts`, `src/dev/TimeDebugPanel.ts` |

## Development

```bash
npm run dev        # Start Vite dev server
npm run build      # TypeScript check + Vite production build
npm test           # Run all tests (vitest)
npm run test:watch # Watch mode
```

## Gameplay Architecture

Phases 7–8 shipped; Phase 9 (LLM) is partway; rivals (Track 3) and the DM agent (Track 4 / "Fate") are still ahead — see [ROADMAP.md](docs/ROADMAP.md).

- **NPC sim** (✅): personality traits, belief per spirit (faith/understanding/devotion), needs (safety/prosperity/community/meaning), social graph, event ring buffer, mortality + birth + lineage (D1)
- **Divine actions** (✅): whisper, omen, answer prayer, dream, miracle — each costs belief-power; understanding gates sign-perception & prayer efficacy (Track 1)
- **LLM backfill** (🟡): ~500-token prompt → narrative + JSON state delta, target <200 ms; client/providers/writeback live, provider config UI in progress
- **Rival spirits** (⬜ Track 3): personality-driven programmatic actions, LLM-narrated when intersecting with the player
- **Fate / DM agent** (⬜ Track 4): background LLM (larger model, infrequent) managing pacing, plot threads, rival coaching, escalation, player modeling — also the LLM era-authoring half of the D2 time-skip loop. The codebase calls this layer **"Fate."**
