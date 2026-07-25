/**
 * target-shape.ts — the CommandTarget zod shape + builder shared by the MCP
 * `preview_command`/`emit_command` tools (`mcp-server.ts`).
 *
 * Pulled into its own pure module rather than left inline: `mcp-server.ts` has
 * top-level side effects (it constructs the McpServer and, at import time via
 * `main()`, connects a StdioServerTransport) — importing it anywhere, even from
 * a unit test, is unsafe. `buildTarget` has none of that, so it lives here where
 * it can be exercised directly (abilities-v1 B5's MCP `area` arm).
 */
import { z } from 'zod';

export const targetShape = {
  targetKind: z.enum(['npc', 'entity', 'settlement', 'tile', 'area', 'none']).optional().describe('Defaults to none'),
  npcId: z.string().optional().describe('Required when targetKind is npc'),
  entityId: z.string().optional().describe('Required when targetKind is entity (any World entity)'),
  poiId: z.string().optional().describe('Required when targetKind is settlement'),
  x: z.number().optional().describe('Required when targetKind is tile or area (disc centre)'),
  y: z.number().optional().describe('Required when targetKind is tile or area (disc centre)'),
  radius: z.number().optional().describe('Required when targetKind is area — disc radius in tiles (clamped 2..12 server-side, e.g. for an area summon_storm/raincloud)'),
};

export function buildTarget(a: {
  targetKind?: string; npcId?: string; entityId?: string; poiId?: string; x?: number; y?: number; radius?: number;
}): unknown {
  if (a.targetKind === 'npc') return { kind: 'npc', npcId: a.npcId };
  if (a.targetKind === 'entity') return { kind: 'entity', id: a.entityId };
  if (a.targetKind === 'settlement') return { kind: 'settlement', poiId: a.poiId };
  if (a.targetKind === 'tile') return { kind: 'tile', x: a.x, y: a.y };
  if (a.targetKind === 'area') return { kind: 'area', x: a.x, y: a.y, radius: a.radius };
  return { kind: 'none' };
}
