// SimEvent boundary guard (WP-C, 2026-07-04) — the story-pack-live-verbs lesson,
// one boundary over: events silently dying between producer and consumer.
//
// Asserts that EVERY variant of the `SimEvent` union (src/core/events.ts) has
//   1. at least one EMIT site — a `type: '<name>'` literal in the argument of an
//      `EventLog.append(...)` call somewhere in src/, and
//   2. at least one REAL consumer — a `case '<name>'`, an (in)equality comparison
//      against '<name>', or a type→meta map key — OR an explicit, dated entry in
//      the KNOWN_GENERIC_ONLY allowlist below (variants that intentionally feed
//      only generic surfaces: the raw event feed, Fate's default describeEvent
//      clause, the MCP `events()` query, dev tooling).
//
// History: the audit (docs/superpowers/2026-07-04-codebase-audit-synthesis.md)
// found a whole dead 'possession' event family (spirit_manifest, spirit_possess,
// spirit_unmanifest, spirit_gaze_shift) plus entity_emerged with ZERO emit sites
// and ZERO consumers — deleted in WP-C. This test keeps the boundary honest.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_DIR = join(__dirname, '..', '..', 'src');
const EVENTS_FILE = join(SRC_DIR, 'core', 'events.ts');

// ── allowlists (keep dated; the staleness check below forces pruning) ──────────

/** Variants with no emit site yet. MUST stay empty — a variant nobody can emit is
 *  dead weight; delete it or wire it before extending the union. */
const KNOWN_UNEMITTED: string[] = [];

/** Variants consumed ONLY by generic surfaces (raw event feed / Fate's default
 *  describeEvent clause / MCP `events()` / dev tools) — an audit-trail tier, not
 *  dead weight. Each entry documents WHY it stays. (2026-07-04, WP-C) */
const KNOWN_GENERIC_ONLY: Record<string, string> = {
  world_seeded:    'genesis marker — anchors the log; read by generic feeds only',
  spirit_birth:    'genesis marker for spirits; generic feeds only',
  // npc_spawn / authored_spawn / authored_remove / authored_place moved out
  // 2026-07-13: the cohort ledger (cohort-system.ts) reads them as lifecycle
  // flow explanations — a real consumer.
  authored_modify: 'Create-panel audit trail; generic feeds only',
  authored_move:   'Create-panel audit trail; generic feeds only',
  authored_climate:'Create-panel audit trail; generic feeds only',
  tile_collapsed:  'oracle/WFC realization trace; generic feeds only',
  system_error:    'diagnostic channel (LLM writeback etc.); generic feeds only',
};

// ── source scanning ─────────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Variant names, parsed from the SimEvent union in src/core/events.ts. */
function parseVariants(): string[] {
  const text = readFileSync(EVENTS_FILE, 'utf8');
  const start = text.indexOf('export type SimEvent =');
  expect(start).toBeGreaterThanOrEqual(0);
  const lines = text.slice(start).split('\n');
  const names: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s*(\||\/\/)/.test(line)) break; // union ends at the first non-`|` line
    const m = line.match(/\|\s*\{\s*type:\s*'(\w+)'/);
    if (m) names.push(m[1]);
  }
  return names;
}

interface Boundary { emits: Map<string, string[]>; consumers: Map<string, string[]> }

/** Scan src/ for emit sites (append-adjacent `type: 'x'`) and specific consumers. */
function scanBoundary(variants: string[]): Boundary {
  const emits = new Map<string, string[]>(variants.map(v => [v, []]));
  const consumers = new Map<string, string[]>(variants.map(v => [v, []]));

  for (const file of walk(SRC_DIR)) {
    if (file === EVENTS_FILE) continue;
    const text = readFileSync(file, 'utf8');
    const rel = relative(SRC_DIR, file);

    // Emit sites: a `type: '<v>'` literal in the argument text of `.append(`.
    // 300 chars covers every multi-line append literal in the codebase.
    for (let i = text.indexOf('.append('); i !== -1; i = text.indexOf('.append(', i + 1)) {
      const m = text.slice(i, i + 300).match(/type:\s*'(\w+)'/);
      if (m && emits.has(m[1])) emits.get(m[1])!.push(rel);
    }

    // Specific consumers: switch cases, (in)equality comparisons, type→meta map keys.
    for (const v of variants) {
      const patterns = [
        `case '${v}'`,
        `=== '${v}'`, `!== '${v}'`,
        `'${v}' ===`, `'${v}' !==`,
      ];
      if (patterns.some(p => text.includes(p))) { consumers.get(v)!.push(rel); continue; }
      // Type→meta map key (e.g. time-bar's TYPE_TO_GLYPH) — only counts in files
      // that demonstrably READ event types (`event.type`), to avoid same-named
      // property/verb noise (e.g. the capability registry's `summon_storm:` key).
      if (text.includes('event.type') && new RegExp(`^\\s*${v}:\\s`, 'm').test(text)) {
        consumers.get(v)!.push(rel);
      }
    }
  }
  return { emits, consumers };
}

// ── the guard ───────────────────────────────────────────────────────────────────

describe('SimEvent boundary — every variant is emitted and consumed', () => {
  const variants = parseVariants();
  const { emits, consumers } = scanBoundary(variants);

  it('parses a plausible variant set', () => {
    expect(variants.length).toBeGreaterThan(30);
    expect(variants).toContain('belief_cross');
    expect(variants).toContain('npc_death');
  });

  it('every variant has ≥1 emit site (or is explicitly allowlisted)', () => {
    const dead = variants.filter(v => emits.get(v)!.length === 0 && !KNOWN_UNEMITTED.includes(v));
    expect(dead, `SimEvent variants nothing ever emits: ${dead.join(', ')} — delete them or wire an emit site`).toEqual([]);
  });

  it('every variant has ≥1 specific consumer (or a documented generic-only entry)', () => {
    const unheard = variants.filter(v => consumers.get(v)!.length === 0 && !(v in KNOWN_GENERIC_ONLY));
    expect(unheard, `SimEvent variants nothing specifically consumes: ${unheard.join(', ')} — wire a consumer, delete the variant, or document it in KNOWN_GENERIC_ONLY`).toEqual([]);
  });

  it('allowlists stay minimal (no stale entries)', () => {
    const staleUnemitted = KNOWN_UNEMITTED.filter(v => !variants.includes(v) || emits.get(v)!.length > 0);
    expect(staleUnemitted, `KNOWN_UNEMITTED entries that are gone or now emitted: ${staleUnemitted.join(', ')}`).toEqual([]);
    const staleGeneric = Object.keys(KNOWN_GENERIC_ONLY)
      .filter(v => !variants.includes(v) || consumers.get(v)!.length > 0);
    expect(staleGeneric, `KNOWN_GENERIC_ONLY entries that are gone or now have a real consumer: ${staleGeneric.join(', ')}`).toEqual([]);
  });

  it('the dead possession family stays deleted', () => {
    for (const v of ['spirit_manifest', 'spirit_possess', 'spirit_unmanifest', 'spirit_gaze_shift', 'entity_emerged']) {
      expect(variants, `'${v}' was deleted as dead (2026-07-04); reintroduce it only WITH an emit site and a consumer`).not.toContain(v);
    }
  });
});
