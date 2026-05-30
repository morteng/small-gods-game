/**
 * Small Gods Developer Tools
 *
 * Project-local Pi extension with tools for developing the Small Gods game.
 *
 * Tools:
 *  - sg_test       — Run vitest/playwright tests with formatted output
 *  - sg_map_stats  — Generate a world and report tile/POI/road stats
 *  - sg_sim_tick   — Run N sim ticks headlessly and report state changes
 *  - sg_npc_prompt — Build an NPC LLM backfill prompt from current world state
 *  - sg_lint       — TypeScript check + lint summary
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ── Project root ────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(__filename), "../..");

// ── Helper: run a shell command and return { stdout, stderr, exitCode } ────
function run(
  cmd: string,
  opts: { cwd?: string; timeout?: number } = {},
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(cmd, {
      cwd: opts.cwd ?? PROJECT_ROOT,
      timeout: opts.timeout ?? 60_000,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout?.toString().trim() ?? "",
      stderr: e.stderr?.toString().trim() ?? e.message,
      exitCode: e.status ?? 1,
    };
  }
}

// ── Helper: safe JSON parse ────────────────────────────────────────────────
function tryJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ── Export ──────────────────────────────────────────────────────────────────
export default function smallGodsDevtools(pi: ExtensionAPI) {
  // ── Tool: sg_test ─────────────────────────────────────────────────────────
  pi.registerTool({
    name: "sg_test",
    label: "SG Test Runner",
    description: "Run tests (vitest unit/dom/integration or playwright e2e) with formatted pass/fail output",
    promptSnippet: "Run Small Gods tests and report results per file",
    promptGuidelines: [
      "Use sg_test when the user asks to run tests, check test results, or verify game code doesn't regress.",
      "Use sg_test with type='vitest' and file filter to run a subset of unit tests quickly.",
      "Use sg_test with type='playwright' for full e2e browser tests (slower).",
    ],
    parameters: Type.Object({
      type: Type.Union(
        [Type.Literal("vitest"), Type.Literal("playwright")],
        { description: "Test runner to use" },
      ),
      filter: Type.Optional(
        Type.String({ description: "Test file pattern filter (e.g. 'npc', 'timeline', 'wfc')" }),
      ),
      watch: Type.Optional(
        Type.Boolean({ description: "Run in watch mode (default: false)" }),
      ),
    }),
    async execute(_toolCallId, params) {
      if (params.type === "vitest") {
        const filterFlag = params.filter ? ` --reporter=verbose ${params.filter}` : "";
        const watchFlag = params.watch ? "" : " --run";
        const result = run(`npx vitest${watchFlag}${filterFlag}`, { timeout: 120_000 });

        // Parse vitest output for per-file results
        const lines = result.stdout.split("\n");
        const failedFiles: string[] = [];
        const passedFiles: string[] = [];
        let summaryLine = "";

        for (const line of lines) {
          if (line.includes(" ❗ ") || line.includes(" × ") || line.includes(" FAIL ")) {
            failedFiles.push(line.trim());
          } else if (line.includes(" ✓ ") || line.includes(" √ ") || line.includes(" PASS ")) {
            passedFiles.push(line.trim());
          }
          if (line.includes("Tests ") && (line.includes("passed") || line.includes("failed"))) {
            summaryLine = line.trim();
          }
        }

        const allPassed = result.exitCode === 0;
        const summary = summaryLine || `${result.exitCode === 0 ? "All tests passed" : "Some tests failed"}`;

        return {
          content: [
            {
              type: "text",
              text: [
                `## sg_test — ${params.type}`,
                allPassed ? "✅ All passed" : "❌ Some tests failed",
                "",
                summary,
                "",
                failedFiles.length > 0 ? `**Failed files (${failedFiles.length}):**\n${failedFiles.map((f) => `  - ${f}`).join("\n")}\n` : "",
                passedFiles.length > 0 ? `**Passed files (${passedFiles.length}):**\n${passedFiles.map((f) => `  - ${f}`).join("\n")}\n` : "",
                result.stderr ? `**Stderr:**\n\`\`\`\n${result.stderr.slice(0, 2000)}\n\`\`\`` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
          details: {
            exitCode: result.exitCode,
            passed: passedFiles.length,
            failed: failedFiles.length,
            filter: params.filter ?? "all",
          },
        };
      }

      // Playwright
      const filterFlag = params.filter ? ` --grep "${params.filter}"` : "";
      const result = run(`npx playwright test${filterFlag}`, { timeout: 300_000 });

      const lines = result.stdout.split("\n");
      const failed: string[] = [];
      const passed: string[] = [];
      let summary = "";

      for (const line of lines) {
        if (line.includes("✗") || line.includes("×") || line.includes("FAIL")) {
          failed.push(line.trim());
        } else if (line.includes("✓") || line.includes("√") || line.includes("PASS") || line.includes("passed")) {
          passed.push(line.trim());
        }
        if (line.includes("passed") && line.includes("failed")) {
          summary = line.trim();
        }
      }

      const allPassed = result.exitCode === 0;

      return {
        content: [
          {
            type: "text",
            text: [
              `## sg_test — ${params.type}`,
              allPassed ? "✅ All passed" : "❌ Some tests failed",
              "",
              summary || `${result.exitCode === 0 ? "All e2e tests passed" : "Some e2e tests failed"}`,
              "",
              failed.length > 0 ? `**Failed (${failed.length}):**\n${failed.map((f) => `  - ${f}`).join("\n")}\n` : "",
              passed.length > 0 ? `**Passed (${passed.length}):**\n${passed.map((f) => `  - ${f}`).join("\n")}\n` : "",
              result.stderr ? `**Stderr:**\n\`\`\`\n${result.stderr.slice(0, 2000)}\n\`\`\`` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
        details: {
          exitCode: result.exitCode,
          passed: passed.length,
          failed: failed.length,
          filter: params.filter ?? "all",
        },
      };
    },
  });

  // ── Tool: sg_map_stats ────────────────────────────────────────────────────
  pi.registerTool({
    name: "sg_map_stats",
    label: "SG Map Stats",
    description: "Generate a world and report tile/POI/road biomes, counts, and spatial statistics",
    promptSnippet: "Analyze Small Gods map generation statistics",
    promptGuidelines: [
      "Use sg_map_stats when investigating map generation quality, biome distribution, or POI placement.",
      "The tool generates a fresh world from a seed and reports tile-type counts, POI details, and road length.",
    ],
    parameters: Type.Object({
      seed: Type.Optional(
        Type.Number({ description: "World generation seed (default: random per run)" }),
      ),
    }),
    async execute(_toolCallId, params) {
      // Run map generation via tsx — executes a quick script that imports
      // the world generator and dumps stats as JSON
      const seed = params.seed ?? Math.floor(Math.random() * 2 ** 16);
      const script = `
const { createWorld } = await import("./src/world/world.ts");
const { sfc32 } = await import("./src/core/rng.ts");
const { GameState } = await import("./src/core/state.ts");
const { defaultWorldSeed } = await import("./src/core/schema.ts");

const rng = sfc32(${seed}, ${seed + 1}, ${seed + 2}, ${seed + 3});
const seedData = { ...defaultWorldSeed, seed: ${seed} };
const state = GameState.createWithWorld(rng, seedData);

// Collect tile stats
const map = state.map;
const tileCounts = {};
for (let y = 0; y < map.height; y++) {
  for (let x = 0; x < map.width; x++) {
    const tile = map.get(x, y);
    const t = tile?.terrain ?? "unknown";
    tileCounts[t] = (tileCounts[t] || 0) + 1;
  }
}

// POI stats
const pois = map.pois?.length ?? 0;

// Road/total connections
const connections = map.connections?.length ?? 0;

const stats = {
  seed: ${seed},
  mapSize: map.width + "x" + map.height,
  totalTiles: map.width * map.height,
  tileTypes: tileCounts,
  poiCount: pois,
  connectionCount: connections,
  roadCount: map.connections?.filter(c => c.type === "road").length ?? 0,
  waterPercent: ((tileCounts["water"] || 0) / (map.width * map.height) * 100).toFixed(1),
  forestPercent: ((tileCounts["forest"] || 0) / (map.width * map.height) * 100).toFixed(1),
  npcCount: state.world ? state.world.query({ kind: "npc" }).length : 0,
};

console.log(JSON.stringify(stats));
`;

      const result = run(`npx tsx --tsconfig tsconfig.json -e "${script.replace(/"/g, '\\"').replace(/\n/g, " ")}"`, {
        timeout: 30_000,
      });

      if (result.exitCode !== 0) {
        return {
          content: [{ type: "text", text: `❌ Map generation failed:\n\`\`\`\n${result.stderr.slice(0, 2000)}\n\`\`\`` }],
          details: { error: result.stderr },
          isError: true,
        };
      }

      const stats = tryJson(result.stdout);

      if (!stats || typeof stats !== "object") {
        return {
          content: [{ type: "text", text: `⚠️ Could not parse stats output:\n\`\`\`\n${result.stdout.slice(0, 2000)}\n\`\`\`` }],
          details: { raw: result.stdout.slice(0, 2000) },
        };
      }

      const s = stats as Record<string, unknown>;
      const tileTypes = s.tileTypes as Record<string, number> ?? {};
      const tileList = Object.entries(tileTypes)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `  ${type}: ${count} (${(Number(count) / (s.totalTiles as number) * 100).toFixed(1)}%)`)
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: [
              `## sg_map_stats — seed ${s.seed}`,
              "",
              `**Map:** ${s.mapSize} = ${s.totalTiles} tiles`,
              `**Biomes:**`,
              tileList,
              "",
              `**Water:** ${s.waterPercent}%  **Forest:** ${s.forestPercent}%`,
              `**POIs:** ${s.poiCount}  **Roads:** ${s.roadCount}  **Connections:** ${s.connectionCount}`,
              `**NPCs:** ${s.npcCount}`,
            ].join("\n"),
          },
        ],
        details: stats as Record<string, unknown>,
      };
    },
  });

  // ── Tool: sg_sim_tick ────────────────────────────────────────────────────
  pi.registerTool({
    name: "sg_sim_tick",
    label: "SG Sim Tick",
    description: "Run N sim ticks headlessly and report state changes (NPC beliefs, power, events)",
    promptSnippet: "Run headless sim ticks for debugging NPC behavior and belief propagation",
    promptGuidelines: [
      "Use sg_sim_tick to debug NPC belief propagation, power economy, event generation, or movement systems.",
      "The tool generates a fresh world, fast-forwards N ticks, then reports the state deltas.",
    ],
    parameters: Type.Object({
      ticks: Type.Optional(
        Type.Number({ description: "Number of sim ticks to run (default: 100)" }),
      ),
      seed: Type.Optional(
        Type.Number({ description: "World seed (default: random)" }),
      ),
    }),
    async execute(_toolCallId, params) {
      const ticks = params.ticks ?? 100;
      const seed = params.seed ?? Math.floor(Math.random() * 2 ** 16);
      const script = `
const { createWorld } = await import("./src/world/world.ts");
const { sfc32 } = await import("./src/core/rng.ts");
const { GameState } = await import("./src/core/state.ts");
const { defaultWorldSeed } = await import("./src/core/schema.ts");
const { SilentEventLog } = await import("./src/core/events.ts");
const { SimClock } = await import("./src/core/clock.ts");
const { spawnNpcs } = await import("./src/sim/spawner.ts");
const { tickSimSystems } = await import("./src/sim/npc-sim.ts");
const { createSocialGraph } = await import("./src/sim/social-graph.ts");

const rng = sfc32(${seed}, ${seed + 1}, ${seed + 2}, ${seed + 3});
const seedData = { ...defaultWorldSeed, seed: ${seed} };
const state = GameState.createWithWorld(rng, seedData);
const log = new SilentEventLog();

// Take snapshot before ticks
const spiritPre = {};
for (const [id, sp] of state.spirits) {
  spiritPre[id] = { power: sp.power, followerCount: sp.followers.length };
}

// Run ticks
for (let i = 0; i < ${ticks}; i++) {
  state.clock.advance(100);
  tickSimSystems(state.world, state.spirits, log, state.clock, rng);
}

// Collect post state
const spiritPost = {};
for (const [id, sp] of state.spirits) {
  spiritPost[id] = { power: sp.power, followerCount: sp.followers.length };
}

// NPC belief summaries
const npcSummaries = state.world.query({ kind: "npc" }).slice(0, 10).map(npc => {
  const p = npc.properties;
  return {
    id: npc.id,
    activity: p.currentActivity,
    mood: p.mood?.toFixed(3),
    beliefs: Object.fromEntries(
      Object.entries(p.beliefs || {}).map(([id, b]) => [id, { faith: b.faith?.toFixed(3), understanding: b.understanding?.toFixed(3) }])
    ),
    needs: p.needs ? Object.fromEntries(Object.entries(p.needs).map(([k, v]) => [k, Number(v).toFixed(3)])) : undefined,
  };
});

const result = {
  seed: ${seed},
  ticksRun: ${ticks},
  finalTick: state.clock.now(),
  eventCount: log.size(),
  spiritsBefore: spiritPre,
  spiritsAfter: spiritPost,
  npcCount: state.world.query({ kind: "npc" }).length,
  sampleNpcs: npcSummaries,
};
console.log(JSON.stringify(result));
`;

      const result = run(`npx tsx --tsconfig tsconfig.json -e "${script.replace(/"/g, '\\"').replace(/\n/g, " ")}"`, {
        timeout: 30_000,
      });

      if (result.exitCode !== 0) {
        return {
          content: [{ type: "text", text: `❌ Sim tick failed:\n\`\`\`\n${result.stderr.slice(0, 2000)}\n\`\`\`` }],
          details: { error: result.stderr },
          isError: true,
        };
      }

      const data = tryJson(result.stdout);
      if (!data || typeof data !== "object") {
        return {
          content: [{ type: "text", text: `⚠️ Could not parse sim output:\n\`\`\`\n${result.stdout.slice(0, 2000)}\n\`\`\`` }],
          details: { raw: result.stdout.slice(0, 2000) },
        };
      }

      const d = data as Record<string, unknown>;
      const pre = d.spiritsBefore as Record<string, any> ?? {};
      const post = d.spiritsAfter as Record<string, any> ?? {};
      const spiritChanges = Object.entries(post).map(([id, sp]) => {
        const prev = pre[id];
        const powerDelta = prev ? (sp.power - prev.power).toFixed(2) : "?";
        const followerDelta = prev ? sp.followerCount - prev.followerCount : 0;
        return `  ${id}: power ${prev?.power ?? "?"} → ${sp.power} (Δ${powerDelta}), followers ${prev?.followerCount ?? "?"} → ${sp.followerCount} (Δ${followerDelta > 0 ? "+" : ""}${followerDelta})`;
      }).join("\n");

      const npcs = d.sampleNpcs as any[] ?? [];
      const npcLines = npcs.map((n: any) => {
        const bel = n.beliefs
          ? Object.entries(n.beliefs).map(([id, b]: [string, any]) => `${id}: faith=${b.faith} understand=${b.understanding}`).join(", ")
          : "none";
        return `  ${n.id} [${n.activity}] mood=${n.mood} | beliefs: {${bel}}`;
      }).join("\n");

      return {
        content: [
          {
            type: "text",
            text: [
              `## sg_sim_tick — ${d.ticksRun} ticks (seed ${d.seed})`,
              `Final tick: ${d.finalTick}  Events: ${d.eventCount}  NPCs: ${d.npcCount}`,
              "",
              `**Spirit power changes:**`,
              spiritChanges,
              "",
              npcs.length > 0 ? `**Sample NPCs (${npcs.length}):**\n${npcLines}` : "**No NPCs**",
            ].join("\n"),
          },
        ],
        details: data as Record<string, unknown>,
      };
    },
  });

  // ── Tool: sg_npc_prompt ──────────────────────────────────────────────────
  pi.registerTool({
    name: "sg_npc_prompt",
    label: "SG NPC Prompt",
    description: "Build an NPC LLM backfill prompt from current world state — test the narrative prompt format",
    promptSnippet: "Build and preview NPC narrative backfill prompts for LLM integration",
    promptGuidelines: [
      "Use sg_npc_prompt when prototyping or debugging NPC backfill prompts for Phase 9 LLM integration.",
      "It generates a world, selects a random NPC, and formats their state into the ~500 token prompt template.",
      "Pass output=true to call an LLM and get actual generated narrative back.",
    ],
    parameters: Type.Object({
      seed: Type.Optional(
        Type.Number({ description: "World seed (default: random)" }),
      ),
      npcId: Type.Optional(
        Type.String({ description: "Specific NPC ID to prompt for (default: first NPC)" }),
      ),
    }),
    async execute(_toolCallId, params) {
      const seed = params.seed ?? Math.floor(Math.random() * 2 ** 16);
      const script = `
const { createWorld } = await import("./src/world/world.ts");
const { sfc32 } = await import("./src/core/rng.ts");
const { GameState } = await import("./src/core/state.ts");
const { defaultWorldSeed } = await import("./src/core/schema.ts");

const rng = sfc32(${seed}, ${seed + 1}, ${seed + 2}, ${seed + 3});
const seedData = { ...defaultWorldSeed, seed: ${seed} };
const state = GameState.createWithWorld(rng, seedData);

const npcs = state.world.query({ kind: "npc" });
const targetId = "${params.npcId ?? ""}" || (npcs[0]?.id ?? "none");
const npc = npcs.find(n => n.id === targetId) || npcs[0];

if (!npc) {
  console.log(JSON.stringify({ error: "No NPCs found in world" }));
  process.exit(1);
}

const p = npc.properties;
const promptSections = {
  npcCard: {
    name: npc.id,
    role: p.role,
    settlement: p.settlement,
    personality: p.personality,
    mood: p.mood,
    currentActivity: p.currentActivity,
  },
  beliefs: p.beliefs ? Object.fromEntries(
    Object.entries(p.beliefs).map(([id, b]) => [id, { faith: Number(b.faith).toFixed(2), understanding: Number(b.understanding).toFixed(2), devotion: Number(b.devotion).toFixed(2) }])
  ) : {},
  needs: p.needs ? Object.fromEntries(
    Object.entries(p.needs).map(([k, v]) => [k, Number(v).toFixed(2)])
  ) : {},
  recentEvents: (p.recentEvents || []).slice(-5),
  relationships: (p.relationships || []).slice(0, 5).map(r => ({ npcId: r.npcId, type: r.type, trust: Number(r.trust).toFixed(2) })),
};
console.log(JSON.stringify({ npcId: npc.id, promptSections, npcCount: npcs.length }));
`;

      const result = run(`npx tsx --tsconfig tsconfig.json -e "${script.replace(/"/g, '\\"').replace(/\n/g, " ")}"`, {
        timeout: 30_000,
      });

      if (result.exitCode !== 0) {
        return {
          content: [{ type: "text", text: `❌ NPC prompt build failed:\n\`\`\`\n${result.stderr.slice(0, 2000)}\n\`\`\`` }],
          details: { error: result.stderr },
          isError: true,
        };
      }

      const data = tryJson(result.stdout);
      if (!data || typeof data !== "object") {
        return {
          content: [{ type: "text", text: `⚠️ Could not parse NPC data:\n\`\`\`\n${result.stdout.slice(0, 2000)}\n\`\`\`` }],
          details: { raw: result.stdout.slice(0, 2000) },
        };
      }

      const d = data as Record<string, any>;
      const sections = d.promptSections ?? {};
      const card = sections.npcCard ?? {};

      // Build the formatted prompt
      const personalityStr = card.personality
        ? `Openness: ${card.personality.openness}, Assertiveness: ${card.personality.assertiveness}, Skepticism: ${card.personality.skepticism}, Courage: ${card.personality.courage}`
        : "unknown";

      const beliefsStr = sections.beliefs
        ? Object.entries(sections.beliefs).map(([id, b]: [string, any]) => `  ${id}: faith=${b.faith}, understanding=${b.understanding}, devotion=${b.devotion}`).join("\n")
        : "  none";

      const needsStr = sections.needs
        ? Object.entries(sections.needs).map(([k, v]) => `  ${k}: ${v}`).join("\n")
        : "  unknown";

      const eventsStr = (sections.recentEvents ?? []).map((e: any) => `  [tick ${e.tick}] ${e.type}: ${e.description}`).join("\n") || "  (none)";

      const relationStr = (sections.relationships ?? []).map((r: any) => `  ${r.npcId} (${r.type}, trust=${r.trust})`).join("\n") || "  (none)";

      const prompt = [
        `## NPC Card: ${card.name}`,
        ``,
        `**Role:** ${card.role} in ${card.settlement}`,
        `**Activity:** ${card.currentActivity}  **Mood:** ${card.mood}`,
        `**Personality:** ${personalityStr}`,
        ``,
        `**Beliefs:**`,
        beliefsStr,
        ``,
        `**Needs:**`,
        needsStr,
        ``,
        `**Recent Events:**`,
        eventsStr,
        ``,
        `**Relationships:**`,
        relationStr,
        ``,
        `---`,
        `You are an NPC in a fantasy world. A small god watches over you.`,
        `Describe your current thoughts, worries, hopes. What do you see around you?`,
        `What do you believe about the gods? Keep it natural and grounded.`,
      ].join("\n");

      return {
        content: [
          {
            type: "text",
            text: [
              `## sg_npc_prompt — ${d.npcId} (seed ${seed})`,
              `(${d.npcCount} NPCs in world)`,
              "",
              "**Formatted prompt (~500 token template):**",
              "",
              "```",
              prompt,
              "```",
              "",
              "**Raw sections (for debugging):**",
              "",
              "```json",
              JSON.stringify(sections, null, 2),
              "```",
            ].join("\n"),
          },
        ],
        details: { npcId: d.npcId, promptLength: prompt.length, raw: d },
      };
    },
  });

  // ── Tool: sg_lint ────────────────────────────────────────────────────────
  pi.registerTool({
    name: "sg_lint",
    label: "SG Lint",
    description: "Run TypeScript type-checking (tsc --noEmit) and report errors",
    promptSnippet: "TypeScript check the Small Gods codebase",
    promptGuidelines: [
      "Use sg_lint to check for TypeScript compilation errors before or after making changes.",
    ],
    parameters: Type.Object({}),
    async execute() {
      const result = run("npx tsc --noEmit", { timeout: 120_000 });

      if (result.exitCode === 0) {
        return {
          content: [{ type: "text", text: "## sg_lint — ✅ No TypeScript errors" }],
          details: { exitCode: 0, errorCount: 0 },
        };
      }

      // Parse error locations
      const lines = result.stdout.split("\n");
      const errors = lines.filter(l => l.includes("error TS") || l.includes(": error"));
      const fileCount = new Set(
        errors.map(l => {
          const m = l.match(/^([^(]+)\(/);
          return m ? m[1].trim() : l;
        }),
      ).size;

      // Show first 30 error lines, grouped by file
      const errorPreview = errors.slice(0, 30).join("\n");

      return {
        content: [
          {
            type: "text",
            text: [
              `## sg_lint — ❌ ${errors.length} errors across ${fileCount} files`,
              "",
              "```",
              errorPreview,
              errors.length > 30 ? `\n... and ${errors.length - 30} more errors` : "",
              "```",
            ].join("\n"),
          },
        ],
        details: { exitCode: result.exitCode, errorCount: errors.length, fileCount },
      };
    },
  });

  // ── Build command notification ──────────────────────────────────────────
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.notify("Small Gods devtools loaded: sg_test, sg_map_stats, sg_sim_tick, sg_npc_prompt, sg_lint", "info");
  });
}
