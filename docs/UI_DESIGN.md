# UI Design System

Graphics, layout, and visual design for Small Gods.

---

## Technical Constraints

MCP Apps render in **sandboxed iframes**. This means:

### What We CAN Use
- ✅ HTML5 / CSS3 / JavaScript
- ✅ Inline SVG (scalable vector graphics)
- ✅ Canvas 2D API
- ✅ CSS animations and transitions
- ✅ CSS Grid and Flexbox
- ✅ Unicode / Emoji
- ✅ Web fonts (inline base64)
- ✅ CSS pixel art techniques
- ✅ JSON-RPC communication with host

### What We CANNOT Use
- ❌ External resources (images, fonts from URLs)
- ❌ External JavaScript libraries (unless inlined)
- ❌ LocalStorage / IndexedDB (sandboxed)
- ❌ WebGL (usually blocked in sandbox)
- ❌ Fetch to external URLs

### Implication
Everything must be **self-contained HTML**. All graphics must be:
- Emoji (built into system)
- Inline SVG
- CSS-generated (gradients, box-shadows, shapes)
- Canvas-drawn
- Base64-encoded images (if needed)

---

## Visual Style Options

### Option A: Pure Emoji (MVP)
Simple, immediate, LLM-readable.

```
┌─────────────────────────────────────────┐
│ 🐍 Power: 67  │ Year 47  │ 🙏 23       │
├─────────────────────────────────────────┤
│ 🌳🌳 🏠🏠🏠 🌾🌾 ⛰️                     │
│ 🌳  👤🙏👤  🌾  ⛰️🏛️                    │
│     🐑 👤🙏   🌊🌊 ⛰️                    │
│ 🌾🌾 🏠👤🏠 🌊🌊🌊                       │
│      ✨       🐟🌊                       │
├─────────────────────────────────────────┤
│ 📜 "The Rain of Mira" spreading...      │
│ ⚠️ Elder Tam (87) is dying              │
└─────────────────────────────────────────┘
```

**Pros:** Fast to implement, LLM can "see" it, works everywhere
**Cons:** Limited visual richness, no animations

### Option B: Emoji + CSS Enhancement
Emoji with CSS styling, animations, and overlays.

```css
.tile {
  font-size: 24px;
  transition: transform 0.2s;
}
.tile:hover {
  transform: scale(1.2);
}
.tile.blessed {
  animation: glow 2s infinite;
  filter: drop-shadow(0 0 4px gold);
}
.tile.burning {
  animation: flicker 0.3s infinite;
}
```

**Pros:** More alive, interactive, still emoji-based
**Cons:** More CSS work

### Option C: Pixel Art Style
CSS-generated pixel art aesthetic.

```css
/* Retro pixel font */
@font-face {
  font-family: 'PixelFont';
  src: url(data:font/woff2;base64,...) format('woff2');
}

body {
  font-family: 'PixelFont', monospace;
  image-rendering: pixelated;
  background: #1a1a2e;
}

.panel {
  border: 4px solid #4a4a6a;
  border-image: url('data:image/png;base64,...') 4 fill repeat;
  background: linear-gradient(#2a2a4e, #1a1a3e);
}
```

**Pros:** Nostalgic, cohesive aesthetic, distinctive
**Cons:** Requires font/asset embedding, more complex

### Option D: SVG + Emoji Hybrid
SVG for UI chrome, emoji for content.

```html
<svg class="panel-frame" viewBox="0 0 400 300">
  <defs>
    <linearGradient id="gold">
      <stop offset="0%" stop-color="#ffd700"/>
      <stop offset="100%" stop-color="#b8860b"/>
    </linearGradient>
  </defs>
  <rect x="5" y="5" width="390" height="290"
        fill="#1a1a2e" stroke="url(#gold)" stroke-width="3"
        rx="10"/>
</svg>
<div class="content">
  <!-- Emoji world map here -->
</div>
```

**Pros:** Crisp at any size, elegant, customizable
**Cons:** More complex to build

### Recommendation: **Option B for MVP, Option D for polish**

Start with Emoji + CSS Enhancement, evolve to SVG hybrid.

---

## UI Components

### 1. World Map View

The main game view showing the world.

```html
<div class="world-view">
  <header class="status-bar">
    <span class="god-status">🐍 67</span>
    <span class="time">Year 47 • Spring</span>
    <span class="believers">🙏 23</span>
  </header>

  <div class="map-container">
    <div class="map-grid">
      <!-- Each tile -->
      <span class="tile terrain-forest">🌳</span>
      <span class="tile terrain-farm has-villager">🙏</span>
      <span class="tile terrain-water">🌊</span>
      <!-- ... -->
    </div>

    <!-- Overlay for effects -->
    <div class="effects-layer">
      <div class="effect blessing" style="grid-area: 3/4/4/6;">✨</div>
    </div>
  </div>

  <footer class="event-ticker">
    <div class="event">📜 "The Rain of Mira" was told by Elder Tam</div>
    <div class="event">🌧️ Light rain begins</div>
  </footer>
</div>
```

```css
.map-grid {
  display: grid;
  grid-template-columns: repeat(15, 28px);
  grid-template-rows: repeat(15, 28px);
  gap: 2px;
  background: #0a0a1a;
  padding: 8px;
  border-radius: 8px;
}

.tile {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  background: rgba(255,255,255,0.05);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.tile:hover {
  transform: scale(1.15);
  z-index: 10;
  background: rgba(255,255,255,0.15);
}

.tile.has-believer {
  box-shadow: 0 0 8px rgba(255, 215, 0, 0.5);
}

.tile.blessed {
  animation: blessedGlow 2s ease-in-out infinite;
}

@keyframes blessedGlow {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.5) drop-shadow(0 0 6px gold); }
}
```

### 2. Entity Cards

Cards showing NPCs, creatures, with stats and info.

```html
<div class="entity-card villager believer">
  <div class="card-header">
    <span class="entity-emoji">🙏</span>
    <div class="entity-name">
      <h3>Mira the Farmer</h3>
      <span class="subtitle">Believer • Age 45</span>
    </div>
  </div>

  <div class="card-body">
    <!-- Belief meter -->
    <div class="stat-bar">
      <label>Faith</label>
      <div class="bar">
        <div class="fill belief" style="width: 78%"></div>
      </div>
      <span class="value">78%</span>
    </div>

    <!-- Health meter -->
    <div class="stat-bar">
      <label>Health</label>
      <div class="bar">
        <div class="fill health" style="width: 90%"></div>
      </div>
      <span class="value">90%</span>
    </div>

    <!-- Personality chips -->
    <div class="traits">
      <span class="trait positive">Pious</span>
      <span class="trait neutral">Storyteller</span>
      <span class="trait">Curious</span>
    </div>

    <!-- Known stories -->
    <div class="known-stories">
      <h4>📜 Knows 3 stories</h4>
      <ul>
        <li>The Rain of Mira (witness)</li>
        <li>The Old Stone</li>
        <li>Grandmother's Prayer</li>
      </ul>
    </div>
  </div>

  <div class="card-footer">
    <span class="location">📍 Village</span>
    <span class="role">👨‍🌾 Farmer</span>
  </div>
</div>
```

```css
.entity-card {
  width: 280px;
  background: linear-gradient(145deg, #1e1e3f, #151530);
  border: 2px solid #3a3a5c;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
}

.entity-card.believer {
  border-color: #ffd700;
  box-shadow: 0 4px 20px rgba(255,215,0,0.2);
}

.entity-card.hostile {
  border-color: #ff4444;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: rgba(0,0,0,0.3);
}

.entity-emoji {
  font-size: 48px;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
}

.entity-name h3 {
  margin: 0;
  color: #fff;
  font-size: 18px;
}

.subtitle {
  color: #8888aa;
  font-size: 12px;
}

.stat-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 16px;
}

.stat-bar label {
  width: 50px;
  font-size: 11px;
  color: #8888aa;
}

.stat-bar .bar {
  flex: 1;
  height: 8px;
  background: #2a2a4a;
  border-radius: 4px;
  overflow: hidden;
}

.stat-bar .fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.5s ease;
}

.fill.belief { background: linear-gradient(90deg, #ffd700, #ffaa00); }
.fill.health { background: linear-gradient(90deg, #44ff44, #22aa22); }
.fill.mana { background: linear-gradient(90deg, #4488ff, #2244aa); }

.traits {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 16px;
}

.trait {
  padding: 4px 8px;
  background: #2a2a5a;
  border-radius: 12px;
  font-size: 11px;
  color: #aaaacc;
}

.trait.positive { background: #2a4a2a; color: #88ff88; }
.trait.negative { background: #4a2a2a; color: #ff8888; }
```

### 3. Creature/Monster Cards

For non-human entities with D&D-style stats.

```html
<div class="entity-card creature hostile">
  <div class="card-header">
    <span class="entity-emoji">🐉</span>
    <div class="entity-name">
      <h3>Scorrath the Burning</h3>
      <span class="subtitle">Ancient Fire Dragon</span>
    </div>
    <span class="threat-level">💀💀💀</span>
  </div>

  <div class="card-body">
    <!-- Attribute grid (D&D style) -->
    <div class="attributes-grid">
      <div class="attr">
        <span class="attr-value">20</span>
        <span class="attr-label">STR</span>
      </div>
      <div class="attr">
        <span class="attr-value">12</span>
        <span class="attr-label">AGI</span>
      </div>
      <div class="attr">
        <span class="attr-value">20</span>
        <span class="attr-label">VIT</span>
      </div>
      <div class="attr">
        <span class="attr-value">16</span>
        <span class="attr-label">INT</span>
      </div>
      <div class="attr">
        <span class="attr-value">14</span>
        <span class="attr-label">WIS</span>
      </div>
      <div class="attr">
        <span class="attr-value">18</span>
        <span class="attr-label">CHA</span>
      </div>
    </div>

    <!-- Health bar (larger for monsters) -->
    <div class="monster-health">
      <div class="health-bar">
        <div class="fill" style="width: 100%"></div>
      </div>
      <span>HP: 100/100</span>
    </div>

    <!-- Abilities -->
    <div class="abilities">
      <div class="ability">
        <span class="ability-icon">🔥</span>
        <span class="ability-name">Fire Breath</span>
        <span class="ability-desc">8d6 fire, cone</span>
      </div>
      <div class="ability">
        <span class="ability-icon">🛡️</span>
        <span class="ability-name">Fire Immunity</span>
      </div>
      <div class="ability">
        <span class="ability-icon">😱</span>
        <span class="ability-name">Frightful Presence</span>
      </div>
    </div>

    <!-- Disposition -->
    <div class="disposition hostile">
      <span>⚔️ Hostile • Territorial</span>
    </div>
  </div>
</div>
```

```css
.attributes-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 4px;
  padding: 12px;
  background: rgba(0,0,0,0.3);
  margin: 8px;
  border-radius: 8px;
}

.attr {
  text-align: center;
}

.attr-value {
  display: block;
  font-size: 20px;
  font-weight: bold;
  color: #fff;
}

.attr-label {
  display: block;
  font-size: 10px;
  color: #666;
  text-transform: uppercase;
}

/* Highlight exceptional attributes */
.attr-value.exceptional { color: #ffd700; }
.attr-value.poor { color: #666; }

.abilities {
  padding: 8px 12px;
}

.ability {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  margin: 4px 0;
  background: rgba(255,255,255,0.05);
  border-radius: 6px;
}

.ability-icon {
  font-size: 20px;
}

.ability-name {
  font-weight: bold;
  color: #ddd;
}

.ability-desc {
  color: #888;
  font-size: 12px;
  margin-left: auto;
}

.disposition {
  padding: 8px 12px;
  text-align: center;
  font-size: 12px;
}

.disposition.hostile { background: rgba(255,0,0,0.2); color: #ff6666; }
.disposition.friendly { background: rgba(0,255,0,0.2); color: #66ff66; }
.disposition.neutral { background: rgba(128,128,128,0.2); color: #aaa; }
```

### 4. Story Cards

Displaying stories with their lineage and fidelity.

```html
<div class="story-card">
  <div class="story-header">
    <span class="story-icon">📜</span>
    <div class="story-title">
      <h3>The Rain of Mira</h3>
      <span class="story-type">Miracle Story</span>
    </div>
    <span class="fidelity-badge">34%</span>
  </div>

  <div class="story-body">
    <!-- Current telling -->
    <blockquote class="current-telling">
      "The prophet Mira climbed the sacred mountain and
      wrestled the Storm God for three days. She won,
      and the god's tears became rain that saved us all."
    </blockquote>

    <!-- Truth comparison -->
    <div class="truth-box">
      <h4>What Actually Happened</h4>
      <p>Turn 5: You caused rain. Mira witnessed while praying.</p>
    </div>

    <!-- Lineage visualization -->
    <div class="story-lineage">
      <div class="lineage-node origin">
        <span class="gen">Gen 1</span>
        <span class="teller">Mira</span>
        <span class="fid">98%</span>
      </div>
      <div class="lineage-arrow">→</div>
      <div class="lineage-node">
        <span class="gen">Gen 2</span>
        <span class="teller">Kira</span>
        <span class="fid">71%</span>
      </div>
      <div class="lineage-arrow">→</div>
      <div class="lineage-node">
        <span class="gen">Gen 3</span>
        <span class="teller">Tam</span>
        <span class="fid">45%</span>
      </div>
      <div class="lineage-arrow">→</div>
      <div class="lineage-node current">
        <span class="gen">Gen 4</span>
        <span class="teller">Village</span>
        <span class="fid">34%</span>
      </div>
    </div>

    <!-- Stats -->
    <div class="story-stats">
      <div class="stat">
        <span class="stat-value">47</span>
        <span class="stat-label">Carriers</span>
      </div>
      <div class="stat">
        <span class="stat-value">12</span>
        <span class="stat-label">Told/Year</span>
      </div>
      <div class="stat">
        <span class="stat-value">+8</span>
        <span class="stat-label">Belief Impact</span>
      </div>
    </div>
  </div>

  <div class="story-themes">
    <span class="theme">rain</span>
    <span class="theme">prophet</span>
    <span class="theme">sacrifice</span>
  </div>
</div>
```

```css
.story-card {
  width: 350px;
  background: linear-gradient(145deg, #2a1a1a, #1a1020);
  border: 2px solid #5a4a3a;
  border-radius: 12px;
  overflow: hidden;
}

.story-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: linear-gradient(90deg, rgba(139,69,19,0.3), transparent);
}

.story-icon {
  font-size: 36px;
}

.fidelity-badge {
  margin-left: auto;
  padding: 6px 12px;
  background: rgba(255,0,0,0.2);
  border-radius: 20px;
  font-weight: bold;
  color: #ff8888;
}

/* Color code fidelity */
.fidelity-badge.high { background: rgba(0,255,0,0.2); color: #88ff88; }
.fidelity-badge.medium { background: rgba(255,255,0,0.2); color: #ffff88; }
.fidelity-badge.low { background: rgba(255,0,0,0.2); color: #ff8888; }

.current-telling {
  margin: 16px;
  padding: 16px;
  background: rgba(255,255,255,0.05);
  border-left: 3px solid #8b4513;
  font-style: italic;
  color: #ccbb99;
  line-height: 1.6;
}

.truth-box {
  margin: 16px;
  padding: 12px;
  background: rgba(0,100,0,0.2);
  border-radius: 8px;
  font-size: 12px;
}

.truth-box h4 {
  margin: 0 0 8px 0;
  color: #88ff88;
  font-size: 11px;
  text-transform: uppercase;
}

.story-lineage {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 16px;
  overflow-x: auto;
}

.lineage-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px;
  background: rgba(255,255,255,0.1);
  border-radius: 8px;
  min-width: 60px;
}

.lineage-node.origin {
  background: rgba(0,255,0,0.2);
}

.lineage-node.current {
  background: rgba(255,215,0,0.2);
  border: 1px solid #ffd700;
}

.lineage-node .gen {
  font-size: 10px;
  color: #666;
}

.lineage-node .teller {
  font-weight: bold;
  color: #fff;
}

.lineage-node .fid {
  font-size: 11px;
  color: #888;
}

.lineage-arrow {
  color: #444;
}

.story-themes {
  display: flex;
  gap: 6px;
  padding: 12px 16px;
  background: rgba(0,0,0,0.3);
}

.theme {
  padding: 4px 10px;
  background: #3a3a5a;
  border-radius: 12px;
  font-size: 11px;
  color: #aaa;
}
```

### 5. God Status Panel

Your divine status dashboard.

```html
<div class="god-panel">
  <div class="god-avatar">
    <span class="god-emoji">🐍</span>
    <div class="power-ring">
      <svg viewBox="0 0 100 100">
        <circle class="ring-bg" cx="50" cy="50" r="45"/>
        <circle class="ring-fill" cx="50" cy="50" r="45"
                stroke-dasharray="283" stroke-dashoffset="100"/>
      </svg>
    </div>
  </div>

  <div class="god-info">
    <h2>The Unnamed One</h2>
    <div class="tier-badge">Rising God</div>

    <div class="power-display">
      <span class="power-current">67</span>
      <span class="power-max">/ 100</span>
      <span class="power-label">Divine Power</span>
    </div>

    <div class="quick-stats">
      <div class="qstat">
        <span class="qstat-value">🙏 23</span>
        <span class="qstat-label">Believers</span>
      </div>
      <div class="qstat">
        <span class="qstat-value">🏛️ 2</span>
        <span class="qstat-label">Shrines</span>
      </div>
      <div class="qstat">
        <span class="qstat-value">📜 7</span>
        <span class="qstat-label">Stories</span>
      </div>
    </div>
  </div>

  <div class="abilities-panel">
    <h3>Abilities</h3>
    <div class="ability-list">
      <button class="ability-btn available">
        <span class="ability-icon">💭</span>
        <span class="ability-name">Whisper</span>
        <span class="ability-cost">Free</span>
      </button>
      <button class="ability-btn available">
        <span class="ability-icon">🌧️</span>
        <span class="ability-name">Rain</span>
        <span class="ability-cost">15 ⚡</span>
      </button>
      <button class="ability-btn available">
        <span class="ability-icon">💊</span>
        <span class="ability-name">Heal</span>
        <span class="ability-cost">10 ⚡</span>
      </button>
      <button class="ability-btn locked">
        <span class="ability-icon">👁️</span>
        <span class="ability-name">Manifest</span>
        <span class="ability-cost">🔒 Tier 4</span>
      </button>
    </div>
  </div>
</div>
```

### 6. Event/Combat Log

Scrolling narrative of events.

```html
<div class="event-log">
  <div class="log-entry event">
    <span class="timestamp">Year 47, Spring</span>
    <span class="icon">🌧️</span>
    <span class="message">You caused rain to fall on the parched fields.</span>
  </div>

  <div class="log-entry reaction">
    <span class="icon">👤</span>
    <span class="message">
      <strong>Mira</strong> falls to her knees. "The god has answered!"
    </span>
  </div>

  <div class="log-entry story">
    <span class="icon">📜</span>
    <span class="message">
      A new story is born: <em>"The Spring Rain"</em>
    </span>
  </div>

  <div class="log-entry combat">
    <span class="icon">⚔️</span>
    <span class="message">
      <strong>Aric the Wanderer</strong> strikes the troll for
      <span class="damage">14 damage</span>!
    </span>
  </div>

  <div class="log-entry death">
    <span class="icon">💀</span>
    <span class="message">
      <strong>Elder Tam</strong> has passed away at age 89.
      <span class="story-warning">⚠️ 2 stories may be lost</span>
    </span>
  </div>
</div>
```

```css
.event-log {
  max-height: 300px;
  overflow-y: auto;
  background: #0a0a15;
  border-radius: 8px;
  padding: 8px;
}

.log-entry {
  display: flex;
  gap: 8px;
  padding: 8px;
  margin: 4px 0;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.4;
  animation: slideIn 0.3s ease;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.log-entry.event { background: rgba(100,100,255,0.1); }
.log-entry.reaction { background: rgba(100,255,100,0.1); }
.log-entry.story { background: rgba(139,69,19,0.2); }
.log-entry.combat { background: rgba(255,100,100,0.1); }
.log-entry.death { background: rgba(100,0,100,0.2); }

.log-entry .icon {
  font-size: 18px;
  flex-shrink: 0;
}

.log-entry .timestamp {
  font-size: 10px;
  color: #666;
}

.damage { color: #ff6666; font-weight: bold; }
.heal { color: #66ff66; font-weight: bold; }
.story-warning { color: #ffaa00; font-size: 11px; }
```

---

## Layout System

### Main Game Layout

```html
<div class="game-container">
  <!-- Left: God status -->
  <aside class="sidebar left">
    <div class="god-panel">...</div>
    <div class="abilities-panel">...</div>
  </aside>

  <!-- Center: World view -->
  <main class="main-view">
    <header class="game-header">
      <span class="turn-info">Year 47 • Spring • Turn 2256</span>
      <div class="quick-actions">
        <button>⏭️ Advance</button>
        <button>👁️ Observe</button>
      </div>
    </header>

    <div class="world-map">...</div>

    <div class="event-log">...</div>
  </main>

  <!-- Right: Details panel (contextual) -->
  <aside class="sidebar right">
    <!-- Shows: selected villager, story, or entity -->
    <div class="detail-panel">...</div>
  </aside>
</div>
```

```css
.game-container {
  display: grid;
  grid-template-columns: 280px 1fr 300px;
  grid-template-rows: 100vh;
  gap: 0;
  background: #0f0f1a;
  color: #eee;
  font-family: 'Segoe UI', system-ui, sans-serif;
}

.sidebar {
  background: #151525;
  border-right: 1px solid #2a2a4a;
  overflow-y: auto;
  padding: 16px;
}

.sidebar.right {
  border-right: none;
  border-left: 1px solid #2a2a4a;
}

.main-view {
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow: hidden;
}

.world-map {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.event-log {
  height: 200px;
  margin-top: 16px;
}

/* Responsive: collapse sidebars on small screens */
@media (max-width: 1200px) {
  .game-container {
    grid-template-columns: 1fr;
  }
  .sidebar {
    display: none;
  }
  .sidebar.active {
    display: block;
    position: fixed;
    top: 0;
    left: 0;
    width: 300px;
    height: 100vh;
    z-index: 100;
  }
}
```

### Popup/Modal System

For detailed views that overlay the game.

```html
<div class="modal-overlay" id="villager-modal">
  <div class="modal">
    <button class="modal-close">×</button>
    <div class="modal-content">
      <!-- Villager card, expanded -->
    </div>
  </div>
</div>
```

```css
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0,0,0,0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s;
}

.modal-overlay.active {
  opacity: 1;
  pointer-events: all;
}

.modal {
  background: #1a1a2e;
  border: 2px solid #3a3a5c;
  border-radius: 16px;
  max-width: 90vw;
  max-height: 90vh;
  overflow: auto;
  position: relative;
  animation: modalIn 0.3s ease;
}

@keyframes modalIn {
  from {
    transform: scale(0.9);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
```

---

## Animations

### Key Animations

```css
/* Blessed glow */
@keyframes blessedGlow {
  0%, 100% { filter: brightness(1) drop-shadow(0 0 0 transparent); }
  50% { filter: brightness(1.3) drop-shadow(0 0 8px gold); }
}

/* Fire flicker */
@keyframes fireFlicker {
  0%, 100% { opacity: 1; transform: scale(1); }
  25% { opacity: 0.8; transform: scale(0.98); }
  50% { opacity: 1; transform: scale(1.02); }
  75% { opacity: 0.9; transform: scale(0.99); }
}

/* Water wave */
@keyframes waterWave {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}

/* Pulse (for attention) */
@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

/* Fade in (for new elements) */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Shake (for damage/impact) */
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}

/* Float (for spirits/ghosts) */
@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
```

---

## Interactive Features

### Tile Hover Info

```javascript
// Show tooltip on tile hover
document.querySelectorAll('.tile').forEach(tile => {
  tile.addEventListener('mouseenter', (e) => {
    const info = getTileInfo(tile.dataset.x, tile.dataset.y);
    showTooltip(e, info);
  });

  tile.addEventListener('mouseleave', () => {
    hideTooltip();
  });
});

function showTooltip(event, info) {
  const tooltip = document.getElementById('tooltip');
  tooltip.innerHTML = `
    <strong>${info.terrain}</strong>
    ${info.villagers.length ? `<br>👤 ${info.villagers.join(', ')}` : ''}
    ${info.effects.length ? `<br>✨ ${info.effects.join(', ')}` : ''}
  `;
  tooltip.style.left = event.pageX + 10 + 'px';
  tooltip.style.top = event.pageY + 10 + 'px';
  tooltip.classList.add('visible');
}
```

### Clickable Entities

```javascript
// Click tile to select/view entity
document.querySelectorAll('.tile').forEach(tile => {
  tile.addEventListener('click', () => {
    const x = parseInt(tile.dataset.x);
    const y = parseInt(tile.dataset.y);

    // Send message to parent (MCP host)
    window.parent.postMessage({
      type: 'tile_selected',
      x, y
    }, '*');

    // Or call MCP tool
    mcpCall('observe', { focus: 'tile', target: `${x},${y}` });
  });
});
```

---

## Color Palette

```css
:root {
  /* Background layers */
  --bg-darkest: #0a0a15;
  --bg-dark: #0f0f1a;
  --bg-medium: #151525;
  --bg-light: #1a1a2e;
  --bg-lighter: #252540;

  /* Borders */
  --border-dark: #2a2a4a;
  --border-light: #3a3a5c;

  /* Text */
  --text-primary: #eeeeee;
  --text-secondary: #aaaacc;
  --text-muted: #666688;

  /* Accents */
  --gold: #ffd700;
  --gold-dark: #b8860b;
  --red: #ff4444;
  --green: #44ff44;
  --blue: #4488ff;
  --purple: #aa44ff;

  /* Semantic */
  --belief: var(--gold);
  --health: var(--green);
  --mana: var(--blue);
  --danger: var(--red);
  --divine: var(--purple);

  /* Entity types */
  --friendly: #44ff44;
  --neutral: #888888;
  --hostile: #ff4444;
  --supernatural: #aa44ff;
}
```

---

## Typography

```css
/* Primary font - clean, readable */
body {
  font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}

/* Headers - slightly bolder */
h1, h2, h3 {
  font-weight: 600;
  letter-spacing: -0.01em;
}

/* Monospace for stats/data */
.stat-value, .attribute, .code {
  font-family: 'SF Mono', 'Consolas', monospace;
}

/* Optional: Pixel font for retro feel */
.retro {
  font-family: 'Press Start 2P', monospace;
  font-size: 10px;
  letter-spacing: 1px;
}
```

---

## MVP UI Scope

### Phase 1 (MVP)
- [x] Basic emoji world map
- [x] Simple status bar
- [x] Event log (text)
- [ ] Basic entity cards (simplified)

### Phase 2
- [ ] Enhanced map with CSS effects
- [ ] Full entity cards with stats
- [ ] Story cards with lineage
- [ ] God status panel

### Phase 3
- [ ] SVG UI chrome
- [ ] Animations
- [ ] Responsive layout
- [ ] Tooltips and interactions

### Phase 4
- [ ] Pixel art mode (optional)
- [ ] Sound effects
- [ ] Particle effects (canvas)
- [ ] Full polish

---

*Document version: 0.1*

**Sources:**
- [HTML5 Games with Canvas and SVG - SitePoint](https://www.sitepoint.com/the-complete-guide-to-building-html5-games-with-canvas-and-svg/)
- [CSS Cards - FreeFrontEnd](https://freefrontend.com/css-cards/)
- [snes.css Retro Framework](https://github.com/devMiguelCarrero/snes.css)
- [CSS Pixel Art - FreeFrontEnd](https://freefrontend.com/css-pixel-art/)
