# LPC NPC Characters — Design Doc

**Date:** 2026-02-21
**Status:** Approved

## Overview

Pre-generated LPC spritesheets for 8 NPC roles. Stationary NPCs with idle and 4-directional walk animations. Replaces the async GAN sprite approach from the previous session (tech debt cleanup included).

## Assets

8 PNGs pre-generated from the Universal LPC Spritesheet Character Generator, saved to `public/sprites/`:

| File | Role |
|------|------|
| `npc-farmer.png` | Farmer — earth tones, work clothes |
| `npc-priest.png` | Priest — robes, religious colours |
| `npc-soldier.png` | Soldier — armour, weapon |
| `npc-merchant.png` | Merchant — fine clothes, bag |
| `npc-elder.png` | Elder — grey hair, staff |
| `npc-child.png` | Child — small body base |
| `npc-noble.png` | Noble — ornate clothing |
| `npc-beggar.png` | Beggar — ragged clothes |

**Format:** Standard LPC, 64×64px per frame.
**Render size:** 32×32px world-space (2×2 tiles). `imageSmoothingEnabled = false`.

**LPC row layout used:**
- Row 2: walk up (9 frames)
- Row 3: walk left (9 frames)
- Row 4: walk down (9 frames)
- Row 5: walk right (9 frames)
- Frame 0 of each row = idle/stand pose

## Types

```ts
// src/core/types.ts additions

type NpcRole = 'farmer' | 'priest' | 'soldier' | 'merchant' | 'elder' | 'child' | 'noble' | 'beggar';
type Direction = 'up' | 'down' | 'left' | 'right';

interface NpcInstance {
  id: string;
  role: NpcRole;
  tileX: number;
  tileY: number;
  direction: Direction;
  frame: number;       // 0–8; 0 = idle stand pose
  frameTimer: number;  // ms accumulator since last frame advance
}
```

`GameState` gains `npcs: NpcInstance[]`.

## NPC Spawning

In `game.generateWorld()`, after map generation:
- Iterate `worldSeed.pois` → each POI's `npcs` array
- Map NPC `role` string to `NpcRole` (unknown roles → `'farmer'`)
- Place at POI position ± small random offset (within walkable tiles)
- Randomise starting `direction` and `frame` so NPCs aren't in sync

## Animation System (`src/render/npc-animator.ts`)

- `FRAME_MS = 150` — ~6.7 FPS walk cycle
- `updateNpcs(npcs: NpcInstance[], deltaMs: number): void` — advances `frameTimer`; on overflow increments `frame` (1–8, wrapping), resets timer. Frame 0 (idle) is never auto-advanced.
- `getSpriteCoords(npc: NpcInstance): { sx: number; sy: number }` — pure function:
  ```
  direction → row: up=2, left=3, down=4, right=5
  sx = frame * 64
  sy = row * 64
  ```

## Rendering

**Game loop** (`game.ts`):
- `requestAnimationFrame` loop with `deltaMs`
- Calls `updateNpcs` then `renderMap` each tick
- Loop starts after map loaded, stops on `destroy()`

**Spritesheet loading** (`game.ts`):
- `loadSpritesheets(): Promise<Map<string, HTMLImageElement>>` — loads all 8 PNGs via `new Image()`
- Resolves when all images ready
- Passed into `renderMap` as parameter

**NPC drawing** (`renderer.ts`):
- After tiles/POIs/villages
- Cull off-screen NPCs
- `ctx.imageSmoothingEnabled = false`
- `ctx.drawImage(sheet, sx, sy, 64, 64, screenX, screenY, 32 * zoom, 32 * zoom)`

## Tech Debt Removed

- Delete `src/render/sprite-generator.ts`
- Delete `src/render/sprite-cache.ts`
- Remove `NpcRenderData`, async GAN block, `getOrGenerate` import from `renderer.ts`
- Remove `onnxruntime-web` from `package.json` (belongs in future GAN-portraits session)
- Remove `NPC_ROLE_TINTS` from `constants.ts` (replaced by spritesheet visuals)

## Files Changed

| File | Action |
|------|--------|
| `public/sprites/npc-*.png` | Create — 8 LPC spritesheets (manual step) |
| `src/core/types.ts` | Add `NpcInstance`, `NpcRole`, `Direction` |
| `src/core/state.ts` | Add `npcs: NpcInstance[]` to `GameState` |
| `src/render/npc-animator.ts` | Create — frame update + sprite coords |
| `src/render/renderer.ts` | Replace async GAN block with spritesheet draw |
| `src/game.ts` | Add RAF loop, `loadSpritesheets()`, NPC spawning |
| `src/render/sprite-generator.ts` | Delete |
| `src/render/sprite-cache.ts` | Delete |
| `src/core/constants.ts` | Remove `NPC_ROLE_TINTS` |
| `package.json` | Remove `onnxruntime-web` |
