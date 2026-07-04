# Small Gods — Development Notes

## Game Concept

A god game inspired by Terry Pratchett's *Small Gods*. The player is a minor deity who cultivates genuine belief among NPCs through indirect influence (whispers, omens, dreams, miracles). Rival spirits compete for the same followers.

**Two-layer architecture:**
- **Sim layer** (always running) — deterministic NPC state: beliefs, needs, mood, relationships. Belief propagates along social graphs; events (droughts, festivals, rival actions) shift needs and open opportunities for divine intervention.
- **Narration layer** (on-demand) — an LLM generates dialogue/scenes from compact sim state when the player focuses on something, and returns structured state deltas that feed back into the sim. **Rule: the sim is truth; the LLM animates it and never contradicts its numbers.**

## Project Documentation

- **[VISION.md](docs/VISION.md)** — 🧭 **Canonical** cosmology, belief model, arc. Read first; other docs defer to it on cosmology / belief / Fate / progression.
- **[ROADMAP.md](docs/ROADMAP.md)** — 🛣️ The **single** forward plan. Each not-yet-built track gets its own brainstorm → spec → plan under `docs/superpowers/{specs,plans}/`.
- **[TECH_SPEC.md](docs/TECH_SPEC.md)** — full technical spec (systems, architecture, data models).
- Completed/superseded specs live in `docs/archive/`. **For live session state / active epics, read `MEMORY.md`, not this file.**

**Status:** The core arc is shipped to `main` — Spec A (spine), Time (Spec B/C), Phase 7 (NPC sim), Phase 8 (divine actions), Track 1 belief loops, D1 (mortality/birth/lineage), D2 (deterministic time-skip), Phase 9 (LLM backfill: client/prompt/writeback + provider config + live-apply). Since then: parametric building pipeline (blueprint→manifold→img2img→SpritePack), metric scale, settlement growth (S1–S6), a **WebGPU-only renderer**, GPU terrain + world connectome, and a **WebGPU-native immediate-mode UI** (`src/render/ui/`, the default chrome). `game.ts` is a thin coordinator (~1170 LOC) over 19 `src/game/` modules. **~3664 tests (~556 files).** Rivals (Track 3) core shipped — live `RivalSystem` on real data + unanswered-prayer claiming. Fate brain (Track 4) is LIVE — event-driven `FateBrainService` with 4 constrained tools, wakes on story beats + rival claim pressure. Storylets arm→discover→play end-to-end. Round 5 (WCV80): gates committed as portal nodes BEFORE roads (stitches = logged degenerate repair), emergent desire-line trample system (NPC traffic → dirt trails, settlement-wear absorbed as its prewarm), fillet raster reconciliation (NPCs walk the smoothed ribbon). Remaining gameplay: Fate depth (pacing, era-authoring), conversation UI.

Sim is deterministic with seedable RNG (sfc32); snapshot/replay supports scrub + commit + re-roll + jump-forward presets. `state.paused` retired for `scheduler.getRate()`. **All `src/sim/` is `Math.random`-free** (guard: `tests/unit/no-random-in-sim.test.ts`).

## Known gaps & gotchas (code reality)

- **`World` has TWO index layers.** `EntityRegistry` has its own indexes AND `World` (`world.ts`) keeps separate `spatial`/`kindIdx`/`tagIdx`; `query()` uses World's. When mutating `x/y/kind/tags`, call **`World.updateEntity()`** — never mutate entity position directly.
- **All `src/sim/` randomness flows through `ctx.rng` / passed `rng` (seeded sfc32), never `Math.random`** — enforced by a guard test.
- **Every IndexedDB open/txn must race `withIdbTimeout`** (`src/services/idb-guard.ts`). A wedged backing store leaves `indexedDB.open()` pending FOREVER (froze boot). The three stores (`save-store`, `generated-art-cache`, `pixellab`) are guarded and degrade (fresh world / vendored art / dropped autosave).
- **LLM backfill uses the configured provider** (`LlmBackfillService`, `src/game/llm-backfill.ts`); `game.ts` builds it via `createProvider(loadProviderConfig())`. Saving LLM settings rebuilds the live client in place (`Game.applyLlmConfig` → `setClient`, no reload). `Game.llmClientCapable` (capable tier) feeds the **Fate brain** (`src/game/fate/`); the deterministic stub producer runs only as the offline fallback (`llmClientCapable === null`).
- **Story-pack effects must name verbs from the capability registry** — the live bus allowlist rejects the WHOLE pack otherwise (this silently killed the shipped pack for weeks; guard: `tests/unit/story-pack-live-verbs.test.ts`). Storylet `subject:` args don't resolve to command targets yet (subject binding is a gap).
- **Building sprites flow through ONE pipeline (runtime + author-time):** blueprint → manifold geometry → grey init (`compositeOverChroma`) → OpenRouter img2img (`BUILDING_IMAGE_MODEL` = `black-forest-labs/flux.2-klein-4b`) → chroma-key → quality gates (border-key ≥0.6 + silhouette IoU ≥0.7) → register onto the geometry grid with a negotiation band (`registerAlbedo`, `src/render/sprite-postprocess.ts`) → palette-quantize → persist. `GeneratedBuildingArtSource` runs it at runtime (validate-BEFORE-persist; bad gens retry once then session-null, never poisoning IDB), checking IDB → vendored library → paid generation. Author-time seeding is the same pipeline: `OPENROUTER_API_KEY=… npx tsx scripts/seed-building-art.ts [--plan]`. Geometry G-buffer hashes pinned in `tests/unit/assetgen-golden.test.ts` — geometry changes update the pins AND bump `ART_RECIPE_VERSION` (**currently `v24`**). **Runtime paid gen defaults OFF and a reseed is FROZEN (user: "don't spend money yet") → in-game buildings render as GREY massing until a funded reseed.**
- **The camera pans in ISO-SCREEN space** (`gpu-render-frame` passes `originX: -camera.x` into the diamond projection). Any code framing a tile (fly/follow/fit) must project via `render/iso/iso-projection.worldToScreen` — the flat `tile*TILE_SIZE` mapping is a different space and lands mid-ocean. `Game.flyTo` accepts `(tx,ty)` or `({x,y})`, drops non-finite/off-map targets, and `applyCameraFly` self-heals a NaN camera.
- **Time-Debug snapshot/inject are honest stubs** (disabled buttons in `src/dev/TimeDebugPanel.ts`) — a ROADMAP item.

## Tech Stack

- **TypeScript** ES modules, bundled by **Vite**. `@/` path alias → `src/`. **Vitest** for tests.
- **WebGPU** is the only scene renderer (terrain + entities + UI); Canvas2D 2D-ctx kept only for overlays/compositing. A device with no WebGPU gets an honest "WebGPU required" overlay. `pixi.js` must never be imported (guard test).
- Live overworld is **noise-based** (`terrain/terrain-generator.ts`: fractal noise → biomes → tiles) + connectome/settlement-driven (superseded WFC in the 2026-05 overhaul). **WFC** primitives are retained but **dormant** (`generateWithWFC` bypassed; `autotiler` still reads WFC `TILES`; Cell/Grid/Solver reserved for a future zone-WFC / dungeons).
- Embeddable via the `Game` class + postMessage API (iframe path being superseded by the WebGPU-UI / MCP epic).

## Architecture

`game.ts` is a thin coordinator; the work lives in 19 `src/game/` modules + subsystem dirs.

```
src/
  main.ts   — entry; mounts Game into #app
  game.ts   — Game class: wires subsystems, owns the frame loop (thin)
  game/     — coordinator collaborators: bootstrap-world, game-ui, frame-renderer,
              interaction-controller/-state, divine-actions-controller, llm-backfill,
              dev-mode-controller, camera-follow, viewport, render-context
  core/     — state, types, constants, rng (sfc32), noise, schema, clock, scheduler,
              events (EventLog + SilentEventLog), snapshot, timeline, calendar, spirit
  sim/      — deterministic (Math.random-free): npc-sim, npc-movement, social-graph,
              believers, whisper, divine-actions, spirit-system, rival-spirit, pathfinding,
              spawner, mortality, turnover, time-skip; systems/ (registered tick systems)
  world/    — entities-as-world: world, entity-registry, indexes, spatial-hash, entity-kinds,
              npc-helpers, npc-lifecycle (killNpc/birthNpc/materializeSynthChild), seed-world,
              building-placer, building-collision, enclosure (barrier rings), perception-system,
              oracle, connectome/, brushes/
  llm/      — npc-prompt-builder, llm-client (Mock/OpenAI/OpenRouter), provider-factory,
              openrouter-catalog, state-writeback
  map/      — map-generator, autotiler, blob-autotiler, poi-zones, world-manager
  render/   — gpu/ (terrain-field, feature-geometry, gpu-scene, gpu-render-frame), iso/
              (entity-draw-list, iso-projection, iso-barrier), ui/ (WebGPU immediate-mode UI),
              camera, minimap, chroma-key, sprite-postprocess, lighting-state, *-art-source
  assetgen/ — compose (composeStructure), geometry/ (building, tower-spec, gate-spec,
              post-spec, stair-spec, arch, column, linear, solids, manifold-runtime)
  blueprint/, catalogue/ (medieval-europe pack), terrain/ (biomes, hydrology, poi-influence),
  ui/ (legacy DOM chrome, behind ?legacyui), wfc/ (dormant), dev/, services/, embed/
```

## Rendering (WebGPU-only)

- **Terrain** = buffer-driven GPU heightfield (`render/gpu/terrain-field.ts`; shader generates + lifts the grid). Height = `baseSeedHeight ⊕ deformations`. Roads/rivers carve through ONE analytic feature-SDF (`render/gpu/feature-geometry.ts`); earthworks/pads/walls write the shared deformation channel (`world/terrain-deformation.ts`). Mesh viewport-culled.
- **Entity pass** = y-sorted draw list (`render/iso/entity-draw-list.ts`) run by the WebGPU scene (`render/gpu/gpu-scene.ts`), instanced; foot-z terrain lift for placement parity.
- **Banded lighting**: building sprites are `SpritePack`s (albedo + co-registered normal/material from IDB cache / vendored library / `composeStructure`); ambient + one directional sun, diffuse quantized into bands, AO from material.G, projected cast shadows via stencil-union.
- **UI** = WebGPU-native immediate-mode (`render/ui/`) default chrome (`Game.barebones`); `?legacyui` flips back to the suppressed legacy DOM/Canvas2D chrome.
- Camera: pan (drag) + zoom ladder (integer / 1-over-integer rungs, pixel-snapped origin).

## Iframe Embedding (for MCP UI)

```ts
import { mount } from './embed/mount';
const game = mount('#container'); await game.generateWorld();
```
`new Game(containerElement, options?)` mounts into any element — no `document.body` assumptions, no inline handlers (all `addEventListener`), CSP-compatible, postMessage host API, ResizeObserver-responsive.

## Key File Locations

| Purpose | File |
|---------|------|
| Entry / coordinator | `src/main.ts` · `src/game.ts` (+ `src/game/`) |
| State / types / constants | `src/core/state.ts` · `types.ts` · `constants.ts` |
| Seedable RNG / noise / schema | `src/core/rng.ts` · `noise.ts` · `schema.ts` |
| Snapshot / timeline / events / calendar | `src/core/snapshot.ts` · `timeline.ts` · `events.ts` · `calendar.ts` |
| Content versions (cache-bust) | `src/core/content-version.ts` (`ART_RECIPE_VERSION` + `WORLD_CONTENT_VERSION`) |
| GPU terrain / scene / feature-SDF | `src/render/gpu/terrain-field.ts` · `gpu-scene.ts` · `feature-geometry.ts` |
| Camera / minimap | `src/render/camera.ts` · `minimap.ts` |
| Building/barrier geometry | `src/assetgen/compose.ts` · `geometry/` · `src/world/enclosure.ts` |
| Map generation / autotiler | `src/map/map-generator.ts` · `autotiler.ts` |
| World seeds / schema | `public/data/worlds/default.json` · `src/core/schema.ts` |
| NPC sim / systems | `src/sim/npc-sim.ts` · `src/sim/systems/` |
| Divine actions / spirits | `src/sim/divine-actions.ts` · `src/game/divine-actions-controller.ts` · `src/sim/spirit-system.ts` |
| NPC helpers / lifecycle | `src/world/npc-helpers.ts` · `npc-lifecycle.ts` |
| Mortality / turnover / time-skip | `src/sim/mortality.ts` · `turnover.ts` · `time-skip.ts` |
| LLM client / providers / catalog | `src/llm/llm-client.ts` · `provider-factory.ts` · `openrouter-catalog.ts` |
| LLM backfill / settings | `src/game/llm-backfill.ts` · `src/ui/settings-unified.ts` · `llm-settings-new.ts` |
| Dev / Time-Debug panel | `src/game/dev-mode-controller.ts` · `src/dev/TimeDebugPanel.ts` |

## Development

```bash
npm run dev         # Vite dev server (port 3000)
npm run build       # tsc check + Vite production build
npm test            # all tests (vitest)
npm run bus -- ping # drive a running game from the CLI (needs the tab on ?bridge)
npm run mcp         # stdio MCP server over the running game (.mcp.json → `small-gods`)
npm run lint:world  # evaluate connectome contracts on the default world
```

**Dev bus bridge (out-of-process control).** With the game on `?bridge` (read-only) or `?bridge=rw` (writes), the in-browser `GameBus` seam is published over a WebSocket broker (Vite plugin on `/__bus`) so a CLI (`tools/bus-cli.ts`) or a stdio **MCP server** (`tools/mcp-server.ts`, 16 tools) can drive + inspect a live game. The tab is the *game peer* and does all dispatch (inherits the bus's gating/replay). **DEV ONLY — Fate and the WebGPU UI call `GameBus` in-process and must never round-trip through the bridge.**

## Gameplay Architecture

Phases 7–8 shipped; Phase 9 (LLM backfill) largely shipped; rivals (Track 3) core shipped; Fate (Track 4) ahead — see [ROADMAP.md](docs/ROADMAP.md).

- **NPC sim** ✅ — traits, belief per spirit (faith/understanding/devotion), needs (safety/prosperity/community/meaning), social graph, event ring buffer, mortality + birth + lineage (D1).
- **Divine actions** ✅ — whisper/omen/answer-prayer/dream/miracle, each costs belief-power (= belief × understanding × devotion); understanding gates sign-perception & prayer efficacy. Extended by **belief-granted powers + the divine inbox** (a god's vocabulary = what its believers think it can do).
- **LLM backfill** 🟢 — ~500-token prompt → narrative + JSON delta; runs the **fast/chat tier** (`DEFAULT_CHAT_MODEL`) of the two-tier OpenRouter catalog (`src/llm/openrouter-catalog.ts` is the source of truth for model ids). Remaining: conversation UI + interaction memory.
- **Rival spirits** 🟢 (Track 3) — `RivalSystem` (0.5 Hz) decides from real per-settlement follower data (`buildRivalSituation`) and **claims prayers left unanswered past `PRAYER_CLAIM_WINDOW_TICKS` (120 = half a sim-day)** via the shared `answer_prayer` command path (`src/sim/rival-claims.ts`); contested + lost pleas surface as inbox threats → alert pins. Fate coaches rival stances (`set_rival_stance`). Remaining: rival power-economics tuning, rival-vs-rival contention depth.
- **Fate / DM agent** 🟢 (Track 4) — background LLM on the **capable tier** (`DEFAULT_CAPABLE_MODEL`) via `Game.llmClientCapable`. The codebase calls this layer **"Fate."** LIVE: `FateBrainService` (`src/game/fate/`, async — off the sim tick) woken by `FateTrigger` on significant thread events + sustained rival claim pressure (≥2 claims/sim-day window), cooldown-throttled; 4 constrained drift-guarded tools — `arm_staged_beat` (optionally with a validated `storylet` ref → interactive card on discovery), `nudge_event_severity`, `force_next_event`, `set_rival_stance` (anti-snowball coaching, deltas capped ±0.2 both sides of the LLM boundary). Remaining: pacing/plot intelligence beyond single-beat reactions; the era-authoring half of the D2 skip loop.
</content>
