/**
 * editor-verbs.ts — the effect of god-mode authoring (Create panel) verbs.
 *
 * Each verb exposes a `precondition` (read-only payload validation → RejectionReason
 * or null) and an `apply` (the mutation, using ApplyCtx.rng / .now; appends an
 * `authored_*` SimEvent). registry.ts wires these into CapabilityDef entries.
 *
 * All randomness flows through ctx.rng (seeded) — never Math.random.
 */
import type { Entity } from '@/core/types';
import type { Command, ApplyCtx, CommandCtx, RejectionReason } from './types';
import { npcProps } from '@/world/npc-helpers';

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
