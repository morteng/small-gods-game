/**
 * Abilities v1 — Phase A (A2): the cast reticle's pure geometry helper.
 *
 * `projectCastReticle` is unit-tested with no canvas at all — it's the same
 * `worldToScreen` + `isoStageTransform` idiom `alert-pins.test.ts` pins for the
 * WebGPU pin layer, so this file mirrors that test's shape: a known tile +
 * camera projects to an exact CSS-px centre, the radius tracks the QUANTIZED
 * zoom rung (not the raw, possibly mid-tween `camera.zoom`), and a lifted tile
 * (a synthetic `IsoEnv`) projects higher (smaller screen-y) than a flat one.
 */
import { describe, it, expect } from 'vitest';
import { projectCastReticle, projectCastAreaDisc } from '@/render/cast-reticle';
import { createCamera } from '@/render/camera';
import { worldToScreen } from '@/render/iso/iso-projection';
import { isoStageTransform } from '@/render/iso/entity-draw-list';
import { quantizeIsoZoom } from '@/render/iso/iso-camera';
import type { IsoEnv } from '@/render/iso/lifted-projection';

/** A flat env (no lift anywhere) — the reticle should land exactly like the
 *  no-env (`null`) case. */
function flatEnv(): IsoEnv {
  return { elevAt: () => 0, seaLevel: 0, k: 1, width: 64, height: 64 };
}

/** A synthetic env with a fixed lift at every point — stands in for a hilltop. */
function liftedEnv(lift: number): IsoEnv {
  return { elevAt: () => lift, seaLevel: 0, k: 1, width: 64, height: 64 };
}

describe('projectCastReticle — abilities-v1 A2 pure geometry', () => {
  it('projects a tile through the ISO projection (camera pans in iso-screen space), tile-centred (+0.5)', () => {
    const cam = createCamera();
    cam.x = 40; cam.y = 20; cam.zoom = 1 / 3; // a fractional rung — rounding must bite
    const geo = projectCastReticle({ x: 5, y: 8 }, cam, null);

    const iso = worldToScreen(5.5, 8.5, 0, 0, 0);
    const t = isoStageTransform(cam);
    expect(geo.cx).toBe(Math.round(iso.sx * t.scale + t.x));
    expect(geo.cy).toBe(Math.round(iso.sy * t.scale + t.y));
    expect(Number.isInteger(geo.cx)).toBe(true); // pixel-snapped
    expect(Number.isInteger(geo.cy)).toBe(true);
  });

  it('tracks the camera exactly: panning moves the centre by -pan × zoom (no swim)', () => {
    const cam = createCamera();
    cam.zoom = 0.25;
    const before = projectCastReticle({ x: 10, y: 10 }, cam, null);
    cam.x += 64; cam.y += 32;
    const after = projectCastReticle({ x: 10, y: 10 }, cam, null);
    expect(after.cx).toBe(before.cx - Math.round(64 * cam.zoom));
    expect(after.cy).toBe(before.cy - Math.round(32 * cam.zoom));
  });

  it('radius scales with the QUANTIZED zoom rung, not raw fractional (mid-tween) zoom', () => {
    const cam = createCamera();
    // A value strictly between two rungs (1/4=0.25 and 1/3=0.333) —
    // CameraDirector tweens through exactly this kind of value mid-flight.
    cam.zoom = 0.29;
    const rung = quantizeIsoZoom(cam.zoom, 0);
    expect(rung).not.toBeCloseTo(cam.zoom, 3); // confirm the fixture actually straddles a rung

    const geo = projectCastReticle({ x: 0, y: 0 }, cam, null);
    expect(Number.isInteger(geo.radius)).toBe(true); // pixel-snapped

    // An already-quantized camera sitting exactly on that rung reproduces the
    // SAME radius — i.e. the fractional camera's radius was built off the
    // rung, not off `cam.zoom` itself.
    const cam2 = createCamera();
    cam2.zoom = rung;
    const geo2 = projectCastReticle({ x: 0, y: 0 }, cam2, null);
    expect(geo.radius).toBe(geo2.radius);

    // Sanity: a genuinely different rung (near the zoom-out floor) gives a
    // visibly different (smaller) radius — the scaling isn't a no-op constant.
    const camOut = createCamera();
    camOut.zoom = 0.05;
    const geoOut = projectCastReticle({ x: 0, y: 0 }, camOut, null);
    expect(geoOut.radius).toBeLessThan(geo.radius);
  });

  it('a lifted (hilltop) tile projects HIGHER on screen (smaller sy) than a flat one, at zoom 1', () => {
    const cam = createCamera();
    cam.zoom = 1;
    const flat = projectCastReticle({ x: 3, y: 3 }, cam, flatEnv());
    const lifted = projectCastReticle({ x: 3, y: 3 }, cam, liftedEnv(50));
    expect(lifted.cy).toBeLessThan(flat.cy);
    expect(lifted.cx).toBe(flat.cx); // lift is a pure screen-y term — x axis untouched
  });

  it('no env (null) behaves exactly like a flat env (sea-level fallback)', () => {
    const cam = createCamera();
    const noEnv = projectCastReticle({ x: 7, y: 2 }, cam, null);
    const withFlatEnv = projectCastReticle({ x: 7, y: 2 }, cam, flatEnv());
    expect(noEnv).toEqual(withFlatEnv);
  });
});

describe('projectCastAreaDisc — abilities-v1 B4 pure geometry', () => {
  it('centres on the ANCHOR tile (+0.5), same projection idiom as the point reticle', () => {
    const cam = createCamera();
    cam.x = 12; cam.y = 4; cam.zoom = 1;
    const geo = projectCastAreaDisc({ x: 5, y: 8 }, 6, cam, null);
    const ptGeo = projectCastReticle({ x: 5, y: 8 }, cam, null);
    expect(geo.cx).toBe(ptGeo.cx);
    expect(geo.cy).toBe(ptGeo.cy);
  });

  it('the on-screen disc is an ELLIPSE with the vertical semi-axis exactly half the horizontal — never a circle', () => {
    const cam = createCamera();
    cam.zoom = 1;
    const geo = projectCastAreaDisc({ x: 0, y: 0 }, 6, cam, null);
    expect(geo.rx).toBeGreaterThan(0);
    expect(geo.ry).toBe(Math.round(geo.rx * 0.5));
  });

  it('radius grows linearly with the tile radius (double the tiles ⇒ double rx)', () => {
    const cam = createCamera();
    cam.zoom = 1;
    const r6 = projectCastAreaDisc({ x: 0, y: 0 }, 6, cam, null);
    const r12 = projectCastAreaDisc({ x: 0, y: 0 }, 12, cam, null);
    expect(r12.rx).toBeCloseTo(r6.rx * 2, 0);
  });

  it('radius scales with the QUANTIZED zoom rung, matching the point reticle at radius 1', () => {
    // At a 1-tile radius, the disc's horizontal semi-axis matches the POINT
    // reticle's own radius exactly — the deliberate reuse (same constant),
    // so a 1-tile-radius drag previews continuously with the point cast it
    // grew out of, not a visually unrelated size.
    const cam = createCamera();
    cam.zoom = 0.29; // a fractional, off-rung zoom (CameraDirector mid-tween)
    const disc = projectCastAreaDisc({ x: 3, y: 3 }, 1, cam, null);
    const pt = projectCastReticle({ x: 3, y: 3 }, cam, null);
    expect(disc.rx).toBe(pt.radius);
  });

  it('a lifted anchor projects HIGHER on screen (smaller cy), same as the point reticle', () => {
    const cam = createCamera();
    cam.zoom = 1;
    const flat = projectCastAreaDisc({ x: 3, y: 3 }, 6, cam, flatEnv());
    const lifted = projectCastAreaDisc({ x: 3, y: 3 }, 6, cam, liftedEnv(50));
    expect(lifted.cy).toBeLessThan(flat.cy);
    expect(lifted.cx).toBe(flat.cx);
  });
});
