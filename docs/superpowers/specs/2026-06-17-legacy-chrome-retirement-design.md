# Legacy-chrome retirement — converging on one UI

**Status:** BRAINSTORM (no code). Scoped after WebGPU-UI S1+S2 + connectome consolidated to `main`.
**Date:** 2026-06-17
**Origin:** user — after the WebGPU-UI epic (S1 foundation + S2 barebones HUD/pause menu)
landed, "time to refactor after merging this work so far?" Decision: consolidate first,
then scope the refactor as its own epic. This is that scope.

## 1. The problem: two UI systems, maintained in parallel

S2 made the WebGPU-native immediate-mode UI (`src/render/ui/`) the **default** chrome and
introduced transitional scaffolding so the old DOM/Canvas2D chrome could be **suppressed but
kept alive** behind flags:

- `Game.barebones = !hasQueryFlag('legacyui')` (`src/game.ts:133`) — the master switch.
- `FrameRenderer.legacyChrome` (`src/game/frame-renderer.ts:50`) — gates the **on-demand**
  Canvas2D/DOM chrome at its render sites: the Canvas2D power pill (`drawPowerHud`), the hover
  tooltip, and the NPC/building info panels.
- `GameUi.suppressLegacyChrome()` (`src/game/game-ui.ts:218`) — tears down the **always-mounted**
  DOM panels in one place.

This is healthy transitional debt — but it IS debt. Every chrome feature now has (or will need)
two implementations, two code paths, and the `?legacyui` escape hatch keeps the dead one
compiling and shipping. The endgame the WebGPU-UI epic mandated is **one** UI: drive the GPU UI
to parity, then delete the DOM/Canvas2D chrome and all three suppression seams.

## 2. Inventory: what's replaced, what's still DOM-only

From `suppressLegacyChrome()` + the `legacyChrome` gates, the legacy chrome splits three ways:

### A. Already replaced by WebGPU UI (delete once flags go)
| Legacy surface | Replacement |
|---|---|
| `pausedBanner` (DOM) | WebGPU pause menu (S2) |
| `bottomLeftBar` + `spiritHud` (DOM) | bottom-left power **orb** / menu button (S2) |
| Canvas2D power pill (`drawPowerHud`) | the orb's power-fill readout (S2) |
| settings (`unifiedSettings` DOM) | GPU pause-menu settings panel + `SettingsIsland` DOM text-input island (S2) |

### B. Still DOM-only — no WebGPU equivalent yet (the real work)
| Legacy surface | Notes |
|---|---|
| hover **tooltip** (DOM) | NPC + building + dev tooltips; follows cursor |
| **npcInfoPanel** (DOM) | NPC focus detail |
| **buildingInfoPanel** (DOM) | building focus detail |
| **rivalPanel** (DOM) | rival-spirit status |
| **cameraControls** (DOM zoom/fit buttons) | currently just destroyed in barebones — **a functional regression** until ported |
| **minimap** (summonable) | still the only minimap surface |
| narration card (`llmDisplay`) | the LLM backfill narrative card — still the only surface |
| **placementModal** / decoration modal | divine-action placement UI |
| `debugHud` | dev-only (`?dev`); low priority, can stay DOM |

### C. Stays DOM by design (the "DOM island" pattern)
Typed text input (API keys, model ids) — a canvas can't do text entry. `SettingsIsland`
(`src/render/ui/ui-settings-island.ts`) already floats a DOM form over the GPU settings panel,
positioned per-frame from the canvas layout. This pattern is the sanctioned exception; any future
text entry reuses it rather than reviving a DOM panel.

## 3. WebGPU UI primitives available today

`UiContext` (`src/render/ui/ui-context.ts`) is a Dear-ImGui-style immediate-mode API:
`panel/rect/label/button/hotspot/hot`, 5×7 atlas-free `pixel-font`, oklch palette. `UiRuntime`
(`src/render/ui/ui-runtime.ts`) owns the menu/HUD lifecycle and input. This covers panels,
labels, buttons, and hover hotspots — enough for tooltips, info panels, the rival panel, and
camera buttons. Gaps to confirm during slicing: scroll/clipping for long content, cursor-anchored
floating placement (tooltip), and a minimap render target.

## 4. Guiding principles

1. **Parity before deletion.** Never delete a DOM surface until its GPU replacement reaches
   functional parity — otherwise barebones regresses (the camera-controls destroy is already a
   live example of "suppressed before replaced").
2. **One seam dies last.** Keep `barebones`/`legacyChrome`/`suppressLegacyChrome` + `?legacyui`
   until *every* B-row surface is ported; then remove all three in one commit so there's never a
   half-flagged tree.
3. **DOM islands only for text input.** Everything else renders on the GPU.
4. **Test parity per surface.** Each ported surface gets a CPU-rasteriser pixel test (the S1/S2
   pattern — Playwright can't read back WebGPU here) before its DOM twin is removed.

## 5. Slicing (parity-first; each slice deletes its DOM twin)

- **L0 — fix the regression:** port `cameraControls` (zoom in/out/fit/actual) to GPU buttons,
  delete the DOM control + its `destroy()` in barebones. Smallest, removes a live regression.
- **L1 — tooltip:** cursor-anchored GPU tooltip (NPC/building/dev text), delete the DOM tooltip
  + the `legacyChrome` tooltip block in `frame-renderer`.
- **L2 — focus panels:** NPC info + building info as GPU panels; delete `npcInfoPanel` /
  `buildingInfoPanel` + their render-site gates.
- **L3 — rival panel:** GPU port; delete `rivalPanel`.
- **L4 — narration card + placement modal:** the two richest surfaces (`llmDisplay`,
  `placementModal`); narration may want scrolling text — validate the primitive first.
- **L5 — minimap:** GPU minimap (own render target / downsampled terrain); delete the DOM minimap.
- **L6 — flag teardown:** with B fully ported, delete `barebones`, `legacyChrome`,
  `suppressLegacyChrome()`, `?legacyui`, `drawPowerHud`, and the now-orphaned DOM panel classes.
  `debugHud` may stay DOM under `?dev` (call it out, don't silently keep it).

## 6. Convergence: world-style S4 lands HERE, not in DOM

The world-style epic's **S4 "live World Style panel"** (two preset dropdowns + per-knob slider
tray) must be built as a WebGPU UI panel using the `SettingsIsland` pattern for any typed
fields — NOT as fresh DOM chrome. Sequence S4 after L4 (settings/panel patterns proven) so it
reuses them instead of inventing a parallel surface. This is the main cross-epic dependency.

## 7. Recommended MVP

**L0 + L1.** L0 erases the only functional regression barebones currently has; L1 (tooltip) is
the most-used surface and proves cursor-anchored floating placement on the GPU — the one
primitive gap most likely to need new batcher work. Ship those, reassess appetite for L2–L6.

## 8. Open questions
- Does `UiContext` need scroll/clip regions before L4 (narration) and L5 (minimap)? Likely yes —
  may warrant a small "S3" primitive slice in the WebGPU-UI epic first.
- Minimap: GPU render-to-texture vs. a cheap downsampled terrain blit composited as a UI quad?
- Keep `debugHud` as DOM-under-`?dev` permanently, or fold into a GPU dev overlay (the parked
  `feat/gpu-stats-hud` branch is adjacent prior art)?
