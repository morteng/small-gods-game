/**
 * CameraDirector — the cinematic camera (design doc §4, slice P-C). When a
 * staged beat fires on a subject, it eases the camera to frame that subject
 * (a gentle one-rung push-in), holds, then releases control back to the normal
 * follow/free camera. It is PRESENTATION: a pure tween over the Camera struct,
 * off the sim path, and any user input cancels it instantly (player agency
 * always wins — design doc §6).
 *
 * The end zoom snaps to a pixel-perfect iso rung so the held frame stays crisp
 * (user pref: pixel-perfect over fractional scaling); only the brief move is
 * fractional.
 */
import type { Camera, GameMap } from '@/core/types';
import { focusCameraOnTile } from '@/render/focus-camera';
import { quantizeIsoZoom } from '@/render/iso/iso-camera';

interface CamState { x: number; y: number; zoom: number }
interface Viewport { width: number; height: number }

export interface CinematicOptions {
  /** Tween-in duration, ms. Default 900. */
  moveMs?: number;
  /** Dwell at the framed subject, ms. Default 1400. */
  holdMs?: number;
  /** Step this many pixel-perfect rungs closer (toward 1:1). Default 1; 0 = pan only. */
  zoomIn?: number;
  /** The live map — passed through so framing accounts for terrain lift (hilltops
   *  frame at their raised screen position, not their sea-level shadow). */
  map?: GameMap | null;
}

function smoothstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class CameraDirector {
  private active = false;
  private phase: 'move' | 'hold' = 'move';
  private elapsed = 0;
  private moveMs = 900;
  private holdMs = 1400;
  private from: CamState = { x: 0, y: 0, zoom: 1 };
  private to: CamState = { x: 0, y: 0, zoom: 1 };

  isActive(): boolean { return this.active; }

  /** Begin a cinematic framing of a tile. Captures the start + target camera. */
  focusTile(camera: Camera, tileX: number, tileY: number, vp: Viewport, opts: CinematicOptions = {}): void {
    this.moveMs = Math.max(1, opts.moveMs ?? 900);
    this.holdMs = Math.max(0, opts.holdMs ?? 1400);
    const rungs = opts.zoomIn ?? 1;

    // Target zoom: step `rungs` rungs toward 1:1, snapped to the iso ladder.
    let targetZoom = camera.zoom;
    for (let i = 0; i < rungs; i++) targetZoom = quantizeIsoZoom(targetZoom, 1);

    // Compute the target x/y by framing the tile at the target zoom on a clone.
    const clone: Camera = { ...camera, zoom: targetZoom };
    focusCameraOnTile(clone, tileX, tileY, vp.width, vp.height, opts.map);

    this.from = { x: camera.x, y: camera.y, zoom: camera.zoom };
    this.to = { x: clone.x, y: clone.y, zoom: clone.zoom };
    this.elapsed = 0;
    this.phase = 'move';
    this.active = true;
  }

  /** Advance the tween and write into `camera`. Call once per frame while active. */
  update(dtMs: number, camera: Camera): void {
    if (!this.active) return;
    this.elapsed += dtMs;

    if (this.phase === 'move') {
      const e = smoothstep(this.elapsed / this.moveMs);
      camera.x = lerp(this.from.x, this.to.x, e);
      camera.y = lerp(this.from.y, this.to.y, e);
      camera.zoom = lerp(this.from.zoom, this.to.zoom, e);
      if (this.elapsed >= this.moveMs) {
        camera.x = this.to.x; camera.y = this.to.y; camera.zoom = this.to.zoom;
        this.phase = 'hold';
        this.elapsed = 0;
      }
    } else if (this.elapsed >= this.holdMs) {
      this.active = false; // release; normal follow/free camera resumes
    }
  }

  /** Stop immediately, leaving the camera where it is (user took control). */
  cancel(): void {
    this.active = false;
  }
}
