import { worldToScreen } from './iso-projection';
import type { IsoAtlas } from './iso-atlas';
import type { NpcInstance, Entity, GameMap } from '@/core/types';
import { tryGetEntityKindDef, isRockKind, natureSizeM } from '@/world/entity-kinds';
import { groundContactColor, contactBlendFor } from '@/render/ground-contact';
import { getSpriteCoords } from '@/render/npc-animator';
import { NATURE_HEIGHT_M, DEFAULT_NATURE_HEIGHT_M, mToPx } from '@/render/scale-contract';
import { npcBillboard } from './npc-billboard';
import { type DrawItem } from './draw-list';
import { packAlbedoSource, mapSize } from './sprite-canvas';

export interface IsoDrawCtx {
  ctx: CanvasRenderingContext2D;
  atlas: IsoAtlas;
  originX: number;
  originY: number;
  /** LPC spritesheets keyed by NPC id (shared with top-down renderer). */
  npcSheets?: Map<string, HTMLCanvasElement>;
}

/** The emitters need everything the draw ctx carries except the 2D context. */
export type IsoItemCtx = Omit<IsoDrawCtx, 'ctx'>;

/**
 * Billboard target height (px) for a nature kind, given a per-instance variety
 * multiplier (~0.85..1.15; defaults to 1). Drives the drawn canopy/trunk placeholder
 * (the parametric SpritePack is the real art; this is the headless/cold fallback).
 */
export function natureBillboard(kind: string, variety = 1): { targetPx: number } {
  const m = (NATURE_HEIGHT_M[kind] ?? DEFAULT_NATURE_HEIGHT_M) * variety;
  return { targetPx: mToPx(m) };
}

const NPC_COLOR_BY_ROLE: Record<string, string> = {
  villager: '#d4a574',
  priest:   '#cdb5ff',
  default:  '#e0e0e0',
};

/**
 * Default pixel height of an NPC's visible body above the ground (head z for
 * overlay markers, e.g. the prayer 🙏). The OPAQUE BODY (not the 64px LPC
 * frame — the body only fills ~30px of it) anchors to HUMAN_PX via a nearest-
 * integer scale (1:1 rule), so this is body-height × scale, not HUMAN_PX itself.
 */
const DEFAULT_BB = npcBillboard(undefined);
export const BILLBOARD_H_PX = (DEFAULT_BB.bottom - DEFAULT_BB.top) * DEFAULT_BB.scale; // 30 at the interim 1× scale

const LPC_FRAME = 64;

export function npcItems(ic: IsoItemCtx, npc: NpcInstance): DrawItem[] {
  const { sx, sy } = worldToScreen(npc.tileX, npc.tileY, 0, ic.originX, ic.originY);

  // 1. Iso character atlas (future PR 4) — not available yet
  const isoSprite = ic.atlas.getCharacter(npc.role);
  if (isoSprite) {
    return [];
  }

  // 2. Billboard from LPC spritesheet (reuse top-down art)
  const sheet = ic.npcSheets?.get(npc.id);
  if (sheet) {
    const { sx: sheetSx, sy: sheetSy } = getSpriteCoords(npc);
    const bb = npcBillboard(sheet);
    const s = bb.scale;
    const drawW = LPC_FRAME * s, drawH = LPC_FRAME * s;

    // Feet (opaque bbox bottom) land on the tile point; whole frame at integer scale.
    // The cast shadow must anchor at the FEET, not the frame bottom — the LPC frame
    // has transparent padding below the feet (`bb.bottom` < LPC_FRAME), so without a
    // footLift the shadow detaches a few px below the sprite.
    return [{
      t: 'image', src: sheet,
      frame: { sx: sheetSx, sy: sheetSy, sw: LPC_FRAME, sh: LPC_FRAME },
      dx: Math.round(sx - drawW / 2), dy: Math.round(sy - bb.bottom * s),
      dw: drawW, dh: drawH,
      shadow: { footLift: (LPC_FRAME - bb.bottom) * s },
    }];
  }

  // 3. Fallback colored circle (no art available)
  return [{
    t: 'circle', cx: sx, cy: sy - 16, r: 12,
    color: NPC_COLOR_BY_ROLE[npc.role] ?? NPC_COLOR_BY_ROLE.default,
  }];
}

/** A square art sprite (decoration or prop) as an upright billboard,
 *  base anchored at the tile center. */
export function artBillboardItem(
  o: { originX: number; originY: number }, img: HTMLImageElement, tx: number, ty: number,
): DrawItem {
  const { sx, sy } = worldToScreen(tx, ty, 0, o.originX, o.originY);
  // WYSIWYG: blit at the art's NATIVE pixel size (never tile-fraction scaled) so
  // one source pixel == one screen pixel at zoom 1. Base anchored at tile centre.
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  return {
    t: 'image', src: img,
    dx: Math.round(sx) - Math.round(w / 2), dy: Math.round(sy) - h,
    dw: w, dh: h,
  };
}

/**
 * A generated TREE sprite PACK (albedo + co-registered normal/material maps) as a
 * foot-anchored upright billboard: bottom-centre lands on the tile point, exactly
 * like `vegetationItems`' billboard, so a generative tree sits where its billboard
 * fallback would. The maps ride along for the WebGL lit shader (Canvas2D ignores
 * them); the Pixi layer also drops a cast shadow per image item. The pack canvas is
 * already cropped to opaque content (trunk base = bottom row), so no extra anchor
 * math. Blitted at native size (one source px == one screen px at zoom 1) — per-
 * instance variety is intentionally NOT scaled here (uniform per species keeps the
 * blit pixel-crisp; variety comes from the species mix + clumped placement).
 */
export function plantSpriteItemFromPack(
  o: { originX: number; originY: number }, pack: import('./sprite-canvas').SpritePack, x: number, y: number,
  buryFrac = 0,
  noShadow = false,
  whiten = 0,
  contact?: ContactBlend,
  sway = 0,
): DrawItem {
  const { sx, sy } = worldToScreen(x, y, 0, o.originX, o.originY);
  const src = packAlbedoSource(pack);
  const { w, h } = mapSize(src);
  // BURY (R5): sink the sprite into the ground by cropping the bottom `buryPx` rows and
  // seating the CROPPED base at the ground line (sy). The painter-order entity pass has
  // no per-pixel terrain clip, so we can't just push the sprite down (it'd float lower) —
  // instead we don't draw the buried rows and the terrain painted behind shows through.
  // Foot (dy+dh) stays at sy, so foot-z lift + the cast shadow anchor are unaffected.
  const buryPx = Math.max(0, Math.min(h - 1, Math.round(h * Math.max(0, Math.min(0.4, buryFrac)))));
  const visH = h - buryPx;
  const item: DrawItem = {
    t: 'image', src,
    dx: Math.round(sx) - Math.round(w / 2), dy: Math.round(sy) - visH,
    dw: w, dh: visH,
    // Foot-anchored billboard: the sprite bottom IS the ground contact, so the
    // cast shadow anchors there (footLift 0), NOT lifted dw/4 like a building.
    shadow: { footLift: 0 },
  };
  // Ground-cover habits (grass/herb/fern) skip the cast-shadow pass — see
  // `isGroundCoverKind` / DrawItem.noShadow.
  if (noShadow) item.noShadow = true;
  // Per-instance variety without fractional scaling (pixel-perfect rule): a seeded
  // horizontal MIRROR. Plants/rocks carry no text or handed authored features, so a
  // flip is free variety; foot anchor and native size are untouched.
  if (plantMirror(x, y)) item.mirror = true;
  // Alpine whiten (snow-mask driven) — the lit shader settles snow on up-facing texels.
  if (whiten > 0) item.whiten = Math.min(1, whiten);
  // GROUND CONTACT: the terrain's local ground tone (snow where the ground is snowed)
  // bled into the FOOT of the sprite, so soil/drift banks against the base instead of
  // stopping dead at the silhouette. The band is expressed against the DRAWN (post-bury)
  // height, which is what the shader interpolates over.
  if (contact && contact.strength > 0) item.contact = contact;
  // Wind sway (billboard shear): the lit shader bends the top of the quad along the
  // global wind, foot fixed. Amplitude is per-species (flexibility); 0 ⇒ rigid.
  if (sway > 0) item.sway = Math.min(1, sway);
  if (buryPx > 0) {
    item.frame = { sx: 0, sy: 0, sw: w, sh: visH };   // keep the TOP visH rows
    // The rect crop alone ends the rock in a razor-straight line at the ground —
    // "the entire bottom is cut off flat" (user). The lit shader erodes the last
    // `scallop` of the drawn height along a wavy line so the ground banks over the
    // base unevenly, like soil actually does. Amplitude scales with the bury depth
    // (a deeply lodged boulder gets a taller, rougher ground line than a cobble).
    // Amplitude floors at 4 px and tracks ~90 % of the buried depth: the old 2 px floor
    // (0.6·bury) left shallow-buried rocks with a visually STRAIGHT cut — a two-pixel
    // wave reads as a razor line at gameplay zoom (user report, dusty scree slopes where
    // no thick snow contact band hides the edge). Cap matches the 0.24 packing limit in
    // instance-batch.ts.
    item.scallop = Math.min(0.24, Math.max(4, buryPx * 0.9) / Math.max(1, visH));
  }
  if (pack.shadow) {
    item.shadowSprite = { src: pack.shadow.canvas, dx: pack.shadow.dx, dy: pack.shadow.dy };
  }
  if (pack.normal || pack.normalData || pack.material || pack.materialData || pack.emissive || pack.emissiveData) {
    item.maps = {
      normal: pack.normal as CanvasImageSource | undefined,
      normalData: pack.normalData,
      material: pack.material as CanvasImageSource | undefined,
      materialData: pack.materialData,
      emissive: pack.emissive as CanvasImageSource | undefined,
      emissiveData: pack.emissiveData,
    };
  }
  return item;
}

/**
 * Bury depth for rocks (fraction of sprite height sunk below the ground line), SIZE-SCALED.
 * The flat 10–20 % this used to apply was tuned for the riverbank cobbles and left the big
 * upland boulders reading as if they rested ON the ground ("floating on top of the snow").
 * A big rock is buried by more of itself: the base ramps from BURY_SMALL at a pebble to
 * BURY_BIG at a menhir, plus a seeded ± so a scree field doesn't sink in lockstep.
 * (Kept under the 0.4 cap `plantSpriteItemFromPack` clamps to.)
 */
const ROCK_BURY_SMALL = 0.10;   // ≤ ~0.3 m — a cobble barely marks the ground
const ROCK_BURY_BIG = 0.24;     // ≥ ~2 m   — a boulder is properly lodged
const ROCK_BURY_JITTER = 0.05;  // seeded per instance, on top of the size term
const ROCK_BURY_SMALL_M = 0.3;
const ROCK_BURY_BIG_M = 2.0;

/** Deterministic [0,1) hash of a world position — seeds the per-rock bury so it's stable
 *  frame-to-frame (a flickering bury depth would read as the rock bobbing). */
function posHash01(x: number, y: number): number {
  let h = Math.imul((Math.trunc(x * 97) * 374761393) ^ (Math.trunc(y * 71) * 668265263), 1274126177) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Deterministic horizontal-mirror pick for a plant/rock instance — stable per world
 *  position (same hash family as the bury depth, offset inputs so the two don't
 *  correlate). Exported for the determinism guard test. */
export function plantMirror(x: number, y: number): boolean {
  return posHash01(x + 31.7, y + 17.3) < 0.5;
}

/**
 * Bury fraction for a foot-anchored nature sprite — ROCKS sink into the ground by a
 * size-scaled fraction of their height (seeded per position); everything else (trees,
 * ground cover) gets 0 here (a root-flare knob for trees is a separate pass). The rock
 * family is `isRockKind` (entity-kinds.ts) — shared with the world-side settle pads, so
 * the sprite that sinks and the ground that dishes are the same population.
 */
export function natureBuryFrac(kind: string, x: number, y: number, scale = 1): number {
  if (!isRockKind(kind)) return 0;
  const sizeM = natureSizeM(kind, scale);
  const t = Math.min(1, Math.max(0, (sizeM - ROCK_BURY_SMALL_M) / (ROCK_BURY_BIG_M - ROCK_BURY_SMALL_M)));
  return ROCK_BURY_SMALL + (ROCK_BURY_BIG - ROCK_BURY_SMALL) * t + ROCK_BURY_JITTER * posHash01(x, y);
}

/** Per-instance terrain contact blend (see `render/ground-contact.ts`). */
export interface ContactBlend {
  /** Local ground colour at the foot (0..1), already mixed toward snow by the snow mask. */
  r: number; g: number; b: number;
  /** How hard the foot mixes toward it (0 = identity / byte-identical output). */
  strength: number;
  /** Fraction of the DRAWN sprite height the blend fades out over, from the foot up. */
  band: number;
}

/**
 * The contact blend for a nature instance, or undefined for kinds that get none.
 * ENABLED FOR: rocks (the ask — they must read as lodged) and low GROUND COVER
 * (grass/herb/fern tufts and dwarf shrubs — a tuft that meets the ground on a hard
 * silhouette edge floats exactly like a rock does). NOT trees: a trunk needs a root
 * flare / litter ring, which is modelled geometry, not a colour smear up the bark.
 */
export function natureContact(map: GameMap, kind: string, x: number, y: number, snow: number): ContactBlend | undefined {
  const cls = isRockKind(kind) ? 'rock' : isContactCoverKind(kind) ? 'cover' : null;
  if (!cls) return undefined;
  const [r, g, b] = groundContactColor(map, Math.floor(x), Math.floor(y));
  const { strength, band } = contactBlendFor(cls, snow);
  return { r, g, b, strength, band };
}

/** Low cover that meets the ground directly: the shadow-skipping ground-cover habits
 *  plus dwarf shrubs (heather/gorse/juniper — they carpet the ground, they don't stand
 *  over it on a trunk). */
function isContactCoverKind(kind: string): boolean {
  if (isGroundCoverKind(kind)) return true;
  return tryGetEntityKindDef(kind)?.defaultTags.includes('shrub') ?? false;
}

/**
 * True for ground-cover flora habits (grass tussocks, herbs, ferns) — the
 * `plantSpriteItemFromPack` billboard for these skips the cast-shadow pass
 * (`DrawItem.noShadow`): a shadow batch entry per blade would balloon the
 * shadow instance count as ground-cover density rises, and a tuft this small
 * shouldn't read a visible silhouette shadow anyway.
 */
export function isGroundCoverKind(kind: string): boolean {
  const def = tryGetEntityKindDef(kind);
  if (!def) return false;
  return def.defaultTags.includes('grass') || def.defaultTags.includes('herb') || def.defaultTags.includes('fern');
}

/**
 * Knee-high woody flora (heather, gorse, prostrate juniper — flora species with
 * habit 'shrub' tag, plus the static 'undergrowth'-tagged shrub kind). Not ground
 * cover — they keep their shadow and survive a dusting — but deep snowpack buries
 * them at draw time (entity-draw-list SHRUB_SNOW_HIDE), where a tree would poke
 * through. Trees are excluded by tag: 'tree' wins over everything.
 */
export function isLowShrubKind(kind: string): boolean {
  const def = tryGetEntityKindDef(kind);
  if (!def || def.defaultTags.includes('tree')) return false;
  return def.defaultTags.includes('shrub') || def.defaultTags.includes('undergrowth');
}

const TRUNK_COLOR = '#5a4030';

/**
 * A vegetation entity as iso items: an optional trunk for tall trees, and a
 * canopy whose shape/color come from the entity kind catalog. `yOffsetForSort`
 * doubles as a size class (0.1 ground cover → 1.5 mature tree). Empty for
 * non-vegetation kinds.
 */
export function vegetationItems(ic: IsoItemCtx, e: Entity): DrawItem[] {
  const def = tryGetEntityKindDef(e.kind);
  if (!def || def.category !== 'vegetation') return [];

  const { sx, sy } = worldToScreen(e.x, e.y, 0, ic.originX, ic.originY);

  // `scale` is now a per-instance VARIETY multiplier (~0.85..1.15), not an absolute size.
  // Vegetation is never rotated (tilted trees read as wrong) — variety comes
  // from the multiplier and clumped placement instead.
  const variety = (e.properties?.scale as number) ?? 1;
  const { targetPx } = natureBillboard(e.kind, variety);

  // Drawn canopy/trunk placeholder. The real flora art is the parametric SpritePack
  // (resolveParametricPlantArt → plantSpriteItemFromPack); this is the cold/headless
  // fallback when that pack isn't warm yet.
  const items: DrawItem[] = [];
  // Trees have 'tree' in their defaultTags; ground cover (fern, shrub) does not
  const isTree = def.defaultTags.includes('tree');
  const canopyR = isTree ? targetPx * 0.35 : targetPx * 0.5;
  const trunkH = isTree ? targetPx * 0.55 : 0;

  if (isTree) {
    items.push({
      t: 'poly', color: TRUNK_COLOR,
      points: [
        { x: sx - 2, y: sy - trunkH }, { x: sx + 2, y: sy - trunkH },
        { x: sx + 2, y: sy }, { x: sx - 2, y: sy },
      ],
    });
  }

  const cy = sy - trunkH - (isTree ? 0 : canopyR * 0.3);
  const color = def.sprite.fallbackColor ?? '#3a7a3a';
  if (def.sprite.fallbackShape === 'triangle') {
    items.push({
      t: 'poly', color,
      points: [
        { x: sx, y: cy - canopyR * 1.6 },
        { x: sx + canopyR, y: cy + canopyR * 0.4 },
        { x: sx - canopyR, y: cy + canopyR * 0.4 },
      ],
    });
  } else if (def.sprite.fallbackShape === 'square') {
    items.push({
      t: 'poly', color,
      points: [
        { x: sx - canopyR, y: cy - canopyR }, { x: sx + canopyR, y: cy - canopyR },
        { x: sx + canopyR, y: cy + canopyR }, { x: sx - canopyR, y: cy + canopyR },
      ],
    });
  } else {
    items.push({ t: 'circle', cx: sx, cy, r: canopyR, color });
  }
  return items;
}
