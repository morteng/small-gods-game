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
import type { RawMap, SpriteCanvas, SpritePack } from '@/render/iso/sprite-canvas';
import { composeStructure } from '@/assetgen/compose';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { greyToDataUri } from '@/render/iso/sprite-canvas';
import { buildingImagePrompt } from '@/assetgen/building-image-prompt';
import { chromaKeyMagenta, compositeOverChroma } from '@/render/chroma-key';
import {
  canonicalJson, generatedArtKey, readGeneratedArt, writeGeneratedArt,
  isGeneratedArtFailed, writeGeneratedArtFailure,
} from '@/render/generated-art-cache';
import {
  type Raster, cropRaster, borderKeyedFraction, registerAlbedo, quantizePalette,
} from '@/render/sprite-postprocess';
import { decodePngToRaster, rasterToSpriteCanvas, rasterToPngBlob } from '@/render/sprite-codec';

/** Minimum fraction of the LLM image's border ring that must key out (did the model obey the chroma background?). */
export const MIN_BORDER_KEYED = 0.6;
/** Minimum silhouette agreement (alpha IoU after crop+scale normalisation) vs the geometry mask.
 *  Relaxed from 0.8: registration now degrades gracefully (negotiation band keeps the result
 *  on-grid), so moderate artistic deviation is welcome rather than wasted as a paid retry. */
export const MIN_SILHOUETTE_IOU = 0.7;
/** Palette size for the final quantize pass (look cohesion + clean banding later). */
export const QUANT_COLORS = 64;
/** Paid generation attempts per building before giving up for the session. */
const MAX_ATTEMPTS = 2;
/** Shared 1×1 neutral material for generated sprites: G=255 ⇒ AO 1, A=0 ⇒ dielectric
 *  (matches gpu-scene's own neutralMaterial). One reference ⇒ one GPU upload, reused
 *  across every building. See toPack() for why the per-building material is dropped. */
const NEUTRAL_MATERIAL: RawMap = { data: new Uint8ClampedArray([0, 255, 0, 0]), w: 1, h: 1 };
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

/** One vendored-library manifest row (see scripts/seed-building-art.ts). */
interface BaseManifestEntry {
  file: string; targetWidth: number;
  /** Bare preset this row was seeded from — the fallback match key for in-world
   *  variants (which carry extra parts/materials → a different exact key). */
  preset?: string;
  normal?: string; material?: string; emissive?: string;
}

/** A cache/base-library hit: the processed albedo + optional companion PBR maps.
 *  `emissive` is RGB self-illumination (lit window panes) — unlike `material` it is
 *  NOT a data map (no alpha=0 premultiply hazard), so it decodes through a plain
 *  canvas exactly like `normal`. `provenance` distinguishes an exact content-addressed
 *  hit (IDB, or the manifest's exact key — either bakes ART_RECIPE_VERSION + a
 *  blueprint hash, so it can never be stale) from the manifest's preset-name
 *  fallback (art seeded for the BARE preset, reused by a variant sight-unseen —
 *  may predate the variant's or even the bare preset's current geometry). Omitted
 *  ⇒ 'exact' (the common IDB path, which never sets this field explicitly). */
export interface CachedArt {
  blob: Blob; targetWidth: number;
  normal?: Blob; material?: Blob; emissive?: Blob;
  provenance?: 'exact' | 'preset-fallback';
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
  cacheGet?: (key: string) => Promise<CachedArt | null>;
  /** Vendored no-key base library (public/asset-library/building-sprites/) — consulted after IDB, before paying.
   *  `preset` lets an in-world variant reuse its bare preset's shipped sprite when the exact key misses. */
  baseGet?: (key: string, preset?: string) => Promise<CachedArt | null>;
  cachePut?: (key: string, blob: Blob, meta: {
    model: string; prompt: string; targetWidth: number;
    normal?: Blob; material?: Blob; emissive?: Blob; anchors?: string;
  }) => Promise<void>;
  /** True if this key was previously recorded as a FAILED generation at the current
   *  recipe+model — skip it instead of re-paying every load. */
  cacheFailed?: (key: string) => Promise<boolean>;
  /** Persist a negative marker after a generation fails its quality gate, so the
   *  next reload skips it rather than re-paying. */
  recordFailure?: (key: string) => Promise<void>;
}

export class GeneratedBuildingArtSource {
  private readonly cache = new Map<string, SpritePack | null>();
  private readonly inflight = new Set<string>();
  private readonly warned = new Set<string>();
  // Resolution provenance per cache key (see `peekMeta`) — set alongside `cache`
  // whenever a non-null pack resolves; never consulted for null (grey-fallback) keys.
  private readonly provenance = new Map<string, 'exact' | 'preset-fallback'>();
  private readonly d: Required<GeneratedSourceDeps>;
  // Bumped each time a building GAINS art (an async cache/base/paid resolve). The
  // render-context folds this into `buildingArtRev` so the building draw cache
  // invalidates and warmed img2img sprites actually repaint (else they sit resolved
  // but unpainted until some other invalidation happens to fire). Null resolves —
  // the grey-fallback case — don't bump: nothing new to paint.
  private ver = 0;
  version(): number { return this.ver; }
  /** Drop every resolved pack AND the vendored-library manifest memo, then bump the art
   *  revision — freshly seeded art (scripts/seed-building-art.ts writes new manifest rows
   *  while the page is open) gets re-fetched IN PLACE on the next warm, no reload. The
   *  studio's ↻-art affordance is the caller; the game never needs this (its library is
   *  fixed for the session). */
  refresh(): void {
    this.cache.clear();
    this.inflight.clear();
    this.warned.clear();
    this.provenance.clear();
    this.baseManifest = null;
    this.basePresetIndex = null;
    this.ver++;
  }
  private resolve(key: string, pack: SpritePack | null): void {
    this.cache.set(key, pack);
    if (pack) this.ver++;
  }

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
      baseGet: (k, preset) => this.fetchFromBaseLibrary(k, preset),
      cachePut: (k, b, m) => writeGeneratedArt(k, b, m),
      cacheFailed: (k) => isGeneratedArtFailed(k),
      recordFailure: (k) => writeGeneratedArtFailure(k, deps.model()),
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

  peek(e: Entity): SpritePack | null {
    const rb = this.rbOf(e); if (!rb) return null;
    return this.cache.get(this.keyOf(rb)) ?? null;
  }

  warm(e: Entity): void {
    const rb = this.rbOf(e); if (!rb) return;
    const key = this.keyOf(rb);            // memoized; no stringify on the frame path
    if (this.cache.has(key) || this.inflight.has(key)) return;
    // Do NOT gate on enabled() here. Reading FREE art (IDB cache + the vendored
    // base library) must always run — otherwise the shipped img2img sprites never
    // load while paid gen is off, and every building falls back to grey massing.
    // enabled() gates only the PAID produce() step, inside run().
    this.inflight.add(key);
    void this.run(rb, key).finally(() => this.inflight.delete(key));
  }

  // Vendored base library: a manifest of pre-generated sprites shipped with the
  // site (seeded by scripts/seed-building-art.ts through the SAME pipeline + key
  // derivation), so keyless players get real art without paying. Fetched lazily,
  // once; any failure degrades to "no base library".
  private baseManifest: Promise<Record<string, BaseManifestEntry> | null> | null = null;
  // preset → first manifest entry seeded from it. Built once alongside the manifest,
  // it lets an in-world building (whose exact key embeds variant parts/materials and so
  // never matches the bare-preset seed key) reuse its preset's shipped sprite for free.
  private basePresetIndex: Map<string, BaseManifestEntry> | null = null;
  private async fetchFromBaseLibrary(key: string, preset?: string): Promise<CachedArt | null> {
    if (typeof fetch === 'undefined') return null;
    try {
      this.baseManifest ??= (async () => {
        const { assetUrl } = await import('@/core/asset-url');
        const resp = await fetch(assetUrl('asset-library/building-sprites/manifest.json'));
        if (!resp.ok) return null;
        const json = await resp.json() as { entries?: Record<string, BaseManifestEntry> };
        return json.entries ?? null;
      })().catch(() => null);
      const entries = await this.baseManifest;
      if (!entries) return null;
      // Exact key (a bare preset, or an IDB-seeded variant) is verified against the
      // CURRENT geometry by construction — the key bakes ART_RECIPE_VERSION plus a
      // hash of the canonical blueprint, so a match can never be stale. Failing that,
      // fall back to whatever was seeded for the BARE preset name, so a variant
      // renders SOMETHING instead of dropping to grey massing — but that art may
      // have been painted against different (possibly since-edited) geometry, so the
      // fallback is tagged 'preset-fallback' for callers that want to warn about it.
      let entry: BaseManifestEntry | undefined = entries[key];
      let provenance: 'exact' | 'preset-fallback' = 'exact';
      if (!entry && preset) {
        this.basePresetIndex ??= new Map(
          Object.values(entries).filter(e => e.preset).map(e => [e.preset as string, e]),
        );
        entry = this.basePresetIndex.get(preset);
        provenance = 'preset-fallback';
      }
      if (!entry) return null;
      const { assetUrl } = await import('@/core/asset-url');
      const file = async (name: string | undefined): Promise<Blob | undefined> => {
        if (!name) return undefined;
        try {
          const resp = await fetch(assetUrl(`asset-library/building-sprites/${name}`));
          return resp.ok ? await resp.blob() : undefined;
        } catch { return undefined; }
      };
      const blob = await file(entry.file);
      if (!blob) return null;
      // NORMAL + EMISSIVE are fetched: both are plain RGB maps that survive a canvas
      // decode (opaque silhouette, no premultiply hazard). The seeded MATERIAL PNG is
      // a data map (alpha 0) that a 2D canvas can't decode without zeroing its RGB, so
      // it's deliberately skipped — toPack() substitutes a neutral material instead.
      return {
        blob, targetWidth: entry.targetWidth,
        normal: await file(entry.normal),
        emissive: await file(entry.emissive),
        provenance,
      };
    } catch { return null; }
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

  /** Decode an optional companion-map PNG into a canvas; failures degrade to "no map". */
  private async decodeMap(blob: Blob | undefined): Promise<SpriteCanvas | undefined> {
    if (!blob) return undefined;
    const r = await this.d.decodeImage(blob).catch(() => null);
    return (r && this.d.rasterToSprite(r)) ?? undefined;
  }

  /** Assemble a SpritePack from the albedo raster + the companion NORMAL/EMISSIVE
   *  blobs. The material map is deliberately NOT carried as a decoded canvas: it is a
   *  DATA map (A=metallic, RGB=AO/roughness where A≈0) and a 2D-canvas backing
   *  store is premultiplied, so decoding an alpha-0 material PNG silently zeroes
   *  its RGB → AO 0 → the whole sprite lit BLACK. (Both the shipped base library
   *  and produce()'s PNG-encoded material hit this.) Instead we pair the real
   *  normal with a shared NEUTRAL material (AO 1, dielectric): the img2img albedo
   *  is painted flat/shadeless by contract, so the geometry normals + sun supply
   *  the form, which is the whole point — a uniform AO loses only baked occlusion
   *  nuance, never the lighting. `materialData` (a RawMap) also flips the draw
   *  list's `lit` flag on, without which the sprite would render unlit/flat.
   *  `emissive` has no such hazard (plain RGB, not a data map) — it decodes and
   *  attaches straight through, so painted sprites glow their lit windows at night
   *  exactly like a parametric massing pack. */
  private toPack(albedo: Raster, normal?: SpriteCanvas, emissive?: SpriteCanvas): SpritePack | null {
    const sprite = this.d.rasterToSprite(albedo);
    if (!sprite) return null;
    return {
      albedo: sprite,
      normal,
      materialData: normal ? NEUTRAL_MATERIAL : undefined,
      emissive,
    };
  }

  private async run(rb: ResolvedBlueprint, key: string): Promise<void> {
    try {
      // IDB first (paid results), then the vendored base library — both hold the
      // already-processed sprite at final resolution plus its companion maps.
      const hit = await this.d.cacheGet(key) ?? await this.d.baseGet(key, rb.preset);
      if (hit) {
        const r = await this.d.decodeImage(hit.blob);
        const normal = await this.decodeMap(hit.normal);
        const emissive = await this.decodeMap(hit.emissive);
        // IDB hits never set `provenance` (content-addressed by construction ⇒
        // always 'exact'); the base library stamps it explicitly (see fetchFromBaseLibrary).
        this.provenance.set(key, hit.provenance ?? 'exact');
        this.resolve(key, r ? this.toPack(r, normal, emissive) : null);
        return;
      }
      // Known-bad at this recipe+model: a prior session generated this blueprint
      // but it failed the quality gate. Skip rather than re-pay to regenerate it
      // every load (the old regenerate-every-load leak). Self-heals on a recipe
      // bump or model switch — the key changes, so this marker no longer matches.
      if (await this.d.cacheFailed(key)) { this.cache.set(key, null); return; }
      // Paid generation disabled OR over budget: cache null so we DON'T re-enter
      // run() (and re-read IDB) every frame for this building. Free cached/vendored
      // art was already consulted above; only the PAID produce() path is gated here.
      // Session spend only ever rises, so retrying within the session is pointless;
      // a reload clears this in-mem cache (and, if paid gen was toggled on, lets
      // genuinely-uncached buildings regenerate then).
      if (!this.d.enabled() || !this.d.canSpend()) { this.cache.set(key, null); return; }
      const prompt = this.d.prompt(rb);    // computed lazily — only when actually generating
      const pack = await this.d.produce(rb);
      let sprite: Raster | null = null;
      for (let n = 1; n <= MAX_ATTEMPTS && !sprite; n++) sprite = await this.attempt(pack, prompt, key, n);
      if (!sprite) {
        // Generated but failed every quality gate: persist a negative marker so the
        // next reload skips it instead of re-paying. (A decode/network failure
        // throws instead and lands in catch — those stay session-only/retryable.)
        await this.d.recordFailure(key);
        this.cache.set(key, null);
        return;
      }
      const png = await this.d.encodeRaster(sprite);
      if (png) {
        await this.d.cachePut(key, png, {
          model: this.d.model(), prompt, targetWidth: sprite.w,
          normal: pack.normal, material: pack.material, emissive: pack.emissive, anchors: pack.anchors,
        });
      }
      const normal = await this.decodeMap(pack.normal);
      const emissive = await this.decodeMap(pack.emissive);
      this.provenance.set(key, 'exact');   // freshly generated for THIS exact blueprint
      this.resolve(key, this.toPack(sprite, normal, emissive));
    } catch (err) {
      if (!this.warned.has(key)) { console.warn('[generated-building] generation failed', err); this.warned.add(key); }
      this.cache.set(key, null);
    }
  }

  /** How the pack currently cached for `e` was resolved — 'exact' (IDB, or the
   *  manifest's exact content-addressed key: can never be stale) vs
   *  'preset-fallback' (the manifest's preset-name match: painted for the BARE
   *  preset, reused sight-unseen by a variant — may predate the current geometry).
   *  Null when nothing has resolved yet, or the resolve was a grey-massing miss.
   *  Read by callers (the studio) that want to warn about an unverified sprite. */
  peekMeta(e: Entity): { resolved: 'exact' | 'preset-fallback' } | null {
    const rb = this.rbOf(e); if (!rb) return null;
    const key = this.keyOf(rb);
    if (!this.cache.get(key)) return null;
    return { resolved: this.provenance.get(key) ?? 'exact' };
  }

  clear(): void { this.cache.clear(); this.inflight.clear(); this.warned.clear(); this.provenance.clear(); }
}
