// src/assetgen/geometry/building.ts
//
// The parametric building contract. Every knob here is overrideable by an authoring
// agent (LLM producer / Fate); anything left unset falls back to a deterministic,
// seed-varied default so a bare `{ wings }` still renders a complete building.
import { STOREY_TILES } from '@/render/scale-contract';
import type { Mat } from '@/assetgen/types';

export type RoofKind =
  | 'gable' | 'hip' | 'half_hip' | 'pyramidal' | 'flat' | 'shed'
  // Distinct silhouettes with real geometry (not collapsed to gable/hip):
  // gambrel = two-pitch barn gable; mansard = steep four-sided lower band + shallow cap;
  // saltbox = asymmetric gable, ridge off-centre with a long catslide toward the camera;
  // cross_gable = a perpendicular gabled bay crossing the main ridge.
  | 'gambrel' | 'mansard' | 'saltbox' | 'cross_gable';
export type RoofStyle = 'gable' | 'hip' | 'half_hip';
/** Which world axis a wing's roof ridge runs along. */
export type RidgeAxis = 'x' | 'y';

export interface Wing {
  x: number; y: number; w: number; h: number;
  storeys?: number;
  /** Cube-units of height per storey for THIS wing; falls back to the global STOREY. */
  storeyHeight?: number;
  /** Per-wing roof override; falls back to the building-wide `roofStyle`. */
  roof?: RoofKind;
  /** Force the ridge orientation (a 4×2 longhouse can run its ridge N–S or E–W);
   *  defaults to the wing's LONG axis. */
  ridge?: RidgeAxis;
  /** Jetty: tiles each storey above the ground oversails the one below, toward the
   *  camera (the +x/+y street faces) — the classic jettied upper floor. Default 0. */
  jetty?: number;
  /** Roof pitch override (ridge rise = pitch · half-span); falls back to the global
   *  GABLE_PITCH. A lower value gives a shallower, less-tall gable. */
  pitch?: number;
}

/** Cube-units of height per storey. One cube-unit = one tile = METRES_PER_TILE m. */
export const STOREY = STOREY_TILES;                  // 1.35  (= 2.7 m / 2 m-per-tile)

export function occupancy(wings: Wing[]): Set<string> {
  const s = new Set<string>();
  for (const w of wings) for (let i = w.x; i < w.x+w.w; i++) for (let j = w.y; j < w.y+w.h; j++) s.add(i+','+j);
  return s;
}

/** Ridge axis of a wing: explicit override, else its long axis (ties → x). */
export function ridgeAxisOf(w: Wing): RidgeAxis {
  return w.ridge ?? (w.w >= w.h ? 'x' : 'y');
}

// ── attachable features (smoke vents) ─────────────────────────────────────────────
// Doors are now carved openings resolved in the Blueprint layer; only vents remain here.
// All four walls are addressable; only the +y ("south") and +x ("east") faces are
// camera-facing in the 2:1 view.
export type WallFace = 'north' | 'east' | 'south' | 'west';
// 'spire' is a sacred ridge feature, not a smoke vent: a stone steeple crowning the ridge
// (the axis-mundi marker of a temple/church). It reuses the ridge-feature plumbing.
export type VentKind = 'chimney' | 'smokehole' | 'pipe' | 'spire';
/** Where a vent sits: on the roof ridge (interior stack) or against an exterior wall. */
export type VentPlacement = 'ridge' | 'wall';

/**
 * A smoke vent on a wing.
 *  - `placement:'ridge'` (default): rides the roof ridge at fraction `t` along it.
 *  - `placement:'wall'`: an exterior stack climbing the `face` wall at fraction `t`.
 *  `kind` selects the geometry: chimney = brick box, pipe = thin metal, smokehole = a
 *  low capped vent. `width`/`height` override the per-kind defaults.
 */
export interface VentFeature {
  wing: number;
  t: number;
  /** OPT-IN pick provenance (studio click-to-select): the vent's `<partId>/<featureId>` key,
   *  set by the blueprint compiler. Absent on raw assetgen specs / seeded default vents, so it
   *  never affects geometry — it is only forwarded into the opt-in pick buffer. */
  id?: string;
  kind?: VentKind;
  placement?: VentPlacement;
  /** For `placement:'wall'`: which exterior wall the stack rides (default 'south'). */
  face?: WallFace;
  /** For `placement:'ridge'`: which roof slope the stack pierces — 'front' (default, the
   *  camera-facing +y/+x slope) or 'back' (the far −y/−x slope). A tall stack clears the
   *  ridge and reads against the sky from either side. */
  side?: 'front' | 'back';
  width?: number;
  height?: number;
  /** Override the per-kind default material (e.g. a stone hearth stack instead of brick). */
  mat?: Mat;
}
/**
 * A gabled dormer on a wing's camera-facing roof slope at fraction `t` along the
 * ridge. Massing only (wall-material face box + mini roof prism); the img2img pass
 * paints its window. `face` picks the slope ('south' default = the +y slope).
 */
export interface DormerFeature {
  wing: number;
  t: number;
  /** Which roof slope the dormer faces; only camera-facing 'south'/'east' read in iso. */
  face?: WallFace;
  width?: number;
}

/** Optional explicit features; omit the vents list to derive a seeded default. */
export interface BuildingFeatures { vents?: VentFeature[]; dormers?: DormerFeature[] }

export interface ResolvedFeatures { vents: VentFeature[]; dormers: DormerFeature[] }

/** One chimney/vent anchor: world-space position (tile x,y; z up) plus an OPTIONAL
 *  pick-provenance id — the SAME `<partId>/<featureId>` string `VentFeature.id` carries,
 *  forwarded verbatim (never reformatted), so a downstream consumer can address ONE vent
 *  rather than the whole set (the studio's per-vent hearth control reads this to know which
 *  chimney a click landed on). `id` is only ever present when the vent itself carries one,
 *  which happens ONLY when the blueprint was compiled with `pickIds: true` (studio-only —
 *  see `ventOf` in `blueprint/compile/to-geometry.ts`); the runtime/game compose path never
 *  sets it. Purely additive: any consumer that only reads `.pos` is unaffected, and nothing
 *  upstream of this point (the sprite-cache key is `toGeometry`'s pre-anchors OUTPUT) changes
 *  shape on the runtime path. */
export interface VentAnchor { pos: [number, number, number]; id?: string }
/** World-space anchor points (tile x,y; z up) for runtime overlays. */
export interface BuildingAnchors { vents: VentAnchor[] }

/** Deterministic seed from a string (FNV-1a) — used to vary default placement. */
export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Index of the largest-area wing (where the chimney/main door go). */
export function mainWing(wings: Wing[]): number {
  return wings.reduce((bi, w, i, a) => (w.w * w.h) > (a[bi].w * a[bi].h) ? i : bi, 0);
}

/**
 * Resolve a building's vents: explicit list if given, else one seeded chimney partway
 * along the main wing's ridge. (Doors are now resolved in the Blueprint layer as openings.)
 */
export function resolveFeatures(wings: Wing[], features: BuildingFeatures = {}, seed = 0): ResolvedFeatures {
  const rng = mulberry32(seed >>> 0);
  const vents = features.vents ?? [{ wing: mainWing(wings), t: 0.28 + rng() * 0.2 }];
  return { vents, dormers: features.dormers ?? [] };
}
