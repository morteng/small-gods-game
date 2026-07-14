// src/flora/flora-facts-data.ts
// The curated flora fact-DB core (~26 species), grounded in Wikipedia (pulled via
// the Wikipedia MCP at author time — `keyFacts` are verbatim, `sources` cite the
// article). Botanical numbers are normalized from article prose to ranges (the
// "LLM extraction" step the design doc calls mandatory). This TS module is the
// CANONICAL source (type-checked, bundled so keyless players get the full core);
// `scripts/seed-flora-facts.ts` mirrors it to public/asset-library/flora-facts.json
// for external/agent consumption. Runtime lazy-fill (flora-registry) appends
// misses on top of this set. Medieval-Europe flora to match the default world.
import type { FloraSpecies } from './flora-species';

export const FLORA_FACTS: FloraSpecies[] = [
  // ─── Broadleaf trees (→ 'oak' recipe) ──────────────────────────────────────
  {
    id: 'english-oak',
    identity: { commonName: 'English oak', scientificName: 'Quercus robur', family: 'Fagaceae', wikipediaTitle: 'Quercus robur' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 20, max: 40 }, crownShape: 'spreading',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'single',
      lifespanYears: { min: 500, max: 1000 }, barkTexture: 'deeply fissured grey',
      coppices: true, flexibility: 0.12, floweringMonths: [4, 5], fruitingMonths: [9, 10],
    },
    ecology: { biome: ['temperate broadleaf forest', 'lowland'], soil: 'near-neutral loam', moisture: 'mesic', nativeRange: ['Europe', 'western Asia'] },
    narrative: {
      keyFacts: [
        'Quercus robur, pedunculate oak or English oak, is a large tree native to Europe and western Asia, notable for its value to natural ecosystems.',
        'English oaks can live to very old ages, often growing for over 500 years.',
      ],
      sources: ['Quercus robur'],
    },
  },
  {
    id: 'european-beech',
    identity: { commonName: 'European beech', scientificName: 'Fagus sylvatica', family: 'Fagaceae', wikipediaTitle: 'Fagus sylvatica' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 25, max: 35 }, crownShape: 'rounded',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'single',
      lifespanYears: { min: 150, max: 300 }, barkTexture: 'smooth silvery-grey',
      flexibility: 0.15, floweringMonths: [4, 5], fruitingMonths: [9, 10],
    },
    ecology: { biome: ['temperate broadleaf forest'], climate: 'humid', moisture: 'mesic', nativeRange: ['Europe'] },
    narrative: {
      keyFacts: ['Fagus sylvatica, the European beech, is a large deciduous tree with smooth silvery-grey bark, large leaf area, and a short trunk with low branches.'],
      sources: ['Fagus sylvatica'],
    },
  },
  {
    id: 'european-ash',
    identity: { commonName: 'European ash', scientificName: 'Fraxinus excelsior', family: 'Oleaceae', wikipediaTitle: 'Fraxinus excelsior' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 20, max: 35 }, crownShape: 'spreading',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'single',
      lifespanYears: { min: 150, max: 250 }, barkTexture: 'pale grey, fissured with age',
      coppices: true, flexibility: 0.2, floweringMonths: [4, 5], fruitingMonths: [9, 11],
    },
    ecology: { biome: ['temperate broadleaf forest'], moisture: 'mesic', nativeRange: ['Europe', 'Caucasus'] },
    narrative: {
      keyFacts: ['Fraxinus excelsior, the European ash, is a flowering plant species in the olive family Oleaceae, native throughout mainland Europe east to the Caucasus.'],
      sources: ['Fraxinus excelsior'],
    },
  },
  {
    id: 'common-hazel',
    identity: { commonName: 'Common hazel', scientificName: 'Corylus avellana', family: 'Betulaceae', wikipediaTitle: 'Corylus avellana' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 3, max: 8 }, crownShape: 'irregular',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'multi',
      lifespanYears: { min: 50, max: 80 }, coppices: true, flexibility: 0.35,
      floweringMonths: [1, 3], fruitingMonths: [9, 10],
    },
    ecology: { biome: ['temperate broadleaf forest', 'hedgerow'], moisture: 'mesic', nativeRange: ['Europe', 'western Asia'] },
    narrative: {
      keyFacts: ['Corylus avellana, the common hazel, is a species of flowering plant in the birch family. The shrubs usually grow 3–8 metres tall.'],
      sources: ['Corylus avellana'],
    },
  },
  {
    id: 'common-hawthorn',
    identity: { commonName: 'Common hawthorn', scientificName: 'Crataegus monogyna', family: 'Rosaceae', wikipediaTitle: 'Crataegus monogyna' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 5, max: 10 }, crownShape: 'rounded',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'single',
      lifespanYears: { min: 100, max: 400 }, barkTexture: 'thorny twigs, orange-brown bark',
      flexibility: 0.25, floweringMonths: [5, 6], fruitingMonths: [9, 11],
    },
    ecology: { biome: ['hedgerow', 'scrub', 'woodland edge'], moisture: 'mesic', nativeRange: ['Europe'] },
    narrative: {
      keyFacts: ['Crataegus monogyna, common hawthorn, grows to about 10 metres tall, producing hermaphrodite flowers in late spring; its berry-like haws contain a stone-encased seed.'],
      sources: ['Crataegus monogyna'],
    },
  },
  {
    id: 'small-leaved-lime',
    identity: { commonName: 'Small-leaved lime', scientificName: 'Tilia cordata', family: 'Malvaceae', wikipediaTitle: 'Tilia cordata' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 20, max: 38 }, crownShape: 'rounded',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'single',
      lifespanYears: { min: 300, max: 1000 }, coppices: true, flexibility: 0.15,
      floweringMonths: [6, 7], fruitingMonths: [9, 10],
    },
    ecology: { biome: ['temperate broadleaf forest'], moisture: 'mesic', nativeRange: ['Europe', 'Caucasus', 'western Asia'] },
    narrative: {
      keyFacts: ['Tilia cordata, the small-leaved lime, is a species of tree native to much of Europe; its range extends from Britain through mainland Europe to the Caucasus and western Asia.'],
      sources: ['Tilia cordata'],
    },
  },
  {
    id: 'crab-apple',
    identity: { commonName: 'European crab apple', scientificName: 'Malus sylvestris', family: 'Rosaceae', wikipediaTitle: 'Malus sylvestris' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 5, max: 10 }, crownShape: 'rounded',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'single',
      lifespanYears: { min: 80, max: 100 }, flexibility: 0.25,
      floweringMonths: [5, 5], fruitingMonths: [9, 10],
    },
    ecology: { biome: ['woodland edge', 'hedgerow'], moisture: 'mesic', nativeRange: ['western Eurasia'] },
    narrative: {
      keyFacts: ['Malus sylvestris, the European crab apple, is a species of the genus Malus; its scientific name means "forest apple", reflecting its habitat.'],
      sources: ['Malus sylvestris'],
    },
  },
  {
    id: 'silver-birch',
    identity: { genus: 'Betula', species: 'pendula', commonName: 'Silver birch', scientificName: 'Betula pendula', family: 'Betulaceae', wikipediaTitle: 'Betula pendula' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 15, max: 25 }, crownShape: 'columnar',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'single',
      lifespanYears: { min: 60, max: 90 }, barkTexture: 'white papery, black fissures',
      flexibility: 0.5, floweringMonths: [4, 5], fruitingMonths: [7, 8],
    },
    ecology: { biome: ['temperate forest', 'heath'], moisture: 'mesic', nativeRange: ['Europe', 'Siberia', 'southwest Asia'] },
    narrative: {
      keyFacts: ['Betula pendula, commonly known as silver birch, is a species of tree native to Europe and parts of Asia, with a range extending into Siberia, China and southwest Asia.'],
      sources: ['Betula pendula'],
    },
  },
  {
    // Same genus as silver birch, different species: damper habitat, a rounder,
    // bushier crown — a distinct DB entry driving distinct geometry.
    id: 'downy-birch',
    identity: { genus: 'Betula', species: 'pubescens', commonName: 'Downy birch', scientificName: 'Betula pubescens', family: 'Betulaceae', wikipediaTitle: 'Betula pubescens' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 10, max: 20 }, crownShape: 'rounded',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'single',
      lifespanYears: { min: 60, max: 90 }, barkTexture: 'grey-white, smooth then rough',
      flexibility: 0.45, floweringMonths: [4, 5], fruitingMonths: [7, 9],
    },
    ecology: { biome: ['temperate forest', 'bog', 'heath'], moisture: 'wet', nativeRange: ['Europe', 'Siberia'] },
    narrative: {
      keyFacts: ['Betula pubescens, commonly known as downy birch, is a species of deciduous tree native to northern Europe and Asia, growing on wetter, poorer soils than silver birch.'],
      sources: ['Betula pubescens'],
    },
  },
  {
    // Same SPECIES as silver birch (Betula pendula), a named cultivar: the weeping
    // crown routes to the proctree generator's high-drop preset — demonstrating
    // cultivar → distinct silhouette within one species.
    id: 'weeping-birch',
    identity: { genus: 'Betula', species: 'pendula', cultivar: 'Youngii', commonName: "Young's weeping birch", scientificName: "Betula pendula 'Youngii'", family: 'Betulaceae', wikipediaTitle: 'Betula pendula' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 5, max: 8 }, crownShape: 'weeping',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'single',
      lifespanYears: { min: 50, max: 70 }, barkTexture: 'white papery, black fissures',
      flexibility: 0.7, floweringMonths: [4, 5], fruitingMonths: [7, 8],
    },
    ecology: { biome: ['temperate forest', 'parkland'], moisture: 'mesic', nativeRange: ['Europe (cultivated)'] },
    narrative: {
      keyFacts: ["Betula pendula 'Youngii', Young's weeping birch, is a cultivar forming a dome of pendulous branches that weep to the ground, grafted onto a standard stem."],
      sources: ['Betula pendula'],
    },
  },
  {
    // Parent species for the Lombardy cultivar below — a broad riparian poplar.
    id: 'black-poplar',
    identity: { genus: 'Populus', species: 'nigra', commonName: 'Black poplar', scientificName: 'Populus nigra', family: 'Salicaceae', wikipediaTitle: 'Populus nigra' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 20, max: 30 }, crownShape: 'spreading',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'single',
      lifespanYears: { min: 150, max: 200 }, barkTexture: 'dark, deeply fissured, burred',
      flexibility: 0.4, floweringMonths: [3, 4], fruitingMonths: [5, 6],
    },
    ecology: { biome: ['floodplain', 'riverbank', 'temperate broadleaf forest'], moisture: 'wet', nativeRange: ['Europe', 'western Asia'] },
    narrative: {
      keyFacts: ['Populus nigra, the black poplar, is a fast-growing deciduous tree of riparian floodplains across Europe, with a broad, heavily branched crown and a thick, burred trunk.'],
      sources: ['Populus nigra'],
    },
  },
  {
    // Cultivar of black poplar: the iconic narrow, fastigiate "exclamation-mark" tree —
    // its columnar crown routes to the proctree columnar preset.
    id: 'lombardy-poplar',
    identity: { genus: 'Populus', species: 'nigra', cultivar: 'Italica', commonName: 'Lombardy poplar', scientificName: "Populus nigra 'Italica'", family: 'Salicaceae', wikipediaTitle: 'Populus nigra' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 20, max: 30 }, crownShape: 'columnar',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'single',
      lifespanYears: { min: 50, max: 100 }, barkTexture: 'grey, fissured',
      flexibility: 0.45, floweringMonths: [3, 4], fruitingMonths: [5, 6],
    },
    ecology: { biome: ['parkland', 'hedgerow', 'avenue'], moisture: 'mesic', nativeRange: ['Europe (cultivated)'] },
    narrative: {
      keyFacts: ["Populus nigra 'Italica', the Lombardy poplar, is a fastigiate cultivar with a narrow columnar crown of erect branches, widely planted as a windbreak and avenue tree."],
      sources: ['Populus nigra'],
    },
  },
  {
    // Cultivar of English oak: an upright, narrow-crowned oak (cf. silver vs weeping
    // birch) — same species as english-oak, distinct columnar geometry.
    id: 'fastigiate-oak',
    identity: { genus: 'Quercus', species: 'robur', cultivar: 'Fastigiata', commonName: 'Cypress oak', scientificName: "Quercus robur 'Fastigiata'", family: 'Fagaceae', wikipediaTitle: 'Quercus robur' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 15, max: 25 }, crownShape: 'columnar',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'single',
      lifespanYears: { min: 300, max: 600 }, barkTexture: 'fissured grey',
      coppices: true, flexibility: 0.12, floweringMonths: [4, 5], fruitingMonths: [9, 10],
    },
    ecology: { biome: ['parkland', 'avenue'], moisture: 'mesic', nativeRange: ['Europe (cultivated)'] },
    narrative: {
      keyFacts: ["Quercus robur 'Fastigiata', the cypress oak, is an upright cultivar of pedunculate oak with a narrow, columnar crown of ascending branches."],
      sources: ['Quercus robur'],
    },
  },
  {
    // Cultivar of European ash: a grafted dome of weeping branches — routes to the
    // proctree weeping preset, distinct from the spreading wild ash.
    id: 'weeping-ash',
    identity: { genus: 'Fraxinus', species: 'excelsior', cultivar: 'Pendula', commonName: 'Weeping ash', scientificName: "Fraxinus excelsior 'Pendula'", family: 'Oleaceae', wikipediaTitle: 'Fraxinus excelsior' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 8, max: 15 }, crownShape: 'weeping',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'single',
      lifespanYears: { min: 100, max: 200 }, barkTexture: 'pale grey, fissured with age',
      coppices: true, flexibility: 0.4, floweringMonths: [4, 5], fruitingMonths: [9, 11],
    },
    ecology: { biome: ['parkland', 'churchyard'], moisture: 'mesic', nativeRange: ['Europe (cultivated)'] },
    narrative: {
      keyFacts: ["Fraxinus excelsior 'Pendula', the weeping ash, is a cultivar forming a broad dome of stiffly pendulous branches that arch to the ground, traditionally grafted onto a standard stem."],
      sources: ['Fraxinus excelsior'],
    },
  },

  // ─── Conifers (→ 'pine' recipe) ────────────────────────────────────────────
  {
    id: 'scots-pine',
    identity: { commonName: 'Scots pine', scientificName: 'Pinus sylvestris', family: 'Pinaceae', wikipediaTitle: 'Pinus sylvestris' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 15, max: 35 }, crownShape: 'conical',
      leafType: 'needle', leafPhenology: 'evergreen', trunkHabit: 'single',
      lifespanYears: { min: 150, max: 300 }, barkTexture: 'orange-red, flaky upper bark',
      flexibility: 0.18, floweringMonths: [5, 6], fruitingMonths: [9, 11],
    },
    ecology: { biome: ['boreal forest', 'heath', 'highland'], soil: 'poor sandy/acidic', moisture: 'dry', nativeRange: ['Eurasia'] },
    narrative: {
      keyFacts: ['Pinus sylvestris, the Scots pine, is native to Eurasia and can be identified by its combination of fairly short, blue-green leaves and orange-red bark.'],
      sources: ['Pinus sylvestris'],
    },
  },
  {
    id: 'norway-spruce',
    identity: { commonName: 'Norway spruce', scientificName: 'Picea abies', family: 'Pinaceae', wikipediaTitle: 'Picea abies' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 30, max: 50 }, crownShape: 'conical',
      leafType: 'needle', leafPhenology: 'evergreen', trunkHabit: 'single',
      lifespanYears: { min: 200, max: 400 }, flexibility: 0.12,
      floweringMonths: [5, 6], fruitingMonths: [9, 11],
    },
    ecology: { biome: ['boreal forest', 'montane'], moisture: 'mesic', nativeRange: ['Northern Europe', 'Central Europe', 'Eastern Europe'] },
    narrative: {
      keyFacts: ['Picea abies, the Norway spruce, has branchlets that typically hang downwards and the longest cones of any spruce, 9–17 cm long.'],
      sources: ['Picea abies'],
    },
  },
  {
    id: 'european-yew',
    identity: { commonName: 'European yew', scientificName: 'Taxus baccata', family: 'Taxaceae', wikipediaTitle: 'Taxus baccata' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 10, max: 20 }, crownShape: 'irregular',
      leafType: 'needle', leafPhenology: 'evergreen', trunkHabit: 'single',
      lifespanYears: { min: 600, max: 2000 }, barkTexture: 'thin reddish-brown, flaking',
      flexibility: 0.2, floweringMonths: [3, 4], fruitingMonths: [9, 11],
    },
    ecology: { biome: ['temperate woodland'], moisture: 'mesic', nativeRange: ['Europe', 'Northwest Africa', 'western Asia'] },
    narrative: {
      keyFacts: [
        'Taxus baccata is an Old World species of evergreen tree, a woodland tree in its native range including much of Eurasia and Northwest Africa.',
        'All parts of the plant except the fleshy aril are poisonous.',
      ],
      sources: ['Taxus baccata'],
    },
  },
  {
    id: 'common-juniper',
    identity: { commonName: 'Common juniper', scientificName: 'Juniperus communis', family: 'Cupressaceae', wikipediaTitle: 'Juniperus communis' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 2, max: 8 }, crownShape: 'columnar',
      leafType: 'needle', leafPhenology: 'evergreen', trunkHabit: 'single',
      lifespanYears: { min: 100, max: 200 }, flexibility: 0.22,
      floweringMonths: [5, 6], fruitingMonths: [9, 11],
    },
    ecology: { biome: ['heath', 'highland', 'scrub'], soil: 'poor/chalk', moisture: 'dry', nativeRange: ['Holarctic Northern Hemisphere'] },
    narrative: {
      keyFacts: ['Juniperus communis, the common juniper, is a small tree or shrub in the cypress family — an evergreen conifer with the largest geographical range of any woody plant.'],
      sources: ['Juniperus communis'],
    },
  },

  // ─── Willows (→ 'willow' recipe) ───────────────────────────────────────────
  {
    id: 'white-willow',
    identity: { commonName: 'White willow', scientificName: 'Salix alba', family: 'Salicaceae', wikipediaTitle: 'Salix alba' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 10, max: 30 }, crownShape: 'weeping',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'single',
      lifespanYears: { min: 60, max: 120 }, coppices: true, flexibility: 0.8,
      floweringMonths: [4, 5], fruitingMonths: [5, 6],
    },
    ecology: { biome: ['riparian', 'wetland'], moisture: 'wet', nativeRange: ['Europe', 'western Asia', 'Central Asia'] },
    narrative: {
      keyFacts: ['Salix alba, the white willow, is a species of willow native to Europe and western and Central Asia; the name derives from the white tone to the undersides of the leaves.'],
      sources: ['Salix alba'],
    },
  },
  {
    id: 'weeping-willow',
    identity: { commonName: 'Weeping willow', scientificName: 'Salix babylonica', family: 'Salicaceae', wikipediaTitle: 'Salix babylonica' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 8, max: 12 }, crownShape: 'weeping',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'single',
      lifespanYears: { min: 40, max: 75 }, coppices: true, flexibility: 0.9,
      floweringMonths: [4, 5], fruitingMonths: [5, 6],
    },
    ecology: { biome: ['riparian', 'wetland'], moisture: 'wet', nativeRange: ['northern China', 'cultivated worldwide'] },
    narrative: {
      keyFacts: ['Salix babylonica (Babylon willow or weeping willow) is a species of willow native to dry areas of northern China, cultivated for millennia elsewhere and traded along the Silk Road to Europe.'],
      sources: ['Salix babylonica'],
    },
  },

  // ─── Shrubs (→ 'shrub' recipe) ─────────────────────────────────────────────
  {
    id: 'blackthorn',
    identity: { commonName: 'Blackthorn', scientificName: 'Prunus spinosa', family: 'Rosaceae', wikipediaTitle: 'Prunus spinosa' },
    botanical: {
      habit: 'shrub', matureHeight_m: { min: 1, max: 5 }, crownShape: 'irregular',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'multi',
      lifespanYears: { min: 40, max: 100 }, barkTexture: 'dark, thorny',
      flexibility: 0.3, floweringMonths: [3, 4], fruitingMonths: [9, 11],
    },
    ecology: { biome: ['hedgerow', 'scrub', 'thicket'], moisture: 'mesic', nativeRange: ['Europe', 'West Asia'] },
    narrative: {
      keyFacts: ['Prunus spinosa, called blackthorn or sloe, is native to Europe and West Asia; the fruit are used to make sloe gin, and the wood to make walking sticks including the Irish shillelagh.'],
      sources: ['Prunus spinosa'],
    },
  },
  {
    id: 'gorse',
    identity: { commonName: 'Common gorse', scientificName: 'Ulex europaeus', family: 'Fabaceae', wikipediaTitle: 'Ulex europaeus' },
    botanical: {
      habit: 'shrub', matureHeight_m: { min: 1, max: 3 }, crownShape: 'irregular',
      leafType: 'scale', leafPhenology: 'evergreen', trunkHabit: 'multi',
      lifespanYears: { min: 15, max: 30 }, barkTexture: 'spiny green stems',
      flexibility: 0.3, floweringMonths: [1, 6], fruitingMonths: [6, 8],
    },
    ecology: { biome: ['heath', 'coastal', 'scrub'], soil: 'poor/acidic', moisture: 'dry', nativeRange: ['Western Europe'] },
    narrative: {
      keyFacts: ['Ulex europaeus, commonly known as gorse, common gorse, furze or whin, is a species of flowering plant native to Western Europe.'],
      sources: ['Ulex europaeus'],
    },
  },
  {
    id: 'common-broom',
    identity: { commonName: 'Common broom', scientificName: 'Cytisus scoparius', family: 'Fabaceae', wikipediaTitle: 'Cytisus scoparius' },
    botanical: {
      habit: 'shrub', matureHeight_m: { min: 1, max: 3 }, crownShape: 'irregular',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'multi',
      lifespanYears: { min: 10, max: 20 }, barkTexture: 'green ridged whippy stems',
      flexibility: 0.7, floweringMonths: [5, 6], fruitingMonths: [7, 9],
    },
    ecology: { biome: ['heath', 'scrub', 'disturbed ground'], soil: 'sandy/acidic', moisture: 'dry', nativeRange: ['western Europe', 'central Europe'] },
    narrative: {
      keyFacts: ['Cytisus scoparius, the common broom or Scotch broom, is a deciduous leguminous shrub native to western and central Europe.'],
      sources: ['Cytisus scoparius'],
    },
  },
  {
    id: 'bramble',
    identity: { commonName: 'Bramble', scientificName: 'Rubus fruticosus', family: 'Rosaceae', wikipediaTitle: 'Rubus fruticosus' },
    botanical: {
      habit: 'shrub', matureHeight_m: { min: 0.5, max: 3 }, crownShape: 'irregular',
      leafType: 'broadleaf', leafPhenology: 'semi_evergreen', trunkHabit: 'multi',
      lifespanYears: { min: 2, max: 25 }, barkTexture: 'arching thorny canes',
      flexibility: 0.6, floweringMonths: [5, 8], fruitingMonths: [8, 10],
    },
    ecology: { biome: ['hedgerow', 'scrub', 'woodland edge'], moisture: 'mesic', nativeRange: ['Europe'] },
    narrative: {
      keyFacts: ['Rubus fruticosus, the bramble or blackberry, is an aggregate of many microspecies forming arching, thorny, scrambling thickets across Europe.'],
      sources: ['Rubus fruticosus'],
    },
  },
  {
    id: 'elder',
    identity: { commonName: 'Elder', scientificName: 'Sambucus nigra', family: 'Viburnaceae', wikipediaTitle: 'Sambucus nigra' },
    botanical: {
      habit: 'shrub', matureHeight_m: { min: 3, max: 8 }, crownShape: 'spreading',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'multi',
      lifespanYears: { min: 30, max: 60 }, flexibility: 0.4,
      floweringMonths: [5, 7], fruitingMonths: [8, 9],
    },
    ecology: { biome: ['hedgerow', 'woodland edge', 'disturbed ground'], soil: 'fertile', moisture: 'mesic', nativeRange: ['Europe'] },
    narrative: {
      keyFacts: ['Sambucus nigra (elder, elderberry, black elder) is native to most of Europe and grows in a variety of conditions including both wet and dry fertile soils, primarily in sunny locations.'],
      sources: ['Sambucus nigra'],
    },
  },
  {
    id: 'heather',
    identity: { commonName: 'Heather', scientificName: 'Calluna vulgaris', family: 'Ericaceae', wikipediaTitle: 'Calluna vulgaris' },
    botanical: {
      habit: 'shrub', matureHeight_m: { min: 0.2, max: 0.5 }, crownShape: 'tufted',
      leafType: 'scale', leafPhenology: 'evergreen', trunkHabit: 'multi',
      lifespanYears: { min: 20, max: 40 }, flexibility: 0.45,
      floweringMonths: [7, 9], fruitingMonths: [9, 10],
    },
    ecology: { biome: ['heathland', 'moorland', 'bog'], soil: 'acidic', moisture: 'mesic', nativeRange: ['Europe', 'Asia Minor'] },
    narrative: {
      keyFacts: ['Calluna vulgaris, common heather or ling, is a low-growing evergreen shrub growing 20 to 50 cm tall, the dominant plant in most heathland and moorland in Europe.'],
      sources: ['Calluna vulgaris'],
    },
  },

  // ─── Ferns (→ 'fern' recipe) ───────────────────────────────────────────────
  {
    id: 'bracken',
    identity: { commonName: 'Bracken', scientificName: 'Pteridium aquilinum', family: 'Dennstaedtiaceae', wikipediaTitle: 'Pteridium aquilinum' },
    botanical: {
      habit: 'fern', matureHeight_m: { min: 0.5, max: 2.5 }, crownShape: 'tufted',
      leafType: 'frond', leafPhenology: 'deciduous', trunkHabit: 'none',
      lifespanYears: { min: 1, max: 1 }, flexibility: 0.6,
    },
    ecology: { biome: ['heath', 'woodland', 'moorland'], moisture: 'mesic', nativeRange: ['cosmopolitan (originally Eurasia, North America)'] },
    narrative: {
      keyFacts: ['Pteridium aquilinum, commonly called bracken or eagle fern, occurs in temperate and subtropical regions; the extreme lightness of its spores has led to a cosmopolitan distribution.'],
      sources: ['Pteridium aquilinum'],
    },
  },
  {
    id: 'lady-fern',
    identity: { commonName: 'Lady fern', scientificName: 'Athyrium filix-femina', family: 'Athyriaceae', wikipediaTitle: 'Athyrium filix-femina' },
    botanical: {
      habit: 'fern', matureHeight_m: { min: 0.4, max: 1.2 }, crownShape: 'tufted',
      leafType: 'frond', leafPhenology: 'deciduous', trunkHabit: 'none',
      lifespanYears: { min: 1, max: 1 }, flexibility: 0.65,
    },
    ecology: { biome: ['damp shady woodland'], moisture: 'wet', nativeRange: ['temperate Asia', 'Europe', 'North America', 'North Africa'] },
    narrative: {
      keyFacts: ['Athyrium filix-femina, the lady fern, is a large, feathery species of fern often abundant in damp, shady woodland environments.'],
      sources: ['Athyrium filix-femina'],
    },
  },

  // ─── Flowering herbs (→ 'flower' recipe) ───────────────────────────────────
  {
    id: 'foxglove',
    identity: { commonName: 'Foxglove', scientificName: 'Digitalis purpurea', family: 'Plantaginaceae', wikipediaTitle: 'Digitalis purpurea' },
    botanical: {
      habit: 'herb', matureHeight_m: { min: 0.5, max: 2.0 }, crownShape: 'columnar',
      leafType: 'broadleaf', leafPhenology: 'none', trunkHabit: 'single',
      lifespanYears: { min: 2, max: 2 }, flexibility: 0.85, floweringMonths: [6, 7],
    },
    ecology: { biome: ['woodland clearing', 'heath', 'disturbed ground'], soil: 'acidic', moisture: 'mesic', nativeRange: ['temperate Europe'] },
    generation: { petalTint: 0xB878B4 },   // pink-purple flower spike
    narrative: {
      keyFacts: [
        'Digitalis purpurea, the foxglove, is a toxic species of flowering plant native to and widespread throughout most of temperate Europe.',
        'It is the original source of the heart medicine digoxin.',
      ],
      sources: ['Digitalis purpurea'],
    },
  },
  {
    id: 'common-poppy',
    identity: { commonName: 'Common poppy', scientificName: 'Papaver rhoeas', family: 'Papaveraceae', wikipediaTitle: 'Papaver rhoeas' },
    botanical: {
      habit: 'herb', matureHeight_m: { min: 0.3, max: 0.7 }, crownShape: 'irregular',
      leafType: 'broadleaf', leafPhenology: 'none', trunkHabit: 'single',
      lifespanYears: { min: 1, max: 1 }, flexibility: 0.9, floweringMonths: [5, 8],
    },
    ecology: { biome: ['arable field', 'disturbed ground'], moisture: 'mesic', nativeRange: ['north Africa', 'temperate Eurasia'] },
    generation: { petalTint: 0xC43C2C },   // scarlet corn-poppy bloom
    narrative: {
      keyFacts: ['Papaver rhoeas (common poppy, corn poppy, Flanders poppy) is an annual herbaceous flowering plant native to north Africa and temperate Eurasia, regarded as an agricultural weed.'],
      sources: ['Papaver rhoeas'],
    },
  },

  {
    id: 'oxeye-daisy',
    identity: { commonName: 'Oxeye daisy', scientificName: 'Leucanthemum vulgare', family: 'Asteraceae', wikipediaTitle: 'Leucanthemum vulgare' },
    botanical: {
      habit: 'herb', matureHeight_m: { min: 0.3, max: 0.9 }, crownShape: 'irregular',
      leafType: 'broadleaf', leafPhenology: 'none', trunkHabit: 'single',
      lifespanYears: { min: 2, max: 10 }, flexibility: 0.85, floweringMonths: [5, 9],
    },
    ecology: { biome: ['meadow', 'grassland', 'verge'], moisture: 'mesic', nativeRange: ['Europe', 'temperate Asia'] },
    generation: { petalTint: 0xEAE8DE },   // white ray florets
    narrative: {
      keyFacts: [
        'Leucanthemum vulgare, the ox-eye daisy, is a widespread flowering plant native to Europe and the temperate regions of Asia, a typical grassland perennial wildflower.',
        'It produces a solitary composite flower head with white ray florets around a yellow disc, borne on a long unbranched stem.',
      ],
      sources: ['Leucanthemum vulgare'],
    },
  },

  // ─── Grasses (→ 'grass' recipe) ──────────────────────────────────────────────
  {
    id: 'tussock-grass',
    identity: { commonName: 'Tufted hair-grass', scientificName: 'Deschampsia cespitosa', family: 'Poaceae', wikipediaTitle: 'Deschampsia cespitosa' },
    botanical: {
      habit: 'grass', matureHeight_m: { min: 0.3, max: 1.0 }, crownShape: 'tufted',
      leafType: 'blade', leafPhenology: 'semi_evergreen', trunkHabit: 'multi',
      lifespanYears: { min: 3, max: 20 }, flexibility: 1.0, floweringMonths: [6, 8],
    },
    ecology: { biome: ['grassland', 'meadow', 'moorland', 'woodland edge'], moisture: 'mesic', nativeRange: ['Europe', 'temperate Eurasia'] },
    narrative: {
      keyFacts: [
        'Deschampsia cespitosa, tufted hairgrass or tussock grass, is a perennial tufted plant in the grass family found throughout Eurasia and North America, growing in dense tussocks.',
      ],
      sources: ['Deschampsia cespitosa'],
    },
  },
  {
    id: 'esparto-grass',
    identity: { commonName: 'Esparto grass', scientificName: 'Macrochloa tenacissima', family: 'Poaceae', wikipediaTitle: 'Esparto' },
    botanical: {
      habit: 'grass', matureHeight_m: { min: 0.4, max: 1.0 }, crownShape: 'tufted',
      leafType: 'blade', leafPhenology: 'evergreen', trunkHabit: 'multi',
      lifespanYears: { min: 5, max: 30 }, flexibility: 0.9, floweringMonths: [5, 7],
    },
    ecology: { biome: ['semi-desert', 'steppe', 'dry grassland'], soil: 'dry sandy/rocky', moisture: 'dry', nativeRange: ['north-west Africa', 'southern Iberia'] },
    narrative: {
      keyFacts: ['Esparto, halfah grass or needle grass (Macrochloa tenacissima) is a perennial grass of north-west Africa and southern Europe, forming dense tough tussocks on arid ground and long used for cordage, paper and baskets.'],
      sources: ['Esparto'],
    },
  },
  {
    id: 'marram-grass',
    identity: { commonName: 'Marram grass', scientificName: 'Ammophila arenaria', family: 'Poaceae', wikipediaTitle: 'Ammophila arenaria' },
    botanical: {
      habit: 'grass', matureHeight_m: { min: 0.6, max: 1.2 }, crownShape: 'tufted',
      leafType: 'blade', leafPhenology: 'evergreen', trunkHabit: 'multi',
      lifespanYears: { min: 5, max: 25 }, flexibility: 0.95, floweringMonths: [7, 9],
    },
    ecology: { biome: ['coastal dune', 'beach'], soil: 'shifting sand', moisture: 'dry', nativeRange: ['coasts of Europe', 'North Africa'] },
    narrative: {
      keyFacts: ['Ammophila arenaria, marram grass or European beachgrass, is a perennial grass that builds and stabilises coastal sand dunes, its deep rhizomes binding the shifting sand.'],
      sources: ['Ammophila arenaria'],
    },
  },
  {
    id: 'common-reed',
    identity: { commonName: 'Common reed', scientificName: 'Phragmites australis', family: 'Poaceae', wikipediaTitle: 'Phragmites australis' },
    botanical: {
      habit: 'grass', matureHeight_m: { min: 2.0, max: 4.0 }, crownShape: 'tufted',
      leafType: 'blade', leafPhenology: 'deciduous', trunkHabit: 'multi',
      lifespanYears: { min: 5, max: 30 }, flexibility: 0.85, floweringMonths: [8, 10],
    },
    ecology: { biome: ['reedbed', 'marsh', 'riverbank', 'wetland'], moisture: 'wet', nativeRange: ['cosmopolitan wetlands (Eurasia, Africa, Americas)'] },
    narrative: {
      keyFacts: ['Phragmites australis, the common reed, is a broadly distributed wetland grass that grows in dense stands (reedbeds) up to several metres tall along the margins of lakes, rivers and marshes.'],
      sources: ['Phragmites australis'],
    },
  },
  {
    id: 'carex-sedge',
    identity: { commonName: 'Tussock sedge', scientificName: 'Carex paniculata', family: 'Cyperaceae', wikipediaTitle: 'Carex paniculata' },
    botanical: {
      habit: 'grass', matureHeight_m: { min: 0.5, max: 1.5 }, crownShape: 'tufted',
      leafType: 'blade', leafPhenology: 'semi_evergreen', trunkHabit: 'multi',
      lifespanYears: { min: 5, max: 30 }, flexibility: 0.9, floweringMonths: [5, 7],
    },
    ecology: { biome: ['fen', 'marsh', 'wet meadow', 'riverbank'], moisture: 'wet', nativeRange: ['Europe', 'western Asia', 'North Africa'] },
    narrative: {
      keyFacts: ['Carex paniculata, the greater tussock-sedge, is a species of sedge that forms large dense tussocks in fens, marshes and wet woodland across Europe.'],
      sources: ['Carex paniculata'],
    },
  },

  // ─── Arid / wetland shrubs & herbs (biome-ecology expansion) ────────────────
  {
    id: 'tamarisk',
    identity: { commonName: 'Tamarisk', scientificName: 'Tamarix gallica', family: 'Tamaricaceae', wikipediaTitle: 'Tamarix' },
    botanical: {
      habit: 'shrub', matureHeight_m: { min: 2, max: 5 }, crownShape: 'irregular',
      leafType: 'scale', leafPhenology: 'deciduous', trunkHabit: 'multi',
      lifespanYears: { min: 50, max: 100 }, barkTexture: 'reddish, feathery sprays',
      flexibility: 0.6, floweringMonths: [4, 8], fruitingMonths: [7, 9],
    },
    ecology: { biome: ['desert', 'oasis', 'saline flat', 'dry wash'], soil: 'saline/sandy', moisture: 'dry', nativeRange: ['Eurasia', 'Africa'] },
    narrative: {
      keyFacts: ['Tamarix (tamarisk, salt cedar) is a genus of deciduous shrubs and small trees of the drylands of Eurasia and Africa, with slender branches, feathery scale-like foliage and a deep root system tolerant of saline, arid ground.'],
      sources: ['Tamarix'],
    },
  },
  {
    id: 'white-wormwood',
    identity: { commonName: 'White wormwood', scientificName: 'Artemisia herba-alba', family: 'Asteraceae', wikipediaTitle: 'Artemisia herba-alba' },
    botanical: {
      habit: 'shrub', matureHeight_m: { min: 0.2, max: 0.6 }, crownShape: 'tufted',
      leafType: 'scale', leafPhenology: 'evergreen', trunkHabit: 'multi',
      lifespanYears: { min: 5, max: 20 }, barkTexture: 'silvery-grey woolly foliage',
      flexibility: 0.4, floweringMonths: [8, 10],
    },
    ecology: { biome: ['desert', 'semi-desert', 'steppe'], soil: 'dry stony', moisture: 'dry', nativeRange: ['North Africa', 'the Near East', 'south-west Asia'] },
    // petalTint recolours the whole foliage whorl (flora-branch → foliageTint), so a
    // shrub reads grey-green rather than forest-green — the wormwood's defining look.
    generation: { petalTint: 0xB8BCA8 },   // grey-green aromatic dwarf shrub
    narrative: {
      keyFacts: ['Artemisia herba-alba, white wormwood, is a low aromatic grey-leaved shrub of the daisy family growing on the arid steppes and deserts of North Africa and the Near East.'],
      sources: ['Artemisia herba-alba'],
    },
  },
  {
    id: 'cotton-thistle',
    identity: { commonName: 'Cotton thistle', scientificName: 'Onopordum acanthium', family: 'Asteraceae', wikipediaTitle: 'Onopordum acanthium' },
    botanical: {
      habit: 'herb', matureHeight_m: { min: 0.5, max: 2.5 }, crownShape: 'columnar',
      leafType: 'broadleaf', leafPhenology: 'none', trunkHabit: 'single',
      lifespanYears: { min: 2, max: 2 }, flexibility: 0.5, floweringMonths: [6, 8],
    },
    ecology: { biome: ['dry grassland', 'disturbed ground', 'semi-desert'], soil: 'dry sandy', moisture: 'dry', nativeRange: ['Europe', 'western Asia'] },
    generation: { petalTint: 0x9E6FB0 },   // purple thistle head
    narrative: {
      keyFacts: ['Onopordum acanthium, the cotton or Scotch thistle, is a robust biennial thistle with spiny winged stems, cottony grey foliage and purple flower heads, thriving on dry, disturbed and stony ground.'],
      sources: ['Onopordum acanthium'],
    },
  },
  {
    id: 'bulrush',
    identity: { commonName: 'Bulrush', scientificName: 'Typha latifolia', family: 'Typhaceae', wikipediaTitle: 'Typha latifolia' },
    botanical: {
      habit: 'herb', matureHeight_m: { min: 1.5, max: 3.0 }, crownShape: 'columnar',
      leafType: 'blade', leafPhenology: 'deciduous', trunkHabit: 'single',
      lifespanYears: { min: 3, max: 15 }, flexibility: 0.8, floweringMonths: [6, 8],
    },
    ecology: { biome: ['marsh', 'pond margin', 'riverbank', 'wetland'], moisture: 'wet', nativeRange: ['Northern Hemisphere wetlands'] },
    generation: { petalTint: 0x6B4A2E },   // brown cigar-shaped seed head
    narrative: {
      keyFacts: ['Typha latifolia, bulrush, common cattail or reedmace, is a tall emergent marsh plant of ponds and slow water across the Northern Hemisphere, bearing a distinctive dense brown cylindrical flower/seed spike.'],
      sources: ['Typha latifolia'],
    },
  },

  // ─── Wetland tree (riparian canopy) ─────────────────────────────────────────
  {
    id: 'common-alder',
    identity: { commonName: 'Common alder', scientificName: 'Alnus glutinosa', family: 'Betulaceae', wikipediaTitle: 'Alnus glutinosa' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 20, max: 30 }, crownShape: 'conical',
      leafType: 'broadleaf', leafPhenology: 'deciduous', trunkHabit: 'single',
      lifespanYears: { min: 60, max: 160 }, barkTexture: 'fissured dark grey-brown',
      coppices: true, flexibility: 0.25, floweringMonths: [2, 4], fruitingMonths: [9, 11],
    },
    ecology: { biome: ['riverbank', 'wet woodland', 'fen carr', 'floodplain'], moisture: 'wet', nativeRange: ['Europe', 'south-west Asia', 'North Africa'] },
    narrative: {
      keyFacts: ['Alnus glutinosa, the common or black alder, is a deciduous tree of the birch family thriving in wet ground along rivers, ponds and marshes, fixing nitrogen through root nodules and bearing small woody cone-like fruits.'],
      sources: ['Alnus glutinosa'],
    },
  },

  // ─── Rocks (→ rock prim) ───────────────────────────────────────────────────
  {
    id: 'granite-boulder',
    identity: { commonName: 'Granite boulder', scientificName: 'Granite', family: 'igneous rock', wikipediaTitle: 'Granite' },
    botanical: {
      habit: 'rock', matureHeight_m: { min: 1.0, max: 3.0 }, crownShape: 'none',
      leafType: 'none', leafPhenology: 'none', barkTexture: 'coarse-grained, rounded by weathering',
    },
    ecology: { biome: ['highland', 'moorland', 'continental crust'], nativeRange: ['worldwide'] },
    narrative: {
      keyFacts: ['Granite is a coarse-grained intrusive igneous rock composed mostly of quartz, alkali feldspar, mica and plagioclase, common in the continental crust of Earth.'],
      sources: ['Granite'],
    },
    generation: { jitter: 0.3 },
  },
  {
    id: 'field-stone',
    identity: { commonName: 'Field stone', scientificName: 'Granite', family: 'igneous rock', wikipediaTitle: 'Granite' },
    botanical: {
      habit: 'rock', matureHeight_m: { min: 0.4, max: 1.0 }, crownShape: 'none',
      leafType: 'none', leafPhenology: 'none', barkTexture: 'weathered, lichen-flecked',
    },
    ecology: { biome: ['farmland', 'moorland'], nativeRange: ['worldwide'] },
    narrative: {
      keyFacts: ['Granite forms from magma with a high content of silica and alkali metal oxides that slowly cools and solidifies underground.'],
      sources: ['Granite'],
    },
    generation: { jitter: 0.45 },
  },
];
