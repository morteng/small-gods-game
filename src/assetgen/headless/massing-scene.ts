// src/assetgen/headless/massing-scene.ts
/**
 * Pure descriptor → THREE.Scene + OrthographicCamera builder for offline guide
 * images. NO GL context is created here — only scene-graph objects, so this is
 * fully unit-testable in Node. Rasterization lives in massing-renderer.ts.
 *
 * Units: 1 tile = 1 world unit in XZ; 1 tile-height-unit = 1 world unit in Y
 * (heights are already authored in tile-height units). The 2:1 dimetric camera
 * supplies the iso look; pixel-exact game alignment is intentionally NOT a goal
 * for a loose init_image guide.
 */
import * as THREE from 'three';
import type { BuildingDescriptor, Roof } from '@/world/building-descriptor';
import { buildingMassing, type Massing } from '@/render/building-massing-model';
import { SUN_DIRECTION } from '@/render/lighting';

export interface MassingScene {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
}

const DOOR_COLOR = 0xff00ff; // magenta marker, matches the 2D guidance door dot
const GRID_COLOR = 0x5a6478;

/**
 * Build a square (4-sided) pyramid as a scaled cone spanning the FULL footprint
 * (rx = full width w, rz = full depth h). After rotateY(45°) the radius-0.5 cone's
 * bbox half-extent is 0.5·SQRT1_2 ≈ 0.354; scaling x by (w/0.5)·SQRT1_2 = w·SQRT1_2·2
 * makes its base bbox span exactly ±w/2 (verified: pyramid(6,4) → 6×4 base).
 */
function pyramid(rx: number, rz: number, rise: number, color: number): THREE.Mesh {
  const geo = new THREE.ConeGeometry(0.5, rise, 4);
  geo.rotateY(Math.PI / 4);
  geo.scale(rx / 0.5 * Math.SQRT1_2, 1, rz / 0.5 * Math.SQRT1_2);
  return new THREE.Mesh(geo, mat(color));
}

/** Extrude a 2D profile (in x–y) along z to make a ridged prism (gable family). */
function prism(profile: THREE.Vector2[], depth: number, color: number): THREE.Mesh {
  const shape = new THREE.Shape(profile);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  return new THREE.Mesh(geo, mat(color));
}

function mat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true });
}

function hexToInt(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})/.exec(hex);
  return m ? parseInt(m[1], 16) : 0x888888; // parse-check, not truthiness (preserves #000000)
}

/** True for the transparent 'none' roof sentinel (#00000000) — that roof draws nothing. */
function isTransparent(hex: string): boolean {
  const m = /^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})$/.exec(hex);
  return !!m && m[1] === '00';
}

/** Roof group sitting on a body of plan w×h (XZ), starting at y = bodyTop. Exported for geometry tests. */
export function buildRoof(roof: Roof, w: number, h: number, rise: number, bodyTop: number, color: number): THREE.Object3D {
  const g = new THREE.Group();
  const hw = w / 2, hh = h / 2;
  const place = (m: THREE.Object3D, y: number) => { m.position.y = y; g.add(m); };

  switch (roof) {
    case 'gable':
    case 'saltbox': {
      // triangle profile across the short span (x), ridge along z (depth h)
      const ridgeX = roof === 'saltbox' ? -hw * 0.25 : 0; // offset ridge for saltbox
      const tri = [new THREE.Vector2(-hw, 0), new THREE.Vector2(hw, 0), new THREE.Vector2(ridgeX, rise)];
      const m = prism(tri, h, color);
      place(m, bodyTop);
      break;
    }
    case 'cross_gable': {
      const triA = [new THREE.Vector2(-hw, 0), new THREE.Vector2(hw, 0), new THREE.Vector2(0, rise)];
      place(prism(triA, h, color), bodyTop);
      const triB = [new THREE.Vector2(-hh, 0), new THREE.Vector2(hh, 0), new THREE.Vector2(0, rise)];
      const mB = prism(triB, w, color); mB.rotation.y = Math.PI / 2;
      place(mB, bodyTop);
      break;
    }
    case 'gambrel': {
      // two-pitch barn profile (steep lower, shallow upper)
      const prof = [
        new THREE.Vector2(-hw, 0), new THREE.Vector2(hw, 0),
        new THREE.Vector2(hw * 0.6, rise * 0.6), new THREE.Vector2(0, rise),
        new THREE.Vector2(-hw * 0.6, rise * 0.6),
      ];
      place(prism(prof, h, color), bodyTop);
      break;
    }
    case 'jerkinhead':
    case 'hip': {
      const m = pyramid(w, h, rise, color);
      place(m, bodyTop + rise / 2);
      break;
    }
    case 'pyramidal':
    case 'tented':
    case 'spire': {
      const m = pyramid(w, h, rise, color);
      place(m, bodyTop + rise / 2);
      break;
    }
    case 'mansard': {
      // steep lower frustum + shallow cap
      const lower = pyramid(w, h, rise * 0.7, color); place(lower, bodyTop + rise * 0.35);
      const cap = pyramid(w * 0.5, h * 0.5, rise * 0.3, color); place(cap, bodyTop + rise * 0.85);
      break;
    }
    case 'conical': {
      const m = new THREE.Mesh(new THREE.ConeGeometry(Math.min(hw, hh), rise, 24), mat(color));
      place(m, bodyTop + rise / 2);
      break;
    }
    case 'domed': {
      const r = Math.min(hw, hh);
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(color));
      place(m, bodyTop);
      break;
    }
    case 'onion': {
      // bulbous lathe profile (eastern dome)
      const r = Math.min(hw, hh);
      const pts = [
        new THREE.Vector2(0.0 * r, 0), new THREE.Vector2(0.9 * r, 0.15 * rise),
        new THREE.Vector2(1.1 * r, 0.45 * rise), new THREE.Vector2(0.5 * r, 0.75 * rise),
        new THREE.Vector2(0.12 * r, 0.92 * rise), new THREE.Vector2(0.0, rise),
      ];
      const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), mat(color));
      place(m, bodyTop);
      break;
    }
    case 'lean_to': {
      // single slope capping the full footprint: high at the back (−z), low at the
      // front (+z). Profile spans the depth (−hh..hh) in local x; extruded along the
      // width and rotated so local x → world z. (verified: 2×2 → x,z ∈ [−1,1].)
      const prof = [
        new THREE.Vector2(-hh, 0),    // back, bottom
        new THREE.Vector2(hh, 0),     // front, bottom
        new THREE.Vector2(-hh, rise), // back, top
      ];
      const m = prism(prof, w, color); m.rotation.y = Math.PI / 2;
      place(m, bodyTop);
      break;
    }
    case 'flat':
    case 'stepped':
    default: {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, Math.max(0.06, rise), h), mat(color));
      place(m, bodyTop + rise / 2);
      break;
    }
  }
  return g;
}

function buildVents(m: Massing, bodyTop: number): THREE.Object3D {
  const g = new THREE.Group();
  for (const v of m.vents) {
    // tile-relative (x,y) → centered world XZ (origin at footprint center)
    const wx = v.x + 0.5 - m.footprint.w / 2;
    const wz = v.y + 0.5 - m.footprint.h / 2;
    const top = bodyTop + Math.max(0.1, v.height);
    if (v.kind === 'smokehole') {
      const disk = new THREE.Mesh(new THREE.CircleGeometry(0.18, 16), mat(0x222222));
      disk.rotation.x = -Math.PI / 2; disk.position.set(wx, bodyTop + 0.02, wz);
      g.add(disk);
    } else {
      const wdt = v.kind === 'pipe' ? 0.12 : 0.28;
      const stack = new THREE.Mesh(new THREE.BoxGeometry(wdt, top - bodyTop, wdt), mat(hexToInt(m.trim)));
      stack.position.set(wx, (bodyTop + top) / 2, wz);
      g.add(stack);
    }
  }
  return g;
}

function tileGround(w: number, h: number): THREE.Object3D {
  const g = new THREE.Group();
  const lineMat = new THREE.LineBasicMaterial({ color: GRID_COLOR, transparent: true, opacity: 0.5 });
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= w; i++) { pts.push(new THREE.Vector3(i - w / 2, 0, -h / 2), new THREE.Vector3(i - w / 2, 0, h / 2)); }
  for (let j = 0; j <= h; j++) { pts.push(new THREE.Vector3(-w / 2, 0, j - h / 2), new THREE.Vector3(w / 2, 0, j - h / 2)); }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  g.add(new THREE.LineSegments(geo, lineMat));
  return g;
}

export function buildMassingScene(d: BuildingDescriptor): MassingScene {
  const m = buildingMassing(d);
  const scene = new THREE.Scene();
  const w = m.footprint.w, h = m.footprint.h;
  const wallColor = hexToInt(m.walls);
  const roofColor = hexToInt(m.roofColor);

  // Body: stacked levels (insets for 'stepped'), or a round drum for 'round' plans.
  const group = new THREE.Group();
  let bodyTop = 0;
  if (m.plan === 'round') {
    const r = Math.min(w, h) / 2;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(r, r, m.bodyHeight, 24), mat(wallColor));
    drum.position.y = m.bodyHeight / 2;
    group.add(drum);
    bodyTop = m.bodyHeight;
  } else {
    const levelH = m.bodyHeight / m.levels;
    for (let lvl = 0; lvl < m.levels; lvl++) {
      const inset = m.levelInset * lvl;
      const lw = Math.max(0.4, w - inset * 2), lh = Math.max(0.4, h - inset * 2);
      const box = new THREE.Mesh(new THREE.BoxGeometry(lw, levelH, lh), mat(wallColor));
      box.position.y = lvl * levelH + levelH / 2;
      group.add(box);
    }
    bodyTop = m.bodyHeight;
  }

  // A 'none' roof (roofMat 'none' → #00000000) draws no roof mesh.
  if (!isTransparent(m.roofColor)) group.add(buildRoof(m.roof, w, h, m.roofHeight, bodyTop, roofColor));
  group.add(buildVents(m, bodyTop));

  // Door marker, snapped to whichever footprint edge the door cell sits on (any of
  // the 4 sides — not just the z-facing wall).
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.4), mat(DOOR_COLOR));
  const dxc = m.door.x + 0.5 - w / 2, dzc = m.door.y + 0.5 - h / 2;
  const dLeft = m.door.x, dRight = (w - 1) - m.door.x, dTop = m.door.y, dBottom = (h - 1) - m.door.y;
  const minEdge = Math.min(dLeft, dRight, dTop, dBottom);
  let px = dxc, pz = dzc;
  if (minEdge === dLeft) px = -w / 2;
  else if (minEdge === dRight) px = w / 2;
  else if (minEdge === dTop) pz = -h / 2;
  else pz = h / 2;
  door.position.set(px, 0.3, pz);
  group.add(door);

  scene.add(group);
  scene.add(tileGround(w, h));

  // Upper-left key light (SUN_DIRECTION = 'top-left') + ambient fill.
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-4, 6, 3); // negative x (left), positive y (up) — asserted in tests
  scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  void SUN_DIRECTION; // single source of truth; light vector encodes 'top-left'

  // 2:1 dimetric orthographic camera framing the whole group.
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const elev = Math.atan(0.5), azim = Math.PI / 4;
  const dist = Math.max(size.x, size.y, size.z) * 3 + 5;
  const dir = new THREE.Vector3(
    Math.cos(elev) * Math.cos(azim), Math.sin(elev), Math.cos(elev) * Math.sin(azim),
  );
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, dist * 4);
  camera.position.copy(center).add(dir.multiplyScalar(dist));
  camera.up.set(0, 1, 0);
  camera.lookAt(center);
  return { scene, camera };
}
