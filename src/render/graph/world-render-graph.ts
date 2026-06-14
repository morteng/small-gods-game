// src/render/graph/world-render-graph.ts
//
// The R0 adapter: projects today's live `World` (via `RenderContext`) into the
// `RenderGraph` read view, with NO behaviour change. It mirrors the exact
// partition `buildEntityDrawList` performs — barrier (`*_run` / tag 'barrier'),
// building (carries a blueprint), vegetation (entity-kind category) — so the
// node set equals the entities the current draw list processes. NPCs and
// decorations are NOT region-culled (the draw list iterates them whole today);
// we mirror that so the eventual renderer rewire (R0b) stays byte-identical.
//
// Unlike the interface, this file MAY import world types — it is the bridge.
// When the connectome backs `RenderGraph` natively, this adapter is what it
// replaces.
import type {
  RenderContext, Entity, NpcInstance, GeneratedDecoration, Region,
} from '@/core/types';
import { blueprintOf } from '@/blueprint/entity';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import { heightMetresAt } from '@/world/heightfield';
import { DEFAULT_LIGHTING } from '@/render/lighting-state';
import type {
  RenderGraph, RenderNode, RenderEdge, TerrainView, LightView, NodeQuery, RenderCategory,
} from './render-graph';

/** The handle the renderer's resolvers consume off a node. */
export type WorldRef = Entity | NpcInstance | GeneratedDecoration;

/** Same predicate the draw list uses for linear barrier runs. */
function isBarrier(e: Entity): boolean {
  return e.kind.endsWith('_run') || (e.tags?.includes('barrier') ?? false);
}

export class WorldRenderGraph implements RenderGraph<WorldRef> {
  constructor(private readonly rc: RenderContext) {}

  get bounds(): { w: number; h: number } {
    return { w: this.rc.map.width, h: this.rc.map.height };
  }

  get terrain(): TerrainView {
    const rc = this.rc;
    return {
      // R1: seed-deterministic world heightfield, sea level = 0 m. The renderer
      // reads metres read-only; POI/connectome deformations compose on top later.
      heightAt: (tx, ty) => heightMetresAt(rc.map, tx, ty),
      materialAt: (tx, ty) => rc.visualMap?.[ty]?.[tx] ?? '',
      waterLevelM: 0,
    };
  }

  get light(): LightView {
    const l = this.rc.lighting ?? DEFAULT_LIGHTING;
    return {
      ambient: l.ambient,
      sunColor: l.sunColor,
      sunDir: l.sunDir,
      bands: l.bands,
      body: 'sun', // R3 lets solar.ts return 'moon' at night
    };
  }

  *nodes(region: Region, opts?: NodeQuery): Iterable<RenderNode<WorldRef>> {
    const want = opts?.categories;
    const wants = (c: RenderCategory): boolean => !want || want.has(c);

    // World entities — region-filtered, exactly the draw list's single query.
    // Skipped entirely when no world-backed category is wanted (the renderer
    // hid all of buildings/vegetation/barriers), preserving that optimisation.
    if (wants('building') || wants('vegetation') || wants('barrier')) {
      for (const e of this.rc.world.query({ region })) {
        if (isBarrier(e)) {
          if (wants('barrier')) yield this.entityNode(e, 'barrier', { w: 1, h: 1 });
          continue;
        }
        const bp = blueprintOf(e);
        if (bp) {
          if (wants('building')) yield this.entityNode(e, 'building', { ...bp.rb.footprint });
          continue;
        }
        if (tryGetEntityKindDef(e.kind)?.category === 'vegetation') {
          if (wants('vegetation')) yield this.entityNode(e, 'vegetation', { w: 1, h: 1 });
        }
        // anything else is not drawn by the entity pass — skipped (parity).
      }
    }

    // NPCs + decorations are not region-culled today; iterate them whole.
    if (wants('npc')) for (const n of this.rc.npcs) {
      yield {
        id: n.id, x: n.tileX, y: n.tileY, z: 0,
        footprint: { w: 1, h: 1 }, kind: 'npc', category: 'npc', ref: n,
      };
    }
    if (wants('decoration')) for (const d of this.rc.generatedDecorations ?? []) {
      yield {
        id: `deco:${d.tileX},${d.tileY}`, x: d.tileX, y: d.tileY, z: 0,
        footprint: { w: 1, h: 1 }, kind: 'deco', category: 'decoration', ref: d,
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  *edges(_region: Region): Iterable<RenderEdge> {
    // Linear features are still entities/terrain today; Track V promotes them.
  }

  private entityNode(
    e: Entity, category: RenderNode['category'], footprint: { w: number; h: number },
  ): RenderNode<WorldRef> {
    return { id: e.id, x: e.x, y: e.y, z: 0, footprint, kind: e.kind, category, ref: e };
  }
}
