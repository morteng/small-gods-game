---
name: playtest
description: Launch the game and visually verify it in Chrome using Claude-in-Chrome
disable-model-invocation: true
allowed-tools: Bash, mcp__claude-in-chrome__*
---

Visually test the game: $ARGUMENTS

## Steps

1. Check if dev server is running (`curl -s http://localhost:5173` or start with `npm run dev &`)
2. Get Chrome tab context via `tabs_context_mcp`, create a new tab
3. Navigate to `http://localhost:5173`
4. Take a screenshot to capture initial render
5. Verify:
   - Terrain tiles render (no black/empty canvas)
   - POI markers are visible
   - No visual glitches or overlapping elements
6. Check browser console for errors or warnings
7. If specific area requested in $ARGUMENTS, interact with that feature
8. Take final screenshot and report findings

## Common Checks
- Map generation: terrain types visible (grass, water, roads, mountains)
- NPC overlays: belief cards appear on click
- Power HUD: displays current power level
- Camera: pan and zoom work (drag + scroll)
- Minimap: renders in corner with viewport indicator
