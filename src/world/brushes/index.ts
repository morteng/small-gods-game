// Side-effect imports register each brush in the central registry.
import './forest';
import './dense-forest';
import './pine-forest';
import './scrubland';
import './sacred-grove';
import './coastal';
import './hills';
import './quarry';
import './village';
import './temple';
import './farm';
import './castle';
import './dock';
import './wilderness';
import './grassland';

const BIOME_TO_BRUSH: Record<string, string | null> = {
  deep_ocean:          null,
  ocean:               null,
  beach:               'coastal',
  mountain:            'hills',
  peak:                'hills',
  ice:                 'hills',
  tundra:              'hills',
  boreal_forest:       'pine_forest',
  temperate_grassland: 'scrubland',
  temperate_forest:    'forest',
  scrubland:           'scrubland',
  tropical_grassland:  'scrubland',
  savanna:             'scrubland',
  tropical_forest:     'dense_forest',
  desert:              'scrubland',
  swamp:               'dense_forest',
  sacred_grove:        'sacred_grove',
};

const POI_TO_BRUSH: Record<string, string> = {
  village:  'village',
  city:     'village',
  temple:   'temple',
  farm:     'farm',
  castle:   'castle',
  tower:    'castle',
  port:     'dock',
  mine:     'quarry',
  tavern:   'wilderness',
  ruins:    'wilderness',
};

/** Returns brush name or null for biomes that don't get an entity brush (oceans). */
export function brushForBiome(biome: string): string | null {
  return BIOME_TO_BRUSH[biome] ?? null;
}

/** Returns brush name; falls back to 'wilderness' for unknown POI types. */
export function brushForPoiType(poiType: string): string {
  return POI_TO_BRUSH[poiType] ?? 'wilderness';
}

/** Idempotent — registration happens via the imports above on first load. */
export function registerAllBrushes(): void { /* no-op */ }
