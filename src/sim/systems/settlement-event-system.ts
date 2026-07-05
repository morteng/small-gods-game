/**
 * SettlementEventSystem — per-POI event rolling, lifecycle, and need effects.
 *
 * Runs at 1 Hz (per sim-second). Each fire:
 *   1. Applies active event need modifiers to NPCs in affected POIs
 *   2. Rolls dice for new events per POI (per-day chances split across
 *      86,400 one-per-second checks)
 *   3. Advances event timers (by the 60-tick fire period) and expires
 *      finished events
 *
 * Registration order matters: this system should run AFTER NpcSimSystem so
 * that base need decay happens first, then event modifiers layer on top.
 */

import type { System, SystemContext } from '@/core/scheduler';
import type { SerializableSystem } from '@/core/system-state';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import { clamp01 } from '@/sim/npc-sim';
import { Random } from '@/core/noise';
import type { NpcNeeds, SettlementEventType, ActiveEvent } from '@/core/types';
import { TICKS_PER_DAY } from '@/core/calendar';

// ── Event configuration ──────────────────────────────────────────────────────
//
// 1:1-REALTIME RE-DERIVATION. Under the compressed clock this table mixed
// units (per-fire chances, durations counted in 1 Hz fires but named "ticks"):
// the EXPERIENCED behavior was "some event on most POIs, rotating every few
// real minutes", which as fiction was incoherent. Re-authored in honest
// fiction units — chances per DAY, durations/cooldowns in DAYS — targeting
// "a settlement sees an event most days; disasters every few weeks".

interface EventConfig {
  /** Chance per POI per DAY that this event begins (no modifier). */
  chancePerDay: number;
  /** Min/max event duration in days. */
  minDays: number;
  maxDays: number;
  /** Cooldown days (from event END) before the same type re-fires on the POI. */
  cooldownDays: number;
}

const EVENT_CONFIGS: Record<SettlementEventType, EventConfig> = {
  drought:           { chancePerDay: 0.05, minDays: 3,    maxDays: 10, cooldownDays: 12 },
  festival:          { chancePerDay: 0.12, minDays: 0.25, maxDays: 1,  cooldownDays: 3 },
  dispute:           { chancePerDay: 0.15, minDays: 1,    maxDays: 3,  cooldownDays: 3 },
  plague:            { chancePerDay: 0.02, minDays: 4,    maxDays: 12, cooldownDays: 24 },
  raiders:           { chancePerDay: 0.06, minDays: 0.25, maxDays: 1,  cooldownDays: 6 },
  trading_caravan:   { chancePerDay: 0.12, minDays: 1,    maxDays: 3,  cooldownDays: 4 },
  stranger_arrives:  { chancePerDay: 0.20, minDays: 1,    maxDays: 3,  cooldownDays: 2 },
  harvest_blessing:  { chancePerDay: 0.08, minDays: 2,    maxDays: 7,  cooldownDays: 6 },
};

/** The system fires at 1 Hz (sim-seconds) → checks per day for the roll. */
const CHECKS_PER_DAY = 86_400;
/** Ticks between 1 Hz fires — event timers advance by this per fire. */
const FIRE_TICKS = 60;

/**
 * Per-tick need deltas — each scaled by event.severity.
 * Negative = reduces the need (worsens it). Positive = boosts the need.
 * These are applied every tick the event is active.
 */
const EVENT_NEED_EFFECTS: Record<SettlementEventType, Partial<NpcNeeds>> = {
  drought:           { prosperity: -0.008 },
  festival:          { community: 0.008, meaning: 0.006 },
  dispute:           { community: -0.008 },
  plague:            { safety: -0.012 },
  raiders:           { safety: -0.008, prosperity: -0.004 },
  trading_caravan:   { prosperity: 0.008 },
  stranger_arrives:  { community: 0.004 },
  harvest_blessing:  { prosperity: 0.012 },
};

const ALL_EVENT_TYPES = Object.keys(EVENT_CONFIGS) as SettlementEventType[];

// ── System ───────────────────────────────────────────────────────────────────

export class SettlementEventSystem implements System, SerializableSystem {
  readonly name = 'settlement_event';
  readonly tickHz = 1;

  private rng = new Random(0);

  /**
   * Cooldown map: key = `${poiId}:${eventType}`, value = tick (clock.now())
   * at which the POI is eligible for that event type again.
   */
  private cooldowns = new Map<string, number>();

  /** WP-D scrub-ghost pattern: cooldown deadlines are sim truth (they suppress
   *  event rolls) but are NOT derivable from world state — serialize them.
   *  `this.rng` is excluded: it is reseeded from ctx.rng every tick. */
  serialize(): unknown {
    return { cooldowns: [...this.cooldowns] };
  }

  hydrate(state: unknown): void {
    this.cooldowns.clear();
    const cd = (state as { cooldowns?: unknown } | undefined)?.cooldowns;
    if (!Array.isArray(cd)) return; // undefined / old save / foreign shape → reset
    for (const entry of cd) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number') {
        this.cooldowns.set(entry[0], entry[1]);
      }
    }
  }

  /** Duration draw in TICKS from the config's day range (uniform). */
  private rollDurationTicks(cfg: EventConfig): number {
    return Math.round((cfg.minDays + this.rng.next() * (cfg.maxDays - cfg.minDays)) * TICKS_PER_DAY);
  }

  tick(ctx: SystemContext): void {
    // Reseed for determinism
    this.rng = new Random(ctx.rng.next() * 0x7fffffff);

    // Step 1: Apply active event need effects
    this.applyEventNeeds(ctx);

    // Step 2: Tick existing events (advance timers, expire finished ones)
    this.tickActiveEvents(ctx);

    // Step 3: Roll for new events per POI
    this.rollNewEvents(ctx);
  }

  // ── Need effects ──────────────────────────────────────────────────────────

  private applyEventNeeds(ctx: SystemContext): void {
    forEachNpc(ctx.world, (e) => {
      const p = npcProps(e);
      if (!p.homePoiId) return;
      const events = ctx.world.activeEvents.get(p.homePoiId);
      if (!events || events.length === 0) return;

      for (const event of events) {
        const effects = EVENT_NEED_EFFECTS[event.type];
        if (!effects) continue;
        const scale = event.severity;

        if (effects.safety !== undefined) {
          p.needs.safety = clamp01(p.needs.safety + effects.safety * scale);
        }
        if (effects.prosperity !== undefined) {
          p.needs.prosperity = clamp01(p.needs.prosperity + effects.prosperity * scale);
        }
        if (effects.community !== undefined) {
          p.needs.community = clamp01(p.needs.community + effects.community * scale);
        }
        if (effects.meaning !== undefined) {
          p.needs.meaning = clamp01(p.needs.meaning + effects.meaning * scale);
        }
      }
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  private tickActiveEvents(ctx: SystemContext): void {
    for (const [poiId, events] of ctx.world.activeEvents) {
      const remaining: ActiveEvent[] = [];

      for (const event of events) {
        event.ticksElapsed += FIRE_TICKS;

        if (event.ticksElapsed >= event.durationTicks) {
          // Event expired
          ctx.log.append({ type: 'settlement_end', poiId, eventType: event.type });
          // Set cooldown so the same type can't re-fire immediately
          const cfg = EVENT_CONFIGS[event.type];
          const key = `${poiId}:${event.type}`;
          this.cooldowns.set(key, ctx.clock.now() + cfg.cooldownDays * TICKS_PER_DAY);
        } else {
          remaining.push(event);
        }
      }

      if (remaining.length === 0) {
        ctx.world.activeEvents.delete(poiId);
      } else {
        ctx.world.activeEvents.set(poiId, remaining);
      }
    }
  }

  // ── Event rolling ─────────────────────────────────────────────────────────

  private rollNewEvents(ctx: SystemContext): void {
    // Gather unique POIs that have NPCs
    const poiIds = new Set<string>();
    forEachNpc(ctx.world, (e) => {
      const id = npcProps(e).homePoiId;
      if (id) poiIds.add(id);
    });

    for (const poiId of poiIds) {
      // Skip POIs that already have an active event (max 1 at a time)
      if (ctx.world.activeEvents.has(poiId)) continue;

      // Fate override: if a forced next-event is pending for this POI, materialize
      // it now (bypassing probability + cooldown) and clear the one-shot bias.
      const forced = ctx.world.forcedEvents.get(poiId);
      if (forced) {
        const cfg = EVENT_CONFIGS[forced];
        const severity = 0.3 + this.rng.next() * 0.4; // 0.3–0.7, same band as natural
        const duration = this.rollDurationTicks(cfg);
        ctx.world.activeEvents.set(poiId, [{
          type: forced,
          poiId,
          severity: Math.round(severity * 100) / 100,
          durationTicks: duration,
          ticksElapsed: 0,
        }]);
        ctx.log.append({ type: 'settlement_begin', poiId, eventType: forced, severity, durationTicks: duration });
        ctx.world.forcedEvents.delete(poiId);
        continue; // forced event occupies the POI; skip the probability roll
      }

      // Try each event type (ordered so higher-chance events are checked first)
      for (const eventType of ALL_EVENT_TYPES) {
        const cooldownKey = `${poiId}:${eventType}`;
        const eligibleAt = this.cooldowns.get(cooldownKey) ?? 0;
        if (ctx.clock.now() <= eligibleAt) continue;

        const cfg = EVENT_CONFIGS[eventType];
        // Scale chance by number of active events across all POIs — fewer active
        // events globally means slightly higher chance for each POI
        const totalActive = ctx.world.activeEvents.size;
        const scarcityMod = 1 + (totalActive < 3 ? 0.3 : 0);
        const roll = this.rng.next();

        if (roll < (cfg.chancePerDay / CHECKS_PER_DAY) * scarcityMod) {
          const severity = 0.3 + this.rng.next() * 0.4; // 0.3–0.7
          const duration = this.rollDurationTicks(cfg);

          ctx.world.activeEvents.set(poiId, [{
            type: eventType,
            poiId,
            severity: Math.round(severity * 100) / 100, // 2-decimal precision
            durationTicks: duration,
            ticksElapsed: 0,
          }]);

          ctx.log.append({
            type: 'settlement_begin',
            poiId,
            eventType,
            severity,
            durationTicks: duration,
          });

          break; // max 1 event per POI at a time
        }
      }
    }
  }
}
