/**
 * The ONE sanctioned seam where the engine references built-in content. Everything
 * else in `src/catalogue/` (and `src/blueprint/connectome/`) is content-free; this
 * module — explicitly NOT covered by the engine-purity guard — bundles the default
 * packs and loads them into the live singleton. Swap/extend the list to ship a
 * different default world.
 */
import { registerPack } from '@/catalogue/pack';
import { medievalEuropePack } from '@/catalogue/packs/medieval-europe';

let defaultsLoaded = false;

/** Load the built-in content packs into the default catalogue singleton. Idempotent. */
export function loadDefaultPacks(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;
  registerPack(medievalEuropePack);
}
