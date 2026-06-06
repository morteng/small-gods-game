# Building Sprite Proof — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Render generated building sprites in iso, replacing parametric massing where a sprite matches, falling back otherwise.

**Architecture:** Reuse the decoration slice's `AssetLibrary` + `ArtResolver` (score>0 gate). Generalize the resolver to a second `kind:'building'` instance; add a `resolveBuildingArt` hook; prefer the sprite at the iso building dispatch.

**Tech Stack:** TypeScript, Vite, Canvas2D iso renderer, Vitest. Sprites pre-generated at 128² via PixelLab into `tmp/pixellab-probe/`.

---

### Task 1: Seed building sprites into the base library

**Files:**
- Modify: `scripts/seed-base-library.mjs` (SEED table)
- Output: `public/asset-library/manifest.ndjson` + `public/asset-library/blobs/building-*.png`

- [ ] **Step 1:** Append three building rows to the `SEED` array. The `file` values are the already-generated 128px PNGs in `tmp/pixellab-probe/`. Use the EXACT prompts below (they must match the recorded provenance so an in-game regen dedupes):

```js
  { file: 'cottage-128.png', prompt: 'a small medieval cottage house with thatched roof and wooden walls, front view',
    width: 128, height: 128, kind: 'building', tags: ['cottage'],
    affinity: { era: ['medieval'] } },
  { file: 'temple_small-128.png', prompt: 'a small ancient stone temple with columns and a pediment roof, front view',
    width: 128, height: 128, kind: 'building', tags: ['temple_small'],
    affinity: { era: ['ancient', 'medieval'] } },
  { file: 'castle_keep-128.png', prompt: 'a tall stone castle keep tower with battlements and a wooden door, front view',
    width: 128, height: 128, kind: 'building', tags: ['castle_keep'],
    affinity: { era: ['medieval'] } },
```

- [ ] **Step 2:** Run `node scripts/seed-base-library.mjs`. Expected: `seeded 7 assets into …/public/asset-library` (4 decorations + 3 buildings) and three new `building-<sha>.png` blobs.

- [ ] **Step 3:** Verify the manifest has 7 lines and the three building lines carry `"kind":"building"`, `"width":128`, and the preset tag. Confirm the new blob files exist.

- [ ] **Step 4:** Commit.

```bash
git add scripts/seed-base-library.mjs public/asset-library/
git commit -m "feat(assets): seed 3 building sprites (128px) into base library"
```

---

### Task 2: Generalize ArtResolver with an assetKind

**Files:**
- Modify: `src/render/art-resolver.ts`
- Test: `tests/unit/art-resolver.test.ts`

- [ ] **Step 1:** Write a failing test: an `ArtResolver` constructed with `'building'` as a third arg requests `kind:'building'` from `pick`.

```ts
it('requests the configured assetKind (building)', async () => {
  const lib = fakeLib(null);
  const r = new ArtResolver(lib, 'pixel-art', 'building');
  await r.resolve(ent('cottage#1', 'cottage'));
  const req = (lib.pick as any).mock.calls[0][0];
  expect(req.kind).toBe('building');
  expect(req.tagsAny).toContain('cottage');
});

it('defaults assetKind to decoration', async () => {
  const lib = fakeLib(null);
  const r = new ArtResolver(lib, 'pixel-art');
  await r.resolve(ent('rock#1', 'rock'));
  expect((lib.pick as any).mock.calls[0][0].kind).toBe('decoration');
});
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/art-resolver.test.ts`. Expected: the building test FAILS (requests `decoration`).

- [ ] **Step 3:** Add the constructor param and use it. `AssetKind` is already exported from `@/core/types`.

```ts
import type { AssetKind, AssetStyle, Entity } from '@/core/types';
// ...
  constructor(
    private readonly lib: AssetLibrary,
    private readonly style: AssetStyle,
    private readonly assetKind: AssetKind = 'decoration',
  ) {}

  async resolve(e: Entity): Promise<string | null> {
    const cached = this.cache.get(e.id);
    if (cached !== undefined) return cached;
    const picked = await this.lib.pick({
      kind: this.assetKind,
      style: this.style,
      tagsAny: [e.kind],
      seed: hashStr(e.id),
    });
    const id = picked && picked.score > 0 ? picked.id : null;
    this.cache.set(e.id, id);
    return id;
  }
```

(If `AssetKind` is not the exported name, check `src/core/types.ts` — it is the union containing `'decoration'` and `'building'`.)

- [ ] **Step 4:** Run `npx vitest run tests/unit/art-resolver.test.ts`. Expected: PASS (all, including the existing default-decoration cases).

- [ ] **Step 5:** Commit.

```bash
git add src/render/art-resolver.ts tests/unit/art-resolver.test.ts
git commit -m "feat(render): ArtResolver takes an assetKind (default decoration)"
```

---

### Task 3: Add drawIsoBuildingSprite

**Files:**
- Modify: `src/render/iso/iso-building.ts` (new export `drawIsoBuildingSprite`)
- Test: `tests/unit/iso-building-sprite.test.ts` (create)

- [ ] **Step 1:** Write a failing test that the helper draws the image once, scaled to footprint, with smoothing off. Use a fake 2D context recording calls.

```ts
import { describe, it, expect, vi } from 'vitest';
import { drawIsoBuildingSprite } from '@/render/iso/iso-building';

function fakeCtx() {
  const calls: any[] = [];
  return {
    calls,
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(),
    beginPath: vi.fn(), ellipse: vi.fn(), fill: vi.fn(),
    drawImage: vi.fn((...a) => calls.push(['drawImage', ...a])),
    set imageSmoothingEnabled(v: boolean) { calls.push(['smoothing', v]); },
    get imageSmoothingEnabled() { return false; },
    fillStyle: '',
  } as any;
}

describe('drawIsoBuildingSprite', () => {
  it('draws the image once with smoothing disabled, width scaled to footprint', () => {
    const ctx = fakeCtx();
    const dc = { ctx, originX: 0, originY: 0 } as any;
    const img = { width: 128, height: 128 } as any;
    drawIsoBuildingSprite(dc, img, 4, 4, { w: 2, h: 2 });
    const draw = ctx.calls.find((c: any[]) => c[0] === 'drawImage');
    expect(draw).toBeTruthy();
    expect(ctx.calls.some((c: any[]) => c[0] === 'smoothing' && c[1] === false)).toBe(true);
    // displayW = (2+2) * (ISO_TILE_W/2) * 0.55 = 4 * 64 * 0.55 = 140.8
    const displayW = draw[4];
    expect(displayW).toBeCloseTo(140.8, 1);
    expect(draw[5]).toBeCloseTo(140.8, 1); // square
  });
});
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/iso-building-sprite.test.ts`. Expected: FAIL (`drawIsoBuildingSprite` not exported).

- [ ] **Step 3:** Add the export to `iso-building.ts`. It already imports `worldToScreen`, `ISO_TILE_H`, `IsoDrawCtx`; add `ISO_TILE_W` to the `iso-constants` import.

```ts
/** Pixel-art building sprite scaled to its footprint width, drawn as an upright
 *  billboard anchored bottom-center over the footprint, with a contact shadow.
 *  The proof's tunable: SPRITE_FOOTPRINT_FACTOR. Falls back to massing elsewhere. */
const SPRITE_FOOTPRINT_FACTOR = 0.55;

export function drawIsoBuildingSprite(
  dc: IsoDrawCtx, img: HTMLImageElement,
  tileX: number, tileY: number, footprint: { w: number; h: number },
): void {
  const { ctx, originX, originY } = dc;
  const { w, h } = footprint;
  const center = worldToScreen(tileX + w / 2, tileY + h / 2, 0, originX, originY);
  const displayW = (w + h) * (ISO_TILE_W / 2) * SPRITE_FOOTPRINT_FACTOR;
  const displayH = displayW; // square 128² source
  ctx.save();
  ctx.translate(center.sx, center.sy);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 0, displayW * 0.34, displayW * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, -displayW / 2, -displayH, displayW, displayH);
  ctx.restore();
}
```

- [ ] **Step 4:** Run `npx vitest run tests/unit/iso-building-sprite.test.ts`. Expected: PASS.

- [ ] **Step 5:** Commit.

```bash
git add src/render/iso/iso-building.ts tests/unit/iso-building-sprite.test.ts
git commit -m "feat(iso): drawIsoBuildingSprite — footprint-scaled building billboard"
```

---

### Task 4: Wire resolveBuildingArt through RenderContext + game.ts, prefer sprite in iso

**Files:**
- Modify: `src/core/types.ts` (RenderContext field)
- Modify: `src/game/render-context.ts` (dep + hook)
- Modify: `src/game.ts` (buildingArtResolver field + construction + clear)
- Modify: `src/render/iso/iso-renderer.ts` (dispatch)
- Test: `tests/unit/render-context.test.ts` (extend)

- [ ] **Step 1:** In `src/core/types.ts`, beside `resolveEntityArt?`, add:

```ts
  /** Render-only: building entity → generated sprite image, or null to fall back to massing. */
  resolveBuildingArt?: (entity: Entity) => HTMLImageElement | null;
```

- [ ] **Step 2:** In `src/game.ts`, mirror `artResolver`. Add a field `buildingArtResolver!: ArtResolver;`. Where `generateWorld` constructs `this.artResolver = new ArtResolver(this.assetLibrary, 'pixel-art');`, add:

```ts
    this.buildingArtResolver = new ArtResolver(this.assetLibrary, 'pixel-art', 'building');
```

Wherever `this.artResolver.clear()` is called on world reset, also call `this.buildingArtResolver?.clear()`. (Search `artResolver` in `game.ts` to find both sites.)

- [ ] **Step 3:** In `src/game/render-context.ts`, add `buildingArtResolver: ArtResolver` to the deps interface and the call site (passed from `game.ts`). Add the hook next to `resolveEntityArt`, reusing the same `ArtImageCache`-backed image lookup. The existing `resolveEntityArt` resolves an assetId via the resolver then turns it into an image via the decoration image cache — `resolveBuildingArt` does the same but with `buildingArtResolver`:

```ts
    resolveBuildingArt: (entity: Entity) => {
      const id = buildingArtResolver.peek(entity);
      if (id) return decorationImages.get(id);  // shared kind-agnostic image cache
      buildingArtResolver.warm(entity); // fire-and-forget; never blocks the frame
      return null;
    },
```

The existing `resolveEntityArt` (render-context.ts:42-46) is the exact template: it does
`artResolver.peek` → `decorationImages.get(id)` → else `artResolver.warm`. `decorationImages`
is a kind-agnostic `ArtImageCache` keyed by assetId, so reuse it for buildings too. Add
`buildingArtResolver` to the destructured `deps` on line 23.

- [ ] **Step 4:** In `src/render/iso/iso-renderer.ts`, import `drawIsoBuildingSprite`. At the building dispatch (currently `if (b) drawIsoBuildingMassing(...)`), prefer the sprite:

```ts
      if (e.kind === 'building') {
        const b = buildingById.get(e.id);
        if (b) {
          const art = rc.resolveBuildingArt?.(b.e) ?? null;
          if (art) {
            drawIsoBuildingSprite(drawCtx, art, Math.floor(b.e.x), Math.floor(b.e.y), b.massing.footprint);
          } else {
            drawIsoBuildingMassing(drawCtx, b.massing, Math.floor(b.e.x), Math.floor(b.e.y));
          }
        }
      } else if (e.kind === 'npc') {
```

- [ ] **Step 5:** Extend `tests/unit/render-context.test.ts`: when `buildingArtResolver.peek` returns an id and the image cache has it, `resolveBuildingArt(e)` returns the image; when peek returns null it returns null and calls `warm`. (Mirror the existing `resolveEntityArt` test in that file; if none exists, add a focused one using fakes.)

- [ ] **Step 6:** Run `npx vitest run tests/unit/render-context.test.ts tests/unit/iso-ysort.test.ts`. Expected: PASS.

- [ ] **Step 7:** Type-check + build: `npm run build`. Expected: clean.

- [ ] **Step 8:** Commit.

```bash
git add src/core/types.ts src/game.ts src/game/render-context.ts src/render/iso/iso-renderer.ts tests/unit/render-context.test.ts
git commit -m "feat(iso): resolveBuildingArt — prefer generated building sprite over massing"
```

---

### Task 5: Full suite + manual playtest note

- [ ] **Step 1:** `npm test`. Expected: all green (1411 + new tests).
- [ ] **Step 2:** Report the manual playtest steps: `npm run dev` (port 3000, iso) → New World → confirm cottages/temple/keep render as sprites where those presets are placed, other presets still draw massing. Note `SPRITE_FOOTPRINT_FACTOR` (iso-building.ts) as the scale knob to tune by eye.

---

## Self-review notes

- **Spec coverage:** seed (T1), resolver kind (T2), sprite draw (T3), wiring + dispatch (T4), suite (T5) — all spec components covered.
- **Type consistency:** `AssetKind` from `@/core/types`; `b.massing.footprint` is `{w,h}` (verified in `building-massing-model.ts`); `drawIsoBuildingSprite(dc, img, tileX, tileY, footprint)` signature consistent T3↔T4.
- **No-behaviour-change guard:** ArtResolver default arg keeps the decoration resolver identical; buildings with no seeded sprite hit the `score>0`/null path → massing fallback.
- **WIP guard:** do NOT stage any `src/ui/*` file (unrelated uncommitted WIP in the tree).
