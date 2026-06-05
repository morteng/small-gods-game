/**
 * building-verbs.ts — the `place_building` authoring verb. Fate (or the editor)
 * names a preset (with optional overrides) or supplies a full descriptor and a
 * location; the verb finds a clear footprint, stamps the building, and marks
 * non-door tiles non-walkable. All randomness flows through ctx.rng (seeded) —
 * never Math.random.
 */
import type { Command, ApplyCtx, CommandCtx, RejectionReason } from './types';
import { synthesizeFromPreset } from '@/world/building-presets';
import { buildingEntity, type BuildingDescriptor } from '@/world/building-descriptor';
import { resolveCenter } from './editor-verbs';

const P = (cmd: Command): Record<string, unknown> => cmd.payload ?? {};

/** Resolve a descriptor from `{ preset, overrides }` or a raw `{ descriptor }`. */
function resolveDescriptor(p: Record<string, unknown>): BuildingDescriptor | undefined {
  if (p.descriptor && typeof p.descriptor === 'object') return p.descriptor as BuildingDescriptor;
  if (typeof p.preset === 'string') {
    return synthesizeFromPreset(p.preset, (p.overrides as Partial<BuildingDescriptor>) ?? {});
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
  if (!resolveDescriptor(P(cmd))) return 'invalid_payload';
  if (resolveTarget(cmd, ctx) === null) return 'invalid_target';
  return null;
}

export function placeBuildingApply(cmd: Command, ctx: ApplyCtx): boolean {
  const d = resolveDescriptor(P(cmd))!;            // validated in precondition
  const center = resolveTarget(cmd, ctx)!;
  const spot = findBuildingPlacement(ctx.world, center.x, center.y, d.footprint);
  if (!spot) return false;                          // no room → decline cleanly

  let id = '';
  do { id = `bld-f${ctx.now}-${ctx.rng.nextInt(0x7fffffff)}`; } while (ctx.world.registry.get(id));
  ctx.world.addEntity(buildingEntity(id, d, spot.x, spot.y));

  // Footprint is solid except the door tile.
  for (let dy = 0; dy < d.footprint.h; dy++) {
    for (let dx = 0; dx < d.footprint.w; dx++) {
      const t = ctx.world.tiles.tiles[spot.y + dy]?.[spot.x + dx];
      if (t && !(dx === d.door.x && dy === d.door.y)) t.walkable = false;
    }
  }

  ctx.log.append({ type: 'authored_place', entityIds: [id], kind: d.preset ?? 'building', count: 1 });
  return true;
}
