// src/assetgen/headless/render-page-entry.ts
/**
 * Browser-side render harness, bundled by esbuild and injected into a headless
 * Chrome page by massing-renderer.ts. Exposes window.renderMassing(descriptor,w,h)
 * → { color, depth } PNG data URLs. Runs real three.js WebGL — NEVER imported by
 * Node or game code (it touches window/document).
 */
import * as THREE from 'three';
import { buildMassingScene } from './massing-scene';
import type { BuildingDescriptor } from '@/world/building-descriptor';

/** Tighten the ortho frustum around the scene for the given canvas aspect (w/h). */
function frameCamera(camera: THREE.OrthographicCamera, scene: THREE.Scene, aspect: number): void {
  camera.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];
  let maxX = 0, maxY = 0;
  for (const c of corners) {
    c.applyMatrix4(camera.matrixWorldInverse); // into camera space
    maxX = Math.max(maxX, Math.abs(c.x));
    maxY = Math.max(maxY, Math.abs(c.y));
  }
  let halfW = maxX * 1.08, halfH = maxY * 1.08; // 8% margin
  if (halfW / halfH < aspect) halfW = halfH * aspect; else halfH = halfW / aspect;
  camera.left = -halfW; camera.right = halfW; camera.top = halfH; camera.bottom = -halfH;
  camera.near = 0.01; camera.far = 5000;
  camera.updateProjectionMatrix();
}

declare global {
  interface Window {
    renderMassing: (d: BuildingDescriptor, w: number, h: number) => { color: string; depth: string };
  }
}

window.renderMassing = (d, w, h) => {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  canvas.width = w; canvas.height = h;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(w, h, false);

  const { scene, camera } = buildMassingScene(d);
  frameCamera(camera as THREE.OrthographicCamera, scene, w / h);

  // Color pass — transparent background.
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, camera);
  const color = canvas.toDataURL('image/png');

  // Depth pass — grayscale depth of the solid massing, for a future ControlNet
  // provider (PixelLab does not consume it today). Swap meshes to depth material,
  // drop lights, and hide the tile grid (its LineSegments would streak the field).
  // NOTE: this mutates `scene` in place; fine because it is freshly built per call.
  scene.traverse(o => {
    const me = o as THREE.Mesh;
    if (me.isMesh) me.material = new THREE.MeshDepthMaterial();
    else if ((o as THREE.LineSegments).isLineSegments) o.visible = false;
  });
  scene.children = scene.children.filter(c => !(c as THREE.Light).isLight);
  renderer.setClearColor(0xffffff, 1);
  renderer.render(scene, camera);
  const depth = canvas.toDataURL('image/png');

  renderer.dispose();
  return { color, depth };
};
