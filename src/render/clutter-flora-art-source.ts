// src/render/clutter-flora-art-source.ts
// Ground-flora billboards sliced from the harvested clutter atlas
// (public/textures/clutter/atlas.png + manifest.json — the same art the GPU
// standing-grass scatter draws). Herb/grass/fern species are MANY and tiny;
// composing each through the parametric manifold pipeline bought nothing over
// the atlas art while charging boot-compose CPU per species. This source
// replaces that path: per (species, variant) it returns an albedo-only
// SpritePack sliced from a deterministically-chosen atlas cell, so the draw
// list keeps its y-sorted plantSpriteItemFromPack treatment (foot anchor,
// shadow-skip, ground contact, wind sway) with zero compose cost.
//
// Loading is one async fetch (kicked by warm(), memoised); until it lands
// peek() returns null and the draw list falls back to the flat billboard —
// never a grey box, never invisible. The loader + slicer are injectable seams
// so node tests feed a fake manifest/canvas (jsdom has neither fetch-able
// assets nor getImageData).
import type { ClutterManifest, ClutterCat } from '@/render/gpu/grass-scatter';
import type { SpriteCanvas, SpritePack } from '@/render/iso/sprite-canvas';
import { makeCanvas } from '@/render/iso/sprite-canvas';
import { assetUrl } from '@/core/asset-url';
import { getFloraSpecies, floraGenParams } from '@/flora/flora-registry';
import { floraVariantBucket } from '@/render/flora-variant';
import { mToPx } from '@/render/scale-contract';

/** Reed-reading species pinned to the atlas' tall-stalk cells; every other
 *  clutter species maps by habit (herb→flower, grass/fern→grass — the atlas
 *  has no fern category and its grass tufts read closest). */
const SPECIES_CAT: Record<string, ClutterCat> = {
  'common-reed': 'reed',
  'bulrush': 'reed',
  'carex-sedge': 'reed',
};

/** Atlas category for a ground-flora species id, or null for species that do
 *  not billboard from the atlas (trees/shrubs/rocks/unknown). */
export function clutterCategoryFor(kind: string): ClutterCat | null {
  const pinned = SPECIES_CAT[kind];
  if (pinned) return pinned;
  switch (getFloraSpecies(kind)?.botanical.habit) {
    case 'herb': return 'flower';
    case 'grass':
    case 'fern': return 'grass';
    default: return null;
  }
}

export interface ClutterAtlas {
  image: CanvasImageSource;
  manifest: ClutterManifest;
}

export interface ClutterFloraDeps {
  /** Async atlas loader (default: fetch atlas.png + manifest.json). Null ⇒ the
   *  source stays cold and every peek() misses (billboard fallback). */
  load?: () => Promise<ClutterAtlas | null>;
  /** Cell → cropped, height-scaled sprite canvas (default needs a 2D canvas;
   *  jsdom tests inject a fake). Null ⇒ that (kind, variant) caches a miss. */
  slice?: (atlas: ClutterAtlas, cellIndex: number, targetPxH: number) => SpriteCanvas | null;
  /** Fires once the atlas lands (bumps version() too) — wire to requestRender
   *  so an idle frame loop repaints with the real sprites. */
  onWarm?: () => void;
}

async function defaultLoad(): Promise<ClutterAtlas | null> {
  if (typeof fetch === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  try {
    const [aResp, mResp] = await Promise.all([
      fetch(assetUrl('textures/clutter/atlas.png')),
      fetch(assetUrl('textures/clutter/manifest.json')),
    ]);
    if (!aResp.ok || !mResp.ok) return null;
    const manifest = await mResp.json() as ClutterManifest;
    const image = await createImageBitmap(await aResp.blob(), {
      premultiplyAlpha: 'none', colorSpaceConversion: 'none',
    });
    return { image, manifest };
  } catch {
    return null;
  }
}

/** Crop atlas cell `cellIndex` to its opaque bbox, then nearest-neighbour scale
 *  to `targetPxH` tall (aspect preserved) so a 64px cell lands at the species'
 *  metric height on screen. */
function defaultSlice(atlas: ClutterAtlas, cellIndex: number, targetPxH: number): SpriteCanvas | null {
  const m = atlas.manifest;
  const col = cellIndex % m.cols, row = (cellIndex / m.cols) | 0;
  const cell = makeCanvas(m.cell, m.cell);
  const cctx = cell?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!cell || !cctx || typeof cctx.getImageData !== 'function') return null;
  cctx.drawImage(atlas.image, col * m.cell, row * m.cell, m.cell, m.cell, 0, 0, m.cell, m.cell);
  const px = cctx.getImageData(0, 0, m.cell, m.cell).data;
  let x0 = m.cell, y0 = m.cell, x1 = -1, y1 = -1;
  for (let y = 0; y < m.cell; y++) {
    for (let x = 0; x < m.cell; x++) {
      if (px[(y * m.cell + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;                            // empty cell
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const scale = targetPxH / bh;
  const outW = Math.max(1, Math.round(bw * scale));
  const outH = Math.max(1, Math.round(bh * scale));
  const out = makeCanvas(outW, outH);
  const octx = out?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!out || !octx) return null;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(cell as CanvasImageSource, x0, y0, bw, bh, 0, 0, outW, outH);
  return out;
}

export class ClutterFloraArtSource {
  private atlas: ClutterAtlas | null = null;
  private loading: Promise<void> | null = null;
  /** `${kind}#${variant}` → sliced pack (null = permanent miss for this session). */
  private readonly cache = new Map<string, SpritePack | null>();
  private rev = 0;
  private readonly load: NonNullable<ClutterFloraDeps['load']>;
  private readonly slice: NonNullable<ClutterFloraDeps['slice']>;
  private readonly onWarm?: () => void;

  constructor(deps: ClutterFloraDeps = {}) {
    this.load = deps.load ?? defaultLoad;
    this.slice = deps.slice ?? defaultSlice;
    this.onWarm = deps.onWarm;
  }

  /** Monotonic version — bumps when the atlas lands. Folded into `buildingArtRev`
   *  so the static draw cache rebuilds off the billboard fallback. */
  version(): number { return this.rev; }

  /** Kick the one-time atlas load. Safe every frame; never throws. */
  warm(): Promise<void> {
    if (!this.loading) {
      this.loading = this.load()
        .then((a) => {
          if (a) { this.atlas = a; this.rev++; this.onWarm?.(); }
        })
        .catch(() => undefined);
    }
    return this.loading;
  }

  /** Sync per-frame read: the sliced billboard pack for (kind, variant), or null
   *  until the atlas is loaded / for non-clutter kinds. Deterministic: the cell
   *  is a stable hash of (kind, variant) within the species' atlas category. */
  peek(kind: string, variant = 0): SpritePack | null {
    if (!this.atlas) return null;
    const key = `${kind}#${variant}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const pack = this.build(kind, variant);
    this.cache.set(key, pack);
    return pack;
  }

  private build(kind: string, variant: number): SpritePack | null {
    const m = this.atlas!.manifest;
    const cat = clutterCategoryFor(kind);
    const range = cat ? m.ranges[cat] : undefined;
    if (!range || range.count <= 0) return null;
    const cell = range.start + floraVariantBucket(`${kind}#${variant}`, range.count);
    const targetPxH = Math.max(8, Math.round(mToPx(floraGenParams(kind)?.heightM ?? 0.6)));
    const albedo = this.slice(this.atlas!, cell, targetPxH);
    return albedo ? { albedo } : null;
  }

  /** Drop sliced packs (the atlas itself is world-independent and kept). */
  clear(): void { this.cache.clear(); }
}
