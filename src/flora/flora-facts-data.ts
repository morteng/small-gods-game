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
    identity: { commonName: 'Silver birch', scientificName: 'Betula pendula', family: 'Betulaceae', wikipediaTitle: 'Betula pendula' },
    botanical: {
      habit: 'tree', matureHeight_m: { min: 15, max: 25 }, crownShape: 'irregular',
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
    narrative: {
      keyFacts: ['Papaver rhoeas (common poppy, corn poppy, Flanders poppy) is an annual herbaceous flowering plant native to north Africa and temperate Eurasia, regarded as an agricultural weed.'],
      sources: ['Papaver rhoeas'],
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
