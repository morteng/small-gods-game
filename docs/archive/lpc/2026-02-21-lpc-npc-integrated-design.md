# LPC NPC Integrated Renderer — Design Doc

**Date:** 2026-02-21
**Status:** Approved

## Overview

Fork the Universal LPC Spritesheet Character Generator into the game. Strip the Mithril UI entirely. Expose a TypeScript API that generates animated spritesheets for any NPC description at runtime. Remove the old GAN sprite pipeline (sprite-generator.ts, sprite-cache.ts, onnxruntime-web).

Sprites are fetched from the LPC generator's GitHub Pages CDN at runtime and cached in memory.

## Fork Structure

Three files copied from the LPC generator into `src/render/lpc/` (vendor JS, not converted to TS):

| File | Change |
|------|--------|
| `src/render/lpc/item-metadata.js` | Unchanged — 657-item catalog |
| `src/render/lpc/renderer.js` | One change: sprite base URL set to GitHub Pages |
| `src/render/lpc/load-image.js` | Unchanged — image loader |

Sprite base URL: `https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/`

## TypeScript API

### `src/render/lpc/character-builder.ts`

```ts
interface CharacterSpec {
  sex: 'male' | 'female' | 'child';
  bodyType: 'male' | 'female' | 'teen' | 'child' | 'muscular';
  items: Record<string, { itemId: string; variant: string }>;
}

// Role presets with seeded per-instance variety
function buildCharacterSpec(role: NpcRole, seed: number): CharacterSpec

// For future LLM/free-form use
function specFromItems(items: Record<string, { itemId: string; variant: string }>): CharacterSpec
```

Role presets define a base appearance per role (farmer=earth tones/tunic, priest=robes, soldier=plate armour, etc.) with seeded randomisation of hair colour, skin tone, and minor clothing variants for per-instance variety.

### `src/render/lpc/spritesheet-cache.ts`

```ts
// Lazy generation + in-memory cache keyed by spec hash
function getOrGenerateSheet(spec: CharacterSpec): Promise<HTMLCanvasElement | null>
```

Calls `renderCharacter(spec.items, spec.bodyType)` from the forked renderer. Caches result; concurrent callers for the same spec share one Promise.

## NPC Types

```ts
// src/core/types.ts additions

type NpcRole = 'farmer' | 'priest' | 'soldier' | 'merchant' | 'elder' | 'child' | 'noble' | 'beggar';
type Direction = 'up' | 'down' | 'left' | 'right';

interface NpcInstance {
  id: string;
  role: NpcRole;
  seed: number;       // stable per-NPC appearance seed (derived from id hash)
  tileX: number;
  tileY: number;
  direction: Direction;
  frame: number;      // 0 = idle stand pose, 1–8 = walk cycle
  frameTimer: number; // ms accumulator
}
```

`GameState` gains `npcs: NpcInstance[]`.

## NPC Spawning

In `game.generateWorld()`, after map generation, iterate `worldSeed.pois[].npcs`:
- Map role string → NpcRole (unknown → `'farmer'`)
- Derive `seed` from NPC id hash
- Place at POI position ± small random walkable offset
- Randomise starting `direction` and `frame`

## Animation System (`src/render/npc-animator.ts`)

```ts
const FRAME_MS = 150; // ~6.7 FPS walk cycle

// Advance frameTimer; on overflow increment frame (1–8, wrapping back to 1)
// Frame 0 (idle) is never auto-advanced
function updateNpcs(npcs: NpcInstance[], deltaMs: number): void

// Pure function: direction → row, frame → sx
// direction: up=2, left=3, down=4, right=5
// sx = frame * 64,  sy = row * 64
function getSpriteCoords(npc: NpcInstance): { sx: number; sy: number }
```

## Rendering

`renderer.ts` signature gains `sheets: Map<string, HTMLCanvasElement>`:

```ts
renderMap(ctx, map, camera, w, h, npcs, sheets)
```

Per NPC (after tiles/POIs/villages):
- Cull off-screen
- Look up sheet from `sheets` map by NPC id
- Skip if sheet not yet ready
- `ctx.imageSmoothingEnabled = false`
- `ctx.drawImage(sheet, sx, sy, 64, 64, screenX, screenY, 32*zoom, 32*zoom)`

## Game Loop (`game.ts`)

- `requestAnimationFrame` loop with `deltaMs`
- Each tick: `updateNpcs(npcs, deltaMs)` → `renderMap(...)`
- Lazy sheet loading: maintain `sheetPromises: Map<string, Promise>` — on first NPC encounter, call `getOrGenerateSheet(buildCharacterSpec(npc.role, npc.seed))` and store Promise; pass only resolved sheets into `renderMap`

## Tech Debt Removed

| File | Action |
|------|--------|
| `src/render/sprite-generator.ts` | Delete |
| `src/render/sprite-cache.ts` | Delete |
| `src/render/renderer.ts` | Remove NpcRenderData, async GAN block, getOrGenerate import |
| `src/core/constants.ts` | Remove NPC_ROLE_TINTS |
| `package.json` | Remove onnxruntime-web |

## Files Changed

| File | Action |
|------|--------|
| `src/render/lpc/item-metadata.js` | Fork from LPC generator |
| `src/render/lpc/renderer.js` | Fork, set sprite base URL |
| `src/render/lpc/load-image.js` | Fork from LPC generator |
| `src/render/lpc/character-builder.ts` | New |
| `src/render/lpc/spritesheet-cache.ts` | New |
| `src/render/npc-animator.ts` | New |
| `src/core/types.ts` | Add NpcInstance, NpcRole, Direction |
| `src/core/state.ts` | Add npcs: NpcInstance[] |
| `src/render/renderer.ts` | Replace async GAN block with sheet draw |
| `src/game.ts` | RAF loop, NPC spawning, lazy sheet loading |
| `src/render/sprite-generator.ts` | Delete |
| `src/render/sprite-cache.ts` | Delete |
| `src/core/constants.ts` | Remove NPC_ROLE_TINTS |
| `package.json` | Remove onnxruntime-web |
