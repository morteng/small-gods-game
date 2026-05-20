# Iso Terrain Art Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivot PR 2 from the (superseded) composer + 5×3 primitive sheet approach to PixelLab's `create-tileset` endpoint + iso warp post-process. Ship the 6 iso terrain atlas PNGs and the rebuilt baking script.

**Architecture:** Drop `blob-composer.ts` + its tests. Rewrite `scripts/gen-iso-terrain.ts` to call `POST /v2/create-tileset` (Wang format) once per terrain type with inner/outer terrain descriptions, then apply 45° + 2:1 vertical squash warp per cell, write to `public/sprites/iso/terrain/<type>-blob47.png`. Atlas-loader, iso-renderer factory, and select-renderer wiring stay as-is from Tasks 4–8 of the (superseded) plan.

**Tech Stack:** TypeScript, `@napi-rs/canvas`, PixelLab `create-tileset` API.

**Spec:** [docs/superpowers/specs/2026-05-18-iso-terrain-art-pivot-design.md](../specs/2026-05-18-iso-terrain-art-pivot-design.md)
**Superseded plan:** [2026-05-18-iso-terrain-art.md](2026-05-18-iso-terrain-art.md) (Tasks 1–8 kept, Tasks 9–14 replaced by this plan)

---

## What's already on the branch

`feat/iso-terrain-art` at `75b590d` contains:
- Composer module + 15 tests (gets deleted in Task P1)
- `BLOB_INDEX_MAP_FOR_TEST` export in `blob-autotiler.ts` (kept or removed in P1)
- Atlas-loader + 5 tests (KEEP, no change)
- iso-terrain.ts blobMap wiring + 3 tests (KEEP, no change)
- iso-renderer factory + 2 tests (KEEP, no change)
- select-renderer atlas loading (KEEP, no change)
- package.json devDeps + `gen:iso-terrain` script (KEEP)
- `var/` gitignore (KEEP)
- The current `scripts/gen-iso-terrain.ts` (gets rewritten in Task P3)

Full suite: 637/637. Build: clean except known e2e noise.

## Task P1: Delete composer module + tests

**Files:**
- Delete: `src/render/iso/blob-composer.ts`
- Delete: `tests/unit/blob-composer.test.ts`
- Modify: `src/map/blob-autotiler.ts` (remove `BLOB_INDEX_MAP_FOR_TEST` export — the composer was its only consumer)

- [ ] **Step P1.1: Delete the files**

```bash
git rm src/render/iso/blob-composer.ts
git rm tests/unit/blob-composer.test.ts
```

- [ ] **Step P1.2: Remove the `BLOB_INDEX_MAP_FOR_TEST` export**

Open `src/map/blob-autotiler.ts`. Find the lines that look like:

```ts
/**
 * Test-only / composer export of the 256-entry blob mask → variant table.
 * Production code should prefer computeBlobMap() which encapsulates corner
 * cleanup and the % 47 reduction.
 */
export const BLOB_INDEX_MAP_FOR_TEST: readonly number[] = BLOB_INDEX_MAP;
```

Delete those lines (the `BLOB_INDEX_MAP` const itself stays — it's used internally by `blobIndexFromMask`).

- [ ] **Step P1.3: Run the full suite, expect drop from 637 → 622**

```bash
npm test 2>&1 | tail -5
```

Expected: 622 passing (637 - 15 composer tests). All previously-passing tests still pass.

- [ ] **Step P1.4: Run the TypeScript build check**

```bash
npm run build 2>&1 | grep -E "^(src|tests/(unit|integration|dom))" | head
```

Expected: empty (no errors outside the pre-existing `tests/e2e/map-generation.spec.ts` noise).

- [ ] **Step P1.5: Commit**

```bash
git add src/map/blob-autotiler.ts
git commit -m "revert(blob-composer): drop module — superseded by PixelLab create-tileset pivot"
```

Include the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` footer.

---

## Task P2: Rewrite gen-iso-terrain.ts to call create-tileset

**Files:**
- Modify: `scripts/gen-iso-terrain.ts` (full rewrite of the body; keep the file's header/import block patterns)

The new script makes one `POST /v2/create-tileset` call per terrain type. Response is a Wang-format top-down tileset PNG. The script keeps the existing structure (disk cache by SHA-256 of canonical request body, `--type=<name>` flag, `--dry-run`, `ensureDir`, `bakeOne` per type) but swaps the API surface and adds the iso-warp post-process.

- [ ] **Step P2.1: Replace the file content**

Open `scripts/gen-iso-terrain.ts` and replace its body with the following. The header (imports, `__dirname`, paths, ensureDir helper) stays similar; the per-type recipes, the `fetchTileset` function, and the `bakeOne` function are the substantive changes:

```ts
/**
 * Author-time iso terrain baker — pivot to PixelLab create-tileset.
 *
 * Per terrain type:
 *   1. Build a create-tileset request body (inner + outer + style + seed).
 *   2. SHA-256 the canonical request as cache key.
 *   3. Hit cache at var/iso-terrain-cache/<sha>.png if present; else POST to PixelLab.
 *   4. Decode the Wang-format top-down tileset PNG.
 *   5. For each of 47 cells, look up its blob47 index via WANG_TO_BLOB47 (permutation
 *      table, see Task P4), apply iso warp (45° rotate + 2:1 vertical squash),
 *      stamp into the output atlas at (blob47 % 6, blob47 / 6) × (128, 64).
 *   6. Write public/sprites/iso/terrain/<type>-blob47.png.
 *
 * Run: PIXELLAB_API_KEY=… npm run gen:iso-terrain
 * Single type: npm run gen:iso-terrain -- --type=grass
 * Dry-run: npm run gen:iso-terrain -- --dry-run
 */
import { createCanvas, loadImage, type Image as NodeImage } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { ISO_TERRAIN_TYPES, type IsoTerrainType } from '../src/render/iso/iso-atlas-loader';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DISK_CACHE = join(PROJECT_ROOT, 'var/iso-terrain-cache');
const OUTPUT_DIR = join(PROJECT_ROOT, 'public/sprites/iso/terrain');

const PIXELLAB_API_BASE = 'https://api.pixellab.ai/v2';

const CELL_W = 128;
const CELL_H = 64;
const ATLAS_COLS = 6;
const OUTPUT_W = ATLAS_COLS * CELL_W;
const OUTPUT_H = 8 * CELL_H;

/** Per-type inner/outer + seed. Outer is the visually adjacent terrain. */
const TYPE_RECIPES: Record<IsoTerrainType, { inner: string; outer: string; seed: number }> = {
  grass: { inner: 'lush grass meadow', outer: 'bare brown dirt soil',  seed: 1001 },
  dirt:  { inner: 'bare brown dirt soil', outer: 'lush grass meadow',  seed: 1002 },
  water: { inner: 'calm blue water with subtle waves', outer: 'pale sandy beach', seed: 1003 },
  sand:  { inner: 'pale sandy beach', outer: 'bare brown dirt soil', seed: 1004 },
  stone: { inner: 'cobblestone paved floor', outer: 'bare brown dirt soil', seed: 1005 },
  rocky: { inner: 'rugged grey stone boulders and gravel', outer: 'lush grass meadow', seed: 1006 },
};

const STYLE_RECIPE = {
  outline: 'single color black outline',
  shading: 'basic shading',
  detail: 'medium detail',
} as const;

/**
 * Wang-cell-index → blob47-index permutation. Populated in Task P4 after
 * inspecting the first create-tileset response. Until populated, the loop
 * uses identity (Wang i → blob47 i), which produces a misaligned atlas;
 * Task P4 explicitly fixes this.
 */
const WANG_TO_BLOB47: number[] = Array.from({ length: 47 }, (_, i) => i);

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function buildRequestBody(type: IsoTerrainType): unknown {
  const r = TYPE_RECIPES[type];
  return {
    inner: r.inner,
    outer: r.outer,
    tile_layout: 'wang',
    // Per docs, the tile_size field controls per-cell pixel size.
    // 64×64 keeps the response under the 400×400 cap for any reasonable
    // grid layout (a 47-cell Wang grid at 64px is ~448×448 in worst-case
    // arrangement; some tile_layout responses pack cells differently).
    // If the response comes back as a single big PNG larger than 400×400,
    // fall back to tile_size: 32.
    tile_size: { width: 64, height: 64 },
    outline: STYLE_RECIPE.outline,
    shading: STYLE_RECIPE.shading,
    detail: STYLE_RECIPE.detail,
    seed: r.seed,
  };
}

function canonicalCacheKeyInput(body: unknown): string {
  return JSON.stringify({ v: 'pivot-v1', body });
}

async function fetchTileset(type: IsoTerrainType): Promise<Buffer> {
  const body = buildRequestBody(type);
  const sha = sha256Hex(canonicalCacheKeyInput(body));
  const cachePath = join(DISK_CACHE, `tileset-${sha}.png`);

  if (existsSync(cachePath)) {
    console.log(`[gen-iso-terrain] ${type}: tileset cache hit (${sha.substring(0, 8)})`);
    return readFileSync(cachePath);
  }

  if (process.argv.includes('--dry-run')) {
    throw new Error(`[gen-iso-terrain] ${type}: cache miss and --dry-run set; would have called PixelLab`);
  }

  const apiKey = process.env.PIXELLAB_API_KEY;
  if (!apiKey) throw new Error('PIXELLAB_API_KEY env var not set');

  console.log(`[gen-iso-terrain] ${type}: calling PixelLab create-tileset (sha ${sha.substring(0, 8)})`);
  const res = await fetch(`${PIXELLAB_API_BASE}/create-tileset`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PixelLab HTTP ${res.status}: ${text}`.trim());
  }
  const json = (await res.json()) as { image?: { base64?: string } };
  const b64 = json.image?.base64;
  if (!b64) throw new Error('PixelLab response missing image.base64');

  const buf = Buffer.from(b64, 'base64');
  writeFileSync(cachePath, buf);
  console.log(`[gen-iso-terrain] ${type}: tileset cached at ${cachePath}`);
  return buf;
}

/**
 * Slice the Wang tileset PNG into 47 cells.
 *
 * The exact layout (cells per row, per col) depends on PixelLab's response.
 * Task P4's first-call inspection determines this. Default assumption:
 * a roughly square grid like 7×7 = 49 with 2 empty padding cells.
 *
 * Returns: an array of 47 cell canvases (or nulls for cells not yet
 * mapped via WANG_TO_BLOB47 above identity).
 */
function sliceWangTileset(img: NodeImage): NodeImage[] {
  // Determine grid layout from image dimensions. PixelLab typically packs
  // tilesets as roughly-square grids; compute the per-cell size.
  // This function will need an adjustment in Task P4 once we see the
  // actual response layout — for now, assume 7 cols × 7 rows with the
  // per-cell size = image.width / 7.
  const COLS = 7;
  const ROWS = 7;
  const cellW = Math.floor(img.width / COLS);
  const cellH = Math.floor(img.height / ROWS);
  const cells: NodeImage[] = [];
  // Composite each cell onto its own small canvas. The first 47 cells
  // in row-major order are the Wang transitions; any extras are padding.
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (cells.length >= 47) break;
      const cellCanvas = createCanvas(cellW, cellH);
      const ctx = cellCanvas.getContext('2d');
      ctx.drawImage(img, c * cellW, r * cellH, cellW, cellH, 0, 0, cellW, cellH);
      // Cast through unknown — node-canvas's Canvas can be loaded back as an Image.
      cells.push(cellCanvas as unknown as NodeImage);
    }
  }
  return cells;
}

/**
 * Apply iso warp: 45° rotate + 2:1 vertical squash, resampled to 128×64.
 */
function isoWarp(cell: NodeImage, outW = CELL_W, outH = CELL_H): NodeImage {
  // Lift the cell to a square canvas (max of its width/height).
  const inSize = Math.max(cell.width, cell.height);
  const squared = createCanvas(inSize, inSize);
  const sCtx = squared.getContext('2d');
  sCtx.drawImage(cell, (inSize - cell.width) / 2, (inSize - cell.height) / 2);

  // Rotated canvas: rotate 45° around centre. Bounding box of a rotated
  // square is inSize * sqrt(2).
  const diag = Math.ceil(inSize * Math.SQRT2);
  const rot = createCanvas(diag, diag);
  const rCtx = rot.getContext('2d');
  rCtx.translate(diag / 2, diag / 2);
  rCtx.rotate(Math.PI / 4);
  rCtx.drawImage(squared as unknown as NodeImage, -inSize / 2, -inSize / 2);

  // Final: scale to outW × outH (the 2:1 squash happens automatically
  // because the rotated bbox is square but the output is 2:1).
  const out = createCanvas(outW, outH);
  const oCtx = out.getContext('2d');
  oCtx.drawImage(rot as unknown as NodeImage, 0, 0, diag, diag, 0, 0, outW, outH);
  return out as unknown as NodeImage;
}

async function bakeOne(type: IsoTerrainType): Promise<void> {
  const tilesetBuf = await fetchTileset(type);
  const tilesetImg = await loadImage(tilesetBuf);
  const cells = sliceWangTileset(tilesetImg);

  const atlas = createCanvas(OUTPUT_W, OUTPUT_H);
  const aCtx = atlas.getContext('2d');

  for (let wangIdx = 0; wangIdx < cells.length; wangIdx++) {
    const blob47 = WANG_TO_BLOB47[wangIdx] ?? wangIdx;
    if (blob47 < 0 || blob47 > 46) continue;
    const col = blob47 % ATLAS_COLS;
    const row = Math.floor(blob47 / ATLAS_COLS);
    const warped = isoWarp(cells[wangIdx]);
    aCtx.drawImage(warped, col * CELL_W, row * CELL_H);
  }

  const outPath = join(OUTPUT_DIR, `${type}-blob47.png`);
  ensureDir(dirname(outPath));
  const buf = atlas.toBuffer('image/png');
  writeFileSync(outPath, buf);
  console.log(`[gen-iso-terrain] ${type}: wrote ${outPath} (${(buf.length / 1024).toFixed(1)} KB)`);
}

async function main(): Promise<void> {
  ensureDir(DISK_CACHE);
  ensureDir(OUTPUT_DIR);
  const typeArg = process.argv.find((a) => a.startsWith('--type='));
  const onlyType = typeArg ? typeArg.split('=')[1] as IsoTerrainType : null;
  const types = onlyType
    ? [onlyType].filter((t) => (ISO_TERRAIN_TYPES as readonly string[]).includes(t)) as IsoTerrainType[]
    : ISO_TERRAIN_TYPES;
  for (const type of types) {
    try {
      await bakeOne(type);
    } catch (err) {
      console.error(`[gen-iso-terrain] ${type} FAILED:`, (err as Error).message);
      if (!process.argv.includes('--continue-on-error')) process.exit(1);
    }
  }
  console.log('[gen-iso-terrain] done');
}

main().catch((err) => {
  console.error('[gen-iso-terrain] fatal:', err);
  process.exit(1);
});
```

- [ ] **Step P2.2: Verify dry-run still works**

```bash
npm run gen:iso-terrain -- --dry-run --type=grass 2>&1 | head -5
```

Expected: `[gen-iso-terrain] grass FAILED: cache miss and --dry-run set; would have called PixelLab` and exit code 1. This confirms the disk-cache miss path is wired correctly.

- [ ] **Step P2.3: Commit**

```bash
git add scripts/gen-iso-terrain.ts
git commit -m "feat(gen-iso-terrain): rewrite for create-tileset endpoint + iso warp"
```

Include the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` footer.

---

## Task P3: First real `create-tileset` call + Wang layout discovery

**Files:**
- Modify: `scripts/gen-iso-terrain.ts` (adjust `COLS`/`ROWS` in `sliceWangTileset` if needed)

This task requires `PIXELLAB_API_KEY` and is the discovery step that locks the Wang-cell layout for the script's slicer.

- [ ] **Step P3.1: Run the script for grass**

```bash
PIXELLAB_API_KEY=<key> npm run gen:iso-terrain -- --type=grass
```

Possible outcomes:

- **HTTP 403** → user's PixelLab tier doesn't include `create-tileset`. Stop and notify the user; they need a Tier 1+ subscription.
- **HTTP 422 with field-name issue** → the actual `create-tileset` body fields differ from our guess. Read the response body, adjust `buildRequestBody`, re-run.
- **HTTP 200** but the generated `grass-blob47.png` looks visually wrong (cells offset, jumbled, partially blank) → Wang layout doesn't match the script's `COLS=7, ROWS=7` assumption. Continue to Step P3.2.
- **HTTP 200** and the PNG looks roughly right → proceed to Step P4.

- [ ] **Step P3.2: Inspect the raw tileset response**

The script writes the raw PixelLab response to `var/iso-terrain-cache/tileset-<sha>.png`. Open this file in an image viewer. Note:
- Total image dimensions (width × height)
- Per-cell size (width / cols × height / rows — count by eye)
- Grid layout: 7×7? 6×8? 5×10?
- Cell ordering — which cell is "fully surrounded" vs "isolated" vs each edge/corner type. PixelLab's Wang format may have a documented order (consult `pixellab.ai/docs/tools/create-tileset` again if needed).

Adjust `COLS`, `ROWS` constants in `sliceWangTileset` to match the actual layout.

- [ ] **Step P3.3: Re-run, expect a coherent output PNG**

```bash
rm public/sprites/iso/terrain/grass-blob47.png
npm run gen:iso-terrain -- --type=grass
```

(Disk cache hit on the PixelLab response — no second API call.) Inspect `public/sprites/iso/terrain/grass-blob47.png`. Cells should be visually distinct (different blob topologies) even if the Wang↔blob47 permutation isn't yet correct.

- [ ] **Step P3.4: Commit the slicer adjustment**

```bash
git add scripts/gen-iso-terrain.ts
git commit -m "fix(gen-iso-terrain): correct Wang grid layout per actual response"
```

Include the `Co-Authored-By` footer.

---

## Task P4: Build the Wang→blob47 permutation table

**Files:**
- Modify: `scripts/gen-iso-terrain.ts` (populate `WANG_TO_BLOB47`)

The script's output atlas has cells in the right blob47 positions BY blob index, but each cell currently has the wrong topology because Wang ordering ≠ our blob47 indexing. This task discovers the permutation and hardcodes it.

- [ ] **Step P4.1: Determine the Wang cell ordering**

Open PixelLab's docs page for `create-tileset` (https://www.pixellab.ai/docs/tools/create-tileset) and find the "Wang tileset format" reference. Common conventions:
- Cells indexed by which corners are filled (NW, NE, SW, SE) → 16 corner combinations, multiplied by edge variants → 47 total
- OR cells ordered by 8-neighbor mask in a specific bit order

If the docs are vague, the empirical method:
1. Generate a tileset with high-contrast inner/outer (e.g. inner=`white`, outer=`black`) — this makes topology visually obvious
2. Number each of the 47 cells in the response image
3. For each Wang cell index, identify what 8-neighbor topology it depicts (e.g. "all 4 cardinals + all 4 diagonals filled" = mask 0xFF)
4. Find which blob47 index the autotiler assigns to that topology: `BLOB_INDEX_MAP[mask] % 47` (this requires temporarily re-exporting `BLOB_INDEX_MAP` from `blob-autotiler.ts`, or just running a small inline node script)
5. Map Wang cell N → blob47 index M

Result: a 47-entry `WANG_TO_BLOB47` array. Hardcode it in the script.

- [ ] **Step P4.2: Re-bake grass with the corrected permutation**

```bash
rm public/sprites/iso/terrain/grass-blob47.png
npm run gen:iso-terrain -- --type=grass
```

(Still a cache hit on the PixelLab call.) Inspect the output PNG. Cells should now be in the right blob47 positions for the topology they depict.

- [ ] **Step P4.3: Browser smoke**

```bash
npm run dev
```

In another terminal, open the URL Vite prints. In devtools:

```js
localStorage.setItem('smallgods.render.mode', 'iso'); location.reload();
```

Walk the camera over a grass area. Tiles should butt up correctly — grass tiles bordering dirt should show transition art, fully-surrounded grass should be uniform interior art, isolated grass should look like a tuft. If transitions are visibly wrong (e.g. an "interior" cell appearing at a border tile), the permutation table is still off — iterate.

- [ ] **Step P4.4: Commit the permutation table**

```bash
git add scripts/gen-iso-terrain.ts public/sprites/iso/terrain/grass-blob47.png
git commit -m "feat(iso-terrain): bake grass-blob47.png via create-tileset + Wang→blob47 map"
```

Include the `Co-Authored-By` footer.

---

## Task P5: Bake remaining 5 terrains

- [ ] **Step P5.1: Run for the rest**

```bash
PIXELLAB_API_KEY=<key> npm run gen:iso-terrain
```

This makes 5 API calls (grass hits the disk cache). Each writes a PNG to `public/sprites/iso/terrain/`.

- [ ] **Step P5.2: Browser smoke for each terrain**

Reload the iso view, walk the camera through areas with water/sand transitions, dirt/grass, stone/dirt, rocky/grass. Look for visible seams or topology errors. If any single terrain looks broken, iterate its prompt in `TYPE_RECIPES`, delete its cache + output, re-run.

- [ ] **Step P5.3: Commit the remaining 5 PNGs**

```bash
git add public/sprites/iso/terrain/water-blob47.png public/sprites/iso/terrain/sand-blob47.png public/sprites/iso/terrain/dirt-blob47.png public/sprites/iso/terrain/stone-blob47.png public/sprites/iso/terrain/rocky-blob47.png
git commit -m "feat(iso-terrain): bake water/sand/dirt/stone/rocky blob47 atlases"
```

Include the `Co-Authored-By` footer.

---

## Task P6: Verification sweep + PR description

- [ ] **Step P6.1: Full test suite**

```bash
npm test 2>&1 | tail -5
```

Expected: 622/622 passing (637 - 15 composer tests deleted in P1 — verify count matches).

- [ ] **Step P6.2: Build sanity**

```bash
npm run build 2>&1 | grep -E "^(src|tests/(unit|integration|dom))" | head
```

Expected: empty.

- [ ] **Step P6.3: Fallback smoke**

Temporarily move `public/sprites/iso/terrain/grass-blob47.png` out of the way; reload. Expected: one console.warn about grass, grass tiles render as flat-color diamonds, other terrains still show art. Restore the file.

- [ ] **Step P6.4: Topdown restoration smoke**

```js
localStorage.removeItem('smallgods.render.mode'); location.reload();
```

Expected: top-down renderer restored. No regressions.

- [ ] **Step P6.5: Write the PR description**

Title: `feat(iso): terrain art — create-tileset + iso warp (PR 2 of iso renderer)`

Body template (paste, customize the "screenshots" placeholder):

```markdown
## Summary

PR 2 of 7 in the iso renderer track. Adds real iso terrain art via PixelLab's `create-tileset` endpoint + a 45° + 2:1 vertical squash post-warp:
- 6 atlas PNGs at `public/sprites/iso/terrain/<type>-blob47.png` (water, sand, dirt, grass, stone, rocky)
- `scripts/gen-iso-terrain.ts` — author-time pipeline (PixelLab tileset → slice → warp → atlas)
- `src/render/iso/iso-atlas-loader.ts` — runtime parallel PNG loader → IsoAtlas
- `iso-renderer` refactored to a `createIsoRenderMap(atlas)` factory
- `iso-terrain.ts` consumes `rc.blobMap[ty][tx].blobIndex`

Behind the existing `localStorage.smallgods.render.mode='iso'` dev flag. Top-down unchanged.

## Pivot note

The earlier same-day approach used a custom composer + 5×3 primitive sheet via `create-image-pixflux`. That hit API constraints (image_size ≤ 400, view enum has no iso). Deeper API-doc reading turned up `create-tileset` which natively does Wang/47-blob transitions. The composer + its 15 tests were reverted; atlas-loader, iso-terrain wiring, and iso-renderer factory (Tasks 4–8) stayed because they're create-tileset-agnostic.

## Spec / plan

- Pivot spec: `docs/superpowers/specs/2026-05-18-iso-terrain-art-pivot-design.md`
- Pivot plan: `docs/superpowers/plans/2026-05-18-iso-terrain-art-pivot.md`
- (Original spec/plan kept for history with SUPERSEDED notes.)

## Test plan

- [x] `npm test` — N passing (down from 637 by 15 deleted composer tests)
- [x] `npm run build` — clean (modulo pre-existing e2e/map-generation.spec.ts errors)
- [x] Manual smoke: iso flag on → real art for all 6 types, transitions look reasonable
- [x] Manual smoke: removing one atlas PNG → that type falls back to diamonds, others unaffected, single `console.warn`
- [x] Manual smoke: removing flag → top-down restored, no regression

## Screenshots

before/after of an area with grass/dirt/water transitions
```

- [ ] **Step P6.6: Final task commit**

If using subagent-driven-development, mark complete with an empty commit:

```bash
git commit --allow-empty -m "chore: iso terrain art PR 2 (pivot) complete — see PR description"
```

---

## Self-review against the pivot spec

- **Composer deletion** — Task P1.
- **`create-tileset` integration** — Tasks P2, P3.
- **Iso warp post-process** — Task P2's `isoWarp` function.
- **Wang→blob47 permutation table** — Task P4.
- **6 committed PNGs** — Tasks P4 (grass), P5 (rest).
- **Atlas-loader / iso-renderer / select-renderer untouched** — by design; verified by P6.1's "622 passing" target.
- **Per-type fallback** — preserved via the existing atlas-loader behavior; verified by P6.3.
- **Risk: Tier 1 subscription required** — surfaced as a Task P3.1 failure mode with clear error path.
- **Risk: Wang layout unknown** — surfaced as P3.2's inspection step.
- **Risk: warp quality** — smoke-checked in P4.3 and P5.2.

No placeholders. The `WANG_TO_BLOB47` table starts as identity in P2 and is populated for real in P4 — this is sequenced, not deferred.
