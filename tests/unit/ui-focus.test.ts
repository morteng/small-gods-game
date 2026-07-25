import { describe, it, expect } from 'vitest';
import { UiContext, EMPTY_INPUT, type UiInput } from '@/render/ui/ui-context';

function ctx() {
  return new UiContext();
}

describe('UiContext focus ring: registration order + wrap', () => {
  it('focusNext walks the ring in registration order, wrapping past the end', () => {
    const c = ctx();
    c.begin();
    c.focusable('a');
    c.focusable('b');
    c.focusable('c');
    c.end();

    expect(c.focusId).toBeNull(); // nothing auto-focuses on first draw
    c.focusNext();
    expect(c.focusId).toBe('a');
    c.focusNext();
    expect(c.focusId).toBe('b');
    c.focusNext();
    expect(c.focusId).toBe('c');
    c.focusNext(); // wraps past the end
    expect(c.focusId).toBe('a');
  });

  it('focusPrev walks backward, wrapping past the start', () => {
    const c = ctx();
    c.begin();
    c.focusable('a');
    c.focusable('b');
    c.focusable('c');
    c.end();

    c.focusPrev(); // from null: mirror of focusNext's "first entry" — lands on the LAST
    expect(c.focusId).toBe('c');
    c.focusPrev();
    expect(c.focusId).toBe('b');
    c.focusPrev();
    expect(c.focusId).toBe('a');
    c.focusPrev(); // wraps past the start
    expect(c.focusId).toBe('c');
  });

  it('focusNext from null lands on the first entry', () => {
    const c = ctx();
    c.begin();
    c.focusable('x');
    c.focusable('y');
    c.end();
    expect(c.focusId).toBeNull();
    c.focusNext();
    expect(c.focusId).toBe('x');
  });

  it('is a no-op on an empty ring (no widgets drawn)', () => {
    const c = ctx();
    c.begin();
    c.end();
    c.focusNext();
    expect(c.focusId).toBeNull();
    c.focusPrev();
    expect(c.focusId).toBeNull();
  });

  it('a focusId absent from the current ring (its widget stopped drawing) is treated like null', () => {
    const c = ctx();
    c.begin();
    c.focusable('a');
    c.focusable('b');
    c.end();
    c.setFocus('gone'); // simulate a screen swap that dropped this id
    c.focusNext();
    expect(c.focusId).toBe('a'); // same "land on first" behavior as coming from null
  });

  it('setFocus sets focus directly and ring navigation continues from there', () => {
    const c = ctx();
    c.begin();
    c.focusable('a');
    c.focusable('b');
    c.focusable('c');
    c.end();
    c.setFocus('b');
    expect(c.focusId).toBe('b');
    c.focusNext();
    expect(c.focusId).toBe('c');
  });

  it('the ring is per-frame: a fresh frame rebuilds it, but focusId (durable) survives', () => {
    const c = ctx();
    c.begin();
    c.focusable('a');
    c.focusable('b');
    c.end();
    c.focusNext(); // -> 'a'
    c.begin(); // new frame — ring resets, but durable focusId is untouched
    expect(c.focusId).toBe('a');
    c.focusable('a');
    c.focusable('b');
    c.end();
    expect(c.focusId).toBe('a');
  });
});

describe('UiContext.activate() + button()/hotspot()', () => {
  it('a focused button fires on the NEXT frame after activate(); a non-focused sibling does not', () => {
    const c = ctx();
    c.begin();
    c.button('a', 'A', 100, 100, 40, 20);
    c.button('b', 'B', 100, 140, 40, 20);
    c.end();

    c.focusNext(); // focus -> 'a' (registration/draw order)
    expect(c.focusId).toBe('a');
    c.activate();

    c.begin(); // EMPTY_INPUT — this is a keyboard activation, not a click; (0,0) must
    // stay clear of both buttons so neither is spuriously "hot" under the default snapshot
    const clickedA = c.button('a', 'A', 100, 100, 40, 20);
    const clickedB = c.button('b', 'B', 100, 140, 40, 20);
    c.end();

    expect(clickedA).toBe(true);
    expect(clickedB).toBe(false);
  });

  it('activate() is one-shot: a third frame without re-arming does not fire again', () => {
    const c = ctx();
    c.begin();
    c.button('a', 'A', 100, 100, 40, 20); // off-origin: EMPTY_INPUT's (0,0) pointer must not be spuriously "hot"
    c.end();
    c.focusNext();
    c.activate();

    c.begin();
    expect(c.button('a', 'A', 100, 100, 40, 20)).toBe(true);
    c.end();

    c.begin();
    expect(c.button('a', 'A', 100, 100, 40, 20)).toBe(false);
    c.end();
  });

  it('calling activate() twice before a frame runs still fires only once', () => {
    const c = ctx();
    c.begin();
    c.button('a', 'A', 100, 100, 40, 20);
    c.end();
    c.focusNext();
    c.activate();
    c.activate();

    c.begin();
    expect(c.button('a', 'A', 100, 100, 40, 20)).toBe(true);
    c.end();

    c.begin();
    expect(c.button('a', 'A', 100, 100, 40, 20)).toBe(false);
    c.end();
  });

  it('activate() also fires a focused hotspot', () => {
    const c = ctx();
    c.begin();
    c.hotspot('orb', 100, 100, 20, 20);
    c.end();
    c.focusNext();
    c.activate();

    c.begin();
    const clicked = c.hotspot('orb', 100, 100, 20, 20);
    c.end();
    expect(clicked).toBe(true);
  });

  it('a disabled button never registers into the ring and is never activated', () => {
    const c = ctx();
    c.begin();
    c.button('a', 'A', 0, 0, 40, 20, { disabled: true });
    c.end();
    c.focusNext(); // ring is empty — disabled buttons opt out
    expect(c.focusId).toBeNull();
  });
});

describe('hotspot({ focusable: false }) — P5 opt-out from the nav ring', () => {
  it('does NOT join the focus ring, but a focusable sibling still does', () => {
    const c = ctx();
    c.begin();
    c.hotspot('label', 0, 0, 20, 20, { focusable: false });
    c.hotspot('button-like', 100, 100, 20, 20);
    c.end();
    c.focusNext();
    expect(c.focusId).toBe('button-like'); // 'label' never entered the ring
    c.focusNext();
    expect(c.focusId).toBe('button-like'); // only one entry — wraps to itself
  });

  it('is a no-op ring of exactly the non-focusable hotspots (empty ring stays inert)', () => {
    const c = ctx();
    c.begin();
    c.hotspot('a', 0, 0, 10, 10, { focusable: false });
    c.hotspot('b', 20, 20, 10, 10, { focusable: false });
    c.end();
    c.focusNext();
    expect(c.focusId).toBeNull();
  });

  it('is STILL fully clickable by pointer (hit-testing/click behavior unchanged)', () => {
    const c = ctx();
    const inside: UiInput = { px: 5, py: 5, down: false, released: true };
    c.begin(inside);
    const clicked = c.hotspot('label', 0, 0, 20, 20, { focusable: false });
    const { hits } = c.end();
    expect(clicked).toBe(true);
    expect(hits).toEqual([{ id: 'label', x: 0, y: 0, w: 20, h: 20 }]);
  });

  it('hovering it does NOT steal keyboard focus from whatever was already focused', () => {
    const c = ctx();
    c.begin();
    c.hotspot('real-control', 100, 100, 20, 20);
    c.end();
    c.focusNext();
    expect(c.focusId).toBe('real-control');

    const overLabel: UiInput = { px: 5, py: 5, down: false, released: false };
    c.begin(overLabel);
    c.hotspot('label', 0, 0, 20, 20, { focusable: false });
    c.hotspot('real-control', 100, 100, 20, 20);
    c.end();
    expect(c.focusId).toBe('real-control'); // unchanged — the label never called setFocus
  });

  it('a keyboard/gamepad ACTIVATE cannot fire it (it can never hold focus)', () => {
    const c = ctx();
    c.begin();
    c.hotspot('label', 0, 0, 20, 20, { focusable: false });
    c.end();
    c.setFocus('label'); // force it, simulating a stale/foreign focusId
    c.activate();
    c.begin();
    const clicked = c.hotspot('label', 0, 0, 20, 20, { focusable: false });
    c.end();
    expect(clicked).toBe(false);
  });

  it('omitting opts (default) behaves exactly as before — focusable', () => {
    const c = ctx();
    c.begin();
    c.hotspot('x', 0, 0, 10, 10);
    c.end();
    c.focusNext();
    expect(c.focusId).toBe('x');
  });
});

describe('pointer hover and keyboard focus agree (setFocus)', () => {
  it('hovering a button sets focusId to that button — pointer and keyboard never disagree', () => {
    const c = ctx();
    const inside: UiInput = { px: 20, py: 15, down: false, released: false };
    c.begin(inside);
    c.button('go', 'Go', 10, 10, 60, 20);
    c.end();
    expect(c.focusId).toBe('go');
  });

  it('setFocus(null) clears focus explicitly', () => {
    const c = ctx();
    c.begin();
    c.focusable('a');
    c.end();
    c.setFocus('a');
    expect(c.focusId).toBe('a');
    c.setFocus(null);
    expect(c.focusId).toBeNull();
  });
});

describe('focus never changes hit geometry (paint-only ring)', () => {
  it('button() registers the identical hit region whether or not it is focused', () => {
    const unfocused = (() => {
      const c = ctx();
      c.begin();
      c.button('go', 'Go', 10, 10, 60, 20);
      return c.end().hits;
    })();

    const focused = (() => {
      const c = ctx();
      c.begin();
      c.button('go', 'Go', 10, 10, 60, 20);
      c.end();
      c.focusNext(); // -> 'go'
      c.begin(EMPTY_INPUT);
      c.button('go', 'Go', 10, 10, 60, 20);
      return c.end().hits;
    })();

    expect(focused).toEqual(unfocused);
  });

  it('draws an extra focus-ring border when focused-but-not-hot (paint grows, hits do not)', () => {
    const baseVerts = (() => {
      const c = ctx();
      c.begin();
      c.button('go', 'Go', 10, 10, 60, 20);
      c.end();
      return c.batcher.flush().reduce((s, g) => s + g.vertexCount, 0);
    })();

    const c = ctx();
    c.begin();
    c.button('go', 'Go', 10, 10, 60, 20);
    c.end();
    c.focusNext(); // focus 'go'; pointer stays at EMPTY_INPUT (not hot)
    c.begin();
    c.button('go', 'Go', 10, 10, 60, 20);
    const { hits } = c.end();
    const focusedVerts = c.batcher.flush().reduce((s, g) => s + g.vertexCount, 0);

    expect(focusedVerts).toBeGreaterThan(baseVerts); // the added 4-edge ring
    expect(hits).toEqual([{ id: 'go', x: 10, y: 10, w: 60, h: 20 }]); // hit rect unchanged
  });

  it('no focus ring is drawn while hot (hover already indicates it)', () => {
    const c = ctx();
    c.begin();
    c.button('go', 'Go', 10, 10, 60, 20);
    c.end();
    c.focusNext(); // focus 'go'

    const hotVerts = (() => {
      const inside: UiInput = { px: 20, py: 15, down: false, released: false };
      c.begin(inside); // pointer now hot over the SAME id
      c.button('go', 'Go', 10, 10, 60, 20);
      c.end();
      return c.batcher.flush().reduce((s, g) => s + g.vertexCount, 0);
    })();

    const plainHotVerts = (() => {
      const c2 = ctx();
      const inside: UiInput = { px: 20, py: 15, down: false, released: false };
      c2.begin(inside);
      c2.button('go', 'Go', 10, 10, 60, 20);
      c2.end();
      return c2.batcher.flush().reduce((s, g) => s + g.vertexCount, 0);
    })();

    expect(hotVerts).toBe(plainHotVerts); // no extra ring geometry while hot
  });
});

describe('UiContext.pointer()', () => {
  it('reports the injected input snapshot position', () => {
    const c = ctx();
    c.begin({ px: 42, py: 7, down: false, released: false });
    expect(c.pointer()).toEqual({ x: 42, y: 7 });
  });

  it('defaults to the empty snapshot origin', () => {
    const c = ctx();
    c.begin();
    expect(c.pointer()).toEqual({ x: 0, y: 0 });
  });
});
