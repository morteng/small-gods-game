// src/blueprint/descriptors.ts
// Turn qualitative descriptors (wealth / quality / condition / style) into a
// BlueprintPatch that BIASES the resolve — so "a rich opulent house" and "a poor
// hovel" of the same type produce visibly different geometry/materials, and the
// descriptors ride along in the resolved blueprint (recorded + folded into the
// art-cache key). See docs/superpowers/specs/2026-06-14-asset-catalogue-variant-
// lifecycle-design.md §3a.
import type { Blueprint, BlueprintPatch, Descriptors, Part, Feature, Wealth, Quality, Condition } from './types';

// Closed vocabularies (ordered low→high) — also what the catalogue/UI enumerate.
export const WEALTH_LEVELS: Wealth[] = ['destitute', 'poor', 'modest', 'comfortable', 'rich', 'opulent'];
export const QUALITY_LEVELS: Quality[] = ['crude', 'plain', 'fine', 'ornate'];
export const CONDITION_LEVELS: Condition[] = ['pristine', 'lived_in', 'worn', 'dilapidated'];

// Material tiers per role, poorest→richest. Wealth shifts the base material along
// its ladder; a material not on a ladder (hide, log specialty) is left untouched.
const LADDERS: Record<string, string[]> = {
  walls: ['mud', 'wattle', 'timber', 'brick', 'stone'],
  roof: ['thatch', 'wood', 'shingle', 'tile', 'slate'],
  ground: ['dirt', 'packed_dirt', 'gravel', 'cobble', 'flagstone'],
};

// Wealth → signed ladder offset from the preset's baseline material.
const WEALTH_OFFSET: Record<Wealth, number> = {
  destitute: -2, poor: -1, modest: 0, comfortable: 1, rich: 2, opulent: 3,
};
const wealthRank = (w: Wealth): number => WEALTH_LEVELS.indexOf(w);

/** Build the patch a set of descriptors implies for `base`. Pure; deterministic. */
export function descriptorPatch(base: Blueprint, d: Descriptors): BlueprintPatch {
  const patch: BlueprintPatch = { descriptors: d };

  // ── materials: shift each role along its ladder by the wealth offset ──
  if (d.wealth && WEALTH_OFFSET[d.wealth] !== 0) {
    const off = WEALTH_OFFSET[d.wealth];
    const materials: Record<string, string> = {};
    for (const [role, ladder] of Object.entries(LADDERS)) {
      const cur = base.materials?.[role];
      if (!cur) continue;
      const i = ladder.indexOf(cur);
      if (i < 0) continue;                                   // off-ladder ⇒ leave as-is
      const j = Math.max(0, Math.min(ladder.length - 1, i + off));
      if (j !== i) materials[role] = ladder[j];
    }
    if (Object.keys(materials).length) patch.materials = materials;
  }

  // ── per-part tweaks: window glazing/style + an extra storey for opulence ──
  const glazed = d.wealth ? wealthRank(d.wealth) >= wealthRank('comfortable') : false;
  const crude = d.quality === 'crude';
  const ornate = d.quality === 'ornate';
  const parts: Record<string, Part> = {};
  for (const [pid, part] of Object.entries(base.parts)) {
    const partPatch: Part = { type: part.type };   // type carried; merge overlays the rest
    let touched = false;

    const feats: Record<string, Feature> = {};
    for (const [fid, f] of Object.entries(part.features ?? {})) {
      if (f.type !== 'window') continue;
      const wp: Record<string, unknown> = {};
      if (crude) wp.glazed = false;
      else if (glazed) wp.glazed = true;
      if (ornate) wp.style = 'arched';
      // Feature merge is wholesale (mergePart replaces by id), so carry the
      // original feature + overlay the param overrides.
      if (Object.keys(wp).length) feats[fid] = { ...f, params: { ...f.params, ...wp } };
    }
    if (Object.keys(feats).length) { partPatch.features = feats; touched = true; }

    // Opulent dwellings gain a storey (the densest, tallest house on the street).
    if (d.wealth === 'opulent' && part.type === 'body') {
      const lv = (part.params?.levels as number) ?? 1;
      partPatch.params = { ...partPatch.params, levels: Math.min(3, lv + 1) };
      touched = true;
    }

    if (touched) parts[pid] = partPatch;
  }
  if (Object.keys(parts).length) patch.parts = parts;

  return patch;
}

/** A short, prompt-ready phrase for the descriptors (e.g. "a rich, ornately-built").
 *  Empty string when no descriptors are set. Fed to the img2img prompt so the
 *  painted art matches the geometry bias. */
export function descriptorPhrase(d: Descriptors | undefined): string {
  if (!d) return '';
  const QUALITY_WORD: Record<Quality, string> = { crude: 'crudely-built', plain: 'plain', fine: 'finely-built', ornate: 'ornately-decorated' };
  const COND_WORD: Record<Condition, string> = { pristine: 'pristine', lived_in: 'lived-in', worn: 'weathered', dilapidated: 'run-down' };
  const words: string[] = [];
  if (d.wealth) words.push(d.wealth);
  if (d.quality) words.push(QUALITY_WORD[d.quality]);
  if (d.condition) words.push(COND_WORD[d.condition]);
  if (d.style) words.push(d.style);
  return words.join(', ');
}
