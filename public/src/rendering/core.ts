/**
 * Small Gods - Rendering Core Helpers
 */

/**
 * Darken a hex color by a given amount
 */
export function darken(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  return `rgb(${Math.floor(rgb.r * (1 - amount))},${Math.floor(rgb.g * (1 - amount))},${Math.floor(rgb.b * (1 - amount))})`;
}

/**
 * Lighten a hex color by a given amount
 */
export function lighten(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  return `rgb(${Math.min(255, Math.floor(rgb.r * (1 + amount)))},${Math.min(255, Math.floor(rgb.g * (1 + amount)))},${Math.min(255, Math.floor(rgb.b * (1 + amount)))})`;
}

/**
 * Convert hex color to RGB object
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 128, g: 128, b: 128 };
}

/**
 * Shift hue of a hex color by degrees
 */
export function shiftHue(hex: string, degrees: number): string {
  const rgb = hexToRgb(hex);
  // Convert to HSL
  const r = rgb.r / 255,
    g = rgb.g / 255,
    b = rgb.b / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s: number;
  const l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  // Shift hue
  h = (h + degrees / 360) % 1;
  if (h < 0) h += 1;

  // Convert back to RGB
  let r2: number, g2: number, b2: number;
  if (s === 0) {
    r2 = g2 = b2 = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r2 = hue2rgb(p, q, h + 1 / 3);
    g2 = hue2rgb(p, q, h);
    b2 = hue2rgb(p, q, h - 1 / 3);
  }

  return `rgb(${Math.round(r2 * 255)},${Math.round(g2 * 255)},${Math.round(b2 * 255)})`;
}

/**
 * RGB to hex conversion
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}
