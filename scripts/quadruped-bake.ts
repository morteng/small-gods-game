// scripts/quadruped-bake.ts
//
// Offline quadruped bake — the verification loop for the parametric animal rig.
// Drives src/render/paperdoll/{quadruped,quadruped-art}.ts through the SAME
// paper-doll core the motion studio uses, with no DOM, no GPU and no network:
// the sheep's pixels are drawn in code, so this script is the only thing that
// has to be right for the art to be reviewable.
//
// It also ASSERTS the root-clear contract rather than trusting the header
// comments: every opaque pixel must be owned by the chip whose rect contains
// it, and no chip rect may contain a pixel belonging to another part. That is
// exactly the failure ("limb smear = chip rects scooping the torso") that cost
// the humanoid round, and here it is a hard check, per species.
//
// Run:  npx tsx scripts/quadruped-bake.ts
// Out:  .dev-grabs/quadruped/{rest,species}-6x.png
//       .dev-grabs/quadruped/<clip>-{6x,ink6x,game}.png

import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { bakeClip, sampleClip, type AnimTemplate } from '@/render/paperdoll/rig';
import {
  buildQuadrupedTemplate,
  GOAT_PARAMS,
  SHEEP_CLIPS,
  SHEEP_PARAMS,
  SHEEP_WEST,
  type QuadrupedParams,
} from '@/render/paperdoll/quadruped';
import { drawQuadrupedParts, inBarrel, QUAD_PART_NONE } from '@/render/paperdoll/quadruped-art';
import {
  collectOutlinePalette,
  collectSourcePalette,
  reinkOutline,
  snapToSourcePalette,
} from '@/render/paperdoll/palette-snap';
import type { Raster } from '@/render/sprite-postprocess';

const OUT = '.dev-grabs/quadruped';
mkdirSync(OUT, { recursive: true });

/** Lay frames out as a horizontal strip (integer scale, dark bg, 2px gutters). */
function strip(frames: readonly Raster[], scale: number): PNG {
  const cw = frames[0].w;
  const gap = 2;
  const W = (cw * scale + gap) * frames.length + gap;
  const H = cw * scale + gap * 2;
  const png = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) png.data.set([22, 22, 30, 255], i * 4);
  frames.forEach((f, fi) => {
    const ox = gap + fi * (cw * scale + gap);
    for (let y = 0; y < cw * scale; y++) {
      for (let x = 0; x < cw * scale; x++) {
        const si = (((y / scale) | 0) * f.w + ((x / scale) | 0)) * 4;
        if (f.data[si + 3] === 0) continue;
        png.data.set([f.data[si], f.data[si + 1], f.data[si + 2], 255], ((gap + y) * W + ox + x) * 4);
      }
    }
  });
  return png;
}

/** Coverage-weighted box downscale (64 → 32, the game's integral 2:1). */
function downscale(f: Raster, to: number): Raster {
  const s = f.w / to;
  const out = new Uint8ClampedArray(to * to * 4);
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hit = 0;
      for (let yy = 0; yy < s; yy++) {
        for (let xx = 0; xx < s; xx++) {
          const si = ((y * s + yy) * f.w + (x * s + xx)) * 4;
          if (f.data[si + 3] > 0) {
            r += f.data[si];
            g += f.data[si + 1];
            b += f.data[si + 2];
            hit++;
          }
        }
      }
      if (hit > s * s * 0.35) out.set([r / hit, g / hit, b / hit, 255], (y * to + x) * 4);
    }
  }
  return { data: out, w: to, h: to };
}

/**
 * The root-clear contract, mechanised. Returns human-readable violations:
 *  A. a pixel owned by chip i lies outside chip i's rect (it would stay in the
 *     root and ghost when the chip moves), and
 *  B. a pixel inside chip i's rect is owned by something else (the root clear
 *     punches a hole that only chip i can refill — the torso-scoop smear).
 */
function checkRectContract(t: AnimTemplate, parts: Uint8Array, cell: number, p: QuadrupedParams): string[] {
  const bad: string[] = [];
  // C. THE ROOT IS THE BARREL AND NOTHING ELSE. A limb band that spills into
  // the root paints pixels its own silhouette is hiding at rest — and uncovers
  // them the instant it moves (the pale spike that stood over the withers when
  // the sheep grazed). Neither the ownership check below nor a swept hole test
  // catches that, because a leftover is a PROTRUSION, not a hole. This does.
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const isRoot = parts[y * cell + x] === 0;
      const isBarrel = inBarrel(p, x + 0.5, y + 0.5);
      if (isRoot !== isBarrel) {
        bad.push(isRoot ? `non-barrel pixel left in the root at ${x},${y}` : `barrel pixel stolen by a chip at ${x},${y}`);
      }
    }
  }
  const owner = new Int16Array(cell * cell).fill(-1);
  for (let i = 1; i < t.chips.length; i++) {
    const r = t.chips[i].rect;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const j = y * cell + x;
        if (owner[j] >= 0) bad.push(`rect overlap: ${t.chips[owner[j]].name} vs ${t.chips[i].name} at ${x},${y}`);
        owner[j] = i;
      }
    }
  }
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const j = y * cell + x;
      const p = parts[j];
      if (p === QUAD_PART_NONE) continue;
      const o = owner[j];
      if (p === 0 && o >= 0) bad.push(`root pixel inside ${t.chips[o].name} rect at ${x},${y}`);
      else if (p !== 0 && o !== p) {
        bad.push(o < 0 ? `${t.chips[p].name} pixel outside its rect at ${x},${y}` : `${t.chips[p].name} pixel inside ${t.chips[o].name} rect at ${x},${y}`);
      }
    }
  }
  return bad;
}

/**
 * SWEPT contract. The ownership assert above proves no chip scoops a foreign
 * pixel AT REST, and says nothing about what happens once a chip ROTATES AWAY —
 * which is exactly how a grazing sheep got a notch in its chest and a spike over
 * its withers. So every baked frame of every clip is checked for:
 *
 *   - INTERIOR HOLES: transparent pixels not 4-reachable from the cell border.
 *     A limb vacating its rect and exposing the root's clear reads as one.
 *   - ISLANDS: the opaque mass must stay ONE 8-connected component, so no chip
 *     can fly off on its own (a detached ear, a tail adrift behind the rump).
 *
 * Both are structural, so they hold for any species and any future clip.
 */
function checkSwept(f: Raster, holeMin: number, bellyY: number): { bad: string[]; legGaps: number } {
  const { w, h, data } = f;
  const opaque = (i: number): boolean => data[i * 4 + 3] > 127;
  const N4 = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  const bad: string[] = [];
  let legGaps = 0;

  // Flood the transparent background inward from the border.
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number): void => {
    if (!opaque(i) && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    for (const [ox, oy] of N4) {
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      seed(ny * w + nx);
    }
  }

  // Anything transparent and unreached is an interior hole; size its component.
  const seenHole = new Uint8Array(w * h);
  for (let i0 = 0; i0 < w * h; i0++) {
    if (opaque(i0) || outside[i0] || seenHole[i0]) continue;
    let area = 0;
    let at = i0;
    let top = h;
    const q = [i0];
    seenHole[i0] = 1;
    while (q.length > 0) {
      const k = q.pop()!;
      area++;
      at = k;
      const x = k % w;
      const y = (k / w) | 0;
      if (y < top) top = y;
      for (const [ox, oy] of N4) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (opaque(j) || outside[j] || seenHole[j]) continue;
        seenHole[j] = 1;
        q.push(j);
      }
    }
    // A pocket wholly inside the LEG ZONE is the gap between two crossing
    // legs — real, expected, and not a defect. Only a hole that reaches up into
    // the body mass means a chip vacated its rect and exposed the root's clear.
    if (area < holeMin) continue;
    if (top >= bellyY) legGaps++;
    else bad.push(`interior hole ${area}px at ${at % w},${(at / w) | 0} (top row ${top})`);
  }

  // Islands: one 8-connected opaque component, or something has come adrift.
  const seen = new Uint8Array(w * h);
  const areas: number[] = [];
  for (let i0 = 0; i0 < w * h; i0++) {
    if (!opaque(i0) || seen[i0]) continue;
    let area = 0;
    const q = [i0];
    seen[i0] = 1;
    while (q.length > 0) {
      const k = q.pop()!;
      area++;
      const x = k % w;
      const y = (k / w) | 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (!opaque(j) || seen[j]) continue;
          seen[j] = 1;
          q.push(j);
        }
      }
    }
    areas.push(area);
  }
  if (areas.length > 1) {
    bad.push(`${areas.length} disconnected islands (${areas.sort((a, c) => c - a).join('/')}px)`);
  }
  return { bad, legGaps };
}

/** Silhouette extents of a rest cell — the "does it fit the ground line" check. */
function bboxOf(r: Raster): string {
  let x0 = r.w;
  let y0 = r.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if (r.data[(y * r.w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return `x${x0}-${x1} y${y0}-${y1} (${x1 - x0 + 1}x${y1 - y0 + 1})`;
}

/** Side-by-side rest cells of several species, one strip. */
function speciesStrip(specs: readonly QuadrupedParams[]): PNG {
  return strip(specs.map((s) => drawQuadrupedParts(s).raster), 6);
}

async function main(): Promise<void> {
  let failed = false;
  for (const p of [SHEEP_PARAMS, GOAT_PARAMS]) {
    const t = buildQuadrupedTemplate(p);
    const { raster, parts } = drawQuadrupedParts(p);
    const bad = checkRectContract(t, parts, p.cell, p);
    console.log(`${p.species}: bbox ${bboxOf(raster)}`);
    if (bad.length > 0) {
      failed = true;
      console.error(`${p.species}: ${bad.length} ROOT-CLEAR VIOLATIONS`);
      for (const line of bad.slice(0, 24)) console.error(`  ${line}`);
      if (bad.length > 24) console.error(`  … ${bad.length - 24} more`);
    } else {
      console.log(`${p.species}: root-clear contract OK`);
    }
  }

  const rest = drawQuadrupedParts(SHEEP_PARAMS).raster;
  await writeFile(`${OUT}/rest-6x.png`, PNG.sync.write(strip([rest], 6)));
  await writeFile(`${OUT}/species-6x.png`, PNG.sync.write(speciesStrip([SHEEP_PARAMS, GOAT_PARAMS])));

  // Production finish: snap to the species' OWN drawn palette + re-ink the
  // silhouette, so rotated frames read as crisp as the rest cell.
  const palette = collectSourcePalette([rest]);
  const outline = collectOutlinePalette([rest]);
  for (const clip of SHEEP_CLIPS) {
    const frames = bakeClip(SHEEP_WEST, [rest], clip);
    const inked = frames.map((f) => reinkOutline(snapToSourcePalette(f, palette), outline));
    // Swept check runs on the INKED frames — the production finish is what the
    // game shows, and its alpha threshold is what decides a hole's existence.
    let legGaps = 0;
    const denom = Math.max(1, clip.frames - 1);
    inked.forEach((f, fi) => {
      // The belly line RIDES THE ROOT: a walk bob lifts the whole animal by a
      // pixel and a death sinks it, so a fixed row would call the ordinary gap
      // between two fore legs a wound in the chest. Read the root's own dy.
      const rootDy = sampleClip(SHEEP_WEST, clip, fi / denom)[0].dy;
      const swept = checkSwept(f, 2, SHEEP_PARAMS.legs.top + Math.round(rootDy));
      legGaps += swept.legGaps;
      for (const line of swept.bad) {
        failed = true;
        console.error(`SWEPT ${clip.name} frame ${fi}: ${line}`);
      }
    });
    await writeFile(`${OUT}/${clip.name}-6x.png`, PNG.sync.write(strip(frames, 6)));
    await writeFile(`${OUT}/${clip.name}-ink6x.png`, PNG.sync.write(strip(inked, 6)));
    await writeFile(
      `${OUT}/${clip.name}-game.png`,
      PNG.sync.write(strip(inked.map((f) => downscale(f, 32)), 1)),
    );
    console.log(
      `${clip.name}: ${frames.length} frames, swept OK` +
        (legGaps > 0 ? ` (${legGaps} between-leg gaps, expected)` : '') +
        ` → ${OUT}/${clip.name}-{6x,ink6x,game}.png`,
    );
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
