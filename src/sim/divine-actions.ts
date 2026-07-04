import type { Spirit, SpiritId } from '@/core/spirit';
import type { Entity, SettlementEventType, NpcActivity } from '@/core/types';
import type { EventLog } from '@/core/events';
import { npcProps, forEachNpc, rememberEvent } from '@/world/npc-helpers';
import { clamp01, signResponse } from '@/sim/npc-sim';
import type { World } from '@/world/world';
import { addDomainBelief, isOminous } from '@/sim/belief-domains';
import { isWaterTile } from '@/world/land-snap';
import type { WeatherStepper } from '@/sim/water/weather-stepper';
import type { CausalSite } from '@/world/causal-site';

// ─── Power costs ──────────────────────────────────────────────────────────────

export const WHISPER_COST = 1;
export const OMEN_COST = 3;
export const DREAM_COST = 4;
export const MIRACLE_COST = 10;
export const ANSWER_PRAYER_COST = 2;
export const SMITE_COST = 8;
export const SUMMON_STORM_COST = 12;

// summon_storm: how much water the storm lays, and how far.
const SUMMON_STORM_RADIUS = 6;   // tiles
const SUMMON_STORM_DEPTH_M = 3;  // metres of standing water over the disc
/** Flood-domain belief seeded in a believer when the waters rise at their home — the
 *  attribution that both unlocks `summon_storm` (a god who floods) and reinforces it. */
const FLOOD_WITNESS_SEED = 0.12;

// ─── Effect magnitudes ───────────────────────────────────────────────────────

const WHISPER_FAITH_BOOST = 0.15;
const WHISPER_UNDERSTANDING_BOOST = 0.03;
const WHISPER_COOLDOWN = 5;

const OMEN_FAITH_BOOST = 0.08;     // per witness NPC
const OMEN_SEVERITY_BOOST = 0.2;   // boosts active event severity if one exists

const DREAM_FAITH_BOOST = 0.05;
const DREAM_UNDERSTANDING_BOOST = 0.12;
const DREAM_DEVOTION_BOOST = 0.12;
const DREAM_PERSONALITY_DRIFT = 0.05; // small personality shift

const MIRACLE_NEED_BOOST = 0.4;    // major need restoration
const MIRACLE_FAITH_BOOST = 0.3;   // per NPC in settlement
const MIRACLE_UNDERSTANDING_BOOST = 0.05;

const ANSWER_PRAYER_FAITH_BOOST = 0.2;
const ANSWER_PRAYER_MEANING_BOOST = 0.3; // Answer restores the divine need specifically
const ANSWER_UNDERSTANDING_BOOST = 0.04; // a heard prayer teaches a little of your form

// ── Belief-content attribution (Track B) ─────────────────────────────────────
// An omen is a sign in the sky; over a suffering settlement it reads as wrath →
// believers start to attribute the storm to you (the coincidence bootstrap).
const OMEN_STORM_SEED = 0.05;          // per believing witness, ×signResponse
// Flood bootstrap (R7 WP-B): the flood domain used to be seeded ONLY by floods,
// and floods came ONLY from summon_storm itself — circular, so summon_storm was
// unreachable on a fresh world. Mirror the storm bootstrap: a wrathful sign seen
// where the waters loom reads as the deluge's master, seeding flood-attribution
// through the same ungated omen path (a god's vocabulary = what its believers
// think it can do). seedFloodBelief/seedSiteBelief remain the reinforcement loop.
const OMEN_FLOOD_SEED = 0.05;          // per water-adjacent believing witness, ×signResponse
const OMEN_WATER_RADIUS = 4;           // tiles; how near the waters must be for the sign to read as flood
// A smite is unambiguous — the storm OBEYED. Strong reinforcement for witnesses,
// and the target felt it directly.
const SMITE_TARGET_FEAR_FAITH = 0.35;  // fear converts (×signResponse on existing belief)
const SMITE_TARGET_DEVOTION_PENALTY = 0.1; // fear is not love
const SMITE_TARGET_UNDERSTANDING_BOOST = 0.06;
const SMITE_TARGET_SAFETY_DROP = 0.5;
const SMITE_TARGET_STORM_SEED = 0.25;
const SMITE_WITNESS_FAITH_BOOST = 0.12;
const SMITE_WITNESS_STORM_SEED = 0.15;
const SMITE_WITNESS_RADIUS = 6;        // tiles; a spot-strike is seen by those nearby

// ─── Whisper (already exists in whisper.ts, reproduced here for completeness) ──

export function whisper(spirit: Spirit, npc: Entity, log: EventLog, conversational = false): boolean {
  if (spirit.power < WHISPER_COST) return false;
  const p = npcProps(npc);
  if (!conversational && p.whisperCooldown > 0) return false;

  spirit.power -= WHISPER_COST;

  const existing = p.beliefs[spirit.id];
  if (existing) {
    // Order matters: faith scales by *pre-whisper* understanding; the teaching
    // boost is applied after, so it can't inflate this same whisper's faith gain.
    existing.faith = clamp01(existing.faith + WHISPER_FAITH_BOOST * signResponse(existing.understanding));
    existing.understanding = clamp01(existing.understanding + WHISPER_UNDERSTANDING_BOOST);
  } else {
    p.beliefs[spirit.id] = {
      faith: WHISPER_FAITH_BOOST * signResponse(0),
      understanding: WHISPER_UNDERSTANDING_BOOST,
      devotion: 0,
    };
  }
  p.whisperCooldown = WHISPER_COOLDOWN;

  const appended = log.append({ type: 'whisper', spiritId: spirit.id, npcId: npc.id });
  rememberEvent(p, appended.id);

  return true;
}

// ─── Omen: area effect on a settlement, visible to all NPCs ─────────────────

/** True when any water tile lies within Chebyshev radius `r` of (x,y).
 *  Deterministic tile-scan; out-of-bounds reads are simply not water. */
function nearWater(world: World, x: number, y: number, r: number): boolean {
  const cx = Math.round(x), cy = Math.round(y);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (isWaterTile(world.tiles, cx + dx, cy + dy)) return true;
    }
  }
  return false;
}

export function omen(spirit: Spirit, poiId: string, world: World, log: EventLog): boolean {
  if (spirit.power < OMEN_COST) return false;
  spirit.power -= OMEN_COST;

  // A sign over a suffering settlement breeds storm-attribution. Scale the seed
  // by how dire the running events are (no ominous event → a faint base seed).
  const active = world.activeEvents.get(poiId);
  let ominousSeverity = 0;
  if (active) {
    for (const ev of active) {
      if (isOminous(ev.type)) ominousSeverity = Math.max(ominousSeverity, ev.severity);
    }
  }

  const witnesses: Entity[] = [];
  forEachNpc(world, (e) => {
    const p = npcProps(e);
    if (p.homePoiId !== poiId) return;
    const existing = p.beliefs[spirit.id];
    if (existing) {
      existing.faith = clamp01(existing.faith + OMEN_FAITH_BOOST * signResponse(existing.understanding));
      // Attribution: a believer who grasps signs reads this one as the angry sky.
      const seed = signResponse(existing.understanding) * (1 + ominousSeverity);
      addDomainBelief(p, spirit.id, 'storm', OMEN_STORM_SEED * seed);
      // …and where the waters loom, the same sign also reads as the deluge —
      // the flood domain's ungated bootstrap (see OMEN_FLOOD_SEED above).
      if (nearWater(world, e.x, e.y, OMEN_WATER_RADIUS)) {
        addDomainBelief(p, spirit.id, 'flood', OMEN_FLOOD_SEED * seed);
      }
    }
    witnesses.push(e);
  });

  // Boost active event severity if there's one running
  if (active) {
    for (const ev of active) {
      ev.severity = clamp01(ev.severity + OMEN_SEVERITY_BOOST);
    }
  }

  const appended = log.append({
    type: 'omen',
    spiritId: spirit.id,
    poiId,
    severity: witnesses.length > 0 ? Math.min(1, witnesses.length / 10) : 0.1,
  });
  // Every resident saw the sign — it enters their memory rings (WP-C).
  for (const e of witnesses) rememberEvent(npcProps(e), appended.id);

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
  rememberEvent(p, appended.id);

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

  const witnesses: Entity[] = [];
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
    witnesses.push(e);
  });

  const appended = log.append({
    type: 'miracle',
    spiritId: spirit.id,
    poiId,
    needType,
    amount: MIRACLE_NEED_BOOST,
  });
  // The whole settlement lived through the wonder — it enters their rings (WP-C).
  for (const e of witnesses) rememberEvent(npcProps(e), appended.id);

  return true;
}

// ─── Answer Prayer: respond to an NPC's prayer ──────────────────────────────

export function answerPrayer(spirit: Spirit, npc: Entity, log: EventLog): boolean {
  if (spirit.power < ANSWER_PRAYER_COST) return false;
  const p = npcProps(npc);

  // Can only answer a standing plea.
  if (p.activity !== 'worship') return false;

  spirit.power -= ANSWER_PRAYER_COST;

  // Recruitment: creates the belief entry if this is a non-believer praying.
  const existing = p.beliefs[spirit.id];
  if (existing) {
    // Order matters: faith scales by *pre-answer* understanding; the comprehension
    // nudge is applied after, so it can't inflate this same answer's faith gain.
    existing.faith = clamp01(existing.faith + ANSWER_PRAYER_FAITH_BOOST * signResponse(existing.understanding));
    existing.understanding = clamp01(existing.understanding + ANSWER_UNDERSTANDING_BOOST);
  } else {
    p.beliefs[spirit.id] = {
      faith: ANSWER_PRAYER_FAITH_BOOST * signResponse(0),
      understanding: ANSWER_UNDERSTANDING_BOOST,
      devotion: 0,
    };
  }

  // Restore the divine need and clear the worship state so the 🙏 lifts.
  p.needs.meaning = clamp01(p.needs.meaning + ANSWER_PRAYER_MEANING_BOOST);
  p.activity = 'idle';
  p.activityDuration = 0;

  const appended = log.append({ type: 'answer_prayer', spiritId: spirit.id, npcId: npc.id });
  rememberEvent(p, appended.id);

  return true;
}

// ─── Smite: call lightning down (belief-content gated) ──────────────────────
// The headline dramatic action. Gated by the `storm` domain aggregate (the
// congregation must believe you command the sky — see registry.ts). A strike on a
// PERSON terrifies them into belief; a strike on a THING or a SPOT (entity/tile,
// agent-driven-UI P2) has no soul to convert but still lands as raw spectacle.
// Either way, every witness who sees the storm OBEY has their storm-attribution
// reinforced — the loop's positive feedback.

/** Reinforce storm-attribution in every NPC the strike's witnesses-predicate accepts.
 *  Returns the accepted witnesses so the caller can stamp their memory rings. */
function reinforceStormWitnesses(spirit: Spirit, world: World, accept: (e: Entity) => boolean): Entity[] {
  const witnesses: Entity[] = [];
  forEachNpc(world, (e) => {
    if (!accept(e)) return;
    const b = npcProps(e).beliefs[spirit.id];
    if (b) {
      b.faith = clamp01(b.faith + SMITE_WITNESS_FAITH_BOOST * signResponse(b.understanding));
      addDomainBelief(npcProps(e), spirit.id, 'storm', SMITE_WITNESS_STORM_SEED * signResponse(b.understanding));
    }
    witnesses.push(e);
  });
  return witnesses;
}

export function smite(spirit: Spirit, npc: Entity, world: World, log: EventLog): boolean {
  if (spirit.power < SMITE_COST) return false;
  spirit.power -= SMITE_COST;

  const tp = npcProps(npc);
  const poiId = tp.homePoiId;

  // ── the target: fear converts (but fear is not love → devotion suffers) ──
  const tb = tp.beliefs[spirit.id];
  if (tb) {
    tb.faith = clamp01(tb.faith + SMITE_TARGET_FEAR_FAITH * signResponse(tb.understanding));
    tb.understanding = clamp01(tb.understanding + SMITE_TARGET_UNDERSTANDING_BOOST);
    tb.devotion = clamp01(tb.devotion - SMITE_TARGET_DEVOTION_PENALTY);
  } else {
    tp.beliefs[spirit.id] = {
      faith: SMITE_TARGET_FEAR_FAITH * signResponse(0),
      understanding: SMITE_TARGET_UNDERSTANDING_BOOST,
      devotion: 0,
    };
  }
  tp.needs.safety = clamp01(tp.needs.safety - SMITE_TARGET_SAFETY_DROP);
  addDomainBelief(tp, spirit.id, 'storm', SMITE_TARGET_STORM_SEED);

  // ── witnesses in the same settlement: the storm obeyed → reinforce ──
  const witnesses = poiId
    ? reinforceStormWitnesses(spirit, world, (e) => e.id !== npc.id && npcProps(e).homePoiId === poiId)
    : [];

  const appended = log.append({ type: 'smite', spiritId: spirit.id, npcId: npc.id, poiId, witnesses: witnesses.length });
  rememberEvent(tp, appended.id);
  // The strike is seared into every witness's memory too (WP-C).
  for (const e of witnesses) rememberEvent(npcProps(e), appended.id);

  return true;
}

/**
 * Smite a SPOT rather than a soul (entity/tile targets). No conversion — there is
 * no mind to terrify — but the storm still obeyed, so every NPC within
 * `SMITE_WITNESS_RADIUS` tiles who sees it has their storm-attribution reinforced.
 */
export function smiteLocation(spirit: Spirit, x: number, y: number, world: World, log: EventLog): boolean {
  if (spirit.power < SMITE_COST) return false;
  spirit.power -= SMITE_COST;
  const r2 = SMITE_WITNESS_RADIUS * SMITE_WITNESS_RADIUS;
  const witnesses = reinforceStormWitnesses(spirit, world, (e) => {
    const dx = e.x - x, dy = e.y - y;
    return dx * dx + dy * dy <= r2;
  });
  const appended = log.append({ type: 'smite', spiritId: spirit.id, x, y, witnesses: witnesses.length });
  for (const e of witnesses) rememberEvent(npcProps(e), appended.id);
  return true;
}

/**
 * summon_storm (W-H) — the belief-gated weather lever: a god whose believers credit it
 * with the rains calls a deluge over a settlement, laying standing water on the ground.
 * The flood itself (per-cell `floodM`) is laid via the injected deterministic stepper;
 * the next `WeatherSystem` tick polls it and emits `place_flooded`, which seeds more
 * flood-belief (`seedFloodBelief`) and wakes Fate. Costs power; gate lives in the
 * capability registry (flood-domain conviction). Returns false on a lost power race.
 */
export function summonStorm(
  spirit: Spirit,
  poiId: string,
  log: EventLog,
  weather: WeatherStepper | null | undefined,
): boolean {
  if (spirit.power < SUMMON_STORM_COST) return false;
  spirit.power -= SUMMON_STORM_COST;
  const cells = weather?.floodPoi(poiId, SUMMON_STORM_RADIUS, SUMMON_STORM_DEPTH_M) ?? 0;
  log.append({ type: 'summon_storm', spiritId: spirit.id, poiId, depthM: SUMMON_STORM_DEPTH_M, cells });
  return true;
}

/**
 * When the waters rise at a settlement, its believers attribute it to the god they
 * follow — seeding the `flood` belief domain (the W-H attribution-at-the-act-site). This
 * both unlocks `summon_storm` over time and reinforces it. Called by the WeatherSystem on
 * a `place_flooded` edge. `depthM` scales the conviction a single flood imparts.
 */
export function seedFloodBelief(
  world: World, spiritId: SpiritId, poiId: string, depthM: number,
): void {
  const gain = FLOOD_WITNESS_SEED * Math.min(1, depthM / SUMMON_STORM_DEPTH_M);
  forEachNpc(world, (e) => {
    const p = npcProps(e);
    if (p.homePoiId !== poiId) return;
    addDomainBelief(p, spiritId, 'flood', gain);
  });
}

/**
 * W-I-c — belief at a CAUSAL SITE. Where `seedFloodBelief` keys on residency (a
 * settlement's own believers), a causal site has no residents — it's a drowned plain.
 * So belief seeds by PROXIMITY instead: any NPC standing in or adjacent to the site's
 * footprint witnesses the deluge and credits the causing spirit, scaled by the site's
 * intensity. Same attribution-at-the-act-site principle, generalized off the poiId.
 */
export function seedSiteBelief(world: World, site: CausalSite): void {
  const gain = FLOOD_WITNESS_SEED * Math.min(1, site.intensity);
  if (gain <= 0 || site.cause === 'nature') return;   // nobody to credit for a natural flood
  const w = world.tiles.width;
  const foot = new Set<number>();
  for (let k = 0; k < site.cells.length; k++) foot.add(site.cells[k]);
  forEachNpc(world, (e) => {
    const cx = Math.round(e.x), cy = Math.round(e.y);
    const c = cy * w + cx;
    // In the footprint, or 4-adjacent to it (close enough to witness the waters rise).
    if (foot.has(c) || foot.has(c - 1) || foot.has(c + 1) || foot.has(c - w) || foot.has(c + w)) {
      addDomainBelief(npcProps(e), site.cause, 'flood', gain);
    }
  });
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
