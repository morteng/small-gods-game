// Bridge presets — a whole bridge (deck + piers/arches + parapet + abutments) assembled as ONE
// parametric prop blueprint, the same way a building preset is one blueprint. The live crossing
// pipeline still spawns deck/pier/arch as SEPARATE world entities (assembled in world-space); THIS
// module is the single-object form so the studio, the reference-library dev loop, and any
// synthesizeBlueprint('bridge-*') caller all build the identical massing from one source of truth.
//
// Coordinates are in tiles inside the footprint; the long (span) axis is +x (ew, yaw 0). Deck
// centres itself in its box; a pier's `at` is its foot corner (center = at + 0.5); an arch's `at`
// is its springing origin (springs +x for span, depth +y for thickness).
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';
import { METRES_PER_TILE } from '@/render/scale-contract';
import { createRng, type Rng } from '@/core/rng';

const M = METRES_PER_TILE; // 2 m per tile

export type BridgePart = NonNullable<Blueprint['parts']>[string];

/** A bridge recipe: geometry (`build`) + its material + a human blurb. `ttiSubject` is the
 *  geometry-true text-to-image clause the reference-library probe uses (dev-only prose).
 *
 *  `build(seed?)` — the low (roundwood) rungs accept an optional VARIATION seed ("variety is
 *  the spice"): it runs through the repo's seeded sfc32 (never Math.random) and modulates log
 *  girth/taper/askew/spacing/stub placement/rail style within tasteful bounds. Every recipe's
 *  DEFAULT (seed omitted ⇒ 0) is a deterministic canonical build — tests pin that default; the
 *  masonry tiers ignore the seed entirely. */
export interface BridgeRecipe {
  desc: string;
  walls: string;
  ttiSubject?: string;
  build(seed?: number): Record<string, BridgePart>;
}

/** Uniform in [lo, hi] off the recipe's seeded rng. */
const between = (rng: Rng, lo: number, hi: number): number => lo + rng.next() * (hi - lo);

/** ±1 with equal probability — an askew direction pick. */
const sign = (rng: Rng): number => (rng.next() < 0.5 ? -1 : 1);

/** Two HUMBLE seat blocks — a low rough stone block per bank (the log-tier grounding: NOT
 *  `addAbutments`, whose deck-width+1 m battered mass is far too grand for a log). Mutates
 *  `parts`; emits exactly the 2 abutment-type parts the preset invariant requires. */
function addSeatBlocks(
  parts: Record<string, BridgePart>, xLo: number, xHi: number, cyT: number, seatHM: number, widthM = 1.0,
): void {
  for (const [key, cxT] of [['abut0', xLo], ['abut1', xHi]] as const) {
    parts[key] = {
      type: 'abutment', material: 'stone', at: { x: cxT - 0.5, y: cyT - 0.5 }, size: { w: 1, h: 1 },
      params: { heightM: seatHM, widthM, depthM: 0.7, batter: 0.12, dir: 'ew' },
    };
  }
}

/** Masonry ring-depth above the intrados crown, in metres — a proud archivolt (matches
 *  crossing-structures.ts ARCH_RING_M). The arch's spandrel is solid to `riseM + ARCH_RING_M`, so a
 *  deck sat at that height rides the crown with no gap. */
export const ARCH_RING_M = 0.9;

/** Add a battered masonry end-block at each end of an ew span (x = xLo..xHi, centred on cy tiles),
 *  from the datum up to `topM` (the deck underside), wider than the deck. Mutates `parts`. */
export function addAbutments(
  parts: Record<string, BridgePart>, xLo: number, xHi: number, cyT: number, roadTiles: number, topM: number,
): void {
  const abutWidthM = roadTiles * M + 1.0, abutDepthT = 0.75;
  const boxW = Math.max(1, Math.ceil(abutDepthT)), boxH = Math.max(1, Math.ceil(abutWidthM / M));
  for (const [key, cxT] of [['abut0', xLo], ['abut1', xHi]] as const) {
    parts[key] = {
      // Footings are ALWAYS dressed stone — even a timber bridge lands on masonry blocks (they take
      // the water and the deck load; bare timber piles would rot). On a stone bridge this is a no-op.
      type: 'abutment', material: 'stone', at: { x: cxT - boxW / 2, y: cyT - boxH / 2 }, size: { w: boxW, h: boxH },
      params: { heightM: topM, widthM: abutWidthM, depthM: abutDepthT * M, batter: 0.2, dir: 'ew' },
    };
  }
}

/** Assemble a straight ew filled-spandrel arch bridge as ONE object: N abutting arch bays form
 *  a solid spandrel wall punched with openings, and a parapeted, optionally hump-backed deck
 *  RIDES ON the arch crowns (baseZM = crown height) instead of plugging them. spanTiles = clear
 *  length; bays = arch count. The masonry between adjacent openings is the pier — no separate
 *  pier parts (they'd be buried in the spandrel). */
export function archBridge(opts: {
  spanTiles: number; roadTiles: number; bays: number; riseM: number;
  style: 'round' | 'segmental' | 'pointed'; parapet: 'none' | 'both' | 'rails'; camberM: number;
  /** Multi-bay TIMBER composition (the two-rib TTI reference): one hump-backed deck PER bay
   *  (camber returns to 0 at each bay joint, so the deck seats on the structure instead of
   *  floating over the mid-span cusp) and a stout pier at each joint. Masonry keeps the single
   *  continuous deck — a stone viaduct has one road profile, not a hump per arch. */
  perBayHump?: boolean;
}): Record<string, BridgePart> {
  const { spanTiles, roadTiles, bays, riseM, style, parapet, camberM, perBayHump } = opts;
  const bay = spanTiles / bays;
  const y0 = 1;                       // deck/arch band starts 1 tile in (montage breathing room)
  const deckBaseZM = riseM + ARCH_RING_M;   // deck underside sits on the arch crown
  const parts: Record<string, BridgePart> = {};
  if (perBayHump && bays >= 2) {
    for (let i = 0; i < bays; i++) {
      parts[i === 0 ? 'deck' : `deck${i + 1}`] = {
        type: 'deck', at: { x: 0.5 + i * bay, y: y0 }, size: { w: Math.ceil(bay), h: roadTiles },
        params: { lengthM: bay * M, widthM: roadTiles * M, thicknessM: 0.6, dir: 'ew',
          parapet, baseZM: deckBaseZM, camberM },
      };
    }
    for (let j = 1; j < bays; j++) {   // a stout pier lands each bay joint
      const pw = 0.7, pt = pw / M;
      parts[`jointpier${j}`] = {
        type: 'pier', at: { x: 0.5 + j * bay - pt / 2, y: y0 + roadTiles / 2 - pt / 2 }, size: { w: 1, h: 1 },
        params: { heightM: deckBaseZM, widthM: pw, batter: 0 },
      };
    }
  } else {
    parts.deck = {
      type: 'deck', at: { x: 0.5, y: y0 }, size: { w: spanTiles, h: roadTiles },
      params: { lengthM: spanTiles * M, widthM: roadTiles * M, thicknessM: 0.6, dir: 'ew',
        parapet, baseZM: deckBaseZM, camberM },
    };
  }
  // Masonry multi-bay: adjacent openings must NOT abut edge-to-edge — that leaves only the
  // thin cusp between two arcs as the "pier", vanishing to nothing at the springing line with
  // no mass at the waterline. Real practice (and the bridge-stone-arch TTI reference): a stout
  // battered pier stands between the openings on a flared plinth footing. The timber perBayHump
  // path keeps the historic abutting layout (its joints get their own stout round piers).
  const roadM = roadTiles * M;
  const pierM = !perBayHump && bays >= 2 ? Math.max(1.2, roadM * 0.35) : 0;
  const openM = (spanTiles * M - (bays - 1) * pierM) / bays;
  for (let i = 0; i < bays; i++) {
    parts[`arch${i + 1}`] = {
      type: 'arch_span', at: { x: 0.5 + (i * (openM + pierM)) / M, y: y0 }, size: { w: Math.ceil(openM / M), h: roadTiles },
      params: { spanM: openM, riseM, thicknessM: roadM, dir: 'ew', style, ringDepthM: ARCH_RING_M },
    };
  }
  for (let j = 1; j < bays && pierM > 0; j++) {
    const cxT = 0.5 + (j * openM + (j - 0.5) * pierM) / M;
    const cyT = y0 + roadTiles / 2;
    // Battered pier shaft, bed → deck underside, proud of the spandrel faces; the reference's
    // pier mass. The stepped-batter abutment stack IS the flared foot.
    parts[`pier${j}`] = {
      type: 'abutment', at: { x: cxT - 0.5, y: cyT - 0.5 }, size: { w: 1, h: 1 },
      params: { heightM: deckBaseZM, widthM: roadM + 0.7, depthM: pierM, batter: 0.18, dir: 'ew' },
    };
    // Distinct plinth footing at the waterline, a step wider than the shaft all round.
    parts[`plinth${j}`] = {
      type: 'abutment', at: { x: cxT - 0.5, y: cyT - 0.5 }, size: { w: 1, h: 1 },
      params: { heightM: 0.55, widthM: roadM + 1.5, depthM: pierM + 0.8, batter: 0.2, dir: 'ew' },
    };
  }
  addAbutments(parts, 0.5, 0.5 + spanTiles, y0 + roadTiles / 2, roadTiles, deckBaseZM);
  return parts;
}

/** The buildable bridge library, keyed by SHORT name (the canonical preset is `bridge-<short>`
 *  and the reference-library slug is the same). Diagnostics-only recipes live in the dev script. */
export const BRIDGE_RECIPES: Record<string, BridgeRecipe> = {
  // Tier-0 log crossing (road-wear economy S0 redux): ONE round trunk levered across the
  // stream — a real roundwood member (bark-round flanks, end-grain ends, natural taper), NOT
  // a squared plank. A subtle adze-hewn flat on the crown makes it walkable; 1–3 trimmed
  // branch stubs at seeded stations sell "felled tree", per the crossing-log TTI reference.
  // Slightly askew and pitched (seeded, sfc32) — a farmer levered it in, no engineer set it
  // out. Grounding = two humble stone seat blocks only (the preset invariant's 2 abutments).
  'log': {
    desc: 'log crossing (ONE round trunk, hewn-flat top, branch stubs, stone seat blocks)',
    walls: 'timber',
    ttiSubject: 'a humble log crossing over a small stream, ONE generous round tree trunk laid ' +
      'slightly askew from bank to bank, visible growth-ring end grain on the cut ends, a few ' +
      'short trimmed branch stubs along it, a lighter adze-hewn flat strip along the top, no ' +
      'handrails, each end resting on a low rough stone block; weathered grey-brown bark',
    build: (seed = 0) => {
      const rng = createRng(seed);
      const spanTiles = 3, y0 = 1;             // a stream, not a river: ~6 m bank to bank
      const cx = 0.5 + spanTiles / 2, cy = y0 + 0.5;
      const r = between(rng, 0.34, 0.42);      // a GENEROUS trunk (~0.7–0.85 m diameter)
      const seatH = 0.5;
      const logZ = seatH + r;                  // the trunk RESTS on its seats (axis height)
      const yawDeg = sign(rng) * between(rng, 1.2, 4);
      const parts: Record<string, BridgePart> = {
        log: {
          type: 'log', at: { x: 0.5, y: y0 }, size: { w: spanTiles, h: 1 },
          params: {
            lengthM: spanTiles * M + between(rng, 0.6, 1.1),   // overhangs the banks
            radiusM: r, tipRadiusM: r * between(rng, 0.78, 0.9),
            baseZM: logZ, yawDeg, pitchDeg: between(rng, -1.6, 1.6),
            flatDepthM: r * 0.35,
          },
        },
      };
      // Trimmed branch stubs: short roundwood jutting up-and-out from the trunk's upper flank
      // at seeded stations (clear of the ends, so they never collide with the seats).
      const nStubs = 1 + rng.nextInt(3);
      const yawRad = (yawDeg * Math.PI) / 180;
      for (let i = 0; i < nStubs; i++) {
        const uT = between(rng, -0.55, 0.55) * (spanTiles / 2);   // station along the axis, tiles
        const sx = cx + uT * Math.cos(yawRad), sy = cy + uT * Math.sin(yawRad);
        parts[`stub${i + 1}`] = {
          type: 'log', at: { x: sx - 0.5, y: sy - 0.5 }, size: { w: 1, h: 1 },
          params: {
            lengthM: between(rng, 0.55, 0.95), radiusM: r * between(rng, 0.28, 0.36),
            baseZM: logZ + r * 0.45,
            yawDeg: yawDeg + sign(rng) * between(rng, 55, 105),
            pitchDeg: between(rng, 18, 42),
          },
        };
      }
      addSeatBlocks(parts, 0.5, 0.5 + spanTiles, cy, seatH, 1.1);
      return parts;
    },
  },
  // Tier-1 twin-log crossing: TWO round logs laid side by side — different girths, slightly
  // opposed yaws (each levered in on its own day), hewn flats on both — reading as a narrow
  // rustic two-log tread, with a pair of short round pier posts standing in the stream under
  // the mid-span (end grain up), per the crossing-twin-log TTI reference.
  'twin-log': {
    desc: 'twin-log crossing (two round logs side by side, differing girth, mid pier posts)',
    walls: 'timber',
    ttiSubject: 'a rustic twin-log crossing over a stream, TWO round tree-trunk logs of ' +
      'clearly different thickness laid side by side from bank to bank, visible growth-ring ' +
      'end grain, lighter adze-hewn flat strips along their tops, a pair of short round ' +
      'timber pier posts standing in the water under the middle, no handrails, the ends ' +
      'resting on low rough stone blocks; weathered grey-brown bark',
    build: (seed = 0) => {
      const rng = createRng(seed);
      const spanTiles = 3, y0 = 1, cy = y0 + 0.5;
      const r1 = between(rng, 0.19, 0.25), r2 = between(rng, 0.13, 0.18);   // differing girth
      const seatH = 0.45;
      const sepT = (r1 + r2 + between(rng, 0.05, 0.12)) / M;   // centre separation, tiles
      const parts: Record<string, BridgePart> = {};
      const logs = [
        { key: 'log', r: r1, off: -sepT / 2, yaw: between(rng, 0.6, 2.4) },
        { key: 'log2', r: r2, off: sepT / 2, yaw: -between(rng, 0.6, 2.4) },   // opposed
      ];
      for (const L of logs) {
        parts[L.key] = {
          type: 'log', at: { x: 0.5, y: cy + L.off - 0.5 }, size: { w: spanTiles, h: 1 },
          params: {
            lengthM: spanTiles * M + between(rng, 0.5, 0.9),
            radiusM: L.r, tipRadiusM: L.r * between(rng, 0.8, 0.9),
            baseZM: seatH + L.r, yawDeg: L.yaw, flatDepthM: L.r * 0.32,
          },
        };
      }
      // The mid-stream pier pair: short verticals (±90° pitch ⇒ end grain up), feet in the
      // water below the datum, tops tucked under each log.
      const px = 0.5 + spanTiles * between(rng, 0.45, 0.55);
      for (const [key, L] of [['post1', logs[0]], ['post2', logs[1]]] as const) {
        const len = 1.2;
        parts[key] = {
          type: 'log', at: { x: px - 0.5, y: cy + L.off - 0.5 }, size: { w: 1, h: 1 },
          params: {
            lengthM: len, radiusM: 0.08,
            baseZM: seatH - len / 2,               // top at the log underside, foot in the bed
            pitchDeg: 90 + between(rng, -6, 6),
          },
        };
      }
      addSeatBlocks(parts, 0.5, 0.5 + spanTiles, cy, seatH, 1.2);
      return parts;
    },
  },
  // Tier-2 log-rail: the twin-log tread grows its FIRST safety affordance — a single-side
  // handrail of roundwood: 2–3 round posts (run down into the water as piers, end grain up),
  // ONE thin rail pole (sometimes a second, lower one), and a lashing collar where each post
  // carries the pole — the post/lashing/pole language of the crossing-log-rail TTI reference.
  'log-rail': {
    desc: 'log-rail crossing (twin logs + single-side roundwood handrail: posts, lashings, rail pole)',
    walls: 'timber',
    ttiSubject: 'a rustic twin-log stream crossing with a simple handrail on ONE side only, ' +
      'two round logs side by side as the tread, round timber posts with visible end grain ' +
      'standing down into the water, a single thin roundwood rail pole lashed to the post ' +
      'tops with rope bands, ends resting on low rough stone blocks; weathered brown wood',
    build: (seed = 0) => {
      const rng = createRng(seed);
      const spanTiles = 3, y0 = 1, cy = y0 + 0.5;
      const r1 = between(rng, 0.19, 0.23), r2 = between(rng, 0.15, 0.18);
      const seatH = 0.45;
      const sepT = (r1 + r2 + between(rng, 0.04, 0.1)) / M;
      const parts: Record<string, BridgePart> = {};
      for (const L of [
        { key: 'log', r: r1, off: -sepT / 2, yaw: between(rng, 0.5, 1.8) },
        { key: 'log2', r: r2, off: sepT / 2, yaw: -between(rng, 0.5, 1.8) },
      ]) {
        parts[L.key] = {
          type: 'log', at: { x: 0.5, y: cy + L.off - 0.5 }, size: { w: spanTiles, h: 1 },
          params: {
            lengthM: spanTiles * M + between(rng, 0.5, 0.8),
            radiusM: L.r, tipRadiusM: L.r * between(rng, 0.82, 0.9),
            baseZM: seatH + L.r, yawDeg: L.yaw, flatDepthM: L.r * 0.32,
          },
        };
      }
      // The single-side rail: posts on the NEAR edge only (spec §10 — one simple handrail).
      const postR = 0.055;
      const postY = cy - (sepT / 2 + (r1 + postR) / M + 0.03);
      const railZ = seatH + r1 * 2 + 0.75;         // pole axis ~0.75 m over the tread
      const nPosts = rng.next() < 0.45 ? 3 : 2;
      const postLen = 1.7;
      for (let k = 0; k < nPosts; k++) {
        const t = nPosts === 2 ? 0.16 + 0.68 * k : 0.12 + 0.38 * k;
        const px = 0.5 + spanTiles * t;
        parts[`post${k + 1}`] = {
          type: 'log', at: { x: px - 0.5, y: postY - 0.5 }, size: { w: 1, h: 1 },
          params: {
            lengthM: postLen, radiusM: postR,
            baseZM: railZ + 0.12 - postLen / 2,    // head proud of the pole, foot in the water
            pitchDeg: 90 + between(rng, -5, 5),
          },
        };
        // The lashing collar: a short coaxial sleeve around the post at pole height.
        parts[`lash${k + 1}`] = {
          type: 'log', at: { x: px - 0.5, y: postY - 0.5 }, size: { w: 1, h: 1 },
          params: { lengthM: 0.14, radiusM: postR + 0.025, baseZM: railZ, pitchDeg: 90 },
        };
      }
      parts.rail = {
        type: 'log', at: { x: 0.5, y: postY - 0.5 }, size: { w: spanTiles, h: 1 },
        params: {
          lengthM: spanTiles * M + 0.4, radiusM: 0.035, baseZM: railZ,
          yawDeg: between(rng, -0.8, 0.8),
        },
      };
      if (rng.next() < 0.4) {                      // rail style variation: a second, lower pole
        parts.rail2 = {
          type: 'log', at: { x: 0.5, y: postY - 0.5 }, size: { w: spanTiles, h: 1 },
          params: { lengthM: spanTiles * M + 0.3, radiusM: 0.03, baseZM: railZ - 0.42, yawDeg: between(rng, -0.8, 0.8) },
        };
      }
      addSeatBlocks(parts, 0.5, 0.5 + spanTiles, cy, seatH, 1.2);
      return parts;
    },
  },
  // Tier-3 plank walk: the first SAWN timber — a plank tread over two round log stringers,
  // carried mid-stream by a light A-FRAME trestle bent (raked roundwood legs + a crossbar)
  // standing in the water, the ends resting on low squared TIMBER sills. NO stone, NO heavy
  // driven piles — the crossing-plank-walk TTI reference's exact rung.
  'plank-walk': {
    desc: 'plank walk (sawn plank tread on log stringers, A-frame trestle bent, timber sills — no stone)',
    walls: 'timber',
    ttiSubject: 'a light wooden plank-walk footbridge over a stream, a flat sawn plank tread ' +
      'laid across two round log stringers, carried mid-stream by one light A-frame timber ' +
      'trestle bent standing in the water, the ends resting on low squared timber sills on ' +
      'the banks, no handrails, no stone anywhere; weathered brown wood',
    build: (seed = 0) => {
      const rng = createRng(seed);
      const spanTiles = 5, y0 = 1, cy = y0 + 0.5, cx = 0.5 + spanTiles / 2;
      const rStr = between(rng, 0.1, 0.13);        // the round log stringers
      const sillH = 0.8;
      const strZ = sillH + rStr;                   // stringer axis resting on the sills
      const sepT = between(rng, 0.34, 0.42);       // stringer separation (~0.7–0.85 m)
      const deckZ = strZ + rStr;                   // plank underside on the stringer crowns
      const plankW = between(rng, 1.15, 1.35);
      const parts: Record<string, BridgePart> = {
        tread: {
          type: 'deck', at: { x: 0.5, y: y0 }, size: { w: spanTiles, h: 1 },
          params: { lengthM: spanTiles * M, widthM: plankW, thicknessM: 0.07, dir: 'ew',
            parapet: 'none', baseZM: deckZ },
        },
      };
      for (const [key, s] of [['str1', -1], ['str2', 1]] as const) {
        parts[key] = {
          type: 'log', at: { x: 0.5, y: cy + s * sepT / 2 - 0.5 }, size: { w: spanTiles, h: 1 },
          params: {
            lengthM: spanTiles * M + 0.6, radiusM: rStr, baseZM: strZ,
            yawDeg: between(rng, -0.8, 0.8),
          },
        };
      }
      // The A-frame bent: two raked legs (bearing ACROSS the stream, opposed pitches — feet
      // spread in the water, tops converge under the deck) + a crossbar between them.
      const bx = cx + between(rng, -0.15, 0.15);
      const rake = between(rng, 64, 74);
      const legLen = (deckZ + 0.3) / Math.sin((rake * Math.PI) / 180);
      for (const [key, s] of [['leg1', 1], ['leg2', -1]] as const) {
        parts[key] = {
          type: 'log', at: { x: bx - 0.5, y: cy - 0.5 }, size: { w: 1, h: 1 },
          params: {
            lengthM: legLen, radiusM: 0.07, dir: 'ns',
            baseZM: (deckZ - 0.05 - 0.3) / 2,      // top under the stringers, foot in the bed
            pitchDeg: s * rake,
          },
        };
      }
      parts.bar = {
        type: 'log', at: { x: bx - 0.5, y: cy - 0.5 }, size: { w: 1, h: 1 },
        params: { lengthM: 0.95, radiusM: 0.045, dir: 'ns', baseZM: deckZ * 0.5 },
      };
      // Low squared TIMBER sills (no `material` ⇒ the recipe's timber walls) — the invariant's
      // two abutment parts, without a stone block anywhere on this rung.
      for (const [key, cxT] of [['abut0', 0.5], ['abut1', 0.5 + spanTiles]] as const) {
        parts[key] = {
          type: 'abutment', at: { x: cxT - 0.5, y: cy - 0.5 }, size: { w: 1, h: 1 },
          params: { heightM: sillH, widthM: plankW + 0.3, depthM: 0.45, batter: 0.04, dir: 'ew' },
        };
      }
      return parts;
    },
  },
  // Iconic medieval stone bridge: hump-backed, three segmental arches, cutwater piers, parapets.
  'stone-arch': {
    desc: 'dressed-stone 3-arch road bridge (filled spandrel, hump-backed, parapets)',
    walls: 'stone',
    ttiSubject: 'medieval dressed-stone road bridge with THREE segmental arches spanning a river, ' +
      'a gently hump-backed deck carried on a solid filled-spandrel wall, low stone parapets along ' +
      'both edges, and pointed cutwater piers between the arches; grey ashlar masonry',
    build: () => archBridge({ spanTiles: 12, roadTiles: 2, bays: 3, riseM: 3, style: 'segmental', parapet: 'both', camberM: 0.8 }),
  },
  // Timber arch footbridge — a graceful single-span wooden "moon" bridge: a strongly hump-backed
  // plank deck carried on one round timber arch, low post-and-rail parapets, landing on stone
  // footing blocks. The wooden analogue of the packhorse (single arch, one file wide), but timber.
  'timber-arch': {
    desc: 'timber arch footbridge (single hump-backed span, plank deck, post rails, stone footings)',
    walls: 'timber',
    ttiSubject: 'a graceful single-arch wooden footbridge over a stream, one gently curved timber ' +
      'arch carrying a strongly hump-backed plank deck, slender post-and-rail wooden parapets along ' +
      'both edges, landing on low grey stone footing blocks at each bank; weathered brown timber',
    build: () => archBridge({ spanTiles: 5, roadTiles: 1, bays: 1, riseM: 1.8, style: 'round', parapet: 'rails', camberM: 1.2 }),
  },
  // Timber beam bridge: the everyday small wooden crossing, and the ladder's SAWN-timber
  // boundary — everything square and framed where the rungs below are roundwood: two visible
  // square-sawn edge beams carry the plank deck, proper post-and-rail handrails ride both
  // edges, and the frame lands on dressed STONE footings. No arch, no piles in the water.
  'timber-beam': {
    desc: 'timber beam footbridge (framed: square edge beams under a plank deck, rails, stone footings)',
    walls: 'timber',
    ttiSubject: 'a small carpenter-framed wooden beam footbridge over a stream, a low flat ' +
      'plank deck carried on two visible heavy SQUARE-sawn timber edge beams, plain ' +
      'post-and-rail wooden handrails along both edges, resting on a dressed grey stone ' +
      'footing block at each bank, no arch and no piles in the water; weathered brown timber',
    build: () => {
      const spanTiles = 4, roadTiles = 1, y0 = 1, deckZ = 1.4;
      const beamW = 0.3, beamT = 0.4;                    // the square sawn members
      const beamOffT = (roadTiles * M / 2 - beamW / 2 - 0.06) / M;   // under the deck edges
      const parts: Record<string, BridgePart> = {
        deck: { type: 'deck', at: { x: 0.5, y: y0 }, size: { w: spanTiles, h: roadTiles }, params: { lengthM: spanTiles * M, widthM: roadTiles * M, thicknessM: 0.5, dir: 'ew', parapet: 'rails', baseZM: deckZ, camberM: 0.15 } },
      };
      for (const [key, s] of [['beam1', -1], ['beam2', 1]] as const) {
        parts[key] = {
          type: 'deck', at: { x: 0.5, y: y0 + roadTiles / 2 + s * beamOffT - 0.5 }, size: { w: spanTiles, h: 1 },
          params: { lengthM: spanTiles * M, widthM: beamW, thicknessM: beamT, dir: 'ew', parapet: 'none', baseZM: deckZ - beamT },
        };
      }
      addAbutments(parts, 0.5, 0.5 + spanTiles, y0 + roadTiles / 2, roadTiles, deckZ);
      return parts;
    },
  },
  // Timber trestle: a plank deck on BENTS — pile PAIRS at the deck edges whose chunky heads
  // stand proud of the deck, a cap beam across each bent under the deck. The single-centreline
  // stick-per-bent it replaced read as a dock on stilts (spindly, no visible structure).
  'timber-trestle': {
    desc: 'timber trestle footbridge (bents of paired piles, proud pile heads, cap beams, plank deck)',
    walls: 'timber',
    ttiSubject: 'medieval timber trestle footbridge, a flat plank deck carried on three bents, ' +
      'each bent a PAIR of stout driven timber piles at the deck edges with a heavy cap beam ' +
      'across under the deck, the square pile heads standing proud above the deck, no masonry ' +
      'and no arches, sitting low over the water; weathered brown wood',
    build: () => {
      const spanTiles = 8, roadTiles = 1, y0 = 1, pierH = 3;
      const deckT = 0.4, roadM = roadTiles * M;
      const parts: Record<string, BridgePart> = {
        // The plank deck RIDES ON the bents (baseZM = pier height), so the piles hang below
        // it like a real trestle rather than sticking up through it.
        deck: { type: 'deck', at: { x: 0.5, y: y0 }, size: { w: spanTiles, h: roadTiles }, params: { lengthM: spanTiles * M, widthM: roadM, thicknessM: deckT, dir: 'ew', parapet: 'none', baseZM: pierH } },
      };
      const pileW = 0.35, pileT = pileW / M;               // stout pile, in tiles
      const edgeOff = roadTiles / 2 - pileT / 2;           // pile centreline on the deck edge
      for (let i = 1; i <= 3; i++) {
        const bx = i * 2 + 0.5, cy = y0 + roadTiles / 2;   // bent centre (tiles)
        for (const [tag, s] of [['a', -1], ['b', 1]] as const) {
          parts[`pile${i}${tag}`] = {
            type: 'pier', at: { x: bx - pileT / 2, y: cy + s * edgeOff - pileT / 2 }, size: { w: 1, h: 1 },
            // Piles run bed → PROUD of the deck (head top ≈ deck top + 0.35 m), capped square.
            params: { heightM: pierH + deckT + 0.35, widthM: pileW, batter: 0, headM: 0.22 },
          };
        }
        // Cap beam: a thin ns "deck" slab across the bent, right under the deck planks.
        parts[`cap${i}`] = {
          type: 'deck', at: { x: bx - 0.5, y: cy - roadTiles / 2 - 0.15 }, size: { w: 1, h: roadTiles + 0.3 },
          params: { lengthM: roadM + 0.5, widthM: 0.35, thicknessM: 0.3, dir: 'ns', parapet: 'none', baseZM: pierH - 0.3 },
        };
      }
      addAbutments(parts, 0.5, 0.5 + spanTiles, y0 + roadTiles / 2, roadTiles, pierH);
      return parts;
    },
  },
  // Single-arch stone packhorse bridge over a brook — one span, no interior piers.
  'packhorse': {
    desc: 'single-arch stone packhorse bridge (no interior piers)',
    walls: 'stone',
    ttiSubject: 'narrow single-arch stone packhorse bridge over a brook, one round arch, a steep ' +
      'strongly hump-backed cobbled deck only a single file wide, low stone parapets, ' +
      'no interior piers; grey fieldstone',
    build: () => archBridge({ spanTiles: 5, roadTiles: 1, bays: 1, riseM: 2.5, style: 'round', parapet: 'both', camberM: 1.0 }),
  },
};

/** Assemble a recipe into a single `prop`-class Blueprint. `preset` carries the canonical
 *  `bridge-<short>` name so the resolved blueprint keeps a stable art-cache identity per bridge.
 *  `seed` (optional) is the low-rung VARIATION seed — omitted ⇒ the deterministic canonical
 *  build every cache key and golden pin sees. */
export function bridgeBlueprint(recipe: BridgeRecipe, presetName = 'bridge', seed?: number): Blueprint {
  const parts = recipe.build(seed);
  let maxX = 0, maxY = 0;
  for (const p of Object.values(parts)) {
    const at = p.at ?? { x: 0, y: 0 };
    maxX = Math.max(maxX, at.x + (p.size?.w ?? 1));
    maxY = Math.max(maxY, at.y + (p.size?.h ?? 1));
  }
  return {
    version: BLUEPRINT_VERSION, class: 'prop', preset: presetName, category: 'infrastructure',
    footprint: { w: Math.ceil(maxX) + 1, h: Math.ceil(maxY) + 1 },
    materials: { walls: recipe.walls, roof: recipe.walls, ground: 'dirt' },
    parts,
  };
}

/** The canonical selectable bridge preset names (`bridge-<short>`), e.g. for a studio picker. */
export function bridgePresetNames(): string[] {
  return Object.keys(BRIDGE_RECIPES).map((k) => `bridge-${k}`);
}

/** True for a canonical bridge preset name (`bridge-stone-arch`, …). */
export function isBridgePreset(name: string): boolean {
  return name.startsWith('bridge-') && Object.prototype.hasOwnProperty.call(BRIDGE_RECIPES, name.slice('bridge-'.length));
}

/** Resolve a canonical bridge preset name into its assembled Blueprint (undefined if not a
 *  bridge). `seed` = optional low-rung variation seed (omitted ⇒ canonical build). */
export function bridgeBlueprintByName(name: string, seed?: number): Blueprint | undefined {
  if (!isBridgePreset(name)) return undefined;
  return bridgeBlueprint(BRIDGE_RECIPES[name.slice('bridge-'.length)], name, seed);
}
