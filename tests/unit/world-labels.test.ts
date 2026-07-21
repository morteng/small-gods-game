import { describe, it, expect } from 'vitest';
import {
  buildWorldLabels, MAX_WORLD_LABELS, type SettlementContest,
} from '@/game/affordance/world-labels';
import { projectWorldAnchor } from '@/game/affordance/alert-pins';
import { createCamera } from '@/render/camera';
import type { POI } from '@/core/types';
import type { InboxItem } from '@/game/game-query';

const VIEWPORT = { w: 1280, h: 720 };

function poi(id: string, opts: Partial<POI> = {}): POI {
  return { id, type: 'village', name: opts.name ?? id, position: { x: 10, y: 10 }, ...opts };
}

function inboxItem(id: string, poiId: string | null, salience = 1): InboxItem {
  return {
    id, kind: 'prayer', title: id, detail: '', salience, surfaced: false,
    target: poiId ? { kind: 'settlement', poiId } : { kind: 'none' },
  };
}

describe('buildWorldLabels — pure projection', () => {
  it('projects a settlement POI through the shared world-anchor projection', () => {
    const cam = createCamera();
    cam.x = 40; cam.y = 20; cam.zoom = 1 / 3;
    const dpr = 2;
    const labels = buildWorldLabels([poi('vale')], [], [], null, cam, dpr, VIEWPORT);
    expect(labels).toHaveLength(1);
    const expected = projectWorldAnchor({ x: 10, y: 10 }, 32, cam, dpr);
    expect(labels[0]).toMatchObject({ poiId: 'vale', name: 'vale', x: expected.x, y: expected.y });
    expect(Number.isInteger(labels[0].x)).toBe(true); // pixel-snapped
    expect(Number.isInteger(labels[0].y)).toBe(true);
  });

  it('falls back to the poiId when the POI has no name', () => {
    const labels = buildWorldLabels(
      [poi('unnamed', { name: undefined })], [], [], null, createCamera(), 1, VIEWPORT,
    );
    expect(labels[0].name).toBe('unnamed');
  });

  it('skips non-settlement POI types (rivers, lakes, landmarks)', () => {
    const pois = [poi('vale'), poi('lake1', { type: 'lake' }), poi('arch1', { type: 'sea_stacks' })];
    const labels = buildWorldLabels(pois, [], [], null, createCamera(), 1, VIEWPORT);
    expect(labels.map((l) => l.poiId)).toEqual(['vale']);
  });

  it('skips positionless POIs', () => {
    const pois = [poi('vale'), poi('ghost', { position: undefined })];
    const labels = buildWorldLabels(pois, [], [], null, createCamera(), 1, VIEWPORT);
    expect(labels.map((l) => l.poiId)).toEqual(['vale']);
  });

  it('is deterministic regardless of input POI order', () => {
    const a = [poi('vale'), poi('crossing'), poi('port')];
    const b = [poi('port'), poi('vale'), poi('crossing')];
    const cam = createCamera();
    const la = buildWorldLabels(a, [], [], null, cam, 1, VIEWPORT).map((l) => l.poiId);
    const lb = buildWorldLabels(b, [], [], null, cam, 1, VIEWPORT).map((l) => l.poiId);
    expect(la).toEqual(lb);
    expect(la).toEqual(['crossing', 'port', 'vale']); // sorted by poiId
  });
});

describe('buildWorldLabels — badge (divine-inbox count)', () => {
  it('counts settlement-target inbox items anchored to this POI', () => {
    const inbox = [inboxItem('a', 'vale'), inboxItem('b', 'vale'), inboxItem('c', 'crossing')];
    const labels = buildWorldLabels([poi('vale'), poi('crossing')], inbox, [], null, createCamera(), 1, VIEWPORT);
    expect(labels.find((l) => l.poiId === 'vale')!.badge).toBe(2);
    expect(labels.find((l) => l.poiId === 'crossing')!.badge).toBe(1);
  });

  it('ignores npc-target and placeless inbox items for the badge', () => {
    const inbox: InboxItem[] = [
      { id: 'n1', kind: 'prayer', title: '', detail: '', salience: 1, surfaced: false, target: { kind: 'npc', npcId: 'n1' } },
      { id: 'x1', kind: 'threat', title: '', detail: '', salience: 1, surfaced: false, target: { kind: 'none' } },
    ];
    const labels = buildWorldLabels([poi('vale')], inbox, [], null, createCamera(), 1, VIEWPORT);
    expect(labels[0].badge).toBe(0);
  });

  it('badge is 0 with no matching inbox items', () => {
    const labels = buildWorldLabels([poi('vale')], [], [], null, createCamera(), 1, VIEWPORT);
    expect(labels[0].badge).toBe(0);
  });
});

describe('buildWorldLabels — focus', () => {
  it('flags the focused settlement true, others false', () => {
    const labels = buildWorldLabels(
      [poi('vale'), poi('crossing')], [], [], 'crossing', createCamera(), 1, VIEWPORT,
    );
    expect(labels.find((l) => l.poiId === 'vale')!.focused).toBe(false);
    expect(labels.find((l) => l.poiId === 'crossing')!.focused).toBe(true);
  });

  it('nothing is focused when focusedPoiId is null', () => {
    const labels = buildWorldLabels([poi('vale')], [], [], null, createCamera(), 1, VIEWPORT);
    expect(labels[0].focused).toBe(false);
  });
});

describe('buildWorldLabels — contestedBy', () => {
  const contestFor = (rec: SettlementContest): SettlementContest[] => [rec];

  it('names the leading rival when its count is at least the player\'s', () => {
    const contest = contestFor({ poiId: 'vale', player: 3, rivals: [{ name: 'Om', count: 5 }] });
    const labels = buildWorldLabels([poi('vale')], [], contest, null, createCamera(), 1, VIEWPORT);
    expect(labels[0].contestedBy).toBe('Om');
  });

  it('is null when the player leads', () => {
    const contest = contestFor({ poiId: 'vale', player: 10, rivals: [{ name: 'Om', count: 5 }] });
    const labels = buildWorldLabels([poi('vale')], [], contest, null, createCamera(), 1, VIEWPORT);
    expect(labels[0].contestedBy).toBeNull();
  });

  it('a tied rival still counts as contested (>= player)', () => {
    const contest = contestFor({ poiId: 'vale', player: 5, rivals: [{ name: 'Om', count: 5 }] });
    const labels = buildWorldLabels([poi('vale')], [], contest, null, createCamera(), 1, VIEWPORT);
    expect(labels[0].contestedBy).toBe('Om');
  });

  it('picks the highest-count rival, ties broken alphabetically', () => {
    const contest = contestFor({
      poiId: 'vale', player: 0,
      rivals: [{ name: 'Zeus', count: 4 }, { name: 'Anubis', count: 4 }, { name: 'Om', count: 2 }],
    });
    const labels = buildWorldLabels([poi('vale')], [], contest, null, createCamera(), 1, VIEWPORT);
    expect(labels[0].contestedBy).toBe('Anubis');
  });

  it('is null with no rivals present', () => {
    const contest = contestFor({ poiId: 'vale', player: 5, rivals: [] });
    const labels = buildWorldLabels([poi('vale')], [], contest, null, createCamera(), 1, VIEWPORT);
    expect(labels[0].contestedBy).toBeNull();
  });

  it('is null with no contest entry for this settlement at all', () => {
    const labels = buildWorldLabels([poi('vale')], [], [], null, createCamera(), 1, VIEWPORT);
    expect(labels[0].contestedBy).toBeNull();
  });
});

describe('buildWorldLabels — cap + cull', () => {
  it('caps at MAX_WORLD_LABELS by default', () => {
    const pois = Array.from({ length: 24 }, (_, i) => poi(`s${i}`.padStart(3, '0')));
    const labels = buildWorldLabels(pois, [], [], null, createCamera(), 1, VIEWPORT);
    expect(labels).toHaveLength(MAX_WORLD_LABELS);
  });

  it('respects a custom max', () => {
    const pois = Array.from({ length: 5 }, (_, i) => poi(`s${i}`));
    const labels = buildWorldLabels(pois, [], [], null, createCamera(), 1, VIEWPORT, 2);
    expect(labels).toHaveLength(2);
  });

  it('culls a settlement projected far outside the viewport, keeps one on-screen', () => {
    const cam = createCamera(); // zoom 1, no pan
    const pois = [poi('onscreen', { position: { x: 5, y: 5 } }), poi('offscreen', { position: { x: 5000, y: 5000 } })];
    const labels = buildWorldLabels(pois, [], [], null, cam, 1, VIEWPORT);
    expect(labels.map((l) => l.poiId)).toEqual(['onscreen']);
  });

  it('keeps a point just past the viewport edge (within the ~40px cull margin), drops one well beyond it', () => {
    const cam = createCamera();
    const p = poi('edge', { position: { x: 5, y: 5 } });
    const at = projectWorldAnchor(p.position!, 32, cam, 1); // baseline projected x at cam.x = 0
    // Pan the camera so the projected x sits 10px past the right edge — inside margin.
    const near = buildWorldLabels(
      [p], [], [], null, { ...cam, x: cam.x + (at.x - (VIEWPORT.w + 10)) }, 1, VIEWPORT,
    );
    expect(near.map((l) => l.poiId)).toEqual(['edge']);
    // Pan it 500px past the edge — well beyond any reasonable cull margin.
    const far = buildWorldLabels(
      [p], [], [], null, { ...cam, x: cam.x + (at.x - (VIEWPORT.w + 500)) }, 1, VIEWPORT,
    );
    expect(far).toHaveLength(0);
  });
});
