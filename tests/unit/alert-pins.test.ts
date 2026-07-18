import { describe, it, expect } from 'vitest';
import { projectAlertPins, projectPinCentre, MAX_ALERT_PINS } from '@/game/affordance/alert-pins';
import { createCamera } from '@/render/camera';
import { worldToScreen } from '@/render/iso/iso-projection';
import { isoStageTransform } from '@/render/iso/entity-draw-list';
import type { InboxItem } from '@/game/game-query';

function item(id: string, salience: number, anchor?: { x: number; y: number }, surfaced = false): InboxItem {
  return {
    id, kind: 'prayer', title: id, detail: '', salience, surfaced,
    target: { kind: 'npc', npcId: id },
    ...(anchor ? { anchor } : {}),
  };
}

describe('projectAlertPins — P5 top-N pin projection', () => {
  it('projects anchored items through the ISO projection (camera pans in iso-screen space)', () => {
    const cam = createCamera();
    cam.x = 100; cam.y = 50; cam.zoom = 1 / 3; // a fractional rung — rounding must bite
    const dpr = 2;
    const pins = projectAlertPins([item('a', 1, { x: 7, y: 3 })], cam, dpr);
    expect(pins).toHaveLength(1);
    const iso = worldToScreen(7.5, 3.5, 40, 0, 0); // 40 = PIN_HEAD_LIFT
    const t = isoStageTransform(cam);
    expect(pins[0].x).toBe(Math.round((iso.sx * t.scale + t.x) * dpr));
    expect(pins[0].y).toBe(Math.round((iso.sy * t.scale + t.y) * dpr));
    expect(Number.isInteger(pins[0].x)).toBe(true); // pixel-snapped
    expect(Number.isInteger(pins[0].y)).toBe(true);
  });

  it('keeps the inbox salience order and caps at the top N', () => {
    const items = Array.from({ length: 12 }, (_, i) => item(`p${i}`, 12 - i, { x: i, y: i }));
    const pins = projectAlertPins(items, createCamera(), 1);
    expect(pins).toHaveLength(MAX_ALERT_PINS);
    expect(pins.map((p) => p.id)).toEqual(items.slice(0, MAX_ALERT_PINS).map((it) => it.id));
  });

  it('skips anchorless items without consuming a top-N slot', () => {
    const items = [
      item('placeless-threat', 9),                  // no anchor (a rival has no place)
      item('anchored-lo', 1, { x: 2, y: 2 }),
    ];
    const pins = projectAlertPins(items, createCamera(), 1, 1);
    expect(pins.map((p) => p.id)).toEqual(['anchored-lo']);
  });

  it('carries kind + surfaced through to the pin view', () => {
    const pins = projectAlertPins([item('s', 5, { x: 1, y: 1 }, true)], createCamera(), 1);
    expect(pins[0].kind).toBe('prayer');
    expect(pins[0].surfaced).toBe(true);
  });

  it('tracks the camera exactly: panning the camera moves the pin by -pan × zoom (no swim)', () => {
    const cam = createCamera();
    cam.zoom = 0.25;
    const before = projectPinCentre({ x: 10, y: 10 }, cam, 1);
    cam.x += 64; cam.y += 32; // pan the camera in world px
    const after = projectPinCentre({ x: 10, y: 10 }, cam, 1);
    expect(after.x).toBe(before.x - Math.round(64 * cam.zoom));
    expect(after.y).toBe(before.y - Math.round(32 * cam.zoom));
  });
});
