// src/assetgen/compose.ts
import type { Vec3, RGB, Mat, WorldFacet } from '@/assetgen/types';
import {
  solidBox, solidBoxYawed, solidBoxRot, solidCylinder, solidCone, solidPrism, solidPyramid, solidEllipsoid,
  manifoldToFacets, buildingFacets, carveApertures, boreCylinder, cylindricalProjector,
} from '@/assetgen/geometry/solids';
import type { ApertureBox } from '@/assetgen/geometry/solids';
import { solidArchCurved, archVoussoirProjector, type ArchStyle } from '@/assetgen/geometry/arch';
import { solidColumn, columnProjector, type ColumnShape, type ColumnBand } from '@/assetgen/geometry/column';
import type { Wing, RoofStyle, BuildingFeatures, BuildingAnchors } from '@/assetgen/geometry/building';
import { linearFacets } from '@/assetgen/geometry/linear';
import { tubeFacets, blobFacets, rockFacets } from '@/assetgen/geometry/flora/mesh';
import type { Limb, Leaf } from '@/assetgen/geometry/flora/turtle';
import type { BarrierRun } from '@/world/barrier';
import { projectFacets, project } from '@/assetgen/render/projection';
import { rasterizeMaps, writeNormalisedDepth } from '@/assetgen/render/rasterize';
import { computeAO } from '@/assetgen/render/ao';
import { applyWeathering, weatherSeed, type WeatherOpts } from '@/assetgen/render/weathering';
import { computeFit, fixedFit, opaqueBounds, type BBox } from '@/assetgen/render/fit';
import { composeGroundShadow, type GroundShadow } from '@/assetgen/render/ground-shadow';
import { mToTiles } from '@/render/scale-contract';
import type { Anchor, MountAnchorKind } from '@/world/anchors';

export type Part =
  | { prim: 'box'; at: Vec3; size: Vec3; material?: Mat; work?: string; finish?: string; tint?: RGB; apertures?: ApertureBox[]; yaw?: number; rot?: Vec3 }
  | { prim: 'cylinder'; center: [number, number]; baseZ: number; radius: number; height: number; material?: Mat; work?: string; finish?: string; tint?: RGB; apertures?: ApertureBox[] }
  | { prim: 'cone'; center: [number, number]; baseZ: number; radius: number; height: number; material?: Mat; finish?: string; tint?: RGB }
  | { prim: 'prism'; center: [number, number]; baseZ: number; radius: number; height: number; sides: number; material?: Mat; work?: string; finish?: string; tint?: RGB }
  | { prim: 'pyramid'; center: [number, number]; baseZ: number; halfW: number; halfH: number; height: number; material?: Mat; work?: string; finish?: string; tint?: RGB }
  | { prim: 'ellipsoid'; center: [number, number]; baseZ: number; radii: Vec3; material?: Mat; bore?: { radius: number; depth: number } }
  | { prim: 'arch'; at: Vec3; span: number; height: number; thickness: number; yaw?: number; material?: Mat; work?: string; style?: ArchStyle; ringDepth?: number; springZ?: number }
  | { prim: 'column'; center: [number, number]; baseZ?: number; shape?: ColumnShape; sides?: number; radius: number; topRadius?: number; height: number; base?: ColumnBand | null; capital?: ColumnBand | null; material?: Mat; work?: string }
  | { prim: 'building'; wings: Wing[]; wallMat?: Mat; roofMat?: Mat; roofStyle?: RoofStyle; features?: BuildingFeatures; seed?: number; apertures?: ApertureBox[]; wallWork?: string; wallFinish?: string; roofFinish?: string; finishTint?: RGB; baseCourse?: number; cutaway?: boolean; interior?: { partitions: number[]; floorDrop: number[]; screens?: boolean[]; levels?: number[] } }
  | { prim: 'flora'; limbs: Limb[]; leaves: Leaf[]; barkMat?: Mat; foliageMat?: Mat; foliageTint?: RGB }
  | { prim: 'rock'; center: [number, number]; baseZ: number; radius: number; seed: number; jitter?: number; aspect?: number; mat?: Mat; subdiv?: number }
  | { prim: 'linear'; run: BarrierRun }
  // A flat ground apron under (and around) a building footprint: a thin slab whose top
  // face sits flush with the ground plane (z=0, where walls start) and drops `thickness`
  // below as a foundation lip. Optional, opt-in: gives buildings a yard/forecourt the
  // world graph can later erode against real terrain. See `toGeometry` skirt emission.
  | { prim: 'skirt'; rect: { x: number; y: number; w: number; h: number }; thickness?: number; material?: Mat };

/** World-space linear-structure anchors (wall ends + gate openings), pre-normalisation. */
export interface LinearWorldAnchors { wallEnds: Vec3[]; gates: Vec3[] }

/** `mountAnchors` (optional) are WORLD-space height-bearing sockets (lintel/ridge/gable/eave/
 *  chimney/apex) in the blueprint-local tile frame with metric `z`; compose projects them
 *  through the SAME fit as the geometry into `StructureAnchors.tags` (the sprite-normalised
 *  downstream projection the 2026-06-13 anchor-tags spec wanted persisted in the SpritePack). */
export interface StructureSpec { id?: string; size?: number; parts: Part[]; mountAnchors?: Anchor[]; yaw?: number }
/** Feature anchors normalised (0..1) against the sprite's opaque bbox, so they survive a repaint + crop. */
export interface NormAnchor { x: number; y: number }
export interface DoorAnchorN extends NormAnchor { main: boolean }
/** A mount socket projected onto the sprite: normalised x/y (opaque-bbox 0..1) plus the role
 *  and the `accepts` tokens + metric `z` carried over for a decoration/fauna pass to read. */
export interface MountAnchorN extends NormAnchor { kind: MountAnchorKind; z: number; accepts?: string[] }
/** A world-space point (geometry tile frame: x/y tiles, z cube-units) tagged with an id,
 *  handed to compose so the SAME fit+yaw+bbox-normalisation that places the sprite also
 *  reports where the point lands — used by the authoring montage to stamp Set-of-Mark part
 *  labels at pixel-accurate positions. Additive: absent ⇒ no `labels`, goldens untouched. */
export interface LabelPoint { id: string; x: number; y: number; z: number }
export interface LabelN extends NormAnchor { id: string }
/** `doors` is retained for shape-compat but is always empty now: doors became carved
 *  openings (Blueprint layer) and their pathing anchors live in the world-space `toAnchors`
 *  compiler, not in the sprite-space structure anchors. `tags` = the projected mount sockets. */
export interface StructureAnchors { doors: DoorAnchorN[]; vents: NormAnchor[]; wallEnds?: NormAnchor[]; gates?: NormAnchor[]; tags?: MountAnchorN[] }
export interface StructureMeta {
  bbox: BBox; anchors: StructureAnchors;
  /** Raw view-depth span the per-sprite depth channel was normalised over (absent if the render is empty). */
  depthRange?: { lo: number; hi: number };
}
export interface StructureResult {
  grey: Uint8ClampedArray; normal: Uint8ClampedArray;
  material: Uint8ClampedArray; emissive: Uint8ClampedArray;
  size: number; meta: StructureMeta; bbox: BBox; anchors: StructureAnchors;
  /** Geometry-projected ground cast shadow (baked from the same facets), or null. */
  shadow?: GroundShadow | null;
  /** Present ONLY when `opts.labelPoints` was passed — each point normalised (0..1) to the
   *  opaque bbox through the SAME fit/yaw as the sprite. For the authoring montage overlay. */
  labels?: LabelN[];
}

/** Build one part's solid(s) → facets, plus any world-space anchors (buildings only). */
async function partFacets(p: Part): Promise<{ facets: WorldFacet[]; anchors?: BuildingAnchors; linearAnchors?: LinearWorldAnchors }> {
  switch (p.prim) {
    case 'box': {
      let s = p.rot ? await solidBoxRot(p.at, p.size, p.rot) : await solidBoxYawed(p.at, p.size, p.yaw);
      s = await carveApertures(s, p.apertures);
      return { facets: manifoldToFacets(s.getMesh(), p.material ?? 'stone', p.work, undefined, p.finish, p.tint) };
    }
    case 'cylinder': {
      let s = await solidCylinder(p.center, p.baseZ, p.radius, p.height);
      s = await carveApertures(s, p.apertures);
      return { facets: manifoldToFacets(s.getMesh(), p.material ?? 'stone', p.work, cylindricalProjector(p.center, p.radius), p.finish, p.tint) };
    }
    case 'cone':      return { facets: manifoldToFacets((await solidCone(p.center, p.baseZ, 0, p.radius, p.height)).getMesh(), p.material ?? 'foliage', undefined, cylindricalProjector(p.center, p.radius), p.finish, p.tint) };
    case 'prism':     return { facets: manifoldToFacets((await solidPrism(p.center, p.baseZ, p.radius, p.height, p.sides)).getMesh(), p.material ?? 'stone', p.work, cylindricalProjector(p.center, p.radius), p.finish, p.tint) };
    case 'pyramid':   return { facets: manifoldToFacets((await solidPyramid(p.center, p.baseZ, p.halfW, p.halfH, p.height)).getMesh(), p.material ?? 'stone', p.work, undefined, p.finish, p.tint) };
    case 'ellipsoid': {
      let s = await solidEllipsoid(p.center, p.baseZ, p.radii);
      if (p.bore) s = await boreCylinder(s, p.center, p.baseZ + 2 * p.radii[2], p.bore.radius, p.bore.depth);
      return { facets: manifoldToFacets(s.getMesh(), p.material ?? 'foliage') };
    }
    case 'arch': {
      // `flat` keeps the historic post-and-lintel portal; any other style builds the
      // real curved ring (round/segmental/pointed/horseshoe). solidArchCurved itself
      // delegates `flat` back to solidArch, so this one call covers both.
      const style = p.style ?? 'flat';
      const ringDepth = p.ringDepth ?? 0.35;
      const springZ = p.springZ ?? 0;
      const m = await solidArchCurved(p.at, p.span, p.height, p.thickness, {
        style, ringDepth, springZ, yaw: p.yaw,
      });
      // Curved rings get a polar voussoir frame on their faces (KV) + dressed-ashlar
      // coursing by default, so the masonry reads as radial wedges. The flat portal keeps
      // the planar default. p.height is the rise; p.span the footprint width.
      const proj = style !== 'flat'
        ? archVoussoirProjector(p.at, p.span, p.height, ringDepth, springZ, p.yaw ?? 0)
        : undefined;
      const work = p.work ?? (style !== 'flat' ? 'ashlar' : undefined);
      return { facets: manifoldToFacets(m.getMesh(), p.material ?? 'stone', work, proj) };
    }
    case 'column': {
      const opts = { baseZ: p.baseZ, shape: p.shape, sides: p.sides, radiusU: p.radius, topRadiusU: p.topRadius, heightU: p.height, base: p.base, capital: p.capital };
      const m = await solidColumn(p.center, opts);
      return { facets: manifoldToFacets(m.getMesh(), p.material ?? 'stone', p.work, columnProjector(p.center, opts)) };
    }
    case 'building':  return buildingFacets(p.wings, p.wallMat, p.roofMat, p.roofStyle, p.features, p.seed, p.apertures, p.wallWork, p.baseCourse, p.cutaway, p.interior,
      p.wallFinish || p.roofFinish || p.finishTint ? { wall: p.wallFinish, roof: p.roofFinish, tint: p.finishTint } : undefined);
    case 'flora':     return { facets: [...tubeFacets(p.limbs, p.barkMat ?? 'bark'), ...blobFacets(p.leaves, p.foliageMat ?? 'foliage', {}, p.foliageTint)] };
    case 'rock':      return { facets: rockFacets({ center: p.center, baseZ: p.baseZ, radius: p.radius, seed: p.seed, jitter: p.jitter, aspect: p.aspect, mat: p.mat, subdiv: p.subdiv }) };
    case 'linear':    { const r = await linearFacets(p.run); return { facets: r.facets, linearAnchors: r.anchors }; }
    case 'skirt': {
      // Thickness ALWAYS goes DOWN: the slab spans z ∈ [−t, 0] so its top face is flush
      // with the ground plane (z=0, the wall base) and the lip drops below. It must never
      // rise into the building (which occupies z ≥ 0). guard with Math.max(0, …).
      const t = Math.max(0, p.thickness ?? 0.08);  // ~16 cm foundation lip, downward
      const s = await solidBox([p.rect.x, p.rect.y, -t], [p.rect.w, p.rect.h, t]);
      return { facets: manifoldToFacets(s.getMesh(), p.material ?? 'earth') };
    }
  }
}

export interface ComposeOpts {
  /** 0 = hard-edged apron; >0 fades the visible skirt's OUTER edge to transparent over
   *  ~`skirtFade × 22 px`, so it reads as blending into the ground (erosion preview). */
  skirtFade?: number;
  /** Procedural weathering of building/prop albedo (dirt/streaks/rust). Default ON.
   *  Pass `false` when the grey is consumed as an img2img INIT — weathering muddies the
   *  material-coded colours the prompt legend keys off. Pure flora/rock never weathers. */
  weather?: WeatherOpts | false;
  /** Turntable yaw (radians) — spins the model about its vertical axis BEFORE the
   *  fixed dimetric projection, i.e. orbits the camera around it. 0/undefined =
   *  the canonical view (unchanged; golden hashes only pin the yaw-0 path). Lighting
   *  follows (the lit face changes as you spin, like a real turntable). */
  yaw?: number;
  /** Analytic Material+Finish surface texturing (K0). When true, opaque pixels are textured
   *  by the surface engine at their world position (kills the flat grey-massing look,
   *  freeze-safe procedural). Default off so goldens stay pinned until K0d flips the default. */
  surfaceTexture?: boolean;
  /** World-space points (geometry tile frame) to project onto the sprite alongside the
   *  geometry, returned as `result.labels`. Additive — absent ⇒ no `labels`, output byte-
   *  identical. Used by the authoring montage to place Set-of-Mark part labels. */
  labelPoints?: LabelPoint[];
}

/** Geometry world units per metre — feature wavelengths are authored in metres. */
const SURFACE_UNITS_PER_M = mToTiles(1);   // 0.5 tile = 1 m

/**
 * Fade the visible skirt's outer edge to transparent in `albedo`'s alpha channel.
 * "Visible skirt" = pixels the skirt drew that the body does NOT cover (a same-fit
 * skirt-only vs body-only re-raster), so the building's own footprint stays solid.
 * A two-pass chamfer distance from the apron boundary drives the alpha ramp.
 */
function applySkirtFade(
  albedo: Uint8ClampedArray, size: number, fit: Parameters<typeof projectFacets>[1],
  skirtFacets: WorldFacet[], bodyFacets: WorldFacet[], fade: number,
): void {
  if (fade <= 0 || skirtFacets.length === 0) return;
  const sM = rasterizeMaps(projectFacets(skirtFacets, fit), size);
  const bM = rasterizeMaps(projectFacets(bodyFacets, fit), size);
  const n = size * size;
  const vis = new Uint8Array(n);
  for (let i = 0; i < n; i++) vis[i] = (sM.albedo[i * 4 + 3] === 255 && bM.albedo[i * 4 + 3] !== 255) ? 1 : 0;
  const D = 1e9, dist = new Float32Array(n);
  for (let i = 0; i < n; i++) dist[i] = vis[i] ? D : 0;
  const SQ = Math.SQRT2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x; if (!vis[i]) continue; let d = dist[i];
    if (x > 0) d = Math.min(d, dist[i - 1] + 1);
    if (y > 0) d = Math.min(d, dist[i - size] + 1);
    if (x > 0 && y > 0) d = Math.min(d, dist[i - size - 1] + SQ);
    if (x < size - 1 && y > 0) d = Math.min(d, dist[i - size + 1] + SQ);
    dist[i] = d;
  }
  for (let y = size - 1; y >= 0; y--) for (let x = size - 1; x >= 0; x--) {
    const i = y * size + x; if (!vis[i]) continue; let d = dist[i];
    if (x < size - 1) d = Math.min(d, dist[i + 1] + 1);
    if (y < size - 1) d = Math.min(d, dist[i + size] + 1);
    if (x < size - 1 && y < size - 1) d = Math.min(d, dist[i + size + 1] + SQ);
    if (x > 0 && y < size - 1) d = Math.min(d, dist[i + size - 1] + SQ);
    dist[i] = d;
  }
  const fadePx = Math.max(1, fade * 22);
  for (let i = 0; i < n; i++) {
    if (!vis[i]) continue;
    albedo[i * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, dist[i] / fadePx)));
  }
}

/** Build a yaw rotor about the facets' world-XY centre, or null for yaw≈0. The
 *  returned fn rotates a point about that centre; pass `vector=true` to rotate a
 *  direction (normal) only (no translation). */
function makeYawRotor(facets: WorldFacet[], yaw?: number): ((p: Vec3, vector?: boolean) => Vec3) | null {
  if (!yaw || Math.abs(yaw) < 1e-6 || facets.length === 0) return null;
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const f of facets) for (const p of f.pts) {
    if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
    if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
  }
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return (p: Vec3, vector = false): Vec3 => {
    const dx = vector ? p[0] : p[0] - cx;
    const dy = vector ? p[1] : p[1] - cy;
    const rx = dx * c - dy * s, ry = dx * s + dy * c;
    return vector ? [rx, ry, p[2]] : [cx + rx, cy + ry, p[2]];
  };
}

/** Compose a structure spec into aligned grey + normal RGBA buffers (+ bbox/anchors).
 *  Deterministic. `shadowSun` (screen-space, default canonical upper-left) bakes the
 *  geometry cast shadow — vary it to preview different sun directions. `opts.skirtFade`
 *  softens a ground-apron's outer edge. */
export async function composeStructure(spec: StructureSpec, shadowSun?: [number, number, number], opts?: ComposeOpts): Promise<StructureResult> {
  const parts = await Promise.all(spec.parts.map(partFacets));
  const facets = parts.flatMap(p => p.facets);
  // Turntable: rotate every facet (point + normal) about the model's vertical axis
  // through its world-XY centre. Equivalent to orbiting the fixed camera. Anchors
  // rotate too (so img2img alignment holds). yaw-0 is a no-op → goldens untouched.
  const rotWorld = makeYawRotor(facets, opts?.yaw);
  if (rotWorld) {
    for (const f of facets) {
      f.pts = f.pts.map((p) => rotWorld(p));
      f.normal = rotWorld(f.normal, true);
      // Keep an authored UV frame consistent with the rotated geometry: planar axes rotate
      // as vectors; a cylindrical axis-centre rotates as a point (radius is invariant).
      if (f.frame?.kind === 'planar') {
        f.frame = { kind: 'planar', uAxis: rotWorld(f.frame.uAxis, true), vAxis: rotWorld(f.frame.vAxis, true) };
      } else if (f.frame?.kind === 'cylindrical') {
        const c = rotWorld([f.frame.cx, f.frame.cy, 0]);
        f.frame = { kind: 'cylindrical', cx: c[0], cy: c[1], radius: f.frame.radius };
      } else if (f.frame?.kind === 'polar') {
        // Rotate the centre as a point; the span-plane only changes under a 90° turntable
        // (studio preview only — the golden/real render path is yaw-0), so leave spanAxis.
        const c = rotWorld([f.frame.cx, f.frame.cy, f.frame.cz]);
        f.frame = { ...f.frame, cx: c[0], cy: c[1] };
      }
    }
  }
  // Buildings render at a fixed metric scale (content-sized canvas) so heights stay
  // mutually proportional. An explicit spec.size opts back into legacy fit-to-box.
  let fit, size: number;
  if (spec.size != null) { size = spec.size; fit = computeFit(facets, size); }
  else { const f = fixedFit(facets); fit = f.fit; size = f.size; }
  const screen = projectFacets(facets, fit);
  const maps = rasterizeMaps(screen, size, opts?.surfaceTexture ? { unitsPerMetre: SURFACE_UNITS_PER_M } : undefined);
  const depthRange = writeNormalisedDepth(maps) ?? undefined;
  const opaque = new Float32Array(size * size);
  for (let i = 0; i < opaque.length; i++) opaque[i] = maps.albedo[i * 4 + 3] === 255 ? 1 : 0;
  const ao = computeAO(maps.depthRaw, opaque, size);
  for (let i = 0; i < ao.length; i++) if (opaque[i]) maps.material[i * 4 + 1] = ao[i];
  const grey = maps.albedo;
  const normal = maps.normal;
  const bbox = opaqueBounds(grey, size);
  // Procedural weathering — age building/prop bodies (dirt low, grime in crevices,
  // rain-streaks, rust on metal). Pure flora/rock is left pristine. Mutates `grey`
  // (= maps.albedo) + material in place; deterministic, seeded off the spec id.
  const weather = opts?.weather;
  const pureFloraRock = spec.parts.length > 0 && spec.parts.every(p => p.prim === 'flora' || p.prim === 'rock');
  if (weather !== false && !pureFloraRock) {
    applyWeathering(maps, bbox, { seed: weatherSeed(spec.id), ...(typeof weather === 'object' ? weather : {}) });
  }
  // Geometry-correct ground shadow, baked from the SAME facets.
  const shadow = composeGroundShadow(facets, fit, shadowSun);

  // Optional ground-apron edge fade: soften the visible skirt's outer edge so it blends
  // into the terrain beneath. Done AFTER bbox so the crop stays stable. The split is by
  // part kind: 'skirt' facets fade against everything else (the body).
  if (opts?.skirtFade) {
    const skirtFacets: WorldFacet[] = [], bodyFacets: WorldFacet[] = [];
    spec.parts.forEach((p, i) => (p.prim === 'skirt' ? skirtFacets : bodyFacets).push(...parts[i].facets));
    applySkirtFade(grey, size, fit, skirtFacets, bodyFacets, opts.skirtFade);
  }

  // Project world-space anchors through the same fit, then normalise to the opaque bbox.
  const norm = (p: Vec3): NormAnchor => {
    const s = project(rotWorld ? rotWorld(p) : p, fit);
    return { x: (s.x - bbox.x) / (bbox.w || 1), y: (s.y - bbox.y) / (bbox.h || 1) };
  };
  const anchors: StructureAnchors = { doors: [], vents: [] };
  for (const part of parts) {
    if (part.anchors) {
      for (const v of part.anchors.vents) anchors.vents.push(norm(v));
    }
    if (part.linearAnchors) {
      (anchors.wallEnds ??= []).push(...part.linearAnchors.wallEnds.map(norm));
      (anchors.gates ??= []).push(...part.linearAnchors.gates.map(norm));
    }
  }
  // Mount sockets (sign/lamp/perch/smoke). World-space, blueprint-local tile XY + metric z;
  // lift z into the geometry's tile frame (mToTiles) so it projects through the SAME fit as
  // the facets, landing on the real ridge/eave/lintel in the sprite. Normalised like the rest.
  if (spec.mountAnchors?.length) {
    anchors.tags = spec.mountAnchors.map((a): MountAnchorN => ({
      ...norm([a.x, a.y, mToTiles(a.z ?? 0)]),
      kind: a.kind as MountAnchorKind, z: a.z ?? 0, ...(a.accepts ? { accepts: a.accepts } : {}),
    }));
  }

  // Authoring-montage label points: project each through the SAME fit+yaw+bbox-norm as the
  // sprite so an overlay marker lands exactly on the part. Absent unless a caller asked.
  const labels: LabelN[] | undefined = opts?.labelPoints?.length
    ? opts.labelPoints.map((p): LabelN => ({ id: p.id, ...norm([p.x, p.y, p.z]) }))
    : undefined;

  return { grey, normal, material: maps.material, emissive: maps.emissive, size, meta: { bbox, anchors, depthRange }, bbox, anchors, shadow, ...(labels ? { labels } : {}) };
}
