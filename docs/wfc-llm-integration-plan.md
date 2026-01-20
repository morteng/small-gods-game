# Small Gods - WFC + LLM World Generation Plan

## Overview

Upgrade from noise-based procedural generation to Wave Function Collapse (WFC) with LLM-driven world seeding. This enables natural language world descriptions like "a coastal kingdom with fishing villages and a mountain fortress" to generate coherent, rule-respecting maps.

## Current vs Proposed

| Aspect | Current (Noise) | Proposed (WFC + LLM) |
|--------|-----------------|----------------------|
| Algorithm | Fractal noise thresholds | Constraint propagation |
| Control | Sliders (density, water) | Natural language + rules |
| Coherence | Random clustering | Enforced adjacency rules |
| POIs | Random village placement | LLM-designated locations |
| Extensibility | Limited | Tile rules + LLM prompts |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     USER INTERFACE                          │
│  ┌─────────────────┐  ┌──────────────────────────────────┐ │
│  │ World Seed      │  │ Visual Map Editor                │ │
│  │ Editor (JSON)   │  │ - Place POIs by clicking         │ │
│  │ - Edit POIs     │  │ - Draw regions                   │ │
│  │ - Add constraints│  │ - Preview constraints           │ │
│  └────────┬────────┘  └──────────────────────────────────┘ │
└───────────┼──────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│                  LLM PARSER (Optional)                      │
│  Input: "A peaceful farming region with 3 villages          │
│          connected by roads, forest to the north"           │
│                                                             │
│  Output: World Seed JSON (see below)                        │
└───────────┬─────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│                    WORLD SEED FORMAT                        │
│  {                                                          │
│    "name": "Peaceful Farmland",                             │
│    "size": { "width": 32, "height": 24 },                  │
│    "biome": "temperate",                                    │
│    "pois": [                                                │
│      { "id": "village_1", "type": "village",               │
│        "position": { "x": 10, "y": 12 },                   │
│        "size": "medium", "name": "Oakdale" },              │
│      { "id": "forest_north", "type": "forest",             │
│        "region": { "y_max": 8 }, "density": 0.7 }          │
│    ],                                                       │
│    "connections": [                                         │
│      { "from": "village_1", "to": "village_2", "type": "road" }
│    ],                                                       │
│    "constraints": [                                         │
│      "no_water_in_center",                                  │
│      "roads_avoid_forests"                                  │
│    ]                                                        │
│  }                                                          │
└───────────┬─────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│                 CONSTRAINT COMPILER                         │
│  Converts World Seed → WFC Configuration                    │
│  - POIs → Fixed seed tiles                                  │
│  - Regions → Tile weight modifiers                          │
│  - Connections → Path constraints                           │
│  - Constraints → Adjacency rule overrides                   │
└───────────┬─────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│                    WFC ENGINE                               │
│  1. Initialize grid with all possibilities                  │
│  2. Place seed tiles (POIs) - entropy = 0                   │
│  3. Propagate constraints from seeds                        │
│  4. Collapse lowest entropy cell                            │
│  5. Propagate, repeat until complete                        │
│  6. Backtrack if contradiction (rare with good rules)       │
└───────────┬─────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│              ISOMETRIC RENDERER (existing)                  │
│  - Renders tile map to canvas                               │
│  - Optional AI painting with Replicate                      │
└─────────────────────────────────────────────────────────────┘
```

## Tile System

### Core Tile Types
```javascript
const TILES = {
  // Terrain
  deep_water:    { weight: 0.10, walkable: false, height: 0 },
  shallow_water: { weight: 0.08, walkable: false, height: 0 },
  sand:          { weight: 0.05, walkable: true,  height: 0 },
  grass:         { weight: 0.30, walkable: true,  height: 0 },
  forest:        { weight: 0.20, walkable: true,  height: 0, blocking: true },
  hills:         { weight: 0.05, walkable: true,  height: 1 },
  mountain:      { weight: 0.03, walkable: false, height: 3 },

  // Structures
  dirt_road:     { weight: 0.08, walkable: true,  height: 0 },
  stone_road:    { weight: 0.03, walkable: true,  height: 0 },
  bridge:        { weight: 0.01, walkable: true,  height: 0, over_water: true },
  building_wood: { weight: 0.04, walkable: false, height: 2 },
  building_stone:{ weight: 0.02, walkable: false, height: 3 },
  castle_wall:   { weight: 0.01, walkable: false, height: 4 },
  castle_tower:  { weight: 0.005, walkable: false, height: 5 },

  // Special
  farm_field:    { weight: 0.03, walkable: true,  height: 0 },
  market:        { weight: 0.01, walkable: true,  height: 0 },
  dock:          { weight: 0.01, walkable: true,  height: 0, requires: 'water_adjacent' }
};
```

### Adjacency Rules
```javascript
const ADJACENCY = {
  deep_water:    ['deep_water', 'shallow_water'],
  shallow_water: ['deep_water', 'shallow_water', 'sand', 'dock'],
  sand:          ['shallow_water', 'sand', 'grass'],
  grass:         ['sand', 'grass', 'forest', 'hills', 'dirt_road', 'farm_field', 'building_wood'],
  forest:        ['grass', 'forest', 'hills'],
  hills:         ['grass', 'forest', 'hills', 'mountain', 'dirt_road'],
  mountain:      ['hills', 'mountain', 'castle_wall'],

  dirt_road:     ['grass', 'dirt_road', 'stone_road', 'hills', 'building_wood', 'bridge', 'farm_field'],
  stone_road:    ['dirt_road', 'stone_road', 'building_stone', 'castle_wall', 'market'],
  bridge:        ['dirt_road', 'shallow_water'],  // Special: bridges connect roads over water

  building_wood: ['grass', 'dirt_road', 'building_wood', 'farm_field'],
  building_stone:['stone_road', 'building_stone', 'castle_wall'],
  castle_wall:   ['mountain', 'stone_road', 'castle_wall', 'castle_tower', 'building_stone'],
  castle_tower:  ['castle_wall'],

  farm_field:    ['grass', 'dirt_road', 'farm_field', 'building_wood'],
  market:        ['stone_road'],
  dock:          ['shallow_water', 'dirt_road', 'building_wood']
};
```

## World Seed JSON Schema

```typescript
interface WorldSeed {
  name: string;
  description?: string;

  size: {
    width: number;   // 16-64
    height: number;  // 16-48
  };

  biome: 'temperate' | 'desert' | 'arctic' | 'tropical' | 'volcanic';

  pois: POI[];
  connections: Connection[];
  constraints: string[];

  // Optional: override tile weights for this world
  tileWeights?: Record<string, number>;
}

interface POI {
  id: string;
  type: 'village' | 'city' | 'castle' | 'forest' | 'lake' | 'mountain' |
        'farm' | 'port' | 'ruins' | 'temple' | 'mine';

  // Exact position OR region
  position?: { x: number; y: number };
  region?: {
    x_min?: number; x_max?: number;
    y_min?: number; y_max?: number;
  };

  // POI-specific properties
  size?: 'small' | 'medium' | 'large';
  density?: number;  // 0-1 for forest/water
  name?: string;
  importance?: 'low' | 'medium' | 'high' | 'critical';
}

interface Connection {
  from: string;  // POI id
  to: string;    // POI id
  type: 'road' | 'river' | 'wall';
  style?: 'dirt' | 'stone' | 'bridge';
}
```

## LLM Prompt Template

```markdown
You are a world seed generator for an isometric fantasy game. Given a natural
language description of a world, output a JSON world seed.

## Available POI Types
- village: Small settlement (3-5 buildings + roads)
- city: Large settlement (10+ buildings, stone roads, market)
- castle: Fortified structure (walls, towers, on high ground)
- forest: Dense tree coverage
- lake: Body of water
- mountain: Impassable peaks (good for castle placement)
- farm: Agricultural area near villages
- port: Coastal settlement with docks
- ruins: Ancient structures
- temple: Religious building
- mine: Resource extraction site

## Constraints Available
- no_water_in_region(region)
- force_water_in_region(region)
- roads_connect_all_settlements
- castle_on_high_ground
- ports_require_coast
- forests_cluster
- rivers_flow_to_water

## Example

Input: "A coastal trading town with fishing villages to the north and a
        protective forest to the east"

Output:
```json
{
  "name": "Coastal Trading Region",
  "size": { "width": 32, "height": 24 },
  "biome": "temperate",
  "pois": [
    {
      "id": "trading_town",
      "type": "city",
      "position": { "x": 16, "y": 16 },
      "size": "large",
      "name": "Harborview"
    },
    {
      "id": "fishing_village_1",
      "type": "port",
      "region": { "y_max": 8 },
      "size": "small"
    },
    {
      "id": "fishing_village_2",
      "type": "port",
      "region": { "y_max": 8 },
      "size": "small"
    },
    {
      "id": "eastern_forest",
      "type": "forest",
      "region": { "x_min": 24 },
      "density": 0.8
    },
    {
      "id": "coast",
      "type": "lake",
      "region": { "y_max": 6 },
      "density": 1.0
    }
  ],
  "connections": [
    { "from": "trading_town", "to": "fishing_village_1", "type": "road" },
    { "from": "trading_town", "to": "fishing_village_2", "type": "road" }
  ],
  "constraints": [
    "roads_connect_all_settlements",
    "ports_require_coast"
  ]
}
```

Now generate a world seed for: {USER_INPUT}
```

## Implementation Phases

### Phase 1: WFC Core Engine
- [ ] Implement Tile class with adjacency rules
- [ ] Implement Grid class with entropy tracking
- [ ] Implement Propagator (constraint propagation)
- [ ] Implement Solver (collapse + backtrack)
- [ ] Test with basic tile set

### Phase 2: World Seed System
- [ ] Define World Seed JSON schema
- [ ] Implement seed parser
- [ ] Implement POI → tile placement
- [ ] Implement region constraints
- [ ] Add path-finding for connections (roads)

### Phase 3: LLM Integration
- [ ] Create LLM prompt template
- [ ] Add Claude/GPT API integration
- [ ] Parse LLM output to World Seed
- [ ] Add validation + error handling
- [ ] Test with various descriptions

### Phase 4: UI Integration
- [ ] Add World Seed editor panel
- [ ] JSON editor with syntax highlighting
- [ ] Visual POI placement on map
- [ ] Region drawing tools
- [ ] Import/export world seeds
- [ ] "Generate from description" button

### Phase 5: Polish
- [ ] Optimize WFC performance
- [ ] Add generation progress visualization
- [ ] Multiple biome tile sets
- [ ] Save/load world seeds
- [ ] Share world seeds

## File Structure

```
/src
├── /wfc
│   ├── Tile.js           # Tile definitions + adjacency
│   ├── Grid.js           # 2D grid with cells
│   ├── Cell.js           # Single cell with possibilities
│   ├── Propagator.js     # Constraint propagation (AC-4)
│   ├── Solver.js         # Entropy calculation + collapse
│   └── WFCEngine.js      # Main orchestrator
│
├── /worldseed
│   ├── Schema.js         # JSON schema + validation
│   ├── Parser.js         # Parse world seed to WFC config
│   ├── POIResolver.js    # Convert POIs to tile placements
│   ├── PathFinder.js     # A* for road connections
│   └── RegionConstraint.js
│
├── /llm
│   ├── PromptTemplate.js # LLM prompt construction
│   ├── ResponseParser.js # Parse LLM JSON output
│   └── Integration.js    # API calls to Claude/GPT
│
├── /ui
│   ├── WorldSeedEditor.js
│   ├── JSONEditor.js
│   ├── POIPlacer.js
│   └── RegionDrawer.js
│
└── /render
    └── IsometricRenderer.js  # (existing, enhanced)
```

## Example World Seeds

### Simple Village
```json
{
  "name": "Starter Village",
  "size": { "width": 24, "height": 18 },
  "biome": "temperate",
  "pois": [
    { "id": "village", "type": "village", "position": { "x": 12, "y": 9 } }
  ],
  "connections": [],
  "constraints": []
}
```

### Trading Route
```json
{
  "name": "The King's Road",
  "size": { "width": 48, "height": 24 },
  "biome": "temperate",
  "pois": [
    { "id": "castle", "type": "castle", "position": { "x": 8, "y": 12 }, "name": "Ironhold" },
    { "id": "city", "type": "city", "position": { "x": 40, "y": 12 }, "name": "Marketton" },
    { "id": "village_1", "type": "village", "position": { "x": 20, "y": 8 } },
    { "id": "village_2", "type": "village", "position": { "x": 28, "y": 16 } }
  ],
  "connections": [
    { "from": "castle", "to": "village_1", "type": "road", "style": "stone" },
    { "from": "village_1", "to": "village_2", "type": "road" },
    { "from": "village_2", "to": "city", "type": "road", "style": "stone" }
  ],
  "constraints": ["castle_on_high_ground"]
}
```

### Island Kingdom
```json
{
  "name": "Isle of Storms",
  "size": { "width": 32, "height": 32 },
  "biome": "temperate",
  "pois": [
    { "id": "ocean", "type": "lake", "region": {}, "density": 0.4 },
    { "id": "port", "type": "port", "position": { "x": 16, "y": 24 }, "name": "Stormhaven" },
    { "id": "castle", "type": "castle", "position": { "x": 16, "y": 8 }, "name": "The Citadel" },
    { "id": "forest", "type": "forest", "region": { "x_min": 20, "y_min": 10, "y_max": 20 }, "density": 0.7 }
  ],
  "connections": [
    { "from": "port", "to": "castle", "type": "road", "style": "stone" }
  ],
  "constraints": ["castle_on_high_ground", "ports_require_coast"]
}
```

## Performance Targets

- 24x18 map: < 100ms generation
- 48x36 map: < 500ms generation
- 64x48 map: < 2s generation (with progress indicator)

## References

- [Wave Function Collapse Explained](https://www.boristhebrave.com/2020/04/13/wave-function-collapse-explained/)
- [mxgmn/WaveFunctionCollapse](https://github.com/mxgmn/WaveFunctionCollapse)
- [Level Generation Through LLMs](https://arxiv.org/abs/2302.05817)
