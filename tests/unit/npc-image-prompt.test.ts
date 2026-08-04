import { describe, it, expect } from 'vitest';
import { npcImagePrompt, type NpcSubject } from '@/assetgen/npc-image-prompt';

const ACOLYTE: NpcSubject = {
  id: 'acolyte-drowned',
  name: 'an acolyte of the drowned god',
  wears: ['a sea-grey hooded robe', 'a rope belt', 'bare feet'],
};

describe('npc-image-prompt', () => {
  it('leads with the subject, the action and the facing', () => {
    const p = npcImagePrompt({ subject: ACOLYTE, clip: 'march', facing: 'left', model: 'qwen/qwen-image-edit-2511' });
    expect(p.startsWith('an acolyte of the drowned god, mid-stride, marching in step, seen from the side, facing left')).toBe(true);
  });

  it('always demands the preservation the animation depends on', () => {
    for (const model of ['qwen/qwen-image-edit-2511', 'black-forest-labs/flux.2-klein', 'google/gemini-3-pro-image']) {
      const p = npcImagePrompt({ subject: ACOLYTE, clip: 'walk', facing: 'down', model });
      expect(p).toMatch(/pose, proportions and outline exactly/);
      expect(p).toMatch(/solid uniform #ff00ff magenta/);
    }
  });

  it('appends the instruction-editing adherence clause for qwen only', () => {
    const qwen = npcImagePrompt({ subject: ACOLYTE, clip: 'walk', facing: 'down', model: 'qwen/qwen-image-edit-2511' });
    const flux = npcImagePrompt({ subject: ACOLYTE, clip: 'walk', facing: 'down', model: 'black-forest-labs/flux.2-klein' });
    expect(qwen).toMatch(/Change clothing and colour only/);
    expect(flux).not.toMatch(/Change clothing and colour only/);
  });

  it('never asks for a held item to be added — only acknowledges one already drawn', () => {
    const p = npcImagePrompt({
      subject: { ...ACOLYTE, holds: ['driftwood staff'] },
      clip: 'idle-shift', facing: 'down', model: 'qwen/qwen-image-edit-2511',
    });
    expect(p).toMatch(/already in the figure's hands stays exactly where it is/);
    expect(p).not.toMatch(/\badd\b/i);
  });

  it('states cycle position so frames of one sheet read as one character', () => {
    const p = npcImagePrompt({ subject: ACOLYTE, clip: 'march', facing: 'left', model: 'x', frame: 3, frames: 17 });
    expect(p).toMatch(/frame 4 of 17 in a single continuous animation cycle/);
    // A one-frame sheet has no cycle to be part of.
    expect(npcImagePrompt({ subject: ACOLYTE, clip: 'march', facing: 'left', model: 'x', frame: 0, frames: 1 }))
      .not.toMatch(/animation cycle/);
  });

  it('does not call a finished character sprite a massing render', () => {
    const p = npcImagePrompt({ subject: ACOLYTE, clip: 'walk', facing: 'down', model: 'qwen/qwen-image-edit-2511' });
    expect(p).not.toMatch(/massing|colour-coded/);
  });

  it('is a pure function of its inputs', () => {
    const ctx = { subject: ACOLYTE, clip: 'walk', facing: 'down', model: 'qwen/qwen-image-edit-2511' };
    expect(npcImagePrompt(ctx)).toBe(npcImagePrompt(ctx));
  });
});
