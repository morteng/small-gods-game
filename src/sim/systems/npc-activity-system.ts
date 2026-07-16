/**
 * NpcActivitySystem — time-of-day and needs-driven activity state machine.
 *
 * Runs at 1 Hz. Each fire: re-evaluates the current activity based on
 * time-of-day, lowest need, and role/personality, then sets a target tile
 * for the 60 Hz movement system to follow.
 *
 * Time-of-day comes from the SOLAR clock (1:1 realtime — a day is 24 real
 * hours). Night = 21:00–06:00: everybody heads home and sleeps, matching the
 * lit day/night cycle (lamps come on around dusk, `nightFactorForTick`).
 *
 * Activity duration is stochastic (3-12 fires ≈ seconds) so NPCs don't all
 * switch simultaneously, creating organic-looking crowd behavior.
 */

import type { Entity, NpcActivity, NpcNeeds } from '@/core/types';
import type { World } from '@/world/world';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import { Random } from '@/core/noise';
import type { System, SystemContext } from '@/core/scheduler';
import { clamp01 } from '@/sim/npc-sim';
import { solarHourForTick } from '@/core/calendar';
import { titheRateFor, workRestoreScale } from '@/sim/lord';

/** Sleep window (solar hours): from NIGHT_START_HOUR to NIGHT_END_HOUR. */
export const NIGHT_START_HOUR = 21;
export const NIGHT_END_HOUR = 6;

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
 * M0.a — worship fires on the LOWEST need, per-need thresholds (VISION §9 rows
 * 11–12; mortal-power spec M0). `meaning` has no mortal channel at all — only a
 * god Answers — so it prays early (the classic 0.3). The material needs have
 * self-serve channels (`work`/`sleep`/`socialize` restore them, tenet 9:
 * "mortals act first; the god is the margin"), so only DESPERATION — self-service
 * failing to keep up (raiders, extraction, a lord's tithe) — sends a mortal to
 * their knees over bread or safety. This is what lets a starving peasant pray.
 */
export const WORSHIP_THRESHOLDS: Record<keyof NpcNeeds, number> = {
  meaning:    0.3,
  safety:     0.15,
  prosperity: 0.15,
  community:  0.15,
};

/** Fixed iteration order → deterministic argmin tie-break. */
const NEED_KEYS: readonly (keyof NpcNeeds)[] = ['safety', 'prosperity', 'community', 'meaning'];

/** The need this mortal would pray about right now: the lowest need that has
 *  crossed its worship threshold, or null when none has (no plea). */
export function prayerSubject(needs: NpcNeeds): keyof NpcNeeds | null {
  let subject: keyof NpcNeeds | null = null;
  let lowest = Infinity;
  for (const k of NEED_KEYS) {
    const v = needs[k];
    if (v < WORSHIP_THRESHOLDS[k] && v < lowest) { lowest = v; subject = k; }
  }
  return subject;
}

/** Need restored when an NPC completes a self-serviced activity. */
const SELF_AGENCY_RESTORE = 0.3;

export class NpcActivitySystem implements System {
  readonly name = 'npc_activity';
  readonly tickHz = 1;
  private rng = new Random(0);

  tick(ctx: SystemContext): void {
    this.rng = new Random(ctx.rng.next() * 0x7fffffff);
    const solarHour = solarHourForTick(ctx.clock.now());

    forEachNpc(ctx.world, (e) => this.tickNpcActivity(e, solarHour, ctx.world));
  }

  private tickNpcActivity(e: Entity, solarHour: number, world: World): void {
    const props = npcProps(e);

    // If the current activity hasn't expired yet, don't re-evaluate
    if (props.activityDuration > 0) {
      props.activityDuration--;
      return;
    }

    // Self-agency: the finished activity restores its own need (the god is the margin).
    // `worship` is excluded — meaning is restored only when a god Answers.
    // M0.c (mortal-power spec, model (c)): a seated lord's tithe scales the WORK
    // restore — you work as hard and you get less. No lord ⇒ scale 1 (unchanged).
    switch (props.activity) {
      case 'work':
        props.needs.prosperity = clamp01(props.needs.prosperity +
          SELF_AGENCY_RESTORE * workRestoreScale(titheRateFor(world, props.homePoiId)));
        break;
      case 'socialize': props.needs.community  = clamp01(props.needs.community  + SELF_AGENCY_RESTORE); break;
      case 'sleep':     props.needs.safety     = clamp01(props.needs.safety     + SELF_AGENCY_RESTORE); break;
      default: break; // idle, wander, worship → no self-restore
    }

    // Determine new activity and target
    const isNight = solarHour >= NIGHT_START_HOUR || solarHour < NIGHT_END_HOUR;

    let activity: NpcActivity;
    let targetX: number | undefined;
    let targetY: number | undefined;

    // M0.a: the plea check runs FIRST — desperation outranks the social calendar
    // (pre-M0, low community pre-empted worship and only `meaning` could pray).
    const plea = isNight ? null : prayerSubject(props.needs);

    if (isNight) {
      // Night: everybody sleeps at home
      activity = 'sleep';
      targetX = props.homeX;
      targetY = props.homeY;
    } else if (plea !== null) {
      // A need crossed its worship threshold → pray, ABOUT that need (M0.b).
      activity = 'worship';
      props.prayerNeed = plea;
      // Worship at home (placeholder — future: go to temple/altar)
      targetX = props.homeX;
      targetY = props.homeY;
    } else if (this.hasLowNeed(props.needs.community, COMMUNITY_THRESHOLD)) {
      // Low community → socialize
      activity = 'socialize';
      // Socialize near home
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
    if (activity !== 'worship' && props.prayerNeed !== undefined) delete props.prayerNeed;
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
