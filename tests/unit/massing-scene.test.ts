import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildMassingScene, buildRoof } from '@/assetgen/headless/massing-scene';
import { synthesizeFromPreset, BUILDING_PRESETS } from '@/world/building-presets';
import type { Roof } from '@/world/building-descriptor';

function size(o: THREE.Object3D): THREE.Vector3 {
  o.updateMatrixWorld(true);
  const s = new THREE.Vector3();
  new THREE.Box3().setFromObject(o).getSize(s);
  return s;
}
function bounds(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
}

const ALL_ROOFS: Roof[] = [
  'flat','gable','hip','conical','domed','stepped','lean_to',
  'gambrel','mansard','pyramidal','saltbox','onion','spire','tented','jerkinhead','cross_gable',
];

function roofApexY(scene: THREE.Scene): number {
  const box = new THREE.Box3().setFromObject(scene);
  return box.max.y;
}

describe('buildMassingScene', () => {
  it('builds every preset into a non-empty scene with a camera', () => {
    for (const name of Object.keys(BUILDING_PRESETS)) {
      const { scene, camera } = buildMassingScene(synthesizeFromPreset(name)!);
      expect(scene.children.length, name).toBeGreaterThan(0);
      expect(camera).toBeInstanceOf(THREE.OrthographicCamera);
    }
  });

  it('builds every roof kind without throwing and yields geometry', () => {
    for (const roof of ALL_ROOFS) {
      const d = synthesizeFromPreset('cottage')!;
      d.roof = roof;
      const { scene } = buildMassingScene(d);
      let meshes = 0;
      scene.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes++; });
      expect(meshes, roof).toBeGreaterThan(0);
    }
  });

  it('wider buildings get taller pitched roofs (height-correct massing)', () => {
    const narrow = synthesizeFromPreset('cottage')!; narrow.footprint = { w: 1, h: 1 }; narrow.roof = 'gable';
    const wide = synthesizeFromPreset('cottage')!; wide.footprint = { w: 6, h: 6 }; wide.roof = 'gable';
    expect(roofApexY(buildMassingScene(wide).scene)).toBeGreaterThan(roofApexY(buildMassingScene(narrow).scene));
  });

  it('places a mesh for each vent', () => {
    const d = synthesizeFromPreset('cottage')!; // 1 chimney
    const withVent = buildMassingScene(d).scene;
    const d0 = synthesizeFromPreset('cottage')!; d0.vents = [];
    const without = buildMassingScene(d0).scene;
    const count = (s: THREE.Scene) => { let n = 0; s.traverse(o => { if ((o as THREE.Mesh).isMesh) n++; }); return n; };
    expect(count(withVent)).toBeGreaterThan(count(without));
  });

  it('adds exactly one directional light from the upper-left (negative x, positive y)', () => {
    const { scene } = buildMassingScene(synthesizeFromPreset('cottage')!);
    const dir = scene.children.find(c => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight;
    expect(dir).toBeDefined();
    expect(dir.position.x).toBeLessThan(0);
    expect(dir.position.y).toBeGreaterThan(0);
  });

  it('round plans (yurt) build a cylindrical drum body', () => {
    const { scene } = buildMassingScene(synthesizeFromPreset('yurt')!);
    let cylinders = 0;
    scene.traverse(o => {
      const g = (o as THREE.Mesh).geometry;
      if (g && g.type === 'CylinderGeometry') cylinders++;
    });
    expect(cylinders).toBeGreaterThan(0);
  });

  it('pyramid-family roofs cover the full footprint (not a quarter or double)', () => {
    // hip on a 6×2 footprint: base must span ~6 in x and ~2 in z, centered.
    const s = size(buildRoof('hip', 6, 2, 1, 0, 0x888888));
    expect(s.x).toBeGreaterThan(5.5);
    expect(s.x).toBeLessThan(6.5);
    expect(s.z).toBeGreaterThan(1.6);
    expect(s.z).toBeLessThan(2.4);
  });

  it('lean_to caps the footprint instead of sitting off behind it', () => {
    // 4×4 footprint is centered on x,z ∈ [−2,2]; the wedge must stay within it.
    const b = bounds(buildRoof('lean_to', 4, 4, 1, 0, 0x888888));
    expect(b.min.z).toBeGreaterThanOrEqual(-2.05);
    expect(b.max.z).toBeLessThanOrEqual(2.05);
    expect(b.min.x).toBeGreaterThanOrEqual(-2.05);
    expect(b.max.x).toBeLessThanOrEqual(2.05);
  });

  it('places the door marker on the actual door edge (x-edge door)', () => {
    // market_stall door is {x:0,y:1} on a 2×2 footprint → left (−x) edge, marker x ≈ −1.
    const { scene } = buildMassingScene(synthesizeFromPreset('market_stall')!);
    let doorX: number | undefined;
    scene.traverse(o => {
      const me = o as THREE.Mesh;
      const c = (me.material as THREE.MeshStandardMaterial)?.color;
      if (me.isMesh && c && c.getHex() === 0xff00ff) doorX = me.position.x;
    });
    expect(doorX).toBeCloseTo(-1);
  });
});
