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
 * switch simultaneously, creating organic-looking crowd behavior. For the two
 * VENUE-BOUND activities the stochastic dwell is spent AT the venue: the walk is
 * budgeted on top (`travelAllowanceTicks`), so a mortal sent across town does not
 * have its errand expire mid-street (interaction-scaling S2a — see below).
 *
 * PUBLIC GATHERING (interaction-scaling S2a.1). Two activities send a mortal OUT
 * to the settlement's public heart — the well at the green (`marketAnchorTile`):
 *   • `socialize` — always did (Phase 2 encounter sim).
 *   • `worship`   — now does too. It used to pray at its own doorstep with a
 *     "future: go to temple/altar" placeholder, which made public religion
 *     invisible AND private: a congregation is the most reliable crowd a
 *     medieval settlement has, and the sim was throwing it away. Devotion is
 *     performed in front of the neighbours; the plea itself is unchanged (same
 *     `prayerNeed`, same `activity === 'worship'` the Track-3 claim ledger and
 *     `tickNpcEntity`'s abandonment decay read), only the PLACE moved.
 * Both stamp `props.gathering` so the encounter sim can tell "out at the green"
 * from "indoors at home", and both are honest about arrival — see the self-agency
 * note on `SELF_AGENCY_RESTORE` below.
 */

import type { Entity, NpcActivity, NpcNeeds, NpcProperties, GameMap } from '@/core/types';
import type { World } from '@/world/world';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import { Random } from '@/core/noise';
import type { System, SystemContext } from '@/core/scheduler';
import { clamp01 } from '@/sim/npc-sim';
import { solarHourForTick } from '@/core/calendar';
import { titheRateFor, workRestoreScale, patrolAnchorFor, DEFAULT_TITHE } from '@/sim/lord';
import { marketAnchorTile } from '@/sim/population/settlement-demand';

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

/** How close (Chebyshev tiles) to the settlement's gathering tile counts as
 *  HAVING GOT THERE. Wider than `ENCOUNTER_RADIUS` (2) because the crowd spreads
 *  around the well — arriving at the green is arriving, even a couple of tiles
 *  off the wellhead. Kept local: the encounter sim owns its own meeting radius. */
export const VENUE_ARRIVAL_RADIUS = 4;

/** Tiles per second an NPC walks — must agree with `NPC_WALK_SPEED`
 *  (`src/sim/npc-movement.ts`). Duplicated as a plain literal rather than
 *  imported so `src/sim/systems/` keeps its import graph flat; the activity
 *  system only needs it to SIZE a budget, and a mismatch degrades to a slightly
 *  short or long allowance, never to a wrong sim result. */
const WALK_TILES_PER_SECOND = 1.4;

/** Ceiling on the travel allowance (fires ≈ seconds). A mortal will not spend
 *  more than this walking to a venue before the activity re-evaluates — bounds
 *  the pathological case (a venue across a huge map, or an unreachable one). */
const MAX_TRAVEL_ALLOWANCE = 60;

/** Fires needed to walk from (x,y) to a target at NPC walk speed, rounded up and
 *  capped. Euclidean, matching how `tickNpcMovementEntities` actually moves. */
function travelAllowanceTicks(x: number, y: number, tx: number, ty: number): number {
  const d = Math.hypot(tx - x, ty - y);
  return Math.min(MAX_TRAVEL_ALLOWANCE, Math.ceil(d / WALK_TILES_PER_SECOND));
}

/** M5 — how close (tiles) to the gripped settlement's anchor a patrolling
 *  knight rides before turning for home. Spatial, not temporal — the leg
 *  length is however long the walk takes at NPC_WALK_SPEED. */
export const PATROL_TURN_RADIUS = 5;

export class NpcActivitySystem implements System {
  readonly name = 'npc_activity';
  readonly tickHz = 1;
  private rng = new Random(0);
  /** Per-tick memo of each POI's gathering tile (the well at the green's heart).
   *  Settlement geometry is static, but the plan scan is not free — cache it for
   *  the duration of one tick so a crowded town resolves each venue once. */
  private venueCache = new Map<string, { x: number; y: number } | null>();

  /** `() => state.map` — the encounter sim (Phase 2) sends socializing mortals to
   *  the settlement's gathering tile so neighbours actually CONVERGE and meet.
   *  Optional so tests can construct the system bare (socialize falls back home). */
  constructor(private readonly mapGetter?: () => GameMap | null) {}

  tick(ctx: SystemContext): void {
    this.rng = new Random(ctx.rng.next() * 0x7fffffff);
    this.venueCache.clear();
    const solarHour = solarHourForTick(ctx.clock.now());

    forEachNpc(ctx.world, (e) => this.tickNpcActivity(e, solarHour, ctx.world));
  }

  /** The gathering tile a socializing mortal of this POI walks to (memoized per
   *  tick). null when no map is wired or the POI has no resolvable centre. */
  private venueTile(poiId: string): { x: number; y: number } | null {
    if (this.venueCache.has(poiId)) return this.venueCache.get(poiId)!;
    const map = this.mapGetter?.();
    const tile = map ? marketAnchorTile(map, poiId) : null;
    this.venueCache.set(poiId, tile);
    return tile;
  }

  /** Where THIS mortal goes to be among people.
   *
   *  Normally its settlement's green. But a P2 market VISITOR is seated on the
   *  HOST's market square while its `homePoiId` names the cohort it was drawn
   *  from — a road-neighbour that can be most of a map away. Sending it back
   *  there to pray or to pass the time would march the market crowd out of the
   *  market. A visitor gathers where it stands: its `homeX/homeY` IS the square
   *  (`MaterializationSystem.spawnVisitors` seats it there deliberately). */
  private gatheringTileFor(props: NpcProperties): { x: number; y: number } | null {
    if (props.visitorTemp === true) return { x: props.homeX, y: props.homeY };
    return props.homePoiId ? this.venueTile(props.homePoiId) : null;
  }

  /** True when this mortal is standing at (or beside) its gathering tile right
   *  now. A mortal with no resolvable venue is trivially "there" — it socializes
   *  on its own doorstep, which is where it already is. */
  private atVenue(e: Entity, props: NpcProperties): boolean {
    const venue = this.gatheringTileFor(props);
    if (!venue) return true;
    return Math.abs(e.x - (venue.x + 0.5)) <= VENUE_ARRIVAL_RADIUS
        && Math.abs(e.y - (venue.y + 0.5)) <= VENUE_ARRIVAL_RADIUS;
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
      case 'patrol': {
        // M5: a knight is PAID from the extraction his patrol carries — the
        // castle seat's tithe against the customary DEFAULT_TITHE (capped at
        // full pay). A Peace of God that caps the sworn lord's tithe halves
        // the pay; a tithe-0 lord cannot keep knights fed — their prosperity
        // sinks until they pray (M0) like any other desperate mortal.
        const castleSeat = world.lords.get(props.homePoiId ?? '');
        const pay = clamp01((castleSeat?.tithe ?? 0) / DEFAULT_TITHE);
        props.needs.prosperity = clamp01(props.needs.prosperity + SELF_AGENCY_RESTORE * pay);
        break;
      }
      case 'socialize':
        // S2a.1 — self-agency is EARNED, not clocked. Pre-S2a this restored
        // community unconditionally, so a mortal who set off for the green and
        // never arrived (the errand expired mid-street) got the full benefit of
        // company it never had — and, restored above the threshold, promptly
        // stopped trying. Two mortals were therefore essentially never socializing
        // in the same place at the same time, which is why `NpcEncounterSystem`
        // fired ZERO encounters over six measured game-hours. Now the walk is
        // budgeted (see below) AND the restore requires having got there, so a
        // failed errand leaves community low and the mortal sets out again.
        if (this.atVenue(e, props)) {
          props.needs.community = clamp01(props.needs.community + SELF_AGENCY_RESTORE);
        }
        break;
      case 'sleep':     props.needs.safety     = clamp01(props.needs.safety     + SELF_AGENCY_RESTORE); break;
      default: break; // idle, wander, worship → no self-restore
    }

    // Determine new activity and target
    const isNight = solarHour >= NIGHT_START_HOUR || solarHour < NIGHT_END_HOUR;

    let activity: NpcActivity;
    let targetX: number | undefined;
    let targetY: number | undefined;
    let patrolAnchor: { x: number; y: number } | null = null;
    /** Set by the two venue-bound branches: this errand is a trip to the public
     *  green, so it gets a travel budget on top of its dwell and stamps
     *  `props.gathering` for the encounter sim. */
    let gathering = false;

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
      // S2a.1: the plea is made IN PUBLIC, at the settlement's green (the well /
      // shrine at its heart) — closing this branch's "future: go to temple/altar"
      // placeholder. Nothing about the plea itself changes: same `prayerNeed`,
      // same `activity === 'worship'` that `updatePrayerLedger` ages and
      // `tickNpcEntity` bleeds faith against. Only the PLACE moved, and with it
      // the possibility of meeting anyone. No venue (orphan / map-less test) →
      // the old doorstep behaviour, and the same two rng draws either way so no
      // other NPC's deterministic stream shifts by branch.
      activity = 'worship';
      props.prayerNeed = plea;
      const shrine = this.gatheringTileFor(props);
      const at = shrine ?? { x: props.homeX, y: props.homeY };
      gathering = shrine !== null;
      targetX = at.x + (Math.floor(this.rng.next() * 3) - 1);
      targetY = at.y + (Math.floor(this.rng.next() * 3) - 1);
    } else if (this.hasLowNeed(props.needs.community, COMMUNITY_THRESHOLD)) {
      // Low community → socialize. Head for the settlement's gathering tile (the
      // well at the green's heart) so neighbours CONVERGE and actually meet there
      // (Phase 2 encounter sim), instead of milling at their own doorstep. A ±1
      // jitter clusters them without a pile-up on one tile. Orphans (no poi) or a
      // map-less test fall back to socializing at home — the two rng draws are the
      // same either way, so no other NPC's deterministic stream shifts by branch.
      activity = 'socialize';
      const venue = this.gatheringTileFor(props);
      const base = venue ?? { x: props.homeX, y: props.homeY };
      gathering = venue !== null;
      targetX = base.x + (Math.floor(this.rng.next() * 3) - 1);
      targetY = base.y + (Math.floor(this.rng.next() * 3) - 1);
    } else if (props.role === 'soldier' && (patrolAnchor = patrolAnchorFor(world, props.homePoiId)) !== null) {
      // M5: a castle knight rides OUT — down to the settlement his seat grips
      // and back to the keep, leg after leg (the desire-line trample under his
      // hooves is the castle's road). Near the far anchor → turn for home.
      activity = 'patrol';
      const dx = e.x - (patrolAnchor.x + 0.5);
      const dy = e.y - (patrolAnchor.y + 0.5);
      const nearFar = Math.sqrt(dx * dx + dy * dy) <= PATROL_TURN_RADIUS;
      const leg = nearFar ? { x: props.homeX, y: props.homeY } : patrolAnchor;
      targetX = leg.x + (Math.floor(this.rng.next() * 5) - 2);
      targetY = leg.y + (Math.floor(this.rng.next() * 5) - 2);
    } else if (WORKING_ROLES.has(props.role)) {
      // Daytime: working roles go to work.
      activity = 'work';
      if (props.workX !== undefined && props.workY !== undefined) {
        // P2 slice 2: commute to the assigned workplace (small on-site jitter so
        // co-workers cluster at the door). Same two rng draws as the home path,
        // so other NPCs' deterministic stream is unaffected.
        targetX = props.workX + (Math.floor(this.rng.next() * 3) - 1);
        targetY = props.workY + (Math.floor(this.rng.next() * 3) - 1);
      } else {
        // No workplace → labour near home (fields, home-craft) as before.
        targetX = props.homeX + (Math.floor(this.rng.next() * 5) - 2);
        targetY = props.homeY + (Math.floor(this.rng.next() * 5) - 2);
      }
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
    if (gathering) props.gathering = true; else delete props.gathering;
    props.activityTargetX = targetX;
    props.activityTargetY = targetY;
    // Set duration for the new activity: the stochastic DWELL (3–12 fires ≈ s),
    // plus — for a trip to the public green — however long the walk takes. S2a.1:
    // pre-S2a the whole errand had to fit inside 3–12 s, so any venue further than
    // ~4 tiles expired mid-street and the mortal turned around. The dwell is what
    // is spent in company; travel is overhead, and overhead is budgeted, not
    // deducted. The rng draw is unconditional and unchanged in COUNT, so no other
    // NPC's stream shifts.
    const dwell = ACTIVITY_DURATION_MIN +
      Math.floor(this.rng.next() * (ACTIVITY_DURATION_MAX - ACTIVITY_DURATION_MIN + 1));
    props.activityDuration = gathering && targetX !== undefined && targetY !== undefined
      ? dwell + travelAllowanceTicks(e.x, e.y, targetX, targetY)
      : dwell;
  }

  private hasLowNeed(value: number, threshold: number): boolean {
    return value < threshold;
  }
}
