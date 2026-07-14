// src/render/flora-variant.ts
// Per-instance flora variation, the two pure helpers that turn "one bitmap per
// species" into "N seeded silhouettes per species":
//   • floraVariantSeed(kind, v) — the deterministic per-variant blueprint seed the
//     ParametricPlantSource bakes. Variant 0 is EXACTLY the legacy seedless seed
//     (hash(kind)) so existing worlds keep their look as a subset.
//   • floraVariantBucket(entityId, V) — a stable FNV-1a hash of the entity id into
//     0..V-1, so every instance deterministically picks one of the baked variants
//     (same world + same ids → same variants across reloads).
// No Math.random; not under src/sim (this is render-side variety, not sim truth).

/** How many seeded silhouettes each species is baked into. Kept small (variants are
 *  composed lazily off the loading path — see ParametricPlantSource). */
export const FLORA_VARIANTS = 3;

/** Fold a species name into a seed (the same law `synthesizeBlueprint` uses for its
 *  seedless default). Used to spread the non-zero variants apart by species. */
function hashKind(name: string): number {
  return [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
}

/** Deterministic blueprint seed for variant `v` of a species `kind`.
 *  `v === 0` returns 0 — the flora skeleton generators derive their RNG from the
 *  blueprint seed, and a 0 seed is the sentinel that today's world already renders
 *  (see the flora-branch/rock resolve fix), so VARIANT 0 IS EXACTLY THE CURRENT LOOK
 *  for every species. Higher variants mix the name hash with the variant index into a
 *  well-spread NON-zero seed (never 0 — that would collide with variant 0). */
export function floraVariantSeed(kind: string, v: number): number {
  if (v === 0) return 0;
  const h = hashKind(kind);
  let x = (h ^ Math.imul(v + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x2c1b3c6d) >>> 0;
  x ^= x >>> 15;
  return (x >>> 0) || 1;
}

/** Stable FNV-1a hash of an entity id into a variant bucket `0..V-1`. Deterministic:
 *  the same id always maps to the same variant, so a world's trees keep their chosen
 *  silhouettes across reloads. */
export function floraVariantBucket(id: string, V: number = FLORA_VARIANTS): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % Math.max(1, V);
}
