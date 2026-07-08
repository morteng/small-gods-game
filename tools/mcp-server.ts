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

type ToolResult = { content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]; isError?: boolean };

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
  { description: 'Narrative event log entries, oldest→newest. Always capped: returns the most recent `limit` entries (default 50) so a long-running world (tens of thousands of events) never overflows. Pass sinceId to start after a specific event id; raise limit to widen the window. The envelope reports total/returned/truncated.',
    inputSchema: {
      sinceId: z.number().optional().describe('Only events with id greater than this (0 = from the start)'),
      limit: z.number().int().positive().max(1000).optional().describe('Max entries to return, newest kept (default 50)'),
    } },
  async ({ sinceId, limit }): Promise<ToolResult> => {
    try {
      await ensureConnected();
      const all = (await client.query('events', sinceId ?? 0)) as unknown[];
      const cap = limit ?? 50;
      const events = all.slice(Math.max(0, all.length - cap));
      return asText({ total: all.length, returned: events.length, truncated: all.length > events.length, sinceId: sinceId ?? 0, events });
    } catch (e) { return asError(e); }
  });

server.registerTool('capabilities',
  { description: 'The full command verb vocabulary as data (verb, tier, cost, target kind, implemented). Use this to discover valid verbs for emit_command.' },
  () => run(() => client.capabilities()));

server.registerTool('lint_world',
  { description: 'Run the connectome linter over the generated world: structured diagnostics (errors / warnings / pressure points) like a compiler. Catches building overlaps, roads or barriers through buildings, parallel roads between the same places, and oversubscribed junctions. Returns severity counts, per-rule tallies, and each finding with its locus (entities/edges/nodes/tiles), metrics, and any suggestedFix verb — the lint → fix → re-lint loop.' },
  () => run(() => client.query('connectomeDiagnostics')));

server.registerTool('lint_seed',
  { description: 'WORLD DOCTOR — offline evaluation of an authored world-seed JSON, no browser needed. Runs schema validation (typo\'d POI types, dead fields, out-of-range sizes), island layout (final coordinates), then full worldgen, and returns per-POI ground truth (position after layout, apex height in metres, biome, building count, crater ponding) plus complaints (severity + rule + suggestedFix): a POI drowned in the sea, a volcano reading as an alpine peak, a settlement that produced no buildings, a region biome that never took. THE feedback loop for authoring/editing world seeds: author → lint_seed → revise until PASS.',
    inputSchema: {
      seed: z.string().optional().describe('World-seed JSON as a string. Omit to lint the shipped default world.'),
      genSeed: z.number().optional().describe('Terrain generation seed (default 12345). Try a couple of values — the live game rolls a random one.'),
    } },
  async ({ seed, genSeed }): Promise<ToolResult> => {
    try {
      // In-process — deliberately NOT via the bus: seeds are lintable before any
      // game exists. Lazy import keeps server startup instant.
      const { diagnoseWorldSeed } = await import('@/world/world-doctor');
      const { readFileSync } = await import('node:fs');
      const ws = seed ? JSON.parse(seed) : JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8'));
      return asText(await diagnoseWorldSeed(ws, genSeed ?? 12345));
    } catch (e) {
      return { content: [{ type: 'text', text: `error: ${(e as Error).message}` }], isError: true };
    }
  });

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

// ── Studio tools (drive a ?studio…&bridge tab: the Object studio is the peer) ─
// These reach the running Object studio via the studio↔bus bridge (src/studio/
// studio-bridge.ts). They are inert unless the connected tab was opened with
// ?studio=<kind>&bridge (read) / &bridge=rw (also allows the paid render).

/** A studio verb that returns a PNG data-URI → an MCP image result. */
async function runImage(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    await ensureConnected();
    const url = (await fn()) as string;
    const m = /^data:(image\/\w+);base64,(.+)$/.exec(url || '');
    if (!m) return { content: [{ type: 'text', text: '(no image — is a ?studio…&bridge tab connected?)' }] };
    return { content: [{ type: 'image', data: m[2], mimeType: m[1] }] };
  } catch (e) { return asError(e); }
}

server.registerTool('studio_kinds',
  { description: 'Object studio: all selectable subject presets (buildings, props, plants). Needs a ?studio…&bridge tab.' },
  () => run(() => client.query('studio_kinds')));

server.registerTool('studio_state',
  { description: 'Object studio: the current subject kind.' },
  () => run(() => client.query('studio_state')));

server.registerTool('studio_select',
  { description: 'Object studio: select a subject preset and return a PNG of the rendered view.',
    inputSchema: { kind: z.string().describe('A preset name from studio_kinds, e.g. "cottage"') } },
  ({ kind }) => runImage(() => client.query('studio_select', kind)));

server.registerTool('studio_render',
  { description: 'Object studio: render the current (or named) subject and return a PNG. Free — grey massing or the shipped img2img sprite (game source).',
    inputSchema: {
      kind: z.string().optional().describe('Optional preset to switch to first'),
      textured: z.boolean().optional().describe('true = the img2img sprite, false = grey massing'),
    } },
  ({ kind, textured }) => runImage(() => client.query('studio_render', kind, textured)));

server.registerTool('studio_render_paid',
  { description: 'Object studio: run ONE PAID img2img render of the current (or named) subject and return its gate metrics. COSTS MONEY. Requires ?bridge=rw.',
    inputSchema: { kind: z.string().optional().describe('Optional preset to switch to first') } },
  ({ kind }) => run(() => client.query('studio_render_paid', kind)));

// ── Write tools (require ?bridge=rw) ─────────────────────────────────────────

const targetShape = {
  targetKind: z.enum(['npc', 'entity', 'settlement', 'tile', 'none']).optional().describe('Defaults to none'),
  npcId: z.string().optional().describe('Required when targetKind is npc'),
  entityId: z.string().optional().describe('Required when targetKind is entity (any World entity)'),
  poiId: z.string().optional().describe('Required when targetKind is settlement'),
  x: z.number().optional().describe('Required when targetKind is tile'),
  y: z.number().optional().describe('Required when targetKind is tile'),
};

function buildTarget(a: { targetKind?: string; npcId?: string; entityId?: string; poiId?: string; x?: number; y?: number }): unknown {
  if (a.targetKind === 'npc') return { kind: 'npc', npcId: a.npcId };
  if (a.targetKind === 'entity') return { kind: 'entity', id: a.entityId };
  if (a.targetKind === 'settlement') return { kind: 'settlement', poiId: a.poiId };
  if (a.targetKind === 'tile') return { kind: 'tile', x: a.x, y: a.y };
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

// ── Building-authoring tools (pure geometry — no live game / bus needed) ─────────
// These run the blueprint pipeline in-process: an agent can read what's authorable,
// resolve+lint a spec, and see it from multiple angles WITHOUT a game open. The same
// path the in-game Fate author-building tool will use, exposed for the honing loop.
import { formatCatalogue } from '@/blueprint/describe-registry';
import { authorBlueprint } from '@/blueprint/authoring';
import { renderBlueprintMontage } from '@/assetgen/blueprint-montage';
import type { Blueprint, Descriptors } from '@/blueprint/types';
import { PNG } from 'pngjs';

const descriptorsShape = {
  wealth: z.enum(['destitute', 'poor', 'modest', 'comfortable', 'rich', 'opulent']).optional(),
  quality: z.enum(['crude', 'plain', 'fine', 'ornate']).optional(),
  style: z.string().optional(),
  condition: z.enum(['pristine', 'lived_in', 'worn', 'dilapidated']).optional(),
};
const pickDescriptors = (a: Record<string, unknown>): Descriptors | undefined => {
  const d: Descriptors = {};
  if (a.wealth) d.wealth = a.wealth as Descriptors['wealth'];
  if (a.quality) d.quality = a.quality as Descriptors['quality'];
  if (a.style) d.style = a.style as string;
  if (a.condition) d.condition = a.condition as Descriptors['condition'];
  return Object.keys(d).length ? d : undefined;
};

server.registerTool('building_catalogue',
  { description: 'The authorable building capability catalogue: every part/feature type with its param kinds, ranges, enums, defaults, and docs. Read this before authoring a blueprint. Pure — no running game needed.' },
  (): ToolResult => {
    try { return { content: [{ type: 'text', text: formatCatalogue() }] }; }
    catch (e) { return asError(e); }
  });

server.registerTool('lint_blueprint',
  { description: 'Resolve + lint a building (preset name or a full blueprint JSON) and return the commit/reject verdict + structured diagnostics (eave breaches, dropped openings, out-of-footprint parts, part overlaps). ok=false means do not commit. Pure — no running game needed.',
    inputSchema: {
      preset: z.string().optional().describe('a preset name, e.g. cottage/parish-church'),
      blueprint: z.record(z.string(), z.any()).optional().describe('a full Blueprint JSON (instead of preset)'),
      seed: z.number().optional(),
      ...descriptorsShape,
    } },
  (a): ToolResult => {
    try {
      const r = authorBlueprint({ preset: a.preset, blueprint: a.blueprint as Blueprint | undefined, descriptors: pickDescriptors(a), seed: a.seed });
      return asText({ ok: r.ok, summary: r.summary, lints: r.lints });
    } catch (e) { return asError(e); }
  });

server.registerTool('render_building_views',
  { description: 'Render a building (preset name or a full blueprint JSON) as a multi-angle turntable montage (4 corners) with numbered Set-of-Mark part labels, returned as a PNG. Read the marks legend in the text block to map each number to its blueprint part. Pure — no running game needed.',
    inputSchema: {
      preset: z.string().optional(),
      blueprint: z.record(z.string(), z.any()).optional(),
      seed: z.number().optional(),
      ...descriptorsShape,
    } },
  async (a): Promise<ToolResult> => {
    try {
      const r = authorBlueprint({ preset: a.preset, blueprint: a.blueprint as Blueprint | undefined, descriptors: pickDescriptors(a), seed: a.seed });
      if (!r.rb) return { content: [{ type: 'text', text: `cannot render: ${r.summary}` }], isError: true };
      const m = await renderBlueprintMontage(r.rb);
      const png = new PNG({ width: m.width, height: m.height });
      png.data = Buffer.from(m.rgba.buffer, m.rgba.byteOffset, m.rgba.byteLength);
      const b64 = PNG.sync.write(png).toString('base64');
      const legend = m.legend.map(e => `${e.mark} = ${e.id} (${e.type})`).join('\n');
      return { content: [
        { type: 'text', text: `lint: ${r.summary}\nyaws: ${m.yaws.length} (corners)\nmarks:\n${legend}` },
        { type: 'image', data: b64, mimeType: 'image/png' },
      ] };
    } catch (e) { return asError(e); }
  });

// ── Boot ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[small-gods-mcp] ready (stdio). Connects to the bus bridge on first tool call.\n');
}

main().catch((e) => { process.stderr.write(`[small-gods-mcp] fatal: ${(e as Error).message}\n`); process.exit(1); });
