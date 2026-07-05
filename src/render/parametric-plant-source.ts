// src/render/parametric-plant-source.ts
// Runtime, memoized source of manifold-generated TREE sprites — the kind-keyed
// twin of ParametricBuildingSource. Trees are MANY (a forest = thousands), so
// unlike buildings they do NOT carry a per-entity blueprint; instead this caches
// ONE SpritePack per species (kind), synthesising the preset on first warm().
// peek() is the sync frame read; warm() kicks async generation off the frame
// path. Any failure / non-plant kind caches null → caller falls back to the
// flat billboard. Never throws on the frame path.
import type { ResolvedBlueprint } from '@/blueprint/types';
import { synthesizeBlueprint, isPlantPreset, plantPresetNames } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { type SpritePack } from '@/render/iso/sprite-canvas';
import { composeStructure, type StructureSpec, type StructureResult } from '@/assetgen/compose';
import { structureResultToPack } from '@/render/parametric-building-source';
import { scheduleCompose } from '@/render/compose-scheduler';
import { composePayload } from '@/render/compose-offthread';
import { canonicalJson } from '@/render/generated-art-cache';
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
  /** Test seam: rebuild a SpritePack from a persisted cache payload (defaults to
   *  `packFromPayload`; jsdom has no canvas, so tests inject a fake). */
  packFromCache?: (p: CachedSpritePayload) => SpritePack | null;
}

export class ParametricPlantSource {
  private readonly cache = new Map<string, SpritePack | null>();
  private readonly stages = new Map<string, StructureResult>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly warned = new Set<string>();
  private readonly toSpec: NonNullable<ParametricPlantDeps['toSpec']>;
  private readonly compose: NonNullable<ParametricPlantDeps['compose']>;
  private readonly toSprite: NonNullable<ParametricPlantDeps['toSprite']>;
  private readonly keepStages: boolean;
  private readonly packFromCache: NonNullable<ParametricPlantDeps['packFromCache']>;
  /** Persist composed packs in IDB (content-addressed on the compose spec) so the
   *  deterministic compose CPU is paid once per ART_RECIPE_VERSION, not per boot.
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
    this.packFromCache = deps.packFromCache ?? packFromPayload;
    this.persist = !this.keepStages;
    this.offthread = deps.compose === undefined && !this.keepStages;
  }

  /** Sync read of an already-generated sprite pack for a species kind (null if absent). */
  peek(kind: string): SpritePack | null {
    return this.cache.get(kind) ?? null;
  }

  /** Sync read of a species' retained pipeline buffers (only when `keepStages`). */
  stagesFor(kind: string): StructureResult | null {
    return this.stages.get(kind) ?? null;
  }

  /** Fire-and-forget generation for a species kind. Safe every frame; runs once per
   *  kind. Returns a promise that resolves when the pack is cached (or fails to) so
   *  `prewarmAll` can block the loading screen until every species is ready. */
  warm(kind: string): Promise<void> {
    if (this.cache.has(kind)) return Promise.resolve();
    const pending = this.inflight.get(kind);
    if (pending) return pending;
    if (!isPlantPreset(kind)) { this.cache.set(kind, null); return Promise.resolve(); }
    const rb = synthesizeBlueprint(kind);
    if (!rb) { this.cache.set(kind, null); return Promise.resolve(); }
    let spec: StructureSpec | null;
    try {
      spec = this.toSpec(rb);
    } catch (err) {
      if (!this.warned.has(kind)) { console.warn('[parametric-plant] spec failed', err); this.warned.add(kind); }
      this.cache.set(kind, null);
      return Promise.resolve();
    }
    if (!spec) { this.cache.set(kind, null); return Promise.resolve(); }
    // Content-addressed persistent key over the compose input, so a preset/param
    // change misses automatically (never keyed on the species name).
    const idbKey = this.persist ? parametricSpriteKey('plt', canonicalJson(spec)) : null;
    // Off-thread path (production default): the worker pool composes the species and
    // returns its cache payload, which rebuilds a pixel-identical pack on the main
    // thread (WP-A). Plants stay in the back lane (buildings texture first).
    const composeOffthread = (): Promise<void> => composePayload(spec!)
      .then((payload) => {
        this.cache.set(kind, payload ? this.packFromCache(payload) : null);
        // Write-behind persist: never blocks sprite availability, swallows failure.
        if (idbKey && payload) void writeParametricSprite(idbKey, payload);
      })
      .catch((err) => {
        if (!this.warned.has(kind)) { console.warn('[parametric-plant] generation failed', err); this.warned.add(kind); }
        this.cache.set(kind, null);
      });
    // Inline path (injected compose / studio keepStages): byte-identical to pre-WP-A.
    const composeInline = (): Promise<void> => scheduleCompose(() => this.compose(spec!))
      .then((r) => {
        if (this.keepStages) this.stages.set(kind, r);
        this.cache.set(kind, this.toSprite(r));
        // Write-behind persist: never blocks sprite availability, swallows failure.
        if (idbKey) {
          const payload = payloadFromResult(r);
          if (payload) void writeParametricSprite(idbKey, payload);
        }
      })
      .catch((err) => {
        if (!this.warned.has(kind)) { console.warn('[parametric-plant] generation failed', err); this.warned.add(kind); }
        this.cache.set(kind, null);
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
            if (pack) { this.cache.set(kind, pack); return; }
            return composePath();
          })
          .catch(() => composePath())
      : composePath())
      .finally(() => { this.inflight.delete(kind); });
    this.inflight.set(kind, p);
    return p;
  }

  /** Warm every plant species up front (handful of `composeStructure` calls). Awaited
   *  at the loading screen so in-game trees render their real sprite from frame one —
   *  no placeholder→billboard→sprite flash. `onProgress` fires as each species settles
   *  (done/total) so the loading bar can tick through the ~13s this takes. */
  prewarmAll(onProgress?: (done: number, total: number) => void): Promise<void> {
    const kinds = plantPresetNames();
    let done = 0;
    return Promise.all(kinds.map((k) => this.warm(k).then(() => {
      onProgress?.(++done, kinds.length);
    }))).then(() => undefined);
  }

  /** Clear on world reset. */
  clear(): void { this.cache.clear(); this.stages.clear(); this.inflight.clear(); this.warned.clear(); }
}
