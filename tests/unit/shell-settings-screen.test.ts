import { describe, it, expect } from 'vitest';
import { UiContext } from '@/render/ui/ui-context';
import { UiPage, UiSpace, type UiDrawGroup } from '@/render/ui/ui-batcher';
import {
  drawSettingsScreen, settingsRows, formatRowValue, SETTINGS_TABS,
  type SettingsScreenView, type SettingsAction,
} from '@/render/ui/shell/settings-screen';
import { Shell } from '@/render/ui/shell/shell';
import { isSettingsKey } from '@/game';

const W = 1280, H = 720, S = 2;

function view(over: Partial<SettingsScreenView> = {}): SettingsScreenView {
  return {
    tab: 'audio',
    musicOn: true, musicVolume: 0.35,
    sfxOn: true, sfxVolume: 0.6,
    voiceOn: false,
    halfResWater: true, uiScale: 1, lighting: true,
    ...over,
  };
}

/** Screen-space bounding box of every SOLID-page vertex — aggregate once,
 *  assert once (see the note in shell-save-load-screens.test.ts: per-vertex
 *  `expect()` calls pushed a sibling file past vitest's 5 s timeout). */
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

function frame(v: SettingsScreenView, w = W, h = H): { action: SettingsAction | null; hits: readonly { id: string; x: number; y: number; w: number; h: number }[]; groups: UiDrawGroup[] } {
  const c = new UiContext();
  c.begin();
  const res = drawSettingsScreen(c, w, h, S, v);
  const { hits } = c.end();
  return { action: res.action, hits, groups: c.batcher.flush() };
}

// ── pure row logic ──────────────────────────────────────────────────────────

describe('settings screen — row logic', () => {
  it('AUDIO rows reflect the view values', () => {
    const rows = settingsRows(view({ musicOn: false, musicVolume: 0.7, sfxOn: true, sfxVolume: 0.2, voiceOn: true }), 'audio');
    expect(rows.find(r => r.key === 'musicOn')!.value).toBe(false);
    expect(rows.find(r => r.key === 'musicVolume')!.value).toBe(0.7);
    expect(rows.find(r => r.key === 'sfxOn')!.value).toBe(true);
    expect(rows.find(r => r.key === 'sfxVolume')!.value).toBe(0.2);
    expect(rows.find(r => r.key === 'voiceOn')!.value).toBe(true);
  });

  it('VIDEO rows reflect the view values', () => {
    const rows = settingsRows(view({ halfResWater: false, uiScale: 2, lighting: false }), 'video');
    expect(rows.find(r => r.key === 'halfResWater')!.value).toBe(false);
    expect(rows.find(r => r.key === 'uiScale')!.value).toBe(2);
    expect(rows.find(r => r.key === 'lighting')!.value).toBe(false);
  });

  it('GAMEPLAY and CONTROLS contribute no set-able rows (island / read-only chips)', () => {
    expect(settingsRows(view(), 'gameplay')).toHaveLength(0);
    expect(settingsRows(view(), 'controls')).toHaveLength(0);
  });

  it('formatRowValue mirrors what the widgets paint', () => {
    expect(formatRowValue({ id: 'x', key: 'musicOn', label: 'X', kind: 'toggle', value: true })).toBe('ON');
    expect(formatRowValue({ id: 'x', key: 'musicOn', label: 'X', kind: 'toggle', value: false })).toBe('OFF');
    expect(formatRowValue({ id: 'x', key: 'musicVolume', label: 'X', kind: 'slider', value: 0.6 })).toBe('60%');
    expect(formatRowValue({ id: 'x', key: 'uiScale', label: 'X', kind: 'slider', value: 2 })).toBe('2X');
  });
});

// ── geometry ─────────────────────────────────────────────────────────────

describe('settings screen — geometry', () => {
  it('registers a hit region per tab plus BACK on every tab, and per row on AUDIO/VIDEO', () => {
    const audio = frame(view({ tab: 'audio' }));
    const audioIds = audio.hits.map(h => h.id).sort();
    expect(audioIds).toEqual([
      'settings.back',
      'settings.musicOn', 'settings.musicVolume', 'settings.sfxOn', 'settings.sfxVolume', 'settings.voiceOn',
      'settings.tabs.audio', 'settings.tabs.controls', 'settings.tabs.gameplay', 'settings.tabs.video',
    ].sort());

    const video = frame(view({ tab: 'video' }));
    const videoIds = video.hits.map(h => h.id).sort();
    expect(videoIds).toEqual([
      'settings.back',
      'settings.halfResWater', 'settings.lighting', 'settings.uiScale',
      'settings.tabs.audio', 'settings.tabs.controls', 'settings.tabs.gameplay', 'settings.tabs.video',
    ].sort());
  });

  it('the GAMEPLAY tab draws only the tabs + BACK, and reserves an island rect', () => {
    const { hits } = frame(view({ tab: 'gameplay' }));
    const ids = hits.map(h => h.id).sort();
    expect(ids).toEqual(['settings.back', 'settings.tabs.audio', 'settings.tabs.controls', 'settings.tabs.gameplay', 'settings.tabs.video'].sort());
    const c = new UiContext();
    c.begin();
    const res = drawSettingsScreen(c, W, H, S, view({ tab: 'gameplay' }));
    c.end();
    expect(res.island).not.toBeNull();
    expect(res.island!.w).toBeGreaterThan(0);
    expect(res.island!.h).toBeGreaterThan(0);
  });

  it('every OTHER tab reserves no island', () => {
    for (const tab of ['audio', 'video', 'controls'] as const) {
      const c = new UiContext();
      c.begin();
      const res = drawSettingsScreen(c, W, H, S, view({ tab }));
      c.end();
      expect(res.island, tab).toBeNull();
    }
  });

  it('the CONTROLS tab draws only the tabs + BACK (read-only key-chips, no hit regions)', () => {
    const { hits } = frame(view({ tab: 'controls' }));
    const ids = hits.map(h => h.id).sort();
    expect(ids).toEqual(['settings.back', 'settings.tabs.audio', 'settings.tabs.controls', 'settings.tabs.gameplay', 'settings.tabs.video'].sort());
  });

  /** True rectangle overlap (both axes) — the tabbar's four tabs deliberately
   *  SHARE a y-range (they sit side by side), so a y-only sort/compare (as
   *  save/load's single-column screen uses) would false-positive on them. */
  function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  it('no two hit regions overlap, at full size and cramped sizes', () => {
    for (const tab of ['audio', 'video', 'controls'] as const) {
      for (const [w, h] of [[1280, 720], [420, 640], [360, 300]] as const) {
        const { hits } = frame(view({ tab }), w, h);
        for (let i = 0; i < hits.length; i++) {
          for (let j = i + 1; j < hits.length; j++) {
            expect(rectsOverlap(hits[i], hits[j]), `${hits[i].id} × ${hits[j].id} at ${tab} ${w}x${h}`).toBe(false);
          }
        }
      }
    }
  });

  it('draws nothing outside the target, at full size and cramped sizes', () => {
    for (const tab of ['audio', 'video', 'gameplay', 'controls'] as const) {
      for (const [w, h] of [[1280, 720], [420, 640], [360, 300]] as const) {
        const { hits, groups } = frame(view({ tab }), w, h);
        for (const hit of hits) {
          expect(hit.x, `hit left edge ${tab} ${w}x${h}`).toBeGreaterThanOrEqual(0);
          expect(hit.x + hit.w, `hit right edge ${tab} ${w}x${h}`).toBeLessThanOrEqual(w);
          expect(hit.y, `hit top edge ${tab} ${w}x${h}`).toBeGreaterThanOrEqual(0);
          expect(hit.y + hit.h, `hit bottom edge ${tab} ${w}x${h}`).toBeLessThanOrEqual(h);
        }
        const b = screenBounds(groups);
        expect(b.minX, `x underflow ${tab} ${w}x${h}`).toBeGreaterThanOrEqual(0);
        expect(b.maxX, `x overflow ${tab} ${w}x${h}`).toBeLessThanOrEqual(w);
        expect(b.minY, `y underflow ${tab} ${w}x${h}`).toBeGreaterThanOrEqual(0);
        expect(b.maxY, `y overflow ${tab} ${w}x${h}`).toBeLessThanOrEqual(h);
      }
    }
  });

  it('paints something on every tab (never a blank frame)', () => {
    for (const tab of ['audio', 'video', 'gameplay', 'controls'] as const) {
      expect(totalVerts(frame(view({ tab })).groups), tab).toBeGreaterThan(0);
    }
  });
});

// ── input ────────────────────────────────────────────────────────────────

function clickHit(v: SettingsScreenView, hit: { x: number; y: number; w: number; h: number }): SettingsAction | null {
  const c = new UiContext();
  const x = hit.x + hit.w / 2, y = hit.y + hit.h / 2;
  c.begin({ px: x, py: y, down: true, released: false });
  drawSettingsScreen(c, W, H, S, v);
  c.end();
  c.begin({ px: x, py: y, down: false, released: true });
  const res = drawSettingsScreen(c, W, H, S, v);
  c.end();
  return res.action;
}

describe('settings screen — input', () => {
  it('a click on a TOGGLE returns set with the FLIPPED value', () => {
    const v = view({ tab: 'audio', musicOn: true });
    const { hits } = frame(v);
    const hit = hits.find(h => h.id === 'settings.musicOn')!;
    expect(clickHit(v, hit)).toEqual({ kind: 'set', key: 'musicOn', value: false });
  });

  it('a drag/click on a SLIDER returns set with the new 0..1 value', () => {
    const v = view({ tab: 'audio' });
    const { hits } = frame(v);
    const hit = hits.find(h => h.id === 'settings.musicVolume')!;
    const action = clickHit(v, hit);
    if (action === null || action.kind !== 'set') throw new Error('expected a set action');
    expect(action.key).toBe('musicVolume');
    expect(typeof action.value).toBe('number');
    expect(action.value as number).toBeGreaterThanOrEqual(0);
    expect(action.value as number).toBeLessThanOrEqual(1);
  });

  it('the UI SCALE slider returns a real 1..3 rung, not a normalized fraction', () => {
    const v = view({ tab: 'video', uiScale: 1 });
    const { hits } = frame(v);
    const hit = hits.find(h => h.id === 'settings.uiScale')!;
    // Click at the RIGHT edge of the track — the highest rung (3X).
    const c = new UiContext();
    c.begin({ px: hit.x + hit.w - 1, py: hit.y + hit.h - 1, down: true, released: false });
    drawSettingsScreen(c, W, H, S, v);
    c.end();
    c.begin({ px: hit.x + hit.w - 1, py: hit.y + hit.h - 1, down: false, released: true });
    const res = drawSettingsScreen(c, W, H, S, v);
    c.end();
    expect(res.action).toEqual({ kind: 'set', key: 'uiScale', value: 3 });
  });

  it('a click on a TAB returns tab', () => {
    const v = view({ tab: 'audio' });
    const { hits } = frame(v);
    const hit = hits.find(h => h.id === 'settings.tabs.video')!;
    expect(clickHit(v, hit)).toEqual({ kind: 'tab', tab: 'video' });
  });

  it('a click on BACK returns back', () => {
    const v = view();
    const { hits } = frame(v);
    const hit = hits.find(h => h.id === 'settings.back')!;
    expect(clickHit(v, hit)).toEqual({ kind: 'back' });
  });

  it('a keyboard ACTIVATE fires the focused widget', () => {
    const v = view({ tab: 'audio', sfxOn: true });
    const c = new UiContext();
    c.begin();
    drawSettingsScreen(c, W, H, S, v);
    c.end();
    c.focusId = 'settings.sfxOn';
    c.activate();
    c.begin();
    const res = drawSettingsScreen(c, W, H, S, v);
    c.end();
    expect(res.action).toEqual({ kind: 'set', key: 'sfxOn', value: false });
  });
});

// ── Shell wiring ─────────────────────────────────────────────────────────

describe('Shell — settings screen', () => {
  it('defaults to the AUDIO tab with all-defaults values when no view provider is wired', () => {
    const shell = new Shell({ now: () => 0 });
    shell.push('settings');
    const d = shell.describe();
    expect(d.screen).toBe('settings');
    const byId = new Map(d.choices.map(c => [c.id, c]));
    expect(byId.get('settings.tabs.audio')!.note).toBe('CURRENT TAB');
    expect(byId.get('settings.musicOn')!.note).toBe('ON');
  });

  it('setSettingsTab switches the active tab, reflected in BOTH describe() and draw()', () => {
    const shell = new Shell({ now: () => 0 });
    shell.push('settings');
    shell.setSettingsTab('video');
    const d = shell.describe();
    expect(d.choices.map(c => c.id)).toContain('settings.halfResWater');
    expect(d.choices.map(c => c.id)).not.toContain('settings.musicOn');

    const c = new UiContext();
    c.begin();
    shell.draw(c, W, H, S);
    const { hits } = c.end();
    expect(hits.map(h => h.id)).toContain('settings.halfResWater');
  });

  it("describe() enumerates the tabs and the active tab's rows, with value notes", () => {
    const shell = new Shell({
      now: () => 0,
      settingsView: () => view({ musicOn: false, musicVolume: 0.5 }),
    });
    shell.push('settings');
    const byId = new Map(shell.describe().choices.map(c => [c.id, c]));
    for (const t of SETTINGS_TABS) expect(byId.has(`settings.tabs.${t.id}`)).toBe(true);
    expect(byId.get('settings.musicOn')!.note).toBe('OFF');
    expect(byId.get('settings.musicVolume')!.note).toBe('50%');
    expect(byId.get('settings.back')).toEqual({ id: 'settings.back', label: 'BACK', enabled: true, note: null });
  });

  it('describe() choices match what the DRAW path actually offers, on every tab', () => {
    const shell = new Shell({ now: () => 0, settingsView: () => view() });
    for (const tab of ['audio', 'video', 'gameplay', 'controls'] as const) {
      shell.setSettingsTab(tab);
      const c = new UiContext();
      c.begin();
      shell.draw(c, W, H, S);
      const { hits } = c.end();
      const drawnIds = hits.map(h => h.id).sort();
      const describedIds = shell.describe().choices.map(ch => ch.id).sort();
      expect(describedIds, tab).toEqual(drawnIds);
    }
  });

  it('draw() reports the island rect on GAMEPLAY every frame, action or not', () => {
    const shell = new Shell({ now: () => 0, settingsView: () => view() });
    shell.push('settings');
    shell.setSettingsTab('gameplay');
    const c = new UiContext();
    c.begin();
    const res = shell.draw(c, W, H, S);
    c.end();
    expect(res.island).not.toBeNull();
    expect(res.settings).toBeNull();
  });

  it('draw() reports the settings action via ShellDrawResult, leaving title/save/load null', () => {
    const shell = new Shell({ now: () => 0, settingsView: () => view() });
    shell.push('settings');
    const probe = new UiContext();
    probe.begin();
    shell.draw(probe, W, H, S);
    const back = probe.end().hits.find(h => h.id === 'settings.back')!;
    const c = new UiContext();
    c.begin({ px: back.x + back.w / 2, py: back.y + back.h / 2, down: true, released: false });
    shell.draw(c, W, H, S);
    c.end();
    c.begin({ px: back.x + back.w / 2, py: back.y + back.h / 2, down: false, released: true });
    const result = shell.draw(c, W, H, S);
    c.end();
    expect(result.settings).toEqual({ kind: 'back' });
    expect(result.title).toBeNull();
    expect(result.save).toBeNull();
    expect(result.load).toBeNull();
  });
});

// ── set_setting validation (the predicate, not Game) ──────────────────────

describe('isSettingsKey — set_setting validation', () => {
  it('accepts every key the settings screen actually edits', () => {
    for (const key of ['musicOn', 'musicVolume', 'sfxOn', 'sfxVolume', 'voiceOn', 'halfResWater', 'uiScale', 'lighting']) {
      expect(isSettingsKey(key), key).toBe(true);
    }
  });

  it('refuses an unknown key', () => {
    expect(isSettingsKey('nope')).toBe(false);
    expect(isSettingsKey('')).toBe(false);
  });

  it('refuses a REAL Settings field this screen does not expose through set_setting', () => {
    // `llmProviderConfig` goes through the DOM island's own onSaveLlmConfig path,
    // never `set_setting` — a bus-connected agent must not be able to smuggle a
    // provider config through the wrong door.
    expect(isSettingsKey('llmProviderConfig')).toBe(false);
    expect(isSettingsKey('pixellabApiKey')).toBe(false);
  });
});
