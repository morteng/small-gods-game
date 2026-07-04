// src/ui/boot-progress.ts
//
// Maps the stream of worldgen/bootstrap progress messages onto the loading
// bar's [start..cap] band. Worldgen emits ~30 phase announcements but their
// count varies by world (roads/walls/stairs are conditional), so the fraction
// advances asymptotically: every message moves the bar forward, it never
// reaches the cap early, and it never moves backwards.
//
// Phase announcements end in '...' ("Carving rivers..."); stat lines don't
// ("Trampled 136 tiles") and stay in the console — the shipped overlay shows
// only the clean phase labels (user preference: no dev clutter).

export interface BootProgressMapper {
  /** Feed one progress message; returns the update for the bar, or null to skip. */
  next(message: string): { fraction: number; label: string } | null;
}

/**
 * `start`..`cap` is the bar band this mapper owns; `expectedSteps` tunes how
 * fast the asymptote approaches the cap (at `expectedSteps` messages the bar
 * sits ~63% of the way through the band).
 */
export function createBootProgressMapper(
  start: number,
  cap: number,
  expectedSteps = 25,
): BootProgressMapper {
  let n = 0;
  return {
    next(message: string) {
      if (!message.endsWith('...') && !message.endsWith('…')) return null; // stat line → console only
      n++;
      const fraction = start + (cap - start) * (1 - Math.exp(-n / expectedSteps));
      const label = message.replace(/(\.\.\.|…)$/, '') + '…';
      return { fraction, label };
    },
  };
}
