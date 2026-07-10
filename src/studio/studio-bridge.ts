/**
 * Studio ↔ bus bridge — lets an out-of-process driver (the CLI, the MCP server)
 * pick objects, render, and screenshot the RUNNING Object studio, the same way
 * the game's `GameBus` is carried out over `?bridge`.
 *
 * The studio is not a `GameBus`, so this wraps the active Object-studio control
 * surface (`window.__studio`, registered via `setActiveStudioController`) in a
 * `BusLike` facade whose `query` map is the studio verb set. `main.ts` attaches
 * it with the shared `startBridgeClient` when a `?studio` tab is also opened with
 * `?bridge`. DEV ONLY (tree-shaken from prod alongside the rest of the studio).
 *
 * Mutating verbs (select/render/randomize) ride `query` — they only change what
 * the studio DISPLAYS, never any game state — so they work on a read-only bridge.
 * The one money-spending verb (`studio_render_paid`) is gated to `?bridge=rw`.
 */
import type { BusLike } from '@/dev/bus-bridge-protocol';

/** The Object-studio control surface the bridge drives. The studio's `__studio`
 *  debug object satisfies this structurally (see studio.ts `studioDebug`). */
export interface StudioController {
  /** All selectable subject presets (buildings + props + plants). */
  kinds(): string[];
  /** The current subject kind. */
  readonly kind: string;
  /** Switch subject; resolves once its geometry is warm + drawn. */
  setKind(kind: string): Promise<boolean>;
  /** setKind (optional) + return a PNG data-URI of the view pane. */
  render(kind?: string): Promise<string>;
  /** PNG data-URI of whatever the view pane currently shows. */
  grab(): string;
  /** Re-roll the subject's seeded params, then resolve once redrawn. */
  randomize(): Promise<boolean>;
  /** Show the finished textured sprite (vs grey massing) in the lit view. */
  setTextured(on: boolean): void;
  /** The live ResolvedBlueprint (deep clone). */
  rb(): unknown;
  /** The exact img2img prompt for the current subject. */
  prompt(): string;
  /** One PAID text-to-image REFERENCE regen of the current (or named) subject, written
   *  into the studio's reference library via the /__reflib dev sink. COSTS MONEY.
   *  Derives the TTI prompt from the resolved blueprint unless `prompt` is given. */
  regenReference?(kind?: string, slug?: string, model?: string, prompt?: string): Promise<unknown>;
  /** One PAID img2img render of the current (or named) subject. COSTS MONEY. */
  renderPaid?(kind?: string): Promise<unknown>;
}

let active: StudioController | null = null;
/** The Object studio calls this on mount (and with null on dispose). */
export function setActiveStudioController(c: StudioController | null): void { active = c; }
export function getActiveStudioController(): StudioController | null { return active; }

/** Build the `BusLike` (+ subscribe) facade the bridge client dispatches against. */
export function makeStudioBus(
  allowWrite: boolean,
): BusLike & { subscribe(fn: (e: unknown) => void): () => void } {
  const need = (): StudioController => {
    const c = active;
    if (!c) throw new Error('no active Object studio (open ?studio=<kind>&bridge)');
    return c;
  };
  const query: Record<string, (...args: unknown[]) => unknown> = {
    studio_kinds: () => need().kinds(),
    studio_state: () => ({ kind: need().kind }),
    studio_rb: () => need().rb(),
    studio_prompt: () => need().prompt(),
    // Reuse the existing MCP `screenshot` tool: it calls query('screenshot').
    screenshot: () => need().grab(),
    studio_select: async (kind: unknown) => { const c = need(); await c.setKind(String(kind)); return c.grab(); },
    studio_render: async (kind?: unknown, textured?: unknown) => {
      const c = need();
      if (typeof textured === 'boolean') c.setTextured(textured);
      return c.render(kind == null ? undefined : String(kind));
    },
    studio_randomize: async () => { const c = need(); await c.randomize(); return c.grab(); },
    studio_render_paid: async (kind?: unknown) => {
      if (!allowWrite) throw new Error('paid studio render requires ?bridge=rw (it SPENDS money)');
      const c = need();
      if (!c.renderPaid) throw new Error('renderPaid is unavailable on this studio');
      return c.renderPaid(kind == null ? undefined : String(kind));
    },
    studio_regen_reference: async (kind?: unknown, slug?: unknown, model?: unknown, prompt?: unknown) => {
      if (!allowWrite) throw new Error('reference regen requires ?bridge=rw (it SPENDS money)');
      const c = need();
      if (!c.regenReference) throw new Error('regenReference is unavailable on this studio');
      return c.regenReference(
        kind == null ? undefined : String(kind),
        slug == null ? undefined : String(slug),
        model == null ? undefined : String(model),
        prompt == null ? undefined : String(prompt),
      );
    },
  };
  return {
    query,
    capabilities: () => ({ studio: Object.keys(query) }),
    preview: () => null,
    emit: () => { throw new Error('the studio bridge exposes query fns, not emit'); },
    subscribe: () => () => {},   // the studio has no event stream
  };
}
