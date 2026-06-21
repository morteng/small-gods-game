#!/usr/bin/env -S npx tsx
/**
 * small-gods MCP server — Layer 2b: a stdio MCP server over the bus bridge.
 *
 * The durable, typed tool surface any MCP client (Claude Code, Claude desktop, an
 * MCP-UI host) uses to drive and inspect a running game. It is a thin adapter:
 * every tool routes through `BusClient` → the dev broker → the browser tab's live
 * `GameBus`, which does all validation/gating. The verb vocabulary for
 * `emit_command` is discoverable at runtime via the `capabilities` tool — one
 * source of truth (`src/sim/command/registry.ts`), never hand-maintained here.
 *
 * Requires `npm run dev` running and the game open with `?bridge` (read tools) or
 * `?bridge=rw` (for `emit_command`). Connects lazily on first tool call so the
 * server can start before the game is up. Env BUS_URL overrides the broker origin.
 *
 * Run: `npm run mcp`  (or register in .mcp.json — see that file).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BusClient } from './bus-client';

const client = new BusClient({ url: process.env.BUS_URL });
let connected = false;

async function ensureConnected(): Promise<void> {
  if (connected) return;
  await client.connect();
  connected = true;
}

type ToolResult = { content: { type: 'text'; text: string }[] | { type: 'image'; data: string; mimeType: string }[]; isError?: boolean };

function asText(v: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(v, null, 2) }] };
}
function asError(e: unknown): ToolResult {
  connected = false; // force a fresh connect next time (socket may be dead)
  return { content: [{ type: 'text', text: `error: ${(e as Error).message}` }], isError: true };
}

/** Run a bus call, mapping success/failure to MCP tool results. */
async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try { await ensureConnected(); return asText(await fn()); }
  catch (e) { return asError(e); }
}

const server = new McpServer({ name: 'small-gods', version: '0.1.0' });

// ── Read tools (work with ?bridge or ?bridge=rw) ─────────────────────────────

server.registerTool('world_summary',
  { description: 'High-level snapshot of the running world: name, tick, calendar, entity counts.' },
  () => run(() => client.query('worldSummary')));

server.registerTool('list_spirits',
  { description: 'All spirits (gods) — player + rivals — with power and believer counts.' },
  () => run(() => client.query('spirits')));

server.registerTool('list_npcs',
  { description: 'Compact list of NPCs (id, name, role, position, mood, activity, faith toward the player god).' },
  () => run(() => client.query('npcs')));

server.registerTool('get_npc',
  { description: 'Full detail for one NPC: beliefs, needs, personality, relationships, age, lineage.',
    inputSchema: { id: z.string().describe('Entity id, e.g. "npc:1"') } },
  ({ id }) => run(() => client.query('npc', id)));

server.registerTool('belief_state',
  { description: 'Aggregate belief toward a spirit: believers, power, regen, mean faith/understanding/devotion.',
    inputSchema: { spiritId: z.string().optional().describe('Spirit id; defaults to the player god') } },
  ({ spiritId }) => run(() => client.query('beliefState', spiritId)));

server.registerTool('belief_powers',
  { description: 'Belief-granted powers for a spirit: which divine verbs are unlocked and how far from threshold.',
    inputSchema: { spiritId: z.string().optional() } },
  ({ spiritId }) => run(() => client.query('beliefPowers', spiritId)));

server.registerTool('divine_inbox',
  { description: 'Salience-ranked triage inbox for a spirit: prayers, opportunities, and rival threats.',
    inputSchema: { spiritId: z.string().optional() } },
  ({ spiritId }) => run(() => client.query('divineInbox', spiritId)));

server.registerTool('settlement',
  { description: 'Detail for one settlement/POI: type, importance, position, population, wards.',
    inputSchema: { poiId: z.string() } },
  ({ poiId }) => run(() => client.query('settlement', poiId)));

server.registerTool('timeline',
  { description: 'Time state: rate, current/max tick, whether scrubbed, number of committed branch points.' },
  () => run(() => client.query('timeline')));

server.registerTool('recent_events',
  { description: 'Narrative event log entries since a given event id (0 = from the start).',
    inputSchema: { sinceId: z.number().optional() } },
  ({ sinceId }) => run(() => client.query('events', sinceId ?? 0)));

server.registerTool('capabilities',
  { description: 'The full command verb vocabulary as data (verb, tier, cost, target kind, implemented). Use this to discover valid verbs for emit_command.' },
  () => run(() => client.capabilities()));

server.registerTool('screenshot',
  { description: 'Capture the current game canvas as a PNG image.' },
  async (): Promise<ToolResult> => {
    try {
      await ensureConnected();
      const url = (await client.query('screenshot')) as string;
      const m = /^data:(image\/\w+);base64,(.+)$/.exec(url || '');
      if (!m) return { content: [{ type: 'text', text: '(no image available — is the game rendered?)' }] };
      return { content: [{ type: 'image', data: m[2], mimeType: m[1] }] };
    } catch (e) { return asError(e); }
  });

// ── Write tools (require ?bridge=rw) ─────────────────────────────────────────

const targetShape = {
  targetKind: z.enum(['npc', 'settlement', 'none']).optional().describe('Defaults to none'),
  npcId: z.string().optional().describe('Required when targetKind is npc'),
  poiId: z.string().optional().describe('Required when targetKind is settlement'),
};

function buildTarget(a: { targetKind?: string; npcId?: string; poiId?: string }): unknown {
  if (a.targetKind === 'npc') return { kind: 'npc', npcId: a.npcId };
  if (a.targetKind === 'settlement') return { kind: 'settlement', poiId: a.poiId };
  return { kind: 'none' };
}

server.registerTool('preview_command',
  { description: 'Dry-run a command: returns null if it would apply, or a rejection reason. No state change.',
    inputSchema: { verb: z.string(), source: z.string().optional(), ...targetShape } },
  (a) => run(() => client.preview({ verb: a.verb, source: a.source ?? 'player', target: buildTarget(a), seq: 0 })));

server.registerTool('emit_command',
  { description: 'Emit a command onto the same queue the player and rivals use (validated/gated/replayed). Requires the game opened with ?bridge=rw. Discover valid verbs via the capabilities tool.',
    inputSchema: {
      verb: z.string().describe('e.g. whisper, omen, dream, miracle, answer_prayer, smite'),
      source: z.string().optional().describe('Acting spirit id; defaults to player'),
      ...targetShape,
      params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    } },
  (a) => run(() => client.emit({ verb: a.verb, source: a.source ?? 'player', target: buildTarget(a), params: a.params, seq: 0 })));

// ── Boot ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[small-gods-mcp] ready (stdio). Connects to the bus bridge on first tool call.\n');
}

main().catch((e) => { process.stderr.write(`[small-gods-mcp] fatal: ${(e as Error).message}\n`); process.exit(1); });
