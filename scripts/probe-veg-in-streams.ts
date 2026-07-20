// Probe: vegetation standing INSIDE the drawn river/stream ribbon (continuous), and
// whether the cell-granular render-water mask would have caught it.
import { readFileSync } from 'node:fs';
import { generateWithNoise } from '@/map/map-generator';
import { planWorldLayout } from '@/world/poi-layout';
import { getWaterNetwork } from '@/world/water-network-store';
import { referenceFlow, reachHalfWidths } from '@/terrain/river-network';
import { getRenderWaterMask } from '@/world/render-water';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import type { WorldSeed } from '@/core/types';

const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
const NATURE = new Set(['vegetation', 'terrain-feature']);

async function main(): Promise<void> {
  for (const seed of [12345, 777]) {
    const layout = planWorldLayout(ws);
    const laidOut = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };
    const { map, world } = await generateWithNoise(layout.size.width, layout.size.height, seed, laidOut);

    const net = getWaterNetwork(map);
    const refFlow = referenceFlow(net);
    // Signed distance: (dist to nearest centreline segment) - (interpolated halfWidth there).
    // Negative = inside the drawn channel.
    type Seg = { ax: number; ay: number; bx: number; by: number; ha: number; hb: number };
    const segs: Seg[] = [];
    for (const reach of net.reaches) {
      const cl = reach.centerline;
      const hw = reachHalfWidths(reach, refFlow);
      for (let i = 0; i < cl.length - 1; i++) {
        segs.push({ ax: cl[i].x, ay: cl[i].y, bx: cl[i + 1].x, by: cl[i + 1].y, ha: hw[i], hb: hw[i + 1] });
      }
    }
    const signedDist = (px: number, py: number): number => {
      let best = Infinity;
      for (const s of segs) {
        const dx = s.bx - s.ax, dy = s.by - s.ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 > 0 ? ((px - s.ax) * dx + (py - s.ay) * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = s.ax + t * dx, qy = s.ay + t * dy;
        const d = Math.hypot(px - qx, py - qy) - (s.ha + (s.hb - s.ha) * t);
        if (d < best) best = d;
      }
      return best;
    };

    const isWater = getRenderWaterMask(map);
    const inChannel: { kind: string; brush: string; d: number; maskDry: boolean }[] = [];
    for (const e of world.registry.all()) {
      const def = tryGetEntityKindDef(e.kind);
      if (!def || !NATURE.has(def.category)) continue;
      if (e.tags?.includes('waterPlaced')) continue; // deliberate riparian
      const d = signedDist(e.x, e.y);
      if (d < 0) {
        inChannel.push({
          kind: e.kind,
          brush: e.id.split('-')[0],
          d,
          maskDry: !isWater(Math.floor(e.x), Math.floor(e.y)),
        });
      }
    }
    const byKind = new Map<string, number>();
    const byBrush = new Map<string, number>();
    let maskDry = 0, deep = 0;
    for (const r of inChannel) {
      byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
      byBrush.set(r.brush, (byBrush.get(r.brush) ?? 0) + 1);
      if (r.maskDry) maskDry++;
      if (r.d < -0.25) deep++; // well inside, not just clipping the bank
    }
    console.log(`\nseed ${seed}: ${inChannel.length} nature entities INSIDE the drawn channel ` +
      `(${deep} more than 0.25 tiles in; ${maskDry} on cells the render-water MASK calls dry)`);
    console.log('  by kind :', [...byKind.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([k, n]) => `${k}=${n}`).join(' '));
    console.log('  by brush:', [...byBrush.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}=${n}`).join(' '));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
