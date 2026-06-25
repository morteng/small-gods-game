// src/render/mount-anchor-overlay.ts
//
// Shared 2D overlay that dots a building's MOUNT anchors (sign/lamp/perch sockets) by
// role, at their metric height, with a faint stem from the foot so height reads. Used by
// both the world-studio (world-space spatial debug) and the in-game dev overlay (dots ON
// the rendered grey massing). Projection is the lift-aware `projectConnectome`, which
// matches the GPU terrain exactly, so a socket sits on the building it belongs to.
import type { World } from '@/world/world';
import type { GameMap, Camera } from '@/core/types';
import { mountAnchorsOf } from '@/world/anchor-query';
import { projectConnectome } from '@/render/connectome-overlay';
import { mToPx } from '@/render/scale-contract';

/** Colour per mount-anchor role (kind). Stable so the legend matches the dots. */
export const MOUNT_ROLE_COLOR: Record<string, string> = {
  lintel: '#ffd24a',       // sign / lamp — amber
  roof_ridge: '#4ad2ff',   // perch line / vane — cyan
  gable_peak: '#7cff7c',   // perch / finial / banner — green
  chimney_top: '#ff6a4a',  // smoke / perch — red
  eave: '#c89bff',         // lamp / bracket / perch — violet
  roof_apex: '#7cff7c',    // perch / finial — green
};

/** Draw every placed building's mount sockets onto `ctx`. Pure read of the world. */
export function drawMountAnchorOverlay(
  ctx: CanvasRenderingContext2D, world: World, map: GameMap, cam: Camera,
  opts: { legend?: boolean } = {},
): void {
  if (!world || !map) return;
  ctx.save();
  // Buildings carry their preset as `kind` (tavern/guard_post/…) and 'building' as a TAG.
  for (const e of world.query({ tag: 'building' })) {
    for (const a of mountAnchorsOf(e)) {
      const g = projectConnectome(map, a.x, a.y, cam);
      const top = g.y - mToPx(a.z ?? 0) * cam.zoom;
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';     // stem foot → socket
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(g.x, g.y); ctx.lineTo(g.x, top); ctx.stroke();
      ctx.fillStyle = MOUNT_ROLE_COLOR[a.kind] ?? '#ffffff';
      ctx.beginPath(); ctx.arc(g.x, top, 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (opts.legend !== false) {
    ctx.font = '10px monospace';
    ctx.textBaseline = 'middle';
    let ly = 14;
    for (const [role, col] of Object.entries(MOUNT_ROLE_COLOR)) {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(14, ly, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(230,230,230,0.9)'; ctx.fillText(role, 24, ly);
      ly += 14;
    }
  }
  ctx.restore();
}
