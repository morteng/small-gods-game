/**
 * Reality decider for tiles being realized. Spec A ships the identity oracle:
 * whatever the substrate (WFC) said the tile should be is what it becomes.
 * The future Oracle spec replaces this with a narrative-driven decider.
 */
export interface Oracle {
  realizeTile(x: number, y: number, substrateType: string): { type: string; by: 'wfc' | 'oracle' };
}

export const identityOracle: Oracle = {
  realizeTile(_x, _y, substrateType) {
    return { type: substrateType, by: 'wfc' };
  },
};
