/** Selections: type_name → {itemId (key in window.itemMetadata), variant} */
export type LpcSelections = Record<string, { itemId: string; variant: string }>;

/**
 * Renders a full LPC spritesheet onto the provided canvas.
 * Fetches sprites from the GitHub Pages CDN.
 */
export declare function renderCharacter(
  selections: LpcSelections,
  bodyType: 'male' | 'female' | 'teen' | 'child' | 'muscular',
  targetCanvas?: HTMLCanvasElement | null,
): Promise<void>;

export declare function renderSingleItem(
  itemId: string,
  variant: string,
  bodyType: 'male' | 'female' | 'teen' | 'child' | 'muscular',
  selections: LpcSelections,
  singleLayer?: number | null,
): Promise<HTMLCanvasElement | null>;
