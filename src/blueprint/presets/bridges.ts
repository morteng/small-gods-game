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
      type: 'abutment', at: { x: cxT - boxW / 2, y: cyT - boxH / 2 }, size: { w: boxW, h: boxH },
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
  style: 'round' | 'segmental' | 'pointed'; parapet: boolean; camberM: number;
}): Record<string, BridgePart> {
  const { spanTiles, roadTiles, bays, riseM, style, parapet, camberM } = opts;
  const bay = spanTiles / bays;
  const y0 = 1;                       // deck/arch band starts 1 tile in (montage breathing room)
  const deckBaseZM = riseM + ARCH_RING_M;   // deck underside sits on the arch crown
  const parts: Record<string, BridgePart> = {
    deck: {
      type: 'deck', at: { x: 0.5, y: y0 }, size: { w: spanTiles, h: roadTiles },
      params: { lengthM: spanTiles * M, widthM: roadTiles * M, thicknessM: 0.6, dir: 'ew',
        parapet: parapet ? 'both' : 'none', baseZM: deckBaseZM, camberM },
    },
  };
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
  // Iconic medieval stone bridge: hump-backed, three segmental arches, cutwater piers, parapets.
  'stone-arch': {
    desc: 'dressed-stone 3-arch road bridge (filled spandrel, hump-backed, parapets)',
    walls: 'stone',
    ttiSubject: 'medieval dressed-stone road bridge with THREE segmental arches spanning a river, ' +
      'a gently hump-backed deck carried on a solid filled-spandrel wall, low stone parapets along ' +
      'both edges, and pointed cutwater piers between the arches; grey ashlar masonry',
    build: () => archBridge({ spanTiles: 12, roadTiles: 2, bays: 3, riseM: 3, style: 'segmental', parapet: true, camberM: 0.8 }),
  },
  // Timber trestle: a plank deck on driven piles, near-vertical, no masonry arch.
  'timber-trestle': {
    desc: 'timber trestle footbridge (driven piles, plank deck)',
    walls: 'timber',
    ttiSubject: 'medieval timber trestle footbridge, a flat plank deck carried on three bents of ' +
      'driven vertical timber piles, no masonry and no arches, sitting low over the water; ' +
      'weathered brown wood',
    build: () => {
      const spanTiles = 8, roadTiles = 1, y0 = 1, pierH = 3;
      const parts: Record<string, BridgePart> = {
        // The plank deck RIDES ON the pile tops (baseZM = pier height), so the piles hang below
        // it like a real trestle rather than sticking up through it.
        deck: { type: 'deck', at: { x: 0.5, y: y0 }, size: { w: spanTiles, h: roadTiles }, params: { lengthM: spanTiles * M, widthM: roadTiles * M, thicknessM: 0.4, dir: 'ew', parapet: 'none', baseZM: pierH } },
      };
      for (let i = 1; i <= 3; i++) parts[`pier${i}`] = { type: 'pier', at: { x: i * 2 - 0.5, y: y0 }, size: { w: 1, h: 1 }, params: { heightM: pierH, widthM: 0.6, batter: 0.05 } };
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
    build: () => archBridge({ spanTiles: 5, roadTiles: 1, bays: 1, riseM: 2.5, style: 'round', parapet: true, camberM: 1.0 }),
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
