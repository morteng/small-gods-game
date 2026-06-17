import { describe, it, expect } from 'vitest';
import {
  STYLE_DEFAULTS, SCALE_PROFILES, RATING_PROFILES,
  resolveWorldStyle, worldStyleOf, type WorldStyleConfig,
} from '@/core/world-style';
import {
  resolveIslandSpec, applyCoastDrama, styledIslandSpec, islandSignature, DEFAULT_ISLAND,
} from '@/terrain/island-mask';
import { buildTerrainField, TERRAIN_Z_PX_PER_M } from '@/render/gpu/terrain-field';
import { TERRAIN_RELIEF_M } from '@/world/heightfield';
import { DEFAULT_LIGHTING } from '@/render/lighting-state';
import type { GameMap, Tile, WorldSeed } from '@/core/types';

// ── S0: the resolution core ──────────────────────────────────────────────────

describe('world-style S0 — resolution core', () => {
  it('STYLE_DEFAULTS mirror today’s terrain constants (the seam is behaviour-neutral)', () => {
    expect(STYLE_DEFAULTS.terrainVerticalExaggeration).toBe(TERRAIN_Z_PX_PER_M); // 14
    expect(STYLE_DEFAULTS.mountainRelief).toBe(TERRAIN_RELIEF_M);                 // 48
    expect(STYLE_DEFAULTS.coastDrama).toBe(1);
    // every multiplier knob is neutral
    expect(STYLE_DEFAULTS.floraScale).toBe(1);
    expect(STYLE_DEFAULTS.fieldSize).toBe(1);
    expect(STYLE_DEFAULTS.buildingSpacing).toBe(1);
  });

  it('resolves to a FRESH copy of the defaults with no config', () => {
    const a = resolveWorldStyle();
    const b = resolveWorldStyle(null);
    expect(a).toEqual(STYLE_DEFAULTS);
    expect(b).toEqual(STYLE_DEFAULTS);
    expect(a).not.toBe(STYLE_DEFAULTS); // not the shared instance
    a.terrainVerticalExaggeration = 999; // mutating the copy can't poison defaults
    expect(STYLE_DEFAULTS.terrainVerticalExaggeration).toBe(14);
  });

  it('natural preset == defaults (empty override bag)', () => {
    expect(resolveWorldStyle({ scalePreset: 'natural' })).toEqual(STYLE_DEFAULTS);
    expect(SCALE_PROFILES.natural).toEqual({});
  });

  it('applies a scale preset over the defaults', () => {
    const s = resolveWorldStyle({ scalePreset: 'storybook' });
    expect(s.terrainVerticalExaggeration).toBe(SCALE_PROFILES.storybook.terrainVerticalExaggeration);
    expect(s.mountainRelief).toBe(SCALE_PROFILES.storybook.mountainRelief);
    expect(s.coastDrama).toBe(SCALE_PROFILES.storybook.coastDrama);
    // a knob the storybook profile doesn't set falls through to the default
    expect(s.deathDepiction).toBe(STYLE_DEFAULTS.deathDepiction);
  });

  it('applies a rating preset without clobbering the scale preset', () => {
    const s = resolveWorldStyle({ scalePreset: 'simulator', ratingPreset: 'kid' });
    // rating fields from kid
    expect(s.darkThemes).toBe(false);
    expect(s.deathDepiction).toBe('euphemistic');
    expect(s.narrationTone).toBe('whimsical');
    // scale fields still from simulator (axes are orthogonal)
    expect(s.terrainVerticalExaggeration).toBe(SCALE_PROFILES.simulator.terrainVerticalExaggeration);
    expect(s.floraScale).toBe(SCALE_PROFILES.simulator.floraScale);
  });

  it('per-knob overrides win over both presets', () => {
    const cfg: WorldStyleConfig = {
      scalePreset: 'storybook',
      ratingPreset: 'mature',
      overrides: { terrainVerticalExaggeration: 30, darkThemes: false },
    };
    const s = resolveWorldStyle(cfg);
    expect(s.terrainVerticalExaggeration).toBe(30);  // override beats storybook's 24
    expect(s.darkThemes).toBe(false);                // override beats mature's true
    expect(s.mountainRelief).toBe(SCALE_PROFILES.storybook.mountainRelief); // untouched
    expect(s.violence).toBe(RATING_PROFILES.mature.violence);               // untouched
  });

  it('worldStyleOf resolves a seed’s style (absent → defaults)', () => {
    expect(worldStyleOf(null)).toEqual(STYLE_DEFAULTS);
    expect(worldStyleOf({})).toEqual(STYLE_DEFAULTS);
    expect(worldStyleOf({ style: { scalePreset: 'storybook' } }).coastDrama)
      .toBe(SCALE_PROFILES.storybook.coastDrama);
  });
});

// ── S1: coastDrama threading through the island resolver ──────────────────────

describe('world-style S1 — styled island spec (coastDrama)', () => {
  it('applyCoastDrama is a no-op at the neutral value (same instance)', () => {
    const spec = resolveIslandSpec(true);
    expect(applyCoastDrama(spec, 1)).toBe(spec); // identical ref → identical signature
    expect(applyCoastDrama(null, 1.6)).toBeNull();
  });

  it('applyCoastDrama scales the dome swell', () => {
    const out = applyCoastDrama(DEFAULT_ISLAND, 1.5);
    expect(out?.dome).toBeCloseTo((DEFAULT_ISLAND.dome ?? 0) * 1.5, 6);
    expect(out?.start).toBe(DEFAULT_ISLAND.start); // band unchanged
    expect(out?.end).toBe(DEFAULT_ISLAND.end);
  });

  it('styledIslandSpec is byte-identical to resolveIslandSpec for an unstyled world', () => {
    const seed = { island: true as const };
    expect(islandSignature(styledIslandSpec(seed)))
      .toBe(islandSignature(resolveIslandSpec(true)));
  });

  it('styledIslandSpec applies the world’s coastDrama knob', () => {
    const styled = styledIslandSpec({ island: true, style: { overrides: { coastDrama: 2 } } });
    expect(styled?.dome).toBeCloseTo((DEFAULT_ISLAND.dome ?? 0) * 2, 6);
  });

  it('a non-island world stays null regardless of coastDrama', () => {
    expect(styledIslandSpec({ style: { scalePreset: 'storybook' } })).toBeNull();
  });
});

// ── S1: terrain-field reads the vertical knobs from the resolved style ─────────

function styledMap(style?: WorldStyleConfig): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 8; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 8; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  const worldSeed: WorldSeed = {
    name: 't', size: { width: 8, height: 8 }, biome: 'temperate',
    pois: [], connections: [], constraints: [], style,
  };
  return {
    tiles, width: 8, height: 8, villages: [], seed: 1234, success: true,
    worldSeed, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

describe('world-style S1 — buildTerrainField vertical knobs', () => {
  const opts = {
    viewport: [800, 600] as [number, number],
    xform: { sx: 1, sy: 1, ox: 0, oy: 0 },
    lighting: DEFAULT_LIGHTING,
  };

  it('defaults to the seed constants when no style is set', () => {
    const g = buildTerrainField(styledMap(), opts).globals;
    expect(g.zPxPerM).toBe(TERRAIN_Z_PX_PER_M);
    expect(g.reliefM).toBe(TERRAIN_RELIEF_M);
  });

  it('reads the storybook preset’s exaggeration + relief', () => {
    const g = buildTerrainField(styledMap({ scalePreset: 'storybook' }), opts).globals;
    expect(g.zPxPerM).toBe(SCALE_PROFILES.storybook.terrainVerticalExaggeration);
    expect(g.reliefM).toBe(SCALE_PROFILES.storybook.mountainRelief);
  });

  it('per-knob override wins on the live render path', () => {
    const g = buildTerrainField(styledMap({ overrides: { terrainVerticalExaggeration: 40 } }), opts).globals;
    expect(g.zPxPerM).toBe(40);
  });
});
