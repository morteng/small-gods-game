// Chroma-key for img2img building sprites. The image model (nano-banana) does not
// reliably emit true alpha — half the time it bakes an opaque background. So we
// instead PROMPT it to paint the background a solid uniform chroma colour and key
// that out here. Pure magenta (255,0,255) is the classic key colour: fully
// saturated, essentially absent from natural building materials, and far from the
// warm palette buildings use. Operates in place on a getImageData() RGBA buffer.

/** The background colour the prompt asks for and this keyer removes. */
export const CHROMA_RGB = [255, 0, 255] as const;

// "Magenta-ness" = how strongly red+blue dominate green. Pixels above T_FULL are
// background → fully transparent; between T_EDGE and T_FULL are anti-aliased fringe
// → partial alpha plus a despill that pulls the purple tint back toward neutral so
// keyed edges don't glow. Tuned on the cottage spike (no visible halo).
const T_FULL = 110;
const T_EDGE = 30;

/**
 * Composite an RGBA buffer over a solid chroma-magenta field (returns a copy; the
 * input is untouched). Used on the img2img INIT image: the model follows the
 * reference image far more reliably than the text prompt, so showing it the exact
 * magenta background we later key out beats asking for it in words.
 */
export function compositeOverChroma(d: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(d.length);
  const [cr, cg, cb] = CHROMA_RGB;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    out[i] = Math.round(d[i] * a + cr * (1 - a));
    out[i + 1] = Math.round(d[i + 1] * a + cg * (1 - a));
    out[i + 2] = Math.round(d[i + 2] * a + cb * (1 - a));
    out[i + 3] = 255;
  }
  return out;
}

/** Key magenta → alpha (with edge despill), mutating the RGBA buffer in place. */
export function chromaKeyMagenta(d: Uint8ClampedArray): void {
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mag = Math.min(r, b) - g;
    if (mag > T_FULL) {
      d[i + 3] = 0;
    } else if (mag > T_EDGE) {
      d[i + 3] = Math.round(d[i + 3] * (1 - (mag - T_EDGE) / (T_FULL - T_EDGE)));
      const cap = g + T_EDGE;            // despill: clamp the magenta channels toward green
      if (r > cap) d[i] = cap;
      if (b > cap) d[i + 2] = cap;
    }
  }
}
