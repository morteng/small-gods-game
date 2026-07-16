// Runtime source of img2img-generated FLORA sprites — the plant analogue of
// GeneratedBuildingArtSource. Same pipeline (geometry init → magenta-backed init →
// OpenRouter img2img → chroma-key → VALIDATE border+silhouette → register onto the
// geometry grid → palette quantize → persist), but keyed on a species `kind` string
// (e.g. 'english-oak') so it slots behind the existing parametric-plant render seam:
// the render context tries this source first, falling back to the grey parametric
// SpritePack on a miss. Validation runs BEFORE cachePut so a bad gen can't poison the
// generate-once IndexedDB cache. Never throws on the frame path.
//
// Generation is gated (`enabled`/`canSpend`) and OFF by default — with no key and an
// unseeded library this source always misses and the caller shows grey parametric
// massing, so wiring it in changes nothing until a funded seed run (scripts/seed-
// flora-art.ts) writes public/asset-library/flora-sprites/ and the flag is flipped.
import type { ResolvedBlueprint } from '@/blueprint/types';
import { synthesizeBlueprint, isPlantPreset } from '@/blueprint/presets';
import type { SpriteCanvas, SpritePack } from '@/render/iso/sprite-canvas';
import { composeStructure } from '@/assetgen/compose';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { greyToDataUri } from '@/render/iso/sprite-canvas';
import { floraImagePrompt } from '@/assetgen/flora-image-prompt';
import { chromaKeyMagenta, compositeOverChroma } from '@/render/chroma-key';
import {
  canonicalJson, generatedArtKey, readGeneratedArt, writeGeneratedArt,
  isGeneratedArtFailed, writeGeneratedArtFailure,
} from '@/render/generated-art-cache';
import {
  type Raster, cropRaster, borderKeyedFraction, registerAlbedo, quantizePalette,
} from '@/render/sprite-postprocess';
import { decodePngToRaster, rasterToSpriteCanvas, rasterToPngBlob } from '@/render/sprite-codec';
import {
  MIN_BORDER_KEYED, QUANT_COLORS,
  type ProducedPack, type CachedArt,
} from '@/render/generated-building-art-source';

/**
 * Silhouette-IoU floor for FLORA — deliberately looser than the building gate (0.9).
 * A building has a crisp rectilinear outline the img2img must preserve; foliage does
 * NOT — the whole reason Klein wins for plants is that it reinterprets the geometry
 * massing into organic leaf clumps, which legitimately shifts the silhouette (drooping
 * willow streamers, spiny gorse, a broken conifer crown). At 0.9 those honest wins were
 * being rejected AND we paid for the retries; 0.8 still guarantees the sprite occupies
 * the geometry's footprint (no runaway hallucination) while allowing the reinterpretation.
 */
export const FLORA_MIN_SILHOUETTE_IOU = 0.8;

/** Paid generation attempts per species before giving up for the session. */
const MAX_ATTEMPTS = 2;
/** Concurrent paid generations — prewarming all species must not fire one request each. */
const MAX_CONCURRENT_GENERATIONS = 2;

/** One vendored flora-library manifest row (see scripts/seed-flora-art.ts). */
interface BaseManifestEntry {
  file: string; targetWidth: number;
  normal?: string; material?: string; emissive?: string;
}

export interface GeneratedFloraSourceDeps {
  enabled: () => boolean;
  canSpend: () => boolean;
  /** Currently-selected image model id (drives prompt family + cache key). */
  model: () => string;
  /** Called after EACH species' pack settles (also bumps version()). Wire to the
   *  frame loop's requestRender so a lazily-loaded skinned sprite swaps in even on an
   *  idle loop — the static draw cache folds version() into buildingArtRev, so WITHOUT
   *  this a vendored/paid flora sprite lands in peek() but the frame never rebuilds and
   *  the stale grey parametric massing shows until an unrelated invalidation. */
  onWarm?: () => void;
  /** Generate a PNG blob from an init data-URI + prompt (wraps the client + cost tracking). */
  generate: (initDataUri: string, prompt: string, signal?: AbortSignal) => Promise<Blob>;
  // Seams below default to the real pipeline; overridden in tests.
  prompt?: (rb: ResolvedBlueprint) => string;
  produce?: (rb: ResolvedBlueprint) => Promise<ProducedPack>;
  decodeImage?: (blob: Blob) => Promise<Raster | null>;
  encodeRaster?: (r: Raster) => Promise<Blob | null>;
  rasterToSprite?: (r: Raster) => SpriteCanvas | null;
  cacheGet?: (key: string) => Promise<CachedArt | null>;
  baseGet?: (key: string) => Promise<CachedArt | null>;
  cachePut?: (key: string, blob: Blob, meta: {
    model: string; prompt: string; targetWidth: number;
    normal?: Blob; material?: Blob; emissive?: Blob; anchors?: string;
  }) => Promise<void>;
  cacheFailed?: (key: string) => Promise<boolean>;
  recordFailure?: (key: string) => Promise<void>;
}

export class GeneratedFloraArtSource {
  private readonly cache = new Map<string, SpritePack | null>();
  private readonly inflight = new Set<string>();
  private readonly warned = new Set<string>();
  private readonly keyByKind = new Map<string, string>();
  private readonly d: Required<GeneratedFloraSourceDeps>;
  /** Monotonic version — bumps as each species' pack settles. Folded into
   *  buildingArtRev so the static draw cache rebuilds when a skinned sprite lands. */
  private rev = 0;

  /** Set a species' pack AND bump version() + fire onWarm, so a late-arriving skinned
   *  sprite forces the static draw cache to rebuild instead of freezing the parametric
   *  massing that was cached before it loaded. */
  private settle(key: string, pack: SpritePack | null): void {
    this.cache.set(key, pack);
    this.rev++;
    this.d.onWarm();
  }

  /** Monotonic art version (see {@link rev}). */
  version(): number { return this.rev; }

  constructor(deps: GeneratedFloraSourceDeps) {
    this.d = {
      onWarm: () => {},
      prompt: (rb) => floraImagePrompt(rb, deps.model()),
      produce: async (rb) => {
        const r = await composeStructure(toGeometry(rb));
        const uri = greyToDataUri(compositeOverChroma(r.grey), r.size);
        if (!uri) throw new Error('no canvas for init image');
        const bb = {
          x: Math.round(r.bbox.x), y: Math.round(r.bbox.y),
          w: Math.max(1, Math.round(r.bbox.w)), h: Math.max(1, Math.round(r.bbox.h)),
        };
        const full = (buf: Uint8ClampedArray): Raster => ({ data: buf, w: r.size, h: r.size });
        const enc = (buf: Uint8ClampedArray) => rasterToPngBlob(cropRaster(full(buf), bb));
        return {
          initDataUri: uri,
          mask: cropRaster(full(r.grey), bb),
          normal: await enc(r.normal) ?? undefined,
          material: await enc(r.material) ?? undefined,
          emissive: await enc(r.emissive) ?? undefined,
          anchors: JSON.stringify(r.anchors),
        };
      },
      decodeImage: (b) => decodePngToRaster(b),
      encodeRaster: (r) => rasterToPngBlob(r),
      rasterToSprite: (r) => rasterToSpriteCanvas(r),
      cacheGet: (k) => readGeneratedArt(k),
      baseGet: (k) => this.fetchFromBaseLibrary(k),
      cachePut: (k, b, m) => writeGeneratedArt(k, b, m),
      cacheFailed: (k) => isGeneratedArtFailed(k),
      recordFailure: (k) => writeGeneratedArtFailure(k, deps.model()),
      ...deps,
    } as Required<GeneratedFloraSourceDeps>;
  }

  /** Resolve a species kind → its synthesized blueprint + generation cache key.
   *  Returns null for non-plant kinds (the caller then shows nothing / a shape). */
  private resolve(kind: string): { rb: ResolvedBlueprint; key: string } | null {
    if (!isPlantPreset(kind)) return null;
    const rb = synthesizeBlueprint(kind);
    if (!rb) return null;
    const key = generatedArtKey(canonicalJson(rb), this.d.model(), rb.footprint);
    return { rb, key };
  }

  peek(kind: string): SpritePack | null {
    const key = this.keyByKind.get(kind) ?? this.resolve(kind)?.key;
    return key ? this.cache.get(key) ?? null : null;
  }

  warm(kind: string): void {
    const r = this.resolve(kind);
    if (!r) return;
    this.keyByKind.set(kind, r.key);
    if (this.cache.has(r.key) || this.inflight.has(r.key)) return;
    // Do NOT gate on enabled() here — free art (IDB + vendored base library) must
    // always load; enabled() gates only the PAID produce() step, inside run().
    this.inflight.add(r.key);
    void this.run(r.rb, r.key).finally(() => this.inflight.delete(r.key));
  }

  // Vendored base library: pre-generated flora sprites shipped with the site
  // (seeded by scripts/seed-flora-art.ts through the SAME pipeline + key
  // derivation). Fetched lazily, once; any failure degrades to "no base library".
  private baseManifest: Promise<Record<string, BaseManifestEntry> | null> | null = null;
  private async fetchFromBaseLibrary(key: string): Promise<CachedArt | null> {
    if (typeof fetch === 'undefined') return null;
    try {
      this.baseManifest ??= (async () => {
        const { assetUrl } = await import('@/core/asset-url');
        const resp = await fetch(assetUrl('asset-library/flora-sprites/manifest.json'));
        if (!resp.ok) return null;
        const json = await resp.json() as { entries?: Record<string, BaseManifestEntry> };
        return json.entries ?? null;
      })().catch(() => null);
      const entries = await this.baseManifest;
      const entry = entries?.[key];
      if (!entry) return null;
      const { assetUrl } = await import('@/core/asset-url');
      const file = async (name: string | undefined): Promise<Blob | undefined> => {
        if (!name) return undefined;
        try {
          const resp = await fetch(assetUrl(`asset-library/flora-sprites/${name}`));
          return resp.ok ? await resp.blob() : undefined;
        } catch { return undefined; }
      };
      const blob = await file(entry.file);
      if (!blob) return null;
      return {
        blob, targetWidth: entry.targetWidth,
        normal: await file(entry.normal), material: await file(entry.material),
      };
    } catch { return null; }
  }

  private genActive = 0;
  private readonly genQueue: Array<() => void> = [];
  private async withGenSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.genActive >= MAX_CONCURRENT_GENERATIONS) {
      await new Promise<void>((res) => this.genQueue.push(res));
    } else {
      this.genActive++;
    }
    try { return await fn(); }
    finally {
      const next = this.genQueue.shift();
      if (next) next(); else this.genActive--;
    }
  }

  private note(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[generated-flora] ${msg}`);
  }

  private async attempt(pack: ProducedPack, prompt: string, key: string, n: number): Promise<Raster | null> {
    const blob = await this.withGenSlot(() => this.d.generate(pack.initDataUri, prompt));
    const raw = await this.d.decodeImage(blob);
    if (!raw) throw new Error('generated image could not be decoded');
    chromaKeyMagenta(raw.data);
    const border = borderKeyedFraction(raw);
    if (border < MIN_BORDER_KEYED) {
      this.note(key, `attempt ${n}: background did not key out (ring ${border.toFixed(2)} < ${MIN_BORDER_KEYED})`);
      return null;
    }
    const reg = registerAlbedo(raw, pack.mask);
    if (!reg) { this.note(key, `attempt ${n}: nothing survived chroma keying`); return null; }
    if (reg.iou < FLORA_MIN_SILHOUETTE_IOU) {
      this.note(key, `attempt ${n}: silhouette IoU ${reg.iou.toFixed(2)} < ${FLORA_MIN_SILHOUETTE_IOU}`);
      return null;
    }
    return quantizePalette(reg.sprite, QUANT_COLORS);
  }

  private async decodeMap(blob: Blob | undefined): Promise<SpriteCanvas | undefined> {
    if (!blob) return undefined;
    const r = await this.d.decodeImage(blob).catch(() => null);
    return (r && this.d.rasterToSprite(r)) ?? undefined;
  }

  // NOTE: `material` (the geometry's AO/roughness G-buffer) is deliberately DROPPED.
  // img2img REINTERPRETS the foliage — the painted crown spills past the original
  // facets — but the material map is baked from the pre-paint geometry, so wherever
  // the new leaves extend beyond it, material.G (ambient occlusion) is 0. The lit
  // sprite path multiplies by that AO, blacking out the whole crown. Buildings escape
  // this because img2img keeps their massing silhouette tight; flora doesn't. The
  // parametric flora pack renders fine with albedo + normal and NO material — this
  // matches it, letting the painted-in shading of the sprite carry the look.
  private async toPack(albedo: Raster, normal?: Blob, _material?: Blob): Promise<SpritePack | null> {
    const sprite = this.d.rasterToSprite(albedo);
    if (!sprite) return null;
    return {
      albedo: sprite,
      normal: await this.decodeMap(normal),
    };
  }

  private async run(rb: ResolvedBlueprint, key: string): Promise<void> {
    try {
      const hit = await this.d.cacheGet(key) ?? await this.d.baseGet(key);
      if (hit) {
        const r = await this.d.decodeImage(hit.blob);
        this.settle(key, r ? await this.toPack(r, hit.normal, hit.material) : null);
        return;
      }
      if (await this.d.cacheFailed(key)) { this.settle(key, null); return; }
      // Free art was consulted above; gate only the PAID produce() path here.
      if (!this.d.enabled() || !this.d.canSpend()) { this.settle(key, null); return; }
      const prompt = this.d.prompt(rb);
      const pack = await this.d.produce(rb);
      let sprite: Raster | null = null;
      for (let n = 1; n <= MAX_ATTEMPTS && !sprite; n++) sprite = await this.attempt(pack, prompt, key, n);
      if (!sprite) {
        await this.d.recordFailure(key);
        this.settle(key, null);
        return;
      }
      const png = await this.d.encodeRaster(sprite);
      if (png) {
        await this.d.cachePut(key, png, {
          model: this.d.model(), prompt, targetWidth: sprite.w,
          normal: pack.normal, material: pack.material, emissive: pack.emissive, anchors: pack.anchors,
        });
      }
      this.settle(key, await this.toPack(sprite, pack.normal, pack.material));
    } catch (err) {
      if (!this.warned.has(key)) { console.warn('[generated-flora] generation failed', err); this.warned.add(key); }
      this.settle(key, null);
    }
  }

  clear(): void { this.cache.clear(); this.inflight.clear(); this.warned.clear(); this.keyByKind.clear(); }
}
