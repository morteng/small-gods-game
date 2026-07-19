/// <reference types="vite/client" />

// Build-time flag (Vite `define`): true in the dev server and in `--mode devtools`
// builds, false in a plain distribution `vite build`. Guard every dev-only entry
// point (studio, debug globals) with `if (__DEV_TOOLS__)` so it tree-shakes out.
declare const __DEV_TOOLS__: boolean;

// Build-time build identity (Vite `define`): the package.json version and the short
// git SHA of the build. Surfaced in the settings UI footer for bug reports. `__GIT_SHA__`
// is 'unknown' when built with no git checkout and no VITE_GIT_SHA override.
declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;

declare module '*.css?raw' {
  const content: string;
  export default content;
}
