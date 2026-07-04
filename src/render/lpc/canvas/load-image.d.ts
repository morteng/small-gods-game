export function loadImage(src: string): Promise<HTMLImageElement>;
export function clearImageCache(): void;
export function loadImagesInParallel<T>(
  items: T[],
  getPath?: (item: T) => string,
): Promise<Array<{ item: T; img: HTMLImageElement | null; success: boolean }>>;
