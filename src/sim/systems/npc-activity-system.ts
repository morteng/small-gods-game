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
 *
 * THE MEANING ECONOMY (interaction-scaling S2c). Three pieces here, and one
 * retune in `npc-sim.ts`, close the defect that made 99% of all NPC-time
 * `worship`: `meaning` eroded on a 250-second clock and NOTHING mortal restored
 * it, so every soul crossed its worship line within ~35 seconds and prayed
 * forever — which, since a praying mortal cannot work, sleep or socialize, then
 * collapsed the other three needs behind it.
 *   • `RITE_MEANING_RESTORE` — the communal rite. A mortal performing its plea at
 *     the public shrine recovers `meaning` per fire, capped at
 *     `MORTAL_MEANING_CEILING` (0.5), which sits BELOW the `COMFORT_THRESHOLD`
 *     (0.6) that fires secularization. Mortals cope; only a god consoles.
 *   • `PLEA_SETTLE_MARGIN` / `standingPlea` — a plea is a STATE with hysteresis,
 *     not a threshold sample, so it stands for hours (answerable, claimable,
 *     visible) instead of flickering on and off the line every few seconds.
 *   • `COMMUNITY_THRESHOLD` — moved so belonging's own sawtooth stops vetoing the
 *     comfort band and stops firing spurious desperation.
 */

import type { Entity, NpcActivity, NpcNeeds, NpcProperties, GameMap } from '@/core/types';
import type { World } from '@/world/world';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import { Random } from '@/core/noise';
import type { System, SystemContext } from '@/core/scheduler';
import { clamp01, MEANING_DECAY } from '@/sim/npc-sim';
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
 *
 * S2c: raised 0.35 → 0.65, which moves the band a mortal's `community` oscillates
 * in from [0.35, 0.65] to [0.65, 0.95] (the trigger plus `SELF_AGENCY_RESTORE`).
 * The number is derived, not taste. Since S2b, comfort decay needs EVERY need
 * above `COMFORT_THRESHOLD` (0.6), so belonging's own sawtooth was silently
 * vetoing secularization no matter how attentive a god was: measured over a
 * 24-hour day, comfort fired 0.24% of the time with a god answering, because
 * community's mean sat at 0.58. For belonging to STAY inside the comfort band it
 * must trigger above 0.6 AND carry enough headroom to cross the ~9-hour night,
 * when no mortal channel runs at all (0.375 of a day × `COMMUNITY_DECAY` ≈ 0.19).
 * 0.65 + 0.3 − 0.19 = 0.76 clears it. The frequency of the trip to the green is
 * unchanged — that is set by `COMMUNITY_DECAY` against the restore, not by where
 * the trigger sits — and the old trough (0.35) also dipped under
 * `DESPERATION_THRESHOLD` (0.4) every cycle, firing the fear-boost on a mortal
 * who was merely due an evening out.
 *
 * The point of all this: with the material needs sitting inside the comfort band
 * whenever mortals are managing (tenet 9), `meaning` becomes the SOLE gate on
 * contentment — so "comfort kills belief" reduces to "a god that keeps its
 * flock's meaning topped up dissolves itself", which is exactly VISION §7 Act 2.
 */
const COMMUNITY_THRESHOLD = 0.65;

/**
 * M0.a — worship fires on the LOWEST need, per-need thresholds (VISION §9 rows
 * 11–12; mortal-power spec M0). `meaning`'s only channels are a god's Answer and
 * the communal rite (S2c, `RITE_MEANING_RESTORE`) — and the rite is capped well
 * short of contentment — so it prays early (the classic 0.3). The material needs have
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

/**
 * S2c — HOW FAR a need must recover before a STANDING plea settles.
 *
 * `prayerSubject` alone is a bare threshold, and a bare threshold cannot make a
 * plea: the moment anything nudged the need a hair over the line the mortal got
 * up, and the moment it fell back it knelt again. What the sim needs is a plea
 * that lasts long enough to be SEEN and ANSWERED — by the player, by Fate's
 * inbox, by a rival's claim clock — so a plea, once made, stands until the need
 * it was made about has risen this far ABOVE the line that opened it. A Schmitt
 * trigger, and it needs no new state: `props.prayerNeed` (shipped with M0.b) is
 * the plea, and it already rides the snapshot.
 *
 * It is also what makes SECULARIZATION reachable at all. `answer_prayer` adds
 * `ANSWER_PRAYER_NEED_BOOST` (0.3) to the need asked for; with a bare threshold
 * the god could only ever answer a mortal sitting exactly at 0.3, landing it at
 * exactly `COMFORT_THRESHOLD` and never above — so "comfort kills belief"
 * (VISION §4) could not fire. Answering a mortal partway through a standing plea
 * lands it well above the line, which is the god OVER-serving: the trap.
 */
export const PLEA_SETTLE_MARGIN = 0.2;

/**
 * The CEILING the mortal channel for `meaning` can carry a soul to — and the
 * whole of "mortals cope, gods console" (VISION §11's rites of the dead, tenet 9
 * "mortals act first; the god is the margin").
 *
 * It lands exactly on the level at which a `meaning` plea settles, and that is
 * the design, not a coincidence: the rite carries a mourner to the far side of
 * its own grief and NOT ONE STEP FURTHER. It is deliberately BELOW
 * `COMFORT_THRESHOLD` (0.6), so a settlement no god attends can keep its feet —
 * it is not locked on its knees — but can never be CONTENT. Everything above
 * this line belongs to the gods, and that is the only reason a well-served
 * population can drift into secularization while a neglected one cannot.
 */
export const MORTAL_MEANING_CEILING = WORSHIP_THRESHOLDS.meaning + PLEA_SETTLE_MARGIN;

/**
 * The communal rite: `meaning` restored per fire to a mortal PERFORMING its plea
 * at the settlement's public heart (S2a.1 sent worship out to the green for
 * exactly this reason — devotion is performed in front of the neighbours).
 *
 * Sized as a MULTIPLE of the erosion it fights, because that ratio *is* the
 * observable: a mortal climbs at (rite − decay) and falls at decay, so the share
 * of its life spent at the shrine settles at `decay / rite` — 1:4 here, a
 * quarter of the day during a spiritual crisis, which is what a pre-modern
 * religious community actually looks like. Change the ratio to change the
 * congregation; changing `MEANING_DECAY` alone leaves it where it is.
 */
export const RITE_MEANING_RESTORE = MEANING_DECAY * 4;

/**
 * The plea this mortal is making right now.
 *
 * A FRESH plea always wins: any need that has actually crossed its own
 * `WORSHIP_THRESHOLDS` line outranks whatever the mortal was already praying
 * about, so raiders at the gate interrupt a mourner (and `prayerSubject` picks
 * the lowest of them, unchanged). Otherwise a plea ALREADY STANDING persists
 * until it has settled — recovered `PLEA_SETTLE_MARGIN` past the line that
 * opened it. No new state: the plea is `props.prayerNeed`, which is only ever
 * set alongside `activity === 'worship'` and cleared with it.
 */
export function standingPlea(props: NpcProperties): keyof NpcNeeds | null {
  const fresh = prayerSubject(props.needs);
  if (fresh !== null) return fresh;
  const open = props.prayerNeed;
  if (open !== undefined && props.activity === 'worship'
      && props.needs[open] < WORSHIP_THRESHOLDS[open] + PLEA_SETTLE_MARGIN) return open;
  return null;
}

/** Need restored when an NPC completes a self-serviced activity. */
const SELF_AGENCY_RESTORE = 0.3;

/** The most `prosperity` a mortal with no work of its own (`VAGRANT_ROLES`) can
 *  reach on its household's keeping — see the `wander`/`idle` case below. Below
 *  `COMFORT_THRESHOLD` (0.6) on purpose: the poor get by, and stay reachable. */
const DEPENDENT_PROSPERITY_CEILING = 0.5;

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

    // THE COMMUNAL RITE (S2c) — the mortal channel for `meaning`, and the one
    // thing that lets a settlement no god attends get back off its knees. It is
    // paid PER FIRE (not on completion like the self-agency restores below)
    // because it is the time spent at the shrine that does the work, and because
    // the plea it settles is measured in hours; and it is paid only to a mortal
    // that ACTUALLY GOT THERE (`atVenue`, the same earned-arrival rule S2a.1 put
    // on `socialize`), so a rite is performed among the neighbours and not
    // claimed from a doorstep halfway across town. Hard-capped at
    // `MORTAL_MEANING_CEILING`: mortals cope, gods console.
    if (props.activity === 'worship' && props.needs.meaning < MORTAL_MEANING_CEILING
        && this.atVenue(e, props)) {
      props.needs.meaning = Math.min(MORTAL_MEANING_CEILING, props.needs.meaning + RITE_MEANING_RESTORE);
    }

    // If the current activity hasn't expired yet, don't re-evaluate
    if (props.activityDuration > 0) {
      props.activityDuration--;
      return;
    }

    // Self-agency: the finished activity restores its own need (the god is the margin).
    // `worship` is excluded HERE — its restore is the per-fire communal rite at
    // the top of this method, capped at `MORTAL_MEANING_CEILING`, not a full
    // `SELF_AGENCY_RESTORE` on completion. Above that ceiling only a god Answers.
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
      default: break; // idle, wander, worship → see the two channels below
    }

    // S2c — THE HOUSEHOLD KEEPS ITS DEPENDENTS. The vagrant roles (child, beggar,
    // elder) are the only mortals with no `work` branch at all, so `prosperity`
    // was a one-way street for them exactly the way `meaning` was for everyone —
    // they crossed their worship line and then prayed about bread forever. A
    // child is fed, an elder kept by kin, a beggar begs: a partial living, CAPPED
    // (the same primitive as the rite) below `COMFORT_THRESHOLD`, so the
    // destitute get by, never prosper, and — since comfort decay needs EVERY need
    // met — never secularize either. Deliberately NOT tied to an errand the way
    // work is: being KEPT is not something you do, so it reaches a dependent who
    // is at the shrine, which is the whole point (tie it to `wander` and a
    // dependent that starts praying can never be fed again — the lock, moved).
    if (VAGRANT_ROLES.has(props.role) && props.needs.prosperity < DEPENDENT_PROSPERITY_CEILING) {
      props.needs.prosperity = Math.min(DEPENDENT_PROSPERITY_CEILING,
        props.needs.prosperity + SELF_AGENCY_RESTORE);
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
    const plea = isNight ? null : standingPlea(props);

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
