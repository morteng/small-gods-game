// src/assetgen/render/fit.ts
import type { WorldFacet } from '@/assetgen/types';
import { project, type ProjScale } from '@/assetgen/render/projection';

export interface BBox { x: number; y: number; w: number; h: number }

/** Opaque (alpha>0) bounding box of an RGBA buffer. */
export function opaqueBounds(data: Uint8ClampedArray, size: number): BBox {
  let minX = size, minY = size, maxX = -1, maxY = -1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (data[(y*size + x)*4 + 3] > 0) { if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y; }
  }
  return maxX < 0 ? { x:0, y:0, w:0, h:0 } : { x:minX, y:minY, w:maxX-minX+1, h:maxY-minY+1 };
}

/** Two-pass: measure the projected extent at unit scale, then scale to fill `fillFrac` and centre. */
export function computeFit(facets: WorldFacet[], size: number, fillFrac = 0.88): ProjScale {
  const unit: ProjScale = { scale: 1, ox: 0, oy: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of facets) for (const p of f.pts) {
    const s = project(p, unit);
    if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y; if (s.y > maxY) maxY = s.y;
  }
  const w = (maxX - minX) || 1, h = (maxY - minY) || 1;
  const scale = (fillFrac * size) / Math.max(w, h);
  const ox = size/2 - ((minX + maxX) / 2) * scale;
  const oy = size/2 - ((minY + maxY) / 2) * scale;
  return { scale, ox, oy };
}
