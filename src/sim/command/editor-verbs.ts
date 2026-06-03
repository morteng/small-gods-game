/**
 * editor-verbs.ts — the effect of god-mode authoring (Create panel) verbs.
 *
 * Each verb exposes a `precondition` (read-only payload validation → RejectionReason
 * or null) and an `apply` (the mutation, using ApplyCtx.rng / .now; appends an
 * `authored_*` SimEvent). registry.ts wires these into CapabilityDef entries.
 *
 * All randomness flows through ctx.rng (seeded) — never Math.random.
 */
import type { Entity, NpcRole } from '@/core/types';
import type { Command, ApplyCtx, CommandCtx, RejectionReason } from './types';
import { npcProps, queryNpcs, initNpcProps } from '@/world/npc-helpers';

const P = (cmd: Command): Record<string, unknown> => cmd.payload ?? {};

// ── author_remove_entity ─────────────────────────────────────────────────────
// payload: { entityId } | { filter: { kind?, role? } }   (near-filter deferred)

interface RemoveFilter { kind?: string; role?: string }

export function removePrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  const p = P(cmd);
  const entityId = p.entityId as string | undefined;
  const filter = p.filter as RemoveFilter | undefined;
  if (!entityId && !filter) return 'invalid_payload';
  if (entityId && !ctx.world.registry.get(entityId)) return 'invalid_target';
  return null;
}

export function removeApply(cmd: Command, ctx: ApplyCtx): boolean {
  const p = P(cmd);
  const entityId = p.entityId as string | undefined;
  const filter = p.filter as RemoveFilter | undefined;

  const targets: Entity[] = entityId
    ? [ctx.world.registry.get(entityId)!]                       // existence checked in precondition
    : matchFilter(ctx, filter!);

  for (const e of targets) ctx.world.removeEntity(e.id);
  ctx.log.append({ type: 'authored_remove', entityIds: targets.map(e => e.id), count: targets.length });
  return true;
}

function matchFilter(ctx: CommandCtx, filter: RemoveFilter): Entity[] {
  let candidates: Entity[] = filter.kind
    ? ctx.world.query({ kind: filter.kind })
    : ctx.world.query({});
  if (filter.role) {
    candidates = candidates.filter(e => e.kind === 'npc' && npcProps(e).role === filter.role);
  }
  return candidates;
}

// ── author_spawn_npc ─────────────────────────────────────────────────────────
// payload: { role, count?, near: poiId | {x,y}, name?, faith?, understanding?, devotion? }

const VALID_ROLES: NpcRole[] = ['priest', 'elder', 'farmer', 'merchant', 'soldier', 'noble', 'child', 'beggar'];
const ADULT_NAMES = ['Aldous', 'Bryn', 'Corin', 'Dara', 'Edda', 'Faro', 'Gwen', 'Hale', 'Ivo', 'Juna', 'Kess', 'Lorn'];

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

/** Resolve the spawn center from a `near` payload (poiId via a resident, or {x,y}). */
function resolveCenter(near: unknown, ctx: CommandCtx): { x: number; y: number } | null {
  if (near && typeof near === 'object' && 'x' in (near as object) && 'y' in (near as object)) {
    const n = near as { x: number; y: number };
    return { x: Math.round(n.x), y: Math.round(n.y) };
  }
  if (typeof near === 'string') {
    const resident = queryNpcs(ctx.world).find(e => npcProps(e).homePoiId === near);
    if (resident) return { x: resident.x, y: resident.y };
  }
  return null;
}

/**
 * Find the nearest in-bounds, realized, walkable, unoccupied tile to (cx,cy),
 * scanning outward in rings. Returns null if none within maxRadius.
 */
export function findPlacement(
  world: CommandCtx['world'], cx: number, cy: number, maxRadius = 6,
): { x: number; y: number } | null {
  const map = world.tiles;
  const ok = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
    const t = map.tiles[y]?.[x];
    if (!t || !t.walkable || t.state !== 'realized') return false;
    return world.registry.canPlace(x, y, 1, 1, 0);
  };
  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring shell only
        const x = cx + dx, y = cy + dy;
        if (ok(x, y)) return { x, y };
      }
    }
  }
  return null;
}

export function spawnPrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  const p = P(cmd);
  const role = p.role as string | undefined;
  if (!role || !VALID_ROLES.includes(role as NpcRole)) return 'invalid_payload';
  if (resolveCenter(p.near, ctx) === null) return 'invalid_target';
  return null;
}

export function spawnApply(cmd: Command, ctx: ApplyCtx): boolean {
  const p = P(cmd);
  const role = p.role as NpcRole;
  const count = Math.max(1, Math.min(20, Math.floor((p.count as number) ?? 1)));
  const center = resolveCenter(p.near, ctx)!;             // validated in precondition

  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const spot = findPlacement(ctx.world, center.x, center.y);
    if (!spot) break;                                      // ran out of room; spawn fewer
    const seed = ctx.rng.nextInt(0x7fffffff);
    const name = (p.name as string) ?? ctx.rng.pick(ADULT_NAMES);
    const props = initNpcProps(name, role, seed);
    props.birthTick = ctx.now;
    props.homeX = spot.x; props.homeY = spot.y;
    if (p.faith !== undefined) props.beliefs.player.faith = clamp01(p.faith as number);
    if (p.understanding !== undefined) props.beliefs.player.understanding = clamp01(p.understanding as number);
    if (p.devotion !== undefined) props.beliefs.player.devotion = clamp01(p.devotion as number);

    let id = '';
    do { id = `npc-a${ctx.now}-${ctx.rng.nextInt(0x7fffffff)}`; } while (ctx.world.registry.get(id));
    props.lineageId = id;                                  // founder of its own lineage
    ctx.world.addEntity({ id, kind: 'npc', x: spot.x, y: spot.y, properties: props as unknown as Record<string, unknown> });
    ids.push(id);
  }
  ctx.log.append({ type: 'authored_spawn', entityIds: ids, role, count: ids.length });
  return true;
}
