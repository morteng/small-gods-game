/**
 * fate-tempo.ts — Fate's dramatic RHYTHM, derived (Track 4, pacing).
 *
 * A pure, Math.random-free reading of how densely Fate has been authoring lately.
 * It PERSISTS NOTHING: every number is re-derived from existing sim state each call
 * (recent staged beats, planted portents, live-arc momentum), so it rides no
 * snapshot and needs no SAVE_VERSION bump. The LLM only READS the guidance line —
 * it never computes pacing; the cluster-guard (`pulseShouldHold`) is the only
 * deterministic consumer.
 *
 * Fiction-day windows are TICKS_PER_DAY multiples (the 1:1 realtime rule) — never a
 * raw tick literal. Everything tolerates partial state (a test harness with no
 * staging/eventLog/arcs is a zero-tempo no-op, never a throw).
 */
import type { GameState } from '@/core/state';
import { TICKS_PER_DAY } from '@/core/calendar';

/** How far back the tempo counts authored beats + portents (three fiction days). */
export const TEMPO_WINDOW_TICKS = 3 * TICKS_PER_DAY;
/** Silence past which a beat-less Fate reads STARVED (four fiction days). */
export const STARVED_SILENCE_TICKS = 4 * TICKS_PER_DAY;
/** In-window beat count at/above which the world reads SATURATED. */
export const SATURATED_BEAT_COUNT = 3;

export type FateTempoPhase = 'starved' | 'nominal' | 'saturated';

export interface FateTempo {
  /** Beats staged within the window ending at `now`. */
  beatsInWindow: number;
  /** `portent_planted` events within the window ending at `now`. */
  portentsInWindow: number;
  /** Ticks since the most recent staged beat (= `now` when Fate has never staged one). */
  ticksSinceLastBeat: number;
  /** Live arcs in the 'building' stage. */
  buildingArcs: number;
  /** Live arcs escalated to 'imminent' (the high-tension rising action). */
  imminentArcs: number;
  phase: FateTempoPhase;
  /** Dramatic pressure, 0..1 — derived monotonically from arc momentum + recent authoring. */
  tension: number;
  /** A prompt-ready sentence naming the phase (feeds `describeTempoForFate`). */
  guidance: string;
}

export interface FateTempoConfig {
  windowTicks?: number;
  starvedSilenceTicks?: number;
  saturatedBeatCount?: number;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Derive Fate's dramatic tempo at `now` from live state. Pure; persists nothing.
 * Beats: `state.staging.serialize()` filtered to `stagedTick` in [now-window, now].
 * Portents: `state.eventLog.range(now-window, now+1)` filtered to `portent_planted`.
 * Momentum: `state.fateArcs.live()` counting building + imminent stages.
 */
export function computeFateTempo(
  state: GameState,
  now: number,
  cfg?: FateTempoConfig,
): FateTempo {
  const windowTicks = cfg?.windowTicks ?? TEMPO_WINDOW_TICKS;
  const starvedSilenceTicks = cfg?.starvedSilenceTicks ?? STARVED_SILENCE_TICKS;
  const saturatedBeatCount = cfg?.saturatedBeatCount ?? SATURATED_BEAT_COUNT;
  const windowStart = now - windowTicks;

  // Recent authored beats + the freshest staging tick (silence measure).
  const beats = state.staging?.serialize() ?? [];
  let beatsInWindow = 0;
  let lastStagedTick = -Infinity;
  for (const b of beats) {
    if (b.stagedTick > now) continue;               // ignore any future-dated beat
    if (b.stagedTick > lastStagedTick) lastStagedTick = b.stagedTick;
    if (b.stagedTick >= windowStart) beatsInWindow++;
  }
  // No beat ever ⇒ silence spans the whole run so far (never negative).
  const ticksSinceLastBeat = lastStagedTick === -Infinity
    ? Math.max(0, now)
    : Math.max(0, now - lastStagedTick);

  // Portents planted within the window (each heavy beat's foreshadowing).
  let portentsInWindow = 0;
  for (const a of state.eventLog?.range(windowStart, now + 1) ?? []) {
    if (a.event.type === 'portent_planted') portentsInWindow++;
  }

  // Live-arc momentum: building = rising, imminent = at the brink.
  let buildingArcs = 0;
  let imminentArcs = 0;
  for (const arc of state.fateArcs?.live() ?? []) {
    if (arc.stage === 'building') buildingArcs++;
    else if (arc.stage === 'imminent') imminentArcs++;
  }

  const phase: FateTempoPhase =
    beatsInWindow >= saturatedBeatCount
      ? 'saturated'
      : beatsInWindow === 0 && ticksSinceLastBeat >= starvedSilenceTicks
        ? 'starved'
        : 'nominal';

  // Deterministic, monotone in every rising-action signal; imminent weighs most.
  const tension = clamp01(
    0.15 * buildingArcs +
    0.5 * imminentArcs +
    0.12 * beatsInWindow +
    0.08 * portentsInWindow,
  );

  const days = Math.round(ticksSinceLastBeat / TICKS_PER_DAY);
  const guidance =
    phase === 'saturated'
      ? `Dramatic tempo is SATURATED — ${beatsInWindow} beats authored in the last few days. Hold back: let the mortals' story breathe rather than piling on new drama.`
      : phase === 'starved'
        ? `Dramatic tempo is STARVED — no beats authored in about ${days} day(s). The age has gone quiet; consider seeding or advancing an arc to build some rising action.`
        : `Dramatic tempo is NOMINAL — ${beatsInWindow} recent beat(s), ${buildingArcs} building and ${imminentArcs} imminent arc(s). Act only where the mortals' story earns it.`;

  return {
    beatsInWindow,
    portentsInWindow,
    ticksSinceLastBeat,
    buildingArcs,
    imminentArcs,
    phase,
    tension,
    guidance,
  };
}

/** The proactive cluster-guard decision: HOLD the pulse when the world is saturated. */
export function pulseShouldHold(tempo: FateTempo): boolean {
  return tempo.phase === 'saturated';
}

/** The one-line tempo digest spliced into Fate's prompt so the LLM paces itself. */
export function describeTempoForFate(tempo: FateTempo): string {
  return tempo.guidance;
}
