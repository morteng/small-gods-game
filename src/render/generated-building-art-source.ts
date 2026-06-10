// Runtime source of img2img-generated building sprites. Mirrors
// ParametricBuildingSource's peek/warm contract: peek() is the sync frame read,
// warm() kicks generation off the frame path (≤ once per cache key). Pipeline:
// blueprint → grey init → OpenRouter img2img → IndexedDB cache → sprite canvas.
// Any failure / disabled / over-budget caches null so the renderer falls back to
// the grey parametric sprite. Never throws on the frame path.
import type { Entity } from '@/core/types';
import { blueprintOf } from '@/blueprint/entity';
import type { ResolvedBlueprint } from '@/blueprint/types';
import type { SpriteCanvas } from '@/render/iso/sprite-canvas';
import { composeStructure } from '@/assetgen/compose';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { greyToDataUri } from '@/render/iso/sprite-canvas';
import { buildingImagePrompt } from '@/assetgen/building-image-prompt';
import { compositeOverChroma } from '@/render/chroma-key';
import { buildingSpriteTargetWidth, blobToBuildingSprite } from '@/render/blob-to-building-sprite';
import { canonicalJson, generatedArtKey, readGeneratedArt, writeGeneratedArt } from '@/render/generated-art-cache';

export interface GeneratedSourceDeps {
  enabled: () => boolean;
  canSpend: () => boolean;
  /** Currently-selected image model id (drives prompt family + cache key). */
  model: () => string;
  /** Generate a PNG blob from an init data-URI + prompt (wraps the client + cost tracking). */
  generate: (initDataUri: string, prompt: string, signal?: AbortSignal) => Promise<Blob>;
  // Seams below default to the real pipeline; overridden in tests.
  prompt?: (rb: ResolvedBlueprint) => string;
  initDataUri?: (rb: ResolvedBlueprint) => Promise<string>;
  targetWidth?: (rb: ResolvedBlueprint) => number;
  cacheGet?: (key: string) => Promise<{ blob: Blob; targetWidth: number } | null>;
  cachePut?: (key: string, blob: Blob, meta: { model: string; prompt: string; targetWidth: number }) => Promise<void>;
  decode?: (blob: Blob, targetWidth: number) => Promise<SpriteCanvas | null>;
}

export class GeneratedBuildingArtSource {
  private readonly cache = new Map<string, SpriteCanvas | null>();
  private readonly inflight = new Set<string>();
  private readonly warned = new Set<string>();
  private readonly d: Required<GeneratedSourceDeps>;

  constructor(deps: GeneratedSourceDeps) {
    this.d = {
      prompt: (rb) => buildingImagePrompt(rb, deps.model()),
      initDataUri: async (rb) => {
        const r = await composeStructure(toGeometry(rb));
        // Magenta init background: the model mirrors the reference image's
        // background far more reliably than the text prompt's demand for it.
        const uri = greyToDataUri(compositeOverChroma(r.grey), r.size);
        if (!uri) throw new Error('no canvas for init image');
        return uri;
      },
      targetWidth: (rb) => buildingSpriteTargetWidth(rb.footprint),
      cacheGet: (k) => readGeneratedArt(k),
      cachePut: (k, b, m) => writeGeneratedArt(k, b, m),
      decode: (b, w) => blobToBuildingSprite(b, w),
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
    const key = this.keyOf(rb);            // cheap; no prompt/toBrief on the frame path
    if (this.cache.has(key) || this.inflight.has(key)) return;
    if (!this.d.enabled()) { return; } // not cached: re-evaluate if toggled on later
    this.inflight.add(key);
    void this.run(rb, key).finally(() => this.inflight.delete(key));
  }

  private async run(rb: ResolvedBlueprint, key: string): Promise<void> {
    const targetWidth = this.d.targetWidth(rb);
    try {
      const hit = await this.d.cacheGet(key);
      if (hit) { this.cache.set(key, await this.d.decode(hit.blob, hit.targetWidth)); return; }
      // Over budget: cache null so we DON'T re-enter run() (and re-read IDB) every
      // frame for this building. Session spend only ever rises, so retrying within
      // the session is pointless; a reload clears this in-mem cache and resets the
      // session counter, so genuinely-uncached buildings regenerate then.
      if (!this.d.canSpend()) { this.cache.set(key, null); return; }
      const prompt = this.d.prompt(rb);    // computed lazily — only when actually generating
      const initDataUri = await this.d.initDataUri(rb);
      const blob = await this.d.generate(initDataUri, prompt);
      await this.d.cachePut(key, blob, { model: this.d.model(), prompt, targetWidth });
      this.cache.set(key, await this.d.decode(blob, targetWidth));
    } catch (err) {
      if (!this.warned.has(key)) { console.warn('[generated-building] generation failed', err); this.warned.add(key); }
      this.cache.set(key, null);
    }
  }

  clear(): void { this.cache.clear(); this.inflight.clear(); this.warned.clear(); }
}
