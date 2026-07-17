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

const M = METRES_PER_TILE; // 2 m per tile

export type BridgePart = NonNullable<Blueprint['parts']>[string];

/** A bridge recipe: geometry (`build`) + its material + a human blurb. `ttiSubject` is the
 *  geometry-true text-to-image clause the reference-library probe uses (dev-only prose). */
export interface BridgeRecipe {
  desc: string;
  walls: string;
  ttiSubject?: string;
  build(): Record<string, BridgePart>;
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
  for (let i = 0; i < bays; i++) {    // arches abut edge-to-edge → continuous spandrel wall
    parts[`arch${i + 1}`] = {
      type: 'arch_span', at: { x: 0.5 + i * bay, y: y0 }, size: { w: Math.ceil(bay), h: roadTiles },
      params: { spanM: bay * M, riseM, thicknessM: roadTiles * M, dir: 'ew', style, ringDepthM: ARCH_RING_M },
    };
  }
  addAbutments(parts, 0.5, 0.5 + spanTiles, y0 + roadTiles / 2, roadTiles, deckBaseZM);
  return parts;
}

/** The buildable bridge library, keyed by SHORT name (the canonical preset is `bridge-<short>`
 *  and the reference-library slug is the same). Diagnostics-only recipes live in the dev script. */
export const BRIDGE_RECIPES: Record<string, BridgeRecipe> = {
  // Tier-0 log crossing (road-wear economy S0): ONE squared log dropped across the stream with a
  // flat treadway spiked on top. No rails, no masonry beyond two low seating blocks at the banks.
  // Humble and slightly ASKEW by construction — the log and the treadway carry small opposed
  // yaws + lateral offsets (fixed deterministic constants, no RNG), so it reads as something a
  // farmer levered into place, not something an engineer set out. Additive prims only.
  'log': {
    desc: 'log crossing (one squared log + flat treadway, no rails, seat blocks only)',
    walls: 'timber',
    ttiSubject: 'a humble log crossing over a small stream, ONE heavy squared timber log laid ' +
      'slightly askew from bank to bank with a narrow flat plank treadway fixed on top, no ' +
      'handrails, no arch, resting on a single low rough stone block at each bank; ' +
      'weathered grey-brown wood',
    build: () => {
      const spanTiles = 3, y0 = 1;             // a stream, not a river: ~6 m bank to bank
      const logZ = 0.5;                        // log underside above the datum (clears the water)
      const logThick = 0.4;                    // the squared log: a stout 0.4 m baulk
      const parts: Record<string, BridgePart> = {
        // The squared log — one narrow "deck" slab, nudged off the centreline and yawed a hair.
        log: {
          type: 'deck', at: { x: 0.5, y: y0 - 0.04 }, size: { w: spanTiles, h: 1 },
          params: { lengthM: spanTiles * M, widthM: 0.45, thicknessM: logThick, dir: 'ew',
            parapet: 'none', baseZM: logZ, yawDeg: -1.5 },
        },
        // The flat treadway — a thin plank course on the log's back, offset the OTHER way and
        // counter-yawed, so the two members read as separately laid timber.
        tread: {
          type: 'deck', at: { x: 0.65, y: y0 + 0.05 }, size: { w: spanTiles, h: 1 },
          params: { lengthM: (spanTiles - 0.3) * M, widthM: 0.7, thicknessM: 0.12, dir: 'ew',
            parapet: 'none', baseZM: logZ + logThick, yawDeg: 2 },
        },
      };
      // Minimal seating only — NOT addAbutments (that block is deck-width + 1 m, far too grand
      // for a log): one low rough stone block per bank, just enough to keep the log ends dry.
      for (const [key, cxT] of [['abut0', 0.5], ['abut1', 0.5 + spanTiles]] as const) {
        parts[key] = {
          type: 'abutment', material: 'stone', at: { x: cxT - 0.5, y: y0 }, size: { w: 1, h: 1 },
          params: { heightM: logZ, widthM: 0.9, depthM: 0.7, batter: 0.1, dir: 'ew' },
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
  // Timber beam bridge: the everyday small wooden crossing — a low, flat plank deck on beams
  // between two stone footings, simple rails, no arch and no mid-stream piles.
  'timber-beam': {
    desc: 'timber beam footbridge (low flat plank deck on stone footings, rails)',
    walls: 'timber',
    ttiSubject: 'a small simple wooden beam footbridge over a stream, a low flat plank deck ' +
      'carried on two heavy timber beams, plain post-and-rail wooden handrails along both edges, ' +
      'resting on a low grey stone footing block at each bank, no arch and no piles in the water; ' +
      'weathered brown timber',
    build: () => {
      const spanTiles = 4, roadTiles = 1, y0 = 1, deckZ = 1.4;
      const parts: Record<string, BridgePart> = {
        deck: { type: 'deck', at: { x: 0.5, y: y0 }, size: { w: spanTiles, h: roadTiles }, params: { lengthM: spanTiles * M, widthM: roadTiles * M, thicknessM: 0.5, dir: 'ew', parapet: 'rails', baseZM: deckZ, camberM: 0.15 } },
      };
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
 *  `bridge-<short>` name so the resolved blueprint keeps a stable art-cache identity per bridge. */
export function bridgeBlueprint(recipe: BridgeRecipe, presetName = 'bridge'): Blueprint {
  const parts = recipe.build();
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

/** Resolve a canonical bridge preset name into its assembled Blueprint (undefined if not a bridge). */
export function bridgeBlueprintByName(name: string): Blueprint | undefined {
  if (!isBridgePreset(name)) return undefined;
  return bridgeBlueprint(BRIDGE_RECIPES[name.slice('bridge-'.length)], name);
}
