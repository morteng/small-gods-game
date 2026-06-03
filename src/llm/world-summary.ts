/**
 * world-summary.ts — a compact text digest of the current world for the Create
 * panel's prompt. Gives the capable model enough to resolve references like
 * "the northern village" / "Brother Aldous" to concrete ids and coordinates,
 * without a read-tool loop (single-shot, SP3 scope).
 */
import type { GameState } from '@/core/state';
import { queryNpcs, npcProps } from '@/world/npc-helpers';

const ROSTER_CAP = 30;

export function buildWorldSummary(state: GameState): string {
  const name = state.worldSeed?.name ?? 'unnamed';
  const lines: string[] = [`World "${name}".`];

  const pois = state.worldSeed?.pois ?? [];
  if (pois.length) {
    const poiText = pois.map(p => {
      const at = p.position ? ` at (${p.position.x},${p.position.y})` : '';
      return `${p.id}="${p.name ?? p.id}"${at}`;
    }).join('; ');
    lines.push(`Settlements: ${poiText}.`);
  }

  const world = state.world;
  if (!world) return lines.join(' ');

  const npcs = queryNpcs(world);
  const roleCounts = new Map<string, number>();
  for (const e of npcs) {
    const r = npcProps(e).role;
    roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1);
  }
  const roleText = [...roleCounts.entries()].map(([r, n]) => `${r} ${n}`).join(', ');
  lines.push(`Population: ${npcs.length} NPCs${roleText ? ` (${roleText})` : ''}.`);

  if (npcs.length) {
    const roster = npcs.slice(0, ROSTER_CAP).map(e => {
      const p = npcProps(e);
      return `${e.id} "${p.name}" ${p.role}${p.homePoiId ? ` @${p.homePoiId}` : ''}`;
    }).join('; ');
    const more = npcs.length > ROSTER_CAP ? ` …(+${npcs.length - ROSTER_CAP} more)` : '';
    lines.push(`Roster: ${roster}${more}.`);
  }

  // Object counts by kind (non-npc), helps the model reference existing objects.
  const kinds = new Map<string, number>();
  for (const e of world.query({})) {
    if (e.kind === 'npc') continue;
    kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  }
  if (kinds.size) {
    const kindText = [...kinds.entries()].map(([k, n]) => `${k} ${n}`).join(', ');
    lines.push(`Objects: ${kindText}.`);
  }

  return lines.join(' ');
}
