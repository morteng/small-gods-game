import { ISO_TILE_W, ISO_TILE_H } from './iso-constants';

export function worldToScreen(
  tx: number, ty: number, z: number,
  originX: number, originY: number,
): { sx: number; sy: number } {
  return {
    sx: (tx - ty) * (ISO_TILE_W / 2) + originX,
    sy: (tx + ty) * (ISO_TILE_H / 2) - z + originY,
  };
}

export function screenToTile(
  sx: number, sy: number,
  originX: number, originY: number,
): { tx: number; ty: number } {
  const fx = (sx - originX) / (ISO_TILE_W / 2);
  const fy = (sy - originY) / (ISO_TILE_H / 2);
  return {
    tx: Math.round((fx + fy) / 2),
    ty: Math.round((fy - fx) / 2),
  };
}
