// src/world/connectome/crossing-builder.ts
//
// The river-crossing PRODUCER (pure logic half) — turns a crossing's parameters into a
// `WorldNode` sub-connectome. Same machinery, wildly different sites: a poor footpath over a
// stream yields a bare log footbridge and nothing else; a rich late-medieval trunk road over
// a river yields a multi-arch stone bridge that CARRIES shops, with a gatehouse, and aprons
// bearing a toll booth, a guard post, a threshold shrine, and a watermill that serves the
// crossing. Every decision is deterministic and driven by era × prosperity × road class ×
// span — "all the relevant parameters" — so the connectome alone says what gets realized.
//
// This is the pure rule layer; detecting WHERE a road meets water (road-graph × hydrology)
// and REALIZING the nodes (kind → generator) are separate layers that consume this.

import { node, type WorldNode } from './world-node';

/** What a detected road×water crossing hands the producer. */
export interface CrossingSpec {
  id: string;
  /** The hydrology feature the bridge spans (reach/strait id). */
  waterRef: string;
  /** Bank-to-bank distance in tiles. */
  spanTiles: number;
  /** Busier feeding road's class — the traffic the crossing must carry. */
  roadClass: 'path' | 'track' | 'road' | 'highway';
  era: string;
  prosperity: string;
  style?: string;
  biome?: string;
  /** Optional bank anchors [near, far] for placement. */
  banks?: [{ x: number; y: number }, { x: number; y: number }];
}

// Ordinal ranks for the open-vocabulary params (unknown → a sensible middle/low).
const ERA_RANK: Record<string, number> = { 'stone-age': 0, neolithic: 0, iron: 1, 'early-medieval': 2, medieval: 2, 'late-medieval': 3, renaissance: 3 };
const PROSPERITY_RANK: Record<string, number> = { destitute: 0, poor: 0, modest: 1, comfortable: 1, rich: 2, opulent: 3 };
const ROAD_RANK: Record<CrossingSpec['roadClass'], number> = { path: 0, track: 1, road: 2, highway: 3 };

const eraRank = (e: string) => ERA_RANK[e] ?? 1;
const prosRank = (p: string) => PROSPERITY_RANK[p] ?? 1;

/** Deck width in tiles by road class — what traffic the span must carry. */
const DECK_WIDTH: Record<CrossingSpec['roadClass'], number> = { path: 0.5, track: 0.7, road: 1.0, highway: 1.4 };

/**
 * Build the crossing sub-connectome for a spec. Pure: returns a fresh `WorldNode` tree whose
 * site params (era/prosperity/style/biome) sit on the root and cascade to every child.
 */
export function buildCrossing(spec: CrossingSpec): WorldNode {
  const era = eraRank(spec.era);
  const pros = prosRank(spec.prosperity);
  const importance = ROAD_RANK[spec.roadClass]; // 0 footpath … 3 highway
  const deckWidth = DECK_WIDTH[spec.roadClass];
  const id = spec.id;

  // ── The span: material & form from era × prosperity, sized to the gap ──
  const span = Math.max(1, Math.round(spec.spanTiles));
  let bridge: WorldNode;
  if (era >= 2 && pros >= 1 && importance >= 1) {
    // Dressed-stone arched bridge — one arch per ~3 tiles of span.
    const arches = Math.max(1, Math.ceil(span / 3));
    const deck = node(`${id}/deck`, 'deck', { params: { material: 'dressed-stone', width: deckWidth } });
    // Inhabited deck (Ponte Vecchio): only a busy, wealthy, long-enough span earns shops.
    if (importance >= 3 && pros >= 2 && span >= 6) {
      deck.children.push(node(`${id}/shop#a`, 'building(shop)', { params: { on: 'deck' } }));
      deck.children.push(node(`${id}/shop#b`, 'building(shop)', { params: { on: 'deck' } }));
    }
    const children: WorldNode[] = [deck];
    for (let i = 0; i < arches + 1; i++) children.push(node(`${id}/pier#${i}`, 'pier', { params: { material: 'masonry' } }));
    // One masonry arch per bay between the piers — the spans the deck rides on. They pop out of
    // the connectome as nodes (realized between consecutive piers), not synthesized at draw time.
    for (let i = 0; i < arches; i++) children.push(node(`${id}/arch#${i}`, 'arch_span', { params: { material: 'dressed-stone' } }));
    // A fortified, important crossing gates the deck.
    if (importance >= 3 && pros >= 1) children.push(node(`${id}/gate`, 'building(gatehouse)', { params: { fortified: true, at: 'deck-end' } }));
    bridge = node(`${id}/bridge`, 'bridge', { params: { material: 'dressed-stone', span, arches, width: deckWidth }, children });
  } else if (era >= 1 || pros >= 1) {
    // Timber trestle — piers every ~2 tiles.
    const piers = Math.max(2, Math.ceil(span / 2));
    const children = [node(`${id}/deck`, 'deck', { params: { material: 'timber', width: deckWidth } })];
    for (let i = 0; i < piers; i++) children.push(node(`${id}/pier#${i}`, 'pier', { params: { material: 'timber' } }));
    bridge = node(`${id}/bridge`, 'bridge', { params: { material: 'timber', span, width: deckWidth }, children });
  } else {
    // Bare log-and-plank footbridge — two piers, no frills.
    bridge = node(`${id}/bridge`, 'bridge', {
      params: { material: 'log-plank', span, width: deckWidth },
      children: [
        node(`${id}/deck`, 'deck', { params: { material: 'log-plank', width: deckWidth } }),
        node(`${id}/pier#0`, 'pier', { params: { material: 'timber' } }),
        node(`${id}/pier#1`, 'pier', { params: { material: 'timber' } }),
      ],
    });
  }

  // ── The two bank aprons + their ancillary structures, sited by need × prosperity ──
  const apronN = node(`${id}/apron#N`, 'apron', { params: { side: 'near' }, anchor: spec.banks?.[0] });
  const apronS = node(`${id}/apron#S`, 'apron', { params: { side: 'far' }, anchor: spec.banks?.[1] });
  // Toll: worth levying on a real road through a settled economy.
  if (importance >= 2 && pros >= 1) apronN.children.push(node(`${id}/toll`, 'building(toll_booth)'));
  // Guard: a strategic crossing is controlled.
  if (importance >= 3) apronN.children.push(node(`${id}/guard`, 'building(guard_post)'));
  // Shrine: thresholds attract devotion (belief hook) — once there's surplus to build one.
  if (pros >= 1 && importance >= 1) apronS.children.push(node(`${id}/shrine`, 'building(shrine)', { params: { at: 'threshold' } }));

  const children: WorldNode[] = [bridge, apronN, apronS];
  // Watermill: a prosperous, technologically able crossing harnesses the race it spans.
  if (pros >= 2 && era >= 2) {
    children.push(node(`${id}/mill`, 'building(watermill)', {
      relations: [{ kind: 'serves', to: id }, { kind: 'spans', to: spec.waterRef }],
    }));
  }

  return node(id, 'crossing', {
    params: {
      era: spec.era, prosperity: spec.prosperity,
      ...(spec.style ? { style: spec.style } : {}),
      ...(spec.biome ? { biome: spec.biome } : {}),
      importance,
    },
    relations: [{ kind: 'spans', to: spec.waterRef }],
    children,
  });
}
