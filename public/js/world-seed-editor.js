/**
 * Small Gods - World Seed Editor
 */

function openWorldSeedEditor() {
  const modal = document.getElementById('worldSeedModal');
  const textarea = document.getElementById('worldSeedJson');

  // Initialize with current or default seed
  const seed = state.worldSeed || {
    ...DEFAULT_WORLD_SEED,
    size: {
      width: parseInt(document.getElementById('mapWidth').value) || 24,
      height: parseInt(document.getElementById('mapHeight').value) || 18
    }
  };

  textarea.value = JSON.stringify(seed, null, 2);
  updatePOIList();
  validateWorldSeed();

  modal.classList.add('show');

  // Add validation on edit
  textarea.oninput = () => {
    validateWorldSeed();
    updatePOIList();
  };
}

function closeWorldSeedEditor() {
  document.getElementById('worldSeedModal').classList.remove('show');
}

function validateWorldSeed() {
  const textarea = document.getElementById('worldSeedJson');
  const validationBox = document.getElementById('validationBox');

  try {
    const seed = JSON.parse(textarea.value);

    // Use WorldSeed validation if available
    if (window.WorldSeed && window.WorldSeed.validateWorldSeed) {
      const result = window.WorldSeed.validateWorldSeed(seed);
      if (result.valid) {
        validationBox.className = 'validation-msg valid';
        validationBox.textContent = 'Valid World Seed';
      } else {
        validationBox.className = 'validation-msg invalid';
        validationBox.textContent = result.errors.join(', ');
      }
    } else {
      validationBox.className = 'validation-msg valid';
      validationBox.textContent = 'Valid JSON';
    }
    return true;
  } catch (e) {
    validationBox.className = 'validation-msg invalid';
    validationBox.textContent = 'Invalid JSON: ' + e.message;
    return false;
  }
}

function updatePOIList() {
  const textarea = document.getElementById('worldSeedJson');
  const poiList = document.getElementById('poiList');

  try {
    const seed = JSON.parse(textarea.value);
    if (!seed.pois || seed.pois.length === 0) {
      poiList.innerHTML = '<div class="empty-state">No POIs defined</div>';
      return;
    }

    poiList.innerHTML = seed.pois.map((poi, i) => `
      <div class="poi-item" onclick="selectPOI(${i})">
        <div class="poi-name">${poi.name || poi.id}</div>
        <div class="poi-type">${poi.type}${poi.position ? ` @ (${poi.position.x}, ${poi.position.y})` : ''}</div>
      </div>
    `).join('');
  } catch (e) {
    poiList.innerHTML = '<div class="empty-state">Invalid JSON</div>';
  }
}

function selectPOI(index) {
  const textarea = document.getElementById('worldSeedJson');
  try {
    const seed = JSON.parse(textarea.value);
    const poi = seed.pois[index];
    if (poi) {
      const searchStr = `"id": "${poi.id}"`;
      const pos = textarea.value.indexOf(searchStr);
      if (pos !== -1) {
        textarea.focus();
        textarea.setSelectionRange(pos, pos + searchStr.length);
      }
    }
  } catch (e) {}
}

function quickAddPOI(type) {
  const textarea = document.getElementById('worldSeedJson');

  try {
    const seed = JSON.parse(textarea.value);
    const width = seed.size?.width || 24;
    const height = seed.size?.height || 18;

    // Generate unique ID
    const existingIds = seed.pois.map(p => p.id);
    let id = type + '_1';
    let counter = 1;
    while (existingIds.includes(id)) {
      counter++;
      id = type + '_' + counter;
    }

    // Random position
    const x = Math.floor(Math.random() * (width - 4)) + 2;
    const y = Math.floor(Math.random() * (height - 4)) + 2;

    // Default descriptions for DM agent
    const descriptions = {
      village: 'A peaceful settlement with friendly inhabitants.',
      castle: 'An imposing fortress with tall stone walls.',
      forest: 'A dense woodland filled with ancient trees.',
      lake: 'A serene body of crystal clear water.',
      mountain: 'A towering peak that dominates the horizon.',
      port: 'A bustling harbor with ships and sailors.'
    };

    // Default visual styles for AI painting
    const visualStyles = {
      village: 'cozy thatched cottages, smoke from chimneys, vegetable gardens',
      castle: 'imposing stone walls, tall towers, flags and banners',
      forest: 'tall ancient trees, dappled sunlight, mysterious paths',
      lake: 'crystal clear water, gentle ripples, reflections',
      mountain: 'snow-capped peaks, rocky crags, alpine meadows',
      port: 'wooden docks, fishing boats, seagulls'
    };

    const newPOI = {
      id,
      type,
      name: type.charAt(0).toUpperCase() + type.slice(1) + ' ' + counter,
      position: { x, y },
      size: type === 'castle' || type === 'forest' ? 'large' : 'medium',
      description: descriptions[type] || 'An interesting location.',
      visualStyle: visualStyles[type] || ''
    };

    seed.pois.push(newPOI);
    textarea.value = JSON.stringify(seed, null, 2);
    validateWorldSeed();
    updatePOIList();
  } catch (e) {
    console.error('Failed to add POI:', e);
  }
}

function loadExampleSeed() {
  const textarea = document.getElementById('worldSeedJson');

  const exampleSeed = {
    name: "The King's Road",
    description: "A prosperous trading route connecting the coastal city of Marketton to the mountain fortress of Ironhold.",
    size: { width: 32, height: 24 },
    biome: "temperate",
    visualTheme: "lush green meadows, medieval atmosphere, golden sunlight, Studio Ghibli style",
    pois: [
      {
        id: "ironhold",
        type: "castle",
        name: "Ironhold",
        position: { x: 6, y: 12 },
        size: "large",
        description: "Ancient dwarven fortress carved into the mountainside, home to the exiled King Brannock.",
        visualStyle: "weathered grey stone, tall spires, mountain backdrop",
        npcs: [
          { name: "King Brannock", role: "ruler", personality: "proud but fair" },
          { name: "Captain Aldric", role: "guard captain", personality: "loyal and stern" }
        ]
      },
      {
        id: "marketton",
        type: "city",
        name: "Marketton",
        position: { x: 26, y: 12 },
        size: "large",
        description: "Bustling trading hub known for its grand marketplace and diverse population.",
        visualStyle: "colorful market stalls, cobblestone streets, tall church spire"
      },
      {
        id: "waypoint_village",
        type: "village",
        name: "Millbrook",
        position: { x: 16, y: 8 },
        size: "small",
        description: "Quiet farming village known for its excellent bread and warm hospitality.",
        visualStyle: "water mill, wheat fields, cozy cottages"
      },
      {
        id: "travelers_rest",
        type: "village",
        name: "Traveler's Rest",
        position: { x: 20, y: 16 },
        size: "small",
        description: "Popular stopping point for merchants, famous for the Sleeping Dragon tavern.",
        visualStyle: "large inn with smoking chimneys, stables, wagon yard"
      },
      {
        id: "northern_forest",
        type: "forest",
        region: { y_max: 6 },
        density: 0.7,
        description: "Dense woodland rumored to be home to woodland spirits.",
        visualStyle: "ancient oak trees, mysterious fog, glowing mushrooms"
      },
      {
        id: "southern_lake",
        type: "lake",
        position: { x: 12, y: 20 },
        size: "medium",
        description: "Peaceful fishing lake known for its giant carp.",
        visualStyle: "calm blue water, wooden fishing dock, lily pads"
      }
    ],
    connections: [
      { from: "ironhold", to: "waypoint_village", type: "road", style: "stone", description: "Well-maintained royal road" },
      { from: "waypoint_village", to: "travelers_rest", type: "road", description: "Dusty merchant trail" },
      { from: "travelers_rest", to: "marketton", type: "road", style: "stone", description: "Busy trading route" }
    ],
    constraints: ["castle_on_high_ground", "roads_connect_all_settlements"],
    lore: {
      history: "The King's Road was established 200 years ago after the Treaty of Two Crowns united the mountain and coastal kingdoms.",
      factions: ["Kingdom of Ironhold", "Merchant's Guild of Marketton", "Forest Druids"],
      quests: ["Escort a merchant caravan safely to Marketton", "Investigate disappearances in the northern forest"]
    }
  };

  textarea.value = JSON.stringify(exampleSeed, null, 2);
  document.getElementById('wsName').value = exampleSeed.name;
  document.getElementById('wsBiome').value = exampleSeed.biome;
  validateWorldSeed();
  updatePOIList();
}

function loadDefaultWorld() {
  const textarea = document.getElementById('worldSeedJson');
  textarea.value = JSON.stringify(DEFAULT_WORLD_SEED, null, 2);
  document.getElementById('wsName').value = DEFAULT_WORLD_SEED.name;
  document.getElementById('wsBiome').value = DEFAULT_WORLD_SEED.biome;
  validateWorldSeed();
  updatePOIList();
}

function downloadWorldSeed() {
  const textarea = document.getElementById('worldSeedJson');

  try {
    const seed = JSON.parse(textarea.value);
    const filename = (seed.name || 'world').toLowerCase().replace(/\s+/g, '_') + '_seed.json';
    const blob = new Blob([JSON.stringify(seed, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setStatus(`Downloaded: ${filename}`, 'success');
    setTimeout(hideStatus, 2000);
  } catch (e) {
    setStatus('Invalid JSON - cannot save', 'error');
  }
}

function loadWorldSeedFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const seed = JSON.parse(e.target.result);
      const textarea = document.getElementById('worldSeedJson');
      textarea.value = JSON.stringify(seed, null, 2);

      // Update sidebar fields
      if (seed.name) document.getElementById('wsName').value = seed.name;
      if (seed.biome) document.getElementById('wsBiome').value = seed.biome;

      validateWorldSeed();
      updatePOIList();

      setStatus(`Loaded: ${file.name}`, 'success');
      setTimeout(hideStatus, 2000);
    } catch (err) {
      setStatus('Invalid JSON file', 'error');
    }
  };
  reader.readAsText(file);

  // Reset input so same file can be loaded again
  event.target.value = '';
}

function saveWorldSeedToStorage() {
  const textarea = document.getElementById('worldSeedJson');
  try {
    const seed = JSON.parse(textarea.value);
    localStorage.setItem('smallGods_worldSeed', JSON.stringify(seed));
  } catch (e) {
    // Ignore invalid JSON
  }
}

function loadWorldSeedFromStorage() {
  const saved = localStorage.getItem('smallGods_worldSeed');
  if (saved) {
    try {
      state.worldSeed = JSON.parse(saved);
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
}

async function applyWorldSeed() {
  const textarea = document.getElementById('worldSeedJson');

  if (!validateWorldSeed()) {
    setStatus('Invalid World Seed JSON', 'error');
    return;
  }

  try {
    state.worldSeed = JSON.parse(textarea.value);

    // Save to localStorage
    localStorage.setItem('smallGods_worldSeed', JSON.stringify(state.worldSeed));

    // Update UI from seed
    document.getElementById('mapWidth').value = state.worldSeed.size?.width || 24;
    document.getElementById('mapHeight').value = state.worldSeed.size?.height || 18;

    // Set mode to WFC and generate
    document.getElementById('genMode').value = 'wfc';
    closeWorldSeedEditor();

    await generateWorld();
  } catch (e) {
    setStatus('Error applying seed: ' + e.message, 'error');
  }
}
