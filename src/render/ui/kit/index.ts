// src/render/ui/kit/index.ts
//
// Barrel for the UI kit (UI v3 P1-A) — composite widgets built as PURE
// functions over `UiContext` (no classes, no retained state; immediate mode,
// same discipline as `UiContext` itself). Screen modules import from here
// rather than reaching into individual widget files.

export type { Rect } from '@/render/ui/kit/rect';
export { toggle, type ToggleOpts } from '@/render/ui/kit/toggle';
export { slider, type SliderOpts } from '@/render/ui/kit/slider';
export { tabbar, type TabDef, type TabbarOpts } from '@/render/ui/kit/tabbar';
export { modalFrame, modalOuterRect, backdropClicked, type ModalOpts } from '@/render/ui/kit/modal';
export { list, type ListOpts } from '@/render/ui/kit/list';
export { slotTile, type SlotTileOpts } from '@/render/ui/kit/slot-tile';
export { keyChip, type KeyChipOpts } from '@/render/ui/kit/key-chip';
