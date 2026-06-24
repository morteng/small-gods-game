/**
 * Earthworks + siting — the genuinely-new capability defensive constructions add to
 * the connectome: terrain as a connectome OUTPUT (motte/ditch/rampart deformations of
 * the world heightfield) and a SITING front-end that decides where a defended complex
 * sits before it decides what to build.
 *
 * Two realism invariants live here, both as pure deterministic math:
 *
 *   1. Siting is a weighted tradeoff, not a hill-search. `siteSelect` scores each
 *      candidate by  w_strat·strategicValue + w_def·defensiveAffordance − w_cost·buildCost.
 *      A natural hill wins on low cost; a flat spot by a ford wins on strategic value
 *      and you pay to haul the earth. Both of the user's cases fall out of one formula.
 *
 *   2. Conservation of spoil. `deriveEarthworks` sizes the ditch so its cut volume
 *      balances the fill it feeds (motte deficit + rampart) — the earth comes from
 *      somewhere, so ditch depth and mound height co-vary instead of being free knobs.
 *
 * CONTENT-FREE (engine-purity guard): no building/material/pack ids. The affordance
 * keys it reads off a `TerrainProbe` ('height'|'water'|…) are an engine-side affordance
 * protocol, the terrain analogue of the 'smoke-egress' requirement token.
 */
import { createRng } from '@/core/rng';
import type { TerrainProbe } from './types';

// ── Earthwork: a terrain-deformation primitive the world heightfield composites ──

export type EarthworkKind = 'motte' | 'ditch' | 'rampart' | (string & {});

/** An annular band (ditch/rampart ring): mean radius `r`, cross-section `width`. */
export interface Ring {
  cx: number;
  cy: number;
  r: number;
  width: number;
}

/**
 * One deformation of the world heightfield. `volume` is the signed earth moved
 * (+ fill, − cut) — the quantity the spoil-conservation invariant balances.
 */
export interface Earthwork {
  kind: EarthworkKind;
  /** Flat-topped cone (motte): centred uplift. */
  centre?: { x: number; y: number };
  topRadius?: number;
  /** Annular band (ditch/rampart). */
  ring?: Ring;
  /** Signed change to ground height (+ up, − down) at the deformation's core. */
  height: number;
  /** Batter: horizontal run per unit vertical rise on the sloped sides. */
  slope?: number;
  /** Signed earth volume moved (+ fill, − cut). */
  volume: number;
}

const PI = Math.PI;

/** Volume of a flat-topped cone (frustum): top radius `topR`, vertical `height`, batter `slope`. */
export function frustumVolume(topR: number, height: number, slope: number): number {
  const h = Math.abs(height);
  const baseR = topR + slope * h;
  return (PI * h) / 3 * (topR * topR + topR * baseR + baseR * baseR);
}

/** Volume of an annular band of mean radius `r`, cross-section `width` × `depth`. */
export function ringVolume(r: number, width: number, depth: number): number {
  return 2 * PI * r * width * Math.abs(depth);
}

// ── Siting: where a defended complex sits, before deciding what to build ──────────

export interface SiteCandidate {
  x: number;
  y: number;
}

/**
 * The defensive affordances a site naturally supplies, each normalised 0..1 (except
 * raw `height`, in world units). Read off the terrain probe; missing keys default 0.
 */
export interface Affordance {
  height: number; // terrain elevation at the site (world units)
  steepFlanks: number; // fraction of the approach naturally protected (cliffs/scarps)
  water: number; // adjacency to water (a wet moat for free)
  commanding: number; // relative elevation over the surroundings (view / fields of fire)
  approachControl: number; // a single natural choke approach (funnels attackers to the gate)
}

const AFFORDANCE_KEYS: (keyof Affordance)[] = [
  'height',
  'steepFlanks',
  'water',
  'commanding',
  'approachControl',
];

/** Pull the engine affordance protocol fields off a probe record (numeric, default 0). */
export function readAffordance(probe: TerrainProbe, x: number, y: number): Affordance {
  const raw = probe.affordanceAt(x, y) ?? {};
  const out = {} as Affordance;
  for (const k of AFFORDANCE_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    out[k] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
  return out;
}

/** What the complex is FOR — sets the siting weights and supplies the target to control. */
export interface SiteIntent {
  purpose?: string; // 'subdue-town' | 'hold-ford' | 'refuge' | 'temporary' | …
  target?: { x: number; y: number }; // the point to control (ford, road, town)
  desiredHeight: number; // the motte height the design wants (world units)
}

/** The three siting terms' relative pull. */
export interface SiteWeights {
  strat: number;
  def: number;
  cost: number;
}

export interface SiteScore {
  site: SiteCandidate;
  affordance: Affordance;
  strategicValue: number; // 0..1 — how well it controls the target
  defensiveAffordance: number; // 0..1 — natural defence the site gives
  buildCost: number; // 0..1 — earth to haul (0 = the hill gives it all, 1 = flat)
  score: number;
}

// Sub-weights for the five affordance components (sum to 1) — engine defaults; a pack
// or caller can override by pre-weighting the probe, so these stay content-free.
const DEF_SUBWEIGHTS: Record<keyof Affordance, number> = {
  height: 0.30,
  steepFlanks: 0.25,
  water: 0.15,
  commanding: 0.20,
  approachControl: 0.10,
};

function defensiveAffordance(a: Affordance, desiredHeight: number): number {
  const heightFactor = desiredHeight > 0 ? clamp01(a.height / desiredHeight) : 0;
  return (
    DEF_SUBWEIGHTS.height * heightFactor +
    DEF_SUBWEIGHTS.steepFlanks * clamp01(a.steepFlanks) +
    DEF_SUBWEIGHTS.water * clamp01(a.water) +
    DEF_SUBWEIGHTS.commanding * clamp01(a.commanding) +
    DEF_SUBWEIGHTS.approachControl * clamp01(a.approachControl)
  );
}

/** Build cost as a 0..1 deficit: how much of the wanted height the site does NOT give. */
function buildCost(a: Affordance, desiredHeight: number): number {
  if (desiredHeight <= 0) return 0;
  const deficit = Math.max(0, desiredHeight - a.height);
  return clamp01(deficit / desiredHeight);
}

/** Strategic value: closer to the target = higher (0 when there is no target). */
function strategicValue(site: SiteCandidate, intent: SiteIntent): number {
  if (!intent.target) return 0;
  const dx = site.x - intent.target.x;
  const dy = site.y - intent.target.y;
  const dist = Math.hypot(dx, dy);
  return 1 / (1 + dist);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Score one candidate. Pure. */
export function scoreSite(
  site: SiteCandidate,
  intent: SiteIntent,
  weights: SiteWeights,
  probe: TerrainProbe,
): SiteScore {
  const affordance = readAffordance(probe, site.x, site.y);
  const sv = strategicValue(site, intent);
  const da = defensiveAffordance(affordance, intent.desiredHeight);
  const bc = buildCost(affordance, intent.desiredHeight);
  const score = weights.strat * sv + weights.def * da - weights.cost * bc;
  return { site, affordance, strategicValue: sv, defensiveAffordance: da, buildCost: bc, score };
}

/**
 * Pick the best site by the weighted 3-term score. Deterministic: ties (within a small
 * epsilon) are broken by a seeded coin, so the choice is stable but not biased toward
 * candidate order. Returns null if there are no candidates.
 */
export function siteSelect(
  candidates: SiteCandidate[],
  intent: SiteIntent,
  weights: SiteWeights,
  probe: TerrainProbe,
  seed = 0,
): SiteScore | null {
  if (!candidates.length) return null;
  const scored = candidates.map((c) => scoreSite(c, intent, weights, probe));
  const rng = createRng(seed);
  const EPS = 1e-9;
  let best = scored[0];
  for (let i = 1; i < scored.length; i++) {
    const s = scored[i];
    if (s.score > best.score + EPS) best = s;
    else if (Math.abs(s.score - best.score) <= EPS && rng.next() < 0.5) best = s;
  }
  return best;
}

// ── Earthwork derivation: build only the gap the site doesn't already give ────────

export interface EarthworkSpec {
  /** Final flat-top height the motte should reach (world units). */
  motteHeight: number;
  /** Radius of the motte's flat top. */
  motteTopRadius: number;
  /** Batter (run per rise) of the motte / rampart sides. */
  slope: number;
  /** Enclosed ward radius the rampart rings. */
  baileyRadius: number;
  /** Rampart bank height + cross-section width. */
  rampartHeight: number;
  rampartWidth: number;
  /** Ditch cross-section width (depth is DERIVED to conserve spoil). */
  ditchWidth: number;
}

export interface EarthworksResult {
  earthworks: Earthwork[];
  /** Σ signed volume — ≈ 0 when spoil is conserved. */
  netVolume: number;
}

/**
 * Derive the earthworks for a defended complex at `site`, using the natural terrain
 * height so a hill means LESS mound. The ditch depth is sized so its cut balances the
 * fill (motte deficit + rampart): conservation of spoil by construction.
 */
export function deriveEarthworks(
  site: SiteCandidate,
  spec: EarthworkSpec,
  probe: TerrainProbe,
): EarthworksResult {
  const { height: natural } = readAffordance(probe, site.x, site.y);
  const earthworks: Earthwork[] = [];

  // 1. Motte — only the deficit the hill doesn't already provide.
  const motteDeficit = Math.max(0, spec.motteHeight - natural);
  let fill = 0;
  if (motteDeficit > 0) {
    const vol = frustumVolume(spec.motteTopRadius, motteDeficit, spec.slope);
    fill += vol;
    earthworks.push({
      kind: 'motte',
      centre: { x: site.x, y: site.y },
      topRadius: spec.motteTopRadius,
      height: motteDeficit,
      slope: spec.slope,
      volume: vol,
    });
  }

  // 2. Rampart — annular fill under the palisade.
  if (spec.rampartHeight > 0 && spec.rampartWidth > 0) {
    const vol = ringVolume(spec.baileyRadius, spec.rampartWidth, spec.rampartHeight);
    fill += vol;
    earthworks.push({
      kind: 'rampart',
      ring: { cx: site.x, cy: site.y, r: spec.baileyRadius, width: spec.rampartWidth },
      height: spec.rampartHeight,
      slope: spec.slope,
      volume: vol,
    });
  }

  // 3. Ditch — annular cut JUST outside the rampart, depth derived so cut == fill.
  if (fill > 0 && spec.ditchWidth > 0) {
    const ditchR = spec.baileyRadius + spec.rampartWidth / 2 + spec.ditchWidth / 2;
    const depth = fill / (2 * PI * ditchR * spec.ditchWidth);
    earthworks.push({
      kind: 'ditch',
      ring: { cx: site.x, cy: site.y, r: ditchR, width: spec.ditchWidth },
      height: -depth,
      volume: -fill,
    });
  }

  const netVolume = earthworks.reduce((s, e) => s + e.volume, 0);
  return { earthworks, netVolume };
}
