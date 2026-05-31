# Phase 8: Divine Actions (Minimal) — Design Doc

**Date:** 2026-02-21
**Status:** Approved
**Scope:** Whisper action + power pool + corner HUD

---

## Overview

Phase 7 gave NPCs internal sim state (beliefs, needs, mood). Phase 8 gives the player something to *do* with it: spend divine power to influence NPC faith through the **Whisper** action, and see their power pool in a persistent corner HUD.

Scope is deliberately minimal — one action, one display. The architecture is designed to extend to the full set of five divine actions in Phase 9+.

---

## Power Pool

`playerPower: number` added to `GameState`.

**Regeneration (each sim tick, ~1s):**
```
regen = Σ(belief.faith × belief.understanding × belief.devotion) across all NPCs
playerPower += regen × POWER_REGEN_RATE   // POWER_REGEN_RATE = 0.05
playerPower = clamp(playerPower, 0, POWER_MAX)  // POWER_MAX = 20
```

Power starts at 0 — the player must wait for NPCs to accumulate belief before acting. With a newly-generated world (low faith, low understanding, low devotion), regen is very slow. Performing a successful whisper boosts faith, which accelerates regen — positive feedback loop.

**Cost:** Whisper costs `WHISPER_COST = 1.0` power units.

---

## Whisper Action

### Effect on target NPC
- `faith += 0.15` (clamped 0–1)
- `understanding += 0.03` (clamped 0–1)
- Push `"Whispered to by the player"` into `NpcSimState.recentEvents` (ring buffer, max 5)

### Cooldown
- Per-NPC cooldown: `whisperCooldown: number` (ms countdown on `NpcSimState`)
- `WHISPER_COOLDOWN_MS = 5000` (5 seconds)
- Button grayed out + shows "..." while cooling down

### Guard conditions (button disabled when)
- `playerPower < WHISPER_COST`
- `sim.whisperCooldown > 0`

---

## UI

### Corner HUD (`src/render/hud.ts`)
- Position: top-left, 12px from edges
- Always visible after world generation
- Contents: power icon + `"4.2 / 20"` text + thin horizontal bar
- Bar color: gold (`#FFD54F`) filling to `power/maxPower`
- Dims to 60% opacity when power < 1 (can't afford any action)

### Whisper Button (on NPC overlay card)
- Added below the BELIEF section in `sim-overlay.ts`
- Label: `"✦ Whisper  [-1⚡]"`
- Grayed + label `"✦ Whisper  [cooldown]"` when on cooldown
- Grayed + label `"✦ Whisper  [no power]"` when insufficient power
- Click handled in `game.ts` via overlay hit-test

---

## Data Model Changes

### `NpcSimState` additions
```ts
recentEvents:    string[];   // ring buffer, max 5
whisperCooldown: number;     // ms remaining, ticks down each game loop frame
```

### `GameState` addition
```ts
playerPower: number;
```

---

## New Files

| File | Purpose |
|------|---------|
| `src/sim/divine-actions.ts` | Pure `whisperNpc(sim): void` function + constants |
| `src/render/hud.ts` | `drawPowerHud(ctx, power, maxPower, w, h)` |

## Modified Files

| File | Change |
|------|--------|
| `src/core/types.ts` | Add `recentEvents`, `whisperCooldown` to `NpcSimState` |
| `src/core/state.ts` | Add `playerPower: number` to `GameState` |
| `src/sim/npc-sim.ts` | Power regen in `tickAllNpcs`, cooldown tick in `tickNpcSim` |
| `src/render/sim-overlay.ts` | Whisper button with hit-test rect returned |
| `src/game.ts` | Wire power regen, cooldown tick, click handler on overlay button |

---

## Constants

```ts
WHISPER_COST        = 1.0
WHISPER_FAITH_BOOST = 0.15
WHISPER_UNDERSTANDING_BOOST = 0.03
WHISPER_COOLDOWN_MS = 5000
POWER_REGEN_RATE    = 0.05
POWER_MAX           = 20
```

---

## Out of Scope (Phase 8)

- Omen, answer prayer, dream, miracle (Phase 9+)
- Domain tag tracking
- Event ring buffer used by LLM (Phase 9)
- Rival spirit reactions
- Belief propagation along social graph
