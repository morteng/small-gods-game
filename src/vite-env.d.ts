/// <reference types="vite/client" />

// Build-time flag (Vite `define`): true in the dev server and in `--mode devtools`
// builds, false in a plain distribution `vite build`. Guard every dev-only entry
// point (studio, debug globals) with `if (__DEV_TOOLS__)` so it tree-shakes out.
declare const __DEV_TOOLS__: boolean;

declare module '*.css?raw' {
  const content: string;
  export default content;
}
