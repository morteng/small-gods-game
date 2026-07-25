/**
 * buildTarget (tools/target-shape.ts) — the MCP `preview_command`/`emit_command`
 * target-arg → CommandTarget builder. Pulled out of `mcp-server.ts` (which has
 * top-level side effects — booting a stdio server on import) so it can be
 * exercised directly. Abilities-v1 B5: an agent placing a raincloud/area storm
 * must be reachable in exactly ONE `emit_command` call — this proves the
 * `area` arm builds the right target shape from flat tool args.
 */
import { describe, it, expect } from 'vitest';
import { buildTarget } from '../../tools/target-shape';

describe('buildTarget — area arm (abilities-v1 B5)', () => {
  it('builds an area CommandTarget from flat x/y/radius args', () => {
    expect(buildTarget({ targetKind: 'area', x: 12, y: 44, radius: 8 }))
      .toEqual({ kind: 'area', x: 12, y: 44, radius: 8 });
  });

  it('still builds every other target kind unchanged', () => {
    expect(buildTarget({ targetKind: 'npc', npcId: 'n1' })).toEqual({ kind: 'npc', npcId: 'n1' });
    expect(buildTarget({ targetKind: 'entity', entityId: 'e1' })).toEqual({ kind: 'entity', id: 'e1' });
    expect(buildTarget({ targetKind: 'settlement', poiId: 'town' })).toEqual({ kind: 'settlement', poiId: 'town' });
    expect(buildTarget({ targetKind: 'tile', x: 1, y: 2 })).toEqual({ kind: 'tile', x: 1, y: 2 });
    expect(buildTarget({})).toEqual({ kind: 'none' });
  });
});
