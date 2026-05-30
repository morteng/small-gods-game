# Small Gods — Complete Test Checklist

## 🎮 How to Test

1. **Start dev server:** `npm run dev`
2. **Open browser:** Navigate to `http://localhost:3003`
3. **Open console:** Press F12
4. **Run tests:** Copy & paste test scripts below

---

## ✅ Test 1: UI Components Render Check

```javascript
console.log('🧪 Test 1: UI Components Render Check');

const components = [
  { id: 'sg-main-menu', name: 'Main Menu' },
  { id: 'sg-unified-settings', name: 'Unified Settings' },
  { id: 'sg-spirit-hud', name: 'Spirit HUD' },
  { id: 'sg-rival-panel', name: 'Rival Panel' },
  { id: 'sg-minimap-panel', name: 'Minimap Panel' },
  { id: 'sg-tutorial', name: 'Tutorial' },
  { id: 'sg-llm-display', name: 'LLM Display' },
  { id: 'sg-divine-effects', name: 'Divine Effects' }
];

console.log('\n📊 Component Check:');
let found = 0;
components.forEach(({ id, name }) => {
  const el = document.getElementById(id) || document.querySelector(id);
  if (el) {
    console.log(`  ✅ ${name}: Found`);
    found++;
  } else {
    console.log(`  ❌ ${name}: Not found`);
  }
});
console.log(`\nResult: ${found}/${components.length} components found`);
```

---

## ✅ Test 2: OpenRouter LLM Integration

```javascript
console.log('🧪 Test 2: OpenRouter LLM Integration');

// Check if provider factory is available
console.log('\n📋 Step 1: Check Provider Config');
const config = localStorage.getItem('small-gods-llm-provider');
if (config) {
  const parsed = JSON.parse(config);
  console.log('  ✅ Config found:', parsed);
  console.log('  Provider type:', parsed.type);
  if (parsed.type === 'openrouter') {
    console.log('  ✅ OpenRouter configured');
    console.log('  Model:', parsed.openrouterModel);
    console.log('  API key present:', !!parsed.openrouterApiKey);
  }
} else {
  console.log('  ⚠️  No config saved yet');
}

// Test saving OpenRouter config
console.log('\n📋 Step 2: Test Save Config (Simulation)');
const testConfig = {
  type: 'openrouter',
  openrouterApiKey: 'sk-or-v1-test-key',
  openrouterModel: 'google/gemini-pro',
  maxTokens: 200,
  temperature: 0.7
};
console.log('  Test config:', testConfig);
console.log('  To save: localStorage.setItem("small-gods-llm-provider", JSON.stringify(testConfig))');

// Check if LLM client is initialized
console.log('\n📋 Step 3: Check LLM Client');
if (window.game && window.game.llmClient) {
  console.log('  ✅ LLM Client initialized');
  console.log('  Provider:', window.game.llmClient.provider?.name());
} else {
  console.log('  ⚠️  LLM Client not accessible from window.game');
}
```

---

## ✅ Test 3: Keyboard Shortcuts

```javascript
console.log('🧪 Test 3: Keyboard Shortcuts');

const shortcuts = [
  { key: 'T', description: 'Play/Pause time' },
  { key: 'Space', description: 'Play/Pause time' },
  { key: '1', description: 'Set speed 1x' },
  { key: '2', description: 'Set speed 2x' },
  { key: '4', description: 'Set speed 4x' },
  { key: '8', description: 'Set speed 8x' },
  { key: 'M', description: 'Toggle minimap' },
  { key: '?', description: 'Show tutorial (Shift+/)' },
  { key: 'Escape', description: 'Close panels' }
];

console.log('\n📋 Keyboard Shortcuts to Test:');
shortcuts.forEach(({ key, description }) => {
  console.log(`  - ${key}: ${description}`);
});
console.log('\n👉 Click on the game canvas, then press each key to test.');
```

---

## ✅ Test 4: Settings Panel Tabs

```javascript
console.log('🧪 Test 4: Settings Panel Tabs');

// Open settings
const settingsBtn = document.querySelector('[data-settings-toggle]') || 
                    document.querySelector('button[title*="Settings"]');
if (settingsBtn) {
  console.log('  ✅ Settings button found');
  console.log('  👉 Click the "⚙ LLM" button to open settings');
} else {
  console.log('  ⚠️  Settings button not found');
}

console.log('\n📋 Expected Tabs:');
console.log('  1. Game — Game settings (debug, labels, etc.)');
console.log('  2. LLM — LLM settings (provider, API key, model)');
console.log('  3. PixelLab — PixelLab settings (future)');
console.log('\n👉 Click each tab to verify they switch correctly.');
```

---

## ✅ Test 5: Design Tokens Applied

```javascript
console.log('🧪 Test 5: Design Tokens Check');

const tokenVars = [
  '--you', '--danger', '--s-primary', '--s-surface',
  '--r-sm', '--r-md', '--r-lg',
  '--f-sm', '--f-md', '--f-lg',
  '--lift-1', '--lift-2', '--lift-3'
];

console.log('\n📋 Checking design tokens in computed styles...');
const computed = getComputedStyle(document.documentElement);
let found = 0;
tokenVars.forEach(token => {
  const val = computed.getPropertyValue(token);
  if (val) {
    console.log(`  ✅ ${token}: ${val}`);
    found++;
  } else {
    console.log(`  ❌ ${token}: Not defined`);
  }
});
console.log(`\nResult: ${found}/${tokenVars.length} tokens defined`);
```

---

## ✅ Test 6: Dev Mode

```javascript
console.log('🧪 Test 6: Dev Mode');

console.log('\n📋 Dev Mode Shortcuts:');
console.log('  - Ctrl+Shift+D: Toggle dev mode');
console.log('  - Ctrl+Shift+I: Toggle render mode (topdown/iso)');
console.log('  - More in dev mode...');
console.log('\n👉 Press Ctrl+Shift+D to enable dev mode.');
console.log('   Should see debug overlays and extra panels.');
```

---

## 🎯 Complete Test Sequence

1. **Load game** — Should see main menu
2. **Click "New Game"** — Should generate world
3. **Press "?" key** — Should show tutorial
4. **Press "M" key** — Should toggle minimap
5. **Click "⚙ LLM" button** — Should open settings
6. **Switch to "LLM" tab** — Should show LLM settings
7. **Select "OpenRouter" provider** — Should show OpenRouter options
8. **Enter API key + select model** — Should enable "Save & Test" button
9. **Click "Save & Test"** — Should test connection
10. **Press "T" key** — Should toggle time play/pause

---

## 📊 Expected Results

| Component | Status |
|-----------|--------|
| Main Menu | Should show "New Game" button |
| Spirit HUD | Should show player power/belief |
| Rival Panel | Should show rival spirits |
| Minimap | Should toggle with M key |
| Tutorial | Should show on first load |
| Settings | Should have Game/LLM/PixelLab tabs |
| LLM Settings | Should have provider select |
| OpenRouter | Should show model dropdown |
| Design Tokens | All tokens should be defined |
| Keyboard Shortcuts | All should work |

---

## 🐛 Common Issues & Fixes

**Issue:** Settings panel doesn't open  
**Fix:** Check browser console for errors

**Issue:** OpenRouter model dropdown empty  
**Fix:** Check `openrouter-models.ts` is imported correctly

**Issue:** Design tokens not applied  
**Fix:** Check `tokens.css` is injected

**Issue:** LLM client not initialized  
**Fix:** Check `game.ts` calls `createProvider()` correctly

---

## ✅ Final Validation

After all tests pass:

1. ✅ All UI components render
2. ✅ OpenRouter integration works
3. ✅ Settings save/load correctly
4. ✅ Keyboard shortcuts work
5. ✅ Design tokens applied
6. ✅ Dev mode works
7. ✅ Build passes (`npm run build`)
8. ✅ Tests pass (`npm test`)

**If all checkboxes ticked:** Integration complete! 🎉
