import { describe, it, expect } from 'vitest';
import { evaluateConnectome, type DiagnosticContext } from '@/world/connectome-diagnostics';
import {
  evaluateContracts, invariantFromRule, registerContract, contractRegistry,
  type Contract,
} from '@/world/connectome-contracts';

/** Same minimal fakes the diagnostics test uses — graph rules read only map.roadGraph. */
function ctx(graph: unknown): DiagnosticContext {
  return {
    world: { query: () => [] } as unknown as DiagnosticContext['world'],
    map: { width: 8, height: 8, tiles: [], roadGraph: graph } as unknown as DiagnosticContext['map'],
  };
}
const node = (id: string, poiRef?: string) => ({ id, x: 0, y: 0, kind: poiRef ? 'poi' : 'waypoint', poiRef });
const edge = (id: string, a: string, b: string, feature = 'road') =>
  ({ id, a, b, feature, class: 'road', surface: 'dirt', polyline: [], bridgeCells: [] });

const key = (d: { rule: string; message: string; locus: unknown }) =>
  `${d.rule}|${d.message}|${JSON.stringify(d.locus)}`;

describe('connectome contracts — spine parity with the linter', () => {
  it('with no declarations, produces the SAME findings as evaluateConnectome (12 invariants)', () => {
    const graph = {
      nodes: [node('n:church', 'poi:church'), node('n:tavern', 'poi:tavern'), node('w:1')],
      edges: [edge('e:1', 'n:church', 'n:tavern'), edge('e:2', 'n:tavern', 'n:church'), edge('e:3', 'n:church', 'w:1')],
    };
    const lint = evaluateConnectome(ctx(graph));
    const contract = evaluateContracts(ctx(graph));
    // Same multiset of diagnostics (contracts stable-sorts, so compare as sets).
    expect(new Set(contract.diagnostics.map(key))).toEqual(new Set(lint.diagnostics.map(key)));
    expect(contract.total).toBe(lint.total);
    expect(contract.counts).toEqual(lint.counts);
    // All are world-level invariants; no requirements yet.
    expect(contract.byKind.invariant).toBe(contract.total);
    expect(contract.byKind.requirement).toBe(0);
    expect(contract.byLevel.world).toBe(contract.total);
    expect(contract.unmet).toHaveLength(0);
  });

  it('invariantFromRule wraps a rule as a world-level invariant', () => {
    const c = invariantFromRule({ id: 'x', severity: 'warn', description: 'd', evaluate: () => [] });
    expect(c.level).toBe('world');
    expect(c.kind).toBe('invariant');
  });
});

describe('connectome contracts — declared scoped contracts', () => {
  const violating: Contract = {
    id: 'test.always-unmet', level: 'settlement', kind: 'requirement', severity: 'error',
    description: 'a stub requirement that always fails for its scope',
    evaluate: (_ctx, scope) => [{
      rule: 'test.always-unmet', severity: 'error', message: 'unmet',
      locus: { pois: scope.poi ? [scope.poi] : [] },
      suggestedFix: { verb: 'noop', args: {} },
    }],
  };

  it('runs a declared contract at its scope and collects it under unmet', () => {
    registerContract(violating);
    const report = evaluateContracts(ctx({ nodes: [], edges: [] }), {
      declarations: [{ contract: 'test.always-unmet', scope: { poi: 'poi:town' } }],
    });
    const mine = report.diagnostics.filter((d) => d.rule === 'test.always-unmet');
    expect(mine).toHaveLength(1);
    expect(mine[0].locus.pois).toEqual(['poi:town']);
    expect(report.byKind.requirement).toBe(1);
    expect(report.byLevel.settlement).toBe(1);
    expect(report.unmet.map((d) => d.rule)).toContain('test.always-unmet');
  });

  it('registerContract is idempotent by id (last wins) and appears in the registry', () => {
    registerContract(violating);
    registerContract({ ...violating, description: 'updated' });
    expect(contractRegistry()['test.always-unmet'].description).toBe('updated');
  });

  it('an undeclared registered contract does NOT run (declaration-gated)', () => {
    const report = evaluateContracts(ctx({ nodes: [], edges: [] }));
    expect(report.diagnostics.some((d) => d.rule === 'test.always-unmet')).toBe(false);
  });

  it('a broken contract never crashes the evaluator', () => {
    registerContract({
      id: 'test.throws', level: 'site', kind: 'invariant', severity: 'info',
      description: 'throws', evaluate: () => { throw new Error('boom'); },
    });
    const report = evaluateContracts(ctx({ nodes: [], edges: [] }), {
      declarations: [{ contract: 'test.throws', scope: {} }],
    });
    expect(report.diagnostics.some((d) => d.rule === 'test.throws')).toBe(false);
  });
});
