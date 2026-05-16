import type { Entity, BrushContext, Region } from '@/core/types';

export type BrushFn = (region: Region, seed: number, ctx: BrushContext) => Entity[];

const brushes = new Map<string, BrushFn>();

export function registerBrush(name: string, fn: BrushFn): void {
  const existing = brushes.get(name);
  if (existing === fn) return;                       // idempotent for identical fn
  if (existing) throw new Error(`Brush already registered: ${name}`);
  brushes.set(name, fn);
}

export function getBrush(name: string): BrushFn {
  const fn = brushes.get(name);
  if (!fn) throw new Error(`Unknown brush: ${name}`);
  return fn;
}

export function listBrushes(): string[] {
  return [...brushes.keys()];
}

/** Test-only — never call from production code. */
export function _resetBrushesForTesting(): void {
  brushes.clear();
}
