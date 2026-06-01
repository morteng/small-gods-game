import type { Entity, NpcRole, SpiritBelief } from '@/core/types';
import type { World } from '@/world/world';
import type { EventLog } from '@/core/events';
import type { Rng } from '@/core/rng';
import { initNpcProps, npcProps, REMAINS_KIND } from '@/world/npc-helpers';

/** Child faith = this fraction of the parents' average faith (generational dilution). */
export const INHERIT_FAITH_FRAC = 0.4;
/** Child understanding = this fraction of the parents' average (≈ near zero). */
export const INHERIT_UNDERSTANDING_FRAC = 0.05;
/** Magnitude of seeded personality jitter applied to the parental mean. */
export const PERSONALITY_JITTER = 0.1;

const NEWBORN_NAMES = ['Aelf', 'Bryn', 'Cael', 'Dara', 'Edda', 'Finn', 'Gwen', 'Hale', 'Isa', 'Joren'];

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

/**
 * Convert a living NPC into persistent remains (death never deletes — the
 * persistence principle). Flips kind via updateEntity so BOTH World index layers
 * stay in sync; the soul stays queryable as kind 'remains'. SpiritSystem and all
 * NPC systems iterate via forEachNpc (kind 'npc' only), so a remains automatically
 * stops contributing belief/power and stops moving — no other system changes.
 */
export function killNpc(
  world: World, entity: Entity, deathTick: number, cause: string, log: EventLog,
): void {
  const p = npcProps(entity);
  p.deathTick = deathTick;
  p.deathCause = cause;
  world.updateEntity(entity.id, { kind: REMAINS_KIND });
  log.append({ type: 'npc_death', npcId: entity.id, lineageId: p.lineageId, cause });
}

/**
 * Spawn a child of 1–2 parents at the first parent's location. Personality is the
 * parental mean plus small seeded jitter; belief is diluted (faith ≈ 0.4× the
 * parents' average, understanding ≈ 0.05× — born believing in *something*, but must
 * relearn who you are). All randomness flows through the supplied `rng`.
 */
export function birthNpc(
  world: World, parents: Entity[], birthTick: number, rng: Rng, log: EventLog,
): Entity {
  const a = npcProps(parents[0]);
  const b = parents[1] ? npcProps(parents[1]) : a;

  const jitter = () => (rng.next() - 0.5) * PERSONALITY_JITTER;
  const personality = {
    assertiveness: clamp01((a.personality.assertiveness + b.personality.assertiveness) / 2 + jitter()),
    skepticism:    clamp01((a.personality.skepticism    + b.personality.skepticism)    / 2 + jitter()),
    piety:         clamp01((a.personality.piety         + b.personality.piety)         / 2 + jitter()),
    sociability:   clamp01((a.personality.sociability   + b.personality.sociability)   / 2 + jitter()),
  };

  const beliefs: Record<string, SpiritBelief> = {};
  const spiritIds = new Set<string>([...Object.keys(a.beliefs), ...Object.keys(b.beliefs)]);
  for (const sid of spiritIds) {
    const fa = a.beliefs[sid]?.faith ?? 0;
    const fb = b.beliefs[sid]?.faith ?? 0;
    const ua = a.beliefs[sid]?.understanding ?? 0;
    const ub = b.beliefs[sid]?.understanding ?? 0;
    beliefs[sid] = {
      faith:         clamp01(INHERIT_FAITH_FRAC * ((fa + fb) / 2)),
      understanding: clamp01(INHERIT_UNDERSTANDING_FRAC * ((ua + ub) / 2)),
      devotion:      0,
    };
  }

  // Deterministic unique id: derives from rng (seeded, snapshot-restored) so it
  // reproduces under silent replay. Loop guards against the rare collision.
  let id = '';
  do { id = `npc-b${birthTick}-${rng.nextInt(0x7fffffff)}`; } while (world.registry.get(id));

  const role: NpcRole = 'child';
  const props = initNpcProps(rng.pick(NEWBORN_NAMES), role, rng.nextInt(0x7fffffff));
  // The two lines below intentionally override initNpcProps' role-derived personality
  // and beliefs with the blended/diluted inheritance computed above — do not remove
  // them as "redundant" or inherited belief silently breaks.
  props.personality = personality;
  props.beliefs = beliefs;
  props.birthTick = birthTick;
  props.parentIds = parents.map(pe => pe.id);
  props.lineageId = a.lineageId;
  props.homePoiId = a.homePoiId;
  props.homeBuildingId = a.homeBuildingId;
  props.homeX = parents[0].x;
  props.homeY = parents[0].y;

  world.addEntity({
    id, kind: 'npc', x: parents[0].x, y: parents[0].y,
    properties: props as unknown as Record<string, unknown>,
  });
  log.append({ type: 'npc_birth', npcId: id, parentIds: props.parentIds, lineageId: props.lineageId });
  return world.registry.get(id)!;
}
