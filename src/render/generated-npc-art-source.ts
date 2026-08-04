/**
 * G2 — the runtime consumer of the G0 NPC sprite pipeline
 * (`src/assetgen/npc-sprite-pipeline.ts`).
 *
 * Mirrors `GeneratedBuildingArtSource`'s resolution order — IndexedDB cache →
 * vendored base library (G1's manifest, `public/asset-library/npc-sprites/`) →
 * paid generation — and the same validate-BEFORE-persist discipline: G0's
 * `generateNpcSheet` already gates (border-keyed, silhouette IoU, shimmer) and
 * retries once per frame internally, so by the time `run()` sees a non-null
 * result it has already passed every quality gate. A refusal after spend is
 * recorded as a NEGATIVE marker (`writeGeneratedNpcArtFailure`) so the next
 * load skips it instead of re-paying; a decode/network throw is environmental
 * and stays session-only/retryable, exactly like the building source.
 *
 * Paid generation ships OFF (`liveNpcArtEnabled = false`, wired in game.ts
 * beside `liveBuildingArtEnabled`/`liveFloraArtEnabled`). The first two
 * resolution steps are FREE and MUST run regardless of that flag — see the
 * comment on `warm()`, and the building source's identical rule, for why:
 * gating free reads on the paid flag is the bug that silently served grey
 * massing for weeks (CLAUDE.md).
 *
 * NO PRESET-NAME FALLBACK. The building base library falls back from an exact
 * content-addressed key to whatever was seeded for the bare preset name, so an
 * in-world variant renders SOMETHING instead of grey massing — tagged
 * `preset-fallback` because that art may predate the variant's geometry. There
 * is no equivalent excuse here: an NPC sheet is keyed by clip + facing +
 * wardrobe identity, not a geometry hash a variant could drift from, and CLAUDE.md
 * already documents the building fallback as a wart (stale v31 art served
 * sight-unseen against edited geometry). An exact-key miss on the NPC library
 * is therefore an HONEST miss — straight through to paid generation (or, if
 * that's off/exhausted, the caller's existing rig/LPC bake, which is already
 * good art per G0's own header).
 *
 * ============================================================================
 * THE HONEST SCOPING ANSWER: this module does not touch a live NPC, and here
 * is exactly why.
 * ============================================================================
 *
 * `peek`/`warm` take an explicit `NpcArtRequest` — a clip, a facing, the
 * wardrobe's `layerSetHash`, the rig-baked frames to redress, and an
 * `NpcSubject` prompt description — rather than an `Entity` or an NPC id, for
 * two reasons neither of which is "ran out of time to wire it":
 *
 * 1. Nothing in this codebase derives an `NpcSubject` (a wearable-by-wearable
 *    ENGLISH description — "an acolyte of the drowned god", "wearing a grey
 *    tunic and leather sandals") from a live NPC's `CharacterSpec`
 *    (`{sex, bodyType, items}`, `src/render/lpc/character-builder.ts`). That
 *    mapping is a CONTENT question — it is exactly the "prompt lore" G0's
 *    header says G1/G2 own — and building it well (LPC item id → garment
 *    phrase, per role) is real authoring work, not plumbing. Faking it with a
 *    generic "a villager" subject would produce prompts no better than a coin
 *    flip and burn real money finding that out.
 *
 * 2. Landing a resolved sheet on an actual NPC means producing a companion
 *    CANVAS in the same row space `rig-rows.ts` bakes into `rigSheets`
 *    (`Game.rigSheets: Map<npcId, HTMLCanvasElement>`), not just handing back
 *    `Raster[]`. Per `src/render/CLAUDE.md`: `GpuScene.uploadTexture`
 *    memoizes textures by CANVAS IDENTITY, so pixels painted into an
 *    already-uploaded canvas never reach the GPU — a generated strip must
 *    therefore arrive as its OWN fresh-identity canvas, exactly like
 *    `paintRigStrip`'s, not a patch onto one already published. And
 *    `rigSheets` is keyed per NPC ENTITY id even though the content is purely
 *    a function of the WARDROBE (`getOrBakeRigRows` is only cheap today
 *    because it memoizes by spec hash internally) — deciding how a
 *    per-wardrobe generated strip meets that per-entity map, and how it
 *    degrades back to the rig bake when a clip/facing this source was never
 *    asked to generate is requested, is a rendering-integration slice of its
 *    own.
 *
 * Wiring either of those in behind a source+cache+gating layer that had not
 * been proven out first would be the wrong order, and CLAUDE.md's standing
 * rule is "no bespoke panels" without the plumbing under them being real. So:
 * `GeneratedNpcArtSource` is real, tested against the mock backend
 * (`src/assetgen/compilers/mock-backend.ts`), and safe to sit dark in `game.ts`
 * with `liveNpcArtEnabled = false` — but nothing on the frame path constructs
 * an `NpcArtRequest` or calls `warm()` yet. The next slice is the subject
 * table + the rig-strip merge, not this one.
 */
import { NPC_ART_RECIPE_VERSION } from '@/core/content-version';
import type { SpriteBackend } from '@/assetgen/compilers/backend';
import { generateNpcSheet, sliceStrip, type NpcSheetDeps, type NpcSheetJob } from '@/assetgen/npc-sprite-pipeline';
import { npcImagePrompt, type NpcSubject } from '@/assetgen/npc-image-prompt';
import type { Raster } from '@/render/sprite-postprocess';
import { decodePngToRaster, rasterToPngBlob, rasterToSpriteCanvas } from '@/render/sprite-codec';
import {
  generatedNpcArtKey, readGeneratedNpcArt, writeGeneratedNpcArt,
  isGeneratedNpcArtFailed, writeGeneratedNpcArtFailure, type GeneratedNpcArt,
} from '@/render/generated-npc-art-cache';

/** Concurrent paid generations — a town's first sight must not fire one
 *  request per NPC at once (429s, spend spikes). Same reasoning and value as
 *  the building source's `MAX_CONCURRENT_GENERATIONS`. */
const MAX_CONCURRENT_GENERATIONS = 2;

/** One vendored-library manifest row (see the future G1 seeder). No PBR
 *  companions — a redressed rig frame is flat/shadeless by the same contract
 *  as the rig bake it replaces (see npc-image-prompt.ts's FLAT_ALBEDO), so
 *  there is nothing here for a normal/material map to add. */
interface NpcBaseManifestEntry { file: string; frameCount: number; cellW: number; cellH: number }

/**
 * What a caller asks to have redressed: one clip+facing's rig-baked frames for
 * one wardrobe, plus the prompt facts a caller states about who is wearing
 * them. `layerSetHash` is the wardrobe's identity — the same role the
 * building source's blueprint hash plays, so two NPCs sharing a wardrobe share
 * one generation.
 */
export interface NpcArtRequest {
  subject: NpcSubject;
  clip: string;
  facing: string;
  layerSetHash: string;
  /** Rig-baked cells, in play order, all the same size — exactly
   *  `NpcSheetJob.frames`. */
  frames: readonly Raster[];
}

/** A resolved, redressed sheet: decoded frames in play order, ready for a
 *  caller to paint into whatever canvas it owns (see the header's scoping
 *  note on why that "caller" does not exist yet). */
export interface GeneratedNpcSprite {
  frames: Raster[];
  model: string;
  recipeVersion: string;
}

export interface GeneratedNpcSourceDeps {
  enabled: () => boolean;
  canSpend: () => boolean;
  /** img2img model id; drives the cache key and (via `backend`) which host
   *  actually generates. */
  model: () => string;
  /** The img2img backend to generate through. Called fresh per generation (not
   *  memoized by this source) so a live provider-config change takes effect
   *  without a reload — same pattern `paidArtGenOptions` uses for buildings. */
  backend: () => SpriteBackend;
  /** Reported the REAL spend for a generation attempt, win or lose. G0's
   *  `generateNpcSheet` accumulates cost internally but drops it when a sheet
   *  is refused post-spend (a quality-gate failure still burned a real
   *  request) — this source recovers it by wrapping `backend.generate` rather
   *  than reading `NpcSheetResult.costUsd`, so a rejected sheet's spend is
   *  never lost from the session cap. */
  onSpend?: (usd: number) => void;
  // Seams below default to the real pipeline; overridden in tests.
  decodeImage?: (blob: Blob) => Promise<Raster | null>;
  encodeInit?: (r: Raster) => Promise<string | null>;
  encodeStrip?: (r: Raster) => Promise<Blob | null>;
  cacheGet?: (key: string) => Promise<GeneratedNpcArt | null>;
  /** Vendored no-key base library (public/asset-library/npc-sprites/) —
   *  consulted after IDB, before paying. Exact key only; see the header. */
  baseGet?: (key: string) => Promise<GeneratedNpcArt | null>;
  cachePut?: (key: string, blob: Blob, meta: {
    model: string; prompt: string; frameCount: number; cellW: number; cellH: number;
  }) => Promise<void>;
  /** True if this key was previously recorded as a FAILED generation at the
   *  current recipe+model — skip it instead of re-paying every load. */
  cacheFailed?: (key: string) => Promise<boolean>;
  /** Persist a negative marker after a generation fails its quality gate, so
   *  the next reload skips it rather than re-paying. */
  recordFailure?: (key: string) => Promise<void>;
}

/** Blob → 'data:image/png;base64,…'. `FileReader` in the browser; a manual
 *  base64 fallback covers a worker/Node context with no `FileReader` but a
 *  `Blob.arrayBuffer()` (the runtime path is browser-only — Node authoring
 *  goes through G1's own script, per G0's header — this is a defensive
 *  fallback, not a second supported environment). */
async function blobToPngDataUri(blob: Blob): Promise<string | null> {
  if (typeof FileReader !== 'undefined') {
    return new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }
  try {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (const b of buf) bin += String.fromCharCode(b);
    const b64 = typeof btoa !== 'undefined'
      ? btoa(bin)
      : (globalThis as { Buffer?: { from(a: Uint8Array): { toString(enc: string): string } } })
          .Buffer?.from(buf).toString('base64');
    return b64 !== undefined ? `data:image/png;base64,${b64}` : null;
  } catch { return null; }
}

/** Raster → PNG data URI, for the img2img init image `NpcSheetDeps.encodeInit`
 *  wants. `rasterToSpriteCanvas`/`rasterToPngBlob` already degrade to null with
 *  no canvas backend (jsdom); this just carries that through one more encode
 *  step. */
async function rasterToPngDataUri(r: Raster): Promise<string | null> {
  if (!rasterToSpriteCanvas(r)) return null; // no canvas backend — fail fast, no wasted encode
  const blob = await rasterToPngBlob(r);
  return blob ? blobToPngDataUri(blob) : null;
}

export class GeneratedNpcArtSource {
  private readonly cache = new Map<string, GeneratedNpcSprite | null>();
  private readonly inflight = new Set<string>();
  private readonly warned = new Set<string>();
  private readonly d: Required<GeneratedNpcSourceDeps>;
  // Bumped each time a request GAINS art — a future caller folds this into its
  // own art-rev the same way `buildingArtRev` does, so a warmed sprite that
  // resolves after its canvas was last painted still gets repainted.
  private ver = 0;
  version(): number { return this.ver; }
  /** Warms still in flight (IDB read / vendored-library fetch / generation). */
  pending(): number { return this.inflight.size; }

  constructor(deps: GeneratedNpcSourceDeps) {
    this.d = {
      onSpend: () => {},
      decodeImage: (b) => decodePngToRaster(b),
      encodeInit: (r) => rasterToPngDataUri(r),
      encodeStrip: (r) => rasterToPngBlob(r),
      cacheGet: (k) => readGeneratedNpcArt(k),
      baseGet: (k) => this.fetchFromBaseLibrary(k),
      cachePut: (k, b, m) => writeGeneratedNpcArt(k, b, m),
      cacheFailed: (k) => isGeneratedNpcArtFailed(k),
      recordFailure: (k) => writeGeneratedNpcArtFailure(k, deps.model()),
      ...deps,
    } as Required<GeneratedNpcSourceDeps>;
  }

  private keyOf(req: NpcArtRequest): string {
    return generatedNpcArtKey(req.clip, req.facing, req.layerSetHash, this.d.model());
  }

  peek(req: NpcArtRequest): GeneratedNpcSprite | null {
    return this.cache.get(this.keyOf(req)) ?? null;
  }

  warm(req: NpcArtRequest): void {
    const key = this.keyOf(req);
    if (this.cache.has(key) || this.inflight.has(key)) return;
    // Do NOT gate on enabled() here — see the header's rule (and the building
    // source's identical one): reading FREE art (IDB cache + the vendored base
    // library) must always run, or a shipped sheet never loads while paid gen
    // is off. enabled() gates only the PAID generateNpcSheet step, inside run().
    this.inflight.add(key);
    void this.run(req, key).finally(() => this.inflight.delete(key));
  }

  // Vendored base library: a manifest of pre-generated sheets shipped with the
  // site (seeded by G1's author-time script through the SAME pipeline + key
  // derivation), so keyless players get real art without paying. Fetched
  // lazily, once; any failure degrades to "no base library".
  private baseManifest: Promise<Record<string, NpcBaseManifestEntry> | null> | null = null;
  private async fetchFromBaseLibrary(key: string): Promise<GeneratedNpcArt | null> {
    if (typeof fetch === 'undefined') return null;
    try {
      this.baseManifest ??= (async () => {
        const { assetUrl } = await import('@/core/asset-url');
        const resp = await fetch(assetUrl('asset-library/npc-sprites/manifest.json'));
        if (!resp.ok) return null;
        const json = await resp.json() as { entries?: Record<string, NpcBaseManifestEntry> };
        return json.entries ?? null;
      })().catch(() => null);
      const entries = await this.baseManifest;
      if (!entries) return null;
      // EXACT KEY ONLY — no bare-preset/bare-role fallback. See the header for
      // why the building source's preset-fallback wart is deliberately not
      // repeated here: a miss here is honest, not "close enough".
      const entry = entries[key];
      if (!entry) return null;
      const { assetUrl } = await import('@/core/asset-url');
      const resp = await fetch(assetUrl(`asset-library/npc-sprites/${entry.file}`));
      if (!resp.ok) return null;
      return { blob: await resp.blob(), frameCount: entry.frameCount, cellW: entry.cellW, cellH: entry.cellH };
    } catch { return null; }
  }

  // Tiny semaphore around the NETWORK step only (IDB reads + local raster work
  // stay unbounded): excess generations queue and run as slots free up. Wraps
  // the backend's `generate`, so it gates every per-FRAME request a sheet
  // makes, not just the sheet as a whole.
  private genActive = 0;
  private readonly genQueue: Array<() => void> = [];
  private async withGenSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.genActive >= MAX_CONCURRENT_GENERATIONS) {
      // Wait to INHERIT a slot — the releaser hands it over without
      // decrementing, so a fresh caller can never jump the queue and overshoot
      // the cap.
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

  /** Warn once per key — generation problems repeat per attempt and per
   *  session. */
  private note(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[generated-npc-art] ${msg}`);
  }

  private resolve(key: string, sprite: GeneratedNpcSprite | null): void {
    this.cache.set(key, sprite);
    if (sprite) this.ver++;
  }

  private async decodeHit(hit: GeneratedNpcArt): Promise<Raster[] | null> {
    const strip = await this.d.decodeImage(hit.blob);
    if (!strip) return null;
    try { return sliceStrip(strip, hit.frameCount); }
    catch { return null; } // stored frame count doesn't divide the strip — corrupt/foreign record
  }

  private async run(req: NpcArtRequest, key: string): Promise<void> {
    try {
      // IDB first (paid results), then the vendored base library — both hold
      // the already-registered, already-quantized strip.
      const hit = await this.d.cacheGet(key) ?? await this.d.baseGet(key);
      if (hit) {
        const frames = await this.decodeHit(hit);
        this.resolve(key, frames ? { frames, model: this.d.model(), recipeVersion: NPC_ART_RECIPE_VERSION } : null);
        return;
      }
      // Known-bad at this recipe+model: a prior session generated this sheet
      // but it failed the quality gate. Skip rather than re-pay to regenerate
      // it every load. Self-heals on a recipe bump or model switch — the key
      // changes, so this marker no longer matches.
      if (await this.d.cacheFailed(key)) { this.cache.set(key, null); return; }
      // Paid generation disabled OR over budget: cache null so we DON'T
      // re-enter run() (and re-read IDB) every frame for this request. Free
      // cached/vendored art was already consulted above; only the PAID step is
      // gated here. Session spend only ever rises, so retrying within the
      // session is pointless; a reload clears this in-mem cache (and, if paid
      // gen was toggled on, lets genuinely-uncached wardrobes regenerate then).
      if (!this.d.enabled() || !this.d.canSpend()) { this.cache.set(key, null); return; }

      const model = this.d.model();
      const prompt = npcImagePrompt({ subject: req.subject, clip: req.clip, facing: req.facing, model });
      const job: NpcSheetJob = { clip: req.clip, layerSetHash: req.layerSetHash, prompt, frames: req.frames };

      // Wrap the raw backend rather than trust NpcSheetResult.costUsd: G0's
      // generateNpcSheet accumulates spend locally and drops it on a null
      // return (a quality-gate refusal AFTER a real, billed request) — see the
      // header's note on GeneratedNpcSourceDeps.onSpend. Wrapping here reports
      // every attempt's cost regardless of outcome, and doubles as the
      // concurrency gate (limits actual network calls, not sheets).
      const rawBackend = this.d.backend();
      let spent = 0;
      const backend: SpriteBackend = {
        ...rawBackend,
        generate: (spriteJob) => this.withGenSlot(async () => {
          const res = await rawBackend.generate(spriteJob);
          spent += res.costUsd ?? 0;
          return res;
        }),
      };
      const deps: NpcSheetDeps = {
        backend,
        decodeImage: this.d.decodeImage,
        encodeInit: this.d.encodeInit,
        onNote: (m) => this.note(key, m),
      };
      const result = await generateNpcSheet(job, deps);
      if (spent > 0) this.d.onSpend(spent);

      if (!result) {
        // Validated INSIDE generateNpcSheet (border/IoU/shimmer gates, one
        // retry per frame) — a null here already means "generated but
        // refused", not "never asked". Persist the negative marker so the next
        // reload skips it instead of re-paying. A decode/network failure
        // throws instead (see catch below) and stays session-only/retryable.
        await this.d.recordFailure(key);
        this.cache.set(key, null);
        return;
      }
      const png = await this.d.encodeStrip(result.strip);
      if (png) {
        await this.d.cachePut(key, png, {
          model: result.model, prompt, frameCount: result.frames.length,
          cellW: result.frames[0].w, cellH: result.frames[0].h,
        });
      }
      this.resolve(key, { frames: result.frames, model: result.model, recipeVersion: result.recipeVersion });
    } catch (err) {
      if (!this.warned.has(key)) { console.warn('[generated-npc-art] generation failed', err); this.warned.add(key); }
      this.cache.set(key, null);
    }
  }

  /** Drop every resolved sprite AND the vendored-library manifest memo, then
   *  bump the revision — freshly seeded art gets re-fetched IN PLACE on the
   *  next warm, no reload. Mirrors the building source's `refresh()`, kept for
   *  the same future dev-tool use even though nothing calls it yet. */
  refresh(): void {
    this.cache.clear();
    this.inflight.clear();
    this.warned.clear();
    this.baseManifest = null;
    this.ver++;
  }

  clear(): void { this.cache.clear(); this.inflight.clear(); this.warned.clear(); }
}
