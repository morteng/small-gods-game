// src/world/site-fitness.ts
//
// The Tier-2 situational-fitness substrate (building-validity epic S3). Tier-1 (intrinsic
// validity) coerces a blueprint to self-consistency at resolve time; Tier-2 SCORES a
// resolved building against the WORLD at placement time — sun, weather, view, defence —
// and prefers the best-scoring site/orientation. This module is the shared, world-free
// scoring core; S5 wires it into site selection and adds the view/prominence/defence terms.
//
// Two pieces:
//   1. The GENERALIZED ALIGNMENT primitive — `alignmentScore(facing, target)`. Sun
//      orientation is alignment of a building's sun-facing frontage with the sun bearing;
//      the shrine procession's "axis-mundi" is alignment of a spire/aperture with a
//      celestial azimuth (solstice sunrise). Same maths, different target — so the shrine
//      epic consumes this exact primitive rather than reinventing it.
//   2. A composable weighted SITE-FITNESS scorer — `scoreSite(terms)` — a normalised
//      weighted mean of 0..1 desirability terms. S3 supplies the sun term; S5 adds
//      view / prominence / defensibility / opulence terms to the same composer.
//
// Pure and domain-free (no world/render/connectome imports): callable from world placement
// AND, via a precomputed affordance field, from the connectome's siting front end.

/**
 * Canonical world sun bearing — the equator-ward direction a building's living frontage
 * (door + main windows) or a shrine's solar aperture prefers to face for light. Tile space,
 * unit vector. A frontage facing SUN_BEARING is sunlit; one facing away sits in shadow.
 *
 * A single hemisphere for now (south, `+y` = down-screen, the medieval-Europe sun side);
 * kept one constant so siting is deterministic. World-style / latitude may vary it later
 * (a southern-hemisphere or equatorial world would tilt this) — callers pass an explicit
 * bearing to override.
 */
export const SUN_BEARING: readonly [number, number] = [0, 1];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Alignment of a `facing` direction with a `target` direction, remapped from the dot
 * product to `0..1`: **1** = facing straight at the target, **0.5** = perpendicular,
 * **0** = facing directly away. Both vectors are normalised defensively; a zero-length
 * input (e.g. flat-ground aspect, an undefined facing) yields the neutral **0.5**.
 *
 * The generalized alignment constraint: sun orientation (frontage vs sun bearing) and the
 * shrine axis-mundi (aperture vs celestial azimuth) are both this function.
 */
export function alignmentScore(
  fx: number, fy: number,
  tx: number, ty: number,
): number {
  const fm = Math.hypot(fx, fy);
  const tm = Math.hypot(tx, ty);
  if (fm === 0 || tm === 0) return 0.5; // no direction → neutral
  const dot = (fx * fm ** -1) * (tx * tm ** -1) + (fy * fm ** -1) * (ty * tm ** -1);
  return clamp01((dot + 1) / 2);
}

/**
 * How sunlit a frontage facing `(sx,sy)` is — alignment of the frontage with the sun
 * bearing. 1 when the frontage looks straight at the sun, 0 when it faces away.
 */
export function sunFrontageScore(
  sx: number, sy: number,
  bearing: readonly [number, number] = SUN_BEARING,
): number {
  return alignmentScore(sx, sy, bearing[0], bearing[1]);
}

/**
 * How sunny a SITE is from its terrain aspect — a sun-facing slope is a warm, bright spot;
 * a slope falling away from the sun is cold and shadowed. `(aspectX,aspectY)` is the
 * downhill aspect (from the terrain affordance layer, S4); `slope` 0..1 weights the effect,
 * so FLAT ground is neutral (0.5 — no aspect advantage) and the bias grows with steepness.
 */
export function sunSiteScore(
  aspectX: number, aspectY: number, slope: number,
  bearing: readonly [number, number] = SUN_BEARING,
): number {
  const aligned = alignmentScore(aspectX, aspectY, bearing[0], bearing[1]);
  const s = clamp01(slope);
  return 0.5 + s * (aligned - 0.5);
}

/** One weighted desirability term feeding {@link scoreSite}. `score` is clamped to 0..1. */
export interface FitnessTerm {
  /** Diagnostic id (which criterion this is — 'sun', 'view', 'defence', …). */
  id: string;
  /** Relative pull of this term; non-negative. Terms with weight 0 drop out. */
  weight: number;
  /** This candidate's desirability for the term, 0 (poor) … 1 (ideal). */
  score: number;
}

/**
 * Multi-criteria site fitness — the normalised weighted mean of its terms' desirabilities,
 * in `0..1`. Generalises the settlement `frontageValue` gradient and the earthworks
 * `strat/def/cost` weighting into one composer every Tier-2 consumer shares. No terms (or
 * all-zero weights) → the neutral `0.5` (nothing to prefer), never NaN.
 */
export function scoreSite(terms: readonly FitnessTerm[]): number {
  let wsum = 0;
  let acc = 0;
  for (const t of terms) {
    if (t.weight <= 0) continue;
    wsum += t.weight;
    acc += t.weight * clamp01(t.score);
  }
  return wsum > 0 ? acc / wsum : 0.5;
}
