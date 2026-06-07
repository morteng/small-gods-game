import { describe, it, expect } from 'vitest';
import { opaqueAnchor } from '@/render/iso/iso-sprite-bbox';

describe('opaqueAnchor', () => {
  it('falls back to the full-frame anchor when the image is not yet decoded', () => {
    const img = { naturalWidth: 256, naturalHeight: 240, complete: false, src: 'x.png' } as any;
    expect(opaqueAnchor(img)).toEqual({ centerX: 128, bottom: 240 });
  });

  it('falls back to full-frame when no canvas readback is available (no real pixels)', () => {
    // jsdom: drawing a non-image throws → graceful fallback to frame centre/bottom.
    const img = { naturalWidth: 200, naturalHeight: 180, complete: true, src: '' } as any;
    expect(opaqueAnchor(img)).toEqual({ centerX: 100, bottom: 180 });
  });
});
