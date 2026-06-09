// Cheap screen-space AO baked once at generation time. For each opaque pixel, sample a
// small neighbourhood; neighbours that are NEARER the camera (higher depth) occlude it.
// Returns an AO buffer (0=fully occluded .. 255=open). Pure + deterministic.
export function computeAO(
  depth: Float32Array, opaque: Float32Array, size: number,
  radius = 2, strength = 1.0,
): Uint8ClampedArray {
  const ao = new Uint8ClampedArray(size * size).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    if (!opaque[i]) continue;
    const d = depth[i];
    let occ = 0, samples = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = ny * size + nx;
      if (!opaque[j]) continue;
      samples++;
      if (depth[j] > d) occ += Math.min(1, (depth[j] - d));
    }
    if (samples > 0) {
      const f = Math.max(0, 1 - (occ / samples) * strength);
      ao[i] = Math.round(f * 255);
    }
  }
  return ao;
}
