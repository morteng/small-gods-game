/**
 * WFC Solver
 *
 * Orchestrates the Wave Function Collapse algorithm.
 * Handles entropy selection, collapse, and backtracking.
 */

class Solver {
  /**
   * @param {Grid} grid - The WFC grid
   * @param {Propagator} propagator - The constraint propagator
   * @param {Object} options - Solver options
   */
  constructor(grid, propagator, options = {}) {
    this.grid = grid;
    this.propagator = propagator;
    this.options = {
      maxBacktracks: options.maxBacktracks || 100,
      seed: options.seed || Date.now(),
      onProgress: options.onProgress || null,
      onBacktrack: options.onBacktrack || null
    };

    // Seeded random number generator
    this.rng = this.createRNG(this.options.seed);
    this.backtracks = 0;
    this.iterations = 0;
  }

  /**
   * Create a seeded random number generator
   * Simple mulberry32 algorithm
   */
  createRNG(seed) {
    let a = seed;
    return () => {
      a |= 0;
      a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /**
   * Run the WFC algorithm to completion
   * @returns {Object} Result with success flag and stats
   */
  solve() {
    this.iterations = 0;
    this.backtracks = 0;

    while (!this.grid.isFullyCollapsed()) {
      this.iterations++;

      // Check for contradictions
      const contradiction = this.grid.hasContradiction();
      if (contradiction) {
        if (!this.backtrack()) {
          return {
            success: false,
            error: 'Unsolvable: max backtracks exceeded',
            iterations: this.iterations,
            backtracks: this.backtracks
          };
        }
        continue;
      }

      // Find lowest entropy cell
      const cell = this.grid.getLowestEntropyCell();
      if (!cell) {
        // All cells collapsed
        break;
      }

      // Save state before collapsing (for backtracking)
      this.grid.saveState();

      // Collapse the cell
      const chosenTile = cell.collapse(this.rng);

      // Propagate constraints
      const success = this.propagator.propagate(cell.x, cell.y);

      if (!success) {
        // Propagation caused contradiction - backtrack
        if (!this.backtrack()) {
          return {
            success: false,
            error: 'Unsolvable: contradiction after propagation',
            iterations: this.iterations,
            backtracks: this.backtracks
          };
        }
      }

      // Report progress
      if (this.options.onProgress) {
        this.options.onProgress({
          progress: this.grid.getProgress(),
          collapsed: this.grid.getCollapsedCount(),
          total: this.grid.getTotalCount(),
          iterations: this.iterations,
          backtracks: this.backtracks
        });
      }
    }

    return {
      success: true,
      iterations: this.iterations,
      backtracks: this.backtracks
    };
  }

  /**
   * Run one step of the algorithm (for animation/debugging)
   * @returns {Object} Step result
   */
  step() {
    if (this.grid.isFullyCollapsed()) {
      return { done: true, success: true };
    }

    // Check for contradictions
    const contradiction = this.grid.hasContradiction();
    if (contradiction) {
      if (!this.backtrack()) {
        return { done: true, success: false, error: 'Contradiction' };
      }
      return { done: false, backtracked: true };
    }

    // Find lowest entropy cell
    const cell = this.grid.getLowestEntropyCell();
    if (!cell) {
      return { done: true, success: true };
    }

    // Save state and collapse
    this.grid.saveState();
    const chosenTile = cell.collapse(this.rng);

    // Propagate
    const success = this.propagator.propagate(cell.x, cell.y);

    if (!success) {
      if (!this.backtrack()) {
        return { done: true, success: false, error: 'Propagation failed' };
      }
      return { done: false, backtracked: true };
    }

    this.iterations++;
    return {
      done: false,
      cell: { x: cell.x, y: cell.y },
      tile: chosenTile,
      progress: this.grid.getProgress()
    };
  }

  /**
   * Backtrack to previous state
   * @returns {boolean} True if backtrack succeeded
   */
  backtrack() {
    this.backtracks++;

    if (this.options.onBacktrack) {
      this.options.onBacktrack(this.backtracks);
    }

    if (this.backtracks > this.options.maxBacktracks) {
      return false;
    }

    return this.grid.restoreState();
  }

  /**
   * Solve with animation (returns Promise)
   * Uses requestAnimationFrame for smooth rendering and batches steps for performance
   * @param {number} stepsPerFrame - Number of WFC steps per animation frame (higher = faster)
   * @returns {Promise<Object>}
   */
  async solveAnimated(stepsPerFrame = 50) {
    return new Promise((resolve) => {
      const raf = typeof requestAnimationFrame !== 'undefined'
        ? requestAnimationFrame
        : (cb) => setTimeout(cb, 16);

      const animate = () => {
        // Do multiple steps per frame for better performance
        let lastResult = null;
        for (let i = 0; i < stepsPerFrame; i++) {
          lastResult = this.step();
          if (lastResult.done) break;
        }

        // Report progress once per frame (not per step)
        if (this.options.onProgress) {
          this.options.onProgress({
            progress: this.grid.getProgress(),
            collapsed: this.grid.getCollapsedCount(),
            total: this.grid.getTotalCount(),
            iterations: this.iterations,
            backtracks: this.backtracks
          });
        }

        if (lastResult.done) {
          resolve({
            success: lastResult.success,
            iterations: this.iterations,
            backtracks: this.backtracks,
            error: lastResult.error
          });
        } else {
          raf(animate);
        }
      };

      raf(animate);
    });
  }

  /**
   * Reset solver state
   */
  reset() {
    this.iterations = 0;
    this.backtracks = 0;
    this.rng = this.createRNG(this.options.seed);
  }
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Solver };
} else {
  window.WFC = window.WFC || {};
  window.WFC.Solver = Solver;
}
