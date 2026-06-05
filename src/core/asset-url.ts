/**
 * Resolve a public-asset path against Vite's configured `base` so static assets
 * load both at the dev root (`/`) and under a GitHub Pages project subpath
 * (`/small-gods-game/`).
 *
 * Vite's `base` rewrites bundled imports and the injected `<script>`/`<link>`
 * tags, but NOT runtime string fetches like `new Image().src = '/sprites/…'` or
 * `fetch('/data/…')`. Those root-absolute paths would 404 under a subpath, so
 * resolve them here instead.
 *
 * Leading slash on `path` is optional.
 *   assetUrl('/sprites/tiles/x.png') → '/small-gods-game/sprites/tiles/x.png'
 */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return base.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
}
