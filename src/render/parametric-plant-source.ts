// src/render/parametric-plant-source.ts
// Runtime, memoized source of manifold-generated TREE sprites — the kind-keyed
// twin of ParametricBuildingSource. Trees are MANY (a forest = thousands), so
// unlike buildings they do NOT carry a per-entity blueprint; instead this caches
// a few SEEDED VARIANTS per species (kind), synthesising each preset on first
// warm() with a per-variant seed so "every oak is the same bitmap" becomes N
// distinct silhouettes. peek(kind, variant) is the sync frame read; warm(kind)
// kicks async generation of ALL variants off the frame path. Any failure /
// non-plant kind caches null → caller falls back to the flat billboard. Never
// throws on the frame path.
//
// Warming discipline (loading-screen contract): `prewarmAll` bakes VARIANT 0 of
// every species up front (identical cost to the pre-variant world — trees render
// their real sprite from frame one). The extra variants warm LAZILY when a frame
// asks for one; until a variant lands, peek() falls back to variant 0 (no grey
// box, no billboard flash), and the settle bumps version() so the static draw
// cache rebuilds and the distinct silhouettes swap in.
import type { ResolvedBlueprint } from '@/blueprint/types';
import { synthesizeBlueprint, isPlantPreset, plantPresetNames } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { type SpritePack } from '@/render/iso/sprite-canvas';
import { composeStructure, type StructureSpec, type StructureResult } from '@/assetgen/compose';
import { structureResultToPack } from '@/render/parametric-building-source';
import { scheduleCompose } from '@/render/compose-scheduler';
import { composePayload } from '@/render/compose-offthread';
import { canonicalJson } from '@/render/generated-art-cache';
import { FLORA_VARIANTS, FLORA_BARE_VARIANT, floraVariantSeed } from '@/render/flora-variant';
import {
  parametricSpriteKey, readParametricSprite, writeParametricSprite,
  payloadFromResult, packFromPayload, type CachedSpritePayload,
} from '@/render/parametric-sprite-cache';

export interface ParametricPlantDeps {
  toSpec?: (rb: ResolvedBlueprint) => StructureSpec | null;
  compose?: (s: StructureSpec) => Promise<StructureResult>;
  toSprite?: (r: StructureResult) => SpritePack | null;
  /** Retain each species' full StructureResult for debug inspection (Render
   *  Studio); off in-game so per-species map buffers aren't held worldwide. */
  keepStages?: boolean;
  /** Called after EACH async variant settles (bumps version() too). Wire to the
   *  frame loop's `requestRender` so a lazily-warmed variant swaps in even while the
   *  loop is idle/paused — otherwise the new silhouette shows only on the next
   *  camera move (the static draw cache folds version() into its art-rev debounce). */
  onWarm?: () => void;
  /** Test seam: rebuild a SpritePack from a persisted cache payload (defaults to
   *  `packFromPayload`; jsdom has no canvas, so tests inject a fake). */
  packFromCache?: (p: CachedSpritePayload) => SpritePack | null;
}

export class ParametricPlantSource {
  /** kind → per-variant packs. A slot is `undefined` until its variant settles,
   *  then the composed pack (or null on failure / non-plant). */
  private readonly cache = new Map<string, (SpritePack | null)[]>();
  /** kind → variant-0 StructureResult (studio debug; only when `keepStages`). */
  private readonly stages = new Map<string, StructureResult>();
  /** `${kind}#${variant}` → in-flight generation. */
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly warned = new Set<string>();
  private rev = 0;
  private readonly toSpec: NonNullable<ParametricPlantDeps['toSpec']>;
  private readonly compose: NonNullable<ParametricPlantDeps['compose']>;
  private readonly toSprite: NonNullable<ParametricPlantDeps['toSprite']>;
  private readonly keepStages: boolean;
  private readonly onWarm?: () => void;
  private readonly packFromCache: NonNullable<ParametricPlantDeps['packFromCache']>;
  /** Persist composed packs in IDB (content-addressed on the compose spec) so the
   *  deterministic compose CPU is paid once per ART_RECIPE_VERSION, not per boot.
   *  The variant seed rides IN the spec, so each variant gets its own key for free.
   *  OFF when keepStages: the studio wants fresh composes with every stage buffer. */
  private readonly persist: boolean;
  /** Offload compose to the worker pool — only when the DEFAULT compose is used (an
   *  injected/closure compose can't cross the worker boundary) AND not retaining stage
   *  buffers. Injected-compose tests + the studio keep the byte-identical inline path. */
  private readonly offthread: boolean;

  constructor(deps: ParametricPlantDeps = {}) {
    this.toSpec = deps.toSpec ?? ((rb) => toGeometry(rb));
    this.compose = deps.compose ?? composeStructure;
    this.toSprite = deps.toSprite ?? structureResultToPack;
    this.keepStages = deps.keepStages ?? false;
    this.onWarm = deps.onWarm;
    this.packFromCache = deps.packFromCache ?? packFromPayload;
    this.persist = !this.keepStages;
    this.offthread = deps.compose === undefined && !this.keepStages;
  }

  /** Monotonic version — bumps as each variant settles. Folded into `buildingArtRev`
   *  so the static draw cache rebuilds when lazily-warmed variants land. */
  version(): number { return this.rev; }

  /** Sync read of an already-generated variant pack for a species kind. Falls back to
   *  variant 0 when the requested variant hasn't composed yet (graceful — no billboard
   *  flash while the extra variants warm), and null when nothing is ready. */
  peek(kind: string, variant = 0): SpritePack | null {
    const arr = this.cache.get(kind);
    if (!arr) return null;
    return arr[variant] ?? arr[0] ?? null;
  }

  /** Sync read of a species' retained pipeline buffers (variant 0; only `keepStages`). */
  stagesFor(kind: string): StructureResult | null {
    return this.stages.get(kind) ?? null;
  }

  /** Fire-and-forget generation of ALL variants for a species kind. Safe every frame;
   *  each (kind, variant) runs once. Returns a promise that resolves when every variant
   *  is cached (or fails to). */
  warm(kind: string): Promise<void> {
    const vs: Promise<void>[] = [];
    for (let v = 0; v < FLORA_VARIANTS; v++) vs.push(this.warmVariant(kind, v));
    return Promise.all(vs).then(() => undefined);
  }

  /** Fire-and-forget generation of ONE variant. Returns a promise that resolves once
   *  the variant pack is cached (or fails to) — `prewarmAll` awaits variant 0 to keep
   *  its loading-screen contract. */
  warmVariant(kind: string, variant: number): Promise<void> {
    const key = `${kind}#${variant}`;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const existing = this.cache.get(kind);
    if (existing && existing[variant] !== undefined) return Promise.resolve();
    const arr = existing ?? [];
    if (!existing) this.cache.set(kind, arr);
    const settle = (pack: SpritePack | null): void => { arr[variant] = pack; this.rev++; this.onWarm?.(); };

    if (!isPlantPreset(kind)) { settle(null); return Promise.resolve(); }
    // The BARE slot (alpine fidelity) re-composes the VARIANT-0 skeleton with its
    // leaves dropped: same seed (0), the branch_plant parts flagged bare. Species
    // without a branch_plant part (rocks, landforms) compose identically to variant
    // 0 there — harmless, and the draw list only requests bare for deciduous kinds.
    const bare = variant === FLORA_BARE_VARIANT;
    const rb = synthesizeBlueprint(kind, [], floraVariantSeed(kind, bare ? 0 : variant));
    if (!rb) { settle(null); return Promise.resolve(); }
    if (bare) {
      for (const part of rb.parts) {
        if (part.type === 'branch_plant') part.params = { ...part.params, bare: 1 };
      }
    }
    let spec: StructureSpec | null;
    try {
      spec = this.toSpec(rb);
    } catch (err) {
      if (!this.warned.has(key)) { console.warn('[parametric-plant] spec failed', err); this.warned.add(key); }
      settle(null);
      return Promise.resolve();
    }
    if (!spec) { settle(null); return Promise.resolve(); }
    // Content-addressed persistent key over the compose input (the variant seed is
    // baked into the spec), so a preset/param/seed change misses automatically.
    const idbKey = this.persist ? parametricSpriteKey('plt', canonicalJson(spec)) : null;
    // Off-thread path (production default): the worker pool composes the species and
    // returns its cache payload, which rebuilds a pixel-identical pack on the main
    // thread (WP-A). Plants stay in the back lane (buildings texture first).
    const composeOffthread = (): Promise<void> => composePayload(spec!)
      .then((payload) => {
        settle(payload ? this.packFromCache(payload) : null);
        // Write-behind persist: never blocks sprite availability, swallows failure.
        if (idbKey && payload) void writeParametricSprite(idbKey, payload);
      })
      .catch((err) => {
        if (!this.warned.has(key)) { console.warn('[parametric-plant] generation failed', err); this.warned.add(key); }
        settle(null);
      });
    // Inline path (injected compose / studio keepStages): byte-identical to pre-WP-A.
    const composeInline = (): Promise<void> => scheduleCompose(() => this.compose(spec!))
      .then((r) => {
        if (this.keepStages && variant === 0) this.stages.set(kind, r);
        settle(this.toSprite(r));
        // Write-behind persist: never blocks sprite availability, swallows failure.
        if (idbKey) {
          const payload = payloadFromResult(r);
          if (payload) void writeParametricSprite(idbKey, payload);
        }
      })
      .catch((err) => {
        if (!this.warned.has(key)) { console.warn('[parametric-plant] generation failed', err); this.warned.add(key); }
        settle(null);
      });
    const composePath = this.offthread ? composeOffthread : composeInline;
    // Persisted-sprite fast path: hit → rebuild the pack from raw cached buffers
    // (byte-exact vs a fresh compose), NO compose job; miss/decode failure/wedged
    // IDB degrades to composing. The returned promise still settles only once the
    // pack is cached, so prewarmAll keeps its loading-screen contract.
    const p = (idbKey
      ? readParametricSprite(idbKey)
          .then((payload) => {
            const pack = payload ? this.packFromCache(payload) : null;
            if (pack) { settle(pack); return; }
            return composePath();
          })
          .catch(() => composePath())
      : composePath())
      .finally(() => { this.inflight.delete(key); });
    this.inflight.set(key, p);
    return p;
  }

  /** Warm VARIANT 0 of every plant species up front (identical cost to the pre-variant
   *  world). Awaited at the loading screen so in-game trees render their real sprite from
   *  frame one — no placeholder→billboard→sprite flash. The extra variants warm lazily as
   *  the camera meets them. `onProgress` fires as each species settles (done/total). */
  prewarmAll(onProgress?: (done: number, total: number) => void): Promise<void> {
    const kinds = plantPresetNames();
    let done = 0;
    return Promise.all(kinds.map((k) => this.warmVariant(k, 0).then(() => {
      onProgress?.(++done, kinds.length);
    }))).then(() => undefined);
  }

  /** Clear on world reset. */
  clear(): void { this.cache.clear(); this.stages.clear(); this.inflight.clear(); this.warned.clear(); this.rev = 0; }
}
