// src/world/earthwork-deformation.ts
//
// Earthworks → terrain CARVE/RAISE. A defended complex (motte-and-bailey, ringwork) is
// the connectome's terrain OUTPUT: `deriveEarthworks` (blueprint/connectome/earthworks.ts)
// sizes a motte / rampart / ditch around a site with conservation of spoil, in WORLD
// coords. This producer is the thin adapter that commits those primitives to the shared
// `DeformationStore` — the same `heightAt = base ⊕ deformations` channel roads, pads and
// wall footings already write — so the motte actually rises and the ditch actually cuts.
//
// Each Earthwork maps 1:1 onto an existing engine brush (the brushes and the earthwork
// model were designed together — same `topRadius`/`height`/`slope` vocabulary):
//   * motte   → frustumDeformation (op 'raise')    — flat-topped cone, batter sides
//   * rampart → annulusDeformation (op 'add')       — annular bank under the palisade
//   * ditch   → annulusDeformation (op 'carve')     — annular cut, depth from spoil balance
//
// Determinism & purity: a pure function of the Earthwork[] (themselves a pure function of
// site + spec + terrain probe). No content ids. Priorities sit ABOVE roads (30) / pads
// (25) / wall footings (20): a motte dominates the ground it occupies, then its own
// palisade footing (priority 20) levels a seat on the new mound.

import type { Earthwork } from '@/blueprint/connectome/earthworks';
import {
  frustumDeformation, annulusDeformation, type Deformation,
} from '@/world/terrain-deformation';

/** Motte uplift composes above pads/roads (it IS the ground here). */
const MOTTE_PRIORITY = 50;
/** Rampart bank rides on top of the motte/natural grade. */
const RAMPART_PRIORITY = 60;
/** Ditch cut wins last — a moat reads even where a bank abuts it. */
const DITCH_PRIORITY = 70;

/**
 * Pure: the Earthwork[] a sited complex implies → the heightfield deformations that
 * realise them. A motte with no centre, or a ring earthwork with no ring, is skipped
 * (defensive — `deriveEarthworks` always supplies them). `idPrefix` namespaces the ids
 * so multiple complexes on one map don't collide.
 */
export function buildEarthworkDeformations(earthworks: Earthwork[], idPrefix = 'earthwork'): Deformation[] {
  const out: Deformation[] = [];
  earthworks.forEach((e, i) => {
    const id = `${idPrefix}:${e.kind}:${i}`;
    if (e.kind === 'motte') {
      if (!e.centre || e.topRadius == null) return;
      out.push(frustumDeformation({
        id, source: 'earthwork:motte', priority: MOTTE_PRIORITY,
        cx: e.centre.x, cy: e.centre.y, topRadius: e.topRadius, height: e.height, slope: e.slope ?? 1.5,
      }));
      return;
    }
    if (!e.ring) return;
    // Rampart fills (height ≥ 0 → op 'add', raises), ditch cuts (height < 0 → op 'carve').
    // Both ops take a POSITIVE magnitude: 'add' adds it, 'carve' subtracts it (base − amt);
    // the op, not the sign, carries the direction. So pass |height| and let op disambiguate.
    const isCut = e.height < 0;
    out.push(annulusDeformation({
      id, source: `earthwork:${e.kind}`, priority: isCut ? DITCH_PRIORITY : RAMPART_PRIORITY,
      cx: e.ring.cx, cy: e.ring.cy, r: e.ring.r, width: e.ring.width,
      amount: Math.abs(e.height), op: isCut ? 'carve' : 'add',
    }));
  });
  return out;
}
