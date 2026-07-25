# Abilities — cast targeting, area effects, and the Hall of the Gods (plan)

**Date:** 2026-07-26 · **Branch:** `feat/abilities-v1` off `main` · **Mode:** Opus orchestrator + builders
**Closes:** the "Targeting UX" honest deferral in
`docs/superpowers/specs/2026-06-18-belief-powers-divine-inbox-design.md` §10, and the
"area targets" NEXT of the agent-driven-UI epic.
**User intent (verbatim):** *"if a player's god character gains the ability to smite they get a
lightning button to click, and then click target for a lightning strike. same for rain, click a
raincloud button, place cloud. click+drag for area effects."* Skill screen direction: *"hall of
the gods / cloudy sky"* — Skyrim's readable node-path STRUCTURE, explicitly NOT its starfield skin.

---

## 0. What recon established (read this before touching anything)

Three thorough recon passes (targeting/input, command/sim, UI conventions) mapped every seam.
Cast-targeting is **~70% built** (semantic-zoom P2c): `InteractionState.targeting`,
`Game.castPower` (`game.ts:1013`), `resolveTargetedCast` (`:1028`), `resolveTargetAt` (`:1206`),
and a "◎ CHOOSE A TARGET" hint bar (`ui-runtime.ts:822`) all ship today. The plan is mostly
*finishing and un-shadowing* an existing flow, then extending the target model.

Sim-side, the big free win: `WaterDynamics.floodArea(tileX, tileY, radius, depthM)`
(`src/render/gpu/water-dynamics.ts:356`) already places water on an arbitrary disc — it just
isn't on the `WeatherStepper` interface (`src/sim/water/weather-stepper.ts:66` only has
`floodPoi`). Downstream is already location-generic: `WeatherSystem` → `CausalSiteStore` births
a named causal site for any flood off-POI and `seedSiteBelief` attributes belief by proximity.

**Line numbers below are from recon on 2026-07-26 `main` (167dd995) — re-verify before editing;
they are pointers, not gospel.**

## 1. Product decisions (made — do not relitigate)

1. **CAST always arms the reticle.** Kill the auto-pick fast path (`game.ts:1016-1019`) that
   instantly fires at the selected NPC — it shadows the whole feature. A selected NPC may
   *pre-highlight* under the reticle but the player's click decides.
2. **An invalid click does NOT exit aim.** Today `resolveTargetedCast` clears `targeting`
   unconditionally (`:1030`) — silent miss. New behaviour: stay armed, flash the hint bar
   ("NOTHING THERE TO STRIKE"), exit only on success / Esc / right-click.
3. **Area MVP = widen `summon_storm`**, no new verb: `targetKinds: ['settlement','area']`,
   `footprint: 'area'`. Reuses the flood-domain unlock; avoids the DOMAIN_DEFS one-verb-per-domain
   refactor AND the `derive.ts:44` unlocked-by-default trap for unmapped verbs.
4. **Cast FX move to the event log.** `fireCastFx` currently lives in `emitDivine`
   (`game.ts:1093`) so MCP/agent casts are invisible — wrong for the player-agent-control
   direction. FX subscribe to the same event stream regardless of who cast.
5. **Hall of the Gods (phase C) is BLOCKED until `feat/ui-v3` merges to main.** Its shell/screen
   surface is under active construction by another orchestrator. Do not start it; ship A+B.

## 2. Phase A — the cast loop feels like casting (builder-sized slices)

**A1 — arm-always + honest misses.** Remove the auto-pick (`game.ts:1016-1019`). Widen
`TargetingMode` (`src/game/interaction-state.ts:2-14`) to
`{ verb, label, targetKinds, footprint, anchor? }` (data comes from the registry via
`acceptedTargetKinds`/`capFootprint`, not from `beliefPowers`). Misses keep aiming (decision 2).

**A2 — a real reticle.** World-space reticle on the existing 2D overlay canvas (same layer as
`src/render/divine-effects.ts`, rendered from `frame-renderer.ts:84-86`, alive in barebones mode).
Requirements: project through the lift-aware pick env (`getPickEnv`, `game.ts:714`) so the ring
sits on the tile the click would actually hit on slopes; scale with the quantized zoom rung;
valid/invalid tint (gold vs dim ink) from a lightweight "would `resolveTargetAt` accept this"
read on hover — do NOT reuse `hoverFrozen`/`inspectorFrozen` (they update on dwell/draw, not
move). Note `hoverAffordances()` returns null while targeting (`game.ts:1053`) — correct,
keep it; the reticle replaces the popover during aim.

**A3 — Esc cancels aim, not opens pause.** The capture-phase Esc handler
(`ui-runtime.ts:610-617`) must check targeting FIRST: add hook `onCancelTargeting?: () => boolean`
ahead of `dismissCard`/`toggleMenu`, same precedence pattern as `this.card`. Right-click cancel
(`game.ts:686,690`) stays. While aiming, the POWERS panel must not eat world clicks: auto-close
the panel on arm (`this.panel = null` on `onCastPower`) — simplest fix for the 360px dead strip.

**A4 — one-path FX.** Move `fireCastFx` from `emitDivine` to an event-log subscription (the
smite event already carries x/y). Add the missing **storm/summon_storm effect** to
`divine-effects.ts` (there is none — a cast storm renders nothing today). Effects stay
deterministic (fixed zigzag offsets pattern — no RNG on the render path).

**A5 — hint bar honesty.** `getTargeting` hook (`ui-runtime.ts:80`) returns only `{label}`;
widen to the full `TargetingMode` view so the bar can say what kinds are accepted and (phase B)
show the drag radius + scaled cost.

Tests A: CAST arms without firing when an NPC is selected; invalid click keeps aiming;
Esc-cancels-targeting-before-menu precedence; each target kind resolves; a bus-emitted
(`emit_command`) smite triggers the same FX as a clicked one.

## 3. Phase B — area targets + the raincloud

**B1 — the `area` arm.** `{ kind: 'area'; x: number; y: number; radius: number }` on
`CommandTarget` (`src/sim/command/types.ts:41-46`). Validation in ONE place —
`previewCommand` (`command-system.ts:38-40`): bounds-check centre, clamp radius (2..12 tiles).
`targetLabel` arm (`registry.ts:87-95`).

**B2 — weather contract.** Add `floodArea(x, y, radius, depthM): number` to `WeatherStepper`
(`weather-stepper.ts:66`) — the WaterDynamics impl already exists; delete the structural-narrowing
hack in `src/dev/debug-api.ts:292-298`. New `summonStormAt(spirit, x, y, radius, weather, log)`
in `divine-actions.ts` beside `summonStorm`; registry apply branches on target kind (template:
smite's multi-kind apply, `registry.ts:184-194`). Event shape: `summon_storm` gets
`poiId?` + `x?/y?/radius?` (exactly the shape `smite` already took, `core/events.ts:27` vs `:103`);
keep the settlement path (`seedFloodBelief`) and let the area path ride causal sites +
`seedSiteBelief` (already works). Consumers (`chronicle-prompt-builder.ts:258,337`,
`interest-predicate.ts:73,127`) need a place-name fallback for poiId-less storms.

**B3 — radius-scaled cost, honestly.** Area-neutral formula:
`cost = SUMMON_STORM_COST × (radius/6)²` (r=6 is today's hardcoded disc). Do NOT copy the
`probe_mind` pattern (declared cost 0, real cost hidden in precondition — the preview lies).
Widen `CapabilityDef` with optional `costFor?(cmd): number`; `previewCommand`/`derivePreview`
use `costFor ?? cost`. `CapabilityView` stays JSON-serializable: keep static `cost` (the base)
and ADD `footprint` so UI + agents can discover drag verbs (`game-bus.ts:25-34`; the exact-object
pin in `tests/unit/game-bus.test.ts:71-80` updates in the same commit).

**B4 — the drag.** `attachControls` (`src/ui/controls.ts:95-149`) treats every left-drag as
camera pan and only clicks under 3px travel. Add a capture path: when
`targeting?.footprint === 'area'`, left-down anchors the disc, drag grows the radius (live disc
preview on the overlay: ring + translucent fill + cost readout in the hint bar), release emits
with the clamped radius; camera pan is suppressed for that gesture only. A plain click (sub-3px)
in area mode = minimum radius. New callback seam (e.g. `shouldCaptureDrag()` + `onDragArea`)
wired at `game.ts:681-692` — do not overload the 3px threshold.

**B5 — the cloud reads as a cloud.** `WaterDynamics.seedClouds` is global-only; add a
`cloudArea(x, y, radius, amount)` sibling so the placed raincloud is visible over its disc, and
give `divine-effects.ts` a storm effect (B/A4 can share it). MCP: add `'area'` to the
`targetShape` zod enum + `radius` field + `buildTarget` arm (`tools/mcp-server.ts:202-217`) —
an agent placing a raincloud must be exactly one `emit_command`.

**Pinned tests that WILL break (update deliberately, same commit as the change):**
`command-registry.test.ts` (ALL_VERBS/29-length/per-verb shapes) · `game-bus.test.ts:71-80`
(exact CapabilityView object) · `smite-targeting.test.ts:105-111` (tile affordances exactly
`['smite']` — adding area-capable verbs to tile changes this ONLY if summon_storm accepts
`tile`; it should NOT — area ≠ tile) · `hover-affordances.test.ts:79-113` (top-3 ranking pins) ·
`summon-storm.test.ts` (poiId pins + mock stepper) · the four `WeatherStepper` mock stubs
(weather-system / memory-ring / summon-storm / castle-sim-adoption tests) ·
`sim-event-boundary.test.ts` if any NEW event type is added (prefer widening `summon_storm`'s
payload instead). `bus-bridge-protocol.test.ts:13` mock cap gains `footprint`.

## 4. Phase C — Hall of the Gods (**BLOCKED — do not build; design contract only**)

The powers screen is a **shell screen** (`feat/ui-v3` architecture) drawn over the animated sky:
the divine realm above the clouds, one **pedestal/alcove per belief domain**, materializing with
conviction — hazy silhouette at low belief, solid lit marble at doctrine. Node paths between
pedestals carry the CLAIM → COMMAND → DOCTRINE ripening (spec §3) with Skyrim's at-a-glance
readability. The ascent transition (separately briefed to the UI v3 orchestrator) is the entrance.

Contract for when it unblocks (after `feat/ui-v3` merges):
- Follow the four-step shell recipe (ScreenId + `SCREEN_IDS` allowlist, pure module,
  one `Shell.draw` case, `Shell.describe()` entry derived from the same row function).
- Content = the existing `beliefPowers` projection ONLY (the single-legibility-payload law);
  extend `BeliefPowerView` if the hall needs tier-node data — never a parallel projection.
- Rendering: start with scrim + UI-pass composition (rects + `✦`/`⚡` glyphs are in the pixel
  font); a `line()`/rotated-quad primitive in `ui-batcher.ts` is allowed WITH its own pixel test;
  a "hall mode" sky variant can take the free pad float in `SGlobals` — do not resize the struct.
- Shell type tiers only (`shellTypeScaleFor`; `FS.body` is HUD-only); gold is for
  interactive-and-divine marks, not wall-to-wall decoration; every glyph in the pixel-font table.
- Entry point: pause screen (exists after ui-v3 P6) or `open_screen`; keybind optional.

## 5. Orchestration & guardrails

- **Worktree + branch `feat/abilities-v1` off `main`.** The UI v3 orchestrator is live on
  `feat/ui-v3` editing `game.ts` (hooks block), `shell/*`, `ui-runtime.ts` — keep every `game.ts`
  / `ui-runtime.ts` diff surgical, never touch `src/render/ui/shell/` or `src/render/ui/kit/`,
  and expect to rebase onto main after ui-v3 merges, BEFORE this branch merges.
- Builders: spawn per-slice with clear briefs; A1+A3 (state machine + input) / A2+A4 (overlay
  rendering) / B1-B3 (sim/command) / B4-B5 (drag + visuals) are natural seams. Verify each
  slice with the real game (dev server :3000, `__debug.grab()` — not page.screenshot).
- **Sim law:** everything under `src/sim/` stays `Math.random`-free and import-cycle-free
  (leaf-module + repoint pattern). Overlay/reticle rendering is Canvas2D — fine; no new DOM.
- `npm run lint` stays ZERO (never `--fix`). Full gate before any push:
  `./scripts/ci-on-server.sh`, grep `✓ Server CI passed`, commit first, never chain `; git push`.
- Commit style: small, one concern per commit, explicit paths (never `git add -A`).
- Do NOT merge to main autonomously — when A+B are green and live-verified, report back for
  the merge decision (ui-v3 ordering).
