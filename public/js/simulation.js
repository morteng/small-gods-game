/**
 * Small Gods - NPC Simulation
 */

function startSimulation() {
  if (state.simulation.running || state.npcs.length === 0) {
    if (state.npcs.length === 0) setStatus('Generate NPCs first', 'error');
    return;
  }
  state.simulation.running = true;
  document.getElementById('btnSimStart').disabled = true;
  simulationLoop();
  setStatus('Simulation running', 'success');
}

function stopSimulation() {
  state.simulation.running = false;
  if (state.simulation.frameId) cancelAnimationFrame(state.simulation.frameId);
  document.getElementById('btnSimStart').disabled = false;
  hideStatus();
}

function simulationLoop() {
  if (!state.simulation.running) return;

  for (const npc of state.npcs) {
    if (!npc.moving && Math.random() < 0.02) {
      const dirs = [[0,-1], [1,0], [0,1], [-1,0]];
      const d = dirs[Math.floor(Math.random() * dirs.length)];
      const nx = Math.round(npc.x) + d[0];
      const ny = Math.round(npc.y) + d[1];
      if (state.map.tiles[ny]?.[nx] && TileTypes[state.map.tiles[ny][nx].type]?.walkable) {
        npc.tx = nx;
        npc.ty = ny;
        npc.moving = true;
        npc.dir = dirs.indexOf(d);
      }
    }

    if (npc.moving) {
      const dx = npc.tx - npc.x;
      const dy = npc.ty - npc.y;
      const speed = 0.05;
      if (Math.abs(dx) > 0.01) npc.x += Math.sign(dx) * speed;
      if (Math.abs(dy) > 0.01) npc.y += Math.sign(dy) * speed;
      if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) {
        npc.x = npc.tx;
        npc.y = npc.ty;
        npc.moving = false;
      }
      npc.frame = (npc.frame + 0.15) % 4;
    }
  }

  redraw();
  state.simulation.frameId = requestAnimationFrame(simulationLoop);
}
