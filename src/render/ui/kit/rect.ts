// src/render/ui/kit/rect.ts
//
// The one `Rect` shape shared across the kit (`modal.ts`'s content rect,
// `slot-tile.ts`'s thumbnail rect, ...). `ui-runtime.ts` and
// `src/blueprint/compile/to-geometry.ts` each declare their own private copy
// of this same shape — that's fine (they don't share callers with the kit) —
// but the kit's widgets DO hand `Rect`s to each other and to callers, so this
// one gets a name and a single definition.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
