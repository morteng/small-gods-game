// src/game/causal-site-view.ts
//
// W-I-d — the presentation view for a selected CAUSAL SITE. Maps the sim-pure
// `CausalSite` (no display concerns) to the small payload the WebGPU site card
// renders (name, attribution, intensity, fade status). Pure + testable: the only
// outside data it needs is the spirits map (to name the cause).

import type { CausalSite } from '@/world/causal-site';
import type { Spirit, SpiritId } from '@/core/spirit';

/** What the WebGPU site card (`UiRuntime.drawSiteCard`) needs to draw. */
export interface SiteCardView {
  /** Generated place name, e.g. "The Drowned Reach of Ironvein". */
  name: string;
  /** Attribution line, e.g. "By your hand" / "A work of nature" / "By Khoth". */
  subtitle: string;
  /** Strength 0..1 (drives the intensity bar). */
  intensity: number;
  /** Lifecycle line, e.g. "Standing water" or "Fading — 12s left". */
  status: string;
}

export function causalSiteCardView(site: CausalSite, spirits: Map<SpiritId, Spirit>): SiteCardView {
  const subtitle =
    site.cause === 'player' ? 'By your hand'
    : site.cause === 'nature' ? 'A work of nature'
    : `By ${spirits.get(site.cause as SpiritId)?.name ?? 'a rival god'}`;

  // ageTicks counts time the CAUSE has been gone; 0 while the flood still covers it.
  const fading = site.ageTicks > 0;
  const remaining = Math.max(0, site.lifeTicks - site.ageTicks);
  // The weather tick is 1 Hz, so a tick reads as a second to the player.
  const status = fading ? `Fading — ${remaining}s left` : 'Standing water';

  return {
    name: site.name,
    subtitle,
    intensity: Math.max(0, Math.min(1, site.intensity)),
    status,
  };
}
