// Runtime source of img2img-generated building sprites. Mirrors
// ParametricBuildingSource's peek/warm contract: peek() is the sync frame read,
// warm() kicks generation off the frame path (≤ once per cache key). Pipeline:
// blueprint → magenta-backed init → OpenRouter img2img → chroma-key → VALIDATE
// (border keyed + silhouette IoU vs the geometry mask) → register onto the
// geometry grid (geometry alpha is authoritative; the LLM contributes colour
// only) → palette quantize → persist the PROCESSED sprite + companion PBR maps.
// Validation runs BEFORE cachePut so a bad generation can never poison the
// generate-once IndexedDB cache: it gets one retry, then a session-only null
// (renderer falls back to the grey parametric sprite). Never throws on the
// frame path.
import type { Entity } from '@/core/types';
import { blueprintOf } from '@/blueprint/entity';
import type { ResolvedBlueprint } from '@/blueprint/types';
import type { SpriteCanvas } from '@/render/iso/sprite-canvas';
import { composeStructure } from '@/assetgen/compose';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { greyToDataUri } from '@/render/iso/sprite-canvas';
import { buildingImagePrompt } from '@/assetgen/building-image-prompt';
import { chromaKeyMagenta, compositeOverChroma } from '@/render/chroma-key';
import { canonicalJson, generatedArtKey, readGeneratedArt, writeGeneratedArt } from '@/render/generated-art-cache';
import {
  type Raster, cropRaster, borderKeyedFraction, registerAlbedo, quantizePalette,
} from '@/render/sprite-postprocess';
import { decodePngToRaster, rasterToSpriteCanvas, rasterToPngBlob } from '@/render/sprite-codec';

/** Minimum fraction of the LLM image's border ring that must key out (did the model obey the chroma background?). */
export const MIN_BORDER_KEYED = 0.6;
/** Minimum silhouette agreement (alpha IoU after crop+scale normalisation) vs the geometry mask. */
export const MIN_SILHOUETTE_IOU = 0.8;
/** Palette size for the final quantize pass (look cohesion + clean banding later). */
export const QUANT_COLORS = 64;
/** Paid generation attempts per building before giving up for the session. */
const MAX_ATTEMPTS = 2;
/** Concurrent paid generations — first sight of a settlement must not fire one request per building (429s, spend spikes). */
const MAX_CONCURRENT_GENERATIONS = 2;

/** Everything the geometry side contributes to one generation. */
export interface ProducedPack {
  initDataUri: string;
  /** Geometry alpha cropped to its opaque bbox — the authoritative sprite grid. */
  mask: Raster;
  /** Companion PBR maps, same crop, PNG-encoded. Absent where canvas is unavailable. */
  normal?: Blob; material?: Blob; emissive?: Blob;
  anchors?: string;
}

export interface GeneratedSourceDeps {
  enabled: () => boolean;
  canSpend: () => boolean;
  /** Currently-selected image model id (drives prompt family + cache key). */
  model: () => string;
  /** Generate a PNG blob from an init data-URI + prompt (wraps the client + cost tracking). */
  generate: (initDataUri: string, prompt: string, signal?: AbortSignal) => Promise<Blob>;
  // Seams below default to the real pipeline; overridden in tests.
  prompt?: (rb: ResolvedBlueprint) => string;
  produce?: (rb: ResolvedBlueprint) => Promise<ProducedPack>;
  decodeImage?: (blob: Blob) => Promise<Raster | null>;
  encodeRaster?: (r: Raster) => Promise<Blob | null>;
  rasterToSprite?: (r: Raster) => SpriteCanvas | null;
  cacheGet?: (key: string) => Promise<{ blob: Blob; targetWidth: number } | null>;
  cachePut?: (key: string, blob: Blob, meta: {
    model: string; prompt: string; targetWidth: number;
    normal?: Blob; material?: Blob; emissive?: Blob; anchors?: string;
  }) => Promise<void>;
}

export class GeneratedBuildingArtSource {
  private readonly cache = new Map<string, SpriteCanvas | null>();
  private readonly inflight = new Set<string>();
  private readonly warned = new Set<string>();
  private readonly d: Required<GeneratedSourceDeps>;

  constructor(deps: GeneratedSourceDeps) {
    this.d = {
      prompt: (rb) => buildingImagePrompt(rb, deps.model()),
      produce: async (rb) => {
        const r = await composeStructure(toGeometry(rb));
        // Magenta init background: the model mirrors the reference image's
        // background far more reliably than the text prompt's demand for it.
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
      cachePut: (k, b, m) => writeGeneratedArt(k, b, m),
      ...deps,
    } as Required<GeneratedSourceDeps>;
  }

  // Key derivation memoized per ResolvedBlueprint object — peek() runs every frame
  // per building, and canonicalJson over the whole blueprint is too hot for that.
  private readonly keyMemo = new WeakMap<ResolvedBlueprint, { model: string; key: string }>();

  private rbOf(e: Entity): ResolvedBlueprint | undefined { return blueprintOf(e)?.rb; }
  private keyOf(rb: ResolvedBlueprint): string {
    const model = this.d.model();
    const hit = this.keyMemo.get(rb);
    if (hit && hit.model === model) return hit.key;
    const key = generatedArtKey(canonicalJson(rb), model, rb.footprint);
    this.keyMemo.set(rb, { model, key });
    return key;
  }

  peek(e: Entity): SpriteCanvas | null {
    const rb = this.rbOf(e); if (!rb) return null;
    return this.cache.get(this.keyOf(rb)) ?? null;
  }

  warm(e: Entity): void {
    const rb = this.rbOf(e); if (!rb) return;
    const key = this.keyOf(rb);            // memoized; no stringify on the frame path
    if (this.cache.has(key) || this.inflight.has(key)) return;
    if (!this.d.enabled()) { return; } // not cached: re-evaluate if toggled on later
    this.inflight.add(key);
    void this.run(rb, key).finally(() => this.inflight.delete(key));
  }

  // Tiny semaphore around the NETWORK step only (IDB reads + local raster work
  // stay unbounded): excess generations queue and run as slots free up.
  private genActive = 0;
  private readonly genQueue: Array<() => void> = [];
  private async withGenSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.genActive >= MAX_CONCURRENT_GENERATIONS) {
      // Wait to INHERIT a slot — the releaser hands it over without decrementing,
      // so a fresh caller can never jump the queue and overshoot the cap.
      await new Promise<void>(res => this.genQueue.push(res));
    } else {
      this.genActive++;
    }
    try { return await fn(); }
    finally {
      const next = this.genQueue.shift();
      if (next) next(); else this.genActive--;
    }
  }

  /** Warn once per key — generation problems repeat per attempt and per session. */
  private note(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[generated-building] ${msg}`);
  }

  /**
   * One paid attempt: generate → decode → key → gate. Returns the registered,
   * quantized sprite, or null when the result fails a quality gate (caller may
   * retry — the model is nondeterministic). Throws when the image cannot be
   * decoded at all: that is environmental, so retrying would only burn spend.
   */
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
    if (reg.iou < MIN_SILHOUETTE_IOU) {
      this.note(key, `attempt ${n}: silhouette IoU ${reg.iou.toFixed(2)} < ${MIN_SILHOUETTE_IOU}`);
      return null;
    }
    return quantizePalette(reg.sprite, QUANT_COLORS);
  }

  private async run(rb: ResolvedBlueprint, key: string): Promise<void> {
    try {
      const hit = await this.d.cacheGet(key);
      if (hit) {
        // The cached blob is the already-processed sprite at final resolution.
        const r = await this.d.decodeImage(hit.blob);
        this.cache.set(key, r ? this.d.rasterToSprite(r) : null);
        return;
      }
      // Over budget: cache null so we DON'T re-enter run() (and re-read IDB) every
      // frame for this building. Session spend only ever rises, so retrying within
      // the session is pointless; a reload clears this in-mem cache and resets the
      // session counter, so genuinely-uncached buildings regenerate then.
      if (!this.d.canSpend()) { this.cache.set(key, null); return; }
      const prompt = this.d.prompt(rb);    // computed lazily — only when actually generating
      const pack = await this.d.produce(rb);
      let sprite: Raster | null = null;
      for (let n = 1; n <= MAX_ATTEMPTS && !sprite; n++) sprite = await this.attempt(pack, prompt, key, n);
      if (!sprite) { this.cache.set(key, null); return; } // session-only null; the IDB cache stays clean
      const png = await this.d.encodeRaster(sprite);
      if (png) {
        await this.d.cachePut(key, png, {
          model: this.d.model(), prompt, targetWidth: sprite.w,
          normal: pack.normal, material: pack.material, emissive: pack.emissive, anchors: pack.anchors,
        });
      }
      this.cache.set(key, this.d.rasterToSprite(sprite));
    } catch (err) {
      if (!this.warned.has(key)) { console.warn('[generated-building] generation failed', err); this.warned.add(key); }
      this.cache.set(key, null);
    }
  }

  clear(): void { this.cache.clear(); this.inflight.clear(); this.warned.clear(); }
}
