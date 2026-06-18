import { describe, it, expect } from 'vitest';
import { StoryRegistry } from '@/story';
import type { StoryPack } from '@/story';
import { droughtOmenPack } from '@/story/samples/the-drought-omen';
import { UiRuntime } from '@/render/ui/ui-runtime';
import { StorySession } from '@/story/story-session';

// ── pack registry: the storylet-id → pack lookup the staging seam uses ──
describe('StoryRegistry', () => {
  it('indexes a valid pack and resolves storylet ids to it', () => {
    const reg = new StoryRegistry();
    expect(reg.register(droughtOmenPack)).toEqual([]);
    expect(reg.size).toBe(1);
    expect(reg.findByStorylet('parched-prayer')).toBe(droughtOmenPack);
    expect(reg.has('parched-prayer')).toBe(true);
    expect(reg.findByStorylet('no-such-storylet')).toBeNull();
  });

  it('rejects a pack whose effect is outside the capability allowlist', () => {
    const reg = new StoryRegistry();
    const errors = reg.register(droughtOmenPack, { allowedVerbs: new Set(['whisper']) });
    expect(errors.length).toBeGreaterThan(0);
    expect(reg.size).toBe(0); // not indexed when rejected
    expect(reg.findByStorylet('parched-prayer')).toBeNull();
  });
});

// ── UiRuntime story card: modal presentation + click-to-advance ──
const linePack: StoryPack = {
  id: 'p', version: 1,
  storylets: [{
    id: 'beat', body: [
      { t: 'say', who: 'Elder', text: 'The well is dry and the sky is iron.' },
      { t: 'choice', options: [
        { text: 'Send a sign.', body: [{ t: 'say', who: null, text: 'Clouds gather.' }] },
        { text: 'Stay silent.', body: [] },
      ] },
      { t: 'end' },
    ],
  }],
};

function clickHit(ui: UiRuntime, id: string, w = 1000, h = 700, dpr = 1): boolean {
  const hit = ui.hitRegions().find((r) => r.id === id);
  if (!hit) return false;
  const cx = hit.x + hit.w / 2;
  const cy = hit.y + hit.h / 2;
  ui.pointerMove(cx, cy);
  ui.pointerDown(cx, cy);
  ui.pointerUp(cx, cy);
  ui.frame(w, h, dpr); // observes the release edge → drives the click + stage change
  ui.frame(w, h, dpr); // settling frame: hit regions now reflect the new stage
  return true;
}

describe('UiRuntime story card', () => {
  it('is modal while a story is up and falls back through the beat to done', () => {
    const ui = new UiRuntime();
    let toggles: boolean[] = [];
    ui.configure({ onStoryToggle: (a) => toggles.push(a) });

    expect(ui.hasStory()).toBe(false);
    expect(ui.consumesPointer(5, 5)).toBe(false);

    ui.presentStory(new StorySession(linePack, { seed: 1 }), 'beat');
    expect(ui.hasStory()).toBe(true);
    expect(toggles).toEqual([true]);
    expect(ui.consumesPointer(5, 5)).toBe(true); // eats world input anywhere

    // first frame: the opening line + a CONTINUE affordance
    ui.frame(1000, 700, 1);
    expect(ui.hitRegions().some((r) => r.id === 'story.next')).toBe(true);

    // advance the line → the choice stage exposes per-option hotspots
    expect(clickHit(ui, 'story.next')).toBe(true);
    const optionIds = ui.hitRegions().filter((r) => r.id.startsWith('story.opt.')).map((r) => r.id);
    expect(optionIds.length).toBe(2);

    // pick option 0 (sign) → its body line, then end → dismissed
    expect(clickHit(ui, 'story.opt.0')).toBe(true);
    expect(ui.hasStory()).toBe(true); // still on the body line
    clickHit(ui, 'story.next');       // past the body line → end
    expect(ui.hasStory()).toBe(false);
    expect(toggles).toEqual([true, false]);
    expect(ui.consumesPointer(5, 5)).toBe(false);
  });

  it('drops a session that yields nothing without ever going modal', () => {
    const ui = new UiRuntime();
    const empty: StoryPack = { id: 'e', version: 1, storylets: [{ id: 's', body: [{ t: 'end' }] }] };
    ui.presentStory(new StorySession(empty, { seed: 1 }), 's');
    expect(ui.hasStory()).toBe(false);
  });
});
