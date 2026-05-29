/**
 * SettlementEventSystem — per-POI event rolling, lifecycle, and need effects.
 *
 * Runs at 1 Hz. Each tick:
 *   1. Applies active event need modifiers to NPCs in affected POIs
 *   2. Rolls dice for new events per POI (weighted by probability)
 *   3. Advances event timers and expires finished events
 *
 * Registration order matters: this system should run AFTER NpcSimSystem so
 * that base need decay happens first, then event modifiers layer on top.
 */

import type { System, SystemContext } from '@/core/scheduler';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import { clamp01 } from '@/sim/npc-sim';
import { Random } from '@/core/noise';
import type { NpcNeeds, SettlementEventType, ActiveEvent } from '@/core/types';

const TICKS_PER_DAY = 240;

// ── Event configuration ──────────────────────────────────────────────────────

interface EventConfig {
  /** Base per-tick roll probability per POI (no modifier). */
  baseChance: number;
  /** Min/max event duration in ticks. */
  minDuration: number;
  maxDuration: number;
  /** Cooldown ticks before the same event type can re-fire on the same POI. */
  cooldownTicks: number;
}

const EVENT_CONFIGS: Record<SettlementEventType, EventConfig> = {
  drought:           { baseChance: 0.002,  minDuration: 120, maxDuration: 480, cooldownTicks: TICKS_PER_DAY * 4 },
  festival:          { baseChance: 0.003,  minDuration: 30,  maxDuration: 90,  cooldownTicks: TICKS_PER_DAY * 2 },
  dispute:           { baseChance: 0.004,  minDuration: 30,  maxDuration: 120, cooldownTicks: TICKS_PER_DAY * 2 },
  plague:            { baseChance: 0.001,  minDuration: 120, maxDuration: 480, cooldownTicks: TICKS_PER_DAY * 6 },
  raiders:           { baseChance: 0.0015, minDuration: 60,  maxDuration: 180, cooldownTicks: TICKS_PER_DAY * 3 },
  trading_caravan:   { baseChance: 0.003,  minDuration: 60,  maxDuration: 180, cooldownTicks: TICKS_PER_DAY * 2 },
  stranger_arrives:  { baseChance: 0.005,  minDuration: 30,  maxDuration: 90,  cooldownTicks: TICKS_PER_DAY },
  harvest_blessing:  { baseChance: 0.002,  minDuration: 60,  maxDuration: 180, cooldownTicks: TICKS_PER_DAY * 3 },
};

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

export class SettlementEventSystem implements System {
  readonly name = 'settlement_event';
  readonly tickHz = 1;

  private rng = new Random(0);

  /**
   * Cooldown map: key = `${poiId}:${eventType}`, value = tick (clock.now())
   * at which the POI is eligible for that event type again.
   */
  private cooldowns = new Map<string, number>();

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
        event.ticksElapsed++;

        if (event.ticksElapsed >= event.durationTicks) {
          // Event expired
          ctx.log.append({ type: 'settlement_end', poiId, eventType: event.type });
          // Set cooldown so the same type can't re-fire immediately
          const cfg = EVENT_CONFIGS[event.type];
          const key = `${poiId}:${event.type}`;
          this.cooldowns.set(key, ctx.clock.now() + cfg.cooldownTicks);
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

        if (roll < cfg.baseChance * scarcityMod) {
          const severity = 0.3 + this.rng.next() * 0.4; // 0.3–0.7
          const duration = cfg.minDuration +
            Math.floor(this.rng.next() * (cfg.maxDuration - cfg.minDuration + 1));

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
