/**
 * building-verbs.ts — the `place_building` authoring verb. Fate (or the editor)
 * names a preset (with optional overrides) or supplies a full blueprint and a
 * location; the verb finds a clear footprint, stamps the building, and marks
 * non-door tiles non-walkable. All randomness flows through ctx.rng (seeded) —
 * never Math.random.
 */
import type { Command, ApplyCtx, CommandCtx, RejectionReason } from './types';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { resolveBlueprint } from '@/blueprint/resolve';
import { blueprintEntity, blueprintOf } from '@/blueprint/entity';
import type { Blueprint, BlueprintPatch, ResolvedBlueprint } from '@/blueprint/types';
import { resolveCenter } from './editor-verbs';

const P = (cmd: Command): Record<string, unknown> => cmd.payload ?? {};

/** Resolve a blueprint from `{ preset, overrides }` or a raw `{ blueprint }`. */
function resolveBp(p: Record<string, unknown>): ResolvedBlueprint | undefined {
  if (p.blueprint && typeof p.blueprint === 'object') {
    return resolveBlueprint([p.blueprint as Blueprint], 0);
  }
  if (typeof p.preset === 'string') {
    const overrides = (p.overrides as BlueprintPatch | undefined) ?? {};
    return synthesizeBlueprint(p.preset, [overrides]);
  }
  return undefined;
}

/** The location to place near: a settlement poiId, or a `{x,y}` `at`. */
function resolveTarget(cmd: Command, ctx: CommandCtx): { x: number; y: number } | null {
  if (cmd.target.kind === 'settlement') return resolveCenter(cmd.target.poiId, ctx);
  const at = P(cmd).at as { x: number; y: number } | undefined;
  return at ? resolveCenter(at, ctx) : null;
}

/** Spiral for a footprint where every cell is in-bounds, realized, and unoccupied. */
export function findBuildingPlacement(
  world: CommandCtx['world'], cx: number, cy: number,
  footprint: { w: number; h: number }, maxRadius = 8,
): { x: number; y: number } | null {
  const map = world.tiles;
  const fits = (x0: number, y0: number): boolean => {
    if (x0 < 0 || y0 < 0 || x0 + footprint.w > map.width || y0 + footprint.h > map.height) return false;
    for (let dy = 0; dy < footprint.h; dy++) {
      for (let dx = 0; dx < footprint.w; dx++) {
        const t = map.tiles[y0 + dy]?.[x0 + dx];
        if (!t || t.state !== 'realized' || !t.walkable) return false;
      }
    }
    return world.registry.canPlace(x0, y0, footprint.w, footprint.h, 0);
  };
  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (fits(x, y)) return { x, y };
      }
    }
  }
  return null;
}

export function placeBuildingPrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  if (!resolveBp(P(cmd))) return 'invalid_payload';
  if (resolveTarget(cmd, ctx) === null) return 'invalid_target';
  return null;
}

export function placeBuildingApply(cmd: Command, ctx: ApplyCtx): boolean {
  const rb = resolveBp(P(cmd))!;                    // validated in precondition
  const center = resolveTarget(cmd, ctx)!;
  const spot = findBuildingPlacement(ctx.world, center.x, center.y, rb.footprint);
  if (!spot) return false;                          // no room → decline cleanly

  let id = '';
  do { id = `bld-f${ctx.now}-${ctx.rng.nextInt(0x7fffffff)}`; } while (ctx.world.registry.get(id));
  const entity = blueprintEntity(id, rb, spot.x, spot.y);
  ctx.world.addEntity(entity);

  // Footprint is solid except the door cell(s).
  const doorCells = new Set(blueprintOf(entity)!.collision.doorCells);
  for (let dy = 0; dy < rb.footprint.h; dy++) {
    for (let dx = 0; dx < rb.footprint.w; dx++) {
      const t = ctx.world.tiles.tiles[spot.y + dy]?.[spot.x + dx];
      if (t && !doorCells.has(`${dx},${dy}`)) t.walkable = false;
    }
  }

  ctx.log.append({ type: 'authored_place', entityIds: [id], kind: rb.preset ?? 'building', count: 1 });
  return true;
}
