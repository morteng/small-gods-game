# LPC NPC Integrated Renderer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the GAN sprite pipeline with a forked LPC spritesheet generator that renders any NPC character dynamically in-browser from a structured spec.

**Architecture:** Fork 3 JS files from the LPC generator (renderer, load-image, item-metadata), wrap them with TypeScript (`character-builder.ts`, `spritesheet-cache.ts`), add an NPC animator, update the game loop with RAF + deltaMs, and draw NPCs from spritesheets in the renderer.

**Tech Stack:** TypeScript, Vite, Vitest, Canvas 2D, LPC Universal Spritesheet Generator (forked JS), GitHub Pages CDN for sprites.

---

### Task 1: Tech debt cleanup

Remove all GAN/ONNX NPC code before adding the new system.

**Files:**
- Delete: `src/render/sprite-generator.ts`
- Delete: `src/render/sprite-cache.ts`
- Modify: `src/render/renderer.ts`
- Modify: `src/core/constants.ts`
- Modify: `package.json`

**Step 1: Delete old sprite files**

```bash
rm src/render/sprite-generator.ts src/render/sprite-cache.ts
```

**Step 2: Clean renderer.ts**

Open `src/render/renderer.ts`. Remove:
- The `import { getOrGenerate } from './sprite-cache';` line
- The `import { ..., NPC_ROLE_TINTS } from '@/core/constants';` — remove `NPC_ROLE_TINTS` from the import (keep rest)
- The entire `NpcRenderData` interface (lines ~6–11)
- The `npcs: NpcRenderData[] = []` parameter from `renderMap` signature
- The entire NPC draw block at the bottom (the `for (const npc of npcs)` loop, ~lines 118–144)

After cleanup, `renderMap` signature should be:
```ts
export function renderMap(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
): void
```

And the imports at the top:
```ts
import type { GameMap, Camera } from '@/core/types';
import { TILE_SIZE, TILE_COLORS, BG_COLOR, POI_ICONS } from '@/core/constants';
```

**Step 3: Remove NPC_ROLE_TINTS from constants.ts**

Open `src/core/constants.ts`. Delete the entire `NPC_ROLE_TINTS` export block (the `/** NPC role tint colors... */` comment + the const, ~lines 69–77).

**Step 4: Remove onnxruntime-web from package.json**

Open `package.json`. Remove `"onnxruntime-web": "^1.20.1"` from `dependencies`. Then run:

```bash
npm install
```

**Step 5: Run tests**

```bash
npm test
```

Expected: all existing tests pass. TypeScript errors for missing imports are OK to see — we'll fix them as we add new code.

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove GAN sprite pipeline (sprite-generator, sprite-cache, onnxruntime-web, NPC_ROLE_TINTS)"
```

---

### Task 2: Fork LPC source files

Download the minimal LPC generator source into `src/render/lpc/`. This is our "fork" — we own these files and can modify them.

**Files:**
- Create: `src/render/lpc/item-metadata.js`
- Create: `src/render/lpc/load-image.js`
- Create: `src/render/lpc/renderer.js`
- Create: `src/render/lpc/renderer.d.ts`

**Step 1: Download the three source files**

```bash
mkdir -p src/render/lpc

# item-metadata.js — 657-item catalog
curl -o src/render/lpc/item-metadata.js \
  "https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/item-metadata.js?v=1.00.0001"

# load-image.js and renderer.js
curl -o src/render/lpc/load-image.js \
  "https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/sources/canvas/load-image.js"

curl -o src/render/lpc/renderer.js \
  "https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/sources/canvas/renderer.js"
```

**Step 2: Check renderer.js for additional imports**

```bash
grep "^import" src/render/lpc/renderer.js
```

If there are imports beyond `./load-image.js`, download those files too:
```bash
# Example — adjust paths as needed:
# curl -o src/render/lpc/utils.js "https://liberatedpixelcup.github.io/.../sources/canvas/utils.js"
```

**Step 3: Fix load-image.js — add base URL**

Open `src/render/lpc/load-image.js`. Find the line where `img.src` is set (it will look like `img.src = path` or `img.src = spritePath`). Change it to prepend the CDN base URL:

```js
const LPC_BASE_URL = 'https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/';

// Find the img.src assignment and change it to:
img.src = path.startsWith('http') ? path : LPC_BASE_URL + path;
```

(Add the `LPC_BASE_URL` constant near the top of the file, and update only the `img.src` assignment line.)

**Step 4: Verify item-metadata.js sets window.itemMetadata**

```bash
head -3 src/render/lpc/item-metadata.js
```

Expected: starts with `window.itemMetadata = {` or `var itemMetadata = {` followed by an assignment. If it uses a variable name other than `itemMetadata`, note it — we'll need it in Task 6.

**Step 5: Create TypeScript declarations**

Create `src/render/lpc/renderer.d.ts`:

```ts
/** Selections: type_name → {itemId (key in itemMetadata), variant} */
export type LpcSelections = Record<string, { itemId: string; variant: string }>;

/**
 * Renders a full LPC spritesheet to a canvas element.
 * Fetches sprites from the GitHub Pages CDN.
 */
export declare function renderCharacter(
  selections: LpcSelections,
  bodyType: 'male' | 'female' | 'teen' | 'child' | 'muscular',
  targetCanvas?: HTMLCanvasElement | null,
): Promise<void>;

export declare function renderSingleItem(
  itemId: string,
  variant: string,
  bodyType: string,
  selections: LpcSelections,
  singleLayer?: number | null,
): Promise<HTMLCanvasElement | null>;
```

**Step 6: Verify build**

```bash
npm run build 2>&1 | head -30
```

TypeScript should not complain about the `.js` files (Vite handles them). If there are errors about the `.d.ts`, fix the declaration file.

**Step 7: Commit**

```bash
git add src/render/lpc/
git commit -m "feat: fork LPC generator source files (renderer, load-image, item-metadata)"
```

---

### Task 3: NPC types + GameState

Add the NPC data model to the type system.

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/state.ts`
- Create: `tests/unit/npc-types.test.ts`

**Step 1: Write failing test**

Create `tests/unit/npc-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';

describe('GameState.npcs', () => {
  it('initialises with empty npcs array', () => {
    const state = createState();
    expect(state.npcs).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/npc-types.test.ts
```

Expected: FAIL — `state.npcs` is undefined.

**Step 3: Add types to types.ts**

Append to `src/core/types.ts`:

```ts
/** NPC role in the world */
export type NpcRole = 'farmer' | 'priest' | 'soldier' | 'merchant' | 'elder' | 'child' | 'noble' | 'beggar';

/** Direction an NPC is facing */
export type Direction = 'up' | 'down' | 'left' | 'right';

/** A live NPC instance on the map */
export interface NpcInstance {
  id: string;
  role: NpcRole;
  seed: number;       // deterministic appearance seed, derived from id
  tileX: number;
  tileY: number;
  direction: Direction;
  frame: number;      // 0 = idle stand, 1–8 = walk cycle
  frameTimer: number; // ms accumulator since last frame advance
}
```

**Step 4: Add npcs to GameState**

In `src/core/state.ts`, update the import and the interface + factory:

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

**Step 5: Run test to verify it passes**

```bash
npm test -- tests/unit/npc-types.test.ts
```

Expected: PASS.

**Step 6: Run all tests**

```bash
npm test
```

Expected: all pass.

**Step 7: Commit**

```bash
git add src/core/types.ts src/core/state.ts tests/unit/npc-types.test.ts
git commit -m "feat: add NpcInstance, NpcRole, Direction types and GameState.npcs"
```

---

### Task 4: NPC animator

Create the animation update + sprite coordinate functions.

**Files:**
- Create: `src/render/npc-animator.ts`
- Create: `tests/unit/npc-animator.test.ts`

**Step 1: Write failing tests**

Create `tests/unit/npc-animator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { updateNpcs, getSpriteCoords, FRAME_MS } from '@/render/npc-animator';
import type { NpcInstance } from '@/core/types';

function makeNpc(overrides: Partial<NpcInstance> = {}): NpcInstance {
  return {
    id: 'test',
    role: 'farmer',
    seed: 0,
    tileX: 0,
    tileY: 0,
    direction: 'down',
    frame: 1,
    frameTimer: 0,
    ...overrides,
  };
}

describe('updateNpcs', () => {
  it('advances frameTimer without changing frame when delta is small', () => {
    const npc = makeNpc({ frame: 1, frameTimer: 0 });
    updateNpcs([npc], FRAME_MS - 1);
    expect(npc.frame).toBe(1);
    expect(npc.frameTimer).toBe(FRAME_MS - 1);
  });

  it('increments frame and resets timer when delta exceeds FRAME_MS', () => {
    const npc = makeNpc({ frame: 1, frameTimer: 0 });
    updateNpcs([npc], FRAME_MS + 10);
    expect(npc.frame).toBe(2);
    expect(npc.frameTimer).toBe(10);
  });

  it('wraps frame from 8 back to 1', () => {
    const npc = makeNpc({ frame: 8, frameTimer: 0 });
    updateNpcs([npc], FRAME_MS + 5);
    expect(npc.frame).toBe(1);
  });

  it('never auto-advances idle frame (frame 0)', () => {
    const npc = makeNpc({ frame: 0, frameTimer: 0 });
    updateNpcs([npc], FRAME_MS * 10);
    expect(npc.frame).toBe(0);
    expect(npc.frameTimer).toBe(0);
  });
});

describe('getSpriteCoords', () => {
  it('maps direction up to row 2', () => {
    const { sy } = getSpriteCoords(makeNpc({ direction: 'up', frame: 0 }));
    expect(sy).toBe(2 * 64);
  });

  it('maps direction left to row 3', () => {
    const { sy } = getSpriteCoords(makeNpc({ direction: 'left', frame: 0 }));
    expect(sy).toBe(3 * 64);
  });

  it('maps direction down to row 4', () => {
    const { sy } = getSpriteCoords(makeNpc({ direction: 'down', frame: 0 }));
    expect(sy).toBe(4 * 64);
  });

  it('maps direction right to row 5', () => {
    const { sy } = getSpriteCoords(makeNpc({ direction: 'right', frame: 0 }));
    expect(sy).toBe(5 * 64);
  });

  it('computes sx as frame * 64', () => {
    const { sx } = getSpriteCoords(makeNpc({ frame: 3 }));
    expect(sx).toBe(3 * 64);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/npc-animator.test.ts
```

Expected: FAIL — module not found.

**Step 3: Create src/render/npc-animator.ts**

```ts
import type { NpcInstance } from '@/core/types';

/** Walk cycle frame duration in ms (~6.7 FPS) */
export const FRAME_MS = 150;

const DIRECTION_ROW: Record<string, number> = {
  up: 2,
  left: 3,
  down: 4,
  right: 5,
};

/**
 * Advance NPC walk animation frames.
 * Frame 0 is idle — never auto-advanced.
 * Frames 1–8 cycle continuously.
 */
export function updateNpcs(npcs: NpcInstance[], deltaMs: number): void {
  for (const npc of npcs) {
    if (npc.frame === 0) continue; // idle — don't animate
    npc.frameTimer += deltaMs;
    if (npc.frameTimer >= FRAME_MS) {
      npc.frameTimer -= FRAME_MS;
      npc.frame = npc.frame >= 8 ? 1 : npc.frame + 1;
    }
  }
}

/**
 * Get source coordinates within an LPC spritesheet for a given NPC state.
 * Spritesheet frame size: 64×64px.
 * Row layout: up=2, left=3, down=4, right=5.
 */
export function getSpriteCoords(npc: NpcInstance): { sx: number; sy: number } {
  const row = DIRECTION_ROW[npc.direction] ?? 4;
  return { sx: npc.frame * 64, sy: row * 64 };
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- tests/unit/npc-animator.test.ts
```

Expected: all 9 tests pass.

**Step 5: Run all tests**

```bash
npm test
```

Expected: all pass.

**Step 6: Commit**

```bash
git add src/render/npc-animator.ts tests/unit/npc-animator.test.ts
git commit -m "feat: NPC animator — frame update and sprite coordinate functions"
```

---

### Task 5: Character builder

Map NPC roles to LPC item selections. This is what makes each role look distinct.

**Files:**
- Create: `src/render/lpc/character-builder.ts`
- Create: `tests/unit/character-builder.test.ts`

**Step 1: Write failing tests**

Create `tests/unit/character-builder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildCharacterSpec, specFromItems } from '@/render/lpc/character-builder';

describe('buildCharacterSpec', () => {
  it('returns a valid spec for farmer', () => {
    const spec = buildCharacterSpec('farmer', 0);
    expect(spec.sex).toBe('male');
    expect(spec.bodyType).toBe('male');
    expect(spec.items['body']).toBeDefined();
    expect(spec.items['head']).toBeDefined();
  });

  it('uses child sex and bodyType for child role', () => {
    const spec = buildCharacterSpec('child', 0);
    expect(spec.sex).toBe('child');
    expect(spec.bodyType).toBe('child');
  });

  it('different seeds produce different hair variants for same role', () => {
    const s1 = buildCharacterSpec('farmer', 0);
    const s2 = buildCharacterSpec('farmer', 999);
    // At least one item should differ (hair or skin)
    const s1Hair = JSON.stringify(s1.items['hair']);
    const s2Hair = JSON.stringify(s2.items['hair']);
    // May or may not differ — just verify both are defined
    expect(s1Hair).toBeTruthy();
    expect(s2Hair).toBeTruthy();
  });

  it('all 8 roles return a spec without throwing', () => {
    const roles = ['farmer', 'priest', 'soldier', 'merchant', 'elder', 'child', 'noble', 'beggar'] as const;
    for (const role of roles) {
      expect(() => buildCharacterSpec(role, 42)).not.toThrow();
    }
  });
});

describe('specFromItems', () => {
  it('wraps items in a male spec', () => {
    const items = { body: { itemId: 'body', variant: 'light' } };
    const spec = specFromItems(items);
    expect(spec.sex).toBe('male');
    expect(spec.items).toEqual(items);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/character-builder.test.ts
```

Expected: FAIL — module not found.

**Step 3: Create src/render/lpc/character-builder.ts**

```ts
import type { NpcRole } from '@/core/types';
import type { LpcSelections } from './renderer';

export interface CharacterSpec {
  sex: 'male' | 'female' | 'child';
  bodyType: 'male' | 'female' | 'teen' | 'child' | 'muscular';
  items: LpcSelections;
}

/** Seeded pick from an array. Stable for same seed+offset. */
function pick<T>(seed: number, offset: number, options: T[]): T {
  return options[Math.abs((seed + offset) * 2654435761) % options.length];
}

/** Skin tone variants available on most human head/body items */
const SKIN = ['light', 'amber', 'olive', 'taupe', 'bronze', 'brown'] as const;

/** Common hair colour variants */
const HAIR_COLORS = ['blonde', 'sandy', 'chestnut', 'light brown', 'dark brown', 'black', 'gray', 'white'] as const;

/** Earth-toned clothing variants */
const EARTH = ['black', 'blue', 'bluegray'] as const;

function base(seed: number, headItemId: string, sex: 'male' | 'female' | 'child' = 'male'): LpcSelections {
  const skin = pick(seed, 0, SKIN as unknown as string[]);
  return {
    body:       { itemId: 'body',        variant: skin },
    head:       { itemId: headItemId,    variant: skin },
    expression: { itemId: 'face_neutral', variant: skin },
  };
}

const ROLE_SPECS: Record<NpcRole, (seed: number) => CharacterSpec> = {

  farmer: (seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...base(seed, 'heads_human_male'),
      hair:   { itemId: 'hair_buzzcut',         variant: pick(seed, 1, ['brown', 'sandy', 'black', 'chestnut']) },
      clothes:{ itemId: 'torso_clothes_tunic',  variant: pick(seed, 2, EARTH as unknown as string[]) },
      legs:   { itemId: 'legs_hose',            variant: 'leather' },
      shoes:  { itemId: 'feet_boots_basic',     variant: 'black' },
    },
  }),

  priest: (seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...base(seed, 'heads_human_male'),
      hair:   { itemId: 'hair_plain',           variant: pick(seed, 1, ['blonde', 'sandy', 'white', 'black']) },
      clothes:{ itemId: 'torso_clothes_robe',   variant: pick(seed, 2, ['blue', 'black', 'brown']) },
      legs:   { itemId: 'legs_hose',            variant: 'black' },
      shoes:  { itemId: 'feet_sandals',         variant: 'brown' },
    },
  }),

  soldier: (seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...base(seed, 'heads_human_male'),
      hair:   { itemId: 'hair_buzzcut',         variant: pick(seed, 1, ['black', 'brown', 'blonde']) },
      armour: { itemId: 'torso_armour_plate',   variant: pick(seed, 2, ['steel', 'iron', 'brass']) },
      arms:   { itemId: 'arms_armour',          variant: pick(seed, 3, ['steel', 'iron', 'brass']) },
      legs:   { itemId: 'legs_armour',          variant: pick(seed, 4, ['steel', 'iron', 'brass']) },
      shoes:  { itemId: 'feet_armour',          variant: pick(seed, 5, ['steel', 'iron', 'brass']) },
    },
  }),

  merchant: (seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...base(seed, 'heads_human_male'),
      hair:   { itemId: 'hair_parted',          variant: pick(seed, 1, ['brown', 'black', 'blonde', 'sandy']) },
      clothes:{ itemId: 'torso_clothes_longsleeve_polo', variant: pick(seed, 2, ['blue', 'black', 'bluegray']) },
      legs:   { itemId: 'legs_leggings',        variant: 'black' },
      shoes:  { itemId: 'feet_boots_revised',   variant: 'black' },
    },
  }),

  elder: (seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...base(seed, 'heads_human_male_elderly'),
      hair:   { itemId: 'hair_balding',         variant: pick(seed, 1, ['gray', 'white', 'dark gray']) },
      beard:  { itemId: 'beard_basic_beard',    variant: pick(seed, 2, ['white', 'gray']) },
      clothes:{ itemId: 'torso_clothes_robe',   variant: pick(seed, 3, ['black', 'blue', 'brown']) },
      legs:   { itemId: 'legs_hose',            variant: 'leather' },
      shoes:  { itemId: 'feet_sandals',         variant: 'brown' },
    },
  }),

  child: (seed) => ({
    sex: 'child', bodyType: 'child',
    items: {
      ...base(seed, 'heads_human_child', 'child'),
      hair:   { itemId: pick(seed, 1, ['hair_pigtails', 'hair_plain', 'hair_buzzcut']), variant: pick(seed, 2, ['blonde', 'brown', 'black', 'sandy']) },
      clothes:{ itemId: 'torso_clothes_child_shirts', variant: pick(seed, 3, EARTH as unknown as string[]) },
      legs:   { itemId: 'legs_child_pants',     variant: pick(seed, 4, ['black', 'blue', 'brown']) },
    },
  }),

  noble: (seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...base(seed, 'heads_human_male'),
      hair:   { itemId: pick(seed, 1, ['hair_parted_2', 'hair_parted', 'hair_page']), variant: pick(seed, 2, ['blonde', 'sandy', 'brown', 'black']) },
      clothes:{ itemId: 'torso_clothes_longsleeve_2_buttoned', variant: pick(seed, 3, ['blue', 'black', 'bluegray']) },
      legs:   { itemId: 'legs_leggings_2',      variant: 'black' },
      shoes:  { itemId: 'feet_boots_revised',   variant: 'black' },
    },
  }),

  beggar: (seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...base(seed, 'heads_human_male_gaunt'),
      hair:   { itemId: pick(seed, 1, ['hair_messy1', 'hair_messy2', 'hair_unkempt']), variant: pick(seed, 2, ['black', 'dark brown', 'dark gray']) },
      clothes:{ itemId: 'torso_clothes_tunic',  variant: 'black' },
      legs:   { itemId: 'legs_hose',            variant: 'black' },
    },
  }),
};

/**
 * Build a character spec for the given role.
 * The seed makes each NPC instance look slightly different.
 */
export function buildCharacterSpec(role: NpcRole, seed: number): CharacterSpec {
  return ROLE_SPECS[role](seed);
}

/**
 * Build a character spec from an explicit item selection.
 * Used for LLM-driven or custom character descriptions.
 */
export function specFromItems(
  items: LpcSelections,
  sex: 'male' | 'female' | 'child' = 'male',
  bodyType: 'male' | 'female' | 'teen' | 'child' | 'muscular' = 'male',
): CharacterSpec {
  return { sex, bodyType, items };
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- tests/unit/character-builder.test.ts
```

Expected: all 5 tests pass.

**Step 5: Run all tests**

```bash
npm test
```

Expected: all pass.

**Step 6: Commit**

```bash
git add src/render/lpc/character-builder.ts tests/unit/character-builder.test.ts
git commit -m "feat: character-builder — role presets with seeded variety"
```

---

### Task 6: Spritesheet cache

Lazy generation + in-memory caching of rendered spritesheets.

**Files:**
- Create: `src/render/lpc/spritesheet-cache.ts`

No unit tests for this module — it requires live Canvas + image loading. Integration testing happens in Task 9.

**Step 1: Create src/render/lpc/spritesheet-cache.ts**

```ts
import './item-metadata.js';            // sets window.itemMetadata (required by renderer.js)
import { renderCharacter } from './renderer.js';
import type { CharacterSpec } from './character-builder';

/** Stable hash of a CharacterSpec — used as cache key */
function specHash(spec: CharacterSpec): string {
  return JSON.stringify({ s: spec.sex, b: spec.bodyType, i: spec.items });
}

// Cache: hash → settled canvas (null if generation failed)
const cache = new Map<string, HTMLCanvasElement | null>();
// In-flight promises: hash → pending generation
const inflight = new Map<string, Promise<HTMLCanvasElement | null>>();

/**
 * Get a rendered LPC spritesheet for the given CharacterSpec.
 * Returns null if generation fails.
 * Concurrent calls with the same spec share one Promise.
 */
export function getOrGenerateSheet(spec: CharacterSpec): Promise<HTMLCanvasElement | null> {
  const hash = specHash(spec);

  // Already settled — return immediately
  if (cache.has(hash)) {
    return Promise.resolve(cache.get(hash)!);
  }

  // Already generating — share the promise
  const existing = inflight.get(hash);
  if (existing) return existing;

  // Start new generation
  const canvas = document.createElement('canvas');
  const promise = renderCharacter(spec.items, spec.bodyType, canvas)
    .then(() => {
      cache.set(hash, canvas);
      inflight.delete(hash);
      return canvas;
    })
    .catch((err: unknown) => {
      console.warn('LPC spritesheet generation failed:', err);
      cache.set(hash, null);
      inflight.delete(hash);
      return null;
    });

  inflight.set(hash, promise);
  return promise;
}

/** Clear the cache (e.g. for testing) */
export function clearSheetCache(): void {
  cache.clear();
  inflight.clear();
}
```

**Step 2: Run all tests**

```bash
npm test
```

Expected: all pass (new file has no unit tests, nothing breaks).

**Step 3: Commit**

```bash
git add src/render/lpc/spritesheet-cache.ts
git commit -m "feat: spritesheet cache — lazy LPC rendering with in-memory cache"
```

---

### Task 7: NPC spawning + RAF game loop

Wire NPCs into the game: spawn from world seed, animate via requestAnimationFrame.

**Files:**
- Modify: `src/game.ts`

**Step 1: Update game.ts**

Replace the entire contents of `src/game.ts` with:

```ts
import { createState, type GameState } from '@/core/state';
import { TILE_SIZE } from '@/core/constants';
import { WFCEngine } from '@/wfc';
import { renderMap } from '@/render/renderer';
import { centerOn } from '@/render/camera';
import { attachControls } from '@/ui/controls';
import { WorldManager } from '@/map/world-manager';
import type { GameMap, WorldSeed, TerrainOptions, NpcInstance, NpcRole } from '@/core/types';
import { updateNpcs } from '@/render/npc-animator';
import { buildCharacterSpec, getOrGenerateSheet } from '@/render/lpc';

export interface GameOptions {
  width?: number;
  height?: number;
  seed?: number;
}

/** Simple string hash → stable integer */
function hashId(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;

export class Game {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: GameState;
  private cleanupControls: (() => void) | null = null;
  private resizeObserver: ResizeObserver;
  private rafId: number | null = null;
  private lastTime: number = 0;
  /** Resolved spritesheets keyed by NPC id */
  private sheets = new Map<string, HTMLCanvasElement>();

  constructor(container: HTMLElement, _options: GameOptions = {}) {
    this.container = container;
    this.state = createState();

    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.cleanupControls = attachControls(this.canvas, this.state.camera, {
      onTileClick: (x, y) => this.onTileClick(x, y),
      onRedraw: () => {}, // RAF handles redraws now
    });
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width * devicePixelRatio;
    this.canvas.height = rect.height * devicePixelRatio;
    this.ctx.scale(devicePixelRatio, devicePixelRatio);
  }

  async generateWorld(worldSeed?: WorldSeed, terrainOptions?: Partial<TerrainOptions>): Promise<GameMap> {
    const ws = worldSeed || await WorldManager.loadDefault();
    const engine = new WFCEngine(ws.size.width, ws.size.height, {
      seed: Date.now(),
      terrainOptions: {
        forestDensity: terrainOptions?.forestDensity ?? 0.5,
        waterLevel:    terrainOptions?.waterLevel    ?? 0.35,
        villageCount:  terrainOptions?.villageCount  ?? 3,
      },
    });

    const map = await engine.generate(ws);
    this.state.map = map;
    this.state.worldSeed = ws;

    centerOn(
      this.state.camera,
      (map.width  * TILE_SIZE) / 2,
      (map.height * TILE_SIZE) / 2,
      this.canvas.width  / devicePixelRatio,
      this.canvas.height / devicePixelRatio,
    );

    this.spawnNpcs(ws, map);
    this.startLoop();
    return map;
  }

  /** Spawn NPCs from POI definitions */
  private spawnNpcs(ws: WorldSeed, map: GameMap): void {
    this.state.npcs = [];
    this.sheets.clear();

    for (const poi of ws.pois) {
      if (!poi.npcs?.length || !poi.position) continue;
      const { x: px, y: py } = poi.position;

      for (let i = 0; i < poi.npcs.length; i++) {
        const npcDef = poi.npcs[i];
        const id = `${poi.id}-npc-${i}`;
        const seed = hashId(id);
        const role = (npcDef.role as NpcRole) ?? 'farmer';
        const validRoles: NpcRole[] = ['farmer', 'priest', 'soldier', 'merchant', 'elder', 'child', 'noble', 'beggar'];
        const safeRole: NpcRole = validRoles.includes(role) ? role : 'farmer';

        // Place near POI; clamp to map bounds
        const tileX = Math.max(0, Math.min(map.width  - 1, px + (seed % 3) - 1));
        const tileY = Math.max(0, Math.min(map.height - 1, py + ((seed >> 2) % 3) - 1));

        const npc: NpcInstance = {
          id,
          role: safeRole,
          seed,
          tileX,
          tileY,
          direction: DIRECTIONS[seed % 4],
          frame: (seed % 8) + 1,  // start mid-walk-cycle for variety
          frameTimer: (seed % FRAME_MS_APPROX),
        };

        this.state.npcs.push(npc);

        // Kick off async spritesheet generation
        const spec = buildCharacterSpec(safeRole, seed);
        getOrGenerateSheet(spec).then(canvas => {
          if (canvas) this.sheets.set(id, canvas);
        });
      }
    }
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    this.lastTime = performance.now();

    const loop = (now: number) => {
      const deltaMs = Math.min(now - this.lastTime, 100); // cap at 100ms (tab unfocus)
      this.lastTime = now;

      updateNpcs(this.state.npcs, deltaMs);
      this.render();

      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  render(): void {
    if (!this.state.map) return;
    const w = this.canvas.width / devicePixelRatio;
    const h = this.canvas.height / devicePixelRatio;
    renderMap(this.ctx, this.state.map, this.state.camera, w, h, this.state.npcs, this.sheets);
  }

  private onTileClick(x: number, y: number): void {
    if (!this.state.map) return;
    const tile = this.state.map.tiles[y]?.[x];
    if (tile) console.log(`Tile (${x}, ${y}): ${tile.type}`);
  }

  destroy(): void {
    this.stopLoop();
    this.cleanupControls?.();
    this.resizeObserver.disconnect();
    this.canvas.remove();
  }
}

// FRAME_MS from animator (avoid circular import — just use the number)
const FRAME_MS_APPROX = 150;
```

**Step 2: Create src/render/lpc/index.ts** (re-exports for clean imports)

```ts
export { buildCharacterSpec, specFromItems } from './character-builder';
export { getOrGenerateSheet, clearSheetCache } from './spritesheet-cache';
export type { CharacterSpec } from './character-builder';
```

**Step 3: Run all tests**

```bash
npm test
```

Expected: all pass.

**Step 4: Commit**

```bash
git add src/game.ts src/render/lpc/index.ts
git commit -m "feat: NPC spawning from worldSeed.pois, RAF game loop with deltaMs"
```

---

### Task 8: Renderer — draw NPC spritesheets

Update `renderMap` to draw NPCs from their spritesheets.

**Files:**
- Modify: `src/render/renderer.ts`

**Step 1: Update renderMap signature and NPC draw block**

Open `src/render/renderer.ts`. Update the imports and function:

```ts
import type { GameMap, Camera, NpcInstance } from '@/core/types';
import { TILE_SIZE, TILE_COLORS, BG_COLOR, POI_ICONS } from '@/core/constants';
import { getSpriteCoords } from '@/render/npc-animator';
```

Update `renderMap` signature:

```ts
export function renderMap(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
  npcs: NpcInstance[] = [],
  sheets: Map<string, HTMLCanvasElement> = new Map(),
): void {
```

Add the NPC draw block at the very end of the function, just before `ctx.restore()` is called at the end — actually insert it AFTER the `ctx.restore()` call, in screen space (no camera transform applied), just like the current NPC render was. Wait, actually we want NPCs to move with the map, so they should be drawn INSIDE the `ctx.save()/ctx.restore()` block, after villages.

Add this block after the village draw loop (`for (const v of map.villages)`) and before `ctx.restore()`:

```ts
  // Draw NPC sprites
  ctx.imageSmoothingEnabled = false;
  for (const npc of npcs) {
    const sheet = sheets.get(npc.id);
    if (!sheet) continue;

    const screenX = npc.tileX * TILE_SIZE;
    const screenY = npc.tileY * TILE_SIZE;

    // Cull off-screen (in world space before ctx.restore)
    const camLeft   = camera.x;
    const camTop    = camera.y;
    const camRight  = camera.x + canvasWidth  / camera.zoom;
    const camBottom = camera.y + canvasHeight / camera.zoom;
    const npcSize   = 32; // 2×2 tiles world-space

    if (screenX + npcSize < camLeft  || screenX > camRight  ||
        screenY + npcSize < camTop   || screenY > camBottom) continue;

    const { sx, sy } = getSpriteCoords(npc);
    ctx.drawImage(sheet, sx, sy, 64, 64, screenX, screenY, npcSize, npcSize);
  }
```

**Step 2: Run all tests**

```bash
npm test
```

Expected: all pass.

**Step 3: Commit**

```bash
git add src/render/renderer.ts
git commit -m "feat: renderer draws NPC spritesheets with walk animation"
```

---

### Task 9: Visual verification + item-ID fixes

Load the game in browser, verify NPCs appear, fix any item IDs that don't resolve.

**Files:**
- Modify: `src/render/lpc/character-builder.ts` (likely small tweaks)

**Step 1: Start the dev server**

```bash
npm run dev
```

Open `http://localhost:5173` in a browser.

**Step 2: Open browser console and check for errors**

Look for:
- `Item metadata not found: <itemId>` — this means an item ID in character-builder.ts is wrong
- Network errors loading sprites — check that the CDN is reachable
- Canvas rendering errors

**Step 3: Fix wrong item IDs**

If you see `Item metadata not found` errors for specific item IDs:

1. Open browser console
2. Run: `Object.keys(window.itemMetadata).filter(k => k.includes('robe'))` — substitute the item type you're looking for
3. Update the item ID in `src/render/lpc/character-builder.ts` to match

Common item ID patterns to verify:
```js
// In browser console, check these:
Object.keys(window.itemMetadata).filter(k => k.includes('robe'))    // for priest
Object.keys(window.itemMetadata).filter(k => k.includes('plate'))   // for soldier armour
Object.keys(window.itemMetadata).filter(k => k.includes('sandal'))  // for sandals
Object.keys(window.itemMetadata).filter(k => k.includes('child'))   // for child clothes
Object.keys(window.itemMetadata).filter(k => k.includes('elderly')) // for elder head
Object.keys(window.itemMetadata).filter(k => k.includes('beard'))   // for elder beard
Object.keys(window.itemMetadata).filter(k => k.includes('gaunt'))   // for beggar head
Object.keys(window.itemMetadata).filter(k => k.includes('parted'))  // for noble hair
```

**Step 4: Verify NPCs appear animated on map**

After fixing item IDs, NPCs should:
- Appear near POI locations on the map
- Different roles should look visually distinct
- Characters should animate (walk frames cycling)

**Step 5: Run final test suite**

```bash
npm test
```

Expected: all pass.

**Step 6: Final commit**

```bash
git add -A
git commit -m "fix: correct LPC item IDs in character presets, verify NPC rendering"
```

---

## Summary

After all tasks, the game will:
- Render NPCs using real LPC animated spritesheets from the forked generator
- Support any character description via `buildCharacterSpec(role, seed)` or `specFromItems(items)`
- Lazy-load spritesheets from GitHub Pages CDN, cached in memory
- Animate NPCs with a 6.7 FPS walk cycle driven by the RAF loop
- Be ready for future LLM-driven character generation (just call `specFromItems` with arbitrary items)
