import type { Spirit, SpiritId } from '@/core/spirit';
import type { Entity, SettlementEventType, NpcActivity } from '@/core/types';
import type { EventLog } from '@/core/events';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import { clamp01 } from '@/sim/npc-sim';
import type { World } from '@/world/world';

// ─── Power costs ──────────────────────────────────────────────────────────────

export const WHISPER_COST = 1;
export const OMEN_COST = 3;
export const DREAM_COST = 4;
export const MIRACLE_COST = 10;
export const ANSWER_PRAYER_COST = 2;

// ─── Effect magnitudes ───────────────────────────────────────────────────────

const WHISPER_FAITH_BOOST = 0.15;
const WHISPER_UNDERSTANDING_BOOST = 0.03;
const WHISPER_COOLDOWN = 5;

const OMEN_FAITH_BOOST = 0.08;     // per witness NPC
const OMEN_SEVERITY_BOOST = 0.2;   // boosts active event severity if one exists

const DREAM_FAITH_BOOST = 0.25;
const DREAM_UNDERSTANDING_BOOST = 0.10;
const DREAM_DEVOTION_BOOST = 0.08;
const DREAM_PERSONALITY_DRIFT = 0.05; // small personality shift

const MIRACLE_NEED_BOOST = 0.4;    // major need restoration
const MIRACLE_FAITH_BOOST = 0.3;   // per NPC in settlement
const MIRACLE_UNDERSTANDING_BOOST = 0.05;

const ANSWER_PRAYER_FAITH_BOOST = 0.2;
const ANSWER_PRAYER_UNDERSTANDING_BOOST = 0.15;
const ANSWER_PRAYER_DEVOTION_BOOST = 0.1;

// ─── Whisper (already exists in whisper.ts, reproduced here for completeness) ──

export function whisper(spirit: Spirit, npc: Entity, log: EventLog): boolean {
  if (spirit.power < WHISPER_COST) return false;
  const p = npcProps(npc);
  if (p.whisperCooldown > 0) return false;

  spirit.power -= WHISPER_COST;

  const existing = p.beliefs[spirit.id];
  if (existing) {
    existing.faith = clamp01(existing.faith + WHISPER_FAITH_BOOST);
    existing.understanding = clamp01(existing.understanding + WHISPER_UNDERSTANDING_BOOST);
  } else {
    p.beliefs[spirit.id] = {
      faith: WHISPER_FAITH_BOOST,
      understanding: WHISPER_UNDERSTANDING_BOOST,
      devotion: 0,
    };
  }
  p.whisperCooldown = WHISPER_COOLDOWN;

  const appended = log.append({ type: 'whisper', spiritId: spirit.id, npcId: npc.id });
  p.recentEventIds.push(appended.id);
  if (p.recentEventIds.length > 8) p.recentEventIds.shift();

  return true;
}

// ─── Omen: area effect on a settlement, visible to all NPCs ─────────────────

export function omen(spirit: Spirit, poiId: string, world: World, log: EventLog): boolean {
  if (spirit.power < OMEN_COST) return false;
  spirit.power -= OMEN_COST;

  let affected = 0;
  forEachNpc(world, (e) => {
    const p = npcProps(e);
    if (p.homePoiId !== poiId) return;
    const existing = p.beliefs[spirit.id];
    if (existing) {
      existing.faith = clamp01(existing.faith + OMEN_FAITH_BOOST);
    }
    affected++;
  });

  // Boost active event severity if there's one running
  const active = world.activeEvents.get(poiId);
  if (active) {
    for (const ev of active) {
      ev.severity = clamp01(ev.severity + OMEN_SEVERITY_BOOST);
    }
  }

  const appended = log.append({
    type: 'omen',
    spiritId: spirit.id,
    poiId,
    severity: affected > 0 ? Math.min(1, affected / 10) : 0.1,
  });

  return true;
}

// ─── Dream: deep influence on one NPC during sleep ──────────────────────────

export function dream(spirit: Spirit, npc: Entity, log: EventLog): boolean {
  if (spirit.power < DREAM_COST) return false;
  const p = npcProps(npc);

  spirit.power -= DREAM_COST;

  // Boost belief
  const existing = p.beliefs[spirit.id];
  if (existing) {
    existing.faith = clamp01(existing.faith + DREAM_FAITH_BOOST);
    existing.understanding = clamp01(existing.understanding + DREAM_UNDERSTANDING_BOOST);
    existing.devotion = clamp01(existing.devotion + DREAM_DEVOTION_BOOST);
  } else {
    p.beliefs[spirit.id] = {
      faith: DREAM_FAITH_BOOST,
      understanding: DREAM_UNDERSTANDING_BOOST,
      devotion: DREAM_DEVOTION_BOOST,
    };
  }

  // Small personality drift — the dream can slightly shift who they are
  p.personality.skepticism = clamp01(p.personality.skepticism - DREAM_PERSONALITY_DRIFT);
  p.personality.piety = clamp01(p.personality.piety + DREAM_PERSONALITY_DRIFT);

  // If NPC is sleeping, extend their sleep (the dream lingers)
  if (p.activity === 'sleep') {
    p.activityDuration = Math.max(p.activityDuration, 15);
  }

  const appended = log.append({ type: 'dream', spiritId: spirit.id, npcId: npc.id });
  p.recentEventIds.push(appended.id);
  if (p.recentEventIds.length > 8) p.recentEventIds.shift();

  return true;
}

// ─── Miracle: settlement-wide, meets a need ─────────────────────────────────

const NEED_TYPE_MAP: Record<string, keyof import('@/core/types').NpcNeeds> = {
  'drought': 'prosperity',
  'plague': 'safety',
  'raiders': 'safety',
  'dispute': 'community',
  'harvest_blessing': 'prosperity',
};

export function miracle(
  spirit: Spirit,
  poiId: string,
  world: World,
  log: EventLog,
): boolean {
  if (spirit.power < MIRACLE_COST) return false;
  spirit.power -= MIRACLE_COST;

  // Determine which need to meet based on active events
  let needType: keyof import('@/core/types').NpcNeeds = 'prosperity';
  const active = world.activeEvents.get(poiId);
  if (active && active.length > 0) {
    const eventType = active[0].type;
    if (eventType in NEED_TYPE_MAP) {
      needType = NEED_TYPE_MAP[eventType] as keyof import('@/core/types').NpcNeeds;
    }
  }

  let affected = 0;
  forEachNpc(world, (e) => {
    const p = npcProps(e);
    if (p.homePoiId !== poiId) return;

    // Meet the need
    p.needs[needType] = clamp01(p.needs[needType] + MIRACLE_NEED_BOOST);

    // Boost faith
    const existing = p.beliefs[spirit.id];
    if (existing) {
      existing.faith = clamp01(existing.faith + MIRACLE_FAITH_BOOST);
      existing.understanding = clamp01(existing.understanding + MIRACLE_UNDERSTANDING_BOOST);
    } else {
      p.beliefs[spirit.id] = {
        faith: MIRACLE_FAITH_BOOST,
        understanding: MIRACLE_UNDERSTANDING_BOOST,
        devotion: 0,
      };
    }
    affected++;
  });

  const appended = log.append({
    type: 'miracle',
    spiritId: spirit.id,
    poiId,
    needType,
    amount: MIRACLE_NEED_BOOST,
  });

  return true;
}

// ─── Answer Prayer: respond to an NPC's prayer ──────────────────────────────

export function answerPrayer(spirit: Spirit, npc: Entity, log: EventLog): boolean {
  if (spirit.power < ANSWER_PRAYER_COST) return false;
  const p = npcProps(npc);

  // Can only answer if NPC is praying
  if (p.activity !== 'worship') return false;

  spirit.power -= ANSWER_PRAYER_COST;

  const existing = p.beliefs[spirit.id];
  if (existing) {
    existing.faith = clamp01(existing.faith + ANSWER_PRAYER_FAITH_BOOST);
    existing.understanding = clamp01(existing.understanding + ANSWER_PRAYER_UNDERSTANDING_BOOST);
    existing.devotion = clamp01(existing.devotion + ANSWER_PRAYER_DEVOTION_BOOST);
  } else {
    p.beliefs[spirit.id] = {
      faith: ANSWER_PRAYER_FAITH_BOOST,
      understanding: ANSWER_PRAYER_UNDERSTANDING_BOOST,
      devotion: ANSWER_PRAYER_DEVOTION_BOOST,
    };
  }

  // Boost their lowest need slightly
  const needs = p.needs;
  const entries = Object.entries(needs) as [keyof typeof needs, number][];
  const minEntry = entries.reduce<[string, number]>(
    (min, [k, v]) => (v < min[1] ? [k, v] : min),
    ["safety", 1],
  );
  const lowestKey = minEntry[0] as keyof typeof needs;
  p.needs[lowestKey] = clamp01(p.needs[lowestKey] + 0.15);

  const appended = log.append({ type: 'answer_prayer', spiritId: spirit.id, npcId: npc.id });
  p.recentEventIds.push(appended.id);
  if (p.recentEventIds.length > 8) p.recentEventIds.shift();

  return true;
}

// ─── Power query ─────────────────────────────────────────────────────────────

export function getPower(spirts: Map<SpiritId, Spirit>, spiritId: SpiritId): number {
  return spirts.get(spiritId)?.power ?? 0;
}

export function canAfford(spirts: Map<SpiritId, Spirit>, spiritId: SpiritId, action: string): boolean {
  const spirit = spirts.get(spiritId);
  if (!spirit) return false;
  const costs: Record<string, number> = {
    whisper: WHISPER_COST,
    omen: OMEN_COST,
    dream: DREAM_COST,
    miracle: MIRACLE_COST,
    answer_prayer: ANSWER_PRAYER_COST,
  };
  return spirit.power >= (costs[action] ?? Infinity);
}
