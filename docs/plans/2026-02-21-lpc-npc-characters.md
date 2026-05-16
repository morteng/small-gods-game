# LPC NPC Characters Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 8 animated NPC character variants to the map using pre-generated LPC spritesheets, with 4-directional idle poses, replacing the GAN sprite tech debt.

**Architecture:** Pre-generated LPC PNG spritesheets (64×64 per frame) are loaded at game start and drawn synchronously at render time. NpcInstance objects in GameState hold each NPC's position and animation state. A pure-function animator module computes spritesheet coordinates from NPC state. Stationary NPCs face a fixed direction and hold frame 0 (idle stand pose) indefinitely.

**Tech Stack:** TypeScript, Canvas 2D `drawImage`, Universal LPC Spritesheet Character Generator (manual asset step)

---

## ⚠️ Manual Step: Generate Spritesheets

Before writing any code, generate the 8 NPC spritesheets from the LPC generator:

**URL:** https://gaurav.munjal.us/Universal-LPC-Spritesheet-Character-Generator/

**Download settings for each:**
- Export: click "Download" (PNG, standard 64×64 format)
- Save to: `public/sprites/npc-<role>.png`

| Role | Body | Clothing suggestions |
|------|------|---------------------|
| `farmer` | Adult, mid skin tone | Simple shirt, trousers, no armour |
| `priest` | Adult, light skin | Robe (purple or white), no weapon |
| `soldier` | Adult, any skin | Chainmail/plate, sword or spear |
| `merchant` | Adult, any skin | Fine tunic, cape, no weapon |
| `elder` | Adult (grey hair if available), light | Simple robe, staff |
| `child` | Child base if available, else adult | Simple tunic |
| `noble` | Adult, light skin | Ornate tunic, cape, crown |
| `beggar` | Adult, any skin | Ragged/minimal clothing |

Confirm 8 files exist in `public/sprites/` before proceeding.

---

## Task 1: Tech Debt Cleanup

**Files:**
- Delete: `src/render/sprite-generator.ts`
- Delete: `src/render/sprite-cache.ts`
- Modify: `src/render/renderer.ts`
- Modify: `src/core/constants.ts`
- Modify: `package.json`

**Step 1: Delete the GAN sprite files**

```bash
rm src/render/sprite-generator.ts src/render/sprite-cache.ts
```

**Step 2: Remove onnxruntime-web from package.json**

In `package.json`, remove the entire `"dependencies"` block (it only contains `onnxruntime-web`):

```json
{
  "name": "small-gods-game",
  ...
  "devDependencies": {
    ...
  }
}
```

Then run:
```bash
npm install
```

**Step 3: Remove NPC_ROLE_TINTS from constants.ts**

In `src/core/constants.ts`, delete these lines:

```ts
/** NPC role tint colors for sprite palette overlay (multiply blend) */
export const NPC_ROLE_TINTS: Record<string, string> = {
  farmer:   '#A5D6A7', // green
  priest:   '#CE93D8', // purple
  soldier:  '#EF9A9A', // red
  merchant: '#FFE082', // gold
  elder:    '#90CAF9', // blue
  default:  '#FFFFFF', // no tint
};
```

**Step 4: Clean up renderer.ts**

Replace the current `src/render/renderer.ts` content with this clean version (removes NpcRenderData interface, getOrGenerate import, and async GAN drawing block):

```ts
import type { GameMap, Camera } from '@/core/types';
import { TILE_SIZE, TILE_COLORS, BG_COLOR, POI_ICONS } from '@/core/constants';

/** Render the map to a canvas context */
export function renderMap(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
): void {
  // Clear
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.save();
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  // Determine visible tile range
  const startX = Math.max(0, Math.floor(camera.x / TILE_SIZE) - 1);
  const startY = Math.max(0, Math.floor(camera.y / TILE_SIZE) - 1);
  const endX = Math.min(map.width, Math.ceil((camera.x + canvasWidth / camera.zoom) / TILE_SIZE) + 1);
  const endY = Math.min(map.height, Math.ceil((camera.y + canvasHeight / camera.zoom) / TILE_SIZE) + 1);

  // Draw tiles
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const tile = map.tiles[y]?.[x];
      if (!tile) continue;
      ctx.fillStyle = TILE_COLORS[tile.type] || '#FF00FF';
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  // Draw grid lines at high zoom
  if (camera.zoom >= 2) {
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 0.5 / camera.zoom;
    for (let y = startY; y <= endY; y++) {
      ctx.beginPath();
      ctx.moveTo(startX * TILE_SIZE, y * TILE_SIZE);
      ctx.lineTo(endX * TILE_SIZE, y * TILE_SIZE);
      ctx.stroke();
    }
    for (let x = startX; x <= endX; x++) {
      ctx.beginPath();
      ctx.moveTo(x * TILE_SIZE, startY * TILE_SIZE);
      ctx.lineTo(x * TILE_SIZE, endY * TILE_SIZE);
      ctx.stroke();
    }
  }

  // Draw POI markers
  if (map.worldSeed?.pois) {
    for (const poi of map.worldSeed.pois) {
      if (!poi.position) continue;
      const icon = POI_ICONS[poi.type] || POI_ICONS.village;
      const px = (poi.position.x + 0.5) * TILE_SIZE;
      const py = (poi.position.y + 0.5) * TILE_SIZE;
      const r = TILE_SIZE * 0.8;

      ctx.fillStyle = icon.color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      if (icon.shape === 'circle') {
        ctx.arc(px, py, r, 0, Math.PI * 2);
      } else if (icon.shape === 'triangle') {
        ctx.moveTo(px, py - r);
        ctx.lineTo(px - r, py + r * 0.6);
        ctx.lineTo(px + r, py + r * 0.6);
        ctx.closePath();
      } else if (icon.shape === 'square') {
        ctx.rect(px - r * 0.7, py - r * 0.7, r * 1.4, r * 1.4);
      } else {
        ctx.moveTo(px, py - r);
        ctx.lineTo(px + r, py);
        ctx.lineTo(px, py + r);
        ctx.lineTo(px - r, py);
        ctx.closePath();
      }
      ctx.fill();
      ctx.globalAlpha = 1;

      if (poi.name && camera.zoom >= 0.5) {
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.max(8, 10 / camera.zoom)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(poi.name, px, py + r + 10 / camera.zoom);
      }
    }
  }

  // Draw village markers
  for (const v of map.villages) {
    if (!v.name) continue;
    const px = (v.x + 0.5) * TILE_SIZE;
    const py = (v.y + 0.5) * TILE_SIZE;
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.max(8, 10 / camera.zoom)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(v.name, px, py - TILE_SIZE);
  }

  ctx.restore();
}
```

**Step 5: Run tests — expect all 97 to pass**

```bash
npm test
```

Expected: `97 passed`

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove GAN sprite tech debt, clean renderer"
```

---

## Task 2: Types and GameState

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/state.ts`
- Test: `tests/unit/npc-types.test.ts`

**Step 1: Add types to types.ts**

Append to the end of `src/core/types.ts`:

```ts
/** NPC visual role — maps to a spritesheet file */
export type NpcRole = 'farmer' | 'priest' | 'soldier' | 'merchant' | 'elder' | 'child' | 'noble' | 'beggar';

/** Cardinal facing direction */
export type Direction = 'up' | 'down' | 'left' | 'right';

/** Runtime NPC instance on the map */
export interface NpcInstance {
  id: string;
  role: NpcRole;
  tileX: number;
  tileY: number;
  direction: Direction;
  frame: number;       // 0 = idle stand pose; 1-8 = walk cycle frames
  frameTimer: number;  // ms accumulated since last frame advance
}
```

**Step 2: Add npcs to GameState**

In `src/core/state.ts`, add import and field:

```ts
import type { GameMap, Camera, WorldSeed, NpcInstance } from '@/core/types';
import { createCamera } from '@/render/camera';

export interface GameState {
  map: GameMap | null;
  camera: Camera;
  worldSeed: WorldSeed | null;
  npcs: NpcInstance[];
  debug: boolean;
}

export function createState(): GameState {
  return {
    map: null,
    camera: createCamera(),
    worldSeed: null,
    npcs: [],
    debug: false,
  };
}
```

**Step 3: Write a quick type-check test**

Create `tests/unit/npc-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { NpcInstance, NpcRole, Direction } from '@/core/types';
import { createState } from '@/core/state';

describe('NpcInstance types', () => {
  it('createState initialises npcs as empty array', () => {
    const state = createState();
    expect(state.npcs).toEqual([]);
  });

  it('NpcInstance shape is correct', () => {
    const npc: NpcInstance = {
      id: 'test-1',
      role: 'farmer' as NpcRole,
      tileX: 5,
      tileY: 10,
      direction: 'down' as Direction,
      frame: 0,
      frameTimer: 0,
    };
    expect(npc.role).toBe('farmer');
    expect(npc.frame).toBe(0);
  });
});
```

**Step 4: Run test to verify it passes**

```bash
npm test -- tests/unit/npc-types.test.ts
```

Expected: `2 passed`

**Step 5: Commit**

```bash
git add src/core/types.ts src/core/state.ts tests/unit/npc-types.test.ts
git commit -m "feat: add NpcInstance types and GameState.npcs"
```

---

## Task 3: NPC Animator

**Files:**
- Create: `src/render/npc-animator.ts`
- Test: `tests/unit/npc-animator.test.ts`

The animator has two pure functions:
- `getSpriteCoords(npc)` — maps direction+frame to pixel offset in the LPC sheet
- `updateNpcs(npcs, deltaMs)` — advances frame timer; increments frame when timer overflows

**LPC row mapping:**
- up → row 2, left → row 3, down → row 4, right → row 5
- Each frame is 64×64px, so `sx = frame * 64`, `sy = row * 64`
- Frame 0 = stand/idle — never auto-advanced by the animator

**Step 1: Write failing tests**

Create `tests/unit/npc-animator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getSpriteCoords, updateNpcs } from '@/render/npc-animator';
import type { NpcInstance } from '@/core/types';

function makeNpc(overrides: Partial<NpcInstance> = {}): NpcInstance {
  return {
    id: 'n1', role: 'farmer', tileX: 0, tileY: 0,
    direction: 'down', frame: 0, frameTimer: 0,
    ...overrides,
  };
}

describe('getSpriteCoords', () => {
  it('maps down+frame0 to row 4, col 0', () => {
    const { sx, sy } = getSpriteCoords(makeNpc({ direction: 'down', frame: 0 }));
    expect(sx).toBe(0);
    expect(sy).toBe(4 * 64);
  });

  it('maps up+frame0 to row 2, col 0', () => {
    const { sx, sy } = getSpriteCoords(makeNpc({ direction: 'up', frame: 0 }));
    expect(sx).toBe(0);
    expect(sy).toBe(2 * 64);
  });

  it('maps left+frame0 to row 3, col 0', () => {
    const { sx, sy } = getSpriteCoords(makeNpc({ direction: 'left', frame: 0 }));
    expect(sy).toBe(3 * 64);
  });

  it('maps right+frame0 to row 5, col 0', () => {
    const { sx, sy } = getSpriteCoords(makeNpc({ direction: 'right', frame: 0 }));
    expect(sy).toBe(5 * 64);
  });

  it('uses frame index for sx', () => {
    const { sx } = getSpriteCoords(makeNpc({ frame: 3 }));
    expect(sx).toBe(3 * 64);
  });
});

describe('updateNpcs', () => {
  it('does not advance frame when npc is at frame 0 (idle)', () => {
    const npc = makeNpc({ frame: 0, frameTimer: 0 });
    updateNpcs([npc], 200);
    expect(npc.frame).toBe(0);
    expect(npc.frameTimer).toBe(0);
  });

  it('accumulates frameTimer when frame > 0 and delta < FRAME_MS', () => {
    const npc = makeNpc({ frame: 1, frameTimer: 0 });
    updateNpcs([npc], 100);
    expect(npc.frameTimer).toBe(100);
    expect(npc.frame).toBe(1);
  });

  it('advances frame and resets timer when delta >= FRAME_MS', () => {
    const npc = makeNpc({ frame: 1, frameTimer: 100 });
    updateNpcs([npc], 100); // total 200ms >= 150ms FRAME_MS
    expect(npc.frame).toBe(2);
    expect(npc.frameTimer).toBeLessThan(150);
  });

  it('wraps frame from 8 back to 1 (not 0)', () => {
    const npc = makeNpc({ frame: 8, frameTimer: 0 });
    updateNpcs([npc], 200);
    expect(npc.frame).toBe(1);
  });
});
```

**Step 2: Run tests to confirm they fail**

```bash
npm test -- tests/unit/npc-animator.test.ts
```

Expected: FAIL — `getSpriteCoords is not a function`

**Step 3: Implement npc-animator.ts**

Create `src/render/npc-animator.ts`:

```ts
import type { NpcInstance, Direction } from '@/core/types';

const FRAME_MS = 150; // ~6.7 FPS

const DIRECTION_ROW: Record<Direction, number> = {
  up:    2,
  left:  3,
  down:  4,
  right: 5,
};

/** Returns the pixel offset into the LPC spritesheet for this NPC's current frame */
export function getSpriteCoords(npc: NpcInstance): { sx: number; sy: number } {
  return {
    sx: npc.frame * 64,
    sy: DIRECTION_ROW[npc.direction] * 64,
  };
}

/**
 * Advance animation state for all NPCs.
 * Frame 0 = idle stand — never auto-advanced.
 * Frames 1-8 = walk cycle — advance at FRAME_MS rate, wrap 8→1.
 */
export function updateNpcs(npcs: NpcInstance[], deltaMs: number): void {
  for (const npc of npcs) {
    if (npc.frame === 0) continue; // idle, no update needed

    npc.frameTimer += deltaMs;
    if (npc.frameTimer >= FRAME_MS) {
      npc.frameTimer -= FRAME_MS;
      npc.frame = npc.frame >= 8 ? 1 : npc.frame + 1;
    }
  }
}
```

**Step 4: Run tests to confirm they pass**

```bash
npm test -- tests/unit/npc-animator.test.ts
```

Expected: `9 passed`

**Step 5: Run full test suite**

```bash
npm test
```

Expected: `106 passed` (97 existing + 9 new)

**Step 6: Commit**

```bash
git add src/render/npc-animator.ts tests/unit/npc-animator.test.ts
git commit -m "feat: npc-animator — sprite coords and frame update"
```

---

## Task 4: Spritesheet Loading + NPC Spawning

**Files:**
- Modify: `src/game.ts`

**Step 1: Add NPC_ROLES constant and role mapping**

At the top of `src/game.ts`, add after existing imports:

```ts
import type { GameMap, WorldSeed, TerrainOptions, NpcInstance, NpcRole } from '@/core/types';
import { updateNpcs } from '@/render/npc-animator';

const NPC_ROLES: NpcRole[] = ['farmer', 'priest', 'soldier', 'merchant', 'elder', 'child', 'noble', 'beggar'];

function toNpcRole(role: string): NpcRole {
  return NPC_ROLES.includes(role as NpcRole) ? (role as NpcRole) : 'farmer';
}

function randomItem<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}
```

**Step 2: Add loadSpritesheets helper**

Add this function to `src/game.ts` (outside the class):

```ts
async function loadSpritesheets(): Promise<Map<string, HTMLImageElement>> {
  const sheets = new Map<string, HTMLImageElement>();
  const roles: NpcRole[] = ['farmer', 'priest', 'soldier', 'merchant', 'elder', 'child', 'noble', 'beggar'];

  await Promise.all(roles.map(role => new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => { sheets.set(role, img); resolve(); };
    img.onerror = () => { resolve(); }; // missing sprite — skip silently
    img.src = `/sprites/npc-${role}.png`;
  })));

  return sheets;
}
```

**Step 3: Add spritesheets field to Game class**

In the `Game` class, add:

```ts
private spritesheets = new Map<string, HTMLImageElement>();
private rafId: number | null = null;
private lastFrameTime = 0;
```

**Step 4: Add spawnNpcs helper to Game class**

```ts
private spawnNpcs(map: GameMap, ws: WorldSeed): NpcInstance[] {
  const npcs: NpcInstance[] = [];
  const directions: Direction[] = ['up', 'down', 'left', 'right'];
  let idCounter = 0;

  for (const poi of ws.pois) {
    if (!poi.npcs || !poi.position) continue;
    const baseX = poi.position.x;
    const baseY = poi.position.y;

    for (const npcDef of poi.npcs) {
      // Place within a 3-tile radius of the POI, on a walkable tile
      let placed = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const dx = Math.floor(Math.random() * 7) - 3;
        const dy = Math.floor(Math.random() * 7) - 3;
        const tx = Math.max(0, Math.min(map.width - 1, baseX + dx));
        const ty = Math.max(0, Math.min(map.height - 1, baseY + dy));
        if (map.tiles[ty]?.[tx]?.walkable) {
          npcs.push({
            id: `npc-${idCounter++}`,
            role: toNpcRole(npcDef.role),
            tileX: tx,
            tileY: ty,
            direction: directions[Math.floor(Math.random() * 4)],
            frame: 0,
            frameTimer: 0,
          });
          placed = true;
          break;
        }
      }
      if (!placed) {
        // Fallback: place at POI center regardless
        npcs.push({
          id: `npc-${idCounter++}`,
          role: toNpcRole(npcDef.role),
          tileX: baseX,
          tileY: baseY,
          direction: 'down',
          frame: 0,
          frameTimer: 0,
        });
      }
    }
  }

  return npcs;
}
```

Note: `Direction` needs to be imported — add to the types import line.

**Step 5: Update generateWorld to load sheets and spawn NPCs**

Replace the end of `generateWorld` (after `this.state.map = map`):

```ts
this.state.map = map;
this.state.worldSeed = ws;
this.state.npcs = this.spawnNpcs(map, ws);

// Load spritesheets (non-blocking if already loaded)
if (this.spritesheets.size === 0) {
  this.spritesheets = await loadSpritesheets();
}

// Center camera
centerOn( ... ); // existing code unchanged

this.startLoop();
return map;
```

**Step 6: Add startLoop / stopLoop to Game class**

```ts
private startLoop(): void {
  if (this.rafId !== null) return;
  this.lastFrameTime = performance.now();
  const tick = (now: number) => {
    const delta = now - this.lastFrameTime;
    this.lastFrameTime = now;
    updateNpcs(this.state.npcs, delta);
    this.render();
    this.rafId = requestAnimationFrame(tick);
  };
  this.rafId = requestAnimationFrame(tick);
}

private stopLoop(): void {
  if (this.rafId !== null) {
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
}
```

**Step 7: Call stopLoop in destroy()**

In `destroy()`, add `this.stopLoop();` before `this.canvas.remove()`.

**Step 8: Update render() to pass spritesheets and npcs**

```ts
render(): void {
  if (!this.state.map) return;
  const w = this.canvas.width / devicePixelRatio;
  const h = this.canvas.height / devicePixelRatio;
  renderMap(this.ctx, this.state.map, this.state.camera, w, h, this.state.npcs, this.spritesheets);
}
```

**Step 9: Run tests**

```bash
npm test
```

Expected: all passing (game.ts changes aren't unit tested — verified visually)

**Step 10: Commit**

```bash
git add src/game.ts
git commit -m "feat: spritesheet loading and NPC spawning in generateWorld"
```

---

## Task 5: Renderer — Draw NPC Sprites

**Files:**
- Modify: `src/render/renderer.ts`

**Step 1: Update renderMap signature**

```ts
import type { GameMap, Camera, NpcInstance } from '@/core/types';
import { TILE_SIZE, TILE_COLORS, BG_COLOR, POI_ICONS } from '@/core/constants';
import { getSpriteCoords } from './npc-animator';

export function renderMap(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
  npcs: NpcInstance[] = [],
  spritesheets: Map<string, HTMLImageElement> = new Map(),
): void {
```

**Step 2: Add NPC drawing after the `ctx.restore()` call**

The NPC sprites are drawn in screen space (after `ctx.restore()`) so we handle our own coordinate transform:

```ts
  ctx.restore();

  // Draw NPC sprites in screen space
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  const spriteWorldSize = TILE_SIZE * 2;   // 32px world-space (2×2 tiles)
  const spriteScreenSize = spriteWorldSize * camera.zoom;

  for (const npc of npcs) {
    const sheet = spritesheets.get(npc.role);
    if (!sheet) continue;

    const screenX = (npc.tileX * TILE_SIZE - camera.x) * camera.zoom;
    const screenY = ((npc.tileY - 1) * TILE_SIZE - camera.y) * camera.zoom; // offset 1 tile up so feet align with tile

    // Cull off-screen
    if (screenX + spriteScreenSize < 0 || screenX > canvasWidth ||
        screenY + spriteScreenSize < 0 || screenY > canvasHeight) continue;

    const { sx, sy } = getSpriteCoords(npc);
    ctx.drawImage(sheet, sx, sy, 64, 64, screenX, screenY, spriteScreenSize, spriteScreenSize);
  }

  ctx.restore();
```

**Step 3: Run tests**

```bash
npm test
```

Expected: all passing

**Step 4: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v "tests/e2e/"
```

Expected: no output (no errors in src/)

**Step 5: Commit**

```bash
git add src/render/renderer.ts
git commit -m "feat: draw LPC NPC sprites on map"
```

---

## Task 6: Visual Verification

This task is manual — run the dev server and confirm NPCs appear on the map.

**Step 1: Start dev server**

```bash
npm run dev
```

**Step 2: Open browser, generate a world**

Open `http://localhost:5173`. The default world seed has POIs with NPCs — they should appear as sprite characters near their POI positions.

**Things to check:**
- NPCs visible as small pixel-art characters at zoom 2–4×
- `imageSmoothingEnabled = false` means no blurring (crisp pixels)
- NPCs near their POI positions (within a few tiles)
- Different roles show different spritesheets
- If no spritesheets generated yet: NPCs simply don't render (graceful skip)

**Step 3: Final test run**

```bash
npm test
```

Expected: all passing

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: LPC NPC characters — walk/idle sprites on map"
```
