// src/render/parametric-building-source.ts
// Runtime, memoized source of manifold-generated building sprites. Mirrors
// ArtResolver's peek/warm contract: peek() is the sync frame-path read; warm() kicks
// async generation off the frame path. Cache key = blueprint identity, so identical
// buildings share one sprite. Any failure / unsupported plan caches null → caller
// falls back to the legacy massing. Never throws on the frame path.
import type { Entity } from '@/core/types';
import { blueprintOf } from '@/blueprint/entity';
import { cutawayOf } from '@/blueprint/cutaway';
import type { ResolvedBlueprint } from '@/blueprint/types';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { greyToSpriteCanvas, rgbaToCanvas, cropRgba, hasEmissivePixels, type SpritePack } from '@/render/iso/sprite-canvas';
import { composeStructure, type StructureSpec, type StructureResult } from '@/assetgen/compose';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { scheduleCompose } from '@/render/compose-scheduler';
import { composePayload } from '@/render/compose-offthread';
import { canonicalJson } from '@/render/generated-art-cache';
import {
  parametricSpriteKey, readParametricSprite, writeParametricSprite,
  payloadFromResult, packFromPayload, type CachedSpritePayload,
} from '@/render/parametric-sprite-cache';

export interface ParametricSourceDeps {
  toSpec?: (rb: ResolvedBlueprint) => StructureSpec | null;
  compose?: (s: StructureSpec) => Promise<StructureResult>;
  toSprite?: (r: StructureResult) => SpritePack | null;
  /** Retain each asset's full StructureResult (every pipeline buffer) for debug
   *  inspection — the Render Studio reads them; the game leaves this off so the
   *  per-asset map buffers aren't held in memory worldwide. */
  keepStages?: boolean;
  /** Called after EACH async pack settles (bumps the version too). Wire to the frame
   *  loop's `requestRender` so an idle/paused loop draws the newly-textured building —
   *  otherwise a pack that lands while nothing is animating shows its flatblock until the
   *  next camera move ([[gotcha-buildings-flatblock-static-cache]]). */
  onWarm?: () => void;
  /** Test seam: rebuild a SpritePack from a persisted cache payload (defaults to
   *  `packFromPayload`). jsdom has no canvas, so tests inject a fake to exercise
   *  the IDB-hit path. */
  packFromCache?: (p: CachedSpritePayload) => SpritePack | null;
}

/** Crop the grey render + its co-registered normal/material maps to one pack. */
export function structureResultToPack(r: StructureResult): SpritePack | null {
  const albedo = greyToSpriteCanvas(r.grey, r.size, r.bbox);
  if (!albedo) return null;
  const pack: SpritePack = {
    albedo,
    normal: greyToSpriteCanvas(r.normal, r.size, r.bbox) ?? undefined,
    // Material is a DATA map (A=metallic, not coverage) — crop it RAW, never via a
    // premultiplied 2D canvas which would zero AO/roughness where metallic=0.
    materialData: cropRgba(r.material, r.size, r.bbox) ?? undefined,
  };
  // Emissive (lit window panes) — only crop+attach when there's actual glow, so
  // the vast majority of window-less sprites never upload a black texture.
  if (hasEmissivePixels(r.emissive)) {
    pack.emissive = greyToSpriteCanvas(r.emissive, r.size, r.bbox) ?? undefined;
  }
  // Geometry-baked ground shadow. Offset is stored relative to the albedo crop's
  // BOTTOM-CENTRE (the sprite's foot/ground anchor) — NOT its top-left — so the
  // same shadow aligns under ANY co-footed sprite (parametric OR the img2img
  // building that shares the footprint anchor), letting a cached building borrow
  // this geometry shadow.
  if (r.shadow) {
    const canvas = rgbaToCanvas(r.shadow.data, r.shadow.w, r.shadow.h);
    if (canvas) {
      const footX = r.bbox.x + r.bbox.w / 2, footY = r.bbox.y + r.bbox.h;
      pack.shadow = { canvas, dx: r.shadow.ox - footX, dy: r.shadow.oy - footY };
    }
  }
  // Mount sockets are already normalised to the same opaque bbox as the crop, so they ride
  // along unchanged — UVs align with the albedo by construction.
  if (r.anchors.tags?.length) pack.tags = r.anchors.tags;
  return pack;
}

function blueprintRbOf(e: Entity): ResolvedBlueprint | undefined {
  return blueprintOf(e)?.rb;
}

/** Stable key from the resolved blueprint (identical blueprints → one cached sprite). */
function keyOf(rb: ResolvedBlueprint): string { return JSON.stringify(rb); }

export class ParametricBuildingSource {
  private readonly cache = new Map<string, SpritePack | null>();
  private readonly stages = new Map<string, StructureResult>();
  private readonly inflight = new Set<string>();
  private readonly warned = new Set<string>();
  /** Bumped each time an async warm settles (per pack, not per batch). A cache whose key
   *  folds in `version()` rebuilds as each pack lands, so buildings texture incrementally —
   *  otherwise a static draw-list snapshot taken before the composes finish shows flatblocks
   *  ([[gotcha-buildings-flatblock-static-cache]]). */
  private rev = 0;
  private readonly toSpec: NonNullable<ParametricSourceDeps['toSpec']>;
  private readonly compose: NonNullable<ParametricSourceDeps['compose']>;
  private readonly toSprite: NonNullable<ParametricSourceDeps['toSprite']>;
  private readonly keepStages: boolean;
  private readonly onWarm?: () => void;
  private readonly packFromCache: NonNullable<ParametricSourceDeps['packFromCache']>;
  /** Persist composed packs in IDB (content-addressed on the compose spec) so the
   *  deterministic compose CPU is paid once per ART_RECIPE_VERSION, not per boot.
   *  OFF when keepStages: the studio wants fresh composes with every stage buffer. */
  private readonly persist: boolean;
  /** Offload compose to the worker pool. Only when the DEFAULT compose is used (an
   *  injected/closure compose can't cross the worker boundary) AND not retaining stage
   *  buffers (the worker returns only the cache payload). Injected-compose tests + the
   *  studio keep the byte-identical inline path. */
  private readonly offthread: boolean;

  constructor(deps: ParametricSourceDeps = {}) {
    // Entities restored from an autosave carry an already-RESOLVED blueprint, so this
    // may be the first code path to compile one — register the part/feature types here
    // rather than relying on a preset-synthesis call having happened earlier.
    ensureBuildingTypesRegistered();
    this.toSpec = deps.toSpec ?? ((rb) => toGeometry(rb));
    // K0d: the freeze-safe in-game render textures every facet by the analytic
    // Material+Finish engine at its world position — killing the flat grey-massing
    // look with $0 procedural surface (no paid gen). Gated HERE, not as a global
    // compose default, so the img2img grey-INIT path (material-coded flat colours the
    // prompt legend keys off) and the assetgen goldens stay untouched. The parametric
    // cache is in-memory + recomputed per session, so no ART_RECIPE_VERSION bump is
    // needed for returning players to pick up the texture.
    // `spec.yaw` carries the placement orientation (to-geometry maps rb.orientation → yaw);
    // pass it through so an oriented building's geometry actually rotates. yaw-0/undefined is
    // a compose no-op, so non-oriented buildings stay byte-identical.
    this.compose = deps.compose ?? ((spec) => composeStructure(spec, undefined, { surfaceTexture: true, ...(spec.yaw ? { yaw: spec.yaw } : {}) }));
    this.toSprite = deps.toSprite ?? structureResultToPack;
    this.keepStages = deps.keepStages ?? false;
    this.onWarm = deps.onWarm;
    this.packFromCache = deps.packFromCache ?? packFromPayload;
    this.persist = !this.keepStages;
    this.offthread = deps.compose === undefined && !this.keepStages;
  }

  /** Sync read of an already-generated sprite pack (null if absent / unsupported / failed).
   *  `cutaway` reads the roof-off interior variant (interior I-2 focus reveal) — a separate
   *  cache entry keyed off the cutaway-patched blueprint. */
  peek(e: Entity, cutaway = false): SpritePack | null {
    const rb0 = blueprintRbOf(e);
    if (!rb0) return null;
    const rb = cutaway ? cutawayOf(rb0) : rb0;
    return this.cache.get(keyOf(rb)) ?? null;
  }

  /** Sync read of an asset's retained pipeline buffers (only when `keepStages`). */
  stagesFor(e: Entity): StructureResult | null {
    const rb = blueprintRbOf(e);
    return rb ? (this.stages.get(keyOf(rb)) ?? null) : null;
  }

  /** Fire-and-forget generation. Safe to call every frame; runs at most once per key.
   *  `cutaway` warms the roof-off interior variant (interior I-2). */
  warm(e: Entity, cutaway = false): void {
    const rb0 = blueprintRbOf(e);
    if (!rb0) return;
    const rb = cutaway ? cutawayOf(rb0) : rb0;
    const k = keyOf(rb);
    if (this.cache.has(k) || this.inflight.has(k)) return;
    let spec: StructureSpec | null;
    try {
      spec = this.toSpec(rb);
    } catch (err) {
      // Uphold the never-throws contract: a bad blueprint must not kill the frame loop.
      if (!this.warned.has(k)) { console.warn('[parametric-building] spec failed', err); this.warned.add(k); }
      this.cache.set(k, null);
      return;
    }
    if (!spec) { this.cache.set(k, null); return; }
    this.inflight.add(k);
    // Content-addressed persistent key: hashes the COMPOSE INPUT (the spec, yaw
    // included), so any preset/param/recipe change misses automatically.
    const idbKey = this.persist ? parametricSpriteKey('bld', canonicalJson(spec)) : null;
    // Off-thread path (production default): the worker pool composes in parallel and
    // returns the finished cache payload, which rebuilds a pixel-identical pack on the
    // main thread (WP-A). Buildings take the front lane — the player watches towns.
    const composeOffthread = (): Promise<void> =>
      composePayload(spec!, { surfaceTexture: true, ...(spec!.yaw ? { yaw: spec!.yaw } : {}) }, { priority: 'front' })
        .then((payload) => {
          this.cache.set(k, payload ? this.packFromCache(payload) : null);
          // Write-behind persist: never blocks sprite availability, swallows failure.
          if (idbKey && payload) void writeParametricSprite(idbKey, payload);
        })
        .catch((err) => {
          if (!this.warned.has(k)) { console.warn('[parametric-building] generation failed', err); this.warned.add(k); }
          this.cache.set(k, null);
        });
    // Inline path (injected compose / studio keepStages): byte-identical to pre-WP-A —
    // through the shared main-thread queue (see compose-scheduler.ts), retaining stages.
    const composeInline = (): Promise<void> =>
      scheduleCompose(() => this.compose(spec!), { priority: 'front' })
        .then((r) => {
          if (this.keepStages) this.stages.set(k, r);
          this.cache.set(k, this.toSprite(r));
          // Write-behind persist: never blocks sprite availability, swallows failure.
          if (idbKey) {
            const payload = payloadFromResult(r);
            if (payload) void writeParametricSprite(idbKey, payload);
          }
        })
        .catch((err) => {
          if (!this.warned.has(k)) { console.warn('[parametric-building] generation failed', err); this.warned.add(k); }
          this.cache.set(k, null);
        });
    const composePath = this.offthread ? composeOffthread : composeInline;
    const settle = (): void => {
      // Bump per-pack (NOT only when the whole batch drains): each composed pack changes
      // the cache key so the static draw list rebuilds and that building textures the next
      // frame, incrementally — waiting for the last of N packs froze the earlier ones as
      // flatblocks. Then kick a render so an idle/paused loop actually draws it.
      this.inflight.delete(k);
      this.rev++;
      this.onWarm?.();
    };
    if (!idbKey) { void composePath().finally(settle); return; }
    // Persisted-sprite fast path: a hit rebuilds the pack from raw cached buffers
    // (byte-exact vs a fresh compose) with NO compose job; any miss / decode
    // failure / wedged IDB degrades to composing.
    readParametricSprite(idbKey)
      .then((payload) => {
        const pack = payload ? this.packFromCache(payload) : null;
        if (pack) { this.cache.set(k, pack); return; }
        return composePath();
      })
      .catch(() => composePath())
      .finally(settle);
  }

  /** Monotonic counter bumped when an async warm batch settles. Fold into a draw
   *  cache key so the static list rebuilds once newly-composed packs are ready. */
  version(): number { return this.rev; }

  /** Warms still in flight (IDB read or compose). The boot gate sums this across
   *  sources — compose-queue depth alone misses warm-cache boots, where every
   *  pack is an IDB read and the queue never fills. */
  pending(): number { return this.inflight.size; }

  /** Clear on world reset. */
  clear(): void { this.cache.clear(); this.stages.clear(); this.inflight.clear(); this.warned.clear(); this.rev++; }
}
