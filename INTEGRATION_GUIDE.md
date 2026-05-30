# Integration Guide: New UI Components into game.ts

## Overview

This guide shows how to integrate the 8 new UI components into `game.ts`.

---

## 1. Constructor Changes

### Replace Settings Panel Init
**Old**:
```typescript
this.settingsPanel = createSettingsPanel(container);
```

**New**:
```typescript
this.unifiedSettings = createUnifiedSettings(container, {
  onClose: () => { /* handle close */ },
  onLLMConfigChange: (config) => { /* update LLM config */ },
  onGameSettingChange: (key, value) => {
    if (key === 'showLabels') this.state.showLabels = value as boolean;
    if (key === 'showPoiMarkers') this.state.showPoiMarkers = value as boolean;
    if (key === 'debug') this.state.debug = value as boolean;
  },
});
```

### Add New UI Initialization (after `this.devMode = createDevMode();`)

```typescript
// Main Menu
this.mainMenu = createMainMenu(this.container, {
  onStart: () => {
    // Start the game - generate world if not already generated
    if (!this.state.map) {
      void this.generateWorld();
    }
  },
  onSettings: () => this.unifiedSettings.toggle(),
  version: '1.0.0',
});

// Tutorial
this.tutorial = createTutorial(this.container, {
  onComplete: () => {
    console.log('[tutorial] Completed');
  },
  onSkip: () => {
    localStorage.setItem('small-gods-tutorial-seen', 'true');
    console.log('[tutorial] Skipped');
  },
});

// Spirit HUD (initially hidden, show after world gen)
this.spiritHud = createSpiritHud(this.container, {
  onSelectRival: (rivalId) => {
    // Show rival panel
    const rival = this.state.spirits.get(rivalId);
    if (rival && this.state.world) {
      // Get competing NPCs
      const competingNpcs = []; // TODO: implement
      this.rivalPanel.update(rival as any, competingNpcs);
      this.rivalPanel.show();
    }
  },
});

// Rival Panel (initially hidden)
this.rivalPanel = createRivalPanel(this.container, {
  onClose: () => { /* hide panel */ },
  onTargetNpc: (npcId) => {
    this.state.selectedNpcId = npcId;
  },
});

// Minimap (initially hidden)
this.minimap = createMinimapPanel(this.container, {
  onToggle: (visible) => {
    console.log('[minimap] visible:', visible);
  },
  onClickTile: (x, y) => {
    // Move camera to tile
    const cam = this.state.camera;
    cam.x = x * TILE_SIZE - (this.canvas.width / devicePixelRatio) / 2;
    cam.y = y * TILE_SIZE - (this.canvas.height / devicePixelRatio) / 2;
  },
});

// Divine Effects
this.divineEffects = new DivineEffects();
```

---

## 2. Update `generateWorld()` Method

Add at the end of `generateWorld()` (before `this.startLoop()`):

```typescript
// Hide main menu, show game UI
this.mainMenu.hide();
this.spiritHud.show();
// Optionally show tutorial if first time
if (!localStorage.getItem('small-gods-tutorial-seen')) {
  setTimeout(() => this.tutorial.show('welcome'), 500);
}
```

---

## 3. Update Render Loop

In the `render()` method, add after `this.renderMap(this.ctx, rc);`:

```typescript
// Update divine effects
this.divineEffects.update(deltaMs);
this.divineEffects.render(this.ctx, this.state.camera, TILE_SIZE);

// Update minimap (when visible)
if (this.minimap && this.state.map) {
  const npcs = this.state.world?.query({ kind: 'npc' }).map(toRenderNpc) ?? [];
  this.minimap.update(
    this.state.map,
    npcs,
    this.state.camera,
    this.canvas.width / devicePixelRatio,
    this.canvas.height / devicePixelRatio,
  );
}

// Update Spirit HUD
if (this.spiritHud && this.state.world) {
  const player = this.state.spirits.get('player')!;
  const rivals = Array.from(this.state.spirits.entries())
    .filter(([id]) => id !== 'player')
    .map(([, spirit]) => spirit);
  
  let totalFollowers = 0;
  for (const npc of this.state.world.query({ kind: 'npc' })) {
    const p = npc.properties as unknown as NpcProperties;
    if (p.beliefs['player']?.faith > 0.3) totalFollowers++;
  }
  
  this.spiritHud.update(player, rivals as any[], totalFollowers);
}
```

---

## 4. Add Keyboard Shortcuts

In `attachControls()` or `attachDevKeyboardShortcuts()`, add:

```typescript
// Toggle minimap with 'M' key
if (e.key === 'm' || e.key === 'M') {
  e.preventDefault();
  this.minimap?.toggle();
  return;
}

// Show tutorial with '?' key
if (e.key === '?' || e.code === 'Slash') {
  e.preventDefault();
  this.tutorial?.show('welcome');
  return;
}
```

---

## 5. Update Destroy Method

Add cleanup for new components:

```typescript
destroy(): void {
  this.stopLoop();
  // ... existing cleanup ...
  
  // New components
  this.mainMenu?.destroy();
  this.spiritHud?.destroy();
  this.rivalPanel?.destroy();
  this.minimap?.destroy();
  this.tutorial?.destroy();
  this.divineEffects = null!;
  
  // Replace old settings button
  // this.settingsBtn.remove(); // Remove if using unified settings
  // this.llmSettingsBtn.remove();
  
  this.unifiedSettings?.destroy();
}
```

---

## 6. Connect Divine Actions to Effects

Update the action handlers to trigger visual effects:

```typescript
onWhisper: () => {
  if (whisper(player, entity, this.state.eventLog)) {
    this.lastWhisperTime = performance.now();
    // NEW: Trigger divine effect
    this.divineEffects.trigger('whisper', entity.x, entity.y);
  }
},
onOmen: () => {
  const p = npcProps(entity);
  if (p.homePoiId) {
    omen(player, p.homePoiId, this.state.world!, this.state.eventLog);
    // NEW: Trigger effect at POI location
    const poi = this.state.worldSeed?.pois.find(p => p.id === p.homePoiId);
    if (poi?.position) {
      this.divineEffects.trigger('omen', poi.position.x, poi.position.y);
    }
  }
},
onMiracle: () => {
  const p = npcProps(entity);
  if (p.homePoiId) {
    miracle(player, p.homePoiId, this.state.world!, this.state.eventLog);
    const poi = this.state.worldSeed?.pois.find(p => p.id === p.homePoiId);
    if (poi?.position) {
      this.divineEffects.trigger('miracle', poi.position.x, poi.position.y);
    }
  }
},
```

---

## 7. Update `startLoop()` for Delta Time

Make sure deltaMs is passed to effects:

```typescript
const loop = (now: number) => {
  const deltaMs = Math.min(now - this.lastTime, 100);
  this.lastTime = now;
  
  // Update divine effects with delta time
  if (this.divineEffects) {
    this.divineEffects.update(deltaMs);
  }
  
  // ... rest of loop
};
```

---

## Summary of Changes

| Location | Change |
|----------|-------|
| **Constructor** | Add 5 new component initializations |
| **generateWorld()** | Hide menu, show HUD, optionally show tutorial |
| **render()** | Call effects.update/render, minimap.update, spiritHud.update |
| **Keyboard shortcuts** | Add 'M' for minimap, '?' for tutorial |
| **destroy()** | Cleanup new components |
| **Action handlers** | Trigger divine effects on actions |

---

## Files to Modify

1. `src/game.ts` — Main integration (this guide)
2. `src/ui/controls.ts` — Add 'M' and '?' key handlers

---

## Testing Checklist

- [ ] Main menu shows on load
- [ ] "Begin Game" hides menu and starts game
- [ ] Spirit HUD shows player power and rivals
- [ ] Minimap toggles with 'M' key
- [ ] Tutorial shows on first visit
- [ ] Divine effects play on whisper/omen/miracle
- [ ] Rival panel opens when clicking rival in HUD
- [ ] Unified settings replace old settings buttons
- [ ] All new components destroy cleanly
