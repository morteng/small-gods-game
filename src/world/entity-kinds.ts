import type { SpriteRef } from '@/core/types';
import { getFloraSpecies } from '@/flora/flora-registry';
import { deriveRecipe } from '@/flora/flora-species';
import { NATURE_HEIGHT_M, DEFAULT_NATURE_HEIGHT_M } from '@/render/scale-contract';

export interface EntityKindDef {
  id: string;
  category: 'building' | 'vegetation' | 'prop' | 'terrain-feature';
  sprite: SpriteRef;
  defaultTags: ReadonlyArray<string>;
  yOffsetForSort?: number;
}

function def(
  id: string,
  category: EntityKindDef['category'],
  fallbackColor: string,
  fallbackShape: 'circle' | 'square' | 'triangle',
  tags: string[],
  yOffsetForSort?: number,
): EntityKindDef {
  return {
    id,
    category,
    sprite: { fallbackColor, fallbackShape },
    defaultTags: Object.freeze(tags),
    yOffsetForSort,
  };
}

/** Read-only entity catalog. Append new kinds at the bottom. */
export const entityKinds: ReadonlyMap<string, EntityKindDef> = new Map<string, EntityKindDef>([
  // ─── Buildings (existing LPC sprites — see src/map/building-templates.ts) ──
  ['cottage',       def('cottage',       'building',         '#C4956A', 'square', ['building', 'residential', 'shelter'], 1)],
  ['tavern',        def('tavern',        'building',         '#FFB74D', 'square', ['building', 'commercial', 'shelter'], 1)],
  ['market_stall',  def('market_stall',  'building',         '#FFB74D', 'square', ['building', 'commercial'], 1)],
  ['temple_small',  def('temple_small',  'building',         '#CE93D8', 'square', ['building', 'religious', 'sacred'], 1)],
  ['shrine',        def('shrine',        'building',         '#CE93D8', 'square', ['building', 'religious', 'sacred'], 1)],
  ['castle_keep',   def('castle_keep',   'building',         '#78909C', 'square', ['building', 'military', 'shelter'], 1)],
  ['tower',         def('tower',         'building',         '#78909C', 'square', ['building', 'military'], 1)],
  ['farm_barn',     def('farm_barn',     'building',         '#AED581', 'square', ['building', 'farm', 'shelter'], 1)],
  ['dock',          def('dock',          'building',         '#80DEEA', 'square', ['building', 'commercial', 'water-adjacent'], 1)],
  ['guard_post',    def('guard_post',    'building',         '#78909C', 'square', ['building', 'military'], 1)],
  ['building',      def('building',      'building',         '#C4956A', 'square', ['building'], 1)],
  ['yurt',          def('yurt',          'building',         '#b9a07a', 'square', ['building', 'residential', 'shelter'], 1)],
  ['longhouse',     def('longhouse',     'building',         '#7a5230', 'square', ['building', 'residential', 'shelter'], 1)],

  // ─── Vegetation ───────────────────────────────────────────────────────────
  // Trees/shrubs/herbs are botanically-derived flora-DB species (english-oak,
  // scots-pine, …), auto-registered below from FLORA_FACTS. The generic ground
  // cover kinds here are the remaining hand-authored placeholders.
  ['sapling',       def('sapling',       'vegetation',       '#5a8a4a', 'circle', ['vegetation', 'small'], 0.5)],
  ['shrub',         def('shrub',         'vegetation',       '#4a7a3a', 'circle', ['vegetation', 'undergrowth'], 0.5)],
  ['fern',          def('fern',          'vegetation',       '#3a6a2a', 'circle', ['vegetation', 'undergrowth'], 0.3)],
  ['flower_patch',  def('flower_patch',  'vegetation',       '#e8b8d0', 'circle', ['vegetation', 'decoration'], 0.2)],
  ['mushroom',      def('mushroom',      'vegetation',       '#c45a45', 'circle', ['vegetation', 'small'], 0.2)],
  ['grass_tuft',    def('grass_tuft',    'vegetation',       '#6a9a4a', 'circle', ['vegetation', 'ground-cover'], 0.1)],
  ['reeds',         def('reeds',         'vegetation',       '#7a8a4a', 'triangle', ['vegetation', 'water-adjacent'], 0.5)],
  ['cactus',        def('cactus',        'vegetation',       '#3a7a4a', 'triangle', ['vegetation', 'arid'], 0.8)],
  ['tundra_moss',   def('tundra_moss',   'vegetation',       '#7a7a5a', 'circle', ['vegetation', 'ground-cover'], 0.1)],

  // ─── Terrain features (rocks, geology) ────────────────────────────────────
  // Rocks with a generative preset use category `vegetation` — the sea_arch trick:
  // the render graph only draws barrier/blueprint/vegetation entities, so as
  // 'terrain-feature' every rock worldgen scattered was silently INVISIBLE. All
  // placement/clearing consumers treat the two categories identically
  // (NATURE_CATEGORIES), so this only turns their rendering on.
  ['boulder',       def('boulder',       'vegetation',       '#888888', 'circle', ['rock', 'obstacle'], 1)],
  // A craggy bedrock outcrop (stacked cut-slab pinnacle, ~3 m) — the stone landmark
  // between a boulder and the painted cliff faces. Blocks movement like a boulder.
  ['rock_outcrop',  def('rock_outcrop',  'vegetation',       '#83838b', 'square', ['rock', 'obstacle'], 1.5)],
  ['rock_pile',     def('rock_pile',     'vegetation',       '#777777', 'circle', ['rock'], 0.5)],
  ['pebbles',       def('pebbles',       'vegetation',       '#999999', 'circle', ['rock', 'small'], 0.1)],
  ['driftwood',     def('driftwood',     'terrain-feature',  '#a07a4a', 'square', ['debris', 'coastal'], 0.3)],
  ['shell',         def('shell',         'terrain-feature',  '#e8d8b0', 'circle', ['debris', 'coastal'], 0.1)],
  ['stump',         def('stump',         'terrain-feature',  '#6a4a2a', 'circle', ['debris', 'forest'], 0.3)],
  ['log',           def('log',           'terrain-feature',  '#7a5a3a', 'square', ['debris', 'forest'], 0.3)],
  ['ore_vein',      def('ore_vein',      'vegetation',       '#5a5a8a', 'square', ['resource', 'rock'], 0.5)],
  // Sea arch: a natural LANDFORM mesh prop. Category `vegetation` (not terrain-
  // feature) so the render graph routes it to the per-kind generative mesh source
  // — the `sea_arch` plant preset paints a real, self-lit rock ring with a hole
  // through it (a landform the heightfield can't represent). Coastal monument.
  ['sea_arch',      def('sea_arch',      'vegetation',       '#8a8a92', 'square', ['landform', 'coastal', 'monument'], 1.5)],
  ['cliff_face',    def('cliff_face',    'vegetation',       '#8a8a92', 'square', ['landform', 'coastal', 'monument'], 1.5)],
  ['cave_mouth',    def('cave_mouth',    'vegetation',       '#7a7a82', 'square', ['landform', 'coastal', 'cave'], 1.5)],
  ['hoodoo',        def('hoodoo',        'vegetation',       '#8a8a82', 'square', ['landform', 'highland', 'monument'], 1.5)],

  // ─── Settlement props ─────────────────────────────────────────────────────
  ['well',          def('well',          'prop',             '#5a8aa8', 'circle', ['water-source', 'settlement'], 0.5)],
  ['graveyard',     def('graveyard',     'prop',             '#8a8a72', 'square', ['civic', 'sacred', 'settlement'], 1)],
  ['beaver_dam',    def('beaver_dam',    'prop',             '#6a5238', 'square', ['water-feature', 'natural'], 0.6)],
  ['fence',         def('fence',         'prop',             '#7a5a3a', 'square', ['barrier', 'settlement'], 0.3)],
  ['fence_post',    def('fence_post',    'prop',             '#7a5a3a', 'square', ['barrier', 'settlement'], 0.3)],
  ['gate',          def('gate',          'prop',             '#7a5a3a', 'square', ['barrier', 'opening'], 0.3)],
  ['statue',        def('statue',        'prop',             '#bbbbbb', 'square', ['monument', 'sacred'], 1)],
  ['altar',         def('altar',         'prop',             '#dddddd', 'square', ['religious', 'sacred'], 0.5)],
  ['banner',        def('banner',        'prop',             '#c43a3a', 'square', ['monument', 'heraldry'], 1)],
  ['lamp',          def('lamp',          'prop',             '#f0d090', 'circle', ['light-source', 'settlement'], 0.5)],
  ['lamp_post',     def('lamp_post',     'prop',             '#f0d090', 'square', ['light-source', 'settlement'], 1)],
  ['bench',         def('bench',         'prop',             '#7a5a3a', 'square', ['furniture', 'seating'], 0.2)],
  ['sign_post',     def('sign_post',     'prop',             '#a07a4a', 'square', ['information', 'settlement'], 0.5)],
  ['market_awning', def('market_awning', 'prop',             '#e8a85a', 'square', ['commercial', 'shelter'], 0.5)],
  ['crate',         def('crate',         'prop',             '#a07a4a', 'square', ['storage', 'commercial'], 0.3)],
  ['barrel',        def('barrel',        'prop',             '#7a4a2a', 'circle', ['storage'], 0.3)],
  ['cart',          def('cart',          'prop',             '#8a6a4a', 'square', ['transport'], 0.5)],
  ['crop_row',      def('crop_row',      'prop',             '#c4b04a', 'square', ['farm', 'crop'], 0)],
  ['scarecrow',     def('scarecrow',     'prop',             '#a08a3a', 'square', ['farm'], 1)],
  ['hay_bale',      def('hay_bale',      'prop',             '#d4b860', 'circle', ['farm', 'storage'], 0.3)],
  ['nets',          def('nets',          'prop',             '#a8a888', 'square', ['fishing', 'water-adjacent'], 0.2)],
  ['rope_coil',     def('rope_coil',     'prop',             '#bfa67a', 'circle', ['nautical'], 0.1)],
  ['anchor',        def('anchor',        'prop',             '#444444', 'triangle', ['nautical'], 0.3)],
  ['rubble',        def('rubble',        'prop',             '#9a8a7a', 'circle', ['ruin', 'debris'], 0.2)],
  ['vine',          def('vine',          'prop',             '#4a7a3a', 'circle', ['vegetation', 'ruin'], 0)],
  ['campfire',      def('campfire',      'prop',             '#d96a3a', 'circle', ['fire', 'wilderness'], 0.3)],
  ['tent',          def('tent',          'prop',             '#a89868', 'triangle', ['shelter', 'wilderness'], 1)],

  // ─── Quarry / mining features ─────────────────────────────────────────────
  ['stone_block',   def('stone_block',   'prop',             '#8a8a8a', 'square', ['resource', 'quarry'], 0.5)],
  ['mine_cart',     def('mine_cart',     'prop',             '#5a4a3a', 'square', ['transport', 'quarry'], 0.5)],
  ['support_beam',  def('support_beam',  'prop',             '#6a4a2a', 'square', ['structure', 'quarry'], 1)],

  // ─── Sacred grove props (category `vegetation` = the render-routing tag; see rocks) ──
  ['standing_stone', def('standing_stone', 'vegetation',     '#7a7a8a', 'square', ['monument', 'sacred'], 1.5)],
  ['shrine_stone',  def('shrine_stone',  'vegetation',       '#9a8aa8', 'square', ['religious', 'sacred'], 0.5)],
]);

/** Memoised entity-kind defs DERIVED from the flora fact DB, so every species id
 *  (e.g. 'english-oak') is a first-class entity kind — visible to sim queries,
 *  collision and the render fallback — without hand-listing 26 species here. The
 *  flora DB is the single source of truth; art comes from the parametric pipeline
 *  (see blueprint/presets `floraSpeciesBlueprint`), this is just the catalog face. */
const floraDefMemo = new Map<string, EntityKindDef | null>();
function floraKindDef(kind: string): EntityKindDef | null {
  const cached = floraDefMemo.get(kind);
  if (cached !== undefined) return cached;
  const sp = getFloraSpecies(kind);
  let d: EntityKindDef | null = null;
  if (sp) {
    const b = sp.botanical;
    if (b.habit === 'rock') {
      // `vegetation` is the render-graph routing tag (see the rocks section above) —
      // as 'terrain-feature' rock species spawned but never drew.
      d = def(kind, 'vegetation', '#888888', 'circle', ['rock', 'obstacle'], 1);
    } else {
      const recipe = deriveRecipe(b);
      const isTree = b.habit === 'tree';
      const shape = recipe === 'pine' ? 'triangle' : 'circle';
      const color =
        recipe === 'pine' ? '#2d5a2d'
        : b.habit === 'shrub' ? '#4a7a3a'
        : b.habit === 'fern' ? '#3a6a2a'
        : b.habit === 'herb' || b.habit === 'grass' ? '#6a9a4a'
        : '#3a6e3a';
      const tags = ['vegetation', isTree ? 'tree' : b.habit];
      d = def(kind, 'vegetation', color, shape, tags, isTree ? 0.5 : 0.3);
    }
  }
  floraDefMemo.set(kind, d);
  return d;
}

/** Throws on unknown kinds — non-render code MUST use this. */
export function getEntityKindDef(kind: string): EntityKindDef {
  const d = entityKinds.get(kind) ?? floraKindDef(kind);
  if (!d) throw new Error(`Unknown entity kind: ${kind}`);
  return d;
}

/** Returns null on unknown kinds — render code uses this for fallback drawing. */
export function tryGetEntityKindDef(kind: string): EntityKindDef | null {
  return entityKinds.get(kind) ?? floraKindDef(kind);
}

/**
 * The ROCK family — the population that settles INTO the ground (settle pad +
 * sprite bury + terrain contact blend). One predicate so world-side pads
 * (`rock-deformation.ts`) and the render-side bury/blend (`iso/iso-sprites.ts`)
 * cannot disagree about what a rock is.
 *
 * `standing_stone` joins by NAME, not by tag: it is catalogued as a monument
 * (tags `monument`/`sacred`, which other systems key on) but it is a menhir —
 * stone SET INTO the earth, the very thing that must not look dropped on it.
 */
export function isRockKind(kind: string): boolean {
  if (kind === 'standing_stone') return true;
  return tryGetEntityKindDef(kind)?.defaultTags.includes('rock') ?? false;
}

/**
 * SMALL loose stone that snowpack simply BURIES — pebbles, rock piles, field
 * stones. Once the ground paints predominantly white the draw list hides these
 * entirely: a knee-high grey lump on a snowfield, even whitened, reads as
 * dropped ON the snow rather than under it (the snow swatch already carries its
 * own poking rock tips). SIZE-KEYED: rocks a metre and taller (boulder,
 * granite-boulder, rock_outcrop) do NOT vanish — 20 cm of snowpack cannot
 * swallow a 2 m boulder; they stay drawn and take the per-instance whiten
 * (snow-on-up-normals) instead, like standing_stone (a monument) and ore_vein
 * (a resource marker) always did.
 */
export function isSnowBuriedRockKind(kind: string): boolean {
  if (kind === 'standing_stone') return false;
  const tags = tryGetEntityKindDef(kind)?.defaultTags;
  if (!tags || !tags.includes('rock') || tags.includes('resource')) return false;
  return natureSizeM(kind) < 1.0;
}

/** Real-entity size of a nature kind in metres: the catalogue height × the entity's
 *  per-instance scale multiplier. The one place the pad/bury/blend sizing reads
 *  "how big is this rock" (kinds absent from the table take the default). */
export function natureSizeM(kind: string, scale = 1): number {
  return (NATURE_HEIGHT_M[kind] ?? DEFAULT_NATURE_HEIGHT_M) * (Number.isFinite(scale) ? scale : 1);
}
