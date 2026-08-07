import { describe, it, expect } from 'vitest';
import { UiContext, type UiInput } from '@/render/ui/ui-context';
import { UiPage, UiSpace, type UiDrawGroup } from '@/render/ui/ui-batcher';
import {
  drawSaveScreen, saveRows, type SaveScreenView, type SlotRow, type SaveAction,
} from '@/render/ui/shell/save-screen';
import { drawLoadScreen, loadRows, type LoadScreenView, type LoadAction } from '@/render/ui/shell/load-screen';
import { Shell } from '@/render/ui/shell/shell';
import type { SaveSlot } from '@/services/save-store';

const W = 1280, H = 720, S = 2;
const SLOTS: SaveSlot[] = ['autosave', 'slot1', 'slot2', 'slot3'];

function row(over: Partial<SlotRow> = {}): SlotRow {
  return {
    slot: 'slot1',
    name: 'A SMALL SHRINE',
    dateLabel: 'Y1 SPRING · 34/365 · 08:15',
    tierLine: 'BUD · BELIEF 2.4',
    playtimeLabel: '2H 15M',
    compat: 'ok',
    empty: false,
    thumbnail: null,
    staleReason: null,
    ...over,
  };
}

/** Four rows, one per canonical slot, each overridable independently. */
function fullView(over: Partial<Record<SaveSlot, Partial<SlotRow>>> = {}): SaveScreenView & LoadScreenView {
  return { rows: SLOTS.map((slot) => row({ slot, ...(over[slot] ?? {}) })) };
}

function emptyView(): SaveScreenView & LoadScreenView {
  return { rows: SLOTS.map((slot) => row({ slot, empty: true, name: '', dateLabel: '', tierLine: '', playtimeLabel: '' })) };
}

/** Screen-space bounding box of every SOLID-page vertex drawn.
 *
 *  Aggregating first and asserting ONCE matters: a full save screen emits tens of
 *  thousands of quads (the pixel font is one quad per lit pixel), and calling
 *  `expect()` per vertex pushed this file past vitest's 5 s per-test timeout on a
 *  loaded machine. Same rigor, ~4 orders of magnitude fewer assertions. */
function screenBounds(groups: UiDrawGroup[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const g of groups) {
    if (g.space !== UiSpace.Screen || g.page !== UiPage.Solid) continue;
    for (let i = 0; i < g.vertexCount * 8; i += 8) {
      const x = g.vertices[i], y = g.vertices[i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

function totalVerts(groups: UiDrawGroup[]): number {
  return groups.reduce((s, g) => s + g.vertexCount, 0);
}

// ── pure row logic ──────────────────────────────────────────────────────────

describe('save screen — row logic', () => {
  it('disables the AUTOSAVE row and states why', () => {
    const rows = saveRows(fullView());
    const auto = rows.find((r) => r.slot === 'autosave')!;
    expect(auto.enabled).toBe(false);
    expect(auto.reason).toMatch(/MANAGED AUTOMATICALLY/);
  });

  it('offers every OTHER slot as a valid save target, empty or occupied', () => {
    const rows = saveRows(emptyView());
    for (const slot of ['slot1', 'slot2', 'slot3'] as const) {
      const r = rows.find((rr) => rr.slot === slot)!;
      expect(r.enabled, `${slot} should be a valid empty save target`).toBe(true);
    }
    const occupied = saveRows(fullView());
    for (const slot of ['slot1', 'slot2', 'slot3'] as const) {
      expect(occupied.find((rr) => rr.slot === slot)!.enabled).toBe(true);
    }
  });

  it('a STALE slot can still be overwritten from the save screen', () => {
    const view = fullView({
      slot1: { compat: 'stale-world', staleReason: 'Saved under an older world (content 117; this build is 119)' },
    });
    expect(saveRows(view).find((r) => r.slot === 'slot1')!.enabled).toBe(true);
  });

  it('an occupied slot carries its real name+date through unchanged (an informed overwrite)', () => {
    const view = fullView({ slot1: { name: 'THE RIVER TOWN', dateLabel: 'Y2 AUTUMN · 200/365 · 18:00' } });
    const r = saveRows(view).find((rr) => rr.slot === 'slot1')!;
    expect(r.data.name).toBe('THE RIVER TOWN');
    expect(r.data.dateLabel).toBe('Y2 AUTUMN · 200/365 · 18:00');
  });

  it('only offers DELETE on a slot that actually holds something', () => {
    const rows = saveRows(emptyView());
    for (const r of rows) expect(r.deletable, `${r.slot} is empty`).toBe(false);
    const occupied = saveRows(fullView());
    for (const r of occupied) expect(r.deletable, `${r.slot} is occupied`).toBe(true);
  });
});

describe('load screen — row logic', () => {
  it('DISABLES an empty slot, but never a save screen row', () => {
    const view = emptyView();
    const load = loadRows(view).find((r) => r.slot === 'slot1')!;
    expect(load.enabled).toBe(false);
    // NO reason line: the tile itself already reads "EMPTY SLOT", so a caption
    // repeating it below was visible duplication in a live pass. `reason` is for
    // refusals that are NOT self-evident from the tile (a stale version).
    expect(load.reason).toBeNull();
    expect(load.deletable).toBe(false);
    const save = saveRows(view).find((r) => r.slot === 'slot1')!;
    expect(save.enabled).toBe(true);
  });

  it('DISABLES a stale slot and states the reason WITH the version numbers, offering Delete', () => {
    const view = fullView({
      slot1: { compat: 'stale-world', staleReason: 'Saved under an older world (content 117; this build is 119)' },
    });
    const stale = loadRows(view).find((r) => r.slot === 'slot1')!;
    expect(stale.enabled).toBe(false);
    expect(stale.reason).toContain('117');
    expect(stale.reason).toContain('119');
    expect(stale.deletable).toBe(true);
  });

  it('offers a healthy occupied slot as a load target', () => {
    const rows = loadRows(fullView());
    for (const slot of ['slot1', 'slot2', 'slot3'] as const) {
      expect(rows.find((r) => r.slot === slot)!.enabled).toBe(true);
    }
  });
});

// ── geometry ─────────────────────────────────────────────────────────────

function frameSave(v: SaveScreenView, w = W, h = H): { action: SaveAction | null; hits: readonly { id: string; x: number; y: number; w: number; h: number }[]; groups: UiDrawGroup[] } {
  const c = new UiContext();
  c.begin();
  const action = drawSaveScreen(c, w, h, S, v);
  const { hits } = c.end();
  return { action, hits, groups: c.batcher.flush() };
}

function frameLoad(v: LoadScreenView, w = W, h = H): { action: LoadAction | null; hits: readonly { id: string; x: number; y: number; w: number; h: number }[]; groups: UiDrawGroup[] } {
  const c = new UiContext();
  c.begin();
  const action = drawLoadScreen(c, w, h, S, v);
  const { hits } = c.end();
  return { action, hits, groups: c.batcher.flush() };
}

describe('slot tile — the thumbnail well', () => {
  it('an EMPTY slot and a save with NO PICTURE draw differently', () => {
    // A flat grey well read as a broken image in a live pass. A real save with no
    // thumbnail now gets a deliberate sigil placeholder; an empty slot gets bare
    // parchment. The two must be visually distinguishable, or "nothing here" and
    // "picture missing" look like the same failure.
    const emptyVerts = totalVerts(frameLoad(emptyView()).groups);
    const occupiedVerts = totalVerts(frameLoad(fullView()).groups);
    expect(occupiedVerts).not.toBe(emptyVerts);
  });

  it('the placeholder stays inside the tile at every viewport size', () => {
    // The well is derived from the tile height, which the degradation ladder
    // compresses — so the placeholder must not escape a squeezed tile.
    for (const [w, h] of [[1280, 720], [420, 640], [360, 300]] as const) {
      const b = screenBounds(frameLoad(fullView(), w, h).groups);
      expect(b.minX, `${w}x${h}`).toBeGreaterThanOrEqual(0);
      expect(b.maxX, `${w}x${h}`).toBeLessThanOrEqual(w);
      expect(b.minY, `${w}x${h}`).toBeGreaterThanOrEqual(0);
      expect(b.maxY, `${w}x${h}`).toBeLessThanOrEqual(h);
    }
  });
});

describe('save/load screens — geometry', () => {
  it('registers one hit region per slot body, one per DELETE affordance, and BACK', () => {
    const { hits } = frameSave(fullView());
    const ids = hits.map((h) => h.id).sort();
    const expected = [
      'save.autosave.body', 'save.autosave.delete',
      'save.slot1.body', 'save.slot1.delete',
      'save.slot2.body', 'save.slot2.delete',
      'save.slot3.body', 'save.slot3.delete',
      'save.back',
    ].sort();
    expect(ids).toEqual(expected);
  });

  it('an empty slot on the LOAD screen offers no DELETE affordance', () => {
    const { hits } = frameLoad(emptyView());
    const ids = hits.map((h) => h.id);
    expect(ids).not.toContain('load.slot1.delete');
    expect(ids).toContain('load.slot1.body');
    expect(ids).toContain('load.back');
  });

  it('rows never overlap vertically', () => {
    for (const [w, h] of [[1280, 720], [420, 640], [360, 300]] as const) {
      const { hits } = frameSave(fullView(), w, h);
      const bodies = hits.filter((hh) => hh.id.endsWith('.body')).sort((a, b) => a.y - b.y);
      for (let i = 1; i < bodies.length; i++) {
        expect(bodies[i].y, `overlap at ${w}x${h}`).toBeGreaterThanOrEqual(bodies[i - 1].y + bodies[i - 1].h);
      }
    }
  });

  it('draws nothing outside the target, at full size and cramped sizes', () => {
    for (const [w, h] of [[1280, 720], [420, 640], [360, 300]] as const) {
      const { hits, groups } = frameSave(fullView(), w, h);
      // every hit region's own body id count stays at 4 slots — rows are NEVER
      // dropped, only their detail degrades (the anti-softlock guarantee).
      expect(hits.filter((hh) => hh.id.endsWith('.body')), `${w}x${h}`).toHaveLength(4);
      for (const hit of hits) {
        expect(hit.x, `hit left edge ${w}x${h}`).toBeGreaterThanOrEqual(0);
        expect(hit.x + hit.w, `hit right edge ${w}x${h}`).toBeLessThanOrEqual(w);
        expect(hit.y, `hit top edge ${w}x${h}`).toBeGreaterThanOrEqual(0);
        expect(hit.y + hit.h, `hit bottom edge ${w}x${h}`).toBeLessThanOrEqual(h);
      }
      const b = screenBounds(groups);
      expect(b.minX, `x underflow ${w}x${h}`).toBeGreaterThanOrEqual(0);
      expect(b.maxX, `x overflow ${w}x${h}`).toBeLessThanOrEqual(w);
      expect(b.minY, `y underflow ${w}x${h}`).toBeGreaterThanOrEqual(0);
      expect(b.maxY, `y overflow ${w}x${h}`).toBeLessThanOrEqual(h);
    }
  });

  it('paints something (the screen is not blank)', () => {
    expect(totalVerts(frameSave(fullView()).groups)).toBeGreaterThan(0);
    expect(totalVerts(frameLoad(fullView()).groups)).toBeGreaterThan(0);
  });
});

// ── input ────────────────────────────────────────────────────────────────

function clickHit(
  draw: (c: UiContext, input?: UiInput) => unknown,
  hit: { x: number; y: number; w: number; h: number },
): unknown {
  const c = new UiContext();
  const x = hit.x + hit.w / 2, y = hit.y + hit.h / 2;
  c.begin({ px: x, py: y, down: true, released: false });
  draw(c);
  c.end();
  c.begin({ px: x, py: y, down: false, released: true });
  const result = draw(c);
  c.end();
  return result;
}

describe('save screen — input', () => {
  it('a click on an ENABLED slot fires save with that slot', () => {
    const v = fullView();
    const { hits } = frameSave(v);
    const hit = hits.find((h) => h.id === 'save.slot2.body')!;
    const action = clickHit((c) => drawSaveScreen(c, W, H, S, v), hit);
    expect(action).toEqual({ kind: 'save', slot: 'slot2' });
  });

  it('a click on the DISABLED autosave row fires nothing', () => {
    const v = fullView();
    const { hits } = frameSave(v);
    const hit = hits.find((h) => h.id === 'save.autosave.body')!;
    const action = clickHit((c) => drawSaveScreen(c, W, H, S, v), hit);
    expect(action).toBeNull();
  });

  it('a click on DELETE fires delete with that slot', () => {
    const v = fullView();
    const { hits } = frameSave(v);
    const hit = hits.find((h) => h.id === 'save.slot3.delete')!;
    const action = clickHit((c) => drawSaveScreen(c, W, H, S, v), hit);
    expect(action).toEqual({ kind: 'delete', slot: 'slot3' });
  });

  it('a click on BACK fires back', () => {
    const v = fullView();
    const { hits } = frameSave(v);
    const hit = hits.find((h) => h.id === 'save.back')!;
    const action = clickHit((c) => drawSaveScreen(c, W, H, S, v), hit);
    expect(action).toEqual({ kind: 'back' });
  });

  it('a keyboard ACTIVATE fires the focused row, and never the disabled autosave row', () => {
    const v = fullView();
    const c = new UiContext();
    c.begin();
    drawSaveScreen(c, W, H, S, v);
    c.end();
    // The focus ring still contains 'autosave' (kit/slot-tile has no per-widget
    // disabled concept — see the module doc), so walk it explicitly and assert
    // activating IT specifically produces nothing, while a real slot does.
    c.focusId = 'save.autosave.body';
    c.activate();
    c.begin();
    const blockedResult = drawSaveScreen(c, W, H, S, v);
    c.end();
    expect(blockedResult).toBeNull();

    c.focusId = 'save.slot1.body';
    c.activate();
    c.begin();
    const okResult = drawSaveScreen(c, W, H, S, v);
    c.end();
    expect(okResult).toEqual({ kind: 'save', slot: 'slot1' });
  });
});

describe('load screen — input', () => {
  it('a click on an enabled slot fires load with that slot', () => {
    const v = fullView();
    const { hits } = frameLoad(v);
    const hit = hits.find((h) => h.id === 'load.slot1.body')!;
    const action = clickHit((c) => drawLoadScreen(c, W, H, S, v), hit);
    expect(action).toEqual({ kind: 'load', slot: 'slot1' });
  });

  it('a click on a stale/disabled slot fires nothing, but DELETE on it still fires', () => {
    const v = fullView({ slot1: { compat: 'stale-save', staleReason: 'old' } });
    const { hits } = frameLoad(v);
    const bodyHit = hits.find((h) => h.id === 'load.slot1.body')!;
    expect(clickHit((c) => drawLoadScreen(c, W, H, S, v), bodyHit)).toBeNull();
    const deleteHit = hits.find((h) => h.id === 'load.slot1.delete')!;
    expect(clickHit((c) => drawLoadScreen(c, W, H, S, v), deleteHit)).toEqual({ kind: 'delete', slot: 'slot1' });
  });

  it('a click on an EMPTY slot fires nothing', () => {
    const v = emptyView();
    const { hits } = frameLoad(v);
    const hit = hits.find((h) => h.id === 'load.slot1.body')!;
    expect(clickHit((c) => drawLoadScreen(c, W, H, S, v), hit)).toBeNull();
  });
});

// ── Shell wiring ─────────────────────────────────────────────────────────

describe('Shell — save/load screens', () => {
  it('defaults to four EMPTY slots when no view provider is wired', () => {
    const shell = new Shell({ now: () => 0 });
    shell.push('save');
    const d = shell.describe();
    expect(d.screen).toBe('save');
    const bodyChoices = d.choices.filter((c) => c.id.endsWith('.body'));
    expect(bodyChoices).toHaveLength(4);
    // The honest empty default: autosave is never hand-savable, but an EMPTY
    // slot 1/2/3 is still a valid save target (spec §5.4) — only autosave
    // should be disabled here.
    expect(bodyChoices.find((c) => c.id === 'save.autosave.body')!.enabled).toBe(false);
    for (const slot of ['slot1', 'slot2', 'slot3']) {
      expect(bodyChoices.find((c) => c.id === `save.${slot}.body`)!.enabled).toBe(true);
    }
  });

  it('the LOAD screen defaults to four EMPTY (disabled) slots when no view provider is wired', () => {
    const shell = new Shell({ now: () => 0 });
    shell.push('load');
    const bodyChoices = shell.describe().choices.filter((c) => c.id.endsWith('.body'));
    expect(bodyChoices).toHaveLength(4);
    for (const c of bodyChoices) expect(c.enabled).toBe(false);
  });

  it("describe() enumerates the SAVE screen's slots with verdicts and reasons", () => {
    const shell = new Shell({
      now: () => 0,
      saveView: () => fullView({ slot2: { empty: true, name: '', dateLabel: '', tierLine: '', playtimeLabel: '' } }),
    });
    shell.push('save');
    const byId = new Map(shell.describe().choices.map((c) => [c.id, c]));
    expect(byId.get('save.autosave.body')!.enabled).toBe(false);
    expect(byId.get('save.autosave.body')!.note).toMatch(/MANAGED AUTOMATICALLY/);
    expect(byId.get('save.slot1.body')!.enabled).toBe(true);
    expect(byId.get('save.slot2.body')!.enabled).toBe(true); // empty ⇒ still a valid save target
    expect(byId.get('save.back')).toEqual({ id: 'save.back', label: 'BACK', enabled: true, note: null });
  });

  it("describe() enumerates the LOAD screen's slots, empty/stale disabled with reasons", () => {
    const shell = new Shell({
      now: () => 0,
      loadView: () => fullView({
        slot1: { empty: true, name: '', dateLabel: '', tierLine: '', playtimeLabel: '' },
        slot2: { compat: 'stale-world', staleReason: 'Saved under an older world (content 117; this build is 119)' },
      }),
    });
    shell.push('load');
    const byId = new Map(shell.describe().choices.map((c) => [c.id, c]));
    expect(byId.get('load.slot1.body')!.enabled).toBe(false);
    // Label still carries "EMPTY SLOT" for an agent; the redundant note is gone.
    expect(byId.get('load.slot1.body')!.label).toBe('EMPTY SLOT');
    expect(byId.get('load.slot1.body')!.note).toBeNull();
    expect(byId.get('load.slot2.body')!.enabled).toBe(false);
    expect(byId.get('load.slot2.body')!.note).toContain('117');
    expect(byId.get('load.slot3.body')!.enabled).toBe(true);
  });

  it('describe() choices match what the DRAW path actually offers (save + load)', () => {
    const view = fullView({ slot1: { compat: 'stale-world', staleReason: 'x (1; 2)' } });
    for (const screen of ['save', 'load'] as const) {
      const shell = new Shell({ now: () => 0, saveView: () => view, loadView: () => view });
      shell.push(screen);
      const c = new UiContext();
      c.begin();
      shell.draw(c, W, H, S);
      const { hits } = c.end();
      const drawnIds = hits.map((h) => h.id).sort();
      const describedIds = shell.describe().choices.map((ch) => ch.id).sort();
      expect(describedIds).toEqual(drawnIds);
    }
  });

  it('draw() reports the save/load action the player triggered, via ShellDrawResult', () => {
    const view = fullView();
    const shell = new Shell({ now: () => 0, saveView: () => view });
    shell.push('save');
    const probe = new UiContext();
    probe.begin();
    shell.draw(probe, W, H, S);
    const row1 = probe.end().hits.find((h) => h.id === 'save.slot1.body')!;
    const c = new UiContext();
    c.begin({ px: row1.x + row1.w / 2, py: row1.y + row1.h / 2, down: true, released: false });
    shell.draw(c, W, H, S);
    c.end();
    c.begin({ px: row1.x + row1.w / 2, py: row1.y + row1.h / 2, down: false, released: true });
    const result = shell.draw(c, W, H, S);
    c.end();
    expect(result.save).toEqual({ kind: 'save', slot: 'slot1' });
    expect(result.title).toBeNull();
    expect(result.load).toBeNull();
  });
});
