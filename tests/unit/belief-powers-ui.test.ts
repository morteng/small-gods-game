import { describe, it, expect } from 'vitest';
import { UiRuntime } from '@/render/ui/ui-runtime';
import type { BeliefPowerView, InboxItem } from '@/game/game-query';

function power(over: Partial<BeliefPowerView> = {}): BeliefPowerView {
  return {
    domain: 'storm', label: 'Storm & Lightning', blurb: 'b', verb: 'smite',
    conviction: 0.2, threshold: 0.5, unlocked: false, reach: 1, believers: 3, ...over,
  };
}
function item(over: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'prayer:n1', kind: 'prayer', title: 'Pip is praying', detail: 'A farmer pleads.',
    salience: 1, surfaced: false, target: { kind: 'npc', npcId: 'n1' }, ...over,
  };
}

/** Click a hit region by id, then render two frames so hit regions reflect the new state. */
function clickHit(ui: UiRuntime, id: string, w = 1200, h = 800, dpr = 1): boolean {
  const hit = ui.hitRegions().find((r) => r.id === id);
  if (!hit) return false;
  const cx = hit.x + hit.w / 2, cy = hit.y + hit.h / 2;
  ui.pointerMove(cx, cy); ui.pointerDown(cx, cy); ui.pointerUp(cx, cy);
  ui.frame(w, h, dpr);
  ui.frame(w, h, dpr);
  return true;
}
const ids = (ui: UiRuntime) => ui.hitRegions().map((r) => r.id);

describe('skill panel (B-C)', () => {
  it('opens from the HUD and shows a locked power with no CAST affordance', () => {
    const ui = new UiRuntime();
    ui.configure({ getBeliefPowers: () => [power({ unlocked: false })], getInbox: () => [] });
    ui.frame(1200, 800, 1);
    expect(ids(ui)).toContain('ui.powers');

    expect(clickHit(ui, 'ui.powers')).toBe(true);
    // locked → no cast button
    expect(ids(ui)).not.toContain('power.cast.smite');
  });

  it('shows CAST for an unlocked power and casting calls the hook', () => {
    const ui = new UiRuntime();
    let cast: string | null = null;
    ui.configure({
      getBeliefPowers: () => [power({ unlocked: true, conviction: 0.7 })],
      getInbox: () => [],
      onCastPower: (verb) => { cast = verb; },
    });
    ui.frame(1200, 800, 1);
    clickHit(ui, 'ui.powers');
    expect(ids(ui)).toContain('power.cast.smite');
    clickHit(ui, 'power.cast.smite');
    expect(cast).toBe('smite');
  });
});

describe('divine inbox (B-D)', () => {
  it('opens from the HUD and offers triage verbs per item', () => {
    const ui = new UiRuntime();
    ui.configure({ getBeliefPowers: () => [], getInbox: () => [item()] });
    ui.frame(1200, 800, 1);
    expect(ids(ui)).toContain('ui.inbox');

    clickHit(ui, 'ui.inbox');
    expect(ids(ui)).toEqual(expect.arrayContaining(['inbox.act.prayer:n1', 'inbox.look.prayer:n1', 'inbox.ignore.prayer:n1']));
  });

  it('ACT routes to the hook; IGNORE removes the item from view', () => {
    const ui = new UiRuntime();
    let acted: InboxItem | null = null;
    const items: InboxItem[] = [item({ id: 'prayer:a' }), item({ id: 'prayer:b', title: 'Other' })];
    ui.configure({ getBeliefPowers: () => [], getInbox: () => items, onInboxAct: (it) => { acted = it; } });
    ui.frame(1200, 800, 1);
    clickHit(ui, 'ui.inbox');

    clickHit(ui, 'inbox.act.prayer:a');
    expect(acted).not.toBeNull();
    expect(acted!.id).toBe('prayer:a');

    // ignore the second → its rows vanish next frame
    clickHit(ui, 'inbox.ignore.prayer:b');
    expect(ids(ui)).not.toContain('inbox.act.prayer:b');
    expect(ids(ui)).toContain('inbox.act.prayer:a');
  });

  it('an opportunity (settlement target) still shows ACT', () => {
    const ui = new UiRuntime();
    ui.configure({
      getBeliefPowers: () => [],
      getInbox: () => [item({ id: 'opp:vale', kind: 'opportunity', target: { kind: 'settlement', poiId: 'vale' } })],
    });
    ui.frame(1200, 800, 1);
    clickHit(ui, 'ui.inbox');
    expect(ids(ui)).toContain('inbox.act.opp:vale');
  });
});
