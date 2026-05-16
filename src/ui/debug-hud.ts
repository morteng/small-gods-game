export interface DebugHudInfo {
  fps: number;
  mouseTile: { x: number; y: number } | null;
  entityCount: number;
  npcCount: number;
  paused: boolean;
  zoom: number;
}

export function formatDebugHud(info: DebugHudInfo): string {
  const tile = info.mouseTile ? `${info.mouseTile.x},${info.mouseTile.y}` : '-';
  const state = info.paused ? 'paused' : 'running';
  return [
    `FPS ${info.fps.toFixed(0)}`,
    `tile ${tile}`,
    `entities ${info.entityCount}`,
    `npcs ${info.npcCount}`,
    `zoom ${info.zoom.toFixed(2)}`,
    state,
  ].join('  ·  ');
}
