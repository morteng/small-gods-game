import { describe, it, expect } from 'vitest';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { geometryDescription, ttiReferencePrompt } from '@/assetgen/building-image-prompt';

describe('generalized TTI reference prompt', () => {
  it('drops exact incidental counts but keeps identity (vs the faithful img2img description)', () => {
    const rb = synthesizeBlueprint('tavern', [], 1)!;
    const faithful = geometryDescription(rb);
    const general = geometryDescription(rb, { generalized: true });

    // Faithful states exact counts (it repaints our massing); generalized must not.
    expect(faithful).toMatch(/\d+\s+(visible window|stone chimney|roof dormer)/);
    expect(general).not.toMatch(/\d+\s+(visible window|stone chimney|roof dormer|window|dormer)/);

    // Identity is kept: it is still a storeyed structure with a roof, and still HAS the features.
    expect(general).toMatch(/storey/);
    expect(general).toMatch(/roof/);
    expect(general).toMatch(/chimney/);
    expect(general).toMatch(/window/);

    // The img2img-only repaint instruction is dropped from the TTI variant.
    expect(faithful).toMatch(/Draw only these visible elements/);
    expect(general).not.toMatch(/Draw only these visible elements/);
  });

  it('ttiReferencePrompt names the subject + generalized geometry, no chroma/repaint scaffolding', () => {
    const p = ttiReferencePrompt(synthesizeBlueprint('tavern', [], 1)!);
    expect(p).toMatch(/isometric pixel-art game sprite/);
    expect(p).toMatch(/tavern/);
    expect(p).not.toMatch(/magenta|chroma|repaint|#[0-9a-fA-F]{6}/);   // no img2img scaffolding
    expect(p).not.toMatch(/\d+\s+visible window/);                     // generalized counts
  });
});
