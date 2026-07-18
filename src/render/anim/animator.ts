/**
 * Animator — the render-side state machine that turns sim intents (a gait,
 * plus one-shot or looping overlays) into the `ClipLayer[]` stack
 * `sampleClipLayers` (see `../paperdoll/rig.ts`) composes into a pose each
 * frame.
 *
 * WHY CROSSFADES NEED NO SPECIAL MACHINERY: `sampleClipLayers` merges
 * `override` layers by `acc = lerp(acc, layer, weight)` in stack order. Two
 * layers — the outgoing gait at weight 1 underneath the incoming gait at a
 * weight ramping 0→1 — blend into exactly a crossfade for free. The Animator's
 * only job is to hold both gait layers for the span of the ramp and drop the
 * outgoing one once it completes; there is no separate "blend" code path.
 *
 * WHY THIS NEVER READS TIME ITSELF: same rule as `beat-clock.ts` — a frame's
 * output must be a pure function of its inputs so replays stay deterministic.
 * Every method that needs "now" takes `nowMs: number` explicitly; the game
 * loop passes its own frame clock. Pure logic, no DOM, no clip sampling (the
 * Animator only ever builds `ClipLayer` descriptors — `sampleClipLayers` is
 * what actually reads `clip.tracks`).
 */
import type { Clip, ClipLayer } from '../paperdoll/rig';

export interface GaitOptions {
  /** Playback rate multiplier (default 1). */
  rate?: number;
}

export interface OverlayOptions {
  /** Chip mask forwarded to the ClipLayer (omit = all chips). */
  chips?: readonly string[];
  /** Merge mode forwarded to the ClipLayer (default 'override'). */
  mode?: 'override' | 'additive';
  /** Peak weight (default 1). */
  weight?: number;
  /** Fade-in/out duration ms (default the animator's fadeMs). */
  fadeMs?: number;
  /** Loop until stopOverlay (true) or one-shot through the clip once (false, default). */
  loop?: boolean;
}

/** Internal gait slot — one looping clip plus its own crossfade-in ramp. */
interface GaitSlot {
  clip: Clip;
  durationMs: number;
  rate: number;
  /** Phase anchor: t = 0 at this time, at the CURRENT rate/duration. */
  startMs: number;
  /** When this slot's crossfade-in began (drives its weight ramp). */
  fadeStartMs: number;
  fadeMs: number;
}

/** Internal overlay slot. */
interface OverlaySlot {
  id: string;
  clip: Clip;
  durationMs: number;
  startMs: number;
  chips?: readonly string[];
  mode: 'override' | 'additive';
  weight: number;
  fadeMs: number;
  loop: boolean;
  /** Set by stopOverlay: when the fade-OUT of a looping overlay began. */
  stopStartMs: number | null;
}

/** Linear ramp 0→1 over `[start, start + dur]`, clamped, dur<=0 snaps to 1. */
function rampUp(nowMs: number, start: number, dur: number): number {
  if (dur <= 0) return 1;
  const u = (nowMs - start) / dur;
  return u <= 0 ? 0 : u >= 1 ? 1 : u;
}

/** Continuous loop phase in [0, 1) for a clip running at `rate` since `startMs`. */
function loopPhase(nowMs: number, startMs: number, durationMs: number, rate: number): number {
  if (durationMs <= 0) return 0;
  const raw = ((nowMs - startMs) * rate) / durationMs;
  const wrapped = raw % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

export class Animator {
  private readonly defaultFadeMs: number;

  /** At most 2 gait slots: index 0 = outgoing (fading out of the mix), 1 = current. */
  private gaits: GaitSlot[] = [];
  /** Set when setGait(null) fades the last gait out to rest — no incoming slot. */
  private gaitFadeOutStartMs: number | null = null;
  private gaitFadeOutMs = 0;

  private overlays: OverlaySlot[] = [];

  constructor(opts?: { fadeMs?: number }) {
    this.defaultFadeMs = opts?.fadeMs ?? 150;
  }

  /**
   * Set the looping base gait. Crossfades from the current gait over fadeMs.
   * Setting the SAME clip object again is a pure param update (rate/duration),
   * re-anchoring startMs so phase stays continuous — no restart, no fade.
   * `clip: null` fades the current gait out to rest pose.
   */
  setGait(clip: Clip | null, durationMs: number, nowMs: number, opts?: GaitOptions): void {
    const rate = opts?.rate ?? 1;
    const current = this.gaits[this.gaits.length - 1];

    if (clip === null) {
      // Fade whatever's playing out to rest; drop any older slot immediately
      // (it was already below the current one in the mix).
      if (current) {
        this.gaits = [current];
        this.gaitFadeOutStartMs = nowMs;
        this.gaitFadeOutMs = this.defaultFadeMs;
      }
      return;
    }

    if (current && current.clip === clip) {
      // Same clip: re-anchor so the continuous phase is preserved at the new
      // rate/duration, but don't touch the fade-in ramp or push a new slot.
      const t = loopPhase(nowMs, current.startMs, current.durationMs, current.rate);
      current.durationMs = durationMs;
      current.rate = rate;
      current.startMs = nowMs - (t * durationMs) / rate;
      return;
    }

    // A genuinely new gait: it becomes the incoming slot, fading in on top of
    // whatever's already in the stack. Simple-and-honest tradeoff: we keep at
    // most 2 gait slots, so a THIRD setGait mid-fade drops the eldest outright
    // (a hard pop on that one) rather than chaining an N-deep fade stack —
    // fine for locomotion (gaits change far slower than fadeMs) and keeps
    // sampleClipLayers's per-frame cost bounded.
    const incoming: GaitSlot = {
      clip,
      durationMs,
      rate,
      startMs: nowMs,
      fadeStartMs: nowMs,
      fadeMs: this.defaultFadeMs,
    };
    this.gaits = current ? [current, incoming] : [incoming];
    this.gaitFadeOutStartMs = null;
  }

  /**
   * Start (or upsert by id) an overlay. Upserting an active overlay updates
   * its options in place without restarting its phase or fade-in.
   */
  playOverlay(id: string, clip: Clip, durationMs: number, nowMs: number, opts?: OverlayOptions): void {
    const fadeMs = opts?.fadeMs ?? this.defaultFadeMs;
    const existing = this.overlays.find((o) => o.id === id);
    if (existing) {
      existing.clip = clip;
      existing.durationMs = durationMs;
      existing.chips = opts?.chips;
      existing.mode = opts?.mode ?? 'override';
      existing.weight = opts?.weight ?? 1;
      existing.fadeMs = fadeMs;
      existing.loop = opts?.loop ?? false;
      return;
    }
    this.overlays.push({
      id,
      clip,
      durationMs,
      startMs: nowMs,
      chips: opts?.chips,
      mode: opts?.mode ?? 'override',
      weight: opts?.weight ?? 1,
      fadeMs,
      loop: opts?.loop ?? false,
      stopStartMs: null,
    });
  }

  /** Begin fading a looping overlay out (auto-removes when weight hits 0). Unknown id is a no-op. */
  stopOverlay(id: string, nowMs: number): void {
    const slot = this.overlays.find((o) => o.id === id);
    if (!slot || !slot.loop || slot.stopStartMs !== null) return;
    slot.stopStartMs = nowMs;
  }

  /**
   * The layer stack for `nowMs`: gait layers first (outgoing below incoming,
   * whose ramping weight IS the crossfade), then overlays in start order.
   * Also prunes finished layers. Empty array = rest pose.
   */
  update(nowMs: number): ClipLayer[] {
    const layers: ClipLayer[] = [];

    // --- Gaits ---
    if (this.gaitFadeOutStartMs !== null) {
      // Fading the sole gait out to rest.
      const slot = this.gaits[0];
      const w = 1 - rampUp(nowMs, this.gaitFadeOutStartMs, this.gaitFadeOutMs);
      if (w <= 0) {
        this.gaits = [];
        this.gaitFadeOutStartMs = null;
      } else {
        layers.push({
          clip: slot.clip,
          t: loopPhase(nowMs, slot.startMs, slot.durationMs, slot.rate),
          weight: w,
        });
      }
    } else if (this.gaits.length === 2) {
      const [outgoing, incoming] = this.gaits;
      const w = rampUp(nowMs, incoming.fadeStartMs, incoming.fadeMs);
      if (w >= 1) {
        // Crossfade complete as of this sample: drop the outgoing slot for
        // good and emit only the (now sole) incoming gait at full weight —
        // an outgoing layer at weight 1 under an incoming layer ALSO at
        // weight 1 would sample identically (override lerp at w=1 is just
        // the incoming pose), but pruning here keeps the returned stack's
        // layer COUNT honest with the documented "only the new gait remains".
        this.gaits = [incoming];
        layers.push({
          clip: incoming.clip,
          t: loopPhase(nowMs, incoming.startMs, incoming.durationMs, incoming.rate),
          weight: 1,
        });
      } else {
        layers.push({
          clip: outgoing.clip,
          t: loopPhase(nowMs, outgoing.startMs, outgoing.durationMs, outgoing.rate),
          weight: 1,
        });
        layers.push({
          clip: incoming.clip,
          t: loopPhase(nowMs, incoming.startMs, incoming.durationMs, incoming.rate),
          weight: w,
        });
      }
    } else if (this.gaits.length === 1) {
      const slot = this.gaits[0];
      layers.push({
        clip: slot.clip,
        t: loopPhase(nowMs, slot.startMs, slot.durationMs, slot.rate),
        weight: 1,
      });
    }

    // --- Overlays ---
    const keep: OverlaySlot[] = [];
    for (const o of this.overlays) {
      const elapsed = nowMs - o.startMs;
      let t: number;
      let w: number;

      if (o.loop) {
        t = loopPhase(nowMs, o.startMs, o.durationMs, 1);
        const fadeIn = rampUp(nowMs, o.startMs, o.fadeMs);
        const fadeOut = o.stopStartMs === null ? 1 : 1 - rampUp(nowMs, o.stopStartMs, o.fadeMs);
        w = o.weight * Math.min(fadeIn, fadeOut);
        if (o.stopStartMs !== null && fadeOut <= 0) continue; // auto-remove
      } else {
        // One-shot: clip time clamps at 1; the envelope has already hit 0 by
        // the time elapsed reaches durationMs, so no extra tail is needed.
        t = o.durationMs <= 0 ? 1 : Math.min(elapsed / o.durationMs, 1);
        if (elapsed >= o.durationMs) continue; // auto-remove
        const fadeIn = rampUp(nowMs, o.startMs, o.fadeMs);
        const fadeOutStart = o.durationMs - o.fadeMs;
        const fadeOut = 1 - rampUp(nowMs, o.startMs + fadeOutStart, o.fadeMs);
        w = o.weight * Math.min(fadeIn, fadeOut);
      }

      layers.push({ clip: o.clip, t, weight: w, chips: o.chips, mode: o.mode });
      keep.push(o);
    }
    this.overlays = keep;

    return layers;
  }
}
