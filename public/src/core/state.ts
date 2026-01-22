/**
 * Small Gods - Global State Management
 */

import type { GameState, Costs, WorldSeed } from '../types';
import { PRICES } from './constants';

// Cost tracking
export const costs: Costs = { paint: 0, npcs: 0, zoom: 0 };

// Global game state
export const state: GameState = {
  map: null,
  npcs: [],
  layer: 'map',
  images: { segment: null, painted: null, final: null },
  controlImages: { segmentation: null, edge: null },
  simulation: { running: false, frameId: null },
  camera: { x: 0, y: 0, zoom: 1, dragging: false, lastX: 0, lastY: 0, startX: 0, startY: 0 },
  worldSeed: null,
};

/**
 * Default World Seed Configuration
 *
 * Terrain zones bias WFC generation, then settlements are placed on suitable terrain.
 */
export const DEFAULT_WORLD_SEED: WorldSeed = {
  name: 'Verdant Vale',
  description: 'A realm of misty forests, crystal lakes, treacherous swamps, and rolling meadows. Ancient ruins dot the landscape.',

  size: { width: 36, height: 28 },
  biome: 'temperate',

  visualTheme: 'fantasy medieval world, vibrant colors',

  pois: [
    // === TERRAIN ZONES ===
    {
      id: 'whispering_woods',
      type: 'forest',
      name: 'Whispering Woods',
      region: { x_min: 0, x_max: 12, y_min: 0, y_max: 10 },
      density: 0.4,
      description: 'Ancient woodland with scattered clearings.',
    },
    {
      id: 'crystal_lake',
      type: 'lake',
      name: 'Crystal Lake',
      region: { x_min: 24, x_max: 34, y_min: 18, y_max: 26 },
      density: 0.5,
      description: 'A pristine lake fed by mountain springs.',
    },
    {
      id: 'murkmire_swamp',
      type: 'swamp',
      name: 'Murkmire Swamp',
      region: { x_min: 0, x_max: 8, y_min: 20, y_max: 27 },
      density: 0.4,
      description: 'A marshy lowland with scattered dead trees.',
    },
    {
      id: 'eastern_peaks',
      type: 'mountain',
      name: 'Eastern Peaks',
      region: { x_min: 30, x_max: 35, y_min: 0, y_max: 12 },
      density: 0.5,
      description: 'Rocky highlands with occasional peaks.',
    },
    {
      id: 'golden_meadows',
      type: 'plains',
      name: 'Golden Meadows',
      region: { x_min: 10, x_max: 28, y_min: 6, y_max: 20 },
      density: 0.7,
      description: 'Rolling meadows perfect for farming.',
    },

    // === SETTLEMENTS ===
    {
      id: 'oakshire',
      type: 'village',
      name: 'Oakshire',
      position: { x: 18, y: 14 },
      size: 'medium',
      description: 'A prosperous farming village.',
      npcs: [
        { name: 'Elder Bramwell', role: 'village elder' },
        { name: 'Rosa the Baker', role: 'baker' },
      ],
    },
    {
      id: 'old_watchtower',
      type: 'tower',
      name: 'The Old Watchtower',
      position: { x: 30, y: 8 },
      size: 'small',
      description: 'An ancient tower on the mountain slopes.',
    },
    {
      id: 'millbrook_farm',
      type: 'farm',
      name: 'Millbrook Farm',
      position: { x: 14, y: 16 },
      size: 'medium',
      description: 'The largest farm in the valley.',
    },
    {
      id: 'crossroads_inn',
      type: 'tavern',
      name: 'The Wandering Minstrel',
      position: { x: 22, y: 12 },
      size: 'small',
      description: 'A welcoming inn at the crossroads.',
    },
    {
      id: 'lakeside_dock',
      type: 'port',
      name: "Fisher's Rest",
      position: { x: 24, y: 18 },
      size: 'small',
      description: 'A small fishing dock on the lake.',
    },
    {
      id: 'forest_ruins',
      type: 'ruins',
      name: 'Temple of the Moon',
      position: { x: 6, y: 6 },
      size: 'medium',
      description: 'Overgrown ruins in the forest depths.',
    },
    {
      id: 'swamp_shrine',
      type: 'ruins',
      name: 'The Sunken Shrine',
      position: { x: 4, y: 22 },
      size: 'small',
      description: 'Ancient stones rising from the mire.',
    },
  ],

  connections: [
    { from: 'oakshire', to: 'millbrook_farm', style: 'dirt' },
    { from: 'oakshire', to: 'crossroads_inn', style: 'dirt' },
    { from: 'crossroads_inn', to: 'old_watchtower', style: 'dirt' },
    { from: 'crossroads_inn', to: 'lakeside_dock', style: 'dirt' },
    { from: 'oakshire', to: 'forest_ruins', style: 'dirt' },
  ],

  roadEndpoints: [
    { direction: 'east', destination: 'The Eastern Kingdoms', style: 'dirt' },
    { direction: 'south', destination: 'The Southern Coast', style: 'dirt' },
    { direction: 'north', destination: 'The Northern Reaches', style: 'dirt' },
  ],

  lore: {
    history: 'Verdant Vale was settled three centuries ago by refugees fleeing the Great Collapse.',
    quests: [
      { name: 'The Missing Shepherd', difficulty: 'easy' },
      { name: 'Secrets of the Sunken Shrine', difficulty: 'hard' },
    ],
    rumors: [
      'Strange lights dance in the Murkmire Swamp at night',
      'The ruins hold secrets of the old gods',
    ],
  },
};

// Re-export PRICES for convenience
export { PRICES };
