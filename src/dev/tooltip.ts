import type { HitResult, Tile, Entity, NpcInstance, GeneratedDecoration } from '@/core/types';

/**
 * Format a tooltip string for any HitResult type.
 * Used in dev mode to show object info on hover (like NPC tooltips).
 */
export function formatDevTooltip(hit: HitResult): string {
  switch (hit.type) {
    case 'tile':
      return formatTileTooltip(hit.tile, hit.tileX, hit.tileY);
    case 'entity':
      return formatEntityTooltip(hit.entity);
    case 'npc':
      return formatNpcTooltipShort(hit.npc);
    case 'decoration':
      return formatDecorationTooltip(hit.decoration);
    default:
      return '';
  }
}

function formatTileTooltip(tile: Tile | undefined, tx: number, ty: number): string {
  if (!tile) return `Void (${tx}, ${ty})`;
  const walkable = tile.walkable ? '✓' : '✗';
  return `Tile (${tx}, ${ty}) · ${tile.type} · walkable:${walkable} · ${tile.state}`;
}

function formatEntityTooltip(entity: Entity | undefined): string {
  if (!entity) return 'Entity · not found';
  const tags = entity.tags?.join(', ') ?? '';
  return `${entity.kind} · (${entity.x.toFixed(1)}, ${entity.y.toFixed(1)})` +
    (tags ? ` · ${tags}` : '');
}

function formatNpcTooltipShort(npc: NpcInstance | undefined): string {
  if (!npc) return 'NPC · not found';
  return `${npc.name} · ${npc.role} · ${npc.direction}`;
}

function formatDecorationTooltip(decoration: GeneratedDecoration | undefined): string {
  if (!decoration) return 'Decoration · not found';
  const shortId = decoration.assetId.length > 16
    ? decoration.assetId.slice(0, 16) + '...'
    : decoration.assetId;
  return `Decoration · ${shortId}`;
}
