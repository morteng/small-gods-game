// src/blueprint/features/door.ts
// The door feature. Its size derives from the scale contract so it reads at villager
// height by construction — the fix for the long-standing "doors too big" issue.
import type { FeatureType } from '../registry';
import { DOOR_HEIGHT_UNITS, DOOR_WIDTH_TILES } from '@/render/scale-contract';

const MAIN_SCALE = 1.18;   // a main entrance: modestly grander, still human-relative

export const doorFeatureType: FeatureType = {
  type: 'door',
  paramSchema: {
    main: { kind: 'bool', default: false },
    // width/height: half-width along the wall (tiles) and height (height-units).
    // Defaulted from the scale contract in resolve() when left unset (-1 sentinel).
    width: { kind: 'number', min: -1, max: 2, default: -1 },
    height: { kind: 'number', min: -1, max: 4, default: -1 },
  },
  resolve: (f) => {
    const p = f.params ?? {};
    const main = p.main === true;
    const grand = main ? MAIN_SCALE : 1;
    const halfW = (p.width as number) >= 0 ? (p.width as number) : (DOOR_WIDTH_TILES / 2) * grand;
    const height = (p.height as number) >= 0 ? (p.height as number) : DOOR_HEIGHT_UNITS * grand;
    return { params: { main, halfW, height } };
  },
  toBrief: () => 'human-height door',
};
