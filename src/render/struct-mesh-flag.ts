// src/render/struct-mesh-flag.ts
//
// Dev gate for the depth-tested structure-mesh pass (3D-structure epic, S1). Default OFF —
// `?structmesh` renders bridges as founded 3D meshes (and suppresses their billboard so the
// A/B is clean); `?structmesh=off` (or absent) keeps the billboard sprite path. Read once.
let cached: boolean | undefined;
export function structMeshEnabled(): boolean {
  if (cached !== undefined) return cached;
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    const p = new URLSearchParams(search);
    cached = p.has('structmesh') && p.get('structmesh') !== 'off';
  } catch {
    cached = false;
  }
  return cached;
}
