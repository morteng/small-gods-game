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

export interface IsoOrigin { originX: number; originY: number }
export interface TileBounds { minTx: number; maxTx: number; minTy: number; maxTy: number }

export function visibleTileBounds(
  origin: IsoOrigin,
  canvasWidth: number,
  canvasHeight: number,
  clamp?: { mapW: number; mapH: number },
): TileBounds {
  const corners: Array<{ tx: number; ty: number }> = [
    screenToTile(0, 0, origin.originX, origin.originY),
    screenToTile(canvasWidth, 0, origin.originX, origin.originY),
    screenToTile(0, canvasHeight, origin.originX, origin.originY),
    screenToTile(canvasWidth, canvasHeight, origin.originX, origin.originY),
  ];
  let minTx = corners[0].tx, maxTx = corners[0].tx;
  let minTy = corners[0].ty, maxTy = corners[0].ty;
  for (const c of corners) {
    if (c.tx < minTx) minTx = c.tx;
    if (c.tx > maxTx) maxTx = c.tx;
    if (c.ty < minTy) minTy = c.ty;
    if (c.ty > maxTy) maxTy = c.ty;
  }
  minTx -= 1; minTy -= 1; maxTx += 1; maxTy += 1;
  if (clamp) {
    minTx = Math.max(0, minTx);
    minTy = Math.max(0, minTy);
    maxTx = Math.min(clamp.mapW - 1, maxTx);
    maxTy = Math.min(clamp.mapH - 1, maxTy);
  }
  return { minTx, maxTx, minTy, maxTy };
}
