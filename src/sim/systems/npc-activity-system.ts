/**
 * NpcActivitySystem — time-of-day and needs-driven activity state machine.
 *
 * Runs at 1 Hz. Each tick: re-evaluates the current activity based on
 * time-of-day, lowest need, and role/personality, then sets a target tile
 * for the 60 Hz movement system to follow.
 *
 * A day is 240 ticks. Night = ticks 180-239.
 *
 * Activity duration is stochastic (3-12 ticks) so NPCs don't all switch
 * simultaneously, creating organic-looking crowd behavior.
 */

import type { Entity, NpcActivity, NpcNeeds } from '@/core/types';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import { Random } from '@/core/noise';
import type { System, SystemContext } from '@/core/scheduler';
import { clamp01 } from '@/sim/npc-sim';

const TICKS_PER_DAY = 240;
const NIGHT_START = 180;
const DAY_END = TICKS_PER_DAY;

/**
 * Roles with designated "work" buildings in the world.
 */
const WORKING_ROLES = new Set(['farmer', 'priest', 'soldier', 'merchant', 'noble']);

/**
 * Roles that tend to wander instead of working (children, beggars, elders).
 */
const VAGRANT_ROLES = new Set(['child', 'beggar', 'elder']);

/**
 * How many ticks an activity lasts before the next re-evaluation.
 */
const ACTIVITY_DURATION_MIN = 3;
const ACTIVITY_DURATION_MAX = 12;

/**
 * For day-mode activity: weight threshold for "socialize" (community < this → socialize).
 */
const COMMUNITY_THRESHOLD = 0.35;

/**
 * For day-mode activity: weight threshold for "worship" (meaning < this → worship).
 */
const MEANING_THRESHOLD = 0.3;

/** Need restored when an NPC completes a self-serviced activity. */
const SELF_AGENCY_RESTORE = 0.3;

export class NpcActivitySystem implements System {
  readonly name = 'npc_activity';
  readonly tickHz = 1;
  private rng = new Random(0);

  tick(ctx: SystemContext): void {
    this.rng = new Random(ctx.rng.next() * 0x7fffffff);
    const tickOfDay = ctx.clock.now() % TICKS_PER_DAY;

    forEachNpc(ctx.world, (e) => this.tickNpcActivity(e, tickOfDay));
  }

  private tickNpcActivity(e: Entity, timeOfDay: number): void {
    const props = npcProps(e);

    // If the current activity hasn't expired yet, don't re-evaluate
    if (props.activityDuration > 0) {
      props.activityDuration--;
      return;
    }

    // Self-agency: the finished activity restores its own need (the god is the margin).
    // `worship` is excluded — meaning is restored only when a god Answers.
    switch (props.activity) {
      case 'work':      props.needs.prosperity = clamp01(props.needs.prosperity + SELF_AGENCY_RESTORE); break;
      case 'socialize': props.needs.community  = clamp01(props.needs.community  + SELF_AGENCY_RESTORE); break;
      case 'sleep':     props.needs.safety     = clamp01(props.needs.safety     + SELF_AGENCY_RESTORE); break;
      default: break; // idle, wander, worship → no self-restore
    }

    // Determine new activity and target
    const isNight = timeOfDay >= NIGHT_START && timeOfDay < DAY_END;

    let activity: NpcActivity;
    let targetX: number | undefined;
    let targetY: number | undefined;

    if (isNight) {
      // Night: everybody sleeps at home
      activity = 'sleep';
      targetX = props.homeX;
      targetY = props.homeY;
    } else if (this.hasLowNeed(props.needs.community, COMMUNITY_THRESHOLD)) {
      // Low community → socialize
      activity = 'socialize';
      // Socialize near home
      targetX = props.homeX;
      targetY = props.homeY;
    } else if (this.hasLowNeed(props.needs.meaning, MEANING_THRESHOLD)) {
      // Low meaning → worship
      activity = 'worship';
      // Worship at home (placeholder — future: go to temple/altar)
      targetX = props.homeX;
      targetY = props.homeY;
    } else if (WORKING_ROLES.has(props.role)) {
      // Daytime: working roles go to work area
      activity = 'work';
      // Walk to a random offset from home to simulate "at work"
      targetX = props.homeX + (Math.floor(this.rng.next() * 5) - 2);
      targetY = props.homeY + (Math.floor(this.rng.next() * 5) - 2);
    } else if (VAGRANT_ROLES.has(props.role)) {
      // Non-working roles wander or idle
      if (props.personality.sociability > 0.5) {
        activity = 'wander';
        targetX = props.homeX + (Math.floor(this.rng.next() * 7) - 3);
        targetY = props.homeY + (Math.floor(this.rng.next() * 7) - 3);
      } else {
        activity = 'idle';
        // No target — stay put
      }
    } else {
      // Default: idle
      activity = 'idle';
    }

    props.activity = activity;
    props.activityTargetX = targetX;
    props.activityTargetY = targetY;
    // Set duration for the new activity
    props.activityDuration = ACTIVITY_DURATION_MIN +
      Math.floor(this.rng.next() * (ACTIVITY_DURATION_MAX - ACTIVITY_DURATION_MIN + 1));
  }

  private hasLowNeed(value: number, threshold: number): boolean {
    return value < threshold;
  }
}
