/**
 * audio-buses.ts — the master → { music, sfx } gain topology (design doc §6.1,
 * "audio completion"). Today SFX stingers (sfx-director.ts) and the score
 * (cue-sequencer.ts) both ride ONE ctx-level master gain (tinysynth-backend.ts),
 * so neither can be muted/attenuated without the other. This module is the
 * channel-group split that makes them independent.
 *
 * EMPIRICAL FINDING (read directly from
 * node_modules/webaudio-tinysynth/webaudio-tinysynth.js — do not trust the
 * hand-trimmed `TinySynth` interface slice in tinysynth-backend.ts, it hides
 * this): `setAudioContext(actx, dest)` (line ~1303) wires ALL 16 GM channels
 * into ONE shared `this.out` GainNode, then optional reverb, then
 * `this.comp` (a DynamicsCompressor), then `dest` (our own master GainNode,
 * see tinysynth-backend.ts). There is NO separate output AudioNode per
 * channel-group we could tap and route through two independent GainNodes —
 * every channel's audio is already summed before it ever reaches `dest`, so a
 * true two-GainNode split is not possible with this backend.
 *
 * BUT: each channel DOES own a private per-channel GainNode
 * (`this.chvol[i]=this.actx.createGain()`, line ~1354, upstream of the shared
 * `this.out`), and it IS independently drivable through a PUBLIC method,
 * `setChVol(channel, value0to127, when?)` (line ~1106-1109) — the same path a
 * real MIDI CC#7 (channel volume) message takes (line ~755, ~1221).
 * So: the SFX bus is implemented as per-channel MIDI CC7 channel-volume (a
 * value 0..127, mirroring a real CC#7 channel-volume message), applied
 * uniformly to the reserved SFX channels (6-8, sfx-director.ts, plus 9 for UI
 * cues — see ui-cues.ts) versus the music voice channels (0-5, cue-sequencer
 * .ts's VOICE map) — layered UNDER the existing ctx-level master gain
 * (tinysynth-backend.ts's `setMasterVolume`/`setMuted`, unchanged).
 * Final loudness per channel = masterGain × busVolume × noteVelocity, all of
 * which compose linearly through the node graph as expected.
 */

/** Music voices (cue-sequencer.ts's pad/bass/pluck/bell/lead/choir). */
export const MUSIC_CHANNELS = [0, 1, 2, 3, 4, 5] as const;
/** SFX voices: sfx-director.ts's event stingers (6-8) + ui-cues.ts's tick/confirm (9). */
export const SFX_CHANNELS = [6, 7, 8, 9] as const;

/** The slice of the tinysynth API a bus needs: per-channel MIDI CC7 volume. */
export interface ChannelVolumeTarget {
  setChVol(channel: number, value: number, when?: number): void;
}

/** Linear 0..1 → MIDI CC7 channel-volume 0..127 (clamped). The synth applies its
 *  own perceptual curve internally (`vol=3*v*v/127²`) — this stays linear. */
export function toCc7(v: number): number {
  const clamped = v < 0 ? 0 : v > 1 ? 1 : v;
  return Math.round(clamped * 127);
}

/**
 * Apply a bus volume (0..1, plus an independent mute) to every channel in a
 * group via CC7. `when` (backend-clock seconds) schedules the ramp at the
 * right time; omitted = apply immediately (schedules "now" from the synth's
 * point of view).
 */
export function applyBusVolume(
  synth: ChannelVolumeTarget,
  channels: readonly number[],
  volume: number,
  muted: boolean,
  when?: number,
): void {
  const cc7 = toCc7(muted ? 0 : volume);
  for (const ch of channels) synth.setChVol(ch, cc7, when);
}
