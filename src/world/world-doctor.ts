// src/world/world-doctor.ts
//
// The WORLD DOCTOR — offline, per-POI ground truth for an authored world seed.
// This is the feedback half of the agent world-authoring loop: an author (human,
// Fate, or an MCP client) writes seed JSON, the doctor answers "what did my seed
// ACTUALLY build?" — where each POI landed after island layout, how tall/wide its
// terrain expression really is (metres, tiles), the biome under it, whether the
// settlement got buildings — plus COMPLAINTS (severity + rule + suggestedFix) for
// the silent failure modes: a POI drowned in the sea, a ponded volcano crater,
// trees on a cinder cone, a settlement that produced no buildings, a region
// biome that never took.
//
// Consumed by `scripts/probe-world.ts` (CLI) and the MCP `lint_seed` tool.
import { validateWorldSeed } from '@/core/schema';
import { planWorldLayout } from '@/world/poi-layout';
import { generateWithNoise } from '@/map/map-generator';
import { generateTerrainFields } from '@/terrain/terrain-generator';
import { classifyBiomes } from '@/terrain/terrain-generator';
import { erodeElevation } from '@/terrain/erosion';
import { applyPoiInfluences, POI_INFLUENCES, SIZE_SCALE, FIELD_INERT_POI_TYPES } from '@/terrain/poi-influence';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec } from '@/terrain/terrain-shape';
import { worldStyleOf } from '@/core/world-style';
import type { WorldSeed, TerrainConfig, POI } from '@/core/types';

export interface DoctorComplaint {
  severity: 'error' | 'warn' | 'info';
  rule: string;
  poi?: string;
  message: string;
  suggestedFix?: string;
}

export interface DoctorPoiReport {
  id: string;
  type: string;
  size?: string;
  authored?: { x: number; y: number };
  laidOut?: { x: number; y: number };
  metrics: Record<string, number | string | boolean>;
}

export interface DoctorReport {
  worldName: string;
  genSeed: number;
  authoredSize: { width: number; height: number };
  laidOutSize: { width: number; height: number };
  layoutShifted: boolean;
  reliefM: number;
  pois: DoctorPoiReport[];
  complaints: DoctorComplaint[];
}

const SEA = 0.35;
/** Land types that would be a bug if their anchor tile is open water. Water-adjacent
 *  types (lake/port/cove/…) and coast-snapped types are exempt. */
const WATER_OK = new Set(['lake', 'port', 'cove', 'sea_stacks', 'cliffs', 'headland', 'bridge', 'swamp']);
const SETTLEMENT_TYPES = new Set(['village', 'city', 'castle', 'temple', 'farm', 'tavern', 'tower', 'mine']);
const SUMMIT_TYPES = new Set(['mountain', 'volcano', 'glacier']);
/** What biome family a region-fill POI is trying to paint. */
const REGION_EXPECT: Record<string, string[]> = {
  forest: ['temperate_forest', 'boreal_forest', 'tropical_forest', 'sacred_grove'],
  swamp: ['swamp'],
  desert: ['desert'],
  plains: ['temperate_grassland', 'tropical_grassland', 'savanna', 'tundra'],
  oasis: ['temperate_grassland', 'tropical_grassland', 'savanna', 'temperate_forest', 'tropical_forest'],
};

function radiusOf(poi: POI): number {
  const spec = POI_INFLUENCES[poi.type];
  const base = spec?.elevation?.radius ?? spec?.moisture?.radius ?? spec?.temperature?.radius ?? 10;
  return base * (SIZE_SCALE[poi.size ?? 'medium'] ?? 1);
}

/** Run the full doctor: schema pass → layout → field pass → full gen → per-POI checks. */
export async function diagnoseWorldSeed(ws: WorldSeed, genSeed = 12345): Promise<DoctorReport> {
  const complaints: DoctorComplaint[] = [];

  // 1. Schema pass (structure + dead fields).
  const v = validateWorldSeed(ws);
  for (const e of v.errors) complaints.push({ severity: 'error', rule: 'seed.schema', message: e });
  for (const wmsg of v.warnings) complaints.push({ severity: 'warn', rule: 'seed.schema', message: wmsg });

  // 2. Layout pass — island seeds grow + shift; report the delta so authored
  //    coordinates can be mapped to what the player (and every probe) sees.
  const layout = planWorldLayout(ws);
  const W = layout.size.width, H = layout.size.height;
  const shifted = layout.pois.some((p, i) => !!p.position && !!ws.pois[i]?.position
    && (p.position.x !== ws.pois[i].position!.x || p.position.y !== ws.pois[i].position!.y));
  const authoredOf = new Map(ws.pois.map((p) => [p.id, p.position]));
  const laidOut: WorldSeed = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };
  const relief = worldStyleOf(ws).mountainRelief;

  // 3. Field pass (elevation in real metres — the full gen path discards fields).
  const maxDim = Math.max(W, H);
  const cfg: TerrainConfig = {
    seed: genSeed, width: W, height: H,
    elevationScale: 6.0 / maxDim, moistureScale: 8.0 / maxDim,
    seaLevel: SEA, poleFalloff: true, continentWarp: 2.0,
    island: styledIslandSpec(laidOut) ?? undefined, shape: styledShapeSpec(laidOut), reliefM: relief,
  };
  const fields = generateTerrainFields(cfg);
  fields.elevation = erodeElevation(fields.elevation, W, H, { seed: genSeed });
  applyPoiInfluences(fields, layout.pois, cfg);
  const bm = classifyBiomes(fields, cfg);
  const elev = fields.elevation;
  const mAt = (x: number, y: number): number => (elev[y * W + x] - SEA) * relief;

  // 4. Full gen (tiles + entities — settlements, vegetation, ponded water).
  const { map, world } = await generateWithNoise(W, H, genSeed, laidOut);

  const waterTile = (x: number, y: number): boolean => {
    const t = map.tiles[y]?.[x]?.type ?? '';
    return t.includes('water') || t === 'river' || t === 'ocean';
  };

  // 5. Per-POI ground truth.
  const reports: DoctorPoiReport[] = [];
  for (const poi of layout.pois) {
    const rep: DoctorPoiReport = {
      id: poi.id, type: poi.type, size: poi.size,
      authored: authoredOf.get(poi.id) ?? undefined,
      laidOut: poi.position ? { ...poi.position } : undefined,
      metrics: {},
    };
    const p = poi.position;
    const R = Math.round(radiusOf(poi));
    rep.metrics.radiusTiles = R;

    if (!POI_INFLUENCES[poi.type]) {
      complaints.push({
        severity: 'info', rule: 'poi.no-terrain-influence', poi: poi.id,
        message: `type "${poi.type}" registers no terrain influence — expressed only by placement recipes (if any)`,
      });
    } else if (FIELD_INERT_POI_TYPES.includes(poi.type) && !SETTLEMENT_TYPES.has(poi.type)) {
      rep.metrics.terrainInert = true;
    }

    if (p) {
      const x = Math.round(p.x), y = Math.round(p.y);
      if (x >= 0 && y >= 0 && x < W && y < H) {
        rep.metrics.biomeAtAnchor = bm.biomes[y * W + x];
        rep.metrics.heightM = Number(mAt(x, y).toFixed(1));

        // Drowned POI — the classic silent failure.
        if (!WATER_OK.has(poi.type) && waterTile(x, y)) {
          complaints.push({
            severity: 'error', rule: 'poi.in-water', poi: poi.id,
            message: `${poi.type} "${poi.id}" anchor (${x},${y}) is open water (${map.tiles[y][x].type})`,
            suggestedFix: 'move the position onto land, or use a coast anchor if it is a shore feature',
          });
        }

        // Summit types: measure the real apex (height + footprint + cap biome).
        if (SUMMIT_TYPES.has(poi.type)) {
          // Apex WITHIN the feature's own radius — a wider search would grab a
          // neighbouring ridge and report someone else's summit.
          let apex = -Infinity, ax = x, ay = y;
          let footprint = 0;
          for (let yy = Math.max(0, y - R * 2); yy < Math.min(H, y + R * 2); yy++) {
            for (let xx = Math.max(0, x - R * 2); xx < Math.min(W, x + R * 2); xx++) {
              const d = Math.hypot(xx - x, yy - y);
              const m = mAt(xx, yy);
              if (d <= R && m > apex) { apex = m; ax = xx; ay = yy; }
              if (d <= R * 2 && m > 4) footprint++;
            }
          }
          rep.metrics.apexM = Number(apex.toFixed(1));
          rep.metrics.apexBiome = bm.biomes[ay * W + ax];
          rep.metrics.footprintTiles = footprint;

          if (poi.type === 'volcano') {
            if (rep.metrics.apexBiome === 'ice' || rep.metrics.apexBiome === 'peak') {
              complaints.push({
                severity: 'warn', rule: 'volcano.snow-capped', poi: poi.id,
                message: `volcano apex classifies as ${rep.metrics.apexBiome} — reads as an alpine mountain, not a cinder cone`,
                suggestedFix: 'raise the volcano temperature delta / lower the summit',
              });
            }
            // Ponded crater: water tiles in the crater bowl.
            let pond = 0;
            const cr = Math.max(2, Math.round(R * 0.25));
            for (let yy = Math.max(0, ay - cr); yy < Math.min(H, ay + cr); yy++)
              for (let xx = Math.max(0, ax - cr); xx < Math.min(W, ax + cr); xx++)
                if (waterTile(xx, yy)) pond++;
            rep.metrics.craterPondTiles = pond;
            if (pond > 0) {
              complaints.push({
                severity: 'warn', rule: 'volcano.crater-ponded', poi: poi.id,
                message: `${pond} water tile(s) in the summit crater — the bowl dipped below the local water table`,
                suggestedFix: 'shallower crater (or keep it: a crater lake, if that is the intent)',
              });
            }
            // Vegetation on the cone: trees have no business on fresh ash.
            const cone = world.query({}).filter((e) =>
              Math.hypot(e.x - x, e.y - y) <= R * 0.8
              && (e.kind.includes('oak') || e.kind.includes('pine') || e.kind.includes('birch')
                || e.kind.includes('beech') || e.kind.includes('spruce') || e.kind.includes('ash')
                || e.kind.includes('lime') || e.kind === 'tree'));
            rep.metrics.treesOnCone = cone.length;
            if (cone.length > 3) {
              complaints.push({
                severity: 'warn', rule: 'volcano.vegetated', poi: poi.id,
                message: `${cone.length} trees on the cone within r=${(R * 0.8).toFixed(0)} — active volcano flanks should be bare`,
                suggestedFix: 'dry the cone (moisture target ~0) so forest brushes skip it',
              });
            }
          }
        }

        // Settlements: did buildings actually appear? Owned by poiId first,
        // else within radius of the anchor.
        if (SETTLEMENT_TYPES.has(poi.type)) {
          const nearby = (map.buildings ?? []).filter((b) =>
            b.poiId === poi.id || Math.hypot(b.tileX - x, b.tileY - y) <= Math.max(R * 2, 24));
          rep.metrics.buildings = nearby.length;
          if (nearby.length === 0) {
            complaints.push({
              severity: 'error', rule: 'settlement.unbuilt', poi: poi.id,
              message: `${poi.type} "${poi.id}" produced no buildings within ${Math.max(R * 2, 24)} tiles`,
              suggestedFix: 'check the anchor is on buildable land (not water/steep slope)',
            });
          }
        }

        // Lakes: did water actually form?
        if (poi.type === 'lake') {
          let wet = 0;
          for (let yy = Math.max(0, y - R); yy < Math.min(H, y + R); yy++)
            for (let xx = Math.max(0, x - R); xx < Math.min(W, x + R); xx++)
              if (waterTile(xx, yy)) wet++;
          rep.metrics.waterTiles = wet;
          if (wet === 0) {
            complaints.push({
              severity: 'warn', rule: 'lake.dry', poi: poi.id,
              message: `lake "${poi.id}" formed no water within r=${R} — the basin could not pond here`,
              suggestedFix: 'move it to flatter/lower ground, or enlarge it',
            });
          }
        }
      }
    }

    // Region-fill types: how much of the box actually became the intended biome?
    if (poi.region && REGION_EXPECT[poi.type]) {
      const r = poi.region;
      const want = new Set(REGION_EXPECT[poi.type]);
      let hit = 0, land = 0;
      for (let yy = Math.max(0, r.y_min); yy <= Math.min(H - 1, r.y_max); yy++) {
        for (let xx = Math.max(0, r.x_min); xx <= Math.min(W - 1, r.x_max); xx++) {
          const b = bm.biomes[yy * W + xx];
          if (b === 'ocean' || b === 'deep_ocean') continue;
          land++;
          if (want.has(b)) hit++;
        }
      }
      const frac = land ? hit / land : 0;
      rep.metrics.regionLandTiles = land;
      rep.metrics.regionBiomeFrac = Number(frac.toFixed(2));
      if (land > 0 && frac < 0.3) {
        complaints.push({
          severity: 'warn', rule: 'region.biome-untaken', poi: poi.id,
          message: `${poi.type} region "${poi.id}" only ${(frac * 100).toFixed(0)}% ${poi.type}-family biome — the climate push did not clear the threshold`,
          suggestedFix: 'shrink the region, strengthen the influence, or accept the mix',
        });
      }
    }

    reports.push(rep);
  }

  return {
    worldName: ws.name,
    genSeed,
    authoredSize: ws.size,
    laidOutSize: layout.size,
    layoutShifted: shifted,
    reliefM: relief,
    pois: reports,
    complaints,
  };
}

/** Render a DoctorReport as the human-readable CLI text. */
export function formatDoctorReport(r: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`world doctor — ${r.worldName} (gen seed ${r.genSeed})`);
  lines.push(`  authored ${r.authoredSize.width}x${r.authoredSize.height} → laid out ${r.laidOutSize.width}x${r.laidOutSize.height}${r.layoutShifted ? '  (island layout SHIFTED poi coordinates)' : ''}  relief ${r.reliefM}m`);
  lines.push('');
  lines.push(`POIs (${r.pois.length}):`);
  for (const p of r.pois) {
    const pos = p.laidOut ? `@ (${p.laidOut.x},${p.laidOut.y})` : '(region)';
    const met = Object.entries(p.metrics).map(([k, val]) => `${k}=${val}`).join('  ');
    lines.push(`  ${p.id} [${p.type}${p.size ? ` ${p.size}` : ''}] ${pos}  ${met}`);
  }
  const sev = { error: '✘', warn: '▲', info: '·' } as const;
  if (r.complaints.length) {
    lines.push('');
    lines.push(`Complaints (${r.complaints.length}):`);
    for (const c of r.complaints) {
      lines.push(`  ${sev[c.severity]} ${c.rule}${c.poi ? ` [${c.poi}]` : ''}: ${c.message}`);
      if (c.suggestedFix) lines.push(`      fix: ${c.suggestedFix}`);
    }
  } else {
    lines.push('');
    lines.push('✓ no complaints');
  }
  const errs = r.complaints.filter((c) => c.severity === 'error').length;
  lines.push('');
  lines.push(errs ? `FAIL: ${errs} error(s)` : 'PASS');
  return lines.join('\n');
}
