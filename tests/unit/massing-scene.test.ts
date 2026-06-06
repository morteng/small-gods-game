import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildMassingScene } from '@/assetgen/headless/massing-scene';
import { synthesizeFromPreset, BUILDING_PRESETS } from '@/world/building-presets';
import type { Roof } from '@/world/building-descriptor';

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
});
