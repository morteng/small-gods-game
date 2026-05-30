# game.ts Decomposition — Design

**Date:** 2026-05-30
**Status:** Approved (design); implementation plan pending
**Author:** brainstorm session

## Problem

`src/game.ts` is a 1444-line god object. The `Game` class mixes nine unrelated
responsibilities: sim/scheduler wiring, world generation, a ~330-line UI/DOM
constructor, a ~190-line `render()`, the four input handlers, the entire dev-mode
toolchain (spawn/undo/redo/delete/inspector-edit/paint), LLM backfill, NPC
spritesheet management, and the RAF loop. `RenderContext` is constructed three
times verbatim; the five divine actions are invoked from two duplicated call
sites (dispatcher handlers and NPC info-panel button callbacks).

`Game` has almost no direct test coverage — only `tests/dom/pause-banner.test.ts`.
The 746 passing tests cover the *units* `Game` wires together, not `Game` itself.

## Goal

Reduce `Game` to a thin coordinator (~250–300 lines) by extracting each cohesive
cluster into a focused, dependency-injected module, and add unit-test coverage
for the newly-isolated logic. Behavior is preserved; verification rests on `tsc`,
the existing 746 unit tests, the new tests, and manual smoke of the running app
after each step.

This is a full decomposition (not "worst offenders first") with added test
coverage, per the chosen scope.

## Approach

**Controller objects owned by Game**, matching the codebase's existing
handle/controller idiom (`Scheduler`, `TimelineController`, `OverlayDispatcher`,
`AssetManager`, the `mountX()`/`createX()` → `Handle` pattern). `Game` keeps
`state`, `scheduler`, `timeline`, the RAF loop, and `destroy()`, and delegates
each cluster to an object it constructs and holds. Dependencies are injected
explicitly (narrow per-module deps, no god-context) so each unit is testable.

Rejected alternatives:
- **Free functions + shared context object** — more functional, but the stateful
  clusters (dev-mode undo stack, UI handle lifecycle, LLM client) have no natural
  home and get awkwardly threaded through; fights the OO-handle grain.
- **Minimal (render + dedup + dev-mode only)** — declined; we want full
  decomposition this cycle.

## Module layout

New modules under `src/game/`:

| Module | Responsibility | Testable core |
|--------|---------------|---------------|
| `game/render-context.ts` | `buildRenderContext(deps): RenderContext` — the single builder | pure mapping |
| `game/frame-renderer.ts` | `FrameRenderer` — owns `render()`'s draw passes | smoke |
| `game/divine-actions-controller.ts` | `DivineActionsController` — unifies the 5 dispatcher handlers and the info-panel button callbacks | cast / power / flash |
| `game/dev-mode-controller.ts` | `DevModeController` — spawn/delete/inspector-edit/paint, dev panels, dev keys; undo/redo as a pure reducer | undo/redo reducer |
| `game/interaction-controller.ts` | the 4 click handlers + dispatch; delegates dev right-clicks to `DevModeController` | selection/pin logic |
| `game/llm-backfill.ts` | `LlmBackfillService` — backfill + 3 helpers | helpers + parse |
| `game/game-ui.ts` | `GameUi` — owns all gameplay UI handles + raw DOM panels + `destroy()` | smoke |
| `game/bootstrap-world.ts` | `bootstrapWorld(deps)` — `generateWorld` body + spritesheet kickoff | — |
| `game/camera-follow.ts` | `applyFollowCamera(state, viewport)` — lerp math | math |

Relocations (cleanup, not new modules):
- `simStateFromEntity` → `@/world/npc-helpers` (beside `toRenderNpc`)
- `updateNpcFrames` → `@/render/npc-animator` as `advanceNpcFrames(world, deltaMs)`

## Ownership split

- **`GameUi`** owns *gameplay* UI: paused banner, debug HUD, NPC info panel,
  tooltip, LLM display, unified settings, main menu, tutorial, spirit HUD, rival
  panel, minimap, divine effects, LLM-settings button, chrome, veil, time chip,
  placement modal.
- **`DevModeController`** owns *everything dev-scoped*: dev-mode state + button,
  inspector / debug-overlay / time-debug / entity-spawner / map-editor /
  world-inspector panels, dev keyboard shortcuts, and all
  spawn/undo/redo/delete/edit/paint logic.

This keeps the entire dev toolchain isolated and independently removable, and
prevents `GameUi` from becoming a second god object.

## Wiring & data flow

`Game` constructs everything and injects narrow deps. Three pieces of mutable
per-frame state cross module boundaries — `overlayHitAreas`, `poiOverlay`,
`hover{Tile,Screen}` — and live in one shared `InteractionState` object that
`FrameRenderer` writes and `InteractionController` reads. The whisper "gold flash"
timestamp moves into `DivineActionsController` (the thing that triggers it).

The RAF loop stays in `Game` as its heartbeat:
`scheduler.tick → applyFollowCamera → renderer.render → ui refreshes`.

`Game.generateWorld()` becomes a thin wrapper: `await bootstrapWorld(...);
this.startLoop();`.

### Dependency-injection shape

Modules receive narrow deps rather than the whole `Game`. Render-context
consumers receive `{ state, viewport, sheets, assets, decorationImages, devMode }`.
`buildRenderContext` requires `world` present; the three former call sites already
guard for that. `FrameRenderer` receives the UI handles it draws into plus the
`DivineActionsController` (for info-panel callbacks) and the shared
`InteractionState`. `DevModeController` receives the dev panel handles, `state`,
and `world` mutators. `LlmBackfillService` receives `state`, `llmDisplay`,
`eventLog`, and an injectable provider.

## Cleanups folded in

- `RenderContext` built 3× → 1×.
- Divine-action call sites 2× → 1× (dispatcher + info-panel share
  `DivineActionsController`).
- Delete the commented-out `showNarrationPopup` dead block.
- Make the LLM provider injectable into `LlmBackfillService` — turns the hardcoded
  `MockLLMProvider(100)` into a deliberate seam (real wiring stays out of scope).

## Out of scope

- Retiring the `NpcSimState` / `toRenderNpc` legacy adapters entirely (tracked as
  issue #4) — they are relocated, not removed.
- Real LLM provider wiring beyond exposing the injection seam.
- Time Debug snapshot/inject.
- `npc-info-panel` dark→light palette migration.

## Testing plan

New `tests/unit/` files:
- `render-context.test.ts` — `buildRenderContext` maps state → RC correctly.
- `dev-mode-undo.test.ts` — pure undo/redo reducer over
  create/delete/update/tile sequences.
- `divine-actions-controller.test.ts` — cast respects power, sets flash time,
  registers dispatcher handlers (divine-effects stubbed).
- `camera-follow.test.ts` — follow lerp math.
- `llm-backfill.test.ts` — `getNearbyNpcNames` region query,
  `getActiveEventsForPoi`, `parseLLMJson`.
- `interaction-controller.test.ts` — `onTileClick` selection toggle / pin logic.

Plus `tests/dom/game-ui.test.ts` — jsdom smoke: mount → `destroy()` removes all
nodes (matches the `pause-banner.test.ts` precedent).

Heavier visual behavior (`FrameRenderer` draw output, dev panel rendering) is
verified by manual smoke of the running app, not unit tests.

## Sequencing

Bottom-up so the suite stays green at every commit. Each step:
`tsc` clean + 746 (+new) tests green + manual smoke + commit.

1. `buildRenderContext` + dedup → test
2. relocate `simStateFromEntity` + `advanceNpcFrames`
3. `camera-follow` + `llm-backfill` (low coupling) → tests
4. `DivineActionsController` (unify call sites) → test
5. `DevModeController` (+ pure undo/redo) → test
6. `FrameRenderer`
7. `InteractionController`
8. `GameUi`
9. `bootstrapWorld` → `Game` now thin

## Risks & verification

- `Game` has near-zero direct tests → rely on `tsc` + the 746 unit tests + the new
  tests + manual smoke after each commit.
- Environment gotcha (per handoff): Claude's temp dir intermittently
  corrupts/truncates tool output because pi.dev runs in this repo. Run `tsc`/`test`
  as background tasks and read the `.output`; stop editing when reads degrade.

## Success criteria

- `src/game.ts` ≤ ~300 lines, containing only construction/wiring, the RAF loop,
  `resize`, `generateWorld` wrapper, and `destroy`.
- All extracted modules compile and the full suite (746 + new) passes.
- `RenderContext` and divine-action invocation each have a single source.
- New unit tests cover the extracted logic listed above.
