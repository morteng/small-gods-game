/**
 * Procedural spirit sigil renderer.
 * Generates a deterministic, belief-driven geometric symbol for each spirit.
 * Rendered to an offscreen canvas and cached as ImageBitmap.
 *
 * Belief attributes drive visual properties:
 *   faith       → smooth, circular, golden glow
 *   fear        → sharp angles, dark reds/purples
 *   understanding → complex inner geometry, cool blues
 *   devotion    → radiant lines outward, warm whites
 *   corruption  → asymmetry, jagged edges, sickly green
 */

export type SpiritArchetype = 'circle' | 'triangle' | 'diamond';

export interface BeliefState {
  faith: number;        // 0–1
  fear: number;         // 0–1
  understanding: number; // 0–1
  devotion: number;     // 0–1
  corruption: number;   // 0–1
}

export interface SpiritSigilOptions {
  archetype: SpiritArchetype;
  belief: BeliefState;
  size?: number;        // canvas size in px, default 48
}

/** Lerp between two values */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/** Convert HSL (0-360, 0-1, 0-1) to CSS color string */
function hsl(h: number, s: number, l: number): string {
  return `hsl(${h % 360},${(s * 100).toFixed(0)}%,${(l * 100).toFixed(0)}%)`;
}

/** Dominant belief attribute and its hue */
function dominantHue(b: BeliefState): number {
  const attrs: [keyof BeliefState, number][] = [
    ['faith', 45],          // gold
    ['devotion', 30],       // warm white/orange
    ['understanding', 210], // cool blue
    ['fear', 300],          // purple
    ['corruption', 120],    // sickly green
  ];
  let maxVal = -1;
  let hue = 45;
  for (const [key, h] of attrs) {
    if (b[key] > maxVal) { maxVal = b[key]; hue = h; }
  }
  return hue;
}

/**
 * Generate radial point offsets driven by belief.
 * Returns an array of N {r, angle} pairs forming the outer shape.
 */
function radialPoints(
  n: number,
  baseRadius: number,
  belief: BeliefState,
  archetype: SpiritArchetype,
  cx: number,
  cy: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const sharpness = belief.fear * 0.6 + belief.corruption * 0.4;

  for (let i = 0; i < n; i++) {
    const baseAngle = (i / n) * Math.PI * 2;

    // Archetype offset: triangle has 3-fold symmetry etc.
    let archetypeAngle = 0;
    if (archetype === 'triangle') archetypeAngle = -Math.PI / 2;
    if (archetype === 'diamond')  archetypeAngle = Math.PI / 4;
    const angle = baseAngle + archetypeAngle;

    // Radius modulation by belief
    const faithMod = belief.faith * 0.2 * Math.cos(angle * 3);        // 3-fold bulge
    const devotionMod = belief.devotion * 0.15 * Math.abs(Math.cos(angle)); // radial extension
    const corruptMod = belief.corruption * 0.25 * 0.3; // deterministic asymmetry

    // Sharpness: alternate long/short radii
    const alternating = sharpness > 0.2 ? (i % 2 === 0 ? 1 + sharpness : 1 - sharpness * 0.5) : 1;

    const r = baseRadius * alternating * (1 + faithMod + devotionMod + corruptMod);

    points.push({
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    });
  }

  return points;
}

/** Draw the sigil to an offscreen canvas and return an ImageBitmap */
export async function renderSigil(options: SpiritSigilOptions): Promise<ImageBitmap> {
  const { archetype, belief, size = 48 } = options;
  const cx = size / 2;
  const cy = size / 2;
  const baseRadius = size * 0.35;

  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  const hue = dominantHue(belief);
  const saturation = lerp(0.4, 1.0, Math.max(belief.faith, belief.fear, belief.understanding, belief.devotion, belief.corruption));
  const lightness  = lerp(0.35, 0.65, belief.faith * 0.5 + belief.devotion * 0.5);

  // ── Outer glow (devotion / faith) ──────────────────────────────────────────
  if (belief.faith > 0.3 || belief.devotion > 0.3) {
    const glowStrength = Math.max(belief.faith, belief.devotion);
    const grd = ctx.createRadialGradient(cx, cy, baseRadius * 0.5, cx, cy, baseRadius * 1.5);
    grd.addColorStop(0, hsl(hue, saturation, lightness + 0.2));
    grd.addColorStop(1, 'transparent');
    ctx.globalAlpha = glowStrength * 0.4;
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ── Number of outer points: understanding adds complexity ─────────────────
  const numPoints = archetype === 'circle'
    ? Math.round(lerp(8, 16, belief.understanding))
    : archetype === 'triangle' ? 6 : 8;

  const outerPts = radialPoints(numPoints, baseRadius, belief, archetype, cx, cy);

  // ── Main shape fill ────────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(outerPts[0].x, outerPts[0].y);
  for (let i = 1; i < outerPts.length; i++) {
    if (belief.faith > 0.4) {
      // Smooth curves for high-faith spirits
      const prev = outerPts[i - 1];
      const curr = outerPts[i];
      ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2);
    } else {
      ctx.lineTo(outerPts[i].x, outerPts[i].y);
    }
  }
  ctx.closePath();

  const fillGrd = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius);
  fillGrd.addColorStop(0, hsl(hue, saturation * 0.7, lightness + 0.15));
  fillGrd.addColorStop(1, hsl(hue, saturation, lightness));
  ctx.fillStyle = fillGrd;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;

  // ── Outline ────────────────────────────────────────────────────────────────
  ctx.strokeStyle = hsl(hue, saturation, lightness + 0.25);
  ctx.lineWidth = belief.fear > 0.5 ? 2 : 1;
  ctx.stroke();

  // ── Devotion radiant lines ─────────────────────────────────────────────────
  if (belief.devotion > 0.3) {
    const rayCount = Math.round(lerp(4, 12, belief.devotion));
    ctx.strokeStyle = hsl(hue, saturation * 0.5, 0.9);
    ctx.lineWidth = 0.75;
    ctx.globalAlpha = belief.devotion * 0.6;
    for (let i = 0; i < rayCount; i++) {
      const angle = (i / rayCount) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + baseRadius * 0.9 * Math.cos(angle), cy + baseRadius * 0.9 * Math.sin(angle));
      ctx.lineTo(cx + baseRadius * 1.4 * Math.cos(angle), cy + baseRadius * 1.4 * Math.sin(angle));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ── Understanding inner geometry (concentric detail) ──────────────────────
  if (belief.understanding > 0.3) {
    const rings = Math.round(lerp(1, 3, belief.understanding));
    ctx.strokeStyle = hsl(hue - 30, saturation * 0.8, lightness + 0.3);
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = belief.understanding * 0.7;
    for (let ring = 1; ring <= rings; ring++) {
      const r = baseRadius * 0.25 * ring;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Star of understanding
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = baseRadius * 0.4;
      i === 0 ? ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
              : ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ── Fear dark overlay (jagged inner shadow) ───────────────────────────────
  if (belief.fear > 0.4) {
    const shadowGrd = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius * 0.6);
    shadowGrd.addColorStop(0, 'rgba(0,0,0,0.5)');
    shadowGrd.addColorStop(1, 'transparent');
    ctx.globalAlpha = belief.fear * 0.5;
    ctx.fillStyle = shadowGrd;
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ── Central dot ───────────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1.5, size * 0.04), 0, Math.PI * 2);
  ctx.fillStyle = hsl(hue, saturation * 0.5, 0.9);
  ctx.fill();

  return canvas.transferToImageBitmap();
}

/**
 * Simple cache: renders a new sigil only when belief changes significantly.
 * Key = spiritId, value = { bitmap, belief snapshot }
 */
interface CachedSigil {
  bitmap: ImageBitmap;
  belief: BeliefState;
}

const sigilCache = new Map<string, CachedSigil>();
const DELTA_THRESHOLD = 0.05;

function beliefChanged(a: BeliefState, b: BeliefState): boolean {
  return (Object.keys(a) as (keyof BeliefState)[]).some(
    k => Math.abs(a[k] - b[k]) > DELTA_THRESHOLD
  );
}

/**
 * Get (or regenerate) a sigil for a spirit.
 * Regenerates only if belief state has changed beyond threshold.
 */
export async function getSigil(
  spiritId: string,
  options: SpiritSigilOptions,
): Promise<ImageBitmap> {
  const cached = sigilCache.get(spiritId);
  if (cached && !beliefChanged(cached.belief, options.belief)) {
    return cached.bitmap;
  }

  const bitmap = await renderSigil(options);
  sigilCache.set(spiritId, { bitmap, belief: { ...options.belief } });
  return bitmap;
}
