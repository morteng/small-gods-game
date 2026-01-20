# MCP Server Architecture

How Small Gods integrates with MCP clients.

---

## Overview

Small Gods runs as an MCP server. The player interacts through any MCP-compatible client (Claude Desktop, VS Code, etc.). The game exposes:

1. **Tools** - Player actions (whisper, miracle, etc.)
2. **Resources** - World state views (ui:// for iframes)
3. **Prompts** - Pre-built commands (quick actions)

```
┌─────────────────────────────────────────────────────┐
│                   MCP CLIENT                        │
│            (Claude Desktop, VS Code, etc.)          │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │                   CHAT                        │  │
│  │  User: "Whisper to Kira about visiting Tam"  │  │
│  │  Claude: [calls whisper tool]                │  │
│  │  Result: "Kira stirs in her sleep..."        │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │              IFRAME (MCP Apps)                │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │ 🌳🌳 🏠🏠 🌾 ⛰️                         │  │  │
│  │  │ 🌳  👤🙏  🌾 ⛰️🏛️                       │  │  │
│  │  │     🐑👤   🌊🌊                          │  │  │
│  │  │                                         │  │  │
│  │  │ Power: 67 | Believers: 23 | Year: 47    │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────┘
                       │ MCP Protocol
                       │ (JSON-RPC over stdio/SSE)
                       ▼
┌─────────────────────────────────────────────────────┐
│               SMALL GODS MCP SERVER                 │
│                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   TOOLS     │  │  RESOURCES  │  │   PROMPTS   │  │
│  │  whisper    │  │  ui://map   │  │  /status    │  │
│  │  miracle    │  │  ui://story │  │  /stories   │  │
│  │  bless      │  │  ui://stats │  │  /advance   │  │
│  │  ...        │  │  ...        │  │  ...        │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│                                                     │
│  ┌─────────────────────────────────────────────────┐│
│  │              GAME ENGINE                        ││
│  │  World State | Simulation | LLM Integration    ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

---

## Project Structure

```
small-gods-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # MCP server setup
│   │
│   ├── mcp/
│   │   ├── tools.ts          # Tool definitions
│   │   ├── resources.ts      # Resource definitions
│   │   └── prompts.ts        # Prompt definitions
│   │
│   ├── game/
│   │   ├── engine.ts         # Main game loop
│   │   ├── world.ts          # World state management
│   │   ├── villager.ts       # Villager simulation
│   │   ├── story.ts          # Story system
│   │   ├── belief.ts         # Belief calculations
│   │   ├── god.ts            # God/player state
│   │   ├── events.ts         # Event generation
│   │   └── actions.ts        # Player action handlers
│   │
│   ├── llm/
│   │   ├── client.ts         # LLM API client
│   │   ├── prompts.ts        # Prompt templates
│   │   ├── simulation.ts     # World simulation via LLM
│   │   └── parser.ts         # Response parsing
│   │
│   ├── ui/
│   │   ├── renderer.ts       # World → HTML rendering
│   │   ├── templates/
│   │   │   ├── map.html      # World map view
│   │   │   ├── story.html    # Story detail view
│   │   │   └── status.html   # Stats/status view
│   │   └── styles.css        # Shared styles
│   │
│   └── utils/
│       ├── ids.ts            # ID generation
│       ├── random.ts         # Seeded RNG
│       └── emoji.ts          # Emoji mapping
│
├── data/
│   ├── names.json            # Name lists
│   ├── events.json           # Event templates
│   └── personalities.json    # Personality presets
│
└── saves/                    # Game saves (gitignored)
```

---

## MCP Tools

### Tool Definitions

```typescript
// src/mcp/tools.ts

import { Tool } from "@modelcontextprotocol/sdk/types";

export const tools: Tool[] = [
  // === PLAYER ACTIONS ===

  {
    name: "whisper",
    description: "Send a thought or urge to a villager. They may or may not heed it.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Villager name or ID"
        },
        message: {
          type: "string",
          description: "The thought/urge to plant (keep brief)"
        }
      },
      required: ["target", "message"]
    }
  },

  {
    name: "miracle",
    description: "Perform a supernatural act. Costs power. Witnesses may create stories.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["rain", "sun", "healing", "fertility", "protection", "destruction", "vision", "sign"],
          description: "Type of miracle"
        },
        target: {
          type: "string",
          description: "Villager name, location 'x,y', or 'village'"
        },
        scale: {
          type: "string",
          enum: ["tiny", "small", "medium", "large"],
          default: "small",
          description: "Scale affects power cost and visibility"
        }
      },
      required: ["type"]
    }
  },

  {
    name: "bless",
    description: "Grant ongoing favor to a person, place, or thing.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Villager name, location, 'crops', or 'livestock'"
        },
        duration: {
          type: "number",
          default: 10,
          description: "How many turns the blessing lasts"
        }
      },
      required: ["target"]
    }
  },

  {
    name: "curse",
    description: "Inflict misfortune on a target. May backfire narratively.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Villager name or location"
        },
        type: {
          type: "string",
          enum: ["misfortune", "illness", "barren", "haunted"],
          default: "misfortune"
        }
      },
      required: ["target"]
    }
  },

  {
    name: "manifest",
    description: "Appear to a villager in some form.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Villager to appear to"
        },
        form: {
          type: "string",
          enum: ["dream", "apparition", "animal", "avatar"],
          description: "How you appear (dream is cheapest)"
        },
        message: {
          type: "string",
          description: "Optional message to convey"
        }
      },
      required: ["target", "form"]
    }
  },

  {
    name: "empower_prophet",
    description: "Grant a believer the ability to speak with your authority.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Villager to empower (must be a believer)"
        }
      },
      required: ["target"]
    }
  },

  // === INFORMATION ===

  {
    name: "observe",
    description: "View current world state, villagers, or stories.",
    inputSchema: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          enum: ["world", "villager", "story", "stories", "believers", "events"],
          default: "world"
        },
        target: {
          type: "string",
          description: "Specific villager or story name/ID (if focus requires it)"
        }
      }
    }
  },

  // === GAME CONTROL ===

  {
    name: "advance",
    description: "Advance time by one or more turns. The world simulates.",
    inputSchema: {
      type: "object",
      properties: {
        turns: {
          type: "number",
          default: 1,
          minimum: 1,
          maximum: 10,
          description: "How many turns to advance"
        }
      }
    }
  },

  {
    name: "save_game",
    description: "Save the current game state.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Save file name"
        }
      },
      required: ["name"]
    }
  },

  {
    name: "load_game",
    description: "Load a saved game.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Save file name"
        }
      },
      required: ["name"]
    }
  },

  {
    name: "new_game",
    description: "Start a new game.",
    inputSchema: {
      type: "object",
      properties: {
        seed: {
          type: "number",
          description: "Random seed (optional, for reproducibility)"
        },
        difficulty: {
          type: "string",
          enum: ["easy", "normal", "hard"],
          default: "normal"
        }
      }
    }
  }
];
```

### Tool Handlers

```typescript
// src/mcp/tools.ts (continued)

export async function handleTool(
  name: string,
  args: Record<string, unknown>,
  game: GameEngine
): Promise<ToolResult> {
  switch (name) {
    case "whisper":
      return await game.whisper(
        args.target as string,
        args.message as string
      );

    case "miracle":
      return await game.miracle(
        args.type as MiracleType,
        args.target as string | undefined,
        args.scale as MiracleScale
      );

    case "bless":
      return await game.bless(
        args.target as string,
        args.duration as number
      );

    case "curse":
      return await game.curse(
        args.target as string,
        args.type as CurseType
      );

    case "manifest":
      return await game.manifest(
        args.target as string,
        args.form as ManifestForm,
        args.message as string | undefined
      );

    case "empower_prophet":
      return await game.empowerProphet(args.target as string);

    case "observe":
      return game.observe(
        args.focus as ObserveFocus,
        args.target as string | undefined
      );

    case "advance":
      return await game.advanceTurns(args.turns as number || 1);

    case "save_game":
      return game.saveGame(args.name as string);

    case "load_game":
      return game.loadGame(args.name as string);

    case "new_game":
      return game.newGame(args.seed as number, args.difficulty as Difficulty);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

interface ToolResult {
  success: boolean;
  content: string;           // Main response text
  data?: Record<string, any>; // Structured data
  ui_update?: boolean;       // Should client refresh UI?
}
```

---

## MCP Resources (UI)

### Resource Definitions

```typescript
// src/mcp/resources.ts

import { Resource } from "@modelcontextprotocol/sdk/types";

export const resources: Resource[] = [
  {
    uri: "ui://world-map",
    name: "World Map",
    description: "Emoji grid view of the world",
    mimeType: "text/html"
  },
  {
    uri: "ui://status",
    name: "God Status",
    description: "Power level, believers, and abilities",
    mimeType: "text/html"
  },
  {
    uri: "ui://stories",
    name: "Story List",
    description: "All active stories and their status",
    mimeType: "text/html"
  },
  {
    uri: "ui://villagers",
    name: "Villager List",
    description: "List of villagers and their belief states",
    mimeType: "text/html"
  },
  {
    uri: "ui://events",
    name: "Event Log",
    description: "Recent world events",
    mimeType: "text/html"
  },
  {
    uri: "ui://story/{id}",
    name: "Story Detail",
    description: "Detailed view of a specific story",
    mimeType: "text/html"
  },
  {
    uri: "ui://villager/{id}",
    name: "Villager Detail",
    description: "Detailed view of a specific villager",
    mimeType: "text/html"
  }
];

export async function handleResource(
  uri: string,
  game: GameEngine
): Promise<ResourceContent> {
  const renderer = new UIRenderer(game.world);

  if (uri === "ui://world-map") {
    return {
      uri,
      mimeType: "text/html",
      text: renderer.renderWorldMap()
    };
  }

  if (uri === "ui://status") {
    return {
      uri,
      mimeType: "text/html",
      text: renderer.renderStatus()
    };
  }

  if (uri === "ui://stories") {
    return {
      uri,
      mimeType: "text/html",
      text: renderer.renderStoryList()
    };
  }

  if (uri.startsWith("ui://story/")) {
    const id = uri.replace("ui://story/", "");
    return {
      uri,
      mimeType: "text/html",
      text: renderer.renderStoryDetail(id)
    };
  }

  // ... etc

  throw new Error(`Unknown resource: ${uri}`);
}
```

### UI Renderer

```typescript
// src/ui/renderer.ts

export class UIRenderer {
  constructor(private world: WorldState) {}

  renderWorldMap(): string {
    const { map, villagers, shrines } = this.world;

    let grid = "";
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.tiles[y][x];
        grid += this.renderTile(tile, villagers, shrines);
      }
      grid += "\n";
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>${this.getStyles()}</style>
      </head>
      <body>
        <div class="game-ui">
          <div class="header">
            <span class="power">${this.getPowerEmoji()} ${this.world.god.power}</span>
            <span class="turn">Year ${this.world.year} - ${this.world.season}</span>
            <span class="believers">🙏 ${this.world.god.believers.length}</span>
          </div>
          <pre class="world-map">${grid}</pre>
          <div class="events">
            ${this.renderRecentEvents()}
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private renderTile(
    tile: Tile,
    villagers: Villager[],
    shrines: Shrine[]
  ): string {
    // Priority: villagers > structures > terrain
    const villagersHere = villagers.filter(
      v => v.currentLocation.x === tile.x &&
           v.currentLocation.y === tile.y &&
           v.isAlive
    );

    if (villagersHere.length > 0) {
      const believer = villagersHere.find(v => v.belief.strength > 0.5);
      return believer ? "🙏" : "👤";
    }

    const shrine = shrines.find(
      s => s.location.x === tile.x && s.location.y === tile.y
    );
    if (shrine) return "🏛️";

    if (tile.structure) {
      return this.structureEmoji(tile.structure);
    }

    return TERRAIN_EMOJI[tile.terrain];
  }

  private getPowerEmoji(): string {
    const power = this.world.god.power;
    if (power <= 10) return "🐢";
    if (power <= 30) return "🦎";
    if (power <= 100) return "🐍";
    if (power <= 300) return "🐉";
    return "⚡";
  }

  renderStatus(): string {
    const god = this.world.god;

    return `
      <!DOCTYPE html>
      <html>
      <head><style>${this.getStyles()}</style></head>
      <body>
        <div class="status-panel">
          <h2>${this.getPowerEmoji()} Your Divine Status</h2>

          <div class="stat-row">
            <span class="label">Power:</span>
            <span class="value">${god.power} / ${this.getNextTierThreshold()}</span>
            <div class="progress-bar">
              <div class="fill" style="width: ${this.getPowerProgress()}%"></div>
            </div>
          </div>

          <div class="stat-row">
            <span class="label">Believers:</span>
            <span class="value">${god.believers.length}</span>
          </div>

          <div class="stat-row">
            <span class="label">Shrines:</span>
            <span class="value">${god.shrines.length}</span>
          </div>

          <h3>Available Abilities</h3>
          <ul class="abilities">
            ${god.availableAbilities.map(a => `
              <li class="${a.powerCost > god.power ? 'disabled' : ''}">
                <strong>${a.name}</strong> (${a.powerCost} power)
                <p>${a.description}</p>
              </li>
            `).join("")}
          </ul>

          <h3>Stories About You</h3>
          <ul class="stories-brief">
            ${this.world.stories
              .filter(s => s.associatedGod === god.id)
              .slice(0, 5)
              .map(s => `
                <li>
                  📜 ${s.name}
                  <span class="fidelity">${Math.round(s.fidelity * 100)}% true</span>
                </li>
              `).join("")}
          </ul>
        </div>
      </body>
      </html>
    `;
  }

  renderStoryList(): string {
    const stories = this.world.stories.sort((a, b) =>
      b.carriers.length - a.carriers.length
    );

    return `
      <!DOCTYPE html>
      <html>
      <head><style>${this.getStyles()}</style></head>
      <body>
        <div class="story-list">
          <h2>📜 Stories of the World</h2>

          ${stories.map(s => `
            <div class="story-card ${s.status}">
              <div class="story-header">
                <span class="status-icon">${this.getStoryStatusIcon(s)}</span>
                <strong>${s.name}</strong>
              </div>
              <p class="current-telling">"${s.currentTelling.slice(0, 100)}..."</p>
              <div class="story-stats">
                <span>Gen ${s.generations}</span>
                <span>${Math.round(s.fidelity * 100)}% fidelity</span>
                <span>${s.carriers.length} know it</span>
              </div>
            </div>
          `).join("")}
        </div>
      </body>
      </html>
    `;
  }

  private getStoryStatusIcon(story: Story): string {
    switch (story.status) {
      case "active": return "●";
      case "endangered": return "⚠️";
      case "dead": return "💀";
      case "revived": return "✨";
      default: return "○";
    }
  }

  private getStyles(): string {
    return `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: monospace;
        background: #1a1a2e;
        color: #eee;
        padding: 10px;
      }
      .game-ui { max-width: 600px; }
      .header {
        display: flex;
        justify-content: space-between;
        padding: 8px;
        background: #16213e;
        border-radius: 4px;
        margin-bottom: 10px;
      }
      .world-map {
        font-size: 16px;
        line-height: 1.2;
        background: #0f0f23;
        padding: 10px;
        border-radius: 4px;
      }
      .events {
        margin-top: 10px;
        padding: 8px;
        background: #16213e;
        border-radius: 4px;
        font-size: 12px;
      }
      .story-card {
        background: #16213e;
        padding: 10px;
        margin: 8px 0;
        border-radius: 4px;
        border-left: 3px solid #4a5568;
      }
      .story-card.endangered { border-left-color: #f6ad55; }
      .story-card.dead { border-left-color: #fc8181; opacity: 0.6; }
      .current-telling {
        font-style: italic;
        color: #a0aec0;
        margin: 8px 0;
      }
      .story-stats {
        display: flex;
        gap: 15px;
        font-size: 11px;
        color: #718096;
      }
    `;
  }
}
```

---

## MCP Prompts

Pre-built commands for common actions:

```typescript
// src/mcp/prompts.ts

import { Prompt } from "@modelcontextprotocol/sdk/types";

export const prompts: Prompt[] = [
  {
    name: "status",
    description: "View your current divine status and the world state"
  },
  {
    name: "stories",
    description: "List all stories and their current state"
  },
  {
    name: "endangered",
    description: "Show stories at risk of being lost"
  },
  {
    name: "believers",
    description: "List your current believers"
  },
  {
    name: "advance",
    description: "Advance time by one turn",
    arguments: [
      {
        name: "turns",
        description: "Number of turns (default 1)",
        required: false
      }
    ]
  },
  {
    name: "help",
    description: "Show available commands and how to play"
  }
];

export function handlePrompt(
  name: string,
  args: Record<string, string>,
  game: GameEngine
): PromptMessage[] {
  switch (name) {
    case "status":
      return [{
        role: "user",
        content: {
          type: "text",
          text: "Show me my current status, power level, and a brief world overview."
        }
      }];

    case "stories":
      return [{
        role: "user",
        content: {
          type: "text",
          text: "List all the stories about me and their current state."
        }
      }];

    case "endangered":
      return [{
        role: "user",
        content: {
          type: "text",
          text: "Show me any stories that are at risk of being lost."
        }
      }];

    case "help":
      return [{
        role: "user",
        content: {
          type: "text",
          text: `
            # Small Gods - How to Play

            You are a small god trying to grow from nothing.

            ## Actions
            - **whisper** - Send thoughts to villagers
            - **miracle** - Perform supernatural acts (costs power)
            - **bless** / **curse** - Grant or inflict fortune
            - **manifest** - Appear to someone
            - **advance** - Let time pass

            ## Goals
            - Gain believers through stories
            - Keep stories alive across generations
            - Don't fade to nothing

            ## Tips
            - Miracles need witnesses to create stories
            - Stories mutate as they're retold
            - Elders dying can mean stories lost forever
            - Quality of belief matters more than quantity
          `
        }
      }];

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}
```

---

## Server Setup

```typescript
// src/server.ts

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { tools, handleTool } from "./mcp/tools.js";
import { resources, handleResource } from "./mcp/resources.js";
import { prompts, handlePrompt } from "./mcp/prompts.js";
import { GameEngine } from "./game/engine.js";

export async function startServer() {
  const server = new Server(
    {
      name: "small-gods",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  // Initialize game engine
  const game = new GameEngine();

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await handleTool(name, args || {}, game);

    return {
      content: [
        {
          type: "text",
          text: result.content,
        },
      ],
      isError: !result.success,
    };
  });

  // List resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources,
  }));

  // Read resource
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const content = await handleResource(request.params.uri, game);
    return {
      contents: [content],
    };
  });

  // List prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts,
  }));

  // Get prompt
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const messages = handlePrompt(
      request.params.name,
      request.params.arguments || {},
      game
    );
    return { messages };
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Small Gods MCP server running");
}
```

---

## Entry Point

```typescript
// src/index.ts

import { startServer } from "./server.js";

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
```

---

## Configuration

```json
// package.json
{
  "name": "small-gods-mcp",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@anthropic-ai/sdk": "^0.25.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "tsx": "^4.0.0",
    "@types/node": "^20.0.0"
  }
}
```

```json
// Claude Desktop config (~/.config/claude/claude_desktop_config.json)
{
  "mcpServers": {
    "small-gods": {
      "command": "node",
      "args": ["/path/to/small-gods-mcp/dist/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "your-key-here"
      }
    }
  }
}
```

---

*Document version: 0.1*
