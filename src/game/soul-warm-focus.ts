/**
 * UI v2 W3 (D6) — "focus warms the soul": selecting an NPC while the camera sits
 * in the soul band is genuine player attention reaching them, so it now warms the
 * same LLM backfill path the legacy attention panel's manual button always had —
 * the v1 zoom/focus spec's "zoom = attention = narration trigger", finally wired
 * automatically. Re-selecting (or re-entering) the same soul must not spam paid
 * calls, so a per-NPC cooldown gates the trigger.
 *
 * This module is the PURE decision only — no `Game`, no DOM, no LLM client. Real
 * time (`Date.now()`/`performance.now()`), never sim ticks: CLAUDE.md's rule for
 * tick-window UI constants ("sized in REAL time") applies here too — a paused or
 * fast-forwarded sim must not change how often a soul can be warmed.
 */

/** Minimum real time between two backfill fires for the SAME npc. 10 minutes —
 *  long enough that idle re-selection (browsing back and forth) never re-spends,
 *  short enough that a session returning to a soul later still gets fresh colour. */
export const SOUL_WARM_FOCUS_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * True when `npcId` is due for a warm-focus backfill: never fired before, or the
 * cooldown has fully elapsed since its last recorded fire. Pure read — does not
 * mutate `lastFiredAt`; the caller records the fire (via its own map/set) only
 * once the trigger actually goes out, so a call that gets skipped downstream
 * (missing entity, offline provider) never falsely starts the cooldown.
 */
export function soulWarmFocusDue(
  npcId: string,
  lastFiredAt: ReadonlyMap<string, number>,
  nowMs: number,
  cooldownMs: number = SOUL_WARM_FOCUS_COOLDOWN_MS,
): boolean {
  const last = lastFiredAt.get(npcId);
  return last === undefined || nowMs - last >= cooldownMs;
}
